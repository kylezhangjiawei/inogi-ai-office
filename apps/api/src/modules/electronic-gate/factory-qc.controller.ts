import { Body, Controller, Get, Param, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { FactoryQcService } from './factory-qc.service';
import { ElectronicGateService } from './electronic-gate.service';
import type { FactoryQcActor } from './factory-qc.management';
type ActorRequest = Request & { user?: FactoryQcActor };

/** Raw end bypasses Express conditional JSON handling and ETag generation. */
function prepareFactoryJson(response: Response): void {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  response.setHeader('Pragma', 'no-cache');
  response.setHeader('Expires', '0');
  response.removeHeader('ETag');
  response.removeHeader('Last-Modified');
}
export function sendFactoryJson(response: Response, value: unknown): void {
  const body = JSON.stringify(value);
  response.status(200);
  prepareFactoryJson(response);
  response.end(body);
}

@Public()
@Controller('factory-qc')
export class FactoryQcPublicController {
  constructor(private readonly service: FactoryQcService, private readonly gate: ElectronicGateService) {}
  @Get('rules')
  async rules(@Res() response: Response) { prepareFactoryJson(response); sendFactoryJson(response, await this.gate.downloadRules()); }
  @Get('serial')
  async serial(@Res() response: Response) { prepareFactoryJson(response); sendFactoryJson(response, await this.service.downloadSerial()); }
  @Get('protocol')
  async protocol(@Res() response: Response) { prepareFactoryJson(response); sendFactoryJson(response, await this.service.downloadProtocol()); }
}

@Controller('electronic-gate/factory-qc')
@Permissions('page:electronic-gate')
export class FactoryQcManagementController {
  constructor(private readonly service: FactoryQcService) {}
  @Get() state() { return this.service.getState(); }
  @Get('protocol/example') example() { return this.service.example(); }
  @Put('protocol/draft') saveCatalog(@Body() body: unknown) { return this.service.saveCatalogDraft(body); }
  @Post('protocol/publish') publishCatalog(@Body() body: unknown, @Req() request: ActorRequest) { return this.service.publishCatalog(body, request.user ?? {}); }
  @Put('commands/:profileId/:commandId/draft') saveCommand(@Param('profileId') profileId: string, @Param('commandId') commandId: string, @Body() body: unknown) { return this.service.saveCommandDraft(profileId, commandId, body); }
  @Post('commands/:profileId/:commandId/publish') publishCommand(@Param('profileId') profileId: string, @Param('commandId') commandId: string, @Body() body: unknown, @Req() request: ActorRequest) { return this.service.publishCommand(profileId, commandId, body, request.user ?? {}); }
  @Get('history') history(@Query('kind') kind: string) { return this.service.history(kind); }
  @Get('history/:version') historyVersion(@Param('version') version: string, @Query('kind') kind: string) { return this.service.historyVersion(kind, version); }
  @Post('rollback') rollback(@Body() body: unknown, @Req() request: ActorRequest) { return this.service.rollback(body, request.user ?? {}); }
}
