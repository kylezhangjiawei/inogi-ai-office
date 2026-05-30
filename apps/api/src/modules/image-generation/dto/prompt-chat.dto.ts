import { IsArray, IsIn, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class PromptChatMessageDto {
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant';

  @IsString()
  @MaxLength(8000)
  content!: string;
}

export class PromptChatDto {
  @IsOptional()
  @IsString()
  session_id?: string;

  @IsString()
  @MaxLength(32_000, { message: '当前提示词不能超过 32000 个字符' })
  current_prompt!: string;

  @IsString()
  @MaxLength(8000, { message: '对话内容不能超过 8000 个字符' })
  message!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PromptChatMessageDto)
  history?: PromptChatMessageDto[];

  @IsOptional()
  @IsString()
  model_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  model?: string;
}

export class CreatePromptChatSessionDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32_000)
  source_prompt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32_000)
  current_prompt?: string;
}
