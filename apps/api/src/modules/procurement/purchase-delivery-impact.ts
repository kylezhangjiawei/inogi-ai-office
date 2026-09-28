import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { batchScopeId } from './readiness-scope';
import { executionDay, executionToday, type ExecutionPlan } from './production-execution.model';
import type { ProductionReadinessService } from './production-readiness.service';
import type { ReadinessPurchaseLedger } from './readiness-purchase-allocation.model';

/** Only explicit, current allocation records establish a relationship to this order line. */
export async function purchaseDeliveryImpacts(db: Prisma.TransactionClient, readiness: Pick<ProductionReadinessService, 'calculate'>, line: { id: string; tpOrderNo: string; inventoryCode: string; unit: string }, requestedPage: number) {
  const stored = await db.runtimeState.findUnique({ where: { key: `procurement:readiness:v1:purchase:${line.id}` } });
  const ledger: ReadinessPurchaseLedger | null = stored ? JSON.parse(stored.value) : null;
  if (ledger && (!Array.isArray(ledger.allocations) || ledger.allocations.some(row => !row.planId || !Number.isFinite(row.quantity) || row.quantity < 0) || new Set(ledger.allocations.map(row => row.planId)).size !== ledger.allocations.length)) throw new ConflictException('原采购分配记录异常，请核对后重新读取');
  const allocations = ledger?.allocations.filter(row => row.quantity > 0) ?? [];
  const plans: ExecutionPlan[] = allocations.length ? (await db.runtimeState.findMany({ where: { key: { startsWith: 'procurement:execution:v1:plan:' } } })).map(row => JSON.parse(row.value)) : [];
  const scopes = new Map(plans.flatMap(plan => [{ id: plan.id, plan, batch: null as ExecutionPlan['batches'][number] | null }, ...(plan.batches ?? []).map(batch => ({ id: batchScopeId(plan.id, batch.id), plan, batch }))]).map(row => [row.id, row]));
  const matched = allocations.flatMap(allocation => { const scope = scopes.get(allocation.planId); return scope ? [{ ...scope, allocation }] : []; });
  const pageSize = 10, total = matched.length, totalPages = Math.max(1, Math.ceil(total / pageSize)), page = Math.min(requestedPage, totalPages);
  const items = await Promise.all(matched.sort((a, b) => a.plan.month.localeCompare(b.plan.month) || a.id.localeCompare(b.id)).slice((page - 1) * pageSize, page * pageSize).map(async ({ plan, batch, allocation, id }) => {
    let needDate: string | null = null;
    try { if (batch?.dueDate) needDate = executionDay(batch.dueDate, '批次需求日'); } catch { /* legacy invalid dates stay unknown */ }
    const base = { scopeId: id, planId: plan.id, month: plan.month, productName: plan.productName, productLine: plan.productLine, batchId: batch?.id ?? null, batchCode: batch?.code ?? null, needDate, unit: line.unit, assignedQty: allocation.quantity };
    try {
      // A monthly allocation does not carry one demand date. Today is used only to
      // revalidate its supply source; no monthly on-time result is inferred from it.
      const view = await readiness.calculate(db, plan.id, needDate ?? executionToday(), batch?.id);
      const material = view.lines.find(row => row.code === line.inventoryCode), order = material?.purchase.find(row => row.id === line.id);
      const known = Boolean(order && order.canAllocate && order.allocationStatus === 'confirmed' && Number.isFinite(order.allocatedQty));
      const effectiveQty = known ? order!.allocatedQty : null, availableDate = order?.date ?? null;
      const delayDays = needDate && availableDate ? Math.max(0, Math.round((Date.parse(availableDate) - Date.parse(needDate)) / 86400000)) : null;
      const onTimeQty = effectiveQty !== null && needDate && availableDate ? availableDate <= needDate ? effectiveQty : 0 : null;
      return { ...base, availableDate, effectiveQty, onTimeQty, delayDays, status: !known || !needDate || !availableDate ? 'pending' as const : delayDays! > 0 ? 'late' as const : 'on_time' as const,
        note: [!batch ? '整月分配未指定唯一需求日，请进入计划选择批次核对。' : '', order?.note || '该物料或订单已不在当前计划依据中，请重新核对原分配。'].filter(Boolean).join(' ') };
    } catch {
      return { ...base, availableDate: null, effectiveQty: null, onTimeQty: null, delayDays: null, status: 'pending' as const, note: '当前齐套依据读取失败，请进入原计划重新核对。' };
    }
  }));
  return { lineId: line.id, orderNo: line.tpOrderNo, page, pageSize, total, totalPages, items, unresolvedCount: allocations.length - matched.length, readAt: new Date().toISOString(),
    notice: '仅列出本订单行当前仍保留分配的计划与批次。未分配的潜在需求不在本表；数量按当前齐套依据核对，各范围请分别查看。' };
}
