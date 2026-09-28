import { Module } from '@nestjs/common';

import { OcrModule } from '../ocr';
import { MailIngestionService } from '../resume-screening/mail-ingestion.service';
import { OrderProcessingController } from './order-processing.controller';
import { OrderProcessingService } from './order-processing.service';
import { InventoryStockModule } from '../inventory-stock/inventory-stock.module';
import { OrderStockService } from './order-stock.service';

@Module({
  imports: [OcrModule, InventoryStockModule],
  controllers: [OrderProcessingController],
  providers: [OrderProcessingService, OrderStockService, MailIngestionService],
})
export class OrderProcessingModule {}
