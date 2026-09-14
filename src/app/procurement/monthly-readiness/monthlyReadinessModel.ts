export type MonthlyProduct = 'Q7' | 'Q5';
export type ReadinessInput = { product: MonthlyProduct; month: string; bomVersion: string; mode: 'month' | 'date'; deadline: string; targetOverride?: number; includeUnplaced: boolean };
export type BomMaterial = { id: string; name: string; unit: string; per: number; critical: boolean };
export type MonthlyBom = { product: MonthlyProduct; version: string; complete: boolean; materials: BomMaterial[] };
export type ReadinessStock = { id: string; product: MonthlyProduct; materialId: string; qualified: number; frozen: number; allocatedOther: number; lineUnused: number | null; lineVerified: boolean; source: string };
export type ReadinessOrder = { allocationId: string; orderLineId: string; product: MonthlyProduct; materialId: string; ordered: number; cancelled: number; accepted: number; allocatedOther: number; confirmed: boolean; arrivalDate: string; availableDate: string; source: string };
export type ReadinessPlan = { product: MonthlyProduct; month: string; target: number; version: string };
export type MaterialReadiness = BomMaterial & { required: number; warehouse: number; line: number | null; current: number; orderedByDate: number; lateOrUncertain: number; unplacedByDate: number; currentGap: number; orderGap: number; evidence: string[]; orders: ReadinessOrder[] };
export type ReadinessResult = { input: ReadinessInput; sourceVersion: number; asOf: string; target: number | null; completed: number; remaining: number | null; currentKits: number | null; predictedKits: number | null; scenarioKits: number | null; status: 'incomplete' | 'gap' | 'ready' | 'draft'; dataIssues: string[]; materialRows: MaterialReadiness[]; timeline: { date: string; kits: number }[]; readyDate: string | null; isDraft: boolean };
export type ReadinessSnapshot = { id: string; savedAt: string; label: string; sourceSnapshotId?: string; input: ReadinessInput; result: ReadinessResult; source: string };
export type MonthlyReadinessState = {
  version: number; asOf: string; boms: MonthlyBom[]; plans: ReadinessPlan[]; stocks: ReadinessStock[]; orders: ReadinessOrder[];
  completions: { eventId: string; product: MonthlyProduct; month: string; quantity: number; confirmed: boolean; kind: 'whole-machine' | 'component' }[];
  unplaced: { id: string; product: MonthlyProduct; materialId: string; quantity: number; availableDate: string }[];
  snapshots: ReadinessSnapshot[];
};
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const quantity = (value: number) => Number.isFinite(value) && value >= 0;
export function validReadinessDate(value: string): boolean { return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value; }
export function monthEnd(month: string): string { if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return ''; const [year, mon] = month.split('-').map(Number); return new Date(Date.UTC(year, mon, 0)).toISOString().slice(0, 10); }
export function defaultReadinessInput(product: MonthlyProduct = 'Q7', month = '2026-09'): ReadinessInput { return { product, month, bomVersion: product === 'Q7' ? 'V1.0' : 'V2.1', mode: 'month', deadline: monthEnd(month), includeUnplaced: false }; }
export function calculateMonthlyReadiness(state: MonthlyReadinessState, input: ReadinessInput): ReadinessResult {
  const issues: string[] = [];
  const deadline = input.mode === 'month' ? monthEnd(input.month) : input.deadline;
  if (!deadline || !validReadinessDate(deadline) || !deadline.startsWith(input.month)) issues.push('需求日期必须是计划月份内的有效日期');
  const plan = state.plans.find((row) => row.product === input.product && row.month === input.month);
  const isDraft = !plan || input.targetOverride !== undefined;
  const target = input.targetOverride ?? plan?.target ?? null;
  if (target === null) issues.push('该月尚无正式整机目标，请填写草稿情景目标');
  else if (!Number.isSafeInteger(target) || target < 0) issues.push('整机目标必须是非负整数');
  const completionIds = new Map<string, number>(); let completed = 0;
  for (const row of state.completions) {
    if (row.product !== input.product || row.month !== input.month || !row.confirmed || row.kind !== 'whole-machine') continue;
    if (completionIds.has(row.eventId)) { if (completionIds.get(row.eventId) !== row.quantity) issues.push(`整机完工记录 ${row.eventId} 数量冲突`); continue; }
    completionIds.set(row.eventId, row.quantity);
    if (!Number.isSafeInteger(row.quantity) || row.quantity < 0) issues.push(`整机完工记录 ${row.eventId} 数量待核对`); else completed += row.quantity;
  }
  const remaining = target === null || !Number.isSafeInteger(target) || target < 0 ? null : Math.max(0, target - completed);
  const bom = state.boms.find((row) => row.product === input.product && row.version === input.bomVersion);
  if (!bom?.complete || !bom?.materials.length) issues.push('有效 BOM 清单尚未完整确认');
  const materialRows: MaterialReadiness[] = [];
  const seenMaterials = new Set<string>();
  for (const material of bom?.materials ?? []) {
    if (seenMaterials.has(material.id)) { issues.push(`${material.name} BOM 项重复，需核对单机用量`); continue; }
    seenMaterials.add(material.id);
    if (!Number.isFinite(material.per) || material.per <= 0 || !material.unit) issues.push(`${material.name} 单机用量或单位待补齐`);
    const stocks = state.stocks.filter((row) => row.product === input.product && row.materialId === material.id);
    let warehouse = 0, line: number | null = 0; const evidence: string[] = [];
    if (!stocks.length) issues.push(`${material.name} 库存来源待补齐`);
    const stockIds = new Map<string, string>();
    for (const stock of stocks) {
      const signature = JSON.stringify(stock);
      if (stockIds.has(stock.id)) { if (stockIds.get(stock.id) !== signature) issues.push(`${material.name} 库存记录 ${stock.id} 冲突`); continue; }
      stockIds.set(stock.id, signature);
      if (![stock.qualified, stock.frozen, stock.allocatedOther].every(quantity) || stock.qualified < stock.frozen + stock.allocatedOther) issues.push(`${material.name} 仓库数量矛盾，需盘核`);
      else warehouse += stock.qualified - stock.frozen - stock.allocatedOther;
      if (!stock.lineVerified || stock.lineUnused === null || !quantity(stock.lineUnused)) { line = null; issues.push(`${material.name} 线边未耗用量待核对`); }
      else if (line !== null) line += stock.lineUnused;
      if (!stock.source.trim()) issues.push(`${material.name} 库存来源依据待补齐`);
      evidence.push(stock.source);
    }
    const orderIds = new Map<string, string>(); const orderLines = new Set<string>(); const orders: ReadinessOrder[] = []; let orderedByDate = 0, lateOrUncertain = 0;
    for (const order of state.orders) {
      if (order.product !== input.product || order.materialId !== material.id) continue;
      const signature = JSON.stringify(order);
      if (orderIds.has(order.allocationId)) { if (orderIds.get(order.allocationId) !== signature) issues.push(`${material.name} 订单分配 ${order.allocationId} 存在冲突`); continue; }
      orderIds.set(order.allocationId, signature);
      if (orderLines.has(order.orderLineId)) { issues.push(`${material.name} 同一订单行存在多份分配，需确认独立数量后计算`); continue; }
      orderLines.add(order.orderLineId); orders.push(clone(order));
      const valid = [order.ordered, order.cancelled, order.accepted, order.allocatedOther].every(quantity) && order.ordered >= order.cancelled + order.accepted + order.allocatedOther;
      if (!valid) { issues.push(`${material.name} 订单剩余义务待核对`); continue; }
      const rest = order.ordered - order.cancelled - order.accepted - order.allocatedOther;
      if (order.confirmed && validReadinessDate(order.availableDate) && (validReadinessDate(order.arrivalDate) && order.availableDate >= order.arrivalDate) && order.availableDate <= deadline) orderedByDate += rest;
      else lateOrUncertain += rest;
    }
    const seenUnplaced = new Set<string>(); let unplacedByDate = 0;
    for (const row of state.unplaced) {
      if (row.product !== input.product || row.materialId !== material.id || seenUnplaced.has(row.id)) continue;
      seenUnplaced.add(row.id);
      if (quantity(row.quantity) && validReadinessDate(row.availableDate) && row.availableDate <= deadline) unplacedByDate += row.quantity;
    }
    const current = warehouse + (line ?? 0), required = (remaining ?? 0) * material.per;
    materialRows.push({ ...material, required, warehouse, line, current, orderedByDate, lateOrUncertain, unplacedByDate, currentGap: Math.max(0, required - current), orderGap: Math.max(0, required - current - orderedByDate), evidence, orders });
  }
  const dataIssues = [...new Set(issues)];
  const kitsAt = (date: string, includeUnplaced = false) => Math.min(remaining ?? 0, ...materialRows.map((row) => {
    const future = row.orders.filter((order) => order.confirmed && validReadinessDate(order.availableDate) && order.availableDate <= date && (validReadinessDate(order.arrivalDate) && order.availableDate >= order.arrivalDate)).reduce((sum, order) => sum + order.ordered - order.cancelled - order.accepted - order.allocatedOther, 0);
    return Math.floor((row.current + future + (includeUnplaced ? row.unplacedByDate : 0)) / row.per);
  }));
  const currentKits = dataIssues.length ? null : Math.min(remaining!, ...materialRows.map((row) => Math.floor(row.current / row.per)));
  const predictedKits = dataIssues.length ? null : kitsAt(deadline);
  const scenarioKits = dataIssues.length || !input.includeUnplaced ? null : kitsAt(deadline, true);
  const dates = [...new Set(materialRows.flatMap((row) => row.orders.filter((order) => order.confirmed && validReadinessDate(order.availableDate) && order.availableDate <= deadline && order.availableDate > state.asOf.slice(0, 10) && validReadinessDate(order.arrivalDate) && order.availableDate >= order.arrivalDate).map((order) => order.availableDate)))].sort();
  const timeline = dataIssues.length ? [] : [{ date: state.asOf.slice(0, 10), kits: currentKits! }, ...dates.map((date) => ({ date, kits: kitsAt(date) }))];
  const readyDate = deadline < state.asOf.slice(0, 10) ? null : timeline.find((point) => point.kits >= remaining!)?.date ?? null;
  return { input: { ...input, deadline }, sourceVersion: state.version, asOf: state.asOf, target, completed, remaining, currentKits, predictedKits, scenarioKits, status: dataIssues.length ? 'incomplete' : isDraft ? 'draft' : predictedKits! >= remaining! ? 'ready' : 'gap', dataIssues, materialRows, timeline, readyDate, isDraft };
}
export function getMonthlyReadinessSummary(state: MonthlyReadinessState, product: MonthlyProduct = 'Q7', month = '2026-09') {
  const result = calculateMonthlyReadiness(state, defaultReadinessInput(product, month));
  return { product, month, target: result.target, completed: result.completed, remaining: result.remaining, currentKits: result.currentKits, predictedKits: result.predictedKits, status: result.status, dataIssues: result.dataIssues, deadline: result.input.deadline };
}
export function saveMonthlyReadinessSnapshot(state: MonthlyReadinessState, result: ReadinessResult, expectedVersion: number, id: string, savedAt: string, sourceSnapshotId?: string): MonthlyReadinessState {
  if (expectedVersion !== state.version || result.sourceVersion !== state.version) throw new Error('来源数据已更新，请按当前数据重算后再保存');
  if (state.snapshots.some((row) => row.id === id)) return state;
  if (result.dataIssues.length) throw new Error('数据待补齐，不能保存为已确认预测');
  const snapshot: ReadinessSnapshot = { id, savedAt, label: result.isDraft ? '草稿情景' : sourceSnapshotId ? '历史重算结果' : '月度预测', sourceSnapshotId, input: clone(result.input), result: clone(result), source: `库存 / 订单 / 完工演示快照 V${state.version}` };
  return { ...state, snapshots: [...state.snapshots, snapshot] };
}
export function changeReadinessSource(state: MonthlyReadinessState, kind: 'verify-line' | 'late-order' | 'missing-bom'): MonthlyReadinessState {
  const next = clone(state); next.version += 1; next.asOf = '2026-09-14T10:30:00+08:00';
  if (kind === 'verify-line') next.stocks = next.stocks.map((row) => ({ ...row, lineUnused: row.lineUnused ?? 80, lineVerified: true }));
  if (kind === 'late-order') next.orders = next.orders.map((row) => row.orderLineId === 'PO-0921-01' ? { ...row, availableDate: '2026-10-03' } : row);
  if (kind === 'missing-bom') next.boms = next.boms.map((bom) => ({ ...bom, complete: false }));
  return next;
}
export function createMonthlyReadinessState(): MonthlyReadinessState {
  const q7: BomMaterial[] = [{ id: 'valve', name: '阀体', unit: '件', per: 1, critical: true }, { id: 'compressor', name: '压缩机', unit: '台', per: 1, critical: true }, { id: 'sieve', name: '筛筒', unit: '件', per: 2, critical: true }, { id: 'screw', name: '机架固定螺钉', unit: '颗', per: 8, critical: false }];
  const state: MonthlyReadinessState = { version: 3, asOf: '2026-09-14T09:00:00+08:00', boms: [{ product: 'Q7', version: 'V1.0', complete: true, materials: q7 }, { product: 'Q5', version: 'V2.1', complete: true, materials: q7.map((row) => ({ ...row, per: row.id === 'sieve' ? 1 : row.per })) }], plans: [{ product: 'Q7', month: '2026-09', target: 1000, version: 'MP-09-V3' }, { product: 'Q5', month: '2026-09', target: 400, version: 'MP-09-V2' }, { product: 'Q7', month: '2026-08', target: 900, version: 'MP-08-V4' }], stocks: [], orders: [], completions: [{ eventId: 'FG-Q7-0901', product: 'Q7', month: '2026-09', quantity: 100, confirmed: true, kind: 'whole-machine' }, { eventId: 'FG-Q7-0902', product: 'Q7', month: '2026-09', quantity: 116, confirmed: true, kind: 'whole-machine' }, { eventId: 'COMP-Q7-0901', product: 'Q7', month: '2026-09', quantity: 480, confirmed: true, kind: 'component' }, { eventId: 'FG-Q5-0901', product: 'Q5', month: '2026-09', quantity: 120, confirmed: true, kind: 'whole-machine' }, { eventId: 'FG-Q7-0831', product: 'Q7', month: '2026-08', quantity: 900, confirmed: true, kind: 'whole-machine' }], unplaced: [], snapshots: [] };
  for (const product of ['Q7', 'Q5'] as const) {
    const stocks = product === 'Q7' ? [[540, 20, 80], [660, 10, 50], [1240, 40, 160], [6400, 200, 400]] : [[210, 10, 30], [230, 0, 40], [250, 0, 30], [2100, 100, 240]];
    q7.forEach((material, index) => { const [qualified, frozen, lineUnused] = stocks[index]; state.stocks.push({ id: `ST-${product}-${material.id}`, product, materialId: material.id, qualified, frozen, allocatedOther: 0, lineUnused: product === 'Q7' && index === 0 ? null : lineUnused, lineVerified: !(product === 'Q7' && index === 0), source: `WMS-0914 / ${product} 专属分配；LS-0913${index === 0 && product === 'Q7' ? ' 待核对' : ' 已确认未耗用'}` }); });
    const orderQuantities = product === 'Q7' ? [184, 84, 208, 0] : [50, 10, 0, 0];
    q7.forEach((material, index) => { if (orderQuantities[index]) state.orders.push({ allocationId: `ALLOC-${product}-${index}`, orderLineId: product === 'Q7' && index === 0 ? 'PO-0921-01' : `PO-${product}-${index}`, product, materialId: material.id, ordered: orderQuantities[index] + 20, cancelled: 0, accepted: 20, allocatedOther: 0, confirmed: true, arrivalDate: `2026-09-${18 + index * 3}`, availableDate: `2026-09-${20 + index * 3}`, source: '供应商承诺 + 检验排期；已验收 20 不再计入在途' }); });
    state.unplaced.push({ id: `PLAN-${product}-01`, product, materialId: 'valve', quantity: 200, availableDate: '2026-09-28' }, { id: `PLAN-${product}-02`, product, materialId: 'compressor', quantity: 140, availableDate: '2026-10-22' }, { id: `PLAN-${product}-03`, product, materialId: 'sieve', quantity: 280, availableDate: '2026-10-25' });
  }
  const historical = clone(state); historical.version = 1; historical.asOf = '2026-09-07T18:00:00+08:00'; historical.stocks = historical.stocks.map((row) => ({ ...row, lineUnused: row.lineUnused ?? 40, lineVerified: true })); historical.completions = historical.completions.map((row) => row.eventId === 'FG-Q7-0902' ? { ...row, quantity: 60 } : row);
  const septInput = defaultReadinessInput(); const septResult = calculateMonthlyReadiness(historical, septInput);
  const augInput = defaultReadinessInput('Q7', '2026-08'); const august = clone(historical); august.asOf = '2026-08-31T23:59:00+08:00'; const augResult = calculateMonthlyReadiness(august, augInput);
  state.snapshots = [{ id: 'MR-20260831-001', savedAt: august.asOf, label: '8 月月末快照', input: augInput, result: augResult, source: '月结库存 / 完工 / BOM V1.0' }, { id: 'MR-20260907-002', savedAt: historical.asOf, label: '9 月 7 日日结', input: septInput, result: septResult, source: '9 月 7 日日结库存 / 订单交期 V1' }];
  return state;
}
