import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { ResearchDevelopmentService } from './research-development.service';
import { RD_WORKSPACE_IDS, runInRdWorkspace } from './rd-workspace.context';

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
   *
   * 逐工作区执行（与日报 cron 同构）：cron 无 HTTP 上下文 → ALS 为空 → resolveRdStoreKey
   * 会落默认研发池。不显式 runInRdWorkspace 的话，协同月报永远不会自动生成
   * （表现为协同成员日报有、月报页长期空白，只能手动点「重新生成」）。
   */
  @Cron('0 9 1 * *', { name: 'rd-monthly-report-generate' })
  async runMonthly() {
    const targetMonth = previousMonthString();
    for (const workspace of RD_WORKSPACE_IDS) {
      const startedAt = Date.now();
      try {
        const result = await runInRdWorkspace(workspace, () =>
          this.rdService.generateMonthlyReportsForAll(targetMonth),
        );
        this.logger.log(
          `[runMonthly] workspace=${workspace} generated ${result.count} report(s) for ${result.month} in ${Date.now() - startedAt}ms`,
        );
      } catch (err) {
        this.logger.error(`[runMonthly] workspace=${workspace} failed: ${(err as Error).message}`);
      }
    }
  }
}
