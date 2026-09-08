export interface ProcurementTransferReturnedMessageBody {
  type: "procurement_transfer_returned";
  procurement_task_id: string;
  procurement_code: string;
  rd_task_id: string;
  rd_task_title: string;
  material_name: string;
  specification: string;
  quantity: number | null;
  unit: string;
  reason: string;
  returned_by: string;
  returned_at: string;
  route: string;
  next_action: string;
}

const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";

export function parseProcurementTransferReturnedMessage(raw?: string | null): ProcurementTransferReturnedMessageBody | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const body = value as Record<string, unknown>;
    if (body.type !== "procurement_transfer_returned") return null;
    return {
      type: body.type, procurement_task_id: text(body.procurement_task_id) || text(body.task_id),
      procurement_code: text(body.procurement_code), rd_task_id: text(body.rd_task_id), rd_task_title: text(body.rd_task_title),
      material_name: text(body.material_name), specification: text(body.specification),
      quantity: typeof body.quantity === "number" && Number.isFinite(body.quantity) ? body.quantity : null,
      unit: text(body.unit), reason: text(body.reason), returned_by: text(body.returned_by), returned_at: text(body.returned_at),
      route: text(body.route), next_action: text(body.next_action),
    };
  } catch { return null; }
}

export function transferReturnedMessageRoute(body: ProcurementTransferReturnedMessageBody): string | null {
  if (!body.rd_task_id || !body.route.startsWith("/") || body.route.startsWith("//") || /[\\\u0000-\u001f]/.test(body.route)) return null;
  try {
    const target = new URL(body.route, "https://local.invalid");
    if (target.origin !== "https://local.invalid") return null;
    if (target.pathname === "/rd-my-workspace" && target.searchParams.get("task") === body.rd_task_id) {
      return `/rd-my-workspace?task=${encodeURIComponent(body.rd_task_id)}`;
    }
    if (target.pathname.startsWith("/rd-task/") && decodeURIComponent(target.pathname.slice("/rd-task/".length)) === body.rd_task_id) {
      return `/rd-task/${encodeURIComponent(body.rd_task_id)}`;
    }
  } catch { /* Invalid or non-local task route. */ }
  return null;
}

export function transferReturnedNextAction(body: ProcurementTransferReturnedMessageBody): string {
  return body.next_action || "请返回原研发任务，核对退回原因后点击「继续转采购」；继续后系统自动分配采购负责人。无需管理员审批。";
}

export function transferReturnedMessageSummary(body: ProcurementTransferReturnedMessageBody): string {
  return [body.procurement_code, body.material_name, "采购已退回研发", body.reason, "可继续转采购"].filter(Boolean).join(" · ");
}

export function transferReturnedMessageSearchText(body: ProcurementTransferReturnedMessageBody): string {
  return [transferReturnedMessageSummary(body), body.procurement_task_id, body.rd_task_id, body.rd_task_title, body.specification,
    body.returned_by, transferReturnedNextAction(body)].join(" ");
}
