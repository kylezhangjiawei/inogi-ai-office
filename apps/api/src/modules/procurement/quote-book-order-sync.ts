import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma, type ProcSupplier } from '@prisma/client';
import type { TplusPurchaseOrderLine } from './tplus-sync.service';

export const identity = (value?: string | null) => (value || '').normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase();

/** ERP编码优先；辅助信息只能佐证名称，不能单凭同一电话/地址合并法人。 */
export function matchSupplier(rows: ProcSupplier[], incoming: { code?: string; name: string; shortName?: string; phone?: string; email?: string; address?: string }) {
 const code = incoming.code?.trim();
 const coded = code ? rows.filter(row => row.tpCode === code) : [];
 if (coded.length === 1) return coded[0];
 const candidates = rows.filter(row => (!code || !row.tpCode) && (
   identity(row.name) === identity(incoming.name) ||
   (!!row.shortName && identity(row.shortName) === identity(incoming.name) &&
     (['phone','email','address'] as const).filter(key => incoming[key] && row[key] && identity(incoming[key]) === identity(row[key])).length >= 2)
 ));
 if (candidates.length > 1) throw new BadRequestException(`供应商 ${incoming.name} 存在多个本地档案或ERP匹配档案，请核对ERP编码`);
 return candidates[0];
}

export async function syncOrderQuote(db: Prisma.TransactionClient, line: TplusPurchaseOrderLine) {
 const name = line.supplierName?.normalize('NFKC').trim();
 if (!name) throw new BadRequestException('订单缺少供应商名称');
 await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'quote-supplier:' + identity(name)}))`;
 const suppliers = await db.procSupplier.findMany();
 let supplier = matchSupplier(suppliers, { code: line.supplierCode, name, phone: line.supplierPhone, address: line.supplierAddress });
 const supplierCreated = !supplier;
 if (!supplier) supplier = await db.procSupplier.create({ data: { name, tpCode: line.supplierCode || null, source: 'tplus-order', phone: line.supplierPhone || null, address: line.supplierAddress || null, syncedAt: new Date() } });
 else if ((!supplier.tpCode && line.supplierCode) || (!supplier.phone && line.supplierPhone) || (!supplier.address && line.supplierAddress)) {
   supplier = await db.procSupplier.update({where:{id:supplier.id},data:{
     ...(!supplier.tpCode && line.supplierCode ? {tpCode:line.supplierCode}:{}),
     ...(!supplier.phone && line.supplierPhone ? {phone:line.supplierPhone}:{}),
     ...(!supplier.address && line.supplierAddress ? {address:line.supplierAddress}:{}) }});
 }
 const code = line.inventoryCode?.trim();
 const materialName = line.inventoryName?.trim();
 if (!code && !materialName) throw new BadRequestException('订单缺少存货编码与名称');
 await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'quote-material:' + (code || identity(materialName) + ':' + identity(line.spec))}))`;
 // 编码锚定；无编码时名称、规格、单位同时匹配，歧义绝不取第一条。
 const materials = await db.procMaterial.findMany({ where: code ? { OR: [{tpInventoryCode:code},{erpCode:code},{tpInventoryCode:null}] } : undefined });
 let candidates = code ? materials.filter(m=>m.tpInventoryCode===code || m.erpCode===code && !m.tpInventoryCode) : [];
 if (!candidates.length && materialName) candidates = materials.filter(m=>!m.tpInventoryCode && (!code || !m.erpCode || m.erpCode===code) && identity(m.name)===identity(materialName) && identity(m.spec)===identity(line.spec) && identity(m.unit)===identity(line.unit));
 if (candidates.length>1) throw new BadRequestException(`物料 ${materialName || code} 匹配存在歧义，请核对编码、规格和单位`);
 let material = candidates[0];
 const materialCreated = !material;
 if (!material) material = await db.procMaterial.create({data:{name:materialName || code!,spec:line.spec||'',unit:line.unit||'',category:'未分类',tpInventoryCode:code||null,erpCode:code||'',reviewSource:'tplus-order',remark:'由ERP采购订单补录，待核对物料档案'}});
 else {
   const patch = {
    ...(!material.tpInventoryCode && code ? {tpInventoryCode:code}:{}), ...(!material.erpCode && code ? {erpCode:code}:{}),
    ...(!material.spec && line.spec ? {spec:line.spec}:{}), ...(!material.unit && line.unit ? {unit:line.unit}:{}),
   };
   const claimed = Object.keys(patch).length ? await db.procMaterial.updateMany({where:{id:material.id,
     tpInventoryCode:material.tpInventoryCode,erpCode:material.erpCode,updatedAt:material.updatedAt},data:patch}) : {count:1};
   if (claimed.count !== 1) throw new ConflictException('物料档案已被其他操作更新，请重新同步后匹配');
   material = {...material,...patch};
 }
 const quotes = await db.procSupplierQuote.findMany({where:{materialId:material.id}});
 const linked = quotes.filter(q=>q.materialId===material.id && q.supplierId===supplier.id);
 const legacy = quotes.filter(q=>q.materialId===material.id && !q.supplierId && identity(q.supplierName)===identity(supplier.name));
 const knownSuppliers = suppliers.some(s=>s.id===supplier.id) ? suppliers : [...suppliers, supplier];
 // 名称只能在档案唯一时关联旧报价；同名异码的旧自由文本记录原样保留。
 const matching = linked.length ? linked : knownSuppliers.filter(s=>identity(s.name)===identity(supplier.name)).length===1 ? legacy : [];
 if (matching.length>1) throw new BadRequestException('该供应商物料存在多个报价档案，请核对');
 const current=matching[0];
 if (current && !current.supplierId) {
   const claimed = await db.procSupplierQuote.updateMany({where:{id:current.id,supplierId:null,updatedAt:current.updatedAt},data:{supplierId:supplier.id}});
   if (claimed.count !== 1) throw new ConflictException('旧报价关联已改变，请重新同步');
 }
 const date = line.orderDate ? new Date(line.orderDate) : null;
 const quoteDate = date && Number.isFinite(date.getTime()) ? date : null;
 const sourceRef=JSON.stringify([line.orderNo,line.lineNo||'']);
 if (current && (current.source !== 'tplus-order' || (current.quoteDate && (!quoteDate || current.quoteDate>quoteDate)) ||
   (current.quoteDate && quoteDate && current.quoteDate.getTime()===quoteDate.getTime() && (current.sourceRef||'')>sourceRef))) {
   return {materialId:material.id,supplierCreated,materialCreated,quoteCreated:false,quoteUpdated:false};
 }
 // 不把采购数量当作MOQ；币种/含税口径缺失时仅补物料关系，留空报价。
 const priced = !!line.currency && line.taxIncluded !== undefined && Number.isFinite(line.unitPrice) && line.unitPrice!>0;
 if (!priced && current && Array.isArray(current.tiers) && current.tiers.length) {
   return {materialId:material.id,supplierCreated,materialCreated,quoteCreated:false,quoteUpdated:false};
 }
 const data={supplierId:supplier.id,supplierName:supplier.name,source:'tplus-order',sourceRef,
   currency:line.currency||'CNY',taxIncluded:line.taxIncluded??true,quoteDate,
   tiers:priced?[{minQty:0,unitPrice:line.unitPrice!}]:[],
   note:`ERP采购订单 ${line.orderNo} 第${line.lineNo||'—'}行；${priced?'历史订单参考价，非供应商当前承诺价':'待补报价：缺少有效价格、币种或含税口径'}`};
 const updated = current ? await db.procSupplierQuote.updateMany({where:{id:current.id,source:'tplus-order',
   supplierId:supplier.id,updatedAt:current.supplierId ? current.updatedAt : undefined},data}) : null;
 if (!current) await db.procSupplierQuote.create({data:{...data,materialId:material.id}});
 return {materialId:material.id,supplierCreated,materialCreated,quoteCreated:!current,quoteUpdated:updated?.count===1};
}
