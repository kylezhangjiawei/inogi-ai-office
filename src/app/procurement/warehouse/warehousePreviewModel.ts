import type { DispatchMaterial, MaterialIssue, MaterialReturn, StockBucket, StockCount, StockLot, StockMovement, WarehouseAction, WarehouseState } from './warehouseTypes';

// Independent, disposable frontend demonstration. No inventory service or storage is used.
const people = ['演示仓管员', '演示线长', '演示质量员', '演示复核人'];
const buckets: StockBucket[] = ['qualified', 'inspection', 'defective', 'frozen'];
const results: MaterialReturn['result'][] = ['qualified', 'inspection', 'defective'];
const bucketLabels: Record<StockBucket, string> = { qualified: '合格现存', inspection: '待检', defective: '不良隔离', frozen: '冻结' };
const round = (value: number) => Math.round(value * 1000) / 1000;
const fail = (message: string): never => { throw new Error(message); };
function quantity(value: number, label: string, positive = false) {
  if (!Number.isFinite(value) || value < 0 || (positive && value === 0) || value !== round(value) || !Number.isSafeInteger(Math.round(value * 1000))) fail(`${label}须为${positive ? '大于 0 的' : '非负'}有效数量，最多三位小数`);
  return round(value);
}
function content(value: string, label: string, required = true, max = 2000) {
  if (typeof value !== 'string') return fail(`${label}格式无效`);
  const clean = value.trim();
  if (required && !clean) fail(`请填写${label}`);
  if (clean.length > max) fail(`${label}不能超过 ${max} 字`);
  return clean;
}
function lookup<T extends { id: string }>(items: T[], id: string, name: string): T {
  return items.find((item) => item.id === id) ?? fail(`${name}已不存在，请重新选择`);
}
export const freeStock = (lot: StockLot) => round(lot.qualified - lot.reserved);
export const lineBalance = (issue: MaterialIssue) => round(issue.signedQty - issue.returnedQty - issue.consumedQty);
export function returnableQty(state: WarehouseState, issueId: string, excludingReturnId?: string) {
  const issue = lookup(state.issues, issueId, '领料记录');
  if (issue.status !== 'signed') return 0;
  const requested = state.returns.filter((item) => item.issueId === issueId && item.id !== excludingReturnId && item.status !== 'received').reduce((sum, item) => round(sum + item.quantity), 0);
  return round(lineBalance(issue) - requested);
}
function validateStock(lot: StockLot) {
  for (const bucket of buckets) quantity(lot[bucket], '库存');
  quantity(lot.reserved, '预留库存');
  if (lot.reserved > lot.qualified) fail('合格现存不能低于预留数量');
}
function ensureCountFresh(count: StockCount, lot: StockLot) {
  if (count.lotVersion !== lot.version || count.bookQty !== lot[count.bucket] || count.reservedQty !== lot.reserved) fail('本批库存已变化，请先修改实盘并重新确认当前账面快照');
}

export function applyWarehouseAction(state: WarehouseState, expectedVersion: number, action: WarehouseAction, nowIso = new Date().toISOString()): WarehouseState {
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion !== state.version) fail('数据已变化，请重新核对后提交');
  const actor = content(action.actor, '操作人', true, 120);
  if (!people.includes(actor)) fail('请选择有效的演示操作人');
  const note = content(action.note, '操作说明');
  if (!Number.isFinite(Date.parse(nowIso))) fail('操作时间无效');
  const next: WarehouseState = {
    version: state.version + 1,
    lots: state.lots.map((item) => ({ ...item })), dispatches: state.dispatches.map((item) => ({ ...item })),
    issues: state.issues.map((item) => ({ ...item })), returns: state.returns.map((item) => ({ ...item })),
    counts: state.counts.map((item) => ({ ...item })), movements: state.movements.map((item) => ({ ...item })), records: state.records.map((item) => ({ ...item })),
  };
  for (const lot of next.lots) validateStock(lot);
  const id = (name: string) => `demo-${name}-${next.version}`;
  const code = (prefix: string, length: number) => `DEMO-${prefix}-${String(length + 1).padStart(3, '0')}`;
  function record(entityId: string, documentNo: string, title: string, details = note) {
    next.records.push({ id: id('wh-record'), createdAt: nowIso, entityId, documentNo, title, actor, note: details });
  }
  function movement(lot: StockLot, kind: StockMovement['kind'], documentNo: string, amount: number, source: string, destination: string, details = note) {
    next.movements.push({ id: id('wh-movement'), createdAt: nowIso, lotId: lot.id, kind, documentNo, source, destination, quantity: round(amount), unit: lot.unit, actor, note: details });
  }
  function changeLot(lot: StockLot, bucket: StockBucket, delta: number) {
    lot[bucket] = round(lot[bucket] + delta); lot.version += 1; lot.updatedAt = nowIso; validateStock(lot);
  }
  switch (action.kind) {
    case 'issue': {
      const dispatch = lookup(next.dispatches, action.dispatchId, '派工物料');
      const lot = lookup(next.lots, action.lotId, '库存批次');
      const amount = quantity(action.quantity, '发料数量', true);
      if (lot.materialCode !== dispatch.materialCode || lot.unit !== dispatch.unit) fail('发料批次须匹配派工物料和单位');
      if (!dispatch.bomVersion || dispatch.qtyPer === null || dispatch.requiredQty === null) fail('缺少有效 BOM 用量，请先补齐物料需求');
      quantity(dispatch.componentQty, '组件数量', true); quantity(dispatch.qtyPer, 'BOM 单耗', true); quantity(dispatch.requiredQty, '需求数量', true);
      if (dispatch.requiredQty !== round(dispatch.componentQty * dispatch.qtyPer)) fail('BOM 单耗与物料需求不一致，不能直接按组件数量发料');
      if (amount > round(dispatch.requiredQty - dispatch.issuedQty)) fail('发料数量不能超过剩余物料需求');
      if (amount > freeStock(lot)) fail('发料数量不能超过本批未预留可用库存');
      const issue: MaterialIssue = { id: id('issue'), code: code('ISS', next.issues.length), dispatchId: dispatch.id, lotId: lot.id, quantity: amount, signedQty: 0, returnedQty: 0, consumedQty: 0, status: 'pending_signature', actualQty: null, issuer: actor, receiver: '', issuedAt: nowIso, signedAt: '', note };
      changeLot(lot, 'qualified', -amount); dispatch.issuedQty = round(dispatch.issuedQty + amount); next.issues.push(issue);
      movement(lot, 'issue', issue.code, -amount, `${lot.warehouse} / ${lot.location}`, `${dispatch.line} · 待签收`);
      record(issue.id, issue.code, '登记发料', `${note}；发料 ${amount} ${lot.unit}，等待生产签收。`); break;
    }
    case 'sign': {
      const issue = lookup(next.issues, action.issueId, '领料记录');
      if (issue.status === 'signed') fail('该领料单已签收，不能重复签收');
      const actual = quantity(action.actualQty, '实际签收数量');
      const lot = lookup(next.lots, issue.lotId, '库存批次');
      issue.actualQty = actual; issue.receiver = actor; issue.note = note;
      if (actual !== issue.quantity) {
        issue.status = 'discrepancy'; record(issue.id, issue.code, '签收数量待核对', `${note}；应收 ${issue.quantity}，实收 ${actual}，暂不计入线边。`);
      } else {
        issue.status = 'signed'; issue.signedQty = actual; issue.signedAt = nowIso;
        movement(lot, 'sign', issue.code, 0, '发料待签收', '生产线边', `${note}；签收 ${actual} ${lot.unit}，仓库不重复扣减。`);
        record(issue.id, issue.code, '生产签收', `${note}；签收 ${actual} ${lot.unit}，计入未耗用线边。`);
      }
      break;
    }
    case 'return_create': {
      const issue = lookup(next.issues, action.issueId, '原领料记录');
      const amount = quantity(action.quantity, '申请退料数量', true);
      if (issue.status !== 'signed') fail('只有已签收的领料单可以申请退料');
      if (amount > returnableQty(next, issue.id)) fail('申请数量不能超过未耗用且未被其他退料申请占用的可退数量');
      if (!results.includes(action.result)) fail('请选择有效的退料质量状态');
      const evidence = content(action.evidence, '退料依据');
      const item: MaterialReturn = { id: id('return'), code: code('RET', next.returns.length), issueId: issue.id, quantity: amount, actualQty: null, result: action.result, status: 'pending', applicant: actor, receiver: '', createdAt: nowIso, receivedAt: '', reason: note, evidence, discrepancyNote: '' };
      next.returns.push(item); record(item.id, item.code, '登记生产退料', `${note}；申请 ${amount}；依据：${evidence}。接收前不变更仓库及线边数量。`); break;
    }
    case 'return_receive': {
      const item = lookup(next.returns, action.returnId, '退料单');
      if (item.status !== 'pending') fail('仅待接收退料单可核对接收，已接收不能重复入库');
      const actual = quantity(action.actualQty, '实际接收数量', true);
      if (actual !== item.quantity) fail('实际数量与申请不一致，请先退回核对');
      if (!results.includes(action.result)) fail('请选择有效的退料质量状态');
      if (action.result === 'qualified' && action.reviewed !== true) fail('退回合格库存前须确认质量复核通过');
      const issue = lookup(next.issues, item.issueId, '原领料记录');
      if (issue.status !== 'signed' || actual > returnableQty(next, issue.id, item.id)) fail('可退数量已变化，请重新核对原领料单');
      const evidence = content(action.evidence, '接收依据');
      const lot = lookup(next.lots, issue.lotId, '库存批次');
      item.actualQty = actual; item.result = action.result; item.status = 'received'; item.receiver = actor; item.receivedAt = nowIso; item.evidence = evidence;
      issue.returnedQty = round(issue.returnedQty + actual); changeLot(lot, action.result, actual);
      const destination = { qualified: '合格现存', inspection: '待检', defective: '不良隔离' }[action.result];
      movement(lot, 'return', item.code, actual, '生产未耗用线边', `${lot.warehouse} · ${destination}`, `${note}；接收依据：${evidence}。不良退料不另计报废。`);
      record(item.id, item.code, '退料核对接收', `${note}；接收 ${actual} ${lot.unit}至${destination}；依据：${evidence}。线边仅扣减一次。`); break;
    }
    case 'return_discrepancy': {
      const item = lookup(next.returns, action.returnId, '退料单');
      if (item.status !== 'pending') fail('仅待接收退料单可以退回核对');
      const actual = quantity(action.actualQty, '实点数量');
      if (actual === item.quantity) fail('实点数量一致，无须登记数量差异');
      item.actualQty = actual; item.status = 'discrepancy'; item.discrepancyNote = note; item.receiver = actor;
      record(item.id, item.code, '退料数量待核对', `${note}；申请 ${item.quantity}，实点 ${actual}，库存和线边数量保持不变。`); break;
    }
    case 'return_resubmit': {
      const item = lookup(next.returns, action.returnId, '退料单');
      if (item.status !== 'discrepancy') fail('只有待核对的退料单可更正后重新提交');
      const amount = quantity(action.quantity, '更正退料数量', true);
      if (amount > returnableQty(next, item.issueId, item.id)) fail('更正数量不能超过原领料单当前可退数量');
      const previous = item.quantity; item.quantity = amount; item.actualQty = null; item.status = 'pending';
      record(item.id, item.code, '更正退料数量', `${note}；申请数量由 ${previous} 更正为 ${amount}，等待重新核对接收。`); break;
    }
    case 'count_create': {
      const lot = lookup(next.lots, action.lotId, '库存批次');
      if (!buckets.includes(action.bucket)) fail('请选择有效的盘点库存状态');
      const actual = quantity(action.actualQty, '实盘数量');
      const evidence = content(action.evidence, '盘点依据');
      const count: StockCount = { id: id('count'), code: code('COUNT', next.counts.length), lotId: lot.id, lotVersion: lot.version, bucket: action.bucket, bookQty: lot[action.bucket], actualQty: actual, reservedQty: lot.reserved, reason: note, evidence, reporter: actor, reviewer: '', reviewNote: '', createdAt: nowIso, reviewedAt: '', status: 'draft' };
      next.counts.push(count); record(count.id, count.code, '保存盘点草稿', `${note}；账面 ${count.bookQty}，实盘 ${actual}；依据：${evidence}。暂不调整库存。`); break;
    }
    case 'count_edit': {
      const count = lookup(next.counts, action.countId, '盘点单');
      if (!['draft', 'rejected'].includes(count.status)) fail('只有草稿或退回的盘点单可修改实盘');
      const lot = lookup(next.lots, count.lotId, '库存批次');
      const actual = quantity(action.actualQty, '实盘数量');
      const evidence = content(action.evidence, '盘点依据');
      const previous = count.bookQty;
      Object.assign(count, { lotVersion: lot.version, bookQty: lot[count.bucket], reservedQty: lot.reserved, actualQty: actual, reason: note, evidence, reporter: actor, status: 'draft', reviewer: '', reviewNote: '', reviewedAt: '' });
      record(count.id, count.code, '修改实盘并更新快照', `${note}；原账面 ${previous}，重新确认当前账面 ${count.bookQty}，实盘 ${actual}；依据：${evidence}。`); break;
    }
    case 'count_submit': {
      const count = lookup(next.counts, action.countId, '盘点单');
      if (!['draft', 'rejected'].includes(count.status)) fail('只有草稿或退回的盘点单可提交复核');
      const lot = lookup(next.lots, count.lotId, '库存批次'); ensureCountFresh(count, lot);
      if (count.bucket === 'qualified' && count.actualQty < lot.reserved) fail('实盘合格数量不能低于预留数量，请先核对预留');
      count.status = 'pending_review'; record(count.id, count.code, '提交盘点复核', `${note}；等待独立复核，暂不调整库存。`); break;
    }
    case 'count_approve': {
      const count = lookup(next.counts, action.countId, '盘点单');
      if (count.status !== 'pending_review') fail('只有待复核盘点单可以通过，已通过不能重复调整');
      if (count.reporter === actor) fail('复核人不能与盘点填报人相同');
      const lot = lookup(next.lots, count.lotId, '库存批次'); ensureCountFresh(count, lot);
      if (count.bucket === 'qualified' && count.actualQty < lot.reserved) fail('实盘合格数量不能低于预留数量');
      const delta = round(count.actualQty - count.bookQty); changeLot(lot, count.bucket, delta);
      Object.assign(count, { status: 'approved', reviewer: actor, reviewNote: note, reviewedAt: nowIso });
      movement(lot, 'adjustment', count.code, delta, `盘点账面 ${count.bookQty}`, `复核实盘 ${count.actualQty}`, `${note}；仅调整${bucketLabels[count.bucket]}状态，差异 ${delta}。`);
      record(count.id, count.code, '复核通过并调整', `${note}；账面 ${count.bookQty} → 实盘 ${count.actualQty}，生成差异流水 ${delta}，保留原流水。`); break;
    }
    case 'count_reject': {
      const count = lookup(next.counts, action.countId, '盘点单');
      if (count.status !== 'pending_review') fail('只有待复核盘点单可以退回修改');
      if (count.reporter === actor) fail('复核人不能与盘点填报人相同');
      Object.assign(count, { status: 'rejected', reviewer: actor, reviewNote: note, reviewedAt: nowIso });
      record(count.id, count.code, '盘点退回修改', `${note}；库存保持不变，请重新核对实盘和账面快照。`); break;
    }
    default: fail('当前操作不受支持');
  }
  return next;
}

export const warehouseSeedIds = {
  valveLot: 'demo-lot-valve-a', valveLotB: 'demo-lot-valve-b', screenLot: 'demo-lot-screen', compressorLot: 'demo-lot-compressor', steelLot: 'demo-lot-steel', sealLot: 'demo-lot-seal',
  valveDispatch: 'demo-dispatch-valve', screenDispatch: 'demo-dispatch-screen', compressorDispatch: 'demo-dispatch-compressor', missingBomDispatch: 'demo-dispatch-missing-bom',
  signedIssue: 'demo-issue-signed', pendingIssue: 'demo-issue-pending', defectiveReturn: 'demo-return-defective', qualifiedReturn: 'demo-return-qualified', draftCount: 'demo-count-draft',
} as const;

export function createWarehouseState(): WarehouseState {
  const day = '2026-09-11T01:00:00.000Z';
  const lot = (id: string, materialCode: string, materialName: string, batchNo: string, unit: string, qualified: number, extras: Partial<StockLot> = {}): StockLot => ({ id, version: 1, materialCode, materialName, category: '演示机加工件', spec: '按图纸规格', revision: 'A.1', unit, batchNo, warehouse: '演示原料仓', location: 'A-01-01', supplierName: '演示供应商', qualified, reserved: 0, inspection: 0, defective: 0, frozen: 0, source: '演示期初库存', updatedAt: day, ...extras });
  const lots = [
    lot(warehouseSeedIds.valveLot, 'DEMO-VALVE', '演示阀体', 'DEMO-V-A', '件', 200, { version: 3, reserved: 20, inspection: 10, defective: 24, frozen: 5 }),
    lot(warehouseSeedIds.valveLotB, 'DEMO-VALVE', '演示阀体', 'DEMO-V-B', '件', 50, { reserved: 10, location: 'A-01-02' }),
    lot(warehouseSeedIds.screenLot, 'DEMO-SCREEN', '演示显示屏', 'DEMO-S-A', '片', 80, { category: '演示电子件', inspection: 15, location: 'B-02-01' }),
    lot(warehouseSeedIds.compressorLot, 'DEMO-COMP', '演示压缩机', 'DEMO-C-A', '台', 12, { reserved: 8, warehouse: '演示设备仓', location: 'C-01-01' }),
    lot(warehouseSeedIds.steelLot, 'DEMO-STEEL', '演示不锈钢板', 'DEMO-ST-A', 'kg', 120.5, { category: '演示原材料', qualified: 120.5, frozen: 20.25, location: 'D-01-01' }),
    lot(warehouseSeedIds.sealLot, 'DEMO-SEAL', '演示密封圈', 'DEMO-SE-A', '个', 0, { inspection: 100, defective: 5, location: 'A-03-01' }),
  ];
  const dispatch = (id: string, index: number, target: StockLot, componentQty: number, qtyPer: number | null, issuedQty = 0): DispatchMaterial => ({ id, dispatchNo: `DEMO-DIS-${index}`, line: `演示装配 ${index} 线`, productionBatch: `DEMO-PROD-${index}`, componentName: '演示整机组件', componentQty, bomVersion: qtyPer === null ? '' : 'DEMO-BOM-A.1', qtyPer, materialCode: target.materialCode, materialName: target.materialName, unit: target.unit, requiredQty: qtyPer === null ? null : round(componentQty * qtyPer), issuedQty });
  const dispatches = [dispatch(warehouseSeedIds.valveDispatch, 1, lots[0], 60, 2, 60), dispatch(warehouseSeedIds.screenDispatch, 2, lots[2], 30, 1), dispatch(warehouseSeedIds.compressorDispatch, 3, lots[3], 10, 1), dispatch(warehouseSeedIds.missingBomDispatch, 4, lots[5], 40, null)];
  const issues: MaterialIssue[] = [
    { id: warehouseSeedIds.signedIssue, code: 'DEMO-ISS-001', dispatchId: dispatches[0].id, lotId: lots[0].id, quantity: 40, signedQty: 40, returnedQty: 0, consumedQty: 10, status: 'signed', actualQty: 40, issuer: people[0], receiver: people[1], issuedAt: '2026-09-10T01:00:00.000Z', signedAt: '2026-09-10T02:00:00.000Z', note: '演示已签收 40 件，其中生产已耗用 10 件，未耗用线边 30 件。' },
    { id: warehouseSeedIds.pendingIssue, code: 'DEMO-ISS-002', dispatchId: dispatches[0].id, lotId: lots[0].id, quantity: 20, signedQty: 0, returnedQty: 0, consumedQty: 0, status: 'pending_signature', actualQty: null, issuer: people[0], receiver: '', issuedAt: day, signedAt: '', note: '演示待生产核对，仓库已扣减，线边尚未签收。' },
  ];
  const returns: MaterialReturn[] = [
    { id: warehouseSeedIds.defectiveReturn, code: 'DEMO-RET-001', issueId: issues[0].id, quantity: 6, actualQty: null, result: 'defective', status: 'pending', applicant: people[1], receiver: '', createdAt: day, receivedAt: '', reason: '演示装配发现表面划伤，申请退回隔离', evidence: '演示外观检查记录 DEMO-CHECK-001', discrepancyNote: '' },
    { id: warehouseSeedIds.qualifiedReturn, code: 'DEMO-RET-002', issueId: issues[0].id, quantity: 10, actualQty: null, result: 'qualified', status: 'pending', applicant: people[1], receiver: '', createdAt: day, receivedAt: '', reason: '演示排产调整，未耗用余料申请退回', evidence: '演示余料核对单 DEMO-CHECK-002', discrepancyNote: '' },
  ];
  const counts: StockCount[] = [{ id: warehouseSeedIds.draftCount, code: 'DEMO-COUNT-001', lotId: lots[0].id, lotVersion: lots[0].version, bucket: 'qualified', bookQty: 200, actualQty: 198, reservedQty: 20, reason: '演示月度盘点，实盘比账面少 2 件，待复核原因', evidence: '演示盘点记录 DEMO-STOCKTAKE-001', reporter: people[0], reviewer: '', reviewNote: '', createdAt: day, reviewedAt: '', status: 'draft' }];
  const movements: StockMovement[] = lots.map((item, index) => ({ id: `demo-opening-${index}`, createdAt: '2026-09-09T01:00:00.000Z', lotId: item.id, kind: 'opening', documentNo: `DEMO-OPEN-${index + 1}`, source: '演示期初', destination: item.warehouse, quantity: item.qualified + (index === 0 ? 60 : 0), unit: item.unit, actor: people[0], note: `演示合格期初；另有待检 ${item.inspection}、不良隔离 ${item.defective}、冻结 ${item.frozen}，状态分开记录。` }));
  for (const item of issues) {
    movements.push({ id: `demo-move-${item.id}`, createdAt: item.issuedAt, lotId: item.lotId, kind: 'issue', documentNo: item.code, source: lots[0].warehouse, destination: '演示装配 1 线 · 待签收', quantity: -item.quantity, unit: '件', actor: item.issuer, note: item.note });
    if (item.status === 'signed') movements.push({ id: `demo-sign-${item.id}`, createdAt: item.signedAt, lotId: item.lotId, kind: 'sign', documentNo: item.code, source: '发料待签收', destination: '生产线边', quantity: 0, unit: '件', actor: item.receiver, note: '签收 40 件，仓库不重复扣减；演示后续耗用 10 件。' });
  }
  const records = [
    ...issues.map((item) => ({ id: `demo-record-${item.id}`, createdAt: item.issuedAt, entityId: item.id, documentNo: item.code, title: '登记发料', actor: item.issuer, note: `演示发料 ${item.quantity} 件，仓库已扣减。` })),
    { id: 'demo-record-signed', createdAt: issues[0].signedAt, entityId: issues[0].id, documentNo: issues[0].code, title: '生产签收及期初耗用说明', actor: people[1], note: '演示签收 40 件，之后已耗用 10 件；当前未耗用线边 30 件。' },
    ...returns.map((item) => ({ id: `demo-record-${item.id}`, createdAt: day, entityId: item.id, documentNo: item.code, title: '登记生产退料', actor: item.applicant, note: `演示申请退料 ${item.quantity} 件，尚未接收；${item.reason}。` })),
    { id: 'demo-record-count', createdAt: day, entityId: counts[0].id, documentNo: counts[0].code, title: '保存盘点草稿', actor: people[0], note: '演示账面 200 件，实盘 198 件，库存尚未调整。' },
  ];
  return { version: 1, lots, dispatches, issues, returns, counts, movements, records };
}
