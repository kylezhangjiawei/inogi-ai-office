export type RdStatus = 'processing' | 'awaiting-info' | 'opinion-ready' | 'verifying' | 'verified' | 'closed';
export type RdActionKind = 'assign' | 'request-info' | 'provide-info' | 'opinion' | 'send-verification' | 'verify' | 'close';
export interface RdOpinion { id: string; actorId: string; at: string; text: string; basis: string; drawingChange: 'yes' | 'no'; drawingReference: string; sopChange: 'yes' | 'no'; sopReference: string }
export interface RdVerification { id: string; opinionId: string; verifierId: string; plannedDate: string; assignedAt: string; date?: string; result?: 'passed' | 'failed'; evidence?: string; note?: string }
export interface RdEvent { id: string; actorId: string; at: string; kind: RdActionKind; text: string }
export interface RdCase { issueId: string; collaborationId: string; status: RdStatus; opinions: RdOpinion[]; verifications: RdVerification[]; events: RdEvent[]; infoRequest?: string; closedAt?: string; closedBy?: string; closeSummary?: string }
export interface RdState { version: number; cases: RdCase[] }
interface Base { issueId: string; actorId: string; reviewed: boolean }
export type RdAction =
  | (Base & { kind: 'assign'; ownerId: string; dueDate: string; description: string })
  | (Base & { kind: 'request-info'; request: string })
  | (Base & { kind: 'provide-info'; response: string; evidence: string })
  | (Base & { kind: 'opinion'; text: string; basis: string; drawingChange: 'yes' | 'no'; drawingReference: string; sopChange: 'yes' | 'no'; sopReference: string })
  | (Base & { kind: 'send-verification'; verifierId: string; plannedDate: string })
  | (Base & { kind: 'verify'; date: string; result: 'passed' | 'failed'; evidence: string; note: string })
  | (Base & { kind: 'close'; summary: string });
export const rdStatusLabels: Record<RdStatus | 'unassigned', string> = { unassigned: '待指定研发', processing: '研发处理中', 'awaiting-info': '待补充资料', 'opinion-ready': '待安排验证', verifying: '现场验证中', verified: '验证通过待关闭', closed: '技术协同已关闭' };
export const rdActionLabels: Record<RdActionKind, string> = { assign: '指定研发处理人', 'request-info': '请求补充资料', 'provide-info': '补充资料', opinion: '提交技术意见', 'send-verification': '转现场验证', verify: '登记现场验证', close: '关闭技术协同' };
