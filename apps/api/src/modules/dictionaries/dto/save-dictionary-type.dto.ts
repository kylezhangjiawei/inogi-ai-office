import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const DICTIONARY_KINDS = ['email', 'generic'] as const;

export class SaveDictionaryTypeDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  label!: string;

  @IsOptional()
  @IsIn(DICTIONARY_KINDS)
  kind?: (typeof DICTIONARY_KINDS)[number];
}
