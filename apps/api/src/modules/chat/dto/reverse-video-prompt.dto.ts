import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReverseVideoPromptDto {
  /** 图片或视频关键帧的 base64 data URL（1~8 张） */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @IsString({ each: true })
  @MaxLength(15_000_000, { each: true })
  images: string[];

  @IsOptional()
  @IsIn(['image', 'video'])
  kind?: 'image' | 'video';
}
