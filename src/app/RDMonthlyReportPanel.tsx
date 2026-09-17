import { Button } from "./components/ui/button";
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
import { t, useI18n } from "./lib/i18n";
import { Input } from "./components/ui/input";

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
      <div className="text-balance text-sm font-semibold text-slate-700">{title}</div>
      <p className="mt-1 text-pretty text-xs leading-5 text-muted-foreground">{description}</p>
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
                {t(meta.label)}
              </span>
              <span className="text-[11px] tabular-nums text-muted-foreground">{t("{count} 项", { count: groupItems.length })}</span>
            </div>
            <ul className="space-y-1.5">
              {groupItems.map((item) => (
                <li key={item.task_id || item.title} className="rounded-md bg-white px-2.5 py-2 text-[11px] text-slate-600 ring-1 ring-slate-100">
                  <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                    <span
                      className={cn(
                        "rounded px-1 py-0.5 text-[10px] font-semibold ring-1",
                        item.role === "owner"
                          ? "bg-accent text-primary ring-primary/20"
                          : "bg-slate-50 text-slate-500 ring-slate-200",
                      )}
                    >
                      {item.role === "owner" ? t("主责") : t("协作")}
                    </span>
                    <span className="text-pretty font-semibold text-slate-800">{item.title}</span>
                    <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{item.status_label}</span>
                    {item.progress != null && (
                      <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-primary">{t("进度")} {item.progress}%</span>
                    )}
                    {item.due_date && <span className="text-[10px] tabular-nums text-muted-foreground">{t("截止")} {item.due_date}</span>}
                    {item.overdue && <span className="rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-600">{t("逾期")}</span>}
                    {item.month_notes_count > 0 && <span className="text-[10px] tabular-nums text-muted-foreground">{t("记录")} {item.month_notes_count}</span>}
                    {item.month_attachments > 0 && <span className="text-[10px] tabular-nums text-primary">+{item.month_attachments} {t("附件")}</span>}
                  </div>
                  {item.group === "blocked" && item.blocked_reason ? (
                    <div className="mt-1 text-pretty text-[11px] text-red-600">{t("阻塞原因：")}{item.blocked_reason}</div>
                  ) : item.month_excerpt ? (
                    <div className="mt-1 text-pretty text-slate-600">{item.month_excerpt}</div>
                  ) : item.group === "stalled" ? (
                    <div className="mt-1 text-amber-600">{t("本月暂无进度记录")}</div>
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
  useI18n();
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
        toast.error(err instanceof Error ? err.message : t("月报加载失败，请稍后重试"));
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
        toast.error(err instanceof Error ? err.message : t("历史月报加载失败，请稍后重试"));
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
      toast.success(t("已为 {count} 位成员生成 {month} 月报", { count: result.count, month: result.month }));
      loadMonth();
      if (showHistory) loadHistory();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("批量生成失败"));
    } finally {
      setRegenerating(false);
    }
  }, [monthStr, loadMonth, loadHistory, showHistory]);

  const totalPages = Math.max(1, Math.ceil(reportsByMonth.length / REPORT_PAGE_SIZE));

  return (
    <div className="rd-horizon-monthly-report flex h-full flex-col gap-3">
      {/* ── 月报速览（始终可见；flex-1 让它在宽屏并排时撑满到与左侧 KPI 卡等高） ──── */}
      <div className={cn("hz-surface rd-horizon-monthly-surface flex-1 border border-slate-200 bg-white", spacious ? "p-6" : "p-4")}>
        {tabSlot}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span className="rd-horizon-monthly-primary flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-white shadow-sm">
              <CalendarRange className="size-4" aria-hidden="true" />
            </span>
            <div>
              <h3 className="flex items-center gap-2 text-balance text-sm font-bold text-slate-800">
                {t("月报速览")}
                {monthLoading && <Loader2 className="rd-horizon-monthly-accent size-3.5 animate-spin text-primary" aria-hidden="true" />}
              </h3>
              <p className="mt-0.5 text-pretty text-[11px] tabular-nums text-muted-foreground">{t("{month} · {count} 位成员已生成", { month: monthStr, count: monthMembers.length })}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Input
              type="month"
              value={monthStr}
              max={currentMonthStr()}
              onChange={(e) => { setMonthStr(e.target.value || currentMonthStr()); setExpandedMonthKey(null); }}
              aria-label={t("选择月报月份")}
              className="rd-horizon-monthly-control h-7 rounded-md border border-slate-200 bg-white px-2 text-xs tabular-nums text-slate-700 outline-none focus:border-primary/35 focus:ring-2 focus:ring-primary/15"
            />
            <Button variant="unstyled"
              type="button"
              onClick={loadMonth}
              disabled={monthLoading}
              className="rd-horizon-monthly-control inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition-colors hover:border-primary/35 hover:text-primary disabled:opacity-50"
            >
              <RefreshCw className={cn("size-3", monthLoading && "animate-spin")} aria-hidden="true" />
              {t("刷新")}
            </Button>
            {canRegenerate && (
              <Button
                type="button"
                disabled={regenerating}
                onClick={regenerate}
                className="hz-primary-action rd-horizon-monthly-primary inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-60"
              >
                {regenerating ? <Loader2 className="size-3 animate-spin" aria-hidden="true" /> : <Sparkles className="size-3" aria-hidden="true" />}
                {t("立即汇总")}
              </Button>
            )}
            <Button variant="unstyled"
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              aria-expanded={showHistory}
              className="rd-horizon-monthly-control inline-flex items-center gap-1 rounded-md border border-primary/20 bg-white px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-accent"
            >
              {t("查看全部")}
              <ChevronDown className={cn("size-3.5 transition-transform", showHistory && "rotate-180")} aria-hidden="true" />
            </Button>
          </div>
        </div>

        {/* 聚合徽章（当月任务级汇总） */}
        <div className={cn("flex flex-wrap items-center", spacious ? "mt-5 gap-2.5" : "mt-3 gap-2")}>
          {([
            { label: t("完成"), value: agg.completed, cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
            { label: t("推进"), value: agg.progressed, cls: "bg-blue-50 text-blue-700 ring-blue-200" },
            { label: t("停滞"), value: agg.stalled, cls: "bg-amber-50 text-amber-700 ring-amber-200" },
            { label: t("阻塞"), value: agg.blocked, cls: "bg-red-50 text-red-700 ring-red-200" },
          ] as const).map((b) => (
            <span key={b.label} className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1", b.cls)}>
              {t(b.label)}
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
                <Button variant="unstyled"
                  key={key}
                  type="button"
                  onClick={() => setExpandedMonthKey(active ? null : key)}
                  aria-pressed={active}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition-colors",
                    chip.bg,
                    chip.text,
                    chip.ring,
                    active && "ring-2 ring-offset-1",
                  )}
                >
                  <span className={cn("size-1.5 rounded-full", chip.dot)} aria-hidden="true" />
                  {report.user_name}
                </Button>
              );
            })}
          </div>
        ) : (
          <p className="rd-horizon-monthly-surface rd-horizon-monthly-inset mt-3 rounded-lg border border-dashed border-primary/20 bg-accent/40 px-3 py-3 text-center text-pretty text-[11px] text-slate-500">
            {monthLoading ? t("正在读取月报…") : canRegenerate ? t("该月暂无月报，点击「立即汇总」生成。") : t("该月暂无月报，每月 1 号自动汇总上月后展示。")}
          </p>
        )}

        {/* 点开某成员当月详情：右侧抽屉展示（月绩效报表入口在抽屉头部），不撑长页面 */}
        {expandedMonthReport && (
          <ReportDetailDrawer
            onClose={() => setExpandedMonthKey(null)}
            userName={expandedMonthReport.user_name}
            dateLabel={monthStr}
            trigger={expandedMonthReport.trigger}
            tone="blue"
            headerExtra={
              canRegenerate ? (
                <Button
                  type="button"
                  onClick={() =>
                    setPerfTarget({
                      userId: expandedMonthReport.user_id,
                      userName: expandedMonthReport.user_name,
                      month: monthStr,
                    })
                  }
                  className="hz-primary-action rd-horizon-monthly-primary inline-flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors"
                >
                  <Award className="size-3.5" aria-hidden="true" />
                  {t("月绩效报表")}
                </Button>
              ) : undefined
            }
          >
            <pre className="whitespace-pre-wrap break-words font-sans text-pretty text-[12.5px] leading-6 text-slate-700">
              {expandedMonthReport.summary.text}
            </pre>
            <MonthlyReportGroupedTasks report={expandedMonthReport} />
          </ReportDetailDrawer>
        )}
      </div>

      {/* ── 历史详情层（默认收起，带高度过渡） ─────────────────────────── */}
      <CollapseTransition open={showHistory}>
        <div className="hz-surface rd-horizon-monthly-surface border border-slate-200 bg-white p-5">
          <div className="mb-4 flex items-center justify-between gap-2">
            <div>
              <h2 className="flex items-center gap-2 text-balance text-sm font-bold text-slate-800">
                <CalendarRange className="rd-horizon-monthly-accent size-4 text-primary" aria-hidden="true" />
                {t("研发月报 · 历史")}
                <span className="rd-horizon-monthly-accent-surface rounded-full bg-accent px-1.5 text-xs tabular-nums text-primary">{historyReports.length}</span>
                {(reportMonthFilter || reportUserFilter) && (
                  <Button variant="unstyled"
                    type="button"
                    onClick={() => { setReportMonthFilter(""); setReportUserFilter(""); setReportPage(1); }}
                    className="rd-horizon-monthly-accent-surface ml-1 inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-primary transition-colors hover:bg-primary/10"
                  >
                    {t("清除筛选")}
                    <X className="size-3" aria-hidden="true" />
                  </Button>
                )}
              </h2>
              <p className="mt-0.5 text-pretty text-[11px] text-muted-foreground">
                {t("每月 1 号自动汇总上月或手动生成 · 历史保存最近 1000 条")}
              </p>
            </div>
            <Button variant="unstyled"
              type="button"
              onClick={loadHistory}
              disabled={historyLoading}
              className="rd-horizon-monthly-control inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition-colors hover:border-primary/35 hover:text-primary disabled:opacity-50"
            >
              <RefreshCw className={cn("size-3", historyLoading && "animate-spin")} aria-hidden="true" />
              {t("刷新")}
            </Button>
          </div>

          {/* History filters */}
          <div className="rd-horizon-monthly-surface rd-horizon-monthly-inset mb-3 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2">
            <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
              <div className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-slate-500">
                <CalendarRange className="size-3" aria-hidden="true" />
                {t("月份")}
              </div>
              <Input
                type="month"
                value={reportMonthFilter}
                max={currentMonthStr()}
                onChange={(e) => { setReportMonthFilter(e.target.value); setReportPage(1); }}
                aria-label={t("筛选月报月份")}
                className="rd-horizon-monthly-control h-7 w-36 shrink-0 rounded-md border border-slate-200 bg-white px-2 text-xs tabular-nums text-slate-700 outline-none focus:border-primary/35 focus:ring-2 focus:ring-primary/15"
              />
              {reportMonthFilter && (
                <Button variant="unstyled"
                  type="button"
                  onClick={() => { setReportMonthFilter(""); setReportPage(1); }}
                  className="rd-horizon-monthly-accent-surface shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 transition-colors hover:bg-accent hover:text-primary"
                >
                  {t("全部月份")}
                </Button>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <NativeSelect
                value={reportUserFilter}
                onChange={(e) => { setReportUserFilter(e.target.value); setReportPage(1); }}
                className="rd-horizon-monthly-control h-7 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-primary/35 focus:ring-2 focus:ring-primary/15"
              >
                <option value="">{t("全部成员")}</option>
                {reportUserOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </NativeSelect>
            </div>
          </div>

          {historyLoading ? (
            <MonthlyReportEmptyPanel title={t("正在读取月报")} description={t("请稍候，系统正在同步月报数据。")} />
          ) : historyReports.length === 0 ? (
            <MonthlyReportEmptyPanel
              title={reportMonthFilter || reportUserFilter ? t("该筛选下暂无月报") : t("暂无月报")}
              description={
                reportMonthFilter || reportUserFilter
                  ? t("请尝试切换月份或成员；或点击「清除筛选」查看全部。")
                  : t("每月 1 号自动汇总上月，或点击「立即汇总」手动生成后，会在这里展示。")
              }
            />
          ) : (
            <div className="space-y-3">
              {reportsByMonth.slice((reportPage - 1) * REPORT_PAGE_SIZE, reportPage * REPORT_PAGE_SIZE).map(([month, reportsInMonth]) => (
                <div key={month}>
                  <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold text-slate-500">
                    <span className="rd-horizon-monthly-accent-surface rounded-md bg-accent px-1.5 py-0.5 tabular-nums text-primary">{month}</span>
                    <span className="tabular-nums text-muted-foreground">{t("{count} 份月报", { count: reportsInMonth.length })}</span>
                  </div>
                  <ul className="space-y-2">
                    {reportsInMonth.map((report) => {
                      const expanded = expandedReportId === report.id;
                      const s = report.summary.stats;
                      return (
                        <li
                          key={report.id}
                          className="rd-horizon-monthly-history-item overflow-hidden rounded-xl border border-slate-200 bg-white transition-colors"
                        >
                          <Button variant="unstyled"
                            type="button"
                            onClick={() => setExpandedReportId(expanded ? null : report.id)}
                            aria-expanded={expanded}
                            className="rd-horizon-monthly-history-trigger flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50"
                          >
                            <div className="rd-horizon-monthly-accent-surface flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-xs font-bold text-primary">
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
                                  {report.trigger === "cron" ? t("自动") : t("手动")}
                                </span>
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] tabular-nums text-slate-500">
                                <span>{t("任务")} {s.total_tasks}</span>
                                {(s.as_collaborator ?? 0) > 0 && <span className="text-primary">{t("协作")} {s.as_collaborator}</span>}
                                <span className="text-emerald-600">{t("完成")} {s.completed}</span>
                                {(s.progressed ?? 0) > 0 && <span className="text-blue-600">{t("推进")} {s.progressed}</span>}
                                {(s.stalled ?? 0) > 0 && <span className="text-amber-600">{t("停滞")} {s.stalled}</span>}
                                {s.blocked > 0 && <span className="text-red-600">{t("阻塞")} {s.blocked}</span>}
                                <span className="text-muted-foreground">·</span>
                                <span>{t("进度记录")} {s.notes_count}</span>
                              </div>
                            </div>
                            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                          </Button>
                          {/* 详情改为右侧抽屉：长报告在抽屉内滚动，历史列表保持紧凑 */}
                          {expanded && (
                            <ReportDetailDrawer
                              onClose={() => setExpandedReportId(null)}
                              userName={report.user_name}
                              dateLabel={report.month}
                              trigger={report.trigger}
                              tone="blue"
                              headerExtra={
                                canRegenerate ? (
                                  <Button
                                    type="button"
                                    onClick={() => setPerfTarget({ userId: report.user_id, userName: report.user_name, month: report.month })}
                                    className="hz-primary-action rd-horizon-monthly-primary inline-flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors"
                                  >
                                    <Award className="size-3.5" aria-hidden="true" />
                                    {t("月绩效报表")}
                                  </Button>
                                ) : undefined
                              }
                            >
                              <pre className="whitespace-pre-wrap break-words font-sans text-pretty text-[12.5px] leading-6 text-slate-700">
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
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {t("共 {months} 个月 · 第 {page} / {total} 页", { months: reportsByMonth.length, page: reportPage, total: totalPages })}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button variant="unstyled"
                      type="button"
                      disabled={reportPage === 1}
                      onClick={() => setReportPage((p) => p - 1)}
                      aria-label={t("上一页")}
                      className="rd-horizon-monthly-control flex size-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition-colors hover:border-primary/35 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <ChevronLeft className="size-3.5" aria-hidden="true" />
                    </Button>
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map((pg) => (
                      <Button variant="unstyled"
                        key={pg}
                        type="button"
                        onClick={() => setReportPage(pg)}
                        className={cn(
                          "rd-horizon-monthly-control flex h-7 min-w-[28px] items-center justify-center rounded-md border px-1.5 text-xs font-semibold tabular-nums transition-colors",
                          pg === reportPage
                            ? "rd-horizon-monthly-primary border-primary bg-primary text-white"
                            : "border-slate-200 bg-white text-slate-600 hover:border-primary/35 hover:text-primary",
                        )}
                      >
                        {pg}
                      </Button>
                    ))}
                    <Button variant="unstyled"
                      type="button"
                      disabled={reportPage === totalPages}
                      onClick={() => setReportPage((p) => p + 1)}
                      aria-label={t("下一页")}
                      className="rd-horizon-monthly-control flex size-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition-colors hover:border-primary/35 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <ChevronRight className="size-3.5" aria-hidden="true" />
                    </Button>
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
