import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';

import { PrismaService } from '../../prisma/prisma.service';
import { ChatService } from '../chat/chat.service';
import {
  ChatAttachmentService,
  type StoredChatAttachment,
} from '../chat/chat-attachment.service';
import { RagService } from '../rag/rag.service';
import {
  buildAnalysisSystemPrompt,
  buildAnalysisUserPrompt,
  buildHeuristicCauses,
  deriveKeywords,
  overlapScore,
  parseAnalysisContent,
  summarize,
  tokenize,
} from './issue.analysis';
import {
  CAUSE_DIMENSIONS,
  DEFAULT_ISSUE_AI_CONFIG,
  ISSUE_AI_CONFIG_KEY,
  ISSUE_AI_MAX_TOKENS,
  ISSUE_AI_TIMEOUT_MS,
  ISSUE_TASK_TTL_MS,
  isReusableStatus,
  SEVERITY_WEIGHT,
  statusGroupOf,
  type CauseDimension,
  type IssueAiConfig,
  type IssueAttachment,
  type PossibleCause,
  type RootCauseAnalysis,
  type Severity,
  type SolutionType,
} from './issue.constants';
import { CreateIssueDto, IssueAttachmentInputDto } from './dto/create-issue.dto';
import { ListIssuesQueryDto } from './dto/list-issues-query.dto';
import {
  AdoptIssueDto,
  ProcessAttachmentDto,
  SaveAiConfigDto,
  SendChatDto,
} from './dto/issue-actions.dto';

/** 控制器构造好的精简用户上下文。 */
export interface IssueActor {
  userId: string;
  name: string;
  permissions: string[];
}

/** 内部存储用附件结构（含 objectKey，用于重签预览 URL；对外投影时剥离）。 */
type StoredIssueAttachment = {
  fileId: string;
  name: string;
  mime: string;
  size: number;
  objectKey: string;
  extractedText?: string;
  uploadedBy: string;
  uploadedAt: string;
};

const SIMILAR_THRESHOLD = 0.18;
/** 向量相似度阈值（余弦）。低于此值视为不相关；同域问题通常 ≥0.45。 */
const SIMILAR_VECTOR_THRESHOLD = 0.45;
const HISTORY_TURNS = 12;

@Injectable()
export class IssueService {
  private readonly logger = new Logger(IssueService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chatService: ChatService,
    private readonly attachmentService: ChatAttachmentService,
    private readonly ragService: RagService,
  ) {}

  // ── 异步任务（长耗时 AI 分析改 taskId + 轮询，绕开反代单请求超时）─────────────
  // 注意：内存 Map，假设 API 单实例；多实例/重启会丢任务（与 image-generation 异步同款约束）。
  private readonly tasks = new Map<
    string,
    { status: 'pending' | 'done' | 'error'; result?: unknown; error?: string; at: number }
  >();

  private startTask(fn: () => Promise<unknown>): string {
    this.pruneTasks();
    const taskId = randomUUID();
    this.tasks.set(taskId, { status: 'pending', at: Date.now() });
    void fn().then(
      (result) => this.tasks.set(taskId, { status: 'done', result, at: Date.now() }),
      (err) => {
        this.logger.warn(`issue 任务 ${taskId} 失败：${err instanceof Error ? err.message : err}`);
        this.tasks.set(taskId, {
          status: 'error',
          error: err instanceof Error ? err.message : 'AI 处理失败',
          at: Date.now(),
        });
      },
    );
    return taskId;
  }

  private pruneTasks() {
    const cutoff = Date.now() - ISSUE_TASK_TTL_MS;
    for (const [k, v] of this.tasks) if (v.at < cutoff) this.tasks.delete(k);
  }

  getTask(taskId: string) {
    const t = this.tasks.get(taskId);
    if (!t) throw new NotFoundException('任务不存在或已过期');
    return {
      status: t.status,
      ...(t.result !== undefined ? { result: t.result } : {}),
      ...(t.error ? { error: t.error } : {}),
    };
  }

  startAnalyze(id: string, actor: IssueActor, model?: string): string {
    return this.startTask(() => this.analyze(id, actor, model));
  }

  startAdjust(id: string, message: string, actor: IssueActor, model?: string): string {
    return this.startTask(() => this.adjust(id, message, actor, model));
  }

  startChat(id: string, dto: SendChatDto, actor: IssueActor): string {
    return this.startTask(() => this.sendChat(id, dto, actor));
  }

  // ── 查询 ───────────────────────────────────────────────────────────────────

  async list(query: ListIssuesQueryDto) {
    const where: Prisma.IssueWhereInput = {};
    if (query.severity) where.severity = query.severity;
    if (query.source) where.source = query.source;
    if (query.product) where.product = query.product;
    if (query.statusGroup && query.statusGroup !== 'all') {
      if (query.statusGroup === 'reusable') where.status = { in: ['adopted', 'archived'] };
      else if (query.statusGroup === 'pending') where.status = 'pending';
      else if (query.statusGroup === 'processing') where.status = { in: ['analyzing', 'adjusting'] };
      else if (query.statusGroup === 'solved') where.status = { in: ['adopted', 'archived'] };
    }
    if (query.search?.trim()) {
      const s = query.search.trim();
      where.OR = [
        { id: { contains: s, mode: 'insensitive' } },
        { title: { contains: s, mode: 'insensitive' } },
        { product: { contains: s, mode: 'insensitive' } },
        { description: { contains: s, mode: 'insensitive' } },
      ];
    }

    const rows = await this.prisma.issue.findMany({
      where,
      include: { analyses: { orderBy: { version: 'asc' } } },
    });

    // 维度 / 具体根因过滤需基于"最新分析"，在内存里做
    let items = rows;
    if (query.dimension || query.specificCause) {
      items = rows.filter((row) => {
        const latest = row.analyses[row.analyses.length - 1];
        if (!latest) return false;
        const content = latest.content as unknown as RootCauseAnalysis;
        const causes = content?.possibleCauses ?? [];
        if (query.dimension && !causes.some((c) => c.dimension === query.dimension)) return false;
        if (query.specificCause && !causes.some((c) => c.cause === query.specificCause)) return false;
        return true;
      });
    }

    items.sort((a, b) => {
      const t = b.updatedAt.getTime() - a.updatedAt.getTime();
      if (t !== 0) return t;
      return SEVERITY_WEIGHT[b.severity as Severity] - SEVERITY_WEIGHT[a.severity as Severity];
    });

    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.max(1, query.pageSize ?? 6);
    const total = items.length;
    const slice = items.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);
    return {
      items: slice.map((row) => this.toIssueView(row, [])),
      total,
      page,
      pageSize,
    };
  }

  async get(id: string) {
    const row = await this.loadFull(id);
    return this.toIssueView(row, row.messages);
  }

  // ── 创建 / 相似 ─────────────────────────────────────────────────────────────

  async create(dto: CreateIssueDto, actor: IssueActor) {
    const id = await this.nextIssueId();
    const attachments = await this.resolveAttachments(dto.attachments ?? [], actor);
    const row = await this.prisma.issue.create({
      data: {
        id,
        title: dto.title,
        description: dto.description,
        // 来源/严重度表单已移除：缺省兜底，保证 DB 非空列与列表/详情徽章正常显示。
        source: dto.source ?? 'production',
        product: dto.product ?? null,
        batch: dto.batch ?? null,
        station: dto.station ?? null,
        severity: dto.severity ?? 'normal',
        defectRate: dto.defectRate ?? null,
        status: 'pending',
        keywords: deriveKeywords(dto.title, dto.description),
        attachments: attachments as unknown as Prisma.InputJsonValue,
        createdBy: actor.name,
        createdById: actor.userId,
      },
      include: { analyses: true, messages: true },
    });
    return this.toIssueView(row, row.messages);
  }

  /**
   * 查相似可复用问题：优先 RAG 向量语义检索（跨表述命中，如"温升高"≈"过热"），
   * 无嵌入模型 / 检索失败 / 无命中时降级到关键词重叠（与早期实现一致），保证可用性。
   */
  async findSimilar(dto: CreateIssueDto, actor: IssueActor) {
    try {
      const resp = await this.ragService.search(
        `${dto.title}\n${dto.description}`,
        { userId: actor.userId, permissions: actor.permissions },
        { sourceTypes: ['issue'], topK: 12, threshold: SIMILAR_VECTOR_THRESHOLD },
      );
      if (resp.results.length > 0) {
        // 一个问题可能切成多个 chunk，按 sourceId 去重取最高相似度
        const bySource = new Map<string, number>();
        for (const r of resp.results) {
          bySource.set(r.sourceId, Math.max(bySource.get(r.sourceId) ?? 0, r.similarity));
        }
        const rows = await this.prisma.issue.findMany({
          where: { id: { in: [...bySource.keys()] }, status: { in: ['adopted', 'archived'] } },
          include: { analyses: { orderBy: { version: 'asc' } } },
        });
        const matches = rows
          .map((row) => ({
            issue: this.toIssueView(row, []),
            score: Math.round((bySource.get(row.id) ?? 0) * 100) / 100,
            adoptedSolution: this.adoptedSolutionSummary(row),
          }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 5);
        if (matches.length > 0) return matches;
      }
    } catch (e) {
      this.logger.warn(
        `findSimilar 向量检索失败，降级关键词：${e instanceof Error ? e.message : e}`,
      );
    }
    return this.findSimilarByKeyword(dto);
  }

  /** 关键词重叠兜底（无嵌入模型时仍可用）。 */
  private async findSimilarByKeyword(dto: CreateIssueDto) {
    const inputTokens = new Set(tokenize(`${dto.title} ${dto.description}`));
    const reusable = await this.prisma.issue.findMany({
      where: { status: { in: ['adopted', 'archived'] } },
      include: { analyses: { orderBy: { version: 'asc' } } },
    });
    const scored = reusable
      .map((row) => ({
        row,
        score: overlapScore(inputTokens, { keywords: row.keywords, title: row.title }),
      }))
      .filter((x) => x.score >= SIMILAR_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    return scored.map(({ row, score }) => ({
      issue: this.toIssueView(row, []),
      score: Math.round(score * 100) / 100,
      adoptedSolution: this.adoptedSolutionSummary(row),
    }));
  }

  /**
   * 把已成为「可复用」（adopted/archived）的问题写入 RAG 索引（sourceType=issue）。
   * best-effort：无嵌入模型或索引失败只告警，绝不影响 adopt/resolve 主流程。
   * issue 不设权限元数据 → 模块内对所有有页面权限的人可见。
   */
  /**
   * 全量回填：把所有可复用状态的问题重新 embedding 写入向量库。
   * 适用于：首次开启 RAG / 切换 embedding 模型 / 存量问题在接入索引前创建。
   */
  async backfillAllIssuesToRag(): Promise<{ total: number; succeeded: number; failed: number }> {
    const rows = await this.prisma.issue.findMany({ select: { id: true, status: true } });
    const targets = rows.filter((r) => isReusableStatus(r.status));
    let succeeded = 0;
    let failed = 0;
    for (const row of targets) {
      try {
        await this.indexIssue(row.id);
        succeeded += 1;
      } catch {
        failed += 1;
      }
    }
    return { total: targets.length, succeeded, failed };
  }

  private async indexIssue(issueId: string): Promise<void> {
    try {
      const row = await this.prisma.issue.findUnique({
        where: { id: issueId },
        include: { analyses: { orderBy: { version: 'asc' } } },
      });
      if (!row || !isReusableStatus(row.status)) return;
      const adoptedSol = this.adoptedSolutionSummary(row);
      const parts = [row.title, row.description, (row.keywords ?? []).join(' ')];
      if (adoptedSol) parts.push(`采纳根因：${adoptedSol.cause}。处理方案：${adoptedSol.action}`);
      await this.ragService.syncDocument({
        sourceType: 'issue',
        sourceId: row.id,
        title: row.title,
        text: parts.filter(Boolean).join('\n'),
        metadata: {
          title: row.title,
          source: row.source,
          ...(row.product ? { product: row.product } : {}),
          severity: row.severity,
          // 检索门槛：与页面访问同口径——没有问题模块页面码的用户不应通过 AI 检索到问题库内容
          required_any_permissions: ['page:issue-ai'],
        },
      });
    } catch (e) {
      this.logger.warn(
        `issue ${issueId} RAG 索引失败（不影响业务）：${e instanceof Error ? e.message : e}`,
      );
    }
  }

  // ── 分析 / 调整 / 沟通 ───────────────────────────────────────────────────────

  async analyze(id: string, actor: IssueActor, model?: string) {
    const row = await this.loadFull(id);
    const hadAnalyses = row.analyses.length > 0;
    const analysis = await this.runAnalysis(row, {
      actor,
      model,
      triggerType: hadAnalyses ? 'adjustment' : 'initial',
    });
    await this.prisma.issue.update({
      where: { id },
      data: { status: hadAnalyses ? 'adjusting' : 'analyzing' },
    });
    await this.appendMessage(id, {
      role: 'assistant',
      content: hadAnalyses
        ? `已重新生成分析（v${analysis.version}）：${analysis.summary}`
        : `已生成初版根因分析（v${analysis.version}）：${analysis.summary}`,
      analysisVersionId: analysis.id,
      model: analysis.model,
    });
    return this.toAnalysisView(analysis);
  }

  async adjust(id: string, message: string, actor: IssueActor, model?: string) {
    const row = await this.loadFull(id);
    const userMsg = await this.appendMessage(id, {
      role: 'user',
      content: message,
      operator: actor.name,
      author: { id: actor.userId, name: actor.name },
    });
    const analysis = await this.runAnalysis(row, {
      actor,
      model,
      triggerType: 'adjustment',
      followUp: message,
    });
    await this.prisma.issue.update({ where: { id }, data: { status: 'adjusting' } });
    const assistantMsg = await this.appendMessage(id, {
      role: 'assistant',
      content: `已根据反馈更新分析（v${analysis.version}）：${analysis.summary}`,
      analysisVersionId: analysis.id,
      model: analysis.model,
    });
    return { message: this.toMessageView(assistantMsg), analysis: this.toAnalysisView(analysis) };
  }

  async sendChat(id: string, dto: SendChatDto, actor: IssueActor) {
    const row = await this.loadFull(id);
    const content = (dto.content ?? '').trim();
    const stored = await this.resolveAttachments(dto.attachments ?? [], actor);

    const userMsg = await this.appendMessage(id, {
      role: 'user',
      content,
      author: { id: actor.userId, name: actor.name },
      operator: actor.name,
      attachments: stored,
    });

    const analysis = await this.runAnalysis(row, {
      actor,
      model: dto.model,
      triggerType: row.analyses.length > 0 ? 'adjustment' : 'initial',
      followUp: content || '（用户上传了附件，请结合附件内容更新判断）',
      extraAttachments: stored,
    });
    await this.prisma.issue.update({ where: { id }, data: { status: 'adjusting' } });

    const aiMsg = await this.appendMessage(id, {
      role: 'assistant',
      content: `已结合本轮沟通更新论证（v${analysis.version}）。最可能方向：${analysis.summary}`,
      analysisVersionId: analysis.id,
      model: analysis.model,
    });

    return {
      userMessage: this.toMessageView(userMsg),
      aiMessage: this.toMessageView(aiMsg),
      analysis: this.toAnalysisView(analysis),
    };
  }

  // ── 采纳 / 定性 ───────────────────────────────────────────────────────────────

  async adopt(id: string, dto: AdoptIssueDto, actor: IssueActor) {
    const row = await this.loadFull(id);
    let adopted: Prisma.InputJsonValue;
    let content: string;

    if (dto.kind === 'reuse') {
      if (!dto.reusedFrom) throw new NotFoundException('缺少 reusedFrom');
      adopted = { kind: 'reuse', reusedFrom: dto.reusedFrom };
      const src = await this.prisma.issue.findUnique({
        where: { id: dto.reusedFrom },
        include: { analyses: { orderBy: { version: 'asc' } } },
      });
      const summary = src ? this.adoptedSolutionSummary(src) : undefined;
      content = summary
        ? `复用自 ${dto.reusedFrom}：${summary.cause} → ${summary.action}`
        : `复用自 ${dto.reusedFrom}。`;
    } else {
      if (!dto.causeId || !dto.solutionId) throw new NotFoundException('缺少 causeId/solutionId');
      adopted = { kind: 'analysis', causeId: dto.causeId, solutionId: dto.solutionId };
      // 标记包含该 cause 的最新版本为已采纳
      const matching = row.analyses.filter((a) => {
        const c = (a.content as unknown as RootCauseAnalysis)?.possibleCauses ?? [];
        return c.some((x) => x.id === dto.causeId);
      });
      const target = matching.length
        ? matching.reduce((x, y) => (y.version > x.version ? y : x))
        : row.analyses[row.analyses.length - 1];
      if (target) {
        await this.prisma.issueAnalysis.updateMany({
          where: { issueId: id },
          data: { isAdopted: false },
        });
        await this.prisma.issueAnalysis.update({
          where: { id: target.id },
          data: { isAdopted: true },
        });
      }
      const summary = this.adoptedSolutionSummary({ ...row, adopted });
      content = summary ? `已采纳方案：${summary.cause} → ${summary.action}` : '已采纳方案。';
    }

    await this.prisma.issue.update({ where: { id }, data: { adopted, status: 'adopted' } });
    await this.appendMessage(id, { role: 'assistant', content });
    // 已采纳 → 进入「可复用」知识库，写入 RAG 向量索引（best-effort）
    await this.indexIssue(id);
    return this.get(id);
  }

  async resolveIssue(id: string, resolved: boolean, note: string | undefined, actor: IssueActor) {
    await this.loadFull(id);
    const resolution = {
      resolved,
      by: { id: actor.userId, name: actor.name },
      at: new Date().toISOString(),
      ...(note ? { note } : {}),
    };
    await this.prisma.issue.update({
      where: { id },
      data: {
        resolution: resolution as Prisma.InputJsonValue,
        ...(resolved ? { status: 'archived' } : {}),
      },
    });
    await this.appendMessage(id, {
      role: 'user',
      content: `判定问题${resolved ? '已解决' : '未解决'}${note ? `：${note}` : ''}`,
      author: { id: actor.userId, name: actor.name },
      operator: actor.name,
    });
    // 已解决归档 → 进入「可复用」知识库，写入/刷新 RAG 索引（best-effort，自带可复用状态判断）
    await this.indexIssue(id);
    return this.get(id);
  }

  // ── 统计 ───────────────────────────────────────────────────────────────────

  async stats() {
    const rows = await this.prisma.issue.findMany({
      select: { status: true, adopted: true, createdAt: true, updatedAt: true },
    });
    let pending = 0;
    let solved = 0;
    let reuseAdopted = 0;
    let locateHoursSum = 0;
    let solvedWithTime = 0;
    for (const i of rows) {
      if (i.status === 'pending' || i.status === 'analyzing' || i.status === 'adjusting') pending += 1;
      if (i.status === 'adopted' || i.status === 'archived') {
        solved += 1;
        const adopted = i.adopted as { kind?: string } | null;
        if (adopted?.kind === 'reuse') reuseAdopted += 1;
        const c = i.createdAt.getTime();
        const u = i.updatedAt.getTime();
        if (u >= c) {
          locateHoursSum += (u - c) / 3_600_000;
          solvedWithTime += 1;
        }
      }
    }
    const reuseRate = solved > 0 ? reuseAdopted / solved : 0;
    const avgLocateHours = solvedWithTime > 0 ? Math.round((locateHoursSum / solvedWithTime) * 10) / 10 : 0;
    return {
      total: rows.length,
      pending,
      solved,
      reuseRate: Math.round(reuseRate * 100) / 100,
      avgLocateHours,
    };
  }

  async dimensionStats() {
    const rows = await this.prisma.issue.findMany({
      include: { analyses: { orderBy: { version: 'asc' } } },
    });
    const dimCount = new Map<CauseDimension, number>();
    const dimSpecifics = new Map<CauseDimension, Map<string, number>>();
    for (const d of CAUSE_DIMENSIONS) {
      dimCount.set(d, 0);
      dimSpecifics.set(d, new Map());
    }
    for (const row of rows) {
      const latest = row.analyses[row.analyses.length - 1];
      if (!latest) continue;
      const causes = (latest.content as unknown as RootCauseAnalysis)?.possibleCauses ?? [];
      for (const c of causes) {
        if (!dimCount.has(c.dimension)) continue;
        dimCount.set(c.dimension, (dimCount.get(c.dimension) || 0) + 1);
        const m = dimSpecifics.get(c.dimension)!;
        m.set(c.cause, (m.get(c.cause) || 0) + 1);
      }
    }
    return CAUSE_DIMENSIONS.map((d) => ({
      dimension: d,
      count: dimCount.get(d) || 0,
      specifics: Array.from(dimSpecifics.get(d)!.entries())
        .map(([cause, count]) => ({ cause, count }))
        .sort((a, b) => b.count - a.count),
    }));
  }

  async productOptions(): Promise<string[]> {
    const rows = await this.prisma.issue.findMany({
      where: { product: { not: null } },
      select: { product: true },
      distinct: ['product'],
      orderBy: { product: 'asc' },
    });
    return rows.map((r) => r.product!).filter((p) => p && p.trim());
  }

  // ── AI 配置 / 模型 / 附件 ─────────────────────────────────────────────────────

  async getAiConfig(): Promise<IssueAiConfig> {
    const setting = await this.prisma.systemSetting.findUnique({ where: { key: ISSUE_AI_CONFIG_KEY } });
    if (!setting?.value || typeof setting.value !== 'object') return { ...DEFAULT_ISSUE_AI_CONFIG };
    const v = setting.value as Record<string, unknown>;
    return {
      model: typeof v.model === 'string' ? v.model : DEFAULT_ISSUE_AI_CONFIG.model,
      temperature: typeof v.temperature === 'number' ? v.temperature : DEFAULT_ISSUE_AI_CONFIG.temperature,
      systemPrompt: typeof v.systemPrompt === 'string' ? v.systemPrompt : DEFAULT_ISSUE_AI_CONFIG.systemPrompt,
      attachmentMode: v.attachmentMode === 'ocr' ? 'ocr' : 'ai',
    };
  }

  async setAiConfig(dto: SaveAiConfigDto): Promise<IssueAiConfig> {
    const config: IssueAiConfig = {
      model: dto.model ?? '',
      temperature: typeof dto.temperature === 'number' ? dto.temperature : DEFAULT_ISSUE_AI_CONFIG.temperature,
      systemPrompt: dto.systemPrompt ?? DEFAULT_ISSUE_AI_CONFIG.systemPrompt,
      attachmentMode: dto.attachmentMode,
    };
    await this.prisma.systemSetting.upsert({
      where: { key: ISSUE_AI_CONFIG_KEY },
      create: { key: ISSUE_AI_CONFIG_KEY, category: 'issue', value: config as unknown as Prisma.InputJsonValue },
      update: { value: config as unknown as Prisma.InputJsonValue },
    });
    return config;
  }

  /** 复用 MateChat 的模型列表，映射成前端 AiModelChoice。 */
  async listAiModels() {
    const models = await this.chatService.listModels();
    return models.map((m) => {
      const multimodal = m.usage_kind === 'multimodal';
      return {
        value: m.id,
        label: m.label,
        provider: m.provider,
        model: m.model,
        usageKind: multimodal ? ('multimodal' as const) : ('text' as const),
        usageLabel: multimodal ? '文本·图片' : '文本',
      };
    });
  }

  async processAttachment(dto: ProcessAttachmentDto, actor: IssueActor) {
    const [stored] = await this.attachmentService.resolveOwned(actor.userId, [{ fileId: dto.fileId }]);
    if (!stored) return { extractedText: undefined };
    if (this.attachmentService.isImage(stored.mime)) {
      // 图片：ai 模式留给对话时多模态识别；ocr 模式暂无独立 OCR 服务，回填提示
      return {
        extractedText:
          dto.mode === 'ocr'
            ? `[图片 ${stored.name}]（OCR 文本提取暂未接入，将在对话中交由多模态模型识别）`
            : undefined,
      };
    }
    const text = await this.attachmentService.extractDocumentText(stored);
    return { extractedText: text ?? undefined };
  }

  // ── 内部：AI 分析核心 ─────────────────────────────────────────────────────────

  private async runAnalysis(
    row: FullIssue,
    opts: {
      actor: IssueActor;
      model?: string;
      triggerType: 'initial' | 'adjustment';
      followUp?: string;
      extraAttachments?: StoredIssueAttachment[];
    },
  ) {
    const config = await this.getAiConfig();
    const modelId = opts.model?.trim() || config.model || undefined;

    // 收集附件文本 + 图片
    const storedAtts: StoredIssueAttachment[] = [
      ...this.normalizeStoredAttachments(row.attachments),
      ...(opts.extraAttachments ?? []),
    ];
    const attachmentsText = storedAtts
      .map((a) => (a.extractedText ? `【附件：${a.name}】\n${a.extractedText}` : ''))
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 12000);

    const images: string[] = [];
    if (config.attachmentMode === 'ai') {
      for (const a of storedAtts) {
        if (this.attachmentService.isImage(a.mime) && a.objectKey) {
          const dataUrl = await this.attachmentService
            .buildImageDataUrl({
              fileId: a.fileId,
              name: a.name,
              mime: a.mime,
              size: a.size,
              objectKey: a.objectKey,
            })
            .catch(() => null);
          if (dataUrl) images.push(dataUrl);
        }
      }
    }

    const history = this.buildHistory(row);
    const userPrompt = buildAnalysisUserPrompt({
      title: row.title,
      description: row.description,
      source: row.source,
      product: row.product,
      batch: row.batch,
      station: row.station,
      severity: row.severity,
      defectRate: row.defectRate,
      attachmentsText: attachmentsText || undefined,
      history: history || undefined,
      followUp: opts.followUp,
    });

    const mkId = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}`;
    let content: RootCauseAnalysis | null = null;
    let usedModel = 'heuristic';
    try {
      const result = await this.chatService.complete({
        modelId,
        system: buildAnalysisSystemPrompt(config.systemPrompt),
        messages: [{ role: 'user', content: userPrompt }],
        images,
        json: true,
        temperature: config.temperature,
        timeoutMs: ISSUE_AI_TIMEOUT_MS,
        // 不重试：超时直接降级启发式，避免重试把等待翻倍（已异步，无需为反代抢时间）。
        maxRetries: 0,
        maxTokens: ISSUE_AI_MAX_TOKENS,
      });
      usedModel = result.model;
      content = parseAnalysisContent(result.content, mkId);
      if (!content) this.logger.warn(`issue ${row.id} AI 输出无法解析，降级启发式`);
    } catch (err) {
      this.logger.warn(`issue ${row.id} AI 调用失败，降级启发式：${err instanceof Error ? err.message : err}`);
    }

    if (!content) {
      const haystack = `${row.title} ${row.description} ${(row.keywords || []).join(' ')} ${opts.followUp ?? ''}`;
      const causes = buildHeuristicCauses(haystack, mkId);
      content = { possibleCauses: causes, summary: summarize(causes), referencedCases: [] };
    }

    // 参考相似历史问题编号（RAG 向量优先）
    content.referencedCases = await this.computeReferencedCases(row, opts.actor);

    // 版本号并发安全：从 DB 取最新 version，撞 @@unique 时重算重试。
    const created = await this.createAnalysisWithRetry(row.id, {
      content: content as unknown as Prisma.InputJsonValue,
      summary: content.summary,
      model: usedModel,
      triggerType: opts.triggerType,
      createdBy: usedModel === 'heuristic' ? 'system' : 'AI',
    });
    // 让调用方拿到最新 analyses 状态
    row.analyses.push(created);
    return created;
  }

  private static isUniqueViolation(e: unknown): boolean {
    return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
  }

  private async createAnalysisWithRetry(
    issueId: string,
    payload: {
      content: Prisma.InputJsonValue;
      summary: string;
      model: string;
      triggerType: string;
      createdBy: string;
    },
  ): Promise<AnalysisRow> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const last = await this.prisma.issueAnalysis.findFirst({
        where: { issueId },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const version = (last?.version ?? 0) + 1;
      try {
        return await this.prisma.issueAnalysis.create({
          data: {
            issueId,
            version,
            basedOnVersion: last?.version ?? null,
            isAdopted: false,
            ...payload,
          },
        });
      } catch (e) {
        if (IssueService.isUniqueViolation(e) && attempt < 4) continue;
        throw e;
      }
    }
    throw new Error('createAnalysisWithRetry: 版本号竞争重试超限');
  }

  private async computeReferencedCases(row: FullIssue, actor: IssueActor): Promise<string[]> {
    // RAG 向量优先：语义匹配历史可复用问题（命中即采信，包括"无命中→空"）
    try {
      const resp = await this.ragService.search(
        `${row.title}\n${row.description}`,
        { userId: actor.userId, permissions: actor.permissions },
        { sourceTypes: ['issue'], topK: 6, threshold: SIMILAR_VECTOR_THRESHOLD },
      );
      return [...new Set(resp.results.map((r) => r.sourceId))].filter((id) => id !== row.id).slice(0, 3);
    } catch (e) {
      this.logger.warn(
        `computeReferencedCases 向量失败，降级关键词：${e instanceof Error ? e.message : e}`,
      );
    }
    // 关键词兜底（无嵌入模型时）
    const inputTokens = new Set(tokenize(`${row.title} ${row.description}`));
    const reusable = await this.prisma.issue.findMany({
      where: { status: { in: ['adopted', 'archived'] }, id: { not: row.id } },
      select: { id: true, title: true, keywords: true },
    });
    return reusable
      .map((r) => ({ id: r.id, score: overlapScore(inputTokens, { keywords: r.keywords, title: r.title }) }))
      .filter((x) => x.score >= SIMILAR_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((x) => x.id);
  }

  private buildHistory(row: FullIssue): string {
    const lines: string[] = [];
    const recentMsgs = row.messages.slice(-HISTORY_TURNS);
    for (const m of recentMsgs) {
      const who = m.role === 'assistant' ? 'AI' : (m.operator || '用户');
      lines.push(`${who}：${m.content}`);
    }
    const latest = row.analyses[row.analyses.length - 1];
    if (latest) {
      lines.push(`（已有分析 v${latest.version}）：${latest.summary}`);
    }
    return lines.join('\n').slice(0, 4000);
  }

  // ── 内部：附件 ─────────────────────────────────────────────────────────────

  private async resolveAttachments(
    inputs: IssueAttachmentInputDto[],
    actor: IssueActor,
  ): Promise<StoredIssueAttachment[]> {
    const withId = inputs.filter((a) => a.id);
    const resolved = withId.length
      ? await this.attachmentService.resolveOwned(
          actor.userId,
          withId.map((a) => ({ fileId: a.id! })),
        )
      : [];
    const byId = new Map<string, StoredChatAttachment>(resolved.map((r) => [r.fileId, r]));
    const now = new Date().toISOString();
    const out: StoredIssueAttachment[] = [];
    for (const input of inputs) {
      const r = input.id ? byId.get(input.id) : undefined;
      if (r) {
        out.push({
          fileId: r.fileId,
          name: r.name,
          mime: r.mime,
          size: r.size,
          objectKey: r.objectKey,
          extractedText: input.extractedText,
          uploadedBy: actor.name,
          uploadedAt: now,
        });
      } else if (input.fileName) {
        // 无法回查（无 fileId 或越权）：保留为纯展示附件
        out.push({
          fileId: input.id ?? '',
          name: input.fileName,
          mime: input.fileType,
          size: 0,
          objectKey: '',
          extractedText: input.extractedText,
          uploadedBy: actor.name,
          uploadedAt: now,
        });
      }
    }
    return out;
  }

  private normalizeStoredAttachments(raw: unknown): StoredIssueAttachment[] {
    if (!Array.isArray(raw)) return [];
    const out: StoredIssueAttachment[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      out.push({
        fileId: typeof o.fileId === 'string' ? o.fileId : '',
        name: typeof o.name === 'string' ? o.name : '附件',
        mime: typeof o.mime === 'string' ? o.mime : 'application/octet-stream',
        size: typeof o.size === 'number' ? o.size : 0,
        objectKey: typeof o.objectKey === 'string' ? o.objectKey : '',
        extractedText: typeof o.extractedText === 'string' ? o.extractedText : undefined,
        uploadedBy: typeof o.uploadedBy === 'string' ? o.uploadedBy : '',
        uploadedAt: typeof o.uploadedAt === 'string' ? o.uploadedAt : new Date(0).toISOString(),
      });
    }
    return out;
  }

  /** 内部存储附件 → 前端 Attachment（补新鲜预览 URL，剥离 objectKey）。 */
  private projectAttachments(raw: unknown) {
    const stored = this.normalizeStoredAttachments(raw);
    const views = this.attachmentService.signForDisplay(
      stored.map((a) => ({
        fileId: a.fileId,
        name: a.name,
        mime: a.mime,
        size: a.size,
        objectKey: a.objectKey,
      })),
    );
    const urlByFileId = new Map(views.map((v) => [v.fileId, v.url]));
    return stored.map((a) => ({
      id: a.fileId || a.name,
      fileName: a.name,
      fileUrl: urlByFileId.get(a.fileId) ?? '',
      fileType: a.mime,
      extractedText: a.extractedText,
      uploadedBy: a.uploadedBy,
      uploadedAt: a.uploadedAt,
    }));
  }

  // ── 内部：通用 ─────────────────────────────────────────────────────────────

  private async loadFull(id: string): Promise<FullIssue> {
    const row = await this.prisma.issue.findUnique({
      where: { id },
      include: {
        analyses: { orderBy: { version: 'asc' } },
        messages: { orderBy: { seq: 'asc' } },
      },
    });
    if (!row) throw new NotFoundException(`问题不存在：${id}`);
    return row;
  }

  private async appendMessage(
    issueId: string,
    msg: {
      role: 'user' | 'assistant';
      content: string;
      author?: { id: string; name: string };
      operator?: string;
      attachments?: StoredIssueAttachment[];
      analysisVersionId?: string;
      model?: string;
    },
  ) {
    const data = {
      role: msg.role,
      content: msg.content,
      author: msg.author ? (msg.author as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
      operator: msg.operator ?? null,
      attachments: msg.attachments?.length
        ? (msg.attachments as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull,
      analysisVersionId: msg.analysisVersionId ?? null,
      model: msg.model ?? null,
    };
    // seq 并发安全：撞 @@unique([issueId, seq]) 时重算重试。
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const last = await this.prisma.issueMessage.findFirst({
        where: { issueId },
        orderBy: { seq: 'desc' },
        select: { seq: true },
      });
      const seq = (last?.seq ?? 0) + 1;
      try {
        return await this.prisma.issueMessage.create({ data: { issueId, seq, ...data } });
      } catch (e) {
        if (IssueService.isUniqueViolation(e) && attempt < 4) continue;
        throw e;
      }
    }
    throw new Error('appendMessage: 序号竞争重试超限');
  }

  private async nextIssueId(): Promise<string> {
    const now = new Date();
    const yy = String(now.getFullYear()).slice(2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const prefix = `NCR-${yy}${mm}-`;
    const rows = await this.prisma.issue.findMany({
      where: { id: { startsWith: prefix } },
      select: { id: true },
    });
    let max = 0;
    for (const r of rows) {
      const m = /-(\d+)$/.exec(r.id);
      if (m) max = Math.max(max, Number(m[1]));
    }
    return `${prefix}${String(max + 1).padStart(3, '0')}`;
  }

  private adoptedSolutionSummary(
    issue: { adopted: unknown; analyses: Array<{ content: unknown; isAdopted: boolean; version: number }> },
  ): { cause: string; action: string; type: SolutionType } | undefined {
    const ad = issue.adopted as
      | { kind: 'analysis'; causeId: string; solutionId: string }
      | { kind: 'reuse'; reusedFrom: string }
      | null;
    if (!ad || ad.kind !== 'analysis') return undefined;
    const adoptedAv =
      issue.analyses.find((a) => a.isAdopted) ??
      issue.analyses.reduce<(typeof issue.analyses)[number] | undefined>(
        (acc, a) => (!acc || a.version > acc.version ? a : acc),
        undefined,
      );
    if (!adoptedAv) return undefined;
    const causes = (adoptedAv.content as unknown as RootCauseAnalysis)?.possibleCauses ?? [];
    const cause = causes.find((c) => c.id === ad.causeId);
    if (!cause) return undefined;
    const sol = cause.solutions.find((s) => s.id === ad.solutionId) || cause.solutions[0];
    if (!sol) return undefined;
    return { cause: cause.cause, action: sol.action, type: sol.type };
  }

  // ── 内部：视图映射 ───────────────────────────────────────────────────────────

  private toIssueView(row: IssueRow & { analyses: AnalysisRow[] }, messages: MessageRow[]) {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      source: row.source,
      product: row.product ?? undefined,
      batch: row.batch ?? undefined,
      station: row.station ?? undefined,
      severity: row.severity,
      defectRate: row.defectRate ?? undefined,
      status: row.status,
      adopted: (row.adopted as unknown) ?? undefined,
      keywords: row.keywords,
      resolution: (row.resolution as unknown) ?? undefined,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      attachments: this.projectAttachments(row.attachments),
      analyses: row.analyses.map((a) => this.toAnalysisView(a)),
      messages: messages.map((m) => this.toMessageView(m)),
    };
  }

  private toAnalysisView(a: AnalysisRow) {
    return {
      id: a.id,
      version: a.version,
      content: a.content as unknown as RootCauseAnalysis,
      summary: a.summary,
      model: a.model,
      triggerType: a.triggerType,
      basedOnVersion: a.basedOnVersion ?? undefined,
      createdBy: a.createdBy,
      createdAt: a.createdAt.toISOString(),
      isAdopted: a.isAdopted,
    };
  }

  private toMessageView(m: MessageRow) {
    return {
      id: m.id,
      seq: m.seq,
      role: m.role,
      content: m.content,
      author: (m.author as unknown) ?? undefined,
      operator: m.operator ?? undefined,
      attachments: m.attachments ? this.projectAttachments(m.attachments) : undefined,
      analysisVersionId: m.analysisVersionId ?? undefined,
      model: m.model ?? undefined,
      createdAt: m.createdAt.toISOString(),
    };
  }
}

// ── Prisma 行类型别名（避免到处写 include 推导）─────────────────────────────────
type IssueRow = Prisma.IssueGetPayload<{}>;
type AnalysisRow = Prisma.IssueAnalysisGetPayload<{}>;
type MessageRow = Prisma.IssueMessageGetPayload<{}>;
type FullIssue = Prisma.IssueGetPayload<{ include: { analyses: true; messages: true } }>;
