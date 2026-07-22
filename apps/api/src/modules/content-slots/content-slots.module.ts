import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { ChatModule } from '../chat/chat.module';
import { ContentSlotsController } from './content-slots.controller';
import { ContentSlotsPublicController } from './content-slots-public.controller';
import { ContentSlotsService } from './content-slots.service';

@Module({
  imports: [PrismaModule, ChatModule],
  controllers: [ContentSlotsController, ContentSlotsPublicController],
  providers: [ContentSlotsService],
})
export class ContentSlotsModule {}
