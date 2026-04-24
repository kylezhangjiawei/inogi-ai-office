import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class SaveAiModelDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  @MaxLength(100)
  name!: string;

  @IsString()
  @MaxLength(60)
  provider!: string;

  @IsString()
  @MaxLength(100)
  model!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  base_url?: string;

  @IsOptional()
  @IsString()
  encrypted_secret?: string;

  @IsOptional()
  @IsString()
  plain_secret?: string;

  @IsString()
  @MaxLength(40)
  current_status!: string;

  @IsOptional()
  @IsString()
  last_success_at?: string;

  @IsOptional()
  @IsString()
  last_failure_at?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  last_latency_ms?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  today_requests?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  today_tokens?: number;

  @IsOptional()
  @IsNumber()
  today_estimated_cost?: number;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  current_balance_or_quota?: string;

  @IsBoolean()
  enabled!: boolean;

  @IsBoolean()
  is_default_enabled!: boolean;
}
