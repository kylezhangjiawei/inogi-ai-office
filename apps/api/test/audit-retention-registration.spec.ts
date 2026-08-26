import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants';

import { AuditRetentionCron } from '../src/modules/audit/audit-retention.cron';

/**
 * 保留期清理是唯一会主动删审计数据的定时任务。删除逻辑本身有单测，
 * 但「它到底有没有被注册成定时任务」是另一回事——@Cron 装饰器写错名字或表达式，
 * 任务会安静地永不执行，而所有单测照样绿。这里断言注册元数据本身。
 */
test('保留期清理已注册为每日 03:20 的定时任务', () => {
  const meta = Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, AuditRetentionCron.prototype.run) as
    | { name?: string; cronTime?: string }
    | undefined;

  assert.ok(meta, '@Cron 元数据缺失：任务不会被 ScheduleModule 注册，等于永不执行');
  assert.equal(meta.name, 'audit-log-retention');
  assert.equal(meta.cronTime, '20 3 * * *');
});
