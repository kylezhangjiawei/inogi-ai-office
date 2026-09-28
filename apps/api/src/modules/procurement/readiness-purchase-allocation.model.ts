import { Prisma } from '@prisma/client';

export interface ReadinessPurchaseAllocation {
  planId: string; quantity: number; source: string; planSource: string;
  actorId: string; actorName: string; reason: string; at: string;
}
export interface ReadinessPurchaseLedger {
  version: number;
  allocations: ReadinessPurchaseAllocation[];
  history: ReadinessPurchaseAllocation[];
}
export function purchaseAllocationView(ledger: ReadinessPurchaseLedger | null, planId: string, source: string,
  remaining: number | null, planSources: Map<string, string>, shared: boolean) {
  const own = ledger?.allocations.find(row => row.planId === planId);
  const valid = (row: ReadinessPurchaseAllocation) => row.source === source && row.planSource === planSources.get(row.planId)
    && Number.isFinite(row.quantity) && row.quantity >= 0;
  const otherAllocated = (ledger?.allocations ?? []).filter(row => row.planId !== planId && valid(row))
    .reduce((sum, row) => sum.plus(row.quantity), new Prisma.Decimal(0));
  const confirmed = own && valid(own) ? own.quantity : 0;
  const overallocated = remaining !== null && otherAllocated.plus(confirmed).gt(remaining);
  // Once an explicit ledger exists, releasing a quantity must never restore implicit coverage.
  const implicit = !ledger && !shared;
  const allocatedQty = remaining === null || overallocated ? 0 : implicit ? remaining : confirmed;
  return {
    allocationStatus: overallocated ? 'stale' as const : implicit ? 'implicit' as const
      : own && !valid(own) && own.quantity > 0 ? 'stale' as const
      : own ? own.quantity > 0 ? 'confirmed' as const : 'released' as const : 'unallocated' as const,
    assignedQty: own?.quantity ?? 0, allocatedQty, otherAllocatedQty: otherAllocated.toNumber(),
    maxAllocatable: remaining === null ? 0 : Prisma.Decimal.max(new Prisma.Decimal(remaining).minus(otherAllocated), 0).toNumber(),
    allocationHistory: (ledger?.history ?? []).filter(row => row.planId === planId).map(row => ({
      quantity: row.quantity, actorName: row.actorName, at: row.at, reason: row.reason,
    })),
  };
}
