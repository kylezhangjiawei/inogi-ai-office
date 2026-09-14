import { routePath } from './routePaths';
const KEYS = new Set(['month','period','product','supplier','status','q','focus','sort','source','task','page','arrivals','arrivalPage','arrivalFocus','arrivalView','arrivalMonth','arrivalDay',
  'deliveryOpen','deliveryMonth','deliveryBucket','deliveryDay','deliveryQ','deliverySupplier','deliveryPage','deliveryView','deliveryFocus']);
const unsafe = /[\\\u0000-\u001f\u007f]/;
export function purchaseDeliveryReturnPath(state: unknown): string | null {
  if (!state || typeof state !== 'object') return null;
  const target = (state as Record<string, unknown>).purchaseDeliveryReturnTo;
  if (typeof target !== 'string' || target.length > 8192 || unsafe.test(target) || target.includes('#') || target.split('?').length !== 2) return null;
  const [pathname, query] = target.split('?');
  if (pathname !== routePath('page:proc-my-workspace', '/proc-my-workspace')) return null;
  const params = new URLSearchParams(query);
  for (const [key, value] of params) if (!KEYS.has(key) || params.getAll(key).length !== 1 || value.length > 1024 || unsafe.test(value)) return null;
  if (params.get('deliveryOpen') !== 'true' || !params.get('deliveryFocus')) return null;
  return target;
}
export function buildPurchaseDeliveryReturnPath(params: URLSearchParams, lineId: string) {
  if (!lineId || unsafe.test(lineId)) return null;
  const next = new URLSearchParams();
  for (const [key, value] of params) if (KEYS.has(key)) next.set(key, value);
  next.set('deliveryOpen', 'true'); next.set('deliveryFocus', lineId);
  const target = `${routePath('page:proc-my-workspace', '/proc-my-workspace')}?${next}`;
  return purchaseDeliveryReturnPath({ purchaseDeliveryReturnTo: target });
}
