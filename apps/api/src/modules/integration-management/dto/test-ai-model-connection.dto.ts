import { IsOptional, IsString, MaxLength } from 'class-validator';

export class TestAiModelConnectionDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  provider?: string;

  @IsString()
  @MaxLength(100)
  model!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  base_url?: string;

  /**
   * 模型用途决定连通性测试使用的协议。图片、视频和音频模型不能走
   * OpenAI Chat Completions；未传时使用已保存配置或根据模型名推断。
   */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  usage_kind?: string;

  @IsOptional()
  @IsString()
  encrypted_secret?: string;

  @IsOptional()
  @IsString()
  plain_secret?: string;
}
