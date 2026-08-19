import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

/**
 * 把已上传到 OSS（businessType=library/videos）的本地视频登记进视频作品库。
 * 前端先走 /api/files/presign-upload → PUT OSS → /api/files/register-upload 拿到 fileId，再调这个接口。
 */
export class UploadVideoDto {
  @IsString()
  @MaxLength(64)
  fileId: string;

  /** 直接放进某个分类；不传表示未分类。 */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  categoryId?: string | null;

  /** 视频标题 / 说明，落到 prompt 字段用于列表展示；不传则用文件名。 */
  @IsOptional()
  @IsString()
  @MaxLength(5000, { message: '标题不能超过 5000 个字符' })
  title?: string;

  /** 前端量到的时长（秒），仅用于卡片展示。 */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(86400)
  duration?: number;

  /** 前端量到的画面尺寸，如 1920x1080，仅用于卡片展示。 */
  @IsOptional()
  @IsString()
  @Matches(/^\d{1,5}x\d{1,5}$/, { message: '尺寸需为 宽x高 格式' })
  resolution?: string;
}
