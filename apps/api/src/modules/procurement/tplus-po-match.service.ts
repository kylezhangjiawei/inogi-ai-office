import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { ChatService } from '../chat/chat.service';
import { ProcurementService } from './procurement.service';
import type { ProcActor } from './procurement.types';

/**
 * T+ 采购单镜像 ↔ 采购任务匹配：规则打分优先，AI 只兜「物料没匹配上、只能看名称」的尾部。
 *
 * 目的：把「任务在 T+ 下单后须手动回来关联单号」这步人工降到最低——同步全量单据后
 * 自动生成建议（suggested），人工只做一次确认；确认即复用 linkPurchaseOrder 建关联，
 * 任务自动流转在途，到货量随同步回推。
 *
 * 规则打分（确定性优先）：物料一致/规范化名称一致 0.6（名称高度相似 0.5）
 * + 数量接近(≤5%:0.25 / ≤20%:0.15) + 时间窗吻合 0.15，
 * ≥0.7 才建议。AI 名称匹配置信 ≥0.75 才建议，且在 matchReason 标明来源便于人工甄别。
 */

const LINKABLE_STATUSES = ['priced', 'pending_purchase', 'in_transit', 'partial_arrival'];
const RULE_SUGGEST_THRESHOLD = 0.7;
const AI_SUGGEST_THRESHOLD = 0.75;
const AI_MAX_ROWS = 50;
const AI_MAX_TASKS = 100;

interface OpenTask {
  id: string;
  code: string;
  materialId: string | null;
  materialName: string;
  quantity: number;
  arrivedQty: number;
  createdAt: Date;
  needDate: Date | null;
  deadline: Date | null;
}

/** 只消除书写噪音，不删除型号文字，避免不同物料被过度归一化。 */
function normalizeMaterialName(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s\p{P}]+/gu, '');
}

@Injectable()
export class TplusPoMatchService {
  private readonly logger = new Logger(TplusPoMatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly procurement: ProcurementService,
    private readonly chatService: ChatService,
  ) {}

  /** 镜像清单（含建议目标任务的展示信息），按匹配状态过滤。 */
  async listMirror(status?: string) {
    const rows = await this.prisma.procPurchaseOrderMirror.findMany({
      where: status ? { matchStatus: status } : undefined,
      orderBy: [{ orderDate: 'desc' }, { tpOrderNo: 'desc' }],
      take: 500,
    });
    const taskIds = [...new Set(rows.map((r) => r.matchTaskId).filter(Boolean))] as string[];
    const tasks = taskIds.length
      ? await this.prisma.procTask.findMany({
          where: { id: { in: taskIds } },
          select: { id: true, code: true, materialName: true, quantity: true, status: true },
        })
      : [];
    const taskById = new Map(tasks.map((t) => [t.id, t]));
    const counts = await this.prisma.procPurchaseOrderMirror.groupBy({
      by: ['matchStatus'],
      _count: { _all: true },
    });
    return {
      counts: Object.fromEntries(counts.map((c) => [c.matchStatus, c._count._all])),
      rows: rows.map((r) => ({
        id: r.id,
        tpOrderNo: r.tpOrderNo,
        tpLineNo: r.tpLineNo,
        supplierName: r.supplierName,
        inventoryCode: r.inventoryCode,
        inventoryName: r.inventoryName,
        orderedQty: Number(r.orderedQty),
        receivedQty: Number(r.receivedQty),
        orderDate: r.orderDate?.toISOString() ?? null,
        etaDate: r.etaDate?.toISOString() ?? null,
        matchStatus: r.matchStatus,
        matchConfidence: r.matchConfidence === null ? null : Number(r.matchConfidence),
        matchReason: r.matchReason,
        task: r.matchTaskId ? (taskById.get(r.matchTaskId) ?? null) : null,
      })),
    };
  }

  private async loadOpenTasks(): Promise<OpenTask[]> {
    const tasks = await this.prisma.procTask.findMany({
      where: { status: { in: LINKABLE_STATUSES } },
      select: {
        id: true,
        code: true,
        materialId: true,
        materialName: true,
        quantity: true,
        arrivedQty: true,
        createdAt: true,
        needDate: true,
        deadline: true,
      },
    });
    return tasks.map((t) => ({
      ...t,
      quantity: Number(t.quantity),
      arrivedQty: Number(t.arrivedQty),
    }));
  }

  /** 对 unmatched 行跑规则 + AI 匹配，写回 suggested；已 confirmed/ignored 的不动。 */
  async runMatch() {
    const [rows, tasks] = await Promise.all([
      this.prisma.procPurchaseOrderMirror.findMany({
        where: { matchStatus: { in: ['unmatched', 'suggested'] } },
      }),
      this.loadOpenTasks(),
    ]);
    if (rows.length === 0) return { suggested: 0, aiSuggested: 0, unmatched: 0 };

    // 任务已关联过的单号：同一单号不再重复建议到同一任务
    const existingRefs = await this.prisma.procPurchaseOrderRef.findMany({
      select: { taskId: true, tpOrderNo: true },
    });
    const linkedPairs = new Set(existingRefs.map((r) => `${r.taskId}|${r.tpOrderNo}`));

    let suggested = 0;
    const aiRows: typeof rows = [];
    for (const row of rows) {
      const best = this.bestRuleMatch(row, tasks, linkedPairs);
      if (best) {
        await this.prisma.procPurchaseOrderMirror.update({
          where: { id: row.id },
          data: {
            matchTaskId: best.task.id,
            matchStatus: 'suggested',
            matchConfidence: new Prisma.Decimal(best.score.toFixed(3)),
            matchReason: best.reason,
          },
        });
        suggested += 1;
      } else if (!row.materialId && row.inventoryName) {
        aiRows.push(row);
      }
    }

    let aiSuggested = 0;
    if (aiRows.length > 0 && tasks.length > 0) {
      try {
        aiSuggested = await this.aiNameMatch(aiRows.slice(0, AI_MAX_ROWS), tasks, linkedPairs);
      } catch (error) {
        this.logger.warn(`AI 名称匹配降级：${(error as Error).message}`);
      }
    }
    const unmatched = rows.length - suggested - aiSuggested;
    return { suggested, aiSuggested, unmatched };
  }

  private bestRuleMatch(
    row: {
      materialId: string | null;
      inventoryName: string;
      tpOrderNo: string;
      orderedQty: Prisma.Decimal;
      orderDate: Date | null;
    },
    tasks: OpenTask[],
    linkedPairs: Set<string>,
  ) {
    const orderedQty = Number(row.orderedQty);
    const rowName = normalizeMaterialName(row.inventoryName);
    let best: { task: OpenTask; score: number; reason: string } | null = null;
    for (const task of tasks) {
      if (linkedPairs.has(`${task.id}|${row.tpOrderNo}`)) continue;
      let score = 0;
      const reasons: string[] = [];
      if (row.materialId) {
        if (task.materialId !== row.materialId) continue;
        score = 0.6;
        reasons.push('物料一致');
      } else {
        const taskName = normalizeMaterialName(task.materialName);
        if (!rowName || !taskName) continue;
        if (rowName === taskName) {
          score = 0.6;
          reasons.push('名称规范化一致');
        } else {
          const shorter = rowName.length <= taskName.length ? rowName : taskName;
          const longer = rowName.length > taskName.length ? rowName : taskName;
          const coverage = shorter.length / longer.length;
          if (shorter.length < 4 || coverage < 0.75 || !longer.includes(shorter)) continue;
          score = 0.5;
          reasons.push('名称高度相似');
        }
      }
      if (task.quantity > 0 && orderedQty > 0) {
        const diff = Math.abs(orderedQty - task.quantity) / task.quantity;
        if (diff <= 0.05) {
          score += 0.25;
          reasons.push('数量吻合');
        } else if (diff <= 0.2) {
          score += 0.15;
          reasons.push('数量接近');
        }
      }
      if (row.orderDate) {
        const after = row.orderDate.getTime() >= task.createdAt.getTime() - 7 * 86400_000;
        const windowEnd = task.deadline ?? task.needDate;
        const before = !windowEnd || row.orderDate.getTime() <= windowEnd.getTime() + 30 * 86400_000;
        if (after && before) {
          score += 0.15;
          reasons.push('时间窗吻合');
        }
      }
      if (score > (best?.score ?? 0)) best = { task, score, reason: `规则：${reasons.join('+')}` };
    }
    if (!best || best.score < RULE_SUGGEST_THRESHOLD) return null;
    return best;
  }

  /** AI 名称匹配：镜像行存货名称 ↔ 开放任务物料名称，只在高置信时写建议。 */
  private async aiNameMatch(
    rows: Array<{ id: string; tpOrderNo: string; inventoryName: string; orderedQty: Prisma.Decimal }>,
    tasks: OpenTask[],
    linkedPairs: Set<string>,
  ): Promise<number> {
    const taskSlice = tasks.slice(0, AI_MAX_TASKS);
    const taskLines = taskSlice.map((t, i) => `T${i + 1}. ${t.materialName}（需求量 ${t.quantity}）`);
    const rowLines = rows.map((r, i) => `R${i + 1}. ${r.inventoryName}（订购量 ${Number(r.orderedQty)}）`);
    const result = await this.chatService.complete({
      system: [
        '你是采购单据匹配助手。给定 ERP 采购单行（R 列表）与采购任务（T 列表），判断每个 R 对应哪个 T（同一物料的采购）。',
        '语义相同但写法不同（简称/规格后缀/中英混写）视为同一物料；不确定就不要配对。',
        '输出 JSON：{"pairs":[{"r":R行号,"t":T行号,"confidence":0到1}]}，无把握的 R 直接省略。只输出 JSON。',
      ].join('\n'),
      messages: [{ role: 'user', content: `采购单行：\n${rowLines.join('\n')}\n\n采购任务：\n${taskLines.join('\n')}` }],
      json: true,
      temperature: 0,
      timeoutMs: 60_000,
      maxRetries: 1,
      maxTokens: 1500,
    });
    const parsed = JSON.parse(result.content) as {
      pairs?: Array<{ r?: number; t?: number; confidence?: number }>;
    };
    let applied = 0;
    for (const pair of parsed.pairs ?? []) {
      const row = rows[Number(pair.r) - 1];
      const task = taskSlice[Number(pair.t) - 1];
      const confidence = Math.max(0, Math.min(1, Number(pair.confidence ?? 0)));
      if (!row || !task || confidence < AI_SUGGEST_THRESHOLD) continue;
      if (linkedPairs.has(`${task.id}|${row.tpOrderNo}`)) continue;
      await this.prisma.procPurchaseOrderMirror.update({
        where: { id: row.id },
        data: {
          matchTaskId: task.id,
          matchStatus: 'suggested',
          matchConfidence: new Prisma.Decimal(confidence.toFixed(3)),
          matchReason: `AI 名称匹配（${result.model}）`,
        },
      });
      applied += 1;
    }
    return applied;
  }

  /** 确认建议：复用 linkPurchaseOrder 建关联（任务自动流转在途），回填到货量并重算。 */
  async confirm(mirrorId: string, actor: ProcActor, taskId?: string) {
    const row = await this.prisma.procPurchaseOrderMirror.findUnique({ where: { id: mirrorId } });
    if (!row) throw new NotFoundException('镜像单据不存在');
    if (row.matchStatus === 'confirmed') throw new BadRequestException('该单据行已确认过');
    const targetTaskId = taskId ?? row.matchTaskId;
    if (!targetTaskId) throw new BadRequestException('没有可确认的目标任务');

    await this.procurement.linkPurchaseOrder(
      targetTaskId,
      {
        tpOrderNo: row.tpOrderNo,
        tpOrderId: row.tpOrderId ?? undefined,
        tpLineNo: row.tpLineNo || undefined,
        supplierName: row.supplierName || undefined,
        orderedQty: Number(row.orderedQty),
        orderDate: row.orderDate?.toISOString().slice(0, 10),
        etaDate: row.etaDate?.toISOString().slice(0, 10),
      },
      actor,
    );
    // 镜像里已有到货量的，立即回填到新建 ref 并重算任务到货（不等下次同步）
    if (Number(row.receivedQty) > 0) {
      await this.prisma.procPurchaseOrderRef.updateMany({
        where: { taskId: targetTaskId, tpOrderNo: row.tpOrderNo, tpLineNo: row.tpLineNo || null },
        data: { receivedQty: row.receivedQty, syncedAt: new Date() },
      });
      await this.procurement.recomputeArrival(targetTaskId);
    }
    await this.prisma.procPurchaseOrderMirror.update({
      where: { id: mirrorId },
      data: { matchTaskId: targetTaskId, matchStatus: 'confirmed' },
    });
    return this.listMirror();
  }

  async ignore(mirrorId: string) {
    const row = await this.prisma.procPurchaseOrderMirror.findUnique({ where: { id: mirrorId } });
    if (!row) throw new NotFoundException('镜像单据不存在');
    if (row.matchStatus === 'confirmed') throw new BadRequestException('已确认的关联请在任务里解除');
    await this.prisma.procPurchaseOrderMirror.update({
      where: { id: mirrorId },
      data: { matchStatus: 'ignored', matchTaskId: null, matchConfidence: null },
    });
    return this.listMirror();
  }
}
