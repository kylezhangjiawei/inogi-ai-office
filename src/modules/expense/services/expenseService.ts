import { Bot, Clock3, Receipt, TrendingUp } from "lucide-react";

import { authFetch, readErrorMessage } from "../../../app/lib/authSession";
import type {
  ExpenseDashboardData,
  ExpenseRule,
  InvoiceFilters,
  InvoiceRecord,
  OcrMode,
  ReimbursementRecord,
  VoucherUploadRecord,
  VoucherCandidate,
} from "../types";

type ApiInvoice = {
  id: string;
  thumbnail_type: "JPG" | "PNG" | "PDF";
  invoice_no: string;
  invoice_code: string;
  issued_date: string;
  vendor: string;
  vendor_tax_no: string;
  amount: number;
  tax: number;
  category: InvoiceRecord["category"];
  category_confidence: number;
  project: string;
  status: InvoiceRecord["status"];
  uploader: string;
  uploader_avatar: string;
  uploaded_at: string;
  relative_uploaded_at: string;
  ai_insight: string;
  material_missing: string[];
  voucher_no?: string;
  match_confidence?: number;
  payment_voucher?: string;
  matched_voucher_id?: string;
  match_score?: number;
  match_reasons?: string[];
  matched_by?: "system" | "manual";
  matched_at?: string;
  ocr_mode?: OcrMode;
  ocr_service_key?: string;
  ocr_service_label?: string;
  ocr_action?: string;
  ocr_request_id?: string;
  detected_type?: string;
  detected_type_confidence?: number;
  manual_review_required?: boolean;
  third_party_errors?: OfficialThirdPartyError[];
};

type ApiVoucherUpload = {
  id: string;
  voucher_no: string;
  amount: number;
  date: string;
  project: string;
  subject: string;
  counterparty?: string;
  confidence: number;
  reason: string;
  file_name: string;
  uploaded_at: string;
  status: string;
  ocr_mode?: OcrMode;
  ocr_service_key?: string;
  ocr_service_label?: string;
  ocr_action?: string;
  ocr_request_id?: string;
  detected_type?: string;
  matched_invoice_id?: string;
  match_score?: number;
  match_reasons?: string[];
  matched_by?: "system" | "manual";
  matched_at?: string;
  manual_review_required?: boolean;
  third_party_errors?: OfficialThirdPartyError[];
};

type ApiReimbursement = {
  id: string;
  title: string;
  applicant: string;
  applied_date: string;
  amount: number;
  invoice_count: number;
  invoice_ids?: string[];
  voucher_ids?: string[];
  status: ReimbursementRecord["status"];
  node: string;
  project?: string;
  reason?: string;
  wecom_flow_id: string;
  wecom_sync_status: ReimbursementRecord["weComSyncStatus"];
  wecom_approver: string;
  wecom_updated_at: string;
  notify_emails?: string[];
  cc_emails?: string[];
  third_party_errors?: OfficialThirdPartyError[];
};

type ApiRule = {
  id: string;
  name: string;
  keywords: string;
  match_type: string;
  target_category: ExpenseRule["targetCategory"];
  priority: number;
  hits: number;
  enabled: boolean;
};

type ApiVoucherCandidate = {
  id: string;
  voucher_no: string;
  amount: number;
  date: string;
  project: string;
  subject: string;
  confidence: number;
  reason: string;
  match_reasons?: string[];
  match_status?: "auto" | "manual_review" | "blocked";
};

type ApiDashboard = {
  month_amount: number;
  total_amount: number;
  kpis: Array<{
    key: string;
    title: string;
    value: string;
    trend?: string;
    badge?: string;
    progress?: number;
    icon?: string;
  }>;
  todos: ExpenseDashboardData["todos"];
  activities: ExpenseDashboardData["activities"];
  monthly_trend: ExpenseDashboardData["monthlyTrend"];
  category_share: ExpenseDashboardData["categoryShare"];
  status_breakdown: ExpenseDashboardData["statusBreakdown"];
  project_top: ExpenseDashboardData["projectTop"];
};

export type OfficialThirdPartyError = {
  provider: "tencent_ocr" | "wecom";
  code: string | number;
  message: string;
  request_id?: string;
  action?: string;
  raw?: unknown;
  docs: string[];
};

export type ExpenseOcrService = {
  key: string;
  label: string;
  category_key: string;
  category_label: string;
  action: string;
  document_kind: "invoice" | "voucher";
  mode: OcrMode;
  description: string;
  input_mode: "image" | "image_or_pdf";
  invoice_types?: number[];
};

export type ExpenseOcrServiceCategory = {
  key: string;
  label: string;
  services: ExpenseOcrService[];
};

export type ExpenseOcrServiceCatalog = {
  default_mode: OcrMode;
  invoice: ExpenseOcrServiceCategory[];
  voucher: ExpenseOcrServiceCategory[];
};

export type ExpenseOcrUploadOptions = {
  ocrMode?: OcrMode;
  ocrServiceKey?: string;
};

export type ExpenseIntegrationRequirements = {
  storage: {
    ready: boolean;
    missing: Array<{ key: string; label: string }>;
  };
  tencent_ocr: {
    ready: boolean;
    missing: Array<{ key: string; label: string }>;
    optional: Array<{ key: string; label: string; default?: string }>;
    supported_actions: Array<{ key: string; label: string; default_action: string }>;
  };
  wecom: {
    ready: boolean;
    missing: Array<{ key: string; label: string }>;
    callback_endpoint: string;
  };
  email: {
    ready: boolean;
    missing: Array<{ key: string; label: string }>;
  };
};

export type ExpenseArchiveNode = {
  id: string;
  name: string;
  icon?: string;
  color?: string;
  vendorFilter?: string[];
  children?: ExpenseArchiveNode[];
};

export type ExpenseArchiveConfig = {
  tree: ExpenseArchiveNode[];
  manual_category: Record<string, string>;
  excluded_ids: string[];
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authFetch(path, init);

  if (!response.ok) {
    const message = await readErrorMessage(response, `Request failed: ${response.status}`);
    const error = new Error(message) as Error & { status?: number; payload?: unknown };
    error.status = response.status;
    try {
      error.payload = await response.clone().json();
    } catch {
      error.payload = undefined;
    }
    throw error;
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

function toInvoice(item: ApiInvoice): InvoiceRecord {
  return {
    id: item.id,
    thumbnailType: item.thumbnail_type,
    invoiceNo: item.invoice_no,
    invoiceCode: item.invoice_code,
    issuedDate: item.issued_date,
    vendor: item.vendor,
    vendorTaxNo: item.vendor_tax_no,
    amount: item.amount,
    tax: item.tax,
    category: item.category,
    categoryConfidence: item.category_confidence,
    project: item.project,
    status: item.status,
    uploader: item.uploader,
    uploaderAvatar: item.uploader_avatar,
    uploadedAt: item.uploaded_at,
    relativeUploadedAt: item.relative_uploaded_at,
    aiInsight: item.ai_insight,
    materialMissing: item.material_missing ?? [],
    voucherNo: item.voucher_no,
    matchConfidence: item.match_confidence,
    paymentVoucher: item.payment_voucher,
    matchedVoucherId: item.matched_voucher_id,
    matchScore: item.match_score,
    matchReasons: item.match_reasons,
    matchedBy: item.matched_by,
    matchedAt: item.matched_at,
    ocrMode: item.ocr_mode,
    ocrServiceKey: item.ocr_service_key,
    ocrServiceLabel: item.ocr_service_label,
    ocrAction: item.ocr_action,
    ocrRequestId: item.ocr_request_id,
    detectedType: item.detected_type,
    detectedTypeConfidence: item.detected_type_confidence,
    manualReviewRequired: item.manual_review_required,
    thirdPartyErrors: item.third_party_errors,
  };
}

function toVoucherUpload(item: ApiVoucherUpload): VoucherUploadRecord {
  return {
    id: item.id,
    voucherNo: item.voucher_no,
    amount: item.amount,
    date: item.date,
    project: item.project,
    subject: item.subject,
    counterparty: item.counterparty,
    confidence: item.confidence,
    reason: item.reason,
    fileName: item.file_name,
    uploadedAt: item.uploaded_at,
    status: item.status,
    ocrMode: item.ocr_mode,
    ocrServiceKey: item.ocr_service_key,
    ocrServiceLabel: item.ocr_service_label,
    ocrAction: item.ocr_action,
    ocrRequestId: item.ocr_request_id,
    detectedType: item.detected_type,
    matchedInvoiceId: item.matched_invoice_id,
    matchScore: item.match_score,
    matchReasons: item.match_reasons,
    matchedBy: item.matched_by,
    matchedAt: item.matched_at,
    manualReviewRequired: item.manual_review_required,
    thirdPartyErrors: item.third_party_errors,
  };
}

function toReimbursement(item: ApiReimbursement): ReimbursementRecord {
  return {
    id: item.id,
    title: item.title,
    applicant: item.applicant,
    appliedDate: item.applied_date,
    amount: item.amount,
    invoiceCount: item.invoice_count,
    invoiceIds: item.invoice_ids,
    voucherIds: item.voucher_ids,
    status: item.status,
    node: item.node,
    project: item.project,
    reason: item.reason,
    weComFlowId: item.wecom_flow_id,
    weComSyncStatus: item.wecom_sync_status,
    weComApprover: item.wecom_approver,
    weComUpdatedAt: item.wecom_updated_at,
    notifyEmails: item.notify_emails ?? [],
    ccEmails: item.cc_emails ?? [],
  };
}

function toRule(item: ApiRule): ExpenseRule {
  return {
    id: item.id,
    name: item.name,
    keywords: item.keywords,
    matchType: item.match_type,
    targetCategory: item.target_category,
    priority: item.priority,
    hits: item.hits,
    enabled: item.enabled,
  };
}

function toVoucherCandidate(item: ApiVoucherCandidate): VoucherCandidate {
  return {
    id: item.id,
    voucherNo: item.voucher_no,
    amount: item.amount,
    date: item.date,
    project: item.project,
    subject: item.subject,
    confidence: item.confidence,
    reason: item.reason,
    matchReasons: item.match_reasons,
    matchStatus: item.match_status,
  };
}

const kpiIcons = {
  TrendingUp,
  Receipt,
  Bot,
  Clock3,
};

const emptyDashboardData: ExpenseDashboardData = {
  monthAmount: 0,
  totalAmount: 0,
  kpis: [
    { title: "本月报销总额", value: "¥0", trend: "暂无报销数据", icon: TrendingUp },
    { title: "待处理票据数", value: "0 张", badge: "0 异常", icon: Receipt },
    { title: "AI 自动处理率", value: "0%", progress: 0, icon: Bot },
    { title: "企微审批中", value: "0 单", trend: "暂无审批流", icon: Clock3 },
  ],
  todos: [],
  activities: [],
  monthlyTrend: [],
  categoryShare: [],
  statusBreakdown: [],
  projectTop: [],
};

function toDashboard(data: ApiDashboard): ExpenseDashboardData {
  return {
    monthAmount: data.month_amount ?? 0,
    totalAmount: data.total_amount ?? 0,
    kpis: data.kpis.map((item) => ({
      title: item.title,
      value: item.value,
      trend: item.trend,
      badge: item.badge,
      progress: item.progress,
      icon: kpiIcons[item.icon as keyof typeof kpiIcons] ?? TrendingUp,
    })),
    todos: data.todos,
    activities: data.activities,
    monthlyTrend: data.monthly_trend,
    categoryShare: data.category_share,
    statusBreakdown: data.status_breakdown,
    projectTop: data.project_top,
  };
}

function applyLocalInvoiceFilters(items: InvoiceRecord[], filters?: Partial<InvoiceFilters>) {
  const min = Number(filters?.amountMin || 0);
  const max = Number(filters?.amountMax || Number.POSITIVE_INFINITY);
  const maxConfidence = filters?.maxConfidence ?? 1;
  return items.filter(
    (invoice) =>
      invoice.amount >= min &&
      invoice.amount <= max &&
      invoice.categoryConfidence <= maxConfidence,
  );
}

function fallbackWithWarning<T>(label: string, value: T, error: unknown) {
  console.warn(`[expenseService] ${label} fallback`, error);
  return value;
}

function appendOcrOptions(formData: FormData, options: ExpenseOcrUploadOptions = {}) {
  formData.set("ocr_mode", options.ocrMode ?? "auto");
  if (options.ocrMode === "manual" && options.ocrServiceKey) {
    formData.set("ocr_service_key", options.ocrServiceKey);
  }
}

export type VoucherMatchSummary = {
  auto_linked: number;
  manual_review: number;
  blocked: number;
  links: Array<{ invoice_id: string; voucher_id: string; voucher_no: string; score: number; reasons: string[] }>;
};

const emptyMatchSummary: VoucherMatchSummary = { auto_linked: 0, manual_review: 0, blocked: 0, links: [] };

/** 部门下拉项（来自 /api/departments/options），费用筛选/改派复用。 */
export type ExpenseDepartmentOption = { id: string; code: string; name: string; category?: string };

/** 部门筛选值：具体 code、'unassigned'（未分配）、或 undefined（全部）。仅 view-all 用户生效。 */
function appendDepartment(params: URLSearchParams, department?: string) {
  if (department) params.set("department", department);
}

export const expenseService = {
  async listInvoices(filters?: Partial<InvoiceFilters>, department?: string) {
    const params = new URLSearchParams();
    params.set("page_size", "200");
    if (filters?.keyword?.trim()) params.set("keyword", filters.keyword.trim());
    if (filters?.status && filters.status !== "全部") params.set("status", filters.status);
    if (filters?.category && filters.category !== "全部") params.set("category", filters.category);
    appendDepartment(params, department);

    try {
      const result = await request<{ items: ApiInvoice[] }>(`/api/expenses/invoices?${params.toString()}`);
      return applyLocalInvoiceFilters(result.items.map(toInvoice), filters);
    } catch (error) {
      return fallbackWithWarning("listInvoices", [], error);
    }
  },

  async listInvoicesStrict(filters?: Partial<InvoiceFilters>, department?: string) {
    const params = new URLSearchParams();
    params.set("page_size", "200");
    if (filters?.keyword?.trim()) params.set("keyword", filters.keyword.trim());
    if (filters?.status && filters.status !== "全部") params.set("status", filters.status);
    if (filters?.category && filters.category !== "全部") params.set("category", filters.category);
    appendDepartment(params, department);
    const result = await request<{ items: ApiInvoice[] }>(`/api/expenses/invoices?${params.toString()}`);
    return applyLocalInvoiceFilters(result.items.map(toInvoice), filters);
  },

  async getDashboard(department?: string): Promise<ExpenseDashboardData> {
    const params = new URLSearchParams();
    appendDepartment(params, department);
    const qs = params.toString();
    try {
      return toDashboard(await request<ApiDashboard>(`/api/expenses/dashboard${qs ? `?${qs}` : ""}`));
    } catch (error) {
      return fallbackWithWarning("getDashboard", emptyDashboardData, error);
    }
  },

  /**
   * 与 getDashboard 使用同一份接口和映射，但把请求错误交给调用方处理。
   * 首页等聚合视图需要区分“确实没有数据”和“接口加载失败”，因此不能静默回退成全 0。
   */
  async getDashboardStrict(department?: string): Promise<ExpenseDashboardData> {
    const params = new URLSearchParams();
    appendDepartment(params, department);
    const qs = params.toString();
    return toDashboard(await request<ApiDashboard>(`/api/expenses/dashboard${qs ? `?${qs}` : ""}`));
  },

  async listDepartmentOptions(): Promise<ExpenseDepartmentOption[]> {
    try {
      return await request<ExpenseDepartmentOption[]>("/api/departments/options");
    } catch (error) {
      return fallbackWithWarning("listDepartmentOptions", [], error);
    }
  },

  async reassignDepartment(payload: {
    type: "invoice" | "voucher" | "reimbursement";
    ids: string[];
    department_code: string;
  }) {
    return request<{ updated: number; department_code: string | null; department_name: string | null }>(
      "/api/expenses/reassign-department",
      { method: "POST", body: JSON.stringify(payload) },
    );
  },

  async listVoucherCandidates(invoiceId: string): Promise<VoucherCandidate[]> {
    const result = await request<ApiVoucherCandidate[]>(`/api/expenses/invoices/${invoiceId}/voucher-candidates`);
    return result.map(toVoucherCandidate);
  },

  async listReimbursements(department?: string): Promise<ReimbursementRecord[]> {
    const params = new URLSearchParams();
    appendDepartment(params, department);
    const qs = params.toString();
    try {
      const result = await request<ApiReimbursement[]>(`/api/expenses/reimbursements${qs ? `?${qs}` : ""}`);
      return result.map(toReimbursement);
    } catch (error) {
      return fallbackWithWarning("listReimbursements", [], error);
    }
  },

  async listReimbursementsStrict(department?: string): Promise<ReimbursementRecord[]> {
    const params = new URLSearchParams();
    appendDepartment(params, department);
    const qs = params.toString();
    const result = await request<ApiReimbursement[]>(`/api/expenses/reimbursements${qs ? `?${qs}` : ""}`);
    return result.map(toReimbursement);
  },

  async listVouchers(department?: string): Promise<VoucherUploadRecord[]> {
    const params = new URLSearchParams();
    appendDepartment(params, department);
    const qs = params.toString();
    const result = await request<ApiVoucherUpload[]>(`/api/expenses/vouchers${qs ? `?${qs}` : ""}`);
    return result.map(toVoucherUpload);
  },

  async listRules(): Promise<ExpenseRule[]> {
    try {
      const result = await request<ApiRule[]>("/api/expenses/rules");
      return result.map(toRule);
    } catch (error) {
      return fallbackWithWarning("listRules", [], error);
    }
  },

  async getOcrServices() {
    return request<ExpenseOcrServiceCatalog>("/api/expenses/ocr/services");
  },

  async uploadInvoiceFiles(files: File[], options: ExpenseOcrUploadOptions = {}) {
    const formData = new FormData();
    files.forEach((file) => formData.append("files", file));
    appendOcrOptions(formData, options);
    const result = await request<{ items: ApiInvoice[]; matches?: VoucherMatchSummary }>("/api/expenses/invoices/upload", {
      method: "POST",
      body: formData,
    });
    return { items: result.items.map(toInvoice), matches: result.matches ?? emptyMatchSummary };
  },

  async uploadVoucherFiles(files: File[], options: ExpenseOcrUploadOptions = {}) {
    const formData = new FormData();
    files.forEach((file) => formData.append("files", file));
    appendOcrOptions(formData, options);
    const result = await request<{ items: ApiVoucherUpload[]; matches?: VoucherMatchSummary }>("/api/expenses/vouchers/upload", {
      method: "POST",
      body: formData,
    });
    return { items: result.items.map(toVoucherUpload), matches: result.matches ?? emptyMatchSummary };
  },

  async autoMatchVouchers() {
    return request<VoucherMatchSummary>("/api/expenses/vouchers/auto-match", {
      method: "POST",
    });
  },

  async linkVoucher(invoiceId: string, voucherId: string) {
    return toInvoice(await request<ApiInvoice>(`/api/expenses/invoices/${invoiceId}/voucher-link`, {
      method: "POST",
      body: JSON.stringify({ voucher_id: voucherId }),
    }));
  },

  async createReimbursement(payload: {
    title: string;
    applicant?: string;
    project?: string;
    reason?: string;
    invoice_ids: string[];
    voucher_ids?: string[];
    wecom_creator_userid?: string;
    notify_emails?: string[];
    cc_emails?: string[];
  }) {
    return toReimbursement(await request<ApiReimbursement>("/api/expenses/reimbursements", {
      method: "POST",
      body: JSON.stringify(payload),
    }));
  },

  async submitWeComApproval(reimbursementId: string) {
    return toReimbursement(await request<ApiReimbursement>(`/api/expenses/reimbursements/${reimbursementId}/submit-wecom`, {
      method: "POST",
    }));
  },

  deleteDraftReimbursement(reimbursementId: string) {
    return request<{ ok: true }>(`/api/expenses/reimbursements/${reimbursementId}`, {
      method: "DELETE",
    });
  },

  async syncWeComApproval(reimbursementId: string) {
    return toReimbursement(await request<ApiReimbursement>(`/api/expenses/reimbursements/${reimbursementId}/sync-wecom`, {
      method: "POST",
    }));
  },

  getIntegrationRequirements() {
    return request<ExpenseIntegrationRequirements>("/api/expenses/integrations/requirements");
  },

  getArchiveConfig() {
    return request<ExpenseArchiveConfig>("/api/expenses/archive/config");
  },

  saveArchiveConfig(config: ExpenseArchiveConfig) {
    return request<ExpenseArchiveConfig>("/api/expenses/archive/config", {
      method: "PUT",
      body: JSON.stringify(config),
    });
  },
};
