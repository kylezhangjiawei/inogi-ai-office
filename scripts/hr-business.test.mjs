import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../src/app/hr/businessLogic.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports = {};
new Function('exports', js)(exports);
const { buildOrgTree, orgHasCycle, expenseDifference, roomBookingState, canStartRoom, meetingSyncPlan, meetingActionError, scoreAverage } = exports;
const row = (id, title, fields = {}, rest = {}) => ({ id, title, fields, dept: '研发注册部', owner: '林序', status: '有效', date: '2026-10-16', detail: '', history: [], ...rest });

test('组织树按编辑后的上级嵌套；循环关系被识别，展示仍不递归失控', () => {
  const rows = [row('D-1', '研发部', { 上级部门: '质量部' }), row('D-2', '质量部', { 上级部门: '总经办' })];
  assert.equal(buildOrgTree(rows)[0]?.row.id, 'D-2');
  assert.equal(buildOrgTree(rows)[0]?.children[0]?.row.id, 'D-1');
  assert.equal(orgHasCycle(rows), false);
  rows[1].fields['上级部门'] = '研发部';
  assert.equal(orgHasCycle(rows), true);
  assert.equal(buildOrgTree(rows).length, 2);
});

test('金额差异使用发票而非报销；空值和非法数值不得当成零', () => {
  assert.equal(expenseDifference({ 凭证金额: '380.00', 发票金额: '300.00', 报销金额: '320.00' }), 80);
  assert.equal(expenseDifference({ 凭证金额: '0.30', 发票金额: '0.10' }), 0.2);
  assert.equal(expenseDifference({ 凭证金额: '380', 发票金额: '' }), null);
  assert.equal(expenseDifference({ 凭证金额: '-1', 发票金额: '300' }), null);
});

test('房态以演示时钟计算，取消或无预约禁止开始使用', () => {
  const booking = row('RM-1', '评审会', { 开始时间: '14:00', 结束时间: '15:00' }, { status: '已预约' });
  assert.equal(roomBookingState(booking, '2026-10-16T13:30'), '即将开始');
  assert.equal(roomBookingState(booking, '2026-10-16T14:00'), '会议中');
  assert.equal(roomBookingState(booking, '2026-10-16T15:00'), '已结束');
  assert.equal(roomBookingState(undefined, '2026-10-16T14:00'), '空闲');
  assert.equal(canStartRoom(undefined, '2026-10-16T14:00'), false);
  assert.equal(canStartRoom(booking, '2026-10-16T13:59'), false);
  assert.equal(canStartRoom(booking, '2026-10-16T14:10'), true);
  assert.equal(canStartRoom({ ...booking, status: '已取消' }, '2026-10-16T14:10'), false);
  assert.equal(canStartRoom({ ...booking, status: '未预约' }, '2026-10-16T14:10'), false);
});

test('纪要增量同步按行动编号关联，修改不重复创建，已有任务进度保留', () => {
  const tasks = [row('T-1', '旧标题', { 来源纪要: 'MT-1', 来源行动编号: 'A-1' }, { status: '进行中' })];
  const actions = [{ id: 'A-1', title: '修订标题', owner: '陈安', deadline: '2026-10-20' }, { id: 'A-2', title: '新增事项', owner: '周宁', deadline: '2026-10-21' }];
  const plan = meetingSyncPlan('MT-1', actions, tasks);
  assert.equal(plan.length, 2);
  assert.equal(plan[0].task?.id, 'T-1');
  assert.equal(plan[0].task?.status, '进行中');
  assert.equal(plan[1].task, undefined);
  assert.equal(meetingSyncPlan('MT-2', actions, tasks)[0].task, undefined);
});

test('绩效均分分别忽略缺失和非法分数，真实零分参与平均', () => {
  const scores = [row('1', 'A', { 自评分: '0' }), row('2', 'B', { 自评分: '100' }), row('3', 'C', { 自评分: '' }), row('4', 'D', { 自评分: '101' })];
  assert.deepEqual(scoreAverage(scores, '自评分'), { count: 2, average: '50.0' });
  assert.deepEqual(scoreAverage([], '自评分'), { count: 0, average: '—' });
});

test('纪要每项必须有负责人、实际有效日期，截止不能早于会议', () => {
  const action = { id: 'A1', title: '完成验证', owner: '林序', deadline: '2026-10-16' };
  assert.equal(meetingActionError([action], '2026-10-09'), '');
  assert.match(meetingActionError([{ ...action, owner: '' }], '2026-10-09'), /负责人/);
  assert.match(meetingActionError([{ ...action, deadline: '2026-10-08' }], '2026-10-09'), /不能早于/);
  assert.notEqual(meetingActionError([{ ...action, deadline: '2026-02-30' }], '2026-01-01'), '');
  assert.match(meetingActionError([action, action], '2026-10-09'), /编号重复/);
});
