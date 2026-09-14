import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ResearchDevelopmentService,
  extractObjectKeysFromUrl,
} from '../src/modules/research-development/research-development.service';

const KEY = 'prod/rd/progress-notes/u1/2026/09/03/uuid-图纸A.pdf';
const OTHER = 'prod/rd/progress-notes/u1/2026/09/03/uuid-无人引用.pdf';

/**
 * 只搭出 deleteAttachmentObjectsIfUnreferenced 走到的那几处依赖：
 * 留痕存储（readValue）、采购附件表、OSS 删除。
 */
function harness(opts: {
  notes?: Record<string, unknown[]>;
  documentKeys?: string[];
  procAttachments?: Array<{ fileKey: string | null; fileUrl: string }>;
}) {
  const deleted: string[] = [];
  let queriedWhere: unknown = null;
  const prisma = {
    rdTechnicalDocumentVersion: { findMany: async () => (opts.documentKeys ?? []).map((fileKey) => ({ fileKey })) },
    procTaskAttachment: {
      findMany: async ({ where }: { where: unknown }) => {
        queriedWhere = where;
        return opts.procAttachments ?? [];
      },
    },
  };
  const service = Object.create(ResearchDevelopmentService.prototype) as ResearchDevelopmentService;
  Object.assign(service, {
    prisma,
    ossService: {
      deleteObject: async (key: string) => { deleted.push(key); },
      isKeyUnderBusinessType: () => true,
      verifyCleanupToken: () => true,
    },
  });
  (service as never as { getProgressNoteMap: () => Promise<unknown> }).getProgressNoteMap =
    async () => opts.notes ?? {};

  const run = (keys: string[]) =>
    (service as never as {
      deleteAttachmentObjectsIfUnreferenced: (a: Array<Record<string, unknown>>) => Promise<void>;
    }).deleteAttachmentObjectsIfUnreferenced(keys.map((k) => ({ object_key: k })));

  return { run, service, deleted, queriedWhere: () => queriedWhere };
}

test('采购任务仍在引用时，研发删留痕不再物理删除该对象', async () => {
  const h = harness({
    notes: {},
    procAttachments: [{ fileKey: KEY, fileUrl: 'https://cdn.example.com/whatever' }],
  });
  await h.run([KEY]);
  assert.deepEqual(h.deleted, [], '采购附件表里还挂着这个 key，删了就是死链且不可恢复');
});

test('历史采购附件 fileKey 为空、key 藏在预览 URL 的 key 参数里，同样算引用', async () => {
  const h = harness({
    notes: {},
    procAttachments: [{
      fileKey: null,
      fileUrl: `/api/oss-preview?key=${encodeURIComponent(KEY)}&exp=1&sig=abc`,
    }],
  });
  await h.run([KEY]);
  assert.deepEqual(h.deleted, [], '只认 fileKey 的话，最老最没备份的那批附件会被静默删掉');
});

test('历史采购附件的 key 在 URL 路径里且中文被百分号编码，也要认出来', async () => {
  const h = harness({
    notes: {},
    // 直连 OSS 的老地址：路径里带编码后的中文文件名
    procAttachments: [{ fileKey: null, fileUrl: `https://bucket.oss-cn.aliyuncs.com/${encodeURI(KEY)}` }],
  });
  await h.run([KEY]);
  assert.deepEqual(h.deleted, [], '按原始字符串包含匹配会漏掉编码过的中文名');
});

test('确实无人引用时照常删除，不能因为加了检查就永远不清理', async () => {
  const h = harness({ notes: {}, procAttachments: [] });
  await h.run([OTHER]);
  assert.deepEqual(h.deleted, [OTHER]);
});

test('一批里只剔除被引用的那些，其余照删', async () => {
  const h = harness({
    notes: {},
    procAttachments: [{ fileKey: KEY, fileUrl: '' }],
  });
  await h.run([KEY, OTHER]);
  assert.deepEqual(h.deleted, [OTHER]);
});

test('研发留痕自身仍引用时提前返回，不去查采购表', async () => {
  const h = harness({
    notes: { 'task-1': [{ attachments: [{ object_key: KEY }] }] },
    procAttachments: [],
  });
  await h.run([KEY]);
  assert.deepEqual(h.deleted, []);
  assert.equal(h.queriedWhere(), null, '留痕里已确认有人引用，没必要再打一次采购表');
});

test('查询同时捞精确命中与全部历史行，两代写法都在射程内', async () => {
  const h = harness({ notes: {}, procAttachments: [] });
  await h.run([KEY]);
  assert.deepEqual(h.queriedWhere(), { OR: [{ fileKey: { in: [KEY] } }, { fileKey: null }] });
});

test('URL 还原：查询参数、编码路径、脏输入', () => {
  assert.deepEqual(
    extractObjectKeysFromUrl(`/api/oss-preview?key=${encodeURIComponent(KEY)}&exp=1`),
    [KEY, 'api/oss-preview'],
    '两个候选都要给出：多认只是少删一个对象，少认会误删他人在用的文件',
  );
  assert.ok(extractObjectKeysFromUrl(`https://cdn.example.com/${encodeURI(KEY)}`).includes(KEY));
  assert.deepEqual(extractObjectKeysFromUrl(''), []);
  assert.deepEqual(extractObjectKeysFromUrl(null), []);
  assert.deepEqual(extractObjectKeysFromUrl('   '), []);
  // 非法百分号转义会让 decodeURIComponent 抛错，不能把整个删除流程带崩
  assert.deepEqual(extractObjectKeysFromUrl('https://x.com/%E4%BD%A0%'), []);
});


test('原留痕已删除但技术资料历史版本仍引用时，保留文件并只清理无引用对象', async () => {
  const h = harness({ notes: {}, procAttachments: [], documentKeys: [KEY] });
  await h.run([KEY, OTHER]);
  assert.deepEqual(h.deleted, [OTHER]);
});

test('上传失败清理也不能删掉已登记在技术资料历史版本中的对象', async () => {
  const h = harness({ documentKeys: [KEY] });
  const result = await h.service.cleanupUnregisteredProgressNoteUploads(
    [KEY, OTHER].map((objectKey) => ({ objectKey, originalname: '图纸.pdf', mimetype: 'application/pdf', size: 20 })),
    'u1',
  );
  assert.deepEqual(h.deleted, [OTHER]);
  assert.deepEqual(result, { success: true, deleted: 1, retained: 1 });
});
