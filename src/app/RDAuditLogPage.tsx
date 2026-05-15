import React, { useDeferredValue, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Activity,
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
  RotateCcw,
  Search,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { AuditTimeline } from "./RDAuditTimeline";
import {
  AuditAction,
  AuditCategory,
  AuditLog,
  AuditResource,
  AUDIT_ACTION_META,
  CATEGORY_LABELS,
  useAuditLogs,
} from "./lib/auditLog";
import { cn } from "./components/ui/utils";

type FilterValue<T extends string> = T | "all";
type AuditSource = AuditLog["source"];
type ResourceType = AuditResource["type"];
type SortOrder = "newest" | "oldest";

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
const RESOURCE_FILTERS: Array<FilterValue<ResourceType>> = [
  "all",
  "task",
  "proposal",
  "project",
  "person",
  "flow",
  "role",
  "system",
];
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
  flow: "审批流",
  system: "系统",
};

function categoryLabel(category: FilterValue<AuditCategory>) {
  return category === "all" ? "全部" : CATEGORY_LABELS[category];
}

function formatAbsolute(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatDateTimeFull(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", {
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

function logSearchText(log: AuditLog): string {
  const meta = AUDIT_ACTION_META[log.action];
  const changes = log.changes?.map((change) => `${change.field} ${formatValue(change.before)} ${formatValue(change.after)}`).join(" ") ?? "";
  const metadata = log.metadata ? Object.entries(log.metadata).map(([key, value]) => `${key} ${formatValue(value)}`).join(" ") : "";
  return [
    log.id,
    log.actor.name,
    log.actor.role,
    meta.label,
    meta.verb,
    log.resource.type,
    log.resource.id,
    log.resource.name,
    log.comment,
    log.source,
    changes,
    metadata,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function summarizeLog(log: AuditLog) {
  const meta = AUDIT_ACTION_META[log.action];
  const target = log.resource.name ?? log.resource.id;
  return `${log.actor.name} ${meta.verb}${target ? ` · ${target}` : ""}`;
}

function sameResource(a: AuditLog, b: AuditLog) {
  return a.resource.type === b.resource.type && a.resource.id === b.resource.id;
}

export function RDAuditLogPage() {
  const shouldReduceMotion = useReducedMotion();
  const allLogs = useAuditLogs();
  const [keyword, setKeyword] = useState("");
  const deferredKeyword = useDeferredValue(keyword);
  const [category, setCategory] = useState<FilterValue<AuditCategory>>("all");
  const [source, setSource] = useState<FilterValue<AuditSource>>("all");
  const [resourceType, setResourceType] = useState<FilterValue<ResourceType>>("all");
  const [actorId, setActorId] = useState("all");
  const [action, setAction] = useState<FilterValue<AuditAction>>("all");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(25);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const actorOptions = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; role?: string; count: number }>();
    allLogs.forEach((log) => {
      const existing = byId.get(log.actor.id);
      byId.set(log.actor.id, {
        id: log.actor.id,
        name: log.actor.name,
        role: log.actor.role,
        count: (existing?.count ?? 0) + 1,
      });
    });
    return Array.from(byId.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-CN"));
  }, [allLogs]);

  const actionOptions = useMemo(() => {
    const actions = Array.from(new Set(allLogs.map((log) => log.action)));
    return actions
      .filter((item) => category === "all" || AUDIT_ACTION_META[item].category === category)
      .sort((a, b) => AUDIT_ACTION_META[a].label.localeCompare(AUDIT_ACTION_META[b].label, "zh-CN"));
  }, [allLogs, category]);

  const filteredLogs = useMemo(() => {
    const keywordText = deferredKeyword.trim().toLowerCase();
    const sinceIso = toDateStart(since);
    const untilIso = toDateEnd(until);

    return allLogs
      .filter((log) => {
        const meta = AUDIT_ACTION_META[log.action];
        if (category !== "all" && meta.category !== category) return false;
        if (source !== "all" && log.source !== source) return false;
        if (resourceType !== "all" && log.resource.type !== resourceType) return false;
        if (actorId !== "all" && log.actor.id !== actorId) return false;
        if (action !== "all" && log.action !== action) return false;
        if (sinceIso && log.timestamp < sinceIso) return false;
        if (untilIso && log.timestamp > untilIso) return false;
        if (keywordText && !logSearchText(log).includes(keywordText)) return false;
        return true;
      })
      .sort((a, b) =>
        sortOrder === "newest"
          ? b.timestamp.localeCompare(a.timestamp)
          : a.timestamp.localeCompare(b.timestamp),
      );
  }, [action, actorId, allLogs, category, deferredKeyword, resourceType, since, sortOrder, source, until]);

  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedLogs = filteredLogs.slice((safePage - 1) * pageSize, safePage * pageSize);
  const selectedLog = filteredLogs.find((log) => log.id === selectedId) ?? pagedLogs[0] ?? filteredLogs[0] ?? null;
  const relatedLogs = selectedLog ? filteredLogs.filter((log) => sameResource(log, selectedLog)).slice(0, 12) : [];
  const visibleStart = filteredLogs.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const visibleEnd = Math.min(safePage * pageSize, filteredLogs.length);
  const activeFilterCount = [
    deferredKeyword.trim(),
    category !== "all",
    source !== "all",
    resourceType !== "all",
    actorId !== "all",
    action !== "all",
    since,
    until,
  ].filter(Boolean).length;

  const stats = useMemo(() => {
    const uniqueResources = new Set(filteredLogs.map((log) => `${log.resource.type}:${log.resource.id}`)).size;
    const uniqueActors = new Set(filteredLogs.map((log) => log.actor.id)).size;
    const aiCount = filteredLogs.filter((log) => log.source === "ai" || AUDIT_ACTION_META[log.action].category === "ai").length;
    const riskCount = filteredLogs.filter((log) => ["proposal.rejected", "task.reassigned", "task.archived", "flow.reset"].includes(log.action)).length;
    return { total: filteredLogs.length, uniqueResources, uniqueActors, aiCount, riskCount };
  }, [filteredLogs]);

  const resetFilters = () => {
    setKeyword("");
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
    const today = new Date().toISOString().slice(0, 10);
    setSince(today);
    setUntil(today);
  };

  return (
    <motion.div
      initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={AUDIT_PANEL}
      className="min-h-full bg-[#f4f7f8] px-5 py-5 lg:px-7 lg:py-6"
      style={{
        backgroundImage:
          "linear-gradient(180deg, rgba(236,253,245,0.45) 0%, rgba(244,247,248,0) 260px), linear-gradient(90deg, rgba(8,145,178,0.05) 1px, transparent 1px)",
        backgroundSize: "auto, 28px 28px",
      }}
    >
      <div className="mx-auto flex max-w-[1500px] flex-col gap-4">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200/80 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#13262f] text-white shadow-[0_10px_22px_rgba(15,23,42,0.18)]">
                <ShieldCheck className="h-4 w-4" />
              </span>
              <div>
                <h1 className="text-xl font-semibold text-slate-950">研发操作留痕</h1>
                <p className="mt-0.5 text-sm text-slate-500">审计查询台 · 追责、复盘、抽查、异常定位</p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {[
              { label: "任务变更", onClick: () => applyPreset("task") },
              { label: "立项审核", onClick: () => applyPreset("proposal") },
              { label: "AI 记录", onClick: () => applyPreset("ai") },
              { label: "风险动作", onClick: () => applyPreset("risk") },
              { label: "今天", onClick: () => applyPreset("today") },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={item.onClick}
                className="inline-flex h-8 cursor-pointer items-center rounded-md border border-slate-200 bg-white/90 px-3 text-xs font-semibold text-slate-600 shadow-[0_4px_12px_rgba(15,23,42,0.03)] transition-all duration-150 hover:-translate-y-0.5 hover:border-cyan-200 hover:bg-cyan-50 hover:text-cyan-800 active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200"
              >
                {item.label}
              </button>
            ))}
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md bg-[#13262f] px-3 text-xs font-semibold text-white shadow-[0_8px_18px_rgba(19,38,47,0.18)] transition-all duration-150 hover:-translate-y-0.5 hover:bg-[#0d1d24] active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              重置
            </button>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-2 md:grid-cols-5">
          {[
            { label: "匹配记录", value: stats.total, Icon: Database, tone: "text-slate-900" },
            { label: "涉及对象", value: stats.uniqueResources, Icon: Activity, tone: "text-cyan-700" },
            { label: "操作人员", value: stats.uniqueActors, Icon: UserRound, tone: "text-emerald-600" },
            { label: "AI/自动", value: stats.aiCount, Icon: Bot, tone: "text-indigo-700" },
            { label: "风险动作", value: stats.riskCount, Icon: ShieldCheck, tone: "text-amber-600" },
          ].map(({ label, value, Icon, tone }, index) => (
            <motion.div
              key={label}
              initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...AUDIT_FAST, delay: shouldReduceMotion ? 0 : index * 0.035 }}
              className="group relative flex min-h-20 items-center gap-3 overflow-hidden rounded-lg border border-slate-200 bg-white/95 px-4 py-3 shadow-[0_8px_20px_rgba(15,23,42,0.04)] transition-all duration-200 hover:-translate-y-0.5 hover:border-cyan-100 hover:shadow-[0_14px_28px_rgba(15,23,42,0.07)]"
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

        <div className="grid min-h-[650px] gap-4 xl:grid-cols-[300px_minmax(0,1fr)_360px]">
          <aside className="space-y-3 rounded-lg border border-slate-200 bg-white/95 p-4 shadow-[0_10px_24px_rgba(15,23,42,0.05)] xl:sticky xl:top-4 xl:self-start">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <ListFilter className="h-4 w-4 text-slate-500" />
                精准筛选
              </h2>
              <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", activeFilterCount > 0 ? "bg-cyan-50 text-cyan-800" : "bg-slate-100 text-slate-500")}>
                {activeFilterCount} active
              </span>
            </div>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">关键字</span>
              <div className="flex items-center gap-2 rounded-md border border-slate-200 px-2.5 py-2 transition-all focus-within:border-cyan-300 focus-within:ring-2 focus-within:ring-cyan-100">
                <Search className={cn("h-3.5 w-3.5 transition-colors", keyword ? "text-cyan-700" : "text-slate-400")} />
                <input
                  value={keyword}
                  onChange={(event) => {
                    setKeyword(event.target.value);
                    setPage(1);
                  }}
                  placeholder="人 / 任务号 / 备注 / 字段"
                  className="min-w-0 flex-1 text-sm text-slate-900 outline-none placeholder:text-slate-400"
                />
              </div>
            </label>

            <div>
              <div className="mb-1.5 text-xs font-medium text-slate-600">类别</div>
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
                        ? "border-cyan-200 bg-cyan-50 text-cyan-800 shadow-[0_6px_14px_rgba(8,145,178,0.08)]"
                        : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-800",
                  )}
                  >
                    {categoryLabel(item)}
                  </button>
                ))}
              </div>
            </div>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">动作类型</span>
              <select
                value={action}
                onChange={(event) => {
                  setAction(event.target.value as FilterValue<AuditAction>);
                  setPage(1);
                }}
                  className="h-9 w-full cursor-pointer rounded-md border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition-all focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
              >
                <option value="all">全部动作</option>
                {actionOptions.map((item) => (
                  <option key={item} value={item}>
                    {AUDIT_ACTION_META[item].label}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">对象</span>
                <select
                  value={resourceType}
                  onChange={(event) => {
                    setResourceType(event.target.value as FilterValue<ResourceType>);
                    setPage(1);
                  }}
                  className="h-9 w-full cursor-pointer rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none transition-all focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
                >
                  {RESOURCE_FILTERS.map((item) => (
                    <option key={item} value={item}>
                      {RESOURCE_LABELS[item]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">来源</span>
                <select
                  value={source}
                  onChange={(event) => {
                    setSource(event.target.value as FilterValue<AuditSource>);
                    setPage(1);
                  }}
                  className="h-9 w-full cursor-pointer rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none transition-all focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
                >
                  {SOURCE_FILTERS.map((item) => (
                    <option key={item} value={item}>
                      {SOURCE_LABELS[item]}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">操作人</span>
              <select
                value={actorId}
                onChange={(event) => {
                  setActorId(event.target.value);
                  setPage(1);
                }}
                className="h-9 w-full cursor-pointer rounded-md border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition-all focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
              >
                <option value="all">全部操作人</option>
                {actorOptions.map((actor) => (
                  <option key={actor.id} value={actor.id}>
                    {actor.name}（{actor.count}）
                  </option>
                ))}
              </select>
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-600">
                  <CalendarDays className="h-3 w-3" />
                  开始
                </span>
                <input
                  type="date"
                  value={since}
                  onChange={(event) => {
                    setSince(event.target.value);
                    setPage(1);
                  }}
                  className="h-9 w-full rounded-md border border-slate-200 px-2 text-xs text-slate-700 outline-none transition-all focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
                />
              </label>
              <label className="block">
                <span className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-600">
                  <CalendarDays className="h-3 w-3" />
                  结束
                </span>
                <input
                  type="date"
                  value={until}
                  onChange={(event) => {
                    setUntil(event.target.value);
                    setPage(1);
                  }}
                  className="h-9 w-full rounded-md border border-slate-200 px-2 text-xs text-slate-700 outline-none transition-all focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
                />
              </label>
            </div>
          </aside>

          <main className="min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white/95 shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <History className="h-4 w-4 text-slate-500" />
                  审计结果
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  当前显示 <span className="font-semibold tabular-nums text-slate-700">{visibleStart}-{visibleEnd}</span> / {filteredLogs.length}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSortOrder((current) => (current === "newest" ? "oldest" : "newest"))}
                  className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-600 transition-all duration-150 hover:border-cyan-200 hover:bg-cyan-50 hover:text-cyan-800 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200"
                >
                  {sortOrder === "newest" ? <ArrowDown className="h-3.5 w-3.5" /> : <ArrowUp className="h-3.5 w-3.5" />}
                  {sortOrder === "newest" ? "最新优先" : "最早优先"}
                </button>
                <select
                  value={pageSize}
                  onChange={(event) => {
                    setPageSize(Number(event.target.value) as (typeof PAGE_SIZE_OPTIONS)[number]);
                    setPage(1);
                  }}
                  className="h-8 cursor-pointer rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-600 outline-none transition-all focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
                >
                  {PAGE_SIZE_OPTIONS.map((item) => (
                    <option key={item} value={item}>
                      每页 {item}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px]">
                <thead>
                  <tr className="border-b border-slate-100 bg-[#f8fafb] text-left text-[11px] font-semibold text-slate-500">
                    <th className="w-[132px] px-4 py-2.5">时间</th>
                    <th className="w-[130px] px-3 py-2.5">操作人</th>
                    <th className="w-[118px] px-3 py-2.5">动作</th>
                    <th className="px-3 py-2.5">对象与摘要</th>
                    <th className="w-[110px] px-3 py-2.5">来源</th>
                    <th className="w-[120px] px-3 py-2.5">变更</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pagedLogs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-14 text-center">
                        <Filter className="mx-auto mb-2 h-5 w-5 text-slate-300" />
                        <div className="text-sm font-medium text-slate-500">没有匹配的留痕记录</div>
                        <div className="mt-1 text-xs text-slate-400">当前筛选条件下没有可显示数据。</div>
                      </td>
                    </tr>
                  ) : (
                    pagedLogs.map((log, index) => {
                      const meta = AUDIT_ACTION_META[log.action];
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
                            "hover:bg-cyan-50/45 focus-visible:bg-cyan-50/60",
                            selected && "bg-cyan-50/70 shadow-[inset_3px_0_0_#0891b2]",
                          )}
                        >
                          <td className="px-4 py-3 align-top">
                            <div className="font-mono text-xs tabular-nums text-slate-700">{formatAbsolute(log.timestamp)}</div>
                            <div className="mt-0.5 flex items-center gap-1 text-[10px] text-slate-400">
                              <Clock3 className="h-3 w-3" />
                              {new Date(log.timestamp).toLocaleDateString("zh-CN")}
                            </div>
                          </td>
                          <td className="px-3 py-3 align-top">
                            <div className="text-sm font-semibold text-slate-900">{log.actor.name}</div>
                            <div className="mt-0.5 truncate text-[11px] text-slate-400">{log.actor.role ?? "—"}</div>
                          </td>
                          <td className="px-3 py-3 align-top">
                            <span className={cn("inline-flex rounded-md border px-2 py-1 text-xs font-semibold", TONE_BADGE_CLASSES[meta.tone])}>
                              {meta.label}
                            </span>
                            <div className="mt-1 text-[10px] text-slate-400">{categoryLabel(meta.category)}</div>
                          </td>
                          <td className="px-3 py-3 align-top">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                                {RESOURCE_LABELS[log.resource.type]}
                              </span>
                              <span className="font-mono text-[11px] text-slate-400">{log.resource.id}</span>
                            </div>
                            <div className="mt-1 line-clamp-1 text-sm font-medium text-slate-900">{summarizeLog(log)}</div>
                            {log.comment && <div className="mt-0.5 line-clamp-1 text-xs text-slate-500">{log.comment}</div>}
                          </td>
                          <td className="px-3 py-3 align-top">
                            <span className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-semibold", SOURCE_BADGE_CLASSES[log.source])}>
                              {log.source === "ai" && <Bot className="h-3 w-3 text-indigo-500" />}
                              {SOURCE_LABELS[log.source]}
                            </span>
                          </td>
                          <td className="px-3 py-3 align-top">
                            <div className="text-xs font-semibold tabular-nums text-slate-700">{log.changes?.length ?? 0} 项</div>
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

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
              <div className="text-xs tabular-nums text-slate-500">
                显示 {filteredLogs.length === 0 ? 0 : (safePage - 1) * pageSize + 1}-
                {Math.min(safePage * pageSize, filteredLogs.length)}
                <span className="mx-1 text-slate-300">/</span>
                {filteredLogs.length}
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={safePage === 1}
                  className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition-all hover:border-cyan-200 hover:bg-cyan-50 hover:text-cyan-800 disabled:cursor-not-allowed disabled:opacity-35"
                  aria-label="上一页"
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
                  className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition-all hover:border-cyan-200 hover:bg-cyan-50 hover:text-cyan-800 disabled:cursor-not-allowed disabled:opacity-35"
                  aria-label="下一页"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </main>

          <aside className="overflow-hidden rounded-lg border border-slate-200 bg-white/95 shadow-[0_10px_24px_rgba(15,23,42,0.05)] xl:sticky xl:top-4 xl:self-start">
            <AnimatePresence mode="wait" initial={false}>
              {selectedLog ? (
              <motion.div
                key={selectedLog.id}
                initial={shouldReduceMotion ? false : { opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, x: -8 }}
                transition={AUDIT_FAST}
                className="flex h-full min-h-[650px] flex-col"
              >
                <div className="relative border-b border-slate-200 px-4 py-3">
                  <span className={cn("absolute left-0 top-0 h-full w-1", TONE_BAR_CLASSES[AUDIT_ACTION_META[selectedLog.action].tone])} />
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className={cn("inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-semibold", TONE_BADGE_CLASSES[AUDIT_ACTION_META[selectedLog.action].tone])}>
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {AUDIT_ACTION_META[selectedLog.action].label}
                    </span>
                    <span className="font-mono text-[10px] text-slate-400">{selectedLog.id}</span>
                  </div>
                  <h3 className="text-sm font-semibold leading-5 text-slate-950">{summarizeLog(selectedLog)}</h3>
                  <div className="mt-1 text-xs text-slate-500">{formatDateTimeFull(selectedLog.timestamp)}</div>
                </div>

                <div className="flex-1 space-y-4 overflow-auto px-4 pb-28 pt-4">
                  <section>
                    <h4 className="mb-2 text-xs font-semibold text-slate-500">基础信息</h4>
                    <div className="space-y-2 rounded-lg border border-slate-100 bg-slate-50/50 p-3 text-xs">
                      {[
                        ["动作", AUDIT_ACTION_META[selectedLog.action].label],
                        ["类别", categoryLabel(AUDIT_ACTION_META[selectedLog.action].category)],
                        ["操作人", `${selectedLog.actor.name}${selectedLog.actor.role ? ` · ${selectedLog.actor.role}` : ""}`],
                        ["对象", `${RESOURCE_LABELS[selectedLog.resource.type]} · ${selectedLog.resource.name ?? selectedLog.resource.id}`],
                        ["来源", SOURCE_LABELS[selectedLog.source]],
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
                      <h4 className="mb-2 text-xs font-semibold text-slate-500">备注</h4>
                      <p className="rounded-lg border border-slate-100 bg-white px-3 py-2 text-sm leading-6 text-slate-700">{selectedLog.comment}</p>
                    </section>
                  )}

                  <section>
                    <h4 className="mb-2 text-xs font-semibold text-slate-500">字段变更</h4>
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
                      <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 py-5 text-center text-xs text-slate-400">本记录没有字段变更</div>
                    )}
                  </section>

                  {selectedLog.metadata && Object.keys(selectedLog.metadata).length > 0 && (
                    <section>
                      <h4 className="mb-2 text-xs font-semibold text-slate-500">元数据</h4>
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
                      <h4 className="text-xs font-semibold text-slate-500">同对象时间线</h4>
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                        {relatedLogs.length}
                      </span>
                    </div>
                    <AuditTimeline logs={relatedLogs} showResource={false} emptyText="暂无同对象记录" />
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
                className="flex h-full min-h-[650px] flex-col items-center justify-center px-6 text-center"
              >
                <History className="mb-2 h-6 w-6 text-slate-300" />
                <div className="text-sm font-medium text-slate-500">暂无选中记录</div>
              </motion.div>
            )}
            </AnimatePresence>
          </aside>
        </div>
      </div>
    </motion.div>
  );
}

export default RDAuditLogPage;
