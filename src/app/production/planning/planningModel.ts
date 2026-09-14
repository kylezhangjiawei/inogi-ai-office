import type { PlanningAction, PlanningBatch, PlanningDocument, PlanningOperation, PlanningState, PlanningTask } from './planningTypes';

// Local, disposable scheduling examples. Requests are planning records, not warehouse
// issues; rescheduling never rewrites actual reports, completed products, or P09 facts.
const clone = <T,>(value: T): T => structuredClone(value);
const fail = (message: string): never => { throw new Error(message); };
const batchFor = (state: PlanningState, id: string) => state.batches.find((batch) => batch.id === id) ?? fail('生产批次已不存在');
const operationFor = (batch: PlanningBatch, id: string) => batch.operations.find((operation) => operation.id === id) ?? fail('该批次的工序已不存在');
function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01') return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
export function canPlan(state: PlanningState, actorId: string): boolean { return state.actors.some((actor) => actor.id === actorId && ['planner', 'supervisor'].includes(actor.role)); }

export function getTaskProgress(task: PlanningTask): { remaining: number; notStarted: number; reported: number; qualified: number; rework: number } {
  return { remaining: task.status === 'cancelled' ? 0 : Math.max(0, task.quantity - task.qualified), notStarted: task.status === 'cancelled' ? 0 : Math.max(0, task.quantity - task.reported), reported: task.reported, qualified: task.qualified, rework: task.rework };
}
export function getOperationTotals(state: PlanningState, batchId: string, operationId: string): { planned: number; required: number; unplanned: number; qualified: number; rework: number } {
  const operation = operationFor(batchFor(state, batchId), operationId);
  const tasks = state.tasks.filter((task) => task.batchId === batchId && task.operationId === operationId && task.status !== 'cancelled');
  const planned = tasks.reduce((sum, task) => sum + task.quantity, 0);
  return { planned, required: operation.requiredQty, unplanned: Math.max(0, operation.requiredQty - planned), qualified: tasks.reduce((sum, task) => sum + task.qualified, 0), rework: tasks.reduce((sum, task) => sum + task.rework, 0) };
}
export function getMonthlyProgress(state: PlanningState, month: string, productId?: string): { target: number; completed: number; remaining: number } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) fail('请选择有效月份');
  if (productId !== undefined && !state.products.some((product) => product.id === productId)) fail('请选择有效产品');
  const products = state.products.filter((product) => productId === undefined || product.id === productId);
  const selected = new Set(products.map((product) => product.id));
  const target = products.reduce((sum, product) => sum + (product.monthlyTargets[month] ?? 0), 0);
  const completed = state.batches.filter((batch) => selected.has(batch.productId) && batch.completedDate?.slice(0, 7) === month).reduce((sum, batch) => sum + batch.completed, 0);
  return { target, completed, remaining: Math.max(0, target - completed) };
}

export function validatePlanningAction(state: PlanningState, input: PlanningAction): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!input || typeof input !== 'object' || !['create', 'adjust', 'dispatch', 'cancel'].includes(input.kind)) return { _form: '不支持的计划操作' };
  if (!canPlan(state, input.actorId)) errors.actorId = '仅计划员或生产主管可以修改计划与派工';
  const task = input.kind === 'create' ? undefined : state.tasks.find((item) => item.id === input.taskId);
  if (input.kind !== 'create' && !task) return { ...errors, _form: '任务已不存在，请重新选择' };
  const batch = state.batches.find((item) => item.id === (input.kind === 'create' ? input.batchId : task?.batchId));
  if (!batch) return { ...errors, batchId: '请选择有效生产批次' };
  const operation = batch.operations.find((item) => item.id === (input.kind === 'create' ? input.operationId : task?.operationId));
  if (!operation) return { ...errors, operationId: '请选择本批次的有效工序' };
  if (batch.status === 'closed') errors._form = '已结案批次仅可查看，不能继续调整或派工';
  if (task && ['completed', 'cancelled'].includes(task.status)) errors._form = task.status === 'completed' ? '已完成任务仅可查看' : '已取消任务仅可查看';
  const fieldText = (field: string, value: unknown, label: string, required: boolean, max = 1000) => {
    if (typeof value !== 'string') { errors[field] = `${label}格式无效`; return; }
    if (required && !value.trim()) errors[field] = `请填写${label}`;
    else if (value.trim().length > max) errors[field] = `${label}不能超过 ${max} 字`;
  };
  if (input.kind === 'create' || input.kind === 'adjust') {
    if (!validDate(input.date)) errors.date = '请选择有效的计划日期';
    else if (input.date < batch.startDate || input.date > batch.endDate) errors.date = `计划日期须在批次窗口 ${batch.startDate} 至 ${batch.endDate} 内`;
    if (!state.lines.some((line) => line.id === input.lineId) || !operation.lineIds.includes(input.lineId)) errors.lineId = '请选择该工序允许的产线';
    const owner = state.actors.find((actor) => actor.id === input.ownerId);
    if (!owner || owner.role !== 'line' || owner.lineId !== input.lineId) errors.ownerId = '负责人须为所选产线的线长';
    if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) errors.quantity = '计划数量须为大于 0 的整数';
    else {
      const others = state.tasks.filter((item) => item.id !== task?.id && item.batchId === batch.id && item.operationId === operation.id && item.status !== 'cancelled').reduce((sum, item) => sum + item.quantity, 0);
      if (input.quantity + others > operation.requiredQty) errors.quantity = `该工序最多还可安排 ${Math.max(0, operation.requiredQty - others)} ${operation.unit}`;
      if (task && input.quantity < task.reported) errors.quantity = `调整后数量不能低于已报工的 ${task.reported} ${operation.unit}`;
      if (task) {
        const requests = state.materialRequests.filter((request) => request.taskId === task.id);
        for (const request of requests) for (const line of request.lines) {
          const material = operation.materials.find((item) => item.id === line.materialId);
          if (!material || !Number.isFinite(material.perUnit) || material.perUnit <= 0 || !Number.isFinite(line.issued) || line.issued < 0) errors.quantity = '已有用料记录与工序用料依据不一致，请先核对';
          else if (input.quantity * material.perUnit < line.issued) errors.quantity = `调整后数量不能低于已发${line.name}对应的 ${Math.ceil(line.issued / material.perUnit)} ${operation.unit}`;
        }
      }
    }
    fieldText('note', input.note, '计划备注', false);
    if (input.kind === 'adjust') {
      fieldText('reason', input.reason, '调整原因', true);
      if (task && input.date === task.date && input.lineId === task.lineId && input.ownerId === task.ownerId && input.quantity === task.quantity && typeof input.note === 'string' && input.note.trim() === task.note) errors._form = '计划安排没有变化';
      if (task && ['dispatched', 'in-progress'].includes(task.status) && (state.dispatches.filter((dispatch) => dispatch.taskId === task.id).length !== 1 || state.materialRequests.filter((request) => request.taskId === task.id).length !== 1)) errors._form = '派工与用料需求关联不完整，请先核对原始记录';
    }
  } else if (input.kind === 'dispatch') {
    if (task?.status !== 'draft') errors._form = '只有未派工的草稿任务可以确认派工，不能重复确认';
    if (input.reviewed !== true) errors.reviewed = '请先确认已核对任务、用料需求及发布资料';
    fieldText('note', input.note, '派工说明', false);
    if (state.dispatches.some((dispatch) => dispatch.taskId === task!.id) || state.materialRequests.some((request) => request.taskId === task!.id)) errors._form = '该任务已有派工或用料需求，不能重复创建';
    const missing = ['BOM', 'SOP', 'SIP'].filter((kind) => !operation.documents.some((document) => new RegExp(`^${kind}(?:-|$)`, 'i').test(document.code) && document.status === 'published' && document.version.trim()));
    if (missing.length) errors.documents = `${missing.join('、')} 尚未发布齐全，暂不能派工`;
    if (!operation.materials.length || operation.materials.some((material) => !Number.isFinite(material.perUnit) || material.perUnit <= 0)) errors.materials = '工序用料依据尚未齐全，暂不能生成用料需求';
    // Recheck the saved schedule at confirmation; drafts do not bypass quantity/line/date limits.
    const scheduleErrors = validatePlanningAction(state, { kind: 'adjust', actorId: input.actorId, taskId: task!.id, date: task!.date, lineId: task!.lineId, ownerId: task!.ownerId, quantity: task!.quantity, note: task!.note, reason: '派工前核对保存的计划' });
    for (const [key, value] of Object.entries(scheduleErrors)) if (key !== '_form') errors[key] = value;
  } else {
    if (task?.status !== 'draft' || task.reported !== 0 || task.qualified !== 0 || task.rework !== 0) errors._form = '只有尚未报工的草稿任务可以取消';
    if (state.dispatches.some((dispatch) => dispatch.taskId === task!.id) || state.materialRequests.some((request) => request.taskId === task!.id)) errors._form = '已有派工或用料需求的任务不能按草稿取消';
    fieldText('reason', input.reason, '取消原因', true);
  }
  return errors;
}

function snapshot(state: PlanningState, task: PlanningTask): Record<string, string | number> {
  return { id: task.id, code: task.code, batchId: task.batchId, operationId: task.operationId, date: task.date, lineId: task.lineId, ownerId: task.ownerId, quantity: task.quantity, reported: task.reported, qualified: task.qualified, rework: task.rework, status: task.status, actualDate: task.actualDate ?? '', actualLineId: task.actualLineId ?? '', note: task.note, revision: task.revision, dispatch: JSON.stringify(state.dispatches.find((item) => item.taskId === task.id) ?? null), materialRequest: JSON.stringify(state.materialRequests.find((item) => item.taskId === task.id) ?? null) };
}
export function applyPlanningAction(state: PlanningState, expectedVersion: number, input: PlanningAction, now = new Date().toISOString()): PlanningState {
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion !== state.version) fail('计划数据已变化，请重新核对后提交');
  const errors = validatePlanningAction(state, input); if (Object.keys(errors).length) fail(Object.values(errors)[0]);
  const atDate = new Date(now); if (!Number.isFinite(atDate.getTime())) fail('操作时间无效'); const at = atDate.toISOString();
  const next = clone(state); next.version += 1;
  const ids = new Set([...next.tasks, ...next.dispatches, ...next.materialRequests, ...next.events].map((item) => item.id));
  function id(prefix: string) { let result = `${prefix}-${next.version}`; let suffix = 1; while (ids.has(result)) result = `${prefix}-${next.version}-${suffix++}`; ids.add(result); return result; }
  let task: PlanningTask; let before: Record<string, string | number> = {}; let reason = '';
  if (input.kind === 'create') {
    task = { id: id('task'), code: `TASK-${next.version}`, batchId: input.batchId, operationId: input.operationId, date: input.date, lineId: input.lineId, ownerId: input.ownerId, quantity: input.quantity, reported: 0, qualified: 0, rework: 0, status: 'draft', note: input.note.trim(), revision: 1 };
    next.tasks.push(task); reason = '新增组件任务，等待派工';
  } else {
    task = next.tasks.find((item) => item.id === input.taskId)!; before = snapshot(next, task);
    if (input.kind === 'adjust') {
      Object.assign(task, { date: input.date, lineId: input.lineId, ownerId: input.ownerId, quantity: input.quantity, note: input.note.trim(), revision: task.revision + 1 });
      reason = input.reason.trim() || '调整未派工草稿';
      const dispatch = next.dispatches.find((item) => item.taskId === task.id);
      if (dispatch) Object.assign(dispatch, { taskRevision: task.revision, date: task.date, quantity: task.quantity, lineId: task.lineId, ownerId: task.ownerId });
      const request = next.materialRequests.find((item) => item.taskId === task.id);
      if (request) {
        const operation = operationFor(batchFor(next, task.batchId), task.operationId);
        request.taskRevision = task.revision; request.neededDate = task.date;
        for (const line of request.lines) line.quantity = task.quantity * operation.materials.find((material) => material.id === line.materialId)!.perUnit;
      }
    } else if (input.kind === 'dispatch') {
      const operation = operationFor(batchFor(next, task.batchId), task.operationId);
      task.status = 'dispatched'; task.revision += 1;
      next.dispatches.push({ id: id('dispatch'), code: `DISPATCH-${next.version}`, taskId: task.id, taskRevision: task.revision, date: task.date, quantity: task.quantity, lineId: task.lineId, ownerId: task.ownerId, actorId: input.actorId, confirmedAt: at });
      next.materialRequests.push({ id: id('material-request'), code: `MR-${next.version}`, taskId: task.id, taskRevision: task.revision, neededDate: task.date, lines: operation.materials.map((material) => ({ materialId: material.id, code: material.code, name: material.name, unit: material.unit, quantity: task.quantity * material.perUnit, issued: 0 })) });
      reason = input.note.trim() || '确认派工并生成本地用料需求';
    } else { task.status = 'cancelled'; task.revision += 1; reason = input.reason.trim(); }
  }
  next.events.push({ id: id('planning-event'), taskId: task.id, kind: input.kind, actorId: input.actorId, at, reason, before, after: snapshot(next, task) });
  return next;
}

function documents(prefix: string, pendingSip = false): PlanningDocument[] {
  return ['BOM', 'SOP', 'SIP'].map((kind) => ({ id: `${prefix}-${kind.toLowerCase()}`, code: `${kind}-${prefix.toUpperCase()}`, title: `${kind === 'BOM' ? '工序用料' : kind === 'SOP' ? '作业步骤' : '检验要求'}摘要`, version: kind === 'BOM' ? 'V3.3' : 'D', status: pendingSip && kind === 'SIP' ? 'pending' : 'published', summary: '独立演示资料摘要，正式受控附件待接入；不代替现场正式作业文件。' }));
}
function operations(requiredQty: number): PlanningOperation[] {
  return [
    { id: 'control', component: '控制组件', process: '装配', unit: '件', requiredQty, lineIds: ['line-a', 'line-b'], materials: [{ id: 'mat-main', code: 'MAT-PCB-100', name: '主控板', unit: '块', perUnit: 1 }, { id: 'mat-shell', code: 'MAT-SHELL-100', name: '壳体', unit: '套', perUnit: 1 }, { id: 'mat-screw', code: 'MAT-SCREW-M3', name: '螺钉', unit: '颗', perUnit: 4 }], documents: documents('control') },
    { id: 'final', component: '整机', process: '总装', unit: '台', requiredQty, lineIds: ['line-a'], materials: [{ id: 'mat-module', code: 'COMP-CONTROL-100', name: '控制组件', unit: '件', perUnit: 1 }, { id: 'mat-frame', code: 'MAT-FRAME-100', name: '整机机架', unit: '套', perUnit: 1 }], documents: documents('final') },
  ];
}
export function createPlanningState(): PlanningState {
  const state: PlanningState = {
    version: 1,
    actors: [{ id: 'planner-a', name: '生产计划员', role: 'planner' }, { id: 'supervisor-a', name: '生产主管', role: 'supervisor' }, { id: 'line-a-owner', name: 'A 线线长', role: 'line', lineId: 'line-a' }, { id: 'line-b-owner', name: 'B 线线长', role: 'line', lineId: 'line-b' }],
    lines: [{ id: 'line-a', name: '装配 A 线' }, { id: 'line-b', name: '装配 B 线' }],
    products: [{ id: 'product-in100', code: 'IN-100', name: '智能控制组件', monthlyTargets: { '2026-08': 300, '2026-09': 1000, '2026-10': 800 } }, { id: 'product-in200', code: 'IN-200', name: '工业通信组件', monthlyTargets: { '2026-09': 200, '2026-10': 80 } }],
    batches: [
      { id: 'batch-new', code: 'B-FG-0910', planCode: 'PP-202609-010', productId: 'product-in100', target: 120, dueDate: '2026-09-15', startDate: '2026-09-10', endDate: '2026-09-17', bomVersion: 'BOM-V3.3', status: 'active', completed: 0, completionSource: '暂无整机完工记录；组件报工不计为整机完工', readiness: { current: 80, onTime: 120, availableDate: '2026-09-13', checkedAt: '2026-09-11T01:00:00.000Z', note: '现有合格库存支持 80 台，按已确认可用日期预测 9 月 13 日支持 120 台；本页不分配库存。' }, operations: operations(120), ecnId: 'ecn-01' },
      { id: 'batch-old', code: 'B-FG-0902', planCode: 'PP-202609-002', productId: 'product-in100', target: 120, dueDate: '2026-09-07', startDate: '2026-09-02', endDate: '2026-09-08', bomVersion: 'BOM-V3.2', status: 'closed', completed: 116, completedDate: '2026-09-07', completionSource: 'RPT-0907-02 包装完工累计 116 台；首次不良与复验独立保留', readiness: { current: 116, onTime: 116, availableDate: '2026-09-02', checkedAt: '2026-09-07T01:00:00.000Z', note: '历史齐套摘要，仅供查看。' }, operations: operations(116), archiveId: 'batch-02' },
      { id: 'batch-closed', code: 'B-FG-0905', planCode: 'PP-202609-005', productId: 'product-in100', target: 100, dueDate: '2026-09-09', startDate: '2026-09-05', endDate: '2026-09-10', bomVersion: 'BOM-V3.2', status: 'closed', completed: 100, completedDate: '2026-09-09', completionSource: 'RPT-0909-05 包装完工 100 台', readiness: { current: 100, onTime: 100, availableDate: '2026-09-05', checkedAt: '2026-09-09T01:00:00.000Z', note: '历史齐套摘要，仅供查看。' }, operations: operations(100) },
      { id: 'batch-in200', code: 'B-FG-1003', planCode: 'PP-202610-003', productId: 'product-in200', target: 80, dueDate: '2026-10-08', startDate: '2026-10-01', endDate: '2026-10-10', bomVersion: 'BOM-COMM-V2', status: 'active', completed: 0, completionSource: '暂无整机完工记录', readiness: { current: 40, onTime: null, availableDate: null, checkedAt: '2026-09-11T01:00:00.000Z', note: '部分物料可用日期待确认，按期齐套预测暂缺。' }, operations: [{ id: 'communication', component: '通信组件', process: '装配', unit: '件', requiredQty: 80, lineIds: ['line-b'], materials: [{ id: 'mat-comm', code: 'MAT-COMM-200', name: '通信板', unit: '块', perUnit: 1 }], documents: documents('communication', true) }] },
      { id: 'batch-carry', code: 'B-FG-0830', planCode: 'PP-202608-030', productId: 'product-in100', target: 40, dueDate: '2026-09-15', startDate: '2026-08-30', endDate: '2026-09-15', bomVersion: 'BOM-V3.2', status: 'active', completed: 0, completionSource: '8 月结转未完批次，暂无整机完工记录', readiness: { current: 40, onTime: 40, availableDate: '2026-08-30', checkedAt: '2026-09-11T01:00:00.000Z', note: '跨月未完安排仍需跟进；示例仅保留计划关系，不占用实际库存。' }, operations: operations(40).filter((operation) => operation.id === 'control') },
    ],
    tasks: [
      { id: 'task-active', code: 'TASK-0911-001', batchId: 'batch-new', operationId: 'control', date: '2026-09-11', lineId: 'line-a', ownerId: 'line-a-owner', quantity: 60, reported: 40, qualified: 36, rework: 4, status: 'in-progress', actualDate: '2026-09-11', actualLineId: 'line-a', note: '已报工 40 件，4 件待返工；实际记录独立于计划安排。', revision: 1 },
      { id: 'task-draft', code: 'TASK-0912-002', batchId: 'batch-new', operationId: 'control', date: '2026-09-12', lineId: 'line-b', ownerId: 'line-b-owner', quantity: 40, reported: 0, qualified: 0, rework: 0, status: 'draft', note: '第二段组件安排，等待派工核对。', revision: 1 },
      { id: 'task-final', code: 'TASK-0914-003', batchId: 'batch-new', operationId: 'final', date: '2026-09-14', lineId: 'line-a', ownerId: 'line-a-owner', quantity: 120, reported: 0, qualified: 0, rework: 0, status: 'draft', note: '整机总装安排，不与前道组件计划相加为产品数量。', revision: 1 },
      { id: 'task-old-control', code: 'TASK-0906-002', batchId: 'batch-old', operationId: 'control', date: '2026-09-06', lineId: 'line-b', ownerId: 'line-b-owner', quantity: 116, reported: 116, qualified: 116, rework: 0, status: 'completed', actualDate: '2026-09-06', actualLineId: 'line-b', note: '历史组件报工，累计合格不重复计入整机完工。', revision: 1 },
      { id: 'task-old-final', code: 'TASK-0907-002', batchId: 'batch-old', operationId: 'final', date: '2026-09-07', lineId: 'line-a', ownerId: 'line-a-owner', quantity: 116, reported: 116, qualified: 116, rework: 0, status: 'completed', actualDate: '2026-09-07', actualLineId: 'line-a', note: '历史整机总装报工。', revision: 1 },
      { id: 'task-closed-final', code: 'TASK-0909-005', batchId: 'batch-closed', operationId: 'final', date: '2026-09-09', lineId: 'line-a', ownerId: 'line-a-owner', quantity: 100, reported: 100, qualified: 100, rework: 0, status: 'completed', actualDate: '2026-09-09', actualLineId: 'line-a', note: '历史整机完工。', revision: 1 },
      { id: 'task-in200', code: 'TASK-1003-003', batchId: 'batch-in200', operationId: 'communication', date: '2026-10-03', lineId: 'line-b', ownerId: 'line-b-owner', quantity: 80, reported: 0, qualified: 0, rework: 0, status: 'draft', note: '检验资料待发布，尚不能派工。', revision: 1 },
      { id: 'task-carry', code: 'TASK-0831-030', batchId: 'batch-carry', operationId: 'control', date: '2026-08-31', lineId: 'line-b', ownerId: 'line-b-owner', quantity: 20, reported: 0, qualified: 0, rework: 0, status: 'draft', note: '8 月末排定但尚未派工，9 月仍需跟进的跨月未完任务。', revision: 1 },
    ],
    dispatches: [{ id: 'dispatch-seed', code: 'DISPATCH-0911-001', taskId: 'task-active', taskRevision: 1, date: '2026-09-11', quantity: 60, lineId: 'line-a', ownerId: 'line-a-owner', actorId: 'planner-a', confirmedAt: '2026-09-10T03:00:00.000Z' }],
    materialRequests: [{ id: 'request-seed', code: 'MR-0911-001', taskId: 'task-active', taskRevision: 1, neededDate: '2026-09-11', lines: [{ materialId: 'mat-main', code: 'MAT-PCB-100', name: '主控板', unit: '块', quantity: 60, issued: 40 }, { materialId: 'mat-shell', code: 'MAT-SHELL-100', name: '壳体', unit: '套', quantity: 60, issued: 40 }, { materialId: 'mat-screw', code: 'MAT-SCREW-M3', name: '螺钉', unit: '颗', quantity: 240, issued: 160 }] }],
    events: [],
  };
  // Closed batches retain their historical document revisions; the new ECN never upgrades them.
  for (const batch of state.batches.filter((item) => item.status === 'closed' || item.id === 'batch-carry')) for (const operation of batch.operations) for (const document of operation.documents) document.version = document.code.startsWith('BOM-') ? 'V3.2' : 'C';
  for (const document of batchFor(state, 'batch-in200').operations[0].documents) if (document.code.startsWith('BOM-')) document.version = 'BOM-COMM-V2';
  return state;
}

export function buildPlanningCsv(state: PlanningState, batchId: string): string {
  const batch = batchFor(state, batchId); const tasks = state.tasks.filter((task) => task.batchId === batchId); const taskIds = new Set(tasks.map((task) => task.id));
  const rows: unknown[][] = [['章节', '记录', '字段', '值']];
  const add = (section: string, record: string, field: string, value: unknown) => rows.push([section, record, field, value === undefined || value === null || value === '' ? '—' : value]);
  const names: Record<string, string> = { id: '记录 ID', code: '编号', planCode: '生产计划', productId: '产品 ID', target: '目标数量', dueDate: '交付日期', startDate: '窗口开始', endDate: '窗口结束', bomVersion: 'BOM 版本', status: '状态', completed: '整机完工数量', completedDate: '整机完工日期', completionSource: '完工来源', ecnId: '关联变更 ID', archiveId: '关联档案 ID', batchId: '批次 ID', operationId: '工序 ID', date: '计划日期', lineId: '计划产线', ownerId: '负责人', quantity: '计划数量', reported: '实际已报工', qualified: '实际合格', rework: '实际待返工', actualDate: '实际报工日期', actualLineId: '实际报工产线', note: '说明', revision: '任务修订', taskId: '任务 ID', taskRevision: '关联任务修订', actorId: '操作人', confirmedAt: '原始派工确认时间', neededDate: '需求日期', issued: '已发数量', materialId: '物料 ID', name: '名称', unit: '单位', perUnit: '单件用量', component: '组件', process: '工序', requiredQty: '工序需求量', lineIds: '允许产线', title: '资料标题', version: '资料版本', summary: '资料摘要', at: '操作时间', kind: '操作类型', reason: '原因', before: '操作前完整快照', after: '操作后完整快照', current: '当前齐套数量', onTime: '按期齐套预测', availableDate: '预计可用日期', checkedAt: '核对时间' };
  function object(section: string, record: string, value: object) { for (const [field, entry] of Object.entries(value)) add(section, record, names[field] ?? field, Array.isArray(entry) ? entry.join('\n') : typeof entry === 'object' && entry !== null ? JSON.stringify(entry) : entry); }
  add('导出说明', batch.code, '边界', '独立前端演示；不分配或扣减库存，不改变实际报工、整机完工、采购订单或历史批次档案。');
  add('导出说明', batch.code, '数量口径', '组件与整机工序计划分别统计；月度完工只取整机完工事实；待完成=计划减合格，未开始=计划减已报工。');
  add('导出说明', batch.code, '资料范围', 'BOM、SOP、SIP 仅为演示摘要，正式受控附件待接入。');
  const { operations, readiness, ...base } = batch; object('批次', batch.code, base); object('齐套摘要', batch.code, readiness);
  const product = state.products.find((item) => item.id === batch.productId); if (product) object('产品及月度目标', product.code, product);
  for (const actor of state.actors) object('岗位', actor.id, actor); for (const line of state.lines) object('产线', line.id, line);
  for (const operation of operations) {
    const { materials, documents, ...operationBase } = operation; object('工序', operation.id, operationBase); object('工序统计', operation.id, getOperationTotals(state, batchId, operation.id));
    for (const material of materials) object(`工序用料 / ${operation.id}`, material.id, material);
    for (const document of documents) object(`工序资料 / ${operation.id}`, document.id, document);
  }
  for (const task of tasks) object('任务与实际报工', task.code, task);
  for (const dispatch of state.dispatches.filter((item) => taskIds.has(item.taskId))) object('派工记录', dispatch.code, dispatch);
  for (const request of state.materialRequests.filter((item) => taskIds.has(item.taskId))) { const { lines, ...requestBase } = request; object('用料需求', request.code, requestBase); for (const line of lines) object(`用料明细 / ${request.code}`, line.materialId, line); }
  for (const event of state.events.filter((item) => taskIds.has(item.taskId))) object('操作历史', event.id, event);
  const cell = (value: unknown) => { let content = String(value ?? ''); if (/^[\s\u0000-\u001f\u007f]*[=+\-@]/u.test(content) || /^[\t\r\n]/u.test(content)) content = `'${content}`; return `"${content.replaceAll('"', '""')}"`; };
  return `\uFEFF${rows.map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`;
}
