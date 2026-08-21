import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { PrismaModule } from '../../prisma/prisma.module';
import { SecurityModule } from '../security/security.module';
import { AiUsageModule } from '../ai-usage/ai-usage.module';
import { AiGatewayModule } from '../ai-gateway/ai-gateway.module';
import { RagModule } from '../rag/rag.module';
import { ImageGenerationController } from './image-generation.controller';
import { ImageGenerationService } from './image-generation.service';

@Module({
  imports: [PrismaModule, ConfigModule, SecurityModule, AiUsageModule, AiGatewayModule, RagModule],
  controllers: [ImageGenerationController],
  providers: [ImageGenerationService],
  exports: [ImageGenerationService],
})
export class ImageGenerationModule {}
