import { Body, Controller, Get, Post, Put, Request } from '@nestjs/common';

import { Permissions } from '../auth/decorators/permissions.decorator';
import { TplusConfigDto } from './dto/procurement.dto';
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
