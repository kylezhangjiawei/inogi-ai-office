import { Body, Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { DeviceInspectionRecordsService } from './device-inspection-records.service';
import { DeviceInspectionUploadGuard } from './device-inspection-upload.guard';
import { boundedText, parseQuery } from './device-inspection-records.contract';

@Public()
@UseGuards(DeviceInspectionUploadGuard)
@Controller('factory-qc/records')
export class DeviceInspectionUploadController {
  constructor(private readonly service: DeviceInspectionRecordsService) {}
  @Post()
  async upload(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const result = await this.service.upload(body);
    response.status(result.duplicate ? 200 : 201);
    response.setHeader('Cache-Control', 'no-store');
    return result;
  }
}

@Controller('device-inspection-records')
@Permissions('page:device-inspection-records')
export class DeviceInspectionRecordsController {
  constructor(private readonly service: DeviceInspectionRecordsService) {}
  @Get()
  list(@Query() query: Record<string, unknown>) { return this.service.list(parseQuery(query)); }
  @Get(':id/history')
  history(@Param('id') id: string, @Query() query: Record<string, unknown>) { return this.service.history(boundedText(id, '记录id', 128, false), parseQuery(query, true)); }
  @Get(':id')
  detail(@Param('id') id: string) { return this.service.detail(boundedText(id, '记录id', 128, false)); }
}
