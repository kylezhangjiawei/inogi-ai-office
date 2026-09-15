import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const compile = (path) => ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
function load(code, dependencies = {}) {
  const exports = {};
  new Function('exports', 'require', code)(exports, (name) => {
    if (name in dependencies) return dependencies[name];
    if (name.endsWith('.css')) return {};
    if (name === 'lucide-react' || name.startsWith('../../components/')) return components;
    throw new Error(`Unexpected dependency: ${name}`);
  });
  return exports;
}
const model = load(compile('src/app/order-processing/history/purchaseOrderHistoryModel.ts'));
const code = compile('src/app/order-processing/components/PurchaseOrderHistoryDrawer.tsx');
const components = new Proxy({}, { get: (_target, name) => name });
const jsx = (type, props) => typeof type === 'function' ? type(props) : { type, props };
const nodes = (tree) => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object'
  ? [...(tree.type ? [tree] : []), ...Object.values(tree.props ?? {}).flatMap(nodes)] : [];
const text = (tree) => Array.isArray(tree) ? tree.map(text).join(' ') : tree == null || typeof tree === 'boolean' ? ''
  : typeof tree === 'object' ? text(tree.props?.children) : String(tree);
const t = (value, params = {}) => value.replace(/\{(\w+)\}/g, (match, name) => params[name] ?? match);
const all = ['page:purchase-order-detail', 'page:audit-log'];
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const line = { id: 'mirror/2', lineNo: '02', sku: 'VALVE-01', name: '阀体', spec: 'M8', unit: '件', qty: 100, receivedQty: 20, unitPrice: 10,
  sourceUpdatedAt: '2026-09-14T08:00:00.000Z', etaDate: '2026-09-18', availability: { availableDate: '2026-09-20', note: '检验两天', version: 2, confirmedByName: '采购甲', confirmedAt: '2026-09-14T07:00:00.000Z', needsReconfirmation: true } };
const log = (patch = {}) => ({ id: 'audit-1', module: 'procurement', action: 'purchase-order.availability-confirmed', resource: { id: line.id, type: 'proc-purchase-order-availability' }, actor: { id: 'user-1', name: '采购甲' }, timestamp: '2026-09-14T07:00:00.000Z', source: 'web', changes: [
  { field: 'availableDate', before: '2026-09-16', after: '2026-09-20' }, { field: 'note', before: '原检验一天', after: '检验两天' }, { field: 'version', before: 1, after: 2 }, { field: 'sourceFingerprint', before: 'old', after: 'new' },
], ...patch });
const page = (patch = {}) => ({ page: 1, pageSize: 10, total: 1, snapshotAt: '2026-09-14T08:00:00.000Z', filterSignature: 'scope-1', canViewAll: false, stats: null, items: [log()], ...patch });

function fixture({ response = page(), permissions = [...all], get } = {}) {
  const slots = [], reads = [];
  let cursor = 0, effects = [], tree, closed = 0, located = 0;
  let user = { id: 'user-1', permissions };
  const props = { orderId: 'PO/01', orderNo: 'PO/01', line: { ...line }, onClose: () => closed++, onLocateLine: () => located++, onCloseAutoFocus() {} };
  const same = (a, b) => Boolean(a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i])));
  const react = {
    useState(initial) { const n = cursor++; if (!(n in slots)) slots[n] = typeof initial === 'function' ? initial() : initial; return [slots[n], (value) => { slots[n] = typeof value === 'function' ? value(slots[n]) : value; }]; },
    useRef(initial) { const n = cursor++; return slots[n] ??= { current: initial }; },
    useEffect(callback, deps) { const n = cursor++, previous = slots[n]; if (!same(previous?.deps, deps)) effects.push(() => { previous?.cleanup?.(); slots[n] = { deps, cleanup: callback() }; }); },
  };
  const { PurchaseOrderHistoryDrawer } = load(code, {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    '../../auth': { useAuth: () => ({ user }) },
    '../../hooks/usePermission': { usePermission: (name) => permissions.includes(name) || permissions.includes('*') },
    '../../lib/i18n': { useI18n: () => ({ t }), i18nLocale: () => 'zh-CN' },
    '../../lib/auditLog': { fetchAuditLogPage: (query) => { reads.push(query); return get ? get(query) : Promise.resolve(response); } },
    '../history/purchaseOrderHistoryModel': model,
  });
  const view = {
    props, reads,
    render() { cursor = 0; effects = []; tree = PurchaseOrderHistoryDrawer(props); const jobs = effects; effects = []; jobs.forEach((job) => job()); return tree; },
    async settle() { await new Promise((resolve) => setImmediate(resolve)); return view.render(); },
    text: () => text(tree), nodes: () => nodes(tree), closed: () => closed, located: () => located,
    button(label) { return nodes(tree).find((node) => node.type === 'Button' && (node.props['aria-label'] === label || text(node).trim() === label)); },
    click(label) { const node = view.button(label); assert.ok(node, `${label} exists`); assert.equal(Boolean(node.props.disabled), false); node.props.onClick(); return view.render(); },
    setResponse(value) { response = value; },
    setPermissions(value) { permissions = value; user = { ...user, permissions }; return view.render(); },
    setUser(value) { user = value; return view.render(); },
    setProps(value) { Object.assign(props, value); return view.render(); },
    unmount() { slots.forEach((slot) => slot?.cleanup?.()); },
  };
  view.render(); return view;
}

test('查询只取精确镜像行的人工日期动作，翻页沿用服务端快照', () => {
  assert.deepEqual(model.purchaseOrderHistoryQuery('mirror/2', 2, page()), { module: 'procurement', actions: ['purchase-order.availability-confirmed'], resource: 'proc-purchase-order-availability', resourceId: 'mirror/2', sort: 'newest', page: 2, pageSize: 10, snapshotAt: page().snapshotAt, statsSignature: 'scope-1' });
});
test('真实前后日期、说明、版本分开投影，不把首条记录当原承诺', () => {
  const result = model.readPurchaseOrderHistoryPage(page(), line.id);
  assert.equal(result.entries[0].availableDate.before.value, '2026-09-16');
  assert.equal(result.entries[0].availableDate.after.value, '2026-09-20');
  assert.equal(result.entries[0].sourceChanged, true);
  assert.equal('originalPromise' in result, false);
});
test('未记录、明确空日期和空说明不混同，初次确认不称为来源已变化', () => {
  const result = model.readPurchaseOrderHistoryPage(page({ items: [log({ changes: [{ field: 'availableDate', after: null }, { field: 'note', before: null, after: '' }, { field: 'sourceFingerprint', before: null, after: 'first' }] })] }), line.id).entries[0];
  assert.equal(model.historyValueText(result.availableDate.before, 'date'), '未记录');
  assert.equal(model.historyValueText(result.availableDate.after, 'date'), '未设置日期');
  assert.equal(model.historyValueText(result.note.after, 'note'), '无说明');
  assert.equal(result.sourceChanged, null);
});
test('错行、错动作、重复记录、非法日期、重复字段和异常分页被拒绝', () => {
  const variants = [
    page({ items: [log({ resource: { id: 'other', type: 'proc-purchase-order-availability' } })] }),
    page({ items: [log({ action: 'unrelated' })] }), page({ total: 2, items: [log(), log()] }),
    page({ items: [log({ changes: [{ field: 'availableDate', before: '2026-02-30', after: null }] })] }),
    page({ items: [log({ changes: [{ field: 'note', after: 'one' }, { field: 'note', after: 'two' }] })] }),
    page({ page: 2 }), page({ pageSize: 20 }), page({ total: -1 }),
  ];
  variants.forEach((value) => assert.throws(() => model.readPurchaseOrderHistoryPage(value, line.id), /记录不完整|关联不一致/));
});
test('无审计查看权限不读取，原单日期仍显示；无订单权限不暴露任何日期', async () => {
  const view = fixture({ permissions: ['page:purchase-order-detail'] }); await view.settle();
  assert.equal(view.reads.length, 0); assert.match(view.text(), /需要操作留痕查看权限/); assert.match(view.text(), /2026-09-18/);
  view.setPermissions([]); await view.settle(); assert.equal(view.reads.length, 0); assert.doesNotMatch(view.text(), /2026-09-18|阀体|采购甲/);
});
test('供应商原承诺明确未提供，当前到货与人工日期不同，canViewAll 不冒充采购全量', async () => {
  const view = fixture({ response: page({ canViewAll: true }) }); await view.settle();
  for (const value of ['供应商原承诺日', '来源未提供', 'ERP 当前预计到货', '2026-09-18', '2026-09-20', '需重确认', '可能不是该订单行的全部历史', '变更前', '变更后']) assert.ok(view.text().includes(value), value);
  assert.equal(view.nodes().some((node) => ['input', 'form'].includes(node.type)), false);
});
test('首次读取失败可重试，不伪造空历史', async () => {
  let failed = true;
  const view = fixture({ get: async () => { if (failed) throw new Error('服务暂时不可用'); return page(); } }); await view.settle();
  assert.match(view.text(), /服务暂时不可用/); assert.doesNotMatch(view.text(), /暂无日期确认记录/);
  failed = false; view.click('重试读取记录'); await view.settle(); assert.match(view.text(), /原检验一天/);
});
test('翻页失败保留上次页和快照，重试正确页；刷新从新快照第一页读取', async () => {
  let failSecond = true;
  const view = fixture({ get: async (query) => { if (query.page === 2 && failSecond) throw new Error('第二页读取失败'); return page({ total: 11, page: query.page, items: [log({ id: `audit-${query.page}` })] }); } });
  await view.settle(); view.click('下一页确认记录'); await view.settle();
  assert.match(view.text(), /仍显示上次成功读取的第 1 页/); assert.equal(view.reads[1].snapshotAt, page().snapshotAt);
  failSecond = false; view.click('重试读取记录'); await view.settle(); assert.equal(view.reads.at(-1).page, 2);
  view.click('刷新记录'); await view.settle(); assert.equal(view.reads.at(-1).page, 1); assert.equal(view.reads.at(-1).snapshotAt, undefined);
});
test('错行响应无法替换当前成功页', async () => {
  const view = fixture(); await view.settle(); view.setResponse(page({ items: [log({ resource: { id: 'wrong', type: 'proc-purchase-order-availability' } })] }));
  view.click('刷新记录'); await view.settle(); assert.match(view.text(), /关联不一致/); assert.match(view.text(), /原检验一天/);
});
test('旧账号请求晚到不回填，新账号读取前立即隐去旧历史', async () => {
  const late = deferred(); let calls = 0;
  const view = fixture({ get: () => ++calls === 1 ? late.promise : Promise.resolve(page({ items: [log({ actor: { id: 'two', name: '新账号操作人' } })] })) });
  view.setUser({ id: 'two', permissions: all }); await view.settle(); assert.match(view.text(), /新账号操作人/);
  late.resolve(page()); await view.settle(); assert.match(view.text(), /新账号操作人/);
  assert.equal(view.nodes().filter((node) => node.type === 'strong').some((node) => text(node) === '采购甲'), false);
});
test('保留页面权限但管理范围改变时立即失效旧历史并重读', async () => {
  const gate = deferred(); let count = 0;
  const view = fixture({ permissions: [...all, 'proc-task:reassign'], get: () => ++count === 1 ? Promise.resolve(page()) : gate.promise }); await view.settle();
  view.setPermissions(all); assert.doesNotMatch(view.text(), /原检验一天/); assert.equal(view.reads.length, 2);
  gate.resolve(page({ total: 0, items: [] })); await view.settle(); assert.match(view.text(), /暂无日期确认记录/);
});
test('关闭与返回原行只触发对应回调，保留自动焦点恢复合同', async () => {
  const view = fixture(); await view.settle(); view.click('关闭'); view.click('返回原订单行');
  assert.equal(view.closed(), 1); assert.equal(view.located(), 1);
  assert.equal(view.nodes().find((node) => node.type === 'SheetContent').props.onCloseAutoFocus, view.props.onCloseAutoFocus);
});

test('已在第2页时刷新失败不退回第1页，保留该页内容和上次成功时间', async () => {
  let refreshFails = false;
  const view = fixture({ get: async (query) => {
    if (refreshFails && !query.snapshotAt) throw new Error('新快照读取失败');
    return page({ page: query.page, total: 11, items: [log({ actor: { name: query.page === 2 ? '第二页经办人' : '第一页经办人' } })] });
  } });
  await view.settle(); view.click('下一页确认记录'); await view.settle();
  refreshFails = true; view.click('刷新记录'); await view.settle();
  assert.match(view.text(), /仍显示上次成功读取的第 2 页/); assert.match(view.text(), /第二页经办人/);
  assert.doesNotMatch(view.text(), /第一页经办人/);
  view.click('重试读取记录'); await view.settle(); assert.equal(view.reads.at(-1).snapshotAt, undefined);
});

test('同账号姓名变化使按姓名兜底的旧日志失效并重新查询', async () => {
  const gate = deferred(); let count = 0;
  const view = fixture({ get: () => ++count === 1 ? Promise.resolve(page()) : gate.promise }); await view.settle();
  view.setUser({ id: 'user-1', name: '新姓名', permissions: all });
  assert.doesNotMatch(view.text(), /原检验一天/); assert.equal(view.reads.length, 2);
  gate.resolve(page({ items: [], total: 0 })); await view.settle();
});
