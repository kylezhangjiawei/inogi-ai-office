export type ProcurementSampleTestMessageType = "procurement_sample_test_request" | "procurement_sample_test_result";
export type ProcurementSampleTestMessageResult = "passed" | "failed_resample" | "failed_requote";

export interface ProcurementSampleTestMessageBody {
  type: ProcurementSampleTestMessageType;
  procurement_task_id: string;
  procurement_code: string;
  rd_task_id: string;
  rd_task_title: string;
  material_name: string;
  specification: string;
  quantity: number | null;
  unit: string;
  tester_name: string;
  buyer_name: string;
  round_id: string;
  result: ProcurementSampleTestMessageResult | null;
  conclusion: string;
  confirmed_at: string;
  route: string;
  action_label: string;
  next_action: string;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function parseProcurementSampleTestMessage(raw?: string | null): ProcurementSampleTestMessageBody | null {
  if (!raw) return null;
  try {
    const body: unknown = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) return null;
    const value = body as Record<string, unknown>;
    if (value.type !== "procurement_sample_test_request" && value.type !== "procurement_sample_test_result") return null;
    const result = value.result === "passed" || value.result === "failed_resample" || value.result === "failed_requote" ? value.result : null;
    return {
      type: value.type,
      procurement_task_id: text(value.procurement_task_id) || text(value.task_id),
      procurement_code: text(value.procurement_code),
      rd_task_id: text(value.rd_task_id),
      rd_task_title: text(value.rd_task_title),
      material_name: text(value.material_name),
      specification: text(value.specification),
      quantity: typeof value.quantity === "number" && Number.isFinite(value.quantity) ? value.quantity : null,
      unit: text(value.unit), tester_name: text(value.tester_name), buyer_name: text(value.buyer_name),
      round_id: text(value.round_id), result, conclusion: text(value.conclusion), confirmed_at: text(value.confirmed_at),
      route: text(value.route), action_label: text(value.action_label), next_action: text(value.next_action),
    };
  } catch { return null; }
}

export function sampleTestResultLabel(result: ProcurementSampleTestMessageResult | null): string {
  if (result === "passed") return "测试通过";
  if (result === "failed_resample") return "测试不通过，重新送样";
  if (result === "failed_requote") return "测试不通过，重新询价";
  return "测试结果待核对";
}

export function sampleTestNextAction(body: ProcurementSampleTestMessageBody): string {
  if (body.next_action) return body.next_action;
  if (body.type === "procurement_sample_test_request") return "请由指定研发测试人填写并确认测试结论。";
  if (body.result === "passed") return "请采购负责人查看测试结论，继续采购流程。";
  if (body.result === "failed_resample") return "请采购负责人安排重新送样，再由研发测试人确认。";
  if (body.result === "failed_requote") return "请采购负责人重新询价，并按新方案送样测试。";
  return "请核对本轮测试结果。";
}

export function sampleTestMessageRoute(body: ProcurementSampleTestMessageBody): string | null {
  if (!body.procurement_task_id) return null;
  if (body.type === "procurement_sample_test_request") return `/rd-my-workspace?sampleTest=${encodeURIComponent(body.procurement_task_id)}`;
  const route = body.route;
  if (!route.startsWith("/") || route.startsWith("//") || /[\\\u0000-\u001f]/.test(route)) return null;
  try {
    const target = new URL(route, "https://local.invalid");
    if (target.origin !== "https://local.invalid" || !["/proc-my-workspace", "/proc-cockpit"].includes(target.pathname)
      || target.searchParams.get("task") !== body.procurement_task_id) return null;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch { return null; }
}

export function sampleTestMessageSearchText(body: ProcurementSampleTestMessageBody): string {
  return [body.type === "procurement_sample_test_request" ? "样品测试待办 待测试" : `样品测试结果 ${sampleTestResultLabel(body.result)}`,
    body.procurement_code, body.procurement_task_id, body.material_name, body.specification, body.rd_task_title,
    body.tester_name, body.buyer_name, body.conclusion, sampleTestNextAction(body)].join(" ");
}

export function sampleTestMessageSummary(body: ProcurementSampleTestMessageBody): string {
  const status = body.type === "procurement_sample_test_request" ? `待 ${body.tester_name || "研发测试人"} 确认测试结论` : sampleTestResultLabel(body.result);
  return [body.procurement_code, body.material_name, status, sampleTestNextAction(body)].filter(Boolean).join(" · ");
}

export function withoutSampleTestQuery(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete("sampleTest");
  return next;
}
