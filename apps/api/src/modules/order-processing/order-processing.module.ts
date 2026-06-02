import { Module } from '@nestjs/common';

import { OcrModule } from '../ocr';
import { OrderProcessingController } from './order-processing.controller';
import { OrderProcessingService } from './order-processing.service';

@Module({
  imports: [OcrModule],
  controllers: [OrderProcessingController],
  providers: [OrderProcessingService],
})
export class OrderProcessingModule {}
