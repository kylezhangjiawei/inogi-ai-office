import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { RdMeetingTodosService } from '../src/modules/research-development/rd-meeting-todos.service';
import { runInRdWorkspace } from '../src/modules/research-development/rd-workspace.context';
import { RdMeetingTodosController } from '../src/modules/research-development/rd-meeting-todos.controller';
import { PrismaClient } from '@prisma/client';

const admin = { userId: 'admin', userName: '管理员', permissions: ['page:rd-task-management', 'rd-task:reassign'] };
const member = { userId: 'user-1', userName: '成员甲', permissions: ['page:rd-task-management', 'rd-task:edit'] };
const monday = '2026-10-05';

test('uncreated weeks return a JSON envelope rather than Nest empty responses', async () => {
  const controller = new RdMeetingTodosController({ getWeek: async () => null } as never);
  assert.deepEqual(await controller.read(monday, { user: { id: 'admin' } }), { week: null });
});

// Point only at a disposable socket-only database. No configured application database is read here.
test('PostgreSQL: concurrent writes keep one winner; audit failure rolls back both week and changes', { skip: !process.env.RD_MEETING_TEST_DATABASE_URL }, async () => {
  const url = new URL(process.env.RD_MEETING_TEST_DATABASE_URL!);
  assert.equal(url.hostname, 'localhost'); assert.equal(url.pathname, '/rd_meeting_test'); assert.equal(url.password, '');
  assert.match(url.searchParams.get('host') ?? '', /^\/private\/tmp\/rd-meeting-db-[A-Za-z0-9]+$/);
  const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  try {
    await prisma.$executeRawUnsafe(`CREATE TABLE "SystemSetting" ("id" TEXT PRIMARY KEY, "category" TEXT NOT NULL, "key" TEXT UNIQUE NOT NULL, "value" JSONB NOT NULL, "description" TEXT, "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP NOT NULL)`);
    await prisma.$executeRawUnsafe(`CREATE TABLE "AuditLog" ("id" TEXT PRIMARY KEY, "userId" TEXT, "action" TEXT NOT NULL, "resource" TEXT NOT NULL, "resourceId" TEXT, "meta" JSONB DEFAULT '{}', "ip" TEXT, "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP, "module" TEXT DEFAULT 'other', "source" TEXT DEFAULT 'api', "actorName" TEXT, "resourceName" TEXT, "summary" TEXT, "notes" JSONB DEFAULT '[]')`);
    const service = new RdMeetingTodosService(prisma as never, { getPeople: async () => [{ id: 'p1', name: '测试成员', status: 'active' }] } as never);
    await service.createWeek({ weekStart: monday }, admin);
    const results = await Promise.allSettled(['甲', '乙'].map(title => service.addItem(monday, { memberId: 'p1', title, revision: 1 }, admin)));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    const loser = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
    assert.equal(loser.reason.getStatus(), 409);
    const saved = (await service.getWeek(monday, admin))!;
    assert.equal(saved.revision, 2); assert.equal(saved.items.length, 1);
    assert.equal(await prisma.auditLog.count(), 2, 'losing write must not leave an audit entry');
    await prisma.$executeRawUnsafe(`ALTER TABLE "AuditLog" ADD CONSTRAINT "reject_updates" CHECK ("action" <> 'meeting_todo.updated')`);
    await assert.rejects(() => service.updateItem(monday, saved.items[0].id, { revision: 2, title: '不能保存' }, admin));
    assert.deepEqual(await service.getWeek(monday, admin), saved);
    assert.equal(await prisma.auditLog.count(), 2);
    await prisma.$executeRawUnsafe(`ALTER TABLE "AuditLog" ADD CONSTRAINT "reject_new_weeks" CHECK ("resourceId" <> '2026-10-12')`);
    await assert.rejects(() => service.createWeek({ weekStart: '2026-10-12' }, admin));
    assert.equal(await service.getWeek('2026-10-12', admin), null);
  } finally { await prisma.$disconnect(); }
});

function harness() {
  let rows = new Map<string, any>();
  let audits: any[] = [];
  let failAudit = false;
  const people = [{ id: 'person-1', user_id: 'user-1', name: '成员甲', status: 'active', department: '研发' }];
  const prisma: any = {
    systemSetting: {
      findUnique: async ({ where }: any) => structuredClone(rows.get(where.key) ?? null),
      findMany: async ({ where, take }: any) => [...rows.values()]
        .filter(row => row.category === where.category && row.key.startsWith(where.key.startsWith) && (!where.key.lt || row.key < where.key.lt))
        .sort((a, b) => b.key.localeCompare(a.key)).slice(0, take).map(row => structuredClone(row)),
      create: async ({ data }: any) => {
        if (rows.has(data.key)) throw { code: 'P2002' };
        rows.set(data.key, structuredClone(data));
        return data;
      },
      updateMany: async ({ where, data }: any) => {
        const current = rows.get(where.key);
        if (!current || current.value.revision !== where.value.equals) return { count: 0 };
        rows.set(where.key, { ...current, ...structuredClone(data) });
        return { count: 1 };
      },
    },
    auditLog: { create: async ({ data }: any) => {
      if (failAudit) throw new Error('audit unavailable');
      audits.push(structuredClone(data));
      return data;
    } },
    $transaction: async (fn: any) => {
      const previous = structuredClone(rows), previousAudits = structuredClone(audits);
      try { return await fn(prisma); } catch (error) { rows = previous; audits = previousAudits; throw error; }
    },
  };
  const service = new RdMeetingTodosService(prisma, { getPeople: async () => people } as any);
  return { service, people, logs: () => audits, failAudit: () => { failAudit = true; } };
}

test('only research administrators may read or change meeting records', async () => {
  const { service } = harness();
  for (const actor of [member, { ...admin, userId: undefined }, { ...admin, permissions: ['page:us-collab-cockpit', 'rd-people:manage'] }]) {
    await assert.rejects(() => service.listWeeks(actor), /管理员|权限/);
    await assert.rejects(() => service.createWeek({ weekStart: monday }, actor), /管理员|权限/);
    await assert.rejects(() => service.getWeek(monday, actor), /管理员|权限/);
    await assert.rejects(() => service.addItem(monday, {}, actor), /管理员|权限/);
    await assert.rejects(() => service.updateItem(monday, 'id', {}, actor), /管理员|权限/);
    await assert.rejects(() => service.deleteItem(monday, 'id', {}, actor), /管理员|权限/);
  }
  await assert.rejects(() => runInRdWorkspace('us-collab', () => service.listWeeks(admin)), /研发/);
});

test('weeks are explicit, unique and empty on creation; only valid Mondays accepted', async () => {
  const { service, logs } = harness();
  assert.equal(await service.getWeek(monday, admin), null);
  for (const weekStart of ['2026-02-30', '2026-10-06', '2026-1-05', 'invalid']) {
    await assert.rejects(() => service.createWeek({ weekStart }, admin), /日期|周一/);
  }
  const week = await service.createWeek({ weekStart: monday, createdBy: 'forged' }, admin);
  assert.equal(week.weekStart, monday);
  assert.equal(week.createdBy.id, 'admin');
  assert.deepEqual(week.items, []);
  await assert.rejects(() => service.createWeek({ weekStart: monday }, admin), /已存在/);
  assert.equal(logs().length, 1);
  assert.equal(logs()[0].action, 'meeting_week.created');
});

test('CRUD preserves member snapshots and deleted history, with a semantic audit for each change', async () => {
  const { service, logs, people } = harness();
  let week = await service.createWeek({ weekStart: monday }, admin);
  week = await service.addItem(monday, { revision: week.revision, memberId: 'person-1', title: '  跟进电池测试  ', description: '会议记录', dueDate: '2026-10-09', memberName: '伪造姓名' }, admin);
  const id = week.items[0].id;
  assert.equal(week.items[0].title, '跟进电池测试');
  assert.equal(week.items[0].memberName, '成员甲');
  week = await service.updateItem(monday, id, { revision: week.revision, title: '提交电池测试报告' }, admin);
  week = await service.updateItem(monday, id, { revision: week.revision, status: 'done' }, admin);
  assert.equal(week.items[0].status, 'done');
  people[0].name = '成员甲新名';
  assert.equal((await service.getWeek(monday, admin))!.items[0].memberName, '成员甲');
  week = await service.deleteItem(monday, id, { revision: week.revision }, admin);
  assert.ok(week.items[0].deletedAt);
  assert.equal(week.items[0].title, '提交电池测试报告');
  await assert.rejects(() => service.updateItem(monday, id, { revision: week.revision, title: '不能修改' }, admin), /不存在|已删除/);
  assert.deepEqual(logs().map(row => row.action), ['meeting_week.created', 'meeting_todo.created', 'meeting_todo.updated', 'meeting_todo.completed', 'meeting_todo.deleted']);
  assert.ok(logs().every(row => row.module === 'rd' && row.userId === 'admin'));
  assert.ok(logs()[2].meta.changes.some((change: any) => change.before === '跟进电池测试' && change.after === '提交电池测试报告'));
});

test('copy only unfinished undeleted items and retain source links without altering the original week', async () => {
  const { service } = harness();
  let week = await service.createWeek({ weekStart: monday }, admin);
  for (const title of ['未完成', '已完成', '已删除']) {
    week = await service.addItem(monday, { revision: week.revision, memberId: 'person-1', title }, admin);
  }
  week = await service.updateItem(monday, week.items[1].id, { revision: week.revision, status: 'done' }, admin);
  week = await service.deleteItem(monday, week.items[2].id, { revision: week.revision }, admin);
  const next = await service.createWeek({ weekStart: '2026-10-12', copyFromWeek: monday }, admin);
  assert.equal(next.items.length, 1);
  assert.notEqual(next.items[0].id, week.items[0].id);
  assert.deepEqual(next.items[0].carriedFrom, { weekStart: monday, itemId: week.items[0].id });
  assert.deepEqual(await service.getWeek(monday, admin), week);
  await assert.rejects(() => service.createWeek({ weekStart: '2026-09-28', copyFromWeek: monday }, admin), /之前/);
});

test('stale revisions cannot overwrite another administrator, and audit failure rolls back the write', async () => {
  const { service, failAudit } = harness();
  const initial = await service.createWeek({ weekStart: monday }, admin);
  const saved = await service.addItem(monday, { revision: initial.revision, memberId: 'person-1', title: '保留' }, admin);
  await assert.rejects(() => service.addItem(monday, { revision: initial.revision, memberId: 'person-1', title: '旧版本' }, admin), /刷新/);
  failAudit();
  await assert.rejects(() => service.updateItem(monday, saved.items[0].id, { revision: saved.revision, title: '不会保存' }, admin), /audit unavailable/);
  assert.deepEqual(await service.getWeek(monday, admin), saved);
});

test('validate title, dates, member identity, status and mandatory revision before persistence', async () => {
  const { service, logs, people } = harness();
  const week = await service.createWeek({ weekStart: monday }, admin);
  for (const patch of [{ title: ' ' }, { title: 'x'.repeat(201) }, { memberId: 'missing' }, { dueDate: '2026-02-30' }, { revision: undefined }, { description: 'x'.repeat(2001) }]) {
    await assert.rejects(() => service.addItem(monday, { revision: week.revision, memberId: 'person-1', title: '事项', ...patch }, admin));
  }
  people[0].status = 'resigned';
  await assert.rejects(() => service.addItem(monday, { revision: week.revision, memberId: 'person-1', title: '事项' }, admin), /成员/);
  assert.equal(logs().length, 1);
});

test('history is paginated by week and searches do not silently discard older weeks', async () => {
  const { service } = harness();
  await service.createWeek({ weekStart: monday }, admin);
  await service.createWeek({ weekStart: '2026-10-12' }, admin);
  const history = await service.listWeeks(admin);
  assert.deepEqual(history.weeks.map(week => week.weekStart), ['2026-10-12', monday]);
  const earlier = await service.listWeeks(admin, '2026-10-12');
  assert.deepEqual(earlier.weeks.map(week => week.weekStart), [monday]);
  assert.equal(earlier.nextBefore, null);
  for (let offset = 2; offset < 26; offset += 1) {
    const date = new Date(`${monday}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + offset * 7);
    await service.createWeek({ weekStart: date.toISOString().slice(0, 10) }, admin);
  }
  const firstPage = await service.listWeeks(admin);
  assert.equal(firstPage.weeks.length, 24);
  const secondPage = await service.listWeeks(admin, firstPage.nextBefore!);
  assert.equal(secondPage.weeks.length, 2);
  assert.equal(secondPage.nextBefore, null);
  assert.equal(new Set([...firstPage.weeks, ...secondPage.weeks].map(week => week.weekStart)).size, 26);
});
