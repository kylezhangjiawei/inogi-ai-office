import React from "react";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  GitBranch,
  History,
  Lock,
  MessageSquare,
  Paperclip,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  TrendingUp,
  UserPlus,
  Users,
  XCircle,
} from "lucide-react";
import { cn } from "./components/ui/utils";
import { AuditAction, AuditLog, getAuditActionMeta } from "./lib/auditLog";

// ─── Icon mapping ────────────────────────────────────────────────────────────

const ACTION_ICONS: Partial<Record<AuditAction, React.ComponentType<{ className?: string }>>> = {
  "task.created": Plus,
  "task.edited": FileText,
  "task.status_changed": TrendingUp,
  "task.priority_changed": TrendingUp,
  "task.assigned": UserPlus,
  "task.reassigned": Users,
  "task.archived": Lock,
  "task.unarchived": RefreshCw,
  "task.progress_updated": TrendingUp,
  "task.comment_added": MessageSquare,
  "task.attachment_added": Paperclip,
  "task.evidence_uploaded": Paperclip,
  "task.handoff_requested": GitBranch,
  "task.submitted": ClipboardCheck,
  "proposal.created": Plus,
  "proposal.draft_saved": FileText,
  "proposal.submitted": ClipboardCheck,
  "proposal.approved": CheckCircle2,
  "proposal.rejected": XCircle,
  "proposal.direct_dispatched": Sparkles,
  "proposal.recalled": RefreshCw,
  "proposal.escalated": TrendingUp,
  "proposal.resubmitted": RefreshCw,
  "flow.saved": GitBranch,
  "flow.node_added": Plus,
  "flow.node_removed": Trash2,
  "flow.node_edited": GitBranch,
  "flow.mode_changed": GitBranch,
  "flow.reset": RefreshCw,
  "person.created": UserPlus,
  "person.edited": Users,
  "person.deleted": Trash2,
  "person.status_changed": Users,
  "role.permissions_changed": Lock,
  "ai.parse_triggered": Bot,
  "ai.suggestion_accepted": CheckCircle2,
  "ai.suggestion_rejected": XCircle,
  "ai.regenerated": RefreshCw,
  "system.bulk_reassign": Users,
  "notification.handled": MessageSquare,
  "daily_report.generated": FileText,
  "daily_progress.synced": CheckCircle2,
  "task.data.cleared": Trash2,
};

const TONE_STYLES: Record<
  "blue" | "emerald" | "amber" | "red" | "violet" | "slate",
  { dot: string; bg: string; text: string; border: string }
> = {
  blue: { dot: "bg-cyan-500", bg: "bg-cyan-50", text: "text-cyan-700", border: "border-cyan-100" },
  emerald: { dot: "bg-emerald-500", bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-100" },
  amber: { dot: "bg-amber-500", bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-100" },
  red: { dot: "bg-rose-500", bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-100" },
  violet: { dot: "bg-indigo-500", bg: "bg-indigo-50", text: "text-indigo-700", border: "border-indigo-100" },
  slate: { dot: "bg-slate-400", bg: "bg-slate-100", text: "text-slate-700", border: "border-slate-200" },
};

// ─── Time formatting ─────────────────────────────────────────────────────────

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} 天前`;
  return new Date(iso).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

function formatAbsolute(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

// ─── Change diff display ─────────────────────────────────────────────────────

function formatChangeValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.join(", ");
  return JSON.stringify(v);
}

// ─── Single log entry ────────────────────────────────────────────────────────

function AuditLogEntry({
  log,
  showResource = true,
  isLast = false,
}: {
  log: AuditLog;
  showResource?: boolean;
  isLast?: boolean;
}) {
  const meta = getAuditActionMeta(log.action);
  const tone = TONE_STYLES[meta.tone];
  const Icon = ACTION_ICONS[log.action as AuditAction] ?? History;

  return (
    <div className="group relative flex gap-3 rounded-lg px-1 pb-4 pt-0.5 transition-colors duration-150 hover:bg-slate-50/80">
      {/* Vertical guide line */}
      {!isLast && (
        <span className="absolute left-[15px] top-8 h-full w-px bg-slate-200/80" aria-hidden />
      )}

      {/* Icon node */}
      <span
        className={cn(
          "relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border ring-4 ring-white transition-transform duration-150 group-hover:scale-105",
          tone.bg,
          tone.border,
        )}
      >
        <Icon className={cn("h-3.5 w-3.5", tone.text)} />
      </span>

      <div className="min-w-0 flex-1 pt-0.5">
        {/* Action line */}
        <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-sm">
          <span className="font-semibold text-slate-900">{log.actor.name}</span>
          {log.actor.role && (
            <span className="text-[10px] text-slate-400">{log.actor.role}</span>
          )}
          <span className="text-slate-600">{meta.verb}</span>
          {showResource && log.resource.name && (
            <span
              className={cn(
                "rounded border px-1.5 py-0.5 text-[11px] font-medium",
                tone.bg,
                tone.text,
                tone.border,
              )}
            >
              {log.resource.name}
            </span>
          )}
          {log.source === "ai" && (
            <span className="inline-flex items-center gap-0.5 rounded-md border border-indigo-100 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">
              <Bot className="h-2.5 w-2.5" />
              AI
            </span>
          )}
        </div>

        {/* Changes diff */}
        {log.changes && log.changes.length > 0 && (
          <div className="mt-1.5 space-y-1">
            {log.changes.map((c, idx) => (
              <div
                key={idx}
                className="flex flex-wrap items-center gap-1.5 rounded-md border border-slate-100 bg-white/80 px-2 py-1 text-[11px]"
              >
                <span className="font-mono font-semibold text-slate-500">{c.field}</span>
                <span className="text-slate-400">:</span>
                <span className="rounded bg-rose-50 px-1 py-0.5 text-rose-600 line-through decoration-rose-300">
                  {formatChangeValue(c.before)}
                </span>
                <ArrowRight className="h-3 w-3 text-slate-400" />
                <span className="rounded bg-emerald-50 px-1 py-0.5 font-semibold text-emerald-700">
                  {formatChangeValue(c.after)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Metadata extras */}
        {log.metadata && Object.keys(log.metadata).length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
            {Object.entries(log.metadata).map(([k, v]) => (
              <span key={k}>
                <span className="text-slate-400">{k}:</span>{" "}
                <span className="font-medium text-slate-700">{formatChangeValue(v)}</span>
              </span>
            ))}
          </div>
        )}

        {/* Comment */}
        {log.comment && (
          <div className="mt-1.5 rounded-md border border-slate-100 bg-white px-2.5 py-1.5 text-xs leading-relaxed text-slate-600">
            <MessageSquare className="mr-1 inline h-3 w-3 text-slate-400" />
            {log.comment}
          </div>
        )}

        {/* Timestamp */}
        <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-400">
          <span title={formatAbsolute(log.timestamp)}>{formatRelative(log.timestamp)}</span>
          <span className="text-slate-300">·</span>
          <span className="tabular-nums">{formatAbsolute(log.timestamp)}</span>
          {log.source !== "web" && (
            <>
              <span className="text-slate-300">·</span>
              <span className="rounded border border-slate-200 bg-white px-1 text-[9px] font-semibold text-slate-500">
                {log.source}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Timeline container ──────────────────────────────────────────────────────

export function AuditTimeline({
  logs,
  showResource = true,
  emptyText = "暂无操作记录",
  className,
}: {
  logs: AuditLog[];
  showResource?: boolean;
  emptyText?: string;
  className?: string;
}) {
  if (logs.length === 0) {
    return (
      <div className={cn("rounded-lg border border-dashed border-slate-200 bg-white/70 py-8 text-center", className)}>
        <History className="mx-auto mb-2 h-5 w-5 text-slate-300" />
        <p className="text-xs text-slate-400">{emptyText}</p>
      </div>
    );
  }

  return (
    <div className={cn("space-y-0", className)}>
      {logs.map((log, idx) => (
        <AuditLogEntry
          key={log.id}
          log={log}
          showResource={showResource}
          isLast={idx === logs.length - 1}
        />
      ))}
    </div>
  );
}

export default AuditTimeline;
