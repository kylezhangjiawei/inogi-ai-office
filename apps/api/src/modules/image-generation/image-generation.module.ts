import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { PrismaModule } from '../../prisma/prisma.module';
import { SecurityModule } from '../security/security.module';
import { ImageGenerationController } from './image-generation.controller';
import { ImageGenerationService } from './image-generation.service';

@Module({
  imports: [PrismaModule, ConfigModule, SecurityModule],
  controllers: [ImageGenerationController],
  providers: [ImageGenerationService],
})
export class ImageGenerationModule {}
