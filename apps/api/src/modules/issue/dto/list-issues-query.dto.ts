import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class ListIssuesQueryDto {
  @IsOptional()
  @IsIn(['all', 'pending', 'processing', 'solved', 'reusable'])
  statusGroup?: 'all' | 'pending' | 'processing' | 'solved' | 'reusable';

  @IsOptional()
  @IsIn(['fatal', 'major', 'normal', 'minor'])
  severity?: 'fatal' | 'major' | 'normal' | 'minor';

  @IsOptional()
  @IsIn(['rd', 'production'])
  source?: 'rd' | 'production';

  @IsOptional()
  @IsString()
  @MaxLength(120)
  product?: string;

  @IsOptional()
  @IsIn(['人', '机', '料', '法', '环', '测'])
  dimension?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  specificCause?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
