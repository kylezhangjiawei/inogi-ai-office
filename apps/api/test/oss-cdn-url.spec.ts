import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { OssService } from '../src/modules/oss/oss.service';
import {
  canInlineAttachment,
  isActiveAttachmentContent,
  isBlockedProgressAttachment,
} from '../src/modules/research-development/attachment-security';

function makeService(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
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
