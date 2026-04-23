import { Body, Controller, Delete, Get, Param, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';

import { ListIntegrationQueryDto } from './dto/list-integration-query.dto';
import { SaveAiModelDto } from './dto/save-ai-model.dto';
import { SaveMailboxDto } from './dto/save-mailbox.dto';
import { TestAiModelConnectionDto } from './dto/test-ai-model-connection.dto';
import { IntegrationManagementService } from './integration-management.service';

type AuthenticatedRequest = Request & {
  user?: {
    id: string;
  };
};

@Controller('integration-management')
export class IntegrationManagementController {
  constructor(private readonly integrationManagementService: IntegrationManagementService) {}

  @Get('security/public-key')
  getSecurityPublicKey() {
    return this.integrationManagementService.getSecurityPublicKey();
  }

  @Get('mailboxes')
  listMailboxes(@Query() query: ListIntegrationQueryDto) {
    return this.integrationManagementService.listMailboxes(query);
  }

  @Post('mailboxes')
  saveMailbox(@Body() payload: SaveMailboxDto, @Req() req: AuthenticatedRequest) {
    return this.integrationManagementService.saveMailbox(payload, req.user?.id);
  }

  @Delete('mailboxes/:mailboxId')
  deleteMailbox(@Param('mailboxId') mailboxId: string) {
    return this.integrationManagementService.deleteMailbox(mailboxId);
  }

  @Get('ai-models')
  listAiModels(@Query() query: ListIntegrationQueryDto) {
    return this.integrationManagementService.listAiModels(query);
  }

  @Post('ai-models')
  saveAiModel(@Body() payload: SaveAiModelDto, @Req() req: AuthenticatedRequest) {
    return this.integrationManagementService.saveAiModel(payload, req.user?.id);
  }

  @Post('ai-models/test')
  testAiModelConnection(@Body() payload: TestAiModelConnectionDto) {
    return this.integrationManagementService.testAiModelConnection(payload);
  }

  @Delete('ai-models/:modelId')
  deleteAiModel(@Param('modelId') modelId: string) {
    return this.integrationManagementService.deleteAiModel(modelId);
  }
}
