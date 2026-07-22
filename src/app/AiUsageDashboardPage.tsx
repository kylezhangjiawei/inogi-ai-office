import { useEffect, useMemo, useState } from "react";
import { BarChart3, Image as ImageIcon, Info, Loader2, MessageSquare, RefreshCw, Users, Video } from "lucide-react";
import { toast } from "sonner";

import { cn } from "./components/ui/utils";
import { backfillAiUsage, fetchAiUsageDashboard, type UsageDashboard, type UsageRange } from "./lib/aiUsageApi";
import { DatabaseZap } from "lucide-react";

const RANGE_TABS: Array<{ value: UsageRange; label: string }> = [
  { value: "today", label: "今日" },
  { value: "month", label: "本月" },
  { value: "year", label: "本年" },
];

const MODALITY_META: Record<string, { label: string; tone: string }> = {
  chat: { label: "对话", tone: "bg-sky-50 text-sky-700" },
  image: { label: "图片", tone: "bg-amber-50 text-amber-700" },
  video: { label: "视频", tone: "bg-violet-50 text-violet-700" },
};

function StatCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
        {icon}
        {label}
      </div>
      <div className="mt-2 text-2xl font-bold tracking-tight text-slate-900">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

export function AiUsageDashboardPage() {
  const [range, setRange] = useState<UsageRange>("today");
  const [data, setData] = useState<UsageDashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [backfilling, setBackfilling] = useState(false);

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

  const maxTrend = useMemo(
    () => Math.max(1, ...(data?.trend ?? []).map((t) => t.calls)),
    [data],
  );
  const maxModelCalls = useMemo(
    () => Math.max(1, ...(data?.by_model ?? []).map((m) => m.calls)),
    [data],
  );

  const t = data?.totals;

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
        <StatCard icon={<BarChart3 className="h-4 w-4" />} label="总调用" value={String(t?.calls ?? 0)} />
        <StatCard icon={<MessageSquare className="h-4 w-4" />} label="对话" value={String(t?.chat_calls ?? 0)} />
        <StatCard icon={<ImageIcon className="h-4 w-4" />} label="图片" value={String(t?.image_calls ?? 0)} />
        <StatCard icon={<Video className="h-4 w-4" />} label="视频" value={String(t?.video_calls ?? 0)} />
        <StatCard icon={<BarChart3 className="h-4 w-4" />} label="Token" value={(t?.tokens ?? 0).toLocaleString()} sub="对话为估算" />
        <StatCard icon={<Video className="h-4 w-4" />} label="约合花费" value={`¥${t?.cost_cny_approx ?? 0}`} sub={`视频¥${t?.video_cost_yuan ?? 0} · 图片$${t?.image_cost_usd ?? 0}`} />
        <StatCard icon={<Users className="h-4 w-4" />} label="活跃用户" value={String(t?.active_users ?? 0)} />
      </div>

      {/* 近30天趋势 */}
      <section className="material-card p-6">
        <h3 className="mb-4 text-lg font-semibold text-slate-900">近 30 天调用趋势</h3>
        <div className="flex h-32 items-end gap-1">
          {(data?.trend ?? []).map((d) => (
            <div key={d.date} className="group relative flex-1" title={`${d.date}：${d.calls} 次`}>
              <div
                className="w-full rounded-t bg-indigo-400/80 transition-colors group-hover:bg-indigo-600"
                style={{ height: `${Math.max(2, (d.calls / maxTrend) * 100)}%` }}
              />
            </div>
          ))}
        </div>
        <div className="mt-2 flex justify-between text-[10px] text-slate-400">
          <span>{data?.trend?.[0]?.date}</span>
          <span>{data?.trend?.[data.trend.length - 1]?.date}</span>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* 按模型排行 */}
        <section className="material-card p-6">
          <h3 className="mb-4 text-lg font-semibold text-slate-900">按模型用量排行</h3>
          {loading && !data ? (
            <div className="flex items-center gap-2 py-10 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" /> 加载中...
            </div>
          ) : (data?.by_model.length ?? 0) === 0 ? (
            <div className="py-10 text-center text-sm text-slate-400">该时间段暂无使用记录</div>
          ) : (
            <div className="space-y-2.5">
              {data!.by_model.map((m) => {
                const meta = MODALITY_META[m.modality];
                const cost =
                  m.modality === "video" ? `¥${m.cost_yuan}` : m.modality === "image" ? `$${m.cost_usd}` : "—";
                return (
                  <div key={`${m.modality}-${m.model}`} className="rounded-xl border border-slate-100 p-3">
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
                      </div>
                    </div>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-indigo-500"
                        style={{ width: `${(m.calls / maxModelCalls) * 100}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* 按人员排行 */}
        <section className="material-card p-6">
          <h3 className="mb-4 text-lg font-semibold text-slate-900">按人员用量排行</h3>
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
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data!.by_user.map((u, i) => (
                    <tr key={u.user_id} className="text-slate-700">
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
