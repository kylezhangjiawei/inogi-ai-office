import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsString, MaxLength, MinLength } from 'class-validator';

export class ReorderPermissionCatalogItemsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10000)
  @ArrayUnique()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(120, { each: true })
  ids!: string[];
}
