import type { PlanningDocument } from '../planning/planningTypes';
import type { FieldPhoto } from '../field-tasks/fieldTypes';

export type InspectionPhoto = FieldPhoto;
export interface InspectionActor { id: string; name: string; role: 'qc' | 'qa' | 'viewer' }
export interface InspectionTask {
  id: string; code: string; batchCode: string; product: string; process: string; stage: 'process' | 'final'; unit: string;
  reportCode: string; quantity: number; date: string; acceptedAt?: string; acceptedBy?: string; closed: boolean;
  documents: PlanningDocument[]; archiveId?: string;
}
export interface InspectionRecord {
  id: string; code: string; taskId: string; kind: 'initial' | 'reinspection'; date: string;
  quantity: number; good: number; bad: number; conclusion: 'qualified' | 'unqualified';
  sipCode: string; sipVersion: string; actorId: string; at: string; note: string; evidence: string; photos: InspectionPhoto[];
  originalId?: string; issueId?: string;
}
export interface InspectionIssue {
  id: string; code: string; taskId: string; recordId: string; quantity: number; phenomenon: string; description: string;
  actorId: string; at: string; readyQuantity: number; dispositionCode?: string; dispositionNote?: string; disposedAt?: string;
}
export interface InspectionRelease { id: string; code: string; taskId: string; quantity: number; basis: string; note: string; actorId: string; at: string }
export interface InspectionEvent { id: string; taskId: string; actorId: string; at: string; kind: InspectionActionKind; summary: string }
export interface InspectionState { version: number; actors: InspectionActor[]; tasks: InspectionTask[]; records: InspectionRecord[]; issues: InspectionIssue[]; releases: InspectionRelease[]; events: InspectionEvent[] }
interface InspectionBase { taskId: string; actorId: string }
interface InspectionInput { date: string; quantity: number; good: number; bad: number; note: string; evidence: string; photos: InspectionPhoto[]; reviewed: boolean }
export type InspectionAction =
  | (InspectionBase & { kind: 'accept'; reviewed: boolean })
  | (InspectionBase & InspectionInput & { kind: 'inspect' })
  | (InspectionBase & InspectionInput & { kind: 'reinspect'; issueId: string })
  | (InspectionBase & { kind: 'transfer'; recordId: string; phenomenon: string; description: string; reviewed: boolean })
  | (InspectionBase & { kind: 'release'; quantity: number; basis: string; note: string; reviewed: boolean });
export type InspectionActionKind = InspectionAction['kind'];
export interface InspectionActionContext { kind: InspectionActionKind; taskId: string; recordId?: string; issueId?: string }
export type InspectionView = 'records' | 'issues' | 'releases' | 'history';
export const inspectionViewLabels: Record<InspectionView, string> = { records: '检验记录', issues: '不良与复验', releases: 'QA 放行', history: '操作记录' };
export const inspectionActionLabels: Record<InspectionActionKind, string> = { accept: '接受报检', inspect: '登记初检', reinspect: '登记复验', transfer: '转不良处理', release: '记录 QA 放行' };
export interface InspectionProgress { initial: number; firstGood: number; firstBad: number; firstPassRate: number | null; uninspected: number; retested: number; retestGood: number; retestBad: number; unresolved: number; qualified: number; released: number; releasable: number }
