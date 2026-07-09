import { Body, Controller, Get, Param, Post, Put, Query, Request } from '@nestjs/common';

import { Permissions } from '../auth/decorators/permissions.decorator';
import { I18nService } from './i18n.service';

type AuthedRequest = { user?: { id?: string } };

@Controller('i18n')
export class I18nController {
  constructor(private readonly i18nService: I18nService) {}

  /** 读字典：任何登录用户（前端启动时拉一次并缓存） */
  @Get('dict/:lang')
  getDict(@Param('lang') lang: string) {
    return this.i18nService.getDict(lang);
  }

  /** 写字典：翻译管理权限（AI 初翻入库 / 翻译管理页行内编辑 / JSON 导入） */
  @Put('dict/:lang')
  @Permissions('i18n:manage')
  saveDict(
    @Param('lang') lang: string,
    @Body() entries: Record<string, string | null>,
    @Query('mode') mode?: string,
  ) {
    return this.i18nService.saveDict(lang, entries, mode === 'replace' ? 'replace' : 'merge');
  }

  /** 翻译管理页总览：key 全集 + 英文 + 状态（ai/human/missing）+ 模块 */
  @Get('overview/:lang')
  @Permissions('i18n:manage')
  overview(@Param('lang') lang: string, @Query('missing') missing?: string) {
    return this.i18nService.overview(lang, missing === '1');
  }

  /** 登记源码扫描出的文案 key 全集（extract 脚本上报，replace 语义） */
  @Put('keys')
  @Permissions('i18n:manage')
  saveKeys(@Body() keys: Record<string, string>) {
    return this.i18nService.saveKeys(keys);
  }

  /** AI 双轮翻译（初翻+UX Writer 校对）。keys 缺省 = 全部缺英文的登记 key */
  @Post('translate/:lang')
  @Permissions('i18n:manage')
  aiTranslate(@Param('lang') lang: string, @Body() body: { keys?: string[] } = {}) {
    return this.i18nService.aiTranslate(lang, body?.keys);
  }

  /** 当前用户语言偏好 */
  @Get('preference')
  async getPreference(@Request() req: AuthedRequest) {
    const lang = req.user?.id ? await this.i18nService.getUserLang(req.user.id) : 'zh';
    return { lang };
  }

  @Put('preference')
  setPreference(@Request() req: AuthedRequest, @Body() body: { lang?: string }) {
    return this.i18nService.setUserLang(String(req.user?.id ?? ''), String(body?.lang ?? 'zh'));
  }
}
