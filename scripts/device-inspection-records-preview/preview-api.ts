/** Local-only synthetic adapter. Never imported by the production route. */
import { ITEM_OPTIONS, type DeviceInspectionRecordsApi, type FrozenItem, type InspectionRecordDetail, type InspectionRecordSummary } from "../../src/app/lib/deviceInspectionRecords";
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const today = new Date(Date.now() - 180000);
const at = (minutesAgo: number) => new Date(today.getTime() - minutesAgo * 60_000).toISOString();
const uids = ["11223344556677889A31F082", "22334455667788994B20E117", "33445566778899AA7C91D3A4"];
const samples: Record<number, { value: string; unit: string; standard: string; values: Record<string, string> }> = {
  1: { value: "Q7", unit: "", standard: "仅显示", values: { operator: "display" } },
  2: { value: "美国", unit: "", standard: "仅显示", values: { operator: "display" } },
  3: { value: "V4.0UA81 / 10", unit: "", standard: "仅显示", values: { operator: "display" } },
  4: { value: "8 组参数匹配", unit: "", standard: "与机型 / MAC 阀 A 类参数方案一致", values: { operator: "profile-slots", parameterPlan: "shipping", performanceClass: "A" } },
  5: { value: "MAC 阀", unit: "", standard: "有效 MAC 阀 / 方阀", values: { operator: "allowlist", allowedValues: "MAC 阀\n方阀" } },
  6: { value: "0", unit: "", standard: "正常模式 0", values: { operator: "equals", expected: "0" } },
  7: { value: "320", unit: "分钟", standard: "≤ 1230 分钟（20.5 小时）", values: { operator: "max", maximum: "1230", boundary: "inclusive" } },
  8: { value: "0", unit: "条", standard: "无当前报警", values: { operator: "equals", expected: "0" } },
  9: { value: "182", unit: "kPa", standard: "小于当前档位压力上限", values: { operator: "gear-upper", boundary: "exclusive", gearUpperBounds: '[{"gear":0,"maximum":315},{"gear":1,"maximum":200},{"gear":2,"maximum":235},{"gear":3,"maximum":275},{"gear":4,"maximum":300},{"gear":5,"maximum":300},{"gear":6,"maximum":315},{"gear":7,"maximum":320}]' } },
  10: { value: "35", unit: "℃", standard: "15～55 ℃", values: { operator: "range", minimum: "15", maximum: "55", boundary: "inclusive" } },
  11: { value: "52", unit: "%", standard: "1～100 %（0 为无反馈）", values: { operator: "range", minimum: "1", maximum: "100", boundary: "inclusive" } },
  12: { value: "1500", unit: "rpm", standard: "目标 1500 rpm ±15%", values: { operator: "tolerance", target: "1500", tolerancePercent: "15" } },
  13: { value: "0", unit: "次", standard: "≤ 3 次", values: { operator: "max", maximum: "3", boundary: "inclusive" } },
  14: { value: "29", unit: "", standard: "16～38", values: { operator: "range", minimum: "16", maximum: "38", boundary: "inclusive" } },
  15: { value: "35", unit: "℃", standard: "10～57 ℃", values: { operator: "range", minimum: "10", maximum: "57", boundary: "inclusive" } },
  16: { value: "3", unit: "级", standard: "已保存灵敏度 3 级", values: { operator: "equals", expected: "3" } },
  17: { value: "3", unit: "级", standard: "已保存音量 3 级", values: { operator: "equals", expected: "3" } },
  18: { value: "3", unit: "档", standard: "默认 3 档", values: { operator: "equals", expected: "3" } },
  19: { value: "37", unit: "", standard: "FPGA 版本 37", values: { operator: "equals", expected: "37" } },
  20: { value: "已完成 / 抹平值 204", unit: "", standard: "完成标志 1", values: { operator: "equals", expected: "1" } },
  21: { value: "已完成", unit: "", standard: "完成标志 1", values: { operator: "equals", expected: "1" } },
  23: { value: "101", unit: "kPa", standard: "98～105 kPa", values: { operator: "range", minimum: "98", maximum: "105", boundary: "inclusive" } },
};
function item(id: string, name: string, index: number, waiting: boolean): FrozenItem {
  const number = Number(id.slice(3)); const isPressure = number === 9;
  const sample = samples[number];
  const isDebug = number === 6 && index < 3 && index !== 1; const isVolume = number === 17 && index === 0;
  const result = isPressure && waiting ? null : isDebug || isVolume ? "NG" : number <= 3 ? null : "PASS";
  const measured = isPressure && waiting ? "—" : isDebug || isVolume ? "1" : number === 1 && index === 2 ? "Q6" : sample.value;
  return { id, name, measuredValue: measured, unit: isPressure && waiting ? "" : sample.unit, status: isPressure && waiting ? "WaitingMeasurement" : result === "NG" ? "Fail" : "ReadComplete",
    expectedValue: sample.standard,
    qcConditionResult: number <= 3 ? "display-only" : result === "PASS" ? "pass" : result === "NG" ? "fail" : "waiting",
    qcConditionExplanation: isPressure && waiting ? "设备返回状态 01，本次没有有效压力值。" : isVolume ? "80 回读的已保存音量为 1 级，出货标准要求 3 级，本次为 NG。" : isDebug ? "实测为调试模式 1，出货标准要求正常模式 0。" : "使用本次保存的检测结果。",
    qcRuleEvidence: { source: "builtin", version: "builtin-qc-20260910-v5", condition: sample.standard,
      validity: { status: isPressure && waiting ? 1 : 0 },
      config: { enabled: true, values: { ...sample.values, approval: "confirmed" } } },
    readEvidence: { readingId: isPressure ? "pressure-check" : id, protocolVersion: "builtin-20260910-v3", readAt: at(index * 60),
      requestHex: isPressure ? "F5 05 FA 78 00" : isDebug ? "F5 05 FA 75 00" : isVolume ? "F5 05 FA 80 00" : "", responseHex: isPressure ? waiting ? "F5 07 F8 78 01 00 00" : "F5 07 F8 78 00 00 B6" : isDebug ? "F5 05 FA 75 01" : isVolume ? "F5 05 FA 80 01" : "",
      fields: isPressure ? [{ id: "status", name: "数据状态", numericValue: waiting ? 1 : 0, value: waiting ? "测量未完成" : "有效", rawHex: waiting ? "01" : "00" }, { id: "value", name: "原始压力", numericValue: waiting ? 0 : 182, rawHex: waiting ? "0000" : "00B6", unit: "kPa" }] : isVolume ? [{ id: "value", name: "已保存音量", numericValue: 1, value: "1", rawHex: "01", unit: "级" }] : [] }, demoResult: result };
}
function make(index: number): InspectionRecordDetail {
  const waiting = index < 3; const uid = index === 3 ? uids[0] : uids[index % 3];
  const items = ITEM_OPTIONS.filter(([id]) => id !== "QC-022").map(([id, name]) => item(id, name, index, waiting));
  const abnormal = items.filter(value => value.demoResult === "NG" || value.status === "WaitingMeasurement");
  const id = `synthetic-${index + 1}`; const collectionAt = at(index * 68); const saveAt = new Date(Date.parse(collectionAt) + 2000).toISOString();
  return { id, testId: `DEMO-QC-0910-${String(16 - index).padStart(3, "0")}`, clientId: "LOCAL-DEMO-ONLY", collectionAt, saveAt, receivedAt: new Date(Date.parse(collectionAt) + 3000).toISOString(),
    uid, uidVerified: true, uidShort: uid.slice(-8), serialNumber: `DEMO-SN-${1000 + index}`, model: index === 2 ? "Q6" : "Q7", market: "美国", station: "演示工位", operator: "演示操作员",
    firmwareVersion: "V4.0UA81-10", recordAppVersion: index === 1 ? "0.5.11" : "0.5.12", uploaderAppVersion: "0.5.12", inspectionResult: index === 1 ? "PENDING" : index < 3 ? "NG" : "PASS",
    productionPass: false, itemCount: items.length, abnormalCount: abnormal.length, pendingCount: waiting ? 1 : 0,
    abnormalItems: abnormal.map(value => ({ id: value.id, name: value.name, result: value.demoResult === "NG" ? "NG" : null, readStatus: value.status || "", measuredValue: String(value.measuredValue), unit: String(value.unit) })),
    ruleVersion: "builtin-qc-20260910-v5", protocolVersion: "builtin-20260910-v3", contractVersion: 1, snapshotSchema: "factoryqc.workstation.v1",
    snapshot: { testId: id, identity: { uid, model: index === 2 ? "Q6" : "Q7", serialNumber: `DEMO-SN-${1000 + index}` }, items,
      protocolReadings: [{ id: "compressor", status: "received", fields: [{ id: "gear", numericValue: 3 }] }],
      protocolProfileId: "v4-20260910", qcRulesSnapshot: { source: "builtin", version: "builtin-qc-20260910-v5", synthetic: true } },
    resultProjection: { mapperVersion: "qc-result-v1", inspectionResult: index === 1 ? "PENDING" : index < 3 ? "NG" : "PASS", items: items.map(value => ({ id: value.id, result: value.demoResult })) }, payloadHash: "local-synthetic-example-not-a-production-hash" };
}
const records = Array.from({ length: 13 }, (_, index) => make(index));
const summary = ({ snapshot, resultProjection, contractVersion, snapshotSchema, payloadHash, ...rest }: InspectionRecordDetail): InspectionRecordSummary => rest;
async function pause(signal?: AbortSignal) { await new Promise(resolve => setTimeout(resolve, 180)); if (signal?.aborted) throw new DOMException("Aborted", "AbortError"); }
export const previewApi: DeviceInspectionRecordsApi = {
  async list(query, signal) {
    await pause(signal);
    if (query.search === "demo:error") throw new Error("本地演示：模拟服务暂时不可用，请清空搜索后重试。");
    const matches = records.filter(record => (!query.abnormalOnly || record.abnormalCount > 0) && (!query.from || record.collectionAt >= query.from) && (!query.to || record.collectionAt <= query.to) &&
      (!query.search || [record.uid, record.testId, record.serialNumber].join(" ").toLowerCase().includes(query.search.toLowerCase())) &&
      (!query.itemId && !query.readStatus || record.snapshot.items?.some(value => (!query.itemId || value.id === query.itemId) && (!query.readStatus || value.status === query.readStatus))));
    return { items: matches.slice((query.page - 1) * query.pageSize, query.page * query.pageSize).map(summary), total: matches.length, page: query.page, pageSize: query.pageSize };
  },
  async detail(id, signal) { await pause(signal); const record = records.find(value => value.id === id); if (!record) throw new Error("没有找到演示记录。"); return clone(record); },
  async history(id, page = 1, pageSize = 25, signal) { await pause(signal); const record = records.find(value => value.id === id); const matches = records.filter(value => value.uid === record?.uid); return { items: matches.slice((page - 1) * pageSize, page * pageSize).map(summary), total: matches.length, page, pageSize, deviceUid: record?.uid || null, available: Boolean(record?.uidVerified), reason: null }; },
};
