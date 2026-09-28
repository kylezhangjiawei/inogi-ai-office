import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { SupplierQualificationsService, effectiveQualification, QUALIFICATION_PREFIX, type QualificationCommand } from '../src/modules/procurement/supplier-qualifications.service';

const reviewer = { id: 'reviewer', name: '审核人', permissions: ['page:proc-materials', 'material:review'] };
const buyer = { id: 'buyer', name: '采购人', permissions: ['page:proc-quote-book', 'quote-book:manage'] };
let sequence = 0;
const command = (patch: Partial<QualificationCommand> = {}): QualificationCommand => ({ requestId: `request-${String(++sequence).padStart(16, '0')}`, version: 0, materialId: 'material', supplierId: 'supplier-a', status: 'pending', productIds: ['product'], effectiveFrom: '2026-09-01', reason: '现场审核记录', evidenceFileIds: ['evidence'], ...patch });
function fixture() {
  const records = new Map<string, string>();
  const material = { id: 'material', name: '阀体', spec: '24V', reviewStatus: 'approved', erpCode: 'Q7-01', tpInventoryCode: 'Q7-01' };
  const suppliers = [{ id: 'supplier-a', name: '甲厂', enabled: true }, { id: 'supplier-b', name: '乙厂', enabled: true }];
  const assets = [{ id: 'evidence', fileName: '供应商审核.pdf', objectKey: 'assets/a.pdf', fileSize: 32, mimeType: 'application/pdf', uploadedBy: 'buyer', status: 'active', deletedAt: null as null | string }];
  const runtimeState = {
    findUnique: async ({ where }: any) => records.has(where.key) ? { key: where.key, value: records.get(where.key)! } : null,
    findMany: async ({ where }: any) => [...records].filter(([key]) => key.startsWith(where.key.startsWith)).map(([key, value]) => ({ key, value })),
    create: async ({ data }: any) => { if (records.has(data.key)) throw Object.assign(new Error('duplicate'), { code: 'P2002' }); records.set(data.key, data.value); return data; },
    updateMany: async ({ where, data }: any) => { if (records.get(where.key) !== where.value) return { count: 0 }; records.set(where.key, data.value); return { count: 1 }; },
  };
  const db: any = { runtimeState, procMaterial: { findUnique: async ({ where }: any) => where.id === material.id ? material : null, findMany: async () => [material] }, procSupplier: { findUnique: async ({ where }: any) => suppliers.find(row => row.id === where.id), findMany: async () => suppliers }, systemSetting: { findUnique: async () => ({ value: [{ id: 'product', name: 'Q7' }] }) }, procTaskTreeNode: { findMany: async () => [] }, fileAsset: { findMany: async ({ where }: any) => assets.filter(file => where.id.in.includes(file.id) && file.status === 'active' && !file.deletedAt), findUnique: async ({ where }: any) => assets.find(file => file.id === where.id) } };
  db.$transaction = async (run: any) => { const saved = new Map(records); try { return await run(db); } catch (error) { records.clear(); for (const [key, value] of saved) records.set(key, value); throw error; } };
  const service = new SupplierQualificationsService(db, { getReadUrl: (key: string) => ({ url: `https://signed.test/${key}` }) } as any);
  return { service, records, material, suppliers, assets, db };
}

test('同物料的供应商分别登记，报价本身不生成可供货关系', async () => {
  const { service } = fixture(); assert.equal((await service.list(buyer)).relations.length, 0);
  await service.save(command(), buyer); await service.save(command({ supplierId: 'supplier-b' }), buyer);
  const rows = (await service.list(buyer)).relations; assert.equal(rows.length, 2); assert.ok(rows.every(row => row.status === 'pending'));
  await service.save(command({ version: 1, status: 'approved' }), reviewer);
  assert.deepEqual((await service.list(buyer)).relations.map(row => row.status).sort(), ['approved', 'pending']);
});
test('读写及审核权限分别校验，采购不能自行确认或修改已确认关系', async () => {
  const { service } = fixture(); await assert.rejects(service.list({ ...buyer, permissions: [] }), /查看/);
  await assert.rejects(service.save(command(), { ...buyer, permissions: ['page:proc-materials'] }), /登记/);
  await service.save(command(), buyer);
  await assert.rejects(service.save(command({ version: 1, status: 'approved' }), buyer), /审核权限/);
  await service.save(command({ version: 1, status: 'approved' }), reviewer);
  await assert.rejects(service.save(command({ version: 2 }), buyer), /审核权限/);
});
test('真实物料、供应商、适用产品、日期和原因是服务器必填', async () => {
  const { service, material } = fixture();
  for (const patch of [{ materialId: 'missing' }, { supplierId: 'free-name' }, { productIds: ['fake'] }, { productIds: [] }, { effectiveFrom: '2026-02-30' }, { effectiveUntil: '2026-08-31' }, { reason: '' }]) await assert.rejects(service.save(command(patch), buyer));
  material.reviewStatus = 'pending'; await assert.rejects(service.save(command(), buyer), /已审核/);
});
test('新关系不能直接合格；审核必须使用本人上传或原关系留存的真实证据', async () => {
  const { service } = fixture(); await assert.rejects(service.save(command({ status: 'approved' }), reviewer), /先登记/);
  await assert.rejects(service.save(command(), reviewer), /本人上传/);
  await service.save(command(), buyer);
  await assert.rejects(service.save(command({ version: 1, status: 'approved', evidenceFileIds: [] }), reviewer), /必须提供/);
  await assert.rejects(service.save(command({ version: 1, status: 'approved', evidenceFileIds: ['made-up'] }), reviewer), /有效证据/);
  await service.save(command({ version: 1, status: 'approved' }), reviewer);
  assert.equal((await service.list(reviewer)).relations[0].evidence[0].name, '供应商审核.pdf');
});
test('过期、未来生效、物料撤回审核及供应商停用都不显示可供货', async () => {
  const { service, suppliers, material } = fixture(); await service.save(command(), buyer); await service.save(command({ version: 1, status: 'approved' }), reviewer);
  const row = (await service.list(reviewer)).relations[0];
  assert.equal(effectiveQualification(row, true, true, '2026-08-31'), 'scheduled');
  assert.equal(effectiveQualification({ ...row, effectiveUntil: '2026-09-02' }, true, true, '2026-09-03'), 'expired');
  suppliers[0].enabled = false; assert.equal((await service.list(reviewer)).relations[0].effectiveStatus, 'supplier_disabled');
  await assert.rejects(service.save(command({ version: 2, status: 'approved' }), reviewer), /停用/);
  suppliers[0].enabled = true; material.reviewStatus = 'pending'; assert.equal((await service.list(reviewer)).relations[0].effectiveStatus, 'material_unapproved');
});
test('撤销保留全部历史，即使物料停用或旧证据删除仍可终止；重新供货需先待审', async () => {
  const { service, material, assets } = fixture(); await service.save(command(), buyer); await service.save(command({ version: 1, status: 'approved' }), reviewer);
  material.reviewStatus = 'pending'; assets[0].deletedAt = '2026-09-20';
  await service.save(command({ version: 2, status: 'withdrawn', reason: '暂停采购，保留审核依据' }), reviewer);
  const row = (await service.list(reviewer)).relations[0]; assert.equal(row.effectiveStatus, 'withdrawn'); assert.equal(row.history.length, 2); assert.equal(row.history[1].status, 'approved'); assert.equal(row.history[0].evidence[0].fileId, 'evidence');
  material.reviewStatus = 'approved'; await assert.rejects(service.save(command({ version: 3, status: 'approved' }), reviewer), /重新登记/);
  await service.save(command({ version: 3, status: 'pending', evidenceFileIds: [] }), reviewer); assert.equal((await service.list(reviewer)).relations[0].history.length, 3);
});
test('幂等重试不产生第二次版本，过期版本和复用提交号不能覆盖', async () => {
  const { service, records } = fixture(); const input = command(); const first = await service.save(input, buyer); assert.deepEqual(await service.save(input, buyer), first);
  assert.equal((await service.list(buyer)).relations[0].version, 1);
  await assert.rejects(service.save({ ...input, reason: '不同内容' }, buyer), /提交编号/);
  await assert.rejects(service.save(command(), buyer), /已更新/);
  assert.equal([...records.keys()].filter(key => key.startsWith(`${QUALIFICATION_PREFIX}relation:`)).length, 1);
});
test('证据预览只能打开本关系已留存的文件，删除后保留记录而禁止生成链接', async () => {
  const { service, assets } = fixture(); const { id } = await service.save(command(), buyer);
  assert.match((await service.attachment(id, 'evidence', reviewer)).url, /signed/);
  await assert.rejects(service.attachment(id, 'someone-else', reviewer), /不属于/);
  assets[0].deletedAt = '2026-09-20'; await assert.rejects(service.attachment(id, 'evidence', reviewer), /删除/);
  assert.equal((await service.list(reviewer)).relations[0].evidence.length, 1);
});
