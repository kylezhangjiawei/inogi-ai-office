import { subRoutePath } from './routePaths';

const isLineIdentity = (value: unknown): value is string => typeof value === 'string'
  && value.length > 0 && value.length <= 256 && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);

/** Keep order numbers and mirror IDs separate; neither SKU nor row position is an identity. */
export function buildPurchaseOrderLinePath(orderNo: string, lineId: string): string | null {
  if (!isLineIdentity(orderNo) || !isLineIdentity(lineId) || orderNo === '.' || orderNo === '..') return null;
  try {
    return `${subRoutePath('page:purchase-orders', '/purchase-orders', encodeURIComponent(orderNo))}?lineId=${encodeURIComponent(lineId)}`;
  } catch {
    return null;
  }
}

/** Decode exactly once: React Router additionally normalizes literal "%2F" in params. */
export function purchaseOrderIdFromPathname(pathname: string): string | null {
  const prefix = subRoutePath('page:purchase-orders', '/purchase-orders', '');
  if (!pathname?.startsWith(prefix)) return null;
  const segment = pathname.slice(prefix.length).replace(/\/$/, '');
  if (!segment || segment.includes('/')) return null;
  try { return decodeURIComponent(segment); } catch { return null; }
}

export function purchaseOrderLineTarget(search: string | URLSearchParams): { requested: boolean; lineId: string | null } {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const values = params.getAll('lineId');
  return { requested: values.length > 0, lineId: values.length === 1 && isLineIdentity(values[0]) ? values[0] : null };
}

/** An ambiguous or removed mirror ID must never silently select another material. */
export function findPurchaseOrderLine<T extends { id?: string }>(items: readonly T[], lineId: string | null): T | null {
  if (!lineId) return null;
  const matches = items.filter((item) => item.id === lineId);
  return matches.length === 1 ? matches[0] : null;
}
