import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EmployeeArchive, EmployeeAttendance, EmployeeAttendanceMonth } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import {
  AttendanceDailyQueryDto,
  AttendanceEmployeeDetailQueryDto,
  AttendanceMonthlyQueryDto,
  ClockAttendanceDto,
  MANUAL_ATTENDANCE_STATUSES,
  SaveAttendanceMonthDto,
  SaveAttendanceRecordDto,
} from './dto/attendance.dto';

const employeeSelect = {
  id: true,
  rosterNo: true,
  name: true,
  company: true,
  department: true,
  title: true,
  employmentStatus: true,
} as const;

type AttendanceEmployee = Pick<
  EmployeeArchive,
  'id' | 'rosterNo' | 'name' | 'company' | 'department' | 'title' | 'employmentStatus'
>;

type ManualAttendanceStatus = (typeof MANUAL_ATTENDANCE_STATUSES)[number];

const ANNUAL_PAID_SICK_LEAVE_DAYS = 5;
const COMPENSATORY_LEAVE_HOURS_PER_DAY = 8;

@Injectable()
export class AttendanceService {
  constructor(private readonly prisma: PrismaService) {}

  async daily(query: AttendanceDailyQueryDto) {
    const date = this.normalizeDate(query.date) || this.todayInShanghai();
    const attendanceDate = this.dateValue(date);
    const [allEmployees, records] = await Promise.all([
      this.prisma.employeeArchive.findMany({
        select: employeeSelect,
        orderBy: [{ department: 'asc' }, { rosterNo: 'asc' }],
      }),
      this.prisma.employeeAttendance.findMany({
        where: { attendanceDate },
        include: { employee: { select: employeeSelect } },
      }),
    ]);

    const employees = allEmployees.filter((employee) => this.isAttendanceEmployee(employee.employmentStatus));
    const recordByEmployee = new Map(records.map((record) => [record.employeeId, record]));
    const allItems = employees.map((employee) => {
      const record = recordByEmployee.get(employee.id);
      return record
        ? this.serialize(record, employee)
        : this.emptyRecord(employee, date);
    });
    const summary = this.buildSummary(allItems);
    const search = query.search?.trim().toLowerCase();
    const filtered = allItems.filter((item) => {
      if (query.department && item.employee.department !== query.department) return false;
      if (query.status && item.status !== query.status) return false;
      if (!search) return true;
      return [item.employee.name, item.employee.rosterNo, item.employee.department, item.employee.title]
        .some((value) => value.toLowerCase().includes(search));
    });
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 100;
    const start = (page - 1) * pageSize;

    return {
      date,
      summary,
      departments: [...new Set(employees.map((employee) => employee.department).filter(Boolean))].sort(),
      items: filtered.slice(start, start + pageSize),
      total: filtered.length,
      page,
      pageSize,
    };
  }

  async monthly(query: AttendanceMonthlyQueryDto) {
    const month = this.normalizeMonth(query.month) || this.todayInShanghai().slice(0, 7);
    const [yearText, monthText] = month.split('-');
    const year = Number(yearText);
    const monthNumber = Number(monthText);
    const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    const monthStart = this.dateValue(`${month}-01`);
    const nextMonth = monthNumber === 12
      ? this.dateValue(`${year + 1}-01-01`)
      : this.dateValue(`${year}-${String(monthNumber + 1).padStart(2, '0')}-01`);
    const yearStart = this.dateValue(`${year}-01-01`);
    const nextYearStart = this.dateValue(`${year + 1}-01-01`);
    const [allEmployees, records, monthSettings, annualSickLeaveRecords, productionDepartment] = await Promise.all([
      this.prisma.employeeArchive.findMany({
        select: employeeSelect,
        orderBy: [{ department: 'asc' }, { rosterNo: 'asc' }],
      }),
      this.prisma.employeeAttendance.findMany({
        where: { attendanceDate: { gte: monthStart, lt: nextMonth } },
        include: { employee: { select: employeeSelect } },
        orderBy: { attendanceDate: 'asc' },
      }),
      this.prisma.employeeAttendanceMonth.findMany({ where: { year, month: monthNumber } }),
      this.prisma.employeeAttendance.findMany({
        where: {
          attendanceDate: { gte: yearStart, lt: nextYearStart },
          status: 'sick_leave',
        },
        select: { employeeId: true },
      }),
      this.prisma.department.findUnique({
        where: { code: 'PRODUCTION' },
        select: { name: true },
      }),
    ]);

    const departments = [...new Set(allEmployees
      .filter((employee) => this.isAttendanceEmployee(employee.employmentStatus))
      .map((employee) => employee.department)
      .filter(Boolean))].sort();
    const search = query.search?.trim().toLowerCase();
    const employees = allEmployees.filter((employee) => {
      if (!this.isAttendanceEmployee(employee.employmentStatus)) return false;
      if (query.department && employee.department !== query.department) return false;
      if (!search) return true;
      return [employee.name, employee.rosterNo, employee.department, employee.title]
        .some((value) => value.toLowerCase().includes(search));
    });
    const recordsByEmployee = new Map<string, EmployeeAttendance[]>();
    records.forEach((record) => {
      const current = recordsByEmployee.get(record.employeeId) ?? [];
      current.push(record);
      recordsByEmployee.set(record.employeeId, current);
    });
    const monthSettingByEmployee = new Map(monthSettings.map((setting) => [setting.employeeId, setting]));
    const annualSickLeaveByEmployee = annualSickLeaveRecords.reduce((result, record) => {
      result.set(record.employeeId, (result.get(record.employeeId) ?? 0) + 1);
      return result;
    }, new Map<string, number>());

    const items = employees.map((employee) => {
      const employeeRecords = (recordsByEmployee.get(employee.id) ?? [])
        .map((record) => this.serialize(record, employee));
      const summary = this.buildMonthlyEmployeeSummary(year, monthNumber, daysInMonth, employeeRecords);
      const adjustment = monthSettingByEmployee.get(employee.id) ?? this.emptyMonthAdjustment(employee.id, month);
      return {
        employee,
        records: employeeRecords,
        summary,
        adjustment,
        rules: this.buildRuleSummary(
          employee,
          summary,
          adjustment,
          annualSickLeaveByEmployee.get(employee.id) ?? 0,
          employee.department === productionDepartment?.name,
        ),
      };
    });
    const monthlySummary = items.reduce((result, item) => ({
      employeeCount: result.employeeCount + 1,
      expectedDays: result.expectedDays + item.summary.expectedDays,
      normalDays: result.normalDays + item.summary.normalDays,
      leaveDays: result.leaveDays + item.summary.leaveDays,
      exceptionCount: result.exceptionCount + item.summary.lateEarlyCount + item.summary.absentDays + item.summary.missingDays,
      overtimeHours: Number((result.overtimeHours + item.summary.overtimeHours).toFixed(2)),
      countableOvertimeHours: Number((result.countableOvertimeHours + item.rules.countableOvertimeHours).toFixed(2)),
      compTimeEarnedHours: Number((result.compTimeEarnedHours + item.rules.compTimeEarnedHours).toFixed(2)),
      sickLeaveAlertCount: result.sickLeaveAlertCount + (item.rules.excessSickLeaveDays > 0 ? 1 : 0),
      completedDays: result.completedDays + item.summary.completedDays,
    }), {
      employeeCount: 0,
      expectedDays: 0,
      normalDays: 0,
      leaveDays: 0,
      exceptionCount: 0,
      overtimeHours: 0,
      countableOvertimeHours: 0,
      compTimeEarnedHours: 0,
      sickLeaveAlertCount: 0,
      completedDays: 0,
    });

    return {
      month,
      year,
      monthNumber,
      daysInMonth,
      departments,
      items,
      total: items.length,
      summary: monthlySummary,
    };
  }

  async overtime(query: AttendanceMonthlyQueryDto) {
    const data = await this.monthly(query);
    return {
      month: data.month,
      departments: data.departments,
      total: data.items.length,
      items: data.items.map((item) => ({
        employee: item.employee,
        summary: item.summary,
        adjustment: item.adjustment,
        rules: item.rules,
      })),
      summary: {
        employeeCount: data.items.length,
        rawOvertimeHours: data.summary.overtimeHours,
        countableOvertimeHours: data.summary.countableOvertimeHours,
        compTimeEarnedHours: data.summary.compTimeEarnedHours,
        invertedOffsetHours: Number(data.items.reduce((total, item) => total + item.rules.invertedOffsetHours, 0).toFixed(2)),
      },
    };
  }

  async employeeDetail(employeeId: string, query: AttendanceEmployeeDetailQueryDto) {
    const employee = await this.prisma.employeeArchive.findUnique({
      where: { id: employeeId },
      select: employeeSelect,
    });
    if (!employee || !this.isAttendanceEmployee(employee.employmentStatus)) {
      throw new NotFoundException('考勤人员不存在');
    }
    const data = await this.monthly({ month: query.month });
    const item = data.items.find((candidate) => candidate.employee.id === employeeId);
    if (!item) throw new NotFoundException('考勤人员不存在');
    return {
      month: data.month,
      year: data.year,
      monthNumber: data.monthNumber,
      daysInMonth: data.daysInMonth,
      ...item,
    };
  }

  async saveMonth(dto: SaveAttendanceMonthDto, actorId: string) {
    const employee = await this.prisma.employeeArchive.findUnique({
      where: { id: dto.employeeId },
      select: employeeSelect,
    });
    if (!employee) throw new NotFoundException('员工不存在，请先维护员工入职归档');
    const month = this.normalizeMonth(dto.month);
    if (!month) throw new BadRequestException('考勤月份无效');
    const year = Number(month.slice(0, 4));
    const monthNumber = Number(month.slice(5, 7));
    const values = {
      previousOvertimeBalance: dto.previousOvertimeBalance ?? 0,
      previousCompTimeBalanceHours: dto.previousCompTimeBalanceHours ?? 0,
      previousMonthSickLeaveDays: dto.previousMonthSickLeaveDays ?? 0,
      entitledSickLeaveDays: ANNUAL_PAID_SICK_LEAVE_DAYS,
      paidSickLeaveDays: dto.paidSickLeaveDays ?? 0,
      unpaidSickLeaveDays: dto.unpaidSickLeaveDays ?? 0,
      invertedHours: dto.invertedHours ?? 0,
      recoveredHours: dto.recoveredHours ?? 0,
      signature: dto.signature?.trim() ?? '',
      note: dto.note?.trim() ?? '',
      updatedById: actorId,
    };
    return this.prisma.employeeAttendanceMonth.upsert({
      where: { employeeId_year_month: { employeeId: dto.employeeId, year, month: monthNumber } },
      create: {
        employeeId: dto.employeeId,
        year,
        month: monthNumber,
        ...values,
        createdById: actorId,
      },
      update: values,
    });
  }

  async save(dto: SaveAttendanceRecordDto, actorId: string) {
    const employee = await this.prisma.employeeArchive.findUnique({
      where: { id: dto.employeeId },
      select: employeeSelect,
    });
    if (!employee) throw new NotFoundException('员工不存在，请先维护员工入职归档');

    const attendanceDate = this.dateValue(dto.attendanceDate);
    const scheduledStart = dto.scheduledStart ?? '08:00';
    const scheduledEnd = dto.scheduledEnd ?? '18:00';
    const checkInAt = dto.checkInTime ? this.dateTimeValue(dto.attendanceDate, dto.checkInTime) : null;
    const checkOutAt = dto.checkOutTime ? this.dateTimeValue(dto.attendanceDate, dto.checkOutTime) : null;
    if (checkInAt && checkOutAt && checkOutAt <= checkInAt) {
      throw new BadRequestException('下班时间必须晚于上班时间');
    }

    const metrics = this.calculateMetrics(
      dto.attendanceDate,
      scheduledStart,
      scheduledEnd,
      checkInAt,
      checkOutAt,
      dto.manualStatus ?? 'auto',
    );
    const deductionMinutes = dto.deductionMinutes ?? (metrics.lateMinutes + metrics.earlyLeaveMinutes);
    const overtimeMinutes = dto.overtimeMinutes ?? 0;
    const overtimeType = overtimeMinutes > 0
      ? dto.overtimeType ?? this.defaultOvertimeType(dto.attendanceDate, dto.manualStatus)
      : '';
    const record = await this.prisma.employeeAttendance.upsert({
      where: { employeeId_attendanceDate: { employeeId: dto.employeeId, attendanceDate } },
      create: {
        employeeId: dto.employeeId,
        attendanceDate,
        shiftName: dto.shiftName?.trim() || '标准班',
        scheduledStart,
        scheduledEnd,
        checkInAt,
        checkOutAt,
        ...metrics,
        deductionMinutes,
        overtimeMinutes,
        overtimeType,
        source: 'manual',
        note: dto.note?.trim() ?? '',
        createdById: actorId,
        updatedById: actorId,
      },
      update: {
        shiftName: dto.shiftName?.trim() || '标准班',
        scheduledStart,
        scheduledEnd,
        checkInAt,
        checkOutAt,
        ...metrics,
        deductionMinutes,
        overtimeMinutes,
        overtimeType,
        source: 'manual',
        note: dto.note?.trim() ?? '',
        updatedById: actorId,
      },
    });
    return this.serialize(record, employee);
  }

  async clock(dto: ClockAttendanceDto, actorId: string) {
    const now = dto.timestamp ? new Date(dto.timestamp) : new Date();
    if (Number.isNaN(now.getTime())) throw new BadRequestException('打卡时间无效');
    const { date, time } = this.shanghaiDateTime(now);
    const attendanceDate = this.dateValue(date);
    const existing = await this.prisma.employeeAttendance.findUnique({
      where: { employeeId_attendanceDate: { employeeId: dto.employeeId, attendanceDate } },
    });
    if (dto.type === 'check-in' && existing?.checkInAt) {
      throw new ConflictException('当天已经完成上班打卡');
    }
    if (dto.type === 'check-out' && !existing?.checkInAt) {
      throw new BadRequestException('请先完成上班打卡');
    }
    if (dto.type === 'check-out' && existing?.checkOutAt) {
      throw new ConflictException('当天已经完成下班打卡');
    }

    return this.save({
      employeeId: dto.employeeId,
      attendanceDate: date,
      shiftName: existing?.shiftName ?? '标准班',
      scheduledStart: existing?.scheduledStart ?? '08:00',
      scheduledEnd: existing?.scheduledEnd ?? '18:00',
      checkInTime: dto.type === 'check-in' ? time : this.timeValue(existing?.checkInAt),
      checkOutTime: dto.type === 'check-out' ? time : this.timeValue(existing?.checkOutAt),
      manualStatus: 'auto',
      deductionMinutes: existing?.deductionMinutes ?? undefined,
      overtimeMinutes: existing?.overtimeMinutes ?? undefined,
      overtimeType: existing?.overtimeType as 'workday' | 'sunday' | 'holiday' || undefined,
      note: existing?.note ?? '',
    }, actorId);
  }

  async remove(id: string) {
    const result = await this.prisma.employeeAttendance.deleteMany({ where: { id } });
    if (result.count === 0) throw new NotFoundException('考勤记录不存在');
    return { success: true, id };
  }

  private calculateMetrics(
    date: string,
    scheduledStart: string,
    scheduledEnd: string,
    checkInAt: Date | null,
    checkOutAt: Date | null,
    manualStatus: ManualAttendanceStatus,
  ) {
    if (manualStatus !== 'auto') {
      return { status: manualStatus, workMinutes: 0, lateMinutes: 0, earlyLeaveMinutes: 0 };
    }
    const scheduledStartAt = this.dateTimeValue(date, scheduledStart);
    const scheduledEndAt = this.dateTimeValue(date, scheduledEnd);
    const lateMinutes = checkInAt
      ? Math.max(0, Math.round((checkInAt.getTime() - scheduledStartAt.getTime()) / 60_000))
      : 0;
    const earlyLeaveMinutes = checkOutAt
      ? Math.max(0, Math.round((scheduledEndAt.getTime() - checkOutAt.getTime()) / 60_000))
      : 0;
    const rawWorkMinutes = checkInAt && checkOutAt
      ? Math.max(0, Math.round((checkOutAt.getTime() - checkInAt.getTime()) / 60_000))
      : 0;
    const workMinutes = Math.max(0, rawWorkMinutes - (rawWorkMinutes >= 360 ? 60 : 0));
    let status = 'missing';
    if (checkInAt && checkOutAt) {
      status = lateMinutes > 0 && earlyLeaveMinutes > 0
        ? 'late_early'
        : lateMinutes > 0
          ? 'late'
          : earlyLeaveMinutes > 0
            ? 'early'
            : 'normal';
    }
    return { status, workMinutes, lateMinutes, earlyLeaveMinutes };
  }

  private buildSummary(items: ReturnType<AttendanceService['emptyRecord']>[]) {
    const count = (statuses: string[]) => items.filter((item) => statuses.includes(item.status)).length;
    const completed = items.filter((item) => item.id && item.status !== 'missing').length;
    return {
      expected: items.length,
      checkedIn: items.filter((item) => Boolean(item.checkInTime)).length,
      normal: count(['normal']),
      late: count(['late', 'late_early']),
      early: count(['early', 'late_early']),
      exceptions: count(['late', 'early', 'late_early']),
      leave: count(['leave', 'business_trip', 'rest', 'holiday', 'sick_leave', 'personal_leave', 'annual_leave', 'paternity_leave', 'compensatory_leave']),
      absent: count(['absent', 'missing']),
      completed,
      completionRate: items.length > 0 ? Math.round((completed / items.length) * 100) : 0,
    };
  }

  private emptyRecord(employee: AttendanceEmployee, date: string) {
    return {
      id: null as string | null,
      employeeId: employee.id,
      attendanceDate: date,
      shiftName: '标准班',
      scheduledStart: '08:00',
      scheduledEnd: '18:00',
      checkInTime: '',
      checkOutTime: '',
      status: 'missing',
      workMinutes: 0,
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      deductionMinutes: 0,
      overtimeMinutes: 0,
      overtimeType: '',
      source: '',
      note: '',
      employee,
    };
  }

  private serialize(record: EmployeeAttendance, employee: AttendanceEmployee) {
    return {
      id: record.id,
      employeeId: record.employeeId,
      attendanceDate: this.dateText(record.attendanceDate),
      shiftName: record.shiftName,
      scheduledStart: record.scheduledStart,
      scheduledEnd: record.scheduledEnd,
      checkInTime: this.timeValue(record.checkInAt),
      checkOutTime: this.timeValue(record.checkOutAt),
      status: record.status,
      workMinutes: record.workMinutes,
      lateMinutes: record.lateMinutes,
      earlyLeaveMinutes: record.earlyLeaveMinutes,
      deductionMinutes: record.deductionMinutes,
      overtimeMinutes: record.overtimeMinutes,
      overtimeType: record.overtimeType,
      source: record.source,
      note: record.note,
      employee,
    };
  }

  private isAttendanceEmployee(status: string) {
    return !/(离职|待入职|停薪)/.test(status);
  }

  private normalizeDate(value?: string) {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
    const date = this.dateValue(value);
    return this.dateText(date) === value ? value : '';
  }

  private normalizeMonth(value?: string) {
    if (!value || !/^\d{4}-\d{2}$/.test(value)) return '';
    const monthNumber = Number(value.slice(5, 7));
    return monthNumber >= 1 && monthNumber <= 12 ? value : '';
  }

  private buildMonthlyEmployeeSummary(
    year: number,
    monthNumber: number,
    daysInMonth: number,
    records: ReturnType<AttendanceService['emptyRecord']>[],
  ) {
    const count = (statuses: string[]) => records.filter((record) => statuses.includes(record.status)).length;
    const recordByDate = new Map(records.map((record) => [record.attendanceDate, record]));
    let expectedDays = 0;
    let missingDays = 0;
    const today = this.todayInShanghai();
    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = `${year}-${String(monthNumber).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const record = recordByDate.get(date);
      const sunday = new Date(`${date}T00:00:00Z`).getUTCDay() === 0;
      const excluded = record && ['rest', 'holiday', 'compensatory_leave'].includes(record.status);
      if (sunday || excluded) continue;
      expectedDays += 1;
      if (date <= today && (!record || record.status === 'missing')) missingDays += 1;
    }
    const hours = (type?: string) => Number((records
      .filter((record) => !type || record.overtimeType === type)
      .reduce((total, record) => total + record.overtimeMinutes, 0) / 60).toFixed(2));
    const leaveDays = count(['leave', 'holiday', 'sick_leave', 'personal_leave', 'annual_leave', 'paternity_leave', 'compensatory_leave']);
    return {
      expectedDays,
      normalDays: count(['normal', 'late', 'early', 'late_early']),
      restDays: count(['rest']),
      holidayDays: count(['leave', 'holiday', 'compensatory_leave']),
      sickLeaveDays: count(['sick_leave']),
      personalLeaveDays: count(['personal_leave']),
      annualLeaveDays: count(['annual_leave']),
      absentDays: count(['absent']),
      lateEarlyCount: count(['late', 'early', 'late_early']),
      paternityLeaveDays: count(['paternity_leave']),
      compensatoryLeaveDays: count(['compensatory_leave']),
      businessTripDays: count(['business_trip']),
      studyDays: count(['study']),
      workdayOvertimeHours: hours('workday'),
      sundayOvertimeHours: hours('sunday'),
      holidayOvertimeHours: hours('holiday'),
      overtimeHours: hours(),
      deductionHours: Number((records.reduce((total, record) => total + record.deductionMinutes, 0) / 60).toFixed(2)),
      deductionMinutes: records.reduce((total, record) => total + record.deductionMinutes, 0),
      leaveDays,
      completedDays: records.filter((record) => record.status !== 'missing').length,
      missingDays,
    };
  }

  private defaultOvertimeType(date: string, status?: ManualAttendanceStatus) {
    if (status === 'holiday') return 'holiday';
    return new Date(`${date}T00:00:00Z`).getUTCDay() === 0 ? 'sunday' : 'workday';
  }

  private buildRuleSummary(
    employee: AttendanceEmployee,
    summary: ReturnType<AttendanceService['buildMonthlyEmployeeSummary']>,
    adjustment: EmployeeAttendanceMonth | ReturnType<AttendanceService['emptyMonthAdjustment']>,
    annualSickLeaveDays: number,
    isProductionDepartment: boolean,
  ) {
    const round = (value: number) => Number(value.toFixed(2));
    const productionWithInvertedHours = isProductionDepartment && adjustment.invertedHours > 0;
    const availableInvertedHours = Math.max(0, adjustment.invertedHours - adjustment.recoveredHours);
    const invertedOffsetHours = productionWithInvertedHours
      ? Math.min(availableInvertedHours, summary.workdayOvertimeHours)
      : 0;
    const remainingInvertedHours = Math.max(0, availableInvertedHours - invertedOffsetHours);
    const countableWorkdayOvertimeHours = Math.max(0, summary.workdayOvertimeHours - invertedOffsetHours);
    const compTimeEarnedHours = summary.holidayOvertimeHours;
    const compTimeUsedHours = summary.compensatoryLeaveDays * COMPENSATORY_LEAVE_HOURS_PER_DAY;
    const compTimeBalanceHours = adjustment.previousCompTimeBalanceHours + compTimeEarnedHours - compTimeUsedHours;
    const excessSickLeaveDays = Math.max(0, annualSickLeaveDays - ANNUAL_PAID_SICK_LEAVE_DAYS);
    const alerts: string[] = [];
    if (excessSickLeaveDays > 0) alerts.push(`年度带薪病假已超出 ${round(excessSickLeaveDays)} 天`);
    if (productionWithInvertedHours && remainingInvertedHours > 0) alerts.push(`尚有 ${round(remainingInvertedHours)} 小时倒挂工时待抵扣`);
    if (compTimeBalanceHours < 0) alerts.push(`调休时间透支 ${round(Math.abs(compTimeBalanceHours))} 小时`);

    return {
      ruleType: productionWithInvertedHours ? 'production_inverted' as const : 'regular' as const,
      annualPaidSickLeaveAllowanceDays: ANNUAL_PAID_SICK_LEAVE_DAYS,
      annualSickLeaveDays: round(annualSickLeaveDays),
      paidSickLeaveUsedDays: round(Math.min(annualSickLeaveDays, ANNUAL_PAID_SICK_LEAVE_DAYS)),
      excessSickLeaveDays: round(excessSickLeaveDays),
      startingInvertedHours: round(adjustment.invertedHours),
      manuallyRecoveredHours: round(adjustment.recoveredHours),
      availableInvertedHours: round(availableInvertedHours),
      invertedOffsetHours: round(invertedOffsetHours),
      remainingInvertedHours: round(remainingInvertedHours),
      countableWorkdayOvertimeHours: round(countableWorkdayOvertimeHours),
      sundayOvertimeHours: summary.sundayOvertimeHours,
      holidayOvertimeHours: summary.holidayOvertimeHours,
      countableOvertimeHours: round(countableWorkdayOvertimeHours + summary.sundayOvertimeHours),
      previousCompTimeBalanceHours: round(adjustment.previousCompTimeBalanceHours),
      compTimeEarnedHours: round(compTimeEarnedHours),
      compTimeUsedHours: round(compTimeUsedHours),
      compTimeBalanceHours: round(compTimeBalanceHours),
      alerts,
    };
  }

  private emptyMonthAdjustment(employeeId: string, month: string) {
    return {
      id: null as string | null,
      employeeId,
      year: Number(month.slice(0, 4)),
      month: Number(month.slice(5, 7)),
      previousOvertimeBalance: 0,
      previousCompTimeBalanceHours: 0,
      previousMonthSickLeaveDays: 0,
      entitledSickLeaveDays: ANNUAL_PAID_SICK_LEAVE_DAYS,
      paidSickLeaveDays: 0,
      unpaidSickLeaveDays: 0,
      invertedHours: 0,
      recoveredHours: 0,
      signature: '',
      note: '',
    };
  }

  private dateValue(value: string) {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) throw new BadRequestException('考勤日期无效');
    return date;
  }

  private dateTimeValue(date: string, time: string) {
    const value = new Date(`${date}T${time}:00+08:00`);
    if (Number.isNaN(value.getTime())) throw new BadRequestException('考勤时间无效');
    return value;
  }

  private dateText(value: Date) {
    return value.toISOString().slice(0, 10);
  }

  private timeValue(value?: Date | null) {
    if (!value) return '';
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(value);
  }

  private todayInShanghai() {
    return this.shanghaiDateTime(new Date()).date;
  }

  private shanghaiDateTime(value: Date) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(value);
    const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
    return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
  }
}
