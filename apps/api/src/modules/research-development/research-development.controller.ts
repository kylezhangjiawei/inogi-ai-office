import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Put, Query, Request, Res, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { SkipThrottle } from '@nestjs/throttler';
import { Request as ExpressRequest, Response } from 'express';

import { Permissions } from '../auth/decorators/permissions.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { OssService } from '../oss/oss.service';
import { canInlineAttachment, isActiveAttachmentContent } from './attachment-security';
import { KbMultipartService } from './kb-multipart.service';
import { RdWorkspaceInterceptor } from './rd-workspace.context';
import { ResearchDevelopmentService } from './research-development.service';

const RD_READ_PERMISSIONS = [
  'page:rd-task-management',
  'page:rd-my-workspace',
  'page:rd-director-dashboard',
  'page:rd-approval-flow',
  'page:rd-audit-log',
  'page:rd-ai-settings',
  // 中美协同页面复用研发接口（协同驾驶舱 / 工作台 / 审批流 / 留痕 / AI 策略），读权限等同研发页面。
  // 三个配置页的码必须在列：存在「只配某个配置页、不配驾驶舱」的角色，漏配会让其接口全 403。
  // 跨池读写仍被 RdWorkspaceInterceptor 的池级准入挡住——这里只决定「能读研发接口」，不决定「能读哪个池」。
  'page:us-collab-cockpit',
  'page:us-collab-workspace',
  'page:us-collab-approval-flow',
  'page:us-collab-audit-log',
  'page:us-collab-ai-settings',
];

/**
 * 任务管理动作的统一权限集合。
 * 前端驾驶舱、协同详情与后端写接口必须共用同一口径，避免“看得到按钮但提交后 403”。
 */
const RD_TASK_MANAGER_PERMISSIONS = [
  'rd-task:reassign',
  'rd-project:direct',
  'rd-project:review-l1',
  'rd-project:review-l2',
  'rd-people:manage',
] as const;

/**
 * 「任务结构管理员」口径：可任意重挂/摘出任务的父子关系（attach-parent / detach-parent）。
 * ⚠️ 刻意不含 rd-task:edit —— 默认「研发人员」角色就持有该码，若沿用 RD_TASK_MANAGER_PERMISSIONS，
 * canEditAny 对普通成员恒为真，服务层的归属校验会整段失效（端点本身又要求 rd-task:edit 才能进，
 * 等于谁都能绕过）。与前端 RDTaskDetailPage 的 canManage 是同一组权限码。
 */
const RD_TASK_STRUCTURE_MANAGER_PERMISSIONS = [
  'rd-task:reassign',
  'rd-project:direct',
  'rd-project:review-l1',
  'rd-project:review-l2',
  'rd-people:manage',
] as const;

/** 导出供 MateChat Agent 复用：Agent 必须和控制器用同一套「能否改任意任务」判定，不能各写一份 */
export function canManageTaskStructure(permissions: string[]): boolean {
  return permissions.includes('*')
    || RD_TASK_STRUCTURE_MANAGER_PERMISSIONS.some((code) => permissions.includes(code));
}

function canManageAnyTask(permissions: string[]): boolean {
  return permissions.includes('*') || RD_TASK_MANAGER_PERMISSIONS.some((code) => permissions.includes(code));
}

function buildAuditLogViewer(req: AuthedRequest) {
  const permissions = req.user?.permissions ?? [];
  return {
    userId: req.user?.id,
    userName: req.user?.name,
    canReadAll: canManageAnyTask(permissions),
  };
}

type AuthedRequest = { user?: { id?: string; name?: string; role?: string; permissions?: string[] } };
type DirectProgressNoteUpload = {
  objectKey: string;
  originalname: string;
  mimetype?: string;
  size?: number;
  cleanupExp?: number;
  cleanupSig?: string;
};

function parseDirectProgressNoteUploads(value: unknown): DirectProgressNoteUpload[] {
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
      .map((item) => ({
        objectKey: typeof item.objectKey === 'string' ? item.objectKey : '',
        originalname: typeof item.originalname === 'string' ? item.originalname : '',
        mimetype: typeof item.mimetype === 'string' ? item.mimetype : undefined,
        size: typeof item.size === 'number' ? item.size : undefined,
        cleanupExp: typeof item.cleanupExp === 'number' ? item.cleanupExp : undefined,
        cleanupSig: typeof item.cleanupSig === 'string' ? item.cleanupSig : undefined,
      }))
      .filter((item) => item.objectKey && item.originalname);
  } catch {
    throw new BadRequestException('OSS 附件登记参数格式不正确');
  }
}

/** Determines if the current request belongs to a manager who can view all cross-user data. */
function buildViewer(req: AuthedRequest): { userId?: string; hasFullAccess: boolean; canReadAll: boolean } {
  const perms = req.user?.permissions ?? [];
  const hasFullAccess = perms.includes('*') || perms.includes('rd-task:reassign');
  // 只读跨部门查看：管理权限 OR 专门的只读权限 rd-task:view-all。
  // 仅放开「看全部留痕/附件」，不解锁任何编辑/转派能力（后者仍看 hasFullAccess）。
  const canReadAll = hasFullAccess || perms.includes('rd-task:view-all');
  return { userId: req.user?.id, hasFullAccess, canReadAll };
}

function buildDiscussionViewer(req: AuthedRequest) {
  const permissions = req.user?.permissions ?? [];
  const canPost =
    permissions.includes('*') ||
    permissions.includes('page:rd-my-workspace') ||
    permissions.includes('page:us-collab-workspace') ||
    canManageAnyTask(permissions);
  const canAccessAny =
    permissions.includes('*') ||
    permissions.includes('page:rd-task-management') ||
    permissions.includes('page:rd-director-dashboard') ||
    permissions.includes('page:us-collab-cockpit') ||
    permissions.includes('rd-task:view-all') ||
    canManageAnyTask(permissions);
  return {
    userId: req.user?.id,
    userName: req.user?.name,
    userRole: req.user?.role,
    canAccessAny,
    canPost,
  };
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
    private readonly kbMultipart: KbMultipartService,
  ) {}

  @Get('snapshot')
  snapshot(@Request() req: AuthedRequest) {
    return this.rdService.snapshot(buildAuditLogViewer(req));
  }

  @Get('task-categories')
  taskCategories(@Query('include_covers') includeCovers?: string) {
    return this.rdService.getTaskCategories({ includeCovers: includeCovers === '1' });
  }

  /** 主库 + 所有产品库合并的分类树。供研发驾驶舱概览「人员任务」跨产品聚合，与个人工作台主责口径一致。 */
  @Get('merged-task-categories')
  mergedTaskCategories() {
    return this.rdService.getMergedTaskCategories();
  }

  /** 研发管理员人员视角：研发全产品任务 + 协同任务的只读展示投影。 */
  @Get('member-task-categories')
  @Permissions('rd-task:reassign')
  memberTaskCategories() {
    return this.rdService.getMemberTaskCategories();
  }

  /** 研发侧查询当前同步状态；撤销后的记录继续返回，供按钮与审计状态判断。 */
  @Get('production-task-syncs')
  @Permissions('rd-task:sync-production')
  productionTaskSyncs() {
    return this.rdService.listProductionTaskSyncs();
  }

  @Post('tasks/:taskId/sync-production')
  @Permissions('rd-task:sync-production')
  syncTaskToProduction(@Param('taskId') taskId: string, @Request() req: AuthedRequest) {
    return this.rdService.syncTaskToProduction(taskId, {
      userId: req.user?.id,
      userName: req.user?.name,
    });
  }

  @Delete('tasks/:taskId/sync-production')
  @Permissions('rd-task:sync-production')
  revokeTaskProductionSync(@Param('taskId') taskId: string, @Request() req: AuthedRequest) {
    return this.rdService.revokeTaskProductionSync(taskId, {
      userId: req.user?.id,
      userName: req.user?.name,
    });
  }

  @Put('task-categories')
  @Permissions(...RD_TASK_STRUCTURE_MANAGER_PERMISSIONS)
  saveTaskCategories(@Body() payload: unknown[]) {
    return this.rdService.saveTaskCategories(payload);
  }

  /** 普通立项人只能让服务端补一个空分类容器，不能通过整树 PUT 注入或覆盖任务。 */
  @Post('task-categories/proposal-target')
  @Permissions('rd-task:create', 'rd-project:propose', 'rd-project:direct')
  ensureProposalTarget(
    @Body() payload: { product_id?: unknown; category_label?: unknown; sub_project_label?: unknown },
  ) {
    return this.rdService.ensureProposalTarget({
      productId: typeof payload?.product_id === 'string' ? payload.product_id : '',
      categoryLabel: typeof payload?.category_label === 'string' ? payload.category_label : '',
      subProjectLabel: typeof payload?.sub_project_label === 'string' ? payload.sub_project_label : '',
    });
  }

  @Post('task-categories/tasks')
  @Permissions('rd-task:create', 'rd-project:propose', 'rd-project:direct')
  createTask(@Body() payload: Record<string, unknown>, @Request() req: AuthedRequest) {
    const permissions = req.user?.permissions ?? [];
    const canCreateDirectly = permissions.includes('*')
      || permissions.includes('rd-task:create')
      || permissions.includes('rd-project:direct');
    return this.rdService.createTask(payload, {
      requesterUserId: req.user?.id,
      requesterName: req.user?.name,
      canEditAny: canManageTaskStructure(permissions),
      // 只有“立项申请”权限的普通成员只能创建待审核任务；服务层会覆盖主责人并校验状态。
      proposalOnly: !canCreateDirectly && permissions.includes('rd-project:propose'),
    });
  }

  /** 节点立项原子批量建子任务：整批只写回一次，并用 request_id 防止超时重试重复创建。 */
  @Post('task-categories/tasks/create-children-batch')
  @Permissions('rd-task:create', 'rd-project:propose', 'rd-project:direct')
  async createSubtasks(
    @Body() payload: { parent_task_id?: unknown; request_id?: unknown; tasks?: unknown },
    @Request() req: AuthedRequest,
  ) {
    const permissions = req.user?.permissions ?? [];
    const canCreateDirectly = permissions.includes('*')
      || permissions.includes('rd-task:create')
      || permissions.includes('rd-project:direct');
    const rawTasks = Array.isArray(payload?.tasks) ? payload.tasks : [];
    if (rawTasks.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) {
      throw new BadRequestException('子任务列表格式不正确');
    }
    const tasks = rawTasks as Record<string, unknown>[];
    const parentTaskId = typeof payload?.parent_task_id === 'string' ? payload.parent_task_id : '';
    const requestId = typeof payload?.request_id === 'string' ? payload.request_id : '';
    const created = await this.rdService.createSubtasks(parentTaskId, tasks, requestId, {
      requesterUserId: req.user?.id,
      requesterName: req.user?.name,
      canEditAny: canManageTaskStructure(permissions),
      proposalOnly: !canCreateDirectly && permissions.includes('rd-project:propose'),
    });
    return { ok: true as const, parent_task_id: parentTaskId, tasks: created };
  }

  @Patch('task-categories/tasks/:taskId')
  @Permissions('page:rd-my-workspace', 'page:us-collab-workspace', ...RD_TASK_MANAGER_PERMISSIONS)
  updateTask(
    @Param('taskId') taskId: string,
    @Body() payload: Record<string, unknown>,
    @Request() req: AuthedRequest,
  ) {
    // 越权防护：任务管理员、立项审核人和人员管理员可改任意任务；
    // 仅持工作台页面权限的普通成员由服务层按 owner/协作人兜底校验，且禁止审批/移交。
    const perms = req.user?.permissions ?? [];
    const canEditAny = canManageTaskStructure(perms);
    return this.rdService.updateTask(taskId, payload, {
      requesterUserId: req.user?.id,
      requesterName: req.user?.name,
      canEditAny,
    });
  }

  @Delete('task-categories/tasks/:taskId')
  @Permissions('rd-task:edit')
  deleteTask(@Param('taskId') taskId: string, @Request() req: AuthedRequest) {
    return this.rdService.deleteTask(taskId, {
      userId: req.user?.id,
      userName: req.user?.name,
      canEditAny: canManageTaskStructure(req.user?.permissions ?? []),
    });
  }

  /** 把一个已有顶层任务树挂到任意层级目标下；兼容原单任务调用。 */
  @Post('task-categories/tasks/:taskId/attach-parent')
  @Permissions('rd-task:edit')
  attachTaskAsSubtask(
    @Param('taskId') taskId: string,
    @Body() payload: { parent_task_id?: unknown },
    @Request() req: AuthedRequest,
  ) {
    // 越权防护口径与 updateTask 一致：任务管理员/审核人可重挂任意任务；
    // 仅持工作台页面权限的普通成员由服务层按 owner/协作人兜底校验（源任务与目标父任务都要过）。
    return this.rdService.attachTaskAsSubtask(taskId, String(payload?.parent_task_id ?? ''), {
      userId: req.user?.id,
      userName: req.user?.name,
      canEditAny: canManageTaskStructure(req.user?.permissions ?? []),
    });
  }

  /** 原子批量并入：一次校验、一次写回，全成功或全失败。 */
  @Post('task-categories/tasks/attach-parent-batch')
  @Permissions('rd-task:edit', 'rd-project:direct')
  attachTasksAsSubtasks(
    @Body() payload: { task_ids?: unknown; parent_task_id?: unknown },
    @Request() req: AuthedRequest,
  ) {
    const taskIds = Array.isArray(payload?.task_ids) ? payload.task_ids.map((id) => String(id ?? '')) : [];
    return this.rdService.attachTasksAsSubtasks(taskIds, String(payload?.parent_task_id ?? ''), {
      userId: req.user?.id,
      userName: req.user?.name,
      canEditAny: canManageTaskStructure(req.user?.permissions ?? []),
    });
  }

  /** 取消子任务关系：提升为顶层任务（落在原父任务所在子项目，与父任务同级）。 */
  @Post('task-categories/tasks/:taskId/detach-parent')
  @Permissions('rd-task:edit')
  detachSubtask(@Param('taskId') taskId: string, @Request() req: AuthedRequest) {
    return this.rdService.detachSubtask(taskId, {
      userId: req.user?.id,
      userName: req.user?.name,
      canEditAny: canManageTaskStructure(req.user?.permissions ?? []),
    });
  }

  /** 原子批量取消同一父任务下的直接子任务关系。 */
  @Post('task-categories/tasks/detach-parent-batch')
  @Permissions('rd-task:edit')
  detachSubtasks(
    @Body() payload: { task_ids?: unknown; parent_task_id?: unknown },
    @Request() req: AuthedRequest,
  ) {
    const taskIds = Array.isArray(payload?.task_ids) ? payload.task_ids.map((id) => String(id ?? '')) : [];
    const parentTaskId = typeof payload?.parent_task_id === 'string' ? payload.parent_task_id : undefined;
    return this.rdService.detachSubtasks(taskIds, parentTaskId, {
      userId: req.user?.id,
      userName: req.user?.name,
      canEditAny: canManageTaskStructure(req.user?.permissions ?? []),
    });
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
  @Permissions(...RD_TASK_STRUCTURE_MANAGER_PERMISSIONS)
  saveProducts(@Body() payload: unknown[]) {
    return this.rdService.saveProducts(payload);
  }

  @Get('product-task-categories/:productId')
  getProductTaskCategories(@Param('productId') productId: string) {
    return this.rdService.getProductTaskCategories(productId);
  }

  @Put('product-task-categories/:productId')
  @Permissions(...RD_TASK_STRUCTURE_MANAGER_PERMISSIONS)
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

  // ── 评论未读红点：任务级未读数与已读上报 ────────────────────────────────────
  // 路径刻意不放在 task-progress-notes/:taskId 之下，避免被参数路由捕获

  @Get('note-unread-summary')
  getNoteUnreadSummary(@Request() req: AuthedRequest) {
    return this.rdService.getNoteUnreadSummary(buildDiscussionViewer(req));
  }

  // 驾驶舱备注回执：所有有驾驶舱页面权限者可见（类级 @Permissions 已含 page:rd-task-management / us-collab-cockpit）
  @Get('task-note-receipts')
  getTaskNoteReceipts() {
    return this.rdService.getTaskNoteReceipts();
  }

  @Post('task-progress-notes/:taskId/read')
  markTaskNotesRead(@Param('taskId') taskId: string, @Request() req: AuthedRequest) {
    return this.rdService.markTaskNotesRead(taskId, { userId: req.user?.id });
  }

  // ── 任务协作对话：主会话 + 围绕进度/消息的原位讨论线程 ───────────────────

  @Get('task-discussions/:taskId')
  // 深链邀请可能来自没有研发页面码的普通成员；访问范围由 service 按任务成员/精确线程邀请校验。
  @Permissions()
  getTaskDiscussion(
    @Param('taskId') taskId: string,
    @Query('anchor_type') anchorType: string | undefined,
    @Query('anchor_id') anchorId: string | undefined,
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limit: string | undefined,
    @Request() req: AuthedRequest,
  ) {
    return this.rdService.getTaskDiscussion(
      taskId,
      { anchorType, anchorId, cursor, limit },
      buildDiscussionViewer(req),
    );
  }

  @Post('task-discussions/:taskId/messages')
  // 受邀者无需获得整个研发工作台权限，只要仍是当前线程参与者即可回复；service 负责边界校验。
  @Permissions()
  @UseInterceptors(FilesInterceptor('files', 10))
  createTaskDiscussionMessage(
    @Param('taskId') taskId: string,
    @UploadedFiles() files: Array<{ originalname: string; mimetype?: string; size?: number; buffer: Buffer }> | undefined,
    @Body()
    body: {
      anchor_type?: string;
      anchor_id?: string;
      text?: string;
      reply_to_id?: string;
      mentions?: string;
    },
    @Request() req: AuthedRequest,
  ) {
    let mentions: Array<{ user_id?: string; name?: string }> | undefined;
    if (typeof body.mentions === 'string' && body.mentions.trim()) {
      try {
        const parsed = JSON.parse(body.mentions);
        if (Array.isArray(parsed)) mentions = parsed;
      } catch {
        // @ 是增强能力，非法 JSON 不阻断消息主流程
      }
    }
    return this.rdService.createTaskDiscussionMessage({
      taskId,
      anchorType: body.anchor_type,
      anchorId: body.anchor_id,
      body: body.text,
      replyToId: body.reply_to_id,
      mentions,
      files: files ?? [],
      actor: { id: req.user?.id, name: req.user?.name, role: req.user?.role },
      viewer: buildDiscussionViewer(req),
    });
  }

  @Post('task-discussions/:taskId/read')
  @Permissions()
  markTaskDiscussionRead(
    @Param('taskId') taskId: string,
    @Body() body: { thread_id?: string },
    @Request() req: AuthedRequest,
  ) {
    return this.rdService.markTaskDiscussionRead(
      taskId,
      body.thread_id ?? '',
      buildDiscussionViewer(req),
    );
  }

  /** 单任务 AI 小结（协同模块纵向视图）：任务近况浓缩成几句话；AI 未配置时本地兜底，不失败。 */
  @Post('tasks/:taskId/brief')
  generateTaskBrief(@Param('taskId') taskId: string, @Request() req: AuthedRequest) {
    // 可见性与留痕接口同口径：驾驶舱/管理员级页面码可看全部，仅工作台码的普通成员限本人参与任务
    const perms = req.user?.permissions ?? [];
    const canViewAny =
      perms.includes('*') ||
      perms.includes('page:rd-task-management') ||
      perms.includes('page:us-collab-cockpit') ||
      perms.includes('page:rd-director-dashboard') ||
      perms.includes('rd-task:edit') ||
      perms.includes('rd-task:reassign');
    return this.rdService.generateTaskBrief(taskId, {
      requesterUserId: req.user?.id,
      requesterName: req.user?.name,
      canViewAny,
    });
  }

  @Get('task-attachment-previews')
  getTaskAttachmentPreviews(
    @Query('task_ids') taskIds: string | undefined,
    @Request() req: AuthedRequest,
  ) {
    return this.rdService.getTaskAttachmentPreviews(
      (taskIds ?? '').split(','),
      { ...buildViewer(req), userName: req.user?.name },
    );
  }

  @Get('task-attachments/:taskId')
  getTaskAttachments(@Param('taskId') taskId: string, @Request() req: AuthedRequest) {
    return this.rdService.getTaskAttachments(taskId, {
      ...buildViewer(req),
      userName: req.user?.name,
    });
  }

  @Get('task-progress-note-groups/:taskId')
  getTaskProgressNoteGroup(@Param('taskId') taskId: string, @Request() req: AuthedRequest) {
    return this.rdService.getTaskProgressNoteGroup(taskId, {
      ...buildViewer(req),
      userName: req.user?.name,
      canEditAttachments: canManageAnyTask(req.user?.permissions ?? []),
    });
  }

  @Get('task-progress-notes/:taskId')
  getTaskProgressNotes(@Param('taskId') taskId: string, @Request() req: AuthedRequest) {
    // 单任务读取额外带上 userName：参与人（含历史仅按姓名指派的任务）可见该任务全部进展。
    // 仅此路由透传，不改动共享的 buildViewer（其它路由口径不变）。
    return this.rdService.getTaskProgressNotes(taskId, {
      ...buildViewer(req),
      userName: req.user?.name,
      // 附件可编辑标记的管理员口径与写接口 canEditAny 完全一致（同一函数）
      canEditAttachments: canManageAnyTask(req.user?.permissions ?? []),
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
    @Query('process') process: string | undefined,
    @Request() req: ExpressRequest,
    @Res() res: Response,
  ) {
    const safeProcess = typeof process === 'string'
      && process.length <= 160
      && /^image\/[a-zA-Z0-9_,/-]+$/.test(process)
      ? process
      : undefined;
    const tokenSubject = safeProcess ? `${key}|process:${safeProcess}` : key;
    if (!key || (process && !safeProcess) || !this.ossService.verifyPreviewToken(tokenSubject, Number(exp), sig)) {
      throw new NotFoundException();
    }
    const requestedRange = typeof req.headers.range === 'string' && /^bytes=\d*-\d*$/.test(req.headers.range)
      ? req.headers.range
      : undefined;
    const obj = await this.ossService.getObjectStream(key, {
      range: requestedRange,
      process: safeProcess,
    });
    if (!obj) throw new NotFoundException();

    if (obj.status === 206) res.status(206);
    const contentType = obj.contentType || 'application/octet-stream';
    const inline = canInlineAttachment(key, contentType);
    res.setHeader('Content-Type', isActiveAttachmentContent(key, contentType) ? 'application/octet-stream' : contentType);
    res.setHeader('Content-Disposition', inline ? 'inline' : 'attachment');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (obj.contentRange) res.setHeader('Content-Range', obj.contentRange);
    if (obj.etag) res.setHeader('ETag', obj.etag);
    if (obj.lastModified) res.setHeader('Last-Modified', obj.lastModified);
    // OSS 对象按 key 内容不变，token 已按天稳定 → 允许浏览器缓存一整天，避免附件反复重下
    res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
    if (obj.size > 0) res.setHeader('Content-Length', String(obj.size));

    obj.stream.on('error', () => {
      if (res.headersSent) res.end();
      else res.status(500).end();
    });
    obj.stream.pipe(res);
  }

  @Get('task-completion-scores')
  getTaskCompletionScores(
    @Query('task_ids') taskIds: string | undefined,
    @Request() req: AuthedRequest,
  ) {
    return this.rdService.getTaskCompletionScores((taskIds ?? '').split(','), buildViewer(req));
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

  @Post('task-progress-notes/presign-upload')
  @Permissions('page:rd-my-workspace', 'page:us-collab-workspace', ...RD_TASK_MANAGER_PERMISSIONS)
  presignTaskProgressNoteUploads(
    @Body() body: { files?: Array<{ filename?: string; content_type?: string; file_size?: number }> },
    @Request() req: AuthedRequest,
  ) {
    return this.rdService.presignTaskProgressNoteUploads(
      (Array.isArray(body.files) ? body.files : []).map((file) => ({
        originalname: file.filename,
        mimetype: file.content_type,
        size: file.file_size,
      })),
      req.user?.id,
    );
  }

  @Post('task-progress-notes/abort-upload')
  @Permissions('page:rd-my-workspace', 'page:us-collab-workspace', ...RD_TASK_MANAGER_PERMISSIONS)
  abortTaskProgressNoteUploads(
    @Body() body: { files?: DirectProgressNoteUpload[] },
    @Request() req: AuthedRequest,
  ) {
    const files = parseDirectProgressNoteUploads(JSON.stringify(Array.isArray(body.files) ? body.files : []));
    return this.rdService.cleanupUnregisteredProgressNoteUploads(files, req.user?.id);
  }

  @Post('task-progress-notes')
  @Permissions('page:rd-my-workspace', 'page:us-collab-workspace', ...RD_TASK_MANAGER_PERMISSIONS)
  @UseInterceptors(FilesInterceptor('files', 10))
  async createTaskProgressNote(
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
      /** 可选：@ 提及的成员，multipart 里以 JSON 字符串传输：[{user_id,name}] */
      mentions?: string;
      /** 浏览器已直传 OSS 的对象元数据；服务端会校验用户目录、对象存在性与真实大小。 */
      oss_files?: string;
    },
    @Request() req: AuthedRequest,
  ) {
    // mentions 防御式解析：非法 JSON 静默忽略（@ 是增强能力，不应让留痕主流程失败）
    let mentions: Array<{ user_id?: string; name?: string }> | undefined;
    if (typeof body.mentions === 'string' && body.mentions.trim()) {
      try {
        const parsed = JSON.parse(body.mentions);
        if (Array.isArray(parsed)) mentions = parsed;
      } catch {
        // ignore
      }
    }
    const progressRaw = body.progress;
    const progress =
      typeof progressRaw === 'number'
        ? progressRaw
        : progressRaw !== undefined && progressRaw !== ''
          ? Number(progressRaw)
          : undefined;
    // 越权防护：管理员级权限可为任意任务记进展，普通成员由服务层按 owner/协作人兜底校验。
    const perms = req.user?.permissions ?? [];
    const canEditAny = canManageAnyTask(perms);
    const uploadedFiles = parseDirectProgressNoteUploads(body.oss_files);
    try {
      return await this.rdService.createTaskProgressNote({
      taskId: body.task_id ?? '',
      text: body.text ?? '',
      progress: Number.isFinite(progress) ? (progress as number) : undefined,
      workItemId: typeof body.work_item_id === 'string' ? body.work_item_id.trim() : undefined,
      mentions,
      actor: {
        id: req.user?.id,
        name: body.actor_name || req.user?.name,
        role: body.actor_role || req.user?.role,
      },
      files: files ?? [],
      uploadedFiles,
      // 归属校验只信任服务端鉴权得到的 req.user 身份（不用可被前端覆盖的 actor_name）
      requesterUserId: req.user?.id,
      requesterName: req.user?.name,
        canEditAny,
      });
    } catch (error) {
      await this.rdService.cleanupUnregisteredProgressNoteUploads(uploadedFiles, req.user?.id);
      throw error;
    }
  }

  // ── 留痕附件管理（工作台）：新增 / 替换 / 删除 ────────────────────────────
  // 权限口径在服务层收口：留痕作者本人 / 任务主责人 / 管理员；已完成或归档任务锁定。

  @Post('task-progress-notes/:taskId/:noteId/attachments')
  @Permissions('page:rd-my-workspace', 'page:us-collab-workspace', ...RD_TASK_MANAGER_PERMISSIONS)
  @UseInterceptors(FilesInterceptor('files', 10))
  async addTaskProgressNoteAttachments(
    @Param('taskId') taskId: string,
    @Param('noteId') noteId: string,
    @UploadedFiles() files: Array<{ originalname: string; mimetype?: string; size?: number; buffer: Buffer }> | undefined,
    @Body() body: { oss_files?: string },
    @Request() req: AuthedRequest,
  ) {
    return this.rdService.addTaskProgressNoteAttachments({
      taskId,
      noteId,
      files: files ?? [],
      requesterUserId: req.user?.id,
      requesterName: req.user?.name,
      requesterRole: req.user?.role,
      canEditAny: canManageTaskStructure(req.user?.permissions ?? []),
    });
  }

  @Put('task-progress-notes/:taskId/:noteId/attachments/:attachmentId')
  @Permissions('page:rd-my-workspace', 'page:us-collab-workspace', ...RD_TASK_MANAGER_PERMISSIONS)
  @UseInterceptors(FilesInterceptor('file', 1))
  async replaceTaskProgressNoteAttachment(
    @Param('taskId') taskId: string,
    @Param('noteId') noteId: string,
    @Param('attachmentId') attachmentId: string,
    @UploadedFiles() files: Array<{ originalname: string; mimetype?: string; size?: number; buffer: Buffer }> | undefined,
    @Body() body: { oss_files?: string },
    @Request() req: AuthedRequest,
  ) {
    const file = files?.[0];
    if (!file) throw new BadRequestException('替换附件不能为空');
    return this.rdService.replaceTaskProgressNoteAttachment({
      taskId,
      noteId,
      attachmentId,
      file,
      requesterUserId: req.user?.id,
      requesterName: req.user?.name,
      requesterRole: req.user?.role,
      canEditAny: canManageTaskStructure(req.user?.permissions ?? []),
    });
  }

  @Delete('task-progress-notes/:taskId/:noteId/attachments/:attachmentId')
  @Permissions('page:rd-my-workspace', 'page:us-collab-workspace', ...RD_TASK_MANAGER_PERMISSIONS)
  deleteTaskProgressNoteAttachment(
    @Param('taskId') taskId: string,
    @Param('noteId') noteId: string,
    @Param('attachmentId') attachmentId: string,
    @Request() req: AuthedRequest,
  ) {
    return this.rdService.deleteTaskProgressNoteAttachment({
      taskId,
      noteId,
      attachmentId,
      requesterUserId: req.user?.id,
      requesterName: req.user?.name,
      requesterRole: req.user?.role,
      canEditAny: canManageTaskStructure(req.user?.permissions ?? []),
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

  /** 研发个人工作台：只聚合当前登录人在研发池与协同池中的任务。 */
  @Get('workspace/combined')
  workspaceCombined(@Request() req: { user?: { id?: string; name?: string } }) {
    return this.rdService.getCombinedWorkspace(req.user?.id, req.user?.name);
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

  // 人员列表：除研发/协同页面码外，专职人员管理员（仅 rd-people:manage，无任何页面码）也必须能读，
  // 否则其人员管理页只能写不能读（写端点有专属码、读端点走类级 RD_READ 缺该码）。QA 套件覆盖此回归。
  @Get('people')
  @Permissions(...RD_READ_PERMISSIONS, 'rd-people:manage')
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

  // 「添加审核人」候选：仅审批流管理员可拉取；范围=本工作区持任一任务管理码的人（与审批授权同源）
  @Get('approval-candidates')
  @Permissions('rd-approval-flow:manage')
  approvalCandidates() {
    return this.rdService.getApprovalCandidates([...RD_TASK_MANAGER_PERMISSIONS]);
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
  auditLogs(@Request() req: AuthedRequest) {
    return this.rdService.getAuditLogs(buildAuditLogViewer(req));
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

  /**
   * 保存整簿快照（仅编辑者 rd-sheet:edit / 超管）。
   * base_updated_at 为乐观锁基线：与服务器当前版本不一致且未 force 时返回 409（被覆盖版本自动入历史）。
   */
  @Put('sheet-workbook')
  @Permissions('rd-sheet:edit')
  saveSheetWorkbook(
    @Body() body: { snapshot?: unknown; base_updated_at?: unknown; force?: unknown },
    @Request() req: AuthedRequest,
  ) {
    return this.rdService.saveSheetWorkbook(
      body?.snapshot,
      { id: req.user?.id, name: req.user?.name },
      {
        baseUpdatedAt: typeof body?.base_updated_at === 'string' ? body.base_updated_at : null,
        force: body?.force === true,
      },
    );
  }

  /**
   * 上传数据表图片资产（图片出仓）：保存前前端把快照内 base64 图片逐张传到这里换取
   * 同源永久资产 URL，快照只存 URL → 打开/保存的 JSON 从几十 MB 降到 MB 级。
   */
  @Post('sheet-workbook/assets')
  @Permissions('rd-sheet:edit')
  @UseInterceptors(FilesInterceptor('file', 1, { limits: { fileSize: 20 * 1024 * 1024 } }))
  uploadSheetAsset(
    @UploadedFiles() files: Array<{ originalname: string; mimetype?: string; buffer: Buffer }> | undefined,
  ) {
    const file = files?.[0];
    if (!file) throw new BadRequestException('图片资产不能为空');
    return this.rdService.uploadSheetAsset(file.buffer, file.originalname, file.mimetype);
  }

  /**
   * 数据表图片资产读取：Public + HMAC 能力 URL（Univer 通过 <img> 加载，带不了 Authorization）。
   * 内容按 key 不可变 → 允许浏览器长缓存一年，二次打开图片零流量。
   */
  @Public()
  @Permissions()
  @SkipThrottle()
  @Get('sheet-workbook/assets')
  async getSheetAsset(
    @Query('key') key: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Res() res: Response,
  ) {
    if (
      !key ||
      !this.rdService.isSheetAssetKey(key) ||
      !this.ossService.verifyPreviewToken(key, Number(exp), sig)
    ) {
      throw new NotFoundException();
    }
    const obj = await this.ossService.getObjectStream(key);
    if (!obj) throw new NotFoundException();

    res.setHeader('Content-Type', obj.contentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    // 双保险（上传侧已白名单排除 SVG 等可执行内容）：禁止 MIME 嗅探 + 禁止任何脚本执行，
    // 确保该同源公开端点即使被直开也不可能执行内容。
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    if (obj.size > 0) res.setHeader('Content-Length', String(obj.size));

    obj.stream.on('error', () => {
      if (res.headersSent) res.end();
      else res.status(500).end();
    });
    obj.stream.pipe(res);
  }

  /** 历史版本列表（每次保存自动留档，最近 10 版）。 */
  @Get('sheet-workbook/versions')
  @Permissions('page:rd-sheet', 'rd-sheet:edit')
  listSheetWorkbookVersions() {
    return this.rdService.listSheetWorkbookVersions();
  }

  /** 恢复到指定历史版本（当前版本先入历史，可再恢复回来）。 */
  @Post('sheet-workbook/versions/restore')
  @Permissions('rd-sheet:edit')
  restoreSheetWorkbookVersion(@Body() body: { id?: unknown }, @Request() req: AuthedRequest) {
    if (typeof body?.id !== 'string' || !body.id) throw new BadRequestException('缺少版本标识');
    return this.rdService.restoreSheetWorkbookVersion(body.id, { id: req.user?.id, name: req.user?.name });
  }

  /**
   * 存量快照图片出仓（管理员一次性操作）：把已存储快照中的 base64 图片迁移到 OSS。
   * 上线后调用一次即可让旧数据立刻瘦身，不必等编辑者重新保存。可重复调用直至 failed=0。
   */
  @Post('sheet-workbook/extract-assets')
  @Permissions('rd-sheet:edit')
  extractSheetWorkbookAssets(@Request() req: AuthedRequest) {
    return this.rdService.extractSheetWorkbookAssets({ id: req.user?.id, name: req.user?.name });
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
      const cleanup = this.ossService.signCleanupToken(objectKey, 7 * 24 * 3600);
      return {
        objectKey,
        putUrl,
        contentType: ct,
        cacheControl: 'private, max-age=31536000, immutable',
        cleanupExp: cleanup.exp,
        cleanupSig: cleanup.sig,
      };
    });
    return { enabled: true, files };
  }

  // ── 大文件分片上传（>5GB 的文件单次 PUT 会被 OSS 拒绝，必须走这里）───────────
  // 门控与 presign-upload 完全一致。对象前缀同为 rd/knowledge。

  /** 分片第 1 步：初始化，拿 uploadId 与前端必须遵循的 partSize。 */
  @Post('knowledge/multipart/init')
  @Permissions('rd-kb:upload', 'rd-task:create')
  initKbMultipart(
    @Body() body: { filename: string; content_type?: string; file_size: number },
  ) {
    return this.kbMultipart.init(
      'rd/knowledge',
      body.filename,
      body.content_type ?? '',
      Number(body.file_size),
    );
  }

  /** 分片第 2 步：为指定分片批量签 PUT URL。 */
  @Post('knowledge/multipart/sign')
  @Permissions('rd-kb:upload', 'rd-task:create')
  signKbMultipartParts(
    @Body() body: { object_key: string; upload_id: string; part_numbers: number[] },
  ) {
    return this.kbMultipart.sign('rd/knowledge', body.object_key, body.upload_id, body.part_numbers);
  }

  /** 查询已传分片，供断点续传跳过。 */
  @Post('knowledge/multipart/status')
  @Permissions('rd-kb:upload', 'rd-task:create')
  getKbMultipartStatus(@Body() body: { object_key: string; upload_id: string }) {
    return this.kbMultipart.status('rd/knowledge', body.object_key, body.upload_id);
  }

  /** 分片第 3 步：合并分片。 */
  @Post('knowledge/multipart/complete')
  @Permissions('rd-kb:upload', 'rd-task:create')
  completeKbMultipart(
    @Body() body: { object_key: string; upload_id: string; part_count?: number },
  ) {
    return this.kbMultipart.complete(
      'rd/knowledge',
      body.object_key,
      body.upload_id,
      body.part_count,
    );
  }

  /** 放弃上传并清理已传分片。 */
  @Post('knowledge/multipart/abort')
  @Permissions('rd-kb:upload', 'rd-task:create')
  abortKbMultipart(@Body() body: { object_key: string; upload_id: string }) {
    return this.kbMultipart.abort('rd/knowledge', body.object_key, body.upload_id);
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
      oss_files: Array<{
        oss_key: string;
        filename: string;
        file_size?: number;
        content_type?: string;
        cleanup_exp?: number;
        cleanup_sig?: string;
      }>;
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
    const cleanupFiles = (body.oss_files ?? []).map((file) => ({
      objectKey: file.oss_key,
      cleanupExp: file.cleanup_exp,
      cleanupSig: file.cleanup_sig,
    }));
    try {
      return await Promise.all((body.oss_files ?? []).map(async (f) => {
        const ext = f.filename.includes('.') ? f.filename.split('.').pop()!.toLowerCase() : '';
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
    } catch (error) {
      await this.rdService.cleanupUnregisteredKnowledgeObjects(undefined, 'rd/knowledge', cleanupFiles);
      throw error;
    }
  }

  @Post('knowledge/objects/cleanup')
  @Permissions('rd-kb:upload', 'rd-task:create')
  cleanupKnowledgeObjects(
    @Body() body: {
      files?: Array<{ object_key: string; cleanup_exp?: number; cleanup_sig?: string }>;
    },
  ) {
    return this.rdService.cleanupUnregisteredKnowledgeObjects(
      undefined,
      'rd/knowledge',
      (body.files ?? []).map((file) => ({
        objectKey: file.object_key,
        cleanupExp: file.cleanup_exp,
        cleanupSig: file.cleanup_sig,
      })),
    );
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

  /** 全量重建两池任务+留痕向量索引（先清池内旧 chunks 再重建）。高危管理码守卫。 */
  @Post('tasks/rag-backfill')
  @Permissions('rd-data:clear')
  backfillTasksToRag() {
    return this.rdService.backfillTasksToRag();
  }
}
