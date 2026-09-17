import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import type { ProcActor } from './procurement.types';
import { executionDay, executionQty, executionText, executionToday, type ExecutionPlan } from './production-execution.model';
import type { WarehouseIssue } from './warehouse-flow.service';
import { pendingCountReduction, WAREHOUSE_RECORD_PREFIX, type WarehouseRecord } from './warehouse-records.service';
import { purchaseOrderAvailabilityView } from './purchase-order-availability';
import { calculatePurchaseFulfillment, emptyFulfillmentState, fulfillmentStateKey } from './purchase-fulfillment.model';
import { isProductionWarehouse } from './inventory-readiness';
import { effectiveVerificationQuantity, type QualityVerificationEntry } from './quality-verification.service';

const PREFIX = 'procurement:readiness:v1:';
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Allocation = { planId: string; code: string; quantity: number; actorId: string; actorName: string; reason: string; at: string };
type Confirmation = { planId: string; taskId: string; code: string; quantity: number; source: string; date: string; actorName: string; reason: string };
export function unusedMaterial(plan: ExecutionPlan, issue: WarehouseIssue, records: WarehouseRecord[], code: string) {
  const task = plan.tasks.find(row => row.id === issue.taskId), material = task?.materials.find(row => row.code === code);
  if (!task || !material) return { quantity: 0, source: '' };
  const returned = records.filter(row => row.status === 'confirmed' && row.kind === 'return' && row.taskId === task.id && row.code === code && row.origin === 'unused');
  const quantity = new Prisma.Decimal(issue.lines.find(row => row.code === code)?.signedQty ?? 0).minus(task.reports.reduce((sum, row) => sum.plus(row.quantity), new Prisma.Decimal(0)).times(material.qtyPer)).minus(returned.reduce((sum, row) => sum.plus(row.quantity), new Prisma.Decimal(0))).toNumber();
  return { quantity, source: fingerprint([task, issue.lines, returned.map(row => [row.id, row.version])]) };
}
@Injectable()
export class ProductionReadinessService {
  constructor(private readonly prisma: PrismaService) {}
  private access(actor: ProcActor, write = false) {
    if (!actor.id || (!actor.permissions.includes('*') && (!actor.permissions.includes('page:production-execution') || !actor.permissions.some(value => (write ? ['production:plan'] : ['production:plan', 'production:view-all', 'production:inspect']).includes(value))))) throw new ForbiddenException('需要查看全部生产或计划办理权限');
  }
  async read(planId: string, date: string, actor: ProcActor, snapshotId?: string) {
    this.access(actor);
    if (snapshotId) {
      const key = `${PREFIX}snapshot:${planId}:${executionText(snapshotId, '快照编号', 128)}`;
      const row = await this.prisma.runtimeState.findUnique({ where: { key } });
      if (!row) throw new NotFoundException('本计划的历史快照不存在');
      return { ...JSON.parse(row.value), history: [] } as Awaited<ReturnType<ProductionReadinessService['calculate']>>;
    }
    return this.calculate(this.prisma, planId, executionDay(date, '需求日期'));
  }
  async calculate(db: Prisma.TransactionClient, planId: string, date: string) {
    const stored = await db.runtimeState.findUnique({ where: { key: `procurement:execution:v1:plan:${planId}` } });
    if (!stored) throw new NotFoundException('生产计划不存在');
    const plan = JSON.parse(stored.value) as ExecutionPlan, codes = plan.bom.map(row => row.code);
    const inspections = plan.tasks.filter(task => task.output === 'whole' && task.status !== 'cancelled').flatMap(task => task.inspections ?? []);
    const qualityIds = inspections.flatMap(row => row.qualityId ? [row.qualityId] : []);
    const [qualities, verificationRows] = qualityIds.length ? await Promise.all([
      db.procQualityRecord.findMany({ where: { id: { in: qualityIds } } }),
      db.runtimeState.findMany({ where: { OR: qualityIds.map(id => ({ key: { startsWith: `procurement:quality-verification:v1:${id}:` } })) }, orderBy: { updatedAt: 'desc' } }),
    ]) : [[], []];
    const verifications = verificationRows.map(row => JSON.parse(row.value) as QualityVerificationEntry);
    const completedQty = inspections.reduce((sum, row) => {
      const quality = qualities.find(item => item.id === row.qualityId);
      return sum.plus(row.goodQty).plus(quality && ['rework', 'replacement', 'concession'].includes(quality.disposition) ? effectiveVerificationQuantity(verifications.find(item => item.recordId === quality.id), quality) : 0);
    }, new Prisma.Decimal(0)).toNumber();
    const remainingQty = Math.max(0, plan.targetQty - completedQty);
    const [balances, orders, states] = await Promise.all([
      db.procInventoryBalance.findMany({ where: { tpInventoryCode: { in: codes } } }),
      db.procPurchaseOrderMirror.findMany({ where: { inventoryCode: { in: codes } }, include: { availability: true, receipts: { include: { inspections: { orderBy: { version: 'desc' } } } } } }),
      db.runtimeState.findMany({ where: { OR: [{ key: { startsWith: PREFIX } }, { key: { startsWith: 'procurement:warehouse-flow:v1:issue:' } }, { key: { startsWith: `${WAREHOUSE_RECORD_PREFIX}record:` } }, { key: { startsWith: 'procurement:fulfillment:v1:' } }] } }),
    ]);
    const values = new Map(states.map(row => [row.key, row.value]));
    const allocations: Allocation[] = states.filter(row => row.key.startsWith(`${PREFIX}allocation:`)).map(row => JSON.parse(row.value));
    const records: WarehouseRecord[] = states.filter(row => row.key.startsWith(`${WAREHOUSE_RECORD_PREFIX}record:`)).map(row => JSON.parse(row.value));
    const issues: WarehouseIssue[] = states.filter(row => row.key.startsWith('procurement:warehouse-flow:v1:issue:')).map(row => JSON.parse(row.value));
    const confirmations: Confirmation[] = states.filter(row => row.key.startsWith(`${PREFIX}line:`)).map(row => JSON.parse(row.value));
    const lines = plan.bom.map(material => {
      const problems: string[] = [], stock = balances.filter(row => row.tpInventoryCode === material.code && isProductionWarehouse(row.warehouse));
      if (!stock.length) problems.push('缺少量产仓库存快照');
      let available = new Prisma.Decimal(0), warehousePending = new Prisma.Decimal(0);
      for (const row of stock) {
        if (!row.syncedAt || row.unit !== material.unit || row.availableQty.lt(0) || row.stockQty.lt(row.availableQty)) problems.push(`${row.warehouse}单位、同步或库存数量待核对`);
        const pending = issues.flatMap(issue => issue.history.filter(event => event.action === 'issue').flatMap(event => {
          const checked = [...issue.history].reverse().find(item => item.reconciliation?.eventId === event.id);
          if (checked?.reconciliation?.result === 'matched' && row.syncedAt && row.syncedAt > new Date(checked.at)) return [];
          return (event.lines ?? []).filter(line => line.code === material.code && line.warehouse === row.warehouse);
        })).reduce((sum, line) => sum.plus(line.quantity), new Prisma.Decimal(0));
        warehousePending = warehousePending.plus(pending).plus(pendingCountReduction(records, material.code, row.warehouse, row.syncedAt));
        available = available.plus(row.availableQty);
      }
      const reserved = allocations.filter(row => row.code === material.code && row.planId !== planId).reduce((sum, row) => sum.plus(row.quantity), new Prisma.Decimal(0));
      available = available.minus(warehousePending).minus(reserved);
      if (available.lt(0)) problems.push('扣除占用后库存为负，须核对重复占用或库存差异');
      const lineSide = issues.filter(issue => issue.planId === planId && issue.status !== 'cancelled').flatMap(issue => {
        const unused = unusedMaterial(plan, issue, records, material.code);
        if (!unused.source || unused.quantity === 0) return [];
        const confirmation = confirmations.find(row => row.planId === planId && row.taskId === issue.taskId && row.code === material.code);
        const confirmed = confirmation?.source === unused.source && confirmation.date === executionToday();
        if (!confirmed) problems.push(`${issue.title}线边未耗用数须当日确认`);
        return [{ taskId: issue.taskId, name: issue.title, quantity: unused.quantity, confirmedQty: confirmed ? confirmation!.quantity : 0, confirmed: Boolean(confirmed) }];
      });
      const lineQty = lineSide.reduce((sum, row) => sum.plus(row.confirmedQty), new Prisma.Decimal(0));
      const purchase = orders.filter(row => row.inventoryCode === material.code).map(order => {
        const fulfillment = calculatePurchaseFulfillment(order, order.receipts, JSON.parse(values.get(fulfillmentStateKey(order.id)) ?? JSON.stringify(emptyFulfillmentState())));
        const availability = purchaseOrderAvailabilityView(order.availability, order);
        // A local receipt may precede ERP execution; never count it as both inbound stock and future delivery.
        const netReceived = Math.max(fulfillment.effectiveReceivedQty ?? 0, fulfillment.localNetReceivedQty);
        const pendingQty = fulfillment.effectiveOrderedQty == null ? null : Math.max(0, fulfillment.effectiveOrderedQty - netReceived);
        const eligible = pendingQty != null && !fulfillment.issues.length && order.unit === material.unit && availability?.availableDate && !availability.needsReconfirmation && availability.availableDate >= executionToday() && availability.availableDate <= date;
        return { id: order.id, orderNo: order.tpOrderNo, supplier: order.supplierName, date: availability?.availableDate ?? null, quantity: pendingQty, included: Boolean(eligible), note: eligible ? '已确认预计检验后可用' : fulfillment.issues.join('；') || '可用日期未确认、已过期、超出需求日或单位不一致' };
      });
      const incoming = purchase.filter(row => row.included).reduce((sum, row) => sum.plus(row.quantity!), new Prisma.Decimal(0));
      const demand = new Prisma.Decimal(plan.targetQty).times(material.qtyPer), remainingDemand = new Prisma.Decimal(remainingQty).times(material.qtyPer), current = available.plus(lineQty), projected = current.plus(incoming);
      return { ...material, demand: demand.toNumber(), remainingDemand: remainingDemand.toNumber(), warehouse: available.toNumber(), warehousePending: warehousePending.toNumber(), otherReserved: reserved.toNumber(), ownReserved: allocations.find(row => row.code === material.code && row.planId === planId)?.quantity ?? 0, lineQty: lineQty.toNumber(), lineSide, incoming: incoming.toNumber(), current: current.toNumber(), projected: projected.toNumber(), gap: Prisma.Decimal.max(remainingDemand.minus(projected), 0).toNumber(), problems: [...new Set(problems)], purchase };
    });
    const known = lines.length > 0 && lines.every(row => row.problems.length === 0 && row.qtyPer > 0);
    const sets = (key: 'current' | 'projected') => known ? Math.min(...lines.map(row => Math.floor(row[key] / row.qtyPer))) : null;
    const history = states.filter(row => row.key.startsWith(`${PREFIX}snapshot:${planId}:`)).map(row => JSON.parse(row.value)).sort((a, b) => b.at.localeCompare(a.at));
    const sourceToken = fingerprint([stored.value, date, [...balances].sort((a, b) => a.id.localeCompare(b.id)), [...orders].sort((a, b) => a.id.localeCompare(b.id)), states.filter(row => !row.key.startsWith(`${PREFIX}request:`) && !row.key.startsWith(`${PREFIX}snapshot:`)).sort((a, b) => a.key.localeCompare(b.key)), completedQty]);
    return { planId, planVersion: plan.version, sourceToken, bomFingerprint: plan.bomFingerprint, month: plan.month, targetQty: plan.targetQty, completedQty, remainingQty, date, currentSets: sets('current'), projectedSets: sets('projected'), lines, history: history.map(({ id, at, date, currentSets, projectedSets, actorName, planVersion }) => ({ id, at, date, currentSets, projectedSets, actorName, planVersion })) };
  }
  async command(planId: string, input: { action: string; requestId: string; version: number; data: Record<string, unknown> }, actor: ProcActor) {
    this.access(actor, true);
    if (!['reserve', 'line', 'snapshot'].includes(input.action) || !/^[A-Za-z0-9_-]{16,128}$/.test(input.requestId)) throw new BadRequestException('齐套操作无效');
    const reason = executionText(input.data.reason, '操作依据', 2000), key = `${PREFIX}request:${input.requestId}`, signature = fingerprint([actor.id, planId, input]);
    try { return await this.prisma.$transaction(async db => {
      const previous = await db.runtimeState.findUnique({ where: { key } });
      if (previous) { if (previous.value !== signature) throw new ConflictException('提交标识已用于其他内容'); return { saved: true }; }
      const view = await this.calculate(db, planId, executionDay(input.data.date ?? executionToday(), '需求日期'));
      if (view.planVersion !== input.version) throw new ConflictException('生产计划已更新，请重新核对');
      if (input.data.sourceToken !== view.sourceToken) throw new ConflictException('库存、采购或占用依据已变化，请保留草稿并刷新依据后重新确认');
      let value: unknown, target: string;
      if (input.action === 'snapshot') { const id = randomUUID(); target = `${PREFIX}snapshot:${planId}:${id}`; value = { ...view, history: undefined, id, reason, actorName: actor.name, at: new Date().toISOString() }; }
      else {
        const code = executionText(input.data.code, '物料编码'), line = view.lines.find(row => row.code === code);
        if (!line) throw new BadRequestException('物料不属于本计划 BOM');
        const quantity = executionQty(input.data.quantity, '确认数量');
        if (input.action === 'reserve') {
          if (quantity > 0 && (quantity > Math.min(line.warehouse, line.remainingDemand) || line.warehouse < 0)) throw new ConflictException('占用超过可分配库存或本计划尚未完成需求');
          target = `${PREFIX}allocation:${planId}:${code}`; value = { planId, code, quantity, actorId: actor.id, actorName: actor.name, reason, at: new Date().toISOString() };
        } else {
          const taskId = executionText(input.data.taskId, '作业'), unused = line.lineSide.find(row => row.taskId === taskId);
          if (!unused || quantity > unused.quantity) throw new ConflictException('确认数量超过已签收且未耗用余额');
          const plan = JSON.parse((await db.runtimeState.findUnique({ where: { key: `procurement:execution:v1:plan:${planId}` } }))!.value);
          const issue = JSON.parse((await db.runtimeState.findUnique({ where: { key: `procurement:warehouse-flow:v1:issue:${taskId}` } }))!.value);
          const records = await db.runtimeState.findMany({ where: { key: { startsWith: `${WAREHOUSE_RECORD_PREFIX}record:` } } });
          target = `${PREFIX}line:${planId}:${taskId}:${code}`; value = { planId, taskId, code, quantity, source: unusedMaterial(plan, issue, records.map(row => JSON.parse(row.value)), code).source, date: executionToday(), actorName: actor.name, reason };
        }
      }
      const stored = await db.runtimeState.findUnique({ where: { key: target } });
      if (stored) { const changed = await db.runtimeState.updateMany({ where: { key: target, value: stored.value }, data: { value: JSON.stringify(value) } }); if (changed.count !== 1) throw new ConflictException('齐套依据已被更新'); }
      else await db.runtimeState.create({ data: { key: target, value: JSON.stringify(value) } });
      await db.runtimeState.create({ data: { key, value: signature } });
      await db.auditLog.create({ data: { module: 'procurement', source: 'web', action: `readiness.${input.action}`, resource: 'production-plan', resourceId: planId, userId: actor.id, actorName: actor.name, summary: reason, meta: JSON.parse(JSON.stringify(value)) } });
      return { saved: true };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); } catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2002'].includes(error.code)) throw new ConflictException('齐套依据正在更新，请保留草稿重试'); throw error; }
  }
}
