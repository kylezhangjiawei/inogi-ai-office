import type { ProcurementTask } from "../lib/procurementApi";
import { getProcSampleFacts } from "../lib/procSampleFacts";

export type SampleFilter = "all" | "preparing" | "waiting" | "testing" | "followup" | "confirmed";

export function isSampleTask(task: ProcurementTask): boolean {
  return task.needSample || Boolean(task.sampleTest) || task.purchaseOrders.some((order) => order.freeSample);
}

export function sampleTaskStage(task: ProcurementTask): Exclude<SampleFilter, "all"> | "cancelled" {
  if (task.status === "cancelled") return "cancelled";
  if (task.status === "testing") return "testing";
  if (task.sampleTest?.result?.startsWith("failed_") && ["pending_sample", "pending_inquiry", "inquiring"].includes(task.status)) return "followup";
  if (task.status === "pending_sample") return "waiting";
  if (task.sampleTest?.result === "passed" && getProcSampleFacts(task).state === "confirmed") return "confirmed";
  return "preparing";
}

export function filterSampleTasks(tasks: ProcurementTask[], filter: SampleFilter, query: string): ProcurementTask[] {
  const needle = query.trim().toLocaleLowerCase();
  return tasks.filter((task) => isSampleTask(task)
    && (filter === "all" || sampleTaskStage(task) === filter)
    && (!needle || [task.code, task.materialName, task.spec, task.buyer, task.rdContact, task.sampleTest?.testerName,
      ...task.purchaseOrders.map((order) => order.supplierName)].filter(Boolean).join(" ").toLocaleLowerCase().includes(needle)));
}
