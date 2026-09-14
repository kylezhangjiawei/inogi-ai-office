import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
const base = fileURLToPath(new URL('../src/app/production/', import.meta.url));
const cache = new Map();
function load(file) {
  const path = resolve(base, file); if (cache.has(path)) return cache.get(path);
  const exports = {}; cache.set(path, exports);
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const forbidden = () => { throw new Error('汇总不得调用真实接口或持久化'); };
  new Function('exports','require','fetch','localStorage','sessionStorage', code)(exports,(name)=>load(resolve(dirname(path),`${name}.ts`)),forbidden,new Proxy({}, {get:forbidden,set:forbidden}),new Proxy({}, {get:forbidden,set:forbidden}));
  return exports;
}
const model = load('overview/overviewModel.ts');
const sourceApi = load('overview/overviewSources.ts');
const filters = (patch={}) => ({month:'2026-09',scope:'all',line:'all',owner:'all',kind:'all',status:'all',query:'',...patch});
const today = '2026-09-14';
const sources=()=>structuredClone(sourceApi.readOverviewSources());
test('原业务生成唯一汇总，研发沿用不良key，不创建第二份任务',()=>{
  const source=sources(),before=structuredClone(source);const rows=model.aggregateProductionTasks(source);
  assert.equal(new Set(rows.map(row=>row.key)).size,rows.length);
  assert.equal(rows.filter(row=>row.kind==='defect').length,source.defects.issues.length);
  assert.ok(rows.some(row=>row.kind==='transfer'));assert.deepEqual(source,before);
  source.defects.issues.find(row=>row.id==='issue-process').direction='rd';
  source.defectWorkflows={'issue-process':{owner:'B线验证人',node:'现场验证中',href:'/__preview/production-rd?issue=issue-process',summary:'等待验证'}};
  const projected=model.aggregateProductionTasks(source).filter(row=>row.key==='defect:issue-process');
  assert.equal(projected.length,1);assert.equal(projected[0].owner,'B线验证人');assert.equal(projected[0].status,'open');assert.equal(projected[0].code,'NC-PRO-0911-003');
});
test('整机完工216台只来自完工原单，工序报工与复验不累加',()=>{
  const source=sources();const before=model.monthlyOverview(source,'2026-09');assert.equal(before.completed,216);assert.equal(before.target,1200);assert.equal(before.remaining,984);
  source.planning.tasks.forEach(row=>{row.reported+=1000;row.qualified+=1000;});
  source.inspections.records.push({id:'extra',kind:'reinspection',taskId:'task-final',date:today,quantity:100,good:100,bad:0});
  const after=model.monthlyOverview(source,'2026-09');assert.equal(after.completed,216);assert.equal(after.firstPassRate,before.firstPassRate);
});
test('终检初检按记录日期和台统计，过程检与复验不污染比率',()=>{
  const source=sources();source.inspections.tasks=[{id:'f',stage:'final',unit:'台'},{id:'p',stage:'process',unit:'件'},{id:'x',stage:'final',unit:'件'}];
  source.inspections.records=[{taskId:'f',kind:'initial',date:today,quantity:50,good:47},{taskId:'f',kind:'reinspection',date:today,quantity:3,good:3},{taskId:'p',kind:'initial',date:today,quantity:100,good:0},{taskId:'x',kind:'initial',date:today,quantity:100,good:0},{taskId:'f',kind:'initial',date:'2026-08-31',quantity:10,good:0}];
  assert.equal(model.monthlyOverview(source,'2026-09').firstPassRate,94);assert.equal(model.monthlyOverview(source,'2027-01').firstPassRate,null);
});
test('跨月未完不受已完成/类型/人员/搜索筛选隐藏，并严格按授权范围',()=>{
  const rows=model.aggregateProductionTasks(sources());const result=model.selectProductionTasks(rows,filters({status:'done',kind:'inspection',owner:'不存在',query:'不存在'}),today);
  assert.equal(result.selected.length,0);assert.ok(result.carry.some(row=>row.code==='TASK-0831-030'));
  assert.equal(model.selectProductionTasks(rows,filters({scope:'line-a'}),today).carry.some(row=>row.code==='TASK-0831-030'),false);
});
test('切回历史月份仍提示月份外已逾期原单，未来尚未到期不加入',()=>{
  const rows=model.aggregateProductionTasks(sources());const result=model.selectProductionTasks(rows,filters({month:'2026-08'}),today);
  assert.ok(result.carry.some(row=>row.code==='TASK-0911-001'));assert.equal(result.carry.some(row=>row.code==='TASK-1003-003'),false);
});
test('未配置检验期限不推定逾期，关闭原单不列为风险',()=>{
  const rows=model.aggregateProductionTasks(sources());for(const row of rows.filter(row=>row.kind==='inspection')){assert.equal(row.dueDate,null);assert.equal(model.isOverdue(row,today),false);}
  assert.equal(model.isOverdue({status:'done',dueDate:'2026-01-01'},today),false);
});
test('跨单位与未分线事实保留，不推定产线，转产原单路由准确',()=>{
  const rows=model.aggregateProductionTasks(sources());assert.ok(rows.filter(row=>row.kind==='inspection').every(row=>row.lineId===null));
  const transfer=rows.find(row=>row.kind==='transfer');assert.match(transfer.href,/production-transfer\?transfer=transfer-/);
  const historical=rows.find(row=>row.code==='TASK-0831-030');assert.match(historical.href,/month=2026-08&batch=batch-carry&task=task-carry/);
});
test('未知月份不崩溃无数据，月份步进跨年正确',()=>{
  assert.equal(model.monthlyOverview(sources(),'2027-01').completed,0);assert.equal(model.shiftMonth('2026-12',1),'2027-01');assert.equal(model.shiftMonth('2026-01',-1),'2025-12');assert.throws(()=>model.monthlyOverview(sources(),'2026-13'));
});
test('人员确认校验日期、人数、依据和写权限；0人数是真实确认',()=>{
  const draft={date:today,lineId:'line-a',workers:0,qc:0,basis:'班前核对无在岗人员'};
  assert.equal(model.saveStaffing([],draft,'manager',today)[0].workers,0);
  for(const patch of [{date:'2026-02-30'},{date:'2026-09-15'},{workers:-1},{workers:1.5},{qc:201},{workers:NaN},{basis:' '},{lineId:'fake'}])assert.throws(()=>model.saveStaffing([],{...draft,...patch},'manager',today));
  assert.throws(()=>model.saveStaffing([],draft,'viewer',today));
});
test('更正人数保留历史，最新记录不重复累计，不覆盖其他日期产线',()=>{
  const a={date:today,lineId:'line-a',workers:12,qc:2,basis:'班前确认'};
  let records=model.saveStaffing([],a,'factory',today);const before=structuredClone(records);records=model.saveStaffing(records,{...a,workers:14,basis:'补充到岗两人'},'factory',today);
  assert.equal(records.length,2);assert.deepEqual(records[0],before[0]);assert.equal(model.latestStaffing(records,today,'all')[0].workers,14);
  assert.equal(model.latestStaffing(records,'2026-09-13','all').length,0);assert.equal(model.latestStaffing(records,today,'line-b').length,0);
});

test('NCR-0907-02 已有完整 QC 合格回执时投影质量关闭待办，不改原责任人',()=>{
  const session=load('defects/defectPreviewSession.ts'),before=structuredClone(session.getDefectPreviewState());
  const source=sourceApi.readOverviewSources(),row=model.aggregateProductionTasks(source).find(item=>item.key==='defect:issue-verified');
  assert.equal(row.owner,'质量管理岗');assert.equal(row.node,'QC 复验通过，待质量关闭');assert.equal(row.status,'open');
  assert.equal(row.href,'/__preview/production-defects?issue=issue-verified');assert.match(row.summary,/6 台 QC 合格回执/);
  assert.equal(source.defects.issues.find(item=>item.id==='issue-verified').ownerId,'line-a');assert.deepEqual(session.getDefectPreviewState(),before);
});
test('复验仍有不良、凭据缺失、来源重复或缺质量岗位时不误投影待关闭',()=>{
  const session=load('defects/defectPreviewSession.ts'),original=session.getDefectPreviewState();
  const patches=[state=>{const receipt=state.receipts.find(row=>row.issueId==='issue-verified');receipt.good=5;receipt.bad=1;},state=>{state.receipts.find(row=>row.issueId==='issue-verified').evidence='';},state=>{state.receipts.push({...state.receipts.find(row=>row.issueId==='issue-verified')});},state=>{state.actors=state.actors.filter(actor=>actor.role!=='quality');},state=>{state.issues.find(row=>row.id==='issue-verified').closedAt='2026-09-14T04:00:00Z';}];
  try{for(const patch of patches){const state=structuredClone(original);patch(state);session.setDefectPreviewState(state);const source=sourceApi.readOverviewSources();assert.equal(source.defectWorkflows['issue-verified'],undefined);assert.notEqual(model.aggregateProductionTasks(source).find(row=>row.key==='defect:issue-verified').node,'QC 复验通过，待质量关闭');assert.deepEqual(session.getDefectPreviewState(),state);}}finally{session.setDefectPreviewState(original);}
});
test('质量关闭条件满足也不覆盖仍活动的研发协同，仅技术流程关闭后回到 P08',()=>{
  const session=load('defects/defectPreviewSession.ts'),rdSession=load('rd-collaboration/rdPreviewSession.ts'),original=session.getDefectPreviewState(),originalRd=rdSession.getRdPreviewState();
  const state=structuredClone(original),issue=state.issues.find(row=>row.id==='issue-verified');issue.direction='rd';issue.ownerId='rd-a';
  state.collaborations.push({id:'rd-verified-source',code:'RD-VERIFIED',issueId:issue.id,direction:'rd',ownerId:'rd-a',description:'仍需技术协同关闭',actorId:'line-a',at:'2026-09-14T01:00:00Z'});
  try{session.setDefectPreviewState(state);for(const status of ['processing','verified','closed']){rdSession.setRdPreviewState({version:1,cases:[{issueId:issue.id,collaborationId:'rd-verified-source',status,opinions:[],verifications:[],events:[]}]});const row=model.aggregateProductionTasks(sourceApi.readOverviewSources()).find(item=>item.key==='defect:issue-verified');if(status==='closed'){assert.equal(row.owner,'质量管理岗');assert.equal(row.node,'QC 复验通过，待质量关闭');assert.match(row.href,/production-defects/);}else{assert.equal(row.owner,status==='verified'?'A 线负责人':'研发协同岗');assert.equal(row.node,status==='verified'?'验证通过待关闭':'研发处理中');assert.match(row.href,/production-rd/);}assert.equal(session.getDefectPreviewState().issues.find(item=>item.id===issue.id).ownerId,'rd-a');}}finally{session.setDefectPreviewState(original);rdSession.setRdPreviewState(originalRd);}
});
