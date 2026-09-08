import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants';

import { TplusSyncService } from '../src/modules/procurement/tplus-sync.service';
import { ProcurementService } from '../src/modules/procurement/procurement.service';

test('同步把缺省行号规范为真实 ERP 首行号，历史两种引用不再重复累计到货', async () => {
  const refs: Array<Record<string, unknown>> = [
    { id: 'legacy', taskId: 'task-1', tpOrderNo: 'PO-001', tpLineNo: null, receivedQty: 0, etaDate: null },
    { id: 'explicit', taskId: 'task-1', tpOrderNo: 'PO-001', tpLineNo: '7', receivedQty: 0, etaDate: null },
    { id: 'free', taskId: 'task-1', tpOrderNo: 'PO-OLD', tpLineNo: '7', receivedQty: 75, etaDate: null, metadata: { freeSample: true } },
  ];
  let saved: Record<string, unknown> = {};
  const transaction = {
    $queryRaw: async () => [],
    procPurchaseOrderRef: {
      findMany: async () => refs,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        Object.assign(refs.find((row) => row.id === where.id)!, data);
      },
    },
    procTask: {
      findUnique: async () => ({ id: 'task-1', quantity: 100, status: 'in_transit', businessDone: false, purchaseOrderRefs: refs }),
      update: async ({ data }: { data: Record<string, unknown> }) => { saved = data; },
    },
  };
  const prisma = { ...transaction, $transaction: async (run: (client: typeof transaction) => Promise<unknown>) => run(transaction) };
  const procurement = new ProcurementService(prisma as never, {} as never, {} as never, {} as never);
  const service = new TplusSyncService(prisma as never, procurement, {} as never, {} as never);
  const orders: string[] = [];
  (service as any).fetchFromTplus = async (_path: string, payload: { voucherCode: string }) => {
    orders.push(payload.voucherCode);
    return { Code: 'PO-001', PurchaseOrderDetails: [{ RowNo: 7, Quantity: 100, CountQuantity: 50 }] };
  };
  await service.syncPurchaseOrders();
  assert.deepEqual(refs.slice(0, 2).map((row) => row.tpLineNo), ['7', '7']);
  assert.deepEqual(orders, ['PO-001'], '历史免费样品的残留 ERP 单号也不能触发同步');
  assert.equal(refs[2].receivedQty, 75, '不修改历史样品数据');
  assert.equal(Number(saved.arrivedQty), 50);
  assert.equal(saved.status, 'partial_arrival');
});

test('T+ 自动同步固定在北京时间每天 3:00 执行', () => {
  const options = Reflect.getMetadata(
    SCHEDULE_CRON_OPTIONS,
    TplusSyncService.prototype.autoSyncCron,
  ) as { cronTime?: string; timeZone?: string };

  assert.equal(options.cronTime, '0 3 * * *');
  assert.equal(options.timeZone, 'Asia/Shanghai');
});

test('T+ 自动同步按主档、供应商、库存、采购单和匹配顺序执行并保存摘要', async () => {
  const calls: string[] = [];
  let savedMetadata: Record<string, unknown> | undefined;
  const prisma = {
    integrationConfig: {
      findFirst: async () => ({ id: 'config-1', metadata: { autoSync: true } }),
      update: async (args: { data: { metadata: Record<string, unknown> } }) => {
        savedMetadata = args.data.metadata;
        return args;
      },
    },
  };
  const poMatch = {
    runMatch: async () => {
      calls.push('匹配');
      return { suggested: 2, aiSuggested: 0, unmatched: 1 };
    },
  };
  const service = new TplusSyncService(
    prisma as never,
    {} as never,
    {} as never,
    poMatch as never,
  );
  const mutableService = service as unknown as {
    getConfig: () => Promise<{ configured: boolean; authorized: boolean; autoSync: boolean }>;
    syncMaterialMaster: () => Promise<Record<string, unknown>>;
    syncSuppliers: () => Promise<Record<string, unknown>>;
    syncInventory: () => Promise<Record<string, unknown>>;
    syncPurchaseOrderMirror: () => Promise<Record<string, unknown>>;
  };
  mutableService.getConfig = async () => ({ configured: true, authorized: true, autoSync: true });
  mutableService.syncMaterialMaster = async () => {
    calls.push('物料主档');
    return { received: 8, created: 1, updated: 7 };
  };
  mutableService.syncSuppliers = async () => {
    calls.push('供应商');
    return { upserted: 3 };
  };
  mutableService.syncInventory = async () => {
    calls.push('库存');
    return { upserted: 4 };
  };
  mutableService.syncPurchaseOrderMirror = async () => {
    calls.push('采购单');
    return { orders: 5, failed: 0 };
  };

  const result = await service.autoSync();

  assert.deepEqual(calls, ['物料主档', '供应商', '库存', '采购单', '匹配']);
  assert.equal(result.skipped, false);
  assert.match(result.summary ?? '', /物料主档 ✓ received=8,created=1,updated=7/);
  assert.match(result.summary ?? '', /供应商 ✓ upserted=3/);
  assert.match(result.summary ?? '', /库存 ✓ upserted=4/);
  assert.match(result.summary ?? '', /采购单全量 ✓ orders=5,failed=0/);
  assert.match(result.summary ?? '', /匹配 ✓ suggested=2,aiSuggested=0,unmatched=1/);
  assert.equal(typeof savedMetadata?.lastAutoSyncAt, 'string');
  assert.equal(savedMetadata?.lastAutoSyncSummary, result.summary);
});

test('T+ 自动同步关闭时不执行任何同步步骤', async () => {
  const service = new TplusSyncService(
    {} as never,
    {} as never,
    {} as never,
    {
      runMatch: async () => {
        throw new Error('自动同步关闭时不应执行匹配');
      },
    } as never,
  );
  const mutableService = service as unknown as {
    getConfig: () => Promise<{ configured: boolean; authorized: boolean; autoSync: boolean }>;
    syncSuppliers: () => Promise<Record<string, unknown>>;
  };
  mutableService.getConfig = async () => ({ configured: true, authorized: true, autoSync: false });
  mutableService.syncSuppliers = async () => {
    throw new Error('自动同步关闭时不应同步供应商');
  };

  const result = await service.autoSync();

  assert.deepEqual(result, { skipped: true, reason: '自动同步已关闭' });
});

test('手动立即全同步可越过自动同步开关', async () => {
  const calls: string[] = [];
  const prisma = {
    integrationConfig: {
      findFirst: async () => ({ id: 'config-1', metadata: { autoSync: false } }),
      update: async () => undefined,
    },
  };
  const service = new TplusSyncService(
    prisma as never,
    {} as never,
    {} as never,
    { runMatch: async () => { calls.push('匹配'); return {}; } } as never,
  );
  const mutableService = service as unknown as {
    getConfig: () => Promise<{ configured: boolean; authorized: boolean; autoSync: boolean }>;
    syncMaterialMaster: () => Promise<Record<string, unknown>>;
    syncSuppliers: () => Promise<Record<string, unknown>>;
    syncInventory: () => Promise<Record<string, unknown>>;
    syncPurchaseOrderMirror: () => Promise<Record<string, unknown>>;
  };
  mutableService.getConfig = async () => ({ configured: true, authorized: true, autoSync: false });
  mutableService.syncMaterialMaster = async () => { calls.push('物料主档'); return {}; };
  mutableService.syncSuppliers = async () => { calls.push('供应商'); return {}; };
  mutableService.syncInventory = async () => { calls.push('库存'); return {}; };
  mutableService.syncPurchaseOrderMirror = async () => { calls.push('采购单'); return {}; };

  const result = await service.autoSync(undefined, { force: true });

  assert.equal(result.skipped, false);
  assert.deepEqual(calls, ['物料主档', '供应商', '库存', '采购单', '匹配']);
});

test('T+ 存货主档同步会创建零库存物料并保留已有本地分类', async () => {
  const creates: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  let requestedPath = '';
  const existing = {
    id: 'material-012',
    name: '旧名称',
    spec: '',
    unit: '个',
    category: '本地板件分类',
    erpCode: 'A01-012',
    tpInventoryCode: 'A01-012',
    metadata: { localFlag: true },
  };
  const prisma = {
    procMaterial: {
      findMany: async () => [existing],
      update: async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);
        return { ...existing, ...data };
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        creates.push(data);
        return { id: 'material-013', ...data };
      },
    },
  };
  const procurement = {
    reconcileProcTaskTreeMaterialLinks: async () => ({
      scannedNodes: 2,
      linkedNodes: 1,
      unmatchedNodes: 1,
      ambiguousNodes: 0,
    }),
  };
  const service = new TplusSyncService(prisma as never, procurement as never, {} as never, {} as never);
  const mutableService = service as unknown as {
    fetchMaterialMasterRows: (path: string) => Promise<unknown[]>;
    recordMaterialMasterSync: () => Promise<void>;
  };
  mutableService.fetchMaterialMasterRows = async (path) => {
    requestedPath = path;
    return [
      { Code: 'A01-012', Name: '【电路板】（蓝）L型电源转接板', InventoryClass: { Name: '电路板' }, Unit: { Name: '个' } },
      { Code: 'A01-013', Name: '【电路板】快充主板', InventoryClass: { Name: '电路板' }, Unit: { Name: '个' } },
    ];
  };
  mutableService.recordMaterialMasterSync = async () => undefined;

  const result = await service.syncMaterialMaster();

  assert.equal(requestedPath, '/tplus/api/v2/inventory/Query');
  assert.deepEqual(result, {
    received: 2,
    created: 1,
    updated: 1,
    conflicts: 0,
    disabled: 0,
    scannedNodes: 2,
    linkedNodes: 1,
    unmatchedNodes: 1,
    ambiguousNodes: 0,
  });
  assert.equal(creates[0].erpCode, 'A01-013');
  assert.equal(creates[0].tpInventoryCode, 'A01-013');
  assert.equal(creates[0].reviewStatus, 'approved');
  assert.equal(updates[0].category, undefined);
  assert.equal(updates[0].name, '【电路板】（蓝）L型电源转接板');
});

test('已有 T+ 物料时主档接口意外返回空集会中止并记录失败', async () => {
  let recordedSucceeded: boolean | undefined;
  const service = new TplusSyncService(
    {
      procMaterial: {
        findMany: async () => [{
          id: 'material-013',
          name: '快充主板',
          spec: '',
          unit: '个',
          category: '电路板',
          erpCode: 'A01-013',
          tpInventoryCode: 'A01-013',
          metadata: {},
        }],
      },
    } as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const mutableService = service as unknown as {
    fetchMaterialMasterRows: () => Promise<unknown[]>;
    recordMaterialMasterSync: (succeeded: boolean) => Promise<void>;
  };
  mutableService.fetchMaterialMasterRows = async () => [];
  mutableService.recordMaterialMasterSync = async (succeeded) => { recordedSucceeded = succeeded; };

  await assert.rejects(() => service.syncMaterialMaster(), /返回 0 条/);
  assert.equal(recordedSucceeded, false);
});

test('T+ 存货主档按官方 Query 接口和 Ts 游标连续拉取全量', async () => {
  const requests: Array<{ path: string; params: Record<string, unknown> }> = [];
  const firstPage = Array.from({ length: 1000 }, (_, index) => ({
    Code: `M-${index + 1}`,
    Name: `物料 ${index + 1}`,
    Ts: `cursor-${index + 1}`,
  }));
  const service = new TplusSyncService({} as never, {} as never, {} as never, {} as never);
  const mutableService = service as unknown as {
    fetchFromTplus: (path: string, params: Record<string, unknown>) => Promise<unknown>;
    fetchMaterialMasterRows: (path: string) => Promise<unknown[]>;
  };
  mutableService.fetchFromTplus = async (path, params) => {
    requests.push({ path, params });
    return params.Ts
      ? { result: [{ Code: 'A01-013', Name: '【电路板】快充主板', Ts: 'cursor-1001' }] }
      : { result: firstPage };
  };

  const rows = await mutableService.fetchMaterialMasterRows('/tplus/api/v2/inventory/Query');

  assert.equal(rows.length, 1001);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].path, '/tplus/api/v2/inventory/Query');
  assert.equal(requests[0].params.PageSize, '1000');
  assert.equal(requests[0].params.Ts, undefined);
  assert.match(String(requests[0].params.SelectFields), /Code/);
  assert.match(String(requests[0].params.SelectFields), /Ts/);
  assert.equal(requests[0].params.PageIndex, undefined);
  assert.equal(requests[1].params.Ts, 'cursor-1000');
});

test('T+ 存货查询 403 会明确提示申请接口权限、更新授权和重取 token', () => {
  const service = new TplusSyncService({} as never, {} as never, {} as never, {} as never);
  const mutableService = service as unknown as {
    tplusHttpErrorMessage: (path: string, status: number, responseText: string) => string;
  };

  const message = mutableService.tplusHttpErrorMessage(
    '/tplus/api/v2/inventory/Query',
    403,
    JSON.stringify({ message: 'openToken无调用该接口的权限' }),
  );

  assert.match(message, /存货查询/);
  assert.match(message, /openToken无调用该接口的权限/);
  assert.match(message, /权限配置/);
  assert.match(message, /更新授权/);
  assert.match(message, /重新获取 token/);
});

test('已部署的 QueryPage 旧配置会自动迁移到官方 Query 路径', () => {
  const previous = process.env.TPLUS_MATERIAL_MASTER_PATH;
  process.env.TPLUS_MATERIAL_MASTER_PATH = '/tplus/api/v2/inventory/QueryPage';
  try {
    const service = new TplusSyncService({} as never, {} as never, {} as never, {} as never);
    const mutableService = service as unknown as { materialMasterPath: () => string };
    assert.equal(mutableService.materialMasterPath(), '/tplus/api/v2/inventory/Query');
  } finally {
    if (previous === undefined) delete process.env.TPLUS_MATERIAL_MASTER_PATH;
    else process.env.TPLUS_MATERIAL_MASTER_PATH = previous;
  }
});
