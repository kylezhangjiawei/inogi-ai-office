import { Body, Controller, Get, Param, Post, Query, Request } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { SupplierQualificationsService, type SupplyQualificationStatus } from './supplier-qualifications.service';
import type { ProcActor } from './procurement.types';
export class QualificationCommandDto {
  @Matches(/^[A-Za-z0-9_-]{16,128}$/) requestId!: string;
  @IsInt() @Min(0) version!: number;
  @IsString() @MaxLength(100) materialId!: string;
  @IsString() @MaxLength(100) supplierId!: string;
  @IsIn(['pending', 'approved', 'suspended', 'withdrawn']) status!: SupplyQualificationStatus;
  @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) productIds!: string[];
  @IsString() @MaxLength(10) effectiveFrom!: string;
  @IsOptional() @IsString() @MaxLength(10) effectiveUntil?: string;
  @IsString() @MaxLength(2000) reason!: string;
  @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) evidenceFileIds!: string[];
}
@Controller('procurement/supplier-qualifications')
export class SupplierQualificationsController {
  constructor(private readonly service: SupplierQualificationsService) {}
  private actor(req: { user: ProcActor }) { return req.user; }
  @Get() @Permissions('page:proc-materials', 'page:proc-quote-book')
  list(@Request() req: { user: ProcActor }, @Query('materialId') materialId?: string, @Query('supplierId') supplierId?: string) { return this.service.list(this.actor(req), materialId, supplierId); }
  @Get(':id/files/:fileId') @Permissions('page:proc-materials', 'page:proc-quote-book')
  attachment(@Param('id') id: string, @Param('fileId') fileId: string, @Request() req: { user: ProcActor }) { return this.service.attachment(id, fileId, this.actor(req)); }
  @Post() @Permissions('page:proc-materials', 'page:proc-quote-book')
  save(@Body() input: QualificationCommandDto, @Request() req: { user: ProcActor }) { return this.service.save(input, this.actor(req)); }
}
