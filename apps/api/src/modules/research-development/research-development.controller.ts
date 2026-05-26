import { Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Put, Query, Request, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';

import { Permissions } from '../auth/decorators/permissions.decorator';
import { OssService } from '../oss/oss.service';
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
  constructor(
    private readonly rdService: ResearchDevelopmentService,
    private readonly ossService: OssService,
  ) {}

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
  @Permissions('page:rd-my-workspace', 'rd-task:edit', 'rd-task:create', 'rd-task:reassign')
  updateTask(@Param('taskId') taskId: string, @Body() payload: Record<string, unknown>) {
    return this.rdService.updateTask(taskId, payload);
  }

  @Delete('task-categories/tasks/:taskId')
  @Permissions('rd-task:edit')
  deleteTask(@Param('taskId') taskId: string) {
    return this.rdService.deleteTask(taskId);
  }

  @Get('products')
  getProducts() {
    return this.rdService.getProducts();
  }

  @Put('products')
  @Permissions('rd-task:create', 'rd-task:edit')
  saveProducts(@Body() payload: unknown[]) {
    return this.rdService.saveProducts(payload);
  }

  @Get('product-task-categories/:productId')
  getProductTaskCategories(@Param('productId') productId: string) {
    return this.rdService.getProductTaskCategories(productId);
  }

  @Put('product-task-categories/:productId')
  @Permissions('rd-task:create', 'rd-task:edit')
  saveProductTaskCategories(@Param('productId') productId: string, @Body() payload: unknown[]) {
    return this.rdService.saveProductTaskCategoriesForProduct(productId, payload);
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

  @Patch('messages/:messageId')
  patchMessage(
    @Param('messageId') messageId: string,
    @Body() patch: Record<string, unknown>,
    @Request() req: AuthedRequest,
  ) {
    const { userId, hasFullAccess } = buildViewer(req);
    return this.rdService.patchMessage(messageId, patch as { read?: boolean; handled?: boolean }, { userId, hasFullAccess });
  }

  @Post('messages')
  @Permissions('page:rd-director-dashboard', 'rd-people:manage', 'rd-task:reassign', 'rd-task:edit', 'page:rd-my-workspace')
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
  workspace(@Request() req: { user?: { id?: string; name?: string } }) {
    return this.rdService.getWorkspace(req.user?.id, req.user?.name);
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

  // ── Knowledge Base ────────────────────────────────────────────────────────

  @Get('knowledge/categories')
  getKnowledgeCategories() {
    return this.rdService.getKnowledgeCategories();
  }

  @Put('knowledge/categories')
  @Permissions('rd-kb:manage')
  saveKnowledgeCategories(@Body() payload: unknown[]) {
    return this.rdService.saveKnowledgeCategories(payload);
  }

  @Post('knowledge/categories')
  @Permissions('rd-kb:manage')
  createKnowledgeCategory(
    @Body() body: { label?: unknown; parent_id?: unknown; icon?: unknown; color?: unknown },
  ) {
    return this.rdService.createKnowledgeCategory(body);
  }

  @Patch('knowledge/categories/:id')
  @Permissions('rd-kb:manage')
  updateKnowledgeCategory(
    @Param('id') id: string,
    @Body() body: { label?: unknown; icon?: unknown; color?: unknown },
  ) {
    return this.rdService.updateKnowledgeCategory(id, body);
  }

  @Delete('knowledge/categories/:id')
  @Permissions('rd-kb:manage')
  deleteKnowledgeCategory(@Param('id') id: string) {
    return this.rdService.deleteKnowledgeCategory(id);
  }

  @Get('knowledge/entries')
  getKnowledgeEntries(
    @Query('category_id') categoryId?: string,
    @Query('keyword') keyword?: string,
    @Query('source') source?: string,
    @Query('file_type') fileType?: string,
    @Query('visibility') visibility?: string,
    @Query('permission_level') permissionLevelStr?: string,
    @Request() req?: AuthedRequest,
  ) {
    const permissionLevel = permissionLevelStr ? Number(permissionLevelStr) : undefined;
    const viewer = req ? buildViewer(req) : undefined;
    return this.rdService.getKnowledgeEntries(
      { categoryId, keyword, source, fileType, visibility, permissionLevel: Number.isFinite(permissionLevel) ? permissionLevel : undefined },
      viewer,
    );
  }

  @Post('knowledge/classify-files')
  classifyKbFiles(@Body() body: { filenames?: string[] }) {
    const filenames = Array.isArray(body?.filenames) ? body.filenames.filter((f) => typeof f === 'string') : [];
    return this.rdService.classifyKbFiles(filenames);
  }

  /**
   * Step 1 of browser-direct-upload flow.
   * Returns a pre-signed OSS PUT URL for each file so the browser can upload
   * directly to OSS without going through our server.
   * Returns { enabled: false } when OSS is not configured (fallback to server upload).
   */
  @Post('knowledge/presign-upload')
  @Permissions('rd-kb:upload', 'rd-task:create')
  presignKbUpload(
    @Body() body: { files?: Array<{ filename: string; content_type?: string }> },
  ) {
    if (!this.ossService.isEnabled) {
      return { enabled: false, files: [] };
    }
    const files = (body.files ?? []).map(({ filename, content_type }) => {
      const ct = content_type || 'application/octet-stream';
      const objectKey = this.ossService.buildObjectKey('rd/knowledge', filename);
      const putUrl = this.ossService.generatePutSignedUrl(objectKey, ct);
      return { objectKey, putUrl, contentType: ct };
    });
    return { enabled: true, files };
  }

  /**
   * Step 2 of browser-direct-upload flow.
   * Called after the browser has already PUT files directly to OSS.
   * Creates KB entries pointing to the OSS object keys (no file transfer through server).
   */
  @Post('knowledge/entries/from-oss-keys')
  @Permissions('rd-kb:upload', 'rd-task:create')
  async createKbEntriesFromOssKeys(
    @Body() body: {
      oss_files: Array<{ oss_key: string; filename: string; file_size?: number; content_type?: string }>;
      category_id?: string;
      description?: string;
      permission_level?: number;
      tags?: string;
      visibility?: string;
    },
    @Request() req: AuthedRequest,
  ) {
    const permissionLevel = (Number.isFinite(body.permission_level) && body.permission_level! >= 0 && body.permission_level! <= 100)
      ? Math.round(body.permission_level!)
      : undefined;
    return Promise.all((body.oss_files ?? []).map(async (f) => {
      const ext = f.filename.includes('.') ? f.filename.split('.').pop()!.toLowerCase() : '';
      // Generate a long-lived signed GET URL (30 days) for this object
      const ossUrl = this.ossService.getSignedUrl(f.oss_key, 30 * 24 * 3600) ?? undefined;
      return this.rdService.createKnowledgeEntry({
        title: f.filename,
        description: body.description,
        category_id: body.category_id ?? 'kb-other',
        tags: body.tags ? String(body.tags).split(',').map(t => t.trim()).filter(Boolean) : [],
        visibility: body.visibility ?? 'internal',
        permission_level: permissionLevel,
        source: 'manual',
        file_name: f.filename,
        file_type: ext,
        file_size: f.file_size,
        oss_url: ossUrl,
        created_by_id: req.user?.id,
        created_by_name: req.user?.name,
      });
    }));
  }

  @Post('knowledge/entries')
  @Permissions('rd-kb:upload', 'rd-task:create')
  @UseInterceptors(FilesInterceptor('files', 10))
  async createKnowledgeEntry(
    @UploadedFiles() files: Array<{ originalname: string; mimetype?: string; size?: number; buffer: Buffer }> | undefined,
    @Body() body: {
      title?: string;
      description?: string;
      category_id?: string;
      tags?: string;
      visibility?: string;
      permission_level?: string;
      external_url?: string;
    },
    @Request() req: { user?: { id?: string; name?: string } },
  ) {
    const uploadedFiles = files ?? [];
    const parsedPermissionLevel = body.permission_level ? Number(body.permission_level) : undefined;
    const permissionLevel = (Number.isFinite(parsedPermissionLevel) && parsedPermissionLevel! >= 0 && parsedPermissionLevel! <= 100)
      ? Math.round(parsedPermissionLevel!)
      : undefined;
    if (uploadedFiles.length > 0) {
      // Multi-file upload: upload to OSS then create one entry per file
      return Promise.all(uploadedFiles.map(async (f) => {
        const ext = f.originalname.includes('.') ? f.originalname.split('.').pop()!.toLowerCase() : '';
        const objectKey = await this.ossService.uploadBuffer(
          f.buffer,
          'rd/knowledge',
          f.originalname,
          f.mimetype,
        );
        const ossUrl = objectKey ? this.ossService.getSignedUrl(objectKey, 30 * 24 * 3600) : null;
        return this.rdService.createKnowledgeEntry({
          title: body.title || f.originalname,
          description: body.description,
          category_id: body.category_id ?? 'kb-other',
          tags: body.tags ? String(body.tags).split(',').map(t => t.trim()).filter(Boolean) : [],
          visibility: body.visibility ?? 'internal',
          permission_level: permissionLevel,
          source: 'manual',
          file_name: f.originalname,
          file_type: ext,
          file_size: f.size ?? f.buffer.length,
          // 优先使用 OSS 签名 URL，未配置时降级存 base64
          ...(ossUrl
            ? { oss_url: ossUrl }
            : { data_url: `data:${f.mimetype ?? 'application/octet-stream'};base64,${f.buffer.toString('base64')}` }
          ),
          created_by_id: req.user?.id,
          created_by_name: req.user?.name,
        });
      }));
    }
    // Manual text/link entry
    return this.rdService.createKnowledgeEntry({
      title: body.title ?? '未命名条目',
      description: body.description,
      category_id: body.category_id ?? 'kb-other',
      tags: body.tags ? String(body.tags).split(',').map(t => t.trim()).filter(Boolean) : [],
      visibility: body.visibility ?? 'internal',
      permission_level: permissionLevel,
      source: 'manual',
      external_url: body.external_url,
      created_by_id: req.user?.id,
      created_by_name: req.user?.name,
    });
  }

  /** Fetch a single KB entry including its data_url (needed for download of base64 files). */
  @Get('knowledge/entries/:id')
  async getKnowledgeEntry(@Param('id') id: string) {
    const entry = await this.rdService.getKnowledgeEntryById(id);
    if (!entry) throw new NotFoundException('条目不存在');
    return entry;
  }

  @Patch('knowledge/entries/:id')
  @Permissions('rd-kb:manage', 'rd-kb:upload')
  updateKnowledgeEntry(
    @Param('id') id: string,
    @Body() body: Partial<{ title: string; description: string; category_id: string; tags: string[]; visibility: string; permission_level: number; archived: boolean }>,
  ) {
    return this.rdService.updateKnowledgeEntry(id, body);
  }

  @Patch('knowledge/entries/:id/move')
  @Permissions('rd-kb:manage')
  moveKnowledgeEntry(
    @Param('id') id: string,
    @Body() body: { category_id?: string },
  ) {
    return this.rdService.moveKnowledgeEntry(id, body.category_id ?? '');
  }

  @Delete('knowledge/entries/:id')
  @Permissions('rd-kb:manage')
  deleteKnowledgeEntry(@Param('id') id: string) {
    return this.rdService.deleteKnowledgeEntry(id);
  }

  @Post('knowledge/entries/:id/view')
  incrementKbView(@Param('id') id: string) {
    return this.rdService.incrementKbEntryViewCount(id);
  }

  /** One-shot: fix garbled Latin-1→UTF-8 filenames on existing KB entries. */
  @Post('knowledge/repair-filenames')
  @Permissions('rd-kb:manage')
  repairKbFilenames() {
    return this.rdService.repairKbFilenameEncoding();
  }
}
