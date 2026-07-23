import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * 创建视频生成任务入参。
 * - mode=i2v：需 source_image_urls 恰好 1 张（作为首帧）
 * - mode=r2v：需 source_image_urls 1~9 张（参考图）
 * - mode=t2v：无需图片，仅 prompt
 */
export class CreateVideoDto {
  @IsIn(['i2v', 't2v', 'r2v'])
  mode: 'i2v' | 't2v' | 'r2v';

  @IsString()
  @MaxLength(5000, { message: '提示词不能超过 5000 个字符' })
  prompt: string;

  /** 图片来源标识（GeneratedImage id 或 URL），仅用于留痕 */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(9)
  @IsString({ each: true })
  source_image_refs?: string[];

  /** 实际提交给上游的图片 URL（i2v 1 张 / r2v 1~9 张）。对话式已解析好 URL 时用此字段。 */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(9)
  @IsString({ each: true })
  @MaxLength(2048, { each: true })
  source_image_urls?: string[];

  /** 上传文件 id（独立工作台上传图片后传入），服务端解析为 OSS 直连 URL；与 source_image_urls 二选一 */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(9)
  @IsString({ each: true })
  source_file_ids?: string[];

  @IsOptional()
  @IsIn(['720P', '1080P'])
  resolution?: '720P' | '1080P';

  /** 画面比例（t2v/r2v 可选），如 16:9；i2v 由首帧决定，忽略此值 */
  @IsOptional()
  @IsIn(['16:9', '9:16', '1:1', '4:3', '3:4', '4:5', '5:4', '9:21', '21:9'])
  ratio?: string;

  @IsOptional()
  @IsInt()
  @Min(3)
  @Max(15)
  duration?: number;

  @IsOptional()
  @IsBoolean()
  watermark?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2147483647)
  seed?: number;

  /** 指定使用的视频模型配置 id（AI 模型管理里 usage_kind=video 的项）；不传则按 mode 自动选 */
  @IsOptional()
  @IsString()
  model_id?: string;

  /** MateChat 来源对话 id（对话式生成回填），独立页不传 */
  @IsOptional()
  @IsString()
  conversation_id?: string;
}
