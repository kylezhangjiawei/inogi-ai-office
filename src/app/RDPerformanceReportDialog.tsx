import { useCallback, useEffect, useState } from "react";
import { Award, Download, Loader2, RefreshCw, Sparkles, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { cn } from "./components/ui/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";
import { RDPerformanceScoreDialog } from "./RDPerformanceScoreDialog";
import {
  createRdPerformanceReport,
  fetchRdPerformanceReports,
  PERF_BEHAVIOR_KPIS,
  type RdPerformanceReport,
} from "./lib/rdApi";

/** 事项指标（80 分）——AI 未生成时回退用的固定考核项与分值权重；两文本列留空手填。 */
const ITEM_KPIS: ReadonlyArray<{ name: string; weight: string }> = [
  { name: "研发项目", weight: "30" },
  { name: "分析不良品", weight: "20" },
  { name: "工艺稽查", weight: "10" },
  { name: "工艺优化持续改进", weight: "10" },
  { name: "完成领导布置的任务", weight: "10" },
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
 * 生成正式绩效文件为 .xlsx（用 exceljs 动态构建，含合并单元格/边框/列宽）。
 * 版式与内容 1:1 复刻公司现用的《月度绩效考核表》：被考核人 / 考核月份自动填；
 * 个人自评、直接领导评分按考核项名逐项回显并求和小计；CEO 最终评分、绩效金额、岗位留空供手填。
 */
export async function downloadPerformanceXlsx(report: RdPerformanceReport): Promise<void> {
  const mod = await import("exceljs");
  const ExcelJSLib = ((mod as { default?: typeof import("exceljs") }).default ?? mod) as typeof import("exceljs");
  const wb = new ExcelJSLib.Workbook();
  const ws = wb.addWorksheet("月度绩效考核表", { views: [{ showGridLines: false }] });
  ws.columns = [16, 10, 40, 8, 50, 10, 14, 14].map((w) => ({ width: w }));

  const s = report.summary;
  const name = report.user_name;
  const monthLabel = formatAssessMonth(report);
  const selfScores = s.self_assessment?.scores ?? {};
  const supScores = s.supervisor_assessment?.scores ?? {};
  const hasSelf = !!s.self_assessment;
  const hasSup = !!s.supervisor_assessment;
  const itemSource =
    s.item_kpis && s.item_kpis.length > 0
      ? s.item_kpis.map((k) => ({ name: k.name, weight: k.weight, business: k.business ?? "", standard: k.standard ?? "" }))
      : ITEM_KPIS.map((k) => ({ name: k.name, weight: k.weight, business: "", standard: "" }));
  const behaviorSource = PERF_BEHAVIOR_KPIS.map((k) => ({ name: k.name, weight: k.weight, item: k.item, standard: k.standard }));

  const thin = { style: "thin" as const, color: { argb: "FF999999" } };
  const allBorder = { top: thin, left: thin, bottom: thin, right: thin };
  const headerFill = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFF2F2F2" } };
  const secFill = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFE8E8E8" } };
  const numOr = (v: string): number | string => {
    const n = Number(v);
    return Number.isFinite(n) && v.trim() !== "" ? n : v;
  };
  const scoreOf = (map: Record<string, number>, n: string, has: boolean): number | string =>
    has && typeof map[n] === "number" ? map[n] : "";
  const sumOf = (src: ReadonlyArray<{ name: string }>, map: Record<string, number>) =>
    src.reduce((a, k) => a + (Number(map[k.name]) || 0), 0);

  let r = 1;
  const border8 = (rowNum: number) => {
    for (let c = 1; c <= 8; c++) ws.getCell(rowNum, c).border = allBorder;
  };
  type CellOpt = { align?: "left" | "center"; valign?: "top" | "middle"; wrap?: boolean; bold?: boolean; fill?: typeof headerFill };
  const put = (col: number, value: string | number, opt?: CellOpt) => {
    const cell = ws.getCell(r, col);
    cell.value = value;
    cell.alignment = { horizontal: opt?.align ?? "left", vertical: opt?.valign ?? "middle", wrapText: opt?.wrap ?? false };
    if (opt?.bold) cell.font = { ...(cell.font ?? {}), bold: true };
    if (opt?.fill) cell.fill = opt.fill;
  };
  const estHeight = (a: string, b: string) => {
    const lineCount = (t: string) => t.split("\n").reduce((acc, ln) => acc + 1 + Math.floor(ln.length / 22), 0);
    return Math.max(22, Math.max(lineCount(a), lineCount(b)) * 15);
  };

  // 标题
  ws.mergeCells(r, 1, r, 8);
  put(1, "壹诺吉研发部", { align: "center", bold: true });
  ws.getCell(r, 1).font = { bold: true, size: 14 };
  ws.getRow(r).height = 26;
  border8(r);
  r++;

  // 信息行
  ws.mergeCells(r, 1, r, 8);
  put(1, `被考核人：${name}          被考核人岗位：__________          考核月份：${monthLabel}`);
  ws.getRow(r).height = 22;
  border8(r);
  r++;

  // 表头
  ["考核项目", "分值权重", "具体业务事项", "考核周期", "评价标准", "个人自评", "直接领导评分", "CEO最终评分"].forEach((h, i) =>
    put(i + 1, h, { align: "center", bold: true, wrap: true, fill: headerFill }),
  );
  ws.getRow(r).height = 30;
  border8(r);
  r++;

  const section = (label: string) => {
    ws.mergeCells(r, 1, r, 8);
    put(1, label, { bold: true, fill: secFill });
    border8(r);
    r++;
  };
  const kpiRow = (name0: string, weight: string, business: string, standard: string) => {
    put(1, name0, { align: "left", valign: "middle", wrap: true });
    put(2, numOr(weight), { align: "center" });
    put(3, business, { align: "left", valign: "top", wrap: true });
    put(4, "月", { align: "center" });
    put(5, standard, { align: "left", valign: "top", wrap: true });
    put(6, scoreOf(selfScores, name0, hasSelf), { align: "center" });
    put(7, scoreOf(supScores, name0, hasSup), { align: "center" });
    put(8, "", { align: "center" });
    ws.getRow(r).height = estHeight(business, standard);
    border8(r);
    r++;
  };
  const subtotal = (label: string, src: ReadonlyArray<{ name: string }>) => {
    ws.mergeCells(r, 1, r, 5);
    put(1, label);
    put(6, hasSelf ? sumOf(src, selfScores) : "", { align: "center" });
    put(7, hasSup ? sumOf(src, supScores) : "", { align: "center" });
    put(8, "", { align: "center" });
    ws.getRow(r).height = 20;
    border8(r);
    r++;
  };
  const dualRow = (leftLabel: string, midLabel: string) => {
    ws.mergeCells(r, 1, r, 3);
    put(1, leftLabel);
    put(4, "");
    put(5, midLabel);
    ws.mergeCells(r, 6, r, 8);
    put(6, "");
    ws.getRow(r).height = 22;
    border8(r);
    r++;
  };

  section("一、事项指标（80分）");
  for (const k of itemSource) kpiRow(k.name, k.weight, k.business, k.standard);
  subtotal("事项指标得分", itemSource);
  section("二、行为指标（20分）");
  for (const k of behaviorSource) kpiRow(k.name, k.weight, k.item, k.standard);
  subtotal("行为指标得分", behaviorSource);
  subtotal("总计", [...itemSource, ...behaviorSource]);
  dualRow("总得分=（个人自评总分+ceo总评分）/2", "绩效等级");
  dualRow("绩效总金额", "绩效发放金额");

  // 等级规则
  ws.mergeCells(r, 1, r, 8);
  put(1, GRADE_RULES, { align: "left", valign: "top", wrap: true });
  ws.getRow(r).height = 76;
  border8(r);
  r++;

  // 签字行：A | B:C | D:E | F:H
  put(1, "被考核人签名确认：");
  ws.mergeCells(r, 2, r, 3);
  put(2, "");
  ws.mergeCells(r, 4, r, 5);
  put(4, "直属上级签名确认：");
  ws.mergeCells(r, 6, r, 8);
  put(6, "");
  ws.getRow(r).height = 42;
  border8(r);

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${report.user_name}-${report.summary.period_label}-绩效考核.xlsx`;
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
    { label: "完成率", value: `${m.completion_rate}%`, accent: "text-[#002fa7]" },
    { label: "进行中", value: m.in_progress, accent: "text-blue-600" },
    { label: "阻塞", value: m.blocked, accent: "text-red-600" },
    { label: "停滞", value: m.stalled, accent: "text-amber-600" },
    { label: "进度记录", value: m.notes_count },
    { label: "上传材料", value: m.attachments_count },
    { label: "逾期", value: m.overdue_tasks, accent: m.overdue_tasks > 0 ? "text-rose-600" : undefined },
  ];
  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-[#dce6ff] bg-[#eef3ff] px-4 py-3">
        <div>
          <div className="text-[11px] text-slate-500">综合评分</div>
          <div className="text-3xl font-bold tabular-nums text-[#002fa7]">
            {s.score}
            <span className="ml-0.5 text-base font-medium text-[#002fa7]/65">分</span>
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
      <pre className="whitespace-pre-wrap break-words rounded-xl bg-white px-4 py-3 font-sans text-pretty text-[13px] leading-7 text-slate-700 ring-1 ring-slate-100">
        {s.text}
      </pre>
      <PerformanceAssessmentView report={report} />
    </div>
  );
}

/** 已填的自评 / 主管评分展示（按考核项 + 说明）；都没填则不渲染。 */
function PerformanceAssessmentView({ report }: { report: RdPerformanceReport }) {
  const self = report.summary.self_assessment ?? null;
  const supervisor = report.summary.supervisor_assessment ?? null;
  if (!self && !supervisor) return null;

  const itemKpis = report.summary.item_kpis ?? [];
  const rows: Array<{ name: string; weight: number }> = [
    ...itemKpis.map((k) => ({ name: k.name, weight: Number(k.weight) || 0 })),
    ...PERF_BEHAVIOR_KPIS.map((k) => ({ name: k.name, weight: Number(k.weight) || 0 })),
  ];
  const cell = (a: { scores: Record<string, number> } | null, name: string) =>
    a && typeof a.scores?.[name] === "number" ? a.scores[name] : "—";
  const sum = (a: { scores: Record<string, number> } | null) =>
    a ? rows.reduce((s, r) => s + (Number(a.scores?.[r.name]) || 0), 0) : null;

  return (
    <div className="mt-4 rounded-xl ring-1 ring-slate-100">
      <div className="border-b border-slate-100 px-4 py-2 text-[11px] font-semibold text-slate-500">绩效评分（逐考核项）</div>
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-slate-400">
            <th className="px-4 py-1.5 text-left font-medium">考核项</th>
            <th className="px-2 py-1.5 text-center font-medium text-slate-400">权重</th>
            <th className="px-2 py-1.5 text-center font-medium text-[#002fa7]">个人自评</th>
            <th className="px-2 py-1.5 text-center font-medium text-amber-600">直接领导</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="border-t border-slate-50">
              <td className="px-4 py-1.5 text-slate-600">{r.name}</td>
              <td className="px-2 py-1.5 text-center tabular-nums text-slate-400">{r.weight}</td>
              <td className="px-2 py-1.5 text-center font-semibold tabular-nums text-slate-700">{cell(self, r.name)}</td>
              <td className="px-2 py-1.5 text-center font-semibold tabular-nums text-slate-700">{cell(supervisor, r.name)}</td>
            </tr>
          ))}
          <tr className="border-t border-slate-100 bg-slate-50/60">
            <td className="px-4 py-1.5 font-semibold text-slate-600" colSpan={2}>总计</td>
            <td className="px-2 py-1.5 text-center font-bold tabular-nums text-[#002fa7]">{sum(self) ?? "—"}</td>
            <td className="px-2 py-1.5 text-center font-bold tabular-nums text-amber-700">{sum(supervisor) ?? "—"}</td>
          </tr>
        </tbody>
      </table>
      {(self?.comment?.trim() || supervisor?.comment?.trim()) && (
        <div className="space-y-2 px-4 py-2.5 text-pretty text-[12px] leading-6 text-slate-600">
          {self?.comment?.trim() && (
            <div><span className="font-semibold text-[#002fa7]">自评说明：</span>{self.comment}</div>
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

  return (
    <>
      <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
        <DialogContent className="horizon-portal flex max-h-[88dvh] flex-col gap-0 overflow-hidden border-slate-200 bg-white p-0 sm:max-w-2xl">
          <DialogHeader className="border-b border-slate-200 px-5 py-3.5 pr-12 text-left">
          <div className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-xl bg-[#eef3ff] text-[#002fa7] ring-1 ring-[#dce6ff]">
              <Award className="size-4" />
            </span>
            <div>
              <DialogTitle className="text-balance text-sm font-bold text-[#1b2559]">月度绩效报表</DialogTitle>
              <DialogDescription className="mt-1 text-pretty text-[11px] tabular-nums text-slate-500">
                {userName} · {month}
              </DialogDescription>
            </div>
          </div>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-sm text-slate-400">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              正在读取绩效…
            </div>
          ) : report ? (
            <PerformanceBody report={report} />
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-200 bg-slate-50/70 py-16 text-center">
              <p className="text-pretty text-sm text-slate-500">
                {loaded ? "该成员本月尚未生成绩效报表。" : ""}
              </p>
              {canGenerate ? (
                <button
                  type="button"
                  onClick={generate}
                  disabled={generating || !userId}
                  className="hz-primary-action inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-60"
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
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-5 py-3">
            <span className="text-[11px] tabular-nums text-slate-500">
              {report.summary.generated_by === "ai" ? "AI 生成" : "本地生成"} ·{" "}
              {new Date(report.created_at).toLocaleString("zh-CN")}
            </span>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {canGenerate && (
                <button
                  type="button"
                  onClick={generate}
                  disabled={generating}
                  className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                >
                  {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  重新生成
                </button>
              )}
              {canGenerate && (
                <button
                  type="button"
                  onClick={() => setScoringOpen(true)}
                  className="inline-flex items-center gap-1 rounded-full border border-[#dce6ff] bg-white px-3 py-1.5 text-xs font-semibold text-[#002fa7] hover:bg-[#eef3ff]"
                >
                  <UserCheck className="h-3.5 w-3.5" />
                  {report.summary.supervisor_assessment ? "修改主管评分" : "主管评分"}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  downloadPerformanceXlsx(report).catch((err) =>
                    toast.error(err instanceof Error ? err.message : "导出失败"),
                  );
                }}
                className="hz-primary-action inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm"
              >
                <Download className="h-3.5 w-3.5" />
                下载正式绩效文件
              </button>
            </div>
          </div>
          )}
        </DialogContent>
      </Dialog>

      <RDPerformanceScoreDialog
        open={scoringOpen}
        onClose={() => setScoringOpen(false)}
        report={report}
        mode="supervisor"
        onSubmitted={(updated) => setReport(updated)}
      />
    </>
  );
}
