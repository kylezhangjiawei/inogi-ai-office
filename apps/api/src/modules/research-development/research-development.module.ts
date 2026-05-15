import { Module } from '@nestjs/common';

import { OcrModule } from '../ocr/ocr.module';
import { ResearchDevelopmentController } from './research-development.controller';
import { ResearchDevelopmentService } from './research-development.service';

@Module({
  imports: [OcrModule],
  controllers: [ResearchDevelopmentController],
  providers: [ResearchDevelopmentService],
})
export class ResearchDevelopmentModule {}
