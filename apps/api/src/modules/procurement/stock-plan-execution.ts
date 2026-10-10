import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { calculatePurchaseFulfillment, fulfillmentStateKey } from './purchase-fulfillment.model';
import { fulfillmentReceiptInclude, parseFulfillmentState } from './purchase-fulfillment.service';

export function stockTaskStage(quantity: number, ordered: number | null, signed: number | null) {
  if (ordered === null || signed === null) return '待核对';
  if (signed >= Math.max(quantity, ordered)) return '已到货';
  if (signed > 0) return '部分到货';
  if (ordered > 0) return '在途';
  return '待下单';
}
/** Local signatures and ERP receipt totals overlap: use one source, never add them. */
export function signedArrival(summary: ReturnType<typeof calculatePurchaseFulfillment>, hasLocalReceipts: boolean) {
  return summary.effectiveOrderedQty === null ? null : hasLocalReceipts ? summary.localNetReceivedQty : summary.effectiveReceivedQty;
}
export async function readStockPlanExecution(db: Prisma.TransactionClient, id: string) {
  const plan = await db.procStockPlan.findUnique({ where: { id }, include: { tasks: { include: { purchaseOrderRefs: true, material: true }, orderBy: { createdAt: 'asc' } } } });
  if (!plan) throw new NotFoundException('备货任务单不存在');
  const refs = plan.tasks.flatMap(task => task.purchaseOrderRefs.filter(ref => ref.tpOrderNo));
  const orderNos = [...new Set(refs.map(ref => ref.tpOrderNo))];
  const mirrors = orderNos.length ? await db.procPurchaseOrderMirror.findMany({ where: { tpOrderNo: { in: orderNos } }, include: { receipts: { include: fulfillmentReceiptInclude } } }) : [];
  const allRefs = orderNos.length ? await db.procPurchaseOrderRef.findMany({ where: { tpOrderNo: { in: orderNos } }, select: { taskId: true, tpOrderNo: true, tpLineNo: true } }) : [];
  const stored = mirrors.length ? await db.runtimeState.findMany({ where: { key: { in: mirrors.map(m => fulfillmentStateKey(m.id)) } } }) : [];
  const states = new Map(stored.map(row => [row.key, row.value]));
  const tasks = plan.tasks.map(task => {
    const used = new Set<string>();
    const orders = task.purchaseOrderRefs.filter(ref => ref.tpOrderNo).map(ref => {
      const matches = mirrors.filter(m => m.tpOrderNo === ref.tpOrderNo && (!ref.tpLineNo || m.tpLineNo === ref.tpLineNo) && (task.material?.tpInventoryCode ? m.inventoryCode === task.material.tpInventoryCode : m.materialId === task.materialId));
      const line = matches.length === 1 ? matches[0] : null;
      const issue = !line ? '订单行或物料关联不明确' : line.unit !== task.unit ? '订单与任务单位不一致' : used.has(line.id) || allRefs.some(other => other.taskId !== task.id && other.tpOrderNo === line.tpOrderNo && (!other.tpLineNo || other.tpLineNo === line.tpLineNo)) ? '订单行被重复关联，须明确分配' : null;
      if (line) used.add(line.id);
      const summary = line && !issue ? calculatePurchaseFulfillment(line, line.receipts, parseFulfillmentState(states.get(fulfillmentStateKey(line.id)))) : null;
      return { orderNo: ref.tpOrderNo, lineId: line?.id ?? null, lineNo: line?.tpLineNo ?? ref.tpLineNo,
        orderedQty: summary?.effectiveOrderedQty ?? null, signedQty: summary && line ? signedArrival(summary, line.receipts.length > 0) : null,
        source: line?.receipts.length ? '本地签收' : 'ERP 到货', issues: issue ? [issue] : summary?.issues ?? [],
        erpReceivedQty: line ? Number(line.receivedQty) : null };
    });
    const total = (key: 'orderedQty' | 'signedQty') => orders.some(row => row[key] === null) ? null : orders.reduce((sum, row) => sum.plus(row[key]!), new Prisma.Decimal(0)).toNumber();
    const orderedQty = total('orderedQty'), signedQty = total('signedQty');
    return { id: task.id, code: task.code, materialId: task.materialId, materialName: task.materialName, inventoryCode: task.material?.tpInventoryCode ?? null, unit: task.unit,
      quantity: Number(task.quantity), status: task.status, stage: task.status === 'cancelled' ? '已取消' : stockTaskStage(Number(task.quantity), orderedQty, signedQty), orderedQty, signedQty,
      inTransitQty: orderedQty === null || signedQty === null ? null : Math.max(0, orderedQty - signedQty), orders };
  });
  return { planId: id, tasks };
}
