import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * 单个附件的入参。后端只信任 fileId（据此回查 FileAsset 作为权威来源），
 * name/mime/size 仅作前端展示透传，可选。
 */
export class ChatAttachmentInputDto {
  @IsString()
  @MaxLength(64)
  fileId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  mime?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  size?: number;
}

export class SendMessageDto {
  // 允许空文本：当仅发送图片/文件附件时，content 可为空。
  // 是否"内容为空且无附件"由 service 层兜底校验。
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  content?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  model?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ChatAttachmentInputDto)
  attachments?: ChatAttachmentInputDto[];
}
