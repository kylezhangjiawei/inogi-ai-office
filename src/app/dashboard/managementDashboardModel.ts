import { hasPermission } from '../lib/permissions';
import { canReadManagementRisks } from '../lib/managementRiskApi';
import type { ExecutionPlan } from '../lib/productionExecutionApi';

export function managementDashboardAccess(permissions: string[]) {
  const productionPage = hasPermission(permissions, 'page:production-execution');
  const directorPage = hasPermission(permissions, 'page:rd-director-dashboard');
  const productionManagement = hasPermission(permissions, 'production:view-all') || hasPermission(permissions, 'production:plan');
  const canReadPlans = productionPage && productionManagement;
  const canReadOverview = canReadPlans || directorPage;
  const canReadRisks = canReadManagementRisks(permissions);
  const canReadRd = ['page:rd-task-management', 'page:rd-my-workspace', 'page:rd-director-dashboard']
    .some(permission => hasPermission(permissions, permission));
  // The procurement summary is global. A personal workspace must never unlock it.
  const canReadProcurement = hasPermission(permissions, 'page:proc-cockpit');
  const canManage = canReadOverview || canReadPlans || canReadRisks || canReadRd || canReadProcurement;
  const defaultToManagement = canManage;
  return { canManage, canReadPlans, canReadOverview, canReadRisks, canReadRd, canReadProcurement, defaultToManagement };
}

export function dashboardHomeView(params: URLSearchParams, permissions: string[]) {
  const access = managementDashboardAccess(permissions);
  return access.canManage && (params.get('home') === 'management' || (access.defaultToManagement && params.get('home') !== 'office')) ? 'management' : 'office';
}

export function managementMonth(value: string | null, today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)) {
  return value && /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : today.slice(0, 7);
}

export function managementQuery(params: URLSearchParams, patch: Record<string, string | null>) {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries(patch)) value ? next.set(key, value) : next.delete(key);
  return next;
}

export function knownManagementQuantity(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function managementPlanProgress(plan: ExecutionPlan) {
  return plan.scope === 'all' && knownManagementQuantity(plan.targetQty) && plan.targetQty > 0 && knownManagementQuantity(plan.summary.completedQty)
    ? plan.summary.completedQty / plan.targetQty * 100 : null;
}

export function managementPlanPage(plans: ExecutionPlan[], month: string, query: string, range: string, rawPage: string | null) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const rows = plans.filter(plan => range === 'all' || (range === 'carryover' ? plan.month < month : plan.month === month))
    .filter(plan => words.every(word => `${plan.productName} ${plan.productLine} ${plan.id}`.toLocaleLowerCase().includes(word)));
  const pageCount = Math.max(1, Math.ceil(rows.length / 10)), requested = Number(rawPage);
  const page = Number.isSafeInteger(requested) && requested > 0 ? Math.min(requested, pageCount) : 1;
  return { page, pageCount, total: rows.length, rows: rows.slice((page - 1) * 10, page * 10) };
}
