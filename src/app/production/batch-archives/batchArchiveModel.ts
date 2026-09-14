import type { ArchiveDocument, ArchiveDocumentKind, ArchiveRevision, ArchiveTab, ArchiveVersions, ArchiveVersionScope, BatchArchive, BatchArchiveState, VersionAmendment } from './batchArchiveTypes';

// Independent, disposable archive examples. These facts never read or update live production,
// quality, stock, shipment, product-version, or ERP data.
const fail = (message: string): never => { throw new Error(message); };
const key = (value: string) => value.trim().toLocaleUpperCase('en-US');
const copy = <T,>(value: T): T => structuredClone(value);
const versionKeys = ['software', 'hardware', 'bom', 'drawing', 'sop', 'sip'] as const;
const versionNames: Record<keyof ArchiveVersions, string> = { software: '软件版本', hardware: '硬件版本', bom: 'BOM 版本', drawing: '图纸版本', sop: 'SOP 版本', sip: 'SIP 版本' };

function text(value: unknown, label: string, required = true, max = 120): string {
  if (typeof value !== 'string') return fail(`${label}格式无效`);
  const clean = value.trim();
  if (required && !clean) fail(`请填写${/^[A-Za-z]/.test(label) ? ' ' : ''}${label}`);
  if (clean.length > max) fail(`${label}不能超过 ${max} 字`);
  return clean;
}
function batchFor(state: BatchArchiveState, id: string): BatchArchive {
  return state.batches.find((batch) => batch.id === id) ?? fail('批次档案已不存在，请重新选择');
}
function stringList(value: unknown, label: string, maxLength: number): string[] {
  if (!Array.isArray(value)) return fail(`${label}格式无效`);
  const values = value.map((item) => text(item, label, true, maxLength));
  if (new Set(values.map(key)).size !== values.length) fail(`${label}存在重复项`);
  return values;
}
function fullyConfirmed(scope: ArchiveVersionScope): boolean {
  return Boolean(scope.versions.software.trim() && scope.versions.hardware.trim() && scope.versions.bom.trim());
}

export function getArchiveSummary(batch: BatchArchive): {
  completed: number; inspected: number; released: number; shipped: number;
  versionConfirmed: number; versionPending: number; snKnown: number; snMissing: number;
} {
  // Inspection totals are cumulative accepted units. Reinspection rows are a subset of that
  // result; similarly, station reports cannot be added together as completed products.
  const completed = batch.completedQty;
  const versionConfirmed = Math.min(completed, batch.versionScopes.filter(fullyConfirmed).reduce((sum, scope) => sum + scope.quantity, 0));
  const snKnown = Math.min(completed, new Set(batch.serials.map((entry) => key(entry.sn)).filter(Boolean)).size);
  return {
    completed, inspected: batch.inspectionPassedQty, released: batch.releasedQty,
    shipped: batch.documents.filter((document) => document.kind === 'shipment' && document.status === '已出库').reduce((sum, document) => sum + (document.quantity ?? 0), 0),
    versionConfirmed, versionPending: Math.max(0, completed - versionConfirmed),
    snKnown, snMissing: Math.max(0, completed - snKnown),
  };
}

export function getArchiveGaps(batch: BatchArchive): { id: string; label: string; detail: string; tab: ArchiveTab }[] {
  const summary = getArchiveSummary(batch);
  const gaps: { id: string; label: string; detail: string; tab: ArchiveTab }[] = [];
  const allocated = batch.versionScopes.reduce((sum, scope) => sum + scope.quantity, 0);
  const unallocated = Math.max(0, batch.completedQty - allocated);
  if (summary.versionPending > 0) gaps.push({ id: 'versions', label: '实际版本待确认', detail: `${summary.versionPending} 台尚未确认软件、硬件及 BOM 的完整组合${unallocated ? `，其中 ${unallocated} 台尚未划分适用范围` : ''}。`, tab: 'versions' });
  if (summary.snMissing > 0) gaps.push({ id: 'sn', label: 'SN 待补齐', detail: `已记录 ${summary.snKnown} 个已有 SN，其余 ${summary.snMissing} 台缺少 SN 依据；当前仅支持已有证据的批次追溯。`, tab: 'overview' });
  const missingLots = batch.materials.filter((material) => !material.materialBatch.trim());
  if (missingLots.length) gaps.push({ id: 'material-batches', label: '关键物料批次待补齐', detail: `${missingLots.length} 项物料缺少供应批次，不能据领料数量推断具体用料。`, tab: 'materials' });
  const docs = new Set(batch.documents.map((document) => document.id));
  const missingEvidence = batch.versionScopes.some((scope) => !scope.evidenceIds.length || scope.evidenceIds.some((id) => !docs.has(id)))
    || batch.materials.some((material) => !material.sourceDocumentIds.length || material.sourceDocumentIds.some((id) => !docs.has(id)))
    || batch.serials.some((entry) => !docs.has(entry.sourceDocumentId));
  if (missingEvidence) gaps.push({ id: 'sources', label: '来源凭据待补齐', detail: '部分版本、物料或 SN 尚无可查看的来源单据，请保留缺失状态并核实依据。', tab: 'versions' });
  if (batch.inspectionPassedQty < batch.completedQty) gaps.push({ id: 'inspection', label: '检验结果待完成', detail: `${batch.completedQty - batch.inspectionPassedQty} 台尚未计入累计检验合格数量。`, tab: 'inspections' });
  if (batch.releasedQty < batch.inspectionPassedQty) gaps.push({ id: 'release', label: '质量放行待完成', detail: `${batch.inspectionPassedQty - batch.releasedQty} 台虽已检验合格，仍未取得质量授权放行。`, tab: 'inspections' });
  if (batch.documents.some((document) => document.kind === 'exception' && !['已关闭', '已结案'].includes(document.status))) gaps.push({ id: 'exceptions', label: '不良处置待跟进', detail: '存在未关闭的不良处置记录，处理进度以关联处置单为准。', tab: 'exceptions' });
  const draftQty = batch.documents.filter((document) => document.kind === 'shipment' && document.status === '待确认').reduce((sum, document) => sum + (document.quantity ?? 0), 0);
  if (draftQty) gaps.push({ id: 'shipments', label: '出货登记待确认', detail: `${draftQty} 台仅为待确认登记，未计入实际出货。`, tab: 'shipments' });
  return gaps;
}

function amendmentFor(state: BatchArchiveState, batchId: string, input: VersionAmendment): VersionAmendment {
  const batch = batchFor(state, batchId);
  if (!input || typeof input !== 'object') return fail('版本修订格式无效');
  const scopeId = input.scopeId === undefined ? undefined : text(input.scopeId, '版本范围');
  const existing = scopeId === undefined ? undefined : batch.versionScopes.find((scope) => scope.id === scopeId);
  if (scopeId !== undefined && !existing) fail('该版本范围已不存在，请重新选择');
  const name = text(input.name, '适用范围名称', true, 120);
  if (batch.versionScopes.some((scope) => scope.id !== scopeId && key(scope.name) === key(name))) fail('适用范围名称已存在，请使用可区分的名称');
  const actor = text(input.actor, '修订人', true, 80);
  const reason = text(input.reason, '修订原因', true, 1000);
  if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) fail('适用数量须为大于 0 的整数');
  const otherScopes = batch.versionScopes.filter((scope) => scope.id !== scopeId);
  if (input.quantity + otherScopes.reduce((sum, scope) => sum + scope.quantity, 0) > batch.completedQty) fail('各适用范围的数量之和不能超过本批完工数量');
  if (!input.versions || typeof input.versions !== 'object' || Array.isArray(input.versions)) fail('实际版本格式无效');
  const versions = Object.fromEntries(versionKeys.map((field) => [field, text(input.versions[field], versionNames[field], false, 80)])) as unknown as ArchiveVersions;
  if (!versionKeys.some((field) => versions[field])) fail('请至少填写一项有依据的实际版本');
  const evidenceIds = stringList(input.evidenceIds, '来源凭据', 120);
  if (!evidenceIds.length) fail('请至少关联一份来源凭据');
  const docs = new Set(batch.documents.map((document) => document.id));
  if (evidenceIds.some((id) => !docs.has(id))) fail('来源凭据须为本批已有单据');
  const suppliedSerials = stringList(input.serialNumbers, 'SN', 128);
  if (suppliedSerials.length > input.quantity) fail('关联 SN 数量不能超过本适用范围数量');
  const knownSerials = new Map(batch.serials.map((entry) => [key(entry.sn), entry.sn]));
  if (suppliedSerials.some((sn) => !knownSerials.has(key(sn)))) fail('只能关联本批已有 SN；新增 SN 需先核对原始来源');
  const usedSerials = new Set(otherScopes.flatMap((scope) => scope.serialNumbers.map(key)));
  if (suppliedSerials.some((sn) => usedSerials.has(key(sn)))) fail('SN 已关联其他版本范围，不能重复分配');
  const serialNumbers = suppliedSerials.map((sn) => knownSerials.get(key(sn))!);
  const cleaned = { scopeId, name, quantity: input.quantity, versions, serialNumbers, evidenceIds, actor, reason };
  if (existing) {
    const sameSet = (first: string[], second: string[]) => first.length === second.length && first.every((item) => second.includes(item));
    if (existing.name === name && existing.quantity === cleaned.quantity && versionKeys.every((field) => existing.versions[field] === versions[field])
      && sameSet(existing.serialNumbers.map(key), serialNumbers.map(key)) && sameSet(existing.evidenceIds, evidenceIds)) fail('实际版本及适用范围没有变化');
  }
  return cleaned;
}

/** Validate without mutating source facts, revision history, or the caller's form input. */
export function validateVersionAmendment(state: BatchArchiveState, batchId: string, input: VersionAmendment): void {
  amendmentFor(state, batchId, input);
}

export function applyVersionAmendment(state: BatchArchiveState, batchId: string, expectedVersion: number, input: VersionAmendment, now = new Date().toISOString()): BatchArchiveState {
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion !== state.version) fail('档案已变化，请重新核对后提交');
  const cleaned = amendmentFor(state, batchId, input);
  const date = new Date(now);
  if (!Number.isFinite(date.getTime())) fail('修订时间无效');
  const next = copy(state);
  const batch = batchFor(next, batchId);
  const before = copy(batch.versionScopes);
  next.version += 1;
  const used = new Set(next.batches.flatMap((item) => item.versionScopes.map((scope) => scope.id)));
  let scopeId = cleaned.scopeId ?? `version-${batchId}-${next.version}`;
  if (!cleaned.scopeId) {
    let suffix = 1;
    while (used.has(scopeId)) scopeId = `version-${batchId}-${next.version}-${suffix++}`;
  }
  const scope: ArchiveVersionScope = { id: scopeId, name: cleaned.name, quantity: cleaned.quantity, versions: copy(cleaned.versions), serialNumbers: [...cleaned.serialNumbers], evidenceIds: [...cleaned.evidenceIds] };
  if (cleaned.scopeId) batch.versionScopes = batch.versionScopes.map((item) => item.id === scope.id ? scope : item);
  else batch.versionScopes.push(scope);
  const revisionIds = new Set(next.revisions.map((revision) => revision.id));
  let revisionId = `archive-revision-${next.version}`; let suffix = 1;
  while (revisionIds.has(revisionId)) revisionId = `archive-revision-${next.version}-${suffix++}`;
  next.revisions.push({ id: revisionId, batchId, scopeId, actor: cleaned.actor, at: date.toISOString(), reason: cleaned.reason, before, after: copy(batch.versionScopes) });
  return next;
}

function document(id: string, code: string, kind: ArchiveDocumentKind, date: string, title: string, quantity: number | null, options: Partial<ArchiveDocument> = {}): ArchiveDocument {
  return { id, code, kind, date, title, status: '已归档', tone: 'neutral', quantity, unit: '台', actor: '演示经办人', summary: '独立演示凭据，用于查看档案关联关系。', facts: [], serialNumbers: [], relatedIds: [], ...options };
}
const versions = (software: string, hardware: string, bom: string, suffix = 'C'): ArchiveVersions => ({ software, hardware, bom, drawing: `DWG-${suffix}`, sop: `SOP-${suffix}`, sip: `SIP-${suffix}` });

export function createBatchArchiveState(): BatchArchiveState {
  const firstSN = Array.from({ length: 100 }, (_, index) => `IN100-0901-${String(index + 1).padStart(3, '0')}`);
  const secondSN = ['IN100-0902-001', 'IN100-0902-002', 'IN100-0902-003', 'IN100-0902-061', 'IN100-0902-062'];
  // Component identities belong to material issue evidence. They are deliberately distinct
  // from finished-product SN; no unit-to-component installation mapping is asserted.
  const firstMaterialSN = Array.from({ length: 102 }, (_, index) => `PCB-260828-A-${String(index + 1).padStart(3, '0')}`);
  const secondMaterialSN = ['PCB-260901-B-001', 'PCB-260901-B-002', 'PCB-260901-B-003'];
  const firstDocs: ArchiveDocument[] = [
    document('b1-dispatch', 'WO-0901-01', 'dispatch', '2026-09-01', 'A 线生产派工', 100, { actor: '生产计划员', facts: [{ label: '生产计划', value: 'PP-202609-001' }, { label: '产线', value: '装配 A 线' }] }),
    document('b1-assembly', 'RPT-0902-01', 'production', '2026-09-02', '装配工序报工', 100, { actor: '班组长 A', summary: '装配完成 100 台；工序报工不与包装报工相加。', relatedIds: ['b1-dispatch', 'b1-issue'] }),
    document('b1-packing', 'RPT-0905-01', 'production', '2026-09-05', '包装完工报工', 100, { actor: '班组长 A', summary: '本批完工口径为包装完工 100 台。', relatedIds: ['b1-assembly'] }),
    document('b1-inspection', 'FQC-0905-01', 'inspection', '2026-09-05', '终检记录', 100, { actor: '检验员 A', status: '合格', tone: 'success', summary: '终检 100 台，首次检验合格 100 台。', serialNumbers: [...firstSN], relatedIds: ['b1-packing'] }),
    document('b1-release', 'QA-REL-0905-01', 'release', '2026-09-05', '质量授权放行', 100, { actor: '质量负责人 A', status: '已放行', tone: 'success', summary: '质量授权放行 100 台；不代表已实际出货。', relatedIds: ['b1-inspection'] }),
    document('b1-issue', 'ISS-0901-01', 'issue', '2026-09-01', '控制板领料', 102, { actor: '仓管员 A', unit: '块', serialNumbers: [...firstMaterialSN], summary: '领料 102 块，凭据附 102 个控制板材料 SN；尚无与整机 SN 的装机对应关系，余料另有退料记录。', facts: [{ label: '物料批次', value: 'PCB-260828-A' }, { label: 'SN 类型', value: '控制板材料 SN，不是整机 SN' }] }),
    document('b1-return', 'RET-0905-01', 'return', '2026-09-05', '控制板余料退回', 2, { actor: '仓管员 A', unit: '块', status: '已接收', tone: 'success', serialNumbers: firstMaterialSN.slice(100), summary: '余料 2 块已接收，凭据附退回控制板的材料 SN；退料数量不直接推算装机消耗。', facts: [{ label: '物料批次', value: 'PCB-260828-A' }, { label: 'SN 类型', value: '控制板材料 SN' }], relatedIds: ['b1-issue'] }),
    document('b1-technical', 'BUILD-0901-01', 'technical', '2026-09-05', '随批版本及 SN 清单', 100, { actor: '制造工程师 A', serialNumbers: [...firstSN], summary: '演示随批记录明确 100 台的实际软件、硬件和 BOM 版本。', facts: [{ label: '软件版本', value: 'V1.1.0' }, { label: '硬件版本', value: 'HW-C' }, { label: 'BOM 版本', value: 'BOM-V3.2' }, { label: '适用范围', value: '本批 100 台' }] }),
    document('b1-shipment', 'SHIP-0906-01', 'shipment', '2026-09-06', '华东客户订单出库', 100, { actor: '仓管员 A', status: '已出库', tone: 'success', serialNumbers: [...firstSN], summary: '实际出库 100 台。此处为独立档案演示快照。', facts: [{ label: '客户订单', value: 'SO-0901' }, { label: '客户', value: '华东客户（演示）' }], relatedIds: ['b1-release'] }),
  ];
  const secondDocs: ArchiveDocument[] = [
    document('b2-dispatch', 'WO-0902-01', 'dispatch', '2026-09-02', 'B 线生产派工', 120, { actor: '生产计划员', facts: [{ label: '生产计划', value: 'PP-202609-002' }, { label: '计划数量', value: '120 台' }] }),
    document('b2-assembly', 'RPT-0904-02', 'production', '2026-09-04', '装配工序报工', 120, { actor: '班组长 B', summary: '装配报工 120 台，其中 4 台尚未完成包装；不能将各工序报工累计为完工量。', relatedIds: ['b2-dispatch', 'b2-issue'] }),
    document('b2-packing', 'RPT-0907-02', 'production', '2026-09-07', '包装完工报工', 116, { actor: '班组长 B', summary: '包装完工累计 116 台，为本批完工数量来源。', relatedIds: ['b2-assembly'] }),
    document('b2-inspection', 'FQC-0907-02', 'inspection', '2026-09-07', '终检及首次不良记录', 116, { actor: '检验员 B', status: '已完成', tone: 'success', summary: '终检 116 台，首次合格 110 台、不良 6 台；复验后累计合格 116 台。', facts: [{ label: '首次检验数量', value: '116 台' }, { label: '首次合格', value: '110 台' }, { label: '首次不良', value: '6 台' }], relatedIds: ['b2-packing', 'b2-exception'] }),
    document('b2-exception', 'NCR-0907-02', 'exception', '2026-09-07', '通信测试异常返工处置', 6, { actor: '质量工程师 B', status: '已关闭', tone: 'success', summary: '6 台通信测试异常，经返工后复验全部合格；首次不良记录保留。', facts: [{ label: '不良现象', value: '通信测试间歇断连' }, { label: '处置方式', value: '返工后复验' }], relatedIds: ['b2-inspection', 'b2-reinspection'] }),
    document('b2-reinspection', 'RETEST-0907-02', 'reinspection', '2026-09-07', '返工复验', 6, { actor: '检验员 C', status: '合格', tone: 'success', summary: '复验合格 6 台，已包含在累计合格 116 台内；不可再次相加。', relatedIds: ['b2-exception'] }),
    document('b2-release', 'QA-REL-0907-02', 'release', '2026-09-07', '分批质量授权放行', 100, { actor: '质量负责人 A', status: '已放行', tone: 'success', summary: '本次授权放行 100 台，其余 16 台等待放行凭据核实。', relatedIds: ['b2-inspection', 'b2-reinspection'] }),
    document('b2-issue', 'ISS-0902-02', 'issue', '2026-09-02', '控制板领料', 122, { actor: '仓管员 A', unit: '块', serialNumbers: [...secondMaterialSN], summary: '控制板领出 122 块，供应批次 PCB-260901-B；凭据仅留存 3 个控制板材料 SN，未建立与整机 SN 的装机对应关系。', facts: [{ label: '物料批次', value: 'PCB-260901-B' }, { label: 'SN 类型', value: '控制板材料 SN，不是整机 SN' }, { label: '材料 SN 清单', value: '已记录 3 个，其余待补齐' }] }),
    document('b2-issue-shell', 'ISS-0902-03', 'issue', '2026-09-02', '外壳领料', 120, { actor: '仓管员 A', unit: '套', summary: '外壳领料 120 套，历史供应批次字段待补齐。', facts: [{ label: '物料批次', value: '待补齐' }] }),
    document('b2-return', 'RET-0907-02', 'return', '2026-09-07', '控制板余料退回', 2, { actor: '仓管员 A', unit: '块', status: '已接收', tone: 'success', summary: '余料退回 2 块，关联领料单；本退料凭据未列明材料 SN，不据此推断逐台装机用料。', facts: [{ label: '物料批次', value: 'PCB-260901-B' }, { label: '退回材料 SN', value: '待补齐' }], relatedIds: ['b2-issue'] }),
    document('b2-technical', 'BUILD-0902-01', 'technical', '2026-09-07', '首段随批版本与已有 SN 清单', 60, { actor: '制造工程师 B', serialNumbers: secondSN.slice(0, 3), summary: '已核实首段 60 台实际软件 V1.1.0、硬件 HW-C、BOM-V3.2；仅有 3 个 SN 清单条目。', facts: [{ label: '软件版本', value: 'V1.1.0' }, { label: '硬件版本', value: 'HW-C' }, { label: 'BOM 版本', value: 'BOM-V3.2' }, { label: '适用范围', value: '首段 60 台' }] }),
    document('b2-technical-partial', 'BUILD-0902-02', 'technical', '2026-09-07', '第二段部分版本记录', 40, { actor: '制造工程师 B', serialNumbers: secondSN.slice(3), status: '待补齐', tone: 'warning', summary: '已留存第二段 40 台 BOM-V3.2 依据，软件及硬件实装版本尚未核实。', facts: [{ label: '软件版本', value: '待确认' }, { label: '硬件版本', value: '待确认' }, { label: 'BOM 版本', value: 'BOM-V3.2' }] }),
    document('b2-ecn', 'ECN-202609-003', 'ecn', '2026-09-09', '控制组件版本变更通知', null, { actor: '研发工程师 A', status: '已发布', tone: 'neutral', summary: '变更已发布，仅对明确列入适用范围的新投产批次生效；本批保留历史实装版本，不由变更通知自动覆盖。', facts: [{ label: '目标软件版本', value: 'V1.2.0' }, { label: '生效条件', value: '明确适用的新投产批次使用新版；B-FG-0902 保留原随批版本依据' }] }),
    document('b2-shipment', 'SHIP-0908-01', 'shipment', '2026-09-08', '华南客户首批出库', 80, { actor: '仓管员 A', status: '已出库', tone: 'success', summary: '已实际出库 80 台，出库 SN 清单仍待补齐。', facts: [{ label: '客户订单', value: 'SO-0902' }, { label: '客户', value: '华南客户（演示）' }], relatedIds: ['b2-release'] }),
    document('b2-shipment-draft', 'SHIP-0909-01', 'shipment', '2026-09-09', '华南客户余量登记', 20, { actor: '仓管员 A', status: '待确认', tone: 'warning', summary: '待确认实际出库，20 台未计入已出货数量。', facts: [{ label: '客户订单', value: 'SO-0902' }], relatedIds: ['b2-release'] }),
    document('b2-shipment-reversed', 'SHIP-0908-ERR', 'shipment', '2026-09-08', '重复出库登记冲销', 10, { actor: '仓管员 A', status: '已冲销', tone: 'neutral', summary: '原登记重复，已于 2026-09-09 冲销；原数量保留但不计入实际出货，不代表实物退货。', facts: [{ label: '冲销人', value: '仓管员 A' }, { label: '冲销日期', value: '2026-09-09' }, { label: '冲销原因', value: '与 SHIP-0908-01 重复登记' }], relatedIds: ['b2-shipment'] }),
  ];
  const firstScope: ArchiveVersionScope = { id: 'scope-b1-all', name: '本批全部 100 台', quantity: 100, versions: versions('V1.1.0', 'HW-C', 'BOM-V3.2'), serialNumbers: [...firstSN], evidenceIds: ['b1-technical'] };
  const secondScopes: ArchiveVersionScope[] = [
    { id: 'scope-b2-first', name: '首段 60 台', quantity: 60, versions: versions('V1.1.0', 'HW-C', 'BOM-V3.2'), serialNumbers: secondSN.slice(0, 3), evidenceIds: ['b2-technical'] },
    { id: 'scope-b2-second', name: '第二段 40 台', quantity: 40, versions: { software: '', hardware: '', bom: 'BOM-V3.2', drawing: '', sop: '', sip: '' }, serialNumbers: secondSN.slice(3), evidenceIds: ['b2-technical-partial'] },
  ];
  const batches: BatchArchive[] = [
    { id: 'batch-01', batchNo: 'B-FG-0901', planNo: 'PP-202609-001', productCode: 'IN-100', productName: '智能控制组件', line: '装配 A 线', owner: '班组长 A', startDate: '2026-09-01', plannedQty: 100, completedQty: 100, inspectionPassedQty: 100, releasedQty: 100, sourceLabel: '独立演示档案快照 · 已补齐示例', sourceAt: '2026-09-11T01:00:00.000Z', versionScopes: [firstScope], serials: firstSN.map((sn) => ({ sn, sourceDocumentId: 'b1-technical' })), documents: firstDocs, materials: [{ id: 'b1-pcb', code: 'MAT-PCB-100', name: '主控制板', spec: 'IN-100 / HW-C', supplier: '华东电子（演示）', materialBatch: 'PCB-260828-A', unit: '块', perUnitQty: 1, issuedQty: 102, returnedQty: 2, serialNumbers: [...firstMaterialSN], sourceDocumentIds: ['b1-issue', 'b1-return'] }] },
    { id: 'batch-02', batchNo: 'B-FG-0902', planNo: 'PP-202609-002', productCode: 'IN-100', productName: '智能控制组件', line: '装配 B 线', owner: '班组长 B', startDate: '2026-09-02', plannedQty: 120, completedQty: 116, inspectionPassedQty: 116, releasedQty: 100, sourceLabel: '独立演示档案快照 · 存在待补齐项', sourceAt: '2026-09-11T01:00:00.000Z', versionScopes: secondScopes, serials: secondSN.map((sn, index) => ({ sn, sourceDocumentId: index < 3 ? 'b2-technical' : 'b2-technical-partial' })), documents: secondDocs, materials: [
      { id: 'b2-pcb', code: 'MAT-PCB-100', name: '主控制板', spec: 'IN-100 系列', supplier: '华东电子（演示）', materialBatch: 'PCB-260901-B', unit: '块', perUnitQty: 1, issuedQty: 122, returnedQty: 2, serialNumbers: [...secondMaterialSN], sourceDocumentIds: ['b2-issue', 'b2-return'] },
      { id: 'b2-shell', code: 'MAT-SHELL-100', name: '控制组件外壳', spec: 'IN-100 标准外壳', supplier: '精工制造（演示）', materialBatch: '', unit: '套', perUnitQty: 1, issuedQty: 120, returnedQty: 0, serialNumbers: [], sourceDocumentIds: ['b2-issue-shell'] },
    ] },
    { id: 'batch-03', batchNo: 'B-FG-0831', planNo: 'PP-202608-018', productCode: 'IN-200', productName: '工业通信组件', line: '装配 A 线', owner: '历史班组（演示）', startDate: '2026-08-28', plannedQty: 50, completedQty: 50, inspectionPassedQty: 50, releasedQty: 0, sourceLabel: '独立演示历史档案 · 来源待补齐', sourceAt: '2026-09-11T01:00:00.000Z', versionScopes: [], serials: [], documents: [
      document('b3-dispatch', 'WO-0828-18', 'dispatch', '2026-08-28', '历史生产派工', 50, { actor: '历史计划员', facts: [{ label: '生产计划', value: 'PP-202608-018' }] }),
      document('b3-packing', 'RPT-0831-18', 'production', '2026-08-31', '历史完工报工', 50, { actor: '历史班组长', summary: '历史包装完工记录 50 台；实际版本和逐台 SN 来源待补齐。', relatedIds: ['b3-dispatch'] }),
      document('b3-inspection', 'FQC-0831-18', 'inspection', '2026-08-31', '历史终检记录', 50, { actor: '历史检验员', status: '合格', tone: 'success', summary: '终检累计合格 50 台，未见质量授权放行凭据。', relatedIds: ['b3-packing'] }),
      document('b3-technical', 'NOTE-0831-18', 'technical', '2026-08-31', '历史硬件标签摘录', null, { actor: '历史资料员', status: '待确认', tone: 'warning', summary: '摘录显示 HW-B，适用数量及原始实装来源待核实，尚未划入实际版本范围。', facts: [{ label: '硬件标签', value: 'HW-B' }, { label: '适用数量', value: '待确认' }] }),
    ], materials: [{ id: 'b3-comms', code: 'MAT-COMM-200', name: '通信板', spec: 'IN-200', supplier: '待补齐', materialBatch: '', unit: '块', perUnitQty: null, issuedQty: 50, returnedQty: 0, serialNumbers: [], sourceDocumentIds: [] }] },
  ];
  const before = copy(secondScopes); before[0].versions.software = 'V1.0.9';
  const revisions: ArchiveRevision[] = [{ id: 'archive-revision-seed', batchId: 'batch-02', scopeId: 'scope-b2-first', actor: '制造工程师 B', at: '2026-09-10T02:30:00.000Z', reason: '核对 BUILD-0902-01 烧录随批记录，纠正首段软件版本抄录错误；未套用 ECN 的最新目标版本。', before, after: copy(secondScopes) }];
  return { version: 1, batches, revisions };
}

/** Spreadsheet-safe CSV. Every source field and complete revision snapshot is included. */
export function buildBatchArchiveCsv(state: BatchArchiveState, batchId: string): string {
  const batch = batchFor(state, batchId);
  const rows: unknown[][] = [['章节', '记录', '字段', '值']];
  const add = (section: string, record: string, field: string, value: unknown) => rows.push([section, record, field, value === null || value === undefined || value === '' ? '待补齐' : value]);
  add('导出说明', batch.batchNo, '数据范围', '独立前端演示档案，不代表正式业务数据或逐台完整追溯');
  const baseNames: Record<string, string> = { id: '档案 ID', batchNo: '批次号', planNo: '生产计划', productCode: '产品编码', productName: '产品名称', line: '产线', owner: '负责人', startDate: '开始日期', plannedQty: '计划数量', completedQty: '累计完工数量', inspectionPassedQty: '累计检验合格数量', releasedQty: '质量授权放行数量', sourceLabel: '数据来源', sourceAt: '快照时间' };
  for (const [field, label] of Object.entries(baseNames)) add('基本资料', batch.batchNo, label, batch[field as keyof BatchArchive]);
  const summaryNames: Record<string, string> = { completed: '累计完工数量', inspected: '累计检验合格数量', released: '质量授权放行数量', shipped: '实际出货数量', versionConfirmed: '版本已确认数量', versionPending: '版本待确认数量', snKnown: '已有 SN 数量', snMissing: 'SN 待补齐数量' };
  for (const [field, value] of Object.entries(getArchiveSummary(batch))) add('统计口径', batch.batchNo, summaryNames[field], value);
  add('统计口径', batch.batchNo, '计算说明', '工序报工不累加为完工；复验合格不重复计入累计合格；实际出货仅含已出库单据；领退料不推断实装消耗。');
  for (const gap of getArchiveGaps(batch)) add('待补齐项', gap.id, gap.label, gap.detail);
  function addScope(section: string, scope: ArchiveVersionScope) {
    const scopeNames: Record<string, string> = { id: '范围 ID', name: '适用范围', quantity: '适用数量', serialNumbers: '关联已有 SN', evidenceIds: '来源凭据 ID' };
    for (const [field, label] of Object.entries(scopeNames)) {
      const value = scope[field as keyof ArchiveVersionScope];
      add(section, scope.id, label, Array.isArray(value) ? value.join('\n') : value);
    }
    for (const field of versionKeys) add(section, scope.id, versionNames[field], scope.versions[field]);
  }
  for (const scope of batch.versionScopes) addScope('实际版本', scope);
  for (const serial of batch.serials) { add('已有 SN', serial.sn, 'SN', serial.sn); add('已有 SN', serial.sn, '来源凭据 ID', serial.sourceDocumentId); }
  const materialNames: Record<string, string> = { id: '物料记录 ID', code: '物料编码', name: '物料名称', spec: '规格', supplier: '供应商', materialBatch: '供应批次', unit: '单位', perUnitQty: 'BOM 单台用量', issuedQty: '关联领料数量', returnedQty: '关联退料数量', serialNumbers: '已有材料 SN', sourceDocumentIds: '来源凭据 ID' };
  for (const material of batch.materials) for (const [field, label] of Object.entries(materialNames)) {
    const value = material[field as keyof typeof material];
    add('物料与领退料', material.id, label, Array.isArray(value) ? value.join('\n') : value);
  }
  const docNames: Record<string, string> = { id: '凭据 ID', code: '单据号', kind: '单据类型', date: '业务日期', title: '标题', status: '状态', tone: '状态提示', quantity: '数量', unit: '单位', actor: '经办人', summary: '记录摘要', serialNumbers: '关联已有 SN', relatedIds: '关联凭据 ID' };
  for (const doc of batch.documents) {
    for (const [field, label] of Object.entries(docNames)) { const value = doc[field as keyof ArchiveDocument]; add('来源凭据', doc.code, label, Array.isArray(value) ? value.join('\n') : value); }
    for (const fact of doc.facts) add('来源凭据明细', doc.code, fact.label, fact.value);
  }
  for (const revision of state.revisions.filter((item) => item.batchId === batchId)) {
    for (const [field, label] of Object.entries({ id: '修订 ID', batchId: '批次 ID', scopeId: '修订范围 ID', actor: '修订人', at: '修订时间', reason: '修订原因' })) add('版本修订', revision.id, label, revision[field as keyof ArchiveRevision]);
    // Explicit empty markers distinguish adding the first scope from missing export data.
    if (!revision.before.length) add(`修订前 / ${revision.id}`, revision.id, '版本范围', '无已记录范围');
    if (!revision.after.length) add(`修订后 / ${revision.id}`, revision.id, '版本范围', '无已记录范围');
    for (const scope of revision.before) addScope(`修订前 / ${revision.id}`, scope);
    for (const scope of revision.after) addScope(`修订后 / ${revision.id}`, scope);
  }
  const cell = (value: unknown): string => {
    let content = String(value ?? '');
    // Protect formulas even behind leading spaces, tabs, newlines, or control characters.
    if (/^[\s\u0000-\u001f\u007f]*[=+\-@]/u.test(content) || /^[\t\r\n]/u.test(content)) content = `'${content}`;
    return `"${content.replaceAll('"', '""')}"`;
  };
  return `\uFEFF${rows.map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`;
}
