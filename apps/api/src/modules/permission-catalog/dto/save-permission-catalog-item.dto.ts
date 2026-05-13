import { IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class SavePermissionCatalogItemDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  @MaxLength(120)
  code!: string;

  @IsString()
  @MaxLength(80)
  label!: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  description?: string;

  @IsString()
  @MaxLength(80)
  groupLabel!: string;

  @IsIn(['page', 'action'])
  type!: 'page' | 'action';

  @IsOptional()
  @IsString()
  @MaxLength(160)
  routePath?: string;

  @IsBoolean()
  enabled!: boolean;

  @IsInt()
  @Min(0)
  sortOrder!: number;
}
