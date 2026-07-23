import { Module } from '@nestjs/common';

import { ChatModule } from '../chat/chat.module';
import { SecurityModule } from '../security/security.module';
import { ProcurementController } from './procurement.controller';
import { ProcurementService } from './procurement.service';
import { TplusSyncController } from './tplus-sync.controller';
import { TplusSyncService } from './tplus-sync.service';

/**
 * 采购管理：采购任务全流程 + 物料主数据 + 报价，以及与畅捷通 T+ 的只读同步。
 * 与 OrderProcessingModule（销售侧订单/发票/自有库存）无依赖关系，勿互相引用。
 * ChatModule 仅用于「AI 建单」的自然语言解析（ChatService.complete，失败降级启发式）。
 * SecurityModule 用于 T+ appSecret 的落库加密与读取解密。
 */
@Module({
  imports: [ChatModule, SecurityModule],
  controllers: [ProcurementController, TplusSyncController],
  providers: [ProcurementService, TplusSyncService],
  exports: [ProcurementService],
})
export class ProcurementModule {}
