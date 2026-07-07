import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { ResearchDevelopmentService } from './research-development.service';
import { RD_WORKSPACE_IDS, runInRdWorkspace } from './rd-workspace.context';

@Injectable()
export class RdDailyReportCron {
  private readonly logger = new Logger(RdDailyReportCron.name);

  constructor(private readonly rdService: ResearchDevelopmentService) {}

  /**
   * Runs every day at 18:30 (server local time) and generates a daily report
   * for every active user with R&D activity that day.
   * 逐工作区执行（研发池 + 中美协同池），各池按自己的人员/任务/留痕独立生成。
   */
  @Cron('30 18 * * *', { name: 'rd-daily-report-generate' })
  async runDaily() {
    for (const workspace of RD_WORKSPACE_IDS) {
      const startedAt = Date.now();
      try {
        const result = await runInRdWorkspace(workspace, () => this.rdService.generateDailyReportsForAll());
        this.logger.log(
          `[runDaily] workspace=${workspace} generated ${result.count} report(s) for ${result.date} in ${Date.now() - startedAt}ms`,
        );
      } catch (err) {
        this.logger.error(`[runDaily] workspace=${workspace} failed: ${(err as Error).message}`);
      }
    }
  }
}
