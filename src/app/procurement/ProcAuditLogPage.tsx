import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Database,
  FileClock,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
  UserRound,
} from "lucide-react";

import { Input } from "../components/ui/input";
import { NativeSelect } from "../components/ui/native-select";
import { cn } from "../components/ui/utils";
import { useI18n } from "../lib/i18n";
import {
  listProcAuditLogs,
  type ProcAuditAction,
  type ProcAuditLogItem,
  type ProcAuditLogPage,
} from "../lib/procurementApi";
import { PageHeader } from "./components/common";

const EMPTY_PAGE: ProcAuditLogPage = { total: 0, page: 1, pageSize: 20, snapshotAt: "", items: [] };
const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;
const KEYWORD_DEBOUNCE_MS = 300;
const DATE_TIME_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

const SECTION_LABELS: Record<string, string> = {
  tasks: "采购任务",
  materials: "物料主数据",
  "quote-book": "供应商报价库",
  "buyer-roster": "采购成员",
  "task-tree": "采购系统树",
  bom: "BOM 数据",
  tplus: "畅捷通同步",
  other: "采购模块",
};

const DETAIL_FIELD_LABELS: Record<string, string> = {
  buyer: "负责人",
  buyerUserId: "负责人 ID",
  code: "业务编码",
  materialId: "物料 ID",
  materialIds: "物料",
  method: "采购方式",
  name: "名称",
  nodeId: "节点 ID",
  parentId: "上级节点",
  priority: "优先级",
  productId: "产品 ID",
  purchaseOrderId: "采购单 ID",
  quantity: "数量",
  quotationId: "报价 ID",
  receivedQty: "到货数量",
  status: "状态",
  targetStatus: "目标状态",
  taskId: "任务 ID",
  taskIds: "任务",
  userId: "人员 ID",
};

type ActionMeta = {
  label: string;
  Icon: ComponentType<{ className?: string }>;
  badge: string;
  rail: string;
};

const ACTION_META: Record<ProcAuditAction, ActionMeta> = {
  POST: {
    label: "新增 / 执行",
    Icon: Plus,
    badge: "border-indigo-200 bg-indigo-50 text-indigo-700",
    rail: "bg-indigo-500",
  },
  PUT: {
    label: "更新",
    Icon: Pencil,
    badge: "border-amber-200 bg-amber-50 text-amber-700",
    rail: "bg-amber-500",
  },
  PATCH: {
    label: "调整",
    Icon: Pencil,
    badge: "border-sky-200 bg-sky-50 text-sky-700",
    rail: "bg-sky-500",
  },
  DELETE: {
    label: "删除",
    Icon: Trash2,
    badge: "border-rose-200 bg-rose-50 text-rose-700",
    rail: "bg-rose-500",
  },
};

const FALLBACK_ACTION_META: ActionMeta = {
  label: "系统操作",
  Icon: FileClock,
  badge: "border-slate-200 bg-slate-50 text-slate-600",
  rail: "bg-slate-400",
};

function actionMeta(action: string): ActionMeta {
  return ACTION_META[action as ProcAuditAction] ?? FALLBACK_ACTION_META;
}

function sectionLabel(section: string): string {
  return SECTION_LABELS[section] ?? section;
}

function formatDateTime(value: string, lang: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const locale = lang === "en" ? "en-US" : "zh-CN";
  let formatter = DATE_TIME_FORMATTERS.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    DATE_TIME_FORMATTERS.set(locale, formatter);
  }
  return formatter.format(date);
}

function localDayBound(value: string, nextDay = false): string | undefined {
  if (!value) return undefined;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return undefined;
  if (nextDay) date.setDate(date.getDate() + 1);
  return date.toISOString();
}

export function ProcAuditLogPage() {
  const { lang, t } = useI18n();
  const [keyword, setKeyword] = useState("");
  const [debouncedKeyword, setDebouncedKeyword] = useState("");
  const [action, setAction] = useState<ProcAuditAction | "">("");
  const [section, setSection] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(20);
  const [data, setData] = useState<ProcAuditLogPage>(EMPTY_PAGE);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const snapshotAtRef = useRef<string>();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1);
      setDebouncedKeyword(keyword.trim());
    }, KEYWORD_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [keyword]);

  useEffect(() => {
    snapshotAtRef.current = undefined;
  }, [action, dateFrom, dateTo, debouncedKeyword, pageSize, reloadToken, section]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void listProcAuditLogs(
      {
        page,
        pageSize,
        keyword: debouncedKeyword || undefined,
        action: action || undefined,
        section: section || undefined,
        dateFrom: localDayBound(dateFrom),
        dateTo: localDayBound(dateTo, true),
        snapshotAt: snapshotAtRef.current,
      },
      controller.signal,
    )
      .then((result) => {
        snapshotAtRef.current = result.snapshotAt;
        setData(result);
        if (result.page !== page) setPage(result.page);
        setSelectedId((current) =>
          current && result.items.some((item) => item.id === current)
            ? current
            : (result.items[0]?.id ?? null),
        );
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setData(EMPTY_PAGE);
        setSelectedId(null);
        setError(cause instanceof Error ? cause.message : t("采购操作留痕加载失败"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [action, dateFrom, dateTo, debouncedKeyword, page, pageSize, reloadToken, section, t]);

  const totalPages = Math.max(1, Math.ceil(data.total / pageSize));
  useEffect(() => {
    if (!loading && !error && page > totalPages) setPage(totalPages);
  }, [error, loading, page, totalPages]);

  const selected = data.items.find((item) => item.id === selectedId) ?? null;
  const pageStats = useMemo(() => {
    let created = 0;
    let updated = 0;
    let deleted = 0;
    for (const item of data.items) {
      if (item.action === "POST") created += 1;
      else if (item.action === "DELETE") deleted += 1;
      else if (item.action === "PUT" || item.action === "PATCH") updated += 1;
    }
    return { created, updated, deleted };
  }, [data.items]);

  const resetFilters = () => {
    setKeyword("");
    setDebouncedKeyword("");
    setAction("");
    setSection("");
    setDateFrom("");
    setDateTo("");
    setPage(1);
    snapshotAtRef.current = undefined;
  };

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-[1440px] flex-col p-4">
      <PageHeader
        Icon={ShieldCheck}
        badge={t("采购管理")}
        title={t("采购操作留痕")}
        description={t("集中查看采购任务、物料、报价、成员和系统树的写操作记录；数据只读并已脱敏。")}
        right={
          <button
            type="button"
            onClick={() => setReloadToken((value) => value + 1)}
            disabled={loading}
            className="material-button-secondary inline-flex items-center gap-1.5 px-3 py-2 text-sm disabled:opacity-50"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            {t("刷新")}
          </button>
        }
      />

      <section className="material-card mb-3 p-4" aria-label={t("留痕筛选")}>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(240px,1.6fr)_180px_190px_160px_160px_auto]">
          <label className="relative block">
            <span className="sr-only">{t("搜索操作人或业务对象")}</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder={t("搜索操作人、动作或业务对象…")}
              className="h-10 rounded-lg border-slate-200 bg-slate-50/70 pl-9 focus:bg-white"
            />
          </label>
          <NativeSelect
            aria-label={t("操作类型")}
            value={action}
            onChange={(event) => { setAction(event.target.value as ProcAuditAction | ""); setPage(1); }}
            className="h-10 rounded-lg border-slate-200 bg-white text-sm"
          >
            <option value="">{t("全部操作")}</option>
            <option value="POST">{t("新增 / 执行")}</option>
            <option value="PUT">{t("更新")}</option>
            <option value="PATCH">{t("调整")}</option>
            <option value="DELETE">{t("删除")}</option>
          </NativeSelect>
          <NativeSelect
            aria-label={t("业务对象")}
            value={section}
            onChange={(event) => { setSection(event.target.value); setPage(1); }}
            className="h-10 rounded-lg border-slate-200 bg-white text-sm"
          >
            <option value="">{t("全部业务对象")}</option>
            {Object.entries(SECTION_LABELS).filter(([key]) => key !== "other").map(([key, label]) => (
              <option key={key} value={key}>{t(label)}</option>
            ))}
          </NativeSelect>
          <label className="block">
            <span className="sr-only">{t("开始日期")}</span>
            <Input type="date" value={dateFrom} max={dateTo || undefined} onChange={(event) => { setDateFrom(event.target.value); setPage(1); }} className="h-10 rounded-lg border-slate-200 bg-white text-sm" />
          </label>
          <label className="block">
            <span className="sr-only">{t("结束日期")}</span>
            <Input type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => { setDateTo(event.target.value); setPage(1); }} className="h-10 rounded-lg border-slate-200 bg-white text-sm" />
          </label>
          <button type="button" onClick={resetFilters} className="material-button-secondary inline-flex h-10 items-center justify-center gap-1.5 px-3 text-sm">
            <RotateCcw className="h-4 w-4" />{t("重置")}
          </button>
        </div>
      </section>

      <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {[
          { label: t("匹配记录"), value: data.total, Icon: Database, tone: "text-slate-700 bg-slate-100" },
          { label: t("本页新增 / 执行"), value: pageStats.created, Icon: Plus, tone: "text-indigo-700 bg-indigo-50" },
          { label: t("本页更新 / 调整"), value: pageStats.updated, Icon: Pencil, tone: "text-amber-700 bg-amber-50" },
          { label: t("本页删除"), value: pageStats.deleted, Icon: Trash2, tone: "text-rose-700 bg-rose-50" },
        ].map(({ label, value, Icon, tone }) => (
          <div key={label} className="material-card flex items-center justify-between px-4 py-3">
            <div><div className="text-[11px] font-medium text-slate-400">{label}</div><div className="mt-1 text-xl font-bold tabular-nums text-slate-900">{value}</div></div>
            <span className={cn("flex h-9 w-9 items-center justify-center rounded-xl", tone)}><Icon className="h-4 w-4" /></span>
          </div>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="material-card flex min-h-[420px] min-w-0 flex-col overflow-hidden" aria-label={t("操作留痕列表")}>
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">{t("操作时间线")}</h2>
              <p className="mt-0.5 text-xs text-slate-400">{t("最新操作优先，点击记录查看脱敏详情")}</p>
            </div>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-500">{t("只读")}</span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {loading ? (
              <div className="flex h-full min-h-64 items-center justify-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />{t("正在读取采购留痕…")}</div>
            ) : error ? (
              <div className="flex h-full min-h-64 flex-col items-center justify-center text-center">
                <AlertTriangle className="h-8 w-8 text-amber-500" />
                <p className="mt-3 text-sm font-semibold text-slate-700">{t("留痕读取失败")}</p>
                <p className="mt-1 max-w-md text-xs text-slate-400">{error}</p>
                <button type="button" onClick={() => setReloadToken((value) => value + 1)} className="material-button-secondary mt-4 px-3 py-2 text-sm">{t("重新读取")}</button>
              </div>
            ) : data.items.length === 0 ? (
              <div className="flex h-full min-h-64 flex-col items-center justify-center text-center">
                <FileClock className="h-9 w-9 text-slate-300" />
                <p className="mt-3 text-sm font-semibold text-slate-600">{t("没有匹配的采购操作记录")}</p>
                <p className="mt-1 text-xs text-slate-400">{t("调整筛选条件，或等待采购模块产生新的写操作。")}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {data.items.map((item, index) => {
                  const meta = actionMeta(item.action);
                  const Icon = meta.Icon;
                  const active = item.id === selectedId;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedId(item.id)}
                      aria-pressed={active}
                      className={cn(
                        "group relative flex w-full items-center gap-3 overflow-hidden rounded-xl border bg-white px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40",
                        active ? "border-indigo-200 bg-indigo-50/50 shadow-sm" : "border-slate-100 hover:border-slate-200 hover:bg-slate-50/70",
                      )}
                    >
                      <span className={cn("absolute inset-y-2 left-0 w-1 rounded-r-full", meta.rail)} />
                      <span className="w-8 shrink-0 text-center text-[10px] font-semibold tabular-nums text-slate-300">{String((page - 1) * pageSize + index + 1).padStart(2, "0")}</span>
                      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border", meta.badge)}><Icon className="h-4 w-4" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-slate-800">{t(meta.label)}</span>
                          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">{t(sectionLabel(item.section))}</span>
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
                          <span className="inline-flex items-center gap-1"><UserRound className="h-3 w-3" />{item.operator.name}</span>
                          <span className="inline-flex items-center gap-1"><Clock3 className="h-3 w-3" />{formatDateTime(item.occurredAt, lang)}</span>
                        </span>
                      </span>
                      <ChevronRight className={cn("h-4 w-4 shrink-0 text-slate-300 transition-transform", active && "translate-x-0.5 text-indigo-500")} />
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span>{t("共 {count} 条", { count: data.total })}</span>
              <NativeSelect
                aria-label={t("每页条数")}
                value={pageSize}
                onChange={(event) => { setPageSize(Number(event.target.value) as (typeof PAGE_SIZE_OPTIONS)[number]); setPage(1); }}
                className="h-11 w-24 rounded-lg border-slate-200 bg-white text-xs"
              >
                {PAGE_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{t("{count} 条/页", { count: size })}</option>)}
              </NativeSelect>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))} className="material-button-secondary inline-flex h-11 items-center gap-1 px-3 text-xs disabled:opacity-40"><ChevronLeft className="h-3.5 w-3.5" />{t("上一页")}</button>
              <span className="min-w-20 text-center text-xs font-medium tabular-nums text-slate-500">{page} / {totalPages}</span>
              <button type="button" disabled={page >= totalPages || loading} onClick={() => setPage((value) => Math.min(totalPages, value + 1))} className="material-button-secondary inline-flex h-11 items-center gap-1 px-3 text-xs disabled:opacity-40">{t("下一页")}<ChevronRight className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        </section>

        <AuditDetail item={selected} lang={lang} />
      </div>
    </div>
  );
}

function AuditDetail({ item, lang }: { item: ProcAuditLogItem | null; lang: string }) {
  const { t } = useI18n();
  if (!item) {
    return (
      <aside className="material-card hidden min-h-[420px] flex-col items-center justify-center p-8 text-center xl:flex">
        <ShieldCheck className="h-10 w-10 text-slate-200" />
        <p className="mt-3 text-sm font-semibold text-slate-500">{t("选择一条记录查看详情")}</p>
      </aside>
    );
  }

  const meta = actionMeta(item.action);
  const Icon = meta.Icon;
  return (
    <aside className="material-card min-h-[320px] overflow-y-auto p-5 xl:min-h-[420px]">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border", meta.badge)}><Icon className="h-4 w-4" /></span>
          <div className="min-w-0">
            <div className="text-xs font-medium text-slate-400">{t("留痕详情")}</div>
            <h2 className="mt-0.5 truncate text-base font-semibold text-slate-900">{t(meta.label)}</h2>
          </div>
        </div>
        <span className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-medium text-slate-500">{t(sectionLabel(item.section))}</span>
      </div>

      <dl className="mt-4 space-y-3">
        <div className="rounded-xl bg-slate-50 px-3 py-2.5">
          <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{t("操作人")}</dt>
          <dd className="mt-1 flex items-center gap-2 text-sm font-medium text-slate-700"><UserRound className="h-3.5 w-3.5 text-indigo-500" />{item.operator.name}</dd>
        </div>
        <div className="rounded-xl bg-slate-50 px-3 py-2.5">
          <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{t("操作时间")}</dt>
          <dd className="mt-1 flex items-center gap-2 text-sm font-medium tabular-nums text-slate-700"><Clock3 className="h-3.5 w-3.5 text-indigo-500" />{formatDateTime(item.occurredAt, lang)}</dd>
        </div>
      </dl>

      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold text-slate-700">{t("公开字段快照")}</h3>
          <span className="text-[10px] text-slate-400">{t("已脱敏")}</span>
        </div>
        {item.details.length > 0 ? (
          <div className="overflow-hidden rounded-xl border border-slate-100">
            {item.details.map((detail) => (
              <div key={detail.field} className="grid grid-cols-[110px_minmax(0,1fr)] border-b border-slate-100 px-3 py-2.5 text-xs last:border-b-0">
                <span className="text-slate-400">{t(DETAIL_FIELD_LABELS[detail.field] ?? detail.field)}</span>
                <span className="break-words font-medium text-slate-700">{detail.value}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-6 text-center text-xs text-slate-400">{t("该操作未记录可公开字段")}</div>
        )}
      </div>

      <div className="mt-5 flex gap-2 rounded-xl border border-indigo-100 bg-indigo-50/60 p-3 text-xs leading-5 text-indigo-700">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{t("本页仅展示采购模块的成功写操作。密码、令牌、备注正文及大段业务数据不会返回前端。")}</span>
      </div>
    </aside>
  );
}
