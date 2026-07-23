import type { TencentOcrConfig, ThirdPartyOfficialError } from '../ocr/ocr.types';

export type { TencentOcrConfig, ThirdPartyOfficialError } from '../ocr/ocr.types';

export type ExpenseCategory = '差旅' | '餐饮' | '采购' | '办公' | '其他';
export type InvoiceStatus = '待识别' | '已识别' | '待确认' | '已关联' | '异常' | '已报销';
export type ReimbursementStatus = '草稿' | '审批中' | '已通过' | '已驳回' | '已付款';
export type WeComSyncStatus = '未提交' | '已同步' | '审批中' | '已回调' | '同步失败';
export type ExpenseEventLevel = 'info' | 'warning' | 'error';

export type ExpenseActivity = ExpenseDepartmentScope & {
  id: string;
  time: string;
  title: string;
  detail: string;
  level: ExpenseEventLevel;
  provider?: 'tencent_ocr' | 'wecom';
  official_error?: ThirdPartyOfficialError;
};

/** 部门归属字段（发票/凭证/报销单共用）：code 为隔离依据，name 为展示快照；均空表示「未分配」。 */
export type ExpenseDepartmentScope = {
  department_code?: string | null;
  department_name?: string | null;
};

export type ExpenseInvoiceValue = ExpenseDepartmentScope & {
  id: string;
  thumbnail_type: 'JPG' | 'PNG' | 'PDF';
  invoice_no: string;
  invoice_code: string;
  issued_date: string;
  vendor: string;
  vendor_tax_no: string;
  amount: number;
  tax: number;
  category: ExpenseCategory;
  category_confidence: number;
  project: string;
  status: InvoiceStatus;
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
  matched_by?: 'system' | 'manual';
  matched_at?: string;
  ocr_provider?: 'tencent_ocr' | 'mock';
  ocr_mode?: 'auto' | 'manual';
  ocr_service_key?: string;
  ocr_service_label?: string;
  ocr_action?: string;
  ocr_request_id?: string;
  detected_type?: string;
  detected_type_confidence?: number;
  manual_review_required?: boolean;
  ocr_raw_response?: unknown;
  third_party_errors?: ThirdPartyOfficialError[];
  file_url?: string;
  file_object_key?: string;
};

export type ExpenseVoucherValue = ExpenseDepartmentScope & {
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
  status: '待识别' | '已识别' | '待确认' | '异常';
  ocr_mode?: 'auto' | 'manual';
  ocr_service_key?: string;
  ocr_service_label?: string;
  ocr_action?: string;
  ocr_request_id?: string;
  detected_type?: string;
  matched_invoice_id?: string;
  match_score?: number;
  match_reasons?: string[];
  matched_by?: 'system' | 'manual';
  matched_at?: string;
  manual_review_required?: boolean;
  ocr_raw_response?: unknown;
  third_party_errors?: ThirdPartyOfficialError[];
  file_url?: string;
  file_object_key?: string;
};

export type ExpenseReimbursementValue = ExpenseDepartmentScope & {
  id: string;
  title: string;
  applicant: string;
  applicant_user_id?: string;
  applied_date: string;
  amount: number;
  invoice_count: number;
  invoice_ids: string[];
  voucher_ids?: string[];
  status: ReimbursementStatus;
  node: string;
  project: string;
  reason: string;
  wecom_flow_id: string;
  wecom_sync_status: WeComSyncStatus;
  wecom_approver: string;
  wecom_updated_at: string;
  wecom_creator_userid?: string;
  wecom_template_id?: string;
  wecom_raw_response?: unknown;
  /** 邮件通知收件人（来源于「邮箱管理」已启用邮箱），随报销单落库，提交审批时排队通知。 */
  notify_emails?: string[];
  /** 邮件抄送人（同上）。 */
  cc_emails?: string[];
  third_party_errors?: ThirdPartyOfficialError[];
};

export type ExpenseRuleValue = {
  id: string;
  name: string;
  keywords: string;
  match_type: string;
  target_category: ExpenseCategory;
  priority: number;
  hits: number;
  enabled: boolean;
};

export type VoucherCandidateValue = {
  id: string;
  voucher_no: string;
  amount: number;
  date: string;
  project: string;
  subject: string;
  confidence: number;
  reason: string;
  match_reasons?: string[];
  match_status?: 'auto' | 'manual_review' | 'blocked';
};

export type WeComExpenseConfig = {
  enabled: boolean;
  corp_id: string;
  agent_id: string;
  corp_secret: string;
  approval_template_id: string;
  default_creator_userid: string;
  callback_token: string;
  callback_aes_key: string;
};

export type ExpenseIntegrationConfig = {
  tencent_ocr: TencentOcrConfig;
  wecom: WeComExpenseConfig;
};
