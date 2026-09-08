import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { PrismaModule } from '../../prisma/prisma.module';
import { SecurityModule } from '../security/security.module';
import { RagModule } from '../rag/rag.module';
import { OcrModule } from '../ocr/ocr.module';
import { ImageGenerationModule } from '../image-generation/image-generation.module';
import { VideoGenerationModule } from '../video-generation/video-generation.module';
import { ResearchDevelopmentModule } from '../research-development/research-development.module';
import { AiUsageModule } from '../ai-usage/ai-usage.module';
import { AiGatewayModule } from '../ai-gateway/ai-gateway.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatAttachmentService } from './chat-attachment.service';
import { ChatAnalyticsService } from './chat-analytics.service';
import { ChatStreakService } from './chat-streak.service';
import { ChatFileExportService } from './chat-file-export.service';
import { ChatToolsService } from './chat-tools.service';
import { WebSearchService } from './web-search.service';
import { PermissionCatalogModule } from '../permission-catalog/permission-catalog.module';
import { ChatFileCatalogService } from './chat-file-catalog.service';
import { ChatArchiveService } from './chat-archive.service';
import { ChatArchiveController } from './chat-archive.controller';
import { ChatPageContextService } from './chat-page-context.service';
import { ChatDeliveryService } from './chat-delivery.service';
import { ChatDeliveryController } from './chat-delivery.controller';

@Module({
  imports: [PermissionCatalogModule, AiGatewayModule, PrismaModule, ConfigModule, SecurityModule, RagModule, OcrModule, ImageGenerationModule, VideoGenerationModule, ResearchDevelopmentModule, AiUsageModule],
  controllers: [ChatController, ChatArchiveController, ChatDeliveryController],
  providers: [ChatPageContextService, ChatDeliveryService, ChatFileCatalogService, ChatArchiveService, ChatService, ChatAnalyticsService, ChatStreakService, ChatAttachmentService, ChatFileExportService, ChatToolsService, WebSearchService],
  // issue-ai 复用：模型列表（与 MateChat 一致）+ 附件解析（文档抽取/图片多模态）
  exports: [ChatService, ChatAttachmentService, WebSearchService, ChatStreakService],
})
export class ChatModule {}
