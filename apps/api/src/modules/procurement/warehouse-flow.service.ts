import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { executionQty, executionText } from './production-execution.model';
import { WAREHOUSE_PREFIX } from './production-execution.service';
import type { ProcActor } from './procurement.types';
import { pendingCountReduction, WAREHOUSE_RECORD_PREFIX, type WarehouseRecord } from './warehouse-records.service';
import { isProductionWarehouse } from './inventory-readiness';

export interface WarehouseIssueLine { code: string; name: string; unit: string; quantity: number; issuedQty?: number; signedQty?: number }
export interface WarehouseReconciliation {
  eventId: string; method: 'manual'; result: 'matched' | 'difference' | 'revoked';
  voucherNumber?: string; posted?: boolean; detailsMatch?: boolean;
  lines: Array<{ code: string; voucherLine: string; quantity: number; voucherQuantity: number }>;
}
export interface WarehouseReconcileInput {
  requestId: string; version: number; eventId: string; reason: string; revoke?: boolean;
  voucherNumber?: string; posted?: boolean; detailsMatch?: boolean;
  lines?: WarehouseReconciliation['lines'];
}
export interface WarehouseIssue {
  id: string; kind: 'issue'; version: number; status: 'requested' | 'partial' | 'issued' | 'signed' | 'cancelled';
  planId: string; batchId: string; taskId: string; productLine: string; title: string; neededDate: string; recipientId: string; recipientName: string;
  lines: WarehouseIssueLine[]; createdAt: string; createdBy: string; createdByName: string;
  history: Array<{ id: string; action: string; actorId: string; actorName: string; at: string; reason: string; lines?: Array<{ code: string; quantity: number; warehouse?: string }>; erpPosting?: 'pending'; subjectId?: string; reconciliation?: WarehouseReconciliation }>;
}
const key = (id: string) => `${WAREHOUSE_PREFIX}issue:${id}`;
const has = (actor: ProcActor, code: string) => actor.permissions.includes('*') || actor.permissions.includes(code);
const decode = (value: string) => JSON.parse(value) as WarehouseIssue;
const latestCheck = (issue: WarehouseIssue, eventId: string) => [...issue.history].reverse().find((event) => event.reconciliation?.eventId === eventId);
const isSettled = (issue: WarehouseIssue) => issue.status === 'signed' && issue.history.filter((event) => event.action === 'issue').every((event) => latestCheck(issue, event.id)?.reconciliation?.result === 'matched');
@Injectable()
export class WarehouseFlowService {
  constructor(private readonly prisma: PrismaService) {}
  private access(actor: ProcActor) {
    if (!actor.id || (!has(actor, 'page:warehouse-flow') && !has(actor, 'page:production-execution'))) throw new ForbiddenException('没有查看领料业务的权限');
    return has(actor, 'page:warehouse-flow') || has(actor, 'production:plan');
  }
  async list(query: { taskId?: string; status?: string }, actor: ProcActor) {
    const all = this.access(actor);
    if (query.status && !['active', 'all'].includes(query.status)) throw new BadRequestException('领料筛选无效');
    const taskId = query.taskId ? executionText(query.taskId, '作业编号', 128) : null;
    const rows = await this.prisma.runtimeState.findMany({ where: { key: taskId ? key(taskId) : { startsWith: `${WAREHOUSE_PREFIX}issue:` } }, orderBy: { updatedAt: 'desc' } });
    const issues = rows.map((row) => decode(row.value)).filter((row) => (all || row.recipientId === actor.id) && (query.status === 'all' || (row.status !== 'cancelled' && !isSettled(row))));
    const codes = [...new Set(issues.flatMap((row) => row.lines.map((line) => line.code)))];
    const balances = codes.length ? await this.prisma.procInventoryBalance.findMany({ where: { tpInventoryCode: { in: codes } }, select: { tpInventoryCode: true, warehouse: true, unit: true, availableQty: true, syncedAt: true } }) : [];
    return { items: issues, canIssue: has(actor, 'warehouse:issue') && has(actor, 'page:warehouse-flow'), canReconcile: has(actor, 'warehouse:reconcile') && has(actor, 'page:warehouse-flow'),
      balances: balances.map((row) => ({ code: row.tpInventoryCode, warehouse: row.warehouse, unit: row.unit, available: Number(row.availableQty), syncedAt: row.syncedAt?.toISOString() ?? null })) };
  }
  async command(id: string, input: { requestId: string; version: number; action: string; reason: string; lines: Array<{ code: string; quantity: number; warehouse?: string }> }, actor: ProcActor) {
    this.access(actor);
    if (!input || !['issue', 'sign'].includes(input.action)) throw new BadRequestException('不支持的领料操作');
    if (input.action === 'issue' && (!has(actor, 'page:warehouse-flow') || !has(actor, 'warehouse:issue'))) throw new ForbiddenException('需要仓库发料权限');
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(input.requestId) || !Number.isSafeInteger(input.version) || input.version < 1) throw new BadRequestException('领料提交标识或版本无效');
    const reason = executionText(input.reason, '办理依据', 2000);
    if (!Array.isArray(input.lines) || input.lines.length === 0 || input.lines.length > 2000) throw new BadRequestException('请填写本次办理的物料数量');
    const seen = new Set<string>();
    const lines = input.lines.map((row) => {
      const code = executionText(row?.code, '物料编码');
      if (seen.has(code)) throw new BadRequestException('同一物料不能重复提交');
      seen.add(code);
      return { code, quantity: executionQty(row.quantity, '本次数量', true), ...(input.action === 'issue' ? { warehouse: executionText(row.warehouse, '发料仓库') } : {}) };
    });
    const requestKey = `${WAREHOUSE_PREFIX}request:${input.requestId}`, fingerprint = createHash('sha256').update(JSON.stringify([actor.id, id, input.version, input.action, reason, lines])).digest('hex');
    try {
      return await this.prisma.$transaction(async (db) => {
        const stored = await db.runtimeState.findUnique({ where: { key: key(id) } });
        if (!stored) throw new NotFoundException('领料需求不存在');
        const issue = decode(stored.value);
        if (input.action === 'sign' && issue.recipientId !== actor.id) throw new ForbiddenException('仅本作业领料人可以确认签收，不能代替他人签收');
        const previous = await db.runtimeState.findUnique({ where: { key: requestKey } });
        if (previous) { if (previous.value !== fingerprint) throw new ConflictException('提交标识已用于其他内容'); return { id }; }
        if (issue.version !== input.version) throw new ConflictException('领料记录已更新，请保留草稿后重新核对');
        if (issue.status === 'cancelled' || issue.status === 'signed') throw new ConflictException('该领料单已取消或已全部签收');
        const otherRows = input.action === 'issue' ? await db.runtimeState.findMany({ where: { key: { startsWith: `${WAREHOUSE_PREFIX}issue:` } } }) : [];
        const outstanding = otherRows.map((row) => decode(row.value)).flatMap((row) => row.history.filter((event) => event.action === 'issue').flatMap((event) => {
          const checked = latestCheck(row, event.id);
          return (event.lines ?? []).map((line) => ({ ...line, checkedAt: checked?.reconciliation?.result === 'matched' ? checked.at : null }));
        }));
        for (const item of lines) {
          const line = issue.lines.find((row) => row.code === item.code);
          if (!line) throw new BadRequestException('物料不属于本次派工领料需求');
          if (input.action === 'issue') {
            if (new Prisma.Decimal(line.issuedQty ?? 0).plus(item.quantity).gt(line.quantity)) throw new BadRequestException(`${line.name}累计发料不能超过需求数量`);
            const balance = await db.procInventoryBalance.findUnique({ where: { tpInventoryCode_warehouse: { tpInventoryCode: item.code, warehouse: item.warehouse! } } });
            if (!balance || !balance.syncedAt || !balance.unit || balance.unit !== line.unit) throw new BadRequestException(`${line.name}仓库库存、单位或同步依据待核对`);
            const snapshotAt = balance.syncedAt;
            const pending = outstanding.filter((row) => row.code === item.code && row.warehouse === item.warehouse && (!row.checkedAt || snapshotAt <= new Date(row.checkedAt))).reduce((sum, row) => sum.plus(row.quantity), new Prisma.Decimal(0));
            const records = (await db.runtimeState.findMany({ where: { key: { startsWith: `${WAREHOUSE_RECORD_PREFIX}record:` } } })).map(row => JSON.parse(row.value) as WarehouseRecord);
            const allocations = await db.runtimeState.findMany({ where: { key: { startsWith: 'procurement:readiness:v1:allocation:' } } });
            const otherReserved = allocations.map(row => JSON.parse(row.value)).filter(row => row.code === item.code && row.planId !== issue.planId).reduce((sum, row) => sum.plus(row.quantity), new Prisma.Decimal(0));
            if (balance.availableQty.minus(pending).minus(pendingCountReduction(records, item.code, item.warehouse!, snapshotAt)).lt(item.quantity)) throw new ConflictException(`${line.name}库存不足，或既有发料、盘点尚未核对；请先核对库存与未过账发料`);
            if (isProductionWarehouse(item.warehouse!) && otherReserved.gt(0)) {
              const pool = await db.procInventoryBalance.findMany({ where: { tpInventoryCode: item.code } });
              const poolAvailable = pool.filter(row => isProductionWarehouse(row.warehouse) && row.unit === line.unit && row.syncedAt).reduce((sum, row) => {
                const held = outstanding.filter(entry => entry.code === item.code && entry.warehouse === row.warehouse && (!entry.checkedAt || row.syncedAt! <= new Date(entry.checkedAt))).reduce((total, entry) => total.plus(entry.quantity), new Prisma.Decimal(0));
                return sum.plus(row.availableQty).minus(held).minus(pendingCountReduction(records, item.code, row.warehouse, row.syncedAt));
              }, new Prisma.Decimal(0));
              if (poolAvailable.minus(otherReserved).lt(item.quantity)) throw new ConflictException(`${line.name}量产仓可用量扣除其他计划占用后不足`);
            }
            const allocationKey = `procurement:readiness:v1:allocation:${issue.planId}:${item.code}`;
            const allocation = allocations.find(row => row.key === allocationKey);
            if (allocation) {
              const before = JSON.parse(allocation.value);
              const changed = await db.runtimeState.updateMany({ where: { key: allocationKey, value: allocation.value }, data: { value: JSON.stringify({ ...before, quantity: Prisma.Decimal.max(new Prisma.Decimal(before.quantity).minus(item.quantity), 0).toNumber(), reason: `发料占用转实物交接：${reason}`, actorId: actor.id, actorName: actor.name, at: new Date().toISOString() }) } });
              if (changed.count !== 1) throw new ConflictException('计划占用已变化');
            }
            line.issuedQty = new Prisma.Decimal(line.issuedQty ?? 0).plus(item.quantity).toNumber();
          } else {
            if (new Prisma.Decimal(line.signedQty ?? 0).plus(item.quantity).gt(line.issuedQty ?? 0)) throw new BadRequestException(`${line.name}签收数量不能超过已发未签数量`);
            line.signedQty = new Prisma.Decimal(line.signedQty ?? 0).plus(item.quantity).toNumber();
          }
        }
        issue.status = issue.lines.every((row) => row.signedQty === row.quantity) ? 'signed' : issue.lines.every((row) => row.issuedQty === row.quantity) ? 'issued' : 'partial';
        issue.version++;
        const event: WarehouseIssue['history'][number] = { id: randomUUID(), action: input.action, actorId: actor.id, actorName: actor.name, at: new Date().toISOString(), reason, lines, ...(input.action === 'issue' ? { erpPosting: 'pending' } : {}) };
        issue.history.push(event);
        const changed = await db.runtimeState.updateMany({ where: { key: key(id), value: stored.value }, data: { value: JSON.stringify(issue) } });
        if (changed.count !== 1) throw new ConflictException('领料记录已被更新，请重新核对');
        await db.runtimeState.create({ data: { key: requestKey, value: fingerprint } });
        await db.auditLog.create({ data: { module: 'procurement', source: 'web', action: `warehouse.${input.action}`, resource: 'production-material-request', resourceId: id,
          userId: actor.id, actorName: actor.name, summary: `${input.action === 'issue' ? '登记生产发料' : '现场确认签收'}：${issue.title}`, meta: JSON.parse(JSON.stringify(event)) } });
        return { id };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034', 'P2025'].includes(error.code)) throw new ConflictException('仓库记录正在更新，请保留草稿后重试'); throw error; }
  }

  async reconcile(id: string, input: WarehouseReconcileInput, actor: ProcActor) {
    this.access(actor);
    if (!has(actor, 'page:warehouse-flow') || !has(actor, 'warehouse:reconcile')) throw new ForbiddenException('需要独立的 T+ 过账核对权限');
    if (!input || !/^[A-Za-z0-9_-]{16,128}$/.test(input.requestId) || !Number.isSafeInteger(input.version) || input.version < 1) throw new BadRequestException('核对提交标识或版本无效');
    if (input.revoke !== undefined && typeof input.revoke !== 'boolean') throw new BadRequestException('撤回标识无效');
    const eventId = executionText(input.eventId, '发料记录编号', 128), reason = executionText(input.reason, '凭证依据与核对说明', 2000);
    const reconciliation: WarehouseReconciliation = { eventId, method: 'manual', result: input.revoke ? 'revoked' : 'difference', lines: [] };
    if (!input.revoke) {
      reconciliation.voucherNumber = executionText(input.voucherNumber, 'T+ 出库单号', 128).normalize('NFKC').toUpperCase();
      if (typeof input.posted !== 'boolean' || typeof input.detailsMatch !== 'boolean') throw new BadRequestException('请明确凭证生效状态与明细核对结果');
      reconciliation.posted = input.posted; reconciliation.detailsMatch = input.detailsMatch;
      if (!Array.isArray(input.lines) || !input.lines.length || input.lines.length > 2000) throw new BadRequestException('请逐项填写凭证明细');
      const codes = new Set<string>(), voucherLines = new Set<string>();
      reconciliation.lines = input.lines.map((line) => {
        const code = executionText(line?.code, '物料编码'), rawLine = executionText(line?.voucherLine, '凭证明细行号', 128).normalize('NFKC');
        if (!/^\d+$/.test(rawLine) || !Number.isSafeInteger(Number(rawLine)) || Number(rawLine) < 1) throw new BadRequestException('凭证明细行号须为从1开始的正整数');
        const voucherLine = String(Number(rawLine));
        if (codes.has(code) || voucherLines.has(voucherLine)) throw new BadRequestException('物料或凭证明细行不能重复');
        codes.add(code); voucherLines.add(voucherLine);
        const quantity = executionQty(line.quantity, '本次对应数量'), voucherQuantity = executionQty(line.voucherQuantity, '凭证行总数量');
        if (quantity > voucherQuantity) throw new BadRequestException('本次对应数量不能超过凭证行总数量');
        return { code, voucherLine, quantity, voucherQuantity };
      });
    }
    const requestKey = `${WAREHOUSE_PREFIX}request:${input.requestId}`;
    const fingerprint = createHash('sha256').update(JSON.stringify([actor.id, id, input.version, reason, reconciliation])).digest('hex');
    try {
      return await this.prisma.$transaction(async (db) => {
        const stored = await db.runtimeState.findUnique({ where: { key: key(id) } });
        if (!stored) throw new NotFoundException('领料需求不存在');
        const issue = decode(stored.value);
        const previous = await db.runtimeState.findUnique({ where: { key: requestKey } });
        if (previous) { if (previous.value !== fingerprint) throw new ConflictException('提交标识已用于其他内容'); return { id }; }
        if (issue.version !== input.version) throw new ConflictException('领料记录已更新，请保留草稿后重新核对');
        const source = issue.history.find((event) => event.id === eventId && event.action === 'issue');
        if (!source?.lines?.length || issue.status === 'cancelled') throw new BadRequestException('没有可核对的发料记录');
        const current = latestCheck(issue, eventId)?.reconciliation;
        if (input.revoke) {
          if (!current || current.result === 'revoked') throw new ConflictException('没有可撤回的核对记录');
        } else {
          if (current?.result === 'matched') throw new ConflictException('已核对一致，如需更正请先撤回并填写原因');
          if (reconciliation.lines.length !== source.lines.length || source.lines.some((line) => !reconciliation.lines.some((row) => row.code === line.code))) throw new BadRequestException('必须覆盖本次发料的全部物料');
          reconciliation.result = reconciliation.posted && reconciliation.detailsMatch && source.lines.every((line) => reconciliation.lines.find((row) => row.code === line.code)!.quantity === line.quantity) ? 'matched' : 'difference';
          if (reconciliation.result === 'matched') {
            const rows = await db.runtimeState.findMany({ where: { key: { startsWith: `${WAREHOUSE_PREFIX}issue:` } } });
            const claims = rows.map((row) => decode(row.value)).flatMap((row) => row.history.filter((event) => event.action === 'issue').flatMap((event) => {
              const check = latestCheck(row, event.id)?.reconciliation;
              return check?.result === 'matched' && check.voucherNumber === reconciliation.voucherNumber ? check.lines.map((line) => ({ ...line, warehouse: event.lines?.find((item) => item.code === line.code)?.warehouse, unit: row.lines.find((item) => item.code === line.code)?.unit })) : [];
            }));
            for (const line of reconciliation.lines) {
              const used = claims.filter((claim) => claim.voucherLine === line.voucherLine);
              if (used.some((claim) => claim.code !== line.code || claim.voucherQuantity !== line.voucherQuantity || claim.warehouse !== source.lines!.find((item) => item.code === line.code)?.warehouse || claim.unit !== issue.lines.find((item) => item.code === line.code)?.unit)) throw new ConflictException('该 T+ 凭证行已有不同物料、仓库、单位或总数量的核对记录，请先核实');
              if (used.reduce((sum, claim) => sum.plus(claim.quantity), new Prisma.Decimal(line.quantity)).gt(line.voucherQuantity)) throw new ConflictException('该 T+ 凭证明细数量已被其他发料核销，不能重复使用');
            }
          }
        }
        const event: WarehouseIssue['history'][number] = { id: randomUUID(), action: 'reconcile', actorId: actor.id, actorName: actor.name, at: new Date().toISOString(), reason, reconciliation };
        issue.version++; issue.history.push(event);
        const changed = await db.runtimeState.updateMany({ where: { key: key(id), value: stored.value }, data: { value: JSON.stringify(issue) } });
        if (changed.count !== 1) throw new ConflictException('领料记录已被更新，请重新核对');
        await db.runtimeState.create({ data: { key: requestKey, value: fingerprint } });
        await db.auditLog.create({ data: { module: 'procurement', source: 'web', action: 'warehouse.reconcile', resource: 'production-material-request', resourceId: id, userId: actor.id, actorName: actor.name, summary: `T+ 人工核对：${issue.title}`, meta: JSON.parse(JSON.stringify(event)) } });
        return { id };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034', 'P2025'].includes(error.code)) throw new ConflictException('核对记录正在更新，请保留草稿后重试'); throw error; }
  }
}
