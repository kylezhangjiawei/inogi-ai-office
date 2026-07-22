import { authFetch, readErrorMessage } from './authSession';

export type EmployeeArchiveStatus = 'complete' | 'review' | 'missing' | 'onboarding';
export type EmployeeArchiveDocumentStatus = 'done' | 'review' | 'missing';

export interface EmployeeArchiveDocument {
  title: string;
  source: string;
  status: EmployeeArchiveDocumentStatus;
  detail: string;
  updatedAt: string;
}

export interface EmployeeArchiveRecord {
  id: string;
  rosterNo: string;
  company: string;
  hireDate: string;
  regularizationDate: string;
  settlementDate: string;
  tenure: string;
  status: string;
  workLocation: string;
  department: string;
  title: string;
  employeeCode: string;
  name: string;
  idNoMasked: string;
  birthDate: string;
  birthMonthDay: string;
  zodiac: string;
  constellation: string;
  gender: string;
  age: number;
  ethnicity: string;
  maritalStatus: string;
  phoneMasked: string;
  bankAccountMasked: string;
  bankBranch: string;
  education: string;
  school: string;
  major: string;
  hometown: string;
  registeredAddress: string;
  currentAddress: string;
  emergencyContact: string;
  emergencyRelation: string;
  emergencyPhoneMasked: string;
  socialSecurityNo: string;
  socialSecurityFirstMonth: string;
  note: string;
  costCenter: string;
  archiveStatus: EmployeeArchiveStatus;
  archiveScore: number;
  missingFields: string[];
  alerts: string[];
  docs: EmployeeArchiveDocument[];
  badgeConfig?: EmployeeArchiveBadgeConfig;
}

export interface EmployeeArchiveBadgeAvatarConfig {
  fileId?: string;
  fileName?: string;
  signedUrl?: string | null;
  imageWidth?: number;
  imageHeight?: number;
  offsetX?: number;
  offsetY?: number;
  rotate?: number;
  radius?: number;
}

export interface EmployeeArchiveBadgeConfig {
  templateKey?: 'official' | 'intern' | 'labor';
  positions?: Record<string, unknown>;
  positionConfirmed?: Record<string, unknown>;
  textVisibility?: Record<string, unknown>;
  avatar?: EmployeeArchiveBadgeAvatarConfig | null;
}

export interface EmployeeArchiveStats {
  total: number;
  complete: number;
  review: number;
  missing: number;
  onboarding: number;
  pending: number;
  missingFieldCount: number;
}

export interface EmployeeProbationReminder {
  employee: EmployeeArchiveRecord;
  conversionDate: string;
  reminderDate: string;
  daysUntilConversion: number;
  phase: 'upcoming' | 'active' | 'completed';
}

export interface EmployeeArchiveListResponse {
  items: EmployeeArchiveRecord[];
  total: number;
  page: number;
  pageSize: number;
}

export interface EmployeeArchiveSensitiveUpdate {
  identityNumber?: string;
  phoneNumber?: string;
  bankAccount?: string;
  emergencyPhoneNumber?: string;
  socialSecurityNumber?: string;
}

const EMPLOYEE_ARCHIVE_KEYS: ReadonlyArray<keyof EmployeeArchiveRecord> = [
  'id', 'rosterNo', 'company', 'hireDate', 'regularizationDate', 'settlementDate', 'tenure', 'status', 'workLocation',
  'department', 'title', 'employeeCode', 'name', 'idNoMasked', 'birthDate', 'birthMonthDay', 'zodiac',
  'constellation', 'gender', 'age',
  'ethnicity', 'maritalStatus', 'phoneMasked', 'bankAccountMasked', 'bankBranch', 'education', 'school',
  'major', 'hometown', 'registeredAddress', 'currentAddress', 'emergencyContact', 'emergencyRelation',
  'emergencyPhoneMasked', 'socialSecurityNo', 'socialSecurityFirstMonth', 'note', 'costCenter',
  'archiveStatus', 'archiveScore', 'missingFields', 'alerts', 'docs',
  'badgeConfig',
];

const EMPLOYEE_ARCHIVE_STRING_KEYS: ReadonlyArray<keyof EmployeeArchiveRecord> = [
  'id', 'rosterNo', 'company', 'hireDate', 'regularizationDate', 'settlementDate', 'tenure', 'status', 'workLocation',
  'department', 'title', 'employeeCode', 'name', 'idNoMasked', 'birthDate', 'birthMonthDay', 'zodiac',
  'constellation', 'gender', 'ethnicity',
  'maritalStatus', 'phoneMasked', 'bankAccountMasked', 'bankBranch', 'education', 'school', 'major',
  'hometown', 'registeredAddress', 'currentAddress', 'emergencyContact', 'emergencyRelation',
  'emergencyPhoneMasked', 'socialSecurityNo', 'socialSecurityFirstMonth', 'note', 'costCenter',
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeArchiveStatus(value: unknown): EmployeeArchiveStatus {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['complete', 'completed', 'archived', 'done', '归档完成', '已完成'].includes(normalized)) return 'complete';
  if (['review', 'reviewing', 'pending_review', 'pending', '待复核', '待审核'].includes(normalized)) return 'review';
  if (['onboarding', 'on_boarding', 'onboard', '入职中', '待入职'].includes(normalized)) return 'onboarding';
  return 'missing';
}

function normalizeDocumentStatus(value: unknown): EmployeeArchiveDocumentStatus {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['done', 'complete', 'completed', 'archived', '已归档', '已完成'].includes(normalized)) return 'done';
  if (['missing', 'incomplete', '待补充', '缺失'].includes(normalized)) return 'missing';
  return 'review';
}

/**
 * 接口响应和浏览器历史缓存都属于不可信输入。这里统一补齐数组、数字和状态字段，
 * 避免旧数据在 React 首次渲染时造成整页崩溃。
 */
export function normalizeEmployeeArchiveRecord(record: unknown): EmployeeArchiveRecord {
  const source = asRecord(record);
  const normalized = Object.fromEntries(EMPLOYEE_ARCHIVE_KEYS.map((key) => [key, source[key]])) as Record<string, unknown>;

  for (const key of EMPLOYEE_ARCHIVE_STRING_KEYS) {
    normalized[key] = typeof source[key] === 'string' ? source[key] : '';
  }

  const numericAge = Number(source.age);
  const numericArchiveScore = Number(source.archiveScore);
  normalized.age = Number.isFinite(numericAge) ? Math.max(0, Math.min(150, Math.round(numericAge))) : 0;
  normalized.archiveScore = Number.isFinite(numericArchiveScore)
    ? Math.max(0, Math.min(100, Math.round(numericArchiveScore)))
    : 0;
  normalized.archiveStatus = normalizeArchiveStatus(source.archiveStatus);
  normalized.missingFields = Array.isArray(source.missingFields)
    ? source.missingFields.filter((value): value is string => typeof value === 'string')
    : [];
  normalized.alerts = Array.isArray(source.alerts)
    ? source.alerts.filter((value): value is string => typeof value === 'string')
    : [];
  normalized.docs = Array.isArray(source.docs)
    ? source.docs.map((document) => {
      const item = asRecord(document);
      return {
        title: typeof item.title === 'string' ? item.title : '未命名材料',
        source: typeof item.source === 'string' ? item.source : '',
        status: normalizeDocumentStatus(item.status),
        detail: typeof item.detail === 'string' ? item.detail : '',
        updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : '',
      } satisfies EmployeeArchiveDocument;
    })
    : [];
  normalized.badgeConfig = source.badgeConfig && typeof source.badgeConfig === 'object' && !Array.isArray(source.badgeConfig)
    ? source.badgeConfig
    : undefined;

  return normalized as unknown as EmployeeArchiveRecord;
}

function sanitizeListResponse<T extends EmployeeArchiveListResponse>(payload: T): T {
  return { ...payload, items: payload.items.map(normalizeEmployeeArchiveRecord) };
}

async function parseResponse<T>(response: Response, fallback: string): Promise<T> {
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, fallback));
  }
  return response.json() as Promise<T>;
}

export async function listEmployeeArchives(signal?: AbortSignal) {
  const response = await authFetch('/api/employee-archives?page=1&pageSize=1000', { signal });
  return sanitizeListResponse(
    await parseResponse<EmployeeArchiveListResponse>(response, '读取员工归档失败'),
  );
}

export async function getEmployeeArchiveStats(signal?: AbortSignal) {
  const response = await authFetch('/api/employee-archives/stats', { signal });
  return parseResponse<EmployeeArchiveStats>(response, '读取员工归档统计失败');
}

export async function listEmployeeProbationReminders(signal?: AbortSignal) {
  const response = await authFetch('/api/employee-archives/probation-reminders?days=31', { signal });
  const payload = await parseResponse<{ items: EmployeeProbationReminder[]; total: number; windowDays: number }>(
    response,
    '读取转正提醒失败',
  );
  return {
    ...payload,
    items: payload.items.map((item) => ({ ...item, employee: normalizeEmployeeArchiveRecord(item.employee) })),
  };
}

export async function importEmployeeArchives(items: EmployeeArchiveRecord[], replace = false) {
  const response = await authFetch('/api/employee-archives/import', {
    method: 'POST',
    body: JSON.stringify({ items, replace }),
  });
  return sanitizeListResponse(
    await parseResponse<EmployeeArchiveListResponse & { imported: number; replaced: boolean }>(
      response,
      '保存员工归档失败',
    ),
  );
}

export async function saveEmployeeArchive(
  record: EmployeeArchiveRecord,
  sensitiveUpdate: EmployeeArchiveSensitiveUpdate = {},
) {
  let response = await authFetch(`/api/employee-archives/${encodeURIComponent(record.id)}`, {
    method: 'PUT',
    body: JSON.stringify({ ...record, ...sensitiveUpdate }),
  });
  // 内置演示数据或仅存在于旧本地缓存的数据在服务端没有主键时，自动转为新增。
  if (response.status === 404) {
    response = await authFetch('/api/employee-archives', {
      method: 'POST',
      body: JSON.stringify({ ...record, ...sensitiveUpdate }),
    });
  }
  return normalizeEmployeeArchiveRecord(
    await parseResponse<EmployeeArchiveRecord>(response, '更新员工归档失败'),
  );
}

export async function createEmployeeArchive(
  record: EmployeeArchiveRecord,
  sensitiveUpdate: EmployeeArchiveSensitiveUpdate = {},
) {
  const response = await authFetch('/api/employee-archives', {
    method: 'POST',
    body: JSON.stringify({ ...record, ...sensitiveUpdate }),
  });
  return normalizeEmployeeArchiveRecord(
    await parseResponse<EmployeeArchiveRecord>(response, '新增员工归档失败'),
  );
}

export async function deleteEmployeeArchive(id: string) {
  const response = await authFetch(`/api/employee-archives/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  return parseResponse<{ success: true; id: string }>(response, '删除员工归档失败');
}

export async function regularizeEmployeeArchive(id: string, regularizationDate: string) {
  const response = await authFetch(`/api/employee-archives/${encodeURIComponent(id)}/regularize`, {
    method: 'PUT',
    body: JSON.stringify({ regularizationDate }),
  });
  return normalizeEmployeeArchiveRecord(
    await parseResponse<EmployeeArchiveRecord>(response, '员工转正失败'),
  );
}

export async function getEmployeeBadgeConfig(id: string, signal?: AbortSignal) {
  const response = await authFetch(`/api/employee-archives/${encodeURIComponent(id)}/badge-config`, { signal });
  return parseResponse<EmployeeArchiveBadgeConfig>(response, '读取胸牌配置失败');
}

export async function saveEmployeeBadgeConfig(id: string, config: EmployeeArchiveBadgeConfig) {
  const response = await authFetch(`/api/employee-archives/${encodeURIComponent(id)}/badge-config`, {
    method: 'PUT',
    body: JSON.stringify(config),
  });
  return parseResponse<EmployeeArchiveBadgeConfig>(response, '保存胸牌配置失败');
}

export async function uploadEmployeeBadgeAvatar(employeeId: string, dataUrl: string, fileName: string) {
  const blob = await fetch(dataUrl).then((response) => response.blob());
  const form = new FormData();
  form.append('file', blob, fileName || 'badge-avatar.png');
  form.append('businessType', 'employee-archive/badge-avatar');
  form.append('businessId', employeeId);
  const response = await authFetch('/api/files/upload', { method: 'POST', body: form });
  return parseResponse<{
    fileId: string;
    objectKey: string;
    fileName: string;
    mimeType: string;
    fileSize: number;
    signedUrl: string | null;
  }>(response, '上传胸牌头像失败');
}
