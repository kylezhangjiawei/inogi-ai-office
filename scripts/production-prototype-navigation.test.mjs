import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function load(file, require = () => ({})) {
  const source = readFileSync(new URL(`../src/app/production/execution/${file}`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {}; new Function('exports', 'require', code)(exports, require); return exports;
}
const states = load('productionViewState.ts');
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' && tree.props ? [tree, ...nodes(tree.props.children)] : [];
const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree && typeof tree === 'object' && tree.props ? text(tree.props.children) : tree == null ? '' : String(tree);
const flush = () => new Promise(resolve => setImmediate(resolve));
const quality = { id: 'quality-original', source: 'production', issue: '装配干涉', status: 'open', disposition: 'pending', unit: '件', inspectedQty: 10, defectiveQty: 2, updatedAt: '2026-10-09T10:00:00Z' };
const taskA = { id: 'task-a', batchId: 'batch-a', name: '阀组件装配', line: '一线', output: 'component', unit: '件', quantity: 10, date: '2026-10-09', ownerId: 'owner-a', ownerName: '现场甲', status: 'draft', reports: [], inspections: [], fieldIssues: [], materials: [] };
const planA = { id: 'plan-a', version: 2, month: '2026-10', productLine: 'Q7', productName: '型号甲', bomRevisionId: 'bom-a', scope: 'all', batches: [{ id: 'batch-a', code: 'B-A', quantity: 10 }], tasks: [taskA], summary: { batchQty: 10, reportedWholeQty: 0 }, targetQty: 10 };
const taskB = { ...taskA, id: 'task-b', batchId: 'batch-b', status: 'dispatched', ownerId: 'owner-b', ownerName: '现场乙', reports: [{ id: 'r-b', date: '2026-10-09', quantity: 10, goodQty: 8 }], inspections: [{ id: 'i-b', kind: 'process', quantity: 10, goodQty: 8, quality }], fieldIssues: [{ id: 'field-b', quality }] };
const planB = { ...planA, id: 'plan-b', productLine: 'Q5', productName: '型号乙', batches: [{ id: 'batch-b', code: 'B-B', quantity: 10 }], tasks: [taskB] };

function fixture(file, { query = 'month=2026-10', permissions = ['production:plan'], plans = [planA, planB], productionPath = '/production-execution' } = {}) {
  let params = new URLSearchParams(query), cursor = 0;
  const slots = [], effects = [], cleanups = [];
  const primitive = new Proxy({}, { get: (_, name) => name });
  const t = value => value, user = { id: 'tester', permissions };
  const jsx = (type, props) => typeof type === 'function' ? type(props) : { type, props: props || {} };
  const module = load(file, name => {
    if (name === 'react') return {
      useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
      useEffect(effect, deps) { const i = cursor++; if (!slots[i] || deps.some((dep, index) => dep !== slots[i][index])) { slots[i] = deps; effects.push(() => { cleanups[i]?.(); cleanups[i] = effect(); }); } },
    };
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
    if (name === 'react-router') return { Link: 'Link', useSearchParams: () => [params, updater => { params = typeof updater === 'function' ? updater(params) : updater; }] };
    if (name === '../../auth') return { useAuth: () => ({ user }) };
    if (name.includes('usePermission')) return { usePermission: permission => permissions.includes(permission) };
    if (name.includes('i18n')) return { useI18n: () => ({ t }) };
    if (name.includes('productionExecutionApi')) return { listExecutionPlans: async () => plans };
    if (name.includes('productionViewState')) return states;
    if (name.includes('routePaths')) return { routePath: (code, fallback) => code === 'page:production-execution' ? productionPath : fallback };
    return primitive;
  });
  return { module, params: () => params, render(component, props = {}) { cursor = 0; const tree = module[component](props); while (effects.length) effects.shift()(); return tree; }, destroy() { for (const cleanup of cleanups) cleanup?.(); } };
}
async function workspace(options = {}) {
  const f = fixture('ProductionWorkspace.tsx', options);
  const render = () => f.render('ProductionWorkspace', { entry: options.entry, actionLabels: {}, renderEditor: props => ({ type: 'Editor', props }) });
  render(); await flush();
  return { ...f, render };
}
const control = (tree, label) => nodes(tree).find(node => node.props['aria-label'] === label);

test('正式生产页面将侧栏入口身份传入工作台，不在复用中丢失默认视图', () => {
  const entry = { title: '电子批记录', view: 'archive' };
  const f = fixture('ProductionExecutionPage.tsx');
  const tree = f.render('ProductionExecutionPage', { entry });
  assert.equal(tree.type, 'ProductionWorkspace');
  assert.deepEqual(tree.props.entry, entry);
  f.destroy();
});

test('侧栏入口缺省或无效视图显示各自标题与正式档案或检验数据', async () => {
  for (const entry of [{ title: '电子批记录', view: 'archive' }, { title: '全链路追溯', view: 'archive' }, { title: '检验与放行', view: 'inspections' }]) {
    for (const suffix of ['', '&view=not-a-view', `&view=${entry.view}`]) {
      const f = await workspace({ query: `month=2026-10&plan=plan-a${suffix}`, entry });
      const tree = f.render();
      const heading = nodes(tree).find(node => node.type === 'h1');
      assert.ok(text(heading).startsWith(entry.title), `${entry.title}: ${suffix}`);
      if (entry.view === 'archive') assert.equal(nodes(tree).find(node => node.type === 'LifecyclePanel')?.props.view, 'archive');
      else assert.deepEqual(nodes(tree).find(node => node.type === 'ProductionInspectionOverview')?.props.plans.map(row => row.id), ['plan-a']);
      assert.equal(nodes(tree).some(node => node.type === 'ProductionPlanningPage'), false);
      f.destroy();
    }
  }
});

test('入口不覆盖显式子栏目或检验详情标题，直接生产管理仍默认计划页', async () => {
  const entry = { title: '电子批记录', view: 'archive' };
  for (const [query, title] of [['month=2026-10&plan=plan-a&view=ecn', 'ECN 变更查看与确认'], ['month=2026-10&plan=plan-b&task=task-b&inspection=i-b', '生产检验与复验'], ['month=2026-10&plan=plan-a&record=ecn-1&recordType=ecn', 'ECN 变更查看与确认']]) {
    const f = await workspace({ query, entry });
    assert.ok(text(nodes(f.render()).find(node => node.type === 'h1')).startsWith(title));
    f.destroy();
  }
  const direct = await workspace();
  assert.ok(nodes(direct.render()).some(node => node.type === 'ProductionPlanningPage'));
  direct.destroy();
});

test('入口同页档案子导航保留相对路径及计划，跨栏目跳转使用自定义生产管理路径', async () => {
  const f = await workspace({ entry: { title: '电子批记录', view: 'archive' }, query: 'month=2026-10&plan=plan-a&archivesPage=3', productionPath: '/custom-production' });
  const tree = f.render();
  const secondary = nodes(control(tree, '转产与档案页面')).filter(node => node.type === 'Link');
  assert.equal(secondary.length, 4);
  for (const link of secondary) {
    assert.match(link.props.to, /^\?/);
    const query = new URLSearchParams(link.props.to.slice(1));
    assert.equal(query.get('plan'), 'plan-a');
    assert.equal(query.get('month'), '2026-10');
    assert.equal(query.get('archivesPage'), '3');
  }
  const main = nodes(control(tree, '生产原型页面')).filter(node => node.type === 'Link');
  assert.equal(main.length, 6);
  const allTasks = nodes(tree).find(node => node.type === 'Link' && text(node) === '全部任务');
  for (const link of [...main, allTasks]) {
    const url = new URL(link.props.to, 'http://local/ebpr');
    assert.equal(url.pathname, '/custom-production');
    assert.equal(url.searchParams.get('month'), '2026-10');
    assert.equal(url.searchParams.has('plan'), false);
  }
  assert.equal(new URL(allTasks.props.to, 'http://local').searchParams.get('view'), 'all-tasks');
  f.destroy();
});

test('检验入口从作业返回保留本页过滤与分页，全部现场任务明确离开入口', async () => {
  const entry = { title: '检验与放行', view: 'inspections' };
  const query = 'month=2026-10&plan=plan-b&task=task-b&taskFrom=inspections&taskSection=quality&inspection=i-b&qualityPage=3&qualityQ=尺寸';
  const f = await workspace({ entry, query, productionPath: '/custom-production' });
  const links = nodes(control(f.render(), '生产页面路径')).filter(node => node.type === 'Link');
  const back = links.find(node => text(node) === '返回生产检验');
  assert.match(back.props.to, /^\?/);
  const url = new URL(back.props.to, 'http://local/inspection-release');
  assert.equal(url.pathname, '/inspection-release');
  for (const [key, value] of [['view', 'inspections'], ['month', '2026-10'], ['plan', 'plan-b'], ['qualityPage', '3'], ['qualityQ', '尺寸']]) assert.equal(url.searchParams.get(key), value);
  for (const key of ['task', 'inspection', 'taskSection', 'taskFrom']) assert.equal(url.searchParams.has(key), false);
  const allTasks = new URL(links.find(node => text(node) === '全部现场任务').props.to, 'http://local/inspection-release');
  assert.equal(allTasks.pathname, '/custom-production');
  assert.equal(allTasks.searchParams.get('view'), 'tasks');
  assert.equal(allTasks.searchParams.has('task'), false);
  f.destroy();
});

test('显式生产计划优先于残留型号条件，数据、型号与计划选择器保持同一来源', async () => {
  const f = await workspace({ query: 'month=2026-10&view=batches&plan=plan-b&planModel=Q7' });
  const tree = f.render();
  assert.equal(control(tree, '计划产品型号').props.value, 'Q5');
  const select = control(tree, '当前生产计划');
  assert.equal(select.props.value, planB.id);
  assert.ok(nodes(select).some(node => node.type === 'option' && node.props.value === planB.id));
  assert.equal(nodes(tree).find(node => node.type === 'ProductionPlanningPage').props.plan.id, planB.id);
  const href = nodes(tree).find(node => node.type === 'Link' && text(node) === '全部任务').props.to;
  assert.equal(new URLSearchParams(href.slice(1)).get('planModel'), 'Q5');
  f.destroy();
});

test('切换计划、型号或月份清除旧生产单和详情参数，保留新的范围', async () => {
  const dirty = 'month=2026-10&view=batches&plan=plan-a&dispatchBatch=batch-a&dispatchTask=task-a&dispatchLine=一线&dispatchDate=2026-10-09&scheduleBatch=batch-a&scheduleOwner=owner-a&scheduleStart=2026-10-09&readinessBatch=batch-a&allSelected=task/task-a&task=task-a&taskSection=quality&quality=old&batch=batch-a&workQueueModel=Q7&workQueueLine=一线&inspectQueueModel=Q7&scheduleDate=2026-10-09&scheduleTask=task-a';
  for (const [label, value, key, expected] of [['当前生产计划', 'plan-b', 'plan', 'plan-b'], ['计划产品型号', 'Q5', 'planModel', 'Q5'], ['计划月份', '2026-11', 'month', '2026-11']]) {
    const f = await workspace({ query: dirty });
    control(f.render(), label).props.onChange({ target: { value } });
    assert.equal(f.params().get(key), expected);
    for (const old of ['batch', 'workQueueModel', 'workQueueLine', 'inspectQueueModel', 'scheduleDate', 'scheduleTask', 'dispatchBatch', 'dispatchTask', 'dispatchLine', 'dispatchDate', 'scheduleBatch', 'scheduleOwner', 'scheduleStart', 'readinessBatch', 'allSelected', 'task', 'taskSection', 'quality']) assert.equal(f.params().has(old), false, `${label} should reset ${old}`);
    f.destroy();
  }
});

test('新建不同型号的计划后清空旧筛选并进入返回的计划编号', async () => {
  const f = await workspace({ query: 'month=2026-10&view=batches&plan=plan-a&planModel=Q7&dispatchBatch=batch-a' });
  nodes(f.render()).find(node => node.type === 'Button' && text(node).includes('新建月度计划')).props.onClick();
  const editor = nodes(f.render()).find(node => node.type === 'Editor');
  assert.equal(editor.props.editor.action, 'create'); assert.equal(editor.props.plan, undefined);
  editor.props.onSaved(planB.id);
  assert.equal(f.params().get('plan'), planB.id); assert.equal(f.params().get('view'), 'batches');
  assert.equal(f.params().has('planModel'), false); assert.equal(f.params().has('dispatchBatch'), false);
  f.destroy();
});

test('跨计划质量协同编辑绑定来源计划与原异常，不更改全局列表范围', async () => {
  const f = await workspace({ query: 'month=2026-10&view=quality', permissions: ['proc-quality:manage'] });
  const page = nodes(f.render()).find(node => node.type === 'ProductionQualityPage');
  page.props.onEdit(planB, { action: 'assign-quality', task: taskB, quality });
  const editor = nodes(f.render()).find(node => node.type === 'Editor');
  assert.equal(editor.props.plan.id, planB.id); assert.equal(editor.props.plan.version, planB.version);
  assert.equal(editor.props.editor.task.id, taskB.id); assert.equal(editor.props.editor.quality.id, quality.id);
  assert.equal(f.params().has('plan'), false); assert.equal(f.params().get('view'), 'quality');
  f.destroy();
});

test('无权计划深链不会退回到首个授权计划，也不呈现业务详情', async () => {
  const f = await workspace({ query: 'month=2026-10&view=batches&plan=hidden', plans: [planA] });
  const tree = f.render();
  assert.ok(nodes(tree).some(node => node.type === 'ProductionEmpty' && node.props.title === '所选计划不存在或无权查看'));
  assert.equal(nodes(tree).some(node => node.type === 'ProductionPlanningPage'), false);
  f.destroy();
});

test('P06 不重复汇总现场和检验引用的异常，办理链接始终指向原异常', () => {
  const f = fixture('ProductionAllTasks.tsx', { query: 'month=2026-10&view=all-tasks&allKind=quality&task=stale&inspection=old&record=old&recordType=batch' });
  const tree = f.render('ProductionAllTasks', { plans: [planA, planB] });
  const links = nodes(tree).filter(node => node.type === 'Link' && text(node) === '处理原异常');
  assert.equal(links.length, 1);
  const href = new URLSearchParams(links[0].props.to.slice(1));
  assert.equal(href.get('quality'), quality.id); assert.equal(href.get('plan'), planB.id); assert.equal(href.get('view'), 'quality'); assert.equal(href.get('month'), '2026-10');
  for (const key of ['task', 'inspection', 'record', 'recordType']) assert.equal(href.has(key), false);
  const pagination = nodes(tree).find(node => node.type === 'ProductionPagination'); assert.equal(pagination.props.total, 1);
});

test('P01 派工操作保留权限和原作业身份，只读人员没有写入按钮', () => {
  for (const canPlan of [true, false]) {
    const edits = [], f = fixture('ProductionPlanningPage.tsx', { permissions: canPlan ? ['production:plan'] : [] });
    const tree = f.render('ProductionPlanningPage', { plan: planA, onEdit: value => edits.push(value) });
    const dispatch = nodes(tree).find(node => node.type === 'Button' && text(node) === '确认派工');
    assert.equal(Boolean(dispatch), canPlan);
    if (dispatch) { dispatch.props.onClick(); assert.equal(edits[0].task.id, taskA.id); assert.equal(edits[0].action, 'dispatch'); }
    assert.equal(nodes(tree).some(node => node.type === 'Button' && text(node) === '新增生产单'), canPlan);
  }
});

test('P07 原型模式仅有取消任务时呈现空态，既有日程模式保留历史查看', () => {
  const data = { ...planA, tasks: [{ ...taskA, status: 'cancelled' }] };
  for (const prototype of [true, false]) {
    const f = fixture('ProductionSchedule.tsx', { query: 'scheduleStart=2026-10-09&scheduleSpan=3' });
    const tree = f.render('ProductionSchedule', { plan: data, prototype });
    const count = nodes(tree).find(node => node.props.className === 'production-schedule-summary');
    assert.match(text(count), prototype ? /0 项作业/ : /1 项作业/);
    assert.equal(nodes(tree).some(node => node.type === 'ProductionEmpty'), prototype);
    if (!prototype) assert.ok(nodes(tree).some(node => node.type === 'Link' && node.props['data-cancelled']));
  }
});
