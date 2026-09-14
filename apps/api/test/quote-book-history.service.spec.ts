import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { QuoteBookService } from '../src/modules/procurement/quote-book.service';

type RecordData = Record<string, any>;

function makeService(initialQuote?: RecordData, initialHistory: RecordData[] = []) {
  const histories = [...initialHistory];
  const now = new Date('2026-09-01T00:00:00.000Z');
  let quote = initialQuote ? {
    id: 'quote-1', materialId: 'material-1', supplierId: 'supplier-1', supplierName: '甲厂',
    supplierModel: '', currency: 'GBP', taxIncluded: true, leadTimeDays: 0,
    tiers: [{ minQty: 0, unitPrice: 10 }], updatedAt: now, ...initialQuote,
  } : null;
  const prisma = {
    procMaterial: {
      findFirst: async () => ({ id: 'material-1', name: '减震垫' }),
      findUnique: async () => ({ id: 'material-1', name: '减震垫' }),
    },
    procSupplier: { findFirst: async () => ({ id: 'supplier-1' }) },
    procSupplierQuote: {
      findUnique: async () => quote,
      findMany: async () => quote ? [{ ...quote, material: { name: '减震垫' } }] : [],
      create: async ({ data }: { data: RecordData }) => { quote = { id: 'quote-1', updatedAt: now, ...data } as typeof quote; return quote; },
      update: async ({ data }: { data: RecordData }) => { quote = { ...quote, ...data } as typeof quote; return quote; },
      delete: async () => { quote = null; },
      deleteMany: async () => { const count = quote ? 1 : 0; quote = null; return { count }; },
    },
    procQuotation: {
      findFirst: async ({ where }: { where: RecordData }) => histories.find((history) =>
        Object.entries(where).every(([key, value]) => value === undefined || history[key] === value)) ?? null,
      create: async ({ data }: { data: RecordData }) => { const row = { currency: 'CNY', ...data }; histories.push(row); return row; },
    },
  };
  return { service: new QuoteBookService(prisma as never, {} as never, {} as never, {} as never), histories, current: () => quote };
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
