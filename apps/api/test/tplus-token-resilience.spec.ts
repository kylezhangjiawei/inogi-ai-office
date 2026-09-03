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
      findFirst: async () => row,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data.metadata as Record<string, unknown>);
        Object.assign(row.metadata, data.metadata);
        return row;
      },
    },
  };
  const service = new TplusSyncService(prisma as never, {} as never, {} as never, {} as never);
  const internal = service as never as Record<string, unknown>;
  internal.authRequest = opts.refreshBehavior ?? (async () => ({ access_token: 'new' }));
  internal.mintTokenByPermanentCode = opts.mintBehavior
    ?? (async () => { throw new Error('缺少永久授权码'); });
  const ensure = () => (internal.ensureOpenToken as () => Promise<string>).call(service);
  return { service, ensure, meta: row.metadata, updates };
}

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
