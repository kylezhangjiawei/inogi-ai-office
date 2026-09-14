import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import * as argon2 from 'argon2';
import { AuthService } from '../src/modules/auth/auth.service';
import { UsersController } from '../src/modules/users/users.controller';
import { UsersService } from '../src/modules/users/users.service';
import { ResearchDevelopmentService } from '../src/modules/research-development/research-development.service';
import { canReadRdTask } from '../src/modules/research-development/rd-task-access';

function authHarness(user: Record<string, unknown>) {
  const deletions: string[] = [];
  const writes: unknown[] = [];
  const revoked: unknown[] = [];
  const prisma: any = {
    user: {
      findUnique: async () => structuredClone(user),
      update: async ({ data }: any) => { writes.push(data); Object.assign(user, data); return user; },
      updateMany: async ({ where, data }: any) => {
        if (user.passwordHash !== where.passwordHash) return { count: 0 };
        writes.push(data); Object.assign(user, data); return { count: 1 };
      },
    },
    refreshToken: { deleteMany: async (args: any) => { revoked.push(args); return { count: 2 }; } },
  };
  prisma.$transaction = async (operation: (tx: any) => Promise<unknown>) => operation(prisma);
  const auth = Object.create(AuthService.prototype) as any;
  auth.prisma = prisma;
  auth.ossService = {
    resolveKeyPrefix: (prefix: string) => `prod/${prefix}`,
    deleteObject: async (key: string) => { deletions.push(key); },
    uploadBuffer: async () => 'prod/avatars/alice/new.png',
    getSignedUrl: (key: string) => `https://example.invalid/${key}`,
    listObjects: async () => ['prod/avatars/presets/shared.png'],
  };
  auth.refreshPresetAvatarKeysIfStale = async () => {};
  auth.toAuthUserProfile = async (value: any) => value;
  return { auth, prisma, deletions, writes, revoked };
}

test('普通用户不能通过管理重置入口免旧密码修改本人或他人密码', async () => {
  const h = authHarness({ id: 'alice', role: { permissions: [] } });
  const controller = new UsersController(new UsersService(h.prisma));
  for (const id of ['alice', 'bob']) {
    await assert.rejects(async () => controller.resetPassword(id, { newPassword: 'x' }, { user: { id: 'alice', permissions: [] } }), /权限/);
  }
  assert.equal(h.writes.length, 0);
});

test('管理重置拒绝短密码，成功重置同时撤销该用户全部刷新令牌', async () => {
  const h = authHarness({ id: 'bob', role: { permissions: [] } });
  const controller = new UsersController(new UsersService(h.prisma));
  const admin = { user: { id: 'admin', permissions: ['user:reset-password'] } };
  await assert.rejects(async () => controller.resetPassword('bob', { newPassword: 'x' }, admin), /8/);
  assert.equal(h.writes.length, 0);
  await controller.resetPassword('bob', { newPassword: 'new-password' }, admin);
  assert.equal(await argon2.verify((h.writes[0] as any).passwordHash, 'new-password'), true);
  assert.deepEqual(h.revoked, [{ where: { userId: 'bob' } }]);
});

test('拥有重置权限的本人仍可使用管理重置，其他人不能重置超级管理员', async () => {
  const h = authHarness({ id: 'admin', role: { permissions: ['*'] } });
  const controller = new UsersController(new UsersService(h.prisma));
  await assert.rejects(async () => controller.resetPassword('admin', { newPassword: 'new-password' }, { user: { id: 'other-admin', permissions: ['*'] } }), /不允许/);
  assert.equal(h.writes.length, 0);
  await controller.resetPassword('admin', { newPassword: 'new-password' }, { user: { id: 'admin', permissions: ['*'] } });
  assert.equal(h.writes.length, 1);
  assert.deepEqual(h.revoked, [{ where: { userId: 'admin' } }]);
});

test('正常个人改密仍校验旧密码，并与刷新令牌撤销处于同一事务', async () => {
  const h = authHarness({ id: 'alice', status: 'ACTIVE', passwordHash: await argon2.hash('old-password'), role: { permissions: [] } });
  await assert.rejects(() => h.auth.setPassword('alice', '', 'new-password'), /当前密码/);
  await assert.rejects(() => h.auth.setPassword('alice', 'wrong-password', 'new-password'), /不正确/);
  assert.equal(h.writes.length, 0);
  let transactions = 0;
  h.prisma.$transaction = async (operation: (tx: any) => Promise<unknown>) => { transactions++; return operation(h.prisma); };
  await h.auth.setPassword('alice', 'old-password', 'new-password');
  assert.equal(transactions, 1);
  assert.deepEqual(h.revoked, [{ where: { userId: 'alice' } }]);
});

test('更改个人姓名和邮箱不能在读取时把历史研发任务或成员绑定到本人', async () => {
  const user = { id: 'alice', name: '原名', email: 'alice@example.com', status: 'ACTIVE', role: { permissions: [] } };
  const h = authHarness(user);
  await h.auth.updateCurrentUser('alice', { name: '乙', email: 'alice@example.com' });
  const rd = Object.create(ResearchDevelopmentService.prototype) as any;
  const users = [user, { id: 'bob', name: '乙', status: 'ACTIVE' }];
  const people = rd.normalizePeopleRecords([{ id: 'legacy-person', name: '乙', email: 'alice@example.com' }], users);
  assert.equal(people[0].user_id, null);
  const legacy = rd.normalizeTaskIdentity({ task_id: 'legacy', primary_owner: '乙', collaborators: [{ name: '乙' }] }, people, users);
  assert.equal(legacy.primary_owner_user_id, null);
  assert.equal(canReadRdTask(legacy, { userId: 'alice', userName: user.name }), false);
  rd.findTaskAcrossStores = async () => legacy;
  await assert.rejects(() => rd.requireProcurementTransferAccess('legacy', { userId: 'alice', userName: user.name, permissions: ['page:rd-my-workspace'] }), /只能/);
  assert.equal(rd.canUserMutateNoteAttachments(legacy, { actor: { id: 'bob' } }, { userId: 'alice', userName: user.name }), false);
  const linked = rd.normalizeTaskIdentity({ primary_owner: '乙', primary_owner_user_id: 'bob' }, people, users);
  assert.equal(canReadRdTask(linked, { userId: 'alice', userName: '乙' }), false);
  assert.equal(canReadRdTask(linked, { userId: 'bob', userName: '改过的名字' }), true);
});

test('管理员明确绑定的人员目录仍可为历史任务解析稳定账号，失效 ID 不改绑同名人', () => {
  const rd = Object.create(ResearchDevelopmentService.prototype) as any;
  const users = [{ id: 'alice', name: '乙', status: 'ACTIVE' }, { id: 'bob', name: '乙', status: 'ACTIVE' }];
  const people = rd.normalizePeopleRecords([{ id: 'managed', name: '乙', user_id: 'bob' }], users);
  assert.equal(rd.normalizeTaskIdentity({ primary_owner: '乙' }, people, users).primary_owner_user_id, 'bob');
  assert.equal(rd.normalizeTaskIdentity({ primary_owner: '乙', primary_owner_user_id: 'deleted-user' }, people, users).primary_owner_user_id, 'deleted-user');
});

test('普通成员不能移动仅姓名相同但未绑定账号的历史任务', async () => {
  const rd = Object.create(ResearchDevelopmentService.prototype) as any;
  let writes = 0;
  rd.getProducts = async () => [{ id: 'prod-portable-o2' }];
  rd.readNormalizedTaskCategories = async () => [{ id: 'source', children: [{ id: 'source-child', tasks: [{ task_id: 'legacy', primary_owner: '乙', subtasks: [] }] }] }, { id: 'target', children: [{ id: 'target-child', tasks: [] }] }];
  rd.readProductCategoryStore = async () => ({});
  rd.writeValue = async () => { writes++; };
  rd.withTaskTreeLock = async (operation: () => Promise<unknown>) => operation();
  await assert.rejects(() => rd.moveTasks(['legacy'], { productId: 'prod-portable-o2', categoryId: 'target', subId: 'target-child' }, { requesterUserId: 'alice', requesterName: '乙', canMoveAny: false }), /只能移动/);
  assert.equal(writes, 0);
});

for (const operation of ['reset', 'upload'] as const) {
  test(`选择共享预置头像后 ${operation} 不删除预置对象，自己的旧上传仍可清理`, async () => {
    for (const oldKey of ['prod/avatars/presets/shared.png', 'prod/avatars/alice/old.png']) {
      const h = authHarness({ id: 'alice', status: 'ACTIVE', avatarObjectKey: oldKey });
      if (operation === 'reset') await h.auth.resetAvatar('alice');
      else await h.auth.uploadAvatar('alice', { buffer: Buffer.from('image'), size: 5, originalname: 'new.png', mimetype: 'image/png' });
      assert.deepEqual(h.deletions, oldKey.includes('/presets/') ? [] : [oldKey]);
    }
  });
}
