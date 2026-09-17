import { useMemo, useState } from "react";
import { PackageCheck, Search } from "lucide-react";

import { Input } from "../../components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { i18nLocale, useI18n } from "../../lib/i18n";
import type { Q5PackagingInventoryData } from "../../lib/procurementApi";
import { getInventoryDiagnosticCopy, InventoryMatchExplanation } from "./InventoryMatchExplanation";

function quantity(value: number | null) {
  return value === null ? "—" : new Intl.NumberFormat(i18nLocale(), { maximumFractionDigits: 4 }).format(value);
}

export function Q5PackagingInventory({ data }: { data: Q5PackagingInventoryData }) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const items = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("zh-CN");
    return data.items.filter((item) => !keyword || `${item.code} ${item.name}`.toLocaleLowerCase("zh-CN").includes(keyword));
  }, [data.items, query]);

  return (
    <section id="q5-packaging-inventory" aria-labelledby="q5-packaging-title" className="mt-4 overflow-hidden rounded-[14px] border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,.03)]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-4">
        <div className="min-w-0 flex-1">
          <h2 id="q5-packaging-title" className="flex items-center gap-2 text-sm font-bold text-slate-900"><PackageCheck className="size-4 shrink-0 text-primary" aria-hidden="true" />{t("Q5 包材与随箱配件")}</h2>
          <p className="mt-1 text-xs leading-5 text-slate-600">{t("包材表未填写配套数量；装配用量按同编码引用，仅供参考。")}</p>
          <p className="text-xs leading-5 text-slate-500">{t("以下清单独立展示，不重复计入装配需求；配套数量确认后才能核算包装齐套。")}</p>
        </div>
        <span className="shrink-0 text-xs text-slate-500 tabular-nums" aria-live="polite">{t("显示 {count} / {total} 行", { count: items.length, total: data.items.length })}</span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/50 px-4 py-3">
        <div className="relative min-w-[220px] flex-1 sm:max-w-md">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("搜索包材货号或名称")} aria-label={t("搜索包材与随箱配件")} className="h-9 border-slate-200 bg-white pl-9" />
        </div>
        <p className="min-w-0 break-all text-[11px] text-slate-500">{t("来源")}：{data.sourceFile} · {data.sourceSheet}</p>
      </div>
        <p className="proc-readiness-scroll-hint px-4 py-2 text-xs text-slate-500">{t("左右滑动查看包材库存与状态")}</p>
        <div role="region" aria-label={t("包材库存明细，可横向滚动查看更多列")} tabIndex={0} className="max-h-[520px] overflow-auto focus-visible:outline-2 focus-visible:outline-primary">
        <Table aria-label={t("Q5 包材与随箱配件清单")} className="min-w-[900px]" containerClassName="overflow-visible">
          <TableHeader className="sticky top-0 z-10 bg-slate-50">
            <TableRow>
              <TableHead className="w-14 pl-4 text-xs">{t("序号")}</TableHead>
              <TableHead className="min-w-[260px] text-xs">{t("货号 / 品名")}</TableHead>
              <TableHead className="whitespace-nowrap text-right text-xs">{t("装配用量参考")}</TableHead>
              <TableHead className="whitespace-nowrap text-right text-xs">{t("现存量")}</TableHead>
              <TableHead className="whitespace-nowrap text-right text-xs">{t("可用量")}</TableHead>
              <TableHead className="whitespace-nowrap text-right text-xs">{t("在途")}</TableHead>
              <TableHead className="min-w-[210px] pr-4 text-xs">{t("状态说明")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => {
              const conflict = item.issue === "code_conflict";
              const missingInventory = item.stock === null || item.available === null || item.inTransit === null;
              return <TableRow key={item.id} data-source-row={item.sourceRow}>
                <TableCell className="pl-4 text-xs text-muted-foreground tabular-nums" title={t("原表第 {row} 行", { row: item.sourceRow })}>{item.sourceRow - 1}</TableCell>
                <TableCell className="py-3">
                  <span className="font-mono text-[11px] text-slate-500">{item.code}</span>
                  <p className="mt-0.5 whitespace-normal text-sm font-medium text-slate-800">{item.name}</p>
                </TableCell>
                <TableCell className="text-right text-xs tabular-nums">{conflict ? "—" : item.qtyPer === null ? <span className="text-amber-700">{t("待补充")}</span> : `${quantity(item.qtyPer)} ${item.unit}`}</TableCell>
                <TableCell className="text-right text-xs tabular-nums">{quantity(conflict ? null : item.stock)}</TableCell>
                <TableCell className="text-right text-xs tabular-nums">{quantity(conflict ? null : item.available)}</TableCell>
                <TableCell className="text-right text-xs tabular-nums">{quantity(conflict ? null : item.inTransit)}</TableCell>
                <TableCell className="pr-4 text-xs leading-5">
                  {conflict ? <p className="font-semibold text-rose-700">{t("货号待核对：同一货号存在不同规格")}</p> : <>
                    {item.qtyPer === null && <p className="text-amber-700">{t("装配用量待补充")}</p>}
                    {missingInventory && <div className="max-w-md whitespace-normal"><p className="font-medium text-amber-700">{t(getInventoryDiagnosticCopy(item.inventoryDiagnostic).label)}</p><InventoryMatchExplanation diagnostic={item.inventoryDiagnostic} /></div>}
                    {item.qtyPer !== null && !missingInventory && <p className="text-slate-500">{t("装配用量及库存仅供参考")}</p>}
                  </>}
                  {item.duplicateOfRow !== null && <p className="text-slate-500">{t("原表重复：与第 {row} 行相同，未重复计入用量。", { row: item.duplicateOfRow })}</p>}
                </TableCell>
              </TableRow>;
            })}
            {items.length === 0 && <TableRow><TableCell colSpan={7} className="h-28 text-center text-sm text-slate-500">{t("没有匹配的包材或随箱配件")}</TableCell></TableRow>}
          </TableBody>
        </Table>
        </div>
    </section>
  );
}
