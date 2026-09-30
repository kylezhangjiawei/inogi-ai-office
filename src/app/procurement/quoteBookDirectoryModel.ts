import type { QuoteBookRow, SupplierQuote } from "../lib/procurementApi";

export interface SupplierMaterialQuote {
  key: string;
  material: QuoteBookRow;
  quote: SupplierQuote;
}

export interface QuoteBookSupplierGroup {
  key: string;
  supplierId?: string;
  name: string;
  supplier?: NonNullable<SupplierQuote["supplier"]>;
  relation: "linked" | "disabled" | "unlinked" | "unresolved" | "conflict";
  entries: SupplierMaterialQuote[];
  materialCount: number;
  quoteNames: string[];
}

const nonempty = (value?: string): value is string => typeof value === "string" && value.trim().length > 0;

/** Names are display snapshots, never supplier identities. Old unlinked quotes remain separate. */
export function buildQuoteBookDirectory(rows: QuoteBookRow[]): QuoteBookSupplierGroup[] {
  const groups = new Map<string, QuoteBookSupplierGroup>();
  for (const material of rows) {
    const quoteIdCounts = new Map<string, number>();
    for (const quote of material.quotes) quoteIdCounts.set(quote.id, (quoteIdCounts.get(quote.id) ?? 0) + 1);
    material.quotes.forEach((quote, index) => {
      const supplierId = nonempty(quote.supplierId) ? quote.supplierId : undefined;
      const entryKey = JSON.stringify([material.id, quote.id, (quoteIdCounts.get(quote.id) ?? 0) > 1 ? index : null]);
      const key = supplierId ? `supplier:${JSON.stringify(supplierId)}` : `unlinked:${entryKey}`;
      let group = groups.get(key);
      if (!group) {
        group = { key, supplierId, name: quote.supplierName || "未填写厂家名称", relation: supplierId ? "unresolved" : "unlinked", entries: [], materialCount: 0, quoteNames: [] };
        groups.set(key, group);
      }
      group.entries.push({ key: entryKey, material, quote });
    });
  }
  for (const group of groups.values()) {
    group.materialCount = new Set(group.entries.map((entry) => entry.material.id)).size;
    group.quoteNames = Array.from(new Set(group.entries.map((entry) => entry.quote.supplierName).filter(nonempty)));
    if (!group.supplierId) continue;
    const links = group.entries.map(({ quote }) => quote.supplier);
    const matching = links.filter((supplier): supplier is NonNullable<SupplierQuote["supplier"]> => supplier?.id === group.supplierId);
    const fingerprints = new Set(matching.map((supplier) => JSON.stringify([supplier.name, supplier.source, supplier.enabled])));
    if (links.some((supplier) => supplier && supplier.id !== group.supplierId) || fingerprints.size > 1) {
      group.relation = "conflict";
    } else if (matching.length !== links.length) {
      group.relation = "unresolved";
    } else {
      group.supplier = matching[0];
      group.name = nonempty(group.supplier.name) ? group.supplier.name : group.name;
      group.relation = group.supplier.enabled ? "linked" : "disabled";
    }
  }
  return Array.from(groups.values()).sort((a, b) => a.name.localeCompare(b.name, "zh-CN") || a.key.localeCompare(b.key));
}

export function filterSupplierDirectory(groups: QuoteBookSupplierGroup[], query: string): QuoteBookSupplierGroup[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return groups;
  return groups.filter((group) => [group.name, group.supplierId, ...group.quoteNames].some((value) => value?.toLocaleLowerCase().includes(normalized)));
}

export function filterSupplierMaterials(entries: SupplierMaterialQuote[], query: string, category = ""): SupplierMaterialQuote[] {
  const normalized = query.trim().toLocaleLowerCase();
  return entries.filter(({ material, quote }) => (!category || material.category === category) && (!normalized || [
    material.name, material.spec, material.tpInventoryCode, material.erpCode, material.category, material.productLine, quote.supplierModel,
  ].some((value) => value?.toLocaleLowerCase().includes(normalized))));
}

export function supplierSourceLabel(source?: string): string {
  if (source === "tplus-order") return "ERP采购订单补录";
  if (source === "tplus") return "T+ 同步";
  if (source === "local") return "本地维护";
  if (source === "import") return "导入";
  if (source === "manual") return "人工维护";
  return "来源未确认";
}

export function supplierRelationLabel(relation: QuoteBookSupplierGroup["relation"]): string {
  return { linked: "档案启用", disabled: "档案停用", unlinked: "未关联供应商档案", unresolved: "关联档案待核对", conflict: "关联信息不一致" }[relation];
}

export function materialReviewLabel(status?: string): string {
  return status === "approved" ? "已审核" : status === "pending" ? "待审核" : status === "rejected" ? "已驳回" : "审核状态未提供";
}

export function directoryQuoteExpired(quote: SupplierQuote, today: string): boolean {
  return Boolean(quote.validUntil && quote.validUntil < today);
}
