import { Controller, Get, Post } from '@nestjs/common';

import { Permissions } from '../auth/decorators/permissions.decorator';
import { TplusSyncService } from './tplus-sync.service';

/** 畅捷通 T+ 只读同步的手动触发入口（后续可挂定时任务）。 */
@Controller('procurement/tplus')
export class TplusSyncController {
  constructor(private readonly sync: TplusSyncService) {}

  @Get('status')
  status() {
    return this.sync.status();
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
