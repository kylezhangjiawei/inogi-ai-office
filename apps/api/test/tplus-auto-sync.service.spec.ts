import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants';

import { TplusSyncService } from '../src/modules/procurement/tplus-sync.service';

test('T+ 自动同步固定在北京时间每天 3:00 执行', () => {
  const options = Reflect.getMetadata(
    SCHEDULE_CRON_OPTIONS,
    TplusSyncService.prototype.autoSyncCron,
  ) as { cronTime?: string; timeZone?: string };

  assert.equal(options.cronTime, '0 3 * * *');
  assert.equal(options.timeZone, 'Asia/Shanghai');
});

test('T+ 自动同步按供应商、库存、采购单和匹配顺序执行并保存摘要', async () => {
  const calls: string[] = [];
  let savedMetadata: Record<string, unknown> | undefined;
  const prisma = {
    integrationConfig: {
      findFirst: async () => ({ id: 'config-1', metadata: { autoSync: true } }),
      update: async (args: { data: { metadata: Record<string, unknown> } }) => {
        savedMetadata = args.data.metadata;
        return args;
      },
    },
  };
  const poMatch = {
    runMatch: async () => {
      calls.push('匹配');
      return { suggested: 2, aiSuggested: 0, unmatched: 1 };
    },
  };
  const service = new TplusSyncService(
    prisma as never,
    {} as never,
    {} as never,
    poMatch as never,
  );
  const mutableService = service as unknown as {
    getConfig: () => Promise<{ configured: boolean; authorized: boolean; autoSync: boolean }>;
    syncSuppliers: () => Promise<Record<string, unknown>>;
    syncInventory: () => Promise<Record<string, unknown>>;
    syncPurchaseOrderMirror: () => Promise<Record<string, unknown>>;
  };
  mutableService.getConfig = async () => ({ configured: true, authorized: true, autoSync: true });
  mutableService.syncSuppliers = async () => {
    calls.push('供应商');
    return { upserted: 3 };
  };
  mutableService.syncInventory = async () => {
    calls.push('库存');
    return { upserted: 4 };
  };
  mutableService.syncPurchaseOrderMirror = async () => {
    calls.push('采购单');
    return { orders: 5, failed: 0 };
  };

  const result = await service.autoSync();

  assert.deepEqual(calls, ['供应商', '库存', '采购单', '匹配']);
  assert.equal(result.skipped, false);
  assert.match(result.summary ?? '', /供应商 ✓ upserted=3/);
  assert.match(result.summary ?? '', /库存 ✓ upserted=4/);
  assert.match(result.summary ?? '', /采购单全量 ✓ orders=5,failed=0/);
  assert.match(result.summary ?? '', /匹配 ✓ suggested=2,aiSuggested=0,unmatched=1/);
  assert.equal(typeof savedMetadata?.lastAutoSyncAt, 'string');
  assert.equal(savedMetadata?.lastAutoSyncSummary, result.summary);
});

test('T+ 自动同步关闭时不执行任何同步步骤', async () => {
  const service = new TplusSyncService(
    {} as never,
    {} as never,
    {} as never,
    {
      runMatch: async () => {
        throw new Error('自动同步关闭时不应执行匹配');
      },
    } as never,
  );
  const mutableService = service as unknown as {
    getConfig: () => Promise<{ configured: boolean; authorized: boolean; autoSync: boolean }>;
    syncSuppliers: () => Promise<Record<string, unknown>>;
  };
  mutableService.getConfig = async () => ({ configured: true, authorized: true, autoSync: false });
  mutableService.syncSuppliers = async () => {
    throw new Error('自动同步关闭时不应同步供应商');
  };

  const result = await service.autoSync();

  assert.deepEqual(result, { skipped: true, reason: '自动同步已关闭' });
});
