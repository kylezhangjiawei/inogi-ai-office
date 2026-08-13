import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import 'reflect-metadata';

import {
  AGENT_ACTIONS,
  AGENT_ACTION_PAYLOAD_KEY,
  AGENT_ACTION_TOOLS,
  AGENT_BATCH_MAX_TASKS,
  AGENT_CUSTOM_ACTION_TOOLS,
  AGENT_FIELD_ACTION_TOOLS,
  isFieldAction,
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

test('工具名唯一，且每条 field 型都有对应的 payload 字段映射', () => {
  const names = AGENT_ACTIONS.map((a) => a.tool);
  assert.equal(new Set(names).size, names.length, '工具名重复会让调用落到错误实现上');

  // custom 型不走 updateTask，故意不进这张表；只有 field 型必须有映射
  for (const action of AGENT_ACTIONS.filter(isFieldAction)) {
    assert.ok(AGENT_ACTION_PAYLOAD_KEY[action.tool], `${action.tool} 缺少 payload 字段映射`);
  }
});

test('两种形态的清单不重叠，且合起来等于总清单', () => {
  const field = [...AGENT_FIELD_ACTION_TOOLS];
  const custom = [...AGENT_CUSTOM_ACTION_TOOLS];

  assert.equal(
    field.filter((t) => (custom as string[]).includes(t)).length,
    0,
    '同一个工具同时属于两种形态，分派时会走错出口',
  );
  assert.deepEqual([...AGENT_ACTION_TOOLS].sort(), [...field, ...custom].sort());
  // 形态标记与所属清单必须一致，否则 isFieldAction 会把 custom 型判成 field 型
  for (const action of AGENT_ACTIONS) {
    const inFieldList = (field as string[]).includes(action.tool);
    assert.equal(isFieldAction(action), inFieldList, `${action.tool} 的 kind 与所属清单不一致`);
  }
});

test('分级符合约定：只有可逆且不改对外承诺的字段才允许直接执行', () => {
  const direct = AGENT_ACTIONS.filter((a) => a.risk === 'direct').map((a) => a.tool);
  const confirm = AGENT_ACTIONS.filter((a) => a.risk === 'confirm').map((a) => a.tool);

  assert.deepEqual(direct.sort(), ['set_task_description', 'set_task_priority']);
  assert.deepEqual(confirm.sort(), [
    'attach_tasks_to_parent',
    'move_tasks_category',
    'reassign_task',
    'request_task_abandon',
    'request_task_merge',
    'set_task_due_date',
  ]);
  // 新增的四条都不可逆或影响他人，任何一条被降级成 direct 都意味着「AI 说改就改」
  for (const tool of AGENT_CUSTOM_ACTION_TOOLS) {
    assert.equal(byTool(tool).risk, 'confirm', `${tool} 必须走确认卡`);
  }
});

// ── 参数归一化：模型给什么都不能写进库里坏数据 ────────────────────────────────

const byTool = (tool: string) => AGENT_ACTIONS.find((a) => a.tool === tool)!;

/** 取 field 型条目；取错形态直接失败，避免断言悄悄跳过 */
const fieldByTool = (tool: string) => {
  const action = byTool(tool);
  assert.ok(isFieldAction(action), `${tool} 不是 field 型`);
  return action;
};

test('优先级接受中文与英文，其余一律拒绝', () => {
  const action = fieldByTool('set_task_priority');

  assert.deepEqual(action.normalize('高'), { ok: true, value: 'high', display: '高' });
  assert.deepEqual(action.normalize('low'), { ok: true, value: 'low', display: '低' });
  assert.equal(action.normalize('紧急').ok, false);
  assert.equal(action.normalize('').ok, false);
  assert.equal(action.normalize(null).ok, false);
});

test('截止日期必须是真实存在的日期，格式对但日子不存在也要拒', () => {
  const action = fieldByTool('set_task_due_date');

  assert.deepEqual(action.normalize('2026-09-30'), { ok: true, value: '2026-09-30', display: '2026-09-30' });
  assert.equal(action.normalize('2026-02-31').ok, false, '2 月 31 日不存在，不能写进库');
  assert.equal(action.normalize('2026-13-01').ok, false);
  assert.equal(action.normalize('2026/09/30').ok, false);
  assert.equal(action.normalize('下周五').ok, false, '相对日期必须由模型自己换算成绝对日期');
});

test('描述不接受空串，超长拒绝，展示值截断', () => {
  const action = fieldByTool('set_task_description');

  assert.equal(action.normalize('   ').ok, false, '空描述应让用户去页面操作，而不是被 AI 清空');
  assert.equal(action.normalize('x'.repeat(2001)).ok, false);

  const long = action.normalize('说'.repeat(100));
  assert.equal(long.ok, true);
  assert.ok(long.ok && long.display.endsWith('…'), '确认卡与步骤条上要截断，不能糊一大段');
  assert.ok(long.ok && String(long.value).length === 100, '写库值必须是完整原文，截断只用于展示');
});

test('改派负责人要求非空姓名', () => {
  const action = fieldByTool('reassign_task');

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

// ── custom 型：参数 schema 与权限来源 ─────────────────────────────────────────

test('每条 custom 型的 required 都在自己的 properties 里声明过', () => {
  // required 里写了 properties 没有的键，上游会拒整个工具定义，表现为「这个工具从来不被调用」
  for (const action of AGENT_ACTIONS) {
    if (isFieldAction(action)) continue;
    for (const key of action.required) {
      assert.ok(action.properties[key], `${action.tool} 的 required 含未声明参数 ${key}`);
    }
    assert.ok(action.required.length > 0, `${action.tool} 没有必填参数`);
  }
});

test('合并与放弃走 updateTask 的权限，移动与并入走各自端点的权限', () => {
  // 权限码一律来自控制器声明。这里断言的是「指到了哪个 handler」——指错端点
  // 就等于借用了另一个操作的权限门槛，是最难看出来的越权方式。
  assert.equal(byTool('request_task_merge').handler, 'updateTask');
  assert.equal(byTool('request_task_abandon').handler, 'updateTask');
  assert.equal(byTool('move_tasks_category').handler, 'moveTasks');
  assert.equal(byTool('attach_tasks_to_parent').handler, 'attachTasksAsSubtasks');

  // 并入父任务要求 rd-task:edit / rd-project:direct，普通工作台成员拿不到
  const attach = byTool('attach_tasks_to_parent');
  assert.equal(checkAgentPermission(attach.controller, attach.handler, ['page:rd-my-workspace']).allowed, false);
  assert.equal(checkAgentPermission(attach.controller, attach.handler, ['rd-task:edit']).allowed, true);
});

test('批量工具在说明里给出上限，且上限是个能防误操作的小数', () => {
  assert.ok(AGENT_BATCH_MAX_TASKS > 0 && AGENT_BATCH_MAX_TASKS <= 50, '上限过大等于让用户闭眼确认');

  for (const tool of ['move_tasks_category', 'attach_tasks_to_parent'] as const) {
    const action = byTool(tool);
    assert.ok(!isFieldAction(action));
    assert.ok(
      !isFieldAction(action) && action.properties.task_ids?.type === 'array',
      `${tool} 的 task_ids 必须是数组，否则模型会退回逐条调用`,
    );
    assert.ok(
      action.description.includes(String(AGENT_BATCH_MAX_TASKS)),
      `${tool} 的说明里要写明上限，否则模型只会在被拒后才知道`,
    );
  }
});

test('不可逆操作的说明里必须写明「只是提交申请、仍需审核」', () => {
  // 模型最容易犯的错就是把「已生成确认卡」说成「已删除/已合并」。
  for (const tool of ['request_task_merge', 'request_task_abandon'] as const) {
    assert.ok(byTool(tool).description.includes('审核'), `${tool} 的说明必须点明还要走审核`);
    assert.ok(byTool(tool).description.includes('确认卡'), `${tool} 的说明必须点明只生成确认卡`);
  }
});

/**
 * 任务树被摊平成 TaskRow 列表时，父子关系一度整个丢失——Agent 因此看不出
 * 「这是子任务」，会照常把它放进「移动任务归类」确认卡；而 moveTasks 只认顶层任务，
 * 用户点了执行才失败，且报错与 Agent 刚说过的「任务都存在」自相矛盾。
 */
test('摊平任务树时保留父任务，子任务不被当成顶层任务', async () => {
  const { ChatToolsService } = await import('../src/modules/chat/chat-tools.service');
  const service = Object.create(ChatToolsService.prototype) as any;
  service.prisma = {
    systemSetting: {
      findMany: async () => [
        {
          key: 'rd.taskCategories',
          value: [
            {
              id: 'c1',
              label: '系统 A',
              children: [
                {
                  id: 's1',
                  label: '子项 1',
                  tasks: [
                    {
                      task_id: 'RD-PARENT',
                      title: '压缩机总成',
                      subtasks: [{ task_id: 'RD-CHILD', title: '压缩机罩测试' }],
                    },
                    { task_id: 'RD-TOP', title: '独立任务' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };

  const rows: any[] = await service.loadTaskRows();
  const byId = new Map<string, any>(rows.map((r) => [r.taskId as string, r]));

  assert.equal(byId.get('RD-TOP')?.parentTaskId, null, '顶层任务没有父任务');
  assert.equal(byId.get('RD-PARENT')?.parentTaskId, null);
  assert.equal(byId.get('RD-CHILD')?.parentTaskId, 'RD-PARENT', '子任务必须记住父任务编号');
  assert.equal(byId.get('RD-CHILD')?.parentTitle, '压缩机总成', '报错要能报出父任务标题');
});
