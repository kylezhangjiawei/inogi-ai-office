// 物料树形表格：大类（T+ 类别前缀）→ 分类 → 物料行；任一过滤激活时切扁平列表 + 分页。
import { useMemo, useState } from "react";
import { Input } from "../../components/ui/input";
import { ChevronDown, ChevronRight, Search, X } from "lucide-react";
import { Checkbox } from "../../components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { cn } from "../../components/ui/utils";
import { AutoTranslatedText } from "../../components/TranslatableText";
import { useI18n } from "../../lib/i18n";
import { materialAggregates, useProductLines, type Material, type ProcurementTask } from "../data";
import { fmtMoney } from "./common";

const PAGE_SIZE = 50;

export interface MaterialFilters {
  keyword: string;
  productLine: string;
  reviewStatus: "" | "pending" | "approved" | "rejected";
  onlyStock: boolean;
}

export const EMPTY_MATERIAL_FILTERS: MaterialFilters = { keyword: "", productLine: "", reviewStatus: "", onlyStock: false };

/** 大类：按 T+ 类别名的「-」前缀分组（量产-R电子元器件 → 量产），无前缀的归整名。 */
function majorOf(category: string): string {
  const idx = category.indexOf("-");
  return idx > 0 ? category.slice(0, idx) : category || "未分类";
}

function ReviewPill({ status }: { status: Material["reviewStatus"] }) {
  const { t } = useI18n();
  if (status === "pending") return <span className="rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">{t('待审核')}</span>;
  if (status === "rejected") return <span className="rounded-full border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] text-rose-600">{t('已驳回')}</span>;
  return <span className="rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-600">{t('已通过')}</span>;
}

export function MaterialTable({ materials, tasks, filters, onFiltersChange, onOpen }: {
  materials: Material[];
  tasks: ProcurementTask[];
  filters: MaterialFilters;
  onFiltersChange: (next: MaterialFilters) => void;
  onOpen: (material: Material) => void;
}) {
  const { t } = useI18n();
  const productLines = useProductLines();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);

  const filterActive = Boolean(filters.keyword.trim() || filters.productLine || filters.reviewStatus || filters.onlyStock);

  const filtered = useMemo(() => {
    const kw = filters.keyword.trim().toLowerCase();
    return materials.filter((m) =>
      (!kw || `${m.name} ${m.spec} ${m.erpCode} ${m.tpInventoryCode ?? ""}`.toLowerCase().includes(kw)) &&
      (!filters.productLine || m.productLine === filters.productLine) &&
      (!filters.reviewStatus || m.reviewStatus === filters.reviewStatus) &&
      (!filters.onlyStock || m.stockQty > 0));
  }, [materials, filters]);

  // 树形分组：大类 → 分类 → 物料（无过滤时使用）
  const tree = useMemo(() => {
    const majors = new Map<string, Map<string, Material[]>>();
    for (const m of materials) {
      const major = majorOf(m.category || "未分类");
      const cat = m.category || "未分类";
      const cats = majors.get(major) ?? new Map<string, Material[]>();
      const list = cats.get(cat) ?? [];
      list.push(m);
      cats.set(cat, list);
      majors.set(major, cats);
    }
    return [...majors.entries()]
      .map(([major, cats]) => ({
        major,
        count: [...cats.values()].reduce((s, l) => s + l.length, 0),
        cats: [...cats.entries()].map(([cat, list]) => ({ cat, list: list.sort((a, b) => (a.tpInventoryCode ?? a.erpCode).localeCompare(b.tpInventoryCode ?? b.erpCode)) })).sort((a, b) => b.list.length - a.list.length),
      }))
      .sort((a, b) => b.count - a.count);
  }, [materials]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const pageRows = filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

  const setF = <K extends keyof MaterialFilters>(key: K, value: MaterialFilters[K]) => {
    onFiltersChange({ ...filters, [key]: value });
    setPage(1);
  };
  const toggle = (key: string) => setExpanded((cur) => {
    const next = new Set(cur);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const th = "px-3 py-2 text-left text-xs font-semibold text-slate-500";
  const td = "px-3 py-1.5 text-sm text-slate-700";

  const materialRow = (m: Material, indent: number, showCategory: boolean) => {
    const agg = materialAggregates(tasks, m.name);
    return (
      <tr key={m.id} onClick={() => onOpen(m)} className="cursor-pointer border-t border-slate-50 hover:bg-indigo-50/40">
        <td className={td}>
          <div className="flex items-center gap-2" style={{ paddingLeft: indent * 22 }}>
            <span className="shrink-0 font-mono text-xs text-slate-400">{m.tpInventoryCode ?? m.erpCode}</span>
            <AutoTranslatedText className="truncate font-medium" text={m.name} />
          </div>
        </td>
        <td className={cn(td, "max-w-[160px] truncate text-xs text-slate-500")}><AutoTranslatedText text={m.spec || "—"} /></td>
        <td className={td}>{t(m.unit || "—")}</td>
        {showCategory && <td className={cn(td, "text-xs text-slate-500")}><AutoTranslatedText text={m.category || "未分类"} /></td>}
        <td className={td}>{m.productLine || "—"}</td>
        <td className={cn(td, "text-right tabular-nums", m.stockQty === 0 && "text-slate-300")}>{m.stockQty.toLocaleString()}</td>
        <td className={cn(td, "text-right tabular-nums", agg.inTransit === 0 && "text-slate-300")}>{agg.inTransit.toLocaleString()}</td>
        <td className={cn(td, "text-right tabular-nums text-xs")}>{m.latestPrice != null ? fmtMoney(m.latestPrice) : "—"}</td>
        <td className={td}><ReviewPill status={m.reviewStatus} /></td>
      </tr>
    );
  };

  return (
    // 填满父级剩余高度：过滤条/分页固定，表格区内部滚动（父级不出滚动条）
    <div className="material-card flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* 过滤条 */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
        <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm">
          <Search className="h-4 w-4 text-slate-400" />
          <Input value={filters.keyword} onChange={(e) => setF("keyword", e.target.value)} placeholder={t('搜索名称 / 规格 / 编码')} className="w-52 bg-transparent outline-none placeholder:text-slate-400" />
          {filters.keyword && <button type="button" onClick={() => setF("keyword", "")}><X className="h-3.5 w-3.5 text-slate-400" /></button>}
        </div>
        {/* "all" 哨兵：Radix SelectItem 不允许空字符串 value，全站同款约定 */}
        <Select value={filters.productLine || "all"} onValueChange={(v) => setF("productLine", v === "all" ? "" : v)}>
          <SelectTrigger className="h-9 w-36 rounded-lg border-slate-200 text-sm text-slate-600">
            <SelectValue placeholder={t('全部产品线')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('全部产品线')}</SelectItem>
            {productLines.map((pl) => <SelectItem key={pl} value={pl}>{pl}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.reviewStatus || "all"} onValueChange={(v) => setF("reviewStatus", (v === "all" ? "" : v) as MaterialFilters["reviewStatus"])}>
          <SelectTrigger className="h-9 w-32 rounded-lg border-slate-200 text-sm text-slate-600">
            <SelectValue placeholder={t('全部状态')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('全部状态')}</SelectItem>
            <SelectItem value="pending">{t('待审核')}</SelectItem>
            <SelectItem value="approved">{t('已通过')}</SelectItem>
            <SelectItem value="rejected">{t('已驳回')}</SelectItem>
          </SelectContent>
        </Select>
        <label className="flex cursor-pointer items-center gap-1.5 text-sm text-slate-600">
          <Checkbox checked={filters.onlyStock} onCheckedChange={(v) => setF("onlyStock", v === true)} />
          {t('只看有库存')}
        </label>
        {filterActive && (
          <button type="button" onClick={() => { onFiltersChange(EMPTY_MATERIAL_FILTERS); setPage(1); }} className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs text-indigo-600">{t('清除筛选')} ✕</button>
        )}
        <span className="ml-auto text-xs text-slate-400">
          {filterActive ? t('{count} 条结果', { count: filtered.length }) : t('{count} 个物料', { count: materials.length })}
        </span>
      </div>

      {/* 占据卡片剩余高度，行数多时内部滚动；表头吸顶 */}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[960px]">
          <thead className="sticky top-0 z-10 bg-slate-50">
            <tr>
              <th className={th}>{t('编码 / 名称')}</th>
              <th className={th}>{t('规格')}</th>
              <th className={th}>{t('单位')}</th>
              {filterActive && <th className={th}>{t('分类')}</th>}
              <th className={th}>{t('产品线')}</th>
              <th className={cn(th, "text-right")}>{t('库存')}</th>
              <th className={cn(th, "text-right")}>{t('在途')}</th>
              <th className={cn(th, "text-right")}>{t('最新报价')}</th>
              <th className={th}>{t('状态')}</th>
            </tr>
          </thead>
          <tbody>
            {filterActive ? (
              pageRows.length === 0 ? (
                <tr><td colSpan={9} className="py-12 text-center text-sm text-slate-400">{t('没有符合条件的物料')}</td></tr>
              ) : (
                pageRows.map((m) => materialRow(m, 0, true))
              )
            ) : (
              tree.map((major) => (
                [
                  <tr key={major.major} onClick={() => toggle(major.major)} className="cursor-pointer border-t border-slate-100 bg-slate-50/50 hover:bg-slate-100/60">
                    <td className={cn(td, "font-semibold text-slate-800")} colSpan={8}>
                      <span className="flex items-center gap-1.5">
                        {expanded.has(major.major) ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                        <AutoTranslatedText text={major.major} />
                        <span className="rounded-full bg-slate-200/70 px-1.5 text-[11px] font-medium tabular-nums text-slate-500">{major.count}</span>
                      </span>
                    </td>
                  </tr>,
                  ...(expanded.has(major.major)
                    ? major.cats.flatMap((c) => [
                        <tr key={major.major + c.cat} onClick={() => toggle(major.major + "::" + c.cat)} className="cursor-pointer border-t border-slate-50 hover:bg-slate-50">
                          <td className={td} colSpan={8}>
                            <span className="flex items-center gap-1.5" style={{ paddingLeft: 22 }}>
                              {expanded.has(major.major + "::" + c.cat) ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
                              <AutoTranslatedText className="font-medium text-slate-700" text={c.cat} />
                              <span className="rounded-full bg-slate-100 px-1.5 text-[11px] tabular-nums text-slate-400">{c.list.length}</span>
                            </span>
                          </td>
                        </tr>,
                        ...(expanded.has(major.major + "::" + c.cat) ? c.list.map((m) => materialRow(m, 2, false)) : []),
                      ])
                    : []),
                ]
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 分页：仅扁平过滤模式需要 */}
      {filterActive && filtered.length > PAGE_SIZE && (
        <div className="flex shrink-0 items-center justify-between border-t border-slate-100 px-4 py-2.5 text-sm">
          <span className="text-xs text-slate-400">{t('第 {page} / {total} 页', { page: pageSafe, total: totalPages })}</span>
          <div className="flex items-center gap-2">
            <button type="button" disabled={pageSafe <= 1} onClick={() => setPage(pageSafe - 1)} className="rounded-lg border border-slate-200 px-3 py-1 text-xs text-slate-600 disabled:opacity-40">{t('上一页')}</button>
            <button type="button" disabled={pageSafe >= totalPages} onClick={() => setPage(pageSafe + 1)} className="rounded-lg border border-slate-200 px-3 py-1 text-xs text-slate-600 disabled:opacity-40">{t('下一页')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
