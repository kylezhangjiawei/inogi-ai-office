import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { ProcActor } from './procurement.types';
import { isVoidedOrderStatus } from './replenish-core';
import type { FulfillmentMutationDto, ProposeFulfillmentDto } from './dto/purchase-fulfillment.dto';
import { calculatePurchaseFulfillment, emptyFulfillmentState, fulfillmentCoverageFingerprint, fulfillmentHash, fulfillmentSourceFingerprint, fulfillmentStateKey, type FulfillmentEntry, type FulfillmentState, type FulfillmentLine, type FulfillmentReceipt } from './purchase-fulfillment.model';

type Db = Prisma.TransactionClient;
export const fulfillmentReceiptInclude = { inspections: { orderBy: { version: 'desc' as const } } };
const lineInclude = { receipts: { include: fulfillmentReceiptInclude } };
type Line = Prisma.ProcPurchaseOrderMirrorGetPayload<{ include: typeof lineInclude }>;
const has = (actor: ProcActor, action?: string) => actor.permissions.includes('*') || (actor.permissions.includes('page:purchase-order-detail') && (!action || actor.permissions.includes(action)));
const reason = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new BadRequestException('请填写不超过 2000 字的调整或审批依据');
  return value.trim();
};
export function parseFulfillmentState(value: string | undefined | null): FulfillmentState {
  if (value == null) return emptyFulfillmentState();
  try {
    const state = JSON.parse(value) as FulfillmentState;
    if (!Number.isSafeInteger(state.version) || state.version < 0 || !Array.isArray(state.entries) || !Array.isArray(state.requests)
      || state.entries.some((e) => !e || typeof e.id !== 'string' || !['cancel', 'return', 'reversal', 'coverage'].includes(e.kind)
        || !['pending', 'approved', 'revoked'].includes(e.status) || typeof e.quantity !== 'number' || !Number.isFinite(e.quantity) || e.quantity < 0
        || !Array.isArray(e.history) || !Array.isArray(e.reflectedEntryIds) || typeof e.sourceFingerprint !== 'string')
      || new Set(state.entries.map((e) => e.id)).size !== state.entries.length) throw new Error();
    return state;
  } catch { throw new ServiceUnavailableException('履约台账格式异常，不能据此推算数量，请联系管理员核对'); }
}
export async function readPurchaseFulfillment(db: Db, line: FulfillmentLine & { receipts: FulfillmentReceipt[] }) {
  const stored = await db.runtimeState.findUnique({ where: { key: fulfillmentStateKey(line.id) } });
  const state = parseFulfillmentState(stored?.value);
  return { state, summary: calculatePurchaseFulfillment(line, line.receipts, state) };
}

/** Recompute purchase coverage only; never adds local receipts to ERP inventory balances. */
export async function recalculateStockPlanFulfillment(db: Db, plan: { id: string; materialId?: string | null; unit: string; targetQty: Prisma.Decimal; batches: { id: string; purchaseOrderMirrorId: string | null; purchaseOrderNo: string | null; purchaseQty: Prisma.Decimal; receivedQty: Prisma.Decimal; qualifiedQty: Prisma.Decimal }[] }) {
  const ids = plan.batches.flatMap((b) => b.purchaseOrderMirrorId ? [b.purchaseOrderMirrorId] : []);
  const mirrors = ids.length ? await db.procPurchaseOrderMirror.findMany({ where: { id: { in: ids } }, include: lineInclude }) : [];
  const rows = ids.length ? await db.runtimeState.findMany({ where: { key: { in: ids.map(fulfillmentStateKey) } } }) : [];
  const states = new Map(rows.map((row) => [row.key, parseFulfillmentState(row.value)]));
  const material = ids.length && plan.materialId ? await db.procMaterial.findUnique({ where: { id: plan.materialId }, select: { id: true, tpInventoryCode: true } }) : null;
  const target = new Prisma.Decimal(plan.targetQty);
  const duplicated = new Set(ids.filter((id, index) => ids.indexOf(id) !== index));
  const issues: string[] = [];
  const batches = plan.batches.map((batch) => {
    if (batch.purchaseOrderMirrorId && duplicated.has(batch.purchaseOrderMirrorId)) { issues.push('同一订单行在计划中重复关联，须明确分配后再汇总'); return { id: batch.id, orderedQty: null, receivedQty: null, qualifiedQty: null, remainingQty: null }; }
    const mirror = mirrors.find((m) => m.id === batch.purchaseOrderMirrorId);
    if (batch.purchaseOrderMirrorId && !mirror) { issues.push('关联订单行缺失'); return { id: batch.id, orderedQty: null, receivedQty: null, qualifiedQty: null, remainingQty: null }; }
    if (!mirror) {
      // A manual batch without a PO identity is independently recorded supply, never an ERP receipt.
      if (batch.purchaseOrderNo) {
        issues.push('手工采购批次尚未明确关联 ERP 订单行，未与本台账合并计量');
        return { id: batch.id, orderedQty: null, receivedQty: null, qualifiedQty: null, remainingQty: null };
      }
      const ordered = new Prisma.Decimal(batch.purchaseQty), received = new Prisma.Decimal(batch.receivedQty);
      if (!plan.unit.trim() || !ordered.isFinite() || ordered.lt(0) || !received.isFinite() || received.lt(0)) { issues.push('手工批次单位或数量无效'); return { id: batch.id, orderedQty: null, receivedQty: null, qualifiedQty: null, remainingQty: null }; }
      issues.push('手工批次尚无逐笔检验覆盖，检验可用数量待核对');
      return { id: batch.id, orderedQty: ordered.toNumber(), receivedQty: received.toNumber(), qualifiedQty: null, remainingQty: Prisma.Decimal.max(ordered.minus(received), 0).toNumber() };
    }
    if (isVoidedOrderStatus(mirror.status, mirror.approvalStatus)) { issues.push('ERP 订单已作废或取消，不抵扣后续采购需求；历史收货仍保留'); return { id: batch.id, orderedQty: 0, receivedQty: null, qualifiedQty: null, remainingQty: 0 }; }
    if (!material || (material.tpInventoryCode ? mirror.inventoryCode !== material.tpInventoryCode : mirror.materialId !== material.id)) { issues.push('当前订单行物料与备货计划物料不一致或缺少明确映射，不能抵扣计划需求'); return { id: batch.id, orderedQty: null, receivedQty: null, qualifiedQty: null, remainingQty: null }; }
    const summary = calculatePurchaseFulfillment(mirror, mirror.receipts, states.get(fulfillmentStateKey(mirror.id)) ?? emptyFulfillmentState());
    if (!plan.unit.trim() || plan.unit.trim() !== mirror.unit.trim()) { issues.push('计划与订单行单位不一致'); return { id: batch.id, orderedQty: null, receivedQty: null, qualifiedQty: null, remainingQty: null }; }
    issues.push(...summary.issues);
    if (!summary.coverageComplete) issues.push('本地收货与 ERP 覆盖尚未确认，检验可用数量待核对');
    return { id: batch.id, orderedQty: summary.effectiveOrderedQty, receivedQty: summary.effectiveReceivedQty, qualifiedQty: summary.qualifiedAvailableQty, remainingQty: summary.remainingQty };
  });
  const total = (key: 'orderedQty' | 'receivedQty' | 'qualifiedQty' | 'remainingQty') => batches.some((b) => b[key] === null) ? null : batches.reduce((sum, b) => sum.plus(b[key]!), new Prisma.Decimal(0)).toNumber();
  const orderedQty = total('orderedQty'), receivedQty = total('receivedQty'), qualifiedQty = total('qualifiedQty');
  return { unit: plan.unit, targetQty: target.toNumber(), orderedQty, receivedQty, qualifiedQty,
    remainingToPurchaseQty: orderedQty === null ? null : Prisma.Decimal.max(target.minus(orderedQty), 0).toNumber(),
    remainingToReceiveQty: total('remainingQty'),
    hasAdjustments: [...states.values()].some((s) => s.entries.some((e) => e.status === 'approved' && e.kind !== 'coverage')),
    provisional: issues.length > 0, issues: [...new Set(issues)], batches };
}

@Injectable()
export class PurchaseFulfillmentService {
  constructor(private readonly prisma: PrismaService) {}
  private permission(actor: ProcActor, action?: string) { if (!has(actor, action)) throw new ForbiddenException('没有该订单行履约台账的查看或操作权限'); }
  private async line(db: Db, id: string) {
    if (typeof id !== 'string' || !id || id.length > 128 || /[\u0000-\u001f\u007f]/.test(id)) throw new NotFoundException('采购订单行不存在');
    const line = await db.procPurchaseOrderMirror.findUnique({ where: { id }, include: lineInclude });
    if (!line) throw new NotFoundException('采购订单行不存在');
    return line;
  }
  private async view(db: Db, line: Line, state: FulfillmentState, actor: ProcActor) {
    const canReadAffectedPlans = actor.permissions.includes('*') || actor.permissions.includes('page:proc-cockpit');
    const plans = canReadAffectedPlans ? await db.procStockPlan.findMany({ where: { batches: { some: { purchaseOrderMirrorId: line.id } } }, include: { batches: true } }) : [];
    return { line: { id: line.id, orderNo: line.tpOrderNo, lineNo: line.tpLineNo, name: line.inventoryName, unit: line.unit, updatedAt: line.updatedAt.toISOString() },
      version: state.version, entries: state.entries.map(({ sourceFingerprint: _source, coverageFingerprint: _coverage, createdById: _creator, ...entry }) => ({ ...entry, history: entry.history.map(({ actorId: _actor, ...history }) => history) })), summary: calculatePurchaseFulfillment(line, line.receipts, state),
      canPropose: has(actor, 'proc-purchase-order:adjust-fulfillment'), canApprove: has(actor, 'proc-purchase-order:approve-fulfillment'),
      receiptOptions: line.receipts.map((r) => ({ id: r.id, deliveryNo: r.deliveryNo, receivedDate: r.receivedDate.toISOString().slice(0, 10) })),
      canReadAffectedPlans, affectedPlans: await Promise.all(plans.map(async (plan) => ({ id: plan.id, code: plan.code, name: plan.materialName, ...await recalculateStockPlanFulfillment(db, plan) }))) };
  }
  async list(lineId: string, actor: ProcActor) {
    this.permission(actor);
    return this.prisma.$transaction(async (db) => { const line = await this.line(db, lineId); const { state } = await readPurchaseFulfillment(db, line); return this.view(db, line, state, actor); }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
  private validate(input: FulfillmentMutationDto) {
    if (!input || !/^[A-Za-z0-9_-]{16,128}$/.test(input.requestId ?? '') || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0 || input.expectedVersion > 2147483646) throw new BadRequestException('提交标识或版本无效，请重新载入');
    if (typeof input.expectedSourceUpdatedAt !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.expectedSourceUpdatedAt) || !Number.isFinite(Date.parse(input.expectedSourceUpdatedAt)) || new Date(input.expectedSourceUpdatedAt).toISOString() !== input.expectedSourceUpdatedAt) throw new BadRequestException('订单来源版本无效');
    reason(input.reason);
  }
  async propose(lineId: string, input: ProposeFulfillmentDto, actor: ProcActor) {
    this.permission(actor, 'proc-purchase-order:adjust-fulfillment'); this.validate(input);
    if (!['cancel', 'return', 'reversal', 'coverage'].includes(input.kind) || typeof input.quantity !== 'number' || !Number.isFinite(input.quantity) || input.quantity < 0 || input.quantity > 99999999999.999 || new Prisma.Decimal(input.quantity).decimalPlaces() > 3 || (input.kind !== 'coverage' && input.quantity <= 0)) throw new BadRequestException('调整数量须为大于零且最多三位小数的数字');
    if (!Array.isArray(input.reflectedEntryIds) || input.reflectedEntryIds.length > 2000 || input.reflectedEntryIds.some((id) => typeof id !== 'string') || new Set(input.reflectedEntryIds).size !== input.reflectedEntryIds.length) throw new BadRequestException('ERP 已反映调整列表无效');
    if (input.kind === 'coverage' && input.quantity !== 0) throw new BadRequestException('覆盖确认不登记新数量');
    if (input.kind !== 'coverage' && input.reflectedEntryIds.length) throw new BadRequestException('仅覆盖确认可以指定 ERP 已反映记录');
    if (['return', 'reversal'].includes(input.kind) && (!input.receiptId || !['qualified', 'defective', 'pending_judgment', 'pending'].includes(input.bucket ?? ''))) throw new BadRequestException('退货或冲销须指定收货记录和数量所属判定');
    return this.mutate(lineId, input, actor, 'proposed', null, async (line, state) => {
      const entry: FulfillmentEntry = { id: randomUUID(), kind: input.kind, status: 'pending', quantity: input.quantity,
        receiptId: ['return', 'reversal'].includes(input.kind) ? input.receiptId! : null, bucket: ['return', 'reversal'].includes(input.kind) ? input.bucket! : null,
        reason: reason(input.reason), sourceFingerprint: fulfillmentSourceFingerprint(line), createdById: actor.id, createdByName: actor.name, createdAt: new Date().toISOString(), reflectedEntryIds: input.reflectedEntryIds,
        coverageFingerprint: input.kind === 'coverage' ? fulfillmentCoverageFingerprint(line, line.receipts, state.entries) : null, history: [] };
      this.checkEntry(line, state, entry); state.entries.push(entry); return entry;
    });
  }
  async decide(lineId: string, entryId: string, action: 'approved' | 'revoked', input: FulfillmentMutationDto, actor: ProcActor) {
    this.permission(actor, action === 'approved' ? 'proc-purchase-order:approve-fulfillment' : 'proc-purchase-order:adjust-fulfillment'); this.validate(input);
    return this.mutate(lineId, input, actor, action, entryId, async (line, state) => {
      const entry = state.entries.find((e) => e.id === entryId); if (!entry) throw new NotFoundException('调整记录不存在');
      if (entry.status === 'revoked' || (action === 'approved' && entry.status !== 'pending')) throw new ConflictException('该记录已处理，请重新载入');
      if (action === 'revoked' && entry.status === 'approved' && !has(actor, 'proc-purchase-order:approve-fulfillment')) throw new ForbiddenException('撤销已批准调整需要履约审批权限');
      if (action === 'approved') {
        if (entry.sourceFingerprint !== fulfillmentSourceFingerprint(line)) throw new ConflictException('ERP 来源已变化，请撤销后重新登记');
        if (entry.kind === 'coverage' && entry.coverageFingerprint !== fulfillmentCoverageFingerprint(line, line.receipts, state.entries)) throw new ConflictException('收货、检验或调整记录已变化，请重新登记覆盖确认');
        this.checkEntry(line, state, entry);
      }
      entry.status = action; if (action === 'approved') entry.approvedVersion = state.version + 1; return entry;
    });
  }
  private checkEntry(line: Line, state: FulfillmentState, entry: FulfillmentEntry) {
    const current = calculatePurchaseFulfillment(line, line.receipts, state);
    if (entry.kind === 'cancel' && (current.remainingQty === null || current.effectiveOrderedQty === null || entry.quantity > current.remainingQty || new Prisma.Decimal(entry.quantity).gt(new Prisma.Decimal(current.effectiveOrderedQty).minus(current.localNetReceivedQty)))) throw new BadRequestException('取消数量不能超过已核对的未收数量，已登记本地实收也须保留');
    if (entry.kind === 'return' || entry.kind === 'reversal') {
      if (current.issues.some((issue) => /来源|已作废|判定与/.test(issue))) throw new ConflictException('订单来源或检验判定存在冲突，请先核对历史记录');
      const receipt = current.receipts.find((r) => r.id === entry.receiptId);
      const key = { qualified: 'qualifiedQty', defective: 'defectiveQty', pending_judgment: 'pendingJudgmentQty', pending: 'pendingQty' } as const;
      if (!receipt || !entry.bucket || entry.quantity > receipt[key[entry.bucket]]) throw new BadRequestException('退货或冲销数量超过该收货记录对应判定的可扣减数量');
    }
    if (entry.kind === 'coverage') {
      if (entry.reflectedEntryIds.some((id) => !state.entries.some((e) => e.id === id && e.kind !== 'coverage' && e.status === 'approved'))) throw new BadRequestException('ERP 已反映列表只能引用当前已批准数量调整');
      const candidate = { ...state, entries: [...state.entries.filter((e) => e.id !== entry.id), { ...entry, status: 'approved' as const, approvedVersion: state.version + 1 }] };
      if (!calculatePurchaseFulfillment(line, line.receipts, candidate).coverageComplete) throw new BadRequestException('本地净实收与扣除未反映调整后的 ERP 到货不一致，不能确认完整覆盖');
    }
  }
  private async mutate(lineId: string, input: FulfillmentMutationDto, actor: ProcActor, action: 'proposed' | 'approved' | 'revoked', entryId: string | null, operation: (line: Line, state: FulfillmentState) => Promise<FulfillmentEntry>) {
    const hash = fulfillmentHash([lineId, entryId, action, input]);
    return this.prisma.$transaction(async (db) => {
      await db.$queryRaw`SELECT id FROM "ProcPurchaseOrderMirror" WHERE id = ${lineId} FOR UPDATE`;
      const line = await this.line(db, lineId); const { state } = await readPurchaseFulfillment(db, line);
      const request = state.requests.find((r) => r.id === input.requestId);
      if (request) { if (request.actorId !== actor.id || request.hash !== hash) throw new ConflictException('提交标识已用于其他操作'); return this.view(db, line, state, actor); }
      if (state.version !== input.expectedVersion || line.updatedAt.toISOString() !== input.expectedSourceUpdatedAt) throw new ConflictException('订单或履约台账已更新，请重新载入后核对');
      const entry = await operation(line, state); const at = new Date().toISOString();
      entry.history.push({ action, reason: reason(input.reason), actorId: actor.id, actorName: actor.name, at }); state.version++;
      state.requests.push({ id: input.requestId, actorId: actor.id, hash });
      await db.runtimeState.upsert({ where: { key: fulfillmentStateKey(lineId) }, create: { key: fulfillmentStateKey(lineId), value: JSON.stringify(state) }, update: { value: JSON.stringify(state) } });
      await db.auditLog.create({ data: { module: 'procurement', source: 'web', action: `purchase-order.fulfillment-${action}`, resource: 'proc-purchase-fulfillment', resourceId: entry.id, resourceName: `${line.tpOrderNo} · ${line.tpLineNo}`, userId: actor.id, actorName: actor.name, summary: `订单行履约${action === 'proposed' ? '登记' : action === 'approved' ? '批准' : '撤销'}：${reason(input.reason)}`, meta: { lineId, version: state.version, kind: entry.kind, quantity: entry.quantity, receiptId: entry.receiptId, reason: reason(input.reason) } } });
      return this.view(db, line, state, actor);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }
}
