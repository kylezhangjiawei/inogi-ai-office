import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Award,
  CalendarRange,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { NativeSelect } from "./components/ui/native-select";
import { cn } from "./components/ui/utils";
import { CollapseTransition } from "./components/CollapseTransition";
import { ReportDetailDrawer } from "./components/ReportDetailDrawer";
import { RDPerformanceReportDialog } from "./RDPerformanceReportDialog";
import {
  fetchRdMonthlyReports,
  regenerateAllRdMonthlyReports,
  type RdMonthlyReport,
} from "./lib/rdApi";

// 月报「按任务分组」展示元数据（顺序即展示顺序）。
const MONTHLY_GROUP_META = [
  { key: "completed", emoji: "✅", label: "本月完成", badge: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  { key: "progressed", emoji: "🟦", label: "本月推进", badge: "bg-blue-50 text-blue-700 ring-blue-200" },
  { key: "blocked", emoji: "⚠️", label: "月末仍阻塞", badge: "bg-red-50 text-red-700 ring-red-200" },
  { key: "stalled", emoji: "🔔", label: "长期停滞", badge: "bg-amber-50 text-amber-700 ring-amber-200" },
] as const;

// 成员当月「最差状态」着色（严重度从高到低）。
type WorstStatus = "blocked" | "stalled" | "progressed" | "completed" | "none";
const STATUS_CHIP: Record<WorstStatus, { bg: string; text: string; ring: string; dot: string }> = {
  blocked: { bg: "bg-red-50", text: "text-red-700", ring: "ring-red-200", dot: "bg-red-500" },
  stalled: { bg: "bg-amber-50", text: "text-amber-700", ring: "ring-amber-200", dot: "bg-amber-500" },
  progressed: { bg: "bg-blue-50", text: "text-blue-700", ring: "ring-blue-200", dot: "bg-blue-500" },
  completed: { bg: "bg-emerald-50", text: "text-emerald-700", ring: "ring-emerald-200", dot: "bg-emerald-500" },
  none: { bg: "bg-slate-50", text: "text-slate-500", ring: "ring-slate-200", dot: "bg-slate-300" },
};
const STATUS_SEVERITY: Record<WorstStatus, number> = { blocked: 0, stalled: 1, progressed: 2, completed: 3, none: 4 };

function worstStatusOfMonthly(report: RdMonthlyReport): WorstStatus {
  const tasks = report.summary.tasks ?? [];
  const groups = new Set(tasks.map((t) => t.group));
  const stats = report.summary.stats;
  if (groups.has("blocked") || stats.blocked > 0) return "blocked";
  if (groups.has("stalled") || (stats.stalled ?? 0) > 0) return "stalled";
  if (groups.has("progressed") || (stats.progressed ?? 0) > 0) return "progressed";
  if (groups.has("completed") || stats.completed > 0) return "completed";
  return "none";
}

// 本地时区当前自然月（YYYY-MM；避免 UTC 偏移导致月初跨月不一致）。
function currentMonthStr(d = new Date()): string {
  const offset = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 7);
}

function MonthlyReportEmptyPanel({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-white/60 px-4 py-6 text-center">
      <div className="text-sm font-semibold text-slate-700">{title}</div>
      <p className="mt-1 text-xs leading-5 text-slate-400">{description}</p>
    </div>
  );
}

// 单份月报的「按任务分组」明细（月报无附件缩略图，仅展示要点）。
function MonthlyReportGroupedTasks({ report }: { report: RdMonthlyReport }) {
  const groupedTasks = report.summary.tasks ?? [];
  if (groupedTasks.length === 0) return null;
  return (
    <div className="mt-3 space-y-3">
      {MONTHLY_GROUP_META.map((meta) => {
        const groupItems = groupedTasks.filter((t) => t.group === meta.key);
        if (groupItems.length === 0) return null;
        return (
          <div key={meta.key}>
            <div className="mb-1.5 flex items-center gap-1.5">
              <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1", meta.badge)}>
                <span>{meta.emoji}</span>
                {meta.label}
              </span>
              <span className="text-[11px] text-slate-400">{groupItems.length} 项</span>
            </div>
            <ul className="space-y-1.5">
              {groupItems.map((item) => (
                <li key={item.task_id || item.title} className="rounded-md bg-white px-2.5 py-2 text-[11px] text-slate-600 ring-1 ring-slate-100">
                  <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                    <span
                      className={cn(
                        "rounded px-1 py-0.5 text-[10px] font-semibold ring-1",
                        item.role === "owner"
                          ? "bg-violet-50 text-violet-700 ring-violet-200"
                          : "bg-slate-50 text-slate-500 ring-slate-200",
                      )}
                    >
                      {item.role === "owner" ? "主责" : "协作"}
                    </span>
                    <span className="font-semibold text-slate-800">{item.title}</span>
                    <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{item.status_label}</span>
                    {item.progress != null && (
                      <span className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">进度 {item.progress}%</span>
                    )}
                    {item.due_date && <span className="text-[10px] text-slate-400">截止 {item.due_date}</span>}
                    {item.overdue && <span className="rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600">逾期</span>}
                    {item.month_notes_count > 0 && <span className="text-[10px] text-slate-400">记录 {item.month_notes_count}</span>}
                    {item.month_attachments > 0 && <span className="text-[10px] text-violet-600">+{item.month_attachments} 附件</span>}
                  </div>
                  {item.group === "blocked" && item.blocked_reason ? (
                    <div className="mt-1 text-[11px] text-red-600">阻塞原因：{item.blocked_reason}</div>
                  ) : item.month_excerpt ? (
                    <div className="mt-1 text-slate-600">{item.month_excerpt}</div>
                  ) : item.group === "stalled" ? (
                    <div className="mt-1 text-amber-600">本月暂无进度记录</div>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

const REPORT_PAGE_SIZE = 5; // month groups per page (history layer)

/**
 * 研发月报面板（共享）。顶部「月报速览」始终可见，供领导一眼掌握所选月份的团队产出；
 * 「查看全部」展开历史详情层（按月份分组 + 成员筛选 + 分页）。
 * 每位成员可一键打开「月绩效报表」（AI 评估 + 正式 Word 文件）。自带数据获取，可在任意页面挂载。
 */
export function RDMonthlyReportPanel({ canRegenerate, tabSlot, spacious = false }: { canRegenerate: boolean; tabSlot?: ReactNode; spacious?: boolean }) {
  const isMountedRef = useRef(true);
  useEffect(() => () => { isMountedRef.current = false; }, []);

  const [monthStr, setMonthStr] = useState<string>(() => currentMonthStr());
  const [regenerating, setRegenerating] = useState(false);

  // 月绩效报表弹窗目标（点击某成员的「月绩效报表」时设置）。month 随来源月份走，
  // 避免在历史层（可能是别的月份）误用速览所选月份。
  const [perfTarget, setPerfTarget] = useState<{ userId: string | null; userName: string; month: string } | null>(null);

  // ── 月报速览数据（随所选月份变化） ───────────────────────────────────────────
  const [monthReports, setMonthReports] = useState<RdMonthlyReport[]>([]);
  const [monthLoading, setMonthLoading] = useState(false);
  const [expandedMonthKey, setExpandedMonthKey] = useState<string | null>(null);

  const loadMonth = useCallback(() => {
    setMonthLoading(true);
    fetchRdMonthlyReports({ month: monthStr, limit: 500 })
      .then((list) => { if (isMountedRef.current) setMonthReports(list); })
      .catch((err) => {
        if (!isMountedRef.current) return;
        setMonthReports([]);
        toast.error(err instanceof Error ? err.message : "月报加载失败，请稍后重试");
      })
      .finally(() => { if (isMountedRef.current) setMonthLoading(false); });
  }, [monthStr]);

  useEffect(() => { loadMonth(); }, [loadMonth]);

  // 每人取该月最新一份，按严重度排序（阻塞/停滞优先，方便领导扫读）。
  const monthMembers = useMemo(() => {
    const map = new Map<string, RdMonthlyReport>();
    for (const r of monthReports) {
      const key = r.user_id ?? r.user_name;
      const existing = map.get(key);
      if (!existing || r.created_at > existing.created_at) map.set(key, r);
    }
    return Array.from(map.values()).sort((a, b) => {
      const sa = STATUS_SEVERITY[worstStatusOfMonthly(a)];
      const sb = STATUS_SEVERITY[worstStatusOfMonthly(b)];
      if (sa !== sb) return sa - sb;
      return a.user_name.localeCompare(b.user_name);
    });
  }, [monthReports]);

  const agg = useMemo(() => {
    let completed = 0, progressed = 0, stalled = 0, blocked = 0;
    for (const r of monthMembers) {
      for (const t of r.summary.tasks ?? []) {
        if (t.group === "completed") completed++;
        else if (t.group === "progressed") progressed++;
        else if (t.group === "stalled") stalled++;
        else if (t.group === "blocked") blocked++;
      }
    }
    return { completed, progressed, stalled, blocked };
  }, [monthMembers]);

  const expandedMonthReport = useMemo(
    () => monthMembers.find((r) => (r.user_id ?? r.user_name) === expandedMonthKey) ?? null,
    [monthMembers, expandedMonthKey],
  );

  // ── 历史详情层（默认收起，首次展开时按需加载） ──────────────────────────────
  const [showHistory, setShowHistory] = useState(false);
  const [historyReports, setHistoryReports] = useState<RdMonthlyReport[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [expandedReportId, setExpandedReportId] = useState<string | null>(null);
  const [reportMonthFilter, setReportMonthFilter] = useState<string>("");
  const [reportUserFilter, setReportUserFilter] = useState<string>("");
  const [reportPage, setReportPage] = useState(1);

  const loadHistory = useCallback(() => {
    setHistoryLoading(true);
    fetchRdMonthlyReports({
      month: reportMonthFilter || undefined,
      user_id: reportUserFilter || undefined,
      limit: reportMonthFilter || reportUserFilter ? 500 : 80,
    })
      .then((list) => { if (isMountedRef.current) setHistoryReports(list); })
      .catch((err) => {
        if (!isMountedRef.current) return;
        setHistoryReports([]);
        toast.error(err instanceof Error ? err.message : "历史月报加载失败，请稍后重试");
      })
      .finally(() => { if (isMountedRef.current) setHistoryLoading(false); });
  }, [reportMonthFilter, reportUserFilter]);

  useEffect(() => {
    if (!showHistory) return;
    loadHistory();
  }, [showHistory, loadHistory]);

  const reportUserOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [];
    const seen = new Set<string>();
    for (const r of [...monthReports, ...historyReports]) {
      const id = r.user_id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      opts.push({ value: id, label: r.user_name });
    }
    return opts.sort((a, b) => a.label.localeCompare(b.label));
  }, [monthReports, historyReports]);

  const reportsByMonth = useMemo(() => {
    const map = new Map<string, RdMonthlyReport[]>();
    for (const r of historyReports) {
      const arr = map.get(r.month) ?? [];
      arr.push(r);
      map.set(r.month, arr);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [historyReports]);

  const regenerate = useCallback(async () => {
    setRegenerating(true);
    try {
      const result = await regenerateAllRdMonthlyReports(monthStr);
      toast.success(`已为 ${result.count} 位成员生成 ${result.month} 月报`);
      loadMonth();
      if (showHistory) loadHistory();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "批量生成失败");
    } finally {
      setRegenerating(false);
    }
  }, [monthStr, loadMonth, loadHistory, showHistory]);

  const totalPages = Math.max(1, Math.ceil(reportsByMonth.length / REPORT_PAGE_SIZE));

  return (
    <div className="flex h-full flex-col gap-3">
      {/* ── 月报速览（始终可见；flex-1 让它在宽屏并排时撑满到与左侧 KPI 卡等高） ──── */}
      <div className={cn("flex-1 rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50/40 shadow-sm", spacious ? "p-6" : "p-4")}>
        {tabSlot}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white shadow-sm">
              <CalendarRange className="h-4 w-4" />
            </span>
            <div>
              <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800">
                月报速览
                {monthLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" />}
              </h3>
              <p className="mt-0.5 text-[11px] text-slate-400">{monthStr} · {monthMembers.length} 位成员已生成</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="month"
              value={monthStr}
              max={currentMonthStr()}
              onChange={(e) => { setMonthStr(e.target.value || currentMonthStr()); setExpandedMonthKey(null); }}
              className="h-7 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-100"
            />
            <button
              type="button"
              onClick={loadMonth}
              disabled={monthLoading}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition-all hover:border-amber-200 hover:text-amber-600 disabled:opacity-50"
            >
              <RefreshCw className={cn("h-3 w-3", monthLoading && "animate-spin")} />
              刷新
            </button>
            {canRegenerate && (
              <button
                type="button"
                disabled={regenerating}
                onClick={regenerate}
                className="inline-flex items-center gap-1 rounded-md bg-amber-500 px-2.5 py-1 text-xs font-medium text-white shadow-sm transition-all hover:bg-amber-600 disabled:opacity-60"
              >
                {regenerating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                立即汇总
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-white px-2.5 py-1 text-xs font-medium text-amber-700 transition-all hover:bg-amber-50"
            >
              查看全部
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showHistory && "rotate-180")} />
            </button>
          </div>
        </div>

        {/* 聚合徽章（当月任务级汇总） */}
        <div className={cn("flex flex-wrap items-center", spacious ? "mt-5 gap-2.5" : "mt-3 gap-2")}>
          {([
            { label: "完成", value: agg.completed, cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
            { label: "推进", value: agg.progressed, cls: "bg-blue-50 text-blue-700 ring-blue-200" },
            { label: "停滞", value: agg.stalled, cls: "bg-amber-50 text-amber-700 ring-amber-200" },
            { label: "阻塞", value: agg.blocked, cls: "bg-red-50 text-red-700 ring-red-200" },
          ] as const).map((b) => (
            <span key={b.label} className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1", b.cls)}>
              {b.label}
              <span className="tabular-nums">{b.value}</span>
            </span>
          ))}
        </div>

        {/* 成员胶囊（按当月最差状态着色） */}
        {monthMembers.length > 0 ? (
          <div className={cn("flex flex-wrap", spacious ? "mt-4 gap-2" : "mt-3 gap-1.5")}>
            {monthMembers.map((report) => {
              const key = report.user_id ?? report.user_name;
              const chip = STATUS_CHIP[worstStatusOfMonthly(report)];
              const active = expandedMonthKey === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setExpandedMonthKey(active ? null : key)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition-all",
                    chip.bg,
                    chip.text,
                    chip.ring,
                    active && "ring-2 ring-offset-1",
                  )}
                >
                  <span className={cn("h-1.5 w-1.5 rounded-full", chip.dot)} />
                  {report.user_name}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="mt-3 rounded-lg border border-dashed border-amber-200 bg-white/60 px-3 py-3 text-center text-[11px] text-slate-400">
            {monthLoading ? "正在读取月报…" : canRegenerate ? "该月暂无月报，点击「立即汇总」生成。" : "该月暂无月报，每月 1 号自动汇总上月后展示。"}
          </p>
        )}

        {/* 点开某成员当月详情：右侧抽屉展示（月绩效报表入口在抽屉头部），不撑长页面 */}
        {expandedMonthReport && (
          <ReportDetailDrawer
            onClose={() => setExpandedMonthKey(null)}
            userName={expandedMonthReport.user_name}
            dateLabel={monthStr}
            trigger={expandedMonthReport.trigger}
            tone="amber"
            headerExtra={
              canRegenerate ? (
                <button
                  type="button"
                  onClick={() =>
                    setPerfTarget({
                      userId: expandedMonthReport.user_id,
                      userName: expandedMonthReport.user_name,
                      month: monthStr,
                    })
                  }
                  className="inline-flex shrink-0 items-center gap-1 rounded-md bg-amber-500 px-2.5 py-1 text-xs font-semibold text-white shadow-sm transition-all hover:bg-amber-600"
                >
                  <Award className="h-3.5 w-3.5" />
                  月绩效报表
                </button>
              ) : undefined
            }
          >
            <pre className="whitespace-pre-wrap break-words font-sans text-[12.5px] leading-6 text-slate-700">
              {expandedMonthReport.summary.text}
            </pre>
            <MonthlyReportGroupedTasks report={expandedMonthReport} />
          </ReportDetailDrawer>
        )}
      </div>

      {/* ── 历史详情层（默认收起，带高度过渡） ─────────────────────────── */}
      <CollapseTransition open={showHistory}>
        <div className="rounded-2xl border border-amber-100 bg-amber-50/40 p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-2">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800">
                <CalendarRange className="h-4 w-4 text-amber-500" />
                研发月报 · 历史
                <span className="rounded-full bg-amber-100 px-1.5 text-xs text-amber-700">{historyReports.length}</span>
                {(reportMonthFilter || reportUserFilter) && (
                  <button
                    type="button"
                    onClick={() => { setReportMonthFilter(""); setReportUserFilter(""); setReportPage(1); }}
                    className="ml-1 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 hover:bg-amber-200"
                  >
                    清除筛选
                    <X className="h-3 w-3" />
                  </button>
                )}
              </h2>
              <p className="mt-0.5 text-[11px] text-slate-400">
                每月 1 号自动汇总上月或手动生成 · 历史保存最近 1000 条
              </p>
            </div>
            <button
              type="button"
              onClick={loadHistory}
              disabled={historyLoading}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition-all hover:border-amber-200 hover:text-amber-600 disabled:opacity-50"
            >
              <RefreshCw className={cn("h-3 w-3", historyLoading && "animate-spin")} />
              刷新
            </button>
          </div>

          {/* History filters */}
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-100 bg-white/60 px-3 py-2">
            <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
              <div className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-slate-500">
                <CalendarRange className="h-3 w-3" />
                月份
              </div>
              <input
                type="month"
                value={reportMonthFilter}
                max={currentMonthStr()}
                onChange={(e) => { setReportMonthFilter(e.target.value); setReportPage(1); }}
                className="h-7 w-36 shrink-0 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-100"
              />
              {reportMonthFilter && (
                <button
                  type="button"
                  onClick={() => { setReportMonthFilter(""); setReportPage(1); }}
                  className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 transition-colors hover:bg-amber-100 hover:text-amber-700"
                >
                  全部月份
                </button>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <NativeSelect
                value={reportUserFilter}
                onChange={(e) => { setReportUserFilter(e.target.value); setReportPage(1); }}
                className="h-7 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-100"
              >
                <option value="">全部成员</option>
                {reportUserOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </NativeSelect>
            </div>
          </div>

          {historyLoading ? (
            <MonthlyReportEmptyPanel title="正在读取月报" description="请稍候，系统正在同步月报数据。" />
          ) : historyReports.length === 0 ? (
            <MonthlyReportEmptyPanel
              title={reportMonthFilter || reportUserFilter ? "该筛选下暂无月报" : "暂无月报"}
              description={
                reportMonthFilter || reportUserFilter
                  ? "请尝试切换月份或成员；或点击「清除筛选」查看全部。"
                  : "每月 1 号自动汇总上月，或点击「立即汇总」手动生成后，会在这里展示。"
              }
            />
          ) : (
            <div className="space-y-3">
              {reportsByMonth.slice((reportPage - 1) * REPORT_PAGE_SIZE, reportPage * REPORT_PAGE_SIZE).map(([month, reportsInMonth]) => (
                <div key={month}>
                  <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold text-slate-500">
                    <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-amber-700">{month}</span>
                    <span className="text-slate-400">{reportsInMonth.length} 份月报</span>
                  </div>
                  <ul className="space-y-2">
                    {reportsInMonth.map((report) => {
                      const expanded = expandedReportId === report.id;
                      const s = report.summary.stats;
                      return (
                        <li
                          key={report.id}
                          className="overflow-hidden rounded-xl border border-amber-100 bg-white transition-colors"
                        >
                          <button
                            type="button"
                            onClick={() => setExpandedReportId(expanded ? null : report.id)}
                            className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-amber-50/40"
                          >
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-xs font-bold text-amber-700">
                              {report.user_name.slice(0, 1)}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                <span className="text-sm font-semibold text-slate-800">{report.user_name}</span>
                                <span className="text-xs tabular-nums text-slate-500">{report.month}</span>
                                <span
                                  className={cn(
                                    "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                                    report.trigger === "cron"
                                      ? "bg-slate-100 text-slate-600"
                                      : "bg-blue-100 text-blue-700",
                                  )}
                                >
                                  {report.trigger === "cron" ? "自动" : "手动"}
                                </span>
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
                                <span>任务 {s.total_tasks}</span>
                                {(s.as_collaborator ?? 0) > 0 && <span className="text-violet-600">协作 {s.as_collaborator}</span>}
                                <span className="text-emerald-600">完成 {s.completed}</span>
                                {(s.progressed ?? 0) > 0 && <span className="text-blue-600">推进 {s.progressed}</span>}
                                {(s.stalled ?? 0) > 0 && <span className="text-amber-600">停滞 {s.stalled}</span>}
                                {s.blocked > 0 && <span className="text-red-600">阻塞 {s.blocked}</span>}
                                <span className="text-slate-400">·</span>
                                <span>进度记录 {s.notes_count}</span>
                              </div>
                            </div>
                            <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                          </button>
                          {/* 详情改为右侧抽屉：长报告在抽屉内滚动，历史列表保持紧凑 */}
                          {expanded && (
                            <ReportDetailDrawer
                              onClose={() => setExpandedReportId(null)}
                              userName={report.user_name}
                              dateLabel={report.month}
                              trigger={report.trigger}
                              tone="amber"
                              headerExtra={
                                canRegenerate ? (
                                  <button
                                    type="button"
                                    onClick={() => setPerfTarget({ userId: report.user_id, userName: report.user_name, month: report.month })}
                                    className="inline-flex shrink-0 items-center gap-1 rounded-md bg-amber-500 px-2.5 py-1 text-xs font-semibold text-white shadow-sm transition-all hover:bg-amber-600"
                                  >
                                    <Award className="h-3.5 w-3.5" />
                                    月绩效报表
                                  </button>
                                ) : undefined
                              }
                            >
                              <pre className="whitespace-pre-wrap break-words font-sans text-[12.5px] leading-6 text-slate-700">
                                {report.summary.text}
                              </pre>
                              <MonthlyReportGroupedTasks report={report} />
                            </ReportDetailDrawer>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
              {/* pagination */}
              {reportsByMonth.length > REPORT_PAGE_SIZE && (
                <div className="flex items-center justify-between pt-1">
                  <span className="text-[11px] text-slate-400">
                    共 {reportsByMonth.length} 个月 · 第 {reportPage} / {totalPages} 页
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={reportPage === 1}
                      onClick={() => setReportPage((p) => p - 1)}
                      className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition hover:border-amber-300 hover:text-amber-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </button>
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map((pg) => (
                      <button
                        key={pg}
                        type="button"
                        onClick={() => setReportPage(pg)}
                        className={cn(
                          "flex h-7 min-w-[28px] items-center justify-center rounded-md border px-1.5 text-xs font-semibold transition",
                          pg === reportPage
                            ? "border-amber-400 bg-amber-500 text-white"
                            : "border-slate-200 bg-white text-slate-600 hover:border-amber-300 hover:text-amber-700",
                        )}
                      >
                        {pg}
                      </button>
                    ))}
                    <button
                      type="button"
                      disabled={reportPage === totalPages}
                      onClick={() => setReportPage((p) => p + 1)}
                      className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition hover:border-amber-300 hover:text-amber-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </CollapseTransition>

      {/* 月绩效报表弹窗（AI 评估 + 正式 Word 文件下载） */}
      <RDPerformanceReportDialog
        open={!!perfTarget}
        onClose={() => setPerfTarget(null)}
        userId={perfTarget?.userId ?? null}
        userName={perfTarget?.userName ?? ""}
        month={perfTarget?.month ?? monthStr}
        canGenerate={canRegenerate}
      />
    </div>
  );
}
