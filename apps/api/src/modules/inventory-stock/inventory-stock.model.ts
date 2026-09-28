import { Prisma } from '@prisma/client';
import { pendingWarehouseIssues, warehouseStockExposure, type StockIssueSource, type StockLedgerRecord } from '../procurement/warehouse-stock-ledger.model';

export type StockScope = { kind: 'all' } | { kind: 'production' } | { kind: 'selected'; warehouses: string[] };
export type StockQuery = { codes: string[]; scope: StockScope };
export type StockRow = {
  code: string; warehouse: string; unit: string; bookQty: number | null; erpAvailable: number | null; available: number | null;
  pendingIssue: number; restriction: number; frozen: number; scrappedPending: number; countReduction: number;
  qualifiedPending: number; defectivePending: number; inspectionPending: number;
  syncedAt: string | null; state: 'known' | 'unknown'; issues: string[];
};
export type StockSnapshot = { readAt: string; sourceToken: string; scope: StockScope; rows: StockRow[]; missingCodes: string[] };
export type StockBalance = { tpInventoryCode: string; warehouse: string; unit: string; stockQty: Prisma.Decimal; availableQty: Prisma.Decimal; syncedAt: Date | null };

export function calculateStockRow({ balance, records, issues }: { balance: StockBalance; records: StockLedgerRecord[]; issues: StockIssueSource[] }): StockRow {
  const { tpInventoryCode: code, warehouse, unit, syncedAt } = balance;
  const exposure = warehouseStockExposure(records, code, warehouse, unit, syncedAt);
  const pending = pendingWarehouseIssues(issues, code, warehouse, unit, syncedAt);
  const problems = [...exposure.issues, ...pending.issues];
  if (!unit?.trim()) problems.push(`${code}/${warehouse} 缺少库存单位`);
  if (!syncedAt || !Number.isFinite(syncedAt.getTime())) problems.push(`${code}/${warehouse} 缺少有效 ERP 同步时间`);
  const book = new Prisma.Decimal(balance.stockQty), erp = new Prisma.Decimal(balance.availableQty);
  if (!book.isFinite() || !erp.isFinite() || book.lt(0) || erp.lt(0) || book.lt(erp)) problems.push(`${code}/${warehouse} ERP 账面或可用数量无效`);
  const available = erp.minus(exposure.frozenAndScrappedPending).minus(exposure.countReduction).minus(pending.quantity);
  if (available.lt(0)) problems.push(`${code}/${warehouse} 扣除待覆盖记录后为负，须核对库存差异`);
  return { code, warehouse, unit, bookQty: book.isFinite() ? book.toNumber() : null, erpAvailable: erp.isFinite() ? erp.toNumber() : null,
    available: problems.length ? null : available.toNumber(), pendingIssue: pending.quantity, restriction: exposure.frozenAndScrappedPending,
    frozen: exposure.frozen, scrappedPending: exposure.scrappedPending, countReduction: exposure.countReduction,
    qualifiedPending: exposure.qualifiedPending, defectivePending: exposure.defectivePending, inspectionPending: exposure.inspectionPending,
    syncedAt: syncedAt && Number.isFinite(syncedAt.getTime()) ? syncedAt.toISOString() : null, state: problems.length ? 'unknown' : 'known', issues: problems };
}

/** Missing rows and mixed units are not zero. Every consumer uses this same aggregation. */
export function stockForCode(snapshot: StockSnapshot, code: string, unit?: string) {
  const rows = snapshot.rows.filter(row => row.code === code);
  const issues = rows.flatMap(row => row.issues);
  if (!rows.length || snapshot.missingCodes.includes(code)) issues.push(`${code} 在所选仓库范围内缺少 ERP 库存快照`);
  if (new Set(rows.map(row => row.unit)).size > 1 || (unit !== undefined && rows.some(row => row.unit !== unit))) issues.push(`${code} 库存与物料单位不一致`);
  const available = issues.length || rows.some(row => row.available === null) ? null : rows.reduce((sum, row) => sum.plus(row.available!), new Prisma.Decimal(0)).toNumber();
  return { available, stockState: available === null ? 'unknown' as const : 'known' as const, issues: [...new Set(issues)], rows, scope: snapshot.scope, readAt: snapshot.readAt };
}
