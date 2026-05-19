import { Module } from '@nestjs/common';

import { OcrModule } from '../ocr/ocr.module';
import { RdAiController } from './rd-ai.controller';
import { RdAiService } from './rd-ai.service';
import { RdDailyReportCron } from './rd-daily-report.cron';
import { ResearchDevelopmentController } from './research-development.controller';
import { ResearchDevelopmentService } from './research-development.service';

@Module({
  imports: [OcrModule],
  controllers: [ResearchDevelopmentController, RdAiController],
  providers: [ResearchDevelopmentService, RdAiService, RdDailyReportCron],
})
export class ResearchDevelopmentModule {}
