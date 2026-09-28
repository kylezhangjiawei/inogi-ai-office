import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { QuoteBookService } from '../src/modules/procurement/quote-book.service';

type RecordData = Record<string, any>;
type QuoteRow = RecordData & { id: string; updatedAt: Date };

function makeService(initialQuote?: RecordData, initialHistory: RecordData[] = []) {
  const histories = [...initialHistory];
  const now = new Date('2026-09-01T00:00:00.000Z');
  let quote: QuoteRow | null = initialQuote ? {
    id: 'quote-1', materialId: 'material-1', supplierId: 'supplier-1', supplierName: '甲厂',
    supplierModel: '', currency: 'GBP', taxIncluded: true, leadTimeDays: 0,
    tiers: [{ minQty: 0, unitPrice: 10 }], updatedAt: now, ...initialQuote,
  } : null;
  const prisma = {
    procMaterial: {
      findFirst: async () => ({ id: 'material-1', name: '减震垫' }),
      findMany: async () => [{ id: 'material-1', name: '减震垫', spec: '' }],
      findUnique: async () => ({ id: 'material-1', name: '减震垫' }),
    },
    procSupplier: { findMany: async () => [{ id: 'supplier-1', name: '甲厂', enabled: true }], findUniqueOrThrow: async () => ({ id: 'supplier-1', name: '甲厂', enabled: true }) },
    procSupplierQuote: {
      findUnique: async () => quote,
      findFirst: async ({ where }: { where: RecordData }) => where.id?.not ? null : quote,
      upsert: async ({ create, update }: { create: RecordData; update: RecordData }) => { quote = quote ? { ...quote, ...update } : { id: 'quote-1', updatedAt: now, ...create }; return quote; },
      findMany: async () => quote ? [{ ...quote, material: { name: '减震垫' } }] : [],
      create: async ({ data }: { data: RecordData }) => { quote = { id: 'quote-1', updatedAt: now, ...data }; return quote; },
      update: async ({ data }: { data: RecordData }) => { assert.ok(quote, '更新前报价必须存在'); quote = { ...quote, ...data }; return quote; },
      delete: async () => { quote = null; },
      deleteMany: async () => { const count = quote ? 1 : 0; quote = null; return { count }; },
    },
    procQuotation: {
      findFirst: async ({ where }: { where: RecordData }) => histories.find((history) =>
        Object.entries(where).every(([key, value]) => value === undefined || history[key] === value)) ?? null,
      create: async ({ data }: { data: RecordData }) => { const row = { currency: 'CNY', ...data }; histories.push(row); return row; },
    },
  };
  Object.assign(prisma, { $transaction: async (fn: any) => fn(prisma), $executeRaw: async () => 1 });
  return { service: new QuoteBookService(prisma as never, {} as never, {} as never, {} as never), histories, prisma, current: () => quote };
}

test('修改报价价格和币种时，历史保留被覆盖版本的原币种', async () => {
  const { service, histories, current } = makeService({});
  await service.updateQuote('quote-1', { materialId: 'material-1', supplierName: '甲厂', currency: 'USD', tiers: [{ minQty: 0, unitPrice: 12 }] });
  assert.deepEqual(histories.map(({ currency, unitPrice }) => ({ currency, unitPrice })), [{ currency: 'GBP', unitPrice: 10 }]);
  assert.equal(current()?.currency, 'USD');
});

test('仅变更币种、数值不变，也为原报价留痕', async () => {
  const { service, histories } = makeService({});
  await service.updateQuote('quote-1', { materialId: 'material-1', supplierName: '甲厂', currency: 'USD', tiers: [{ minQty: 0, unitPrice: 10 }] });
  assert.equal(histories.length, 1);
  assert.equal(histories[0].currency, 'GBP');
});

test('导入覆盖与表格历史轮次分别保留旧币种和新币种，不跨币种去重', async () => {
  const { service, histories, current } = makeService({}, [{
    materialId: 'material-1', supplierName: '甲厂', currency: 'CNY', unitPrice: 5, channel: 'quote-book',
  }]);
  const item = { materialName: '减震垫', supplierName: '甲厂', currency: 'EUR', tiers: [{ minQty: 0, unitPrice: 10 }], historyPrices: [{ unitPrice: 5 }] };
  const result = await service.importQuotes({ items: [item] }, { id: 'user-1' } as never);
  assert.deepEqual(result.errors, []);
  assert.equal(result.updated, 1);
  assert.equal(current()?.currency, 'EUR');
  assert.deepEqual(histories.map(({ currency, unitPrice }) => ({ currency, unitPrice })), [
    { currency: 'CNY', unitPrice: 5 }, { currency: 'GBP', unitPrice: 10 }, { currency: 'EUR', unitPrice: 5 },
  ]);
  await service.importQuotes({ items: [item] }, { id: 'user-1' } as never);
  assert.equal(histories.length, 3, '相同币种同价重复导入仍应去重');
});

test('删除报价与移出商品也沿用原币种留痕', async () => {
  const deleted = makeService({ currency: 'JPY' });
  await deleted.service.deleteQuote('quote-1');
  assert.equal(deleted.histories[0].currency, 'JPY');
  const cleared = makeService({ currency: 'EUR' });
  await cleared.service.clearMaterialQuotes('material-1');
  assert.equal(cleared.histories[0].currency, 'EUR');
});

test('新增导入的历史跟随报价币种，未填写时仍默认人民币', async () => {
  for (const currency of ['USD', undefined]) {
    const { service, histories, current } = makeService();
    const result = await service.importQuotes({ items: [{
      materialName: '减震垫', supplierName: '甲厂', currency,
      tiers: [{ minQty: 0, unitPrice: 10 }], historyPrices: [{ unitPrice: 9 }],
    }] }, { id: 'user-1' } as never);
    assert.deepEqual(result.errors, []);
    assert.equal(result.created, 1);
    assert.equal(histories[0].currency, currency ?? 'CNY');
    assert.equal(current()?.currency, currency ?? 'CNY');
  }
});



test('同批重复报价和分档合并只写一条，重复导入继续更新同一条', async () => {
  const {service,current,histories} = makeService();
  const base = {materialName:'减震垫',supplierName:'甲厂',tiers:[{minQty:10,unitPrice:12}]};
  const dto = {items:[base,{...base,supplierName:' 甲厂 ',tiers:[{minQty:10,unitPrice:12},{minQty:100,unitPrice:10}]}]};
  const first = await service.importQuotes(dto,{id:'u'} as never);
  assert.equal(first.created,1);assert.equal(first.updated,0);assert.deepEqual(first.errors,[]);
  assert.deepEqual(current()?.tiers,[{minQty:10,unitPrice:12},{minQty:100,unitPrice:10}]);
  const second = await service.importQuotes(dto,{id:'u'} as never);
  assert.equal(second.created,0);assert.equal(second.updated,1);assert.equal(histories.length,0);
});

test('重复行价格冲突提前拒绝，不写入任何报价', async () => {
  const {service,current} = makeService();
  await assert.rejects(service.importQuotes({items:[{materialName:'减震垫',supplierName:'甲厂',tiers:[{minQty:10,unitPrice:12}]},{materialName:'减震垫',supplierName:'甲厂',tiers:[{minQty:10,unitPrice:13}]}]}, {id:'u'} as never),/不同价格/);
  assert.equal(current(),null);
});

test('同名物料必须明确规格；多个同名供应商不能按名称任选', async () => {
  const {service,prisma,current} = makeService();
  prisma.procMaterial.findMany = async () => [{id:'m1',name:'减震垫',spec:'A'},{id:'m2',name:'减震垫',spec:'B'}] as any;
  const item = {materialName:'减震垫',supplierName:'甲厂',tiers:[{minQty:10,unitPrice:12}]};
  const ambiguous = await service.importQuotes({items:[item]},{id:'u'} as never);
  assert.match(ambiguous.errors[0].message,/准确规格/);assert.equal(current(),null);
  await service.importQuotes({items:[{...item,spec:'B'}]},{id:'u'} as never);
  assert.equal(current()?.materialId,'m2');
  prisma.procSupplier.findMany = async () => [{id:'s1',name:'甲厂',enabled:true},{id:'s2',name:'甲厂',enabled:true}];
  const sameName = await service.importQuotes({items:[item]},{id:'u'} as never);
  assert.match(sameName.errors[0].message,/同名供应商/);
});

test('图片识别按规格分组，不能先把不同规格混成同条报价', () => {
  const {service} = makeService();
  const item = {materialName:'减震垫',supplierName:'甲厂',tiers:[{minQty:10,unitPrice:12}]};
  const items = (service as any).mergeAiItems([{...item,spec:'A'},{...item,spec:'B'}]);
  assert.equal(items.length,2);
});
