import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile('src/app/procurement/components/TaskDetailDrawer.tsx', 'utf8');

test('采购任务详情抽屉不渲染顶部流程步骤条', () => {
  const header = source.slice(source.indexOf('<SheetHeader'), source.indexOf('</SheetHeader>'));
  assert.doesNotMatch(header, /procurementStepsOf|workflowStages|proc-task-stage/);
  assert.doesNotMatch(source, /steps\.map\(\(\{ status: s/);
  assert.match(source, /下一步操作卡/);
});
