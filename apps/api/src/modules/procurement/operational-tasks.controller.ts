import { Body, Controller, Get, Param, Post, Query, Request } from '@nestjs/common';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { OperationalTasksService } from './operational-tasks.service';
type RequestUser = { user: { id: string; name?: string; username?: string; permissions: string[] } };
@Controller('procurement/operational-tasks')
export class OperationalTasksController {
  constructor(private readonly service: OperationalTasksService) {}
  private actor(req: RequestUser) { return { id: req.user.id, name: req.user.name ?? req.user.username ?? '', permissions: req.user.permissions ?? [] }; }
  @Get() @Permissions('page:purchase-order-detail')
  list(@Query() query: Record<string, string>, @Request() req: RequestUser) { return this.service.list(query, this.actor(req)); }
  @Get('candidates') @Permissions('proc-operations:assign')
  candidates(@Request() req: RequestUser) { return this.service.candidates(this.actor(req)); }
  @Post(':kind/:id/assignment') @Permissions('proc-operations:assign')
  assign(@Param('kind') kind: string, @Param('id') id: string, @Body() body: Record<string, unknown>, @Request() req: RequestUser) { return this.service.assign(kind, id, body, this.actor(req)); }
}
