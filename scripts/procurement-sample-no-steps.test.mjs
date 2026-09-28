import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workspace = await readFile('src/app/procurement/components/ProcurementSampleWorkspace.tsx', 'utf8');
const styles = await readFile('src/app/procurement/sampleWorkspace.css', 'utf8');

test('样品工作台不渲染顶部流程步骤条', () => {
  assert.doesNotMatch(workspace, /proc-sample-steps|样品当前流程/);
  assert.doesNotMatch(styles, /proc-sample-steps/);
  assert.match(workspace, /样品处理操作/);
});
