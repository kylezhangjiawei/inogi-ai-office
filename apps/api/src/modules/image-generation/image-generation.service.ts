import { BadRequestException, ForbiddenException, HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import OpenAI, { toFile } from 'openai';
import { IntegrationConfig, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { PrismaService } from '../../prisma/prisma.service';
import { SecureConfigService } from '../security/secure-config.service';
import { OssService } from '../oss/oss.service';
import { AiUsageService } from '../ai-usage/ai-usage.service';
import { AiGatewayService } from '../ai-gateway/ai-gateway.service';
import type { AiGatewayTarget } from '../ai-gateway/ai-gateway.types';
import { EditImageDto } from './dto/edit-image.dto';
import { GenerateImageDto } from './dto/generate-image.dto';
import { CreatePromptChatSessionDto, PromptChatDto } from './dto/prompt-chat.dto';

const CACHE_SIMILARITY_THRESHOLD = 0.65;
const DEFAULT_IMAGE_TO_IMAGE_MODEL = 'gpt-image-1';
const DEFAULT_PROMPT_CHAT_MODEL = 'gpt-4.1-mini';
// 异步生成任务在内存中保留的最长时间（超过则清理，避免内存无界增长）
const IMAGE_GENERATION_TASK_TTL_MS = 60 * 60 * 1000;
// 当上游返回的是图片 URL（而非内联 base64）时，下载该 URL 的超时上限。
// fetch 默认无超时：若 URL 主机慢/不可达会永久挂起，把异步任务永远卡在 processing。
// 取 2min——下载一张已生成的图片本应秒级完成，且远小于上游生成 20min 预算，
// 这样「下载卡死」会在前端 20min 兜底超时之前就以明确错误暴露出来。
const IMAGE_DOWNLOAD_TIMEOUT_MS = 120_000;
/** 作品库「未分类」筛选值：与真实分类 id 区分开（cuid 不会等于该字面量）。 */
const UNCATEGORIZED_FILTER = 'uncategorized';
/** 分类树最大层数（根为第 1 层）。 */
const MAX_CATEGORY_DEPTH = 3;
/** 分类校验既可能跑在普通连接上，也可能跑在事务里。 */
type CategoryDbClient = Pick<PrismaService, 'imageCategory'> | Prisma.TransactionClient;
const DEFAULT_CATEGORY_COLOR = '#3b82f6';

type ImageGenerationTaskStatus = 'pending' | 'processing' | 'completed' | 'failed';

type ImageGenerationTask = {
  id: string;
  userId: string;
  status: ImageGenerationTaskStatus;
  result?: unknown;
  error?: string;
  createdAt: number;
  updatedAt: number;
};

type OpenAiRuntime = {
  apiKey: string;
  baseUrl?: string;
  model: string;
};

type PromptChatRuntime = OpenAiRuntime & {
  provider?: string | null;
  targets: AiGatewayTarget[];
  timeoutMs?: number;
};

type ImageQuality = 'auto' | 'low' | 'medium' | 'high' | 'standard' | 'hd';
type QualityCompatibilityMode = 'native' | 'dall-e-compatible';
type ImageOperation = 'generate' | 'edit';

type ImageUsage = {
  inputTokens: number;
  inputTextTokens: number;
  inputImageTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
};

type ImageUpstreamCallRecord = {
  status: 'success' | 'error';
  operation: ImageOperation;
  attempt: number;
  durationMs: number;
  normalizedSize: string;
  normalizedQuality: string | null;
  usage: ImageUsage | null;
  openaiRequestId: string | null;
  errorMessage: string | null;
};

type ImageUsageSummary = ImageUsage & {
  upstreamCallCount: number;
  upstreamRetryCount: number;
  upstreamErrorCount: number;
  details: ImageUpstreamCallRecord[];
};

type ImageGenerationResult = {
  imageData: string;
  revisedPrompt: string;
  usageSummary: ImageUsageSummary;
};

type ImageRequestAuditContext = {
  userId: string;
  requestId: string;
  operation: ImageOperation;
  model: string;
  baseUrlHost: string | null;
  promptLength: number;
  requestedSize: string;
  normalizedSize: string;
  requestedQuality?: string;
  normalizedQuality?: string;
  hasReferenceImage: boolean;
  referenceImageCount: number;
  referenceImageBytes: number;
  referenceImageMimeType: string | null;
  referenceImageMimeTypes: string[];
  compatibilityMode: QualityCompatibilityMode;
  attempt: number;
};

type ImageGenerationAuditBase = {
  userId: string;
  requestId: string;
  baseUrlHost: string | null;
  referenceImageCount: number;
  referenceImageBytes: number;
  referenceImageMimeType: string | null;
  referenceImageMimeTypes: string[];
};

const GPT_IMAGE_1_PRICING_USD_PER_MILLION = {
  textInput: 5,
  imageInput: 10,
  imageOutput: 40,
};

@Injectable()
export class ImageGenerationService {
  private readonly logger = new Logger(ImageGenerationService.name);
  // 异步图片生成任务的内存存储（提交后台执行 + 轮询查询）
  private readonly generationTasks = new Map<string, ImageGenerationTask>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly secureConfigService: SecureConfigService,
    private readonly ossService: OssService,
    private readonly aiUsageService: AiUsageService,
    private readonly aiGateway: AiGatewayService,
  ) {}

  // ── 生成图片（优先命中缓存）────────────────────────────────────────────────

  async generate(userId: string, dto: GenerateImageDto) {
    try {
    const prompt = dto.prompt.trim();
    const style = dto.style ?? 'vivid';
    const size = dto.size ?? '1024x1024';
    const quality = dto.quality;
    const storedQuality = quality ?? 'auto';
    const requestedModel = dto.model?.trim() || DEFAULT_IMAGE_TO_IMAGE_MODEL;
    const referenceImageDataList = this.getReferenceImageDataList(dto.reference_image_data, dto.reference_image_data_list);
    const hasReferenceImage = referenceImageDataList.length > 0;
    const requestId = randomUUID();
    const referenceImageInfo = this.getReferenceImagesInfo(referenceImageDataList);

    // 1. 先在数据库中查找相似图片
    const cached = hasReferenceImage || dto.skip_cache ? null : await this.findCachedImage(prompt, style, size, storedQuality, requestedModel);
    if (cached) {
      const savedFromCache = await this.prisma.generatedImage.create({
        data: {
          userId,
          prompt,
          revisedPrompt: cached.revisedPrompt,
          style,
          size,
          quality: storedQuality,
          imageData: cached.imageData,
          // 缓存命中时直接复用已有 OSS URL（若有）
          imageUrl: cached.imageUrl || '',
          model: cached.model,
          requestId,
          parentImageId: null,
          rootImageId: null,
          editInstruction: '',
          editDepth: 0,
          upstreamCallCount: 0,
          upstreamRetryCount: 0,
          upstreamErrorCount: 0,
          inputTokens: 0,
          inputTextTokens: 0,
          inputImageTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          estimatedCostUsd: 0,
          cumulativeEstimatedCostUsd: 0,
          usageDetails: {
            fromCache: true,
            sourceImageId: cached.id,
            sourceEstimatedCostUsd: cached.estimatedCostUsd ?? 0,
          } as Prisma.InputJsonValue,
        },
      });
      // 若缓存源无 OSS URL，异步上传并更新
      if (!savedFromCache.imageUrl) {
        void this.uploadAndSaveImageUrl(savedFromCache.id, savedFromCache.imageData);
      }
      // 埋点：缓存命中也计一次（成本 0），与 backfill 口径一致（backfill 会计入所有 GeneratedImage）
      this.aiUsageService.record({
        userId,
        modality: 'image',
        model: cached.model,
        totalTokens: 0,
        costUsd: 0,
        source: 'image_gen',
        refId: savedFromCache.id,
      });
      return { ...this.toResponse(savedFromCache), fromCache: true, similarity: cached._similarity };
    }

    // 2. 无缓存 → 调用 OpenAI Images API 生成 / 图生图编辑
    const { apiKey, baseUrl, model } = await this.resolveOpenAiCredentials(dto.model_id, requestedModel);
    if (!apiKey) {
      throw new BadRequestException('未配置可用的 OpenAI API Key，请在 AI 模型管理中添加 OpenAI 类型的配置');
    }

    const client = new OpenAI({
      apiKey,
      ...(baseUrl ? { baseURL: baseUrl } : {}),
      defaultHeaders: { 'X-Inogi-Image-Request-Id': requestId },
      timeout: this.getImageRequestTimeoutMs(),
      // 禁用 SDK 默认的 2 次自动重试：上游挂起/5xx/超时本身就是可重试错误，重试会把等待放大到约 3×timeout
      // （最坏 ~60min）且可能被上游按次计费，而前端早已在 20min 兜底放弃。图片生成一次失败即应快速暴露真实
      // 错误，由用户手动重试，而不是静默空跑。
      maxRetries: 0,
    });
    const effectiveModel = hasReferenceImage && !this.supportsImageEdit(model) ? DEFAULT_IMAGE_TO_IMAGE_MODEL : model;
    this.assertPromptLength(prompt, effectiveModel);
    const { imageData, revisedPrompt, usageSummary } = await this.generateWithOpenAi(client, {
      prompt,
      style,
      size,
      quality,
      model: effectiveModel,
      referenceImageDataList,
    }, {
      userId,
      requestId,
      baseUrlHost: this.getUrlHost(baseUrl),
      referenceImageCount: referenceImageInfo.count,
      referenceImageBytes: referenceImageInfo.bytes,
      referenceImageMimeType: referenceImageInfo.mimeType,
      referenceImageMimeTypes: referenceImageInfo.mimeTypes,
    });

    // 4. 存库
    const saved = await this.prisma.generatedImage.create({
      data: {
        userId,
        prompt,
        revisedPrompt,
        style,
        size,
        quality: storedQuality,
        imageData,
        model: effectiveModel,
        requestId,
        upstreamCallCount: usageSummary.upstreamCallCount,
        upstreamRetryCount: usageSummary.upstreamRetryCount,
        upstreamErrorCount: usageSummary.upstreamErrorCount,
        inputTokens: usageSummary.inputTokens,
        inputTextTokens: usageSummary.inputTextTokens,
        inputImageTokens: usageSummary.inputImageTokens,
        outputTokens: usageSummary.outputTokens,
        totalTokens: usageSummary.totalTokens,
        estimatedCostUsd: usageSummary.estimatedCostUsd,
        cumulativeEstimatedCostUsd: usageSummary.estimatedCostUsd,
        usageDetails: { calls: usageSummary.details } as Prisma.InputJsonValue,
      },
    });

    // 5. 上传到 OSS：异步进行，不阻塞任务完成。uploadBuffer 无超时，若内网 OSS 端点不可达会长时间挂起，
    //    会把整个异步任务卡在 processing，直到前端轮询超时报「图片处理超时」——即便图片此时早已存库并出现在列表里。
    //    这里先用 base64 返回（toResponse 在 imageUrl 为空时回退到 imageData），OSS URL 由后台写回 DB，与命中缓存路径一致。
    void this.uploadAndSaveImageUrl(saved.id, imageData);
    this.aiUsageService.record({
      userId,
      modality: 'image',
      model: effectiveModel,
      totalTokens: usageSummary.totalTokens,
      costUsd: usageSummary.estimatedCostUsd,
      source: 'image_gen',
      refId: saved.id,
    });
    return { ...this.toResponse(saved), fromCache: false, similarity: 0 };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      const message = this.getErrorMessage(error);
      this.logger.error(`Image generation failed: ${message}`, error instanceof Error ? error.stack : undefined);
      throw new BadRequestException(`图片生成失败：${message}`);
    }
  }

  // ── 异步生成/编辑：提交任务后台执行 + 轮询查询（避免长连接被网关 504 截断）──────

  createGenerationTask(userId: string, dto: GenerateImageDto) {
    return this.startTask(userId, () => this.generate(userId, dto));
  }

  async createEditTask(userId: string, imageId: string, dto: EditImageDto) {
    // 提交时即做轻量校验（空内容/归属），与同步接口的即时报错行为保持一致
    if (!dto.message?.trim()) {
      throw new BadRequestException('请先输入图片修改要求');
    }
    const owner = await this.prisma.generatedImage.findUnique({
      where: { id: imageId },
      select: { userId: true },
    });
    if (!owner) {
      throw new NotFoundException('图片不存在');
    }
    if (owner.userId !== userId) {
      throw new ForbiddenException();
    }
    return this.startTask(userId, () => this.editImage(userId, imageId, dto));
  }

  getImageTask(userId: string, taskId: string) {
    const task = this.generationTasks.get(taskId);
    if (!task) {
      throw new NotFoundException('生成任务不存在或已过期，请重新生成');
    }
    if (task.userId !== userId) {
      throw new ForbiddenException('无权访问该生成任务');
    }
    return {
      taskId: task.id,
      status: task.status,
      result: task.status === 'completed' ? task.result : undefined,
      error: task.status === 'failed' ? task.error : undefined,
    };
  }

  private startTask(userId: string, work: () => Promise<unknown>) {
    this.pruneExpiredTasks();
    const taskId = randomUUID();
    const now = Date.now();
    this.generationTasks.set(taskId, {
      id: taskId,
      userId,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    });
    // 后台执行，立即返回 taskId；不 await，避免阻塞请求
    void this.runTask(taskId, work);
    return { taskId, status: 'pending' as ImageGenerationTaskStatus };
  }

  private async runTask(taskId: string, work: () => Promise<unknown>) {
    const task = this.generationTasks.get(taskId);
    if (!task) return;
    task.status = 'processing';
    task.updatedAt = Date.now();
    try {
      const result = await work();
      const current = this.generationTasks.get(taskId);
      if (!current) return;
      current.status = 'completed';
      current.result = result;
      current.updatedAt = Date.now();
    } catch (error) {
      const current = this.generationTasks.get(taskId);
      if (!current) return;
      current.status = 'failed';
      current.error = this.getErrorMessage(error);
      current.updatedAt = Date.now();
    }
  }

  // 兜底定时清理：startTask/getImageTask 已会被动调用本方法，但若长时间没有任何新生成请求、
  // 同时又有遗留的过期任务时，被动路径不会触发；这里每 10 分钟主动清一次，确保不滞留内存。
  @Interval(10 * 60 * 1000)
  private pruneExpiredTasks() {
    const now = Date.now();
    for (const [id, task] of this.generationTasks) {
      if (now - task.updatedAt > IMAGE_GENERATION_TASK_TTL_MS) {
        this.generationTasks.delete(id);
      }
    }
  }

  // 图片生成/编辑的上游超时（毫秒）。默认 20 分钟：图片生成本就慢（实测可达 ~300s），且需与前端轮询兜底
  // 超时对齐（imageStudioShared GENERATE_POLL_TIMEOUT_MS 同为 20min），避免后端先于前端放弃导致正常生成被误杀。
  // 显式 timeout 会覆盖 SDK 默认 10min，可放心取更大值。可用 env OPENAI_IMAGE_TIMEOUT_MS 覆盖。
  private getImageRequestTimeoutMs(): number {
    const raw = Number(this.config.get('OPENAI_IMAGE_TIMEOUT_MS'));
    return Number.isFinite(raw) && raw > 0 ? raw : 1_200_000;
  }

  async listPromptSessions(userId: string) {
    const sessions = await this.prisma.imagePromptChatSession.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: 40,
      include: { _count: { select: { messages: true } } },
    });
    return sessions.map((session) => this.toPromptSessionResponse(session));
  }

  async createPromptSession(userId: string, dto: CreatePromptChatSessionDto) {
    const sourcePrompt = dto.source_prompt?.trim() ?? '';
    const currentPrompt = dto.current_prompt?.trim() ?? sourcePrompt;
    const session = await this.prisma.imagePromptChatSession.create({
      data: {
        userId,
        title: this.buildPromptSessionTitle(dto.title || currentPrompt || sourcePrompt || '新提示词对话'),
        sourcePrompt,
        currentPrompt,
      },
      include: { _count: { select: { messages: true } } },
    });
    return {
      session: this.toPromptSessionResponse(session),
      messages: [],
    };
  }

  async getPromptSession(userId: string, id: string) {
    const session = await this.prisma.imagePromptChatSession.findFirst({
      where: { id, userId },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        _count: { select: { messages: true } },
      },
    });
    if (!session) {
      throw new NotFoundException('提示词优化对话不存在');
    }
    return {
      session: this.toPromptSessionResponse(session),
      messages: session.messages.map((message) => this.toPromptMessageResponse(message)),
    };
  }

  async chatPrompt(userId: string, dto: PromptChatDto) {
    const incomingPrompt = dto.current_prompt.trim();
    const message = dto.message.trim();
    if (!message) {
      throw new BadRequestException('请先输入提示词优化要求');
    }

    try {
      const requestedSessionId = dto.session_id?.trim();
      const existingSession = requestedSessionId
        ? await this.prisma.imagePromptChatSession.findFirst({ where: { id: requestedSessionId, userId } })
        : null;
      if (requestedSessionId && !existingSession) {
        throw new NotFoundException('提示词优化对话不存在');
      }

      const session =
        existingSession ??
        (await this.prisma.imagePromptChatSession.create({
          data: {
            userId,
            title: this.buildPromptSessionTitle(incomingPrompt || message || '新提示词对话'),
            sourcePrompt: incomingPrompt,
            currentPrompt: incomingPrompt,
          },
        }));
      const currentPrompt = incomingPrompt || session.currentPrompt || session.sourcePrompt;
      const storedHistory = await this.prisma.imagePromptChatMessage.findMany({
        where: { userId, sessionId: session.id },
        orderBy: { createdAt: 'asc' },
        take: 40,
      });
      const requestId = randomUUID();
      const runtime = await this.resolvePromptChatCredentials(dto.model_id, dto.model);
      if (runtime.targets.length === 0) {
        throw new BadRequestException('未配置可用的文本 AI 模型，请在 AI 模型管理中添加 OpenAI 兼容模型');
      }
      let model = runtime.model;
      const persistedHistory = storedHistory.map((item) => ({
        role: item.role === 'assistant' ? 'assistant' as const : 'user' as const,
        content: item.optimizedPrompt ? `${item.content}\nOptimized prompt:\n${item.optimizedPrompt}` : item.content,
      }));
      const fallbackHistory = (dto.history ?? []).map((item) => ({
        role: item.role,
        content: item.content,
      }));
      const history = (persistedHistory.length > 0 ? persistedHistory : fallbackHistory)
        .slice(-16)
        .filter((item) => item.content?.trim())
        .map((item) => ({
          role: item.role,
          content: item.content.trim().slice(0, 8000),
        }));
      const userMessage = await this.prisma.imagePromptChatMessage.create({
        data: {
          userId,
          sessionId: session.id,
          role: 'user',
          content: message,
          model,
          requestId,
        },
      });

      const response = await this.aiGateway.complete({
        requestId,
        scene: 'image.prompt_optimization',
        targets: runtime.targets,
        temperature: 0.35,
        responseFormat: { type: 'json_object' },
        retryWithoutResponseFormat: true,
        timeoutMs: runtime.timeoutMs ?? 60_000,
        messages: [
          {
            role: 'system',
            content: [
              '你是专业的 AI 图像提示词优化助手。',
              '你的任务是和用户用中文简短对话，并把当前图像提示词优化成可直接用于图片生成模型的最终提示词。',
              '优化时保留用户核心意图，补充主体、构图、镜头、材质、光影、风格、色彩、背景、商业用途和负面约束。',
              '不要生成图片，不要输出 Markdown。',
              '必须只返回 JSON：{"reply":"给用户的简短说明","optimized_prompt":"优化后的完整提示词"}。',
            ].join('\n'),
          },
          {
            role: 'user',
            content: `当前提示词：\n${currentPrompt || '（为空，请基于用户要求创建一个完整图像提示词）'}`,
          },
          ...history,
          { role: 'user', content: message },
        ],
      });

      model = response.model;
      const content = response.content;
      const parsed = this.parsePromptChatResponse(content, currentPrompt);
      const assistantMessage = await this.prisma.imagePromptChatMessage.create({
        data: {
          userId,
          sessionId: session.id,
          role: 'assistant',
          content: parsed.reply,
          optimizedPrompt: parsed.optimizedPrompt,
          model,
          requestId,
        },
      });
      const updatedSession = await this.prisma.imagePromptChatSession.update({
        where: { id: session.id },
        data: {
          title: this.buildPromptSessionTitle(session.title || message || parsed.optimizedPrompt),
          currentPrompt: parsed.optimizedPrompt,
          model,
        },
        include: { _count: { select: { messages: true } } },
      });
      return {
        reply: parsed.reply,
        optimizedPrompt: parsed.optimizedPrompt,
        model,
        requestId,
        session: this.toPromptSessionResponse(updatedSession),
        messages: [
          ...storedHistory.map((item) => this.toPromptMessageResponse(item)),
          this.toPromptMessageResponse(userMessage),
          this.toPromptMessageResponse(assistantMessage),
        ],
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      const errorMessage = this.getErrorMessage(error);
      this.logger.error(`Prompt chat failed: ${errorMessage}`, error instanceof Error ? error.stack : undefined);
      throw new BadRequestException(`提示词优化失败：${errorMessage}`);
    }
  }

  // ── 列表（分页）──────────────────────────────────────────────────────────────

  async listImages(
    userId: string,
    page = 1,
    pageSize = 12,
    onlyFavorite = false,
    dateFrom?: string,
    dateTo?: string,
    query?: string,
    categoryId?: string,
  ) {
    const normalizedPage = Number.isFinite(page) && page > 0 ? page : 1;
    const normalizedPageSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.min(pageSize, 48) : 12;
    const where: Prisma.GeneratedImageWhereInput = {
      userId,
      ...(onlyFavorite ? { isFavorite: true } : {}),
      ...(await this.buildCategoryFilter(categoryId)),
      ...this.buildCreatedAtFilter(dateFrom, dateTo),
      ...this.buildImageSearchFilter(query),
    };
    const [total, rawItems] = await Promise.all([
      this.prisma.generatedImage.count({ where }),
      this.prisma.generatedImage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (normalizedPage - 1) * normalizedPageSize,
        take: normalizedPageSize,
        select: {
          id: true,
          prompt: true,
          revisedPrompt: true,
          style: true,
          size: true,
          quality: true,
          // 有 imageUrl 时不返回 imageData，减少响应体积
          imageData: true,
          imageUrl: true,
          model: true,
          isFavorite: true,
          categoryId: true,
          requestId: true,
          parentImageId: true,
          rootImageId: true,
          editInstruction: true,
          editDepth: true,
          upstreamCallCount: true,
          upstreamRetryCount: true,
          upstreamErrorCount: true,
          inputTokens: true,
          inputTextTokens: true,
          inputImageTokens: true,
          outputTokens: true,
          totalTokens: true,
          estimatedCostUsd: true,
          cumulativeEstimatedCostUsd: true,
          usageDetails: true,
          createdAt: true,
        },
      }),
    ]);

    // imageUrl 字段存的是 objectKey（私有 Bucket）；响应时转为 10 分钟签名 URL。
    // 旧数据 imageUrl 为 http(s) URL 时原样返回（兼容历史记录）。
    const items = rawItems.map((item) => {
      const objectKey = item.imageUrl && !item.imageUrl.startsWith('http') ? item.imageUrl : null;
      const resolvedUrl = item.imageUrl
        ? (item.imageUrl.startsWith('http')
            ? item.imageUrl
            : this.ossService.getSignedUrl(item.imageUrl, 24 * 3600))
        : null;
      return {
        ...item,
        imageUrl: resolvedUrl,
        thumbnailUrl: objectKey
          ? this.ossService.getSignedUrl(
              objectKey,
              24 * 3600,
              'image/resize,m_lfit,w_640/format,webp/quality,q_82',
            )
          : resolvedUrl,
        imageData: resolvedUrl ? undefined : item.imageData,
      };
    });

    return {
      total,
      page: normalizedPage,
      pageSize: normalizedPageSize,
      totalPages: Math.ceil(total / normalizedPageSize),
      items,
    };
  }

  async getUsage(userId: string, date?: string) {
    const { start, end, dateKey } = this.buildUtcUsageWindow(date);
    const logs = await this.prisma.auditLog.findMany({
      where: {
        userId,
        action: 'OPENAI_IMAGE_REQUEST',
        resource: 'image_generation_upstream',
        createdAt: { gte: start, lt: end },
      },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });

    const entries = logs.map((log) => {
      const meta = this.asRecord(log.meta);
      const usage = this.asRecord(meta.usage);
      return {
        id: log.id,
        createdAt: log.createdAt.toISOString(),
        requestId: this.asString(meta.requestId),
        openaiRequestId: this.asString(meta.openaiRequestId),
        status: this.asString(meta.status) || 'unknown',
        operation: this.asString(meta.operation) || 'unknown',
        model: this.asString(meta.model) || '',
        baseUrlHost: this.asString(meta.baseUrlHost),
        requestedSize: this.asString(meta.requestedSize),
        normalizedSize: this.asString(meta.normalizedSize),
        requestedQuality: this.asString(meta.requestedQuality),
        normalizedQuality: this.asString(meta.normalizedQuality),
        compatibilityMode: this.asString(meta.compatibilityMode),
        attempt: this.asNumber(meta.attempt),
        hasReferenceImage: meta.hasReferenceImage === true,
        referenceImageCount: this.asNumber(meta.referenceImageCount),
        referenceImageBytes: this.asNumber(meta.referenceImageBytes),
        durationMs: this.asNumber(meta.durationMs),
        inputTokens: this.asNumber(usage.inputTokens),
        inputTextTokens: this.asNumber(usage.inputTextTokens),
        inputImageTokens: this.asNumber(usage.inputImageTokens),
        outputTokens: this.asNumber(usage.outputTokens),
        totalTokens: this.asNumber(usage.totalTokens),
        estimatedCostUsd: this.asNumber(usage.estimatedCostUsd),
        errorMessage: this.asString(meta.errorMessage),
      };
    });

    const summary = entries.reduce(
      (acc, entry) => {
        acc.upstreamCalls += 1;
        if (entry.status === 'success') acc.successCalls += 1;
        if (entry.status === 'error') acc.errorCalls += 1;
        if (entry.attempt > 1) acc.retryCalls += 1;
        if (entry.operation === 'edit') acc.editCalls += 1;
        if (entry.operation === 'generate') acc.generateCalls += 1;
        acc.inputTokens += entry.inputTokens;
        acc.inputTextTokens += entry.inputTextTokens;
        acc.inputImageTokens += entry.inputImageTokens;
        acc.outputTokens += entry.outputTokens;
        acc.totalTokens += entry.totalTokens;
        acc.estimatedCostUsd += entry.estimatedCostUsd;
        return acc;
      },
      {
        upstreamCalls: 0,
        successCalls: 0,
        errorCalls: 0,
        retryCalls: 0,
        generateCalls: 0,
        editCalls: 0,
        inputTokens: 0,
        inputTextTokens: 0,
        inputImageTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
      },
    );

    return {
      date: dateKey,
      timezone: 'UTC',
      window: { start: start.toISOString(), end: end.toISOString() },
      summary: {
        ...summary,
        estimatedCostUsd: Number(summary.estimatedCostUsd.toFixed(6)),
      },
      entries: entries.slice(0, 80),
    };
  }

  // ── 收藏切换 ─────────────────────────────────────────────────────────────────

  async getImageConversation(userId: string, imageId: string) {
    const image = await this.assertOwner(imageId, userId);
    const rootImageId = image.rootImageId || image.id;
    const [messages, versions] = await Promise.all([
      this.prisma.imageEditMessage.findMany({
        where: { userId, rootImageId },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.generatedImage.findMany({
        where: {
          userId,
          OR: [{ id: rootImageId }, { rootImageId }],
        },
        orderBy: { createdAt: 'asc' },
        select: this.generatedImageResponseSelect(),
      }),
    ]);

    const cumulativeEstimatedCostUsd = Number(
      versions.reduce((sum, item) => sum + (item.estimatedCostUsd ?? 0), 0).toFixed(6),
    );

    return {
      rootImageId,
      currentImageId: image.id,
      summary: {
        versionCount: versions.length,
        editCount: Math.max(0, versions.length - 1),
        estimatedCostUsd: cumulativeEstimatedCostUsd,
      },
      versions: versions.map((item) => this.toResponse(item)),
      messages: messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        model: message.model,
        requestId: message.requestId,
        sourceImageId: message.sourceImageId,
        resultImageId: message.resultImageId,
        inputTokens: message.inputTokens,
        inputTextTokens: message.inputTextTokens,
        inputImageTokens: message.inputImageTokens,
        outputTokens: message.outputTokens,
        totalTokens: message.totalTokens,
        estimatedCostUsd: message.estimatedCostUsd,
        cumulativeEstimatedCostUsd: message.cumulativeEstimatedCostUsd,
        meta: message.meta,
        createdAt: message.createdAt.toISOString(),
      })),
    };
  }

  async editImage(userId: string, imageId: string, dto: EditImageDto) {
    const source = await this.assertOwner(imageId, userId);
    const instruction = dto.message.trim();
    if (!instruction) {
      throw new BadRequestException('请先输入图片修改要求');
    }

    const rootImageId = source.rootImageId || source.id;
    const requestId = randomUUID();
    const style = dto.style ?? this.normalizeStoredStyle(source.style);
    const size = dto.size ?? this.normalizeStoredSize(source.size);
    const requestedModel = dto.model?.trim() || source.model || DEFAULT_IMAGE_TO_IMAGE_MODEL;
    const recentMessagesDesc = await this.prisma.imageEditMessage.findMany({
      where: { userId, rootImageId },
      orderBy: { createdAt: 'desc' },
      take: 24,
    });
    const recentMessages = recentMessagesDesc.reverse();
    const composedPrompt = this.buildImageEditPrompt(source, instruction, recentMessages);
    const userMessage = await this.prisma.imageEditMessage.create({
      data: {
        userId,
        rootImageId,
        sourceImageId: source.id,
        role: 'user',
        content: instruction,
        meta: {
          currentImageId: source.id,
          contextMessageCount: recentMessages.length,
        } as Prisma.InputJsonValue,
      },
    });

    try {
      const { apiKey, baseUrl, model } = await this.resolveOpenAiCredentials(dto.model_id, requestedModel);
      if (!apiKey) {
        throw new BadRequestException('未配置可用的 OpenAI API Key，请在 AI 模型管理中添加 OpenAI 类型的配置');
      }

      const effectiveModel = this.supportsImageEdit(model) ? model : DEFAULT_IMAGE_TO_IMAGE_MODEL;
      this.assertPromptLength(composedPrompt, effectiveModel);
      const referenceImageDataList = this.getReferenceImageDataList(dto.reference_image_data, undefined);
      if (referenceImageDataList.length === 0) {
        referenceImageDataList.push(source.imageData);
      }
      const referenceImageInfo = this.getReferenceImagesInfo(referenceImageDataList);
      const client = new OpenAI({
        apiKey,
        ...(baseUrl ? { baseURL: baseUrl } : {}),
        defaultHeaders: { 'X-Inogi-Image-Request-Id': requestId },
        timeout: this.getImageRequestTimeoutMs(),
        // 同 generate：禁用 SDK 自动重试，避免上游挂起时静默把等待/费用放大，失败快速暴露真实错误。
        maxRetries: 0,
      });
      const { imageData, revisedPrompt, usageSummary } = await this.generateWithOpenAi(client, {
        prompt: composedPrompt,
        style,
        size,
        quality: undefined,
        model: effectiveModel,
        referenceImageDataList,
      }, {
        userId,
        requestId,
        baseUrlHost: this.getUrlHost(baseUrl),
        referenceImageCount: referenceImageInfo.count,
        referenceImageBytes: referenceImageInfo.bytes,
        referenceImageMimeType: referenceImageInfo.mimeType,
        referenceImageMimeTypes: referenceImageInfo.mimeTypes,
      });
      const sourceCumulative = this.getImageCumulativeCost(source);
      const cumulativeEstimatedCostUsd = Number((sourceCumulative + usageSummary.estimatedCostUsd).toFixed(6));

      const saved = await this.prisma.generatedImage.create({
        data: {
          userId,
          prompt: instruction,
          revisedPrompt,
          style,
          size,
          quality: 'auto',
          imageData,
          model: effectiveModel,
          requestId,
          parentImageId: source.id,
          rootImageId,
          editInstruction: instruction,
          editDepth: (source.editDepth ?? 0) + 1,
          upstreamCallCount: usageSummary.upstreamCallCount,
          upstreamRetryCount: usageSummary.upstreamRetryCount,
          upstreamErrorCount: usageSummary.upstreamErrorCount,
          inputTokens: usageSummary.inputTokens,
          inputTextTokens: usageSummary.inputTextTokens,
          inputImageTokens: usageSummary.inputImageTokens,
          outputTokens: usageSummary.outputTokens,
          totalTokens: usageSummary.totalTokens,
          estimatedCostUsd: usageSummary.estimatedCostUsd,
          cumulativeEstimatedCostUsd,
          usageDetails: {
            calls: usageSummary.details,
            sourceImageId: source.id,
            rootImageId,
            userMessageId: userMessage.id,
            userInstruction: instruction,
            contextMessageCount: recentMessages.length,
          } as Prisma.InputJsonValue,
        },
      });
      // 上传编辑结果到 OSS：异步进行，不阻塞任务完成（同 generate，避免 OSS 挂起把轮询任务卡死）
      void this.uploadAndSaveImageUrl(saved.id, imageData);

      await this.prisma.imageEditMessage.create({
        data: {
          userId,
          rootImageId,
          sourceImageId: source.id,
          resultImageId: saved.id,
          role: 'assistant',
          content: revisedPrompt || '已根据当前图片和上下文生成新的图片版本。',
          model: effectiveModel,
          requestId,
          inputTokens: usageSummary.inputTokens,
          inputTextTokens: usageSummary.inputTextTokens,
          inputImageTokens: usageSummary.inputImageTokens,
          outputTokens: usageSummary.outputTokens,
          totalTokens: usageSummary.totalTokens,
          estimatedCostUsd: usageSummary.estimatedCostUsd,
          cumulativeEstimatedCostUsd,
          meta: {
            status: 'success',
            generatedImageId: saved.id,
            parentImageId: source.id,
          } as Prisma.InputJsonValue,
        },
      });

      return {
        ...this.toResponse(saved),
        fromCache: false,
        similarity: 0,
        conversation: await this.getImageConversation(userId, saved.id),
      };
    } catch (error) {
      const message = this.getErrorMessage(error);
      await this.prisma.imageEditMessage.create({
        data: {
          userId,
          rootImageId,
          sourceImageId: source.id,
          role: 'assistant',
          content: `图片修改失败：${message}`,
          requestId,
          meta: {
            status: 'error',
            parentImageId: source.id,
            userMessageId: userMessage.id,
            errorMessage: message,
          } as Prisma.InputJsonValue,
        },
      });

      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(`Image edit failed: ${message}`, error instanceof Error ? error.stack : undefined);
      throw new BadRequestException(`图片修改失败：${message}`);
    }
  }

  async toggleFavorite(id: string, userId: string) {
    const img = await this.assertOwner(id, userId);
    return this.prisma.generatedImage.update({
      where: { id },
      data: { isFavorite: !img.isFavorite },
      select: { id: true, isFavorite: true },
    });
  }

  /**
   * 按图片 id 取可对外访问的 URL（视频生成 i2v/r2v 的来源图用）。
   * 优先返回 OSS 签名 URL；OSS 未启用时回退到 base64 data URL（DashScope url 字段接受 base64）。
   */
  async getShareableImageUrl(userId: string, imageId: string): Promise<string | null> {
    const img = await this.prisma.generatedImage.findFirst({
      where: { id: imageId, userId },
      select: { imageUrl: true, imageData: true },
    });
    if (!img) return null;
    if (img.imageUrl && this.ossService.isEnabled) {
      // 签 2h：覆盖「确认卡 TTL(30min) + 上游异步拉取延迟」窗口，避免边界过期导致上游拉取失败
      const signed = this.ossService.getSignedUrl(img.imageUrl, 7200);
      if (signed) return signed;
    }
    return img.imageData || null;
  }

  // ── 删除 ─────────────────────────────────────────────────────────────────────

  async deleteImage(id: string, userId: string) {
    await this.assertOwner(id, userId);
    await this.prisma.generatedImage.delete({ where: { id } });
    return { ok: true };
  }

  // ── 作品库分类（全局共享目录）────────────────────────────────────────────────

  /**
   * 分类树。imageCount 是「当前用户」直接挂在该节点上的作品数，totalImageCount 含子孙节点——
   * 分类目录全局共享但作品按 userId 隔离，计数必须同口径，否则前端筛选出的数量对不上。
   */
  async listCategories(userId: string) {
    const [categories, grouped, uncategorizedCount, totalCount] = await Promise.all([
      this.prisma.imageCategory.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.generatedImage.groupBy({
        by: ['categoryId'],
        where: { userId, categoryId: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.generatedImage.count({ where: { userId, categoryId: null } }),
      this.prisma.generatedImage.count({ where: { userId } }),
    ]);

    const counts = new Map(grouped.map((row) => [row.categoryId, row._count._all]));
    return {
      items: this.buildCategoryTree(categories, counts),
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

    // 与 updateCategory 同样锁表后再校验写入，堵住两处并发缺口：
    // 1) 「在 X 下建子分类」与「把 X 往下移」并发时，各自读到的都是移动前的层号，
    //    双双通过 3 层校验，写完就超层；
    // 2) 根分类重名——Postgres 里 NULL 互不相等，@@unique([parentId, name]) 管不到
    //    parentId 为 null 的那一层，只能靠这里的串行化 + 查重兜住。
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ImageCategory" FOR UPDATE`;

      if (parentId) {
        const categories = await tx.imageCategory.findMany({ select: { id: true, parentId: true } });
        const parent = categories.find((item) => item.id === parentId);
        if (!parent) throw new NotFoundException('父分类不存在');
        // 父节点已经在第 MAX 层时，新建的子节点就会越界
        if (this.categoryDepth(parentId, categories) >= MAX_CATEGORY_DEPTH) {
          throw new BadRequestException(`分类最多 ${MAX_CATEGORY_DEPTH} 层`);
        }
      }
      await this.assertCategoryNameAvailable(name, parentId, undefined, tx);

      // 排序号在同级内递增，避免新建的子分类窜到别的父节点下面去排
      const maxSortOrder = await tx.imageCategory.aggregate({
        where: { parentId },
        _max: { sortOrder: true },
      });
      return tx.imageCategory.create({
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
    dto: {
      name?: string;
      parentId?: string | null;
      description?: string;
      color?: string;
      sortOrder?: number;
    },
  ) {
    // 整段放进事务并先锁住分类表：移动校验要读全量父子关系，不加锁时两个并发移动
    // （A 移到 B 下、B 移到 A 下）会各自读到"移动前"快照、双双通过环检测，写出一个
    // 谁也修不了的环——成环节点在 buildCategoryTree 里从根不可达，会直接从界面上消失。
    // 分类目录只有寥寥数行，锁全表的代价可以忽略。
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ImageCategory" FOR UPDATE`;

      const current = await this.assertCategoryExists(id, tx);
      const data: Prisma.ImageCategoryUncheckedUpdateInput = {};
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

      return tx.imageCategory.update({ where: { id }, data });
    });
  }

  /**
   * 删除分类及其整棵子树（DB 侧 onDelete: Cascade）。分类是全局目录、作品按人隔离，
   * 所以不能只看当前用户的作品数就判空：作品一律保留，只是被 SetNull 解绑成未分类。
   */
  async deleteCategory(id: string) {
    await this.assertCategoryExists(id);
    const categories = await this.prisma.imageCategory.findMany({ select: { id: true, parentId: true } });
    const affectedIds = this.collectSubtreeIds(id, categories);
    const detached = await this.prisma.generatedImage.count({ where: { categoryId: { in: affectedIds } } });
    await this.prisma.imageCategory.delete({ where: { id } });
    return {
      ok: true,
      detachedImageCount: detached,
      deletedCategoryCount: affectedIds.length,
      deletedCategoryIds: affectedIds,
    };
  }

  /** 设置 / 清除单张图片的分类归属；仅图片所有者可操作。 */
  async assignImageCategory(userId: string, imageId: string, categoryId?: string | null) {
    await this.assertOwner(imageId, userId);
    const target = categoryId?.trim() || null;
    if (target) await this.assertCategoryExists(target);

    return this.prisma.generatedImage.update({
      where: { id: imageId },
      data: { categoryId: target },
      select: { id: true, categoryId: true },
    });
  }

  private async assertCategoryExists(id: string, client: CategoryDbClient = this.prisma) {
    const category = await client.imageCategory.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('分类不存在');
    return category;
  }

  private async assertCategoryNameAvailable(
    name: string,
    parentId: string | null,
    excludeId?: string,
    client: CategoryDbClient = this.prisma,
  ) {
    const existing = await client.imageCategory.findFirst({
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

    const categories = await client.imageCategory.findMany({ select: { id: true, parentId: true } });
    if (!categories.some((item) => item.id === targetParentId)) {
      throw new NotFoundException('父分类不存在');
    }
    if (this.collectSubtreeIds(id, categories).includes(targetParentId)) {
      throw new BadRequestException('不能把分类移动到自己的子分类下面');
    }

    const parentDepth = this.categoryDepth(targetParentId, categories);
    const subtreeHeight = this.subtreeHeight(id, categories);
    if (parentDepth + subtreeHeight > MAX_CATEGORY_DEPTH) {
      throw new BadRequestException(`分类最多 ${MAX_CATEGORY_DEPTH} 层`);
    }
  }

  /** 节点自身的层号，根为 1。 */
  private categoryDepth(id: string, categories: Array<{ id: string; parentId: string | null }>): number {
    const byId = new Map(categories.map((item) => [item.id, item]));
    let depth = 1;
    let cursor = byId.get(id)?.parentId ?? null;
    // 上限兜底：数据异常成环时不至于死循环
    while (cursor && depth <= MAX_CATEGORY_DEPTH + 1) {
      depth += 1;
      cursor = byId.get(cursor)?.parentId ?? null;
    }
    return depth;
  }

  /**
   * 子树自身的高度（只有自己 = 1）。
   * visited 是防环保护：父子关系一旦成环（并发移动的历史遗留数据），没有它这里会无限
   * 互递归到爆栈，把接口打成 500。同文件的 categoryDepth / collectSubtreeIds 同样做了防护。
   */
  private subtreeHeight(
    id: string,
    categories: Array<{ id: string; parentId: string | null }>,
    visited: Set<string> = new Set(),
  ): number {
    if (visited.has(id)) return 1;
    visited.add(id);
    const children = categories.filter((item) => item.parentId === id);
    if (children.length === 0) return 1;
    return 1 + Math.max(...children.map((child) => this.subtreeHeight(child.id, categories, visited)));
  }

  /** 自己 + 所有子孙的 id。 */
  private collectSubtreeIds(id: string, categories: Array<{ id: string; parentId: string | null }>): string[] {
    const ids = [id];
    for (let cursor = 0; cursor < ids.length; cursor += 1) {
      for (const item of categories) {
        if (item.parentId === ids[cursor] && !ids.includes(item.id)) ids.push(item.id);
      }
    }
    return ids;
  }

  /** 平铺记录 → 嵌套树，同时把直接计数汇总成含子孙的 totalImageCount。 */
  private buildCategoryTree(
    categories: Array<Prisma.ImageCategoryGetPayload<Record<string, never>>>,
    counts: Map<string | null, number>,
  ) {
    type CategoryNode = (typeof categories)[number] & {
      imageCount: number;
      totalImageCount: number;
      depth: number;
      path: string;
      children: CategoryNode[];
    };

    const byParent = new Map<string | null, typeof categories>();
    for (const category of categories) {
      const siblings = byParent.get(category.parentId) ?? [];
      siblings.push(category);
      byParent.set(category.parentId, siblings);
    }

    const build = (parentId: string | null, depth: number, parentPath: string): CategoryNode[] =>
      (byParent.get(parentId) ?? []).map((category) => {
        const path = parentPath ? `${parentPath} / ${category.name}` : category.name;
        const children = build(category.id, depth + 1, path);
        const imageCount = counts.get(category.id) ?? 0;
        return {
          ...category,
          imageCount,
          totalImageCount: children.reduce((sum, child) => sum + child.totalImageCount, imageCount),
          depth,
          path,
          children,
        };
      });

    return build(null, 1, '');
  }

  // ── 私有方法 ─────────────────────────────────────────────────────────────────

  private async assertOwner(id: string, userId: string) {
    const img = await this.prisma.generatedImage.findUnique({ where: { id } });
    if (!img) throw new NotFoundException('图片不存在');
    if (img.userId !== userId) throw new ForbiddenException();
    return img;
  }

  /**
   * 将 base64 imageData 上传到 OSS，将 objectKey 存入 DB 的 imageUrl 字段，返回签名 URL（失败返回 null）。
   * DB 中存 objectKey（非 URL），通过 getSignedUrl 在响应层按需生成可访问链接。
   */
  private async uploadAndSaveImageUrl(id: string, imageData: string): Promise<string | null> {
    if (!this.ossService.isEnabled) return null;
    try {
      const match = imageData.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/i);
      if (!match) return null;
      const mimeType = match[1].toLowerCase();
      const ext = mimeType === 'image/png' ? '.png' : mimeType === 'image/webp' ? '.webp' : '.jpg';
      const buffer = Buffer.from(match[2], 'base64');
      const objectKey = await this.ossService.uploadBuffer(buffer, 'images/generated', `${id}${ext}`, mimeType);
      if (objectKey) {
        try {
          await this.prisma.generatedImage.update({ where: { id }, data: { imageUrl: objectKey } });
        } catch (error) {
          await this.ossService.deleteObject(objectKey);
          throw error;
        }
      }
      return objectKey ? this.ossService.getSignedUrl(objectKey, 600) : null;
    } catch (err) {
      this.logger.warn(`uploadAndSaveImageUrl failed for ${id}: ${this.getErrorMessage(err)}`);
      return null;
    }
  }

  private generatedImageResponseSelect() {
    return {
      id: true,
      prompt: true,
      revisedPrompt: true,
      style: true,
      size: true,
      quality: true,
      imageData: true,
      imageUrl: true,
      model: true,
      isFavorite: true,
      requestId: true,
      parentImageId: true,
      rootImageId: true,
      editInstruction: true,
      editDepth: true,
      upstreamCallCount: true,
      upstreamRetryCount: true,
      upstreamErrorCount: true,
      inputTokens: true,
      inputTextTokens: true,
      inputImageTokens: true,
      outputTokens: true,
      totalTokens: true,
      estimatedCostUsd: true,
      cumulativeEstimatedCostUsd: true,
      usageDetails: true,
      createdAt: true,
    } as const;
  }

  private normalizeStoredStyle(value: string): 'vivid' | 'natural' {
    return value === 'natural' ? 'natural' : 'vivid';
  }

  private normalizeStoredSize(value: string): '1024x1024' | '1792x1024' | '1024x1792' {
    if (value === '1792x1024' || value === '1024x1792') return value;
    return '1024x1024';
  }

  private getImageCumulativeCost(image: { estimatedCostUsd?: number | null; cumulativeEstimatedCostUsd?: number | null }) {
    const cumulative = image.cumulativeEstimatedCostUsd ?? 0;
    if (cumulative > 0) return cumulative;
    return image.estimatedCostUsd ?? 0;
  }

  private toPromptSessionResponse(session: {
    id: string;
    title: string;
    sourcePrompt: string;
    currentPrompt: string;
    model: string | null;
    createdAt: Date;
    updatedAt: Date;
    _count?: { messages: number };
  }) {
    return {
      id: session.id,
      title: session.title,
      sourcePrompt: session.sourcePrompt,
      currentPrompt: session.currentPrompt,
      model: session.model,
      messageCount: session._count?.messages ?? 0,
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
    };
  }

  private toPromptMessageResponse(message: {
    id: string;
    role: string;
    content: string;
    optimizedPrompt: string;
    model: string | null;
    requestId: string | null;
    createdAt: Date;
  }) {
    return {
      id: message.id,
      role: message.role,
      content: message.content,
      optimizedPrompt: message.optimizedPrompt,
      model: message.model,
      requestId: message.requestId,
      createdAt: message.createdAt.toISOString(),
    };
  }

  private buildPromptSessionTitle(seed: string) {
    const normalized = seed.replace(/\s+/g, ' ').trim();
    if (!normalized) return '新提示词对话';
    return normalized.length > 40 ? `${normalized.slice(0, 40)}...` : normalized;
  }

  private parsePromptChatResponse(content: string, fallbackPrompt: string) {
    try {
      const parsed = JSON.parse(content) as Record<string, unknown>;
      const reply = typeof parsed.reply === 'string' && parsed.reply.trim()
        ? parsed.reply.trim()
        : '已根据你的要求优化提示词。';
      const optimizedPrompt =
        typeof parsed.optimized_prompt === 'string' && parsed.optimized_prompt.trim()
          ? parsed.optimized_prompt.trim()
          : typeof parsed.optimizedPrompt === 'string' && parsed.optimizedPrompt.trim()
            ? parsed.optimizedPrompt.trim()
            : fallbackPrompt;
      return { reply, optimizedPrompt };
    } catch {
      const normalized = content.trim();
      return {
        reply: normalized ? '已完成优化，下面是可直接使用的提示词。' : '已根据你的要求优化提示词。',
        optimizedPrompt: normalized || fallbackPrompt,
      };
    }
  }

  private buildImageEditPrompt(
    source: { prompt: string; revisedPrompt: string; editInstruction?: string | null },
    instruction: string,
    messages: Array<{ role: string; content: string }>,
  ) {
    const sourcePrompt = source.revisedPrompt || source.prompt;
    const context = messages
      .slice(-16)
      .map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content}`)
      .join('\n');

    return [
      'Edit the attached image. Preserve the same main subject, identity, layout, and visual continuity unless the user explicitly asks to change them.',
      'Use the conversation context to resolve references such as "this", "that", "the current image", "previous version", and similar follow-up wording.',
      sourcePrompt ? `Original or current image prompt:\n${sourcePrompt}` : '',
      context ? `Conversation context:\n${context}` : '',
      `Current user edit request:\n${instruction}`,
      'Return only the edited image. Do not add visible text, captions, labels, watermarks, or UI annotations unless the user explicitly requests them.',
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  private buildUtcUsageWindow(date?: string) {
    const parsedDate = date?.trim() ? new Date(`${date.trim()}T00:00:00.000Z`) : new Date();
    const start = Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate;
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    return {
      start,
      end,
      dateKey: start.toISOString().slice(0, 10),
    };
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  }

  private asString(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private asNumber(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  private getReferenceImageDataList(single?: string, list?: string[]) {
    const values = [
      ...(Array.isArray(list) ? list : []),
      ...(single?.trim() ? [single] : []),
    ]
      .map((item) => item.trim())
      .filter(Boolean);
    return Array.from(new Set(values)).slice(0, 16);
  }

  private getReferenceImagesInfo(values: string[]) {
    const details = values.map((value) => this.getReferenceImageInfo(value));
    const mimeTypes = details
      .map((item) => item.mimeType)
      .filter((item): item is string => Boolean(item));
    return {
      count: values.length,
      bytes: details.reduce((sum, item) => sum + item.bytes, 0),
      mimeType: mimeTypes.length === 1 ? mimeTypes[0] : mimeTypes.length > 1 ? 'multiple' : null,
      mimeTypes,
    };
  }

  private getReferenceImageInfo(value?: string) {
    if (!value?.trim()) return { bytes: 0, mimeType: null as string | null };
    const match = value.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/i);
    if (!match) return { bytes: 0, mimeType: null as string | null };

    const base64 = match[2];
    const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
    return {
      bytes: Math.max(0, Math.floor((base64.length * 3) / 4) - padding),
      mimeType: match[1].toLowerCase().replace('image/jpg', 'image/jpeg'),
    };
  }

  private getUrlHost(value?: string) {
    if (!value?.trim()) return null;
    try {
      return new URL(value).host;
    } catch {
      return 'invalid-url';
    }
  }

  private getErrorMessage(error: unknown) {
    const nestedMessage = this.getNestedErrorMessage(error);
    if (error instanceof Error && error.message) {
      const message = error.message.trim();
      if (nestedMessage && this.isGenericBadRequestMessage(message)) {
        return nestedMessage;
      }
      return nestedMessage ? `${message}: ${nestedMessage}` : message;
    }
    if (typeof error === 'string' && error.trim()) {
      return error.trim();
    }
    if (nestedMessage) {
      return nestedMessage;
    }
    return '未知错误';
  }

  private getNestedErrorMessage(error: unknown): string | null {
    if (!error || typeof error !== 'object') return null;

    const record = error as Record<string, unknown>;
    const response = record.response && typeof record.response === 'object'
      ? (record.response as Record<string, unknown>)
      : null;
    const data = response?.data && typeof response.data === 'object'
      ? (response.data as Record<string, unknown>)
      : null;
    const nestedError = record.error && typeof record.error === 'object'
      ? (record.error as Record<string, unknown>)
      : null;
    const dataError = data?.error && typeof data.error === 'object'
      ? (data.error as Record<string, unknown>)
      : null;

    return (
      this.formatErrorMessageValue(data?.message) ??
      this.formatErrorMessageValue(dataError?.message) ??
      this.formatErrorMessageValue(nestedError?.message) ??
      null
    );
  }

  private formatErrorMessageValue(value: unknown): string | null {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    if (Array.isArray(value)) {
      const parts = value
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean);
      return parts.length > 0 ? parts.join('; ') : null;
    }
    return null;
  }

  private isGenericBadRequestMessage(message: string) {
    const normalized = message.toLowerCase();
    return normalized === 'bad request' || normalized === '400 bad request';
  }

  /**
   * 分类筛选：空 = 不限；'uncategorized' = 仅未归类；其余选中节点连同其子孙分类一起查
   * （父分类要能看到子分类下的作品，与侧边树上「含子分类」的计数口径保持一致）。
   */
  private async buildCategoryFilter(categoryId?: string): Promise<Prisma.GeneratedImageWhereInput> {
    const value = categoryId?.trim();
    if (!value) return {};
    if (value === UNCATEGORIZED_FILTER) return { categoryId: null };

    const categories = await this.prisma.imageCategory.findMany({ select: { id: true, parentId: true } });
    const ids = this.collectSubtreeIds(value, categories);
    return ids.length > 1 ? { categoryId: { in: ids } } : { categoryId: value };
  }

  private buildCreatedAtFilter(dateFrom?: string, dateTo?: string) {
    const createdAt: { gte?: Date; lt?: Date } = {};
    const from = this.parseDate(dateFrom);
    const to = this.parseDate(dateTo);
    if (from) createdAt.gte = from;
    if (to) createdAt.lt = to;
    return Object.keys(createdAt).length > 0 ? { createdAt } : {};
  }

  private buildImageSearchFilter(query?: string): Prisma.GeneratedImageWhereInput {
    const keyword = query?.trim().replace(/\s+/g, ' ').slice(0, 120);
    if (!keyword) return {};
    const terms = [...new Set(keyword.split(/[\s,，。;；、]+/).map((item) => item.trim()).filter(Boolean))].slice(0, 6);

    const buildTermFilter = (term: string): Prisma.GeneratedImageWhereInput => {
      const contains = { contains: term, mode: 'insensitive' as const };
      return {
        OR: [
          { prompt: contains },
          { revisedPrompt: contains },
          { model: contains },
          { style: contains },
          { size: contains },
          { quality: contains },
          { editInstruction: contains },
          { requestId: contains },
        ],
      };
    };

    return { AND: terms.map(buildTermFilter) };
  }

  private parseDate(value?: string) {
    if (!value?.trim()) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private async findCachedImage(prompt: string, style: string, size: string, quality: string, model: string) {
    const candidates = await this.prisma.generatedImage.findMany({
      where: { style, size, quality, model },
      orderBy: [{ isFavorite: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    });

    let best: (typeof candidates[0] & { _similarity: number }) | null = null;
    for (const img of candidates) {
      const sim = this.jaccardSimilarity(prompt, img.prompt);
      if (sim >= CACHE_SIMILARITY_THRESHOLD) {
        if (!best || sim > best._similarity) {
          best = { ...img, _similarity: sim };
        }
      }
    }
    return best;
  }

  private jaccardSimilarity(a: string, b: string): number {
    const tokenize = (s: string) =>
      new Set(
        s
          .toLowerCase()
          .replace(/[^\w一-龥]/g, ' ')
          .split(/\s+/)
          .filter((t) => t.length >= 2),
      );
    const s1 = tokenize(a);
    const s2 = tokenize(b);
    if (s1.size === 0 && s2.size === 0) return 1;
    if (s1.size === 0 || s2.size === 0) return 0;
    let intersection = 0;
    s1.forEach((t) => { if (s2.has(t)) intersection++; });
    return intersection / (s1.size + s2.size - intersection);
  }

  private async generateWithOpenAi(
    client: OpenAI,
    options: {
      prompt: string;
      style: 'vivid' | 'natural';
      size: '1024x1024' | '1792x1024' | '1024x1792';
      quality?: ImageQuality;
      model: string;
      referenceImageDataList?: string[];
    },
    auditBase: ImageGenerationAuditBase,
  ): Promise<ImageGenerationResult> {
    let activeAuditContext: ImageRequestAuditContext | null = null;
    let activeStartedAt = 0;
    const upstreamCalls: ImageUpstreamCallRecord[] = [];
    try {
      const referenceImageDataList = this.getReferenceImageDataList(undefined, options.referenceImageDataList);
      this.assertReferenceImageCount(referenceImageDataList, options.model);
      if (referenceImageDataList.length > 0) {
        const imageFiles = await this.createReferenceImageFiles(referenceImageDataList);
        const normalizedSize = this.normalizeSizeForModel(options.size, options.model);
        const normalizedQuality = this.normalizeQualityForModel(options.quality, options.model, true);
        activeAuditContext = this.buildImageRequestAuditContext(auditBase, options, {
          operation: 'edit',
          compatibilityMode: 'native',
          attempt: 1,
          normalizedSize,
          normalizedQuality,
        });
        activeStartedAt = Date.now();
        const response = await client.images.edit({
          model: options.model,
          image: imageFiles.length === 1 ? imageFiles[0] : imageFiles,
          prompt: options.prompt,
          n: 1,
          size: normalizedSize,
          ...this.buildImageQualityOption(options.quality, options.model, true),
          ...this.buildImageEditOptions(options.model),
        } as OpenAI.Images.ImageEditParamsNonStreaming);
        upstreamCalls.push(await this.recordImageUpstreamAudit(activeAuditContext, 'success', Date.now() - activeStartedAt, response));
        const result = await this.readImageResponse(response, options.prompt);
        return { ...result, usageSummary: this.summarizeImageUsage(upstreamCalls) };
      }

      const normalizedSize = this.normalizeSizeForModel(options.size, options.model);
      const normalizedQuality = this.normalizeQualityForModel(options.quality, options.model, false);
      activeAuditContext = this.buildImageRequestAuditContext(auditBase, options, {
        operation: 'generate',
        compatibilityMode: 'native',
        attempt: 1,
        normalizedSize,
        normalizedQuality,
      });
      activeStartedAt = Date.now();
      const response = await client.images.generate({
        model: options.model,
        prompt: options.prompt,
        n: 1,
        size: normalizedSize,
        ...this.buildImageQualityOption(options.quality, options.model, false),
        ...(options.model === 'dall-e-3' ? { style: options.style } : {}),
        ...this.buildImageGenerateOptions(options.model),
      } as OpenAI.Images.ImageGenerateParamsNonStreaming);
      upstreamCalls.push(await this.recordImageUpstreamAudit(activeAuditContext, 'success', Date.now() - activeStartedAt, response));
      const result = await this.readImageResponse(response, options.prompt);
      return { ...result, usageSummary: this.summarizeImageUsage(upstreamCalls) };
    } catch (err) {
      if (activeAuditContext) {
        upstreamCalls.push(await this.recordImageUpstreamAudit(activeAuditContext, 'error', Date.now() - activeStartedAt, undefined, err));
      }
      if (!this.shouldRetryWithDallECompatibleQuality(err, options.model, options.quality)) {
        throw err;
      }

      const originalMessage = this.getErrorMessage(err);
      this.logger.warn(
        `Retrying image generation with DALL-E-compatible quality because upstream rejected GPT Image quality: ${originalMessage}`,
      );

      try {
        return await this.requestOpenAiImageWithQualityCompatibility(client, options, auditBase, upstreamCalls);
      } catch (fallbackErr) {
        const fallbackMessage = this.getErrorMessage(fallbackErr);
        throw new BadRequestException(
          `图片生成失败：上游模型不兼容质量参数。首次错误：${originalMessage}；兼容重试错误：${fallbackMessage}`,
        );
      }
    }
  }

  private async requestOpenAiImageWithQualityCompatibility(
    client: OpenAI,
    options: {
      prompt: string;
      style: 'vivid' | 'natural';
      size: '1024x1024' | '1792x1024' | '1024x1792';
      quality?: ImageQuality;
      model: string;
      referenceImageDataList?: string[];
    },
    auditBase: ImageGenerationAuditBase,
    upstreamCalls: ImageUpstreamCallRecord[],
  ): Promise<ImageGenerationResult> {
    let activeAuditContext: ImageRequestAuditContext | null = null;
    let activeStartedAt = 0;
    try {
    const referenceImageDataList = this.getReferenceImageDataList(undefined, options.referenceImageDataList);
    this.assertReferenceImageCount(referenceImageDataList, options.model);
    if (referenceImageDataList.length > 0) {
      const imageFiles = await this.createReferenceImageFiles(referenceImageDataList);
      const normalizedSize = this.normalizeSizeForModel(options.size, options.model);
      const normalizedQuality = this.normalizeQualityForModel(options.quality, options.model, true, 'dall-e-compatible');
      const auditContext = this.buildImageRequestAuditContext(auditBase, options, {
        operation: 'edit',
        compatibilityMode: 'dall-e-compatible',
        attempt: 2,
        normalizedSize,
        normalizedQuality,
      });
      activeAuditContext = auditContext;
      activeStartedAt = Date.now();
      const response = await client.images.edit({
        model: options.model,
        image: imageFiles.length === 1 ? imageFiles[0] : imageFiles,
        prompt: options.prompt,
        n: 1,
        size: normalizedSize,
        ...this.buildImageQualityOption(options.quality, options.model, true, 'dall-e-compatible'),
        ...this.buildImageEditOptions(options.model),
      } as OpenAI.Images.ImageEditParamsNonStreaming);
      upstreamCalls.push(await this.recordImageUpstreamAudit(auditContext, 'success', Date.now() - activeStartedAt, response));
      const result = await this.readImageResponse(response, options.prompt);
      return { ...result, usageSummary: this.summarizeImageUsage(upstreamCalls) };
    }

    const normalizedSize = this.normalizeSizeForModel(options.size, options.model);
    const normalizedQuality = this.normalizeQualityForModel(options.quality, options.model, false, 'dall-e-compatible');
    const auditContext = this.buildImageRequestAuditContext(auditBase, options, {
      operation: 'generate',
      compatibilityMode: 'dall-e-compatible',
      attempt: 2,
      normalizedSize,
      normalizedQuality,
    });
    activeAuditContext = auditContext;
    activeStartedAt = Date.now();
    const response = await client.images.generate({
      model: options.model,
      prompt: options.prompt,
      n: 1,
      size: normalizedSize,
      ...this.buildImageQualityOption(options.quality, options.model, false, 'dall-e-compatible'),
      ...(options.model === 'dall-e-3' ? { style: options.style } : {}),
      ...this.buildImageGenerateOptions(options.model),
    } as OpenAI.Images.ImageGenerateParamsNonStreaming);
    upstreamCalls.push(await this.recordImageUpstreamAudit(auditContext, 'success', Date.now() - activeStartedAt, response));
    const result = await this.readImageResponse(response, options.prompt);
    return { ...result, usageSummary: this.summarizeImageUsage(upstreamCalls) };
    } catch (err) {
      if (activeAuditContext) {
        upstreamCalls.push(await this.recordImageUpstreamAudit(activeAuditContext, 'error', Date.now() - activeStartedAt, undefined, err));
      }
      throw err;
    }
  }

  private buildImageRequestAuditContext(
    auditBase: ImageGenerationAuditBase,
    options: {
      prompt: string;
      size: string;
      quality?: ImageQuality;
      model: string;
      referenceImageDataList?: string[];
    },
    call: {
      operation: ImageOperation;
      compatibilityMode: QualityCompatibilityMode;
      attempt: number;
      normalizedSize: string;
      normalizedQuality?: string;
    },
  ): ImageRequestAuditContext {
    return {
      userId: auditBase.userId,
      requestId: auditBase.requestId,
      operation: call.operation,
      model: options.model,
      baseUrlHost: auditBase.baseUrlHost,
      promptLength: options.prompt.length,
      requestedSize: options.size,
      normalizedSize: call.normalizedSize,
      requestedQuality: options.quality,
      normalizedQuality: call.normalizedQuality,
      hasReferenceImage: auditBase.referenceImageCount > 0,
      referenceImageCount: auditBase.referenceImageCount,
      referenceImageBytes: auditBase.referenceImageBytes,
      referenceImageMimeType: auditBase.referenceImageMimeType,
      referenceImageMimeTypes: auditBase.referenceImageMimeTypes,
      compatibilityMode: call.compatibilityMode,
      attempt: call.attempt,
    };
  }

  private async recordImageUpstreamAudit(
    context: ImageRequestAuditContext,
    status: 'success' | 'error',
    durationMs: number,
    response?: OpenAI.Images.ImagesResponse,
    error?: unknown,
  ): Promise<ImageUpstreamCallRecord> {
    const usage = response ? this.extractImageUsage(response) : null;
    const openaiRequestId = this.getOpenAiRequestId(response ?? error);
    const errorMessage = error ? this.getErrorMessage(error) : null;
    const record: ImageUpstreamCallRecord = {
      status,
      operation: context.operation,
      attempt: context.attempt,
      durationMs,
      normalizedSize: context.normalizedSize,
      normalizedQuality: context.normalizedQuality ?? null,
      usage,
      openaiRequestId,
      errorMessage,
    };
    const meta = {
      ...context,
      requestedQuality: context.requestedQuality ?? null,
      normalizedQuality: context.normalizedQuality ?? null,
      baseUrlHost: context.baseUrlHost ?? null,
      referenceImageMimeType: context.referenceImageMimeType ?? null,
      referenceImageMimeTypes: context.referenceImageMimeTypes,
      status,
      durationMs,
      usage,
      openaiRequestId,
      errorMessage,
    };

    try {
      await this.prisma.auditLog.create({
        data: {
          userId: context.userId,
          action: 'OPENAI_IMAGE_REQUEST',
          resource: 'image_generation_upstream',
          resourceId: context.requestId,
      meta: meta as Prisma.InputJsonValue,
        },
      });
    } catch (auditError) {
      this.logger.warn(`Failed to record image usage audit: ${this.getErrorMessage(auditError)}`);
    }
    return record;
  }

  private summarizeImageUsage(records: ImageUpstreamCallRecord[]): ImageUsageSummary {
    const usage = records.reduce(
      (acc, record) => {
        if (record.status !== 'success' || !record.usage) return acc;
        acc.inputTokens += record.usage.inputTokens;
        acc.inputTextTokens += record.usage.inputTextTokens;
        acc.inputImageTokens += record.usage.inputImageTokens;
        acc.outputTokens += record.usage.outputTokens;
        acc.totalTokens += record.usage.totalTokens;
        acc.estimatedCostUsd += record.usage.estimatedCostUsd;
        return acc;
      },
      {
        inputTokens: 0,
        inputTextTokens: 0,
        inputImageTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
      },
    );

    return {
      ...usage,
      estimatedCostUsd: Number(usage.estimatedCostUsd.toFixed(6)),
      upstreamCallCount: records.length,
      upstreamRetryCount: records.filter((record) => record.attempt > 1).length,
      upstreamErrorCount: records.filter((record) => record.status === 'error').length,
      details: records,
    };
  }

  private extractImageUsage(response: OpenAI.Images.ImagesResponse): ImageUsage | null {
    const usage = response.usage;
    if (!usage) return null;

    const inputDetails = usage.input_tokens_details;
    const inputTextTokens = inputDetails?.text_tokens ?? 0;
    const inputImageTokens = inputDetails?.image_tokens ?? 0;
    const outputTokens = usage.output_tokens ?? 0;
    const estimatedCostUsd = this.estimateGptImageCostUsd(inputTextTokens, inputImageTokens, outputTokens);

    return {
      inputTokens: usage.input_tokens ?? 0,
      inputTextTokens,
      inputImageTokens,
      outputTokens,
      totalTokens: usage.total_tokens ?? 0,
      estimatedCostUsd,
    };
  }

  private estimateGptImageCostUsd(inputTextTokens: number, inputImageTokens: number, outputTokens: number) {
    const cost =
      (inputTextTokens * GPT_IMAGE_1_PRICING_USD_PER_MILLION.textInput +
        inputImageTokens * GPT_IMAGE_1_PRICING_USD_PER_MILLION.imageInput +
        outputTokens * GPT_IMAGE_1_PRICING_USD_PER_MILLION.imageOutput) /
      1_000_000;
    return Number(cost.toFixed(6));
  }

  private getOpenAiRequestId(value: unknown) {
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    const requestId = record._request_id ?? record.request_id;
    if (typeof requestId === 'string' && requestId.trim()) return requestId.trim();

    const headers = record.headers;
    if (headers && typeof headers === 'object') {
      const headerRecord = headers as Record<string, unknown>;
      const headerValue = headerRecord['x-request-id'] ?? headerRecord['x-request-id'.toLowerCase()];
      if (typeof headerValue === 'string' && headerValue.trim()) return headerValue.trim();
    }
    return null;
  }

  private async readImageResponse(response: OpenAI.Images.ImagesResponse, fallbackPrompt: string) {
    const generatedImage = response.data?.[0];
    const revisedPrompt = generatedImage?.revised_prompt ?? fallbackPrompt;
    if (generatedImage?.b64_json) {
      return { imageData: this.buildBase64DataUrl(generatedImage.b64_json), revisedPrompt };
    }
    if (generatedImage?.url) {
      return { imageData: await this.downloadToBase64(generatedImage.url), revisedPrompt };
    }
    throw new BadRequestException('AI 未返回图片数据');
  }

  private parseDataUrl(value: string) {
    const match = value.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/i);
    if (!match) {
      throw new BadRequestException('参考图格式无效，请上传 PNG、JPG 或 WebP 图片');
    }
    return {
      mimeType: match[1].toLowerCase().replace('image/jpg', 'image/jpeg'),
      buffer: Buffer.from(match[2], 'base64'),
    };
  }

  private extensionForMimeType(mimeType: string) {
    if (mimeType === 'image/jpeg') return 'jpg';
    if (mimeType === 'image/webp') return 'webp';
    return 'png';
  }

  private async createReferenceImageFiles(values: string[]) {
    return Promise.all(
      values.map(async (value, index) => {
        const referenceImage = this.parseDataUrl(value);
        return toFile(
          referenceImage.buffer,
          `reference-${index + 1}.${this.extensionForMimeType(referenceImage.mimeType)}`,
          { type: referenceImage.mimeType },
        );
      }),
    );
  }

  private assertReferenceImageCount(values: string[], model: string) {
    if (values.length > 16) {
      throw new BadRequestException('参考图最多支持 16 张');
    }
    if (values.length > 1 && model === 'dall-e-2') {
      throw new BadRequestException('DALL-E 2 仅支持 1 张参考图，请改用 gpt-image-1');
    }
  }

  private buildBase64DataUrl(base64: string) {
    return `data:image/png;base64,${base64}`;
  }

  private assertPromptLength(prompt: string, model: string) {
    const maxLength = this.getPromptMaxLength(model);
    if (prompt.length > maxLength) {
      throw new BadRequestException(`当前模型 ${model} 的提示词不能超过 ${maxLength} 个字符，请精简后重试`);
    }
  }

  private getPromptMaxLength(model: string) {
    const normalized = model.toLowerCase();
    if (normalized === 'dall-e-2') return 1000;
    if (normalized === 'dall-e-3') return 4000;
    return 32000;
  }

  private normalizeSizeForModel(size: string, model: string) {
    if (this.isGptImageModel(model)) {
      if (size === '1792x1024') return '1536x1024';
      if (size === '1024x1792') return '1024x1536';
    }
    if (model === 'dall-e-2' && size !== '1024x1024') {
      return '1024x1024';
    }
    return size;
  }

  private buildImageQualityOption(
    quality: string | undefined,
    model: string,
    isEdit: boolean,
    compatibilityMode: QualityCompatibilityMode = 'native',
  ) {
    const normalizedQuality = this.normalizeQualityForModel(quality, model, isEdit, compatibilityMode);
    return normalizedQuality ? { quality: normalizedQuality } : {};
  }

  private normalizeQualityForModel(
    quality: string | undefined,
    model: string,
    isEdit: boolean,
    compatibilityMode: QualityCompatibilityMode = 'native',
  ) {
    if (!quality) return undefined;
    if (compatibilityMode === 'dall-e-compatible') {
      return this.normalizeQualityForDallECompatibleModel(quality);
    }
    if (this.isGptImageModel(model)) {
      if (quality === 'hd') return 'high';
      if (quality === 'standard') return 'auto';
      return quality;
    }
    if (isEdit || model === 'dall-e-2') {
      return 'standard';
    }
    if (quality === 'high' || quality === 'hd') {
      return 'hd';
    }
    if (quality === 'auto' || quality === 'low' || quality === 'medium') {
      return 'standard';
    }
    return quality;
  }

  private normalizeQualityForDallECompatibleModel(quality: string | undefined) {
    if (!quality) return undefined;
    return quality === 'high' || quality === 'hd' ? 'hd' : 'standard';
  }

  private shouldRetryWithDallECompatibleQuality(error: unknown, model: string, quality?: string) {
    if (!quality) return false;
    if (!this.isGptImageModel(model)) return false;
    if (error instanceof HttpException) return false;

    const message = this.getErrorMessage(error).toLowerCase();
    const mentionsQuality = message.includes('quality');
    const mentionsStandard = message.includes('standard');
    const mentionsHd = /\bhd\b/.test(message);
    const looksLikeEnumError =
      message.includes('must be one of') ||
      message.includes('one of the following') ||
      message.includes('supported') ||
      message.includes('invalid');

    return mentionsQuality && mentionsStandard && mentionsHd && looksLikeEnumError;
  }

  private buildImageEditOptions(model: string) {
    if (!this.isGptImageModel(model)) {
      return { response_format: 'b64_json' };
    }

    return {
      output_format: 'png',
      ...(this.supportsInputFidelity(model) ? { input_fidelity: 'high' } : {}),
    };
  }

  private buildImageGenerateOptions(model: string) {
    if (!this.isGptImageModel(model)) {
      return { response_format: 'b64_json' };
    }

    return { output_format: 'png' };
  }

  private isGptImageModel(model: string) {
    return model.toLowerCase().includes('gpt-image');
  }

  private supportsInputFidelity(model: string) {
    const normalized = model.toLowerCase();
    return this.isGptImageModel(model) && !normalized.startsWith('gpt-image-2');
  }

  private supportsImageEdit(model: string) {
    const normalized = model.toLowerCase();
    return normalized.includes('gpt-image') || normalized === 'dall-e-2';
  }

  private async downloadToBase64(url: string): Promise<string> {
    // 用 AbortController 给 fetch 加超时上限：上游可能返回图片 URL 而非内联 base64，
    // 若该 URL 慢/不可达，无超时的 fetch 会永久挂起，使异步任务永远卡在 processing。
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), IMAGE_DOWNLOAD_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new BadRequestException('图片下载失败');
      const buffer = await res.arrayBuffer();
      const base64 = Buffer.from(buffer).toString('base64');
      const contentType = res.headers.get('content-type') ?? 'image/png';
      return `data:${contentType};base64,${base64}`;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new BadRequestException(
          `图片下载超时：上游返回的图片地址在 ${Math.round(IMAGE_DOWNLOAD_TIMEOUT_MS / 1000)}s 内无法下载`,
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /** 列出当前启用、可用于图片生成的模型配置（供业务侧做多模型兜底重试） */
  async listActiveImageModelConfigs(): Promise<
    Array<{ id: string; model: string; name: string; isDefault: boolean }>
  > {
    const configs = await this.prisma.integrationConfig.findMany({
      where: { kind: 'openai', isActive: true },
      orderBy: { updatedAt: 'desc' },
    });
    return configs
      .filter((config) => this.configSupportsImage(config))
      .map((config) => ({
        id: config.id,
        model: config.model || DEFAULT_IMAGE_TO_IMAGE_MODEL,
        name: config.name,
        isDefault: this.metadataDefaultEnabled(config),
      }));
  }

  private async resolveOpenAiCredentials(modelId?: string, requestedModel?: string): Promise<OpenAiRuntime> {
    const model = requestedModel?.trim() || DEFAULT_IMAGE_TO_IMAGE_MODEL;

    if (modelId?.trim()) {
      const config = await this.prisma.integrationConfig.findFirst({
        where: { id: modelId.trim(), kind: 'openai', isActive: true },
      });
      if (!config) {
        throw new BadRequestException('选择的 AI 模型不可用，请在 AI 模型管理中确认该模型已启用');
      }
      return this.buildOpenAiRuntime(config, config.model || model);
    }

    const configs = await this.prisma.integrationConfig.findMany({
      where: { kind: 'openai', isActive: true },
      orderBy: { updatedAt: 'desc' },
    });
    // 优先级：① 用户显式请求的同名模型；② usage_kind='image' 或名称判定为图片的「默认启用」模型；
    // ③ 任意图片模型；④ 兜底默认启用模型；⑤ 列表首项。usage_kind 权威，避免错选文本默认模型。
    const imageConfigs = configs.filter((item) => this.configSupportsImage(item));
    const config =
      configs.find((item) => item.model === model) ??
      imageConfigs.find((item) => this.metadataDefaultEnabled(item)) ??
      imageConfigs[0] ??
      configs.find((item) => this.metadataDefaultEnabled(item)) ??
      configs[0];

    if (!config) {
      const envKey = this.config.get<string>('OPENAI_API_KEY') ?? '';
      const envBase = this.config.get<string>('OPENAI_BASE_URL') ?? undefined;
      return { apiKey: envKey, baseUrl: envBase, model };
    }

    return this.buildOpenAiRuntime(config, model);
  }

  private async resolvePromptChatCredentials(modelId?: string, requestedModel?: string): Promise<PromptChatRuntime> {
    const requested = requestedModel?.trim();
    if (modelId?.trim()) {
      const config = await this.prisma.integrationConfig.findFirst({
        where: { id: modelId.trim(), kind: 'openai', isActive: true },
      });
      if (config && this.configIsChatUsable(config)) {
        return this.resolvePromptChatRoute(
          this.toPromptChatTarget(config, config.model || requested || DEFAULT_PROMPT_CHAT_MODEL),
        );
      }
    }

    const configs = await this.prisma.integrationConfig.findMany({
      where: { kind: 'openai', isActive: true },
      orderBy: { updatedAt: 'desc' },
    });
    const textConfigs = configs.filter((item) => this.configIsChatUsable(item));
    const config =
      (requested && textConfigs.find((item) => item.model === requested)) ??
      textConfigs.find((item) => {
        const metadata = item.metadata as Record<string, unknown>;
        return metadata?.is_default_enabled === true;
      }) ??
      textConfigs[0];

    if (config) {
      return this.resolvePromptChatRoute(
        this.toPromptChatTarget(config, config.model || requested || DEFAULT_PROMPT_CHAT_MODEL),
      );
    }

    const envKey = this.config.get<string>('OPENAI_API_KEY') ?? '';
    const envBase = this.config.get<string>('OPENAI_BASE_URL')?.trim().replace(/\/$/, '') || undefined;
    const envModel = this.config.get<string>('OPENAI_MODEL')?.trim() || DEFAULT_PROMPT_CHAT_MODEL;
    const model = requested && !this.isImageOnlyModel(requested) ? requested : envModel;
    return this.resolvePromptChatRoute({ provider: 'openai', apiKey: envKey, baseUrl: envBase, model });
  }

  private async resolvePromptChatRoute(fallback: AiGatewayTarget): Promise<PromptChatRuntime> {
    const routing = await this.aiGateway.resolveTargets(
      'image.prompt_optimization',
      fallback.apiKey ? [fallback] : [],
    );
    const primary = routing.targets[0];
    return {
      apiKey: primary?.apiKey ?? '',
      baseUrl: primary?.baseUrl,
      model: primary?.model ?? fallback.model,
      provider: primary?.provider ?? fallback.provider,
      targets: routing.targets,
      timeoutMs: routing.timeoutMs,
    };
  }

  private toPromptChatTarget(config: IntegrationConfig, model: string): AiGatewayTarget {
    const runtime = this.buildOpenAiRuntime(config, model);
    return {
      id: config.id,
      connectionId: config.id,
      provider: config.provider?.trim() || 'openai',
      model: runtime.model,
      apiKey: runtime.apiKey,
      baseUrl: runtime.baseUrl,
    };
  }

  private buildOpenAiRuntime(config: IntegrationConfig, model: string): OpenAiRuntime {
    let apiKey = '';
    try {
      apiKey = this.secureConfigService.decryptFromStorage(config.encryptedSecret);
    } catch { /* ignore */ }

    const metadata = config.metadata as Record<string, unknown>;
    const baseUrl = typeof metadata?.base_url === 'string' ? metadata.base_url : undefined;
    return { apiKey, baseUrl, model: model || config.model || DEFAULT_IMAGE_TO_IMAGE_MODEL };
  }

  private isImageOnlyModel(model: string) {
    const normalized = model.toLowerCase();
    return normalized.includes('gpt-image') || normalized.includes('dall-e') || normalized.includes('image-to-image');
  }

  /** 读取模型配置里管理员显式设置的 usage_kind（空串表示未设置 / auto）。 */
  private readUsageKind(config: IntegrationConfig): string {
    const metadata = config.metadata as Record<string, unknown> | null;
    return metadata && typeof metadata.usage_kind === 'string' ? metadata.usage_kind : '';
  }

  private metadataDefaultEnabled(config: IntegrationConfig): boolean {
    const metadata = config.metadata as Record<string, unknown> | null;
    return metadata?.is_default_enabled === true;
  }

  /** 该模型是否可用于图片生成：usage_kind='image' 权威，其它显式用途排除，auto 时回退名称判定。 */
  private configSupportsImage(config: IntegrationConfig): boolean {
    const usageKind = this.readUsageKind(config);
    if (usageKind === 'image') return true;
    if (usageKind && usageKind !== 'auto') return false;
    return this.supportsImageEdit(config.model ?? '') || this.isGptImageModel(config.model ?? '');
  }

  /** 该模型是否可用于提示词优化（对话）：text/multimodal 可用，image/embedding/document 排除，auto 时回退名称判定。 */
  private configIsChatUsable(config: IntegrationConfig): boolean {
    const usageKind = this.readUsageKind(config);
    if (usageKind === 'text' || usageKind === 'multimodal') return true;
    if (usageKind && usageKind !== 'auto') return false;
    return !this.isImageOnlyModel(config.model ?? '');
  }

  private toResponse(img: {
    id: string;
    prompt: string;
    revisedPrompt: string;
    style: string;
    size: string;
    quality: string;
    imageData: string;
    imageUrl?: string | null;
    model: string;
    isFavorite: boolean;
    requestId?: string | null;
    parentImageId?: string | null;
    rootImageId?: string | null;
    editInstruction?: string;
    editDepth?: number;
    upstreamCallCount?: number;
    upstreamRetryCount?: number;
    upstreamErrorCount?: number;
    inputTokens?: number;
    inputTextTokens?: number;
    inputImageTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    estimatedCostUsd?: number;
    cumulativeEstimatedCostUsd?: number;
    usageDetails?: unknown;
    createdAt: Date;
  }) {
    return {
      id: img.id,
      prompt: img.prompt,
      revisedPrompt: img.revisedPrompt,
      style: img.style,
      size: img.size,
      quality: img.quality,
      imageData: img.imageUrl ? undefined : img.imageData,
      imageUrl: img.imageUrl
        ? (img.imageUrl.startsWith('http') ? img.imageUrl : this.ossService.getSignedUrl(img.imageUrl, 24 * 3600))
        : null,
      thumbnailUrl: img.imageUrl
        ? (img.imageUrl.startsWith('http')
            ? img.imageUrl
            : this.ossService.getSignedUrl(
                img.imageUrl,
                24 * 3600,
                'image/resize,m_lfit,w_640/format,webp/quality,q_82',
              ))
        : null,
      model: img.model,
      isFavorite: img.isFavorite,
      requestId: img.requestId ?? null,
      parentImageId: img.parentImageId ?? null,
      rootImageId: img.rootImageId ?? null,
      editInstruction: img.editInstruction ?? '',
      editDepth: img.editDepth ?? 0,
      upstreamCallCount: img.upstreamCallCount ?? 0,
      upstreamRetryCount: img.upstreamRetryCount ?? 0,
      upstreamErrorCount: img.upstreamErrorCount ?? 0,
      inputTokens: img.inputTokens ?? 0,
      inputTextTokens: img.inputTextTokens ?? 0,
      inputImageTokens: img.inputImageTokens ?? 0,
      outputTokens: img.outputTokens ?? 0,
      totalTokens: img.totalTokens ?? 0,
      estimatedCostUsd: img.estimatedCostUsd ?? 0,
      cumulativeEstimatedCostUsd: img.cumulativeEstimatedCostUsd ?? img.estimatedCostUsd ?? 0,
      usageDetails: img.usageDetails ?? null,
      createdAt: img.createdAt.toISOString(),
    };
  }
}
