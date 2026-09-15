export const syncedAt = '2026-09-14T02:00:00.000Z';
export const user = {
  id: 'qa-s14-reader', name: '订单阅读验证员', email: 's14@example.invalid', role: 'procurement',
  department: '隔离验证', permissions: ['page:purchase-orders', 'page:purchase-order-detail', 'page:audit-log'],
};
const line = (orderId, index, name, unit, qty, receivedQty) => ({
  id: `${orderId}-line-${index}`, lineNo: String(index), sku: `QA-S14-${orderId}-${index}`,
  name, spec: '隔离验证规格 · 不关联真实物料', unit, qty, receivedQty, unitPrice: 10,
  etaDate: '2026-09-18', sourceUpdatedAt: syncedAt, availability: null,
});
function order(id, items, status = '部分到货') {
  return {
    id, poNo: id, supplier: '隔离供应商 · 本地内存数据', buyer: user.name, owner: '采购隔离验证', status,
    orderDate: '2026-09-10', etaDate: '2026-09-18', itemCount: items.length,
    amount: items.reduce((total, item) => total + item.qty * item.unitPrice, 0), currency: 'CNY',
    warehouse: '隔离仓库', paymentTerm: '未提供', approvalStatus: '已审批（隔离验证）',
    sourceFile: 'S14 本地内存夹具', syncedAt,
    remark: '仅验证订单阅读与数量口径，业务写请求全部拒绝。ERP 到货不代表检验合格。',
    items, taskLinks: [],
  };
}
export const orders = {
  'QA-S14-OVER': order('QA-S14-OVER', [
    line('QA-S14-OVER', 1, '阀体甲 · 超收 10 件', '件', 10, 20),
    line('QA-S14-OVER', 2, '阀体乙 · 尚欠 10 件', '件', 10, 0),
  ]),
  'QA-S14-MIXED': order('QA-S14-MIXED', [
    line('QA-S14-MIXED', 1, '阀体 · 部分到货', '件', 10, 4),
    line('QA-S14-MIXED', 2, '软管 · 超收', '米', 5, 6),
    line('QA-S14-MIXED', 3, '装配套件 · 收齐', '套', 2, 2),
    line('QA-S14-MIXED', 4, '零订购数量样品 · 待核对', '套', 0, 1),
    line('QA-S14-MIXED', 5, '缺少单位的旧物料 · 待核对', '', 10, 3),
  ]),
  'QA-S14-EMPTY': order('QA-S14-EMPTY', [], '已下单'),
};

export function receiptLedger(lineId) {
  const sourceOrder = Object.values(orders).find((value) => value.items.some((item) => item.id === lineId));
  const item = sourceOrder?.items.find((value) => value.id === lineId);
  if (!sourceOrder || !item) return null;
  const eligible = item.qty > 0 && Boolean(item.unit);
  const receivedQty = eligible ? item.receivedQty : 0;
  const quantities = { receivedQty, qualifiedQty: 0, defectiveQty: 0, pendingJudgmentQty: 0, pendingQty: receivedQty };
  const source = {
    orderId: sourceOrder.id, orderNo: sourceOrder.poNo, lineNo: item.lineNo, inventoryCode: item.sku,
    inventoryName: item.name, spec: item.spec, unit: item.unit, supplierName: sourceOrder.supplier,
    orderedQty: item.qty, updatedAt: item.sourceUpdatedAt,
  };
  return {
    line: { ...source, id: item.id, tpOrderId: sourceOrder.id, erpReceivedQty: item.receivedQty,
      status: sourceOrder.status, approvalStatus: sourceOrder.approvalStatus },
    canReceive: false, canInspect: false,
    sourceIssue: eligible ? null : '本行订购数量或计量单位待核对，仅保留订单来源。',
    summaryUnit: item.unit, summary: quantities,
    receipts: receivedQty > 0 ? [{
      id: `receipt-${item.id}`, deliveryNo: `QA-DELIVERY-${sourceOrder.id}-${item.lineNo}`,
      receivedDate: '2026-09-13', note: '同一订单行的隔离只读收货记录，尚未检验。',
      createdByName: '隔离收货员', createdAt: syncedAt, sourceChanged: false, version: 0,
      source, ...quantities, inspections: [],
    }] : [],
  };
}
