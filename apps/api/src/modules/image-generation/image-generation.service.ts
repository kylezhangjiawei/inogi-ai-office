import { BadRequestException, ForbiddenException, HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI, { toFile } from 'openai';
import { IntegrationConfig, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { PrismaService } from '../../prisma/prisma.service';
import { SecureConfigService } from '../security/secure-config.service';
import { EditImageDto } from './dto/edit-image.dto';
import { GenerateImageDto } from './dto/generate-image.dto';
import { CreatePromptChatSessionDto, PromptChatDto } from './dto/prompt-chat.dto';

const CACHE_SIMILARITY_THRESHOLD = 0.65;
const DEFAULT_IMAGE_TO_IMAGE_MODEL = 'gpt-image-1';
const DEFAULT_PROMPT_CHAT_MODEL = 'gpt-4.1-mini';

type OpenAiRuntime = {
  apiKey: string;
  baseUrl?: string;
  model: string;
};

type PromptChatRuntime = OpenAiRuntime & {
  provider?: string | null;
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly secureConfigService: SecureConfigService,
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
      const { apiKey, baseUrl, model } = await this.resolvePromptChatCredentials(dto.model_id, dto.model);
      if (!apiKey) {
        throw new BadRequestException('未配置可用的文本 AI 模型，请在 AI 模型管理中添加 OpenAI 兼容模型');
      }

      const client = new OpenAI({
        apiKey,
        ...(baseUrl ? { baseURL: baseUrl } : {}),
        defaultHeaders: { 'X-Inogi-Prompt-Chat-Request-Id': requestId },
      });
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

      const response = await client.chat.completions.create({
        model,
        temperature: 0.35,
        response_format: { type: 'json_object' },
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

      const content = response.choices[0]?.message?.content ?? '';
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

  async listImages(userId: string, page = 1, pageSize = 12, onlyFavorite = false, dateFrom?: string, dateTo?: string) {
    const where = {
      userId,
      ...(onlyFavorite ? { isFavorite: true } : {}),
      ...this.buildCreatedAtFilter(dateFrom, dateTo),
    };
    const [total, items] = await Promise.all([
      this.prisma.generatedImage.count({ where }),
      this.prisma.generatedImage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          prompt: true,
          revisedPrompt: true,
          style: true,
          size: true,
          quality: true,
          imageData: true,
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
        },
      }),
    ]);
    return { total, page, pageSize, totalPages: Math.ceil(total / pageSize), items };
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

  // ── 删除 ─────────────────────────────────────────────────────────────────────

  async deleteImage(id: string, userId: string) {
    await this.assertOwner(id, userId);
    await this.prisma.generatedImage.delete({ where: { id } });
    return { ok: true };
  }

  // ── 私有方法 ─────────────────────────────────────────────────────────────────

  private async assertOwner(id: string, userId: string) {
    const img = await this.prisma.generatedImage.findUnique({ where: { id } });
    if (!img) throw new NotFoundException('图片不存在');
    if (img.userId !== userId) throw new ForbiddenException();
    return img;
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

  private buildCreatedAtFilter(dateFrom?: string, dateTo?: string) {
    const createdAt: { gte?: Date; lt?: Date } = {};
    const from = this.parseDate(dateFrom);
    const to = this.parseDate(dateTo);
    if (from) createdAt.gte = from;
    if (to) createdAt.lt = to;
    return Object.keys(createdAt).length > 0 ? { createdAt } : {};
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
    const res = await fetch(url);
    if (!res.ok) throw new BadRequestException('图片下载失败');
    const buffer = await res.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    const contentType = res.headers.get('content-type') ?? 'image/png';
    return `data:${contentType};base64,${base64}`;
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
    const config =
      configs.find((item) => item.model === model) ??
      configs.find((item) => this.supportsImageEdit(item.model ?? '')) ??
      configs.find((item) => {
        const metadata = item.metadata as Record<string, unknown>;
        return metadata?.is_default_enabled === true;
      }) ??
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
      if (config && !this.isImageOnlyModel(config.model || requested || '')) {
        return this.buildOpenAiRuntime(config, config.model || requested || DEFAULT_PROMPT_CHAT_MODEL);
      }
    }

    const configs = await this.prisma.integrationConfig.findMany({
      where: { kind: 'openai', isActive: true },
      orderBy: { updatedAt: 'desc' },
    });
    const textConfigs = configs.filter((item) => !this.isImageOnlyModel(item.model ?? ''));
    const config =
      (requested && textConfigs.find((item) => item.model === requested)) ??
      textConfigs.find((item) => {
        const metadata = item.metadata as Record<string, unknown>;
        return metadata?.is_default_enabled === true;
      }) ??
      textConfigs[0];

    if (config) {
      return this.buildOpenAiRuntime(config, config.model || requested || DEFAULT_PROMPT_CHAT_MODEL);
    }

    const envKey = this.config.get<string>('OPENAI_API_KEY') ?? '';
    const envBase = this.config.get<string>('OPENAI_BASE_URL')?.trim().replace(/\/$/, '') || undefined;
    const envModel = this.config.get<string>('OPENAI_MODEL')?.trim() || DEFAULT_PROMPT_CHAT_MODEL;
    return { apiKey: envKey, baseUrl: envBase, model: requested && !this.isImageOnlyModel(requested) ? requested : envModel };
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

  private toResponse(img: {
    id: string;
    prompt: string;
    revisedPrompt: string;
    style: string;
    size: string;
    quality: string;
    imageData: string;
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
      imageData: img.imageData,
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
