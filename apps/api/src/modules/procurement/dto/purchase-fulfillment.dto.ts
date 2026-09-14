import { IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, ArrayMaxSize } from 'class-validator';
export class FulfillmentMutationDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]{16,128}$/) requestId!: string;
  @IsInt() @Min(0) @Max(2147483646) expectedVersion!: number;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/) expectedSourceUpdatedAt!: string;
  @IsString() @MaxLength(2000) reason!: string;
}
export class ProposeFulfillmentDto extends FulfillmentMutationDto {
  @IsIn(['cancel', 'return', 'reversal', 'coverage']) kind!: 'cancel' | 'return' | 'reversal' | 'coverage';
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) @Max(99999999999.999) quantity!: number;
  @IsOptional() @IsString() @MaxLength(128) receiptId?: string;
  @IsOptional() @IsIn(['qualified', 'defective', 'pending_judgment', 'pending']) bucket?: 'qualified' | 'defective' | 'pending_judgment' | 'pending';
  @IsArray() @ArrayMaxSize(2000) @IsString({ each: true }) reflectedEntryIds!: string[];
}
