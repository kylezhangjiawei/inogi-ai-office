import type { PurchaseOrderLine } from "../lib/orderProcessingApi";

export type PurchaseOrderFulfillmentState = "not_received" | "partial" | "received" | "over_received" | "unverified";
export type PurchaseOrderFulfillmentIssue = "invalid_ordered_qty" | "zero_ordered_qty" | "invalid_received_qty" | "missing_unit";
export type PurchaseOrderFulfillmentInput = Pick<PurchaseOrderLine, "id" | "lineNo" | "unit" | "qty" | "receivedQty">;

export interface PurchaseOrderLineFulfillment {
  /** Index in the supplied order lines, including duplicate SKUs or display line numbers. */
  index: number;
  id: string;
  lineNo: string;
  unit: string | null;
  state: PurchaseOrderFulfillmentState;
  issues: PurchaseOrderFulfillmentIssue[];
  orderedQty: number | null;
  receivedQty: number | null;
  remainingQty: number | null;
  overReceivedQty: number | null;
  /** Receipt quantity progress only, capped at 100; never inspection or stock-in progress. */
  progressPercent: number | null;
}

export interface PurchaseOrderUnitFulfillment {
  /** Original unit with surrounding whitespace removed; no conversion or case folding. */
  unit: string | null;
  lineIndices: number[];
  count: number;
  checkableCount: number;
  /** Data completeness, not order completion. Any invalid row or sum overflow makes totals unavailable. */
  complete: boolean;
  orderedQty: number | null;
  receivedQty: number | null;
  remainingQty: number | null;
  overReceivedQty: number | null;
}

export interface PurchaseOrderFulfillment {
  lines: PurchaseOrderLineFulfillment[];
  groups: PurchaseOrderUnitFulfillment[];
  totalLines: number;
  checkableLines: number;
  /** Includes over-received rows, whose anomaly remains separately visible. */
  receivedLines: number;
  anomalyLines: number;
  unverifiedLines: number;
  overReceivedLines: number;
  /** Whether every supplied line and unit total is checkable. False when no lines were supplied. */
  complete: boolean;
}

function quantity(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function fulfillmentLine(line: PurchaseOrderFulfillmentInput, index: number): PurchaseOrderLineFulfillment {
  const orderedQty = quantity(line.qty);
  const receivedQty = quantity(line.receivedQty);
  const unit = typeof line.unit === "string" ? line.unit.trim() || null : null;
  const issues: PurchaseOrderFulfillmentIssue[] = [];
  if (orderedQty === null) issues.push("invalid_ordered_qty");
  else if (orderedQty === 0) issues.push("zero_ordered_qty");
  if (receivedQty === null) issues.push("invalid_received_qty");
  if (!unit) issues.push("missing_unit");
  const checkable = issues.length === 0;
  const state: PurchaseOrderFulfillmentState = !checkable ? "unverified"
    : receivedQty === 0 ? "not_received" : receivedQty! < orderedQty! ? "partial"
      : receivedQty === orderedQty ? "received" : "over_received";
  return {
    index, id: line.id, lineNo: line.lineNo, unit, state, issues, orderedQty, receivedQty,
    remainingQty: checkable ? Math.max(orderedQty! - receivedQty!, 0) : null,
    overReceivedQty: checkable ? Math.max(receivedQty! - orderedQty!, 0) : null,
    progressPercent: checkable ? Math.min(receivedQty! / orderedQty!, 1) * 100 : null,
  };
}

/** Read-only receipt facts. Do not infer warehouse receipt, inspection, usable stock or ERP status. */
export function buildPurchaseOrderFulfillment(input: readonly PurchaseOrderFulfillmentInput[]): PurchaseOrderFulfillment {
  const lines = input.map(fulfillmentLine);
  const grouped = new Map<string | null, PurchaseOrderLineFulfillment[]>();
  for (const line of lines) {
    const members = grouped.get(line.unit);
    if (members) members.push(line);
    else grouped.set(line.unit, [line]);
  }
  const groups: PurchaseOrderUnitFulfillment[] = [...grouped].map(([unit, members]) => {
    const checkableCount = members.filter((line) => line.state !== "unverified").length;
    const sums = { orderedQty: 0, receivedQty: 0, remainingQty: 0, overReceivedQty: 0 };
    let complete = checkableCount === members.length;
    if (complete) {
      for (const line of members) {
        sums.orderedQty += line.orderedQty!;
        sums.receivedQty += line.receivedQty!;
        // Each line's remainder/overage stands on its own; one SKU never offsets another.
        sums.remainingQty += line.remainingQty!;
        sums.overReceivedQty += line.overReceivedQty!;
      }
      complete = Object.values(sums).every(Number.isFinite);
    }
    return {
      unit, lineIndices: members.map((line) => line.index), count: members.length, checkableCount, complete,
      orderedQty: complete ? sums.orderedQty : null,
      receivedQty: complete ? sums.receivedQty : null,
      remainingQty: complete ? sums.remainingQty : null,
      overReceivedQty: complete ? sums.overReceivedQty : null,
    };
  });
  const unverifiedLines = lines.filter((line) => line.state === "unverified").length;
  const overReceivedLines = lines.filter((line) => line.state === "over_received").length;
  return {
    lines, groups, totalLines: lines.length, checkableLines: lines.length - unverifiedLines,
    receivedLines: lines.filter((line) => line.state === "received" || line.state === "over_received").length,
    anomalyLines: unverifiedLines + overReceivedLines, unverifiedLines, overReceivedLines,
    complete: lines.length > 0 && groups.every((group) => group.complete),
  };
}
