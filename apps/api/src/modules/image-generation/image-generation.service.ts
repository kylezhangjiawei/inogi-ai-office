import { ForbiddenException, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

import { PrismaService } from '../../prisma/prisma.service';
import { SecureConfigService } from '../security/secure-config.service';
import { GenerateImageDto } from './dto/generate-image.dto';

const CACHE_SIMILARITY_THRESHOLD = 0.65;

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

    // 1. 先在数据库中查找相似图片
    const cached = await this.findCachedImage(prompt, style, size, quality);
    if (cached) {
      return { ...this.toResponse(cached), fromCache: true, similarity: cached._similarity };
    }

    // 2. 无缓存 → 调用 DALL-E 生成
    const { apiKey, baseUrl } = await this.resolveOpenAiCredentials();
    if (!apiKey) {
      throw new BadRequestException('未配置可用的 OpenAI API Key，请在 AI 模型管理中添加 OpenAI 类型的配置');
    }

    const client = new OpenAI({ apiKey, ...(baseUrl ? { baseURL: baseUrl } : {}) });

    let imageUrl: string;
    let revisedPrompt: string;
    try {
      const response = await client.images.generate({
        model: 'dall-e-3',
        prompt,
        n: 1,
        size: size as '1024x1024' | '1792x1024' | '1024x1792',
        style: style as 'vivid' | 'natural',
        quality: quality as 'standard' | 'hd',
        response_format: 'url',
      });
      imageUrl = response.data[0]?.url ?? '';
      revisedPrompt = response.data[0]?.revised_prompt ?? prompt;
    } catch (err) {
      const msg = err instanceof Error ? err.message : '图片生成失败';
      throw new BadRequestException(msg);
    }

    if (!imageUrl) throw new BadRequestException('AI 未返回图片 URL');

    // 3. 下载图片并转 base64
    const imageData = await this.downloadToBase64(imageUrl);

    // 4. 存库
    const saved = await this.prisma.generatedImage.create({
      data: { userId, prompt, revisedPrompt, style, size, quality, imageData, model: 'dall-e-3' },
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

  private async findCachedImage(prompt: string, style: string, size: string, quality: string) {
    const candidates = await this.prisma.generatedImage.findMany({
      where: { style, size, quality },
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

  private async downloadToBase64(url: string): Promise<string> {
    const res = await fetch(url);
    if (!res.ok) throw new BadRequestException('图片下载失败');
    const buffer = await res.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    const contentType = res.headers.get('content-type') ?? 'image/png';
    return `data:${contentType};base64,${base64}`;
  }

  private async resolveOpenAiCredentials(): Promise<{ apiKey: string; baseUrl?: string }> {
    const config = await this.prisma.integrationConfig.findFirst({
      where: { kind: 'openai', isActive: true },
      orderBy: { updatedAt: 'desc' },
    });

    if (!config) {
      const envKey = this.config.get<string>('OPENAI_API_KEY') ?? '';
      const envBase = this.config.get<string>('OPENAI_BASE_URL') ?? undefined;
      return { apiKey: envKey, baseUrl: envBase };
    }

    let apiKey = '';
    try {
      apiKey = this.secureConfigService.decryptFromStorage(config.encryptedSecret);
    } catch { /* ignore */ }

    const metadata = config.metadata as Record<string, unknown>;
    const baseUrl = typeof metadata?.base_url === 'string' ? metadata.base_url : undefined;
    return { apiKey, baseUrl };
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
