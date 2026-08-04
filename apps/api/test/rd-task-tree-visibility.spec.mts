import * as assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { rootTasksFromCategories } from '../../../src/app/lib/rdTaskTreeVisibility.ts';

type Task = { task_id: string; subtasks?: Task[] };

function categories(tasks: Task[]) {
  return [{ children: [{ tasks }] }];
}

test('任务并入父任务后不再作为驾驶舱根任务展示或计数', () => {
  const child: Task = { task_id: 'child-1' };
  const parent: Task = { task_id: 'parent-1', subtasks: [] };

  const before = rootTasksFromCategories(categories([parent, child]));
  const after = rootTasksFromCategories(categories([{ ...parent, subtasks: [child] }]));

  assert.deepEqual(before.map((task) => task.task_id), ['parent-1', 'child-1']);
  assert.deepEqual(after.map((task) => task.task_id), ['parent-1']);
  assert.equal(after[0]?.subtasks?.[0]?.task_id, 'child-1');
});

test('研发驾驶舱列表和总任务 KPI 使用同一根任务口径', async () => {
  const source = await readFile(
    new URL('../../../src/app/RDTaskManagementPage.tsx', import.meta.url),
    'utf8',
  );

  assert.match(
    source,
    /const peopleAllTasks = useMemo\(\(\) => \{\s*const tasks = rootTasksFromCategories\(peopleCategories\);/,
  );
  assert.match(source, /const tasks = rootTasksFromCategories\(\[cat\]\);/);
  assert.match(source, /const tasks = rootTasksFromCategories\(categories\);/);
  assert.match(source, /total: selectedSub\.tasks\.filter\(\(task\) => !isArchivedTask\(task\)\)\.length/);
  assert.match(source, /function collectRootActiveTasks/);
  assert.doesNotMatch(source, /const tasks = flattenTasks\(categories\.flatMap/);
  assert.doesNotMatch(source, /total: flattenTasks\(selectedSub\.tasks\)/);
  assert.doesNotMatch(source, /activeSubtasks/);
  assert.match(source, /label: t\("总任务"\), value: totalActive/);
  assert.doesNotMatch(source, /label: t\("总任务"\), value: totalRegistered/);
});
