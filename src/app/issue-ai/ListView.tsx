/**
 * 问题记录与 AI 定位 — 列表视图（主内容区，嵌入 App 外壳，自身不画侧栏）。
 *
 * 自上而下：概览统计带 → 工具栏（状态分段 + 新建）→ 筛选（搜索 + 来源）→ 列表(表格) / 可复用(卡片) → 分页。
 * 所有列表数据经 service.list(query)；query 变更即重取。视觉原子全部复用 ./badges。
 */
import * as React from "react";
import {
  Archive,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock3,
  Database,
  ListChecks,
  Plus,
  Search,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../components/ui/utils";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { usePermission } from "../hooks/usePermission";
import {
  type Issue,
  type IssueQuery,
  type IssueService,
  type IssueStats,
  type Paged,
} from "../lib/issue/types";
import { STATUS_GROUP_LABEL } from "../lib/issue/config";
import { NewIssueDrawer } from "./NewIssueDrawer";
import {
  Mono,
  SeverityBadge,
  SolutionTypeBadge,
  SourceTag,
  StatusBadge,
} from "./badges";

const PAGE_SIZE = 6;

type StatusGroupKey = NonNullable<IssueQuery["statusGroup"]>;
const STATUS_GROUP_ORDER: StatusGroupKey[] = [
  "all",
  "pending",
  "processing",
  "solved",
  "reusable",
];

const cardClass =
  "rounded-lg border border-slate-200/80 bg-white/95 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_rgba(15,23,42,0.06)] dark:border-slate-700/80 dark:bg-slate-900/95 dark:shadow-[0_2px_8px_rgba(0,0,0,0.32)]";
const panelClass =
  "rounded-lg border border-slate-200/80 bg-white/90 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-700/80 dark:bg-slate-900/90";

/** 创建人首字头像（Issue 暂无头像 URL，用姓名首字占位）。尺寸/字号由 className 传入。 */
function InitialAvatar({ name, className }: { name: string; className?: string }) {
  const ch = (name ?? "").trim().charAt(0) || "?";
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-indigo-100 font-semibold text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300",
        className,
      )}
    >
      {ch}
    </span>
  );
}

type StatTone = "slate" | "amber" | "emerald" | "indigo" | "sky";

const statToneClass: Record<StatTone, { shell: string; icon: string; value: string }> = {
  slate: {
    shell: "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900",
    icon: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300",
    value: "text-slate-800 dark:text-slate-100",
  },
  amber: {
    shell: "border-amber-200 bg-amber-50/70 dark:border-amber-500/30 dark:bg-amber-500/10",
    icon: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
    value: "text-amber-800 dark:text-amber-200",
  },
  emerald: {
    shell: "border-emerald-200 bg-emerald-50/70 dark:border-emerald-500/30 dark:bg-emerald-500/10",
    icon: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
    value: "text-emerald-800 dark:text-emerald-200",
  },
  indigo: {
    shell: "border-indigo-200 bg-indigo-50/70 dark:border-indigo-500/30 dark:bg-indigo-500/10",
    icon: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300",
    value: "text-indigo-800 dark:text-indigo-200",
  },
  sky: {
    shell: "border-sky-200 bg-sky-50/70 dark:border-sky-500/30 dark:bg-sky-500/10",
    icon: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
    value: "text-sky-800 dark:text-sky-200",
  },
};

// ────────────────────────────────────────────────────────────────────────────
// 概览统计带
// ────────────────────────────────────────────────────────────────────────────
function StatTile({
  label,
  value,
  suffix,
  icon: Icon,
  tone = "slate",
}: {
  label: string;
  value: React.ReactNode;
  suffix?: string;
  icon: LucideIcon;
  tone?: StatTone;
}) {
  const toneClass = statToneClass[tone];
  return (
    <div
      className={cn(
        "flex min-h-[4.75rem] min-w-0 items-center gap-3 rounded-lg border px-3.5 py-3 transition-colors duration-200",
        "shadow-[0_1px_2px_rgba(15,23,42,0.035)]",
        toneClass.shell,
      )}
    >
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-md", toneClass.icon)}>
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{label}</span>
        <span className={cn("mt-1 block text-2xl font-semibold leading-none", toneClass.value)}>
          <Mono>{value}</Mono>
          {suffix ? <span className="ml-0.5 text-sm font-normal text-slate-400">{suffix}</span> : null}
        </span>
      </div>
    </div>
  );
}

function StatsBand({ stats }: { stats: IssueStats | null }) {
  if (!stats) {
    return (
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-[4.75rem] animate-pulse rounded-lg border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-700/80 dark:bg-slate-900"
          />
        ))}
      </div>
    );
  }
  const reusePct = Math.round(stats.reuseRate * 100);
  const avg = stats.avgLocateHours;
  const avgStr = Number.isInteger(avg) ? String(avg) : avg.toFixed(1);
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
      <StatTile label="问题总数" value={stats.total} icon={Database} />
      <StatTile label="待处理" value={stats.pending} icon={ClipboardList} tone="amber" />
      <StatTile label="已解决" value={stats.solved} icon={ListChecks} tone="emerald" />
      <StatTile label="方案复用率" value={reusePct} suffix="%" icon={Archive} tone="indigo" />
      <StatTile label="平均定位时长" value={avgStr} suffix="h" icon={Clock3} tone="sky" />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 工具栏 / 筛选
// ────────────────────────────────────────────────────────────────────────────
function ActiveTag({
  label,
  onClear,
}: {
  label: React.ReactNode;
  onClear: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 py-0.5 pl-2 pr-1 text-xs text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300">
      {label}
      <button
        type="button"
        onClick={onClear}
        aria-label="清除该筛选"
        className="cursor-pointer rounded-sm p-0.5 hover:bg-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 dark:hover:bg-indigo-500/20"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 列表（一行一个问题卡片）
// ────────────────────────────────────────────────────────────────────────────
function IssueList({
  items,
  onOpen,
}: {
  items: Issue[];
  onOpen: (id: string) => void;
}) {
  return (
    <div className="space-y-2">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          onClick={() => onOpen(it.id)}
          className={cn(
            cardClass,
            "group grid w-full cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left transition-all duration-200 hover:border-indigo-300 hover:bg-white hover:shadow-[0_10px_28px_rgba(79,70,229,0.10)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 dark:hover:border-indigo-500/50 dark:hover:bg-slate-900",
          )}
        >
          {/* 头像（创建人，最前） */}
          <InitialAvatar name={it.createdBy} className="size-9 text-sm" />

          {/* 中间：编号 + 来源 + 标题 + 创建人/产品/工位 */}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Mono className="text-[11px] font-semibold text-slate-400">{it.id}</Mono>
              <SourceTag value={it.source} />
            </div>
            <div className="mt-1 truncate text-sm font-semibold text-slate-800 group-hover:text-indigo-700 dark:text-slate-100 dark:group-hover:text-indigo-300">
              {it.title}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
              <span className="truncate font-medium text-slate-600 dark:text-slate-300">{it.createdBy}</span>
              {it.product ? (
                <>
                  <span aria-hidden>·</span>
                  <span className="truncate">{it.product}</span>
                </>
              ) : null}
              {it.station ? (
                <>
                  <span aria-hidden>·</span>
                  <span>{it.station}</span>
                </>
              ) : null}
            </div>
          </div>

          {/* 右：严重度 + 状态 + 时间 */}
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <div className="flex items-center gap-1.5">
              <SeverityBadge value={it.severity} />
              <StatusBadge value={it.status} />
            </div>
            <Mono className="text-xs text-slate-400">{formatDate(it.createdAt)}</Mono>
          </div>
        </button>
      ))}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 可复用视图（卡片）
// ────────────────────────────────────────────────────────────────────────────
function ReusableCards({
  items,
  onOpen,
}: {
  items: Issue[];
  onOpen: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((it) => {
        const adoptedAnalysis = it.analyses.find((a) => a.isAdopted);
        const adoptedCause =
          it.adopted?.kind === "analysis" && adoptedAnalysis
            ? adoptedAnalysis.content.possibleCauses.find(
                (c) => c.id === it.adopted?.causeId,
              )
            : undefined;
        const adoptedSolution = adoptedCause?.solutions.find(
          (s) => it.adopted?.kind === "analysis" && s.id === it.adopted.solutionId,
        );
        const summary =
          adoptedSolution?.action ??
          adoptedAnalysis?.summary ??
          (it.adopted?.kind === "reuse"
            ? `复用自 ${it.adopted.reusedFrom}`
            : "已沉淀可复用方案");
        return (
          <button
            key={it.id}
            type="button"
            onClick={() => onOpen(it.id)}
            className={cn(
              cardClass,
              "flex min-h-[12rem] cursor-pointer flex-col gap-2 p-4 text-left transition-all duration-200 hover:border-indigo-300 hover:bg-white hover:shadow-[0_10px_28px_rgba(79,70,229,0.10)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 dark:hover:border-indigo-500/50 dark:hover:bg-slate-900",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <Mono className="text-xs text-slate-400">{it.id}</Mono>
              <span className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300">
                可复用
              </span>
            </div>
            <div className="line-clamp-2 text-sm font-medium text-slate-800 dark:text-slate-100">
              {it.title}
            </div>
            <div className="mt-1 rounded-lg border border-indigo-100 bg-indigo-50/50 p-2.5 dark:border-indigo-500/20 dark:bg-indigo-500/5">
              <div className="mb-1 flex items-center gap-1.5">
                <span className="text-xs font-medium text-indigo-700 dark:text-indigo-300">
                  采纳方案
                </span>
                {adoptedSolution ? (
                  <SolutionTypeBadge value={adoptedSolution.type} />
                ) : null}
              </div>
              <p className="line-clamp-3 text-xs text-slate-600 dark:text-slate-300">
                {summary}
              </p>
            </div>
            <div className="mt-auto flex items-center gap-1.5 pt-1 text-xs text-slate-400">
              <SourceTag value={it.source} />
              {it.product ? (
                <>
                  <span aria-hidden>·</span>
                  <span>{it.product}</span>
                </>
              ) : null}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 分页
// ────────────────────────────────────────────────────────────────────────────
function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-1">
      <span className="text-xs text-slate-500 dark:text-slate-400">
        共 <Mono>{total}</Mono> 条 · 第 <Mono>{from}</Mono>–<Mono>{to}</Mono> 条
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          className="inline-flex h-7 cursor-pointer items-center gap-0.5 rounded-md border border-slate-200 px-2 text-xs text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <ChevronLeft className="size-3.5" />
          上一页
        </button>
        {pages.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPage(p)}
            aria-current={p === page ? "page" : undefined}
            className={cn(
              "inline-flex h-7 min-w-7 cursor-pointer items-center justify-center rounded-md border px-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60",
              p === page
                ? "border-indigo-300 bg-indigo-50 font-medium text-indigo-700 dark:border-indigo-500/40 dark:bg-indigo-500/10 dark:text-indigo-300"
                : "border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800",
            )}
          >
            <Mono>{p}</Mono>
          </button>
        ))}
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
          className="inline-flex h-7 cursor-pointer items-center gap-0.5 rounded-md border border-slate-200 px-2 text-xs text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          下一页
          <ChevronRight className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 主组件
// ────────────────────────────────────────────────────────────────────────────
export function ListView({
  service,
  onOpen,
}: {
  service: IssueService;
  onOpen: (id: string) => void;
}) {
  const canCreate = usePermission("issue:create");
  const [stats, setStats] = React.useState<IssueStats | null>(null);

  const [query, setQuery] = React.useState<IssueQuery>({
    statusGroup: "all",
    page: 1,
    pageSize: PAGE_SIZE,
  });
  const [paged, setPaged] = React.useState<Paged<Issue> | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [searchText, setSearchText] = React.useState("");
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  // 稳定的 patch：变更任意筛选都回到第 1 页。
  const patchQuery = React.useCallback((patch: Partial<IssueQuery>) => {
    setQuery((q) => ({ ...q, ...patch, page: 1 }));
  }, []);

  // 概览统计：初次加载 + 抽屉关闭后（可能新建）刷新。
  const loadAux = React.useCallback(() => {
    void service.stats().then(setStats);
  }, [service]);

  React.useEffect(() => {
    loadAux();
  }, [loadAux]);

  // 列表数据：query 变更即重取。
  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    void service.list(query).then((res) => {
      if (alive) {
        setPaged(res);
        setLoading(false);
      }
    });
    return () => {
      alive = false;
    };
  }, [service, query]);

  const statusGroup = query.statusGroup ?? "all";
  const isReusableView = statusGroup === "reusable";

  const hasExtraFilter = !!query.search;

  const applySearch = () => {
    const v = searchText.trim();
    patchQuery({ search: v || undefined });
  };

  const clearAll = () => {
    setSearchText("");
    setQuery((q) => ({
      statusGroup: q.statusGroup,
      page: 1,
      pageSize: PAGE_SIZE,
    }));
  };

  const items = paged?.items ?? [];
  const total = paged?.total ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <span className="inline-flex items-center gap-1.5 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300">
            <Sparkles className="size-3.5" />
            AI 根因定位
          </span>
          <h1 className="mt-2 text-[1.65rem] font-semibold leading-tight text-slate-950 dark:text-white">
            问题记录与 AI 定位
          </h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500 dark:text-slate-400">
            面向研发与生产异常的质量闭环工作台，统一记录、相似复用、根因分析与处理留痕。
          </p>
        </div>
        {canCreate && (
          <Button size="sm" onClick={() => setDrawerOpen(true)} className="cursor-pointer shadow-sm">
            <Plus className="size-4" />
            新建问题
          </Button>
        )}
      </header>

      {/* 1) 概览统计带 */}
      <div className="shrink-0">
        <StatsBand stats={stats} />
      </div>

      {/* 2) 工具栏 / 筛选 */}
      <section className={cn(panelClass, "flex shrink-0 flex-col gap-3 p-3")}>
        <div className="flex flex-wrap items-center gap-2">
          {/* 状态分段 */}
          <div className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-800/40">
            {STATUS_GROUP_ORDER.map((key) => {
              const active = statusGroup === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => patchQuery({ statusGroup: key })}
                  className={cn(
                    "cursor-pointer rounded-md px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60",
                    active
                      ? "bg-white text-indigo-700 shadow-sm dark:bg-slate-900 dark:text-indigo-300"
                      : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200",
                  )}
                >
                  {STATUS_GROUP_LABEL[key]}
                </button>
              );
            })}
          </div>

          {/* 搜索（推到右侧，与新建相邻） */}
          <div className="relative ml-auto w-full max-w-[18rem]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              onBlur={applySearch}
              onKeyDown={(e) => {
                if (e.key === "Enter") applySearch();
              }}
              placeholder="搜索标题 / 编号 / 产品 / 描述"
              className="h-9 border-slate-300 bg-white pl-8 text-xs shadow-sm focus-visible:border-indigo-400 dark:border-slate-600 dark:bg-slate-900"
            />
          </div>
        </div>

        {/* 活动搜索标签 */}
        {hasExtraFilter && (
          <div className="flex flex-wrap items-center gap-2">
            {query.search ? (
              <ActiveTag
                label={<>搜索：{query.search}</>}
                onClear={() => {
                  setSearchText("");
                  patchQuery({ search: undefined });
                }}
              />
            ) : null}
            <button
              type="button"
              onClick={clearAll}
              className="inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-0.5 text-xs text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 dark:text-slate-400 dark:hover:text-slate-200"
            >
              清除筛选
            </button>
          </div>
        )}
      </section>

      {/* 3) 列表主体 + 分页：内容自然流动（列表项卡片，数据少不撑空），分页紧跟列表 */}
      <section className="flex flex-col gap-3">
        {loading && !paged ? (
          <div className={cn(cardClass, "flex items-center justify-center py-16 text-sm text-slate-400")}>
            加载中…
          </div>
        ) : total === 0 ? (
          <div className={cn(cardClass, "flex flex-col items-center justify-center gap-1 py-16 text-center")}>
            <p className="text-sm text-slate-500 dark:text-slate-400">未找到匹配的问题</p>
            <p className="text-xs text-slate-400">
              {hasExtraFilter ? "试试调整或清除筛选条件" : "点击「新建问题」开始记录"}
            </p>
          </div>
        ) : (
          <div className={cn("flex flex-col gap-3", loading && "opacity-60 transition-opacity")}>
            {isReusableView ? (
              <ReusableCards items={items} onOpen={onOpen} />
            ) : (
              <IssueList items={items} onOpen={onOpen} />
            )}
            <Pagination
              page={paged?.page ?? 1}
              pageSize={paged?.pageSize ?? PAGE_SIZE}
              total={total}
              onPage={(p) => setQuery((q) => ({ ...q, page: p }))}
            />
          </div>
        )}
      </section>

      {/* 新建抽屉 */}
      <NewIssueDrawer
        service={service}
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          loadAux();
        }}
        onOpen={onOpen}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(
    d.getHours(),
  )}:${p(d.getMinutes())}`;
}
