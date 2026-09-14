import type {
  QualityActionInput, QualityActionKind, QualityCreateInput, QualityIssue,
  QualityPreviewState, QualityRecord, QualitySource, QualityStatus,
} from './qualityExceptionTypes';

// Provisional interaction rules for the isolated review page, not production approvals.
const sourceNames: Record<QualitySource, string> = { incoming: '来料', warehouse: '仓库', production: '生产反馈', after_sales: '售后' };
const actionNames: Record<QualityActionKind, string> = { assign: '分派经办', cause: '确认原因', disposition: '登记处置', submit_verification: '提交复检', verify: '登记复检', close: '确认关闭', feedback: '关联反馈' };
const actionByStatus: Record<QualityStatus, QualityActionKind[]> = {
  unassigned: ['assign', 'feedback'],
  processing: ['assign', 'cause', 'disposition', 'submit_verification', 'feedback'],
  awaiting_verification: ['verify', 'feedback'], awaiting_close: ['close', 'feedback'], closed: [],
};
const milli = (value: number) => Math.round(value * 1000);

function text(value: string, label: string, max = 2000, optional = false): string {
  if (typeof value !== 'string') throw new Error(`请填写${label}。`);
  const result = value.trim();
  if (!optional && !result) throw new Error(`请填写${label}。`);
  if (result.length > max) throw new Error(`${label}不能超过 ${max} 个字符。`);
  return result;
}
function quantity(value: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || !Number.isSafeInteger(milli(value)) || Number(value.toFixed(3)) !== value) {
    throw new Error(`${label}必须大于 0，且最多保留三位小数。`);
  }
  return value;
}
function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}
function time(nowIso: string): { iso: string; today: string } {
  const value = Date.parse(nowIso);
  if (!Number.isFinite(value)) throw new Error('当前演示时间无效，请重试。');
  return { iso: new Date(value).toISOString(), today: new Date(value + 8 * 60 * 60 * 1000).toISOString().slice(0, 10) };
}
function validSource(source: QualitySource): void {
  if (!Object.hasOwn(sourceNames, source)) throw new Error('请选择有效的异常来源。');
}
function detail(label: string, value: string): { label: string; value: string } { return { label, value }; }

export function allowedQualityActions(issue: QualityIssue): QualityActionKind[] {
  return [...(actionByStatus[issue.status] ?? [])];
}

/** Missing prerequisites for another verification round; failed rounds need fresh disposition evidence. */
export function qualityVerificationBlockers(issue: QualityIssue): string[] {
  const blockers: string[] = [];
  if (!issue.owner || !issue.verifier || !validDate(issue.dueDate)) blockers.push('请先分派经办人、复检人并填写处理期限。');
  if (!issue.causeCategory || !issue.causeDetail || !issue.responsibility || !issue.causeEvidence) blockers.push('请先完成人工原因确认、责任认定及依据。');
  if (!issue.dispositionMethod || !issue.dispositionDetail || !issue.dispositionEvidence) blockers.push('请先登记处置方式、说明及依据。');
  if (milli(issue.handledQty) !== milli(issue.defectiveQty)) blockers.push(`处置数量尚未覆盖全部不良量 ${issue.defectiveQty} ${issue.unit}。`);
  if (issue.verificationResult === 'failed') blockers.push('上轮复检未通过，请先重新登记处置及依据，再提交复检。');
  return blockers;
}

export function qualityCloseBlockers(issue: QualityIssue): string[] {
  const blockers = qualityVerificationBlockers(issue).filter((item) => !item.startsWith('上轮复检'));
  if (issue.verificationRound < 1 || issue.verificationResult !== 'passed' || milli(issue.verificationQty) !== milli(issue.defectiveQty)) blockers.push('尚未完成全量复检并通过。');
  if (!issue.verificationNote || !issue.verificationEvidence) blockers.push('请补齐复检结论说明及验证依据。');
  return blockers;
}

export function createQualityIssue(
  state: QualityPreviewState, input: QualityCreateInput, nowIso = new Date().toISOString(),
): QualityPreviewState {
  const now = time(nowIso);
  validSource(input.source);
  if (!validDate(input.discoveredDate)) throw new Error('请填写有效的发现日期。');
  if (input.discoveredDate > now.today) throw new Error('发现日期不能晚于北京今天。');
  const materialCode = text(input.materialCode, '物料编码', 120);
  const batchNo = text(input.batchNo, '批次号', 120);
  const existing = state.issues.find((issue) => issue.materialCode.toLocaleLowerCase() === materialCode.toLocaleLowerCase() && issue.batchNo.toLocaleLowerCase() === batchNo.toLocaleLowerCase());
  if (existing?.status === 'closed') throw new Error(`物料与批次已存在已关闭异常 ${existing.code}，请先查看原记录；演示暂不支持重开或重复统计不良量。`);
  if (existing) throw new Error(`物料与批次已存在异常 ${existing.code}，请使用关联反馈，避免重复统计不良量。`);
  const inspectedQty = quantity(input.inspectedQty, '检验数量');
  const defectiveQty = quantity(input.defectiveQty, '不良数量');
  if (milli(defectiveQty) > milli(inspectedQty)) throw new Error('不良数量不能超过检验数量。');
  const nextNumber = Math.max(0, ...state.issues.map((issue) => Number(/^DEMO-NC-(\d+)$/.exec(issue.code)?.[1] ?? 0))) + 1;
  const issue: QualityIssue = {
    id: `demo-quality-${crypto.randomUUID()}`, version: 0, code: `DEMO-NC-${String(nextNumber).padStart(3, '0')}`, status: 'unassigned',
    source: input.source, discoveredDate: input.discoveredDate, materialCode,
    materialName: text(input.materialName, '物料名称', 120), category: text(input.category, '物料类别', 120),
    spec: text(input.spec, '规格', 120, true), unit: text(input.unit, '单位', 20), supplierName: text(input.supplierName, '供应商', 120),
    batchNo, orderNo: text(input.orderNo, '关联订单', 120, true), receiptId: '', inspectedQty, defectiveQty,
    phenomenon: text(input.phenomenon, '异常现象'), evidence: text(input.evidence, '证据说明'),
    owner: '', verifier: '', dueDate: '', causeCategory: '', causeDetail: '', responsibility: '', causeEvidence: '',
    dispositionMethod: '', handledQty: 0, dispositionDetail: '', dispositionEvidence: '', verificationRound: 0,
    verificationQty: 0, verificationResult: 'pending', verificationNote: '', verificationEvidence: '', closeNote: '', linkedFeedback: [],
  };
  const record: QualityRecord = {
    id: crypto.randomUUID(), issueId: issue.id, kind: 'create', createdAt: now.iso, actor: '演示操作员', summary: '登记演示质量异常',
    details: [detail('来源', sourceNames[issue.source]), detail('批次', issue.batchNo), detail('检验 / 不良', `${inspectedQty} / ${defectiveQty} ${issue.unit}`), detail('现象', issue.phenomenon), detail('证据说明', issue.evidence)],
    beforeStatus: 'unassigned', afterStatus: 'unassigned',
  };
  return { issues: [issue, ...state.issues], records: [record, ...state.records] };
}

export function applyQualityAction(
  state: QualityPreviewState, id: string, expectedVersion: number, input: QualityActionInput, nowIso = new Date().toISOString(),
): QualityPreviewState {
  const issue = state.issues.find((item) => item.id === id);
  if (!issue) throw new Error('未找到演示质量异常，请重新选择。');
  if (issue.version !== expectedVersion) throw new Error('演示数据版本已变化，请重新打开并核对后保存。');
  if (!allowedQualityActions(issue).includes(input.kind)) throw new Error('当前异常状态不支持此操作，请重新选择。');
  const now = time(nowIso);
  if (now.today < issue.discoveredDate) throw new Error('处理时间不能早于发现日期。');
  const updated: QualityIssue = { ...issue, version: issue.version + 1 };
  let summary = `${actionNames[input.kind]}（演示）`;
  let details: QualityRecord['details'] = [];
  switch (input.kind) {
    case 'assign': {
      updated.owner = text(input.owner, '经办人', 120);
      updated.verifier = text(input.verifier, '复检人', 120);
      if (!validDate(input.dueDate)) throw new Error('请填写有效的处理期限。');
      if (input.dueDate < issue.discoveredDate) throw new Error('处理期限不能早于发现日期。');
      updated.dueDate = input.dueDate;
      updated.status = 'processing';
      details = [detail('经办人', updated.owner), detail('复检人', updated.verifier), detail('处理期限', updated.dueDate), detail('分派说明', text(input.note, '分派说明'))];
      break;
    }
    case 'cause': {
      if (!['process', 'packaging', 'standard', 'revision', 'other'].includes(input.category)) throw new Error('请选择有效的主因类别。');
      updated.causeCategory = input.category;
      updated.causeDetail = text(input.detail, '主因说明');
      updated.responsibility = text(input.responsibility, '责任认定');
      updated.causeEvidence = text(input.evidence, '原因确认依据');
      const causeNames = { process: '工艺', packaging: '包装', standard: '检验标准', revision: '版本', other: '其他' };
      details = [detail('主因类别', causeNames[input.category]), detail('主因说明', updated.causeDetail), detail('责任认定', updated.responsibility), detail('确认依据', updated.causeEvidence)];
      break;
    }
    case 'disposition': {
      if (!['repair', 'replacement', 'return', 'sorting'].includes(input.method)) throw new Error('请选择有效的处置方式。');
      const handledQty = quantity(input.handledQty, '累计处置数量');
      if (milli(handledQty) > milli(issue.defectiveQty)) throw new Error(`累计处置数量不能超过不良量 ${issue.defectiveQty} ${issue.unit}。`);
      if (milli(handledQty) < milli(issue.handledQty)) throw new Error(`累计处置数量不能低于已登记的 ${issue.handledQty} ${issue.unit}。`);
      updated.dispositionMethod = input.method; updated.handledQty = handledQty;
      updated.dispositionDetail = text(input.detail, '处置说明'); updated.dispositionEvidence = text(input.evidence, '处置依据');
      updated.verificationResult = 'pending'; updated.verificationQty = 0; updated.verificationNote = ''; updated.verificationEvidence = '';
      const methodNames = { repair: '返工 / 维修', replacement: '换货 / 补货', return: '退货', sorting: '筛选处理' };
      details = [detail('处置方式', methodNames[input.method]), detail('累计处置', `${issue.handledQty} → ${handledQty} ${issue.unit}`), detail('处置说明', updated.dispositionDetail), detail('处置依据', updated.dispositionEvidence)];
      break;
    }
    case 'submit_verification': {
      const blockers = qualityVerificationBlockers(issue);
      if (blockers.length) throw new Error(blockers.join(' '));
      const note = text(input.note, '提交说明');
      updated.status = 'awaiting_verification'; updated.verificationRound += 1;
      updated.verificationQty = 0; updated.verificationResult = 'pending'; updated.verificationNote = ''; updated.verificationEvidence = '';
      summary = `提交第 ${updated.verificationRound} 轮演示复检`;
      details = [detail('提交说明', note), detail('复检人', issue.verifier), detail('待复检数量', `${issue.defectiveQty} ${issue.unit}`)];
      break;
    }
    case 'verify': {
      const verifiedQty = quantity(input.quantity, '复检数量');
      if (milli(verifiedQty) > milli(issue.defectiveQty)) throw new Error(`复检数量不能超过不良量 ${issue.defectiveQty} ${issue.unit}。`);
      if (!['passed', 'failed'].includes(input.result)) throw new Error('请选择有效的复检结果。');
      if (input.result === 'passed' && milli(verifiedQty) !== milli(issue.defectiveQty)) throw new Error('通过复检必须覆盖全部不良数量。');
      updated.verificationQty = verifiedQty; updated.verificationResult = input.result;
      updated.verificationNote = text(input.note, '复检结论说明'); updated.verificationEvidence = text(input.evidence, '验证依据');
      updated.status = input.result === 'passed' ? 'awaiting_close' : 'processing';
      summary = `第 ${issue.verificationRound} 轮演示复检${input.result === 'passed' ? '通过' : '未通过'}`;
      details = [detail('复检数量', `${verifiedQty} ${issue.unit}`), detail('复检结论', updated.verificationNote), detail('验证依据', updated.verificationEvidence)];
      break;
    }
    case 'close': {
      const blockers = qualityCloseBlockers(issue);
      if (blockers.length) throw new Error(blockers.join(' '));
      updated.closeNote = text(input.note, '关闭说明'); updated.status = 'closed';
      details = [detail('关闭说明', updated.closeNote), detail('业务影响', '仅关闭演示异常记录；不生成库存流水或正式审批。')];
      break;
    }
    case 'feedback': {
      validSource(input.source);
      const reference = text(input.reference, '反馈单号', 120);
      const note = text(input.note, '反馈说明');
      if (issue.linkedFeedback.some((feedback) => feedback.source === input.source && feedback.reference.toLocaleLowerCase() === reference.toLocaleLowerCase())) throw new Error('该来源与反馈单号已关联，请勿重复登记。');
      updated.linkedFeedback = [...issue.linkedFeedback, { source: input.source, reference, note }];
      details = [detail('反馈来源', sourceNames[input.source]), detail('反馈单号', reference), detail('反馈说明', note), detail('数量口径', '关联反馈不增加检验数量或不良数量。')];
      break;
    }
  }
  const record: QualityRecord = { id: crypto.randomUUID(), issueId: id, kind: input.kind, createdAt: now.iso, actor: '演示操作员', summary, details, beforeStatus: issue.status, afterStatus: updated.status };
  return { issues: state.issues.map((item) => item.id === id ? updated : item), records: [record, ...state.records] };
}

/** Six independent demo examples; every later status is produced by the same review actions. */
export function createQualityPreviewState(): QualityPreviewState {
  const inputs: QualityCreateInput[] = [
    { source: 'incoming', discoveredDate: '2026-09-08', materialCode: 'DEMO-MAT-001', materialName: '阀体', category: '机加工件', spec: '演示规格 A', unit: '件', supplierName: '演示供应商 A', batchNo: 'DEMO-BATCH-001', orderNo: 'DEMO-PO-001', inspectedQty: 60, defectiveQty: 4, phenomenon: '演示抽检发现密封面有划痕，4 件暂列不良。', evidence: '演示收货批次 demo-receipt-001 的检验记录说明；图片与正式附件待接入。' },
    { source: 'incoming', discoveredDate: '2026-09-07', materialCode: 'DEMO-MAT-003', materialName: '筛筒', category: '钣金件', spec: '演示规格 C', unit: '件', supplierName: '演示供应商 C', batchNo: 'DEMO-BATCH-003', orderNo: 'DEMO-PO-003', inspectedQty: 100, defectiveQty: 6, phenomenon: '演示检验发现 6 件筛孔毛刺，原因待质量员确认。', evidence: '演示检验摘录 DEMO-QC-003：筛孔边缘触检结果。' },
    { source: 'incoming', discoveredDate: '2026-09-06', materialCode: 'DEMO-MAT-004', materialName: '包装箱', category: '包装材料', spec: '演示加固规格', unit: '个', supplierName: '演示供应商 D', batchNo: 'DEMO-BATCH-004', orderNo: 'DEMO-PO-004', inspectedQty: 200, defectiveQty: 8, phenomenon: '演示来料中 8 个包装箱边角压溃。', evidence: '演示验收记录 DEMO-QC-004：边角压溃位置及数量登记。' },
    { source: 'warehouse', discoveredDate: '2026-09-05', materialCode: 'DEMO-MAT-002', materialName: '压缩机', category: '外购总成', spec: '演示规格 B', unit: '台', supplierName: '演示供应商 B', batchNo: 'DEMO-BATCH-002-WH', orderNo: 'DEMO-PO-002', inspectedQty: 20, defectiveQty: 2, phenomenon: '演示仓库复核发现 2 台接线端保护罩松动。', evidence: '演示仓库巡检单 DEMO-WH-002：保护罩状态记录。' },
    { source: 'production', discoveredDate: '2026-09-08', materialCode: 'DEMO-MAT-001', materialName: '阀体', category: '机加工件', spec: '演示规格 A', unit: '件', supplierName: '演示供应商 A', batchNo: 'DEMO-BATCH-001-P2', orderNo: '', inspectedQty: 40, defectiveQty: 3, phenomenon: '演示生产装配反馈 3 件配合孔装配阻力异常。', evidence: '演示生产反馈 DEMO-PROD-005：配合孔尺寸复核摘录。' },
    { source: 'after_sales', discoveredDate: '2026-09-04', materialCode: 'DEMO-MAT-006', materialName: '密封圈', category: '密封件', spec: '演示规格 F', unit: '件', supplierName: '演示供应商 F', batchNo: 'DEMO-BATCH-006', orderNo: '', inspectedQty: 12, defectiveQty: 1, phenomenon: '演示售后返回 1 件密封圈，存在局部压痕。', evidence: '演示售后单 DEMO-AS-006：拆检及压痕测量说明。' },
  ];
  let state: QualityPreviewState = { issues: [], records: [] };
  let step = 0;
  const nextTime = () => new Date(Date.UTC(2026, 8, 9, 0, step++)).toISOString();
  for (const [index, input] of inputs.entries()) {
    state = createQualityIssue(state, input, nextTime());
    const createdId = state.issues[0].id;
    const id = `demo-quality-${String(index + 1).padStart(3, '0')}`;
    state = { issues: state.issues.map((issue) => issue.id === createdId ? { ...issue, id, receiptId: index === 0 ? 'demo-receipt-001' : '' } : issue), records: state.records.map((record) => record.issueId === createdId ? { ...record, issueId: id } : record) };
    const act = (action: QualityActionInput) => { const issue = state.issues.find((item) => item.id === id)!; state = applyQualityAction(state, id, issue.version, action, nextTime()); };
    if (index === 0) continue;
    act({ kind: 'assign', owner: index === 3 ? '演示仓管员' : index === 4 ? '演示生产主管' : '演示采购员', verifier: '演示质量员', dueDate: index === 1 ? '2026-09-09' : '2026-09-12', note: '演示分派：经办人负责协调处置，责任归属须另行确认。' });
    if (index === 1) continue;
    act({ kind: 'cause', category: index === 2 ? 'packaging' : index === 3 ? 'other' : 'process', detail: index === 2 ? '演示确认：运输支撑不足导致包装箱边角受压。' : index === 3 ? '演示确认：保护罩紧固步骤遗漏。' : index === 4 ? '演示确认：配合孔加工工序尺寸偏差。' : '演示确认：安装定位偏移造成局部挤压。', responsibility: index === 4 || index === 5 ? '演示人工认定：生产工序责任。' : '演示人工认定：供应商整改责任。', evidence: '演示人工确认依据：检验摘录、工序复核与现场说明一致。' });
    if (index === 4) continue;
    act({ kind: 'disposition', method: index === 2 || index === 5 ? 'replacement' : 'repair', handledQty: input.defectiveQty, detail: index === 3 ? '演示登记：2 台保护罩按说明重新紧固，等待复核。' : '演示登记：全部不良件已完成替换处置，等待复检；该记录不创建真实收货或库存流水。', evidence: '演示处置依据 DEMO-DISP：处理数量及过程由经办人登记。' });
    act({ kind: 'submit_verification', note: '演示提交：已核对全部处置数量与说明，请质量员复检。' });
    if (index === 2) continue;
    act({ kind: 'verify', quantity: input.defectiveQty, result: 'passed', note: '演示复检：全部处置件按对应检查项复核通过。', evidence: '演示验证记录 DEMO-VERIFY：复核项目、数量与结果一致。' });
    if (index === 5) act({ kind: 'close', note: '演示关闭：原因、处置与全量复检证据已完成核对。' });
  }
  return { issues: [...state.issues].sort((a, b) => a.id.localeCompare(b.id)), records: state.records.map((record, index) => ({ ...record, id: `demo-quality-history-${String(index + 1).padStart(3, '0')}` })) };
}
