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

  @IsBoolean()
  enabled!: boolean;

  @IsBoolean()
  is_default_enabled!: boolean;

  /** 显式用途类型：text | multimodal | image | auto（空值等同于 auto，走正则推断） */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  usage_kind?: string;
}
