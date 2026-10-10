import { Module } from '@nestjs/common';

import { AiGatewayModule } from '../ai-gateway/ai-gateway.module';
import { OcrModule } from '../ocr/ocr.module';
import { RagModule } from '../rag/rag.module';
import { DeptKbGuard } from './dept-kb.guard';
import { DeptKnowledgeController } from './dept-knowledge.controller';
import { KbMultipartService } from './kb-multipart.service';
import { RdAiController } from './rd-ai.controller';
import { RdAiService } from './rd-ai.service';
import { RdDailyReportCron } from './rd-daily-report.cron';
import { RdMonthlyReportCron } from './rd-monthly-report.cron';
import { ResearchDevelopmentController } from './research-development.controller';
import { ResearchDevelopmentService } from './research-development.service';
import { RdTechnicalDocumentsService } from './rd-technical-documents.service';
import { RdTechnicalDocumentsController, RdTechnicalDocumentFilesController } from './rd-technical-documents.controller';
import { RdMeetingTodosController } from './rd-meeting-todos.controller';
import { RdMeetingTodosService } from './rd-meeting-todos.service';

@Module({
  imports: [AiGatewayModule, OcrModule, RagModule],
  controllers: [ResearchDevelopmentController, DeptKnowledgeController, RdAiController, RdTechnicalDocumentsController, RdTechnicalDocumentFilesController, RdMeetingTodosController],
  providers: [
    ResearchDevelopmentService,
    RdMeetingTodosService,
    RdTechnicalDocumentsService,
    RdAiService,
    RdDailyReportCron,
    RdMonthlyReportCron,
    DeptKbGuard,
    KbMultipartService,
  ],
  // MateChat 写操作工具复用：立项（createTask）与站内通知（createMessage）
  exports: [ResearchDevelopmentService, RdTechnicalDocumentsService],
})
export class ResearchDevelopmentModule {}
