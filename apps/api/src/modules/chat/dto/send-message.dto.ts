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

  /**
   * 幂等键：前端为「一次逻辑发送」生成的唯一标识。同一逻辑请求的多次到达（网络/代理重放、
   * 误重发）携带相同值，后端据此保证只落一条用户消息、不重复提问。省略则不做幂等（旧客户端兼容）。
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  clientMessageId?: string;

  /**
   * 重新回答时传入要替换的 assistant 消息。后端校验它属于当前用户、当前会话且是最新回答，
   * 并复用原 user message，不重复创建问题记录。
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  regenerateMessageId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ChatAttachmentInputDto)
  attachments?: ChatAttachmentInputDto[];
}
