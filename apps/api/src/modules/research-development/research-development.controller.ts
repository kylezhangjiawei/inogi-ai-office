import { Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Put, Query, Request, Res, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { SkipThrottle } from '@nestjs/throttler';
import { Response } from 'express';

import { Permissions } from '../auth/decorators/permissions.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { OssService } from '../oss/oss.service';
import { RdWorkspaceInterceptor } from './rd-workspace.context';
import { ResearchDevelopmentService } from './research-development.service';

const RD_READ_PERMISSIONS = [
  'page:rd-task-management',
  'page:rd-my-workspace',
  'page:rd-director-dashboard',
  'page:rd-approval-flow',
  'page:rd-audit-log',
  'page:rd-ai-settings',
  // 中美协同页面复用研发接口（协同驾驶舱 / 协同工作台），读权限等同研发页面
  'page:us-collab-cockpit',
  'page:us-collab-workspace',
];

type AuthedRequest = { user?: { id?: string; name?: string; role?: string; permissions?: string[] } };

/** Determines if the current request belongs to a manager who can view all cross-user data. */
function buildViewer(req: AuthedRequest): { userId?: string; hasFullAccess: boolean; canReadAll: boolean } {
  const perms = req.user?.permissions ?? [];
  const hasFullAccess = perms.includes('*') || perms.includes('rd-task:reassign');
  // 只读跨部门查看：管理权限 OR 专门的只读权限 rd-task:view-all。
  // 仅放开「看全部留痕/附件」，不解锁任何编辑/转派能力（后者仍看 hasFullAccess）。
  const canReadAll = hasFullAccess || perms.includes('rd-task:view-all');
  return { userId: req.user?.id, hasFullAccess, canReadAll };
}

/**
 * 知识库专用 viewer：「看全部」必须用 KB 自己的权限（* / rd-kb:manage），
 * 与上传/编辑侧 isKbManager 判定保持一致。
 * 不能用任务管理权限 rd-task:reassign —— 否则「研发管理员」等可转派任务的角色
 * 会绕过 kb_level 过滤、看到全部知识库，导致设置的「个人权限」形同虚设。
 */
function buildKbViewer(req: AuthedRequest): { userId?: string; hasFullAccess: boolean } {
  const perms = req.user?.permissions ?? [];
  const hasFullAccess = perms.includes('*') || perms.includes('rd-kb:manage');
  return { userId: req.user?.id, hasFullAccess };
}

@Controller('research-development')
@Permissions(...RD_READ_PERMISSIONS)
// 工作区隔离：?workspace=us-collab 走协同池（独立任务/人员/审批流/AI 策略/留痕），缺省走研发池
@UseInterceptors(RdWorkspaceInterceptor)
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

  /** 主库 + 所有产品库合并的分类树。供研发驾驶舱概览「人员任务」跨产品聚合，与个人工作台主责口径一致。 */
  @Get('merged-task-categories')
  mergedTaskCategories() {
    return this.rdService.getMergedTaskCategories();
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
  @Permissions('page:rd-my-workspace', 'page:us-collab-workspace', 'rd-task:edit', 'rd-task:create', 'rd-task:reassign')
  updateTask(
    @Param('taskId') taskId: string,
    @Body() payload: Record<string, unknown>,
    @Request() req: AuthedRequest,
  ) {
    // 越权防护：管理员级权限（* / rd-task:edit / rd-task:reassign / rd-task:create）可改任意任务，
    // 行为不变；仅持 page:rd-my-workspace 的普通成员由服务层按 owner/协作人兜底校验，且禁止审批/移交。
    // canEditAny 覆盖了「审核人集合」(rd-task:edit ∪ rd-task:reassign)，故合法审批不受影响。
    const perms = req.user?.permissions ?? [];
    const canEditAny =
      perms.includes('*') ||
      perms.includes('rd-task:edit') ||
      perms.includes('rd-task:reassign') ||
      perms.includes('rd-task:create');
    return this.rdService.updateTask(taskId, payload, {
      requesterUserId: req.user?.id,
      requesterName: req.user?.name,
      canEditAny,
    });
  }

  @Delete('task-categories/tasks/:taskId')
  @Permissions('rd-task:edit')
  deleteTask(@Param('taskId') taskId: string, @Request() req: AuthedRequest) {
    return this.rdService.deleteTask(taskId, { userId: req.user?.id, userName: req.user?.name });
  }

  @Post('task-categories/tasks/move')
  @Permissions('rd-task:move', 'rd-task:edit', 'rd-task:reassign', 'page:rd-my-workspace', 'page:us-collab-workspace')
  moveTasks(
    @Body()
    payload: {
      taskIds?: unknown;
      targetProductId?: unknown;
      targetCategoryId?: unknown;
      targetSubId?: unknown;
    },
    @Request() req: AuthedRequest,
  ) {
    // 个人工作台放开「移动归类」：管理员（* / rd-task:move / rd-task:reassign / rd-task:edit）可移动任意任务；
    // 仅有 page:rd-my-workspace 的普通研发只能移动自己负责的任务（由服务层按 owner 兜底校验）。
    const perms = req.user?.permissions ?? [];
    const canMoveAny =
      perms.includes('*') ||
      perms.includes('rd-task:move') ||
      perms.includes('rd-task:reassign') ||
      perms.includes('rd-task:edit');
    return this.rdService.moveTasks(
      payload?.taskIds,
      {
        productId: payload?.targetProductId,
        categoryId: payload?.targetCategoryId,
        subId: payload?.targetSubId,
      },
      { requesterUserId: req.user?.id, requesterName: req.user?.name, canMoveAny },
    );
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

  /** 单任务 AI 小结（协同模块纵向视图）：任务近况浓缩成几句话；AI 未配置时本地兜底，不失败。 */
  @Post('tasks/:taskId/brief')
  generateTaskBrief(@Param('taskId') taskId: string) {
    return this.rdService.generateTaskBrief(taskId);
  }

  @Get('task-progress-notes/:taskId')
  getTaskProgressNotes(@Param('taskId') taskId: string, @Request() req: AuthedRequest) {
    // 单任务读取额外带上 userName：参与人（含历史仅按姓名指派的任务）可见该任务全部进展。
    // 仅此路由透传，不改动共享的 buildViewer（其它路由口径不变）。
    return this.rdService.getTaskProgressNotes(taskId, {
      ...buildViewer(req),
      userName: req.user?.name,
    });
  }

  /**
   * Same-origin inline preview proxy for attachment OSS objects.
   * Public + HMAC-token guarded because iframes can't send Authorization headers; the token
   * (key|exp signed with the server secret) acts as a short-lived capability URL, mirroring the
   * existing 30-day signed OSS URLs. Streams the object with Content-Disposition: inline so
   * PDFs/images render in the browser instead of force-downloading (bucket sets x-oss-force-download).
   */
  @Public()
  @Permissions()
  @SkipThrottle()
  @Get('oss-preview')
  async ossPreview(
    @Query('key') key: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Res() res: Response,
  ) {
    if (!key || !this.ossService.verifyPreviewToken(key, Number(exp), sig)) {
      throw new NotFoundException();
    }
    const obj = await this.ossService.getObjectStream(key);
    if (!obj) throw new NotFoundException();

    res.setHeader('Content-Type', obj.contentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', 'inline');
    // OSS 对象按 key 内容不变，token 已按天稳定 → 允许浏览器缓存一整天，避免附件反复重下
    res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
    if (obj.size > 0) res.setHeader('Content-Length', String(obj.size));

    obj.stream.on('error', () => {
      if (res.headersSent) res.end();
      else res.status(500).end();
    });
    obj.stream.pipe(res);
  }

  @Get('task-completion-scores/:taskId')
  getTaskCompletionScore(@Param('taskId') taskId: string, @Request() req: AuthedRequest) {
    return this.rdService.getTaskCompletionScore(taskId, buildViewer(req));
  }

  /**
   * 超管专用：查看 AI 评分的原始 prompt + AI 响应 + 耗时。
   * 用于审查"为什么 AI 给这个分"，验证抽取/RAG 数据是否真的传到了 AI。
   * 仅 permissions=['*'] 的超管可访问。
   */
  @Get('task-completion-scores/:taskId/debug')
  @Permissions('*')
  getTaskCompletionScoreDebug(@Param('taskId') taskId: string) {
    return this.rdService.getTaskCompletionScoreDebug(taskId);
  }

  @Post('task-completion-scores/backfill')
  @Permissions('rd-task:reassign')
  backfillTaskCompletionScores(@Body() body: { force?: boolean } = {}) {
    // force=true：评分标准升级后，强制对所有已完成任务重新评分（覆盖旧分）
    return this.rdService.backfillTaskCompletionScores({ force: !!body?.force });
  }

  @Post('task-progress-notes/backfill-extraction')
  @Permissions('rd-task:reassign')
  backfillTaskProgressNoteExtraction(@Body() body: { max_items?: number } = {}) {
    const maxItems = typeof body?.max_items === 'number' ? body.max_items : undefined;
    return this.rdService.backfillTaskProgressNoteExtraction({ maxItems });
  }

  @Post('task-progress-notes')
  @Permissions('page:rd-my-workspace', 'page:us-collab-workspace', 'rd-task:edit', 'rd-task:create')
  @UseInterceptors(FilesInterceptor('files', 10))
  createTaskProgressNote(
    @UploadedFiles() files: Array<{ originalname: string; mimetype?: string; size?: number; buffer: Buffer }> | undefined,
    @Body()
    body: {
      task_id?: string;
      text?: string;
      progress?: string | number;
      actor_name?: string;
      actor_role?: string;
      /** 可选：关联到任务的哪个工作项（任务内部轻量拆分），留痕区按此分组查看 */
      work_item_id?: string;
    },
    @Request() req: AuthedRequest,
  ) {
    const progressRaw = body.progress;
    const progress =
      typeof progressRaw === 'number'
        ? progressRaw
        : progressRaw !== undefined && progressRaw !== ''
          ? Number(progressRaw)
          : undefined;
    // 越权防护：管理员级权限可为任意任务记进展，普通成员由服务层按 owner/协作人兜底校验。
    const perms = req.user?.permissions ?? [];
    const canEditAny =
      perms.includes('*') ||
      perms.includes('rd-task:edit') ||
      perms.includes('rd-task:reassign') ||
      perms.includes('rd-task:create');
    return this.rdService.createTaskProgressNote({
      taskId: body.task_id ?? '',
      text: body.text ?? '',
      progress: Number.isFinite(progress) ? (progress as number) : undefined,
      workItemId: typeof body.work_item_id === 'string' ? body.work_item_id.trim() : undefined,
      actor: {
        id: req.user?.id,
        name: body.actor_name || req.user?.name,
        role: body.actor_role || req.user?.role,
      },
      files: files ?? [],
      // 归属校验只信任服务端鉴权得到的 req.user 身份（不用可被前端覆盖的 actor_name）
      requesterUserId: req.user?.id,
      requesterName: req.user?.name,
      canEditAny,
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
  @Permissions('page:rd-my-workspace', 'page:us-collab-workspace', 'rd-task:edit', 'rd-task:create')
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
    return this.rdService.generateDailyReportsForAll(body?.date, 'manual');
  }

  @Get('monthly-reports')
  listMonthlyReports(
    @Request() req: AuthedRequest,
    @Query('user_id') userId?: string,
    @Query('month') month?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit ? Number(limit) : undefined;
    return this.rdService.listMonthlyReports(
      {
        user_id: userId,
        month,
        limit: Number.isFinite(parsedLimit) ? (parsedLimit as number) : undefined,
      },
      buildViewer(req),
    );
  }

  @Post('monthly-reports')
  @Permissions('page:rd-my-workspace', 'page:us-collab-workspace', 'rd-task:edit', 'rd-task:create')
  createMonthlyReport(
    @Body() body: { user_id?: string; user_name?: string; month?: string },
    @Request() req: { user?: { id?: string; name?: string } },
  ) {
    return this.rdService.createMonthlyReport({
      user_id: body.user_id || req.user?.id,
      user_name: body.user_name || req.user?.name,
      month: body.month,
      trigger: 'manual',
    });
  }

  @Post('monthly-reports/regenerate-all')
  @Permissions('rd-task:reassign', 'rd-task:edit', 'page:rd-director-dashboard')
  regenerateAllMonthlyReports(@Body() body: { month?: string }) {
    return this.rdService.generateMonthlyReportsForAll(body?.month, 'manual');
  }

  @Get('performance-reports')
  listPerformanceReports(
    @Request() req: AuthedRequest,
    @Query('user_id') userId?: string,
    @Query('month') month?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit ? Number(limit) : undefined;
    return this.rdService.listPerformanceReports(
      {
        user_id: userId,
        month,
        limit: Number.isFinite(parsedLimit) ? (parsedLimit as number) : undefined,
      },
      buildViewer(req),
    );
  }

  @Post('performance-reports')
  @Permissions('rd-task:reassign', 'rd-task:edit', 'page:rd-director-dashboard')
  createPerformanceReport(@Body() body: { user_id?: string; user_name?: string; month?: string }) {
    return this.rdService.createPerformanceReport({
      user_id: body.user_id,
      user_name: body.user_name,
      month: body.month,
      trigger: 'manual',
    });
  }

  /** 成员对自己的绩效填写 5 维自评（仅本人可提交，越权由 service 拦截）。 */
  @Patch('performance-reports/:reportId/self-assessment')
  submitSelfAssessment(
    @Param('reportId') reportId: string,
    @Body() body: { scores?: Record<string, unknown>; comment?: string },
    @Request() req: AuthedRequest,
  ) {
    return this.rdService.submitPerformanceSelfAssessment(
      reportId,
      { scores: body.scores, comment: body.comment },
      { userId: req.user?.id, userName: req.user?.name },
    );
  }

  /** 主管对成员绩效填写 5 维评分（与生成绩效同权限）。 */
  @Patch('performance-reports/:reportId/supervisor-assessment')
  @Permissions('rd-task:reassign', 'rd-task:edit', 'page:rd-director-dashboard')
  submitSupervisorAssessment(
    @Param('reportId') reportId: string,
    @Body() body: { scores?: Record<string, unknown>; comment?: string },
    @Request() req: AuthedRequest,
  ) {
    return this.rdService.submitPerformanceSupervisorAssessment(reportId, {
      scores: body.scores,
      comment: body.comment,
      reviewerId: req.user?.id ?? null,
      reviewerName: req.user?.name ?? null,
    });
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
  @Permissions('page:rd-director-dashboard', 'rd-people:manage', 'rd-task:reassign', 'rd-task:edit', 'page:rd-my-workspace', 'page:us-collab-workspace')
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

  /** 团队绩效考核（按人聚合：交付质量 + 吞吐 + MateChat 活跃度 → 综合分与排名）。仅限主管驾驶舱权限。 */
  @Get('performance-assessment')
  @Permissions('page:rd-director-dashboard')
  performanceAssessment() {
    return this.rdService.getPerformanceAssessment();
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

  // 仅研发管理员（与前端 canManageTaskFlow 同口径）可给留痕追加备注
  @Post('audit-logs/:id/notes')
  @Permissions('rd-project:direct', 'rd-project:review-l1', 'rd-project:review-l2', 'rd-people:manage', 'rd-task:reassign')
  addAuditLogNote(@Param('id') id: string, @Body() payload: Record<string, unknown>) {
    return this.rdService.addAuditLogNote(id, payload);
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

  // ── 研发数据表（B2：Univer 工作簿快照 · 已去除行级密级）────────────────────────

  /** 读取整簿快照。page:rd-sheet 只读查看 / rd-sheet:edit 可编辑，均拿全量（已无行级密级）。 */
  @Get('sheet-workbook')
  @Permissions('page:rd-sheet', 'rd-sheet:edit')
  getSheetWorkbook() {
    return this.rdService.getSheetWorkbook();
  }

  /** 保存整簿快照（仅编辑者 rd-sheet:edit / 超管）。 */
  @Put('sheet-workbook')
  @Permissions('rd-sheet:edit')
  saveSheetWorkbook(@Body() body: { snapshot?: unknown }, @Request() req: AuthedRequest) {
    return this.rdService.saveSheetWorkbook(body?.snapshot, req.user?.id);
  }

  // ── Knowledge Base ────────────────────────────────────────────────────────

  @Get('knowledge/categories')
  @Permissions(...RD_READ_PERMISSIONS, 'page:rd-knowledge-base', 'rd-kb:upload')
  getKnowledgeCategories() {
    return this.rdService.getKnowledgeCategories();
  }

  @Put('knowledge/categories')
  @Permissions('rd-kb:manage', 'rd-kb:category:create', 'rd-kb:category:edit', 'rd-kb:category:delete')
  saveKnowledgeCategories(@Body() payload: unknown[]) {
    return this.rdService.saveKnowledgeCategories(payload);
  }

  @Post('knowledge/categories')
  @Permissions('rd-kb:manage', 'rd-kb:category:create')
  createKnowledgeCategory(
    @Body() body: { label?: unknown; parent_id?: unknown; icon?: unknown; color?: unknown },
  ) {
    return this.rdService.createKnowledgeCategory(body);
  }

  @Patch('knowledge/categories/:id')
  @Permissions('rd-kb:manage', 'rd-kb:category:edit')
  updateKnowledgeCategory(
    @Param('id') id: string,
    @Body() body: { label?: unknown; icon?: unknown; color?: unknown },
  ) {
    return this.rdService.updateKnowledgeCategory(id, body);
  }

  @Delete('knowledge/categories/:id')
  @Permissions('rd-kb:manage', 'rd-kb:category:delete')
  deleteKnowledgeCategory(@Param('id') id: string) {
    return this.rdService.deleteKnowledgeCategory(id);
  }

  @Get('knowledge/entries')
  @Permissions(...RD_READ_PERMISSIONS, 'page:rd-knowledge-base', 'rd-kb:upload')
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
    const viewer = req ? buildKbViewer(req) : undefined;
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
   * 返回当前登录用户在「人员管理」中配置的知识库权限分值（kb_level）。
   * 上传弹窗用它作为权限分值默认值：研发成员无权读取完整人员列表，
   * 故单独暴露"只取自己"的轻量端点（门控与上传一致）。
   */
  @Get('knowledge/my-permission-level')
  @Permissions('rd-kb:upload', 'rd-task:create')
  async getMyKbPermissionLevel(@Request() req: AuthedRequest) {
    return { permission_level: await this.rdService.getUserKbLevel(req.user?.id) };
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
    // 后端兜底：研发成员强制用其在「人员管理」配置的 kb_level，忽略前端传值（仅 KB 管理员采用请求值）
    const permissionLevel = await this.rdService.resolveKbPermissionLevel(
      { userId: req.user?.id, permissions: req.user?.permissions },
      body.permission_level,
    );
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
    @Request() req: AuthedRequest,
  ) {
    const uploadedFiles = files ?? [];
    const parsedPermissionLevel = body.permission_level ? Number(body.permission_level) : undefined;
    // 后端兜底：研发成员强制用其 kb_level，忽略前端传值
    const permissionLevel = await this.rdService.resolveKbPermissionLevel(
      { userId: req.user?.id, permissions: req.user?.permissions },
      parsedPermissionLevel,
    );
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
  @Permissions(...RD_READ_PERMISSIONS, 'page:rd-knowledge-base', 'rd-kb:upload')
  async getKnowledgeEntry(@Param('id') id: string, @Request() req: AuthedRequest) {
    const entry = await this.rdService.getKnowledgeEntryById(id, buildKbViewer(req));
    if (!entry) throw new NotFoundException('条目不存在');
    return entry;
  }

  @Patch('knowledge/entries/:id')
  @Permissions('rd-kb:manage', 'rd-kb:entry:edit', 'rd-kb:upload')
  updateKnowledgeEntry(
    @Param('id') id: string,
    @Body() body: Partial<{ title: string; description: string; category_id: string; tags: string[]; visibility: string; permission_level: number; archived: boolean }>,
    @Request() req: AuthedRequest,
  ) {
    const perms = req.user?.permissions ?? [];
    const isKbManager = perms.includes('*') || perms.includes('rd-kb:manage');
    // 后端兜底：非 KB 管理员不得修改权限分值，剔除该字段以保持原值（防止经编辑接口绕过上传置灰）
    if (!isKbManager && body.permission_level !== undefined) {
      delete body.permission_level;
    }
    return this.rdService.updateKnowledgeEntry(id, body);
  }

  @Patch('knowledge/entries/:id/move')
  @Permissions('rd-kb:manage', 'rd-kb:entry:move', 'rd-kb:entry:edit')
  moveKnowledgeEntry(
    @Param('id') id: string,
    @Body() body: { category_id?: string },
  ) {
    return this.rdService.moveKnowledgeEntry(id, body.category_id ?? '');
  }

  @Delete('knowledge/entries/:id')
  @Permissions('rd-kb:manage', 'rd-kb:entry:delete')
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

  /**
   * 全量回填 KB → RAG 向量索引。首次开启 RAG 或更换 embedding 模型后调用一次即可。
   * 仅 KB 管理权限可触发。
   */
  @Post('knowledge/rag-backfill')
  @Permissions('rd-kb:manage')
  backfillKbToRag() {
    return this.rdService.backfillAllKbToRag();
  }
}
