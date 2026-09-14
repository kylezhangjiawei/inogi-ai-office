import { IsInt, IsNumber, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

class ReceiptMutationDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]{16,128}$/) requestId!: string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/) expectedSourceUpdatedAt!: string;
}

export class CreatePurchaseReceiptDto extends ReceiptMutationDto {
  @IsString() @MinLength(1) @MaxLength(120) deliveryNo!: string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) receivedDate!: string;
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) @Max(99999999999.999) receivedQty!: number;
  @IsString() @MaxLength(2000) note!: string;
}

export class CreatePurchaseInspectionDto extends ReceiptMutationDto {
  @IsInt() @Min(0) @Max(2147483646) expectedVersion!: number;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) inspectionDate!: string;
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) @Max(99999999999.999) qualifiedQty!: number;
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) @Max(99999999999.999) defectiveQty!: number;
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) @Max(99999999999.999) pendingJudgmentQty!: number;
  @IsString() @MinLength(1) @MaxLength(2000) basis!: string;
  @IsString() @MinLength(1) @MaxLength(2000) note!: string;
}
