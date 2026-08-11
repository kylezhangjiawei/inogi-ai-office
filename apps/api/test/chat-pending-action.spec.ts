import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { ChatToolsService } from '../src/modules/chat/chat-tools.service';
import type { RagUserContext } from '../src/modules/rag/rag.service';

/**
 * 待确认动作卡的状态机。这里管的是「写操作会不会被执行两次」——
 * 重复点击、多标签页、多实例并发确认，都必须只有一次真正落地。
 *
 * 原实现靠进程内 Map 锁，加一个实例就失效；现在靠 `WHERE status='pending'` 的条件更新抢占。
 * 下面的假 Prisma 精确复刻这个语义：updateMany 只改满足条件的行并返回命中数。
 */

type Row = {
  id: string;
  userId: string;
  conversationId: string;
  messageId: string | null;
  tool: string;
  payload: unknown;
  card: unknown;
  status: string;
  resultMessage: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

type Where = {
  id?: string | { in: string[] };
  status?: string | { in: string[] };
  expiresAt?: { gt?: Date; lt?: Date };
  conversationId?: string;
  userId?: string;
  updatedAt?: { lt: Date };
};

function matches(row: Row, where: Where): boolean {
  if (typeof where.id === 'string' && row.id !== where.id) return false;
  if (where.id && typeof where.id === 'object' && !where.id.in.includes(row.id)) return false;
  if (typeof where.status === 'string' && row.status !== where.status) return false;
  if (where.status && typeof where.status === 'object' && !where.status.in.includes(row.status)) return false;
  if (where.expiresAt?.gt && !(row.expiresAt.getTime() > where.expiresAt.gt.getTime())) return false;
  if (where.expiresAt?.lt && !(row.expiresAt.getTime() < where.expiresAt.lt.getTime())) return false;
  if (where.conversationId && row.conversationId !== where.conversationId) return false;
  if (where.userId && row.userId !== where.userId) return false;
  if (where.updatedAt?.lt && !(row.updatedAt.getTime() < where.updatedAt.lt.getTime())) return false;
  return true;
}

/** 只实现本服务用到的那几个方法，语义与 Prisma 对齐 */
function fakePrisma(rows: Row[]) {
  return {
    chatPendingAction: {
      findUnique: ({ where }: { where: { id: string } }) =>
        Promise.resolve(rows.find((r) => r.id === where.id) ?? null),
      findMany: ({ where }: { where: Where }) =>
        Promise.resolve(rows.filter((r) => matches(r, where)).sort((a, b) => +a.createdAt - +b.createdAt)),
      create: ({ data }: { data: Partial<Row> }) => {
        const row = {
          messageId: null,
          resultMessage: '',
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        } as Row;
        rows.push(row);
        return Promise.resolve(row);
      },
      update: ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, data, { updatedAt: new Date() });
        return Promise.resolve(row);
      },
      updateMany: ({ where, data }: { where: Where; data: Partial<Row> }) => {
        const hit = rows.filter((r) => matches(r, where));
        for (const row of hit) Object.assign(row, data, { updatedAt: new Date() });
        return Promise.resolve({ count: hit.length });
      },
      deleteMany: ({ where }: { where: Where }) => {
        const keep = rows.filter((r) => !matches(r, where));
        const count = rows.length - keep.length;
        rows.splice(0, rows.length, ...keep);
        return Promise.resolve({ count });
      },
    },
    auditLog: { create: () => Promise.resolve({}) },
  };
}

const OWNER: RagUserContext = { userId: 'u1', permissions: ['*'], name: '张三' };
const OTHER: RagUserContext = { userId: 'u2', permissions: ['*'], name: '李四' };

function makeRow(over: Partial<Row> = {}): Row {
  const now = new Date();
  const id = over.id ?? 'act-1';
  return {
    id,
    userId: 'u1',
    conversationId: 'c1',
    messageId: null,
    tool: 'create_task',
    payload: { title: '测试任务' },
    card: { id, tool: 'create_task', label: '发起立项', summary: '立项「测试任务」', fields: [], expiresAt: '' },
    status: 'pending',
    resultMessage: '',
    expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

/** 构造一个只替换了「真正执行副作用」那一步的服务，专测状态机本身 */
function makeService(rows: Row[], execute: () => Promise<string> = () => Promise.resolve('已执行')) {
  const ctor = ChatToolsService as unknown as new (...args: unknown[]) => ChatToolsService;
  const svc = new ctor(fakePrisma(rows), undefined, undefined, undefined, undefined, undefined);
  let calls = 0;
  (svc as unknown as { executePendingAction: () => Promise<string> }).executePendingAction = () => {
    calls += 1;
    return execute();
  };
  return { svc, sideEffectCount: () => calls };
}

test('确认成功后状态变为 executed 并记录结果文案', async () => {
  const rows = [makeRow()];
  const { svc, sideEffectCount } = makeService(rows, () => Promise.resolve('已提交立项'));

  const result = await svc.confirmPendingAction('act-1', OWNER);

  assert.deepEqual(result, { ok: true, message: '已提交立项' });
  assert.equal(rows[0].status, 'executed');
  assert.equal(rows[0].resultMessage, '已提交立项');
  assert.equal(sideEffectCount(), 1);
});

test('重复确认被拒，写操作不会执行第二次', async () => {
  const rows = [makeRow()];
  const { svc, sideEffectCount } = makeService(rows);

  await svc.confirmPendingAction('act-1', OWNER);
  await assert.rejects(() => svc.confirmPendingAction('act-1', OWNER), /已执行/);

  assert.equal(sideEffectCount(), 1);
});

test('并发确认同一张卡，只有一个请求能抢到执行权', async () => {
  const rows = [makeRow()];
  // 执行过程留一个 tick，让两个请求真正重叠
  const { svc, sideEffectCount } = makeService(
    rows,
    () => new Promise((resolve) => setTimeout(() => resolve('已提交立项'), 10)),
  );

  const results = await Promise.allSettled([
    svc.confirmPendingAction('act-1', OWNER),
    svc.confirmPendingAction('act-1', OWNER),
  ]);

  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1, '只能有一个确认成功');
  assert.equal(results.filter((r) => r.status === 'rejected').length, 1, '另一个必须被拒');
  assert.equal(sideEffectCount(), 1, '写操作只能真正执行一次');
  assert.equal(rows[0].status, 'executed');
});

test('不能确认别人发起的动作', async () => {
  const rows = [makeRow()];
  const { svc, sideEffectCount } = makeService(rows);

  await assert.rejects(() => svc.confirmPendingAction('act-1', OTHER), /只能确认自己发起的动作/);

  assert.equal(sideEffectCount(), 0);
  assert.equal(rows[0].status, 'pending', '越权确认不得改动卡状态');
});

test('已过期的卡拒绝执行，并就地标记为已取消', async () => {
  const rows = [makeRow({ expiresAt: new Date(Date.now() - 1000) })];
  const { svc, sideEffectCount } = makeService(rows);

  await assert.rejects(() => svc.confirmPendingAction('act-1', OWNER), /已过期/);

  assert.equal(sideEffectCount(), 0);
  assert.equal(rows[0].status, 'canceled');
});

test('执行失败时退回 pending，用户可以重试', async () => {
  const rows = [makeRow()];
  let attempt = 0;
  const { svc } = makeService(rows, () => {
    attempt += 1;
    if (attempt === 1) return Promise.reject(new Error('下游服务不可用'));
    return Promise.resolve('第二次成功');
  });

  await assert.rejects(() => svc.confirmPendingAction('act-1', OWNER), /下游服务不可用/);
  assert.equal(rows[0].status, 'pending', '失败后必须退回 pending，否则这张卡就废了');

  const retry = await svc.confirmPendingAction('act-1', OWNER);
  assert.equal(retry.message, '第二次成功');
  assert.equal(rows[0].status, 'executed');
});

test('取消后不能再确认', async () => {
  const rows = [makeRow()];
  const { svc, sideEffectCount } = makeService(rows);

  await svc.cancelPendingAction('act-1', OWNER);
  assert.equal(rows[0].status, 'canceled');

  await assert.rejects(() => svc.confirmPendingAction('act-1', OWNER), /已取消/);
  assert.equal(sideEffectCount(), 0);
});

test('执行中的动作不能被取消（写操作已经投出去了）', async () => {
  const rows = [makeRow({ status: 'executing' })];
  const { svc } = makeService(rows);

  await assert.rejects(() => svc.cancelPendingAction('act-1', OWNER), /正在执行/);
  assert.equal(rows[0].status, 'executing');
});

test('不能取消别人发起的动作', async () => {
  const rows = [makeRow()];
  const { svc } = makeService(rows);

  await assert.rejects(() => svc.cancelPendingAction('act-1', OTHER), /只能取消自己发起的动作/);
  assert.equal(rows[0].status, 'pending');
});

test('不存在的动作按 404 处理', async () => {
  const { svc } = makeService([]);

  await assert.rejects(() => svc.confirmPendingAction('nope', OWNER), /不存在/);
  await assert.rejects(() => svc.cancelPendingAction('nope', OWNER), /不存在/);
});

test('会话未决卡列表只返回本人、本会话、未过期的 pending 卡', async () => {
  const rows = [
    makeRow({ id: 'a', status: 'pending' }),
    makeRow({ id: 'b', status: 'executed' }),
    makeRow({ id: 'c', userId: 'u2' }),
    makeRow({ id: 'd', conversationId: 'c2' }),
    makeRow({ id: 'e', expiresAt: new Date(Date.now() - 1000) }),
  ];
  const { svc } = makeService(rows);

  const listed = await svc.listConversationPendingActions('c1', OWNER);

  assert.deepEqual(listed.map((x) => x.card.id), ['a']);
});

test('绑定消息 id 后，未决卡能挂回其所属的 assistant 消息', async () => {
  const rows = [makeRow({ id: 'a' }), makeRow({ id: 'b' })];
  const { svc } = makeService(rows);

  await svc.bindActionsToMessage(['a', 'b'], 'msg-1');
  const listed = await svc.listConversationPendingActions('c1', OWNER);

  assert.deepEqual(listed.map((x) => x.messageId), ['msg-1', 'msg-1']);
});
