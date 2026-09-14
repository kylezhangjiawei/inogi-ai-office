import type { ShipmentAction, ShipmentBatch, ShipmentDraftInput, ShipmentHistory, ShipmentRecord, ShipmentState } from './shipmentTypes';

// Disposable demonstration state. Actual warehouse, quality and target services are not called.
export const shipmentSeedIds = {
  firstShipment: 'ship-100', secondShipment: 'ship-80', draftShipment: 'ship-draft',
  firstBatch: 'batch-01', secondBatch: 'batch-02', unreleasedBatch: 'batch-03',
} as const;

const fail = (message: string): never => { throw new Error(message); };
const key = (value: string) => value.trim().toLocaleUpperCase('en-US');
const copyRecord = (record: ShipmentRecord): ShipmentRecord => ({ ...record, serialNumbers: [...record.serialNumbers] });
function text(value: unknown, label: string, required = true, max = 120): string {
  if (typeof value !== 'string') return fail(`${label}格式无效`);
  const clean = value.trim();
  if (required && !clean) fail(`请填写${label}`);
  if (clean.length > max) fail(`${label}不能超过 ${max} 字`);
  return clean;
}
function quantity(value: unknown, label = '出货数量', positive = true): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || (positive && value === 0)) return fail(`${label}须为${positive ? '大于 0 的' : '非负'}整数`);
  return value;
}
function calendarDate(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01') return fail(`${label}须为有效日期`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail(`${label}须为有效日期`);
  return value;
}
function operationTime(nowIso: string): { at: string; today: string } {
  const time = Date.parse(nowIso);
  if (!Number.isFinite(time)) return fail('操作时间无效');
  // All demonstration dates use the business calendar in Asia/Shanghai.
  return { at: new Date(time).toISOString(), today: new Date(time + 8 * 60 * 60 * 1000).toISOString().slice(0, 10) };
}
function findRecord(state: ShipmentState, id: string): ShipmentRecord {
  return state.records.find((record) => record.id === id) ?? fail('出货记录已不存在，请重新选择');
}
function findBatch(state: ShipmentState, id: string): ShipmentBatch {
  return state.batches.find((batch) => batch.id === id) ?? fail('请选择有效的生产批次');
}
function validateBatchQuantity(batch: ShipmentBatch) {
  quantity(batch.completedQty, '完工数量', false);
  quantity(batch.inspectionPassedQty, '终检合格数量', false);
  quantity(batch.releasedQty, '授权放行数量', false);
  if (batch.inspectionPassedQty > batch.completedQty || batch.releasedQty > batch.inspectionPassedQty) fail('批次完工、终检和授权放行数量不一致，请先核对批次依据');
}

export function availableToShip(state: ShipmentState, batchId: string): number {
  const batch = findBatch(state, batchId);
  validateBatchQuantity(batch);
  const shipped = state.records.filter((record) => record.batchId === batchId && record.status === 'confirmed').reduce((sum, record) => sum + record.quantity, 0);
  return Math.max(0, batch.releasedQty - shipped);
}

export function shipmentMonthSummary(state: ShipmentState, month: string): { target: number | null; completed: number | null; shipped: number; remaining: number | null; achievement: number | null; count: number } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) fail('请选择有效月份');
  const records = state.records.filter((record) => record.status === 'confirmed' && record.actualDate.slice(0, 7) === month);
  const shipped = records.reduce((sum, record) => sum + record.quantity, 0);
  const target = state.months[month]?.target ?? null;
  const completed = state.months[month]?.completed ?? null;
  return { target, completed, shipped, remaining: target === null ? null : Math.max(0, target - shipped), achievement: target !== null && target > 0 ? shipped / target : null, count: records.length };
}

function serials(state: ShipmentState, values: unknown, amount: number, excludingRecordId?: string): string[] {
  if (!Array.isArray(values)) return fail('SN 列表格式无效');
  if (values.length > amount) fail('SN 数量不能超过出货数量');
  const cleaned = values.map((value) => text(value, 'SN', true, 128));
  const seen = new Set<string>();
  for (const value of cleaned) {
    if (seen.has(key(value))) fail(`SN 重复：${value}`);
    seen.add(key(value));
  }
  const used = new Set(state.records.filter((record) => record.id !== excludingRecordId && record.status !== 'reversed').flatMap((record) => record.serialNumbers.map(key)));
  for (const value of cleaned) if (used.has(key(value))) fail(`SN 已关联其他有效登记：${value}`);
  return cleaned;
}

function draftInput(state: ShipmentState, action: ShipmentDraftInput, today: string, recordId?: string): ShipmentDraftInput {
  const documentNo = text(action.documentNo, '出库单号', true, 80);
  if (state.records.some((record) => record.id !== recordId && key(record.documentNo) === key(documentNo))) fail('出库单号已存在，冲销记录的原单号也不能重复使用');
  const actualDate = calendarDate(text(action.actualDate, '实际出货日期', true, 10), '实际出货日期');
  if (actualDate > today) fail('实际出货日期不能晚于今天');
  const batchId = text(action.batchId, '生产批次');
  findBatch(state, batchId);
  const amount = quantity(action.quantity);
  return {
    documentNo, actualDate, batchId, quantity: amount,
    customer: text(action.customer, '客户'), orderNo: text(action.orderNo, '客户订单', true, 80),
    handler: text(action.handler, '经办人'), note: text(action.note, '备注', false, 2000),
    serialNumbers: serials(state, action.serialNumbers, amount, recordId),
  };
}

/** Throws a Chinese validation message without changing state. Missing SN does not block shipping. */
export function validateShipmentAction(state: ShipmentState, action: ShipmentAction, nowIso = new Date().toISOString()): void {
  const { today } = operationTime(nowIso);
  if (!action || typeof action !== 'object' || !['create', 'edit', 'confirm', 'reverse', 'sn'].includes(action.kind)) fail('不支持的出货操作');
  text(action.actor, '操作人');
  if (action.kind === 'create') { draftInput(state, action, today); return; }
  const record = findRecord(state, text(action.recordId, '出货记录'));
  if (action.kind === 'edit') {
    if (record.status !== 'draft') fail('只有待确认登记可以修改，已出库记录须通过冲销 / 更正保留原始记录');
    text(action.reason, '修改原因', true, 1000);
    draftInput(state, action, today, record.id);
  } else if (action.kind === 'confirm') {
    if (record.status !== 'draft') fail('只有待确认登记可以确认实际出库，不能重复确认');
    draftInput(state, record, today, record.id);
    const batch = findBatch(state, record.batchId);
    validateBatchQuantity(batch);
    if (!batch.releaseEvidence.trim() || !batch.releasedOn || batch.releasedQty === 0) fail('该批次尚无质量授权放行依据，终检合格不能代替质量放行');
    const releasedOn = calendarDate(batch.releasedOn, '质量放行日期');
    if (record.actualDate < releasedOn) fail('实际出货日期不能早于质量放行日期');
    if (record.quantity > availableToShip(state, batch.id)) fail('出货数量超过本批剩余授权放行数量，请核对或拆分登记');
  } else if (action.kind === 'reverse') {
    if (record.status !== 'confirmed') fail('只有已出库记录可以冲销，不能重复冲销');
    text(action.reason, '冲销 / 更正原因', true, 1000);
    if (typeof action.createReplacement !== 'boolean') fail('请选择是否生成更正登记');
  } else if (action.kind === 'sn') {
    if (record.status !== 'confirmed') fail('只有已出库记录可以补充 SN；待确认记录请使用修改登记');
    text(action.reason, 'SN 调整原因', true, 1000);
    const updated = serials(state, action.serialNumbers, record.quantity, record.id);
    if (updated.length === record.serialNumbers.length && updated.every((value, index) => value === record.serialNumbers[index])) fail('SN 列表没有变化');
  }
}

export function applyShipmentAction(state: ShipmentState, expectedVersion: number, action: ShipmentAction, nowIso = new Date().toISOString()): ShipmentState {
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion !== state.version) fail('数据已变化，请重新核对后提交');
  validateShipmentAction(state, action, nowIso);
  const { at, today } = operationTime(nowIso);
  const actor = text(action.actor, '操作人');
  const next: ShipmentState = {
    version: state.version + 1, batches: state.batches.map((batch) => ({ ...batch })), records: state.records.map(copyRecord),
    months: Object.fromEntries(Object.entries(state.months).map(([month, values]) => [month, { ...values }])),
    history: state.history.map((item) => ({ ...item, before: item.before ? copyRecord(item.before) : null, after: copyRecord(item.after) })),
  };
  function uniqueId(prefix: string) {
    let id = `${prefix}-${next.version}`; let suffix = 1;
    while (next.records.some((record) => record.id === id)) id = `${prefix}-${next.version}-${suffix++}`;
    return id;
  }
  function history(kind: ShipmentHistory['kind'], before: ShipmentRecord | null, after: ShipmentRecord, reason: string) {
    next.history.push({ id: `ship-history-${next.version}-${next.history.length + 1}`, recordId: after.id, kind, actor, at, reason, before: before ? copyRecord(before) : null, after: copyRecord(after) });
  }
  if (action.kind === 'create') {
    const record: ShipmentRecord = { ...draftInput(state, action, today), id: uniqueId('ship'), status: 'draft', createdAt: at, confirmedAt: null, reversedAt: null, replacementFor: null };
    next.records.push(record); history('create', null, record, '登记分批出货，等待确认实际出库');
    return next;
  }
  const record = findRecord(next, action.recordId);
  const before = copyRecord(record);
  if (action.kind === 'edit') {
    Object.assign(record, draftInput(state, action, today, record.id));
    history('edit', before, record, text(action.reason, '修改原因', true, 1000));
  } else if (action.kind === 'confirm') {
    record.status = 'confirmed'; record.confirmedAt = at;
    history('confirm', before, record, '已确认实际出库，按实际出货日期计入出货统计');
  } else if (action.kind === 'reverse') {
    const reason = text(action.reason, '冲销 / 更正原因', true, 1000);
    record.status = 'reversed'; record.reversedAt = at;
    history('reverse', before, record, reason);
    if (action.createReplacement) {
      let suffix = 1;
      const base = record.documentNo.slice(0, 64);
      let documentNo = `${base}-R${suffix}`;
      while (next.records.some((item) => key(item.documentNo) === key(documentNo))) documentNo = `${base}-R${++suffix}`;
      const replacement: ShipmentRecord = { ...copyRecord(before), id: uniqueId('ship-replacement'), documentNo, status: 'draft', createdAt: at, confirmedAt: null, reversedAt: null, replacementFor: record.id };
      next.records.push(replacement);
      history('create', null, replacement, `由 ${record.documentNo} 生成更正登记：${reason}；重新确认前不计入出货`);
    }
  } else if (action.kind === 'sn') {
    record.serialNumbers = serials(state, action.serialNumbers, record.quantity, record.id);
    history('sn', before, record, text(action.reason, 'SN 调整原因', true, 1000));
  }
  return next;
}

export function createShipmentState(): ShipmentState {
  const batches: ShipmentBatch[] = [
    { id: 'batch-01', batchNo: 'B-FG-0901', productCode: 'IN-100', productName: '智能控制组件', planNo: 'PP-202609-001', completedQty: 100, inspectionPassedQty: 100, inspectionEvidence: 'FQC-0905-01 · 终检合格', releasedQty: 100, releaseEvidence: 'QA-REL-0905-01 · 质量授权放行', releasedOn: '2026-09-05', softwareVersion: 'V1.1.0', hardwareVersion: 'HW-C', bomVersion: 'BOM-V3.2', versionQuantity: 100, source: '演示生产批次档案' },
    { id: 'batch-02', batchNo: 'B-FG-0902', productCode: 'IN-100', productName: '智能控制组件', planNo: 'PP-202609-002', completedQty: 116, inspectionPassedQty: 116, inspectionEvidence: 'FQC-0907-02 · 终检合格', releasedQty: 100, releaseEvidence: 'QA-REL-0907-02 · 100 台质量授权放行', releasedOn: '2026-09-07', softwareVersion: 'V1.1.0', hardwareVersion: 'HW-C', bomVersion: 'BOM-V3.2', versionQuantity: 100, source: '演示生产批次档案；其余 16 台等待放行' },
    { id: 'batch-03', batchNo: 'B-FG-0831', productCode: 'IN-200', productName: '工业通信组件', planNo: 'PP-202608-018', completedQty: 50, inspectionPassedQty: 50, inspectionEvidence: 'FQC-0831-18 · 终检合格', releasedQty: 0, releaseEvidence: '', releasedOn: '', softwareVersion: '', hardwareVersion: 'HW-B', bomVersion: '', versionQuantity: 0, source: '演示历史批次；版本依据待补齐' },
  ];
  const records: ShipmentRecord[] = [
    { id: 'ship-100', documentNo: 'SHIP-0906-01', actualDate: '2026-09-06', customer: '华东客户（演示）', orderNo: 'SO-0901', batchId: 'batch-01', quantity: 100, handler: '仓管员 A', note: '首批实际出库，SN 清单待补齐。', serialNumbers: [], status: 'confirmed', createdAt: '2026-09-06T01:00:00.000Z', confirmedAt: '2026-09-06T01:20:00.000Z', reversedAt: null, replacementFor: null },
    { id: 'ship-80', documentNo: 'SHIP-0908-01', actualDate: '2026-09-08', customer: '华南客户（演示）', orderNo: 'SO-0902', batchId: 'batch-02', quantity: 80, handler: '仓管员 A', note: '订单分批出货 80 台，余量另行登记。', serialNumbers: [], status: 'confirmed', createdAt: '2026-09-08T01:30:00.000Z', confirmedAt: '2026-09-08T02:00:00.000Z', reversedAt: null, replacementFor: null },
    { id: 'ship-draft', documentNo: 'SHIP-0909-01', actualDate: '2026-09-09', customer: '华南客户（演示）', orderNo: 'SO-0902', batchId: 'batch-02', quantity: 20, handler: '仓管员 A', note: '剩余 20 台待核对实际出库。', serialNumbers: [], status: 'draft', createdAt: '2026-09-09T01:00:00.000Z', confirmedAt: null, reversedAt: null, replacementFor: null },
  ];
  const history: ShipmentHistory[] = records.flatMap((record, index) => {
    const draft = { ...copyRecord(record), status: 'draft' as const, confirmedAt: null };
    const items: ShipmentHistory[] = [{ id: `seed-history-${index}-create`, recordId: record.id, kind: 'create', actor: record.handler, at: record.createdAt, reason: '演示出货登记', before: null, after: draft }];
    if (record.confirmedAt) items.push({ id: `seed-history-${index}-confirm`, recordId: record.id, kind: 'confirm', actor: record.handler, at: record.confirmedAt, reason: '演示实际出库确认', before: copyRecord(draft), after: copyRecord(record) });
    return items;
  });
  return { version: 1, batches, records, history, months: { '2026-09': { target: 1000, completed: 216 }, '2026-08': { target: 300, completed: 50 } } };
}
