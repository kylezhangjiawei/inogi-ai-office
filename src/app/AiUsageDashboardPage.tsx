import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Clock3,
  DatabaseZap,
  FileText,
  Image as ImageIcon,
  Info,
  Loader2,
  MessageSquare,
  RefreshCw,
  Users,
  Video,
} from "lucide-react";
import { toast } from "sonner";

import {
  HorizonEmptyState,
  HorizonMetric,
  HorizonMetricGrid,
  HorizonPageHeader,
  HorizonSectionHeader,
} from "./components/horizon/HorizonPage";
import { Button } from "./components/ui/button";
import { cn } from "./components/ui/utils";
import {
  backfillAiUsage,
  fetchAiUsageDashboard,
  fetchAiUsageDetails,
  type UsageDashboard,
  type UsageDetails,
  type UsageRange,
} from "./lib/aiUsageApi";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "./components/ui/sheet";
import { getUsageRankingPage } from "./lib/usageRankingPagination";

const RANGE_TABS: Array<{ value: UsageRange; label: string }> = [
  { value: "today", label: "今日" },
  { value: "month", label: "本月" },
  { value: "year", label: "本年" },
];

const MODALITY_META: Record<string, { label: string; tone: string }> = {
  chat: { label: "对话", tone: "bg-sky-50 text-sky-700" },
  image: { label: "图片", tone: "bg-amber-50 text-amber-700" },
  video: { label: "视频", tone: "bg-blue-50 text-blue-700" },
  embedding: { label: "向量", tone: "bg-emerald-50 text-emerald-700" },
  document: { label: "文档", tone: "bg-rose-50 text-rose-700" },
};

const RANGE_LABELS: Record<UsageRange, string> = {
  today: "今日",
  month: "本月",
  year: "本年",
};

type UsageDetailTarget = {
  title: string;
  description: string;
  modality?: string;
  model?: string;
  userId?: string;
  date?: string;
};

function modalityMeta(modality: string) {
  return MODALITY_META[modality] ?? {
    label: modality || "其他",
    tone: "bg-slate-100 text-slate-600",
  };
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function RankingPagination({
  page,
  totalItems,
  itemLabel,
  onPageChange,
}: {
  page: number;
  totalItems: number;
  itemLabel: string;
  onPageChange: (page: number) => void;
}) {
  const { safePage, firstItem, lastItem, visiblePages, hasPrevious, hasNext } =
    getUsageRankingPage(totalItems, page);

  return (
    <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/70 px-5 py-3">
      <span className="text-xs text-slate-500">
        第 <span className="tabular-nums text-slate-700">{firstItem}–{lastItem}</span> 条，共{" "}
        <span className="tabular-nums font-semibold text-slate-700">{totalItems}</span> {itemLabel}
      </span>
      <nav className="flex items-center gap-1" aria-label={`${itemLabel}排行分页`}>
        <Button variant="unstyled"
          type="button"
          aria-label="上一页"
          disabled={!hasPrevious}
          onClick={() => onPageChange(safePage - 1)}
          className="flex size-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:border-primary/25 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft className="size-4" />
        </Button>
        {visiblePages.map((pageNumber) => (
          <Button variant="unstyled"
            key={pageNumber}
            type="button"
            aria-label={`第 ${pageNumber} 页`}
            aria-current={safePage === pageNumber ? "page" : undefined}
            onClick={() => onPageChange(pageNumber)}
            className={cn(
              "h-10 min-w-10 rounded-lg px-2 text-xs font-semibold tabular-nums transition-colors",
              safePage === pageNumber
                ? "bg-primary text-white"
                : "border border-slate-200 bg-white text-slate-600 hover:border-primary/25 hover:text-primary",
            )}
          >
            {pageNumber}
          </Button>
        ))}
        <Button variant="unstyled"
          type="button"
          aria-label="下一页"
          disabled={!hasNext}
          onClick={() => onPageChange(safePage + 1)}
          className="flex size-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:border-primary/25 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronRight className="size-4" />
        </Button>
      </nav>
    </div>
  );
}

export function AiUsageDashboardPage() {
  const [range, setRange] = useState<UsageRange>("today");
  const [data, setData] = useState<UsageDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [backfilling, setBackfilling] = useState(false);
  const [detailTarget, setDetailTarget] = useState<UsageDetailTarget | null>(null);
  const [detailData, setDetailData] = useState<UsageDetails | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailPage, setDetailPage] = useState(1);
  const [modelPage, setModelPage] = useState(1);
  const [userPage, setUserPage] = useState(1);
  const detailTriggerRef = useRef<HTMLElement | null>(null);

  function handleRangeChange(nextRange: UsageRange) {
    if (nextRange === range) return;
    setRange(nextRange);
    setData(null);
    setLoadError(null);
    setLoading(true);
    setModelPage(1);
    setUserPage(1);
    setDetailTarget(null);
    setDetailData(null);
    setDetailError(null);
  }

  async function handleBackfill() {
    setBackfilling(true);
    try {
      const r = await backfillAiUsage();
      toast.success(`已回填历史用量：对话 ${r.chat} / 图片 ${r.image} / 视频 ${r.video}`);
      setReloadKey((k) => k + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "回填失败");
    } finally {
      setBackfilling(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    fetchAiUsageDashboard(range)
      .then((d) => !cancelled && setData(d))
      .catch((err) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "读取失败";
        setLoadError(message);
        toast.error(message);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [range, reloadKey]);

  useEffect(() => {
    if (!detailTarget) return;
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    fetchAiUsageDetails({
      range,
      modality: detailTarget.modality,
      model: detailTarget.model,
      user_id: detailTarget.userId,
      date: detailTarget.date,
      page: detailPage,
      page_size: 20,
    })
      .then((details) => {
        if (!cancelled) setDetailData(details);
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "读取明细失败";
        setDetailError(message);
        toast.error(message);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [detailTarget, detailPage, range, reloadKey]);

  function openDetails(target: UsageDetailTarget, trigger?: HTMLElement | null) {
    if (trigger) detailTriggerRef.current = trigger;
    setDetailPage(1);
    setDetailData(null);
    setDetailError(null);
    setDetailTarget(target);
  }

  const maxTrend = useMemo(
    () => Math.max(0, ...(data?.trend ?? []).map((item) => item.calls)),
    [data],
  );
  const maxModelCalls = useMemo(
    () => Math.max(1, ...(data?.by_model ?? []).map((m) => m.calls)),
    [data],
  );

  const modelRows = data?.by_model ?? [];
  const userRows = data?.by_user ?? [];
  const modelPageState = getUsageRankingPage(modelRows.length, modelPage);
  const userPageState = getUsageRankingPage(userRows.length, userPage);
  const visibleModelRows = modelRows.slice(modelPageState.startIndex, modelPageState.endIndex);
  const visibleUserRows = userRows.slice(userPageState.startIndex, userPageState.endIndex);

  const t = data?.totals;
  const detailSummary = detailData?.summary;
  const initialLoading = loading && !data;
  const metricsUnavailable = !data;

  return (
    <main className="horizon-theme hz-page mx-auto flex min-h-full w-full max-w-[1600px] min-w-0 flex-col gap-4 px-3 py-4 sm:p-5 lg:p-6">
      <HorizonPageHeader
        Icon={BarChart3}
        eyebrow="SYSTEM MANAGEMENT · AI USAGE"
        title="AI 使用情况"
        description="统一查看对话、图片与视频模型的调用规模、成本和人员分布。"
        meta={(
          <>
            <span>当前周期：{RANGE_LABELS[range]}</span>
            <span aria-hidden="true">·</span>
            <span>成本为估算口径，仅供运营分析</span>
          </>
        )}
        actions={(
          <>
            <div className="flex rounded-xl border border-slate-200 bg-slate-50 p-1" role="group" aria-label="统计周期">
              {RANGE_TABS.map((item) => (
                <Button variant="unstyled"
                  key={item.value}
                  type="button"
                  aria-pressed={range === item.value}
                  onClick={() => handleRangeChange(item.value)}
                  className={cn(
                    "min-h-9 rounded-lg px-3 text-sm font-semibold transition-colors",
                    range === item.value
                      ? "bg-primary text-white"
                      : "text-slate-600 hover:bg-white hover:text-primary",
                  )}
                >
                  {item.label}
                </Button>
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleBackfill()}
              disabled={backfilling}
              aria-label="从历史业务数据回填 AI 用量日志"
              title="从历史数据回填用量日志（一次性）"
            >
              <DatabaseZap className={cn("size-4", backfilling && "animate-pulse")} />
              {backfilling ? "回填中..." : "回填历史"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => setReloadKey((key) => key + 1)}
              disabled={loading}
              aria-label="刷新 AI 使用数据"
              title="刷新 AI 使用数据"
            >
              <RefreshCw className={cn("size-4", loading && "animate-spin")} />
            </Button>
          </>
        )}
      />

      <HorizonMetricGrid className="!grid-cols-2 xl:!grid-cols-4">
        <Button variant="unstyled"
          type="button"
          className="min-w-0 rounded-xl text-left transition-colors hover:bg-accent/70 [&>.hz-stat]:h-full"
          onClick={(event) => openDetails({ title: "全部 AI 调用", description: `${RANGE_LABELS[range]}全部逐次调用记录` }, event.currentTarget)}
          aria-label="查看全部 AI 调用详情"
        >
          <HorizonMetric Icon={BarChart3} label="总调用" value={metricsUnavailable ? "—" : (t?.calls ?? 0).toLocaleString()} note={metricsUnavailable ? "等待用量数据" : `对话 ${t?.chat_calls ?? 0} · 图片 ${t?.image_calls ?? 0} · 视频 ${t?.video_calls ?? 0}`} tone="brand" />
        </Button>
        <Button variant="unstyled"
          type="button"
          className="min-w-0 rounded-xl text-left transition-colors hover:bg-accent/70 [&>.hz-stat]:h-full"
          onClick={(event) => openDetails({ title: "Token 使用详情", description: `${RANGE_LABELS[range]}逐次调用的输入、输出和总 Token` }, event.currentTarget)}
          aria-label="查看 Token 使用详情"
        >
          <HorizonMetric Icon={MessageSquare} label="Token" value={metricsUnavailable ? "—" : (t?.tokens ?? 0).toLocaleString()} note="对话 Token 为内容长度估算" tone="neutral" />
        </Button>
        <Button variant="unstyled"
          type="button"
          className="min-w-0 rounded-xl text-left transition-colors hover:bg-accent/70 [&>.hz-stat]:h-full"
          onClick={(event) => openDetails({ title: "AI 花费详情", description: `${RANGE_LABELS[range]}逐次调用成本与折合人民币` }, event.currentTarget)}
          aria-label="查看 AI 花费详情"
        >
          <HorizonMetric Icon={Video} label="约合花费" value={metricsUnavailable ? "—" : `¥${t?.cost_cny_approx ?? 0}`} note={metricsUnavailable ? "等待成本数据" : `视频 ¥${t?.video_cost_yuan ?? 0} · 图片 $${t?.image_cost_usd ?? 0}`} tone="warning" />
        </Button>
        <Button variant="unstyled"
          type="button"
          className="min-w-0 rounded-xl text-left transition-colors hover:bg-accent/70 [&>.hz-stat]:h-full"
          onClick={(event) => openDetails({ title: "活跃用户调用详情", description: `${RANGE_LABELS[range]}所有活跃用户的逐次调用记录` }, event.currentTarget)}
          aria-label="查看活跃用户调用详情"
        >
          <HorizonMetric Icon={Users} label="活跃用户" value={metricsUnavailable ? "—" : t?.active_users ?? 0} note={`${RANGE_LABELS[range]}产生调用的成员`} tone="success" />
        </Button>
      </HorizonMetricGrid>

      {initialLoading ? (
        <section className="hz-surface flex min-h-72 items-center justify-center gap-2 text-sm text-slate-500" aria-live="polite">
          <Loader2 className="size-5 animate-spin text-primary" />
          正在加载{RANGE_LABELS[range]}数据...
        </section>
      ) : loadError && !data ? (
        <section className="hz-surface" role="alert">
          <HorizonEmptyState
            Icon={Info}
            title={`暂时无法加载${RANGE_LABELS[range]}数据`}
            description={loadError}
            action={(
              <Button type="button" variant="outline" onClick={() => setReloadKey((key) => key + 1)}>
                <RefreshCw className="size-4" />重新加载
              </Button>
            )}
          />
        </section>
      ) : (
        <>
          <section className="hz-surface overflow-hidden">
            <HorizonSectionHeader
              Icon={Info}
              title="统计口径"
              description="数据来自统一用量日志；图片按美元估算，视频按人民币计费，约合人民币按 7.2 汇率折算，不作为结算依据。"
              trailing={<span className="text-xs text-slate-500">历史缺口可使用“回填历史”补齐</span>}
            />
          </section>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.55fr)]">
            <section className="hz-surface overflow-hidden">
              <HorizonSectionHeader
                Icon={BarChart3}
                title="近 30 天调用趋势"
                description="选择柱形可查看当天逐次调用明细。"
                trailing={<span className="text-xs tabular-nums text-slate-500">峰值 {maxTrend} 次</span>}
              />
              {(data?.trend.length ?? 0) === 0 ? (
                <HorizonEmptyState
                  Icon={BarChart3}
                  title="暂无调用趋势"
                  description="刷新数据或回填历史记录后，这里会显示最近 30 天的调用变化。"
                  action={(
                    <Button type="button" variant="outline" size="sm" onClick={() => setReloadKey((key) => key + 1)}>
                      <RefreshCw className="size-4" />刷新数据
                    </Button>
                  )}
                />
              ) : (
                <div className="p-5">
                  <div className="relative h-40">
                    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between" aria-hidden="true">
                      {[0, 1, 2, 3].map((line) => (
                        <span key={line} className="block border-t border-dashed border-slate-200" />
                      ))}
                    </div>
                    <div className="relative flex h-full items-end gap-1">
                      {(data?.trend ?? []).map((item) => (
                        <Button variant="unstyled"
                          key={item.date}
                          type="button"
                          className="group relative flex h-full min-w-0 flex-1 cursor-pointer items-end rounded-t-md focus-visible:outline-none"
                          title={`${item.date}：${item.calls} 次，点击查看明细`}
                          aria-label={`查看 ${item.date} 的 ${item.calls} 次调用明细`}
                          onClick={(event) => openDetails({
                            title: `${item.date} 调用详情`,
                            description: `当天共 ${item.calls} 次 AI 调用`,
                            date: item.date,
                          }, event.currentTarget)}
                        >
                          <span
                            className={cn(
                              "block w-full rounded-t-md group-hover:bg-primary-hover",
                              item.calls > 0 ? "bg-primary" : "bg-slate-200",
                            )}
                            style={{ height: item.calls > 0 ? `${Math.max(5, (item.calls / Math.max(1, maxTrend)) * 100)}%` : "2px" }}
                          />
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div className="mt-2 flex justify-between text-[11px] tabular-nums text-slate-500">
                    <span>{data?.trend[0]?.date}</span>
                    <span>{data?.trend[(data?.trend.length ?? 1) - 1]?.date}</span>
                  </div>
                </div>
              )}
            </section>

            <section className="hz-surface overflow-hidden">
              <HorizonSectionHeader
                Icon={BarChart3}
                title="调用构成"
                description="按内容类型下钻到逐次调用记录。"
              />
              <div className="grid gap-2 p-4">
                <Button variant="unstyled"
                  type="button"
                  className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-left transition-colors hover:border-primary/25 hover:bg-accent/60"
                  onClick={(event) => openDetails({ title: "对话调用详情", description: `${RANGE_LABELS[range]}对话模型调用记录`, modality: "chat" }, event.currentTarget)}
                >
                  <span className="flex items-center gap-3 text-sm font-semibold text-slate-700"><MessageSquare className="size-4 text-sky-600" />对话调用</span>
                  <span className="flex items-center gap-2 text-sm font-semibold tabular-nums text-slate-900">{t?.chat_calls ?? 0}<ChevronRight className="size-4 text-muted-foreground" /></span>
                </Button>
                <Button variant="unstyled"
                  type="button"
                  className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-left transition-colors hover:border-primary/25 hover:bg-accent/60"
                  onClick={(event) => openDetails({ title: "图片调用详情", description: `${RANGE_LABELS[range]}图片生成调用记录`, modality: "image" }, event.currentTarget)}
                >
                  <span className="flex items-center gap-3 text-sm font-semibold text-slate-700"><ImageIcon className="size-4 text-amber-600" />图片调用</span>
                  <span className="flex items-center gap-2 text-sm font-semibold tabular-nums text-slate-900">{t?.image_calls ?? 0}<ChevronRight className="size-4 text-muted-foreground" /></span>
                </Button>
                <Button variant="unstyled"
                  type="button"
                  className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-left transition-colors hover:border-primary/25 hover:bg-accent/60"
                  onClick={(event) => openDetails({ title: "视频调用详情", description: `${RANGE_LABELS[range]}视频生成调用记录`, modality: "video" }, event.currentTarget)}
                >
                  <span className="flex items-center gap-3 text-sm font-semibold text-slate-700"><Video className="size-4 text-blue-700" />视频调用</span>
                  <span className="flex items-center gap-2 text-sm font-semibold tabular-nums text-slate-900">{t?.video_calls ?? 0}<ChevronRight className="size-4 text-muted-foreground" /></span>
                </Button>
              </div>
            </section>
          </div>

          <div className="grid items-stretch gap-4 lg:grid-cols-2">
            <section className="hz-surface flex min-h-96 flex-col overflow-hidden">
              <HorizonSectionHeader
                Icon={BarChart3}
                title="按模型用量排行"
                description="选择模型查看该模型的逐次调用记录。"
                trailing={<span className="text-xs font-semibold tabular-nums text-slate-600">共 {modelRows.length} 个模型</span>}
              />
              {modelRows.length === 0 ? (
                <HorizonEmptyState
                  Icon={BarChart3}
                  title="当前周期暂无模型调用"
                  description="刷新数据或切换统计周期，查看其他时段的模型使用记录。"
                  action={(
                    <Button type="button" variant="outline" size="sm" onClick={() => setReloadKey((key) => key + 1)}>
                      <RefreshCw className="size-4" />刷新数据
                    </Button>
                  )}
                />
              ) : (
                <div className="min-h-0 flex-1 overflow-y-auto p-4 [scrollbar-gutter:stable]">
                  <div className="space-y-2">
                    {visibleModelRows.map((modelRow) => {
                      const meta = modalityMeta(modelRow.modality);
                      const cost = modelRow.modality === "video"
                        ? `¥${modelRow.cost_yuan}`
                        : modelRow.modality === "image"
                          ? `$${modelRow.cost_usd}`
                          : "—";
                      return (
                        <Button variant="unstyled"
                          key={`${modelRow.modality}-${modelRow.model}`}
                          type="button"
                          onClick={(event) => openDetails({
                            title: `${modelRow.model} 使用详情`,
                            description: `${RANGE_LABELS[range]} ${meta.label}模型逐次调用记录`,
                            modality: modelRow.modality,
                            model: modelRow.model,
                          }, event.currentTarget)}
                          className="block w-full rounded-xl border border-slate-200 p-3 text-left transition-colors hover:border-primary/25 hover:bg-accent/50 focus-visible:outline-none"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className={cn("shrink-0 rounded-full px-2 py-1 text-xs font-semibold", meta.tone)}>{meta.label}</span>
                              <span className="truncate font-mono text-sm font-medium text-slate-800" title={modelRow.model}>{modelRow.model}</span>
                            </div>
                            <div className="shrink-0 text-right text-xs tabular-nums text-slate-500">
                              <span className="text-sm font-bold text-slate-900">{modelRow.calls}</span> 次
                              {modelRow.tokens > 0 ? <span className="ml-2">{modelRow.tokens.toLocaleString()} tok</span> : null}
                              {cost !== "—" ? <span className="ml-2">{cost}</span> : null}
                              <ChevronRight className="ml-1 inline size-4 text-muted-foreground" />
                            </div>
                          </div>
                          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
                            <div className="h-full rounded-full bg-primary" style={{ width: `${(modelRow.calls / maxModelCalls) * 100}%` }} />
                          </div>
                        </Button>
                      );
                    })}
                  </div>
                </div>
              )}
              {modelRows.length > 0 ? (
                <RankingPagination page={modelPageState.safePage} totalItems={modelRows.length} itemLabel="个模型" onPageChange={setModelPage} />
              ) : null}
            </section>

            <section className="hz-surface flex min-h-96 flex-col overflow-hidden">
              <HorizonSectionHeader
                Icon={Users}
                title="按人员用量排行"
                description="选择人员查看该成员在当前周期的逐次调用记录。"
                trailing={<span className="text-xs font-semibold tabular-nums text-slate-600">共 {userRows.length} 位成员</span>}
              />
              {userRows.length === 0 ? (
                <HorizonEmptyState
                  Icon={Users}
                  title="当前周期暂无人员调用"
                  description="刷新数据或切换统计周期，查看其他时段的成员使用记录。"
                  action={(
                    <Button type="button" variant="outline" size="sm" onClick={() => setReloadKey((key) => key + 1)}>
                      <RefreshCw className="size-4" />刷新数据
                    </Button>
                  )}
                />
              ) : (
                <div className="min-h-0 flex-1 overflow-auto px-5 py-4 [scrollbar-gutter:stable]">
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <caption className="sr-only">按人员统计的 AI 使用排行榜，选择人员可查看逐次调用详情。</caption>
                    <thead className="text-xs text-slate-500">
                      <tr>
                        <th scope="col" className="pb-3 pr-2 font-semibold">排名</th>
                        <th scope="col" className="pb-3 pr-2 font-semibold">成员</th>
                        <th scope="col" className="pb-3 pr-2 text-right font-semibold">总调用</th>
                        <th scope="col" className="pb-3 pr-2 text-right font-semibold">对话</th>
                        <th scope="col" className="pb-3 pr-2 text-right font-semibold">图片</th>
                        <th scope="col" className="pb-3 pr-2 text-right font-semibold">视频</th>
                        <th scope="col" className="pb-3 pr-2 text-right font-semibold">Token</th>
                        <th scope="col" className="pb-3 text-right font-semibold">约合花费</th>
                        <th scope="col" className="w-8 pb-3"><span className="sr-only">查看详情</span></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {visibleUserRows.map((userRow, index) => {
                        const userDetails = {
                          title: `${userRow.name} 的 AI 使用详情`,
                          description: `${userRow.department ? `${userRow.department} · ` : ""}${RANGE_LABELS[range]}逐次调用记录`,
                          userId: userRow.user_id,
                        } satisfies UsageDetailTarget;
                        return (
                          <tr
                            key={userRow.user_id}
                            tabIndex={0}
                            aria-label={`查看 ${userRow.name} 的 AI 使用详情，按 Enter 或空格打开`}
                            onClick={(event) => openDetails(userDetails, event.currentTarget)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                openDetails(userDetails, event.currentTarget);
                              }
                            }}
                            className="cursor-pointer text-slate-700 transition-colors hover:bg-accent/50 focus-visible:bg-blue-50/70 focus-visible:outline-none"
                          >
                            <td className="py-3 pr-2 tabular-nums text-slate-500">{userPageState.startIndex + index + 1}</td>
                            <td className="py-3 pr-2">
                              <div className="font-medium text-slate-800">{userRow.name}</div>
                              {userRow.department ? <div className="text-xs text-slate-500">{userRow.department}</div> : null}
                            </td>
                            <td className="py-3 pr-2 text-right font-bold tabular-nums text-slate-900">{userRow.calls}</td>
                            <td className="py-3 pr-2 text-right tabular-nums">{userRow.chat_calls}</td>
                            <td className="py-3 pr-2 text-right tabular-nums">{userRow.image_calls}</td>
                            <td className="py-3 pr-2 text-right tabular-nums">{userRow.video_calls}</td>
                            <td className="py-3 pr-2 text-right tabular-nums text-slate-500">{userRow.tokens ? userRow.tokens.toLocaleString() : "—"}</td>
                            <td className="py-3 text-right tabular-nums text-slate-500">{userRow.cost_cny_approx ? `¥${userRow.cost_cny_approx}` : "—"}</td>
                            <td className="py-3 pl-2"><ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {userRows.length > 0 ? (
                <RankingPagination page={userPageState.safePage} totalItems={userRows.length} itemLabel="位成员" onPageChange={setUserPage} />
              ) : null}
            </section>
          </div>
        </>
      )}

      <Sheet
        open={Boolean(detailTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setDetailTarget(null);
            setDetailData(null);
            setDetailError(null);
          }
        }}
      >
        <SheetContent
          className="horizon-portal w-full gap-0 overflow-hidden p-0 sm:max-w-[760px]"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const trigger = detailTriggerRef.current;
            detailTriggerRef.current = null;
            if (trigger?.isConnected) trigger.focus();
          }}
        >
          <SheetHeader className="border-b border-slate-200 bg-white px-6 py-5 pr-12 text-left">
            <SheetTitle className="text-balance text-xl text-[#1b2559]">{detailTarget?.title ?? "AI 使用详情"}</SheetTitle>
            <SheetDescription className="mt-1 text-pretty text-xs text-slate-500">
              {detailTarget?.description ?? "逐次调用明细"}
            </SheetDescription>
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-y-auto bg-[#f4f7fe] px-5 py-5 sm:px-6">
            {detailLoading && !detailData ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <div key={index} className="h-20 animate-pulse rounded-xl bg-white" />
                  ))}
                </div>
                <div className="h-72 animate-pulse rounded-2xl bg-white" />
              </div>
            ) : detailError && !detailData ? (
              <section className="hz-surface">
                <HorizonEmptyState
                  Icon={Info}
                  title="调用明细加载失败"
                  description={detailError}
                  action={(
                    <Button type="button" variant="outline" size="sm" onClick={() => setReloadKey((key) => key + 1)}>
                      <RefreshCw className="size-4" />重新加载
                    </Button>
                  )}
                />
              </section>
            ) : detailData ? (
              <div className="space-y-4">
                <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="text-xs text-muted-foreground">调用次数</div>
                    <div className="mt-1 text-xl font-bold tabular-nums text-slate-900">{detailSummary?.calls ?? 0}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="text-xs text-muted-foreground">对话 / 图片 / 视频</div>
                    <div className="mt-1 text-sm font-bold tabular-nums text-slate-900">
                      {detailSummary?.chat_calls ?? 0} / {detailSummary?.image_calls ?? 0} / {detailSummary?.video_calls ?? 0}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="text-xs text-muted-foreground">总 Token</div>
                    <div className="mt-1 text-xl font-bold tabular-nums text-slate-900">
                      {(detailSummary?.total_tokens ?? 0).toLocaleString()}
                    </div>
                    <div className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                      输入 {(detailSummary?.prompt_tokens ?? 0).toLocaleString()} · 输出 {(detailSummary?.completion_tokens ?? 0).toLocaleString()}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="text-xs text-muted-foreground">约合花费</div>
                    <div className="mt-1 text-xl font-bold tabular-nums text-slate-900">¥{detailSummary?.cost_cny_approx ?? 0}</div>
                    <div className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                      视频 ¥{detailSummary?.cost_yuan ?? 0} · 图片 ${detailSummary?.cost_usd ?? 0}
                    </div>
                  </div>
                </section>

                <section className="hz-surface overflow-hidden">
                  <HorizonSectionHeader
                    Icon={FileText}
                    title="逐次调用记录"
                    description={`共 ${detailData.pagination.total} 条，按调用时间倒序`}
                    trailing={detailLoading ? <Loader2 className="size-4 animate-spin text-primary" aria-label="正在刷新调用明细" /> : null}
                  />

                  {detailError ? <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800" role="alert">{detailError}</div> : null}

                  {detailData.items.length === 0 ? (
                    <HorizonEmptyState
                      Icon={FileText}
                      title="当前筛选条件下暂无调用记录"
                      description="可返回全部调用范围，继续查看当前周期的其他调用。"
                      action={(
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => openDetails({ title: "全部 AI 调用", description: `${RANGE_LABELS[range]}全部逐次调用记录` })}
                        >
                          查看全部调用
                        </Button>
                      )}
                    />
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {detailData.items.map((item) => {
                        const meta = modalityMeta(item.modality);
                        const originalCost =
                          item.cost_yuan > 0
                            ? `¥${item.cost_yuan}`
                            : item.cost_usd > 0
                              ? `$${item.cost_usd}`
                              : "—";
                        return (
                          <article key={item.id} className="px-4 py-4 transition-colors hover:bg-slate-50/70">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className={cn("rounded-full px-2 py-1 text-xs font-semibold", meta.tone)}>{meta.label}</span>
                                  <span className="truncate font-mono text-sm font-semibold text-slate-900" title={item.model}>
                                    {item.model}
                                  </span>
                                  {item.estimated && (
                                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">估算</span>
                                  )}
                                </div>
                                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                                  <span className="font-medium text-slate-700">{item.user_name}</span>
                                  {item.department && <span>{item.department}</span>}
                                  <span className="inline-flex items-center gap-1">
                                    <Clock3 className="h-3 w-3" />
                                    {formatDateTime(item.created_at)}
                                  </span>
                                </div>
                              </div>
                              <div className="shrink-0 text-right tabular-nums">
                                <div className="text-sm font-bold text-slate-900">
                                  {item.total_tokens > 0 ? `${item.total_tokens.toLocaleString()} Token` : originalCost}
                                </div>
                                <div className="mt-0.5 text-[11px] text-muted-foreground">
                                  约合 ¥{item.cost_cny_approx}
                                  {item.seconds > 0 ? ` · ${item.seconds}s` : ""}
                                </div>
                              </div>
                            </div>

                            <div className="mt-3 grid gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-[11px] tabular-nums text-slate-500 sm:grid-cols-2">
                              <div>
                                <span className="text-muted-foreground">Token：</span>
                                输入 {item.prompt_tokens.toLocaleString()} · 输出 {item.completion_tokens.toLocaleString()}
                              </div>
                              <div>
                                <span className="text-muted-foreground">成本：</span>
                                {originalCost} · 折合 ¥{item.cost_cny_approx}
                              </div>
                              <div>
                                <span className="text-muted-foreground">服务商 / 来源：</span>
                                {item.provider || "—"} / {item.source || "—"}
                              </div>
                              <div className="min-w-0">
                                <span className="text-muted-foreground">关联业务 ID：</span>
                                <span className="break-all font-mono">{item.ref_id || "—"}</span>
                              </div>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}

                  {detailData.pagination.total_pages > 1 && (
                    <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
                      <Button variant="unstyled"
                        type="button"
                        onClick={() => setDetailPage((page) => Math.max(1, page - 1))}
                        disabled={detailPage <= 1 || detailLoading}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                        上一页
                      </Button>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        第 {detailData.pagination.page} / {detailData.pagination.total_pages} 页
                      </span>
                      <Button variant="unstyled"
                        type="button"
                        onClick={() => setDetailPage((page) => Math.min(detailData.pagination.total_pages, page + 1))}
                        disabled={detailPage >= detailData.pagination.total_pages || detailLoading}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        下一页
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </section>
              </div>
            ) : (
              <section className="hz-surface">
                <HorizonEmptyState
                  Icon={FileText}
                  title="尚未选择调用范围"
                  description="关闭详情后，从 KPI、趋势或排行榜选择需要查看的数据。"
                />
              </section>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </main>
  );
}
