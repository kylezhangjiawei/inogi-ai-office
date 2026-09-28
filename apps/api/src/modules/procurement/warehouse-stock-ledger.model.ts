import { Prisma } from '@prisma/client';

export interface StockLedgerRecord {
  id: string; kind: string; status: string; code: string; warehouse: string; unit: string; quantity: number;
  releasedAt?: string; reconciliation?: { at: string }; qualifiedQty?: number; defectiveQty?: number; pendingQty?: number;
}
/** Local restrictions never add stock. A matched voucher alone is not a newer ERP snapshot. */
export function warehouseStockExposure(records: StockLedgerRecord[], code: string, warehouse: string, unit: string, syncedAt: Date | null) {
  let frozen = new Prisma.Decimal(0), scrappedPending = new Prisma.Decimal(0), countReduction = new Prisma.Decimal(0), qualifiedPending = new Prisma.Decimal(0), defectivePending = new Prisma.Decimal(0), inspectionPending = new Prisma.Decimal(0);
  const issues: string[] = [], seen = new Map<string, string>();
  for (const row of records) {
    if (row.code !== code || row.warehouse !== warehouse || row.status !== 'confirmed') continue;
    const fingerprint = JSON.stringify(row);
    if (seen.has(row.id)) { if (seen.get(row.id) !== fingerprint) issues.push(`库存记录 ${row.id} 存在冲突副本`); continue; }
    seen.set(row.id, fingerprint);
    if (row.unit !== unit || !unit) { issues.push(`库存记录 ${row.id} 单位不一致`); continue; }
    if (!row.id || (row.kind !== 'count' && row.quantity < 0) || (row.qualifiedQty ?? 0) < 0 || (row.defectiveQty ?? 0) < 0 || (row.pendingQty ?? 0) < 0 || !Number.isFinite(row.quantity) || !Number.isFinite(row.qualifiedQty ?? 0) || !Number.isFinite(row.defectiveQty ?? 0) || !Number.isFinite(row.pendingQty ?? 0)) { issues.push(`库存记录 ${row.id} 数量无效`); continue; }
    const checked = row.reconciliation ? new Date(row.reconciliation.at) : null;
    const covered = Boolean(checked && Number.isFinite(checked.getTime()) && syncedAt && syncedAt > checked);
    if (row.kind === 'freeze' && !row.releasedAt) frozen = frozen.plus(Math.max(0, row.quantity));
    if (row.kind === 'scrap' && !covered) scrappedPending = scrappedPending.plus(Math.max(0, row.quantity));
    if (row.kind === 'count' && row.quantity < 0 && !covered) countReduction = countReduction.minus(row.quantity);
    if (['receipt', 'return'].includes(row.kind) && !covered) {
      qualifiedPending = qualifiedPending.plus(Math.max(0, row.qualifiedQty ?? 0));
      defectivePending = defectivePending.plus(Math.max(0, row.defectiveQty ?? 0));
      inspectionPending = inspectionPending.plus(Math.max(0, row.pendingQty ?? 0));
    }
  }
  return { frozen: frozen.toNumber(), scrappedPending: scrappedPending.toNumber(), frozenAndScrappedPending: frozen.plus(scrappedPending).toNumber(), countReduction: countReduction.toNumber(), qualifiedPending: qualifiedPending.toNumber(), defectivePending: defectivePending.toNumber(), inspectionPending: inspectionPending.toNumber(), issues };
}

export interface StockIssueSource { id: string; status: string; lines: { code: string; unit: string }[]; history: { id: string; action: string; at: string; lines?: { code: string; warehouse?: string; quantity: number }[]; reconciliation?: { eventId: string; result: string } }[] }
export function pendingWarehouseIssues(sources: StockIssueSource[], code: string, warehouse: string, unit: string, syncedAt: Date | null) {
  let quantity = new Prisma.Decimal(0); const issues: string[] = [], seen = new Map<string, string>();
  for (const source of sources) for (const event of source.history.filter(row => row.action === 'issue')) {
    const latest = [...source.history].reverse().find(row => row.action === 'reconcile' && row.reconciliation?.eventId === event.id);
    const covered = latest?.reconciliation?.result === 'matched' && syncedAt && syncedAt > new Date(latest.at);
    for (const row of event.lines ?? []) if (row.code === code && row.warehouse === warehouse) {
      const key = `${source.id}:${event.id}:${code}:${warehouse}`;
      const fingerprint = JSON.stringify([row, source.lines.find(line => line.code === code)?.unit, latest?.reconciliation, latest?.at]);
      if (seen.has(key)) { if (seen.get(key) !== fingerprint) issues.push(`发料记录 ${source.id}/${event.id} 存在冲突副本`); continue; }
      seen.set(key, fingerprint);
      if (covered) continue;
      if (source.lines.find(line => line.code === code)?.unit !== unit || !Number.isFinite(row.quantity) || row.quantity < 0) issues.push(`发料记录 ${source.id} 单位或数量待核对`);
      else quantity = quantity.plus(row.quantity);
    }
  }
  return { quantity: quantity.toNumber(), issues };
}
