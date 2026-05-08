import { ForbiddenException, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI, { toFile } from 'openai';
import { IntegrationConfig } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { SecureConfigService } from '../security/secure-config.service';
import { GenerateImageDto } from './dto/generate-image.dto';

const CACHE_SIMILARITY_THRESHOLD = 0.65;
const DEFAULT_IMAGE_TO_IMAGE_MODEL = 'gpt-image-1';

type OpenAiRuntime = {
  apiKey: string;
  baseUrl?: string;
  model: string;
};

@Injectable()
export class ImageGenerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly secureConfigService: SecureConfigService,
  ) {}

  // ── 生成图片（优先命中缓存）────────────────────────────────────────────────

  async generate(userId: string, dto: GenerateImageDto) {
    const prompt = dto.prompt.trim();
    const style = dto.style ?? 'vivid';
    const size = dto.size ?? '1024x1024';
    const quality = dto.quality ?? 'standard';
    const requestedModel = dto.model?.trim() || DEFAULT_IMAGE_TO_IMAGE_MODEL;
    const hasReferenceImage = Boolean(dto.reference_image_data?.trim());

    // 1. 先在数据库中查找相似图片
    const cached = hasReferenceImage || dto.skip_cache ? null : await this.findCachedImage(prompt, style, size, quality, requestedModel);
    if (cached) {
      return { ...this.toResponse(cached), fromCache: true, similarity: cached._similarity };
    }

    // 2. 无缓存 → 调用 OpenAI Images API 生成 / 图生图编辑
    const { apiKey, baseUrl, model } = await this.resolveOpenAiCredentials(dto.model_id, requestedModel);
    if (!apiKey) {
      throw new BadRequestException('未配置可用的 OpenAI API Key，请在 AI 模型管理中添加 OpenAI 类型的配置');
    }

    const client = new OpenAI({ apiKey, ...(baseUrl ? { baseURL: baseUrl } : {}) });
    const effectiveModel = hasReferenceImage && !this.supportsImageEdit(model) ? DEFAULT_IMAGE_TO_IMAGE_MODEL : model;
    const { imageData, revisedPrompt } = await this.generateWithOpenAi(client, {
      prompt,
      style,
      size,
      quality,
      model: effectiveModel,
      referenceImageData: dto.reference_image_data,
    });

    // 4. 存库
    const saved = await this.prisma.generatedImage.create({
      data: { userId, prompt, revisedPrompt, style, size, quality, imageData, model: effectiveModel },
    });

    return { ...this.toResponse(saved), fromCache: false, similarity: 0 };
  }

  // ── 列表（分页）──────────────────────────────────────────────────────────────

  async listImages(userId: string, page = 1, pageSize = 12, onlyFavorite = false) {
    const where = { userId, ...(onlyFavorite ? { isFavorite: true } : {}) };
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
          createdAt: true,
        },
      }),
    ]);
    return { total, page, pageSize, totalPages: Math.ceil(total / pageSize), items };
  }

  // ── 收藏切换 ─────────────────────────────────────────────────────────────────

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
      quality: 'standard' | 'hd';
      model: string;
      referenceImageData?: string;
    },
  ): Promise<{ imageData: string; revisedPrompt: string }> {
    try {
      if (options.referenceImageData?.trim()) {
        const referenceImage = this.parseDataUrl(options.referenceImageData);
        const imageFile = await toFile(
          referenceImage.buffer,
          `reference.${this.extensionForMimeType(referenceImage.mimeType)}`,
          { type: referenceImage.mimeType },
        );
        const response = await client.images.edit({
          model: options.model,
          image: imageFile,
          prompt: options.prompt,
          n: 1,
          size: this.normalizeSizeForModel(options.size, options.model),
          quality: this.normalizeQualityForModel(options.quality, options.model, true),
          ...this.buildImageEditOptions(options.model),
        } as OpenAI.Images.ImageEditParamsNonStreaming);
        return this.readImageResponse(response, options.prompt);
      }

      const response = await client.images.generate({
        model: options.model,
        prompt: options.prompt,
        n: 1,
        size: this.normalizeSizeForModel(options.size, options.model),
        quality: this.normalizeQualityForModel(options.quality, options.model, false),
        ...(options.model === 'dall-e-3' ? { style: options.style } : {}),
        ...this.buildImageGenerateOptions(options.model),
      } as OpenAI.Images.ImageGenerateParamsNonStreaming);
      return this.readImageResponse(response, options.prompt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '图片生成失败';
      throw new BadRequestException(msg);
    }
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

  private buildBase64DataUrl(base64: string) {
    return `data:image/png;base64,${base64}`;
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

  private normalizeQualityForModel(quality: string, model: string, isEdit: boolean) {
    if (this.isGptImageModel(model)) {
      return quality === 'hd' ? 'high' : 'auto';
    }
    if (isEdit || model === 'dall-e-2') {
      return 'standard';
    }
    return quality;
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

  private buildOpenAiRuntime(config: IntegrationConfig, model: string): OpenAiRuntime {
    let apiKey = '';
    try {
      apiKey = this.secureConfigService.decryptFromStorage(config.encryptedSecret);
    } catch { /* ignore */ }

    const metadata = config.metadata as Record<string, unknown>;
    const baseUrl = typeof metadata?.base_url === 'string' ? metadata.base_url : undefined;
    return { apiKey, baseUrl, model: model || config.model || DEFAULT_IMAGE_TO_IMAGE_MODEL };
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
      createdAt: img.createdAt.toISOString(),
    };
  }
}
