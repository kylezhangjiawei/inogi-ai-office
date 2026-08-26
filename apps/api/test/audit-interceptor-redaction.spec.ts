import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { AuditInterceptor } from '../src/modules/audit/audit.interceptor';

/**
 * 留痕拦截器把请求体整体落库，凭据必须先抹掉。
 *
 * 这不是假设：本地库里 auth 模块有 474 条 refresh 记录存了明文 refreshToken、
 * 7 条 login 记录存了 encryptedPassword。刷新令牌是 bearer 凭据，落在留痕表里
 * 等于给了一份可离线利用的副本（备份、只读库、任意一处 SQL 注入都能取到）。
 */
const sanitize = (body: unknown, resource = 'auth') =>
  (Object.create(AuditInterceptor.prototype) as any).sanitizeMeta(body, resource) as Record<string, unknown>;

test('登录请求体里的口令不落库', () => {
  const meta = sanitize({ account: 'alex', password: 'p@ssw0rd', encryptedPassword: 'ZW5j...' });
  assert.equal(meta.account, 'alex', '非敏感字段照常保留，否则留痕就没内容了');
  assert.equal(meta.password, '[redacted]');
  assert.equal(meta.encryptedPassword, '[redacted]', '驼峰写法也要命中');
});

test('刷新令牌不落库', () => {
  const meta = sanitize({ refreshToken: 'abc123', refresh_token: 'abc123' });
  assert.equal(meta.refreshToken, '[redacted]');
  assert.equal(meta.refresh_token, '[redacted]');
});

test('各种凭据键名都覆盖到', () => {
  const meta = sanitize({
    apiKey: 'k', api_key: 'k', accessToken: 't', secret: 's',
    clientSecret: 's', credential: 'c', Authorization: 'Bearer x',
  });
  for (const [key, value] of Object.entries(meta)) {
    assert.equal(value, '[redacted]', `${key} 应被抹掉`);
  }
});

test('抹敏感键不影响原有的体积裁剪逻辑', () => {
  const meta = sanitize({ prompt: '一只柯基', password: 'x' }, 'image-generation');
  assert.equal(meta.password, '[redacted]');
  assert.equal(meta.prompt, undefined, 'image-generation 的 prompt 仍按原逻辑改存长度与前缀');
  assert.equal(meta.prompt_length, 4);
});

test('请求体不是对象时返回空对象，不抛', () => {
  assert.deepEqual(sanitize(null), {});
  assert.deepEqual(sanitize('raw-string'), {});
});

test('嵌套结构里的凭据同样抹掉', () => {
  const meta = sanitize({
    account: 'alex',
    auth: { token: 'abc', nested: { refreshToken: 'def' } },
    items: [{ apiKey: 'k1' }, { name: '正常字段' }],
  });
  const auth = meta.auth as { token: string; nested: { refreshToken: string } };
  assert.equal(auth.token, '[redacted]');
  assert.equal(auth.nested.refreshToken, '[redacted]', '两层以下也要命中');
  const items = meta.items as Array<Record<string, unknown>>;
  assert.equal(items[0].apiKey, '[redacted]', '数组元素里的凭据也要抹');
  assert.equal(items[1].name, '正常字段', '正常字段不受影响');
});

test('AI 用量的 token 计数不能被误抹', () => {
  // 实测存量里有 55 条这样的记录：totalTokens 是计数不是凭据，
  // 按子串匹配 'token' 会把正常审计数据抹成 [redacted]
  const meta = sanitize({
    usage: { totalTokens: 1234, inputTokens: 900, outputTokens: 334, inputImageTokens: 12 },
    accessToken: 'real-credential',
  });
  const usage = meta.usage as Record<string, unknown>;
  assert.equal(usage.totalTokens, 1234);
  assert.equal(usage.inputTokens, 900);
  assert.equal(usage.inputImageTokens, 12);
  assert.equal(meta.accessToken, '[redacted]', '真正的凭据仍要抹');
});

test('appSecret 这类词根写法要命中', () => {
  const meta = sanitize({ appSecret: 's', appId: 'id-not-a-secret' });
  assert.equal(meta.appSecret, '[redacted]');
  assert.equal(meta.appId, 'id-not-a-secret');
});
