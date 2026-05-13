import { Controller, Get } from '@nestjs/common';

import { Permissions } from '../auth/decorators/permissions.decorator';
import { OpsCenterService } from './ops-center.service';

@Controller('ops-center')
export class OpsCenterController {
  constructor(private readonly opsCenterService: OpsCenterService) {}

  @Get('overview')
  @Permissions('page:ops-center')
  getOverview() {
    return this.opsCenterService.getOverview();
  }

  @Get('api-errors')
  @Permissions('page:ops-api-errors')
  getApiErrors() {
    return this.opsCenterService.getApiErrors();
  }

  @Get('database')
  @Permissions('page:ops-database')
  getDatabaseMonitoring() {
    return this.opsCenterService.getDatabaseMonitoring();
  }

  @Get('services-tasks')
  @Permissions('page:ops-services-tasks')
  getServicesAndTasks() {
    return this.opsCenterService.getServicesAndTasks();
  }

  @Get('alerts-audit')
  @Permissions('page:ops-alerts-audit')
  getAlertsAuditSettings() {
    return this.opsCenterService.getAlertsAuditSettings();
  }
}
