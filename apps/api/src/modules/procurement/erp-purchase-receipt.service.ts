import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TplusSyncService } from './tplus-sync.service';
import { warehouseRecordKey, type WarehouseRecord } from './warehouse-records.service';
import { executionDay, executionText, executionToday } from './production-execution.model';
import { readPurchaseFulfillment } from './purchase-fulfillment.service';
import { objectOf } from './erp-purchase-order';
import type { ProcActor } from './procurement.types';

export const ERP_RECEIPT_PERMISSION = 'warehouse:write-erp';
const prefix = 'erp-purchase-receipt:v1:';
export interface ReceiptWrite { requestId: string; recordId: string; expectedVersion: number; warehouseCode: string; date: string; reason: string }
interface Journal {
  input: ReceiptWrite; fingerprint: string; actorId: string; actorName: string; quantity: number; sourceOrderNo: string;
  externalCode: string; state: 'sending' | 'uncertain' | 'rejected' | 'verified'; payload: { dto: Record<string, any> };
  result?: { voucherId: string; voucherCode: string; approvalCode: string; approvalStatus: string; auditor: string; auditedDate: string; checkedAt: string };
  error?: string;
}
export function receiptJournalView(j: Journal) {
  return { requestId: j.input.requestId, recordId: j.input.recordId, state: j.state, quantity: j.quantity, date: j.input.date,
    warehouseCode: j.input.warehouseCode, actorName: j.actorName, reason: j.input.reason, result: j.result, error: j.error };
}
export function receiptMatches(j: Pick<Journal, 'externalCode' | 'payload' | 'sourceOrderNo'>, raw: Record<string, any>) {
  const d = j.payload.dto, lines = raw.RDRecordDetails;
  if (String(raw.ExternalCode) !== j.externalCode || !raw.ID || !raw.Code || !Array.isArray(lines) || lines.length !== 1
    || String(raw.VoucherDate).slice(0, 10) !== d.VoucherDate || raw.Partner?.Code !== d.Partner.Code || raw.Warehouse?.Code !== d.Warehouse.Code) return false;
  const line = lines[0], expected = d.RDRecordDetails[0];
  return line.Inventory?.Code === expected.Inventory.Code && line.Unit?.Name === expected.Unit.Name
    && String(line.PurchaseOrderCode || line.SourceVoucherCode || raw.PurchaseOrderCode || '') === j.sourceOrderNo
    && new Prisma.Decimal(String(line.Quantity)).equals(expected.Quantity) && String(line.Batch ?? '') === String(expected.Batch ?? '')
    && ['OrigPrice', 'OrigTaxPrice', 'TaxRate'].every(key => expected[key] == null || line[key] != null && new Prisma.Decimal(String(line[key])).minus(expected[key]).abs().lte('0.0001'));
}

@Injectable()
export class ErpPurchaseReceiptService {
  constructor(private readonly prisma: PrismaService, private readonly sync: TplusSyncService) {}
  private access(actor: ProcActor, write = false) {
    if (!actor.id || !actor.permissions.includes('*') && (!actor.permissions.includes('page:warehouse-flow') || write && !actor.permissions.includes(ERP_RECEIPT_PERMISSION))) throw new ForbiddenException('需要仓库页面及创建 ERP 采购入库单权限');
  }
  private async journals(recordId?: string) {
    const rows = await this.prisma.runtimeState.findMany({ where: { key: { startsWith: prefix + (recordId ? recordId + ':' : '') } }, orderBy: { updatedAt: 'desc' } });
    return rows.map(row => JSON.parse(row.value) as Journal);
  }
  async list(actor: ProcActor) { this.access(actor); return (await this.journals()).map(receiptJournalView); }
  async warehouses(actor: ProcActor) { this.access(actor, true); return this.sync.readErpWarehouses(); }
  private key(j: Journal) { return prefix + j.input.recordId + ':' + j.input.requestId; }
  private async save(j: Journal) {
    const key = this.key(j), value = JSON.stringify(j);
    await this.prisma.runtimeState.upsert({ where: { key }, create: { key, value }, update: { value } });
  }
  private async verify(j: Journal, actor: ProcActor) {
    try {
      const raw = await this.sync.readErpPurchaseReceipt({ externalCode: j.externalCode });
      if (!receiptMatches(j, raw)) throw new ConflictException('ERP 入库单与提交的物料、数量、仓库或价格不一致');
      const first = j.state !== 'verified';
      const result = { voucherId: String(raw.ID), voucherCode: String(raw.Code), approvalCode: String(objectOf(raw.VoucherState).Code ?? ''),
        approvalStatus: String(objectOf(raw.VoucherState).Name || '状态待核对'), auditor: String(raw.Auditor ?? ''), auditedDate: String(raw.AuditedDate ?? ''), checkedAt: new Date().toISOString() };
      const next: Journal = { ...j, result, state: 'verified', error: undefined };
      await this.prisma.$transaction(async tx => {
        await tx.runtimeState.update({ where: { key: this.key(j) }, data: { value: JSON.stringify(next) } });
        if (first) await tx.auditLog.create({ data: { module: 'procurement', source: 'web', action: 'purchase-receipt.erp-create', resource: 'warehouse-record', resourceId: j.input.recordId,
          userId: actor.id, actorName: actor.name, summary: 'ERP 采购入库单创建已回读核对，审核仍由 ERP 处理', meta: { requestId: j.input.requestId, createdBy: j.actorId, quantity: j.quantity, result } } });
      });
      Object.assign(j, next);
      return receiptJournalView(j);
    } catch (error) {
      // A previously verified voucher stays reserved even if later modified/deleted in ERP.
      if (j.state !== 'verified') j.state = 'uncertain';
      j.error = (error as Error).message; await this.save(j);
      throw new ConflictException(`ERP 结果待核对：${j.error}。请刷新 ERP 状态恢复，系统不会再次发送创建请求。`);
    }
  }
  async refresh(recordId: string, actor: ProcActor) {
    this.access(actor);
    recordId = executionText(recordId, '入库记录编号', 128);
    return this.prisma.$transaction(async lock => {
      await lock.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${prefix + recordId}))`;
      const journals = await this.journals(recordId);
      for (const j of journals) if (j.state !== 'rejected') await this.verify(j, actor);
      return (await this.journals(recordId)).map(receiptJournalView);
    }, { timeout: 150_000, maxWait: 10_000 });
  }
  async create(input: ReceiptWrite, actor: ProcActor) {
    this.access(actor, true);
    if (!input || !/^[A-Za-z0-9_-]{16,128}$/.test(input.requestId) || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) throw new BadRequestException('入库提交标识或版本无效');
    input = { requestId: input.requestId, recordId: executionText(input.recordId, '入库记录编号', 128), expectedVersion: input.expectedVersion,
      warehouseCode: executionText(input.warehouseCode, 'ERP 仓库', 100), date: executionDay(input.date, '入库日期'), reason: executionText(input.reason, '入库依据', 1000) };
    if (input.date > executionToday()) throw new BadRequestException('入库日期不能晚于今天');
    const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    return this.prisma.$transaction(async lock => {
      // All operators share one record lock; changing user/request ID cannot duplicate its quantity.
      await lock.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${prefix + input.recordId}))`;
      const journals = await this.journals(input.recordId);
      let j = journals.find(row => row.input.requestId === input.requestId);
      if (j) {
        if (j.fingerprint !== fingerprint) throw new ConflictException('同一提交标识不能更换内容');
        if (j.state === 'rejected') throw new BadRequestException(j.error || 'ERP 已拒绝，请修改后重新提交');
        if (j.state === 'verified') return receiptJournalView(j);
        return this.verify(j, actor);
      }
      if (journals.some(row => row.state !== 'rejected' && (row.state !== 'verified' || row.error))) throw new ConflictException('该批次有待核对的 ERP 创建请求，请先刷新 ERP 状态');
      const stored = await this.prisma.runtimeState.findUnique({ where: { key: warehouseRecordKey(input.recordId) } });
      if (!stored) throw new NotFoundException('入库记录不存在');
      const record = JSON.parse(stored.value) as WarehouseRecord;
      if (record.kind !== 'receipt' || record.status !== 'confirmed' || record.version !== input.expectedVersion || record.reconciliation) throw new ConflictException('仅可同步版本一致、已交接且未人工关联 ERP 凭证的收货入库记录');
      const receiptQuery = { where: { id: record.sourceId }, include: { inspections: { orderBy: { version: 'desc' as const } }, line: { include: { receipts: { include: { inspections: { orderBy: { version: 'desc' as const } } } } } } } };
      let receipt = await this.prisma.procPurchaseReceipt.findUnique(receiptQuery);
      if (!receipt?.inspections.length) throw new ConflictException('检验来源缺失');
      await lock.$queryRaw`SELECT id FROM "ProcPurchaseOrderMirror" WHERE id = ${receipt.lineId} FOR UPDATE`;
      const current = await this.prisma.runtimeState.findUnique({ where: { key: warehouseRecordKey(input.recordId) } });
      if (!current || current.value !== stored.value) throw new ConflictException('检验或入库版本已变化，请重新读取');
      receipt = await this.prisma.procPurchaseReceipt.findUnique(receiptQuery);
      if (!receipt?.inspections.length) throw new ConflictException('检验来源缺失');
      const { summary } = await readPurchaseFulfillment(this.prisma, receipt.line);
      const net = summary.receipts.find(row => row.id === receipt.id);
      if (!net || summary.issues.length || record.code !== receipt.sourceInventoryCode || record.unit !== receipt.sourceUnit || net.qualifiedQty !== record.qualifiedQty) throw new ConflictException('履约、检验或入库来源发生变化，请先核对');
      const exported = journals.filter(row => row.state === 'verified').reduce((sum, row) => sum.plus(row.quantity), new Prisma.Decimal(0));
      const quantity = new Prisma.Decimal(net.qualifiedQty).minus(exported);
      if (quantity.lte(0)) throw new ConflictException('该批次没有尚未同步的合格数量');
      const warehouses = await this.sync.readErpWarehouses();
      if (!warehouses.some(row => row.code === input.warehouseCode && row.name === record.warehouse)) throw new BadRequestException('ERP 仓库与本地实际接收仓库不一致，请先核对仓库名称');
      const order: Record<string, any> = await this.sync.readErpPurchaseOrder({ voucherCode: receipt.sourceOrderNo });
      const details = order.PurchaseOrderDetails as Record<string, any>[];
      const matches = details.filter((line, index) => String(line.RowNo ?? index + 1) === receipt.sourceLineNo);
      const line = matches.length === 1 ? matches[0] : undefined;
      if (String(order.ID) !== receipt.sourceOrderId || String(order.Code) !== receipt.sourceOrderNo || !line?.ID || line.Inventory?.Code !== record.code || line.Unit?.Name !== record.unit
        || order.Partner?.Name !== receipt.sourceSupplierName || !order.Partner?.Code || !new Prisma.Decimal(String(line.Quantity)).equals(receipt.sourceOrderedQty)
        || quantity.gt(new Prisma.Decimal(String(line.Quantity)).minus(String(line.CountQuantity ?? 0))) || ['取消', '作废', '关闭'].some(word => String(objectOf(order.VoucherState).Name).includes(word)) || order.ClosedBy || order.ClosedTime || ['true', '1'].includes(String(line.IsClose).toLowerCase())) throw new ConflictException('ERP 采购订单身份、单位、供应商或剩余数量发生变化');
      const externalCode = 'OFFICE-RI-' + createHash('sha256').update(input.recordId + ':' + input.requestId).digest('hex').slice(0, 40);
      const item: Record<string, any> = { Inventory: { Code: record.code }, Unit: { Name: record.unit }, Quantity: quantity.toNumber(), idsourcevouchertype: 27, sourceVoucherDetailId: line.ID,
        ...(record.stockBatchNo ? { Batch: record.stockBatchNo } : {}) };
      const priceField = line.OrigTaxPrice != null ? 'OrigTaxPrice' : 'OrigPrice';
      if (line[priceField] == null || !new Prisma.Decimal(String(line[priceField])).isFinite() || new Prisma.Decimal(String(line[priceField])).lt(0)) throw new ConflictException('ERP 订单缺少可核对的采购单价，请先在 ERP 补全');
      item[priceField] = String(line[priceField]);
      if (line.TaxRate != null) item.TaxRate = new Prisma.Decimal(String(line.TaxRate)).times(100).toNumber();
      const dto = { ExternalCode: externalCode, VoucherDate: input.date, BusiType: { Code: '01' }, Partner: { Code: order.Partner.Code }, Warehouse: { Code: input.warehouseCode }, Memo: input.reason,
        ...(objectOf(order.Currency).Code ? { Currency: { Code: objectOf(order.Currency).Code } } : {}), ...(order.ExchangeRate != null ? { ExchangeRate: order.ExchangeRate } : {}), RDRecordDetails: [item] };
      j = { input, fingerprint, actorId: actor.id, actorName: actor.name, externalCode, quantity: quantity.toNumber(), sourceOrderNo: receipt.sourceOrderNo, state: 'sending', payload: { dto } };
      // Commit the intent independently BEFORE the only allowed external write (Create).
      await this.save(j);
      try {
        const response = objectOf(await this.sync.createErpPurchaseReceipt(j.payload));
        if (response.Result === false || objectOf(response.data).Result === false) throw Object.assign(new Error('ERP 返回创建失败'), { erpRejected: true });
      }
      catch (error) {
        const failure = error as { erpRejected?: boolean; erpNotSent?: boolean };
        j.state = failure.erpRejected || failure.erpNotSent ? 'rejected' : 'uncertain'; j.error = (error as Error).message; await this.save(j);
        if (j.state === 'rejected') throw new BadRequestException(j.error);
      }
      return this.verify(j, actor);
    }, { timeout: 150_000, maxWait: 10_000 });
  }
}
