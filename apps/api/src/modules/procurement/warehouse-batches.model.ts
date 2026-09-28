import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { executionQty, executionText } from './production-execution.model';

export interface WarehouseBatchQuantity { batchNo: string; quantity: number }
export interface WarehouseBatchAllocation { batches: WarehouseBatchQuantity[]; batchPendingQty: number }
const sum = (values: number[]) => values.reduce((total, value) => total.plus(value), new Prisma.Decimal(0));
export function warehouseBatchAllocation(quantity: number, input: { batches?: unknown; batchPendingQty?: unknown }): WarehouseBatchAllocation {
  if (input.batches !== undefined && (!Array.isArray(input.batches) || input.batches.length > 200)) throw new BadRequestException('实际库存批次明细格式无效');
  const seen = new Set<string>();
  const batches = (input.batches as Record<string, unknown>[] | undefined ?? []).map(row => {
    const batchNo = executionText(row?.batchNo, '实际库存批号', 120);
    if (seen.has(batchNo)) throw new BadRequestException('同一实际库存批号不能重复填写'); seen.add(batchNo);
    return { batchNo, quantity: executionQty(row.quantity, '本批实际数量', true) };
  });
  const batchPendingQty = input.batchPendingQty === undefined ? new Prisma.Decimal(quantity).minus(sum(batches.map(row => row.quantity))).toNumber() : executionQty(input.batchPendingQty, '批号待补数量');
  if (batchPendingQty < 0 || !sum([...batches.map(row => row.quantity), batchPendingQty]).eq(quantity)) throw new BadRequestException('批次已知数量与待补数量合计须等于本次数量');
  return { batches, batchPendingQty };
}

export function warehouseBatchTotals(history: { action: string; lines?: { code: string; quantity: number; batches?: WarehouseBatchQuantity[]; batchPendingQty?: number }[] }[], code: string, action: 'issue' | 'sign', fallbackQuantity: number) {
  const totals = new Map<string, Prisma.Decimal>(); let pending = new Prisma.Decimal(0), recorded = new Prisma.Decimal(0);
  for (const event of history.filter(row => row.action === action)) for (const line of event.lines ?? []) if (line.code === code) {
    const known = line.batches ?? [];
    for (const batch of known) totals.set(batch.batchNo, (totals.get(batch.batchNo) ?? new Prisma.Decimal(0)).plus(batch.quantity));
    pending = pending.plus(line.batchPendingQty ?? new Prisma.Decimal(line.quantity).minus(sum(known.map(row => row.quantity)))); recorded = recorded.plus(line.quantity);
  }
  // Legacy totals may predate event detail. They remain explicitly untraced.
  pending = pending.plus(Prisma.Decimal.max(new Prisma.Decimal(fallbackQuantity).minus(recorded), 0));
  return { batches: [...totals].map(([batchNo, quantity]) => ({ batchNo, quantity: quantity.toNumber() })), batchPendingQty: pending.toNumber() };
}

export function validateSignedBatches(request: WarehouseBatchAllocation, issued: WarehouseBatchAllocation, signed: WarehouseBatchAllocation) {
  for (const batch of request.batches) {
    const remaining = new Prisma.Decimal(issued.batches.find(row => row.batchNo === batch.batchNo)?.quantity ?? 0).minus(signed.batches.find(row => row.batchNo === batch.batchNo)?.quantity ?? 0);
    if (remaining.lt(batch.quantity)) throw new BadRequestException('该实际库存批号的签收数量超过已发未签数量');
  }
  if (new Prisma.Decimal(issued.batchPendingQty).minus(signed.batchPendingQty).lt(request.batchPendingQty)) throw new BadRequestException('请选择实际已发批号；待补批号的签收数量不能超过对应已发数量');
}
