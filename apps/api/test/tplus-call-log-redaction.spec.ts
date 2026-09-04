import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  TplusSyncService,
  redactTplusTarget,
  redactTplusText,
} from '../src/modules/procurement/tplus-sync.service';

/**
 * 这组用例守的是一条硬底线：T+ 调用留痕里不许出现任何可用凭证。
 *
 * 仓库里有过先例（241b80e）——477 条留痕明文存了刷新令牌，最后只能全量轮换。
 * 那次泄的是自家登录令牌；T+ 这边泄的会是整个畅捷通账套的访问凭证。
 */

const REFRESH = 'rt_9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c';
const SECRET = 'K7mP2xQ9vR3nL5wT';

test('刷新令牌挂在查询串上——留痕必须只剩路径', () => {
  const target = `/auth/v2/refreshToken?grantType=refresh_token&refreshToken=${REFRESH}`;
  const out = redactTplusTarget(target);
  assert.equal(out, '/auth/v2/refreshToken?grantType=refresh_token');
  assert.doesNotMatch(out, /rt_9f8e/, '刷新令牌一个字符都不能留');
});

test('白名单之外的参数连键带值一起丢，不留 key=*** 这种痕迹', () => {
  const out = redactTplusTarget('/auth/token?code=abc123&state=xyz&grantType=authorization_code');
  assert.equal(out, '/auth/token?grantType=authorization_code');
  assert.doesNotMatch(out, /abc123/, '授权码的值不能留');
  assert.doesNotMatch(out, /code=/, '授权码这个参数整个不该出现');
  assert.doesNotMatch(out, /state/);
});

test('分页参数保留——查性能问题要靠它，且本身无敏感性', () => {
  assert.equal(
    redactTplusTarget('/tplus/api/v2/PurchaseOrderOpenApi/FindVoucherList?pageIndex=3&pageSize=100'),
    '/tplus/api/v2/PurchaseOrderOpenApi/FindVoucherList?pageIndex=3&pageSize=100',
  );
});

test('无查询串、空串、异常输入都不炸', () => {
  assert.equal(redactTplusTarget('/auth/appAuth/getAppAccessToken'), '/auth/appAuth/getAppAccessToken');
  assert.equal(redactTplusTarget(''), '');
  assert.equal(redactTplusTarget('/x?'), '/x');
  assert.equal(redactTplusTarget('/x?onlyBad=1'), '/x');
});

test('平台把令牌回显在错误消息里时，文本也要抹掉', () => {
  const raw = `{"code":401,"msg":"invalid","access_token":"${REFRESH}","refresh_token":"${REFRESH}"}`;
  const out = redactTplusText(raw);
  assert.doesNotMatch(out, /rt_9f8e/, '响应体里的令牌同样不能落库');
  assert.match(out, /access_token/, '键名保留，便于看出平台回了什么结构');
  assert.match(out, /\*\*\*/);
});

test('appSecret / appTicket / 永久授权码都在抹除清单里', () => {
  for (const field of ['appSecret', 'appTicket', 'appAccessToken', 'userAuthPermanentCode', 'orgPermanentAuthCode']) {
    const out = redactTplusText(`${field}=${SECRET}&other=1`);
    assert.doesNotMatch(out, new RegExp(SECRET), `${field} 的值必须被抹掉`);
  }
  // 驼峰与下划线两种写法都要覆盖
  assert.doesNotMatch(redactTplusText(`"refresh_token": "${REFRESH}"`), /rt_9f8e/);
  assert.doesNotMatch(redactTplusText(`refreshToken: ${REFRESH}`), /rt_9f8e/);
});

test('留痕文本有长度上限，异常报文撑不爆 metadata', () => {
  assert.equal(redactTplusText('x'.repeat(5000)).length, 300);
  assert.equal(redactTplusText('x'.repeat(5000), 50).length, 50);
  assert.equal(redactTplusText(undefined), '');
  assert.equal(redactTplusText(null), '');
});

test('写入的留痕条目只含脱敏后的字段，且按上限截断', async () => {
  const row = { id: 'cfg-1', metadata: { callLog: [] } as Record<string, unknown> };
  const prisma = {
    integrationConfig: {
      findFirst: async () => row,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        row.metadata = data.metadata as Record<string, unknown>;
        return row;
      },
    },
  };
  const service = new TplusSyncService(prisma as never, {} as never, {} as never, {} as never);
  const record = (service as never as {
    recordTplusCall: (e: Record<string, unknown>) => Promise<void>;
  }).recordTplusCall.bind(service);

  await record({
    kind: 'auth',
    target: `/auth/v2/refreshToken?grantType=refresh_token&refreshToken=${REFRESH}`,
    ok: false,
    durationMs: 42,
    reason: `瞬时故障：{"refresh_token":"${REFRESH}"}`,
  });

  const serialized = JSON.stringify(row.metadata);
  assert.doesNotMatch(serialized, new RegExp(REFRESH), '整条 metadata 里都不能出现令牌');
  const entry = (row.metadata.callLog as Array<Record<string, unknown>>)[0];
  assert.equal(entry.target, '/auth/v2/refreshToken?grantType=refresh_token');
  assert.equal(entry.kind, 'auth');
  assert.equal(entry.ok, false);
  assert.equal(entry.durationMs, 42);
  assert.equal(typeof entry.at, 'string');

  // 超过上限时丢最旧的
  for (let i = 0; i < 60; i += 1) {
    await record({ kind: 'auth', target: `/auth/x${i}`, ok: true, durationMs: 1 });
  }
  const log = row.metadata.callLog as unknown[];
  assert.equal(log.length, 50);
  assert.equal((log[0] as Record<string, unknown>).target, '/auth/x59', '最新的排最前');
});

test('留痕写入失败不能影响同步——异常必须被吞掉', async () => {
  const prisma = {
    integrationConfig: {
      findFirst: async () => { throw new Error('数据库连接断了'); },
    },
  };
  const service = new TplusSyncService(prisma as never, {} as never, {} as never, {} as never);
  const record = (service as never as {
    recordTplusCall: (e: Record<string, unknown>) => Promise<void>;
  }).recordTplusCall.bind(service);
  await record({ kind: 'auth', target: '/auth/x', ok: true, durationMs: 1 });
});
