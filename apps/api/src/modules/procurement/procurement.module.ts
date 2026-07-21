import { Module } from '@nestjs/common';

import { ProcurementController } from './procurement.controller';
import { ProcurementService } from './procurement.service';
import { TplusSyncController } from './tplus-sync.controller';
import { TplusSyncService } from './tplus-sync.service';

/**
 * 采购管理：采购任务全流程 + 物料主数据 + 报价，以及与畅捷通 T+ 的只读同步。
 * 与 OrderProcessingModule（销售侧订单/发票/自有库存）无依赖关系，勿互相引用。
 */
@Module({
  controllers: [ProcurementController, TplusSyncController],
  providers: [ProcurementService, TplusSyncService],
  exports: [ProcurementService],
})
export class ProcurementModule {}
