import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { ProcurementService } from './procurement.service';
import { BomRevisionsService } from './bom-revisions.service';
import { assertLegacyBom, legacyBasisAllows, legacyBasisFingerprint } from './production-execution.model';
import type { ProcActor } from './procurement.types';
import { applyExecutionCommand, completionInspections, executionDay, executionToday, executionFinalInspectionSummary, executionInspectionKind, executionMonth, executionQty, executionSummary, executionText, type ExecutionCommand, type ExecutionPlan } from './production-execution.model';
import type { WarehouseIssue } from './warehouse-flow.service';
import { emptyQualityAnalysis, QUALITY_ANALYSIS_PREFIX, qualityFiles, qualityPhenomena } from './quality-analysis';
import { effectiveVerificationQuantity, type QualityVerificationEntry } from './quality-verification.service';
import { warehouseReturns } from './warehouse-records.service';
import { productionBasis, type LifecycleState } from './production-lifecycle.service';
import { executionDashboard } from './production-dashboard.model';

export const EXECUTION_PREFIX = 'procurement:execution:v1:';
export const WAREHOUSE_PREFIX = 'procurement:warehouse-flow:v1:';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const planKey = (id: string) => `${EXECUTION_PREFIX}plan:${id}`;
const decode = (value: string) => JSON.parse(value) as ExecutionPlan;
const canReceive = (permissions: unknown, action: string) => Array.isArray(permissions) && (permissions.includes('*') || (permissions.includes('page:production-execution') && permissions.includes(action)));
@Injectable()
export class ProductionExecutionService {
  constructor(private readonly prisma: PrismaService, private readonly procurement: ProcurementService, private readonly bomRevisions: BomRevisionsService) {}
  private permission(actor: ProcActor, action?: string) {
    if (!actor.id || (!actor.permissions.includes('*') && (!actor.permissions.includes('page:production-execution') || (action && !actor.permissions.includes(action))))) throw new ForbiddenException('没有执行本生产操作的权限');
  }
  async options(actor: ProcActor) {
    this.permission(actor);
    const [nodes, models, users] = await Promise.all([
      this.prisma.procTaskTreeNode.findMany({ select: { id: true, productId: true, parentId: true, name: true }, orderBy: { sortOrder: 'asc' } }),
      this.prisma.procBomNode.findMany({ where: { parentId: null }, select: { id: true, name: true, productLine: true, productRootId: true, revisions: { where: { retiredAt: null }, select: { id: true, version: true }, orderBy: { version: 'desc' } } } }),
      this.prisma.user.findMany({ where: { status: 'ACTIVE' }, select: { id: true, name: true, department: true, role: { select: { permissions: true } } }, orderBy: { name: 'asc' } }),
    ]);
    return { nodes, devices: models, models: models.map((row) => row.productLine).filter(Boolean), users: users.map((row) => ({ id: row.id, name: row.name, department: row.department?.trim() || null, canReport: canReceive(row.role?.permissions, 'proc-production:report'), canCollaborate: canReceive(row.role?.permissions, 'proc-quality:collaborate') })).filter((row) => row.canReport || row.canCollaborate) };
  }
  async overview(month: string, actor: ProcActor) {
    executionMonth(month);
    if (!actor.id || !actor.permissions.some(code => ['*', 'page:rd-director-dashboard', 'page:production-execution'].includes(code))) throw new ForbiddenException('没有查看生产总览的权限');
    const all = actor.permissions.some(code => ['*', 'page:rd-director-dashboard', 'production:plan', 'production:view-all'].includes(code));
    const rows = await this.prisma.runtimeState.findMany({ where: { OR: [{ key: { startsWith: `${EXECUTION_PREFIX}plan:` } }, { key: { startsWith: 'procurement:lifecycle:v1:plan:' } }] } });
    const states = new Map(rows.filter(row => row.key.startsWith('procurement:lifecycle:')).map(row => [row.key.slice('procurement:lifecycle:v1:plan:'.length), JSON.parse(row.value) as LifecycleState]));
    const allPlans = rows.filter(row => row.key.startsWith(`${EXECUTION_PREFIX}plan:`)).map(row => decode(row.value));
    const plans = allPlans.filter(plan => plan.month <= month);
    const authorizedTasks = allPlans.flatMap(plan => plan.tasks.filter(task => task.status !== 'cancelled' && (all || task.ownerId === actor.id)).map(task => ({ ...task, planId: plan.id, month: plan.month, productLine: plan.productLine, batchCode: plan.batches.find(batch => batch.id === task.batchId)?.code, reportedQty: task.reports.reduce((sum, row) => sum + row.quantity, 0), goodQty: task.reports.reduce((sum, row) => sum + row.goodQty, 0) })));
    const tasks = authorizedTasks.filter(task => task.month <= month);
    const carriedTasks = tasks.filter(task => task.month < month);
    const qualityIds = carriedTasks.flatMap(task => [...(task.inspections ?? []).flatMap(row => row.qualityId ? [row.qualityId] : []), ...(task.fieldIssues ?? []).map(row => row.qualityId)]);
    const [quality, verificationRows] = qualityIds.length ? await Promise.all([
      this.prisma.procQualityRecord.findMany({ where: { id: { in: qualityIds } } }),
      this.prisma.runtimeState.findMany({ where: { OR: qualityIds.map(id => ({ key: { startsWith: `procurement:quality-verification:v1:${id}:` } })) }, orderBy: { updatedAt: 'desc' } }),
    ]) : [[], []];
    const qualityById = new Map(quality.map(row => [row.id, row]));
    const verifications = verificationRows.map(row => JSON.parse(row.value) as QualityVerificationEntry);
    // Carryover follows inspected output and quality closure; reported good quantities remain historical.
    const unfinished = new Set(carriedTasks.filter(task => {
      const inspections = task.inspections ?? [];
      const completedQty = completionInspections(task).reduce((sum, inspection) => {
        const record = inspection.qualityId ? qualityById.get(inspection.qualityId) : undefined;
        const latest = record ? verifications.find(row => row.recordId === record.id) : undefined;
        const verifiedGoodQty = record && ['rework', 'replacement', 'concession'].includes(record.disposition) ? Math.min(inspection.quantity - inspection.goodQty, effectiveVerificationQuantity(latest, record)) : 0;
        return sum + inspection.goodQty + verifiedGoodQty;
      }, 0);
      return task.status === 'draft' || completedQty < task.quantity || inspections.some(row => row.qualityId && qualityById.get(row.qualityId)?.status !== 'closed') || task.fieldIssues?.some(row => qualityById.get(row.qualityId)?.status !== 'closed');
    }).map(task => task.id));
    const actualShipments = all ? [...states.values()].flatMap(state => state.shipments.filter(row => !row.reversed && row.date.startsWith(month))) : [];
    return { month, scope: all ? 'all' : 'assigned', targetQty: all ? plans.filter(plan => plan.month === month).reduce((sum, plan) => sum + plan.targetQty, 0) : null,
      shipmentTargetQty: all ? plans.filter(plan => plan.month === month).reduce((sum, plan) => sum + plan.shipmentTargetQty, 0) : null,
      actualShippedQty: all ? actualShipments.reduce((sum, row) => sum + row.quantity, 0) : null,
      firstFinal: executionFinalInspectionSummary(tasks.map(task => ({ ...task, inspections: (task.inspections ?? []).filter(row => row.date.startsWith(month)) }))),
      dashboard: executionDashboard(authorizedTasks, month),
      tasks: tasks.filter(task => task.month === month || unfinished.has(task.id)),
      shipments: actualShipments.map(({ id, batchId, quantity, date, voucher, recipient }) => ({ id, batchId, quantity, date, voucher, recipient })) };
  }
  async bom(productLine: string, actor: ProcActor) {
    this.permission(actor);
    const result = await this.procurement.getInventoryReadiness({ productLine: executionText(productLine, 'BOM 型号'), targetSets: 0 });
    if (result.productLine !== productLine) throw new BadRequestException('BOM 型号不存在');
    return { items: result.items.map((row) => ({ id: row.id, code: row.code, name: row.name, unit: row.unit, qtyPer: row.qtyPer })), invalid: result.dataQuality.invalidBomLines };
  }
  async list(month: string, actor: ProcActor) {
    this.permission(actor); executionMonth(month);
    const rows = await this.prisma.runtimeState.findMany({ where: { key: { startsWith: `${EXECUTION_PREFIX}plan:` } }, orderBy: { key: 'asc' } });
    const plans = rows.map((row) => decode(row.value)).filter((plan) => plan.month <= month);
    const lifecycleRows = plans.length ? await this.prisma.runtimeState.findMany({ where: { key: { in: plans.map(plan => `procurement:lifecycle:v1:plan:${plan.id}`) } } }) : [];
    const lifecycles = new Map(lifecycleRows.map(row => [row.key, JSON.parse(row.value) as LifecycleState]));
    const hasUnfinishedShipping = (plan: ExecutionPlan) => (lifecycles.get(`procurement:lifecycle:v1:plan:${plan.id}`)?.shipments ?? []).filter(row => !row.reversed).reduce((sum, row) => sum + row.quantity, 0) < plan.shipmentTargetQty;
    const ids = [...new Set(plans.flatMap(plan => plan.tasks.flatMap(task => [...(task.inspections ?? []).flatMap(row => row.qualityId ? [row.qualityId] : []), ...(task.fieldIssues ?? []).map(row => row.qualityId)])))];
    const [quality, verificationRows, collaborationRows] = ids.length ? await Promise.all([
      this.prisma.procQualityRecord.findMany({ where: { id: { in: ids } }, include: { treeNode: { select: { name: true } } } }),
      this.prisma.runtimeState.findMany({ where: { OR: ids.map((id) => ({ key: { startsWith: `procurement:quality-verification:v1:${id}:` } })) }, orderBy: { updatedAt: 'desc' } }),
      this.prisma.runtimeState.findMany({ where: { key: { in: ids.map((id) => `${EXECUTION_PREFIX}collaboration:${id}`) } } }),
    ]) : [[], [], []];
    const qualityById = new Map(quality.map((row) => [row.id, row]));
    const verifications = verificationRows.map((row) => JSON.parse(row.value) as QualityVerificationEntry);
    const collaborations = new Map(collaborationRows.map((row) => [row.key, JSON.parse(row.value)]));
    const analysisRows = ids.length ? await this.prisma.runtimeState.findMany({ where: { key: { in: ids.map(id => QUALITY_ANALYSIS_PREFIX + id) } } }) : [];
    const analyses = new Map(analysisRows.map(row => [row.key.slice(QUALITY_ANALYSIS_PREFIX.length), JSON.parse(row.value)]));
    const canViewAll = actor.permissions.includes('*') || ['production:plan', 'production:view-all', 'production:inspect', 'production:transfer', 'production:release', 'production:ship', 'proc-quality:manage', 'proc-quality:verify'].some((permission) => actor.permissions.includes(permission));
    const views = await Promise.all(plans.map(async (plan) => {
      let basisVerified = legacyBasisAllows(plan, 'dispatch', {});
      const revision = plan.bomRevisionId ? await this.prisma.procBomRevision.findUnique({ where: { id: plan.bomRevisionId }, select: { version: true, retiredAt: true } }) : null;
      if (!plan.bomRevisionId && plan.legacyBasisReview && basisVerified) {
        const [device, root] = await Promise.all([
          this.prisma.procBomNode.findUnique({ where: { id: plan.legacyBasisReview.deviceId } }),
          this.prisma.procTaskTreeNode.findUnique({ where: { id: plan.legacyBasisReview.productRootId } }),
        ]);
        basisVerified = Boolean(device && !device.parentId && device.productRootId === root?.id && root && !root.parentId && root.productId === plan.productId);
      }
      const feedbackBatches = new Set((lifecycles.get(`procurement:lifecycle:v1:plan:${plan.id}`)?.changes ?? []).filter(change => change.feedback?.some(row => row.ownerId === actor.id || row.reporterId === actor.id)).flatMap(change => change.batchIds));
      const qualityView = (id: string) => { const record = qualityById.get(id); return record ? { ...record, analysis: analyses.get(record.id) ?? null, treeNode: undefined, treeNodeName: record.treeNode.name, taskCode: null, materialName: null, supplierName: null, stockPlanCode: null, inspectedQty: Number(record.inspectedQty), defectiveQty: Number(record.defectiveQty), inspectionDate: record.inspectionDate.toISOString().slice(0, 10), createdAt: record.createdAt.toISOString(), updatedAt: record.updatedAt.toISOString(), resolvedAt: record.resolvedAt?.toISOString() ?? null, collaboration: collaborations.get(`${EXECUTION_PREFIX}collaboration:${record.id}`) ?? null, defectRate: Number(record.defectiveQty) / Number(record.inspectedQty) * 100 } : null; };
      const tasks = plan.tasks.map((task) => ({ ...task, fieldIssues: (task.fieldIssues ?? []).map(row => ({ ...row, quality: qualityView(row.qualityId) })), inspections: (task.inspections ?? []).map((inspection) => {
        const record = inspection.qualityId ? qualityById.get(inspection.qualityId) : undefined;
        const latest = record ? verifications.find((row) => row.recordId === record.id) : undefined;
        const verifiedGoodQty = record && ['rework', 'replacement', 'concession'].includes(record.disposition) ? Math.min(inspection.quantity - inspection.goodQty, effectiveVerificationQuantity(latest, record)) : 0;
        return { ...inspection, kind: executionInspectionKind(inspection), verifiedGoodQty, quality: record ? { ...record, analysis: analyses.get(record.id) ?? null, treeNode: undefined, treeNodeName: record.treeNode.name,
          taskCode: null, materialName: null, supplierName: null, stockPlanCode: null, inspectedQty: Number(record.inspectedQty), defectiveQty: Number(record.defectiveQty),
          inspectionDate: record.inspectionDate.toISOString().slice(0, 10), createdAt: record.createdAt.toISOString(), updatedAt: record.updatedAt.toISOString(), resolvedAt: record.resolvedAt?.toISOString() ?? null,
          collaboration: collaborations.get(`${EXECUTION_PREFIX}collaboration:${record.id}`) ?? null,
          defectRate: Number(record.defectiveQty) / Number(record.inspectedQty) * 100 } : null };
      }) }));
      const visibleTasks = canViewAll ? tasks : tasks.filter((task) => feedbackBatches.has(task.batchId) || task.ownerId === actor.id || task.fieldIssues.some(row => row.quality?.collaboration && [row.quality.collaboration.ownerId, row.quality.collaboration.originatorId].includes(actor.id)) || task.inspections.some((row) => row.quality?.collaboration && [row.quality.collaboration.ownerId, row.quality.collaboration.originatorId].includes(actor.id)));
      const visibleBatches = canViewAll ? plan.batches : plan.batches.filter((batch) => feedbackBatches.has(batch.id) || visibleTasks.some((task) => task.batchId === batch.id));
      const subjectIds = new Set([plan.id, ...visibleBatches.map((row) => row.id), ...visibleTasks.map((row) => row.id), ...visibleTasks.flatMap(task => task.fieldIssues.map(row => row.qualityId)), ...visibleTasks.flatMap((task) => task.inspections.flatMap((inspection) => [inspection.id, inspection.qualityId].filter(Boolean)))]);
      return { ...plan, bomSourceFingerprint: hash(plan.bom), basisVerified, bomVersion: revision?.version, bomRetiredAt: revision?.retiredAt?.toISOString() ?? null, carryover: plan.month < month, tasks: visibleTasks, batches: visibleBatches, events: canViewAll ? plan.events : plan.events.filter((event) => subjectIds.has(event.subjectId)),
        scope: canViewAll ? 'all' as const : 'assigned' as const, summary: executionSummary({ ...plan, tasks: visibleTasks, batches: visibleBatches }) };
    }));
    return views.filter((plan) => (canViewAll || plan.tasks.length > 0 || plan.batches.length > 0) && (!plan.carryover || (lifecycles.get(`procurement:lifecycle:v1:plan:${plan.id}`)?.changes ?? []).some(change => change.feedback?.some(row => row.status !== 'resolved' && (row.ownerId === actor.id || row.reporterId === actor.id))) || plan.summary.remainingQty > 0 || hasUnfinishedShipping(plan) || plan.tasks.some((task) => task.status !== 'cancelled' && (task.status === 'draft' || task.fieldIssues.some(row => row.quality && row.quality.status !== 'closed') || task.inspections.some((row) => row.quality && row.quality.status !== 'closed') || task.quantity > completionInspections(task).reduce((sum, row) => sum + row.goodQty + (row.verifiedGoodQty ?? 0), 0)))));
  }
  async create(input: Record<string, unknown>, actor: ProcActor) {
    this.permission(actor, 'production:plan');
    const month = executionMonth(input.month), productId = executionText(input.productId, '产品');
    const deviceId = executionText(input.deviceId, '设备'), bomRevisionId = executionText(input.bomRevisionId, '已发布版本');
    const targetQty = executionQty(input.targetQty, '生产目标', true, true), shipmentTargetQty = executionQty(input.shipmentTargetQty, '发货目标', false, true);
    const reason = executionText(input.reason, '计划依据', 2000), requestId = this.requestId(input.requestId);
    const id = `${month}:${hash([productId, deviceId]).slice(0, 24)}`, key = planKey(id), requestKey = `${EXECUTION_PREFIX}request:${requestId}`;
    const fingerprint = hash([actor.id, 'create', month, productId, deviceId, bomRevisionId, targetQty, shipmentTargetQty, reason]);
    return this.write(async (db) => {
      await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`production-plan:${month}:${productId}:${deviceId}`}))::text`;
      if (await this.repeated(db, requestKey, fingerprint)) return { id };
      if (await db.runtimeState.findUnique({ where: { key } })) throw new ConflictException('该产品型号本月已有计划，请调整原计划，避免重复目标');
      await db.$queryRaw`SELECT pg_advisory_xact_lock_shared(hashtext('procurement-common-bom-lines'))::text`;
      const device = await db.procBomNode.findUnique({ where: { id: deviceId } });
      if (!device || device.parentId || !device.productRootId) throw new BadRequestException('设备尚未确认产品归属，请先在 BOM 页面核对');
      const roots = await db.procTaskTreeNode.findMany({ where: { id: device.productRootId, productId, parentId: null }, select: { id: true, name: true } });
      const root = roots.find(row => row.id === device.productRootId);
      if (!root) throw new BadRequestException('设备不属于所选产品，请重新选择');
      const revision = await this.bomRevisions.requireRevision(db, { productRootId: root.id, deviceId, revisionId: bomRevisionId });
      const previous = await db.runtimeState.findMany({ where: { key: { startsWith: `${EXECUTION_PREFIX}plan:${month}:` } } });
      for (const row of previous) {
        const prior = decode(row.value);
        if (prior.month !== month || prior.productId !== productId) continue;
        if (prior.deviceId === deviceId) throw new ConflictException('该设备本月已有计划，请办理原计划');
        if (!prior.deviceId && prior.productLine === revision.productLine) throw new ConflictException('该型号已有历史计划，请先在原计划核对执行依据');
      }
      const plan: ExecutionPlan = { id, version: 1, month, productId, productName: root.name, productLine: revision.productLine, deviceId, bomRevisionId, bomSnapshot: revision.snapshot, targetQty, shipmentTargetQty,
        bom: revision.snapshot.items, bomFingerprint: hash(revision.snapshot.items), batches: [], tasks: [],
        events: [{ id: randomUUID(), action: 'create', reason, actorId: actor.id, actorName: actor.name, at: new Date().toISOString(), subjectId: id }] };
      await db.runtimeState.create({ data: { key, value: JSON.stringify(plan) } });
      await this.record(db, plan, requestKey, fingerprint, actor);
      return { id };
    });
  }
  async command(id: string, input: ExecutionCommand, actor: ProcActor) {
    this.permission(actor, ['report', 'field-issue'].includes(input?.action) ? 'proc-production:report' : input?.action === 'inspect' ? 'production:inspect' : input?.action === 'reply-quality' ? 'proc-quality:collaborate' : ['disposition', 'assign-quality'].includes(input?.action) ? 'proc-quality:manage' : 'production:plan');
    const requestId = this.requestId(input?.requestId);
    if (!input || !Number.isSafeInteger(input.version) || input.version < 1 || !input.data || typeof input.data !== 'object' || Array.isArray(input.data)) throw new BadRequestException('计划版本或操作内容无效');
    const key = planKey(id), requestKey = `${EXECUTION_PREFIX}request:${requestId}`, fingerprint = hash([actor.id, id, input.version, input.action, input.data]);
    return this.write(async (db) => {
      if (await this.repeated(db, requestKey, fingerprint)) return { id };
      const stored = await db.runtimeState.findUnique({ where: { key } });
      if (!stored) throw new NotFoundException('生产计划不存在');
      const plan = decode(stored.value);
      if (!plan.bomRevisionId && !legacyBasisAllows(plan, input.action, input.data)) throw new ConflictException('历史执行依据待核对，请先在计划详情完成核对；已派发作业可继续报工、检验和退料');
      if (!plan.bomRevisionId && plan.legacyBasisReview && ['task', 'dispatch', 'targets', 'adjust'].includes(input.action)) {
        await db.$queryRaw`SELECT pg_advisory_xact_lock_shared(hashtext('procurement-common-bom-lines'))::text`;
        const device = await db.procBomNode.findUnique({ where: { id: plan.legacyBasisReview.deviceId } });
        const root = await db.procTaskTreeNode.findUnique({ where: { id: plan.legacyBasisReview.productRootId } });
        if (!device || device.parentId || device.productRootId !== root?.id || root?.parentId || root?.productId !== plan.productId) {
          const unreviewed = { ...plan, legacyBasisReview: undefined };
          if (!legacyBasisAllows(unreviewed, input.action, input.data)) throw new ConflictException('历史设备归属已变化，请重新核对执行依据');
        }
      }
      let owner: { id: string; name: string } | undefined;
      if (input.action === 'task' || input.action === 'adjust') {
        if (input.action === 'task') {
          const node = await db.procTaskTreeNode.findUnique({ where: { id: executionText(input.data.treeNodeId, '子系统') } });
          if (!node || !node.parentId || node.productId !== plan.productId) throw new BadRequestException('作业子系统不属于当前产品');
        }
        const candidate = await db.user.findFirst({ where: { id: executionText(input.data.ownerId, '现场负责人'), status: 'ACTIVE' }, select: { id: true, name: true, role: { select: { permissions: true } } } });
        if (candidate && canReceive(candidate.role?.permissions, 'proc-production:report')) owner = { id: candidate.id, name: candidate.name };
      }
      if (input.action === 'report') {
        const task = plan.tasks.find((row) => row.id === input.data.taskId);
        if (task && task.ownerId !== actor.id && !actor.permissions.includes('*') && !actor.permissions.includes('production:plan')) throw new ForbiddenException('仅作业负责人或计划员可提交此作业的报工');
        if (task) {
          const quantity = executionQty(input.data.quantity, '本次产量', true, task.output === 'whole');
          const total = task.reports.reduce((sum, report) => sum.plus(report.quantity), new Prisma.Decimal(quantity));
          const storedIssue = await db.runtimeState.findUnique({ where: { key: `${WAREHOUSE_PREFIX}issue:${task.id}` } });
          const lines: Array<{ code: string; signedQty?: number }> = storedIssue ? JSON.parse(storedIssue.value).lines : [];
          const returns = await warehouseReturns(db, task.id);
          for (const material of task.materials) {
            const signed = lines.find((line) => line.code === material.code)?.signedQty ?? 0;
            const returnedUnused = returns.filter(row => row.code === material.code && row.origin === 'unused').reduce((sum, row) => sum.plus(row.quantity), new Prisma.Decimal(0));
            if (total.times(material.qtyPer).gt(new Prisma.Decimal(signed).minus(returnedUnused))) throw new ConflictException(`${material.name}已签收数量不足以覆盖累计报工（已扣除未耗用退料），请先核对领退料与现场签收`);
          }
        }
      }
      if (input.action === 'cancel') {
        const warehouse = await db.runtimeState.findUnique({ where: { key: `${WAREHOUSE_PREFIX}issue:${input.data.taskId}` } });
        if (warehouse && JSON.parse(warehouse.value).status !== 'requested') throw new ConflictException('该作业已进入发料办理，请先核对领退料记录，不能直接取消');
        if (warehouse) await db.runtimeState.update({ where: { key: warehouse.key }, data: { value: JSON.stringify({ ...JSON.parse(warehouse.value), status: 'cancelled' }) } });
      }
      let event: ExecutionPlan['events'][number];

      if (input.action === 'field-issue') {
        if (input.version !== plan.version) throw new ConflictException('计划已更新，请重新核对');
        const task = plan.tasks.find(row => row.id === input.data.taskId);
        if (!task || task.status !== 'dispatched') throw new BadRequestException('请选择已派发的本计划作业');
        if (task.ownerId !== actor.id && !actor.permissions.includes('*') && !actor.permissions.includes('production:plan')) throw new ForbiddenException('仅作业负责人或计划员可提交现场不良');
        const report = task.reports.find(row => row.id === input.data.reportId);
        if (!report) throw new BadRequestException('报工记录不属于本作业');
        if ((task.inspections ?? []).some(row => row.reportId === report.id && row.qualityId)) throw new ConflictException('该报工已有检验异常，请在原质量异常补充证据，不能另建现场不良');
        const defectiveQty = executionQty(input.data.defectiveQty, '现场不良件数', true, task.output === 'whole');
        const recorded = (task.fieldIssues ?? []).filter(row => row.reportId === report.id).reduce((sum, row) => sum.plus(row.defectiveQty), new Prisma.Decimal(0));
        if (recorded.gt(0)) throw new ConflictException('该次报工已有现场异常，请沿原异常补充现象和证据');
        if (!new Prisma.Decimal(defectiveQty).eq(new Prisma.Decimal(report.quantity).minus(report.goodQty))) throw new BadRequestException('现场不良件数须与本次报工不良数一致；同一批实物的多个现象在原异常分别登记次数');
        const issue = executionText(input.data.issue, '不良现象', 2000), evidence = executionText(input.data.reason, '现场证据说明', 2000);
        const initialCause = input.data.initialCause == null ? 'unknown' : String(input.data.initialCause);
        if (!['unknown', 'material', 'software', 'assembly', 'other'].includes(initialCause)) throw new BadRequestException('初步原因选项无效');
        let requestedCollaboration: { department: string | null; ownerId: string; ownerName: string } | undefined;
        if (input.data.requestedCollaboration != null) {
          const requested = input.data.requestedCollaboration as Record<string, unknown>;
          const owner = await db.user.findFirst({ where: { id: executionText(requested.ownerId, '建议协同接收人'), status: 'ACTIVE' }, select: { id: true, name: true, department: true, role: { select: { permissions: true } } } });
          if (!owner || !canReceive(owner.role?.permissions, 'proc-quality:collaborate')) throw new BadRequestException('建议接收人已停用或没有协同权限，请重新选择');
          if (requested.department !== (owner.department?.trim() || null)) throw new ConflictException('建议接收人所属部门已变化，请重新选择');
          requestedCollaboration = { department: owner.department?.trim() || null, ownerId: owner.id, ownerName: owner.name };
        }
        const phenomena = qualityPhenomena(input.data.phenomena);
        if (!phenomena.length) throw new BadRequestException('请填写至少一项现象及发生次数');
        const files = await qualityFiles(db, input.data.fileIds ?? [], actor);
        const storedIssue = await db.runtimeState.findUnique({ where: { key: `${WAREHOUSE_PREFIX}issue:${task.id}` } });
        const received = storedIssue ? JSON.parse(storedIssue.value).lines as Array<{ code: string; signedQty?: number; signedBatches?: { batchNo: string; quantity: number }[] }> : [];
        if (!Array.isArray(input.data.materialBatches) || input.data.materialBatches.length > 2000) throw new BadRequestException('实际物料批次无效');
        const seen = new Set<string>();
        const materialBatches = input.data.materialBatches.map((row: any) => {
          const code = executionText(row?.code, '实领物料编码');
          const line = received.find(item => item.code === code);
          if (!task.materials.some(item => item.code === code) || !line || !(line.signedQty! > 0)) throw new BadRequestException('现场物料必须来自此作业已签收明细');
          const batchNo = row.batchNo ? executionText(row.batchNo, '实领批号', 120) : null;
          if (batchNo && !line.signedBatches?.some(item => item.batchNo === batchNo && item.quantity > 0)) throw new BadRequestException('所选批号不属于本作业实领批次，未知批次请标记待补');
          const identity = JSON.stringify([code, batchNo]); if (seen.has(identity)) throw new BadRequestException('实领批次不能重复'); seen.add(identity);
          return { code, batchNo };
        });
        const fieldId = randomUUID(), at = new Date().toISOString();
        const record = await db.procQualityRecord.create({ data: { productId: plan.productId, treeNodeId: task.treeNodeId, source: 'production', batchNo: `${plan.batches.find(row => row.id === task.batchId)!.code}/${fieldId}`, unit: task.unit, inspectionDate: new Date(`${report.date}T00:00:00.000Z`), inspectedQty: new Prisma.Decimal(report.quantity), defectiveQty: new Prisma.Decimal(defectiveQty), issue, disposition: 'pending', status: 'open', createdBy: actor.id, createdByName: actor.name } });
        (task.fieldIssues ??= []).push({ id: fieldId, qualityId: record.id, reportId: report.id, date: report.date, defectiveQty, issue, actorId: actor.id, actorName: actor.name, at, initialCause: initialCause as NonNullable<ExecutionPlan['tasks'][number]['fieldIssues']>[number]['initialCause'], ...(requestedCollaboration ? { requestedCollaboration } : {}), materialBatches });
        await db.runtimeState.create({ data: { key: `${EXECUTION_PREFIX}quality:${record.id}`, value: JSON.stringify({ planId: plan.id, taskId: task.id, fieldIssueId: fieldId, reportId: report.id, materialBatches }) } });
        const analysis = { ...emptyQualityAnalysis(), version: 1, phenomena, files, evidence, materialBatches, references: [{ source: 'production', reference: task.id, note: issue }] };
        await db.runtimeState.create({ data: { key: QUALITY_ANALYSIS_PREFIX + record.id, value: JSON.stringify(analysis) } });
        event = { id: randomUUID(), action: input.action, reason: evidence, actorId: actor.id, actorName: actor.name, at, subjectId: record.id };
        plan.events.push(event); plan.version++;
      } else if (['disposition', 'assign-quality', 'reply-quality'].includes(input.action)) {
        if (input.version !== plan.version) throw new ConflictException('计划已更新，请重新核对');
        const qualityId = executionText(input.data.qualityId, '质量异常');
        if (!plan.tasks.some((task) => task.inspections?.some((row) => row.qualityId === qualityId) || task.fieldIssues?.some(row => row.qualityId === qualityId))) throw new BadRequestException('质量异常不属于本计划');
        const record = await db.procQualityRecord.findUnique({ where: { id: qualityId } });
        if (!record || record.status === 'closed' || record.updatedAt.toISOString() !== input.data.baseUpdatedAt) throw new ConflictException('异常已关闭或已更新，请重新核对');
        const reason = executionText(input.data.reason, '处理依据', 2000);
        const collaborationKey = `${EXECUTION_PREFIX}collaboration:${qualityId}`;
        const savedCollaboration = await db.runtimeState.findUnique({ where: { key: collaborationKey } });
        const collaboration = savedCollaboration ? JSON.parse(savedCollaboration.value) : null;
        let assignmentName = '';
        let qualityUpdate: Prisma.ProcQualityRecordUpdateManyMutationInput = { status: 'processing', updatedBy: actor.id, updatedByName: actor.name };
        if (input.action === 'disposition') {
          const disposition = executionText(input.data.disposition, '处置方式');
          if (!['return', 'rework', 'scrap', 'concession', 'replacement'].includes(disposition)) throw new BadRequestException('处置方式无效');
          qualityUpdate = { ...qualityUpdate, disposition, resolution: reason };
        } else {
          let next: Record<string, unknown>;
          if (input.action === 'assign-quality') {
            const owner = await db.user.findFirst({ where: { id: executionText(input.data.ownerId, '协同处理人'), status: 'ACTIVE' }, select: { id: true, name: true, department: true, role: { select: { permissions: true } } } });
            if (!owner || !canReceive(owner.role?.permissions, 'proc-quality:collaborate')) throw new BadRequestException('协同处理人不存在、已停用或没有查看并回复异常的权限');
            if (input.data.department !== undefined && input.data.department !== (owner.department?.trim() || null)) throw new ConflictException('协同处理人所属部门已变化，请重新选择');
            const priority = input.data.priority == null ? 'medium' : String(input.data.priority);
            if (!['high', 'medium', 'low'].includes(priority)) throw new BadRequestException('协同优先级无效');
            assignmentName = owner.name;
            const dueDate = executionDay(input.data.dueDate, '协同期限');
            if (dueDate < executionToday()) throw new BadRequestException('协同期限不能早于今天');
            const requiredInfo = executionText(input.data.requiredInfo, '待补资料', 2000), verificationPlan = executionText(input.data.verificationPlan, '验证安排', 2000);
            next = { ownerId: owner.id, ownerName: owner.name, department: owner.department?.trim() || null, priority, originatorId: actor.id, originatorName: actor.name, phase: 'waiting_reply', reason, dueDate, requiredInfo, verificationPlan, reply: null, at: new Date().toISOString() };
          } else {
            if (!collaboration || collaboration.phase !== 'waiting_reply' || collaboration.ownerId !== actor.id) throw new ForbiddenException('只有当前协同处理人可以回复，不能代替他人确认');
            next = { ...collaboration, phase: 'returned', ownerId: collaboration.originatorId, ownerName: collaboration.originatorName, reply: reason, repliedById: actor.id, repliedByName: actor.name, repliedAt: new Date().toISOString() };
          }
          await db.runtimeState.upsert({ where: { key: collaborationKey }, create: { key: collaborationKey, value: JSON.stringify(next) }, update: { value: JSON.stringify(next) } });
        }
        const changed = await db.procQualityRecord.updateMany({ where: { id: qualityId, updatedAt: record.updatedAt }, data: qualityUpdate });
        if (changed.count !== 1) throw new ConflictException('质量异常已被更新');
        event = { id: randomUUID(), action: input.action, subjectId: qualityId, reason: input.action === 'assign-quality' ? `${reason}（处理人：${assignmentName}）` : reason, actorId: actor.id, actorName: actor.name, at: new Date().toISOString() };
        plan.events.push(event); plan.version++;
      } else if (input.action === 'review-basis') {
        this.permission(actor, 'bom:publish');
        if (!actor.permissions.includes('*') && !['page:proc-materials', 'page:proc-cockpit', 'page:proc-inventory-readiness'].some(p => actor.permissions.includes(p))) throw new ForbiddenException('还需要 BOM 页面权限');
        if (plan.bomRevisionId) throw new BadRequestException('已引用发布版本的计划不需要历史核对');
        assertLegacyBom(plan);
        if (input.version !== plan.version || input.data.sourceFingerprint !== hash(plan.bom)) throw new ConflictException('原计划依据已更新，请刷新后核对');
        const deviceId = executionText(input.data.deviceId, '设备'), reason = executionText(input.data.reason, '核对依据', 2000);
        await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`production-plan:${plan.month}:${plan.productId}:${deviceId}`}))::text`;
        await db.$queryRaw`SELECT pg_advisory_xact_lock_shared(hashtext('procurement-common-bom-lines'))::text`;
        const device = await db.procBomNode.findUnique({ where: { id: deviceId } });
        const root = device?.productRootId ? await db.procTaskTreeNode.findUnique({ where: { id: device.productRootId } }) : null;
        if (!device || device.parentId || !root || root.parentId || root.productId !== plan.productId) throw new BadRequestException('设备不属于原计划产品，请先确认 BOM 归属');
        const plans = await db.runtimeState.findMany({ where: { key: { startsWith: `${EXECUTION_PREFIX}plan:${plan.month}:` } } });
        if (plans.some(row => { const prior = decode(row.value); return prior.id !== plan.id && prior.month === plan.month && prior.productId === plan.productId && prior.deviceId === deviceId; })) throw new ConflictException('该设备本月已有其他计划，请先核对重复计划');
        plan.deviceId = deviceId;
        plan.legacyBasisReview = { deviceId, productRootId: root.id, sourceFingerprint: legacyBasisFingerprint(plan, root.id, deviceId), actorId: actor.id, actorName: actor.name, at: new Date().toISOString(), reason };
        event = { id: randomUUID(), action: input.action, reason, actorId: actor.id, actorName: actor.name, at: new Date().toISOString(), subjectId: plan.id }; plan.events.push(event); plan.version++;
      } else event = applyExecutionCommand(plan, input, actor, owner);
      if (input.action === 'adjust') {
        const task = plan.tasks.find(row => row.id === event.subjectId)!;
        if (task.status === 'dispatched' && (event.adjustment!.before.ownerId !== task.ownerId || event.adjustment!.before.date !== task.date)) {
          // Check the new assignee/date against applicable ECNs without rewriting the basis already used on the floor.
          await productionBasis(db, plan, task.batchId, task.ownerId, task.date);
        }
        const storedIssue = await db.runtimeState.findUnique({ where: { key: `${WAREHOUSE_PREFIX}issue:${task.id}` } });
        if (task.status === 'dispatched' && !storedIssue) throw new ConflictException('派工作业缺少领料需求，请先核对原记录');
        if (storedIssue) {
          const issue = JSON.parse(storedIssue.value) as WarehouseIssue;
          if (issue.taskId !== task.id || issue.planId !== plan.id || issue.status === 'cancelled') throw new ConflictException('原领料需求状态不允许调整，请重新核对');
          const impact = issue.lines.map(line => {
            const material = task.materials.find(row => row.code === line.code);
            if (!material || material.unit !== line.unit) throw new ConflictException('原领料明细与作业不一致，请先核对');
            const issuedQty = line.issuedQty ?? 0, signedQty = line.signedQty ?? 0;
            if (new Prisma.Decimal(material.requiredQty).lt(Prisma.Decimal.max(issuedQty, signedQty))) throw new ConflictException(`${line.name}调整后需求不能低于累计已发或已签收数量；原领退料记录保持不变`);
            return { code: line.code, beforeQty: line.quantity, afterQty: material.requiredQty, issuedQty, signedQty };
          });
          if (impact.length !== task.materials.length) throw new ConflictException('原领料需求缺少物料，请先核对');
          event.adjustment!.warehouse = { id: issue.id, beforeVersion: issue.version, afterVersion: issue.version + 1, lines: impact };
          issue.lines = issue.lines.map(line => ({ ...line, quantity: impact.find(row => row.code === line.code)!.afterQty }));
          issue.neededDate = task.date; issue.recipientId = task.ownerId; issue.recipientName = task.ownerName; issue.version++;
          issue.status = issue.lines.every(row => (row.signedQty ?? 0) === row.quantity) ? 'signed' : issue.lines.every(row => (row.issuedQty ?? 0) === row.quantity) ? 'issued' : issue.lines.some(row => (row.issuedQty ?? 0) > 0) ? 'partial' : 'requested';
          issue.history.push(event);
          const changedIssue = await db.runtimeState.updateMany({ where: { key: storedIssue.key, value: storedIssue.value }, data: { value: JSON.stringify(issue) } });
          if (changedIssue.count !== 1) throw new ConflictException('领料需求已被更新，请保留调整内容并重新核对');
        }
      }
      if (input.action === 'inspect') {
        const task = plan.tasks.find((row) => row.id === input.data.taskId)!;
        const inspection = task.inspections!.find((row) => row.id === event.subjectId)!;
        const pendingField = (task.fieldIssues ?? []).filter(row => row.reportId === inspection.reportId && !row.inspectionId);
        if (input.data.qualityId) {
          const field = pendingField.find(row => row.qualityId === input.data.qualityId);
          if (!field || task.inspections!.some(row => row.id !== inspection.id && row.qualityId === field.qualityId)) throw new BadRequestException('现场异常不属于此报工或已关联检验');
          const original = await db.procQualityRecord.findUnique({ where: { id: field.qualityId } });
          if (!original || original.status === 'closed' || !new Prisma.Decimal(inspection.quantity).minus(inspection.goodQty).eq(original.defectiveQty) || !new Prisma.Decimal(inspection.quantity).eq(original.inspectedQty)) throw new ConflictException('检验须对应原现场异常的检验数与不良件数；数量不一致请先核对，不能重复登记');
          inspection.qualityId = field.qualityId; field.inspectionId = inspection.id;
          const sourceKey = `${EXECUTION_PREFIX}quality:${field.qualityId}`;
          const source = await db.runtimeState.findUnique({ where: { key: sourceKey } });
          if (!source) throw new ConflictException('现场异常关联缺失，请先核对');
          await db.runtimeState.update({ where: { key: sourceKey }, data: { value: JSON.stringify({ ...JSON.parse(source.value), inspectionId: inspection.id }) } });
        } else if (pendingField.length) throw new ConflictException('本次报工已有现场异常，请选择原异常继续检验，不能重复记录不良件数');
        else if (inspection.goodQty < inspection.quantity) {
          const quality = await db.procQualityRecord.create({ data: { productId: plan.productId, treeNodeId: task.treeNodeId,
            source: 'production', batchNo: `${plan.batches.find((row) => row.id === task.batchId)!.code}/${inspection.id}`, unit: task.unit,
            inspectionDate: new Date(`${inspection.date}T00:00:00.000Z`), inspectedQty: new Prisma.Decimal(inspection.quantity), defectiveQty: new Prisma.Decimal(inspection.quantity).minus(inspection.goodQty),
            issue: executionText(input.data.issue, '不良现象', 2000), disposition: 'pending', status: 'open', createdBy: actor.id, createdByName: actor.name } });
          inspection.qualityId = quality.id;
          await db.runtimeState.create({ data: { key: `${EXECUTION_PREFIX}quality:${quality.id}`, value: JSON.stringify({ planId: plan.id, taskId: task.id, inspectionId: inspection.id }) } });
        }
      }
      if (input.action === 'dispatch') {
        const task = plan.tasks.find((row) => row.id === event.subjectId)!;
        task.basis = await productionBasis(db, plan, task.batchId, task.ownerId, task.date);
        const request = { id: task.id, kind: 'issue', version: 1, status: 'requested', planId: plan.id, batchId: task.batchId, taskId: task.id,
          productLine: plan.productLine, title: task.name, neededDate: task.date, recipientId: task.ownerId, recipientName: task.ownerName,
          lines: task.materials.map((row) => ({ code: row.code, name: row.name, unit: row.unit, quantity: row.requiredQty })),
          createdAt: event.at, createdBy: actor.id, createdByName: actor.name, history: [event] };
        await db.runtimeState.create({ data: { key: `${WAREHOUSE_PREFIX}issue:${task.id}`, value: JSON.stringify(request) } });
      }
      const changed = await db.runtimeState.updateMany({ where: { key, value: stored.value }, data: { value: JSON.stringify(plan) } });
      if (changed.count !== 1) throw new ConflictException('计划已被更新，请重新核对');
      await this.record(db, plan, requestKey, fingerprint, actor);
      return { id };
    });
  }
  private requestId(value: unknown): string { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(value)) throw new BadRequestException('提交标识无效'); return value; }
  private async repeated(db: Prisma.TransactionClient, key: string, fingerprint: string) {
    const saved = await db.runtimeState.findUnique({ where: { key } });
    if (!saved) return false;
    if (saved.value !== fingerprint) throw new ConflictException('提交标识已用于其他内容，请重新提交');
    return true;
  }
  private async record(db: Prisma.TransactionClient, plan: ExecutionPlan, requestKey: string, fingerprint: string, actor: ProcActor) {
    const event = plan.events.at(-1)!;
    await db.runtimeState.create({ data: { key: `${EXECUTION_PREFIX}history:${plan.id}:${String(plan.version).padStart(12, '0')}`, value: JSON.stringify(plan) } });
    await db.runtimeState.create({ data: { key: requestKey, value: fingerprint } });
    await db.auditLog.create({ data: { module: 'procurement', source: 'web', action: `production.${event.action}`, resource: 'production-plan', resourceId: plan.id,
      userId: actor.id, actorName: actor.name, summary: `生产计划 ${plan.productLine} ${plan.month}：${event.reason}`, meta: { version: plan.version, event: JSON.parse(JSON.stringify(event)) } } });
  }
  private async write<T>(fn: (db: Prisma.TransactionClient) => Promise<T>) {
    try { return await this.prisma.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
    catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034', 'P2025'].includes(error.code)) throw new ConflictException('记录正在更新，请保留填写内容并重试'); throw error; }
  }
}
