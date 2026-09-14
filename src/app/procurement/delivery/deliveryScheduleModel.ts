import { isDeliveryDay, type DeliveryScheduleRow } from '../../lib/purchaseDeliveryApi';

export function isDeliveryMonth(value: string) { return /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value); }
export function deliveryMonthGrid(month: string, dates: Array<{ date: string; count: number }>) {
  if (!isDeliveryMonth(month)) return null;
  const first = new Date(`${month}-01T00:00:00Z`), end = new Date(first); end.setUTCMonth(end.getUTCMonth() + 1);
  const length = Math.round((end.getTime() - first.getTime()) / 86400000), offset = (first.getUTCDay() + 6) % 7;
  const counts = new Map(dates.filter((item) => isDeliveryDay(item.date) && item.date.startsWith(month + '-')).map((item) => [item.date, item.count]));
  return { length, cells: Array.from({ length: 42 }, (_, index) => {
    const number = index - offset + 1;
    const date = number > 0 && number <= length ? `${month}-${String(number).padStart(2, '0')}` : null;
    return { date, number: date ? number : null, count: date ? counts.get(date) ?? 0 : 0 };
  }) };
}
export function deliveryGanttSegment(row: Pick<DeliveryScheduleRow, 'orderDate' | 'erpExpectedDate'>, month: string) {
  const grid = deliveryMonthGrid(month, []);
  if (!grid || !isDeliveryDay(row.erpExpectedDate)) return { kind: 'unknown' as const };
  if (!isDeliveryDay(row.orderDate)) {
    return row.erpExpectedDate.startsWith(month + '-') ? { kind: 'point' as const, start: Number(row.erpExpectedDate.slice(-2)), span: 1 } : { kind: 'outside' as const };
  }
  if (row.orderDate > row.erpExpectedDate) return { kind: 'invalid' as const };
  const from = `${month}-01`, to = `${month}-${String(grid.length).padStart(2, '0')}`;
  if (row.erpExpectedDate < from || row.orderDate > to) return { kind: 'outside' as const };
  const start = row.orderDate < from ? 1 : Number(row.orderDate.slice(-2));
  const end = row.erpExpectedDate > to ? grid.length : Number(row.erpExpectedDate.slice(-2));
  return { kind: 'range' as const, start, span: end - start + 1 };
}
