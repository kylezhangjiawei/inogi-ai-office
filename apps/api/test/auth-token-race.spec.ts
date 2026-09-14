import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import * as argon2 from 'argon2';
import { AuthService } from '../src/modules/auth/auth.service';
import { UsersService } from '../src/modules/users/users.service';

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

/** In-memory transactional row-lock model. No Prisma client, DB or network access. */
async function harness() {
  const user = { id: 'alice', name: '甲', email: 'alice@example.com', status: 'ACTIVE', passwordHash: await argon2.hash('old-password'), role: { permissions: [] } };
  const tokens = new Map<string, any>([['old-refresh', { id: 'old-refresh-id', token: 'old-refresh', userId: 'alice', expiresAt: new Date(Date.now() + 60_000) }]]);
  let userLock: Promise<void> = Promise.resolve();
  let beforeCreate = async () => {};
  let beforeUserUpdate = async () => {};
  const client = (lock: () => Promise<void>) => ({
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      assert.match(strings.join('?'), /FROM "User".*FOR UPDATE/);
      assert.deepEqual(values, ['alice']);
      await lock();
      return [{ id: 'alice' }];
    },
    user: {
      findFirst: async () => structuredClone(user),
      findUnique: async () => structuredClone(user),
      update: async ({ data }: any) => { await beforeUserUpdate(); await lock(); Object.assign(user, data); return structuredClone(user); },
      updateMany: async ({ where, data }: any) => {
        await beforeUserUpdate();
        await lock();
        if (where.passwordHash !== user.passwordHash) return { count: 0 };
        Object.assign(user, data);
        return { count: 1 };
      },
    },
    refreshToken: {
      findUnique: async ({ where }: any) => structuredClone(tokens.get(where.token) ?? [...tokens.values()].find((token) => token.id === where.id) ?? null),
      delete: async ({ where }: any) => {
        const entry = [...tokens.entries()].find(([, token]) => token.id === where.id);
        if (!entry) throw new Error('Token was already consumed');
        tokens.delete(entry[0]);
        return entry[1];
      },
      deleteMany: async ({ where }: any) => {
        let count = 0;
        for (const [key, token] of tokens) {
          if ((!where.id || token.id === where.id) && (!where.userId || token.userId === where.userId) && (!where.token || token.token === where.token)) { tokens.delete(key); count++; }
        }
        return { count };
      },
      create: async ({ data }: any) => {
        await beforeCreate();
        const saved = { id: data.token, ...data };
        tokens.set(data.token, saved);
        return saved;
      },
    },
  });
  const prisma: any = client(async () => {});
  prisma.$transaction = async (operation: (tx: any) => Promise<unknown>) => {
    let unlock: (() => void) | undefined;
    const acquire = async () => {
      if (unlock) return;
      const predecessor = userLock;
      const next = barrier();
      userLock = next.promise;
      unlock = next.release;
      await predecessor;
    };
    try { return await operation(client(acquire)); } finally { unlock?.(); }
  };
  const newAuth = () => {
    const auth = Object.create(AuthService.prototype) as any;
    auth.prisma = prisma;
    auth.jwtService = { sign: () => 'access-token' };
    auth.refreshPresetAvatarKeysIfStale = async () => {};
    auth.toAuthUserProfile = async (value: any) => ({ ...value, permissions: [] });
    return auth;
  };
  return { user, tokens, prisma, newAuth,
    beforeCreate: (hook: () => Promise<void>) => { beforeCreate = hook; },
    beforeUserUpdate: (hook: () => Promise<void>) => { beforeUserUpdate = hook; },
  };
}

for (const action of ['login', 'refresh'] as const) {
  for (const passwordChange of ['self', 'admin'] as const) {
    test(`${action} 在身份验证后被 ${passwordChange} 改密撤销，恢复执行不能重新签发刷新令牌`, async () => {
      const h = await harness();
      const auth = h.newAuth();
      const reached = barrier();
      const resume = barrier();
      auth.refreshPresetAvatarKeysIfStale = async () => { reached.release(); await resume.promise; };
      const pending = action === 'login' ? auth.login('alice', 'old-password') : auth.refresh('old-refresh');
      await reached.promise;
      if (passwordChange === 'self') await h.newAuth().setPassword('alice', 'old-password', 'new-password');
      else await new UsersService(h.prisma).adminResetPassword('alice', 'new-password');
      assert.equal(h.tokens.size, 0);
      resume.release();
      await assert.rejects(pending, /失效|密码|无效|Unauthorized/);
      assert.equal(h.tokens.size, 0);
    });
  }
}

test('签发先取得用户行锁时，随后管理重置等待签发提交并撤销刚签发的令牌', async () => {
  const h = await harness();
  const creating = barrier();
  const finishCreate = barrier();
  const updating = barrier();
  h.beforeCreate(async () => { creating.release(); await finishCreate.promise; });
  h.beforeUserUpdate(async () => { updating.release(); });
  const pending = h.newAuth().refresh('old-refresh');
  await creating.promise;
  // An admin reset reaches the user update after its hash completes.
  const resetting = new UsersService(h.prisma).adminResetPassword('alice', 'new-password');
  await updating.promise;
  await new Promise<void>((resolve) => setImmediate(resolve));
  finishCreate.release();
  await Promise.all([pending, resetting]);
  assert.equal(h.tokens.size, 0);
});

test('正常登录及刷新仍签发令牌，旧刷新令牌不可重放', async () => {
  const h = await harness();
  h.tokens.clear();
  const login = await h.newAuth().login('alice', 'old-password');
  assert.equal(h.tokens.has(login.refreshToken), true);
  const refreshed = await h.newAuth().refresh(login.refreshToken);
  assert.equal(h.tokens.has(login.refreshToken), false);
  assert.equal(h.tokens.has(refreshed.refreshToken), true);
  await assert.rejects(() => h.newAuth().refresh(login.refreshToken), /无效/);
  assert.equal(h.tokens.size, 1);
});

test('不同服务实例同时刷新同一令牌只允许一个成功', async () => {
  const h = await harness();
  const gate = barrier();
  const first = h.newAuth();
  const second = h.newAuth();
  const bothReady = barrier();
  let arrivals = 0;
  const pause = async () => { arrivals++; if (arrivals === 2) bothReady.release(); await gate.promise; };
  first.refreshPresetAvatarKeysIfStale = pause;
  second.refreshPresetAvatarKeysIfStale = pause;
  const pending = [first.refresh('old-refresh'), second.refresh('old-refresh')];
  const settled = Promise.allSettled(pending);
  // Also release on an early failure in the original consume-before-transaction implementation.
  void Promise.race([bothReady.promise, pending[1].catch(() => {})]).then(() => gate.release());
  const results = await settled;
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(h.tokens.size, 1);
});

test('已验证旧密码的个人改密不能覆盖随后提交的管理员重置', async () => {
  const h = await harness();
  const verified = barrier();
  const resume = barrier();
  let attempts = 0;
  h.beforeUserUpdate(async () => {
    if (++attempts === 1) { verified.release(); await resume.promise; }
  });
  const staleChange = h.newAuth().setPassword('alice', 'old-password', 'stale-session-password');
  await verified.promise;
  await new UsersService(h.prisma).adminResetPassword('alice', 'admin-new-password');
  resume.release();
  await assert.rejects(staleChange, /已变更|重新登录/);
  assert.equal(await argon2.verify(h.user.passwordHash, 'admin-new-password'), true);
  assert.equal(h.tokens.size, 0);
});
