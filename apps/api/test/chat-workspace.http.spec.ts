import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { IncomingMessage, ServerResponse, type Server } from 'node:http';
import { Duplex } from 'node:stream';
import type { Socket } from 'node:net';
import { test } from 'node:test';
import { ForbiddenException, ValidationPipe, type Type } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { GlobalExceptionFilter } from '../src/common/global-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../src/modules/auth/guards/roles.guard';
import { JwtStrategy } from '../src/modules/auth/strategies/jwt.strategy';
import { ChatModule } from '../src/modules/chat/chat.module';
import { ChatService } from '../src/modules/chat/chat.service';
import { ChatArchiveService } from '../src/modules/chat/chat-archive.service';
import { ChatDeliveryService } from '../src/modules/chat/chat-delivery.service';
import { ChatPageContextService } from '../src/modules/chat/chat-page-context.service';
import { CatalogFile, ChatFileCatalogService, matchesFile } from '../src/modules/chat/chat-file-catalog.service';
import { OssModule } from '../src/modules/oss/oss.module';
import { OssService } from '../src/modules/oss/oss.service';
import { PermissionCatalogModule } from '../src/modules/permission-catalog/permission-catalog.module';
import { PermissionCatalogService } from '../src/modules/permission-catalog/permission-catalog.service';
import { ResearchDevelopmentService } from '../src/modules/research-development/research-development.service';

// Only the transport is in memory: requests still traverse Express body parsing,
// Passport JWT verification, Nest guards/pipes, real controllers and real services.
// No listen(), local .env, database, model, or remote storage access is involved.
async function request(server: Server, method: string, path: string, body?: unknown, token?: string) {
  const chunks: Buffer[] = [];
  const socket = new Duplex({ read() {}, write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
  const req = new IncomingMessage(socket as Socket);
  req.method = method;
  req.url = `/api${path}`;
  req.httpVersion = '1.1';
  req.httpVersionMajor = 1;
  req.httpVersionMinor = 1;
  req.complete = true;
  req.headers = { host: 'matechat-smoke.invalid', connection: 'close', ...(token ? { authorization: `Bearer ${token}` } : {}) };
  const encoded = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  if (encoded) Object.assign(req.headers, { 'content-type': 'application/json', 'content-length': String(encoded.length) });
  const res = new ServerResponse(req);
  res.assignSocket(socket as Socket);
  const finished = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`HTTP injection stalled: ${method} ${path}; ended=${res.writableEnded}; chunks=${Buffer.concat(chunks).toString('utf8')}`)), 2000);
    res.once('finish', () => { clearTimeout(timeout); resolve(); });
    res.once('error', reject);
  });
  if (encoded) req.push(encoded);
  req.push(null);
  server.emit('request', req, res);
  await finished;
  const response = Buffer.concat(chunks).toString('utf8');
  socket.destroy();
  const separator = response.indexOf('\r\n\r\n');
  assert.notEqual(separator, -1, 'Expected a complete HTTP response');
  return { status: res.statusCode, body: JSON.parse(response.slice(separator + 4)) as any };
}

// Keep module imports/exports and every chat provider intact. External provider
// implementations are replaced, so unrelated lifecycle work cannot reach a real
// database or an AI/storage service while Nest still validates ChatModule's DI.
function externalProviders(module: Type, seen = new Set<Type>()): Type[] {
  if (seen.has(module) || module === ConfigModule) return [];
  seen.add(module);
  const local = module === ChatModule ? [] : (Reflect.getMetadata(MODULE_METADATA.PROVIDERS, module) ?? []);
  const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, module) ?? [];
  return [...local.filter((provider: unknown) => typeof provider === 'function'),
    ...imports.flatMap((imported: Type) => externalProviders(imported, seen))];
}

function unusedProvider(name: string) {
  return new Proxy({}, {
    get(_target, property) {
      if (typeof property !== 'string' || property === 'then' || property === 'constructor'
        || property.startsWith('on') || property === 'beforeApplicationShutdown') return undefined;
      return () => { throw new Error(`Unexpected external provider call: ${name}.${property}`); };
    },
  });
}

function fixtures() {
  const checks: any[] = [], selections: any[] = [], jobs: any[] = [];
  let sequence = 0;
  let permissions = ['*'];
  let active = true;
  let taskTitle = '合成交付项目';
  let taskReads = 0;
  let catalogReads = 0;
  const source: CatalogFile = {
    id: 'evidence_1', source: 'task', scope: 'rd', taskId: 'child_task', ancestorIds: ['root_task', 'child_task'],
    resourceId: 'child_task/note/evidence_1', name: '测试报告.pdf', mime: 'application/pdf', size: 123,
    createdAt: '2026-09-08T08:00:00Z', uploader: '合成用户', folder: 'rd/合成交付项目', revision: 'file-v1', objectKey: 'synthetic-private/report.pdf',
  };
  const matches = (row: any, where: any): boolean => Object.entries(where ?? {}).every(([key, value]: [string, any]) => {
    if (!value || typeof value !== 'object') return row[key] === value;
    if ('in' in value) return value.in.includes(row[key]);
    if ('gt' in value) return row[key] > value.gt;
    throw new Error(`Unsupported fixture predicate: ${key}`);
  });
  const delegate = (rows: any[]) => ({
    findFirst: async ({ where }: any) => structuredClone(rows.find((row) => matches(row, where)) ?? null),
    findUnique: async ({ where }: any) => structuredClone(rows.find((row) => matches(row, where)) ?? null),
    findMany: async ({ where, take }: any) => structuredClone(rows.filter((row) => matches(row, where)).slice(0, take)),
    count: async ({ where }: any) => rows.filter((row) => matches(row, where)).length,
    create: async ({ data }: any) => {
      const row = { id: `record_${++sequence}`, revision: 1, checkedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
        status: 'queued', processed: 0, succeeded: 0, failed: 0, bytes: 0n, cancelRequested: false, error: null, ...structuredClone(data) };
      rows.push(row); return structuredClone(row);
    },
    updateMany: async ({ where, data }: any) => {
      const selected = rows.filter((row) => matches(row, where));
      for (const row of selected) {
        for (const [key, value] of Object.entries(data)) row[key] = value && typeof value === 'object' && 'increment' in value
          ? row[key] + (value as any).increment : structuredClone(value);
        row.updatedAt = new Date();
      }
      return { count: selected.length };
    },
  });
  const prisma: any = {
    chatDeliveryCheck: delegate(checks), chatFileSelection: delegate(selections), chatArchiveJob: delegate(jobs),
    chatConversation: { findFirst: async ({ where }: any) => where.id === 'conversation_1' && where.userId === 'user_1' ? { id: where.id } : null },
    user: { findUnique: async ({ where }: any) => ['user_1', 'user_2'].includes(where.id) ? {
      id: where.id, name: '合成用户', email: `${where.id}@example.invalid`, roleId: 'synthetic_role', department: null,
      status: active ? 'ACTIVE' : 'DISABLED', role: { name: '合成角色', permissions },
    } : null },
    systemSetting: { findUnique: async () => null },
    $executeRaw: async () => 1,
    $transaction: async (run: (tx: unknown) => Promise<unknown>) => run(prisma),
  };
  const catalog = {
    collect: async (_user: unknown, filter: any) => {
      catalogReads++;
      return { files: [structuredClone(source)].filter((file) => matchesFile(file, filter)), warnings: [] };
    },
  };
  const rd = { resolveChatTask: async (taskId: string, viewer: any) => {
    taskReads++;
    if (taskId !== 'root_task' || viewer.userId !== 'user_1') throw new ForbiddenException('当前任务不可读取');
    return { taskId, title: taskTitle, fields: { status: '进行中' } };
  } };
  const oss = { isEnabled: true, getSignedUrl: (key: string, expiry: number) => {
    assert.equal(key, source.objectKey); assert.equal(expiry, 60);
    return 'https://example.invalid/synthetic-preview?expires=60';
  } };
  return { prisma, catalog, rd, oss, checks, jobs, source,
    reads: () => ({ taskReads, catalogReads }), setPermissions: (value: string[]) => { permissions = value; },
    setActive: (value: boolean) => { active = value; }, setTitle: (value: string) => { taskTitle = value; } };
}

test('MateChat workspace HTTP runtime: real module, JWT, validation and delivery lifecycle', { timeout: 20000 }, async (t) => {
  const h = fixtures();
  const jwtSecret = 'synthetic-matechat-workspace-smoke-key-not-for-deployment';
  const config = { get: (key: string) => key === 'JWT_SECRET' ? jwtSecret : undefined,
    getOrThrow: (key: string) => { assert.equal(key, 'JWT_SECRET'); return jwtSecret; } };
  const builder = Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, skipProcessEnv: true }), ChatModule, OssModule,
      PermissionCatalogModule, PassportModule, JwtModule.register({ secret: jwtSecret })],
    providers: [JwtStrategy, { provide: APP_GUARD, useClass: JwtAuthGuard }, { provide: APP_GUARD, useClass: RolesGuard }],
  });
  for (const provider of [...externalProviders(ChatModule), ...externalProviders(OssModule)]) {
    builder.overrideProvider(provider).useValue(unusedProvider(provider.name));
  }
  builder.overrideProvider(ConfigService).useValue(config);
  builder.overrideProvider(PrismaService).useValue(h.prisma);
  builder.overrideProvider(ResearchDevelopmentService).useValue(h.rd);
  builder.overrideProvider(PermissionCatalogService).useValue({ filterDisabled: async (codes: string[]) => codes });
  builder.overrideProvider(OssService).useValue(h.oss);
  builder.overrideProvider(ChatFileCatalogService).useValue(h.catalog);
  const module = await builder.compile();
  const app = module.createNestApplication({ logger: false });
  try {
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    for (const provider of [ChatService, ChatPageContextService, ChatDeliveryService, ChatArchiveService]) {
      assert.ok(app.get(provider) instanceof provider, `${provider.name} must be the real Nest provider`);
    }
    const jwt = module.get(JwtService);
    const token = jwt.sign({ sub: 'user_1', permissions: ['*'] });
    const otherToken = jwt.sign({ sub: 'user_2', permissions: ['*'] });
    const send = (method: string, path: string, body?: unknown, bearer: string | undefined = token) => request(app.getHttpServer(), method, path, body, bearer);
    const pageContext = { schemaVersion: 1, pageKey: 'rd_task_detail', scope: 'entity',
      refs: [{ entityType: 'rd_task', entityId: 'root_task', workspace: 'rd' }], capturedAt: '2026-09-08T08:00:00Z' };
    let check: any;

    await t.test('authentication runs before all workspace controller handlers', async () => {
      for (const [method, path] of [['POST', '/chat/page-context/resolve'], ['POST', '/chat/delivery-checks'],
        ['GET', '/chat/delivery-checks?conversationId=conversation_1'], ['PATCH', '/chat/delivery-checks/record_1'],
        ['POST', '/chat/delivery-checks/record_1/refresh'], ['POST', '/chat/delivery-checks/record_1/archive'],
        ['POST', '/chat/delivery-checks/record_1/files/evidence_1/preview']]) {
        assert.equal((await request(app.getHttpServer(), method, path, method === 'GET' ? undefined : {})).status, 401);
      }
      for (const bearer of ['invalid.jwt', jwt.sign({ sub: 'user_1' }, { expiresIn: -1 }),
        new JwtService({ secret: 'wrong-synthetic-key' }).sign({ sub: 'user_1' })]) {
        assert.equal((await send('POST', '/chat/page-context/resolve', { pageContext }, bearer)).status, 401);
      }
      assert.deepEqual(h.reads(), { taskReads: 0, catalogReads: 0 });
    });

    await t.test('global nested DTO validation rejects client-supplied context content', async () => {
      for (const body of [{}, { pageContext: { ...pageContext, prompt: 'untrusted instructions' } },
        { pageContext: { ...pageContext, refs: [{ ...pageContext.refs[0], title: 'untrusted title' }] } },
        { pageContext: { ...pageContext, refs: [] } }, { pageContext: { ...pageContext, capturedAt: 'yesterday' } }]) {
        assert.equal((await send('POST', '/chat/page-context/resolve', body)).status, 400);
      }
      assert.deepEqual(h.reads(), { taskReads: 0, catalogReads: 0 });
      const first = await send('POST', '/chat/page-context/resolve', { pageContext });
      assert.equal(first.status, 201); assert.equal(first.body.status, 'resolved');
      assert.equal(first.body.entity.canonicalUrl, '/rd-task/root_task'); assert.equal(first.body.shareBlocked, true);
      h.setTitle('更新后的合成项目');
      assert.equal((await send('POST', '/chat/page-context/resolve', { pageContext })).body.entity.title, '更新后的合成项目');
      const future = await send('POST', '/chat/page-context/resolve', { pageContext: { ...pageContext, schemaVersion: 2 } });
      assert.equal(future.status, 201); assert.equal(future.body.status, 'unavailable');
    });

    await t.test('delivery creates and restores a scoped checklist without exposing object keys', async () => {
      assert.equal((await send('POST', '/chat/delivery-checks', { taskId: 'root_task' })).status, 400);
      assert.equal((await send('GET', '/chat/delivery-checks')).status, 400);
      const created = await send('POST', '/chat/delivery-checks', { conversationId: 'conversation_1', taskId: 'root_task', requirements: [
        { id: 'testing', title: '测试报告', keywords: ['测试'], required: true },
        { id: 'manual', title: '使用说明', keywords: ['说明'], required: true },
      ] });
      assert.equal(created.status, 201); check = created.body;
      assert.equal(check.taskTitle, '更新后的合成项目');
      assert.deepEqual(check.rows.map((row: any) => row.status), ['candidate', 'missing']);
      assert.equal(check.rows[0].candidates[0].id, 'evidence_1');
      assert.equal(check.summary.unresolvedRequired, 2);
      assert.ok(!JSON.stringify(check).includes('synthetic-private'));
      const listed = await send('GET', '/chat/delivery-checks?conversationId=conversation_1');
      assert.equal(listed.status, 200); assert.deepEqual(listed.body, [check]);
    });

    await t.test('preview and explicit confirmation enforce file identity and optimistic revisions', async () => {
      const path = `/chat/delivery-checks/${check.id}`;
      assert.equal((await send('POST', `${path}/files/evidence_1/preview`, {})).status, 400);
      assert.equal((await send('POST', `${path}/files/unknown/preview`, { revision: check.revision })).status, 404);
      const preview = await send('POST', `${path}/files/evidence_1/preview`, { revision: check.revision });
      assert.equal(preview.status, 201); assert.equal(preview.body.expiresIn, 60); assert.equal(preview.body.isTaskPage, false);
      assert.equal(preview.body.url, 'https://example.invalid/synthetic-preview?expires=60');
      assert.equal((await send('PATCH', path, { revision: String(check.revision), updates: [] })).status, 400);
      assert.equal((await send('PATCH', path, { revision: check.revision, updates: [{ id: 'testing', status: 'confirmed' }] })).status, 400);
      const confirmed = await send('PATCH', path, { revision: check.revision, updates: [
        { id: 'testing', status: 'confirmed', evidenceFileIds: ['evidence_1'] },
      ] });
      assert.equal(confirmed.status, 200); check = confirmed.body;
      assert.equal(check.revision, 2); assert.equal(check.rows[0].status, 'confirmed');
      assert.equal(check.summary.unresolvedRequired, 1);
      assert.equal((await send('POST', `${path}/refresh`, { revision: 1 })).status, 409);
      assert.equal((await send('POST', `${path}/archive`, { revision: 1 })).status, 409);
    });

    await t.test('archive HTTP contract queues only confirmed evidence and returns its refreshed checklist', async () => {
      const result = await send('POST', `/chat/delivery-checks/${check.id}/archive`, { revision: check.revision, filename: '合成交付资料' });
      assert.equal(result.status, 201); check = result.body.check;
      assert.equal(check.revision, 3); assert.equal(result.body.archive.status, 'queued');
      assert.equal(result.body.archive.total, 1); assert.equal(result.body.archive.filename, '合成交付资料.zip');
      assert.equal(h.jobs.length, 1); assert.deepEqual(h.jobs[0].files.map((file: any) => file.id), ['evidence_1']);
      const jobs = await send('GET', '/chat/conversations/conversation_1/archives');
      assert.equal(jobs.status, 200); assert.deepEqual(jobs.body, [result.body.archive]);
      assert.equal((await send('POST', `/chat/archives/${result.body.archive.id}/download`, {})).status, 400);
    });

    await t.test('fresh database permissions and ownership override even a signed wildcard claim', async () => {
      const path = `/chat/delivery-checks/${check.id}`;
      assert.equal((await send('GET', '/chat/delivery-checks?conversationId=conversation_1', undefined, otherToken)).status, 404);
      assert.equal((await send('PATCH', path, { revision: check.revision, updates: [] }, otherToken)).status, 404);
      const reads = h.reads();
      h.setPermissions([]);
      assert.equal((await send('GET', '/chat/delivery-checks?conversationId=conversation_1')).status, 403);
      assert.equal((await send('POST', `${path}/files/evidence_1/preview`, { revision: check.revision })).status, 403);
      const unavailable = await send('POST', '/chat/page-context/resolve', { pageContext });
      assert.equal(unavailable.status, 201); assert.equal(unavailable.body.status, 'unavailable');
      assert.equal(unavailable.body.entity, undefined); assert.deepEqual(h.reads(), reads);
      h.setPermissions(['*']); h.setActive(false);
      assert.equal((await send('GET', '/chat/delivery-checks?conversationId=conversation_1')).status, 401);
      h.setActive(true);
      h.source.revision = 'file-v2';
      const refreshed = await send('POST', `${path}/refresh`, { revision: check.revision });
      assert.equal(refreshed.status, 201); assert.equal(refreshed.body.rows[0].status, 'candidate');
      assert.deepEqual(refreshed.body.rows[0].evidenceFileIds, []);
    });
  } finally {
    await app.close();
  }
});
