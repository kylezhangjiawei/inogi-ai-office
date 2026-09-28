import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const compile = (path) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const model = {};
new Function("exports", compile("../src/app/procurement/bomModel.ts"))(model);
const pageCode = compile("../src/app/procurement/BomListPage.tsx");
const nodes = [{ id: "q5", parentId: null, name: "Q5", productLine: "Q5", level: 0, code: null, material: null, qtyPer: null, sortOrder: 0, updatedAt: "2026-09-22T00:00:00Z", children: [] }];
const material = { id: "m1", name: "控制板", tpInventoryCode: "A-01", spec: "V2", unit: "块" };
const elements = (tree) => Array.isArray(tree) ? tree.flatMap(elements) : tree && typeof tree === "object" ? [tree, ...elements(tree.props?.children)] : [];
const text = (tree) => Array.isArray(tree) ? tree.map(text).join(" ") : tree && typeof tree === "object" ? text(tree.props?.children) : String(tree ?? "");
const translate = (value, vars = {}) => value.replace(/\{(\w+)\}/g, (match, key) => vars[key] ?? match);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = () => new Promise(setImmediate);
const leafA = { ...nodes[0], id: "leaf-a", parentId: "q5", level: 1, name: material.name, code: "A-01", material, qtyPer: 0.125, remark: "主机用料" };
const leafB = { ...leafA, id: "leaf-b", qtyPer: 2.75, remark: "另一处用料", updatedAt: "2026-09-23T00:00:00Z" };
const withLeaves = [{ ...nodes[0], children: [leafA, leafB] }];

function fixture(canEdit = true, { roots = nodes, api = {} } = {}) {
  let slots = [], cursor = 0, effects = [], component, props = {}, tree, callback;
  const saves = [], deletes = [], notifications = [], cleanups = [];
  const react = {
    Fragment: "Fragment",
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], (v) => { slots[i] = typeof v === "function" ? v(slots[i]) : v; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useMemo: (fn) => fn(),
    useCallback(fn) { callback = fn; return fn; },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i] || deps.some((value, index) => value !== slots[i][index])) { slots[i] = deps; effects.push(() => { cleanups[i]?.(); cleanups[i] = fn(); }); } },
  };
  const components = new Proxy({}, { get: (_, key) => key });
  const dependencies = {
    react,
    "react/jsx-runtime": { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: "Fragment" },
    "react-router": { useNavigate: () => () => {}, useSearchParams: () => [new URLSearchParams("productLine=Q5"), () => {}] },
    "../lib/i18n": { useI18n: () => ({ t: translate }) },
    "./components/common": { useProcCan: () => () => canEdit },
    "../lib/routePaths": { routePath: (_, fallback) => fallback },
    "./bomModel": model,
    "./bom.css": {},
    sonner: { toast: { success(message) { notifications.push(message); } } },
    "../lib/procurementApi": { getBomTree: async () => ({ roots }), listMaterials: async () => [material], saveBomNode: async (input, id) => { saves.push({ input, id }); }, deleteBomNode: async (...args) => { deletes.push(args); }, ...api },
  };
  const exports = {};
  new Function("exports", "require", pageCode)(exports, (name) => dependencies[name] ?? components);
  component = exports.BomListPage;
  const f = {
    saves, deletes, notifications,
    render() { cursor = 0; tree = component(props); return tree; },
    async load() { await callback(); return f.render(); },
    find(predicate) { return elements(tree).find(predicate); },
    click(label) { const button = f.find((node) => node.type === "Button" && text(node).trim() === label); assert.ok(button, label); button.props.onClick(); return f.render(); },
    mount(node, extraProps = {}) { f.destroy(); component = node.type; props = { ...node.props, ...extraProps }; slots = []; effects = []; return f.render(); },
    destroy() { cleanups.forEach(fn => fn?.()); cleanups.length = 0; },
    async effects() { const pending = effects; effects = []; pending.forEach((fn) => fn()); await new Promise(setImmediate); return f.render(); },
    change(label, value) { const field = f.find((node) => node.type === "label" && text(node).trim() === label); const input = elements(field).find((node) => node.type === "Input"); assert.ok(input, label); input.props.onChange({ target: { value } }); return f.render(); },
    async submit() { f.find((node) => node.type === "form").props.onSubmit({ preventDefault() {} }); await new Promise(setImmediate); },
  };
  f.render();
  return f;
}

test("在已有设备页面新增设备时，新 BOM 不会继承旧设备的父节点", async () => {
  const f = fixture(); await f.load(); f.click("新增设备");
  const editor = f.find((node) => node.type?.name === "BomEditor");
  assert.equal(editor.props.editor.parentId, "");
  f.mount(editor);
  f.change("设备型号", "Q8"); f.change("设备名称", "便携设备");
  await f.submit();
  assert.equal(f.saves.length, 1);
  assert.equal(f.saves[0].input.parentId, null);
  assert.equal(f.saves[0].input.kind, "device");
  assert.equal(f.saves[0].input.productLine, "Q8");
});

test("添加物料保存库内 ID、所属设备和单机用量，未选物料不能提交", async () => {
  const f = fixture(); await f.load(); f.click("添加物料");
  f.mount(f.find((node) => node.type?.name === "BomEditor")); await f.effects();
  await f.submit(); assert.equal(f.saves.length, 0);
  f.find((node) => node.type === "StockPlanSelect" && node.props.label === "物料库物料").props.onValueChange("m1"); f.render();
  f.change("单机用量", "2.5"); await f.submit();
  assert.equal(f.saves.length, 1);
  assert.equal(f.saves[0].input.materialId, "m1");
  assert.equal(f.saves[0].input.qtyPer, 2.5);
  assert.equal(f.saves[0].input.parentId, "q5");
  assert.equal(f.saves[0].input.productLine, "Q5");
});

test("只读用户能查看设备 BOM，但不能看到新增或编辑入口", async () => {
  const f = fixture(false); await f.load();
  const tree = f.render();
  assert.match(text(tree), /Q5/);
  assert.doesNotMatch(text(tree), /新增设备|新增分类|添加物料/);
});

async function editLeaf(api = {}, leafId = 'leaf-b') {
  const f = fixture(true, { roots: withLeaves, api }); await f.load();
  // Two leaves reference the same material: the row action, not an aggregate, owns identity.
  const buttons = elements(f.render()).filter(n => n.props?.['aria-label'] === `编辑 ${material.name}`);
  buttons[leafId === 'leaf-a' ? 0 : 1].props.onClick(); f.render();
  const saved = [];
  f.mount(f.find(n => n.type?.name === 'BomEditor'), { onSaved: async value => saved.push(value), onClose: () => saved.push('closed') });
  await f.effects();
  return { f, saved };
}

test('编辑同料号不同叶子只保存选中记录的原始用量、位置和版本', async () => {
  const { f, saved } = await editLeaf();
  f.change('备注', '单独调整'); await f.submit();
  assert.deepEqual(f.saves, [{ id: 'leaf-b', input: { kind: 'material', productLine: 'Q5', name: material.name, parentId: 'q5', materialId: 'm1', qtyPer: 2.75, remark: '单独调整', sortOrder: 0, baseUpdatedAt: leafB.updatedAt } }]);
  assert.deepEqual(saved, ['Q5']);
});

test('BOM 保存双击只发一次，等待期间取消和关闭事件均被阻止', async () => {
  const waiting = deferred(), calls = [];
  const { f, saved } = await editLeaf({ saveBomNode: (...args) => { calls.push(args); return waiting.promise; } });
  const submit = f.find(n => n.type === 'form').props.onSubmit;
  submit({ preventDefault() {} }); submit({ preventDefault() {} }); f.render();
  assert.equal(calls.length, 1);
  assert.equal(f.find(n => n.type === 'fieldset').props.disabled, true);
  f.find(n => n.type === 'Dialog').props.onOpenChange(false);
  f.find(n => n.type === 'Button' && text(n) === '取消').props.onClick();
  assert.deepEqual(saved, []);
  assert.equal(f.find(n => n.type === 'DialogContent').props.closeDisabled, true);
  waiting.resolve({}); await settle(); assert.deepEqual(saved, ['Q5']);
});

test('保存冲突保留用量、备注和版本，重试请求不会换成汇总值', async () => {
  const calls = [];
  const { f, saved } = await editLeaf({ saveBomNode: async (...args) => { calls.push(args); if (calls.length === 1) throw new Error('版本冲突'); } });
  f.change('单机用量', '0.375'); f.change('备注', '未保存说明'); await f.submit(); f.render();
  assert.match(text(f.find(n => n.props?.role === 'alert')), /版本冲突/);
  assert.deepEqual(saved, []); await f.submit();
  assert.deepEqual(calls[1], calls[0]); assert.equal(calls[1][0].qtyPer, 0.375);
  assert.equal(calls[1][0].baseUpdatedAt, leafB.updatedAt); assert.deepEqual(saved, ['Q5']);
});

test('编辑器卸载后保存迟到不刷新、不关闭其他页面', async () => {
  const waiting = deferred();
  const { f, saved } = await editLeaf({ saveBomNode: () => waiting.promise });
  await f.submit(); f.destroy(); waiting.resolve({}); await settle();
  assert.deepEqual(saved, []);
});

test('非法、超范围及超过四位精度的用量在客户端拦截', async () => {
  for (const value of ['', '0', '-1', '1.00001', '10000000000', 'NaN', 'Infinity']) {
    const { f } = await editLeaf(); f.change('单机用量', value); await f.submit(); f.render();
    assert.equal(f.saves.length, 0, value); assert.ok(f.find(n => n.props?.role === 'alert'), value);
  }
});

test('物料库失败后重试不丢草稿，关联预览和提交保持同一个正式 ID', async () => {
  let attempts = 0;
  const { f } = await editLeaf({ listMaterials: async () => { if (++attempts === 1) throw new Error('物料库离线'); return [material]; } });
  f.change('备注', '待保存草稿'); f.change('单机用量', '1.2345');
  assert.match(text(f.render()), /物料库离线/); await f.submit(); assert.equal(f.saves.length, 0);
  f.click('重试'); await f.effects(); await f.submit();
  assert.equal(f.saves[0].input.materialId, 'm1'); assert.equal(f.saves[0].input.qtyPer, 1.2345);
  assert.equal(f.saves[0].input.remark, '待保存草稿');
  assert.equal('unit' in f.saves[0].input, false); assert.equal('category' in f.saves[0].input, false);
});

test('关联物料已删除或缺少库存编码时不能保存，不能回退到旧编码', async () => {
  for (const rows of [[], [{ ...material, tpInventoryCode: '' }]]) {
    const { f } = await editLeaf({ listMaterials: async () => rows }); await f.submit(); f.render();
    assert.equal(f.saves.length, 0); assert.match(text(f.render()), /请选择具有库存编码的物料库物料/);
  }
});

test('编辑器卸载取消物料库查询，迟到结果不触发保存', async () => {
  let signal; const waiting = deferred();
  const { f, saved } = await editLeaf({ listMaterials: requestSignal => { signal = requestSignal; return waiting.promise; } });
  f.destroy(); assert.equal(signal.aborted, true); waiting.resolve([material]); await settle();
  assert.deepEqual(saved, []); assert.deepEqual(f.saves, []);
});

test('删除双击只提交选中叶子 ID 和版本，不误删同料号另一来源', async () => {
  const waiting = deferred(), calls = [];
  const f = fixture(true, { roots: withLeaves, api: { deleteBomNode: (...args) => { calls.push(args); return waiting.promise; } } });
  await f.effects(); await f.load();
  elements(f.render()).filter(n => n.props?.['aria-label'] === `删除 ${material.name}`)[1].props.onClick(); f.render();
  const confirm = f.find(n => n.type === 'Button' && text(n) === '确认移除').props.onClick;
  confirm(); confirm(); f.render();
  assert.deepEqual(calls, [['leaf-b', leafB.updatedAt]]);
  assert.equal(f.find(n => n.type === 'DialogContent').props.closeDisabled, true);
  f.find(n => n.type === 'Dialog').props.onOpenChange(false);
  assert.match(text(f.render()), /确认从 BOM 中移除/);
  waiting.resolve({}); await settle(); assert.equal(f.notifications.length, 1);
});

test('删除失败保留目标和版本供重试，离开页面后的成功响应无副作用', async () => {
  const waiting = deferred(), calls = [];
  const f = fixture(true, { roots: withLeaves, api: { deleteBomNode: (...args) => { calls.push(args); return calls.length === 1 ? Promise.reject(new Error('删除冲突')) : waiting.promise; } } });
  await f.effects(); await f.load();
  elements(f.render()).filter(n => n.props?.['aria-label'] === `删除 ${material.name}`)[0].props.onClick(); f.render();
  f.click('确认移除'); await settle(); assert.match(text(f.render()), /删除冲突/);
  f.click('确认移除'); f.destroy(); waiting.resolve({}); await settle();
  assert.deepEqual(calls, [['leaf-a', leafA.updatedAt], ['leaf-a', leafA.updatedAt]]);
  assert.deepEqual(f.notifications, []);
});
