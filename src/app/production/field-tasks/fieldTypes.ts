import type { PlanningDocument } from '../planning/planningTypes';

export interface FieldActor { id: string; name: string; role: 'line' | 'supervisor' | 'viewer'; lineId?: string }
export interface FieldPhoto { id: string; name: string; type: 'image/png' | 'image/jpeg'; size: number; dataUrl: string }
export interface FieldTask {
  id: string; code: string; dispatchCode: string; dispatchVersion: number; batchId: string; batchCode: string;
  product: string; component: string; process: string; unit: string; date: string; lineId: string;
  lineName: string; ownerId: string; planned: number; acceptedAt?: string; acceptedBy?: string;
  closed: boolean; documents: PlanningDocument[]; ecnId?: string;
}
export interface FieldIssue {
  id: string; code: string; taskId: string; materialCode: string; materialName: string; unit: string;
  quantity: number; lotCode: string | null; issuedAt: string; signedAt?: string; signedBy?: string;
}
export interface FieldReport {
  id: string; code: string; taskId: string; date: string; actual: number; good: number; bad: number;
  note: string; actorId: string; at: string;
}
export interface FieldDefect {
  id: string; code: string; taskId: string; reportId: string; quantity: number; phenomenon: string;
  description: string; issueId: string | null; missingLot: boolean; photos: FieldPhoto[];
  actorId: string; at: string; status: 'pending';
}
export interface FieldReturn {
  id: string; code: string; taskId: string; issueId: string; quantity: number; reason: string;
  actorId: string; at: string; status: 'requested';
}
export interface FieldReportDraft { date: string; actual: string; good: string; bad: string; note: string }
export interface FieldEvent { id: string; taskId: string; actorId: string; at: string; kind: FieldActionKind; summary: string }
export interface FieldState {
  version: number; actors: FieldActor[]; tasks: FieldTask[]; issues: FieldIssue[]; reports: FieldReport[];
  defects: FieldDefect[]; returns: FieldReturn[]; drafts: Record<string, FieldReportDraft>; events: FieldEvent[];
}
interface FieldBase { taskId: string; actorId: string }
export type FieldAction =
  | (FieldBase & { kind: 'accept'; reviewed: boolean })
  | (FieldBase & { kind: 'sign'; issueId: string; reviewed: boolean })
  | (FieldBase & { kind: 'save-draft'; draft: FieldReportDraft })
  | (FieldBase & { kind: 'report'; date: string; actual: number; good: number; bad: number; note: string })
  | (FieldBase & { kind: 'defect'; reportId: string; quantity: number; phenomenon: string; description: string; issueId: string | null; photos: FieldPhoto[] })
  | (FieldBase & { kind: 'return'; issueId: string; quantity: number; reason: string; reviewed: boolean });
export type FieldActionKind = FieldAction['kind'];
export interface FieldActionContext { kind: Exclude<FieldActionKind, 'save-draft'>; taskId: string; reportId?: string; issueId?: string }
export type FieldView = 'reports' | 'materials' | 'defects' | 'history';
export const fieldViewLabels: Record<FieldView,string> = { reports: '报工记录', materials: '领退料记录', defects: '不良记录', history: '操作记录' };
export const fieldActionLabels: Record<FieldActionKind,string> = { accept:'接收派工', sign:'签收领料', 'save-draft':'保存报工草稿', report:'提交报工', defect:'登记不良', return:'申请退料' };
export const fieldPhenomena = ['装配干涉', '功能异常', '尺寸偏差', '外观划伤', '其他'];
