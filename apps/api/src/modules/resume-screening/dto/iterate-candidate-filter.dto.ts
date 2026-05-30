import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';

class CandidateFilterChatMessageDto {
  @IsIn(['user', 'assistant'])
  role: 'user' | 'assistant';

  @IsString()
  @MaxLength(4000)
  content: string;
}

export class IterateCandidateFilterDto {
  @IsString()
  @MaxLength(3000)
  instruction: string;

  @IsOptional()
  @IsString()
  job_rule_id?: string;

  @IsOptional()
  @IsString()
  base_version?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  candidate_ids?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CandidateFilterChatMessageDto)
  history?: CandidateFilterChatMessageDto[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(80)
  limit?: number;
}
