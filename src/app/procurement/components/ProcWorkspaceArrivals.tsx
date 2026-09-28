import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, ChevronDown, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";

import { useAuth } from "../../auth";
import { AutoTranslatedText } from "../../components/TranslatableText";
import { Button } from "../../components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../components/ui/collapsible";
import { cn } from "../../components/ui/utils";
import { useAnyPermission, usePermission } from "../../hooks/usePermission";
import { i18nLocale, useI18n } from "../../lib/i18n";
import { getProcWorkspaceArrivalDates, type ProcWorkspaceArrivalDate, type ProcWorkspaceArrivalDatesResponse } from "../../lib/procurementApi";
import type { ProcurementTask } from "../data";
import { workspaceArrivals, type WorkspaceArrival } from "../procurementWorkspaceModel";
import { ArrivalCalendar } from "../arrivals/ArrivalCalendar";
import { selectArrivalRows } from "../arrivals/arrivalCalendarModel";
import type { WorkspaceArrivalView } from "../../lib/workspaceArrivalNavigation";

export const ARRIVAL_PAGE_SIZE = 10;

export interface ProcWorkspaceArrivalsProps {
  tasks: ProcurementTask[];
  onSelect: (id: string) => void;
  disabled?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  page: number;
  onPageChange: (page: number) => void;
  onRestorePage?: (page: number) => void;
  onOpenOrderLine: (row: WorkspaceArrival, target: { orderNo: string; lineId: string }) => void;
  scopeKey?: string;
  focusKey?: string;
  onFocusHandled?: (key: string) => void;
  view?: WorkspaceArrivalView['view'];
  calendarMonth?: string;
  selection?: string;
  onViewChange?: (patch: Partial<WorkspaceArrivalView>) => void;
  onRestoreRange?: (page: number) => void;
}

type ResolvedDate = Extract<ProcWorkspaceArrivalDate, { kind: "line" }>;

/** Read dates for the current visible reference page only; quantities stay in the task's original scope. */
export function ProcWorkspaceArrivals({ tasks, onSelect, disabled = false, open, onOpenChange, page: requestedPage,
  onPageChange, onRestorePage, onOpenOrderLine, scopeKey = "", focusKey, onFocusHandled,
  view = "list", calendarMonth = "", selection = "all", onViewChange, onRestoreRange }: ProcWorkspaceArrivalsProps) {
  const { t } = useI18n();
  const { user } = useAuth();
  const canViewWorkspace = usePermission("page:proc-my-workspace");
  const canViewOrders = useAnyPermission("page:purchase-orders", "page:purchase-order-detail");
  const canViewDetail = usePermission("page:purchase-order-detail");
  const canRead = canViewWorkspace && canViewOrders;
  const allArrivals = useMemo(() => workspaceArrivals(tasks), [tasks]);
  const arrivals = useMemo(() => selection === "all" ? allArrivals : selectArrivalRows(allArrivals, calendarMonth, selection), [allArrivals, calendarMonth, selection]);
  const pageCount = Math.max(1, Math.ceil(arrivals.length / ARRIVAL_PAGE_SIZE));
  const page = Math.min(pageCount, Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1);
  const visibleRows = arrivals.slice((page - 1) * ARRIVAL_PAGE_SIZE, page * ARRIVAL_PAGE_SIZE);
  const refsKey = JSON.stringify([...new Set(visibleRows.filter((row) => !row.dateLinkIssue && row.orderId.trim()).map((row) => row.orderId))]);
  const scope = JSON.stringify([user?.id, user?.name, [...(user?.permissions ?? [])].sort(), open, disabled, canRead, canViewDetail, scopeKey, view, calendarMonth, selection, page, visibleRows]);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const requestRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [result, setResult] = useState<{ scope: string; request: number; data: ProcWorkspaceArrivalDatesResponse } | null>(null);
  const [failure, setFailure] = useState<{ scope: string; message: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const current = result?.scope === scope ? result : null;
  const error = failure?.scope === scope ? failure.message : "";
  const canLoad = open && !disabled && canRead && refsKey !== "[]";
  const busy = canLoad && (loading || (!current && !error));
  const dateByRef = new Map((!busy && !error ? current?.data.items ?? [] : []).map((item) => [item.refId, item]));

  const load = useCallback(async () => {
    if (!canLoad) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const request = ++requestRef.current;
    const isCurrent = () => scopeRef.current === scope && requestRef.current === request && !controller.signal.aborted;
    setResult(null);
    setFailure(null);
    setLoading(true);
    const refIds: string[] = JSON.parse(refsKey);
    try {
      const data = await getProcWorkspaceArrivalDates(refIds, controller.signal);
      if (!isCurrent()) return;
      const returned = new Set(data.items.map((item) => item.refId));
      if (data.readOnly !== true || data.items.length !== refIds.length || returned.size !== refIds.length || refIds.some((id) => !returned.has(id))) {
        throw new Error(t("返回的订单关联与当前到货列表不一致，请重新读取。"));
      }
      setResult({ scope, request, data });
    } catch (cause) {
      if (!isCurrent()) return;
      setFailure({ scope, message: cause instanceof Error ? cause.message : t("订单可用日期读取失败，请重试。") });
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [canLoad, refsKey, scope, t]);

  useEffect(() => {
    void load();
    return () => { requestRef.current += 1; controllerRef.current?.abort(); };
  }, [load]);

  useEffect(() => {
    if (!open || disabled || !focusKey) return;
    const element = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-workspace-arrival-key]") ?? [])
      .find((node) => node.dataset.workspaceArrivalKey === focusKey);
    if (!element) return;
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: "nearest", behavior: "auto" });
    onFocusHandled?.(focusKey);
  }, [open, disabled, focusKey, page, scopeKey, onFocusHandled]);

  const focusIndex = focusKey ? arrivals.findIndex((row) => row.key === focusKey) : -1;
  const fullFocusIndex = focusKey ? allArrivals.findIndex((row) => row.key === focusKey) : -1;
  const focusMissing = Boolean(open && focusKey && focusIndex < 0);
  const focusPage = focusIndex >= 0 ? Math.floor(focusIndex / ARRIVAL_PAGE_SIZE) + 1 : null;
  const dated = visibleRows.filter((row) => row.etaDate);
  const undated = visibleRows.filter((row) => !row.etaDate);
  const renderRows = (rows: WorkspaceArrival[], title: string) => rows.length ? <section aria-label={title}>
    <h3 className="border-t border-border bg-muted/40 px-4 py-2 text-balance text-xs font-semibold text-foreground">{title}</h3>
    <ul className="divide-y divide-border">{rows.map((row) => {
      const date = dateByRef.get(row.orderId);
      // A stale/mismatched task reference never borrows an otherwise valid order line's navigation.
      const identityMatches = date?.kind === "line" && date.taskId === row.taskId && Boolean(row.tpOrderId)
        && date.tpOrderId === row.tpOrderId && date.orderNo === row.orderNo && date.lineNo === row.lineNo;
      const resolved = identityMatches && !row.dateLinkIssue ? date as ResolvedDate : null;
      const issue = row.dateLinkIssue || (date?.kind === "unresolved" ? date.reason : date?.kind === "line" && !identityMatches
        ? t("订单关联已变化，请刷新工作台后重新核对。") : !row.orderId.trim() ? t("采购关联标识缺失，请在任务详情核对。") : "");
      return <ArrivalRow key={row.key} row={row} date={resolved} issue={issue} disabled={disabled} canRead={canRead}
        busy={busy} error={Boolean(error)} canViewDetail={canViewDetail} focused={focusKey === row.key}
        onSelect={() => { if (!disabled && scopeRef.current === scope) onSelect(row.taskId); }}
        onOpen={() => {
          if (!disabled && resolved && scopeRef.current === scope && current?.request === requestRef.current) {
            onOpenOrderLine(row, { orderNo: resolved.orderNo, lineId: resolved.lineId });
          }
        }} />;
    })}</ul>
  </section> : null;

  return <Collapsible open={open} onOpenChange={onOpenChange} disabled={disabled} className="proc-s01-arrivals @container">
    <CollapsibleTrigger asChild>
      <Button type="button" variant="ghost" className="proc-s01-arrivals-trigger group h-auto w-full justify-between gap-3 whitespace-normal text-sm">
        <span className="inline-flex min-w-0 items-center gap-3"><span className="proc-s01-arrivals-icon"><CalendarClock className="size-4" aria-hidden="true" /></span><span className="min-w-0"><span>{t("到货安排")}</span><span className="proc-s01-arrivals-count">{t("{count} 行", { count: allArrivals.length })}</span><span className="proc-s01-arrivals-hint">{t("跟踪当前筛选任务的关联订单。")}</span></span></span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground group-data-[state=open]:rotate-180" aria-hidden="true" />
      </Button>
    </CollapsibleTrigger>
    <CollapsibleContent className="proc-s01-arrivals-body cockpit-scroll">
      {onViewChange && <div className="proc-s01-arrivals-toolbar">
        <p className="text-xs text-muted-foreground">{t("到货日期视图独立于上方任务需求月份。")}</p>
        <div role="group" aria-label={t("到货安排视图")} className="proc-s01-arrivals-views">
          <Button type="button" size="sm" variant="ghost" aria-pressed={view === "list"} disabled={disabled} onClick={() => onViewChange({ view: "list", selection: "all" })}>{t("到货列表")}</Button>
          <Button type="button" size="sm" variant="ghost" aria-pressed={view === "calendar"} disabled={disabled} onClick={() => onViewChange({ view: "calendar" })}>{t("到货日历")}</Button>
        </div>
      </div>}
      {open && view === "calendar" && onViewChange && <ArrivalCalendar rows={allArrivals} month={calendarMonth} selection={selection} disabled={disabled}
        onMonthChange={(next) => onViewChange({ month: next, selection: "all" })} onSelect={(next) => onViewChange({ selection: next })} />}
      {focusMissing ? <div className="border-b border-border px-4 py-3"><p role="status" className="text-pretty text-xs leading-5 text-amber-800">{t(fullFocusIndex >= 0
        ? "原到货记录的日期已变化，不在当前日期范围内。" : "原到货记录不在当前筛选中，可能已转派、删除或变更关联，请从当前列表重新选择。")}</p>
        {fullFocusIndex >= 0 && onRestoreRange && <Button type="button" variant="outline" size="sm" disabled={disabled} className="mt-2" onClick={() => onRestoreRange(Math.floor(fullFocusIndex / ARRIVAL_PAGE_SIZE) + 1)}>{t("清除日期筛选并定位原记录")}</Button>}
      </div> : null}
      {open && focusPage && focusPage !== page ? <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3"><p role="status" className="text-pretty text-xs leading-5 text-muted-foreground">{t("原到货记录已移至第 {page} 页。", { page: focusPage })}</p><Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => (onRestorePage ?? onPageChange)(focusPage)} className="h-9 text-xs">{t("前往原到货记录")}</Button></div> : null}
      {arrivals.length ? <div ref={listRef}>
        <p className="px-4 py-3 text-pretty text-xs leading-5 text-muted-foreground">{t("预计到货和未收数量来自任务关联；人工预计检验后可用日期来自订单行。已收不代表检验合格，确认日期不增加可用库存。")}</p>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3">
          <p className="text-xs tabular-nums text-muted-foreground" aria-live="polite">{t("第 {page} / {pages} 页，共 {count} 行", { page, pages: pageCount, count: arrivals.length })}</p>
          <div className="ml-auto flex flex-wrap gap-1">
            {canRead ? <Button type="button" variant="ghost" size="sm" disabled={disabled || busy || !canLoad} onClick={() => void load()} aria-label={t("刷新当前到货页的订单可用日期")} className="h-9 gap-1.5 px-2 text-xs"><RefreshCw className="size-3.5" aria-hidden="true" />{t("刷新日期")}</Button> : null}
            <Button type="button" variant="outline" size="sm" disabled={disabled || page <= 1} onClick={() => onPageChange(page - 1)} aria-label={t("上一页到货安排")} className="h-9 gap-1 px-2 text-xs"><ChevronLeft className="size-3.5" aria-hidden="true" />{t("上一页")}</Button>
            <Button type="button" variant="outline" size="sm" disabled={disabled || page >= pageCount} onClick={() => onPageChange(page + 1)} aria-label={t("下一页到货安排")} className="h-9 gap-1 px-2 text-xs">{t("下一页")}<ChevronRight className="size-3.5" aria-hidden="true" /></Button>
          </div>
        </div>
        {!canRead ? <p className="border-t border-border px-4 py-3 text-pretty text-xs leading-5 text-muted-foreground">{t("暂无工作台或采购订单查看权限，仍可查看已有任务关联。")}</p>
          : error ? <div className="border-t border-border px-4 py-3"><p role="alert" className="text-pretty text-xs leading-5 text-rose-700">{error}</p><Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => void load()} className="mt-2 h-9 text-xs">{t("重新读取订单可用日期")}</Button></div>
            : busy ? <p role="status" className="border-t border-border px-4 py-3 text-xs text-muted-foreground">{t("正在读取本页订单可用日期…")}</p> : null}
        {renderRows(dated, t("已填写预计到货日期"))}
        {renderRows(undated, t("日期待确认"))}
      </div> : <p role="status" className="proc-s01-arrivals-empty text-pretty">{t(allArrivals.length
        ? "当前日期范围内没有关联订单，可选择其他日期或查看全部关联。" : "当前筛选下尚无关联订单。选择采购任务，在完整详情中核对下单安排。")}</p>}
    </CollapsibleContent>
  </Collapsible>;
}

function timestamp(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString(i18nLocale(), {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }) : "—";
}

function ArrivalRow({ row, date, issue, disabled, canRead, canViewDetail, busy, error, focused, onSelect, onOpen }: {
  row: WorkspaceArrival; date: ResolvedDate | null; issue: string; disabled: boolean; canRead: boolean; canViewDetail: boolean;
  busy: boolean; error: boolean; focused: boolean; onSelect: () => void; onOpen: () => void;
}) {
  const { t } = useI18n();
  const availability = date?.availability;
  const availabilityStatus = !availability ? "可用日期未确认" : !availability.availableDate ? "可用日期已撤销"
    : availability.needsReconfirmation ? "可用日期需重确认" : "人工确认";
  return <li tabIndex={-1} data-workspace-arrival-key={row.key} className={cn("min-w-0 scroll-mt-4 p-4 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", focused && "bg-accent/30")}>
    <div className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-3 @2xl:grid-cols-5">
      <div className="col-span-2 min-w-0">
        <p className="break-words text-pretty text-sm font-medium text-foreground"><AutoTranslatedText text={row.materialName} />{row.spec ? <span className="ml-2 text-xs font-normal text-muted-foreground"><AutoTranslatedText text={row.spec} /></span> : null}</p>
        <p className="mt-1 break-all text-xs tabular-nums leading-5 text-muted-foreground">{row.orderNo || t(row.freeSample ? "无正式采购单号" : "单号待确认")} · {row.lineNo ? `${t("行号")} ${row.lineNo}` : t("行号待确认")}</p>
        <p className="mt-1 break-words text-xs leading-5 text-muted-foreground"><AutoTranslatedText text={row.supplier || t("供应商未确定")} />{row.freeSample ? <span className="ml-2 rounded bg-accent px-1.5 py-0.5 text-primary">{t("免费样品")}</span> : null}</p>
      </div>
      <div className="min-w-0 text-xs"><p className="text-muted-foreground">{t("任务关联预计到货")}</p><p className="mt-1 font-medium tabular-nums text-foreground">{row.etaDate || t("待确认")}</p><p className="mt-2 text-muted-foreground">{t("未收数量")} <span className="font-medium tabular-nums text-foreground">{row.remainingQty === null ? t("待核对") : `${row.remainingQty.toLocaleString()} ${t(row.unit)}`}</span></p></div>
      <div className="min-w-0 text-xs"><p className="text-muted-foreground">{t("人工预计检验后可用")}</p>{date ? <><p className="mt-1 font-medium tabular-nums text-foreground">{availability?.availableDate || "—"}</p><p className={cn("mt-2 text-pretty leading-5", availability?.needsReconfirmation ? "text-amber-800" : "text-muted-foreground")}>{t(availabilityStatus)}</p></>
        : <p className="mt-1 text-muted-foreground">{t(disabled ? "暂不可用" : !canRead ? "暂无查看权限" : busy ? "读取中…" : error ? "读取失败" : issue ? "关联待核对" : "—")}</p>}</div>
      <div className="col-span-2 flex flex-wrap justify-end gap-2 @2xl:col-span-1 @2xl:flex-col @2xl:items-end @2xl:justify-start">
        <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={onSelect} aria-label={t("查看到货任务：{material}，{code}，{order}，{line}", { material: row.materialName, code: row.taskCode, order: row.orderNo || t(row.freeSample ? "免费样品" : "单号待确认"), line: row.lineNo || t("行号待确认") })} className="h-9 px-2 text-xs">{t("查看任务")}</Button>
        {canRead && canViewDetail && date && !busy && !error && !disabled ? <Button type="button" variant="outline" size="sm" disabled={!date.lineId || !date.orderNo} onClick={onOpen} aria-label={t("查看采购订单 {order} 第 {line} 行", { order: date.orderNo, line: date.lineNo })} className="h-9 text-xs">{t("查看订单行")}</Button> : null}
      </div>
    </div>
    <div className="mt-2 space-y-1 border-t border-border pt-2 text-xs leading-5 text-muted-foreground">
      <p className="break-words text-pretty">{t("关联任务")}：{row.sourceTaskCodes.join("、")}</p>
      {issue ? <p className="break-words text-pretty text-amber-800">{issue}</p> : null}
      {date && date.etaDate !== (row.etaDate || null) ? <p className="text-pretty">{t("订单最新预计到货")}：<span className="tabular-nums">{date.etaDate || t("未提供")}</span> · {t("与任务关联日期不同，请核对。")}</p> : null}
      {date ? <p className="flex flex-wrap gap-x-3"><span className="break-words">{t("ERP 状态")}：{date.orderStatus || t("未提供")}{date.approvalStatus ? ` · ${date.approvalStatus}` : ""}</span><span className="tabular-nums">{t("最近同步")}：{timestamp(date.syncedAt)}</span></p> : null}
      {availability ? <p className="break-words text-pretty">{t("确认人")}：{availability.confirmedByName || t("未提供")} · <span className="tabular-nums">{timestamp(availability.confirmedAt)}</span></p> : null}
      {availability?.needsReconfirmation ? <p className="text-pretty text-amber-800">{t("订单来源已变化，请核对后重新确认日期。")}</p> : null}
      {availability?.note ? <details className="min-w-0"><summary className="cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t("查看确认说明")}</summary><p className="mt-1 whitespace-pre-wrap break-words text-pretty">{availability.note}</p></details> : null}
    </div>
  </li>;
}
