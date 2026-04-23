import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SaveDictionaryItemDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  remark?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  account?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  password?: string;
}
