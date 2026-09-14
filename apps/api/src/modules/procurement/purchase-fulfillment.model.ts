import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { isVoidedOrderStatus } from './replenish-core';

export type FulfillmentKind = 'cancel' | 'return' | 'reversal' | 'coverage';
export type FulfillmentBucket = 'qualified' | 'defective' | 'pending_judgment' | 'pending';
export type FulfillmentEntry = {
  id: string; kind: FulfillmentKind; status: 'pending' | 'approved' | 'revoked';
  quantity: number; receiptId: string | null; bucket: FulfillmentBucket | null;
  reason: string; sourceFingerprint: string; createdById: string; createdByName: string; createdAt: string;
  reflectedEntryIds: string[]; coverageFingerprint: string | null; approvedVersion?: number;
  history: { action: 'proposed' | 'approved' | 'revoked'; reason: string; actorId: string; actorName: string; at: string }[];
};
export type FulfillmentState = { version: number; entries: FulfillmentEntry[]; requests: { id: string; actorId: string; hash: string }[] };
export type FulfillmentLine = { id: string; tpOrderId: string | null; tpOrderNo: string; tpLineNo: string; inventoryCode: string; inventoryName: string; spec: string; supplierName: string; unit: string; status?: string | null; approvalStatus?: string | null; orderedQty: Prisma.Decimal; receivedQty: Prisma.Decimal };
export type FulfillmentReceipt = { id: string; version: number; receivedQty: Prisma.Decimal; sourceUnit: string; sourceOrderId: string; sourceOrderNo: string; sourceLineNo: string; sourceInventoryCode: string; sourceInventoryName: string; sourceSpec: string; sourceSupplierName: string; inspections: { qualifiedQty: Prisma.Decimal; defectiveQty: Prisma.Decimal; pendingJudgmentQty: Prisma.Decimal }[] };
export const fulfillmentStateKey = (lineId: string) => `procurement:fulfillment:v1:${lineId}`;
export const emptyFulfillmentState = (): FulfillmentState => ({ version: 0, entries: [], requests: [] });
export const fulfillmentHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const fulfillmentSourceFingerprint = (line: FulfillmentLine) => fulfillmentHash([line.tpOrderId, line.tpOrderNo, line.tpLineNo, line.inventoryCode, line.inventoryName, line.spec, line.supplierName, line.unit, line.orderedQty.toString(), line.receivedQty.toString()]);
const d = (value: number | string | Prisma.Decimal = 0) => new Prisma.Decimal(value);
const sum = (entries: FulfillmentEntry[]) => entries.reduce((total, entry) => total.plus(entry.quantity), d());
export function fulfillmentCoverageFingerprint(line: FulfillmentLine, receipts: FulfillmentReceipt[], entries: FulfillmentEntry[]) {
  return fulfillmentHash([fulfillmentSourceFingerprint(line), receipts.map((r) => [r.id, r.version, r.receivedQty.toString()]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    entries.filter((e) => e.status === 'approved' && e.kind !== 'coverage').map((e) => e.id).sort()]);
}

/** ERP execution and local receipt evidence stay separate. No sum can count both. */
export function calculatePurchaseFulfillment(line: FulfillmentLine, receipts: FulfillmentReceipt[], state: FulfillmentState) {
  const issues: string[] = [];
  if (isVoidedOrderStatus(line.status, line.approvalStatus)) issues.push('ERP 订单已作废或取消，历史数量须单独核对，不能据此安排到货或推算检验可用');
  if (!line.unit.trim() || !line.tpOrderId || !line.tpLineNo || !line.inventoryCode || !line.orderedQty.isFinite() || line.orderedQty.lte(0) || !line.receivedQty.isFinite() || line.receivedQty.lt(0)) issues.push('订单来源标识、单位或数量无效');
  const approved = state.entries.filter((e) => e.status === 'approved' && e.kind !== 'coverage');
  const coverage = state.entries.filter((e) => e.kind === 'coverage' && e.status === 'approved').sort((a, b) => (b.approvedVersion ?? 0) - (a.approvedVersion ?? 0))[0];
  const coverageCurrent = Boolean(coverage && coverage.coverageFingerprint === fulfillmentCoverageFingerprint(line, receipts, state.entries));
  if (!coverageCurrent && coverage?.reflectedEntryIds.some((id) => !approved.some((entry) => entry.id === id))) issues.push('曾确认已在 ERP 反映的调整已撤销，须重新核对 ERP 与本地记录');
  const reflected = new Set(coverageCurrent ? coverage!.reflectedEntryIds : []);
  const cancelled = sum(approved.filter((e) => e.kind === 'cancel' && !reflected.has(e.id)));
  const reductions = approved.filter((e) => e.kind === 'return' || e.kind === 'reversal');
  const erpReductions = sum(reductions.filter((e) => !reflected.has(e.id)));
  const receiptRows = receipts.map((receipt) => {
    const receiptIssues: string[] = [];
    const latest = receipt.inspections[0];
    const buckets = { qualified: d(latest?.qualifiedQty ?? 0), defective: d(latest?.defectiveQty ?? 0), pending_judgment: d(latest?.pendingJudgmentQty ?? 0), pending: d(receipt.receivedQty).minus(latest?.qualifiedQty ?? 0).minus(latest?.defectiveQty ?? 0).minus(latest?.pendingJudgmentQty ?? 0) };
    for (const entry of reductions.filter((e) => e.receiptId === receipt.id)) if (entry.bucket) buckets[entry.bucket] = buckets[entry.bucket].minus(entry.quantity);
    if (!receipt.receivedQty.isFinite() || receipt.receivedQty.lt(0) || Object.values(buckets).some((qty) => !qty.isFinite())) receiptIssues.push(`收货记录 ${receipt.id} 的数量无效`);
    if (Object.values(buckets).some((qty) => qty.lt(0))) receiptIssues.push(`收货记录 ${receipt.id} 的检验判定与已批准扣减冲突`);
    if (receipt.sourceUnit !== line.unit || receipt.sourceOrderId !== line.tpOrderId || receipt.sourceOrderNo !== line.tpOrderNo || receipt.sourceLineNo !== line.tpLineNo || receipt.sourceInventoryCode !== line.inventoryCode || receipt.sourceInventoryName !== line.inventoryName || receipt.sourceSpec !== line.spec || receipt.sourceSupplierName !== line.supplierName) receiptIssues.push(`收货记录 ${receipt.id} 的来源与当前订单不一致`);
    issues.push(...receiptIssues);
    return { id: receipt.id, version: receipt.version, grossReceivedQty: receipt.receivedQty.toNumber(), netReceivedQty: Object.values(buckets).reduce((total, value) => total.plus(value), d()).toNumber(),
      qualifiedQty: buckets.qualified.toNumber(), defectiveQty: buckets.defective.toNumber(), pendingJudgmentQty: buckets.pending_judgment.toNumber(), pendingQty: buckets.pending.toNumber(), issues: receiptIssues };
  });
  if (reductions.some((entry) => !receipts.some((receipt) => receipt.id === entry.receiptId))) issues.push('调整所引用的收货记录缺失');
  const localNet = receiptRows.reduce((total, r) => total.plus(r.netReceivedQty), d());
  const localQualified = receiptRows.reduce((total, r) => total.plus(r.qualifiedQty), d());
  const sourceStable = coverageCurrent || approved.every((e) => e.sourceFingerprint === fulfillmentSourceFingerprint(line));
  if (!sourceStable) issues.push('ERP 数量或来源已变更，请重新确认调整是否已在 ERP 反映');
  const ordered = line.orderedQty.minus(cancelled), received = line.receivedQty.minus(erpReductions);
  if (ordered.lt(0) || received.lt(0)) issues.push('净订购或净到货为负数，请核对调整与 ERP 覆盖');
  if (localNet.gt(ordered)) issues.push('本地净实收超过净订购数量，请核对取消或收货记录');
  const coverageComplete = coverageCurrent && localNet.equals(received) && issues.length === 0;
  const quantityKnown = issues.length === 0 && sourceStable && (reductions.length === 0 || coverageComplete);
  if (reductions.length && !coverageComplete) issues.push('退货或冲销尚未完成 ERP 与本地收货覆盖确认');
  return { unit: line.unit, erpOrderedQty: line.orderedQty.toNumber(), erpReceivedQty: line.receivedQty.toNumber(),
    cancelledQty: sum(approved.filter((e) => e.kind === 'cancel')).toNumber(), returnedQty: sum(reductions.filter((e) => e.kind === 'return')).toNumber(), reversedQty: sum(reductions.filter((e) => e.kind === 'reversal')).toNumber(),
    effectiveOrderedQty: quantityKnown ? ordered.toNumber() : null, effectiveReceivedQty: quantityKnown ? received.toNumber() : null,
    remainingQty: quantityKnown ? Prisma.Decimal.max(ordered.minus(received), 0).toNumber() : null,
    localGrossReceivedQty: receipts.reduce((total, r) => total.plus(r.receivedQty), d()).toNumber(), localNetReceivedQty: localNet.toNumber(), localQualifiedQty: localQualified.toNumber(),
    qualifiedAvailableQty: coverageComplete ? localQualified.toNumber() : null, coverageComplete, coverageCurrent, coverageEntryId: coverage?.id ?? null,
    issues: [...new Set(issues)], receipts: receiptRows };
}
