export type ExpenseCategory = '差旅' | '餐饮' | '采购' | '办公' | '其他';
export type InvoiceStatus = '待识别' | '已识别' | '待确认' | '已关联' | '异常' | '已报销';
export type ReimbursementStatus = '草稿' | '审批中' | '已通过' | '已驳回' | '已付款';
export type WeComSyncStatus = '未提交' | '已同步' | '审批中' | '已回调' | '同步失败';
export type ExpenseEventLevel = 'info' | 'warning' | 'error';

export type ThirdPartyOfficialError = {
  provider: 'tencent_ocr' | 'wecom';
  code: string | number;
  message: string;
  request_id?: string;
  action?: string;
  raw?: unknown;
  docs: string[];
};

export type ExpenseActivity = {
  id: string;
  time: string;
  title: string;
  detail: string;
  level: ExpenseEventLevel;
  provider?: 'tencent_ocr' | 'wecom';
  official_error?: ThirdPartyOfficialError;
};

export type ExpenseInvoiceValue = {
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
};

export type ExpenseVoucherValue = {
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
};

export type ExpenseReimbursementValue = {
  id: string;
  title: string;
  applicant: string;
  applied_date: string;
  amount: number;
  invoice_count: number;
  invoice_ids: string[];
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

export type TencentOcrConfig = {
  enabled: boolean;
  secret_id: string;
  secret_key: string;
  region: string;
  endpoint: string;
  invoice_action: string;
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
