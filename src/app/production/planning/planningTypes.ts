export type PlanningRole = 'planner' | 'supervisor' | 'line';
export interface PlanningActor { id: string; name: string; role: PlanningRole; lineId?: string }
export interface PlanningLine { id: string; name: string }
export interface PlanningProduct { id: string; code: string; name: string; monthlyTargets: Record<string, number> }
export interface PlanningDocument { id: string; code: string; title: string; version: string; status: 'published' | 'pending'; summary: string }
export interface PlanningMaterial { id: string; code: string; name: string; unit: string; perUnit: number }
export interface PlanningOperation { id: string; component: string; process: string; unit: string; requiredQty: number; lineIds: string[]; materials: PlanningMaterial[]; documents: PlanningDocument[] }
export interface PlanningBatch {
  id: string; code: string; planCode: string; productId: string; target: number; dueDate: string;
  startDate: string; endDate: string; bomVersion: string; status: 'active' | 'closed';
  completed: number; completedDate?: string; completionSource: string;
  readiness: { current: number; onTime: number | null; availableDate: string | null; checkedAt: string; note: string };
  operations: PlanningOperation[]; ecnId?: string; archiveId?: string;
}
export type PlanningTaskStatus = 'draft' | 'dispatched' | 'in-progress' | 'completed' | 'cancelled';
export interface PlanningTask {
  id: string; code: string; batchId: string; operationId: string; date: string; lineId: string; ownerId: string;
  quantity: number; reported: number; qualified: number; rework: number; status: PlanningTaskStatus;
  actualDate?: string; actualLineId?: string; note: string; revision: number;
}
export interface PlanningDispatch {
  id: string; code: string; taskId: string; taskRevision: number; date: string; quantity: number;
  lineId: string; ownerId: string; actorId: string; confirmedAt: string;
}
export interface PlanningMaterialRequest {
  id: string; code: string; taskId: string; taskRevision: number; neededDate: string;
  lines: { materialId: string; code: string; name: string; unit: string; quantity: number; issued: number }[];
}
export type PlanningActionKind = 'create' | 'adjust' | 'dispatch' | 'cancel';
export interface PlanningEvent {
  id: string; taskId: string; kind: PlanningActionKind; actorId: string; at: string; reason: string;
  before: Record<string, string | number>; after: Record<string, string | number>;
}
export interface PlanningState {
  version: number; actors: PlanningActor[]; lines: PlanningLine[]; products: PlanningProduct[];
  batches: PlanningBatch[]; tasks: PlanningTask[]; dispatches: PlanningDispatch[];
  materialRequests: PlanningMaterialRequest[]; events: PlanningEvent[];
}
interface ScheduleInput { date: string; lineId: string; ownerId: string; quantity: number; note: string }
export type PlanningAction =
  | ({ kind: 'create'; actorId: string; batchId: string; operationId: string } & ScheduleInput)
  | ({ kind: 'adjust'; actorId: string; taskId: string; reason: string } & ScheduleInput)
  | { kind: 'dispatch'; actorId: string; taskId: string; reviewed: boolean; note: string }
  | { kind: 'cancel'; actorId: string; taskId: string; reason: string };
export interface PlanningActionContext { kind: PlanningActionKind; batchId: string; taskId?: string }
export type PlanningView = 'tasks' | 'schedule' | 'dispatches' | 'history';
export const planningViewLabels: Record<PlanningView, string> = { tasks: '组件计划', schedule: '批次日安排', dispatches: '派工与用料', history: '变更记录' };
export const planningStatusLabels: Record<PlanningTaskStatus, string> = { draft: '待派工', dispatched: '已派工', 'in-progress': '进行中', completed: '已完成', cancelled: '已取消' };
export const planningRoleLabels: Record<PlanningRole, string> = { planner: '计划员', supervisor: '生产主管', line: '线长（查看）' };
export const planningActionLabels: Record<PlanningActionKind, string> = { create: '新增组件任务', adjust: '调整计划', dispatch: '确认派工', cancel: '取消未派工任务' };
