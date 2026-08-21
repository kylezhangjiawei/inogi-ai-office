import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { ChatToolsService } from '../src/modules/chat/chat-tools.service';
import type { RagUserContext } from '../src/modules/rag/rag.service';
import { THOUGHT_PARAM } from '../src/modules/chat/react-loop';

/**
 * ReAct 工具挂载裁剪：没权限的工具、当日生图配额已用尽的工具，都不下发给模型。
 *
 * 权限裁剪只是省一轮空转（execute 里各自的权限校验才是真闸门），但反过来必须成立——
 * 有权限的工具被误裁掉，用户会得到「我没有这个能力」的错误答复，且没有任何报错提示。
 *
 * buildAgentTools 除了数一次今日生图用量，只读 this.tools 与用户权限，故可用假 prisma 直接构造。
 */
function makeService(todayImageCount = 0) {
  const prisma = { aiUsageLog: { count: () => Promise.resolve(todayImageCount) } };
  const ctor = ChatToolsService as unknown as new (...args: unknown[]) => ChatToolsService;
  return new ctor(prisma, undefined, undefined, undefined, undefined, undefined);
}

async function mountedNames(permissions: string[], todayImageCount = 0): Promise<string[]> {
  const user: RagUserContext = { userId: 'u1', permissions, name: '张三' };
  const { definitions } = await makeService(todayImageCount).buildAgentTools(user);
  return definitions.flatMap((d) => (d.type === 'function' ? [d.function.name] : []));
}

/** 与业务无关、人人可用的工具：任何权限组合下都必须挂上 */
const ALWAYS_MOUNTED = [
  'query_tasks',
  'search_knowledge',
  'query_members',
  'get_dashboard_summary',
  'search_image_library',
  'generate_image',
  'edit_image',
  'generate_video',
];

/** 需要权限才挂载的工具 */
const GATED = [
  'create_task',
  'send_reminder',
  'update_task_progress',
  'approve_task_review',
  'query_procurement',
];

// ── 权限裁剪 ─────────────────────────────────────────────────────────────────

test('无任何权限的用户只拿到通用工具，写操作与采购工具不下发', async () => {
  const names = await mountedNames([]);

  for (const tool of ALWAYS_MOUNTED) assert.ok(names.includes(tool), `${tool} 应始终挂载`);
  for (const tool of GATED) assert.ok(!names.includes(tool), `${tool} 不应下发给无权限用户`);
});

test('超管通配权限拿到全部工具', async () => {
  const names = await mountedNames(['*']);

  for (const tool of [...ALWAYS_MOUNTED, ...GATED]) {
    assert.ok(names.includes(tool), `${tool} 应对超管挂载`);
  }
});

test('立项权限只解锁 create_task，不连带解锁审批与催办', async () => {
  const names = await mountedNames(['rd-project:propose']);

  assert.ok(names.includes('create_task'));
  assert.ok(!names.includes('approve_task_review'));
  assert.ok(!names.includes('send_reminder'));
  assert.ok(!names.includes('query_procurement'));
});

test('审核权限解锁审批工具', async () => {
  const names = await mountedNames(['rd-project:review-l1']);

  assert.ok(names.includes('approve_task_review'));
  assert.ok(names.includes('update_task_progress'), 'review-l1 属于任务管理权限，可记录进展');
  assert.ok(!names.includes('create_task'));
});

test('采购页面权限解锁采购查询工具（含单价等敏感数据，不能人人可查）', async () => {
  assert.ok((await mountedNames(['page:proc-cockpit'])).includes('query_procurement'));
  assert.ok(!(await mountedNames(['page:rd-my-workspace'])).includes('query_procurement'));
});

test('工作台成员可记录任务进展，但不能审批也不能立项', async () => {
  const names = await mountedNames(['page:rd-my-workspace']);

  assert.ok(names.includes('update_task_progress'));
  assert.ok(names.includes('send_reminder'));
  assert.ok(!names.includes('approve_task_review'));
  assert.ok(!names.includes('create_task'));
});

test('挂载的工具定义都是合法的 function 声明且不重名', async () => {
  const names = await mountedNames(['*']);

  assert.equal(new Set(names).size, names.length, '工具名重复会让模型调用落到错误实现上');
  for (const name of names) {
    assert.match(name, /^[a-z][a-z0-9_]*$/, `${name} 不是合法的工具名`);
  }
});

// ── 生图当日配额 ─────────────────────────────────────────────────────────────

test('当日生图未达上限时，生图与改图工具正常挂载', async () => {
  const names = await mountedNames(['*'], 19);

  assert.ok(names.includes('generate_image'));
  assert.ok(names.includes('edit_image'));
});

test('当日生图达到上限后，生图与改图工具不再下发', async () => {
  const names = await mountedNames(['*'], 20);

  assert.ok(!names.includes('generate_image'), '超额后不得再下发生图工具');
  assert.ok(!names.includes('edit_image'), '改图同样触发上游生成，一并停发');
  assert.ok(
    names.includes('search_image_library'),
    '查库是只读的，额度用尽时更需要它把库里现成的图给用户',
  );
});

test('生图配额用尽不影响其他工具，对话能力不受牵连', async () => {
  const names = await mountedNames(['*'], 999);

  for (const tool of ['query_tasks', 'search_knowledge', 'query_members', 'create_task', 'generate_video']) {
    assert.ok(names.includes(tool), `${tool} 不该被生图配额牵连`);
  }
});

test('配额状态随裁剪结果一起返回，供 system prompt 说明原因', async () => {
  const user: RagUserContext = { userId: 'u1', permissions: ['*'] };

  assert.equal((await makeService(0).buildAgentTools(user)).imageQuotaExhausted, false);
  assert.equal((await makeService(20).buildAgentTools(user)).imageQuotaExhausted, true);
});

test('用量统计失败时放行，不能因为查不到配额就让用户没法说话', async () => {
  const prisma = { aiUsageLog: { count: () => Promise.reject(new Error('DB 挂了')) } };
  const ctor = ChatToolsService as unknown as new (...args: unknown[]) => ChatToolsService;
  const svc = new ctor(prisma, undefined, undefined, undefined, undefined, undefined);

  const { definitions, imageQuotaExhausted } = await svc.buildAgentTools({ userId: 'u1', permissions: ['*'] });

  assert.equal(imageQuotaExhausted, false);
  assert.ok(definitions.length > 0);
});

// ── ReAct 的 Thought 参数注入 ────────────────────────────────────────────────

test('每个下发的工具都带 thought 参数，且不是必填', async () => {
  const { definitions } = await makeService().buildAgentTools({ userId: 'u1', permissions: ['*'] });

  assert.ok(definitions.length > 0);
  for (const def of definitions) {
    assert.equal(def.type, 'function');
    if (def.type !== 'function') continue;
    const params = def.function.parameters as { properties?: Record<string, unknown>; required?: string[] };
    assert.ok(params.properties?.[THOUGHT_PARAM], `${def.function.name} 缺少 ${THOUGHT_PARAM} 参数`);
    // 故意不设为必填：模型忘填时该照常执行工具，而不是整轮调用失败
    assert.ok(
      !(params.required ?? []).includes(THOUGHT_PARAM),
      `${def.function.name} 不该把 ${THOUGHT_PARAM} 设为必填`,
    );
  }
});

test('注入 thought 不破坏工具原有的参数与必填项', async () => {
  const { definitions } = await makeService().buildAgentTools({ userId: 'u1', permissions: ['*'] });
  const createTask = definitions.find((d) => d.type === 'function' && d.function.name === 'create_task');

  assert.ok(createTask && createTask.type === 'function');
  const params = createTask.function.parameters as { properties?: Record<string, unknown>; required?: string[] };
  assert.ok(params.properties?.title, '原有的 title 参数不能被覆盖掉');
  assert.ok((params.required ?? []).includes('title'), '原有的必填项要保留');
});
