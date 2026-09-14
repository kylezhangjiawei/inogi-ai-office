import type { FieldPhoto } from '../field-tasks/fieldTypes';
export type DefectPhoto = FieldPhoto;
export type DefectDirection = 'pending' | 'onsite' | 'rd' | 'procurement';
export interface DefectActor { id: string; name: string; role: 'quality' | 'line' | 'rd' | 'procurement' | 'qc' | 'viewer'; lineId?: string }
export interface DefectIssue {
  id: string; code: string; sourceKey: string; sourceType: 'process' | 'final' | 'field'; sourceCode: string;
  sourceTaskId?: string; sourceRecordId?: string; archiveId?: string; batchCode: string; product: string; material: string;
  lineId: string; lineName: string; process: string; date: string; quantity: number; unit: string; phenomenon: string; description: string;
  priority: 'high' | 'medium' | 'low'; ownerId: string | null; dueDate: string | null; direction: DefectDirection;
  causeStatus: 'pending' | 'confirmed'; cause: string; closedAt?: string; closedBy?: string; closeSummary?: string;
}
export interface DefectRepair { id: string; code: string; issueId: string; date: string; quantity: number; description: string; basis: string; photos: DefectPhoto[]; actorId: string; at: string }
export interface DefectHandoff { id: string; code: string; issueId: string; repairId: string; quantity: number; actorId: string; at: string }
export interface DefectReceipt { id: string; code: string; issueId: string; handoffId: string; quantity: number; good: number; bad: number; inspector: string; date: string; evidence: string; sipVersion: string }
export interface DefectCollaboration { id: string; code: string; issueId: string; direction: 'rd' | 'procurement'; ownerId: string; description: string; actorId: string; at: string }
export interface DefectEvent { id: string; issueId: string; actorId: string; at: string; kind: DefectActionKind; summary: string }
export interface DefectSample { id: string; sourceKey: string; date: string; lineId: string; phenomenon: string }
export interface DefectState { version: number; actors: DefectActor[]; issues: DefectIssue[]; repairs: DefectRepair[]; handoffs: DefectHandoff[]; receipts: DefectReceipt[]; collaborations: DefectCollaboration[]; events: DefectEvent[]; samples: DefectSample[] }
interface DefectBase { issueId: string; actorId: string; reviewed: boolean }
export type DefectAction =
 | (DefectBase & { kind: 'assign'; ownerId: string; dueDate: string; priority: DefectIssue['priority']; reason: string })
 | (DefectBase & { kind: 'route'; direction: Exclude<DefectDirection,'pending'>; ownerId: string; dueDate: string; description: string; causeStatus: DefectIssue['causeStatus']; cause: string })
 | (DefectBase & { kind: 'repair'; date: string; quantity: number; description: string; basis: string; photos: DefectPhoto[] })
 | (DefectBase & { kind: 'handoff'; repairId: string; quantity: number })
 | (DefectBase & { kind: 'close'; summary: string });
export type DefectActionKind = DefectAction['kind'];
export interface DefectActionContext { kind: DefectActionKind; issueId: string; repairId?: string; direction?: Exclude<DefectDirection,'pending'> }
export type DefectView = 'overview' | 'repairs' | 'reinspection' | 'history';
export const defectViewLabels: Record<DefectView,string> = { overview:'问题与协同',repairs:'整改记录',reinspection:'复验交接',history:'操作记录' };
export const defectActionLabels: Record<DefectActionKind,string> = { assign:'指派责任人',route:'确定处理方向',repair:'登记现场整改',handoff:'提交复验',close:'关闭不良' };
export const defectDirectionLabels: Record<DefectDirection,string> = { pending:'待确定',onsite:'现场整改',rd:'研发协同',procurement:'采购协同' };
export const defectPhenomena = ['装配干涉','功能异常','尺寸偏差','外观划伤','其他'];
export interface DefectProgress { resolved: number; pendingReinspection: number; ready: number; remaining: number; availableToRepair: number; repaired: number }
