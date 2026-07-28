import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { ChatService } from '../chat/chat.service';

/**
 * 安全库存初始化：以 T+ 采购单镜像（近 90 天）为消耗数据源，规则计算 + AI 兜底。
 *
 * 规则：采购频次 ≥2 张单的物料视为常备，月均用量 = 90 天总采购量 / 3，
 * 建议安全库存 = ceil(月均 × 1.5)（1.5 个月覆盖）。
 * 频次仅 1 张单的无法从数据判断常备性，交 AI 按名称语义判断（样品/定制/开模类不设）。
 *
 * 只填当前 safeStock=0 的物料——人工设过的值绝不覆盖；应用留痕 metadata.safeStockInit。
 * 安全库存生效后，驾驶舱 summary 与物料库缺料预警（stockQty < safeStock）即有真实口径。
 */

const WINDOW_DAYS = 90;
const COVER_FACTOR = 1.5;
const AI_CONFIDENCE_THRESHOLD = 0.7;
// 大批次容易触发推理模型超时（实测 40 条 60s 超时），批次放小、超时放宽
const AI_BATCH_SIZE = 25;
const AI_TIMEOUT_MS = 120_000;
const AI_MAX_CONSECUTIVE_FAILURES = 2;

interface Usage {
  materialId: string;
  totalQty: number;
  orderNos: Set<string>;
}

interface Candidate {
  materialId: string;
  erpCode: string;
  name: string;
  totalQty: number;
  orders: number;
  monthlyAvg: number;
  suggest: number;
}

@Injectable()
export class MaterialSafeStockService {
  private readonly logger = new Logger(MaterialSafeStockService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chatService: ChatService,
  ) {}

  /** 聚合镜像用量 → 拆成规则候选（频次≥2）与 AI 候选（频次=1），均只含 safeStock=0 的物料。 */
  private async buildCandidates() {
    const rows = await this.prisma.procPurchaseOrderMirror.findMany({
      where: { materialId: { not: null } },
      select: { materialId: true, tpOrderNo: true, orderedQty: true },
    });
    const usage = new Map<string, Usage>();
    for (const row of rows) {
      const id = row.materialId as string;
      const u = usage.get(id) ?? { materialId: id, totalQty: 0, orderNos: new Set<string>() };
      u.totalQty += Number(row.orderedQty);
      u.orderNos.add(row.tpOrderNo);
      usage.set(id, u);
    }
    const materials = await this.prisma.procMaterial.findMany({
      where: { id: { in: [...usage.keys()] } },
      select: { id: true, name: true, erpCode: true, safeStock: true },
    });
    let skippedManual = 0;
    const rule: Candidate[] = [];
    const ai: Candidate[] = [];
    for (const m of materials) {
      const u = usage.get(m.id);
      if (!u || u.totalQty <= 0) continue;
      if (Number(m.safeStock) > 0) {
        skippedManual += 1;
        continue;
      }
      const monthlyAvg = u.totalQty / (WINDOW_DAYS / 30);
      const candidate: Candidate = {
        materialId: m.id,
        erpCode: m.erpCode,
        name: m.name,
        totalQty: u.totalQty,
        orders: u.orderNos.size,
        monthlyAvg,
        suggest: Math.max(1, Math.ceil(monthlyAvg * COVER_FACTOR)),
      };
      (u.orderNos.size >= 2 ? rule : ai).push(candidate);
    }
    return { rule, ai, skippedManual, usageMaterialCount: usage.size };
  }

  async preview() {
    const { rule, ai, skippedManual, usageMaterialCount } = await this.buildCandidates();
    return {
      windowDays: WINDOW_DAYS,
      coverFactor: COVER_FACTOR,
      usageMaterialCount,
      skippedManual,
      ruleCount: rule.length,
      aiPending: ai.length,
      samples: [...rule]
        .sort((a, b) => b.monthlyAvg - a.monthlyAvg)
        .slice(0, 10)
        .map((c) => ({ code: c.erpCode, name: c.name, orders: c.orders, monthlyAvg: Math.round(c.monthlyAvg * 10) / 10, suggest: c.suggest })),
      aiSamples: ai.slice(0, 10).map((c) => `${c.erpCode} ${c.name}`.trim()),
    };
  }

  async apply(actorId: string, onProgress?: (progress: string) => void) {
    const { rule, ai } = await this.buildCandidates();

    let ruleApplied = 0;
    for (const c of rule) {
      await this.applyOne(c, 'rule', actorId, null);
      ruleApplied += 1;
    }
    onProgress?.(`规则已应用 ${ruleApplied} 条，AI 判断 0/${ai.length}`);

    const aiApplied: Array<{ code: string; name: string; suggest: number; confidence: number }> = [];
    const aiSkipped: Array<{ code: string; name: string; reason: string }> = [];
    let aiError: string | null = null;
    let model: string | null = null;

    let consecutiveFailures = 0;
    for (let i = 0; i < ai.length; i += AI_BATCH_SIZE) {
      onProgress?.(`规则已应用 ${ruleApplied} 条，AI 判断 ${i}/${ai.length}`);
      const batch = ai.slice(i, i + AI_BATCH_SIZE);
      try {
        const result = await this.judgeStockedWithAi(batch);
        consecutiveFailures = 0;
        model = result.model;
        for (const c of batch) {
          const verdict = result.items.get(c.materialId);
          if (!verdict) {
            aiSkipped.push({ code: c.erpCode, name: c.name, reason: 'AI 未返回结果' });
            continue;
          }
          if (!verdict.stocked || verdict.confidence < AI_CONFIDENCE_THRESHOLD) {
            aiSkipped.push({
              code: c.erpCode,
              name: c.name,
              reason: verdict.stocked ? `置信度不足（${verdict.confidence.toFixed(2)}）` : '判定为一次性采购',
            });
            continue;
          }
          await this.applyOne(c, 'ai', actorId, result.model);
          aiApplied.push({ code: c.erpCode, name: c.name, suggest: c.suggest, confidence: verdict.confidence });
        }
      } catch (error) {
        // 单批失败只弃当前批（偶发超时不拖累其余批次）；连续失败视为系统性问题，止损退出
        aiError = (error as Error).message;
        consecutiveFailures += 1;
        for (const c of batch) {
          aiSkipped.push({ code: c.erpCode, name: c.name, reason: 'AI 调用失败' });
        }
        this.logger.warn(`安全库存 AI 判定第 ${Math.floor(i / AI_BATCH_SIZE) + 1} 批失败：${aiError}`);
        if (consecutiveFailures >= AI_MAX_CONSECUTIVE_FAILURES) {
          for (const c of ai.slice(i + AI_BATCH_SIZE)) {
            aiSkipped.push({ code: c.erpCode, name: c.name, reason: 'AI 调用失败（提前止损）' });
          }
          break;
        }
      }
    }

    this.logger.log(`安全库存初始化：规则 ${ruleApplied} 条，AI ${aiApplied.length} 条，跳过 ${aiSkipped.length} 条`);
    return { ruleApplied, aiApplied, aiSkipped, aiError, model };
  }

  private async applyOne(c: Candidate, source: 'rule' | 'ai', actorId: string, model: string | null) {
    const existing = await this.prisma.procMaterial.findUnique({
      where: { id: c.materialId },
      select: { metadata: true, safeStock: true },
    });
    // 并发/重复应用防护：期间被人工设过就不动
    if (!existing || Number(existing.safeStock) > 0) return;
    const meta = (existing.metadata ?? {}) as Record<string, unknown>;
    await this.prisma.procMaterial.update({
      where: { id: c.materialId },
      data: {
        safeStock: new Prisma.Decimal(c.suggest),
        metadata: {
          ...meta,
          safeStockInit: {
            source,
            ...(model ? { model } : {}),
            windowDays: WINDOW_DAYS,
            totalQty: c.totalQty,
            orders: c.orders,
            monthlyAvg: Math.round(c.monthlyAvg * 100) / 100,
            coverFactor: COVER_FACTOR,
            appliedBy: actorId,
            appliedAt: new Date().toISOString(),
          },
        } as Prisma.InputJsonObject,
      },
    });
  }

  /** AI 判定常备性：json 输出 {"items":[{"index":n,"stocked":bool,"confidence":0-1}]}。 */
  private async judgeStockedWithAi(batch: Candidate[]) {
    const lines = batch.map((c, idx) => `${idx + 1}. ${c.erpCode || '无编码'} ${c.name}`);
    const result = await this.chatService.complete({
      system: [
        '你是制造业库存管理助手。判断每个物料是否属于「常备物料」（应设安全库存、会持续复购），',
        '还是「一次性采购」（样品、定制件、开模费、单次项目物料等，不应设安全库存）。',
        '输出 JSON：{"items":[{"index":行号,"stocked":true|false,"confidence":0到1}]}。',
        '不确定时给低 confidence，不要硬猜。只输出 JSON。',
      ].join('\n'),
      messages: [{ role: 'user', content: lines.join('\n') }],
      json: true,
      temperature: 0,
      timeoutMs: AI_TIMEOUT_MS,
      maxRetries: 1,
      maxTokens: 1500,
    });
    const parsed = JSON.parse(result.content) as {
      items?: Array<{ index?: number; stocked?: boolean; confidence?: number }>;
    };
    const items = new Map<string, { stocked: boolean; confidence: number }>();
    for (const item of parsed.items ?? []) {
      const idx = Number(item.index);
      const candidate = Number.isInteger(idx) ? batch[idx - 1] : undefined;
      if (!candidate) continue;
      items.set(candidate.materialId, {
        stocked: Boolean(item.stocked),
        confidence: Math.max(0, Math.min(1, Number(item.confidence ?? 0))),
      });
    }
    return { items, model: result.model };
  }
}
