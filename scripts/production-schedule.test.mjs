import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const element = (type, props) => ({ type, props: props || {} });
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' && tree.props ? [tree, ...nodes(tree.props.children)] : [];
const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree && typeof tree === 'object' && tree.props ? text(tree.props.children) : tree == null ? '' : String(tree);
class Clock extends Date { static now() { return Date.parse('2026-09-20T06:00:00Z'); } }

function compile(path, dependencies = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  new Function('require', 'exports', 'Date', output)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unmocked dependency: ${name}`);
    return dependencies[name];
  }, exports, Clock);
  return exports;
}
const state = compile('src/app/production/execution/productionViewState.ts');
const task = (id, fields = {}) => ({ id, batchId: 'batch-1', name: `作业 ${id}`, date: '2026-09-20', line: '装配一线', ownerId: 'owner-1', ownerName: '张工', quantity: 20, unit: '件', status: 'dispatched', reports: [], inspections: [], ...fields });
const plan = tasks => ({ id: 'plan-1', month: '2026-09', productLine: 'Q7', summary: { batchQty: 300 }, events: [], tasks, batches: [{ id: 'batch-1', code: '九月首批' }, { id: 'batch-2', code: '九月次批' }] });

function fixture(selectedPlan, query = '', prototype = false) {
  let params = new URLSearchParams(query), tree;
  const controls = names => Object.fromEntries(names.map(name => [name, name]));
  const { ProductionSchedule } = compile('src/app/production/execution/ProductionSchedule.tsx', {
    'react/jsx-runtime': { jsx: element, jsxs: element, Fragment: 'Fragment' },
    'react-router': { Link: 'Link', useSearchParams: () => [params, update => { params = typeof update === 'function' ? update(params) : update; }] },
    '../../components/ui/button': controls(['Button']),
    '../../components/ui/input': controls(['Input']),
    '../../components/ui/native-select': controls(['NativeSelect']),
    '../../components/ui/table': controls(['Table', 'TableBody', 'TableCell', 'TableHead', 'TableHeader', 'TableRow']),
    './ProductionView': controls(['ProductionEmpty', 'ProductionPagination', 'ProductionStatus']),
    './productionViewState': state,
  });
  const render = () => { tree = ProductionSchedule({ plan: selectedPlan, prototype }); return tree; };
  const find = predicate => nodes(tree).find(predicate);
  render();
  return {
    render, params: () => params, tree: () => tree,
    find,
    text: () => text(tree),
    dates: () => nodes(tree).filter(row => row.type === 'time').map(row => row.props.dateTime),
    links: () => nodes(tree).filter(row => row.type === 'Link'),
    ids: () => nodes(tree).filter(row => row.type === 'Link').map(row => new URLSearchParams(row.props.to.slice(1)).get('task')),
    change(label, value) { const input = find(row => row.props['aria-label'] === label); assert.ok(input, label); input.props.onChange({ target: { value } }); render(); },
    click(label) { const button = find(row => row.type === 'Button' && text(row) === label); assert.ok(button, label); button.props.onClick(); render(); },
    page(value) { find(row => row.type === 'ProductionPagination').props.onPageChange(value); render(); },
  };
}

test('日程默认当前计划月从今天开始，其他月份从月首展示 10 天', () => {
  const current = fixture(plan([task('today')]));
  assert.equal(current.find(row => row.props['aria-label'] === '日程开始日期').props.value, '2026-09-20');
  assert.deepEqual(current.dates(), Array.from({ length: 10 }, (_, index) => `2026-09-${20 + index}`));
  const previous = fixture({ ...plan([task('old', { date: '2026-08-01' })]), month: '2026-08' });
  assert.equal(previous.dates()[0], '2026-08-01');
  assert.equal(previous.dates().at(-1), '2026-08-10');
});

test('3 天日程跨月与闰日保持连续，日期范围之外的任务不会混入', () => {
  const view = fixture(plan([task('a', { date: '2028-02-28' }), task('b', { date: '2028-02-29' }), task('c', { date: '2028-03-01' }), task('d', { date: '2028-03-02' })]), 'scheduleStart=2028-02-28&scheduleSpan=3');
  assert.deepEqual(view.dates(), ['2028-02-28', '2028-02-29', '2028-03-01']);
  assert.deepEqual(view.ids(), ['a', 'b', 'c']);
  view.click('下一段');
  assert.equal(view.params().get('scheduleStart'), '2028-03-02');
  assert.deepEqual(view.ids(), ['d']);
  view.click('上一段');
  assert.deepEqual(view.dates(), ['2028-02-28', '2028-02-29', '2028-03-01']);
});

test('自定义区间包含首尾且最多 31 天，倒置日期和非法日期安全恢复', () => {
  const selected = plan([task('start', { date: '2026-09-01' }), task('end', { date: '2026-10-01' }), task('outside', { date: '2026-10-02' })]);
  const view = fixture(selected, 'scheduleStart=2026-09-01&scheduleSpan=custom&scheduleEnd=2027-01-01');
  assert.equal(view.dates().length, 31);
  assert.deepEqual(view.ids(), ['start', 'end']);
  assert.ok(view.find(row => row.props.role === 'alert'));
  assert.equal(view.find(row => row.props['aria-label'] === '日程结束日期').props.max, '2026-10-01');
  view.change('日程结束日期', '2026-08-01');
  assert.equal(view.params().get('scheduleEnd'), '2026-09-01');
  assert.equal(view.dates().length, 1);
  view.change('日程结束日期', '2027-01-01');
  assert.equal(view.params().get('scheduleEnd'), '2026-10-01');
  const invalid = fixture(plan([task('today')]), 'scheduleStart=2026-02-30&scheduleSpan=unknown&scheduleEnd=bad');
  assert.equal(invalid.dates()[0], '2026-09-20');
  assert.equal(invalid.dates().length, 10);
});

test('自定义日期平移保持区间长度，切换固定区间清除结束日期且重置分页', () => {
  const view = fixture(plan([task('a')]), 'scheduleStart=2026-09-20&scheduleSpan=custom&scheduleEnd=2026-09-24&schedulePage=2&month=2026-09');
  view.change('日程开始日期', '2026-10-02');
  assert.equal(view.params().get('scheduleEnd'), '2026-10-06');
  assert.equal(view.params().has('schedulePage'), false);
  assert.equal(view.params().get('month'), '2026-09');
  view.click('今天');
  assert.equal(view.params().get('scheduleStart'), '2026-09-20');
  assert.equal(view.params().get('scheduleEnd'), '2026-09-24');
  view.change('日程显示区间', '3');
  assert.equal(view.params().has('scheduleEnd'), false);
  assert.equal(view.dates().length, 3);
  const before = view.params().toString();
  view.change('日程开始日期', '');
  assert.equal(view.params().toString(), before);
});

test('产线、负责人账号、批次筛选相交，同名人员不会串号且不会改其他栏目筛选', () => {
  const view = fixture(plan([
    task('first'), task('same-name', { ownerId: 'owner-2' }), task('other-line', { line: '装配二线' }),
    task('other-batch', { batchId: 'batch-2' }), task('name-only', { ownerId: '' }),
  ]), 'month=2026-09&plan=plan-1&taskQ=保留&schedulePage=3');
  view.change('日程负责人', 'owner-1');
  assert.deepEqual(view.ids().sort(), ['first', 'other-line', 'other-batch'].sort());
  view.change('日程产线或工位', '装配一线');
  view.change('日程批次', 'batch-1');
  assert.deepEqual(view.ids(), ['first']);
  assert.equal(view.params().has('schedulePage'), false);
  assert.equal(view.params().get('taskQ'), '保留');
  view.change('日程负责人', 'owner-2');
  assert.deepEqual(view.ids(), ['same-name']);
  view.change('日程负责人', 'all');
  assert.equal(view.params().has('scheduleOwner'), false);
  assert.deepEqual(view.ids(), ['first', 'same-name', 'name-only']);
});

test('点击作业保留全部日程条件，定位正确计划并声明返回日程，清除旧详情参数', () => {
  const query = 'month=2026-09&scheduleStart=2026-09-20&scheduleSpan=custom&scheduleEnd=2026-09-23&scheduleLine=装配一线&scheduleOwner=owner-1&scheduleBatch=batch-1&schedulePage=1&taskQ=之前&taskSection=quality&inspection=old&record=old&recordType=ecn';
  const view = fixture(plan([task('task / 1')]), query);
  const target = new URLSearchParams(view.links()[0].props.to.slice(1));
  for (const [key, value] of new URLSearchParams(query)) if (key.startsWith('schedule') || key === 'month' || key === 'taskQ') assert.equal(target.get(key), value, key);
  assert.equal(target.get('plan'), 'plan-1');
  assert.equal(target.get('view'), 'tasks');
  assert.equal(target.get('task'), 'task / 1');
  assert.equal(target.get('taskFrom'), 'schedule');
  for (const key of ['taskSection', 'inspection', 'record', 'recordType']) assert.equal(target.has(key), false, key);
});

test('同日同线任务各自保留单位与真实报工量，取消作业只标状态不显示进度', () => {
  const view = fixture(plan([
    task('units', { quantity: 10, unit: '台', reports: [{ quantity: 4 }] }),
    task('pieces', { quantity: 20, unit: '件', reports: [{ quantity: 7 }] }),
    task('cancelled', { quantity: 100, status: 'cancelled', reports: [{ quantity: 50 }] }),
  ]));
  const [units, pieces, cancelled] = view.links();
  assert.match(text(units), /计划 10 台已报 4 台/);
  assert.match(text(pieces), /计划 20 件已报 7 件/);
  assert.match(text(cancelled), /已取消/);
  assert.doesNotMatch(text(cancelled), /已报|%/);
  assert.equal(cancelled.props['data-cancelled'], true);
  assert.doesNotMatch(view.text(), /产能|负载率|30 台|30 件/);
  assert.equal(nodes(view.tree()).filter(row => row.type === 'TableHead' && row.props.scope === 'row').length, 1);
});

test('超过 8 条产线分页，最后一页钳制并可独立筛选，不渲染整月所有任务', () => {
  const tasks = Array.from({ length: 17 }, (_, index) => task(String(index), { line: `产线 ${String(index).padStart(2, '0')}` }));
  const view = fixture(plan(tasks));
  assert.deepEqual(view.ids(), ['0', '1', '2', '3', '4', '5', '6', '7']);
  assert.equal(view.find(row => row.type === 'ProductionPagination').props.total, 17);
  view.page(2);
  assert.deepEqual(view.ids(), ['8', '9', '10', '11', '12', '13', '14', '15']);
  view.page(99);
  assert.deepEqual(view.ids(), ['16']);
  assert.equal(view.find(row => row.type === 'ProductionPagination').props.page, 3);
  view.change('日程产线或工位', '产线 03');
  assert.deepEqual(view.ids(), ['3']);
  assert.equal(view.params().has('schedulePage'), false);
});

test('未知筛选保持空态，缺少日期显式提示，未填产线仍可查看', () => {
  const selected = plan([task('known'), task('undated', { date: '' }), task('unassigned', { line: '', ownerId: '', ownerName: '' })]);
  const view = fixture(selected, 'scheduleOwner=unavailable');
  assert.equal(view.find(row => row.type === 'ProductionEmpty').props.title, '当前日程没有匹配的作业');
  assert.equal(view.find(row => row.type === 'Table'), undefined);
  view.change('日程负责人', 'all');
  assert.match(view.text(), /1 项作业尚未填写计划日期/);
  assert.ok(view.ids().includes('unassigned'));
  assert.ok(!view.ids().includes('undated'));
  assert.match(view.text(), /产线 \/ 工位待确认/);
  const empty = fixture(plan([]));
  assert.equal(empty.find(row => row.type === 'ProductionEmpty').props.title, '还没有排期作业');
});


test('P07 日计划项逐项标工序和实际单位，选择工序联动三块详情并保留原任务链接', () => {
  const view = fixture(plan([
    task('parts', { name: '阀组件装配', quantity: 200, unit: '件', reports: [{ quantity: 160, goodQty: 154 }] }),
    task('kits', { name: '筛筒组件', quantity: 80, unit: '套', line: '二线', reports: [{ quantity: 20, goodQty: 18 }] }),
    task('whole', { name: '整机总装', quantity: 100, unit: '台', date: '2026-09-21' }),
  ]), 'scheduleStart=2026-09-20&scheduleSpan=3&qualityStatus=open', true);
  const entries = nodes(view.tree()).filter(row => row.props.className === 'pp-schedule-entry');
  assert.equal(entries.length, 3);
  for (const [name, count, unit] of [['阀组件装配', 200, '件'], ['筛筒组件', 80, '套'], ['整机总装', 100, '台']]) {
    const entry = entries.find(row => text(row).includes(name));
    assert.ok(entry, name);
    assert.match(text(entry), new RegExp(`${count} ${unit}`));
  }
  assert.ok(view.find(row => row.props.className === 'pp-schedule-day-detail'));
  assert.ok(view.find(row => row.props.className === 'pp-schedule-operation-detail'));
  assert.ok(view.find(row => row.props.className === 'pp-schedule-change-detail'));
  assert.equal(view.find(row => row.props['aria-label'] === '排程明细视图'), undefined, '原型三块同时可见，不改成标签页');
  entries.find(row => text(row).includes('筛筒组件')).props.onClick(); view.render();
  assert.equal(view.params().get('scheduleTask'), 'kits');
  assert.equal(view.params().get('scheduleDate'), '2026-09-20');
  assert.equal(view.params().get('qualityStatus'), 'open');
  const metrics = view.find(row => row.props.className === 'pp-schedule-day-metrics');
  assert.match(text(metrics), /计划数量80套已报工20套报工良品18套待报工60套待终检20套/);
  assert.doesNotMatch(text(metrics), /合格完成|返工待复验|154|200/);
  const original = view.links().find(row => text(row) === '进入原任务');
  const target = new URLSearchParams(original.props.to.slice(1));
  assert.equal(target.get('task'), 'kits'); assert.equal(target.get('taskFrom'), 'schedule');
  assert.equal(target.get('scheduleTask'), 'kits'); assert.equal(target.get('scheduleStart'), '2026-09-20');
  view.find(row => row.props['aria-label'] === '查看 2026-09-22 日计划').props.onClick(); view.render();
  assert.equal(view.params().get('scheduleDate'), '2026-09-22');
  assert.equal(view.find(row => row.props.className === 'pp-schedule-day-metrics'), undefined);
  assert.ok(nodes(view.tree()).some(row => row.type === 'ProductionEmpty' && row.props.title === '当天没有安排工序'));
});

test('P07 变更日志使用真实事件前后值，保留改期前历史并按生产单隔离', () => {
  const tasks = [task('one', { name: '阀组件装配', quantity: 120 }), task('two', { name: '另一生产单工序', batchId: 'batch-2' })];
  const selected = { ...plan(tasks), events: [
    { id: 'event-one', action: 'adjust', subjectId: 'one', actorName: '计划员', at: '2026-09-19T02:00:00Z', reason: '按到料日期调整', adjustment: { before: { date: '2026-09-01', line: '一线', ownerId: 'old', ownerName: '李工', quantity: 100 }, after: { date: '2026-09-20', line: '装配一线', ownerId: 'owner-1', ownerName: '张工', quantity: 120 } } },
    { id: 'event-other', action: 'dispatch', subjectId: 'two', actorName: '主管', at: '2026-09-19T03:00:00Z', reason: '其他生产单确认' },
    { id: 'event-report', action: 'report', subjectId: 'one', actorName: '现场人', at: '2026-09-20T03:00:00Z', reason: '现场报工说明' },
  ] };
  const view = fixture(selected, 'scheduleStart=2026-09-20&scheduleSpan=3&scheduleBatch=batch-1', true);
  const history = view.find(row => row.props.className === 'pp-schedule-history');
  assert.match(text(history), /2026-09-01 → 2026-09-20/);
  assert.match(text(history), /数量：100 → 120 件/);
  assert.match(text(history), /负责人：李工 → 张工/);
  assert.match(text(history), /按到料日期调整/);
  assert.doesNotMatch(text(history), /其他生产单确认|现场报工说明/);
  assert.equal(nodes(history).filter(row => row.type === 'Link').length, 1);
  assert.equal(new URLSearchParams(nodes(history).find(row => row.type === 'Link').props.to.slice(1)).get('task'), 'one');
});
