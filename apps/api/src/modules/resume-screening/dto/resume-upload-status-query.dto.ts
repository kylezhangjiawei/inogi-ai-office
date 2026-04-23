import { ArrayMaxSize, IsArray, IsString } from 'class-validator';

export class ResumeUploadStatusQueryDto {
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  unique_keys!: string[];
}
