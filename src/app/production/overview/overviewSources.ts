import { createPlanningState } from '../planning/planningModel';
import { createInspectionState } from '../inspections/inspectionModel';
import { getDefectPreviewState } from '../defects/defectPreviewSession';
import { getDefectProgress, validateDefectAction } from '../defects/defectModel';
import { getRdPreviewState } from '../rd-collaboration/rdPreviewSession';
import { getRdCase, getRdCurrentActorId } from '../rd-collaboration/rdModel';
import { rdStatusLabels } from '../rd-collaboration/rdTypes';
import { createEcnState } from '../ecn/ecnModel';
import { createTransferState, getTransferGates } from '../transfer/transferModel';
import type { OverviewSources } from './overviewModel';

export function readOverviewSources(): OverviewSources {
  const transfer = createTransferState();
  const defects = getDefectPreviewState();
  const rd = getRdPreviewState();
  const defectWorkflows: Record<string, { owner: string; node: string; href: string; summary: string }> = {};
  for (const issue of defects.issues) {
    if (issue.direction !== 'rd' || issue.closedAt) continue;
    const record = getRdCase(rd, defects, issue.id);
    if (!record) continue;
    const collaboration = defects.collaborations.find((entry) => entry.issueId === issue.id && entry.direction === 'rd');
    const name = (actorId: string | undefined | null) => defects.actors.find((actor) => actor.id === actorId)?.name ?? '待核对';
    const technicalClosed = record.status === 'closed';
    defectWorkflows[issue.id] = {
      owner: technicalClosed ? name(defects.actors.find((actor) => actor.role === 'quality')?.id) : name(getRdCurrentActorId(rd, defects, issue.id)),
      node: technicalClosed ? '技术协同已关闭，原不良待处理' : rdStatusLabels[record.status],
      href: `/__preview/${technicalClosed ? 'production-defects' : 'production-rd'}?issue=${encodeURIComponent(issue.id)}`,
      summary: `研发发起人 ${name(collaboration?.actorId)}；研发处理人 ${name(issue.ownerId)}。${technicalClosed ? '技术验证与协同已完成，原不良仍需独立整改和 QC 复验。' : '当前责任人按技术协同流程展示；技术验证不冲减原不良数量。'}`,
    };
  }
  const closer = defects.actors.find((actor) => actor.role === 'quality');
  for (const issue of defects.issues) {
    if (issue.closedAt || !closer || (issue.direction === 'rd' && getRdCase(rd, defects, issue.id)?.status !== 'closed')) continue;
    const progress = getDefectProgress(defects, issue.id);
    if (progress.remaining > 0 || progress.ready > 0 || progress.pendingReinspection > 0) continue;
    const closeErrors = validateDefectAction(defects, { kind: 'close', actorId: closer.id, issueId: issue.id, reviewed: true, summary: '只读核对关闭条件' }, issue.date);
    if (Object.keys(closeErrors).length) continue;
    defectWorkflows[issue.id] = {
      owner: closer.name,
      node: 'QC 复验通过，待质量关闭',
      href: `/__preview/production-defects?issue=${encodeURIComponent(issue.id)}`,
      summary: `${defectWorkflows[issue.id]?.summary ?? `原不良范围 ${issue.quantity} ${issue.unit}；来源 ${issue.sourceCode}。`}已有 ${progress.resolved} ${issue.unit} QC 合格回执，待质量管理核对并关闭；原责任人保留在不良原单。`,
    };
  }
  return { planning: createPlanningState(), inspections: createInspectionState(), defects, defectWorkflows, ecn: createEcnState(),
    transfers: transfer.records.map((record) => ({ key: `transfer:${record.id}`, code: record.code, kind: 'transfer', date: record.date, dueDate: record.date,
      batch: record.batch, subject: record.product, lineId: null, owner: transfer.actors.find((actor) => actor.role === 'lead')?.name ?? '待确认',
      node: record.status === 'confirmed' ? '已确认转产' : getTransferGates(record).blockers.length ? '资料与验证待齐' : '待负责人确认',
      status: record.status === 'confirmed' ? 'done' : 'open', risk: record.status !== 'confirmed' && getTransferGates(record).blockers.length ? '转产条件未齐' : '',
      href: `/__preview/production-transfer?transfer=${record.id}&tab=documents`, summary: `${record.sample} · ${getTransferGates(record).blockers.join('；') || '当前转产条件已齐，等待确认'}` })) };
}
