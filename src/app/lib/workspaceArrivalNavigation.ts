import { routePath } from './routePaths';

const KEYS = new Set(['month', 'period', 'product', 'supplier', 'status', 'q', 'focus', 'sort', 'source', 'task', 'page', 'arrivals', 'arrivalPage', 'arrivalFocus', 'arrivalView', 'arrivalMonth', 'arrivalDay']);
const SOURCES = new Set(['purchase', 'sample', 'stock', 'arrival']);
const UNSAFE = /[\\\u0000-\u001f\u007f]/;

export interface WorkspaceArrivalView {
  view: 'list' | 'calendar';
  month: string;
  selection: string;
}
const validMonth = (value: string) => /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value);
function validDay(value: string): boolean {
  return /^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
function validCalendarView(params: URLSearchParams): boolean {
  for (const key of ['arrivalView', 'arrivalMonth', 'arrivalDay']) if (params.getAll(key).length > 1) return false;
  if (params.has('arrivalView') && !['list', 'calendar'].includes(params.get('arrivalView')!)) return false;
  if (params.has('arrivalMonth') && !validMonth(params.get('arrivalMonth')!)) return false;
  const day = params.get('arrivalDay');
  if (day !== null && !['all', 'undated', 'outside'].includes(day) && !validDay(day)) return false;
  return !day || !validDay(day) || day.slice(0, 7) === (params.get('arrivalMonth') || params.get('month'));
}

/** Arrival month is independent of the task demand month. Invalid URL state falls back as a unit. */
export function parseWorkspaceArrivalView(params: URLSearchParams, fallbackMonth: string): WorkspaceArrivalView {
  const fallback = validMonth(fallbackMonth) ? fallbackMonth : '2000-01';
  if (!validCalendarView(params)) return { view: 'list', month: fallback, selection: 'all' };
  return { view: params.get('arrivalView') === 'calendar' ? 'calendar' : 'list', month: params.get('arrivalMonth') || fallback,
    selection: params.get('arrivalView') === 'calendar' ? params.get('arrivalDay') || 'all' : 'all' };
}

function validSource(params: URLSearchParams): boolean {
  const values = params.getAll('source');
  return values.length === 0 || (values.length === 1 && SOURCES.has(values[0]));
}

/** Only an existing procurement workbench view may be restored from an order. */
export function workspaceArrivalReturnPath(state: unknown): string | null {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return null;
  const target = (state as Record<string, unknown>).workspaceArrivalReturnTo;
  if (typeof target !== 'string' || target.length > 8192 || UNSAFE.test(target) || target.includes('#')) return null;
  const [pathname, search = ''] = target.split('?');
  if (target.split('?').length > 2 || pathname !== routePath('page:proc-my-workspace', '/proc-my-workspace')) return null;
  const params = new URLSearchParams(search);
  if (!validSource(params) || !validCalendarView(params)) return null;
  for (const [key, value] of params) {
    if (!KEYS.has(key) || params.getAll(key).length !== 1 || value.length > 1024 || UNSAFE.test(value)) return null;
  }
  if (params.get('arrivals') !== 'open' || !params.get('task') || !params.get('arrivalFocus')) return null;
  for (const key of ['page', 'arrivalPage']) {
    const value = params.get(key);
    if (value !== null && (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))) return null;
  }
  return target;
}

export function buildWorkspaceArrivalReturnPath(params: URLSearchParams, input: { taskId: string; rowKey: string; taskPage: number; arrivalPage: number }): string | null {
  // Do not collapse duplicate source values into an apparently valid return context.
  if (!validSource(params) || !validCalendarView(params)) return null;
  const next = new URLSearchParams();
  for (const [key, value] of params) if (KEYS.has(key)) next.set(key, value);
  next.set('task', input.taskId);
  next.set('page', String(input.taskPage));
  next.set('arrivals', 'open');
  next.set('arrivalPage', String(input.arrivalPage));
  next.set('arrivalFocus', input.rowKey);
  const target = `${routePath('page:proc-my-workspace', '/proc-my-workspace')}?${next.toString()}`;
  return workspaceArrivalReturnPath({ workspaceArrivalReturnTo: target });
}
