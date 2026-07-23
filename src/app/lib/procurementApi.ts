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
  buyerUserId?: string;
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
  /** 转采购接口命中已有记录时为 true，用于幂等反馈。 */
  alreadyTransferred?: boolean;
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

/** 按研发任务查询已关联的采购任务。一个研发任务最多对应一条采购任务。 */
export async function getProcTaskByRdTask(
  rdTaskId: string,
  signal?: AbortSignal,
): Promise<ProcurementTask | null> {
  const data = await request<Paged<ProcurementTask>>(
    `/tasks?rdTaskId=${encodeURIComponent(rdTaskId)}&pageSize=1`,
    { signal },
  );
  return data.items[0] ?? null;
}

export async function getProcTask(id: string): Promise<ProcurementTask> {
  return request<ProcurementTask>(`/tasks/${encodeURIComponent(id)}`);
}

export async function getProcSummary(signal?: AbortSignal): Promise<ProcSummary> {
  return request<ProcSummary>("/summary", { signal });
}

/** 负责人候选（转派/建单人员选择）：全部启用用户，采购部排前。 */
export interface BuyerCandidate {
  id: string;
  name: string;
  department?: string;
}

export async function listBuyerCandidates(signal?: AbortSignal): Promise<BuyerCandidate[]> {
  return request<BuyerCandidate[]>("/buyers", { signal });
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
  buyer?: string;
  buyerUserId?: string;
  requesterDept?: string;
  consumableNote?: string;
  attachments?: { fileName: string; fileUrl: string; fileKey?: string; fileSize?: number; mimeType?: string; kind?: "drawing" | "quote" | "other" }[];
}

export async function createProcTask(input: CreateProcTaskInput): Promise<ProcurementTask> {
  return request<ProcurementTask>("/tasks", { method: "POST", body: JSON.stringify(input) });
}

/** AI 建单解析出的草稿：不落库，用户在表单里确认/修改后走 createProcTask。 */
export interface AiTaskDraft {
  materialName?: string;
  materialId?: string;
  spec?: string;
  unit?: string;
  quantity?: number;
  method?: ProcMethod;
  purchaseLink?: string;
  needDate?: string;
  deadline?: string;
  priority?: "high" | "medium" | "low";
  needSample?: boolean;
}

export async function aiParseProcTask(
  text: string,
): Promise<{ draft: AiTaskDraft; model: string; usedAI: boolean }> {
  return request("/tasks/ai-parse", { method: "POST", body: JSON.stringify({ text }) });
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

export type ProcurementUploadResult = {
  fileId: string;
  objectKey: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  signedUrl: string | null;
};

/** 转采购弹窗新增的本地附件先落通用文件库，再把 OSS 引用登记到采购任务。 */
export async function uploadProcurementAttachment(file: File): Promise<ProcurementUploadResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("businessType", "assets");
  const response = await authFetch("/api/files/upload", { method: "POST", body: form });
  if (!response.ok) throw new Error(await readErrorMessage(response, `附件「${file.name}」上传失败`));
  return (await response.json()) as ProcurementUploadResult;
}

/** 任务信息编辑（与后端 UpdateProcTaskDto 对齐；仅提交有变化的字段）。 */
export interface UpdateProcTaskInput {
  quantity?: number;
  priority?: "high" | "medium" | "low";
  needDate?: string;
  deadline?: string;
  expectedArrivalDate?: string;
  paymentDate?: string;
  paymentStatus?: PaymentStatus;
  paymentNote?: string;
  consumableNote?: string;
  purchaseLink?: string;
}

export async function updateProcTask(
  id: string,
  input: UpdateProcTaskInput,
): Promise<ProcurementTask> {
  return request<ProcurementTask>(`/tasks/${encodeURIComponent(id)}`, {
    method: "PUT",
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

/** 批量转派：后端事务原子执行，整体成功或整体回滚。 */
export async function batchReassignProcTasks(
  taskIds: string[],
  buyer: string,
  buyerUserId?: string,
): Promise<{ updated: number }> {
  return request<{ updated: number }>("/tasks/batch-reassign", {
    method: "POST",
    body: JSON.stringify({ taskIds, buyer, buyerUserId }),
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

// ── 畅捷通 T+ 集成 ────────────────────────────────────────────────────────────

export interface TplusConfigState {
  configured: boolean;
  baseUrl: string;
  appKeyMasked: string | null;
  hasSecret: boolean;
  /** 已配置的 OAuth 回调地址（须与开放平台应用配置一致）。 */
  redirectUri: string | null;
  /** 是否已完成 OAuth 授权（openToken 就绪）。 */
  authorized: boolean;
  tokenExpireAt: string | null;
  refreshExpireAt: string | null;
  updatedAt: string | null;
}

export async function getTplusConfig(): Promise<TplusConfigState> {
  return request<TplusConfigState>("/tplus/config");
}

/** appSecret 走 HTTPS 明文传输、后端落库加密；不传则保留已存值。 */
export async function saveTplusConfig(input: {
  baseUrl?: string;
  appKey: string;
  appSecret?: string;
  redirectUri?: string;
}): Promise<TplusConfigState> {
  return request<TplusConfigState>("/tplus/config", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

/** 手动粘贴授权码换 openToken（授权回调直达不可用时的兜底）。 */
export async function exchangeTplusAuthCode(code: string): Promise<TplusConfigState> {
  return request<TplusConfigState>("/tplus/oauth/exchange", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export async function getTplusStatus(): Promise<{
  configured: boolean;
  authorized: boolean;
  mirrored: { suppliers: number; balances: number; purchaseOrderRefs: number };
}> {
  return request("/tplus/status");
}

export async function triggerTplusSync(
  kind: "suppliers" | "inventory" | "purchase-orders",
): Promise<Record<string, number>> {
  return request(`/tplus/sync/${kind}`, { method: "POST" });
}

/** 批量导入的单条物料（与后端 UpsertMaterialDto 对齐；新建条目落为待审核）。 */
export interface MaterialImportItem {
  name: string;
  spec?: string;
  unit?: string;
  category?: string;
  productLine?: string;
  erpCode?: string;
  tpInventoryCode?: string;
  isSpecial?: boolean;
  isConsumable?: boolean;
  safeStock?: number;
  remark?: string;
}

/**
 * 新增/编辑物料主数据。传 id 走更新，不传走新建（reviewSource=manual，落待审核）。
 * 更新为部分更新：未传字段保留原值，想清空某字段须显式传空串。
 */
export async function upsertProcMaterial(
  input: MaterialImportItem,
  id?: string,
): Promise<Material> {
  return request<Material>(id ? `/materials/${encodeURIComponent(id)}` : "/materials", {
    method: id ? "PUT" : "POST",
    body: JSON.stringify(input),
  });
}

export async function importProcMaterials(
  items: MaterialImportItem[],
): Promise<{ created: number; updated: number; total: number }> {
  return request("/materials/import", { method: "POST", body: JSON.stringify({ items }) });
}

/** 分类重命名/合并：目标分类已存在即合并。 */
export async function renameProcCategory(
  from: string,
  to: string,
): Promise<{ updated: number }> {
  return request("/materials/categories/rename", {
    method: "POST",
    body: JSON.stringify({ from, to }),
  });
}
