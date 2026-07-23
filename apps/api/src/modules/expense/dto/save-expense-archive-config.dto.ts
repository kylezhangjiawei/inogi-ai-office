import { ArrayMaxSize, IsArray, IsObject } from 'class-validator';

export class SaveExpenseArchiveConfigDto {
  @IsArray()
  @ArrayMaxSize(100)
  tree!: unknown[];

  @IsObject()
  manual_category!: Record<string, unknown>;

  @IsArray()
  @ArrayMaxSize(1000)
  excluded_ids!: unknown[];
}
