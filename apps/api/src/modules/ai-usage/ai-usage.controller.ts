import { Controller, Get, Post, Query } from '@nestjs/common';

import { Permissions } from '../auth/decorators/permissions.decorator';
import { AiUsageService } from './ai-usage.service';

@Controller('ai-usage')
@Permissions('page:ai-usage-dashboard')
export class AiUsageController {
  constructor(private readonly service: AiUsageService) {}

  /** 用量总览：按模型 / 按人员排行 + 汇总 + 近 30 天趋势。range=today|month|year */
  @Get('dashboard')
  getDashboard(@Query('range') range?: string) {
    return this.service.getDashboard(range);
  }

  /** 从既有业务表回填历史用量（一次性，幂等） */
  @Post('backfill')
  backfill() {
    return this.service.backfill();
  }
}
