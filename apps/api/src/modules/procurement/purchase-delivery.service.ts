import { deliveryDatePage, purchaseTiming } from './purchase-timing';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { ProcActor } from './procurement.types';
import type { RecordSupplierCommitmentDto } from './dto/purchase-delivery.dto';
import { ProductionReadinessService } from './production-readiness.service';
import { purchaseDeliveryImpacts } from './purchase-delivery-impact';
import { DELIVERY_PREFIX, DELIVERY_READ_PERMISSIONS, DELIVERY_WRITE_PERMISSION, deliveryDay, deliveryHash, deliveryHistoryKey, deliveryHistoryPrefix,
  deliveryKey, deliverySource, deliverySourceIdentity, parseDeliveryState, validateDeliveryDay,
  type SupplierDeliveryEntry, type SupplierDeliveryState, type ErpDeliveryEntry, type ErpDeliveryState } from './purchase-delivery-store';

type Db = Prisma.TransactionClient;
type Query = Record<string, unknown>;
const text = (value: unknown, name: string, limit = 2000) => {
  if (typeof value !== 'string' || !value.trim() || value.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new BadRequestException(`请填写有效的${name}`);
  return value.trim();
};
const pageNumber = (value: unknown, fallback = 1, max = 1000000) => {
  if (value == null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > max) throw new BadRequestException('分页参数无效');
  return number;
};

@Injectable()
export class PurchaseDeliveryService {
  constructor(private readonly prisma: PrismaService, @Optional() private readonly readiness?: ProductionReadinessService) {}
  private permission(actor: ProcActor, write = false) {
    if (!actor.id || (!actor.permissions.includes('*') && (write
      ? !['page:purchase-order-detail', DELIVERY_WRITE_PERMISSION].every((permission) => actor.permissions.includes(permission))
      : !DELIVERY_READ_PERMISSIONS.some((permission) => actor.permissions.includes(permission))))) throw new ForbiddenException('没有读取或登记订单交期的权限');
  }
  private canRecord(actor: ProcActor) { return actor.permissions.includes('*') || ['page:purchase-order-detail', DELIVERY_WRITE_PERMISSION].every((permission) => actor.permissions.includes(permission)); }
  private async line(db: Db, lineId: string, orderNo: string) {
    const line = await db.procPurchaseOrderMirror.findFirst({ where: { id: lineId, tpOrderNo: orderNo } });
    if (!line) throw new NotFoundException('该订单的镜像行不存在，请刷新后核对');
    return line;
  }
  private async history<T extends { version: number }>(db: Db, kind: 'supplier' | 'erp', lineId: string, requested: number) {
    const where = { key: { startsWith: deliveryHistoryPrefix(kind, lineId) } };
    const total = await db.runtimeState.count({ where }), pageSize = 10;
    const totalPages = Math.max(1, Math.ceil(total / pageSize)), page = Math.min(requested, totalPages);
    const rows = await db.runtimeState.findMany({ where, orderBy: { key: 'desc' }, skip: (page - 1) * pageSize, take: pageSize });
    return { items: rows.map((row) => parseDeliveryState<T>(row.value)!), page, pageSize, total, totalPages };
  }
  private async detail(db: Db, line: Awaited<ReturnType<PurchaseDeliveryService['line']>>, actor: ProcActor, supplierPage = 1, erpPage = 1) {
    const [promise, observed, supplierHistory, erpHistory] = await Promise.all([
      db.runtimeState.findUnique({ where: { key: deliveryKey('supplier', line.id) } }),
      db.runtimeState.findUnique({ where: { key: deliveryKey('erp', line.id) } }),
      this.history<SupplierDeliveryEntry>(db, 'supplier', line.id, supplierPage), this.history<ErpDeliveryEntry>(db, 'erp', line.id, erpPage),
    ]);
    const supplier = parseDeliveryState<SupplierDeliveryState>(promise?.value), erp = parseDeliveryState<ErpDeliveryState>(observed?.value);
    return { line: { id: line.id, ...deliverySource(line), sourceUpdatedAt: line.updatedAt.toISOString(), orderDate: deliveryDay(line.orderDate),
      erpExpectedDate: deliveryDay(line.etaDate), syncedAt: line.syncedAt?.toISOString() ?? null },
      canRecord: this.canRecord(actor), supplier: supplier ? { ...supplier, sourceChanged: supplier.sourceIdentity !== deliverySourceIdentity(line) } : null,
      supplierHistory, erp: erp ? { ...erp, currentDate: deliveryDay(line.etaDate) } : null, erpHistory,
      historyNotice: 'ERP 历史从启用后的首次观察开始记录；观察时间不是供应商改期时间，旧历史不作补造。' };
  }
  async get(lineId: string, query: Query, actor: ProcActor) {
    this.permission(actor); const orderNo = text(query.orderNo, '订单号', 256);
    const supplierPage = pageNumber(query.supplierPage), erpPage = pageNumber(query.erpPage);
    return this.prisma.$transaction(async (db) => this.detail(db, await this.line(db, lineId, orderNo), actor, supplierPage, erpPage), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
  async impacts(lineId: string, query: Query, actor: ProcActor) {
    this.permission(actor);
    if (!actor.permissions.includes('*') && (!actor.permissions.includes('page:production-execution') || !actor.permissions.some(permission => ['production:plan', 'production:view-all', 'production:inspect'].includes(permission)))) throw new ForbiddenException('查看影响计划需要原生产齐套读取权限');
    const orderNo = text(query.orderNo, '订单号', 256), page = pageNumber(query.page);
    if (!this.readiness) throw new ConflictException('齐套服务暂不可用，请稍后重新读取');
    return this.prisma.$transaction(async db => purchaseDeliveryImpacts(db, this.readiness!, await this.line(db, lineId, orderNo), page), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
  async record(lineId: string, input: RecordSupplierCommitmentDto, actor: ProcActor) {
    this.permission(actor, true);
    if (!input || typeof input.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(input.requestId)) throw new BadRequestException('提交标识无效');
    const orderNo = text(input.orderNo, '订单号', 256), evidence = text(input.evidence, '承诺凭据或出处'), reason = text(input.reason, '登记或改期原因');
    const promisedDate = validateDeliveryDay(input.promisedDate, '供应商承诺日期', true), communicatedOn = validateDeliveryDay(input.communicatedOn, '供应商沟通日期')!;
    if (communicatedOn > new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)) throw new BadRequestException('供应商沟通日期不能晚于今天');
    if (typeof input.declareOriginal !== 'boolean' || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0 || input.expectedVersion > 2147483645) throw new BadRequestException('记录版本无效');
    if (typeof input.expectedSourceUpdatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.expectedSourceUpdatedAt)
      || !Number.isFinite(Date.parse(input.expectedSourceUpdatedAt)) || new Date(input.expectedSourceUpdatedAt).toISOString() !== input.expectedSourceUpdatedAt) throw new BadRequestException('订单来源版本无效');
    const fingerprint = deliveryHash({ lineId, orderNo, evidence, reason, promisedDate, communicatedOn, original: input.declareOriginal, version: input.expectedVersion, source: input.expectedSourceUpdatedAt });
    const requestKey = `${DELIVERY_PREFIX}request:${deliveryHash(input.requestId)}`;
    return this.prisma.$transaction(async (db) => {
      await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${requestKey}, 0))::text`;
      await db.$queryRaw`SELECT id FROM "ProcPurchaseOrderMirror" WHERE id = ${lineId} AND "tpOrderNo" = ${orderNo} FOR UPDATE`;
      const line = await this.line(db, lineId, orderNo);
      const repeated = await db.runtimeState.findUnique({ where: { key: requestKey } });
      if (repeated) {
        let saved: { actorId: string; fingerprint: string };
        try { saved = JSON.parse(repeated.value); } catch { throw new ConflictException('提交标识已使用，请重新打开表单'); }
        if (saved.actorId !== actor.id || saved.fingerprint !== fingerprint) throw new ConflictException('提交标识已用于其他记录，请重新打开表单');
        return this.detail(db, line, actor);
      }
      const key = deliveryKey('supplier', line.id);
      const stored = await db.runtimeState.findUnique({ where: { key } });
      const before = parseDeliveryState<SupplierDeliveryState>(stored?.value);
      if (line.updatedAt.toISOString() !== input.expectedSourceUpdatedAt || (before?.version ?? 0) !== input.expectedVersion) throw new ConflictException('订单来源或供应商承诺已变化，请保留草稿并重新载入后核对');
      if (input.declareOriginal && (before || !promisedDate)) throw new BadRequestException('仅首次有凭据登记时可声明供应商最初承诺');
      const version = input.expectedVersion + 1, sourceIdentity = deliverySourceIdentity(line);
      const entry: SupplierDeliveryEntry = { version, kind: input.declareOriginal ? 'original' : promisedDate ? 'revision' : 'withdrawal',
        before: before?.currentDate ?? null, after: promisedDate, communicatedOn, evidence, reason, actorId: actor.id, actorName: actor.name,
        recordedAt: new Date().toISOString(), sourceIdentity, source: deliverySource(line) };
      // Earlier original promises remain in immutable history. They cannot become the
      // original promise of a changed supplier/material/quantity after reconfirmation.
      const originalDate = before ? before.sourceIdentity === sourceIdentity ? before.originalDate : null : input.declareOriginal ? promisedDate : null;
      const state: SupplierDeliveryState = { version, originalDate, currentDate: promisedDate, sourceIdentity, lastEntry: entry };
      await db.runtimeState.create({ data: { key: deliveryHistoryKey('supplier', line.id, version), value: JSON.stringify(entry) } });
      await db.runtimeState.upsert({ where: { key }, create: { key, value: JSON.stringify(state) }, update: { value: JSON.stringify(state) } });
      await db.runtimeState.create({ data: { key: requestKey, value: JSON.stringify({ actorId: actor.id, fingerprint, version }) } });
      await db.auditLog.create({ data: { module: 'procurement', source: 'web', action: 'purchase-order.supplier-commitment-recorded',
        resource: 'proc-purchase-order-delivery', resourceId: line.id, resourceName: `${orderNo} · ${line.tpLineNo}`,
        userId: actor.id, actorName: actor.name, summary: `${promisedDate ? '登记供应商承诺' : '撤销供应商承诺日期'}：${orderNo} 第 ${line.tpLineNo} 行`,
        meta: { version, evidence, reason, communicatedOn, kind: entry.kind,
          changes: [{ field: 'supplierPromisedDate', before: entry.before, after: entry.after }, { field: 'originalDate', before: before?.originalDate ?? null, after: state.originalDate }] } } });
      return this.detail(db, line, actor);
    });
  }

  async schedule(query: Query, actor: ProcActor) {
    this.permission(actor);
    const month = typeof query.month === 'string' ? query.month : '';
    if (!/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new BadRequestException('请选择有效月份');
    const start = new Date(`${month}-01T00:00:00.000Z`), end = new Date(start); end.setUTCMonth(end.getUTCMonth() + 1);
    const dateBasis = query.dateBasis ?? 'erp';
    if (!['erp', 'latest', 'available'].includes(String(dateBasis))) throw new BadRequestException('日期口径无效');
    const bucket = query.bucket ?? 'month';
    if (!['month', 'all', 'undated', 'outside'].includes(String(bucket))) throw new BadRequestException('日期范围无效');
    const date = query.date ? validateDeliveryDay(query.date, '所选日期') : null;
    if (date && !date.startsWith(month + '-')) throw new BadRequestException('所选日期不在当前月份');
    const keyword = query.q == null ? '' : String(query.q).trim(), supplier = query.supplier == null ? '' : String(query.supplier).trim();
    if (keyword.length > 200 || supplier.length > 200) throw new BadRequestException('筛选内容过长');
    const pageSize = pageNumber(query.pageSize, 20, 50), requested = pageNumber(query.page);
    const where: Prisma.ProcPurchaseOrderMirrorWhereInput = { ...(supplier ? { supplierName: supplier } : {}),
      ...(keyword ? { OR: ['tpOrderNo', 'inventoryCode', 'inventoryName', 'spec', 'supplierName'].map((field) => ({ [field]: { contains: keyword, mode: 'insensitive' } })) } : {}) };
    return this.prisma.$transaction(async (db) => {
      if (dateBasis !== 'erp') {
        const all = await db.procPurchaseOrderMirror.findMany({ where, include: { availability: true }, orderBy: { id: 'asc' } });
        const promises = all.length ? await db.runtimeState.findMany({ where: { key: { in: all.map(row => deliveryKey('supplier', row.id)) } } }) : [];
        const byKey = new Map(promises.map(row => [row.key, parseDeliveryState<SupplierDeliveryState>(row.value)]));
        const snapshot = deliveryHash([actor.id, [...actor.permissions].sort(), month, keyword, supplier, dateBasis, all, promises]);
        if (query.snapshot && query.snapshot !== snapshot) throw new ConflictException('订单、承诺或可用日已更新，请刷新日期视图后继续翻页');
        const rows = all.map(row => {
          const timing = purchaseTiming(row, row.availability, byKey.get(deliveryKey('supplier', row.id)));
          return { lineId: row.id, orderNo: row.tpOrderNo, lineNo: row.tpLineNo, inventoryCode: row.inventoryCode, inventoryName: row.inventoryName,
            spec: row.spec, supplierName: row.supplierName, unit: row.unit, orderedQty: Number(row.orderedQty), receivedQty: Number(row.receivedQty),
            orderDate: deliveryDay(row.orderDate), erpExpectedDate: timing.erpDate, sourceUpdatedAt: row.updatedAt.toISOString(),
            supplierPromisedDate: timing.promisedDate, supplierSourceChanged: timing.supplierSourceChanged,
            calendarDate: dateBasis === 'available' ? timing.confirmedAvailableDate : timing.latestDate,
            availableDate: timing.availableDate, dateNeedsReconfirmation: timing.needsReconfirmation, timingNote: timing.note, latestSource: timing.latestSource,
            status: row.status, approvalStatus: row.approvalStatus };
        });
        return { scope: 'permission-visible-erp-mirror' as const, source: 'tplus' as const, snapshot, month, dateBasis,
          syncedAt: all.map(row => row.syncedAt?.toISOString()).filter(Boolean).sort().at(-1) ?? null,
          oldestOrderDate: all.map(row => deliveryDay(row.orderDate)).filter(Boolean).sort()[0] ?? null,
          ...deliveryDatePage(rows, month, String(bucket), date, requested, pageSize) };
      }
      const [source, promiseVersion] = await Promise.all([
        db.procPurchaseOrderMirror.aggregate({ where, _count: { _all: true }, _max: { updatedAt: true, syncedAt: true }, _min: { orderDate: true } }),
        db.runtimeState.aggregate({ where: { key: { startsWith: `${DELIVERY_PREFIX}supplier:current:` } }, _max: { updatedAt: true } }),
      ]);
      const snapshot = deliveryHash([actor.id, [...actor.permissions].sort(), month, keyword, supplier, source._count._all, source._max.updatedAt?.toISOString(), promiseVersion._max.updatedAt?.toISOString()]);
      if (query.snapshot && query.snapshot !== snapshot) throw new ConflictException('镜像或承诺记录已更新，请刷新日期视图后继续翻页');
      const groupWhere = { AND: [where, { etaDate: { gte: start, lt: end } }] };
      const [groups, undated] = await Promise.all([
        db.procPurchaseOrderMirror.groupBy({ by: ['etaDate'], where: groupWhere, _count: { _all: true } }),
        db.procPurchaseOrderMirror.count({ where: { AND: [where, { etaDate: null }] } }),
      ]);
      const dateCounts = new Map<string, number>();
      for (const group of groups) { const day = deliveryDay(group.etaDate)!; dateCounts.set(day, (dateCounts.get(day) ?? 0) + group._count._all); }
      const inMonth = [...dateCounts.values()].reduce((sum, count) => sum + count, 0);
      const dayStart = date ? new Date(`${date}T00:00:00.000Z`) : null;
      const filter: Prisma.ProcPurchaseOrderMirrorWhereInput = date ? { etaDate: { gte: dayStart!, lt: new Date(dayStart!.getTime() + 86400000) } }
        : bucket === 'month' ? { etaDate: { gte: start, lt: end } } : bucket === 'undated' ? { etaDate: null }
          : bucket === 'outside' ? { OR: [{ etaDate: { lt: start } }, { etaDate: { gte: end } }] } : {};
      const filtered = { AND: [where, filter] };
      const total = await db.procPurchaseOrderMirror.count({ where: filtered }), totalPages = Math.max(1, Math.ceil(total / pageSize)), page = Math.min(requested, totalPages);
      const rows = await db.procPurchaseOrderMirror.findMany({ where: filtered, orderBy: [{ etaDate: 'asc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize });
      const promises = await db.runtimeState.findMany({ where: { key: { in: rows.map((row) => deliveryKey('supplier', row.id)) } } });
      const byKey = new Map(promises.map((row) => [row.key, parseDeliveryState<SupplierDeliveryState>(row.value)]));
      return { scope: 'permission-visible-erp-mirror' as const, source: 'tplus' as const, snapshot, month,
        syncedAt: source._max.syncedAt?.toISOString() ?? null, oldestOrderDate: deliveryDay(source._min.orderDate),
        summary: { all: source._count._all, inMonth, undated, outside: source._count._all - inMonth - undated },
        days: [...dateCounts].map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date)),
        rows: { page, pageSize, total, totalPages, items: rows.map((row) => { const promise = byKey.get(deliveryKey('supplier', row.id)); return {
          lineId: row.id, orderNo: row.tpOrderNo, lineNo: row.tpLineNo, inventoryCode: row.inventoryCode, inventoryName: row.inventoryName,
          spec: row.spec, supplierName: row.supplierName, unit: row.unit, orderedQty: Number(row.orderedQty), receivedQty: Number(row.receivedQty),
          orderDate: deliveryDay(row.orderDate), erpExpectedDate: deliveryDay(row.etaDate), sourceUpdatedAt: row.updatedAt.toISOString(),
          supplierPromisedDate: promise?.currentDate ?? null, supplierSourceChanged: Boolean(promise && promise.sourceIdentity !== deliverySourceIdentity(row)),
          status: row.status, approvalStatus: row.approvalStatus,
        }; }) } };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
}
