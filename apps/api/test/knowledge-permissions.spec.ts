import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { NotFoundException } from '@nestjs/common';
import { ResearchDevelopmentService } from '../src/modules/research-development/research-development.service';
import { ResearchDevelopmentController } from '../src/modules/research-development/research-development.controller';
import { DeptKnowledgeController } from '../src/modules/research-development/dept-knowledge.controller';
import { RagService } from '../src/modules/rag/rag.service';

function knowledgeHarness(level = 20) {
  let entries: Record<string, unknown>[] = [{ id: 'entry-1', title: '测试文档', permission_level: level, visibility: 'internal', archived: false }];
  const events: string[] = [];
  const documents: Array<{ metadata: Record<string, unknown> }> = [];
  const service = Object.create(ResearchDevelopmentService.prototype) as ResearchDevelopmentService;
  Object.assign(service, {
    readValue: async () => structuredClone(entries),
    writeValue: async (_key: string, value: Record<string, unknown>[]) => { events.push('write'); entries = structuredClone(value); },
    resolveViewerKbLevel: async () => 20,
    resolveDeptKbViewerLevel: async () => 20,
    resolveKnowledgeCategoryId: async (id: string) => id || 'kb-other',
    recordKnowledgeAudit: async () => {},
    ragService: {
      removeChunksForSource: async () => { events.push('remove'); },
      syncDocument: async (document: { metadata: Record<string, unknown> }) => { events.push('sync'); documents.push(document); },
    },
  });
  return { service, events, documents, entries: () => entries, entry: () => entries.find((entry) => entry.id === 'entry-1')! };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

test('移动和删除接口必须检查对象可见性，合法成员及管理员操作保持可用', async () => {
  for (const dept of [false, true]) {
    for (const operation of ['move', 'delete']) {
      const run = (service: ResearchDevelopmentService, manager = false) => {
        const req = { user: { id: 'member', permissions: [manager ? '*' : `${dept ? 'dept-kb' : 'rd-kb'}:entry:${operation}`] } };
        if (dept) {
          const controller = new DeptKnowledgeController(service, {} as never, {} as never);
          return operation === 'move'
            ? controller.moveEntry('purchasing', 'entry-1', { category_id: 'target' }, req)
            : controller.deleteEntry('purchasing', 'entry-1', req);
        }
        const controller = new ResearchDevelopmentController(service, {} as never, {} as never);
        return operation === 'move'
          ? controller.moveKnowledgeEntry('entry-1', { category_id: 'target' }, req)
          : controller.deleteKnowledgeEntry('entry-1', req);
      };
      const hidden = knowledgeHarness(80);
      await assert.rejects(run(hidden.service), NotFoundException);
      assert.deepEqual(hidden.events, []);
      const visible = knowledgeHarness();
      await run(visible.service);
      assert.equal(visible.entry()[operation === 'move' ? 'category_id' : 'archived'], operation === 'move' ? 'target' : true);
      await run(hidden.service, true);
      assert.equal(hidden.entry()[operation === 'move' ? 'category_id' : 'archived'], operation === 'move' ? 'target' : true);
    }
  }
});

test('成员编辑先开始、管理员随后提密时，晚返回编辑不能回滚管理员密级', async () => {
  const h = knowledgeHarness();
  const blocked = deferred();
  const release = deferred();
  const rag = (h.service as any).ragService;
  let removes = 0;
  const originalRemove = rag.removeChunksForSource;
  rag.removeChunksForSource = async () => {
    if (++removes === 1) { blocked.resolve(); await release.promise; }
    await originalRemove();
  };
  const controller = new ResearchDevelopmentController(h.service, {} as never, {} as never);
  const member = controller.updateKnowledgeEntry('entry-1', { title: '成员修改' }, { user: { id: 'member', permissions: ['rd-kb:upload'] } });
  await blocked.promise;
  const admin = controller.updateKnowledgeEntry('entry-1', { permission_level: 80 }, { user: { id: 'admin', permissions: ['rd-kb:manage'] } });
  await new Promise<void>((resolve) => setImmediate(resolve));
  release.resolve();
  await Promise.all([member, admin]);
  assert.equal(h.entry().permission_level, 80);
  assert.equal(h.entry().title, '成员修改');
});

test('成员前置读取后管理员提密，排队的编辑移动删除须在写锁内重新鉴权', async () => {
  for (const dept of [false, true]) {
    for (const operation of ['update', 'move', 'delete']) {
      const h = knowledgeHarness();
      const preflight = deferred();
      const release = deferred();
      const originalGet = h.service.getKnowledgeEntryById.bind(h.service);
      h.service.getKnowledgeEntryById = async (...args) => {
        const entry = await originalGet(...args);
        if (args[1]?.userId === 'member') { preflight.resolve(); await release.promise; }
        return entry;
      };
      const controller = dept ? new DeptKnowledgeController(h.service, {} as never, {} as never) : new ResearchDevelopmentController(h.service, {} as never, {} as never);
      const req = { user: { id: 'member', permissions: [`${dept ? 'dept-kb' : 'rd-kb'}:entry:${operation === 'update' ? 'edit' : operation}`] } };
      const member = dept
        ? operation === 'update' ? (controller as DeptKnowledgeController).updateEntry('purchasing', 'entry-1', { title: '禁止修改' }, req)
          : operation === 'move' ? (controller as DeptKnowledgeController).moveEntry('purchasing', 'entry-1', { category_id: 'target' }, req)
            : (controller as DeptKnowledgeController).deleteEntry('purchasing', 'entry-1', req)
        : operation === 'update' ? (controller as ResearchDevelopmentController).updateKnowledgeEntry('entry-1', { title: '禁止修改' }, req)
          : operation === 'move' ? (controller as ResearchDevelopmentController).moveKnowledgeEntry('entry-1', { category_id: 'target' }, req)
            : (controller as ResearchDevelopmentController).deleteKnowledgeEntry('entry-1', req);
      const rejection = assert.rejects(member, NotFoundException);
      await preflight.promise;
      const adminEntered = deferred();
      const releaseAdmin = deferred();
      const rag = (h.service as any).ragService;
      const originalRemove = rag.removeChunksForSource;
      let held = false;
      rag.removeChunksForSource = async () => {
        if (!held) { held = true; adminEntered.resolve(); await releaseAdmin.promise; }
        await originalRemove();
      };
      const admin = h.service.updateKnowledgeEntry('entry-1', { permission_level: 80 }, dept ? 'purchasing' : undefined);
      await adminEntered.promise;
      release.resolve();
      await new Promise<void>((resolve) => setImmediate(resolve));
      releaseAdmin.resolve();
      await Promise.all([admin, rejection]);
      assert.equal(h.entry().permission_level, 80);
      assert.equal(h.entry().title, '测试文档');
      assert.equal(h.entry().archived, false);
      assert.equal(h.entry().category_id, undefined);
    }
  }
});

test('浏览计数、新建和文件名修复的整库写入不能覆盖并发提密', async () => {
  for (const operation of ['view', 'create', 'repair']) {
    const h = knowledgeHarness();
    const blocked = deferred();
    const release = deferred();
    const originalRead = (h.service as any).readValue;
    let reads = 0;
    (h.service as any).readValue = async (...args: unknown[]) => {
      const snapshot = await originalRead(...args);
      if (++reads === 1) { blocked.resolve(); await release.promise; }
      return snapshot;
    };
    const first = operation === 'view' ? h.service.incrementKbEntryViewCount('entry-1')
      : operation === 'create' ? h.service.createKnowledgeEntry({ title: '新文件', category_id: 'kb-other' })
        : h.service.repairKbFilenameEncoding();
    await blocked.promise;
    const admin = h.service.updateKnowledgeEntry('entry-1', { permission_level: 80 });
    await new Promise<void>((resolve) => setImmediate(resolve));
    release.resolve();
    await Promise.all([first, admin]);
    assert.equal(h.entry().permission_level, 80, operation);
    if (operation === 'view') assert.equal(h.entry().view_count, 1);
    if (operation === 'create') assert.equal(h.entries().length, 2);
  }
});

test('普通知识库编辑者不能通过任一密级字段降密，但仍能修改可见文档标题', async () => {
  for (const dept of [false, true]) {
    const { service, entry } = knowledgeHarness();
    const body = { title: '新标题', visibility: 'public', permission_level: 0 };
    const req = { user: { id: 'member', permissions: [dept ? 'dept-kb:entry:edit' : 'rd-kb:upload'] } };
    if (dept) await new DeptKnowledgeController(service, {} as never, {} as never).updateEntry('purchasing', 'entry-1', body, req);
    else await new ResearchDevelopmentController(service, {} as never, {} as never).updateKnowledgeEntry('entry-1', body, req);
    assert.equal(entry().permission_level, 20);
    assert.equal(entry().visibility, 'internal');
    assert.equal(entry().title, '新标题');
    assert.equal(body.visibility, 'public', '不能修改请求原对象');
  }
});

test('两套知识库都拒绝编辑不可见条目，不能通过已知ID直接降密', async () => {
  for (const dept of [false, true]) {
    const { service, entry, events } = knowledgeHarness(80);
    const req = { user: { id: 'member', permissions: [dept ? 'dept-kb:entry:edit' : 'rd-kb:upload'] } };
    await assert.rejects(dept
      ? new DeptKnowledgeController(service, {} as never, {} as never).updateEntry('purchasing', 'entry-1', { visibility: 'public' }, req)
      : new ResearchDevelopmentController(service, {} as never, {} as never).updateKnowledgeEntry('entry-1', { visibility: 'public' }, req), NotFoundException);
    assert.equal(entry().permission_level, 80);
    assert.deepEqual(events, []);
  }
});

test('管理员修改密级先撤销旧索引再写入，并以最新密级重建；归档不重建内容', async () => {
  const { service, entry, events, documents } = knowledgeHarness();
  const controller = new ResearchDevelopmentController(service, {} as never, {} as never);
  await controller.updateKnowledgeEntry('entry-1', { permission_level: 100 }, { user: { permissions: ['rd-kb:manage'] } });
  assert.equal(entry().permission_level, 100);
  assert.deepEqual(events, ['remove', 'write', 'sync']);
  assert.equal(documents[0].metadata.permission_level, 100);
  assert.equal(documents[0].metadata.kb_store_key, 'rd.knowledgeEntries');
  await service.updateKnowledgeEntry('entry-1', { archived: true });
  assert.equal(entry().archived, true);
  assert.equal(documents.length, 1);
  await service.updateKnowledgeEntry('entry-1', { archived: false });
  assert.equal(documents.length, 2, '恢复文档应重新索引');
});

test('撤销旧索引失败时不写入新的密级', async () => {
  const { service, entry, events } = knowledgeHarness();
  Object.assign(service, { ragService: { removeChunksForSource: async () => { throw new Error('storage unavailable'); } } });
  await assert.rejects(service.updateKnowledgeEntry('entry-1', { permission_level: 100 }), /storage unavailable/);
  assert.equal(entry().permission_level, 20);
  assert.deepEqual(events, []);
});

test('搜索用当前条目阻断旧索引：提密、归档、删除、旧修订及部门受限条目', async () => {
  let entry: Record<string, unknown> | null = { id: 'entry-1', permission_level: 0, archived: false, updated_at: 'v1' };
  let metadata: Record<string, unknown> = { permission_level: 0 };
  let settingsFail = false;
  const rag = new RagService({
    knowledgeChunk: { findMany: async () => [{ id: 'chunk', sourceType: 'kb', sourceId: 'entry-1', content: '旧索引内容', embedding: [1, 0], metadata }] },
    systemSetting: { findMany: async ({ where }: { where: { key: { in: string[] } } }) => {
      if (settingsFail) throw new Error('storage unavailable');
      return where.key.in.map((key) => ({ key, value: entry ? [entry] : [] }));
    } },
  } as never, {} as never, { embedOne: async () => [1, 0] } as never, {} as never);
  const user = { userId: 'member', permissions: ['page:rd-knowledge-base'], kbLevel: 0 };
  assert.equal((await rag.search('测试', user)).results.length, 1);
  entry = { ...entry, permission_level: 100 };
  assert.equal((await rag.search('测试', user)).results.length, 0);
  entry = { ...entry, permission_level: 0, archived: true };
  assert.equal((await rag.search('测试', { ...user, permissions: ['*'] })).results.length, 0);
  entry = null;
  assert.equal((await rag.search('测试', user)).results.length, 0);
  entry = { id: 'entry-1', permission_level: 0, updated_at: 'v2' };
  metadata = { permission_level: 0, source_updated_at: 'v1' };
  assert.equal((await rag.search('测试', user)).results.length, 0);
  metadata = { permission_level: 0, source_updated_at: 'v2' };
  assert.equal((await rag.search('测试', user)).results.length, 1);
  assert.equal((await rag.search('测试', { ...user, permissions: [] })).results.length, 0);
  metadata = { permission_level: 0, kb_id: 'purchasing' };
  entry = { ...entry, permission_level: 80 };
  assert.equal((await rag.search('测试', { ...user, permissions: ['page:dept-kb-purchasing'], kbLevel: 100 })).results.length, 0);
  settingsFail = true;
  await assert.rejects(rag.search('测试', user), /storage unavailable/, '权限源不可用时不能回退到旧索引权限');
});
