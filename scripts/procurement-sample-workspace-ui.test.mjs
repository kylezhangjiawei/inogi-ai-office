import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import ts from 'typescript';

function loadModule(path, dependencies = {}, globals = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function('exports', 'require', ...Object.keys(globals), compiled)(exports, (id) => {
    if (/\/ui\/(?:button|input|native-select|textarea|checkbox|radio-group|slider)$/.test(id)) return { Button: "Button", Input: "Input", NativeSelect: "NativeSelect", Textarea: "Textarea", Checkbox: "Checkbox", RadioGroup: "RadioGroup", RadioGroupItem: "RadioGroupItem", Slider: "Slider" };

    assert.ok(id in dependencies, `Unexpected dependency ${id} in ${path}`);
    return dependencies[id];
  }, ...Object.values(globals));
  return exports;
}

const sampleFacts = loadModule('src/app/lib/procSampleFacts.ts');
const sampleModel = loadModule('src/app/procurement/sampleWorkspaceModel.ts', { '../lib/procSampleFacts': sampleFacts });
const translate = (value, params = {}) => value.replace(/\{(\w+)\}/g, (match, key) => params[key] ?? match);
const primitives = new Proxy({}, { get: (_target, key) => key });
const statuses = Object.fromEntries(['pending_confirm', 'pending_sample', 'testing', 'priced', 'cancelled'].map((status) => [status, { label: status, pill: '' }]));

function sample(id, extra = {}) {
  return {
    id, code: `PROC-${id}`, materialName: `样品 ${id}`, spec: `规格 ${id}`, status: 'pending_sample',
    quantity: 3, unit: '件', needSample: true, sampleTest: null, buyer: `采购 ${id}`,
    purchaseOrders: [{ supplierName: `供应商 ${id}` }], attachmentList: [], logs: [],
    updatedAt: '2026-09-09T01:00:00Z', ...extra,
  };
}

// Execute the real workspace and filtering/fact logic. Hooks retain state and run effect cleanup;
// child forms and visual primitives are boundaries (the form has its own independent behavior tests).
function fixture(props = {}, { width = 1200, deferSelection = false } = {}) {
  const slots = []; const effects = [];
  const calls = { selections: [], interactions: [], refreshes: 0, focuses: [], scrolls: [] };
  const workspaceElement = { clientWidth: width };
  const nativeElements = new Map();
  const sampleButtonElements = new Map();
  let committedRefs = new Set();
  let activeElement = null;
  function createNativeElement() {
    return {
      isConnected: true,
      focus(options) { activeElement = this; calls.focuses.push({ element: this, options }); },
      scrollIntoView(options) { calls.scrolls.push({ element: this, options }); },
    };
  }
  function elementFor(node) {
    assert.equal(node.type, "Button");
    assert.notEqual(node.key, null, 'sample button must have a stable identity');
    let element = sampleButtonElements.get(node.key);
    if (!element) { element = createNativeElement(); sampleButtonElements.set(node.key, element); }
    element.props = node.props;
    element.isConnected = true;
    return element;
  }
  function commitNativeRefs(tree) {
    const nextRefs = new Set();
    for (const element of sampleButtonElements.values()) element.isConnected = false;
    for (const node of all(tree, (item) => item.type === "Button" && item.props['aria-pressed'] !== undefined)) elementFor(node);
    for (const node of all(tree, (item) => typeof item.type === 'string' && /^[a-z]/.test(item.type) && item.ref && typeof item.ref === 'object')) {
      const ref = node.ref;
      nextRefs.add(ref);
      let element = nativeElements.get(ref);
      if (!element) {
        element = node === tree ? workspaceElement : createNativeElement();
        nativeElements.set(ref, element);
      }
      element.props = node.props;
      ref.current = element;
    }
    for (const ref of committedRefs) if (!nextRefs.has(ref)) ref.current = null;
    committedRefs = nextRefs;
  }
  const observers = [];
  class MockResizeObserver {
    constructor(callback) { this.callback = callback; this.target = null; this.disconnected = false; observers.push(this); }
    observe(target) { this.target = target; this.callback([{ target, contentRect: { width: workspaceElement.clientWidth } }]); }
    disconnect() { this.disconnected = true; }
  }
  let cursor = 0; let dirty = false; let destroyed = false;
  let input = { tasks: [], loading: false, error: null, selectedId: null, ...props };
  const depsChanged = (before, after) => !before || after.some((value, index) => !Object.is(value, before[index]));
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], (value) => {
        const next = typeof value === 'function' ? value(slots[index]) : value;
        if (!Object.is(slots[index], next)) { slots[index] = next; dirty = true; }
      }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useMemo(callback, deps) {
      const index = cursor++;
      if (depsChanged(slots[index]?.deps, deps)) slots[index] = { deps, value: callback() };
      return slots[index].value;
    },
    useCallback(callback, deps) { return hooks.useMemo(() => callback, deps); },
    useEffect(callback, deps) {
      const index = cursor++; const previous = slots[index];
      if (depsChanged(previous?.deps, deps)) {
        const next = { deps, cleanup: undefined }; slots[index] = next;
        effects.push(() => { previous?.cleanup?.(); next.cleanup = callback(); });
      }
    },
  };
  const { ProcurementSampleWorkspace } = loadModule('src/app/procurement/components/ProcurementSampleWorkspace.tsx', {
    react: hooks, 'react/jsx-runtime': jsxRuntime, 'lucide-react': primitives,
    '../../components/ui/button': primitives, '../../components/ui/input': primitives,
    '../../components/ui/toggle-group': primitives, '../../components/ui/collapsible': primitives,
    '../../components/ui/alert-dialog': primitives,
    '../../components/ui/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
    '../../lib/i18n': { useI18n: () => ({ t: translate }), i18nLocale: () => 'zh-CN' },
    '../../lib/procSampleFacts': sampleFacts, '../sampleWorkspaceModel': sampleModel,
    '../data': { refreshProcurement: async () => { calls.refreshes += 1; } },
    './common': { PROC_STATUS_META: statuses, PersonAvatar: 'PersonAvatar', useProcCan: () => () => false },
    './taskActions': { nextPermissionOf: () => null, useProcTaskAction: () => ({ busy: false, modal: null }) },
    './ProcSampleTestDialog': { ProcSampleTestDialog: 'ProcSampleTestDialog' },
    './TaskDetailDrawer': { TaskDetailDrawer: 'TaskDetailDrawer' },
    '../sampleWorkspace.css': {},
    '../samples/SampleCommercialSummary': { SampleCommercialSummary: 'SampleCommercialSummary' },
  }, { ResizeObserver: MockResizeObserver });
  const onSelect = (id) => {
    calls.selections.push(id);
    // The production parent reflects selection in its route. Keep that controlled contract here.
    if (!deferSelection) {
      input = { ...input, selectedId: id };
      dirty = true;
    }
  };
  const onInteractionStateChange = (state) => calls.interactions.push(state);
  return {
    calls, observers, elementFor,
    get activeElement() { return activeElement; },
    render() {
      assert.equal(destroyed, false, 'cannot render an unmounted workspace');
      for (let iteration = 0; iteration < 20; iteration++) {
        cursor = 0; dirty = false;
        const tree = ProcurementSampleWorkspace({ ...input, onSelect, onInteractionStateChange });
        // Only native elements receive DOM refs. Plain component refs cannot stand in for real nodes.
        commitNativeRefs(tree);
        while (effects.length) effects.shift()();
        if (!dirty) return tree;
      }
      assert.fail('workspace failed to settle');
    },
    setProps(next) { input = { ...input, ...next }; return this.render(); },
    resize(nextWidth) {
      workspaceElement.clientWidth = nextWidth;
      for (const observer of observers) {
        if (!observer.disconnected && observer.target) observer.callback([{ target: observer.target, contentRect: { width: nextWidth } }]);
      }
      return this.render();
    },
    destroy() { destroyed = true; for (const slot of slots) slot?.cleanup?.(); },
  };
}

function all(tree, predicate, output = []) {
  if (!tree || typeof tree !== 'object') return output;
  if (predicate(tree)) output.push(tree);
  for (const child of React.Children.toArray(tree.props?.children)) all(child, predicate, output);
  return output;
}
function find(tree, predicate) { return all(tree, predicate)[0]; }
function text(tree) {
  if (tree == null || typeof tree === 'boolean') return '';
  if (typeof tree !== 'object') return String(tree);
  return React.Children.toArray(tree.props?.children).map(text).join(' ');
}
function form(f) { return find(f.render(), (node) => node.type === 'ProcSampleTestDialog'); }
function selectionDialog(f) { return find(f.render(), (node) => node.type === 'AlertDialog'); }
function closeSelectionFocus(f) {
  const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  find(f.render(), (node) => node.type === 'AlertDialogContent').props.onCloseAutoFocus?.(event);
  return event;
}
function listDisclosure(f) { return find(f.render(), (node) => node.type === 'Collapsible' && node.props.asChild && find(node, (child) => child.type === 'aside' && child.props['aria-label'] === '全部样品')); }
function taskButton(f, id) { return find(f.render(), (node) => node.type === "Button" && node.props['aria-pressed'] !== undefined && text(node).includes(`PROC-${id}`)); }
function button(f, label) { return find(f.render(), (node) => node.type === 'Button' && text(node).trim() === label); }
function select(f, id) { const item = taskButton(f, id); assert.ok(item, `sample ${id} must be listed`); item.props.onClick({ currentTarget: f.elementFor(item) }); f.render(); }
function reportInteraction(f, state) { form(f).props.onInteractionStateChange(state); f.render(); }
function search(f, query) {
  find(f.render(), (node) => node.type === 'Input' && node.props['aria-label'] === '搜索样品').props.onChange({ target: { value: query } });
  f.render();
}

function assertUniqueSiblingKeys(tree, path = 'root') {
  if (!React.isValidElement(tree)) return 0;
  let checked = 0;
  function inspect(children, scope) {
    const siblings = Array.isArray(children) ? children : [children];
    const keys = new Set();
    for (const [index, child] of siblings.entries()) {
      if (Array.isArray(child)) { inspect(child, `${scope}[${index}]`); continue; }
      if (!React.isValidElement(child)) continue;
      // Inspect original elements: Children.toArray synthesizes keys and can conceal their original scope.
      if (child.key !== null && child.key !== '') {
        checked += 1;
        assert.equal(keys.has(child.key), false, `duplicate sibling key ${child.key} in ${scope}`);
        keys.add(child.key);
      }
      checked += assertUniqueSiblingKeys(child, `${scope}/${typeof child.type === 'string' ? child.type : child.type.name || 'fragment'}[${index}]`);
    }
  }
  inspect(tree.props.children, path);
  return checked;
}

test('异步加载首次固定真实样品，后台插入、重排与同任务更新均不切换表单', () => {
  const a = sample('A'); const b = sample('B');
  const f = fixture({ loading: true });
  assert.equal(form(f), undefined);
  f.setProps({ tasks: [sample('ordinary', { needSample: false, purchaseOrders: [] })], loading: false });
  assert.equal(form(f), undefined);
  f.setProps({ tasks: [a, b] });
  assert.equal(form(f).props.taskId, 'A');
  const key = form(f).key;
  const revision = form(f).props.revision;
  reportInteraction(f, { dirty: true, busy: false });
  const updatedA = { ...a, updatedAt: '2026-09-09T02:00:00Z' };
  f.setProps({ tasks: [sample('C'), b, updatedA] });
  assert.equal(form(f).props.taskId, 'A');
  assert.notEqual(form(f).props.revision, revision, 'updated task must refresh detail without remounting the form');
  assert.equal(form(f).key, key, 'the existing form must retain its component identity');
  assert.equal(selectionDialog(f).props.open, false);
  assert.deepEqual(f.calls.selections, []);
});

test('初始选中样品消失时显示不可用，不能自动跳到剩余首项或新样品', () => {
  const a = sample('A'); const b = sample('B');
  const f = fixture({ tasks: [a, b] });
  assert.equal(form(f).props.taskId, 'A');
  f.setProps({ tasks: [b] });
  assert.equal(form(f), undefined);
  assert.match(text(f.render()), /此样品暂不可用/);
  f.setProps({ tasks: [sample('C'), b] });
  assert.equal(form(f), undefined);
  assert.deepEqual(f.calls.selections, []);
  f.setProps({ tasks: [b, a] });
  assert.equal(form(f).props.taskId, 'A');
});

test('显式选中 ID 优先于列表默认值，不存在的显式 ID 不回退到别的样品', () => {
  const f = fixture({ tasks: [sample('A'), sample('B')], selectedId: 'B' });
  assert.equal(form(f).props.taskId, 'B');
  f.setProps({ tasks: [sample('C'), sample('A'), sample('B')] });
  assert.equal(form(f).props.taskId, 'B');
  f.setProps({ selectedId: 'not-available' });
  assert.equal(form(f), undefined);
  assert.match(text(f.render()), /此样品暂不可用/);
  assert.deepEqual(f.calls.selections, []);
});

test('干净表单手动切换直接通知父级，重复选择当前样品不额外发出通知', () => {
  const f = fixture({ tasks: [sample('A'), sample('B')] });
  select(f, 'A');
  assert.deepEqual(f.calls.selections, []);
  select(f, 'B');
  assert.deepEqual(f.calls.selections, ['B']);
  assert.equal(form(f).props.taskId, 'B');
  assert.equal(selectionDialog(f).props.open, false);
  select(f, 'B');
  assert.deepEqual(f.calls.selections, ['B']);
});

test('有草稿时切换先确认，取消保留原表单，再确认后只切到所选样品一次', () => {
  const f = fixture({ tasks: [sample('A'), sample('B'), sample('C')] });
  reportInteraction(f, { dirty: true, busy: false });
  const key = form(f).key;
  select(f, 'B');
  assert.equal(selectionDialog(f).props.open, true);
  assert.equal(form(f).props.taskId, 'A');
  assert.deepEqual(f.calls.selections, []);
  assert.ok(find(f.render(), (node) => node.type === 'AlertDialogCancel' && text(node) === '继续填写'));
  // Radix Cancel/Escape closes through the controlled dialog's onOpenChange boundary.
  selectionDialog(f).props.onOpenChange(false); f.render();
  assert.equal(selectionDialog(f).props.open, false);
  assert.equal(form(f).key, key);
  assert.deepEqual(f.calls.selections, []);
  select(f, 'C');
  find(f.render(), (node) => node.type === 'AlertDialogAction').props.onClick(); f.render();
  assert.deepEqual(f.calls.selections, ['C']);
  assert.equal(form(f).props.taskId, 'C');
  assert.equal(selectionDialog(f).props.open, false);
});

test('提交中禁用列表并拒绝已排队点击，不弹放弃确认也不切换', () => {
  for (const dirty of [false, true]) {
    const f = fixture({ tasks: [sample('A'), sample('B')] });
    reportInteraction(f, { dirty, busy: true });
    assert.equal(taskButton(f, 'B').props.disabled, true);
    assert.equal(button(f, '刷新').props.disabled, true);
    assert.equal(find(f.render(), node => node.type === 'SampleCommercialSummary').props.disabled, true);
    select(f, 'B');
    assert.deepEqual(f.calls.selections, []);
    assert.equal(form(f).props.taskId, 'A');
    assert.equal(selectionDialog(f).props.open, false);
    reportInteraction(f, { dirty: false, busy: false });
    select(f, 'B');
    assert.equal(form(f).props.taskId, 'B');
    assert.deepEqual(f.calls.selections, ['B']);
  }
});

test('显式刷新未变更任务时同时刷新列表和详情，保留当前表单与草稿状态', () => {
  const a = sample('A');
  const f = fixture({ tasks: [a, sample('B')] });
  reportInteraction(f, { dirty: true, busy: false });
  const key = form(f).key;
  const originalRevision = form(f).props.revision;
  button(f, '刷新').props.onClick(); f.render();
  assert.equal(f.calls.refreshes, 1);
  assert.notEqual(form(f).props.revision, originalRevision, 'explicit refresh must re-read detail even when updatedAt is unchanged');
  const refreshedRevision = form(f).props.revision;
  f.setProps({ tasks: [{ ...a }, sample('B')] });
  assert.equal(form(f).props.revision, refreshedRevision);
  assert.equal(form(f).key, key, 'refresh must not remount and erase the same-round draft');
  assert.equal(form(f).props.taskId, 'A');
  assert.deepEqual(f.calls.interactions.at(-1), { dirty: true, busy: false });
  assert.deepEqual(f.calls.selections, []);
  assert.equal(selectionDialog(f).props.open, false);
  button(f, '刷新').props.onClick(); f.render();
  assert.equal(f.calls.refreshes, 2);
  assert.notEqual(form(f).props.revision, refreshedRevision);
});

test('列表错误重新加载时也重取当前详情，不依赖任务更新时间', () => {
  const f = fixture({ tasks: [sample('A')], error: '采购数据加载失败' });
  const originalRevision = form(f).props.revision;
  button(f, '重新加载').props.onClick(); f.render();
  assert.equal(f.calls.refreshes, 1);
  assert.notEqual(form(f).props.revision, originalRevision);
  assert.equal(form(f).props.taskId, 'A');
});

test('提交中所有显式刷新入口禁用且拒绝处理器调用，避免详情读取与确认并发', () => {
  const f = fixture({ tasks: [sample('A')], error: '采购数据加载失败' });
  reportInteraction(f, { dirty: true, busy: true });
  const originalRevision = form(f).props.revision;
  for (const label of ['刷新', '重新加载']) {
    assert.equal(button(f, label).props.disabled, true, `${label} must be disabled while submitting`);
    button(f, label).props.onClick(); f.render();
  }
  assert.equal(f.calls.refreshes, 0);
  assert.equal(form(f).props.revision, originalRevision);
  assert.deepEqual(f.calls.interactions.at(-1), { dirty: true, busy: true });
});

test('搜索只改变列表，零结果和清除搜索均保留当前有草稿样品', () => {
  const f = fixture({ tasks: [sample('A'), sample('B')] });
  reportInteraction(f, { dirty: true, busy: false });
  const key = form(f).key;
  search(f, '供应商 B');
  assert.equal(taskButton(f, 'A'), undefined);
  assert.ok(taskButton(f, 'B'));
  assert.equal(form(f).props.taskId, 'A');
  assert.match(text(f.render()), /当前正在查看的样品不在筛选结果中/);
  search(f, '不存在的样品');
  assert.equal(all(f.render(), (node) => node.type === "Button" && node.props['aria-pressed'] !== undefined).length, 0);
  assert.equal(form(f).key, key);
  button(f, '清除筛选').props.onClick(); f.render();
  assert.ok(taskButton(f, 'A'));
  assert.equal(form(f).key, key);
  assert.deepEqual(f.calls.selections, []);
  assert.equal(selectionDialog(f).props.open, false);
});

test('阶段筛选不会切换当前样品，筛选列表使用真实样品分类逻辑', () => {
  const f = fixture({ tasks: [sample('A'), sample('B', { status: 'testing' })] });
  find(f.render(), (node) => node.type === 'ToggleGroup').props.onValueChange('testing'); f.render();
  assert.equal(taskButton(f, 'A'), undefined);
  assert.ok(taskButton(f, 'B'));
  assert.equal(form(f).props.taskId, 'A');
  assert.deepEqual(f.calls.selections, []);
});

test('内嵌表单的草稿与提交状态原样转交父栏目，清空后释放父级切换保护', () => {
  const f = fixture({ tasks: [sample('A')] });
  assert.equal(form(f).props.inline, true);
  for (const state of [{ dirty: true, busy: false }, { dirty: true, busy: true }, { dirty: false, busy: false }]) {
    reportInteraction(f, state);
    assert.deepEqual(f.calls.interactions.at(-1), state);
  }
  assert.deepEqual(f.calls.interactions, [
    { dirty: true, busy: false }, { dirty: true, busy: true }, { dirty: false, busy: false },
  ]);
});

test('真实工作区输出在异步加载、切样品和筛选后所有同级非空 key 唯一', () => {
  const f = fixture({ loading: true });
  assertUniqueSiblingKeys(f.render());
  f.setProps({ loading: false, tasks: [sample('A'), sample('B')] });
  assert.ok(assertUniqueSiblingKeys(f.render()) > 0, 'must examine the keyed content, not only the empty state');
  select(f, 'B');
  assertUniqueSiblingKeys(f.render());
  search(f, '没有匹配项');
  assertUniqueSiblingKeys(f.render());
  // Control case verifies that the assertion detects the original failure without depending on a key convention.
  assert.throws(() => assertUniqueSiblingKeys(React.createElement('div', null, [
    React.createElement('span', { key: 'duplicate' }), React.createElement('p', { key: 'duplicate' }),
  ])), /duplicate sibling key/);
});

test('列表跟随工作区内容宽度响应：窄屏默认收起，桌面常开，切换宽度不改当前样品', () => {
  const f = fixture({ tasks: [sample('A'), sample('B')] }, { width: 390 });
  assert.equal(listDisclosure(f).props.open, false);
  assert.ok(find(f.render(), (node) => node.props['aria-label'] === '展开样品列表'));
  assert.equal(form(f).props.taskId, 'A');
  f.resize(1280);
  assert.equal(listDisclosure(f).props.open, true);
  assert.equal(find(f.render(), (node) => node.props['aria-label'] === '展开样品列表'), undefined);
  listDisclosure(f).props.onOpenChange(false); f.render();
  assert.equal(listDisclosure(f).props.open, true, 'desktop list remains open');
  f.resize(863);
  assert.equal(listDisclosure(f).props.open, false);
  f.resize(864);
  assert.equal(listDisclosure(f).props.open, true);
  assert.equal(form(f).props.taskId, 'A');
  assert.deepEqual(f.calls.selections, []);
});

test('窄屏手动展开后选中另一份样品即收起，桌面仍维持展开', () => {
  const f = fixture({ tasks: [sample('A'), sample('B')] }, { width: 390 });
  listDisclosure(f).props.onOpenChange(true); f.render();
  assert.equal(listDisclosure(f).props.open, true);
  assert.ok(find(f.render(), (node) => node.props['aria-label'] === '收起样品列表'));
  select(f, 'B');
  assert.equal(form(f).props.taskId, 'B');
  assert.equal(listDisclosure(f).props.open, false);
  assert.deepEqual(f.calls.selections, ['B']);
  f.resize(1200);
  select(f, 'A');
  assert.equal(listDisclosure(f).props.open, true);
  assert.equal(form(f).props.taskId, 'A');
});

test('窄屏有草稿取消切换时列表保持展开，确认放弃后才收起', () => {
  const f = fixture({ tasks: [sample('A'), sample('B')] }, { width: 390 });
  listDisclosure(f).props.onOpenChange(true); f.render();
  reportInteraction(f, { dirty: true, busy: false });
  select(f, 'B');
  assert.equal(selectionDialog(f).props.open, true);
  assert.equal(listDisclosure(f).props.open, true);
  selectionDialog(f).props.onOpenChange(false); f.render();
  assert.equal(form(f).props.taskId, 'A');
  assert.equal(listDisclosure(f).props.open, true);
  select(f, 'B');
  find(f.render(), (node) => node.type === 'AlertDialogAction').props.onClick(); f.render();
  assert.equal(form(f).props.taskId, 'B');
  assert.equal(listDisclosure(f).props.open, false);
  assert.deepEqual(f.calls.selections, ['B']);
});

test('尺寸监听绑定实际容器，普通刷新不重复订阅，卸载时解除', () => {
  const f = fixture({ tasks: [sample('A')] }, { width: 390 });
  f.render();
  assert.equal(f.observers.length, 1);
  assert.equal(f.observers[0].target.clientWidth, 390);
  f.setProps({ tasks: [sample('A'), sample('B')] });
  assert.equal(f.observers.length, 1);
  f.destroy();
  assert.equal(f.observers[0].disconnected, true);
});

test('窄屏显式切换样品收起列表后，将焦点交给当前样品原生区域', () => {
  const f = fixture({ tasks: [sample('A'), sample('B')] }, { width: 390 });
  f.render();
  assert.deepEqual(f.calls.focuses, [], 'initial selection must not steal focus');
  listDisclosure(f).props.onOpenChange(true); f.render();
  select(f, 'B');
  assert.equal(listDisclosure(f).props.open, false);
  assert.equal(form(f).props.taskId, 'B');
  const selectedRegion = find(f.render(), (node) => node.type === 'section' && node.props.className?.includes('proc-sample-selected'));
  assert.equal(selectedRegion.props.tabIndex, -1, 'the selected region must accept programmatic focus');
  assert.ok(selectedRegion.ref?.current, 'focus must target a committed native node');
  assert.equal(f.activeElement, selectedRegion.ref.current);
  assert.equal(f.calls.focuses.length, 1);
  select(f, 'B');
  assert.equal(f.calls.focuses.length, 1, 'reselecting the current sample must not refocus');
});

test('窄屏取消草稿切换显式还焦给发起按钮，确认放弃才聚焦新样品', () => {
  const f = fixture({ tasks: [sample('A'), sample('B')] }, { width: 390 });
  listDisclosure(f).props.onOpenChange(true); f.render();
  reportInteraction(f, { dirty: true, busy: false });
  const selectionTrigger = f.elementFor(taskButton(f, 'B'));
  select(f, 'B');
  assert.equal(selectionDialog(f).props.open, true);
  assert.equal(f.calls.focuses.length, 0);
  selectionDialog(f).props.onOpenChange(false); f.render();
  assert.equal(form(f).props.taskId, 'A');
  assert.equal(f.calls.focuses.length, 0, 'the region must not be focused when cancelling');
  assert.equal(closeSelectionFocus(f).defaultPrevented, true, 'a controlled dialog without a Trigger must explicitly restore focus');
  assert.equal(f.activeElement, selectionTrigger);
  assert.equal(f.calls.focuses.length, 1);
  select(f, 'B');
  find(f.render(), (node) => node.type === 'AlertDialogAction').props.onClick(); f.render();
  assert.equal(form(f).props.taskId, 'B');
  assert.equal(listDisclosure(f).props.open, false);
  const selectedRegion = find(f.render(), (node) => node.type === 'section' && node.props.className?.includes('proc-sample-selected'));
  assert.equal(f.activeElement, selectedRegion.ref?.current);
  assert.equal(f.calls.focuses.length, 2);
  assert.equal(closeSelectionFocus(f).defaultPrevented, true, 'confirmed compact selection must not restore a now-hidden list item');
  assert.equal(closeSelectionFocus(f).defaultPrevented, false, 'confirmed close permission must be consumed once');
  assert.equal(f.activeElement, selectedRegion.ref.current);
});

test('加载、刷新、筛选、尺寸变化和提交中拒绝切换都不抢当前焦点', () => {
  const f = fixture({ loading: true }, { width: 390 });
  f.render();
  f.setProps({ loading: false, tasks: [sample('A'), sample('B')] });
  button(f, '刷新').props.onClick(); f.render();
  f.setProps({ tasks: [sample('B'), sample('A', { updatedAt: '2026-09-10T02:00:00Z' })] });
  search(f, '没有匹配项'); search(f, '');
  f.resize(1200); f.resize(390);
  reportInteraction(f, { dirty: true, busy: true });
  select(f, 'B');
  assert.equal(form(f).props.taskId, 'A');
  assert.equal(f.calls.focuses.length, 0);
  reportInteraction(f, { dirty: false, busy: false });
  select(f, 'B');
  const focusCount = f.calls.focuses.length;
  assert.equal(focusCount, 1);
  button(f, '刷新').props.onClick(); f.render();
  f.setProps({ tasks: [sample('B', { updatedAt: '2026-09-10T03:00:00Z' }), sample('A')] });
  search(f, '没有匹配项');
  f.resize(1200); f.resize(390);
  assert.equal(f.calls.focuses.length, focusCount, 'background work must not replay a fulfilled focus request');
});

test('窄屏切换等待父路由提交新样品后才转移焦点，不提前聚焦旧任务', () => {
  const f = fixture({ tasks: [sample('A'), sample('B')], selectedId: 'A' }, { width: 390, deferSelection: true });
  listDisclosure(f).props.onOpenChange(true); f.render();
  select(f, 'B');
  assert.deepEqual(f.calls.selections, ['B']);
  assert.equal(form(f).props.taskId, 'A');
  assert.equal(f.calls.focuses.length, 0);
  f.setProps({ selectedId: 'B' });
  assert.equal(form(f).props.taskId, 'B');
  assert.equal(f.calls.focuses.length, 1);
  assert.match(f.activeElement.props['aria-label'], /样品 B.*PROC-B/);
  f.setProps({ tasks: [sample('B', { updatedAt: '2026-09-10T04:00:00Z' }), sample('A')] });
  assert.equal(f.calls.focuses.length, 1);
});

test('桌面列表持续展开，确认草稿切换后显式还焦给仍可见的发起按钮', () => {
  const f = fixture({ tasks: [sample('A'), sample('B')] }, { width: 1200 });
  select(f, 'B');
  assert.equal(listDisclosure(f).props.open, true);
  assert.equal(f.calls.focuses.length, 0);
  reportInteraction(f, { dirty: true, busy: false });
  const selectionTrigger = f.elementFor(taskButton(f, 'A'));
  select(f, 'A');
  find(f.render(), (node) => node.type === 'AlertDialogAction').props.onClick(); f.render();
  assert.equal(form(f).props.taskId, 'A');
  assert.equal(listDisclosure(f).props.open, true);
  assert.equal(f.calls.focuses.length, 0);
  assert.equal(closeSelectionFocus(f).defaultPrevented, true);
  assert.equal(f.activeElement, selectionTrigger);
  assert.equal(f.calls.focuses.length, 1);
});

test('草稿切换弹窗关闭时发起行已移除，焦点回到仍存在的当前样品区域', () => {
  const f = fixture({ tasks: [sample('A'), sample('B')] }, { width: 390 });
  listDisclosure(f).props.onOpenChange(true); f.render();
  reportInteraction(f, { dirty: true, busy: false });
  const selectionTrigger = f.elementFor(taskButton(f, 'B'));
  select(f, 'B');
  f.setProps({ tasks: [sample('A')] });
  assert.equal(selectionTrigger.isConnected, false);
  selectionDialog(f).props.onOpenChange(false); f.render();
  assert.equal(closeSelectionFocus(f).defaultPrevented, true);
  const selectedRegion = find(f.render(), (node) => node.type === 'section' && node.props.className?.includes('proc-sample-selected'));
  assert.equal(f.activeElement, selectedRegion.ref.current);
  assert.equal(f.calls.focuses.length, 1);
});


test('采购条件只读取选中原任务，草稿/提交时禁止跳出，父来源失效隐藏旧摘要',()=>{
  const f=fixture({tasks:[sample('A'),sample('B')],selectedId:'A'});
  const summary=()=>find(f.render(),n=>n.type==='SampleCommercialSummary');
  assert.equal(summary().props.task.id,'A');assert.equal(summary().props.unavailable,false);
  const old=summary().props;
  reportInteraction(f,{dirty:true,busy:false});assert.equal(summary().props.disabled,true);old.onOpenTask();assert.equal(find(f.render(),n=>n.type==='TaskDetailDrawer'),undefined);
  reportInteraction(f,{dirty:false,busy:false});summary().props.onOpenTask();
  const drawer=find(f.render(),n=>n.type==='TaskDetailDrawer');assert.equal(drawer.props.task.id,'A');drawer.props.onClose();f.render();
  select(f,'B');old.onOpenTask();assert.equal(find(f.render(),n=>n.type==='TaskDetailDrawer'),undefined);assert.equal(summary().props.task.id,'B');
  f.setProps({error:'读取失败'});assert.equal(summary().props.unavailable,true);summary().props.onOpenTask();assert.equal(find(f.render(),n=>n.type==='TaskDetailDrawer'),undefined);
});
