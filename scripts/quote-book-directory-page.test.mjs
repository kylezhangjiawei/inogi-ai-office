import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = (path) => readFileSync(new URL(`../src/app/procurement/${path}`, import.meta.url), 'utf8');
const compile = (code) => ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const logic = {};
new Function('exports', compile(source('procurementLogic.ts')))(logic);
const jsx = (type, props, key) => ({ type, props, key });
const primitives = new Proxy({}, { get: (_, key) => key });
const nodes = (tree) => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
const text = (tree) => Array.isArray(tree) ? tree.map(text).join(' ') : tree && typeof tree === 'object' ? text(tree.props?.children) : tree == null || typeof tree === 'boolean' ? '' : String(tree);
const quote = (id, materialId) => ({ id, materialId, supplierId: 'supplier-A', supplierName: '厂家甲', supplierModel: '', currency: 'CNY', taxIncluded: true, tiers: [{ minQty: 10, unitPrice: 2 }], leadTimeDays: 2, updatedAt: '' });
const material = (id, patch = {}) => ({ id, name: '同名阀体', spec: id, unit: '个', category: '阀类', productLine: 'Q5', latestPrice: null, tpInventoryCode: `T-${id}`, erpCode: `ERP-${id}`, quotes: [quote(`q-${id}`, id)], ...patch });

function fixture({ rows = [material('one'), material('two')], query = '', canWrite = true } = {}) {
  const slots = []; let cursor = 0, dirty = true, tree, effects = [], params = new URLSearchParams(query), reads = 0;
  let response = async () => rows;
  const changed = (a, b) => !a || !b || a.length !== b.length || a.some((x, i) => !Object.is(x, b[i]));
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], (next) => { next = typeof next === 'function' ? next(slots[index]) : next; if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; } }]; },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useMemo(fn, deps) { const index = cursor++; if (changed(slots[index]?.deps, deps)) slots[index] = { deps, value: fn() }; return slots[index].value; },
    useCallback(fn, deps) { return hooks.useMemo(() => fn, deps); },
    useEffect(fn, deps) { const index = cursor++; const before = slots[index]; if (changed(before?.deps, deps)) { const next = { deps }; slots[index] = next; effects.push(() => { before?.cleanup?.(); next.cleanup = fn(); }); } },
    useLayoutEffect(fn, deps) { hooks.useEffect(fn, deps); },
  };
  const deps = {
    react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-router': { useSearchParams: () => [params, (input) => { params = typeof input === 'function' ? input(params) : input; dirty = true; }] },
    '../lib/i18n': { useI18n: () => ({ t: (s, p = {}) => s.replace(/\{(\w+)\}/g, (m, k) => p[k] ?? m) }) },
    '../lib/procurementApi': { listQuoteBook: async () => { reads++; return response(); } },
    '../components/ui/utils': { cn: (...s) => s.filter(Boolean).join(' ') },
    './components/common': { useProcCan: () => (p) => canWrite && (p === 'quote-book:manage' || p === 'proc-task:inquiry'), useConfirmDialog: () => ({ confirm() {}, confirmDialog: null }) },
    './procurementLogic': logic, './quoteBookXlsx': {}, sonner: { toast: {} },
  };
  const exports = {};
  new Function('exports', 'require', compile(source('QuoteBookPage.tsx')))(exports, (name) => {
    if (name in deps) return deps[name];
    assert.ok(name === 'lucide-react' || name.startsWith('../components/') || name.startsWith('./components/'), `unexpected dependency ${name}`);
    return primitives;
  });
  const api = {
    render() { for (let i = 0; i < 20; i++) { cursor = 0; dirty = false; tree = exports.QuoteBookPage(); const queue = effects; effects = []; queue.forEach((e) => e()); if (!dirty) return tree; } assert.fail('page did not settle'); },
    async settle() { await new Promise((r) => setImmediate(r)); return api.render(); },
    byType(type) { return nodes(api.render()).find((n) => n.type === type); },
    rows() { return nodes(api.render()).filter((n) => typeof n.type === 'function' && n.type.name === 'QuoteBookMaterialRows').map((n) => n.props.row); },
    directory() { return api.byType('QuoteBookSupplierView'); },
    changeView(value) { params.set('view',value); return api.render(); },
    search(value) { api.byType('Input').props.onChange({ target: { value } }); return api.render(); },
    button(label) { return nodes(api.render()).find((n) => ['button', 'Button'].includes(n.type) && (n.props['aria-label'] === label || text(n).trim() === label)); },
    query: () => params, reads: () => reads,
    setQuery(value) { params = new URLSearchParams(value); return api.render(); },
    setResponse(fn) { response = fn; },
  };
  api.render(); return api;
}

test('默认直接展示供应商目录，没有视图 Tab；旧物料入口只打开详情抽屉', async () => {
  const page = fixture(); await page.settle();
  assert.ok(page.directory());
  assert.equal(page.byType('Tabs'),undefined);assert.equal(page.byType('TabsList'),undefined);
  assert.ok(nodes(page.render()).filter(n=>n.type==='Sheet').every(n=>!n.props.open));
  page.changeView('materials');assert.ok(page.directory());assert.equal(page.byType('Sheet').props.open,true);
  page.byType('Sheet').props.onOpenChange(false);
  assert.equal(page.query().get('view'),null);assert.ok(page.directory());
  assert.ok(nodes(fixture({query:'view=invalid'}).render()).filter(n=>n.type==='Sheet').every(n=>!n.props.open));
});

test('供货资格从对应物料打开抽屉，关闭回到原目录并保留无关 URL 参数', async () => {
  const page = fixture({query:'from=task'});await page.settle();
  page.directory().props.onQualifications('two','supplier-A');
  const sheet = nodes(page.render()).filter(n=>n.type==='Sheet')[1];
  assert.equal(sheet.props.open,true);assert.ok(page.directory());
  const panel=page.byType('SupplierQualificationsPanel');assert.equal(panel.props.materialId,'two');assert.equal(panel.props.supplierId,'supplier-A');
  sheet.props.onOpenChange(false);assert.equal(page.query().has('materialId'),false);assert.equal(page.query().has('supplierId'),false);
  assert.equal(page.query().get('from'),'task');
});

test('从厂家跳转比价使用物料ID，清除旧分类/过期筛选且展开全部厂家；同名物料不混入', async () => {
  const page = fixture({ query: 'view=suppliers' }); await page.settle();
  page.search('不匹配');
  page.byType('Select').props.onValueChange('不匹配分类');
  const expired = nodes(page.render()).filter((n) => n.type === 'Checkbox')[1];
  expired.props.onCheckedChange(true);
  const row = page.directory().props.rows[1]; page.directory().props.onCompare(row);
  assert.equal(page.query().get('view'), 'materials');
  assert.deepEqual(page.rows().map((r) => r.id), ['two']);
  const renderedRow = nodes(page.render()).find((n) => typeof n.type === 'function' && n.type.name === 'QuoteBookMaterialRows');
  assert.equal(renderedRow.props.open, true);
  page.button('清除筛选').props.onClick(); assert.equal(page.rows().length, 2);
});

test('报价详情打开关闭保留筛选，主页面目录始终使用全库报价', async () => {
  const page = fixture(); await page.settle(); page.search('T-one');
  assert.deepEqual(page.rows().map((r) => r.id), ['one']);
  page.changeView('suppliers'); assert.equal(page.directory().props.rows.length, 2);
  page.changeView('materials'); assert.deepEqual(page.rows().map((r) => r.id), ['one']);
  page.search('ERP-two'); assert.deepEqual(page.rows().map((r) => r.id), ['two']);
});

test('精确物料深链与新增报价权限继续有效', async () => {
  for (const canWrite of [true, false]) {
    const page = fixture({ query: 'materialId=two&action=add', canWrite }); await page.settle();
    assert.deepEqual(page.rows().map((r) => r.id), ['two']);
    assert.equal(Boolean(page.byType('QuoteFormDrawer')), canWrite);
  }
});

test('供应商编辑复用原抽屉并传递准确物料与报价，不靠名称重新查找', async () => {
  const page = fixture({ query: 'view=suppliers' }); await page.settle();
  const row = page.directory().props.rows[1]; page.directory().props.onEdit(row, row.quotes[0]);
  const drawer = page.byType('QuoteFormDrawer');
  assert.equal(drawer.props.material.id, 'two'); assert.equal(drawer.props.quote.id, 'q-two');
});

test('同名物料历史报价入口保留所选正式 ID，切换另一行不复用名称身份', async () => {
  const page = fixture(); await page.settle();
  const rows = nodes(page.render()).filter((node) => typeof node.type === 'function' && node.type.name === 'QuoteBookMaterialRows');
  rows[1].props.onHistory();
  assert.equal(page.byType('PriceHistoryModal').props.materialId, 'two');
  assert.equal(page.byType('PriceHistoryModal').props.materialName, '同名阀体');
  page.byType('PriceHistoryModal').props.onClose();
  assert.equal(page.byType('PriceHistoryModal').props.open, false);
  rows[0].props.onHistory();
  assert.equal(page.byType('PriceHistoryModal').props.materialId, 'one');
});

test('同名物料深链显示所有匹配，不能静默选择首条新增报价；不存在ID不展示其他物料', async () => {
  const page = fixture({ query: 'materialName=同名阀体&action=add' }); await page.settle();
  assert.equal(page.rows().length, 2); assert.equal(page.byType('QuoteFormDrawer'), undefined);
  page.setQuery('materialId=missing&action=add'); assert.equal(page.rows().length, 0);
  assert.equal(page.byType('QuoteFormDrawer'), undefined);
});

test('从精确物料再进入搜索深链时解除旧ID范围', async () => {
  const page = fixture({ query: 'materialId=one' }); await page.settle();
  assert.deepEqual(page.rows().map((r) => r.id), ['one']);
  page.setQuery('search=T-two'); assert.deepEqual(page.rows().map((r) => r.id), ['two']);
  page.button('清空搜索').props.onClick(); assert.equal(page.rows().length, 2);
});

test('读取失败隐藏旧供应商操作，可重试恢复；并行旧读取不能覆盖新结果', async () => {
  const page = fixture({ query: 'view=suppliers' }); await page.settle();
  page.setResponse(async () => { throw new Error('报价读取失败'); }); page.directory().props.onReload(); await page.settle();
  assert.ok(nodes(page.render()).find((n) => n.type === 'div' && n.props.hidden && nodes(n).some((child) => child.type === 'QuoteBookSupplierView')));
  page.setResponse(async () => [material('new')]); page.button('重新加载').props.onClick(); await page.settle();
  assert.deepEqual(page.directory().props.rows.map((r) => r.id), ['new']);
  let finishOld; page.setResponse(() => new Promise((r) => { finishOld = r; })); page.directory().props.onReload();
  page.setResponse(async () => [material('latest')]); page.directory().props.onReload(); await page.settle();
  finishOld([material('old')]); await page.settle();
  assert.deepEqual(page.directory().props.rows.map((r) => r.id), ['latest']);
});
