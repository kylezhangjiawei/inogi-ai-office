import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const MOCK_EMPLOYEES = [
  { rosterNo: 'MOCK-ATT-001', name: '林予安', department: '研发部', title: '注册工程师', hireDate: '2024-03-04' },
  { rosterNo: 'MOCK-ATT-002', name: '周庭序', department: '质量部', title: '质量体系专员', hireDate: '2025-09-15' },
  { rosterNo: 'MOCK-ATT-003', name: '许洛川', department: '生产部', title: '设备技术员', hireDate: '2026-05-06' },
  { rosterNo: 'MOCK-ATT-004', name: '唐亦禾', department: '市场部', title: '商务助理', hireDate: '2026-06-24' },
  { rosterNo: 'MOCK-ATT-005', name: '沈知夏', department: '人事部', title: '人事行政专员', hireDate: '2023-11-20' },
] as const;

type MockEmployee = (typeof MOCK_EMPLOYEES)[number] & { id: string };

function shanghaiDateText(value = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

function normalizeMonth(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return '';
  const month = Number(value.slice(5, 7));
  return month >= 1 && month <= 12 ? value : '';
}

function previousMonth(month: string) {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return date.toISOString().slice(0, 7);
}

function dateOnly(date: string) {
  return new Date(`${date}T00:00:00.000Z`);
}

function localDateTime(date: string, time: string) {
  return new Date(`${date}T${time}:00+08:00`);
}

function daysInMonth(month: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

function attendanceValues(employeeIndex: number, date: string) {
  const day = Number(date.slice(-2));
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const pattern = (employeeIndex * 5 + day) % 19;
  const common = {
    shiftName: '标准班',
    scheduledStart: '08:00',
    scheduledEnd: '18:00',
    source: 'mock',
  };

  if (weekday === 0) {
    if ((day + employeeIndex) % 3 === 0) {
      return {
        ...common,
        status: 'normal',
        checkInAt: localDateTime(date, '08:00'),
        checkOutAt: localDateTime(date, '13:00'),
        workMinutes: 300,
        lateMinutes: 0,
        earlyLeaveMinutes: 0,
        deductionMinutes: 0,
        overtimeMinutes: 240,
        overtimeType: 'sunday',
        note: '周日加班示例',
      };
    }
    return { ...common, status: 'rest', checkInAt: null, checkOutAt: null, workMinutes: 0, lateMinutes: 0, earlyLeaveMinutes: 0, deductionMinutes: 0, overtimeMinutes: 0, overtimeType: '', note: '周日轮休' };
  }

  if (day % 10 === 0 && employeeIndex % 2 === 0) {
    return {
      ...common,
      status: 'normal',
      checkInAt: localDateTime(date, '09:00'),
      checkOutAt: localDateTime(date, '13:00'),
      workMinutes: 240,
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      deductionMinutes: 0,
      overtimeMinutes: 240,
      overtimeType: 'holiday',
      note: '法定节假日加班，计入调休时间',
    };
  }

  const manualStatuses: Record<number, { status: string; note: string }> = {
    0: { status: 'sick_leave', note: '病假审批通过' },
    1: { status: 'personal_leave', note: '事假半日，按全天示例展示' },
    2: { status: 'annual_leave', note: '年假' },
    3: { status: 'business_trip', note: '市内客户现场支持' },
    4: { status: 'study', note: '外部培训学习' },
    5: { status: 'compensatory_leave', note: '加班调休' },
    6: { status: 'holiday', note: '法定节假日' },
    7: { status: 'absent', note: '待考勤管理员确认' },
  };
  const manual = manualStatuses[pattern];
  if (manual) {
    return { ...common, ...manual, checkInAt: null, checkOutAt: null, workMinutes: 0, lateMinutes: 0, earlyLeaveMinutes: 0, deductionMinutes: 0, overtimeMinutes: 0, overtimeType: '' };
  }

  const lateMinutes = pattern === 8 || pattern === 10 ? 12 + employeeIndex * 2 : 0;
  const earlyLeaveMinutes = pattern === 9 || pattern === 10 ? 20 + employeeIndex * 3 : 0;
  const checkInTime = lateMinutes > 0 ? `08:${String(lateMinutes).padStart(2, '0')}` : employeeIndex % 2 === 0 ? '07:56' : '08:00';
  const checkOutTime = earlyLeaveMinutes > 0 ? `17:${String(60 - earlyLeaveMinutes).padStart(2, '0')}` : day % 4 === 0 ? '19:30' : '18:05';
  const checkInAt = localDateTime(date, checkInTime);
  const checkOutAt = localDateTime(date, checkOutTime);
  const rawWorkMinutes = Math.round((checkOutAt.getTime() - checkInAt.getTime()) / 60_000);
  const overtimeMinutes = day % 4 === 0 && earlyLeaveMinutes === 0 ? 90 : 0;
  const status = lateMinutes > 0 && earlyLeaveMinutes > 0
    ? 'late_early'
    : lateMinutes > 0
      ? 'late'
      : earlyLeaveMinutes > 0
        ? 'early'
        : 'normal';
  return {
    ...common,
    status,
    checkInAt,
    checkOutAt,
    workMinutes: Math.max(0, rawWorkMinutes - 60),
    lateMinutes,
    earlyLeaveMinutes,
    deductionMinutes: lateMinutes + earlyLeaveMinutes,
    overtimeMinutes,
    overtimeType: overtimeMinutes > 0 ? 'workday' : '',
    note: status === 'normal' ? '' : 'Mock 异常考勤示例',
  };
}

async function ensureEmployees() {
  const employees: MockEmployee[] = [];
  for (const item of MOCK_EMPLOYEES) {
    const employee = await prisma.employeeArchive.upsert({
      where: { rosterNo: item.rosterNo },
      update: {
        name: item.name,
        company: '壹诺吉',
        department: item.department,
        title: item.title,
        hireDate: dateOnly(item.hireDate),
        employmentStatus: '在职',
        workLocation: '上海',
        archiveStatus: 'completed',
        archiveScore: 100,
        source: 'mock',
      },
      create: {
        rosterNo: item.rosterNo,
        name: item.name,
        company: '壹诺吉',
        department: item.department,
        title: item.title,
        hireDate: dateOnly(item.hireDate),
        employmentStatus: '在职',
        workLocation: '上海',
        archiveStatus: 'completed',
        archiveScore: 100,
        source: 'mock',
      },
    });
    employees.push({ ...item, id: employee.id });
  }
  return employees;
}

async function seedMonth(employees: MockEmployee[], month: string, currentMonth: string, today: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = month === currentMonth ? Math.min(Number(today.slice(-2)), daysInMonth(month)) : daysInMonth(month);
  let recordCount = 0;

  for (const [employeeIndex, employee] of employees.entries()) {
    for (let day = 1; day <= lastDay; day += 1) {
      const date = `${month}-${String(day).padStart(2, '0')}`;
      if (month === currentMonth && date === today && employeeIndex === 0) {
        await prisma.employeeAttendance.deleteMany({
          where: { employeeId: employee.id, attendanceDate: dateOnly(date) },
        });
        continue;
      }
      const values = month === currentMonth && date === today && employeeIndex === 1
        ? {
            shiftName: '标准班', scheduledStart: '08:00', scheduledEnd: '18:00', source: 'mock',
            status: 'missing', checkInAt: localDateTime(date, '08:01'), checkOutAt: null,
            workMinutes: 0, lateMinutes: 1, earlyLeaveMinutes: 0, deductionMinutes: 1,
            overtimeMinutes: 0, overtimeType: '', note: '已上班打卡，等待下班打卡',
          }
        : attendanceValues(employeeIndex, date);
      await prisma.employeeAttendance.upsert({
        where: { employeeId_attendanceDate: { employeeId: employee.id, attendanceDate: dateOnly(date) } },
        update: values,
        create: { employeeId: employee.id, attendanceDate: dateOnly(date), ...values },
      });
      recordCount += 1;
    }

    await prisma.employeeAttendanceMonth.upsert({
      where: { employeeId_year_month: { employeeId: employee.id, year, month: monthNumber } },
      update: {
        previousOvertimeBalance: employeeIndex * 1.5,
        previousCompTimeBalanceHours: employeeIndex === 2 ? 8 : employeeIndex % 2 * 4,
        previousMonthSickLeaveDays: employeeIndex % 3,
        entitledSickLeaveDays: 5,
        paidSickLeaveDays: employeeIndex % 2,
        unpaidSickLeaveDays: employeeIndex === 3 ? 0.5 : 0,
        invertedHours: employee.department === '生产部' ? 12.5 : 0,
        recoveredHours: employee.department === '生产部' ? 1.5 : 0,
        signature: employeeIndex < 2 ? employee.name : '',
        note: employeeIndex === 3 ? 'Mock 月度结余示例' : '',
        updatedById: 'attendance-mock-seed',
      },
      create: {
        employeeId: employee.id,
        year,
        month: monthNumber,
        previousOvertimeBalance: employeeIndex * 1.5,
        previousCompTimeBalanceHours: employeeIndex === 2 ? 8 : employeeIndex % 2 * 4,
        previousMonthSickLeaveDays: employeeIndex % 3,
        entitledSickLeaveDays: 5,
        paidSickLeaveDays: employeeIndex % 2,
        unpaidSickLeaveDays: employeeIndex === 3 ? 0.5 : 0,
        invertedHours: employee.department === '生产部' ? 12.5 : 0,
        recoveredHours: employee.department === '生产部' ? 1.5 : 0,
        signature: employeeIndex < 2 ? employee.name : '',
        note: employeeIndex === 3 ? 'Mock 月度结余示例' : '',
        createdById: 'attendance-mock-seed',
        updatedById: 'attendance-mock-seed',
      },
    });
  }
  return recordCount;
}

async function seedAnnualSickLeaveAlerts(employees: MockEmployee[], year: number) {
  const alertEmployee = employees[1];
  const alertDates = ['01-08', '02-09', '03-10', '04-13', '05-14', '06-15'];
  for (const monthDay of alertDates) {
    const date = `${year}-${monthDay}`;
    await prisma.employeeAttendance.upsert({
      where: { employeeId_attendanceDate: { employeeId: alertEmployee.id, attendanceDate: dateOnly(date) } },
      update: attendanceValues(1, date),
      create: { employeeId: alertEmployee.id, attendanceDate: dateOnly(date), ...attendanceValues(1, date) },
    });
    await prisma.employeeAttendance.update({
      where: { employeeId_attendanceDate: { employeeId: alertEmployee.id, attendanceDate: dateOnly(date) } },
      data: {
        status: 'sick_leave',
        checkInAt: null,
        checkOutAt: null,
        workMinutes: 0,
        lateMinutes: 0,
        earlyLeaveMinutes: 0,
        deductionMinutes: 0,
        overtimeMinutes: 0,
        overtimeType: '',
        source: 'mock',
        note: '年度带薪病假额度提醒示例',
      },
    });
  }
}

async function main() {
  const today = shanghaiDateText();
  const currentMonth = today.slice(0, 7);
  const requestedMonth = normalizeMonth(process.env.ATTENDANCE_MOCK_MONTH) || currentMonth;
  const months = [...new Set([requestedMonth, previousMonth(requestedMonth)])];
  const employees = await ensureEmployees();
  let records = 0;
  for (const month of months) records += await seedMonth(employees, month, currentMonth, today);
  await seedAnnualSickLeaveAlerts(employees, Number(requestedMonth.slice(0, 4)));
  console.log(JSON.stringify({ employees: employees.length, records, months, rosterNos: employees.map((employee) => employee.rosterNo) }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
