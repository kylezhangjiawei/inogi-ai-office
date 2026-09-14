import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';

export const DELIVERY_PREFIX = 'procurement:delivery:v1:';
export const deliveryKey = (kind: 'supplier' | 'erp', lineId: string) => `${DELIVERY_PREFIX}${kind}:current:${lineId}`;
export const deliveryHistoryPrefix = (kind: 'supplier' | 'erp', lineId: string) => `${DELIVERY_PREFIX}${kind}:history:${lineId}:`;
export const deliveryHistoryKey = (kind: 'supplier' | 'erp', lineId: string, version: number) => `${deliveryHistoryPrefix(kind, lineId)}${String(version).padStart(12, '0')}`;
export const deliveryHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const deliveryDay = (value: Date | null | undefined) => value ? value.toISOString().slice(0, 10) : null;
export const DELIVERY_READ_PERMISSIONS = ['page:purchase-orders', 'page:purchase-order-detail'];
export const DELIVERY_WRITE_PERMISSION = 'proc-purchase-order:record-commitment';

export interface SupplierDeliveryEntry {
  version: number; kind: 'original' | 'revision' | 'withdrawal'; before: string | null; after: string | null;
  communicatedOn: string; evidence: string; reason: string; actorId: string; actorName: string; recordedAt: string;
  sourceIdentity: string; source: Record<string, string | null>;
}
export interface SupplierDeliveryState {
  version: number; originalDate: string | null; currentDate: string | null; sourceIdentity: string;
  lastEntry: SupplierDeliveryEntry;
}
export interface ErpDeliveryEntry {
  version: number; kind: 'baseline' | 'change'; before: string | null; after: string | null;
  beforeOrderDate: string | null; afterOrderDate: string | null; recordedAt: string;
  source: Record<string, string | null>;
}
export interface ErpDeliveryState {
  version: number; currentDate: string | null; orderDate: string | null; coverageStartedAt: string;
  sourceIdentity: string;
}

export function deliverySource(line: {
  tpOrderId?: string | null; tpOrderNo: string; tpLineNo: string; inventoryCode: string; inventoryName: string;
  spec: string; unit: string; supplierName: string; orderedQty: unknown;
}) {
  return { orderId: line.tpOrderId ?? null, orderNo: line.tpOrderNo, lineNo: line.tpLineNo,
    inventoryCode: line.inventoryCode, inventoryName: line.inventoryName, spec: line.spec,
    unit: line.unit, supplierName: line.supplierName, orderedQty: String(line.orderedQty) };
}
export const deliverySourceIdentity = (line: Parameters<typeof deliverySource>[0]) => deliveryHash(deliverySource(line));

const validDay = (value: unknown) => value === null || (typeof value === 'string' && /^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)) && deliveryDay(new Date(`${value}T00:00:00.000Z`)) === value);
const validInstant = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const sourceShape = (value: unknown) => Boolean(value && typeof value === 'object' && !Array.isArray(value) && ['orderNo', 'lineNo', 'inventoryCode', 'inventoryName', 'spec', 'unit', 'supplierName', 'orderedQty'].every((key) => typeof (value as Record<string, unknown>)[key] === 'string') && ((value as Record<string, unknown>).orderId === null || typeof (value as Record<string, unknown>).orderId === 'string'));
const identityShape = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function parseDeliveryState<T extends { version: number }>(value: string | undefined | null): T | null {
  if (value == null) return null;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || !Number.isSafeInteger(parsed.version) || parsed.version < 1 || parsed.version > 2147483646) throw new Error();
    if ('lastEntry' in parsed) {
      const entry = parseDeliveryState<SupplierDeliveryEntry>(JSON.stringify(parsed.lastEntry));
      if (!entry || !['original', 'revision', 'withdrawal'].includes(entry.kind) || entry.version !== parsed.version || entry.after !== parsed.currentDate || entry.sourceIdentity !== parsed.sourceIdentity || !validDay(parsed.originalDate) || !validDay(parsed.currentDate) || !identityShape(parsed.sourceIdentity)) throw new Error();
    } else if ('coverageStartedAt' in parsed) {
      if (!validDay(parsed.currentDate) || !validDay(parsed.orderDate) || !validInstant(parsed.coverageStartedAt) || !identityShape(parsed.sourceIdentity)) throw new Error();
    } else if (['original', 'revision', 'withdrawal'].includes(parsed.kind)) {
      if (!validDay(parsed.before) || !validDay(parsed.after) || !parsed.communicatedOn || !validDay(parsed.communicatedOn) || !validInstant(parsed.recordedAt) || !sourceShape(parsed.source) || !identityShape(parsed.sourceIdentity) || !['actorId', 'actorName', 'evidence', 'reason'].every((key) => typeof parsed[key] === 'string' && parsed[key].trim())) throw new Error();
      if ((parsed.kind === 'withdrawal') !== (parsed.after === null)) throw new Error();
    } else if (['baseline', 'change'].includes(parsed.kind)) {
      if (!validDay(parsed.before) || !validDay(parsed.after) || !validDay(parsed.beforeOrderDate) || !validDay(parsed.afterOrderDate) || !validInstant(parsed.recordedAt) || !sourceShape(parsed.source)) throw new Error();
    } else throw new Error();
    return parsed;
  } catch { throw new ServiceUnavailableException('交期记录格式异常，请联系管理员核对；原记录未改写'); }
}

export function validateDeliveryDay(value: unknown, label: string, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException(`${label}格式无效`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || deliveryDay(parsed) !== value) throw new BadRequestException(`${label}不存在`);
  return value;
}

/** Keep ERP mirror updates and their observed history in one transaction. Never writes to ERP. */
export async function persistMirrorDelivery(
  prisma: PrismaService, orderNo: string, lineNo: string,
  data: Omit<Prisma.ProcPurchaseOrderMirrorUncheckedCreateInput, 'id' | 'tpOrderNo' | 'tpLineNo'>,
) {
  return prisma.$transaction(async (tx) => {
    const scope = `procurement:delivery:erp:${JSON.stringify([orderNo, lineNo])}`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${scope}, 0))`;
    await tx.$queryRaw`SELECT id FROM "ProcPurchaseOrderMirror" WHERE "tpOrderNo" = ${orderNo} AND "tpLineNo" = ${lineNo} FOR UPDATE`;
    const previous = await tx.procPurchaseOrderMirror.findUnique({ where: { tpOrderNo_tpLineNo: { tpOrderNo: orderNo, tpLineNo: lineNo } } });
    const line = await tx.procPurchaseOrderMirror.upsert({
      where: { tpOrderNo_tpLineNo: { tpOrderNo: orderNo, tpLineNo: lineNo } },
      create: { tpOrderNo: orderNo, tpLineNo: lineNo, ...data }, update: data,
    });
    const key = deliveryKey('erp', line.id);
    const stored = await tx.runtimeState.findUnique({ where: { key } });
    const before = parseDeliveryState<ErpDeliveryState>(stored?.value);
    const currentDate = deliveryDay(line.etaDate), orderDate = deliveryDay(line.orderDate), sourceIdentity = deliverySourceIdentity(line);
    if (before && before.currentDate === currentDate && before.orderDate === orderDate && before.sourceIdentity === sourceIdentity) return line;
    const recordedAt = new Date().toISOString();
    if (before && before.version >= 2147483646) throw new ServiceUnavailableException('ERP 交期历史版本已达上限，请联系管理员');
    const version = (before?.version ?? 0) + 1;
    const previousDate = before ? before.currentDate : deliveryDay(previous?.etaDate);
    const previousOrderDate = before ? before.orderDate : deliveryDay(previous?.orderDate);
    const isChange = Boolean(before || (previous && (previousDate !== currentDate || previousOrderDate !== orderDate || deliverySourceIdentity(previous) !== sourceIdentity)));
    const entry: ErpDeliveryEntry = { version, kind: isChange ? 'change' : 'baseline', before: isChange ? previousDate : null,
      after: currentDate, beforeOrderDate: isChange ? previousOrderDate : null, afterOrderDate: orderDate, recordedAt, source: deliverySource(line) };
    const state: ErpDeliveryState = { version, currentDate, orderDate, sourceIdentity, coverageStartedAt: before?.coverageStartedAt ?? recordedAt };
    await tx.runtimeState.create({ data: { key: deliveryHistoryKey('erp', line.id, version), value: JSON.stringify(entry) } });
    await tx.runtimeState.upsert({ where: { key }, create: { key, value: JSON.stringify(state) }, update: { value: JSON.stringify(state) } });
    await tx.auditLog.create({ data: {
      module: 'procurement', source: 'system', action: 'purchase-order.erp-delivery-observed',
      resource: 'proc-purchase-order-delivery', resourceId: line.id, resourceName: `${orderNo} · ${lineNo}`,
      actorName: 'ERP 只读同步', summary: `${isChange ? '观察到 ERP 交期变化' : '建立 ERP 交期观察基线'}：${orderNo} 第 ${lineNo} 行`,
      meta: { kind: entry.kind, version, coverageStartedAt: state.coverageStartedAt,
        changes: [{ field: 'etaDate', before: entry.before, after: entry.after }, { field: 'orderDate', before: entry.beforeOrderDate, after: entry.afterOrderDate }] },
    } });
    return line;
  });
}
