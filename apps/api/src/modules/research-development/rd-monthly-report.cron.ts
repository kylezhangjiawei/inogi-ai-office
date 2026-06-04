import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { ResearchDevelopmentService } from './research-development.service';

/** 上一个自然月 'YYYY-MM'（服务器本地时区）。 */
function previousMonthString(now = new Date()): string {
  let year = now.getFullYear();
  let month = now.getMonth() + 1; // 1-12 当前月
  month -= 1;
  if (month === 0) {
    month = 12;
    year -= 1;
  }
  return `${year}-${String(month).padStart(2, '0')}`;
}

@Injectable()
export class RdMonthlyReportCron {
  private readonly logger = new Logger(RdMonthlyReportCron.name);

  constructor(private readonly rdService: ResearchDevelopmentService) {}

  /**
   * 每月 1 号 09:00（服务器本地时区）汇总「上一个自然月」的月报，为每位成员各生成一份。
   * 选 1 号而非月末，是为了覆盖到上月最后一天产生的全部进度记录。
   */
  @Cron('0 9 1 * *', { name: 'rd-monthly-report-generate' })
  async runMonthly() {
    const startedAt = Date.now();
    const targetMonth = previousMonthString();
    try {
      const result = await this.rdService.generateMonthlyReportsForAll(targetMonth);
      this.logger.log(
        `[runMonthly] generated ${result.count} report(s) for ${result.month} in ${Date.now() - startedAt}ms`,
      );
    } catch (err) {
      this.logger.error(`[runMonthly] failed: ${(err as Error).message}`);
    }
  }
}
