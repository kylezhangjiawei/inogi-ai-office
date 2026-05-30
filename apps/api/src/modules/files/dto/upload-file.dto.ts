import { IsEnum, IsOptional, IsString } from 'class-validator';
import { OSS_BUSINESS_TYPES, OssBusinessType } from '../../oss/oss.constants';

const businessTypeValues = Object.values(OSS_BUSINESS_TYPES);

export class UploadFileDto {
  @IsEnum(businessTypeValues, { message: `businessType must be one of: ${businessTypeValues.join(', ')}` })
  businessType: OssBusinessType;

  @IsOptional()
  @IsString()
  businessId?: string;
}
