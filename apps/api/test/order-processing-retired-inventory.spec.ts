import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { retiredInventoryWrite } from '../src/modules/order-processing/retired-inventory';
import { OrderProcessingService } from '../src/modules/order-processing/order-processing.service';
test('retired stock writes always return 410 before any DB access', async () => {
  assert.throws(() => retiredInventoryWrite(), (error: any) => error.getStatus() === 410);
  const trap = new Proxy({}, { get: () => { throw new Error('DATABASE_ACCESSED'); } });
  const service = new OrderProcessingService(trap as any, trap as any, trap as any, trap as any);
  for (const run of [() => service.createStockIn({}), () => service.createStockOut('anything', {}), () => service.adjustInventory('anything', {}), () => service.recognizeStockIn([])]) await assert.rejects(run, (error: any) => error.getStatus() === 410);
});
