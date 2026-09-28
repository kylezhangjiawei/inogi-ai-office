// Isolated audit reproduction. Runs real services/helpers against an in-memory, read-only DB mock.
// No PrismaClient is instantiated; no database or network access is performed.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const apiRequire = createRequire(new URL('../../../apps/api/package.json', import.meta.url));
apiRequire('ts-node').register({
  transpileOnly: true,
  project: fileURLToPath(new URL('../../../apps/api/tsconfig.json', import.meta.url)),
});
const { Prisma } = apiRequire('@prisma/client');
const { ProductionReadinessService } = apiRequire('./src/modules/procurement/production-readiness.service.ts');
const { purchaseOrderSourceFingerprint } = apiRequire('./src/modules/procurement/purchase-order-availability.ts');
const { executionToday } = apiRequire('./src/modules/procurement/production-execution.model.ts');

const date = executionToday();
const day = new Date(`${date}T00:00:00.000Z`);
const d = value => new Prisma.Decimal(value);
const line = { id: 'M', code: 'M', name: '共享物料', unit: '件', qtyPer: 1 };
const plans = ['A', 'B'].map(id => ({
  id, month: date.slice(0, 7), version: 1, productId: `product-${id}`, productName: id,
  productLine: id, targetQty: 60, shipmentTargetQty: 60, bomFingerprint: `BOM-${id}`,
  bom: [line], batches: [{ id: `batch-${id}`, code: `batch-${id}`, quantity: 60, dueDate: date }],
  tasks: [], events: [],
}));
const order = {
  id: 'only-po-line', tpOrderId: 'only-po', tpOrderNo: 'PO-ONLY', tpLineNo: '1',
  inventoryCode: 'M', inventoryName: '共享物料', spec: '', unit: '件', supplierName: '供应商',
  status: null, approvalStatus: null, orderedQty: d(60), receivedQty: d(0), etaDate: day, receipts: [],
};
order.availability = {
  availableDate: day, confirmedAt: day, confirmedByName: '采购', version: 1, note: '已确认今日可用',
  sourceFingerprint: purchaseOrderSourceFingerprint(order),
};
const balance = {
  id: 'zero-stock', tpInventoryCode: 'M', warehouse: '量产仓', unit: '件',
  stockQty: d(0), availableQty: d(0), inTransitQty: d(60), syncedAt: day,
};
const state = new Map();
const put = (key, value) => state.set(key, { key, value: JSON.stringify(value) });
plans.forEach(plan => put(`procurement:execution:v1:plan:${plan.id}`, plan));
const queryLog = [];
const matches = (key, condition) => typeof condition === 'string' ? key === condition
  : condition.in ? condition.in.includes(key) : key.startsWith(condition.startsWith);
const db = {
  runtimeState: {
    findUnique: async ({ where }) => state.get(where.key) ?? null,
    findMany: async ({ where }) => [...state.values()].filter(row => where.OR
      ? where.OR.some(entry => matches(row.key, entry.key)) : matches(row.key, where.key)),
  },
  procInventoryBalance: {
    findMany: async ({ where }) => where.tpInventoryCode.in.includes('M') ? [balance] : [],
  },
  procPurchaseOrderMirror: {
    findMany: async ({ where }) => {
      queryLog.push(where);
      // Assert the real query contains no hidden plan/assignment filter, rather than ignoring it.
      assert.deepEqual(where, { inventoryCode: { in: ['M'] } });
      return [order];
    },
  },
};
const actor = { id: 'audit-planner', name: '只读审核', permissions: ['*'] };
const service = new ProductionReadinessService(db);
const readBoth = async phase => {
  const views = await Promise.all(plans.map(plan => service.read(plan.id, date, actor)));
  const result = views.map(view => ({
    planId: view.planId, remainingQty: view.remainingQty, currentSets: view.currentSets,
    projectedSets: view.projectedSets, incoming: view.lines[0].incoming,
    gap: view.lines[0].gap, problems: view.lines[0].problems,
    orders: view.lines[0].purchase.map(row => ({ id: row.id, quantity: row.quantity, included: row.included })),
  }));
  for (const row of result) {
    assert.equal(row.currentSets, 0);
    assert.equal(row.projectedSets, 60);
    assert.equal(row.incoming, 60);
    assert.equal(row.gap, 0);
    assert.deepEqual(row.problems, []);
  }
  return { phase, result };
};
const beforeDispatch = await readBoth('two formal plans, no dispatch');
for (const plan of plans) {
  const taskId = `task-${plan.id}`;
  plan.tasks.push({
    id: taskId, batchId: `batch-${plan.id}`, name: `作业-${plan.id}`, treeNodeId: `node-${plan.id}`,
    output: 'component', unit: '件', quantity: 60, date, line: '一线', ownerId: 'worker', ownerName: '现场',
    status: 'dispatched', reports: [], materials: [{ ...line, requiredQty: 60 }],
  });
  put(`procurement:execution:v1:plan:${plan.id}`, plan);
  put(`procurement:warehouse-flow:v1:issue:${taskId}`, {
    id: taskId, taskId, planId: plan.id, batchId: `batch-${plan.id}`, title: taskId,
    status: 'requested', lines: [{ ...line, quantity: 60, signedQty: 0 }], history: [],
  });
}
const afterDispatch = await readBoth('both dispatched, warehouse issue requests pending');
console.log(JSON.stringify({
  audit: 'S15 duplicate forecast supply across two plans', date,
  uniquePurchaseSupply: 60, planCount: 2, totalDemand: 120,
  beforeDispatch, afterDispatch, actualOrderQueries: queryLog,
  boundary: 'Real read/calculate and fulfillment/date helpers; read-only in-memory fixtures only. No DB writes or network.',
}, null, 2));
