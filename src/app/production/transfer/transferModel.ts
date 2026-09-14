import type { DocumentKind, TransferAction, TransferRecord, TransferRole, TransferState } from './transferTypes';

const names: Record<DocumentKind, string> = { drawing: '图纸', bom: 'BOM', sop: 'SOP', sip: 'SIP', ecn: 'ECN', software: '软件版本', hardware: '硬件版本' };
const roles: Record<TransferRole, string> = { process: '工艺', quality: '质量', lead: '生产负责人', viewer: '只读查看' };
export function createTransferState(): TransferState {
  const make = (id: string, product: string, type: TransferRecord['type'], kinds: DocumentKind[], min: number, video: boolean): TransferRecord => ({
    id, code: `TP-090${id.slice(-1)}`, batch: `B-TP-090${id.slice(-1)}`, sample: `SP-090${id.slice(-1)}`, product, type, date: '2026-09-15', status: 'preparing', samplePassed: true, sampleConclusion: '样品评审通过，进入试装验证；本页为独立演示摘要。', basisVersion: 1,
    requiredKinds: kinds, requiredRoles: ['process', 'quality', 'lead'], minTrialQuantity: min, requireVideo: video,
    documents: kinds.map((kind) => ({ id: `${id}-${kind}`, kind, code: `${product.split(' ')[0]}-${kind.toUpperCase()}`, revision: kind === 'software' ? 'V2.3.1' : 'V1.2', status: id === 'transfer-1' && kind === 'ecn' ? 'pending' : 'published', summary: `${names[kind]}适用于当前试产批次。演示摘要，原文件尚未接入。` })),
    trials: [], problems: [], confirmations: [], events: [],
  });
  const device = make('transfer-1', 'Q7 智能控制器', 'device', ['drawing','bom','sop','sip','ecn','software','hardware'], 3, false);
  device.trials.push({ id: 'trial-seed', date: '2026-09-10', quantity: 3, passed: false, result: '阀组件配合尺寸偏差，上电提示异常，需整改后复验。', evidence: [], actorId: 'process-a', basisVersion: 1 });
  device.problems.push({ id: 'problem-seed', title: '阀组件配合尺寸偏差，影响试装', status: 'open' });
  const part = make('transfer-2', 'FG 阀体组件', 'part', ['drawing','bom','sop','sip'], 5, false);
  part.trials.push({ id: 'trial-part', date: '2026-09-11', quantity: 5, passed: true, result: '按 V1.2 尺寸与扭矩要求完成 5 件试装，全部符合。', evidence: [], actorId: 'process-a', basisVersion: 1 });
  part.confirmations = part.requiredRoles.map((role) => ({ role, actorId: `${role}-a`, note: '已核对当前演示资料和试装结果。', basisVersion: 1 }));
  return { version: 1, actors: [{id:'process-a', name:'陈工', role:'process'}, {id:'quality-a', name:'林质检', role:'quality'}, {id:'lead-a', name:'周主管', role:'lead'}, {id:'viewer-a', name:'访客', role:'viewer'}], records: [device, part, make('transfer-3', 'M2 电动执行器', 'actuator', ['drawing','bom','sop','sip','hardware'], 2, true)] };
}
export function getTransferGates(record: TransferRecord) {
  const docs = record.requiredKinds.filter((kind) => !record.documents.some((doc) => doc.kind === kind && doc.status === 'published' && doc.revision.trim()));
  const trial = record.trials.filter((item) => item.basisVersion === record.basisVersion).at(-1);
  const trialPassed = Boolean(trial?.passed && trial.quantity >= record.minTrialQuantity && (!record.requireVideo || trial.evidence.some((item) => item.type === 'video')));
  const problems = record.problems.filter((item) => item.status !== 'closed' || item.basisVersion !== record.basisVersion);
  const confirmations = record.requiredRoles.filter((role) => !record.confirmations.some((item) => item.role === role && item.basisVersion === record.basisVersion));
  return { docs, trialPassed, problems, confirmations, blockers: [
    ...(!record.samplePassed ? ['样品结论尚未通过'] : []), ...docs.map((kind) => `${names[kind]}未发布或版本未齐`),
    ...(!trialPassed ? [`当前资料版本须完成至少 ${record.minTrialQuantity} 件试装且通过${record.requireVideo ? '，并附验证视频' : ''}`] : []),
    ...problems.map((item) => `问题尚未完成当前版本复验：${item.title}`), ...confirmations.map((role) => `${roles[role]}尚未确认当前版本`),
  ] };
}
export function canOperateTransfer(state: TransferState, actorId: string, recordId: string, kind: TransferAction['kind']) {
  const actor = state.actors.find((item) => item.id === actorId), record = state.records.find((item) => item.id === recordId);
  if (!actor || !record || record.status !== 'preparing') return false;
  return ({ document: ['process'], trial: ['process'], remedy: ['process'], verify: ['quality'], confirm: record.requiredRoles, submit: ['lead'] } as Record<TransferAction['kind'], string[]>)[kind]?.includes(actor.role) ?? false;
}
const requiredText = (value: unknown, label: string, max = 1200) => { if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${label}不能为空且不得超过 ${max} 字。`); };
export function applyTransferAction(state: TransferState, expectedVersion: number, input: TransferAction, now = new Date().toISOString()): TransferState {
  if (expectedVersion !== state.version) throw new Error('记录已变化，请重新打开当前操作。');
  const current = state.records.find((item) => item.id === input.recordId), actor = state.actors.find((item) => item.id === input.actorId);
  if (!current || !actor || !canOperateTransfer(state, input.actorId, input.recordId, input.kind)) throw new Error('当前岗位或记录状态不允许此操作。');
  const next: TransferState = structuredClone(state), record = next.records.find((item) => item.id === input.recordId)!;
  let label = '', detail = '';
  const eventId = `event-${state.version + 1}`;
  if (input.kind === 'document') {
    const doc = record.documents.find((item) => item.id === input.documentId); if (!doc) throw new Error('资料不属于当前批次。');
    requiredText(input.revision, '资料版本', 80); requiredText(input.summary, '版本与适用说明');
    if (input.published !== true) throw new Error('须确认已核对发布状态与适用范围。');
    if (doc.status === 'published' && doc.revision === input.revision.trim() && doc.summary === input.summary.trim()) throw new Error('资料内容没有变化。');
    detail = `${names[doc.kind]}：${doc.revision} → ${input.revision.trim()}；${input.summary.trim()}`;
    doc.revision = input.revision.trim(); doc.summary = input.summary.trim(); doc.status = 'published'; record.basisVersion += 1;
    label = '补充资料';
  } else if (input.kind === 'trial') {
    if (getTransferGates(record).docs.length) throw new Error('请先补齐并发布必需资料，再保存试装验证。');
    if (typeof input.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !Number.isFinite(Date.parse(input.date)) || new Date(input.date).toISOString().slice(0,10) !== input.date) throw new Error('请填写有效试装日期。');
    if (!Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > 10000) throw new Error('试装数量须为 1 至 10000 的整数。');
    if (typeof input.passed !== 'boolean') throw new Error('请选择试装结果。');
    requiredText(input.result, '验证方法与结果');
    if (!Array.isArray(input.evidence) || input.evidence.length > 4 || new Set(input.evidence.map((item) => item.id)).size !== input.evidence.length) throw new Error('最多添加 4 份不同证据。');
    for (const item of input.evidence) {
      requiredText(item.id, '证据编号', 150); requiredText(item.name, '证据名称', 200);
      if (!['photo','video'].includes(item.type) || typeof item.dataUrl !== 'string' || !new RegExp(item.type === 'photo' ? '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$' : '^data:video/mp4;base64,[A-Za-z0-9+/]+=*$').test(item.dataUrl) || item.dataUrl.length > 8_000_000) throw new Error('证据仅支持有效的本地 PNG、JPG、WebP 图片或 MP4 视频。');
    }
    record.trials.push({ id: `trial-${state.version + 1}`, date: input.date, quantity: input.quantity, passed: input.passed, result: input.result.trim(), evidence: structuredClone(input.evidence), actorId: actor.id, basisVersion: record.basisVersion });
    if (!input.passed) record.problems.push({ id: `problem-${state.version + 1}`, title: input.result.trim(), status: 'open' });
    record.confirmations = []; label = '保存试装记录'; detail = `${input.quantity} 件 · ${input.passed ? '通过' : '未通过，已生成问题'} · ${input.result.trim()}`;
  } else if (input.kind === 'remedy' || input.kind === 'verify') {
    const problem = record.problems.find((item) => item.id === input.problemId); if (!problem) throw new Error('问题不属于当前批次。');
    requiredText(input.note, input.kind === 'remedy' ? '整改说明' : '复验依据与结论');
    if (input.kind === 'remedy') {
      if (problem.status === 'closed' && problem.basisVersion === record.basisVersion) throw new Error('问题已通过当前版本复验。');
      problem.remedy = input.note.trim(); problem.status = 'verification'; problem.basisVersion = undefined;
      label = '登记整改';
    } else {
      if (problem.status !== 'verification' && !(problem.status === 'closed' && problem.basisVersion !== record.basisVersion)) throw new Error('请先完成整改，再记录问题复验。');
      if (typeof input.passed !== 'boolean') throw new Error('请选择复验结果。');
      if (getTransferGates(record).docs.length) throw new Error('请先补齐当前版本资料，再记录问题复验。');
      problem.verification = input.note.trim(); problem.verifiedBy = actor.id; problem.status = input.passed ? 'closed' : 'open'; problem.basisVersion = input.passed ? record.basisVersion : undefined;
      label = input.passed ? '问题复验通过' : '问题复验未通过';
    }
    record.confirmations = []; detail = `${problem.id} · ${input.note.trim()}`;
  } else if (input.kind === 'confirm') {
    if (input.reviewed !== true) throw new Error('请先核对资料、试装与问题复验。');
    requiredText(input.note, '岗位确认意见');
    const gates = getTransferGates(record);
    if (gates.docs.length || !gates.trialPassed || gates.problems.length || !record.samplePassed) throw new Error('资料、试装和问题复验尚未完成，不能确认。');
    if (record.confirmations.some((item) => item.role === actor.role && item.basisVersion === record.basisVersion)) throw new Error('当前岗位已确认本版资料。');
    record.confirmations.push({ role: actor.role, actorId: actor.id, note: input.note.trim(), basisVersion: record.basisVersion });
    label = `${roles[actor.role]}确认`; detail = input.note.trim();
  } else if (input.kind === 'submit') {
    if (input.reviewed !== true) throw new Error('请勾选转产条件核对。'); requiredText(input.note, '转产确认说明');
    const gates = getTransferGates(record); if (gates.blockers.length) throw new Error(`暂不能转产：${gates.blockers.join('；')}`);
    record.status = 'confirmed'; record.confirmedAt = now; record.confirmedBy = actor.id; label = '提交转产确认'; detail = input.note.trim();
  }
  record.events.push({ id: eventId, at: now, actorId: actor.id, label, detail }); next.version += 1; return next;
}
export function buildTransferCsv(state: TransferState, id: string) {
  const record = state.records.find((item) => item.id === id); if (!record) throw new Error('未找到转产记录。');
  const safe = (value: unknown) => { const text = String(value ?? ''); return `"${(/^[\s\uFEFF]*[=+@-]/.test(text) ? `'${text}` : text).replaceAll('"','""')}"`; };
  const rows: unknown[][] = [['转产确认记录（独立演示）','编号','版本 / 日期','状态','说明'], ['批次',record.batch,record.date,record.status,record.sample], ...record.documents.map((doc) => [names[doc.kind],doc.code,doc.revision,doc.status,doc.summary]), ...record.trials.map((trial) => ['试装',trial.id,trial.date,trial.passed ? '通过':'未通过',`${trial.quantity} 件 · 资料快照 ${trial.basisVersion} · ${trial.result} · 证据 ${trial.evidence.map((item) => item.name).join('、')}`]), ...record.problems.map((problem) => ['问题',problem.id,'',problem.status,`${problem.title}；整改：${problem.remedy ?? '未记录'}；复验：${problem.verification ?? '未记录'}`]), ...record.confirmations.map((item) => ['岗位确认',roles[item.role],`资料快照 ${item.basisVersion}`,item.actorId,item.note]), ...record.events.map((event) => ['历史',event.id,event.at,event.label,event.detail])];
  return '\uFEFF' + rows.map((row) => row.map(safe).join(',')).join('\r\n') + '\r\n';
}
