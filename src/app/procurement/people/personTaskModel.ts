import type { ProcurementTask } from "../../lib/procurementApi";
import { getProcSampleFacts } from "../../lib/procSampleFacts";
import { isSampleTask } from "../sampleWorkspaceModel";
import { uniqueWorkspaceTasks, workspacePeriod } from "../procurementWorkspaceModel";

export type PersonTaskBusiness = "all" | "purchase" | "sample";
export type PersonTaskPeriod = "month" | "all" | "carryover" | "undated";
export type PersonTaskState = "active" | "all" | "closed";
export interface PersonTaskFilters {
  month: string;
  business: PersonTaskBusiness;
  period: PersonTaskPeriod;
  state: PersonTaskState;
  query: string;
}
export const personTaskIsActive = (task: ProcurementTask) => !["completed", "cancelled"].includes(task.status);
export const personTaskNeedDate = (task: ProcurementTask) => workspacePeriod(task, "2000-01") === "undated" ? "" : task.needDate!.slice(0, 10);

/** Reminders use the person's complete source, independently of the list's search and category. */
export function personTaskView(tasks: readonly ProcurementTask[], filters: PersonTaskFilters) {
  const unique = uniqueWorkspaceTasks(tasks);
  const active = unique.filter(personTaskIsActive);
  const carryover = active.filter((task) => workspacePeriod(task, filters.month) === "carryover");
  const undated = active.filter((task) => workspacePeriod(task, filters.month) === "undated");
  const needle = filters.query.trim().toLocaleLowerCase();
  const filtered = unique.filter((task) => {
    if (filters.state === "active" && !personTaskIsActive(task)) return false;
    if (filters.state === "closed" && personTaskIsActive(task)) return false;
    if (filters.business !== "all" && isSampleTask(task) !== (filters.business === "sample")) return false;
    if (filters.period !== "all" && workspacePeriod(task, filters.month) !== filters.period) return false;
    if (["carryover", "undated"].includes(filters.period) && !personTaskIsActive(task)) return false;
    return !needle || [task.code, task.materialName, task.spec, task.rdTaskTitle, task.rdContact,
      task.requester, task.sampleTest?.testerName, ...task.purchaseOrders.flatMap((order) => [order.tpOrderNo, order.supplierName])]
      .filter(Boolean).join(" ").toLocaleLowerCase().includes(needle);
  });
  const ordered = filtered.sort((a, b) => (personTaskNeedDate(a) || "9999").localeCompare(personTaskNeedDate(b) || "9999") || a.id.localeCompare(b.id));
  return { tasks: ordered, carryover, undated, total: unique.length, active: active.length };
}

/** Preserve existing node wording, but don't present a historical tester as this round's handler. */
export function personTaskNext(task: ProcurementTask, next?: string): string {
  if (!personTaskIsActive(task)) return "已结束，查看历史记录";
  if (task.status === "testing") {
    const facts = getProcSampleFacts(task);
    if (facts.state === "confirmed" && facts.evidence.roundId === task.sampleTest?.roundId && !task.sampleTest?.result) {
      return `等待 ${task.sampleTest?.testerName || "测试人员"} 提交测试结论`;
    }
    return "核对本轮样品与测试分派";
  }
  return next || "等待当前节点处理";
}
