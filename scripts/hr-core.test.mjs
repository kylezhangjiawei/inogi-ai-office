import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const file = new URL('../src/app/hr/hrLogic.ts', import.meta.url);
const module = { exports: {} };
if (existsSync(file)) {
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('module', 'exports', code)(module, module.exports);
}
const api = module.exports;
const record = (fields = {}, extra = {}) => ({ id: 'TEST-1', title: '测试记录', dept: '研发注册部', owner: '林序', date: '2026-10-16', status: '草稿', detail: '', history: [], fields, ...extra });
const fn = name => { assert.equal(typeof api[name], 'function', `缺少业务规则 ${name}`); return api[name]; };

test('每天循环推进一天，月末按原始日期继续，并保留任务持续时间', () => {
  const next = fn('nextRecurringTask');
  const daily = next(record({ '循环周期': '每天', '开始日期': '2026-10-14' }));
  assert.equal(daily.date, '2026-10-17');
  assert.equal(daily.fields['开始日期'], '2026-10-15');
  const feb = next(record({ '循环周期': '每月', '开始日期': '2026-01-30' }, { date: '2026-01-31' }));
  assert.equal(feb.date, '2026-02-28');
  assert.equal(next(record(feb.fields, { date: feb.date })).date, '2026-03-31');
  assert.throws(() => next(record({ '循环周期': '随便' })), /循环周期/);
});

test('业务输入拒绝负工资、负出勤、重复资产编码和部门循环引用', () => {
  const validate = fn('validateHrRecord');
  assert.match(validate('offer', record({ '拟录用岗位': '工程师', '试用期月薪': '-100', '标准月薪': '100', '每周工作天数': '5' }), {}), /试用期月薪/);
  assert.match(validate('attendance', record({ '实际出勤天数': '-3' }), {}), /实际出勤天数/);
  assert.match(validate('asset', record({ '资产编码': 'IT-001', '资产类型': '电脑', '存放位置': '库房' }), { asset: [record({ '资产编码': 'IT-001' }, { id: 'OTHER' })] }), /重复/);
  const a = record({ '上级部门': '质量部', '公司主体': '公司', '部门定位': '研发', '核心职能': '设计' }, { title: '研发注册部' });
  const b = record({ '上级部门': '研发注册部' }, { id: 'D2', title: '质量部' });
  assert.match(validate('org', a, { org: [a, b] }), /循环/);
});

test('批准后关键字段变更撤销批准；普通附件记录不误撤销；隐藏字段不丢失', () => {
  const prepare = fn('prepareHrUpdate');
  const original = record({ '标准月薪': '10000', '人员编号': 'E-001', '审批版本': '1' }, { status: '已批准' });
  const changed = prepare('offer', original, { fields: { '标准月薪': '12000' } }, '编辑');
  assert.equal(changed.status, '草稿');
  assert.equal(changed.fields['审批版本'], '2');
  assert.equal(changed.fields['人员编号'], 'E-001');
  assert.ok(changed.history.some(v => v.includes('重新审批')));
  assert.equal(prepare('offer', original, { fields: { '本次材料': '附件.pdf' } }, '选择附件').status, '已批准');
});

test('员工审批可见范围使用稳定人员编号，不依赖记录标题', () => {
  const scope = fn('scopeHrRows');
  const rows = [record({ '申请人编号': 'E-001' }, { title: '十月请假申请' }), record({ '抄送人员编号': 'E-001,E-002' }, { id: 'R2', title: '培训审批' }), record({ '申请人编号': 'E-002' }, { id: 'R3' })];
  assert.deepEqual(scope('approval', rows, '员工本人', 'E-001', '研发注册部').map(r => r.id), ['TEST-1', 'R2']);
  assert.deepEqual(scope('archive', [record({ '人员编号': 'E-002' }), record({ '人员编号': 'E-001' }, { id: 'E-001', title: '更名员工' })], '员工本人', 'E-001', '研发注册部').map(r => r.id), ['E-001']);
});

test('离职状态修改进入待回收，已注销账号保持注销', () => {
  const prepare = fn('prepareHrUpdate');
  const active = record({ '入离职状态': '在职' }, { status: '使用中' });
  assert.equal(prepare('account', active, { fields: { '入离职状态': '已离职' } }, '离职登记').status, '待回收');
  assert.equal(prepare('account', { ...active, status: '已注销' }, { fields: { '入离职状态': '已离职' } }, '离职登记').status, '已注销');
});

test('手工档案编号必填唯一且已关联编号不可更改；组织改名不能绕过环校验', () => {
 const validate=fn('validateHrRecord');
 const existing=record({'人员编号':'E-001'},{id:'ARCHIVE-001'});
 assert.match(validate('archive',record(),{archive:[existing]}),/人员编号/);
 assert.match(validate('archive',record({'人员编号':'E-001'}),{archive:[existing]}),/重复/);
 assert.match(validate('archive',{...existing,fields:{'人员编号':'E-003'}},{archive:[existing]}),/不可/);
 const old=record({'上级部门':'总经办','公司主体':'公司','部门定位':'研发','核心职能':'设计'},{id:'A',title:'研发'});
 const child=record({'上级部门':'研发'},{id:'B',title:'质量'});
 assert.match(validate('org',{...old,title:'新研发',fields:{...old.fields,'上级部门':'质量'}},{org:[old,child]}),/循环/);
});

test('新增候选人按全局占用情况分配人员和候选人编号，本人可见',()=>{
 const source=record({}, {id:''}); const {id,history,...newRow}=source;
 const prepared=fn('prepareHrNewRecord')('collect',newRow,{archive:[record({'人员编号':'E-005'})],resume:[record({'候选人编号':'C-008'})],collect:[]});
 assert.equal(prepared.fields['人员编号'],'E-006');assert.equal(prepared.fields['候选人编号'],'C-009');
 assert.equal(fn('scopeHrRows')('collect',[{...prepared,id:'COLLECT-new',history:[]}],'员工本人','E-006','研发注册部').length,1);
});

test('账号编辑与开通同样校验必填、有效标识唯一及人员关联', () => {
  const validate = fn('validateHrRecord');
  const a = record({ '账号系统':'INOGI', '账号标识':'employee.a', '人员编号':'E-001' }, {id:'AC-1',status:'使用中'});
  const b = record({ '账号系统':'INOGI', '账号标识':'employee.b', '人员编号':'E-001' }, {id:'AC-2',status:'待开通确认'});
  const all = {account:[a,b],archive:[record({'人员编号':'E-001'},{id:'E-001'})]};
  assert.match(validate('account',{...b,fields:{...b.fields,'账号标识':' employee.a '}},all),/重复|已有/);
  assert.match(validate('account',{...b,fields:{...b.fields,'账号系统':''}},all),/账号系统/);
  assert.match(validate('account',{...b,fields:{...b.fields,'人员编号':'UNKNOWN'}},all),/人员/);
  assert.equal(validate('account',b,all),null);
  assert.equal(validate('account',{...b,fields:{...b.fields,'账号标识':a.fields['账号标识']}},{...all,account:[{...a,status:'已注销'},b]}),null);
});

test('已确认应聘资料变更必须重新核对，未变更保存不撤销确认', () => {
  const original = record({'联系电话':'13800000001','扫描材料':'a.pdf','核对标记':'已核对'},{status:'已确认'});
  const prepare = fn('prepareHrUpdate');
  assert.equal(prepare('apply',original,{fields:{'联系电话':'13800000002'}}).status,'待核对');
  assert.equal(prepare('apply',original,{title:'修订名称'}).status,'待核对');
  assert.equal(prepare('apply',original,{fields:{'扫描材料':'b.pdf'}}).status,'待核对');
  assert.equal(prepare('apply',original,{fields:{...original.fields}}).status,'已确认');
});

test('组织改名保留稳定岗位课程标识并级联课程适用部门', () => {
  const org = record({'上级部门':'总经办'},{id:'D1',title:'研发注册部'});
  const prepare = fn('prepareHrUpdate');
  const next = prepare('org',org,{title:'研发技术部'});
  assert.equal(next.fields['岗位课程标识'],'研发注册部');
  assert.equal(prepare('org',next,{title:'研发中心'}).fields['岗位课程标识'],'研发注册部');
  const learning = record({'适用部门':'研发注册部','课程编号':'JOB-研发注册部-1','人员编号':'E-001'},{status:'已通过'});
  const all={org:[next,record({'上级部门':'研发注册部'},{id:'D2',title:'测试组'})],archive:[record({'人员编号':'E-001'})],learning:[learning]};
  const changed=fn('renameHrDepartment')(all,'研发注册部','研发技术部');
  assert.equal(changed.archive[0].dept,'研发技术部');
  assert.equal(changed.org[1].fields['上级部门'],'研发技术部');
  assert.equal(changed.learning[0].fields['适用部门'],'研发技术部');
  assert.equal(changed.learning[0].fields['课程编号'],'JOB-研发注册部-1');
  assert.equal(changed.learning[0].status,'已通过');
  assert.equal(all.archive[0].dept,'研发注册部','original state must not be mutated');
});

test('会议预约改期清空原使用状态并保留历史，普通资料编辑不清空', () => {
  const row = record({'会议室':'大会议室','开始时间':'13:00','结束时间':'14:00','使用开始':'2026-10-16T13:00','使用结束':'2026-10-16T13:45'},{status:'已预约'});
  const prepare = fn('prepareHrUpdate');
  const next = prepare('room',row,{date:'2026-10-17'});
  assert.equal(next.fields['使用开始'],'');
  assert.equal(next.fields['使用结束'],'');
  assert.ok(next.history.some(entry => entry.includes('2026-10-16T13:00') && entry.includes('重新登记')));
  assert.equal(prepare('room',row,{title:'更新议题'}).fields['使用结束'],'2026-10-16T13:45');
});

test('候选人编号不能跨人员复用，已关联的候选人编号不可随意变更', () => {
  const validate=fn('validateHrRecord');
  const existing=record({'人员编号':'E-003','候选人编号':'C-001'},{id:'COL-1'});
  const other=record({'人员编号':'E-099','候选人编号':'C-001'});
  assert.match(validate('collect',other,{collect:[existing]}),/候选人/);
  assert.match(validate('collect',record({'候选人编号':'C-001'}),{collect:[],resume:[existing]}),/候选人/);
  assert.match(validate('collect',{...existing,fields:{...existing.fields,'候选人编号':'C-999'}},{collect:[existing]}),/候选人/);
  assert.equal(validate('collect',record({'人员编号':'E-003','候选人编号':'C-001'}),{collect:[],resume:[existing]}),null);
});
