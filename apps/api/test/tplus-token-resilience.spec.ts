import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  TplusAuthError,
  TplusSyncService,
  isTransientAuthFailure,
} from '../src/modules/procurement/tplus-sync.service';

/**
 * 线上真实断链过程（2026-07-29）：自动同步第一步报 `fetch failed`（网络层），
 * 令牌被当成失效清空，之后每晚静默跳过，界面停留在一个月前那条摘要上。
 * 这组用例锁的就是这条路径不许再发生。
 */
function harness(opts: {
  meta?: Record<string, unknown>;
  refreshBehavior?: () => Promise<Record<string, unknown>>;
  mintBehavior?: () => Promise<string>;
  beforeWrite?: (metadata: Record<string, unknown>) => void;
}) {
  const meta: Record<string, unknown> = {
    appKey: 'k', baseUrl: 'https://openapi.chanjet.com',
    openToken: 'old-token', refreshToken: 'refresh-abc',
    openTokenExpireAt: Date.parse('2000-01-01T00:00:00Z'), // 已过期，强制走刷新
    ...opts.meta,
  };
  const row = { id: 'cfg-1', metadata: meta, encryptedSecret: 'enc', updatedAt: new Date() };
  const updates: Array<Record<string, unknown>> = [];
  const prisma = {
    integrationConfig: {
      findFirst: async () => structuredClone(row),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        opts.beforeWrite?.(row.metadata);
        updates.push(data.metadata as Record<string, unknown>);
        Object.assign(row.metadata, data.metadata);
        return row;
      },
      updateMany: async ({ where, data }: { where: { metadata: { equals: unknown } }; data: Record<string, unknown> }) => {
        opts.beforeWrite?.(row.metadata);
        if (JSON.stringify(where.metadata.equals) !== JSON.stringify(row.metadata)) return { count: 0 };
        updates.push(data.metadata as Record<string, unknown>);
        Object.assign(row.metadata, data.metadata);
        return { count: 1 };
      },
    },
  };
  const service = new TplusSyncService(prisma as never, {} as never, {} as never, {} as never);
  const internal = service as never as Record<string, unknown>;
  internal.authRequest = opts.refreshBehavior ?? (async () => ({ access_token: 'new' }));
  if (opts.mintBehavior) internal.mintTokenByPermanentCode = opts.mintBehavior;
  const ensure = () => (internal.ensureOpenToken as () => Promise<string>).call(service);
  const anotherEnsure = (refreshBehavior: () => Promise<Record<string, unknown>>) => {
    const other = new TplusSyncService(prisma as never, {} as never, {} as never, {} as never) as any;
    other.authRequest = refreshBehavior;
    other.mintTokenByPermanentCode = internal.mintTokenByPermanentCode;
    return () => other.ensureOpenToken() as Promise<string>;
  };
  return { service, ensure, anotherEnsure, meta: row.metadata, updates };
}

test('并发续期只刷新一次，所有等待者使用同一组新令牌', async () => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const h = harness({ refreshBehavior: async () => {
    calls += 1;
    await gate;
    return { access_token: 'fresh-token', refresh_token: 'refresh-next', expires_in: 518400 };
  } });
  const first = h.ensure();
  const second = h.ensure();
  release();
  assert.deepEqual(await Promise.all([first, second]), ['fresh-token', 'fresh-token']);
  assert.equal(calls, 1);
  assert.equal(h.meta.refreshToken, 'refresh-next');
});

test('A 换新后 B 的旧刷新令牌被拒绝，B 不得清空 A 已保存的凭据', async () => {
  let rejectOld!: () => void;
  let started!: () => void;
  const oldStarted = new Promise<void>((resolve) => { started = resolve; });
  const staleRequest = new Promise<Record<string, unknown>>((_resolve, reject) => {
    rejectOld = () => reject(new TplusAuthError('invalid refresh token', false));
  });
  const h = harness({ refreshBehavior: async () => ({ access_token: 'fresh-token', refresh_token: 'refresh-next', expires_in: 518400 }) });
  const staleEnsure = h.anotherEnsure(() => { started(); return staleRequest; });
  const stale = staleEnsure();
  await oldStarted;
  assert.equal(await h.ensure(), 'fresh-token');
  rejectOld();
  await stale.catch(() => undefined);
  assert.equal(h.meta.openToken, 'fresh-token');
  assert.equal(h.meta.refreshToken, 'refresh-next');
  assert.equal(h.meta.authBrokenSince, null);
});

test('清理前最终读写间隙发生换新，原子条件必须阻止旧请求覆盖', async () => {
  const h = harness({
    refreshBehavior: async () => { throw new TplusAuthError('invalid refresh token', false); },
    beforeWrite: (metadata) => Object.assign(metadata, { openToken: 'newer-token', refreshToken: 'newer-refresh' }),
  });
  await assert.rejects(h.ensure(), /invalid refresh token/);
  assert.equal(h.meta.openToken, 'newer-token');
  assert.equal(h.meta.refreshToken, 'newer-refresh');
  assert.equal(h.meta.authBrokenSince, undefined);
});

test('旧刷新响应晚于人工重新授权到达，不得覆盖新授权或继续重试、自愈', async () => {
  let started!: () => void;
  let release!: (result: Record<string, unknown>) => void;
  const pending = new Promise<Record<string, unknown>>((resolve) => { release = resolve; });
  const requested = new Promise<void>((resolve) => { started = resolve; });
  let calls = 0;
  let mints = 0;
  const h = harness({
    refreshBehavior: async () => {
      if (++calls === 1) { started(); return pending; }
      return { access_token: 'authorized-token', refresh_token: 'authorized-refresh', org_id: 'new-org' };
    },
    mintBehavior: async () => { mints += 1; return 'minted-token'; },
  });
  const stale = h.ensure();
  await requested;
  await h.service.exchangeAuthCode({ code: 'new-code' });
  release({ access_token: 'stale-token', refresh_token: 'stale-refresh', org_id: 'old-org' });
  await assert.rejects(stale, /配置已更新/);
  assert.equal(h.meta.openToken, 'authorized-token');
  assert.equal(h.meta.refreshToken, 'authorized-refresh');
  assert.equal(h.meta.orgId, 'new-org');
  assert.equal(calls, 2, '冲突不应重试已使用的刷新令牌');
  assert.equal(mints, 0, '冲突不应触发永久授权码自愈');
  assert.equal(h.updates.length, 1);
});

test('授权码交换期间应用配置改变，响应不得写入新应用的配置', async () => {
  const h = harness({ refreshBehavior: async () => {
    h.meta.appKey = 'another-app';
    return { access_token: 'stale-token', refresh_token: 'stale-refresh' };
  } });
  await assert.rejects(h.service.exchangeAuthCode({ code: 'old-code' }), /配置已更新/);
  assert.equal(h.meta.appKey, 'another-app');
  assert.equal(h.meta.openToken, 'old-token');
  assert.equal(h.updates.length, 0);
});

test('成功续期最终读写间隙发生换新，原子条件必须阻止覆盖', async () => {
  let calls = 0;
  const h = harness({
    refreshBehavior: async () => { calls += 1; return { access_token: 'stale-token' }; },
    beforeWrite: (metadata) => Object.assign(metadata, { openToken: 'newer-token', refreshToken: 'newer-refresh' }),
  });
  await assert.rejects(h.ensure(), /配置已更新/);
  assert.equal(h.meta.openToken, 'newer-token');
  assert.equal(h.meta.refreshToken, 'newer-refresh');
  assert.equal(h.updates.length, 0);
  assert.equal(calls, 1);
});

test('刷新请求新增留痕不算授权冲突，保存时保留最新日志与同步设置', async () => {
  const h = harness({ refreshBehavior: async () => {
    h.meta.callLog = [{ kind: 'auth', ok: true }];
    h.meta.autoSync = false;
    return { access_token: 'fresh-token', refresh_token: 'fresh-refresh' };
  } });
  assert.equal(await h.ensure(), 'fresh-token');
  assert.deepEqual(h.meta.callLog, [{ kind: 'auth', ok: true }]);
  assert.equal(h.meta.autoSync, false);
});

for (const refreshToken of ['', 'refresh-abc']) {
  test(`永久授权码自愈晚于新授权完成，不覆盖新凭据（${refreshToken ? '刷新失败后' : '无刷新令牌'}）`, async () => {
    const h = harness({
      meta: { refreshToken, appTicket: 'ticket', orgPermanentAuthCode: 'org-code', userAuthPermanentCode: 'user-code' },
      refreshBehavior: async () => { throw new TplusAuthError('invalid refresh token', false); },
    });
    const internal = h.service as unknown as Record<string, unknown>;
    internal.fetchAppAccessToken = async () => 'app-token';
    internal.authPost = async (path: string) => {
      if (path.endsWith('getOrgAccessToken')) return { orgAccessToken: 'org-token' };
      Object.assign(h.meta, { openToken: 'authorized-token', refreshToken: 'authorized-refresh' });
      return { access_token: 'stale-minted-token', refresh_token: 'stale-minted-refresh' };
    };
    await assert.rejects(h.ensure(), /配置已更新/);
    assert.equal(h.meta.openToken, 'authorized-token');
    assert.equal(h.meta.refreshToken, 'authorized-refresh');
    assert.equal(h.meta.authBrokenSince, undefined);
    assert.equal(h.updates.length, 0);
  });
}

test('永久授权码自愈正常保存令牌，并保留请求期间轮换的 appTicket', async () => {
  const h = harness({
    meta: { refreshToken: '', appTicket: 'ticket', orgPermanentAuthCode: 'org-code', userAuthPermanentCode: 'user-code' },
  });
  const internal = h.service as unknown as Record<string, unknown>;
  internal.fetchAppAccessToken = async () => 'app-token';
  internal.authPost = async (path: string) => {
    if (path.endsWith('getOrgAccessToken')) return { orgAccessToken: 'org-token' };
    h.meta.appTicket = 'rotated-ticket';
    return { access_token: 'minted-token', refresh_token: 'minted-refresh' };
  };
  assert.equal(await h.ensure(), 'minted-token');
  assert.equal(h.meta.refreshToken, 'minted-refresh');
  assert.equal(h.meta.appTicket, 'rotated-ticket');
  assert.equal(h.meta.authBrokenSince, null);
  assert.equal(h.updates.length, 1);
});

test('续期结束后释放合并请求，后续失效仍能再次刷新', async () => {
  let calls = 0;
  const h = harness({ refreshBehavior: async () => ({ access_token: `fresh-${++calls}`, refresh_token: `next-${calls}`, expires_in: 518400 }) });
  assert.equal(await h.ensure(), 'fresh-1');
  h.meta.openTokenExpireAt = 0;
  assert.equal(await h.ensure(), 'fresh-2');
});

test('网络抖动不再清空凭证——这正是线上那次断链的成因', async () => {
  let calls = 0;
  const h = harness({
    refreshBehavior: async () => {
      calls += 1;
      throw new TplusAuthError('畅捷通鉴权请求失败：fetch failed', true);
    },
  });

  await assert.rejects(() => h.ensure(), /fetch failed/);
  assert.equal(calls, 3, '瞬时故障应退避重试两次再放弃');
  assert.equal(h.meta.refreshToken, 'refresh-abc', 'refreshToken 必须原样保留，否则要人工重新授权');
  assert.equal(h.meta.openToken, 'old-token');
  assert.equal(h.meta.authBrokenSince, undefined, '没被平台否定就不该标记为断链');
  assert.equal(h.updates.length, 0, '整个过程不应写库');
});

test('平台明确否定令牌时才清空，并记下断链时刻', async () => {
  const h = harness({
    refreshBehavior: async () => {
      throw new TplusAuthError('畅捷通鉴权失败：invalid refresh token', false);
    },
  });

  await assert.rejects(() => h.ensure(), /invalid refresh token/);
  assert.equal(h.meta.refreshToken, '');
  assert.equal(h.meta.openToken, '');
  assert.equal(typeof h.meta.authBrokenSince, 'string', '断链时刻要落库，供告警与「已连续 N 天」判定');
  assert.match(String(h.meta.authBrokenReason), /invalid refresh token/);
});

test('明确拒绝不重试——重试只会更快耗尽平台限额', async () => {
  let calls = 0;
  const h = harness({
    refreshBehavior: async () => {
      calls += 1;
      throw new TplusAuthError('畅捷通鉴权失败：unauthorized', false);
    },
  });
  await assert.rejects(() => h.ensure());
  assert.equal(calls, 1);
});

test('第一次瞬时失败后重试成功：令牌换新且不留断链痕迹', async () => {
  let calls = 0;
  const h = harness({
    refreshBehavior: async () => {
      calls += 1;
      if (calls === 1) throw new TplusAuthError('fetch failed', true);
      return { access_token: 'fresh-token', refresh_token: 'refresh-next', expires_in: 518400 };
    },
  });

  const token = await h.ensure();
  assert.equal(token, 'fresh-token');
  assert.equal(h.meta.refreshToken, 'refresh-next', 'refreshToken 轮转必须落库');
  assert.equal(h.meta.authBrokenSince, null, '成功续期即视为恢复，清掉告警标记');
  assert.equal(h.meta.authAlertSentAt, null);
});

test('令牌仍新鲜时直接返回，不打扰平台', async () => {
  let calls = 0;
  const h = harness({
    meta: { openTokenExpireAt: Date.now() + 5 * 24 * 3600 * 1000 },
    refreshBehavior: async () => { calls += 1; return { access_token: 'x' }; },
  });
  assert.equal(await h.ensure(), 'old-token');
  assert.equal(calls, 0);
});

test('刷新失败但永久授权码自愈成功时，不清空也不告警', async () => {
  const h = harness({
    refreshBehavior: async () => { throw new TplusAuthError('unauthorized', false); },
    mintBehavior: async () => 'minted-token',
  });
  assert.equal(await h.ensure(), 'minted-token');
  assert.equal(h.meta.refreshToken, 'refresh-abc', '自愈成功就不该动原有凭证');
  assert.equal(h.meta.authBrokenSince, undefined);
});

test('错误分类：未知异常按瞬时处理，宁可留着死令牌也不误清有效令牌', () => {
  assert.equal(isTransientAuthFailure(new TplusAuthError('x', true)), true);
  assert.equal(isTransientAuthFailure(new TplusAuthError('x', false)), false);
  // fetch 抛的是裸 TypeError，不带分类信息
  assert.equal(isTransientAuthFailure(new TypeError('fetch failed')), true);
  assert.equal(isTransientAuthFailure(undefined), true);
});
