import type { DispositionChoice, EcnAction, EcnActor, EcnDocument, EcnImpact, EcnLegacyTarget, EcnRecord, EcnState } from './ecnTypes';

// Disposable front-end records: no notifications, stock transactions, order changes,
// production archive edits, or engineering-document publication are performed here.
const fail = (message: string): never => { throw new Error(message); };
const clone = <T,>(value: T): T => structuredClone(value);
const choices: Record<EcnLegacyTarget['kind'], DispositionChoice[]> = { inventory: ['retain', 'rework', 'return', 'scrap', 'hold'], wip: ['retain', 'rework', 'scrap', 'hold'], 'purchase-order': ['retain', 'revise-order', 'return', 'hold'] };
function text(value: unknown, label: string, required = true, max = 1000): string {
  if (typeof value !== 'string') return fail(`${label}格式无效`);
  const clean = value.trim();
  if (required && !clean) fail(`请填写${label}`);
  if (clean.length > max) fail(`${label}不能超过 ${max} 字`);
  return clean;
}
function recordFor(state: EcnState, id: string): EcnRecord { return state.records.find((record) => record.id === id) ?? fail('变更记录已不存在，请重新选择'); }
function actorFor(state: EcnState, id: string): EcnActor { return state.actors.find((actor) => actor.id === id) ?? fail('请选择有效的操作岗位'); }
function impactFor(record: EcnRecord, id: string): EcnImpact { return record.impacts.find((impact) => impact.id === id) ?? fail('请选择本变更的有效适用范围'); }
function time(now: string): { at: string; today: string } {
  const value = Date.parse(now);
  if (!Number.isFinite(value)) return fail('操作时间无效');
  return { at: new Date(value).toISOString(), today: new Date(value + 8 * 60 * 60 * 1000).toISOString().slice(0, 10) };
}
function dueDate(value: unknown, today: string): string {
  const clean = text(value, '要求完成日期', true, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) return fail('要求完成日期须为有效日期');
  const parsed = new Date(`${clean}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== clean) fail('要求完成日期须为有效日期');
  if (clean < today) fail('要求完成日期不能早于今天');
  return clean;
}
function acknowledgedActors(record: EcnRecord): string[] {
  return record.requiredActorIds.filter((actorId) => {
    const covered = new Set(record.acknowledgements.filter((ack) => ack.actorId === actorId).flatMap((ack) => ack.impactIds));
    return record.impacts.every((impact) => covered.has(impact.id));
  });
}
function latestDisposition(record: EcnRecord, targetId: string) { return record.dispositions.filter((item) => item.targetId === targetId).at(-1); }
export function isEcnImpactVerified(record: EcnRecord, impactId: string): boolean {
  const verification = record.verifications.filter((item) => item.impactId === impactId).at(-1);
  if (!verification || verification.result !== 'passed') return false;
  // A later execution problem invalidates prior validation. Closing the task documents its
  // handling but cannot establish a new quality result; quality must re-verify afterwards.
  const subsequentProblem = record.tasks.some((task) => task.impactId === impactId && Date.parse(task.at) > Date.parse(verification.at));
  if (subsequentProblem) return false;
  // Equal timestamps are ordered by the immutable operation log when actions occur rapidly.
  const verifyEvent = record.events.reduce((latest, event, index) => event.kind === 'verify' && event.after.includes(`"id":"${verification.id}"`) ? index : latest, -1);
  if (verifyEvent >= 0 && record.events.slice(verifyEvent + 1).some((event) => event.kind === 'feedback' && record.tasks.some((task) => task.impactId === impactId && event.after.includes(`"id":"${task.id}"`)))) return false;
  return true;
}

export function getEcnProgress(state: EcnState, recordId: string): { acknowledged: number; required: number; undecided: number; openTasks: number; verified: number; verificationRequired: number; stage: number } {
  const record = recordFor(state, recordId);
  const acknowledged = acknowledgedActors(record).length;
  const required = record.requiredActorIds.length;
  const undecided = record.impacts.filter((impact) => impact.applicability === 'pending').length + record.legacyTargets.filter((target) => !latestDisposition(record, target.id) || latestDisposition(record, target.id)?.choice === 'hold').length;
  const openTasks = record.tasks.filter((task) => task.status === 'open').length;
  const applicable = record.impacts.filter((impact) => impact.applicability === 'apply');
  const verified = applicable.filter((impact) => isEcnImpactVerified(record, impact.id)).length;
  const stage = record.status === 'draft' ? 0 : record.status === 'archived' ? 4 : acknowledged < required ? 1 : undecided || openTasks ? 2 : 3;
  return { acknowledged, required, undecided, openTasks, verified, verificationRequired: applicable.length, stage };
}

export function getArchiveBlockers(state: EcnState, recordId: string): string[] {
  const record = recordFor(state, recordId); const blockers: string[] = [];
  if (record.status === 'draft') blockers.push('变更尚未发布，不能执行或归档');
  if (record.status === 'archived') blockers.push('变更已归档，不能重复归档');
  const completed = new Set(acknowledgedActors(record));
  for (const actorId of record.requiredActorIds) if (!completed.has(actorId)) blockers.push(`${state.actors.find((actor) => actor.id === actorId)?.name ?? '待确认岗位'}尚未确认全部适用范围`);
  for (const impact of record.impacts) if (impact.applicability === 'pending') blockers.push(`${impact.batchNo}的适用范围尚待技术判定`);
  for (const target of record.legacyTargets) {
    const decision = latestDisposition(record, target.id);
    if (!decision || decision.choice === 'hold') blockers.push(`${target.label}尚无明确的旧版处置决定`);
  }
  for (const task of record.tasks) if (task.status !== 'resolved') blockers.push(`${task.code}协同待办尚未完成`);
  for (const impact of record.impacts.filter((item) => item.applicability === 'apply')) if (!isEcnImpactVerified(record, impact.id)) blockers.push(`${impact.batchNo}尚无有效的执行验证合格记录`);
  return blockers;
}

function cleanAction(state: EcnState, recordId: string, input: EcnAction, now: string): EcnAction {
  const record = recordFor(state, recordId);
  if (record.status !== 'published') fail(record.status === 'draft' ? '变更尚未发布，当前仅可查看' : '变更已归档，当前仅可查看');
  if (!input || typeof input !== 'object' || !['acknowledge', 'disposition', 'feedback', 'resolve-task', 'verify', 'archive'].includes(input.kind)) return fail('不支持的变更操作');
  const actorId = text(input.actorId, '操作岗位', true, 120);
  const actor = actorFor(state, actorId); const { today } = time(now);
  if (input.kind === 'acknowledge') {
    if (input.reviewed !== true) fail('请先确认已阅读变更对比与来源摘要');
    if (!Array.isArray(input.impactIds) || !input.impactIds.length) fail('请至少确认一个适用范围');
    const impactIds = input.impactIds.map((id) => text(id, '适用范围', true, 120));
    if (new Set(impactIds).size !== impactIds.length) fail('适用范围不能重复');
    for (const id of impactIds) impactFor(record, id);
    const known = new Set(record.acknowledgements.filter((ack) => ack.actorId === actorId).flatMap((ack) => ack.impactIds));
    if (impactIds.every((id) => known.has(id))) fail('这些适用范围已确认，无需重复确认');
    return { kind: input.kind, actorId, reviewed: true, impactIds, note: text(input.note, '岗位确认说明', false) };
  }
  if (input.kind === 'disposition') {
    if (!['engineering', 'quality'].includes(actor.team)) fail('旧版处置决定需要工艺 / 研发或质量岗位记录');
    const targetId = text(input.targetId, '旧版对象', true, 120);
    const target = record.legacyTargets.find((item) => item.id === targetId) ?? fail('请选择本变更的有效旧版对象');
    if (!choices[target.kind].includes(input.choice)) fail('该旧版对象不支持此处置方式');
    const reason = text(input.reason, '处置依据与原因');
    const previous = latestDisposition(record, targetId);
    if (previous?.choice === input.choice && previous.reason === reason) fail('处置决定没有变化');
    return { kind: input.kind, actorId, targetId, choice: input.choice, reason };
  }
  if (input.kind === 'feedback') {
    const impactId = text(input.impactId, '适用范围', true, 120); impactFor(record, impactId);
    const ownerId = text(input.ownerId, '责任岗位', true, 120); actorFor(state, ownerId);
    return { kind: input.kind, actorId, impactId, ownerId, dueDate: dueDate(input.dueDate, today), description: text(input.description, '执行问题', true, 2000) };
  }
  if (input.kind === 'resolve-task') {
    const taskId = text(input.taskId, '协同待办', true, 120);
    const task = record.tasks.find((item) => item.id === taskId) ?? fail('协同待办已不存在，请重新选择');
    if (task.status !== 'open') fail('该协同待办已完成，不能重复处理');
    if (actorId !== task.ownerId && !['engineering', 'quality'].includes(actor.team)) fail('仅责任岗位、工艺 / 研发或质量岗位可以更新处理结果');
    return { kind: input.kind, actorId, taskId, resolution: text(input.resolution, '处理结果') };
  }
  if (input.kind === 'verify') {
    if (actor.team !== 'quality') fail('执行验证需要质量岗位登记');
    const impactId = text(input.impactId, '验证范围', true, 120); const impact = impactFor(record, impactId);
    if (impact.applicability !== 'apply') fail('只有明确适用新版的批次可以登记执行验证');
    if (!['passed', 'failed'].includes(input.result)) fail('请选择有效的验证结果');
    const evidenceId = text(input.evidenceId, '验证凭据', true, 120);
    const evidence = record.documents.find((doc) => doc.id === evidenceId);
    if (!evidence || evidence.kind !== 'verification' || evidence.status !== 'published' || !evidence.impactIds.includes(impactId)) fail('验证凭据须为覆盖本批次的已发布验证记录');
    if (input.result === 'passed' && record.tasks.some((task) => task.impactId === impactId && task.status === 'open')) fail('本批次仍有未完成的协同待办，请处理后再登记验证合格');
    return { kind: input.kind, actorId, impactId, result: input.result, evidenceId, note: text(input.note, '验证说明') };
  }
  if (actor.team !== 'quality') fail('变更归档需要质量岗位确认');
  const reason = text(input.reason, '归档说明');
  const blockers = getArchiveBlockers(state, recordId);
  if (blockers.length) fail(`暂不能归档：${blockers.join('；')}`);
  return { kind: 'archive', actorId, reason };
}

export function validateEcnAction(state: EcnState, recordId: string, input: EcnAction, now = new Date().toISOString()): void { cleanAction(state, recordId, input, now); }

export function applyEcnAction(state: EcnState, recordId: string, expectedVersion: number, input: EcnAction, now = new Date().toISOString()): EcnState {
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion !== state.version) fail('变更数据已变化，请重新核对后提交');
  const action = cleanAction(state, recordId, input, now); const { at } = time(now);
  const next = clone(state); next.version += 1; const record = recordFor(next, recordId);
  const usedIds = new Set(next.records.flatMap((item) => [...item.acknowledgements, ...item.dispositions, ...item.tasks, ...item.verifications, ...item.events].map((entry) => entry.id)));
  function id(prefix: string) { let value = `${prefix}-${next.version}`; let suffix = 1; while (usedIds.has(value)) value = `${prefix}-${next.version}-${suffix++}`; usedIds.add(value); return value; }
  let before = ''; let after = ''; let summary = '';
  if (action.kind === 'acknowledge') {
    const acknowledgement = { id: id('ecn-ack'), actorId: action.actorId, impactIds: [...action.impactIds], note: action.note, at };
    before = JSON.stringify(record.acknowledgements.filter((ack) => ack.actorId === action.actorId));
    record.acknowledgements.push(acknowledgement); after = JSON.stringify(acknowledgement); summary = `已阅读并确认 ${action.impactIds.length} 个适用范围；不代表执行验证合格`;
  } else if (action.kind === 'disposition') {
    before = JSON.stringify(latestDisposition(record, action.targetId) ?? null);
    const decision = { id: id('ecn-disposition'), targetId: action.targetId, choice: action.choice, reason: action.reason, actorId: action.actorId, at };
    record.dispositions.push(decision); after = JSON.stringify(decision); summary = '已记录旧版处置决定；未改动实际库存、在制品或采购订单';
  } else if (action.kind === 'feedback') {
    const task = { id: id('ecn-task'), code: `ECN-TASK-${next.version}`, impactId: action.impactId, ownerId: action.ownerId, dueDate: action.dueDate, description: action.description, actorId: action.actorId, at, status: 'open' as const };
    record.tasks.push(task); after = JSON.stringify(task); summary = '已建立本地协同待办，等待责任岗位处理';
  } else if (action.kind === 'resolve-task') {
    const task = record.tasks.find((item) => item.id === action.taskId)!;
    before = JSON.stringify(task); task.status = 'resolved'; task.resolution = action.resolution; task.resolvedBy = action.actorId; task.resolvedAt = at;
    after = JSON.stringify(task); summary = '已保留执行问题并记录处理结果；仍须按要求完成质量验证';
  } else if (action.kind === 'verify') {
    before = JSON.stringify(record.verifications.filter((item) => item.impactId === action.impactId).at(-1) ?? null);
    const verification = { id: id('ecn-verification'), impactId: action.impactId, result: action.result, evidenceId: action.evidenceId, note: action.note, actorId: action.actorId, at };
    record.verifications.push(verification); after = JSON.stringify(verification); summary = action.result === 'passed' ? '已登记执行验证合格；不改变生产批次的历史实装版本' : '已登记执行验证不合格，保留结果并等待后续处理';
  } else {
    before = JSON.stringify({ status: record.status }); record.status = 'archived'; record.archivedAt = at; record.archivedBy = action.actorId;
    after = JSON.stringify({ status: record.status, archivedAt: at, archivedBy: action.actorId, reason: action.reason }); summary = `变更已归档：${action.reason}`;
  }
  record.events.push({ id: id('ecn-event'), kind: action.kind, actorId: action.actorId, at, summary, before, after });
  return next;
}

function doc(id: string, kind: EcnDocument['kind'], revision: string, title: string, impactIds: string[], status: EcnDocument['status'] = 'published'): EcnDocument {
  return { id, code: id.toUpperCase(), title, revision, status, kind, summary: status === 'published' ? '独立演示的已发布资料摘要；正式原图及受控文件附件尚未接入。' : '独立演示的未发布资料草稿，尚不可作为生产执行或验证依据。', facts: [{ label: '资料范围', value: '版本与适用范围摘要' }, { label: '原图 / 正式附件', value: '待接入，摘要不能代替正式作业文件' }], impactIds: [...impactIds] };
}

export function createEcnState(): EcnState {
  const actors: EcnActor[] = [
    { id: 'line-a', name: '装配 A 线负责人', role: '生产线确认岗', team: 'production' },
    { id: 'line-b', name: '装配 B 线负责人', role: '生产线确认岗', team: 'production' },
    { id: 'quality-a', name: '质量工程师', role: '验证与归档岗', team: 'quality' },
    { id: 'process-a', name: '工艺工程师', role: '旧版处置判定岗', team: 'engineering' },
    { id: 'buyer-a', name: '采购负责人', role: '采购协同岗', team: 'purchase' },
  ];
  const impacts: EcnImpact[] = [
    { id: 'impact-new', batchNo: 'B-FG-0910', planNo: 'PP-202609-010', product: '智能控制组件', quantity: 120, unit: '台', range: '新投产批次全部 120 台；按发布的新版执行', applicability: 'apply', decision: '新批次使用 V1.2.0 / HW-D，须完成执行验证。' },
    { id: 'impact-old', batchNo: 'B-FG-0902', planNo: 'PP-202609-002', product: '智能控制组件', quantity: 116, unit: '台', range: '已生产批次 116 台，保留原随批版本依据', applicability: 'retain', decision: '保留本批历史实装事实，不由本 ECN 自动回写 P09 档案。' },
  ];
  const documents: EcnDocument[] = [
    doc('drawing-before', 'drawing', 'HW-C', '旧版硬件图纸摘要', ['impact-old']), doc('drawing-after', 'drawing', 'HW-D', '新版硬件图纸摘要', ['impact-new']),
    doc('bom-before', 'bom', 'BOM-V3.2', '旧版 BOM 摘要', ['impact-old']), doc('bom-after', 'bom', 'BOM-V3.3', '新版 BOM 摘要', ['impact-new']),
    doc('sop-before', 'sop', 'SOP-C', '旧版装配与烧录要求', ['impact-old']), doc('sop-after', 'sop', 'SOP-D', '新版装配与烧录要求', ['impact-new']),
    doc('sip-before', 'sip', 'SIP-C', '旧版通信检验要求', ['impact-old']), doc('sip-after', 'sip', 'SIP-D', '新版通信检验要求', ['impact-new']),
    { ...doc('verification-new', 'verification', 'VER-0910-01', 'B-FG-0910 试产执行验证记录', ['impact-new']), summary: '已发布的演示验证凭据：覆盖 B-FG-0910 新版烧录、端口防呆与通信稳定性检查。需由质量岗位登记本次核验结论。', facts: [{ label: '验证批次', value: 'B-FG-0910' }, { label: '验证范围', value: '新版执行要求核验' }, { label: '验证记录', value: '演示摘要；原始附件待接入' }] },
    doc('verification-draft', 'verification', 'VER-0910-DRAFT', '尚未发布的补充验证草稿', ['impact-new'], 'draft'),
  ];
  documents.find((item) => item.id === 'sop-before')!.facts.push({ label: '烧录版本', value: 'V1.1.0' });
  documents.find((item) => item.id === 'sop-after')!.facts.push({ label: '烧录版本', value: 'V1.2.0' });
  const current: EcnRecord = {
    id: 'ecn-01', code: 'ECN-202609-003', title: '智能控制组件通信稳定性及端口防呆变更', status: 'published', publisher: '研发负责人（演示）', publishedAt: '2026-09-09T01:00:00.000Z', materialCode: 'IN-100', materialName: '智能控制组件', process: '装配 / 烧录 / 通信检验', effectiveRule: '仅对明确列入适用范围的新投产批次生效，旧批次保留历史版本依据', summary: '软件 V1.1.0 升级至 V1.2.0，硬件 HW-C 升级至 HW-D；同步核对 BOM、作业与检验要求。',
    documents, differences: [
      { id: 'diff-software', subject: '软件烧录', before: 'V1.1.0：原通信重试策略', after: 'V1.2.0：更新通信重试与诊断记录', reason: '改善间歇断连问题的诊断与恢复', beforeDocumentId: 'sop-before', afterDocumentId: 'sop-after' },
      { id: 'diff-hardware', subject: '硬件与端口', before: 'HW-C：原端口标识与装配方向', after: 'HW-D：调整端口防呆及标识', reason: '降低装配方向错误风险', beforeDocumentId: 'drawing-before', afterDocumentId: 'drawing-after' },
      { id: 'diff-bom', subject: 'BOM', before: 'BOM-V3.2：旧版控制板与标签', after: 'BOM-V3.3：新版控制板与防呆标签', reason: '与 HW-D 装配要求保持一致', beforeDocumentId: 'bom-before', afterDocumentId: 'bom-after' },
      { id: 'diff-sop', subject: '作业要求', before: 'SOP-C：原装配 / 烧录步骤', after: 'SOP-D：增加防呆检查与烧录复核', reason: '确保新版要求在产线落地', beforeDocumentId: 'sop-before', afterDocumentId: 'sop-after' },
      { id: 'diff-sip', subject: '检验要求', before: 'SIP-C：原通信抽检项目', after: 'SIP-D：增加诊断与端口检查', reason: '覆盖本次软件与硬件变化', beforeDocumentId: 'sip-before', afterDocumentId: 'sip-after' },
    ], impacts,
    legacyTargets: [
      { id: 'legacy-stock', kind: 'inventory', code: 'LOT-PCB-0901', label: '旧版控制板库存', quantity: 80, unit: '块', oldVersion: 'HW-C / BOM-V3.2' },
      { id: 'legacy-wip', kind: 'wip', code: 'B-FG-0902', label: '旧批次剩余未出货品（已放行 20 台、待放行 16 台）', quantity: 36, unit: '台', oldVersion: '按原随批实装依据；已出货 80 台不在本对象中', impactId: 'impact-old' },
      { id: 'legacy-order', kind: 'purchase-order', code: 'PO-202609-026', label: '旧版控制板未交订单', quantity: 200, unit: '块', oldVersion: 'HW-C' },
    ], requiredActorIds: ['line-a', 'line-b', 'quality-a'],
    acknowledgements: [{ id: 'ack-quality-seed', actorId: 'quality-a', impactIds: ['impact-new', 'impact-old'], note: '已阅读变更摘要与新旧批次适用范围；执行验证待完成。', at: '2026-09-09T03:00:00.000Z' }],
    dispositions: [
      { id: 'disp-wip-seed', targetId: 'legacy-wip', choice: 'retain', reason: '旧批次按随批历史版本保留，未经证实不改写为最新版。', actorId: 'process-a', at: '2026-09-09T03:30:00.000Z' },
      { id: 'disp-order-seed', targetId: 'legacy-order', choice: 'hold', reason: '等待供应商确认可切换版本及交付影响，暂缓判定。', actorId: 'process-a', at: '2026-09-09T03:35:00.000Z' },
    ], tasks: [{ id: 'task-seed', code: 'ECN-TASK-001', impactId: 'impact-new', ownerId: 'process-a', dueDate: '2026-09-15', description: '核对装配 B 线防呆检查点，并补充班前交底结果。', actorId: 'line-b', at: '2026-09-10T01:00:00.000Z', status: 'open' }], verifications: [], events: [],
  };
  const draft: EcnRecord = { ...clone(current), id: 'ecn-02', code: 'ECN-202609-004', title: '工业通信组件散热结构调整（草稿）', status: 'draft', publishedAt: null, materialCode: 'IN-200', materialName: '工业通信组件', summary: '设计评审中的变更草稿，尚不可执行。', effectiveRule: '待评审、待发布；尚未生效，适用批次和生效条件均待确认', documents: current.documents.map((item) => ({ ...clone(item), status: 'draft', summary: '独立演示的未发布资料草稿，尚不可作为生产执行或验证依据。', impactIds: ['impact-draft'] })), impacts: [{ id: 'impact-draft', batchNo: '待确定新批次', planNo: '待发布', product: '工业通信组件', quantity: 50, unit: '台', range: '适用批次与生效范围待评审', applicability: 'pending', decision: '未发布前不得作为生产执行依据' }], differences: [], legacyTargets: [], acknowledgements: [], dispositions: [], tasks: [], verifications: [], events: [] };
  const archived: EcnRecord = { ...clone(current), id: 'ecn-03', code: 'ECN-202608-011', title: '控制组件标签识别要求调整（已归档）', status: 'archived', publishedAt: '2026-08-20T01:00:00.000Z', summary: '历史变更示例，岗位确认、旧版处置与执行验证已留档。', impacts: [{ id: 'impact-history', batchNo: 'B-FG-0825', planNo: 'PP-202608-012', product: '智能控制组件', quantity: 80, unit: '台', range: '历史批次 80 台', applicability: 'apply', decision: '已完成执行验证与归档' }], documents: [{ ...doc('verification-history', 'verification', 'VER-0825-01', '历史标签验证摘要', ['impact-history']), summary: '历史演示验证合格凭据摘要。' }], differences: [{ id: 'diff-history', subject: '标签识别', before: '旧版标签布局', after: '增加批次识别区', reason: '便于随批核对', beforeDocumentId: 'label-before-history', afterDocumentId: 'label-after-history' }], legacyTargets: [], acknowledgements: ['line-a', 'line-b', 'quality-a'].map((actorId) => ({ id: `ack-history-${actorId}`, actorId, impactIds: ['impact-history'], note: '已确认历史适用范围', at: '2026-08-21T01:00:00.000Z' })), dispositions: [], tasks: [], verifications: [{ id: 'verification-history-seed', impactId: 'impact-history', result: 'passed', evidenceId: 'verification-history', note: '标签识别核验合格', actorId: 'quality-a', at: '2026-08-25T01:00:00.000Z' }], events: [], archivedAt: '2026-08-26T01:00:00.000Z', archivedBy: 'quality-a' };
  archived.documents.push(doc('label-before-history', 'drawing', 'LABEL-A', '历史旧版标签摘要', ['impact-history']), doc('label-after-history', 'drawing', 'LABEL-B', '历史新版标签摘要', ['impact-history']));
  archived.events.push({ id: 'archive-history-seed', kind: 'archive', actorId: 'quality-a', at: archived.archivedAt!, summary: '历史变更验证合格后归档', before: JSON.stringify({ status: 'published' }), after: JSON.stringify({ status: 'archived', reason: '历史验证及确认记录齐全' }) });
  return { version: 1, actors, records: [current, draft, archived] };
}

export function buildEcnCsv(state: EcnState, recordId: string): string {
  const record = recordFor(state, recordId); const rows: unknown[][] = [['章节', '记录', '字段', '值']];
  const add = (section: string, id: string, label: string, value: unknown) => rows.push([section, id, label, value === undefined || value === null || value === '' ? '—' : value]);
  add('导出说明', record.code, '数据边界', '独立前端演示；不会发送消息、发布受控文件或改写库存、采购订单、生产批次档案。');
  add('导出说明', record.code, '资料边界', '图纸、BOM、SOP、SIP 与验证凭据仅为来源摘要，正式原图 / 附件待接入。');
  const labels: Record<string, string> = { id: '记录 ID', code: '编号', title: '标题', status: '状态', publisher: '发布人', publishedAt: '发布时间', materialCode: '物料编码', materialName: '物料名称', process: '相关工序', effectiveRule: '生效规则', summary: '摘要', archivedAt: '归档时间', archivedBy: '归档岗位', actorId: '操作岗位', impactId: '适用范围 ID', impactIds: '适用范围 ID', ownerId: '责任岗位', dueDate: '要求完成日期', description: '问题描述', at: '记录时间', resolution: '处理结果', resolvedBy: '处理岗位', resolvedAt: '处理时间', choice: '处置决定', reason: '依据与原因', targetId: '旧版对象 ID', result: '验证结果', evidenceId: '验证凭据 ID', note: '说明', subject: '变更项目', before: '变更前 / 操作前', after: '变更后 / 操作后', beforeDocumentId: '旧版来源 ID', afterDocumentId: '新版来源 ID', batchNo: '批次', planNo: '生产计划', product: '产品', quantity: '数量', unit: '单位', range: '适用范围', applicability: '适用判定', decision: '判定说明', kind: '类型', label: '名称', oldVersion: '旧版依据', revision: '资料版本', name: '名称', role: '岗位', team: '团队' };
  function object(section: string, item: object, id: string) {
    for (const [field, value] of Object.entries(item)) {
      if (field === 'facts' && Array.isArray(value)) { for (const fact of value) add(`${section}明细`, id, fact.label, fact.value); }
      else add(section, id, labels[field] ?? field, Array.isArray(value) ? value.join('\n') : value);
    }
  }
  const { documents, differences, impacts, legacyTargets, requiredActorIds, acknowledgements, dispositions, tasks, verifications, events, ...base } = record;
  object('变更基本资料', base, record.code);
  add('必需确认岗位', record.code, '岗位 ID', requiredActorIds.join('\n'));
  for (const actor of state.actors) object('岗位目录', actor, actor.id);
  for (const [section, entries] of [['来源摘要', documents], ['变更对比', differences], ['适用范围', impacts], ['旧版对象', legacyTargets], ['岗位确认', acknowledgements], ['旧版处置历史', dispositions], ['协同待办', tasks], ['执行验证历史', verifications], ['操作记录', events]] as const) for (const entry of entries) object(section, entry, entry.id);
  for (const blocker of getArchiveBlockers(state, recordId)) add('归档核对', record.code, '待满足条件', blocker);
  const cell = (value: unknown) => { let valueText = String(value ?? ''); if (/^[\s\u0000-\u001f\u007f]*[=+\-@]/u.test(valueText) || /^[\t\r\n]/u.test(valueText)) valueText = `'${valueText}`; return `"${valueText.replaceAll('"', '""')}"`; };
  return `\uFEFF${rows.map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`;
}
