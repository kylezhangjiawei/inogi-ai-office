import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { TplusOperationsService } from '../src/modules/procurement/tplus-operations.service';

test('TplusOperationsService aggregates multi-warehouse inventory and computes shortage status', async () => {
  const material = {
    id: 'material-1',
    name: '电池上壳',
    spec: '黑色',
    unit: '件',
    category: '结构件',
    safeStock: 10,
  };
  const prisma = {
    $transaction: async function (run: any) { return run(this); },
    runtimeState: { findMany: async () => [] },
    procInventoryBalance: {
      findMany: async () => [
        {
          materialId: material.id,
          tpInventoryCode: 'BT-001',
          materialName: material.name,
          spec: material.spec,
          unit: material.unit,
          warehouse: '上海仓',
          stockQty: 4,
          availableQty: 3,
          inTransitQty: 2,
          syncedAt: new Date('2026-07-29T08:00:00.000Z'),
          material,
        },
        {
          materialId: material.id,
          tpInventoryCode: 'BT-001',
          materialName: material.name,
          spec: material.spec,
          unit: material.unit,
          warehouse: '宁波仓',
          stockQty: 3,
          availableQty: 2,
          inTransitQty: 1,
          syncedAt: new Date('2026-07-29T09:00:00.000Z'),
          material,
        },
      ],
    },
  };
  const service = new TplusOperationsService(prisma as never);

  const result = await service.listInventory({ page: 1, pageSize: 50 });

  assert.equal(result.inventory.total, 1);
  assert.equal(result.inventory.items[0].stock, 7);
  assert.equal(result.inventory.items[0].available, 5);
  assert.equal(result.inventory.items[0].in, 3);
  assert.equal(result.inventory.items[0].out, 2);
  assert.equal(result.inventory.items[0].status, '偏低');
  assert.equal(result.inventory.items[0].warehouses.length, 2);
  assert.equal(result.syncedAt, '2026-07-29T09:00:00.000Z');
});

test('TplusOperationsService uses available quantity instead of on-hand quantity for inventory status', async () => {
  const prisma = {
    $transaction: async function (run: any) { return run(this); },
    runtimeState: { findMany: async () => [] },
    procInventoryBalance: {
      findMany: async () => [{
        materialId: 'material-1',
        tpInventoryCode: 'BT-001',
        materialName: '电池上壳',
        spec: '',
        unit: '件',
        warehouse: '上海仓',
        stockQty: 2,
        availableQty: 2,
        inTransitQty: 0,
        syncedAt: new Date('2026-07-29T09:00:00.000Z'),
        material: {
          id: 'material-1',
          name: '电池上壳',
          spec: '',
          unit: '件',
          category: '结构件',
          safeStock: 0,
        },
      }],
    },
  };
  const service = new TplusOperationsService(prisma as never);

  const result = await service.listInventory({ page: 1, pageSize: 50 });

  assert.equal(result.inventory.items[0].stock, 2);
  assert.equal(result.inventory.items[0].available, 2);
  assert.equal(result.inventory.items[0].status, '正常');
});

test('TplusOperationsService groups T+ purchase-order lines and derives arrival status', async () => {
  const common = {
    tpOrderId: 'tplus-order-1',
    supplierName: '明博',
    spec: '',
    unit: '件',
    orderDate: new Date('2026-07-28T00:00:00.000Z'),
    etaDate: new Date('2026-08-05T00:00:00.000Z'),
    approvalStatus: '已审核',
    status: 'audited',
    syncedAt: new Date('2026-07-29T09:00:00.000Z'),
  };
  const prisma = {
    $transaction: async function (run: any) { return run(this); },
    procPurchaseOrderMirror: {
      findMany: async () => [
        {
          ...common,
          id: 'line-1',
          tpOrderNo: 'PO-001',
          tpLineNo: '1',
          inventoryCode: 'BT-001',
          inventoryName: '电池上壳',
          orderedQty: 10,
          receivedQty: 10,
          unitPrice: 4.5,
        },
        {
          ...common,
          id: 'line-2',
          tpOrderNo: 'PO-001',
          tpLineNo: '2',
          inventoryCode: 'BT-002',
          inventoryName: '电池下壳',
          orderedQty: 10,
          receivedQty: 5,
          unitPrice: 6.5,
        },
      ],
    },
    procSupplier: {
      findMany: async () => [
        { name: '明博', contact: '王经理', phone: '13800000000', email: null },
      ],
    },
  };
  const service = new TplusOperationsService(prisma as never);

  const result = await service.listPurchaseOrders({ page: 1, pageSize: 50 });

  assert.equal(result.orders.total, 1);
  assert.equal(result.orders.items[0].items.length, 2);
  assert.equal(result.orders.items[0].status, '部分到货');
  assert.equal(result.orders.items[0].amount, 110);
  assert.equal(result.orders.items[0].supplierContact, '王经理');
  assert.equal(result.stats.inbound, 1);
});

test('TplusOperationsService clamps an out-of-range purchase-order page', async () => {
  const row = (poNo: string) => ({
    id: `line-${poNo}`,
    tpOrderId: poNo,
    tpOrderNo: poNo,
    tpLineNo: '1',
    supplierName: '明博',
    inventoryCode: 'BT-001',
    inventoryName: '电池上壳',
    spec: '',
    unit: '件',
    orderedQty: 10,
    receivedQty: 0,
    unitPrice: 4.5,
    orderDate: new Date('2026-07-28T00:00:00.000Z'),
    etaDate: null,
    approvalStatus: '已审核',
    status: 'audited',
    syncedAt: new Date('2026-07-29T09:00:00.000Z'),
  });
  const prisma = {
    $transaction: async function (run: any) { return run(this); },
    procPurchaseOrderMirror: { findMany: async () => [row('PO-002'), row('PO-001')] },
    procSupplier: { findMany: async () => [] },
  };
  const service = new TplusOperationsService(prisma as never);

  const result = await service.listPurchaseOrders({ page: 99, pageSize: 1 });

  assert.equal(result.orders.page, 2);
  assert.equal(result.orders.totalPages, 2);
  assert.equal(result.orders.items.length, 1);
});

test('TplusOperationsService exposes linked procurement tasks in purchase-order detail', async () => {
  const purchaseRow = {
    id: 'line-1',
    tpOrderId: 'tplus-order-1',
    tpOrderNo: 'PO-001',
    tpLineNo: '1',
    supplierName: '明博',
    inventoryCode: 'BT-001',
    inventoryName: '电池上壳',
    spec: '',
    unit: '件',
    orderedQty: 10,
    receivedQty: 5,
    unitPrice: 4.5,
    orderDate: new Date('2026-07-28T00:00:00.000Z'),
    etaDate: new Date('2026-08-05T00:00:00.000Z'),
    approvalStatus: '已审核',
    status: 'audited',
    syncedAt: new Date('2026-07-29T09:00:00.000Z'),
  };
  const prisma = {
    $transaction: async function (run: any) { return run(this); },
    procPurchaseOrderMirror: { findMany: async () => [purchaseRow] },
    procSupplier: { findFirst: async () => null },
    procPurchaseOrderRef: {
      findMany: async () => [
        {
          task: {
            id: 'task-1',
            code: 'PR-001',
            materialName: '电池上壳',
            status: 'partial_arrival',
            quantity: 10,
            arrivedQty: 5,
            buyer: '罗倩',
          },
        },
      ],
    },
  };
  const service = new TplusOperationsService(prisma as never);

  const result = await service.getPurchaseOrder('PO-001');

  assert.equal(result.order.taskLinks.length, 1);
  assert.equal(result.order.taskLinks[0].code, 'PR-001');
  assert.equal(result.order.taskLinks[0].arrivedQty, 5);
});

test('TplusOperationsService returns warehouse balances and related orders in inventory detail', async () => {
  let purchaseWhere: unknown;
  const prisma = {
    $transaction: async function (run: any) { return run(this); },
    runtimeState: { findMany: async () => [] },
    procInventoryBalance: {
      findMany: async () => [
        {
          materialId: 'material-1',
          tpInventoryCode: 'BT-001',
          materialName: '电池上壳',
          spec: '黑色',
          unit: '件',
          warehouse: '上海仓',
          stockQty: 8,
          availableQty: 6,
          inTransitQty: 2,
          syncedAt: new Date('2026-07-29T09:00:00.000Z'),
          material: {
            id: 'material-1',
            name: '电池上壳',
            spec: '黑色',
            unit: '件',
            category: '结构件',
            safeStock: 10,
          },
        },
      ],
    },
    procPurchaseOrderMirror: {
      findMany: async (query: { where: unknown }) => {
        purchaseWhere = query.where;
        return [
          {
            id: 'line-1',
            tpOrderNo: 'PO-001',
            supplierName: '明博',
            orderedQty: 10,
            receivedQty: 5,
            unitPrice: 4.5,
            orderDate: new Date('2026-07-28T00:00:00.000Z'),
            etaDate: null,
            approvalStatus: '已审核',
            status: 'audited',
            syncedAt: new Date('2026-07-29T09:00:00.000Z'),
          },
        ];
      },
    },
  };
  const service = new TplusOperationsService(prisma as never);

  const result = await service.getInventoryDetail('BT-001');

  assert.deepEqual(purchaseWhere, { inventoryCode: 'BT-001' });
  assert.equal(result.item.warehouses[0].name, '上海仓');
  assert.equal(result.relatedPurchaseOrders[0].poNo, 'PO-001');
  assert.equal(result.relatedPurchaseOrders[0].status, '部分到货');
});
