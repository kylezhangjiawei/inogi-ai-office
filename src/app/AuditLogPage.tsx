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
  ChevronDown,
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./components/ui/collapsible";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./components/ui/sheet";
import { NativeSelect } from "./components/ui/native-select";
import { cn } from "./components/ui/utils";
import {
  HorizonMetric,
  HorizonMetricGrid,
  HorizonPageHeader,
} from "./components/horizon/HorizonPage";
import { i18nLocale, t, useI18n } from "./lib/i18n";
import { todayLocalDateStr } from "./lib/taskDue";
import { isProductionWorkspace, isUsCollabWorkspace } from "./lib/rdApi";
import { Button } from "./components/ui/button";

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

const TONE_BADGE_CLASSES: Record<string, string> = {
  blue: "border-blue-100 bg-blue-50 text-blue-700",
  emerald: "border-emerald-100 bg-emerald-50 text-emerald-700",
  amber: "border-amber-100 bg-amber-50 text-amber-700",
  red: "border-rose-100 bg-rose-50 text-rose-700",
  slate: "border-slate-200 bg-slate-100 text-slate-700",
};

const SOURCE_BADGE_CLASSES: Record<AuditSource, string> = {
  web: "border-slate-200 bg-white text-slate-700",
  ai: "border-blue-100 bg-blue-50 text-blue-700",
  api: "border-cyan-100 bg-cyan-50 text-cyan-700",
  system: "border-amber-100 bg-amber-50 text-amber-700",
};

const HORIZON_SECONDARY_ACTION =
  "inline-flex min-h-10 cursor-pointer items-center justify-center rounded-lg border border-[#e0e5f2] bg-white px-3 text-xs font-semibold text-[#42526f] hover:border-primary/25 hover:bg-accent hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30";
const HORIZON_FIELD =
  "w-full rounded-lg border border-[#e0e5f2] bg-white text-[#42526f] outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/15";

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
  "electronic-gate": "电子闸门",
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

function toneBadgeClasses(tone: string) {
  return TONE_BADGE_CLASSES[tone] ?? TONE_BADGE_CLASSES.blue;
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

  const nativeRdAudit = !isUsCollabWorkspace() && !isProductionWorkspace();
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
  const selectedTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);

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
  }, [query, reloadVersion]);

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
  const selectedLog = pagedLogs.find((log) => log.id === selectedId) ?? null;
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
    setRelatedLogs([]);
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
      initial={shouldReduceMotion ? false : nativeRdAudit ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={AUDIT_PANEL}
      className={cn(
        "horizon-theme hz-page min-w-0",
        nativeRdAudit && "rd-horizon-module rd-horizon-audit",
      )}
    >
      <div className="rd-horizon-audit-shell mx-auto flex w-full min-w-0 flex-col gap-4">
        <HorizonPageHeader
          className="rd-horizon-audit-command"
          Icon={ShieldCheck}
          eyebrow=""
          title={t("全站操作记录")}
          meta={
            <>
              <span>{data.snapshotAt ? `${t("数据快照")} ${formatAbsolute(data.snapshotAt)}` : t("等待数据快照")}</span>
            </>
          }
          actions={
            <Button variant="unstyled" type="button" disabled={loading} className={HORIZON_SECONDARY_ACTION}
              onClick={() => { statsSignature.current = undefined; setReloadVersion((value) => value + 1); }}>
              <RotateCcw className="mr-1.5 size-3.5" aria-hidden="true" />
              {t("刷新留痕")}
            </Button>
          }
        />

        <HorizonMetricGrid className="rd-horizon-audit-metrics !grid-cols-2 lg:!grid-cols-4">
          <HorizonMetric
            Icon={Database}
            label={t("匹配记录")}
            value={loading && stats === null ? "—" : data.total}
            note={loading ? t("正在同步审计数据") : t("当前筛选范围")}
            tone="brand"
          />
          <HorizonMetric
            Icon={Activity}
            label={t("涉及对象")}
            value={loading && stats === null ? "—" : capped(stats?.uniqueResources ?? 0, stats?.resourcesCapped ?? false)}
            note={stats?.resourcesCapped ? t("已达到去重统计上限") : t("按对象去重统计")}
          />
          <HorizonMetric
            Icon={UserRound}
            label={t("操作主体")}
            value={loading && stats === null ? "—" : capped(stats?.uniqueActors ?? 0, stats?.actorsCapped ?? false)}
            note={t("其中 {n} 条 AI/自动记录", { n: stats?.aiCount ?? 0 })}
            tone="success"
          />
          <HorizonMetric
            Icon={ShieldCheck}
            label={t("风险动作")}
            value={loading && stats === null ? "—" : stats?.riskCount ?? 0}
            note={stats?.riskCount ? t("建议优先复核") : t("当前未发现风险动作")}
            tone={stats?.riskCount ? "danger" : "success"}
          />
        </HorizonMetricGrid>

        <section aria-labelledby="audit-results-heading" className="rd-horizon-audit-list hz-surface min-w-0">
          <Collapsible open={advancedFiltersOpen} onOpenChange={setAdvancedFiltersOpen} className="rd-horizon-audit-filters">
            <div className="rd-horizon-audit-primary-filters">
            <label className="rd-horizon-audit-filter-search block">
              <span className="mb-1 block text-xs font-medium text-slate-600">{t("关键字")}</span>
              <div className="flex items-center gap-2 rounded-lg border border-[#e0e5f2] bg-white px-2.5 py-2 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15">
                <Search className={cn("size-3.5", keyword ? "text-primary" : "text-muted-foreground")} aria-hidden="true" />
                <Input
                  type="search"
                  name="audit-keyword"
                  autoComplete="off"
                  spellCheck={false}
                  aria-label={t("关键字")}
                  value={keyword}
                  onChange={(event) => {
                    setKeyword(event.target.value);
                    setPage(1);
                  }}
                  placeholder={t("人 / 任务号 / 备注 / 字段")}
                  className="min-w-0 flex-1 border-0 bg-transparent px-0 text-sm text-slate-900 shadow-none outline-none placeholder:text-muted-foreground focus-visible:border-transparent focus-visible:ring-0"
                />
              </div>
            </label>

            <label className="rd-horizon-audit-filter-module block">
              <span className="mb-1 block text-xs font-medium text-slate-600">{t("模块")}</span>
              <NativeSelect
                aria-label={t("模块")}
                value={moduleFilter}
                onChange={(event) => {
                  setModuleFilter(event.target.value);
                  setResourceType("all");
                  setAction("all");
                  setActorId("all");
                  setPage(1);
                  setSelectedId(null);
                }}
                className={cn("h-9 cursor-pointer px-2.5 text-sm", HORIZON_FIELD)}
              >
                <option value="all">{t("全部模块")}</option>
                {facets.modules.map((item) => (
                  <option key={item.value} value={item.value}>
                    {t(auditModuleLabel(item.value))}（{item.count}）
                  </option>
                ))}
              </NativeSelect>
            </label>

            <div className="rd-horizon-audit-filter-dates grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-600">
                  <CalendarDays className="size-3" aria-hidden="true" />
                  {t("开始")}
                </span>
                <Input
                  aria-label={t("开始")}
                  type="date"
                  value={since}
                  onChange={(event) => {
                    setSince(event.target.value);
                    setPage(1);
                  }}
                  className={cn("h-9 px-2 text-xs", HORIZON_FIELD)}
                />
              </label>
              <label className="block">
                <span className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-600">
                  <CalendarDays className="size-3" aria-hidden="true" />
                  {t("结束")}
                </span>
                <Input
                  aria-label={t("结束")}
                  type="date"
                  value={until}
                  onChange={(event) => {
                    setUntil(event.target.value);
                    setPage(1);
                  }}
                  className={cn("h-9 px-2 text-xs", HORIZON_FIELD)}
                />
              </label>
            </div>

              <CollapsibleTrigger asChild>
                <Button variant="unstyled" type="button" className={cn("rd-horizon-audit-filter-toggle gap-1.5", HORIZON_SECONDARY_ACTION)}>
                  <ListFilter className="size-4" aria-hidden="true" />
                  {t("更多筛选")}
                  {activeFilterCount > 0 && <span className="rounded bg-accent px-1.5 text-primary tabular-nums">{activeFilterCount}</span>}
                  <ChevronDown className={cn("size-3.5", advancedFiltersOpen && "rotate-180")} aria-hidden="true" />
                </Button>
              </CollapsibleTrigger>
            </div>
            <CollapsibleContent className="rd-horizon-audit-advanced-filters">
            <fieldset className="rd-horizon-audit-filter-categories">
              <legend className="mb-1.5 text-xs font-medium text-slate-600">{t("类别")}</legend>
              <div className="grid grid-cols-2 gap-1">
                {CATEGORY_FILTERS.map((item) => (
                  <Button variant="unstyled"
                    key={item}
                    type="button"
                  onClick={() => {
                    setCategory(item);
                    setAction("all");
                    setPage(1);
                  }}
                  aria-pressed={category === item}
                  className={cn(
                    "h-8 cursor-pointer rounded-md border px-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
                    category === item
                        ? "border-primary bg-accent text-primary"
                        : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-800",
                  )}
                  >
                    {categoryLabel(item)}
                  </Button>
                ))}
              </div>
            </fieldset>

            <label className="rd-horizon-audit-filter-action block">
              <span className="mb-1 block text-xs font-medium text-slate-600">{t("动作类型")}</span>
              <NativeSelect
                aria-label={t("动作类型")}
                value={action}
                onChange={(event) => {
                  setAction(event.target.value);
                  setPage(1);
                }}
                className={cn("h-9 cursor-pointer px-2.5 text-sm", HORIZON_FIELD)}
              >
                <option value="all">{t("全部动作")}</option>
                {actionOptions.map((item) => (
                  <option key={item} value={item}>
                    {t(getAuditActionMeta(item).label)}
                  </option>
                ))}
              </NativeSelect>
            </label>

            <div className="rd-horizon-audit-filter-entities grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">{t("对象")}</span>
                <NativeSelect
                  aria-label={t("对象")}
                  value={resourceType}
                  onChange={(event) => {
                    setResourceType(event.target.value as FilterValue<ResourceType>);
                    setPage(1);
                  }}
                  className={cn("h-9 cursor-pointer px-2 text-xs", HORIZON_FIELD)}
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
                  aria-label={t("来源")}
                  value={source}
                  onChange={(event) => {
                    setSource(event.target.value as FilterValue<AuditSource>);
                    setPage(1);
                  }}
                  className={cn("h-9 cursor-pointer px-2 text-xs", HORIZON_FIELD)}
                >
                  {SOURCE_FILTERS.map((item) => (
                    <option key={item} value={item}>
                      {t(SOURCE_LABELS[item])}
                    </option>
                  ))}
                </NativeSelect>
              </label>
            </div>

            <label className="rd-horizon-audit-filter-actor block">
              <span className="mb-1 block text-xs font-medium text-slate-600">{t("操作人")}</span>
              <NativeSelect
                aria-label={t("操作人")}
                value={actorId}
                onChange={(event) => {
                  setActorId(event.target.value);
                  setPage(1);
                }}
                className={cn("h-9 cursor-pointer px-2.5 text-sm", HORIZON_FIELD)}
              >
                <option value="all">{t("全部操作人")}</option>
                {actorOptions.map((actor) => (
                  <option key={actor.id} value={actor.id}>
                    {actor.name}（{actor.count}）
                  </option>
                ))}
              </NativeSelect>
            </label>


            </CollapsibleContent>
          </Collapsible>

            <div className="rd-horizon-audit-list-header flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <div>
                <h2 id="audit-results-heading" className="flex items-center gap-2 text-balance text-sm font-semibold text-slate-900">
                  <History className="size-4 text-primary" aria-hidden="true" />
                  {t("审计结果")}
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  {t("当前显示")} <span className="font-semibold tabular-nums text-slate-700">{visibleStart}-{visibleEnd}</span> / {data.total}
                </p>
              </div>
            <div className="rd-horizon-audit-quick-filters">
              <span className="shrink-0 text-xs text-muted-foreground">{t("快捷筛选")}</span>
              <div className="rd-horizon-audit-presets flex max-w-full flex-wrap items-center gap-2">
              {[
                { label: t("任务变更"), onClick: () => applyPreset("task") },
                { label: t("立项审核"), onClick: () => applyPreset("proposal") },
                { label: t("AI 记录"), onClick: () => applyPreset("ai") },
                { label: t("风险动作"), onClick: () => applyPreset("risk") },
                { label: t("今天"), onClick: () => applyPreset("today") },
              ].map((item) => (
                <Button variant="unstyled"
                  key={item.label}
                  type="button"
                  onClick={item.onClick}
                  className={cn("rd-horizon-audit-preset", HORIZON_SECONDARY_ACTION)}
                >
                  {item.label}
                </Button>
              ))}
              <Button variant="unstyled"
                type="button"
                onClick={resetFilters}
                className={cn("rd-horizon-audit-reset", HORIZON_SECONDARY_ACTION)}
              >
                <RotateCcw className="size-3.5" aria-hidden="true" />
                {t("重置")}
              </Button>
            </div>
              <span role="status" className="text-xs text-muted-foreground">{t("{n} 项筛选已启用", { n: activeFilterCount })}</span>
            </div>
              <div className="rd-horizon-audit-list-controls flex flex-wrap items-center gap-2">
                <Button variant="unstyled"
                  type="button"
                  onClick={() => setSortOrder((current) => (current === "newest" ? "oldest" : "newest"))}
                  className={cn("h-8 gap-1.5 px-2.5", HORIZON_SECONDARY_ACTION)}
                >
                  {sortOrder === "newest" ? <ArrowDown className="size-3.5" aria-hidden="true" /> : <ArrowUp className="size-3.5" aria-hidden="true" />}
                  {sortOrder === "newest" ? t("最新优先") : t("最早优先")}
                </Button>
                <NativeSelect
                  aria-label={t("每页显示数量")}
                  value={pageSize}
                  onChange={(event) => {
                    setPageSize(Number(event.target.value) as (typeof PAGE_SIZE_OPTIONS)[number]);
                    setPage(1);
                  }}
                  className={cn("h-8 cursor-pointer px-2 text-xs font-semibold", HORIZON_FIELD)}
                >
                  {PAGE_SIZE_OPTIONS.map((item) => (
                    <option key={item} value={item}>
                      {t("每页 {n}", { n: item })}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>

            <div className="rd-horizon-audit-table-scroll min-w-0 overflow-x-auto" tabIndex={0} aria-label={t("审计结果表格")}>
              <table className="rd-horizon-audit-table w-full" aria-busy={loading}>
                <caption className="sr-only">{t("审计结果：时间、操作人、动作、对象与摘要、来源及变更数量")}</caption>
                <thead>
                  <tr className="border-b border-slate-100 bg-[#f8fafb] text-left text-[11px] font-semibold text-slate-500">
                    <th scope="col" className="w-[132px] px-4 py-2.5">{t("时间")}</th>
                    <th scope="col" className="w-[130px] px-3 py-2.5">{t("操作人")}</th>
                    <th scope="col" className="w-[118px] px-3 py-2.5">{t("动作")}</th>
                    <th scope="col" className="px-3 py-2.5">{t("对象与摘要")}</th>
                    <th scope="col" className="w-[110px] px-3 py-2.5">{t("来源")}</th>
                    <th scope="col" className="w-[120px] px-3 py-2.5">{t("变更")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {error ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-14 text-center">
                        <div role="alert" className="mx-auto flex max-w-md flex-col items-center">
                          <AlertTriangle className="mb-2 size-5 text-amber-500" aria-hidden="true" />
                          <div className="text-sm font-medium text-slate-700">{t("留痕加载失败")}</div>
                          <div className="mt-1 text-pretty text-xs text-slate-500">{error}</div>
                        </div>
                      </td>
                    </tr>
                  ) : loading && pagedLogs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-14 text-center">
                        <Loader2 className="mx-auto mb-2 size-5 animate-spin text-primary" aria-hidden="true" />
                        <div className="text-sm font-medium text-slate-500">{t("正在加载留痕…")}</div>
                      </td>
                    </tr>
                  ) : pagedLogs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-14 text-center">
                        <Filter className="mx-auto mb-2 size-5 text-muted-foreground" aria-hidden="true" />
                        <div className="text-sm font-medium text-slate-500">{t("没有匹配的留痕记录")}</div>
                        <div className="mt-1 text-pretty text-xs text-muted-foreground">{t("当前筛选条件下没有可显示数据。")}</div>
                        {activeFilterCount > 0 ? (
                          <Button variant="unstyled" type="button" onClick={resetFilters} className={cn("mt-3 h-9 px-3", HORIZON_SECONDARY_ACTION)}>
                            {t("清空筛选")}
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  ) : (
                    pagedLogs.map((log, index) => {
                      const meta = getAuditActionMeta(log.action);
                      const selected = selectedLog?.id === log.id;
                      return (
                        <motion.tr
                          key={log.id}
                          initial={shouldReduceMotion ? false : { opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ ...AUDIT_FAST, delay: shouldReduceMotion ? 0 : Math.min(index, 8) * 0.018 }}
                          className={cn(
                            "rd-horizon-audit-row transition-colors",
                            "hover:bg-accent/60 focus-visible:bg-accent",
                            selected && "bg-accent",
                          )}
                          data-selected={selected || undefined}
                          data-tone={meta.tone}
                        >
                          <td data-cell="time" className="px-4 py-3 align-top">
                            <div className="font-mono text-xs tabular-nums text-slate-700">{formatAbsolute(log.timestamp)}</div>
                            <div className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                              <Clock3 className="h-3 w-3" />
                              {new Date(log.timestamp).toLocaleDateString(i18nLocale())}
                            </div>
                          </td>
                          <td data-cell="actor" data-label={t("操作人")} className="px-3 py-3 align-top">
                            <div title={log.actor.name} className="text-sm font-semibold text-slate-900">{log.actor.name}</div>
                            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{log.actor.role ?? "—"}</div>
                          </td>
                          <td data-cell="action" data-label={t("动作")} className="px-3 py-3 align-top">
                            <span className={cn("inline-flex rounded-md border px-2 py-1 text-xs font-semibold", toneBadgeClasses(meta.tone))}>
                              {t(meta.label)}
                            </span>
                            <div className="mt-1 text-[10px] text-muted-foreground">{categoryLabel(meta.category)}</div>
                          </td>
                          <td data-cell="summary" data-label={t("对象与摘要")} className="px-3 py-3 align-top">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                                {resourceLabel(log.resource.type)}
                              </span>
                              <span title={log.resource.id} className="font-mono text-[11px] text-muted-foreground">{log.resource.id}</span>
                            </div>
                            <Button variant="unstyled" type="button" aria-haspopup="dialog" aria-controls="audit-log-detail" title={summarizeLog(log)}
                              aria-label={t("查看留痕详情：{summary}", { summary: summarizeLog(log) })}
                              onClick={(event) => { selectedTriggerRef.current = event.currentTarget; setSelectedId(log.id); }}
                              className="rd-horizon-audit-open-detail mt-1 flex w-full min-w-0 items-start gap-2 text-left text-sm font-semibold text-foreground">
                              <span className="min-w-0 flex-1 line-clamp-2">{summarizeLog(log)}</span>
                              <ChevronRight className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                            </Button>
                            {/* 备注是存库的动态内容，走按需自动翻译（与 RDAuditTimeline 同口径） */}
                            {log.comment && (
                              <div className="mt-0.5 line-clamp-1 text-xs text-slate-500">
                                <AutoTranslatedText text={log.comment} as="span" />
                              </div>
                            )}
                          </td>
                          <td data-cell="source" data-label={t("来源")} className="px-3 py-3 align-top">
                            <span className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-semibold", sourceBadgeClasses(log.source))}>
                              {log.source === "ai" && <Bot className="size-3 text-primary" aria-hidden="true" />}
                              {sourceLabel(log.source)}
                            </span>
                          </td>
                          <td data-cell="changes" data-label={t("变更")} className="px-3 py-3 align-top">
                            <div className="text-xs font-semibold tabular-nums text-slate-700">{t("{n} 项", { n: log.changes?.length ?? 0 })}</div>
                            {log.metadata && Object.keys(log.metadata).length > 0 && (
                              <div className="mt-0.5 text-[10px] text-muted-foreground">
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

            <nav aria-label={t("审计结果分页")} className="rd-horizon-audit-list-footer flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
              <div className="text-xs tabular-nums text-slate-500">
                {t("显示")} {visibleStart}-{visibleEnd}
                <span className="mx-1 text-muted-foreground">/</span>
                {data.total}
              </div>
              <div className="flex items-center gap-1">
                <Button variant="unstyled"
                  type="button"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={safePage === 1}
                  className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md border border-[#e0e5f2] bg-white text-slate-500 hover:border-primary/25 hover:bg-accent hover:text-primary disabled:cursor-not-allowed disabled:opacity-35"
                  aria-label={t("上一页")}
                >
                  <ChevronLeft className="size-4" aria-hidden="true" />
                </Button>
                <span className="min-w-20 px-2 text-center text-xs font-semibold tabular-nums text-slate-600">
                  {safePage} / {totalPages}
                </span>
                <Button variant="unstyled"
                  type="button"
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                  disabled={safePage === totalPages}
                  className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md border border-[#e0e5f2] bg-white text-slate-500 hover:border-primary/25 hover:bg-accent hover:text-primary disabled:cursor-not-allowed disabled:opacity-35"
                  aria-label={t("下一页")}
                >
                  <ChevronRight className="size-4" aria-hidden="true" />
                </Button>
              </div>
            </nav>
        </section>

        <Sheet open={Boolean(selectedLog)} onOpenChange={(open) => { if (!open) setSelectedId(null); }}>
          <SheetContent id="audit-log-detail"
            className="horizon-theme horizon-portal rd-horizon-audit-dialog h-dvh w-full gap-0 overflow-hidden p-0 sm:max-w-2xl"
            onCloseAutoFocus={(event) => { event.preventDefault(); selectedTriggerRef.current?.focus(); }}>
            <SheetHeader className="rd-horizon-audit-sheet-header">
              <SheetTitle className="text-balance">{t("留痕详情")}</SheetTitle>
              <SheetDescription>{t("查看本次操作的完整信息与变更前后。")}</SheetDescription>
            </SheetHeader>
            <AnimatePresence mode="wait" initial={false}>
              {selectedLog && (
              <motion.div
                key={selectedLog.id}
                initial={shouldReduceMotion ? false : { opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, x: -8 }}
                transition={AUDIT_FAST}
                className="rd-horizon-audit-detail-content flex min-h-0 flex-1 flex-col"
              >
                <div className="rd-horizon-audit-detail-header relative shrink-0 border-b border-slate-200 px-4 py-3" data-tone={selectedMeta.tone}>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className={cn("inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-semibold", toneBadgeClasses(selectedMeta.tone))}>
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {t(selectedMeta.label)}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground">{selectedLog.id}</span>
                  </div>
                  <h3 className="text-balance text-sm font-semibold leading-5 text-slate-950">{summarizeLog(selectedLog)}</h3>
                  <div className="mt-1 text-xs text-slate-500">{formatDateTimeFull(selectedLog.timestamp)}</div>
                </div>

                <div className="rd-horizon-audit-detail-body min-h-0 flex-1 space-y-4 overflow-auto px-4 pb-6 pt-4">
                  <section>
                    <h4 className="mb-2 text-balance text-xs font-semibold text-slate-500">{t("基础信息")}</h4>
                    <div className="space-y-2 rounded-lg border border-slate-100 bg-slate-50/50 p-3 text-xs">
                      {[
                        [t("动作"), t(selectedMeta.label)],
                        [t("类别"), categoryLabel(selectedMeta.category)],
                        [t("操作人"), `${selectedLog.actor.name}${selectedLog.actor.role ? ` · ${selectedLog.actor.role}` : ""}`],
                        [t("对象"), `${resourceLabel(selectedLog.resource.type)} · ${selectedLog.resource.name ?? selectedLog.resource.id}`],
                        [t("来源"), sourceLabel(selectedLog.source)],
                      ].map(([label, value]) => (
                        <div key={label} className="flex items-start justify-between gap-3">
                          <span className="shrink-0 text-muted-foreground">{label}</span>
                          <span className="text-right font-medium text-slate-700">{value}</span>
                        </div>
                      ))}
                    </div>
                  </section>

                  {selectedLog.comment && (
                    <section>
                      <h4 className="mb-2 text-balance text-xs font-semibold text-slate-500">{t("备注")}</h4>
                      <p className="text-pretty rounded-lg border border-slate-100 bg-white px-3 py-2 text-sm leading-6 text-slate-700">
                        <AutoTranslatedText text={selectedLog.comment} as="span" />
                      </p>
                    </section>
                  )}

                  <section>
                    <h4 className="mb-2 text-balance text-xs font-semibold text-slate-500">{t("字段变更")}</h4>
                    {selectedLog.changes && selectedLog.changes.length > 0 ? (
                      <div className="space-y-2">
                        {selectedLog.changes.map((change, index) => (
                          <div key={`${change.field}-${index}`} className="rounded-lg border border-slate-100 bg-white px-3 py-2">
                            <div className="font-mono text-xs font-semibold text-slate-600">{change.field}</div>
                            <div className="mt-1 grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-xs">
                              <span className="rounded bg-rose-50 px-2 py-1 text-rose-700 line-through decoration-rose-300">{formatValue(change.before)}</span>
                              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="rounded bg-emerald-50 px-2 py-1 font-semibold text-emerald-700">{formatValue(change.after)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 py-5 text-center text-xs text-muted-foreground">{t("本记录没有字段变更")}</div>
                    )}
                  </section>

                  {selectedLog.metadata && Object.keys(selectedLog.metadata).length > 0 && (
                    <section>
                      <h4 className="mb-2 text-balance text-xs font-semibold text-slate-500">{t("元数据")}</h4>
                      <div className="space-y-1 rounded-lg border border-slate-100 bg-slate-50/60 p-3">
                        {Object.entries(selectedLog.metadata).map(([key, value]) => (
                          <div key={key} className="grid grid-cols-[110px_minmax(0,1fr)] gap-2 text-xs">
                            <span className="font-mono text-muted-foreground">{key}</span>
                            <span className="break-words text-slate-700">{formatValue(value)}</span>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  <section>
                    <div className="mb-2 flex items-center justify-between">
                      <h4 className="text-balance text-xs font-semibold text-slate-500">{t("同对象时间线")}</h4>
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                        {relatedLogs.length}
                      </span>
                    </div>
                    <AuditTimeline logs={relatedLogs.map(toTimelineLog)} showResource={false} emptyText={t("暂无同对象记录")} />
                  </section>
                </div>
              </motion.div>
            )}
            </AnimatePresence>
          </SheetContent>
        </Sheet>
      </div>
    </motion.div>
  );
}

export default AuditLogPage;
