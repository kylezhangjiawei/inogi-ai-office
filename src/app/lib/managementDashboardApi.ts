import { authFetch, readErrorMessage } from './authSession';
import { listExecutionPlans, type ExecutionPlan, type ExecutionTask } from './productionExecutionApi';
import type { ManagementRiskResponse } from './managementRiskApi';
import { managementDashboardAccess } from '../dashboard/managementDashboardModel';

export interface ManagementProductionOverview {
  month: string;
  scope: 'all' | 'assigned';
  targetQty: number | null;
  shipmentTargetQty: number | null;
  actualShippedQty: number | null;
  firstFinal: { quantity: number; goodQty: number; firstPassRate: number | null } | null;
  tasks: Array<ExecutionTask & {
    planId: string;
    month: string;
    productLine: string;
    batchCode?: string;
    reportedQty: number;
    goodQty: number;
  }>;
  shipments: Array<{ id: string; batchId: string; quantity: number; date: string; voucher: string; recipient: string }>;
}
export type ManagementRdSummary = {
  total: number;
  inProgress: number;
  completed: number;
  blocked: number;
  scope: 'all' | 'participating';
};
export type ManagementProcurementSummary = {
  total: number;
  pending: number;
  inquiry: number;
  inTransit: number;
  partialArrival: number;
  samplePending: number;
  sampleTesting: number;
  scope: 'all';
};
export interface ManagementDashboardData {
  month: string;
  overview: ManagementProductionOverview | null;
  plans: ExecutionPlan[] | null;
  risks: ManagementRiskResponse | null;
  rd: ManagementRdSummary | null;
  procurement: ManagementProcurementSummary | null;
  errors: Partial<Record<'overview' | 'plans' | 'risks' | 'rd' | 'procurement', string>>;
  loadedAt: string;
}

export async function fetchManagementDashboard(month: string, permissions: string[], signal?: AbortSignal): Promise<ManagementDashboardData> {
  const access = managementDashboardAccess(permissions);
  if (!access.canManage) throw new Error('没有查看管理总览的权限');
  async function read<T>(path: string, fallback: string): Promise<T> {
    const response = await authFetch(path, { signal });
    if (!response.ok) throw new Error(await readErrorMessage(response, fallback));
    return response.json() as Promise<T>;
  }
  const readRd = async (): Promise<ManagementRdSummary> => {
    const payload = await read<{ categoryProgress?: Array<{ total?: number; in_progress?: number; completed?: number; blocked?: number }> }>('/api/research-development/director-dashboard', '研发概况读取失败');
    if (!Array.isArray(payload.categoryProgress) || payload.categoryProgress.some(row => ['total', 'in_progress', 'completed', 'blocked'].some(key => typeof row[key as keyof typeof row] !== 'number' || !Number.isFinite(row[key as keyof typeof row])))) {
      throw new Error('研发概况返回内容不完整');
    }
    const rows = payload.categoryProgress;
    const sum = (key: 'total' | 'in_progress' | 'completed' | 'blocked') => rows.reduce((total, row) => total + row[key]!, 0);
    const full = permissions.includes('*') || permissions.includes('rd-task:view-all')
      || ['rd-task:reassign', 'rd-project:direct', 'rd-project:review-l1', 'rd-project:review-l2', 'rd-people:manage'].some(code => permissions.includes(code));
    return { total: sum('total'), inProgress: sum('in_progress'), completed: sum('completed'), blocked: sum('blocked'), scope: full ? 'all' : 'participating' };
  };
  const readProcurement = async (): Promise<ManagementProcurementSummary> => {
    const payload = await read<{ total?: number; byStatus?: Record<string, number> }>('/api/procurement/summary', '采购概况读取失败');
    if (typeof payload.total !== 'number' || !Number.isFinite(payload.total) || payload.total < 0 || !payload.byStatus || typeof payload.byStatus !== 'object') {
      throw new Error('采购概况返回内容不完整');
    }
    const byStatus = payload.byStatus;
    const count = (key: string) => typeof byStatus[key] === 'number' && Number.isFinite(byStatus[key]) ? byStatus[key] : 0;
    return {
      total: payload.total,
      pending: count('pending_confirm'),
      inquiry: count('pending_inquiry') + count('inquiring'),
      inTransit: count('in_transit'),
      partialArrival: count('partial_arrival'),
      samplePending: count('pending_sample'),
      sampleTesting: count('testing'),
      scope: 'all',
    };
  };
  const [overview, plans, risks, rd, procurement] = await Promise.allSettled([
    access.canReadOverview ? read<ManagementProductionOverview>(`/api/procurement/production-execution/overview?${new URLSearchParams({ month })}`, '生产总览读取失败') : Promise.resolve(null),
    access.canReadPlans ? listExecutionPlans(month, signal) : Promise.resolve(null),
    access.canReadRisks ? read<ManagementRiskResponse>(`/api/procurement/management-risk?${new URLSearchParams({ month })}`, '交付风险读取失败') : Promise.resolve(null),
    access.canReadRd ? readRd() : Promise.resolve(null),
    access.canReadProcurement ? readProcurement() : Promise.resolve(null),
  ]);
  const errors: ManagementDashboardData['errors'] = {};
  if (overview.status === 'rejected') errors.overview = overview.reason instanceof Error ? overview.reason.message : '生产总览读取失败';
  if (plans.status === 'rejected') errors.plans = plans.reason instanceof Error ? plans.reason.message : '生产计划读取失败';
  if (risks.status === 'rejected') errors.risks = risks.reason instanceof Error ? risks.reason.message : '交付风险读取失败';
  if (rd.status === 'rejected') errors.rd = rd.reason instanceof Error ? rd.reason.message : '研发概况读取失败';
  if (procurement.status === 'rejected') errors.procurement = procurement.reason instanceof Error ? procurement.reason.message : '采购概况读取失败';
  return {
    month,
    overview: overview.status === 'fulfilled' ? overview.value : null,
    plans: plans.status === 'fulfilled' ? plans.value : null,
    risks: risks.status === 'fulfilled' ? risks.value : null,
    rd: rd.status === 'fulfilled' ? rd.value : null,
    procurement: procurement.status === 'fulfilled' ? procurement.value : null,
    errors,
    loadedAt: new Date().toISOString(),
  };
}
