import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const ATTENDANCE_STATUSES = [
  'normal',
  'late',
  'early',
  'late_early',
  'missing',
  'absent',
  'leave',
  'business_trip',
  'rest',
  'holiday',
  'sick_leave',
  'personal_leave',
  'annual_leave',
  'paternity_leave',
  'compensatory_leave',
  'study',
] as const;

export const MANUAL_ATTENDANCE_STATUSES = [
  'auto',
  'absent',
  'leave',
  'business_trip',
  'rest',
  'holiday',
  'sick_leave',
  'personal_leave',
  'annual_leave',
  'paternity_leave',
  'compensatory_leave',
  'study',
] as const;

export const ATTENDANCE_OVERTIME_TYPES = ['workday', 'sunday', 'holiday'] as const;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_PATTERN = /^\d{4}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export class AttendanceDailyQueryDto {
  @IsOptional()
  @Matches(DATE_PATTERN)
  date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  department?: string;

  @IsOptional()
  @IsIn(ATTENDANCE_STATUSES)
  status?: (typeof ATTENDANCE_STATUSES)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  pageSize?: number;
}

export class AttendanceMonthlyQueryDto {
  @IsOptional()
  @Matches(MONTH_PATTERN)
  month?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  department?: string;
}

export class AttendanceEmployeeDetailQueryDto {
  @IsOptional()
  @Matches(MONTH_PATTERN)
  month?: string;
}

export class SaveAttendanceRecordDto {
  @IsString()
  @MaxLength(80)
  employeeId!: string;

  @Matches(DATE_PATTERN)
  attendanceDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  shiftName?: string;

  @IsOptional()
  @Matches(TIME_PATTERN)
  scheduledStart?: string;

  @IsOptional()
  @Matches(TIME_PATTERN)
  scheduledEnd?: string;

  @IsOptional()
  @Matches(TIME_PATTERN)
  checkInTime?: string;

  @IsOptional()
  @Matches(TIME_PATTERN)
  checkOutTime?: string;

  @IsOptional()
  @IsIn(MANUAL_ATTENDANCE_STATUSES)
  manualStatus?: (typeof MANUAL_ATTENDANCE_STATUSES)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1440)
  deductionMinutes?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1440)
  overtimeMinutes?: number;

  @IsOptional()
  @IsIn(ATTENDANCE_OVERTIME_TYPES)
  overtimeType?: (typeof ATTENDANCE_OVERTIME_TYPES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class SaveAttendanceMonthDto {
  @IsString()
  @MaxLength(80)
  employeeId!: string;

  @Matches(MONTH_PATTERN)
  month!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100000)
  previousOvertimeBalance?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100000)
  previousCompTimeBalanceHours?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(31)
  previousMonthSickLeaveDays?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(31)
  entitledSickLeaveDays?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(31)
  paidSickLeaveDays?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(31)
  unpaidSickLeaveDays?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100000)
  invertedHours?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100000)
  recoveredHours?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  signature?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  /** 人员长期属性，写入员工档案而非本月结余；不传则不改动 */
  @IsOptional()
  @IsBoolean()
  deductsInvertedHours?: boolean;
}

/**
 * 导入确认：文件走 multipart 重传，这里只接勾选的员工。
 * multipart 的字段都是字符串，employeeIds 允许传 JSON 数组文本或重复字段。
 */
export class ConfirmAttendanceImportDto {
  @Transform(({ value }) => normalizeStringArray(value))
  @IsArray()
  @ArrayMaxSize(2000)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  employeeIds!: string[];
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value !== 'string') return [];
  const text = value.trim();
  if (!text) return [];
  if (text.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.map((item) => String(item).trim()).filter(Boolean);
    } catch {
      return [];
    }
  }
  return text.split(',').map((item) => item.trim()).filter(Boolean);
}

export class ClockAttendanceDto {
  @IsString()
  @MaxLength(80)
  employeeId!: string;

  @IsIn(['check-in', 'check-out'])
  type!: 'check-in' | 'check-out';

  @IsOptional()
  @IsISO8601()
  timestamp?: string;
}
