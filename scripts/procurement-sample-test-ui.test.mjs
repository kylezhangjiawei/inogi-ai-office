import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import ts from 'typescript';

const modules = Object.fromEntries(['SampleTestAssignmentDialog', 'ProcSampleTestDialog'].map((name) => [name,
  ts.transpileModule(readFileSync(new URL(`../src/app/procurement/components/${name}.tsx`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText,
]));
const validationModel = {};
new Function('exports', ts.transpileModule(readFileSync(new URL('../src/app/procurement/samples/sampleValidationModel.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(validationModel);
const explorationValidation = { kind: 'exploration', checks: ['drawing', 'sip', 'sop', 'fixture', 'trial'].map(key => ({ key, applicability: 'not_applicable', reason: '内部探索，无转产适用要求' })) };
const sampleFacts = {};
new Function('exports', ts.transpileModule(readFileSync(new URL('../src/app/lib/procSampleFacts.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(sampleFacts);
const timingModel = {};
new Function('exports', 'require', ts.transpileModule(readFileSync(new URL('../src/app/procurement/samples/sampleTimingModel.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(timingModel, () => sampleFacts);
const recordsModel = {};
new Function('exports', ts.transpileModule(readFileSync(new URL('../src/app/procurement/samples/sampleRecordsModel.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(recordsModel);

test('分派必须明确登记实际到样；取消、Esc与遮罩统一确认未保存修改', async () => {
  const f = await ready('SampleTestAssignmentDialog', { task });
  change(f, 'sample-test-arrival', ''); submit(f); await settle(); assert.match(alerts(f), /实际到样时间/); assert.equal(f.calls.assigned.length, 0);
  change(f, 'sample-test-arrival', '2026-09-08T02:00:00');
  let prevented = 0, originalPrevented = 0;
  find(f.render(), (node) => node.type === 'DialogContent').props.onPointerDownOutside({ preventDefault() { prevented++; }, detail: { originalEvent: { preventDefault() { originalPrevented++; } } } });
  assert.equal(prevented, 1); assert.equal(originalPrevented, 1); assert.equal(find(f.render(), (node) => node.type === 'AlertDialog').props.open, true);
  assert.equal(f.calls.closed.length, 0);
  find(f.render(), (node) => node.type === 'AlertDialog').props.onOpenChange(false);
  assert.equal(field(f, 'sample-test-arrival').props.value, '2026-09-08T02:00:00');
  button(f, '取消').props.onClick();
  find(f.render(), (node) => node.type === 'AlertDialogAction').props.onClick(); assert.equal(f.calls.closed.length, 1);
});

test('分派期间切任务使旧响应失效，同任务版本变更必须先明确重载', async () => {
  const pending = deferred(); const f = await ready('SampleTestAssignmentDialog', { task }, { assignProcSampleTest: () => pending.promise });
  submit(f); f.render(); f.setProps({ task: { ...task, id: 'task-b' } }); await settle(); f.render();
  pending.resolve({ ...task, status: 'testing' }); await settle(); assert.equal(f.calls.assigned.length, 0);
  const g = await ready('SampleTestAssignmentDialog', { task });
  g.setProps({ task: { ...task, updatedAt: '2026-09-08T06:00:00Z' } }); assert.equal(submitButton(g).props.disabled, true);
  assert.equal(field(g, 'sample-test-arrival').props.value, '2026-09-08T01:00:00');
  submit(g); await settle(); assert.equal(g.calls.assigned.length, 0);
  button(g, '放弃修改并载入最新任务').props.onClick(); g.render(); assert.equal(field(g, 'sample-test-arrival').props.value, '');
});

test('保存实际时间只触发登记回调，不能把手机入口标成结论已确认；脏登记阻止提交结论', async () => {
  const current = detail(); current.sampleTest.recordsVersion = 1; current.sampleTest.arrivedAt = '2026-09-08T00:00:00Z'; current.sampleTest.startedAt = '2026-09-08T01:00:00Z'; current.sampleTest.finishedAt = null;
  const saved = [];
  const f = await ready('ProcSampleTestDialog', { taskId: task.id, onRecordsSaved: () => saved.push(true) }, { getProcSampleTest: async () => current });
  enterConclusion(f); assert.equal(submitButton(f).props.disabled, true); submit(f); await settle(); assert.equal(f.calls.confirmed.length, 0);
  const records = () => find(f.render(), (node) => node.type === 'SampleRecordsPanel');
  const updated = { ...current, task: { ...current.task, updatedAt: '2026-09-08T06:00:00Z' }, sampleTest: { ...current.sampleTest, finishedAt: '2026-09-08T03:00:00Z' } };
  records().props.onSaved(updated); f.render(); assert.equal(saved.length, 1); assert.equal(f.calls.confirmed.length, 0);
  records().props.onInteractionStateChange({ dirty: true, busy: false }); f.render(); assert.equal(submitButton(f).props.disabled, true);
  submit(f); await settle(); assert.equal(f.calls.confirmed.length, 0);
  records().props.onInteractionStateChange({ dirty: false, busy: false }); f.render(); assert.equal(submitButton(f).props.disabled, false);
});

test('账号切换后迟到读取不会回填旧采购条件或结论', async () => {
  const pending = deferred(); let reads = 0;
  const f = fixture('ProcSampleTestDialog', { taskId: task.id }, { getProcSampleTest: () => ++reads === 1 ? pending.promise : Promise.reject(new Error('新账号无权查看')) });
  f.render(); f.setUser({ id: 'other-account', permissions: [] }); await settle();
  pending.resolve(detail()); await settle(); f.render();
  assert.equal(find(f.render(), (node) => node.type === 'SampleRecordsPanel'), undefined); assert.match(alerts(f), /新账号无权查看/);
});
const settle = () => new Promise((resolve) => setImmediate(resolve));
function deferred() { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const translate = (text, params = {}) => text.replace(/\{(\w+)\}/g, (match, key) => params[key] ?? match);
const task = { id: 'proc-A', code: 'PROC-A', materialName: '测试样品', status: 'pending_sample', updatedAt: '2026-09-08T01:00:00Z', rdContactUserId: 'rd-contact' };
const testers = [{ id: 'rd-contact', name: '研发同名人员', department: '研发部' }, { id: 'rd-assigned', name: '研发同名人员', department: '研发部' }];
function detail(id = task.id, overrides = {}) {
  return {
    task: { ...task, id, code: `PROC-${id}`, buyer: '采购负责人', spec: '规格一', quantity: 3, unit: '件', attachmentList: [], status: 'testing', needSample: true, logs: [] },
    sampleTest: { roundId: `round-${id}`, testerUserId: 'rd-assigned', testerName: '指定研发人员', assignedAt: '2026-09-08T02:00:00Z', assignedByName: '采购负责人', result: null, note: null, confirmedAt: null, confirmedByName: null },
    canConfirm: true,
    ...overrides,
  };
}
function completed(id = task.id) {
  const current = detail(id);
  return { ...current, task: { ...current.task, status: 'priced' }, canConfirm: false, sampleTest: { ...current.sampleTest, result: 'passed', note: '测试合格', confirmedByName: '确认研发人员', confirmedAt: '2026-09-08T03:04:05Z' } };
}

// Execute the actual component module. Only its hooks, visual primitives and API boundary are replaced.
// Effects run after rendering with dependency cleanup; state persists across props changes and async responses.
function fixture(name, props = {}, api = {}) {
  const slots = []; const pendingEffects = []; const calls = { assigned: [], confirmed: [], closed: [] };
  let cursor = 0; let dirty = false; let destroyed = false; let input = props;
  let authUser = { id: 'rd-assigned', permissions: ['page:rd-my-workspace'] };
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], (value) => { const next = typeof value === 'function' ? value(slots[index]) : value; if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; } }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useEffect(callback, deps) {
      const index = cursor++; const previous = slots[index];
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
        const effect = { deps, cleanup: undefined };
        slots[index] = effect;
        pendingEffects.push(() => { previous?.cleanup?.(); effect.cleanup = callback(); });
      }
    },
  };
  const boundary = {
    listProcSampleTesters: async () => testers,
    assignProcSampleTest: async () => ({ ...task, status: 'testing' }),
    getProcSampleTest: async (id) => detail(id),
    confirmProcSampleTest: async (id) => completed(id),
    ...api,
  };
  const components = new Proxy({}, { get: (_target, key) => key });
  const dependencies = {
    react: hooks, 'react/jsx-runtime': jsxRuntime, 'lucide-react': components,
    '../../lib/i18n': { useI18n: () => ({ t: translate }), i18nLocale: () => 'zh-CN' },
    '../../lib/procurementApi': boundary,
    '../../auth': { useAuth: () => ({ user: authUser }) },
    '../../lib/procSampleFacts': sampleFacts,
    '../samples/SampleValidationPanel': { SampleValidationPanel: 'SampleValidationPanel' },
    '../samples/sampleValidationModel': validationModel,
    './SampleTechnicalFiles': { SampleTechnicalFiles: 'SampleTechnicalFiles' },
    './RdDeliverySnapshotPanel': { RdDeliverySnapshotPanel: 'RdDeliverySnapshotPanel' },
    '../sampleWorkspace.css': {},
    '../samples/SampleTimingSummary': { SampleTimingSummary: 'SampleTimingSummary' },
    '../samples/SampleRecordsPanel': { SampleRecordsPanel: 'SampleRecordsPanel' },
    '../samples/SampleRoundHistory': { SampleRoundHistory: 'SampleRoundHistory' },
    '../samples/sampleRecordsModel': recordsModel,
    '../samples/sampleTimingModel': timingModel,
  };
  const exports = {};
  new Function('exports', 'require', modules[name])(exports, (id) => {
    if (id in dependencies) return dependencies[id];
    assert.ok(id.startsWith('../../components/ui/'), `Unexpected dependency ${id}`);
    return components;
  });
  return {
    calls,
    render() {
      assert.equal(destroyed, false, 'cannot render an unmounted component');
      let view;
      for (let iteration = 0; iteration < 20; iteration++) {
        dirty = false; cursor = 0;
        view = exports[name]({ onClose: () => calls.closed.push(true), onAssigned: (value) => calls.assigned.push(value), onConfirmed: () => calls.confirmed.push(true), ...input });
        while (pendingEffects.length) pendingEffects.shift()();
        if (!dirty) return view;
      }
      assert.fail('component failed to settle');
    },
    setProps(next) { input = { ...input, ...next }; return this.render(); },
    setUser(next) { authUser = next; return this.render(); },
    destroy() { destroyed = true; for (const slot of slots) slot?.cleanup?.(); },
  };
}
function all(tree, predicate, out = []) {
  if (!tree || typeof tree !== 'object') return out;
  if (predicate(tree)) out.push(tree);
  for (const child of React.Children.toArray(tree.props?.children)) all(child, predicate, out);
  return out;
}
function find(tree, predicate) { return all(tree, predicate)[0]; }
function text(tree) {
  if (tree === null || tree === undefined || typeof tree === 'boolean') return '';
  if (typeof tree !== 'object') return String(tree);
  return React.Children.toArray(tree.props?.children).map(text).join(' ');
}
function field(f, id) { return find(f.render(), (node) => node.props.id === id); }
function change(f, id, value) { const input = field(f, id); assert.ok(input, `missing ${id}`); input.props.onChange({ target: { value } }); f.render(); }
function submit(f) { const form = find(f.render(), (node) => node.type === 'form'); assert.ok(form, 'form must exist'); form.props.onSubmit({ preventDefault() {} }); }
function button(f, label) { return find(f.render(), (node) => node.type === 'Button' && text(node) === label); }
function submitButton(f) { return find(f.render(), (node) => node.type === 'Button' && node.props.type === 'submit'); }
function alerts(f) { return all(f.render(), (node) => node.props.role === 'alert').map(text).join(' '); }
async function ready(name, props, api) { const f = fixture(name, props, api); f.render(); await settle(); f.render(); if (name === 'SampleTestAssignmentDialog' && props.task.status === 'pending_sample') change(f, 'sample-test-arrival', '2026-09-08T01:00:00'); return f; }
function enterConclusion(f, result = 'passed', note = '  测试合格  ') { find(f.render(), node => node.type === 'SampleValidationPanel').props.onChange(explorationValidation); f.render(); change(f, 'sample-test-result', result); change(f, 'sample-test-conclusion', note); }

test('资料默认先展示，切换登记与历史保留结论及登记草稿，未保存登记仍阻止确认', async () => {
  const f = await ready('ProcSampleTestDialog', { taskId: task.id, inline: true });
  const panel = value => find(f.render(), node => node.props.id === `sample-${task.id}-${value}-panel`);
  const switchTo = value => { find(f.render(), node => node.type === 'Tabs').props.onValueChange(value); f.render(); };
  assert.equal(panel('review').props.hidden, false);
  assert.equal(panel('records').props.hidden, true);
  assert.equal(panel('history').props.hidden, true);
  assert.ok(find(panel('review'), node => node.type === 'SampleTechnicalFiles'));
  assert.equal(find(panel('review'), node => node.type === 'SampleRecordsPanel'), undefined);
  enterConclusion(f, 'failed_resample', '保留改样结论');
  const records = find(panel('records'), node => node.type === 'SampleRecordsPanel');
  records.props.onInteractionStateChange({ dirty: true, busy: false });
  switchTo('records');
  assert.equal(panel('records').props.hidden, false);
  switchTo('history');
  assert.ok(find(panel('history'), node => node.type === 'SampleRoundHistory'));
  assert.ok(find(panel('history'), node => node.type === 'RdDeliverySnapshotPanel'));
  switchTo('review');
  assert.equal(field(f, 'sample-test-result').props.value, 'failed_resample');
  assert.equal(field(f, 'sample-test-conclusion').props.value, '保留改样结论');
  assert.equal(submitButton(f).props.disabled, true);
  assert.ok(find(panel('records'), node => node.type === 'SampleRecordsPanel'), '非当前标签的登记组件保持挂载');
  button(f, '继续登记').props.onClick(); f.render();
  assert.equal(panel('records').props.hidden, false);
  f.setProps({ taskId: 'new-task' }); await settle(); f.render();
  assert.equal(find(f.render(), node => node.type === 'Tabs').props.value, 'review');
});

test('分派目录使用真实账号 ID，同名用户不混淆，默认优先已分派人其次研发联系人', async () => {
  for (const [current, expected] of [[task, 'rd-contact'], [{ ...task, status: 'testing', sampleTest: { testerUserId: 'rd-assigned', result: null } }, 'rd-assigned']]) {
    const writes = [];
    const f = await ready('SampleTestAssignmentDialog', { task: current }, { assignProcSampleTest: async (...args) => { writes.push(args); return current; } });
    const select = field(f, 'sample-test-assignee');
    assert.equal(select.props.value, expected);
    assert.deepEqual(all(select, (node) => node.type === 'option').map((node) => node.props.value), ['', 'rd-contact', 'rd-assigned']);
    submit(f); await settle();
    assert.deepEqual(writes, [[current.id, { testerUserId: expected, fromStatus: current.status, baseUpdatedAt: current.updatedAt, ...(current.status === 'pending_sample' ? { arrivedAt: new Date('2026-09-08T01:00:00').toISOString() } : {}) }]]);
    assert.equal(f.calls.assigned.length, 1);
  }
});

test('无有效研发候选或默认人员不在目录时不允许提交', async () => {
  for (const rows of [[], [{ id: 'other-id', name: '另一人员', department: null }]]) {
    const writes = [];
    const f = await ready('SampleTestAssignmentDialog', { task }, { listProcSampleTesters: async () => rows, assignProcSampleTest: async (...args) => writes.push(args) });
    assert.equal(field(f, 'sample-test-assignee').props.value, '');
    assert.equal(submitButton(f).props.disabled, true);
    submit(f); await settle();
    assert.deepEqual(writes, []);
    assert.match(alerts(f), /请选择研发测试人员/);
    if (rows.length === 0) assert.match(text(f.render()), /暂无可接收测试待办的研发人员/);
  }
});

test('分派双击只发一个请求，等待期间关闭事件被忽略且操作按钮禁用', async () => {
  const waiting = deferred(); const writes = [];
  const f = await ready('SampleTestAssignmentDialog', { task }, { assignProcSampleTest: (...args) => { writes.push(args); return waiting.promise; } });
  const handler = find(f.render(), (node) => node.type === 'form').props.onSubmit;
  handler({ preventDefault() {} }); handler({ preventDefault() {} });
  assert.equal(writes.length, 1);
  const view = f.render();
  assert.equal(field(f, 'sample-test-assignee').props.disabled, true);
  assert.equal(submitButton(f).props.disabled, true);
  assert.equal(button(f, '取消').props.disabled, true);
  find(view, (node) => node.type === 'Dialog').props.onOpenChange(false);
  assert.deepEqual(f.calls.closed, []);
  waiting.resolve({ ...task, status: 'testing' }); await settle();
  assert.equal(f.calls.assigned.length, 1);
});

test('分派失败保留选人、展示原因，重试继续发送同一账号与版本', async () => {
  const writes = [];
  const f = await ready('SampleTestAssignmentDialog', { task }, { assignProcSampleTest: async (...args) => { writes.push(args); if (writes.length === 1) throw new Error('任务已更新，请重试'); return task; } });
  change(f, 'sample-test-assignee', 'rd-assigned');
  submit(f); await settle();
  assert.equal(field(f, 'sample-test-assignee').props.value, 'rd-assigned');
  assert.match(alerts(f), /任务已更新，请重试/);
  assert.deepEqual(f.calls.assigned, []);
  assert.deepEqual(f.calls.closed, []);
  submit(f); await settle();
  assert.deepEqual(writes[1], writes[0]);
  assert.equal(f.calls.assigned.length, 1);
});

test('研发人员目录失败可重试，失败和加载期间不能分派', async () => {
  let reads = 0; const writes = [];
  const f = await ready('SampleTestAssignmentDialog', { task }, { listProcSampleTesters: async () => { if (++reads === 1) throw new Error('人员目录不可用'); return testers; }, assignProcSampleTest: async (...args) => writes.push(args) });
  assert.match(alerts(f), /人员目录不可用/);
  assert.equal(submitButton(f).props.disabled, true);
  button(f, '重试').props.onClick(); f.render();
  assert.equal(field(f, 'sample-test-assignee').props.disabled, true);
  await settle();
  assert.equal(reads, 2);
  assert.equal(alerts(f), '');
  assert.equal(field(f, 'sample-test-assignee').props.value, 'rd-contact');
  assert.equal(submitButton(f).props.disabled, false);
  assert.deepEqual(writes, []);
});

test('研发读取权限被拒绝时显示原因和重试入口，不显示确认表单或提交按钮', async () => {
  const writes = [];
  const f = await ready('ProcSampleTestDialog', { taskId: task.id }, { getProcSampleTest: async () => { throw new Error('无权查看此测试任务'); }, confirmProcSampleTest: async (...args) => writes.push(args) });
  assert.match(alerts(f), /无权查看此测试任务/);
  assert.ok(button(f, '重新加载'));
  assert.equal(find(f.render(), (node) => node.type === 'form'), undefined);
  assert.equal(submitButton(f), undefined);
  assert.deepEqual(writes, []);
});

test('测试必须选择明确结果并填写非空结论，三种结果分别保留业务取值', async () => {
  const writes = [];
  const f = await ready('ProcSampleTestDialog', { taskId: task.id }, { confirmProcSampleTest: async (...args) => writes.push(args) });
  assert.deepEqual(all(field(f, 'sample-test-result'), (node) => node.type === 'option').map((node) => node.props.value), ['', 'passed', 'failed_resample', 'failed_requote']);
  for (const [result, note] of [['', ''], ['passed', '   '], ['', '已完成测试']]) {
    enterConclusion(f, result, note);
    assert.equal(submitButton(f).props.disabled, true);
    submit(f); await settle();
    assert.match(alerts(f), /请选择测试结果并填写测试结论/);
  }
  assert.deepEqual(writes, []);
});

test('确认携带当前分派 roundId、明确结果和去首尾空白结论，成功后展示确认人时间并禁止再提交', async () => {
  for (const outcome of ['passed', 'failed_resample', 'failed_requote']) {
    const writes = [];
    const finished = completed(); finished.sampleTest.result = outcome;
    const f = await ready('ProcSampleTestDialog', { taskId: task.id }, { confirmProcSampleTest: async (...args) => { writes.push(args); return finished; } });
    enterConclusion(f, outcome, '  第一行测试结论\n第二行跟进要求  ');
    submit(f); await settle();
    assert.deepEqual(writes, [[task.id, { validation: explorationValidation, roundId: `round-${task.id}`, result: outcome, note: '第一行测试结论\n第二行跟进要求' }]]);
    const view = text(f.render());
    assert.match(view, /确认研发人员/);
    assert.ok(view.includes(new Date(finished.sampleTest.confirmedAt).toLocaleString('zh-CN')));
    assert.match(view, /测试结论已确认，已通知采购负责人/);
    assert.equal(submitButton(f), undefined);
    assert.equal(field(f, 'sample-test-conclusion'), undefined);
    submit(f); await settle();
    assert.equal(writes.length, 1);
    assert.equal(f.calls.confirmed.length, 1);
  }
});

test('研发确认双击只发一次，等待期间结果/结论/关闭按钮禁用且关闭事件无效', async () => {
  const waiting = deferred(); const writes = [];
  const f = await ready('ProcSampleTestDialog', { taskId: task.id }, { confirmProcSampleTest: (...args) => { writes.push(args); return waiting.promise; } });
  enterConclusion(f);
  const handler = find(f.render(), (node) => node.type === 'form').props.onSubmit;
  handler({ preventDefault() {} }); handler({ preventDefault() {} });
  assert.equal(writes.length, 1);
  assert.equal(field(f, 'sample-test-result').props.disabled, true);
  assert.equal(field(f, 'sample-test-conclusion').props.disabled, true);
  assert.equal(button(f, '关闭').props.disabled, true);
  find(f.render(), (node) => node.type === 'Dialog').props.onOpenChange(false);
  assert.deepEqual(f.calls.closed, []);
  waiting.resolve(completed()); await settle();
  assert.deepEqual(f.calls.confirmed, [true]);
});

test('研发确认失败保留结果和结论草稿，展示错误且可以再次提交', async () => {
  const writes = [];
  const f = await ready('ProcSampleTestDialog', { taskId: task.id }, { confirmProcSampleTest: async (...args) => { writes.push(args); if (writes.length === 1) throw new Error('测试分派已变化，请核对'); return completed(); } });
  enterConclusion(f, 'failed_resample', '  外壳尺寸偏差，需要重新出样  ');
  submit(f); await settle();
  assert.match(alerts(f), /测试分派已变化，请核对/);
  assert.equal(field(f, 'sample-test-result').props.value, 'failed_resample');
  assert.equal(field(f, 'sample-test-conclusion').props.value, '  外壳尺寸偏差，需要重新出样  ');
  assert.equal(submitButton(f).props.disabled, false);
  assert.deepEqual(f.calls.confirmed, []);
  submit(f); await settle();
  assert.deepEqual(writes[1], writes[0]);
  assert.deepEqual(f.calls.confirmed, [true]);
});

test('任务 A 迟到的详情或错误不能覆盖新任务 B，任务切换清除旧草稿', async () => {
  for (const failure of [false, true]) {
    const a = deferred(); const reads = [];
    const f = fixture('ProcSampleTestDialog', { taskId: 'A' }, { getProcSampleTest: (id, signal) => { reads.push({ id, signal }); return id === 'A' ? a.promise : Promise.resolve(detail('B')); } });
    f.render(); f.setProps({ taskId: 'B' }); await settle();
    assert.equal(reads[0].signal.aborted, true);
    enterConclusion(f, 'failed_requote', '任务 B 草稿');
    if (failure) a.reject(new Error('任务 A 的迟到错误')); else a.resolve(detail('A'));
    await settle();
    assert.match(text(f.render()), /PROC-B/);
    assert.doesNotMatch(text(f.render()), /PROC-A|任务 A 的迟到错误/);
    assert.equal(field(f, 'sample-test-conclusion').props.value, '任务 B 草稿');
    assert.equal(field(f, 'sample-test-result').props.value, 'failed_requote');
    f.setProps({ taskId: 'C' }); await settle();
    assert.equal(field(f, 'sample-test-conclusion').props.value, '');
    assert.equal(field(f, 'sample-test-result').props.value, '');
  }
});

test('组件销毁后，迟到的分派/确认结果不触发刷新回调或关闭', async () => {
  for (const name of ['SampleTestAssignmentDialog', 'ProcSampleTestDialog']) {
    const waiting = deferred();
    const f = await ready(name, name === 'SampleTestAssignmentDialog' ? { task } : { taskId: task.id }, { assignProcSampleTest: () => waiting.promise, confirmProcSampleTest: () => waiting.promise });
    if (name === 'ProcSampleTestDialog') enterConclusion(f);
    submit(f); f.destroy(); waiting.resolve(completed()); await settle();
    assert.deepEqual(f.calls, { assigned: [], confirmed: [], closed: [] });
  }
});

test('任务 A 提交期间切换 B，A 的迟到确认不能覆盖 B 或令 B 持续处于提交状态', async () => {
  const waiting = deferred(); const writes = [];
  const f = await ready('ProcSampleTestDialog', { taskId: 'A' }, { confirmProcSampleTest: (id, payload) => { writes.push([id, payload]); return waiting.promise; } });
  enterConclusion(f); submit(f);
  f.setProps({ taskId: 'B' }); await settle();
  waiting.resolve(completed('A')); await settle();
  assert.match(text(f.render()), /PROC-B/);
  assert.doesNotMatch(text(f.render()), /PROC-A/);
  assert.deepEqual(f.calls.confirmed, []);
  assert.equal(field(f, 'sample-test-result').props.disabled, false, 'B must leave the previous task submission state');
  enterConclusion(f, 'passed', '任务 B 测试结论');
  assert.equal(submitButton(f).props.disabled, false);
});

test('B 已开始新确认时 A 的迟到响应不能解除 B 的提交锁或覆盖 B 草稿', async () => {
  const a = deferred(); const b = deferred(); const writes = [];
  const f = await ready('ProcSampleTestDialog', { taskId: 'A' }, { confirmProcSampleTest: (id, payload) => { writes.push([id, payload]); return id === 'A' ? a.promise : b.promise; } });
  enterConclusion(f); submit(f);
  f.setProps({ taskId: 'B' }); await settle();
  enterConclusion(f, 'failed_requote', '任务 B 的结论'); submit(f);
  a.resolve(completed('A')); await settle();
  assert.match(text(f.render()), /PROC-B/);
  assert.equal(field(f, 'sample-test-conclusion').props.value, '任务 B 的结论');
  assert.equal(submitButton(f).props.disabled, true);
  find(f.render(), (node) => node.type === 'Dialog').props.onOpenChange(false);
  assert.deepEqual(f.calls.closed, []);
  submit(f); assert.equal(writes.length, 2);
  b.resolve(completed('B')); await settle();
  assert.deepEqual(f.calls.confirmed, [true]);
  assert.equal(submitButton(f), undefined);
});

test('同一任务同一轮 revision 刷新保留原草稿，刷新完成前不得提交', async () => {
  const refresh = deferred(); const writes = []; let reads = 0;
  const f = await ready('ProcSampleTestDialog', { taskId: task.id, inline: true, revision: '1' }, {
    getProcSampleTest: async () => ++reads === 1 ? detail() : refresh.promise,
    confirmProcSampleTest: async (...args) => { writes.push(args); return completed(); },
  });
  enterConclusion(f, 'failed_resample', '  原始草稿\n保留空白  ');
  f.setProps({ revision: '2' });
  assert.equal(field(f, 'sample-test-conclusion').props.value, '  原始草稿\n保留空白  ');
  assert.equal(field(f, 'sample-test-result').props.disabled, true);
  assert.equal(submitButton(f).props.disabled, true);
  submit(f); await settle();
  assert.deepEqual(writes, []);
  const updated = detail(); updated.task.materialName = '已刷新的物料名称';
  refresh.resolve(updated); await settle();
  assert.match(text(f.render()), /已刷新的物料名称/);
  assert.equal(field(f, 'sample-test-result').props.value, 'failed_resample');
  assert.equal(field(f, 'sample-test-conclusion').props.value, '  原始草稿\n保留空白  ');
  assert.equal(submitButton(f).props.disabled, false);
});

test('revision 刷新得到新 roundId 时清空旧轮草稿，提交只携带新轮编号', async () => {
  const writes = []; const interaction = []; let reads = 0;
  const next = detail(); next.sampleTest.roundId = 'next-round';
  const f = await ready('ProcSampleTestDialog', { taskId: task.id, inline: true, revision: '1', onInteractionStateChange: (state) => interaction.push(state) }, {
    getProcSampleTest: async () => ++reads === 1 ? detail() : next,
    confirmProcSampleTest: async (...args) => { writes.push(args); return completed(); },
  });
  enterConclusion(f, 'failed_requote', '旧轮草稿');
  assert.deepEqual(interaction.at(-1), { dirty: true, busy: false });
  f.setProps({ revision: '2' }); await settle(); f.render();
  assert.equal(field(f, 'sample-test-result').props.value, '');
  assert.equal(field(f, 'sample-test-conclusion').props.value, '');
  assert.deepEqual(interaction.at(-1), { dirty: false, busy: false });
  assert.equal(submitButton(f).props.disabled, true);
  enterConclusion(f, 'passed', '新轮测试通过'); submit(f); await settle();
  assert.deepEqual(writes, [[task.id, { validation: explorationValidation, roundId: 'next-round', result: 'passed', note: '新轮测试通过' }]]);
});

test('同轮刷新变成已确认或失去本人确认权限时旧草稿不能继续提交', async () => {
  for (const refreshed of [completed(), detail(task.id, { canConfirm: false })]) {
    const writes = []; const interaction = []; let reads = 0;
    const f = await ready('ProcSampleTestDialog', { taskId: task.id, inline: true, revision: '1', onInteractionStateChange: (state) => interaction.push(state) }, {
      getProcSampleTest: async () => ++reads === 1 ? detail() : refreshed,
      confirmProcSampleTest: async (...args) => writes.push(args),
    });
    enterConclusion(f);
    f.setProps({ revision: '2' }); await settle(); f.render();
    assert.equal(field(f, 'sample-test-conclusion'), undefined);
    assert.equal(submitButton(f), undefined);
    assert.deepEqual(interaction.at(-1), { dirty: false, busy: false });
    submit(f); await settle();
    assert.deepEqual(writes, []);
  }
});

test('同任务两次后台刷新乱序时旧响应不能覆盖新轮或抹掉新轮草稿', async () => {
  const stale = deferred(); const requests = [];
  const next = detail(); next.sampleTest.roundId = 'round-latest'; next.task.materialName = '最新轮物料';
  const f = await ready('ProcSampleTestDialog', { taskId: task.id, inline: true, revision: '1' }, {
    getProcSampleTest: (id, signal) => { requests.push({ id, signal }); return requests.length === 1 ? Promise.resolve(detail()) : requests.length === 2 ? stale.promise : Promise.resolve(next); },
  });
  enterConclusion(f, 'failed_resample', '旧轮草稿');
  f.setProps({ revision: '2' });
  f.setProps({ revision: '3' }); await settle();
  assert.equal(requests[1].signal.aborted, true);
  enterConclusion(f, 'passed', '最新轮草稿');
  stale.resolve(detail()); await settle();
  assert.match(text(f.render()), /最新轮物料/);
  assert.equal(field(f, 'sample-test-result').props.value, 'passed');
  assert.equal(field(f, 'sample-test-conclusion').props.value, '最新轮草稿');
});

test('inline 复用同一确认表单和提交锁，双击只发一次且不会产生弹窗关闭入口', async () => {
  const waiting = deferred(); const writes = []; const interaction = [];
  const f = await ready('ProcSampleTestDialog', { taskId: task.id, inline: true, onInteractionStateChange: (state) => interaction.push(state) }, {
    confirmProcSampleTest: (...args) => { writes.push(args); return waiting.promise; },
  });
  assert.equal(find(f.render(), (node) => node.type === 'Dialog'), undefined);
  assert.equal(button(f, '关闭'), undefined);
  assert.equal(all(f.render(), (node) => node.type === 'form').length, 1);
  enterConclusion(f, 'passed', '  本人确认  ');
  const handler = find(f.render(), (node) => node.type === 'form').props.onSubmit;
  handler({ preventDefault() {} }); handler({ preventDefault() {} }); f.render();
  assert.deepEqual(writes, [[task.id, { validation: explorationValidation, roundId: `round-${task.id}`, result: 'passed', note: '本人确认' }]]);
  assert.equal(field(f, 'sample-test-result').props.disabled, true);
  assert.equal(field(f, 'sample-test-conclusion').props.disabled, true);
  assert.equal(submitButton(f).props.disabled, true);
  assert.deepEqual(interaction.at(-1), { dirty: true, busy: true });
  waiting.resolve(completed()); await settle(); f.render();
  assert.deepEqual(f.calls.confirmed, [true]);
  assert.deepEqual(f.calls.closed, []);
  assert.deepEqual(interaction.at(-1), { dirty: false, busy: false });
  assert.equal(submitButton(f), undefined);
});

test('内容变更回调覆盖编辑、清空、失败保留草稿和卸载释放状态', async () => {
  const waiting = deferred(); const interaction = [];
  const f = await ready('ProcSampleTestDialog', { taskId: task.id, inline: true, onInteractionStateChange: (state) => interaction.push(state) }, {
    confirmProcSampleTest: () => waiting.promise,
  });
  assert.deepEqual(interaction.at(-1), { dirty: false, busy: false });
  change(f, 'sample-test-conclusion', '仅输入结论');
  assert.deepEqual(interaction.at(-1), { dirty: true, busy: false });
  change(f, 'sample-test-conclusion', '');
  assert.deepEqual(interaction.at(-1), { dirty: false, busy: false });
  enterConclusion(f); submit(f); f.render();
  assert.deepEqual(interaction.at(-1), { dirty: true, busy: true });
  waiting.reject(new Error('暂时无法确认')); await settle(); f.render();
  assert.match(alerts(f), /暂时无法确认/);
  assert.deepEqual(interaction.at(-1), { dirty: true, busy: false });
  assert.equal(field(f, 'sample-test-conclusion').props.value, '  测试合格  ');
  f.destroy();
  assert.deepEqual(interaction.at(-1), { dirty: false, busy: false });
});

test('同轮后台读取失败保持草稿且禁止提交，重试成功后恢复原草稿', async () => {
  const writes = []; let reads = 0;
  const f = await ready('ProcSampleTestDialog', { taskId: task.id, inline: true, revision: '1' }, {
    getProcSampleTest: async () => { if (++reads === 2) throw new Error('刷新失败'); return detail(); },
    confirmProcSampleTest: async (...args) => writes.push(args),
  });
  enterConclusion(f, 'failed_resample', '保留刷新前草稿');
  f.setProps({ revision: '2' }); await settle();
  assert.match(alerts(f), /刷新失败/);
  assert.equal(field(f, 'sample-test-conclusion').props.value, '保留刷新前草稿');
  assert.equal(submitButton(f).props.disabled, true);
  submit(f); await settle(); assert.deepEqual(writes, []);
  button(f, '重新加载').props.onClick(); f.render(); await settle();
  assert.equal(field(f, 'sample-test-result').props.value, 'failed_resample');
  assert.equal(field(f, 'sample-test-conclusion').props.value, '保留刷新前草稿');
  assert.equal(submitButton(f).props.disabled, false);
});

test('样品界面使用真实事实 helper，旧通过结果在待到样阶段只作为历史结果', async () => {
  const waiting = completed(); waiting.task.status = 'pending_sample';
  const f = await ready('ProcSampleTestDialog', { taskId: task.id, inline: true }, { getProcSampleTest: async () => waiting });
  const content = text(f.render());
  assert.match(content, /待到样/);
  assert.match(content, /上次已确认结果/);
  assert.doesNotMatch(content, /已确认到样|已确认测试结论/);
  assert.equal(submitButton(f), undefined);
  const current = await ready('ProcSampleTestDialog', { taskId: task.id, inline: true });
  assert.match(text(current.render()), /已确认到样/);
  assert.match(text(current.render()), /分派时间不是实际到样日期/);
});

test('提交成功后迟到的同轮后台刷新不能重新打开确认表单或允许旧草稿重复提交', async () => {
  const confirmation = deferred(); const refresh = deferred(); const writes = []; let reads = 0;
  const f = await ready('ProcSampleTestDialog', { taskId: task.id, inline: true, revision: '1' }, {
    getProcSampleTest: async () => ++reads === 1 ? detail() : refresh.promise,
    confirmProcSampleTest: (...args) => { writes.push(args); return confirmation.promise; },
  });
  enterConclusion(f); submit(f);
  f.setProps({ revision: '2' });
  confirmation.resolve(completed()); await settle(); f.render();
  assert.deepEqual(f.calls.confirmed, [true]);
  refresh.resolve(detail()); await settle();
  assert.equal(submitButton(f), undefined);
  assert.equal(field(f, 'sample-test-conclusion'), undefined);
  assert.match(text(f.render()), /测试结论已确认/);
  submit(f); await settle();
  assert.equal(writes.length, 1);
});


test('时间摘要沿用同一测试详情，读取失败保留草稿但摘要标记不可用', async () => {
  let fail=false;
  const f=await ready('ProcSampleTestDialog',{taskId:task.id,inline:true},{getProcSampleTest:async()=>{if(fail)throw new Error('读取失败');return detail();}});
  enterConclusion(f,'passed','保留测试结论草稿');
  const summary=()=>find(f.render(),n=>n.type==='SampleTimingSummary');
  assert.equal(summary().props.detail.task.id,task.id);assert.equal(summary().props.error,false);
  fail=true;f.setProps({taskId:task.id,inline:true,revision:'new'});await settle();f.render();
  assert.equal(summary().props.error,true);assert.equal(field(f,'sample-test-conclusion').props.value,'保留测试结论草稿');assert.equal(submitButton(f).props.disabled,true);
});


test('未分类或转产依据缺失时不得提交通过；探索不适用说明随结论保存', async () => {
  const writes = [];
  const f = await ready('ProcSampleTestDialog', { taskId: task.id }, { confirmProcSampleTest: async (...args) => { writes.push(args); return completed(); } });
  change(f, 'sample-test-result', 'passed'); change(f, 'sample-test-conclusion', '通过');
  submit(f); await settle(); assert.equal(writes.length, 0); assert.match(alerts(f), /请选择研发探索/);
  find(f.render(), node => node.type === 'SampleValidationPanel').props.onChange(validationModel.emptySampleValidation('transfer'));
  f.render(); submit(f); await settle(); assert.equal(writes.length, 0); assert.match(alerts(f), /图纸/);
  enterConclusion(f); submit(f); await settle(); assert.equal(writes.length, 1); assert.equal(writes[0][1].validation.kind, 'exploration');
});
