import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { Prisma } from '@prisma/client';
import { validate } from 'class-validator';

import { PermissionCatalogController } from '../src/modules/permission-catalog/permission-catalog.controller';
import { PermissionCatalogService } from '../src/modules/permission-catalog/permission-catalog.service';

const initial = [
  { id: 'home', code: 'page:dashboard', label: '首页', type: 'page', sortOrder: 10, enabled: true, navHidden: false },
  { id: 'hidden', code: 'page:detail', label: '详情', type: 'page', sortOrder: 20, enabled: false, navHidden: true },
  { id: 'other', code: 'page:other', label: '另一个页面', type: 'page', sortOrder: 20, enabled: true, navHidden: false },
  { id: 'action', code: 'record:edit', label: '编辑', type: 'action', sortOrder: 21, enabled: true, navHidden: false },
].map((row, index) => ({
  ...row, description: `${row.id} description`, groupLabel: `分组 ${index % 2}`,
  routePath: `/${row.id}`, createdAt: new Date(`2026-01-0${index + 1}`), updatedAt: new Date('2026-08-01'),
}));

function fixture(options: { failId?: string; transactionError?: Error } = {}) {
  let rows = structuredClone(initial);
  const model = (read: () => typeof rows) => ({
    findMany: async ({ where, select, orderBy }: any = {}) => {
      let result = read().filter((row) => !where?.type || row.type === where.type);
      if (orderBy) result = result.slice().sort((a, b) => {
        for (const order of orderBy) {
          const [key, direction] = Object.entries(order)[0] as [keyof typeof a, string];
          const comparison = a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0;
          if (comparison) return direction === 'desc' ? -comparison : comparison;
        }
        return 0;
      });
      return result.map((row) => select
        ? Object.fromEntries(Object.keys(select).filter((key) => select[key]).map((key) => [key, (row as any)[key]]))
        : { ...row });
    },
    update: async ({ where, data }: any) => {
      if (where.id === options.failId) throw new Error('write failed');
      const row = read().find((entry) => entry.id === where.id)!;
      Object.assign(row, data);
      return { ...row };
    },
  });
  const prisma = {
    permissionCatalogItem: model(() => rows),
    department: { findMany: async () => [] },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
      if (options.transactionError) throw options.transactionError;
      const draft = structuredClone(rows);
      const result = await callback({ permissionCatalogItem: model(() => draft) });
      rows = draft;
      return result;
    },
  };
  const service = new PermissionCatalogService(prisma as never);
  service.ensureDefaults = async () => {};
  const reorder = (ids: string[]) => {
    assert.equal(typeof (service as any).reorder, 'function', '目录服务需支持原子排序');
    return (service as any).reorder({ ids });
  };
  return { service, reorder, rows: () => rows };
}

test('页面排序一次保存完整顺序，保留隐藏停用页面以及所有非排序字段', async () => {
  const f = fixture();
  const result = await f.reorder(['other', 'hidden', 'home']);
  assert.deepEqual(result.filter((row: any) => row.type === 'page').map((row: any) => [row.id, row.sortOrder]), [
    ['other', 10], ['hidden', 20], ['home', 30],
  ]);
  for (const row of f.rows()) {
    const before = initial.find((entry) => entry.id === row.id)!;
    assert.deepEqual({ ...row, sortOrder: before.sortOrder }, before);
  }
  assert.equal(f.rows().find((row) => row.id === 'action')?.sortOrder, 21);
  assert.equal(result.find((row: any) => row.id === 'home').builtIn, true);
});

test('拒绝重复、缺项、过期和操作权限 ID，失败不改变目录顺序', async () => {
  for (const [ids, status] of [
    [['home', 'home', 'other'], 400],
    [['home', 'other'], 409],
    [['home', 'hidden', 'deleted'], 409],
    [['home', 'hidden', 'action'], 409],
  ] as const) {
    const f = fixture();
    await assert.rejects(f.reorder([...ids]), (error: any) => error.getStatus?.() === status);
    assert.deepEqual(f.rows(), initial);
  }
});

test('排序写入途中失败时完整回滚，不能只移动一半页面', async () => {
  const f = fixture({ failId: 'hidden' });
  await assert.rejects(f.reorder(['other', 'home', 'hidden']), /write failed/);
  assert.deepEqual(f.rows(), initial);
});

test('并发排序冲突返回可刷新重试的 409', async () => {
  const f = fixture({ transactionError: new Prisma.PrismaClientKnownRequestError('conflict', { code: 'P2034', clientVersion: 'test' }) });
  await assert.rejects(f.reorder(['other', 'hidden', 'home']), (error: any) => error.getStatus?.() === 409);
  assert.deepEqual(f.rows(), initial);
});

test('导航元数据包含页面顺序，相同序号不会因编辑更新时间而换位', async () => {
  const f = fixture();
  f.rows().find((row) => row.id === 'other')!.updatedAt = new Date('2026-09-20');
  const meta = await f.service.getNavMeta();
  assert.deepEqual(meta.map((row: any) => [row.code, row.sortOrder]), [
    ['page:dashboard', 10], ['page:detail', 20], ['page:other', 20],
  ]);
  assert.deepEqual(meta.map((row) => row.groupLabel), ['分组 0', '分组 1', '分组 0']);
  assert.deepEqual((await f.service.listItems()).filter((row) => row.type === 'page').map((row) => row.id), ['home', 'hidden', 'other']);
});

test('排序入口保留页面路由管理权限并校验完整 ID 数组', async () => {
  const method = (PermissionCatalogController.prototype as any).reorder;
  assert.equal(typeof method, 'function', '需要排序 HTTP 入口');
  assert.deepEqual(Reflect.getMetadata('permissions', method), ['page:route-management']);
  const [Dto] = Reflect.getMetadata('design:paramtypes', PermissionCatalogController.prototype, 'reorder');
  assert.equal((await validate(Object.assign(new Dto(), { ids: ['home', 'other'] }))).length, 0);
  for (const ids of [undefined, [], 'home', ['home', 'home'], [''], [7], ['x'.repeat(121)]]) {
    assert.ok((await validate(Object.assign(new Dto(), { ids }))).length, `应该拒绝 ${JSON.stringify(ids)}`);
  }
});
