import type { WarehouseRecord } from './warehouse-records.service';
import type { WarehouseIssue } from './warehouse-flow.service';
export function warehouseInventoryMovements(records: WarehouseRecord[], issues: WarehouseIssue[]) {
  const rows = records.flatMap(row => row.events.map((event, index) => ({
    id: `${row.id}:${index}`, itemId: row.code, itemName: row.name, type: (row.kind === 'receipt' || row.kind === 'return' ? 'in' : 'adjust') as 'in' | 'out' | 'adjust',
    qty: row.quantity, unit: row.unit, time: event.at, operator: event.actorName, note: event.reason, warehouse: row.warehouse,
    stockBatchNo: row.stockBatchNo ?? null, state: row.releasedAt ? '冻结已解除' : row.kind === 'freeze' ? '冻结中' : row.kind === 'scrap' ? '报废' : row.status === 'confirmed' ? '已确认' : row.status === 'cancelled' ? '已撤销' : '待办理',
    action: event.action, recordId: row.id, documentNo: row.reconciliation?.voucher, qualifiedQty: row.qualifiedQty, defectiveQty: row.defectiveQty, pendingQty: row.pendingQty,
  })));
  const issuesRows = issues.flatMap(issue => issue.history.filter(event => event.action === 'issue' || event.action === 'sign').flatMap(event => (event.lines ?? []).map(line => ({
    id: `${issue.id}:${event.id}:${line.code}`, itemId: line.code, itemName: issue.lines.find(row => row.code === line.code)?.name ?? line.code, type: 'out' as const,
    qty: line.quantity, unit: issue.lines.find(row => row.code === line.code)?.unit ?? '', time: event.at, operator: event.actorName, note: event.reason,
    warehouse: line.warehouse, stockBatchNo: line.batches?.map(row => `${row.batchNo} × ${row.quantity}`).join(' / ') || null,
    batchPendingQty: line.batchPendingQty ?? (line.batches?.length ? 0 : line.quantity), state: event.action === 'issue' ? '已发料' : '已签收', action: event.action, issueId: issue.id,
  }))));
  return [...rows, ...issuesRows].sort((a, b) => b.time.localeCompare(a.time));
}
