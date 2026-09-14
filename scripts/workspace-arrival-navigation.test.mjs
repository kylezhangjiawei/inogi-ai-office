import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function helper(path = '/proc-my-workspace') {
  const source = readFileSync(new URL('../src/app/lib/workspaceArrivalNavigation.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  new Function('exports', 'require', code)(exports, (name) => {
    assert.equal(name, './routePaths');
    return { routePath: (permission) => { assert.equal(permission, 'page:proc-my-workspace'); return path; } };
  });
  return exports;
}
const source = 'month=2026-09&period=carryover&product=product-A&supplier=%E7%94%B2%E4%BE%9B%E5%BA%94%E5%95%86&status=in_transit&q=PO%2F%252F%3F%E7%94%B2&focus=overdue&sort=date&task=old&page=1&arrivals=open&arrivalPage=1&arrivalFocus=old';
const target = '/proc-my-workspace?task=task-1&arrivals=open&arrivalFocus=line-1';

test('到货订单返回保留全部工作台筛选，只替换目标任务、任务页和到货位置', () => {
  const params = new URLSearchParams(source);
  const before = params.toString();
  const result = helper().buildWorkspaceArrivalReturnPath(params, { taskId: 'task/2?x=1', rowKey: 'line:["PO/%2F","02"]', taskPage: 3, arrivalPage: 2 });
  const actual = new URLSearchParams(result.split('?')[1]);
  for (const key of ['month', 'period', 'product', 'supplier', 'status', 'q', 'focus', 'sort']) assert.equal(actual.get(key), params.get(key), key);
  assert.equal(actual.get('task'), 'task/2?x=1'); assert.equal(actual.get('page'), '3');
  assert.equal(actual.get('arrivals'), 'open'); assert.equal(actual.get('arrivalPage'), '2');
  assert.equal(actual.get('arrivalFocus'), 'line:["PO/%2F","02"]');
  assert.equal(params.toString(), before, '原筛选不能原地变更');
  assert.equal(helper().workspaceArrivalReturnPath({ workspaceArrivalReturnTo: result }), result);
});

test('返回只信任当前配置工作台路径，旧路径与其他采购页不互换', () => {
  const custom = helper('/supply/my-work');
  const result = custom.buildWorkspaceArrivalReturnPath(new URLSearchParams(source), { taskId: 'A', rowKey: 'line:1', taskPage: 1, arrivalPage: 1 });
  assert.ok(result.startsWith('/supply/my-work?'));
  assert.equal(custom.workspaceArrivalReturnPath({ workspaceArrivalReturnTo: result }), result);
  assert.equal(custom.workspaceArrivalReturnPath({ workspaceArrivalReturnTo: target }), null);
  assert.equal(helper().workspaceArrivalReturnPath({ workspaceArrivalReturnTo: result }), null);
});

test('外部、片段、控制字符、反斜杠、多问号和非对象来源拒绝', () => {
  const { workspaceArrivalReturnPath: read } = helper();
  for (const state of [null, undefined, [], target, true, { workspaceArrivalReturnTo: 1 }]) assert.equal(read(state), null);
  for (const value of [
    'https://outside.invalid' + target, '//outside.invalid' + target, target + '#fragment',
    target + '?other', target + '\\x', target + '\u0000', target + '%00', target + '%5C',
    '/proc-cockpit?task=A&arrivals=open&arrivalFocus=R', '/proc-my-workspace/?task=A&arrivals=open&arrivalFocus=R',
    target + '&q=' + 'x'.repeat(1025), target + '&q=' + 'x'.repeat(8193),
  ]) assert.equal(read({ workspaceArrivalReturnTo: value }), null, value.slice(0, 120));
});

test('到货返回必须具备任务、展开态和行位置，不接受重复参数和写表单触发', () => {
  const read = helper().workspaceArrivalReturnPath;
  for (const value of [
    '/proc-my-workspace', '/proc-my-workspace?arrivals=open&arrivalFocus=R',
    '/proc-my-workspace?task=A&arrivalFocus=R', '/proc-my-workspace?task=A&arrivals=closed&arrivalFocus=R',
    '/proc-my-workspace?task=A&arrivals=open', '/proc-my-workspace?task=&arrivals=open&arrivalFocus=R',
    target + '&task=B', target + '&task=task-1', target + '&arrivals=open', target + '&q=A&q=A',
    target + '&newPlan=1', target + '&create=1', target + '&redirect=/other',
  ]) assert.equal(read({ workspaceArrivalReturnTo: value }), null, value);
});

test('任务与到货页只接受安全正整数，建链时拒绝不可用页码或空定位', () => {
  const h = helper();
  for (const key of ['page', 'arrivalPage']) for (const value of ['0', '-1', '1.5', 'Infinity', 'NaN', '1e2', '9007199254740992', '01', '']) {
    assert.equal(h.workspaceArrivalReturnPath({ workspaceArrivalReturnTo: target + `&${key}=${value}` }), null, `${key}=${value}`);
  }
  for (const input of [
    { taskId: '', rowKey: 'R', taskPage: 1, arrivalPage: 1 },
    { taskId: 'A', rowKey: '', taskPage: 1, arrivalPage: 1 },
    { taskId: 'A', rowKey: 'R', taskPage: 0, arrivalPage: 1 },
    { taskId: 'A', rowKey: 'R', taskPage: 1, arrivalPage: Number.NaN },
  ]) assert.equal(h.buildWorkspaceArrivalReturnPath(new URLSearchParams(), input), null);
});

test('建链丢弃未知来源参数，标识符中的斜杠百分号与中文只编码一次', () => {
  const h = helper();
  const result = h.buildWorkspaceArrivalReturnPath(new URLSearchParams('q=%252F&newPlan=1&redirect=https%3A%2F%2Fevil.invalid'), { taskId: 'A/%2F甲', rowKey: 'line:%2F/甲', taskPage: 1, arrivalPage: 1 });
  assert.equal(h.workspaceArrivalReturnPath({ workspaceArrivalReturnTo: result }), result);
  const parsed = new URLSearchParams(result.split('?')[1]);
  assert.equal(parsed.get('q'), '%2F'); assert.equal(parsed.get('task'), 'A/%2F甲'); assert.equal(parsed.get('arrivalFocus'), 'line:%2F/甲');
  assert.equal(parsed.has('newPlan'), false); assert.equal(parsed.has('redirect'), false);
});

test('四种任务来源经过订单行往返完整保留，省略默认来源时不额外写入', () => {
  const h = helper('/supply/my-work');
  for (const value of [null, 'purchase', 'sample', 'stock', 'arrival']) {
    const params = new URLSearchParams(source);
    if (value !== null) params.set('source', value);
    const before = params.toString();
    const result = h.buildWorkspaceArrivalReturnPath(params, { taskId: 'task/原单', rowKey: 'line:%2F/02', taskPage: 3, arrivalPage: 2 });
    assert.ok(result, String(value));
    assert.equal(h.workspaceArrivalReturnPath({ workspaceArrivalReturnTo: result }), result);
    const restored = new URLSearchParams(result.split('?')[1]);
    assert.equal(restored.get('source'), value);
    for (const key of ['month', 'period', 'product', 'supplier', 'status', 'q', 'focus', 'sort']) assert.equal(restored.get(key), params.get(key));
    assert.equal(restored.get('task'), 'task/原单'); assert.equal(restored.get('arrivalFocus'), 'line:%2F/02');
    assert.equal(params.toString(), before);
  }
});

test('读取和建链均拒绝非法或重复来源，不以最后一个值替代', () => {
  const h = helper();
  for (const suffix of [
    'source=', 'source=all', 'source=Stock', 'source=stock%20', 'source=%20sample', 'source=purchase%2Fsample',
    'source=stock&source=stock', 'source=sample&source=arrival', 'source=invalid&source=purchase',
    'source=arrival&%73ource=stock',
  ]) {
    assert.equal(h.workspaceArrivalReturnPath({ workspaceArrivalReturnTo: `${target}&${suffix}` }), null, suffix);
    assert.equal(h.buildWorkspaceArrivalReturnPath(new URLSearchParams(`${source}&${suffix}`), { taskId: 'A', rowKey: 'R', taskPage: 1, arrivalPage: 1 }), null, suffix);
  }
});


test('日历日期与独立月份随订单行往返保留，严格拒绝无效日期和重复视图', () => {
  const h=helper();
  for (const day of ['all','undated','outside','2026-10-02']) {
    const params=new URLSearchParams(source+'&source=arrival&arrivalView=calendar&arrivalMonth=2026-10&arrivalDay='+day);
    const result=h.buildWorkspaceArrivalReturnPath(params,{taskId:'A',rowKey:'R',taskPage:2,arrivalPage:3});
    assert.ok(result); assert.equal(h.workspaceArrivalReturnPath({workspaceArrivalReturnTo:result}),result);
    assert.deepEqual(h.parseWorkspaceArrivalView(new URLSearchParams(result.split('?')[1]),'2026-09'),{view:'calendar',month:'2026-10',selection:day});
  }
  for (const suffix of ['arrivalView=week','arrivalView=calendar&arrivalView=list','arrivalMonth=0000-09','arrivalMonth=2026-13','arrivalMonth=2026-09&arrivalMonth=2026-09','arrivalDay=2026-02-30','arrivalDay=all&arrivalDay=all','arrivalMonth=2026-10&arrivalDay=2026-09-02']) {
    const params=new URLSearchParams(source+'&'+suffix);
    assert.equal(h.buildWorkspaceArrivalReturnPath(params,{taskId:'A',rowKey:'R',taskPage:1,arrivalPage:1}),null,suffix);
    assert.equal(h.workspaceArrivalReturnPath({workspaceArrivalReturnTo:target+'&'+suffix}),null,suffix);
    assert.deepEqual(h.parseWorkspaceArrivalView(params,'2026-09'),{view:'list',month:'2026-09',selection:'all'},suffix);
  }
  assert.deepEqual(h.parseWorkspaceArrivalView(new URLSearchParams('month=2026-09&arrivalView=calendar&arrivalDay=2026-09-18'),'2026-09'),{view:'calendar',month:'2026-09',selection:'2026-09-18'});
});
