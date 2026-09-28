import { useCallback, useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { AlertTriangle, CheckCircle2, ChevronRight, Loader2, FileText, Sparkles, X, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "../components/ui/utils";
import { useAuth } from "../auth";
import { isSuperAdmin } from "../lib/permissions";
import {
  fetchRdTaskCompletionScore,
  fetchRdTaskCompletionScoreDebug,
  type RdTaskCompletionScore,
  type RdTaskCompletionScoreDebug,
  type RdTaskProgressNote,
} from "../lib/rdApi";
import { getGradeTone } from "../lib/taskCompletionScore";
import { openTaskCompletionReport } from "../lib/taskCompletionReport";
import { i18nLocale, t } from "../lib/i18n";
import { Button } from "../components/ui/button";
import { type Task } from './taskModel';
import { RD_FAST_TRANSITION, RD_PANEL_TRANSITION } from './taskMotion';

export function TaskCompletionScoreCard({
  task,
  notes,
  loading,
  canView,
}: {
  task: Task;
  notes: RdTaskProgressNote[];
  loading: boolean;
  canView: boolean;
}) {
  const { user } = useAuth();
  const isSuper = isSuperAdmin(user?.permissions);
  const [aiScore, setAiScore] = useState<RdTaskCompletionScore | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiFetched, setAiFetched] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugData, setDebugData] = useState<RdTaskCompletionScoreDebug | null>(null);
  const [debugLoading, setDebugLoading] = useState(false);

  const openDebug = useCallback(async () => {
    setDebugOpen(true);
    if (debugData) return; // 已经拉过
    setDebugLoading(true);
    try {
      const d = await fetchRdTaskCompletionScoreDebug(task.task_id);
      setDebugData(d);
    } finally {
      setDebugLoading(false);
    }
  }, [debugData, task.task_id]);

  // 拉取 AI 评分（接口已做权限过滤；未授权时返回 null）
  useEffect(() => {
    if (!canView) {
      setAiScore(null);
      setAiFetched(true);
      return;
    }
    const controller = new AbortController();
    setAiLoading(true);
    fetchRdTaskCompletionScore(task.task_id, controller.signal)
      .then((score) => { if (!controller.signal.aborted) setAiScore(score); })
      .catch(() => { if (!controller.signal.aborted) setAiScore(null); })
      .finally(() => {
        if (!controller.signal.aborted) {
          setAiLoading(false);
          setAiFetched(true);
        }
      });
    return () => { controller.abort(); };
  }, [task.task_id, canView]);

  if (!canView) {
    return (
      <div className="rounded-[8px] border border-dashed border-slate-200 bg-slate-50/60 px-3 py-4 text-center text-xs text-muted-foreground">
        {t("完成质量评分仅对该任务关联人员和管理员可见")}
      </div>
    );
  }

  if (loading || aiLoading || !aiFetched) {
    return (
      <div className="rounded-[8px] border border-dashed border-slate-200 bg-slate-50/60 px-3 py-4 text-center text-xs text-muted-foreground">
        {t("正在读取 AI 完成质量评分…")}
      </div>
    );
  }

  // AI 评分未生成 → 展示等待生成的空状态（不再使用规则估算填充，避免误导）
  if (!aiScore) {
    return (
      <div className="rounded-[8px] border border-dashed border-indigo-200 bg-indigo-50/40 p-4 space-y-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-indigo-800">
          <Sparkles className="h-4 w-4" />
          {t("完成质量评分")}
        </div>
        <p className="text-xs leading-relaxed text-slate-600">
          {t("AI 评分尚未生成。审核通过的任务会自动触发评分（每条 5-20 秒）；历史已完成任务可在驾驶舱「完成」筛选条点击「AI 复盘评分」批量生成。")}
        </p>
      </div>
    );
  }

  const total = aiScore.total;
  const grade = aiScore.grade;
  const gradeLabel = aiScore.grade_label;
  const dimensions = aiScore.dimensions.map((d) => ({
    key: d.key,
    label: d.label,
    score: d.score,
    max: d.max,
    detail: d.comment,
  }));
  const tone = getGradeTone(grade);
  const useAi = !aiScore.fallback_reason;

  return (
    <div className={cn("rounded-[8px] border bg-white p-4 space-y-3", tone.border)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Sparkles className={cn("h-4 w-4 shrink-0", tone.text)} />
            <div className="text-sm font-semibold text-slate-800">{t("完成质量评分")}</div>
            <span
              className={cn(
                "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold",
                useAi
                  ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                  : "border-slate-200 bg-slate-50 text-slate-500",
              )}
              title={useAi ? `${t("AI 模型：")}${aiScore!.provider}/${aiScore!.model}` : t("AI 评分未生成")}
            >
              {useAi ? t("AI 复盘") : t("规则估算")}
            </span>
            {!useAi && (
              <span
                className="inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700"
                title={aiScore.fallback_reason}
              >
                {t("AI 不可用·兜底")}
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="flex items-baseline justify-end gap-1">
            <span className={cn("text-2xl font-bold tabular-nums", tone.text)}>{total}</span>
            <span className="text-xs text-muted-foreground">/ 100</span>
          </div>
          <span
            className={cn(
              "mt-1 inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-xs font-bold ring-1",
              tone.bg,
              tone.text,
              tone.border,
              tone.ring,
            )}
            title={t(gradeLabel)}
          >
            {grade} · {t(gradeLabel)}
          </span>
        </div>
      </div>

      {aiScore.summary && (
        <div className="rounded-md border border-slate-200 bg-slate-50/70 px-3 py-2">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
            <Sparkles className="h-3 w-3 text-indigo-500" />
            {t("AI 综合点评")}
          </div>
          <p className="text-xs leading-6 text-slate-700">{aiScore.summary}</p>
        </div>
      )}

      <ul className="space-y-2.5">
        {dimensions.map((d) => {
          const pct = Math.round((d.score / d.max) * 100);
          return (
            <li key={d.key} className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-medium text-slate-700">{t(d.label)}</span>
                <span className="tabular-nums text-slate-500">
                  <span className="font-semibold text-slate-700">{d.score}</span>
                  <span className="text-muted-foreground"> / {d.max}</span>
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div className={cn("h-full rounded-full", tone.bar)} style={{ width: `${pct}%` }} />
              </div>
              {/* 维度评语完整展示（此前用 w-40 truncate 截断导致"看不全"，改为整行换行） */}
              {d.detail && (
                <p className="text-[11px] leading-5 text-slate-500">{d.detail}</p>
              )}
            </li>
          );
        })}
      </ul>

      {(aiScore.highlights.length > 0 || aiScore.improvements.length > 0) && (
        <div className="grid gap-2 sm:grid-cols-2">
          {aiScore.highlights.length > 0 && (
            <div className="rounded-md border border-emerald-100 bg-emerald-50/60 px-2.5 py-2">
              <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                <CheckCircle2 className="h-3 w-3" />
                {t("亮点")}
              </div>
              <ul className="space-y-0.5 text-[11px] leading-relaxed text-emerald-800">
                {aiScore.highlights.map((h, i) => (
                  <li key={i}>· {h}</li>
                ))}
              </ul>
            </div>
          )}
          {aiScore.improvements.length > 0 && (
            <div className="rounded-md border border-amber-100 bg-amber-50/60 px-2.5 py-2">
              <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-amber-700">
                <AlertTriangle className="h-3 w-3" />
                {t("改进建议")}
              </div>
              <ul className="space-y-0.5 text-[11px] leading-relaxed text-amber-800">
                {aiScore.improvements.map((s, i) => (
                  <li key={i}>· {s}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-2.5 py-1.5 text-[10px] leading-relaxed text-slate-500">
        <p className="min-w-0 flex-1">
          {useAi ? (
            <>
              {t("AI 复盘基于时效性、过程透明度、交付证据、协作与风险管理 4 维度评分。模型：")}
              <span className="font-mono">{aiScore.provider}/{aiScore.model}</span> · {t("生成于")}
              <span className="tabular-nums"> {new Date(aiScore.computed_at).toLocaleString(i18nLocale())}</span>
            </>
          ) : (
            <>
              {t("AI 模型调用失败或未配置，使用规则估算兜底（仅时效/留痕/附件/协作 4 指标，无 AI 推理）。")}
              {t("原因：")}<span className="font-mono">{aiScore.fallback_reason ?? t("未知")}</span>
            </>
          )}
        </p>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button variant="unstyled"
            type="button"
            onClick={() => {
              const ok = openTaskCompletionReport(task, aiScore, notes);
              if (!ok) toast.error(t("报告窗口被浏览器拦截，请允许本站弹出窗口后重试"));
            }}
            className="inline-flex items-center gap-1 rounded-md border border-primary/25 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-primary transition-colors hover:border-primary/25 hover:bg-accent hover:text-primary-hover"
            title={t("生成正式的完成质量评估报告，在弹出的打印对话框中选择「另存为 PDF」即可下载")}
          >
            <FileText className="h-3 w-3" />
            {t("生成报告")}
          </Button>
          {isSuper && (
            <Button variant="unstyled"
              type="button"
              onClick={openDebug}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 transition-colors hover:border-primary/25 hover:bg-accent hover:text-primary-hover"
              title={t("超级管理员专属：查看 AI 评分的原始 prompt 和 AI 响应（用于审查抽取/RAG 是否真的传到 AI）")}
            >
              <Settings2 className="h-3 w-3" />
              {t("调试")}
            </Button>
          )}
        </div>
      </div>
      {debugOpen && (
        <CompletionScoreDebugDialog
          loading={debugLoading}
          data={debugData}
          onClose={() => setDebugOpen(false)}
        />
      )}
    </div>
  );
}

function CompletionScoreDebugDialog({
  loading,
  data,
  onClose,
}: {
  loading: boolean;
  data: RdTaskCompletionScoreDebug | null;
  onClose: () => void;
}) {
  const shouldReduceMotion = useReducedMotion();
  const debug = data?._debug;
  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(
      () => toast.success(t("{label}已复制", { label })),
      () => toast.error(t("复制{label}失败", { label })),
    );
  };
  return (
    <motion.div
      initial={shouldReduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={RD_FAST_TRANSITION}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={shouldReduceMotion ? false : { opacity: 0, y: 18, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 18, scale: 0.97 }}
        transition={RD_PANEL_TRANSITION}
        className="flex h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50 px-6 py-3">
          <div className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-indigo-600" />
            <h3 className="text-sm font-semibold text-slate-900">{t("AI 评分调试 · 原始 prompt + AI 响应")}</h3>
            <span className="rounded-md border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">
              {t("仅超管可见")}
            </span>
          </div>
          <Button variant="unstyled"
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-slate-100 hover:text-slate-700"
            aria-label={t("关闭")}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t("正在拉取调试数据…")}
            </div>
          ) : !data || !debug ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <AlertTriangle className="h-5 w-5 text-amber-400" />
              <p>{t("该任务尚无 AI 评分数据，或调试信息未保存（仅新评分会带 _debug 字段）")}</p>
              <p className="text-[11px] text-muted-foreground">{t("让管理员重新触发一次 AI 评分即可。")}</p>
            </div>
          ) : (
            <div className="space-y-4 text-xs">
              {/* 元数据条 */}
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-600">
                  <span>
                    {t("模型：")}<span className="font-mono font-semibold text-slate-900">{data.provider}/{data.model}</span>
                  </span>
                  <span className="text-muted-foreground">|</span>
                  <span>
                    {t("耗时：")}<span className="font-semibold tabular-nums">{debug.duration_ms} ms</span>
                  </span>
                  <span className="text-muted-foreground">|</span>
                  <span>
                    {t("开始：")}<span className="tabular-nums">{new Date(debug.request_started_at).toLocaleString(i18nLocale())}</span>
                  </span>
                  <span className="text-muted-foreground">|</span>
                  <span>
                    {t("结束：")}<span className="tabular-nums">{new Date(debug.request_finished_at).toLocaleString(i18nLocale())}</span>
                  </span>
                  {data.fallback_reason && (
                    <>
                      <span className="text-muted-foreground">|</span>
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                        {t("兜底：")}{data.fallback_reason}
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* 1. System Prompt */}
              <DebugSection
                title={t("1. System Prompt（评分员角色 + 规则）")}
                content={debug.system_prompt}
                onCopy={() => copyToClipboard(debug.system_prompt, "System Prompt")}
              />

              {/* 2. User Message */}
              <DebugSection
                title={t("2. User Message（任务数据 + 附件抽取内容 + RAG 上下文）")}
                content={debug.user_message}
                onCopy={() => copyToClipboard(debug.user_message, "User Message")}
                highlightLength
              />

              {/* 3. Raw AI Response */}
              <DebugSection
                title={t("3. AI 原始响应（JSON 字符串）")}
                content={prettyJsonOrText(debug.raw_response)}
                onCopy={() => copyToClipboard(debug.raw_response, t("AI 原始响应"))}
              />

              {/* 4. Parsed result */}
              <DebugSection
                title={t("4. 解析后的评分结果（持久化到 rd.taskCompletionScores）")}
                content={JSON.stringify(
                  {
                    total: data.total,
                    grade: data.grade,
                    grade_label: data.grade_label,
                    summary: data.summary,
                    dimensions: data.dimensions,
                    highlights: data.highlights,
                    improvements: data.improvements,
                  },
                  null,
                  2,
                )}
                onCopy={() =>
                  copyToClipboard(
                    JSON.stringify(
                      {
                        total: data.total,
                        grade: data.grade,
                        dimensions: data.dimensions,
                        highlights: data.highlights,
                        improvements: data.improvements,
                      },
                      null,
                      2,
                    ),
                    t("解析后结果"),
                  )
                }
              />
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

function DebugSection({
  title,
  content,
  onCopy,
  highlightLength = false,
}: {
  title: string;
  content: string;
  onCopy: () => void;
  highlightLength?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <header className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-3 py-1.5">
        <Button variant="unstyled"
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="flex min-w-0 items-center gap-1.5 text-left text-xs font-semibold text-slate-700 hover:text-primary-hover"
        >
          <ChevronRight className={cn("h-3 w-3 transition-transform", !collapsed && "rotate-90")} />
          <span className="truncate">{title}</span>
          <span className="shrink-0 text-[10px] font-normal text-muted-foreground">
            ({t("{count} 字符", { count: content.length.toLocaleString() })}{highlightLength && content.length > 12000 ? ` ${t("· ⚠️ 较长")}` : ""})
          </span>
        </Button>
        <Button variant="unstyled"
          type="button"
          onClick={onCopy}
          className="shrink-0 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:border-primary/25 hover:bg-accent hover:text-primary-hover"
        >
          {t("复制")}
        </Button>
      </header>
      {!collapsed && (
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words bg-slate-950 px-3 py-2 text-[11px] leading-relaxed text-slate-100">
          {content || t("(空)")}
        </pre>
      )}
    </section>
  );
}

function prettyJsonOrText(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}
