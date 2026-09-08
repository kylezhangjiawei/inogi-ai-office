import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { ChatDeliveryService, normalizeDeliveryRequirements } from '../src/modules/chat/chat-delivery.service';
import { ChatArchiveService } from '../src/modules/chat/chat-archive.service';
import { ChatPageContextService } from '../src/modules/chat/chat-page-context.service';
import { CatalogFile, FileRef, matchesFile } from '../src/modules/chat/chat-file-catalog.service';
import { ForbiddenException } from '@nestjs/common';

const user = { userId: 'u1', name: '张三', permissions: ['*'] };
const requirements = [
  { id: 'testing', title: '测试报告', keywords: ['测试'], required: true },
  { id: 'manual', title: '使用说明', keywords: ['说明'], required: true },
];
const file = (id: string, overrides: Partial<CatalogFile> = {}): CatalogFile => ({
  id, source: 'task', scope: 'rd', taskId: 'child', ancestorIds: ['root', 'child'], resourceId: `child/note/${id}`,
  name: `测试报告-${id}.pdf`, mime: 'application/pdf', size: 100, createdAt: '2026-09-08T08:00:00Z', uploader: '张三',
  folder: 'rd/项目A/子任务', revision: 'rev1', objectKey: `private/${id}.pdf`, ...overrides,
});
const matches = (row: any, where: any): boolean => Object.entries(where ?? {}).every(([key, value]: [string, any]) => {
  if (value === null || typeof value !== 'object') return row[key] === value;
  if ('in' in value) return value.in.includes(row[key]);
  if ('gt' in value) return row[key] > value.gt;
  return false;
});
function harness(initial = [file('f1')]) {
  const checks: any[] = [], selections: any[] = [], jobs: any[] = [];
  let files = initial, permissions = ['*'], sourceFailure = false, taskAllowed = true, userActive = true;
  let sequence = 0, collects = 0, taskReads = 0;
  let afterCollect: (() => void) | undefined;
  let transactionTail = Promise.resolve();
  const delegate = (rows: any[]) => ({
    findFirst: async ({ where }: any) => structuredClone(rows.find((row) => matches(row, where)) ?? null),
    findUnique: async ({ where }: any) => structuredClone(rows.find((row) => matches(row, where)) ?? null),
    findMany: async ({ where, take }: any) => structuredClone(rows.filter((row) => matches(row, where)).slice(0, take)),
    count: async ({ where }: any) => rows.filter((row) => matches(row, where)).length,
    create: async ({ data }: any) => {
      const row = { id: `row${++sequence}`, revision: 1, checkedAt: new Date(), createdAt: new Date(), updatedAt: new Date(), status: 'queued', processed: 0,
        succeeded: 0, failed: 0, bytes: 0n, cancelRequested: false, error: null, ...structuredClone(data) };
      rows.push(row); return structuredClone(row);
    },
    updateMany: async ({ where, data }: any) => {
      const selected = rows.filter((row) => matches(row, where));
      for (const row of selected) {
        for (const [key, value] of Object.entries(data)) row[key] = value && typeof value === 'object' && 'increment' in value ? row[key] + (value as any).increment : structuredClone(value);
        row.updatedAt = new Date();
      }
      return { count: selected.length };
    },
  });
  const prisma: any = {
    chatDeliveryCheck: delegate(checks), chatFileSelection: delegate(selections), chatArchiveJob: delegate(jobs),
    chatConversation: { findFirst: async ({ where }: any) => where.id === 'conv' && where.userId === 'u1' ? { id: 'conv' } : null },
    user: { findUnique: async ({ where }: any) => where.id === 'u1' ? { id: 'u1', status: userActive ? 'ACTIVE' : 'DISABLED', name: '张三', role: { permissions } } : null },
    $executeRaw: async () => 1,
    $transaction: (fn: any) => { const result = transactionTail.then(() => fn(prisma)); transactionTail = result.then(() => undefined, () => undefined); return result; },
  };
  const catalog = {
    collect: async (_user: unknown, filter: any) => {
      collects++;
      if (sourceFailure) throw new Error('partial source failure');
      const result = { files: structuredClone(files.filter((item) => matchesFile(item, filter))), warnings: [] };
      afterCollect?.(); return result;
    },
    resolve: async () => new Map(files.map((item) => [item.id, item])),
  };
  const rd = { resolveChatTask: async (taskId: string, viewer: any) => {
    taskReads++;
    if (!taskAllowed || taskId !== 'root' || viewer.userId !== 'u1') throw new ForbiddenException('当前任务不可读取');
    return { taskId, title: '项目A', fields: {} };
  } };
  const permissionService = { filterDisabled: async (codes: string[]) => codes.filter((code) => code !== 'disabled-permission') };
  const oss = { isEnabled: true, getSignedUrl: (key: string, seconds: number) => { assert.equal(seconds, 60); return `https://example.invalid/download/${key}`; } };
  const archives = new ChatArchiveService(prisma, catalog as never, oss as never, permissionService as never);
  const makeService = () => new ChatDeliveryService(prisma, catalog as never, archives, new ChatPageContextService(rd as never), permissionService as never, oss as never);
  const service = makeService();
  const create = () => service.create({ conversationId: 'conv', taskId: 'root', requirements }, user);
  return { service, makeService, archives, prisma, checks, jobs, selections, create, files: () => files, setFiles: (value: CatalogFile[]) => { files = value; },
    setPermissions: (value: string[]) => { permissions = value; }, setTaskAllowed: (value: boolean) => { taskAllowed = value; }, setActive: (value: boolean) => { userActive = value; },
    failSource: (value: boolean) => { sourceFailure = value; }, collects: () => collects, taskReads: () => taskReads,
    afterCollect: (fn?: () => void) => { afterCollect = fn; } };
}

test('reference checklist validation rejects empty, oversized, duplicate and unbounded searches', () => {
  assert.equal(normalizeDeliveryRequirements([{ title: '报告', keywords: [' 测试 ', '测试'] }])[0].keywords.length, 1);
  for (const value of [[], new Array(21).fill(requirements[0]), [{ ...requirements[0], keywords: [] }], [{ ...requirements[0], required: 'yes' }], [requirements[0], requirements[0]]]) {
    assert.throws(() => normalizeDeliveryRequirements(value));
  }
});

test('creates persistent metadata candidates for a root and its descendants; outside scope and object keys never leak', async () => {
  const h = harness([file('f1'), file('f2', { taskId: 'root', ancestorIds: ['root'] }), file('outside', { ancestorIds: ['other'], taskId: 'other' }), file('otherpool', { scope: 'us-collab' })]);
  const result = await h.create();
  assert.equal(result.rows[0].status, 'candidate'); assert.equal(result.rows[0].candidateCount, 2);
  assert.equal(result.rows[1].status, 'missing'); assert.equal(result.summary.unresolvedRequired, 2);
  assert.equal(result.scannedFileCount, 2); assert.equal(h.checks.length, 1);
  assert.match(result.templateLabel, /非公司正式/); assert.match(result.scopeNote, /未检索正文/);
  assert.ok(!JSON.stringify(result).includes('objectKey')); assert.ok(!JSON.stringify(result).includes('private/'));
  assert.ok(!JSON.stringify(h.checks[0].checklist).includes('objectKey'));
  // PostgreSQL JSONB reorders keys on reload; this must not increment the optimistic revision.
  h.checks[0].checklist = JSON.parse(JSON.stringify(h.checks[0].checklist, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item));
  const read = await h.makeService().list('conv', user);
  assert.deepEqual(read[0], result);
});

test('current database permissions, disabled account, conversation ownership and task visibility reject before missing results', async () => {
  const h = harness();
  await assert.rejects(h.service.create({ conversationId: 'another', taskId: 'root' }, user), /会话/);
  assert.equal(h.collects(), 0);
  h.setPermissions(['page:us-collab-workspace', 'rd-task:reassign']);
  await assert.rejects(h.create(), /权限/); assert.equal(h.taskReads(), 0);
  h.setPermissions(['*']); h.setTaskAllowed(false);
  await assert.rejects(h.create(), /不可读取/); assert.equal(h.collects(), 0);
  h.setTaskAllowed(true); h.setActive(false);
  await assert.rejects(h.create(), /账号不可用/); assert.equal(h.checks.length, 0);
});

test('source failures never persist a missing report or silently overwrite a valid report', async () => {
  const h = harness(); h.failSource(true);
  await assert.rejects(h.create(), /没有生成检查结论/); assert.equal(h.checks.length, 0);
  h.failSource(false); const created = await h.create();
  h.failSource(true);
  await assert.rejects(h.service.refresh(created.id, { revision: created.revision }, user), /没有生成检查结论/);
  await assert.rejects(h.service.list('conv', user), /没有生成检查结论/);
  assert.equal(h.checks[0].revision, 1); assert.equal(h.checks[0].checklist.rows[0].status, 'candidate');
});

test('confirmation requires explicit displayed evidence; simultaneous optimistic edits yield one winner', async () => {
  const h = harness(); const created = await h.create();
  await assert.rejects(h.service.update(created.id, { revision: 1, updates: [{ id: 'testing', status: 'confirmed', evidenceFileIds: ['invented'] }] }, user));
  await assert.rejects(h.service.update(created.id, { revision: 1, updates: [{ id: 'testing', status: 'confirmed' }] }, user));
  const payload = { revision: 1, updates: [{ id: 'testing', status: 'confirmed', evidenceFileIds: ['f1'] }] };
  const results = await Promise.allSettled([h.service.update(created.id, payload, user), h.makeService().update(created.id, payload, user)]);
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(results.filter((item) => item.status === 'rejected').length, 1);
  assert.equal(h.checks[0].revision, 2); assert.equal(h.checks[0].checklist.rows[0].status, 'confirmed');
  assert.deepEqual(h.checks[0].checklist.rows[0].evidenceFileIds, ['f1']);
});

test('refresh and reads invalidate changed, removed, or newly inaccessible confirmed evidence', async () => {
  const h = harness(); const created = await h.create();
  const confirmed = await h.service.update(created.id, { revision: 1, updates: [{ id: 'testing', status: 'confirmed', evidenceFileIds: ['f1'] }] }, user);
  h.setFiles([file('f1', { revision: 'rev2' })]);
  const refreshed = await h.service.refresh(created.id, { revision: confirmed.revision }, user);
  assert.equal(refreshed.rows[0].status, 'candidate'); assert.deepEqual(refreshed.rows[0].evidenceFileIds, []); assert.match(refreshed.rows[0].notice!, /变化/);
  const again = await h.service.update(created.id, { revision: refreshed.revision, updates: [{ id: 'testing', status: 'confirmed', evidenceFileIds: ['f1'] }] }, user);
  h.setFiles([]);
  const read = await h.service.list('conv', user);
  assert.equal(read[0].rows[0].status, 'missing'); assert.equal(read[0].revision, again.revision + 1); assert.equal(read[0].rows[0].candidates.length, 0);
  h.setTaskAllowed(false);
  await assert.rejects(h.service.list('conv', user), /不可读取/);
});

test('a file replaced after display cannot be confirmed or previewed under its old revision', async () => {
  const h = harness(); const created = await h.create(); h.setFiles([file('f1', { revision: 'rev2' })]);
  await assert.rejects(h.service.update(created.id, { revision: 1, updates: [{ id: 'testing', status: 'confirmed', evidenceFileIds: ['f1'] }] }, user), /刷新/);
  await assert.rejects(h.service.preview(created.id, 'f1', { revision: 1 }, user), /刷新/);
  assert.equal(h.checks[0].checklist.rows[0].status, 'candidate');
});

test('reference requirements are editable, omitted rows are removed, changed definitions reset confirmations', async () => {
  const h = harness(); const created = await h.create();
  const confirmed = await h.service.update(created.id, { revision: 1, updates: [{ id: 'testing', status: 'confirmed', evidenceFileIds: ['f1'] }, { id: 'manual', status: 'not_required' }] }, user);
  assert.equal(confirmed.summary.unresolvedRequired, 0);
  const edited = await h.service.update(created.id, { revision: confirmed.revision, requirements: [{ id: 'testing', title: '测试报告最新版', keywords: ['测试'], required: false }] }, user);
  assert.equal(edited.rows.length, 1); assert.equal(edited.rows[0].status, 'candidate'); assert.equal(edited.summary.required, 0);
});

test('candidate previews are bounded and disclose full match counts, while confirmed selections remain visible', async () => {
  const h = harness(Array.from({ length: 30 }, (_, index) => file(`f${index}`)));
  const created = await h.create(); assert.equal(created.rows[0].candidates.length, 20); assert.equal(created.rows[0].candidateCount, 30);
  const confirmed = await h.service.update(created.id, { revision: 1, updates: [{ id: 'testing', status: 'confirmed', evidenceFileIds: ['f19'] }] }, user);
  h.setFiles([file('new'), ...h.files()]);
  const next = await h.service.refresh(created.id, { revision: confirmed.revision }, user);
  assert.equal(next.rows[0].status, 'confirmed'); assert.ok(next.rows[0].candidates.some((item) => item.id === 'f19'));
});

test('archive integration queues only confirmed selected files and reuses bounded snapshot service', async () => {
  const h = harness([file('f1'), file('f2'), file('manual', { name: '使用说明.pdf' })]);
  const created = await h.create();
  const confirmed = await h.service.update(created.id, { revision: 1, updates: [{ id: 'testing', status: 'confirmed', evidenceFileIds: ['f1'] }] }, user);
  const result = await h.service.archive(created.id, { revision: confirmed.revision }, user);
  assert.equal(result.archive.status, 'queued'); assert.equal(result.archive.total, 1);
  assert.equal(h.jobs.length, 1); assert.deepEqual(h.jobs[0].files.map((item: FileRef) => item.id), ['f1']);
  assert.equal(result.check.revision, confirmed.revision + 1);
  assert.deepEqual(h.selections[0].filter, { sources: ['task'], workspace: 'rd', task_ids: ['root'] });
});

test('archive rejects stale evidence and source changes between scan and saved archive snapshot', async () => {
  const h = harness(); const created = await h.create();
  const confirmed = await h.service.update(created.id, { revision: 1, updates: [{ id: 'testing', status: 'confirmed', evidenceFileIds: ['f1'] }] }, user);
  let scans = 0;
  h.afterCollect(() => { if (++scans === 1) h.setFiles([file('f1', { revision: 'replaced-during-archive' })]); });
  await assert.rejects(h.service.archive(created.id, { revision: confirmed.revision }, user), /刷新/);
  assert.equal(h.jobs.length, 0);
  h.afterCollect();
  await assert.rejects(h.service.archive(created.id, { revision: confirmed.revision }, user), /刷新/);
  assert.equal(h.checks[0].checklist.rows[0].status, 'candidate'); assert.equal(h.jobs.length, 0);
});

test('all persisted endpoints revalidate ownership/resources; preview signs only catalog-owned fresh files', async () => {
  const h = harness(); const created = await h.create();
  const preview = await h.service.preview(created.id, 'f1', { revision: 1 }, user);
  assert.equal(preview.expiresIn, 60); assert.ok(preview.url.includes('private/f1.pdf'));
  await assert.rejects(h.service.preview(created.id, 'private_other', { revision: 1 }, user));
  const other = { userId: 'other', permissions: ['*'] };
  for (const action of [
    () => h.service.update(created.id, { revision: 1, updates: [] }, other),
    () => h.service.refresh(created.id, { revision: 1 }, other),
    () => h.service.archive(created.id, { revision: 1 }, other),
    () => h.service.preview(created.id, 'f1', { revision: 1 }, other),
  ]) await assert.rejects(action(), /不存在/);
  h.setPermissions([]);
  await assert.rejects(h.service.preview(created.id, 'f1', { revision: 1 }, user), /权限/);
  await assert.rejects(h.service.list('conv', user), /权限/);
});
