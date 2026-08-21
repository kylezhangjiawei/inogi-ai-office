import {
  BadRequestException,
  ForbiddenException,
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
import { UploadVideoDto } from './dto/upload-video.dto';
import { OSS_BUSINESS_TYPES } from '../oss/oss.constants';
import { UPLOADED_MEDIA_MARKER } from '../../common/media-upload.constants';
import {
  buildCategoryTree,
  categoryDepth,
  collectSubtreeIds,
  subtreeHeight,
  DEFAULT_CATEGORY_COLOR,
  MAX_CATEGORY_DEPTH,
  UNCATEGORIZED_FILTER,
} from '../../common/category-tree.util';

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

/** 分类校验既可能跑在普通连接上，也可能跑在事务里。 */
type CategoryDbClient = Pick<PrismaService, 'videoCategory'> | Prisma.TransactionClient;

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

  async listVideos(userId: string, page = 1, pageSize = 12, categoryId?: string) {
    const take = Math.min(Math.max(pageSize, 1), 48);
    const skip = (Math.max(page, 1) - 1) * take;
    const where: Prisma.VideoGenerationWhereInput = {
      userId,
      ...(await this.buildCategoryFilter(categoryId)),
    };
    const [items, total] = await Promise.all([
      this.prisma.videoGeneration.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.videoGeneration.count({ where }),
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
    categoryId: string | null;
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
      category_id: row.categoryId,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
    };
  }

  // ── 本地上传入库 ─────────────────────────────────────────────────────────────

  /**
   * 把用户上传到 OSS 的本地视频登记成作品库记录：与生成任务同表同列表，
   * 用 mode='upload' + status='succeeded' + 零成本区分，这样分类、筛选、播放全都直接复用。
   */
  async uploadVideo(userId: string, dto: UploadVideoDto) {
    const asset = await this.prisma.fileAsset.findFirst({
      where: { id: dto.fileId?.trim(), status: 'active' },
      select: { objectKey: true, mimeType: true, fileName: true, uploadedBy: true },
    });
    if (!asset || !/^video\//i.test(asset.mimeType)) {
      throw new BadRequestException('上传文件不存在或不是视频');
    }
    if (asset.uploadedBy && asset.uploadedBy !== userId) {
      throw new ForbiddenException('只能把自己上传的文件加入作品库');
    }
    // 只认 library/videos 前缀：否则拿别处的 fileId 就能把私有文件搬进作品库
    if (!this.ossService.isKeyUnderBusinessType(asset.objectKey, OSS_BUSINESS_TYPES.LIBRARY_VIDEOS)) {
      throw new BadRequestException('该文件不是上传到视频作品库的');
    }

    const categoryId = dto.categoryId?.trim() || null;
    if (categoryId) await this.assertCategoryExists(categoryId);

    const row = await this.prisma.videoGeneration.create({
      data: {
        userId,
        mode: UPLOADED_MEDIA_MARKER,
        model: UPLOADED_MEDIA_MARKER,
        prompt: dto.title?.trim() || asset.fileName,
        // 上传件没有上游任务，直接落成已完成态；分辨率存前端量到的 宽x高（不参与计费口径）
        status: 'succeeded',
        videoObjectKey: asset.objectKey,
        resolution: dto.resolution?.trim() || '',
        duration: dto.duration ?? 0,
        billedSeconds: 0,
        costYuan: 0,
        categoryId,
      },
    });

    return this.toResponse(row);
  }

  /**
   * 删除自己的视频，连同 OSS 上的文件一起清掉——视频动辄上百 MB，只删库行会留一堆孤儿对象。
   * 生成中的任务不给删：后台轮询还会回写这一行，删了会产生「更新不存在的记录」的报错。
   */
  async deleteVideo(userId: string, id: string) {
    const row = await this.prisma.videoGeneration.findUnique({
      where: { id },
      select: { id: true, userId: true, status: true, videoObjectKey: true },
    });
    if (!row) throw new NotFoundException('视频不存在');
    if (row.userId !== userId) throw new ForbiddenException();
    if (row.status === 'pending' || row.status === 'running') {
      throw new BadRequestException('生成中的任务不能删除，等它完成或失败后再删');
    }

    if (row.videoObjectKey) {
      await this.ossService.deleteObject(row.videoObjectKey).catch((err) => {
        // 对象删不掉不该挡住用户删记录，留日志人工清理
        this.logger.warn(`删除 OSS 视频对象失败 ${row.videoObjectKey}: ${this.errText(err)}`);
      });
      // 上传件在 FileAsset 里有登记，一并置为已删除；生成件没有登记，这里影响 0 行
      await this.prisma.fileAsset.updateMany({
        where: { objectKey: row.videoObjectKey, status: 'active' },
        data: { status: 'deleted', deletedAt: new Date() },
      });
    }
    await this.prisma.videoGeneration.delete({ where: { id } });
    return { ok: true };
  }

  // ── 作品库分类（全局共享目录）────────────────────────────────────────────────
  // 规则与图像作品库一致：最多 3 层、同级不重名、删父连子、视频转未分类。
  // 树算法复用 common/category-tree.util，这里只做 Prisma 读写与事务加锁。

  /**
   * 分类树。itemCount 是「当前用户」直接挂在该节点上的视频数，totalItemCount 含子孙节点——
   * 分类目录全局共享但视频按 userId 隔离，计数必须同口径，否则前端筛选出的数量对不上。
   */
  async listCategories(userId: string) {
    const [categories, grouped, uncategorizedCount, totalCount] = await Promise.all([
      this.prisma.videoCategory.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.videoGeneration.groupBy({
        by: ['categoryId'],
        where: { userId, categoryId: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.videoGeneration.count({ where: { userId, categoryId: null } }),
      this.prisma.videoGeneration.count({ where: { userId } }),
    ]);

    const counts = new Map(grouped.map((row) => [row.categoryId, row._count._all]));
    return {
      items: buildCategoryTree(categories, counts),
      uncategorizedCount,
      totalCount,
    };
  }

  async createCategory(
    userId: string,
    dto: { name: string; parentId?: string | null; description?: string; color?: string; sortOrder?: number },
  ) {
    const name = dto.name?.trim();
    if (!name) throw new BadRequestException('分类名称不能为空');
    const parentId = dto.parentId?.trim() || null;

    // 与 updateCategory 一样先锁表再校验写入：并发「在 X 下建子分类」与「把 X 往下移」
    // 会各自读到移动前的层号而双双通过 3 层校验；根分类重名也只能靠这里兜住
    // （Postgres 里 NULL 互不相等，@@unique([parentId, name]) 管不到 parentId 为 null 那层）。
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "VideoCategory" FOR UPDATE`;

      if (parentId) {
        const categories = await tx.videoCategory.findMany({ select: { id: true, parentId: true } });
        const parent = categories.find((item) => item.id === parentId);
        if (!parent) throw new NotFoundException('父分类不存在');
        if (categoryDepth(parentId, categories) >= MAX_CATEGORY_DEPTH) {
          throw new BadRequestException(`分类最多 ${MAX_CATEGORY_DEPTH} 层`);
        }
      }
      await this.assertCategoryNameAvailable(name, parentId, undefined, tx);

      // 排序号在同级内递增，避免新建的子分类窜到别的父节点下面去排
      const maxSortOrder = await tx.videoCategory.aggregate({
        where: { parentId },
        _max: { sortOrder: true },
      });
      return tx.videoCategory.create({
        data: {
          name,
          parentId,
          description: dto.description?.trim() ?? '',
          color: dto.color?.trim() || DEFAULT_CATEGORY_COLOR,
          sortOrder: dto.sortOrder ?? (maxSortOrder._max.sortOrder ?? 0) + 10,
          createdBy: userId,
        },
      });
    });
  }

  async updateCategory(
    id: string,
    dto: { name?: string; parentId?: string | null; description?: string; color?: string; sortOrder?: number },
  ) {
    // 先锁住分类表再做移动校验：不加锁时两个并发移动（A 移到 B 下、B 移到 A 下）会各自
    // 读到移动前快照、双双通过环检测，写出一个从根不可达、界面上直接消失的环。
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "VideoCategory" FOR UPDATE`;

      const current = await this.assertCategoryExists(id, tx);
      const data: Prisma.VideoCategoryUncheckedUpdateInput = {};
      // 改名要按「改完之后的父节点」查同级重名，否则同一次请求里既移动又改名会漏判
      let targetParentId = current.parentId;

      if (dto.parentId !== undefined) {
        targetParentId = dto.parentId?.trim() || null;
        if (targetParentId !== current.parentId) {
          await this.assertCategoryMoveAllowed(id, targetParentId, tx);
          data.parentId = targetParentId;
        }
      }

      if (dto.name !== undefined) {
        const name = dto.name.trim();
        if (!name) throw new BadRequestException('分类名称不能为空');
        await this.assertCategoryNameAvailable(name, targetParentId, id, tx);
        data.name = name;
      }
      if (dto.description !== undefined) data.description = dto.description.trim();
      if (dto.color !== undefined) data.color = dto.color.trim() || DEFAULT_CATEGORY_COLOR;
      if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;

      return tx.videoCategory.update({ where: { id }, data });
    });
  }

  /**
   * 删除分类及其整棵子树（DB 侧 onDelete: Cascade）。分类是全局目录、视频按人隔离，
   * 所以不能只看当前用户的视频数就判空：视频一律保留，只是被 SetNull 解绑成未分类。
   */
  async deleteCategory(id: string) {
    await this.assertCategoryExists(id);
    const categories = await this.prisma.videoCategory.findMany({ select: { id: true, parentId: true } });
    const affectedIds = collectSubtreeIds(id, categories);
    const detached = await this.prisma.videoGeneration.count({ where: { categoryId: { in: affectedIds } } });
    await this.prisma.videoCategory.delete({ where: { id } });
    return {
      ok: true,
      detachedVideoCount: detached,
      deletedCategoryCount: affectedIds.length,
      deletedCategoryIds: affectedIds,
    };
  }

  /** 设置 / 清除单个视频的分类归属；仅视频所有者可操作。 */
  async assignVideoCategory(userId: string, videoId: string, categoryId?: string | null) {
    const video = await this.prisma.videoGeneration.findUnique({
      where: { id: videoId },
      select: { id: true, userId: true },
    });
    if (!video) throw new NotFoundException('视频不存在');
    if (video.userId !== userId) throw new ForbiddenException();

    const target = categoryId?.trim() || null;
    if (target) await this.assertCategoryExists(target);

    return this.prisma.videoGeneration.update({
      where: { id: videoId },
      data: { categoryId: target },
      select: { id: true, categoryId: true },
    });
  }

  private async assertCategoryExists(id: string, client: CategoryDbClient = this.prisma) {
    const category = await client.videoCategory.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('分类不存在');
    return category;
  }

  private async assertCategoryNameAvailable(
    name: string,
    parentId: string | null,
    excludeId?: string,
    client: CategoryDbClient = this.prisma,
  ) {
    const existing = await client.videoCategory.findFirst({
      where: { name, parentId, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    if (existing) throw new BadRequestException('同级下已有同名分类');
  }

  /** 移动分类：父节点必须存在、不能落到自己的子树里、移动后整棵子树不能超过层数上限。 */
  private async assertCategoryMoveAllowed(
    id: string,
    targetParentId: string | null,
    client: CategoryDbClient = this.prisma,
  ) {
    if (!targetParentId) return;
    if (targetParentId === id) throw new BadRequestException('不能把分类移动到自己下面');

    const categories = await client.videoCategory.findMany({ select: { id: true, parentId: true } });
    if (!categories.some((item) => item.id === targetParentId)) {
      throw new NotFoundException('父分类不存在');
    }
    if (collectSubtreeIds(id, categories).includes(targetParentId)) {
      throw new BadRequestException('不能把分类移动到自己的子分类下面');
    }

    const parentDepth = categoryDepth(targetParentId, categories);
    const height = subtreeHeight(id, categories);
    if (parentDepth + height > MAX_CATEGORY_DEPTH) {
      throw new BadRequestException(`分类最多 ${MAX_CATEGORY_DEPTH} 层`);
    }
  }

  /** 选中父分类时连子孙一起查；uncategorized 查未归类。 */
  private async buildCategoryFilter(categoryId?: string): Promise<Prisma.VideoGenerationWhereInput> {
    const value = categoryId?.trim();
    if (!value) return {};
    if (value === UNCATEGORIZED_FILTER) return { categoryId: null };

    const categories = await this.prisma.videoCategory.findMany({ select: { id: true, parentId: true } });
    const ids = collectSubtreeIds(value, categories);
    return ids.length > 1 ? { categoryId: { in: ids } } : { categoryId: value };
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
        source: 'video',
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
