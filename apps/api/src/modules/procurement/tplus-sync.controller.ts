import { Body, Controller, Get, HttpCode, NotFoundException, Param, Patch, Post, Put, Query, Request, Res } from '@nestjs/common';
import type { Response } from 'express';

import { Permissions } from '../auth/decorators/permissions.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { getApplyJob, startApplyJob } from './apply-job.store';
import { PublishTplusMaterialDto, TplusConfigDto, TplusExchangeCodeDto } from './dto/procurement.dto';
import { TplusPoMatchService } from './tplus-po-match.service';
import { TplusOperationsService } from './tplus-operations.service';
import { TplusSyncService } from './tplus-sync.service';
import { SavePurchaseOrderAvailabilityDto } from './dto/purchase-order-availability.dto';

type AuthedRequest = { user: { id: string; name?: string; username?: string; permissions: string[] } };

/** 畅捷通 T+ 集成配置、同步与物料发布入口。 */
@Controller('procurement/tplus')
export class TplusSyncController {
  constructor(
    private readonly sync: TplusSyncService,
    private readonly poMatch: TplusPoMatchService,
    private readonly operations: TplusOperationsService,
  ) {}

  @Get('status')
  @Permissions('page:proc-materials', 'page:purchase-orders', 'page:inventory-management', 'proc:sync-erp')
  status() {
    return this.sync.status();
  }

  /** 配置状态（不回显 secret，appKey 掩码）。 */
  @Get('config')
  @Permissions('proc:sync-erp')
  getConfig() {
    return this.sync.getConfig();
  }

  /** 录入/更新凭据：appSecret 走 HTTPS 传输、落库加密；不传则保留已存值。 */
  @Put('config')
  @Permissions('proc:sync-erp')
  saveConfig(@Body() dto: TplusConfigDto, @Request() req: AuthedRequest) {
    return this.sync.saveConfig(dto, req.user.id);
  }

  /** 手动粘贴授权码换 token（回调直达不可用时的兜底）。 */
  @Post('oauth/exchange')
  @Permissions('proc:sync-erp')
  exchangeCode(@Body() dto: TplusExchangeCodeDto) {
    return this.sync.exchangeAuthCode(dto);
  }

  /**
   * 开放平台「消息接收地址」：平台主动 POST 推送（无登录态，须 Public）。
   * 处理 APP_TICKET / TEMP_AUTH_CODE / 取消授权等消息；服务按平台环境密钥解密并校验应用。
   * 只有验证通过的消息才能更新集成凭据，验证失败不得伪装接收成功。
   */
  @Public()
  @Post('notify')
  @HttpCode(200) // Nest 的 POST 默认 201，开放平台校验严格要求 200
  notify(@Body() body: Record<string, unknown>) {
    return this.sync.handlePlatformMessage(body ?? {});
  }

  /**
   * OAuth 回调：开放平台授权完成后浏览器跳转到此（无登录态，须 Public）。
   * 伪造的 code 在换 token 时会被开放平台拒绝，无实际风险；完成后跳回物料库。
   */
  @Public()
  @Get('oauth/callback')
  async oauthCallback(@Query('code') code: string, @Res() res: Response) {
    try {
      if (!code) throw new Error('缺少授权码');
      await this.sync.exchangeAuthCode({ code });
      res.redirect('/proc-materials?tplus=authorized');
    } catch (error) {
      const message = encodeURIComponent((error as Error).message ?? '授权失败');
      res.redirect(`/proc-materials?tplus=auth-failed&reason=${message}`);
    }
  }

  @Post('materials/:id/publish')
  @Permissions('proc:sync-erp')
  publishMaterial(@Param('id') id: string, @Body() dto: PublishTplusMaterialDto, @Request() req: AuthedRequest) {
    return this.sync.publishMaterial(id, dto, req.user.id);
  }

  @Post('sync/quote-book')
  @Permissions('proc:sync-erp')
  syncQuoteBook() {
    const job = startApplyJob('tplus-quote-book', update => this.sync.syncQuoteBook(update));
    return {jobId:job.id};
  }

  @Post('sync/suppliers')
  @Permissions('proc:sync-erp')
  syncSuppliers() {
    return this.sync.syncSuppliers();
  }

  /** 全量存货档案同步（含零库存物料）并补齐任务树关联；异步执行避免网关超时。 */
  @Post('sync/materials')
  @Permissions('proc:sync-erp')
  syncMaterials() {
    const job = startApplyJob('tplus-material-master', (update) => this.sync.syncMaterialMaster(update));
    return { jobId: job.id };
  }

  @Post('sync/inventory')
  @Permissions('proc:sync-erp')
  syncInventory() {
    return this.sync.syncInventory();
  }

  @Post('sync/purchase-orders')
  @Permissions('proc:sync-erp')
  syncPurchaseOrders() {
    return this.sync.syncPurchaseOrders();
  }

  // ── 采购单全量镜像 + 任务匹配 ────────────────────────────────────────────────

  /**
   * 全量拉取采购订单到镜像表（异步：234 张单逐单精查要几分钟，同步等会被网关 504 切断）。
   * 返回 jobId，前端轮询 GET sync/jobs/:id。
   */
  @Post('sync/purchase-orders-full')
  @Permissions('proc:sync-erp')
  syncPurchaseOrdersFull() {
    const job = startApplyJob('tplus-po-full', (update) => this.sync.syncPurchaseOrderMirror(90, update));
    return { jobId: job.id };
  }

  /** 一键全同步（异步）：主档→供应商→库存→采购单全量→匹配，不受自动同步开关影响。 */
  @Post('sync/auto')
  @Permissions('proc:sync-erp')
  syncAll() {
    const job = startApplyJob('tplus-auto-sync', (update) => this.sync.autoSync(update, { force: true }));
    return { jobId: job.id };
  }

  /** 采购订单 / 库存管理页面的一键同步，不受每日自动同步开关影响。 */
  @Post('sync/operations')
  @Permissions('proc:sync-erp')
  syncOperations() {
    const job = startApplyJob('tplus-operations-sync', async (update) => {
      update('正在同步物料主档…');
      const materials = await this.sync.syncMaterialMaster(update);
      update('物料主档已同步，正在同步库存…');
      const inventory = await this.sync.syncInventory();
      update('库存已同步，正在同步近 90 天采购订单…');
      const purchaseOrders = await this.sync.syncPurchaseOrderMirror(90, update);
      update('采购订单已同步，正在匹配采购任务…');
      const matches = await this.poMatch.runMatch();
      return { materials, inventory, purchaseOrders, matches };
    });
    return { jobId: job.id };
  }

  /** 同步/匹配任务进度查询（同步权限或采购员下单权限任一即可）。 */
  @Get('sync/jobs/:id')
  @Permissions('proc:sync-erp', 'proc-task:order')
  syncJob(@Param('id') id: string) {
    const job = getApplyJob(id);
    if (!job) throw new NotFoundException('任务不存在或已被清理（服务可能重启过），请重新发起');
    return job;
  }

  /** 镜像清单（读操作走页面权限）。 */
  @Get('purchase-orders/mirror')
  @Permissions('page:purchase-orders', 'page:proc-cockpit')
  listMirror(@Query('status') status?: string) {
    return this.poMatch.listMirror(status);
  }

  /** 给“采购订单 / 库存管理”页面使用的 T+ 只读视图。 */
  @Get('views/inventory')
  @Permissions('page:inventory-management')
  inventoryView(@Query() query: Record<string, unknown>) {
    return this.operations.listInventory(query);
  }

  @Post('views/inventory/export')
  @Permissions('page:inventory-management')
  inventoryExport(@Query() query: Record<string, unknown>) {
    return this.operations.exportInventory(query);
  }

  @Get('views/inventory/:id')
  @Permissions('page:inventory-management')
  inventoryDetail(@Param('id') id: string) {
    return this.operations.getInventoryDetail(id);
  }

  @Get('views/purchase-orders')
  @Permissions('page:purchase-orders')
  purchaseOrdersView(@Query() query: Record<string, unknown>) {
    return this.operations.listPurchaseOrders(query);
  }

  @Get('views/purchase-order-lines')
  @Permissions('page:purchase-orders', 'page:purchase-order-detail')
  purchaseOrderLinesView(@Query() query: Record<string, unknown>) {
    return this.operations.listPurchaseOrderLines(query);
  }

  @Get('views/purchase-orders/:id')
  @Permissions('page:purchase-order-detail')
  purchaseOrderView(@Param('id') id: string) {
    return this.operations.getPurchaseOrder(id);
  }

  @Patch('views/purchase-orders/:orderId/lines/:lineId/availability')
  @Permissions('proc-purchase-order:confirm-availability')
  savePurchaseOrderAvailability(
    @Param('orderId') orderId: string,
    @Param('lineId') lineId: string,
    @Body() body: SavePurchaseOrderAvailabilityDto,
    @Request() req: AuthedRequest,
  ) {
    return this.operations.savePurchaseOrderAvailability(orderId, lineId, body, {
      id: req.user.id, name: req.user.name ?? req.user.username ?? '', permissions: req.user.permissions ?? [],
    });
  }

  /** 跑规则 + AI 匹配（异步：AI 名称匹配单次调用可超网关时限），生成建议。 */
  @Post('purchase-orders/match')
  @Permissions('proc-task:order')
  runMatch() {
    const job = startApplyJob('tplus-po-match', () => this.poMatch.runMatch());
    return { jobId: job.id };
  }

  /** 确认建议（可覆盖目标任务），复用 linkPurchaseOrder 建关联。 */
  @Post('purchase-orders/mirror/:id/confirm')
  @Permissions('proc-task:order')
  confirmMatch(
    @Param('id') id: string,
    @Body() body: { taskId?: string },
    @Request() req: AuthedRequest,
  ) {
    const actor = {
      id: req.user.id,
      name: req.user.name ?? req.user.username ?? '',
      permissions: req.user.permissions ?? [],
    };
    return this.poMatch.confirm(id, actor, body?.taskId);
  }

  @Post('purchase-orders/mirror/:id/ignore')
  @Permissions('proc-task:order')
  ignoreMatch(@Param('id') id: string) {
    return this.poMatch.ignore(id);
  }
}
