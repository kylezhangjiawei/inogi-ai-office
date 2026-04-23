import { Module } from '@nestjs/common';

import { MailIngestionService } from './mail-ingestion.service';
import { OpenAiScreeningService } from './openai-screening.service';
import { ResumeDocumentService } from './resume-document.service';
import { ResumeParserService } from './resume-parser.service';
import { ResumeScreeningController } from './resume-screening.controller';
import { ResumeScreeningService } from './resume-screening.service';
import { SecureConfigService } from '../security/secure-config.service';

@Module({
  controllers: [ResumeScreeningController],
  providers: [ResumeScreeningService, MailIngestionService, ResumeDocumentService, ResumeParserService, OpenAiScreeningService, SecureConfigService],
  exports: [OpenAiScreeningService],
})
export class ResumeScreeningModule {}
