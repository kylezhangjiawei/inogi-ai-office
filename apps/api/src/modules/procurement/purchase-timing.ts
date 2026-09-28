import type { ProcPurchaseOrderAvailability } from '@prisma/client';
import { deliveryDay, deliverySourceIdentity, type SupplierDeliveryState } from './purchase-delivery-store';
import { purchaseOrderAvailabilityView, type PurchaseOrderAvailabilitySource } from './purchase-order-availability';
import { isVoidedOrderStatus } from './replenish-core';

/** Commitments and inspection availability are separate facts. A later promise cannot leave an earlier availability usable. */
export function purchaseTiming(source: PurchaseOrderAvailabilitySource & { tpOrderNo: string; tpLineNo: string }, record: ProcPurchaseOrderAvailability | null | undefined, promise: SupplierDeliveryState | null | undefined) {
  const availability = purchaseOrderAvailabilityView(record, source);
  const sourceChanged = Boolean(promise && promise.sourceIdentity !== deliverySourceIdentity(source));
  const promisedDate = promise && !sourceChanged ? promise.currentDate : null;
  const erpDate = deliveryDay(source.etaDate);
  // Explicit withdrawal or obsolete commitment must remain unknown, rather than silently reviving ERP's old date.
  const latestDate = promise ? promisedDate : erpDate;
  const timingConflict = Boolean(availability?.availableDate && latestDate && availability.availableDate < latestDate);
  const inactive = isVoidedOrderStatus(source.status, source.approvalStatus);
  const needsReconfirmation = Boolean(inactive || availability?.needsReconfirmation || timingConflict || sourceChanged || (promise && !promise.currentDate));
  return { erpDate, promisedDate, supplierSourceChanged: sourceChanged, latestDate,
    latestSource: promise ? sourceChanged ? 'stale' : promise.currentDate ? 'supplier' : 'withdrawn' : 'erp',
    availableDate: availability?.availableDate ?? null,
    confirmedAvailableDate: needsReconfirmation ? null : availability?.availableDate ?? null,
    needsReconfirmation, timingConflict, availability,
    note: inactive ? '订单已作废或取消，原可用日期保留但不计入有效供给' : timingConflict ? '最新到货承诺晚于原检验后可用日，请重新核对检验安排' : sourceChanged ? '供应商承诺对应的订单来源已变化' : promise && !promise.currentDate ? '供应商已撤销承诺，日期待确认' : availability?.needsReconfirmation ? '检验后可用日期的来源已变化' : '' };
}

export function deliveryDatePage<T extends { lineId: string; calendarDate: string | null }>(rows: T[], month: string, bucket: string, date: string | null, requested: number, pageSize: number) {
  const inMonth = (row: T) => Boolean(row.calendarDate?.startsWith(`${month}-`));
  const counts = new Map<string, number>();
  rows.filter(inMonth).forEach(row => counts.set(row.calendarDate!, (counts.get(row.calendarDate!) ?? 0) + 1));
  const filtered = rows.filter(row => date ? row.calendarDate === date : bucket === 'month' ? inMonth(row) : bucket === 'undated' ? !row.calendarDate : bucket === 'outside' ? Boolean(row.calendarDate) && !inMonth(row) : true)
    .sort((a, b) => (a.calendarDate ?? '9999-12-31').localeCompare(b.calendarDate ?? '9999-12-31') || a.lineId.localeCompare(b.lineId));
  const total = filtered.length, totalPages = Math.max(1, Math.ceil(total / pageSize)), page = Math.min(requested, totalPages);
  const monthCount = [...counts.values()].reduce((sum, n) => sum + n, 0), undated = rows.filter(row => !row.calendarDate).length;
  return { summary: { all: rows.length, inMonth: monthCount, undated, outside: rows.length - monthCount - undated },
    days: [...counts].map(([date, count]) => ({ date, count })).sort((a,b) => a.date.localeCompare(b.date)),
    rows: { page, pageSize, total, totalPages, items: filtered.slice((page - 1) * pageSize, page * pageSize) } };
}
