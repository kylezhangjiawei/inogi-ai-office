import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';

import { PrismaService } from '../../prisma/prisma.service';

/** 默认保留 24 个月。合规审计一般按「两年」要求，短于此的清理需要显式配置。 */
const DEFAULT_RETENTION_DAYS = 730;
/** 允许配置的下限：再短就不叫审计了，防止误配把留痕清空。 */
const MIN_RETENTION_DAYS = 90;
/** 单次最多删多少行。留痕表可能积到百万级，一次性 DELETE 会长时间持锁。 */
const DELETE_BATCH_SIZE = 5000;

/**
 * 操作留痕的保留期清理。
 *
 * 合并前研发留痕存在 SystemSetting 的单个 JSON 数组里，靠「只保留最新 1000 条」
 * 滚动淘汰——写满即静默丢弃早期记录，这对审计是不可接受的。迁到表之后没有了上限，
 * 于是需要一条明确的保留策略：按时间删，而不是按条数丢。
 *
 * 保留天数由 AUDIT_LOG_RETENTION_DAYS 配置；设为 0 表示永不清理。
 */
@Injectable()
export class AuditRetentionCron {
  private readonly logger = new Logger(AuditRetentionCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** 每天 03:20 跑一次，避开白天的业务高峰。 */
  @Cron('20 3 * * *', { name: 'audit-log-retention' })
  async run(): Promise<void> {
    const retentionDays = this.resolveRetentionDays();
    if (retentionDays === 0) {
      this.logger.log('[audit-retention] AUDIT_LOG_RETENTION_DAYS=0，跳过清理');
      return;
    }

    const cutoff = new Date(Date.now() - retentionDays * 24 * 3600 * 1000);
    const startedAt = Date.now();
    let removed = 0;
    try {
      // 分批删：每批取一段 id 再删，避免一条 DELETE 长时间持锁把写入堵住
      for (;;) {
        const batch = await this.prisma.auditLog.findMany({
          where: { createdAt: { lt: cutoff } },
          select: { id: true },
          take: DELETE_BATCH_SIZE,
        });
        if (batch.length === 0) break;
        const result = await this.prisma.auditLog.deleteMany({
          where: { id: { in: batch.map((row) => row.id) } },
        });
        removed += result.count;
        if (batch.length < DELETE_BATCH_SIZE) break;
      }
      if (removed > 0) {
        this.logger.log(
          `[audit-retention] 清理 ${removed} 条 ${cutoff.toISOString()} 之前的留痕，耗时 ${Date.now() - startedAt}ms`,
        );
      }
    } catch (err) {
      this.logger.error(`[audit-retention] 清理失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** 配置值非法（非数字/为负/短于下限）时回落到默认值并告警，绝不按错误值删数据。 */
  private resolveRetentionDays(): number {
    const raw = this.config.get<string>('AUDIT_LOG_RETENTION_DAYS');
    if (raw === undefined || raw === null || String(raw).trim() === '') return DEFAULT_RETENTION_DAYS;
    const parsed = Number(String(raw).trim());
    if (!Number.isFinite(parsed) || parsed < 0) {
      this.logger.warn(`[audit-retention] AUDIT_LOG_RETENTION_DAYS=${raw} 非法，按默认 ${DEFAULT_RETENTION_DAYS} 天处理`);
      return DEFAULT_RETENTION_DAYS;
    }
    if (parsed === 0) return 0;
    if (parsed < MIN_RETENTION_DAYS) {
      this.logger.warn(
        `[audit-retention] AUDIT_LOG_RETENTION_DAYS=${parsed} 低于下限 ${MIN_RETENTION_DAYS} 天，按下限处理`,
      );
      return MIN_RETENTION_DAYS;
    }
    return Math.floor(parsed);
  }
}
