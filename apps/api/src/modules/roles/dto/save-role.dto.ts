import { IsArray, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class SaveRoleDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  description?: string;

  @IsArray()
  @IsString({ each: true })
  permissions!: string[];
}
