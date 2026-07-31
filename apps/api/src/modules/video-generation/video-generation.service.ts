import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IntegrationConfig, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { SecureConfigService } from '../security/secure-config.service';
import { OssService } from '../oss/oss.service';
import { ResearchDevelopmentService } from '../research-development/research-development.service';
import { AiUsageService } from '../ai-usage/ai-usage.service';
import { CreateVideoDto } from './dto/create-video.dto';

/** HappyHorse 计费单价（人民币元/秒），按输出视频时长计费，与 i2v/t2v/r2v 模式无关，只看分辨率。 */
export const VIDEO_PRICE_YUAN_PER_SECOND: Record<string, number> = {
  '720P': 0.9,
  '1080P': 1.6,
};

/** 按分辨率与时长预估成本（元），保留两位小数。 */
export function estimateVideoCostYuan(resolution: string, durationSeconds: number): number {
  const unit = VIDEO_PRICE_YUAN_PER_SECOND[resolution] ?? VIDEO_PRICE_YUAN_PER_SECOND['720P'];
  return Math.round(unit * Math.max(0, durationSeconds) * 100) / 100;
}

/** 成本闸门模式：off=不拦；threshold=超阈值才确认；always=每次都确认 */
export type VideoCostGateMode = 'off' | 'threshold' | 'always';

export type VideoCostGateConfig = {
  mode: VideoCostGateMode;
  /** 自动放行阈值（元）：threshold 模式下，预估 ≤ 此值免确认 */
  autoThresholdYuan: number;
  /** 内部预算上限（元），null=不设上限（不做余额拦截） */
  budgetCapYuan: number | null;
};

export type VideoGateEvaluation = {
  mode: VideoCostGateMode;
  estimate_yuan: number;
  auto_threshold_yuan: number;
  budget_cap_yuan: number | null;
  spent_yuan: number | null;
  remaining_yuan: number | null;
  /** 是否需要用户在确认卡上确认 */
  require_confirm: boolean;
  /** 是否超预算被拦截（不放行） */
  blocked: boolean;
};

/** 成本闸门配置存于 system_setting KV，key 固定；管理端走通用 system-settings 保存端点。 */
export const VIDEO_COST_GATE_KEY = 'video.cost_gate';
const DEFAULT_COST_GATE: VideoCostGateConfig = {
  mode: 'threshold',
  autoThresholdYuan: 5,
  budgetCapYuan: null,
};

type VideoRuntime = {
  apiKey: string;
  submitUrl: string;
  tasksBase: string;
  model: string;
};

type UpstreamCreateResponse = {
  output?: { task_id?: string; task_status?: string };
  request_id?: string;
  code?: string;
  message?: string;
};

type UpstreamPollResponse = {
  output?: {
    task_id?: string;
    task_status?: string;
    video_url?: string;
  };
  usage?: { duration?: number; output_video_duration?: number; SR?: string };
  code?: string;
  message?: string;
};

const DEFAULT_VIDEO_ORIGIN = 'https://token-plan.cn-beijing.maas.aliyuncs.com';
// 轮询间隔：官方建议 ~15s
const POLL_INTERVAL_MS = 15_000;
// 单任务轮询总超时：视频分钟级，给足 20min 后判失败，避免任务永久挂起
const POLL_TIMEOUT_MS = 20 * 60 * 1000;
// 提交/轮询单次 HTTP 超时
const SUBMIT_TIMEOUT_MS = 30_000;
const POLL_HTTP_TIMEOUT_MS = 30_000;
// 下载上游临时视频的超时（转存 OSS 前）
const VIDEO_DOWNLOAD_TIMEOUT_MS = 120_000;

@Injectable()
export class VideoGenerationService implements OnModuleInit {
  private readonly logger = new Logger(VideoGenerationService.name);
  // 当前进程正在轮询的任务 id，避免同一任务被重复轮询（如重启恢复与新提交并发）
  private readonly polling = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly secureConfigService: SecureConfigService,
    private readonly ossService: OssService,
    private readonly rdService: ResearchDevelopmentService,
    private readonly aiUsageService: AiUsageService,
  ) {}

  /** 进程启动时恢复未完成任务的轮询（DB 落库带来的能力：重启不丢任务） */
  async onModuleInit(): Promise<void> {
    try {
      const pending = await this.prisma.videoGeneration.findMany({
        where: { status: { in: ['pending', 'running'] }, upstreamTaskId: { not: null } },
        orderBy: { createdAt: 'asc' },
        take: 200,
      });
      for (const row of pending) {
        const runtime = await this.resolveVideoRuntime({ model: row.model, mode: row.mode }).catch(
          (err) => {
            this.logger.warn(
              `视频任务 ${row.id} 恢复轮询失败（模型 ${row.model} 可能已停用/改名）: ${this.errText(err)}`,
            );
            return null;
          },
        );
        if (runtime) void this.pollUntilDone(row.id, runtime);
      }
      if (pending.length > 0) {
        this.logger.log(`已恢复 ${pending.length} 个未完成的视频生成任务轮询`);
      }
    } catch (err) {
      this.logger.warn(`恢复视频任务轮询失败: ${this.errText(err)}`);
    }
  }

  // ── 提交任务 ────────────────────────────────────────────────────────────────

  async submit(userId: string, dto: CreateVideoDto) {
    const mode = dto.mode;
    const prompt = dto.prompt.trim();
    if (!prompt && mode === 't2v') {
      throw new BadRequestException('文生视频需要填写提示词');
    }
    const sourceUrls = (dto.source_image_urls ?? []).map((u) => u.trim()).filter(Boolean);
    // 独立工作台上传的图片：用 fileId 服务端重签为 OSS 直连 URL（供 DashScope 拉取）
    if (dto.source_file_ids?.length) {
      const resolved = await this.resolveFileIdsToUrls(userId, dto.source_file_ids);
      sourceUrls.push(...resolved);
    }
    if (mode === 'i2v' && sourceUrls.length !== 1) {
      throw new BadRequestException('图生视频（i2v）需要且仅需要 1 张首帧图');
    }
    if (mode === 'r2v' && (sourceUrls.length < 1 || sourceUrls.length > 9)) {
      throw new BadRequestException('参考生视频（r2v）需要 1~9 张参考图');
    }

    const resolution = dto.resolution ?? '720P';
    const duration = dto.duration ?? 5;
    // 超预算硬拦（防御性：确认卡是前端 UX，直连提交也必须挡住超额）
    const gate = await this.evaluateGate(resolution, duration);
    if (gate.blocked) {
      throw new BadRequestException(
        `视频预算不足：本次约需 ¥${gate.estimate_yuan}，剩余预算 ¥${gate.remaining_yuan ?? 0}`,
      );
    }
    const runtime = await this.resolveVideoRuntime({ modelId: dto.model_id, mode });
    const costYuan = estimateVideoCostYuan(resolution, duration);

    const row = await this.prisma.videoGeneration.create({
      data: {
        userId,
        conversationId: dto.conversation_id ?? null,
        mode,
        model: runtime.model,
        prompt,
        sourceImageRefs: dto.source_image_refs ?? [],
        sourceImageUrls: sourceUrls,
        resolution,
        ratio: mode === 'i2v' ? '' : dto.ratio ?? '',
        duration,
        watermark: dto.watermark ?? true,
        seed: dto.seed ?? null,
        status: 'pending',
        costYuan,
      },
    });

    // 提交上游（拿 upstream task_id）；失败则标记 failed 并抛出
    try {
      const upstreamTaskId = await this.createUpstreamTask(row, runtime);
      await this.prisma.videoGeneration.update({
        where: { id: row.id },
        data: { status: 'running', upstreamTaskId },
      });
      void this.pollUntilDone(row.id, runtime);
    } catch (err) {
      const message = this.errText(err);
      await this.prisma.videoGeneration.update({
        where: { id: row.id },
        data: { status: 'failed', errorMessage: message, costYuan: 0 },
      });
      throw new BadRequestException(`视频任务提交失败：${message}`);
    }

    return this.getTask(userId, row.id);
  }

  /** 把上传文件 id 解析为 OSS 直连签名 URL（2h，覆盖生成窗口）。仅限本人上传且为图片。 */
  private async resolveFileIdsToUrls(userId: string, fileIds: string[]): Promise<string[]> {
    const urls: string[] = [];
    for (const id of fileIds.map((x) => x.trim()).filter(Boolean)) {
      const asset = await this.prisma.fileAsset.findFirst({
        where: { id, status: 'active' },
        select: { objectKey: true, mimeType: true, uploadedBy: true },
      });
      if (!asset || !/^image\//i.test(asset.mimeType)) {
        throw new BadRequestException(`来源图 ${id} 不存在或不是图片`);
      }
      if (asset.uploadedBy && asset.uploadedBy !== userId) {
        throw new BadRequestException('只能使用自己上传的图片作为视频来源');
      }
      const url = this.ossService.getSignedUrl(asset.objectKey, 7200);
      if (!url) throw new BadRequestException('OSS 未启用，无法生成图片直连地址');
      urls.push(url);
    }
    return urls;
  }

  async getTask(userId: string, id: string) {
    const row = await this.prisma.videoGeneration.findFirst({ where: { id, userId } });
    if (!row) throw new NotFoundException('视频任务不存在');
    return this.toResponse(row);
  }

  async listVideos(userId: string, page = 1, pageSize = 12) {
    const take = Math.min(Math.max(pageSize, 1), 48);
    const skip = (Math.max(page, 1) - 1) * take;
    const [items, total] = await Promise.all([
      this.prisma.videoGeneration.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.videoGeneration.count({ where: { userId } }),
    ]);
    return {
      items: items.map((row) => this.toResponse(row)),
      total,
      page: Math.max(page, 1),
      page_size: take,
      total_pages: Math.max(1, Math.ceil(total / take)),
    };
  }

  private toResponse(row: {
    id: string;
    mode: string;
    model: string;
    prompt: string;
    resolution: string;
    ratio: string;
    duration: number;
    status: string;
    videoObjectKey: string;
    upstreamVideoUrl: string;
    billedSeconds: number;
    costYuan: number;
    errorMessage: string | null;
    conversationId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    const videoUrl = row.videoObjectKey
      ? this.ossService.getSignedUrl(row.videoObjectKey, 3600) ?? row.upstreamVideoUrl
      : row.upstreamVideoUrl;
    return {
      id: row.id,
      mode: row.mode,
      model: row.model,
      prompt: row.prompt,
      resolution: row.resolution,
      ratio: row.ratio || null,
      duration: row.duration,
      status: row.status,
      video_url: videoUrl || null,
      billed_seconds: row.billedSeconds,
      cost_yuan: row.costYuan,
      error_message: row.errorMessage,
      conversation_id: row.conversationId,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
    };
  }

  // ── 成本闸门 ────────────────────────────────────────────────────────────────

  async getCostGateConfig(): Promise<VideoCostGateConfig> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: VIDEO_COST_GATE_KEY } });
    const v = (row?.value ?? {}) as Record<string, unknown>;
    const mode =
      v.mode === 'off' || v.mode === 'threshold' || v.mode === 'always'
        ? v.mode
        : DEFAULT_COST_GATE.mode;
    const autoThresholdYuan =
      typeof v.autoThresholdYuan === 'number' && v.autoThresholdYuan >= 0
        ? v.autoThresholdYuan
        : DEFAULT_COST_GATE.autoThresholdYuan;
    const budgetCapYuan =
      typeof v.budgetCapYuan === 'number' && v.budgetCapYuan > 0 ? v.budgetCapYuan : null;
    return { mode, autoThresholdYuan, budgetCapYuan };
  }

  /** 保存成本闸门配置到 system_setting KV（管理端用）。 */
  async saveCostGateConfig(input: {
    mode?: string;
    autoThresholdYuan?: number;
    budgetCapYuan?: number | null;
  }): Promise<VideoCostGateConfig> {
    const mode: VideoCostGateMode =
      input.mode === 'off' || input.mode === 'threshold' || input.mode === 'always'
        ? input.mode
        : DEFAULT_COST_GATE.mode;
    const autoThresholdYuan =
      typeof input.autoThresholdYuan === 'number' && input.autoThresholdYuan >= 0
        ? Math.round(input.autoThresholdYuan * 100) / 100
        : DEFAULT_COST_GATE.autoThresholdYuan;
    const budgetCapYuan =
      typeof input.budgetCapYuan === 'number' && input.budgetCapYuan > 0
        ? Math.round(input.budgetCapYuan * 100) / 100
        : null;
    const value: VideoCostGateConfig = { mode, autoThresholdYuan, budgetCapYuan };
    await this.prisma.systemSetting.upsert({
      where: { key: VIDEO_COST_GATE_KEY },
      create: {
        category: 'video',
        key: VIDEO_COST_GATE_KEY,
        value: value as unknown as Prisma.InputJsonValue,
        description: '视频生成成本闸门配置',
      },
      update: {
        category: 'video',
        value: value as unknown as Prisma.InputJsonValue,
        description: '视频生成成本闸门配置',
      },
    });
    return value;
  }

  /**
   * 已占用预算（元）：非失败任务成本之和（succeeded 实际计费 + pending/running 预估）。
   * 阿里云真实额度无对外 API，这里以内部累计作为额度占用口径。
   */
  async getSpentYuan(): Promise<number> {
    const agg = await this.prisma.videoGeneration.aggregate({
      _sum: { costYuan: true },
      where: { status: { not: 'failed' } },
    });
    return Math.round((agg._sum.costYuan ?? 0) * 100) / 100;
  }

  /** 评估成本闸门：是否需要确认、是否超预算被拦。供确认卡与提交前置校验共用。 */
  async evaluateGate(resolution: string, duration: number): Promise<VideoGateEvaluation> {
    const config = await this.getCostGateConfig();
    const estimateYuan = estimateVideoCostYuan(resolution, duration);
    const hasBudget = config.budgetCapYuan != null;
    const spentYuan = hasBudget ? await this.getSpentYuan() : null;
    const remainingYuan =
      hasBudget && spentYuan != null
        ? Math.max(0, Math.round((config.budgetCapYuan! - spentYuan) * 100) / 100)
        : null;
    const blocked = remainingYuan != null && estimateYuan > remainingYuan;

    let requireConfirm: boolean;
    if (config.mode === 'off') requireConfirm = false;
    else if (config.mode === 'always') requireConfirm = true;
    else requireConfirm = estimateYuan > config.autoThresholdYuan;

    return {
      mode: config.mode,
      estimate_yuan: estimateYuan,
      auto_threshold_yuan: config.autoThresholdYuan,
      budget_cap_yuan: config.budgetCapYuan,
      spent_yuan: spentYuan,
      remaining_yuan: remainingYuan,
      // 超预算一律需要确认（且确认时提交会被硬拦），保证卡上能显式提示
      require_confirm: blocked ? true : requireConfirm,
      blocked,
    };
  }

  // ── 上游调用 ────────────────────────────────────────────────────────────────

  private async createUpstreamTask(
    row: { mode: string; model: string; prompt: string; sourceImageUrls: string[]; resolution: string; ratio: string; duration: number; watermark: boolean; seed: number | null },
    runtime: VideoRuntime,
  ): Promise<string> {
    const input: Record<string, unknown> = { prompt: row.prompt };
    if (row.mode === 'i2v') {
      input.media = [{ type: 'first_frame', url: row.sourceImageUrls[0] }];
    } else if (row.mode === 'r2v') {
      input.media = row.sourceImageUrls.map((url) => ({ type: 'reference_image', url }));
    }
    const parameters: Record<string, unknown> = {
      resolution: row.resolution,
      duration: row.duration,
      watermark: row.watermark,
    };
    if (row.seed != null) parameters.seed = row.seed;
    if (row.ratio && row.mode !== 'i2v') parameters.ratio = row.ratio;

    const body = { model: runtime.model, input, parameters };
    const json = (await this.httpJson(
      runtime.submitUrl,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${runtime.apiKey}`,
          'X-DashScope-Async': 'enable',
        },
        body: JSON.stringify(body),
      },
      SUBMIT_TIMEOUT_MS,
    )) as UpstreamCreateResponse;

    const taskId = json.output?.task_id;
    if (!taskId) {
      throw new Error(json.message || json.code || '上游未返回 task_id');
    }
    return taskId;
  }

  /** 后台轮询直至成功/失败/超时。带进程内去重，避免同一任务并发轮询。 */
  private async pollUntilDone(id: string, runtime: VideoRuntime): Promise<void> {
    if (this.polling.has(id)) return;
    this.polling.add(id);
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    try {
      for (;;) {
        const row = await this.prisma.videoGeneration.findUnique({ where: { id } });
        if (!row || !row.upstreamTaskId) return;
        if (row.status === 'succeeded' || row.status === 'failed') return;

        if (Date.now() > deadline) {
          await this.markFailed(id, `轮询超时（${Math.round(POLL_TIMEOUT_MS / 60000)} 分钟）`);
          return;
        }

        let poll: UpstreamPollResponse;
        try {
          poll = (await this.httpJson(
            `${runtime.tasksBase}/${row.upstreamTaskId}`,
            {
              method: 'GET',
              headers: { Authorization: `Bearer ${runtime.apiKey}` },
            },
            POLL_HTTP_TIMEOUT_MS,
          )) as UpstreamPollResponse;
        } catch (err) {
          // 单次轮询网络错误：不判失败，等下个周期重试
          this.logger.warn(`视频任务 ${id} 轮询出错（将重试）: ${this.errText(err)}`);
          await this.sleep(POLL_INTERVAL_MS);
          continue;
        }

        const status = (poll.output?.task_status ?? '').toUpperCase();
        if (status === 'SUCCEEDED') {
          await this.onUpstreamSucceeded(id, poll);
          return;
        }
        if (status === 'FAILED' || status === 'CANCELED' || status === 'UNKNOWN') {
          await this.markFailed(id, poll.message || `上游任务状态 ${status}`);
          return;
        }
        // PENDING / RUNNING：继续等
        await this.sleep(POLL_INTERVAL_MS);
      }
    } finally {
      this.polling.delete(id);
    }
  }

  private async onUpstreamSucceeded(id: string, poll: UpstreamPollResponse): Promise<void> {
    const upstreamUrl = poll.output?.video_url ?? '';
    const billedSeconds = poll.usage?.duration ?? poll.usage?.output_video_duration ?? 0;

    const row = await this.prisma.videoGeneration.findUnique({ where: { id } });
    if (!row) return;
    const actualCost =
      billedSeconds > 0 ? estimateVideoCostYuan(row.resolution, billedSeconds) : row.costYuan;

    // 转存 OSS（失败则回退到上游 24h 临时 URL，不阻断任务完成）
    const objectKey = upstreamUrl ? await this.transferToOss(id, upstreamUrl) : '';

    let updated;
    try {
      updated = await this.prisma.videoGeneration.update({
        where: { id },
        data: {
          status: 'succeeded',
          upstreamVideoUrl: upstreamUrl,
          videoObjectKey: objectKey ?? '',
          billedSeconds,
          costYuan: actualCost,
          errorMessage: null,
        },
      });
    } catch (error) {
      if (objectKey) await this.ossService.deleteObject(objectKey);
      throw error;
    }
    this.logger.log(`视频任务 ${id} 完成（计费 ${billedSeconds}s / ¥${actualCost}）`);
    this.aiUsageService.record({
      userId: updated.userId,
      modality: 'video',
      model: updated.model,
      costYuan: actualCost,
      seconds: billedSeconds,
      source: 'video_gen',
      refId: updated.id,
    });
    void this.notifySettled(updated);
  }

  private async markFailed(id: string, message: string): Promise<void> {
    const updated = await this.prisma.videoGeneration.update({
      where: { id },
      // 失败不计费
      data: { status: 'failed', errorMessage: message, costYuan: 0 },
    });
    this.logger.warn(`视频任务 ${id} 失败: ${message}`);
    void this.notifySettled(updated);
  }

  /**
   * 任务结束（成功/失败）后的通知：站内铃铛（发给发起人自己）。
   * 邮件 / 对话内富渲染在后续增量接入（邮件依赖 SMTP 接通）。
   */
  private async notifySettled(row: {
    id: string;
    userId: string;
    mode: string;
    resolution: string;
    duration: number;
    status: string;
    costYuan: number;
    errorMessage: string | null;
  }): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: row.userId },
        select: { name: true },
      });
      const ok = row.status === 'succeeded';
      const modeLabel =
        row.mode === 'i2v' ? '图生视频' : row.mode === 't2v' ? '文生视频' : '参考生视频';
      const body = ok
        ? `你的视频已生成完成（${modeLabel} · ${row.resolution} · ${row.duration}s，计费 ¥${row.costYuan}）。可在视频库查看。`
        : `你的视频生成失败：${row.errorMessage ?? '未知原因'}。本次未产生费用，可重试。`;
      await this.rdService.createMessage({
        sender: { name: '视频生成' },
        recipient_id: row.userId,
        recipient_name: user?.name ?? null,
        subject: ok ? '视频生成完成' : '视频生成失败',
        body,
        // 点击通知 → 跳视频库并定位该视频；失败无可看视频，仅带类型
        meta: ok
          ? { kind: 'video_done', video_id: row.id, route: '/video-library' }
          : { kind: 'video_failed', video_id: row.id, route: '/video-library' },
      });
    } catch (err) {
      this.logger.warn(`视频任务 ${row.id} 通知发送失败: ${this.errText(err)}`);
    }
  }

  private async transferToOss(id: string, url: string): Promise<string> {
    if (!this.ossService.isEnabled) return '';
    try {
      const res = await this.fetchWithTimeout(url, { method: 'GET' }, VIDEO_DOWNLOAD_TIMEOUT_MS);
      if (!res.ok) throw new Error(`下载上游视频失败 HTTP ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      const objectKey = await this.ossService.uploadBuffer(
        buffer,
        'videos/generated',
        `${id}.mp4`,
        'video/mp4',
      );
      return objectKey ?? '';
    } catch (err) {
      this.logger.warn(`视频 ${id} 转存 OSS 失败（回退临时 URL）: ${this.errText(err)}`);
      return '';
    }
  }

  // ── 凭据与 endpoint 解析 ─────────────────────────────────────────────────────

  /**
   * 解析视频模型运行时（apiKey + endpoint + model）。
   * 选择优先级：① modelId 指定；② 与 mode 名匹配的视频模型（i2v/t2v/r2v）；
   * ③ 与 model 名相同（重启恢复用）；④ 默认启用的视频模型；⑤ 任意视频模型。
   */
  private async resolveVideoRuntime(opts: {
    modelId?: string;
    model?: string;
    mode?: string;
  }): Promise<VideoRuntime> {
    if (opts.modelId?.trim()) {
      const config = await this.prisma.integrationConfig.findFirst({
        where: { id: opts.modelId.trim(), kind: 'openai', isActive: true },
      });
      if (!config || !this.configSupportsVideo(config)) {
        throw new BadRequestException('选择的视频模型不可用，请在 AI 模型管理中确认该模型已启用且用途为「视频」');
      }
      return this.buildRuntime(config);
    }

    const configs = await this.prisma.integrationConfig.findMany({
      where: { kind: 'openai', isActive: true },
      orderBy: { updatedAt: 'desc' },
    });
    const videoConfigs = configs.filter((item) => this.configSupportsVideo(item));
    const mode = opts.mode?.toLowerCase();
    let config: IntegrationConfig | undefined;
    if (opts.model) config = videoConfigs.find((item) => item.model === opts.model);
    if (!config && mode) {
      config = videoConfigs.find((item) => (item.model ?? '').toLowerCase().includes(mode));
    }
    config =
      config ??
      videoConfigs.find((item) => this.metadataDefaultEnabled(item)) ??
      videoConfigs[0];

    if (!config) {
      throw new BadRequestException('未配置可用的视频模型，请先在 AI 模型管理中新增用途为「视频」的 HappyHorse 模型');
    }
    return this.buildRuntime(config);
  }

  private buildRuntime(config: IntegrationConfig): VideoRuntime {
    const model = (config.model ?? '').trim();
    if (!model) {
      throw new BadRequestException('该视频模型未填写模型标识，请在 AI 模型管理中补全');
    }
    let apiKey = '';
    try {
      apiKey = this.secureConfigService.decryptFromStorage(config.encryptedSecret);
    } catch {
      /* ignore */
    }
    const metadata = config.metadata as Record<string, unknown> | null;
    const baseUrl = typeof metadata?.base_url === 'string' ? metadata.base_url : undefined;
    const { submitUrl, tasksBase } = this.deriveEndpoints(baseUrl);
    return { apiKey, submitUrl, tasksBase, model };
  }

  /**
   * 由模型配置的 base_url 推导视频异步接口地址。
   * 视频走 DashScope 原生路径（非 compatible-mode），因此只取 origin 再拼接固定路径。
   */
  private deriveEndpoints(baseUrl?: string): { submitUrl: string; tasksBase: string } {
    const envOrigin = this.config.get<string>('DASHSCOPE_VIDEO_BASE_URL')?.trim();
    let origin = envOrigin || DEFAULT_VIDEO_ORIGIN;
    if (baseUrl) {
      try {
        origin = new URL(baseUrl).origin;
      } catch {
        /* 保留 origin 默认值 */
      }
    }
    return {
      submitUrl: `${origin}/api/v1/services/aigc/video-generation/video-synthesis`,
      tasksBase: `${origin}/api/v1/tasks`,
    };
  }

  private readUsageKind(config: IntegrationConfig): string {
    const metadata = config.metadata as Record<string, unknown> | null;
    return metadata && typeof metadata.usage_kind === 'string' ? metadata.usage_kind : '';
  }

  private metadataDefaultEnabled(config: IntegrationConfig): boolean {
    const metadata = config.metadata as Record<string, unknown> | null;
    return metadata?.is_default_enabled === true;
  }

  /** 该模型是否可用于视频生成：usage_kind='video' 权威，其它显式用途排除，auto 时回退名称判定。 */
  private configSupportsVideo(config: IntegrationConfig): boolean {
    const usageKind = this.readUsageKind(config);
    if (usageKind === 'video') return true;
    if (usageKind && usageKind !== 'auto') return false;
    const name = (config.model ?? '').toLowerCase();
    return name.includes('happyhorse') || /(^|[-_/])(i2v|t2v|r2v)($|[-_/])/.test(name);
  }

  // ── HTTP 工具 ───────────────────────────────────────────────────────────────

  private async httpJson(url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
    const res = await this.fetchWithTimeout(url, init, timeoutMs);
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* 非 JSON 响应 */
    }
    if (!res.ok) {
      const message =
        (json as { message?: string; code?: string })?.message ??
        (json as { code?: string })?.code ??
        `HTTP ${res.status}`;
      throw new Error(message);
    }
    return json;
  }

  private async fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private errText(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
