import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Put, Query, Request } from '@nestjs/common';

import { Permissions } from '../auth/decorators/permissions.decorator';
import {
  AiParseTaskDto,
  BatchReassignDto,
  CancelProcTaskDto,
  ImportBomDto,
  CreateProcTaskDto,
  CreateQuotationDto,
  ImportMaterialsDto,
  LinkPurchaseOrderDto,
  ProcAttachmentInputDto,
  ReassignProcTaskDto,
  ReceiveGoodsDto,
  RenameCategoryDto,
  ReviewMaterialDto,
  TransferFromRdDto,
  TransitionProcTaskDto,
  UpdateProcTaskDto,
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
 * 读操作只需页面权限（page:proc-cockpit / page:proc-materials，由前端路由守卫控制），
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
  listTasks(@Query() query: ProcTaskListQuery) {
    return this.service.listTasks(query);
  }

  @Get('summary')
  summary() {
    return this.service.summary();
  }

  /** 负责人候选目录（转派/建单人员选择），读操作与其他采购读接口一致仅需登录。 */
  @Get('buyers')
  listBuyers() {
    return this.service.listBuyerCandidates();
  }

  /** 采购成员名录（读仅需登录；增删与转派同权限，由采购管理者维护）。 */
  @Get('buyer-roster')
  getBuyerRoster() {
    return this.service.getBuyerRoster();
  }

  @Post('buyer-roster')
  @Permissions('proc-task:reassign')
  addBuyerRosterMember(@Body() body: { userId?: string }) {
    if (!body?.userId) throw new BadRequestException('缺少 userId');
    return this.service.addBuyerRosterMember(body.userId);
  }

  @Delete('buyer-roster/:userId')
  @Permissions('proc-task:reassign')
  removeBuyerRosterMember(@Param('userId') userId: string) {
    return this.service.removeBuyerRosterMember(userId);
  }

  @Get('tasks/:id')
  getTask(@Param('id') id: string) {
    return this.service.getTask(id);
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

  @Post('tasks/:id/confirm')
  @Permissions('proc-task:confirm')
  confirm(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.service.confirmTask(id, this.actor(req));
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
  listQuotations(
    @Query('materialId') materialId?: string,
    @Query('materialName') materialName?: string,
    @Query('taskId') taskId?: string,
  ) {
    return this.service.listQuotations({ materialId, materialName, taskId });
  }

  @Post('tasks/:id/quotations')
  @Permissions('proc-task:inquiry')
  addQuotation(
    @Param('id') id: string,
    @Body() dto: CreateQuotationDto,
    @Request() req: AuthedRequest,
  ) {
    return this.service.addQuotation(id, dto, this.actor(req));
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

  @Delete('tasks/:id/purchase-orders/:refId')
  @Permissions('proc-task:order')
  unlinkPurchaseOrder(@Param('id') id: string, @Param('refId') refId: string) {
    return this.service.unlinkPurchaseOrder(id, refId);
  }

  // ── 物料主数据 ───────────────────────────────────────────────────────────────

  @Get('materials')
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

  /** BOM 树查询（机型/部件/组件 → 原料）。 */
  @Get('bom')
  getBomTree() {
    return this.service.getBomTree();
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
