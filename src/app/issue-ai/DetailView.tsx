/**
 * 问题记录与 AI 定位 — 详情视图（DetailView）。
 *
 * 主列：头部元数据 + 问题描述/附件 + AI 根因分析 + 对话调整（留痕）。
 * 右栏：当前采纳方案（pinned）+ 版本与留痕时间线（append-only）。
 *
 * 数据源唯一来自 IssueService；每次 analyze/adjust/adopt 后都 reload(service.get) 刷新整页。
 * 留痕（messages / analyses）只增不改——本视图绝不提供任何编辑/删除入口。
 */
import * as React from "react";
import { motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Cpu,
  FileText,
  History,
  Image as ImageIcon,
  Loader2,
  Lock,
  Paperclip,
  Pin,
  Send,
  Sparkles,
  X,
  User as UserIcon,
} from "lucide-react";

import { cn } from "../components/ui/utils";
import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/textarea";
import {
  DimensionChip,
  LikelihoodIndicator,
  Mono,
  SeverityBadge,
  SolutionTypeBadge,
  StatusBadge,
} from "./badges";
import { SOURCE_LABEL } from "../lib/issue/config";
import type {
  AnalysisVersion,
  AiConfig,
  AiModelChoice,
  Attachment,
  Issue,
  IssueMessage,
  IssueService,
  PossibleCause,
  Solution,
} from "../lib/issue/types";

// ── 工具 ───────────────────────────────────────────────────────────────────────

const card =
  "rounded-lg border border-slate-200/80 bg-white/95 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_rgba(15,23,42,0.06)] dark:border-slate-700/80 dark:bg-slate-900/95 dark:shadow-[0_2px_8px_rgba(0,0,0,0.32)]";
const insetPanel =
  "rounded-lg border border-slate-200/70 bg-slate-50/70 dark:border-slate-700/80 dark:bg-slate-800/35";
const sectionTitle =
  "text-sm font-semibold text-slate-800 dark:text-slate-100";
const muted = "text-slate-500 dark:text-slate-400";
const INITIAL_CHAT_MESSAGES = 12;
const CHAT_PAGE_SIZE = 12;
const currentChatUser = { id: "current-user", name: "当前用户" };

function fmtTime(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 版本触发类型中文。 */
function triggerLabel(t: AnalysisVersion["triggerType"]): string {
  return t === "initial" ? "初次生成" : "对话调整";
}

function fileToDataUrl(file: File): Promise<string | undefined> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : undefined);
    reader.onerror = () => resolve(undefined);
    reader.readAsDataURL(file);
  });
}

// ── 元数据格 ────────────────────────────────────────────────────────────────────

function MetaCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className={cn("text-xs", muted)}>{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-medium text-slate-800 dark:text-slate-100">{children ?? "—"}</dd>
    </div>
  );
}

// ── 附件行（可展开已提取文本）──────────────────────────────────────────────────

function AttachmentRow({ att }: { att: Issue["attachments"][number] }) {
  const [open, setOpen] = React.useState(false);
  const hasText = Boolean(att.extractedText && att.extractedText.trim());
  const copyLink = async () => {
    if (!att.fileUrl) {
      toast.error("暂无可复制的文件链接");
      return;
    }
    try {
      await navigator.clipboard.writeText(att.fileUrl);
      toast.success("已复制文件链接");
    } catch {
      toast.error("复制失败，请手动复制");
    }
  };
  return (
    <li className="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/40">
      <div className="flex items-center gap-2">
        <Paperclip className="size-4 shrink-0 text-slate-400" />
        <span className="min-w-0 flex-1 truncate text-sm text-slate-800 dark:text-slate-100" title={att.fileName}>
          {att.fileName}
        </span>
        <button
          type="button"
          onClick={copyLink}
          title="复制 OSS 文件链接"
          aria-label="复制文件链接"
          className="inline-flex shrink-0 cursor-pointer items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-medium text-slate-500 outline-none hover:bg-slate-200/70 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-indigo-500/50 dark:text-slate-400 dark:hover:bg-slate-700"
        >
          <Copy className="size-3.5" />
          复制链接
        </button>
        {hasText && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex shrink-0 cursor-pointer items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-medium text-indigo-700 outline-none hover:bg-indigo-50 focus-visible:ring-2 focus-visible:ring-indigo-500/50 dark:text-indigo-300 dark:hover:bg-indigo-500/10"
            aria-expanded={open}
          >
            {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            已提取文本
          </button>
        )}
      </div>
      {hasText && open && (
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-white p-2 text-xs leading-relaxed text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
          {att.extractedText}
        </pre>
      )}
    </li>
  );
}

function ChatAttachment({
  att,
  onRemove,
  tone = "neutral",
}: {
  att: Attachment;
  onRemove?: () => void;
  tone?: "neutral" | "user";
}) {
  const isImage = att.fileType.startsWith("image/") || att.fileUrl.startsWith("data:image/");
  return (
    <div
      className={cn(
        "group min-w-0 rounded-lg border px-2.5 py-2 text-xs",
        tone === "user"
          ? "border-white/20 bg-white/12 text-white"
          : "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300",
      )}
    >
      {isImage && (
        <a href={att.fileUrl} target="_blank" rel="noreferrer" className="mb-2 block overflow-hidden rounded-md">
          <img src={att.fileUrl} alt={att.fileName} className="max-h-40 w-full object-cover" />
        </a>
      )}
      <div className="flex min-w-0 items-center gap-2">
        {isImage ? <ImageIcon className="size-3.5 shrink-0" /> : <Paperclip className="size-3.5 shrink-0" />}
        <span className="min-w-0 flex-1 truncate">{att.fileName}</span>
        <span className={cn("shrink-0", tone === "user" ? "text-white/70" : muted)}>{att.fileType || "file"}</span>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className={cn(
              "cursor-pointer rounded-full p-0.5 opacity-80 outline-none transition hover:opacity-100 focus-visible:ring-2",
              tone === "user"
                ? "hover:bg-white/15 focus-visible:ring-white/50"
                : "hover:bg-slate-200 focus-visible:ring-indigo-500/50 dark:hover:bg-slate-700",
            )}
            aria-label={`移除 ${att.fileName}`}
          >
            <X className="size-3" />
          </button>
        )}
      </div>
      {att.extractedText && (
        <p className={cn("mt-1 line-clamp-2 text-[11px]", tone === "user" ? "text-white/70" : muted)}>
          {att.extractedText}
        </p>
      )}
    </div>
  );
}

// ── 单条原因卡 ──────────────────────────────────────────────────────────────────

function CauseCard({
  cause,
  readOnly,
  adoptedSolutionId,
  adoptingSolutionId,
  onAdopt,
}: {
  cause: PossibleCause;
  readOnly: boolean;
  adoptedSolutionId?: string;
  adoptingSolutionId: string | null;
  onAdopt: (cause: PossibleCause, solution: Solution) => void;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-700 dark:bg-slate-800/30">
      <div className="flex flex-wrap items-center gap-2">
        <DimensionChip value={cause.dimension} full />
        <LikelihoodIndicator value={cause.likelihood} />
        <span className="min-w-0 flex-1 text-sm font-medium text-slate-800 dark:text-slate-100">{cause.cause}</span>
      </div>
      <p className={cn("mt-1.5 text-xs leading-relaxed", muted)}>{cause.evidence}</p>
      <ul className="mt-2.5 space-y-1.5">
        {cause.solutions.map((sol) => {
          const isAdopted = adoptedSolutionId === sol.id;
          const isBusy = adoptingSolutionId === sol.id;
          return (
            <li
              key={sol.id}
              className={cn(
                "flex flex-wrap items-center gap-2 rounded-md border bg-white px-2.5 py-1.5 dark:bg-slate-900",
                isAdopted
                  ? "border-emerald-300 dark:border-emerald-500/40"
                  : "border-slate-200 dark:border-slate-700",
              )}
            >
              <span className="min-w-0 flex-1 text-sm text-slate-700 dark:text-slate-200">{sol.action}</span>
              <SolutionTypeBadge value={sol.type} />
              {sol.owner && <span className={cn("text-xs", muted)}>责任：{sol.owner}</span>}
              {isAdopted ? (
                <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="size-3.5" />
                  已采纳
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={readOnly || isBusy}
                  onClick={() => onAdopt(cause, sol)}
                  className="h-7 shrink-0 cursor-pointer px-2.5 text-xs disabled:cursor-not-allowed"
                >
                  {isBusy && <Loader2 className="size-3.5 animate-spin" />}
                  采纳
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── 对话气泡 ────────────────────────────────────────────────────────────────────

function MessageBubble({ msg, modelLabel }: { msg: IssueMessage; modelLabel?: string }) {
  const isUser = msg.role === "user";
  const attachments = msg.attachments ?? [];
  return (
    <div className={cn("flex gap-2", isUser ? "flex-row-reverse" : "flex-row")}>
      <span
        className={cn(
          "mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full",
          isUser
            ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300"
            : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
        )}
      >
        {isUser ? <UserIcon className="size-4" /> : <Bot className="size-4" />}
      </span>
      <div className={cn("min-w-0 max-w-[82%]", isUser && "items-end text-right")}>
        <div className={cn("flex items-center gap-2 text-xs", muted, isUser && "flex-row-reverse")}>
          <span>{isUser ? msg.author?.name ?? msg.operator ?? "操作人" : "AI 助手"}</span>
          <Mono>{fmtTime(msg.createdAt)}</Mono>
          {!isUser && modelLabel && (
            <span className="inline-flex items-center gap-0.5 rounded border border-slate-200 bg-slate-50 px-1 py-0.5 text-[10px] font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
              <Cpu className="size-2.5" />
              {modelLabel}
            </span>
          )}
        </div>
        <div
          className={cn(
            "mt-1 inline-block whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm leading-relaxed",
            isUser
              ? "bg-indigo-600 text-white dark:bg-indigo-600"
              : "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100",
          )}
        >
          {attachments.length > 0 && (
            <div className="mb-2 space-y-1.5">
              {attachments.map((att) => (
                <ChatAttachment key={att.id} att={att} tone={isUser ? "user" : "neutral"} />
              ))}
            </div>
          )}
          {msg.content && <span>{msg.content}</span>}
        </div>
      </div>
    </div>
  );
}

function ChatPanel({
  messages,
  hasMore,
  draft,
  sending,
  uploading,
  pendingAttachments,
  models,
  selectedModel,
  onSelectModel,
  scrollRef,
  fileInputRef,
  onScroll,
  onLoadMore,
  onDraftChange,
  onSend,
  onPickFiles,
  onRemoveAttachment,
}: {
  messages: IssueMessage[];
  hasMore: boolean;
  draft: string;
  sending: boolean;
  uploading: boolean;
  pendingAttachments: Attachment[];
  models: AiModelChoice[];
  selectedModel: string;
  onSelectModel: (value: string) => void;
  scrollRef: React.RefObject<HTMLDivElement>;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onScroll: () => void;
  onLoadMore: () => void;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onPickFiles: (files: FileList | File[]) => void;
  onRemoveAttachment: (id: string) => void;
}) {
  const canSend = Boolean(draft.trim() || pendingAttachments.length) && !sending && !uploading;

  // 拖拽上传任意文件（对齐 MateChat：进出计数避免子元素抖动）。
  const [dragActive, setDragActive] = React.useState(false);
  const dragDepth = React.useRef(0);
  const dragHasFiles = (e: React.DragEvent) =>
    Array.from(e.dataTransfer?.types ?? []).includes("Files");

  return (
    <div
      className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden"
      onDragEnter={(e) => {
        if (sending || !dragHasFiles(e)) return;
        e.preventDefault();
        dragDepth.current += 1;
        setDragActive(true);
      }}
      onDragOver={(e) => {
        if (sending || !dragHasFiles(e)) return;
        e.preventDefault();
      }}
      onDragLeave={(e) => {
        if (!dragHasFiles(e)) return;
        e.preventDefault();
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) {
          dragDepth.current = 0;
          setDragActive(false);
        }
      }}
      onDrop={(e) => {
        if (sending) return;
        e.preventDefault();
        dragDepth.current = 0;
        setDragActive(false);
        const files = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
        if (files.length > 0) onPickFiles(files);
      }}
    >
      {dragActive && (
        <div className="pointer-events-none absolute inset-0 z-30 m-3 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-indigo-300 bg-indigo-50/85 dark:border-indigo-500/50 dark:bg-indigo-500/15">
          <Paperclip className="size-7 text-indigo-500" />
          <div className="text-sm font-medium text-indigo-700 dark:text-indigo-200">松开鼠标上传文件</div>
          <div className="text-xs text-indigo-400 dark:text-indigo-300/80">支持任意图片与文档附件</div>
        </div>
      )}
      <div ref={scrollRef} onScroll={onScroll} className="material-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3 sm:px-5">
        {hasMore && (
          <button
            type="button"
            onClick={onLoadMore}
            className="mx-auto flex cursor-pointer rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-500 shadow-sm transition hover:border-indigo-200 hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:text-indigo-300"
          >
            加载更早对话
          </button>
        )}
        {messages.length === 0 ? (
          <p className={cn("rounded-lg bg-slate-50 px-3 py-6 text-center text-sm dark:bg-slate-800/40", muted)}>
            暂无对话。可在下方补充信息以调整 AI 分析。
          </p>
        ) : (
          messages.map((m) => (
            <MessageBubble
              key={m.id}
              msg={m}
              modelLabel={
                m.role === "assistant" && m.model
                  ? models.find((x) => x.value === m.model)?.label ?? m.model
                  : undefined
              }
            />
          ))
        )}
      </div>

      <div className="material-scrollbar max-h-[42%] shrink-0 overflow-y-auto border-t border-slate-200/70 bg-white/90 p-3 backdrop-blur dark:border-slate-700/80 dark:bg-slate-900/90 sm:p-4">
        {models.length > 0 && (() => {
          const current = models.find((m) => m.value === selectedModel);
          return (
            <div className="mb-2">
              <div className="flex items-center gap-1.5">
                <Cpu className="size-3.5 shrink-0 text-slate-400" />
                <span className={cn("shrink-0 text-xs", muted)}>AI 模型</span>
                <select
                  value={selectedModel}
                  onChange={(e) => onSelectModel(e.target.value)}
                  disabled={sending}
                  aria-label="选择 AI 模型"
                  className="h-7 min-w-0 max-w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs text-slate-700 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 disabled:cursor-not-allowed dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  {models.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label} · {m.usageLabel}
                    </option>
                  ))}
                </select>
                <span className={cn("ml-auto shrink-0 text-[11px]", muted)}>
                  {current?.usageKind === "multimodal" ? "图片可直传" : "图片转文字"}
                </span>
              </div>
              {current && (
                <p className={cn("mt-1 pl-5 text-[11px]", muted)}>
                  当前模型：
                  <span className="text-slate-600 dark:text-slate-300">{current.provider}</span>
                  {" · "}
                  <Mono className="text-slate-600 dark:text-slate-300">{current.model}</Mono>
                  {" · "}
                  {current.usageLabel}
                </p>
              )}
            </div>
          );
        })()}
        {pendingAttachments.length > 0 && (
          <div className="mb-2 grid gap-1.5">
            {pendingAttachments.map((att) => (
              <ChatAttachment key={att.id} att={att} onRemove={() => onRemoveAttachment(att.id)} />
            ))}
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.currentTarget.files) onPickFiles(e.currentTarget.files);
            e.currentTarget.value = "";
          }}
        />
        <div className="flex items-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || sending}
            title="上传附件"
            aria-label="上传附件"
            className="cursor-pointer disabled:cursor-not-allowed"
          >
            {uploading ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
          </Button>
          <Textarea
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files ?? []);
              if (files.length > 0) onPickFiles(files);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
            placeholder="补充线索 / 提出调整方向…"
            disabled={sending}
            aria-label="对话输入"
            className="max-h-24 min-h-10 resize-none rounded-lg border-slate-200 bg-slate-50 text-sm shadow-inner focus-visible:border-indigo-300 focus-visible:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-800/70"
          />
          <Button onClick={onSend} disabled={!canSend} className="h-11 cursor-pointer px-3 disabled:cursor-not-allowed">
            {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            发送
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── 主组件 ──────────────────────────────────────────────────────────────────────

export function DetailView({
  service,
  issueId,
  onBack,
}: {
  service: IssueService;
  issueId: string;
  onBack: () => void;
}) {
  const reduceMotion = useReducedMotion();

  const [issue, setIssue] = React.useState<Issue | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const [analyzing, setAnalyzing] = React.useState(false);
  const [adoptingSolutionId, setAdoptingSolutionId] = React.useState<string | null>(null);
  const [resolving, setResolving] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [pendingAttachments, setPendingAttachments] = React.useState<Attachment[]>([]);
  const [aiConfig, setAiConfig] = React.useState<AiConfig | null>(null);
  const [models, setModels] = React.useState<AiModelChoice[]>([]);
  const [selectedModel, setSelectedModel] = React.useState<string>("");
  const [visibleMessageCount, setVisibleMessageCount] = React.useState(INITIAL_CHAT_MESSAGES);

  const chatScrollRef = React.useRef<HTMLDivElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const restoreScrollHeightRef = React.useRef<number | null>(null);

  /** 选中查看的版本号（默认 = 最新）。 */
  const [viewVersion, setViewVersion] = React.useState<number | null>(null);

  /** 复用来源历史问题（kind === 'reuse' 时按需取）。 */
  const [reusedIssue, setReusedIssue] = React.useState<Issue | null>(null);

  // mount 时若 status === 'analyzing' 且尚无分析版本，自动触发一次 analyze（drawer 已起步的兜底）。
  const autoKicked = React.useRef(false);

  const reload = React.useCallback(async () => {
    const next = await service.get(issueId);
    setIssue(next);
    return next;
  }, [service, issueId]);

  React.useEffect(() => {
    let alive = true;
    setIssue(null);
    setLoadError(null);
    autoKicked.current = false;
    setViewVersion(null);
    setReusedIssue(null);
    service
      .get(issueId)
      .then((data) => {
        if (alive) setIssue(data);
      })
      .catch((err: unknown) => {
        if (alive) setLoadError(err instanceof Error ? err.message : "加载失败");
      });
    return () => {
      alive = false;
    };
  }, [service, issueId]);

  React.useEffect(() => {
    setVisibleMessageCount(INITIAL_CHAT_MESSAGES);
    setPendingAttachments([]);
    setDraft("");
  }, [issueId]);

  React.useEffect(() => {
    let alive = true;
    void service
      .getAiConfig()
      .then((cfg) => {
        if (alive) setAiConfig(cfg);
      })
      .catch(() => {
        if (alive) setAiConfig(null);
      });
    return () => {
      alive = false;
    };
  }, [service, issueId]);

  // 加载可选对话模型（默认选中 AiConfig.model 对应项，否则取首个）。
  React.useEffect(() => {
    let alive = true;
    void service
      .listAiModels()
      .then((list) => {
        if (!alive) return;
        setModels(list);
        setSelectedModel((cur) => cur || list[0]?.value || "");
      })
      .catch(() => {
        if (alive) setModels([]);
      });
    return () => {
      alive = false;
    };
  }, [service]);

  React.useEffect(() => {
    const node = chatScrollRef.current;
    if (node && issue?.messages.length) node.scrollTop = node.scrollHeight;
  }, [issue?.messages.length, issueId]);

  React.useLayoutEffect(() => {
    const prevHeight = restoreScrollHeightRef.current;
    const node = chatScrollRef.current;
    if (prevHeight != null && node) node.scrollTop = node.scrollHeight - prevHeight;
    restoreScrollHeightRef.current = null;
  }, [visibleMessageCount]);

  // 取复用来源问题的采纳方案（仅当 adopted.kind === 'reuse'）。
  React.useEffect(() => {
    if (issue?.adopted?.kind !== "reuse") {
      setReusedIssue(null);
      return;
    }
    let alive = true;
    const from = issue.adopted.reusedFrom;
    service
      .get(from)
      .then((data) => {
        if (alive) setReusedIssue(data);
      })
      .catch(() => {
        if (alive) setReusedIssue(null);
      });
    return () => {
      alive = false;
    };
  }, [service, issue?.adopted]);

  const runAnalyze = React.useCallback(async () => {
    setAnalyzing(true);
    try {
      await service.analyze(issueId);
      await reload();
      toast.success("AI 根因分析完成");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "分析失败");
    } finally {
      setAnalyzing(false);
    }
  }, [service, issueId, reload]);

  // 自动触发：进入任何未分析（pending/analyzing）且非复用的问题，AI 立即生成根因——无需手动按钮。
  React.useEffect(() => {
    if (!issue) return;
    if (autoKicked.current) return;
    const needsAnalyze =
      (issue.status === "pending" || issue.status === "analyzing") &&
      issue.analyses.length === 0 &&
      issue.adopted?.kind !== "reuse";
    if (needsAnalyze && !analyzing) {
      autoKicked.current = true;
      void runAnalyze();
    }
  }, [issue, analyzing, runAnalyze]);

  const handleAdopt = React.useCallback(
    async (cause: PossibleCause, solution: Solution) => {
      setAdoptingSolutionId(solution.id);
      try {
        await service.adopt(issueId, { kind: "analysis", causeId: cause.id, solutionId: solution.id });
        await reload();
        toast.success("已采纳该方案");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "采纳失败");
      } finally {
        setAdoptingSolutionId(null);
      }
    },
    [service, issueId, reload],
  );

  const handlePickFiles = React.useCallback(
    async (filesLike: FileList | File[]) => {
      const files = Array.from(filesLike).filter((file) => file.size > 0);
      if (files.length === 0) return;
      setUploading(true);
      try {
        // 按所选模型用途分流：多模态模型图片可直传（走 ai 识别），纯文本模型图片转文字（OCR）；
        // 非图片文档统一按 AiConfig.attachmentMode 处理。
        const multimodal = models.find((m) => m.value === selectedModel)?.usageKind === "multimodal";
        const docMode = aiConfig?.attachmentMode ?? "ai";
        let imageCount = 0;
        const uploaded: Attachment[] = [];
        for (const file of files) {
          const isImg = (file.type || "").startsWith("image/");
          if (isImg) imageCount += 1;
          const mode: AiConfig["attachmentMode"] = isImg ? (multimodal ? "ai" : "ocr") : docMode;
          const dataUrl = await fileToDataUrl(file);
          const raw = await service.uploadAttachment({
            fileName: file.name,
            fileType: file.type || "application/octet-stream",
            size: file.size,
            dataUrl,
          });
          uploaded.push(await service.processAttachment(raw, mode));
        }
        setPendingAttachments((prev) => [...prev, ...uploaded]);
        if (imageCount > 0) {
          toast.success(
            multimodal
              ? `已添加 ${uploaded.length} 个附件（图片将直传多模态模型）`
              : `已添加 ${uploaded.length} 个附件（当前为纯文本模型，图片已转文字 OCR）`,
          );
        } else {
          toast.success(`已添加 ${uploaded.length} 个附件`);
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "附件上传失败");
      } finally {
        setUploading(false);
      }
    },
    [aiConfig?.attachmentMode, service, models, selectedModel],
  );

  const handleRemoveAttachment = React.useCallback((id: string) => {
    setPendingAttachments((prev) => prev.filter((att) => att.id !== id));
  }, []);

  const handleSend = React.useCallback(async () => {
    const text = draft.trim();
    if ((!text && pendingAttachments.length === 0) || sending || uploading) return;
    setSending(true);
    try {
      await service.sendChat(issueId, {
        content: text || "请结合附件继续分析。",
        author: currentChatUser,
        attachments: pendingAttachments.length ? pendingAttachments : undefined,
        model: selectedModel || undefined,
      });
      setDraft("");
      setPendingAttachments([]);
      await reload();
      setViewVersion(null); // 跳回最新版本
      toast.success("已发送");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "发送失败");
    } finally {
      setSending(false);
    }
  }, [draft, pendingAttachments, sending, uploading, service, issueId, reload, selectedModel]);

  const handleLoadMoreMessages = React.useCallback(() => {
    const total = issue?.messages.length ?? 0;
    const node = chatScrollRef.current;
    if (!node || visibleMessageCount >= total) return;
    restoreScrollHeightRef.current = node.scrollHeight;
    setVisibleMessageCount((count) => Math.min(count + CHAT_PAGE_SIZE, total));
  }, [issue?.messages.length, visibleMessageCount]);

  const handleChatScroll = React.useCallback(() => {
    const node = chatScrollRef.current;
    const total = issue?.messages.length ?? 0;
    if (node && node.scrollTop <= 24 && visibleMessageCount < total) handleLoadMoreMessages();
  }, [handleLoadMoreMessages, issue?.messages.length, visibleMessageCount]);

  // ── 加载/错误态 ──────────────────────────────────────────────────────────────
  if (loadError) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <AlertCircle className="mx-auto size-8 text-red-500" />
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">加载问题失败：{loadError}</p>
        <Button variant="outline" className="mt-4" onClick={onBack}>
          <ArrowLeft className="size-4" />
          返回
        </Button>
      </div>
    );
  }

  if (!issue) {
    return (
      <div className="flex items-center justify-center px-4 py-24 text-slate-400">
        <Loader2 className="size-5 animate-spin" />
        <span className="ml-2 text-sm">加载中…</span>
      </div>
    );
  }

  // ── 派生数据 ──────────────────────────────────────────────────────────────────
  const analyses = [...issue.analyses].sort((a, b) => a.version - b.version);
  const latest = analyses.length ? analyses[analyses.length - 1] : null;

  // 一键「已解决」：采纳最新分析的最后一个方案（最后一条结果），再判定已解决 → 状态置为已完结(archived)。
  const canResolve = !!latest && issue.status !== "archived";
  const handleResolve = async () => {
    if (resolving || !latest) return;
    const causes = latest.content.possibleCauses;
    const lastCause = causes[causes.length - 1];
    const lastSolution = lastCause?.solutions[lastCause.solutions.length - 1];
    setResolving(true);
    try {
      if (lastCause && lastSolution) {
        await service.adopt(issueId, { kind: "analysis", causeId: lastCause.id, solutionId: lastSolution.id });
      }
      await service.resolveIssue(issueId, { resolved: true, by: currentChatUser, note: "标记已解决（采纳最新方案）" });
      await reload();
      toast.success("已标记为已完结");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败");
    } finally {
      setResolving(false);
    }
  };
  const shownVersion =
    viewVersion != null ? analyses.find((a) => a.version === viewVersion) ?? latest : latest;
  const isLatestShown = !shownVersion || shownVersion.version === latest?.version;
  const totalVersions = analyses.length;

  const adopted = issue.adopted;
  const adoptedSolutionId = adopted?.kind === "analysis" ? adopted.solutionId : undefined;

  const isReuse = adopted?.kind === "reuse";

  // 已采纳方案（kind==='analysis'）的解析。
  let pinnedCause: PossibleCause | undefined;
  let pinnedSolution: Solution | undefined;
  if (adopted?.kind === "analysis") {
    for (const v of analyses) {
      const c = v.content.possibleCauses.find((pc) => pc.id === adopted.causeId);
      if (c) {
        pinnedCause = c;
        pinnedSolution = c.solutions.find((s) => s.id === adopted.solutionId);
        if (pinnedSolution) break;
      }
    }
  }

  const reusedAdopted: { cause: PossibleCause; solution: Solution } | null = (() => {
    const ra = reusedIssue?.adopted;
    if (!reusedIssue || ra?.kind !== "analysis") return null;
    for (const v of reusedIssue.analyses) {
      const c = v.content.possibleCauses.find((pc) => pc.id === ra.causeId);
      if (c) {
        const s = c.solutions.find((x) => x.id === ra.solutionId);
        if (s) return { cause: c, solution: s };
      }
    }
    return null;
  })();

  const fade = reduceMotion
    ? {}
    : { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.2 } };

  const sortedMessages = [...issue.messages].sort((a, b) => a.seq - b.seq);
  const hasMoreMessages = sortedMessages.length > visibleMessageCount;
  const visibleMessages = hasMoreMessages
    ? sortedMessages.slice(sortedMessages.length - visibleMessageCount)
    : sortedMessages;

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      {/* 顶部返回（shell 也提供面包屑，这里再给一个干净入口）。 */}
      <button
        type="button"
        onClick={onBack}
        className="mb-3 inline-flex w-fit cursor-pointer items-center gap-1 rounded-full px-2.5 py-1 text-sm font-medium text-slate-500 outline-none transition-colors hover:bg-white hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-indigo-500/50 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-slate-100"
      >
        <ArrowLeft className="size-4" />
        返回列表
      </button>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-[minmax(22rem,390px)_minmax(0,1fr)] 2xl:grid-cols-[400px_minmax(0,1fr)]">
        {/* ══════════ 主列（xl+ 定高内部滚动，隐藏滚动条不占位） ══════════ */}
        <div className="scrollbar-none min-w-0 space-y-3 xl:min-h-0 xl:overflow-y-auto">
          {/* 1) 头部 */}
          <motion.section {...fade} className={cn(card, "overflow-hidden")}>
            <div className="border-l-4 border-indigo-500 p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Mono className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                    {issue.id}
                  </Mono>
                  <SeverityBadge value={issue.severity} />
                  <StatusBadge value={issue.status} />
                </div>
                <div className="text-right text-xs text-slate-500 dark:text-slate-400">
                  更新于 <Mono>{fmtTime(issue.updatedAt)}</Mono>
                </div>
              </div>
              <h1 className="mt-3 max-w-5xl text-xl font-semibold leading-snug text-slate-950 dark:text-white">
                {issue.title}
              </h1>

              <dl className={cn(insetPanel, "mt-4 grid grid-cols-1 gap-x-4 gap-y-3 p-3 sm:grid-cols-2")}>
                <MetaCell label="来源">{SOURCE_LABEL[issue.source]}</MetaCell>
                <MetaCell label="创建">
                  <span>
                    {issue.createdBy} · <Mono className="text-xs">{fmtTime(issue.createdAt)}</Mono>
                  </span>
                </MetaCell>
              </dl>

              {/* 一键已解决：采纳最新分析的最后一个方案并置为已完结。 */}
              {canResolve && (
                <div className="mt-4 flex justify-end">
                  <Button onClick={handleResolve} disabled={resolving}>
                    {resolving ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                    已解决
                  </Button>
                </div>
              )}
            </div>
          </motion.section>

          {/* 2) 问题描述 + 附件 */}
          <motion.section {...fade} className={cn(card, "p-4 sm:p-5")}>
            <div className="flex items-center justify-between gap-3">
              <h2 className={sectionTitle}>问题描述</h2>
              {issue.attachments.length > 0 && (
                <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
                  <Paperclip className="size-3.5" />
                  {issue.attachments.length} 个附件
                </span>
              )}
            </div>
            <p className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50/70 px-3 py-2.5 text-sm leading-relaxed text-slate-700 dark:bg-slate-800/35 dark:text-slate-200">
              {issue.description || <span className={muted}>（无描述）</span>}
            </p>
            {issue.attachments.length > 0 && (
              <div className="mt-4">
                <ul className="mt-2 space-y-1.5">
                  {issue.attachments.map((att) => (
                    <AttachmentRow key={att.id} att={att} />
                  ))}
                </ul>
              </div>
            )}
          </motion.section>

          {/* AI 根因分析已移动到右栏（见 aside）。 */}

          <div className="grid gap-3">
          {/* 当前采纳方案 */}
          <section className={cn(card, "p-4")}>
            <h2 className={cn(sectionTitle, "flex items-center gap-1.5")}>
              <Pin className="size-4 text-indigo-500" />
              当前采纳方案
            </h2>
            {!adopted ? (
                <p className={cn("mt-2 rounded-lg bg-slate-50 px-3 py-3 text-sm dark:bg-slate-800/40", muted)}>
                  尚未采纳方案
                </p>
            ) : isReuse ? (
                <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-500/30 dark:bg-emerald-500/10">
                  <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">复用历史方案</p>
                  <p className={cn("mt-1 text-xs", muted)}>
                    来自 <Mono className="text-slate-700 dark:text-slate-200">{adopted.kind === "reuse" ? adopted.reusedFrom : ""}</Mono>
                  </p>
                  {reusedAdopted && (
                      <div className="mt-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <DimensionChip value={reusedAdopted.cause.dimension} />
                          <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{reusedAdopted.cause.cause}</span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <span className="text-sm text-slate-700 dark:text-slate-200">{reusedAdopted.solution.action}</span>
                          <SolutionTypeBadge value={reusedAdopted.solution.type} />
                        </div>
                      </div>
                  )}
                </div>
            ) : pinnedCause && pinnedSolution ? (
                <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-500/30 dark:bg-emerald-500/10">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <DimensionChip value={pinnedCause.dimension} />
                    <LikelihoodIndicator value={pinnedCause.likelihood} />
                  </div>
                  <p className="mt-1.5 text-sm font-medium text-slate-800 dark:text-slate-100">{pinnedCause.cause}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="text-sm text-slate-700 dark:text-slate-200">{pinnedSolution.action}</span>
                    <SolutionTypeBadge value={pinnedSolution.type} />
                  </div>
                  {pinnedSolution.owner && (
                      <p className={cn("mt-1 text-xs", muted)}>责任岗位：{pinnedSolution.owner}</p>
                  )}
                </div>
            ) : (
                <p className={cn("mt-2 rounded-lg bg-slate-50 px-3 py-3 text-sm dark:bg-slate-800/40", muted)}>
                  已采纳方案（详情待加载）
                </p>
            )}
          </section>

          {/* 版本与留痕 时间线 */}
          <section className={cn(card, "p-4")}>
            <div className="flex items-center justify-between gap-2">
              <h2 className={cn(sectionTitle, "flex items-center gap-1.5")}>
                <History className="size-4 text-slate-400" />
                版本与留痕
              </h2>
              <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-400">
                <Lock className="size-2.5" />
                只增不改 · append-only
              </span>
            </div>

            {analyses.length === 0 ? (
                <p className={cn("mt-3 text-sm", muted)}>暂无版本记录</p>
            ) : (
                <ol className="mt-3 space-y-3">
                  {analyses
                      .slice()
                      .reverse()
                      .map((v) => (
                          <li key={v.id} className="relative flex gap-2.5 pl-1">
                      <span className="mt-1 flex flex-col items-center">
                        <span
                            className={cn(
                                "size-2.5 shrink-0 rounded-full ring-2",
                                v.isAdopted
                                    ? "bg-emerald-500 ring-emerald-200 dark:ring-emerald-500/30"
                                    : "bg-indigo-500 ring-indigo-200 dark:ring-indigo-500/30",
                            )}
                        />
                      </span>
                            <div className="min-w-0 flex-1 border-b border-slate-100 pb-2 last:border-0 dark:border-slate-800">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <Mono className="text-sm font-semibold text-slate-800 dark:text-slate-100">v{v.version}</Mono>
                                <span className="rounded border border-slate-200 px-1 py-0.5 text-[10px] text-slate-500 dark:border-slate-700 dark:text-slate-400">
                            {triggerLabel(v.triggerType)}
                          </span>
                                {v.basedOnVersion != null && (
                                    <span className={cn("text-[10px]", muted)}>
                              基于 <Mono>v{v.basedOnVersion}</Mono>
                            </span>
                                )}
                                {v.isAdopted && (
                                    <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                              <CheckCircle2 className="size-3" />
                              已采纳
                            </span>
                                )}
                              </div>
                              <p className={cn("mt-0.5 line-clamp-2 text-xs", muted)}>{v.summary}</p>
                              <p className={cn("mt-0.5 text-[10px]", muted)}>
                                {v.createdBy} · {v.model} · <Mono>{fmtTime(v.createdAt)}</Mono>
                              </p>
                            </div>
                          </li>
                      ))}
                </ol>
            )}

            {/* 关键留痕事件（用户消息）摘要 */}
            {issue.messages.some((m) => m.role === "user") && (
                <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
                  <h3 className={cn("flex items-center gap-1 text-[11px] font-medium", muted)}>
                    <FileText className="size-3" />
                    调整留痕
                  </h3>
                  <ol className="mt-1.5 space-y-1.5">
                    {[...issue.messages]
                        .filter((m) => m.role === "user")
                        .sort((a, b) => b.seq - a.seq)
                        .map((m) => (
                            <li key={m.id} className={cn("text-[11px] leading-snug", muted)}>
                              <Mono>{fmtTime(m.createdAt)}</Mono> · {m.operator ?? "操作人"}：
                              <span className="text-slate-600 dark:text-slate-300"> {m.content}</span>
                            </li>
                        ))}
                  </ol>
                </div>
            )}
          </section>
          </div>
        </div>

        {/* ══════════ 右栏：AI 根因分析 + 对话调整 ══════════ */}
        <aside className="min-w-0 space-y-3 xl:sticky xl:top-0 xl:flex xl:flex-col xl:gap-3 xl:space-y-0 xl:h-[calc(100vh-14rem)] xl:max-h-[calc(100vh-14rem)] xl:min-h-0">
          {/* 3) AI 根因分析（右栏顶部，独立滚动） */}
          <motion.section {...fade} className={cn(card, "p-4 sm:p-5 xl:max-h-[48%] xl:shrink-0 xl:overflow-y-auto")}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className={cn(sectionTitle, "flex items-center gap-1.5")}>
                <Sparkles className="size-4 text-indigo-500" />
                AI 根因分析
              </h2>
              {totalVersions > 0 && shownVersion && (
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  <span className={cn("text-xs", muted)}>
                    版本 <Mono>v{shownVersion.version}</Mono>（共 {totalVersions} 版）
                  </span>
                  {totalVersions > 1 && (
                    <select
                      value={shownVersion.version}
                      onChange={(e) => setViewVersion(Number(e.target.value))}
                      aria-label="查看历史版本"
                      className="h-7 rounded-md border border-slate-200 bg-white px-1.5 text-xs text-slate-700 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                    >
                      {analyses
                        .slice()
                        .reverse()
                        .map((v) => (
                          <option key={v.id} value={v.version}>
                            v{v.version}（{triggerLabel(v.triggerType)}）
                          </option>
                        ))}
                    </select>
                  )}
                </div>
              )}
            </div>

            {/* a. 复用历史方案块（无分析版本时） */}
            {isReuse && analyses.length === 0 && (
              <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50/60 p-3 dark:border-indigo-500/30 dark:bg-indigo-500/10">
                <p className="flex items-center gap-1.5 text-sm font-medium text-indigo-800 dark:text-indigo-200">
                  <CheckCircle2 className="size-4" />
                  已复用历史方案
                </p>
                <p className={cn("mt-1 text-xs", muted)}>
                  复用自 <Mono className="text-indigo-700 dark:text-indigo-300">{adopted?.kind === "reuse" ? adopted.reusedFrom : ""}</Mono>
                </p>
                {reusedAdopted ? (
                  <div className="mt-2 rounded-md border border-slate-200 bg-white px-2.5 py-2 dark:border-slate-700 dark:bg-slate-900">
                    <div className="flex flex-wrap items-center gap-2">
                      <DimensionChip value={reusedAdopted.cause.dimension} full />
                      <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{reusedAdopted.cause.cause}</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <span className="text-sm text-slate-700 dark:text-slate-200">{reusedAdopted.solution.action}</span>
                      <SolutionTypeBadge value={reusedAdopted.solution.type} />
                    </div>
                  </div>
                ) : (
                  <p className={cn("mt-2 text-xs", muted)}>（历史方案详情可在下方对话调整中进一步细化）</p>
                )}
              </div>
            )}

            {/* b. 加载态：进入未分析问题即自动生成（pending/analyzing 皆覆盖，无手动按钮） */}
            {(analyzing ||
              ((issue.status === "pending" || issue.status === "analyzing") &&
                analyses.length === 0 &&
                !isReuse)) && (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-300">
                <Loader2 className="size-4 animate-spin text-indigo-500" />
                AI 正在分析根因，请稍候…
              </div>
            )}

            {/* c. 展示某版本分析结果 */}
            {shownVersion && (
              <div className="mt-3 space-y-3">
                {!isLatestShown && (
                  <p className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                    <Lock className="size-3" />
                    历史版本 · 只读
                  </p>
                )}
                <p className="rounded-lg border border-indigo-100 bg-indigo-50/45 px-3 py-2.5 text-sm leading-relaxed text-slate-700 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-slate-200">
                  {shownVersion.summary}
                </p>
                {shownVersion.content.referencedCases.length > 0 && (
                  <p className={cn("text-xs", muted)}>
                    参考历史问题：
                    {shownVersion.content.referencedCases.map((c, i) => (
                      <React.Fragment key={c}>
                        {i > 0 && "、"}
                        <Mono className="text-slate-600 dark:text-slate-300">{c}</Mono>
                      </React.Fragment>
                    ))}
                  </p>
                )}
                <div className="space-y-2.5">
                  {shownVersion.content.possibleCauses.map((cause) => (
                    <CauseCard
                      key={cause.id}
                      cause={cause}
                      readOnly={!isLatestShown}
                      adoptedSolutionId={adoptedSolutionId}
                      adoptingSolutionId={adoptingSolutionId}
                      onAdopt={handleAdopt}
                    />
                  ))}
                </div>
              </div>
            )}
          </motion.section>

          {/* 4) 对话调整（留痕） */}
          <motion.section {...fade} className={cn(card, "flex min-h-[24rem] flex-1 flex-col overflow-hidden p-0 xl:min-h-0")}>
            <div className="shrink-0 border-b border-slate-200/70 px-4 py-3 dark:border-slate-700/80 sm:px-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className={cn(sectionTitle, "flex items-center gap-1.5")}>
                  <History className="size-4 text-slate-400" />
                  对话调整（留痕）
                </h2>
                <span className={cn("shrink-0 text-xs", muted)}>{issue.messages.length} 条</span>
              </div>
              <p className={cn("mt-1 text-xs", muted)}>每次调整都会生成新的分析版本，对话只增不改。</p>
            </div>
            <ChatPanel
              messages={visibleMessages}
              hasMore={hasMoreMessages}
              draft={draft}
              sending={sending}
              uploading={uploading}
              pendingAttachments={pendingAttachments}
              models={models}
              selectedModel={selectedModel}
              onSelectModel={setSelectedModel}
              scrollRef={chatScrollRef}
              fileInputRef={fileInputRef}
              onScroll={handleChatScroll}
              onLoadMore={handleLoadMoreMessages}
              onDraftChange={setDraft}
              onSend={handleSend}
              onPickFiles={handlePickFiles}
              onRemoveAttachment={handleRemoveAttachment}
            />
          </motion.section>
        </aside>
      </div>
    </div>
  );
}
