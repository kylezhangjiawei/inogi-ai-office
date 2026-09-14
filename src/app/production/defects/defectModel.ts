import type { DefectAction, DefectActionKind, DefectActor, DefectDirection, DefectIssue, DefectPhoto, DefectProgress, DefectState } from './defectTypes';

const clone = <T,>(value: T): T => structuredClone(value);
const fail = (message: string): never => { throw new Error(message); };
const issueFor = (state: DefectState, id: string) => state.issues.find((item) => item.id === id) ?? fail('不良记录已不存在');
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01') return false;
  const at = new Date(`${value}T00:00:00.000Z`); return Number.isFinite(at.getTime()) && at.toISOString().slice(0, 10) === value;
}
export function defectToday(now = new Date().toISOString()): string {
  const at = Date.parse(now); if (!Number.isFinite(at)) return fail('操作时间无效');
  return new Date(at + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function allowedOwner(actor: DefectActor | undefined, direction: DefectDirection, lineId: string): boolean {
  if (!actor || actor.role === 'qc' || actor.role === 'viewer') return false;
  if (actor.role === 'line' && actor.lineId !== lineId) return false;
  if (direction === 'pending') return true;
  if (direction === 'onsite') return actor.role === 'line' || actor.role === 'quality';
  return actor.role === direction;
}
export function getDefectOwners(state: DefectState, issueId: string, direction?: DefectDirection): DefectActor[] {
  const issue = state.issues.find((item) => item.id === issueId);
  return issue ? state.actors.filter((actor) => allowedOwner(actor, direction ?? issue.direction, issue.lineId)) : [];
}
export function canOperateDefect(state: DefectState, actorId: string, issueId: string, kind?: DefectActionKind): boolean {
  const issue = state.issues.find((item) => item.id === issueId); const actor = state.actors.find((item) => item.id === actorId);
  if (!issue || issue.closedAt || !actor || actor.role === 'qc' || actor.role === 'viewer') return false;
  if (actor.role === 'line' && actor.lineId !== issue.lineId) return false;
  const responsible = actor.role === 'quality' || issue.ownerId === actorId;
  if (!responsible) return false;
  if (kind === 'assign' || kind === 'close') return actor.role === 'quality';
  if (kind === 'repair' || kind === 'handoff') return issue.direction === 'onsite';
  return kind === undefined || kind === 'route';
}
export function getHandoffAvailable(state: DefectState, repairId: string): number {
  const repair = state.repairs.find((item) => item.id === repairId); if (!repair) return 0;
  const assigned = state.handoffs.filter((item) => item.repairId === repairId && item.issueId === repair.issueId).reduce((sum, item) => sum + item.quantity, 0);
  return Math.max(0, repair.quantity - assigned);
}
export function getDefectProgress(state: DefectState, issueId: string): DefectProgress {
  const issue = issueFor(state, issueId); const repairs = state.repairs.filter((item) => item.issueId === issueId);
  const repairIds = new Set(repairs.map((item) => item.id));
  const handoffs = state.handoffs.filter((item) => item.issueId === issueId && repairIds.has(item.repairId)); const handoffIds = new Set(handoffs.map((item) => item.id));
  const receipts = state.receipts.filter((item) => item.issueId === issueId && handoffIds.has(item.handoffId));
  const repaired = repairs.reduce((sum, item) => sum + item.quantity, 0); const handedOff = handoffs.reduce((sum, item) => sum + item.quantity, 0);
  const resolved = receipts.reduce((sum, item) => sum + item.good, 0); const pendingReinspection = Math.max(0, handedOff - receipts.reduce((sum, item) => sum + item.quantity, 0));
  const ready = Math.max(0, repaired - handedOff); const remaining = Math.max(0, issue.quantity - resolved);
  return { resolved, pendingReinspection, ready, remaining, availableToRepair: Math.max(0, remaining - pendingReinspection - ready), repaired };
}
// A QC receipt is an existing source fact. P08 has no action that creates or edits it.
function integrityError(state: DefectState, issue: DefectIssue): string | null {
  if (!positive(issue.quantity) || !issue.sourceKey?.trim()) return '原不良来源或数量不完整，请先核对';
  const repairs = state.repairs.filter((item) => item.issueId === issue.id); const handoffs = state.handoffs.filter((item) => item.issueId === issue.id); const receipts = state.receipts.filter((item) => item.issueId === issue.id);
  const ids = [...repairs, ...handoffs, ...receipts].map((item) => item.id); if (new Set(ids).size !== ids.length) return '整改或复验来源编号重复，请先核对';
  for (const repair of repairs) {
    if (!positive(repair.quantity) || !repair.code.trim() || !repair.basis.trim() || !validDate(repair.date)) return '整改凭据不完整，请先核对';
    if (handoffs.filter((item) => item.repairId === repair.id).reduce((sum, item) => sum + item.quantity, 0) > repair.quantity) return '复验交接数量超过对应整改数量，请先核对';
  }
  for (const handoff of handoffs) {
    const repair = repairs.find((item) => item.id === handoff.repairId);
    if (!positive(handoff.quantity) || !repair || !Number.isFinite(Date.parse(handoff.at))) return '复验交接的整改来源无效，请先核对';
    if (receipts.filter((item) => item.handoffId === handoff.id).reduce((sum, item) => sum + item.quantity, 0) > handoff.quantity) return 'QC 回执数量超过对应交接数量，请先核对';
  }
  for (const receipt of receipts) {
    const handoff = handoffs.find((item) => item.id === receipt.handoffId);
    if (!handoff || !positive(receipt.quantity) || !nonnegative(receipt.good) || !nonnegative(receipt.bad) || receipt.good + receipt.bad !== receipt.quantity || !validDate(receipt.date) || receipt.date < defectToday(handoff.at) || !receipt.inspector.trim() || !receipt.evidence.trim() || !receipt.sipVersion.trim()) return 'QC 回执来源、数量或检验依据不完整，请先核对';
  }
  const p = getDefectProgress(state, issue.id);
  if (p.resolved + p.pendingReinspection + p.ready > issue.quantity) return '不良数量池不一致，请先核对来源记录';
  return null;
}
function photoError(value: unknown): string | null {
  if (!Array.isArray(value)) return '照片列表格式无效'; if (value.length > 3) return '最多可附 3 张照片'; const ids = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return '照片信息不完整'; const photo = entry as DefectPhoto;
    if (typeof photo.id !== 'string' || !photo.id.trim() || photo.id.length > 128 || ids.has(photo.id)) return '照片标识无效或重复'; ids.add(photo.id);
    if (typeof photo.name !== 'string' || !photo.name.trim() || photo.name.length > 180) return '照片文件名无效或过长';
    if (!['image/png', 'image/jpeg'].includes(photo.type)) return '照片仅支持 PNG 或 JPEG';
    if (!positive(photo.size) || photo.size > 10 * 1024 * 1024) return '每张照片须大于 0 且不超过 10 MB';
    if (typeof photo.dataUrl !== 'string' || !photo.dataUrl.startsWith(`data:${photo.type};base64,`)) return '照片内容与文件类型不匹配';
    const data = photo.dataUrl.slice(photo.dataUrl.indexOf(',') + 1);
    if (!data || data.length > Math.ceil(10 * 1024 * 1024 / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) return '照片内容不是有效的 Base64 图片数据';
    if (data.length * 3 / 4 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0) !== photo.size) return '照片大小与实际内容不一致，请重新选择';
  }
  return null;
}
export function validateDefectAction(state: DefectState, action: DefectAction, today = defectToday()): Record<string, string> {
  if (!action || typeof action !== 'object' || !['assign', 'route', 'repair', 'handoff', 'close'].includes(action.kind)) return { _form: '不支持的不良处理操作' };
  if (!validDate(today)) return { _form: '当前业务日期无效，请刷新后重试' };
  const errors: Record<string, string> = {}; const issue = state.issues.find((item) => item.id === action.issueId);
  if (!issue) return { issueId: '请选择有效不良记录' }; if (issue.closedAt) return { _form: '已关闭不良仅可查看' };
  if (!canOperateDefect(state, action.actorId, issue.id, action.kind)) errors.actorId = action.kind === 'assign' || action.kind === 'close' ? '仅质量管理岗可执行此操作' : '仅本问题责任人或质量管理岗可执行此方向的操作';
  const integrity = integrityError(state, issue); if (integrity) errors._form = integrity;
  if (action.reviewed !== true) errors.reviewed = '请确认已核对本问题来源、数量和本次操作依据';
  const requiredText = (field: string, value: unknown, label: string, required = true, max = 2000) => {
    if (typeof value !== 'string') errors[field] = `${label}格式无效`;
    else if (required && !value.trim()) errors[field] = `请填写${label}`;
    else if (value.trim().length > max) errors[field] = `${label}不能超过 ${max} 字`;
  };
  const quantity = (value: unknown) => { if (!positive(value)) errors.quantity = '数量须为大于 0 的整数'; };
  const p = getDefectProgress(state, issue.id);
  if (action.kind === 'assign' || action.kind === 'route') {
    const direction = action.kind === 'route' ? action.direction : issue.direction;
    if (!allowedOwner(state.actors.find((item) => item.id === action.ownerId), direction, issue.lineId)) errors.ownerId = '请选择与处理方向匹配的责任人';
    if (!validDate(action.dueDate)) errors.dueDate = '请选择有效预计完成日期';
    else if (action.dueDate < today) errors.dueDate = '预计完成日期不能早于今天';
    if (action.kind === 'assign') {
      if (!['high', 'medium', 'low'].includes(action.priority)) errors.priority = '请选择有效优先级';
      requiredText('reason', action.reason, '指派说明');
    } else {
      if (!['onsite', 'rd', 'procurement'].includes(action.direction)) errors.direction = '请选择有效处理方向';
      if (action.direction !== issue.direction && (p.ready > 0 || p.pendingReinspection > 0)) errors.direction = '仍有待交接或待 QC 复验数量，暂不能更换处理方向';
      if (!['pending', 'confirmed'].includes(action.causeStatus)) errors.causeStatus = '请选择有效原因确认状态';
      requiredText('cause', action.cause, '已确认原因', action.causeStatus === 'confirmed');
      if (action.causeStatus === 'pending' && typeof action.cause === 'string' && action.cause.trim()) errors.cause = '原因待确认时请留空，现象与调查线索可填写在处理说明中';
      requiredText('description', action.description, '处理说明');
    }
  } else if (action.kind === 'repair') {
    quantity(action.quantity); if (!errors.quantity && action.quantity > p.availableToRepair) errors.quantity = `本问题仅剩 ${p.availableToRepair} ${issue.unit} 可登记整改`;
    if (!validDate(action.date)) errors.date = '请选择有效整改日期';
    else if (action.date < issue.date) errors.date = '整改日期不能早于不良发生日期';
    else if (action.date > today) errors.date = '整改日期不能晚于今天';
    requiredText('description', action.description, '实际整改措施'); requiredText('basis', action.basis, '整改依据');
    const photo = photoError(action.photos); if (photo) errors.photos = photo;
  } else if (action.kind === 'handoff') {
    const repair = state.repairs.find((item) => item.id === action.repairId && item.issueId === issue.id);
    if (!repair) errors.repairId = '请选择本问题的整改记录';
    else if (repair.date > today) errors.repairId = '尚未到整改记录日期，不能提交复验';
    quantity(action.quantity);
    if (repair && !errors.quantity && action.quantity > getHandoffAvailable(state, repair.id)) errors.quantity = `本条整改记录仅剩 ${getHandoffAvailable(state, repair.id)} ${issue.unit} 可提交复验`;
  } else {
    if (p.remaining > 0 || p.ready > 0 || p.pendingReinspection > 0) errors._form = '仍有未解决不良或待复验数量，全部取得 QC 合格回执后才能关闭';
    requiredText('summary', action.summary, '关闭说明');
  }
  return errors;
}
export function applyDefectAction(state: DefectState, expectedVersion: number, action: DefectAction, now = new Date().toISOString()): DefectState {
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion !== state.version) fail('不良数据已变化，请重新核对后提交');
  const today = defectToday(now); const errors = validateDefectAction(state, action, today); if (Object.keys(errors).length) fail(Object.values(errors)[0]);
  const at = new Date(now).toISOString(); const next = clone(state); next.version += 1; const issue = issueFor(next, action.issueId);
  const usedIds = new Set([...next.issues, ...next.repairs, ...next.handoffs, ...next.receipts, ...next.collaborations, ...next.events].map((item) => item.id));
  const id = (prefix: string) => { let value = `${prefix}-${next.version}`; let suffix = 1; while (usedIds.has(value)) value = `${prefix}-${next.version}-${suffix++}`; usedIds.add(value); return value; };
  let summary = '';
  if (action.kind === 'assign') {
    issue.ownerId = action.ownerId; issue.dueDate = action.dueDate; issue.priority = action.priority;
    summary = `已指派 ${next.actors.find((item) => item.id === action.ownerId)!.name}，预计 ${action.dueDate} 完成；${action.reason.trim()}`;
    for (const entry of next.collaborations.filter((item) => item.issueId === issue.id && item.direction === issue.direction)) entry.ownerId = action.ownerId;
  } else if (action.kind === 'route') {
    issue.direction = action.direction; issue.ownerId = action.ownerId; issue.dueDate = action.dueDate; issue.causeStatus = action.causeStatus; issue.cause = action.cause.trim();
    if (action.direction === 'rd' || action.direction === 'procurement') {
      const existing = next.collaborations.find((item) => item.issueId === issue.id && item.direction === action.direction);
      if (existing) { existing.ownerId = action.ownerId; existing.description = action.description.trim(); }
      else next.collaborations.push({ id: id('defect-collaboration'), code: `${action.direction === 'rd' ? 'RD-COL' : 'PROC-COL'}-${next.version}`, issueId: issue.id, direction: action.direction, ownerId: action.ownerId, description: action.description.trim(), actorId: action.actorId, at });
    }
    summary = `处理方向：${action.direction === 'onsite' ? '现场整改' : action.direction === 'rd' ? '研发协同' : '采购协同'}；${action.description.trim()}；${action.causeStatus === 'pending' ? '原因仍待确认' : `已确认原因：${action.cause.trim()}`}`;
  } else if (action.kind === 'repair') {
    next.repairs.push({ id: id('defect-repair'), code: `DISP-${next.version}`, issueId: issue.id, date: action.date, quantity: action.quantity, description: action.description.trim(), basis: action.basis.trim(), photos: clone(action.photos), actorId: action.actorId, at });
    summary = `登记现场整改 ${action.quantity} ${issue.unit}，等待提交 QC 复验；不代表检验合格`;
  } else if (action.kind === 'handoff') {
    next.handoffs.push({ id: id('defect-handoff'), code: `RETEST-REQ-${next.version}`, issueId: issue.id, repairId: action.repairId, quantity: action.quantity, actorId: action.actorId, at });
    summary = `已交接 ${action.quantity} ${issue.unit} 待 QC 复验，尚无本次检验结果`;
  } else {
    issue.closedAt = at; issue.closedBy = action.actorId; issue.closeSummary = action.summary.trim();
    summary = `依据已有 QC 合格回执关闭不良；${action.summary.trim()}；未产生 QA 放行或实际出货`;
  }
  next.events.push({ id: id('defect-event'), issueId: issue.id, actorId: action.actorId, at, kind: action.kind, summary });
  return next;
}
function issue(id: string, code: string, quantity: number, options: Partial<DefectIssue> = {}): DefectIssue {
  return { id, code, sourceKey: `p03:${id}`, sourceType: 'final', sourceCode: code, batchCode: 'B-FG-0910', product: '智能控制组件', material: '整机', lineId: 'line-a', lineName: 'A 线', process: '整机终检', date: '2026-09-11', quantity, unit: '台', phenomenon: '功能异常', description: '独立来源快照，按原不良数量跟踪整改与 QC 复验。', priority: 'medium', ownerId: 'line-a', dueDate: '2026-09-16', direction: 'onsite', causeStatus: 'pending', cause: '', ...options };
}
export function createDefectState(): DefectState {
  return {
    version: 1,
    actors: [{ id: 'quality-a', name: '质量管理岗', role: 'quality' }, { id: 'line-a', name: 'A 线负责人', role: 'line', lineId: 'line-a' }, { id: 'line-b', name: 'B 线负责人', role: 'line', lineId: 'line-b' }, { id: 'rd-a', name: '研发协同岗', role: 'rd' }, { id: 'procurement-a', name: '采购协同岗', role: 'procurement' }, { id: 'qc-a', name: 'QC 检验员', role: 'qc' }, { id: 'viewer-a', name: '生产查看岗', role: 'viewer' }],
    issues: [
      issue('issue-final', 'NCR-0911-001', 3, { sourceKey: 'p03:record-initial', sourceTaskId: 'task-final', sourceRecordId: 'record-initial', sourceCode: 'QC-0911-001', description: '终检 50 台中 3 台功能异常，2 台已整改待交接，另 1 台待处理。产线为本页演示映射。', priority: 'high' }),
      issue('issue-process', 'NC-PRO-0911-003', 6, { sourceKey: 'p03:record-process', sourceTaskId: 'task-process', sourceRecordId: 'record-process', sourceCode: 'QC-0911-003', sourceType: 'process', batchCode: 'B-FG-0909', product: '工业阀组件', material: '阀组件', process: '阀组件过程检验', lineId: 'line-b', lineName: 'B 线', unit: '件', phenomenon: '装配干涉', description: '过程检验 160 件中 6 件装配干涉，处理方向及原因待确认。产线为本页演示映射。', ownerId: null, direction: 'pending', dueDate: null }),
      issue('issue-field', 'NC-PRO-0911-004', 2, { sourceKey: 'p02:defect-seed', sourceTaskId: 'task-active', sourceRecordId: 'defect-seed', sourceCode: 'DEFECT-0911-001', sourceType: 'field', material: '控制装配件', process: '现场装配', unit: '件', phenomenon: '功能异常', description: '通信测试间歇断连。现场报工 REPORT-0911-001 为 40/36/4，其中已有 2 件登记本不良；关联主控板批 PCB-260910-D，原不良单位仍按件。' }),
      issue('issue-verified', 'NCR-0907-02', 6, { sourceKey: 'p03:record-history-initial', sourceTaskId: 'task-closed', sourceRecordId: 'record-history-initial', sourceCode: 'FQC-0907-02', archiveId: 'batch-02', batchCode: 'B-FG-0902', date: '2026-09-07', dueDate: '2026-09-14', description: '独立历史快照：首次 116 台中不良 6 台，返工后已有 6 台 QC 合格回执，等待质量管理关闭。' }),
      issue('issue-retest-failed', 'NC-PRO-0911-005', 3, { sourceKey: 'p03:retest-failed-preview', sourceCode: 'QC-0911-PREVIEW', description: '独立复验失败样例：原不良 3 台已整改并复验，2 台合格、1 台仍不良，可对剩余 1 台再次整改。' }),
      issue('issue-closed', 'NC-PRO-0908-006', 1, { sourceKey: 'p03:closed-preview', sourceCode: 'QC-0908-PREVIEW', date: '2026-09-08', unit: '件', sourceType: 'process', material: '阀组件', process: '阀组件过程检验', lineId: 'line-b', lineName: 'B 线', ownerId: 'line-b', dueDate: '2026-09-09', phenomenon: '尺寸偏差', closedAt: '2026-09-09T07:00:00.000Z', closedBy: 'quality-a', closeSummary: '独立历史样例，依据 QC 合格回执关闭。' }),
    ],
    repairs: [
      { id: 'repair-ready', code: 'DISP-0911-001', issueId: 'issue-final', date: '2026-09-11', quantity: 2, description: '完成 2 台返工，待按 SIP 复验。', basis: '现场返工记录 DISP-0911-001 摘要', photos: [], actorId: 'line-a', at: '2026-09-11T02:00:00.000Z' },
      { id: 'repair-verified', code: 'DISP-0907-02', issueId: 'issue-verified', date: '2026-09-07', quantity: 6, description: '历史 6 台返工完成，原记录未给出根因结论。', basis: '历史返工记录 DISP-0907-02 摘要', photos: [], actorId: 'line-a', at: '2026-09-07T05:00:00.000Z' },
      { id: 'repair-retest-failed', code: 'DISP-0911-PREVIEW', issueId: 'issue-retest-failed', date: '2026-09-11', quantity: 3, description: '3 台已完成首轮返工。', basis: '独立首轮返工记录摘要', photos: [], actorId: 'line-a', at: '2026-09-11T02:00:00.000Z' },
      { id: 'repair-closed', code: 'DISP-0908-PREVIEW', issueId: 'issue-closed', date: '2026-09-08', quantity: 1, description: '1 件尺寸修整完成。', basis: '独立历史返工记录摘要', photos: [], actorId: 'line-b', at: '2026-09-08T02:00:00.000Z' },
    ],
    handoffs: [
      { id: 'handoff-verified', code: 'RETEST-REQ-0907-02', issueId: 'issue-verified', repairId: 'repair-verified', quantity: 6, actorId: 'line-a', at: '2026-09-07T05:10:00.000Z' },
      { id: 'handoff-retest-failed', code: 'RETEST-REQ-0911-PREVIEW', issueId: 'issue-retest-failed', repairId: 'repair-retest-failed', quantity: 3, actorId: 'line-a', at: '2026-09-11T03:00:00.000Z' },
      { id: 'handoff-closed', code: 'RETEST-REQ-0908-PREVIEW', issueId: 'issue-closed', repairId: 'repair-closed', quantity: 1, actorId: 'line-b', at: '2026-09-08T03:00:00.000Z' },
    ],
    receipts: [
      { id: 'receipt-verified', code: 'RETEST-0907-02', issueId: 'issue-verified', handoffId: 'handoff-verified', quantity: 6, good: 6, bad: 0, inspector: 'QC 检验员', date: '2026-09-07', evidence: '历史 SIP-C 复验 6 台合格摘要；正式原件后续接入。', sipVersion: 'C' },
      { id: 'receipt-retest-failed', code: 'RETEST-0911-PREVIEW', issueId: 'issue-retest-failed', handoffId: 'handoff-retest-failed', quantity: 3, good: 2, bad: 1, inspector: 'QC 检验员', date: '2026-09-11', evidence: '独立复验记录摘要：2 台合格，1 台通信异常仍未解决。', sipVersion: 'V1.0' },
      { id: 'receipt-closed', code: 'RETEST-0908-PREVIEW', issueId: 'issue-closed', handoffId: 'handoff-closed', quantity: 1, good: 1, bad: 0, inspector: 'QC 检验员', date: '2026-09-08', evidence: '独立历史尺寸复验合格摘要。', sipVersion: 'V1.0' },
    ],
    collaborations: [],
    events: [{ id: 'event-final-repair', issueId: 'issue-final', actorId: 'line-a', at: '2026-09-11T02:00:00.000Z', kind: 'repair', summary: '2 台现场整改完成，等待交接 QC；其余 1 台尚待处理' }, { id: 'event-closed', issueId: 'issue-closed', actorId: 'quality-a', at: '2026-09-09T07:00:00.000Z', kind: 'close', summary: '依据既有 QC 合格回执关闭，不表示 QA 放行' }],
    samples: [
      { id: 'sample-a-1', sourceKey: 'p03:record-initial', date: '2026-09-11', lineId: 'line-a', phenomenon: '功能异常' },
      { id: 'sample-a-1-duplicate', sourceKey: 'p03:record-initial', date: '2026-09-11', lineId: 'line-a', phenomenon: '功能异常' },
      { id: 'sample-a-2', sourceKey: 'sample:0909-a', date: '2026-09-09', lineId: 'line-a', phenomenon: '功能异常' },
      { id: 'sample-a-3', sourceKey: 'p02:defect-seed', date: '2026-09-11', lineId: 'line-a', phenomenon: '功能异常' },
      { id: 'sample-a-4', sourceKey: 'sample:0902-a', date: '2026-09-02', lineId: 'line-a', phenomenon: '装配干涉' },
      { id: 'sample-b-1', sourceKey: 'p03:record-process', date: '2026-09-11', lineId: 'line-b', phenomenon: '装配干涉' },
      { id: 'sample-b-2', sourceKey: 'sample:0908-b', date: '2026-09-08', lineId: 'line-b', phenomenon: '尺寸偏差' },
      { id: 'sample-b-3', sourceKey: 'sample:0905-b', date: '2026-09-05', lineId: 'line-b', phenomenon: '装配干涉' },
    ],
  };
}
export function getDefectRanking(state: DefectState, lineId: string | 'all', today = defectToday()): Array<{ phenomenon: string; count: number }> {
  if (!validDate(today)) return [];
  const start = new Date(Date.parse(`${today}T00:00:00.000Z`) - 29 * 86400000).toISOString().slice(0, 10);
  const seen = new Set<string>(); const counts = new Map<string, number>();
  for (const sample of state.samples) {
    if (!validDate(sample.date) || sample.date < start || sample.date > today || (lineId !== 'all' && sample.lineId !== lineId) || !sample.sourceKey.trim() || !sample.phenomenon.trim() || seen.has(sample.sourceKey)) continue;
    seen.add(sample.sourceKey); counts.set(sample.phenomenon, (counts.get(sample.phenomenon) ?? 0) + 1);
  }
  return [...counts].map(([phenomenon, count]) => ({ phenomenon, count })).sort((a, b) => b.count - a.count || a.phenomenon.localeCompare(b.phenomenon, 'zh-CN'));
}
export function buildDefectCsv(state: DefectState, issueId: string): string {
  const selected = issueFor(state, issueId); const rows: unknown[][] = [['章节', '记录', '字段', '值']];
  const names: Record<string, string> = { id: '记录 ID', code: '编号', sourceKey: '来源去重标识', sourceType: '来源类型', sourceCode: '来源编号', sourceTaskId: '来源任务 ID', sourceRecordId: '来源记录 ID', archiveId: '关联档案 ID', batchCode: '生产批次', product: '产品', material: '物料或组件', lineId: '产线 ID', lineName: '产线', process: '工序', date: '业务日期', quantity: '数量', unit: '单位', phenomenon: '不良现象', description: '说明', priority: '优先级', ownerId: '责任岗位', dueDate: '预计完成日期', direction: '处理方向', causeStatus: '原因确认状态', cause: '已确认原因', closedAt: '关闭时间', closedBy: '关闭岗位', closeSummary: '关闭说明', issueId: '不良 ID', basis: '整改依据', actorId: '操作岗位', at: '操作时间', repairId: '整改来源 ID', handoffId: '交接来源 ID', good: 'QC 合格数量', bad: 'QC 不良数量', inspector: '检验员', evidence: '检验依据说明', sipVersion: 'SIP 版本', kind: '操作类型', summary: '记录说明', name: '名称', role: '岗位', type: '图片类型', size: '文件字节数', resolved: '已有 QC 合格数量', pendingReinspection: '待 QC 复验数量', ready: '已整改待交接数量', remaining: '尚未解决数量', availableToRepair: '当前可登记整改数量', repaired: '历次累计整改次数量' };
  const add = (section: string, id: string, field: string, value: unknown) => rows.push([section, id, field, value === undefined || value === null || value === '' ? '—' : value]);
  const object = (section: string, id: string, value: object) => { for (const [field, entry] of Object.entries(value)) add(section, id, names[field] ?? field, entry); };
  add('导出说明', selected.code, '演示边界', '独立前端来源快照；研发/采购仅建立本地协同记录，不创建正式任务，不写入 P02/P03、档案、库存或实际出货。');
  add('导出说明', selected.code, '数量口径', '按原不良数量跟踪；复验不良可再次整改，历次整改次数量可能超过原数量。QC 合格回执与关闭、QA 放行、实际出货分别记录。');
  add('导出说明', selected.code, '来源与资料', '按来源单据去重，不代表跨 P02/P03 物理全局去重；SIP 与凭据为摘要，照片仅导出名称、类型和大小。');
  object('不良问题', selected.code, selected); object('处置进度', selected.code, getDefectProgress(state, selected.id));
  for (const actor of state.actors) object('岗位', actor.id, actor);
  for (const repair of state.repairs.filter((item) => item.issueId === selected.id)) { const { photos, ...base } = repair; object('整改记录', repair.code, base); for (const photo of photos) { const { dataUrl: _dataUrl, ...metadata } = photo; object(`整改照片 / ${repair.code}`, photo.id, metadata); } }
  for (const item of state.handoffs.filter((entry) => entry.issueId === selected.id)) object('复验交接', item.code, item);
  for (const item of state.receipts.filter((entry) => entry.issueId === selected.id)) object('既有 QC 回执', item.code, item);
  for (const item of state.collaborations.filter((entry) => entry.issueId === selected.id)) object('本地协同记录', item.code, item);
  for (const item of state.events.filter((entry) => entry.issueId === selected.id)) object('操作记录', item.id, item);
  const cell = (value: unknown) => { let text = String(value ?? ''); if (/^[\s\u0000-\u001f\u007f]*[=+\-@]/u.test(text) || /^[\t\r\n]/u.test(text)) text = `'${text}`; return `"${text.replaceAll('"', '""')}"`; };
  return `\uFEFF${rows.map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`;
}
