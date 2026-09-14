import type { ProcurementTask, ProcStatus } from "../lib/procurementApi";
import { isProcurementTaskOverdue, taskMainDate } from "./data";

export type WorkspacePeriod = "month" | "carryover" | "undated" | "all";
export type WorkspaceSort = "urgent" | "date" | "priority";
export const UNDETERMINED_SUPPLIER = "__undetermined_supplier__";

export interface WorkspaceFilters {
  month: string;
  period: WorkspacePeriod;
  productId: string;
  supplier: string;
  status: ProcStatus | "all";
  query: string;
}

export interface WorkspaceArrival {
  key: string;
  taskId: string;
  taskCode: string;
  materialName: string;
  spec: string;
  unit: string;
  orderId: string;
  tpOrderId: string;
  orderNo: string;
  lineNo: string;
  sourceRefIds: string[];
  sourceTaskIds: string[];
  sourceTaskCodes: string[];
  dateLinkIssue?: string;
  supplier: string;
  freeSample: boolean;
  etaDate: string;
  orderedQty: number | null;
  receivedQty: number | null;
  remainingQty: number | null;
  quantityIssue: boolean;
  status?: string;
  approvalStatus?: string;
}

const TERMINAL = new Set<ProcStatus>(["completed", "cancelled"]);
const PRIORITY = { high: 0, medium: 1, low: 2 };

/** 同一来源任务可能由多处订阅或关联返回；只保留该 ID 的最新快照。 */
export function uniqueWorkspaceTasks(tasks: readonly ProcurementTask[]): ProcurementTask[] {
  const byId = new Map<string, ProcurementTask>();
  for (const task of tasks) {
    const previous = byId.get(task.id);
    if (!previous || (Date.parse(task.updatedAt) || 0) > (Date.parse(previous.updatedAt) || 0)) byId.set(task.id, task);
  }
  return [...byId.values()];
}

/** 校验日历日期，避免 Date.parse 将 2 月 30 日等日期自动推到下个月。 */
function calendarDate(value?: string): string {
  const text = value?.trim() ?? "";
  if (!/^\d{4}-\d{2}-\d{2}(?:T\S+)?$/.test(text)) return "";
  const date = text.slice(0, 10);
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return "";
  if (text.length > 10 && !Number.isFinite(Date.parse(text))) return "";
  return date;
}

export function workspaceSuppliers(task: ProcurementTask): string[] {
  return [...new Set(task.purchaseOrders.map((order) => order.supplierName.trim()).filter(Boolean))];
}

/** 月份只使用需求日期，不拿创建日、Deadline 或预计到货日替代。 */
export function workspacePeriod(task: ProcurementTask, month: string): "month" | "carryover" | "undated" | "future" {
  const date = calendarDate(task.needDate);
  if (!date) return "undated";
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)) return "future";
  const taskMonth = date.slice(0, 7);
  return taskMonth === month ? "month" : taskMonth < month ? "carryover" : "future";
}

export function filterWorkspaceTasks(tasks: readonly ProcurementTask[], filters: WorkspaceFilters): ProcurementTask[] {
  const needle = filters.query.trim().toLocaleLowerCase();
  return tasks.filter((task) => {
    if (filters.productId !== "all" && task.productId !== filters.productId) return false;
    if (filters.status !== "all" && task.status !== filters.status) return false;
    if (filters.period !== "all" && workspacePeriod(task, filters.month) !== filters.period) return false;
    if (filters.period === "carryover" && TERMINAL.has(task.status)) return false;
    if (filters.supplier !== "all") {
      const suppliers = workspaceSuppliers(task);
      if (filters.supplier === UNDETERMINED_SUPPLIER ? suppliers.length > 0 : !suppliers.includes(filters.supplier)) return false;
    }
    return !needle || [task.code, task.materialName, task.spec, task.buyer, task.rdContact,
      task.requester, task.requesterDept, task.rdTaskTitle, task.consumableNote, task.sampleTest?.testerName,
      ...task.purchaseOrders.flatMap((order) => [order.tpOrderNo, order.supplierName])]
      .filter(Boolean).join(" ").toLocaleLowerCase().includes(needle);
  });
}

function compareDates(a?: string, b?: string): number {
  const first = calendarDate(a);
  const second = calendarDate(b);
  if (!first || !second) return first ? -1 : second ? 1 : 0;
  return first.localeCompare(second);
}

export function sortWorkspaceTasks(tasks: readonly ProcurementTask[], sort: WorkspaceSort): ProcurementTask[] {
  return [...tasks].sort((a, b) => {
    if (sort === "urgent") {
      const overdue = Number(isProcurementTaskOverdue(b)) - Number(isProcurementTaskOverdue(a));
      if (overdue) return overdue;
    }
    if (sort !== "date") {
      const priority = PRIORITY[a.priority] - PRIORITY[b.priority];
      if (priority) return priority;
    }
    return compareDates(taskMainDate(a).date, taskMainDate(b).date) || a.id.localeCompare(b.id);
  });
}

function validQuantity(value: number): number | null {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** ERP 标识中的空格、百分号和斜杠不作归一；只将纯空白识别为缺失。 */
function externalIdentity(value?: string): string {
  return value?.trim() ? value : "";
}

/** 到货安排展示订单行事实；未收数量不代表未验收、缺料或可用库存。 */
export function workspaceArrivals(tasks: readonly ProcurementTask[]): WorkspaceArrival[] {
  type Entry = { row: WorkspaceArrival; materialId: string | null; ambiguousKeys: string[] };
  const entries: Entry[] = [];
  const orderLines = new Map<string, Entry>();
  // 先按任务 ID 排序，多个任务关联同一订单行时稳定保留一个入口。
  for (const task of [...tasks].sort((a, b) => a.id.localeCompare(b.id))) {
    task.purchaseOrders.forEach((order, index) => {
      const orderNo = externalIdentity(order.tpOrderNo);
      const lineNo = externalIdentity(order.tpLineNo);
      const tpOrderId = externalIdentity(order.tpOrderId);
      const lineKey = tpOrderId && orderNo && lineNo && !order.freeSample ? JSON.stringify([tpOrderId, orderNo, lineNo]) : "";
      const orderedQty = validQuantity(order.orderedQty);
      const receivedQty = validQuantity(order.receivedQty);
      const quantityIssue = orderedQty === null || receivedQty === null || receivedQty > orderedQty;
      const row: WorkspaceArrival = {
        key: lineKey ? `line:${lineKey}` : JSON.stringify([task.id, order.id, index]),
        taskId: task.id, taskCode: task.code, materialName: task.materialName, spec: task.spec, unit: task.unit,
        orderId: order.id, tpOrderId, orderNo, lineNo, supplier: order.supplierName.trim(), freeSample: Boolean(order.freeSample),
        sourceRefIds: [order.id], sourceTaskIds: [task.id], sourceTaskCodes: [task.code],
        etaDate: calendarDate(order.etaDate), orderedQty, receivedQty,
        remainingQty: quantityIssue ? null : orderedQty! - receivedQty!, quantityIssue,
        status: order.status, approvalStatus: order.approvalStatus,
      };
      const materialId = task.materialId?.trim() || null;
      const previous = lineKey ? orderLines.get(lineKey) : undefined;
      if (previous) {
        const existing = previous.row;
        if (!existing.sourceRefIds.includes(order.id)) existing.sourceRefIds.push(order.id);
        if (!existing.sourceTaskIds.includes(task.id)) {
          existing.sourceTaskIds.push(task.id);
          existing.sourceTaskCodes.push(task.code);
        }
        const sourceConflict = existing.unit !== row.unit || previous.materialId !== materialId
          || existing.materialName !== row.materialName || existing.spec !== row.spec;
        if (sourceConflict) existing.dateLinkIssue = "同一订单行的关联物料或单位不一致，请先在任务详情核对关联";
        const conflict = existing.orderedQty !== orderedQty || existing.receivedQty !== receivedQty
          || sourceConflict
          || existing.supplier !== row.supplier || existing.freeSample !== row.freeSample;
        if (conflict || quantityIssue) {
          existing.quantityIssue = true;
          existing.remainingQty = null;
          if (existing.orderedQty !== orderedQty) existing.orderedQty = null;
          if (existing.receivedQty !== receivedQty) existing.receivedQty = null;
        }
        // 多处关联的预计日不一致时，不能将其中一个日期冒充确定的行交期。
        if (existing.etaDate !== row.etaDate) existing.etaDate = "";
        if (existing.status !== row.status) existing.status = undefined;
        if (existing.approvalStatus !== row.approvalStatus) existing.approvalStatus = undefined;
        return;
      }
      const ambiguousKeys: string[] = [];
      if (order.id) ambiguousKeys.push(JSON.stringify(["association", order.id]));
      // 同物料存在无行号关联时，也要与带行号的关联一起核对，避免新旧关联重复累计。
      // 缺物料 ID 的同名记录只作为歧义线索；保留各关联，绝不按名称合并。
      if (orderNo) ambiguousKeys.push(JSON.stringify(["material-order", orderNo,
        materialId ? ["id", materialId] : ["unknown", task.materialName, task.spec, task.unit]]));
      const entry = { row, materialId, ambiguousKeys };
      entries.push(entry);
      if (lineKey) orderLines.set(lineKey, entry);
    });
  }
  const ambiguousGroups = new Map<string, Entry[]>();
  for (const entry of entries) {
    for (const key of entry.ambiguousKeys) {
      const group = ambiguousGroups.get(key) ?? [];
      group.push(entry);
      ambiguousGroups.set(key, group);
    }
  }
  for (const [key, group] of ambiguousGroups) {
    if (group.length < 2) continue;
    if (key.startsWith('["material-order",') && group.every(({ row }) => row.lineNo && row.tpOrderId)) continue;
    for (const { row } of group) {
      row.quantityIssue = true;
      row.remainingQty = null;
    }
  }
  return entries.map(({ row }) => row).sort((a, b) => compareDates(a.etaDate, b.etaDate) || a.key.localeCompare(b.key));
}
