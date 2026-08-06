import type { AttendanceStatus } from './attendanceApi';

export const ATTENDANCE_SPECIAL_STATUS_LABELS: Partial<Record<AttendanceStatus, string>> = {
  absent: '旷工',
  leave: '休假',
  business_trip: '市内出差',
  rest: '-',
  holiday: '放假',
  sick_leave: '病假',
  personal_leave: '事假',
  annual_leave: '年假',
  paternity_leave: '陪产假',
  compensatory_leave: '调休',
  study: '学习',
};

export function attendanceSpecialStatusLabel(status: AttendanceStatus): string {
  return ATTENDANCE_SPECIAL_STATUS_LABELS[status] ?? status;
}
