import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { ChatArchiveService } from '../src/modules/chat/chat-archive.service';
import { CatalogFile } from '../src/modules/chat/chat-file-catalog.service';

const rawUrl = process.env.CHAT_ARCHIVE_TEST_DATABASE_URL;
test('隔离 PostgreSQL：迁移、跨实例幂等、队列抢占、租约恢复、旧执行者隔离', { skip: !rawUrl }, async () => {
  const parsed = new URL(rawUrl!);
  // 不接受项目默认 DATABASE_URL，也不允许远程地址或业务库。schema 仅在此测试中生成。
  assert.equal(parsed.hostname, 'localhost');
  assert.match(parsed.searchParams.get('host') ?? '', /^\/private\/tmp\/matechat-archive-db-[A-Za-z0-9]+$/);
  const schema = `archive_test_${randomBytes(8).toString('hex')}`;
  parsed.searchParams.set('schema', schema);
  parsed.searchParams.set('connection_limit', '4');
  const first = new PrismaClient({ datasources: { db: { url: parsed.toString() } } });
  const second = new PrismaClient({ datasources: { db: { url: parsed.toString() } } });
  try {
    await first.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    const migration = await readFile(`${__dirname}/../prisma/migrations/20260907093000_chat_file_archives/migration.sql`, 'utf8');
    for (const sql of migration.split(';').map((s) => s.trim()).filter(Boolean)) await first.$executeRawUnsafe(sql);
    const file: CatalogFile = { id: 'file', source: 'task', scope: 'rd', resourceId: 'task/note/file', name: 'example.txt', mime: 'text/plain', size: 4,
      createdAt: new Date().toISOString(), uploader: 'tester', folder: 'test', revision: 'r', objectKey: 'test-only' };
    const catalog = { collect: async () => ({ files: [file], warnings: [] }), resolve: async () => new Map([[file.id, file]]) };
    const wrap = (client: PrismaClient) => new Proxy(client, { get(target, key) {
      if (key === 'chatConversation') return { findFirst: async () => ({ id: 'conv' }) };
      if (key === 'user') return { findUnique: async () => ({ id: 'u', name: 'tester', status: 'ACTIVE', role: { permissions: ['*'] } }) };
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } });
    const make = (client: PrismaClient) => new ChatArchiveService(wrap(client) as never, catalog as never, { isEnabled: true } as never, { filterDisabled: async (p: unknown) => p } as never);
    const a = make(first), b = make(second);
    const user = { userId: 'u', permissions: ['*'] };
    const found = await a.search({}, user, 'conv');
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => (i % 2 ? a : b).create({ selection_ids: [found.selectionId] }, user, 'conv')));
    assert.equal(new Set(results.map((r) => r.id)).size, 1);
    assert.equal(await first.chatArchiveJob.count(), 1);
    const claims: any[] = [];
    a.process = b.process = async (job) => { claims.push(job); };
    await Promise.all([a.tick(), b.tick(), a.tick()]);
    assert.equal(claims.length, 1);
    await first.chatArchiveJob.update({ where: { id: results[0].id }, data: { leaseUntil: new Date(0) } });
    await b.tick(); assert.equal(claims.length, 2);
    assert.notEqual(claims[0].claimToken, claims[1].claimToken);
    const late = await first.chatArchiveJob.updateMany({ where: { id: claims[0].id, claimToken: claims[0].claimToken }, data: { status: 'succeeded' } });
    assert.equal(late.count, 0);
    await a.cancel(results[0].id, 'u');
    assert.equal((await second.chatArchiveJob.findUniqueOrThrow({ where: { id: results[0].id } })).cancelRequested, true);
    // 真实事务回滚后锁可重新取得。
    await assert.rejects(first.$transaction(async (tx) => { await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('archive-rollback-test'))`; throw new Error('rollback'); }));
    await second.$transaction(async (tx) => { await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('archive-rollback-test'))`; });
  } finally {
    await first.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await Promise.all([first.$disconnect(), second.$disconnect()]);
  }
});
