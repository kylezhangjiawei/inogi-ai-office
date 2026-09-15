import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { OssService } from '../src/modules/oss/oss.service';
import {
  canInlineAttachment,
  isActiveAttachmentContent,
  isBlockedProgressAttachment,
} from '../src/modules/research-development/attachment-security';

function makeService(overrides: Record<string, string | undefined> = {}) {
  const values: Record<string, string | undefined> = {
    OSS_REGION: 'oss-cn-beijing',
    OSS_BUCKET: 'example-private-bucket',
    OSS_ACCESS_KEY_ID: 'test-access-key',
    OSS_ACCESS_KEY_SECRET: 'test-access-secret',
    OSS_PUBLIC_ENDPOINT: 'oss-cn-beijing.aliyuncs.com',
    OSS_BASE_PREFIX: 'prod',
    OSS_CDN_DOMAIN: 'https://domain.example.com',
    OSS_CDN_AUTH_TYPE: 'A',
    OSS_CDN_AUTH_KEY: 'aliyuncdnexp1234',
    OSS_CDN_AUTH_TTL_SECONDS: '604800',
    OSS_CDN_URL_STABLE_SECONDS: '86400',
    CORS_ORIGIN: 'https://office.example.com',
    ...overrides,
  };
  const config = {
    get: (key: string) => values[key],
    getOrThrow: (key: string) => {
      const value = values[key];
      if (!value) throw new Error(`Missing ${key}`);
      return value;
    },
  };
  const service = new OssService(config as never);
  service.onModuleInit();
  return service;
}

test('generates Alibaba Cloud CDN Type A URLs that match the official signing example', () => {
  const originalNow = Date.now;
  Date.now = () => 1_444_435_200_000;
  try {
    const service = makeService();
    assert.equal(
      service.getCdnReadUrl('video/standard/test.mp4'),
      'https://domain.example.com/video/standard/test.mp4'
        + '?auth_key=1444435200-0-0-23bf85053008f5c0e791667a313e28ce',
    );
  } finally {
    Date.now = originalNow;
  }
});

test('keeps CDN URLs stable within the configured browser-cache window and preserves image variants', () => {
  const originalNow = Date.now;
  let now = 1_444_435_200_000;
  Date.now = () => now;
  try {
    const service = makeService();
    const process = 'image/resize,m_lfit,w_240/format,webp/quality,q_72';
    const first = service.getCdnReadUrl('prod/rd/中文 image.png', process);
    now += 6 * 3600 * 1000;
    const second = service.getCdnReadUrl('prod/rd/中文 image.png', process);

    assert.equal(second, first);
    const url = new URL(first!);
    assert.equal(url.pathname, '/prod/rd/%E4%B8%AD%E6%96%87%20image.png');
    assert.equal(url.searchParams.get('x-oss-process'), process);
    assert.match(url.searchParams.get('auth_key') ?? '', /^\d{10}-0-0-[a-f0-9]{32}$/);
  } finally {
    Date.now = originalNow;
  }
});

test('does not emit an unsigned CDN URL when the authentication key is missing', () => {
  const service = makeService({ OSS_CDN_AUTH_KEY: '' });
  assert.equal(service.getCdnReadUrl('prod/private/file.pdf'), null);
});

test('重新签发裸 key、OSS/CDN 历史直链和同源预览，中文空格百分号不重复解码且不残留旧签名', () => {
  const service = makeService();
  const key = 'prod/rd/中文 image 100% %25.png';
  const encoded = key.split('/').map(encodeURIComponent).join('/');
  const proxy = `/api/research-development/oss-preview?key=${encodeURIComponent(key)}&exp=1&sig=old-preview`;
  const sources = [
    key,
    `https://example-private-bucket.oss-cn-beijing.aliyuncs.com/${encoded}?Expires=1&OSSAccessKeyId=old-id&Signature=old-signature&security-token=old-token`,
    `https://domain.example.com/${encoded}?auth_key=1-0-0-old&Signature=old-signature`,
    proxy,
    `https://office.example.com${proxy}`,
  ];
  for (const source of sources) {
    const result = service.getReadUrl(source);
    assert.ok(result, source);
    const url = new URL(result.url);
    assert.equal(url.origin, 'https://domain.example.com');
    assert.equal(decodeURIComponent(url.pathname.slice(1)), key, source);
    assert.deepEqual(Array.from(url.searchParams.keys()), ['auth_key']);
    assert.notEqual(url.searchParams.get('auth_key'), '1-0-0-old');
    assert.ok(result.expiresIn > 0);
  }
});

test('保留历史缩略图处理参数，显式参数覆盖且不同尺寸生成独立读取地址', () => {
  const service = makeService();
  const original = 'image/resize,m_lfit,w_240/format,webp/quality,q_72';
  const replacement = 'image/resize,m_lfit,w_480/format,webp/quality,q_72';
  const oss = `https://example-private-bucket.oss-cn-beijing.aliyuncs.com/prod/rd/a.png?Expires=1&Signature=old&x-oss-process=${encodeURIComponent(original)}`;
  const proxy = `/api/research-development/oss-preview?key=prod%2Frd%2Fa.png&exp=1&sig=old&process=${encodeURIComponent(original)}`;
  for (const source of [oss, proxy]) {
    const historical = service.getReadUrl(source);
    const overridden = service.getReadUrl(source, 600, replacement);
    assert.ok(historical);
    assert.ok(overridden);
    assert.equal(new URL(historical.url).searchParams.get('x-oss-process'), original);
    assert.equal(new URL(overridden.url).searchParams.get('x-oss-process'), replacement);
    assert.notEqual(historical.url, overridden.url);
    assert.equal(new URL(historical.url).searchParams.has('Signature'), false);
  }
});

test('拒绝把未知外部 URL、其他 bucket 或非预览业务路由当成本桶对象重签', () => {
  const service = makeService();
  for (const source of [
    'https://external.example.com/prod/a.png',
    'https://other-bucket.oss-cn-beijing.aliyuncs.com/prod/a.png',
    'https://external.example.com/api/research-development/oss-preview?key=prod%2Fa.png',
    'https://office.example.com/api/other?key=prod%2Fa.png',
    '/api/other?key=prod%2Fa.png',
    '//external.example.com/prod/a.png',
    'data:image/png;base64,test',
    '',
  ]) {
    assert.equal(service.getReadUrl(source), null, source);
    assert.equal(service.resolveManagedReadSource(source), null, source);
  }
});

test('数据表附件代理可还原持久化 object key，并保留缩略图参数', () => {
  const service = makeService();
  const key = 'prod/rd/sheet-assets/中文 100%.png';
  const process = 'image/resize,w_320';
  const query = new URLSearchParams({ key, process, exp: '1', sig: 'old' });
  for (const source of [
    `/api/research-development/sheet-workbook/assets?${query}`,
    `https://office.example.com/api/research-development/sheet-workbook/assets?${query}`,
  ]) {
    assert.deepEqual(service.resolveManagedReadSource(source), { objectKey: key, process });
    const read = service.getReadUrl(source);
    assert.ok(read);
    assert.equal(decodeURIComponent(new URL(read.url).pathname.slice(1)), key);
  }
});

test('CDN object key 前导斜线不改变域名，拒绝会被 URL 标准化的点路径', () => {
  const service = makeService();
  for (const key of ['/prod/a.png', '//external.example.com/prod/a.png']) {
    const url = new URL(service.getCdnReadUrl(key)!);
    assert.equal(url.hostname, 'domain.example.com');
    assert.equal(url.pathname, `/${key.replace(/^\/+/, '')}`);
  }
  for (const key of ['prod/../a.png', 'prod/./a.png', '../a.png', '/prod/../a.png']) {
    assert.equal(service.getCdnReadUrl(key), null, key);
    assert.equal(service.getReadUrl(key), null, key);
  }
});

test('1800 秒鉴权在缺失或错误稳定窗口配置时仍有效，短 TTL 的默认窗口也必须被限制', (t) => {
  const now = 1_444_485_899;
  t.mock.method(Date, 'now', () => now * 1000);
  for (const stableWindow of [undefined, '', 'invalid']) {
    const service = makeService({ OSS_CDN_AUTH_TTL_SECONDS: '1800', OSS_CDN_URL_STABLE_SECONDS: stableWindow });
    const url = new URL(service.getCdnReadUrl('prod/a.png')!);
    const timestamp = Number(url.searchParams.get('auth_key')!.split('-')[0]);
    assert.ok(timestamp + 1800 - now >= 1500, `window=${String(stableWindow)}`);
  }
  const shortTtl = makeService({ OSS_CDN_AUTH_TTL_SECONDS: '60', OSS_CDN_URL_STABLE_SECONDS: undefined });
  const shortTimestamp = Number(new URL(shortTtl.getCdnReadUrl('prod/a.png')!).searchParams.get('auth_key')!.split('-')[0]);
  assert.ok(shortTimestamp + 60 > now, '缺失配置的 fallback 同样必须受 TTL 上限约束');
});

test('默认 1800/300 配置复用窗口内 URL，返回真实剩余有效期并在窗口边界换签', (t) => {
  let now = 1_444_435_200;
  t.mock.method(Date, 'now', () => now * 1000);
  const service = makeService({ OSS_CDN_AUTH_TTL_SECONDS: undefined, OSS_CDN_URL_STABLE_SECONDS: undefined });
  const first = service.getReadUrl('prod/a.png');
  assert.ok(first);
  assert.equal(first.expiresIn, 1800);
  now += 299;
  const lastInWindow = service.getReadUrl('prod/a.png');
  assert.ok(lastInWindow);
  assert.equal(lastInWindow.url, first.url);
  assert.equal(lastInWindow.expiresIn, 1501);
  now += 1;
  const nextWindow = service.getReadUrl('prod/a.png');
  assert.ok(nextWindow);
  assert.notEqual(nextWindow.url, first.url);
  assert.equal(nextWindow.expiresIn, 1800);
});

test('CDN 未启用或缺少 Key 时回退 OSS 签名，缓存重用仍返回剩余秒数并保留图片处理', (t) => {
  let now = 1_444_435_200;
  t.mock.method(Date, 'now', () => now * 1000);
  for (const override of [{ OSS_CDN_DOMAIN: '' }, { OSS_CDN_AUTH_KEY: '' }]) {
    const service = makeService(override);
    const process = 'image/resize,w_240';
    const signed = service.getSignedUrl('prod/rd/a.png', 600, process);
    const first = service.getReadUrl('prod/rd/a.png', 600, process);
    assert.ok(first);
    assert.equal(first.url, signed);
    const parsed = new URL(first.url);
    assert.equal(parsed.hostname, 'example-private-bucket.oss-cn-beijing.aliyuncs.com');
    assert.equal(parsed.searchParams.get('x-oss-process'), process);
    assert.equal(first.expiresIn, Number(parsed.searchParams.get('Expires')) - now);
    now += 30;
    const reused = service.getReadUrl('prod/rd/a.png', 600, process);
    assert.ok(reused);
    assert.equal(reused.url, first.url);
    assert.equal(reused.expiresIn, first.expiresIn - 30);
  }
});

test('启用 CDN 后上传 PUT 和显式 OSS 签名仍使用 OSS 公网域名', () => {
  const service = makeService();
  const get = service.getSignedUrl('prod/rd/a.png', 600);
  const put = service.generatePutSignedUrl('prod/rd/a.png', 'image/png', 600);
  assert.ok(get);
  assert.ok(put);
  for (const value of [get, put]) {
    const url = new URL(value);
    assert.equal(url.hostname, 'example-private-bucket.oss-cn-beijing.aliyuncs.com');
    assert.equal(url.searchParams.has('auth_key'), false);
    assert.ok(url.searchParams.get('Signature'));
  }
  assert.notEqual(get, put, 'PUT 必须保留方法及 Content-Type 签名');
});

test('separates cleanup capabilities from preview capabilities', () => {
  const service = makeService({ OSS_PREVIEW_SECRET: 'preview-test-secret' });
  const key = 'prod/rd/progress-notes/user/example.png';
  const cleanup = service.signCleanupToken(key, 300);
  const preview = service.signPreviewToken(key, 300);

  assert.equal(service.verifyCleanupToken(key, cleanup.exp, cleanup.sig), true);
  assert.equal(service.verifyPreviewToken(key, cleanup.exp, cleanup.sig), false);
  assert.equal(service.verifyCleanupToken(key, preview.exp, preview.sig), false);
  assert.equal(service.verifyCleanupToken(`${key}.other`, cleanup.exp, cleanup.sig), false);
});

test('blocks active attachment content and never previews it inline', () => {
  assert.equal(isBlockedProgressAttachment('report.html', 'text/plain'), true);
  assert.equal(isBlockedProgressAttachment('diagram.png', 'image/svg+xml'), true);
  assert.equal(isActiveAttachmentContent('payload.svg', 'application/octet-stream'), true);
  assert.equal(canInlineAttachment('notes.txt', 'text/plain; charset=utf-8'), true);
  assert.equal(canInlineAttachment('report.pdf', 'application/pdf'), true);
  assert.equal(canInlineAttachment('payload.html', 'text/html'), false);
});

test('从历史地址反解 OSS object key，覆盖代理地址 / 直链 / 裸 key 三种形态', () => {
  const service = makeService();

  // 转采购存下来的就是这种：key 藏在预览代理地址的 query 里
  assert.equal(
    service.extractObjectKey(
      '/api/research-development/oss-preview?key=prod%2Frd%2Fprogress-notes%2F2026%2F05%2F29%2Fabc-q7.png&exp=1784851200&sig=9e72',
    ),
    'prod/rd/progress-notes/2026/05/29/abc-q7.png',
  );
  // OSS / CDN 直链：key 在 path 上
  assert.equal(
    service.extractObjectKey('https://bucket.oss-cn-beijing.aliyuncs.com/prod/rd/a%20b.png?Expires=1&Signature=x'),
    'prod/rd/a b.png',
  );
  assert.equal(service.extractObjectKey('prod/rd/plain-key.png'), 'prod/rd/plain-key.png');
  // 相对路由不是对象键，不能拿去签名
  assert.equal(service.extractObjectKey('/api/research-development/oss-preview'), null);
  assert.equal(service.extractObjectKey(''), null);
  assert.equal(service.extractObjectKey(null), null);
  // 坏转义不能让整条取不到
  assert.equal(service.extractObjectKey('/api/x?key=prod%2Fbad%ZZ.png'), 'prod%2Fbad%ZZ.png');
});

test('内联预览地址优先走 CDN；未配 CDN 时退回代理并现签可验证的令牌', () => {
  const withCdn = makeService();
  const cdnUrl = withCdn.buildInlinePreviewUrl('prod/rd/a.png');
  assert.match(cdnUrl ?? '', /^https:\/\/domain\.example\.com\/prod\/rd\/a\.png\?/);
  assert.match(cdnUrl ?? '', /response-content-disposition=inline/);

  // 本地/未配 CDN：退回同源代理，且令牌当场可验证（旧数据打不开正是因为令牌过期）
  const noCdn = makeService({ OSS_CDN_DOMAIN: '', OSS_CDN_AUTH_KEY: '', OSS_PREVIEW_SECRET: 'preview-test-secret' });
  const proxyUrl = noCdn.buildInlinePreviewUrl('prod/rd/a.png');
  assert.match(proxyUrl ?? '', /^\/api\/research-development\/oss-preview\?/);
  const params = new URLSearchParams((proxyUrl ?? '').split('?')[1]);
  assert.equal(params.get('key'), 'prod/rd/a.png');
  assert.equal(
    noCdn.verifyPreviewToken('prod/rd/a.png', Number(params.get('exp')), params.get('sig') ?? ''),
    true,
    '重新构造的地址必须当场验签通过',
  );
});
