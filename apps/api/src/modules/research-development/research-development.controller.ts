import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Request, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';

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

type AuthedRequest = { user?: { id?: string; name?: string; role?: string; permissions?: string[] } };

/** Determines if the current request belongs to a manager who can view all cross-user data. */
function buildViewer(req: AuthedRequest): { userId?: string; hasFullAccess: boolean } {
  const perms = req.user?.permissions ?? [];
  const hasFullAccess = perms.includes('*') || perms.includes('rd-task:reassign');
  return { userId: req.user?.id, hasFullAccess };
}

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

  @Post('task-categories/tasks')
  @Permissions('rd-task:create')
  createTask(@Body() payload: Record<string, unknown>) {
    return this.rdService.createTask(payload);
  }

  @Patch('task-categories/tasks/:taskId')
  @Permissions('rd-task:edit')
  updateTask(@Param('taskId') taskId: string, @Body() payload: Record<string, unknown>) {
    return this.rdService.updateTask(taskId, payload);
  }

  @Delete('task-categories/tasks/:taskId')
  @Permissions('rd-task:edit')
  deleteTask(@Param('taskId') taskId: string) {
    return this.rdService.deleteTask(taskId);
  }

  @Delete('task-data')
  @Permissions('rd-data:clear')
  clearTaskData() {
    return this.rdService.clearAllTaskData();
  }

  @Get('task-progress-notes')
  listTaskProgressNotes(@Request() req: AuthedRequest) {
    return this.rdService.listAllTaskProgressNotes(buildViewer(req));
  }

  @Get('task-progress-notes/:taskId')
  getTaskProgressNotes(@Param('taskId') taskId: string, @Request() req: AuthedRequest) {
    return this.rdService.getTaskProgressNotes(taskId, buildViewer(req));
  }

  @Post('task-progress-notes')
  @Permissions('page:rd-my-workspace', 'rd-task:edit', 'rd-task:create')
  @UseInterceptors(FilesInterceptor('files', 5))
  createTaskProgressNote(
    @UploadedFiles() files: Array<{ originalname: string; mimetype?: string; size?: number; buffer: Buffer }> | undefined,
    @Body()
    body: {
      task_id?: string;
      text?: string;
      progress?: string | number;
      actor_name?: string;
      actor_role?: string;
    },
    @Request() req: { user?: { id?: string; name?: string; role?: string } },
  ) {
    const progressRaw = body.progress;
    const progress =
      typeof progressRaw === 'number'
        ? progressRaw
        : progressRaw !== undefined && progressRaw !== ''
          ? Number(progressRaw)
          : undefined;
    return this.rdService.createTaskProgressNote({
      taskId: body.task_id ?? '',
      text: body.text ?? '',
      progress: Number.isFinite(progress) ? (progress as number) : undefined,
      actor: {
        id: req.user?.id,
        name: body.actor_name || req.user?.name,
        role: body.actor_role || req.user?.role,
      },
      files: files ?? [],
    });
  }

  @Get('daily-reports')
  listDailyReports(
    @Request() req: AuthedRequest,
    @Query('user_id') userId?: string,
    @Query('date') date?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit ? Number(limit) : undefined;
    return this.rdService.listDailyReports(
      {
        user_id: userId,
        date,
        limit: Number.isFinite(parsedLimit) ? (parsedLimit as number) : undefined,
      },
      buildViewer(req),
    );
  }

  @Post('daily-reports')
  @Permissions('page:rd-my-workspace', 'rd-task:edit', 'rd-task:create')
  createDailyReport(
    @Body() body: { user_id?: string; user_name?: string; date?: string },
    @Request() req: { user?: { id?: string; name?: string } },
  ) {
    return this.rdService.createDailyReport({
      user_id: body.user_id || req.user?.id,
      user_name: body.user_name || req.user?.name,
      date: body.date,
      trigger: 'manual',
    });
  }

  @Post('daily-reports/regenerate-all')
  @Permissions('rd-task:reassign', 'rd-task:edit', 'page:rd-director-dashboard')
  regenerateAllDailyReports(@Body() body: { date?: string }) {
    return this.rdService.generateDailyReportsForAll(body?.date);
  }

  @Get('messages')
  listMessages(
    @Request() req: AuthedRequest,
    @Query('recipient_id') recipientId?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit ? Number(limit) : undefined;
    return this.rdService.listMessages(
      {
        user_id: req.user?.id,
        recipient_id: recipientId,
        limit: Number.isFinite(parsedLimit) ? (parsedLimit as number) : undefined,
      },
      buildViewer(req),
    );
  }

  @Get('proposal-drafts')
  listProposalDrafts(@Request() req: AuthedRequest) {
    return this.rdService.listProposalDrafts(buildViewer(req));
  }

  @Post('proposal-drafts')
  @Permissions('rd-project:propose', 'rd-project:direct', 'page:rd-director-dashboard')
  saveProposalDraft(
    @Body()
    body: {
      draft_id?: string;
      title?: string;
      description?: string;
      comment?: string;
      parent_project_id?: string;
      new_project_name?: string;
      tasks?: unknown[];
      file_names?: string[];
    },
    @Request() req: AuthedRequest,
  ) {
    return this.rdService.saveProposalDraft({
      ...body,
      author: { id: req.user?.id, name: req.user?.name, role: req.user?.role },
    });
  }

  @Delete('proposal-drafts/:draftId')
  @Permissions('rd-project:propose', 'rd-project:direct')
  deleteProposalDraft(@Param('draftId') draftId: string, @Request() req: AuthedRequest) {
    return this.rdService.deleteProposalDraft(draftId, buildViewer(req));
  }

  @Post('messages')
  @Permissions('page:rd-director-dashboard', 'rd-people:manage', 'rd-task:reassign', 'rd-task:edit')
  createMessage(
    @Body()
    body: {
      recipient_id?: string;
      recipient_person_id?: string;
      recipient_name?: string;
      subject?: string;
      body: string;
    },
    @Request() req: { user?: { id?: string; name?: string; role?: string } },
  ) {
    return this.rdService.createMessage({
      sender: {
        id: req.user?.id,
        name: req.user?.name,
        role: req.user?.role,
      },
      recipient_id: body.recipient_id,
      recipient_person_id: body.recipient_person_id,
      recipient_name: body.recipient_name,
      subject: body.subject,
      body: body.body,
    });
  }

  @Get('workspace')
  workspace(@Request() req: { user?: { id?: string } }) {
    return this.rdService.getWorkspace(req.user?.id);
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

  @Post('director-dashboard/recompute')
  @Permissions('rd-task:reassign', 'rd-task:edit', 'rd-task:create')
  recomputeDirectorDashboard() {
    return this.rdService.recomputeDashboard();
  }

  @Get('people')
  people() {
    return this.rdService.getPeople();
  }

  @Get('people/user-options')
  @Permissions('rd-people:manage')
  peopleUserOptions() {
    return this.rdService.getPeopleUserOptions();
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

  @Get('approval-pools')
  approvalPools(@Query('permissions') permissions?: string) {
    const permissionCodes = String(permissions ?? '')
      .split(',')
      .map((code) => code.trim())
      .filter(Boolean);
    return this.rdService.getApprovalPools(permissionCodes);
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
