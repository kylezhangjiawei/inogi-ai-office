import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

import { OSS_BUSINESS_TYPES, OssBusinessType } from '../../oss/oss.constants';

const businessTypeValues = Object.values(OSS_BUSINESS_TYPES);

export class PresignFileUploadDto {
  @IsString()
  @MaxLength(255)
  fileName: string;

  @IsString()
  @MaxLength(255)
  mimeType: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  fileSize: number;

  @IsEnum(businessTypeValues, { message: `businessType must be one of: ${businessTypeValues.join(', ')}` })
  businessType: OssBusinessType;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  businessId?: string;
}

export class RegisterFileUploadDto extends PresignFileUploadDto {
  @IsString()
  @MaxLength(1024)
  objectKey: string;
}

export class AbortFileUploadDto {
  @IsString()
  @MaxLength(1024)
  objectKey: string;

  @IsEnum(businessTypeValues, { message: `businessType must be one of: ${businessTypeValues.join(', ')}` })
  businessType: OssBusinessType;
}
