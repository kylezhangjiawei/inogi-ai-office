import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { QuoteBookService } from '../src/modules/procurement/quote-book.service';

const updatedAt = new Date('2026-09-10T01:00:00.000Z');

function quote(overrides: Record<string, unknown> = {}) {
  return {
    id: 'quote-1', materialId: 'material-1', supplierId: 'supplier-1', supplierName: '旧厂家名称',
    supplierModel: 'M-20', currency: 'CNY', taxIncluded: true, leadTimeDays: 12,
    tiers: [{ minQty: 100, unitPrice: 1.25 }], quoteDate: updatedAt, validUntil: null,
    note: null, imageKey: null, updatedAt,
    supplier: { id: 'supplier-1', name: '当前厂家名称', source: 'local', enabled: true },
    ...overrides,
  };
}

function material(overrides: Record<string, unknown> = {}) {
  return {
    id: 'material-1', name: '电池', spec: '待核对规格', unit: '个', category: '电子件', productLine: 'Q5',
    tpInventoryCode: 'T+ BAT-01', erpCode: 'INOGI-BAT-01', reviewStatus: 'pending',
    imageKey: null, latestPrice: null, latestSupplier: null, latestQuoteDate: null,
    supplierQuotes: [quote()], ...overrides,
  };
}

function makeService(materials: ReturnType<typeof material>[]) {
  const calls: unknown[] = [];
  const prisma = {
    procMaterial: {
      findMany: async (query: unknown) => { calls.push(query); return materials; },
    },
  };
  return { service: new QuoteBookService(prisma as never, {} as never, {} as never, {} as never), calls };
}

test('报价目录保留真实物料编码与审核状态，同名不同规格不合并', async () => {
  const { service } = makeService([
    material(),
    material({ id: 'material-2', spec: '另一规格', tpInventoryCode: null, erpCode: '', reviewStatus: 'rejected', supplierQuotes: [] }),
  ]);
  const { rows } = await service.listQuoteBook();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].tpInventoryCode, 'T+ BAT-01');
  assert.equal(rows[0].erpCode, 'INOGI-BAT-01');
  assert.equal(rows[0].reviewStatus, 'pending');
  assert.equal(rows[1].id, 'material-2');
  assert.equal(rows[1].tpInventoryCode, undefined);
  assert.equal(rows[1].erpCode, '');
  assert.equal(rows[1].reviewStatus, 'rejected');
  assert.deepEqual(rows[1].quotes, []);
});

test('当前供应商关联与报价厂家快照分开返回，不把本地关联解释为 ERP 对应', async () => {
  const { service } = makeService([material()]);
  const { rows } = await service.listQuoteBook();
  const result = rows[0].quotes[0];
  assert.equal(result.supplierName, '旧厂家名称');
  assert.equal(result.supplierId, 'supplier-1');
  assert.deepEqual(result.supplier, { id: 'supplier-1', name: '当前厂家名称', source: 'local', enabled: true });
  assert.deepEqual(result.tiers, [{ minQty: 100, unitPrice: 1.25 }]);
  assert.equal(result.leadTimeDays, 12);
  assert.equal(result.quoteDate, '2026-09-10');
});

test('已停用供应商仍保留真实关联，未关联厂家不按相同名称补匹配', async () => {
  const disabled = { id: 'supplier-disabled', name: '同名厂家', source: 'tplus', enabled: false };
  const { service } = makeService([material({ supplierQuotes: [
    quote({ id: 'quote-disabled', supplierId: disabled.id, supplierName: disabled.name, supplier: disabled }),
    quote({ id: 'quote-unlinked', supplierId: null, supplierName: disabled.name, supplier: null }),
  ] })]);
  const { rows } = await service.listQuoteBook();
  assert.deepEqual(rows[0].quotes[0].supplier, disabled);
  assert.equal(rows[0].quotes[1].supplierId, undefined);
  assert.equal(rows[0].quotes[1].supplier, undefined);
  assert.equal(rows[0].quotes[1].supplierName, disabled.name);
});

test('一次只读查询包含全部物料与关联供应商，不筛掉停用供应商，也不读取联系方式', async () => {
  const { service, calls } = makeService([]);
  assert.deepEqual(await service.listQuoteBook(), { rows: [] });
  assert.deepEqual(calls, [{
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
    include: { supplierQuotes: {
      orderBy: { supplierName: 'asc' },
      include: { supplier: { select: { id: true, name: true, source: true, enabled: true } } },
    } },
  }]);
});

test('缺少新字段的旧测试数据仍保持原报价兼容输出', async () => {
  const oldMaterial = material();
  delete (oldMaterial as Record<string, unknown>).tpInventoryCode;
  delete (oldMaterial as Record<string, unknown>).erpCode;
  delete (oldMaterial as Record<string, unknown>).reviewStatus;
  delete (oldMaterial.supplierQuotes[0] as Record<string, unknown>).supplier;
  const { service } = makeService([oldMaterial]);
  const { rows } = await service.listQuoteBook();
  assert.equal(rows[0].tpInventoryCode, undefined);
  assert.equal(rows[0].erpCode, undefined);
  assert.equal(rows[0].reviewStatus, undefined);
  assert.equal(rows[0].quotes[0].supplier, undefined);
  assert.equal(rows[0].quotes[0].supplierName, '旧厂家名称');
  assert.equal(rows[0].quotes[0].updatedAt, updatedAt.toISOString());
});
