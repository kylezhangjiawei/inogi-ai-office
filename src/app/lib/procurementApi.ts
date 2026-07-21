// 采购管理接口客户端。类型与后端 procurement.service 的序列化出口对齐。
import { authFetch, readErrorMessage } from "./authSession";

export type ProcMethod = "inquiry" | "direct";
export type PaymentStatus = "unpaid" | "partial" | "paid";
export type ProcSource = "rd" | "self";
export type BusinessLine = "rd" | "production";
export type ProcStatus =
  | "pending_confirm"
  | "pending_inquiry"
  | "inquiring"
  | "pending_sample"
  | "testing"
  | "priced"
  | "pending_purchase"
  | "in_transit"
  | "partial_arrival"
  | "completed"
  | "cancelled";

export interface ProcLog {
  at: string;
  text: string;
  kind?: "system" | "action";
}

export interface ProcTaskAttachment {
  id: string;
  fileName: string;
  fileUrl: string;
  fileSize: number;
  mimeType?: string;
  kind: string;
}

export interface ProcTaskPurchaseOrder {
  id: string;
  tpOrderNo: string;
  tpLineNo?: string;
  supplierName: string;
  orderedQty: number;
  receivedQty: number;
  unitPrice: number | null;
  orderDate?: string;
  etaDate?: string;
  approvalStatus?: string;
  status?: string;
}

export interface ProcurementTask {
  id: string;
  code: string;
  materialId?: string | null;
  materialName: string;
  spec: string;
  unit: string;
  quantity: number;
  method: ProcMethod;
  purchaseLink?: string;
  needDate?: string;
  deadline?: string;
  expectedArrivalDate?: string;
  paymentDate?: string;
  paymentStatus: PaymentStatus;
  paymentNote?: string;
  arrivedQty: number;
  source: ProcSource;
  businessLine: BusinessLine;
  rdTaskId?: string;
  rdTaskTitle?: string;
  buyer: string;
  rdContact?: string;
  requester?: string;
  requesterDept?: string;
  priority: "high" | "medium" | "low";
  needSample: boolean;
  /** 附件数量（沿用原 mock 字段语义），明细见 attachmentList */
  attachments: number;
  attachmentList: ProcTaskAttachment[];
  purchaseOrders: ProcTaskPurchaseOrder[];
  consumableNote?: string;
  selectedQuotationId?: string;
  businessDone: boolean;
  cancelReason?: string;
  status: ProcStatus;
  logs: ProcLog[];
  createdAt: string;
  updatedAt: string;
}

export type MaterialReviewStatus = "pending" | "approved" | "rejected";
export type MaterialReviewSource = "import" | "auto" | "manual";

export interface Material {
  id: string;
  name: string;
  spec: string;
  unit: string;
  category: string;
  productLine: string;
  erpCode: string;
  tpInventoryCode?: string;
  isSpecial: boolean;
  isConsumable: boolean;
  safeStock: number;
  stockQty: number;
  reviewStatus: MaterialReviewStatus;
  reviewSource?: MaterialReviewSource;
  reviewNote?: string;
  latestPrice: number | null;
  latestSupplier?: string;
  latestQuoteDate?: string;
  remark?: string;
}

export interface Quotation {
  id: string;
  taskId?: string;
  materialId?: string;
  materialName: string;
  supplierName: string;
  unitPrice: number;
  currency: string;
  leadTimeDays: number;
  minOrderQty: number | null;
  quoteDate?: string;
  validUntil?: string;
  channel: string;
  isSelected: boolean;
  note?: string;
}

export interface ProcSummary {
  byStatus: Record<string, number>;
  total: number;
  overdue: number;
  shortage: number;
  pendingReview: number;
}

interface Paged<T> {
  total: number;
  page: number;
  pageSize: number;
  items: T[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authFetch(`/api/procurement${path}`, init);
  if (!response.ok) throw new Error(await readErrorMessage(response, "采购接口请求失败"));
  return (await response.json()) as T;
}

// ── 任务 ──────────────────────────────────────────────────────────────────────

export async function listProcTasks(signal?: AbortSignal): Promise<ProcurementTask[]> {
  const data = await request<Paged<ProcurementTask>>("/tasks?pageSize=200", { signal });
  return data.items;
}

export async function getProcTask(id: string): Promise<ProcurementTask> {
  return request<ProcurementTask>(`/tasks/${encodeURIComponent(id)}`);
}

export async function getProcSummary(signal?: AbortSignal): Promise<ProcSummary> {
  return request<ProcSummary>("/summary", { signal });
}

export interface CreateProcTaskInput {
  materialId?: string;
  materialName: string;
  spec?: string;
  unit?: string;
  quantity: number;
  method?: ProcMethod;
  purchaseLink?: string;
  businessLine?: BusinessLine;
  priority?: "high" | "medium" | "low";
  needSample?: boolean;
  needDate?: string;
  deadline?: string;
  requesterDept?: string;
  consumableNote?: string;
  attachments?: { fileName: string; fileUrl: string; fileKey?: string; fileSize?: number; mimeType?: string; kind?: "drawing" | "quote" | "other" }[];
}

export async function createProcTask(input: CreateProcTaskInput): Promise<ProcurementTask> {
  return request<ProcurementTask>("/tasks", { method: "POST", body: JSON.stringify(input) });
}

/** 研发侧转采购：必须带附件，后端会校验。 */
export async function transferProcTask(
  input: CreateProcTaskInput & { rdTaskId: string; rdTaskTitle?: string; rdContact?: string },
): Promise<ProcurementTask> {
  return request<ProcurementTask>("/tasks/transfer", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function confirmProcTask(id: string): Promise<ProcurementTask> {
  return request<ProcurementTask>(`/tasks/${encodeURIComponent(id)}/confirm`, { method: "POST" });
}

export async function transitionProcTask(
  id: string,
  status: ProcStatus,
  note?: string,
): Promise<ProcurementTask> {
  return request<ProcurementTask>(`/tasks/${encodeURIComponent(id)}/transition`, {
    method: "POST",
    body: JSON.stringify({ status, note }),
  });
}

export async function cancelProcTask(id: string, reason?: string): Promise<ProcurementTask> {
  return request<ProcurementTask>(`/tasks/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export async function reassignProcTask(
  id: string,
  buyer: string,
  buyerUserId?: string,
): Promise<ProcurementTask> {
  return request<ProcurementTask>(`/tasks/${encodeURIComponent(id)}/reassign`, {
    method: "POST",
    body: JSON.stringify({ buyer, buyerUserId }),
  });
}

export async function deleteProcTask(id: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** 手工登记到货：过渡期能力，T+ 接通后到货以同步为准。 */
export async function receiveProcTask(
  id: string,
  input: { qty: number; receivedDate?: string; note?: string },
): Promise<ProcurementTask> {
  return request<ProcurementTask>(`/tasks/${encodeURIComponent(id)}/receive`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// ── 报价 ──────────────────────────────────────────────────────────────────────

export async function listQuotations(params: {
  materialId?: string;
  materialName?: string;
  taskId?: string;
}): Promise<Quotation[]> {
  const qs = new URLSearchParams();
  if (params.materialId) qs.set("materialId", params.materialId);
  if (params.materialName) qs.set("materialName", params.materialName);
  if (params.taskId) qs.set("taskId", params.taskId);
  return request<Quotation[]>(`/quotations?${qs.toString()}`);
}

export async function addQuotation(
  taskId: string,
  input: { supplierName: string; unitPrice: number; leadTimeDays?: number; quoteDate?: string; note?: string },
): Promise<Quotation> {
  return request<Quotation>(`/tasks/${encodeURIComponent(taskId)}/quotations`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function selectQuotation(taskId: string, quotationId: string): Promise<ProcurementTask> {
  return request<ProcurementTask>(
    `/tasks/${encodeURIComponent(taskId)}/quotations/${encodeURIComponent(quotationId)}/select`,
    { method: "POST" },
  );
}

/** 关联畅捷通 T+ 采购单（本系统不创建单据）。 */
export async function linkPurchaseOrder(
  taskId: string,
  input: { tpOrderNo: string; supplierName?: string; orderedQty?: number; orderDate?: string; etaDate?: string },
): Promise<ProcurementTask> {
  return request<ProcurementTask>(`/tasks/${encodeURIComponent(taskId)}/purchase-orders`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// ── 物料 ──────────────────────────────────────────────────────────────────────

export async function listMaterials(signal?: AbortSignal): Promise<Material[]> {
  const data = await request<Paged<Material>>("/materials?pageSize=500", { signal });
  return data.items;
}

export async function reviewMaterial(
  id: string,
  reviewStatus: "approved" | "rejected",
  reviewNote?: string,
): Promise<Material> {
  return request<Material>(`/materials/${encodeURIComponent(id)}/review`, {
    method: "PATCH",
    body: JSON.stringify({ reviewStatus, reviewNote }),
  });
}
