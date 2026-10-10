export const PRODUCTION_PAGE_SIZE = 12;

export function productionPage<T>(rows: T[], rawPage: string | number | null, pageSize = PRODUCTION_PAGE_SIZE) {
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const parsed = Number(rawPage);
  const page = Math.min(pageCount, Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1);
  return { page, pageCount, total: rows.length, rows: rows.slice((page - 1) * pageSize, page * pageSize) };
}

export function productionSearch(query: string, values: unknown[]) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const text = values.filter(value => value !== null && value !== undefined).join(' ').toLocaleLowerCase();
  return words.every(word => text.includes(word));
}

export function productionQuery(params: URLSearchParams, changes: Record<string, string | null>) {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === '') next.delete(key);
    else next.set(key, value);
  }
  return next;
}

export function productionPendingInspection(task: { reports: { quantity: number }[]; inspections?: { quantity: number; kind?: string }[] }) {
  const reported = task.reports.reduce((sum, row) => sum + Math.round(row.quantity * 1000), 0);
  const inspected = task.inspections?.filter(row => row.kind !== 'process').reduce((sum, row) => sum + Math.round(row.quantity * 1000), 0) ?? 0;
  return Math.max(0, reported - inspected) / 1000;
}

export function productionTaskState(task: { status: string; quantity: number; reports: { quantity: number }[]; inspections?: { quantity: number; kind?: string; quality?: { status: string } | null }[]; fieldIssues?: { quality?: { status: string } | null }[] }) {
  if (task.status === 'cancelled') return { key: 'cancelled', label: '已取消', next: '查看留痕' };
  if (task.status === 'draft') return { key: 'draft', label: '待派工', next: '查看派工' };
  const reported = task.reports.reduce((sum, row) => sum + row.quantity, 0);
  if ([...(task.inspections ?? []), ...(task.fieldIssues ?? [])].some(row => row.quality && row.quality.status !== 'closed')) return { key: 'quality', label: '质量待处理', next: '查看原异常' };
  if (productionPendingInspection(task) > 0) return { key: 'inspection', label: '待终检', next: '查看检验' };
  if (reported < task.quantity) return { key: 'dispatched', label: '执行中', next: '进入作业' };
  return { key: 'reported', label: '报工已齐', next: '查看记录' };
}
