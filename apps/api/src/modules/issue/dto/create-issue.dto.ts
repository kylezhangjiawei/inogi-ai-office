import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/** 提交问题时携带的附件（已先经 /api/files/upload 拿到 fileId，此处 id=fileId）。 */
export class IssueAttachmentInputDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  id?: string; // = FileAsset.id（兼作 fileId），无则视为纯展示附件

  @IsString()
  @MaxLength(255)
  fileName!: string;

  @IsString()
  @MaxLength(128)
  fileType!: string;

  // fileUrl 仅作展示透传，存储/展示实际按 id(fileId) 回查重签。
  // 客户端可能把本地预览用的 base64 dataURL 原样带上来（动辄几十 KB），
  // 静默丢弃而不是 400 拒绝：该值本来就不会被采用。
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Transform(({ value }) =>
    typeof value === 'string' && (value.startsWith('data:') || value.length > 2000)
      ? undefined
      : value,
  )
  fileUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  extractedText?: string;
}

export class CreateIssueDto {
  @IsString()
  @MaxLength(200)
  title!: string;

  @IsString()
  @MaxLength(8000)
  description!: string;

  // 来源/严重度不再在新建表单收集；缺省时由 service 兜底为 production/normal。
  @IsOptional()
  @IsIn(['rd', 'production'])
  source?: 'rd' | 'production';

  @IsOptional()
  @IsIn(['fatal', 'major', 'normal', 'minor'])
  severity?: 'fatal' | 'major' | 'normal' | 'minor';

  @IsOptional()
  @IsString()
  @MaxLength(120)
  product?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  batch?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  station?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  defectRate?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => IssueAttachmentInputDto)
  attachments?: IssueAttachmentInputDto[];
}
