import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { ResearchDevelopmentService } from '../src/modules/research-development/research-development.service';
import { RdTechnicalDocumentsService, normalizeRdDocumentInput, type ConfirmRdDocumentInput } from '../src/modules/research-development/rd-technical-documents.service';
import { runInRdWorkspace } from '../src/modules/research-development/rd-workspace.context';

const databaseUrl = process.env.RD_DOCUMENTS_TEST_DATABASE_URL;
const owner = { userId: 'rd-owner', userName: '研发主责', permissions: ['page:rd-my-workspace'] };
const reader = { userId: 'rd-reader', userName: '只读人员', permissions: ['page:rd-task-management', 'rd-task:view-all'] };
const payload = (overrides: Partial<ConfirmRdDocumentInput> = {}): ConfirmRdDocumentInput => ({
  requestId: randomUUID(), title: '阀体图纸', category: 'drawing', version: 'V1', changeReason: '首次确认', sourceNoteId: 'note-1', attachmentId: 'att-1', ...overrides,
});

test('研发资料登记须有人工版本和原因，新版本须指定当前版本', () => {
  assert.throws(() => normalizeRdDocumentInput(payload({ version: '' })), /版本号/);
  assert.throws(() => normalizeRdDocumentInput(payload({ changeReason: ' ' })), /原因/);
  assert.throws(() => normalizeRdDocumentInput(payload({ documentId: 'd1' })), /原版本/);
  assert.throws(() => normalizeRdDocumentInput(payload({ category: 'guess-from-name' })), /资料类型/);
});

test('隔离 PostgreSQL：研发资料历史、并发、采购版本快照与权限', { skip: !databaseUrl, timeout: 60000 }, async (t) => {
  const url = new URL(databaseUrl!);
  assert.equal(url.hostname, 'localhost'); assert.equal(url.pathname, '/rd_documents_test'); assert.equal(url.password, '');
  assert.match(url.searchParams.get('host') ?? '', /^\/private\/tmp\/rd-documents-db-[A-Za-z0-9]+$/);
  const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const tasks: Record<string, Record<string, unknown>> = {
    'task-1': { task_id: 'task-1', title: '结构设计', primary_owner_user_id: owner.userId, primary_owner: owner.userName, collaborators: [], status: 'in_progress', archived: false },
    'task-2': { task_id: 'task-2', primary_owner_user_id: owner.userId, collaborators: [], archived: false },
  };
  let notes: Array<Record<string, unknown>> = [{ id: 'note-1', task_id: 'task-1', attachments: [{ id: 'att-1', name: '阀体.pdf', mime: 'application/pdf', size: 12, object_key: 'rd/progress-notes/original.pdf', oss_url: 'https://files.invalid/original.pdf' }] }];
  const rd = Object.create(ResearchDevelopmentService.prototype) as ResearchDevelopmentService;
  Object.assign(rd, { taskTreeWriteLock: Promise.resolve(), progressNoteWriteLock: Promise.resolve(), findTaskAcrossStores: async (id: string) => tasks[id] ?? null, getTaskProgressNotes: async () => notes });
  const oss = { buildInlinePreviewUrl: (key: string) => `/preview?key=${key}`, getArchiveDownloadUrl: (key: string) => `/download?key=${key}`, signPreviewToken: () => ({ exp: 1000, sig: 'test-capability' }) };
  const service = new RdTechnicalDocumentsService(prisma as never, rd, oss as never);
  try {
    const sql = await readFile(join(__dirname, '../prisma/migrations/20260909090000_rd_technical_documents/migration.sql'), 'utf8');
    for (const statement of sql.split(';').map((part) => part.trim()).filter(Boolean)) await prisma.$executeRawUnsafe(statement);
    await prisma.$executeRawUnsafe(`CREATE TABLE "AuditLog" ("id" TEXT PRIMARY KEY, "userId" TEXT, "action" TEXT NOT NULL, "resource" TEXT NOT NULL, "resourceId" TEXT, "meta" JSONB NOT NULL DEFAULT '{}', "ip" TEXT, "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, "module" TEXT NOT NULL DEFAULT 'other', "source" TEXT NOT NULL DEFAULT 'api', "actorName" TEXT, "resourceName" TEXT, "summary" TEXT, "notes" JSONB NOT NULL DEFAULT '[]')`);

    let documentId: string;
    let firstVersionId: string;
    await t.test('V1确认后原附件替换，V1文件和版本仍固定；V2保留变更原因及旧版关系', async () => {
      const first = await service.confirm('task-1', payload(), owner);
      documentId = first.documents[0].id; firstVersionId = first.documents[0].currentVersionId!;
      assert.equal(first.canEdit, true);
      assert.equal(first.documents[0].versions[0].attachment.preview_url, '/preview?key=rd/progress-notes/original.pdf');
      const before = await service.resolveTransferVersions('task-1', [firstVersionId], owner);
      notes = [{ id: 'note-2', task_id: 'task-1', attachments: [{ id: 'att-2', name: '阀体V2.pdf', mime: 'application/pdf', size: 16, object_key: 'rd/progress-notes/revised.pdf', oss_url: 'https://files.invalid/revised.pdf' }] }];
      const second = await service.confirm('task-1', payload({ documentId, expectedCurrentVersionId: firstVersionId, title: '改版阀体', version: 'V2', changeReason: '调整密封面', sourceNoteId: 'note-2', attachmentId: 'att-2' }), owner);
      assert.equal(second.documents[0].versions.length, 2);
      const next = second.documents[0].versions.find((version) => version.version === 'V2')!;
      assert.equal(next.previousVersionId, firstVersionId); assert.equal(next.changeReason, '调整密封面');
      const after = await service.resolveTransferVersions('task-1', [firstVersionId], owner);
      assert.deepEqual(after, before, '旧版本采购读取不随新标题、新文件发生变化');
    });

    await t.test('过期当前版本、重复版本号、跨任务附件和版本均被拒绝', async () => {
      const current = (await service.list('task-1', owner)).documents.find((document) => document.id === documentId)!;
      const base = payload({ documentId, expectedCurrentVersionId: current.currentVersionId!, sourceNoteId: 'note-2', attachmentId: 'att-2' });
      await assert.rejects(() => service.confirm('task-1', { ...base, version: 'V3', expectedCurrentVersionId: firstVersionId }, owner), /新版本/);
      await assert.rejects(() => service.confirm('task-1', { ...base, version: 'V2' }, owner), /版本号/);
      await assert.rejects(() => service.confirm('task-2', payload({ sourceNoteId: 'note-2', attachmentId: 'att-2' }), owner), /不属于/);
      await assert.rejects(() => service.resolveTransferVersions('task-2', [firstVersionId], owner), /不属于/);
      await assert.rejects(() => service.confirm('task-1', { ...base, version: 'V3', expectedFileKey: 'rd/progress-notes/original.pdf', expectedFileName: '阀体.pdf', expectedFileSize: 12 }, owner), /附件已被替换/);
    });

    await t.test('提交响应丢失重试和并发双击只确认一版，换内容复用编号被拒绝', async () => {
      const input = payload({ title: '独立资料', sourceNoteId: 'note-2', attachmentId: 'att-2' });
      await Promise.all([service.confirm('task-1', input, owner), service.confirm('task-1', input, owner)]);
      await service.confirm('task-1', input, owner);
      assert.equal(await prisma.rdTechnicalDocumentVersion.count({ where: { requestId: input.requestId } }), 1);
      assert.equal(await prisma.rdTechnicalDocument.count({ where: { title: '独立资料' } }), 1);
      await assert.rejects(() => service.confirm('task-1', { ...input, version: 'DIFFERENT' }, owner), /提交编号/);
    });

    await t.test('两人从同一旧版提交不同新版本，只能一人成功且无孤立版本', async () => {
      const current = (await service.list('task-1', owner)).documents.find((document) => document.id === documentId)!;
      const base = { documentId, expectedCurrentVersionId: current.currentVersionId!, sourceNoteId: 'note-2', attachmentId: 'att-2' };
      const result = await Promise.allSettled([service.confirm('task-1', payload({ ...base, version: 'V3A' }), owner), service.confirm('task-1', payload({ ...base, version: 'V3B' }), owner)]);
      assert.equal(result.filter((item) => item.status === 'fulfilled').length, 1);
      assert.equal(await prisma.rdTechnicalDocumentVersion.count({ where: { documentId } }), 3);
    });

    await t.test('仅本人/协作或主管可写；只读跨任务权限、归档和其他工作区不授写权', async () => {
      assert.equal((await service.list('task-1', reader)).canEdit, false);
      await assert.rejects(() => service.confirm('task-1', payload(), reader), /只能维护/);
      await assert.rejects(() => service.list('task-1', { userId: 'stranger', permissions: ['page:rd-my-workspace'] }), /没有读取权限/);
      tasks['task-1'].archived = true;
      assert.equal((await service.list('task-1', owner)).canEdit, false);
      await assert.rejects(() => service.confirm('task-1', payload(), owner), /只读/);
      tasks['task-1'].archived = false;
      await assert.rejects(() => runInRdWorkspace('us-collab', () => service.list('task-1', owner)), /工作区/);
      await assert.rejects(() => runInRdWorkspace('production', () => service.list('task-1', owner)), /工作区/);
    });

    await t.test('历史内嵌文件保存在版本中；列表只给短效预览地址，原留痕删除仍可下载', async () => {
      notes = [{ id: 'embedded-note', task_id: 'task-1', attachments: [{ id: 'embedded-att', name: 'legacy.pdf', mime: 'application/pdf', size: 7, data_url: `data:application/pdf;base64,${Buffer.from('%PDF-v1').toString('base64')}` }] }];
      const result = await service.confirm('task-1', payload({ title: '历史内嵌资料', sourceNoteId: 'embedded-note', attachmentId: 'embedded-att' }), owner);
      const version = result.documents.find((document) => document.title === '历史内嵌资料')!.versions[0];
      notes = [];
      assert.match(version.fileUrl, /^\/api\/research-development\/technical-document-files\//);
      assert.equal(JSON.stringify(result).includes('base64'), false);
      assert.equal((await service.readEmbeddedVersion(version.id))?.buffer.toString(), '%PDF-v1');
      const auditCount = await prisma.auditLog.count({ where: { action: 'task.document_version_confirmed' } });
      assert.equal(auditCount, await prisma.rdTechnicalDocumentVersion.count());
    });
  } finally { await prisma.$disconnect(); }
});
