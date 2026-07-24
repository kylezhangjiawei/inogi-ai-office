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

/** 负责人候选（转派/建单人员选择）：成员名录 > 采购部 > 全员。 */
export interface BuyerCandidate {
  id: string;
  name: string;
  department?: string;
  /** 是否在采购成员名录内 */
  inRoster?: boolean;
}

export async function listBuyerCandidates(signal?: AbortSignal): Promise<BuyerCandidate[]> {
  return request<BuyerCandidate[]>("/buyers", { signal });
}

/** 采购成员名录（人员管理里维护；分配任务候选优先显示名录成员）。 */
export interface BuyerRosterMember {
  id: string;
  name: string;
  department?: string;
  /** 岗位备注（如「电子料询价」「包材/耗材」） */
  note?: string;
  disabled?: boolean;
}

export async function getBuyerRoster(): Promise<{ members: BuyerRosterMember[] }> {
  return request("/buyer-roster");
}

export async function addBuyerRosterMember(userId: string): Promise<{ members: BuyerRosterMember[] }> {
  return request("/buyer-roster", { method: "POST", body: JSON.stringify({ userId }) });
}

export async function updateBuyerRosterMember(
  userId: string,
  note: string,
): Promise<{ members: BuyerRosterMember[] }> {
  return request(`/buyer-roster/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: JSON.stringify({ note }),
  });
}

export async function removeBuyerRosterMember(userId: string): Promise<{ members: BuyerRosterMember[] }> {
  return request(`/buyer-roster/${encodeURIComponent(userId)}`, { method: "DELETE" });
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
  const data = await request<Paged<Material>>("/materials?pageSize=10000", { signal });
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
  /** 每日自动同步（3:00 服务器时区）开关，默认开。 */
  autoSync: boolean;
  lastAutoSyncAt: string | null;
  lastAutoSyncSummary: string | null;
}

export async function getTplusConfig(): Promise<TplusConfigState> {
  return request<TplusConfigState>("/tplus/config");
}

/** appSecret 走 HTTPS 明文传输、后端落库加密；不传则保留已存值。 */
export async function saveTplusConfig(input: {
  baseUrl?: string;
  /** 不传保留已存值（如仅切换 autoSync）；首次配置必填。 */
  appKey?: string;
  appSecret?: string;
  redirectUri?: string;
  autoSync?: boolean;
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

export type TplusAutoSyncResult = { skipped: true; reason: string } | { skipped: false; summary: string };

/** 一键全同步（异步任务）：供应商→库存→采购单全量→匹配，返回 jobId 轮询。 */
export async function runTplusAutoSync(): Promise<{ jobId: string }> {
  return request("/tplus/sync/auto", { method: "POST" });
}

export interface PoFullSyncResult {
  orders: number;
  lines: number;
  failed: number;
  matchedMaterials: number;
}

/** 采购单全量镜像同步（异步任务）：返回 jobId 轮询。 */
export async function syncTplusPurchaseOrdersFull(): Promise<{ jobId: string }> {
  return request("/tplus/sync/purchase-orders-full", { method: "POST" });
}

export interface PoMirrorRow {
  id: string;
  tpOrderNo: string;
  tpLineNo: string;
  supplierName: string;
  inventoryCode: string;
  inventoryName: string;
  orderedQty: number;
  receivedQty: number;
  orderDate: string | null;
  etaDate: string | null;
  matchStatus: "unmatched" | "suggested" | "confirmed" | "ignored";
  matchConfidence: number | null;
  matchReason: string | null;
  task: { id: string; code: string; materialName: string; quantity: number; status: string } | null;
}

export interface PoMirrorList {
  counts: Record<string, number>;
  rows: PoMirrorRow[];
}

export async function listPoMirror(status?: string): Promise<PoMirrorList> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  return request(`/tplus/purchase-orders/mirror${qs}`);
}

export interface PoMatchResult {
  suggested: number;
  aiSuggested: number;
  unmatched: number;
}

/** 规则 + AI 生成「单据 ↔ 任务」匹配建议（异步任务）：返回 jobId 轮询。 */
export async function runPoMatch(): Promise<{ jobId: string }> {
  return request("/tplus/purchase-orders/match", { method: "POST" });
}

export async function confirmPoMatch(id: string, taskId?: string): Promise<PoMirrorList> {
  return request(`/tplus/purchase-orders/mirror/${id}/confirm`, {
    method: "POST",
    body: JSON.stringify({ taskId }),
  });
}

export async function ignorePoMatch(id: string): Promise<PoMirrorList> {
  return request(`/tplus/purchase-orders/mirror/${id}/ignore`, { method: "POST" });
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

export interface ClassifyPreview {
  uncategorized: number;
  rule1: number;
  rule2: number;
  aiPending: number;
  ruleCategories: Record<string, number>;
  /** 当前全库分类分布（不含未分类）：分类结果的留存展示 */
  currentCategories: Record<string, number>;
  aiSamples: string[];
}

/** 批量应用异步任务（AI 分类 / 安全库存共用）：启动即返回 jobId，轮询取进度与结果。 */
export interface ApplyJobState<T> {
  id: string;
  kind: string;
  status: "running" | "done" | "error";
  progress: string;
  result?: T;
  error?: string;
}

export async function getApplyJob<T>(jobId: string): Promise<ApplyJobState<T>> {
  return request(`/materials/apply-jobs/${encodeURIComponent(jobId)}`);
}

/** T+ 同步/匹配任务的进度查询（与物料 apply 任务不同权限入口，同一个任务存储）。 */
export async function getTplusSyncJob<T>(jobId: string): Promise<ApplyJobState<T>> {
  return request(`/tplus/sync/jobs/${encodeURIComponent(jobId)}`);
}

/** 轮询任务直到完成（3s 间隔）；任务丢失/失败抛错。fetcher 缺省为物料 apply 任务端点。 */
export async function waitApplyJob<T>(
  jobId: string,
  onProgress?: (progress: string) => void,
  fetcher: (id: string) => Promise<ApplyJobState<T>> = getApplyJob,
): Promise<T> {
  for (;;) {
    const job = await fetcher(jobId);
    if (job.status === "done") return job.result as T;
    if (job.status === "error") throw new Error(job.error || "任务执行失败");
    onProgress?.(job.progress);
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}

export interface ClassifyReport {
  ruleApplied: number;
  ruleCategories: Record<string, number>;
  aiApplied: Array<{ code: string; name: string; category: string; confidence: number }>;
  aiSkipped: Array<{ code: string; name: string; reason: string }>;
  aiError: string | null;
  model: string | null;
}

/** 初步分类干跑：规则可分多少、AI 要兜多少，不落库。 */
export async function previewMaterialClassify(): Promise<ClassifyPreview> {
  return request("/materials/classify/preview");
}

/** 初步分类应用（异步）：返回 jobId，用 waitApplyJob 轮询结果。 */
export async function applyMaterialClassify(): Promise<{ jobId: string }> {
  return request("/materials/classify/apply", { method: "POST" });
}

export interface SafeStockPreview {
  windowDays: number;
  coverFactor: number;
  usageMaterialCount: number;
  skippedManual: number;
  ruleCount: number;
  aiPending: number;
  samples: Array<{ code: string; name: string; orders: number; monthlyAvg: number; suggest: number }>;
  aiSamples: string[];
}

export interface SafeStockReport {
  ruleApplied: number;
  aiApplied: Array<{ code: string; name: string; suggest: number; confidence: number }>;
  aiSkipped: Array<{ code: string; name: string; reason: string }>;
  aiError: string | null;
  model: string | null;
}

/** 安全库存初始化干跑：基于采购镜像统计建议值，不落库。 */
export async function previewSafeStock(): Promise<SafeStockPreview> {
  return request("/materials/safe-stock/preview");
}

/** 安全库存初始化应用（异步）：返回 jobId，用 waitApplyJob 轮询结果。 */
export async function applySafeStock(): Promise<{ jobId: string }> {
  return request("/materials/safe-stock/apply", { method: "POST" });
}

export interface ReplenishSuggestion {
  materialId: string;
  code: string;
  name: string;
  spec: string;
  unit: string;
  stock: number;
  safeStock: number;
  inTransit: number;
  openTaskQty: number;
  suggestQty: number;
  /** 包装/起订粒度（历史采购量最大公约数）；建议量已按此向上取整 */
  packStep: number | null;
  lastSupplier: string | null;
  lastPrice: number | null;
}

/** 补货建议清单：缺口 = 安全库存 − 库存 − 在途 − 进行中任务。 */
export async function listReplenishSuggestions(): Promise<{ rows: ReplenishSuggestion[] }> {
  return request("/materials/replenish/suggestions");
}

/** 勾选补货条目批量生成采购任务。 */
export async function createReplenishTasks(
  items: Array<{ materialId: string; quantity: number }>,
): Promise<{ created: number; codes: string[] }> {
  return request("/materials/replenish/create-tasks", {
    method: "POST",
    body: JSON.stringify({ items }),
  });
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
