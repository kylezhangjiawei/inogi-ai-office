import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { ResearchDevelopmentService } from '../src/modules/research-development/research-development.service';

type Json = Record<string, unknown>;

/**
 * 留痕下沉到服务端后，「这次改动算哪个动作、变更集写什么」全由服务层自己算。
 * 字段名一旦对不上就会静默不留痕（上线前实测踩过：界面改的是 final_priority 而非 priority），
 * 所以这里按真实任务记录的字段把判定钉住。
 */
function svc() {
  return Object.create(ResearchDevelopmentService.prototype) as any;
}

const baseTask: Json = {
  task_id: 'RD-1',
  title: '电池寄送与测试跟进',
  status: 'in_progress',
  priority: 'low',
  final_priority: 'medium',
  progress: 0,
  due_date: '2026-05-29',
  primary_owner: '包毓飞',
  collaborators: [],
  category_path: '电源部分 / 电池 / 测试验证',
  archived: false,
};

function classify(patch: Json, review?: { action?: string; rejectReason?: string }) {
  const s = svc();
  const changes = s.buildTaskChanges(baseTask, patch);
  return { changes, ...s.classifyTaskUpdate(baseTask, patch, changes, review) };
}

test('界面生效的优先级字段是 final_priority，改它必须留痕', () => {
  const r = classify({ final_priority: 'high' });
  assert.equal(r.action, 'task.priority_changed');
  assert.deepEqual(r.changes, [{ field: 'final_priority', before: 'medium', after: 'high' }]);
});

test('封存/解封走 archived 布尔位，不是 status', () => {
  assert.equal(classify({ archived: true }).action, 'task.archived');
  const s = svc();
  const archivedTask = { ...baseTask, archived: true };
  const changes = s.buildTaskChanges(archivedTask, { archived: false });
  assert.equal(s.classifyTaskUpdate(archivedTask, { archived: false }, changes).action, 'task.unarchived');
});

test('提交各类审核落到各自的动作码', () => {
  assert.equal(classify({ status: 'pending_review', pending_review_type: 'result' }).action, 'task.submitted');
  assert.equal(classify({ status: 'pending_review', pending_review_type: 'due_date' }).action, 'task.due_date_requested');
  assert.equal(classify({ status: 'pending_review', pending_review_type: 'abandon' }).action, 'task.abandon_requested');
});

test('审批动作优先于字段变化', () => {
  const before = { ...baseTask, status: 'pending_review', pending_review_type: 'result' };
  const s = svc();
  const patch = { status: 'completed' };
  const changes = s.buildTaskChanges(before, patch);
  assert.equal(s.classifyTaskUpdate(before, patch, changes, { action: 'approve' }).action, 'task.review_approved');
  const rejected = s.classifyTaskUpdate(before, patch, changes, { action: 'reject', rejectReason: '数据不足' });
  assert.equal(rejected.action, 'task.review_rejected');
  assert.match(rejected.comment, /数据不足/);
});

test('只提交内部字段不产生变更集，不该占一条留痕', () => {
  const r = classify({ creation_request_id: 'abc', updated_at: '2026-08-25T00:00:00.000Z' });
  assert.deepEqual(r.changes, []);
});

test('协作人按姓名拼接成可读变更', () => {
  const r = classify({ collaborators: [{ name: '张三' }, { name: '李四' }] });
  assert.equal(r.action, 'task.collaboration_updated');
  assert.deepEqual(r.changes, [{ field: 'collaborators', before: '', after: '张三、李四' }]);
});

test('系统树按节点 id 比对，删一个再加一个不会被算成没变化', async () => {
  const s = svc();
  const recorded: Json[] = [];
  s.recordServerAudit = async (entry: Json) => { recorded.push(entry); };

  const before = [{ id: 'c1', label: '电源部分', children: [{ id: 's1', label: '电池' }] }];
  const after = [{ id: 'c1', label: '电源模块', children: [{ id: 's2', label: '充电' }] }];
  await s.recordStructureAudit(before, after, { userId: 'u1', userName: '管理员' });

  assert.equal(recorded.length, 1);
  const entry = recorded[0] as { action: string; changes: Array<{ field: string; before: unknown; after: unknown }> };
  // 子项目一删一加，节点总数不变——只记数量会漏掉这次改动
  assert.equal(entry.action, 'category.created');
  const fields = entry.changes.map((c) => c.field).sort();
  assert.deepEqual(fields, ['category_renamed', 'sub_project_added', 'sub_project_removed']);
});

test('系统树无实质变化时不留痕', async () => {
  const s = svc();
  let called = 0;
  s.recordServerAudit = async () => { called += 1; };
  const tree = [{ id: 'c1', label: '电源部分', children: [{ id: 's1', label: '电池' }] }];
  await s.recordStructureAudit(tree, [{ ...tree[0], children: [{ id: 's1', label: '电池' }] }], {});
  assert.equal(called, 0);
});
