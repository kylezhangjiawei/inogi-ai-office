import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { Prisma } from '@prisma/client';
import { buildBomSnapshot } from '../src/modules/procurement/bom-revisions.model';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { ProcurementService } from '../src/modules/procurement/procurement.service';
import { ProcurementController } from '../src/modules/procurement/procurement.controller';
import { CreateProcStockPlanBatchDto, UpdateProcStockPlanBatchDto } from '../src/modules/procurement/dto/procurement.dto';

const now = new Date('2026-09-02T02:00:00.000Z');

function plan(input: {
  id: string;
  targetQty: number;
  batches: Array<{ id: string; purchaseQty: number; supplierName?: string }>;
}) {
  return {
    id: input.id,
    code: `SP-20260902-${input.id}`,
    planType: 'material', productId: null, treeNodeId: null, productLine: null, productionTaskId: null,
    materialId: null,
    materialName: '分子筛组件',
    spec: 'R2',
    unit: '件',
    targetQty: input.targetQty,
    targetDate: new Date('2026-09-30T00:00:00.000Z'),
    note: null,
    createdBy: 'buyer-1',
    createdByName: '采购员甲',
    createdAt: now,
    updatedAt: now,
    tasks: [] as any[],
    batches: input.batches.map((batch) => ({
      id: batch.id,
      planId: input.id,
      supplierId: null,
      supplierName: batch.supplierName ?? '供应商甲',
      purchaseQty: batch.purchaseQty,
      purchaseOrderNo: null,
      purchaseOrderMirrorId: null,
      purchaseOrderMirror: null,
      receivedQty: 0,
      qualifiedQty: 0,
      actualArrivalDate: null,
      orderDate: null,
      expectedArrivalDate: null,
      note: null,
      createdBy: 'buyer-1',
      createdByName: '采购员甲',
      createdAt: now,
      updatedAt: now,
    })),
  };
}

function service(prisma: Record<string, unknown>) {
  return new ProcurementService(prisma as never, {} as never, {} as never, {} as never);
}

test('备货计划按采购批次数量合计自动计算状态和剩余量', async () => {
  const rows = [
    plan({ id: '001', targetQty: 100, batches: [] }),
    plan({ id: '002', targetQty: 100, batches: [{ id: 'b-1', purchaseQty: 35 }] }),
    plan({ id: '003', targetQty: 100, batches: [{ id: 'b-2', purchaseQty: 60 }, { id: 'b-3', purchaseQty: 45 }] }),
  ];
  const result = await service({
    procStockPlan: { findMany: async () => rows },
  }).listStockPlans();

  assert.deepEqual(result.items.map((item) => item.status), ['not_started', 'in_progress', 'completed']);
  assert.deepEqual(result.items.map((item) => item.purchasedQty), [0, 35, 105]);
  assert.deepEqual(result.items.map((item) => item.remainingQty), [100, 65, 0]);
  assert.deepEqual(result.items.map((item) => item.progress), [0, 35, 100]);
});

test('添加不同供应商批次后达到目标即返回已完成', async () => {
  let createdBatch: Record<string, unknown> | undefined;
  const completed = plan({
    id: '004',
    targetQty: 80,
    batches: [
      { id: 'b-4', purchaseQty: 50, supplierName: '供应商甲' },
      { id: 'b-5', purchaseQty: 30, supplierName: '供应商乙' },
    ],
  });
  let reads = 0;
  const tx = {
    $queryRaw: async () => [],
    procStockPlan: {
      findUnique: async () => ++reads === 1 ? plan({ id: '004', targetQty: 80, batches: [] }) : completed,
    },
    procStockPlanBatch: { create: async ({ data }: { data: Record<string, unknown> }) => { createdBatch = data; return data; } },
  };
  const result = await service({
    $transaction: async (work: (client: unknown) => Promise<unknown>) => work(tx),
  }).createStockPlanBatch(
    '004',
    { supplierName: '供应商乙', purchaseQty: 30 },
    { id: 'buyer-2', name: '采购员乙', permissions: ['proc-task:create'] },
  );

  assert.equal(createdBatch?.supplierName, '供应商乙');
  assert.equal(Number(createdBatch?.purchaseQty), 30);
  assert.equal(createdBatch?.createdBy, 'buyer-2');
  assert.equal(result.status, 'completed');
  assert.equal(result.purchasedQty, 80);
  assert.equal(result.readinessStatus, 'not_received');
});

const actor = { id: 'buyer-1', name: '采购员甲', permissions: ['proc-task:create'] };

function fixture(overrides: Record<string, unknown> = {}) {
  return { ...plan({ id: 'plan-1', targetQty: 100, batches: [] }), productId: 'prod-portable-o2', ...overrides } as any;
}

function batch(overrides: Record<string, unknown> = {}) {
  return { ...plan({ id: 'plan-1', targetQty: 100, batches: [{ id: 'batch-1', purchaseQty: 100 }] }).batches[0], ...overrides } as any;
}

function harness(row = fixture(), options: { mirror?: any; materials?: any[]; balances?: any[]; bom?: any[]; settings?: any[] } = {}) {
  const readMirror = options.mirror ?? row.batches.find((entry: any) => entry.purchaseOrderMirror)?.purchaseOrderMirror;
  const materials = options.materials ?? [{ id: 'material-1', name: '物料 A', spec: '', unit: '件', category: '结构件', productLine: 'Q5', tpInventoryCode: 'A', safeStock: 0 }];
  let mutex = Promise.resolve();
  const locks: string[] = [];
  const createdTasks: any[] = [];
  const createdBatches: any[] = [];
  const base: any = {
    procBomRevision: { findUnique: async ({ where }: any) => {
      if (where.id !== 'fixture-revision') return null;
      const leaves = (options.bom ?? []).filter(node => node.code).map(node => {
        const material = materials.find(row => row.tpInventoryCode === node.code)!;
        return { nodeId: node.id, parentId: 'published-device', deviceId: 'published-device', materialId: material.id, code: node.code, name: material.name, unit: material.unit, qtyPer: Number(node.qtyPer) };
      });
      const snapshot = buildBomSnapshot({ deviceId: 'published-device', productRootId: 'product-root', structure: [{ id: 'published-device', parentId: null, name: 'Q5' }, ...leaves.map(leaf => ({ id: leaf.nodeId, parentId: leaf.parentId, name: leaf.name }))], leaves });
      return { id: where.id, deviceId: 'published-device', productRootId: 'product-root', snapshot, fingerprint: snapshot.fingerprint, publishedAt: now, version: 1, retiredAt: null, device: { productLine: 'Q5' } };
    } },
    runtimeState: { findMany: async () => [] },
    procStockPlan: {
      findUnique: async () => row,
      findMany: async () => [row],
      findFirst: async () => null,
      update: async ({ data }: any) => Object.assign(row, data),
      create: async ({ data }: any) => Object.assign(row, data),
    },
    procStockPlanBatch: {
      findUnique: async () => row.batches.find((entry: any) => entry.purchaseOrderMirrorId === options.mirror?.id) ?? null,
      create: async ({ data }: any) => {
        const next = batch({ ...data, purchaseOrderMirror: data.purchaseOrderMirrorId ? options.mirror : null });
        row.batches.push(next); createdBatches.push(next); return next;
      },
      update: async ({ where, data }: any) => Object.assign(row.batches.find((entry: any) => entry.id === where.id), data, { purchaseOrderMirror: data.purchaseOrderMirrorId ? options.mirror : null }),
      delete: async ({ where }: any) => { row.batches = row.batches.filter((entry: any) => entry.id !== where.id); },
    },
    procTask: { create: async ({ data }: any) => { const next = { id: `task-${createdTasks.length + 1}`, ...data }; createdTasks.push(next); row.tasks.push(next); return next; } },
    procMaterial: {
      findUnique: async ({ where }: any) => materials.find((entry) => entry.id === where.id) ?? null,
      findMany: async ({ where }: any) => materials.filter((entry) => where.tpInventoryCode.in.includes(entry.tpInventoryCode)),
    },
    procTaskTreeNode: { findUnique: async () => ({ id: 'product-root', parentId: null, productId: 'prod-portable-o2' }), findFirst: async () => null },
    procPurchaseOrderMirror: {
      findUnique: async () => options.mirror ?? null,
      findFirst: async ({ where }: any) => options.mirror?.tpOrderNo === where.tpOrderNo ? options.mirror : null,
      findMany: async ({ where }: any) => readMirror && (where.id?.in.includes(readMirror.id) || where.tpOrderNo?.in.includes(readMirror.tpOrderNo))
        ? [{ ...readMirror, tpOrderId: readMirror.tpOrderId ?? 'erp-order-1', tpLineNo: readMirror.tpLineNo ?? '1', unit: readMirror.unit ?? row.unit, receipts: [], orderedQty: new Prisma.Decimal(readMirror.orderedQty), receivedQty: new Prisma.Decimal(readMirror.receivedQty) }] : [],
    },
    procSupplier: { findUnique: async () => ({ name: '供应商甲' }) },
    procBomNode: { findUnique: async () => ({ id: 'published-device', parentId: null, productRootId: 'product-root', productLine: 'Q5' }), findMany: async () => (options.bom ?? []).map((node) => ({ updatedAt: now, ...node })) },
    procInventoryBalance: { findMany: async () => options.balances ?? [] },
    systemSetting: { findMany: async () => options.settings ?? [], findUnique: async () => ({ value: [{ id: 'prod-portable-o2' }] }) },
  };
  const prisma = {
    ...base,
    $transaction: async (work: (tx: any) => Promise<unknown>) => {
      let release: (() => void) | undefined;
      const tx = { ...base, $queryRaw: async (strings: TemplateStringsArray) => {
        locks.push(strings.join('?'));
        if (release) return [];
        const previous = mutex;
        mutex = new Promise<void>((resolve) => { release = resolve; });
        await previous;
        return [];
      } };
      try { return await work(tx); } finally { release?.(); }
    },
  };
  const instance = service(prisma);
  (instance as any).pickAutomaticBuyer = async () => ({ id: 'buyer-1', name: '采购员甲' });
  return { instance, row, prisma, locks, createdTasks, createdBatches };
}

function mirror(overrides: Record<string, unknown> = {}) {
  return { id: 'po-1', materialId: 'material-1', inventoryCode: 'A', supplierName: 'ERP 供应商', tpOrderNo: 'PO-2026-1', orderedQty: 100, receivedQty: 40, orderDate: now, etaDate: new Date('2026-09-10T00:00:00Z'), ...overrides };
}

function balance(overrides: Record<string, unknown> = {}) {
  return { tpInventoryCode: 'A', unit: '件', warehouse: '量产仓库', stockQty: Math.max(30, Number(overrides.availableQty ?? 20)), availableQty: 20, inTransitQty: 10, syncedAt: now, material: { safeStock: 0 }, ...overrides };
}

test('计划筛选按类型、产品、子系统及完整月份范围查询', async () => {
  let where: any;
  const instance = service({ procStockPlan: { findMany: async (input: any) => { where = input.where; return []; } } });
  await instance.listStockPlans({ type: 'packaging', productId: 'product-1', treeNodeId: 'node-1', month: '2026-12' });
  assert.deepEqual(where, { planType: 'packaging', productId: 'product-1', treeNodeId: 'node-1', targetDate: { gte: new Date('2026-12-01T00:00:00Z'), lt: new Date('2027-01-01T00:00:00Z') } });
  await assert.rejects(() => instance.listStockPlans({ month: '2026-13' }), /月份格式/);
});

test('整机备货不得从未发布工作稿新建或首次生成任务', async () => {
  const h = harness(fixture({ planType: 'machine', productLine: 'Q5' }), { bom: [{ id: 'd', parentId: null, productLine: 'Q5' }] });
  await assert.rejects(h.instance.createStockPlan({ planType: 'machine', productId: 'prod-portable-o2', productLine: 'Q5', materialName: '整机', targetQty: 10 }, actor), /发布版本/);
  await assert.rejects(h.instance.generateStockPlanTasks(h.row.id, actor), /BOM.*依据|发布版本/);
  assert.equal(h.createdTasks.length, 0);
});

test('已确认 BOM 的整机计划不能转换类型绕过身份锁定', async () => {
  const h = harness(fixture({ planType: 'machine', productLine: 'Q5', bomRevisionId: 'fixture-revision' }));
  await assert.rejects(h.instance.updateStockPlan(h.row.id, { planType: 'material', productLine: '' }), /身份不能直接更改/);
  assert.equal(h.row.planType, 'machine');
});

test('月度整机核算只合并相同发布版本的需求', async () => {
  const h = harness(fixture({ planType: 'machine', productLine: 'Q5', bomRevisionId: 'revision-1' }));
  let queried: any;
  h.prisma.procStockPlan.findMany = async ({ where }: any) => { queried = where; return [h.row]; };
  (h.instance as any).stockPlanReadiness = async () => ({});
  await h.instance.getStockPlanReadiness(h.row.id, '2026-09');
  assert.equal(queried.bomRevisionId, 'revision-1');
});

test('创建包材计划保留产品子系统，整机拒绝非整数套数或零部件物料', async () => {
  const h = harness();
  const saved = await h.instance.createStockPlan({ planType: 'packaging', materialId: 'material-1', materialName: '包材', targetQty: 12, treeNodeId: 'subsystem-1' }, actor);
  assert.equal(saved.planType, 'packaging');
  assert.equal(saved.productId, 'prod-portable-o2');
  assert.equal(saved.treeNodeId, 'subsystem-1');
  await assert.rejects(() => h.instance.createStockPlan({ planType: 'machine', materialName: '整机', productLine: 'Q5', targetQty: 1.5 }, actor), /整数/);
  const component = harness(fixture(), { bom: [{ id: 'leaf', parentId: null, materialId: 'material-1' }] });
  await assert.rejects(() => component.instance.createStockPlan({ planType: 'machine', materialId: 'material-1', materialName: '组件', productLine: 'Q5', targetQty: 10 }, actor), /零部件/);
});

test('Q5 未发布不能登记正式整机计划，历史待核实计划禁止首次生成采购', async () => {
  const materials = [
    { id: 'component', name: '零部件', spec: '', unit: '件', tpInventoryCode: 'A', safeStock: 0 },
    { id: 'packaging', name: '必需包材', spec: '', unit: '个', tpInventoryCode: 'B', safeStock: 0 },
  ];
  for (const scenario of ['missing_code', 'missing_qty', 'missing_inventory']) {
    const h = harness(fixture(), {
      materials,
      bom: [
        { id: 'root', parentId: null, name: 'Q5 必需清单', productLine: 'Q5' },
        { id: 'component-row', parentId: 'root', name: '零部件', code: 'A', qtyPer: 1, productLine: 'Q5' },
        { id: 'packaging-row', parentId: 'root', name: '必需包材', code: scenario === 'missing_code' ? null : 'B', qtyPer: scenario === 'missing_qty' ? 0 : 1, productLine: 'Q5' },
      ],
      balances: [balance({ availableQty: 20, inTransitQty: 0 }), ...(scenario === 'missing_inventory' ? [] : [balance({ tpInventoryCode: 'B', availableQty: 0, inTransitQty: 0 })])],
    });
    await assert.rejects(h.instance.createStockPlan({ planType: 'machine', materialName: 'Q5 整机', productLine: 'Q5', targetQty: 100, productId: 'prod-portable-o2' }, actor), /发布版本/);
    Object.assign(h.row, { planType: 'machine', productLine: 'Q5', targetQty: 100 });
    const readiness = await h.instance.getStockPlanReadiness(h.row.id);
    assert.equal(readiness.dataQuality.provisional, true, scenario);
    await assert.rejects(() => h.instance.generateStockPlanTasks(h.row.id, actor), /BOM.*依据/, scenario);
    assert.equal(h.createdTasks.length, 0, '待核实的必需包材不能被跳过后局部生成');
  }
});

test('必需包材有明确零库存时完整齐套为0，仍可为其生成补货采购任务', async () => {
  const h = harness(fixture({ planType: 'machine', productLine: 'Q5', targetQty: 100, bomRevisionId: 'fixture-revision' }), {
    materials: [
      { id: 'component', name: '零部件', spec: '', unit: '件', tpInventoryCode: 'A', safeStock: 0 },
      { id: 'packaging', name: '必需包材', spec: '', unit: '个', tpInventoryCode: 'B', safeStock: 0 },
    ],
    bom: [
      { id: 'root', parentId: null, name: 'Q5 必需清单', productLine: 'Q5' },
      { id: 'component-row', parentId: 'root', name: '零部件', code: 'A', qtyPer: 1, productLine: 'Q5' },
      { id: 'packaging-row', parentId: 'root', name: '必需包材', code: 'B', qtyPer: 1, productLine: 'Q5' },
    ],
    balances: [balance({ availableQty: 100, inTransitQty: 0 }), balance({ tpInventoryCode: 'B', unit: '个', stockQty: 0, availableQty: 0, inTransitQty: 0 })],
  });
  const readiness = await h.instance.getStockPlanReadiness(h.row.id);
  assert.equal(readiness.dataQuality.provisional, false);
  assert.equal(readiness.summary.currentBuildableSets, 0);
  assert.equal(readiness.summary.withTransitBuildableSets, 0);
  const result = await h.instance.generateStockPlanTasks(h.row.id, actor);
  assert.equal(result.createdCount, 1);
  assert.equal(h.createdTasks[0].materialId, 'packaging');
  assert.equal(Number(h.createdTasks[0].quantity), 100);
});

test('生产来源只接受生产任务池中的有效任务且核对子产品归属', async () => {
  const settings = [{ key: 'rdws.production.productTaskCategories', value: { 'product-2': [{ children: [{ tasks: [{ task_id: 'production-1' }, { task_id: 'archived', archived: true }] }] }] } }];
  const h = harness(fixture(), { settings });
  const saved = await h.instance.createStockPlan({ materialName: '包材', targetQty: 10, productId: 'product-2', productionTaskId: 'production-1' }, actor);
  assert.equal(saved.productionTaskId, 'production-1');
  await assert.rejects(() => h.instance.createStockPlan({ materialName: '包材', targetQty: 10, productId: 'another-product', productionTaskId: 'production-1' }, actor), /不属于/);
  await assert.rejects(() => h.instance.createStockPlan({ materialName: '包材', targetQty: 10, productionTaskId: 'archived' }, actor), /已归档/);
  await assert.rejects(() => h.instance.createStockPlan({ materialName: '包材', targetQty: 10, productionTaskId: 'rd-only-task' }, actor), /生产任务不存在/);
});

test('镜像关联 DTO 接受只传订单行，服务端校验手工批次必填内容', async () => {
  assert.equal((await validate(plainToInstance(CreateProcStockPlanBatchDto, { purchaseOrderMirrorId: 'po-1' }))).length, 0);
  const h = harness();
  await assert.rejects(() => h.instance.createStockPlanBatch(h.row.id, {}, actor), /供应商/);
  assert.equal(h.createdBatches.length, 0);
});

test('新建及编辑实际到货日期允许空值清除，非空必须是真实年月日', async () => {
  for (const Dto of [CreateProcStockPlanBatchDto, UpdateProcStockPlanBatchDto]) {
    for (const value of ['', '2028-02-29', '2026-09-04']) {
      assert.equal((await validate(plainToInstance(Dto, { purchaseOrderMirrorId: 'po-1', actualArrivalDate: value }))).length, 0, value);
    }
    for (const value of ['2026-02-31', '2026-02-29', '2026-9-04', '2026-09-04T00:00:00Z']) {
      assert.ok((await validate(plainToInstance(Dto, { purchaseOrderMirrorId: 'po-1', actualArrivalDate: value }))).length > 0, value);
    }
  }
  const h = harness();
  const created = await h.instance.createStockPlanBatch(h.row.id, { supplierName: '供应商', purchaseQty: 10, actualArrivalDate: '' }, actor);
  assert.equal(created.batches[0].actualArrivalDate, undefined);
  await h.instance.updateStockPlanBatch(h.row.id, 'batch-1', { actualArrivalDate: '2026-09-04' });
  const cleared = await h.instance.updateStockPlanBatch(h.row.id, 'batch-1', { actualArrivalDate: '' });
  assert.equal(cleared.batches[0].actualArrivalDate, undefined);
  assert.equal(h.row.batches[0].actualArrivalDate, null);
  await assert.rejects(() => h.instance.updateStockPlanBatch(h.row.id, 'batch-1', { actualArrivalDate: '2026-02-31' }), /有效的 YYYY-MM-DD/);
});

test('物料计划单位为空时回填主数据，错误单位及历史错单位不得扣减库存', async () => {
  const h = harness();
  const saved = await h.instance.createStockPlan({ materialName: '物料 A', materialId: 'material-1', targetQty: 10, unit: '' }, actor);
  assert.equal(saved.unit, '件');
  await assert.rejects(() => h.instance.createStockPlan({ materialName: '物料 A', materialId: 'material-1', targetQty: 10, unit: '箱' }, actor), /单位必须与物料/);
  const legacy = harness(fixture({ materialId: 'material-1', unit: '箱' }), { balances: [balance()] });
  await assert.rejects(() => legacy.instance.getStockPlanReadiness(legacy.row.id), /不能直接扣减库存/);
  const machine = harness(fixture(), { bom: [{ id: 'root', parentId: null, materialId: null }, { id: 'leaf', parentId: 'root', code: 'A', qtyPer: 1 }] });
  const whole = await machine.instance.createStockPlan({ materialName: '整机', planType: 'machine', productId: 'prod-portable-o2', productLine: 'Q5', bomRevisionId: 'fixture-revision', targetQty: 10 }, actor);
  assert.equal(whole.unit, '套');
});

test('生成任务前必须明确有效所属产品，缺省产品不会被猜成默认产品', async () => {
  const missing = harness(fixture({ materialId: 'material-1', productId: null }), { balances: [balance()] });
  await assert.rejects(() => missing.instance.generateStockPlanTasks(missing.row.id, actor), /选择所属产品/);
  assert.equal(missing.createdTasks.length, 0);
  const unknown = harness(fixture({ materialId: 'material-1', productId: 'unknown-product' }), { balances: [balance()] });
  await assert.rejects(() => unknown.instance.generateStockPlanTasks(unknown.row.id, actor), /所属产品不存在/);
  assert.equal(unknown.createdTasks.length, 0);
  await missing.instance.updateStockPlan(missing.row.id, { productId: 'prod-portable-o2' });
  const result = await missing.instance.generateStockPlanTasks(missing.row.id, actor);
  assert.equal(result.createdCount, 1);
  assert.equal(missing.createdTasks[0].productId, 'prod-portable-o2');
});

test('已有报工或质量记录时锁定计划上下文，但未生成采购任务仍可调整目标', async () => {
  for (const counts of [{ productionReports: 1, qualityRecords: 0 }, { productionReports: 0, qualityRecords: 1 }]) {
    const h = harness(fixture({ _count: counts }));
    const view = await h.instance.getStockPlanView(h.row.id);
    assert.equal(view.contextLocked, true);
    assert.equal(view.materialLocked, true);
    for (const change of [{ productId: 'product-2' }, { treeNodeId: 'other-node' }, { unit: '箱' }, { materialId: 'material-1' }, { planType: 'packaging' as const }]) {
      await assert.rejects(() => h.instance.updateStockPlan(h.row.id, change), /不能修改/);
    }
    const updated = await h.instance.updateStockPlan(h.row.id, { targetQty: 120 });
    assert.equal(updated.targetQty, 120);
    assert.equal(updated.contextLocked, true);
  }
});

test('真实订单批次动态跟随 ERP 数量，采购量到货量和合格量分别统计', async () => {
  const po = mirror();
  const h = harness(fixture({ materialId: 'material-1' }), { mirror: po });
  const saved = await h.instance.createStockPlanBatch(h.row.id, { purchaseOrderMirrorId: po.id, qualifiedQty: 30, actualArrivalDate: '2026-09-03' }, actor);
  assert.equal(saved.status, 'completed');
  assert.equal(saved.readinessStatus, 'partial_received');
  assert.equal(saved.receivedQty, 40);
  assert.equal(saved.qualifiedQty, 30);
  assert.equal(saved.inTransitQty, 60);
  assert.equal(saved.batches[0].supplierName, 'ERP 供应商');
  assert.equal(saved.batches[0].purchaseOrderNo, po.tpOrderNo);
  po.receivedQty = 100;
  const arrived = await h.instance.getStockPlanView(h.row.id);
  assert.equal(arrived.arrivalProgress, 100);
  assert.equal(arrived.readinessStatus, 'pending_inspection');
  const qualified = await h.instance.updateStockPlanBatch(h.row.id, 'batch-1', { qualifiedQty: 100 });
  assert.equal(qualified.readinessStatus, 'qualified');
  po.receivedQty = 90;
  const corrected = await h.instance.getStockPlanView(h.row.id);
  assert.equal(corrected.qualifiedQty, 90);
  assert.equal(corrected.qualityDataIssue, true);
  assert.equal(corrected.batches[0].recordedQualifiedQty, 100);
});

test('订单关联拒绝手工覆盖、错误物料及重复订单行', async () => {
  const h = harness(fixture({ materialId: 'material-1' }), { mirror: mirror() });
  await assert.rejects(() => h.instance.createStockPlanBatch(h.row.id, { purchaseOrderMirrorId: 'po-1', purchaseQty: 50 }, actor), /不能手工覆盖/);
  const wrong = harness(fixture({ materialId: 'material-1' }), { mirror: mirror({ materialId: 'material-2', inventoryCode: 'B' }) });
  await assert.rejects(() => wrong.instance.createStockPlanBatch(wrong.row.id, { purchaseOrderMirrorId: 'po-1' }, actor), /不匹配/);
  const wrongUnit = harness(fixture({ materialId: 'material-1' }), { mirror: mirror({ unit: '箱' }) });
  await assert.rejects(() => wrongUnit.instance.createStockPlanBatch(wrongUnit.row.id, { purchaseOrderMirrorId: 'po-1' }, actor), /单位不一致/);
  await h.instance.createStockPlanBatch(h.row.id, { purchaseOrderMirrorId: 'po-1' }, actor);
  await assert.rejects(() => h.instance.createStockPlanBatch(h.row.id, { purchaseOrderMirrorId: 'po-1' }, actor), /不能重复计入/);
  await assert.rejects(() => h.instance.updateStockPlanBatch(h.row.id, 'batch-1', { receivedQty: 2 }), /不能手工覆盖/);
  assert.equal(h.createdBatches.length, 1);
});

test('手工收货和检验数量守恒，整机不允许无整机物料直接登记零部件批次', async () => {
  const h = harness();
  await assert.rejects(() => h.instance.createStockPlanBatch(h.row.id, { supplierName: '供应商', purchaseQty: 10, receivedQty: 4, qualifiedQty: 5 }, actor), /合格量不能超过/);
  await assert.rejects(() => h.instance.createStockPlanBatch(h.row.id, { supplierName: '供应商', purchaseQty: 10, receivedQty: 11 }, actor), /手工到货量/);
  const machine = harness(fixture({ planType: 'machine', materialId: null }));
  await assert.rejects(() => machine.instance.createStockPlanBatch(machine.row.id, { supplierName: '供应商', purchaseQty: 10 }, actor), /整机自身物料/);
});

test('单物料总目标只扣一次库存和在途，并排除研发仓库与重复镜像在途', async () => {
  const h = harness(fixture({ materialId: 'material-1', targetQty: 100.25, batches: [batch({ purchaseQty: 12, receivedQty: 2 }), batch({ id: 'erp', purchaseOrderMirrorId: 'po-1', purchaseQty: 10, purchaseOrderMirror: mirror({ orderedQty: 10, receivedQty: 0 }) })] }), {
    balances: [balance(), balance({ warehouse: '研发量产仓', availableQty: 999 })],
  });
  const result = await h.instance.getStockPlanReadiness(h.row.id);
  assert.equal(result.items[0].available, 20);
  assert.equal(result.items[0].inTransit, 20);
  assert.equal(result.items[0].targetDemand, 100.25);
  assert.equal(result.items[0].gapAfterTransit, 60.25);
});

test('单物料小数目标满足后不产生整数取整的伪缺口与预警', async () => {
  const h = harness(fixture({ materialId: 'material-1', targetQty: 2.25 }), { balances: [balance({ availableQty: 2.5, inTransitQty: 0 })] });
  const result = await h.instance.getStockPlanReadiness(h.row.id);
  assert.equal(result.items[0].gapAfterTransit, 0);
  assert.equal(result.items[0].status, 'ready');
  assert.equal(result.summary.currentBuildableSets, 2.5);
  assert.equal(result.summary.warningMaterials, 0);
  const generated = await h.instance.generateStockPlanTasks(h.row.id, actor);
  assert.equal(generated.createdCount, 0);
});

test('并发生成按计划行锁只创建一批任务，保留产品子系统和计划来源', async () => {
  const h = harness(fixture({ materialId: 'material-1', productId: 'prod-portable-o2', treeNodeId: 'subsystem-1' }), { balances: [balance()] });
  const results = await Promise.all([h.instance.generateStockPlanTasks(h.row.id, actor), h.instance.generateStockPlanTasks(h.row.id, actor)]);
  assert.deepEqual(results.map((result) => [result.createdCount, result.existingCount]), [[1, 0], [0, 1]]);
  assert.equal(h.locks.filter((query) => query.includes('FOR UPDATE')).length, 2);
  assert.equal(h.createdTasks.length, 1);
  const task = h.createdTasks[0];
  assert.equal(Number(task.quantity), 70);
  assert.equal(task.stockPlanId, h.row.id);
  assert.equal(task.businessLine, 'production');
  assert.equal(task.status, 'pending_confirm');
  assert.equal(task.productId, 'prod-portable-o2');
  assert.equal(task.treeNodeId, 'subsystem-1');
  assert.equal(task.needDate, h.row.targetDate);
  assert.equal(task.buyerUserId, 'buyer-1');
  assert.equal(results[1].plan.tasks[0].id, task.id);
});

test('整机 BOM 按用量拆物料，整机自身已订购套数先扣除且组件不增加整机订单进度', async () => {
  const h = harness(fixture({ planType: 'machine', productLine: 'Q5', bomRevisionId: 'fixture-revision', targetQty: 10, materialId: 'machine-1', batches: [batch({ purchaseQty: 2, receivedQty: 0 })] }), {
    bom: [{ id: 'root', parentId: null, name: '结构件', code: null, productLine: 'Q5', qtyPer: null, material: null }, { id: 'leaf', parentId: 'root', name: '物料 A', code: 'A', productLine: 'Q5', qtyPer: 2, material: { name: '物料 A', spec: '', unit: '件' } }],
    balances: [balance({ availableQty: 4, inTransitQty: 2 })],
  });
  const result = await h.instance.generateStockPlanTasks(h.row.id, actor);
  assert.equal(Number(h.createdTasks[0].quantity), 10);
  assert.equal(result.plan.purchasedQty, 2);
  assert.equal(result.plan.progress, 20);
  assert.equal(result.plan.receivedQty, 0);
});

test('缺少库存映射时拒绝建单，已生成的计划不能修改目标造成任务脱节', async () => {
  const h = harness(fixture({ materialId: 'material-1' }));
  await assert.rejects(() => h.instance.generateStockPlanTasks(h.row.id, actor), /映射不完整/);
  assert.equal(h.createdTasks.length, 0);
  h.row.tasks.push({ id: 'task-1', materialName: '物料 A', quantity: 1 });
  await assert.rejects(() => h.instance.updateStockPlan(h.row.id, { targetQty: 200 }), /不能修改/);
  const repeated = await h.instance.generateStockPlanTasks(h.row.id, actor);
  assert.equal(repeated.createdCount, 0);
  assert.equal(repeated.existingCount, 1);
});

test('库存齐套型号名称不被最后一个根子系统覆盖', async () => {
  const h = harness(fixture(), { bom: [
    { id: 'root-a', parentId: null, name: '机械系统', productLine: 'Q5', qtyPer: null },
    { id: 'root-b', parentId: null, name: '电气系统', productLine: 'Q5', qtyPer: null },
  ] });
  const result = await h.instance.getInventoryReadiness({ productLine: 'Q5' });
  assert.equal(result.models[0].label, 'Q5');
});

test('作废或审批取消订单保留异常记录，但不抵消整机 BOM 目标', async () => {
  for (const states of [{ status: '作废' }, { approvalStatus: 'cancelled' }]) {
    const po = mirror({ orderedQty: 100, receivedQty: 10, ...states });
    const h = harness(fixture({ planType: 'machine', productLine: 'Q5', targetQty: 100, batches: [batch({ purchaseOrderMirrorId: po.id, purchaseOrderMirror: po, qualifiedQty: 10 })] }), {
      bom: [{ id: 'root', parentId: null, name: '结构件', productLine: 'Q5' }, { id: 'leaf', parentId: 'root', name: '物料 A', code: 'A', productLine: 'Q5', qtyPer: 1 }],
      balances: [balance({ availableQty: 0, inTransitQty: 0 })],
    });
    const view = await h.instance.getStockPlanView(h.row.id);
    assert.equal(view.purchasedQty, 0);
    assert.equal(view.receivedQty, 0);
    assert.equal(view.qualifiedQty, 0);
    assert.equal(view.inTransitQty, 0);
    assert.equal(view.status, 'not_started');
    assert.equal(view.orderDataIssue, true);
    assert.equal(view.batches[0].recordedPurchaseQty, 100);
    assert.match(view.batches[0].orderIssue!, /作废或取消/);
    const readiness = await h.instance.getStockPlanReadiness(h.row.id);
    assert.equal(readiness.summary.targetSets, 100);
    assert.equal(readiness.items[0].gapAfterTransit, 100);
  }
});

test('已有 ERP 单号拒绝再登记手工批次，历史手工与 ERP 在途不重复计算', async () => {
  const po = mirror({ orderedQty: 100, receivedQty: 0 });
  const h = harness(fixture({ targetQty: 150, materialId: 'material-1', batches: [batch({ purchaseOrderNo: po.tpOrderNo, purchaseQty: 100, receivedQty: 0 })] }), {
    mirror: po, balances: [balance({ availableQty: 0, inTransitQty: 100 })],
  });
  await assert.rejects(() => h.instance.createStockPlanBatch(h.row.id, { supplierName: '供应商', purchaseQty: 100, purchaseOrderNo: po.tpOrderNo }, actor), /关联实际采购订单行/);
  const result = await h.instance.getStockPlanReadiness(h.row.id);
  assert.equal(result.items[0].inTransit, 100);
  assert.equal(result.items[0].gapAfterTransit, 50);
  assert.equal(result.dataQuality.provisional, true);
  assert.match(result.orderIssues[0].message, /明确关联/);
  await assert.rejects(() => h.instance.generateStockPlanTasks(h.row.id, actor), /请先关联/);
  const view = await h.instance.getStockPlanView(h.row.id);
  assert.equal(view.orderDataIssue, true);
  assert.equal(view.batches[0].recordedPurchaseQty, 100);
  const linked = await h.instance.updateStockPlanBatch(h.row.id, 'batch-1', { purchaseOrderMirrorId: po.id });
  assert.equal(linked.orderDataIssue, false);
  const resolved = await h.instance.getStockPlanReadiness(h.row.id);
  assert.equal(resolved.items[0].inTransit, 100);
  assert.equal(resolved.dataQuality.provisional, false);
});

test('月度同组两个各 100 的计划共用库存 100，只扣一次并返回缺口 100', async () => {
  const first = fixture({ id: 'first', materialId: 'material-1' });
  const second = fixture({ id: 'second', materialId: 'material-1' });
  const h = harness(first, { balances: [balance({ availableQty: 100, inTransitQty: 0 })] });
  h.prisma.procStockPlan.findMany = async () => [first, second];
  const result = await h.instance.getStockPlanReadiness(first.id, '2026-09');
  assert.equal('scopePlanCount' in result && result.scopePlanCount, 2);
  assert.equal('scopeTargetQty' in result && result.scopeTargetQty, 200);
  assert.equal(result.items[0].targetDemand, 200);
  assert.equal(result.items[0].gapAfterTransit, 100);
  await assert.rejects(() => h.instance.getStockPlanReadiness(first.id, '2026-9'), /月份格式/);
  await assert.rejects(() => h.instance.getStockPlanReadiness(first.id, '2026-13'), /月份格式/);
});

test('月度查询隔离不同单位、产品、计划类型及无目标日期记录', async () => {
  const first = fixture({ materialId: 'material-1', productId: 'product-1', planType: 'packaging', unit: '件' });
  const otherUnits = fixture({ materialId: 'material-1', productId: 'product-1', planType: 'packaging', unit: '箱' });
  const undated = fixture({ materialId: 'material-1', productId: 'product-1', planType: 'packaging', unit: '件', targetDate: null });
  const h = harness(first, { balances: [balance({ availableQty: 10, inTransitQty: 0 })] });
  h.prisma.procStockPlan.findMany = async ({ where }: any) => {
    assert.equal(where.unit, '件');
    assert.equal(where.productId, 'product-1');
    assert.equal(where.planType, 'packaging');
    assert.equal(where.materialId, 'material-1');
    assert.equal(where.targetDate.gte.toISOString(), '2026-09-01T00:00:00.000Z');
    assert.equal(where.targetDate.lt.toISOString(), '2026-10-01T00:00:00.000Z');
    return [first, otherUnits, undated].filter((row) => row.unit === where.unit && row.targetDate && row.targetDate >= where.targetDate.gte && row.targetDate < where.targetDate.lt);
  };
  const result = await h.instance.getStockPlanReadiness(first.id, '2026-09');
  assert.equal('scopePlanCount' in result && result.scopePlanCount, 1);
  assert.equal('scopeTargetQty' in result && result.scopeTargetQty, 100);
  assert.equal(result.items[0].gapAfterTransit, 90);
});

test('新接口沿用驾驶舱读取和采购创建权限，不赋予普通读取用户写权限', async () => {
  const permissionKey = 'permissions';
  assert.deepEqual(Reflect.getMetadata(permissionKey, ProcurementController.prototype.getStockPlan), ['page:proc-cockpit']);
  assert.deepEqual(Reflect.getMetadata(permissionKey, ProcurementController.prototype.generateStockPlanTasks), ['proc-task:create']);
  assert.ok(Reflect.getMetadata(permissionKey, ProcurementController.prototype.getInventoryReadiness).includes('page:proc-cockpit'));
  const h = harness();
  await assert.rejects(() => h.instance.generateStockPlanTasks(h.row.id, { ...actor, permissions: ['page:proc-cockpit'] }), /没有创建采购任务/);
  assert.equal(h.createdTasks.length, 0);
});
