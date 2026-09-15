import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { matchPath } from 'react-router';

const compile = (path) => ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const dialogCode = compile('src/app/order-processing/components/PurchaseOrderAvailabilityDialog.tsx');
const pageCode = compile('src/app/order-processing/pages/PurchaseOrderDetail.tsx');
const apiCode = compile('src/app/lib/orderProcessingApi.ts');
const routePaths = { routePath: (_permission, fallback) => fallback, subRoutePath: (_permission, fallback, suffix) => `${fallback}/${suffix}` };
const inventoryNavigation = load(compile('src/app/lib/inventoryReadinessNavigation.ts'), { './routePaths': routePaths });
const lineNavigation = load(compile('src/app/lib/purchaseOrderLineNavigation.ts'), { './routePaths': routePaths });
const stockNavigation = load(compile('src/app/lib/stockPlanNavigation.ts'), { './routePaths': routePaths });
const workspaceArrivalNavigation = load(compile('src/app/lib/workspaceArrivalNavigation.ts'), { './routePaths': routePaths });
const permissions = ['page:purchase-order-detail', 'proc-purchase-order:confirm-availability'];
const t = (text, values = {}) => text.replace(/\{(\w+)\}/g, (match, name) => values[name] ?? match);
const components = new Proxy({}, { get: (_target, name) => name });
const jsx = (type, props) => typeof type === 'function' ? type(props) : { type, props };

function elements(tree) {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!tree || typeof tree !== 'object') return [];
  return [...(tree.type ? [tree] : []), ...Object.values(tree.props ?? {}).flatMap(elements)];
}
function content(tree) {
  if (Array.isArray(tree)) return tree.map(content).join(' ');
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  return tree && typeof tree === 'object' ? content(tree.props?.children) : '';
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function line(overrides = {}) {
  return { id: 'line/01', lineNo: '01', sku: 'A-001', name: '阀体', spec: 'M8', unit: '个', qty: 100, receivedQty: 20,
    unitPrice: 4, etaDate: '2026-09-12', sourceUpdatedAt: '2026-09-10T08:00:00.000Z', availability: null, ...overrides };
}
function confirmation(overrides = {}) {
  return { availableDate: '2026-09-14', note: '检验需要两天', confirmedByName: '采购经办', confirmedAt: '2026-09-10T09:00:00.000Z', version: 2, needsReconfirmation: false, ...overrides };
}
function runtime(allowed = permissions) {
  const slots = [];
  let slot = 0;
  const callbacks = [];
  const effects = [];
  const react = {
    useState(initial) { const index = slot++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], (value) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = slot++; return slots[index] ??= { current: initial }; },
    useMemo: (factory) => factory(),
    useCallback: (callback) => { callbacks.push(callback); return callback; },
    useEffect(callback) { effects.push(callback); },
  };
  return { begin() { slot = 0; callbacks.length = 0; effects.length = 0; }, callbacks, effects, dependencies: {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    '../../lib/i18n': { useI18n: () => ({ t }), i18nLocale: () => 'zh-CN' },
    '../../hooks/usePermission': { usePermission: (permission) => allowed.includes(permission) },
  } };
}
function load(code, dependencies) {
  const exports = {};
  new Function('exports', 'require', code)(exports, (name) => {
    if (name in dependencies) return dependencies[name];
    if (name === 'lucide-react' || name.startsWith('../../components/') || name.endsWith('/HorizonPage')) return components;
    throw new Error(`Unexpected dependency: ${name}`);
  });
  return exports;
}
function fixture(source = line(), allowed = permissions) {
  const rt = runtime(allowed);
  const writes = [];
  let writeReply = async () => ({}), readReply = async () => ({ order: { items: [source] } });
  let closed = 0, saved = 0, tree;
  class RequestError extends Error { constructor(message, status) { super(message); this.status = status; } }
  const { PurchaseOrderAvailabilityDialog } = load(dialogCode, { ...rt.dependencies,
    '../../lib/orderProcessingApi': {
      OrderProcessingRequestError: RequestError,
      orderProcessingApi: {
        confirmPurchaseOrderAvailability: (...args) => { writes.push(args); return writeReply(...args); },
        getPurchaseOrder: (...args) => readReply(...args),
      },
    },
  });
  const api = {
    writes, RequestError,
    render() { rt.begin(); tree = PurchaseOrderAvailabilityDialog({ orderId: 'po/01', orderNo: 'PO-001', line: source,
      onClose: () => closed++, onSaved: () => saved++ }); return tree; },
    text: () => content(tree),
    closed: () => closed, saved: () => saved,
    find: (type) => elements(tree).find((item) => item.type === type),
    field(id) { return elements(tree).find((item) => item.props.id === id); },
    change(id, value) { const field = api.field(id); assert.ok(field); assert.ok(!field.props.disabled); field.props.onChange({ target: { value } }); return api.render(); },
    async submit() { await api.find('form').props.onSubmit({ preventDefault() {} }); return api.render(); },
    button(label) { return elements(tree).find((item) => item.type === 'Button' && content(item).trim() === label); },
    setWriteReply(value) { writeReply = value; },
    setReadReply(value) { readReply = value; },
    async reload() { const button = api.button('重新载入订单来源'); assert.ok(button); button.props.onClick(); await new Promise((resolve) => setImmediate(resolve)); return api.render(); },
  };
  api.render();
  return api;
}

test('首次确认不把预计到货自动填作可用日，提交明确行 ID 与版本来源', async () => {
  const page = fixture();
  assert.equal(page.field('purchase-line-available-date').props.value, '');
  assert.equal(page.field('purchase-line-available-date').props.min, '2026-09-12');
  page.change('purchase-line-available-date', '2026-09-14');
  page.change('purchase-line-availability-note', '  检验两天  ');
  await page.submit();
  assert.deepEqual(page.writes, [['po/01', 'line/01', {
    availableDate: '2026-09-14', note: '检验两天', expectedVersion: 0, expectedSourceUpdatedAt: '2026-09-10T08:00:00.000Z',
  }]]);
  assert.equal(page.saved(), 1);
});

test('首次空日期、非法日历日期和早于行到货日期均不提交', async () => {
  const page = fixture();
  await page.submit();
  assert.match(page.text(), /首次确认不能留空/);
  page.change('purchase-line-available-date', '2026-02-30');
  await page.submit();
  assert.match(page.text(), /请选择有效/);
  page.change('purchase-line-available-date', '2026-09-11');
  await page.submit();
  assert.match(page.text(), /不能早于本行预计到货日期 2026-09-12/);
  assert.equal(page.field('purchase-line-available-date').props['aria-invalid'], true);
  assert.equal(page.writes.length, 0);
});

test('无到货日期允许经办人独立确认可用日，原始来源缺失则禁止提交', async () => {
  const page = fixture(line({ etaDate: null }));
  assert.equal(page.field('purchase-line-available-date').props.min, undefined);
  page.change('purchase-line-available-date', '2026-09-11');
  await page.submit();
  assert.equal(page.writes.length, 1);
  const missing = fixture(line({ sourceUpdatedAt: '' }));
  missing.change('purchase-line-available-date', '2026-09-14');
  await missing.submit();
  assert.equal(missing.writes.length, 0);
  assert.match(missing.text(), /来源信息不完整/);
});

test('清空已有日期必须填写撤销原因，并保留乐观锁版本', async () => {
  const page = fixture(line({ availability: confirmation() }));
  page.change('purchase-line-available-date', '');
  page.change('purchase-line-availability-note', ' ');
  await page.submit();
  assert.match(page.text(), /撤销日期确认时，请填写原因/);
  assert.equal(page.writes.length, 0);
  page.change('purchase-line-availability-note', '供应商改期，重新核实');
  await page.submit();
  assert.equal(page.writes[0][2].availableDate, null);
  assert.equal(page.writes[0][2].expectedVersion, 2);
});

test('保存期间防重复提交，关闭按钮、Esc 和遮罩关闭均被阻止', async () => {
  const gate = deferred();
  const page = fixture();
  page.setWriteReply(() => gate.promise);
  page.change('purchase-line-available-date', '2026-09-14');
  const first = page.submit();
  const second = page.submit();
  page.render();
  assert.equal(page.writes.length, 1);
  assert.equal(page.find('DialogContent').props.closeDisabled, true);
  assert.equal(page.button('取消').props.disabled, true);
  page.find('Dialog').props.onOpenChange(false);
  let prevented = 0;
  page.find('DialogContent').props.onEscapeKeyDown({ preventDefault: () => prevented++ });
  page.find('DialogContent').props.onInteractOutside({ preventDefault: () => prevented++ });
  assert.equal(page.closed(), 0);
  assert.equal(prevented, 2);
  gate.resolve({});
  await Promise.all([first, second]);
  assert.equal(page.saved(), 1);
});

test('无确认权限保留确认人及撤销记录，事件回调也不能发起写入', async () => {
  for (const allowed of [['page:purchase-order-detail'], ['proc-purchase-order:confirm-availability'], []]) {
    const page = fixture(line({ availability: confirmation({ availableDate: null, needsReconfirmation: true }) }), allowed);
    assert.match(page.text(), /采购经办/);
    assert.match(page.text(), /已撤销日期确认/);
    assert.match(page.text(), /需要重新确认/);
    assert.equal(page.field('purchase-line-available-date').props.disabled, true);
    assert.equal(page.button('保存确认'), undefined);
    await page.submit();
    assert.equal(page.writes.length, 0);
  }
});

test('普通保存失败在弹窗内展示错误并保留草稿供重试', async () => {
  const page = fixture();
  page.setWriteReply(async () => { throw new Error('网络连接中断'); });
  page.change('purchase-line-available-date', '2026-09-15');
  page.change('purchase-line-availability-note', '已和供应商核对');
  await page.submit();
  assert.match(page.text(), /网络连接中断/);
  assert.equal(page.find('form').props['aria-busy'], false);
  assert.equal(page.field('purchase-line-available-date').props.value, '2026-09-15');
  assert.equal(page.field('purchase-line-availability-note').props.value, '已和供应商核对');
  assert.equal(page.button('保存确认').props.disabled, false);
  assert.equal(page.saved(), 0);
});

test('409 必须重新载入来源，保留草稿并按新版本与新来源提交', async () => {
  const page = fixture(line({ availability: confirmation() }));
  page.setWriteReply(async () => { throw new page.RequestError('订单来源或确认记录已更新', 409); });
  page.change('purchase-line-available-date', '2026-09-18');
  page.change('purchase-line-availability-note', '本次草稿');
  await page.submit();
  assert.equal(page.button('保存确认').props.disabled, true);
  await page.submit();
  assert.equal(page.writes.length, 1);
  page.setReadReply(async () => ({ order: { items: [line({ etaDate: '2026-09-16', sourceUpdatedAt: '2026-09-11T10:00:00.000Z', availability: confirmation({ availableDate: '2026-09-20', note: '另一人修改', version: 3 }) })] } }));
  await page.reload();
  assert.equal(page.field('purchase-line-available-date').props.value, '2026-09-18');
  assert.equal(page.field('purchase-line-availability-note').props.value, '本次草稿');
  assert.equal(page.field('purchase-line-available-date').props.min, '2026-09-16');
  assert.match(page.text(), /另一人修改/);
  assert.match(page.text(), /已载入最新订单来源/);
  page.setWriteReply(async () => ({}));
  await page.submit();
  assert.deepEqual(page.writes[1][2], { availableDate: '2026-09-18', note: '本次草稿', expectedVersion: 3, expectedSourceUpdatedAt: '2026-09-11T10:00:00.000Z' });
});

test('刷新来源使到货日变晚后，原草稿仍保留但不能确认早于新到货日', async () => {
  const page = fixture();
  page.setWriteReply(async () => { throw new page.RequestError('冲突', 409); });
  page.change('purchase-line-available-date', '2026-09-15');
  await page.submit();
  page.setReadReply(async () => ({ order: { items: [line({ etaDate: '2026-09-18', sourceUpdatedAt: '2026-09-11T10:00:00.000Z' })] } }));
  await page.reload();
  await page.submit();
  assert.match(page.text(), /不能早于本行预计到货日期 2026-09-18/);
  assert.equal(page.writes.length, 1);
  assert.equal(page.field('purchase-line-available-date').props.value, '2026-09-15');
});

test('来源重载失败或订单行消失均不放开冲突保存，不丢弃草稿', async () => {
  const page = fixture();
  page.setWriteReply(async () => { throw new page.RequestError('冲突', 409); });
  page.change('purchase-line-available-date', '2026-09-15');
  await page.submit();
  page.setReadReply(async () => { throw new Error('读取失败'); });
  await page.reload();
  assert.match(page.text(), /读取失败/);
  assert.equal(page.button('保存确认').props.disabled, true);
  page.setReadReply(async () => ({ order: { items: [] } }));
  await page.reload();
  assert.match(page.text(), /当前订单行已不可用/);
  assert.equal(page.button('保存确认').props.disabled, true);
  assert.equal(page.field('purchase-line-available-date').props.value, '2026-09-15');
});

function detailFixture(allowed = permissions) {
  const rt = runtime(allowed);
  const record = line({ availability: confirmation({ needsReconfirmation: true }) });
  const order = { id: 'po/01', poNo: 'PO-001', supplier: '供应商', buyer: '采购经办', owner: '采购部', status: '部分到货',
    orderDate: '2026-09-01', etaDate: '2026-09-12', itemCount: 1, amount: 400, currency: 'CNY', warehouse: '量产仓', items: [record], taskLinks: [] };
  let tree, reads = 0;
  let readReply = async () => ({ order });
  const { PurchaseOrderDetail } = load(pageCode, { ...rt.dependencies,
    'react-router': { useNavigate: () => () => {}, useParams: () => ({ id: 'po/01' }), useLocation: () => ({ search: '', state: null, key: 'initial' }) },
    sonner: { toast: { success() {} } },
    '../../lib/routePaths': { routePath: (_permission, fallback) => fallback },
    '../../lib/inventoryReadinessNavigation': inventoryNavigation,
    '../../lib/purchaseOrderLineNavigation': lineNavigation,
    '../../lib/stockPlanNavigation': stockNavigation,
    '../../lib/workspaceArrivalNavigation': workspaceArrivalNavigation,
    '../../lib/orderProcessingApi': { orderProcessingApi: { getPurchaseOrder: async () => { reads++; return readReply(); } } },
    './PurchaseOrders': { formatCurrency: (value) => String(value), statusBadgeClass: () => '' },
    '../components/PurchaseReceiptDrawer': { PurchaseReceiptDrawer: 'PurchaseReceiptDrawer' },
    '../components/PurchaseOrderHistoryDrawer': { PurchaseOrderHistoryDrawer: 'PurchaseOrderHistoryDrawer' },
    '../components/PurchaseOrderAvailabilityDialog': { PurchaseOrderAvailabilityDialog: 'PurchaseOrderAvailabilityDialog', availabilityConfirmedAt: (value) => value },
  });
  return {
    render() { rt.begin(); tree = PurchaseOrderDetail(); return tree; },
    async load() { await rt.callbacks[0](); return this.render(); },
    tree: () => tree, reads: () => reads,
    order,
    setReadReply(reply) { readReply = reply; },
    restoreFocus() { rt.effects.find((callback) => callback.name === 'restoreAvailabilityFocus')?.(); },
  };
}

test('真实详情页逐行展示两个不同日期与重确认记录，仅有权限显示右侧操作', async () => {
  for (const allowed of [permissions, ['page:purchase-order-detail'], ['proc-purchase-order:confirm-availability']]) {
    const page = detailFixture(allowed);
    page.render();
    await page.load();
    const text = content(page.tree());
    assert.match(text, /预计到货/);
    assert.match(text, /预计检验后可用/);
    assert.match(text, /2026-09-14/);
    assert.match(text, /采购经办/);
    assert.match(text, /订单来源已变化，需重确认/);
    const action = elements(page.tree()).find((item) => item.type === 'Button' && item.props['aria-label']?.includes('确认订单行'));
    assert.equal(Boolean(action), allowed === permissions);
    if (action) {
      action.props.onClick({ currentTarget: null });
      page.render();
      const dialog = elements(page.tree()).find((item) => item.type === 'PurchaseOrderAvailabilityDialog');
      assert.equal(dialog.props.orderId, 'po/01');
      assert.equal(dialog.props.line.id, 'line/01');
      dialog.props.onSaved();
      await new Promise((resolve) => setImmediate(resolve));
      page.render();
      assert.equal(page.reads(), 2);
      assert.equal(elements(page.tree()).some((item) => item.type === 'PurchaseOrderAvailabilityDialog'), false);
    }
  }
});

async function withFocusDocument(run) {
  const previous = globalThis.document;
  const body = { isConnected: true };
  const documentElement = { isConnected: true };
  const doc = { body, documentElement, activeElement: body };
  globalThis.document = doc;
  try { await run(doc); } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
}
function bindAvailabilityAction(page, doc) {
  let focused = 0;
  const node = { isConnected: true, focus() { focused++; doc.activeElement = node; } };
  const action = elements(page.tree()).find((item) => item.type === 'Button' && item.props['aria-label']?.includes('确认订单行'));
  assert.ok(action);
  action.props.ref(node);
  return { node, action, focused: () => focused };
}
function openAvailability(page, binding) {
  binding.action.props.onClick({ currentTarget: binding.node });
  page.render();
  return elements(page.tree()).find((item) => item.type === 'PurchaseOrderAvailabilityDialog');
}

test('日期弹窗关闭自动焦点回调将取消或关闭后的焦点恢复到触发行', async () => withFocusDocument(async (doc) => {
  const page = detailFixture();
  page.render(); await page.load();
  const binding = bindAvailabilityAction(page, doc);
  const dialog = openAvailability(page, binding);
  dialog.props.onClose();
  let prevented = false;
  dialog.props.onCloseAutoFocus({ preventDefault: () => { prevented = true; } });
  page.render(); page.restoreFocus();
  assert.equal(prevented, true);
  assert.equal(binding.focused(), 1);
  assert.equal(doc.activeElement, binding.node);
}));

test('日期保存重载后按稳定订单行 ID 找到新按钮，不聚焦已经卸载的 DOM', async () => withFocusDocument(async (doc) => {
  const page = detailFixture();
  page.render(); await page.load();
  const original = bindAvailabilityAction(page, doc);
  const dialog = openAvailability(page, original);
  const pending = deferred();
  page.setReadReply(() => pending.promise);
  dialog.props.onSaved();
  original.action.props.ref(null);
  original.node.isConnected = false;
  dialog.props.onCloseAutoFocus({ preventDefault() {} });
  page.render(); page.restoreFocus();
  assert.equal(original.focused(), 0);
  pending.resolve({ order: page.order });
  await new Promise((resolve) => setImmediate(resolve));
  page.render();
  const latest = bindAvailabilityAction(page, doc);
  page.restoreFocus();
  assert.equal(original.focused(), 0);
  assert.equal(latest.focused(), 1);
  assert.equal(doc.activeElement, latest.node);
}));

test('等待订单刷新期间用户转到其他控件，不抢回该用户的新焦点', async () => withFocusDocument(async (doc) => {
  const page = detailFixture();
  page.render(); await page.load();
  const original = bindAvailabilityAction(page, doc);
  const dialog = openAvailability(page, original);
  const pending = deferred();
  page.setReadReply(() => pending.promise);
  dialog.props.onSaved();
  dialog.props.onCloseAutoFocus({ preventDefault() {} });
  page.render(); page.restoreFocus();
  const otherControl = { isConnected: true };
  doc.activeElement = otherControl;
  pending.resolve({ order: page.order });
  await new Promise((resolve) => setImmediate(resolve));
  page.render();
  const latest = bindAvailabilityAction(page, doc);
  page.restoreFocus();
  assert.equal(latest.focused(), 0);
  assert.equal(doc.activeElement, otherControl);
}));

test('日期确认请求使用转义后的行级 PATCH 路径、原版本与来源，并保留 HTTP 冲突状态', async () => {
  const requests = [];
  let fail = false;
  const { orderProcessingApi, OrderProcessingRequestError } = load(apiCode, {
    './authSession': {
      authFetch: async (path, init) => { requests.push({ path, init }); return { ok: !fail, status: fail ? 409 : 200, json: async () => ({ lineId: 'line/01' }) }; },
      readErrorMessage: async () => '订单来源已更新',
    },
  });
  const input = { availableDate: '2026-09-14', note: '人工确认', expectedVersion: 2, expectedSourceUpdatedAt: '2026-09-10T08:00:00.000Z' };
  await orderProcessingApi.confirmPurchaseOrderAvailability('po/01', 'line/01', input);
  assert.equal(requests[0].path, '/api/procurement/tplus/views/purchase-orders/po%2F01/lines/line%2F01/availability');
  assert.equal(requests[0].init.method, 'PATCH');
  assert.deepEqual(JSON.parse(requests[0].init.body), input);
  fail = true;
  await assert.rejects(orderProcessingApi.confirmPurchaseOrderAvailability('po/01', 'line/01', input), (cause) => cause instanceof OrderProcessingRequestError && cause.status === 409 && cause.message === '订单来源已更新');
});

// Execute the production layout guard and purchase route declarations, with React Router's real matcher.
// Only authentication, viewport and rendering are mocked; routing decisions are never copied into this test.
const appSource = readFileSync(new URL('../src/app/App.tsx', import.meta.url), 'utf8');
const appAst = ts.createSourceFile('App.tsx', appSource, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
const guardDeclarations = ['ProtectedLayout', 'PermissionRoute'].map((name) => {
  const declaration = appAst.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name);
  assert.ok(declaration, `Production ${name} must exist`);
  return declaration.getText(appAst);
}).join('\n');
const purchaseDeclarations = [];
function collectPurchaseRoutes(node) {
  if (ts.isObjectLiteralExpression(node)) {
    const element = node.properties.find((property) => ts.isPropertyAssignment(property) && property.name.getText(appAst) === 'element');
    if (element && ts.isCallExpression(element.initializer)) {
      const child = element.initializer.arguments[0];
      if (child && ts.isJsxSelfClosingElement(child) && ['PurchaseOrdersPage', 'PurchaseOrderDetailPage'].includes(child.tagName.getText(appAst))) purchaseDeclarations.push(node.getText(appAst));
    }
  }
  ts.forEachChild(node, collectPurchaseRoutes);
}
collectPurchaseRoutes(appAst);
assert.equal(purchaseDeclarations.length, 2);
const guardsCode = ts.transpileModule(`${guardDeclarations}\nexport { ProtectedLayout, PermissionRoute };\nexport const purchaseRoutes = [${purchaseDeclarations.join(',')}];`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const permissionHelpers = load(compile('src/app/lib/permissions.ts'), {});

function routeFixture({ pathname, base = '/purchase-orders', mobile = true, user = { permissions: ['page:purchase-orders', 'page:purchase-order-detail'] }, hydrated = true, search = '', hash = '' }) {
  const routePath = (permission, fallback) => permission === 'page:purchase-orders' ? base : fallback;
  const dependencies = {
    useAuth: () => ({ user, hydrated }), useLocation: () => ({ pathname, search, hash }), useIsMobileViewport: () => mobile,
    routePath, subRoutePath: (permission, fallback, suffix) => `${routePath(permission, fallback)}/${suffix}`,
    asChildPath: (path) => path.replace(/^\//, ''), matchPath, procurementWorkspaceReturnPath: () => null,
    Root: 'Root', Navigate: 'Navigate', MobileProcSampleTestPage: 'MobileProcSampleTestPage',
    PurchaseOrdersPage: 'PurchaseOrdersPage', PurchaseOrderDetailPage: 'PurchaseOrderDetailPage',
    makeLazyProtected: (child, permission) => ({ child, permission }),
    hasPermission: permissionHelpers.hasPermission, hasAnyPermission: permissionHelpers.hasAnyPermission,
  };
  const exports = {};
  new Function('exports', 'require', ...Object.keys(dependencies), guardsCode)(exports,
    (name) => { assert.equal(name, 'react/jsx-runtime'); return { jsx, jsxs: jsx, Fragment: 'Fragment' }; }, ...Object.values(dependencies));
  return { layout: exports.ProtectedLayout(), routes: exports.purchaseRoutes, permission: exports.PermissionRoute };
}

test('真实手机路由守卫保留采购订单列表和单段详情，包括配置路径与尾斜杠', () => {
  for (const base of ['/purchase-orders', '/supply/purchase-order']) {
    for (const pathname of [base, `${base}/`, `${base}/PO-001`, `${base}/PO-001/`, `${base}/PO%2F2026`]) {
      const result = routeFixture({ pathname, base });
      assert.equal(result.layout.type, 'Root', `${pathname} stays in the original permission-protected shell`);
      const route = result.routes.find((route) => matchPath({ path: `/${route.path}`, end: true }, pathname));
      assert.ok(route, `${pathname} must also match an actual purchase route declaration`);
    }
  }
});

test('采购订单手机例外不扩展到其他路径、多段详情或旧配置路径', () => {
  for (const pathname of ['/purchase-orders-extra', '/purchase-orders/PO-001/history', '/purchase-orders//PO-001', '/inventory-management']) {
    assert.equal(routeFixture({ pathname }).layout.type, 'Navigate', pathname);
  }
  assert.equal(routeFixture({ pathname: '/purchase-orders/PO-001', base: '/supply/orders' }).layout.type, 'Navigate');
  for (const pathname of ['/proc-inventory-readiness', '/proc-materials', '/proc-my-workspace', '/proc-cockpit']) {
    assert.equal(routeFixture({ pathname }).layout.type, 'Root', 'Existing procurement exceptions remain available');
  }
});

test('采购订单手机例外仍先检查登录并由原列表/详情页面权限独立拦截', () => {
  const notLoggedIn = routeFixture({ pathname: '/purchase-orders/PO-001', user: null, search: '?tab=dates', hash: '#line-1' });
  assert.equal(notLoggedIn.layout.type, 'Navigate');
  assert.equal(notLoggedIn.layout.props.to, '/login');
  assert.equal(notLoggedIn.layout.props.state.from, '/purchase-orders/PO-001?tab=dates#line-1');
  assert.match(content(routeFixture({ pathname: '/purchase-orders', hydrated: false }).layout), /正在恢复登录状态/);
  const onlyList = routeFixture({ pathname: '/purchase-orders/PO-001', user: { permissions: ['page:purchase-orders'] } });
  const listRoute = onlyList.routes.find((route) => route.element.child.type === 'PurchaseOrdersPage');
  const detailRoute = onlyList.routes.find((route) => route.element.child.type === 'PurchaseOrderDetailPage');
  assert.equal(listRoute.element.permission, 'page:purchase-orders');
  assert.equal(detailRoute.element.permission, 'page:purchase-order-detail');
  assert.doesNotMatch(content(onlyList.permission({ permission: listRoute.element.permission, children: '允许列表' })), /没有访问/);
  assert.match(content(onlyList.permission({ permission: detailRoute.element.permission, children: '不应展示详情' })), /没有访问此页面的权限/);
});
