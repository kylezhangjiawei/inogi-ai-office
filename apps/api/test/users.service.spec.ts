import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { ForbiddenException, HttpException, ValidationPipe } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Reflector } from '@nestjs/core';

import { PERMISSIONS_KEY } from '../src/modules/auth/decorators/permissions.decorator';
import { RolesGuard } from '../src/modules/auth/guards/roles.guard';
import { SaveRoleDto } from '../src/modules/roles/dto/save-role.dto';
import { RolesController } from '../src/modules/roles/roles.controller';
import { RolesService } from '../src/modules/roles/roles.service';
import { SaveUserDto } from '../src/modules/users/dto/save-user.dto';
import { UsersController } from '../src/modules/users/users.controller';
import { UsersService } from '../src/modules/users/users.service';

const validUser = {
  name: '测试用户',
  username: 'test-user',
  email: 'test@example.com',
  department: '研发部',
  roleId: 'regular-role',
};
const superAdmin = { id: 'admin', permissions: ['*'] };

function knownPrismaError(code: string, target?: string[] | string) {
  return new Prisma.PrismaClientKnownRequestError('Database write failed', {
    code,
    clientVersion: Prisma.prismaVersion.client,
    meta: target === undefined ? undefined : { target },
  });
}

function createSaveService(options: { writeError?: Error; existing?: unknown; rolePermissions?: string[] } = {}) {
  const writes: Array<{ operation: string; args: unknown }> = [];
  const write = async (operation: string, args: unknown) => {
    writes.push({ operation, args });
    if (options.writeError) throw options.writeError;
    return { id: 'saved-user', ...validUser };
  };
  const service = new UsersService({
    role: { findUnique: async () => ({ id: validUser.roleId, permissions: options.rolePermissions ?? ['page:users'] }) },
    department: { findUnique: async () => ({ enabled: true }) },
    user: {
      findUnique: async () => options.existing === undefined
        ? { id: 'existing-user', englishName: 'Alex White', role: { permissions: ['page:users'] } }
        : options.existing,
      create: (args: unknown) => write('create', args),
      update: (args: unknown) => write('update', args),
    },
  } as never);
  return { service, writes };
}

for (const mode of ['create', 'update'] as const) {
  for (const [field, code, message] of [
    ['username', 'USERNAME_ALREADY_EXISTS', '用户名已存在，请更换用户名'],
    ['email', 'EMAIL_ALREADY_EXISTS', '邮箱已被使用，请更换邮箱'],
  ]) {
    test(`${mode} 用户遇到 ${field} 唯一约束冲突时返回具体中文提示与 409`, async () => {
      const { service, writes } = createSaveService({ writeError: knownPrismaError('P2002', [field]) });

      await assert.rejects(
        () => service.save({ ...validUser, ...(mode === 'update' ? { id: 'existing-user' } : {}) }, superAdmin),
        (error: unknown) => {
          assert.ok(error instanceof HttpException);
          assert.equal(error.getStatus(), 409);
          assert.equal((error.getResponse() as { code: string }).code, code);
          assert.equal((error.getResponse() as { message: string }).message, message);
          return true;
        },
      );
      assert.equal(writes.length, 1);
      assert.equal(writes[0].operation, mode);
    });
  }
}

test('编辑已不存在的用户时返回 404 并且不尝试写入', async () => {
  const { service, writes } = createSaveService({ existing: null });
  await assert.rejects(() => service.save({ ...validUser, id: 'missing-user' }, superAdmin), (error: unknown) => {
    assert.ok(error instanceof HttpException);
    assert.equal(error.getStatus(), 404);
    assert.equal(error.message, '用户不存在');
    return true;
  });
  assert.equal(writes.length, 0);
});

test('编辑过程中用户被删除时仍返回中文 404', async () => {
  const { service } = createSaveService({ writeError: knownPrismaError('P2025') });
  await assert.rejects(() => service.save({ ...validUser, id: 'existing-user' }, superAdmin), (error: unknown) => {
    assert.ok(error instanceof HttpException);
    assert.equal(error.getStatus(), 404);
    assert.equal(error.message, '用户不存在');
    return true;
  });
});

test('编辑超级管理员时返回中文 403 并且不尝试写入', async () => {
  const { service, writes } = createSaveService({ existing: { id: 'super-admin', role: { permissions: ['*'] } } });
  await assert.rejects(() => service.save({ ...validUser, id: 'super-admin' }, superAdmin), (error: unknown) => {
    assert.ok(error instanceof ForbiddenException);
    assert.equal(error.getStatus(), 403);
    assert.equal(error.message, '超级管理员账号信息不允许修改');
    return true;
  });
  assert.equal(writes.length, 0);
});

test('保存成功时仍返回用户，编辑可保留本人的用户名和邮箱', async () => {
  const { service, writes } = createSaveService();
  assert.deepEqual(await service.save(validUser, superAdmin), { id: 'saved-user', ...validUser });
  assert.deepEqual(await service.save({ ...validUser, id: 'existing-user' }, superAdmin), { id: 'saved-user', ...validUser });
  assert.deepEqual(writes.map(({ operation }) => operation), ['create', 'update']);
});

test('未知数据库错误继续交由全局异常过滤器处理', async () => {
  const writeError = new Error('Database unavailable');
  const { service } = createSaveService({ writeError });
  await assert.rejects(() => service.save(validUser, superAdmin), (error: unknown) => error === writeError);
});

test('用户表单字段验证返回对应的中文错误信息', async () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true });
  await assert.rejects(
    () => pipe.transform({ ...validUser, name: '', email: 'invalid-email', password: '123', status: 'UNKNOWN' }, {
      type: 'body',
      metatype: SaveUserDto,
    }),
    (error: unknown) => {
      assert.ok(error instanceof HttpException);
      assert.equal(error.getStatus(), 400);
      assert.deepEqual(new Set((error.getResponse() as { message: string[] }).message), new Set([
        '姓名不能为空',
        '邮箱格式不正确，请输入有效邮箱',
        '密码至少需要 8 个字符',
        '用户状态无效，请重新选择',
      ]));
      return true;
    },
  );
});

function allowedByRoute(controller: object, handler: Function, user: typeof superAdmin) {
  return new RolesGuard(new Reflector()).canActivate({
    getClass: () => controller.constructor,
    getHandler: () => handler,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as never);
}

for (const operation of ['create', 'edit'] as const) {
  test(`只有 user:${operation} 权限不能进入另一种用户保存分支`, async () => {
    const { service, writes } = createSaveService();
    const controller = new UsersController(service);
    const actor = { id: 'limited-admin', permissions: [`user:${operation}`, 'page:users'] };
    assert.equal(allowedByRoute(controller, controller.save, actor), true);
    await assert.rejects(
      () => controller.save({ ...validUser, ...(operation === 'create' ? { id: 'existing-user' } : {}) }, { user: actor }),
      ForbiddenException,
    );
    assert.equal(writes.length, 0);
  });
}

for (const permissions of [['*'], ['finance:approve']]) {
  test(`用户管理员不能分配自己没有的角色权限 ${permissions.join(',')}`, async () => {
    for (const id of [undefined, 'existing-user']) {
      const { service, writes } = createSaveService({ rolePermissions: permissions });
      const controller = new UsersController(service);
      await assert.rejects(
        () => controller.save({ ...validUser, id }, { user: { id: 'limited-admin', permissions: ['user:create', 'user:edit', 'page:users'] } }),
        ForbiddenException,
      );
      assert.equal(writes.length, 0);
    }
  });
}

test('用户管理员不能修改授权范围外账号，即使请求不修改角色', async () => {
  const { service, writes } = createSaveService({ existing: { id: 'finance-admin', role: { permissions: ['finance:approve'] } } });
  await assert.rejects(
    () => service.save({ ...validUser, id: 'finance-admin', roleId: undefined }, { id: 'limited-admin', permissions: ['user:edit'] }),
    ForbiddenException,
  );
  assert.equal(writes.length, 0);
});

test('合法用户管理员可以创建和编辑授权范围内账号，超级管理员可以分配超级角色', async () => {
  const { service, writes } = createSaveService();
  await service.save(validUser, { id: 'limited-admin', permissions: ['user:create', 'page:users'] });
  await service.save({ ...validUser, id: 'existing-user' }, { id: 'limited-admin', permissions: ['user:edit', 'page:users'] });
  assert.equal(writes.length, 2);
  const superRole = createSaveService({ rolePermissions: ['*'] });
  await superRole.service.save(validUser, superAdmin);
  assert.equal(superRole.writes.length, 1);
});

const validRole = { name: '项目成员', description: '可查看任务', permissions: ['page:tasks'] };

function createRoleService(options: { writeError?: Error; existing?: unknown } = {}) {
  const writes: Array<{ operation: string; args: unknown }> = [];
  const write = async (operation: string, args: unknown) => {
    writes.push({ operation, args });
    if (options.writeError) throw options.writeError;
    return { id: 'saved-role', ...validRole };
  };
  const service = new RolesService({
    role: {
      findUnique: async () => options.existing === undefined
        ? { id: 'existing-role', ...validRole, _count: { users: 0 } }
        : options.existing,
      create: (args: unknown) => write('create', args),
      update: (args: unknown) => write('update', args),
      delete: (args: unknown) => write('delete', args),
    },
  } as never);
  return { service, writes };
}

for (const operation of ['create', 'edit'] as const) {
  test(`只有 role:${operation} 权限不能进入另一种角色保存分支`, async () => {
    const { service, writes } = createRoleService();
    const controller = new RolesController(service);
    const actor = { id: 'limited-admin', permissions: [`role:${operation}`, 'page:tasks'] };
    assert.equal(allowedByRoute(controller, controller.save, actor), true);
    await assert.rejects(
      () => controller.save({ ...validRole, ...(operation === 'create' ? { id: 'existing-role' } : {}) }, { user: actor }),
      ForbiddenException,
    );
    assert.equal(writes.length, 0);
  });
}

test('角色管理员不能授予通配符或自己没有的权限，也不能改写更高权限的角色', async () => {
  for (const permissions of [['*'], ['finance:approve']]) {
    for (const id of [undefined, 'existing-role']) {
      const { service, writes } = createRoleService();
      await assert.rejects(
        () => new RolesController(service).save({ ...validRole, id, permissions }, { user: { id: 'limited-admin', permissions: ['role:create', 'role:edit', 'page:tasks'] } }),
        ForbiddenException,
      );
      assert.equal(writes.length, 0);
    }
  }
  const { service, writes } = createRoleService({ existing: { permissions: ['finance:approve'] } });
  await assert.rejects(
    () => service.save({ ...validRole, id: 'finance-role' }, { id: 'limited-admin', permissions: ['role:edit', 'page:tasks'] }),
    ForbiddenException,
  );
  assert.equal(writes.length, 0);
});

test('超级角色对保存和删除接口保持只读，包括超级管理员调用', async () => {
  const { service, writes } = createRoleService({ existing: { permissions: ['*'], _count: { users: 0 } } });
  await assert.rejects(() => service.save({ ...validRole, id: 'super-role' }, superAdmin), ForbiddenException);
  await assert.rejects(() => service.remove('super-role'), ForbiddenException);
  assert.equal(writes.length, 0);
});

test('合法角色管理员可创建编辑授权范围内角色，超管可授权普通管理员没有的权限', async () => {
  const { service, writes } = createRoleService();
  await service.save(validRole, { id: 'limited-admin', permissions: ['role:create', 'page:tasks'] });
  await service.save({ ...validRole, id: 'existing-role' }, { id: 'limited-admin', permissions: ['role:edit', 'page:tasks'] });
  await service.save({ ...validRole, permissions: ['finance:approve'] }, superAdmin);
  assert.deepEqual(writes.map(({ operation }) => operation), ['create', 'update', 'create']);
});

for (const id of [undefined, 'existing-role']) {
  test(`${id ? '编辑' : '创建'}重复角色名返回明确中文 409`, async () => {
    const { service } = createRoleService({ writeError: knownPrismaError('P2002', ['name']) });
    await assert.rejects(() => service.save({ ...validRole, id }, superAdmin), (error: unknown) => {
      assert.ok(error instanceof HttpException);
      assert.equal(error.getStatus(), 409);
      assert.deepEqual(error.getResponse(), { statusCode: 409, code: 'ROLE_NAME_ALREADY_EXISTS', message: '角色名称已存在，请更换名称' });
      return true;
    });
  });
}

test('角色删除后再次编辑返回中文 404，未知写入失败交给异常过滤器', async () => {
  for (const options of [{ existing: null }, { writeError: knownPrismaError('P2025') }]) {
    const { service } = createRoleService(options);
    await assert.rejects(() => service.save({ ...validRole, id: 'missing' }, superAdmin), (error: unknown) => {
      assert.ok(error instanceof HttpException);
      assert.equal(error.getStatus(), 404);
      assert.equal(error.message, '角色不存在或已被删除，请刷新列表后重试');
      return true;
    });
  }
  const writeError = new Error('Database unavailable');
  const { service } = createRoleService({ writeError });
  await assert.rejects(() => service.save(validRole, superAdmin), (error: unknown) => error === writeError);
});

test('角色表单验证返回中文字段错误', async () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true });
  await assert.rejects(() => pipe.transform({ name: '', permissions: [123] }, { type: 'body', metatype: SaveRoleDto }), (error: unknown) => {
    assert.ok(error instanceof HttpException);
    assert.deepEqual(new Set((error.getResponse() as { message: string[] }).message), new Set(['角色名称不能为空', '权限项必须是字符串']));
    return true;
  });
});

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
