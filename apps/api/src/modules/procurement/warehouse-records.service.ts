import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { executionDay, executionQty, executionText, executionToday, type ExecutionPlan } from './production-execution.model';
import type { WarehouseIssue } from './warehouse-flow.service';
import type { ProcActor } from './procurement.types';
import { calculatePurchaseFulfillment } from './purchase-fulfillment.model';
import { readPurchaseFulfillment } from './purchase-fulfillment.service';

export const WAREHOUSE_RECORD_PREFIX = 'procurement:warehouse-record:v1:';
export interface WarehouseRecord {
  id: string; version: number; kind: 'receipt' | 'return' | 'count'; status: 'pending' | 'confirmed' | 'cancelled';
  origin?: 'unused' | 'defect';
  code: string; name: string; unit: string; warehouse: string; batch: string; date: string;
  quantity: number; qualifiedQty: number; defectiveQty: number; pendingQty: number;
  sourceId: string; planId?: string; batchId?: string; taskId?: string; bookQty?: number; countedQty?: number; inventoryVersion?: string;
  actorId: string; actorName: string; confirmedBy?: string; confirmedAt?: string;
  reason: string; events: Array<{ action: string; actorId: string; actorName: string; at: string; reason: string }>;
  reconciliation?: { voucher: string; line: string; actorId: string; actorName: string; at: string; evidence: string };
}
export interface WarehouseRecordCommand { requestId: string; action: string; id?: string; version?: number; data: Record<string, unknown> }
export const warehouseRecordKey = (id: string) => `${WAREHOUSE_RECORD_PREFIX}record:${id}`;
const decode = (value: string) => JSON.parse(value) as WarehouseRecord;
const has = (actor: ProcActor, permission: string) => actor.permissions.includes('*') || actor.permissions.includes(permission);
export function pendingCountReduction(records: WarehouseRecord[], code: string, warehouse: string, syncedAt: Date | null) {
  return records.filter(row => row.kind === 'count' && row.status === 'confirmed' && row.code === code && row.warehouse === warehouse && row.quantity < 0 && (!row.reconciliation || !syncedAt || syncedAt <= new Date(row.reconciliation.at))).reduce((sum, row) => sum.minus(row.quantity), new Prisma.Decimal(0));
}
export async function warehouseReturns(db: Prisma.TransactionClient, taskId: string) {
  const rows = await db.runtimeState.findMany({ where: { key: { startsWith: `${WAREHOUSE_RECORD_PREFIX}record:` } } });
  return rows.map(row => decode(row.value)).filter(row => row.kind === 'return' && row.taskId === taskId && row.status === 'confirmed');
}

@Injectable()
export class WarehouseRecordsService {
  constructor(private readonly prisma: PrismaService) {}
  private access(actor: ProcActor, permission?: string) {
    if (!actor.id || !(has(actor, 'page:warehouse-flow') || has(actor, 'page:production-execution')) || (permission && !has(actor, permission))) throw new ForbiddenException('没有执行此仓库业务的权限');
  }
  async list(actor: ProcActor) {
    this.access(actor);
    const all = has(actor, 'page:warehouse-flow');
    const rows = await this.prisma.runtimeState.findMany({ where: { key: { startsWith: `${WAREHOUSE_RECORD_PREFIX}record:` } }, orderBy: { updatedAt: 'desc' } });
    const receipts = all ? await this.prisma.procPurchaseReceipt.findMany({ include: { inspections: { orderBy: { version: 'desc' } }, line: { include: { receipts: { include: { inspections: { orderBy: { version: 'desc' } } } } } } }, orderBy: { createdAt: 'desc' } }) : [];
    const records = rows.map(row => decode(row.value));
    return { records: records.filter(row => all || row.actorId === actor.id),
      receipts: await Promise.all(receipts.filter(row => row.inspections.length && !records.some(record => record.kind === 'receipt' && record.sourceId === row.id)).map(async row => { const { summary } = await readPurchaseFulfillment(this.prisma, row.line); const net = summary.receipts.find(item => item.id === row.id)!; return { id: row.id, version: row.version, code: row.sourceInventoryCode, name: row.sourceInventoryName, unit: row.sourceUnit, deliveryNo: row.deliveryNo, orderNo: row.sourceOrderNo, qualifiedQty: net.qualifiedQty, defectiveQty: net.defectiveQty, issues: summary.issues }; })),
      balances: all ? await this.prisma.procInventoryBalance.findMany({ select: { tpInventoryCode: true, warehouse: true, unit: true, stockQty: true, availableQty: true, syncedAt: true, material: { select: { name: true } } }, orderBy: [{ tpInventoryCode: 'asc' }, { warehouse: 'asc' }] }) : [] };
  }
  async command(input: WarehouseRecordCommand, actor: ProcActor) {
    const permissions: Record<string, string | undefined> = { receipt: 'warehouse:receive', return: undefined, cancel: undefined, 'receive-return': 'warehouse:receive', count: 'warehouse:count', 'approve-count': 'warehouse:adjust', reconcile: 'warehouse:reconcile' };
    if (!input || !Object.prototype.hasOwnProperty.call(permissions, input.action) || !input.data || typeof input.data !== 'object' || Array.isArray(input.data)) throw new BadRequestException('仓库操作无效');
    this.access(actor, permissions[input.action]);
    if (!['return', 'cancel'].includes(input.action) && !has(actor, 'page:warehouse-flow')) throw new ForbiddenException('需要仓管页面权限');
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(input.requestId)) throw new BadRequestException('提交标识无效');
    const data = input.data, reason = executionText(data.reason, '依据与原因', 2000);
    const requestKey = `${WAREHOUSE_RECORD_PREFIX}request:${input.requestId}`;
    const fingerprint = createHash('sha256').update(JSON.stringify([actor.id, input])).digest('hex');
    try {
      return await this.prisma.$transaction(async db => {
        const repeated = await db.runtimeState.findUnique({ where: { key: requestKey } });
        if (repeated) { const saved = JSON.parse(repeated.value); if (saved.fingerprint !== fingerprint) throw new ConflictException('提交编号已用于其他内容'); return { id: saved.id }; }
        const date = data.date ? executionDay(data.date, '业务日期') : executionToday();
        if (date > executionToday()) throw new BadRequestException('实际业务日期不能晚于今天');
        const event = { action: input.action, reason, actorId: actor.id, actorName: actor.name, at: new Date().toISOString() };
        let record: WarehouseRecord;
        if (['receipt', 'return', 'count'].includes(input.action)) {
          record = { id: randomUUID(), version: 1, kind: input.action as WarehouseRecord['kind'], status: 'pending', code: '', name: '', unit: '', warehouse: executionText(data.warehouse, '仓库'), batch: '', date,
            quantity: 0, qualifiedQty: 0, defectiveQty: 0, pendingQty: 0, sourceId: '', actorId: actor.id, actorName: actor.name, reason, events: [event] };
          if (input.action === 'receipt') {
            const receipt = await db.procPurchaseReceipt.findUnique({ where: { id: executionText(data.receiptId, '收货记录') }, include: { inspections: { orderBy: { version: 'desc' } }, line: { include: { receipts: { include: { inspections: { orderBy: { version: 'desc' } } } } } } } });
            if (!receipt || receipt.version !== data.receiptVersion || !receipt.inspections.length) throw new ConflictException('收货检验已变化，请重新核对');
            const existing = await db.runtimeState.findUnique({ where: { key: `${WAREHOUSE_RECORD_PREFIX}receipt:${receipt.id}` } });
            if (existing) throw new ConflictException('该收货批次已经入库，不可重复确认');
            const { state, summary } = await readPurchaseFulfillment(db, receipt.line);
            const net = calculatePurchaseFulfillment(receipt.line, receipt.line.receipts, state).receipts.find(row => row.id === receipt.id);
            if (!net || summary.issues.length) throw new ConflictException('收货履约数量待核对，请先处理订单、退货或冲销差异');
            record = { ...record, status: 'confirmed', sourceId: receipt.id, code: receipt.sourceInventoryCode, name: receipt.sourceInventoryName, unit: receipt.sourceUnit, batch: receipt.deliveryNo,
              quantity: net.netReceivedQty, qualifiedQty: net.qualifiedQty, defectiveQty: net.defectiveQty, pendingQty: net.pendingQty + net.pendingJudgmentQty, confirmedBy: actor.id, confirmedAt: event.at };
            if (record.quantity <= 0) throw new BadRequestException('没有可接收入库的净收货数量');
            await db.runtimeState.create({ data: { key: `${WAREHOUSE_RECORD_PREFIX}receipt:${receipt.id}`, value: record.id } });
          } else if (input.action === 'return') {
            const stored = await db.runtimeState.findUnique({ where: { key: `procurement:warehouse-flow:v1:issue:${executionText(data.taskId, '原领料作业')}` } });
            if (!stored) throw new NotFoundException('原领料记录不存在');
            const issue = JSON.parse(stored.value) as WarehouseIssue;
            if (issue.recipientId !== actor.id) throw new ForbiddenException('仅实际领料人可以发起退料');
            const line = issue.lines.find(row => row.code === data.code);
            if (!line) throw new BadRequestException('物料不属于原领料单');
            const quantity = executionQty(data.quantity, '退回数量', true);
            if (quantity > (line.signedQty ?? 0)) throw new BadRequestException('退回数量不能超过原实收数量');
            const bucket = executionText(data.bucket, '退料状态');
            if (!['qualified', 'defective', 'pending'].includes(bucket)) throw new BadRequestException('请选择良品、不良或待判');
            if (!['unused', 'defect'].includes(String(data.origin)) || (data.origin === 'defect' && bucket === 'qualified')) throw new BadRequestException('请区分未耗用退料与已报工不良退料，不良产出不能作为良品退库');
            record = { ...record, taskId: issue.taskId, planId: issue.planId, batchId: issue.batchId, sourceId: issue.id, batch: issue.batchId, code: line.code, name: line.name, unit: line.unit, quantity,
              origin: data.origin as 'unused' | 'defect', qualifiedQty: bucket === 'qualified' ? quantity : 0, defectiveQty: bucket === 'defective' ? quantity : 0, pendingQty: bucket === 'pending' ? quantity : 0 };
          } else {
            const code = executionText(data.code, '物料编码');
            const balance = await db.procInventoryBalance.findUnique({ where: { tpInventoryCode_warehouse: { tpInventoryCode: code, warehouse: record.warehouse } }, include: { material: true } });
            if (!balance?.syncedAt || !balance.unit || balance.stockQty.lt(0) || balance.availableQty.lt(0)) throw new BadRequestException('库存、单位或同步来源待核对');
            const priorCounts = await db.runtimeState.findMany({ where: { key: { startsWith: `${WAREHOUSE_RECORD_PREFIX}record:` } } });
            if (priorCounts.map(row => decode(row.value)).some(row => row.kind === 'count' && row.code === code && row.warehouse === record.warehouse && row.status !== 'cancelled' && (row.status === 'pending' || !row.reconciliation || balance.syncedAt! <= new Date(row.reconciliation.at)))) throw new ConflictException('该库存已有待复核或尚未完成 ERP 核对同步的盘点，请先完成原记录');
            const countedQty = executionQty(data.countedQty, '实盘合格数量');
            record = { ...record, code, name: balance.material?.name ?? code, unit: balance.unit, batch: executionText(data.batch, '盘点批次或范围'), sourceId: balance.id,
              bookQty: balance.stockQty.toNumber(), countedQty, quantity: countedQty - balance.stockQty.toNumber(), inventoryVersion: balance.syncedAt.toISOString() };
          }
          await db.runtimeState.create({ data: { key: warehouseRecordKey(record.id), value: JSON.stringify(record) } });
        } else {
          const stored = await db.runtimeState.findUnique({ where: { key: warehouseRecordKey(executionText(input.id, '记录编号')) } });
          if (!stored) throw new NotFoundException('仓库记录不存在');
          record = decode(stored.value);
          if (record.version !== input.version) throw new ConflictException('记录已更新，请保留草稿并重新核对');
          if (input.action === 'cancel') {
            if (record.actorId !== actor.id || record.status !== 'pending') throw new ForbiddenException('仅填报人可撤销尚未接收或复核的记录');
            record.status = 'cancelled';
          } else if (input.action === 'reconcile') {
            if (record.status !== 'confirmed') throw new BadRequestException('请先确认实际业务');
            const voucher = executionText(data.voucher, 'ERP 凭证号'), line = executionText(data.line, '凭证行号');
            if (data.posted !== true || data.detailsMatch !== true || data.quantity !== record.quantity) throw new BadRequestException('须确认凭证已生效，物料、仓库、状态和实际数量逐项一致');
            const voucherKey = `${WAREHOUSE_RECORD_PREFIX}voucher:${createHash('sha256').update(JSON.stringify([voucher, line])).digest('hex')}`;
            const used = await db.runtimeState.findUnique({ where: { key: voucherKey } });
            if (used && used.value !== record.id) throw new ConflictException('该凭证行已用于另一条库存记录');
            await db.runtimeState.upsert({ where: { key: voucherKey }, create: { key: voucherKey, value: record.id }, update: { value: record.id } });
            record.reconciliation = { voucher, line, actorId: actor.id, actorName: actor.name, at: event.at, evidence: reason };
          } else {
            if (record.status !== 'pending' || (input.action === 'receive-return' ? record.kind !== 'return' : record.kind !== 'count')) throw new ConflictException('记录状态不允许此操作');
            if (input.action === 'receive-return') {
              if (data.receivedQty !== record.quantity) throw new BadRequestException('实收与退回不一致，请先核对差异，不可静默入账');
              const issueRow = await db.runtimeState.findUnique({ where: { key: `procurement:warehouse-flow:v1:issue:${record.taskId}` } });
              const planRow = await db.runtimeState.findUnique({ where: { key: `procurement:execution:v1:plan:${record.planId}` } });
              if (!issueRow || !planRow) throw new ConflictException('原领料或生产计划缺失');
              const issue = JSON.parse(issueRow.value) as WarehouseIssue, plan = JSON.parse(planRow.value) as ExecutionPlan;
              const task = plan.tasks.find(row => row.id === record.taskId), material = task?.materials.find(row => row.code === record.code);
              if (!task || !material) throw new ConflictException('原作业物料已变化');
              const previous = (await warehouseReturns(db, task.id)).filter(row => row.code === record.code && row.origin === record.origin).reduce((sum, row) => sum.plus(row.quantity), new Prisma.Decimal(0));
              const reported = task.reports.reduce((sum, row) => sum.plus(record.origin === 'defect' ? row.quantity - row.goodQty : row.quantity), new Prisma.Decimal(0)).times(material.qtyPer);
              const available = (record.origin === 'defect' ? reported : new Prisma.Decimal(issue.lines.find(row => row.code === record.code)?.signedQty ?? 0).minus(reported)).minus(previous);
              if (available.lt(record.quantity)) throw new ConflictException('退回数量超过未耗用或不良可退范围，请核对报工和历史退料');
            } else {
              if (record.actorId === actor.id) throw new ForbiddenException('盘点填报人与复核人须为不同人员');
              const balance = await db.procInventoryBalance.findUnique({ where: { tpInventoryCode_warehouse: { tpInventoryCode: record.code, warehouse: record.warehouse } } });
              if (!balance?.syncedAt || balance.syncedAt.toISOString() !== record.inventoryVersion || balance.stockQty.toNumber() !== record.bookQty) throw new ConflictException('盘点后库存来源已更新，请重新盘核');
              const occupied = balance.stockQty.minus(balance.availableQty);
              if (new Prisma.Decimal(record.countedQty!).lt(occupied)) throw new ConflictException('实盘少于已占用数量，请先核对受影响计划');
            }
            record.status = 'confirmed'; record.confirmedBy = actor.id; record.confirmedAt = event.at;
          }
          record.events.push(event); record.version++;
          const changed = await db.runtimeState.updateMany({ where: { key: stored.key, value: stored.value }, data: { value: JSON.stringify(record) } });
          if (changed.count !== 1) throw new ConflictException('记录已被更新');
        }
        await db.runtimeState.create({ data: { key: requestKey, value: JSON.stringify({ fingerprint, id: record.id }) } });
        await db.auditLog.create({ data: { module: 'procurement', source: 'web', action: `warehouse.${input.action}`, resource: 'warehouse-record', resourceId: record.id, userId: actor.id, actorName: actor.name, summary: reason, meta: JSON.parse(JSON.stringify(record)) } });
        return { id: record.id };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2002', 'P2025'].includes(error.code)) throw new ConflictException('数据正在更新，请保留草稿后重试'); throw error; }
  }
}
