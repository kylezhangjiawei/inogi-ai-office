import * as assert from 'node:assert/strict';
import { createCipheriv } from 'node:crypto';
import { test, type TestContext } from 'node:test';

import { TplusSyncService } from '../src/modules/procurement/tplus-sync.service';

const messageKey = '0123456789abcdef';
const appKey = 'integration-app';
function setMessageKey(t: TestContext, value: string) {
  const previous = process.env.TPLUS_MESSAGE_AES_KEY;
  process.env.TPLUS_MESSAGE_AES_KEY = value;
  t.after(() => {
    if (previous === undefined) delete process.env.TPLUS_MESSAGE_AES_KEY;
    else process.env.TPLUS_MESSAGE_AES_KEY = previous;
  });
}
function encrypted(body: Record<string, unknown>, key = messageKey) {
  const cipher = createCipheriv('aes-128-ecb', Buffer.from(key), null);
  return { encryptMsg: Buffer.concat([cipher.update(JSON.stringify(body)), cipher.final()]).toString('base64') };
}
function message(overrides: Record<string, unknown> = {}) {
  return { id: 'event-1', appKey, msgType: 'APP_TICKET', time: String(Date.now()), bizContent: { appTicket: 'legitimate-ticket' }, ...overrides };
}
function harness(meta: Record<string, unknown> = {}, beforeWrite?: (metadata: Record<string, unknown>) => void) {
  const row = { id: 'cfg-1', metadata: { appKey, appTicket: 'existing-ticket', refreshToken: 'existing-refresh', ...meta } };
  let writes = 0;
  const prisma = { integrationConfig: {
    findFirst: async () => structuredClone(row),
    update: async ({ data }: { data: { metadata: Record<string, unknown> } }) => {
      writes += 1;
      Object.assign(row.metadata, data.metadata);
      return row;
    },
    updateMany: async ({ where, data }: { where: { metadata: { equals: unknown } }; data: { metadata: Record<string, unknown> } }) => {
      beforeWrite?.(row.metadata);
      if (JSON.stringify(where.metadata.equals) !== JSON.stringify(row.metadata)) return { count: 0 };
      writes += 1;
      Object.assign(row.metadata, data.metadata);
      return { count: 1 };
    },
  } };
  return { service: new TplusSyncService(prisma as never, {} as never, { decryptFromStorage: () => 'test-app-secret' } as never, {} as never), meta: row.metadata, writes: () => writes };
}

test('未加密的 APP_TICKET/TEMP_AUTH_CODE 不能污染根凭据或通知记录', async (t) => {
  setMessageKey(t, messageKey);
  for (const body of [message(), message({ msgType: 'TEMP_AUTH_CODE', bizContent: { tempAuthCode: 'forged' } })]) {
    const h = harness();
    await assert.rejects(h.service.handlePlatformMessage(body), /加密|消息/);
    assert.equal(h.meta.appTicket, 'existing-ticket');
    assert.equal(h.writes(), 0);
  }
});

test('错误环境密钥、错误应用和破损密文均拒绝且不落库', async (t) => {
  setMessageKey(t, messageKey);
  for (const body of [encrypted(message(), 'abcdef0123456789'), encrypted(message({ appKey: 'other-app' })), { encryptMsg: 'invalid' }]) {
    const h = harness();
    await assert.rejects(h.service.handlePlatformMessage(body), /消息|应用/);
    assert.equal(h.writes(), 0);
  }
});

test('未配置平台环境密钥时拒绝回调，明确提示配置项', async (t) => {
  setMessageKey(t, '');
  const h = harness();
  await assert.rejects(h.service.handlePlatformMessage(encrypted(message())), /TPLUS_MESSAGE_AES_KEY/);
  assert.equal(h.writes(), 0);
});

test('官方 AES/ECB/PKCS5Padding 格式的 APP_TEST 和 APP_TICKET 可成功处理', async (t) => {
  setMessageKey(t, messageKey);
  const h = harness();
  assert.deepEqual(await h.service.handlePlatformMessage(encrypted(message({ msgType: 'APP_TEST', bizContent: { message: 'test' } }))), { result: 'success' });
  assert.deepEqual(await h.service.handlePlatformMessage(encrypted(message())), { result: 'success' });
  assert.equal(h.meta.appTicket, 'legitimate-ticket');
  assert.equal(h.meta.refreshToken, 'existing-refresh');
  assert.equal(h.writes(), 2);
});

test('迟到或重复的票据消息不能覆盖较新的有效票据', async (t) => {
  setMessageKey(t, messageKey);
  const time = Date.now();
  const h = harness();
  await h.service.handlePlatformMessage(encrypted(message({ time: String(time) })));
  const writes = h.writes();
  await h.service.handlePlatformMessage(encrypted(message({ time: String(time - 600000), bizContent: { appTicket: 'expired-ticket' } })));
  await h.service.handlePlatformMessage(encrypted(message({ time: String(time) })));
  assert.equal(h.meta.appTicket, 'legitimate-ticket');
  assert.equal(h.writes(), writes);
});

test('可解密官方文档的固定示例消息，兼容真实平台填充与编码', async (t) => {
  // https://open.chanjet.com/docs/file/guide/commonContent/jcwd-xxts/xxgs-jrzy
  setMessageKey(t, '1234567890123456');
  const h = harness({ appKey: 'FQa4kEGD' });
  const encryptMsg = 'E4M54v2CbwnbdG+quqWwgFGI5dgx3shx2gGZRiihvkQQLgbH12Y9/dJXO1/7H7QLL3H9fstismlYMLQrZxShEyknFJcLG96HbG4Cx/7gq4YMXgZJDI9Qvm1sH6H4arIHaPTSbHTkfaYo7fo6Sc3lwBMOpJHi33Os5u7DobPmqkzkuyoRxbTD4mZaSYleDcYuouQTdma+rubH5PPzg0+R09XsEHWkgF6cc+Ylh2w0N6590eJDNdQvoI4m7eSiWQCJo5nN5zXj/2QeQcYwIfdpmQ==';
  assert.deepEqual(await h.service.handlePlatformMessage({ encryptMsg }), { result: 'success' });
  assert.equal(h.writes(), 1);
});

test('合法企业授权消息仍完成永久授权码串链，通知留痕不保存临时码', async (t) => {
  setMessageKey(t, messageKey);
  const h = harness();
  const requests: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    requests.push(url);
    assert.equal(init.method, 'POST');
    assert.equal(new Headers(init.headers).get('appKey'), appKey);
    assert.equal(new Headers(init.headers).get('appSecret'), 'test-app-secret');
    if (url.endsWith('/auth/appAuth/getAppAccessToken')) {
      assert.deepEqual(JSON.parse(String(init.body)), { appTicket: 'existing-ticket' });
      return Response.json({ code: '200', result: { appAccessToken: 'app-access-token' } });
    }
    assert.equal(url, 'https://openapi.chanjet.com/auth/orgAuth/getPermanentAuthCode');
    assert.deepEqual(JSON.parse(String(init.body)), { appAccessToken: 'app-access-token', tempAuthCode: 'valid-temp-code' });
    return Response.json({ code: '200', result: { permanentAuthCode: 'permanent-code' } });
  });
  await h.service.handlePlatformMessage(encrypted(message({ msgType: 'TEMP_AUTH_CODE', bizContent: { tempAuthCode: 'valid-temp-code' } })));
  assert.equal((h.meta as Record<string, unknown>).orgPermanentAuthCode, 'permanent-code');
  assert.equal(requests.length, 2);
  assert.equal(h.writes(), 1, '完整鉴权链只在确认成功后提交一次 metadata');
  assert.doesNotMatch(JSON.stringify((h.meta as Record<string, unknown>).notifyLog), /valid-temp-code/);
});

test('接收消息期间凭据已轮转，回调不能用旧快照覆盖并要求平台重试', async (t) => {
  setMessageKey(t, messageKey);
  const h = harness({}, (meta) => { meta.refreshToken = 'rotated-refresh'; });
  await assert.rejects(h.service.handlePlatformMessage(encrypted(message())), /配置已更新/);
  assert.equal(h.meta.refreshToken, 'rotated-refresh');
  assert.equal(h.meta.appTicket, 'existing-ticket');
  assert.equal(h.writes(), 0);
});
