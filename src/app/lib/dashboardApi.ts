import type { ExpenseDashboardData } from "../../modules/expense/types";
import { expenseService } from "../../modules/expense/services/expenseService";
import { createHttpIssueService } from "./issue/issueHttpService";
import type { Issue, IssueStats } from "./issue/types";
import { orderProcessingApi, type WorkbenchResponse } from "./orderProcessingApi";
import { fetchRdWorkspace, type RdWorkspacePayload } from "./rdApi";
import { authFetch, readErrorMessage } from "./authSession";
import { hasPermission } from "./permissions";

export type DashboardSource = "health" | "rd" | "issues" | "expenses" | "orders";

export type DashboardHealth = {
  ok: boolean;
  service?: string;
  timestamp?: string;
  release?: string;
  git_sha?: string;
  started_at?: string;
};

export type DashboardIssueData = {
  stats: IssueStats;
  recent: Issue[];
  distribution: {
    pending: number;
    processing: number;
    solved: number;
  };
};

export type DashboardData = {
  health: DashboardHealth | null;
  rd: RdWorkspacePayload | null;
  issues: DashboardIssueData | null;
  expenses: ExpenseDashboardData | null;
  orders: WorkbenchResponse | null;
  enabledSources: DashboardSource[];
  errors: Partial<Record<DashboardSource, string>>;
  loadedAt: string;
};

const issueService = createHttpIssueService();

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "接口加载失败";
}

async function loadHealth(): Promise<DashboardHealth> {
  const response = await authFetch("/api/health", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "系统健康检查失败"));
  }
  return (await response.json()) as DashboardHealth;
}

async function loadIssues(): Promise<DashboardIssueData> {
  const [stats, recent, pending, processing] = await Promise.all([
    issueService.stats(),
    issueService.list({ statusGroup: "all", page: 1, pageSize: 8 }),
    issueService.list({ statusGroup: "pending", page: 1, pageSize: 1 }),
    issueService.list({ statusGroup: "processing", page: 1, pageSize: 1 }),
  ]);

  return {
    stats,
    recent: recent.items,
    distribution: {
      pending: pending.total,
      processing: processing.total,
      solved: stats.solved,
    },
  };
}

export async function fetchDashboardData(permissions: string[]): Promise<DashboardData> {
  const canReadRd = [
    "page:rd-my-workspace",
    "page:rd-task-management",
    "page:rd-director-dashboard",
  ].some((permission) => hasPermission(permissions, permission));
  const canReadIssues = hasPermission(permissions, "page:issue-ai");
  const canReadExpenses = hasPermission(permissions, "page:expense-center");
  const canReadOrders = hasPermission(permissions, "page:order-workbench");

  const enabledSources: DashboardSource[] = ["health"];
  if (canReadRd) enabledSources.push("rd");
  if (canReadIssues) enabledSources.push("issues");
  if (canReadExpenses) enabledSources.push("expenses");
  if (canReadOrders) enabledSources.push("orders");

  const [healthResult, rdResult, issueResult, expenseResult, orderResult] = await Promise.allSettled([
    loadHealth(),
    canReadRd ? fetchRdWorkspace() : Promise.resolve(null),
    canReadIssues ? loadIssues() : Promise.resolve(null),
    canReadExpenses ? expenseService.getDashboardStrict() : Promise.resolve(null),
    canReadOrders
      ? orderProcessingApi.getWorkbench({ orderPage: 1, orderPageSize: 8, productPage: 1, productPageSize: 1 })
      : Promise.resolve(null),
  ]);

  const errors: DashboardData["errors"] = {};
  if (healthResult.status === "rejected") errors.health = errorMessage(healthResult.reason);
  if (canReadRd && rdResult.status === "rejected") errors.rd = errorMessage(rdResult.reason);
  if (canReadIssues && issueResult.status === "rejected") errors.issues = errorMessage(issueResult.reason);
  if (canReadExpenses && expenseResult.status === "rejected") errors.expenses = errorMessage(expenseResult.reason);
  if (canReadOrders && orderResult.status === "rejected") errors.orders = errorMessage(orderResult.reason);

  return {
    health: healthResult.status === "fulfilled" ? healthResult.value : null,
    rd: rdResult.status === "fulfilled" ? rdResult.value : null,
    issues: issueResult.status === "fulfilled" ? issueResult.value : null,
    expenses: expenseResult.status === "fulfilled" ? expenseResult.value : null,
    orders: orderResult.status === "fulfilled" ? orderResult.value : null,
    enabledSources,
    errors,
    loadedAt: new Date().toISOString(),
  };
}
