import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class EditImageDto {
  @IsString()
  @MaxLength(32_000, { message: '修改要求不能超过 32000 个字符' })
  message: string;

  @IsOptional()
  @IsIn(['vivid', 'natural'])
  style?: 'vivid' | 'natural';

  @IsOptional()
  @IsIn(['1024x1024', '1792x1024', '1024x1792'])
  size?: '1024x1024' | '1792x1024' | '1024x1792';

  @IsOptional()
  @IsString()
  model_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  model?: string;

  @IsOptional()
  @IsString()
  @MaxLength(25_000_000)
  reference_image_data?: string;
}
