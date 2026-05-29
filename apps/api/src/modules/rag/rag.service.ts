import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import OpenAI from 'openai';

import { PrismaService } from '../../prisma/prisma.service';
import { SecureConfigService } from '../security/secure-config.service';
import { EmbeddingClient } from './embedding-client';
import { chunkText } from './chunker';

// ─── 类型 ─────────────────────────────────────────────────────────────────────

export type RagSourceType =
  | 'kb'
  | 'rd_task'
  | 'rd_progress_note'
  | 'rd_proposal'
  | 'rd_daily_report'
  | 'chat_group'
  | 'chat_private'
  | 'audit_log'
  | 'candidate'
  | 'image'
  | 'file_asset';

export type RagPermissionMetadata = {
  /** KB 分值制：用户 kb_level >= 此值方可访问 */
  permission_level?: number;
  /** 私聊参与者 user.id 列表；非空时只有列出的人可见 */
  visible_user_ids?: string[];
  /** 按角色名限制可见性，空数组等于不限制 */
  visible_role_codes?: string[];
  /** 按部门限制（保留字段，Phase 1 不强制使用） */
  department_ids?: string[];
};

export type RagChunkMetadata = RagPermissionMetadata & {
  title?: string;
  category_id?: string;
  category_label?: string;
  author_id?: string;
  author_name?: string;
  url?: string;
  /** 聊天专用：AI 分类结果 */
  ai_classification?: 'work_knowledge' | 'work_chat' | 'personal' | 'sensitive';
  /** 任意业务字段，前端展示用 */
  [key: string]: unknown;
};

export type RagSourceDocument = {
  sourceType: RagSourceType;
  sourceId: string;
  title: string;
  /** 原始可索引文本（chunk 之前的完整文本） */
  text: string;
  metadata: RagChunkMetadata;
};

export type RagUserContext = {
  userId: string;
  permissions: string[];
  /** KB 分值（来自 person.kb_level）。超管可不传 */
  kbLevel?: number;
  /** 当前用户姓名（用于 LLM 个性化称呼与"我的任务"等过滤） */
  name?: string;
  /** 当前用户所属部门 */
  department?: string;
  /** 当前用户系统角色名（管理员/研发等） */
  roleName?: string;
  /** 当前用户研发岗位（来自 rd.people.position） */
  position?: string;
};

export type RagSearchResult = {
  chunkId: string;
  sourceType: RagSourceType;
  sourceId: string;
  content: string;
  metadata: RagChunkMetadata;
  /** 相似度（1 = 完全匹配，0 = 无关） */
  similarity: number;
};

export type RagSearchResponse = {
  results: RagSearchResult[];
  /** 因权限被过滤掉的命中数（用于"另有 N 条无权限" 提示） */
  filteredByPermission: number;
};

export type RagChatCitation = {
  sourceType: RagSourceType;
  sourceId: string;
  title?: string;
  excerpt: string;
  url?: string;
  /** 直接下载链接（已签名，对知识库 OSS 文件有效）。仅在源具备可下载文件时设置。 */
  downloadUrl?: string;
  similarity: number;
};

export type RagChatResponse = {
  answer: string;
  citations: RagChatCitation[];
  noResults: boolean;
  filteredByPermission: number;
  /** 兜底原文（用户对答案不满意时可展开） */
  rawChunks: RagSearchResult[];
};

// ─── 常量 ─────────────────────────────────────────────────────────────────────

const DEFAULT_TOP_K = 5;
const DEFAULT_SIMILARITY_THRESHOLD = 0.5;
const SUPER_ADMIN_PERMISSION = '*';
const RAG_SYSTEM_PROMPT_BASE =
  '你是 INOGI 企业知识助手。严格基于下方"参考资料"作答；如果资料无法支持答案，必须明确说"未在知识库中找到相关信息"，不允许编造或臆测。' +
  '回答用简洁的中文，分点表达。每个核心结论后用方括号引用编号，如 [1] [2]，对应参考资料的序号。';

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly secureConfig: SecureConfigService,
    private readonly embedding: EmbeddingClient,
  ) {}

  // ─── 同步：单条 / 批量 ─────────────────────────────────────────────────────

  /** 同步单条来源文档：先删除该 source 的旧 chunks，再切块 + embedding + 写入 */
  async syncDocument(doc: RagSourceDocument): Promise<{ inserted: number }> {
    return this.syncDocuments([doc]);
  }

  /**
   * 批量同步多条来源文档（单次调用包含 chunking + embedding + DB 写入，比循环调 syncDocument 高效）
   * 同一 sourceType+sourceId 的旧 chunks 会被先清空，避免重复
   */
  async syncDocuments(docs: RagSourceDocument[]): Promise<{ inserted: number }> {
    if (docs.length === 0) return { inserted: 0 };

    // 1. 切块
    type PendingChunk = {
      sourceType: RagSourceType;
      sourceId: string;
      chunkIndex: number;
      content: string;
      metadata: RagChunkMetadata;
    };
    const pending: PendingChunk[] = [];
    for (const doc of docs) {
      const chunks = chunkText(doc.text);
      for (const c of chunks) {
        pending.push({
          sourceType: doc.sourceType,
          sourceId: doc.sourceId,
          chunkIndex: c.index,
          content: c.content,
          metadata: doc.metadata,
        });
      }
    }
    if (pending.length === 0) return { inserted: 0 };

    // 2. Embedding（批量，更省 API 调用次数）
    const embeddings = await this.embedding.embedBatch(pending.map((p) => p.content));
    if (embeddings.length !== pending.length) {
      throw new Error(
        `Embedding 数量异常：期望 ${pending.length}，实际 ${embeddings.length}`,
      );
    }
    const config = await this.embedding.loadConfig();

    // 3. 删除旧 chunks（按 sourceType+sourceId 维度），再插入
    const uniqueSources = Array.from(
      new Set(docs.map((d) => `${d.sourceType}::${d.sourceId}`)),
    );
    await this.prisma.$transaction(async (tx) => {
      for (const key of uniqueSources) {
        const [sourceType, sourceId] = key.split('::');
        await tx.$executeRaw`DELETE FROM "KnowledgeChunk" WHERE "sourceType" = ${sourceType} AND "sourceId" = ${sourceId}`;
      }
      // 批量插入。embedding 是 Float[]，Prisma client 原生支持
      const records = pending.map((p, i) => ({
        id: this.makeId(),
        sourceType: p.sourceType,
        sourceId: p.sourceId,
        chunkIndex: p.chunkIndex,
        content: p.content,
        embedding: embeddings[i],
        metadata: (p.metadata ?? {}) as unknown as Prisma.InputJsonValue,
        embeddingModel: config.model,
      }));
      await tx.knowledgeChunk.createMany({ data: records });
    });
    return { inserted: pending.length };
  }

  /** 删除某来源的全部 chunks（用于资源被业务层删除时清理） */
  async removeChunksForSource(sourceType: RagSourceType, sourceId: string): Promise<{ deleted: number }> {
    const result = await this.prisma.knowledgeChunk.deleteMany({
      where: { sourceType, sourceId },
    });
    return { deleted: result.count };
  }

  /** 软删除（作者撤回）：保留 chunk 但标记 archived，检索时跳过 */
  async archiveChunk(chunkId: string): Promise<void> {
    await this.prisma.knowledgeChunk.update({
      where: { id: chunkId },
      data: { archived: true },
    });
  }

  // ─── 检索 ──────────────────────────────────────────────────────────────────

  /**
   * 语义检索 + 权限预过滤。
   * 步骤：
   *  1. query → embedding
   *  2. 全量拉候选 chunks（按 sourceType 过滤 + archived=false）
   *  3. 在内存里逐条算余弦相似度（≤10k chunks 规模下亚秒级）
   *  4. 排序后做阈值 + 权限过滤
   *  5. 截取前 k 条返回
   */
  async search(
    query: string,
    user: RagUserContext,
    opts: { topK?: number; threshold?: number; sourceTypes?: RagSourceType[] } = {},
  ): Promise<RagSearchResponse> {
    const topK = opts.topK ?? DEFAULT_TOP_K;
    const threshold = opts.threshold ?? DEFAULT_SIMILARITY_THRESHOLD;
    if (!query?.trim()) return { results: [], filteredByPermission: 0 };

    const queryVec = await this.embedding.embedOne(query);

    // 1. 拉候选 chunks（基础过滤：archived=false + 可选 sourceType）
    const chunks = await this.prisma.knowledgeChunk.findMany({
      where: {
        archived: false,
        ...(opts.sourceTypes && opts.sourceTypes.length > 0
          ? { sourceType: { in: opts.sourceTypes } }
          : {}),
      },
      select: {
        id: true,
        sourceType: true,
        sourceId: true,
        content: true,
        metadata: true,
        embedding: true,
      },
    });

    // 2. 算余弦相似度（候选集 ≤ 10k 时这步在 10-50ms 量级）
    type Scored = {
      id: string;
      sourceType: string;
      sourceId: string;
      content: string;
      metadata: RagChunkMetadata;
      similarity: number;
    };
    const scored: Scored[] = chunks
      .map((c) => {
        const vec = Array.isArray(c.embedding) ? (c.embedding as number[]) : [];
        if (vec.length === 0) return null;
        const sim = EmbeddingClient.cosineSimilarity(queryVec, vec);
        return {
          id: c.id,
          sourceType: c.sourceType,
          sourceId: c.sourceId,
          content: c.content,
          metadata: (c.metadata as unknown as RagChunkMetadata) ?? {},
          similarity: sim,
        };
      })
      .filter((x): x is Scored => x !== null && x.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity);

    // 3. 权限过滤，截取 topK
    let filteredByPermission = 0;
    const visible: RagSearchResult[] = [];
    for (const r of scored) {
      if (this.hasAccess(r.metadata, user)) {
        visible.push({
          chunkId: r.id,
          sourceType: r.sourceType as RagSourceType,
          sourceId: r.sourceId,
          content: r.content,
          metadata: r.metadata,
          similarity: Math.round(r.similarity * 1000) / 1000,
        });
      } else {
        filteredByPermission += 1;
      }
      if (visible.length >= topK) break;
    }

    return { results: visible, filteredByPermission };
  }

  // ─── RAG 综合问答 ─────────────────────────────────────────────────────────

  /**
   * 用检索到的 chunks 作为上下文，调 LLM 生成综合回答。
   * 严格 prompt 防幻觉：找不到就直接说"未在知识库找到"，不允许编造。
   *
   * LLM 模型沿用 RD 默认对话模型（从 IntegrationConfig kind='openai' isActive 取）。
   */
  async chat(
    query: string,
    user: RagUserContext,
    opts: { topK?: number; threshold?: number; sourceTypes?: RagSourceType[] } = {},
  ): Promise<RagChatResponse> {
    const searchResp = await this.search(query, user, opts);

    if (searchResp.results.length === 0) {
      return {
        answer: searchResp.filteredByPermission > 0
          ? `已检索到 ${searchResp.filteredByPermission} 条相关资料，但你的角色暂无访问权限。请联系对应权限的同事或管理员。`
          : '未在知识库中找到相关信息。可以尝试更换关键词，或点击"扩展到外网搜索"查询通用知识。',
        citations: [],
        noResults: true,
        filteredByPermission: searchResp.filteredByPermission,
        rawChunks: [],
      };
    }

    const llmConfig = await this.loadChatModel();
    // 60s 超时：防止 LLM 卡死时前端无限等待
    const client = new OpenAI({
      apiKey: llmConfig.apiKey,
      baseURL: llmConfig.baseUrl,
      timeout: 60_000,
      maxRetries: 1,
    });

    // 拼 context 块（每条带编号 + 来源信息）
    const contextBlock = searchResp.results
      .map((r, idx) => {
        const meta = r.metadata ?? {};
        const titleLine = meta.title ? `《${meta.title}》` : `${r.sourceType}#${r.sourceId}`;
        const authorLine = meta.author_name ? `（${meta.author_name}）` : '';
        return `[${idx + 1}] ${titleLine}${authorLine}\n${r.content.trim()}`;
      })
      .join('\n\n---\n\n');

    const systemPrompt = RAG_SYSTEM_PROMPT_BASE;
    const userPrompt = `用户问题：${query.trim()}\n\n参考资料：\n${contextBlock}`;

    let answer = '';
    try {
      const resp = await client.chat.completions.create({
        model: llmConfig.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        ...(llmConfig.provider === 'qwen' ? ({ enable_thinking: false } as Record<string, unknown>) : {}),
      });
      answer = (resp.choices[0]?.message?.content ?? '').trim();
    } catch (err) {
      this.logger.error(
        `RAG chat LLM 调用失败: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new BadRequestException('AI 综合回答失败，请稍后重试或使用展开原文查看');
    }

    if (!answer) {
      answer = '模型未能给出有效回答，请展开原文查看检索片段。';
    }

    const citations: RagChatCitation[] = searchResp.results.map((r) => ({
      sourceType: r.sourceType,
      sourceId: r.sourceId,
      title: typeof r.metadata?.title === 'string' ? r.metadata.title : undefined,
      excerpt: r.content.length > 240 ? r.content.slice(0, 240) + '…' : r.content,
      url: typeof r.metadata?.url === 'string' ? r.metadata.url : undefined,
      similarity: r.similarity,
    }));

    return {
      answer,
      citations,
      noResults: false,
      filteredByPermission: searchResp.filteredByPermission,
      rawChunks: searchResp.results,
    };
  }

  // ─── 权限判定 ─────────────────────────────────────────────────────────────

  /**
   * 判定用户对单个 chunk 的可见性。
   * 多维度交叉：
   *  1. 超管（permissions 含 '*'）直通
   *  2. visible_user_ids 非空 → 用户 id 必须在其中（私聊场景）
   *  3. permission_level 字段 → 用户 kbLevel >= 此值（KB 分值制）
   *  4. visible_role_codes / department_ids 暂未启用，Phase 2 再加
   */
  private hasAccess(meta: RagChunkMetadata, user: RagUserContext): boolean {
    if (!meta) return true;
    // 1. 超管直通
    if (user.permissions?.includes(SUPER_ADMIN_PERMISSION)) return true;

    // 2. 私聊 / 显式可见列表
    if (Array.isArray(meta.visible_user_ids) && meta.visible_user_ids.length > 0) {
      return meta.visible_user_ids.includes(user.userId);
    }

    // 3. KB 分值制
    if (typeof meta.permission_level === 'number') {
      const userLevel = typeof user.kbLevel === 'number' ? user.kbLevel : 0;
      if (userLevel < meta.permission_level) return false;
    }

    return true;
  }

  // ─── LLM 模型解析（沿用 RD 现有"默认对话模型"） ─────────────────────────

  private async loadChatModel(): Promise<{
    provider: 'openai' | 'qwen';
    model: string;
    apiKey: string;
    baseUrl: string;
  }> {
    const configs = await this.prisma.integrationConfig.findMany({
      where: { kind: 'openai', isActive: true },
      orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
    });
    if (configs.length === 0) {
      throw new BadRequestException('未配置任何对话模型，无法生成 RAG 回答。请在「AI 模型管理」添加。');
    }
    // 优先选标记为 is_default_enabled 的，没有就取最新
    const picked =
      configs.find((c) => {
        const meta = (c.metadata && typeof c.metadata === 'object'
          ? c.metadata
          : {}) as Record<string, unknown>;
        return meta.is_default_enabled === true;
      }) ?? configs[0];

    let apiKey = '';
    try {
      apiKey = this.secureConfig.decryptFromStorage(picked.encryptedSecret);
    } catch {
      throw new BadRequestException('对话模型密钥解密失败');
    }
    const meta = (picked.metadata && typeof picked.metadata === 'object'
      ? picked.metadata
      : {}) as Record<string, unknown>;
    const provider = ((picked.provider ?? 'openai').toLowerCase() === 'qwen' ? 'qwen' : 'openai') as
      | 'openai'
      | 'qwen';
    const model = picked.model?.trim() || (provider === 'qwen' ? 'qwen-turbo' : 'gpt-4o-mini');
    const baseUrl = typeof meta.base_url === 'string' && meta.base_url
      ? meta.base_url
      : provider === 'qwen'
        ? 'https://dashscope.aliyuncs.com/compatible-mode/v1'
        : 'https://api.openai.com/v1';
    return { provider, model, apiKey, baseUrl };
  }

  // ─── 工具 ─────────────────────────────────────────────────────────────────

  private makeId(): string {
    // 与 cuid() 兼容性强的简化 id：时间戳 + 随机，避免引入 cuid 依赖
    return `chunk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }
}
