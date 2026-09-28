import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import ts from 'typescript';

const primitive = new Proxy({}, { get: (_, key) => key });
const hasPermission = (permissions, code) => permissions.includes('*') || permissions.includes(code);
const translate = (value, args = {}) => value.replace(/\{(\w+)\}/g, (_, key) => args[key] ?? key);
function load(path, deps) {
  const source = readFileSync(new URL(`../src/app/${path}`, import.meta.url), 'utf8').replaceAll('import.meta.env.DEV', 'false');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  new Function('exports', 'require', code)(exports, key => {
    if (key.includes('/components/ui/') || key.includes('/components/horizon/')) return primitive;
    if (key.endsWith('.css')) return {};
    assert.ok(key in deps, `dependency ${key}`); return deps[key];
  });
  return exports;
}
const riskAccess = load('lib/managementRiskApi.ts', { './routePaths': { routePath: (_, fallback) => fallback }, './purchaseOrderLineNavigation': { buildPurchaseOrderLinePath: () => '' } });
const model = load('dashboard/managementDashboardModel.ts', { '../lib/permissions': { hasPermission }, '../lib/managementRiskApi': riskAccess });
const manager = ['page:production-execution', 'production:view-all'];
const director = ['page:rd-director-dashboard', 'production:plan'];
const riskReaders = ['page:proc-cockpit', 'page:purchase-orders', 'page:purchase-order-detail', 'proc-quality:manage', 'proc-quality:verify'];
const plan = (id, month = '2026-09', completedQty = 5) => ({ id, month, scope: 'all', carryover: month < '2026-09', productId: `product-${id}`, productName: `产品 ${id}`, productLine: 'Q7', targetQty: 10, shipmentTargetQty: 8, batches: [{ id: 'batch-1' }], tasks: [{ output: 'component', unit: '公斤', quantity: 9999 }], summary: { completedQty, remainingQty: 10 - completedQty, batchQty: 10 } });
const oldData = (month = '2026-09') => ({ month, overview: { month, scope: 'all', targetQty: 20, shipmentTargetQty: 16, actualShippedQty: 3 }, plans: [plan('real-plan'), plan('prior', '2026-08')], errors: {}, loadedAt: '2026-09-20T08:00:00Z' });
const data = (month = '2026-09') => ({ ...oldData(month), rd:null, procurement:null, risks:{ scopes:{production:true}, completed:5, remaining:15, firstFinal:{quantity:10,goodQty:8,firstPassRate:80}, products:[], batches:[{id:'B1',planId:'real-plan',batchId:'one',product:'产品1',code:'第一批',current:4,onTime:6,remaining:10,target:10,date:'2026-09-25'},{id:'B2',planId:'real-plan',batchId:'two',product:'产品2',code:'第二批',current:2,onTime:null,remaining:7,target:7,date:null}], risks:Array.from({length:8},(_,i)=>({id:'risk-'+i,kind:'procurement',title:'风险事项'+i,product:'产品1',owner:'采购员',dueDate:'2026-09-20',note:'交期延误',period:'current',batchCodes:[],target:{type:'procurement',taskId:'TASK-'+i}}))} });
const insights=load('dashboard/managementDashboardInsights.ts',{});
function nodes(tree, predicate, output = []) {
  if (!tree || typeof tree !== 'object') return output;
  if (predicate(tree)) output.push(tree);
  React.Children.forEach(tree.props?.children, child => nodes(child, predicate, output));
  for (const key of ['actions', 'trailing', 'meta', 'action']) if (tree.props?.[key]) nodes(tree.props[key], predicate, output);
  return output;
}
function content(tree) {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  if (!tree || typeof tree !== 'object') return '';
  return ['title', 'description', 'value', 'note', 'children'].map(key => React.Children.toArray(tree.props?.[key]).map(content).join(' ')).join(' ');
}
function fixture(initial, reader) {
  let params = new URLSearchParams(initial), cursor = 0, dirty = false;
  const slots = [], effects = [], calls = [];
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; dirty = true; }]; },
    useEffect(effect, deps) { const index = cursor++, previous = slots[index]; if (!previous || deps.some((value, key) => !Object.is(value, previous.deps[key]))) { slots[index] = { deps, cleanup: previous?.cleanup }; effects.push(() => { slots[index].cleanup?.(); slots[index].cleanup = effect(); }); } },
  };
  const { ManagementDashboard } = load('dashboard/ManagementDashboard.tsx', {
    react: hooks, 'react/jsx-runtime': jsxRuntime, 'lucide-react': primitive,
    'react-router': { Link: 'Link', useSearchParams: () => [params, patch => { params = typeof patch === 'function' ? patch(params) : patch; dirty = true; }] },
    '../lib/managementDashboardApi': { fetchManagementDashboard: (...args) => { calls.push(args); return reader(...args); } },
    '../lib/i18n': { useI18n: () => ({ t: translate }), i18nLocale: () => 'zh-CN' },
    '../lib/permissions': { hasPermission }, '../lib/routePaths': { routePath: (_, fallback) => fallback },
    './ManagementRiskPanel': { ManagementRiskPanel: 'ManagementRiskPanel' },
    './managementDashboardModel': model, './managementDashboardInsights':insights, '../lib/managementRiskApi':riskAccess, './ManagementDashboardCharts': { ManagementDashboardCharts:'ManagementDashboardCharts' },
  });
  const view = {
    calls, permissions: manager,
    render() { for (let i = 0; i < 20; i++) { cursor = 0; dirty = false; view.tree = ManagementDashboard({ permissions: view.permissions }); while (effects.length) effects.shift()(); if (!dirty) return view; } assert.fail('render did not settle'); },
    nodes: predicate => nodes(view.tree, predicate),
    find: predicate => nodes(view.tree, predicate)[0],
    navigate(search) { params = new URLSearchParams(search); return view.render(); },
    params: () => new URLSearchParams(params),
    change(label, value) { view.find(node => node.props['aria-label'] === label).props.onChange({ target: { value } }); return view.render(); },
    click(label) { view.find(node => node.type === 'Button' && content(node).trim() === label).props.onClick(); return view.render(); },
    dispose() { slots.forEach(slot => slot?.cleanup?.()); },
  };
  return view;
}
const settle = () => new Promise(resolve => setImmediate(resolve));


test('看板首页只给重点摘要，查看全部进入独立风险明细并保留月份', async () => {
  const view=fixture('home=management&month=2026-09',async()=>data()).render(); await settle(); view.render();
  assert.equal(view.nodes(n=>n.type==='ManagementRiskPanel').length,0,'首页不能嵌入完整风险工作台');
  assert.equal(view.nodes(n=>n.type==='TableRow').length,0,'首页不放完整生产计划/风险表');
  assert.match(content(view.tree),/风险事项0/); assert.doesNotMatch(content(view.tree),/风险事项5/);
  const all=view.find(n=>n.type==='Link'&&content(n).includes('查看全部风险'));
  assert.ok(all); assert.match(all.props.to,/homeSection=risks/); assert.match(all.props.to,/month=2026-09/);
  view.navigate('home=management&month=2026-09&homeSection=risks');
  assert.equal(view.nodes(n=>n.type==='ManagementRiskPanel').length,1);
  const back=view.find(n=>n.type==='Link'&&content(n).includes('返回数据看板'));
  assert.ok(back); assert.doesNotMatch(back.props.to,/homeSection=risks/); view.dispose();
});

test('齐套卡片按所选批次呈现，不把不同产品相加，未知按期值不显示零',async()=>{
  const view=fixture('home=management&month=2026-09',async()=>data()).render(); await settle(); view.render();
  const readinessMetric=view.find(n=>n.type==='HorizonMetric'&&n.props.label==='当前批次可齐套');
  assert.ok(readinessMetric,'应有独立所选批次齐套指标');
  assert.equal(readinessMetric.props.value,'4 套');
  view.change('齐套批次','B2');
  assert.equal(view.find(n=>n.type==='HorizonMetric'&&n.props.label==='当前批次可齐套').props.value,'2 套');
  assert.match(content(view.tree),/待核对/);
  assert.ok(view.nodes(n=>n.type==='Link').some(n=>String(n.props.to).includes('readinessBatch=two'))); view.dispose();
});

test('月份切换清除旧数值，迟到结果不能覆盖新月份；单来源失败有重试',async()=>{
  let resolveOld,attempt=0; const old=new Promise(resolve=>{resolveOld=resolve;});
  const view=fixture('home=management&month=2026-08',async month=>month==='2026-08'?old:(++attempt===1?{...data(),overview:null,plans:null,risks:null,errors:{overview:'指标未连接'}}:data())).render();
  view.change('管理总览月份','2026-09'); await settle(); view.render();
  const completedMetric=view.find(n=>n.type==='HorizonMetric'&&n.props.label==='本月合格完成');
  assert.ok(completedMetric,'月度合格完成应为独立指标');
  assert.equal(completedMetric.props.value,'待核对');
  assert.ok(view.find(n=>n.props.role==='alert'));
  view.click('重新加载'); await settle(); view.render();
  assert.equal(view.find(n=>n.type==='HorizonMetric'&&n.props.label==='本月合格完成').props.value,'5 台');
  resolveOld({...data('2026-08'),risks:{...data().risks,completed:888}}); await settle(); view.render();
  assert.equal(view.find(n=>n.type==='HorizonMetric'&&n.props.label==='本月合格完成').props.value,'5 台');
  assert.equal(view.calls[0][2].aborted,true); view.dispose();
});

test('撤去生产权限立即隐藏生产指标和入口，旧响应无法带回数据',async()=>{
  let resolve; const pending=new Promise(done=>{resolve=done;});
  const view=fixture('home=management',async(_month,permissions)=>permissions.includes('production:view-all')?pending:{...data(),overview:null,plans:null,risks:{...data().risks,scopes:{production:false},completed:null,remaining:null,firstFinal:null,batches:[]}}).render();
  view.permissions=['proc-quality:verify']; view.render(); resolve(data()); await settle(); view.render();
  assert.equal(view.nodes(n=>n.type==='HorizonMetric'&&n.props.label==='本月合格完成').length,0);
  assert.equal(view.nodes(n=>n.type==='Link'&&String(n.props.to).startsWith('/production-execution')).length,0);
  assert.equal(view.calls[0][2].aborted,true);
  view.permissions=['page:dashboard']; view.render(); assert.equal(view.tree,null); view.dispose();
});

test('全局看板风险入口清除旧产品筛选，未授权的工程变更不能显示为零',async()=>{
  const payload={...data(),rd:{total:5,inProgress:3,completed:2,blocked:0,scope:'participating'},overview:null,plans:null,risks:{...data().risks,scopes:{production:false},batches:[]}};
  const view=fixture('home=management&month=2026-09&riskProduct=old-product',async()=>payload);
  view.permissions=['page:rd-my-workspace','page:proc-cockpit']; view.render(); await settle(); view.render();
  const ecn=view.find(n=>n.type==='div'&&n.props.className==='md-domain-foot'&&content(n).includes('工程变更待处理'));
  assert.ok(ecn); assert.doesNotMatch(content(ecn),/0 项/);
  const all=view.find(n=>n.type==='Link'&&content(n).includes('查看全部风险'));
  assert.doesNotMatch(all.props.to,/riskProduct=/);
  view.navigate('home=management&month=2026-09&homeSection=risks&riskProduct=old-product');
  assert.doesNotMatch(view.find(n=>n.type==='Link'&&content(n).includes('返回数据看板')).props.to,/riskProduct=/); view.dispose();
});

test('未来月份尚无实际日期点，不展示首次合格零值摘要',()=>{
  const {ManagementDashboardCharts}=load('dashboard/ManagementDashboardCharts.tsx',{'react/jsx-runtime':jsxRuntime,'lucide-react':primitive,recharts:primitive,'../lib/i18n':{useI18n:()=>({t:translate})}});
  const tree=ManagementDashboardCharts({insights:{trend:[{date:'2099-01-01',label:'01-01',plannedQty:2,actualGoodQty:null}],actualAvailable:true,riskCounts:null},showProduction:true,showRisks:false,loading:false});
  assert.doesNotMatch(content(tree),/截至当前首次合格/);
  assert.match(content(tree),/所选月份尚未开始/);
  assert.ok(nodes(tree,n=>n.props.role==='img').every(n=>!n.props['aria-label'].includes('首次终检合格 0')));
});
