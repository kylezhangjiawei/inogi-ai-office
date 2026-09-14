import type { ProcurementTask } from "../../lib/procurementApi";

export interface SampleCommercialQuote {
  id: string;
  materialId: string | null;
  materialName: string | null;
  materialCheck: "matched" | "unverified" | "conflict";
  supplierName: string | null;
  unitPrice: number | null;
  currency: string | null;
  leadTimeDays: number | null;
  minOrderQty: number | null;
  quoteDate: string | null;
  validUntil: string | null;
  note: string | null;
}
export type SampleCommercialFacts =
  | { kind: "ready"; quotes: SampleCommercialQuote[] }
  | { kind: "empty" | "unverified" | "limit"; message: string };

const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const identity = (value: unknown) => typeof value === "string" && value.trim() ? value : null;
const nonNegative = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
function date(value: unknown) {
  if (typeof value !== "string" || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Task quotations are immutable purchase snapshots, not sample-round prices or supplier master data. */
export function sampleCommercialFacts(task: Pick<ProcurementTask, "id" | "materialId">, value: unknown): SampleCommercialFacts {
  if (!task.id?.trim()) return { kind: "unverified", message: "任务标识缺失，暂不能核对已确认报价。" };
  if (!Array.isArray(value)) throw new Error("报价来源格式不完整，请重新读取。");
  // Existing endpoint returns at most 200, without total/pagination. Never claim a complete selection at the cap.
  if (value.length >= 200) return { kind: "limit", message: "报价来源达到 200 条读取上限，已选范围可能不完整，请在原采购任务中核对。" };
  const seen = new Set<string>();
  for (const row of value) {
    if (!record(row) || !text(row.id) || seen.has(String(row.id)) || row.taskId !== task.id || typeof row.isSelected !== "boolean") {
      throw new Error("报价来源与当前任务不一致或记录不完整，请重新读取。");
    }
    seen.add(String(row.id));
  }
  const selected = (value as Record<string, unknown>[]).filter((row) => row.isSelected === true);
  if (!selected.length) return { kind: "empty", message: "当前读取结果中没有已确认报价；候选报价不能作为采购条件。" };
  const taskMaterialId = identity(task.materialId);
  return { kind: "ready", quotes: selected.map((row) => ({
    id: String(row.id), materialId: identity(row.materialId), materialName: text(row.materialName),
    materialCheck: taskMaterialId && identity(row.materialId) ? taskMaterialId === row.materialId ? "matched" : "conflict" : "unverified",
    supplierName: text(row.supplierName), unitPrice: nonNegative(row.unitPrice),
    currency: typeof row.currency === "string" && /^[A-Z]{3}$/.test(row.currency) ? row.currency : null,
    leadTimeDays: Number.isSafeInteger(row.leadTimeDays) && Number(row.leadTimeDays) >= 0 ? Number(row.leadTimeDays) : null,
    minOrderQty: nonNegative(row.minOrderQty), quoteDate: date(row.quoteDate), validUntil: date(row.validUntil), note: text(row.note),
  })) };
}

export function commercialPrice(quote: Pick<SampleCommercialQuote, "unitPrice" | "currency">): string | null {
  if (quote.unitPrice === null || quote.currency === null) return null;
  return `${quote.currency} ${quote.unitPrice.toLocaleString("en-US", { maximumFractionDigits: 8 })}`;
}
