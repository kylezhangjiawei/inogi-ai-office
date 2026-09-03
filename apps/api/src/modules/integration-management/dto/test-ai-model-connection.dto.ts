import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

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

  /**
   * 测试失败时把已保存的模型直接停用（isActive=false）。
   * 列表 / 全部测试用的是已保存配置，可以放心停用；编辑对话框里测的是
   * 未保存的表单值，不应传此标记。
   */
  @IsOptional()
  @IsBoolean()
  disable_on_failure?: boolean;
}
