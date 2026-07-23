import { Body, Controller, Get, Post, Put, Query, Request, Res } from '@nestjs/common';
import type { Response } from 'express';

import { Permissions } from '../auth/decorators/permissions.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { TplusConfigDto, TplusExchangeCodeDto } from './dto/procurement.dto';
import { TplusSyncService } from './tplus-sync.service';

type AuthedRequest = { user: { id: string } };

/** 畅捷通 T+ 集成配置 + 只读同步的手动触发入口（后续可挂定时任务）。 */
@Controller('procurement/tplus')
export class TplusSyncController {
  constructor(private readonly sync: TplusSyncService) {}

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
}
