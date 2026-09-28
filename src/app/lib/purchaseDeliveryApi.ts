import { authFetch, readErrorMessage } from './authSession';

export const PURCHASE_DELIVERY_CHANGED = 'inogi:purchase-delivery-changed';
export interface DeliveryHistoryPage<T> { items: T[]; page: number; pageSize: number; total: number; totalPages: number }
export interface SupplierCommitmentEntry {
  version: number; kind: 'original' | 'revision' | 'withdrawal'; before: string | null; after: string | null;
  communicatedOn: string; evidence: string; reason: string; actorId: string; actorName: string; recordedAt: string;
  sourceIdentity: string; source: Record<string, string | null>;
}
export interface ErpDeliveryEntry {
  version: number; kind: 'baseline' | 'change'; before: string | null; after: string | null;
  beforeOrderDate: string | null; afterOrderDate: string | null; recordedAt: string; source: Record<string, string | null>;
}
export interface PurchaseDeliveryDetail {
  line: { id: string; orderId: string | null; orderNo: string; lineNo: string; inventoryCode: string; inventoryName: string;
    spec: string; unit: string; supplierName: string; orderedQty: string; sourceUpdatedAt: string; orderDate: string | null;
    erpExpectedDate: string | null; syncedAt: string | null };
  canRecord: boolean;
  supplier: { version: number; originalDate: string | null; currentDate: string | null; sourceIdentity: string;
    sourceChanged: boolean; lastEntry: SupplierCommitmentEntry } | null;
  supplierHistory: DeliveryHistoryPage<SupplierCommitmentEntry>;
  erp: { version: number; currentDate: string | null; orderDate: string | null; coverageStartedAt: string; sourceIdentity: string } | null;
  erpHistory: DeliveryHistoryPage<ErpDeliveryEntry>; historyNotice: string;
}
export interface RecordSupplierCommitmentInput {
  requestId: string; orderNo: string; promisedDate: string | null; communicatedOn: string;
  evidence: string; reason: string; declareOriginal: boolean; expectedVersion: number; expectedSourceUpdatedAt: string;
}
export interface DeliveryScheduleRow {
  calendarDate?: string | null; availableDate?: string | null; dateNeedsReconfirmation?: boolean; timingNote?: string; latestSource?: string;
  lineId: string; orderNo: string; lineNo: string; inventoryCode: string; inventoryName: string; spec: string;
  supplierName: string; unit: string; orderedQty: number; receivedQty: number; orderDate: string | null;
  erpExpectedDate: string | null; sourceUpdatedAt: string; supplierPromisedDate: string | null; supplierSourceChanged: boolean;
  status: string | null; approvalStatus: string | null;
}
export interface DeliverySchedule {
  scope: 'permission-visible-erp-mirror'; source: 'tplus'; snapshot: string; month: string; syncedAt: string | null; oldestOrderDate: string | null;
  summary: { all: number; inMonth: number; undated: number; outside: number }; days: Array<{ date: string; count: number }>;
  rows: DeliveryHistoryPage<DeliveryScheduleRow>;
}
export interface DeliveryScheduleQuery { dateBasis?: 'erp' | 'latest' | 'available'; month: string; bucket?: 'month' | 'all' | 'undated' | 'outside'; date?: string; q?: string; supplier?: string; page?: number; pageSize?: number; snapshot?: string }
export interface PurchaseDeliveryImpact {
  scopeId: string; planId: string; month: string; productName: string; productLine: string; batchId: string | null; batchCode: string | null;
  needDate: string | null; availableDate: string | null; unit: string; assignedQty: number; effectiveQty: number | null; onTimeQty: number | null;
  delayDays: number | null; status: 'pending' | 'late' | 'on_time'; note: string;
}
export interface PurchaseDeliveryImpacts extends DeliveryHistoryPage<PurchaseDeliveryImpact> { lineId: string; orderNo: string; unresolvedCount: number; readAt: string; notice: string }
export class PurchaseDeliveryError extends Error { constructor(message: string, public status: number) { super(message); this.name = 'PurchaseDeliveryError'; } }
export function isDeliveryDay(value: unknown): value is string {
  return typeof value === 'string' && /^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
const nullableDay = (value: unknown) => value === null || isDeliveryDay(value);
const object = (value: unknown): value is Record<string, any> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const instant = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const identity = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const version = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 2147483646;
const source = (value: unknown) => object(value) && ['orderNo', 'lineNo', 'inventoryCode', 'inventoryName', 'spec', 'unit', 'supplierName', 'orderedQty'].every((key) => typeof value[key] === 'string') && (value.orderId === null || typeof value.orderId === 'string');
const page = (value: unknown, entry: (value: any) => boolean) => object(value) && Array.isArray(value.items) && value.items.every(entry)
  && ['page', 'pageSize', 'totalPages'].every((key) => Number.isSafeInteger(value[key]) && value[key] > 0)
  && Number.isSafeInteger(value.total) && value.total >= 0 && value.page <= value.totalPages
  && value.totalPages === Math.max(1, Math.ceil(value.total / value.pageSize))
  && value.items.length === Math.min(value.pageSize, Math.max(0, value.total - (value.page - 1) * value.pageSize));
export function isPurchaseDeliveryDetail(value: unknown): value is PurchaseDeliveryDetail {
  const supplierEntry = (entry: any) => object(entry) && version(entry.version) && ['original', 'revision', 'withdrawal'].includes(entry.kind)
    && nullableDay(entry.before) && nullableDay(entry.after) && ((entry.kind === 'withdrawal') === (entry.after === null)) && isDeliveryDay(entry.communicatedOn)
    && ['evidence', 'reason', 'actorId', 'actorName'].every((key) => typeof entry[key] === 'string' && entry[key].trim())
    && instant(entry.recordedAt) && identity(entry.sourceIdentity) && source(entry.source);
  const erpEntry = (entry: any) => object(entry) && version(entry.version) && ['baseline', 'change'].includes(entry.kind)
    && nullableDay(entry.before) && nullableDay(entry.after) && nullableDay(entry.beforeOrderDate) && nullableDay(entry.afterOrderDate) && instant(entry.recordedAt) && source(entry.source);
  return object(value) && object(value.line) && source(value.line) && typeof value.line.id === 'string' && Boolean(value.line.id)
    && instant(value.line.sourceUpdatedAt) && (value.line.syncedAt === null || instant(value.line.syncedAt))
    && nullableDay(value.line.erpExpectedDate) && nullableDay(value.line.orderDate) && typeof value.canRecord === 'boolean' && typeof value.historyNotice === 'string'
    && (value.supplier === null || (object(value.supplier) && version(value.supplier.version) && identity(value.supplier.sourceIdentity) && nullableDay(value.supplier.currentDate) && nullableDay(value.supplier.originalDate)
      && typeof value.supplier.sourceChanged === 'boolean' && supplierEntry(value.supplier.lastEntry) && value.supplier.lastEntry.version === value.supplier.version && value.supplier.lastEntry.after === value.supplier.currentDate && value.supplier.lastEntry.sourceIdentity === value.supplier.sourceIdentity))
    && (value.erp === null || (object(value.erp) && version(value.erp.version) && identity(value.erp.sourceIdentity) && nullableDay(value.erp.currentDate) && nullableDay(value.erp.orderDate) && instant(value.erp.coverageStartedAt)))
    && page(value.supplierHistory, supplierEntry) && page(value.erpHistory, erpEntry)
    && (value.supplier === null ? value.supplierHistory.total === 0 : value.supplierHistory.total === value.supplier.version)
    && (value.erp === null ? value.erpHistory.total === 0 : value.erpHistory.total === value.erp.version);
}
export function isDeliverySchedule(value: unknown): value is DeliverySchedule {
  return object(value) && value.scope === 'permission-visible-erp-mirror' && value.source === 'tplus' && identity(value.snapshot)
    && typeof value.month === 'string' && /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value.month)
    && (value.syncedAt === null || instant(value.syncedAt)) && nullableDay(value.oldestOrderDate)
    && object(value.summary) && ['all', 'inMonth', 'undated', 'outside'].every((key) => Number.isSafeInteger(value.summary[key]) && value.summary[key] >= 0)
    && value.summary.all === value.summary.inMonth + value.summary.undated + value.summary.outside
    && Array.isArray(value.days) && value.days.every((item: any) => object(item) && isDeliveryDay(item.date) && item.date.startsWith(value.month + '-') && Number.isSafeInteger(item.count) && item.count > 0)
    && new Set(value.days.map((item: any) => item.date)).size === value.days.length && value.days.reduce((sum: number, item: any) => sum + item.count, 0) === value.summary.inMonth
    && page(value.rows, (row) => object(row) && ['lineId', 'orderNo', 'lineNo', 'inventoryCode', 'inventoryName', 'spec', 'supplierName', 'unit'].every((key) => typeof row[key] === 'string')
      && (row.calendarDate === undefined || nullableDay(row.calendarDate)) && (row.availableDate === undefined || nullableDay(row.availableDate))
      && Boolean(row.lineId) && nullableDay(row.erpExpectedDate) && nullableDay(row.orderDate) && nullableDay(row.supplierPromisedDate) && instant(row.sourceUpdatedAt)
      && typeof row.supplierSourceChanged === 'boolean' && Number.isFinite(row.orderedQty) && Number.isFinite(row.receivedQty)
      && (row.status === null || typeof row.status === 'string') && (row.approvalStatus === null || typeof row.approvalStatus === 'string'))
    && value.rows.total <= value.summary.all && new Set(value.rows.items.map((row: any) => row.lineId)).size === value.rows.items.length;
}

async function request(path: string, init: RequestInit = {}) {
  const controller = new AbortController(); let timedOut = false;
  const abort = () => controller.abort();
  if (init.signal?.aborted) abort(); else init.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 30000);
  try {
    const response = await authFetch(`/api/procurement/delivery${path}`, { ...init, signal: controller.signal });
    if (!response.ok) throw new PurchaseDeliveryError(await readErrorMessage(response, '交期记录读取或保存失败'), response.status);
    return await response.json();
  } catch (error) { if (timedOut) throw new PurchaseDeliveryError(init.method === 'POST' ? '保存超时，结果尚未确认。请保留草稿重试，同一次提交不会重复登记。' : '交期读取超时，请重试', 0); throw error; }
  finally { clearTimeout(timer); init.signal?.removeEventListener('abort', abort); }
}
function checkedDetail(value: unknown, lineId: string, orderNo: string) {
  if (!isPurchaseDeliveryDetail(value) || value.line.id !== lineId || value.line.orderNo !== orderNo) throw new PurchaseDeliveryError('交期返回内容或订单行关联无效，请刷新后核对', 502);
  return value;
}
export async function getPurchaseDelivery(lineId: string, orderNo: string, supplierPage = 1, erpPage = 1, signal?: AbortSignal) {
  return checkedDetail(await request(`/lines/${encodeURIComponent(lineId)}?${new URLSearchParams({ orderNo, supplierPage: String(supplierPage), erpPage: String(erpPage) })}`, { signal }), lineId, orderNo);
}
export async function getPurchaseDeliveryImpacts(lineId: string, orderNo: string, requestedPage = 1, signal?: AbortSignal): Promise<PurchaseDeliveryImpacts> {
  const value = await request(`/lines/${encodeURIComponent(lineId)}/impacts?${new URLSearchParams({ orderNo, page: String(requestedPage) })}`, { signal });
  const qty = (number: unknown) => number === null || (typeof number === 'number' && Number.isFinite(number) && number >= 0);
  if (!object(value) || value.lineId !== lineId || value.orderNo !== orderNo || !instant(value.readAt) || typeof value.notice !== 'string' || !Number.isSafeInteger(value.unresolvedCount) || value.unresolvedCount < 0
    || !page(value, row => object(row) && ['scopeId', 'planId', 'month', 'productName', 'productLine', 'unit', 'note'].every(key => typeof row[key] === 'string')
      && Boolean(row.scopeId) && Boolean(row.planId) && /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(row.month)
      && (row.batchId === null || typeof row.batchId === 'string') && (row.batchCode === null || typeof row.batchCode === 'string')
      && nullableDay(row.needDate) && nullableDay(row.availableDate) && typeof row.assignedQty === 'number' && qty(row.assignedQty)
      && qty(row.effectiveQty) && qty(row.onTimeQty) && qty(row.delayDays) && ['pending', 'late', 'on_time'].includes(row.status))) throw new PurchaseDeliveryError('影响计划返回内容或订单行关联无效，请重新核对', 502);
  return value as PurchaseDeliveryImpacts;
}
export async function recordSupplierCommitment(lineId: string, input: RecordSupplierCommitmentInput, signal?: AbortSignal) {
  return checkedDetail(await request(`/lines/${encodeURIComponent(lineId)}/commitments`, { method: 'POST', body: JSON.stringify(input), signal }), lineId, input.orderNo);
}
export async function getDeliverySchedule(query: DeliveryScheduleQuery, signal?: AbortSignal) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== '') params.set(key, String(value));
  const value = await request(`/schedule?${params}`, { signal });
  if (!isDeliverySchedule(value) || value.month !== query.month) throw new PurchaseDeliveryError('日期视图返回内容无效，请刷新后核对', 502);
  return value;
}
