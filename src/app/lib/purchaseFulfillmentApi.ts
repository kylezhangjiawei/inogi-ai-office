import { authFetch, readErrorMessage } from './authSession';
export type FulfillmentKind = 'cancel' | 'return' | 'reversal' | 'coverage';
export type FulfillmentBucket = 'qualified' | 'defective' | 'pending_judgment' | 'pending';
export interface FulfillmentEntry {
  id: string; kind: FulfillmentKind; status: 'pending' | 'approved' | 'revoked'; quantity: number;
  receiptId: string | null; bucket: FulfillmentBucket | null; reason: string; createdByName: string; createdAt: string;
  reflectedEntryIds: string[]; history: { action: string; reason: string; actorName: string; at: string }[];
}
export interface StockPlanFulfillmentSummary {
  unit: string; targetQty: number; orderedQty: number | null; receivedQty: number | null; qualifiedQty: number | null;
  remainingToPurchaseQty: number | null; remainingToReceiveQty: number | null; provisional: boolean; issues: string[];
}
export interface PurchaseFulfillmentLedger {
  line: { id: string; orderNo: string; lineNo: string; name: string; unit: string; updatedAt: string };
  version: number; canPropose: boolean; canApprove: boolean; canReadAffectedPlans: boolean; entries: FulfillmentEntry[];
  summary: { erpOrderedQty: number; erpReceivedQty: number; effectiveOrderedQty: number | null; effectiveReceivedQty: number | null;
    remainingQty: number | null; localGrossReceivedQty: number; localNetReceivedQty: number; localQualifiedQty: number; qualifiedAvailableQty: number | null;
    cancelledQty: number; returnedQty: number; reversedQty: number; coverageComplete: boolean; coverageCurrent: boolean; issues: string[];
    receipts: { id: string; qualifiedQty: number; defectiveQty: number; pendingJudgmentQty: number; pendingQty: number; netReceivedQty: number }[] };
  receiptOptions: { id: string; deliveryNo: string; receivedDate: string }[];
  affectedPlans: (StockPlanFulfillmentSummary & { id: string; code: string; name: string })[];
}
export interface FulfillmentMutation { requestId: string; expectedVersion: number; expectedSourceUpdatedAt: string; reason: string }
export interface ProposeFulfillmentInput extends FulfillmentMutation { kind: FulfillmentKind; quantity: number; receiptId?: string; bucket?: FulfillmentBucket; reflectedEntryIds: string[] }
const record = (x: unknown): x is Record<string, unknown> => Boolean(x) && typeof x === 'object' && !Array.isArray(x);
const qty = (x: unknown) => x === null || typeof x === 'number' && Number.isFinite(x);
const strings = (x: Record<string, unknown>, keys: string[]) => keys.every((key) => typeof x[key] === 'string');
const stringList = (x: unknown) => Array.isArray(x) && x.every((item) => typeof item === 'string');
export function isPurchaseFulfillmentLedger(value: unknown): value is PurchaseFulfillmentLedger {
  if (!record(value) || !record(value.line) || !record(value.summary) || typeof value.line.id !== 'string' || !value.line.id || typeof value.line.updatedAt !== 'string'
    || !strings(value.line, ['orderNo', 'lineNo', 'name', 'unit']) || !Number.isSafeInteger(value.version) || Number(value.version) < 0 || typeof value.canApprove !== 'boolean' || typeof value.canPropose !== 'boolean' || typeof value.canReadAffectedPlans !== 'boolean' || !Array.isArray(value.entries) || !Array.isArray(value.receiptOptions) || !Array.isArray(value.affectedPlans)) return false;
  return ['erpOrderedQty', 'erpReceivedQty', 'effectiveOrderedQty', 'effectiveReceivedQty', 'remainingQty', 'localGrossReceivedQty', 'localNetReceivedQty', 'localQualifiedQty', 'qualifiedAvailableQty'].every((key) => qty(value.summary![key]))
    && typeof value.summary.coverageComplete === 'boolean' && typeof value.summary.coverageCurrent === 'boolean' && stringList(value.summary.issues) && Array.isArray(value.summary.receipts)
    && value.summary.receipts.every((r) => record(r) && typeof r.id === 'string' && ['qualifiedQty', 'defectiveQty', 'pendingJudgmentQty', 'pendingQty', 'netReceivedQty'].every((key) => qty(r[key]) && r[key] !== null))
    && value.entries.every((entry) => record(entry) && strings(entry, ['id', 'reason', 'createdByName', 'createdAt']) && ['pending', 'approved', 'revoked'].includes(String(entry.status)) && ['cancel', 'return', 'reversal', 'coverage'].includes(String(entry.kind)) && qty(entry.quantity) && entry.quantity !== null && stringList(entry.reflectedEntryIds) && Array.isArray(entry.history)
      && entry.history.every((h) => record(h) && strings(h, ['action', 'reason', 'actorName', 'at'])))
    && value.receiptOptions.every((r) => record(r) && strings(r, ['id', 'deliveryNo', 'receivedDate']))
    && value.affectedPlans.every((p) => record(p) && strings(p, ['id', 'code', 'name', 'unit']) && typeof p.provisional === 'boolean' && stringList(p.issues) && ['targetQty', 'orderedQty', 'receivedQty', 'qualifiedQty', 'remainingToPurchaseQty', 'remainingToReceiveQty'].every((key) => qty(p[key])));
}
export class PurchaseFulfillmentError extends Error { constructor(message: string, readonly status: number) { super(message); this.name = 'PurchaseFulfillmentError'; } }
async function request(lineId: string, suffix = '', input?: FulfillmentMutation, signal?: AbortSignal): Promise<PurchaseFulfillmentLedger> {
  if (signal?.aborted) throw new DOMException('请求已取消', 'AbortError');
  const controller = new AbortController();
  const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new PurchaseFulfillmentError(input ? '保存超时，结果尚未确认。请保留本次内容重试，系统会核对同一次提交。' : '履约台账读取超时，请重试', 0)); }, 30_000); });
  const read = async () => {
    const response = await authFetch(`/api/procurement/purchase-order-lines/${encodeURIComponent(lineId)}/fulfillment${suffix}`, { method: input ? 'POST' : 'GET', ...(input ? { body: JSON.stringify(input) } : {}), signal: controller.signal });
    if (!response.ok) throw new PurchaseFulfillmentError(await readErrorMessage(response, '履约台账读取或保存失败'), response.status);
    const value: unknown = await response.json();
    if (!isPurchaseFulfillmentLedger(value) || value.line.id !== lineId) throw new PurchaseFulfillmentError('履约台账响应不完整或订单行不匹配，请重新载入', 502);
    return value;
  };
  try { return await Promise.race([read(), timeout]); }
  finally { clearTimeout(timer!); signal?.removeEventListener('abort', abort); }
}
export const getPurchaseFulfillment = (lineId: string, signal?: AbortSignal) => request(lineId, '', undefined, signal);
export const proposePurchaseFulfillment = (lineId: string, input: ProposeFulfillmentInput) => request(lineId, '', input);
export const decidePurchaseFulfillment = (lineId: string, entryId: string, action: 'approve' | 'revoke', input: FulfillmentMutation) => request(lineId, `/${encodeURIComponent(entryId)}/${action}`, input);
