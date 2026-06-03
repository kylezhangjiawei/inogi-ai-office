import { Module } from '@nestjs/common';

import { OcrModule } from '../ocr';
import { MailIngestionService } from '../resume-screening/mail-ingestion.service';
import { OrderProcessingController } from './order-processing.controller';
import { OrderProcessingService } from './order-processing.service';

@Module({
  imports: [OcrModule],
  controllers: [OrderProcessingController],
  providers: [OrderProcessingService, MailIngestionService],
})
export class OrderProcessingModule {}
