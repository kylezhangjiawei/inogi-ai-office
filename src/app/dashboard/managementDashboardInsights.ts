import type { ManagementDashboardData } from '../lib/managementDashboardApi';
import type { ManagementRisk } from '../lib/managementRiskApi';

export type ManagementTrendPoint = {
  date: string;
  label: string;
  plannedQty: number;
  actualGoodQty: number | null;
};

export type ManagementRiskCounts = Record<ManagementRisk['kind'], number>;

export type ManagementDashboardInsights = {
  trend: ManagementTrendPoint[];
  actualAvailable: boolean;
  currentMonth: { target: number | null; completed: number | null; remaining: number | null };
  firstFinal: { quantity: number; goodQty: number; firstPassRate: number | null } | null;
  riskCounts: ManagementRiskCounts | null;
  risks: ManagementRisk[] | null;
  causeTop: Array<{ cause: string; defectiveQty: number; count: number }>;
};

const finiteQuantity = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

function daysInMonth(month: string) {
  const [year, number] = month.split('-').map(Number);
  return Number.isSafeInteger(year) && Number.isSafeInteger(number) && number >= 1 && number <= 12
    ? new Date(Date.UTC(year, number, 0)).getUTCDate()
    : 0;
}

export function deriveDashboardInsights(data: ManagementDashboardData | null, month: string, today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)): ManagementDashboardInsights {
  const completePlanTasks = data?.plans && data.plans.every(plan => plan.scope === 'all')
    ? data.plans.flatMap(plan => plan.tasks)
    : null;
  const tasks = completePlanTasks ?? data?.overview?.tasks;
  const plannedByDate = new Map<string, number>();
  const firstFinalByDate = new Map<string, number>();
  for (const task of tasks ?? []) {
    if (task.status !== 'dispatched' || task.output !== 'whole') continue;
    if (task.date.startsWith(`${month}-`)) plannedByDate.set(task.date, (plannedByDate.get(task.date) ?? 0) + task.quantity);
  }
  let inspectedQuantity = 0;
  let inspectedGoodQty = 0;
  for (const task of completePlanTasks ?? []) {
    if (task.status === 'cancelled' || task.output !== 'whole') continue;
    for (const inspection of task.inspections ?? []) {
      if (inspection.kind !== 'final') continue;
      if (!inspection.date.startsWith(`${month}-`)) continue;
      inspectedQuantity += inspection.quantity;
      inspectedGoodQty += inspection.goodQty;
      firstFinalByDate.set(inspection.date, (firstFinalByDate.get(inspection.date) ?? 0) + inspection.goodQty);
    }
  }
  const authoritativeFinal = data?.overview?.firstFinal;
  const actualAvailable = Boolean(completePlanTasks && authoritativeFinal
    && Math.abs(inspectedQuantity - authoritativeFinal.quantity) < 1e-9
    && Math.abs(inspectedGoodQty - authoritativeFinal.goodQty) < 1e-9);
  let cumulativePlanned = 0;
  let cumulativeActual = 0;
  const trend = !tasks ? [] : Array.from({ length: daysInMonth(month) }, (_, index) => {
    const date = `${month}-${String(index + 1).padStart(2, '0')}`;
    cumulativePlanned += plannedByDate.get(date) ?? 0;
    cumulativeActual += firstFinalByDate.get(date) ?? 0;
    return { date, label: date.slice(5), plannedQty: cumulativePlanned, actualGoodQty: !actualAvailable || date > today ? null : cumulativeActual };
  });

  const currentPlans = data?.plans?.filter(plan => plan.scope === 'all' && plan.month === month) ?? null;
  const planTarget = currentPlans?.reduce((sum, plan) => sum + plan.targetQty, 0) ?? null;
  const planCompleted = currentPlans?.reduce((sum, plan) => sum + plan.summary.completedQty, 0) ?? null;
  const planRemaining = currentPlans?.reduce((sum, plan) => sum + plan.summary.remainingQty, 0) ?? null;
  const target = finiteQuantity(data?.overview?.targetQty) ? data.overview.targetQty : planTarget;
  const completed = finiteQuantity(data?.risks?.completed) ? data.risks.completed : planCompleted;
  const remaining = finiteQuantity(data?.risks?.remaining) ? data.risks.remaining : planRemaining;

  const riskCounts = data?.risks ? data.risks.risks.reduce<ManagementRiskCounts>((counts, risk) => {
    counts[risk.kind] += 1;
    return counts;
  }, { quality: 0, ecn: 0, material: 0, schedule: 0, procurement: 0, 'purchase-order': 0 }) : null;

  return {
    trend,
    actualAvailable,
    currentMonth: { target, completed, remaining },
    firstFinal: data?.overview?.firstFinal ?? data?.risks?.firstFinal ?? null,
    riskCounts,
    risks: data?.risks ? data.risks.risks.slice(0, 5) : null,
    // The aggregate endpoints do not expose confirmed, normalized cause analysis.
    causeTop: [],
  };
}
