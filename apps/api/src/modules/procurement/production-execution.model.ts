import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { bomHash, type BomSnapshot } from './bom-revisions.model';
import { operationDay } from './procurement-operations.service';

export interface ExecutionBomLine { id: string; code: string; name: string; unit: string; qtyPer: number }
export interface ExecutionReport { id: string; date: string; quantity: number; goodQty: number; note: string; actorId: string; actorName: string; at: string }
export type ExecutionInspectionKind = 'process' | 'final' | 'legacy';
export interface ExecutionDocument { kind: 'sop' | 'sip' | 'drawing'; documentId: string; versionId: string; attachmentId: string; fileId?: string; name: string; version: string; createdAt?: string }
export interface ExecutionInspection { id: string; reportId: string; date: string; quantity: number; goodQty: number; evidence: string; actorId: string; actorName: string; at: string; qualityId: string | null; verifiedGoodQty?: number;
  kind?: ExecutionInspectionKind; process?: string; sip?: { text: string; source: 'dispatch' | 'manual'; packageId?: string; document?: ExecutionDocument } }
export interface ExecutionTask {
  fieldIssues?: { id: string; qualityId: string; reportId: string; inspectionId?: string; date: string; defectiveQty: number; issue: string; actorId: string; actorName: string; at: string; initialCause?: 'unknown' | 'material' | 'software' | 'assembly' | 'other'; requestedCollaboration?: { department: string | null; ownerId: string; ownerName: string }; materialBatches: { code: string; batchNo: string | null }[] }[];
  basis?: { packageId: string; code: string; sop: string; sip: string; drawing: string; sampleTaskId: string; roundId: string; changeIds: string[]; at: string; documents?: ExecutionDocument[] };
  id: string; batchId: string; name: string; treeNodeId: string; output: 'component' | 'whole'; unit: string;
  quantity: number; date: string; line: string; ownerId: string; ownerName: string;
  materials: Array<ExecutionBomLine & { requiredQty: number }>;
  status: 'draft' | 'dispatched' | 'cancelled'; reports: ExecutionReport[]; inspections?: ExecutionInspection[];
}
export interface ExecutionBatch { id: string; code: string; quantity: number; dueDate: string }
export interface ExecutionEvent { id: string; action: string; reason: string; actorId: string; actorName: string; at: string; subjectId: string;
  adjustment?: { before: Pick<ExecutionTask, 'date' | 'line' | 'ownerId' | 'ownerName' | 'quantity'>; after: Pick<ExecutionTask, 'date' | 'line' | 'ownerId' | 'ownerName' | 'quantity'>; reportedQty: number; warehouse?: { id: string; beforeVersion: number; afterVersion: number; lines: { code: string; beforeQty: number; afterQty: number; issuedQty: number; signedQty: number }[] } } }
export interface ExecutionPlan {
  deviceId?: string; bomRevisionId?: string; bomSnapshot?: BomSnapshot;
  legacyBasisReview?: { deviceId: string; productRootId: string; sourceFingerprint: string; actorId: string; actorName: string; at: string; reason: string };
  id: string; version: number; month: string; productId: string; productName: string; productLine: string;
  targetQty: number; shipmentTargetQty: number; bom: ExecutionBomLine[]; bomFingerprint: string;
  batches: ExecutionBatch[]; tasks: ExecutionTask[]; events: ExecutionEvent[];
}
export interface ExecutionCommand { requestId: string; version: number; action: string; data: Record<string, unknown> }
export const legacyBasisFingerprint = (plan: ExecutionPlan, productRootId: string, deviceId: string) => bomHash([plan.productId, productRootId, deviceId, plan.bom]);
export function assertLegacyBom(plan: ExecutionPlan): void {
  if (!plan.bom.length) throw new BadRequestException('原计划没有完整 BOM 快照，不能确认或扩大执行；请核实原始档案，已有实物流程仍可收尾');
  const codes = new Set<string>();
  for (const line of plan.bom) {
    const code = executionText(line.code, '原快照物料编码');
    executionText(line.id, '原快照物料身份'); executionText(line.name, '原快照物料名称'); executionText(line.unit, '原快照单位'); executionQty(line.qtyPer, '原快照单机用量', true);
    if (codes.has(code)) throw new BadRequestException('原快照物料编码重复，请核实原始档案');
    codes.add(code);
  }
}
export function legacyBasisAllows(plan: ExecutionPlan, action: string, data: Record<string, unknown>): boolean {
  if (plan.bomRevisionId) return true;
  const review = plan.legacyBasisReview;
  if (review && plan.deviceId === review.deviceId && review.sourceFingerprint === legacyBasisFingerprint(plan, review.productRootId, review.deviceId)) {
    try { assertLegacyBom(plan); return true; } catch { /* Invalid historical data can still finish existing physical flows. */ }
  }
  if (action === 'task' || action === 'dispatch') return false;
  if (action === 'targets') return typeof data.targetQty === 'number' && data.targetQty <= plan.targetQty;
  if (action === 'adjust') { const task = plan.tasks.find(row => row.id === data.taskId); return Boolean(task && typeof data.quantity === 'number' && data.quantity <= task.quantity); }
  return true;
}
export function executionText(value: unknown, label: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new BadRequestException(`请填写有效的${label}`);
  return value.trim();
}
export function executionQty(value: unknown, label: string, positive = false, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1_000_000_000 || (positive && value === 0)
    || (integer && !Number.isSafeInteger(value)) || new Prisma.Decimal(value).decimalPlaces() > 3) throw new BadRequestException(`${label}须为${positive ? '正' : '非负'}${integer ? '整数' : '数，最多三位小数'}`);
  return value;
}
export const executionToday = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
export function executionDay(value: unknown, label: string): string { const date = executionText(value, label, 10); operationDay(date, label); return date; }
export function executionMonth(value: unknown): string {
  const month = executionText(value, '月份', 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month.startsWith('0000')) throw new BadRequestException('月份格式无效');
  return month;
}
export const executionSum = (values: number[]) => values.reduce((sum, value) => sum.plus(value), new Prisma.Decimal(0)).toNumber();
export const executionInspectionKind = (row: Pick<ExecutionInspection, 'kind'>): ExecutionInspectionKind => row.kind === 'process' || row.kind === 'final' ? row.kind : 'legacy';
export const completionInspections = (task: Pick<ExecutionTask, 'inspections'>) => (task.inspections ?? []).filter(row => executionInspectionKind(row) !== 'process');
export function executionFinalInspectionSummary(tasks: ExecutionTask[], date?: string) {
  const rows = tasks.filter(task => task.status !== 'cancelled' && task.output === 'whole').flatMap(task => (task.inspections ?? []).filter(row => executionInspectionKind(row) === 'final' && (!date || row.date === date)));
  const quantity = executionSum(rows.map(row => row.quantity)), goodQty = executionSum(rows.map(row => row.goodQty));
  return { quantity, goodQty, firstPassRate: quantity ? new Prisma.Decimal(goodQty).div(quantity).times(100).toNumber() : null };
}
export function executionSummary(plan: ExecutionPlan) {
  const active = plan.tasks.filter((task) => task.status !== 'cancelled');
  // This is reported output, not quality release or warehouse posting.
  const reportedWholeQty = executionSum(active.filter((task) => task.output === 'whole').flatMap((task) => task.reports.map((row) => row.quantity)));
  const reportedWholeGoodQty = executionSum(active.filter((task) => task.output === 'whole').flatMap((task) => task.reports.map((row) => row.goodQty)));
  const completed = active.filter(task => task.output === 'whole').flatMap(completionInspections);
  const completedQty = executionSum(completed.map(row => executionSum([row.goodQty, row.verifiedGoodQty ?? 0])));
  const legacyCompletedQty = executionSum(completed.filter(row => executionInspectionKind(row) === 'legacy').map(row => executionSum([row.goodQty, row.verifiedGoodQty ?? 0])));
  return { batchQty: executionSum(plan.batches.map((batch) => batch.quantity)), reportedWholeQty, reportedWholeGoodQty,
    completedQty, legacyCompletedQty, finalCompletedQty: executionSum([completedQty, -legacyCompletedQty]), firstFinal: executionFinalInspectionSummary(active),
    remainingQty: Math.max(0, plan.targetQty - completedQty), remainingReportedQty: Math.max(0, plan.targetQty - reportedWholeGoodQty), tasks: active.length };
}
export function executionTaskProgress(task: ExecutionTask) {
  const reported = executionSum(task.reports.map((row) => row.quantity)), good = executionSum(task.reports.map((row) => row.goodQty));
  return { reported, good, defective: executionSum([reported, -good]), remaining: Math.max(0, task.quantity - good), reportedPercent: task.quantity ? reported / task.quantity * 100 : 0, goodPercent: task.quantity ? good / task.quantity * 100 : 0 };
}

/** Pure business transitions. Actor identity, material identities and ownership are checked by the service. */
export function applyExecutionCommand(plan: ExecutionPlan, command: ExecutionCommand, actor: { id: string; name: string }, owner?: { id: string; name: string }) {
  if (command.version !== plan.version) throw new ConflictException('计划已更新，请保留草稿并重新载入');
  const data = command.data;
  const reason = executionText(data.reason, '操作依据', 2000);
  let subjectId = plan.id;
  let adjustment: ExecutionEvent['adjustment'];
  if (command.action === 'targets') {
    const targetQty = executionQty(data.targetQty, '生产目标', true, true), shipmentTargetQty = executionQty(data.shipmentTargetQty, '发货目标', false, true);
    if (targetQty < executionSum(plan.batches.map((batch) => batch.quantity))) throw new BadRequestException('生产目标不能小于已确认批次数量');
    plan.targetQty = targetQty; plan.shipmentTargetQty = shipmentTargetQty;
  } else if (command.action === 'batch') {
    const code = executionText(data.code, '批次编号', 80), quantity = executionQty(data.quantity, '批次数量', true, true), dueDate = executionDay(data.dueDate, '批次交期');
    if (dueDate.slice(0, 7) !== plan.month) throw new BadRequestException('批次交期须属于计划月份');
    if (plan.batches.some((batch) => batch.code.toLowerCase() === code.toLowerCase())) throw new ConflictException('本计划已存在同名批次');
    if (executionSum([...plan.batches.map((batch) => batch.quantity), quantity]) > plan.targetQty) throw new BadRequestException('批次合计不能超过已确认生产目标');
    subjectId = randomUUID(); plan.batches.push({ id: subjectId, code, quantity, dueDate });
  } else if (command.action === 'task') {
    const batch = plan.batches.find((row) => row.id === data.batchId);
    if (!batch) throw new BadRequestException('批次不属于当前计划');
    if (!owner) throw new BadRequestException('请选择有效的现场负责人');
    const output = data.output;
    if (output !== 'whole' && output !== 'component') throw new BadRequestException('请选择整机或组件产出');
    const quantity = executionQty(data.quantity, '派工数量', true, output === 'whole');
    if (output === 'whole' && executionSum([quantity, ...plan.tasks.filter((row) => row.batchId === batch.id && row.output === 'whole' && row.status !== 'cancelled').map((row) => row.quantity)]) > batch.quantity) throw new BadRequestException('整机派工合计不能超过批次目标');
    const date = executionDay(data.date, '作业日期');
    if (date > batch.dueDate) throw new BadRequestException('作业日期不能晚于批次交期');
    if (!Array.isArray(data.materials) || data.materials.length > 2000) throw new BadRequestException('领料明细无效');
    const seen = new Set<string>();
    const materials = data.materials.map((input: unknown) => {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('领料明细无效');
      const row = input as Record<string, unknown>, line = plan.bom.find((item) => item.code === row.code);
      if (!line || seen.has(line.code)) throw new BadRequestException('领料物料须来自本计划 BOM，同一编码只能出现一次');
      seen.add(line.code);
      const qtyPer = executionQty(row.qtyPer, '每件领料用量', true);
      return { ...line, qtyPer, requiredQty: executionQty(new Prisma.Decimal(qtyPer).times(quantity).toNumber(), '领料数量', true) };
    });
    if (materials.length === 0) throw new BadRequestException('请确认本工序所需的 BOM 物料与单位用量');
    subjectId = randomUUID();
    plan.tasks.push({ id: subjectId, batchId: batch.id, name: executionText(data.name, '作业名称'), treeNodeId: executionText(data.treeNodeId, '所属子系统'),
      output, unit: output === 'whole' ? '台' : executionText(data.unit, '组件产出单位', 20), quantity, date, line: executionText(data.line, '产线或工位', 80),
      ownerId: owner.id, ownerName: owner.name, materials, status: 'draft', reports: [] });
  } else {
    const task = plan.tasks.find((row) => row.id === data.taskId);
    if (!task) throw new BadRequestException('作业不属于当前计划');
    subjectId = task.id;
    if (command.action === 'dispatch') {
      if (task.status !== 'draft') throw new ConflictException('该作业已派发或取消');
      task.status = 'dispatched';
    } else if (command.action === 'adjust') {
      if (task.status === 'cancelled') throw new ConflictException('已取消作业不能调整');
      if (!owner) throw new BadRequestException('请选择有效的现场负责人');
      const batch = plan.batches.find(row => row.id === task.batchId)!;
      const date = executionDay(data.date, '调整后作业日期'), line = executionText(data.line, '产线或工位', 80);
      if (date < `${plan.month}-01` || date > batch.dueDate) throw new BadRequestException('调整后日期须在计划月初至批次交期之间');
      const quantity = executionQty(data.quantity, '调整后数量', true, task.output === 'whole');
      const reportedQty = executionSum(task.reports.map(row => row.quantity));
      if (quantity < reportedQty) throw new BadRequestException('调整后数量不能低于累计已报工数量');
      if (task.output === 'whole' && executionSum([quantity, ...plan.tasks.filter(row => row.id !== task.id && row.batchId === task.batchId && row.output === 'whole' && row.status !== 'cancelled').map(row => row.quantity)]) > batch.quantity) throw new BadRequestException('整机派工合计不能超过批次目标');
      const snapshot = ({ date, line, ownerId, ownerName, quantity }: ExecutionTask) => ({ date, line, ownerId, ownerName, quantity });
      const before = snapshot(task), after = { date, line, ownerId: owner.id, ownerName: owner.name, quantity };
      if (JSON.stringify(before) === JSON.stringify(after)) throw new BadRequestException('作业安排没有变化');
      const materials = task.materials.map(row => ({ ...row, requiredQty: executionQty(new Prisma.Decimal(row.qtyPer).times(quantity).toNumber(), '调整后领料需求', true) }));
      adjustment = { before, after, reportedQty };
      Object.assign(task, after, { materials });
    } else if (command.action === 'cancel') {
      if (task.reports.length || task.status === 'cancelled') throw new ConflictException('已有报工或已取消的作业不能直接取消');
      task.status = 'cancelled';
    } else if (command.action === 'inspect') {
      if (task.status !== 'dispatched') throw new ConflictException('作业尚未派发');
      const report = task.reports.find((row) => row.id === data.reportId);
      if (!report) throw new BadRequestException('报工记录不属于当前作业');
      const kind = data.kind;
      if (kind !== 'process' && kind !== 'final') throw new BadRequestException('请选择过程检或终检；历史未分类记录不能作为新检验类型');
      const process = executionText(data.process, '检验工序', 100);
      const sipDocument = task.basis?.documents?.find(row => row.kind === 'sip');
      const dispatchedSip = task.basis?.sip?.trim() || (sipDocument ? `${sipDocument.name} ${sipDocument.version}` : '');
      const sip: NonNullable<ExecutionInspection['sip']> = dispatchedSip
        ? { text: dispatchedSip, source: 'dispatch', packageId: task.basis!.packageId, ...(sipDocument ? { document: { ...sipDocument } } : {}) }
        : { text: executionText(data.sip, 'SIP 检验依据', 2000), source: 'manual' };
      const quantity = executionQty(data.quantity, '本次初检数量', true, task.output === 'whole'), goodQty = executionQty(data.goodQty, '初检合格数量', false, task.output === 'whole');
      if (goodQty > quantity) throw new BadRequestException('初检合格数不能超过检验数');
      const previous = (task.inspections ?? []).filter(row => row.reportId === report.id && (kind === 'final' ? executionInspectionKind(row) !== 'process' : row.kind === 'process' && row.process === process));
      if (executionSum([quantity, ...previous.map(row => row.quantity)]) > report.quantity) throw new BadRequestException('同工序过程检或终检累计不能超过本次报工数；历史未分类记录占用终检数量，复验请在原质量异常中办理');
      const date = executionDay(data.date, '初检日期');
      if (date < report.date || date > executionToday()) throw new BadRequestException('检验日期须在报工日期至今天之间');
      if (goodQty < quantity) executionText(data.issue, '不良现象', 2000);
      const inspection: ExecutionInspection = { id: randomUUID(), reportId: report.id, kind, process, sip, date, quantity, goodQty, evidence: reason, actorId: actor.id, actorName: actor.name, at: new Date().toISOString(), qualityId: null };
      (task.inspections ??= []).push(inspection); subjectId = inspection.id;
    } else if (command.action === 'report') {
      if (task.status !== 'dispatched') throw new ConflictException('请先派发作业');
      const quantity = executionQty(data.quantity, '本次产量', true, task.output === 'whole'), goodQty = executionQty(data.goodQty, '本次良品数', false, task.output === 'whole');
      if (goodQty > quantity) throw new BadRequestException('良品数不能超过本次产量');
      if (executionSum([quantity, ...task.reports.map((row) => row.quantity)]) > task.quantity) throw new BadRequestException('累计报工不能超过派工数量，请先由计划员核对');
      const date = executionDay(data.date, '报工日期');
      if (date > executionToday() || date < task.date) throw new BadRequestException('报工日期须在作业日期至今天之间');
      task.reports.push({ id: randomUUID(), date, quantity, goodQty, note: reason, actorId: actor.id, actorName: actor.name, at: new Date().toISOString() });
    } else throw new BadRequestException('不支持的计划操作');
  }
  const event: ExecutionEvent = { id: randomUUID(), action: command.action, reason, actorId: actor.id, actorName: actor.name, at: new Date().toISOString(), subjectId, ...(adjustment ? { adjustment } : {}) };
  plan.version += 1; plan.events.push(event);
  return event;
}
