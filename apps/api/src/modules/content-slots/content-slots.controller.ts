import { Body, Controller, Get, Param, Post } from '@nestjs/common';

import { Permissions } from '../auth/decorators/permissions.decorator';
import { ContentSlotsService } from './content-slots.service';

@Controller('content-slots')
@Permissions('page:content-slots')
export class ContentSlotsController {
  constructor(private readonly service: ContentSlotsService) {}

  /** 列出所有运营素材位（含配置与当前预览） */
  @Get()
  list() {
    return this.service.list();
  }

  /** 保存某素材位配置（模式 + prompt + 固定文案 + 固定图 objectKey） */
  @Post(':key/config')
  updateConfig(
    @Param('key') key: string,
    @Body()
    body: {
      mode?: string;
      promptTemplate?: string;
      staticText?: string;
      staticImageObjectKey?: string;
      staticImagePool?: string[];
      staticList?: string[];
    },
  ) {
    return this.service.updateConfig(key, body ?? {});
  }

  /** 立即重新生成 / 预览 */
  @Post(':key/regenerate')
  regenerate(@Param('key') key: string) {
    return this.service.regenerate(key);
  }

  /** 某图片素材位的历史记录（带签名 URL） */
  @Get(':key/history')
  history(@Param('key') key: string) {
    return this.service.history(key);
  }

  /** AI 生成成本闸门：月度上限 + 本月已用 */
  @Get('gen-budget')
  getGenBudget() {
    return this.service.getGenBudget();
  }

  @Post('gen-budget')
  saveGenBudget(@Body() body: { monthlyCap?: number }) {
    return this.service.saveGenBudget(typeof body?.monthlyCap === 'number' ? body.monthlyCap : 0);
  }
}
