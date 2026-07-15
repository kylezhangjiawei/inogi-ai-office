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
