/**
 * 问题记录与 AI 定位 — 列表视图（主内容区，嵌入 App 外壳，自身不画侧栏）。
 *
 * 自上而下：概览统计带 → 工具栏（状态分段 + 新建）→ 筛选（搜索 + 来源）→ 列表(表格) / 可复用(卡片) → 分页。
 * 所有列表数据经 service.list(query)；query 变更即重取。视觉原子全部复用 ./badges。
 */
import * as React from "react";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Search,
  X,
} from "lucide-react";
import { cn } from "../components/ui/utils";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
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
  "rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_4px_10px_rgba(15,23,42,0.05),0_16px_32px_rgba(15,23,42,0.08)] dark:border-slate-700/80 dark:bg-slate-900 dark:shadow-[0_2px_8px_rgba(0,0,0,0.4)]";

// ────────────────────────────────────────────────────────────────────────────
// 概览统计带
// ────────────────────────────────────────────────────────────────────────────
function StatTile({
  label,
  value,
  suffix,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  suffix?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-w-[7.5rem] flex-1 flex-col gap-1 rounded-xl border px-4 py-2.5 transition-colors duration-200",
        "shadow-[0_1px_2px_rgba(15,23,42,0.04),0_3px_8px_rgba(15,23,42,0.05)]",
        accent
          ? "border-indigo-200 bg-gradient-to-br from-indigo-50 to-white dark:border-indigo-500/30 dark:from-indigo-500/15 dark:to-slate-900"
          : "border-slate-200/70 bg-white hover:border-slate-300 dark:border-slate-700/80 dark:bg-slate-900",
      )}
    >
      <span className="text-xs text-slate-500 dark:text-slate-400">{label}</span>
      <span
        className={cn(
          "text-2xl font-semibold leading-none",
          accent
            ? "text-indigo-700 dark:text-indigo-300"
            : "text-slate-800 dark:text-slate-100",
        )}
      >
        <Mono>{value}</Mono>
        {suffix ? (
          <span className="ml-0.5 text-sm font-normal text-slate-400">{suffix}</span>
        ) : null}
      </span>
    </div>
  );
}

function StatsBand({ stats }: { stats: IssueStats | null }) {
  if (!stats) {
    return (
      <div className="flex flex-wrap gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-[4.25rem] min-w-[7.5rem] flex-1 animate-pulse rounded-xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_3px_8px_rgba(15,23,42,0.05)] dark:border-slate-700/80 dark:bg-slate-900"
          />
        ))}
      </div>
    );
  }
  const reusePct = Math.round(stats.reuseRate * 100);
  const avg = stats.avgLocateHours;
  const avgStr = Number.isInteger(avg) ? String(avg) : avg.toFixed(1);
  return (
    <div className="flex flex-wrap gap-3">
      <StatTile label="问题总数" value={stats.total} />
      <StatTile label="待处理" value={stats.pending} />
      <StatTile label="已解决" value={stats.solved} />
      <StatTile label="方案复用率" value={reusePct} suffix="%" accent />
      <StatTile label="平均定位时长" value={avgStr} suffix="h" />
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
        className="rounded-sm p-0.5 hover:bg-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 dark:hover:bg-indigo-500/20"
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
    <div className="space-y-2.5">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          onClick={() => onOpen(it.id)}
          className={cn(
            cardClass,
            "flex w-full items-center gap-4 p-4 text-left transition-all hover:border-indigo-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 dark:hover:border-indigo-500/50",
          )}
        >
          {/* 左：编号 + 标题 + 来源/产品/工位 */}
          <div className="min-w-0 flex-1">
            <Mono className="text-xs text-slate-400">{it.id}</Mono>
            <div className="mt-1 truncate font-medium text-slate-800 dark:text-slate-100">
              {it.title}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-slate-400">
              <SourceTag value={it.source} />
              {it.product ? (
                <>
                  <span aria-hidden>·</span>
                  <span>{it.product}</span>
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
              "flex flex-col gap-2 p-4 text-left transition-all hover:border-indigo-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 dark:hover:border-indigo-500/50",
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
          className="inline-flex h-7 items-center gap-0.5 rounded-md border border-slate-200 px-2 text-xs text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
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
              "inline-flex h-7 min-w-7 items-center justify-center rounded-md border px-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60",
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
          className="inline-flex h-7 items-center gap-0.5 rounded-md border border-slate-200 px-2 text-xs text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
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
      {/* 1) 概览统计带 */}
      <div className="shrink-0">
        <StatsBand stats={stats} />
      </div>

      {/* 2) 工具栏 / 筛选 */}
      <section className="flex shrink-0 flex-col gap-3">
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
                    "rounded-md px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60",
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

          <Button size="sm" onClick={() => setDrawerOpen(true)}>
            <Plus className="size-4" />
            新建问题
          </Button>
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
              className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 dark:text-slate-400 dark:hover:text-slate-200"
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
