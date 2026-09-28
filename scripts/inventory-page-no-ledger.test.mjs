import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.join(process.cwd(), 'src/app/order-processing/pages/Inventory.tsx'), 'utf8');

test('inventory page does not duplicate warehouse operation ledger', () => {
  assert.doesNotMatch(source, /InventoryLedger/);
  assert.doesNotMatch(source, /批次与操作记录|库存主账与本地事件/);
});
