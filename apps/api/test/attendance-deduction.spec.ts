import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { AttendanceImportService } from '../src/modules/attendance/attendance-import.service';
import { AttendanceService } from '../src/modules/attendance/attendance.service';
import type { WeComDailyRow } from '../src/modules/attendance/wecom-daily-report.parser';

function employee(deductsInvertedHours: boolean) {
  return {
    id: 'employee-1',
    rosterNo: '001',
    name: '测试员工',
    company: '壹诺吉',
    department: '生产部',
    title: '生产员工',
    employmentStatus: '在职',
    deductsInvertedHours,
  };
}

function createAttendanceService(deductsInvertedHours: boolean) {
  const writes: Array<Record<string, unknown>> = [];
  const targetEmployee = employee(deductsInvertedHours);
  const service = new AttendanceService({
    employeeArchive: {
      findUnique: async () => targetEmployee,
    },
    employeeAttendance: {
      upsert: async ({ create }: { create: Record<string, unknown> }) => {
        writes.push(create);
        return { id: 'attendance-1', ...create };
      },
    },
  } as never);
  return { service, writes };
}

const earlyLeaveRecord = {
  employeeId: 'employee-1',
  attendanceDate: '2026-08-01',
  scheduledStart: '09:00',
  scheduledEnd: '18:00',
  checkInTime: '08:55',
  checkOutTime: '13:17',
  manualStatus: 'auto' as const,
};

test('自动判定早退时只记录早退分钟，不自动生成倒挂扣时', async () => {
  const { service, writes } = createAttendanceService(true);

  const result = await service.save(earlyLeaveRecord, 'actor-1');

  assert.equal(result.status, 'early');
  assert.equal(result.earlyLeaveMinutes, 283);
  assert.equal(result.deductionMinutes, 0);
  assert.equal(writes[0]?.deductionMinutes, 0);
});

test('参与倒挂抵扣的员工仍可由 HR 明确录入倒挂扣时', async () => {
  const { service } = createAttendanceService(true);

  const result = await service.save({ ...earlyLeaveRecord, deductionMinutes: 120 }, 'actor-1');

  assert.equal(result.earlyLeaveMinutes, 283);
  assert.equal(result.deductionMinutes, 120);
});

test('未参与倒挂抵扣的员工即使传入分钟数也不会产生倒挂扣时', async () => {
  const { service } = createAttendanceService(false);

  const result = await service.save({ ...earlyLeaveRecord, deductionMinutes: 120 }, 'actor-1');

  assert.equal(result.deductionMinutes, 0);
});

test('企微日报导入只带入迟到早退异常，不自动生成倒挂扣时', () => {
  const service = new AttendanceImportService({} as never);
  const internal = service as unknown as {
    toRecordData: (
      employee: { id: string; deductsInvertedHours: boolean },
      row: WeComDailyRow,
      actorId: string,
    ) => { deductionMinutes: number; earlyLeaveMinutes: number };
  };
  const row: WeComDailyRow = {
    rowNumber: 2,
    attendanceDate: '2026-08-01',
    employeeName: '测试员工',
    account: 'test-user',
    department: '生产部',
    departmentPath: '壹诺吉/生产部',
    shiftName: '09:00-18:00',
    scheduledStart: '09:00',
    scheduledEnd: '18:00',
    checkInTime: '08:55',
    checkOutTime: '13:17',
    status: 'early',
    lateMinutes: 0,
    earlyLeaveMinutes: 283,
    overtimeMinutes: 0,
    overtimeType: '',
    rawOvertimeHours: 0,
    note: '',
    hasPunch: true,
    leaveDayFraction: 1,
    halfDayLeave: false,
  };

  const result = internal.toRecordData(employee(true), row, 'actor-1');

  assert.equal(result.earlyLeaveMinutes, 283);
  assert.equal(result.deductionMinutes, 0);
});
