import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class SaveDepartmentDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  @MaxLength(80)
  name!: string;

  /**
   * 前端编辑时看到的改名前名称。
   * 后端仍以数据库中的当前名称为准，同时用它修复旧版本遗留的孤儿引用。
   */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  previousName?: string;

  @IsString()
  @MaxLength(80)
  code!: string;

  @IsString()
  @MaxLength(80)
  category!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  manager?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
