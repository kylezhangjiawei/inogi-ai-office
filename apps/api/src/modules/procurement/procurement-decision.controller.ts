import { Controller, Get, Param, Query, Request } from '@nestjs/common';
import { Permissions } from '../auth/decorators/permissions.decorator';
import type { ProcActor } from './procurement.types';
import { ProcurementDecisionService } from './procurement-decision.service';
@Controller('procurement/tasks')
export class ProcurementDecisionController {
  constructor(private readonly service: ProcurementDecisionService) {}
  @Get(':id/decision') @Permissions('page:proc-cockpit', 'page:proc-materials', 'page:proc-my-workspace')
  read(@Param('id') id: string, @Query('planId') planId: string | undefined, @Query('batchId') batchId: string | undefined, @Query('date') date: string | undefined, @Request() req: { user: ProcActor }) { return this.service.read(id, { planId, batchId, date }, req.user); }
}
