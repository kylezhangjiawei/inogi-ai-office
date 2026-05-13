import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class SaveTencentOcrConfigDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  secret_id?: string;

  @IsOptional()
  @IsString()
  secret_key?: string;

  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsString()
  endpoint?: string;

  @IsOptional()
  @IsString()
  invoice_action?: string;
}

export class SaveWeComExpenseConfigDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  corp_id?: string;

  @IsOptional()
  @IsString()
  agent_id?: string;

  @IsOptional()
  @IsString()
  corp_secret?: string;

  @IsOptional()
  @IsString()
  approval_template_id?: string;

  @IsOptional()
  @IsString()
  default_creator_userid?: string;

  @IsOptional()
  @IsString()
  callback_token?: string;

  @IsOptional()
  @IsString()
  callback_aes_key?: string;
}

export class SaveExpenseIntegrationConfigDto {
  @IsOptional()
  tencent_ocr?: SaveTencentOcrConfigDto;

  @IsOptional()
  wecom?: SaveWeComExpenseConfigDto;
}
