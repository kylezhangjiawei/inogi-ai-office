import { BadRequestException, ConflictException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { executionText } from './production-execution.model';
import { activeVersionRanges, type BatchVersionRange } from './production-lifecycle-records';

/** The version is frozen when an existing serial is linked, never inferred from batch quantity. */
export type ShipmentSerial = { number: string; versionRangeId: string; softwareVersion: string; hardwareVersion: string };
export type ShipmentSerialHistory = { action: 'bind' | 'reverse'; serials: ShipmentSerial[]; actorId: string; actorName: string; at: string; reason: string };
export type ShipmentSerialRecord = { id: string; batchId: string; quantity: number; serials?: ShipmentSerial[]; serialHistory?: ShipmentSerialHistory[]; reversed?: unknown };
export const canonicalSerial = (value: string) => value.normalize('NFKC').toUpperCase();
const claimKey = (number: string) => `procurement:lifecycle:v1:shipment-sn:${createHash('sha256').update(canonicalSerial(number)).digest('hex')}`;

export function shipmentSerialValues(value: unknown, shipment: ShipmentSerialRecord, ranges: BatchVersionRange[], shipments: ShipmentSerialRecord[]): ShipmentSerial[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 10000) throw new BadRequestException('发货 SN 清单格式无效');
  const numbers = value.map(item => executionText(item, '发货 SN', 120));
  const existing = shipment.serials ?? [];
  if (numbers.length + existing.length > shipment.quantity) throw new BadRequestException('关联 SN 数量不能超过本单实发数量');
  const keys = numbers.map(canonicalSerial);
  if (new Set(keys).size !== keys.length) throw new BadRequestException('同一发货单的 SN 不能重复');
  const used = new Set(shipments.filter(row => !row.reversed).flatMap(row => (row.serials ?? []).map(serial => canonicalSerial(serial.number))));
  if (keys.some(key => used.has(key))) throw new ConflictException('该 SN 已关联有效发货单，不能重复发货或重复补录');
  const active = activeVersionRanges(ranges).filter(row => row.batchId === shipment.batchId);
  return numbers.map(number => {
    const matches = active.flatMap(row => row.serialNumbers.filter(serial => canonicalSerial(serial) === canonicalSerial(number)).map(serial => ({ range: row, number: serial })));
    if (matches.length !== 1) throw new ConflictException('所填 SN 未在本批次有效版本范围中唯一登记，请先核对批次档案');
    const { range, number: storedNumber } = matches[0];
    return { number: storedNumber, versionRangeId: range.id, softwareVersion: range.softwareVersion, hardwareVersion: range.hardwareVersion };
  });
}

export function guardShippedSerialRange(previous: BatchVersionRange | undefined, next: { serialNumbers: string[] }, shipments: ShipmentSerialRecord[]) {
  if (!previous) return;
  const nextNumbers = new Set(next.serialNumbers.map(canonicalSerial));
  const previousNumbers = new Set(previous.serialNumbers.map(canonicalSerial));
  const linked = shipments.filter(row => !row.reversed && row.batchId === previous.batchId).flatMap(row => row.serials ?? []).filter(serial => previousNumbers.has(canonicalSerial(serial.number)));
  if (linked.some(serial => !nextNumbers.has(canonicalSerial(serial.number)))) throw new ConflictException('本范围有已发货 SN，不能移除；如发货登记错误，请先凭证冲销原发货');
}

/** A global claim protects concurrent commands in different plan documents. Reversal releases only its own claim. */
export async function updateShipmentSerialClaims(db: Prisma.TransactionClient, planId: string, shipmentId: string, serials: ShipmentSerial[], active: boolean) {
  for (const serial of serials) {
    const key = claimKey(serial.number), stored = await db.runtimeState.findUnique({ where: { key } });
    const previous: { planId: string; shipmentId: string; active: boolean } | null = stored ? JSON.parse(stored.value) : null;
    if (previous && (typeof previous.active !== 'boolean' || !previous.planId || !previous.shipmentId)) throw new ConflictException('SN 发货关联待核对，请刷新后重试');
    const owned = previous?.planId === planId && previous.shipmentId === shipmentId;
    if (active && previous?.active && !owned) throw new ConflictException('该 SN 已关联其他有效发货单，不能重复发货');
    if (!active && previous && !owned) throw new ConflictException('SN 发货关联已变化，不能冲销其他发货单的关联');
    const value = JSON.stringify({ planId, shipmentId, active });
    if (stored) {
      const changed = await db.runtimeState.updateMany({ where: { key, value: stored.value }, data: { value } });
      if (changed.count !== 1) throw new ConflictException('SN 发货关联正在更新，请刷新后重试');
    } else await db.runtimeState.create({ data: { key, value } });
  }
}

export function shipmentSerialSummary(shipment: ShipmentSerialRecord) {
  const linkedSerialQty = shipment.serials?.length ?? 0;
  return { linkedSerialQty, pendingSerialQty: Math.max(0, shipment.quantity - linkedSerialQty) };
}
