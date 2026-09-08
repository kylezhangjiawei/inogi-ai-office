import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Put, Query, Request } from '@nestjs/common';

import { Permissions } from '../auth/decorators/permissions.decorator';
import {
  AiParseTaskDto,
  ApplyQuoteBookQuotesDto,
  BatchLinkPurchaseOrdersDto,
  BatchReassignDto,
  MoveProcTasksDto,
  CancelProcTaskDto,
  ConfirmQuoteBookQuotesDto,
  CreateProcStockPlanBatchDto,
  CreateProcStockPlanDto,
  CreateProcTaskTreeNodeDto,
  ImportBomDto,
  CreateProcTaskDto,
  ImportMaterialsDto,
  LinkPurchaseOrderDto,
  ProcAttachmentInputDto,
  ReassignProcTaskDto,
  ResetTaskQuotationsDto,
  ReceiveGoodsDto,
  RenameCategoryDto,
  ReviewMaterialDto,
  RollbackProcTaskDto,
  SetProcCoreMaterialsDto,
  SetProcTaskCriticalMaterialsDto,
  TransferFromRdDto,
  TransitionProcTaskDto,
  UpdateProcTaskTreeNodeDto,
  UpdateProcTaskDto,
  UpdateProcStockPlanBatchDto,
  UpdateProcStockPlanDto,
  UpsertMaterialDto,
} from './dto/procurement.dto';
import { getApplyJob, startApplyJob } from './apply-job.store';
import { MaterialClassifyService } from './material-classify.service';
import { MaterialReplenishService } from './material-replenish.service';
import { MaterialSafeStockService } from './material-safestock.service';
import { ProcurementService } from './procurement.service';
import type { ProcActor, ProcMaterialListQuery, ProcTaskListQuery } from './procurement.types';

type AuthedRequest = {
  user: { id: string; name?: string; username?: string; permissions: string[] };
};

/**
 * 采购管理接口。
 * 读操作也在后端按对应采购页面权限守卫，不能只依赖前端路由隐藏；
 * 写操作按 proc-task:* / material:* 操作码校验（全局 RolesGuard 生效，'*' 直通）。
 */
@Controller('procurement')
export class ProcurementController {
  constructor(
    private readonly service: ProcurementService,
    private readonly classify: MaterialClassifyService,
    private readonly safeStock: MaterialSafeStockService,
    private readonly replenish: MaterialReplenishService,
  ) {}

  private actor(req: AuthedRequest): ProcActor {
    return {
      id: req.user.id,
      name: req.user.name ?? req.user.username ?? '',
      permissions: req.user.permissions ?? [],
    };
  }

  // ── 任务 ────────────────────────────────────────────────────────────────────

  @Get('tasks')
  @Permissions('page:proc-cockpit', 'page:proc-my-workspace', 'page:proc-materials', 'proc-task:transfer', 'rd-procurement:review')
  listTasks(@Query() query: ProcTaskListQuery, @Request() req: AuthedRequest) {
    return this.service.listTasks(query, this.actor(req));
  }

  @Get('summary')
  @Permissions('page:proc-cockpit', 'page:proc-my-workspace')
  summary() {
    return this.service.summary();
  }

  /** 负责人候选目录（转派/建单人员选择），读操作与其他采购读接口一致仅需登录。 */
  @Get('buyers')
  @Permissions('page:proc-cockpit', 'page:proc-my-workspace', 'page:proc-materials', 'proc-task:transfer')
  listBuyers(@Query('scope') scope?: string) {
    const normalizedScope = scope === 'all' || scope === 'department' ? scope : 'eligible';
    return this.service.listBuyerCandidates(normalizedScope);
  }

  /** 采购成员名录（读仅需登录；增删与转派同权限，由采购管理者维护）。 */
  @Get('buyer-roster')
  @Permissions('page:proc-cockpit')
  getBuyerRoster() {
    return this.service.getBuyerRoster();
  }

  @Post('buyer-roster')
  @Permissions('proc-task:reassign')
  addBuyerRosterMember(@Body() body: { userId?: string }) {
    if (!body?.userId) throw new BadRequestException('缺少 userId');
    return this.service.addBuyerRosterMember(body.userId);
  }

  @Patch('buyer-roster/:userId')
  @Permissions('proc-task:reassign')
  updateBuyerRosterMember(@Param('userId') userId: string, @Body() body: { note?: string }) {
    return this.service.updateBuyerRosterMember(userId, body?.note ?? '');
  }

  @Delete('buyer-roster/:userId')
  @Permissions('proc-task:reassign')
  removeBuyerRosterMember(@Param('userId') userId: string) {
    return this.service.removeBuyerRosterMember(userId);
  }

  /** 将全部未指派的进行中任务按采购成员当前负载自动均衡分配。 */
  @Post('buyer-roster/auto-assign')
  @Permissions('proc-task:reassign')
  autoAssignBuyerTasks(@Request() req: AuthedRequest) {
    return this.service.autoAssignUnassigned(this.actor(req));
  }

  // ── 备货计划 ────────────────────────────────────────────────────────────────

  @Get('stock-plans')
  @Permissions('page:proc-cockpit')
  listStockPlans() {
    return this.service.listStockPlans();
  }

  @Post('stock-plans')
  @Permissions('proc-task:create')
  createStockPlan(@Body() dto: CreateProcStockPlanDto, @Request() req: AuthedRequest) {
    return this.service.createStockPlan(dto, this.actor(req));
  }

  @Put('stock-plans/:id')
  @Permissions('proc-task:create')
  updateStockPlan(
    @Param('id') id: string,
    @Body() dto: UpdateProcStockPlanDto,
  ) {
    return this.service.updateStockPlan(id, dto);
  }

  @Post('stock-plans/:id/batches')
  @Permissions('proc-task:create')
  createStockPlanBatch(
    @Param('id') id: string,
    @Body() dto: CreateProcStockPlanBatchDto,
    @Request() req: AuthedRequest,
  ) {
    return this.service.createStockPlanBatch(id, dto, this.actor(req));
  }

  @Put('stock-plans/:planId/batches/:batchId')
  @Permissions('proc-task:create')
  updateStockPlanBatch(
    @Param('planId') planId: string,
    @Param('batchId') batchId: string,
    @Body() dto: UpdateProcStockPlanBatchDto,
  ) {
    return this.service.updateStockPlanBatch(planId, batchId, dto);
  }

  @Delete('stock-plans/:planId/batches/:batchId')
  @Permissions('proc-task:create')
  deleteStockPlanBatch(
    @Param('planId') planId: string,
    @Param('batchId') batchId: string,
  ) {
    return this.service.deleteStockPlanBatch(planId, batchId);
  }

  @Get('tasks/:id')
  @Permissions('page:proc-cockpit', 'page:proc-my-workspace', 'page:proc-materials', 'proc-task:transfer', 'rd-procurement:review')
  getTask(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.service.getTask(id, this.actor(req));
  }

  @Post('tasks')
  @Permissions('proc-task:create')
  createTask(@Body() dto: CreateProcTaskDto, @Request() req: AuthedRequest) {
    return this.service.createTask(dto, this.actor(req));
  }

  /** AI 建单解析：只产出草稿不落库，前端确认后仍走 POST /tasks。 */
  @Post('tasks/ai-parse')
  @Permissions('proc-task:create')
  aiParseTask(@Body() dto: AiParseTaskDto) {
    return this.service.aiParseTask(dto);
  }

  /** 研发侧「转采购」入口：研发人员持 proc-task:transfer 即可提交。 */
  @Post('tasks/transfer')
  @Permissions('proc-task:transfer')
  transfer(@Body() dto: TransferFromRdDto, @Request() req: AuthedRequest) {
    return this.service.transferFromRd(dto, this.actor(req));
  }

  @Put('tasks/:id')
  @Permissions('proc-task:create')
  updateTask(
    @Param('id') id: string,
    @Body() dto: UpdateProcTaskDto,
    @Request() req: AuthedRequest,
  ) {
    return this.service.updateTask(id, dto, this.actor(req));
  }

  @Put('tasks/:id/critical-materials')
  @Permissions('proc-task:create')
  setTaskCriticalMaterials(
    @Param('id') id: string,
    @Body() dto: SetProcTaskCriticalMaterialsDto,
    @Request() req: AuthedRequest,
  ) {
    return this.service.setTaskCriticalMaterials(id, dto, this.actor(req));
  }

  @Post('tasks/:id/confirm')
  @Permissions('proc-task:confirm')
  confirm(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.service.confirmTask(id, this.actor(req));
  }

  /** 研发管理员前置审核：通过后任务才进入采购待处理并自动分配负责人。 */
  @Post('tasks/:id/rd-review/approve')
  @Permissions('rd-procurement:review')
  approveRdTransfer(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.service.approveRdTransfer(id, this.actor(req));
  }

  /** 研发管理员打回：删除本次采购流转，研发人员修改后可再次提交。 */
  @Post('tasks/:id/rd-review/reject')
  @Permissions('rd-procurement:review')
  rejectRdTransfer(
    @Param('id') id: string,
    @Body() dto: CancelProcTaskDto,
    @Request() req: AuthedRequest,
  ) {
    return this.service.rejectRdTransfer(id, dto?.reason ?? '', this.actor(req));
  }

  @Post('tasks/:id/transition')
  @Permissions('proc-task:inquiry')
  transition(
    @Param('id') id: string,
    @Body() dto: TransitionProcTaskDto,
    @Request() req: AuthedRequest,
  ) {
    return this.service.transitionTask(id, dto, this.actor(req));
  }

  @Post('tasks/:id/cancel')
  @Permissions('proc-task:delete')
  cancel(@Param('id') id: string, @Body() dto: CancelProcTaskDto, @Request() req: AuthedRequest) {
    return this.service.cancelTask(id, dto, this.actor(req));
  }

  /** 审核驳回研发流转任务（与「确认提交」同权限：能审核通过就能驳回）。 */
  @Post('tasks/:id/reject')
  @Permissions('proc-task:confirm')
  reject(@Param('id') id: string, @Body() dto: CancelProcTaskDto, @Request() req: AuthedRequest) {
    return this.service.rejectRdTask(id, dto?.reason ?? '', this.actor(req));
  }

  /** 手工登记到货：过渡期能力，T+ 接通后改由同步驱动并下线本端点。 */
  @Post('tasks/:id/receive')
  @Permissions('proc-task:receive')
  receive(@Param('id') id: string, @Body() dto: ReceiveGoodsDto, @Request() req: AuthedRequest) {
    return this.service.receiveGoods(id, dto, this.actor(req));
  }

  @Post('tasks/:id/reassign')
  @Permissions('proc-task:reassign')
  reassign(
    @Param('id') id: string,
    @Body() dto: ReassignProcTaskDto,
    @Request() req: AuthedRequest,
  ) {
    return this.service.reassignTask(id, dto, this.actor(req));
  }

  /** 批量转派：事务原子执行（终态任务或不存在的 id 会让整批回滚）。 */
  @Post('tasks/batch-reassign')
  @Permissions('proc-task:reassign')
  batchReassign(@Body() dto: BatchReassignDto, @Request() req: AuthedRequest) {
    return this.service.batchReassign(dto, this.actor(req));
  }

  /**
   * 批量移动任务归类到子系统树的任意节点。
   * 不新增权限码：归类是编辑动作，能编辑或转派任务的人即可移动——新增独立权限码
   * 在没有角色持有时会让入口直接消失。
   */
  @Post('tasks/move')
  @Permissions('proc-task:create', 'proc-task:reassign')
  moveTasks(@Body() dto: MoveProcTasksDto, @Request() req: AuthedRequest) {
    return this.service.moveTasks(dto, this.actor(req));
  }

  @Delete('tasks/:id')
  @Permissions('proc-task:delete')
  remove(@Param('id') id: string) {
    return this.service.deleteTask(id);
  }

  @Post('tasks/:id/attachments')
  @Permissions('proc-task:create')
  addAttachments(
    @Param('id') id: string,
    @Body() body: { items: ProcAttachmentInputDto[] },
    @Request() req: AuthedRequest,
  ) {
    return this.service.addAttachments(id, body.items ?? [], this.actor(req));
  }

  // ── 报价 ────────────────────────────────────────────────────────────────────

  @Get('quotations')
  @Permissions('page:proc-cockpit', 'page:proc-my-workspace', 'page:proc-materials')
  listQuotations(
    @Query('materialId') materialId?: string,
    @Query('materialName') materialName?: string,
    @Query('taskId') taskId?: string,
  ) {
    return this.service.listQuotations({ materialId, materialName, taskId });
  }

  /** 查询本任务可用的报价库记录；服务端按任务数量匹配对应阶梯价。 */
  @Get('tasks/:id/quote-book-options')
  @Permissions('proc-task:inquiry')
  listTaskQuoteBookOptions(@Param('id') id: string) {
    return this.service.listTaskQuoteBookOptions(id);
  }

  /** 从报价库批量带入报价，任务内只保存当次不可变快照。 */
  @Post('tasks/:id/quotations/from-quote-book')
  @Permissions('proc-task:inquiry')
  addQuotationsFromQuoteBook(
    @Param('id') id: string,
    @Body() dto: ApplyQuoteBookQuotesDto,
    @Request() req: AuthedRequest,
  ) {
    return this.service.addQuotationsFromQuoteBook(id, dto, this.actor(req));
  }

  /** 从报价库批量带入并直接确认，多条报价作为同一批次一起生效。 */
  @Post('tasks/:id/quotations/from-quote-book/confirm')
  @Permissions('proc-task:inquiry')
  confirmQuotationsFromQuoteBook(
    @Param('id') id: string,
    @Body() dto: ConfirmQuoteBookQuotesDto,
    @Request() req: AuthedRequest,
  ) {
    return this.service.confirmQuotationsFromQuoteBook(id, dto, this.actor(req));
  }

  /** 回退会清理报价与采购单关联，使用独立权限，不与日常推进共用。 */
  @Post('tasks/:id/rollback')
  @Permissions('proc-task:rollback')
  rollback(
    @Param('id') id: string,
    @Body() dto: RollbackProcTaskDto,
    @Request() req: AuthedRequest,
  ) {
    return this.service.rollbackTask(id, dto, this.actor(req));
  }

  /** 重新维护报价：清空本任务已确认的报价并退回「待询价」。仅限未下单阶段。 */
  @Post('tasks/:id/quotations/reset')
  @Permissions('proc-task:select-quote')
  resetTaskQuotations(
    @Param('id') id: string,
    @Body() dto: ResetTaskQuotationsDto,
    @Request() req: AuthedRequest,
  ) {
    return this.service.resetTaskQuotations(id, dto.reason, this.actor(req));
  }

  @Post('tasks/:id/quotations/:quotationId/select')
  @Permissions('proc-task:select-quote')
  selectQuotation(
    @Param('id') id: string,
    @Param('quotationId') quotationId: string,
    @Request() req: AuthedRequest,
  ) {
    return this.service.selectQuotation(id, quotationId, this.actor(req));
  }

  // ── T+ 采购单接缝 ───────────────────────────────────────────────────────────

  @Post('tasks/:id/purchase-orders')
  @Permissions('proc-task:order')
  linkPurchaseOrder(
    @Param('id') id: string,
    @Body() dto: LinkPurchaseOrderDto,
    @Request() req: AuthedRequest,
  ) {
    return this.service.linkPurchaseOrder(id, dto, this.actor(req));
  }

  @Post('tasks/:id/purchase-orders/batch')
  @Permissions('proc-task:order')
  linkPurchaseOrders(
    @Param('id') id: string,
    @Body() dto: BatchLinkPurchaseOrdersDto,
    @Request() req: AuthedRequest,
  ) {
    return this.service.linkPurchaseOrders(id, dto.items, this.actor(req), {
      syncTaskQuantity: dto.syncTaskQuantity,
    });
  }

  @Delete('tasks/:id/purchase-orders/:refId')
  @Permissions('proc-task:order')
  unlinkPurchaseOrder(
    @Param('id') id: string,
    @Param('refId') refId: string,
    @Request() req: AuthedRequest,
  ) {
    return this.service.unlinkPurchaseOrder(id, refId, this.actor(req));
  }

  // ── 物料主数据 ───────────────────────────────────────────────────────────────

  @Get('materials')
  @Permissions('page:proc-materials', 'page:proc-cockpit', 'page:proc-my-workspace')
  listMaterials(@Query() query: ProcMaterialListQuery) {
    return this.service.listMaterials(query);
  }

  @Post('materials')
  @Permissions('proc-task:create')
  createMaterial(@Body() dto: UpsertMaterialDto, @Request() req: AuthedRequest) {
    return this.service.upsertMaterial(dto, this.actor(req));
  }

  @Put('materials/:id')
  @Permissions('proc-task:create')
  updateMaterial(
    @Param('id') id: string,
    @Body() dto: UpsertMaterialDto,
    @Request() req: AuthedRequest,
  ) {
    return this.service.upsertMaterial(dto, this.actor(req), id);
  }

  @Patch('materials/:id/review')
  @Permissions('material:review')
  reviewMaterial(
    @Param('id') id: string,
    @Body() dto: ReviewMaterialDto,
    @Request() req: AuthedRequest,
  ) {
    return this.service.reviewMaterial(id, dto, this.actor(req));
  }

  @Post('materials/import')
  @Permissions('material:import')
  importMaterials(@Body() dto: ImportMaterialsDto, @Request() req: AuthedRequest) {
    return this.service.importMaterials(dto, this.actor(req));
  }

  /** 采购任务驾驶舱系统树：分类根节点 → 物料名称子节点。 */
  @Get('task-tree')
  @Permissions('page:proc-cockpit')
  getTaskTree(@Query('productId') productId?: string) {
    return this.service.getProcTaskTree(productId);
  }

  @Get('task-tree/core-materials')
  @Permissions('page:proc-cockpit')
  getCoreMaterials() {
    return this.service.getCoreMaterialConfig();
  }

  @Put('task-tree/core-materials/:productId')
  @Permissions('proc-task:create')
  setCoreMaterials(
    @Param('productId') productId: string,
    @Body() dto: SetProcCoreMaterialsDto,
    @Request() req: AuthedRequest,
  ) {
    return this.service.setCoreMaterialConfig(productId, dto, this.actor(req));
  }

  @Post('task-tree/nodes')
  @Permissions('proc-task:create')
  createTaskTreeNode(@Body() dto: CreateProcTaskTreeNodeDto) {
    return this.service.createProcTaskTreeNode(dto);
  }

  @Patch('task-tree/nodes/:id')
  @Permissions('proc-task:create')
  updateTaskTreeNode(@Param('id') id: string, @Body() dto: UpdateProcTaskTreeNodeDto) {
    return this.service.updateProcTaskTreeNode(id, dto);
  }

  @Delete('task-tree/nodes/:id')
  @Permissions('proc-task:delete')
  deleteTaskTreeNode(@Param('id') id: string) {
    return this.service.deleteProcTaskTreeNode(id);
  }

  /** BOM 树查询（机型/部件/组件 → 原料）。 */
  @Get('bom')
  @Permissions('page:proc-materials', 'page:proc-cockpit', 'page:proc-inventory-readiness')
  getBomTree() {
    return this.service.getBomTree();
  }

  /** 量产仓库库存 × 产品 BOM：计算当前及在途到货后的物料可齐套套数。 */
  @Get('inventory-readiness')
  @Permissions('page:proc-inventory-readiness')
  getInventoryReadiness(@Query() query: Record<string, unknown>) {
    return this.service.getInventoryReadiness(query);
  }

  /** BOM 导入：replace=true 全量替换；叶子按 T+ 存货编码匹配物料并回填产品线。 */
  @Post('bom/import')
  @Permissions('material:import')
  importBom(@Body() dto: ImportBomDto) {
    return this.service.importBom(dto);
  }

  /** 初步分类干跑：统计规则可分多少、AI 要兜多少，不落库。 */
  @Get('materials/classify/preview')
  @Permissions('material:import')
  classifyPreview() {
    return this.classify.preview();
  }

  /**
   * 初步分类应用（异步）：AI 批量要几分钟，同步等响应会被网关超时切成 502。
   * 立即返回 jobId，前端轮询 GET materials/apply-jobs/:id 取进度与结果。
   */
  @Post('materials/classify/apply')
  @Permissions('material:import')
  classifyApply(@Request() req: AuthedRequest) {
    const job = startApplyJob('classify', (update) => this.classify.apply(req.user.id, update));
    return { jobId: job.id };
  }

  /** 批量应用任务进度/结果（分类与安全库存共用）。 */
  @Get('materials/apply-jobs/:id')
  @Permissions('material:import')
  applyJob(@Param('id') id: string) {
    const job = getApplyJob(id);
    if (!job) throw new NotFoundException('任务不存在或已被清理（服务可能重启过），请重新发起');
    return job;
  }

  /** 安全库存初始化干跑：基于采购单镜像统计建议值，不落库。 */
  @Get('materials/safe-stock/preview')
  @Permissions('material:import')
  safeStockPreview() {
    return this.safeStock.preview();
  }

  /** 安全库存初始化应用（异步，同分类）：只填 safeStock=0 的物料，人工值不覆盖。 */
  @Post('materials/safe-stock/apply')
  @Permissions('material:import')
  safeStockApply(@Request() req: AuthedRequest) {
    const job = startApplyJob('safe-stock', (update) => this.safeStock.apply(req.user.id, update));
    return { jobId: job.id };
  }

  /** 补货建议清单：缺口 = 安全库存 − 库存 − 在途 − 进行中任务，>0 才列出。 */
  @Get('materials/replenish/suggestions')
  @Permissions('page:proc-materials')
  replenishSuggestions() {
    return this.replenish.suggestions();
  }

  /** 勾选补货条目批量生成采购任务（询价起点，零库存自动高优先级）。 */
  @Post('materials/replenish/create-tasks')
  @Permissions('proc-task:create')
  replenishCreateTasks(
    @Body() body: { items: Array<{ materialId: string; quantity: number }> },
    @Request() req: AuthedRequest,
  ) {
    return this.replenish.createTasks(body?.items ?? [], this.actor(req));
  }

  /** 分类重命名/合并（分类无独立表，批量改物料冗余字段）。 */
  @Post('materials/categories/rename')
  @Permissions('material:import')
  renameCategory(@Body() dto: RenameCategoryDto) {
    return this.service.renameCategory(dto);
  }

}
