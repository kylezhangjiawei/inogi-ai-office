import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const compile = (path) => ts.transpileModule(readFileSync(new URL('../' + path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function load(path, deps = {}) { const out = {}; new Function('exports', 'require', compile(path))(out, (id) => { if (/\/ui\/(?:button|input|native-select|textarea|checkbox|radio-group|slider)$/.test(id)) return { Button: "Button", Input: "Input", NativeSelect: "NativeSelect", Textarea: "Textarea", Checkbox: "Checkbox", RadioGroup: "RadioGroup", RadioGroupItem: "RadioGroupItem", Slider: "Slider" };  assert.ok(id in deps, id); return deps[id]; }); return out; }
const model = load('src/app/procurement/samples/sampleRecordsModel.ts');
const facts = load('src/app/lib/procSampleFacts.ts');
const timing = load('src/app/procurement/samples/sampleTimingModel.ts', { '../../lib/procSampleFacts': facts });
const i18n = { useI18n: () => ({ t: (value) => value }), i18nLocale: () => 'zh-CN' };
const history = load('src/app/procurement/samples/SampleRoundHistory.tsx', { 'react/jsx-runtime': jsxRuntime, '../../lib/i18n': i18n, './sampleTimingModel': timing });
const panel = compile('src/app/procurement/samples/SampleRecordsPanel.tsx');
const settle = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const makeDetail = () => ({ task: { id: 'task-a', updatedAt: '2026-09-08T03:00:00Z', status: 'testing' }, sampleTest: {
  roundId: 'round-a', testerUserId: 'rd-a', testerName: '研发甲', assignedAt: '2026-09-08T00:00:00Z', assignedByName: '采购甲', recordsVersion: 1,
  arrivedAt: '2026-09-08T00:00:00Z', startedAt: null, finishedAt: null, result: null, note: null, confirmedAt: null, confirmedByName: null,
  commercial: null, revisions: [],
}, history: [], canRecordArrival: true, canRecordTesting: true, canReadCommercial: true, canConfirm: true });

function fixture(props = {}, save) {
  let current = { detail: makeDetail(), identity: 'user-a', ...props }, cursor = 0, rerender = false, destroyed = false;
  const slots = [], effects = [], calls = { writes: [], saved: [], interaction: [] };
  const hooks = {
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], (next) => { const value = typeof next === 'function' ? next(slots[index]) : next; if (!Object.is(value, slots[index])) { slots[index] = value; rerender = true; } }]; },
    useEffect(fn, deps) { const index = cursor++, old = slots[index]; if (!old || deps.some((v, i) => !Object.is(v, old.deps[i]))) { const effect = { deps }; slots[index] = effect; effects.push(() => { old?.cleanup?.(); effect.cleanup = fn(); }); } },
  };
  const update = async (id, input) => {
    calls.writes.push([id, input]);
    if (save) return save(id, input);
    return { ...current.detail, task: { ...current.detail.task, updatedAt: '2026-09-08T04:00:00Z' }, sampleTest: { ...current.detail.sampleTest, ...input } };
  };
  const onInteractionStateChange = (state) => calls.interaction.push(state);
  const exports = {};
  const deps = { react: hooks, 'react/jsx-runtime': jsxRuntime, '../../lib/i18n': i18n, '../../components/ui/button': { Button: 'button' }, '../../lib/procurementApi': { updateProcSampleRecords: update }, './sampleRecordsModel': model, './SampleRoundHistory': { ...history, SampleConditionsView: 'conditions-view' } };
  new Function('exports', 'require', panel)(exports, (id) => { if (/\/ui\/(?:button|input|native-select|textarea|checkbox|radio-group|slider)$/.test(id)) return { Button: "Button", Input: "Input", NativeSelect: "NativeSelect", Textarea: "Textarea", Checkbox: "Checkbox", RadioGroup: "RadioGroup", RadioGroupItem: "RadioGroupItem", Slider: "Slider" };  assert.ok(id in deps, id); return deps[id]; });
  return { calls,
    render() { assert.equal(destroyed, false); let tree; for (let i = 0; i < 25; i++) { cursor = 0; rerender = false; tree = exports.SampleRecordsPanel({ ...current, onInteractionStateChange, onSaved: (value) => { calls.saved.push(value); current = { ...current, detail: value }; } }); while (effects.length) effects.shift()(); if (!rerender) return tree; } assert.fail('unsettled render'); },
    setProps(next) { current = { ...current, ...next }; return this.render(); },
    destroy() { destroyed = true; for (const slot of slots) slot?.cleanup?.(); },
  };
}
function all(tree, predicate) { if (!tree || typeof tree !== 'object') return []; return [...(predicate(tree) ? [tree] : []), ...React.Children.toArray(tree.props?.children).flatMap((child) => all(child, predicate))]; }
function text(tree) { if (tree == null || typeof tree === 'boolean') return ''; if (typeof tree !== 'object') return String(tree); return React.Children.toArray(tree.props?.children).map(text).join(''); }
const field = (f, label) => all(f.render(), (node) => node.props?.['aria-label'] === label)[0];
const button = (f, label) => all(f.render(), (node) => node.type === "Button" && text(node) === label)[0];
const change = (f, label, value) => { field(f, label).props.onChange({ target: { value } }); f.render(); };
const submit = (f) => all(f.render(), (node) => node.type === 'form')[0].props.onSubmit({ preventDefault() {} });

test('输入不归一非法本地时间，旧轮次不凭操作时间补实际时间', () => {
  assert.equal(model.sampleInputTimestamp('2026-02-30T00:00:00'), null);
  assert.equal(model.sampleInputTimestamp('2026-09-08T24:00'), null);
  assert.equal(model.sampleLocalTime('2026-02-30T00:00:00Z'), '');
  assert.equal(model.sampleLocalTime('2026-09-08T24:00:00Z'), '');
  assert.equal(model.sampleInputTimestamp('2026-09-08T02:00'), new Date('2026-09-08T02:00').toISOString());
  assert.deepEqual(model.sampleRecordsDraft({ assignedAt: '2026-09-08T02:00:00Z' }), { arrivedAt: '', startedAt: '', finishedAt: '', commercial: model.EMPTY_SAMPLE_CONDITIONS });
});

test('仅登记修改的实际字段，时间按用户输入发送且无自动结束', async () => {
  const f = fixture(); f.render(); assert.equal(button(f, '保存本轮登记').props.disabled, true);
  change(f, '实际开测时间', model.sampleLocalTime('2026-09-08T01:00:00Z'));
  submit(f); await settle(); f.render();
  assert.deepEqual(f.calls.writes, [['task-a', { roundId: 'round-a', baseUpdatedAt: '2026-09-08T03:00:00Z', startedAt: '2026-09-08T01:00:00.000Z' }]]);
  assert.equal(f.calls.saved.length, 1); assert.equal(f.calls.interaction.at(-1).dirty, false);
  assert.equal(field(f, '实际结束时间').props.value, '');
});

test('倒序时间与清空已登记时间在表单阻止，不发送保存', async () => {
  const f = fixture(); f.render(); change(f, '实际开测时间', model.sampleLocalTime('2026-09-07T01:00:00Z'));
  submit(f); await settle(); assert.match(text(f.render()), /不能早于到样/);
  change(f, '实际开测时间', ''); change(f, '实际到样时间', ''); submit(f); await settle();
  assert.match(text(f.render()), /不能清空/); assert.equal(f.calls.writes.length, 0);
});

test('保存同步锁防重复，处理中拒绝字段处理器，失败保留草稿并解锁', async () => {
  const pending = deferred(); const f = fixture({}, () => pending.promise); f.render();
  change(f, '付款条件', '验收后付款'); const before = field(f, '付款条件').props.value;
  const handler = all(f.render(), (node) => node.type === 'form')[0].props.onSubmit;
  handler({ preventDefault() {} }); handler({ preventDefault() {} }); f.render();
  assert.equal(f.calls.writes.length, 1); assert.equal(f.calls.interaction.at(-1).busy, true);
  change(f, '付款条件', '不应写入'); assert.equal(field(f, '付款条件').props.value, before);
  pending.reject(new Error('网络中断')); await settle(); f.render();
  assert.equal(field(f, '付款条件').props.value, before); assert.match(text(f.render()), /网络中断/);
  assert.equal(f.calls.interaction.at(-1).busy, false); assert.equal(button(f, '保存本轮登记').props.disabled, false);
});

test('原值恢复清除脏标记；同轮服务端刷新保留草稿但阻止覆盖直到明确载入', () => {
  const f = fixture(); f.render(); change(f, '付款条件', '条件'); change(f, '付款条件', '');
  assert.equal(f.calls.interaction.at(-1).dirty, false);
  change(f, '付款条件', '本地草稿');
  const next = makeDetail(); next.task.updatedAt = '2026-09-08T05:00:00Z'; next.sampleTest.commercial = { ...model.EMPTY_SAMPLE_CONDITIONS, paymentTerms: '他人保存' };
  f.setProps({ detail: next }); assert.equal(field(f, '付款条件').props.value, '本地草稿');
  assert.equal(button(f, '保存本轮登记').props.disabled, true);
  button(f, '放弃草稿并载入最新记录').props.onClick(); f.render();
  assert.equal(field(f, '付款条件').props.value, '他人保存'); assert.equal(f.calls.interaction.at(-1).dirty, false);
});

for (const variation of ['task', 'round', 'identity', 'unmount']) test(`${variation}变化丢弃迟到保存结果，不串回调，存活组件释放锁`, async () => {
  const pending = deferred(); const f = fixture({}, () => pending.promise); f.render(); change(f, '付款条件', '旧稿'); submit(f); f.render();
  if (variation === 'unmount') f.destroy();
  else { const next = makeDetail(); if (variation === 'task') next.task.id = 'task-b'; if (variation === 'round') next.sampleTest.roundId = 'round-b'; f.setProps({ detail: next, identity: variation === 'identity' ? 'user-b' : 'user-a' }); }
  pending.resolve({ ...makeDetail(), task: { ...makeDetail().task, updatedAt: '2026-09-08T04:00:00Z' } }); await settle();
  assert.equal(f.calls.saved.length, 0);
  if (variation !== 'unmount') { f.render(); assert.equal(field(f, '付款条件').props.value, ''); assert.equal(f.calls.interaction.at(-1).busy, false); }
});

test('研发不能修改到样也不渲染商业条件，采购不能代填测试；处理器同样检查权限', async () => {
  const rd = makeDetail(); rd.canRecordArrival = false; rd.canReadCommercial = false;
  const f = fixture({ detail: rd }); f.render(); assert.equal(field(f, '实际到样时间').props.disabled, true); assert.equal(field(f, '付款条件'), undefined);
  change(f, '实际到样时间', model.sampleLocalTime('2026-09-08T00:30:00Z')); submit(f); await settle();
  assert.equal(f.calls.writes.length, 0); assert.match(text(f.render()), /权限已变化/);
  const purchase = makeDetail(); purchase.canRecordTesting = false;
  const buyer = fixture({ detail: purchase }); buyer.render(); assert.equal(field(buyer, '实际开测时间').props.disabled, true);
});

test('结构化条件完整提交，不带供应商物料猜测或推导ETA，读取失败隐藏旧数据', async () => {
  const f = fixture(); f.render(); change(f, '报价计价单位', '元/套'); change(f, '含税口径', 'inclusive'); change(f, '税率', '13'); change(f, '付款条件', '验收后支付'); change(f, '交期起算', 'agreed_date'); change(f, '约定起算日期', '2026-09-09');
  submit(f); await settle(); f.render();
  assert.deepEqual(f.calls.writes[0][1].commercial, { ...model.EMPTY_SAMPLE_CONDITIONS, priceUnit: '元/套', taxBasis: 'inclusive', taxRate: 13, paymentTerms: '验收后支付', leadTimeStart: 'agreed_date', leadTimeStartDate: '2026-09-09' });
  assert.doesNotMatch(JSON.stringify(f.calls.writes), /supplierId|materialId|quotationId|expectedArrivalDate/);
  f.setProps({ unavailable: true, disabled: true }); assert.doesNotMatch(text(f.render()), /验收后支付|元\/套/);
});

test('历史按确切轮次显示，无重复当前轮次；研发即使接到字段也不渲染采购内容', () => {
  const d = makeDetail(); d.sampleTest.commercial = { ...model.EMPTY_SAMPLE_CONDITIONS, paymentTerms: '采购私密条件' };
  d.history = [{ ...d.sampleTest }, { ...d.sampleTest, roundId: 'old', archiveReason: 'reassigned', note: '旧轮次结论', result: 'failed_resample', revisions: [{ recordedAt: '2026-09-08T01:00:00Z', recordedByName: '采购乙', commercial: d.sampleTest.commercial }] }];
  const html = renderToStaticMarkup(React.createElement(history.SampleRoundHistory, { detail: d }));
  assert.match(html, /旧轮次结论/); assert.equal((html.match(/round-a/g) ?? []).length, 1); assert.match(html, /采购私密条件/);
  const rd = renderToStaticMarkup(React.createElement(history.SampleRoundHistory, { detail: { ...d, canReadCommercial: false } }));
  assert.doesNotMatch(rd, /采购私密条件/);
  const unavailable = renderToStaticMarkup(React.createElement(history.SampleRoundHistory, { detail: d, unavailable: true }));
  assert.doesNotMatch(unavailable, /采购私密条件|旧轮次结论/);
});
