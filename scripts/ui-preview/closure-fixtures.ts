// Local, memory-only UI fixtures. Never import a database or production service here.
import type { WorkbenchResponse } from '../../src/app/lib/orderProcessingApi';
const stamp = '2026-09-22T09:00:00.000Z';
let mapped = false;
let bound = false;
let revision: Record<string, unknown> | null = null;
export const syntheticWritePaths = new Set([
  '/api/order-processing/orders/PREVIEW-ORDER/lines/preview-line/material-mapping',
  '/api/procurement/bom-devices/preview-device/bind', '/api/procurement/bom-devices/preview-device/publish',
  '/api/procurement/bom-devices/revisions/preview-revision/retire',
]);
export function closureFixture(path: string, search: URLSearchParams, scenario = ''): unknown {
  if (path === '/api/procurement/warehouse-flow') return { canIssue: true, canReconcile: true, balances: [], items: [1, 2].map(i => ({ id: `PREVIEW-ISS-${i}`, version: 1, status: 'partial', planId: 'PREVIEW-PLAN', taskId: `PREVIEW-TASK-${i}`, productLine: 'PREVIEW-Q5', title: `验收派工 ${i}`, neededDate: '2026-09-20', recipientId: 'preview-user', recipientName: '验收人员', lines: [{ code: `PREVIEW-MAT-${i}`, name: `虚构物料 ${i}`, unit: '件', quantity: 10, issuedQty: 4, signedQty: 4, signedBatches: [{ batchNo: 'PREVIEW-BATCH', quantity: 4 }] }], history: [] })) };
  if (path === '/api/procurement/warehouse-records') return { receipts: [], balances: [], records: [1, 2].map(i => ({ id: `PREVIEW-RET-${i}`, version: 1, kind: 'return', status: 'pending', code: `PREVIEW-MAT-${i}`, name: `虚构物料 ${i}`, unit: '件', warehouse: '隔离区', batch: 'PREVIEW-BATCH', date: '2026-09-23', quantity: 1, qualifiedQty: 0, defectiveQty: 1, pendingQty: 0, actorId: 'preview-user', actorName: '验收人员', sourceId: `PREVIEW-ISS-${i}`, taskId: `PREVIEW-TASK-${i}`, planId: 'PREVIEW-PLAN', events: [] })) };
  if (scenario === 'bom-flow' && path === '/api/procurement/bom-devices/preview-device/revisions') return { deviceId: 'preview-device', productRootId: bound ? 'preview-root' : null, draftFingerprint: 'd'.repeat(64), snapshotFingerprint: 'd'.repeat(64), issue: bound ? null : '请先确认设备的产品归属', products: [{ id: 'preview-root', name: '验收产品' }], revisions: revision ? [revision] : [] };
  if (path === '/api/integration-management/mailboxes') return { items: [], total: 0, page: 1, pageSize: 100, totalPages: 1 };
  if (path === '/api/order-processing/material-options') return { materials: [{ id: 'preview-material', name: '验收阀体', spec: '合成测试规格', unit: '件', tpInventoryCode: 'PREVIEW-VALVE' }], warehouses: ['成品仓', '未同步仓'] };
  if (path === '/api/order-processing/workbench') {
    const warehouses = (search.get('warehouses') || '').split('|').filter(Boolean);
    const isMapped = mapped || scenario === 'zero';
    const known = isMapped && warehouses.length > 0 && !warehouses.includes('未同步仓') && scenario !== 'stale';
    const quantity = scenario === 'zero' ? 0 : 2;
    const item = { id: 'CUSTOMER-VALVE', lineId: 'preview-line', name: '验收阀体', category: '合成测试', spec: '合成测试规格', unit: '件', orderQty: 3, stockQty: 999, orderPrice: '10.00', sysPrice: '10.00', subtotal: '30.00', status: '库存待核对' as const, remark: '原始识别记录仅供追溯',
      stockCheck: { lineId: 'preview-line', materialId: isMapped ? 'preview-material' : null, mappingState: scenario === 'stale' ? 'stale' as const : isMapped ? 'confirmed' as const : 'unmatched' as const, stockState: known ? 'known' as const : 'unknown' as const, availableQty: known ? quantity : null, sufficient: known ? false : null, issues: known ? [] : [scenario === 'stale' ? '原核对依据或物料已变化，请重新核对' : !warehouses.length ? '请选择可出货仓库' : !isMapped ? '订单商品尚未关联正式物料' : '仓库没有有效 ERP 同步时间'], checkedAt: stamp, scope: { kind: 'selected', warehouses }, sourceFingerprint: 'a'.repeat(64), updatedAt: stamp, warehouses: warehouses.map(warehouse => ({ warehouse, available: known ? quantity : null, syncedAt: warehouse === '未同步仓' ? null : stamp })) } };
    const order = { id: 'PREVIEW-ORDER', customer: '虚构验收客户', type: 'warning' as const, status: '待人工确认', date: '09-22', source: 'upload' as const, generated: false, invoiceExported: false, createdAt: stamp };
    return { stats: { pending: 1, abnormal: 1, generated: 0, unexported: 0 }, wecomMail: { connected: false, enabled: false, message: '沙箱未连接邮箱' }, queue: { items: [order], page: 1, pageSize: 6, total: 1, totalPages: 1 }, selectedOrder: order,
      orderDetails: { id: order.id, customer: order.customer, orderId: order.id, date: '2026-09-22', amount: '¥30.00', invoiceNo: '', products: [item] }, productRows: { items: [item], page: 1, pageSize: 12, total: 1, totalPages: 1 }, templates: [{ id: 'generic', name: '通用模板', source: 'builtin' }], activeTemplateId: 'generic', reminderRule: { enabled: false, daysBefore: 3 } } satisfies WorkbenchResponse;
  }
  if (path === '/api/procurement/production-execution/preview-plan/readiness') {
    const unknown = scenario === 'unknown';
    return { planId: 'preview-plan', planVersion: 1, sourceToken: 'synthetic', bomFingerprint: 'synthetic', month: '2026-09', targetQty: 100, completedQty: 0, remainingQty: 100, date: '2026-09-30', currentSets: unknown ? null : 45, projectedSets: unknown ? null : 45, history: [],
      lines: [{ id: 'preview-material', code: 'PREVIEW-VALVE', name: '验收阀体', unit: '件', qtyPer: 1, demand: 100, remainingDemand: 100, warehouse: unknown ? null : 45, warehousePending: 15, otherReserved: 20, ownReserved: 0, lineQty: 0, incoming: 0, current: unknown ? null : 45, projected: unknown ? null : 45, gap: unknown ? null : 55, problems: unknown ? ['ERP 同步时间缺失，当前可用量待核对'] : [], lineSide: [], purchase: [], stockReadAt: stamp, stockRows: [{ warehouse: '量产仓', available: unknown ? null : 65, unit: '件', syncedAt: unknown ? null : stamp }] }] };
  }
  return undefined;
}
export function closureWrite(path: string, method: string, body: Record<string, unknown>, scenario: string) {
  if (method === 'POST' && scenario === 'bom-flow' && path.startsWith('/api/procurement/bom-devices/') && syntheticWritePaths.has(path)) {
    if (!String(body.reason || '').trim()) return { status: 400, body: { message: '请填写合成核对依据' } };
    if (path.endsWith('/bind')) bound = body.productRootId === 'preview-root';
    if (path.endsWith('/publish')) { if (!bound) return { status: 409, body: { message: '请先确认归属' } }; revision = { id: 'preview-revision', version: 1, fingerprint: 'd'.repeat(64), publishedAt: stamp, publishedByName: '验收用户', retiredAt: null, reason: body.reason, snapshot: { items: [{ id: 'preview-material', code: 'PREVIEW-VALVE', name: '验收阀体', qtyPer: 2, unit: '件' }] } }; }
    if (path.endsWith('/retire') && revision) revision.retiredAt = stamp;
    return { status: 200, body: { saved: true } };
  }
  if (method !== 'POST' || path !== '/api/order-processing/orders/PREVIEW-ORDER/lines/preview-line/material-mapping') return undefined;
  if (scenario === 'conflict') return { status: 409, body: { message: '合成冲突：订单来源已变化，请保留草稿并刷新依据' } };
  if (scenario === 'reader') return { status: 403, body: { message: '合成只读账号，不允许核对' } };
  if (body.materialId !== 'preview-material' || !String(body.reason || '').trim()) return { status: 400, body: { message: '请核对合成物料并填写依据' } };
  mapped = true;
  return { status: 200, body: { saved: true } };
}
