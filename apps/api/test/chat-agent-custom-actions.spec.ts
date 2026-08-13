import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { AGENT_BATCH_MAX_TASKS } from '../src/modules/chat/agent-actions';
import { ChatToolsService } from '../src/modules/chat/chat-tools.service';
import type { RagUserContext } from '../src/modules/rag/rag.service';
import { ensureDefaultSubProject } from '../src/modules/research-development/research-development.service';

/**
 * custom 型 Agent 操作的**发起前校验**。
 *
 * 这些操作都是 confirm 级，真正的写发生在用户点确认之后。所以 plan 这一步是唯一还能
 * 拦住坏参数的地方——一旦坏参数进了确认卡，用户点下去就直接砸到服务层，甚至（跨库合并）
 * 要等审核通过后才在服务端日志里失败，那时源任务已经被挂成 pending_review 了。
 *
 * 注册表本身的声明（权限来源、分级、schema）在 chat-agent-actions.spec.ts 里测；那个文件
 * 刻意不碰 service，故这里单开一个带假 Prisma 的壳。
 */

type Task = { task_id: string; title: string; status?: string; primary_owner?: string };

/** 主库/产品库两棵树：库隔离是合并与并入父任务的关键前置条件 */
const mainTree = (tasks: Task[], extraCategories: unknown[] = []) => [
  { id: 'cat-power', label: '电源部分', children: [{ id: 'sub-battery', label: '电池', tasks }] },
  ...extraCategories,
];

function fakePrisma(main: Task[], product: Task[], counter: { findMany: number }, extra: unknown[]) {
  const values: Record<string, unknown> = {
    'rd.taskCategories': mainTree(main, extra),
    'rd.productTaskCategories': {
      'prod-x': [{ id: 'cat-x', label: 'X 系统', children: [{ id: 'sub-x', label: 'X 子项', tasks: product }] }],
    },
    'rd.products': [{ id: 'prod-x', name: 'X 产品' }],
  };
  return {
    systemSetting: {
      findMany: ({ where }: { where: { key: { in: string[] } } }) => {
        counter.findMany += 1;
        return Promise.resolve(
          where.key.in.filter((k) => k in values).map((key) => ({ key, value: values[key] })),
        );
      },
      findUnique: ({ where }: { where: { key: string } }) =>
        Promise.resolve(where.key in values ? { value: values[where.key] } : null),
    },
  };
}

/**
 * resolveCategory 现在走 rdService.getTaskCategories（而不是直接读 KV），
 * 好让 Agent 和页面看到同一棵树。
 *
 * 假服务必须跟着做 ensureDefaultSubProject——真实的 getTaskCategories 经
 * readNormalizedTaskCategories 一定补过默认子项，少了这一步就不是同一个契约，
 * 测试会对着一棵现实中不存在的树做断言。
 */
function fakeRdService(main: Task[], extra: unknown[]) {
  return {
    getTaskCategories: () =>
      Promise.resolve(ensureDefaultSubProject(mainTree(main, extra) as Record<string, unknown>[])),
  };
}

const USER: RagUserContext = { userId: 'u1', permissions: ['*'], name: '张三' };

type Runner = {
  plan: (
    args: Record<string, unknown>,
    user: RagUserContext,
  ) => Promise<{ error: string } | { payload: Record<string, unknown>; fields: Array<{ label: string; value: string }> }>;
};

function makeRunners(main: Task[], product: Task[] = [], extraCategories: unknown[] = []) {
  const counter = { findMany: 0 };
  const ctor = ChatToolsService as unknown as new (...args: unknown[]) => ChatToolsService;
  const svc = new ctor(
    fakePrisma(main, product, counter, extraCategories),
    undefined,
    fakeRdService(main, extraCategories),
    undefined,
    undefined,
    undefined,
  );
  const runners = (
    svc as unknown as { customActionRunners: () => Record<string, Runner> }
  ).customActionRunners();
  return { runners, counter };
}

const ACTIVE = { task_id: 'RD-1', title: '电池续航测试', status: 'in_progress', primary_owner: '孙宁' };

const errorOf = (result: unknown): string =>
  result && typeof result === 'object' && 'error' in result ? String((result as { error: string }).error) : '';

// ── 合并：跨库与状态前置 ─────────────────────────────────────────────────────

test('跨库合并在发起前就被拒——放到审核通过后才失败已经来不及', async () => {
  // applyTaskMerge 对跨库是 fire-and-forget catch：用户确认过、审核人也批过，
  // 失败只留在服务端日志，源任务却已经被挂成 pending_review。
  const { runners } = makeRunners([ACTIVE], [{ task_id: 'RD-9', title: '产品库任务', status: 'in_progress' }]);

  const result = await runners.request_task_merge.plan(
    { source_task_id: 'RD-1', target_task_id: 'RD-9', reason: '内容重复' },
    USER,
  );

  assert.ok(errorOf(result).includes('同一个任务库'), `应明确拒绝跨库合并，实际：${errorOf(result)}`);
});

test('合并要求源与目标不同、原因非空、任务存在', async () => {
  const { runners } = makeRunners([ACTIVE, { task_id: 'RD-2', title: '电池容量测定', status: 'in_progress' }]);
  const plan = (args: Record<string, unknown>) => runners.request_task_merge.plan(args, USER);

  assert.ok(errorOf(await plan({ source_task_id: 'RD-1', target_task_id: 'RD-1', reason: 'x' })).includes('同一个任务'));
  assert.ok(errorOf(await plan({ source_task_id: 'RD-1', target_task_id: 'RD-2', reason: '  ' })).includes('原因'));
  assert.ok(errorOf(await plan({ source_task_id: 'RD-1', target_task_id: 'RD-404', reason: 'x' })).includes('RD-404'));

  const ok = await plan({ source_task_id: 'RD-1', target_task_id: 'RD-2', reason: '内容重复' });
  assert.ok(!('error' in ok));
  assert.deepEqual('payload' in ok ? ok.payload : null, {
    sourceId: 'RD-1',
    targetId: 'RD-2',
    reason: '内容重复',
  });
});

test('审核中/已完成的任务不能再发起合并', async () => {
  const { runners } = makeRunners([
    { task_id: 'RD-1', title: '审核中', status: 'pending_review' },
    { task_id: 'RD-2', title: '已完成', status: 'completed' },
    { task_id: 'RD-3', title: '正常', status: 'in_progress' },
  ]);
  const plan = (source: string) =>
    runners.request_task_merge.plan({ source_task_id: source, target_task_id: 'RD-3', reason: 'x' }, USER);

  assert.ok(errorOf(await plan('RD-1')).includes('审核中'));
  assert.ok(errorOf(await plan('RD-2')).includes('completed'));
});

// ── 批量：上限与整批拒绝 ─────────────────────────────────────────────────────

test('超过上限的批量被拒，且提示分批', async () => {
  const tasks = Array.from({ length: AGENT_BATCH_MAX_TASKS + 1 }, (_, i) => ({
    task_id: `RD-${i}`,
    title: `任务${i}`,
    status: 'in_progress',
  }));
  const { runners } = makeRunners(tasks);

  const result = await runners.move_tasks_category.plan(
    { task_ids: tasks.map((t) => t.task_id), target_category: '电源部分/电池' },
    USER,
  );

  assert.ok(errorOf(result).includes(String(AGENT_BATCH_MAX_TASKS)), '要把上限数字告诉模型，否则它只能盲试');
  assert.ok(errorOf(result).includes('分批'));
});

test('批量里有一个任务编号定位不到就整批拒绝', async () => {
  const { runners } = makeRunners([ACTIVE, { task_id: 'RD-2', title: '任务二', status: 'in_progress' }]);

  const result = await runners.move_tasks_category.plan(
    { task_ids: ['RD-1', 'RD-404', 'RD-2'], target_category: '电源部分/电池' },
    USER,
  );

  assert.ok(errorOf(result).includes('RD-404'));
  assert.ok(errorOf(result).includes('未做任何改动'), '半批生效比整批失败更难收拾，要讲清没动过');
});

test('task_ids 去重且非数组被拒', async () => {
  const { runners } = makeRunners([ACTIVE]);
  const plan = (task_ids: unknown) =>
    runners.move_tasks_category.plan({ task_ids, target_category: '电源部分/电池' }, USER);

  assert.ok(errorOf(await plan('RD-1')).includes('数组'));
  assert.ok(errorOf(await plan([])).includes('至少'));

  const ok = await plan(['RD-1', 'RD-1', ' RD-1 ']);
  assert.ok(!('error' in ok));
  assert.deepEqual('payload' in ok ? ok.payload.taskIds : null, ['RD-1']);
});

test('批量定位只读一次任务树——逐个查会在 10s 工具超时里跑不完', async () => {
  const tasks = Array.from({ length: 8 }, (_, i) => ({
    task_id: `RD-${i}`,
    title: `任务${i}`,
    status: 'in_progress',
  }));
  const { runners, counter } = makeRunners(tasks);

  await runners.move_tasks_category.plan(
    { task_ids: tasks.map((t) => t.task_id), target_category: '电源部分/电池' },
    USER,
  );

  assert.equal(counter.findMany, 1, `8 条任务只该读一次任务树，实际读了 ${counter.findMany} 次`);
});

test('任务数超过旧的 800 行上限后，靠后的任务依然定位得到', async () => {
  // 旧实现在收满 800 行就停止收集，于是第 801 条之后的任务对所有 Agent 写工具
  // 都「不存在」——不报错，只是对真实存在的任务回答「找不到」。
  const tasks = Array.from({ length: 900 }, (_, i) => ({
    task_id: `RD-${i}`,
    title: `任务${i}`,
    status: 'in_progress',
  }));
  const { runners } = makeRunners(tasks);

  const result = await runners.move_tasks_category.plan(
    { task_ids: ['RD-880'], target_category: '电源部分/电池' },
    USER,
  );

  assert.ok(!('error' in result), `第 881 条任务应能定位到，实际：${errorOf(result)}`);
});

// ── 分类与父任务 ────────────────────────────────────────────────────────────

test('目标分类不存在时列出可选分类，而不是只说失败', async () => {
  const { runners } = makeRunners([ACTIVE]);

  const result = await runners.move_tasks_category.plan(
    { task_ids: ['RD-1'], target_category: '不存在的分类' },
    USER,
  );

  assert.ok(errorOf(result).includes('电源部分'), '要把现有分类回给模型，它才能纠偏');
});

test('纯一级分类（无子项）可以作为移动目标，且卡上不出现「默认」这一层', async () => {
  // 「管理分类」允许建出 children 为空的一级分类，此前它既立不了项也移不进任务。
  const { runners } = makeRunners([ACTIVE], [], [{ id: 'cat-solo', label: '独立系统', children: [] }]);

  const result = await runners.move_tasks_category.plan(
    { task_ids: ['RD-1'], target_category: '独立系统' },
    USER,
  );

  assert.ok(!('error' in result), `一级分类应可作为目标，实际：${errorOf(result)}`);
  const target = 'fields' in result ? result.fields.find((f) => f.label === '目标分类')?.value ?? '' : '';
  assert.equal(target, '独立系统', '自动补出的默认子项不能出现在确认卡上');
  assert.ok(!target.includes('默认'));
});

test('父任务不能同时出现在要并入的任务列表里', async () => {
  const { runners } = makeRunners([ACTIVE, { task_id: 'RD-2', title: '父任务', status: 'in_progress' }]);

  const result = await runners.attach_tasks_to_parent.plan(
    { task_ids: ['RD-1', 'RD-2'], parent_task_id: 'RD-2' },
    USER,
  );

  assert.ok(errorOf(result).includes('RD-2'));
});

test('并入父任务要求同库', async () => {
  const { runners } = makeRunners([ACTIVE], [{ task_id: 'RD-9', title: '产品库父任务', status: 'in_progress' }]);

  const result = await runners.attach_tasks_to_parent.plan(
    { task_ids: ['RD-1'], parent_task_id: 'RD-9' },
    USER,
  );

  assert.ok(errorOf(result).includes('同一个任务库'));
});

// ── 放弃：状态前置与影响面 ───────────────────────────────────────────────────

test('只有活跃任务能申请放弃', async () => {
  const { runners } = makeRunners([
    { task_id: 'RD-1', title: '进行中', status: 'in_progress' },
    { task_id: 'RD-2', title: '待审核', status: 'pending_review' },
  ]);
  const plan = (task_id: string) => runners.request_task_abandon.plan({ task_id, reason: '需求取消' }, USER);

  assert.ok(!('error' in (await plan('RD-1'))));
  assert.ok(errorOf(await plan('RD-2')).includes('pending_review'));
});

test('不可逆操作的确认卡上必须写明影响面', async () => {
  // 用户是靠卡上这几行决定点不点确认的；只写「放弃任务 X」等于让人闭眼确认。
  const { runners } = makeRunners([ACTIVE, { task_id: 'RD-2', title: '目标任务', status: 'in_progress' }]);

  const abandon = await runners.request_task_abandon.plan({ task_id: 'RD-1', reason: '需求取消' }, USER);
  const merge = await runners.request_task_merge.plan(
    { source_task_id: 'RD-1', target_task_id: 'RD-2', reason: '内容重复' },
    USER,
  );

  const impact = (result: unknown) =>
    result && typeof result === 'object' && 'fields' in result
      ? (result as { fields: Array<{ label: string; value: string }> }).fields.find((f) => f.label === '影响')?.value ?? ''
      : '';

  assert.ok(impact(abandon).includes('不可恢复'));
  assert.ok(impact(merge).includes('归档'));
});
