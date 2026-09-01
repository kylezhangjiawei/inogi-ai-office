import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  CalendarDays,
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
import { Button } from "./components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover";
import { Calendar } from "./components/ui/calendar";
import { cn } from "./components/ui/utils";
import { CollapseTransition } from "./components/CollapseTransition";
import { ReportDetailDrawer } from "./components/ReportDetailDrawer";
import { ProgressAttachmentGrid } from "./RDProgressEvidence";
import {
  fetchRdDailyReports,
  fetchRdTaskProgressNoteMap,
  regenerateAllRdDailyReports,
  type RdDailyReport,
  type RdTaskProgressNote,
} from "./lib/rdApi";
import { t, useI18n } from "./lib/i18n";

// 日报「按任务分组」展示元数据（顺序即展示顺序）。
const DAILY_REPORT_GROUP_META = [
  { key: "completed_today", emoji: "✅", label: "今日完成", badge: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  { key: "progressed", emoji: "🟦", label: "今日有进展", badge: "bg-blue-50 text-blue-700 ring-blue-200" },
  { key: "stalled", emoji: "🔔", label: "停滞·今日无进展", badge: "bg-amber-50 text-amber-700 ring-amber-200" },
  { key: "blocked", emoji: "⚠️", label: "阻塞·需关注", badge: "bg-red-50 text-red-700 ring-red-200" },
] as const;

// 成员当日「最差状态」着色（严重度从高到低）。
type WorstStatus = "blocked" | "stalled" | "progressed" | "completed" | "none";
const STATUS_CHIP: Record<WorstStatus, { bg: string; text: string; ring: string; dot: string; label: string }> = {
  blocked: { bg: "bg-red-50", text: "text-red-700", ring: "ring-red-200", dot: "bg-red-500", label: "阻塞" },
  stalled: { bg: "bg-amber-50", text: "text-amber-700", ring: "ring-amber-200", dot: "bg-amber-500", label: "停滞" },
  progressed: { bg: "bg-blue-50", text: "text-blue-700", ring: "ring-blue-200", dot: "bg-blue-500", label: "有进展" },
  completed: { bg: "bg-emerald-50", text: "text-emerald-700", ring: "ring-emerald-200", dot: "bg-emerald-500", label: "已完成" },
  none: { bg: "bg-slate-50", text: "text-slate-500", ring: "ring-slate-200", dot: "bg-slate-300", label: "—" },
};
const STATUS_SEVERITY: Record<WorstStatus, number> = { blocked: 0, stalled: 1, progressed: 2, completed: 3, none: 4 };

function worstStatusOfReport(report: RdDailyReport): WorstStatus {
  const tasks = report.summary.tasks ?? [];
  const groups = new Set(tasks.map((t) => t.group));
  const stats = report.summary.stats;
  if (groups.has("blocked") || stats.blocked > 0) return "blocked";
  if (groups.has("stalled") || (stats.stalled ?? 0) > 0) return "stalled";
  if (groups.has("progressed")) return "progressed";
  if (groups.has("completed_today") || stats.completed > 0) return "completed";
  return "none";
}

// 本地时区当日（避免 UTC 偏移导致跨日不一致）。
function isoLocalDate(d = new Date()): string {
  const offset = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 10);
}

// YYYY-MM-DD 字符串 → 本地零点 Date（供日历回填选中态；非法返回 undefined）。
function parseLocalDate(value: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return undefined;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

async function fetchNoteMapFor(_list: RdDailyReport[]): Promise<Record<string, RdTaskProgressNote[]>> {
  // 一次性拉「全部留痕」聚合接口（后端按权限过滤），替代按 note_refs 逐任务并发拉取。
  // 后者任务多时会瞬间打出上百个 GET /task-progress-notes/:id，触发后端 100 次/60s 限流 → 429。
  // 消费端均按 task_id 索引，多出的键不会被读取，行为不变。
  return fetchRdTaskProgressNoteMap();
}

function DailyReportEmptyPanel({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-white/60 px-4 py-6 text-center">
      <div className="text-balance text-sm font-semibold text-slate-700">{title}</div>
      <p className="mt-1 text-pretty text-xs leading-5 text-slate-400">{description}</p>
    </div>
  );
}

// 单份日报的「按任务分组」明细（新版）；旧日报回退到 note_refs。
function DailyReportGroupedTasks({
  report,
  progressNoteById,
}: {
  report: RdDailyReport;
  progressNoteById: Map<string, RdTaskProgressNote>;
}) {
  const groupedTasks = report.summary.tasks ?? [];
  if (groupedTasks.length > 0) {
    return (
      <div className="mt-3 space-y-3">
        {DAILY_REPORT_GROUP_META.map((meta) => {
          const groupItems = groupedTasks.filter((t) => t.group === meta.key);
          if (groupItems.length === 0) return null;
          return (
            <div key={meta.key}>
              <div className="mb-1.5 flex items-center gap-1.5">
                <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1", meta.badge)}>
                  <span>{meta.emoji}</span>
                  {t(meta.label)}
                </span>
                <span className="text-[11px] tabular-nums text-slate-400">{t("{count} 项", { count: groupItems.length })}</span>
              </div>
              <ul className="space-y-1.5">
                {groupItems.map((item) => {
                  const note = item.today_note_id ? progressNoteById.get(item.today_note_id) : undefined;
                  const attachments = note?.attachments ?? [];
                  return (
                    <li key={item.task_id || item.title} className="rounded-md bg-white px-2.5 py-2 text-[11px] text-slate-600 ring-1 ring-slate-100">
                      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                        <span
                          className={cn(
                            "rounded px-1 py-0.5 text-[10px] font-semibold ring-1",
                            item.role === "owner"
                              ? "bg-blue-50 text-[#002fa7] ring-blue-200"
                              : "bg-slate-50 text-slate-500 ring-slate-200",
                          )}
                        >
                          {item.role === "owner" ? t("主责") : t("协作")}
                        </span>
                        <span className="text-pretty font-semibold text-slate-800">{item.title}</span>
                        <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{item.status_label}</span>
                        {item.progress != null && (
                          <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-[#002fa7]">{t("进度")} {item.progress}%</span>
                        )}
                        {item.due_date && <span className="text-[10px] tabular-nums text-slate-400">{t("截止")} {item.due_date}</span>}
                        {item.today_attachments > 0 && <span className="text-[10px] tabular-nums text-[#002fa7]">+{item.today_attachments} {t("附件")}</span>}
                      </div>
                      {item.group === "blocked" && item.blocked_reason ? (
                        <div className="mt-1 text-pretty text-[11px] text-red-600">{t("阻塞原因：")}{item.blocked_reason}</div>
                      ) : item.today_excerpt ? (
                        <div className="mt-1 text-pretty text-slate-600">{item.today_excerpt}</div>
                      ) : item.group === "stalled" ? (
                        <div className="mt-1 text-amber-600">{t("今日暂无进度记录")}</div>
                      ) : null}
                      {attachments.length > 0 && (
                        <ProgressAttachmentGrid attachments={attachments} compact className="mt-2" />
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    );
  }
  if (report.summary.note_refs.length > 0) {
    return (
      <div className="mt-3">
        <div className="mb-1.5 text-[11px] font-semibold text-slate-500">{t("关联进度记录")}</div>
        <ul className="space-y-1">
          {report.summary.note_refs.map((ref) => {
            const note = progressNoteById.get(ref.note_id);
            const attachments = note?.attachments ?? [];
            return (
              <li key={ref.note_id} className="rounded-md bg-white px-2.5 py-1.5 text-[11px] text-slate-600 ring-1 ring-blue-100">
                <span className="font-mono text-slate-400">{ref.task_id}</span>
                <span className="mx-1.5 text-slate-300">·</span>
                {ref.progress != null && <span className="mr-1.5 rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-[#002fa7]">{t("进度")} {ref.progress}%</span>}
                <span className="text-pretty text-slate-700">{ref.excerpt || "—"}</span>
                {ref.attachments_count > 0 && (
                  <span className="ml-1.5 text-[10px] tabular-nums text-[#002fa7]">+{ref.attachments_count} {t("附件")}</span>
                )}
                {attachments.length > 0 && (
                  <ProgressAttachmentGrid attachments={attachments} compact className="mt-2" />
                )}
              </li>
            );
          })}
        </ul>
      </div>
    );
  }
  return null;
}

const REPORT_PAGE_SIZE = 5; // date groups per page (history layer)

/**
 * 研发日报面板（共享）。顶部「今日速览」始终可见，供领导一眼掌握当日团队状态；
 * 「查看全部」展开历史详情层（按日期分组 + 成员筛选 + 分页）。自带数据获取，可在任意页面挂载。
 */
export function RDDailyReportPanel({ canRegenerate, tabSlot, spacious = false }: { canRegenerate: boolean; tabSlot?: ReactNode; spacious?: boolean }) {
  useI18n();
  const isMountedRef = useRef(true);
  useEffect(() => () => { isMountedRef.current = false; }, []);

  const todayStr = useMemo(() => isoLocalDate(), []);
  const [progressNoteMap, setProgressNoteMap] = useState<Record<string, RdTaskProgressNote[]>>({});
  const [regeneratingReports, setRegeneratingReports] = useState(false);

  const progressNoteById = useMemo(() => {
    const map = new Map<string, RdTaskProgressNote>();
    for (const notes of Object.values(progressNoteMap)) {
      for (const note of notes) map.set(note.id, note);
    }
    return map;
  }, [progressNoteMap]);

  // ── 今日速览数据（始终为当日，独立于历史筛选） ──────────────────────────────
  const [todayReports, setTodayReports] = useState<RdDailyReport[]>([]);
  const [todayLoading, setTodayLoading] = useState(false);
  const [expandedTodayKey, setExpandedTodayKey] = useState<string | null>(null);

  const loadToday = useCallback(() => {
    setTodayLoading(true);
    fetchRdDailyReports({ date: todayStr, limit: 500 })
      .then(async (list) => ({ list, noteMap: await fetchNoteMapFor(list) }))
      .then(({ list, noteMap }) => {
        if (!isMountedRef.current) return;
        setTodayReports(list);
        setProgressNoteMap((prev) => ({ ...prev, ...noteMap }));
      })
      .catch((err) => {
        if (!isMountedRef.current) return;
        setTodayReports([]);
        toast.error(err instanceof Error ? err.message : t("今日日报加载失败，请稍后重试"));
      })
      .finally(() => { if (isMountedRef.current) setTodayLoading(false); });
  }, [todayStr]);

  useEffect(() => { loadToday(); }, [loadToday]);

  // 每人取当日最新一份，按严重度排序（阻塞/停滞优先，方便领导扫读）。
  const todayMembers = useMemo(() => {
    const map = new Map<string, RdDailyReport>();
    for (const r of todayReports) {
      const key = r.user_id ?? r.user_name;
      const existing = map.get(key);
      if (!existing || r.created_at > existing.created_at) map.set(key, r);
    }
    return Array.from(map.values()).sort((a, b) => {
      const sa = STATUS_SEVERITY[worstStatusOfReport(a)];
      const sb = STATUS_SEVERITY[worstStatusOfReport(b)];
      if (sa !== sb) return sa - sb;
      return a.user_name.localeCompare(b.user_name);
    });
  }, [todayReports]);

  const agg = useMemo(() => {
    let completed = 0, progressed = 0, stalled = 0, blocked = 0;
    for (const r of todayMembers) {
      for (const t of r.summary.tasks ?? []) {
        if (t.group === "completed_today") completed++;
        else if (t.group === "progressed") progressed++;
        else if (t.group === "stalled") stalled++;
        else if (t.group === "blocked") blocked++;
      }
    }
    return { completed, progressed, stalled, blocked };
  }, [todayMembers]);

  const expandedTodayReport = useMemo(
    () => todayMembers.find((r) => (r.user_id ?? r.user_name) === expandedTodayKey) ?? null,
    [todayMembers, expandedTodayKey],
  );

  // ── 历史详情层（默认收起，首次展开时按需加载） ──────────────────────────────
  const [showHistory, setShowHistory] = useState(false);
  const [historyReports, setHistoryReports] = useState<RdDailyReport[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [expandedReportId, setExpandedReportId] = useState<string | null>(null);
  const [reportDateFilter, setReportDateFilter] = useState<string>("");
  const [reportUserFilter, setReportUserFilter] = useState<string>("");
  const [reportPage, setReportPage] = useState(1);

  const loadHistory = useCallback(() => {
    setHistoryLoading(true);
    fetchRdDailyReports({
      date: reportDateFilter || undefined,
      user_id: reportUserFilter || undefined,
      limit: reportDateFilter || reportUserFilter ? 500 : 50,
    })
      .then(async (list) => ({ list, noteMap: await fetchNoteMapFor(list) }))
      .then(({ list, noteMap }) => {
        if (!isMountedRef.current) return;
        setHistoryReports(list);
        setProgressNoteMap((prev) => ({ ...prev, ...noteMap }));
      })
      .catch((err) => {
        if (!isMountedRef.current) return;
        setHistoryReports([]);
        toast.error(err instanceof Error ? err.message : t("历史日报加载失败，请稍后重试"));
      })
      .finally(() => { if (isMountedRef.current) setHistoryLoading(false); });
  }, [reportDateFilter, reportUserFilter]);

  useEffect(() => {
    if (!showHistory) return;
    loadHistory();
  }, [showHistory, loadHistory]);

  const reportUserOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [];
    const seen = new Set<string>();
    for (const r of [...todayReports, ...historyReports]) {
      const id = r.user_id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      opts.push({ value: id, label: r.user_name });
    }
    return opts.sort((a, b) => a.label.localeCompare(b.label));
  }, [todayReports, historyReports]);

  const reportsByDate = useMemo(() => {
    const map = new Map<string, RdDailyReport[]>();
    for (const r of historyReports) {
      const arr = map.get(r.date) ?? [];
      arr.push(r);
      map.set(r.date, arr);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [historyReports]);

  const regenerate = useCallback(async () => {
    setRegeneratingReports(true);
    try {
      const result = await regenerateAllRdDailyReports();
      toast.success(t("已为 {count} 位成员生成 {date} 日报", { count: result.count, date: result.date }));
      loadToday();
      if (showHistory) loadHistory();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("批量生成失败"));
    } finally {
      setRegeneratingReports(false);
    }
  }, [loadToday, loadHistory, showHistory]);

  const totalPages = Math.max(1, Math.ceil(reportsByDate.length / REPORT_PAGE_SIZE));

  return (
    <div className="rd-horizon-daily-report flex h-full flex-col gap-3">
      {/* ── 今日速览（始终可见；flex-1 让它在宽屏并排时撑满到与左侧 KPI 卡等高） ──── */}
      <div className={cn("hz-surface flex-1 border border-slate-200 bg-white", spacious ? "p-6" : "p-4")}>
        {tabSlot}
        <div className={cn("flex flex-wrap items-center justify-between", spacious ? "gap-3" : "gap-2")}>
          <div className="flex items-center gap-2.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#002fa7] text-white shadow-sm">
              <CalendarDays className="size-4" aria-hidden="true" />
            </span>
            <div>
              <h3 className="flex items-center gap-2 text-balance text-sm font-bold text-slate-800">
                {t("今日日报速览")}
                {todayLoading && <Loader2 className="size-3.5 animate-spin text-[#002fa7]" aria-hidden="true" />}
              </h3>
              <p className="mt-0.5 text-pretty text-[11px] tabular-nums text-slate-400">{t("{date} · {count} 位成员已生成", { date: todayStr, count: todayMembers.length })}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={loadToday}
              disabled={todayLoading}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition-colors hover:border-blue-300 hover:text-[#002fa7] disabled:opacity-50"
            >
              <RefreshCw className={cn("size-3", todayLoading && "animate-spin")} aria-hidden="true" />
              {t("刷新")}
            </button>
            {canRegenerate && (
              <button
                type="button"
                disabled={regeneratingReports}
                onClick={regenerate}
                className="hz-primary-action inline-flex items-center gap-1 rounded-md bg-[#002fa7] px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-[#002581] disabled:opacity-60"
              >
                {regeneratingReports ? <Loader2 className="size-3 animate-spin" aria-hidden="true" /> : <Sparkles className="size-3" aria-hidden="true" />}
                {t("立即汇总")}
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              aria-expanded={showHistory}
              className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-white px-2.5 py-1 text-xs font-medium text-[#002fa7] transition-colors hover:bg-blue-50"
            >
              {t("查看全部")}
              <ChevronDown className={cn("size-3.5 transition-transform", showHistory && "rotate-180")} aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* 聚合徽章（当日任务级汇总） */}
        <div className={cn("flex flex-wrap items-center", spacious ? "mt-5 gap-2.5" : "mt-3 gap-2")}>
          {([
            { label: t("完成"), value: agg.completed, cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
            { label: t("推进中"), value: agg.progressed, cls: "bg-blue-50 text-blue-700 ring-blue-200" },
            { label: t("停滞"), value: agg.stalled, cls: "bg-amber-50 text-amber-700 ring-amber-200" },
            { label: t("阻塞"), value: agg.blocked, cls: "bg-red-50 text-red-700 ring-red-200" },
          ] as const).map((b) => (
            <span key={b.label} className={cn("inline-flex items-center gap-1 rounded-full font-semibold ring-1", spacious ? "px-3 py-1.5 text-xs" : "px-2.5 py-1 text-xs", b.cls)}>
              {t(b.label)}
              <span className="tabular-nums">{b.value}</span>
            </span>
          ))}
        </div>

        {/* 成员胶囊（按当日最差状态着色） */}
        {todayMembers.length > 0 ? (
          <div className={cn("flex flex-wrap", spacious ? "mt-4 gap-2" : "mt-3 gap-1.5")}>
            {todayMembers.map((report) => {
              const key = report.user_id ?? report.user_name;
              const chip = STATUS_CHIP[worstStatusOfReport(report)];
              const active = expandedTodayKey === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setExpandedTodayKey(active ? null : key)}
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
                </button>
              );
            })}
          </div>
        ) : (
          <p className="mt-3 rounded-lg border border-dashed border-blue-200 bg-blue-50/40 px-3 py-3 text-center text-pretty text-[11px] text-slate-500">
            {todayLoading ? t("正在读取今日日报…") : canRegenerate ? t("今日暂无日报，点击「立即汇总」生成。") : t("今日暂无日报，研发成员生成或 18:30 自动汇总后展示。")}
          </p>
        )}

        {/* 点开某成员当日详情：右侧抽屉展示，长报告在抽屉内滚动，不撑长页面 */}
        {expandedTodayReport && (
          <ReportDetailDrawer
            onClose={() => setExpandedTodayKey(null)}
            userName={expandedTodayReport.user_name}
            dateLabel={expandedTodayReport.date}
            trigger={expandedTodayReport.trigger}
          >
            <pre className="whitespace-pre-wrap break-words font-sans text-pretty text-[12.5px] leading-6 text-slate-700">
              {expandedTodayReport.summary.text}
            </pre>
            <DailyReportGroupedTasks report={expandedTodayReport} progressNoteById={progressNoteById} />
          </ReportDetailDrawer>
        )}
      </div>

      {/* ── 历史详情层（默认收起，带高度过渡） ─────────────────────────── */}
      <CollapseTransition open={showHistory}>
        <div className="hz-surface border border-slate-200 bg-white p-5">
          <div className="mb-4 flex items-center justify-between gap-2">
            <div>
              <h2 className="flex items-center gap-2 text-balance text-sm font-bold text-slate-800">
                <CalendarDays className="size-4 text-[#002fa7]" aria-hidden="true" />
                {t("研发日报 · 历史")}
                <span className="rounded-full bg-blue-50 px-1.5 text-xs tabular-nums text-[#002fa7]">{historyReports.length}</span>
                {(reportDateFilter || reportUserFilter) && (
                  <button
                    type="button"
                    onClick={() => { setReportDateFilter(""); setReportUserFilter(""); setReportPage(1); }}
                    className="ml-1 inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-[#002fa7] transition-colors hover:bg-blue-100"
                  >
                    {t("清除筛选")}
                    <X className="size-3" aria-hidden="true" />
                  </button>
                )}
              </h2>
              <p className="mt-0.5 text-pretty text-[11px] text-slate-400">
                {t("研发成员手动生成或每日 18:30 自动汇总 · 历史保存最近 1000 条")}
              </p>
            </div>
            <button
              type="button"
              onClick={loadHistory}
              disabled={historyLoading}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition-colors hover:border-blue-300 hover:text-[#002fa7] disabled:opacity-50"
            >
              <RefreshCw className={cn("size-3", historyLoading && "animate-spin")} aria-hidden="true" />
              {t("刷新")}
            </button>
          </div>

          {/* History filters */}
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2">
            <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
              <div className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-slate-500">
                <CalendarDays className="size-3" aria-hidden="true" />
                {t("日期")}
              </div>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className={cn(
                      "h-7 w-32 shrink-0 justify-between gap-1 rounded-md border-slate-200 bg-white px-2 text-xs font-normal text-slate-700 hover:border-blue-300 hover:bg-white hover:text-slate-700",
                      !reportDateFilter && "text-slate-400",
                    )}
                  >
                    <span className="truncate">{reportDateFilter || t("选择日期")}</span>
                    <CalendarDays className="size-3 shrink-0 text-slate-400" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto rounded-xl border-slate-200 bg-white p-0 shadow-xl">
                  <Calendar
                    mode="single"
                    selected={parseLocalDate(reportDateFilter)}
                    onSelect={(date) => { setReportDateFilter(date ? isoLocalDate(date) : ""); setReportPage(1); }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
              <div className="flex shrink-0 items-center gap-1 text-[10px]">
                {[
                  { label: t("今天"), value: todayStr },
                  { label: t("昨天"), value: isoLocalDate(new Date(Date.now() - 86_400_000)) },
                  { label: t("近 7 天"), value: "" },
                ].map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => { setReportDateFilter(preset.value); setReportPage(1); }}
                    className={cn(
                      "rounded-full px-2 py-0.5 font-medium transition-colors",
                      reportDateFilter === preset.value
                        ? "bg-[#002fa7] text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-blue-50 hover:text-[#002fa7]",
                    )}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <NativeSelect
                value={reportUserFilter}
                onChange={(e) => { setReportUserFilter(e.target.value); setReportPage(1); }}
                className="h-7 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
              >
                <option value="">{t("全部成员")}</option>
                {reportUserOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </NativeSelect>
            </div>
          </div>

          {historyLoading ? (
            <DailyReportEmptyPanel title={t("正在读取日报")} description={t("请稍候，系统正在同步日报数据。")} />
          ) : historyReports.length === 0 ? (
            <DailyReportEmptyPanel
              title={reportDateFilter || reportUserFilter ? t("该筛选下暂无日报") : t("暂无日报")}
              description={
                reportDateFilter || reportUserFilter
                  ? t("请尝试切换日期或成员；或点击「清除筛选」查看全部。")
                  : t("研发成员点击「生成日报」或等待 18:30 自动生成后，会在这里展示。")
              }
            />
          ) : (
            <div className="space-y-3">
              {reportsByDate.slice((reportPage - 1) * REPORT_PAGE_SIZE, reportPage * REPORT_PAGE_SIZE).map(([date, reportsInDate]) => (
                <div key={date}>
                  <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold text-slate-500">
                    <span className="rounded-md bg-blue-50 px-1.5 py-0.5 tabular-nums text-[#002fa7]">{date}</span>
                    <span className="tabular-nums text-slate-400">{t("{count} 份日报", { count: reportsInDate.length })}</span>
                  </div>
                  <ul className="space-y-2">
                    {reportsInDate.map((report) => {
                      const expanded = expandedReportId === report.id;
                      const s = report.summary.stats;
                      return (
                        <li
                          key={report.id}
                          className="overflow-hidden rounded-xl border border-slate-200 bg-white transition-colors"
                        >
                          <button
                            type="button"
                            onClick={() => setExpandedReportId(expanded ? null : report.id)}
                            aria-expanded={expanded}
                            className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-blue-50/50"
                          >
                            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-xs font-bold text-[#002fa7]">
                              {report.user_name.slice(0, 1)}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                <span className="text-sm font-semibold text-slate-800">{report.user_name}</span>
                                <span className="text-xs tabular-nums text-slate-500">{report.date}</span>
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
                                {(s.as_collaborator ?? 0) > 0 && <span className="text-[#002fa7]">{t("协作")} {s.as_collaborator}</span>}
                                <span className="text-blue-600">{t("进行中")} {s.in_progress}</span>
                                <span className="text-emerald-600">{t("已完成")} {s.completed}</span>
                                {(s.stalled ?? 0) > 0 && <span className="text-amber-600">{t("停滞")} {s.stalled}</span>}
                                {s.blocked > 0 && <span className="text-red-600">{t("阻塞")} {s.blocked}</span>}
                                <span className="text-slate-400">·</span>
                                <span>{t("进度记录")} {s.notes_count}</span>
                              </div>
                            </div>
                            <ChevronRight className="size-4 shrink-0 text-slate-400" aria-hidden="true" />
                          </button>
                          {/* 详情改为右侧抽屉：长报告在抽屉内滚动，历史列表保持紧凑 */}
                          {expanded && (
                            <ReportDetailDrawer
                              onClose={() => setExpandedReportId(null)}
                              userName={report.user_name}
                              dateLabel={report.date}
                              trigger={report.trigger}
                            >
                              <pre className="whitespace-pre-wrap break-words font-sans text-pretty text-[12.5px] leading-6 text-slate-700">
                                {report.summary.text}
                              </pre>
                              <DailyReportGroupedTasks report={report} progressNoteById={progressNoteById} />
                            </ReportDetailDrawer>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
              {/* pagination */}
              {reportsByDate.length > REPORT_PAGE_SIZE && (
                <div className="flex items-center justify-between pt-1">
                  <span className="text-[11px] tabular-nums text-slate-400">
                    {t("共 {days} 天 · 第 {page} / {total} 页", { days: reportsByDate.length, page: reportPage, total: totalPages })}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={reportPage === 1}
                      onClick={() => setReportPage((p) => p - 1)}
                      aria-label={t("上一页")}
                      className="flex size-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition-colors hover:border-blue-300 hover:text-[#002fa7] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <ChevronLeft className="size-3.5" aria-hidden="true" />
                    </button>
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map((pg) => (
                      <button
                        key={pg}
                        type="button"
                        onClick={() => setReportPage(pg)}
                        className={cn(
                          "flex h-7 min-w-[28px] items-center justify-center rounded-md border px-1.5 text-xs font-semibold tabular-nums transition-colors",
                          pg === reportPage
                            ? "border-[#002fa7] bg-[#002fa7] text-white"
                            : "border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:text-[#002fa7]",
                        )}
                      >
                        {pg}
                      </button>
                    ))}
                    <button
                      type="button"
                      disabled={reportPage === totalPages}
                      onClick={() => setReportPage((p) => p + 1)}
                      aria-label={t("下一页")}
                      className="flex size-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition-colors hover:border-blue-300 hover:text-[#002fa7] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <ChevronRight className="size-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </CollapseTransition>
    </div>
  );
}
