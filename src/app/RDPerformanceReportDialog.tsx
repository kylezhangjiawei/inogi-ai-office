import { useCallback, useEffect, useState } from "react";
import { Award, Download, Loader2, RefreshCw, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "./components/ui/utils";
import {
  createRdPerformanceReport,
  fetchRdPerformanceReports,
  type RdPerformanceReport,
} from "./lib/rdApi";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * 生成 Word 可打开的正式绩效文件（零依赖）：用 Office HTML 命名空间拼 HTML，
 * 以 application/msword 的 Blob 下载为 .doc，Word/WPS 可直接打开并归档。
 */
function buildPerformanceDocHtml(report: RdPerformanceReport): string {
  const s = report.summary;
  const m = s.metrics;
  const bodyHtml = escapeHtml(s.text).replace(/\n/g, "<br/>");
  const createdAt = new Date(report.created_at).toLocaleString("zh-CN");
  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(report.user_name)}-${escapeHtml(s.period_label)}绩效考核</title>
<style>
  body { font-family: "宋体", SimSun, serif; font-size: 14px; color: #1f2937; line-height: 1.9; margin: 32px; }
  h1 { text-align: center; font-size: 22px; margin: 0 0 6px; }
  .sub { text-align: center; color: #6b7280; font-size: 12px; margin-bottom: 18px; }
  table { border-collapse: collapse; width: 100%; margin: 10px 0; }
  td, th { border: 1px solid #9ca3af; padding: 6px 10px; font-size: 13px; vertical-align: middle; }
  th { background: #f3f4f6; text-align: left; width: 110px; white-space: nowrap; }
  .score { font-size: 18px; font-weight: bold; color: #b45309; }
  .body { margin-top: 14px; }
  .sign { margin-top: 36px; }
</style>
</head>
<body>
  <h1>月度绩效考核表</h1>
  <div class="sub">考核周期：${escapeHtml(s.period_label)}　·　生成时间：${escapeHtml(createdAt)}</div>
  <table>
    <tr><th>被考核人</th><td>${escapeHtml(report.user_name)}</td><th>综合评级</th><td>${escapeHtml(s.grade)}</td></tr>
    <tr><th>任务总数</th><td>${m.total_tasks}（主责 ${m.owner_tasks} · 协作 ${m.collab_tasks}）</td><th>综合评分</th><td class="score">${s.score} 分</td></tr>
    <tr><th>完成 / 进行</th><td>完成 ${m.completed} · 进行中 ${m.in_progress}</td><th>阻塞 / 停滞</th><td>阻塞 ${m.blocked} · 停滞 ${m.stalled}</td></tr>
    <tr><th>任务完成率</th><td>${m.completion_rate}%（逾期 ${m.overdue_tasks}）</td><th>过程记录</th><td>进度记录 ${m.notes_count} 条 · 材料 ${m.attachments_count} 个</td></tr>
  </table>
  <div class="body">${bodyHtml}</div>
  <table class="sign">
    <tr><th>被考核人签字</th><td>&nbsp;</td><th>考核人签字</th><td>&nbsp;</td></tr>
    <tr><th>日期</th><td>&nbsp;</td><th>日期</th><td>&nbsp;</td></tr>
  </table>
</body>
</html>`;
}

export function downloadPerformanceDoc(report: RdPerformanceReport): void {
  const html = buildPerformanceDocHtml(report);
  // 前置 BOM，确保中文在 Word 中正确解码。
  const blob = new Blob(["﻿", html], { type: "application/msword" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${report.user_name}-${report.summary.period_label}-绩效考核.doc`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const GRADE_STYLE: Record<string, string> = {
  优秀: "bg-emerald-100 text-emerald-700 ring-emerald-300",
  良好: "bg-blue-100 text-blue-700 ring-blue-300",
  合格: "bg-amber-100 text-amber-700 ring-amber-300",
  待改进: "bg-rose-100 text-rose-700 ring-rose-300",
};

function PerformanceBody({ report }: { report: RdPerformanceReport }) {
  const s = report.summary;
  const m = s.metrics;
  const gradeCls = GRADE_STYLE[s.grade] ?? "bg-slate-100 text-slate-600 ring-slate-300";
  const cells: Array<{ label: string; value: string | number; accent?: string }> = [
    { label: "任务总数", value: m.total_tasks },
    { label: "本月完成", value: m.completed, accent: "text-emerald-600" },
    { label: "完成率", value: `${m.completion_rate}%`, accent: "text-indigo-600" },
    { label: "进行中", value: m.in_progress, accent: "text-blue-600" },
    { label: "阻塞", value: m.blocked, accent: "text-red-600" },
    { label: "停滞", value: m.stalled, accent: "text-amber-600" },
    { label: "进度记录", value: m.notes_count },
    { label: "上传材料", value: m.attachments_count },
    { label: "逾期", value: m.overdue_tasks, accent: m.overdue_tasks > 0 ? "text-rose-600" : undefined },
  ];
  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3 rounded-xl bg-gradient-to-br from-amber-50 to-orange-50 px-4 py-3 ring-1 ring-amber-100">
        <div>
          <div className="text-[11px] text-slate-500">综合评分</div>
          <div className="text-3xl font-bold tabular-nums text-amber-600">
            {s.score}
            <span className="ml-0.5 text-base font-medium text-amber-400">分</span>
          </div>
        </div>
        <span className={cn("inline-flex items-center rounded-full px-3.5 py-1 text-sm font-bold ring-1", gradeCls)}>
          {s.grade}
        </span>
      </div>
      <div className="mb-4 grid grid-cols-3 gap-2">
        {cells.map((c) => (
          <div key={c.label} className="rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
            <div className="text-[10px] text-slate-400">{c.label}</div>
            <div className={cn("mt-0.5 text-lg font-bold tabular-nums text-slate-700", c.accent)}>{c.value}</div>
          </div>
        ))}
      </div>
      <pre className="whitespace-pre-wrap break-words rounded-xl bg-white px-4 py-3 font-sans text-[13px] leading-7 text-slate-700 ring-1 ring-slate-100">
        {s.text}
      </pre>
    </div>
  );
}

/**
 * 月度绩效报表弹窗：打开时回查该成员当月已有绩效；没有则提供「生成绩效报表」（AI 评估，评价从宽）。
 * 支持「重新生成」与「下载正式绩效文件（Word .doc）」。
 */
export function RDPerformanceReportDialog({
  open,
  onClose,
  userId,
  userName,
  month,
  canGenerate,
}: {
  open: boolean;
  onClose: () => void;
  userId: string | null;
  userName: string;
  month: string;
  canGenerate: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [report, setReport] = useState<RdPerformanceReport | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(() => {
    if (!userId) {
      setLoaded(true);
      return;
    }
    setLoading(true);
    fetchRdPerformanceReports({ user_id: userId, month, limit: 1 })
      .then((list) => setReport(list[0] ?? null))
      .catch(() => setReport(null))
      .finally(() => {
        setLoading(false);
        setLoaded(true);
      });
  }, [userId, month]);

  useEffect(() => {
    if (!open) return;
    setLoaded(false);
    setReport(null);
    load();
  }, [open, load]);

  const generate = useCallback(async () => {
    if (!userId) {
      toast.error("该成员暂无账号 ID，无法生成绩效");
      return;
    }
    setGenerating(true);
    try {
      const r = await createRdPerformanceReport({ user_id: userId, user_name: userName, month });
      setReport(r);
      toast.success("绩效报表已生成");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "绩效生成失败");
    } finally {
      setGenerating(false);
    }
  }, [userId, userName, month]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500 text-white shadow-sm">
              <Award className="h-4 w-4" />
            </span>
            <div>
              <h3 className="text-sm font-bold text-slate-800">月度绩效报表</h3>
              <p className="text-[11px] text-slate-400">
                {userName} · {month}
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
          {loading ? (
            <div className="flex items-center justify-center py-16 text-sm text-slate-400">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              正在读取绩效…
            </div>
          ) : report ? (
            <PerformanceBody report={report} />
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <p className="text-sm text-slate-500">
                {loaded ? "该成员本月尚未生成绩效报表。" : ""}
              </p>
              {canGenerate ? (
                <button
                  type="button"
                  onClick={generate}
                  disabled={generating || !userId}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-600 disabled:opacity-60"
                >
                  {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {generating ? "AI 评估中…" : "生成绩效报表"}
                </button>
              ) : (
                <p className="text-xs text-slate-400">暂无生成权限，请联系研发主管。</p>
              )}
            </div>
          )}
        </div>

        {report && (
          <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-5 py-3">
            <span className="text-[11px] text-slate-400">
              {report.summary.generated_by === "ai" ? "AI 生成" : "本地生成"} ·{" "}
              {new Date(report.created_at).toLocaleString("zh-CN")}
            </span>
            <div className="flex items-center gap-2">
              {canGenerate && (
                <button
                  type="button"
                  onClick={generate}
                  disabled={generating}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
                >
                  {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  重新生成
                </button>
              )}
              <button
                type="button"
                onClick={() => downloadPerformanceDoc(report)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-amber-600"
              >
                <Download className="h-3.5 w-3.5" />
                下载正式绩效文件
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
