import { useMemo, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, PackageSearch, Pencil, Search, Users, X } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { cn } from "../../components/ui/utils";
import { useI18n } from "../../lib/i18n";
import type { QuoteBookRow, SupplierQuote } from "../../lib/procurementApi";
import {
  buildQuoteBookDirectory, directoryQuoteExpired, filterSupplierDirectory, filterSupplierMaterials,
  materialReviewLabel, supplierRelationLabel, supplierSourceLabel, type SupplierMaterialQuote,
} from "../quoteBookDirectoryModel";
import "./QuoteBookSupplierView.css";

export const DIRECTORY_SUPPLIER_PAGE_SIZE = 12;
export const DIRECTORY_QUOTE_PAGE_SIZE = 10;

interface QuoteBookSupplierViewProps {
  rows: QuoteBookRow[];
  today: string;
  canWrite: boolean;
  onCompare: (row: QuoteBookRow) => void;
  onEdit: (row: QuoteBookRow, quote: SupplierQuote) => void;
  onShowMaterials?: () => void;
}

function DirectoryPager({ page, pages, label, onPage }: { page: number; pages: number; label: string; onPage: (page: number) => void }) {
  const { t } = useI18n();
  return (
    <nav aria-label={label} className="flex min-w-0 items-center justify-between gap-2">
      <Button variant="outline" size="icon" aria-label={t("{label}上一页", { label })} disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft className="size-4" /></Button>
      <span className="text-xs tabular-nums text-muted-foreground">{t("第 {page} / {pages} 页", { page, pages })}</span>
      <Button variant="outline" size="icon" aria-label={t("{label}下一页", { label })} disabled={page >= pages} onClick={() => onPage(page + 1)}><ChevronRight className="size-4" /></Button>
    </nav>
  );
}

function DirectoryQuoteCard({ entry, today, canWrite, onCompare, onEdit }: {
  entry: SupplierMaterialQuote;
  today: string;
  canWrite: boolean;
  onCompare: QuoteBookSupplierViewProps["onCompare"];
  onEdit: QuoteBookSupplierViewProps["onEdit"];
}) {
  const { t } = useI18n();
  const [showTiers, setShowTiers] = useState(false);
  const { material, quote } = entry;
  const expired = directoryQuoteExpired(quote, today);
  const minQty = quote.tiers.length ? Math.min(...quote.tiers.map((tier) => tier.minQty)) : null;
  const displayedTiers = showTiers ? quote.tiers : quote.tiers.slice(0, 3);
  return (
    <li className="proc-supplier-material px-4 py-4">
      <div className="proc-supplier-material-top">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h4 className="min-w-0 break-words text-balance text-sm font-semibold text-foreground">{material.name}</h4>
            <span className={cn("rounded-md border border-border px-1.5 py-0.5 text-xs", material.reviewStatus === "pending" || material.reviewStatus === "rejected" ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>{t(materialReviewLabel(material.reviewStatus))}</span>
          </div>
          <p className="mt-1 text-pretty text-xs leading-5 text-muted-foreground">{material.spec || t("规格未填写")}{material.category ? ` · ${material.category}` : ""}</p>
          <div className="mt-2 flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-xs leading-5 tabular-nums text-foreground">
            {material.tpInventoryCode?.trim() && <span className="min-w-0 break-all"><span className="text-muted-foreground">{t("T+ 编码")} </span>{material.tpInventoryCode}</span>}
            {material.erpCode?.trim() && material.erpCode !== material.tpInventoryCode && <span className="min-w-0 break-all"><span className="text-muted-foreground">{t("ERP 编码")} </span>{material.erpCode}</span>}
            {!material.tpInventoryCode?.trim() && !material.erpCode?.trim() && <span className="text-muted-foreground">{t("物料编码未填写")}</span>}
          </div>
        </div>
        <div className="proc-supplier-material-actions flex min-w-0 flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => onCompare(material)}>{t("查看全部厂家报价")}</Button>
          {canWrite && <Button variant="ghost" size="sm" onClick={() => onEdit(material, quote)}><Pencil className="size-3.5" />{t("编辑报价")}</Button>}
        </div>
      </div>
      <dl className="proc-supplier-material-facts mt-3 grid min-w-0 gap-x-4 gap-y-3 text-xs leading-5">
        <div className="min-w-0"><dt className="text-muted-foreground">{t("单位 / 起订量")}</dt><dd className="break-words font-medium tabular-nums text-foreground">{material.unit || t("单位未填写")} · {minQty == null ? t("起订量未填写") : minQty === 0 ? t("不限起订") : `${minQty.toLocaleString()} ${material.unit || ""}`}</dd></div>
        <div className="min-w-0"><dt className="text-muted-foreground">{t("参考交期")}</dt><dd className="font-medium tabular-nums text-foreground">{quote.leadTimeDays > 0 ? t("{days} 天", { days: quote.leadTimeDays }) : t("未填写")}</dd></div>
        <div className="min-w-0"><dt className="text-muted-foreground">{t("报价有效期")}</dt><dd className={cn("break-words font-medium tabular-nums", expired ? "text-amber-700 dark:text-amber-300" : "text-foreground")}>{quote.validUntil ? `${quote.validUntil}${expired ? ` · ${t("已过期")}` : ` · ${t("未到期")}`}` : t("未设置截止日期")}</dd></div>
        <div className="min-w-0"><dt className="text-muted-foreground">{t("厂家型号")}</dt><dd className="break-words font-medium text-foreground">{quote.supplierModel || t("未填写")}</dd></div>
      </dl>
      <div className="mt-3 flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs text-muted-foreground">{quote.taxIncluded ? t("含税阶梯价") : t("未税阶梯价")}</span>
        {displayedTiers.map((tier, index) => <span key={`${tier.minQty}:${index}`} className={cn("inline-flex max-w-full flex-wrap gap-x-2 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs tabular-nums", expired && "border-dashed")}>
          <span className="break-words text-muted-foreground">{tier.minQty === 0 ? t("不限起订") : `≥ ${tier.minQty.toLocaleString()}`}</span>
          <span className="break-all font-semibold text-foreground">{quote.currency === "CNY" ? "¥" : `${quote.currency} `}{tier.unitPrice.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</span>
        </span>)}
        {quote.tiers.length === 0 && <span className="text-xs text-muted-foreground">{t("未填写阶梯价")}</span>}
        {quote.tiers.length > 3 && <Button variant="link" size="sm" className="h-auto whitespace-normal px-1 py-1 text-xs" aria-expanded={showTiers} onClick={() => setShowTiers((value) => !value)}>{showTiers ? t("收起阶梯价") : t("查看全部 {count} 档", { count: quote.tiers.length })}</Button>}
      </div>
      {(quote.quoteDate || quote.note) && <p className="mt-2 break-words text-pretty text-xs leading-5 text-muted-foreground">{quote.quoteDate ? `${t("报价日期")} ${quote.quoteDate}` : ""}{quote.quoteDate && quote.note ? " · " : ""}{quote.note}</p>}
      {quote.supplier?.name && quote.supplierName !== quote.supplier.name && <p className="mt-1 break-words text-pretty text-xs leading-5 text-muted-foreground">{t("报价记录厂家名")}：{quote.supplierName || t("未填写")}</p>}
    </li>
  );
}

export function QuoteBookSupplierView({ rows, today, canWrite, onCompare, onEdit, onShowMaterials }: QuoteBookSupplierViewProps) {
  const { t } = useI18n();
  const [supplierSearch, setSupplierSearch] = useState("");
  const [materialSearch, setMaterialSearch] = useState("");
  const [category, setCategory] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [supplierPage, setSupplierPage] = useState(1);
  const [materialPage, setMaterialPage] = useState(1);
  const [filterScope, setFilterScope] = useState<string | undefined>();
  const groups = useMemo(() => buildQuoteBookDirectory(rows), [rows]);
  const suppliers = useMemo(() => filterSupplierDirectory(groups, supplierSearch), [groups, supplierSearch]);
  const selectedIndex = suppliers.findIndex((supplier) => supplier.key === selectedKey);
  const supplierPages = Math.max(1, Math.ceil(suppliers.length / DIRECTORY_SUPPLIER_PAGE_SIZE));
  const currentSupplierPage = selectedIndex >= 0 ? Math.floor(selectedIndex / DIRECTORY_SUPPLIER_PAGE_SIZE) + 1 : Math.min(supplierPage, supplierPages);
  const supplierRows = suppliers.slice((currentSupplierPage - 1) * DIRECTORY_SUPPLIER_PAGE_SIZE, currentSupplierPage * DIRECTORY_SUPPLIER_PAGE_SIZE);
  const selected = selectedIndex >= 0 ? suppliers[selectedIndex] : supplierRows[0];
  // Reset before React commits a replacement supplier, including after a refresh removes one.
  if (filterScope !== selected?.key) {
    setFilterScope(selected?.key);
    setMaterialSearch("");
    setCategory("");
    setMaterialPage(1);
  }
  const entries = useMemo(() => selected ? filterSupplierMaterials(selected.entries, materialSearch, category) : [], [selected, materialSearch, category]);
  const materialPages = Math.max(1, Math.ceil(entries.length / DIRECTORY_QUOTE_PAGE_SIZE));
  const currentMaterialPage = Math.min(materialPage, materialPages);
  const pageEntries = entries.slice((currentMaterialPage - 1) * DIRECTORY_QUOTE_PAGE_SIZE, currentMaterialPage * DIRECTORY_QUOTE_PAGE_SIZE);
  const categories = useMemo(() => Array.from(new Set(selected?.entries.map((entry) => entry.material.category).filter(Boolean))).sort(), [selected]);
  const selectSupplier = (key: string) => { setSelectedKey(key); setMaterialSearch(""); setCategory(""); setMaterialPage(1); };
  const clearMaterialFilters = () => { setMaterialSearch(""); setCategory(""); setMaterialPage(1); };

  return (
    <div className="proc-supplier-directory min-w-0">
      <div className="proc-supplier-directory-layout grid min-w-0 items-start gap-3">
        <aside aria-label={t("已报价供应商列表")} className="proc-horizon-surface material-card min-w-0 overflow-hidden">
          <div className="border-b border-border px-3 py-3">
            <div className="mb-3 flex min-w-0 items-center justify-between gap-2"><h2 className="text-balance text-sm font-semibold text-foreground">{t("已报价供应商")}</h2><Users className="size-4 text-muted-foreground" aria-hidden="true" /></div>
            <div className="relative min-w-0">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input aria-label={t("搜索已报价供应商")} placeholder={t("搜索名称 / 供应商 ID")} value={supplierSearch} onChange={(event) => { setSupplierSearch(event.target.value); setSupplierPage(1); setSelectedKey(null); clearMaterialFilters(); }} className="min-w-0 pl-8 pr-9 text-xs" />
              {supplierSearch && <Button variant="ghost" size="icon" className="absolute right-0 top-0 size-9" aria-label={t("清空供应商搜索")} onClick={() => { setSupplierSearch(""); setSupplierPage(1); setSelectedKey(null); clearMaterialFilters(); }}><X className="size-3.5" /></Button>}
            </div>
            <p aria-live="polite" className="mt-2 text-pretty text-xs leading-5 tabular-nums text-muted-foreground">{t("{count} 项，含未关联档案的报价", { count: suppliers.length })}</p>
          </div>
          {supplierRows.length > 0 ? <ul className="proc-supplier-directory-list p-2">
            {supplierRows.map((supplier) => <li key={supplier.key}><button type="button" onClick={() => selectSupplier(supplier.key)} aria-pressed={supplier.key === selected?.key} className={cn("proc-supplier-directory-choice w-full min-w-0 cursor-pointer rounded-lg border border-transparent px-3 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring", supplier.key === selected?.key ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-muted/50")}>
              <span className="flex min-w-0 items-start gap-2"><strong className="min-w-0 flex-1 break-words text-sm font-semibold">{supplier.name}</strong><ChevronRight className="mt-0.5 size-4 shrink-0" /></span>
              <span className="mt-1 block break-all text-xs leading-5 text-muted-foreground">{supplier.supplierId ? `ID ${supplier.supplierId}` : t("独立保留此条报价")}</span>
              <span className="mt-1 flex min-w-0 flex-wrap gap-x-2 text-xs leading-5 text-muted-foreground"><span className="tabular-nums">{t("{count} 个已报价物料", { count: supplier.materialCount })}</span><span>{t(supplierRelationLabel(supplier.relation))}</span></span>
            </button></li>)}
          </ul> : <div className="px-4 py-8 text-center"><p className="text-pretty text-sm leading-6 text-muted-foreground">{supplierSearch ? t("没有匹配的供应商") : t("当前还没有厂家报价")}</p>{supplierSearch && <Button variant="outline" size="sm" className="mt-3" onClick={() => { setSupplierSearch(""); setSupplierPage(1); }}>{t("清空供应商搜索")}</Button>}</div>}
          {supplierPages > 1 && <div className="border-t border-border px-3 py-3"><DirectoryPager page={currentSupplierPage} pages={supplierPages} label={t("供应商列表")} onPage={(page) => { setSupplierPage(page); const first = suppliers[(page - 1) * DIRECTORY_SUPPLIER_PAGE_SIZE]; if (first) selectSupplier(first.key); }} /></div>}
        </aside>

        <div className="min-w-0 space-y-3">
          {selected ? <>
            <section aria-label={t("当前供应商信息")} className="proc-horizon-surface material-card min-w-0 px-4 py-4">
              <p className="mb-2 text-xs text-muted-foreground">{t("当前供应商")}</p>
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1"><h2 className="break-words text-balance text-lg font-semibold text-foreground">{selected.name}</h2><p className="mt-1 break-all text-xs leading-5 text-muted-foreground">{selected.supplierId ? `${t("供应商 ID")} ${selected.supplierId}` : t("这条报价尚未关联供应商档案")}</p></div>
                <span className="max-w-full rounded-md border border-border px-2 py-1 text-xs leading-5 text-muted-foreground">{t(supplierRelationLabel(selected.relation))}</span>
              </div>
              <dl className="mt-3 flex min-w-0 flex-wrap gap-x-6 gap-y-2 border-t border-border pt-3 text-xs leading-5">
                <div><dt className="text-muted-foreground">{t("档案来源")}</dt><dd className="font-medium text-foreground">{t(supplierSourceLabel(selected.supplier?.source))}</dd></div>
                <div><dt className="text-muted-foreground">{t("已报价物料")}</dt><dd className="font-medium tabular-nums text-foreground">{selected.materialCount.toLocaleString()}</dd></div>
                <div><dt className="text-muted-foreground">{t("报价记录")}</dt><dd className="font-medium tabular-nums text-foreground">{selected.entries.length.toLocaleString()}</dd></div>
                <div><dt className="text-muted-foreground">{t("已过期报价")}</dt><dd className="font-medium tabular-nums text-foreground">{selected.entries.filter(({ quote }) => directoryQuoteExpired(quote, today)).length.toLocaleString()}</dd></div>
              </dl>
              {selected.relation !== "linked" && <p className="mt-3 flex min-w-0 items-start gap-2 text-pretty text-xs leading-5 text-muted-foreground"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{t(selected.relation === "unlinked" ? "未关联档案的同名报价分别保留，请编辑报价核对供应商。" : selected.relation === "disabled" ? "供应商档案已停用；以下保留历史报价供核对。" : "供应商关联信息尚不完整或存在不一致，请编辑报价核对供应商。")}</p>}
              <p className="mt-2 text-pretty text-xs leading-5 text-muted-foreground">{t("以下清单来自已录入报价；档案启停与报价有效期分别展示。")}</p>
            </section>

            <section aria-label={t("当前供应商的物料报价")} className="proc-horizon-surface material-card min-w-0 overflow-hidden">
              <div className="min-w-0 border-b border-border px-4 py-3">
                <div className="mb-3 flex min-w-0 flex-wrap items-baseline justify-between gap-2"><h3 className="text-balance text-sm font-semibold text-foreground">{t("物料报价清单")}</h3><span aria-live="polite" className="text-xs tabular-nums text-muted-foreground">{t("匹配 {count} 条报价", { count: entries.length })}</span></div>
                <div className="proc-supplier-material-filters grid min-w-0 gap-2">
                  <div className="relative min-w-0"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label={t("搜索当前供应商的物料")} placeholder={t("搜索编码 / 名称 / 规格")} value={materialSearch} onChange={(event) => { setMaterialSearch(event.target.value); setMaterialPage(1); }} className="min-w-0 pl-8 text-sm" /></div>
                  <Select value={category || "all"} onValueChange={(value) => { setCategory(value === "all" ? "" : value); setMaterialPage(1); }}><SelectTrigger className="w-full min-w-0" aria-label={t("筛选当前供应商的物料分类")}><SelectValue placeholder={t("全部分类")} /></SelectTrigger><SelectContent><SelectItem value="all">{t("全部分类")}</SelectItem>{categories.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select>
                </div>
                {(materialSearch || category) && <Button variant="link" size="sm" className="mt-2 h-auto px-0 py-0 text-xs" onClick={clearMaterialFilters}>{t("清除物料筛选")}</Button>}
              </div>
              {pageEntries.length ? <ul className="min-w-0 divide-y divide-border">{pageEntries.map((entry) => <DirectoryQuoteCard key={`${selected.key}:${entry.key}`} entry={entry} today={today} canWrite={canWrite} onCompare={onCompare} onEdit={onEdit} />)}</ul> : <div className="flex min-w-0 flex-col items-center px-4 py-10 text-center"><PackageSearch className="mb-3 size-7 text-muted-foreground" /><p className="text-pretty text-sm text-muted-foreground">{t("该供应商没有匹配的物料报价")}</p><Button variant="outline" size="sm" className="mt-3" onClick={clearMaterialFilters}>{t("清除物料筛选")}</Button></div>}
              {materialPages > 1 && <div className="border-t border-border px-4 py-3"><DirectoryPager page={currentMaterialPage} pages={materialPages} label={t("物料报价清单")} onPage={setMaterialPage} /></div>}
            </section>
          </> : <section className="proc-horizon-surface material-card px-5 py-10 text-center"><PackageSearch className="mx-auto mb-3 size-8 text-muted-foreground" /><h2 className="text-balance text-sm font-semibold text-foreground">{t(supplierSearch ? "选择供应商查看已报价物料" : "暂无已报价供应商")}</h2><p className="mt-2 text-pretty text-sm leading-6 text-muted-foreground">{supplierSearch ? t("调整左侧搜索条件后选择供应商。") : canWrite ? t("可在按物料比价中录入厂家报价，或通过页面上方批量导入。") : t("可切换到按物料比价查看物料，报价由有权限的经办人维护。")}</p>{!supplierSearch && onShowMaterials && <Button variant="outline" className="mt-4" onClick={onShowMaterials}>{t("按物料查看")}</Button>}</section>}
        </div>
      </div>
    </div>
  );
}
