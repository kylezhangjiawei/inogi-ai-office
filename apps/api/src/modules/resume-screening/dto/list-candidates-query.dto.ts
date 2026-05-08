import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ListCandidatesQueryDto {
  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsEnum(['recommend', 'hold', 'reject'])
  decision?: 'recommend' | 'hold' | 'reject';

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @Min(0)
  @Max(100)
  min_score?: number;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @Min(0)
  @Max(120)
  min_age?: number;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @Min(0)
  @Max(120)
  max_age?: number;

  @IsOptional()
  @IsString()
  job_rule_id?: string;

  @IsOptional()
  @IsString()
  screening_version?: string;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  page_size?: number;
}
