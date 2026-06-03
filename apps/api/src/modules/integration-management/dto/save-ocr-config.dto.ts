import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * 腾讯 OCR 配置保存入参。
 * secret_key 走与邮箱/AI 模型一致的传输套路：优先 plain_secret（HTTPS 明文），
 * 浏览器无法回退时用 encrypted_secret（RSA-OAEP）。两者皆空表示保留原密钥。
 */
export class SaveOcrConfigDto {
  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  secret_id?: string;

  @IsOptional()
  @IsString()
  encrypted_secret?: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  plain_secret?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  region?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  endpoint?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  invoice_action?: string;
}
