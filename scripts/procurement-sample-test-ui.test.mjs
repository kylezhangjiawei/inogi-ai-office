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
const settle = () => new Promise((resolve) => setImmediate(resolve));
function deferred() { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const translate = (text, params = {}) => text.replace(/\{(\w+)\}/g, (match, key) => params[key] ?? match);
const task = { id: 'proc-A', code: 'PROC-A', materialName: '测试样品', status: 'pending_sample', updatedAt: '2026-09-08T01:00:00Z', rdContactUserId: 'rd-contact' };
const testers = [{ id: 'rd-contact', name: '研发同名人员', department: '研发部' }, { id: 'rd-assigned', name: '研发同名人员', department: '研发部' }];
function detail(id = task.id, overrides = {}) {
  return {
    task: { ...task, id, code: `PROC-${id}`, buyer: '采购负责人', spec: '规格一', quantity: 3, unit: '件', attachmentList: [], status: 'testing' },
    sampleTest: { roundId: `round-${id}`, testerUserId: 'rd-assigned', testerName: '指定研发人员', result: null, note: null, confirmedAt: null, confirmedByName: null },
    canConfirm: true,
    ...overrides,
  };
}
function completed(id = task.id) {
  const current = detail(id);
  return { ...current, canConfirm: false, sampleTest: { ...current.sampleTest, result: 'passed', note: '测试合格', confirmedByName: '确认研发人员', confirmedAt: '2026-09-08T03:04:05Z' } };
}

// Execute the actual component module. Only its hooks, visual primitives and API boundary are replaced.
// Effects run after rendering with dependency cleanup; state persists across props changes and async responses.
function fixture(name, props = {}, api = {}) {
  const slots = []; const pendingEffects = []; const calls = { assigned: [], confirmed: [], closed: [] };
  let cursor = 0; let dirty = false; let destroyed = false; let input = props;
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
async function ready(name, props, api) { const f = fixture(name, props, api); f.render(); await settle(); f.render(); return f; }
function enterConclusion(f, result = 'passed', note = '  测试合格  ') { change(f, 'sample-test-result', result); change(f, 'sample-test-conclusion', note); }

test('分派目录使用真实账号 ID，同名用户不混淆，默认优先已分派人其次研发联系人', async () => {
  for (const [current, expected] of [[task, 'rd-contact'], [{ ...task, status: 'testing', sampleTest: { testerUserId: 'rd-assigned', result: null } }, 'rd-assigned']]) {
    const writes = [];
    const f = await ready('SampleTestAssignmentDialog', { task: current }, { assignProcSampleTest: async (...args) => { writes.push(args); return current; } });
    const select = field(f, 'sample-test-assignee');
    assert.equal(select.props.value, expected);
    assert.deepEqual(all(select, (node) => node.type === 'option').map((node) => node.props.value), ['', 'rd-contact', 'rd-assigned']);
    submit(f); await settle();
    assert.deepEqual(writes, [[current.id, { testerUserId: expected, fromStatus: current.status, baseUpdatedAt: current.updatedAt }]]);
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
    assert.deepEqual(writes, [[task.id, { roundId: `round-${task.id}`, result: outcome, note: '第一行测试结论\n第二行跟进要求' }]]);
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
