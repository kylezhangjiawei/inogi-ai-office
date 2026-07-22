import { Controller, Get, Header } from '@nestjs/common';

import { Public } from '../auth/decorators/public.decorator';
import { ContentSlotsService } from './content-slots.service';

/** 免鉴权的公开素材（登录页在鉴权前需要拿背景图） */
@Controller('content-slots/public')
export class ContentSlotsPublicController {
  constructor(private readonly service: ContentSlotsService) {}

  @Public()
  @Get('login-background')
  @Header('Cache-Control', 'public, max-age=300')
  loginBackground() {
    return this.service.getLoginBackground();
  }
}
