import { IsInt, IsOptional, IsString, Matches, MaxLength, Min, MinLength } from 'class-validator';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export class CreateVideoCategoryDto {
  @IsString()
  @MinLength(1, { message: '分类名称不能为空' })
  @MaxLength(40, { message: '分类名称不能超过 40 个字符' })
  name: string;

  /** 父分类 id；不传 / 传空表示建为根分类。 */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  parentId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200, { message: '分类说明不能超过 200 个字符' })
  description?: string;

  @IsOptional()
  @IsString()
  @Matches(HEX_COLOR, { message: '颜色需为 #RRGGBB 格式' })
  color?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateVideoCategoryDto {
  @IsOptional()
  @IsString()
  @MinLength(1, { message: '分类名称不能为空' })
  @MaxLength(40, { message: '分类名称不能超过 40 个字符' })
  name?: string;

  /** 移动分类：传新的父 id，传 null / 空串表示提升为根分类。 */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  parentId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200, { message: '分类说明不能超过 200 个字符' })
  description?: string;

  @IsOptional()
  @IsString()
  @Matches(HEX_COLOR, { message: '颜色需为 #RRGGBB 格式' })
  color?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

/** 给视频设置 / 清除分类归属；categoryId 传 null 或空串表示移出分类。 */
export class AssignVideoCategoryDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  categoryId?: string | null;
}
