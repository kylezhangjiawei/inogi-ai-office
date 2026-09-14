import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma, type ProcPurchaseReceipt } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { ProcActor } from './procurement.types';
import type { CreatePurchaseInspectionDto, CreatePurchaseReceiptDto } from './dto/purchase-receipts.dto';
import { readPurchaseFulfillment } from './purchase-fulfillment.service';
import { calculatePurchaseFulfillment } from './purchase-fulfillment.model';

type Db = Prisma.TransactionClient;
const lineSelect = {
  id: true, tpOrderId: true, tpOrderNo: true, tpLineNo: true, inventoryCode: true,
  inventoryName: true, spec: true, unit: true, supplierName: true, orderedQty: true,
  receivedQty: true, updatedAt: true, status: true, approvalStatus: true,
} satisfies Prisma.ProcPurchaseOrderMirrorSelect;
type Line = Prisma.ProcPurchaseOrderMirrorGetPayload<{ select: typeof lineSelect }>;
const receiptInclude = { inspections: { orderBy: { version: 'desc' as const } } } satisfies Prisma.ProcPurchaseReceiptInclude;
type Receipt = Prisma.ProcPurchaseReceiptGetPayload<{ include: typeof receiptInclude }>;
const MAX_QTY = new Prisma.Decimal('99999999999.999');
const ZERO = () => new Prisma.Decimal(0);
const day = (value: Date) => value.toISOString().slice(0, 10);
const permission = (actor: ProcActor, action?: string) => actor.permissions.includes('*')
  || (actor.permissions.includes('page:purchase-order-detail') && (!action || actor.permissions.includes(action)));
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const conflict = () => new ConflictException('订单或检验记录已更新，请重新载入后再保存');

function text(value: unknown, name: string, limit: number, required = true) {
  if (typeof value !== 'string' || value.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    throw new BadRequestException(`${name}格式无效或内容过长`);
  }
  const result = value.trim();
  if (required && !result) throw new BadRequestException(`请填写${name}`);
  return result;
}

export function receiptQuantity(value: unknown, name: string, positive = false) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new BadRequestException(`${name}须为有效数字`);
  const decimal = new Prisma.Decimal(value);
  if (decimal.decimalPlaces() > 3 || decimal.lessThan(0) || decimal.greaterThan(MAX_QTY) || (positive && decimal.isZero())) {
    throw new BadRequestException(`${name}须为${positive ? '大于零的' : '非负'}数量，最多保留 3 位小数`);
  }
  return decimal;
}

export function receiptDay(value: unknown, name: string, now = new Date()) {
  if (typeof value !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException(`${name}格式无效`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || day(parsed) !== value) throw new BadRequestException(`${name}不存在`);
  const todayInChina = new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (value > todayInChina) throw new BadRequestException(`${name}不能晚于今天`);
  return parsed;
}

function mutation(input: { requestId: string; expectedSourceUpdatedAt: string }) {
  if (!input || typeof input !== 'object') throw new BadRequestException('请填写登记信息');
  if (typeof input.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(input.requestId)) throw new BadRequestException('提交标识无效，请重新打开表单');
  const timestamp = input.expectedSourceUpdatedAt;
  if (typeof timestamp !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(timestamp)
    || !Number.isFinite(Date.parse(timestamp)) || new Date(timestamp).toISOString() !== timestamp) {
    throw new BadRequestException('订单来源版本无效，请重新载入');
  }
}

function sourceChanged(receipt: ProcPurchaseReceipt, line: Line) {
  return receipt.sourceOrderId !== line.tpOrderId || receipt.sourceOrderNo !== line.tpOrderNo
    || receipt.sourceLineNo !== line.tpLineNo || receipt.sourceInventoryCode !== line.inventoryCode
    || receipt.sourceUnit !== line.unit || receipt.sourceInventoryName !== line.inventoryName
    || receipt.sourceSpec !== line.spec || receipt.sourceSupplierName !== line.supplierName;
}

function sourceIssue(line: Line, receipts: ProcPurchaseReceipt[], localNetQty?: number) {
  if (new Set(receipts.map((receipt) => receipt.sourceUnit)).size > 1) {
    return '历史收货记录包含不同单位，不能合并数量，请先核对原始记录';
  }
  if (![line.tpOrderId, line.tpOrderNo, line.tpLineNo, line.inventoryCode, line.unit]
    .every((value) => typeof value === 'string' && value.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(value))) {
    return '订单行的来源标识、物料编码或单位不完整，请核对订单后再登记';
  }
  if (!line.orderedQty.isFinite() || line.orderedQty.lessThanOrEqualTo(0) || line.orderedQty.greaterThan(MAX_QTY)) {
    return '订单数量无效，请核对订单后再登记';
  }
  if (receipts.some((receipt) => sourceChanged(receipt, line))) {
    return '订单行的来源、物料、规格、单位或供应商与历史收货记录不一致，请先核对；历史记录已保留';
  }
  if ((localNetQty === undefined ? receipts.reduce((sum, receipt) => sum.plus(receipt.receivedQty), ZERO()) : new Prisma.Decimal(localNetQty)).greaterThan(line.orderedQty)) {
    return '订单数量小于已登记实收合计，请先核对订单；历史记录已保留';
  }
  return null;
}

@Injectable()
export class PurchaseReceiptsService {
  constructor(private readonly prisma: PrismaService) {}

  private assertPermission(actor: ProcActor, action?: string) {
    if (!permission(actor, action)) throw new ForbiddenException(action ? '没有登记该订单行收货或检验的权限' : '没有查看订单行收货检验记录的权限');
  }

  private async line(db: Db, lineId: string) {
    if (typeof lineId !== 'string' || !lineId || lineId.length > 128 || /[\u0000-\u001f\u007f]/.test(lineId)) throw new NotFoundException('采购订单行不存在');
    const line = await db.procPurchaseOrderMirror.findUnique({ where: { id: lineId }, select: lineSelect });
    if (!line) throw new NotFoundException('采购订单行不存在');
    return line;
  }

  private receipts(db: Db, lineId: string) {
    return db.procPurchaseReceipt.findMany({ where: { lineId }, include: receiptInclude, orderBy: [{ receivedDate: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }] });
  }

  private view(line: Line, receipts: Receipt[], actor: ProcActor, net?: Awaited<ReturnType<typeof readPurchaseFulfillment>>['summary']) {
    const issue = sourceIssue(line, receipts, net?.localNetReceivedQty);
    const totals = { receivedQty: ZERO(), qualifiedQty: ZERO(), defectiveQty: ZERO(), pendingJudgmentQty: ZERO(), pendingQty: ZERO() };
    const items = receipts.map((receipt) => {
      const latest = receipt.inspections[0];
      const qualified = latest?.qualifiedQty ?? ZERO(), defective = latest?.defectiveQty ?? ZERO(), judgment = latest?.pendingJudgmentQty ?? ZERO();
      const pending = receipt.receivedQty.minus(qualified).minus(defective).minus(judgment);
      totals.receivedQty = totals.receivedQty.plus(receipt.receivedQty);
      totals.qualifiedQty = totals.qualifiedQty.plus(qualified);
      totals.defectiveQty = totals.defectiveQty.plus(defective);
      totals.pendingJudgmentQty = totals.pendingJudgmentQty.plus(judgment);
      totals.pendingQty = totals.pendingQty.plus(pending);
      return {
        id: receipt.id, deliveryNo: receipt.deliveryNo, receivedDate: day(receipt.receivedDate), receivedQty: receipt.receivedQty.toNumber(),
        note: receipt.note, createdByName: receipt.createdByName, createdAt: receipt.createdAt.toISOString(), sourceChanged: sourceChanged(receipt, line),
        version: receipt.version, qualifiedQty: qualified.toNumber(), defectiveQty: defective.toNumber(), pendingJudgmentQty: judgment.toNumber(), pendingQty: pending.toNumber(),
        source: {
          orderId: receipt.sourceOrderId, orderNo: receipt.sourceOrderNo, lineNo: receipt.sourceLineNo,
          inventoryCode: receipt.sourceInventoryCode, inventoryName: receipt.sourceInventoryName,
          spec: receipt.sourceSpec, unit: receipt.sourceUnit, supplierName: receipt.sourceSupplierName,
          orderedQty: receipt.sourceOrderedQty.toNumber(), updatedAt: receipt.sourceUpdatedAt.toISOString(),
        },
        inspections: receipt.inspections.map((inspection) => ({
          id: inspection.id, version: inspection.version, inspectionDate: day(inspection.inspectionDate),
          qualifiedQty: inspection.qualifiedQty.toNumber(), defectiveQty: inspection.defectiveQty.toNumber(),
          pendingJudgmentQty: inspection.pendingJudgmentQty.toNumber(),
          pendingQty: receipt.receivedQty.minus(inspection.qualifiedQty).minus(inspection.defectiveQty).minus(inspection.pendingJudgmentQty).toNumber(),
          basis: inspection.basis, note: inspection.note, createdByName: inspection.createdByName, createdAt: inspection.createdAt.toISOString(),
        })),
      };
    });
    return {
      line: {
        id: line.id, orderNo: line.tpOrderNo, lineNo: line.tpLineNo, tpOrderId: line.tpOrderId,
        inventoryCode: line.inventoryCode, inventoryName: line.inventoryName, spec: line.spec, unit: line.unit,
        supplierName: line.supplierName, orderedQty: line.orderedQty.toNumber(), erpReceivedQty: line.receivedQty.toNumber(),
        updatedAt: line.updatedAt.toISOString(), status: line.status, approvalStatus: line.approvalStatus,
      },
      canReceive: !issue && (!net || net.effectiveOrderedQty !== null) && permission(actor, 'proc-purchase-order:receive'),
      canInspect: !issue && permission(actor, 'proc-purchase-order:inspect'),
      sourceIssue: issue,
      summaryUnit: receipts[0]?.sourceUnit ?? line.unit,
      summary: { receivedQty: totals.receivedQty.toNumber(), qualifiedQty: totals.qualifiedQty.toNumber(), defectiveQty: totals.defectiveQty.toNumber(), pendingJudgmentQty: totals.pendingJudgmentQty.toNumber(), pendingQty: totals.pendingQty.toNumber() },
      receipts: items,
      fulfillment: net,
    };
  }

  private async ledger(db: Db, line: Line, actor: ProcActor) {
    const receipts = await this.receipts(db, line.id);
    const { summary } = await readPurchaseFulfillment(db, { ...line, receipts });
    return this.view(line, receipts, actor, summary);
  }

  async list(lineId: string, actor: ProcActor) {
    this.assertPermission(actor);
    return this.transaction(async (db) => this.ledger(db, await this.line(db, lineId), actor), false);
  }

  async receive(lineId: string, input: CreatePurchaseReceiptDto, actor: ProcActor) {
    this.assertPermission(actor, 'proc-purchase-order:receive');
    mutation(input);
    const deliveryNo = text(input.deliveryNo, '送货单号', 120);
    if (/[\r\n\t]/.test(deliveryNo)) throw new BadRequestException('送货单号不能包含换行或制表符');
    const receivedDate = receiptDay(input.receivedDate, '收货日期');
    const receivedQty = receiptQuantity(input.receivedQty, '实收数量', true);
    const note = text(input.note, '收货备注', 2000, false);
    const hash = fingerprint([lineId, input.expectedSourceUpdatedAt, deliveryNo, day(receivedDate), receivedQty.toString(), note]);
    return this.transaction(async (db) => {
      await this.lock(db, lineId);
      const line = await this.line(db, lineId);
      const existing = await db.procPurchaseReceipt.findUnique({ where: { requestId: input.requestId } });
      if (existing) {
        if (existing.lineId !== lineId || existing.createdById !== actor.id || existing.requestFingerprint !== hash) throw new ConflictException('提交标识已使用，请重新打开表单后登记');
        return this.ledger(db, line, actor);
      }
      if (line.updatedAt.toISOString() !== input.expectedSourceUpdatedAt) throw conflict();
      const receipts = await this.receipts(db, lineId);
      const { summary } = await readPurchaseFulfillment(db, { ...line, receipts });
      const issue = sourceIssue(line, receipts, summary.localNetReceivedQty);
      if (issue) throw new ConflictException(issue);
      if (receipts.some((receipt) => receipt.deliveryNo === deliveryNo)) throw new ConflictException('该订单行已有此送货单的收货记录，请核对是否重复登记');
      const total = new Prisma.Decimal(summary.localNetReceivedQty).plus(receivedQty);
      if (summary.effectiveOrderedQty === null) throw new ConflictException('履约调整尚未核对，请先确认 ERP 覆盖后再登记收货');
      if (total.greaterThan(summary.effectiveOrderedQty)) throw new BadRequestException('扣除已批准退货或冲销后的本地实收合计不能超过净订购数量');
      const saved = await db.procPurchaseReceipt.create({ data: {
        lineId, requestId: input.requestId, requestFingerprint: hash, deliveryNo, receivedDate, receivedQty, note,
        sourceOrderId: line.tpOrderId!, sourceOrderNo: line.tpOrderNo, sourceLineNo: line.tpLineNo,
        sourceInventoryCode: line.inventoryCode, sourceInventoryName: line.inventoryName, sourceSpec: line.spec,
        sourceUnit: line.unit, sourceSupplierName: line.supplierName, sourceOrderedQty: line.orderedQty, sourceUpdatedAt: line.updatedAt,
        createdById: actor.id, createdByName: actor.name,
      } });
      await db.auditLog.create({ data: {
        module: 'procurement', source: 'web', action: 'purchase-order.receipt-created', resource: 'proc-purchase-receipt', resourceId: saved.id,
        resourceName: `${line.tpOrderNo} · ${line.tpLineNo} · ${deliveryNo}`, userId: actor.id, actorName: actor.name,
        summary: `登记采购订单 ${line.tpOrderNo} 第 ${line.tpLineNo} 行实收 ${receivedQty.toString()} ${line.unit}`,
        meta: { lineId, orderNo: line.tpOrderNo, lineNo: line.tpLineNo, deliveryNo, receivedDate: day(receivedDate), receivedQty: receivedQty.toString(), note },
      } });
      return this.ledger(db, line, actor);
    });
  }

  async inspect(lineId: string, receiptId: string, input: CreatePurchaseInspectionDto, actor: ProcActor) {
    this.assertPermission(actor, 'proc-purchase-order:inspect');
    mutation(input);
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0 || input.expectedVersion > 2147483646) throw new BadRequestException('检验版本无效，请重新载入');
    const inspectionDate = receiptDay(input.inspectionDate, '检验日期');
    const qualifiedQty = receiptQuantity(input.qualifiedQty, '合格数量');
    const defectiveQty = receiptQuantity(input.defectiveQty, '不良数量');
    const pendingJudgmentQty = receiptQuantity(input.pendingJudgmentQty, '待判数量');
    const basis = text(input.basis, '检验依据', 2000), note = text(input.note, '检验结论及说明', 2000);
    const hash = fingerprint([lineId, receiptId, input.expectedSourceUpdatedAt, input.expectedVersion, day(inspectionDate), qualifiedQty.toString(), defectiveQty.toString(), pendingJudgmentQty.toString(), basis, note]);
    return this.transaction(async (db) => {
      await this.lock(db, lineId);
      const line = await this.line(db, lineId);
      const receipts = await this.receipts(db, lineId);
      const receipt = receipts.find((candidate) => candidate.id === receiptId);
      if (!receipt) throw new NotFoundException('该订单行的收货记录不存在');
      const existing = await db.procPurchaseReceiptInspection.findUnique({ where: { requestId: input.requestId } });
      if (existing) {
        if (existing.receiptId !== receiptId || existing.createdById !== actor.id || existing.requestFingerprint !== hash) throw new ConflictException('提交标识已使用，请重新打开表单后登记');
        return this.ledger(db, line, actor);
      }
      if (line.updatedAt.toISOString() !== input.expectedSourceUpdatedAt || receipt.version !== input.expectedVersion) throw conflict();
      const { state, summary } = await readPurchaseFulfillment(db, { ...line, receipts });
      const issue = sourceIssue(line, receipts, summary.localNetReceivedQty);
      if (issue) throw new ConflictException(issue);
      if (inspectionDate < receipt.receivedDate) throw new BadRequestException('检验日期不能早于收货日期');
      if (qualifiedQty.plus(defectiveQty).plus(pendingJudgmentQty).greaterThan(receipt.receivedQty)) throw new BadRequestException('合格、不良与待判数量合计不能超过本批次实收数量');
      const proposed = receipts.map((row) => row.id === receiptId ? { ...row, inspections: [{ qualifiedQty, defectiveQty, pendingJudgmentQty }] } : row);
      const next = calculatePurchaseFulfillment(line, proposed, state).receipts.find((row) => row.id === receiptId)!;
      if ([next.qualifiedQty, next.defectiveQty, next.pendingJudgmentQty, next.pendingQty].some((qty) => qty < 0)) throw new ConflictException('检验修订与已批准退货或冲销所扣减的判定数量冲突，请先核对履约台账');
      const version = input.expectedVersion + 1;
      const claimed = await db.procPurchaseReceipt.updateMany({ where: { id: receipt.id, lineId, version: input.expectedVersion }, data: { version } });
      if (claimed.count !== 1) throw conflict();
      const saved = await db.procPurchaseReceiptInspection.create({ data: {
        receiptId, requestId: input.requestId, requestFingerprint: hash, version, inspectionDate,
        qualifiedQty, defectiveQty, pendingJudgmentQty, basis, note, createdById: actor.id, createdByName: actor.name,
      } });
      const previous = receipt.inspections[0];
      await db.auditLog.create({ data: {
        module: 'procurement', source: 'web', action: 'purchase-order.inspection-recorded', resource: 'proc-purchase-receipt-inspection', resourceId: saved.id,
        resourceName: `${line.tpOrderNo} · ${line.tpLineNo} · ${receipt.deliveryNo}`, userId: actor.id, actorName: actor.name,
        summary: `记录采购订单 ${line.tpOrderNo} 送货单 ${receipt.deliveryNo} 第 ${version} 次检验判定`,
        meta: { lineId, receiptId, inspectionDate: day(inspectionDate), version, basis, note,
          changes: [
            { field: 'qualifiedQty', before: previous?.qualifiedQty.toString() ?? '0', after: qualifiedQty.toString() },
            { field: 'defectiveQty', before: previous?.defectiveQty.toString() ?? '0', after: defectiveQty.toString() },
            { field: 'pendingJudgmentQty', before: previous?.pendingJudgmentQty.toString() ?? '0', after: pendingJudgmentQty.toString() },
          ],
        },
      } });
      return this.ledger(db, line, actor);
    });
  }

  private async lock(db: Db, lineId: string) {
    await db.$queryRaw`SELECT id FROM "ProcPurchaseOrderMirror" WHERE id = ${lineId} FOR UPDATE`;
  }

  private async transaction<T>(action: (db: Db) => Promise<T>, write = true): Promise<T> {
    try {
      return await this.prisma.$transaction(action, {
        isolationLevel: write ? Prisma.TransactionIsolationLevel.ReadCommitted : Prisma.TransactionIsolationLevel.RepeatableRead,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (['P2002', 'P2025', 'P2034'].includes(error.code)) throw new ConflictException('记录已存在或正在被更新，请重新载入后核对');
        if (error.code === 'P2021') throw new ServiceUnavailableException('收货检验记录暂不可用，请稍后重试');
      }
      throw error;
    }
  }
}
