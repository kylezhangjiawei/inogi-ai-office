import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Bot,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Database,
  Filter,
  History,
  ListFilter,
  Loader2,
  RotateCcw,
  Search,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { AuditTimeline } from "./RDAuditTimeline";
import { AutoTranslatedText } from "./components/TranslatableText";
import {
  actionsForCategory,
  AuditCategory,
  AuditFacets,
  AuditStats,
  auditModuleLabel,
  CATEGORY_LABELS,
  fetchAuditFacets,
  fetchAuditLogPage,
  getAuditActionMeta,
  toTimelineLog,
  UnifiedAuditLog,
  UnifiedAuditPage,
} from "./lib/auditLog";
import { Input } from "./components/ui/input";
import { NativeSelect } from "./components/ui/native-select";
import { cn } from "./components/ui/utils";
import { i18nLocale, t, useI18n } from "./lib/i18n";
import { todayLocalDateStr } from "./lib/taskDue";

type FilterValue<T extends string> = T | "all";
type AuditSource = UnifiedAuditLog["source"];
type ResourceType = string;
type SortOrder = "newest" | "oldest";

const EMPTY_PAGE: UnifiedAuditPage = {
  total: 0,
  page: 1,
  pageSize: 25,
  snapshotAt: "",
  canViewAll: false,
  filterSignature: "",
  stats: null,
  items: [],
};
const EMPTY_FACETS: AuditFacets = { modules: [], actions: [], resources: [], actors: [] };
const KEYWORD_DEBOUNCE_MS = 300;

const CATEGORY_FILTERS: Array<FilterValue<AuditCategory>> = [
  "all",
  "proposal",
  "task",
  "approval_flow",
  "person",
  "ai",
  "system",
  "role",
];

const SOURCE_FILTERS: Array<FilterValue<AuditSource>> = ["all", "web", "ai", "api", "system"];
const PAGE_SIZE_OPTIONS = [12, 25, 50] as const;
const AUDIT_EASE = [0.22, 1, 0.36, 1] as [number, number, number, number];
const AUDIT_FAST = { duration: 0.18, ease: AUDIT_EASE };
const AUDIT_PANEL = { duration: 0.24, ease: AUDIT_EASE };

const TONE_BADGE_CLASSES: Record<"blue" | "emerald" | "amber" | "red" | "violet" | "slate", string> = {
  blue: "border-sky-100 bg-sky-50 text-sky-700",
  emerald: "border-emerald-100 bg-emerald-50 text-emerald-700",
  amber: "border-amber-100 bg-amber-50 text-amber-700",
  red: "border-rose-100 bg-rose-50 text-rose-700",
  violet: "border-indigo-100 bg-indigo-50 text-indigo-700",
  slate: "border-slate-200 bg-slate-100 text-slate-700",
};

const TONE_BAR_CLASSES: Record<"blue" | "emerald" | "amber" | "red" | "violet" | "slate", string> = {
  blue: "bg-sky-500",
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-rose-500",
  violet: "bg-indigo-500",
  slate: "bg-slate-500",
};

const SOURCE_BADGE_CLASSES: Record<AuditSource, string> = {
  web: "border-slate-200 bg-white text-slate-700",
  ai: "border-indigo-100 bg-indigo-50 text-indigo-700",
  api: "border-cyan-100 bg-cyan-50 text-cyan-700",
  system: "border-amber-100 bg-amber-50 text-amber-700",
};

const METRIC_TONES = [
  "text-slate-950 bg-slate-950",
  "text-cyan-700 bg-cyan-500",
  "text-emerald-700 bg-emerald-500",
  "text-indigo-700 bg-indigo-500",
  "text-amber-700 bg-amber-500",
] as const;

const SOURCE_LABELS: Record<FilterValue<AuditSource>, string> = {
  all: "全部来源",
  web: "人工操作",
  ai: "AI 自动",
  api: "API",
  system: "系统",
};

const RESOURCE_LABELS: Record<FilterValue<ResourceType>, string> = {
  all: "全部对象",
  task: "任务",
  proposal: "立项",
  project: "项目",
  person: "人员",
  role: "角色",
  category: "分类",
  knowledge: "知识",
  flow: "审批流",
  system: "系统",
};

const LEGACY_RESOURCE_LABELS: Record<string, string> = {
  "rd-task-module": "研发任务模块",
};

// 标签查表后过 t()：中文即字典 key，英文态翻译、缺词条回退中文
function resourceLabel(type: string) {
  return t(RESOURCE_LABELS[type as FilterValue<ResourceType>] ?? LEGACY_RESOURCE_LABELS[type] ?? type);
}

function sourceLabel(source: string) {
  return t(SOURCE_LABELS[source as FilterValue<AuditSource>] ?? source);
}

function sourceBadgeClasses(source: string) {
  return SOURCE_BADGE_CLASSES[source as AuditSource] ?? SOURCE_BADGE_CLASSES.system;
}

function categoryLabel(category: FilterValue<AuditCategory>) {
  return category === "all" ? t("全部") : t(CATEGORY_LABELS[category]);
}

function formatAbsolute(iso: string): string {
  return new Date(iso).toLocaleString(i18nLocale(), {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatDateTimeFull(iso: string): string {
  return new Date(iso).toLocaleString(i18nLocale(), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function toDateStart(date: string) {
  return date ? new Date(`${date}T00:00:00`).toISOString() : undefined;
}

function toDateEnd(date: string) {
  return date ? new Date(`${date}T23:59:59.999`).toISOString() : undefined;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.join(", ");
  return JSON.stringify(value);
}

function summarizeLog(log: UnifiedAuditLog) {
  const meta = getAuditActionMeta(log.action);
  const target = log.resource.name ?? log.resource.id;
  return `${log.actor.name} ${t(meta.verb)}${target ? ` · ${target}` : ""}`;
}

export function AuditLogPage() {
  useI18n(); // 订阅语言切换：本页文案全部经 t()，切语言即重渲染
  const shouldReduceMotion = useReducedMotion();

  const [keyword, setKeyword] = useState("");
  const deferredKeyword = useDeferredValue(keyword);
  const [debouncedKeyword, setDebouncedKeyword] = useState("");
  // 旧地址（/rd-audit-log 等）重定向过来时带 ?module=，落地即选中对应模块
  const [searchParams] = useSearchParams();
  const [moduleFilter, setModuleFilter] = useState(() => searchParams.get("module") ?? "all");
  const [category, setCategory] = useState<FilterValue<AuditCategory>>("all");
  const [source, setSource] = useState<FilterValue<AuditSource>>("all");
  const [resourceType, setResourceType] = useState<FilterValue<ResourceType>>("all");
  const [actorId, setActorId] = useState("all");
  const [action, setAction] = useState<FilterValue<string>>("all");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(25);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [data, setData] = useState<UnifiedAuditPage>(EMPTY_PAGE);
  // 统计只跟筛选条件走。翻页时不再让服务端重算，沿用上一次的结果。
  const [stats, setStats] = useState<AuditStats | null>(null);
  const [facets, setFacets] = useState<AuditFacets>(EMPTY_FACETS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [relatedLogs, setRelatedLogs] = useState<UnifiedAuditLog[]>([]);

  // 关键字改由服务端匹配：逐字符发请求既浪费又会把分页打乱，统一防抖后再查
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedKeyword(deferredKeyword.trim()), KEYWORD_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [deferredKeyword]);

  const query = useMemo(
    () => ({
      module: moduleFilter === "all" ? undefined : moduleFilter,
      source: source === "all" ? undefined : source,
      resource: resourceType === "all" ? undefined : resourceType,
      actorUserId: actorId === "all" ? undefined : actorId,
      // 类目 → 动作码的展开放在前端：映射的唯一事实源是 AUDIT_ACTION_META，服务端按结果做 IN 过滤
      actions:
        action !== "all" ? [action] : category !== "all" ? actionsForCategory(category) : undefined,
      dateFrom: toDateStart(since),
      dateTo: toDateEnd(until),
      keyword: debouncedKeyword || undefined,
      sort: sortOrder,
      page,
      pageSize,
    }),
    [action, actorId, category, debouncedKeyword, moduleFilter, page, pageSize, resourceType, since, sortOrder, source, until],
  );

  // 手上这份统计对应的服务端指纹。回带给服务端，它自己判断要不要重算。
  const statsSignature = useRef<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchAuditLogPage({ ...query, statsSignature: statsSignature.current })
      .then((result) => {
        if (cancelled) return;
        setData(result);
        if (result.stats) {
          setStats(result.stats);
          statsSignature.current = result.filterSignature;
        }
        setError(null);
        // 服务端会把越界页码收回最后一页；本地页码跟随，否则翻页按钮与实际内容对不上
        if (result.page !== query.page) setPage(result.page);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setData(EMPTY_PAGE);
        setStats(null);
        statsSignature.current = undefined;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query]);

  // 筛选选项只跟「可见范围 + 模块」走：跟着其他条件收窄会让选项互相抹掉，越筛越选不动
  useEffect(() => {
    let cancelled = false;
    fetchAuditFacets(moduleFilter === "all" ? undefined : moduleFilter)
      .then((result) => {
        if (!cancelled) setFacets(result);
      })
      .catch(() => {
        if (!cancelled) setFacets(EMPTY_FACETS);
      });
    return () => {
      cancelled = true;
    };
  }, [moduleFilter]);

  const pagedLogs = data.items;
  const selectedLog = pagedLogs.find((log) => log.id === selectedId) ?? pagedLogs[0] ?? null;
  const selectedMeta = selectedLog ? getAuditActionMeta(selectedLog.action) : getAuditActionMeta(undefined);
  const selectedResourceType = selectedLog?.resource.type ?? null;
  const selectedResourceId = selectedLog?.resource.id ?? null;

  // 「同对象记录」单独查：合并后数据不在内存里，无法像以前那样从全量日志里筛
  useEffect(() => {
    if (!selectedResourceType || !selectedResourceId) {
      setRelatedLogs([]);
      return;
    }
    let cancelled = false;
    fetchAuditLogPage({
      resource: selectedResourceType,
      resourceId: selectedResourceId,
      pageSize: 12,
      sort: "newest",
    })
      .then((result) => {
        if (!cancelled) setRelatedLogs(result.items);
      })
      .catch(() => {
        if (!cancelled) setRelatedLogs([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedResourceId, selectedResourceType]);

  // userId 为空的记录（后台任务写入、账号已注销）无法按 id 过滤，不进下拉；列表里照常显示
  const actorOptions = useMemo(
    () => facets.actors.filter((actor): actor is typeof actor & { id: string } => Boolean(actor.id)),
    [facets.actors],
  );
  const actionOptions = useMemo(
    () =>
      facets.actions
        .map((item) => item.value)
        .filter((item) => category === "all" || getAuditActionMeta(item).category === category)
        .sort((a, b) => getAuditActionMeta(a).label.localeCompare(getAuditActionMeta(b).label, "zh-CN")),
    [category, facets.actions],
  );
  const resourceOptions = useMemo(() => facets.resources.map((item) => item.value), [facets.resources]);

  const totalPages = Math.max(1, Math.ceil(data.total / pageSize));
  const safePage = data.page;
  const visibleStart = data.total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const visibleEnd = Math.min(safePage * pageSize, data.total);
  const activeFilterCount = [
    debouncedKeyword,
    moduleFilter !== "all",
    category !== "all",
    source !== "all",
    resourceType !== "all",
    actorId !== "all",
    action !== "all",
    since,
    until,
  ].filter(Boolean).length;

  /** 去重统计到顶时真实值更大，显示成 “N+”，不谎报确切数字。 */
  const capped = (value: number, isCapped: boolean) => (isCapped ? `${value}+` : value);

  const resetFilters = () => {
    setKeyword("");
    setModuleFilter("all");
    setCategory("all");
    setSource("all");
    setResourceType("all");
    setActorId("all");
    setAction("all");
    setSince("");
    setUntil("");
    setSortOrder("newest");
    setPage(1);
    setSelectedId(null);
  };

  const applyPreset = (preset: "task" | "proposal" | "ai" | "risk" | "today") => {
    setPage(1);
    setSelectedId(null);
    if (preset === "task") {
      setCategory("task");
      setResourceType("task");
      setAction("all");
      setSource("all");
      return;
    }
    if (preset === "proposal") {
      setCategory("proposal");
      setResourceType("proposal");
      setAction("all");
      setSource("all");
      return;
    }
    if (preset === "ai") {
      setCategory("ai");
      setSource("all");
      setAction("all");
      setResourceType("all");
      return;
    }
    if (preset === "risk") {
      setCategory("all");
      setAction("all");
      setResourceType("all");
      setSource("all");
      setKeyword("驳回 阻塞 转派 封存 reset rejected archived");
      return;
    }
    // 本地日历日：toISOString() 取 UTC 日期，UTC+8 每天 0–8 点点「今天」会筛成昨天，查不到当天留痕
    const today = todayLocalDateStr();
    setSince(today);
    setUntil(today);
  };

  return (
    <motion.div
      initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={AUDIT_PANEL}
      className="flex h-full min-h-0 flex-col overflow-hidden px-5 py-5 lg:px-7 lg:py-6"
    >
      <div className="mx-auto flex h-full min-h-0 w-full max-w-[1500px] flex-col gap-4 overflow-hidden">
        <header className="flex shrink-0 flex-wrap items-end justify-between gap-4  pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-[0_10px_22px_rgba(15,23,42,0.18)]">
                <ShieldCheck className="h-4 w-4" />
              </span>
              <div>
                <h1 className="text-xl font-semibold text-slate-950">{t("操作留痕")}</h1>
                <p className="mt-0.5 text-sm text-slate-500">{t("全站审计查询台 · 追责、复盘、抽查、异常定位")}</p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {[
              { label: t("任务变更"), onClick: () => applyPreset("task") },
              { label: t("立项审核"), onClick: () => applyPreset("proposal") },
              { label: t("AI 记录"), onClick: () => applyPreset("ai") },
              { label: t("风险动作"), onClick: () => applyPreset("risk") },
              { label: t("今天"), onClick: () => applyPreset("today") },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={item.onClick}
                className="inline-flex h-8 cursor-pointer items-center rounded-md border border-slate-200 bg-white/90 px-3 text-xs font-semibold text-slate-600 shadow-[0_4px_12px_rgba(15,23,42,0.03)] transition-all duration-150 hover:-translate-y-0.5 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-800 active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200"
              >
                {item.label}
              </button>
            ))}
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md bg-indigo-600 px-3 text-xs font-semibold text-white shadow-[0_8px_18px_rgba(79,70,229,0.18)] transition-all duration-150 hover:-translate-y-0.5 hover:bg-indigo-700 active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {t("重置")}
            </button>
          </div>
        </header>

        <section className="grid shrink-0 grid-cols-2 gap-2 md:grid-cols-5">
          {[
            { label: t("匹配记录"), value: data.total, Icon: Database, tone: "text-slate-900" },
            { label: t("涉及对象"), value: capped(stats?.uniqueResources ?? 0, stats?.resourcesCapped ?? false), Icon: Activity, tone: "text-cyan-700" },
            { label: t("操作人员"), value: capped(stats?.uniqueActors ?? 0, stats?.actorsCapped ?? false), Icon: UserRound, tone: "text-emerald-600" },
            { label: t("AI/自动"), value: stats?.aiCount ?? 0, Icon: Bot, tone: "text-indigo-700" },
            { label: t("风险动作"), value: stats?.riskCount ?? 0, Icon: ShieldCheck, tone: "text-amber-600" },
          ].map(({ label, value, Icon, tone }, index) => (
            <motion.div
              key={label}
              initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...AUDIT_FAST, delay: shouldReduceMotion ? 0 : index * 0.035 }}
              className="group relative flex min-h-20 items-center gap-3 overflow-hidden rounded-lg border border-slate-200 bg-white/95 px-4 py-3 shadow-[0_8px_20px_rgba(15,23,42,0.04)] transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo-100 hover:shadow-[0_14px_28px_rgba(15,23,42,0.07)]"
            >
              <span className={cn("absolute left-0 top-0 h-full w-1", METRIC_TONES[index].split(" ")[1])} />
              <Icon className={cn("h-4 w-4 shrink-0", tone)} />
              <div>
                <div className={cn("text-2xl font-semibold tabular-nums", tone)}>{value}</div>
                <div className="mt-0.5 text-[11px] font-medium text-slate-500">{label}</div>
              </div>
            </motion.div>
          ))}
        </section>

        <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[300px_minmax(0,1fr)_360px]">
          <aside className="space-y-3 overflow-y-auto rounded-lg border border-slate-200 bg-white/95 p-4 shadow-[0_10px_24px_rgba(15,23,42,0.05)] xl:self-stretch">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <ListFilter className="h-4 w-4 text-slate-500" />
                {t("精准筛选")}
              </h2>
              <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", activeFilterCount > 0 ? "bg-indigo-50 text-indigo-800" : "bg-slate-100 text-slate-500")}>
                {activeFilterCount} active
              </span>
            </div>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">{t("关键字")}</span>
              <div className="flex items-center gap-2 rounded-md border border-slate-200 px-2.5 py-2 transition-all focus-within:border-indigo-300 focus-within:ring-2 focus-within:ring-indigo-100">
                <Search className={cn("h-3.5 w-3.5 transition-colors", keyword ? "text-indigo-700" : "text-slate-400")} />
                <Input
                  value={keyword}
                  onChange={(event) => {
                    setKeyword(event.target.value);
                    setPage(1);
                  }}
                  placeholder={t("人 / 任务号 / 备注 / 字段")}
                  className="min-w-0 flex-1 text-sm text-slate-900 outline-none placeholder:text-slate-400"
                />
              </div>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">{t("模块")}</span>
              <NativeSelect
                value={moduleFilter}
                onChange={(event) => {
                  setModuleFilter(event.target.value);
                  setResourceType("all");
                  setAction("all");
                  setActorId("all");
                  setPage(1);
                  setSelectedId(null);
                }}
                className="h-9 w-full cursor-pointer rounded-md border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition-all focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
              >
                <option value="all">{t("全部模块")}</option>
                {facets.modules.map((item) => (
                  <option key={item.value} value={item.value}>
                    {t(auditModuleLabel(item.value))}（{item.count}）
                  </option>
                ))}
              </NativeSelect>
            </label>

            <div>
              <div className="mb-1.5 text-xs font-medium text-slate-600">{t("类别")}</div>
              <div className="grid grid-cols-2 gap-1">
                {CATEGORY_FILTERS.map((item) => (
                  <button
                    key={item}
                    type="button"
                  onClick={() => {
                    setCategory(item);
                    setAction("all");
                    setPage(1);
                  }}
                  aria-pressed={category === item}
                  className={cn(
                    "h-8 cursor-pointer rounded-md border px-2 text-xs font-medium transition-all duration-150 active:scale-95",
                    category === item
                        ? "border-indigo-200 bg-indigo-50 text-indigo-800 shadow-[0_6px_14px_rgba(79,70,229,0.08)]"
                        : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-800",
                  )}
                  >
                    {categoryLabel(item)}
                  </button>
                ))}
              </div>
            </div>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">{t("动作类型")}</span>
              <NativeSelect
                value={action}
                onChange={(event) => {
                  setAction(event.target.value);
                  setPage(1);
                }}
                  className="h-9 w-full cursor-pointer rounded-md border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition-all focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
              >
                <option value="all">{t("全部动作")}</option>
                {actionOptions.map((item) => (
                  <option key={item} value={item}>
                    {t(getAuditActionMeta(item).label)}
                  </option>
                ))}
              </NativeSelect>
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">{t("对象")}</span>
                <NativeSelect
                  value={resourceType}
                  onChange={(event) => {
                    setResourceType(event.target.value as FilterValue<ResourceType>);
                    setPage(1);
                  }}
                  className="h-9 w-full cursor-pointer rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none transition-all focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                >
                  <option value="all">{t("全部对象")}</option>
                  {resourceOptions.map((item) => (
                    <option key={item} value={item}>
                      {resourceLabel(item)}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">{t("来源")}</span>
                <NativeSelect
                  value={source}
                  onChange={(event) => {
                    setSource(event.target.value as FilterValue<AuditSource>);
                    setPage(1);
                  }}
                  className="h-9 w-full cursor-pointer rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none transition-all focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                >
                  {SOURCE_FILTERS.map((item) => (
                    <option key={item} value={item}>
                      {t(SOURCE_LABELS[item])}
                    </option>
                  ))}
                </NativeSelect>
              </label>
            </div>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">{t("操作人")}</span>
              <NativeSelect
                value={actorId}
                onChange={(event) => {
                  setActorId(event.target.value);
                  setPage(1);
                }}
                className="h-9 w-full cursor-pointer rounded-md border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition-all focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
              >
                <option value="all">{t("全部操作人")}</option>
                {actorOptions.map((actor) => (
                  <option key={actor.id} value={actor.id}>
                    {actor.name}（{actor.count}）
                  </option>
                ))}
              </NativeSelect>
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-600">
                  <CalendarDays className="h-3 w-3" />
                  {t("开始")}
                </span>
                <Input
                  type="date"
                  value={since}
                  onChange={(event) => {
                    setSince(event.target.value);
                    setPage(1);
                  }}
                  className="h-9 w-full rounded-md border border-slate-200 px-2 text-xs text-slate-700 outline-none transition-all focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                />
              </label>
              <label className="block">
                <span className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-600">
                  <CalendarDays className="h-3 w-3" />
                  {t("结束")}
                </span>
                <Input
                  type="date"
                  value={until}
                  onChange={(event) => {
                    setUntil(event.target.value);
                    setPage(1);
                  }}
                  className="h-9 w-full rounded-md border border-slate-200 px-2 text-xs text-slate-700 outline-none transition-all focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                />
              </label>
            </div>
          </aside>

          <main className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white/95 shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <History className="h-4 w-4 text-slate-500" />
                  {t("审计结果")}
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  {t("当前显示")} <span className="font-semibold tabular-nums text-slate-700">{visibleStart}-{visibleEnd}</span> / {data.total}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSortOrder((current) => (current === "newest" ? "oldest" : "newest"))}
                  className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-600 transition-all duration-150 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-800 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200"
                >
                  {sortOrder === "newest" ? <ArrowDown className="h-3.5 w-3.5" /> : <ArrowUp className="h-3.5 w-3.5" />}
                  {sortOrder === "newest" ? t("最新优先") : t("最早优先")}
                </button>
                <NativeSelect
                  value={pageSize}
                  onChange={(event) => {
                    setPageSize(Number(event.target.value) as (typeof PAGE_SIZE_OPTIONS)[number]);
                    setPage(1);
                  }}
                  className="h-8 cursor-pointer rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-600 outline-none transition-all focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                >
                  {PAGE_SIZE_OPTIONS.map((item) => (
                    <option key={item} value={item}>
                      {t("每页 {n}", { n: item })}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full min-w-[920px]">
                <thead>
                  <tr className="border-b border-slate-100 bg-[#f8fafb] text-left text-[11px] font-semibold text-slate-500">
                    <th className="w-[132px] px-4 py-2.5">{t("时间")}</th>
                    <th className="w-[130px] px-3 py-2.5">{t("操作人")}</th>
                    <th className="w-[118px] px-3 py-2.5">{t("动作")}</th>
                    <th className="px-3 py-2.5">{t("对象与摘要")}</th>
                    <th className="w-[110px] px-3 py-2.5">{t("来源")}</th>
                    <th className="w-[120px] px-3 py-2.5">{t("变更")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {error ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-14 text-center">
                        <AlertTriangle className="mx-auto mb-2 h-5 w-5 text-amber-400" />
                        <div className="text-sm font-medium text-slate-600">{t("留痕加载失败")}</div>
                        <div className="mt-1 text-xs text-slate-400">{error}</div>
                      </td>
                    </tr>
                  ) : loading && pagedLogs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-14 text-center">
                        <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-slate-300" />
                        <div className="text-sm font-medium text-slate-500">{t("正在加载留痕…")}</div>
                      </td>
                    </tr>
                  ) : pagedLogs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-14 text-center">
                        <Filter className="mx-auto mb-2 h-5 w-5 text-slate-300" />
                        <div className="text-sm font-medium text-slate-500">{t("没有匹配的留痕记录")}</div>
                        <div className="mt-1 text-xs text-slate-400">{t("当前筛选条件下没有可显示数据。")}</div>
                      </td>
                    </tr>
                  ) : (
                    pagedLogs.map((log, index) => {
                      const meta = getAuditActionMeta(log.action);
                      const selected = selectedLog?.id === log.id;
                      return (
                        <motion.tr
                          key={log.id}
                          onClick={() => setSelectedId(log.id)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setSelectedId(log.id);
                            }
                          }}
                          tabIndex={0}
                          initial={shouldReduceMotion ? false : { opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ ...AUDIT_FAST, delay: shouldReduceMotion ? 0 : Math.min(index, 8) * 0.018 }}
                          className={cn(
                            "cursor-pointer transition-colors focus-visible:outline-none",
                            "hover:bg-indigo-50/45 focus-visible:bg-indigo-50/60",
                            selected && "bg-indigo-50/70 shadow-[inset_3px_0_0_#4f46e5]",
                          )}
                        >
                          <td className="px-4 py-3 align-top">
                            <div className="font-mono text-xs tabular-nums text-slate-700">{formatAbsolute(log.timestamp)}</div>
                            <div className="mt-0.5 flex items-center gap-1 text-[10px] text-slate-400">
                              <Clock3 className="h-3 w-3" />
                              {new Date(log.timestamp).toLocaleDateString(i18nLocale())}
                            </div>
                          </td>
                          <td className="px-3 py-3 align-top">
                            <div className="text-sm font-semibold text-slate-900">{log.actor.name}</div>
                            <div className="mt-0.5 truncate text-[11px] text-slate-400">{log.actor.role ?? "—"}</div>
                          </td>
                          <td className="px-3 py-3 align-top">
                            <span className={cn("inline-flex rounded-md border px-2 py-1 text-xs font-semibold", TONE_BADGE_CLASSES[meta.tone])}>
                              {t(meta.label)}
                            </span>
                            <div className="mt-1 text-[10px] text-slate-400">{categoryLabel(meta.category)}</div>
                          </td>
                          <td className="px-3 py-3 align-top">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                                {resourceLabel(log.resource.type)}
                              </span>
                              <span className="font-mono text-[11px] text-slate-400">{log.resource.id}</span>
                            </div>
                            <div className="mt-1 line-clamp-1 text-sm font-medium text-slate-900">{summarizeLog(log)}</div>
                            {/* 备注是存库的动态内容，走按需自动翻译（与 RDAuditTimeline 同口径） */}
                            {log.comment && (
                              <div className="mt-0.5 line-clamp-1 text-xs text-slate-500">
                                <AutoTranslatedText text={log.comment} as="span" />
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-3 align-top">
                            <span className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-semibold", sourceBadgeClasses(log.source))}>
                              {log.source === "ai" && <Bot className="h-3 w-3 text-indigo-500" />}
                              {sourceLabel(log.source)}
                            </span>
                          </td>
                          <td className="px-3 py-3 align-top">
                            <div className="text-xs font-semibold tabular-nums text-slate-700">{t("{n} 项", { n: log.changes?.length ?? 0 })}</div>
                            {log.metadata && (
                              <div className="mt-0.5 text-[10px] text-slate-400">
                                metadata {Object.keys(log.metadata).length}
                              </div>
                            )}
                          </td>
                        </motion.tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
              <div className="text-xs tabular-nums text-slate-500">
                {t("显示")} {visibleStart}-{visibleEnd}
                <span className="mx-1 text-slate-300">/</span>
                {data.total}
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={safePage === 1}
                  className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition-all hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-800 disabled:cursor-not-allowed disabled:opacity-35"
                  aria-label={t("上一页")}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="min-w-20 px-2 text-center text-xs font-semibold tabular-nums text-slate-600">
                  {safePage} / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                  disabled={safePage === totalPages}
                  className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition-all hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-800 disabled:cursor-not-allowed disabled:opacity-35"
                  aria-label={t("下一页")}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </main>

          <aside className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white/95 shadow-[0_10px_24px_rgba(15,23,42,0.05)] xl:self-stretch">
            <AnimatePresence mode="wait" initial={false}>
              {selectedLog ? (
              <motion.div
                key={selectedLog.id}
                initial={shouldReduceMotion ? false : { opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, x: -8 }}
                transition={AUDIT_FAST}
                className="flex min-h-0 flex-1 flex-col"
              >
                <div className="relative shrink-0 border-b border-slate-200 px-4 py-3">
                  <span className={cn("absolute left-0 top-0 h-full w-1", TONE_BAR_CLASSES[selectedMeta.tone])} />
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className={cn("inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-semibold", TONE_BADGE_CLASSES[selectedMeta.tone])}>
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {t(selectedMeta.label)}
                    </span>
                    <span className="font-mono text-[10px] text-slate-400">{selectedLog.id}</span>
                  </div>
                  <h3 className="text-sm font-semibold leading-5 text-slate-950">{summarizeLog(selectedLog)}</h3>
                  <div className="mt-1 text-xs text-slate-500">{formatDateTimeFull(selectedLog.timestamp)}</div>
                </div>

                <div className="min-h-0 flex-1 space-y-4 overflow-auto px-4 pb-6 pt-4">
                  <section>
                    <h4 className="mb-2 text-xs font-semibold text-slate-500">{t("基础信息")}</h4>
                    <div className="space-y-2 rounded-lg border border-slate-100 bg-slate-50/50 p-3 text-xs">
                      {[
                        [t("动作"), t(selectedMeta.label)],
                        [t("类别"), categoryLabel(selectedMeta.category)],
                        [t("操作人"), `${selectedLog.actor.name}${selectedLog.actor.role ? ` · ${selectedLog.actor.role}` : ""}`],
                        [t("对象"), `${resourceLabel(selectedLog.resource.type)} · ${selectedLog.resource.name ?? selectedLog.resource.id}`],
                        [t("来源"), sourceLabel(selectedLog.source)],
                      ].map(([label, value]) => (
                        <div key={label} className="flex items-start justify-between gap-3">
                          <span className="shrink-0 text-slate-400">{label}</span>
                          <span className="text-right font-medium text-slate-700">{value}</span>
                        </div>
                      ))}
                    </div>
                  </section>

                  {selectedLog.comment && (
                    <section>
                      <h4 className="mb-2 text-xs font-semibold text-slate-500">{t("备注")}</h4>
                      <p className="rounded-lg border border-slate-100 bg-white px-3 py-2 text-sm leading-6 text-slate-700">
                        <AutoTranslatedText text={selectedLog.comment} as="span" />
                      </p>
                    </section>
                  )}

                  <section>
                    <h4 className="mb-2 text-xs font-semibold text-slate-500">{t("字段变更")}</h4>
                    {selectedLog.changes && selectedLog.changes.length > 0 ? (
                      <div className="space-y-2">
                        {selectedLog.changes.map((change, index) => (
                          <div key={`${change.field}-${index}`} className="rounded-lg border border-slate-100 bg-white px-3 py-2">
                            <div className="font-mono text-xs font-semibold text-slate-600">{change.field}</div>
                            <div className="mt-1 grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-xs">
                              <span className="rounded bg-rose-50 px-2 py-1 text-rose-700 line-through decoration-rose-300">{formatValue(change.before)}</span>
                              <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
                              <span className="rounded bg-emerald-50 px-2 py-1 font-semibold text-emerald-700">{formatValue(change.after)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 py-5 text-center text-xs text-slate-400">{t("本记录没有字段变更")}</div>
                    )}
                  </section>

                  {selectedLog.metadata && Object.keys(selectedLog.metadata).length > 0 && (
                    <section>
                      <h4 className="mb-2 text-xs font-semibold text-slate-500">{t("元数据")}</h4>
                      <div className="space-y-1 rounded-lg border border-slate-100 bg-slate-50/60 p-3">
                        {Object.entries(selectedLog.metadata).map(([key, value]) => (
                          <div key={key} className="grid grid-cols-[110px_minmax(0,1fr)] gap-2 text-xs">
                            <span className="font-mono text-slate-400">{key}</span>
                            <span className="break-words text-slate-700">{formatValue(value)}</span>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  <section>
                    <div className="mb-2 flex items-center justify-between">
                      <h4 className="text-xs font-semibold text-slate-500">{t("同对象时间线")}</h4>
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                        {relatedLogs.length}
                      </span>
                    </div>
                    <AuditTimeline logs={relatedLogs.map(toTimelineLog)} showResource={false} emptyText={t("暂无同对象记录")} />
                  </section>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="empty-detail"
                initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: -8 }}
                transition={AUDIT_FAST}
                className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center"
              >
                <History className="mb-2 h-6 w-6 text-slate-300" />
                <div className="text-sm font-medium text-slate-500">{t("暂无选中记录")}</div>
              </motion.div>
            )}
            </AnimatePresence>
          </aside>
        </div>
      </div>
    </motion.div>
  );
}

export default AuditLogPage;
