import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { TplusSyncService } from '../src/modules/procurement/tplus-sync.service';
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


type Row = Record<string, any>;
type SupplierRow = {
  id: string; name: string; enabled: boolean; source: string; tpCode: string | null;
  metadata: Row; phone?: string;
};
function writableDirectory(initial: (Pick<SupplierRow, 'id' | 'name'> & Partial<SupplierRow>)[] = []) {
  const suppliers: SupplierRow[] = initial.map(row => ({ enabled: true, source: 'local', tpCode: null, metadata: {}, ...row }));
  const prisma: any = {
    $executeRaw: async () => 1,
    procMaterial: { findUnique: async () => ({ id: 'material-1' }) },
    procSupplier: {
      findMany: async ({ where }: any = {}) => suppliers.filter(s => !where || Object.entries(where).every(([key,value]) => s[key] === value)),
      findUnique: async ({ where }: any) => suppliers.find(s => Object.entries(where).every(([key,value]) => s[key] === value)) || null,
      update: async ({ where, data }: any) => { const row = suppliers.find(s => s.id === where.id)!; Object.assign(row,data); return row; },
      create: async ({ data }: any) => { const row = { id: `supplier-${suppliers.length+1}`, enabled: true, metadata: {}, ...data }; suppliers.push(row); return row; },
      upsert: async ({ where, create, update }: any) => { const row = suppliers.find(s => s.tpCode === where.tpCode); if(row){Object.assign(row,update);return row;}return prisma.procSupplier.create({data:create}); },
    },
  };
  prisma.$transaction = async (fn: any) => fn(prisma);
  return { prisma, suppliers, service: new QuoteBookService(prisma, {} as never, {} as never, {} as never) };
}

test('手动新增对全半角、大小写、空格统一查重，并保留不同 ERP 编码的同名档案', async () => {
  const {service,suppliers} = writableDirectory([{id:'a',name:'Acme Tools',tpCode:'ERP-A',source:'tplus'}, {id:'b',name:'Acme Tools',tpCode:'ERP-B',source:'tplus'}]);
  await assert.rejects(service.saveSupplierProfile(undefined,{name:' ＡＣＭＥ   Tools '}),/已存在/);
  assert.equal(suppliers.length,2);
  await service.saveSupplierProfile('a',{name:'Acme Tools',grade:'A'});
  assert.equal((await service.supplierDirectory()).suppliers[0].grade,'A');
  assert.equal(suppliers[1].tpCode,'ERP-B');
});

test('ERP 档案编辑只补充业务资料，保留 ERP 主字段与其他元数据', async () => {
  const {service,suppliers} = writableDirectory([{id:'a',name:'甲厂',source:'tplus',phone:'原电话',metadata:{other:'保留',quoteBookMaterialRoles:{'material-1':'primary'}}}]);
  await service.saveSupplierProfile('a',{name:'恶意改名',phone:'新电话',grade:'B',cooperationStart:'2024-03'});
  assert.equal(suppliers[0].name,'甲厂');assert.equal(suppliers[0].phone,'原电话');
  assert.equal(suppliers[0].metadata.other,'保留');assert.equal(suppliers[0].metadata.quoteBookMaterialRoles['material-1'],'primary');
  assert.equal((await service.supplierDirectory()).suppliers[0].cooperationStart,'2024-03');
});

test('主供切换同物料仅保留一个主供，其他物料与档案信息保留', async () => {
  const {service,suppliers} = writableDirectory([{id:'a',name:'甲',metadata:{quoteBook:{grade:'A'},quoteBookMaterialRoles:{'material-1':'primary',other:'primary'}}},{id:'b',name:'乙'}]);
  await service.saveSupplierMaterialRole('b','material-1','primary');
  assert.equal(suppliers[0].metadata.quoteBookMaterialRoles['material-1'],'alternative');
  assert.equal(suppliers[1].metadata.quoteBookMaterialRoles['material-1'],'primary');
  assert.equal(suppliers[0].metadata.quoteBookMaterialRoles.other,'primary');assert.equal(suppliers[0].metadata.quoteBook.grade,'A');
});

test('ERP 同步复用唯一同名本地档案 ID；重复同步不重建，异码同名不误合并', async () => {
  const {prisma,suppliers} = writableDirectory([{id:'local-existing',name:' Acme  Tools ',metadata:{quoteBook:{grade:'A'}}}]);
  const service = new TplusSyncService(prisma,{} as never,{} as never,{} as never);
  let incoming = [{Code:'ERP1',Name:'ACME Tools',Phone:'123'}];
  (service as any).fetchAllPages = async () => incoming;
  await service.syncSuppliers();await service.syncSuppliers();
  assert.equal(suppliers.length,1);assert.equal(suppliers[0].id,'local-existing');assert.equal(suppliers[0].tpCode,'ERP1');
  assert.equal(suppliers[0].metadata.quoteBook.grade,'A');assert.equal(suppliers[0].phone,'123');
  incoming = [{Code:'ERP2',Name:'ACME Tools',Phone:'456'}];await service.syncSuppliers();
  assert.equal(suppliers.length,2);assert.equal(suppliers[0].tpCode,'ERP1');assert.equal(suppliers[1].tpCode,'ERP2');
});

test('ERP 遇多个同名本地档案中止该项，不任意绑定其中一个', async () => {
  const {prisma,suppliers} = writableDirectory([{id:'a',name:'甲厂'},{id:'b',name:'甲厂'}]);
  const service = new TplusSyncService(prisma,{} as never,{} as never,{} as never);
  (service as any).fetchAllPages = async () => [{Code:'ERP1',Name:'甲厂'}];
  await assert.rejects(service.syncSuppliers(),/多个本地档案/);
  assert.ok(suppliers.every(s => s.tpCode === null));
});
