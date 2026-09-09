import { Body, Controller, Get, Param, Post, Put, Req } from '@nestjs/common';
import { Request } from 'express';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { ElectronicGateService } from './electronic-gate.service';

type GateRequest = Request & { user?: { id?: string; name?: string } };

@Controller('electronic-gate')
@Permissions('page:electronic-gate')
export class ElectronicGateController {
  constructor(private readonly service: ElectronicGateService) {}

  @Get()
  list() { return this.service.list(); }

  @Put(':id/draft')
  saveDraft(@Param('id') id: string, @Body() payload: unknown, @Req() request: GateRequest) {
    return this.service.saveDraft(id, payload, request.user ?? {});
  }

  @Post(':id/publish')
  publish(@Param('id') id: string, @Body() payload: unknown, @Req() request: GateRequest) {
    return this.service.publish(id, payload, request.user ?? {});
  }
}
