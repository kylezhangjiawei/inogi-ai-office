import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import OpenAI from 'openai';

import { PrismaService } from '../../prisma/prisma.service';
import { SecureConfigService } from '../security/secure-config.service';

/**
 * Embedding 模型客户端。
 *
 * Key 来源：`IntegrationConfig` 表，`kind='embedding'`，与 OpenAI 对话模型同一套加密机制。
 * 主推通义 text-embedding-v3（1024 维，中文友好），但 OpenAI text-embedding-3-* 也支持。
 *
 * 60s 配置缓存：避免每次 embed 都查库。管理员改 key/模型后调用 invalidateCache() 立即生效。
 */

export type EmbeddingProvider = 'qwen' | 'openai';

export type EmbeddingConfig = {
  provider: EmbeddingProvider;
  model: string;
  apiKey: string;
  baseUrl?: string;
  /** 向量维度，写入 KnowledgeChunk 时需要与 schema 的 vector(N) 一致 */
  dimensions: number;
};

const QWEN_DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const CONFIG_CACHE_TTL_MS = 60_000;
const MAX_BATCH_SIZE = 25; // 通义单批最多 25 条
const MAX_INPUT_CHARS = 2_000; // 单条输入限制（防止超模型最大 token）

@Injectable()
export class EmbeddingClient {
  private readonly logger = new Logger(EmbeddingClient.name);
  private cachedConfig: EmbeddingConfig | null = null;
  private cachedAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly secureConfig: SecureConfigService,
  ) {}

  invalidateCache() {
    this.cachedConfig = null;
    this.cachedAt = 0;
  }

  /** 加载当前激活的 embedding 配置。无可用配置时抛 BadRequestException */
  async loadConfig(): Promise<EmbeddingConfig> {
    if (this.cachedConfig && Date.now() - this.cachedAt < CONFIG_CACHE_TTL_MS) {
      return this.cachedConfig;
    }
    // 1. 优先查 kind='embedding' 的专用记录
    let record = await this.prisma.integrationConfig
      .findFirst({
        where: { kind: 'embedding', isActive: true },
        orderBy: { updatedAt: 'desc' },
      })
      .catch(() => null);

    // 2. 兜底：现有 AI 模型管理 UI 保存时 kind='openai'，模型名含 embedding 的也能用
    if (!record) {
      record = await this.prisma.integrationConfig
        .findFirst({
          where: {
            kind: 'openai',
            isActive: true,
            model: { contains: 'embedding', mode: 'insensitive' },
          },
          orderBy: { updatedAt: 'desc' },
        })
        .catch(() => null);
    }

    if (!record) {
      throw new BadRequestException(
        'Embedding 模型未配置。请前往「AI 模型管理」新增一条模型，模型标识填 text-embedding-v3 或 text-embedding-v4（通义）',
      );
    }
    let apiKey = '';
    try {
      apiKey = this.secureConfig.decryptFromStorage(record.encryptedSecret);
    } catch {
      throw new BadRequestException('Embedding 模型密钥解密失败，请重新填写。');
    }
    if (!apiKey) {
      throw new BadRequestException('Embedding 模型密钥为空，请在「AI 模型管理」补全。');
    }
    const meta = (record.metadata && typeof record.metadata === 'object'
      ? record.metadata
      : {}) as Record<string, unknown>;
    const provider: EmbeddingProvider = (() => {
      const p = String(record.provider ?? 'qwen').toLowerCase();
      if (p === 'openai') return 'openai';
      return 'qwen';
    })();
    const model = String(record.model ?? '').trim() ||
      (provider === 'qwen' ? 'text-embedding-v3' : 'text-embedding-3-small');
    const baseUrl =
      typeof meta.base_url === 'string' && meta.base_url
        ? String(meta.base_url)
        : provider === 'qwen'
          ? QWEN_DEFAULT_BASE_URL
          : OPENAI_DEFAULT_BASE_URL;
    const dimensions = typeof meta.dimensions === 'number' && meta.dimensions > 0
      ? Math.floor(meta.dimensions)
      : 1024; // 默认 1024（必须与 KnowledgeChunk.embedding 的 vector(N) 维度一致）

    const config: EmbeddingConfig = { provider, model, apiKey, baseUrl, dimensions };
    this.cachedConfig = config;
    this.cachedAt = Date.now();
    return config;
  }

  /** 单条 embedding。失败抛异常，调用方自行决定重试或降级 */
  async embedOne(text: string): Promise<number[]> {
    const [vec] = await this.embedBatch([text]);
    return vec;
  }

  /** 批量 embedding。自动按 batch size 分块。空数组直接返回 [] */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!Array.isArray(texts) || texts.length === 0) return [];
    const config = await this.loadConfig();
    const client = this.createClient(config);
    const cleaned = texts.map((t) => this.sanitizeInput(t));

    const results: number[][] = new Array(cleaned.length);
    for (let i = 0; i < cleaned.length; i += MAX_BATCH_SIZE) {
      const batch = cleaned.slice(i, i + MAX_BATCH_SIZE);
      const params: OpenAI.EmbeddingCreateParams = {
        model: config.model,
        input: batch,
      };
      // OpenAI text-embedding-3-* 支持 dimensions 参数（用于裁剪维度）。
      // 通义 text-embedding-v3/v4 的 OpenAI 兼容接口默认输出 1024 维，且参数容错性较低，
      // 故对 qwen 不显式传 dimensions —— 让模型走默认值，靠下方维度校验兜底。
      if (config.provider === 'openai') {
        params.dimensions = config.dimensions;
      }
      try {
        const resp = await client.embeddings.create(params);
        for (let j = 0; j < resp.data.length; j++) {
          const vec = resp.data[j]?.embedding;
          if (!Array.isArray(vec)) {
            throw new Error(`Embedding API 返回缺失向量（index=${i + j}）`);
          }
          if (vec.length !== config.dimensions) {
            throw new Error(
              `Embedding 维度不匹配：期望 ${config.dimensions}，实际 ${vec.length}。请确认模型与 schema 一致。`,
            );
          }
          results[i + j] = vec as number[];
        }
      } catch (err) {
        this.logger.error(
          `Embedding 调用失败 (provider=${config.provider}, model=${config.model}): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        throw err;
      }
    }
    return results;
  }

  /** 计算两个等长向量的余弦相似度，范围 [-1, 1]，1=完全相同 */
  static cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      const x = a[i];
      const y = b[i];
      dot += x * y;
      normA += x * x;
      normB += y * y;
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    if (denom === 0) return 0;
    return dot / denom;
  }

  private sanitizeInput(text: string): string {
    const trimmed = (text ?? '').trim();
    if (trimmed.length === 0) return ' '; // 空字符串会让 API 报错，用单空格兜底
    if (trimmed.length > MAX_INPUT_CHARS) return trimmed.slice(0, MAX_INPUT_CHARS);
    return trimmed;
  }

  private createClient(config: EmbeddingConfig): OpenAI {
    return new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });
  }
}
