import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDefined, IsISO8601, IsInt, IsString, MaxLength, Min, ValidateNested } from 'class-validator';

export class PageEntityRefDto {
  @IsString() @MaxLength(40) entityType!: string;
  @IsString() @MaxLength(100) entityId!: string;
  @IsString() @MaxLength(30) workspace!: string;
}

/** Only identifiers cross the trust boundary. Unsupported versions degrade safely. */
export class PageContextDto {
  @IsInt() @Min(1) schemaVersion!: number;
  @IsString() @MaxLength(60) pageKey!: string;
  @IsString() @MaxLength(30) scope!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(1)
  @ValidateNested({ each: true }) @Type(() => PageEntityRefDto)
  refs!: PageEntityRefDto[];
  @IsISO8601({ strict: true }) @MaxLength(40) capturedAt!: string;
}

export class ResolvePageContextDto {
  @IsDefined() @ValidateNested() @Type(() => PageContextDto) pageContext!: PageContextDto;
}

export class ShareChatMessageDto {
  @IsString() @MaxLength(64) recipientId!: string;
}
