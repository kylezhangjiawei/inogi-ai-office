import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

export class SaveMailSyncScheduleDto {
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  enabled!: boolean;

  @IsString()
  @Matches(/^\d{2}:\d{2}$/)
  run_at!: string;

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(24 * 30)
  since_hours!: number;

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(500)
  limit!: number;

  @IsOptional()
  @IsString()
  job_rule_id?: string | null;

  @IsOptional()
  @IsString()
  mail_config_id?: string | null;

  @IsOptional()
  @IsString()
  openai_config_id?: string | null;
}
