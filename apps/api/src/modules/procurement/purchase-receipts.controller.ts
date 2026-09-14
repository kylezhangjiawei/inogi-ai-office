import { Body, Controller, Get, Param, Post, Request } from '@nestjs/common';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { CreatePurchaseInspectionDto, CreatePurchaseReceiptDto } from './dto/purchase-receipts.dto';
import { PurchaseReceiptsService } from './purchase-receipts.service';
import type { ProcActor } from './procurement.types';

type AuthedRequest = { user: { id: string; name?: string; username?: string; permissions: string[] } };

@Controller('procurement/purchase-order-lines/:lineId/receipts')
export class PurchaseReceiptsController {
  constructor(private readonly service: PurchaseReceiptsService) {}

  private actor(req: AuthedRequest): ProcActor {
    return { id: req.user.id, name: req.user.name ?? req.user.username ?? '', permissions: req.user.permissions ?? [] };
  }

  @Get()
  @Permissions('page:purchase-order-detail')
  list(@Param('lineId') lineId: string, @Request() req: AuthedRequest) { return this.service.list(lineId, this.actor(req)); }

  @Post()
  @Permissions('proc-purchase-order:receive')
  receive(@Param('lineId') lineId: string, @Body() input: CreatePurchaseReceiptDto, @Request() req: AuthedRequest) {
    return this.service.receive(lineId, input, this.actor(req));
  }

  @Post(':receiptId/inspections')
  @Permissions('proc-purchase-order:inspect')
  inspect(@Param('lineId') lineId: string, @Param('receiptId') receiptId: string, @Body() input: CreatePurchaseInspectionDto, @Request() req: AuthedRequest) {
    return this.service.inspect(lineId, receiptId, input, this.actor(req));
  }
}
