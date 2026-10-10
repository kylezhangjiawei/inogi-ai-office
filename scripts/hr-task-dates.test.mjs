import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const out = {};
const code = ts.transpileModule(readFileSync(new URL('../src/app/hr/hrLogic.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
new Function('exports', code)(out);
const row = (start, end, cycle = '每月', extra = {}) => ({ id: 'TASK-1', title: '周期任务', dept: '人事行政部', owner: '周宁', status: '已完成', date: end, detail: '', history: [], fields: { '开始日期': start, '循环周期': cycle, ...extra } });
const next = source => ({ ...out.nextRecurringTask(source), id: `${source.id}-NEXT`, history: [] });
const day = value => Date.parse(`${value}T00:00:00Z`);

test('甘特月分段只包含真实日期，平年二月/闰年二月/大小月连续且没有跨月空格', () => {
  for (const [month, last, count] of [['2026-02', 28, 7], ['2028-02', 29, 8], ['2026-04', 30, 8], ['2026-10', 31, 8]]) {
    const ranges = out.ganttDateRanges(month);
    assert.equal(ranges.length, count);
    assert.equal(ranges[0].start, day(`${month}-01`));
    assert.equal(ranges.at(-1).end, day(`${month}-${last}`));
    for (let i = 1; i < ranges.length; i++) assert.equal(ranges[i].start - ranges[i - 1].end, 86400000);
    assert.match(ranges.at(-1).label, new RegExp(`${last} 日$`));
  }
  assert.deepEqual(out.ganttDateRanges('2026-13'), []);
  assert.deepEqual(out.ganttDateRanges(''), []);
});

test('甘特只显示实际月内重叠；次月任务不应落入当前月最后一格', () => {
  const bars = (month, start, end) => out.ganttDateRanges(month).filter(range => day(start) <= range.end && day(end) >= range.start);
  assert.equal(bars('2026-02', '2026-03-01', '2026-03-02').length, 0);
  assert.equal(bars('2026-04', '2026-05-01', '2026-05-01').length, 0);
  assert.equal(bars('2026-10', '2026-11-01', '2026-11-01').length, 0);
  assert.equal(bars('2028-02', '2028-02-29', '2028-02-29').length, 1);
  assert.equal(bars('2026-02', '2026-01-31', '2026-02-02').length, 1);
});

test('月末循环以截止日为锚点且持续天数不漂移，旧开始日锚点不会缩短任务', () => {
  const feb = next(row('2026-01-30', '2026-01-31', '每月', { '开始基准日': '30', '已生成下期': 'OLD-NEXT' }));
  assert.equal(feb.date, '2026-02-28');
  assert.equal(feb.fields['开始日期'], '2026-02-27');
  assert.equal(feb.fields['循环基准日'], '31');
  assert.equal(feb.fields['开始基准日'], undefined);
  assert.equal(feb.fields['已生成下期'], undefined);
  assert.equal(feb.fields['上期任务编号'], 'TASK-1');
  assert.equal(feb.status, '待开始');
  const mar = next(feb);
  assert.equal(mar.date, '2026-03-31');
  assert.equal(mar.fields['开始日期'], '2026-03-30');
  const apr = next(mar);
  assert.equal(apr.date, '2026-04-30');
  assert.equal(apr.fields['开始日期'], '2026-04-29');
});

test('每天/每周/每季度/每年保持持续时间并正确跨年、处理闰日', () => {
  for (const [cycle, start, end, expectedStart, expectedEnd] of [
    ['每天', '2026-12-29', '2026-12-31', '2026-12-30', '2027-01-01'],
    ['每周', '2026-12-29', '2026-12-31', '2027-01-05', '2027-01-07'],
    ['每季度', '2026-11-29', '2026-11-30', '2027-02-27', '2027-02-28'],
    ['每年', '2028-02-28', '2028-02-29', '2029-02-27', '2029-02-28'],
  ]) {
    const generated = next(row(start, end, cycle));
    assert.equal(generated.date, expectedEnd, cycle);
    assert.equal(generated.fields['开始日期'], expectedStart, cycle);
  }
  let annual = row('2028-02-28', '2028-02-29', '每年');
  for (let i = 0; i < 4; i++) annual = next(annual);
  assert.equal(annual.date, '2032-02-29');
  assert.equal(annual.fields['开始日期'], '2032-02-28');
});

test('生成下期拒绝无效日期和倒置的开始/截止日期', () => {
  for (const source of [row('2026-02-29', '2026-03-01'), row('2026-03-02', '2026-03-01'), row('2026-02-01', '2026-02-30')]) {
    assert.throws(() => out.nextRecurringTask(source), /日期|晚于/);
  }
});
