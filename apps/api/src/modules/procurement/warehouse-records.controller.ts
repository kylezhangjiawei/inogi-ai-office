import { Body, Controller, Get, Param, Post, Request } from '@nestjs/common';
import { ErpPurchaseReceiptService } from './erp-purchase-receipt.service';
import { IsInt, IsObject, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { WarehouseRecordsService } from './warehouse-records.service';
class RecordCommandDto {
  @Matches(/^[A-Za-z0-9_-]{16,128}$/) requestId!: string;
  @IsString() @MaxLength(40) action!: string;
  @IsOptional() @IsString() @MaxLength(128) id?: string;
  @IsOptional() @IsInt() @Min(1) version?: number;
  @IsObject() data!: Record<string, unknown>;
}
type AuthedRequest = { user: { id: string; name?: string; permissions: string[] } };
class ErpReceiptDto {
  @Matches(/^[A-Za-z0-9_-]{16,128}$/) requestId!: string;
  @IsString() @MaxLength(128) recordId!: string;
  @IsInt() @Min(1) expectedVersion!: number;
  @IsString() @MaxLength(100) warehouseCode!: string;
  @IsString() @MaxLength(10) date!: string;
  @IsString() @MaxLength(1000) reason!: string;
}
@Controller('procurement/warehouse-records')
export class WarehouseRecordsController {
  constructor(private readonly service: WarehouseRecordsService, private readonly erp: ErpPurchaseReceiptService) {}
  private actor(req: AuthedRequest) { return { id: req.user.id, name: req.user.name ?? '', permissions: req.user.permissions }; }
  @Get() @Permissions('page:warehouse-flow', 'page:production-execution', 'page:warehouse-count')
  async list(@Request() req: AuthedRequest) {
    const actor = this.actor(req), data = await this.service.list(actor);
    const erpReceipts = actor.permissions.includes('*') || actor.permissions.includes('page:warehouse-flow') ? await this.erp.list(actor) : [];
    return { ...data, erpReceipts };
  }
  @Get('erp-warehouses') @Permissions('page:warehouse-flow')
  warehouses(@Request() req: AuthedRequest) { return this.erp.warehouses(this.actor(req)); }
  @Post('erp-receipts') @Permissions('page:warehouse-flow')
  createErpReceipt(@Body() input: ErpReceiptDto, @Request() req: AuthedRequest) { return this.erp.create(input, this.actor(req)); }
  @Post('erp-receipts/:recordId/refresh') @Permissions('page:warehouse-flow')
  refreshErpReceipt(@Param('recordId') id: string, @Request() req: AuthedRequest) { return this.erp.refresh(id, this.actor(req)); }
  @Post() @Permissions('page:warehouse-flow', 'page:production-execution', 'page:warehouse-count')
  command(@Body() input: RecordCommandDto, @Request() req: AuthedRequest) { return this.service.command(input, this.actor(req)); }
}
