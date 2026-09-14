import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import type { ProcPurchaseOrderAvailability } from '@prisma/client';
import type { SavePurchaseOrderAvailabilityDto } from './dto/purchase-order-availability.dto';

export interface PurchaseOrderAvailabilitySource {
  tpOrderId: string | null;
  inventoryCode: string;
  inventoryName: string;
  spec: string;
  unit: string;
  orderedQty: unknown;
  receivedQty: unknown;
  etaDate: Date | null;
  approvalStatus: string | null;
  status: string | null;
  supplierName: string;
}

export interface PurchaseOrderAvailabilityView {
  availableDate: string | null;
  note: string;
  confirmedByName: string;
  confirmedAt: string;
  version: number;
  needsReconfirmation: boolean;
}

/** Deliberately excludes sync timestamps, match metadata and local annotation values. */
export function purchaseOrderSourceFingerprint(source: PurchaseOrderAvailabilitySource): string {
  return createHash('sha256').update(JSON.stringify([
    source.tpOrderId, source.inventoryCode, source.inventoryName, source.spec, source.unit,
    String(source.orderedQty), String(source.receivedQty), source.etaDate?.toISOString() ?? null,
    source.approvalStatus, source.status, source.supplierName,
  ])).digest('hex');
}

export function purchaseOrderAvailabilityView(
  record: ProcPurchaseOrderAvailability | null | undefined,
  source: PurchaseOrderAvailabilitySource,
): PurchaseOrderAvailabilityView | null {
  if (!record) return null;
  return {
    availableDate: record.availableDate?.toISOString().slice(0, 10) ?? null,
    note: record.note,
    confirmedByName: record.confirmedByName,
    confirmedAt: record.confirmedAt.toISOString(),
    version: record.version,
    needsReconfirmation: record.availableDate !== null && record.sourceFingerprint !== purchaseOrderSourceFingerprint(source),
  };
}

/** Validate in the service as well as the HTTP DTO so internal callers obey the same rules. */
export function validatePurchaseOrderAvailability(input: SavePurchaseOrderAvailabilityDto) {
  if (!input || typeof input !== 'object') throw new BadRequestException('请填写预计检验后可用日期和确认信息');
  const rawDate = input.availableDate;
  let availableDate: Date | null = null;
  if (rawDate !== null) {
    if (typeof rawDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(rawDate) || rawDate.startsWith('0000-')) {
      throw new BadRequestException('预计检验后可用日期须为有效的 YYYY-MM-DD 日期');
    }
    availableDate = new Date(`${rawDate}T00:00:00.000Z`);
    if (!Number.isFinite(availableDate.getTime()) || availableDate.toISOString().slice(0, 10) !== rawDate) {
      throw new BadRequestException('预计检验后可用日期不存在');
    }
  }
  if (typeof input.note !== 'string' || input.note.length > 1000) throw new BadRequestException('备注不能超过 1000 字');
  const note = input.note.trim();
  if (availableDate === null && !note) throw new BadRequestException('清空预计检验后可用日期时请填写原因');
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0 || input.expectedVersion > 2147483646) {
    throw new BadRequestException('确认记录版本无效，请重新载入订单');
  }
  const sourceVersion = input.expectedSourceUpdatedAt;
  if (typeof sourceVersion !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(sourceVersion)
    || !Number.isFinite(Date.parse(sourceVersion)) || new Date(sourceVersion).toISOString() !== sourceVersion) {
    throw new BadRequestException('订单来源版本无效，请重新载入订单');
  }
  return { availableDate, note };
}
