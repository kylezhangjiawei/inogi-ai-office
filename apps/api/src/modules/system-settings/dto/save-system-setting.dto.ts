import { IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class SaveSystemSettingDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  category!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  key!: string;

  @IsObject()
  value!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  description?: string;
}
