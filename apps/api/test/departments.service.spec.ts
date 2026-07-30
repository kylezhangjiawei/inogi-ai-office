import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { DepartmentsService } from '../src/modules/departments/departments.service';

function department(overrides: Record<string, unknown> = {}) {
  return {
    id: 'department-1',
    code: 'PRODUCTION',
    name: '生产部',
    category: '生产系统',
    manager: '',
    description: '',
    sortOrder: 10,
    enabled: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

test('部门改名在同一事务中同步所有当前部门引用', async () => {
  const userUpdates: unknown[] = [];
  const employeeUpdates: unknown[] = [];
  const taskUpdates: unknown[] = [];
  const settingUpdates: Array<{ where: unknown; data: { value: unknown } }> = [];
  const permissionUpdates: unknown[] = [];
  const updated = department({ name: '生产运营部' });

  const tx = {
    department: {
      findUnique: async () => department(),
      update: async () => updated,
    },
    user: {
      updateMany: async (args: unknown) => {
        userUpdates.push(args);
      },
    },
    employeeArchive: {
      updateMany: async (args: unknown) => {
        employeeUpdates.push(args);
      },
    },
    procTask: {
      updateMany: async (args: unknown) => {
        taskUpdates.push(args);
      },
    },
    permissionCatalogItem: {
      updateMany: async (args: unknown) => {
        permissionUpdates.push(args);
      },
    },
    systemSetting: {
      findMany: async () => [
        {
          id: 'rd-people',
          value: [{ id: 'person-1', department: '生产部' }],
        },
        {
          id: 'expense-record',
          value: {
            id: 'invoice-1',
            department_code: 'PRODUCTION',
            department_name: '生产部',
          },
        },
      ],
      update: async (args: { where: unknown; data: { value: unknown } }) => {
        settingUpdates.push(args);
      },
    },
  };
  const service = new DepartmentsService({
    $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) =>
      callback(tx),
  } as never);

  const result = await service.save({
    id: 'department-1',
    code: 'PRODUCTION',
    name: '生产运营部',
    category: '生产系统',
  });

  assert.equal(result.name, '生产运营部');
  assert.deepEqual(userUpdates[0], {
    where: { department: { in: ['生产部'] } },
    data: { department: '生产运营部' },
  });
  assert.deepEqual(employeeUpdates[0], {
    where: { department: { in: ['生产部'] } },
    data: { department: '生产运营部' },
  });
  assert.deepEqual(taskUpdates[0], {
    where: { requesterDept: { in: ['生产部'] } },
    data: { requesterDept: '生产运营部' },
  });
  assert.equal(permissionUpdates.length, 1);
  assert.deepEqual(settingUpdates[0].data.value, [
    { id: 'person-1', department: '生产运营部' },
  ]);
  assert.deepEqual(settingUpdates[1].data.value, {
    id: 'invoice-1',
    department_code: 'PRODUCTION',
    department_name: '生产运营部',
  });
});

test('部门已改名时可用前端保留的旧名称批量修复孤儿引用', async () => {
  const userUpdates: unknown[] = [];
  const employeeUpdates: unknown[] = [];
  const taskUpdates: unknown[] = [];
  const settingUpdates: Array<{ where: unknown; data: { value: unknown } }> = [];
  const current = department({ name: '生产运营部' });

  const tx = {
    department: {
      findUnique: async () => current,
      update: async () => current,
    },
    user: {
      updateMany: async (args: unknown) => {
        userUpdates.push(args);
      },
    },
    employeeArchive: {
      updateMany: async (args: unknown) => {
        employeeUpdates.push(args);
      },
    },
    procTask: {
      updateMany: async (args: unknown) => {
        taskUpdates.push(args);
      },
    },
    permissionCatalogItem: {
      updateMany: async () => undefined,
    },
    systemSetting: {
      findMany: async () => [
        {
          id: 'legacy-rd-people',
          value: [{ id: 'person-1', department: '生产部' }],
        },
      ],
      update: async (args: { where: unknown; data: { value: unknown } }) => {
        settingUpdates.push(args);
      },
    },
  };
  const service = new DepartmentsService({
    $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) =>
      callback(tx),
  } as never);

  await service.save({
    id: 'department-1',
    code: 'PRODUCTION',
    name: '生产运营部',
    previousName: '生产部',
    category: '生产系统',
  });

  assert.deepEqual(userUpdates[0], {
    where: { department: { in: ['生产部'] } },
    data: { department: '生产运营部' },
  });
  assert.deepEqual(employeeUpdates[0], {
    where: { department: { in: ['生产部'] } },
    data: { department: '生产运营部' },
  });
  assert.deepEqual(taskUpdates[0], {
    where: { requesterDept: { in: ['生产部'] } },
    data: { requesterDept: '生产运营部' },
  });
  assert.deepEqual(settingUpdates[0].data.value, [
    { id: 'person-1', department: '生产运营部' },
  ]);
});

test('已创建部门不允许修改稳定编码', async () => {
  const tx = {
    department: {
      findUnique: async () => department(),
    },
  };
  const service = new DepartmentsService({
    $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) =>
      callback(tx),
  } as never);

  await assert.rejects(
    service.save({
      id: 'department-1',
      code: 'NEW_CODE',
      name: '生产部',
      category: '生产系统',
    }),
    /创建后不允许修改/,
  );
});
