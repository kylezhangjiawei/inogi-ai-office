import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const load = (path, dependencies) => {
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {}; new Function('exports', 'require', code)(exports, (name) => { assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name]; }); return exports;
};
const ledger = () => ({ line: { id: 'line-1', orderNo: 'PO-1', lineNo: '1', name: '轴承', unit: '件', updatedAt: '2026-09-10T01:00:00.000Z' }, version: 2, canPropose: true, canApprove: true, canReadAffectedPlans: true, entries: [],
  summary: { erpOrderedQty: 20, erpReceivedQty: 10, effectiveOrderedQty: 20, effectiveReceivedQty: 10, remainingQty: 10, localGrossReceivedQty: 10, localNetReceivedQty: 10, localQualifiedQty: 6, qualifiedAvailableQty: null, cancelledQty: 0, returnedQty: 0, reversedQty: 0, coverageComplete: false, coverageCurrent: false, issues: [], receipts: [{ id: 'r-1', qualifiedQty: 6, defectiveQty: 1, pendingJudgmentQty: 2, pendingQty: 1, netReceivedQty: 10 }] },
  receiptOptions: [{ id: 'r-1', deliveryNo: 'DEL-1', receivedDate: '2026-09-01' }], affectedPlans: [] });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const children = (value) => Array.isArray(value) ? value.flatMap(children) : value && typeof value === 'object' ? [value, ...children(value.props?.children)] : [];
const text = (value) => Array.isArray(value) ? value.map(text).join(' ') : value == null || typeof value === 'boolean' ? '' : typeof value === 'object' ? text(value.props?.children) : String(value);
const t = (s, params = {}) => s.replace(/\{(\w+)\}/g, (m, k) => params[k] ?? m);
function fixture(ctx, { value = ledger(), get = async () => value, propose = async () => value, decide = async () => value } = {}) {
  const slots = [], effects = []; let cursor = 0, changed = false, unmounted = false, tree, sessionKey, generation = 0;
  let user = { id: 'qa-user', permissions: ['*'] };
  const depsChanged = (a, b) => !a || !b || a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]));
  const react = {
    useState(initial) { const index = cursor++, currentGeneration = generation; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], (v) => { if (!unmounted && currentGeneration === generation) { slots[index] = typeof v === 'function' ? v(slots[index]) : v; changed = true; } }]; },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useEffect(fn, deps) { const index = cursor++, before = slots[index]; if (depsChanged(before?.deps, deps)) { const next = { deps }; slots[index] = next; effects.push(() => { before?.cleanup?.(); next.cleanup = fn(); }); } },
  };
  const calls = { proposed: [], decisions: [], close: 0, saved: 0, reads: [] };
  const primitive = new Proxy({}, { get: (_x, key) => key });
  const jsx = (type, props, key) => {
    if (typeof type !== 'function') return { type, props };
    if (sessionKey !== key) {
      for (const slot of slots) slot?.cleanup?.();
      slots.length = 0; effects.length = 0; cursor = 0; generation++; sessionKey = key;
    }
    return type(props);
  };
  const { PurchaseFulfillmentDrawer } = load('src/app/order-processing/components/PurchaseFulfillmentDrawer.tsx', {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' }, '../../auth': { useAuth: () => ({ user }) }, '../../components/ui/dialog': primitive, '../../components/ui/alert-dialog': primitive, '../../components/ui/button': primitive, '../../lib/i18n': { useI18n: () => ({ t }), i18nLocale: () => 'zh-CN' }, './purchase-fulfillment.css': {},
    '../../lib/purchaseFulfillmentApi': { getPurchaseFulfillment: async (...args) => { calls.reads.push(args); return get(...args); }, proposePurchaseFulfillment: async (...args) => { calls.proposed.push(args); return propose(...args); }, decidePurchaseFulfillment: async (...args) => { calls.decisions.push(args); return decide(...args); } },
  });
  let props = { lineId: 'line-1', onClose: () => { calls.close++; }, onSaved: () => { calls.saved++; } };
  const f = { calls,
    render() { for (let n = 0; n < 20; n++) { cursor = 0; changed = false; tree = PurchaseFulfillmentDrawer(props); while (effects.length) effects.shift()(); if (!changed) return tree; } assert.fail('Did not settle'); },
    async flush() { this.render(); await new Promise(setImmediate); return this.render(); },
    button(label) { return children(this.render()).find((node) => node.type === 'Button' && text(node).trim() === label); },
    field(label) { const parent = children(this.render()).find((node) => node.type === 'label' && text(node).trim().startsWith(label)); assert.ok(parent, label); return children(parent).find((node) => ['input', 'textarea', 'select'].includes(node.type)); },
    change(label, value) { this.field(label).props.onChange({ target: { value } }); this.render(); },
    setProps(next) { props = { ...props, ...next }; this.render(); },
    setUser(next) { user = next; this.render(); },
    close() { children(this.render()).find((node) => node.type === 'Dialog').props.onOpenChange(false); },
    unmount() { unmounted = true; for (const s of slots) s?.cleanup?.(); },
  };
  ctx.after(() => f.unmount()); f.render(); return f;
}
test('read shows ERP, local and net quantities separately; coverage unknown remains explicit', async (ctx) => {
  const f = fixture(ctx); const output = text(await f.flush());
  for (const phrase of ['ERP 累计原值', '本地收货证据', '批准调整后', '覆盖待核对', '检验可用', '待核对']) assert.ok(output.includes(phrase));
  assert.equal(f.calls.proposed.length, 0); assert.equal(f.calls.decisions.length, 0);
});
test('read-only permission hides proposal and approval controls', async (ctx) => {
  const value = ledger(); value.canPropose = false; value.canApprove = false;
  const f = fixture(ctx, { value }); await f.flush(); assert.equal(f.button('登记待确认'), undefined); assert.equal(f.button('审核批准'), undefined);
});
test('proposal uses current version, reason and one request ID; immediate duplicate click and close are locked', async (ctx) => {
  const gate = deferred(), f = fixture(ctx, { propose: () => gate.promise }); await f.flush();
  f.change('调整数量', '3'); f.change('依据与原因', '供应商同意取消'); const click = f.button('登记待确认').props.onClick; click(); click(); f.close();
  assert.equal(f.calls.proposed.length, 1); assert.equal(f.calls.close, 0); assert.equal(f.button('关闭').props.disabled, true);
  const input = f.calls.proposed[0][1]; assert.equal(input.expectedVersion, 2); assert.equal(input.expectedSourceUpdatedAt, ledger().line.updatedAt); assert.equal(input.quantity, 3); assert.equal(input.reason, '供应商同意取消'); assert.equal(input.kind, 'cancel');
  gate.resolve(ledger()); await f.flush(); assert.equal(f.calls.saved, 1); assert.equal(f.button('关闭').props.disabled, false);
});
test('failed exact submission can retry with the same identity and retains entered content', async (ctx) => {
  let count = 0; const f = fixture(ctx, { propose: async () => { if (++count === 1) throw new Error('超时待确认'); return ledger(); } }); await f.flush();
  f.change('调整数量', '2'); f.change('依据与原因', '核对单'); f.button('登记待确认').props.onClick(); await f.flush();
  assert.equal(f.field('调整数量').props.value, '2'); assert.equal(f.field('依据与原因').props.value, '核对单'); f.button('登记待确认').props.onClick(); await f.flush();
  assert.equal(f.calls.proposed[0][1].requestId, f.calls.proposed[1][1].requestId); assert.equal(f.calls.saved, 1);
});
test('approval is a distinct explicit action with its own required reason', async (ctx) => {
  const value = ledger(); value.entries = [{ id: 'entry-1', kind: 'cancel', status: 'pending', quantity: 2, receiptId: null, bucket: null, reason: '取消申请', createdByName: '采购甲', createdAt: '2026-09-10T01:00:00Z', reflectedEntryIds: [], history: [] }];
  const f = fixture(ctx, { value }); await f.flush(); f.button('审核批准').props.onClick(); f.render();
  assert.equal(f.button('确认批准').props.disabled, true); assert.equal(f.button('登记待确认').props.disabled, true);
  f.change('本次审核依据', '对照取消协议批准'); f.button('确认批准').props.onClick(); await f.flush();
  assert.equal(f.calls.proposed.length, 0); assert.equal(f.calls.decisions.length, 1); assert.deepEqual(f.calls.decisions[0].slice(0, 3), ['line-1', 'entry-1', 'approve']);
});
test('late save after unmount cannot refresh the new page', async (ctx) => {
  const gate = deferred(), f = fixture(ctx, { propose: () => gate.promise }); await f.flush(); f.change('调整数量', '2'); f.change('依据与原因', '核对'); f.button('登记待确认').props.onClick(); f.unmount(); gate.resolve(ledger()); await new Promise(setImmediate); assert.equal(f.calls.saved, 0);
});
test('unchanged close exits directly; field and approval drafts require explicit discard from either close entry', async (ctx) => {
  const f = fixture(ctx); await f.flush(); f.close(); assert.equal(f.calls.close, 1);
  f.change('调整数量', '2'); f.button('关闭').props.onClick();
  let dialog = children(f.render()).find((node) => node.type === 'AlertDialog'); assert.equal(dialog.props.open, true); assert.equal(f.calls.close, 1);
  dialog.props.onOpenChange(false); assert.equal(f.field('调整数量').props.value, '2');
  f.close(); dialog = children(f.render()).find((node) => node.type === 'AlertDialog'); assert.equal(dialog.props.open, true);
  children(f.render()).find((node) => node.type === 'AlertDialogAction').props.onClick(); assert.equal(f.calls.close, 2);
});
test('successful proposal resets all draft selectors; approval does not erase a separate proposal draft', async (ctx) => {
  const value = ledger(); value.entries = [{ id: 'entry-1', kind: 'cancel', status: 'pending', quantity: 2, receiptId: null, bucket: null, reason: '取消申请', createdByName: '采购甲', createdAt: '2026-09-10T01:00:00Z', reflectedEntryIds: [], history: [] }];
  const f = fixture(ctx, { value }); await f.flush(); f.change('事项', 'return'); f.change('收货记录', 'r-1'); f.change('扣减哪类数量', 'qualified'); f.change('调整数量', '1'); f.change('依据与原因', '退货单');
  f.button('登记待确认').props.onClick(); await f.flush(); f.close(); assert.equal(f.calls.close, 1);
  f.change('调整数量', '2'); f.change('依据与原因', '保留的取消草稿'); f.button('审核批准').props.onClick(); f.change('本次审核依据', '审批依据'); f.button('确认批准').props.onClick(); await f.flush();
  assert.equal(f.field('依据与原因').props.value, '保留的取消草稿'); f.close(); assert.equal(f.calls.close, 1); assert.equal(children(f.render()).find((node) => node.type === 'AlertDialog').props.open, true);
});
test('user and permission changes clear draft, abort old reads and reject callbacks from the old scope', async (ctx) => {
  const f = fixture(ctx); await f.flush(); f.change('调整数量', '2'); f.change('依据与原因', '旧账号依据');
  const staleSave = f.button('登记待确认').props.onClick, oldRead = f.calls.reads[0];
  f.setUser({ id: 'qa-other', permissions: ['*'] }); await f.flush();
  assert.equal(oldRead[1].aborted, true); assert.equal(f.field('依据与原因').props.value, ''); assert.equal(f.field('调整数量').props.value, '');
  staleSave(); assert.equal(f.calls.proposed.length, 0);
  f.change('依据与原因', '新账号草稿'); f.setUser({ id: 'qa-other', permissions: ['page:purchase-order-detail'] }); await f.flush();
  assert.equal(f.field('依据与原因').props.value, ''); assert.equal(f.calls.reads.length, 3);
});
test('a save completing after account switch cannot replace the new ledger or refresh its parent', async (ctx) => {
  const gate = deferred(), next = ledger(); next.canPropose = false; next.canApprove = false; let reads = 0;
  const f = fixture(ctx, { get: async () => ++reads === 1 ? ledger() : next, propose: () => gate.promise }); await f.flush();
  f.change('调整数量', '2'); f.change('依据与原因', '旧账号依据'); f.button('登记待确认').props.onClick();
  f.setUser({ id: 'readonly-user', permissions: ['page:purchase-order-detail'] }); await f.flush();
  gate.resolve(ledger()); await f.flush(); assert.equal(f.calls.saved, 0); assert.equal(f.button('登记待确认'), undefined);
});
test('API rejects incomplete or mismatched successful response and safely encodes line identity', async () => {
  const calls = []; let response = ledger();
  const api = load('src/app/lib/purchaseFulfillmentApi.ts', { './authSession': { authFetch: async (...args) => { calls.push(args); return { ok: true, json: async () => response }; }, readErrorMessage: async () => '失败' } });
  assert.equal(api.isPurchaseFulfillmentLedger(response), true);
  response = { ...ledger(), entries: [{ id: 'malformed' }] }; assert.equal(api.isPurchaseFulfillmentLedger(response), false); await assert.rejects(api.getPurchaseFulfillment('line-1'), /不完整/);
  response = ledger(); await assert.rejects(api.getPurchaseFulfillment('line/other?x=1'), /不匹配/); assert.ok(calls.at(-1)[0].includes('line%2Fother%3Fx%3D1'));
  const signal = AbortSignal.abort(); await assert.rejects(api.getPurchaseFulfillment('line-1', signal), /取消/);
});
