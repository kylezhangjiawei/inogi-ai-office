import type { PrismaService } from '../../prisma/prisma.service';
import type { ProcActor } from './procurement.types';
import type { ManagementRisk } from './management-risk.service';
import { deliveryDay, deliveryKey, parseDeliveryState, type SupplierDeliveryState } from './purchase-delivery-store';
import { purchaseTiming } from './purchase-timing';
import { isVoidedOrderStatus } from './replenish-core';
import { executionToday } from './production-execution.model';
import { KEY_MATERIAL_CLUES } from './key-material-clues';
import type { KeyMaterialMapping } from './key-materials.service';

export function managementRiskScopes(actor: ProcActor) {
  const has = (...values: string[]) => actor.permissions.includes('*') || values.some(value => actor.permissions.includes(value));
  const production = has('*') || (has('page:production-execution') && has('production:plan', 'production:view-all'));
  return { production, procurement: has('page:proc-cockpit'), orders: has('page:purchase-orders', 'page:purchase-order-detail'),
    quality: production || has('proc-quality:manage', 'proc-quality:verify', 'page:proc-cockpit', 'page:rd-director-dashboard'),
    keyMaterials: has('page:proc-key-materials') };
}

/** Current unresolved source records, bounded by the selected business month, not a historical snapshot. */
export async function managementSupplyRisks(db: PrismaService, month: string, productId: string | undefined, actor: ProcActor, names: Map<string, string>) {
  const scope = managementRiskScopes(actor), today = executionToday(), start = `${month}-01`;
  const end = new Date(`${start}T00:00:00.000Z`); end.setUTCMonth(end.getUTCMonth() + 1);
  const endDay = end.toISOString().slice(0, 10), overdueBefore = endDay < today ? endDay : today;
  const [tasks, orders, quality] = await Promise.all([
    scope.procurement ? db.procTask.findMany({ where: { createdAt: { lt: end } }, select: { id: true, code: true, productId: true, materialId: true, materialName: true, unit: true, quantity: true, arrivedQty: true, status: true, businessDone: true, buyer: true, deadline: true, needDate: true, expectedArrivalDate: true,
      purchaseOrderRefs: { select: { tpOrderNo: true, tpOrderId: true, tpLineNo: true } } } }) : [],
    scope.orders ? db.procPurchaseOrderMirror.findMany({ where: { OR: [{ orderDate: { lt: end } }, { orderDate: null }] }, include: { availability: true } }) : [],
    scope.quality ? db.procQualityRecord.findMany({ where: { status: { not: 'closed' }, inspectionDate: { lt: end, lte: new Date(`${today}T00:00:00.000Z`) } }, select: { id: true, productId: true, materialId: true, taskId: true, source: true, issue: true, batchNo: true, inspectionDate: true, defectiveQty: true, unit: true, status: true } }) : [],
  ]);
  const stateKeys = [...orders.map(row => deliveryKey('supplier', row.id)), ...quality.map(row => `procurement:execution:v1:collaboration:${row.id}`),
    ...(scope.keyMaterials ? KEY_MATERIAL_CLUES.map(row => `procurement:key-materials:v1:current:${row.id}`) : [])];
  const stored = stateKeys.length ? await db.runtimeState.findMany({ where: { key: { in: stateKeys } } }) : [];
  const state = new Map(stored.map(row => [row.key, row.value]));
  const keyMaterials = new Set<string>();
  if (scope.keyMaterials) for (const clue of KEY_MATERIAL_CLUES) {
    const value = state.get(`procurement:key-materials:v1:current:${clue.id}`);
    const mapping: KeyMaterialMapping | null = value ? JSON.parse(value) : null;
    if (mapping?.inclusion === 'included') mapping.materialIds.forEach(id => keyMaterials.add(id));
  }
  const productIds = new Set([...tasks.map(row => row.productId), ...quality.map(row => row.productId)].filter(Boolean));
  if (productIds.size) {
    const catalog = await db.systemSetting.findUnique({ where: { key: 'rd.products' }, select: { value: true } });
    if (Array.isArray(catalog?.value)) for (const row of catalog.value) {
      if (row && typeof row === 'object' && !Array.isArray(row) && typeof row.id === 'string' && typeof row.name === 'string' && row.name.trim() && productIds.has(row.id) && !names.has(row.id)) names.set(row.id, row.name);
    }
  }
  const productName = (ids: string[]) => ids.length ? ids.map(id => names.get(id) || '产品名称待确认').join('、') : '产品归属待确认';
  const context = (materialId: string | null, date: string | null) => ({ ...(materialId && keyMaterials.has(materialId) ? { keyMaterialId: materialId } : {}), period: date && date < start ? 'carryover' as const : 'current' as const });
  const risks: ManagementRisk[] = [], orderRiskTasks = new Set<string>();
  for (const row of orders) {
    const ordered = Number(row.orderedQty), received = Number(row.receivedQty);
    if (!row.tpOrderNo.trim() || !row.tpLineNo.trim() || !Number.isFinite(ordered) || !Number.isFinite(received) || ordered <= 0 || received < 0 || received >= ordered || isVoidedOrderStatus(row.status, row.approvalStatus)) continue;
    const timing = purchaseTiming(row, row.availability, parseDeliveryState<SupplierDeliveryState>(state.get(deliveryKey('supplier', row.id))));
    // Withdrawal / stale source deliberately leaves latestDate unknown; never revive ERP's old date.
    if (!timing.latestDate || timing.latestDate >= overdueBefore) continue;
    const linked = tasks.filter(task => task.materialId && task.materialId === row.materialId && task.purchaseOrderRefs.some(ref => ref.tpOrderNo === row.tpOrderNo && ref.tpLineNo === row.tpLineNo && (!ref.tpOrderId || !row.tpOrderId || ref.tpOrderId === row.tpOrderId)));
    const ids = [...new Set(linked.map(task => task.productId))];
    if (productId && !ids.includes(productId)) continue;
    linked.forEach(task => orderRiskTasks.add(task.id));
    risks.push({ id: `purchase-order:${row.id}`, kind: 'purchase-order', title: `${row.tpOrderNo} · ${row.inventoryName || row.inventoryCode}`, owner: null, dueDate: timing.latestDate,
      recordId: row.id, batchCodes: [], product: productName(ids), ...context(row.materialId, timing.latestDate),
      target: { type: 'purchase-order', orderNo: row.tpOrderNo, lineId: row.id },
      note: `第 ${row.tpLineNo} 行 · ERP 未收 ${ordered - received} ${row.unit} · ${timing.latestSource === 'supplier' ? '供应商最新承诺' : 'ERP 预计到货'}已过期；ERP 同步收货口径${row.syncedAt ? `（${deliveryDay(row.syncedAt)}）` : '，同步时间待确认'}` });
  }
  for (const row of tasks) {
    if ((productId && row.productId !== productId) || row.businessDone || ['completed', 'cancelled'].includes(row.status)) continue;
    const arrival = ['in_transit', 'partial_arrival'].includes(row.status);
    const date = deliveryDay(arrival ? row.expectedArrivalDate : row.deadline ?? row.needDate);
    if (!date || date >= overdueBefore || (arrival && (!Number.isFinite(Number(row.quantity)) || !Number.isFinite(Number(row.arrivedQty)) || Number(row.quantity) <= 0 || Number(row.arrivedQty) < 0 || Number(row.arrivedQty) >= Number(row.quantity) || orderRiskTasks.has(row.id)))) continue;
    risks.push({ id: `procurement:${row.id}`, kind: 'procurement', title: `${row.code} · ${row.materialName}`, owner: row.buyer.trim() || null, dueDate: date, recordId: row.id,
      batchCodes: [], product: productName([row.productId]), ...context(row.materialId, date), target: { type: 'procurement', taskId: row.id },
      note: arrival ? `预计到货已过期 · 已到 ${Number(row.arrivedQty)} / ${Number(row.quantity)} ${row.unit}` : `${row.deadline ? '办理截止' : '需求日期'}已过期 · 原采购任务尚未完成` });
  }
  for (const row of quality) {
    if (productId && row.productId !== productId) continue;
    const value = state.get(`procurement:execution:v1:collaboration:${row.id}`);
    const collaboration = value ? JSON.parse(value) as { ownerName?: string; dueDate?: string } : null;
    risks.push({ id: `quality:${row.id}`, kind: 'quality', title: row.issue || '质量异常待处理', owner: collaboration?.ownerName?.trim() || null, dueDate: collaboration?.dueDate || null,
      recordId: row.id, batchCodes: row.batchNo ? [row.batchNo] : [], product: productName([row.productId]), ...context(row.materialId, deliveryDay(row.inspectionDate)),
      target: { type: 'quality', qualityId: row.id }, note: `${({ procurement: '来料', production: '生产', warehouse: '仓库', after_sales: '售后' } as Record<string, string>)[row.source] || '原记录'}异常 · ${Number(row.defectiveQty)} ${row.unit}不良 · 当前未闭环` });
  }
  return { risks, products: [...productIds].map(id => ({ id, name: names.get(id) || '产品名称待确认' })) };
}
