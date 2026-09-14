import type { UnifiedAuditPage, UnifiedAuditQuery } from '../../lib/auditLog';

export const HISTORY_PAGE_SIZE = 10;
const ACTION = 'purchase-order.availability-confirmed';
const RESOURCE = 'proc-purchase-order-availability';

export function purchaseOrderHistoryQuery(lineId: string, page = 1, snapshot?: Pick<UnifiedAuditPage, 'snapshotAt' | 'filterSignature'>): UnifiedAuditQuery {
  return {
    module: 'procurement', actions: [ACTION], resource: RESOURCE, resourceId: lineId,
    sort: 'newest', page, pageSize: HISTORY_PAGE_SIZE,
    ...(snapshot ? { snapshotAt: snapshot.snapshotAt, statsSignature: snapshot.filterSignature } : {}),
  };
}

export type HistoryValue = { recorded: false } | { recorded: true; value: string | number | null };
export type HistoryChange = { before: HistoryValue; after: HistoryValue };
export type PurchaseOrderHistoryEntry = {
  id: string; timestamp: string; actor: string; source: string;
  availableDate: HistoryChange; note: HistoryChange; version: HistoryChange;
  sourceChanged: boolean | null;
};
export type PurchaseOrderHistoryPage = Pick<UnifiedAuditPage, 'page' | 'pageSize' | 'total' | 'snapshotAt' | 'filterSignature'> & {
  entries: PurchaseOrderHistoryEntry[];
};

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown, min: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min;
const timestamp = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));
const day = (value: unknown) => typeof value === 'string' && /^(?!0000)\d{4}-\d\d-\d\d$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
function fail(): never { throw new Error('日期确认记录不完整或订单行关联不一致，请重新读取。'); }

/** Validate the exact mirror identity; SKU, supplier and display row number are not identities. */
export function readPurchaseOrderHistoryPage(value: unknown, lineId: string): PurchaseOrderHistoryPage {
  if (!record(value) || !integer(value.total, 0) || !integer(value.page, 1) || value.pageSize !== HISTORY_PAGE_SIZE
    || !timestamp(value.snapshotAt) || typeof value.filterSignature !== 'string' || !value.filterSignature
    || !Array.isArray(value.items) || value.items.length > HISTORY_PAGE_SIZE || value.items.length > value.total
    || value.page > Math.max(1, Math.ceil(value.total / HISTORY_PAGE_SIZE))) fail();
  const ids = new Set<string>();
  const entries = value.items.map((row: unknown) => {
    if (!record(row) || typeof row.id !== 'string' || !row.id || ids.has(row.id) || !timestamp(row.timestamp)
      || row.module !== 'procurement' || row.action !== ACTION || !record(row.resource)
      || row.resource.type !== RESOURCE || row.resource.id !== lineId || !record(row.actor)
      || typeof row.actor.name !== 'string' || typeof row.source !== 'string' || !Array.isArray(row.changes)) fail();
    ids.add(row.id);
    const changes = row.changes;
    function change(field: string): HistoryChange {
      const matches = changes.filter((item) => record(item) && item.field === field) as Record<string, unknown>[];
      if (matches.length > 1) fail();
      function side(key: 'before' | 'after'): HistoryValue {
        if (!matches.length || !Object.prototype.hasOwnProperty.call(matches[0], key)) return { recorded: false };
        const raw = matches[0][key];
        const valid = raw === null || (field === 'availableDate' ? day(raw) : field === 'version' ? integer(raw, 0) : typeof raw === 'string');
        if (!valid) fail();
        return { recorded: true, value: raw as string | number | null };
      }
      return { before: side('before'), after: side('after') };
    }
    const fingerprint = change('sourceFingerprint');
    return {
      id: row.id, timestamp: row.timestamp, actor: row.actor.name, source: row.source,
      availableDate: change('availableDate'), note: change('note'), version: change('version'),
      sourceChanged: fingerprint.before.recorded && fingerprint.before.value !== null && fingerprint.after.recorded && fingerprint.after.value !== null
        ? fingerprint.before.value !== fingerprint.after.value : null,
    };
  });
  return { total: value.total, page: value.page, pageSize: value.pageSize, snapshotAt: value.snapshotAt, filterSignature: value.filterSignature, entries };
}

export function historyValueText(value: HistoryValue, field: 'date' | 'note' | 'version'): string {
  if (!value.recorded) return '未记录';
  if (value.value === null) return field === 'date' ? '未设置日期' : field === 'version' ? '未记录' : '无说明';
  if (value.value === '') return '无说明';
  return String(value.value);
}
