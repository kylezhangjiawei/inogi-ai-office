import { useEffect, useMemo, useState } from "react";
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

const RANGE_TABS: Array<{ value: UsageRange; label: string }> = [
  { value: "today", label: "今日" },
  { value: "month", label: "本月" },
  { value: "year", label: "本年" },
];

const MODALITY_META: Record<string, { label: string; tone: string }> = {
  chat: { label: "对话", tone: "bg-sky-50 text-sky-700" },
  image: { label: "图片", tone: "bg-amber-50 text-amber-700" },
  video: { label: "视频", tone: "bg-violet-50 text-violet-700" },
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

function StatCard({
  icon,
  label,
  value,
  sub,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group rounded-2xl border border-slate-200 bg-white p-4 text-left transition-all hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
      aria-label={`查看${label}详情`}
    >
      <div className="flex items-center justify-between gap-2 text-xs font-medium text-slate-500">
        <span className="flex items-center gap-2">
          {icon}
          {label}
        </span>
        <ChevronRight className="h-3.5 w-3.5 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-indigo-500" />
      </div>
      <div className="mt-2 text-2xl font-bold tracking-tight text-slate-900">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
    </button>
  );
}

export function AiUsageDashboardPage() {
  const [range, setRange] = useState<UsageRange>("today");
  const [data, setData] = useState<UsageDashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [backfilling, setBackfilling] = useState(false);
  const [detailTarget, setDetailTarget] = useState<UsageDetailTarget | null>(null);
  const [detailData, setDetailData] = useState<UsageDetails | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailPage, setDetailPage] = useState(1);

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
    fetchAiUsageDashboard(range)
      .then((d) => !cancelled && setData(d))
      .catch((err) => !cancelled && toast.error(err instanceof Error ? err.message : "读取失败"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [range, reloadKey]);

  useEffect(() => {
    if (!detailTarget) return;
    let cancelled = false;
    setDetailLoading(true);
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
        if (!cancelled) toast.error(err instanceof Error ? err.message : "读取明细失败");
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [detailTarget, detailPage, range, reloadKey]);

  function openDetails(target: UsageDetailTarget) {
    setDetailPage(1);
    setDetailData(null);
    setDetailTarget(target);
  }

  const maxTrend = useMemo(
    () => Math.max(1, ...(data?.trend ?? []).map((t) => t.calls)),
    [data],
  );
  const maxModelCalls = useMemo(
    () => Math.max(1, ...(data?.by_model ?? []).map((m) => m.calls)),
    [data],
  );

  const t = data?.totals;
  const detailSummary = detailData?.summary;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="material-card p-6 md:p-8">
        <span className="material-chip bg-indigo-50 text-indigo-700">AI Usage</span>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-[2rem] font-bold tracking-tight text-slate-900">
            <BarChart3 className="h-7 w-7 text-indigo-600" />
            AI 使用情况
          </h2>
          <div className="flex items-center gap-2">
            <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
              {RANGE_TABS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setRange(r.value)}
                  className={cn(
                    "rounded-lg px-4 py-1.5 text-sm font-medium transition-colors",
                    range === r.value ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700",
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="material-button-secondary w-fit"
              onClick={() => void handleBackfill()}
              disabled={backfilling}
              title="从历史数据回填用量日志（一次性）"
            >
              <DatabaseZap className={cn("h-4 w-4", backfilling && "animate-pulse")} />
              {backfilling ? "回填中..." : "回填历史"}
            </button>
            <button
              type="button"
              className="material-button-secondary w-fit"
              onClick={() => setReloadKey((k) => k + 1)}
              disabled={loading}
              title="刷新"
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </button>
          </div>
        </div>
        <div className="mt-3 flex items-start gap-2 rounded-xl bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          <span>
            数据来自统一用量日志。口径：<b>对话</b> token 为按内容长度的估算值、<b>图片</b>为成本估算（$）、
            <b>视频</b>为实际计费（¥）。「约合¥」将图片 $ 按约 7.2 汇率折算后与视频 ¥ 合计，仅供参考、非结算价。
            历史数据需管理员点一次「回填历史」。
          </span>
        </div>
      </section>

      {/* 汇总卡片 */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-7">
        <StatCard
          icon={<BarChart3 className="h-4 w-4" />}
          label="总调用"
          value={String(t?.calls ?? 0)}
          onClick={() => openDetails({ title: "全部 AI 调用", description: `${RANGE_LABELS[range]}全部逐次调用记录` })}
        />
        <StatCard
          icon={<MessageSquare className="h-4 w-4" />}
          label="对话"
          value={String(t?.chat_calls ?? 0)}
          onClick={() => openDetails({ title: "对话调用详情", description: `${RANGE_LABELS[range]}对话模型调用记录`, modality: "chat" })}
        />
        <StatCard
          icon={<ImageIcon className="h-4 w-4" />}
          label="图片"
          value={String(t?.image_calls ?? 0)}
          onClick={() => openDetails({ title: "图片调用详情", description: `${RANGE_LABELS[range]}图片生成调用记录`, modality: "image" })}
        />
        <StatCard
          icon={<Video className="h-4 w-4" />}
          label="视频"
          value={String(t?.video_calls ?? 0)}
          onClick={() => openDetails({ title: "视频调用详情", description: `${RANGE_LABELS[range]}视频生成调用记录`, modality: "video" })}
        />
        <StatCard
          icon={<BarChart3 className="h-4 w-4" />}
          label="Token"
          value={(t?.tokens ?? 0).toLocaleString()}
          sub="对话为估算"
          onClick={() => openDetails({ title: "Token 使用详情", description: `${RANGE_LABELS[range]}逐次调用的输入、输出和总 Token` })}
        />
        <StatCard
          icon={<Video className="h-4 w-4" />}
          label="约合花费"
          value={`¥${t?.cost_cny_approx ?? 0}`}
          sub={`视频¥${t?.video_cost_yuan ?? 0} · 图片$${t?.image_cost_usd ?? 0}`}
          onClick={() => openDetails({ title: "AI 花费详情", description: `${RANGE_LABELS[range]}逐次调用成本与折合人民币` })}
        />
        <StatCard
          icon={<Users className="h-4 w-4" />}
          label="活跃用户"
          value={String(t?.active_users ?? 0)}
          onClick={() => openDetails({ title: "活跃用户调用详情", description: `${RANGE_LABELS[range]}所有活跃用户的逐次调用记录` })}
        />
      </div>

      {/* 近30天趋势 */}
      <section className="material-card p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-slate-900">近 30 天调用趋势</h3>
          <span className="text-xs text-slate-400">点击柱形查看当天明细</span>
        </div>
        <div className="relative h-36">
          <div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
            {[0, 1, 2, 3].map((line) => (
              <span key={line} className="block border-t border-dashed border-slate-100" />
            ))}
          </div>
          <div className="relative flex h-full items-end gap-1">
            {(data?.trend ?? []).map((d) => (
              <button
                key={d.date}
                type="button"
                className="group relative flex h-full flex-1 cursor-pointer items-end rounded-t focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
                title={`${d.date}：${d.calls} 次，点击查看明细`}
                aria-label={`查看 ${d.date} 的 ${d.calls} 次调用明细`}
                onClick={() =>
                  openDetails({
                    title: `${d.date} 调用详情`,
                    description: `当天共 ${d.calls} 次 AI 调用`,
                    date: d.date,
                  })
                }
              >
                <span
                  className={cn(
                    "block w-full rounded-t transition-all group-hover:bg-indigo-600",
                    d.calls > 0 ? "bg-indigo-500/80" : "bg-slate-200",
                  )}
                  style={{
                    height: d.calls > 0 ? `${Math.max(5, (d.calls / maxTrend) * 100)}%` : "2px",
                  }}
                />
              </button>
            ))}
          </div>
        </div>
        <div className="mt-2 flex justify-between text-[10px] text-slate-400">
          <span>{data?.trend?.[0]?.date}</span>
          <span>{data?.trend?.[data.trend.length - 1]?.date}</span>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* 按模型排行 */}
        <section className="material-card p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-lg font-semibold text-slate-900">按模型用量排行</h3>
            <span className="text-xs text-slate-400">点击模型查看明细</span>
          </div>
          {loading && !data ? (
            <div className="flex items-center gap-2 py-10 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" /> 加载中...
            </div>
          ) : (data?.by_model.length ?? 0) === 0 ? (
            <div className="py-10 text-center text-sm text-slate-400">该时间段暂无使用记录</div>
          ) : (
            <div className="space-y-2.5">
              {data!.by_model.map((m) => {
                const meta = modalityMeta(m.modality);
                const cost =
                  m.modality === "video" ? `¥${m.cost_yuan}` : m.modality === "image" ? `$${m.cost_usd}` : "—";
                return (
                  <button
                    key={`${m.modality}-${m.model}`}
                    type="button"
                    onClick={() =>
                      openDetails({
                        title: `${m.model} 使用详情`,
                        description: `${RANGE_LABELS[range]} ${meta.label}模型逐次调用记录`,
                        modality: m.modality,
                        model: m.model,
                      })
                    }
                    className="group block w-full rounded-xl border border-slate-100 p-3 text-left transition-colors hover:border-indigo-200 hover:bg-indigo-50/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className={cn("material-chip shrink-0", meta.tone)}>{meta.label}</span>
                        <span className="truncate font-mono text-sm font-medium text-slate-800" title={m.model}>
                          {m.model}
                        </span>
                      </div>
                      <div className="shrink-0 text-right">
                        <span className="text-sm font-bold text-slate-900">{m.calls}</span>
                        <span className="ml-1 text-xs text-slate-400">次</span>
                        {m.tokens > 0 && <span className="ml-2 text-xs text-slate-400">{m.tokens.toLocaleString()} tok</span>}
                        {cost !== "—" && <span className="ml-2 text-xs text-slate-500">{cost}</span>}
                        <ChevronRight className="ml-1 inline h-3.5 w-3.5 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-indigo-500" />
                      </div>
                    </div>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-indigo-500"
                        style={{ width: `${(m.calls / maxModelCalls) * 100}%` }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* 按人员排行 */}
        <section className="material-card p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-lg font-semibold text-slate-900">按人员用量排行</h3>
            <span className="text-xs text-slate-400">点击人员查看明细</span>
          </div>
          {loading && !data ? (
            <div className="flex items-center gap-2 py-10 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" /> 加载中...
            </div>
          ) : (data?.by_user.length ?? 0) === 0 ? (
            <div className="py-10 text-center text-sm text-slate-400">该时间段暂无使用记录</div>
          ) : (
            <div className="material-scrollbar overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-slate-400">
                  <tr>
                    <th className="pb-2 pr-2 font-medium">#</th>
                    <th className="pb-2 pr-2 font-medium">成员</th>
                    <th className="pb-2 pr-2 text-right font-medium">总调用</th>
                    <th className="pb-2 pr-2 text-right font-medium">对话</th>
                    <th className="pb-2 pr-2 text-right font-medium">图片</th>
                    <th className="pb-2 pr-2 text-right font-medium">视频</th>
                    <th className="pb-2 pr-2 text-right font-medium">Token</th>
                    <th className="pb-2 text-right font-medium">约合花费</th>
                    <th className="w-6 pb-2"><span className="sr-only">查看详情</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data!.by_user.map((u, i) => (
                    <tr
                      key={u.user_id}
                      role="button"
                      tabIndex={0}
                      aria-label={`查看 ${u.name} 的 AI 使用详情`}
                      onClick={() =>
                        openDetails({
                          title: `${u.name} 的 AI 使用详情`,
                          description: `${u.department ? `${u.department} · ` : ""}${RANGE_LABELS[range]}逐次调用记录`,
                          userId: u.user_id,
                        })
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          event.currentTarget.click();
                        }
                      }}
                      className="group cursor-pointer text-slate-700 transition-colors hover:bg-indigo-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-300"
                    >
                      <td className="py-2 pr-2 text-slate-400">{i + 1}</td>
                      <td className="py-2 pr-2">
                        <div className="font-medium text-slate-800">{u.name}</div>
                        {u.department && <div className="text-xs text-slate-400">{u.department}</div>}
                      </td>
                      <td className="py-2 pr-2 text-right font-bold text-slate-900">{u.calls}</td>
                      <td className="py-2 pr-2 text-right">{u.chat_calls}</td>
                      <td className="py-2 pr-2 text-right">{u.image_calls}</td>
                      <td className="py-2 pr-2 text-right">{u.video_calls}</td>
                      <td className="py-2 pr-2 text-right text-slate-500">{u.tokens ? u.tokens.toLocaleString() : "—"}</td>
                      <td className="py-2 text-right text-slate-500">{u.cost_cny_approx ? `¥${u.cost_cny_approx}` : "—"}</td>
                      <td className="py-2 pl-1">
                        <ChevronRight className="h-3.5 w-3.5 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-indigo-500" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <Sheet
        open={Boolean(detailTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setDetailTarget(null);
            setDetailData(null);
          }
        }}
      >
        <SheetContent className="w-full gap-0 overflow-hidden border-slate-200 bg-[#f5f7fb] p-0 sm:max-w-[760px]">
          <SheetHeader className="border-b border-slate-200 bg-white px-6 py-5 pr-12 text-left">
            <SheetTitle className="text-xl text-slate-950">{detailTarget?.title ?? "AI 使用详情"}</SheetTitle>
            <SheetDescription className="mt-1 text-xs text-slate-500">
              {detailTarget?.description ?? "逐次调用明细"}
            </SheetDescription>
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
            {detailLoading && !detailData ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <div key={index} className="h-20 animate-pulse rounded-xl bg-white" />
                  ))}
                </div>
                <div className="h-72 animate-pulse rounded-2xl bg-white" />
              </div>
            ) : detailData ? (
              <div className="space-y-4">
                <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="text-xs text-slate-400">调用次数</div>
                    <div className="mt-1 text-xl font-bold text-slate-900">{detailSummary?.calls ?? 0}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="text-xs text-slate-400">对话 / 图片 / 视频</div>
                    <div className="mt-1 text-sm font-bold text-slate-900">
                      {detailSummary?.chat_calls ?? 0} / {detailSummary?.image_calls ?? 0} / {detailSummary?.video_calls ?? 0}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="text-xs text-slate-400">总 Token</div>
                    <div className="mt-1 text-xl font-bold text-slate-900">
                      {(detailSummary?.total_tokens ?? 0).toLocaleString()}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-400">
                      输入 {(detailSummary?.prompt_tokens ?? 0).toLocaleString()} · 输出 {(detailSummary?.completion_tokens ?? 0).toLocaleString()}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="text-xs text-slate-400">约合花费</div>
                    <div className="mt-1 text-xl font-bold text-slate-900">¥{detailSummary?.cost_cny_approx ?? 0}</div>
                    <div className="mt-0.5 text-[11px] text-slate-400">
                      视频 ¥{detailSummary?.cost_yuan ?? 0} · 图片 ${detailSummary?.cost_usd ?? 0}
                    </div>
                  </div>
                </section>

                <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                  <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
                    <div>
                      <h3 className="font-semibold text-slate-900">逐次调用记录</h3>
                      <p className="mt-0.5 text-xs text-slate-400">
                        共 {detailData.pagination.total} 条，按调用时间倒序
                      </p>
                    </div>
                    {detailLoading && <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />}
                  </div>

                  {detailData.items.length === 0 ? (
                    <div className="px-6 py-14 text-center">
                      <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                        <FileText className="h-5 w-5" />
                      </span>
                      <p className="mt-3 text-sm text-slate-500">当前筛选条件下暂无调用记录</p>
                    </div>
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
                                  <span className={cn("material-chip", meta.tone)}>{meta.label}</span>
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
                              <div className="shrink-0 text-right">
                                <div className="text-sm font-bold text-slate-900">
                                  {item.total_tokens > 0 ? `${item.total_tokens.toLocaleString()} Token` : originalCost}
                                </div>
                                <div className="mt-0.5 text-[11px] text-slate-400">
                                  约合 ¥{item.cost_cny_approx}
                                  {item.seconds > 0 ? ` · ${item.seconds}s` : ""}
                                </div>
                              </div>
                            </div>

                            <div className="mt-3 grid gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-[11px] text-slate-500 sm:grid-cols-2">
                              <div>
                                <span className="text-slate-400">Token：</span>
                                输入 {item.prompt_tokens.toLocaleString()} · 输出 {item.completion_tokens.toLocaleString()}
                              </div>
                              <div>
                                <span className="text-slate-400">成本：</span>
                                {originalCost} · 折合 ¥{item.cost_cny_approx}
                              </div>
                              <div>
                                <span className="text-slate-400">服务商 / 来源：</span>
                                {item.provider || "—"} / {item.source || "—"}
                              </div>
                              <div className="min-w-0">
                                <span className="text-slate-400">关联业务 ID：</span>
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
                      <button
                        type="button"
                        onClick={() => setDetailPage((page) => Math.max(1, page - 1))}
                        disabled={detailPage <= 1 || detailLoading}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                        上一页
                      </button>
                      <span className="text-xs text-slate-400">
                        第 {detailData.pagination.page} / {detailData.pagination.total_pages} 页
                      </span>
                      <button
                        type="button"
                        onClick={() => setDetailPage((page) => Math.min(detailData.pagination.total_pages, page + 1))}
                        disabled={detailPage >= detailData.pagination.total_pages || detailLoading}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        下一页
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </section>
              </div>
            ) : (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-6 py-12 text-center text-sm text-rose-600">
                明细暂时无法加载，请稍后重试。
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
