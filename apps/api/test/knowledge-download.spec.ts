import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { NotFoundException } from '@nestjs/common';
import { OssService } from '../src/modules/oss/oss.service';
import { DeptKnowledgeController } from '../src/modules/research-development/dept-knowledge.controller';
import { ResearchDevelopmentController } from '../src/modules/research-development/research-development.controller';
import { ResearchDevelopmentService } from '../src/modules/research-development/research-development.service';

const objectKey = 'prod/rd/knowledge/2026/07/28/old-串口工具.exe';
const expiredUrl = `https://example-private-bucket.oss-cn-beijing.aliyuncs.com/${encodeURI(objectKey)}?Expires=1787816443&Signature=expired`;

function harness(overrides: Record<string, unknown> = {}) {
  const stored = {
    id: 'entry-1', title: '串口工具', file_name: '串口工具.exe',
    permission_level: 20, visibility: 'internal', archived: false,
    oss_url: expiredUrl, ...overrides,
  };
  const config: Record<string, string> = {
    OSS_REGION: 'oss-cn-beijing', OSS_BUCKET: 'example-private-bucket',
    OSS_ACCESS_KEY_ID: 'test-access-key', OSS_ACCESS_KEY_SECRET: 'test-access-secret',
    OSS_PREVIEW_SECRET: 'test-preview-secret',
  };
  // Real local signing with dummy credentials; these tests never contact OSS or a database.
  const oss = new OssService({ get: (key: string) => config[key] } as never);
  oss.onModuleInit();
  const reads: string[] = [];
  const service = Object.create(ResearchDevelopmentService.prototype) as ResearchDevelopmentService;
  Object.assign(service, {
    ossService: oss,
    readValue: async (key: string) => { reads.push(key); return [structuredClone(stored)]; },
    writeValue: async () => { assert.fail('downloading must not rewrite stored entries'); },
    resolveViewerKbLevel: async () => 20,
    resolveDeptKbViewerLevel: async () => 20,
  });
  const read = (dept: boolean, manager = false) => {
    const req = { user: { id: 'member', permissions: [manager ? '*' : `page:${dept ? 'dept-kb-purchasing' : 'rd-knowledge-base'}`] } };
    return dept
      ? new DeptKnowledgeController(service, oss, {} as never).getEntry('purchasing', stored.id, req)
      : new ResearchDevelopmentController(service, oss, {} as never).getKnowledgeEntry(stored.id, req);
  };
  return { stored, oss, service, reads, read };
}

test('历史知识库文件每次读取详情都能取得有效下载签名，多年后仍可续签且不改存储', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-08T01:17:23Z') });
  for (const dept of [false, true]) {
    const h = harness();
    let previous = expiredUrl;
    for (const time of ['2026-09-08T01:17:23Z', '2026-10-09T01:17:23Z', '2030-09-08T01:17:23Z']) {
      t.mock.timers.setTime(Date.parse(time));
      const entry = await h.read(dept);
      const url = new URL(String(entry.oss_url));
      assert.notEqual(url.href, previous);
      assert.equal(decodeURIComponent(url.pathname), `/${objectKey}`);
      const remaining = Number(url.searchParams.get('Expires')) - Math.floor(Date.now() / 1000);
      assert.ok(remaining > 0 && remaining <= 3600, 'download signature must be valid now and bounded');
      assert.ok(url.searchParams.get('Signature'));
      assert.ok(entry.preview_url, 'existing preview remains available');
      assert.equal(entry.file_name, '串口工具.exe');
      previous = url.href;
    }
    assert.equal(h.stored.oss_url, expiredUrl);
    assert.deepEqual(h.reads, Array(3).fill(dept ? 'deptkb.purchasing.knowledgeEntries' : 'rd.knowledgeEntries'));
  }
});

test('知识库下载续签前执行当前权限校验，受限条目不生成签名', async () => {
  for (const dept of [false, true]) {
    const h = harness({ permission_level: 80 });
    let signs = 0;
    const originalSign = h.oss.getSignedUrl.bind(h.oss);
    h.oss.getSignedUrl = (...args) => { signs++; return originalSign(...args); };
    await assert.rejects(h.read(dept), NotFoundException);
    assert.equal(signs, 0);
    assert.ok((await h.read(dept, true)).oss_url);
    assert.equal(signs, 1);
  }
});

test('签名服务不可用时不返回已过期的历史下载地址', async () => {
  const h = harness();
  h.oss.getSignedUrl = () => null;
  assert.equal((await h.read(false)).oss_url, null);
});

test('知识库内嵌文件和外部链接保持原有内容，不调用 OSS 续签', async () => {
  for (const overrides of [
    { oss_url: null, data_url: 'data:text/plain;base64,aGVsbG8=' },
    { oss_url: null, external_url: 'https://example.com/manual' },
  ]) {
    const h = harness(overrides);
    h.oss.getSignedUrl = () => { assert.fail('non-OSS entries must not be signed'); };
    for (const dept of [false, true]) assert.deepEqual(await h.read(dept), h.stored);
  }
});
