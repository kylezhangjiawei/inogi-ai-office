import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class ApplyCandidateAiUpdateDto {
  @IsOptional()
  @IsObject()
  profile_patch?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  screening_patch?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  source_answer?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
