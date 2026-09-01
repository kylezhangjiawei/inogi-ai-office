import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { ForbiddenException } from '@nestjs/common';

import { PERMISSIONS_KEY } from '../src/modules/auth/decorators/permissions.decorator';
import { UsersController } from '../src/modules/users/users.controller';
import { UsersService } from '../src/modules/users/users.service';

test('删除用户接口继续要求 user:delete 权限', () => {
  assert.deepEqual(
    Reflect.getMetadata(PERMISSIONS_KEY, UsersController.prototype.remove),
    ['user:delete'],
  );
});

test('删除超级管理员时由服务端拒绝且不会执行删除', async () => {
  const deleteCalls: unknown[] = [];
  const findUniqueCalls: unknown[] = [];
  const service = new UsersService({
    user: {
      findUnique: async (args: unknown) => {
        findUniqueCalls.push(args);
        return {
          id: 'super-admin',
          role: { permissions: ['*'] },
        };
      },
      delete: async (args: unknown) => {
        deleteCalls.push(args);
        return { id: 'super-admin' };
      },
    },
  } as never);

  await assert.rejects(
    () => service.remove('super-admin'),
    (error: unknown) => {
      assert.ok(error instanceof ForbiddenException);
      assert.equal(error.message, '超级管理员账号不允许被删除');
      return true;
    },
  );
  assert.deepEqual(findUniqueCalls, [
    {
      where: { id: 'super-admin' },
      select: {
        id: true,
        role: { select: { permissions: true } },
      },
    },
  ]);
  assert.equal(deleteCalls.length, 0);
});

test('删除普通用户仍按原契约返回成功', async () => {
  const deleteCalls: unknown[] = [];
  const service = new UsersService({
    user: {
      findUnique: async () => ({
        id: 'regular-user',
        role: { permissions: ['page:users'] },
      }),
      delete: async (args: unknown) => {
        deleteCalls.push(args);
        return { id: 'regular-user' };
      },
    },
  } as never);

  assert.deepEqual(await service.remove('regular-user'), { ok: true });
  assert.deepEqual(deleteCalls, [{ where: { id: 'regular-user' } }]);
});
