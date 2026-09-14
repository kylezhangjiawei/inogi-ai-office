import { IsBoolean, IsInt, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';

export class RecordSupplierCommitmentDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]{16,128}$/) requestId!: string;
  @IsString() @MaxLength(256) orderNo!: string;
  @ValidateIf((_object, value) => value !== null) @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  promisedDate!: string | null;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) communicatedOn!: string;
  @IsString() @MaxLength(2000) evidence!: string;
  @IsString() @MaxLength(2000) reason!: string;
  @IsBoolean() declareOriginal!: boolean;
  @IsInt() @Min(0) @Max(2147483645) expectedVersion!: number;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/) expectedSourceUpdatedAt!: string;
}
