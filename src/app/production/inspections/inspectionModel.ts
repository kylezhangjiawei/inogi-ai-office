import type { InspectionAction, InspectionActionKind, InspectionPhoto, InspectionProgress, InspectionRecord, InspectionState, InspectionTask } from './inspectionTypes';

// Independent inspection examples. First-pass results remain immutable; reinspection,
// nonconformance transfer, quality authorization, and actual shipment are separate facts.
const clone = <T,>(value: T): T => structuredClone(value);
const fail = (message: string): never => { throw new Error(message); };
const taskFor = (state: InspectionState, id: string) => state.tasks.find((item) => item.id === id) ?? fail('检验任务已不存在');
const recordFor = (state: InspectionState, id: string) => state.records.find((item) => item.id === id) ?? fail('检验记录已不存在');
const issueFor = (state: InspectionState, id: string) => state.issues.find((item) => item.id === id) ?? fail('不良处理记录已不存在');
const phenomena = ['装配干涉', '功能异常', '尺寸偏差', '外观划伤', '其他'];
function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01') return false;
  const parsed = new Date(`${value}T00:00:00.000Z`); return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
export function inspectionToday(now = new Date().toISOString()): string {
  const at = Date.parse(now); if (!Number.isFinite(at)) return fail('操作时间无效'); return new Date(at + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
export function canOperateInspection(state: InspectionState, actorId: string, taskId: string, kind?: InspectionActionKind): boolean {
  const task = state.tasks.find((item) => item.id === taskId); const actor = state.actors.find((item) => item.id === actorId);
  if (!task || task.closed || !actor || actor.role === 'viewer') return false;
  if (kind === undefined) return actor.role === 'qc' || (actor.role === 'qa' && task.stage === 'final');
  return kind === 'release' ? actor.role === 'qa' && task.stage === 'final' : actor.role === 'qc' && ['accept', 'inspect', 'reinspect', 'transfer'].includes(kind);
}
export function getReinspectable(state: InspectionState, issueId: string): number {
  const issue = issueFor(state, issueId);
  if (!issue.dispositionCode?.trim() || !issue.disposedAt || !Number.isFinite(Date.parse(issue.disposedAt)) || !Number.isSafeInteger(issue.readyQuantity) || issue.readyQuantity <= 0 || issue.readyQuantity > issue.quantity) return 0;
  return Math.max(0, issue.readyQuantity - state.records.filter((item) => item.kind === 'reinspection' && item.issueId === issueId && item.taskId === issue.taskId).reduce((sum, item) => sum + item.quantity, 0));
}
export function getTransferable(state: InspectionState, recordId: string): number {
  const record = recordFor(state, recordId); return state.issues.some((issue) => issue.recordId === recordId) ? 0 : record.bad;
}
export function getInspectionProgress(state: InspectionState, taskId: string): InspectionProgress {
  const task = taskFor(state, taskId); const records = state.records.filter((item) => item.taskId === taskId);
  const initial = records.filter((item) => item.kind === 'initial'); const retests = records.filter((item) => item.kind === 'reinspection');
  const sum = (items: InspectionRecord[], field: 'quantity' | 'good' | 'bad') => items.reduce((total, item) => total + item[field], 0);
  const inspected = sum(initial, 'quantity'); const firstGood = sum(initial, 'good'); const firstBad = sum(initial, 'bad');
  const retestGood = sum(retests, 'good'); const qualified = firstGood + retestGood;
  const unresolved = Math.max(0, firstBad - retestGood); const uninspected = Math.max(0, task.quantity - inspected);
  const released = state.releases.filter((item) => item.taskId === taskId).reduce((total, item) => total + item.quantity, 0);
  return { initial: inspected, firstGood, firstBad, firstPassRate: inspected > 0 ? firstGood / inspected * 100 : null, uninspected, retested: sum(retests, 'quantity'), retestGood, retestBad: sum(retests, 'bad'), unresolved, qualified, released, releasable: !task.closed && task.stage === 'final' && task.acceptedAt && uninspected === 0 && unresolved === 0 ? Math.max(0, qualified - released) : 0 };
}
function photoError(value: unknown): string | null {
  if (!Array.isArray(value)) return '照片列表格式无效'; if (value.length > 3) return '最多可附 3 张照片'; const ids = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return '照片信息不完整'; const photo = entry as InspectionPhoto;
    if (typeof photo.id !== 'string' || !photo.id.trim() || photo.id.length > 128 || ids.has(photo.id)) return '照片标识无效或重复'; ids.add(photo.id);
    if (typeof photo.name !== 'string' || !photo.name.trim() || photo.name.length > 180) return '照片文件名无效或过长';
    if (!['image/png', 'image/jpeg'].includes(photo.type)) return '照片仅支持 PNG 或 JPEG';
    if (!Number.isSafeInteger(photo.size) || photo.size <= 0 || photo.size > 10 * 1024 * 1024) return '每张照片须大于 0 且不超过 10 MB';
    if (typeof photo.dataUrl !== 'string' || !photo.dataUrl.startsWith(`data:${photo.type};base64,`)) return '照片内容与文件类型不匹配';
    const data = photo.dataUrl.slice(photo.dataUrl.indexOf(',') + 1);
    if (!data || data.length > Math.ceil(10 * 1024 * 1024 / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) return '照片内容不是有效的 Base64 图片数据';
    if (data.length * 3 / 4 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0) !== photo.size) return '照片大小与实际内容不一致，请重新选择';
  }
  return null;
}
function currentSip(task: InspectionTask) { return task.documents.find((document) => /^SIP(?:-|$)/i.test(document.code) && document.status === 'published' && document.version.trim()); }

export function validateInspectionAction(state: InspectionState, action: InspectionAction, today = inspectionToday()): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!action || typeof action !== 'object' || !['accept', 'inspect', 'reinspect', 'transfer', 'release'].includes(action.kind)) return { _form: '不支持的检验操作' };
  if (!validDate(today)) return { _form: '当前业务日期无效，请刷新后重试' };
  const task = state.tasks.find((item) => item.id === action.taskId); if (!task) return { taskId: '请选择有效检验任务' };
  if (task.closed) return { _form: '已结案检验任务仅可查看' };
  if (!canOperateInspection(state, action.actorId, task.id, action.kind)) errors.actorId = action.kind === 'release' ? '仅 QA 授权岗位可对终检任务记录质量放行' : '仅 QC 检验岗位可进行此操作';
  if (action.kind !== 'accept' && !task.acceptedAt) errors._form = '请先接受报检任务';
  const requiredText = (field: string, value: unknown, label: string, required = true, max = 1000) => {
    if (typeof value !== 'string') errors[field] = `${label}格式无效`;
    else if (required && !value.trim()) errors[field] = `请填写${label}`;
    else if (value.trim().length > max) errors[field] = `${label}不能超过 ${max} 字`;
  };
  const integral = (field: string, value: unknown, label: string, positive: boolean) => {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || (positive && value === 0)) errors[field] = `${label}须为${positive ? '大于 0 的' : '非负'}整数`;
  };
  if (['accept', 'inspect', 'reinspect'].includes(action.kind) && !currentSip(task)) errors.documents = 'SIP 检验依据尚未发布齐全，暂不能执行';
  if (action.reviewed !== true) errors.reviewed = action.kind === 'release' ? '请确认已核对放行条件与授权依据' : action.kind === 'transfer' ? '请确认按本条检验记录全部不良转入处理' : '请确认已核对报检范围与本次 SIP 检验要求';
  if (action.kind === 'accept') {
    if (task.acceptedAt) errors._form = '该报检任务已接受，无需重复确认';
  } else if (action.kind === 'inspect' || action.kind === 'reinspect') {
    integral('quantity', action.quantity, '本次检验数量', true); integral('good', action.good, '合格数量', false); integral('bad', action.bad, '不良数量', false);
    if (!errors.quantity && !errors.good && !errors.bad && action.good + action.bad !== action.quantity) errors.quantity = '合格与不良数量之和须等于本次检验数量';
    if (!validDate(action.date)) errors.date = '请选择有效检验日期';
    else if (action.date > today) errors.date = '检验日期不能晚于今天';
    else if (action.date < task.date) errors.date = '检验日期不能早于报检任务日期';
    requiredText('note', action.note, '检验备注', false); requiredText('evidence', action.evidence, '检验记录或读数说明', true, 2000);
    const photo = photoError(action.photos); if (photo) errors.photos = photo;
    if (action.kind === 'inspect') {
      if (!errors.quantity && action.quantity > getInspectionProgress(state, task.id).uninspected) errors.quantity = `本任务仅剩 ${getInspectionProgress(state, task.id).uninspected} ${task.unit} 尚未初检`;
    } else {
      const issue = state.issues.find((item) => item.id === action.issueId && item.taskId === task.id);
      if (!issue) errors.issueId = '请选择本任务的已转不良记录';
      else {
        const source = state.records.find((item) => item.id === issue.recordId && item.taskId === task.id);
        const original = source?.kind === 'initial' ? source : state.records.find((item) => item.id === source?.originalId && item.kind === 'initial' && item.taskId === task.id);
        if (!source || !original) errors.issueId = '原始初检来源不完整，请先核对';
        if (!issue.dispositionCode?.trim() || !issue.disposedAt || !Number.isFinite(Date.parse(issue.disposedAt)) || issue.readyQuantity <= 0 || !Number.isSafeInteger(issue.readyQuantity) || issue.readyQuantity > issue.quantity) errors.issueId = '尚无有效处置凭据或可复验数量，请先完成不良处理';
        else if (validDate(action.date) && inspectionToday(issue.disposedAt) > action.date) errors.date = '复验日期不能早于本次处置完成日期';
        if (!errors.quantity && action.quantity > getReinspectable(state, issue.id)) errors.quantity = `本条处置记录仅剩 ${getReinspectable(state, issue.id)} ${task.unit} 可复验`;
      }
    }
  } else if (action.kind === 'transfer') {
    const record = state.records.find((item) => item.id === action.recordId && item.taskId === task.id);
    if (!record) errors.recordId = '请选择本任务的检验记录';
    else if (getTransferable(state, record.id) <= 0) errors.recordId = record.bad <= 0 ? '该检验记录无不良需要转处理' : '本条检验不良已转处理，不能重复登记';
    if (!phenomena.includes(action.phenomenon)) errors.phenomenon = '请选择有效的不良现象';
    requiredText('description', action.description, '不良说明', action.phenomenon === '其他', 2000);
  } else {
    const progress = getInspectionProgress(state, task.id);
    if (task.stage !== 'final') errors._form = '过程检验不能直接作为终检 QA 放行';
    else if (progress.uninspected > 0) errors._form = '全部初检完成后才能记录 QA 放行';
    else if (progress.unresolved > 0) errors._form = '仍有未解决不良，不能记录 QA 放行';
    integral('quantity', action.quantity, '本次放行数量', true);
    if (!errors.quantity && action.quantity > progress.releasable) errors.quantity = `本任务最多还可放行 ${progress.releasable} ${task.unit}`;
    requiredText('basis', action.basis, '质量授权依据'); requiredText('note', action.note, '放行备注', false);
  }
  return errors;
}

export function applyInspectionAction(state: InspectionState, expectedVersion: number, action: InspectionAction, now = new Date().toISOString()): InspectionState {
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion !== state.version) fail('检验数据已变化，请重新核对后提交');
  const today = inspectionToday(now); const errors = validateInspectionAction(state, action, today); if (Object.keys(errors).length) fail(Object.values(errors)[0]);
  const at = new Date(now).toISOString(); const next = clone(state); next.version += 1; const task = taskFor(next, action.taskId);
  const ids = new Set([...next.tasks, ...next.records, ...next.issues, ...next.releases, ...next.events].map((item) => item.id));
  function id(prefix: string) { let value = `${prefix}-${next.version}`; let suffix = 1; while (ids.has(value)) value = `${prefix}-${next.version}-${suffix++}`; ids.add(value); return value; }
  let summary = '';
  if (action.kind === 'accept') { task.acceptedAt = at; task.acceptedBy = action.actorId; summary = '已接受报检并核对发布的 SIP，尚未产生检验结果'; }
  else if (action.kind === 'inspect' || action.kind === 'reinspect') {
    const sip = currentSip(task)!;
    const record: InspectionRecord = { id: id('inspection-record'), code: `${action.kind === 'inspect' ? 'QC' : 'RETEST'}-${next.version}`, taskId: task.id, kind: action.kind === 'inspect' ? 'initial' : 'reinspection', date: action.date, quantity: action.quantity, good: action.good, bad: action.bad, conclusion: action.bad === 0 ? 'qualified' : 'unqualified', sipCode: sip.code, sipVersion: sip.version, actorId: action.actorId, at, note: action.note.trim(), evidence: action.evidence.trim(), photos: clone(action.photos) };
    if (action.kind === 'reinspect') {
      const issue = issueFor(next, action.issueId); const source = recordFor(next, issue.recordId);
      record.issueId = issue.id; record.originalId = source.kind === 'initial' ? source.id : source.originalId;
    }
    next.records.push(record); summary = action.kind === 'inspect' ? `已登记初检 ${action.quantity} ${task.unit}：合格 ${action.good}、不良 ${action.bad}` : `已登记复验 ${action.quantity} ${task.unit}：合格 ${action.good}、不良 ${action.bad}；首次检验结果保持不变`;
  } else if (action.kind === 'transfer') {
    const record = recordFor(next, action.recordId);
    next.issues.push({ id: id('inspection-issue'), code: `NCR-${next.version}`, taskId: task.id, recordId: record.id, quantity: record.bad, phenomenon: action.phenomenon, description: action.description.trim(), actorId: action.actorId, at, readyQuantity: 0 });
    summary = `本条检验全部 ${record.bad} ${task.unit} 不良已转待处理；未重复计入检验不良数量，处置完成后才能复验`;
  } else {
    next.releases.push({ id: id('inspection-release'), code: `QA-REL-${next.version}`, taskId: task.id, quantity: action.quantity, basis: action.basis.trim(), note: action.note.trim(), actorId: action.actorId, at });
    summary = `已记录独立 QA 授权放行 ${action.quantity} ${task.unit}；未生成实际出货或改变检验原始结果`;
  }
  next.events.push({ id: id('inspection-event'), taskId: task.id, actorId: action.actorId, at, kind: action.kind, summary });
  return next;
}

function sip(pending = false): InspectionTask['documents'] { return [{ id: 'sip-inspection', code: 'SIP-IN100-INSPECT', title: '检验范围与判定要求摘要', version: 'V1.0', status: pending ? 'pending' : 'published', summary: '独立演示的 SIP 摘要；正式检验附件、原始读数文件后续接入。' }]; }
function task(id: string, code: string, quantity: number, stage: InspectionTask['stage'], options: Partial<InspectionTask> = {}): InspectionTask {
  return { id, code, batchCode: 'B-FG-0910', product: '智能控制组件', process: stage === 'final' ? '整机终检' : '阀组件过程检验', stage, unit: stage === 'final' ? '台' : '件', reportCode: `REPORT-${code}`, quantity, date: '2026-09-11', acceptedAt: '2026-09-11T00:10:00.000Z', acceptedBy: 'qc-a', closed: false, documents: sip(), ...options };
}
function initial(id: string, code: string, taskId: string, quantity: number, good: number, bad: number, options: Partial<InspectionRecord> = {}): InspectionRecord {
  return { id, code, taskId, kind: 'initial', date: '2026-09-11', quantity, good, bad, conclusion: bad === 0 ? 'qualified' : 'unqualified', sipCode: 'SIP-IN100-INSPECT', sipVersion: 'V1.0', actorId: 'qc-a', at: '2026-09-11T01:00:00.000Z', note: '独立演示的检验记录，首次结果保留。', evidence: '按 SIP 核对功能、外观及关键尺寸，原始读数摘要已登记。', photos: [], ...options };
}
export function createInspectionState(): InspectionState {
  const tasks = [
    task('task-final', 'IQT-0911-001', 50, 'final'),
    task('task-pending', 'IQT-0911-002', 20, 'process', { acceptedAt: undefined, acceptedBy: undefined }),
    task('task-process', 'IQT-0911-003', 160, 'process', { batchCode: 'B-FG-0909', product: '工业阀组件' }),
    task('task-release', 'IQT-0911-004', 10, 'final', { batchCode: 'B-FG-0911' }),
    task('task-doc-pending', 'IQT-0911-005', 20, 'process', { acceptedAt: undefined, acceptedBy: undefined, documents: sip(true) }),
    task('task-closed', 'IQT-0907-002', 116, 'final', { batchCode: 'B-FG-0902', reportCode: 'RPT-0907-02', date: '2026-09-07', acceptedAt: '2026-09-07T00:00:00.000Z', closed: true, archiveId: 'batch-02', documents: [{ id: 'sip-history', code: 'SIP-FINAL', title: '历史整机检验要求摘要', version: 'C', status: 'published', summary: '独立历史 SIP-C 摘要，与原批次版本依据一致；正式历史原件尚未接入，不套用当前新版 SIP。' }] }),
  ];
  return {
    version: 1, actors: [{ id: 'qc-a', name: 'QC 检验员', role: 'qc' }, { id: 'qa-a', name: 'QA 质量授权人', role: 'qa' }, { id: 'viewer-a', name: '生产查看岗', role: 'viewer' }], tasks,
    records: [
      initial('record-initial', 'QC-0911-001', 'task-final', 50, 47, 3, { evidence: '整机 50 台按 SIP 检验；47 台合格，3 台功能测试异常。' }),
      initial('record-process', 'QC-0911-003', 'task-process', 160, 154, 6, { evidence: '阀组件 160 件过程检验，154 件合格，6 件装配干涉待转不良处理。' }),
      initial('record-release', 'QC-0911-004', 'task-release', 10, 10, 0, { evidence: '独立终检任务 10 台全部检验合格，尚未记录 QA 授权放行。' }),
      initial('record-history-initial', 'FQC-0907-02', 'task-closed', 116, 110, 6, { date: '2026-09-07', at: '2026-09-07T01:00:00.000Z', sipCode: 'SIP-FINAL', sipVersion: 'C', note: '与 P09 编号对齐的独立历史快照；不自动同步档案。', evidence: '历史首次检验 116 台、合格 110 台、不良 6 台；按当时 SIP-C 摘要记录，原件未接入。' }),
      initial('record-history-retest', 'RETEST-0907-02', 'task-closed', 6, 6, 0, { kind: 'reinspection', date: '2026-09-07', at: '2026-09-07T06:00:00.000Z', sipCode: 'SIP-FINAL', sipVersion: 'C', originalId: 'record-history-initial', issueId: 'issue-history', evidence: '按历史 SIP-C 复验 6 台合格，累计合格 116 台，不回写首次检验结果；正式历史原件未接入。' }),
    ],
    issues: [
      { id: 'issue-ready', code: 'NCR-0911-001', taskId: 'task-final', recordId: 'record-initial', quantity: 3, phenomenon: '功能异常', description: '3 台功能异常，其中 2 台完成返工待复验，其余 1 台尚未完成处置。', actorId: 'qc-a', at: '2026-09-11T01:05:00.000Z', readyQuantity: 2, dispositionCode: 'DISP-0911-001', dispositionNote: '2 台已完成返工，允许送复验；另 1 台仍待处理。', disposedAt: '2026-09-11T02:00:00.000Z' },
      { id: 'issue-history', code: 'NCR-0907-02', taskId: 'task-closed', recordId: 'record-history-initial', quantity: 6, phenomenon: '功能异常', description: '历史通信测试异常，返工后全数送复验。', actorId: 'qc-a', at: '2026-09-07T02:00:00.000Z', readyQuantity: 6, dispositionCode: 'DISP-0907-02', dispositionNote: '返工 6 台完成。', disposedAt: '2026-09-07T05:00:00.000Z' },
    ],
    releases: [{ id: 'release-history', code: 'QA-REL-0907-02', taskId: 'task-closed', quantity: 100, basis: '历史 QA 授权凭据：累计检验合格 116 台，其中 100 台获授权放行。', note: '独立历史快照；其余 16 台等待授权，不表示已出货。', actorId: 'qa-a', at: '2026-09-07T07:00:00.000Z' }],
    events: [{ id: 'inspection-event-initial-seed', taskId: 'task-final', actorId: 'qc-a', at: '2026-09-11T01:00:00.000Z', kind: 'inspect', summary: '已登记首次终检 50 台，合格 47 台、不良 3 台' }, { id: 'inspection-event-transfer-seed', taskId: 'task-final', actorId: 'qc-a', at: '2026-09-11T01:05:00.000Z', kind: 'transfer', summary: '3 台不良已转 NCR-0911-001；其中 2 台有处置凭据可复验，其余 1 台等待处置' }],
  };
}

export function buildInspectionCsv(state: InspectionState, taskId: string): string {
  const selected = taskFor(state, taskId); const rows: unknown[][] = [['章节', '记录', '字段', '值']];
  const names: Record<string, string> = { id: '记录 ID', code: '编号', taskId: '任务 ID', batchCode: '生产批次', product: '产品', process: '检验工序', stage: '检验阶段', unit: '单位', reportCode: '报检来源', quantity: '数量', date: '检验日期', acceptedAt: '接受时间', acceptedBy: '接受岗位', closed: '是否结案', archiveId: '关联档案 ID', kind: '记录类型', good: '合格数量', bad: '不良数量', conclusion: '本次结论', sipCode: '本次 SIP 编号', sipVersion: '本次 SIP 版本', actorId: '操作岗位', at: '记录时间', note: '备注', evidence: '检验记录或读数说明', originalId: '最初检验来源 ID', issueId: '本轮不良来源 ID', recordId: '检验来源 ID', phenomenon: '不良现象', description: '不良说明', readyQuantity: '已完成处置可送复验数量', dispositionCode: '处置凭据', dispositionNote: '处置说明', disposedAt: '处置完成时间', basis: 'QA 授权依据', summary: '说明', title: '资料标题', version: '资料版本', status: '资料状态', name: '名称', role: '岗位', type: '图片类型', size: '文件字节数', initial: '首次已检数量', firstGood: '首次合格数量', firstBad: '首次不良数量', firstPassRate: '首次合格率', uninspected: '尚未初检数量', retested: '累计复验检验次数量', retestGood: '复验合格数量', retestBad: '历次复验不良次数量', unresolved: '未解决不良数量', qualified: '累计合格数量', released: '已授权放行数量', releasable: '本任务可授权放行数量' };
  const add = (section: string, id: string, field: string, value: unknown) => rows.push([section, id, field, value === null || value === undefined || value === '' ? '—' : typeof value === 'boolean' ? value ? '是' : '否' : value]);
  function object(section: string, id: string, value: object) { for (const [field, entry] of Object.entries(value)) add(section, id, names[field] ?? field, entry); }
  add('导出说明', selected.code, '演示边界', '独立前端检验记录，不修改现场报工、正式生产档案、库存或实际出货。');
  add('导出说明', selected.code, '数量口径', '首次合格率仅取初检；复验合格追加至累计合格；不良转处理不重复计量；QA 授权与实际出货分别记录。');
  add('导出说明', selected.code, '资料与照片', 'SIP 为摘要，正式附件待接入；照片仅导出名称、类型和大小，不包含图片文件。');
  const { documents, ...base } = selected; object('检验任务', selected.code, base); object('检验进度', selected.code, getInspectionProgress(state, taskId));
  for (const actor of state.actors) object('岗位', actor.id, actor); for (const document of documents) object('SIP 摘要', document.code, document);
  for (const record of state.records.filter((item) => item.taskId === taskId)) { const { photos, ...recordBase } = record; object('检验记录', record.code, recordBase); for (const photo of photos) { const { dataUrl: _dataUrl, ...metadata } = photo; object(`检验照片 / ${record.code}`, photo.id, metadata); } }
  for (const issue of state.issues.filter((item) => item.taskId === taskId)) { object('不良与处置', issue.code, issue); add('不良与处置', issue.code, '剩余可复验数量', getReinspectable(state, issue.id)); }
  for (const release of state.releases.filter((item) => item.taskId === taskId)) object('独立 QA 放行', release.code, release);
  for (const event of state.events.filter((item) => item.taskId === taskId)) object('操作记录', event.id, event);
  const cell = (value: unknown) => { let content = String(value ?? ''); if (/^[\s\u0000-\u001f\u007f]*[=+\-@]/u.test(content) || /^[\t\r\n]/u.test(content)) content = `'${content}`; return `"${content.replaceAll('"', '""')}"`; };
  return `\uFEFF${rows.map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`;
}
