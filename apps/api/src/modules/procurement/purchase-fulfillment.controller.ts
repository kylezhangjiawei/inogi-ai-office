import { Body, Controller, Get, Param, Post, Request } from '@nestjs/common';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { FulfillmentMutationDto, ProposeFulfillmentDto } from './dto/purchase-fulfillment.dto';
import { PurchaseFulfillmentService } from './purchase-fulfillment.service';
import type { ProcActor } from './procurement.types';
type AuthedRequest = { user: { id: string; name?: string; username?: string; permissions: string[] } };
@Controller('procurement/purchase-order-lines/:lineId/fulfillment')
export class PurchaseFulfillmentController {
  constructor(private readonly service: PurchaseFulfillmentService) {}
  private actor(req: AuthedRequest): ProcActor { return { id: req.user.id, name: req.user.name ?? req.user.username ?? '', permissions: req.user.permissions ?? [] }; }
  @Get() @Permissions('page:purchase-order-detail')
  list(@Param('lineId') lineId: string, @Request() req: AuthedRequest) { return this.service.list(lineId, this.actor(req)); }
  @Post() @Permissions('proc-purchase-order:adjust-fulfillment')
  propose(@Param('lineId') lineId: string, @Body() input: ProposeFulfillmentDto, @Request() req: AuthedRequest) { return this.service.propose(lineId, input, this.actor(req)); }
  @Post(':entryId/approve') @Permissions('proc-purchase-order:approve-fulfillment')
  approve(@Param('lineId') lineId: string, @Param('entryId') entryId: string, @Body() input: FulfillmentMutationDto, @Request() req: AuthedRequest) { return this.service.decide(lineId, entryId, 'approved', input, this.actor(req)); }
  @Post(':entryId/revoke') @Permissions('proc-purchase-order:adjust-fulfillment')
  revoke(@Param('lineId') lineId: string, @Param('entryId') entryId: string, @Body() input: FulfillmentMutationDto, @Request() req: AuthedRequest) { return this.service.decide(lineId, entryId, 'revoked', input, this.actor(req)); }
}
