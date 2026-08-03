import { authFetch, readErrorMessage } from './authSession';

export type AttendanceStatus =
  | 'normal'
  | 'late'
  | 'early'
  | 'late_early'
  | 'missing'
  | 'absent'
  | 'leave'
  | 'business_trip'
  | 'rest'
  | 'holiday'
  | 'sick_leave'
  | 'personal_leave'
  | 'annual_leave'
  | 'paternity_leave'
  | 'compensatory_leave'
  | 'study';

export type AttendanceManualStatus =
  | 'auto'
  | 'absent'
  | 'leave'
  | 'business_trip'
  | 'rest'
  | 'holiday'
  | 'sick_leave'
  | 'personal_leave'
  | 'annual_leave'
  | 'paternity_leave'
  | 'compensatory_leave'
  | 'study';

export type AttendanceOvertimeType = 'workday' | 'sunday' | 'holiday';

export interface AttendanceEmployee {
  id: string;
  rosterNo: string;
  name: string;
  company: string;
  department: string;
  title: string;
  employmentStatus: string;
  /** 是否参与倒挂抵扣：为 true 才记扣除工时并累计成倒挂欠账 */
  deductsInvertedHours: boolean;
}

export interface AttendanceRecord {
  id: string | null;
  employeeId: string;
  attendanceDate: string;
  shiftName: string;
  scheduledStart: string;
  scheduledEnd: string;
  checkInTime: string;
  checkOutTime: string;
  status: AttendanceStatus;
  workMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  deductionMinutes: number;
  overtimeMinutes: number;
  /** 当日请假占多少天：1=整天，0.5=半天 */
  leaveDayFraction: number;
  overtimeType: AttendanceOvertimeType | '';
  source: string;
  note: string;
  employee: AttendanceEmployee;
}

export interface AttendanceSummary {
  expected: number;
  checkedIn: number;
  normal: number;
  late: number;
  early: number;
  exceptions: number;
  leave: number;
  absent: number;
  completed: number;
  completionRate: number;
}

export interface AttendanceDailyResponse {
  date: string;
  summary: AttendanceSummary;
  departments: string[];
  items: AttendanceRecord[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AttendanceMonthlyEmployeeSummary {
  expectedDays: number;
  normalDays: number;
  restDays: number;
  holidayDays: number;
  sickLeaveDays: number;
  personalLeaveDays: number;
  annualLeaveDays: number;
  absentDays: number;
  lateEarlyCount: number;
  paternityLeaveDays: number;
  compensatoryLeaveDays: number;
  businessTripDays: number;
  studyDays: number;
  workdayOvertimeHours: number;
  sundayOvertimeHours: number;
  holidayOvertimeHours: number;
  overtimeHours: number;
  deductionHours: number;
  deductionMinutes: number;
  leaveDays: number;
  completedDays: number;
  missingDays: number;
}

export interface AttendanceMonthlyItem {
  employee: AttendanceEmployee;
  records: AttendanceRecord[];
  summary: AttendanceMonthlyEmployeeSummary;
  adjustment: AttendanceMonthAdjustment;
  rules: AttendanceRuleSummary;
}

export interface AttendanceRuleSummary {
  ruleType: 'production_inverted' | 'regular';
  annualPaidSickLeaveAllowanceDays: number;
  annualSickLeaveDays: number;
  paidSickLeaveUsedDays: number;
  excessSickLeaveDays: number;
  /** 当月扣除工时汇总出的倒挂工时（没干活却发了工资的时长） */
  autoInvertedHours: number;
  /** 月度结余里手工填的倒挂工时，>0 时覆盖自动值 */
  manualInvertedHours: number;
  /** 实际生效的倒挂工时：手工值优先，否则用自动值 */
  startingInvertedHours: number;
  manuallyRecoveredHours: number;
  availableInvertedHours: number;
  invertedOffsetHours: number;
  remainingInvertedHours: number;
  countableWorkdayOvertimeHours: number;
  sundayOvertimeHours: number;
  holidayOvertimeHours: number;
  countableOvertimeHours: number;
  previousCompTimeBalanceHours: number;
  compTimeEarnedHours: number;
  compTimeUsedHours: number;
  compTimeBalanceHours: number;
  alerts: string[];
}

export interface AttendanceMonthAdjustment {
  id: string | null;
  employeeId: string;
  year: number;
  month: number;
  previousOvertimeBalance: number;
  previousCompTimeBalanceHours: number;
  previousMonthSickLeaveDays: number;
  entitledSickLeaveDays: number;
  paidSickLeaveDays: number;
  unpaidSickLeaveDays: number;
  invertedHours: number;
  recoveredHours: number;
  signature: string;
  note: string;
}

export type SaveAttendanceMonthPayload = Omit<AttendanceMonthAdjustment, 'id' | 'year' | 'month'> & {
  month: string;
  /** 人员长期属性，写入员工档案而非本月结余 */
  deductsInvertedHours?: boolean;
};

export interface AttendanceMonthlyResponse {
  month: string;
  year: number;
  monthNumber: number;
  daysInMonth: number;
  departments: string[];
  items: AttendanceMonthlyItem[];
  total: number;
  summary: {
    employeeCount: number;
    expectedDays: number;
    normalDays: number;
    leaveDays: number;
    exceptionCount: number;
    overtimeHours: number;
    countableOvertimeHours: number;
    compTimeEarnedHours: number;
    sickLeaveAlertCount: number;
    completedDays: number;
  };
}

export interface AttendanceOvertimeResponse {
  month: string;
  departments: string[];
  total: number;
  items: Array<Omit<AttendanceMonthlyItem, 'records'>>;
  summary: {
    employeeCount: number;
    rawOvertimeHours: number;
    countableOvertimeHours: number;
    compTimeEarnedHours: number;
    invertedOffsetHours: number;
  };
}

export interface AttendanceEmployeeDetailResponse extends AttendanceMonthlyItem {
  month: string;
  year: number;
  monthNumber: number;
  daysInMonth: number;
}

export interface SaveAttendancePayload {
  employeeId: string;
  attendanceDate: string;
  shiftName?: string;
  scheduledStart?: string;
  scheduledEnd?: string;
  checkInTime?: string;
  checkOutTime?: string;
  manualStatus?: AttendanceManualStatus;
  deductionMinutes?: number;
  overtimeMinutes?: number;
  overtimeType?: AttendanceOvertimeType;
  note?: string;
}

/** 导入预览里按人分组的统计，勾选与写库影响预估都以此为单位。 */
export interface AttendanceImportGroup {
  employeeId: string;
  employeeName: string;
  rosterNo: string;
  department: string;
  wecomDepartment: string;
  rowCount: number;
  punchedDays: number;
  absentDays: number;
  leaveDays: number;
  restDays: number;
  overtimeHours: number;
  createCount: number;
  overwriteCount: number;
  manualSkipCount: number;
}

export interface AttendanceImportPreview {
  /** 行数最多的月份，导入后页面切到这里 */
  month: string;
  /** 文件实际覆盖的日期区间，覆盖写入只发生在区间内 */
  startDate: string;
  endDate: string;
  /** 覆盖到的月份及行数，跨考勤周期导出时会有两个 */
  months: Array<{ month: string; rowCount: number }>;
  /** 节假日日历未登记的年份，这些年的节假日加班会退化成休息日加班 */
  yearsMissingHolidayCalendar: number[];
  fileName: string;
  totalRows: number;
  parsedRows: number;
  groups: AttendanceImportGroup[];
  /** 整月无有效打卡（多为不用企微打卡的外包人员），默认不勾选 */
  noPunchGroups: AttendanceImportGroup[];
  unmatched: string[];
  ambiguous: Array<{ name: string; candidates: Array<{ rosterNo: string; department: string }> }>;
  halfDayLeaves: Array<{ attendanceDate: string; employeeName: string; status: AttendanceStatus; note: string }>;
  summary: {
    employeeCount: number;
    rowCount: number;
    createCount: number;
    overwriteCount: number;
    manualSkipCount: number;
    overtimeRows: number;
    overtimeHours: number;
    filteredOvertimeRows: number;
    filteredOvertimeHours: number;
  };
}

export interface AttendanceImportResult {
  month: string;
  startDate: string;
  endDate: string;
  employeeCount: number;
  importedCount: number;
  createdCount: number;
  overwrittenCount: number;
  manualSkipCount: number;
  /** 本次新建立的「档案 ↔ 企微账号」映射数，之后导入按账号精确匹配 */
  linkedAccountCount: number;
}

async function parseResponse<T>(response: Response, fallback: string): Promise<T> {
  if (!response.ok) throw new Error(await readErrorMessage(response, fallback));
  return response.json() as Promise<T>;
}

export async function getDailyAttendance(
  params: {
    date: string;
    search?: string;
    department?: string;
    status?: AttendanceStatus;
    page?: number;
    pageSize?: number;
  },
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({ date: params.date, page: String(params.page ?? 1), pageSize: String(params.pageSize ?? 500) });
  if (params.search) query.set('search', params.search);
  if (params.department) query.set('department', params.department);
  if (params.status) query.set('status', params.status);
  const response = await authFetch(`/api/attendance/daily?${query.toString()}`, { signal });
  return parseResponse<AttendanceDailyResponse>(response, '读取考勤数据失败');
}

export async function getMonthlyAttendance(
  params: { month: string; search?: string; department?: string },
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({ month: params.month });
  if (params.search) query.set('search', params.search);
  if (params.department) query.set('department', params.department);
  const response = await authFetch(`/api/attendance/monthly?${query.toString()}`, { signal });
  return parseResponse<AttendanceMonthlyResponse>(response, '读取月度考勤数据失败');
}

export async function getAttendanceOvertime(
  params: { month: string; search?: string; department?: string },
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({ month: params.month });
  if (params.search) query.set('search', params.search);
  if (params.department) query.set('department', params.department);
  const response = await authFetch(`/api/attendance/overtime?${query.toString()}`, { signal });
  return parseResponse<AttendanceOvertimeResponse>(response, '读取加班时长表失败');
}

export async function getAttendanceEmployeeDetail(employeeId: string, month: string, signal?: AbortSignal) {
  const query = new URLSearchParams({ month });
  const response = await authFetch(`/api/attendance/employee/${encodeURIComponent(employeeId)}?${query.toString()}`, { signal });
  return parseResponse<AttendanceEmployeeDetailResponse>(response, '读取人员考勤详情失败');
}

export async function saveAttendanceRecord(payload: SaveAttendancePayload) {
  const response = await authFetch('/api/attendance/record', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  return parseResponse<AttendanceRecord>(response, '保存考勤记录失败');
}

export async function saveAttendanceMonth(payload: SaveAttendanceMonthPayload) {
  const response = await authFetch('/api/attendance/month', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  return parseResponse<AttendanceMonthAdjustment>(response, '保存月度考勤结余失败');
}

export async function clockAttendance(employeeId: string, type: 'check-in' | 'check-out') {
  const response = await authFetch('/api/attendance/clock', {
    method: 'POST',
    body: JSON.stringify({ employeeId, type }),
  });
  return parseResponse<AttendanceRecord>(response, type === 'check-in' ? '上班打卡失败' : '下班打卡失败');
}

export async function deleteAttendanceRecord(id: string) {
  const response = await authFetch(`/api/attendance/record/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return parseResponse<{ success: true; id: string }>(response, '清除考勤记录失败');
}

/** 企业微信打卡日报预览：只解析比对，不写库。 */
export async function previewAttendanceImport(file: File, signal?: AbortSignal) {
  const form = new FormData();
  form.append('file', file);
  const response = await authFetch('/api/attendance/import/preview', { method: 'POST', body: form, signal });
  return parseResponse<AttendanceImportPreview>(response, '解析考勤文件失败');
}

/** 导入确认：文件随勾选的员工一并重传，服务端重新解析后写库。 */
export async function confirmAttendanceImport(file: File, employeeIds: string[]) {
  const form = new FormData();
  form.append('file', file);
  form.append('employeeIds', JSON.stringify(employeeIds));
  const response = await authFetch('/api/attendance/import/confirm', { method: 'POST', body: form });
  return parseResponse<AttendanceImportResult>(response, '导入考勤数据失败');
}
