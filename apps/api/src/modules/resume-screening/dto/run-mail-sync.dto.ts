import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class RunMailSyncDto {
  @IsOptional()
  @IsString()
  job_rule_id?: string;

  @IsOptional()
  @IsString()
  mail_config_id?: string;

  @IsOptional()
  @IsString()
  openai_config_id?: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  ignore_last_uid?: boolean;

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(24 * 30)
  since_hours!: number;

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit!: number;
}
