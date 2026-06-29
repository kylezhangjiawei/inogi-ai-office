import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import { IssueAttachmentInputDto } from './create-issue.dto';

/** 对话调整（adjust）：一句反馈即触发重算。 */
export class AdjustIssueDto {
  @IsString()
  @MaxLength(4000)
  message!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  model?: string;
}

/** 多用户沟通发送（sendChat）。 */
export class SendChatDto {
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
  @Type(() => IssueAttachmentInputDto)
  attachments?: IssueAttachmentInputDto[];
}

/** 采纳/复用方案。 */
export class AdoptIssueDto {
  @IsIn(['analysis', 'reuse'])
  kind!: 'analysis' | 'reuse';

  @IsOptional()
  @IsString()
  @MaxLength(64)
  causeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  solutionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  reusedFrom?: string;
}

/** 定性是否已解决（需 issue:resolve 权限）。 */
export class ResolveIssueDto {
  @IsBoolean()
  resolved!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

/** 保存 AI 配置（需 issue:resolve 权限）。 */
export class SaveAiConfigDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  model?: string;

  @IsOptional()
  @Type(() => Number)
  temperature?: number;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  systemPrompt?: string;

  @IsIn(['ai', 'ocr'])
  attachmentMode!: 'ai' | 'ocr';
}

/** 处理附件：按 mode 提取文本（fileId 必填）。 */
export class ProcessAttachmentDto {
  @IsString()
  @MaxLength(64)
  fileId!: string;

  @IsIn(['ai', 'ocr'])
  mode!: 'ai' | 'ocr';
}
