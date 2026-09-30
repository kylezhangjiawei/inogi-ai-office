import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const server = await createServer({
  configFile: false,
  envFile: false,
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, hmr: false, watch: null },
  appType: 'custom',
});
after(() => server.close());
const model = await server.ssrLoadModule('/src/app/rd/taskModel.ts');
const cockpit = await server.ssrLoadModule('/src/app/rd/cockpitModel.ts');

test('嵌套任务按结构确定父级，不依赖历史数据缺失的 parent_task_id', () => {
  const grandchild = { task_id: 'grandchild' };
  const child = { task_id: 'child', subtasks: [grandchild] };
  const root = { task_id: 'root', subtasks: [child] };
  const second = { task_id: 'second' };
  const categories = [{ children: [{ tasks: [root, second] }] }];
  const index = model.buildSubtaskParentIndex(categories);
  assert.equal(index.get('child'), root);
  assert.equal(index.get('grandchild'), child);
  assert.equal(index.has('root'), false);
  assert.deepEqual(model.collectTopLevelTasks(categories), [root, second]);
  assert.equal(model.buildSubtaskParentIndex([]).size, 0);
  assert.deepEqual(model.collectTopLevelTasks([]), []);
});

test('历史归档状态和归档标记任一成立都不计入活动任务', () => {
  assert.equal(model.isArchivedTask({ archived: true, status: 'completed' }), true);
  assert.equal(model.isArchivedTask({ archived: false, status: 'archived' }), true);
  assert.equal(model.isArchivedTask({ archived: false, status: 'in_progress' }), false);
});

test('真实成员名称原样保留，未命名任务仍提供可识别标题', () => {
  assert.equal(model.displayPersonName('高'), '高');
  assert.equal(model.displayPersonName('张工（采购）'), '张工（采购）');
  assert.equal(model.taskVisibleTitle({ task_id: 'TASK-42', title: '  阀体确认  ' }), '阀体确认');
  assert.equal(model.taskVisibleTitle({ task_id: 'TASK-42', title: '' }), '未命名任务（TASK-42）');
});

test('驾驶舱活动时间按后端汇总、最新留痕、任务修改时间依次兜底', () => {
  const task = { updated_at: '2026-09-20', latest_progress_summary: { created_at: '2026-09-21' }, last_activity_at: '2026-09-22' };
  assert.equal(cockpit.taskActivityKey(task), '2026-09-22');
  assert.equal(cockpit.taskActivityKey({ ...task, last_activity_at: '' }), '2026-09-21');
  assert.equal(cockpit.taskActivityKey({ updated_at: '2026-09-20' }), '2026-09-20');
  assert.equal(cockpit.taskActivityKey({}), '');
});

test('拆分后的筛选组合仍同时约束关键词、状态、优先级和期限', () => {
  const task = { task_id: 'RD-42', title: '阀体确认', status: 'in_progress', final_priority: 'high', primary_owner: '张工' };
  assert.equal(cockpit.taskMatches(task, '阀体', 'in_progress', 'high', 'no_due'), true);
  assert.equal(cockpit.taskMatches(task, '不存在', 'all'), false);
  assert.equal(cockpit.taskMatches(task, '', 'completed'), false);
  assert.equal(cockpit.taskMatches(task, '', 'all', 'low'), false);
  assert.equal(cockpit.taskMatches(task, '', 'all', 'all', 'today'), false);
});

test('分类树收集深层任务且对重复编号去重，分类路径保留原兼容分隔符', () => {
  assert.deepEqual([...cockpit.collectTaskIds([{ task_id: 'a', subtasks: [{ task_id: 'b', subtasks: [{ task_id: 'a' }] }] }])], ['a', 'b']);
  assert.deepEqual(cockpit.splitCategoryPath(' 电源／默认 > 电池＞评估 '), ['电源', '默认', '电池', '评估']);
  assert.deepEqual(cockpit.splitCategoryPath(), []);
});
