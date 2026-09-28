import { routePath } from './routePaths';
import { buildPurchaseOrderLinePath } from './purchaseOrderLineNavigation';

export type ManagementRisk = {
  id: string; kind: 'quality' | 'ecn' | 'material' | 'schedule' | 'procurement' | 'purchase-order'; title: string;
  owner: string | null; dueDate: string | null; planId?: string; taskId?: string; recordId?: string; batchCodes: string[]; product: string; note: string;
  period?: 'current' | 'carryover'; keyMaterialId?: string;
  target?: { type: 'purchase-order'; orderNo: string; lineId: string } | { type: 'procurement'; taskId: string } | { type: 'quality'; qualityId: string };
};
export type ManagementRiskResponse = {
  scopes: { production: boolean; procurement: boolean; orders: boolean; quality: boolean; keyMaterials: boolean };
  products: { id: string; name: string }[]; completed: number | null; remaining: number | null;
  firstFinal: { quantity: number; goodQty: number; firstPassRate: number | null } | null; notice: string; calculatedAt: string; risks: ManagementRisk[];
  batches: { id: string; planId: string; batchId: string | null; product: string; code: string; date: string | null; target: number; remaining: number; current: number | null; onTime: number | null; note: string }[];
};
export function canReadManagementRisks(permissions: readonly string[] = []) {
  return permissions.includes('*') || ['page:proc-cockpit', 'page:purchase-orders', 'page:purchase-order-detail', 'proc-quality:manage', 'proc-quality:verify', 'page:rd-director-dashboard'].some(value => permissions.includes(value))
    || (permissions.includes('page:production-execution') && ['production:plan', 'production:view-all'].some(value => permissions.includes(value)));
}
export function managementRiskHref(row: ManagementRisk, month: string): string | null {
  if (row.target?.type === 'quality') return null;
  if (row.target?.type === 'purchase-order') return buildPurchaseOrderLinePath(row.target.orderNo, row.target.lineId);
  if (row.target?.type === 'procurement') return `${routePath('page:proc-cockpit', '/proc-cockpit')}?${new URLSearchParams({ task: row.target.taskId, detail: '1' })}`;
  if (!row.planId) return null;
  const values: Record<string, string> = row.kind === 'ecn' && row.recordId ? { view: 'transfer', recordType: 'ecn', record: row.recordId }
    : row.kind === 'material' && row.recordId ? { view: 'readiness', readinessBatch: row.recordId }
      : row.taskId ? { view: 'tasks', task: row.taskId, ...(row.kind === 'quality' && row.recordId ? { taskSection: 'quality', quality: row.recordId } : {}) } : {};
  return Object.keys(values).length ? `${routePath('page:production-execution', '/production-execution')}?${new URLSearchParams({ month, plan: row.planId, ...values })}` : null;
}
