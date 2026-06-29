import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { PrismaModule } from '../../prisma/prisma.module';
import { SecurityModule } from '../security/security.module';
import { RagModule } from '../rag/rag.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatAttachmentService } from './chat-attachment.service';

@Module({
  imports: [PrismaModule, ConfigModule, SecurityModule, RagModule],
  controllers: [ChatController],
  providers: [ChatService, ChatAttachmentService],
  // issue-ai 复用：模型列表（与 MateChat 一致）+ 附件解析（文档抽取/图片多模态）
  exports: [ChatService, ChatAttachmentService],
})
export class ChatModule {}
