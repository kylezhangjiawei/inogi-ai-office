import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { ChatArchiveService } from '../src/modules/chat/chat-archive.service';
import { ChatDeliveryService } from '../src/modules/chat/chat-delivery.service';
import { ChatPageContextService } from '../src/modules/chat/chat-page-context.service';
import { ChatService } from '../src/modules/chat/chat.service';
import { CatalogFile, FileRef, matchesFile } from '../src/modules/chat/chat-file-catalog.service';

const rawUrl = process.env.CHAT_WORKSPACE_TEST_DATABASE_URL;
const run = promisify(execFile);
const migrations = join(__dirname, '../prisma/migrations');
const requirements = [
  { id: 'testing', title: '测试报告', keywords: ['测试'], required: true },
  { id: 'manual', title: '使用说明', keywords: ['说明'], required: true },
];
const pageRef = (entityId: string) => ({ schemaVersion: 1 as const, pageKey: 'rd_task_detail' as const, scope: 'entity' as const,
  refs: [{ entityType: 'rd_task' as const, entityId, workspace: 'rd' as const }], capturedAt: '2026-09-08T08:00:00.000Z' });
const exampleFile = (id: string, overrides: Partial<CatalogFile> = {}): CatalogFile => ({
  id, source: 'task', scope: 'rd', taskId: 'child', ancestorIds: ['root', 'child'], resourceId: `child/note/${id}`,
  name: `测试报告-${id}.pdf`, mime: 'application/pdf', size: 100, createdAt: '2026-09-08T08:00:00Z', uploader: 'test user',
  folder: 'rd/示例项目/子任务', revision: 'v1', objectKey: `synthetic-only/${id}.pdf`, ...overrides,
});

/** Generate only the existing chat/identity tables, with the additive features removed.
 * The actual checked-in SQL migrations below are the sole source of the new columns/tables.
 */
async function legacySchemaSql(url: string) {
  const current = await readFile(join(__dirname, '../prisma/schema.prisma'), 'utf8');
  const keep = new Set(['Role', 'User', 'ChatConversation', 'ChatMessage']);
  const modelNames = new Set([...current.matchAll(/^model (\w+) \{/gm)].map((match) => match[1]));
  const models = [...current.matchAll(/^model (\w+) \{[\s\S]*?^\}/gm)].filter((match) => keep.has(match[1])).map((match) =>
    match[0].split('\n').filter((line) => {
      if (/^\s*(?:pageContext|clientMessageId)\s/.test(line) || /^\s*@@unique\(\[conversationId, clientMessageId\]\)/.test(line)) return false;
      const fieldType = line.trim().split(/\s+/)[1]?.replace(/[?\[\]]/g, '');
      return !fieldType || !modelNames.has(fieldType) || keep.has(fieldType);
    }).join('\n'));
  assert.equal(models.length, 4, 'Legacy fixture must include the four existing identity/chat models');
  const status = current.match(/^enum UserStatus \{[\s\S]*?^\}/m)?.[0];
  assert.ok(status);
  const directory = await mkdtemp('/private/tmp/matechat-workspace-schema-');
  try {
    const schemaPath = join(directory, 'schema.prisma');
    await writeFile(schemaPath, `datasource db {\n provider = "postgresql"\n url = env("DATABASE_URL")\n}\n${status}\n${models.join('\n')}`);
    const output = await run(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', schemaPath, '--script'],
      { env: { ...process.env, DATABASE_URL: url }, maxBuffer: 1024 * 1024 });
    return output.stdout;
  } finally { await rm(directory, { recursive: true, force: true }); }
}

async function executeSql(client: PrismaClient, sql: string) {
  // These migrations contain plain DDL only; remove full-line comments before splitting,
  // because explanatory prose can itself contain semicolons.
  for (const statement of sql.replace(/^\s*--.*$/gm, '').split(';').map((part) => part.trim()).filter(Boolean)) await client.$executeRawUnsafe(statement);
}

async function harness(first: PrismaClient, second: PrismaClient) {
  const suffix = randomBytes(6).toString('hex');
  const role = await first.role.create({ data: { name: `workspace-test-${suffix}`, permissions: ['*'] } });
  const owner = await first.user.create({ data: { name: '集成测试用户', englishName: 'Test User', email: `${suffix}@example.invalid`, roleId: role.id } });
  const conversation = await first.chatConversation.create({ data: { userId: owner.id } });
  const user = { userId: owner.id, name: owner.name, permissions: ['*'] };
  let files = [exampleFile('report'), exampleFile('other-report'), exampleFile('manual', { name: '使用说明.pdf' })];
  let afterCollect: (() => Promise<void> | void) | undefined;
  let sourceFailed = false;
  const catalog = {
    collect: async (_viewer: unknown, filter: any) => {
      if (sourceFailed) throw new Error('synthetic source failure');
      const found = structuredClone(files.filter((file) => matchesFile(file, filter)));
      await afterCollect?.();
      return { files: found, warnings: [] };
    },
    resolve: async () => new Map(files.map((file) => [file.id, file])),
  };
  const permissions = { filterDisabled: async (values: string[]) => values };
  const oss = { isEnabled: true, getSignedUrl: () => { throw new Error('No real object signing in database tests'); } };
  const pageContext = new ChatPageContextService({ resolveChatTask: async (id: string) => {
    assert.equal(id, 'root'); return { taskId: id, title: '示例项目', fields: {} };
  } } as never);
  const service = (client: PrismaClient) => {
    const archive = new ChatArchiveService(client as never, catalog as never, oss as never, permissions as never);
    return new ChatDeliveryService(client as never, catalog as never, archive, pageContext, permissions as never, oss as never);
  };
  const a = service(first), b = service(second);
  return { a, b, user, conversationId: conversation.id, roleId: role.id,
    create: () => a.create({ conversationId: conversation.id, taskId: 'root', requirements }, user),
    setFiles: (value: CatalogFile[]) => { files = value; },
    afterCollect: (fn?: () => Promise<void> | void) => { afterCollect = fn; },
    failSource: (value: boolean) => { sourceFailed = value; },
  };
}

/** Make both callers read the same revision before either can update it. */
function rendezvous(expected: number) {
  let entered = 0;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => { release = resolve; });
  return async () => { if (++entered === expected) release(); await ready; };
}

test('隔离 PostgreSQL：页面关联和交付清单的迁移、持久化与并发', { skip: !rawUrl, timeout: 60000 }, async (t) => {
  const parsed = new URL(rawUrl!);
  assert.equal(parsed.hostname, 'localhost');
  assert.equal(parsed.pathname, '/matechat_test');
  assert.equal(parsed.password, '');
  assert.match(parsed.searchParams.get('host') ?? '', /^\/private\/tmp\/matechat-(?:archive|workspace)-db-[A-Za-z0-9]+$/);
  const schema = `workspace_test_${randomBytes(8).toString('hex')}`;
  parsed.searchParams.set('schema', schema);
  parsed.searchParams.set('connection_limit', '4');
  const first = new PrismaClient({ datasources: { db: { url: parsed.toString() } } });
  const second = new PrismaClient({ datasources: { db: { url: parsed.toString() } } });
  try {
    await first.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    await executeSql(first, await legacySchemaSql(parsed.toString()));
    const owner = await first.user.create({ data: { name: '旧用户', englishName: 'Legacy User', email: 'legacy@example.invalid' } });
    const conversation = await first.chatConversation.create({ data: { userId: owner.id, title: '已有对话' } });
    // Deliberately insert before either nullable column exists, exactly as the old application did.
    await first.$executeRaw`INSERT INTO "ChatMessage" ("id", "conversationId", "role", "content", "attachments", "toolSteps") VALUES
      ('legacy-question', ${conversation.id}, 'user', '保留原问题', '[{"name":"existing.pdf"}]'::jsonb, NULL),
      ('legacy-answer', ${conversation.id}, 'assistant', '保留原回答', NULL, '[{"status":"ok","tool":"existing"}]'::jsonb)`;
    const before = await first.$queryRaw<Array<Record<string, unknown>>>`SELECT * FROM "ChatMessage" ORDER BY "id"`;
    for (const name of ['20260902120000_add_chat_message_client_id', '20260907093000_chat_file_archives', '20260908120000_chat_page_context', '20260908160000_chat_delivery_checks']) {
      await executeSql(first, await readFile(join(migrations, name, 'migration.sql'), 'utf8'));
    }

    await t.test('incremental migrations preserve all legacy message data and nullable-key compatibility', async () => {
      const after = await second.chatMessage.findMany({ orderBy: { id: 'asc' } });
      assert.deepEqual(after.map(({ pageContext, clientMessageId, ...old }) => {
        assert.equal(pageContext, null); assert.equal(clientMessageId, null); return old;
      }), before);
      const payload = { conversationId: conversation.id, role: 'user', content: '新问题', clientMessageId: 'stable-request', pageContext: pageRef('root') };
      const messages = await Promise.allSettled([first.chatMessage.create({ data: payload }), second.chatMessage.create({ data: payload })]);
      assert.equal(messages.filter((result) => result.status === 'fulfilled').length, 1);
      assert.equal(await first.chatMessage.count({ where: { conversationId: conversation.id, clientMessageId: 'stable-request' } }), 1);
      assert.equal(await first.chatMessage.count({ where: { conversationId: conversation.id, clientMessageId: null } }), 2);
    });

    await t.test('restart and concurrent reads of JSONB do not edit the persisted checklist', async () => {
      const h = await harness(first, second);
      const created = await h.create();
      const stored = await first.chatDeliveryCheck.findUniqueOrThrow({ where: { id: created.id } });
      const results = await Promise.all([h.a.list(h.conversationId, h.user), h.b.list(h.conversationId, h.user), h.b.list(h.conversationId, h.user)]);
      for (const result of results) assert.deepEqual(result, [created]);
      const reread = await second.chatDeliveryCheck.findUniqueOrThrow({ where: { id: created.id } });
      assert.equal(reread.revision, 1); assert.equal(reread.updatedAt.getTime(), stored.updatedAt.getTime());
      assert.ok(!JSON.stringify(reread.checklist).includes('synthetic-only/'));
    });

    await t.test('competing confirmations on separate connections commit exactly one winner', async () => {
      const h = await harness(first, second); const created = await h.create();
      h.afterCollect(rendezvous(2));
      const changes = ['report', 'other-report'].map((id) => ({ revision: created.revision, updates: [{ id: 'testing', status: 'confirmed', evidenceFileIds: [id] }] }));
      const results = await Promise.allSettled([h.a.update(created.id, changes[0], h.user), h.b.update(created.id, changes[1], h.user)]);
      h.afterCollect();
      const won = results.findIndex((result) => result.status === 'fulfilled');
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      const rejected = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
      assert.equal(rejected.reason.getStatus(), 409);
      const persisted = (await h.b.list(h.conversationId, h.user))[0];
      assert.equal(persisted.revision, 2);
      assert.deepEqual(persisted.rows[0].evidenceFileIds, changes[won].updates[0].evidenceFileIds);
    });

    await t.test('changed or removed evidence loses confirmation durably; failed sources leave the previous result intact', async () => {
      const h = await harness(first, second); const created = await h.create();
      const confirmed = await h.a.update(created.id, { revision: created.revision, updates: [{ id: 'testing', status: 'confirmed', evidenceFileIds: ['report'] }] }, h.user);
      h.failSource(true);
      await assert.rejects(h.b.list(h.conversationId, h.user), /没有生成检查结论/);
      assert.equal((await first.chatDeliveryCheck.findUniqueOrThrow({ where: { id: created.id } })).revision, confirmed.revision);
      h.failSource(false); h.setFiles([exampleFile('report', { revision: 'v2' })]);
      const invalidated = (await h.b.list(h.conversationId, h.user))[0];
      assert.equal(invalidated.revision, confirmed.revision + 1);
      assert.equal(invalidated.rows[0].status, 'candidate'); assert.deepEqual(invalidated.rows[0].evidenceFileIds, []);
      assert.equal(invalidated.rows[0].confirmedAt, null);
      const reconfirmed = await h.a.update(created.id, { revision: invalidated.revision, updates: [{ id: 'testing', status: 'confirmed', evidenceFileIds: ['report'] }] }, h.user);
      h.setFiles([]);
      const removed = (await h.b.list(h.conversationId, h.user))[0];
      assert.equal(removed.revision, reconfirmed.revision + 1); assert.equal(removed.rows[0].status, 'missing');
      assert.deepEqual(removed.rows[0].evidenceFileIds, []);
      assert.deepEqual((await h.a.list(h.conversationId, h.user))[0], removed);
    });

    await t.test('archive gate rejects unconfirmed/stale results and enqueues one selected evidence snapshot across concurrent requests', async () => {
      const h = await harness(first, second); const created = await h.create();
      await assert.rejects(h.a.archive(created.id, { revision: created.revision }, h.user), /先核对/);
      assert.equal(await first.chatArchiveJob.count({ where: { conversationId: h.conversationId } }), 0);
      const confirmed = await h.a.update(created.id, { revision: created.revision, updates: [{ id: 'testing', status: 'confirmed', evidenceFileIds: ['report'] }] }, h.user);
      h.afterCollect(rendezvous(2));
      const results = await Promise.allSettled([h.a.archive(created.id, { revision: confirmed.revision }, h.user), h.b.archive(created.id, { revision: confirmed.revision }, h.user)]);
      h.afterCollect();
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      assert.equal((results.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason.getStatus(), 409);
      const jobs = await second.chatArchiveJob.findMany({ where: { conversationId: h.conversationId } });
      assert.equal(jobs.length, 1); assert.equal(jobs[0].status, 'queued');
      assert.deepEqual((jobs[0].files as unknown as FileRef[]).map((file) => file.id), ['report']);
      const current = (await h.b.list(h.conversationId, h.user))[0];
      h.setFiles([exampleFile('report', { revision: 'v2' })]);
      await assert.rejects(h.a.archive(created.id, { revision: current.revision }, h.user), /刷新/);
      assert.equal(await first.chatArchiveJob.count({ where: { conversationId: h.conversationId } }), 1);
      assert.equal((await h.b.list(h.conversationId, h.user))[0].rows[0].status, 'candidate');
    });

    await t.test('database permission changes are enforced by a new service instance and conversation deletion cascades persisted checks', async () => {
      const h = await harness(first, second); const created = await h.create();
      await first.role.update({ where: { id: h.roleId }, data: { permissions: [] } });
      await assert.rejects(h.b.list(h.conversationId, h.user), /权限/);
      await assert.rejects(h.b.archive(created.id, { revision: created.revision }, h.user), /权限/);
      await first.chatConversation.delete({ where: { id: h.conversationId } });
      assert.equal(await second.chatDeliveryCheck.count({ where: { id: created.id } }), 0);
    });

    await t.test('page bindings serialize across services and reject cross-conversation answers without partial bindings', async () => {
      const h = await harness(first, second);
      const question = await first.chatMessage.create({ data: { conversationId: h.conversationId, role: 'user', content: '检查资料' } });
      const answers = await Promise.all([first, second].map((client) => client.chatMessage.create({ data: { conversationId: h.conversationId, role: 'assistant', content: '' } })));
      const makeChat = (client: PrismaClient) => Object.assign(Object.create(ChatService.prototype), { prisma: client }) as {
        bindToolPageContext: (questionId: string, answerId: string, ref: ReturnType<typeof pageRef>) => Promise<void>;
      };
      // No chat provider is configured or called: this exercises the production persistence transaction directly.
      const a = makeChat(first), b = makeChat(second);
      const results = await Promise.allSettled([a.bindToolPageContext(question.id, answers[0].id, pageRef('root')), b.bindToolPageContext(question.id, answers[1].id, pageRef('other'))]);
      const won = results.findIndex((result) => result.status === 'fulfilled');
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      assert.match((results.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason.message, /已关联另一任务/);
      const savedQuestion = await first.chatMessage.findUniqueOrThrow({ where: { id: question.id } });
      const savedWinner = await second.chatMessage.findUniqueOrThrow({ where: { id: answers[won].id } });
      const savedLoser = await first.chatMessage.findUniqueOrThrow({ where: { id: answers[1 - won].id } });
      assert.deepEqual(savedQuestion.pageContext, savedWinner.pageContext); assert.equal(savedLoser.pageContext, null);
      const otherConversation = await first.chatConversation.create({ data: { userId: h.user.userId } });
      const wrongAnswer = await first.chatMessage.create({ data: { conversationId: otherConversation.id, role: 'assistant', content: '' } });
      const newQuestion = await first.chatMessage.create({ data: { conversationId: h.conversationId, role: 'user', content: '独立问题' } });
      await assert.rejects(a.bindToolPageContext(newQuestion.id, wrongAnswer.id, pageRef('root')), /尚未保存/);
      assert.equal((await second.chatMessage.findUniqueOrThrow({ where: { id: newQuestion.id } })).pageContext, null);
      await b.bindToolPageContext(newQuestion.id, answers[1 - won].id, pageRef('root'));
      assert.deepEqual((await first.chatMessage.findUniqueOrThrow({ where: { id: newQuestion.id } })).pageContext, pageRef('root'));
    });
  } finally {
    await first.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await Promise.all([first.$disconnect(), second.$disconnect()]);
  }
});
