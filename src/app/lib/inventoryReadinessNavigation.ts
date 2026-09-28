import { routePath } from "./routePaths";

export type InventoryReadinessViewStatus = "all" | "warning" | "ready" | "low" | "gap" | "shortage" | "unmatched" | "data_missing";

export interface InventoryReadinessViewState {
  productLine: string;
  revisionId?: string;
  targetSets: number;
  q: string;
  category: string;
  status: InventoryReadinessViewStatus;
  page: number;
  pageSize: 20 | 50 | 100;
  itemId?: string;
}

const STATUSES = new Set<InventoryReadinessViewStatus>(["all", "warning", "ready", "low", "gap", "shortage", "unmatched", "data_missing"]);
const FIELD_LIMITS = { productLine: 64, revisionId: 200, q: 200, category: 128, itemId: 128 } as const;
const FIELDS = new Set(["productLine", "revisionId", "targetSets", "q", "category", "status", "page", "pageSize", "itemId"]);
const UNSAFE_TEXT = /[\\\u0000-\u001f\u007f]/;

function safeText(value: string | null, limit: number, fallback = "") {
  const text = value?.trim() ?? "";
  return text && text.length <= limit && !UNSAFE_TEXT.test(value ?? "") ? text : fallback;
}

function boundedInteger(value: string | null, fallback: number, min: number, max: number) {
  if (value === null || !value.trim()) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.floor(number))) : fallback;
}

/** Recover a bounded view from a query string. Targets retain the existing 0–1,000,000 clamp. */
export function parseInventoryReadinessViewState(input: URLSearchParams | string): InventoryReadinessViewState {
  const params = typeof input === "string" ? new URLSearchParams(input.length <= 16_384 ? input : "") : input;
  const status = params.get("status") as InventoryReadinessViewStatus;
  const pageSize = Number(params.get("pageSize"));
  const itemId = safeText(params.get("itemId"), FIELD_LIMITS.itemId);
  const revisionId = safeText(params.get("revisionId"), FIELD_LIMITS.revisionId);
  return {
    productLine: safeText(params.get("productLine"), FIELD_LIMITS.productLine, "Q5"),
    targetSets: boundedInteger(params.get("targetSets"), 100, 0, 1_000_000),
    q: safeText(params.get("q"), FIELD_LIMITS.q),
    category: safeText(params.get("category"), FIELD_LIMITS.category, "all"),
    status: STATUSES.has(status) ? status : "all",
    page: boundedInteger(params.get("page"), 1, 1, 1_000_000),
    pageSize: pageSize === 50 || pageSize === 100 ? pageSize : 20,
    ...(itemId ? { itemId } : {}),
    ...(revisionId ? { revisionId } : {}),
  };
}

/** The caller supplies committed targetSets, so unfinished input never becomes the return target. */
export function buildInventoryReadinessPath(state: InventoryReadinessViewState): string {
  const input = new URLSearchParams();
  for (const key of FIELDS) {
    const value = state[key as keyof InventoryReadinessViewState];
    if (value !== undefined) input.set(key, String(value));
  }
  const view = parseInventoryReadinessViewState(input);
  const params = new URLSearchParams({ productLine: view.productLine, targetSets: String(view.targetSets) });
  if (view.q) params.set("q", view.q);
  if (view.category !== "all") params.set("category", view.category);
  if (view.status !== "all") params.set("status", view.status);
  if (view.page !== 1) params.set("page", String(view.page));
  if (view.pageSize !== 20) params.set("pageSize", String(view.pageSize));
  if (view.itemId) params.set("itemId", view.itemId);
  if (view.revisionId) params.set("revisionId", view.revisionId);
  return `${routePath("page:proc-inventory-readiness", "/proc-inventory-readiness")}?${params.toString()}`;
}

/** Accept only an explicit, valid return to the currently configured inventory readiness route. */
export function inventoryReadinessReturnPath(state: unknown): string | null {
  if (!state || typeof state !== "object" || Array.isArray(state)) return null;
  const target = (state as Record<string, unknown>).inventoryReadinessReturnTo;
  if (typeof target !== "string" || target.length > 16_384 || !target.startsWith("/") || target.startsWith("//")
    || target.includes("#") || UNSAFE_TEXT.test(target)) return null;
  const queryStart = target.indexOf("?");
  const pathname = queryStart < 0 ? target : target.slice(0, queryStart);
  if (pathname !== routePath("page:proc-inventory-readiness", "/proc-inventory-readiness")) return null;
  const query = queryStart < 0 ? "" : target.slice(queryStart + 1);
  try {
    if (UNSAFE_TEXT.test(decodeURIComponent(query.replace(/\+/g, " ")))) return null;
  } catch {
    return null;
  }
  const params = new URLSearchParams(query);
  const seen = new Set<string>();
  for (const [key, value] of params) {
    if (!FIELDS.has(key) || seen.has(key)) return null;
    seen.add(key);
    if (key in FIELD_LIMITS) {
      const limit = FIELD_LIMITS[key as keyof typeof FIELD_LIMITS];
      if (!value.trim() || value.length > limit || value !== value.trim()) return null;
    } else if (key === "status") {
      if (!STATUSES.has(value as InventoryReadinessViewStatus)) return null;
    } else {
      if (!/^(0|[1-9]\d*)$/.test(value)) return null;
      const number = Number(value);
      if (!Number.isSafeInteger(number)) return null;
      if (key === "pageSize" ? ![20, 50, 100].includes(number) : number > 1_000_000 || number < (key === "targetSets" ? 0 : 1)) return null;
    }
  }
  return target;
}
