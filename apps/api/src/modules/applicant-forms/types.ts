/** Shared applicant-form API contract. All payloads use camelCase. */
export const FIELD_TYPES = ['text', 'textarea', 'phone', 'email', 'number', 'date', 'select', 'multiselect', 'checkbox', 'repeat', 'file'] as const;
export type FieldType = typeof FIELD_TYPES[number];
export type FieldStage = 'application' | 'onboarding' | 'internal';
export interface FormField {
  id: string;
  label: string;
  type: FieldType;
  required: boolean;
  visible: boolean;
  stage: FieldStage;
  section: string;
  placeholder?: string;
  options?: string[];
  children?: FormField[];
  condition?: { fieldId: string; equals: string };
  minItems?: number;
  maxItems?: number;
  fileKind?: 'photo' | 'document';
}
export interface FormSchema { title: string; description: string; fields: FormField[] }
export type AnswerValue = string | number | boolean | string[] | { fileId: string } | FormAnswers[];
export interface FormAnswers { [fieldId: string]: AnswerValue }
export const SUBMISSION_STATUSES = ['new', 'reviewing', 'interview', 'accepted', 'rejected', 'archived'] as const;
export type SubmissionStatus = typeof SUBMISSION_STATUSES[number];
export interface TemplateSummary {
  id: string; name: string; slug: string; revision: number;
  publishedVersionId: string | null; publishedVersion: number | null;
  submissionCount: number; updatedAt: string; createdAt: string;
  publicPath: string | null;
}
export interface TemplateDetail extends TemplateSummary { schema: FormSchema }
export interface FormVersion {
  id: string; templateId: string; version: number; schema: FormSchema;
  publishedAt: string; submissionCount: number;
}
export interface SubmissionSummary {
  id: string; templateId: string; versionId: string; version: number;
  status: SubmissionStatus; revision: number; submittedAt: string; updatedAt: string;
  answers: FormAnswers;
}
export interface StoredFile {
  id: string; fieldId: string; fileName: string; mimeType: string; size: number;
}
export interface SubmissionDetail extends SubmissionSummary {
  schema: FormSchema; note: string; files: StoredFile[];
}
export interface PublicForm {
  slug: string; versionId: string; version: number; schema: FormSchema;
  fillToken: string; expiresAt: string;
  uploadLimits: { maxFileBytes: number; maxSessionBytes: number; maxFiles: number };
}
export interface SubmitPayload {
  versionId: string; fillToken: string; idempotencyKey: string; answers: FormAnswers;
}
export interface SubmitReceipt { id: string; submittedAt: string; version: number; duplicate: boolean }
export interface UploadPayload {
  versionId: string; fillToken: string; fieldId: string;
  fileName: string; mimeType: string; dataBase64: string;
}
export interface AiSuggestion { schema: FormSchema; summary: string[]; model: string }
export interface AdminActor { id: string; name?: string; permissions: string[] }

export const DEFAULT_FORM_SCHEMA: FormSchema = {
  title: '应聘登记表',
  description: '请如实填写应聘资料。带星号的项目为必填项。',
  fields: [
    { id: 'fullName', label: '姓名', type: 'text', required: true, visible: true, stage: 'application', section: '基本资料' },
    { id: 'phone', label: '手机号码', type: 'phone', required: true, visible: true, stage: 'application', section: '基本资料' },
    { id: 'email', label: '电子邮箱', type: 'email', required: false, visible: true, stage: 'application', section: '基本资料' },
    { id: 'position', label: '应聘岗位', type: 'text', required: true, visible: true, stage: 'application', section: '求职意向' },
    { id: 'availableDate', label: '预计到岗日期', type: 'date', required: false, visible: true, stage: 'application', section: '求职意向' },
    { id: 'highestEducation', label: '最高学历', type: 'select', options: ['高中/中专', '大专', '本科', '硕士', '博士', '其他'], required: false, visible: true, stage: 'application', section: '教育与经历' },
    { id: 'education', label: '教育经历', type: 'repeat', required: false, visible: true, stage: 'application', section: '教育与经历', minItems: 0, maxItems: 5,
      children: [
        { id: 'school', label: '学校', type: 'text', required: true, visible: true, stage: 'application', section: '教育与经历' },
        { id: 'major', label: '专业', type: 'text', required: false, visible: true, stage: 'application', section: '教育与经历' },
        { id: 'qualification', label: '学历', type: 'select', options: ['高中/中专', '大专', '本科', '硕士', '博士', '其他'], required: true, visible: true, stage: 'application', section: '教育与经历' },
        { id: 'educationStart', label: '开始日期', type: 'date', required: false, visible: true, stage: 'application', section: '教育与经历' },
        { id: 'educationEnd', label: '结束日期', type: 'date', required: false, visible: true, stage: 'application', section: '教育与经历' },
      ] },
    { id: 'hasExperience', label: '是否有工作经历', type: 'select', options: ['有', '暂无'], required: false, visible: true, stage: 'application', section: '教育与经历' },
    { id: 'experience', label: '工作经历', type: 'repeat', required: false, visible: true, stage: 'application', section: '教育与经历', minItems: 0, maxItems: 10, condition: { fieldId: 'hasExperience', equals: '有' }, children: [
      { id: 'company', label: '公司', type: 'text', required: true, visible: true, stage: 'application', section: '教育与经历' },
      { id: 'jobTitle', label: '职位', type: 'text', required: true, visible: true, stage: 'application', section: '教育与经历' },
      { id: 'workStart', label: '开始日期', type: 'date', required: false, visible: true, stage: 'application', section: '教育与经历' },
      { id: 'workEnd', label: '结束日期', type: 'date', required: false, visible: true, stage: 'application', section: '教育与经历' },
    ] },
    { id: 'training', label: '培训与证书', type: 'repeat', required: false, visible: true, stage: 'application', section: '教育与经历', minItems: 0, maxItems: 10, children: [
      { id: 'trainingName', label: '培训或证书名称', type: 'text', required: true, visible: true, stage: 'application', section: '教育与经历' },
      { id: 'trainingOrganization', label: '培训或发证机构', type: 'text', required: false, visible: true, stage: 'application', section: '教育与经历' },
      { id: 'trainingDate', label: '取得日期', type: 'date', required: false, visible: true, stage: 'application', section: '教育与经历' },
    ] },
    { id: 'resume', label: '简历附件', type: 'file', fileKind: 'document', required: false, visible: true, stage: 'application', section: '补充资料' },
    { id: 'photo', label: '个人照片', type: 'file', fileKind: 'photo', required: false, visible: true, stage: 'application', section: '补充资料' },
    { id: 'declaration', label: '我确认所填资料真实，并同意用于本次招聘联系与评估', type: 'checkbox', required: true, visible: true, stage: 'application', section: '确认提交' },
    ...[
      ['identityNumber', '身份证号码'], ['socialInsurance', '社保情况'], ['ethnicity', '民族'], ['maritalStatus', '婚姻情况'],
      ['height', '身高'], ['health', '健康情况'], ['address', '详细地址'],
    ].map(([id, label]): FormField => ({ id, label, type: 'text', required: false, visible: false, stage: 'onboarding', section: '录用后补充' })),
    { id: 'familyMembers', label: '家庭成员', type: 'repeat', required: false, visible: false, stage: 'onboarding', section: '录用后补充', minItems: 0, maxItems: 10, children: [
      { id: 'familyName', label: '姓名', type: 'text', required: false, visible: false, stage: 'onboarding', section: '录用后补充' },
      { id: 'familyRelation', label: '关系', type: 'text', required: false, visible: false, stage: 'onboarding', section: '录用后补充' },
      { id: 'familyPhone', label: '联系电话', type: 'phone', required: false, visible: false, stage: 'onboarding', section: '录用后补充' },
    ] },
    { id: 'salaryConfirmation', label: '薪资确认', type: 'textarea', required: false, visible: false, stage: 'internal', section: '内部审批' },
    { id: 'approvalNote', label: '审批意见', type: 'textarea', required: false, visible: false, stage: 'internal', section: '内部审批' },
  ],
};
