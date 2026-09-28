import { Body, Controller, Get, Param, Post, Query, Request } from '@nestjs/common';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { PurchaseDeliveryService } from './purchase-delivery.service';
import { RecordSupplierCommitmentDto } from './dto/purchase-delivery.dto';
import type { ProcActor } from './procurement.types';
type AuthedRequest = { user: { id: string; name?: string; username?: string; permissions: string[] } };

@Controller('procurement/delivery')
export class PurchaseDeliveryController {
  constructor(private readonly service: PurchaseDeliveryService) {}
  private actor(req: AuthedRequest): ProcActor { return { id: req.user.id, name: req.user.name ?? req.user.username ?? '', permissions: req.user.permissions ?? [] }; }
  @Get('schedule') @Permissions('page:purchase-orders', 'page:purchase-order-detail')
  schedule(@Query() query: Record<string, unknown>, @Request() req: AuthedRequest) { return this.service.schedule(query, this.actor(req)); }
  @Get('lines/:lineId') @Permissions('page:purchase-orders', 'page:purchase-order-detail')
  get(@Param('lineId') id: string, @Query() query: Record<string, unknown>, @Request() req: AuthedRequest) { return this.service.get(id, query, this.actor(req)); }
  @Get('lines/:lineId/impacts') @Permissions('page:purchase-orders', 'page:purchase-order-detail')
  impacts(@Param('lineId') id: string, @Query() query: Record<string, unknown>, @Request() req: AuthedRequest) { return this.service.impacts(id, query, this.actor(req)); }
  @Post('lines/:lineId/commitments') @Permissions('proc-purchase-order:record-commitment')
  record(@Param('lineId') id: string, @Body() input: RecordSupplierCommitmentDto, @Request() req: AuthedRequest) { return this.service.record(id, input, this.actor(req)); }
}
