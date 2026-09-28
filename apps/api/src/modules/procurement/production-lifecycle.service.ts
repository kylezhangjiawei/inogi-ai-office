import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import type { ProcActor } from './procurement.types';
import { OssService } from '../oss/oss.service';
import { documentOptions, resolveControlledDocuments, verifyControlledFiles, versionRangeValues, type BatchVersionRange, type ControlledDocument, type EcnFeedback } from './production-lifecycle-records';
import { completionInspections, executionDay, executionQty, executionText, executionToday, type ExecutionPlan } from './production-execution.model';
import { sampleTestOf } from './sample-test';
import { effectiveVerificationQuantity, type QualityVerificationEntry } from './quality-verification.service';
import { guardShippedSerialRange, shipmentSerialSummary, shipmentSerialValues, updateShipmentSerialClaims, type ShipmentSerial, type ShipmentSerialHistory } from './production-shipment-serials';

export const lifecycleKey = (id: string) => `procurement:lifecycle:v1:plan:${id}`;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Evidence = { sop: string; sip: string; drawing: string; evidence: string; documents?: ControlledDocument[] };
type Transfer = Evidence & { id: string; code: string; type: 'exploration' | 'validation'; sampleTaskId: string; roundId: string; status: 'draft' | 'validated' | 'published'; authorId: string; validatorId?: string; validation?: string; publishedAt?: string };
type Change = { previousPackageIds?: string[]; feedback?: EcnFeedback[]; id: string; code: string; packageId: string; batchIds: string[]; effectiveDate: string; handling: string; validation: string; status: 'draft' | 'published'; authorId: string; acknowledgments: { actorId: string; actorName: string; at: string }[] };
export interface LifecycleState {
  version: number; transfers: Transfer[]; changes: Change[]; versionRanges?: BatchVersionRange[];
  releases: { id: string; batchId: string; quantity: number; source: string; actorId: string; actorName: string; at: string; evidence: string }[];
  shipments: { id: string; batchId: string; releaseId: string; quantity: number; date: string; order: string; voucher: string; recipient: string; evidence: string; actorId: string; actorName: string; serials?: ShipmentSerial[]; serialHistory?: ShipmentSerialHistory[]; reversed?: { actorName: string; at: string; reason: string } }[];
  events: { id: string; action: string; actorName: string; at: string; reason: string; subjectId: string }[];
}
export const emptyLifecycle = (): LifecycleState => ({ version: 0, transfers: [], changes: [], releases: [], shipments: [], events: [] });
export async function loadLifecycle(db: Prisma.TransactionClient, planId: string): Promise<LifecycleState> { const row = await db.runtimeState.findUnique({ where: { key: lifecycleKey(planId) } }); return row ? JSON.parse(row.value) : emptyLifecycle(); }
export async function productionBasis(db: Prisma.TransactionClient, plan: ExecutionPlan, batchId: string, ownerId: string, plannedDate = executionToday()) {
  const state = await loadLifecycle(db, plan.id);
  const changes = state.changes.filter(row => row.status === 'published' && row.batchIds.includes(batchId) && row.effectiveDate <= plannedDate);
  const previousBasis = plan.tasks.find(task => task.batchId === batchId && task.basis)?.basis;
  const packageId = changes.at(-1)?.packageId ?? previousBasis?.packageId;
  const pkg = packageId ? state.transfers.find(row => row.id === packageId) : [...state.transfers].reverse().find(row => row.status === 'published' && row.type === 'validation');
  if (!pkg || pkg.status !== 'published') throw new ConflictException('派工前须发布经过独立验证的转量产资料包');
  if (changes.some(row => row.feedback?.some(feedback => feedback.status !== 'resolved'))) throw new ConflictException('本批次适用 ECN 尚有未处理的执行反馈，请先完成处理');
  if (changes.some(row => !row.acknowledgments.some(ack => ack.actorId === ownerId))) throw new ConflictException('现场负责人尚未确认本批次适用 ECN，请先阅读并确认');
  return { documents: pkg.documents ? structuredClone(pkg.documents) : undefined, packageId: pkg.id, code: pkg.code, sop: pkg.sop, sip: pkg.sip, drawing: pkg.drawing, sampleTaskId: pkg.sampleTaskId, roundId: pkg.roundId, changeIds: changes.map(row => row.id), at: new Date().toISOString() };
}
@Injectable()
export class ProductionLifecycleService {
  constructor(private readonly prisma: PrismaService, @Optional() private readonly oss?: OssService) {}
  private access(actor: ProcActor, action?: string) {
    if (!actor.id || (!actor.permissions.includes('*') && (!actor.permissions.includes('page:production-execution') || (action && !actor.permissions.includes(action))))) throw new ForbiddenException('没有办理该生产生命周期业务的权限');
  }
  async read(planId: string, actor: ProcActor) {
    this.access(actor);
    const row = await this.prisma.runtimeState.findUnique({ where: { key: `procurement:execution:v1:plan:${planId}` } });
    if (!row) throw new NotFoundException('生产计划不存在');
    const plan: ExecutionPlan = JSON.parse(row.value);
    const all = actor.permissions.includes('*') || ['production:plan', 'production:view-all', 'production:inspect', 'production:transfer', 'production:release', 'production:ship', 'proc-quality:manage', 'proc-quality:verify'].some(code => actor.permissions.includes(code));
    const state = await loadLifecycle(this.prisma, planId);
    const assignedBatches = new Set(state.changes.filter(change => change.feedback?.some(feedback => feedback.ownerId === actor.id || feedback.reporterId === actor.id)).flatMap(change => change.batchIds));
    if (!all && !plan.tasks.some(task => task.ownerId === actor.id) && !assignedBatches.size) throw new ForbiddenException('仅可查看本人参与批次');
    const batches = await Promise.all(plan.batches.filter(batch => all || assignedBatches.has(batch.id) || plan.tasks.some(task => task.batchId === batch.id && task.ownerId === actor.id)).map(async batch => {
      const result = await this.batchQuality(this.prisma, plan, batch.id);
      const latest = [...state.releases].reverse().find(row => row.batchId === batch.id && row.source === result.source);
      return { ...batch, ...result, releasedQty: latest?.quantity ?? 0, releaseId: latest?.id ?? null, shippedQty: state.shipments.filter(row => row.batchId === batch.id && !row.reversed).reduce((sum, row) => sum + row.quantity, 0), tasks: plan.tasks.filter(task => task.batchId === batch.id) };
    }));
    const sampleTasks = all ? await this.prisma.procTask.findMany({ where: { treeNode: { productId: plan.productId } }, select: { id: true, materialName: true, metadata: true, code: true }, orderBy: { updatedAt: 'desc' } }) : [];
    const batchIds = new Set(batches.map(row => row.id));
    const relatedRows = await this.prisma.runtimeState.findMany({ where: { OR: [{ key: { startsWith: 'procurement:warehouse-flow:v1:issue:' } }, { key: { startsWith: 'procurement:warehouse-record:v1:record:' } }] } });
    const warehouse = relatedRows.map(row => JSON.parse(row.value)).filter(row => row.planId === planId && batchIds.has(row.batchId));
    const qualityIds = batches.flatMap(batch => batch.tasks.flatMap(task => [...(task.inspections ?? []).flatMap(row => row.qualityId ? [row.qualityId] : []), ...(task.fieldIssues ?? []).map(row => row.qualityId)]));
    const qualityRecords = qualityIds.length ? await this.prisma.procQualityRecord.findMany({ where: { id: { in: qualityIds } } }) : [];
    const verificationHistory = qualityIds.length ? (await this.prisma.runtimeState.findMany({ where: { OR: qualityIds.map(id => ({ key: { startsWith: `procurement:quality-verification:v1:${id}:` } })) }, orderBy: { updatedAt: 'asc' } })).map(row => { const { fingerprint: _signature, ...entry } = JSON.parse(row.value); return entry; }) : [];
    const visibleChanges = state.changes.filter(row => row.batchIds.some(id => batchIds.has(id)));
    const visiblePackages = new Set([...visibleChanges.flatMap(row => [row.packageId, ...(row.previousPackageIds ?? [])]), ...batches.flatMap(batch => batch.tasks.flatMap(task => task.basis ? [task.basis.packageId] : []))]);
    const handlers = (await this.prisma.user.findMany({ where: { status: 'ACTIVE' }, select: { id: true, name: true, role: { select: { permissions: true } } }, orderBy: { name: 'asc' } })).filter(row => this.canHandle(row.role?.permissions, plan, row.id)).map(row => ({ id: row.id, name: row.name }));
    const sampleOptions = await Promise.all(sampleTasks.map(async task => { const sample = sampleTestOf(task.metadata); return sample ? { id: task.id, title: task.materialName, code: task.code, roundId: sample.roundId, result: sample.result, documents: await documentOptions(this.prisma, task.metadata) } : null; }));
    return { ...state, handlers, versionRanges: (state.versionRanges ?? []).filter(row => batchIds.has(row.batchId)), transfers: state.transfers.filter(row => all || visiblePackages.has(row.id)), releases: state.releases.filter(row => batchIds.has(row.batchId)), shipments: state.shipments.filter(row => batchIds.has(row.batchId)).map(row => ({ ...row, ...shipmentSerialSummary(row) })), changes: state.changes.filter(row => row.batchIds.some(id => batchIds.has(id))), events: all ? state.events : [], batches,
      warehouse, qualityRecords, verificationHistory,
      sampleTasks: sampleOptions.filter(row => row !== null) };
  }
  private canHandle(permissions: unknown, plan: ExecutionPlan, userId: string) { return Array.isArray(permissions) && (permissions.includes('*') || (permissions.includes('page:production-execution') && (['production:plan', 'production:view-all', 'production:inspect', 'production:transfer', 'production:release', 'production:ship', 'proc-quality:manage', 'proc-quality:verify'].some(code => permissions.includes(code)) || plan.tasks.some(task => task.ownerId === userId)))); }
  private async handler(db: Prisma.TransactionClient, value: unknown, plan: ExecutionPlan) {
    const owner = await db.user.findFirst({ where: { id: executionText(value, '经办人'), status: 'ACTIVE' }, select: { id: true, name: true, role: { select: { permissions: true } } } });
    if (!owner || !this.canHandle(owner.role?.permissions, plan, owner.id)) throw new BadRequestException('经办人已停用或没有查看生产业务的权限');
    return owner;
  }
  async document(planId: string, versionId: string, actor: ProcActor) {
    const view = await this.read(planId, actor);
    const references = [...view.transfers.flatMap(row => row.documents ?? []), ...view.sampleTasks.flatMap(row => row.documents), ...view.batches.flatMap(batch => batch.tasks.flatMap(task => task.basis?.documents ?? []))];
    if (!references.some(row => row.versionId === versionId)) throw new ForbiddenException('该文件不属于当前可见的生产依据');
    const version = await this.prisma.rdTechnicalDocumentVersion.findUnique({ where: { id: versionId } });
    if (!version) throw new NotFoundException('受控文件版本不存在');
    let url = version.fileUrl, downloadUrl = url;
    if (version.fileKey) {
      url = this.oss?.buildInlinePreviewUrl(version.fileKey) ?? ''; downloadUrl = this.oss?.getArchiveDownloadUrl(version.fileKey, version.fileName) ?? url;
    } else if (url.startsWith('data:')) {
      if (!this.oss) throw new ConflictException('文件预览服务暂不可用');
      const { exp, sig } = this.oss.signPreviewToken('rd-tech-doc:' + version.id, 600);
      url = '/api/research-development/technical-document-files/' + encodeURIComponent(version.id) + '?' + new URLSearchParams({ exp: String(exp), sig }); downloadUrl = url + '&dl=1';
    }
    if (!url) throw new ConflictException('文件暂不可用，请稍后重试');
    return { id: version.id, name: version.fileName, mime: version.mimeType, url, previewUrl: url, downloadUrl };
  }
  private async batchQuality(db: Prisma.TransactionClient, plan: ExecutionPlan, batchId: string) {
    const tasks = plan.tasks.filter(task => task.batchId === batchId && task.status !== 'cancelled'), whole = tasks.filter(task => task.output === 'whole');
    const ids = tasks.flatMap(task => [...(task.inspections ?? []).flatMap(row => row.qualityId ? [row.qualityId] : []), ...(task.fieldIssues ?? []).map(row => row.qualityId)]);
    const qualities = ids.length ? await db.procQualityRecord.findMany({ where: { id: { in: ids } } }) : [];
    const entries = ids.length ? (await db.runtimeState.findMany({ where: { OR: ids.map(id => ({ key: { startsWith: `procurement:quality-verification:v1:${id}:` } })) }, orderBy: { updatedAt: 'desc' } })).map(row => JSON.parse(row.value) as QualityVerificationEntry) : [];
    let completed = new Prisma.Decimal(0);
    for (const task of whole) for (const inspection of completionInspections(task)) {
      const quality = qualities.find(row => row.id === inspection.qualityId), entry = entries.find(row => row.recordId === inspection.qualityId);
      completed = completed.plus(inspection.goodQty).plus(quality && ['rework', 'replacement', 'concession'].includes(quality.disposition) ? effectiveVerificationQuantity(entry, quality) : 0);
    }
    const openQuality = qualities.filter(row => row.status !== 'closed').length + ids.filter(id => !qualities.some(row => row.id === id)).length;
    const uninspected = tasks.some(task => task.reports.reduce((sum, row) => sum + row.quantity, 0) > completionInspections(task).reduce((sum, row) => sum + row.quantity, 0));
    return { completedQty: completed.toNumber(), openQuality, uninspected, source: hash([tasks, qualities.map(row => [row.id, row.status, row.updatedAt]), entries]) };
  }
  async command(planId: string, input: { action: string; requestId: string; version: number; data: Record<string, unknown> }, actor: ProcActor) {
    const permission: Record<string, string | undefined> = { transfer: 'production:transfer', 'validate-transfer': 'production:release', 'publish-transfer': 'production:transfer', ecn: 'production:transfer', 'publish-ecn': 'production:transfer', acknowledge: undefined, 'ecn-feedback': undefined, 'handle-ecn-feedback': undefined, 'version-range': 'production:transfer', release: 'production:release', ship: 'production:ship', 'bind-shipment-sns': 'production:ship', 'reverse-shipment': 'production:ship' };
    if (!Object.prototype.hasOwnProperty.call(permission, input.action) || !/^[A-Za-z0-9_-]{16,128}$/.test(input.requestId)) throw new BadRequestException('生产操作无效');
    this.access(actor, permission[input.action]);
    const reason = executionText(input.data.reason, '依据', 2000), key = lifecycleKey(planId), requestKey = `procurement:lifecycle:v1:request:${input.requestId}`, signature = hash([actor.id, planId, input]);
    try { return await this.prisma.$transaction(async db => {
      const previous = await db.runtimeState.findUnique({ where: { key: requestKey } });
      if (previous) { if (previous.value !== signature) throw new ConflictException('提交标识已用于其他内容'); return { saved: true }; }
      const planRow = await db.runtimeState.findUnique({ where: { key: `procurement:execution:v1:plan:${planId}` } });
      if (!planRow) throw new NotFoundException('生产计划不存在');
      const plan: ExecutionPlan = JSON.parse(planRow.value), stored = await db.runtimeState.findUnique({ where: { key } }), state: LifecycleState = stored ? JSON.parse(stored.value) : emptyLifecycle();
      if (state.version !== input.version) throw new ConflictException('业务记录已更新，请保留草稿后重新核对');
      const data = input.data, at = new Date().toISOString(); let subjectId: string = randomUUID();
      if (input.action === 'transfer') {
        if (!['exploration', 'validation'].includes(String(data.type))) throw new BadRequestException('请选择探索或转量产验证');
        const task = await db.procTask.findUnique({ where: { id: executionText(data.sampleTaskId, '样品任务') }, include: { treeNode: true } }), sample = task ? sampleTestOf(task.metadata) : null;
        if (!task || task.treeNode?.productId !== plan.productId || !sample || sample.roundId !== data.roundId) throw new ConflictException('样品轮次或产品归属已变化');
        const code = executionText(data.code, '资料包版本');
        if (state.transfers.some(row => row.code === code)) throw new ConflictException('资料包版本不可重复，请建立新版本');
        const documents = await resolveControlledDocuments(db, task.metadata, data.documents, data.type === 'validation');
        state.transfers.push({ documents, id: subjectId, code, type: data.type as Transfer['type'], sampleTaskId: task.id, roundId: sample.roundId, status: 'draft', authorId: actor.id,
          sop: documents.find(row => row.kind === 'sop')?.version || executionText(data.sop, 'SOP 编号、版本及文件依据', 1000), sip: documents.find(row => row.kind === 'sip')?.version || executionText(data.sip, 'SIP 编号、版本及文件依据', 1000), drawing: documents.find(row => row.kind === 'drawing')?.version || executionText(data.drawing, '图纸 / BOM 版本及文件依据', 1000), evidence: reason });
      } else if (input.action === 'validate-transfer' || input.action === 'publish-transfer') {
        const pkg = state.transfers.find(row => row.id === data.id); if (!pkg) throw new NotFoundException('资料包不存在'); subjectId = pkg.id;
        if (pkg.type !== 'validation') throw new BadRequestException('探索样品不能发布为量产依据');
        await verifyControlledFiles(db, pkg.documents);
        if (input.action === 'validate-transfer') {
          const task = await db.procTask.findUnique({ where: { id: pkg.sampleTaskId } }), sample = task ? sampleTestOf(task.metadata) : null;
          if (pkg.status !== 'draft' || pkg.authorId === actor.id) throw new ForbiddenException('资料须由非编制人独立验证');
          if (!sample || sample.roundId !== pkg.roundId || sample.result !== 'passed' || !sample.finishedAt || !sample.confirmedAt) throw new ConflictException('样品本轮尚未完成并确认测试通过');
          if (data.documentsChecked !== true || data.productionValidated !== true) throw new BadRequestException('须确认 SOP / SIP / 图纸文件版本及实际转量产验证结果');
          pkg.validatorId = actor.id; pkg.validation = reason; pkg.status = 'validated';
        } else { if (pkg.status !== 'validated') throw new ConflictException('资料包尚未通过独立验证'); pkg.status = 'published'; pkg.publishedAt = at; }
      } else if (input.action === 'ecn') {
        const packageId = executionText(data.packageId, '替代资料包'), code = executionText(data.code, 'ECN 编号'), batchIds = Array.isArray(data.batchIds) ? [...new Set(data.batchIds.map(String))] : [];
        if (!state.transfers.some(row => row.id === packageId && row.status === 'published') || !batchIds.length || batchIds.some(id => !plan.batches.some(row => row.id === id))) throw new BadRequestException('请选择已发布资料包及明确的适用批次');
        if (state.changes.some(row => row.code === code)) throw new ConflictException('ECN 编号不可重复');
        const effectiveDate = executionDay(data.effectiveDate, '生效日期');
        const previousPackageIds = [...new Set(batchIds.flatMap(batchId => {
          const frozen = plan.tasks.filter(task => task.batchId === batchId && task.status !== 'cancelled' && task.basis).map(task => task.basis!.packageId);
          const effective = state.changes.filter(change => change.status === 'published' && change.batchIds.includes(batchId) && change.effectiveDate <= effectiveDate).at(-1)?.packageId;
          return [...frozen, ...(effective ? [effective] : [])];
        }))];
        state.changes.push({ previousPackageIds, feedback: [], id: subjectId, code, packageId, batchIds, effectiveDate, handling: executionText(data.handling, '旧料、在制与库存处置', 2000), validation: reason, status: 'draft', authorId: actor.id, acknowledgments: [] });
      } else if (input.action === 'publish-ecn' || input.action === 'acknowledge') {
        const change = state.changes.find(row => row.id === data.id); if (!change) throw new NotFoundException('ECN 不存在'); subjectId = change.id;
        if (input.action === 'publish-ecn') { if (change.status !== 'draft') throw new ConflictException('ECN 已发布'); await verifyControlledFiles(db, state.transfers.find(row => row.id === change.packageId)?.documents); change.status = 'published'; }
        else {
          if (change.status !== 'published' || !plan.tasks.some(task => change.batchIds.includes(task.batchId) && task.ownerId === actor.id)) throw new ForbiddenException('只有适用批次的现场负责人可确认阅读');
          if (change.acknowledgments.some(row => row.actorId === actor.id)) throw new ConflictException('已确认阅读');
          change.acknowledgments.push({ actorId: actor.id, actorName: actor.name, at });
        }
      } else if (input.action === 'ecn-feedback' || input.action === 'handle-ecn-feedback') {
        const change = state.changes.find(row => row.id === data.id);
        if (!change || change.status !== 'published') throw new ConflictException('仅已发布 ECN 可以反馈执行问题');
        subjectId = change.id;
        const manage = actor.permissions.includes('*') || actor.permissions.includes('production:transfer');
        if (input.action === 'ecn-feedback') {
          if (!manage && !plan.tasks.some(task => change.batchIds.includes(task.batchId) && task.ownerId === actor.id)) throw new ForbiddenException('仅适用批次负责人可反馈执行问题');
          const owner = await this.handler(db, data.ownerId, plan), dueDate = executionDay(data.dueDate, '处理期限');
          if (dueDate < executionToday()) throw new BadRequestException('新反馈处理期限不能早于今天');
          (change.feedback ??= []).push({ id: randomUUID(), problem: reason, reporterId: actor.id, reporterName: actor.name, at, ownerId: owner.id, ownerName: owner.name, dueDate, status: 'open', history: [{ actorId: actor.id, actorName: actor.name, at, ownerId: owner.id, ownerName: owner.name, dueDate, status: 'open', reason }] });
        } else {
          const feedback = change.feedback?.find(row => row.id === data.feedbackId);
          if (!feedback) throw new NotFoundException('执行反馈不存在');
          if (!manage && feedback.ownerId !== actor.id) throw new ForbiddenException('仅当前经办或转产管理人员可处理反馈');
          if (!['open', 'processing', 'resolved'].includes(String(data.status))) throw new BadRequestException('请选择反馈处理状态');
          const owner = await this.handler(db, data.ownerId, plan), dueDate = executionDay(data.dueDate, '处理期限');
          feedback.ownerId = owner.id; feedback.ownerName = owner.name; feedback.dueDate = dueDate; feedback.status = data.status as EcnFeedback['status'];
          feedback.history.push({ actorId: actor.id, actorName: actor.name, at, ownerId: owner.id, ownerName: owner.name, dueDate, status: feedback.status, reason });
        }
      } else if (input.action === 'version-range') {
        const batch = plan.batches.find(row => row.id === data.batchId); if (!batch) throw new BadRequestException('批次不属于当前计划');
        const ranges = state.versionRanges ??= [];
        const values = versionRangeValues(data, batch, ranges);
        guardShippedSerialRange(ranges.find(row => row.id === values.supersedesId), values, state.shipments);
        ranges.push({ ...values, id: subjectId, actorId: actor.id, actorName: actor.name, at, evidence: reason });
      } else if (input.action === 'bind-shipment-sns') {
        const shipment = state.shipments.find(row => row.id === data.id);
        if (!shipment || shipment.reversed) throw new ConflictException('发货不存在或已冲销，不能补录 SN');
        const serials = shipmentSerialValues(data.serialNumbers, shipment, state.versionRanges ?? [], state.shipments);
        if (!serials.length) throw new BadRequestException('请选择本次补录的已有 SN');
        await updateShipmentSerialClaims(db, planId, shipment.id, serials, true);
        (shipment.serials ??= []).push(...serials);
        (shipment.serialHistory ??= []).push({ action: 'bind', serials, actorId: actor.id, actorName: actor.name, at, reason });
        subjectId = shipment.id;
      } else if (input.action === 'release' || input.action === 'ship') {
        const batchId = executionText(data.batchId, '生产批次'), batch = plan.batches.find(row => row.id === batchId);
        if (!batch) throw new BadRequestException('批次不属于本计划');
        const quality = await this.batchQuality(db, plan, batchId);
        if (quality.openQuality || quality.uninspected) throw new ConflictException('存在未闭环异常或未完成初检的报工，不可放行或发货');
        const quantity = executionQty(data.quantity, input.action === 'release' ? '累计放行数量' : '本次发货数量', true, true);
        const shipped = state.shipments.filter(row => row.batchId === batchId && !row.reversed).reduce((sum, row) => sum + row.quantity, 0);
        if (input.action === 'release') {
          if (quantity > quality.completedQty || quantity < shipped) throw new ConflictException('放行须介于已发数量与当前检验合格整机数量之间');
          if (data.evidenceChecked !== true) throw new BadRequestException('须核对批次资料及质量放行依据');
          state.releases.push({ id: subjectId, batchId, quantity, source: quality.source, actorId: actor.id, actorName: actor.name, at, evidence: reason });
        } else {
          const release = [...state.releases].reverse().find(row => row.batchId === batchId && row.source === quality.source);
          if (!release || shipped + quantity > release.quantity) throw new ConflictException('发货超过当前有效放行未发数量，请核对或重新放行');
          const date = executionDay(data.date, '实际发货日期'); if (date > executionToday()) throw new BadRequestException('不能将未来计划计为实际发货');
          const voucher = executionText(data.voucher, '发货凭证号');
          const serials = shipmentSerialValues(data.serialNumbers, { id: subjectId, batchId, quantity }, state.versionRanges ?? [], state.shipments);
          const voucherKey = `procurement:lifecycle:v1:shipment-voucher:${hash(voucher.normalize('NFKC').toUpperCase())}`;
          if (await db.runtimeState.findUnique({ where: { key: voucherKey } })) throw new ConflictException('该发货凭证已登记，不能重复计入');
          await updateShipmentSerialClaims(db, planId, subjectId, serials, true);
          await db.runtimeState.create({ data: { key: voucherKey, value: subjectId } });
          state.shipments.push({ id: subjectId, batchId, releaseId: release.id, quantity, date, order: executionText(data.order, '销售订单 / 客户订单'), voucher, recipient: executionText(data.recipient, '收货客户'), evidence: reason, actorId: actor.id, actorName: actor.name, serials, serialHistory: serials.length ? [{ action: 'bind', serials, actorId: actor.id, actorName: actor.name, at, reason }] : [] });
        }
      } else {
        const shipment = state.shipments.find(row => row.id === data.id); if (!shipment || shipment.reversed) throw new ConflictException('发货不存在或已冲销');
        if (data.evidenceChecked !== true) throw new BadRequestException('须核对取消发货或实物退回的凭证，不可直接删除发货事实');
        await updateShipmentSerialClaims(db, planId, shipment.id, shipment.serials ?? [], false);
        (shipment.serialHistory ??= []).push({ action: 'reverse', serials: structuredClone(shipment.serials ?? []), actorId: actor.id, actorName: actor.name, at, reason });
        subjectId = shipment.id; shipment.reversed = { actorName: actor.name, at, reason };
      }
      state.version++; state.events.push({ id: randomUUID(), action: input.action, actorName: actor.name, at, reason, subjectId });
      if (stored) { const changed = await db.runtimeState.updateMany({ where: { key, value: stored.value }, data: { value: JSON.stringify(state) } }); if (changed.count !== 1) throw new ConflictException('业务记录已更新'); }
      else await db.runtimeState.create({ data: { key, value: JSON.stringify(state) } });
      await db.runtimeState.create({ data: { key: requestKey, value: signature } });
      await db.auditLog.create({ data: { module: 'procurement', source: 'web', action: `production.${input.action}`, resource: 'production-plan', resourceId: planId, userId: actor.id, actorName: actor.name, summary: reason, meta: { subjectId, version: state.version } } });
      return { saved: true };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); } catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2002'].includes(error.code)) throw new ConflictException('业务记录正在更新，请保留草稿后重试'); throw error; }
  }
}
