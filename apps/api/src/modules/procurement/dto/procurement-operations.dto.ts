import { IsIn, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, IsInt, IsObject } from 'class-validator';

export class ProcurementOperationsQueryDto {
  @IsString() @MaxLength(120) productId!: string;
  @IsOptional() @IsString() @MaxLength(120) treeNodeId?: string;
  @IsOptional() @IsString() @MaxLength(120) stockPlanId?: string;
  @IsOptional() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) month?: string;
}

export class SaveProductionReportDto {
  @IsString() @MaxLength(120) productId!: string;
  @IsString() @MaxLength(120) treeNodeId!: string;
  @IsOptional() @IsString() @MaxLength(120) stockPlanId?: string | null;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) reportDate!: string;
  @IsString() @MaxLength(80) shift!: string;
  @IsString() @MaxLength(120) lineName!: string;
  @IsString() @MaxLength(24) unit!: string;
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) @Max(99999999999.999) plannedQty!: number;
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) @Max(99999999999.999) actualQty!: number;
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) @Max(99999999999.999) goodQty!: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(99999999.99) workHours!: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) @Max(99999999999.999) capacityQty?: number | null;
  @IsOptional() @IsString() @MaxLength(4000) note?: string | null;
  @IsOptional() @IsString() @MaxLength(50) baseUpdatedAt?: string;
}

export class SaveQualityRecordDto {
  @IsString() @MaxLength(120) productId!: string;
  @IsString() @MaxLength(120) treeNodeId!: string;
  @IsOptional() @IsString() @MaxLength(120) stockPlanId?: string | null;
  @IsOptional() @IsString() @MaxLength(120) taskId?: string | null;
  @IsOptional() @IsString() @MaxLength(120) materialId?: string | null;
  @IsOptional() @IsString() @MaxLength(120) supplierId?: string | null;
  @IsOptional() @IsString() @MaxLength(120) productionReportId?: string | null;
  @IsIn(['procurement', 'production', 'warehouse', 'after_sales']) source!: 'procurement' | 'production' | 'warehouse' | 'after_sales';
  @IsString() @MaxLength(120) batchNo!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) inspectionDate!: string;
  @IsString() @MaxLength(24) unit!: string;
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) @Max(99999999999.999) inspectedQty!: number;
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) @Max(99999999999.999) defectiveQty!: number;
  @IsString() @MaxLength(4000) issue!: string;
  @IsIn(['pending', 'return', 'rework', 'scrap', 'concession', 'replacement']) disposition!: string;
  @IsIn(['open', 'processing', 'closed']) status!: 'open' | 'processing' | 'closed';
  @IsOptional() @IsString() @MaxLength(4000) resolution?: string | null;
  @IsOptional() @IsString() @MaxLength(50) baseUpdatedAt?: string;
}

export class VerifyQualityRecordDto {
  @IsOptional() @IsIn(['remaining', 'all']) scope?: 'remaining' | 'all';
  @Matches(/^[A-Za-z0-9_-]{16,128}$/) requestId!: string;
  @IsString() @MaxLength(50) baseUpdatedAt!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) verificationDate!: string;
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) @Max(99999999999.999) inspectedQty!: number;
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) @Max(99999999999.999) passedQty!: number;
  @IsString() @MaxLength(4000) evidence!: string;
}

export class QualityAnalysisCommandDto {
  @Matches(/^[A-Za-z0-9_-]{16,128}$/) requestId!: string;
  @IsInt() @Min(0) version!: number;
  @IsString() @MaxLength(50) baseUpdatedAt!: string;
  @IsIn(['save', 'confirm']) action!: string;
  @IsObject() data!: Record<string, unknown>;
}

export class ReopenQualityRecordDto {
  @Matches(/^[A-Za-z0-9_-]{16,128}$/) requestId!: string;
  @IsString() @MaxLength(50) baseUpdatedAt!: string;
  @IsString() @MaxLength(4000) reason!: string;
}
