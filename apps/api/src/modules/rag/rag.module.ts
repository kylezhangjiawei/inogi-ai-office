import { Module } from '@nestjs/common';

import { RagController } from './rag.controller';
import { RagService } from './rag.service';
import { EmbeddingClient } from './embedding-client';

@Module({
  controllers: [RagController],
  providers: [RagService, EmbeddingClient],
  exports: [RagService, EmbeddingClient],
})
export class RagModule {}
