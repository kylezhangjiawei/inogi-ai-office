import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * 把已上传到 OSS（businessType=library/images）的本地图片登记进作品库。
 * 前端先走 /api/files/presign-upload → PUT OSS → /api/files/register-upload 拿到 fileId，再调这个接口。
 */
export class UploadImageDto {
  @IsString()
  @MaxLength(64)
  fileId: string;

  /** 直接放进某个分类；不传表示未分类。 */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  categoryId?: string | null;

  /** 作品标题 / 说明，落到 prompt 字段用于列表展示与搜索；不传则用文件名。 */
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: '标题不能超过 500 个字符' })
  title?: string;

  /** 前端量到的原图尺寸，如 1920x1080，仅用于卡片角标展示。 */
  @IsOptional()
  @IsString()
  @Matches(/^\d{1,5}x\d{1,5}$/, { message: '尺寸需为 宽x高 格式' })
  size?: string;
}
