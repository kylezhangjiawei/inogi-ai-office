import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  Info,
  Loader2,
  MessageSquare,
  Minus,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Trophy,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover";
import { cn } from "./components/ui/utils";
import { getGradeTone, type TaskCompletionGrade } from "./lib/taskCompletionScore";
import {
  fetchRdPerformanceAssessment,
  type RdPerformanceAssessment,
  type RdPerformanceGradeDist,
  type RdPerformanceRow,
} from "./lib/rdApi";
import { i18nLocale, t, useI18n } from "./lib/i18n";

// 分数 → 等级（与后端阈值一致：85 / 70 / 55），用于综合分 / 交付质量着色。
function scoreToGrade(score: number): TaskCompletionGrade {
  return score >= 85 ? "A" : score >= 70 ? "B" : score >= 55 ? "C" : "D";
}

// 整数原样、否则保留一位小数。
function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

const GRADE_ORDER: TaskCompletionGrade[] = ["A", "B", "C", "D"];

// 交付质量四维度（与后端 RdTaskCompletionScoreDimensionKey 对齐，各满分 25）。
const DIMENSION_META: Array<{ key: "timeliness" | "process" | "evidence" | "collaboration"; label: string }> = [
  { key: "timeliness", label: "时效性" },
  { key: "process", label: "过程透明度" },
  { key: "evidence", label: "交付证据" },
  { key: "collaboration", label: "协作与风险" },
];

/** 等级分布迷你条 + 计数（A 优秀 / B 良好 / C 合格 / D 需改进）。 */
function GradeBar({ dist }: { dist: RdPerformanceGradeDist }) {
  const total = dist.A + dist.B + dist.C + dist.D;
  if (total === 0) {
    return <span className="text-xs text-slate-400">{t("暂无评分")}</span>;
  }
  return (
    <div className="flex flex-col gap-1">
      <div className="flex h-2 w-full max-w-[140px] overflow-hidden rounded-full bg-slate-100">
        {GRADE_ORDER.map((g) => {
          const v = dist[g];
          if (v === 0) return null;
          return (
            <div
              key={g}
              className={cn("h-full", getGradeTone(g).bar)}
              style={{ width: `${(v / total) * 100}%` }}
              title={t("{grade} 级：{count} 个", { grade: g, count: v })}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] tabular-nums">
        {GRADE_ORDER.map((g) =>
          dist[g] > 0 ? (
            <span key={g} className={cn("font-semibold", getGradeTone(g).text)}>
              {g} {dist[g]}
            </span>
          ) : null,
        )}
      </div>
    </div>
  );
}

/** 趋势徽标：近 30 天均分 − 前 30 天均分。 */
function TrendBadge({ delta }: { delta: number | null }) {
  if (delta === null) {
    return <span className="text-xs text-slate-400">{t("数据不足")}</span>;
  }
  if (Math.abs(delta) < 0.05) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500">
        <Minus className="h-3.5 w-3.5" /> {t("持平")}
      </span>
    );
  }
  const up = delta > 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-semibold tabular-nums",
        up ? "text-emerald-600" : "text-rose-600",
      )}
    >
      {up ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
      {up ? "+" : ""}
      {fmt(delta)}
    </span>
  );
}

/** 极简内联 SVG 迷你折线图（用完成评分点）。 */
function Sparkline({ points }: { points: number[] }) {
  const w = 64;
  const h = 20;
  if (points.length === 0) {
    return <span className="text-[10px] text-slate-300">—</span>;
  }
  if (points.length === 1) {
    return (
      <svg width={w} height={h} className="overflow-visible">
        <circle cx={w / 2} cy={h / 2} r={2.5} className="fill-indigo-500" />
      </svg>
    );
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const stepX = w / (points.length - 1);
  const coords = points.map((p, i) => {
    const x = i * stepX;
    const y = h - ((p - min) / range) * (h - 4) - 2;
    return [x, y] as const;
  });
  const d = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const last = coords[coords.length - 1];
  return (
    <svg width={w} height={h} className="overflow-visible">
      <path d={d} fill="none" className="stroke-indigo-400" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r={2} className="fill-indigo-500" />
    </svg>
  );
}

/** 综合分构成弹窗（透明化：让主管看见分数怎么来的）。 */
function CompositeBreakdown({
  row,
  weights,
}: {
  row: RdPerformanceRow;
  weights: RdPerformanceAssessment["weights"];
}) {
  const items = [
    {
      label: t("交付质量"),
      weight: weights.delivery,
      value: row.delivery_score,
      desc: t("已评分完成任务平均分"),
    },
    {
      label: t("交付吞吐"),
      weight: weights.throughput,
      value: row.throughput_score,
      desc: t("完成数饱和曲线 100·c/(c+5)"),
    },
    {
      label: t("AI 工具活跃度"),
      weight: weights.chat,
      value: row.chat_score,
      desc: t("MateChat 发言饱和曲线 100·m/(m+30)"),
    },
  ];
  return (
    <div className="w-72 space-y-2 text-xs">
      <div className="font-semibold text-slate-800">{t("综合分构成")} · {row.name}</div>
      {items.map((it) => (
        <div key={it.label} className="rounded-lg border border-slate-100 bg-slate-50/60 p-2">
          <div className="flex items-center justify-between">
            <span className="font-medium text-slate-700">{it.label}</span>
            <span className="tabular-nums text-slate-500">
              {t("权重")} {Math.round(it.weight * 100)}% × {fmt(it.value)} ={" "}
              <span className="font-semibold text-slate-800">
                {it.value === null ? "—" : fmt(Math.round(it.weight * it.value * 10) / 10)}
              </span>
            </span>
          </div>
          <div className="mt-0.5 text-[10px] text-slate-400">{it.desc}</div>
        </div>
      ))}
      <div className="flex items-center justify-between border-t border-slate-100 pt-2 font-semibold text-slate-800">
        <span>{t("综合考核分")}</span>
        <span className="tabular-nums">{row.composite === null ? "—" : row.composite}</span>
      </div>
      {row.dimension_avg ? (
        <div className="border-t border-slate-100 pt-2">
          <div className="mb-1 text-[10px] font-medium text-slate-500">{t("交付质量维度均分（各满分 25）")}</div>
          <div className="space-y-1">
            {DIMENSION_META.map((dim) => {
              const v = row.dimension_avg![dim.key];
              return (
                <div key={dim.key} className="flex items-center gap-2">
                  <span className="w-20 shrink-0 text-[11px] text-slate-600">{t(dim.label)}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-indigo-400"
                      style={{ width: `${Math.min(100, (v / 25) * 100)}%` }}
                    />
                  </div>
                  <span className="w-10 shrink-0 text-right text-[11px] font-semibold tabular-nums text-slate-700">
                    {fmt(v)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** 团队月度均分迷你柱图。 */
function MonthlyBars({ months }: { months: RdPerformanceAssessment["team"]["score_months"] }) {
  if (months.length === 0) {
    return <span className="text-xs text-slate-400">{t("暂无月度数据")}</span>;
  }
  const max = Math.max(...months.map((m) => m.avg), 1);
  return (
    <div className="flex items-end gap-1.5">
      {months.map((m) => (
        <div key={m.month} className="flex flex-col items-center gap-1" title={t("{month}：均分 {avg}（{count} 个）", { month: m.month, avg: fmt(m.avg), count: m.count })}>
          <span className="text-[9px] tabular-nums text-slate-400">{fmt(m.avg)}</span>
          <div className="flex h-12 w-5 items-end rounded bg-slate-100">
            <div
              className="w-full rounded bg-indigo-400"
              style={{ height: `${Math.max(8, (m.avg / max) * 100)}%` }}
            />
          </div>
          <span className="text-[9px] tabular-nums text-slate-400">{m.month.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}

function SummaryStat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-100 bg-white px-3 py-2.5 shadow-sm">
      <div className={cn("text-xl font-bold tabular-nums", tone ?? "text-slate-800")}>{value}</div>
      <div className="mt-0.5 text-xs font-medium text-slate-600">{label}</div>
      {sub ? <div className="text-[10px] text-slate-400">{sub}</div> : null}
    </div>
  );
}

export function RDPerformanceAssessmentPanel() {
  useI18n();
  const [data, setData] = useState<RdPerformanceAssessment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchRdPerformanceAssessment()
      .then((payload) => {
        if (mountedRef.current) setData(payload);
      })
      .catch((err: unknown) => {
        if (mountedRef.current) {
          setError(err instanceof Error ? err.message : t("绩效考核数据读取失败"));
        }
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });
  }, []);

  useEffect(() => { load(); }, [load]);

  const rankedRows = useMemo(() => (data?.rows ?? []).filter((r) => r.composite !== null), [data]);
  const unrankedRows = useMemo(() => (data?.rows ?? []).filter((r) => r.composite === null), [data]);

  const renderRow = (row: RdPerformanceRow) => {
    const ranked = row.composite !== null;
    const compositeGrade = ranked ? scoreToGrade(row.composite as number) : null;
    const deliveryGrade = row.avg_score !== null ? scoreToGrade(row.avg_score) : null;
    return (
      <tr key={row.person_id} className="border-t border-slate-100 hover:bg-slate-50/60">
        {/* 排名 */}
        <td className="px-3 py-3 text-center">
          {row.rank !== null ? (
            <span
              className={cn(
                "inline-flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold tabular-nums",
                row.rank === 1
                  ? "bg-amber-100 text-amber-700"
                  : row.rank === 2
                    ? "bg-slate-200 text-slate-700"
                    : row.rank === 3
                      ? "bg-orange-100 text-orange-700"
                      : "text-slate-500",
              )}
            >
              {row.rank <= 3 ? <Trophy className="h-3.5 w-3.5" /> : row.rank}
            </span>
          ) : (
            <span className="text-xs text-slate-300">—</span>
          )}
        </td>
        {/* 成员 */}
        <td className="px-3 py-3">
          <div className="font-semibold text-slate-800">{row.name}</div>
          <div className="text-[11px] text-slate-400">
            {[row.position, row.department].filter(Boolean).join(" · ") || t("研发成员")}
          </div>
        </td>
        {/* 综合分 */}
        <td className="px-3 py-3 text-center">
          {ranked && compositeGrade ? (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "inline-flex min-w-[3rem] items-center justify-center gap-1 rounded-lg border px-2.5 py-1 text-base font-bold tabular-nums transition-colors hover:opacity-80",
                    getGradeTone(compositeGrade).bg,
                    getGradeTone(compositeGrade).text,
                    getGradeTone(compositeGrade).border,
                  )}
                  title={t("点击查看综合分构成")}
                >
                  {row.composite}
                  <Info className="h-3 w-3 opacity-60" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="center" className="w-auto p-3">
                {data ? <CompositeBreakdown row={row} weights={data.weights} /> : null}
              </PopoverContent>
            </Popover>
          ) : (
            <span className="text-xs text-slate-400">{t("暂无评分")}</span>
          )}
        </td>
        {/* 交付质量 + 等级分布 */}
        <td className="px-3 py-3">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "text-sm font-semibold tabular-nums",
                deliveryGrade ? getGradeTone(deliveryGrade).text : "text-slate-400",
              )}
            >
              {fmt(row.avg_score)}
            </span>
          </div>
          <div className="mt-1">
            <GradeBar dist={row.grade_dist} />
          </div>
        </td>
        {/* 完成 / 评分 */}
        <td className="px-3 py-3 text-center">
          <div className="text-sm font-semibold tabular-nums text-slate-700">{row.completed_count}</div>
          <div className="text-[10px] text-slate-400">{t("已评分")} {row.scored_count}</div>
        </td>
        {/* AI 活跃度 */}
        <td className="px-3 py-3 text-center">
          <span className="inline-flex items-center gap-1 text-sm font-semibold tabular-nums text-violet-700">
            <MessageSquare className="h-3.5 w-3.5 text-violet-400" />
            {row.chat_total}
          </span>
          <div className="text-[10px] text-slate-400">{t("近 30 天")} {row.chat_recent}</div>
        </td>
        {/* 趋势 */}
        <td className="px-3 py-3">
          <div className="flex items-center gap-2">
            <Sparkline points={row.score_series.map((p) => p.total)} />
            <TrendBadge delta={row.trend_delta} />
          </div>
        </td>
      </tr>
    );
  };

  return (
    <section className="mt-5 rounded-2xl border border-white bg-white/70 p-5 shadow-sm">
      {/* 头部 */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
            <BarChart3 className="h-5 w-5" />
          </span>
          <div>
            <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
              {t("团队绩效考核")}
              {data ? (
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-500 transition-colors hover:bg-slate-50"
                      title={t("查看考核口径")}
                    >
                      <Info className="h-3 w-3" /> {t("考核口径")}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-96 p-3">
                    <div className="mb-1.5 text-sm font-semibold text-slate-800">{t("考核口径说明")}</div>
                    <ul className="space-y-1.5 text-xs leading-relaxed text-slate-600">
                      {data.notes.map((n, i) => (
                        <li key={i} className="flex gap-1.5">
                          <span className="text-indigo-400">·</span>
                          <span>{t(n)}</span>
                        </li>
                      ))}
                    </ul>
                  </PopoverContent>
                </Popover>
              ) : null}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {t("交付质量 + 吞吐 + MateChat 活跃度 · 综合分与相对排名 · 近 {days} 天趋势", { days: data?.window_days ?? 30 })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {loading ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("正在统计")}
            </span>
          ) : null}
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> {t("刷新")}
          </button>
        </div>
      </div>

      {error && !loading ? (
        <button
          type="button"
          onClick={load}
          className="w-full rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-700 transition-colors hover:bg-amber-100"
        >
          {error} · {t("点击重试")}
        </button>
      ) : null}

      {!error && data ? (
        <>
          {/* 团队概览 */}
          <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
            <SummaryStat
              label={t("参与排名")}
              value={t("{count} 人", { count: data.team.ranked_people })}
              sub={t("≥1 已评分完成任务")}
              tone="text-indigo-600"
            />
            <SummaryStat label={t("综合分均值")} value={fmt(data.team.avg_composite)} tone="text-slate-800" />
            <SummaryStat
              label={t("交付均分")}
              value={fmt(data.team.avg_score)}
              sub={t("中位数 {value}", { value: fmt(data.team.median_score) })}
              tone="text-emerald-600"
            />
            <SummaryStat
              label={t("完成 / 已评分")}
              value={`${data.team.total_completed} / ${data.team.total_scored}`}
              tone="text-blue-600"
            />
            <SummaryStat
              label={t("MateChat 发言")}
              value={String(data.team.chat_total)}
              sub={t("全员累计")}
              tone="text-violet-600"
            />
            <div className="col-span-2 rounded-xl border border-slate-100 bg-white px-3 py-2 shadow-sm sm:col-span-1 lg:col-span-1">
              <div className="mb-1 text-[10px] font-medium text-slate-500">{t("团队月度均分")}</div>
              <MonthlyBars months={data.team.score_months} />
            </div>
          </div>

          {/* 排名表 */}
          {data.rows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-10 text-center text-sm text-slate-500">
              {t("暂无可考核的成员数据。当主管在「成果审核」通过任务后，系统会自动评分并计入考核。")}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-100">
              <table className="w-full min-w-[820px] text-left">
                <thead>
                  <tr className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-2.5 text-center">{t("排名")}</th>
                    <th className="px-3 py-2.5">{t("成员")}</th>
                    <th className="px-3 py-2.5 text-center">{t("综合分")}</th>
                    <th className="px-3 py-2.5">{t("交付质量 / 等级分布")}</th>
                    <th className="px-3 py-2.5 text-center">{t("完成数")}</th>
                    <th className="px-3 py-2.5 text-center">{t("AI 活跃度")}</th>
                    <th className="px-3 py-2.5">{t("近 30 天趋势")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rankedRows.map(renderRow)}
                  {unrankedRows.length > 0 ? (
                    <>
                      <tr className="border-t border-slate-100 bg-slate-50/60">
                        <td colSpan={7} className="px-3 py-1.5 text-[11px] font-medium text-slate-400">
                          {t("未参与排名（暂无已评分的完成任务，仅展示对话活跃度）")}
                        </td>
                      </tr>
                      {unrankedRows.map(renderRow)}
                    </>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}

          <p className="mt-3 text-[11px] text-slate-400">
            {t("统计时间：{time} · 综合分仅作参考，最终绩效请结合任务难度与业务价值综合评估。", {
              time: new Date(data.generated_at).toLocaleString(i18nLocale()),
            })}
          </p>
        </>
      ) : null}

      {!error && !data && loading ? (
        <div className="flex items-center justify-center py-10 text-sm text-slate-400">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t("正在加载绩效数据…")}
        </div>
      ) : null}
    </section>
  );
}
