export type EcnStatus = 'draft' | 'published' | 'archived';
export type EcnTab = 'comparison' | 'scope' | 'confirmations' | 'tasks' | 'history';
export type EcnTeam = 'production' | 'purchase' | 'engineering' | 'quality';
export type EcnActionKind = 'acknowledge' | 'disposition' | 'feedback' | 'resolve-task' | 'verify' | 'archive';
export type DispositionChoice = 'retain' | 'rework' | 'return' | 'scrap' | 'revise-order' | 'hold';
export interface EcnActor { id: string; name: string; role: string; team: EcnTeam }
export interface EcnDocument { id: string; code: string; title: string; revision: string; status: 'published' | 'draft'; kind: 'drawing' | 'bom' | 'sop' | 'sip' | 'verification'; summary: string; facts: { label: string; value: string }[]; impactIds: string[] }
export interface EcnDifference { id: string; subject: string; before: string; after: string; reason: string; beforeDocumentId: string; afterDocumentId: string }
export interface EcnImpact { id: string; batchNo: string; planNo: string; product: string; quantity: number; unit: string; range: string; applicability: 'apply' | 'retain' | 'pending'; decision: string }
export interface EcnLegacyTarget { id: string; kind: 'inventory' | 'wip' | 'purchase-order'; code: string; label: string; quantity: number; unit: string; oldVersion: string; impactId?: string }
export interface EcnAcknowledgement { id: string; actorId: string; impactIds: string[]; note: string; at: string }
export interface EcnDisposition { id: string; targetId: string; choice: DispositionChoice; reason: string; actorId: string; at: string }
export interface EcnTask { id: string; code: string; impactId: string; ownerId: string; dueDate: string; description: string; actorId: string; at: string; status: 'open' | 'resolved'; resolution?: string; resolvedBy?: string; resolvedAt?: string }
export interface EcnVerification { id: string; impactId: string; result: 'passed' | 'failed'; evidenceId: string; note: string; actorId: string; at: string }
export interface EcnEvent { id: string; kind: EcnActionKind; actorId: string; at: string; summary: string; before: string; after: string }
export interface EcnRecord { id: string; code: string; title: string; status: EcnStatus; publisher: string; publishedAt: string | null; materialCode: string; materialName: string; process: string; effectiveRule: string; summary: string; documents: EcnDocument[]; differences: EcnDifference[]; impacts: EcnImpact[]; legacyTargets: EcnLegacyTarget[]; requiredActorIds: string[]; acknowledgements: EcnAcknowledgement[]; dispositions: EcnDisposition[]; tasks: EcnTask[]; verifications: EcnVerification[]; events: EcnEvent[]; archivedAt?: string; archivedBy?: string }
export interface EcnState { version: number; actors: EcnActor[]; records: EcnRecord[] }
export type EcnAction =
 | { kind: 'acknowledge'; actorId: string; reviewed: boolean; impactIds: string[]; note: string }
 | { kind: 'disposition'; actorId: string; targetId: string; choice: DispositionChoice; reason: string }
 | { kind: 'feedback'; actorId: string; impactId: string; ownerId: string; dueDate: string; description: string }
 | { kind: 'resolve-task'; actorId: string; taskId: string; resolution: string }
 | { kind: 'verify'; actorId: string; impactId: string; result: 'passed' | 'failed'; evidenceId: string; note: string }
 | { kind: 'archive'; actorId: string; reason: string };
export interface EcnActionContext { kind: EcnActionKind; targetId?: string; taskId?: string; impactId?: string }
export const ecnTabLabels: Record<EcnTab,string> = { comparison:'变更对比', scope:'适用与旧料', confirmations:'岗位确认与验证', tasks:'协同待办', history:'操作记录' };
export const ecnStatusLabels: Record<EcnStatus,string> = { draft:'未发布草稿', published:'已发布', archived:'已归档' };
export const ecnTeamLabels: Record<EcnTeam,string> = { production:'生产', purchase:'采购', engineering:'工艺 / 研发', quality:'质量' };
export const ecnActionLabels: Record<EcnActionKind,string> = { acknowledge:'确认已阅与适用范围', disposition:'记录旧版处置决定', feedback:'反馈执行问题', 'resolve-task':'更新协同处理结果', verify:'登记执行验证', archive:'归档变更' };
export const dispositionLabels: Record<DispositionChoice,string> = { retain:'按旧版保留使用', rework:'返工后按新版验证', return:'退回处理', scrap:'报废处理', 'revise-order':'协商变更订单', hold:'暂缓，待技术判定' };
export const legacyKindLabels: Record<EcnLegacyTarget['kind'],string> = { inventory:'旧库存', wip:'在制品', 'purchase-order':'旧订单' };
export const dispositionOptions: Record<EcnLegacyTarget['kind'],DispositionChoice[]> = { inventory:['retain','rework','return','scrap','hold'], wip:['retain','rework','scrap','hold'], 'purchase-order':['retain','revise-order','return','hold'] };
