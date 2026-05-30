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

  /**
   * 以下字段都是「运行时状态」，只能由系统通过测试/使用流程写入，
   * 用户表单传过来会被忽略——避免保存时把已成功的状态反向覆盖回旧值。
   * 字段保留为 optional 是为了向后兼容旧前端的 payload，不做校验也不做使用。
   */
  @IsOptional()
  @IsString()
  current_status?: string;

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
