import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { ChatService } from '../chat/chat.service';

/**
 * 物料初步分类流水线：规则优先、AI 兜底、结果直接应用。
 *
 * T+ 库存同步自动建档的物料没有分类（落「未分类」），本服务按三级流水线补齐：
 * 1. 名称【xxx】前缀 → 直接作为分类（确定性，覆盖大头）；
 * 2. 编码段反推：用已分类物料（含规则 1 结果）统计「编码首段 → 分类」的多数票，
 *    票数占比 ≥80% 且样本 ≥3 才采信，避免小样本误判；
 * 3. AI 兜底：剩余尾部批量交给对话模型（json 输出 + 置信度），置信度 ≥0.7 才应用，
 *    无把握的保持未分类并列入报告；AI 不可用时整体降级为只应用规则结果。
 *
 * 分类没有独立表（与「分类重命名」同一套逻辑），直接写物料冗余字段；
 * AI 应用的条目在 metadata.aiClassify 留痕，便于事后审计与纠正。
 */

const UNCATEGORIZED = '未分类';
// 大批次在推理模型上易超时（安全库存侧实测 40 条/60s 必超时），批次放小、超时放宽
const AI_BATCH_SIZE = 25;
const AI_TIMEOUT_MS = 120_000;
const AI_MAX_CONSECUTIVE_FAILURES = 2;
const AI_CONFIDENCE_THRESHOLD = 0.7;

interface UncatMaterial {
  id: string;
  name: string;
  erpCode: string;
  spec: string;
}

interface ClassifyPlan {
  uncategorized: UncatMaterial[];
  /** 规则命中：物料 id → 分类名（规则 1 与规则 2 合并，规则 1 优先）。 */
  ruleAssignments: Map<string, string>;
  rule1Count: number;
  rule2Count: number;
  /** 规则未命中、待 AI 的尾部。 */
  aiCandidates: UncatMaterial[];
  /** 候选分类词表：已有分类 + 规则新产出的分类。 */
  vocabulary: string[];
}

@Injectable()
export class MaterialClassifyService {
  private readonly logger = new Logger(MaterialClassifyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chatService: ChatService,
  ) {}

  private bracketCategory(name: string): string | null {
    const match = /^【([^】]{1,30})】/.exec(name.trim());
    return match ? match[1].trim() : null;
  }

  /** 编码首段（A01-001 → A01）：太短/太长的码段无区分度，丢弃。 */
  private codeSegment(erpCode: string): string | null {
    const seg = erpCode.trim().split(/[-/]/)[0];
    return /^[A-Za-z0-9]{2,6}$/.test(seg) ? seg : null;
  }

  private async buildPlan(): Promise<ClassifyPlan> {
    const all = await this.prisma.procMaterial.findMany({
      select: { id: true, name: true, erpCode: true, spec: true, category: true },
    });
    const uncategorized: UncatMaterial[] = [];
    const categorized: Array<{ erpCode: string; category: string }> = [];
    for (const m of all) {
      const cat = m.category.trim();
      if (!cat || cat === UNCATEGORIZED) {
        uncategorized.push({ id: m.id, name: m.name, erpCode: m.erpCode, spec: m.spec });
      } else {
        categorized.push({ erpCode: m.erpCode, category: cat });
      }
    }

    const ruleAssignments = new Map<string, string>();

    // 规则 1：名称【xxx】前缀
    let rule1Count = 0;
    for (const m of uncategorized) {
      const cat = this.bracketCategory(m.name);
      if (cat) {
        ruleAssignments.set(m.id, cat);
        rule1Count += 1;
      }
    }

    // 规则 2：码段多数票（票源 = 已分类物料 + 规则 1 结果）
    const votes = new Map<string, Map<string, number>>();
    const addVote = (erpCode: string, category: string) => {
      const seg = this.codeSegment(erpCode);
      if (!seg) return;
      const bucket = votes.get(seg) ?? new Map<string, number>();
      bucket.set(category, (bucket.get(category) ?? 0) + 1);
      votes.set(seg, bucket);
    };
    for (const m of categorized) addVote(m.erpCode, m.category);
    for (const m of uncategorized) {
      const cat = ruleAssignments.get(m.id);
      if (cat) addVote(m.erpCode, cat);
    }
    let rule2Count = 0;
    for (const m of uncategorized) {
      if (ruleAssignments.has(m.id)) continue;
      const seg = this.codeSegment(m.erpCode);
      const bucket = seg ? votes.get(seg) : undefined;
      if (!bucket) continue;
      const total = [...bucket.values()].reduce((a, b) => a + b, 0);
      const [topCat, topVotes] = [...bucket.entries()].sort((a, b) => b[1] - a[1])[0];
      if (total >= 3 && topVotes / total >= 0.8) {
        ruleAssignments.set(m.id, topCat);
        rule2Count += 1;
      }
    }

    const aiCandidates = uncategorized.filter((m) => !ruleAssignments.has(m.id));
    const vocabulary = [
      ...new Set([...categorized.map((c) => c.category), ...ruleAssignments.values()]),
    ].sort();

    return { uncategorized, ruleAssignments, rule1Count, rule2Count, aiCandidates, vocabulary };
  }

  /** 干跑：只统计不落库，给前端展示「规则能分多少、AI 要兜多少」+ 当前全库分类分布。 */
  async preview() {
    const plan = await this.buildPlan();
    const ruleCategories: Record<string, number> = {};
    for (const cat of plan.ruleAssignments.values()) {
      ruleCategories[cat] = (ruleCategories[cat] ?? 0) + 1;
    }
    // 当前全库分类分布：分类应用后的结果留存展示（每次打开都能看到最新分类情况）
    const grouped = await this.prisma.procMaterial.groupBy({ by: ['category'], _count: { _all: true } });
    const currentCategories: Record<string, number> = {};
    for (const g of grouped) {
      const cat = g.category.trim();
      if (cat && cat !== UNCATEGORIZED) currentCategories[cat] = g._count._all;
    }
    return {
      uncategorized: plan.uncategorized.length,
      rule1: plan.rule1Count,
      rule2: plan.rule2Count,
      aiPending: plan.aiCandidates.length,
      ruleCategories,
      currentCategories,
      aiSamples: plan.aiCandidates.slice(0, 10).map((m) => `${m.erpCode} ${m.name}`.trim()),
    };
  }

  /** 应用：规则结果批量落库，AI 兜底逐条落库并在 metadata 留痕。onProgress 供异步任务上报进度。 */
  async apply(actorId: string, onProgress?: (progress: string) => void) {
    const plan = await this.buildPlan();

    // 规则结果按分类分组 updateMany，避免上千条逐条写
    const byCategory = new Map<string, string[]>();
    for (const [id, cat] of plan.ruleAssignments) {
      const ids = byCategory.get(cat) ?? [];
      ids.push(id);
      byCategory.set(cat, ids);
    }
    let ruleApplied = 0;
    const ruleCategories: Record<string, number> = {};
    for (const [cat, ids] of byCategory) {
      const result = await this.prisma.procMaterial.updateMany({
        where: { id: { in: ids } },
        data: { category: cat },
      });
      ruleApplied += result.count;
      ruleCategories[cat] = result.count;
    }

    onProgress?.(`规则已应用 ${ruleApplied} 条，AI 判断 0/${plan.aiCandidates.length}`);

    const aiApplied: Array<{ code: string; name: string; category: string; confidence: number }> = [];
    const aiSkipped: Array<{ code: string; name: string; reason: string }> = [];
    let aiError: string | null = null;
    let model: string | null = null;

    let consecutiveFailures = 0;
    if (plan.aiCandidates.length > 0 && plan.vocabulary.length > 0) {
      for (let i = 0; i < plan.aiCandidates.length; i += AI_BATCH_SIZE) {
        onProgress?.(`规则已应用 ${ruleApplied} 条，AI 判断 ${i}/${plan.aiCandidates.length}`);
        const batch = plan.aiCandidates.slice(i, i + AI_BATCH_SIZE);
        try {
          const result = await this.classifyBatchWithAi(batch, plan.vocabulary);
          consecutiveFailures = 0;
          model = result.model;
          for (const m of batch) {
            const verdict = result.items.get(m.id);
            if (!verdict) {
              aiSkipped.push({ code: m.erpCode, name: m.name, reason: 'AI 未返回结果' });
              continue;
            }
            if (verdict.confidence < AI_CONFIDENCE_THRESHOLD || !verdict.category) {
              aiSkipped.push({ code: m.erpCode, name: m.name, reason: `置信度不足（${verdict.confidence.toFixed(2)}）` });
              continue;
            }
            const existing = await this.prisma.procMaterial.findUnique({
              where: { id: m.id },
              select: { metadata: true },
            });
            const meta = (existing?.metadata ?? {}) as Record<string, unknown>;
            await this.prisma.procMaterial.update({
              where: { id: m.id },
              data: {
                category: verdict.category,
                metadata: {
                  ...meta,
                  aiClassify: {
                    model: result.model,
                    confidence: verdict.confidence,
                    appliedBy: actorId,
                    appliedAt: new Date().toISOString(),
                  },
                } as Prisma.InputJsonObject,
              },
            });
            aiApplied.push({
              code: m.erpCode,
              name: m.name,
              category: verdict.category,
              confidence: verdict.confidence,
            });
          }
        } catch (error) {
          // 单批失败只弃当前批（偶发超时不拖累其余批次）；连续失败视为系统性问题止损退出
          aiError = (error as Error).message;
          consecutiveFailures += 1;
          for (const m of batch) {
            aiSkipped.push({ code: m.erpCode, name: m.name, reason: 'AI 调用失败' });
          }
          this.logger.warn(`物料 AI 分类第 ${Math.floor(i / AI_BATCH_SIZE) + 1} 批失败：${aiError}`);
          if (consecutiveFailures >= AI_MAX_CONSECUTIVE_FAILURES) {
            for (const m of plan.aiCandidates.slice(i + AI_BATCH_SIZE)) {
              aiSkipped.push({ code: m.erpCode, name: m.name, reason: 'AI 调用失败（提前止损）' });
            }
            break;
          }
        }
      }
    } else {
      for (const m of plan.aiCandidates) {
        aiSkipped.push({ code: m.erpCode, name: m.name, reason: '无候选分类词表' });
      }
    }

    this.logger.log(
      `物料分类完成：规则 ${ruleApplied} 条，AI ${aiApplied.length} 条，未分出 ${aiSkipped.length} 条`,
    );
    return { ruleApplied, ruleCategories, aiApplied, aiSkipped, aiError, model };
  }

  /** 单批 AI 分类：json 输出 { items: [{ code, category, confidence }] }，按编码回挂物料。 */
  private async classifyBatchWithAi(batch: UncatMaterial[], vocabulary: string[]) {
    // 编码可能为空，用行号做回挂键更稳
    const lines = batch.map((m, idx) => `${idx + 1}. 编码:${m.erpCode || '无'} 名称:${m.name}${m.spec ? ` 规格:${m.spec}` : ''}`);
    const result = await this.chatService.complete({
      system: [
        '你是制造业物料分类助手。把每个物料归入候选分类之一，只在确实无一适配时才允许给出新分类名（简短、中文）。',
        `候选分类：${vocabulary.join('、')}`,
        '输出 JSON：{"items":[{"index":行号,"category":"分类名","confidence":0到1}]}。',
        'confidence 表示把握程度；不确定时给低值，不要硬猜。只输出 JSON。',
      ].join('\n'),
      messages: [{ role: 'user', content: lines.join('\n') }],
      json: true,
      temperature: 0,
      timeoutMs: AI_TIMEOUT_MS,
      maxRetries: 1,
      maxTokens: 2000,
    });
    const parsed = JSON.parse(result.content) as {
      items?: Array<{ index?: number; category?: string; confidence?: number }>;
    };
    const items = new Map<string, { category: string; confidence: number }>();
    for (const item of parsed.items ?? []) {
      const idx = Number(item.index);
      const material = Number.isInteger(idx) ? batch[idx - 1] : undefined;
      if (!material) continue;
      const category = String(item.category ?? '').trim();
      if (category === UNCATEGORIZED) continue;
      items.set(material.id, {
        category,
        confidence: Math.max(0, Math.min(1, Number(item.confidence ?? 0))),
      });
    }
    return { items, model: result.model };
  }
}