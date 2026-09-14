import { applyDefectAction, defectToday, validateDefectAction } from '../defects/defectModel';
import type { DefectActor, DefectState } from '../defects/defectTypes';
import type { RdAction, RdActionKind, RdCase, RdState } from './rdTypes';

const fail = (message: string): never => { throw new Error(message); };
export const createRdState = (): RdState => ({ version: 1, cases: [] });
export function getRdCase(state: RdState, defects: DefectState, issueId: string): RdCase | undefined {
  const collaboration = defects.collaborations.find((item) => item.issueId === issueId && item.direction === 'rd');
  if (!collaboration) return undefined;
  return state.cases.find((item) => item.issueId === issueId && item.collaborationId === collaboration.id) ?? { issueId, collaborationId: collaboration.id, status: 'processing', opinions: [], verifications: [], events: [] };
}
export function getRdVerifiers(defects: DefectState, issueId: string): DefectActor[] {
  const issue = defects.issues.find((item) => item.id === issueId);
  return issue ? defects.actors.filter((actor) => actor.role === 'quality' || actor.role === 'qc' || (actor.role === 'line' && actor.lineId === issue.lineId)) : [];
}
export function getRdCurrentActorId(state: RdState, defects: DefectState, issueId: string): string | undefined {
  const issue = defects.issues.find((item) => item.id === issueId);
  const collaboration = defects.collaborations.find((item) => item.issueId === issueId && item.direction === 'rd');
  const record = getRdCase(state, defects, issueId);
  if (!record || record.status === 'closed' || !issue || issue.closedAt || issue.direction !== 'rd') return undefined;
  if (record.status === 'awaiting-info' || record.status === 'verified') return collaboration?.actorId;
  if (record.status === 'verifying') return record.verifications.at(-1)?.verifierId;
  return issue.ownerId ?? undefined;
}
export function canOperateRd(state: RdState, defects: DefectState, issueId: string, actorId: string, kind: RdActionKind): boolean {
  const issue = defects.issues.find((item) => item.id === issueId); const actor = defects.actors.find((item) => item.id === actorId);
  if (!issue || issue.closedAt || !actor || actor.role === 'viewer' || actor.role === 'procurement') return false;
  const record = getRdCase(state, defects, issueId);
  const collaboration = defects.collaborations.find((item) => item.issueId === issueId && item.direction === 'rd');
  if (record?.status === 'closed') return false;
  if (kind === 'assign') return actor.role === 'quality' && (!record || ['processing', 'opinion-ready', 'awaiting-info'].includes(record.status));
  if (!record || issue.direction !== 'rd' || !collaboration) return false;
  const isHandler = actor.role === 'rd' && issue.ownerId === actorId;
  if (kind === 'request-info') return isHandler && ['processing', 'opinion-ready'].includes(record.status);
  if (kind === 'provide-info') return record.status === 'awaiting-info' && (collaboration.actorId === actorId || actor.role === 'quality');
  if (kind === 'opinion') return isHandler && ['processing', 'opinion-ready'].includes(record.status);
  if (kind === 'send-verification') return isHandler && record.status === 'opinion-ready';
  if (kind === 'verify') return record.status === 'verifying' && record.verifications.at(-1)?.verifierId === actorId;
  return kind === 'close' && record.status === 'verified' && (actor.role === 'quality' || collaboration.actorId === actorId);
}
function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const at = new Date(`${value}T00:00:00.000Z`); return Number.isFinite(at.getTime()) && at.toISOString().slice(0, 10) === value;
}
export function validateRdAction(state: RdState, defects: DefectState, action: RdAction, today = defectToday()): Record<string, string> {
  if (!action || !['assign', 'request-info', 'provide-info', 'opinion', 'send-verification', 'verify', 'close'].includes(action.kind)) return { _form: '不支持的研发操作' };
  if (!validDate(today)) return { _form: '当前业务日期无效，请刷新重试' };
  const errors: Record<string, string> = {}; const issue = defects.issues.find((item) => item.id === action.issueId);
  if (!issue) return { _form: '原异常不存在，请返回 P08 核对来源' };
  if (!canOperateRd(state, defects, issue.id, action.actorId, action.kind)) errors._form = '当前岗位或流程状态不允许此操作，请核对处理人与最新状态';
  if (action.reviewed !== true) errors.reviewed = '请确认本次依据及原异常范围';
  const required = (field: string, value: unknown, label: string, needed = true) => {
    if (typeof value !== 'string' || (needed && !value.trim())) errors[field] = `请填写${label}`;
    else if (value.trim().length > 2000) errors[field] = `${label}不能超过 2000 字`;
  };
  const record = getRdCase(state, defects, issue.id);
  if (action.kind === 'assign') {
    const sourceErrors = validateDefectAction(defects, { ...action, kind: 'route', direction: 'rd', causeStatus: issue.causeStatus, cause: issue.cause }, today);
    Object.assign(errors, sourceErrors);
    const sourceOnly = sourceErrors.direction ?? sourceErrors.cause ?? sourceErrors.causeStatus ?? sourceErrors.actorId;
    if (sourceOnly && !errors._form) errors._form = sourceOnly;
  } else if (action.kind === 'request-info') required('request', action.request, '所需资料与补充要求');
  else if (action.kind === 'provide-info') { required('response', action.response, '补充说明'); required('evidence', action.evidence, '资料编号或证据摘要'); }
  else if (action.kind === 'opinion') {
    required('text', action.text, '技术分析与处理建议'); required('basis', action.basis, '技术判断依据');
    for (const [field, value] of [['drawingChange', action.drawingChange], ['sopChange', action.sopChange]]) if (!['yes', 'no'].includes(value)) errors[field] = '请明确是否需要更新';
    required('drawingReference', action.drawingReference, '图纸变更依据或 ECN 编号', action.drawingChange === 'yes');
    required('sopReference', action.sopReference, 'SOP 变更依据或任务编号', action.sopChange === 'yes');
  } else if (action.kind === 'send-verification') {
    if (!record?.opinions.length) errors._form = '请先提交技术意见，再安排现场验证';
    if (!getRdVerifiers(defects, issue.id).some((actor) => actor.id === action.verifierId)) errors.verifierId = '请选择本产线负责人、质量管理岗或 QC 验证人';
    if (!validDate(action.plannedDate) || action.plannedDate < today) errors.plannedDate = '验证日期须为今天或以后';
  } else if (action.kind === 'verify') {
    const verification = record?.verifications.at(-1);
    if (!verification || verification.result || verification.opinionId !== record?.opinions.at(-1)?.id) errors._form = '验证安排与最新技术意见不一致，请重新安排';
    if (!validDate(action.date) || action.date > today || action.date < issue.date || (verification && action.date < defectToday(verification.assignedAt))) errors.date = '实际验证日期须在安排日之后（含当日），且不能晚于今天';
    if (!['passed', 'failed'].includes(action.result)) errors.result = '请选择实际现场验证结果';
    required('evidence', action.evidence, '验证证据编号或摘要'); required('note', action.note, '现场验证结论');
  } else {
    const verification = record?.verifications.at(-1);
    if (!record?.opinions.length || verification?.result !== 'passed' || verification.opinionId !== record.opinions.at(-1)?.id || !verification.evidence?.trim() || !verification.note?.trim() || !validDate(verification.date) || verification.date > today || !getRdVerifiers(defects, issue.id).some((actor) => actor.id === verification.verifierId)) errors._form = '最新技术意见须有对应的现场验证通过依据，才能关闭技术协同';
    required('summary', action.summary, '技术协同关闭说明');
  }
  return errors;
}
export function applyRdAction(state: RdState, defects: DefectState, expectedVersion: number, expectedDefectVersion: number, action: RdAction, now = new Date().toISOString()): { rd: RdState; defects: DefectState } {
  if (state.version !== expectedVersion || defects.version !== expectedDefectVersion) fail('原异常或技术记录已变化，请重新核对后提交');
  const today = defectToday(now); const errors = validateRdAction(state, defects, action, today);
  if (Object.keys(errors).length) fail(Object.values(errors)[0]);
  const at = new Date(now).toISOString(); const next = structuredClone(state); next.version += 1;
  const nextDefects = action.kind === 'assign' ? applyDefectAction(defects, expectedDefectVersion, { ...action, kind: 'route', direction: 'rd', causeStatus: defects.issues.find((item) => item.id === action.issueId)!.causeStatus, cause: defects.issues.find((item) => item.id === action.issueId)!.cause }, now) : defects;
  let record = next.cases.find((item) => item.issueId === action.issueId);
  if (!record) { record = structuredClone(getRdCase(next, nextDefects, action.issueId) ?? fail('原异常的研发协同来源缺失')); next.cases.push(record); }
  const id = (prefix: string) => `${prefix}-${action.issueId}-${next.version}`;
  let text = '';
  if (action.kind === 'assign') { record.status = 'processing'; text = `指定研发处理人，期限 ${action.dueDate}；${action.description.trim()}`; }
  else if (action.kind === 'request-info') { record.status = 'awaiting-info'; record.infoRequest = action.request.trim(); text = `请求发起方补充：${action.request.trim()}`; }
  else if (action.kind === 'provide-info') { record.status = 'processing'; text = `${action.response.trim()}；资料依据：${action.evidence.trim()}`; record.infoRequest = undefined; }
  else if (action.kind === 'opinion') {
    record.opinions.push({ id: id('opinion'), actorId: action.actorId, at, text: action.text.trim(), basis: action.basis.trim(), drawingChange: action.drawingChange, drawingReference: action.drawingReference.trim(), sopChange: action.sopChange, sopReference: action.sopReference.trim() });
    record.status = 'opinion-ready'; text = '技术意见已记录，等待安排现场验证';
  } else if (action.kind === 'send-verification') {
    record.verifications.push({ id: id('verification'), opinionId: record.opinions.at(-1)!.id, verifierId: action.verifierId, plannedDate: action.plannedDate, assignedAt: at }); record.status = 'verifying'; text = `已安排现场验证，计划 ${action.plannedDate}；本次验证不生成 QC 合格数量`;
  } else if (action.kind === 'verify') {
    Object.assign(record.verifications.at(-1)!, { date: action.date, result: action.result, evidence: action.evidence.trim(), note: action.note.trim() }); record.status = action.result === 'passed' ? 'verified' : 'processing'; text = action.result === 'passed' ? '现场验证通过，等待发起方或质量管理岗确认关闭技术协同' : '现场验证未通过，返回研发重新分析并提交新技术意见';
  } else { record.status = 'closed'; record.closedAt = at; record.closedBy = action.actorId; record.closeSummary = action.summary.trim(); text = `技术协同已关闭：${action.summary.trim()}；原不良、QC 复验与 QA 放行分别处理`; }
  record.events.push({ id: id('rd-event'), actorId: action.actorId, at, kind: action.kind, text });
  return { rd: next, defects: nextDefects };
}
