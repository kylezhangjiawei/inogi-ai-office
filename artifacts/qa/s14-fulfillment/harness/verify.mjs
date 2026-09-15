import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { receiptLedger, orders } from './fixtures.mjs';

const base = 'http://127.0.0.1:4184';
const read = async (path, options) => {
  const response = await fetch(base + path, options);
  return { status: response.status, data: await response.json() };
};
const page = await fetch(base + '/__qa/s14-fulfillment');
assert.equal(page.status, 200);
assert.match(await page.text(), /preview\.tsx/);
const health = await read('/__qa/health');
for (const id of Object.keys(orders)) {
  const response = await read('/api/procurement/tplus/views/purchase-orders/' + id);
  assert.equal(response.status, health.data.orderError ? 503 : 200);
  if (!health.data.orderError) assert.equal(response.data.order.id, id);
}
// Validate fixture receipts through the production parser, without importing real session code.
const source = readFileSync('src/app/lib/purchaseReceiptApi.ts', 'utf8').replace(/^import .*authSession.*;\n/m, '');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const { isPurchaseReceiptLedger } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
for (const order of Object.values(orders)) for (const item of order.items) {
  assert.equal(isPurchaseReceiptLedger(receiptLedger(item.id)), true, item.id);
  const response = await read('/api/procurement/purchase-order-lines/' + item.id + '/receipts');
  assert.equal(response.status, 200);
  assert.equal(response.data.line.id, item.id);
  assert.equal(response.data.line.orderNo, order.poNo);
}
assert.equal((await read('/api/procurement/tplus/views/purchase-orders/QA-S14-OVER', { method: 'PATCH', body: '{}' })).status, 405);
assert.equal((await read('/api/unknown-fixture-route')).status, 404);
const history = await read('/api/audit/logs?resourceId=QA-S14-OVER-line-1');
assert.equal(history.status, 200);
assert.deepEqual(history.data.items, []);
assert.ok((await read('/__qa/health')).data.requests.every((request) => request.authorization === false));
const transformed = await fetch(base + '/@fs' + process.cwd() + '/artifacts/qa/s14-fulfillment/harness/preview.tsx');
assert.equal(transformed.status, 200);
assert.match(await transformed.text(), /PurchaseOrderDetail/);
console.log('PASS: HTML, 3 order responses, 7 exact-line receipt ledgers, production ledger validator, empty audit, write rejection, unknown API rejection, tokenless requests, preview transform. Failure configuration was not changed.');
