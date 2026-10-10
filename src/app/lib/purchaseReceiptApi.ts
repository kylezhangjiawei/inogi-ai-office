import { authFetch, readErrorMessage } from './authSession';
import type { PreviewableAttachment } from '../components/AttachmentPreviewDialog';
export type ReceiptFile = { fileId: string; name: string; mime: string; size: number };
export type ReceiptWarehouseRecord = { id: string; status: string; warehouse: string; quantity: number; qualifiedQty: number; defectiveQty: number; pendingQty: number; confirmedAt?: string; events: { action: string; actorName: string; at: string; reason: string }[] };

export interface PurchaseReceiptQuantities {
  receivedQty: number;
  qualifiedQty: number;
  defectiveQty: number;
  pendingJudgmentQty: number;
  pendingQty: number;
}

export interface PurchaseReceiptInspection {
  id: string;
  version: number;
  inspectionDate: string;
  qualifiedQty: number;
  defectiveQty: number;
  pendingJudgmentQty: number;
  pendingQty: number;
  basis: string;
  note: string;
  createdByName: string;
  createdAt: string;
}

export interface PurchaseReceipt extends PurchaseReceiptQuantities {
  receiptNumber?: string;
  numberSource?: 'system' | 'supplier';
  files?: ReceiptFile[];
  warehouseRecord?: ReceiptWarehouseRecord | null;
  id: string;
  deliveryNo: string;
  receivedDate: string;
  note: string;
  createdByName: string;
  createdAt: string;
  sourceChanged: boolean;
  version: number;
  source: {
    orderId: string;
    orderNo: string;
    lineNo: string;
    inventoryCode: string;
    inventoryName: string;
    spec: string;
    unit: string;
    supplierName: string;
    orderedQty: number;
    updatedAt: string;
  };
  inspections: PurchaseReceiptInspection[];
}

export interface PurchaseReceiptLedger {
  fulfillment?: {
    effectiveOrderedQty: number | null; localNetReceivedQty: number; localQualifiedQty: number;
    qualifiedAvailableQty: number | null; issues: string[];
  };
  line: {
    id: string;
    orderNo: string;
    lineNo: string;
    tpOrderId: string | null;
    inventoryCode: string;
    inventoryName: string;
    spec: string;
    unit: string;
    supplierName: string;
    orderedQty: number;
    erpReceivedQty: number;
    updatedAt: string;
    status: string | null;
    approvalStatus: string | null;
  };
  canReceive: boolean;
  canInspect: boolean;
  sourceIssue: string | null;
  summaryUnit: string;
  summary: PurchaseReceiptQuantities;
  receipts: PurchaseReceipt[];
}

export interface CreatePurchaseReceiptInput {
  fileIds?: string[];
  requestId: string;
  expectedSourceUpdatedAt: string;
  deliveryNo?: string;
  receivedDate: string;
  receivedQty: number;
  note: string;
}

export interface CreatePurchaseInspectionInput {
  fileIds?: string[];
  treeNodeId?: string;
  requestId: string;
  expectedVersion: number;
  expectedSourceUpdatedAt: string;
  inspectionDate: string;
  qualifiedQty: number;
  defectiveQty: number;
  pendingJudgmentQty: number;
  basis: string;
  note: string;
}

const linePath = (lineId: string) => `/api/procurement/purchase-order-lines/${encodeURIComponent(lineId)}/receipts`;
export class PurchaseReceiptRequestError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'PurchaseReceiptRequestError';
  }
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const strings = (value: Record<string, unknown>, keys: string[]) => keys.every((key) => typeof value[key] === 'string');
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const quantityFields = ['qualifiedQty', 'defectiveQty', 'pendingJudgmentQty', 'pendingQty'];
const quantities = (value: Record<string, unknown>, received = false) => [...quantityFields, ...(received ? ['receivedQty'] : [])]
  .every((key) => finite(value[key]) && value[key] >= 0);
const version = (value: unknown, min: number) => finite(value) && Number.isSafeInteger(value) && value >= min;
const inspection = (value: unknown): boolean => record(value)
  && strings(value, ['id', 'inspectionDate', 'basis', 'note', 'createdByName', 'createdAt'])
  && !!value.id && version(value.version, 1) && quantities(value);
const receiptDetails = (value: Record<string, unknown>) => {
  const warehouse = value.warehouseRecord;
  return (value.receiptNumber === undefined || typeof value.receiptNumber === 'string' && value.receiptNumber.length > 0)
  && (value.numberSource === undefined || ['system', 'supplier'].includes(String(value.numberSource)))
  && (value.files === undefined || Array.isArray(value.files) && value.files.every(file => record(file) && strings(file, ['fileId', 'name', 'mime']) && finite(file.size) && file.size >= 0))
  && (warehouse === undefined || warehouse === null || record(warehouse)
    && strings(warehouse, ['id', 'status', 'warehouse'])
    && ['quantity', 'qualifiedQty', 'defectiveQty', 'pendingQty'].every(key => finite(warehouse[key]) && warehouse[key] >= 0)
    && Array.isArray(warehouse.events) && warehouse.events.every(event => record(event) && strings(event, ['action', 'actorName', 'at', 'reason'])));
};
const receipt = (value: unknown): boolean => record(value)
  && receiptDetails(value)
  && strings(value, ['id', 'deliveryNo', 'receivedDate', 'note', 'createdByName', 'createdAt'])
  && !!value.id && version(value.version, 0) && quantities(value, true)
  && typeof value.sourceChanged === 'boolean' && Array.isArray(value.inspections) && value.inspections.every(inspection)
  && record(value.source) && strings(value.source, ['orderId', 'orderNo', 'lineNo', 'inventoryCode', 'inventoryName', 'spec', 'unit', 'supplierName', 'updatedAt'])
  && finite(value.source.orderedQty) && value.source.orderedQty > 0;

/** Reject malformed successful responses before rendering history or enabling another mutation. */
export function isPurchaseReceiptLedger(value: unknown): value is PurchaseReceiptLedger {
  return record(value) && record(value.line)
    && strings(value.line, ['id', 'orderNo', 'lineNo', 'inventoryCode', 'inventoryName', 'spec', 'unit', 'supplierName', 'updatedAt'])
    && !!value.line.id && [value.line.tpOrderId, value.line.status, value.line.approvalStatus].every((item) => item === null || typeof item === 'string')
    && finite(value.line.orderedQty) && finite(value.line.erpReceivedQty)
    && typeof value.canReceive === 'boolean' && typeof value.canInspect === 'boolean'
    && (value.sourceIssue === null || typeof value.sourceIssue === 'string') && typeof value.summaryUnit === 'string'
    && record(value.summary) && quantities(value.summary, true)
    && Array.isArray(value.receipts) && value.receipts.every(receipt)
    && (value.fulfillment === undefined || record(value.fulfillment)
      && (value.fulfillment.effectiveOrderedQty === null || finite(value.fulfillment.effectiveOrderedQty))
      && finite(value.fulfillment.localNetReceivedQty) && finite(value.fulfillment.localQualifiedQty)
      && (value.fulfillment.qualifiedAvailableQty === null || finite(value.fulfillment.qualifiedAvailableQty))
      && Array.isArray(value.fulfillment.issues) && value.fulfillment.issues.every((item) => typeof item === 'string'));
}
async function readResponse(path: string, init: RequestInit): Promise<PurchaseReceiptLedger> {
  const response = await authFetch(path, init);
  if (!response.ok) throw new PurchaseReceiptRequestError(await readErrorMessage(response, '收货检验记录读取或保存失败'), response.status);
  let result: unknown;
  try { result = await response.json(); }
  catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new PurchaseReceiptRequestError('收货检验响应格式无效，请重新载入后核对', 502);
  }
  if (!isPurchaseReceiptLedger(result)) throw new PurchaseReceiptRequestError('收货检验响应不完整，请重新载入后核对', 502);
  return result;
}

async function request(path: string, init: RequestInit = {}): Promise<PurchaseReceiptLedger> {
  const external = init.signal;
  if (external?.aborted) throw new DOMException('请求已取消', 'AbortError');
  const controller = new AbortController();
  let timedOut = false;
  const isWrite = init.method === 'POST';
  const timeoutError = new PurchaseReceiptRequestError(isWrite
    ? '保存请求超时，结果尚未确认。请保留当前信息并重试，系统会核对同一次提交，避免重复登记。'
    : '收货检验记录读取超时，请重试', 0);
  let rejectCancellation!: (reason: unknown) => void;
  const cancelled = new Promise<never>((_resolve, reject) => { rejectCancellation = reject; });
  const abort = () => {
    const error = new DOMException('请求已取消', 'AbortError');
    controller.abort(error);
    rejectCancellation(error);
  };
  external?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException('请求超时', 'TimeoutError'));
    rejectCancellation(timeoutError);
  }, 30_000);
  try {
    return await Promise.race([readResponse(path, { ...init, signal: controller.signal }), cancelled]);
  } catch (error) {
    if (timedOut) throw timeoutError;
    throw error;
  } finally {
    clearTimeout(timer);
    external?.removeEventListener('abort', abort);
  }
}

export function getPurchaseReceipts(lineId: string, signal?: AbortSignal) {
  return request(linePath(lineId), { signal });
}
export function createPurchaseReceipt(lineId: string, input: CreatePurchaseReceiptInput, signal?: AbortSignal) {
  return request(linePath(lineId), { method: 'POST', body: JSON.stringify(input), signal });
}
export function createPurchaseInspection(lineId: string, receiptId: string, input: CreatePurchaseInspectionInput, signal?: AbortSignal) {
  return request(`${linePath(lineId)}/${encodeURIComponent(receiptId)}/inspections`, { method: 'POST', body: JSON.stringify(input), signal });
}

export async function getReceiptQualityOptions(lineId: string, signal?: AbortSignal): Promise<Array<{ id: string; productId: string; name: string; parentId: string | null }>> {
  const response = await authFetch(linePath(lineId) + '/quality-options', { signal });
  if (!response.ok) throw new Error(await readErrorMessage(response, '质量归属读取失败'));
  return response.json();
}

export async function getPurchaseReceiptAttachment(lineId: string, receiptId: string, fileId: string): Promise<PreviewableAttachment> {
  const response = await authFetch(`${linePath(lineId)}/${encodeURIComponent(receiptId)}/files/${encodeURIComponent(fileId)}`);
  if (!response.ok) throw new Error(await readErrorMessage(response, '收货附件读取失败'));
  return response.json();
}
