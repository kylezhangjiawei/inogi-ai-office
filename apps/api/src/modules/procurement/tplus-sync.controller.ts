import { Body, Controller, Get, Param, Post, Put, Query, Request, Res } from '@nestjs/common';
import type { Response } from 'express';

import { Permissions } from '../auth/decorators/permissions.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { TplusConfigDto, TplusExchangeCodeDto } from './dto/procurement.dto';
import { TplusPoMatchService } from './tplus-po-match.service';
import { TplusSyncService } from './tplus-sync.service';

type AuthedRequest = { user: { id: string; name?: string; username?: string; permissions: string[] } };

/** 畅捷通 T+ 集成配置 + 只读同步的手动触发入口（后续可挂定时任务）。 */
@Controller('procurement/tplus')
export class TplusSyncController {
  constructor(
    private readonly sync: TplusSyncService,
    private readonly poMatch: TplusPoMatchService,
  ) {}

  @Get('status')
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
   * 处理 APP_TICKET / TEMP_AUTH_CODE / 取消授权等消息；任何输入都应答成功防重试轰炸，
   * 伪造消息最多污染 appTicket 缓存（下个 10 分钟周期即被真实推送覆盖），无凭据泄露面。
   */
  @Public()
  @Post('notify')
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

  @Post('sync/suppliers')
  @Permissions('proc:sync-erp')
  syncSuppliers() {
    return this.sync.syncSuppliers();
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

  /** 全量拉取采购订单到镜像表（近 90 天，日期过滤失败自动降级全量）。 */
  @Post('sync/purchase-orders-full')
  @Permissions('proc:sync-erp')
  syncPurchaseOrdersFull() {
    return this.sync.syncPurchaseOrderMirror();
  }

  /** 一键全同步（与每日 3:00 自动同步同一条链路）：供应商→库存→采购单全量→匹配。 */
  @Post('sync/auto')
  @Permissions('proc:sync-erp')
  syncAll() {
    return this.sync.autoSync();
  }

  /** 镜像清单（读操作走页面权限）。 */
  @Get('purchase-orders/mirror')
  listMirror(@Query('status') status?: string) {
    return this.poMatch.listMirror(status);
  }

  /** 跑规则 + AI 匹配，生成建议。 */
  @Post('purchase-orders/match')
  @Permissions('proc-task:order')
  runMatch() {
    return this.poMatch.runMatch();
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
