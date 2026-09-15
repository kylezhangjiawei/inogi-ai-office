import { Module } from '@nestjs/common';

import { ChatModule } from '../chat/chat.module';
import { OcrModule } from '../ocr/ocr.module';
import { ResearchDevelopmentModule } from '../research-development/research-development.module';
import { SecurityModule } from '../security/security.module';
import { MaterialClassifyService } from './material-classify.service';
import { MaterialReplenishService } from './material-replenish.service';
import { MaterialSafeStockService } from './material-safestock.service';
import { ProcurementController } from './procurement.controller';
import { ProcurementOperationsController } from './procurement-operations.controller';
import { ProcurementOperationsService } from './procurement-operations.service';
import { QuoteBookController } from './quote-book.controller';
import { QuoteBookService } from './quote-book.service';
import { TplusPoMatchService } from './tplus-po-match.service';
import { TplusOperationsService } from './tplus-operations.service';
import { ProcurementService } from './procurement.service';
import { TplusSyncController } from './tplus-sync.controller';
import { TplusSyncService } from './tplus-sync.service';
import { PurchaseReceiptsController } from './purchase-receipts.controller';
import { PurchaseReceiptsService } from './purchase-receipts.service';

/**
 * 采购管理：采购任务全流程 + 物料主数据 + 报价，以及与畅捷通 T+ 的只读同步。
 * 与 OrderProcessingModule（销售侧订单/发票/自有库存）无依赖关系，勿互相引用。
 * ChatModule 仅用于「AI 建单」的自然语言解析（ChatService.complete，失败降级启发式）。
 * SecurityModule 用于 T+ appSecret 的落库加密与读取解密。
 */
@Module({
  // ResearchDevelopmentModule 仅用于审核驳回时给研发对接人发站内通知（createMessage）
  // OcrModule 仅用于报价库「图片表格 OCR + AI」导入兜底
  imports: [ChatModule, OcrModule, SecurityModule, ResearchDevelopmentModule],
  controllers: [ProcurementController, ProcurementOperationsController, QuoteBookController, TplusSyncController, PurchaseReceiptsController],
  providers: [
    ProcurementService,
    ProcurementOperationsService,
    QuoteBookService,
    TplusSyncService,
    MaterialClassifyService,
    MaterialSafeStockService,
    MaterialReplenishService,
    TplusPoMatchService,
    TplusOperationsService,
    PurchaseReceiptsService,
  ],
  exports: [ProcurementService],
})
export class ProcurementModule {}
