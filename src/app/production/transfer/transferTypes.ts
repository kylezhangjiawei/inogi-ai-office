export type TransferRole = 'process' | 'quality' | 'lead' | 'viewer';
export interface TransferActor { id: string; name: string; role: TransferRole }
export type DocumentKind = 'drawing' | 'bom' | 'sop' | 'sip' | 'ecn' | 'software' | 'hardware';
export interface TransferDocument { id: string; kind: DocumentKind; code: string; revision: string; status: 'published' | 'pending'; summary: string }
export interface TransferEvidence { id: string; name: string; type: 'photo' | 'video'; dataUrl: string }
export interface TransferTrial { id: string; date: string; quantity: number; passed: boolean; result: string; evidence: TransferEvidence[]; actorId: string; basisVersion: number }
export interface TransferProblem { id: string; title: string; status: 'open' | 'verification' | 'closed'; remedy?: string; verification?: string; verifiedBy?: string; basisVersion?: number }
export interface TransferConfirmation { role: TransferRole; actorId: string; note: string; basisVersion: number }
export interface TransferRecord { id: string; code: string; batch: string; sample: string; product: string; type: 'device' | 'part' | 'actuator'; date: string; status: 'preparing' | 'confirmed'; samplePassed: boolean; sampleConclusion: string; basisVersion: number; documents: TransferDocument[]; requiredKinds: DocumentKind[]; requiredRoles: TransferRole[]; minTrialQuantity: number; requireVideo: boolean; trials: TransferTrial[]; problems: TransferProblem[]; confirmations: TransferConfirmation[]; events: { id: string; at: string; actorId: string; label: string; detail: string }[]; confirmedAt?: string; confirmedBy?: string }
export interface TransferState { version: number; actors: TransferActor[]; records: TransferRecord[] }
export type TransferAction = { actorId: string; recordId: string } & (
  { kind: 'document'; documentId: string; revision: string; summary: string; published: boolean } |
  { kind: 'trial'; date: string; quantity: number; passed: boolean; result: string; evidence: TransferEvidence[] } |
  { kind: 'remedy'; problemId: string; note: string } |
  { kind: 'verify'; problemId: string; note: string; passed: boolean } |
  { kind: 'confirm'; reviewed: boolean; note: string } |
  { kind: 'submit'; reviewed: boolean; note: string }
);
export interface TransferActionContext { kind: TransferAction['kind']; recordId: string; targetId?: string }
export const transferRoleLabels: Record<TransferRole, string> = { process: '工艺', quality: '质量', lead: '生产负责人', viewer: '只读查看' };
export const transferDocumentLabels: Record<DocumentKind, string> = { drawing: '图纸', bom: 'BOM', sop: 'SOP', sip: 'SIP', ecn: 'ECN', software: '软件版本', hardware: '硬件版本' };
export const transferActionLabels: Record<TransferAction['kind'], string> = { document: '补充资料', trial: '保存试装记录', remedy: '登记整改', verify: '记录问题复验', confirm: '完成本人岗位确认', submit: '提交转产确认' };
export const transferTabLabels = { documents: '资料与版本', trials: '试装验证', problems: '问题与复验', confirmations: '岗位确认', history: '操作记录' };
export type TransferTab = keyof typeof transferTabLabels;
