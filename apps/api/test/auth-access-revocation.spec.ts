import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { AuthService } from '../src/modules/auth/auth.service';
import { JwtPayload, JwtStrategy } from '../src/modules/auth/strategies/jwt.strategy';
import { UsersService } from '../src/modules/users/users.service';

const secret = 'synthetic-access-revocation-test-key-not-for-deployment';

/** Real Argon2, JWT signing/verification and strategy; only persistence is in memory. */
async function harness() {
  const user = {
    id: 'alice', name: '甲', englishName: 'Alice', username: 'alice', email: 'alice@example.invalid',
    status: 'ACTIVE', roleId: 'member', role: { permissions: ['page:rd-my-workspace'] },
    department: null as string | null, passwordHash: await argon2.hash('old-password'),
  };
  const tokens = new Map<string, any>();
  const prisma: any = {
    $queryRaw: async (strings: TemplateStringsArray, id: string) => {
      assert.match(strings.join('?'), /FROM "User".*FOR UPDATE/);
      assert.equal(id, user.id);
      return [{ id }];
    },
    user: {
      findFirst: async () => structuredClone(user),
      findUnique: async () => structuredClone(user),
      update: async ({ data }: any) => { Object.assign(user, data); return structuredClone(user); },
      updateMany: async ({ where, data }: any) => {
        if (where.passwordHash !== user.passwordHash) return { count: 0 };
        Object.assign(user, data);
        return { count: 1 };
      },
    },
    department: { findUnique: async () => ({ code: 'dept-qa' }) },
    refreshToken: {
      findUnique: async ({ where }: any) => structuredClone(tokens.get(where.token) ?? null),
      create: async ({ data }: any) => { tokens.set(data.token, { ...data, id: data.token }); return tokens.get(data.token); },
      delete: async ({ where }: any) => { const row = tokens.get(where.id); tokens.delete(where.id); return row; },
      deleteMany: async ({ where }: any) => {
        let count = 0;
        for (const [id, row] of tokens) {
          if ((!where.userId || row.userId === where.userId) && (!where.id || row.id === where.id)) {
            tokens.delete(id); count++;
          }
        }
        return { count };
      },
    },
  };
  prisma.$transaction = (operation: (tx: any) => Promise<unknown>) => operation(prisma);
  const jwt = new JwtService({ secret });
  const permissionCatalog: any = { filterDisabled: async (permissions: string[]) => permissions };
  const strategy = new JwtStrategy(prisma, permissionCatalog, new ConfigService({ JWT_SECRET: secret }));
  const auth = Object.create(AuthService.prototype) as any;
  Object.assign(auth, { prisma, jwtService: jwt, jwtSecret: secret });
  auth.refreshPresetAvatarKeysIfStale = async () => {};
  auth.toAuthUserProfile = async (value: typeof user) => ({
    id: value.id, name: value.name, englishName: value.englishName, username: value.username,
    email: value.email, roleId: value.roleId, permissions: value.role.permissions,
    department: value.department, departmentCode: value.department ? 'dept-qa' : null,
  });
  const validate = async (accessToken: string) => strategy.validate(jwt.verify<JwtPayload>(accessToken));
  return { user, tokens, prisma, jwt, auth, strategy, validate };
}

for (const operation of ['self', 'admin'] as const) {
  test(`${operation} 改密提交后立即拒绝尚未过期的旧 access JWT，新密码仍可登录`, async () => {
    const h = await harness();
    const session = await h.auth.login('alice', 'old-password');
    assert.equal((await h.validate(session.accessToken)).id, 'alice');
    if (operation === 'self') await h.auth.setPassword('alice', 'old-password', 'new-password');
    else await new UsersService(h.prisma).adminResetPassword('alice', 'new-password');
    // The JWT remains correctly signed and unexpired, but its credential must be revoked.
    assert.equal(h.jwt.verify(session.accessToken).sub, 'alice');
    await assert.rejects(() => h.validate(session.accessToken), /Unauthorized|凭据|密码|登录/);
    await assert.rejects(() => h.auth.refresh(session.refreshToken), /无效|过期/);
    await assert.rejects(() => h.auth.login('alice', 'old-password'), /密码错误/);
    const next = await h.auth.login('alice', 'new-password');
    assert.equal((await h.validate(next.accessToken)).id, 'alice');
  });
}

test('普通资料、头像、部门和角色变化不使 access JWT 失效，权限与部门仍取最新值', async () => {
  const h = await harness();
  const session = await h.auth.login('alice', 'old-password');
  await h.auth.updateCurrentUser('alice', { name: '新姓名', englishName: 'Updated' });
  Object.assign(h.user, { avatarObjectKey: 'prod/avatars/alice/new.png', department: '质量部', roleId: 'qa',
    role: { permissions: ['page:qa'] }, updatedAt: new Date() });
  const actor = await h.validate(session.accessToken);
  assert.equal(actor.name, '新姓名');
  assert.equal(actor.departmentCode, 'dept-qa');
  assert.deepEqual(actor.permissions, ['page:qa']);
});

test('access 凭据版本不暴露密码哈希，错误、缺失或其他账号的版本不能通过鉴权', async () => {
  const h = await harness();
  const session = await h.auth.login('alice', 'old-password');
  const payload = h.jwt.verify<Record<string, any>>(session.accessToken);
  assert.match(payload.credentialVersion, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(payload).includes(h.user.passwordHash), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'passwordHash'), false);
  for (const credentialVersion of [undefined, null, 1, '', 'bad', '0'.repeat(64), 'f'.repeat(64)]) {
    const forged = { ...payload, credentialVersion };
    await assert.rejects(() => h.validate(h.jwt.sign(forged)), /Unauthorized|凭据|密码|登录/);
  }
  // Even accounts deliberately sharing one stored hash must have different versions.
  h.user.id = 'bob';
  await assert.rejects(() => h.validate(h.jwt.sign({ ...payload, sub: 'bob' })), /Unauthorized|凭据|密码|登录/);
});

test('旧版无凭据版本的 access JWT 返回未授权，但有效 refresh 可换取新版会话', async () => {
  const h = await harness();
  const session = await h.auth.login('alice', 'old-password');
  const legacyPayload = h.jwt.verify<Record<string, any>>(session.accessToken);
  delete legacyPayload.credentialVersion;
  await assert.rejects(() => h.validate(h.jwt.sign(legacyPayload)), /Unauthorized|凭据|密码|登录/);
  const refreshed = await h.auth.refresh(session.refreshToken);
  assert.equal((await h.validate(refreshed.accessToken)).id, 'alice');
  assert.equal(h.tokens.has(session.refreshToken), false);
  assert.equal(h.tokens.has(refreshed.refreshToken), true);
});

test('版本相符时仍拒绝被禁用或已删除的账号', async () => {
  const h = await harness();
  const session = await h.auth.login('alice', 'old-password');
  h.user.status = 'DISABLED';
  await assert.rejects(() => h.validate(session.accessToken), /Unauthorized/);
  h.prisma.user.findUnique = async () => null;
  await assert.rejects(() => h.validate(session.accessToken), /Unauthorized/);
});
