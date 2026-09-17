/**
 * 问题记录与 AI 定位 — 列表视图（主内容区，嵌入 App 外壳，自身不画侧栏）。
 *
 * 自上而下：概览统计带 → 工具栏（状态分段 + 新建）→ 筛选（搜索 + 来源）→ 列表(表格) / 可复用(卡片) → 分页。
 * 所有列表数据经 service.list(query)；query 变更即重取。视觉原子全部复用 ./badges。
 */
import * as React from "react";
import {
  Archive,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock3,
  Database,
  ListChecks,
  Plus,
  ScanSearch,
  Search,
  X,
} from "lucide-react";
import {
  HorizonEmptyState,
  HorizonMetric,
  HorizonMetricGrid,
  HorizonPageHeader,
} from "../components/horizon/HorizonPage";
import { cn } from "../components/ui/utils";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { usePermission } from "../hooks/usePermission";
import { useAuth } from "../auth";
import {
  type Issue,
  type IssueQuery,
  type IssueService,
  type IssueStats,
  type Paged,
} from "../lib/issue/types";
import { STATUS_GROUP_LABEL } from "../lib/issue/config";
import { t, useI18n } from "../lib/i18n";
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
  "rounded-xl border border-slate-200 bg-white shadow-sm";

/**
 * 创建人头像：有真实头像 URL（src）则显示照片，否则用姓名首字占位。
 * Issue 数据本身不含创建人头像，仅当创建人为当前登录用户时可拿到其 avatarUrl。尺寸由 className 传入。
 */
function InitialAvatar({ name, src, className }: { name: string; src?: string | null; className?: string }) {
  if (src) {
    return <img src={src} alt={name} className={cn("rd-horizon-issue-avatar shrink-0 rounded-full object-cover", className)} />;
  }
  const ch = (name ?? "").trim().charAt(0) || "?";
  return (
    <span
      aria-hidden
      className={cn(
        "rd-horizon-issue-avatar flex shrink-0 items-center justify-center rounded-full bg-accent font-semibold text-primary",
        className,
      )}
    >
      {ch}
    </span>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 概览统计带
// ────────────────────────────────────────────────────────────────────────────
function StatsBand({ stats, error }: { stats: IssueStats | null; error: string | null }) {
  const loadingNote = error ? t("统计数据暂不可用") : t("正在读取统计数据");
  const reusePct = stats ? Math.round(stats.reuseRate * 100) : null;
  const avg = stats?.avgLocateHours;
  const avgStr = avg == null ? null : Number.isInteger(avg) ? String(avg) : avg.toFixed(1);
  return (
    <HorizonMetricGrid className="!grid-cols-2 lg:!grid-cols-5">
      <HorizonMetric Icon={Database} label={t("问题总数")} value={stats?.total ?? "—"} note={stats ? t("问题记录累计总量") : loadingNote} />
      <HorizonMetric Icon={ClipboardList} label={t("待处理")} value={stats?.pending ?? "—"} note={stats ? t("等待定位或处理") : loadingNote} tone="warning" />
      <HorizonMetric Icon={ListChecks} label={t("已解决")} value={stats?.solved ?? "—"} note={stats ? t("已完成闭环的问题") : loadingNote} tone="success" />
      <HorizonMetric Icon={Archive} label={t("方案复用率")} value={reusePct == null ? "—" : `${reusePct}%`} note={stats ? t("已沉淀方案复用占比") : loadingNote} tone="brand" />
      <HorizonMetric Icon={Clock3} label={t("平均定位时长")} value={avgStr == null ? "—" : `${avgStr}h`} note={stats ? t("问题根因平均定位耗时") : loadingNote} />
    </HorizonMetricGrid>
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
    <span className="rd-horizon-issue-active-filter inline-flex items-center gap-1 rounded-md border border-primary/20 bg-accent py-0.5 pl-2 pr-1 text-xs text-primary">
      {label}
      <Button variant="unstyled"
        type="button"
        onClick={onClear}
        aria-label={t("清除该筛选")}
        className="cursor-pointer rounded-sm p-0.5 hover:bg-[#e4ebff] focus-visible:outline-none"
      >
        <X className="size-3" />
      </Button>
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
  const { user } = useAuth();
  const norm = (s?: string | null) => (s ?? "").trim().toLowerCase();
  // 创建人为当前登录用户时用其真实头像；其余用姓名首字（Issue 数据不含他人头像）。
  const avatarFor = (createdBy: string): string | null =>
    user && norm(createdBy) === norm(user.name) ? user.avatarUrl : null;
  return (
    <div className="rd-horizon-issue-rows space-y-2" data-view="issues">
      {items.map((it) => (
        <Button variant="unstyled"
          key={it.id}
          type="button"
          onClick={() => onOpen(it.id)}
          data-issue-id={it.id}
          data-status={it.status}
          data-severity={it.severity}
          className={cn(
            cardClass,
            "rd-horizon-issue-row group grid w-full cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:border-primary/30 hover:bg-[#fbfcff] focus-visible:outline-none",
          )}
        >
          {/* 头像（创建人，最前）：本人显示真实头像，其余首字 */}
          <InitialAvatar name={it.createdBy} src={avatarFor(it.createdBy)} className="size-9 text-sm" />

          {/* 中间：编号 + 来源 + 标题 + 创建人/产品/工位 */}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Mono className="text-[11px] font-semibold text-muted-foreground">{it.id}</Mono>
              <SourceTag value={it.source} />
            </div>
            <div className="mt-1 truncate text-sm font-semibold text-slate-800 group-hover:text-primary">
              {it.title}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-slate-500">
              <span className="truncate font-medium text-slate-600">{it.createdBy}</span>
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
            <Mono className="text-xs text-muted-foreground">{formatDate(it.createdAt)}</Mono>
          </div>
        </Button>
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
    <div className="rd-horizon-issue-reusable-grid grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" data-view="reusable">
      {items.map((it) => {
        const adopted = it.adopted;
        const adoptedAnalysis = it.analyses.find((a) => a.isAdopted);
        const adoptedCause =
          adopted?.kind === "analysis" && adoptedAnalysis
            ? adoptedAnalysis.content.possibleCauses.find(
                (c) => c.id === adopted.causeId,
              )
            : undefined;
        const adoptedSolution = adoptedCause?.solutions.find(
          (s) => adopted?.kind === "analysis" && s.id === adopted.solutionId,
        );
        const summary =
          adoptedSolution?.action ??
          adoptedAnalysis?.summary ??
          (adopted?.kind === "reuse"
            ? t("复用自 {id}", { id: adopted.reusedFrom })
            : t("已沉淀可复用方案"));
        return (
          <Button variant="unstyled"
            key={it.id}
            type="button"
            onClick={() => onOpen(it.id)}
            data-issue-id={it.id}
            data-status={it.status}
            data-severity={it.severity}
            className={cn(
              cardClass,
              "rd-horizon-issue-reusable-card flex min-h-[12rem] cursor-pointer flex-col gap-2 p-4 text-left transition-colors duration-150 hover:border-primary/30 hover:bg-[#fbfcff] focus-visible:outline-none",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <Mono className="text-xs text-muted-foreground">{it.id}</Mono>
              <span className="rd-horizon-issue-reusable-badge inline-flex items-center gap-1 rounded-md border border-primary/20 bg-accent px-2 py-0.5 text-xs font-medium text-primary">
                {t("可复用")}
              </span>
            </div>
            <div className="rd-horizon-issue-reusable-title line-clamp-2 text-sm font-medium text-slate-800">
              {it.title}
            </div>
            <div className="rd-horizon-issue-reuse-suggestion mt-1 rounded-lg border border-slate-100 bg-slate-50/70 p-2.5">
              <div className="mb-1 flex items-center gap-1.5">
                <span className="text-xs font-medium text-primary">
                  {t("采纳方案")}
                </span>
                {adoptedSolution ? (
                  <SolutionTypeBadge value={adoptedSolution.type} />
                ) : null}
              </div>
              <p className="line-clamp-3 text-pretty text-xs text-slate-600">
                {summary}
              </p>
            </div>
            <div className="mt-auto flex items-center gap-1.5 pt-1 text-xs text-muted-foreground">
              <SourceTag value={it.source} />
              {it.product ? (
                <>
                  <span aria-hidden>·</span>
                  <span>{it.product}</span>
                </>
              ) : null}
            </div>
          </Button>
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
    <div className="rd-horizon-issue-pagination flex flex-wrap items-center justify-between gap-3 px-1">
      <span className="text-xs text-slate-500">
        {t("共")} <Mono>{total}</Mono> {t("条 · 第")} <Mono>{from}</Mono>–<Mono>{to}</Mono> {t("条")}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="unstyled"
          type="button"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          className="inline-flex h-7 cursor-pointer items-center gap-0.5 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-600 transition-colors duration-150 hover:border-primary/25 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none"
        >
          <ChevronLeft className="size-3.5" />
          {t("上一页")}
        </Button>
        {pages.map((p) => (
          <Button variant="unstyled"
            key={p}
            type="button"
            onClick={() => onPage(p)}
            aria-current={p === page ? "page" : undefined}
            className={cn(
              "inline-flex h-7 min-w-7 cursor-pointer items-center justify-center rounded-md border px-1.5 text-xs transition-colors duration-150 focus-visible:outline-none",
              p === page
                ? "border-primary/30 bg-accent font-medium text-primary"
                : "border-slate-200 bg-white text-slate-600 hover:border-primary/25 hover:text-primary",
            )}
          >
            <Mono>{p}</Mono>
          </Button>
        ))}
        <Button variant="unstyled"
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
          className="inline-flex h-7 cursor-pointer items-center gap-0.5 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-600 transition-colors duration-150 hover:border-primary/25 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none"
        >
          {t("下一页")}
          <ChevronRight className="size-3.5" />
        </Button>
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
  restoreFocusIssueId,
  onFocusRestored,
}: {
  service: IssueService;
  onOpen: (id: string) => void;
  restoreFocusIssueId?: string | null;
  onFocusRestored?: () => void;
}) {
  useI18n();
  const canCreate = usePermission("issue:create");
  const pageRef = React.useRef<HTMLDivElement | null>(null);
  const pageHeadingRef = React.useRef<HTMLSpanElement | null>(null);
  const restoredIssueIdRef = React.useRef<string | null>(null);
  const [stats, setStats] = React.useState<IssueStats | null>(null);
  const [statsError, setStatsError] = React.useState<string | null>(null);

  const [query, setQuery] = React.useState<IssueQuery>({
    statusGroup: "all",
    page: 1,
    pageSize: PAGE_SIZE,
  });
  const [paged, setPaged] = React.useState<Paged<Issue> | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [searchText, setSearchText] = React.useState("");
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const drawerOpenerRef = React.useRef<HTMLButtonElement | null>(null);

  const openDrawer = React.useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    drawerOpenerRef.current = event.currentTarget;
    setDrawerOpen(true);
  }, []);

  // 稳定的 patch：变更任意筛选都回到第 1 页。
  const patchQuery = React.useCallback((patch: Partial<IssueQuery>) => {
    setQuery((q) => ({ ...q, ...patch, page: 1 }));
  }, []);

  // 概览统计：初次加载 + 抽屉关闭后（可能新建）刷新。
  const loadAux = React.useCallback(() => {
    setStatsError(null);
    void service.stats().then(setStats).catch((error: unknown) => {
      setStatsError(error instanceof Error ? error.message : t("统计数据加载失败"));
    });
  }, [service]);

  React.useEffect(() => {
    loadAux();
  }, [loadAux]);

  // 列表数据：query 变更即重取。
  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError(null);
    void service.list(query).then((res) => {
      if (alive) setPaged(res);
    }).catch((error: unknown) => {
      if (alive) setLoadError(error instanceof Error ? error.message : t("问题记录加载失败"));
    }).finally(() => {
      if (alive) setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [service, query]);

  const statusGroup = query.statusGroup ?? "all";
  const isReusableView = statusGroup === "reusable";

  const hasSearchFilter = Boolean(query.search);
  const hasActiveFilter = statusGroup !== "all" || hasSearchFilter;

  const applySearch = () => {
    const v = searchText.trim();
    patchQuery({ search: v || undefined });
  };

  const clearSearchFilter = () => {
    setSearchText("");
    setQuery((q) => ({
      statusGroup: q.statusGroup,
      page: 1,
      pageSize: PAGE_SIZE,
    }));
  };

  const resetFilters = () => {
    setSearchText("");
    setQuery({ statusGroup: "all", page: 1, pageSize: PAGE_SIZE });
  };

  const reloadList = () => {
    setQuery((current) => ({ ...current }));
  };

  const items = paged?.items ?? [];
  const total = paged?.total ?? 0;

  // 从详情返回时，优先回到原行/卡片；筛选或分页已使它不在当前结果时，回到清单标题保留页面上下文。
  React.useEffect(() => {
    if (!restoreFocusIssueId) {
      restoredIssueIdRef.current = null;
      return;
    }
    if (loading || !paged || restoredIssueIdRef.current === restoreFocusIssueId) return;

    const issueTarget = Array.from(
      pageRef.current?.querySelectorAll<HTMLElement>("[data-issue-id]") ?? [],
    ).find((node) => node.dataset.issueId === restoreFocusIssueId);

    if (issueTarget) issueTarget.focus();
    else pageHeadingRef.current?.focus();

    restoredIssueIdRef.current = restoreFocusIssueId;
    onFocusRestored?.();
  }, [loading, onFocusRestored, paged, restoreFocusIssueId]);

  return (
    <div
      ref={pageRef}
      className="horizon-theme hz-page rd-horizon-issue-list-page flex min-w-0 flex-col gap-4"
      data-page="issue-ai-list"
    >
      <HorizonPageHeader
        Icon={ScanSearch}
        eyebrow={t("质量闭环 / AI 根因定位")}
        title={(
          <span ref={pageHeadingRef} tabIndex={-1} className="rounded-sm outline-none">
            {t("问题记录与 AI 定位")}
          </span>
        )}
        description={t("统一记录研发与生产异常，复用历史方案，并通过 AI 根因分析形成可追溯的处理闭环。")}
        meta={t("清单、相似复用、分析版本与处理留痕使用同一问题数据源")}
        actions={canCreate ? (
          <Button
            size="sm"
            onClick={openDrawer}
            className="hz-primary-action rd-horizon-issue-primary-action cursor-pointer"
          >
            <Plus className="size-4" />
            {t("新建问题")}
          </Button>
        ) : undefined}
      />

      {/* 1) 概览统计带 */}
      <div className="shrink-0" aria-busy={!stats && !statsError}>
        <StatsBand stats={stats} error={statsError} />
        {statsError && (
          <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-red-600">
            <span>{t("统计数据加载失败：")}{statsError}</span>
            <Button type="button" size="sm" variant="outline" onClick={loadAux}>
              {t("重新加载统计")}
            </Button>
          </div>
        )}
      </div>

      {/* 2) 工具栏 / 筛选 */}
      <section className="hz-surface rd-horizon-issue-filters shrink-0 overflow-hidden" data-surface="filters">
        <div className="hz-toolbar flex flex-wrap items-center gap-2 border-b border-slate-200/70 p-3">
          {/* 状态分段 */}
          <div
            className="rd-horizon-issue-status-tabs inline-flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-white p-1"
            role="group"
            aria-label={t("状态筛选")}
          >
            {STATUS_GROUP_ORDER.map((key) => {
              const active = statusGroup === key;
              return (
                <Button variant="unstyled"
                  key={key}
                  type="button"
                  onClick={() => patchQuery({ statusGroup: key })}
                  data-status-group={key}
                  data-active={active || undefined}
                  aria-pressed={active}
                  className={cn(
                    "h-8 cursor-pointer rounded-md px-3 text-xs font-medium transition-colors duration-150 focus-visible:outline-none",
                    active
                      ? "bg-primary text-white shadow-sm"
                      : "text-slate-500 hover:bg-slate-50 hover:text-slate-800",
                  )}
                >
                  {t(STATUS_GROUP_LABEL[key])}
                </Button>
              );
            })}
          </div>

          {/* 搜索（推到右侧，与新建相邻） */}
          <div className="rd-horizon-issue-search relative ml-auto w-full max-w-[18rem]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              onBlur={applySearch}
              onKeyDown={(e) => {
                if (e.key === "Enter") applySearch();
              }}
              placeholder={t("搜索标题 / 编号 / 产品 / 描述")}
              aria-label={t("搜索标题 / 编号 / 产品 / 描述")}
              className="h-9 border-slate-300 bg-white pl-8 text-xs shadow-sm focus-visible:border-primary"
            />
          </div>
        </div>

        {/* 活动搜索标签 */}
        {hasSearchFilter ? (
          <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
            {query.search ? (
              <ActiveTag
                label={<>{t("搜索：")}{query.search}</>}
                onClear={() => {
                  setSearchText("");
                  patchQuery({ search: undefined });
                }}
              />
            ) : null}
            <Button variant="unstyled"
              type="button"
              onClick={clearSearchFilter}
              className="inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-0.5 text-xs text-slate-500 underline-offset-2 hover:text-primary hover:underline focus-visible:outline-none"
            >
              {t("清除筛选")}
            </Button>
          </div>
        ) : null}
      </section>

      {/* 3) 列表主体 + 分页：内容自然流动（列表项卡片，数据少不撑空），分页紧跟列表 */}
      <section
        className="rd-horizon-issue-list-surface flex flex-col gap-3"
        data-surface="issue-list"
        data-view={isReusableView ? "reusable" : "issues"}
        aria-busy={loading}
      >
        {loadError ? (
          <div className={cn(cardClass, "rd-horizon-issue-list-state")} role="alert">
            <HorizonEmptyState
              Icon={AlertCircle}
              title={t("问题记录加载失败")}
              description={loadError}
              action={(
                <Button type="button" size="sm" variant="outline" onClick={reloadList}>
                  {t("重新加载列表")}
                </Button>
              )}
            />
          </div>
        ) : loading && !paged ? (
          <div className={cn(cardClass, "rd-horizon-issue-list-state")} role="status" aria-live="polite">
            <HorizonEmptyState
              Icon={Database}
              title={t("正在加载问题记录")}
              description={t("正在同步问题清单与当前筛选结果，请稍候。")}
            />
          </div>
        ) : total === 0 ? (
          <div className={cn(cardClass, "rd-horizon-issue-list-state")} role="status" aria-live="polite">
            <HorizonEmptyState
              Icon={isReusableView ? Archive : Search}
              title={t("未找到匹配的问题")}
              description={hasActiveFilter ? t("调整或清除筛选条件，查看其他问题记录。") : t("当前还没有问题记录，可以从现场异常开始建立第一条闭环。")}
              action={hasActiveFilter ? (
                <Button type="button" size="sm" variant="outline" onClick={resetFilters}>
                  {t("清除筛选")}
                </Button>
              ) : canCreate ? (
                <Button type="button" size="sm" className="hz-primary-action" onClick={openDrawer}>
                  <Plus className="size-4" />
                  {t("新建问题")}
                </Button>
              ) : (
                <Button type="button" size="sm" variant="outline" onClick={reloadList}>
                  {t("刷新列表")}
                </Button>
              )}
            />
          </div>
        ) : (
          <div className={cn("flex flex-col gap-3", loading && "opacity-60")}>
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
        returnFocusRef={drawerOpenerRef}
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
