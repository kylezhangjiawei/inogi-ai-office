import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateExternalDocumentDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;

  @IsString()
  @MaxLength(40)
  version!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  allowSend?: boolean;
}

export class UploadExternalDocumentVersionDto {
  @IsString()
  @MaxLength(40)
  version!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class ReplaceExternalCandidateDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ReviewExternalDifferenceDto {
  @IsString()
  @MaxLength(80)
  differenceId!: string;

  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  reviewed!: boolean;
}

export class ArchiveExternalComparisonDto {
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  summary?: string;
}
