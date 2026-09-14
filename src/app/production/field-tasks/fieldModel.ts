import type { FieldAction, FieldPhoto, FieldState, FieldTask } from './fieldTypes';

// Disposable field-execution examples. Reports are shop-floor declarations, not formal QC
// acceptance; returns are requests, not warehouse receipts or assumed material consumption.
const clone = <T,>(value: T): T => structuredClone(value);
const fail = (message: string): never => { throw new Error(message); };
const taskFor = (state: FieldState, id: string) => state.tasks.find((task) => task.id === id) ?? fail('现场任务已不存在');
const issueFor = (state: FieldState, id: string) => state.issues.find((issue) => issue.id === id) ?? fail('领料单已不存在');
const reportFor = (state: FieldState, id: string) => state.reports.find((report) => report.id === id) ?? fail('报工记录已不存在');
const phenomena = ['装配干涉', '功能异常', '尺寸偏差', '外观划伤', '其他'];
function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01') return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
export function fieldToday(now = new Date().toISOString()): string {
  const at = Date.parse(now); if (!Number.isFinite(at)) return fail('操作时间无效');
  return new Date(at + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
export function canOperateField(state: FieldState, actorId: string, taskId: string): boolean {
  const actor = state.actors.find((item) => item.id === actorId); const task = state.tasks.find((item) => item.id === taskId);
  return Boolean(actor && task && !task.closed && (actor.role === 'supervisor' || (actor.role === 'line' && actor.lineId === task.lineId)));
}
export function getReportUnregistered(state: FieldState, reportId: string): number {
  const report = reportFor(state, reportId);
  return Math.max(0, report.bad - state.defects.filter((defect) => defect.reportId === reportId && defect.taskId === report.taskId).reduce((sum, defect) => sum + defect.quantity, 0));
}
export function getFieldProgress(state: FieldState, taskId: string): { reported: number; good: number; bad: number; unreported: number; unregisteredBad: number; registeredBad: number } {
  const task = taskFor(state, taskId); const reports = state.reports.filter((report) => report.taskId === taskId);
  const reported = reports.reduce((sum, report) => sum + report.actual, 0); const good = reports.reduce((sum, report) => sum + report.good, 0); const bad = reports.reduce((sum, report) => sum + report.bad, 0);
  const unregisteredBad = reports.reduce((sum, report) => sum + getReportUnregistered(state, report.id), 0);
  return { reported, good, bad, unreported: Math.max(0, task.planned - reported), unregisteredBad, registeredBad: bad - unregisteredBad };
}
export function getReturnable(state: FieldState, issueId: string): number {
  const issue = issueFor(state, issueId); if (!issue.signedAt) return 0;
  return Math.max(0, Math.round((issue.quantity - state.returns.filter((item) => item.issueId === issueId && item.taskId === issue.taskId).reduce((sum, item) => sum + item.quantity, 0)) * 1000) / 1000);
}
function photoError(photos: unknown): string | null {
  if (!Array.isArray(photos)) return '照片列表格式无效';
  if (photos.length > 3) return '最多可附 3 张照片';
  const ids = new Set<string>();
  for (const value of photos) {
    if (!value || typeof value !== 'object') return '照片信息不完整';
    const photo = value as FieldPhoto;
    if (typeof photo.id !== 'string' || !photo.id.trim() || photo.id.length > 128 || ids.has(photo.id)) return '照片标识无效或重复'; ids.add(photo.id);
    if (typeof photo.name !== 'string' || !photo.name.trim() || photo.name.length > 180) return '照片文件名无效或过长';
    if (!['image/png', 'image/jpeg'].includes(photo.type)) return '照片仅支持 PNG 或 JPEG';
    if (!Number.isSafeInteger(photo.size) || photo.size <= 0 || photo.size > 10 * 1024 * 1024) return '每张照片须大于 0 且不超过 10 MB';
    if (typeof photo.dataUrl !== 'string' || !photo.dataUrl.startsWith(`data:${photo.type};base64,`)) return '照片内容与文件类型不匹配';
    const data = photo.dataUrl.slice(photo.dataUrl.indexOf(',') + 1);
    if (data.length > Math.ceil(10 * 1024 * 1024 / 3) * 4 || !data || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) return '照片内容不是有效的 Base64 图片数据';
    const bytes = data.length * 3 / 4 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
    if (bytes !== photo.size) return '照片大小与实际内容不一致，请重新选择';
  }
  return null;
}
export function validateFieldAction(state: FieldState, input: FieldAction, today = fieldToday()): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!input || typeof input !== 'object' || !['accept', 'sign', 'save-draft', 'report', 'defect', 'return'].includes(input.kind)) return { _form: '不支持的现场操作' };
  if (!validDate(today)) return { _form: '当前业务日期无效，请刷新后重试' };
  const task = state.tasks.find((item) => item.id === input.taskId); if (!task) return { taskId: '请选择有效现场任务' };
  const actor = state.actors.find((item) => item.id === input.actorId);
  if (task.closed) errors._form = '已结案任务仅可查看';
  else if (!canOperateField(state, input.actorId, task.id)) errors.actorId = '仅本线线长或生产主管可操作此任务';
  if (input.kind !== 'accept' && !task.acceptedAt) errors._form = '请先接收派工，再进行现场操作';
  function requiredText(field: string, value: unknown, label: string, required = true, max = 1000) {
    if (typeof value !== 'string') errors[field] = `${label}格式无效`;
    else if (required && !value.trim()) errors[field] = `请填写${label}`;
    else if (value.trim().length > max) errors[field] = `${label}不能超过 ${max} 字`;
  }
  function integral(field: string, value: unknown, label: string, positive: boolean) {
    if (!Number.isSafeInteger(value) || typeof value !== 'number' || value < 0 || (positive && value === 0)) errors[field] = `${label}须为${positive ? '大于 0 的' : '非负'}整数`;
  }
  if (input.kind === 'accept' || input.kind === 'report') {
    const missing = ['BOM', 'SOP', 'SIP'].filter((kind) => !task.documents.some((document) => new RegExp(`^${kind}(?:-|$)`, 'i').test(document.code) && document.status === 'published' && document.version.trim()));
    if (missing.length) errors.documents = `${missing.join('、')} 尚未发布齐全，暂不能${input.kind === 'accept' ? '接收' : '报工'}`;
  }
  if (input.kind === 'accept') {
    if (task.acceptedAt) errors._form = '该派工已接收，无需重复确认';
    if (input.reviewed !== true) errors.reviewed = '请确认已核对派工与发布资料';
  } else if (input.kind === 'sign') {
    const issue = state.issues.find((item) => item.id === input.issueId && item.taskId === task.id);
    if (!issue) errors.issueId = '请选择本任务的领料单';
    else if (issue.signedAt) errors.issueId = '该领料单已签收，不能重复确认';
    if (input.reviewed !== true) errors.reviewed = '请确认已核对本张领料单的实收数量';
  } else if (input.kind === 'save-draft') {
    if (!input.draft || typeof input.draft !== 'object') errors.draft = '报工草稿格式无效';
    else for (const [field, max] of [['date', 32], ['actual', 32], ['good', 32], ['bad', 32], ['note', 1000]] as const) {
      if (typeof input.draft[field] !== 'string') errors[field] = '草稿字段须为文本';
      else if (input.draft[field].length > max) errors[field] = `草稿内容不能超过 ${max} 字`;
    }
  } else if (input.kind === 'report') {
    integral('actual', input.actual, '本次报工数量', true); integral('good', input.good, '良品数量', false); integral('bad', input.bad, '不良数量', false);
    if (!errors.actual && input.actual > getFieldProgress(state, task.id).unreported) errors.actual = `本次最多可报 ${getFieldProgress(state, task.id).unreported} ${task.unit}`;
    if (!errors.actual && !errors.good && !errors.bad && input.good + input.bad !== input.actual) errors.actual = '良品与不良数量之和须等于本次报工数量';
    if (!validDate(input.date)) errors.date = '请选择有效的实际报工日期';
    else if (input.date > today) errors.date = '实际报工日期不能晚于今天';
    else if (input.date < task.date) errors.date = '实际报工日期不能早于任务日期';
    else if (actor?.role !== 'supervisor' && input.date !== today) errors.date = '过去日期报工须由生产主管补录';
    requiredText('note', input.note, '报工说明', false);
  } else if (input.kind === 'defect') {
    const report = state.reports.find((item) => item.id === input.reportId && item.taskId === task.id);
    if (!report) errors.reportId = '请选择本任务的报工记录';
    integral('quantity', input.quantity, '本次登记不良数量', true);
    if (report && !errors.quantity && input.quantity > getReportUnregistered(state, report.id)) errors.quantity = `该报工仅剩 ${getReportUnregistered(state, report.id)} ${task.unit} 不良待登记`;
    if (!phenomena.includes(input.phenomenon)) errors.phenomenon = '请选择有效的不良现象';
    requiredText('description', input.description, '不良描述', input.phenomenon === '其他', 2000);
    if (input.issueId !== null && !state.issues.some((issue) => issue.id === input.issueId && issue.taskId === task.id && issue.signedAt)) errors.issueId = '来源须为本任务已签收领料单，也可选择来源待补齐';
    const error = photoError(input.photos); if (error) errors.photos = error;
  } else {
    const issue = state.issues.find((item) => item.id === input.issueId && item.taskId === task.id);
    if (!issue || !issue.signedAt) errors.issueId = '请选择本任务已签收的领料单';
    if (typeof input.quantity !== 'number' || !Number.isFinite(input.quantity) || input.quantity <= 0 || input.quantity > Number.MAX_SAFE_INTEGER / 1000 || Math.abs(input.quantity * 1000 - Math.round(input.quantity * 1000)) > 1e-7) errors.quantity = '退料数量须大于 0，且最多保留 3 位小数';
    else if (issue && issue.signedAt && input.quantity > getReturnable(state, issue.id)) errors.quantity = `本单最多还可申请 ${getReturnable(state, issue.id)} ${issue.unit}；请同时核实现场未使用余料`;
    if (input.reviewed !== true) errors.reviewed = '请确认申请数量为现场剩余未使用的物料';
    requiredText('reason', input.reason, '退料原因');
  }
  return errors;
}
export function applyFieldAction(state: FieldState, expectedVersion: number, input: FieldAction, now = new Date().toISOString()): FieldState {
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion !== state.version) fail('现场数据已变化，请重新核对后提交');
  const today = fieldToday(now); const errors = validateFieldAction(state, input, today); if (Object.keys(errors).length) fail(Object.values(errors)[0]);
  const at = new Date(now).toISOString(); const next = clone(state); next.version += 1; const task = taskFor(next, input.taskId);
  const ids = new Set([...next.tasks, ...next.issues, ...next.reports, ...next.defects, ...next.returns, ...next.events].map((entry) => entry.id));
  function id(prefix: string) { let result = `${prefix}-${next.version}`; let suffix = 1; while (ids.has(result)) result = `${prefix}-${next.version}-${suffix++}`; ids.add(result); return result; }
  let summary = '';
  if (input.kind === 'accept') { task.acceptedAt = at; task.acceptedBy = input.actorId; summary = '已接收派工并核对发布资料'; }
  else if (input.kind === 'sign') { const issue = issueFor(next, input.issueId); issue.signedAt = at; issue.signedBy = input.actorId; summary = `已签收 ${issue.code}，实收 ${issue.quantity} ${issue.unit}`; }
  else if (input.kind === 'save-draft') {
    next.drafts[`${input.actorId}:${task.id}`] = { date: input.draft.date, actual: input.draft.actual, good: input.draft.good, bad: input.draft.bad, note: input.draft.note }; summary = '已保存个人报工草稿，未计入报工数量';
  } else if (input.kind === 'report') {
    next.reports.push({ id: id('field-report'), code: `REPORT-${next.version}`, taskId: task.id, date: input.date, actual: input.actual, good: input.good, bad: input.bad, note: input.note.trim(), actorId: input.actorId, at });
    delete next.drafts[`${input.actorId}:${task.id}`]; summary = `已报工 ${input.actual} ${task.unit}：良品 ${input.good}、不良 ${input.bad}；现场良品不代替正式检验结论`;
  } else if (input.kind === 'defect') {
    const issue = input.issueId ? issueFor(next, input.issueId) : null;
    next.defects.push({ id: id('field-defect'), code: `DEFECT-${next.version}`, taskId: task.id, reportId: input.reportId, quantity: input.quantity, phenomenon: input.phenomenon, description: input.description.trim(), issueId: input.issueId, missingLot: !issue?.lotCode?.trim(), photos: clone(input.photos), actorId: input.actorId, at, status: 'pending' });
    summary = `已从原报工不良中登记 ${input.quantity} ${task.unit}，等待质量处理；未重复增加报工或不良总数`;
  } else {
    next.returns.push({ id: id('field-return'), code: `RETURN-${next.version}`, taskId: task.id, issueId: input.issueId, quantity: input.quantity, reason: input.reason.trim(), actorId: input.actorId, at, status: 'requested' });
    summary = '已提交现场余料退回申请，等待仓库处理；未改变已签收数量或报工记录';
  }
  next.events.push({ id: id('field-event'), taskId: task.id, actorId: input.actorId, at, kind: input.kind, summary });
  return next;
}

function documents(pendingSip = false): FieldTask['documents'] {
  return ['BOM', 'SOP', 'SIP'].map((kind) => ({ id: `field-${kind.toLowerCase()}`, code: `${kind}-CONTROL`, title: `${kind} 现场执行摘要`, version: kind === 'BOM' ? 'V3.3' : 'D', status: pendingSip && kind === 'SIP' ? 'pending' : 'published', summary: '独立演示的现场资料摘要，正式受控附件待接入。' }));
}
export function createFieldState(): FieldState {
  const active: FieldTask = { id: 'task-active', code: 'TASK-0911-001', dispatchCode: 'DISPATCH-0911-001', dispatchVersion: 1, batchId: 'batch-new', batchCode: 'B-FG-0910', product: '智能控制组件', component: '控制组件', process: '装配', unit: '件', date: '2026-09-11', lineId: 'line-a', lineName: '装配 A 线', ownerId: 'line-a-owner', planned: 60, acceptedAt: '2026-09-11T00:10:00.000Z', acceptedBy: 'line-a-owner', closed: false, documents: documents(), ecnId: 'ecn-01' };
  const pending: FieldTask = { ...clone(active), id: 'task-pending', code: 'TASK-0911-002', dispatchCode: 'DISPATCH-0911-PREVIEW', date: '2026-09-11', lineId: 'line-b', lineName: '装配 B 线', ownerId: 'line-b-owner', planned: 40, acceptedAt: undefined, acceptedBy: undefined };
  const closed: FieldTask = { ...clone(active), id: 'task-closed', code: 'TASK-0907-002', dispatchCode: 'DISPATCH-0907-002', batchId: 'batch-old', batchCode: 'B-FG-0902', component: '整机', process: '总装', unit: '台', date: '2026-09-07', planned: 116, acceptedAt: '2026-09-07T00:10:00.000Z', closed: true, ecnId: undefined };
  for (const document of closed.documents) { document.version = document.code.startsWith('BOM-') ? 'V3.2' : 'C'; document.code = document.code.replace('CONTROL', 'FINAL'); }
  const waiting: FieldTask = { ...clone(active), id: 'task-doc-pending', code: 'TASK-0913-004', dispatchCode: 'DISPATCH-0913-PREVIEW', date: '2026-09-13', planned: 20, acceptedAt: undefined, acceptedBy: undefined, documents: documents(true) };
  return {
    version: 1,
    actors: [{ id: 'line-a-owner', name: 'A 线线长', role: 'line', lineId: 'line-a' }, { id: 'line-b-owner', name: 'B 线线长', role: 'line', lineId: 'line-b' }, { id: 'supervisor-a', name: '生产主管', role: 'supervisor' }, { id: 'viewer-a', name: '查看岗位', role: 'viewer' }],
    tasks: [active, pending, closed, waiting],
    issues: [
      { id: 'issue-main-signed', code: 'ISS-0911-001', taskId: 'task-active', materialCode: 'MAT-PCB-100', materialName: '主控板', unit: '块', quantity: 40, lotCode: 'PCB-260910-D', issuedAt: '2026-09-11T00:20:00.000Z', signedAt: '2026-09-11T00:25:00.000Z', signedBy: 'line-a-owner' },
      { id: 'issue-shell-pending', code: 'ISS-0911-002', taskId: 'task-active', materialCode: 'MAT-SHELL-100', materialName: '壳体', unit: '套', quantity: 20, lotCode: null, issuedAt: '2026-09-11T01:00:00.000Z' },
      { id: 'issue-b-pending', code: 'ISS-0911-PREVIEW', taskId: 'task-pending', materialCode: 'MAT-PCB-100', materialName: '主控板', unit: '块', quantity: 40, lotCode: 'PCB-260910-D', issuedAt: '2026-09-11T02:00:00.000Z' },
    ],
    reports: [{ id: 'report-seed', code: 'REPORT-0911-001', taskId: 'task-active', date: '2026-09-11', actual: 40, good: 36, bad: 4, note: '现场累计报工 40 件；4 件不良等待登记与质量处理，非正式检验结论。', actorId: 'line-a-owner', at: '2026-09-11T03:00:00.000Z' }, { id: 'report-closed', code: 'REPORT-0907-002', taskId: 'task-closed', date: '2026-09-07', actual: 116, good: 116, bad: 0, note: '历史现场报工摘要。', actorId: 'line-a-owner', at: '2026-09-07T03:00:00.000Z' }],
    defects: [{ id: 'defect-seed', code: 'DEFECT-0911-001', taskId: 'task-active', reportId: 'report-seed', quantity: 2, phenomenon: '功能异常', description: '通信测试间歇断连，已关联原领料来源，等待质量处理。', issueId: 'issue-main-signed', missingLot: false, photos: [], actorId: 'line-a-owner', at: '2026-09-11T03:05:00.000Z', status: 'pending' }],
    returns: [], drafts: {},
    events: [{ id: 'field-event-accept-seed', taskId: 'task-active', actorId: 'line-a-owner', at: active.acceptedAt!, kind: 'accept', summary: '已接收演示派工并核对发布资料' }, { id: 'field-event-sign-seed', taskId: 'task-active', actorId: 'line-a-owner', at: '2026-09-11T00:25:00.000Z', kind: 'sign', summary: '已签收主控板 40 块，保留原批次码 PCB-260910-D' }, { id: 'field-event-report-seed', taskId: 'task-active', actorId: 'line-a-owner', at: '2026-09-11T03:00:00.000Z', kind: 'report', summary: '已报工 40 件，良品 36 件、不良 4 件' }, { id: 'field-event-defect-seed', taskId: 'task-active', actorId: 'line-a-owner', at: '2026-09-11T03:05:00.000Z', kind: 'defect', summary: '已登记原报工中的 2 件不良，其余 2 件待登记' }],
  };
}

export function buildFieldCsv(state: FieldState, taskId: string): string {
  const task = taskFor(state, taskId); const rows: unknown[][] = [['章节', '记录', '字段', '值']];
  const names: Record<string, string> = { id: '记录 ID', code: '编号', dispatchCode: '派工单', dispatchVersion: '派工版本', batchId: '批次 ID', batchCode: '批次号', product: '产品', component: '组件', process: '工序', unit: '单位', date: '业务日期', lineId: '产线 ID', lineName: '产线', ownerId: '负责人', planned: '计划数量', acceptedAt: '接收时间', acceptedBy: '接收岗位', closed: '是否结案', ecnId: '关联 ECN ID', taskId: '任务 ID', materialCode: '物料编码', materialName: '物料名称', quantity: '数量', lotCode: '原领料批次码', issuedAt: '领料时间', signedAt: '签收时间', signedBy: '签收岗位', actual: '现场报工数量', good: '现场良品数量', bad: '现场不良数量', note: '说明', actorId: '操作岗位', at: '记录时间', reportId: '报工来源 ID', phenomenon: '不良现象', description: '问题描述', issueId: '领料来源 ID', missingLot: '来料批次码待补齐', status: '状态', reason: '原因', kind: '操作类型', summary: '说明', title: '资料名称', version: '资料版本', name: '名称', role: '岗位', type: '图片类型', size: '文件字节数' };
  const add = (section: string, id: string, field: string, value: unknown) => rows.push([section, id, field, value === null || value === undefined || value === '' ? '待补齐 / 未填写' : typeof value === 'boolean' ? value ? '是' : '否' : value]);
  function object(section: string, id: string, value: object) { for (const [field, entry] of Object.entries(value)) add(section, id, names[field] ?? field, entry); }
  add('导出说明', task.code, '演示范围', '独立前端现场记录，不回写 P01 计划、不发送消息、不改仓库库存或整机完工。');
  add('导出说明', task.code, '数量口径', '现场良品不等于正式质量检验合格；不良登记从原报工不良池扣取，不重复增加数量。');
  add('导出说明', task.code, '照片范围', 'CSV 仅列照片名称、类型和大小，不包含图片文件；正式附件服务待接入。');
  const { documents, ...base } = task; object('现场任务', task.code, base); object('任务进度', task.code, getFieldProgress(state, taskId));
  for (const document of documents) object('资料摘要', document.code, document);
  for (const actor of state.actors) object('岗位', actor.id, actor);
  for (const issue of state.issues.filter((item) => item.taskId === taskId)) object('领料与签收', issue.code, issue);
  for (const report of state.reports.filter((item) => item.taskId === taskId)) object('现场报工', report.code, report);
  for (const defect of state.defects.filter((item) => item.taskId === taskId)) { const { photos, ...details } = defect; object('不良登记', defect.code, details); for (const photo of photos) { const { dataUrl: _dataUrl, ...metadata } = photo; object(`不良照片 / ${defect.code}`, photo.id, metadata); } }
  for (const request of state.returns.filter((item) => item.taskId === taskId)) object('退料申请', request.code, request);
  for (const [key, draft] of Object.entries(state.drafts)) if (key.endsWith(`:${taskId}`)) object('个人报工草稿（未计入报工）', key, draft);
  for (const event of state.events.filter((item) => item.taskId === taskId)) object('操作记录', event.id, event);
  const cell = (value: unknown) => { let content = String(value ?? ''); if (/^[\s\u0000-\u001f\u007f]*[=+\-@]/u.test(content) || /^[\t\r\n]/u.test(content)) content = `'${content}`; return `"${content.replaceAll('"', '""')}"`; };
  return `\uFEFF${rows.map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`;
}
