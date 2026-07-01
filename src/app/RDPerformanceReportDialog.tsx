import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Award, Download, Loader2, RefreshCw, Sparkles, UserCheck, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "./components/ui/utils";
import { RDPerformanceScoreDialog } from "./RDPerformanceScoreDialog";
import {
  createRdPerformanceReport,
  fetchRdPerformanceReports,
  PERF_SCORE_DIMENSIONS,
  type RdPerfDimensionScores,
  type RdPerformanceReport,
} from "./lib/rdApi";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 事项指标（80 分）——固定考核项与分值权重；「具体业务事项 / 评价标准」栏留空手填。 */
const ITEM_KPIS: ReadonlyArray<{ name: string; weight: string }> = [
  { name: "研发项目", weight: "30" },
  { name: "分析不良品", weight: "20" },
  { name: "工艺稽查", weight: "10" },
  { name: "工艺优化持续改进", weight: "10" },
  { name: "完成领导布置的任务", weight: "10" },
];

/** 行为指标（20 分）——固定写死的六项（具体业务事项 + 评价标准均照公司表单原文，不走 AI）。 */
const BEHAVIOR_KPIS: ReadonlyArray<{ name: string; weight: string; item: string; standard: string }> = [
  { name: "担当", weight: "2", item: "对自己行为的担当意识", standard: "主动承担工作任务，并按时完成。" },
  { name: "专注", weight: "2", item: "对工作的高度集中", standard: "在工作中保持高度集中，减少干扰。" },
  { name: "坚持", weight: "2", item: "对问题的不断探索", standard: "遇到困难问题时持续跟进，直至解决。" },
  { name: "极致", weight: "2", item: "对工作的极致效率", standard: "追求工作质量和效率的持续优化。" },
  { name: "务实", weight: "2", item: "对事情的务实态度", standard: "以实际效果和可执行结果为导向完成工作。" },
  { name: "创新", weight: "10", item: "使用AI智能办公工具", standard: "AI智能办公软件使用频率：每周≤5次，1分每周6—10次，5分\n几乎每天都使用，10分" },
];

/** 绩效等级与奖金发放规则（照搬公司表单原文）。 */
const GRADE_RULES =
  "一、110—100分，等级A+；99—90分，等级A；89—80分，等级B；79—70分，等级C；69—0，等级D。\n" +
  "二、等级A+、B、C的计算公式：绩效奖金发放金额=总得分/90*绩效奖金总额。\n" +
  "三、等级A全额发放绩效奖金，等级D不发放绩效奖金。\n" +
  "四、全年绩效均分A+的当选年度优秀员工且晋升1级。";

/** 把 YYYY-MM 转成表单里的「YY年M月」写法（如 2026-05 → 26年5月）；解析失败时回退到周期标签。 */
function formatAssessMonth(report: RdPerformanceReport): string {
  const m = /^(\d{4})-(\d{2})$/.exec(report.month ?? "");
  if (m) return `${m[1].slice(2)}年${parseInt(m[2], 10)}月`;
  return report.summary.period_label || report.month || "";
}

/**
 * 生成 Word 可打开的正式绩效文件（零依赖）：用 Office HTML 命名空间拼 HTML，
 * 以 application/msword 的 Blob 下载为 .doc，Word/WPS 可直接打开、打印、签字归档。
 * 版式与内容 1:1 复刻公司现用的《月度绩效考核表》：被考核人 / 考核月份自动填，
 * 其余打分（个人自评 / 直接领导 / CEO）、得分、绩效金额、岗位等留空供打印后手填。
 */
function buildPerformanceDocHtml(report: RdPerformanceReport): string {
  const name = escapeHtml(report.user_name);
  const monthLabel = escapeHtml(formatAssessMonth(report));

  // 事项指标行：优先用 AI 生成的逐项内容（具体业务事项 / 评价标准），旧报表无则回退到固定项留空。
  const aiItems = report.summary.item_kpis;
  const itemSource =
    aiItems && aiItems.length > 0
      ? aiItems.map((k) => ({ name: k.name, weight: k.weight, business: k.business ?? "", standard: k.standard ?? "" }))
      : ITEM_KPIS.map((k) => ({ name: k.name, weight: k.weight, business: "", standard: "" }));
  const itemRows = itemSource
    .map(
      (k) =>
        `<tr><td class="l">${escapeHtml(k.name)}</td><td class="c">${escapeHtml(k.weight)}</td>` +
        `<td class="l">${escapeHtml(k.business).replace(/\n/g, "<br/>")}</td><td class="c">月</td>` +
        `<td class="l">${escapeHtml(k.standard).replace(/\n/g, "<br/>")}</td>` +
        `<td class="score"></td><td class="score"></td><td class="score"></td></tr>`,
    )
    .join("");

  // 行为指标行：固定写死（具体业务事项 + 评价标准照公司表单原文），不读 AI 内容。
  const behaviorSource = BEHAVIOR_KPIS.map((k) => ({ name: k.name, weight: k.weight, item: k.item, standard: k.standard }));
  const behaviorRows = behaviorSource
    .map(
      (k) =>
        `<tr><td class="l">${escapeHtml(k.name)}</td><td class="c">${escapeHtml(k.weight)}</td>` +
        `<td class="l">${escapeHtml(k.item).replace(/\n/g, "<br/>")}</td><td class="c">月</td>` +
        `<td class="l">${escapeHtml(k.standard).replace(/\n/g, "<br/>")}</td>` +
        `<td class="score"></td><td class="score"></td><td class="score"></td></tr>`,
    )
    .join("");

  const rulesHtml = escapeHtml(GRADE_RULES).replace(/\n/g, "<br/>");

  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8" />
<title>${name}-${monthLabel}绩效考核</title>
<style>
  @page { size: A4 landscape; margin: 1.2cm; }
  body { font-family: "宋体", SimSun, serif; font-size: 12px; color: #000; }
  table { border-collapse: collapse; width: 100%; table-layout: fixed; }
  td, th { border: 1px solid #000; padding: 3px 5px; vertical-align: middle; word-break: break-all; line-height: 1.5; }
  col.a { width: 10%; } col.b { width: 6%; } col.c { width: 17%; } col.d { width: 6%; }
  col.e { width: 25%; } col.f { width: 9%; } col.g { width: 13%; } col.h { width: 14%; }
  .title { text-align: center; font-size: 18px; font-weight: bold; padding: 6px; }
  .info { text-align: left; padding: 6px 8px; }
  .hd { background: #f2f2f2; font-weight: bold; text-align: center; }
  .sec { background: #e8e8e8; font-weight: bold; text-align: left; }
  .c { text-align: center; }
  .l { text-align: left; }
  .score { height: 22px; }
  .rules { text-align: left; font-size: 11px; line-height: 1.7; padding: 6px 8px; }
  .sign { height: 42px; vertical-align: top; }
</style>
</head>
<body>
  <table>
    <colgroup>
      <col class="a" /><col class="b" /><col class="c" /><col class="d" />
      <col class="e" /><col class="f" /><col class="g" /><col class="h" />
    </colgroup>
    <tr><td colspan="8" class="title">壹诺吉研发部</td></tr>
    <tr><td colspan="8" class="info">被考核人：${name}　　　被考核人岗位：<u>　　　　　　</u>　　　考核月份：${monthLabel}</td></tr>
    <tr class="hd">
      <th class="hd">考核项目</th><th class="hd">分值权重</th><th class="hd">具体业务事项</th><th class="hd">考核周期</th>
      <th class="hd">评价标准</th><th class="hd">个人自评</th><th class="hd">直接领导评分</th><th class="hd">CEO最终评分</th>
    </tr>
    <tr><td colspan="8" class="sec">一、事项指标（80分）</td></tr>
    ${itemRows}
    <tr><td colspan="5" class="l">事项指标得分</td><td class="score"></td><td class="score"></td><td class="score"></td></tr>
    <tr><td colspan="8" class="sec">二、行为指标（20分）</td></tr>
    ${behaviorRows}
    <tr><td colspan="5" class="l">行为指标得分</td><td class="score"></td><td class="score"></td><td class="score"></td></tr>
    <tr><td colspan="5" class="l">总计</td><td class="score"></td><td class="score"></td><td class="score"></td></tr>
    <tr><td colspan="3" class="l">总得分=（个人自评总分+ceo总评分）/2</td><td class="score"></td><td class="l">绩效等级</td><td colspan="3" class="score"></td></tr>
    <tr><td colspan="3" class="l">绩效总金额</td><td class="score"></td><td class="l">绩效发放金额</td><td colspan="3" class="score"></td></tr>
    <tr><td colspan="8" class="rules">${rulesHtml}</td></tr>
    <tr>
      <td class="l sign">被考核人签名确认：</td><td colspan="2" class="sign"></td>
      <td colspan="2" class="l sign">直属上级签名确认：</td><td colspan="3" class="sign"></td>
    </tr>
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
      <PerformanceAssessmentView report={report} />
    </div>
  );
}

/** 已填的自评 / 主管评分展示（维度表 + 说明）；都没填则不渲染。 */
function PerformanceAssessmentView({ report }: { report: RdPerformanceReport }) {
  const self = report.summary.self_assessment ?? null;
  const supervisor = report.summary.supervisor_assessment ?? null;
  if (!self && !supervisor) return null;
  const avg = (scores: RdPerfDimensionScores) =>
    Math.round(PERF_SCORE_DIMENSIONS.reduce((a, d) => a + (scores[d.key] ?? 0), 0) / PERF_SCORE_DIMENSIONS.length);
  return (
    <div className="mt-4 rounded-xl ring-1 ring-slate-100">
      <div className="border-b border-slate-100 px-4 py-2 text-[11px] font-semibold text-slate-500">绩效评分（维度）</div>
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-slate-400">
            <th className="px-4 py-1.5 text-left font-medium">维度</th>
            <th className="px-2 py-1.5 text-center font-medium text-violet-600">自评</th>
            <th className="px-2 py-1.5 text-center font-medium text-amber-600">主管</th>
          </tr>
        </thead>
        <tbody>
          {PERF_SCORE_DIMENSIONS.map((d) => (
            <tr key={d.key} className="border-t border-slate-50">
              <td className="px-4 py-1.5 text-slate-600">{d.label}</td>
              <td className="px-2 py-1.5 text-center font-semibold tabular-nums text-slate-700">{self ? self.scores[d.key] ?? "—" : "—"}</td>
              <td className="px-2 py-1.5 text-center font-semibold tabular-nums text-slate-700">{supervisor ? supervisor.scores[d.key] ?? "—" : "—"}</td>
            </tr>
          ))}
          <tr className="border-t border-slate-100 bg-slate-50/60">
            <td className="px-4 py-1.5 font-semibold text-slate-600">平均分</td>
            <td className="px-2 py-1.5 text-center font-bold tabular-nums text-violet-700">{self ? avg(self.scores) : "—"}</td>
            <td className="px-2 py-1.5 text-center font-bold tabular-nums text-amber-700">{supervisor ? avg(supervisor.scores) : "—"}</td>
          </tr>
        </tbody>
      </table>
      {(self?.comment?.trim() || supervisor?.comment?.trim()) && (
        <div className="space-y-2 px-4 py-2.5 text-[12px] leading-6 text-slate-600">
          {self?.comment?.trim() && (
            <div><span className="font-semibold text-violet-600">自评说明：</span>{self.comment}</div>
          )}
          {supervisor?.comment?.trim() && (
            <div><span className="font-semibold text-amber-600">主管评语：</span>{supervisor.comment}</div>
          )}
        </div>
      )}
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
  const [scoringOpen, setScoringOpen] = useState(false);

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

  // 挂载到 document.body，避免祖先元素的 transform/filter 把 fixed 定位困在面板内导致弹窗错位。
  return createPortal(
    <>
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
              {canGenerate && (
                <button
                  type="button"
                  onClick={() => setScoringOpen(true)}
                  className="inline-flex items-center gap-1 rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-semibold text-amber-700 transition hover:bg-amber-50"
                >
                  <UserCheck className="h-3.5 w-3.5" />
                  {report.summary.supervisor_assessment ? "修改主管评分" : "主管评分"}
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

      <RDPerformanceScoreDialog
        open={scoringOpen}
        onClose={() => setScoringOpen(false)}
        report={report}
        mode="supervisor"
        onSubmitted={(updated) => setReport(updated)}
      />
    </>,
    document.body,
  );
}
