import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import 'reflect-metadata';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { PERMISSIONS_KEY } from '../src/modules/auth/decorators/permissions.decorator';
import { RolesGuard } from '../src/modules/auth/guards/roles.guard';
import { ProcurementController } from '../src/modules/procurement/procurement.controller';
import { ProcAuditLogQueryDto } from '../src/modules/procurement/dto/procurement.dto';
import { ProcurementService } from '../src/modules/procurement/procurement.service';

function createService(prisma: Record<string, unknown>) {
  return new ProcurementService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

test('采购操作留痕固定隔离采购范围并支持服务端筛选分页', async () => {
  let countArgs: Record<string, unknown> | undefined;
  let listArgs: Record<string, unknown> | undefined;
  const auditLog = {
    count: async (args: Record<string, unknown>) => {
      countArgs = args;
      return 21;
    },
    findMany: async (args: Record<string, unknown>) => {
      listArgs = args;
      return [
        {
          id: 'audit-1',
          action: 'PATCH',
          resource: 'procurement',
          resourceId: 'materials',
          createdAt: new Date('2026-08-11T08:30:00.000Z'),
          ip: '192.0.2.10',
          meta: {
            materialId: 'mat-1',
            status: 'approved',
            quantity: 12,
            taskIds: ['task-1', 'task-2'],
            note: '不应返回备注正文',
            password: 'not-visible',
            token: 'not-visible',
          },
          user: {
            id: 'buyer-1',
            name: '采购甲',
            englishName: 'Buyer A',
            username: 'buyer-a',
          },
        },
      ];
    },
  };
  const prisma = {
    auditLog,
    $transaction: async (callback: (tx: { auditLog: typeof auditLog }) => Promise<unknown>) => callback({ auditLog }),
  };
  const service = createService(prisma);

  const result = await service.listAuditLogs({
    page: '2',
    pageSize: '20',
    keyword: '采购甲',
    action: 'patch',
    section: 'materials',
    dateFrom: '2026-08-01T00:00:00.000Z',
    dateTo: '2026-09-01T00:00:00.000Z',
    snapshotAt: '2026-08-11T09:00:00.000Z',
  });

  const countWhere = countArgs?.where as Record<string, unknown>;
  assert.equal(countWhere.resource, 'procurement');
  assert.equal(countWhere.action, 'PATCH');
  assert.equal(countWhere.resourceId, 'materials');
  const createdAt = countWhere.createdAt as { gte?: Date; lt?: Date };
  assert.equal(createdAt.gte?.toISOString(), '2026-08-01T00:00:00.000Z');
  assert.equal(createdAt.lt?.toISOString(), '2026-09-01T00:00:00.000Z');
  assert.equal((createdAt as { lte?: Date }).lte?.toISOString(), '2026-08-11T09:00:00.000Z');
  assert.ok(countWhere.OR);
  assert.equal(listArgs?.skip, 20);
  assert.equal(listArgs?.take, 20);
  assert.equal(result.total, 21);
  assert.equal(result.snapshotAt, '2026-08-11T09:00:00.000Z');
  assert.equal(result.items[0].operator.name, '采购甲');
  assert.deepEqual(result.items[0].details, [
    { field: 'materialId', value: 'mat-1' },
    { field: 'status', value: 'approved' },
    { field: 'quantity', value: '12' },
    { field: 'taskIds', value: '2 项' },
  ]);
  assert.equal(result.items[0].details.some((detail) => ['note', 'password', 'token'].includes(detail.field)), false);
  const serialized = JSON.stringify(result);
  for (const sensitiveValue of ['192.0.2.10', '不应返回备注正文', 'not-visible']) {
    assert.equal(serialized.includes(sensitiveValue), false);
  }
  assert.equal(serialized.includes('"meta"'), false);
});

test('采购操作留痕分页边界始终转换为有限整数', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const auditLog = {
    count: async () => 200_000,
    findMany: async (args: Record<string, unknown>) => {
      calls.push(args);
      return [];
    },
  };
  const prisma = {
    auditLog,
    $transaction: async (callback: (tx: { auditLog: typeof auditLog }) => Promise<unknown>) => callback({ auditLog }),
  };
  const service = createService(prisma);

  const unbounded = await service.listAuditLogs({ page: 'Infinity', pageSize: '1000.9' });
  const fractional = await service.listAuditLogs({ page: '1.9', pageSize: '1.9' });
  const capped = await service.listAuditLogs({ page: '1000000', pageSize: '100' });

  assert.deepEqual(
    calls.map(({ skip, take }) => ({ skip, take })),
    [{ skip: 0, take: 100 }, { skip: 0, take: 10 }, { skip: 199_900, take: 100 }],
  );
  assert.deepEqual(
    [unbounded.page, unbounded.pageSize, fractional.page, fractional.pageSize, capped.page],
    [1, 100, 1, 10, 2_000],
  );
});

test('采购操作留痕查询 DTO 拒绝重复参数并规范化合法输入', async () => {
  const invalid = plainToInstance(ProcAuditLogQueryDto, {
    page: ['1', '2'],
    action: ['PATCH', 'DELETE'],
    section: ['tasks', 'materials'],
  });
  const invalidFields = new Set((await validate(invalid)).map((error) => error.property));
  assert.deepEqual(invalidFields, new Set(['page', 'action', 'section']));

  const valid = plainToInstance(ProcAuditLogQueryDto, {
    page: '2',
    pageSize: '50',
    action: ' patch ',
    dateFrom: '2026-08-01T00:00:00.000Z',
  });
  assert.deepEqual(await validate(valid), []);
  assert.equal(valid.page, 2);
  assert.equal(valid.pageSize, 50);
  assert.equal(valid.action, 'PATCH');
});

function guardContext(permissions?: string[]): ExecutionContext {
  return {
    getHandler: () => ProcurementController.prototype.listAuditLogs,
    getClass: () => ProcurementController,
    switchToHttp: () => ({
      getRequest: () => permissions ? { user: { permissions } } : {},
    }),
  } as unknown as ExecutionContext;
}

test('采购操作留痕接口使用独立页面权限并由权限守卫拒绝越权访问', () => {
  const permissions = Reflect.getMetadata(
    PERMISSIONS_KEY,
    ProcurementController.prototype.listAuditLogs,
  ) as string[] | undefined;
  assert.deepEqual(permissions, ['page:proc-audit-log']);

  const guard = new RolesGuard(new Reflector());
  assert.equal(guard.canActivate(guardContext()), false);
  assert.equal(guard.canActivate(guardContext(['page:proc-cockpit'])), false);
  assert.equal(guard.canActivate(guardContext(['page:proc-audit-log'])), true);
  assert.equal(guard.canActivate(guardContext(['*'])), true);
});
