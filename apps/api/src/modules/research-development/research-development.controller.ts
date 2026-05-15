import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';

import { Permissions } from '../auth/decorators/permissions.decorator';
import { ResearchDevelopmentService } from './research-development.service';

const RD_READ_PERMISSIONS = [
  'page:rd-task-management',
  'page:rd-my-workspace',
  'page:rd-director-dashboard',
  'page:rd-approval-flow',
  'page:rd-audit-log',
  'page:rd-ai-settings',
];

@Controller('research-development')
@Permissions(...RD_READ_PERMISSIONS)
export class ResearchDevelopmentController {
  constructor(private readonly rdService: ResearchDevelopmentService) {}

  @Get('snapshot')
  snapshot() {
    return this.rdService.snapshot();
  }

  @Get('task-categories')
  taskCategories() {
    return this.rdService.getTaskCategories();
  }

  @Put('task-categories')
  @Permissions('rd-task:create', 'rd-task:edit')
  saveTaskCategories(@Body() payload: unknown[]) {
    return this.rdService.saveTaskCategories(payload);
  }

  @Get('workspace')
  workspace() {
    return this.rdService.getWorkspace();
  }

  @Put('workspace')
  @Permissions('rd-task:create', 'rd-task:edit')
  saveWorkspace(@Body() payload: Record<string, unknown>) {
    return this.rdService.saveWorkspace(payload);
  }

  @Get('director-dashboard')
  directorDashboard() {
    return this.rdService.getDirectorDashboard();
  }

  @Put('director-dashboard')
  @Permissions('rd-task:reassign', 'rd-task:edit')
  saveDirectorDashboard(@Body() payload: Record<string, unknown>) {
    return this.rdService.saveDirectorDashboard(payload);
  }

  @Get('people')
  people() {
    return this.rdService.getPeople();
  }

  @Post('people')
  @Permissions('rd-people:manage')
  createPerson(@Body() payload: Record<string, unknown>) {
    return this.rdService.createPerson(payload);
  }

  @Patch('people/:id')
  @Permissions('rd-people:manage')
  updatePerson(@Param('id') id: string, @Body() payload: Record<string, unknown>) {
    return this.rdService.updatePerson(id, payload);
  }

  @Delete('people/:id')
  @Permissions('rd-people:manage')
  removePerson(@Param('id') id: string) {
    return this.rdService.removePerson(id);
  }

  @Get('approval-flows')
  approvalFlows() {
    return this.rdService.getApprovalFlows();
  }

  @Put('approval-flows')
  @Permissions('rd-approval-flow:manage')
  saveApprovalFlows(@Body() payload: unknown[]) {
    return this.rdService.saveApprovalFlows(payload);
  }

  @Get('audit-logs')
  auditLogs() {
    return this.rdService.getAuditLogs();
  }

  @Post('audit-logs')
  createAuditLog(@Body() payload: Record<string, unknown>) {
    return this.rdService.createAuditLog(payload);
  }

  @Delete('audit-logs')
  @Permissions('rd-audit:clear')
  clearAuditLogs() {
    return this.rdService.clearAuditLogs();
  }

  @Get('ai-settings')
  @Permissions(...RD_READ_PERMISSIONS, 'page:ai-model-management', 'rd-ai:configure')
  aiSettings() {
    return this.rdService.getAiSettings();
  }

  @Put('ai-settings')
  @Permissions('rd-ai:configure', 'page:ai-model-management')
  saveAiSettings(@Body() payload: Record<string, unknown>) {
    return this.rdService.saveAiSettings(payload);
  }

  @Post('file-ingestion/plan')
  @Permissions(...RD_READ_PERMISSIONS, 'page:ai-model-management', 'rd-ai:configure')
  planFileIngestion(@Body() payload: Record<string, unknown>) {
    return this.rdService.planFileIngestion(payload);
  }
}
