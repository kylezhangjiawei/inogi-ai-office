import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = (file) => readFileSync(new URL(`../src/app/procurement/quality/${file}`, import.meta.url), 'utf8');
const compile = (value) => ts.transpileModule(value, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const types = {}, model = {};
new Function('exports', compile(source('qualityExceptionTypes.ts')))(types);
new Function('exports', compile(source('qualityExceptionPreviewModel.ts')))(model);
const code = compile(source('QualityExceptionActionForm.tsx'));
const jsx = (type, props) => typeof type === 'function' ? type(props) : { type, props };
const components = new Proxy({}, { get: (_, name) => name });
const t = (value, params = {}) => value.replace(/\{(\w+)\}/g, (match, name) => params[name] ?? match);
const elements = (tree) => Array.isArray(tree) ? tree.flatMap(elements) : tree && typeof tree === 'object' ? [...(tree.type ? [tree] : []), ...Object.values(tree.props ?? {}).flatMap(elements)] : [];
const text = (tree) => Array.isArray(tree) ? tree.map(text).join(' ') : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : tree && typeof tree === 'object' ? text(tree.props?.children) : '';
const deferred = () => { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { resolve, promise }; };
const baseIssue = {
  id: 'issue-one', version: 2, code: 'DEMO-NC-001', status: 'processing', source: 'incoming', discoveredDate: '2026-09-01',
  materialCode: 'VALVE-001', materialName: '阀体', category: '阀类', spec: 'A型', unit: '件', supplierName: '演示供应商',
  batchNo: 'LOT-001', orderNo: 'PO-001', receiptId: '', inspectedQty: 100, defectiveQty: 8, phenomenon: '尺寸偏差', evidence: '检验单 IQC-001',
  owner: '演示采购员', verifier: '演示质量员', dueDate: '2026-09-12', causeCategory: 'process', causeDetail: '已核对工艺偏差', responsibility: '人工确认责任说明', causeEvidence: '原因核对单 CA-001',
  dispositionMethod: 'repair', handledQty: 8, dispositionDetail: '返工已完成', dispositionEvidence: '返工单 RW-001',
  verificationRound: 1, verificationQty: 0, verificationResult: 'pending', verificationNote: '', verificationEvidence: '', closeNote: '', linkedFeedback: [],
};
function issueFor(kind) {
  if (kind === 'assign') return { ...baseIssue, status: 'unassigned', owner: '', verifier: '', dueDate: '' };
  if (kind === 'verify') return { ...baseIssue, status: 'awaiting_verification' };
  if (kind === 'close') return { ...baseIssue, status: 'awaiting_close', verificationQty: 8, verificationResult: 'passed', verificationNote: '全量复检通过', verificationEvidence: '复检单 RE-001' };
  return { ...baseIssue };
}

function fixture({ kind = 'cause', issue = issueFor(kind), submit, props: overrides = {} } = {}) {
  const slots = [], submissions = [], dirtyChanges = [], focused = [], scrolled = [];
  let cursor = 0, effects = [], tree, cancelled = 0;
  const same = (a, b) => Boolean(a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i])));
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], (value) => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useEffect(callback, deps) { const i = cursor++, previous = slots[i]; if (!same(previous?.deps, deps)) effects.push(() => { previous?.cleanup?.(); slots[i] = { deps, cleanup: callback() }; }); },
  };
  const props = { issue, kind, onSubmit: async (input) => { submissions.push(input); await submit?.(input); }, onDirtyChange: (dirty) => dirtyChanges.push(dirty), onCancel: () => { cancelled++; }, ...overrides };
  const dependencies = { react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' }, '../../lib/i18n': { useI18n: () => ({ t }), i18nLocale: () => 'zh-CN' }, '../../components/ui/utils': { cn: (...parts) => parts.filter(Boolean).join(' ') }, './qualityExceptionTypes': types, './qualityExceptionPreviewModel': model };
  const exports = {};
  new Function('exports', 'require', code)(exports, (name) => {
    if (name in dependencies) return dependencies[name];
    if (name.endsWith('.css')) return {};
    assert.ok(name === 'lucide-react' || name.startsWith('../../components/ui/'), `No external write dependency: ${name}`);
    return components;
  });
  const view = {
    props, submissions, dirtyChanges, focused, scrolled, cancelled: () => cancelled,
    render() {
      const previousOpen = elements(tree).find((node) => node.type === 'AlertDialog')?.props.open;
      cursor = 0; effects = []; tree = exports.QualityExceptionActionForm(props);
      const dom = (node) => node ? { focus() { focused.push(node.props.id ?? node.type); }, scrollIntoView(options) { scrolled.push({ id: node.props.id, options }); }, querySelector(selector) { return dom(elements(tree).find((item) => `#${item.props?.id}` === selector)); } } : null;
      for (const node of elements(tree)) if (node.props?.ref) node.props.ref.current = dom(node);
      effects.forEach((job) => job()); effects = [];
      if (previousOpen && !view.node('AlertDialog').props.open) view.node('AlertDialogContent').props.onCloseAutoFocus({ preventDefault() {} });
      return tree;
    },
    async settle() { await new Promise((resolve) => setImmediate(resolve)); return view.render(); },
    unmount() { slots.forEach((slot) => slot?.cleanup?.()); },
    text: () => text(tree), nodes: () => elements(tree), node: (type) => elements(tree).find((node) => node.type === type),
    field: (name) => elements(tree).find((node) => node.props?.id === `quality-action-${name}`),
    button: (label) => elements(tree).find((node) => ['Button', 'AlertDialogAction', 'AlertDialogCancel'].includes(node.type) && text(node).trim() === label),
    fill(name, value) { const node = view.field(name); assert.ok(node, `${name} exists`); assert.equal(Boolean(node.props.disabled), false); node.props.onChange({ target: { value } }); return view.render(); },
    choose(name, value) { const node = view.nodes().find((item) => item.type === 'Select' && elements(item).some((child) => child.props?.id === `quality-action-${name}`)); assert.ok(node, `${name} selectable`); assert.equal(Boolean(node.props.disabled), false); node.props.onValueChange(value); return view.render(); },
    submit() { view.node('form').props.onSubmit({ preventDefault() {} }); return view.render(); },
    confirm() { const action = view.button('确认保存演示记录'); assert.ok(action); assert.equal(Boolean(action.props.disabled), false); action.props.onClick({ preventDefault() {} }); return view.render(); },
    cancelConfirmation() { view.node('AlertDialog').props.onOpenChange(false); return view.render(); },
    setProps(patch) { Object.assign(props, patch); return view.render(); },
  };
  view.render(); return view;
}

function fillValid(view) {
  switch (view.props.kind) {
    case 'assign': view.choose('owner', '演示采购员'); view.choose('verifier', '演示质量员'); view.fill('dueDate', '2026-09-12'); view.fill('note', ' 核对批次后分派跟进。 '); break;
    case 'cause': view.choose('category', 'process'); view.fill('detail', ' 人工核对工艺偏差。 '); view.fill('responsibility', ' 经授权人工确认的责任说明。 '); view.fill('evidence', ' 原因核对单 CA-002 '); break;
    case 'disposition': view.choose('method', 'repair'); view.fill('handledQty', String(view.props.issue.defectiveQty)); view.fill('detail', ' 本批返工已全部完成。 '); view.fill('evidence', ' 返工完成单 RW-002 '); break;
    case 'verify': view.fill('quantity', String(view.props.issue.defectiveQty)); view.choose('result', 'passed'); view.fill('note', ' 全量尺寸复检通过。 '); view.fill('evidence', ' 复检单 RE-002 '); break;
    case 'feedback': view.choose('source', 'production'); view.fill('reference', ' PR-002 '); view.fill('note', ' 关联生产反馈，数量不再重复计入。 '); break;
    default: view.fill('note', view.props.kind === 'close' ? ' 核对全部记录后关闭。 ' : ' 处置完成，提交全量复检。 ');
  }
}

test('七种操作都先核对确认，再提交准确的动作字段，成功清除dirty并显示结果', async () => {
  const fields = { assign: ['dueDate', 'kind', 'note', 'owner', 'verifier'], cause: ['category', 'detail', 'evidence', 'kind', 'responsibility'], disposition: ['detail', 'evidence', 'handledQty', 'kind', 'method'], submit_verification: ['kind', 'note'], verify: ['evidence', 'kind', 'note', 'quantity', 'result'], close: ['kind', 'note'], feedback: ['kind', 'note', 'reference', 'source'] };
  for (const kind of Object.keys(types.qualityActionLabels)) {
    const view = fixture({ kind }); fillValid(view); view.submit();
    assert.equal(view.node('AlertDialog').props.open, true, kind); assert.equal(view.submissions.length, 0);
    assert.match(text(view.node('AlertDialogContent')), /DEMO-NC-001.*阀体/); assert.match(text(view.node('AlertDialogContent')), /LOT-001/);
    view.confirm(); await view.settle(); assert.equal(view.submissions.length, 1); assert.deepEqual(Object.keys(view.submissions[0]).sort(), fields[kind]);
    for (const value of Object.values(view.submissions[0])) if (typeof value === 'string') assert.equal(value, value.trim());
    assert.equal(view.node('AlertDialog').props.open, false); assert.equal(view.dirtyChanges.at(-1), false); assert.match(view.text(), /演示记录已保存/);
  }
});

test('分派必须选择演示经办与验证人，日期不早于发现日，且明确经办不代表责任', () => {
  const view = fixture({ kind: 'assign' }); view.submit(); assert.equal(view.focused.at(-1), 'quality-action-owner');
  assert.match(view.text(), /经办分派不代表责任认定/); fillValid(view);
  for (const date of ['', '2026-02-30', '2026-08-31', '0000-01-01']) { view.fill('dueDate', date); view.submit(); assert.equal(view.field('dueDate').props['aria-invalid'], true); }
  view.fill('dueDate', '2026-09-01'); view.choose('owner', '任意外部人员'); view.submit(); assert.equal(view.field('owner').props['aria-invalid'], true);
  view.choose('owner', '演示采购员'); view.choose('verifier', ''); view.submit(); assert.equal(view.field('verifier').props['aria-invalid'], true);
  view.choose('verifier', '演示质量员'); view.fill('note', ' '); view.submit(); assert.equal(view.field('note').props['aria-invalid'], true);
  view.fill('note', '核对后分派'); view.submit(); assert.equal(view.node('AlertDialog').props.open, true);
});

test('原因必须选合法类别并填原因、责任及证据，依据为文字而不是假附件', () => {
  const view = fixture({ kind: 'cause' }); fillValid(view);
  for (const field of ['detail', 'responsibility', 'evidence']) { const old = view.field(field).props.value; view.fill(field, ' '); view.submit(); assert.equal(view.field(field).props['aria-invalid'], true); view.fill(field, old); }
  view.choose('category', 'not-a-category'); view.submit(); assert.equal(view.field('category').props['aria-invalid'], true);
  assert.match(view.text(), /文字说明或关联单据号，不提供附件上传/); assert.equal(view.nodes().some((node) => node.props?.type === 'file'), false);
});

test('累计处置数量拒绝零、负数、指数、超精度、非数和超大数，也不能倒减或超不良量', () => {
  const view = fixture({ kind: 'disposition', issue: { ...baseIssue, handledQty: 2.125, defectiveQty: 8.125 } }); fillValid(view);
  for (const value of ['0', '-1', '1e0', '2.1251', '', 'NaN', 'Infinity', '999999999999999999999999', '2.124', '8.126']) {
    view.fill('handledQty', value); view.submit(); assert.equal(view.node('AlertDialog').props.open, false, value); assert.equal(view.field('handledQty').props['aria-invalid'], true, value);
  }
  view.fill('handledQty', '2.125'); view.submit(); assert.equal(view.node('AlertDialog').props.open, true); view.cancelConfirmation();
  view.fill('handledQty', '8.125'); view.submit(); assert.equal(view.node('AlertDialog').props.open, true);
  assert.match(view.text(), /退换货计划不等同于已经完成处置/);
});

test('复检通过必须全量；不通过可登记实际复检数量并由模型返回处理中', async () => {
  let updated; const current = issueFor('verify');
  const view = fixture({ kind: 'verify', issue: current, submit: (input) => { updated = model.applyQualityAction({ issues: [current], records: [] }, current.id, current.version, input, '2026-09-10T04:00:00Z'); } }); fillValid(view);
  view.fill('quantity', '7'); view.submit(); assert.equal(view.field('quantity').props['aria-invalid'], true); assert.match(view.text(), /通过复检须覆盖全部不良数量/);
  view.choose('result', 'failed'); view.submit(); view.confirm(); await view.settle();
  assert.equal(updated.issues[0].status, 'processing'); assert.equal(updated.issues[0].verificationQty, 7); assert.equal(updated.issues[0].verificationResult, 'failed');
  const passed = fixture({ kind: 'verify', submit: (input) => { updated = model.applyQualityAction({ issues: [current], records: [] }, current.id, current.version, input, '2026-09-10T04:00:00Z'); } }); fillValid(passed); passed.submit(); passed.confirm(); await passed.settle(); assert.equal(updated.issues[0].status, 'awaiting_close');
});

test('复检拒绝非法数量和未选结果，证据及结论均必填', () => {
  const view = fixture({ kind: 'verify' }); fillValid(view);
  for (const value of ['0', '-1', '8.001', '1e0', '0.0001', 'NaN', '']) { view.fill('quantity', value); view.submit(); assert.equal(view.field('quantity').props['aria-invalid'], true, value); }
  view.fill('quantity', '8'); view.choose('result', 'unknown'); view.submit(); assert.equal(view.field('result').props['aria-invalid'], true);
  view.choose('result', 'passed'); view.fill('note', ''); view.fill('evidence', ''); view.submit(); assert.equal(view.field('note').props['aria-invalid'], true); assert.equal(view.field('evidence').props['aria-invalid'], true);
});

test('提交复检只读呈现前置条件，缺经办、原因、处置或上轮未通过均不能越过', () => {
  for (const patch of [{ owner: '' }, { causeEvidence: '' }, { dispositionEvidence: '' }, { handledQty: 7 }, { verificationResult: 'failed' }]) {
    const view = fixture({ kind: 'submit_verification', issue: { ...baseIssue, ...patch } });
    assert.equal(view.button('保存演示记录').props.disabled, true); assert.match(view.text(), /暂不能保存此操作/); view.fill('note', '请求复检'); view.submit(); assert.equal(view.node('AlertDialog').props.open, false); assert.equal(view.submissions.length, 0);
  }
  const ready = fixture({ kind: 'submit_verification' }); assert.match(ready.text(), /全部不良数量已完成处置/); fillValid(ready); ready.submit(); assert.equal(ready.node('AlertDialog').props.open, true);
});

test('关闭必须核对当前原因、处置、全量通过的复检与证据，缺一项不能保存', () => {
  for (const patch of [{ causeDetail: '' }, { dispositionEvidence: '' }, { verificationQty: 7 }, { verificationResult: 'failed' }, { verificationEvidence: '' }, { verificationRound: 0 }]) {
    const view = fixture({ kind: 'close', issue: { ...issueFor('close'), ...patch } }); fillValid(view); view.submit(); assert.equal(view.button('保存演示记录').props.disabled, true); assert.equal(view.node('AlertDialog').props.open, false);
  }
  const ready = fixture({ kind: 'close' }); assert.match(ready.text(), /当前原因、处置及复检依据已填写，全量复检通过/); ready.submit(); assert.equal(ready.field('note').props['aria-invalid'], true);
});

test('反馈只提交来源、单据号和说明，不增加不良数量', async () => {
  let updated; const view = fixture({ kind: 'feedback', submit: (input) => { updated = model.applyQualityAction({ issues: [baseIssue], records: [] }, baseIssue.id, baseIssue.version, input, '2026-09-10T04:00:00Z'); } });
  assert.equal(view.field('quantity'), undefined); assert.equal(view.field('handledQty'), undefined); assert.match(view.text(), /不增加异常的不良数量/);
  fillValid(view); view.submit(); view.confirm(); await view.settle(); assert.equal(updated.issues[0].defectiveQty, 8); assert.equal(updated.issues[0].linkedFeedback.length, 1); assert.equal(updated.issues[0].linkedFeedback[0].reference, 'PR-002');
});

test('每个动作只显示相关字段，提交时检查2000字符与单据号120字符上限', () => {
  const visible = { assign: ['owner', 'verifier', 'dueDate', 'note'], cause: ['category', 'detail', 'responsibility', 'evidence'], disposition: ['method', 'handledQty', 'detail', 'evidence'], submit_verification: ['note'], verify: ['quantity', 'result', 'note', 'evidence'], close: ['note'], feedback: ['source', 'reference', 'note'] };
  for (const kind of Object.keys(visible)) {
    const view = fixture({ kind }); fillValid(view);
    assert.deepEqual(view.nodes().filter((node) => ['Input', 'Textarea', 'SelectTrigger'].includes(node.type)).map((node) => node.props.id.replace('quality-action-', '')).sort(), [...visible[kind]].sort());
    for (const field of visible[kind].filter((name) => ['detail', 'responsibility', 'evidence', 'note', 'reference'].includes(name))) {
      const old = view.field(field).props.value, limit = field === 'reference' ? 120 : 2000;
      view.fill(field, '长'.repeat(limit + 1)); view.submit(); assert.equal(view.field(field).props['aria-invalid'], true); view.fill(field, old);
    }
  }
});

test('点击保存才聚焦首个无效字段，输入时不打断焦点', () => {
  const view = fixture({ kind: 'assign' }); assert.equal(view.focused.length, 0); view.submit(); assert.equal(view.focused.at(-1), 'quality-action-owner');
  const count = view.focused.length; view.choose('owner', '演示采购员'); assert.equal(view.focused.length, count); view.submit(); assert.equal(view.focused.at(-1), 'quality-action-verifier');
  assert.match(view.field('verifier').props['aria-describedby'], /verifier-error/); assert.equal(view.scrolled.at(-1).id, 'quality-action-verifier');
});

test('取消确认保留草稿、恢复保存按钮焦点，取消填写交父级处理dirty', () => {
  const view = fixture(); assert.equal(view.dirtyChanges.at(-1), false); fillValid(view); assert.equal(view.dirtyChanges.at(-1), true); view.submit(); view.cancelConfirmation();
  assert.equal(view.field('detail').props.value, ' 人工核对工艺偏差。 '); assert.equal(view.submissions.length, 0); assert.equal(view.focused.at(-1), 'Button');
  view.button('取消填写').props.onClick(); assert.equal(view.cancelled(), 1); assert.equal(view.dirtyChanges.at(-1), true);
});

test('确认保存同步防双击，保存期间不能改字段、取消或用Escape关确认', async () => {
  const pending = deferred(), view = fixture({ submit: () => pending.promise }); fillValid(view); view.submit();
  const action = view.button('确认保存演示记录').props.onClick; action({ preventDefault() {} }); action({ preventDefault() {} }); view.render();
  assert.equal(view.submissions.length, 1); assert.equal(view.field('detail').props.disabled, true); assert.equal(view.button('取消填写').props.disabled, true); assert.equal(view.node('form').props['aria-busy'], true);
  view.node('AlertDialog').props.onOpenChange(false); view.render(); assert.equal(view.node('AlertDialog').props.open, true);
  let prevented = false; view.node('AlertDialogContent').props.onEscapeKeyDown({ preventDefault() { prevented = true; } }); assert.equal(prevented, true);
  pending.resolve(); await view.settle(); assert.equal(view.node('form').props['aria-busy'], false); assert.equal(view.dirtyChanges.at(-1), false);
});

test('保存失败保留草稿和dirty，在表单就近报错且可以重试', async () => {
  let fail = true; const view = fixture({ submit: () => { if (fail) throw new Error('演示保存失败，请重试。'); } }); fillValid(view); view.submit(); view.confirm(); await view.settle();
  assert.match(view.text(), /演示保存失败，请重试/); assert.equal(view.field('evidence').props.value, ' 原因核对单 CA-002 '); assert.equal(view.dirtyChanges.at(-1), true); assert.equal(view.node('AlertDialog').props.open, false);
  fail = false; view.submit(); view.confirm(); await view.settle(); assert.equal(view.submissions.length, 2); assert.equal(view.dirtyChanges.at(-1), false);
});

test('确认期间异常版本变化必须重新核对，保留填写且不提交旧确认', () => {
  const view = fixture(); fillValid(view); view.submit(); view.setProps({ issue: { ...baseIssue, version: 3 } }); view.confirm();
  assert.equal(view.submissions.length, 0); assert.equal(view.node('AlertDialog').props.open, false); assert.match(view.text(), /异常记录或填写内容已变化/); assert.equal(view.field('evidence').props.value, ' 原因核对单 CA-002 ');
});

test('确认时重新校验最新数量和关闭前置，先关弹框再聚焦无效字段', () => {
  const view = fixture({ kind: 'disposition', issue: { ...baseIssue, handledQty: 0 } }); fillValid(view); view.submit(); view.setProps({ issue: { ...baseIssue, defectiveQty: 5, handledQty: 0 } }); view.confirm();
  assert.equal(view.submissions.length, 0); assert.equal(view.node('AlertDialog').props.open, false); assert.equal(view.focused.at(-1), 'quality-action-handledQty');
  const close = fixture({ kind: 'close' }); fillValid(close); close.submit(); close.setProps({ issue: { ...issueFor('close'), verificationEvidence: '' } }); close.confirm(); assert.equal(close.submissions.length, 0); assert.equal(close.node('AlertDialog').props.open, false);
});

test('状态不允许、异常切换或动作切换不能把旧草稿写入新的异常', () => {
  const closed = fixture({ issue: { ...baseIssue, status: 'closed' } }); fillValid(closed); closed.submit(); assert.equal(closed.node('AlertDialog').props.open, false);
  for (const patch of [{ issue: { ...baseIssue, id: 'another-issue' } }, { kind: 'disposition' }]) {
    const view = fixture(); fillValid(view); view.submit(); view.setProps(patch); view.confirm(); assert.equal(view.submissions.length, 0); assert.equal(view.node('AlertDialog').props.open, false); assert.match(view.text(), /当前异常或操作已变化/);
  }
});

test('表单卸载后的旧保存结果不清除其他表单的dirty状态', async () => {
  const pending = deferred(), view = fixture({ submit: () => pending.promise }); fillValid(view); view.submit(); view.confirm();
  const count = view.dirtyChanges.length; view.unmount(); pending.resolve(); await new Promise((resolve) => setImmediate(resolve)); assert.equal(view.dirtyChanges.length, count);
});
