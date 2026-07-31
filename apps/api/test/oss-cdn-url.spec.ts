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
