import { Controller, Get, Query, Request } from '@nestjs/common';
import { ManagementRiskService } from './management-risk.service';
@Controller('procurement/management-risk')
export class ManagementRiskController {
  constructor(private readonly service: ManagementRiskService) {}
  @Get()
  read(@Query('month') month: string, @Query('productId') productId: string | undefined, @Request() req: { user: { id: string; name?: string; permissions: string[] } }) { return this.service.read(month, productId, { ...req.user, name: req.user.name ?? '' }); }
}
