import type { ProcurementTask, ProcStockPlan } from "../lib/procurementApi";
import { filterWorkspaceTasks, uniqueWorkspaceTasks, workspaceArrivals, workspacePeriod, UNDETERMINED_SUPPLIER, type WorkspaceArrival } from "./procurementWorkspaceModel";
import { isSampleTask } from "./sampleWorkspaceModel";

export type WorkspaceBusiness = "purchase" | "sample" | "stock" | "arrival";
export type AggregationPeriod = "month" | "carryover" | "undated" | "future";
export interface WorkspaceSourceRow {
  key: string;
  business: WorkspaceBusiness;
  id: string;
  code: string;
  title: string;
  detail: string;
  date: string;
  dateLabel: string;
  period: AggregationPeriod;
  relation: string;
  taskId?: string;
  planId?: string;
  arrival?: WorkspaceArrival;
}
const terminal = new Set(["completed", "cancelled"]);
const number = (value: number) => Number.isFinite(value) && value >= 0 ? value.toLocaleString() : "待核对";

function sourcePeriod(date: string | undefined, month: string): AggregationPeriod {
  return workspacePeriod({ needDate: date } as ProcurementTask, month);
}

/** 只投影已有来源；样品是采购任务的互斥分类，计划和订单行另计，不能相加为任务总数。 */
export function buildWorkspaceAggregation(input: {
  tasks: readonly ProcurementTask[];
  plans: readonly ProcStockPlan[];
  userId?: string;
  month: string;
  productId: string;
  supplier: string;
}): WorkspaceSourceRow[] {
  const tasks = uniqueWorkspaceTasks(input.tasks);
  const scoped = filterWorkspaceTasks(tasks, { ...input, period: "all", status: "all", query: "" });
  const mineIds = new Set(tasks.map((task) => task.id));
  const rows: WorkspaceSourceRow[] = scoped.filter((task) => !terminal.has(task.status)).map((task) => ({
    key: `task:${task.id}`, id: task.id, taskId: task.id, business: isSampleTask(task) ? "sample" : "purchase",
    code: task.code, title: task.materialName, detail: `${task.spec || "规格待补充"} · 需求 ${number(task.quantity)} ${task.unit}`,
    date: task.needDate || "", dateLabel: "需求日期", period: sourcePeriod(task.needDate, input.month),
    relation: isSampleTask(task) && task.status === "testing" ? `采购 ${task.buyer || "待指派"} · 测试 ${task.sampleTest?.testerName || "待指派"}` : `采购 ${task.buyer || "待指派"}`,
  }));
  const plans = new Map<string, ProcStockPlan>();
  for (const plan of input.plans) {
    const previous = plans.get(plan.id);
    if (!previous || (Date.parse(plan.updatedAt) || 0) > (Date.parse(previous.updatedAt) || 0)) plans.set(plan.id, plan);
  }
  for (const plan of plans.values()) {
    const related = plan.tasks.some((task) => mineIds.has(task.id));
    const created = Boolean(input.userId && plan.createdBy === input.userId);
    if (!related && !created) continue;
    if (input.productId !== "all" && plan.productId !== input.productId) continue;
    const suppliers = plan.batches.map((batch) => batch.supplierName.trim()).filter(Boolean);
    if (input.supplier !== "all" && (input.supplier === UNDETERMINED_SUPPLIER ? suppliers.length > 0 : !suppliers.includes(input.supplier))) continue;
    // 下单达标不等于收货或合格完成，仍保留后续跟进。
    if (plan.status === "completed" && plan.readinessStatus === "qualified" && !plan.qualityDataIssue && !plan.orderDataIssue) continue;
    const stage = plan.orderDataIssue || plan.qualityDataIssue ? "数据待核对" : plan.status === "completed" ? "下单达标，收货 / 检验待跟进" : plan.status === "in_progress" ? "下单中" : "未下单";
    rows.push({ key: `plan:${plan.id}`, id: plan.id, planId: plan.id, business: "stock", code: plan.code,
      title: plan.materialName, detail: `${stage} · 目标 ${number(plan.targetQty)} ${plan.unit}`,
      date: plan.targetDate || "", dateLabel: "目标日期", period: sourcePeriod(plan.targetDate, input.month),
      relation: related ? "关联本人采购任务" : "本人创建（非经办归属）" });
  }
  // 供应商属于订单行；不能因同一任务还有 A 供应商，就把 B 的订单带进 A 范围。
  const arrivalTasks = filterWorkspaceTasks(tasks, { ...input, supplier: "all", period: "all", status: "all", query: "" });
  for (const arrival of workspaceArrivals(arrivalTasks)) {
    if (input.supplier !== "all" && (input.supplier === UNDETERMINED_SUPPLIER ? Boolean(arrival.supplier) : arrival.supplier !== input.supplier)) continue;
    // 与服务端 replenish-core 的既有 ERP 作废 / 取消 / 终止词一致。
    if ([arrival.status, arrival.approvalStatus].some((value) => value && /作废|取消|终止|异常|cancel|void|abort/i.test(value))) continue;
    if (!arrival.quantityIssue && arrival.remainingQty === 0) continue;
    rows.push({ key: `arrival:${arrival.key}`, id: arrival.key, taskId: arrival.taskId, arrival, business: "arrival",
      code: arrival.orderNo ? `${arrival.orderNo}${arrival.lineNo ? ` · 行 ${arrival.lineNo}` : " · 行号待核对"}` : arrival.freeSample ? "免费样品 · 无正式采购单" : "采购单待关联",
      title: arrival.materialName, detail: `${arrival.supplier || "供应商待确认"} · 未收 ${arrival.remainingQty === null ? "待核对" : number(arrival.remainingQty)} ${arrival.unit}`,
      date: arrival.etaDate, dateLabel: "预计到货", period: sourcePeriod(arrival.etaDate, input.month),
      relation: `关联 ${arrival.sourceTaskCodes.join("、")}` });
  }
  return rows.sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999") || a.key.localeCompare(b.key));
}

export function partitionWorkspaceAggregation(rows: readonly WorkspaceSourceRow[], business: WorkspaceBusiness) {
  const relevant = rows.filter((row) => row.business === business);
  return {
    month: relevant.filter((row) => row.period === "month"),
    carryover: relevant.filter((row) => row.period === "carryover"),
    undated: relevant.filter((row) => row.period === "undated"),
    future: relevant.filter((row) => row.period === "future"),
  };
}
