import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function compile(path, require = () => ({})) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  new Function('require', 'exports', code)(require, exports);
  return exports;
}
const state = compile('src/app/production/execution/productionViewState.ts');
const inspections = compile('src/app/production/execution/productionInspectionModel.ts');
const element = (type, props) => ({ type, props: props || {} });
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' && tree.props ? [tree, ...nodes(tree.props.children)] : [];
const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree && typeof tree === 'object' && tree.props ? text(tree.props.children) : tree == null ? '' : String(tree);
function component(path, query) {
  let params = new URLSearchParams(query);
  const controls = {};
  for (const name of ['Button', 'Input', 'NativeSelect', 'Table', 'TableBody', 'TableCell', 'TableHead', 'TableHeader', 'TableRow', 'Tabs', 'TabsContent', 'TabsList', 'TabsTrigger', 'ProductionEmpty', 'ProductionPagination', 'ProductionStatus', 'ProductionMetrics', 'LifecycleControlledDocuments']) controls[name] = name;
  const module = compile(path, name => {
    if (name === 'react/jsx-runtime') return { jsx: element, jsxs: element, Fragment: 'Fragment' };
    if (name === 'react-router') return { Link: 'Link', useSearchParams: () => [params, update => { params = typeof update === 'function' ? update(params) : update; }] };
    if (name === 'lucide-react') return { ArrowLeft: 'ArrowLeft' };
    if (name.includes('productionViewState')) return state;
    if (name.includes('productionInspectionModel')) return inspections;
    if (name.includes('routePaths')) return { routePath: (_, fallback) => fallback };
    return controls;
  });
  return { module, params: () => params };
}
const plan = { id: 'plan-1', month: '2026-09', productName: '制氧机', productLine: 'Q7', batches: [{ id: 'b1', code: '九月首批', dueDate: '2026-09-30', quantity: 20 }], tasks: [], events: [] };
const task = { id: 'task-1', batchId: 'b1', name: '阀体装配', line: '一线', date: '2026-09-20', ownerId: 'owner', ownerName: '现场甲', output: 'component', unit: '件', quantity: 20, status: 'dispatched', reports: [], inspections: [], materials: [] };

test('过程检和复验不会改变首次终检分母；历史未分类明确保留', () => {
  const rows = [{kind:'process',quantity:100,goodQty:99}, {kind:'final',quantity:50,goodQty:47,verifiedGoodQty:2,date:'2026-09-20'}, {quantity:500,goodQty:500}];
  assert.deepEqual(inspections.firstFinalInspection(rows), {quantity:50,goodQty:47,rate:94});
  assert.equal(inspections.inspectionKindLabel(rows[2]), '历史未分类初检');
  assert.equal(state.productionTaskState({...task,reports:[{quantity:20}],inspections:[{kind:'process',quantity:20}]}).label,'待终检');
});
test('检验列表日期汇总只含整机终检，类型过滤重置分页，独立详情保留来路', () => {
  const final = {id:'final-1',kind:'final',date:'2026-09-20',quantity:50,goodQty:47,verifiedGoodQty:2,process:'终检',sip:{text:'SIP V1'}};
  const data = {...plan,tasks:[{...task,output:'whole',inspections:[final,{...final,id:'process-1',kind:'process',goodQty:50},{...final,id:'old-1',kind:undefined}]},{...task,id:'component',inspections:[{...final,id:'component-1',goodQty:50}]}]};
  const f = component('src/app/production/execution/ProductionLists.tsx','plan=plan-1&view=inspections&qualityDate=2026-09-20&qualityKind=final&qualityPage=3');
  const tree=f.module.ProductionInspectionList({plan:data});
  assert.match(text(tree),/94.0%/); assert.match(text(tree),/47 \/ 50 台/);
  assert.equal(nodes(tree).filter(row=>row.type==='Link'&&text(row)==='查看检验').length,2);
  const to=new URLSearchParams(nodes(tree).find(row=>row.type==='Link'&&text(row)==='查看检验').props.to.slice(1));
  assert.equal(to.get('taskFrom'),'inspections');assert.equal(to.get('inspection'),'final-1');assert.equal(to.get('qualityPage'),'3');
  nodes(tree).find(row=>row.type==='NativeSelect').props.onChange({target:{value:'legacy'}});
  assert.equal(f.params().get('qualityKind'),'legacy');assert.equal(f.params().has('qualityPage'),false);
});
test('原作业详情仅计划员可调整，传原编号并展示已有调整留痕', () => {
  const f=component('src/app/production/execution/ProductionTaskDetail.tsx','plan=plan-1&task=task-1');
  const edits=[];
  const props={plan,task,permissions:{canPlan:true},onEdit:row=>edits.push(row),onVerify(){}};
  const tree=f.module.ProductionTaskDetail(props);
  nodes(tree).find(row=>row.type==='Button'&&text(row)==='调整作业安排').props.onClick();
  assert.equal(edits[0].action,'adjust');assert.equal(edits[0].task.id,'task-1');
  assert.equal(nodes(f.module.ProductionTaskDetail({...props,permissions:{canPlan:false}})).some(row=>row.type==='Button'&&text(row)==='调整作业安排'),false);
});


test('分页钳制非法和过大页码，搜索支持空格分词，且不修改原数组', () => {
  const rows = Array.from({ length: 25 }, (_, id) => ({ id }));
  assert.deepEqual(state.productionPage(rows, '999').rows, [rows[24]]);
  assert.equal(state.productionPage(rows, '-3').page, 1);
  assert.equal(state.productionPage([], '4').pageCount, 1);
  assert.equal(rows.length, 25);
  assert.equal(state.productionSearch(' q7 阀 ', ['Q7', '阀体']), true);
  assert.equal(state.productionSearch('q8 阀', ['Q7', '阀体']), false);
});

test('深链更新与返回只改变指定参数，保留月份和列表筛选分页', () => {
  const source = new URLSearchParams('month=2026-09&plan=plan-1&view=tasks&taskPage=3&taskQ=阀体');
  const detail = state.productionQuery(source, { task: '任务 / 1', inspection: 'i-1' });
  assert.equal(detail.get('taskPage'), '3');
  assert.equal(new URLSearchParams(detail.toString()).get('task'), '任务 / 1');
  assert.equal(source.has('task'), false);
  const back = state.productionQuery(detail, { task: null, inspection: null });
  assert.equal(back.toString(), source.toString());
});

test('作业提示优先未闭环异常与待检，不把报工已齐伪装为质量放行', () => {
  assert.equal(state.productionTaskState({ ...task, status: 'draft' }).key, 'draft');
  assert.equal(state.productionTaskState({ ...task, reports: [{ quantity: 20 }] }).key, 'inspection');
  assert.equal(state.productionTaskState({ ...task, reports: [{ quantity: 20 }], inspections: [{ quantity: 20, quality: { status: 'open' } }] }).key, 'quality');
  assert.equal(state.productionTaskState({ ...task, reports: [{ quantity: 20 }], inspections: [{ quantity: 20, quality: { status: 'closed' } }] }).label, '报工已齐');
  assert.equal(state.productionTaskState({ ...task, status: 'cancelled' }).key, 'cancelled');
});

test('作业列表链接直接定位作业并保留筛选；筛选变化重置当前分页', () => {
  const f = component('src/app/production/execution/ProductionLists.tsx', 'month=2026-09&plan=plan-1&taskPage=2&taskQ=阀');
  const tree = f.module.ProductionTaskList({ plan: { ...plan, tasks: [task] } });
  const link = nodes(tree).find(row => row.type === 'Link' && text(row) === '阀体装配');
  const target = new URLSearchParams(link.props.to.slice(1));
  assert.equal(target.get('task'), 'task-1'); assert.equal(target.get('plan'), 'plan-1'); assert.equal(target.get('taskQ'), '阀');
  nodes(tree).find(row => row.type === 'Input').props.onChange({ target: { value: '新名称' } });
  assert.equal(f.params().get('taskQ'), '新名称'); assert.equal(f.params().has('taskPage'), false);
});

test('作业详情保留原报工权限：本人可办理，其他现场人员不可代办', () => {
  const f = component('src/app/production/execution/ProductionTaskDetail.tsx', 'plan=plan-1&view=tasks&task=task-1');
  const writes = [];
  const props = { plan, task, userId: 'other', permissions: { canReport: true }, onEdit: value => writes.push(value), onVerify() {} };
  assert.equal(nodes(f.module.ProductionTaskDetail(props)).some(row => row.type === 'Button' && text(row) === '登记报工'), false);
  const mine = f.module.ProductionTaskDetail({ ...props, userId: 'owner' });
  nodes(mine).find(row => row.type === 'Button' && text(row) === '登记报工').props.onClick();
  assert.equal(writes[0].action, 'report'); assert.equal(writes[0].task.id, 'task-1');
});

test('异常详情沿原记录回复与复验，非当前经办没有代回复按钮', () => {
  const quality = { id: 'q1', status: 'open', issue: '尺寸待核对', collaboration: { phase: 'waiting_reply', ownerId: 'rd-1', ownerName: '研发甲' } };
  const selectedTask = { ...task, inspections: [{ id: 'i1', date: '2026-09-20', actorName: '质检甲', quantity: 20, goodQty: 18, verifiedGoodQty: 0, quality }] };
  const f = component('src/app/production/execution/ProductionTaskDetail.tsx', 'plan=plan-1&task=task-1&taskSection=quality&inspection=i1');
  const writes = [], reviews = [];
  const props = { plan, task: selectedTask, userId: 'rd-1', permissions: { canCollaborate: true }, onEdit: value => writes.push(value), onVerify: value => reviews.push(value) };
  const tree = f.module.ProductionTaskDetail(props);
  nodes(tree).find(row => row.type === 'Button' && text(row) === '回复原异常').props.onClick();
  nodes(tree).find(row => row.type === 'Button' && text(row) === '查看验证记录').props.onClick();
  assert.equal(writes[0].quality, quality); assert.equal(reviews[0], quality);
  assert.equal(nodes(f.module.ProductionTaskDetail({ ...props, userId: 'other' })).some(row => row.type === 'Button' && text(row) === '回复原异常'), false);
});

test('检验深链独立展示检验指标与作业上下文，返回保留列表条件且明确回到检验栏目', () => {
  const inspection = { id: 'i1', date: '2026-09-20', actorName: '质检甲', quantity: 20, goodQty: 18, verifiedGoodQty: 1, evidence: '依照当前图纸核对尺寸', quality: null };
  const selectedTask = { ...task, reports: [{ id: 'r1', quantity: 20, goodQty: 18 }], inspections: [inspection] };
  const query = 'month=2026-09&plan=plan-1&view=tasks&task=task-1&taskQ=阀体&taskPage=3&taskSection=reports&inspectionPage=2&inspection=i1';
  const f = component('src/app/production/execution/ProductionTaskDetail.tsx', query);
  const tree = f.module.ProductionTaskDetail({ plan, task: selectedTask, userId: 'owner', permissions: { canPlan: true, canReport: true, canInspect: true, canWarehouse: true }, onEdit() { assert.fail('只读详情不自动提交'); }, onVerify() {} });
  assert.equal(tree.props['aria-label'], '检验记录详情');
  assert.equal(nodes(tree).some(row => row.type === 'Tabs'), false, '独立检验记录不叠加作业栏目');
  const metrics = nodes(tree).filter(row => row.type === 'ProductionMetrics');
  assert.equal(metrics.length, 1);
  assert.deepEqual(metrics[0].props.items.map(item => [item.label, item.value]), [['初检数量', '20 件'], ['首次合格', '18 件'], ['首次合格率', '90.0%'], ['复验认可合格', '1 件']]);
  assert.match(text(tree), /九月首批 · 一线 · 现场甲/);
  assert.match(text(tree), /依照当前图纸核对尺寸/);
  assert.equal(nodes(tree).some(row => row.type === 'Button' && ['确认派工', '登记报工', '登记检验', '调整作业安排', '取消作业', '领料与签收'].includes(text(row))), false);
  const back = nodes(tree).find(row => row.type === 'Link' && text(row) === '返回检验列表');
  const target = new URLSearchParams(back.props.to.slice(1));
  assert.equal(target.has('inspection'), false);
  assert.equal(target.get('taskSection'), 'quality');
  for (const key of ['month', 'plan', 'view', 'task', 'taskQ', 'taskPage', 'inspectionPage']) assert.equal(target.get(key), new URLSearchParams(query).get(key), key);
});

test('检验记录不存在时保留独立空态，不回落到另一记录或作业动作', () => {
  const f = component('src/app/production/execution/ProductionTaskDetail.tsx', 'plan=plan-1&task=task-1&taskSection=materials&inspection=missing&inspectionPage=2');
  const tree = f.module.ProductionTaskDetail({ plan, task, userId: 'owner', permissions: { canPlan: true, canReport: true }, onEdit() {}, onVerify() {} });
  assert.equal(nodes(tree).find(row => row.type === 'ProductionEmpty').props.title, '该检验记录不存在或无权查看');
  assert.equal(nodes(tree).some(row => ['ProductionMetrics', 'Tabs', 'Table'].includes(row.type)), false);
  const back = new URLSearchParams(nodes(tree).find(row => row.type === 'Link').props.to.slice(1));
  assert.equal(back.get('taskSection'), 'quality');
  assert.equal(back.get('inspectionPage'), '2');
  assert.equal(back.get('task'), 'task-1');
  assert.equal(back.has('inspection'), false);
});
