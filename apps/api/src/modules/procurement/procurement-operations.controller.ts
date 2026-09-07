import { Body, Controller, Get, Param, Post, Put, Query, Request } from '@nestjs/common';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { ProcurementOperationsQueryDto, SaveProductionReportDto, SaveQualityRecordDto } from './dto/procurement-operations.dto';
import { ProcurementOperationsService } from './procurement-operations.service';
import type { ProcActor } from './procurement.types';

type AuthedRequest = { user: { id: string; name?: string; username?: string; permissions: string[] } };

@Controller('procurement/operations')
export class ProcurementOperationsController {
  constructor(private readonly service: ProcurementOperationsService) {}

  private actor(req: AuthedRequest): ProcActor {
    return { id: req.user.id, name: req.user.name ?? req.user.username ?? '', permissions: req.user.permissions ?? [] };
  }

  @Get()
  @Permissions('page:proc-cockpit', 'page:rd-director-dashboard')
  list(@Query() query: ProcurementOperationsQueryDto) { return this.service.list(query); }

  @Get('options')
  @Permissions('page:proc-cockpit', 'page:rd-director-dashboard')
  options(@Query() query: ProcurementOperationsQueryDto) { return this.service.options(query); }

  @Get('production-task-source/:taskId')
  @Permissions('page:rd-director-dashboard')
  productionTaskSource(@Param('taskId') taskId: string) { return this.service.productionTaskSource(taskId); }

  @Post('production-reports')
  @Permissions('proc-production:report')
  createProduction(@Body() dto: SaveProductionReportDto, @Request() req: AuthedRequest) {
    return this.service.saveProductionReport(null, dto, this.actor(req));
  }

  @Put('production-reports/:id')
  @Permissions('proc-production:report')
  updateProduction(@Param('id') id: string, @Body() dto: SaveProductionReportDto, @Request() req: AuthedRequest) {
    return this.service.saveProductionReport(id, dto, this.actor(req));
  }

  @Post('quality-records')
  @Permissions('proc-quality:manage')
  createQuality(@Body() dto: SaveQualityRecordDto, @Request() req: AuthedRequest) {
    return this.service.saveQualityRecord(null, dto, this.actor(req));
  }

  @Put('quality-records/:id')
  @Permissions('proc-quality:manage')
  updateQuality(@Param('id') id: string, @Body() dto: SaveQualityRecordDto, @Request() req: AuthedRequest) {
    return this.service.saveQualityRecord(id, dto, this.actor(req));
  }
}
