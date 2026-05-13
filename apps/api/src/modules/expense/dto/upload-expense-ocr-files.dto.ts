import { IsIn, IsOptional, IsString } from 'class-validator';

export class UploadExpenseOcrFilesDto {
  @IsOptional()
  @IsIn(['auto', 'manual'])
  ocr_mode?: 'auto' | 'manual';

  @IsOptional()
  @IsString()
  ocr_service_key?: string;
}
