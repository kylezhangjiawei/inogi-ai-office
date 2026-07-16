import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const CHAT_FEEDBACK_REASONS = [
  'inaccurate',
  'unresolved',
  'outdated',
  'misunderstood',
  'slow',
  'inconvenient',
  'other',
] as const;

export class UpdateReactionDto {
  @IsOptional()
  @IsIn(['like', 'dislike'])
  reaction?: 'like' | 'dislike' | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsString({ each: true })
  @IsIn(CHAT_FEEDBACK_REASONS, { each: true })
  @MaxLength(40, { each: true })
  reasons?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
