import { useEffect, useMemo, useState } from "react";
import { Award, Loader2, Star, UserCheck, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "./components/ui/utils";
import {
  PERF_SCORE_DIMENSIONS,
  submitRdSelfAssessment,
  submitRdSupervisorAssessment,
  type PerfScoreDimension,
  type RdPerfDimensionScores,
  type RdPerformanceReport,
} from "./lib/rdApi";

type ScoreMode = "self" | "supervisor";

const DEFAULT_SCORE = 80;

function emptyScores(): RdPerfDimensionScores {
  const out = {} as RdPerfDimensionScores;
  for (const d of PERF_SCORE_DIMENSIONS) out[d.key] = DEFAULT_SCORE;
  return out;
}

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * 绩效评分弹窗（自评 / 主管评分共用）。5 维各 0-100 + 一段说明。
 * 上方只读展示当月系统评分与 AI 评价作为参考；提交后回写并通过 onSubmitted 回传最新报表。
 */
export function RDPerformanceScoreDialog({
  open,
  onClose,
  report,
  mode,
  onSubmitted,
}: {
  open: boolean;
  onClose: () => void;
  report: RdPerformanceReport | null;
  mode: ScoreMode;
  onSubmitted?: (updated: RdPerformanceReport) => void;
}) {
  const existing = useMemo(() => {
    if (!report) return null;
    return mode === "self" ? report.summary.self_assessment ?? null : report.summary.supervisor_assessment ?? null;
  }, [report, mode]);

  const [scores, setScores] = useState<RdPerfDimensionScores>(emptyScores);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // 打开 / 切换目标时，用已填评分回填，否则取默认值。
  useEffect(() => {
    if (!open) return;
    if (existing) {
      const next = emptyScores();
      for (const d of PERF_SCORE_DIMENSIONS) next[d.key] = clampScore(existing.scores?.[d.key] ?? DEFAULT_SCORE);
      setScores(next);
      setComment(existing.comment ?? "");
    } else {
      setScores(emptyScores());
      setComment("");
    }
  }, [open, existing]);

  if (!open || !report) return null;

  const isSelf = mode === "self";
  const accent = isSelf ? "violet" : "amber";
  const title = isSelf ? "绩效自评" : "主管评分";
  const Icon = isSelf ? Star : UserCheck;
  const average = clampScore(
    PERF_SCORE_DIMENSIONS.reduce((sum, d) => sum + (scores[d.key] ?? 0), 0) / PERF_SCORE_DIMENSIONS.length,
  );

  const setScore = (key: PerfScoreDimension, value: number) =>
    setScores((prev) => ({ ...prev, [key]: clampScore(value) }));

  const submit = async () => {
    setSubmitting(true);
    try {
      const fn = isSelf ? submitRdSelfAssessment : submitRdSupervisorAssessment;
      const updated = await fn(report.id, { scores, comment: comment.trim() });
      toast.success(isSelf ? "自评已提交" : "主管评分已提交");
      onSubmitted?.(updated);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "提交失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-4" onClick={onClose}>
      <div
        className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <span
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-xl text-white shadow-sm",
                isSelf ? "bg-violet-600" : "bg-amber-500",
              )}
            >
              <Icon className="h-4 w-4" />
            </span>
            <div>
              <h3 className="text-sm font-bold text-slate-800">{title}</h3>
              <p className="text-[11px] text-slate-400">
                {report.user_name} · {report.summary.period_label}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {/* 参考：系统评分 + AI 评价（只读） */}
          <div className="mb-4 rounded-xl bg-slate-50 px-4 py-3 ring-1 ring-slate-100">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-500">系统综合评分（参考）</span>
              <span className="text-sm font-bold tabular-nums text-slate-700">
                {report.summary.score} 分 · {report.summary.grade}
              </span>
            </div>
            <pre className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap break-words font-sans text-[12px] leading-6 text-slate-600">
              {report.summary.text}
            </pre>
          </div>

          {/* 5 维评分 */}
          <div className="space-y-3">
            {PERF_SCORE_DIMENSIONS.map((d) => (
              <div key={d.key} className="rounded-lg border border-slate-100 px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="text-sm font-semibold text-slate-700">{d.label}</span>
                    <span className="ml-1.5 text-[11px] text-slate-400">{d.hint}</span>
                  </div>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={scores[d.key]}
                    onChange={(e) => setScore(d.key, Number(e.target.value))}
                    className={cn(
                      "h-7 w-16 shrink-0 rounded-md border border-slate-200 px-2 text-right text-sm font-bold tabular-nums text-slate-700 outline-none",
                      isSelf ? "focus:border-violet-300 focus:ring-2 focus:ring-violet-100" : "focus:border-amber-300 focus:ring-2 focus:ring-amber-100",
                    )}
                  />
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={scores[d.key]}
                  onChange={(e) => setScore(d.key, Number(e.target.value))}
                  className={cn("mt-2 w-full", isSelf ? "accent-violet-600" : "accent-amber-500")}
                />
              </div>
            ))}
          </div>

          <div className="mt-3 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
            <span>5 维平均</span>
            <span className="text-base font-bold tabular-nums text-slate-700">{average} 分</span>
          </div>

          <div className="mt-4">
            <label className="text-[11px] font-semibold text-slate-500">{isSelf ? "自评说明" : "主管评语"}</label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder={isSelf ? "简述本月亮点、不足与改进计划…" : "对该成员本月表现的总体评价与建议…"}
              className={cn(
                "mt-1 w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 outline-none",
                isSelf ? "focus:border-violet-300 focus:ring-2 focus:ring-violet-100" : "focus:border-amber-300 focus:ring-2 focus:ring-amber-100",
              )}
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg border border-slate-200 px-3.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
          >
            取消
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition disabled:opacity-60",
              isSelf ? "bg-violet-600 hover:bg-violet-700" : "bg-amber-500 hover:bg-amber-600",
            )}
          >
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Award className="h-3.5 w-3.5" />}
            {existing ? "更新评分" : "提交评分"}
          </button>
        </div>
      </div>
    </div>
  );
}
