import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { ChatModule } from '../chat/chat.module';
import { I18nController } from './i18n.controller';
import { I18nService } from './i18n.service';

@Module({
  // ChatModule：AI 初翻/校对复用系统内对话模型通道（不接第三方翻译 API，无需新密钥）
  imports: [PrismaModule, ChatModule],
  controllers: [I18nController],
  providers: [I18nService],
  exports: [I18nService],
})
export class I18nModule {}
