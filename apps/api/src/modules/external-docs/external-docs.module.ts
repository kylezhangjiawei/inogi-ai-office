import { Module } from '@nestjs/common';

import { OcrModule } from '../ocr/ocr.module';
import { ExternalDocumentAiService } from './external-document-ai.service';
import { ExternalDocumentExtractionService } from './external-document-extraction.service';
import { ExternalDocsController } from './external-docs.controller';
import { ExternalDocsService } from './external-docs.service';

@Module({
  imports: [OcrModule],
  controllers: [ExternalDocsController],
  providers: [ExternalDocsService, ExternalDocumentExtractionService, ExternalDocumentAiService],
})
export class ExternalDocsModule {}
