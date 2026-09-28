import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ProductionExecutionService } from './production-execution.service';
import { ProductionReadinessService } from './production-readiness.service';
import { completionInspections, executionFinalInspectionSummary, executionMonth, executionSummary, executionToday, type ExecutionPlan } from './production-execution.model';
import { type LifecycleState } from './production-lifecycle.service';
import type { ProcActor } from './procurement.types';
import { managementRiskScopes, managementSupplyRisks } from './management-supply-risks';
export interface ManagementRisk { id: string; kind: 'quality' | 'ecn' | 'material' | 'schedule' | 'procurement' | 'purchase-order'; title: string; owner: string | null; dueDate: string | null; planId?: string; taskId?: string; recordId?: string; batchCodes: string[]; product: string; note: string;
  period?: 'current' | 'carryover'; keyMaterialId?: string;
  target?: { type: 'purchase-order'; orderNo: string; lineId: string } | { type: 'procurement'; taskId: string } | { type: 'quality'; qualityId: string };
}
export function uniqueManagementRisks(rows: ManagementRisk[]) {
  const unique = new Map<string, ManagementRisk>();
  for (const row of rows) { const old = unique.get(row.id); unique.set(row.id, old ? { ...old, ...(old.period === 'carryover' || row.period === 'carryover' ? { period: 'carryover' } : {}), ...(old.keyMaterialId || row.keyMaterialId ? { keyMaterialId: old.keyMaterialId || row.keyMaterialId } : {}), batchCodes: [...new Set([...old.batchCodes, ...row.batchCodes])] } : row); }
  return [...unique.values()].sort((a,b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.id.localeCompare(b.id));
}
@Injectable()
export class ManagementRiskService {
  constructor(private readonly prisma: PrismaService, private readonly execution: ProductionExecutionService, private readonly readiness: ProductionReadinessService) {}
  async read(month: string, productId: string | undefined, actor: ProcActor) {
    executionMonth(month);
    const scopes = managementRiskScopes(actor);
    if (!actor.id || ![scopes.production, scopes.procurement, scopes.orders, scopes.quality].some(Boolean)) throw new ForbiddenException('需要相应生产、采购、订单或质量读取权限');
    const all = scopes.production ? await this.execution.list(month, actor) : [], plans = all.filter(plan => (!productId || plan.productId === productId));
    const risks: ManagementRisk[] = [], batches: { id: string; planId: string; batchId: string | null; product: string; code: string; date: string | null; target: number; remaining: number; current: number | null; onTime: number | null; note: string }[] = [];
    for (const plan of plans) {
      const lifecycleRow = await this.prisma.runtimeState.findUnique({ where: { key: `procurement:lifecycle:v1:plan:${plan.id}` } });
      const lifecycle: LifecycleState | null = lifecycleRow ? JSON.parse(lifecycleRow.value) : null;
      const batchName = (id: string) => plan.batches.find(batch => batch.id === id)?.code ?? '批次待核对';
      const common = { planId: plan.id, product: `${plan.productName} · ${plan.productLine}`, period: plan.month < month ? 'carryover' as const : 'current' as const };
      for (const task of plan.tasks.filter(row => row.status !== 'cancelled')) {
        for (const quality of [...task.inspections.map(row => row.quality), ...(task.fieldIssues ?? []).map(row => row.quality)].filter(Boolean)) {
          if (!quality || quality.status === 'closed') continue;
          risks.push({ ...common, id: `quality:${quality.id}`, kind: 'quality', title: quality.issue || '质量异常待处理', owner: quality.collaboration?.ownerName ?? null, dueDate: quality.collaboration?.dueDate ?? null, taskId: task.id, recordId: quality.id, batchCodes: [batchName(task.batchId)], note: `${quality.defectiveQty} ${quality.unit}不良 · 沿原异常办理` });
        }
        const reported = task.reports.reduce((sum,row) => sum + row.quantity, 0);
        const completed = completionInspections(task).reduce((sum, row) => sum + row.goodQty + (row.verifiedGoodQty ?? 0), 0);
        if (task.date < executionToday() && (reported < task.quantity || completed < task.quantity)) risks.push({ ...common, id: `task:${task.id}`, kind: 'schedule', title: task.name, owner: task.ownerName || null, dueDate: task.date, taskId: task.id, batchCodes: [batchName(task.batchId)], note: `已报 ${reported} / ${task.quantity} ${task.unit} · 合格完成 ${completed}，${reported >= task.quantity ? '待终检或复验' : '作业尚未完成'}` });
      }
      for (const change of lifecycle?.changes ?? []) for (const feedback of change.feedback ?? []) if (feedback.status !== 'resolved') risks.push({ ...common, id: `ecn:${feedback.id}`, kind: 'ecn', title: feedback.problem, owner: feedback.ownerName, dueDate: feedback.dueDate, recordId: change.id, batchCodes: change.batchIds.map(batchName), note: `${change.code} · 执行反馈待处理` });
      for (const batch of plan.batches) {
        try {
          const view = await this.readiness.calculate(this.prisma, plan.id, batch.dueDate, batch.id);
          const gaps = view.lines.filter(row => row.gap === null || row.gap > 0 || row.problems.length);
          const unknown = !view.lines.length || view.currentSets == null || view.projectedSets == null;
          const note = gaps.length ? `${gaps.length} 种物料有缺口或待核对` : unknown ? 'BOM 或齐套依据待核对' : '完整 BOM 已核对';
          batches.push({ ...common, id: batch.id, batchId: batch.id, code: batch.code, date: batch.dueDate, target: batch.quantity, remaining: view.remainingQty, current: view.currentSets == null ? null : Math.min(view.remainingQty, view.currentSets), onTime: view.projectedSets == null ? null : Math.min(view.remainingQty, view.projectedSets), note });
          if (view.remainingQty > 0 && (gaps.length || unknown)) risks.push({ ...common, id: `material:${plan.id}:${batch.id}`, kind: 'material', title: `${batch.code} 齐套待处理`, owner: null, dueDate: batch.dueDate, recordId: batch.id, batchCodes: [batch.code], note: `${note}，请进入原批次确认分配` });
        } catch (error) {
          const remaining = executionSummary({ ...plan, targetQty: batch.quantity, tasks: plan.tasks.filter(task => task.batchId === batch.id) }).remainingQty;
          batches.push({ ...common, id: batch.id, batchId: batch.id, code: batch.code, date: batch.dueDate, target: batch.quantity, remaining, current: null, onTime: null, note: '齐套依据暂未读取成功，请进入原计划核对' });
          if (remaining > 0) risks.push({ ...common, id: `material:${plan.id}:${batch.id}`, kind: 'material', title: `${batch.code} 齐套依据待核对`, owner: null, dueDate: batch.dueDate, recordId: batch.id, batchCodes: [batch.code], note: '读取失败，尚不能判断本批次是否齐套，请进入原计划重新核对' });
        }
      }
      if (!plan.batches.length) batches.push({ ...common, id: plan.id, batchId: null, code: '待分批', date: null, target: plan.targetQty, remaining: plan.summary.remainingQty, current: null, onTime: null, note: '尚未确认批次需求日期' });
    }
    const currentPlans = plans.filter(plan => plan.month === month);
    // The work queue omits completed carryover plans. Their inspections performed this
    // month still belong in this month's first-pass denominator and numerator.
    const history = scopes.production ? await this.prisma.runtimeState.findMany({ where: { key: { startsWith: 'procurement:execution:v1:plan:' } } }) : [];
    const historicalPlans = history.map(row => JSON.parse(row.value) as ExecutionPlan).filter(plan => plan.month <= month);
    const inspectionPlans = historicalPlans.filter(plan => !productId || plan.productId === productId);
    const productsWithFinals = historicalPlans.filter(plan => plan.tasks.some(task => task.output === 'whole' && task.status !== 'cancelled' && task.inspections?.some(row => row.kind === 'final' && row.date.startsWith(`${month}-`))));
    const productNames = new Map([...all, ...productsWithFinals].map(plan => [plan.productId, plan.productName]));
    const supply = await managementSupplyRisks(this.prisma, month, productId, actor, productNames);
    return { month, productId: productId || null, scopes, calculatedAt: new Date().toISOString(), products: [...new Map([...supply.products, ...[...productNames].map(([id, name]) => ({ id, name }))].map(row => [row.id, row])).values()],
      completed: scopes.production ? currentPlans.reduce((sum,plan) => sum + plan.summary.completedQty, 0) : null, remaining: scopes.production ? currentPlans.reduce((sum,plan) => sum + plan.summary.remainingQty, 0) : null,
      firstFinal: scopes.production ? executionFinalInspectionSummary(inspectionPlans.flatMap(plan => plan.tasks.map(task => ({ ...task, inspections: (task.inspections ?? []).filter(row => row.date.startsWith(`${month}-`)) })))) : null,
      batches, risks: uniqueManagementRisks([...risks, ...supply.risks]), notice: '生产、采购、订单及质量按各自原权限读取。当前未闭环记录按所选月份及跨月未完分列，历史月份不是历史状态快照。逾期须有已过期限；独立订单按最新有效供应商承诺或明确标注的 ERP 到货日判断，承诺撤销或来源失效不回退旧日期。订单未收量为 ERP 同步口径。无法精确关联产品的订单仅出现在全部产品。异常按原编号去重，经办或期限未登记时显示待确认；关键物料只标记已确认映射。齐套按各批已确认分配计算，不重复计入未分配库存。' };
  }
}
