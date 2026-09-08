import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import * as OSS from 'ali-oss';
import JSZip = require('jszip');
import { ChatArchiveService } from '../src/modules/chat/chat-archive.service';
import { CatalogFile, ChatFileCatalogService, fileRef, matchesFile, normalizeFileFilter } from '../src/modules/chat/chat-file-catalog.service';
import { archiveLimits, csv, safeArchiveName, uniqueArchivePath } from '../src/modules/chat/chat-archive.utils';
import { ResearchDevelopmentService } from '../src/modules/research-development/research-development.service';
import { OssService } from '../src/modules/oss/oss.service';
import { ChatToolsService } from '../src/modules/chat/chat-tools.service';

const user = { userId: 'u1', name: '张三', permissions: ['*'] };
const file = (id: string, overrides: Partial<CatalogFile> = {}): CatalogFile => ({ id, source: 'task', scope: 'rd', resourceId: id,
  name: `${id}.png`, mime: 'image/png', size: 4, createdAt: '2026-09-07T08:00:00Z', uploader: '张三', folder: '项目A/子任务', revision: 'rev1', objectKey: id, ...overrides });

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([key, condition]: [string, any]) => {
    if (key === 'OR') return condition.some((c: any) => matches(row, c));
    if (key === 'AND') return condition.every((c: any) => matches(row, c));
    if (condition === null || typeof condition !== 'object' || condition instanceof Date) return row[key] === condition;
    return Object.entries(condition).every(([op, val]: [string, any]) => op === 'in' ? val.includes(row[key]) : op === 'gt' ? row[key] > val : op === 'gte' ? row[key] >= val : op === 'lte' ? row[key] !== null && row[key] <= val : op === 'not' ? row[key] !== val : false);
  });
}
function harness(initial: CatalogFile[] = [file('f1')]) {
  const jobs: any[] = [], selections: any[] = [], objects = new Map<string, Buffer>();
  let files = initial;
  let sequence = 0;
  let tail = Promise.resolve();
  let downloadStarted: (() => void) | undefined;
  const delegate = (rows: any[]) => ({
    findMany: async ({ where, take }: any) => rows.filter((r) => matches(r, where)).slice(0, take),
    findFirst: async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null,
    findUnique: async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null,
    count: async ({ where }: any) => rows.filter((r) => matches(r, where)).length,
    create: async ({ data }: any) => {
      const row = { id: `id${++sequence}`, createdAt: new Date(), updatedAt: new Date(), status: 'queued', processed: 0, succeeded: 0, failed: 0, bytes: 0n,
        report: null, objectKey: null, outputKeys: [], cancelRequested: false, claimToken: null, leaseUntil: null, error: null, attempts: 0, ...data };
      rows.push(row); return { ...row };
    },
    updateMany: async ({ where, data }: any) => {
      const selected = rows.filter((r) => matches(r, where));
      for (const row of selected) for (const [key, value] of Object.entries(data)) row[key] = value && typeof value === 'object' && 'increment' in value ? row[key] + (value as any).increment : value;
      return { count: selected.length };
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where)); assert.ok(row);
      for (const [key, value] of Object.entries(data)) row[key] = value && typeof value === 'object' && 'increment' in value ? row[key] + (value as any).increment : value;
      return { ...row };
    },
    deleteMany: async ({ where }: any) => { for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], where)) rows.splice(i, 1); return {}; },
  });
  const prisma: any = {
    chatFileSelection: delegate(selections), chatArchiveJob: delegate(jobs),
    chatConversation: { findFirst: async ({ where }: any) => where.id === 'conv' && where.userId === 'u1' ? { id: 'conv' } : null },
    user: { findUnique: async () => ({ id: 'u1', name: '张三', status: 'ACTIVE', role: { permissions: ['*'] } }) },
    $executeRaw: async () => 1,
    $transaction: (fn: any) => { const run = tail.then(() => fn(prisma)); tail = run.then(() => undefined, () => undefined); return run; },
  };
  const catalog = { collect: async () => ({ files, warnings: [] }), resolve: async () => new Map(files.map((f) => [f.id, f])) };
  const oss = {
    isEnabled: true, buildObjectKey: (_prefix: string, name: string) => `test/chat-archives/${name}`,
    getObjectStream: async (key: string) => { downloadStarted?.(); return key === 'missing' ? null : { stream: Readable.from([Buffer.from(key === 'same' ? 'same' : key)]), size: 4 }; },
    uploadArchiveFile: async (key: string, path: string, signal: AbortSignal) => { signal.throwIfAborted(); objects.set(key, await readFile(path)); },
    deleteArchiveObject: async (key: string) => { objects.delete(key); },
    getArchiveDownloadUrl: (key: string, filename: string) => { assert.ok(filename.endsWith('.zip')); return `https://example.invalid/${key}`; },
  };
  const createService = () => new ChatArchiveService(prisma, catalog as never, oss as never, { filterDisabled: async (value: unknown) => value } as never);
  const service = createService();
  const queue = async (args: Record<string, unknown> = {}) => {
    const selection = await service.search({}, user, 'conv');
    return service.create({ selection_ids: [selection.selectionId], ...args }, user, 'conv');
  };
  const run = async (id: string) => { const row = jobs.find((j) => j.id === id); Object.assign(row, { status: 'running', claimToken: 'claim', leaseUntil: new Date(Date.now() + 90000) }); await service.process({ ...row }); return row; };
  return { service, createService, prisma, catalog, oss, jobs, selections, objects, queue, run, setFiles: (value: CatalogFile[]) => { files = value; }, onDownload: (fn: () => void) => { downloadStarted = fn; } };
}

test('日期、关键词、类型、子任务过滤，不把无效日期或跨来源项目范围默默忽略', () => {
  const value = file('a', { ancestorIds: ['parent', 'child'] });
  assert.ok(matchesFile(value, normalizeFileFilter({ sources: ['task'], task_ids: ['parent'], types: ['image'], date_from: '2026-09-07', date_to: '2026-09-07' })));
  assert.equal(matchesFile(value, normalizeFileFilter({ query: '其他' })), false);
  assert.equal(matchesFile(value, normalizeFileFilter({ date_to: '2026-09-06' })), false);
  assert.equal(matchesFile(file('x', { createdAt: '2026-09-06T16:00:00Z' }), normalizeFileFilter({ date_from: '2026-09-07' })), true);
  assert.ok(matchesFile(file('x', { name: '合同.pdf', mime: 'application/octet-stream' }), normalizeFileFilter({ types: ['document'] })));
  assert.ok(matchesFile(file('x', { name: '录音.m4a', mime: 'application/octet-stream' }), normalizeFileFilter({ types: ['audio'] })));
  for (const args of [{ date_from: '2026-02-30' }, { sources: ['unknown'] }, { sources: ['image'], project: 'A' }, { date_from: '2026-09-08', date_to: '2026-09-07' }]) assert.throws(() => normalizeFileFilter(args));
});

test('包内路径去除穿越/控制符/保留设备名，重名大小写不覆盖，CSV 防公式注入', () => {
  const used = new Set<string>();
  const first = uniqueArchivePath('../../测试\\目录', '../CON.txt', used);
  assert.ok(!first.split('/').some((part) => part === '..'));
  assert.ok(!first.includes('\\'));
  assert.equal(safeArchiveName('CON.txt'), '_CON.txt');
  const longName = safeArchiveName('图片'.repeat(100) + '.jpeg');
  assert.ok(Buffer.byteLength(longName) <= 180); assert.ok(longName.endsWith('.jpeg'));
  assert.notEqual(uniqueArchivePath('', 'Test.PNG', used), uniqueArchivePath('', 'test.png', used));
  assert.match(csv([['=HYPERLINK("bad")', '+1', '普通文本']]), /'=HYPERLINK/);
});

test('全量快照与30条预览分离：一次打包包含所有结果，模型响应不含对象键或原始数据', async () => {
  const h = harness(Array.from({ length: 45 }, (_, i) => file(`f${i}`)));
  const found = await h.service.search({}, user, 'conv');
  assert.equal(found.files.length, 30); assert.equal(found.total, 45);
  assert.ok(!('objectKey' in found.files[0])); assert.ok(!('revision' in found.files[0]));
  const job = await h.service.create({ selection_ids: [found.selectionId] }, user, 'conv');
  assert.equal(job.total, 45);
  const page = await h.service.selection(found.selectionId!, 'u1', 'conv', 30);
  assert.equal(page.files.length, 15);
});

test('同时重复提交幂等，多次检索合并去重；伪造文件编号、越权会话及过期快照被拒', async () => {
  const h = harness();
  const a = await h.service.search({}, user, 'conv'), b = await h.service.search({}, user, 'conv');
  const args = { selection_ids: [a.selectionId, b.selectionId] };
  const [first, second] = await Promise.all([h.service.create(args, user, 'conv'), h.createService().create(args, user, 'conv')]);
  assert.equal(first.id, second.id); assert.equal(first.total, 1);
  await assert.rejects(h.service.create({ ...args, file_ids: ['invented'] }, user, 'conv'));
  await assert.rejects(h.service.selection(a.selectionId!, 'other', 'conv'));
  await assert.rejects(h.service.create(args, user, 'other-conv'));
  h.selections[0].expiresAt = new Date(0);
  await assert.rejects(h.service.create(args, user, 'conv'));
});

test('超限查询不给可打包快照，已知过大文件在排队前被拒', async () => {
  const h = harness(Array.from({ length: archiveLimits().maxFiles + 1 }, (_, i) => file(`f${i}`)));
  assert.equal((await h.service.search({}, user, 'conv')).selectionId, null);
  assert.equal(h.selections.length, 0);
  h.setFiles([file('big', { size: archiveLimits().maxFileBytes + 1 })]);
  await assert.rejects(h.queue(), /上限/);
});

test('真实 ZIP 字节完整：重名保留、同内容去重、缺失文件进入失败清单，部分成功可下载', async () => {
  const h = harness([file('a', { name: '报告.txt', objectKey: 'same' }), file('b', { name: '报告.txt', objectKey: 'different' }), file('c', { objectKey: 'same' }), file('d', { objectKey: 'missing' })]);
  const queued = await h.queue();
  const job = await h.run(queued.id);
  assert.equal(job.status, 'partial'); assert.equal(job.failed, 1); assert.equal(job.succeeded, 3);
  const zip = await JSZip.loadAsync(h.objects.get(job.objectKey)!);
  const names = Object.keys(zip.files).filter((name) => !zip.files[name].dir);
  assert.equal(names.length, 4); // 两个真实文件 + 清单 + 说明
  assert.ok(names.some((name) => name.includes('(2)')));
  const manifest = await zip.file('文件清单.csv')!.async('string');
  assert.match(manifest, /内容相同/); assert.match(manifest, /原文件不存在/);
  assert.ok((await h.service.download(job.id, 'u1')).url);
  h.setFiles([]);
  await assert.rejects(h.service.download(job.id, 'u1'), /权限已调整/);
});

test('检索后文件被替换不会打包旧引用；全部失败时没有空成功ZIP', async () => {
  const h = harness(); const queued = await h.queue();
  h.setFiles([file('f1', { revision: 'changed' })]);
  const job = await h.run(queued.id);
  assert.equal(job.status, 'failed'); assert.equal(job.report[0].status, 'failed'); assert.equal(h.objects.size, 0);
});

test('执行中取消不发布文件；取消后可重试；过期成果被清理', async () => {
  const h = harness(); const queued = await h.queue();
  h.onDownload(() => { void h.service.cancel(queued.id, 'u1'); });
  const job = await h.run(queued.id);
  assert.equal(job.status, 'canceled'); assert.equal(h.objects.size, 0);
  h.onDownload(() => {});
  await h.service.retry(queued.id, 'u1');
  await h.run(queued.id);
  assert.equal(job.status, 'succeeded');
  job.expiresAt = new Date(0);
  await assert.rejects(h.service.download(job.id, 'u1'));
  await h.service.cleanup(); assert.equal(h.objects.size, 0); assert.equal(h.jobs.length, 0);
});

test('未知大小的实际超限数据受到流式计数限制，不能仅信任元数据', async () => {
  const h = harness([file('large', { size: 0 })]);
  h.oss.getObjectStream = async () => ({ size: archiveLimits().maxFileBytes + 1, stream: Readable.from(['small']) });
  const queued = await h.queue(); const job = await h.run(queued.id);
  assert.equal(job.status, 'failed'); assert.equal(job.report[0].error, '文件超过大小上限');
});

test('256 MiB 文件经流式读取、磁盘暂存和流式 ZIP 完整处理', async () => {
  const bytes = 256 * 1024 * 1024;
  const h = harness([file('large', { size: bytes })]);
  h.oss.getObjectStream = async () => ({ size: bytes, stream: Readable.from((async function* () {
    for (let i = 0; i < 256; i++) yield Buffer.alloc(1024 * 1024, i);
  })()) });
  let uploadedSize = 0;
  h.oss.uploadArchiveFile = async (_key, path) => { uploadedSize = (await stat(path)).size; };
  const queued = await h.queue(); const job = await h.run(queued.id);
  assert.equal(job.status, 'succeeded'); assert.equal(job.report[0].bytes, bytes);
  assert.ok(uploadedSize > bytes && uploadedSize < bytes + 10000);
});

test('源文件读取失败不会中止其余文件；上传失败是可见失败而不是成功链接', async () => {
  const h = harness(); h.oss.uploadArchiveFile = async () => { throw new Error('OSS 连接中断'); };
  const queued = await h.queue(); const job = await h.run(queued.id);
  assert.equal(job.status, 'failed'); await assert.rejects(h.service.download(job.id, 'u1'));
});

test('多实例只领取一次；失效租约可恢复；旧执行者不能覆盖新执行结果', async () => {
  const h = harness(); await h.queue();
  let claims = 0;
  const first = h.service, second = h.createService();
  first.process = second.process = async () => { claims++; };
  await Promise.all([first.tick(), second.tick()]); assert.equal(claims, 1);
  h.jobs[0].leaseUntil = new Date(0);
  await second.tick(); assert.equal(claims, 2);
  const old = { ...h.jobs[0], claimToken: 'old-token' };
  const real = h.createService(); await real.process(old);
  assert.equal(h.jobs[0].status, 'running'); assert.notEqual(h.jobs[0].claimToken, 'old-token');
  assert.equal(h.objects.size, 0);
});

test('批量任务附件复用参与人/本人留痕权限，祖先标题与分类包含子任务且不重复', async () => {
  const rd = Object.create(ResearchDevelopmentService.prototype) as any;
  const root = { task_id: 'parent', title: '项目A', owner_id: 'u1', owner: '张三', subtasks: [{ task_id: 'child', title: '子任务', owner_id: 'u2', owner: '李四' }] };
  Object.assign(rd, {
    getProgressNoteMap: async () => ({ parent: [{ id: 'n1', task_id: 'parent', actor: { id: 'u1' }, attachments: [{ id: 'a', name: 'a.png' }] }], child: [{ id: 'n2', task_id: 'child', actor: { id: 'u2' }, attachments: [{ id: 'b', name: 'b.png' }] }] }),
    readMergedTaskCategories: async () => [{ label: '主产品', children: [{ label: '研发', tasks: [root] }] }],
    decorateNotesWithPreview: (notes: unknown[]) => notes, taskAttachmentsMutable: () => false,
  });
  const mine = await rd.listChatTaskFiles({ userId: 'u1', userName: '张三' });
  assert.equal(mine.length, 1);
  const all = await rd.listChatTaskFiles({ userId: 'u1', canReadAll: true });
  assert.equal(all.length, 2); assert.deepEqual(all[1].ancestorIds, ['parent', 'child']); assert.match(all[1].path, /项目A/);
});

test('目录不凭任务管理权限绕过知识库分值，也不凭部门管理操作码跨部门读取', async () => {
  const calls: any[] = [];
  const rd = { getKnowledgeEntries: async (_filter: unknown, viewer: unknown, scope: unknown) => { calls.push({ viewer, scope }); return []; }, resolveDeptKbViewerLevel: async () => 7 };
  const catalog = new ChatFileCatalogService({} as never, rd as never, {} as never);
  await catalog.collect({ userId: 'u1', permissions: ['page:rd-my-workspace', 'rd-task:reassign', 'dept-kb:manage'] }, { sources: ['knowledge'] });
  assert.deepEqual(calls, [{ viewer: { userId: 'u1', hasFullAccess: false }, scope: undefined }]);
  calls.length = 0;
  await catalog.collect({ userId: 'u1', permissions: ['page:dept-kb-purchasing'] }, { sources: ['knowledge'] });
  assert.deepEqual(calls, [{ viewer: { userId: 'u1', hasFullAccess: false, levelOverride: 7 }, scope: 'purchasing' }]);
});

test('不可访问工作区不读取；快照不包含存储密钥或内嵌文件字节', async () => {
  const catalog = new ChatFileCatalogService({} as never, { listChatTaskFiles: async () => { throw new Error('不应读取'); } } as never, {} as never);
  assert.equal((await catalog.collect({ userId: 'u1', permissions: [] }, { sources: ['task'] })).files.length, 0);
  const ref = fileRef(file('a', { dataUrl: 'data:image/png;base64,AAAA' }));
  assert.ok(!('dataUrl' in ref)); assert.ok(!('objectKey' in ref));
});

test('ReAct 实际工具链传递完整快照和后台任务编号，越权快照不产生任务', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(Array.from({ length: 42 }, (_, i) => file(`f${i}`)));
  h.prisma.auditLog = { create: async () => ({}) };
  h.prisma.systemSetting = { findUnique: async () => null };
  h.prisma.aiUsageLog = { count: async () => 0 };
  const tools = new ChatToolsService(h.prisma, undefined as never, undefined as never, undefined as never, undefined as never, undefined as never, h.service);
  const names = (await tools.buildAgentTools(user)).definitions.map((d) => d.type === 'function' ? d.function.name : '');
  for (const name of ['search_project_files', 'inspect_file_selection', 'create_file_archive']) assert.ok(names.includes(name));
  const found = await tools.execute('search_project_files', '{}', user, 'conv');
  assert.equal(found.ok, true); assert.ok(found.fileSelectionId);
  const inspected = await tools.execute('inspect_file_selection', JSON.stringify({ selection_id: found.fileSelectionId, offset: 30 }), user, 'conv');
  assert.equal(JSON.parse(inspected.content).files.length, 12);
  const args = JSON.stringify({ selection_ids: [found.fileSelectionId] });
  const queued = await tools.execute('create_file_archive', args, user, 'conv');
  assert.ok(queued.archiveJobId); assert.equal(h.jobs[0].total, 42); assert.equal(h.jobs[0].status, 'queued');
  assert.equal((await tools.execute('create_file_archive', args, { ...user, userId: 'other' }, 'conv')).ok, false);
  assert.equal(h.jobs.length, 1);
});

test('ZIP 下载签名保留60秒、中文文件名与禁止缓存，继承上传内容类型而不触发 OSS 禁止覆盖', (t) => {
  const now = Date.parse('2026-09-08T00:00:00Z');
  t.mock.timers.enable({ apis: ['Date'], now });
  const oss = Object.create(OssService.prototype) as any;
  // Use the real SDK's URL encoder/signature builder with synthetic credentials;
  // no network call is made. Assert the public request, not just mocked options.
  Object.assign(oss, { basePrefix: 'test', publicClient: new OSS({
    region: 'oss-cn-beijing', bucket: 'synthetic-smoke-bucket', secure: true,
    accessKeyId: 'synthetic-id', accessKeySecret: 'synthetic-secret',
  }) });
  let url!: URL;
  // ali-oss uses utility.timestamp(), which rounds milliseconds to the nearest second.
  // Cover both sides of that boundary instead of depending on the wall-clock fraction.
  for (const milliseconds of [100, 900]) {
    t.mock.timers.setTime(now + milliseconds);
    url = new URL(oss.getArchiveDownloadUrl('test/chat-archives/1.zip', '项目资料.zip'));
    assert.equal(Number(url.searchParams.get('Expires')), Math.round(Date.now() / 1000) + 60);
  }
  assert.equal(url.pathname, '/test/chat-archives/1.zip');
  assert.ok(url.searchParams.get('Signature'));
  assert.equal(url.searchParams.get('response-content-disposition'), `attachment; filename="archive.zip"; filename*=UTF-8''${encodeURIComponent('项目资料.zip')}`);
  assert.equal(url.searchParams.get('response-cache-control'), 'private, no-store');
  // The deployed bucket rejects this override with HTTP 400 InvalidRequest.
  // uploadArchiveFile already supplies Content-Type: application/zip on the object.
  assert.equal(url.searchParams.has('response-content-type'), false);
  assert.equal(oss.getArchiveDownloadUrl('test/private/1.zip', 'a.zip'), null);
});

test('分片上传接收磁盘路径，取消中止该上传，拒绝跨业务写入和删除', async () => {
  const oss = Object.create(OssService.prototype) as any;
  const controller = new AbortController();
  let aborted = false;
  const client = {
    multipartUpload: async (key: string, path: string, options: any) => {
      assert.equal(key, 'test/chat-archives/a.zip'); assert.equal(path, '/private/tmp/archive.zip');
      assert.equal(options.parallel, 2); assert.equal(options.headers['Content-Type'], 'application/zip');
      controller.abort(new Error('cancel'));
      await options.progress(0.5, { uploadId: 'upload1' });
    },
    abortMultipartUpload: async (key: string, id: string) => { assert.equal(key, 'test/chat-archives/a.zip'); assert.equal(id, 'upload1'); aborted = true; },
  };
  Object.assign(oss, { basePrefix: 'test', withOssFallback: async (_label: string, fn: (client: unknown) => Promise<unknown>) => fn(client) });
  await assert.rejects(oss.uploadArchiveFile('test/chat-archives/a.zip', '/private/tmp/archive.zip', controller.signal), /cancel/);
  assert.equal(aborted, true);
  await assert.rejects(oss.uploadArchiveFile('test/other/a.zip', '/private/tmp/archive.zip', controller.signal), /非法/);
  await assert.rejects(oss.deleteArchiveObject('test/other/a.zip'), /非法/);
});

test('过期清理包含旧执行者残留对象；存储清理失败时保留任务以便重试', async () => {
  const h = harness(); const queued = await h.queue(); const job = await h.run(queued.id);
  const orphan = 'test/chat-archives/old-attempt.zip';
  h.objects.set(orphan, Buffer.from('old')); job.outputKeys.push(orphan); job.expiresAt = new Date(0);
  const remove = h.oss.deleteArchiveObject;
  h.oss.deleteArchiveObject = async () => { throw new Error('临时清理失败'); };
  await h.service.cleanup(); assert.equal(h.jobs.length, 1);
  h.oss.deleteArchiveObject = remove;
  await h.service.cleanup(); assert.equal(h.objects.size, 0); assert.equal(h.jobs.length, 0);
});

test('本人图片/视频目录完整翻页，保留原格式，检索阶段不读取内嵌图片', async () => {
  const images = Array.from({ length: 201 }, (_, i) => ({ id: `image${String(i).padStart(3, '0')}`, prompt: '产品图', imageUrl: `test/images/${i}.webp`, createdAt: new Date(), category: null }));
  let imagePages = 0;
  const prisma = {
    generatedImage: {
      findMany: async (args: any) => {
        assert.equal(args.where.userId, 'u1'); assert.equal(args.select.imageData, undefined); imagePages++;
        const candidates = args.where.id ? images.filter((img) => args.where.id.in.includes(img.id)) : images;
        const start = args.cursor ? candidates.findIndex((img) => img.id === args.cursor.id) + 1 : 0;
        return candidates.slice(start, start + args.take);
      },
      findUnique: async () => { throw new Error('有OSS原件，不应读取内嵌图片'); },
    },
    videoGeneration: { findMany: async (args: any) => { assert.equal(args.where.userId, 'u1'); assert.equal(args.where.status, 'succeeded'); return [{ id: 'video1', prompt: '展示', videoObjectKey: 'test/videos/a.mov', createdAt: new Date(), category: null }]; } },
  };
  const catalog = new ChatFileCatalogService(prisma as never, {} as never, { extractObjectKey: (key: string) => key } as never);
  const found = await catalog.collect(user, { sources: ['image', 'video'] });
  assert.equal(found.files.length, 202); assert.equal(imagePages, 2);
  assert.ok(found.files.filter((f) => f.source === 'image').every((f) => f.name.endsWith('.webp')));
  assert.ok(found.files.find((f) => f.source === 'video')!.name.endsWith('.mov'));
  const ref = fileRef(found.files.find((f) => f.source === 'image')!);
  assert.equal((await catalog.resolve([ref], user)).size, 1);
});

test('聊天目录按会话所有者与文件所有者双重限定，排除失效文件和跨业务历史引用', async () => {
  const asset = { id: 'mine', uploadedBy: 'u1', status: 'active', businessType: 'chat', fileName: '文件.pdf', objectKey: 'test/mine', mimeType: 'application/pdf', fileSize: 12, createdAt: new Date(), updatedAt: new Date() };
  const assets = [asset, { ...asset, id: 'other', uploadedBy: 'u2' }, { ...asset, id: 'reference', businessType: 'chat-referenced' }, { ...asset, id: 'deleted', status: 'deleted' }];
  const prisma = {
    chatMessage: { findMany: async (args: any) => { assert.equal(args.where.conversation.userId, 'u1'); return [{ id: 'message1', attachments: assets.map((a) => ({ fileId: a.id })), conversation: { title: '我的对话' } }]; } },
    fileAsset: { findMany: async ({ where }: any) => {
      assert.equal(where.uploadedBy, 'u1'); assert.equal(where.businessType.not, 'chat-referenced'); assert.equal(where.status, 'active');
      return assets.filter((a) => matches(a, where));
    } },
  };
  const catalog = new ChatFileCatalogService(prisma as never, {} as never, { extractObjectKey: (key: string) => key } as never);
  const found = await catalog.collect(user, { sources: ['chat'] });
  assert.equal(found.files.length, 1); assert.equal(found.files[0].resourceId, 'message1/mine');
});
