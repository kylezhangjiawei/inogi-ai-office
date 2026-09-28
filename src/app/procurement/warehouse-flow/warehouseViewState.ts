import type { WarehouseIssue } from '../../lib/warehouseFlowApi';

export const WAREHOUSE_STATUS = { requested: '待发料', partial: '分批办理中', issued: '已发齐，待签收', signed: '已签收', cancelled: '已取消' };
export const WAREHOUSE_CHECK_STATUS = { matched: '人工核对一致', difference: '存在差异，待处理', revoked: '已撤回，待重新核对' };
export const latestWarehouseCheck = (issue: WarehouseIssue, eventId: string) => [...issue.history].reverse().find(event => event.reconciliation?.eventId === eventId);
export function warehouseCheckLabel(issue: WarehouseIssue) {
  const events = issue.history.filter(event => event.action === 'issue');
  if (!events.length) return '尚无发料记录';
  const results = events.map(event => latestWarehouseCheck(issue, event.id)?.reconciliation?.result);
  return results.includes('difference') ? '存在差异，待处理' : results.every(value => value === 'matched') ? '人工核对一致' : '凭证待核对';
}
export function warehouseQuery(params: URLSearchParams, patch: Record<string, string | null>) {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries(patch)) value ? next.set(key, value) : next.delete(key);
  return next;
}
export function warehousePage<T>(rows: T[], raw: string | null) {
  const pageCount = Math.max(1, Math.ceil(rows.length / 12)), number = Number(raw);
  const page = Number.isSafeInteger(number) && number > 0 ? Math.min(number, pageCount) : 1;
  return { page, pageCount, total: rows.length, rows: rows.slice((page - 1) * 12, page * 12) };
}
export function warehouseSearch(value: string, fields: unknown[]) {
  const words = value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean), text = fields.join(' ').toLocaleLowerCase();
  return words.every(word => text.includes(word));
}
