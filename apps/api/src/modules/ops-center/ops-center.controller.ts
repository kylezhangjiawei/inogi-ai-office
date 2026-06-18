import { Body, Controller, Get, Post, Query } from '@nestjs/common';

import { Permissions } from '../auth/decorators/permissions.decorator';
import { OpsCenterService, type ApiErrorQuery } from './ops-center.service';

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
  getApiErrors(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('statusClass') statusClass?: ApiErrorQuery['statusClass'],
    @Query('method') method?: string,
    @Query('keyword') keyword?: string,
    @Query('errorsOnly') errorsOnly?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.opsCenterService.getApiErrors({
      from,
      to,
      statusClass,
      method,
      keyword,
      errorsOnly: errorsOnly === 'true' || errorsOnly === '1',
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get('endpoint-stats')
  @Permissions('page:ops-api-errors')
  getEndpointStats(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('sort') sort?: 'errors' | 'calls' | 'latency',
  ) {
    return this.opsCenterService.getEndpointStats({ from, to, sort });
  }

  @Post('api-errors/analyze')
  @Permissions('page:ops-api-errors')
  analyzeApiError(@Body() body: { request_id?: string; force?: boolean }) {
    return this.opsCenterService.analyzeApiError({ request_id: body?.request_id, force: body?.force });
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
