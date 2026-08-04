import { BadRequestException } from '@nestjs/common';
import * as XLSX from 'xlsx';

import { ATTENDANCE_STATUSES, ATTENDANCE_OVERTIME_TYPES } from './dto/attendance.dto';
import { hasHolidayCalendar, isStatutoryHoliday } from './statutory-holidays.constants';

/**
 * 企业微信「上下班打卡 - 日报」导出解析。
 *
 * 只读第一个工作表「概况统计与打卡明细」：一人一天一行，列足够推导出本系统
 * EmployeeAttendance 的全部字段。第二个工作表「打卡详情」是同一批数据按上下班
 * 拆成两行，信息更少，不使用。
 *
 * 列定位一律按表头文本，不按下标——各企业启用的假期类型不同，列数会变。
 * 前三列（日期/姓名/账号）企微导出时表头是空的，按位置固定。
 */

const SHEET_NAME = '概况统计与打卡明细';
const DATE_COLUMN = 0;
const NAME_COLUMN = 1;
const ACCOUNT_COLUMN = 2;

/**
 * 加班时长低于此值视为打卡毛刺，不计入加班。
 * 企微的「加班时长」= 实际在岗 − 标准工时，早到十几分钟也会记成加班：实测 2351 行
 * 中 1292 行有加班，其中 891 行（69%）在半小时以内，含大量 18:00 正点下班的记录。
 */
export const OVERTIME_THRESHOLD_HOURS = 1;

/** 一个标准工作日的小时数，用于判断按小时计的请假是否满一天。 */
const STANDARD_WORK_HOURS = 8;

type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];
type OvertimeType = (typeof ATTENDANCE_OVERTIME_TYPES)[number];

/**
 * 假期列 → 本系统状态。顺序即优先级：同一天多列有值时取先命中的。
 * 婚假/产假/丧假/其他在本系统枚举中没有对应项，统一落 leave，原类型保留在备注里。
 */
const LEAVE_COLUMN_MAP: Array<{ header: string; status: AttendanceStatus }> = [
  { header: '病假(小时)', status: 'sick_leave' },
  { header: '事假(小时)', status: 'personal_leave' },
  { header: '年假(天)', status: 'annual_leave' },
  { header: '调休假(小时)', status: 'compensatory_leave' },
  { header: '陪产假(天)', status: 'paternity_leave' },
  { header: '出差(天)', status: 'business_trip' },
  { header: '婚假(天)', status: 'leave' },
  { header: '产假(天)', status: 'leave' },
  { header: '丧假(天)', status: 'leave' },
  { header: '其他(天)', status: 'leave' },
];

export interface WeComDailyRow {
  /** 源文件行号（1-based，含表头），用于预览里回指 */
  rowNumber: number;
  attendanceDate: string;
  employeeName: string;
  /** 企微账号，仅用于展示排查，不参与匹配 */
  account: string;
  /** 部门末段，用于展示 */
  department: string;
  /** 企微原始部门全路径（公司/中心/班组），同名消歧时逐级比对 */
  departmentPath: string;
  shiftName: string;
  scheduledStart: string;
  scheduledEnd: string;
  checkInTime: string;
  checkOutTime: string;
  status: AttendanceStatus;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
  overtimeType: OvertimeType | '';
  /** 企微原始加班时长（小时），未过阈值也保留，仅用于预览展示 */
  rawOvertimeHours: number;
  note: string;
  /** 该行是否有实际打卡（用于识别整月未打卡人员） */
  hasPunch: boolean;
  /** 当日请假占多少天：1=整天，0.5=半天。非请假行恒为 1 */
  leaveDayFraction: number;
  /** 请假不足一天，预览里单独提示 */
  halfDayLeave: boolean;
}

export interface WeComDailyReport {
  rows: WeComDailyRow[];
  /** 文件实际覆盖的首尾日期，YYYY-MM-DD。覆盖写入只发生在这个区间内 */
  startDate: string;
  endDate: string;
  /** 覆盖到的月份及各自行数，按行数降序；跨考勤周期导出时会有两个 */
  months: Array<{ month: string; rowCount: number }>;
  /** 行数最多的月份，仅用于导入后把页面切到哪个月 */
  primaryMonth: string;
  /** 文件涉及但节假日日历里没登记的年份，这些年的节假日加班会退化成休息日加班 */
  yearsMissingHolidayCalendar: number[];
  totalRows: number;
}

export function parseWeComDailyReport(buffer: Buffer): WeComDailyReport {
  const workbook = readWorkbook(buffer);
  const sheet = workbook.Sheets[SHEET_NAME] ?? workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new BadRequestException('Excel 文件没有可读取的工作表');

  const table = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: '' });
  const headerIndex = table.findIndex((row) => row.some((cell) => text(cell) === '考勤结果'));
  if (headerIndex < 0) {
    throw new BadRequestException('未识别到企业微信打卡日报格式：缺少「考勤结果」列，请确认导出的是「上下班打卡 - 日报」');
  }
  const columns = locateColumns(table[headerIndex]);

  const rows: WeComDailyRow[] = [];
  const monthCounts = new Map<string, number>();
  for (let index = headerIndex + 1; index < table.length; index += 1) {
    const raw = table[index];
    const attendanceDate = parseDate(raw[DATE_COLUMN]);
    const employeeName = normalizeName(raw[NAME_COLUMN]);
    if (!attendanceDate || !employeeName) continue;
    rows.push(buildRow(raw, columns, attendanceDate, employeeName, index + 1));
    const month = attendanceDate.slice(0, 7);
    monthCounts.set(month, (monthCounts.get(month) ?? 0) + 1);
  }

  if (rows.length === 0) throw new BadRequestException('文件中没有可解析的考勤数据行');

  // 不按自然月裁剪：HR 常按考勤周期导出（如 6/26–7/25），裁掉少数派那半个月会静默丢数据。
  // 覆盖范围改用文件实际日期区间，跨月文件也能一次导完。
  const dates = rows.map((row) => row.attendanceDate).sort();
  const months = [...monthCounts.entries()]
    .map(([month, rowCount]) => ({ month, rowCount }))
    .sort((left, right) => right.rowCount - left.rowCount);
  const years = [...new Set(dates.map((date) => Number(date.slice(0, 4))))];
  return {
    rows,
    startDate: dates[0] ?? '',
    endDate: dates[dates.length - 1] ?? '',
    months,
    primaryMonth: months[0]?.month ?? '',
    yearsMissingHolidayCalendar: years.filter((year) => !hasHolidayCalendar(year)),
    totalRows: rows.length,
  };
}

function readWorkbook(buffer: Buffer) {
  try {
    return XLSX.read(buffer, { type: 'buffer', raw: false });
  } catch {
    throw new BadRequestException('Excel 文件无法解析，请确认文件未损坏且为 .xlsx 格式');
  }
}

/** 表头文本 → 列下标。「打卡时间」「打卡状态」各出现两次（上班/下班），按出现次序取。 */
function locateColumns(header: string[] = []) {
  const find = (name: string, occurrence = 1) => {
    let seen = 0;
    for (let index = 0; index < header.length; index += 1) {
      if (text(header[index]) === name) {
        seen += 1;
        if (seen === occurrence) return index;
      }
    }
    return -1;
  };
  return {
    department: find('部门'),
    shift: find('班次'),
    leaveApply: find('假勤申请'),
    result: find('考勤结果'),
    lateMinutes: find('迟到时长(分钟)'),
    earlyMinutes: find('早退时长(分钟)'),
    absentMinutes: find('旷工时长(分钟)'),
    missingCount: find('缺卡次数(次)'),
    overtimeHours: find('加班时长(小时)'),
    checkInTime: find('打卡时间', 1),
    checkOutTime: find('打卡时间', 2),
    leaves: LEAVE_COLUMN_MAP.map((item) => ({ ...item, index: find(item.header) })),
  };
}

type Columns = ReturnType<typeof locateColumns>;

function buildRow(
  raw: string[],
  columns: Columns,
  attendanceDate: string,
  employeeName: string,
  rowNumber: number,
): WeComDailyRow {
  const shiftText = text(raw[columns.shift]);
  const isRestDay = shiftText === '休息';
  const { scheduledStart, scheduledEnd } = parseShift(shiftText);
  const checkInTime = parseTime(raw[columns.checkInTime]);
  const checkOutTime = parseTime(raw[columns.checkOutTime]);
  const lateMinutes = Math.round(num(raw[columns.lateMinutes]));
  const earlyLeaveMinutes = Math.round(num(raw[columns.earlyMinutes]));
  const absentMinutes = num(raw[columns.absentMinutes]);
  const missingCount = num(raw[columns.missingCount]);
  const leaveApply = cleanText(raw[columns.leaveApply]);
  const leave = matchLeave(raw, columns);

  const status = resolveStatus({
    isRestDay,
    leaveStatus: leave?.status,
    absentMinutes,
    missingCount,
    lateMinutes,
    earlyLeaveMinutes,
    hasPunch: Boolean(checkInTime || checkOutTime),
  });

  const rawOvertimeHours = num(raw[columns.overtimeHours]);
  const countable = rawOvertimeHours >= OVERTIME_THRESHOLD_HOURS;
  const fraction = leave ? leaveFraction(leave.value, leave.header) : 1;

  return {
    rowNumber,
    attendanceDate,
    employeeName,
    account: cleanText(raw[ACCOUNT_COLUMN]),
    department: lastPathSegment(cleanText(raw[columns.department])),
    departmentPath: cleanText(raw[columns.department]),
    shiftName: isRestDay ? '休息' : shiftText && shiftText !== '--' ? shiftText : '标准班',
    scheduledStart,
    scheduledEnd,
    checkInTime,
    checkOutTime,
    status,
    lateMinutes,
    earlyLeaveMinutes,
    overtimeMinutes: countable ? Math.round(rawOvertimeHours * 60) : 0,
    overtimeType: countable ? inferOvertimeType(attendanceDate, isRestDay) : '',
    rawOvertimeHours,
    note: buildNote(leaveApply, leave?.header, leave?.status),
    hasPunch: Boolean(checkInTime || checkOutTime),
    leaveDayFraction: fraction,
    halfDayLeave: fraction < 1,
  };
}

function resolveStatus(input: {
  isRestDay: boolean;
  leaveStatus?: AttendanceStatus;
  absentMinutes: number;
  missingCount: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  hasPunch: boolean;
}): AttendanceStatus {
  if (input.isRestDay) return 'rest';
  if (input.leaveStatus) return input.leaveStatus;
  if (input.absentMinutes > 0) return 'absent';
  if (input.missingCount > 0 || !input.hasPunch) return 'missing';
  if (input.lateMinutes > 0 && input.earlyLeaveMinutes > 0) return 'late_early';
  if (input.lateMinutes > 0) return 'late';
  if (input.earlyLeaveMinutes > 0) return 'early';
  return 'normal';
}

function matchLeave(raw: string[], columns: Columns) {
  for (const column of columns.leaves) {
    if (column.index < 0) continue;
    const value = num(raw[column.index]);
    if (value > 0) return { ...column, value };
  }
  return undefined;
}

/**
 * 企微导出的加班分类列（工作日/休息日/节假日 × 调休/加班费）在实测文件中全为空，
 * 只能自行判定，三档依次为：
 *
 * 1. 法定节假日 → holiday（计入调休），查 statutory-holidays 日历，企微文件里没有
 *    任何字段能标出节假日，节假日和周末在「班次」列同样显示「休息」；
 * 2. 排班为休息 → sunday（休息日加班）。「班次」是企微按排班算出来的，能覆盖周六
 *    和调休换休，比单看星期几准；周日再兜一层，防排班表没维护；
 * 3. 其余 → workday。
 */
function inferOvertimeType(attendanceDate: string, isRestDay: boolean): OvertimeType {
  if (isStatutoryHoliday(attendanceDate)) return 'holiday';
  if (isRestDay) return 'sunday';
  return new Date(`${attendanceDate}T00:00:00Z`).getUTCDay() === 0 ? 'sunday' : 'workday';
}

function buildNote(leaveApply: string, leaveHeader?: string, leaveStatus?: AttendanceStatus) {
  // 婚假/产假/丧假/其他都落 leave，原类型只能靠备注保留，否则页面上分不清。
  const needsTypeHint = leaveStatus === 'leave' && leaveHeader;
  const prefix = needsTypeHint ? leaveHeader.replace(/\(.*\)$/, '') : '';
  const parts = [prefix, leaveApply].filter(Boolean);
  return parts.join('：').slice(0, 500);
}

/**
 * 当日请假占多少天。只看假期列的值，不看「假勤申请」原文——原文写的是整个申请的
 * 总量（如「出差4.5天（7/13 下午 - 7/17 下午）」），区间内每一天都是同一句话，
 * 拿它判断会把整天的 7/14 也误判成半天。
 *
 * 两类列口径不同：
 * - (天) 类：值就是当天占用量，0.5 表示半天，直接用。
 * - (小时) 类：值按自然小时跨夜累计，实测出现过 24、15、18 这种单日不可能的工作
 *   时数，不能拿它除以工时算比例，只能按「是否满一个标准工作日」二分到 1 或 0.5。
 */
function leaveFraction(value: number, header: string) {
  if (value <= 0) return 1;
  if (header.includes('(天)')) return Math.min(1, value);
  return value >= STANDARD_WORK_HOURS ? 1 : 0.5;
}

/** 「09:00-12:00、13:00-18:00」→ 首尾时间；「09:05-18:00」→ 直接取两端。 */
function parseShift(value: string) {
  const times = value.match(/([01]?\d|2[0-3]):[0-5]\d/g) ?? [];
  const first = times[0];
  const last = times[times.length - 1];
  if (!first || !last) return { scheduledStart: '08:00', scheduledEnd: '18:00' };
  return { scheduledStart: padTime(first), scheduledEnd: padTime(last) };
}

function padTime(value: string) {
  const [hour, minute] = value.split(':');
  return `${hour.padStart(2, '0')}:${minute}`;
}

/** 「2026/07/01 星期三」→「2026-07-01」 */
function parseDate(value: unknown) {
  const matched = text(value).match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (!matched) return '';
  const [, year, month, day] = matched;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

/**
 * 打卡时间列在异常时写的是状态文本（「缺卡（09:00）」「无需打卡（请假）」），
 * 里面同样含 HH:MM，必须整体匹配才算有效打卡时间。
 */
function parseTime(value: unknown) {
  const matched = text(value).match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return matched ? matched[0] : '';
}

/**
 * 「南京壹诺吉医疗科技有限公司/生产中心/产线」→「产线」。
 *
 * 一个人可能同时挂多个部门，企微用分号分隔整条路径，例如
 * 「生产中心;南京壹诺吉医疗科技有限公司/生产中心/鼎业人员」。取最后一条路径的末级，
 * 它通常是最具体的那个岗位归属。
 */
function lastPathSegment(value: string) {
  const paths = value.split(';').map((path) => path.trim()).filter(Boolean);
  const deepest = paths[paths.length - 1] ?? '';
  const segments = deepest.split('/').filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1]! : '';
}

/** 「梁虓（已离职）」→「梁虓」：企微会把离职标记写进姓名，匹配前需剥掉。 */
function normalizeName(value: unknown) {
  return text(value).replace(/[（(][^）)]*[）)]\s*$/, '').trim();
}

function num(value: unknown) {
  const parsed = Number(cleanText(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

/** 企微用「--」表示空值 */
function cleanText(value: unknown) {
  const result = text(value);
  return result === '--' ? '' : result;
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}
