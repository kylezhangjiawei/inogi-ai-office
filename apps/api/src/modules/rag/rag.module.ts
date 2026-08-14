import { Module } from '@nestjs/common';

import { RagController } from './rag.controller';
import { RagService } from './rag.service';
import { EmbeddingClient } from './embedding-client';
import { AiGatewayModule } from '../ai-gateway/ai-gateway.module';

@Module({
  imports: [AiGatewayModule],
  controllers: [RagController],
  providers: [RagService, EmbeddingClient],
  exports: [RagService, EmbeddingClient],
})
export class RagModule {}
