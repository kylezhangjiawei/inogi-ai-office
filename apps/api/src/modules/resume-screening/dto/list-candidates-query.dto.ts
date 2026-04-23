import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, Max, Min } from 'class-validator';

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
  @IsString()
  job_rule_id?: string;
}
