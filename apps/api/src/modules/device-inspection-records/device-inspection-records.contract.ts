import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { createHash } from 'node:crypto';

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
export type InspectionResult = 'PASS' | 'NG' | 'PENDING';
export type JsonObject = Record<string, any>;
export interface ResultProjection {
  mapperVersion: 'qc-result-v1';
  inspectionResult: InspectionResult;
  items: Array<{ id: string; result: 'PASS' | 'NG' | null }>;
}
export interface UploadEnvelope {
  contractVersion: 1;
  source: { clientId: string; uploaderAppVersion: string; recordAppVersion: string | null };
  snapshotSchema: 'factoryqc.workstation.v1';
  snapshot: JsonObject;
  resultProjection: ResultProjection;
}
export interface ItemSummary {
  id: string;
  name: string;
  result: 'PASS' | 'NG' | null;
  readStatus: string;
  measuredValue: string;
  unit: string;
}
export interface RecordSummary {
  id: string;
  testId: string;
  clientId: string;
  collectionAt: string;
  saveAt: string | null;
  receivedAt: string;
  uid: string | null;
  uidVerified: boolean;
  uidShort: string | null;
  serialNumber: string;
  model: string;
  market: string;
  station: string;
  operator: string;
  firmwareVersion: string | null;
  recordAppVersion: string | null;
  uploaderAppVersion: string;
  inspectionResult: InspectionResult;
  productionPass: boolean;
  itemCount: number;
  abnormalCount: number;
  pendingCount: number;
  abnormalItems: ItemSummary[];
  ruleVersion: string | null;
  protocolVersion: string | null;
}
export interface RecordPage { items: RecordSummary[]; total: number; page: number; pageSize: number }
export interface UploadReceipt { recordId: string; testId: string; payloadHash: string; receivedAt: string; duplicate: boolean }
export interface RecordQuery {
  page: number; pageSize: number; search?: string; from?: Date; to?: Date;
  result?: InspectionResult; abnormalOnly?: boolean; itemId?: string; readStatus?: string;
}

function bad(message: string): never { throw new BadRequestException(message); }
export function object(value: unknown): value is JsonObject { return !!value && typeof value === 'object' && !Array.isArray(value); }
function keys(value: JsonObject, allowed: string[], label: string) {
  if (Object.keys(value).some(key => !allowed.includes(key))) bad(`${label}包含未知字段`);
}
export function boundedText(value: unknown, label: string, maximum = 256, allowEmpty = true): string {
  if (typeof value !== 'string' || value.length > maximum || (!allowEmpty && !value.trim()) || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)) bad(`${label}格式无效`);
  return value;
}
export function optionalText(value: unknown, label: string, maximum = 256): string | null {
  return value == null ? null : boundedText(value, label, maximum);
}
/** Dates carry an explicit offset; never interpret a workstation date in the server timezone. */
export function parseDate(value: unknown, label: string): Date {
  if (typeof value !== 'string') bad(`${label}必须是带时区的ISO时间`);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) bad(`${label}必须是带时区的ISO时间`);
  const [, y, m, d, h, min, sec, zone] = match;
  const year = Number(y), month = Number(m), day = Number(d);
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (year < 1970 || year > 2200 || month < 1 || month > 12 || day < 1 || day > maxDay || Number(h) > 23 || Number(min) > 59 || Number(sec) > 59 || (zone !== 'Z' && (Number(zone.slice(1, 3)) > 14 || Number(zone.slice(4)) > 59 || (Number(zone.slice(1, 3)) === 14 && Number(zone.slice(4)) !== 0)))) bad(`${label}时间无效`);
  const result = new Date(value);
  if (!Number.isFinite(result.getTime())) bad(`${label}时间无效`);
  return result;
}
function boundedJson(value: unknown) {
  let nodes = 0;
  function visit(item: unknown, depth: number) {
    if (++nodes > 100000 || depth > 32) bad('快照结构过大或嵌套过深');
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'number') { if (!Number.isFinite(item)) bad('快照包含无效数值'); return; }
    if (typeof item === 'string') { if (item.length > 131072) bad('快照单个文本过长'); return; }
    if (Array.isArray(item)) { if (item.length > 8192) bad('快照数组过长'); item.forEach(child => visit(child, depth + 1)); return; }
    if (!object(item) || ![Object.prototype, null].includes(Object.getPrototypeOf(item))) bad('快照必须为JSON对象');
    const entries = Object.entries(item);
    if (entries.length > 512) bad('快照对象字段过多');
    for (const [key, child] of entries) {
      if (key.length > 256 || ['__proto__', 'prototype', 'constructor'].includes(key)) bad('快照字段名无效');
      visit(child, depth + 1);
    }
  }
  visit(value, 0);
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_UPLOAD_BYTES) throw new PayloadTooLargeException('检测记录不能超过2MB');
}
export function validateUpload(input: unknown): UploadEnvelope {
  boundedJson(input);
  if (!object(input)) bad('上传内容必须为对象');
  keys(input, ['contractVersion', 'source', 'snapshotSchema', 'snapshot', 'resultProjection'], '上传内容');
  if (input.contractVersion !== 1 || input.snapshotSchema !== 'factoryqc.workstation.v1') bad('不支持的检测记录版本');
  if (!object(input.source)) bad('source必须为对象');
  keys(input.source, ['clientId', 'uploaderAppVersion', 'recordAppVersion'], 'source');
  const clientId = boundedText(input.source.clientId, 'clientId', 128, false);
  if (!/^[A-Za-z0-9._-]+$/.test(clientId)) bad('clientId仅允许字母、数字、点、下划线及连字符');
  boundedText(input.source.uploaderAppVersion, 'uploaderAppVersion', 64, false);
  if (!Object.prototype.hasOwnProperty.call(input.source, 'recordAppVersion')) bad('recordAppVersion不能为空缺省，请使用null表示未知');
  optionalText(input.source.recordAppVersion, 'recordAppVersion', 64);
  const snapshot = input.snapshot;
  if (!object(snapshot) || !object(snapshot.identity) || !Array.isArray(snapshot.items) || snapshot.items.length < 1 || snapshot.items.length > 256) bad('snapshot缺少identity或items');
  if (snapshot.mode !== 'Workstation' || snapshot.saveStatus !== 'Saved') bad('仅接受Windows正式工作模式下已保存的检测记录');
  boundedText(snapshot.testId, 'snapshot.testId', 160, false);
  boundedText(snapshot.status, 'snapshot.status', 64, false);
  if (typeof snapshot.productionPass !== 'boolean') bad('snapshot.productionPass必须为布尔值');
  parseDate(snapshot.startedAt, 'snapshot.startedAt');
  for (const key of ['protocolReadAt', 'endedAt', 'savedAt']) if (snapshot[key] != null && snapshot[key] !== '') parseDate(snapshot[key], `snapshot.${key}`);
  for (const key of ['uid', 'serialNumber', 'model', 'market', 'station', 'operator', 'workOrder']) optionalText(snapshot.identity[key], `identity.${key}`, 256);
  for (const key of ['ruleVersion', 'protocolVersion', 'protocolFingerprint']) optionalText(snapshot[key], key, 256);
  const ids = new Set<string>();
  for (const item of snapshot.items) {
    if (!object(item)) bad('检测项目格式无效');
    const id = boundedText(item.id, '项目id', 64, false);
    if (ids.has(id)) bad('检测项目id重复');
    ids.add(id);
    boundedText(item.name, '项目名称', 256);
    boundedText(item.status, '项目读取状态', 64, false);
    optionalText(item.measuredValue, '项目实测值', 4096);
    optionalText(item.unit, '项目单位', 128);
  }
  const projection = input.resultProjection;
  if (!object(projection)) bad('resultProjection必须为对象');
  keys(projection, ['mapperVersion', 'inspectionResult', 'items'], 'resultProjection');
  if (projection.mapperVersion !== 'qc-result-v1' || !['PASS', 'NG', 'PENDING'].includes(projection.inspectionResult) || !Array.isArray(projection.items) || projection.items.length !== ids.size) bad('检测结果投影格式或项目数量无效');
  for (const item of projection.items) {
    if (!object(item)) bad('检测结果投影项目格式无效');
    keys(item, ['id', 'result'], '结果投影项目');
    if (!ids.delete(item.id) || !['PASS', 'NG', null].includes(item.result)) bad('结果投影项目与快照不一致');
  }
  return input as UploadEnvelope;
}
/** Canonical JSON: ordinal UTF-16 key sort, unchanged arrays, ECMAScript JSON numbers/strings. */
export function canonicalJson(value: any): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}
export function uploadHash(envelope: UploadEnvelope): string {
  const { uploaderAppVersion: _transportVersion, ...frozenSource } = envelope.source;
  return createHash('sha256').update(canonicalJson({ ...envelope, source: frozenSource }), 'utf8').digest('hex');
}
export function parseQuery(input: unknown, history = false): RecordQuery {
  if (!object(input)) bad('查询参数无效');
  keys(input, history ? ['page', 'pageSize'] : ['page', 'pageSize', 'search', 'from', 'to', 'result', 'abnormalOnly', 'itemId', 'readStatus'], '查询参数');
  const integer = (value: unknown, fallback: number, max: number) => {
    if (value == null) return fallback;
    if (typeof value !== 'string' || !/^\d+$/.test(value)) bad('页码或每页数量无效');
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 1 || number > max) bad('页码或每页数量超出范围');
    return number;
  };
  const result: RecordQuery = { page: integer(input.page, 1, 1000000), pageSize: integer(input.pageSize, 25, 100) };
  for (const key of ['search', 'itemId', 'readStatus'] as const) if (input[key] != null) {
    const value = boundedText(input[key], key, key === 'search' ? 128 : 64, false).trim();
    result[key] = value;
  }
  if (input.from != null) result.from = parseDate(input.from, 'from');
  if (input.to != null) result.to = parseDate(input.to, 'to');
  if (result.from && result.to && result.from > result.to) bad('开始时间不能晚于结束时间');
  if (input.result != null) { if (!['PASS', 'NG', 'PENDING'].includes(input.result)) bad('result无效'); result.result = input.result; }
  if (input.abnormalOnly != null) { if (!['true', 'false'].includes(input.abnormalOnly)) bad('abnormalOnly必须为true或false'); result.abnormalOnly = input.abnormalOnly === 'true'; }
  return result;
}

/** Verify the full wire UID; the display suffix and client flag alone never establish device identity. */
export function verifiedUid(snapshot: JsonObject): { uid: string | null; uidVerified: boolean } {
  const raw = typeof snapshot.identity.uid === 'string' ? snapshot.identity.uid.replace(/\s/g, '').toUpperCase() : '';
  const uid = /^[0-9A-F]{24}$/.test(raw) ? raw : null;
  const readings = Array.isArray(snapshot.protocolReadings) ? snapshot.protocolReadings.filter((r: any) => r?.id === 'uid') : [];
  const evidence = snapshot.uidEvidence;
  if (!uid || /^(0{24}|F{24})$/.test(uid) || !object(evidence) || evidence.status !== 'verified' || readings.length !== 1 || readings[0].status !== 'received') return { uid, uidVerified: false };
  const normalize = (value: unknown) => typeof value === 'string' ? value.replace(/\s/g, '').toUpperCase() : '';
  const hex = normalize(readings[0].responseHex);
  if (!/^F514EB87[0-9A-F]{32}$/.test(hex) || normalize(evidence.responseHex) !== hex || normalize(evidence.uid) !== uid || hex.slice(8, 32) !== uid) return { uid, uidVerified: false };
  let crc = 0xffffffff;
  for (const byte of Buffer.from(uid, 'hex')) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  const calculated = ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0').toUpperCase();
  return { uid, uidVerified: calculated === hex.slice(32) };
}
export function itemReadStatus(item: JsonObject): string {
  if (item.conditionDisplayStatus === 'WaitingMeasurement' || item.qcConditionResult === 'waiting') return 'WaitingMeasurement';
  if (['QC-009', 'QC-010'].includes(item.id)) {
    const fields = Array.isArray(item.readEvidence?.fields) ? item.readEvidence.fields : [];
    if (item.qcRuleEvidence?.validity?.status === 1 || fields.some((field: any) => field?.id === 'status' && field.numericValue === 1)) return 'WaitingMeasurement';
  }
  return item.status;
}
const ABNORMAL_READ_STATUSES = new Set(['ReadError', 'WaitingMeasurement', 'Interrupted', 'ValidityUnknown', 'Unsupported', 'PendingRetest', 'Fail']);
export function itemSummaries(envelope: UploadEnvelope) {
  const projection = new Map(envelope.resultProjection.items.map(item => [item.id, item.result]));
  const all: ItemSummary[] = envelope.snapshot.items.map((item: JsonObject) => ({ id: item.id, name: item.name, result: projection.get(item.id)!, readStatus: itemReadStatus(item), measuredValue: item.measuredValue ?? '', unit: item.unit ?? '' }));
  const abnormal = all.filter((item, index) => item.result === 'NG' || ABNORMAL_READ_STATUSES.has(item.readStatus) || envelope.snapshot.items[index].evidenceInvalidated === true);
  return { all, abnormal, pendingCount: all.filter((item, index) => item.result === null && envelope.snapshot.items[index].qcConditionResult !== 'display-only').length };
}
