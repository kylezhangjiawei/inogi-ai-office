import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';

const source = await fs.readFile(new URL('../src/app/hr/businessLogic.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const logic = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const record = (id, fields = {}, extra = {}) => ({ id, title: '会议', dept: '研发注册部', owner: '会议组织者', status: '已整理', date: '2026-10-16', detail: '', history: [], fields, ...extra });
const actions = [
  { id: 'A1', title: '更新方案', owner: '人员甲', deadline: '2026-10-16' },
  { id: 'A2', title: '核对数据', owner: '人员乙', deadline: '2026-10-10' },
];
const tasks = [record('T2', { '来源纪要': 'M1', '来源行动编号': 'A2', '开始日期': '2026-10-15' }, { status: '进行中' })];

test('同步预检检查整批行动，第二条截止早于关联任务开始时返回具体错误', () => {
  assert.equal(typeof logic.meetingSyncError, 'function');
  assert.match(logic.meetingSyncError('M1', actions, tasks, '2026-10-09'), /行动项 2.*2026-10-15/);
  assert.equal(logic.meetingSyncError('M1', [actions[0], { ...actions[1], deadline: '2026-10-15' }], tasks, '2026-10-09'), '');
});
test('同步预检保留新任务及原始会议日期校验，不修改已有任务', () => {
  assert.equal(typeof logic.meetingSyncError, 'function');
  const before = JSON.stringify(tasks);
  assert.equal(logic.meetingSyncError('M1', [actions[0]], tasks, '2026-10-09'), '');
  assert.match(logic.meetingSyncError('M1', [{ ...actions[0], deadline: '2026-10-08' }], tasks, '2026-10-09'), /会议日期/);
  assert.equal(JSON.stringify(tasks), before);
});
test('会议导出展开各行动实际负责人、期限及关联任务，舍弃旧单负责人', () => {
  assert.equal(typeof logic.meetingExportData, 'function');
  const meeting = record('M1', { '会议日期': '2026-10-09', '会议结论': '按计划推进', '任务负责人': '旧负责人', '行动项明细': JSON.stringify(actions) });
  const result = logic.meetingExportData([meeting], tasks);
  const objects = result.rows.map(values => Object.fromEntries(result.headers.map((key, i) => [key, values[i]])));
  assert.equal(objects.length, 2);
  assert.deepEqual(objects.map(row => [row['行动负责人'], row['行动截止日期'], row['关联任务编号'], row['任务状态']]), [['人员甲', '2026-10-16', '', '未转任务'], ['人员乙', '2026-10-10', 'T2', '进行中']]);
  assert.equal(result.rows.flat().includes('旧负责人'), false);
});
test('会议导出仅处理传入筛选范围，并保留未整理的空行动纪要', () => {
  assert.equal(typeof logic.meetingExportData, 'function');
  const selected = record('M-SELECTED', { '会议日期': '2026-10-09' });
  const result = logic.meetingExportData([selected], tasks);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0][result.headers.indexOf('纪要编号')], 'M-SELECTED');
  assert.equal(result.rows[0][result.headers.indexOf('行动负责人')], '');
  assert.deepEqual(logic.meetingExportData([], tasks).rows, []);
});
