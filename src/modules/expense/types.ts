import type { LucideIcon } from "lucide-react";

export type ExpenseSubMenu = "workspace" | "invoices" | "reimbursements" | "matching" | "rules";

export type ExpenseCategory = "差旅" | "餐饮" | "采购" | "办公" | "其他";

export type InvoiceStatus = "待识别" | "已识别" | "待确认" | "已关联" | "异常" | "已报销";

export type MatchStatus = "待关联" | "已关联" | "关联失败";

export type ReimbursementStatus = "草稿" | "审批中" | "已通过" | "已驳回" | "已付款";
export type WeComSyncStatus = "未提交" | "已同步" | "审批中" | "已回调" | "同步失败";

export type DrawerKind =
  | "upload"
  | "voucher-upload"
  | "invoice-detail"
  | "batch-classify"
  | "link-voucher"
  | "new-reimbursement"
  | "reimbursement-detail"
  | "matching-detail"
  | "push-settings"
  | "rule-editor"
  | null;

export type DrawerWidth = "narrow" | "medium" | "wide";

export type InvoiceRecord = {
  id: string;
  thumbnailType: "JPG" | "PNG" | "PDF";
  invoiceNo: string;
  invoiceCode: string;
  issuedDate: string;
  vendor: string;
  vendorTaxNo: string;
  amount: number;
  tax: number;
  category: ExpenseCategory;
  categoryConfidence: number;
  project: string;
  status: InvoiceStatus;
  uploader: string;
  uploaderAvatar: string;
  uploadedAt: string;
  relativeUploadedAt: string;
  aiInsight: string;
  materialMissing: string[];
  voucherNo?: string;
  matchConfidence?: number;
  paymentVoucher?: string;
  matchedVoucherId?: string;
  matchScore?: number;
  matchReasons?: string[];
  matchedBy?: "system" | "manual";
  matchedAt?: string;
  ocrMode?: OcrMode;
  ocrServiceKey?: string;
  ocrServiceLabel?: string;
  ocrAction?: string;
  ocrRequestId?: string;
  detectedType?: string;
  detectedTypeConfidence?: number;
  manualReviewRequired?: boolean;
  thirdPartyErrors?: ThirdPartyOfficialError[];
};

export type OcrMode = "auto" | "manual";

export type ThirdPartyOfficialError = {
  provider: "tencent_ocr" | "wecom";
  code: string | number;
  message: string;
  request_id?: string;
  action?: string;
  raw?: unknown;
  docs: string[];
};

export type VoucherUploadRecord = {
  id: string;
  voucherNo: string;
  amount: number;
  date: string;
  project: string;
  subject: string;
  counterparty?: string;
  confidence: number;
  reason: string;
  fileName: string;
  uploadedAt: string;
  status: string;
  ocrMode?: OcrMode;
  ocrServiceKey?: string;
  ocrServiceLabel?: string;
  ocrAction?: string;
  ocrRequestId?: string;
  detectedType?: string;
  matchedInvoiceId?: string;
  matchScore?: number;
  matchReasons?: string[];
  matchedBy?: "system" | "manual";
  matchedAt?: string;
  manualReviewRequired?: boolean;
  thirdPartyErrors?: ThirdPartyOfficialError[];
};

export type VoucherCandidate = {
  id: string;
  voucherNo: string;
  amount: number;
  date: string;
  project: string;
  subject: string;
  confidence: number;
  reason: string;
  matchReasons?: string[];
  matchStatus?: "auto" | "manual_review" | "blocked";
};

export type ReimbursementRecord = {
  id: string;
  title: string;
  applicant: string;
  appliedDate: string;
  amount: number;
  invoiceCount: number;
  status: ReimbursementStatus;
  node: string;
  weComFlowId: string;
  weComSyncStatus: WeComSyncStatus;
  weComApprover: string;
  weComUpdatedAt: string;
};

export type ExpenseRule = {
  id: string;
  name: string;
  keywords: string;
  matchType: string;
  targetCategory: ExpenseCategory;
  priority: number;
  hits: number;
  enabled: boolean;
};

export type DashboardTodo = {
  id: string;
  title: string;
  detail: string;
  drawer: DrawerKind;
  severity: "warning" | "error" | "info";
};

export type ActivityLog = {
  id: string;
  time: string;
  title: string;
  detail: string;
};

export type KPIItem = {
  title: string;
  value: string;
  trend?: string;
  badge?: string;
  progress?: number;
  icon: LucideIcon;
};

export type InvoiceFilters = {
  quickRange: "本周" | "本月" | "上月" | "本季度" | "自定义";
  status: "全部" | InvoiceStatus;
  category: "全部" | ExpenseCategory;
  amountMin: string;
  amountMax: string;
  keyword: string;
  maxConfidence: number;
};

export type ExpenseDashboardData = {
  kpis: KPIItem[];
  todos: DashboardTodo[];
  activities: ActivityLog[];
  monthlyTrend: Array<{ month: string; 差旅: number; 餐饮: number; 采购: number; 办公: number; 其他: number }>;
  categoryShare: Array<{ category: ExpenseCategory; amount: number }>;
  departmentBars: Array<{ dept: string; amount: number }>;
  projectTop: Array<{ project: string; amount: number }>;
};
