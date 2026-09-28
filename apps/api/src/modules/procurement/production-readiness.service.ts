import { purchaseTiming } from './purchase-timing';
import { deliveryKey, parseDeliveryState, type SupplierDeliveryState } from './purchase-delivery-store';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import type { ProcActor } from './procurement.types';
import { completionInspections, executionDay, executionQty, executionText, executionToday, type ExecutionPlan } from './production-execution.model';
import type { WarehouseIssue } from './warehouse-flow.service';
import { pendingCountReduction, WAREHOUSE_RECORD_PREFIX, type WarehouseRecord } from './warehouse-records.service';
import { purchaseOrderAvailabilityView, purchaseOrderSourceFingerprint } from './purchase-order-availability';
import { calculatePurchaseFulfillment, emptyFulfillmentState, fulfillmentStateKey } from './purchase-fulfillment.model';
import { isProductionWarehouse } from './inventory-readiness';
import { effectiveVerificationQuantity, type QualityVerificationEntry } from './quality-verification.service';
import { purchaseAllocationView, type ReadinessPurchaseLedger } from './readiness-purchase-allocation.model';
import { belongsToPlan, readinessPlanSources, readinessScope } from './readiness-scope';
import { InventoryStockService } from '../inventory-stock/inventory-stock.service';
import { stockForCode } from '../inventory-stock/inventory-stock.model';

const PREFIX = 'procurement:readiness:v1:';
const PLAN_PREFIX = 'procurement:execution:v1:plan:';
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
  constructor(private readonly prisma: PrismaService, private readonly stock: InventoryStockService = new InventoryStockService(prisma)) {}
  private access(actor: ProcActor, write = false) {
    if (!actor.id || (!actor.permissions.includes('*') && (!actor.permissions.includes('page:production-execution') || !actor.permissions.some(value => (write ? ['production:plan'] : ['production:plan', 'production:view-all', 'production:inspect']).includes(value))))) throw new ForbiddenException('需要查看全部生产或计划办理权限');
  }
  async read(planId: string, date: string, actor: ProcActor, snapshotId?: string, batchId?: string) {
    this.access(actor);
    if (snapshotId) {
      const key = `${PREFIX}snapshot:${planId}:${executionText(snapshotId, '快照编号', 128)}`;
      const row = await this.prisma.runtimeState.findUnique({ where: { key } });
      if (!row) throw new NotFoundException('本计划的历史快照不存在');
      const saved = JSON.parse(row.value) as Awaited<ReturnType<ProductionReadinessService['calculate']>>;
      if ((saved.batchId ?? null) !== (batchId || null)) throw new NotFoundException('历史快照不属于当前批次范围');
      return { ...saved, history: [] };
    }
    return this.prisma.$transaction(db => this.calculate(db, planId, executionDay(date, '需求日期'), batchId), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
  async simulate(plan: ExecutionPlan, date: string, actor: ProcActor) {
    this.access(actor);
    return this.prisma.$transaction(db => this.calculate(db, plan.id, executionDay(date, '情景需求日期'), undefined, plan), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
  async calculate(db: Prisma.TransactionClient, planId: string, date: string, batchId?: string, draft?: ExecutionPlan) {
    const stored = draft ? { value: JSON.stringify(draft) } : await db.runtimeState.findUnique({ where: { key: `procurement:execution:v1:plan:${planId}` } });
    if (!stored) throw new NotFoundException('生产计划不存在');
    const plan = JSON.parse(stored.value) as ExecutionPlan, codes = plan.bom.map(row => row.code);
    const scope = readinessScope(plan, batchId);
    const inspections = scope.tasks.filter(task => task.output === 'whole' && task.status !== 'cancelled').flatMap(completionInspections);
    const qualityIds = inspections.flatMap(row => row.qualityId ? [row.qualityId] : []);
    const [qualities, verificationRows] = qualityIds.length ? await Promise.all([
      db.procQualityRecord.findMany({ where: { id: { in: qualityIds } } }),
      db.runtimeState.findMany({ where: { OR: qualityIds.map(id => ({ key: { startsWith: `procurement:quality-verification:v1:${id}:` } })) }, orderBy: { updatedAt: 'desc' } }),
    ]) : [[], []];
    const verifications = verificationRows.map(row => JSON.parse(row.value) as QualityVerificationEntry);
    const completedQty = inspections.reduce((sum, row) => {
      const quality = qualities.find(item => item.id === row.qualityId);
      const verified = quality && ['rework', 'replacement', 'concession'].includes(quality.disposition) ? Math.min(Math.max(0, row.quantity - row.goodQty), effectiveVerificationQuantity(verifications.find(item => item.recordId === quality.id), quality)) : 0;
      return sum.plus(row.goodQty).plus(verified);
    }, new Prisma.Decimal(0)).toNumber();
    const remainingQty = Prisma.Decimal.max(new Prisma.Decimal(scope.targetQty).minus(completedQty), 0).toNumber();
    const [balances, orders, states] = await Promise.all([
      db.procInventoryBalance.findMany({ where: { tpInventoryCode: { in: codes } } }),
      db.procPurchaseOrderMirror.findMany({ where: { inventoryCode: { in: codes } }, include: { availability: true, receipts: { include: { inspections: { orderBy: { version: 'desc' } } } } } }),
      db.runtimeState.findMany({ where: { OR: [{ key: { startsWith: PREFIX } }, { key: { startsWith: PLAN_PREFIX } }, { key: { startsWith: 'procurement:warehouse-flow:v1:issue:' } }, { key: { startsWith: `${WAREHOUSE_RECORD_PREFIX}record:` } }, { key: { startsWith: 'procurement:fulfillment:v1:' } }, { key: { startsWith: 'procurement:delivery:v1:supplier:current:' } }] } }),
    ]);
    const values = new Map(states.map(row => [row.key, row.value]));
    const plans: ExecutionPlan[] = states.filter(row => row.key.startsWith(PLAN_PREFIX)).map(row => JSON.parse(row.value));
    const planSources = readinessPlanSources(plans.some(row => row.id === planId) ? plans : [...plans, plan]);
    const allocations: Allocation[] = states.filter(row => row.key.startsWith(`${PREFIX}allocation:`)).map(row => JSON.parse(row.value));
    const records: WarehouseRecord[] = states.filter(row => row.key.startsWith(`${WAREHOUSE_RECORD_PREFIX}record:`)).map(row => JSON.parse(row.value));
    const issues: WarehouseIssue[] = states.filter(row => row.key.startsWith('procurement:warehouse-flow:v1:issue:')).map(row => JSON.parse(row.value));
    const confirmations: Confirmation[] = states.filter(row => row.key.startsWith(`${PREFIX}line:`)).map(row => JSON.parse(row.value));
    const snapshot = await this.stock.read({ codes, scope: { kind: 'production' } }, db);
    const lines = plan.bom.map(material => {
      const problems: string[] = [], stock = balances.filter(row => row.tpInventoryCode === material.code && isProductionWarehouse(row.warehouse));
      const qtyPer = Number.isFinite(material.qtyPer) && material.qtyPer > 0 ? material.qtyPer : 0;
      if (!material.code?.trim() || !material.unit?.trim() || qtyPer === 0 || codes.filter(code => code === material.code).length > 1) problems.push('BOM 编码、单位、重复行或用量待核对');
      if (!stock.length) problems.push('缺少量产仓库存快照');
      const base = stockForCode(snapshot, material.code, material.unit);
      problems.push(...base.issues);
      let available = new Prisma.Decimal(base.available ?? 0);
      const warehousePending = base.rows.reduce((sum, row) => sum.plus(row.pendingIssue).plus(row.restriction).plus(row.countReduction), new Prisma.Decimal(0));
      const reserved = allocations.filter(row => row.code === material.code && (batchId ? row.planId !== scope.id : !belongsToPlan(row.planId, planId))).reduce((sum, row) => sum.plus(row.quantity), new Prisma.Decimal(0));
      available = available.minus(reserved);
      if (available.lt(0)) problems.push('扣除占用后库存为负，须核对重复占用或库存差异');
      const lineSide = issues.filter(issue => issue.planId === planId && issue.status !== 'cancelled' && (!batchId || scope.tasks.some(task => task.id === issue.taskId))).flatMap(issue => {
        const unused = unusedMaterial(plan, issue, records, material.code);
        if (!unused.source || unused.quantity === 0) return [];
        const confirmation = confirmations.find(row => row.planId === planId && row.taskId === issue.taskId && row.code === material.code);
        const confirmed = confirmation?.source === unused.source && confirmation.date === executionToday();
        if (!confirmed) problems.push(`${issue.title}线边未耗用数须当日确认`);
        return [{ taskId: issue.taskId, name: issue.title, quantity: unused.quantity, confirmedQty: confirmed ? confirmation!.quantity : 0, confirmed: Boolean(confirmed) }];
      });
      const lineQty = lineSide.reduce((sum, row) => sum.plus(row.confirmedQty), new Prisma.Decimal(0));
      const purchase = orders.filter(row => row.inventoryCode === material.code).map(order => {
        const fulfillmentState = JSON.parse(values.get(fulfillmentStateKey(order.id)) ?? JSON.stringify(emptyFulfillmentState()));
        const fulfillment = calculatePurchaseFulfillment(order, order.receipts, fulfillmentState);
        const promise = parseDeliveryState<SupplierDeliveryState>(values.get(deliveryKey('supplier', order.id)));
        const timing = purchaseTiming(order, order.availability, promise), availability = timing.availability;
        // A local receipt may precede ERP execution; never count it as both inbound stock and future delivery.
        const netReceived = Math.max(fulfillment.effectiveReceivedQty ?? 0, fulfillment.localNetReceivedQty);
        const pendingQty = fulfillment.effectiveOrderedQty == null ? null : Prisma.Decimal.max(new Prisma.Decimal(fulfillment.effectiveOrderedQty).minus(netReceived), 0).toNumber();
        const sourceValid = pendingQty != null && !fulfillment.issues.length && order.unit === material.unit && availability?.availableDate && !timing.needsReconfirmation && availability.availableDate >= executionToday();
        const allocationSource = fingerprint([purchaseOrderSourceFingerprint(order), availability, promise,
          order.receipts.map(receipt => [receipt.id, receipt.version, String(receipt.receivedQty), receipt.inspections[0]]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))), fulfillmentState.entries]);
        // All formal plans participate, including other months. Ambiguous shared supply is never assigned by iteration order.
        const shared = Boolean(draft || batchId) || plans.filter(candidate => candidate.targetQty > 0 && candidate.bom.some(row => row.code === material.code)).length > 1;
        const ledger: ReadinessPurchaseLedger | null = JSON.parse(values.get(`${PREFIX}purchase:${order.id}`) ?? 'null');
        const allocation = purchaseAllocationView(ledger, scope.id, allocationSource, pendingQty, planSources, shared);
        const batchAllocated = !batchId && ledger ? ledger.allocations.filter(row => row.planId !== planId && belongsToPlan(row.planId, planId)).reduce((sum, row) => sum.plus(purchaseAllocationView(ledger, row.planId, allocationSource, pendingQty, planSources, true).allocatedQty), new Prisma.Decimal(0)).toNumber() : 0;
        const coveredAllocationQty = new Prisma.Decimal(allocation.allocatedQty).plus(batchAllocated).toNumber();
        const eligible = Boolean(sourceValid && availability!.availableDate! <= date && coveredAllocationQty > 0);
        const allocationNote = batchAllocated > 0 ? `整月汇总已确认批次分配 ${batchAllocated}；本级分配 ${allocation.allocatedQty}，两者不重复计入` : allocation.allocationStatus === 'stale' ? '订单、收货或计划依据已变化，原分配不计入，请重新确认'
          : allocation.allocationStatus === 'implicit' ? '仅一个同料正式计划，按净未到量计入；出现其他同料计划后须明确分配'
          : allocation.allocationStatus === 'unallocated' ? '共享采购尚未分配给本计划，不计预计覆盖'
          : allocation.allocationStatus === 'released' ? '本计划分配已释放' : '仅按本计划已确认分配数量计入';
        return { id: order.id, orderNo: order.tpOrderNo, supplier: order.supplierName, date: availability?.availableDate ?? null,
          erpDate: timing.erpDate, promisedDate: timing.promisedDate, timingNote: timing.note, quantity: pendingQty, included: eligible, ...allocation, coveredAllocationQty, batchAllocatedQty: batchAllocated, allocationSource, planAllocationSource: planSources.get(scope.id)!,
          canAllocate: Boolean(sourceValid), note: `${allocationNote}。${sourceValid ? availability!.availableDate! > date ? '预计可用日超出本次需求日期' : '' : timing.note || fulfillment.issues.join('；') || '可用日期未确认、已过期或单位不一致'}` };
      });
      const incoming = purchase.filter(row => row.included).reduce((sum, row) => sum.plus(row.coveredAllocationQty), new Prisma.Decimal(0));
      const ownReserved = allocations.find(row => row.code === material.code && row.planId === scope.id)?.quantity ?? 0;
      const childReserved = batchId ? new Prisma.Decimal(0) : allocations.filter(row => row.code === material.code && row.planId !== planId && belongsToPlan(row.planId, planId)).reduce((sum, row) => sum.plus(row.quantity), new Prisma.Decimal(0));
      const maxReservable = Prisma.Decimal.max(available.minus(childReserved), 0).toNumber();
      const demand = new Prisma.Decimal(scope.targetQty).times(qtyPer), remainingDemand = new Prisma.Decimal(remainingQty).times(qtyPer), current = new Prisma.Decimal(batchId ? Math.min(ownReserved, Math.max(available.toNumber(), 0)) : available).plus(lineQty), projected = current.plus(incoming);
      return { ...material, stockState: base.stockState, stockScope: snapshot.scope, stockReadAt: snapshot.readAt, stockRows: base.rows,
        demand: demand.toNumber(), remainingDemand: remainingDemand.toNumber(), warehouse: base.available === null ? null : available.toNumber(), warehousePending: warehousePending.toNumber(), otherReserved: reserved.toNumber(), ownReserved, maxReservable: problems.length ? 0 : maxReservable, lineQty: lineQty.toNumber(), lineSide, incoming: incoming.toNumber(), current: problems.length ? null : current.toNumber(), projected: problems.length ? null : projected.toNumber(), gap: problems.length ? null : Prisma.Decimal.max(remainingDemand.minus(projected), 0).toNumber(), problems: [...new Set(problems)], purchase };
    });
    const known = lines.length > 0 && lines.every(row => row.problems.length === 0 && row.qtyPer > 0);
    const sets = (key: 'current' | 'projected') => known ? Math.min(...lines.map(row => new Prisma.Decimal(row[key]!).div(row.qtyPer).floor().toNumber())) : null;
    const history = states.filter(row => row.key.startsWith(`${PREFIX}snapshot:${planId}:`)).map(row => JSON.parse(row.value)).filter(row => (row.batchId ?? null) === scope.batchId).sort((a, b) => b.at.localeCompare(a.at));
    const sourceToken = fingerprint([stored.value, date, [...balances].sort((a, b) => a.id.localeCompare(b.id)), [...orders].sort((a, b) => a.id.localeCompare(b.id)), states.filter(row => !row.key.startsWith(`${PREFIX}request:`) && !row.key.startsWith(`${PREFIX}snapshot:`)).sort((a, b) => a.key.localeCompare(b.key)), completedQty]);
    return { planId, scopeId: scope.id, batchId: scope.batchId, batchCode: scope.batchCode, planVersion: plan.version, sourceToken: fingerprint([sourceToken, scope.id]), bomFingerprint: plan.bomFingerprint, month: plan.month, targetQty: scope.targetQty, completedQty, remainingQty, date, currentSets: sets('current'), projectedSets: sets('projected'), lines, history: history.map(({ id, at, date, currentSets, projectedSets, actorName, planVersion }) => ({ id, at, date, currentSets, projectedSets, actorName, planVersion })) };
  }
  async command(planId: string, input: { action: string; requestId: string; version: number; data: Record<string, unknown> }, actor: ProcActor) {
    this.access(actor, true);
    if (!input || !['reserve', 'line', 'snapshot', 'purchase'].includes(input.action) || !/^[A-Za-z0-9_-]{16,128}$/.test(input.requestId)
      || !input.data || typeof input.data !== 'object' || Array.isArray(input.data)) throw new BadRequestException('齐套操作无效');
    const reason = executionText(input.data.reason, '操作依据', 2000), key = `${PREFIX}request:${input.requestId}`, signature = fingerprint([actor.id, planId, input]);
    try { return await this.prisma.$transaction(async db => {
      const previous = await db.runtimeState.findUnique({ where: { key } });
      if (previous) { if (previous.value !== signature) throw new ConflictException('提交标识已用于其他内容'); return { saved: true }; }
      const batchId = input.data.batchId ? executionText(input.data.batchId, '批次编号', 128) : undefined;
      const view = await this.calculate(db, planId, executionDay(input.data.date ?? executionToday(), '需求日期'), batchId);
      if (view.planVersion !== input.version) throw new ConflictException('生产计划已更新，请重新核对');
      if (input.data.sourceToken !== view.sourceToken) throw new ConflictException('库存、采购或占用依据已变化，请保留草稿并刷新依据后重新确认');
      let value: unknown, target: string;
      if (input.action === 'snapshot') { const id = randomUUID(); target = `${PREFIX}snapshot:${planId}:${id}`; value = { ...view, history: undefined, id, reason, actorName: actor.name, at: new Date().toISOString() }; }
      else {
        const code = executionText(input.data.code, '物料编码'), line = view.lines.find(row => row.code === code);
        if (!line) throw new BadRequestException('物料不属于本计划 BOM');
        const quantity = executionQty(input.data.quantity, '确认数量');
        if (input.action === 'reserve') {
          if (quantity > 0 && (line.problems.length || quantity > Math.min(line.maxReservable, line.remainingDemand) || line.warehouse === null || line.warehouse < 0)) throw new ConflictException('占用超过可分配库存或本范围尚未完成需求，或库存依据待核对');
          target = `${PREFIX}allocation:${view.scopeId}:${code}`; value = { planId: view.scopeId, code, quantity, actorId: actor.id, actorName: actor.name, reason, at: new Date().toISOString() };
        } else if (input.action === 'purchase') {
          const orderId = executionText(input.data.orderId, '采购订单行'), order = line.purchase.find(row => row.id === orderId);
          if (!order) throw new BadRequestException('采购订单行不属于本计划物料');
          if (quantity > 0 && (!order.canAllocate || quantity > Math.min(order.maxAllocatable, line.remainingDemand))) throw new ConflictException('分配超过该订单可分配净未到量或本计划剩余需求，或采购来源尚未确认');
          target = `${PREFIX}purchase:${orderId}`;
          const prior = await db.runtimeState.findUnique({ where: { key: target } });
          const ledger: ReadinessPurchaseLedger = prior ? JSON.parse(prior.value) : { version: 0, allocations: [], history: [] };
          const allocation = { planId: view.scopeId, quantity, source: order.allocationSource, planSource: order.planAllocationSource,
            actorId: actor.id, actorName: actor.name, reason, at: new Date().toISOString() };
          // Every plan writes the same order-row ledger in a Serializable transaction. Conflicts cannot overbook another plan's supply.
          value = { version: ledger.version + 1, allocations: [...ledger.allocations.filter(row => row.planId !== view.scopeId), allocation], history: [...ledger.history, allocation] } satisfies ReadinessPurchaseLedger;
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
