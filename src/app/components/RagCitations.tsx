import React, { useState } from "react";
import { BookOpen, ChevronDown, ChevronUp, ExternalLink, FileText, Sparkles } from "lucide-react";
import { cn } from "./ui/utils";
import { RagCitation, RagChunk, SOURCE_TYPE_LABELS, type RagSourceType } from "../lib/ragApi";

// ─── 来源类型 → 图标颜色 ───────────────────────────────────────────────────────

const SOURCE_TINT: Record<string, { bg: string; text: string; border: string }> = {
  kb: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" },
  rd_task: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" },
  rd_progress_note: { bg: "bg-cyan-50", text: "text-cyan-700", border: "border-cyan-200" },
  rd_proposal: { bg: "bg-violet-50", text: "text-violet-700", border: "border-violet-200" },
  rd_daily_report: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200" },
  chat_group: { bg: "bg-sky-50", text: "text-sky-700", border: "border-sky-200" },
  chat_private: { bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-200" },
  audit_log: { bg: "bg-slate-50", text: "text-slate-700", border: "border-slate-200" },
  candidate: { bg: "bg-indigo-50", text: "text-indigo-700", border: "border-indigo-200" },
  image: { bg: "bg-pink-50", text: "text-pink-700", border: "border-pink-200" },
  file_asset: { bg: "bg-slate-50", text: "text-slate-700", border: "border-slate-200" },
};

function tintFor(type: string) {
  return SOURCE_TINT[type] ?? SOURCE_TINT.kb;
}

// ─── 引用列表 ────────────────────────────────────────────────────────────────

export function RagCitations({
  citations,
  onOpenSource,
}: {
  citations: RagCitation[];
  /** 点击引用卡片时回调（如跳转到 KB 详情页） */
  onOpenSource?: (citation: RagCitation) => void;
}) {
  if (citations.length === 0) return null;
  /** 默认点击跳转：若 metadata.url 存在则新窗口打开（KB 文档详情等内部路由） */
  const defaultOpenSource = (c: RagCitation) => {
    if (c.url) {
      window.open(c.url, "_blank", "noopener,noreferrer");
    }
  };
  const handleClick = onOpenSource ?? defaultOpenSource;
  return (
    <div className="mt-3 space-y-1.5 rounded-md border border-slate-200 bg-slate-50/60 p-2">
      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        <BookOpen className="h-3 w-3" />
        参考来源 · {citations.length} 条
      </div>
      <div className="space-y-1.5">
        {citations.map((c, idx) => {
          const tint = tintFor(c.sourceType);
          const clickable = Boolean(c.url) || Boolean(onOpenSource);
          return (
            <button
              key={`${c.sourceType}-${c.sourceId}-${idx}`}
              type="button"
              onClick={() => clickable && handleClick(c)}
              disabled={!clickable}
              title={clickable ? "点击查看原文" : undefined}
              className={cn(
                "group block w-full rounded border bg-white/80 p-2 text-left transition-colors",
                clickable ? "cursor-pointer hover:bg-white" : "cursor-default opacity-90",
                tint.border,
              )}
            >
              <div className="mb-1 flex items-center gap-1.5">
                <span
                  className={cn(
                    "inline-flex h-4 items-center gap-0.5 rounded-sm border px-1 text-[10px] font-medium",
                    tint.bg,
                    tint.text,
                    tint.border,
                  )}
                >
                  <FileText className="h-2.5 w-2.5" />[{idx + 1}] {SOURCE_TYPE_LABELS[c.sourceType] ?? c.sourceType}
                </span>
                {c.title && (
                  <span className="truncate text-[11px] font-semibold text-slate-800">{c.title}</span>
                )}
                <span className="ml-auto shrink-0 text-[10px] tabular-nums text-slate-400">
                  {(c.similarity * 100).toFixed(0)}%
                </span>
                {c.url && (
                  <ExternalLink className="h-3 w-3 shrink-0 text-slate-300 group-hover:text-slate-500" />
                )}
              </div>
              <p className="line-clamp-2 text-[11px] leading-snug text-slate-600">{c.excerpt}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── 原文展开（不满意时展示） ─────────────────────────────────────────────────

export function RagRawChunks({ chunks }: { chunks: RagChunk[] }) {
  const [expanded, setExpanded] = useState(false);
  if (chunks.length === 0) return null;
  return (
    <div className="mt-2 rounded-md border border-amber-200 bg-amber-50/40">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-[11px] font-semibold text-amber-700 transition-colors hover:bg-amber-50"
      >
        <Sparkles className="h-3 w-3" />
        对回答不满意？展开 {chunks.length} 条原始检索片段
        {expanded ? <ChevronUp className="ml-auto h-3 w-3" /> : <ChevronDown className="ml-auto h-3 w-3" />}
      </button>
      {expanded && (
        <div className="space-y-1.5 border-t border-amber-200 p-2">
          {chunks.map((chunk, idx) => {
            const tint = tintFor(chunk.sourceType);
            const meta = (chunk.metadata ?? {}) as Record<string, unknown>;
            const title = typeof meta.title === "string" ? meta.title : undefined;
            return (
              <div key={chunk.chunkId} className={cn("rounded border bg-white p-2", tint.border)}>
                <div className="mb-1 flex items-center gap-1.5 text-[10px]">
                  <span
                    className={cn(
                      "inline-flex h-4 items-center gap-0.5 rounded-sm border px-1 font-medium",
                      tint.bg,
                      tint.text,
                      tint.border,
                    )}
                  >
                    [{idx + 1}] {SOURCE_TYPE_LABELS[chunk.sourceType] ?? chunk.sourceType}
                  </span>
                  {title && <span className="truncate font-semibold text-slate-700">{title}</span>}
                  <span className="ml-auto tabular-nums text-slate-400">{(chunk.similarity * 100).toFixed(0)}%</span>
                </div>
                <p className="whitespace-pre-wrap text-[11px] leading-snug text-slate-700">{chunk.content}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── 权限缺失提示 ──────────────────────────────────────────────────────────────

export function RagPermissionNotice({ filtered }: { filtered: number }) {
  if (filtered <= 0) return null;
  return (
    <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[10px] text-slate-600">
      <span className="font-semibold">另有 {filtered} 条相关资料</span>，但你的角色暂无访问权限。
      <span className="text-slate-400">如需查阅，请联系拥有相应权限的同事。</span>
    </div>
  );
}

export { type RagSourceType };
