import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const code = ts.transpileModule(readFileSync(new URL('../src/app/lib/purchaseReceiptApi.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const source = { orderId: 'erp-1', orderNo: 'PO/1', lineNo: '1', inventoryCode: 'A01', inventoryName: '壳体', spec: 'V1', unit: '件', supplierName: '甲厂', orderedQty: 10, updatedAt: '2026-09-10T00:00:00.000Z' };
const q = { receivedQty: 4, qualifiedQty: 2, defectiveQty: 0, pendingJudgmentQty: 1, pendingQty: 1 };
const ledger = () => ({
  line: { id: 'line/1', ...source, tpOrderId: source.orderId, orderedQty: 10, erpReceivedQty: 4, status: '1', approvalStatus: '已审核' },
  canReceive: true, canInspect: true, sourceIssue: null, summaryUnit: '件', summary: { ...q },
  receipts: [{ id: 'receipt/1', deliveryNo: 'DN-1', receivedDate: '2026-09-01', ...q, note: '', createdByName: '仓管甲', createdAt: source.updatedAt, sourceChanged: false, version: 1, source,
    inspections: [{ id: 'qc-1', version: 1, inspectionDate: '2026-09-02', qualifiedQty: 2, defectiveQty: 0, pendingJudgmentQty: 1, pendingQty: 1, basis: '全检', note: '一件待判', createdByName: 'QC', createdAt: source.updatedAt }] }],
});
const response = (body = ledger(), status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const input = { requestId: 'unchanged-request-id', expectedSourceUpdatedAt: source.updatedAt, deliveryNo: 'DN-1', receivedDate: '2026-09-01', receivedQty: 4, note: '' };
function load(authFetch) {
  const exported = {};
  new Function('exports', 'require', code)(exported, (name) => {
    assert.equal(name, './authSession');
    return { authFetch, readErrorMessage: async () => '订单已更新' };
  });
  return exported;
}

test('receipt client keeps exact line/receipt identities, request body and dedicated paths', async () => {
  const calls = []; const api = load(async (...args) => { calls.push(args); return response(); });
  await api.getPurchaseReceipts('line/1');
  await api.createPurchaseReceipt('line/1', input);
  await api.createPurchaseInspection('line/1', 'receipt/1', { requestId: 'qc-same-id' });
  assert.equal(calls[0][0], '/api/procurement/purchase-order-lines/line%2F1/receipts');
  assert.equal(calls[1][1].body, JSON.stringify(input)); assert.equal(calls[1][1].method, 'POST');
  assert.equal(calls[2][0], '/api/procurement/purchase-order-lines/line%2F1/receipts/receipt%2F1/inspections');
});

test('receipt client exposes HTTP conflict status for explicit refresh instead of retrying a write', async () => {
  let calls = 0; const api = load(async () => { calls++; return response({}, 409); });
  await assert.rejects(api.createPurchaseReceipt('line/1', input), (error) => error instanceof api.PurchaseReceiptRequestError && error.status === 409);
  assert.equal(calls, 1);
});

test('receipt client validates nested source/history and finite quantities before rendering', async () => {
  const invalid = [null, {}, { ...ledger(), summaryUnit: undefined }];
  for (const mutate of [
    (value) => { delete value.receipts[0].source; },
    (value) => { value.receipts[0].inspections = null; },
    (value) => { value.receipts[0].inspections[0].pendingJudgmentQty = NaN; },
    (value) => { value.receipts[0].source.orderedQty = Infinity; },
    (value) => { value.summary.pendingQty = -1; },
  ]) { const value = structuredClone(ledger()); mutate(value); invalid.push(value); }
  for (const value of invalid) {
    const api = load(async () => response(value));
    await assert.rejects(api.getPurchaseReceipts('line/1'), (error) => error.status === 502);
  }
  assert.equal(load(async () => response()).isPurchaseReceiptLedger(ledger()), true);
});

test('receipt client treats malformed JSON success as uncertain response and preserves the supplied request', async () => {
  let body; const api = load(async (_path, init) => { body = init.body; return { ok: true, status: 200, json: async () => { throw new SyntaxError('unexpected HTML'); } }; });
  await assert.rejects(api.createPurchaseReceipt('line/1', input), (error) => error.status === 502);
  assert.equal(JSON.parse(body).requestId, input.requestId);
});

test('receipt write timeout ends after 30 seconds, aborts transport and preserves the same idempotency request', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal, body; const api = load((_path, init) => { signal = init.signal; body = init.body; return new Promise(() => {}); });
  const pending = api.createPurchaseReceipt('line/1', input);
  const rejected = assert.rejects(pending, (error) => error instanceof api.PurchaseReceiptRequestError && error.status === 0 && error.message.includes('结果尚未确认'));
  t.mock.timers.tick(29_999); assert.equal(signal.aborted, false);
  t.mock.timers.tick(1); await rejected;
  assert.equal(signal.aborted, true); assert.equal(JSON.parse(body).requestId, input.requestId);
});

test('read timeout has retryable read copy and never triggers a mutation', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0; const api = load(() => { calls++; return new Promise(() => {}); });
  const rejected = assert.rejects(api.getPurchaseReceipts('line/1'), (error) => error.status === 0 && error.message.includes('读取超时'));
  t.mock.timers.tick(30_000); await rejected; assert.equal(calls, 1);
});

test('external abort works before and during a request without reporting a save conflict or timeout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const before = new AbortController(); before.abort();
  let calls = 0, forwarded;
  const api = load((_path, init) => { calls++; forwarded = init.signal; return new Promise(() => {}); });
  await assert.rejects(api.getPurchaseReceipts('line/1', before.signal), (error) => error.name === 'AbortError'); assert.equal(calls, 0);
  const during = new AbortController();
  const rejected = assert.rejects(api.createPurchaseReceipt('line/1', input, during.signal), (error) => error.name === 'AbortError');
  during.abort(); await rejected; assert.equal(forwarded.aborted, true);
  t.mock.timers.tick(30_000); assert.equal(calls, 1);
});

test('successful requests detach external abort listener and clear their deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let forwarded; const api = load(async (_path, init) => { forwarded = init.signal; return response(); });
  const external = new AbortController(); await api.getPurchaseReceipts('line/1', external.signal);
  external.abort(); t.mock.timers.tick(30_000); assert.equal(forwarded.aborted, false);
});


test('S10 新编号与附件字段兼容旧响应，并拒绝损坏的新增记录结构', async () => {
  const api = load(async () => response()), valid = ledger();
  Object.assign(valid.receipts[0], { receiptNumber: 'RCV-TEST', numberSource: 'system', files: [{ fileId: 'f1', name: '证据.png', mime: 'image/png', size: 20 }], warehouseRecord: null });
  assert.equal(api.isPurchaseReceiptLedger(valid), true); assert.equal(api.isPurchaseReceiptLedger(ledger()), true);
  for (const patch of [{ receiptNumber: 3 }, { numberSource: 'external-unknown' }, { files: {} }, { files: [{ fileId: 'f1', name: 'x', mime: 'image/png', size: -1 }] }, { warehouseRecord: { events: [] } }]) {
    const invalid = ledger(); Object.assign(invalid.receipts[0], patch); assert.equal(api.isPurchaseReceiptLedger(invalid), false);
  }
});

test('S10 新客户端不传送货单号也不补造，附件读取沿订单行和收货原记录授权', async () => {
  const calls = [], api = load(async (...args) => { calls.push(args); return response(); });
  const withoutNumber = { ...input }; delete withoutNumber.deliveryNo;
  await api.createPurchaseReceipt('line/1', withoutNumber); assert.equal('deliveryNo' in JSON.parse(calls[0][1].body), false);
  await api.getPurchaseReceiptAttachment('line/1', 'receipt/1', 'file/1');
  assert.equal(calls[1][0], '/api/procurement/purchase-order-lines/line%2F1/receipts/receipt%2F1/files/file%2F1');
});
