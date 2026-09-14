import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = (file) => readFileSync(new URL(`../src/app/production/batch-archives/${file}`, import.meta.url), 'utf8');
const compile = (value) => ts.transpileModule(value, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const types = {}, model = {};
new Function('exports', compile(source('batchArchiveTypes.ts')))(types);
new Function('exports', 'require', compile(source('batchArchiveModel.ts')))(model, (name) => { assert.equal(name, './batchArchiveTypes'); return types; });
const code = compile(source('VersionEvidenceForm.tsx'));
const jsx = (type, props) => typeof type === 'function' ? type(props) : { type, props };
const components = new Proxy({}, { get: (_, name) => name });
const t = (value, params = {}) => value.replace(/\{(\w+)\}/g, (match, name) => params[name] ?? match);
const elements = (tree) => Array.isArray(tree) ? tree.flatMap(elements) : tree && typeof tree === 'object' ? [...(tree.type ? [tree] : []), ...Object.values(tree.props ?? {}).flatMap(elements)] : [];
const text = (tree) => Array.isArray(tree) ? tree.map(text).join(' ') : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : tree && typeof tree === 'object' ? text(tree.props?.children) : '';
const deferred = () => { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { resolve, promise }; };
const versions = { software: 'SW-1', hardware: '', bom: 'BOM-1', drawing: '', sop: '', sip: '' };
function initialState() {
  return {
    version: 1, revisions: [], batches: [{
      id: 'batch-a', batchNo: 'B-TEST-01', planNo: 'PLAN-01', productCode: 'P-01', productName: '测试设备', line: '装配一线', owner: '班组 A', startDate: '2026-09-01', plannedQty: 12,
      completedQty: 10, inspectionPassedQty: 8, releasedQty: 6, sourceLabel: '演示', sourceAt: '2026-09-11',
      versionScopes: [{ id: 'scope-a', name: '首批版本', quantity: 6, versions: { ...versions }, serialNumbers: ['SN-001'], evidenceIds: ['tech-a', 'tech-b'] }],
      serials: ['SN-001', 'SN-002', 'SN-003', 'SN-004', 'SN-005'].map((sn) => ({ sn, sourceDocumentId: 'tech-a' })),
      documents: ['tech-a', 'tech-b', 'tech-c'].map((id, i) => ({ id, code: `TECH-0${i + 1}`, kind: 'technical', date: '2026-09-01', title: `技术依据 ${i + 1}`, status: '已记录', tone: 'neutral', quantity: null, unit: '台', actor: '技术员', summary: '批次实际版本', facts: [], serialNumbers: [], relatedIds: [] })),
      materials: [],
    }],
  };
}
function fixture({ edit = false, submit, props: overrides = {} } = {}) {
  const slots = [], submissions = [], dirtyChanges = [], focused = [];
  let cursor = 0, effects = [], tree, cancelled = 0;
  const same = (a, b) => Boolean(a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i])));
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], (value) => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useEffect(callback, deps) { const i = cursor++, previous = slots[i]; if (!same(previous?.deps, deps)) effects.push(() => { previous?.cleanup?.(); slots[i] = { deps, cleanup: callback() }; }); },
  };
  const props = { state: initialState(), batchId: 'batch-a', ...(edit ? { scopeId: 'scope-a' } : {}), onSubmit: async (input) => { submissions.push(input); await submit?.(input); }, onDirtyChange: (value) => dirtyChanges.push(value), onCancel: () => { cancelled++; }, ...overrides };
  const dependencies = { react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' }, '../../lib/i18n': { useI18n: () => ({ t }), i18nLocale: () => 'zh-CN' }, '../../components/ui/utils': { cn: (...parts) => parts.filter(Boolean).join(' ') }, './batchArchiveTypes': types, './batchArchiveModel': model };
  const exports = {};
  new Function('exports', 'require', code)(exports, (name) => {
    if (name in dependencies) return dependencies[name];
    if (name.endsWith('.css')) return {};
    assert.ok(name === 'lucide-react' || name.startsWith('../../components/ui/'), `No external write dependency: ${name}`);
    return components;
  });
  const view = {
    props, submissions, dirtyChanges, focused, cancelled: () => cancelled,
    render() {
      const previousOpen = elements(tree).find((node) => node.type === 'AlertDialog')?.props.open;
      cursor = 0; effects = []; tree = exports.VersionEvidenceForm(props);
      const dom = (node) => node ? { focus() { focused.push(node.props.id ?? node.type); }, scrollIntoView() {}, querySelector(selector) { return dom(elements(tree).find((item) => `#${item.props?.id}` === selector)); } } : null;
      for (const node of elements(tree)) if (node.props?.ref) node.props.ref.current = dom(node);
      effects.forEach((job) => job()); effects = [];
      if (previousOpen && !view.node('AlertDialog').props.open) view.node('AlertDialogContent').props.onCloseAutoFocus({ preventDefault() {} });
      return tree;
    },
    async settle() { await new Promise((resolve) => setImmediate(resolve)); return view.render(); },
    unmount() { slots.forEach((slot) => slot?.cleanup?.()); },
    text: () => text(tree), nodes: () => elements(tree), node: (type) => elements(tree).find((node) => node.type === type),
    field: (name) => elements(tree).find((node) => node.props?.id === `version-evidence-${name}`),
    button: (label) => elements(tree).find((node) => ['Button', 'AlertDialogAction', 'AlertDialogCancel'].includes(node.type) && text(node).trim() === label),
    fill(name, value) { const node = view.field(name); assert.ok(node, `${name} exists`); assert.equal(Boolean(node.props.disabled), false); node.props.onChange({ target: { value } }); return view.render(); },
    addEvidence(id) { const node = view.node('Select'); assert.equal(Boolean(node.props.disabled), false); node.props.onValueChange(id); return view.render(); },
    removeEvidence(code) { const node = view.nodes().find((item) => item.props?.['aria-label'] === `移除依据 ${code}`); assert.ok(node); node.props.onClick(); return view.render(); },
    submit() { view.node('form').props.onSubmit({ preventDefault() {} }); return view.render(); },
    confirm() { const action = view.node('AlertDialogAction'); assert.equal(Boolean(action.props.disabled), false); action.props.onClick({ preventDefault() {} }); return view.render(); },
    cancelConfirmation() { view.node('AlertDialog').props.onOpenChange(false); return view.render(); },
    setProps(patch) { Object.assign(props, patch); return view.render(); },
  };
  view.render(); return view;
}
function fillValid(view) {
  if (!view.props.scopeId) { view.fill('name', ' 补充范围 '); view.fill('quantity', '4'); view.fill('software', ' SW-2 '); view.addEvidence('tech-a'); }
  else view.fill('bom', ' BOM-2 ');
  view.fill('actor', ' 质量员 A '); view.fill('reason', ' 核对本批次技术资料后补充。 ');
}

test('新增与修订均经确认提交真实模型，范围与历史保留且原状态不变', async () => {
  for (const edit of [false, true]) {
    let result; const view = fixture({ edit, submit: (input) => { result = model.applyVersionAmendment(view.props.state, view.props.batchId, 1, input, '2026-09-11T08:00:00.000Z'); } });
    fillValid(view); view.submit(); assert.equal(view.node('AlertDialog').props.open, true); assert.equal(view.submissions.length, 0);
    view.confirm(); await view.settle(); assert.equal(result.version, 2); assert.equal(result.revisions.length, 1);
    assert.equal(view.submissions[0].actor, '质量员 A'); assert.equal(view.submissions[0].reason, '核对本批次技术资料后补充。');
    assert.equal(view.dirtyChanges.at(-1), false); assert.match(view.text(), /版本依据已保存/);
    assert.equal(view.button('保存版本依据').props.disabled, true); assert.equal(view.props.state.revisions.length, 0);
    assert.equal(view.props.state.batches[0].versionScopes[0].versions.bom, 'BOM-1');
    assert.equal(result.batches[0].completedQty, 10); assert.equal(result.batches[0].releasedQty, 6);
  }
});

test('新增不预填操作人，必填错误关联控件并聚焦第一项', () => {
  const view = fixture(); assert.equal(view.field('actor').props.value, ''); view.submit();
  assert.equal(view.focused.at(-1), 'version-evidence-name'); assert.equal(view.field('name').props['aria-invalid'], true);
  assert.equal(view.field('name').props['aria-describedby'], 'version-evidence-name-error');
  view.fill('name', '范围'); assert.equal(view.field('name').props['aria-invalid'], false); view.submit(); assert.equal(view.focused.at(-1), 'version-evidence-quantity');
});

test('拒绝零数、小数、指数、非数、负数及超安全整数', () => {
  const view = fixture(); fillValid(view);
  for (const quantity of ['', '0', '-1', '0.5', '1.0', '1e1', 'NaN', 'Infinity', '9007199254740992']) {
    view.fill('quantity', quantity); view.submit(); assert.equal(view.node('AlertDialog').props.open, false, quantity); assert.equal(view.field('quantity').props['aria-invalid'], true, quantity);
  }
});

test('数量上限扣除其他范围，编辑不会重复扣除本范围', () => {
  const create = fixture(); fillValid(create); assert.match(create.text(), /本范围可覆盖\s+4/); create.fill('quantity', '5'); create.submit(); assert.match(create.text(), /最多可覆盖 4 台/);
  const edit = fixture({ edit: true }); fillValid(edit); assert.match(edit.text(), /本范围可覆盖\s+10/); edit.fill('quantity', '10'); edit.submit(); assert.equal(edit.node('AlertDialog').props.open, true);
});

test('部分核心版本可以保存并继续标记待确认，不会自动填最新版本', () => {
  const view = fixture(); fillValid(view); view.submit();
  assert.equal(view.node('AlertDialog').props.open, true); assert.match(view.text(), /仍待确认：硬件版本、BOM 版本/);
  assert.equal(view.field('hardware').props.value, ''); assert.equal(view.field('bom').props.value, '');
});

test('全部版本空白时不可保存，有实际 SOP 依据也允许单独补充', () => {
  const view = fixture(); fillValid(view); view.fill('software', ''); view.submit(); assert.equal(view.field('software').props['aria-invalid'], true); assert.match(view.text(), /至少填写一项/);
  view.fill('sop', 'SOP-2026'); view.submit(); assert.equal(view.node('AlertDialog').props.open, true);
});

test('版本和操作说明长度校验，隐藏的版本错误自动展开并聚焦', () => {
  const view = fixture(); fillValid(view); view.fill('drawing', '长'.repeat(81)); view.submit();
  assert.equal(view.nodes().filter((node) => node.type === 'details')[0].props.open, true); assert.equal(view.focused.at(-1), 'version-evidence-drawing');
  view.fill('drawing', 'A'); view.fill('reason', '长'.repeat(1001)); view.submit(); assert.equal(view.field('reason').props['aria-invalid'], true); assert.equal(view.field('reason').props.maxLength, 1000);
});

test('关联 SN 仅接受本批已知清单，错误自动展开并聚焦', () => {
  const view = fixture(); fillValid(view); view.fill('serialNumbers', 'UNKNOWN'); view.submit();
  assert.equal(view.nodes().filter((node) => node.type === 'details')[1].props.open, true); assert.equal(view.focused.at(-1), 'version-evidence-serialNumbers'); assert.match(view.text(), /只能关联本批次已有 SN/);
  view.fill('serialNumbers', ' SN-002 \n\n SN-003 '); view.submit(); assert.equal(view.node('AlertDialog').props.open, true); assert.match(text(view.node('AlertDialogContent')), /2\s+\/\s+2\s+台/);
});

test('拒绝大小写重复 SN、跨范围占用和超范围数量', () => {
  const view = fixture(); fillValid(view);
  for (const [value, error] of [['SN-002\nsn-002', /存在重复 SN/], ['SN-001', /已属于其他版本范围/]]) { view.fill('serialNumbers', value); view.submit(); assert.match(view.text(), error); }
  view.fill('quantity', '1'); view.fill('serialNumbers', 'SN-002\nSN-003'); view.submit(); assert.match(view.text(), /不得超过本范围数量/);
});

test('已有 SN 不强制补满，编辑时自己的 SN 可保留', () => {
  const view = fixture({ edit: true }); fillValid(view); view.submit(); assert.equal(view.node('AlertDialog').props.open, true); assert.match(text(view.node('AlertDialogContent')), /1\s+\/\s+5\s+台/);
});

test('多份依据可添加和移除，编辑保留原有依据，拒绝没有依据', () => {
  const view = fixture({ edit: true }); fillValid(view); assert.match(view.text(), /TECH-01/); assert.match(view.text(), /TECH-02/);
  view.addEvidence('tech-c'); view.submit(); assert.equal(view.node('AlertDialog').props.open, true); assert.match(text(view.node('AlertDialogContent')), /TECH-01、TECH-02、TECH-03/); view.cancelConfirmation();
  for (const code of ['TECH-01', 'TECH-02', 'TECH-03']) view.removeEvidence(code);
  view.submit(); assert.equal(view.field('evidenceIds').props['aria-invalid'], true); assert.match(view.text(), /至少一份现有单据/);
});

test('确认展示版本修改前后、数量、操作人及原因', () => {
  const view = fixture({ edit: true }); fillValid(view); view.submit(); const summary = text(view.node('AlertDialogContent'));
  assert.match(summary, /原记录/); assert.match(summary, /本次记录/); assert.match(summary, /BOM-1\s+BOM-2/); assert.match(summary, /质量员 A/); assert.match(summary, /核对本批次技术资料后补充/);
});

test('没有修改实际范围资料时不产生仅变更原因的空修订', () => {
  const view = fixture({ edit: true }); view.fill('actor', '质量员'); view.fill('reason', '误点保存'); view.submit(); assert.equal(view.node('AlertDialog').props.open, false); assert.equal(view.submissions.length, 0);
});

test('只读禁用输入与保存，取消保持可用', () => {
  const view = fixture({ props: { readOnly: true } }); assert.equal(view.field('name').props.disabled, true); assert.equal(view.button('保存版本依据').props.disabled, true);
  view.submit(); assert.equal(view.node('AlertDialog').props.open, false); view.button('取消填写').props.onClick(); assert.equal(view.cancelled(), 1);
});

test('确认期间变为只读会阻止保存并保留输入', () => {
  const view = fixture(); fillValid(view); view.submit(); view.setProps({ readOnly: true }); view.confirm();
  assert.equal(view.submissions.length, 0); assert.equal(view.node('AlertDialog').props.open, false); assert.equal(view.field('quantity').props.value, '4');
});

test('确认前或确认期间档案版本变化均拒绝过期操作', () => {
  for (const confirming of [false, true]) {
    const view = fixture(); fillValid(view); if (confirming) view.submit(); view.setProps({ state: { ...view.props.state, version: 2 } });
    if (confirming) view.confirm(); else view.submit();
    assert.equal(view.submissions.length, 0); assert.match(view.text(), /批次档案已变化/); assert.equal(view.field('quantity').props.value, '4');
  }
});

test('批次或范围切换而未重挂载时拒绝旧表单，保留原因', () => {
  for (const patch of [{ batchId: 'batch-b' }, { scopeId: 'scope-b' }]) {
    const view = fixture({ edit: true }); fillValid(view); view.setProps(patch); view.submit(); assert.equal(view.node('AlertDialog').props.open, false); assert.match(view.text(), /当前批次或版本范围已变化/); assert.ok(view.field('reason').props.value);
  }
});

test('同版本号但编辑范围被改变，也拒绝覆盖旧记录', () => {
  const view = fixture({ edit: true }); fillValid(view); view.submit(); view.props.state.batches[0].versionScopes[0].quantity = 5; view.render(); view.confirm();
  assert.equal(view.submissions.length, 0); assert.match(view.text(), /批次档案已变化/);
});

test('丢失批次或范围显示恢复说明，不允许提交', () => {
  for (const props of [{ batchId: 'missing' }, { scopeId: 'missing' }]) { const view = fixture({ props }); view.submit(); assert.equal(view.node('AlertDialog').props.open, false); assert.match(view.text(), /未找到/); }
});

test('保存失败保留全部字段和脏状态，重试成功才清除', async () => {
  let fail = true; const view = fixture({ submit: () => { if (fail) throw new Error('模拟保存失败，请重试'); } }); fillValid(view); view.fill('serialNumbers', 'SN-002'); view.submit(); view.confirm(); await view.settle();
  assert.equal(view.field('serialNumbers').props.value, 'SN-002'); assert.match(view.text(), /模拟保存失败/); assert.equal(view.dirtyChanges.at(-1), true);
  fail = false; view.submit(); view.confirm(); await view.settle(); assert.equal(view.submissions.length, 2); assert.equal(view.dirtyChanges.at(-1), false);
});

test('保存中同步防重复、禁用字段及关闭弹窗，成功不可再次提交', async () => {
  const pending = deferred(); const view = fixture({ submit: () => pending.promise }); fillValid(view); view.submit();
  const action = view.node('AlertDialogAction'); action.props.onClick({ preventDefault() {} }); action.props.onClick({ preventDefault() {} }); view.render();
  assert.equal(view.submissions.length, 1); assert.equal(view.field('name').props.disabled, true); assert.equal(view.node('form').props['aria-busy'], true);
  view.node('AlertDialog').props.onOpenChange(false); view.render(); assert.equal(view.node('AlertDialog').props.open, true); assert.equal(view.button('取消填写').props.disabled, true);
  pending.resolve(); await view.settle(); assert.equal(view.node('form').props['aria-busy'], false); view.submit(); assert.equal(view.submissions.length, 1);
});

test('卸载后的异步完成不回写父页面脏状态', async () => {
  const pending = deferred(); const view = fixture({ submit: () => pending.promise }); fillValid(view); view.submit(); view.confirm(); const count = view.dirtyChanges.length;
  view.unmount(); pending.resolve(); await new Promise((resolve) => setImmediate(resolve)); assert.equal(view.dirtyChanges.length, count);
});

test('取消确认保留填写和保存按钮焦点，填写还原时脏状态清除', () => {
  const view = fixture(); view.fill('name', '范围'); assert.equal(view.dirtyChanges.at(-1), true); view.fill('name', ''); assert.equal(view.dirtyChanges.at(-1), false);
  fillValid(view); view.submit(); view.cancelConfirmation(); assert.equal(view.focused.at(-1), 'Button'); assert.equal(view.field('quantity').props.value, '4');
  view.button('取消填写').props.onClick(); assert.equal(view.cancelled(), 1);
});
