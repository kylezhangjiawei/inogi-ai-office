import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ResearchDevelopmentService } from '../research-development/research-development.service';
import { ProductionExecutionService } from './production-execution.service';
import { ProductionLifecycleService, type LifecycleState } from './production-lifecycle.service';
import { OperationalTasksService } from './operational-tasks.service';
import type { ProcActor } from './procurement.types';
import { assertQualityRead } from './quality-analysis';
import { sampleTestOf } from './sample-test';
import { completionInspections, executionToday, type ExecutionPlan } from './production-execution.model';

const has = (actor: ProcActor, code: string) => actor.permissions.includes('*') || actor.permissions.includes(code);
export interface OriginalRecordItem { id: string; kind: string; title: string; code: string; state: string; owner: string; dueDate: string | null; detail: string; href: string }
const productionHref = (plan: { id: string; month: string }, params: Record<string, string>) => '/production-execution?' + new URLSearchParams({ month: plan.month, plan: plan.id, ...params });
@Injectable()
export class RDRelatedRecordsService {
  constructor(private readonly prisma: PrismaService, private readonly rd: ResearchDevelopmentService, private readonly execution: ProductionExecutionService, private readonly lifecycle: ProductionLifecycleService, private readonly operations: OperationalTasksService) {}

  async related(rdTaskId: string, actor: ProcActor) {
    await this.rd.requireTaskReadAccess(rdTaskId, { userId: actor.id, userName: actor.name, permissions: actor.permissions });
    const tasks = await this.prisma.procTask.findMany({ where: { rdTaskId }, select: { id: true, code: true, materialName: true, status: true, buyerUserId: true, buyer: true } });
    const items: OriginalRecordItem[] = [];
    for (const task of tasks) {
      const cockpit = has(actor, 'page:proc-cockpit'), own = has(actor, 'page:proc-my-workspace') && (task.buyerUserId === actor.id || (!task.buyerUserId && task.buyer === actor.name));
      if (cockpit || own) items.push({ id: task.id, kind: 'procurement', title: task.materialName, code: task.code, state: '原采购任务', owner: task.buyer, dueDate: null, detail: '', href: `${cockpit ? '/proc-cockpit' : '/proc-my-workspace'}?` + new URLSearchParams({ task: task.id, detail: '1' }) });
    }
    if (!has(actor, 'page:production-execution') || !tasks.length) return { items };
    const ids = new Set(tasks.map(task => task.id));
    const rows = await this.prisma.runtimeState.findMany({ where: { key: { startsWith: 'procurement:lifecycle:v1:plan:' } } });
    for (const row of rows) {
      const state = JSON.parse(row.value) as LifecycleState;
      if (!state.transfers.some(pkg => ids.has(pkg.sampleTaskId))) continue;
      const planId = row.key.slice('procurement:lifecycle:v1:plan:'.length);
      let view: Awaited<ReturnType<ProductionLifecycleService['read']>>;
      try { view = await this.lifecycle.read(planId, actor); } catch (error) { if (error instanceof ForbiddenException) continue; throw error; }
      const planRow = await this.prisma.runtimeState.findUnique({ where: { key: 'procurement:execution:v1:plan:' + planId } });
      if (!planRow) continue;
      const plan = JSON.parse(planRow.value) as ExecutionPlan, packages = new Set(view.transfers.filter(pkg => ids.has(pkg.sampleTaskId)).map(pkg => pkg.id));
      for (const change of view.changes.filter(change => packages.has(change.packageId) || change.previousPackageIds?.some(id => packages.has(id)))) items.push({ id: change.id, kind: 'ecn', title: change.code, code: change.code, state: change.status === 'published' ? '已发布' : '草稿', owner: '', dueDate: change.effectiveDate, detail: change.handling, href: productionHref(plan, { view: 'transfer', recordType: 'ecn', record: change.id }) });
      const qualityIds = new Set(view.batches.flatMap(batch => batch.tasks.filter(task => task.basis && ids.has(task.basis.sampleTaskId)).flatMap(task => [...(task.inspections ?? []).flatMap(inspection => inspection.qualityId ? [inspection.qualityId] : []), ...(task.fieldIssues ?? []).map(issue => issue.qualityId)])));
      for (const quality of view.qualityRecords.filter(quality => qualityIds.has(quality.id))) {
        try { await assertQualityRead(this.prisma, quality.id, actor); } catch (error) { if (error instanceof ForbiddenException || error instanceof NotFoundException) continue; throw error; }
        items.push({ id: quality.id, kind: 'quality', title: quality.issue, code: quality.batchNo, state: quality.status === 'closed' ? '已关闭' : '待闭环', owner: '', dueDate: null, detail: quality.resolution ?? '', href: productionHref(plan, { view: 'quality', quality: quality.id }) });
      }
    }
    return { items: [...new Map(items.map(item => [item.kind + ':' + item.id, item])).values()] };
  }

  async mine(actor: ProcActor) {
    if (!actor.id) throw new ForbiddenException('请登录后查看本人待办');
    const items: OriginalRecordItem[] = [], errors: string[] = [], month = executionToday().slice(0, 7);
    const sources: { name: string; run: () => Promise<void> }[] = [];
    if (has(actor, 'page:rd-my-workspace')) sources.push({ name: '样品测试', run: async () => {
      const tasks = await this.prisma.procTask.findMany({ where: { status: 'testing', metadata: { path: ['sampleTest', 'testerUserId'], equals: actor.id } }, select: { id: true, code: true, materialName: true, needDate: true, metadata: true } });
      for (const task of tasks) { const sample = sampleTestOf(task.metadata); if (sample?.testerUserId !== actor.id || sample.result !== null) continue;
        items.push({ id: task.id, kind: 'sample', title: task.materialName, code: task.code, state: '待测试结论', owner: sample.testerName, dueDate: task.needDate?.toISOString().slice(0, 10) ?? null, detail: '当前样品测试轮次', href: '/rd-my-workspace?' + new URLSearchParams({ sampleTest: task.id }) }); }
    } });
    if (has(actor, 'page:purchase-order-detail') && ['page:proc-cockpit', 'proc-purchase-order:receive', 'proc-purchase-order:inspect'].some(code => has(actor, code))) for (const kind of ['warehouse', 'quality'] as const) sources.push({ name: kind === 'warehouse' ? '采购收货' : '来料检验', run: async () => {
      let cursor: string | undefined; const seen = new Set<string>();
      do { const page = await this.operations.list({ kind, owner: actor.id, status: 'active', cursor }, actor);
        for (const row of page.items) items.push({ id: String(row.id), kind: kind === 'warehouse' ? 'receiving' : 'incoming-quality', title: String(row.materialName), code: String(row.orderNo), state: String(row.state), owner: actor.name, dueDate: row.dueDate as string | null, detail: String(row.quantityBasis), href: '/purchase-orders/' + encodeURIComponent(String(row.lineId)) });
        cursor = page.nextCursor ?? undefined; if (cursor && seen.has(cursor)) throw new Error('来源分页未前进'); if (cursor) seen.add(cursor);
      } while (cursor);
    } });
    if (has(actor, 'page:production-execution')) sources.push({ name: '现场与质量协同', run: async () => {
      const plans = await this.execution.list(month, actor);
      for (const plan of plans) for (const task of plan.tasks) {
        const completed = completionInspections(task).reduce((sum, row) => sum + row.goodQty + (('verifiedGoodQty' in row ? Number(row.verifiedGoodQty) : 0) || 0), 0);
        if (task.ownerId === actor.id && task.status !== 'cancelled' && (task.status === 'draft' || completed < task.quantity)) items.push({ id: task.id, kind: 'production', title: task.name, code: plan.productName + ' · ' + task.line, state: task.status === 'draft' ? '待派工' : '现场执行', owner: task.ownerName, dueDate: task.date, detail: `${plan.month}${plan.month < month ? ' · 跨月未完' : ''}`, href: productionHref(plan, { view: 'tasks', task: task.id }) });
        const qualities = [...task.inspections.flatMap(row => row.quality ? [row.quality] : []), ...task.fieldIssues.flatMap(row => row.quality ? [row.quality] : [])];
        for (const quality of qualities) { const collaboration = quality.collaboration;
          if (quality.status === 'closed' || !collaboration || collaboration.ownerId !== actor.id) continue;
          items.push({ id: quality.id, kind: 'quality', title: quality.issue, code: plan.batches?.find(batch => batch.id === task.batchId)?.code || task.name, state: collaboration.phase === 'returned' ? '回复已回，待复验处理' : '待协同回复', owner: collaboration.ownerName, dueDate: collaboration.dueDate ?? null, detail: [collaboration.note, collaboration.requiredInfo, collaboration.verificationPlan].filter(Boolean).join('；'), href: productionHref(plan, { view: 'quality', quality: quality.id }) }); }
      }
    } });
    if (has(actor, 'page:production-execution')) sources.push({ name: 'ECN 待确认与反馈', run: async () => {
      const rows = await this.prisma.runtimeState.findMany({ where: { OR: [{ key: { startsWith: 'procurement:execution:v1:plan:' } }, { key: { startsWith: 'procurement:lifecycle:v1:plan:' } }] } });
      const plans = new Map(rows.filter(row => row.key.startsWith('procurement:execution:')).map(row => { const plan = JSON.parse(row.value) as ExecutionPlan; return [plan.id, plan]; }));
      for (const row of rows.filter(row => row.key.startsWith('procurement:lifecycle:'))) { const plan = plans.get(row.key.slice('procurement:lifecycle:v1:plan:'.length)); if (!plan) continue;
        const state = JSON.parse(row.value) as LifecycleState;
        for (const change of state.changes.filter(change => change.status === 'published')) {
          const href = productionHref(plan, { view: 'transfer', recordType: 'ecn', record: change.id });
          const own = plan.tasks.some(task => task.ownerId === actor.id && task.status !== 'cancelled' && change.batchIds.includes(task.batchId));
          if (own && !change.acknowledgments.some(ack => ack.actorId === actor.id)) items.push({ id: change.id, kind: 'ecn', title: change.code, code: plan.productName, state: '待阅读确认', owner: actor.name, dueDate: change.effectiveDate, detail: change.handling, href });
          for (const feedback of change.feedback ?? []) if (feedback.ownerId === actor.id && feedback.status !== 'resolved') items.push({ id: feedback.id, kind: 'ecn-feedback', title: change.code, code: plan.productName, state: '执行反馈待处理', owner: feedback.ownerName, dueDate: feedback.dueDate, detail: feedback.problem, href });
        }
      }
    } });
    const results = await Promise.allSettled(sources.map(source => source.run()));
    results.forEach((result, index) => { if (result.status === 'rejected') errors.push(sources[index].name + '读取失败，请重新加载'); });
    return { items: [...new Map(items.map(item => [item.kind + ':' + item.id, item])).values()].sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || a.id.localeCompare(b.id)), errors, readAt: new Date().toISOString(), scope: 'assigned-to-me' };
  }
}
