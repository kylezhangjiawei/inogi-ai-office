import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildRdTaskProgressRelationGroup } from '../src/modules/research-development/rd-task-progress-group.ts';

const categories = [{
  children: [{
    tasks: [{
      task_id: 'root',
      title: '主任务',
      subtasks: [{
        task_id: 'attached',
        title: '并入任务',
        subtask_attached_at: '2026-08-03T09:00:00.000Z',
        subtasks: [{
          task_id: 'existing-child',
          title: '原有下级',
          subtask_attached_at: '2026-07-01T09:00:00.000Z',
        }],
      }, {
        task_id: 'created-child',
        title: '直接新建',
        subtask_origin: 'created',
      }],
    }],
  }],
}];

test('从任意节点读取时都解析到完整任务关系树', () => {
  const group = buildRdTaskProgressRelationGroup(categories, 'existing-child');

  assert.ok(group);
  assert.equal(group.rootTaskId, 'root');
  assert.equal(group.currentTaskId, 'existing-child');
  assert.deepEqual(group.tasks.map((item) => item.taskId), [
    'root',
    'attached',
    'existing-child',
    'created-child',
  ]);
  assert.deepEqual(group.tasks[2]?.path, ['主任务', '并入任务', '原有下级']);
});

test('整树并入时间向下继承，较晚的祖先并入时间优先', () => {
  const group = buildRdTaskProgressRelationGroup(categories, 'root');

  assert.ok(group);
  assert.equal(group.tasks.find((item) => item.taskId === 'attached')?.joinedAt, '2026-08-03T09:00:00.000Z');
  assert.equal(group.tasks.find((item) => item.taskId === 'existing-child')?.joinedAt, '2026-08-03T09:00:00.000Z');
  assert.equal(group.tasks.find((item) => item.taskId === 'created-child')?.joinedAt, null);
});

test('不存在的任务不生成空任务组', () => {
  assert.equal(buildRdTaskProgressRelationGroup(categories, 'missing'), null);
});
