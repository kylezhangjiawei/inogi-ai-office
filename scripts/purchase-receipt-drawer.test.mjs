import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const code = ts.transpileModule(readFileSync(new URL('../src/app/order-processing/components/PurchaseReceiptDrawer.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const jsx = (type, props) => typeof type === 'function' ? type(props) : { type, props };
const components = new Proxy({}, { get: (_target, key) => key });
const t = (value, params = {}) => value.replace(/\{(\w+)\}/g, (match, name) => params[name] ?? match);
function elements(tree) {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!tree || typeof tree !== 'object') return [];
  return [...(tree.type ? [tree] : []), ...Object.values(tree.props ?? {}).flatMap(elements)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join(' ');
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  return tree && typeof tree === 'object' ? text(tree.props?.children) : '';
}
class RequestError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}
function receipt(id = 'receipt-1', patch = {}) {
  return { id, deliveryNo: `DN-${id}`, receivedDate: '2020-01-01', receivedQty: 10, note: '第一批送货', createdByName: '仓管员', createdAt: '2020-01-01T01:00:00Z',
    source: { orderId: 'erp-1', orderNo: 'PO-1', lineNo: '1', inventoryCode: 'VALVE-01', inventoryName: '阀体', spec: 'A型', unit: '件', supplierName: '阀体供应商', orderedQty: 100, updatedAt: '2020-01-01T01:00:00Z' },
    sourceChanged: false, version: 0, qualifiedQty: 0, defectiveQty: 0, pendingJudgmentQty: 0, pendingQty: 10, inspections: [], ...patch };
}
function ledger(patch = {}) {
  return { line: { id: 'line-1', orderNo: 'PO-1', lineNo: '1', tpOrderId: 'erp-1', inventoryCode: 'VALVE-01', inventoryName: '阀体', spec: 'A型', unit: '件', supplierName: '阀体供应商', orderedQty: 100, erpReceivedQty: 40, updatedAt: '2020-01-01T01:00:00Z', status: '已下单', approvalStatus: '已审核' },
    canReceive: true, canInspect: true, sourceIssue: null, summaryUnit: '件',
    summary: { receivedQty: 10, qualifiedQty: 0, defectiveQty: 0, pendingJudgmentQty: 0, pendingQty: 10 }, receipts: [receipt()], ...patch };
}
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const allPermissions = ['page:purchase-order-detail', 'proc-purchase-order:receive', 'proc-purchase-order:inspect'];
function fixture({ response = ledger(), permissions = [...allPermissions], get, receive, inspect, qualityOptions } = {}) {
  const slots = [], reads = [], receives = [], inspections = [], qualityReads = [], focused = [], scrolled = [];
  let cursor = 0, effects = [], tree, closed = 0, user = { id: 'qa-operator' };
  const props = { lineId: 'line-1', orderNo: 'PO-1', onClose: () => { closed += 1; }, onCloseAutoFocus: () => {} };
  const same = (a, b) => Boolean(a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index])));
  const react = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], (value) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useEffect(callback, deps) { const index = cursor++; const previous = slots[index]; if (!same(previous?.deps, deps)) effects.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: callback() }; }); },
  };
  const deps = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    '../../auth': { useAuth: () => ({ user }) },
    '../../hooks/usePermission': { usePermission: (name) => permissions.includes('*') || permissions.includes(name) },
    '../../lib/i18n': { useI18n: () => ({ t }), i18nLocale: () => 'zh-CN' },
    '../../components/ui/utils': { cn: (...parts) => parts.filter(Boolean).join(' ') },
    '../../lib/purchaseReceiptApi': {
      PurchaseReceiptRequestError: RequestError,
      getReceiptQualityOptions: async (lineId, signal) => {
        qualityReads.push({ lineId, signal });
        return qualityOptions ? qualityOptions(lineId, signal) : [{ id: 'quality-root', productId: 'product-1', name: '制氧机', parentId: null }, { id: 'quality-valve', productId: 'product-1', name: '阀体', parentId: 'quality-root' }];
      },
      getPurchaseReceipts: async (lineId, signal) => { reads.push({ lineId, signal }); return get ? get(lineId, signal) : response; },
      createPurchaseReceipt: async (lineId, payload) => { receives.push({ lineId, payload }); return receive ? receive(lineId, payload) : response; },
      createPurchaseInspection: async (lineId, receiptId, payload) => { inspections.push({ lineId, receiptId, payload }); return inspect ? inspect(lineId, receiptId, payload) : response; },
    },
  };
  const exports = {};
  new Function('exports', 'require', code)(exports, (name) => {
    if (name in deps) return deps[name];
    if (name.endsWith('.css')) return {};
    assert.ok(name === 'lucide-react' || name.startsWith('../../components/'), `Unexpected dependency ${name}`);
    return components;
  });
  const view = {
    props, reads, receives, inspections, qualityReads, focused, scrolled, closed: () => closed,
    render() { cursor = 0; effects = []; tree = exports.PurchaseReceiptDrawer(props);
      for (const node of elements(tree)) if (node.props?.ref) node.props.ref.current = { focus() { focused.push(node.props.id); }, scrollIntoView() { scrolled.push(node.type); } };
      const jobs = effects; effects = []; jobs.forEach((job) => job()); return tree; },
    async settle() { await new Promise((resolve) => setImmediate(resolve)); return view.render(); },
    tree: () => tree, text: () => text(tree), nodes: () => elements(tree),
    node(type) { return elements(tree).find((node) => node.type === type); },
    button(label) { return elements(tree).find((node) => ['Button', 'AlertDialogAction', 'AlertDialogCancel'].includes(node.type) && (node.props['aria-label'] === label || text(node).trim() === label)); },
    click(label) { const node = view.button(label); assert.ok(node, `${label} exists`); assert.equal(Boolean(node.props.disabled), false, `${label} enabled`); node.props.onClick(); return view.render(); },
    field(name) { return elements(tree).find((node) => node.props?.id === `receipt-${name}`); },
    fill(name, value) { const node = view.field(name); assert.ok(node, `${name} exists`); assert.equal(Boolean(node.props.disabled), false, `${name} editable`); node.props.onChange({ target: { value } }); return view.render(); },
    submit() { const node = view.node('form'); assert.ok(node); const result = node.props.onSubmit({ preventDefault() {} }); view.render(); return result; },
    setProps(patch) { Object.assign(props, patch); return view.render(); },
    setPermissions(next) { permissions = next; return view.render(); },
    setUser(next) { user = next; return view.render(); },
    setResponse(next) { response = next; },
    unmount() { slots.forEach((slot) => slot?.cleanup?.()); },
  };
  view.render(); return view;
}
function fillReceipt(view) {
  view.click('登记收货'); view.fill('deliveryNo', 'DN-NEW'); view.fill('receivedQty', '5'); view.fill('date', '2020-02-02');
}

test('approved reversal allows replacement against net receipts while retaining original gross receipt display', async () => {
  const response = ledger(); response.line.orderedQty = 10; response.summary.receivedQty = 10;
  response.fulfillment = { effectiveOrderedQty: 10, localNetReceivedQty: 8, localQualifiedQty: 4, qualifiedAvailableQty: 4, issues: [] };
  const view = fixture({ response }); await view.settle(); fillReceipt(view); view.fill('receivedQty', '2'); await view.submit(); await view.settle();
  assert.equal(view.receives.length, 1); assert.equal(view.receives[0].payload.receivedQty, 2); assert.match(view.text(), /本地净实收/);
});
function fillInspection(view) {
  view.click('记录检验结果：DN-receipt-1'); view.fill('date', '2020-02-02'); view.fill('qualifiedQty', '6'); view.fill('defectiveQty', '1'); view.fill('pendingJudgmentQty', '2'); view.fill('basis', 'SIP V1.0'); view.fill('note', '按图纸核对，外观 1 件不良，2 件待判定。');
  view.fill('quality-node', 'quality-valve');
}

test('ERP 与本台账数量分开展示，待判定与未检验独立，没有补库存入口', async () => {
  const view = fixture(); await view.settle();
  for (const label of ['ERP 已收数量', '40', '本台账实收', '10', '待判定', '未检验', '本台账不增加库存，ERP 同步数量单独核对。']) assert.ok(view.text().includes(label), label);
  assert.equal(view.button('确认合格入库'), undefined);
  assert.equal(view.node('SheetContent').props.onCloseAutoFocus, view.props.onCloseAutoFocus);
});

test('无详情权限不读取，收货和检验权限各自控制操作并与后端权限取交集', async () => {
  const denied = fixture({ permissions: [] }); await denied.settle(); assert.equal(denied.reads.length, 0); assert.match(denied.text(), /没有采购订单详情查看权限/);
  const readonly = fixture({ permissions: ['page:purchase-order-detail'] }); await readonly.settle(); assert.equal(readonly.reads.length, 1); assert.equal(readonly.button('登记收货'), undefined); assert.equal(readonly.button('记录检验结果：DN-receipt-1'), undefined);
  const receiver = fixture({ permissions: ['page:purchase-order-detail', 'proc-purchase-order:receive'] }); await receiver.settle(); assert.ok(receiver.button('登记收货')); assert.equal(receiver.button('记录检验结果：DN-receipt-1'), undefined);
  const serverDenied = fixture({ response: ledger({ canReceive: false, canInspect: false }) }); await serverDenied.settle(); assert.equal(serverDenied.button('登记收货'), undefined); assert.equal(serverDenied.button('记录检验结果：DN-receipt-1'), undefined);
});

test('订单来源不完整或阻断时只能查看；历史批次源变化不能记录检验', async () => {
  for (const response of [ledger({ sourceIssue: '订单行未正式关联' }), ledger({ line: { ...ledger().line, updatedAt: '' } })]) {
    const view = fixture({ response }); await view.settle(); assert.equal(view.button('登记收货'), undefined); assert.equal(view.button('记录检验结果：DN-receipt-1'), undefined);
  }
  const changed = fixture({ response: ledger({ receipts: [receipt('receipt-1', { sourceChanged: true })] }) }); await changed.settle();
  assert.equal(changed.button('记录检验结果：DN-receipt-1').props.disabled, true); assert.match(changed.text(), /订单物料或单位已变化/);
});

test('每页十批，分页在批次前，不改变草稿', async () => {
  const view = fixture({ response: ledger({ receipts: Array.from({ length: 23 }, (_, index) => receipt(`batch-${index}`)) }) }); await view.settle();
  assert.match(view.text(), /第 1 \/ 3 页，共 23 批/); assert.equal(view.nodes().filter((n) => n.type === 'li').length, 10);
  assert.ok(view.nodes().findIndex((n) => n.props?.['aria-label'] === '下一页收货记录') < view.nodes().findIndex((n) => n.type === 'li'));
  fillReceipt(view); view.click('下一页收货记录'); assert.equal(view.field('deliveryNo').props.value, 'DN-NEW'); assert.match(view.text(), /第 2 \/ 3 页/);
  view.click('下一页收货记录'); assert.equal(view.nodes().filter((n) => n.type === 'li').length, 3);
});

test('打开收货表单时只预填中国当日日期，实收数量空白，合法输入保存对应精确行', async () => {
  const view = fixture(); await view.settle(); view.click('登记收货');
  assert.equal(view.field('receivedQty').props.value, ''); assert.match(view.field('date').props.value, /^\d{4}-\d{2}-\d{2}$/);
  view.fill('deliveryNo', ' DN-TEST '); view.fill('receivedQty', '2.5'); view.fill('date', '2020-02-02'); await view.submit(); await view.settle();
  assert.equal(view.receives.length, 1); assert.equal(view.receives[0].lineId, 'line-1');
  assert.deepEqual({ ...view.receives[0].payload, requestId: 'uuid' }, { requestId: 'uuid', expectedSourceUpdatedAt: ledger().line.updatedAt, deliveryNo: 'DN-TEST', receivedDate: '2020-02-02', receivedQty: 2.5, note: '' });
  assert.equal(view.node('form'), undefined); assert.match(view.text(), /收货已登记/);
});

test('前端拒绝零量、指数、过多小数及未来日期，不发送收货请求', async () => {
  const view = fixture(); await view.settle(); fillReceipt(view);
  for (const qty of ['0', '-1', '1e3', '0.1234', '']) { view.fill('receivedQty', qty); await view.submit(); await view.settle(); assert.equal(view.receives.length, 0); }
  view.fill('receivedQty', '1'); view.fill('date', '9999-01-01'); await view.submit(); await view.settle(); assert.equal(view.receives.length, 0); assert.match(view.text(), /不能晚于今天/);
});

test('检验按本批累计结果保存，待判定单列并计算剩余未检验数量', async () => {
  const view = fixture(); await view.settle(); fillInspection(view);
  assert.match(view.text(), /填写本批累计数量，将替换当前结果，历史保留/); assert.match(view.text(), /未检验数量\s+1/);
  await view.submit(); await view.settle(); assert.equal(view.inspections.length, 1);
  const saved = view.inspections[0]; assert.equal(saved.receiptId, 'receipt-1'); assert.equal(saved.payload.qualifiedQty, 6); assert.equal(saved.payload.defectiveQty, 1); assert.equal(saved.payload.pendingJudgmentQty, 2); assert.equal(saved.payload.expectedVersion, 0);
  assert.equal(saved.payload.treeNodeId, 'quality-valve');
});

test('不良归属读取当前订单行选项，统一选择器保留必填、选择和保存锁定', async () => {
  const pending = deferred();
  const view = fixture({ inspect: () => pending.promise }); await view.settle();
  assert.equal(view.qualityReads.length, 0);
  fillInspection(view); await view.settle();
  assert.equal(view.qualityReads.length, 1); assert.equal(view.qualityReads[0].lineId, 'line-1');
  assert.equal(view.field('quality-node').type, 'NativeSelect'); assert.equal(view.field('quality-node').props.required, true);
  assert.match(text(view.field('quality-node')), /制氧机.*阀体/);
  const saving = view.submit();
  assert.equal(view.field('quality-node').props.disabled, true); assert.equal(view.inspections[0].payload.treeNodeId, 'quality-valve');
  pending.resolve(ledger()); await saving; await view.settle();
  assert.equal(view.qualityReads[0].signal.aborted, true);
});

test('质量归属读取失败保留检验草稿并显示错误，不伪造可选项', async () => {
  const view = fixture({ qualityOptions: () => { throw new Error('质量目录暂时不可用'); } });
  await view.settle(); view.click('记录检验结果：DN-receipt-1'); view.fill('defectiveQty', '1'); await view.settle();
  assert.match(view.text(), /质量目录暂时不可用/); assert.equal(view.field('defectiveQty').props.value, '1');
  assert.equal(view.field('quality-node').props.value, ''); assert.equal(view.inspections.length, 0);
  assert.equal(elements(view.field('quality-node')).filter(node => node.type === 'option').length, 1);
});

test('检验不允许累计超收货、早于收货日、缺依据和缺结论说明', async () => {
  const view = fixture(); await view.settle(); fillInspection(view); view.fill('qualifiedQty', '8'); await view.submit(); await view.settle(); assert.match(view.text(), /合计不能超过本批实收/);
  view.fill('qualifiedQty', '6'); view.fill('date', '2019-12-31'); await view.submit(); await view.settle(); assert.match(view.text(), /不能早于本批收货/);
  view.fill('date', '2020-02-02'); view.fill('basis', ''); await view.submit(); await view.settle(); assert.match(view.text(), /请填写检验依据/);
  view.fill('basis', 'SIP'); view.fill('note', ''); await view.submit(); await view.settle(); assert.match(view.text(), /请填写检验结论说明/); assert.equal(view.inspections.length, 0);
});

test('已有检验累计数量带入表单，完整版本历史保留在可展开区域', async () => {
  const inspections = [2, 1].map((version) => ({ id: `i-${version}`, version, inspectionDate: '2020-01-03', qualifiedQty: 6, defectiveQty: 1, pendingJudgmentQty: 2, pendingQty: 1, basis: 'SIP V1.0', note: `第 ${version} 版说明`, createdByName: '检验员', createdAt: '2020-01-03T01:00:00Z' }));
  const view = fixture({ response: ledger({ receipts: [receipt('receipt-1', { version: 2, qualifiedQty: 6, defectiveQty: 1, pendingJudgmentQty: 2, pendingQty: 1, inspections })] }) }); await view.settle();
  assert.ok(view.node('details')); assert.match(view.text(), /第 2 版说明/); assert.match(view.text(), /第 1 版说明/);
  view.click('记录检验结果：DN-receipt-1'); assert.equal(view.field('qualifiedQty').props.value, '6'); assert.equal(view.field('pendingJudgmentQty').props.value, '2');
});

test('保存双击只发一次，保存中不能关闭或丢弃草稿', async () => {
  const pending = deferred(); const view = fixture({ receive: () => pending.promise }); await view.settle(); fillReceipt(view);
  const submit = view.node('form').props.onSubmit;
  const first = submit({ preventDefault() {} }); submit({ preventDefault() {} }); view.render(); assert.equal(view.receives.length, 1);
  view.node('Sheet').props.onOpenChange(false); assert.equal(view.closed(), 0); assert.equal(view.node('SheetContent').props.closeDisabled, true);
  let prevented = 0; view.node('SheetContent').props.onEscapeKeyDown({ preventDefault() { prevented += 1; } }); assert.equal(prevented, 1);
  pending.resolve(ledger()); await first; await view.settle(); assert.equal(view.node('SheetContent').props.closeDisabled, false);
});

test('未确认失败重试复用 requestId，用户改动有效载荷后生成新 requestId', async () => {
  const view = fixture({ receive: () => { throw new RequestError('网络未确认', 503); } }); await view.settle(); fillReceipt(view);
  await view.submit(); await view.settle(); await view.submit(); await view.settle();
  assert.equal(view.receives[0].payload.requestId, view.receives[1].payload.requestId);
  view.fill('receivedQty', '6'); await view.submit(); await view.settle(); assert.notEqual(view.receives[2].payload.requestId, view.receives[1].payload.requestId);
});

test('409 必须重新读取并显式核对，保留草稿，保存使用新版本与来源时间', async () => {
  let attempt = 0;
  const view = fixture({ inspect: () => { if (attempt++ === 0) throw new RequestError('检验版本已变化', 409); return ledger(); } }); await view.settle(); fillInspection(view);
  await view.submit(); await view.settle(); assert.equal(view.button('保存检验结果').props.disabled, true); assert.ok(view.button('重新载入后核对'));
  view.setResponse(ledger({ line: { ...ledger().line, updatedAt: '2020-02-02T01:00:00Z' }, receipts: [receipt('receipt-1', { version: 2 })] }));
  view.click('重新载入后核对'); await view.settle(); assert.equal(view.field('qualifiedQty').props.value, '6'); assert.equal(view.button('保存检验结果').props.disabled, true);
  view.click('已核对，继续填写'); await view.submit(); await view.settle(); assert.equal(view.inspections.length, 2);
  assert.equal(view.inspections[1].payload.expectedVersion, 2); assert.equal(view.inspections[1].payload.expectedSourceUpdatedAt, '2020-02-02T01:00:00Z'); assert.notEqual(view.inspections[0].payload.requestId, view.inspections[1].payload.requestId);
});

test('冲突刷新后若源已变化，保留草稿但不可确认继续或提交', async () => {
  const view = fixture({ inspect: () => { throw new RequestError('来源变化', 409); } }); await view.settle(); fillInspection(view); await view.submit(); await view.settle();
  view.setResponse(ledger({ receipts: [receipt('receipt-1', { sourceChanged: true })] })); view.click('重新载入后核对'); await view.settle();
  assert.equal(view.button('已核对，继续填写').props.disabled, true); assert.equal(view.button('保存检验结果').props.disabled, true); assert.equal(view.field('note').props.value, '按图纸核对，外观 1 件不良，2 件待判定。');
});

test('读取失败在原区域提供重试，返回别的订单行或单号不接受', async () => {
  let failed = true; const view = fixture({ get: () => { if (failed) throw new Error('暂时不可用'); return ledger(); } }); await view.settle(); assert.match(view.text(), /暂时不可用/); assert.ok(view.button('重新读取'));
  failed = false; view.click('重新读取'); await view.settle(); assert.ok(view.button('登记收货'));
  for (const line of [{ ...ledger().line, id: 'other' }, { ...ledger().line, orderNo: 'PO-other' }]) { const wrong = fixture({ response: ledger({ line }) }); await wrong.settle(); assert.match(wrong.text(), /订单行关联已变化/); assert.equal(wrong.button('登记收货'), undefined); }
});

test('切换行、用户或权限后旧请求被中止，晚到数据不泄漏到新范围', async () => {
  for (const change of [(v) => v.setProps({ lineId: 'line-2', orderNo: 'PO-2' }), (v) => v.setUser({ id: 'other-user' }), (v) => v.setPermissions([])]) {
    const old = deferred(); let calls = 0;
    const view = fixture({ get: () => ++calls === 1 ? old.promise : ledger({ line: { ...ledger().line, id: 'line-2', orderNo: 'PO-2', inventoryName: '新范围' } }) });
    change(view); await view.settle(); assert.equal(view.reads[0].signal.aborted, true);
    old.resolve(ledger({ line: { ...ledger().line, inventoryName: '旧范围敏感物料' } })); await view.settle(); assert.doesNotMatch(view.text(), /旧范围敏感物料/);
  }
});

test('权限改变后旧保存回调不发送请求；在途保存返回不能覆盖新用户数据', async () => {
  const view = fixture(); await view.settle(); fillReceipt(view); const oldSubmit = view.node('form').props.onSubmit;
  view.setPermissions(['page:purchase-order-detail']); await view.settle(); await oldSubmit({ preventDefault() {} }); assert.equal(view.receives.length, 0);
  const pending = deferred(); const saving = fixture({ receive: () => pending.promise }); await saving.settle(); fillReceipt(saving); const result = saving.submit(); saving.setUser({ id: 'new-user' }); await saving.settle();
  pending.resolve(ledger({ line: { ...ledger().line, inventoryName: '旧用户回包' } })); await result; await saving.settle(); assert.doesNotMatch(saving.text(), /旧用户回包/); assert.equal(saving.node('SheetContent').props.closeDisabled, false);
});

test('未改动表单直接关闭，填写草稿关闭或切换批次使用 AlertDialog', async () => {
  const clean = fixture(); await clean.settle(); clean.click('登记收货'); clean.node('Sheet').props.onOpenChange(false); assert.equal(clean.closed(), 1);
  const view = fixture(); await view.settle(); fillReceipt(view); view.node('Sheet').props.onOpenChange(false); view.render(); assert.equal(view.closed(), 0); assert.equal(view.node('AlertDialog').props.open, true);
  view.click('继续填写'); assert.equal(view.closed(), 0); assert.equal(view.field('deliveryNo').props.value, 'DN-NEW');
  view.node('Sheet').props.onOpenChange(false); view.render(); view.click('放弃草稿'); assert.equal(view.closed(), 1);
});

test('实收不超过本台账剩余可登记量，精度和单号长度与服务端一致', async () => {
  const view = fixture(); await view.settle(); fillReceipt(view);
  assert.match(view.text(), /本台账剩余可登记量\s*：\s*90\s+件/); assert.equal(view.field('receivedQty').props.step, '0.001'); assert.equal(view.field('deliveryNo').props.maxLength, 120);
  view.fill('receivedQty', '90.001'); await view.submit(); await view.settle(); assert.match(view.text(), /不能超过剩余可登记量 90\s+件/); assert.equal(view.receives.length, 0);
  view.fill('receivedQty', '90'); view.fill('deliveryNo', 'A'.repeat(121)); await view.submit(); await view.settle(); assert.match(view.text(), /不能超过 120 个字符/); assert.equal(view.receives.length, 0);
});

test('打开收货或检验表单时滚动并聚焦首字段，后续填写不抢焦点', async () => {
  const view = fixture(); await view.settle(); view.click('登记收货'); assert.equal(view.focused.at(-1), 'receipt-deliveryNo'); assert.equal(view.scrolled.at(-1), 'form');
  const count = view.focused.length; view.fill('deliveryNo', 'DN-new'); assert.equal(view.focused.length, count);
  view.click('记录检验结果：DN-receipt-1'); view.click('放弃草稿'); assert.equal(view.focused.at(-1), 'receipt-date');
});

test('ERP 单位变化后历史卡片、检验历史及台账汇总保留登记时单位并提供来源核对', async () => {
  const item = receipt('receipt-1', { sourceChanged: true, inspections: [{ id: 'i-1', version: 1, inspectionDate: '2020-01-02', qualifiedQty: 7, defectiveQty: 1, pendingJudgmentQty: 1, pendingQty: 1, basis: 'SIP', note: '结果说明', createdByName: '检验员', createdAt: '2020-01-02T01:00:00Z' }] });
  const view = fixture({ response: ledger({ line: { ...ledger().line, unit: '箱', spec: 'B型' }, receipts: [item], summaryUnit: '件', sourceIssue: '单位发生变化' }) }); await view.settle();
  const card = view.nodes().find((node) => node.type === 'li'); assert.match(text(card), /实收\s+10\s+件/); assert.doesNotMatch(text(card), /箱/); assert.match(text(card), /查看登记时的订单来源/); assert.match(text(card), /A型/); assert.match(text(card), /本批累计数量\s*·\s+件/);
  const aside = view.node('aside'); assert.match(text(aside), /本台账实收\s+10\s+件/); assert.doesNotMatch(text(aside), /箱/);
});

test('历史批次单位不一致时不相加，逐批保留原单位并关闭登记操作', async () => {
  const view = fixture({ response: ledger({ receipts: [receipt('one'), receipt('two', { source: { ...receipt().source, unit: '箱' } })] }) }); await view.settle();
  assert.match(view.text(), /历史批次存在不同单位，请逐批核对数量，暂不合计/); assert.doesNotMatch(text(view.node('aside')), /本台账实收/); assert.equal(view.button('登记收货'), undefined);
  const cards = view.nodes().filter((node) => node.type === 'li'); assert.match(text(cards[0]), /实收\s+10\s+件/); assert.match(text(cards[1]), /实收\s+10\s+箱/);
});

test('收货或检验保存成功后滚入并聚焦成功状态，重新填写不会抢焦点', async () => {
  for (const fill of [fillReceipt, fillInspection]) {
    const view = fixture(); await view.settle(); fill(view);
    assert.notEqual(view.focused.at(-1), 'purchase-receipt-notice');
    await view.submit(); await view.settle();
    assert.equal(view.focused.at(-1), 'purchase-receipt-notice'); assert.equal(view.scrolled.at(-1), 'p');
    const status = view.nodes().find((node) => node.props?.id === 'purchase-receipt-notice');
    assert.equal(status.props.role, 'status'); assert.equal(status.props.tabIndex, -1); assert.equal(view.node('form'), undefined);
    view.click('登记收货'); const count = view.focused.length; view.fill('deliveryNo', 'DN-NEXT'); assert.equal(view.focused.length, count);
  }
});
