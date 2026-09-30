import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../src/modules/auth/guards/roles.guard';
import { QuoteBookController } from '../src/modules/procurement/quote-book.controller';

import { ProcurementService } from '../src/modules/procurement/procurement.service';

test('仅采购登记权限可读供应商目录，但不能读取报价或写入报价库', async () => {
  const allowed = (method: keyof QuoteBookController, permissions: string[]) => new RolesGuard(new Reflector()).canActivate({
    getHandler: () => QuoteBookController.prototype[method],
    getClass: () => QuoteBookController,
    switchToHttp: () => ({ getRequest: () => ({ user: { permissions } }) }),
  } as unknown as ExecutionContext);
  assert.equal(allowed('listSuppliers', ['proc-task:order']), true);
  assert.equal(allowed('listSuppliers', ['page:proc-quote-book']), true);
  assert.equal(allowed('listSuppliers', []), false);
  assert.equal(allowed('listSuppliers', ['page:proc-cockpit']), false);
  for (const method of ['list', 'createQuote', 'updateQuote', 'deleteQuote', 'importQuotes', 'aiParseQuotes', 'ocrParseQuotes', 'clearMaterialQuotes'] as const) {
    assert.equal(allowed(method, ['proc-task:order']), false, method);
  }
  assert.equal(allowed('createQuote', ['quote-book:manage']), true);
  assert.equal(allowed('createQuote', ['proc-task:inquiry']), true);
  const expected = { suppliers: [{ id: 'tplus-1', name: '畅捷通供应商', source: 'tplus' }] };
  const controller = new QuoteBookController({ listSuppliers: async () => expected } as never);
  assert.deepEqual(await controller.listSuppliers(), expected);
});

test('未绑定物料的采购任务仍可读取并搜索全库有效报价', async () => {
  const quoteQueries: Array<Record<string, unknown>> = [];
  const prisma = {
    procTask: {
      findUnique: async () => ({
        id: 'task-1',
        materialId: null,
        materialName: '电池盒样件问题',
        spec: '',
        quantity: 1,
      }),
    },
    procMaterial: {
      findFirst: async () => null,
    },
    procSupplierQuote: {
      findMany: async (args: Record<string, unknown>) => {
        quoteQueries.push(args);
        return [
          {
            id: 'quote-upper',
            materialId: 'material-upper',
            material: { name: '电池上壳', spec: '' },
            supplierId: 'supplier-1',
            supplierName: '明博（原模具）',
            supplierModel: '',
            currency: 'CNY',
            taxIncluded: true,
            leadTimeDays: 7,
            tiers: [{ minQty: 0, unitPrice: 4.5 }],
            quoteDate: null,
            validUntil: null,
            note: null,
            updatedAt: new Date('2026-07-29T00:00:00.000Z'),
          },
          {
            id: 'quote-lower',
            materialId: 'material-lower',
            material: { name: '电池下壳', spec: '' },
            supplierId: 'supplier-1',
            supplierName: '明博（原模具）',
            supplierModel: '',
            currency: 'CNY',
            taxIncluded: true,
            leadTimeDays: 7,
            tiers: [{ minQty: 0, unitPrice: 6.5 }],
            quoteDate: null,
            validUntil: null,
            note: null,
            updatedAt: new Date('2026-07-29T00:00:00.000Z'),
          },
        ];
      },
    },
  };
  const service = new ProcurementService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
  );

  const result = await service.listTaskQuoteBookOptions('task-1');

  assert.equal(result.materialId, null);
  assert.equal(result.scope, 'all');
  assert.equal(result.quotes.length, 2);
  assert.deepEqual(
    result.quotes.map((quote) => quote.materialName).sort(),
    ['电池上壳', '电池下壳'].sort(),
  );
  const where = quoteQueries[0]?.where as Record<string, unknown>;
  assert.equal('materialId' in where, false);
  assert.deepEqual(where.source, { not: 'tplus-order' });
  const validity = where.OR as Array<{ validUntil: null | { gte: Date } }>;
  assert.equal(validity[0]?.validUntil, null);
  assert.ok(validity[1]?.validUntil && 'gte' in validity[1].validUntil);
});

test('历史订单参考价不可直接带入采购任务',async()=>{
  const service:any=new ProcurementService({procTask:{findUnique:async()=>({id:'t1',materialId:'m1',quantity:1})},
    procSupplierQuote:{findMany:async()=>[{id:'history',source:'tplus-order',tiers:[{minQty:0,unitPrice:1}]}]}} as never,{} as never,{} as never,{} as never);
  assert.deepEqual((await service.listTaskQuoteBookOptions('t1')).quotes,[]);
});

test('报价带入按供应商档案去重，同名不同档案分别保留',async()=>{
  const rows:any[]=[{materialId:'m1',supplierId:'s1',supplierName:'同名厂商'}];
  const db:any={procQuotation:{findMany:async()=>rows,createMany:async({data}:any)=>rows.push(...data)},procTaskLog:{create:async()=>({})}};
  db.$transaction=async(fn:any)=>fn(db);
  const service:any=new ProcurementService(db,{} as never,{} as never,{} as never);
  service.requireTask=async()=>({id:'t1',status:'inquiring',materialId:'m1',materialName:'物料'});
  service.listTaskQuoteBookOptions=async()=>({quotes:['s1','s2'].map(supplierId=>({id:supplierId,materialId:'m1',supplierId,supplierName:'同名厂商',matchedTier:{minQty:0,unitPrice:12},currency:'CNY',taxIncluded:true}))});
  service.listQuotations=async()=>rows;
  await service.addQuotationsFromQuoteBook('t1',{quoteIds:['s1','s2']},{id:'u1',name:'采购员',permissions:[]});
  assert.deepEqual(rows.map(r=>r.supplierId),['s1','s2']);
  await assert.rejects(service.addQuotationsFromQuoteBook('t1',{quoteIds:['s2']},{id:'u1',name:'采购员',permissions:[]}),/已带入/);
});

test('可按逐条数量计算多条报价，扣减折扣后一次确认并保存总价', async () => {
  const task = {
    id: 'task-1',
    materialId: null,
    materialName: '电池盒样件问题',
    spec: '',
    quantity: 1,
    status: 'pending_inquiry',
    needSample: false,
  };
  const createdSnapshots: Array<Record<string, unknown>> = [];
  const materialUpdates: Array<Record<string, unknown>> = [];
  const taskUpdates: Array<Record<string, unknown>> = [];
  let quotationSequence = 0;
  const prisma = {
    procTask: {
      findUnique: async () => task,
      updateMany: async ({ where }: { where: { id: string; status: string } }) => {
        assert.equal(where.id, task.id);
        return { count: task.status === where.status ? 1 : 0 };
      },
      update: async (args: Record<string, unknown>) => {
        taskUpdates.push(args);
        return task;
      },
    },
    procMaterial: {
      findFirst: async () => null,
      updateMany: async (args: Record<string, unknown>) => {
        materialUpdates.push(args);
        return { count: 1 };
      },
    },
    procSupplierQuote: {
      findMany: async () => [
        {
          id: 'quote-upper',
          materialId: 'material-upper',
          material: { name: '电池上壳', spec: '' },
          supplierId: 'supplier-1',
          supplierName: '供应商甲',
          supplierModel: 'A-01',
          currency: 'CNY',
          taxIncluded: true,
          leadTimeDays: 7,
          tiers: [{ minQty: 0, unitPrice: 4.5 }],
          quoteDate: new Date('2026-07-20T00:00:00.000Z'),
          validUntil: null,
          note: null,
          updatedAt: new Date('2026-07-29T00:00:00.000Z'),
        },
        {
          id: 'quote-lower',
          materialId: 'material-lower',
          material: { name: '电池下壳', spec: '' },
          supplierId: 'supplier-2',
          supplierName: '供应商乙',
          supplierModel: 'B-01',
          currency: 'CNY',
          taxIncluded: true,
          leadTimeDays: 9,
          tiers: [{ minQty: 0, unitPrice: 6.5 }],
          quoteDate: new Date('2026-07-21T00:00:00.000Z'),
          validUntil: null,
          note: null,
          updatedAt: new Date('2026-07-29T00:00:00.000Z'),
        },
      ],
    },
    procQuotation: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const snapshot = { id: `snapshot-${++quotationSequence}`, ...data };
        createdSnapshots.push(snapshot);
        return snapshot;
      },
    },
    $transaction: async (run: (tx: unknown) => Promise<unknown>) => run(prisma),
  };
  const service = new ProcurementService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
  );
  service.getTask = async () => ({ id: task.id, status: 'inquiring' }) as never;

  const result = await service.confirmQuotationsFromQuoteBook(
    task.id,
    {
      selections: [
        { quoteId: 'quote-upper', quantity: 100 },
        { quoteId: 'quote-lower', quantity: 50 },
      ],
      discountAmount: 25,
    },
    { id: 'buyer-1', name: '采购员', permissions: ['proc-task:inquiry'] },
  );

  assert.equal(createdSnapshots.length, 2);
  assert.ok(createdSnapshots.every((snapshot) => snapshot.isSelected === true));
  assert.deepEqual(
    createdSnapshots.map((snapshot) => snapshot.materialId),
    ['material-upper', 'material-lower'],
  );
  assert.deepEqual(
    createdSnapshots.map((snapshot) => Number(snapshot.quantity)),
    [100, 50],
  );
  assert.deepEqual(
    createdSnapshots.map((snapshot) => Number(snapshot.lineTotal)),
    [450, 325],
  );
  assert.equal(materialUpdates.length, 2);
  const taskData = taskUpdates[0]?.data as Record<string, unknown>;
  // 确认报价只前进一格到「询价中」，去 已定价/待到样/测试中 由随后的「完成询价」决定。
  // 曾经这里直接写 priced，界面上就表现为「待询价一点就窜到已定价」，用户按跳步反复反馈。
  assert.equal(taskData.status, 'inquiring');
  assert.equal(taskData.selectedQuotationId, 'snapshot-1');
  assert.equal(Number(taskData.quotationSubtotal), 775);
  assert.equal(Number(taskData.quotationDiscount), 25);
  assert.equal(Number(taskData.quotationTotal), 750);
  assert.equal(taskData.quotationCurrency, 'CNY');
  assert.deepEqual(result, { id: task.id, status: 'inquiring' });
});

function quoteStateHarness() {
  let row = { id: 'task-1', status: 'pending_inquiry', updatedAt: new Date('2026-09-17T00:00:00Z'), materialId: null, materialName: '隔离物料', quantity: 10 };
  let beforeSelection: (() => void) | undefined;
  const snapshots: Array<Record<string, unknown>> = [];
  const tx = {
    procTask: {
      updateMany: async ({ where, data }: { where: { status: string; updatedAt: Date }; data: { status: string } }) => {
        if (row.status !== where.status || row.updatedAt.getTime() !== where.updatedAt.getTime()) return { count: 0 };
        row = { ...row, ...data };
        return { count: 1 };
      },
      update: async () => row,
    },
    procMaterial: { updateMany: async () => ({ count: 1 }) },
    procQuotation: { create: async ({ data }: { data: Record<string, unknown> }) => {
      const quote = { id: String(snapshots.length), ...data };
      snapshots.push(quote); return quote;
    } },
  };
  const service = Object.create(ProcurementService.prototype) as ProcurementService;
  Object.assign(service, {
    prisma: { $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx) },
    requireTask: async () => ({ ...row }),
    getTask: async () => ({ ...row }),
    listTaskQuoteBookOptions: async () => {
      beforeSelection?.(); beforeSelection = undefined;
      return { quotes: [{ id: 'q1', materialId: 'm1', materialName: '隔离物料', supplierName: '隔离供应商',
        currency: 'CNY', tiers: [{ minQty: 0, unitPrice: 10 }], leadTimeDays: 1 }] };
    },
  });
  const save = () => service.confirmQuotationsFromQuoteBook(row.id,
    { selections: [{ quoteId: 'q1', quantity: 10 }], discountAmount: 0 },
    { id: 'buyer', name: '采购员', permissions: ['proc-task:inquiry'] });
  return { save, snapshots, row: () => row, interleave(status: string) { beforeSelection = () => { row = { ...row, status, updatedAt: new Date(row.updatedAt.getTime() + 1) }; }; } };
}

test('过期报价不能恢复已取消、回退或同状态已更新的任务，不生成任何报价', async () => {
  for (const status of ['cancelled', 'pending_confirm', 'pending_sample', 'completed', 'pending_inquiry']) {
    const h = quoteStateHarness(); h.interleave(status);
    await assert.rejects(h.save(), (error: any) => error.getStatus() === 409);
    assert.equal(h.row().status, status);
    assert.equal(h.snapshots.length, 0);
  }
});

test('同一待询价任务并发保存只能成功一次，另一笔冲突且不重复创建报价', async () => {
  const h = quoteStateHarness();
  const results = await Promise.allSettled([h.save(), h.save()]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const failed = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
  assert.equal(failed.reason.getStatus(), 409);
  assert.equal(h.snapshots.length, 1);
  assert.equal(h.row().status, 'inquiring');
});
