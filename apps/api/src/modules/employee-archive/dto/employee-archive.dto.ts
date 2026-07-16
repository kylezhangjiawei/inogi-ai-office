import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const ARCHIVE_STATUSES = ['complete', 'review', 'missing', 'onboarding'] as const;
const DOCUMENT_STATUSES = ['done', 'review', 'missing'] as const;

export class EmployeeArchiveDocumentDto {
  @IsString()
  @MaxLength(120)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  source?: string;

  @IsOptional()
  @IsIn(DOCUMENT_STATUSES)
  status?: (typeof DOCUMENT_STATUSES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  detail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  updatedAt?: string;
}

/**
 * 新增、全量更新与批量导入共用的员工主档结构。
 * identityNumber 为一次性原始身份证号：服务层完成校验、派生和脱敏后立即丢弃，不会写入数据库。
 */
export class SaveEmployeeArchiveDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  id?: string;

  @IsString()
  @MaxLength(80)
  rosterNo!: string;

  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional() @IsString() @MaxLength(120) company?: string;
  @IsOptional() @IsString() @MaxLength(10) hireDate?: string;
  @IsOptional() @IsString() @MaxLength(80) tenure?: string;
  @IsOptional() @IsString() @MaxLength(80) status?: string;
  @IsOptional() @IsString() @MaxLength(120) workLocation?: string;
  @IsOptional() @IsString() @MaxLength(120) department?: string;
  @IsOptional() @IsString() @MaxLength(120) title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(18)
  identityNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phoneNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  bankAccount?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  emergencyPhoneNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  socialSecurityNumber?: string;

  @IsOptional() @IsString() @MaxLength(80) idNoMasked?: string;
  @IsOptional() @IsString() @MaxLength(10) birthDate?: string;
  @IsOptional() @IsString() @MaxLength(10) birthMonthDay?: string;
  @IsOptional() @IsString() @MaxLength(20) zodiac?: string;
  @IsOptional() @IsString() @MaxLength(20) constellation?: string;
  @IsOptional() @IsString() @MaxLength(20) gender?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(150)
  age?: number;

  @IsOptional() @IsString() @MaxLength(40) ethnicity?: string;
  @IsOptional() @IsString() @MaxLength(40) maritalStatus?: string;
  @IsOptional() @IsString() @MaxLength(80) phoneMasked?: string;
  @IsOptional() @IsString() @MaxLength(120) bankAccountMasked?: string;
  @IsOptional() @IsString() @MaxLength(200) bankBranch?: string;
  @IsOptional() @IsString() @MaxLength(80) education?: string;
  @IsOptional() @IsString() @MaxLength(200) school?: string;
  @IsOptional() @IsString() @MaxLength(160) major?: string;
  @IsOptional() @IsString() @MaxLength(120) hometown?: string;
  @IsOptional() @IsString() @MaxLength(300) registeredAddress?: string;
  @IsOptional() @IsString() @MaxLength(300) currentAddress?: string;
  @IsOptional() @IsString() @MaxLength(120) emergencyContact?: string;
  @IsOptional() @IsString() @MaxLength(80) emergencyRelation?: string;
  @IsOptional() @IsString() @MaxLength(80) emergencyPhoneMasked?: string;
  @IsOptional() @IsString() @MaxLength(120) socialSecurityNo?: string;
  @IsOptional() @IsString() @MaxLength(40) socialSecurityFirstMonth?: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @IsOptional() @IsString() @MaxLength(120) costCenter?: string;

  @IsOptional()
  @IsIn(ARCHIVE_STATUSES)
  archiveStatus?: (typeof ARCHIVE_STATUSES)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  archiveScore?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  missingFields?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  alerts?: string[];

  @IsOptional()
  @IsObject()
  badgeConfig?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  source?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => EmployeeArchiveDocumentDto)
  docs?: EmployeeArchiveDocumentDto[];
}

export class BulkImportEmployeeArchivesDto {
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => SaveEmployeeArchiveDto)
  items!: SaveEmployeeArchiveDto[];

  @IsOptional()
  @IsBoolean()
  replace?: boolean;
}

export class ListEmployeeArchivesQueryDto {
  @IsOptional() @IsString() @MaxLength(200) search?: string;
  @IsOptional() @IsString() @MaxLength(120) company?: string;
  @IsOptional() @IsString() @MaxLength(120) department?: string;

  @IsOptional()
  @IsIn(ARCHIVE_STATUSES)
  archiveStatus?: (typeof ARCHIVE_STATUSES)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  pageSize?: number;
}

export class ListProbationRemindersQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(180)
  days?: number;
}

export class SaveEmployeeBadgeConfigDto {
  @IsIn(['official', 'intern', 'labor'])
  templateKey!: 'official' | 'intern' | 'labor';

  @IsObject()
  positions!: Record<string, unknown>;

  @IsObject()
  positionConfirmed!: Record<string, unknown>;

  @IsObject()
  textVisibility!: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  avatar?: Record<string, unknown> | null;
}
