import { BadRequestException, Injectable } from '@nestjs/common';
import { EmployeeArchive } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { parseWeComDailyReport, WeComDailyRow } from './wecom-daily-report.parser';

/**
 * 企业微信打卡日报导入。
 *
 * 两段式：preview 只解析不落库，confirm 由前端把文件连同勾选的员工再传一次。
 * 不在服务端缓存解析结果——重解析 2000 多行是毫秒级，换来无状态、不怕重启、
 * 没有过期语义。
 */

/** 导入写入的记录来源，用于与 HR 手工补录（manual）区分。 */
export const WECOM_IMPORT_SOURCE = 'wecom_import';

/** 午休扣减门槛：在岗满 6 小时才扣 1 小时午休，与 AttendanceService 保持一致。 */
const LUNCH_BREAK_THRESHOLD_MINUTES = 360;
const LUNCH_BREAK_MINUTES = 60;
const WRITE_BATCH_SIZE = 500;

export interface ImportEmployeeGroup {
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

@Injectable()
export class AttendanceImportService {
  constructor(private readonly prisma: PrismaService) {}

  async preview(file?: { originalname?: string; buffer?: Buffer }) {
    const { report, rowsByName } = this.parse(file);
    const { matchedByName, unmatched, ambiguous } = await this.matchEmployees(
      [...rowsByName.keys()],
      this.collectDepartmentPaths(rowsByName),
      this.collectAccounts(rowsByName),
    );

    const existing = await this.loadExistingRecords(
      [...matchedByName.values()].map((employee) => employee.id),
      report.startDate,
      report.endDate,
    );

    const groups: ImportEmployeeGroup[] = [];
    for (const [name, rows] of rowsByName) {
      const employee = matchedByName.get(name);
      if (!employee) continue;
      groups.push(this.buildGroup(employee, rows, existing));
    }
    groups.sort((left, right) => left.employeeName.localeCompare(right.employeeName, 'zh-Hans-CN'));

    // 整月一次都没打过卡的人（多为不使用企微打卡的外包/派遣），全月会是旷工，
    // 默认不勾选，避免一次导入把这些人的考勤全刷成旷工。
    const noPunchGroups = groups.filter((group) => group.punchedDays === 0);
    const normalGroups = groups.filter((group) => group.punchedDays > 0);

    const halfDayLeaves = [...rowsByName.values()]
      .flat()
      .filter((row) => row.halfDayLeave && matchedByName.has(row.employeeName))
      .map((row) => ({
        attendanceDate: row.attendanceDate,
        employeeName: row.employeeName,
        status: row.status,
        note: row.note,
      }))
      .sort((left, right) => left.attendanceDate.localeCompare(right.attendanceDate));

    return {
      month: report.primaryMonth,
      startDate: report.startDate,
      endDate: report.endDate,
      months: report.months,
      yearsMissingHolidayCalendar: report.yearsMissingHolidayCalendar,
      fileName: file?.originalname ?? '',
      totalRows: report.totalRows,
      parsedRows: report.rows.length,
      groups: normalGroups,
      noPunchGroups,
      unmatched,
      ambiguous,
      halfDayLeaves,
      summary: this.buildSummary(normalGroups, report.rows),
    };
  }

  async confirm(
    file: { originalname?: string; buffer?: Buffer } | undefined,
    employeeIds: string[],
    actorId: string,
  ) {
    if (employeeIds.length === 0) throw new BadRequestException('请至少勾选一名要导入的员工');
    const { report, rowsByName } = this.parse(file);
    const { matchedByName } = await this.matchEmployees(
      [...rowsByName.keys()],
      this.collectDepartmentPaths(rowsByName),
      this.collectAccounts(rowsByName),
    );

    const selected = new Set(employeeIds);
    const targets = [...matchedByName.entries()].filter(([, employee]) => selected.has(employee.id));
    if (targets.length === 0) {
      throw new BadRequestException('勾选的员工在本次文件中没有可导入的数据，请重新预览');
    }

    const existing = await this.loadExistingRecords(
      targets.map(([, employee]) => employee.id),
      report.startDate,
      report.endDate,
    );

    const creates: Array<ReturnType<AttendanceImportService['toRecordData']>> = [];
    const overwriteIds: string[] = [];
    let manualSkipCount = 0;

    for (const [name, employee] of targets) {
      for (const row of rowsByName.get(name) ?? []) {
        const current = existing.get(this.recordKey(employee.id, row.attendanceDate));
        // HR 在页面上手工补录/修正过的记录优先于企微原始数据，不被导入覆盖。
        if (current?.source === 'manual') {
          manualSkipCount += 1;
          continue;
        }
        if (current) overwriteIds.push(current.id);
        creates.push(this.toRecordData(employee, row, actorId));
      }
    }

    // 首次按姓名匹配成功后把企微账号回填进档案，下次导入直接精确匹配，
    // 不必人工维护映射，也不再受同名和「梁虓（已离职）」这类姓名变形影响。
    const accountByName = this.collectAccounts(rowsByName);
    const backfills = targets
      .filter(([name, employee]) => !employee.wecomUserId && accountByName.get(name))
      .map(([name, employee]) => ({ id: employee.id, wecomUserId: accountByName.get(name)! }));

    // EmployeeAttendance 没有被其它表引用，删除后重建比逐条 update 少几千次往返。
    await this.prisma.$transaction(async (tx) => {
      for (let index = 0; index < overwriteIds.length; index += WRITE_BATCH_SIZE) {
        await tx.employeeAttendance.deleteMany({
          where: { id: { in: overwriteIds.slice(index, index + WRITE_BATCH_SIZE) } },
        });
      }
      for (let index = 0; index < creates.length; index += WRITE_BATCH_SIZE) {
        await tx.employeeAttendance.createMany({
          data: creates.slice(index, index + WRITE_BATCH_SIZE),
        });
      }
      for (const backfill of backfills) {
        await tx.employeeArchive.update({
          where: { id: backfill.id },
          data: { wecomUserId: backfill.wecomUserId },
        });
      }
    });

    return {
      month: report.primaryMonth,
      startDate: report.startDate,
      endDate: report.endDate,
      employeeCount: targets.length,
      importedCount: creates.length,
      createdCount: creates.length - overwriteIds.length,
      overwrittenCount: overwriteIds.length,
      manualSkipCount,
      /** 本次新建立的「档案 ↔ 企微账号」映射数 */
      linkedAccountCount: backfills.length,
    };
  }

  private parse(file?: { originalname?: string; buffer?: Buffer }) {
    if (!file?.buffer?.length) throw new BadRequestException('请选择要导入的 Excel 文件');
    const name = file.originalname ?? '';
    if (name && !/\.(xlsx|xls)$/i.test(name)) {
      throw new BadRequestException('只支持 .xlsx / .xls 格式的企业微信打卡日报');
    }
    const report = parseWeComDailyReport(file.buffer);
    const rowsByName = new Map<string, WeComDailyRow[]>();
    report.rows.forEach((row) => {
      const rows = rowsByName.get(row.employeeName) ?? [];
      rows.push(row);
      rowsByName.set(row.employeeName, rows);
    });
    return { report, rowsByName };
  }

  /** 姓名 → 企微账号。同名两人账号不同时无法认定归属，留空走部门消歧。 */
  private collectAccounts(rowsByName: Map<string, WeComDailyRow[]>) {
    return new Map(
      [...rowsByName].map(([name, rows]) => {
        const accounts = [...new Set(rows.map((row) => row.account).filter(Boolean))];
        return [name, accounts.length === 1 ? accounts[0]! : ''];
      }),
    );
  }

  /** 姓名 → 该姓名在文件里出现过的企微部门路径（同名两人会有两条）。 */
  private collectDepartmentPaths(rowsByName: Map<string, WeComDailyRow[]>) {
    return new Map(
      [...rowsByName].map(([name, rows]) => [
        name,
        [...new Set(rows.map((row) => row.departmentPath).filter(Boolean))],
      ]),
    );
  }

  /**
   * 企微日报的「工号」列实测整列为空，只能按姓名匹配档案。
   * 同名多人再用部门消歧：企微部门路径的任一层级命中档案部门即可认定，都命中不了
   * 或命中多个时才判为无法判定，交由预览页提示人工处理。
   */
  private async matchEmployees(
    names: string[],
    departmentByName: Map<string, string[]>,
    accountByName: Map<string, string>,
  ) {
    const accounts = [...accountByName.values()].filter(Boolean);
    const employees = await this.prisma.employeeArchive.findMany({
      where: {
        OR: [
          { name: { in: names } },
          ...(accounts.length > 0 ? [{ wecomUserId: { in: accounts } }] : []),
        ],
      },
      select: {
        id: true,
        name: true,
        rosterNo: true,
        department: true,
        employmentStatus: true,
        wecomUserId: true,
        deductsInvertedHours: true,
      },
    });

    // 已回填过企微账号的，直接精确命中，绕开姓名与同名问题
    const byAccount = new Map(
      employees.filter((employee) => employee.wecomUserId).map((employee) => [employee.wecomUserId, employee]),
    );

    const byName = new Map<string, typeof employees>();
    employees.forEach((employee) => {
      const list = byName.get(employee.name) ?? [];
      list.push(employee);
      byName.set(employee.name, list);
    });

    const matchedByName = new Map<string, (typeof employees)[number]>();
    const unmatched: string[] = [];
    const ambiguous: Array<{ name: string; candidates: Array<{ rosterNo: string; department: string }> }> = [];

    names.forEach((name) => {
      const account = accountByName.get(name) ?? '';
      const exact = account ? byAccount.get(account) : undefined;
      if (exact && this.isAttendanceEmployee(exact.employmentStatus)) {
        matchedByName.set(name, exact);
        return;
      }
      const candidates = (byName.get(name) ?? []).filter((employee) =>
        this.isAttendanceEmployee(employee.employmentStatus),
      );
      if (candidates.length === 1) {
        matchedByName.set(name, candidates[0]);
        return;
      }
      if (candidates.length === 0) {
        unmatched.push(name);
        return;
      }
      const byDepartment = this.narrowByDepartment(candidates, departmentByName.get(name) ?? []);
      if (byDepartment) {
        matchedByName.set(name, byDepartment);
        return;
      }
      ambiguous.push({
        name,
        candidates: candidates.map((employee) => ({
          rosterNo: employee.rosterNo,
          department: employee.department,
        })),
      });
    });

    return { matchedByName, unmatched, ambiguous };
  }

  /**
   * 用企微部门给同名候选人消歧。企微部门是「公司/生产中心/产线」这样的多级路径，
   * 档案里存的通常是其中某一级，所以逐级比对；恰好命中一人才算数。
   */
  private narrowByDepartment<T extends { department: string }>(candidates: T[], departmentPaths: string[]) {
    // 分号分隔多部门、斜杠分隔层级，两种都要拆开才能逐级比对
    const segments = new Set(
      departmentPaths.flatMap((path) => path.split(/[;/]/).map((part) => part.trim()).filter(Boolean)),
    );
    if (segments.size === 0) return undefined;
    const hits = candidates.filter((candidate) => candidate.department && segments.has(candidate.department));
    return hits.length === 1 ? hits[0] : undefined;
  }

  /** 只加载文件覆盖到的日期区间，区间外的历史记录不受本次导入影响。 */
  private async loadExistingRecords(employeeIds: string[], startDate: string, endDate: string) {
    if (employeeIds.length === 0) return new Map<string, { id: string; source: string }>();
    const records = await this.prisma.employeeAttendance.findMany({
      where: {
        employeeId: { in: employeeIds },
        attendanceDate: {
          gte: new Date(`${startDate}T00:00:00.000Z`),
          lte: new Date(`${endDate}T00:00:00.000Z`),
        },
      },
      select: { id: true, employeeId: true, attendanceDate: true, source: true },
    });
    return new Map(
      records.map((record) => [
        this.recordKey(record.employeeId, record.attendanceDate.toISOString().slice(0, 10)),
        { id: record.id, source: record.source },
      ]),
    );
  }

  private buildGroup(
    employee: Pick<EmployeeArchive, 'id' | 'name' | 'rosterNo' | 'department'>,
    rows: WeComDailyRow[],
    existing: Map<string, { id: string; source: string }>,
  ): ImportEmployeeGroup {
    let createCount = 0;
    let overwriteCount = 0;
    let manualSkipCount = 0;
    rows.forEach((row) => {
      const current = existing.get(this.recordKey(employee.id, row.attendanceDate));
      if (!current) createCount += 1;
      else if (current.source === 'manual') manualSkipCount += 1;
      else overwriteCount += 1;
    });

    const countBy = (predicate: (row: WeComDailyRow) => boolean) => rows.filter(predicate).length;
    return {
      employeeId: employee.id,
      employeeName: employee.name,
      rosterNo: employee.rosterNo,
      department: employee.department,
      wecomDepartment: rows[0]?.department ?? '',
      rowCount: rows.length,
      punchedDays: countBy((row) => row.hasPunch),
      absentDays: countBy((row) => row.status === 'absent'),
      leaveDays: countBy((row) =>
        ['leave', 'sick_leave', 'personal_leave', 'annual_leave', 'paternity_leave', 'compensatory_leave'].includes(
          row.status,
        ),
      ),
      restDays: countBy((row) => row.status === 'rest'),
      overtimeHours: this.round(rows.reduce((total, row) => total + row.overtimeMinutes, 0) / 60),
      createCount,
      overwriteCount,
      manualSkipCount,
    };
  }

  private buildSummary(groups: ImportEmployeeGroup[], rows: WeComDailyRow[]) {
    const countable = rows.filter((row) => row.overtimeMinutes > 0);
    const raw = rows.filter((row) => row.rawOvertimeHours > 0);
    return {
      employeeCount: groups.length,
      rowCount: groups.reduce((total, group) => total + group.rowCount, 0),
      createCount: groups.reduce((total, group) => total + group.createCount, 0),
      overwriteCount: groups.reduce((total, group) => total + group.overwriteCount, 0),
      manualSkipCount: groups.reduce((total, group) => total + group.manualSkipCount, 0),
      overtimeRows: countable.length,
      overtimeHours: this.round(countable.reduce((total, row) => total + row.overtimeMinutes, 0) / 60),
      // 阈值过滤掉的加班量，让 HR 知道有多少被当作打卡毛刺丢弃
      filteredOvertimeRows: raw.length - countable.length,
      filteredOvertimeHours: this.round(
        raw.reduce((total, row) => total + row.rawOvertimeHours, 0) -
          countable.reduce((total, row) => total + row.rawOvertimeHours, 0),
      ),
    };
  }

  /**
   * 直接采用企微判定好的状态与迟到/早退分钟，不用打卡时间重算：企微的判定包含了
   * 企业在后台配置的弹性打卡、宽限期等规则，本地重算会与 HR 手上的企微报表对不上。
   */
  private toRecordData(
    employee: { id: string; deductsInvertedHours: boolean },
    row: WeComDailyRow,
    actorId: string,
  ) {
    const checkInAt = row.checkInTime ? this.dateTimeValue(row.attendanceDate, row.checkInTime) : null;
    const checkOutAt = row.checkOutTime ? this.dateTimeValue(row.attendanceDate, row.checkOutTime) : null;
    return {
      employeeId: employee.id,
      attendanceDate: new Date(`${row.attendanceDate}T00:00:00.000Z`),
      shiftName: row.shiftName,
      scheduledStart: row.scheduledStart,
      scheduledEnd: row.scheduledEnd,
      checkInAt,
      checkOutAt,
      status: row.status,
      workMinutes: this.workMinutes(checkInAt, checkOutAt),
      lateMinutes: row.lateMinutes,
      earlyLeaveMinutes: row.earlyLeaveMinutes,
      // 企微日报只提供迟到 / 早退异常，无法证明是公司安排的提前放工，因此不自动生成倒挂扣时。
      // 如确有倒挂，由 HR 在考勤修正中明确填写，避免与迟到 / 早退重复扣减。
      deductionMinutes: 0,
      overtimeMinutes: row.overtimeMinutes,
      overtimeType: row.overtimeType,
      leaveDayFraction: row.leaveDayFraction,
      source: WECOM_IMPORT_SOURCE,
      note: row.note,
      createdById: actorId,
      updatedById: actorId,
    };
  }

  private workMinutes(checkInAt: Date | null, checkOutAt: Date | null) {
    if (!checkInAt || !checkOutAt) return 0;
    const raw = Math.max(0, Math.round((checkOutAt.getTime() - checkInAt.getTime()) / 60_000));
    return Math.max(0, raw - (raw >= LUNCH_BREAK_THRESHOLD_MINUTES ? LUNCH_BREAK_MINUTES : 0));
  }

  private recordKey(employeeId: string, attendanceDate: string) {
    return `${employeeId}|${attendanceDate}`;
  }

  private dateTimeValue(date: string, time: string) {
    return new Date(`${date}T${time}:00+08:00`);
  }

  private isAttendanceEmployee(status: string) {
    return !/(离职|待入职|停薪)/.test(status);
  }

  private round(value: number) {
    return Number(value.toFixed(2));
  }
}
