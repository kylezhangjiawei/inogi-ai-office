import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ProcurementService } from './procurement.service';
import { ProductionReadinessService } from './production-readiness.service';
import { executionDay, type ExecutionPlan } from './production-execution.model';
import { calculatePurchaseFulfillment, emptyFulfillmentState, fulfillmentStateKey } from './purchase-fulfillment.model';
import type { ProcActor } from './procurement.types';

const PLAN_PREFIX = 'procurement:execution:v1:plan:';
export function netProcurementDecision(line: { remainingDemand: number; current: number | null; incoming: number; qtyPer: number; problems: string[] }, expectedUnit: string, actualUnit: string) {
  const problems = [...line.problems];
  if (!expectedUnit || expectedUnit !== actualUnit) problems.push('采购任务与计划物料单位不一致');
  if (line.qtyPer <= 0 || [line.remainingDemand, line.current, line.incoming].some(value => value === null || !Number.isFinite(value) || value < 0)) problems.push('物料用量或可用数量待核对');
  if (problems.length) return { shortage: null, covered: null, suggested: null, problems: [...new Set(problems)] };
  const shortage = Prisma.Decimal.max(new Prisma.Decimal(line.remainingDemand).minus(line.current!), 0);
  const covered = Prisma.Decimal.min(shortage, line.incoming);
  return { shortage: shortage.toNumber(), covered: covered.toNumber(), suggested: shortage.minus(covered).toNumber(), problems: [] as string[] };
}
@Injectable()
export class ProcurementDecisionService {
  constructor(private readonly prisma: PrismaService, private readonly procurement: ProcurementService, private readonly readiness: ProductionReadinessService) {}
  async read(taskId: string, query: { planId?: string; batchId?: string; date?: string }, actor: ProcActor) {
    if (!actor.id || !['*', 'page:proc-cockpit', 'page:proc-materials', 'page:proc-my-workspace'].some(code => actor.permissions.includes(code))) throw new ForbiddenException('没有查看采购决策的权限');
    // Reuse the actual task scope before any plan, material or order read.
    const task = await this.procurement.getTask(taskId, actor);
    const date = query.date ? executionDay(query.date, '需求日期') : task.needDate || null;
    return this.prisma.$transaction(async db => {
      const material = task.materialId ? await db.procMaterial.findUnique({ where: { id: task.materialId }, select: { tpInventoryCode: true, unit: true } }) : null;
      const code = material?.tpInventoryCode?.trim();
      const sourceProblems: string[] = [];
      if (!task.productId) sourceProblems.push('任务尚未关联正式产品');
      if (!code) sourceProblems.push('任务物料尚未关联 T+ 物料编码，不能按名称推算缺料');
      const stored = task.productId && code ? await db.runtimeState.findMany({ where: { key: { startsWith: PLAN_PREFIX } } }) : [];
      const plans = stored.map(row => JSON.parse(row.value) as ExecutionPlan).filter(plan => plan.productId === task.productId && plan.bom.some(line => line.code === code));
      const candidates = plans.map(plan => ({ id: plan.id, month: plan.month, productName: plan.productName, batches: plan.batches.map(batch => ({ id: batch.id, code: batch.code, dueDate: batch.dueDate })) }));
      const plan = query.planId ? plans.find(row => row.id === query.planId) : null;
      if (query.planId && !plan) throw new NotFoundException('计划不属于此任务的产品与物料范围');
      if (query.batchId && !plan) throw new BadRequestException('请先选择正式计划');
      if (query.batchId && !plan?.batches.some(batch => batch.id === query.batchId)) throw new NotFoundException('批次不属于所选计划');
      if (!sourceProblems.length && !candidates.length) sourceProblems.push('尚无同时匹配产品与物料编码的正式生产计划');
      const base = { taskId, unit: task.unit, code: code || null, candidates, planId: plan?.id ?? null, batchId: query.batchId || null, date,
        shortage: null as number | null, covered: null as number | null, suggested: null as number | null,
        unaccepted: null as number | null, orderProblems: [] as string[], problems: sourceProblems,
        basis: null as null | { planVersion: number; remainingDemand: number; current: number; incoming: number; warehouse: number; warehousePending: number; otherReserved: number; lineQty: number; excludedOrders: number; orders: Array<{ orderNo: string; lineNo: string; ordered: number | null; qualified: number | null; unaccepted: number | null }> } };
      if (!plan || !date || !code) return base;
      const view = await this.readiness.calculate(db, plan.id, date, query.batchId);
      const matching = view.lines.filter(line => line.code === code);
      if (matching.length !== 1) return { ...base, problems: [...sourceProblems, '计划存在重复或缺失物料编码，请核对 BOM'] };
      const line = matching[0], decision = netProcurementDecision(line, task.unit, line.unit);
      const refs = task.purchaseOrders.filter(row => !row.freeSample);
      const orderProblems: string[] = [], orders: NonNullable<typeof base.basis>['orders'] = [];
      const seen = new Set<string>();
      for (const ref of refs) {
        if (!ref.tpOrderId || !ref.tpOrderNo || !ref.tpLineNo) { orderProblems.push('关联订单缺少原始订单 ID 或行号'); continue; }
        const identity = JSON.stringify([ref.tpOrderId, ref.tpOrderNo, ref.tpLineNo]); if (seen.has(identity)) continue; seen.add(identity);
        const matches = await db.procPurchaseOrderMirror.findMany({ where: { tpOrderId: ref.tpOrderId, tpOrderNo: ref.tpOrderNo, tpLineNo: ref.tpLineNo, inventoryCode: code }, include: { receipts: { include: { inspections: { orderBy: { version: 'desc' } } } } } });
        if (matches.length !== 1) { orderProblems.push(`订单 ${ref.tpOrderNo} 第 ${ref.tpLineNo} 行尚未唯一匹配当前物料`); continue; }
        const order = matches[0];
        const storedState = await db.runtimeState.findUnique({ where: { key: fulfillmentStateKey(order.id) } });
        const fulfillment = calculatePurchaseFulfillment(order, order.receipts, storedState ? JSON.parse(storedState.value) : emptyFulfillmentState());
        const qualified = fulfillment.qualifiedAvailableQty ?? (fulfillment.effectiveReceivedQty === 0 && fulfillment.localNetReceivedQty === 0 && !fulfillment.issues.length ? 0 : null);
        const known = order.unit === task.unit && fulfillment.effectiveOrderedQty != null && qualified != null && !fulfillment.issues.length;
        if (!known) orderProblems.push(`订单 ${ref.tpOrderNo} 第 ${ref.tpLineNo} 行的合格验收或 ERP 覆盖待核对`);
        orders.push({ orderNo: ref.tpOrderNo, lineNo: ref.tpLineNo, ordered: fulfillment.effectiveOrderedQty, qualified,
          unaccepted: known ? Prisma.Decimal.max(new Prisma.Decimal(fulfillment.effectiveOrderedQty!).minus(qualified!), 0).toNumber() : null });
      }
      return { ...base, ...decision, unaccepted: orderProblems.length ? null : orders.reduce((sum, row) => sum.plus(row.unaccepted!), new Prisma.Decimal(0)).toNumber(), orderProblems: [...new Set(orderProblems)],
        basis: { planVersion: view.planVersion, remainingDemand: line.remainingDemand, current: line.current, incoming: line.incoming, warehouse: line.warehouse, warehousePending: line.warehousePending, otherReserved: line.otherReserved, lineQty: line.lineQty, excludedOrders: line.purchase.filter(row => !row.included).length, orders } };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
}
