import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { ResearchDevelopmentService } from './research-development.service';

@Injectable()
export class RdDailyReportCron {
  private readonly logger = new Logger(RdDailyReportCron.name);

  constructor(private readonly rdService: ResearchDevelopmentService) {}

  /**
   * Runs every day at 18:30 (server local time) and generates a daily report
   * for every active user with R&D activity that day.
   */
  @Cron('30 18 * * *', { name: 'rd-daily-report-generate' })
  async runDaily() {
    const startedAt = Date.now();
    try {
      const result = await this.rdService.generateDailyReportsForAll();
      this.logger.log(
        `[runDaily] generated ${result.count} report(s) for ${result.date} in ${Date.now() - startedAt}ms`,
      );
    } catch (err) {
      this.logger.error(`[runDaily] failed: ${(err as Error).message}`);
    }
  }
}
