import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class GenerateImageDto {
  @IsString()
  @MaxLength(1000)
  prompt: string;

  @IsOptional()
  @IsIn(['vivid', 'natural'])
  style?: 'vivid' | 'natural';

  @IsOptional()
  @IsIn(['1024x1024', '1792x1024', '1024x1792'])
  size?: '1024x1024' | '1792x1024' | '1024x1792';

  @IsOptional()
  @IsIn(['standard', 'hd'])
  quality?: 'standard' | 'hd';
}
