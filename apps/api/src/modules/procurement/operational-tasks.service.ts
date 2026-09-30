import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { ProcActor } from './procurement.types';
import { fulfillmentReceiptInclude, parseFulfillmentState } from './purchase-fulfillment.service';
import { calculatePurchaseFulfillment, fulfillmentStateKey } from './purchase-fulfillment.model';

export type OperationalKind = 'warehouse' | 'quality';
export interface OperationalAssignment {
  version: number; userId: string; name: string; note: string; dueDate: string | null;
  at: string; by: string; requestId: string;
  history: Array<{ version: number; userId: string; name: string; note: string; dueDate: string | null; at: string; by: string }>;
}
const prefix = 'proc-operations-assignment:';
const has = (actor: ProcActor, code: string) => actor.permissions.includes('*') || actor.permissions.includes(code);
const object = (raw: string | undefined): OperationalAssignment | null => raw ? JSON.parse(raw) : null;
const key = (kind: OperationalKind, id: string) => `${prefix}${kind}:${id}`;
const kindOf = (value: unknown): OperationalKind => { if (value !== 'warehouse' && value !== 'quality') throw new BadRequestException('请选择仓管或质量任务'); return value; };
function inputText(value: unknown, max: number, required = false) {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/.test(value) || (required && !value.trim())) throw new BadRequestException('任务分派信息格式无效');
  return value.trim();
}
function date(value: unknown) {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new BadRequestException('截止日期无效');
  return value;
}

@Injectable()
export class OperationalTasksService {
  constructor(private readonly prisma: PrismaService) {}
  private access(actor: ProcActor) {
    if (!has(actor, 'page:purchase-order-detail') || !['page:proc-cockpit', 'proc-purchase-order:receive', 'proc-purchase-order:inspect'].some(code => has(actor, code))) throw new ForbiddenException('没有查看仓管或质量任务的权限');
    return has(actor, 'page:proc-cockpit');
  }
  async candidates(actor: ProcActor) {
    this.access(actor);
    if (!has(actor, 'proc-operations:assign')) return [];
    const users = await this.prisma.user.findMany({ where: { status: 'ACTIVE' }, select: { id: true, name: true, department: true, role: { select: { permissions: true } } }, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
    return users.flatMap(user => {
      const permissions = Array.isArray(user.role?.permissions) ? user.role.permissions : [];
      const can = (code: string) => permissions.includes('*') || permissions.includes(code);
      const kinds = (['warehouse', 'quality'] as const).filter(kind => can('page:purchase-order-detail') && can(kind === 'warehouse' ? 'proc-purchase-order:receive' : 'proc-purchase-order:inspect'));
      return kinds.length ? [{ id: user.id, name: user.name, department: user.department, kinds }] : [];
    });
  }
  async list(query: { kind?: unknown; owner?: unknown; status?: unknown; before?: unknown; cursor?: unknown }, actor: ProcActor) {
    const canViewAll = this.access(actor), kind = kindOf(query.kind ?? 'warehouse');
    const owner = canViewAll ? inputText(query.owner ?? 'all', 128) : actor.id;
    const status = query.status ?? 'active';
    if (!['active', 'completed', 'all'].includes(String(status))) throw new BadRequestException('任务状态无效');
    const before = query.before ? date(query.before) : null;
    let cursor = query.cursor ? inputText(query.cursor, 128, true) : '';
    const items: Array<Record<string, unknown>> = [];
    let hasMore = false;
    // Iterate stable source IDs until a page of matching tasks is filled. No source cap silently truncates a person's work.
    while (items.length < 25) {
      const sources: any[] = kind === 'warehouse'
        ? await this.prisma.procPurchaseOrderMirror.findMany({ where: cursor ? { id: { gt: cursor } } : {}, orderBy: { id: 'asc' }, take: 100, include: { receipts: { include: fulfillmentReceiptInclude } } })
        : await this.prisma.procPurchaseReceipt.findMany({ where: cursor ? { id: { gt: cursor } } : {}, orderBy: { id: 'asc' }, take: 100, include: { line: { include: { receipts: { include: fulfillmentReceiptInclude } } } } });
      if (!sources.length) break;
      const states = await this.prisma.runtimeState.findMany({ where: { key: { in: [...sources.map(row => key(kind, row.id)), ...sources.map(row => fulfillmentStateKey(kind === 'warehouse' ? row.id : row.lineId))] } } });
      const assignments = new Map(states.filter(row => row.key.startsWith(prefix)).map(row => [row.key, object(row.value)]));
      const ledgers = new Map(states.filter(row => !row.key.startsWith(prefix)).map(row => [row.key, parseFulfillmentState(row.value)]));
      for (const source of sources) {
        cursor = source.id;
        const assignment = assignments.get(key(kind, source.id)) ?? null;
        if (owner !== 'all' && (owner === 'unassigned' ? Boolean(assignment?.userId) : assignment?.userId !== owner)) continue;
        const line = kind === 'warehouse' ? source : source.line;
        const summary = calculatePurchaseFulfillment(line, line.receipts, ledgers.get(fulfillmentStateKey(line.id)) ?? parseFulfillmentState(null));
        const receipt = summary.receipts.find(row => row.id === source.id);
        const dueDate = assignment?.dueDate ?? (kind === 'warehouse' ? line.etaDate?.toISOString().slice(0, 10) : source.receivedDate.toISOString().slice(0, 10)) ?? null;
        const quantity = kind === 'warehouse' ? summary.remainingQty : !receipt || receipt.issues.length ? null : new Prisma.Decimal(receipt.pendingQty).plus(receipt.pendingJudgmentQty).toNumber();
        const cancelled = kind === 'warehouse' && /作废|取消|终止|cancel|void|closed/i.test(line.status ?? '');
        const completed = cancelled || quantity === 0;
        if (status !== 'all' && (status === 'completed') !== completed) continue;
        if (before && (!dueDate || dueDate >= before)) continue;
        items.push({ id: source.id, kind, lineId: line.id, orderNo: line.tpOrderNo, lineNo: line.tpLineNo, materialName: line.inventoryName,
          supplierName: line.supplierName, unit: line.unit, quantity, dueDate, completed,
          state: cancelled ? '原订单已关闭或取消' : quantity === null ? '履约来源待核对' : completed ? (kind === 'warehouse' ? '净履约数量已收齐' : '已完成检验判定') : (kind === 'warehouse' ? '待收货核对' : '待检验或待判'),
          quantityBasis: quantity === null ? (kind === 'quality' ? receipt?.issues.join('；') || '收货记录待核对' : summary.issues.join('；')) : kind === 'warehouse' ? 'ERP 基础及已批准取消、退货、冲销后的待交量' : '本地收货扣除批准调整后的待检验及待判量',
          sourceVersion: kind === 'warehouse' ? source.updatedAt.toISOString() : String(source.version), assignment,
          deliveryNo: kind === 'quality' ? source.deliveryNo : null });
        if (items.length === 25) { hasMore = true; break; }
      }
      if (sources.length < 100 || items.length === 25) break;
    }
    const ownerStates = await this.prisma.runtimeState.findMany({ where: { key: { startsWith: `${prefix}${kind}:` } } });
    const people = new Map<string, { id: string; name: string }>();
    for (const state of ownerStates) {
      const assignment = object(state.value);
      if (assignment?.userId && (canViewAll || assignment.userId === actor.id)) people.set(assignment.userId, { id: assignment.userId, name: assignment.name });
    }
    return { items, people: [...people.values()].sort((a, b) => a.name.localeCompare(b.name)), nextCursor: hasMore ? cursor : null, canViewAll, canAssign: canViewAll && has(actor, 'proc-operations:assign'), scope: canViewAll ? 'all-visible-orders' : 'assigned-to-me' };
  }
  async assign(kindValue: unknown, idValue: unknown, input: { userId?: unknown; note?: unknown; dueDate?: unknown; expectedVersion?: unknown; requestId?: unknown }, actor: ProcActor) {
    if (!this.access(actor) || !has(actor, 'proc-operations:assign')) throw new ForbiddenException('没有分派仓管或质量任务的权限');
    const kind = kindOf(kindValue), id = inputText(idValue, 128, true), userId = inputText(input?.userId, 128), note = inputText(input?.note, 1000, true);
    const dueDate = date(input.dueDate ?? null), requestId = inputText(input.requestId, 128, true);
    if (!/^[a-zA-Z0-9_-]{16,128}$/.test(requestId) || !Number.isSafeInteger(input.expectedVersion) || Number(input.expectedVersion) < 0) throw new BadRequestException('提交版本或标识无效');
    const candidate = userId ? (await this.candidates(actor)).find(user => user.id === userId && user.kinds.includes(kind)) : null;
    if (userId && !candidate) throw new BadRequestException('接收人没有该岗位操作权限或账号已停用');
    return this.prisma.$transaction(async db => {
      await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key(kind, id)}))::text`;
      const source = kind === 'warehouse' ? await db.procPurchaseOrderMirror.findUnique({ where: { id } }) : await db.procPurchaseReceipt.findUnique({ where: { id } });
      if (!source) throw new NotFoundException('原业务记录已不存在');
      const current = object((await db.runtimeState.findUnique({ where: { key: key(kind, id) } }))?.value);
      if (current?.requestId === requestId) {
        if (current.userId !== userId || current.note !== note || current.dueDate !== dueDate || current.by !== actor.id) throw new ConflictException('提交标识已使用');
        return current;
      }
      if ((current?.version ?? 0) !== input.expectedVersion) throw new ConflictException('任务已被其他人分派，请刷新后重试');
      const next = { version: (current?.version ?? 0) + 1, userId, name: candidate?.name ?? '', note, dueDate, at: new Date().toISOString(), by: actor.id };
      const saved: OperationalAssignment = { ...next, requestId, history: [...(current?.history ?? []), next] };
      await db.runtimeState.upsert({ where: { key: key(kind, id) }, create: { key: key(kind, id), value: JSON.stringify(saved) }, update: { value: JSON.stringify(saved) } });
      await db.auditLog.create({ data: { module: 'procurement', source: 'web', action: 'operational-task.assigned', resource: 'proc-operational-task', resourceId: `${kind}:${id}`, userId: actor.id, actorName: actor.name, summary: `分派${kind === 'warehouse' ? '仓管' : '质量'}任务：${next.name || '待分配'}`, meta: { before: current ? { userId: current.userId, name: current.name, dueDate: current.dueDate } : null, after: next } } });
      return saved;
    });
  }
}
