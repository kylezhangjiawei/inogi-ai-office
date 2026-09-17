import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { ProcurementService } from './procurement.service';
import type { ProcActor } from './procurement.types';
import { applyExecutionCommand, executionMonth, executionQty, executionSummary, executionText, type ExecutionCommand, type ExecutionPlan } from './production-execution.model';
import { effectiveVerificationQuantity, type QualityVerificationEntry } from './quality-verification.service';
import { warehouseReturns } from './warehouse-records.service';
import { productionBasis, type LifecycleState } from './production-lifecycle.service';

export const EXECUTION_PREFIX = 'procurement:execution:v1:';
export const WAREHOUSE_PREFIX = 'procurement:warehouse-flow:v1:';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const planKey = (id: string) => `${EXECUTION_PREFIX}plan:${id}`;
const decode = (value: string) => JSON.parse(value) as ExecutionPlan;
const canReceive = (permissions: unknown, action: string) => Array.isArray(permissions) && (permissions.includes('*') || (permissions.includes('page:production-execution') && permissions.includes(action)));
@Injectable()
export class ProductionExecutionService {
  constructor(private readonly prisma: PrismaService, private readonly procurement: ProcurementService) {}
  private permission(actor: ProcActor, action?: string) {
    if (!actor.id || (!actor.permissions.includes('*') && (!actor.permissions.includes('page:production-execution') || (action && !actor.permissions.includes(action))))) throw new ForbiddenException('没有执行本生产操作的权限');
  }
  async options(actor: ProcActor) {
    this.permission(actor);
    const [nodes, models, users] = await Promise.all([
      this.prisma.procTaskTreeNode.findMany({ select: { id: true, productId: true, parentId: true, name: true }, orderBy: { sortOrder: 'asc' } }),
      this.prisma.procBomNode.findMany({ select: { productLine: true }, distinct: ['productLine'] }),
      this.prisma.user.findMany({ where: { status: 'ACTIVE' }, select: { id: true, name: true, role: { select: { permissions: true } } }, orderBy: { name: 'asc' } }),
    ]);
    return { nodes, models: models.map((row) => row.productLine).filter(Boolean), users: users.map((row) => ({ id: row.id, name: row.name, canReport: canReceive(row.role?.permissions, 'proc-production:report'), canCollaborate: canReceive(row.role?.permissions, 'proc-quality:collaborate') })).filter((row) => row.canReport || row.canCollaborate) };
  }
  async overview(month: string, actor: ProcActor) {
    executionMonth(month);
    if (!actor.id || !actor.permissions.some(code => ['*', 'page:rd-director-dashboard', 'page:production-execution'].includes(code))) throw new ForbiddenException('没有查看生产总览的权限');
    const all = actor.permissions.some(code => ['*', 'page:rd-director-dashboard', 'production:plan', 'production:view-all'].includes(code));
    const rows = await this.prisma.runtimeState.findMany({ where: { OR: [{ key: { startsWith: `${EXECUTION_PREFIX}plan:` } }, { key: { startsWith: 'procurement:lifecycle:v1:plan:' } }] } });
    const states = new Map(rows.filter(row => row.key.startsWith('procurement:lifecycle:')).map(row => [row.key.slice('procurement:lifecycle:v1:plan:'.length), JSON.parse(row.value) as LifecycleState]));
    const plans = rows.filter(row => row.key.startsWith(`${EXECUTION_PREFIX}plan:`)).map(row => decode(row.value)).filter(plan => plan.month <= month);
    const tasks = plans.flatMap(plan => plan.tasks.filter(task => task.status !== 'cancelled' && (all || task.ownerId === actor.id)).map(task => ({ ...task, planId: plan.id, month: plan.month, productLine: plan.productLine, batchCode: plan.batches.find(batch => batch.id === task.batchId)?.code, reportedQty: task.reports.reduce((sum, row) => sum + row.quantity, 0), goodQty: task.reports.reduce((sum, row) => sum + row.goodQty, 0) })));
    const carriedTasks = tasks.filter(task => task.month < month);
    const qualityIds = carriedTasks.flatMap(task => (task.inspections ?? []).flatMap(row => row.qualityId ? [row.qualityId] : []));
    const [quality, verificationRows] = qualityIds.length ? await Promise.all([
      this.prisma.procQualityRecord.findMany({ where: { id: { in: qualityIds } } }),
      this.prisma.runtimeState.findMany({ where: { OR: qualityIds.map(id => ({ key: { startsWith: `procurement:quality-verification:v1:${id}:` } })) }, orderBy: { updatedAt: 'desc' } }),
    ]) : [[], []];
    const qualityById = new Map(quality.map(row => [row.id, row]));
    const verifications = verificationRows.map(row => JSON.parse(row.value) as QualityVerificationEntry);
    // Carryover follows inspected output and quality closure; reported good quantities remain historical.
    const unfinished = new Set(carriedTasks.filter(task => {
      const inspections = task.inspections ?? [];
      const completedQty = inspections.reduce((sum, inspection) => {
        const record = inspection.qualityId ? qualityById.get(inspection.qualityId) : undefined;
        const latest = record ? verifications.find(row => row.recordId === record.id) : undefined;
        const verifiedGoodQty = record && ['rework', 'replacement', 'concession'].includes(record.disposition) ? Math.min(inspection.quantity - inspection.goodQty, effectiveVerificationQuantity(latest, record)) : 0;
        return sum + inspection.goodQty + verifiedGoodQty;
      }, 0);
      return task.status === 'draft' || completedQty < task.quantity || inspections.some(row => row.qualityId && qualityById.get(row.qualityId)?.status !== 'closed');
    }).map(task => task.id));
    const actualShipments = all ? [...states.values()].flatMap(state => state.shipments.filter(row => !row.reversed && row.date.startsWith(month))) : [];
    return { month, scope: all ? 'all' : 'assigned', targetQty: all ? plans.filter(plan => plan.month === month).reduce((sum, plan) => sum + plan.targetQty, 0) : null,
      shipmentTargetQty: all ? plans.filter(plan => plan.month === month).reduce((sum, plan) => sum + plan.shipmentTargetQty, 0) : null,
      actualShippedQty: all ? actualShipments.reduce((sum, row) => sum + row.quantity, 0) : null,
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
    const ids = plans.flatMap((plan) => plan.tasks.flatMap((task) => (task.inspections ?? []).flatMap((inspection) => inspection.qualityId ? [inspection.qualityId] : [])));
    const [quality, verificationRows, collaborationRows] = ids.length ? await Promise.all([
      this.prisma.procQualityRecord.findMany({ where: { id: { in: ids } }, include: { treeNode: { select: { name: true } } } }),
      this.prisma.runtimeState.findMany({ where: { OR: ids.map((id) => ({ key: { startsWith: `procurement:quality-verification:v1:${id}:` } })) }, orderBy: { updatedAt: 'desc' } }),
      this.prisma.runtimeState.findMany({ where: { key: { in: ids.map((id) => `${EXECUTION_PREFIX}collaboration:${id}`) } } }),
    ]) : [[], [], []];
    const qualityById = new Map(quality.map((row) => [row.id, row]));
    const verifications = verificationRows.map((row) => JSON.parse(row.value) as QualityVerificationEntry);
    const collaborations = new Map(collaborationRows.map((row) => [row.key, JSON.parse(row.value)]));
    const canViewAll = actor.permissions.includes('*') || ['production:plan', 'production:view-all', 'production:inspect', 'production:transfer', 'production:release', 'production:ship', 'proc-quality:manage', 'proc-quality:verify'].some((permission) => actor.permissions.includes(permission));
    return plans.map((plan) => {
      const tasks = plan.tasks.map((task) => ({ ...task, inspections: (task.inspections ?? []).map((inspection) => {
        const record = inspection.qualityId ? qualityById.get(inspection.qualityId) : undefined;
        const latest = record ? verifications.find((row) => row.recordId === record.id) : undefined;
        const verifiedGoodQty = record && ['rework', 'replacement', 'concession'].includes(record.disposition) ? Math.min(inspection.quantity - inspection.goodQty, effectiveVerificationQuantity(latest, record)) : 0;
        return { ...inspection, verifiedGoodQty, quality: record ? { ...record, treeNode: undefined, treeNodeName: record.treeNode.name,
          taskCode: null, materialName: null, supplierName: null, stockPlanCode: null, inspectedQty: Number(record.inspectedQty), defectiveQty: Number(record.defectiveQty),
          inspectionDate: record.inspectionDate.toISOString().slice(0, 10), createdAt: record.createdAt.toISOString(), updatedAt: record.updatedAt.toISOString(), resolvedAt: record.resolvedAt?.toISOString() ?? null,
          collaboration: collaborations.get(`${EXECUTION_PREFIX}collaboration:${record.id}`) ?? null,
          defectRate: Number(record.defectiveQty) / Number(record.inspectedQty) * 100 } : null };
      }) }));
      const visibleTasks = canViewAll ? tasks : tasks.filter((task) => task.ownerId === actor.id || task.inspections.some((row) => row.quality?.collaboration && [row.quality.collaboration.ownerId, row.quality.collaboration.originatorId].includes(actor.id)));
      const visibleBatches = canViewAll ? plan.batches : plan.batches.filter((batch) => visibleTasks.some((task) => task.batchId === batch.id));
      const subjectIds = new Set([plan.id, ...visibleBatches.map((row) => row.id), ...visibleTasks.map((row) => row.id), ...visibleTasks.flatMap((task) => task.inspections.flatMap((inspection) => [inspection.id, inspection.qualityId].filter(Boolean)))]);
      return { ...plan, carryover: plan.month < month, tasks: visibleTasks, batches: visibleBatches, events: canViewAll ? plan.events : plan.events.filter((event) => subjectIds.has(event.subjectId)),
        scope: canViewAll ? 'all' as const : 'assigned' as const, summary: executionSummary({ ...plan, tasks: visibleTasks, batches: visibleBatches }) };
    }).filter((plan) => (canViewAll || plan.tasks.length > 0) && (!plan.carryover || plan.summary.remainingQty > 0 || hasUnfinishedShipping(plan) || plan.tasks.some((task) => task.status !== 'cancelled' && (task.status === 'draft' || task.inspections.some((row) => row.quality && row.quality.status !== 'closed') || task.quantity > task.inspections.reduce((sum, row) => sum + row.goodQty + row.verifiedGoodQty, 0)))));
  }
  async create(input: Record<string, unknown>, actor: ProcActor) {
    this.permission(actor, 'production:plan');
    const month = executionMonth(input.month), productId = executionText(input.productId, '产品'), productLine = executionText(input.productLine, 'BOM 型号');
    const targetQty = executionQty(input.targetQty, '生产目标', true, true), shipmentTargetQty = executionQty(input.shipmentTargetQty, '发货目标', false, true);
    const reason = executionText(input.reason, '计划依据', 2000), requestId = this.requestId(input.requestId);
    const id = `${month}:${hash([productId, productLine]).slice(0, 24)}`, key = planKey(id), requestKey = `${EXECUTION_PREFIX}request:${requestId}`;
    const fingerprint = hash([actor.id, 'create', month, productId, productLine, targetQty, shipmentTargetQty, reason]);
    // Read BOM before the transaction; its immutable fingerprint and exact selected rows are retained.
    const bom = await this.bom(productLine, actor);
    if (!bom.items.length || bom.invalid || bom.items.some((row) => !row.code || !row.qtyPer || !row.unit.trim())) throw new BadRequestException('请先补齐本型号 BOM 的编码、用量和单位，再确认生产计划');
    return this.write(async (db) => {
      if (await this.repeated(db, requestKey, fingerprint)) return { id };
      if (await db.runtimeState.findUnique({ where: { key } })) throw new ConflictException('该产品型号本月已有计划，请调整原计划，避免重复目标');
      const root = await db.procTaskTreeNode.findFirst({ where: { productId, parentId: null }, select: { name: true } });
      if (!root) throw new BadRequestException('产品尚未建立正式子系统，请先核对产品归属');
      const plan: ExecutionPlan = { id, version: 1, month, productId, productName: root.name, productLine, targetQty, shipmentTargetQty,
        bom: bom.items.map((row) => ({ ...row, code: row.code!, qtyPer: row.qtyPer! })), bomFingerprint: hash(bom.items), batches: [], tasks: [],
        events: [{ id: randomUUID(), action: 'create', reason, actorId: actor.id, actorName: actor.name, at: new Date().toISOString(), subjectId: id }] };
      await db.runtimeState.create({ data: { key, value: JSON.stringify(plan) } });
      await this.record(db, plan, requestKey, fingerprint, actor);
      return { id };
    });
  }
  async command(id: string, input: ExecutionCommand, actor: ProcActor) {
    this.permission(actor, input?.action === 'report' ? 'proc-production:report' : input?.action === 'inspect' ? 'production:inspect' : input?.action === 'reply-quality' ? 'proc-quality:collaborate' : ['disposition', 'assign-quality'].includes(input?.action) ? 'proc-quality:manage' : 'production:plan');
    const requestId = this.requestId(input?.requestId);
    if (!input || !Number.isSafeInteger(input.version) || input.version < 1 || !input.data || typeof input.data !== 'object' || Array.isArray(input.data)) throw new BadRequestException('计划版本或操作内容无效');
    const key = planKey(id), requestKey = `${EXECUTION_PREFIX}request:${requestId}`, fingerprint = hash([actor.id, id, input.version, input.action, input.data]);
    return this.write(async (db) => {
      if (await this.repeated(db, requestKey, fingerprint)) return { id };
      const stored = await db.runtimeState.findUnique({ where: { key } });
      if (!stored) throw new NotFoundException('生产计划不存在');
      const plan = decode(stored.value);
      let owner: { id: string; name: string } | undefined;
      if (input.action === 'task') {
        const node = await db.procTaskTreeNode.findUnique({ where: { id: executionText(input.data.treeNodeId, '子系统') } });
        if (!node || !node.parentId || node.productId !== plan.productId) throw new BadRequestException('作业子系统不属于当前产品');
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
      if (['disposition', 'assign-quality', 'reply-quality'].includes(input.action)) {
        if (input.version !== plan.version) throw new ConflictException('计划已更新，请重新核对');
        const qualityId = executionText(input.data.qualityId, '质量异常');
        if (!plan.tasks.some((task) => task.inspections?.some((row) => row.qualityId === qualityId))) throw new BadRequestException('质量异常不属于本计划');
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
            const owner = await db.user.findFirst({ where: { id: executionText(input.data.ownerId, '协同处理人'), status: 'ACTIVE' }, select: { id: true, name: true, role: { select: { permissions: true } } } });
            if (!owner || !canReceive(owner.role?.permissions, 'proc-quality:collaborate')) throw new BadRequestException('协同处理人不存在、已停用或没有查看并回复异常的权限');
            assignmentName = owner.name;
            next = { ownerId: owner.id, ownerName: owner.name, originatorId: actor.id, originatorName: actor.name, phase: 'waiting_reply', reason, reply: null, at: new Date().toISOString() };
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
      } else event = applyExecutionCommand(plan, input, actor, owner);
      if (input.action === 'inspect') {
        const task = plan.tasks.find((row) => row.id === input.data.taskId)!;
        const inspection = task.inspections!.find((row) => row.id === event.subjectId)!;
        if (inspection.goodQty < inspection.quantity) {
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
