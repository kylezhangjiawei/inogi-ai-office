import type { KeyMaterial, KeyMaterialClue, KeyMaterialMonthly } from '../../lib/keyMaterialsApi';

export const KEY_MATERIAL_PAGE_SIZE = 12;
export type MonthlyMaterial = KeyMaterialMonthly['materials'][number];
export function validKeyMaterialMonth(value: string | null): value is string {
  return Boolean(value && /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value));
}
export function validKeyMaterialDate(value: string | null): value is string {
  if (!value || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
export function keyMaterialContext(params: URLSearchParams, today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)) {
  const month = validKeyMaterialMonth(params.get('month')) ? params.get('month')! : today.slice(0, 7);
  const nextMonth = new Date(`${month}-01T00:00:00Z`); nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  const date = validKeyMaterialDate(params.get('date')) ? params.get('date')! : month === today.slice(0, 7) ? today : new Date(nextMonth.getTime() - 86400000).toISOString().slice(0, 10);
  return { month, date, productId: params.get('product') || '', productLine: params.get('productLine') || '' };
}
export function keyMaterialPage<T>(rows: T[], raw: string | null) {
  const requested = Number(raw), totalPages = Math.max(1, Math.ceil(rows.length / KEY_MATERIAL_PAGE_SIZE));
  const page = Number.isSafeInteger(requested) && requested > 0 ? Math.min(requested, totalPages) : 1;
  return { page, totalPages, total: rows.length, items: rows.slice((page - 1) * KEY_MATERIAL_PAGE_SIZE, page * KEY_MATERIAL_PAGE_SIZE) };
}
export function keyMaterialSearch(params: URLSearchParams, patch: Record<string, string | null>) {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries(patch)) value ? next.set(key, value) : next.delete(key);
  return next;
}
export function clueNeedsReview(clue: KeyMaterialClue, materials: Map<string, KeyMaterial>) {
  if (clue.mapping.inclusion === 'excluded' && clue.mapping.at) return false;
  return !clue.mapping.at || !clue.mapping.materialIds.length || clue.mapping.materialIds.some(id => {
    const material = materials.get(id);
    return !material || material.available == null || !material.syncedAt;
  });
}
export function scopedMonthlyMaterials(data: KeyMaterialMonthly, productLine: string, productId = '') {
  if (!productLine && !productId) return data.materials;
  return data.materials.map(material => ({ ...material, plans: material.plans.filter(plan => (!productLine || plan.productLine === productLine) && (!productId || plan.productId === productId)) }))
    .filter(material => material.plans.length > 0);
}
export function filterMonthlyMaterials(rows: MonthlyMaterial[], query: string, filter: string, hasFormalPlans = true) {
  const keyword = query.trim().toLocaleLowerCase();
  return rows.filter(row => `${row.name} ${row.spec} ${row.tpInventoryCode || row.erpCode} ${row.plans.map(plan => plan.productLine).join(' ')}`.toLocaleLowerCase().includes(keyword))
    .filter(row => filter === 'gap' ? row.plans.some(plan => plan.gap != null && plan.gap > 0)
      : filter === 'unverified' ? !hasFormalPlans || row.plans.some(plan => plan.gap == null || plan.problems.length)
        : filter === 'quality' ? row.quality.length > 0 : true);
}
