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

  /** 逐次调用明细：支持按日期、模态、模型、人员筛选并分页。 */
  @Get('details')
  getDetails(
    @Query('range') range?: string,
    @Query('modality') modality?: string,
    @Query('model') model?: string,
    @Query('user_id') userId?: string,
    @Query('date') date?: string,
    @Query('page') page?: string,
    @Query('page_size') pageSize?: string,
  ) {
    return this.service.getDetails({ range, modality, model, userId, date, page, pageSize });
  }

  /** 从既有业务表回填历史用量（一次性，幂等） */
  @Post('backfill')
  backfill() {
    return this.service.backfill();
  }
}
