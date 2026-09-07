import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronDown, ChevronUp } from "lucide-react";

import { RDReportsPanel } from "./RDReportsPanel";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./components/ui/collapsible";
import { cn } from "./components/ui/utils";
import { t, useI18n } from "./lib/i18n";
import { fetchRdDailyReports, type RdDailyReport } from "./lib/rdApi";

/** Keep the task workspace compact; mount the complete reports only on request. */
export function RDReportsDigest({ canRegenerate }: { canRegenerate: boolean }) {
  useI18n();
  const [expanded, setExpanded] = useState(false);
  const [hasExpanded, setHasExpanded] = useState(false);
  const [reports, setReports] = useState<RdDailyReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(false);

  const loadSummary = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setFailed(false);
    const now = new Date();
    const date = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
    try {
      const nextReports = await fetchRdDailyReports({ date, limit: 500 });
      if (requestId !== requestIdRef.current) return;
      setReports(nextReports);
    } catch {
      if (requestId !== requestIdRef.current) return;
      setFailed(true);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void loadSummary();
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, [loadSummary]);

  const handleDailyReportsLoaded = useCallback((nextReports: RdDailyReport[]) => {
    if (!mountedRef.current) return;
    // Completed generation wins over any older request made when the digest was closed.
    requestIdRef.current += 1;
    setReports(nextReports);
    setLoading(false);
    setFailed(false);
  }, []);

  const counts = useMemo(() => {
    const result = { completed: 0, progressed: 0, stalled: 0, blocked: 0 };
    for (const report of reports) {
      for (const task of report.summary.tasks ?? []) {
        if (task.group === "completed_today") result.completed += 1;
        else if (task.group === "progressed") result.progressed += 1;
        else if (task.group === "stalled") result.stalled += 1;
        else if (task.group === "blocked") result.blocked += 1;
      }
    }
    return result;
  }, [reports]);

  const chips = [
    { label: "完成", value: counts.completed },
    { label: "推进", value: counts.progressed },
    { label: "停滞", value: counts.stalled },
    { label: "阻塞", value: counts.blocked },
  ].filter((item) => item.value > 0);
  const memberNames = reports.slice(0, 3).map((report) => report.user_name).join("、");
  const summary = loading
    ? t("读取中…")
    : failed
      ? t("日报摘要读取失败，展开报告可重试。")
      : reports.length > 0
        ? t("今日 {n} 位成员已生成报告", { n: reports.length })
        : t("今日暂无日报");

  const handleOpenChange = (nextExpanded: boolean) => {
    if (nextExpanded) setHasExpanded(true);
    setExpanded(nextExpanded);
    // A report may have been generated while open. Refresh when returning to the digest.
    if (!nextExpanded) void loadSummary();
  };

  return (
    <Collapsible
      open={expanded}
      onOpenChange={handleOpenChange}
      className="rd-horizon-report-digest min-w-0 overflow-hidden rounded-2xl border border-border bg-card"
    >
      <CollapsibleTrigger className="rd-horizon-report-digest-trigger flex min-h-14 w-full cursor-pointer flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl px-4 py-3 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary" aria-hidden="true">
          <CalendarDays className="size-4" />
        </span>
        <span className="text-balance text-sm font-semibold text-foreground">{t("研发工作报告")}</span>
        <span role="status" aria-live="polite" aria-busy={loading} className={cn("text-pretty text-xs tabular-nums", failed ? "text-destructive" : "text-muted-foreground")}>
          {summary}
        </span>
        {!loading && !failed && reports.length > 0 ? (
          <>
            <span className="flex flex-wrap items-center gap-2">
              {chips.map((item) => (
                <span key={item.label} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
                  {t(item.label)}<span className="font-semibold tabular-nums text-foreground">{item.value}</span>
                </span>
              ))}
            </span>
            <span className="hidden min-w-0 max-w-48 truncate text-xs text-muted-foreground lg:block" title={memberNames}>{memberNames}</span>
          </>
        ) : null}
        <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-primary">
          {expanded ? t("收起报表") : t("展开报表")}
          {expanded ? <ChevronUp className="size-4" aria-hidden="true" /> : <ChevronDown className="size-4" aria-hidden="true" />}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent forceMount={hasExpanded ? true : undefined} hidden={!expanded} className="rd-horizon-report-digest-content border-t border-border [&_.hz-surface]:rounded-none! [&_.hz-surface]:border-0! [&_.hz-surface]:shadow-none!">
        {hasExpanded ? <RDReportsPanel canRegenerate={canRegenerate} onDailyReportsLoaded={handleDailyReportsLoaded} /> : null}
      </CollapsibleContent>
    </Collapsible>
  );
}
