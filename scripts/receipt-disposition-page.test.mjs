import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const read = (path) => readFileSync(new URL(`../src/app/${path}`, import.meta.url), 'utf8');
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const pageSource = read('procurement/ReceiptDispositionPreviewPage.tsx');
const pageCode = compile(pageSource);
const modelCode = compile(read('procurement/receiptDispositionPreviewModel.ts'));
const typeCode = compile(read('procurement/receiptDispositionTypes.ts'));
const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
const primitives = new Proxy({}, { get: (_target, name) => name });
const translate = (value, params = {}) => value.replace(/\{(\w+)\}/g, (match, key) => params[key] ?? match);
const failExternalAccess = () => assert.fail('演示页面不能访问接口或持久化存储');
const forbiddenStorage = new Proxy({}, { get: failExternalAccess, set: failExternalAccess });
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : ['2026-09-10T01:00:00.000Z'])); }
  static now() { return new Date('2026-09-10T01:00:00.000Z').getTime(); }
}
function evaluate(code, dependencies = {}) {
  const exports = {};
  new Function('exports', 'require', 'crypto', 'Date', 'fetch', 'localStorage', 'sessionStorage', 'indexedDB', code)(
    exports, (name) => {
    if (/\/ui\/(?:button|input|native-select|textarea|checkbox|radio-group|slider)$/.test(name)) return { Button: "Button", Input: "Input", NativeSelect: "NativeSelect", Textarea: "Textarea", Checkbox: "Checkbox", RadioGroup: "RadioGroup", RadioGroupItem: "RadioGroupItem", Slider: "Slider" };

      assert.ok(Object.hasOwn(dependencies, name), `页面不应加载未审查依赖：${name}`);
      return dependencies[name];
    }, { randomUUID }, FixedDate, failExternalAccess, forbiddenStorage, forbiddenStorage, forbiddenStorage,
  );
  return exports;
}
const model = evaluate(modelCode);
const types = evaluate(typeCode);
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object') return [];
  return [...(tree.type ? [tree] : []), ...Object.values(tree.props ?? {}).flatMap(nodes)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join(' ');
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  if (!tree || typeof tree !== 'object') return '';
  return [tree.props?.children, tree.props?.title, tree.props?.description, tree.props?.actions, tree.props?.action].map(text).join(' ');
}
function fixture() {
  const slots = [], setters = [];
  let cursor = 0, tree;
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      setters[index] ??= (value) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; };
      return [slots[index], setters[index]];
    },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
  };
  const dependencies = {
    react: hooks,
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'lucide-react': primitives,
    '../lib/i18n': { useI18n: () => ({ t: translate }), i18nLocale: () => 'zh-CN' },
    '../order-processing/components/HorizonPage': primitives,
    './components/ReceiptDispositionForm': { ReceiptDispositionForm: 'ReceiptDispositionForm' },
    './receiptDispositionPreviewModel': model,
    './receiptDispositionTypes': types,
    '../order-processing/horizon.css': {},
    './receipt-disposition-preview.css': {},
  };
  for (const component of ['alert-dialog', "button", 'collapsible', "input", 'label', 'tabs']) dependencies[`../components/ui/${component}`] = primitives;
  const exports = evaluate(pageCode, dependencies);
  const view = {
    render() { cursor = 0; tree = exports.ReceiptDispositionPreviewPage(); return tree; },
    nodes() { return nodes(tree); },
    text() { return text(tree).replace(/\s+/g, ' ').trim(); },
    byType(type) { return view.nodes().find((node) => node.type === type); },
    form() { return view.byType('ReceiptDispositionForm'); },
    dialog() { return view.byType('AlertDialog'); },
    button(label) { return view.nodes().find((node) => ['Button', 'AlertDialogAction', 'AlertDialogCancel'].includes(node.type) && text(node).trim() === label); },
    click(label) { const node = view.button(label); assert.ok(node, `${label} exists`); assert.equal(Boolean(node.props.disabled), false, `${label} enabled`); node.props.onClick(); return view.render(); },
    switchKind(kind) { view.byType('Tabs').props.onValueChange(kind); return view.render(); },
    selectBatch(name) { const node = view.nodes().find((item) => item.type === "Button" && item.props.className === 'rdp-batch' && text(item).includes(name)); assert.ok(node, `${name} exists`); node.props.onClick(); return view.render(); },
    setDirty(value = true) { view.form().props.onDirtyChange(value); return view.render(); },
    cancelDiscard() { view.dialog().props.onOpenChange(false); return view.render(); },
    confirmDiscard() { view.click('放弃并继续'); view.dialog().props.onOpenChange(false); return view.render(); },
    failNext(value = true) { view.nodes().find((node) => node.type === "Checkbox").props.onCheckedChange(value); return view.render(); },
    async save(patch = {}) {
      const form = view.form(); assert.ok(form, '当前应有处置表单');
      try {
        await form.props.onSubmit({
          kind: form.props.kind, quantity: 1, date: '2026-09-10', reason: '演示页面验证', warehouse: '演示仓', location: 'DEMO-A',
          documentNo: 'DEMO-PAGE-01', owner: '演示负责人', returnMethod: 'return', expectedDate: '', note: '', ...patch,
        });
        // The form reports clean only after the parent's save resolves.
        form.props.onDirtyChange(false);
      } finally { view.render(); }
    },
  };
  view.render(); return view;
}

test('首屏为明确标识的演示批次，单位逐批展示且默认可合格入库', () => {
  const page = fixture();
  assert.match(page.text(), /演示数据，刷新后恢复/); assert.match(page.text(), /不会生成正式单据或修改库存/);
  assert.equal(page.form().props.kind, 'inbound'); assert.equal(page.form().props.receipt.materialName, '阀体');
  assert.equal(page.form().props.limits.inbound, 20); assert.equal(page.form().props.receipt.unit, '件');
  assert.match(page.text(), /暂无处置记录/);
  page.selectBatch('压缩机'); assert.equal(page.form().props.receipt.unit, '台');
  assert.equal(page.form().props.limits.inbound, 0); assert.equal(page.form().props.limits.correctionMax, 100);
});

test('未改草稿直接切换；已改草稿先保留，取消丢弃后仍可继续填写', () => {
  const page = fixture();
  page.switchKind('correction'); assert.equal(page.form().props.kind, 'correction'); assert.equal(page.dialog().props.open, false);
  page.setDirty(); const oldKey = page.form().key;
  page.switchKind('isolation'); assert.equal(page.dialog().props.open, true);
  assert.equal(page.form().props.kind, 'correction'); assert.equal(page.form().key, oldKey);
  page.cancelDiscard(); assert.equal(page.dialog().props.open, false); assert.equal(page.form().key, oldKey);
  page.switchKind('return'); assert.equal(page.dialog().props.open, true);
  page.confirmDiscard(); assert.equal(page.form().props.kind, 'return'); assert.notEqual(page.form().key, oldKey);
  assert.equal(page.dialog().props.open, false);
});

test('切换批次与取消填写都保护脏草稿，确认只重建对应表单', () => {
  const page = fixture(); page.setDirty(); const original = page.form();
  page.selectBatch('压缩机'); assert.equal(page.form().props.receipt.id, original.props.receipt.id);
  page.cancelDiscard(); assert.equal(page.form().key, original.key);
  page.selectBatch('筛筒'); page.confirmDiscard();
  assert.equal(page.form().props.receipt.materialName, '筛筒'); assert.equal(page.form().props.kind, 'inbound');
  const batchKey = page.form().key; page.setDirty(); page.form().props.onCancel(); page.render();
  assert.equal(page.dialog().props.open, true); assert.equal(page.form().key, batchKey);
  page.confirmDiscard(); assert.notEqual(page.form().key, batchKey); assert.equal(page.form().props.receipt.materialName, '筛筒');
});

test('成功保存只改变目标批次内存累计，历史与其他批次保持独立', async () => {
  const page = fixture(); const before = page.form().props.receipt;
  await page.save({ quantity: 2.125 });
  const after = page.form().props.receipt;
  assert.deepEqual(after, { ...before, inboundQty: 38.125, version: before.version + 1 });
  assert.match(page.text(), /累计入库\s*36 → 38.125 件/); assert.match(page.text(), /演示页面验证/);
  page.selectBatch('压缩机'); assert.equal(page.form().props.receipt.receivedQty, 40); assert.match(page.text(), /暂无处置记录/);
  page.selectBatch('阀体'); assert.equal(page.form().props.receipt.inboundQty, 38.125);
  assert.match(page.text(), /累计入库\s*36 → 38.125 件/);
});

test('重置先确认丢弃未保存内容，再恢复所有批次期初及默认场景', async () => {
  const page = fixture(); await page.save({ quantity: 2 }); page.switchKind('isolation'); page.setDirty();
  const oldKey = page.form().key;
  page.click('重置演示'); assert.equal(page.dialog().props.open, true);
  page.cancelDiscard(); assert.equal(page.form().key, oldKey); assert.equal(page.form().props.receipt.inboundQty, 38);
  page.click('重置演示'); page.confirmDiscard();
  assert.equal(page.form().props.kind, 'inbound'); assert.equal(page.form().props.receipt.inboundQty, 36);
  assert.equal(page.form().props.receipt.version, 0); assert.match(page.text(), /暂无处置记录/);
  page.selectBatch('筛筒'); assert.equal(page.form().props.receipt.returnPlannedQty, 2); assert.match(page.text(), /2 条/);
  page.click('仅可查看'); assert.equal(page.form(), undefined);
  page.click('重置演示'); assert.equal(page.form().props.kind, 'inbound'); assert.equal(page.form().props.receipt.materialName, '阀体');
});

test('只读、空态和读取失败隐藏保存入口，恢复后保留已保存演示状态', async () => {
  for (const [scenario, message, back] of [
    ['仅可查看', '当前仅可查看', '返回正常操作'],
    ['暂无收货', '暂无收货批次', '返回演示批次'],
    ['读取失败', '收货批次读取失败', '重新加载'],
  ]) {
    const page = fixture(); await page.save({ quantity: 2 }); page.setDirty();
    page.click(scenario); assert.equal(page.dialog().props.open, true); assert.ok(page.form());
    page.confirmDiscard(); assert.equal(page.form(), undefined); assert.ok(page.text().includes(message));
    assert.equal(page.nodes().find((node) => node.type === "Checkbox").props.disabled, true);
    if (scenario === '仅可查看') assert.match(page.text(), /累计入库\s*36 → 38 件/);
    page.click(back); assert.equal(page.form().props.receipt.inboundQty, 38); assert.match(page.text(), /累计入库\s*36 → 38 件/);
  }
});

test('模拟失败仅消耗一次开关，保持草稿与累计，重试成功后可无提示切换', async () => {
  const page = fixture(); page.setDirty(); page.failNext(); const key = page.form().key;
  await assert.rejects(page.save({ quantity: 3 }), /演示保存失败，填写内容已保留/);
  assert.equal(page.form().key, key); assert.equal(page.form().props.receipt.inboundQty, 36); assert.match(page.text(), /暂无处置记录/);
  assert.equal(page.nodes().find((node) => node.type === "Checkbox").props.checked, false);
  page.switchKind('isolation'); assert.equal(page.dialog().props.open, true); page.cancelDiscard();
  await page.save({ quantity: 3 }); assert.equal(page.form().props.receipt.inboundQty, 39);
  page.switchKind('isolation'); assert.equal(page.dialog().props.open, false); assert.equal(page.form().props.kind, 'isolation');
});

test('保存后的旧回调由版本检查拦截，不能重复增加数量', async () => {
  const page = fixture(); const oldSave = page.form().props.onSubmit;
  const payload = { kind: 'inbound', quantity: 1, date: '2026-09-10', reason: '版本核对', warehouse: '演示仓', location: 'DEMO-A', documentNo: 'DEMO-PAGE-01', owner: '', returnMethod: 'return', expectedDate: '', note: '' };
  await oldSave(payload); page.render();
  await assert.rejects(oldSave(payload), /版本已变化/); page.render();
  assert.equal(page.form().props.receipt.inboundQty, 37); assert.match(page.text(), /1 条/);
});

test('隔离后可安排退换，页面累计与历史不会把补货计成实收或入库', async () => {
  const page = fixture(); const original = page.form().props.receipt;
  page.switchKind('return'); assert.equal(page.form().props.limits.return, 0);
  page.switchKind('isolation'); await page.save({ quantity: 4 });
  page.switchKind('return'); assert.equal(page.form().props.limits.return, 4);
  await page.save({ quantity: 4, returnMethod: 'replacement', expectedDate: '2026-09-20' });
  const receipt = page.form().props.receipt;
  assert.equal(receipt.receivedQty, original.receivedQty); assert.equal(receipt.qualifiedQty, original.qualifiedQty);
  assert.equal(receipt.defectiveQty, original.defectiveQty); assert.equal(receipt.inboundQty, original.inboundQty);
  assert.equal(receipt.returnPlannedQty, 4); assert.equal(page.form().props.limits.return, 0);
  assert.match(page.text(), /换货 \/ 补货安排 · 待办理/); assert.match(page.text(), /累计安排\s*0 → 4 件/);
});

test('搜索无匹配显示可恢复空态，不清空当前表单或收货数据', () => {
  const page = fixture(); page.setDirty(); const key = page.form().key;
  page.byType('Input').props.onChange({ target: { value: '不存在的批次' } }); page.render();
  assert.match(page.text(), /未找到匹配批次/); assert.equal(page.form().key, key); assert.equal(page.form().props.receipt.materialName, '阀体');
  page.click('清除搜索'); assert.equal(page.byType('Input').props.value, ''); assert.equal(page.form().key, key);
  page.selectBatch('压缩机'); assert.equal(page.dialog().props.open, true);
});

test('演示页面及内存模型没有接口或浏览器持久化依赖', async () => {
  assert.doesNotMatch(pageSource, /\b(?:fetch|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB)\b/);
  const page = fixture(); await page.save(); page.click('读取失败'); page.click('重新加载');
  page.click('重置演示'); assert.equal(page.form().props.receipt.inboundQty, 36);
});

test('App 开发开关关闭时既不注册演示路由，也不创建页面懒加载', () => {
  const source = ts.createSourceFile('App.tsx', read('App.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let previewDeclaration, previewSpread;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'ReceiptDispositionPreviewPage') previewDeclaration = node;
    if (ts.isSpreadElement(node) && node.getText(source).includes('/__preview/receipt-disposition')) previewSpread = node;
    ts.forEachChild(node, visit);
  }
  visit(source); assert.ok(previewDeclaration, '开发预览的条件懒加载存在'); assert.ok(previewSpread, '开发预览的条件路由存在');
  const fragment = `const ${previewDeclaration.getText(source)}; export const routes = [${previewSpread.getText(source)}];`.replaceAll('import.meta.env.DEV', '__DEV__');
  for (const development of [false, true]) {
    const exports = {}; const loads = [];
    new Function('exports', 'require', '__DEV__', 'lazyNamed', 'lazyWrap', compile(fragment))(
      exports, (name) => { assert.equal(name, 'react/jsx-runtime'); return { jsx, jsxs: jsx }; }, development,
      (loader, name) => { loads.push({ loader, name }); return name; }, (element) => element,
    );
    assert.equal(loads.length, development ? 1 : 0);
    assert.deepEqual(exports.routes.map((route) => route.path), development ? ['/__preview/receipt-disposition'] : []);
  }
});
