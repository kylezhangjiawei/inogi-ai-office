import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ProcActor } from './procurement.types';
import { purchaseOrderAvailabilityView, type PurchaseOrderAvailabilityView } from './purchase-order-availability';

export interface StockPlanOrderDateSource {
  kind: 'batch' | 'task';
  id: string;
  label: string;
}

export type StockPlanOrderDateComparison = 'on_or_before_target' | 'after_target' | 'target_missing'
  | 'unconfirmed' | 'cleared' | 'needs_reconfirmation';

export interface StockPlanOrderDateLine {
  kind: 'line';
  key: string;
  lineId: string;
  orderNo: string;
  lineNo: string;
  inventoryCode: string;
  inventoryName: string;
  unit: string;
  supplierName: string;
  etaDate: string | null;
  syncedAt: string | null;
  orderStatus: string | null;
  approvalStatus: string | null;
  availability: PurchaseOrderAvailabilityView | null;
  dateCheck: StockPlanOrderDateComparison;
  sources: StockPlanOrderDateSource[];
}

export interface StockPlanOrderDateUnresolved {
  kind: 'unresolved';
  key: string;
  orderNo: string | null;
  lineNo: string | null;
  reason: string;
  sources: StockPlanOrderDateSource[];
}

export type StockPlanOrderDateRow = StockPlanOrderDateLine | StockPlanOrderDateUnresolved;

const planSelect = Prisma.validator<Prisma.ProcStockPlanSelect>()({
  id: true, code: true, targetDate: true, updatedAt: true, unit: true,
  material: { select: { tpInventoryCode: true } },
  batches: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, purchaseOrderMirrorId: true, purchaseOrderNo: true, supplierName: true },
  },
  tasks: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true, code: true, materialName: true, unit: true,
      material: { select: { tpInventoryCode: true } },
      purchaseOrderRefs: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, tpOrderNo: true, tpLineNo: true, tpOrderId: true, metadata: true },
      },
    },
  },
});

const mirrorSelect = Prisma.validator<Prisma.ProcPurchaseOrderMirrorSelect>()({
  id: true, tpOrderNo: true, tpOrderId: true, tpLineNo: true,
  inventoryCode: true, inventoryName: true, spec: true, unit: true, supplierName: true,
  // Quantities are read only for the existing confirmation fingerprint; never returned or summed.
  orderedQty: true, receivedQty: true, etaDate: true, syncedAt: true,
  status: true, approvalStatus: true, availability: true,
});
type Plan = Prisma.ProcStockPlanGetPayload<{ select: typeof planSelect }>;
type Mirror = Prisma.ProcPurchaseOrderMirrorGetPayload<{ select: typeof mirrorSelect }>;
const text = (value: string | null | undefined) => value?.trim() ?? '';
// Whitespace can be part of an external identity. Trim only decides whether it is blank.
const identity = (value: string | null | undefined) => typeof value === 'string' && value.trim() ? value : '';
const pairKey = (orderNo: string, lineNo: string) => JSON.stringify([orderNo, lineNo]);
const compareKeys = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

function pagination(query: Record<string, unknown>) {
  const integer = (value: unknown, fallback: number, label: string) => {
    if (value === undefined) return fallback;
    if ((typeof value !== 'string' && typeof value !== 'number') || !/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) {
      throw new BadRequestException(`${label}必须是正整数`);
    }
    return Number(value);
  };
  return { requestedPage: integer(query.page, 1, '页码'), pageSize: Math.min(50, integer(query.pageSize, 10, '每页数量')) };
}

function dateComparison(targetDate: string | null, availability: PurchaseOrderAvailabilityView | null): StockPlanOrderDateComparison {
  if (!availability) return 'unconfirmed';
  if (!availability.availableDate) return 'cleared';
  if (availability.needsReconfirmation) return 'needs_reconfirmation';
  if (!targetDate) return 'target_missing';
  return availability.availableDate <= targetDate ? 'on_or_before_target' : 'after_target';
}

function materialIssue(mirror: Mirror, expectedCode: string | null | undefined, expectedUnit: string) {
  if (text(expectedCode) && text(expectedCode) !== text(mirror.inventoryCode)) return '关联订单行的物料编码与来源物料不一致，请核对并重新关联';
  if (text(expectedUnit) && text(mirror.unit) && text(expectedUnit) !== text(mirror.unit)) return '关联订单行的计量单位与来源单位不一致，请核对并重新关联';
  return null;
}

function mergeRows(plan: Plan, mirrors: Mirror[]): StockPlanOrderDateRow[] {
  const byId = new Map(mirrors.map((mirror) => [mirror.id, mirror]));
  const byPair = new Map(mirrors.map((mirror) => [pairKey(mirror.tpOrderNo, mirror.tpLineNo), mirror]));
  const lines = new Map<string, StockPlanOrderDateLine>();
  const unresolved: StockPlanOrderDateUnresolved[] = [];
  const targetDate = plan.targetDate?.toISOString().slice(0, 10) ?? null;
  const addIssue = (key: string, orderNo: string | null, lineNo: string | null, reason: string, source: StockPlanOrderDateSource) => {
    unresolved.push({ kind: 'unresolved', key, orderNo, lineNo, reason, sources: [source] });
  };
  const addLine = (mirror: Mirror, source: StockPlanOrderDateSource) => {
    const existing = lines.get(mirror.id);
    if (existing) {
      if (!existing.sources.some((item) => item.kind === source.kind && item.id === source.id)) existing.sources.push(source);
      return;
    }
    const availability = purchaseOrderAvailabilityView(mirror.availability, mirror);
    lines.set(mirror.id, {
      kind: 'line', key: `line:${mirror.id}`, lineId: mirror.id, orderNo: mirror.tpOrderNo, lineNo: mirror.tpLineNo,
      inventoryCode: mirror.inventoryCode, inventoryName: mirror.inventoryName, unit: mirror.unit,
      supplierName: mirror.supplierName, etaDate: mirror.etaDate?.toISOString().slice(0, 10) ?? null,
      syncedAt: mirror.syncedAt?.toISOString() ?? null, orderStatus: mirror.status, approvalStatus: mirror.approvalStatus,
      availability, dateCheck: dateComparison(targetDate, availability), sources: [source],
    });
  };

  plan.batches.forEach((batch, index) => {
    const source: StockPlanOrderDateSource = { kind: 'batch', id: batch.id, label: `采购批次 ${index + 1} · ${batch.supplierName || '未填写供应商'}` };
    const key = `unresolved:batch:${batch.id}`;
    if (!batch.purchaseOrderMirrorId) {
      addIssue(key, batch.purchaseOrderNo || null, null, '采购批次尚未关联明确的 ERP 订单行，单号文本不能代替订单行关联', source);
      return;
    }
    const mirror = byId.get(batch.purchaseOrderMirrorId);
    if (!mirror) {
      addIssue(key, batch.purchaseOrderNo || null, null, '关联的 ERP 订单行不存在或已失效，请核对采购批次', source);
      return;
    }
    const issue = materialIssue(mirror, plan.material?.tpInventoryCode, plan.unit);
    if (issue) addIssue(key, mirror.tpOrderNo, mirror.tpLineNo, issue, source);
    else addLine(mirror, source);
  });

  for (const task of plan.tasks) {
    const source: StockPlanOrderDateSource = { kind: 'task', id: task.id, label: `${task.code} · ${task.materialName}` };
    if (task.purchaseOrderRefs.length === 0) {
      addIssue(`unresolved:task:${task.id}`, null, null, '采购任务尚未关联 ERP 订单行', source);
    }
    for (const ref of task.purchaseOrderRefs) {
      const key = `unresolved:task-ref:${ref.id}`;
      const orderNo = identity(ref.tpOrderNo);
      const lineNo = identity(ref.tpLineNo);
      const orderId = identity(ref.tpOrderId);
      if ((ref.metadata as Prisma.JsonObject | null)?.freeSample === true) {
        addIssue(key, orderNo || null, lineNo || null, '此关联为免费样品，没有可核对的正式 ERP 订单行', source);
        continue;
      }
      if (!orderNo || !lineNo || !orderId) {
        const missing = [!orderNo && '采购单号', !lineNo && '订单行号', !orderId && 'ERP 订单身份'].filter(Boolean).join('、');
        addIssue(key, orderNo || null, lineNo || null, `采购任务关联缺少${missing}，请补齐明确关联后核对`, source);
        continue;
      }
      const mirror = byPair.get(pairKey(orderNo, lineNo));
      if (!mirror) {
        addIssue(key, orderNo, lineNo, '关联的 ERP 订单行尚未同步或已失效，请核对原关联', source);
        continue;
      }
      if (!identity(mirror.tpOrderId) || identity(mirror.tpOrderId) !== orderId) {
        addIssue(key, orderNo, lineNo, 'ERP 订单身份已改变或缺失，不能沿用原关联，请重新核对', source);
        continue;
      }
      const issue = materialIssue(mirror, task.material?.tpInventoryCode, task.unit);
      if (issue) addIssue(key, orderNo, lineNo, issue, source);
      else addLine(mirror, source);
    }
  }
  for (const line of lines.values()) line.sources.sort((a, b) => compareKeys(`${a.kind}:${a.id}`, `${b.kind}:${b.id}`));
  return [...lines.values(), ...unresolved].sort((a, b) => compareKeys(a.key, b.key));
}

/** Uses explicit plan links only. It neither allocates supply nor infers plan completion. */
export async function readStockPlanOrderDateCheck(prisma: PrismaService, id: string, query: Record<string, unknown>, actor: ProcActor) {
  const permissions = actor?.permissions ?? [];
  if (!permissions.includes('*') && (!permissions.includes('page:proc-cockpit')
    || !permissions.some((permission) => permission === 'page:purchase-orders' || permission === 'page:purchase-order-detail'))) {
    throw new ForbiddenException('需要备货计划及采购订单查看权限才能核对关联订单日期');
  }
  if (typeof id !== 'string' || !id.trim() || id.length > 128 || /[\u0000-\u001f\u007f]/.test(id)) throw new BadRequestException('备货计划标识无效');
  const { requestedPage, pageSize } = pagination(query);
  return prisma.$transaction(async (tx) => {
    const plan = await tx.procStockPlan.findUnique({ where: { id }, select: planSelect });
    if (!plan) throw new NotFoundException('备货计划不存在');
    const ids = [...new Set(plan.batches.map((batch) => batch.purchaseOrderMirrorId).filter((value): value is string => Boolean(value)))];
    const pairs = new Map<string, { tpOrderNo: string; tpLineNo: string }>();
    for (const task of plan.tasks) for (const ref of task.purchaseOrderRefs) {
      const orderNo = identity(ref.tpOrderNo); const lineNo = identity(ref.tpLineNo);
      if (orderNo && lineNo && identity(ref.tpOrderId) && (ref.metadata as Prisma.JsonObject | null)?.freeSample !== true) {
        pairs.set(pairKey(orderNo, lineNo), { tpOrderNo: orderNo, tpLineNo: lineNo });
      }
    }
    const OR: Prisma.ProcPurchaseOrderMirrorWhereInput[] = [...(ids.length ? [{ id: { in: ids } }] : []), ...pairs.values()];
    const mirrors = OR.length ? await tx.procPurchaseOrderMirror.findMany({ where: { OR }, select: mirrorSelect }) : [];
    const items = mergeRows(plan, mirrors);
    const total = items.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, totalPages);
    return {
      readOnly: true as const,
      plan: { id: plan.id, code: plan.code, targetDate: plan.targetDate?.toISOString().slice(0, 10) ?? null, updatedAt: plan.updatedAt.toISOString() },
      rows: { items: items.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total, totalPages },
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
