import { Type } from 'class-transformer';
import {
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
