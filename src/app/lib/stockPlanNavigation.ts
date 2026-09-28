import { routePath } from './routePaths';

export interface StockPlanViewState {
  planType: 'all' | 'machine' | 'packaging' | 'material';
  month: string;
  keyword: string;
  status: 'all' | 'not_started' | 'in_progress' | 'completed';
  supplier: string;
  creator: string;
  page: number;
  pageSize: number;
  expanded: string[];
  focusId?: string;
}
export interface StockPlanScope { productId?: string; treeNodeId?: string }
export const MAX_STOCK_PLAN_EXPANDED = 50;
const STOCK_KEYS = ['stockType', 'stockMonth', 'stockQ', 'stockStatus', 'stockSupplier', 'stockCreator', 'stockPage', 'stockPageSize', 'stockOpen', 'stockFocus'];
const ALLOWED_KEYS = new Set([...STOCK_KEYS, 'tab', 'view', 'product', 'module', 'moduleTab']);
const TYPES = new Set(['all', 'machine', 'packaging', 'material']);
const STATUSES = new Set(['all', 'not_started', 'in_progress', 'completed']);
const PAGE_SIZES = new Set(['10', '20', '50']);
const UNSAFE = /[\\\u0000-\u001f\u007f]/;
const validText = (value: unknown, limit: number): value is string => typeof value === 'string' && value.length > 0
  && value.length <= limit && value === value.trim() && !UNSAFE.test(value);
const validMonth = (value: string) => /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value);
const validPage = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 100_000;
const validPageText = (value: unknown): value is string => typeof value === 'string' && /^[1-9]\d{0,5}$/.test(value) && validPage(Number(value));

export function parseStockPlanViewState(input: string | URLSearchParams): StockPlanViewState {
  const params = typeof input === 'string' ? new URLSearchParams(input.length <= 16_384 ? input : '') : input;
  const one = (key: string) => params.getAll(key).length === 1 ? params.get(key) : null;
  const type = one('stockType'), month = one('stockMonth'), keyword = one('stockQ'), status = one('stockStatus'), focusId = one('stockFocus');
  const supplier = one('stockSupplier'), creator = one('stockCreator'), page = one('stockPage'), pageSize = one('stockPageSize');
  return {
    planType: TYPES.has(type ?? '') ? type as StockPlanViewState['planType'] : 'all',
    month: month && validMonth(month) ? month : '',
    keyword: keyword && keyword.length <= 200 && !UNSAFE.test(keyword) ? keyword : '',
    status: STATUSES.has(status ?? '') ? status as StockPlanViewState['status'] : 'all',
    supplier: validText(supplier, 256) ? supplier : '',
    creator: validText(creator, 256) ? creator : '',
    page: validPageText(page) ? Number(page) : 1,
    pageSize: PAGE_SIZES.has(pageSize ?? '') ? Number(pageSize) : 10,
    expanded: [...new Set(params.getAll('stockOpen').filter((id) => validText(id, 128)))].slice(0, MAX_STOCK_PLAN_EXPANDED),
    ...(validText(focusId, 128) ? { focusId } : {}),
  };
}

/** Use when leaving a plan scope; form defaults such as planType are separate. */
export function clearStockPlanViewParams(params: URLSearchParams): URLSearchParams {
  for (const key of [...STOCK_KEYS, 'moduleTab']) params.delete(key);
  return params;
}

/** Preserve the host page and form defaults while changing only the plan view. */
export function writeStockPlanViewParams(params: URLSearchParams, view: StockPlanViewState): URLSearchParams {
  for (const key of STOCK_KEYS) params.delete(key);
  if (TYPES.has(view.planType) && view.planType !== 'all') params.set('stockType', view.planType);
  if (validMonth(view.month)) params.set('stockMonth', view.month);
  if (view.keyword && view.keyword.length <= 200 && !UNSAFE.test(view.keyword)) params.set('stockQ', view.keyword);
  if (STATUSES.has(view.status) && view.status !== 'all') params.set('stockStatus', view.status);
  if (validText(view.supplier, 256)) params.set('stockSupplier', view.supplier);
  if (validText(view.creator, 256)) params.set('stockCreator', view.creator);
  if (validPage(view.page) && view.page !== 1) params.set('stockPage', String(view.page));
  if (typeof view.pageSize === 'number' && PAGE_SIZES.has(String(view.pageSize)) && view.pageSize !== 10) params.set('stockPageSize', String(view.pageSize));
  const expanded = [...new Set(view.expanded.filter((id) => validText(id, 128)))].slice(0, MAX_STOCK_PLAN_EXPANDED);
  for (const id of expanded) params.append('stockOpen', id);
  if (validText(view.focusId, 128)) params.set('stockFocus', view.focusId);
  return params;
}

/** Build only the two existing plan entry points, without newPlan or its write defaults. */
export function buildStockPlanReturnPath(view: StockPlanViewState, scope: StockPlanScope = {}): string | null {
  const params = new URLSearchParams();
  if (scope.productId || scope.treeNodeId) {
    if (!validText(scope.productId, 128) || !validText(scope.treeNodeId, 128)) return null;
    params.set('view', 'systems'); params.set('product', scope.productId); params.set('module', scope.treeNodeId); params.set('moduleTab', 'plans');
  } else params.set('tab', 'stock-plans');
  writeStockPlanViewParams(params, { ...view, expanded: view.focusId ? [view.focusId, ...view.expanded] : view.expanded });
  const path = `${routePath('page:proc-cockpit', '/proc-cockpit')}?${params.toString()}`;
  return stockPlanReturnPath({ stockPlanReturnTo: path });
}

/** A return cannot point to another page, another cockpit tab, or a create form. */
export function stockPlanReturnPath(state: unknown): string | null {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return null;
  const target = (state as Record<string, unknown>).stockPlanReturnTo;
  if (typeof target !== 'string' || target.length > 16_384 || !target.startsWith('/') || target.startsWith('//') || target.includes('#') || UNSAFE.test(target)) return null;
  const queryStart = target.indexOf('?');
  if (queryStart < 0 || target.slice(0, queryStart) !== routePath('page:proc-cockpit', '/proc-cockpit')) return null;
  const query = target.slice(queryStart + 1);
  try { if (UNSAFE.test(decodeURIComponent(query.replace(/\+/g, ' ')))) return null; } catch { return null; }
  const params = new URLSearchParams(query), seen = new Set<string>(), expanded = new Set<string>();
  for (const [key, value] of params) {
    if (!ALLOWED_KEYS.has(key) || (key !== 'stockOpen' && seen.has(key))) return null;
    seen.add(key);
    if (key === 'stockOpen') {
      if (!validText(value, 128) || expanded.has(value)) return null;
      expanded.add(value); if (expanded.size > MAX_STOCK_PLAN_EXPANDED) return null;
    } else if (['product', 'module', 'stockFocus'].includes(key)) { if (!validText(value, 128)) return null;
    } else if (['stockSupplier', 'stockCreator'].includes(key)) { if (!validText(value, 256)) return null;
    } else if (key === 'stockPage') { if (!validPageText(value)) return null;
    } else if (key === 'stockPageSize') { if (!PAGE_SIZES.has(value)) return null;
    } else if (key === 'stockQ') { if (!value || value.length > 200 || UNSAFE.test(value)) return null;
    } else if (key === 'stockType') { if (!TYPES.has(value)) return null;
    } else if (key === 'stockStatus') { if (!STATUSES.has(value)) return null;
    } else if (key === 'stockMonth' && !validMonth(value)) return null;
  }
  const global = params.get('tab') === 'stock-plans' && !['view', 'product', 'module', 'moduleTab'].some((key) => params.has(key));
  const module = !params.has('tab') && params.get('view') === 'systems' && params.get('moduleTab') === 'plans'
    && validText(params.get('product'), 128) && validText(params.get('module'), 128);
  if (!global && !module) return null;
  if (params.has('stockFocus') && !expanded.has(params.get('stockFocus')!)) return null;
  return target;
}
