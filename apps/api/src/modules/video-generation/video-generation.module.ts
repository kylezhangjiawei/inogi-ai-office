import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { PrismaModule } from '../../prisma/prisma.module';
import { SecurityModule } from '../security/security.module';
import { ResearchDevelopmentModule } from '../research-development/research-development.module';
import { AiUsageModule } from '../ai-usage/ai-usage.module';
import { VideoGenerationController } from './video-generation.controller';
import { VideoGenerationService } from './video-generation.service';

@Module({
  imports: [PrismaModule, ConfigModule, SecurityModule, ResearchDevelopmentModule, AiUsageModule],
  controllers: [VideoGenerationController],
  providers: [VideoGenerationService],
  exports: [VideoGenerationService],
})
export class VideoGenerationModule {}
