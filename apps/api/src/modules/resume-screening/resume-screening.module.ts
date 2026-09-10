import { Module } from '@nestjs/common';

import { AiGatewayModule } from '../ai-gateway/ai-gateway.module';
import { PermissionCatalogModule } from '../permission-catalog/permission-catalog.module';
import { MailIngestionService } from './mail-ingestion.service';
import { OpenAiScreeningService } from './openai-screening.service';
import { ResumeDocumentService } from './resume-document.service';
import { ResumeParserService } from './resume-parser.service';
import { ResumeScreeningController } from './resume-screening.controller';
import { ResumeScreeningService } from './resume-screening.service';
import { SecureConfigService } from '../security/secure-config.service';

@Module({
  imports: [AiGatewayModule, PermissionCatalogModule],
  controllers: [ResumeScreeningController],
  providers: [ResumeScreeningService, MailIngestionService, ResumeDocumentService, ResumeParserService, OpenAiScreeningService, SecureConfigService],
  exports: [OpenAiScreeningService],
})
export class ResumeScreeningModule {}
