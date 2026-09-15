/** Uploaded, frozen evidence. This page never reevaluates a historical rule. */
export type JsonObject = { [key: string]: unknown };
export type InspectionResult = "PASS" | "NG" | "PENDING";
export interface RecordItemSummary {
  id: string; name: string; result: "NG" | null; readStatus: string; measuredValue: string; unit: string;
}
export interface InspectionRecordSummary {
  id: string; testId: string; clientId: string; collectionAt: string; saveAt: string | null; receivedAt: string;
  uid: string | null; uidVerified: boolean; uidShort: string | null; serialNumber: string | null;
  model: string | null; market: string | null; station: string | null; operator: string | null;
  firmwareVersion: string | null; recordAppVersion: string | null; uploaderAppVersion: string;
  inspectionResult: InspectionResult; productionPass: boolean; itemCount: number; abnormalCount: number;
  pendingCount: number; abnormalItems: RecordItemSummary[]; ruleVersion: string | null; protocolVersion: string | null;
}
export interface FrozenItem extends JsonObject {
  id: string; name: string; measuredValue?: string; unit?: string; expectedValue?: string; status?: string;
  detail?: string; qcConditionResult?: string; qcConditionExplanation?: string; conditionDisplayStatus?: string;
  readEvidence?: JsonObject; qcRuleEvidence?: JsonObject;
}
export interface FrozenSnapshot extends JsonObject {
  items?: FrozenItem[]; protocolReadings?: JsonObject[]; qcRulesSnapshot?: JsonObject; identity?: JsonObject;
}
export interface InspectionRecordDetail extends InspectionRecordSummary {
  contractVersion: number; snapshotSchema: string; snapshot: FrozenSnapshot;
  resultProjection: JsonObject; payloadHash: string;
}
export interface RecordPage<T = InspectionRecordSummary> { items: T[]; total: number; page: number; pageSize: number }
export interface RecordHistory extends RecordPage { deviceUid: string | null; available: boolean; reason: string | null }
export interface RecordQuery {
  page: number; pageSize: number; search?: string; from?: string; to?: string; abnormalOnly?: boolean;
  result?: InspectionResult; itemId?: string; readStatus?: string;
}
export interface DeviceInspectionRecordsApi {
  list(query: RecordQuery, signal?: AbortSignal): Promise<RecordPage>;
  detail(id: string, signal?: AbortSignal): Promise<InspectionRecordDetail>;
  history(id: string, page?: number, pageSize?: number, signal?: AbortSignal): Promise<RecordHistory>;
}

export const ITEM_OPTIONS = [
  ["QC-001", "机器型号"], ["QC-002", "发货市场 / 区域"], ["QC-003", "固件完整版本"],
  ["QC-004", "内置参数"], ["QC-005", "阀类型"], ["QC-006", "Debug 状态"],
  ["QC-007", "总使用时长"], ["QC-008", "当前报警"], ["QC-009", "压力传感器"],
  ["QC-010", "机器内部温度"], ["QC-011", "风扇实际反馈比例"], ["QC-012", "压缩机实际转速"],
  ["QC-013", "压缩机重启次数"], ["QC-014", "微压差值平均值"], ["QC-015", "V 压传感器温度"],
  ["QC-016", "已保存灵敏度"], ["QC-017", "按键音量（已保存）"], ["QC-018", "当前档位"],
  ["QC-019", "FPGA 版本"], ["QC-020", "230 状态与抹平值"], ["QC-021", "232 状态"],
  ["QC-022", "开机基础大气压（历史）"], ["QC-023", "当前大气压"],
] as const;
export const READ_STATES: Record<string, string> = {
  WaitingMeasurement: "测量未完成", ReadError: "读取无效", Timeout: "读取超时", Unsupported: "未支持",
  NotSupported: "未支持", NotRead: "未读取", NotChecked: "未检测", MissingRule: "缺少标准",
  ValidityUnknown: "有效性未知", ValueReceived: "已读取", Passed: "已读取", Failed: "已读取",
  Pass: "已读取", Ng: "已读取", Fail: "已读取", ReadComplete: "已读取", AwaitingVerdict: "已读取",
  WaitingPowerCheck: "待掉电比对", AwaitingPowerCheck: "待掉电比对", Received: "已读取", received: "已读取", Interrupted: "通信中断",
};
export const objectValue = (value: unknown): JsonObject => value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
export const textValue = (value: unknown, fallback = "—") => typeof value === "string" && value.trim() ? value : typeof value === "number" ? String(value) : fallback;
export const snapshotItems = (record: InspectionRecordDetail): FrozenItem[] => Array.isArray(record.snapshot?.items) ? record.snapshot.items : [];
export const displayedResult = (result: unknown): "PASS" | "NG" | "—" => result === "PASS" ? "PASS" : result === "NG" ? "NG" : "—";
export function itemResult(item: FrozenItem, record?: InspectionRecordDetail): "PASS" | "NG" | "—" {
  const projection = record?.resultProjection;
  const matches = Array.isArray(projection?.items) ? projection.items.map(objectValue).filter(p => p.id === item.id) : [];
  if (matches.length === 1) return displayedResult(matches[0].result);
  // Without the frozen display projection we cannot know whether a stored condition was later invalidated.
  return "—";
}
export function readState(item: FrozenItem): string {
  const validity = objectValue(objectValue(item.qcRuleEvidence).validity);
  const fields = objectValue(item.readEvidence).fields;
  const wireState = Array.isArray(fields) ? fields.map(objectValue).find(field => field.id === "status")?.numericValue : undefined;
  if (item.conditionDisplayStatus === "WaitingMeasurement" || item.qcConditionResult === "waiting" ||
    ["QC-009", "QC-010"].includes(item.id) && (validity.status === 1 || wireState === 1)) return "测量未完成";
  const state = textValue(item.status, "NotRead");
  return READ_STATES[state] ?? state;
}
export function measuredText(item?: FrozenItem): string {
  if (!item) return "—";
  const value = textValue(item.measuredValue);
  return value === "—" ? value : `${value}${item.unit ? ` ${item.unit}` : ""}`;
}
export function gearText(record: InspectionRecordDetail, item: FrozenItem): string {
  const pressure = objectValue(objectValue(item.qcRuleEvidence).pressureComparison);
  let gear: unknown = pressure.gear;
  if (gear === undefined && Array.isArray(record.snapshot.protocolReadings)) {
    const reading = record.snapshot.protocolReadings.find(r => r.id === "compressor" && r.status === "received");
    const fields = Array.isArray(reading?.fields) ? reading.fields.map(objectValue) : [];
    gear = fields.find(f => f.id === "gear")?.numericValue;
  }
  return gear === 0 ? "A 档" : gear === 7 ? "S 档" : Number.isInteger(gear) && Number(gear) >= 1 && Number(gear) <= 6 ? `${gear} 档` : "未记录";
}
export function recordQueryString(query: RecordQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== "") params.set(key, String(value));
  return params.toString();
}
export function dateRange(preset: string, fromDate: string, toDate: string, now = new Date()): { from?: string; to?: string; error?: string } {
  if (preset === "all") return {};
  const start = new Date(now); const end = new Date(now);
  if (preset === "custom") {
    if (!fromDate || !toDate) return { error: "请选择完整的起止日期。" };
    start.setTime(new Date(`${fromDate}T00:00:00`).getTime());
    end.setTime(new Date(`${toDate}T23:59:59.999`).getTime());
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end) return { error: "开始日期不能晚于结束日期。" };
  } else {
    start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - (preset === "today" ? 0 : preset === "7" ? 6 : 29));
  }
  return { from: start.toISOString(), to: end.toISOString() };
}
export function sameDevicePrevious(current: InspectionRecordDetail, candidates: InspectionRecordSummary[]) {
  if (!current.uidVerified || !current.uid) return undefined;
  return candidates.filter(item => item.id !== current.id && item.uidVerified && item.uid === current.uid &&
    new Date(item.collectionAt).getTime() < new Date(current.collectionAt).getTime())
    .sort((a, b) => Date.parse(b.collectionAt) - Date.parse(a.collectionAt))[0];
}
export function compareItems(current: InspectionRecordDetail, previous: InspectionRecordDetail) {
  const prior = new Map(snapshotItems(previous).map(item => [item.id, item]));
  const currentItems = snapshotItems(current);
  const all = [...currentItems, ...snapshotItems(previous).filter(item => !currentItems.some(now => now.id === item.id))];
  return all.map(item => {
    const now = currentItems.find(next => next.id === item.id); const before = prior.get(item.id);
    const nowResult = now ? itemResult(now, current) : "—"; const beforeResult = before ? itemResult(before, previous) : "—";
    const standardChanged = now?.expectedValue !== before?.expectedValue ||
      JSON.stringify(objectValue(now?.qcRuleEvidence).config ?? null) !== JSON.stringify(objectValue(before?.qcRuleEvidence).config ?? null);
    const readingChanged = now?.status !== before?.status || now?.conditionDisplayStatus !== before?.conditionDisplayStatus ||
      now?.evidenceInvalidated !== before?.evidenceInvalidated ||
      (now ? readState(now) : null) !== (before ? readState(before) : null) ||
      JSON.stringify(objectValue(now?.qcRuleEvidence).validity ?? null) !== JSON.stringify(objectValue(before?.qcRuleEvidence).validity ?? null);
    return { id: item.id, name: item.name, current: measuredText(now), previous: measuredText(before), currentResult: nowResult,
      previousResult: beforeResult, currentReadState: now ? readState(now) : "未记录", previousReadState: before ? readState(before) : "未记录",
      changed: measuredText(now) !== measuredText(before) || nowResult !== beforeResult || standardChanged || readingChanged,
      standardChanged, readingChanged, missing: !now || !before };
  });
}
