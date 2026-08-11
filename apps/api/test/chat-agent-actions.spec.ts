import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import 'reflect-metadata';

import {
  AGENT_ACTIONS,
  AGENT_ACTION_PAYLOAD_KEY,
  AGENT_ACTION_TOOLS,
} from '../src/modules/chat/agent-actions';
import { checkAgentPermission, requiredPermissionsFor } from '../src/modules/chat/agent-permission';

/**
 * Agent 操作注册表。
 *
 * 这里最要紧的一条：注册表里**没有**任何手写的权限码，每条操作的权限都必须能从它声明的
 * 控制器方法上反射出来。反射不到就意味着该操作会被失败关闭挡掉——那是安全的，但会表现为
 * 「功能悄悄没了」，所以用测试把它钉死。
 */

test('每条操作都能从控制器方法反射到权限码——反射不到会被静默失败关闭', () => {
  for (const action of AGENT_ACTIONS) {
    const required = requiredPermissionsFor(action.controller, action.handler);
    assert.ok(
      required && required.length > 0,
      `${action.tool} 指向的 ${action.handler} 反射不到权限码，该操作将无法挂载`,
    );
  }
});

test('无权限用户对每条操作都被拒', () => {
  for (const action of AGENT_ACTIONS) {
    const verdict = checkAgentPermission(action.controller, action.handler, []);
    assert.equal(verdict.allowed, false, `${action.tool} 不该对无权限用户放行`);
  }
});

test('工作台成员能改任务，但权限来自控制器声明而非注册表', () => {
  const verdict = checkAgentPermission(
    AGENT_ACTIONS[0].controller,
    AGENT_ACTIONS[0].handler,
    ['page:rd-my-workspace'],
  );

  assert.equal(verdict.allowed, true);
  // 断言具体权限码，等于把「控制器声明」和「Agent 实际使用」焊在一起：
  // 有人改了控制器上的 @Permissions 而没同步预期，这条会红
  assert.ok(verdict.allowed && verdict.required.includes('page:rd-my-workspace'));
});

test('工具名唯一，且每条都有对应的 payload 字段映射', () => {
  const names = AGENT_ACTIONS.map((a) => a.tool);
  assert.equal(new Set(names).size, names.length, '工具名重复会让调用落到错误实现上');

  for (const action of AGENT_ACTIONS) {
    assert.ok(AGENT_ACTION_PAYLOAD_KEY[action.tool], `${action.tool} 缺少 payload 字段映射`);
  }
});

test('分级符合约定：只有可逆且不改对外承诺的字段才允许直接执行', () => {
  const direct = AGENT_ACTIONS.filter((a) => a.risk === 'direct').map((a) => a.tool);
  const confirm = AGENT_ACTIONS.filter((a) => a.risk === 'confirm').map((a) => a.tool);

  assert.deepEqual(direct.sort(), ['set_task_description', 'set_task_priority']);
  assert.deepEqual(confirm.sort(), ['reassign_task', 'set_task_due_date']);
});

// ── 参数归一化：模型给什么都不能写进库里坏数据 ────────────────────────────────

const byTool = (tool: string) => AGENT_ACTIONS.find((a) => a.tool === tool)!;

test('优先级接受中文与英文，其余一律拒绝', () => {
  const action = byTool('set_task_priority');

  assert.deepEqual(action.normalize('高'), { ok: true, value: 'high', display: '高' });
  assert.deepEqual(action.normalize('low'), { ok: true, value: 'low', display: '低' });
  assert.equal(action.normalize('紧急').ok, false);
  assert.equal(action.normalize('').ok, false);
  assert.equal(action.normalize(null).ok, false);
});

test('截止日期必须是真实存在的日期，格式对但日子不存在也要拒', () => {
  const action = byTool('set_task_due_date');

  assert.deepEqual(action.normalize('2026-09-30'), { ok: true, value: '2026-09-30', display: '2026-09-30' });
  assert.equal(action.normalize('2026-02-31').ok, false, '2 月 31 日不存在，不能写进库');
  assert.equal(action.normalize('2026-13-01').ok, false);
  assert.equal(action.normalize('2026/09/30').ok, false);
  assert.equal(action.normalize('下周五').ok, false, '相对日期必须由模型自己换算成绝对日期');
});

test('描述不接受空串，超长拒绝，展示值截断', () => {
  const action = byTool('set_task_description');

  assert.equal(action.normalize('   ').ok, false, '空描述应让用户去页面操作，而不是被 AI 清空');
  assert.equal(action.normalize('x'.repeat(2001)).ok, false);

  const long = action.normalize('说'.repeat(100));
  assert.equal(long.ok, true);
  assert.ok(long.ok && long.display.endsWith('…'), '确认卡与步骤条上要截断，不能糊一大段');
  assert.ok(long.ok && String(long.value).length === 100, '写库值必须是完整原文，截断只用于展示');
});

test('改派负责人要求非空姓名', () => {
  const action = byTool('reassign_task');

  assert.equal(action.normalize('').ok, false);
  assert.equal(action.normalize('  ').ok, false);
  assert.deepEqual(action.normalize(' 张三 '), { ok: true, value: '张三', display: '张三' });
});

test('注册表与工具名清单严格一一对应', () => {
  // 两边任何一侧漏配，都会让某个操作要么挂不上、要么拼出坏 payload。
  // 类型层面已经能挡住 payload 映射漏配，这条再钉住「清单里有名字但没写实现」的方向。
  const declared = [...AGENT_ACTION_TOOLS].sort();
  const implemented = AGENT_ACTIONS.map((a) => a.tool).sort();

  assert.deepEqual(implemented, declared);
});
