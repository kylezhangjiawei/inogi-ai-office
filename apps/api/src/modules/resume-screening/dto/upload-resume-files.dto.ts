import { IsOptional, IsString } from 'class-validator';

export class UploadResumeFilesDto {
  @IsOptional()
  @IsString()
  job_rule_id?: string | null;

  @IsOptional()
  @IsString()
  openai_config_id?: string | null;
}
