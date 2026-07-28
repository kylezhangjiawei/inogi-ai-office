import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowLeft,
  Eye,
  FileText,
  ImageIcon,
  LockKeyhole,
  Loader2,
  MessageCircleMore,
  MessageCircleReply,
  Paperclip,
  Send,
  Sparkles,
  UploadCloud,
  Video,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "./auth";
import {
  MentionSuggestionPanel,
  renderTextWithMentions,
  useMentions,
  type MentionCandidate,
} from "./components/MentionInput";
import { cn } from "./components/ui/utils";
import {
  createRdTaskDiscussionMessage,
  fetchRdPeople,
  fetchRdTaskDiscussion,
  markRdTaskDiscussionRead,
  type RdDiscussionAnchorType,
  type RdTaskDiscussionMessage,
  type RdTaskDiscussionResponse,
  type RdTaskDiscussionThreadSummary,
  type RdTaskProgressNote,
} from "./lib/rdApi";
import { i18nLocale, t, useI18n } from "./lib/i18n";
import { useAvatarDirectory } from "./lib/userAvatar";
import { formatRdFileSize, ProgressAttachmentGrid, TaskImageGallery } from "./RDProgressEvidence";

const CHAT_EASE = [0.22, 1, 0.36, 1] as const;
const DISCUSSION_MAX_FILES = 10;
const DISCUSSION_MAX_FILE_BYTES = 25 * 1024 * 1024;
const DISCUSSION_MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const DISCUSSION_POLL_INTERVAL_MS = 5_000;
const DISCUSSION_BLOCKED_EXTENSIONS = new Set([
  "apk",
  "app",
  "bat",
  "cmd",
  "com",
  "dmg",
  "exe",
  "msi",
  "pkg",
  "ps1",
  "scr",
]);

function announceDiscussionUpdated(taskId: string) {
  window.dispatchEvent(new CustomEvent("rd:discussion-updated", { detail: { taskId } }));
}

type ConversationAnchor = {
  type: "progress_note" | "message";
  id: string;
  author: string;
  authorId?: string | null;
  preview: string;
  createdAt: string;
  attachments?: RdTaskProgressNote["attachments"];
  note?: RdTaskProgressNote;
  message?: RdTaskDiscussionMessage;
};

export type RdFocusedDiscussionAnchor = {
  type: RdDiscussionAnchorType;
  id?: string | null;
  author?: string;
  authorId?: string | null;
  preview?: string;
  createdAt?: string;
};

type ConversationFeedItem =
  | { kind: "note"; createdAt: string; note: RdTaskProgressNote }
  | { kind: "message"; createdAt: string; message: RdTaskDiscussionMessage };

function fileKind(file: Pick<File, "type" | "name">): "image" | "video" | "file" {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (["jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "bmp"].includes(extension)) return "image";
  if (["mp4", "mov", "m4v", "webm", "avi", "mkv"].includes(extension)) return "video";
  return "file";
}

function blockedAttachment(file: Pick<File, "type" | "name">): boolean {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return DISCUSSION_BLOCKED_EXTENSIONS.has(extension)
    || [
      "application/x-dosexec",
      "application/x-msdownload",
      "application/vnd.microsoft.portable-executable",
    ].includes(file.type.toLowerCase());
}

function PendingAttachment({
  file,
  onRemove,
}: {
  file: File;
  onRemove: () => void;
}) {
  const kind = fileKind(file);
  const [previewUrl, setPreviewUrl] = useState("");

  useEffect(() => {
    if (kind === "file") return undefined;
    const nextUrl = URL.createObjectURL(file);
    setPreviewUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [file, kind]);

  const icon = kind === "image"
    ? <ImageIcon className="h-3.5 w-3.5" />
    : kind === "video"
      ? <Video className="h-3.5 w-3.5" />
      : <FileText className="h-3.5 w-3.5" />;
  const label = kind === "image" ? t("图片") : kind === "video" ? t("视频") : t("文件");

  return (
    <div className="group relative w-36 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {kind === "image" && previewUrl ? (
        <img src={previewUrl} alt={file.name} className="h-20 w-full bg-slate-100 object-cover" />
      ) : kind === "video" && previewUrl ? (
        <div className="relative h-20 overflow-hidden bg-slate-950">
          <video src={previewUrl} muted playsInline preload="metadata" className="h-full w-full object-cover opacity-80" />
          <span className="absolute inset-0 flex items-center justify-center text-white">
            <Video className="h-6 w-6 drop-shadow" />
          </span>
        </div>
      ) : (
        <div className="flex h-20 items-center justify-center bg-slate-50 text-slate-400">
          <FileText className="h-7 w-7" />
        </div>
      )}
      <div className="px-2 py-1.5">
        <div className="flex items-center gap-1 text-[10px] font-semibold text-slate-500">
          {icon}
          <span>{label}</span>
          <span className="ml-auto tabular-nums text-slate-400">{formatRdFileSize(file.size)}</span>
        </div>
        <div className="mt-0.5 truncate text-[11px] font-medium text-slate-700" title={file.name}>{file.name}</div>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="absolute right-1.5 top-1.5 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-slate-950/72 text-white shadow-sm transition-colors hover:bg-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        aria-label={t("移除附件")}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function nameHue(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return hash % 360;
}

function ConversationAvatar({
  name,
  userId,
  hidden = false,
  size = "md",
}: {
  name: string;
  userId?: string | null;
  hidden?: boolean;
  size?: "xs" | "md";
}) {
  const resolveAvatar = useAvatarDirectory();
  const avatarUrl = resolveAvatar(name, userId);
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => setImgFailed(false), [avatarUrl]);

  const dimensions = size === "xs" ? "h-6 w-6" : "h-7 w-7";
  const textSize = size === "xs" ? "text-[10px]" : "text-[11px]";
  if (hidden) return <span className={cn(dimensions, "shrink-0")} aria-hidden="true" />;
  if (avatarUrl && !imgFailed) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        title={name}
        loading="lazy"
        onError={() => setImgFailed(true)}
        className={cn(dimensions, "shrink-0 rounded-full object-cover shadow-sm ring-2 ring-white")}
      />
    );
  }
  const hue = nameHue(name);
  return (
    <span
      className={cn(dimensions, textSize, "flex shrink-0 items-center justify-center rounded-full font-bold text-white shadow-sm ring-2 ring-white")}
      style={{ background: `linear-gradient(145deg, hsl(${hue} 64% 62%), hsl(${hue} 58% 48%))` }}
      title={name}
    >
      {name.trim().slice(0, 1) || "?"}
    </span>
  );
}

function formatTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(i18nLocale(), { hour: "2-digit", minute: "2-digit" });
}

function formatCompactDateTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diff = Math.round((today - target) / 86_400_000);
  const day = diff === 0
    ? t("今天")
    : diff === 1
      ? t("昨天")
      : `${date.getMonth() + 1}/${date.getDate()}`;
  return `${day} ${formatTime(iso)}`;
}

function localDayKey(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatDayLabel(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diff = Math.round((today - target) / 86_400_000);
  if (diff === 0) return t("今天");
  if (diff === 1) return t("昨天");
  return date.toLocaleDateString(i18nLocale(), { month: "long", day: "numeric", weekday: "short" });
}

function DateDivider({ iso }: { iso: string }) {
  return (
    <div className="flex items-center gap-2 py-2" role="separator" aria-label={formatDayLabel(iso)}>
      <span className="h-px flex-1 bg-gradient-to-r from-transparent to-slate-200" />
      <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[10px] font-semibold text-slate-500 shadow-sm">
        {formatDayLabel(iso)}
      </span>
      <span className="h-px flex-1 bg-gradient-to-l from-transparent to-slate-200" />
    </div>
  );
}

function summaryFor(
  summaries: RdTaskDiscussionThreadSummary[],
  type: "progress_note" | "message",
  id: string,
) {
  return summaries.find((item) => item.anchor_type === type && item.anchor_id === id);
}

function mergeDiscussionMessages(
  ...pages: Array<RdTaskDiscussionMessage[] | undefined>
): RdTaskDiscussionMessage[] {
  const byId = new Map<string, RdTaskDiscussionMessage>();
  for (const page of pages) {
    for (const message of page ?? []) byId.set(message.id, message);
  }
  return Array.from(byId.values()).sort((a, b) => {
    const timeOrder = a.created_at.localeCompare(b.created_at);
    return timeOrder || a.id.localeCompare(b.id);
  });
}

function LoadEarlierButton({
  loading,
  onClick,
}: {
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <div className="flex justify-center py-1.5">
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 text-[10px] font-bold text-slate-600 shadow-sm transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:cursor-wait disabled:opacity-60"
      >
        {loading && <Loader2 className="h-3 w-3 animate-spin" />}
        {loading ? t("正在加载…") : t("加载更早消息")}
      </button>
    </div>
  );
}

function progressTone(progress?: number) {
  if (typeof progress !== "number") {
    return {
      border: "border-l-slate-400",
      header: "bg-slate-50",
      badge: "bg-slate-600",
    };
  }
  if (progress >= 100) {
    return {
      border: "border-l-emerald-500",
      header: "bg-emerald-50/70",
      badge: "bg-emerald-600",
    };
  }
  if (progress >= 60) {
    return {
      border: "border-l-sky-500",
      header: "bg-sky-50/70",
      badge: "bg-sky-600",
    };
  }
  if (progress > 0) {
    return {
      border: "border-l-amber-500",
      header: "bg-amber-50/70",
      badge: "bg-amber-500",
    };
  }
  return {
    border: "border-l-indigo-500",
    header: "bg-indigo-50/70",
    badge: "bg-indigo-600",
  };
}

function ThreadButton({
  summary,
  onClick,
  label = t("回复"),
  inverted = false,
}: {
  summary?: RdTaskDiscussionThreadSummary;
  onClick: () => void;
  label?: string;
  inverted?: boolean;
}) {
  const count = summary?.message_count ?? 0;
  const unread = summary?.unread_count ?? 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-[10px] font-bold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-1",
        inverted
          ? "bg-white/12 text-indigo-50 hover:bg-white/20"
          : count > 0
            ? "bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
            : "text-slate-500 hover:bg-slate-100 hover:text-slate-700",
      )}
      aria-label={count > 0 ? t("查看 {n} 条讨论", { n: count }) : label}
    >
      <MessageCircleReply className="h-3 w-3 transition-transform duration-200 group-hover:translate-x-0.5" />
      <span>{count > 0 ? t("{n} 条讨论", { n: count }) : label}</span>
      {unread > 0 && (
        <span className="min-w-4 rounded-full bg-rose-500 px-1 text-center text-[9px] leading-4 text-white">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </button>
  );
}

function ProgressAnchorCard({
  note,
  summary,
  onOpenThread,
}: {
  note: RdTaskProgressNote;
  summary?: RdTaskDiscussionThreadSummary;
  onOpenThread: () => void;
}) {
  const tone = progressTone(note.progress);
  return (
    <article className={cn("overflow-hidden rounded-lg border border-slate-200 border-l-[3px] bg-white shadow-[0_3px_12px_rgba(15,23,42,0.05)]", tone.border)}>
      <div className={cn("flex min-h-8 items-center gap-1.5 border-b border-slate-200/80 px-2 py-1", tone.header)}>
        <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-bold text-indigo-700">
          <Sparkles className="h-3 w-3" />
          {t("留痕")}
        </span>
        <span className="h-3.5 w-px shrink-0 bg-slate-300/80" aria-hidden="true" />
        <ConversationAvatar name={note.actor.name} userId={note.actor.id} size="xs" />
        <div className="min-w-0 flex-1 truncate text-[10px] text-slate-500">
          <span className="font-bold text-slate-800">{note.actor.name}</span>
          <span> · {note.actor.role ? t(note.actor.role) : t("研发成员")}</span>
        </div>
        {typeof note.progress === "number" && (
          <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold leading-none text-white", tone.badge)}>
            {note.progress}%
          </span>
        )}
        <time className="shrink-0 font-mono text-[9px] tabular-nums text-slate-500">{formatCompactDateTime(note.created_at)}</time>
      </div>
      <div className="px-2.5 py-1.5">
        {note.text && (
          <p className="whitespace-pre-wrap text-[13px] leading-[18px] text-slate-800">
            {renderTextWithMentions(note.text, note.mentions)}
          </p>
        )}
        <ProgressAttachmentGrid attachments={note.attachments} compact className={note.text ? "mt-1.5" : undefined} />
        <div className="mt-1.5 flex items-center border-t border-slate-100 pt-1">
          <ThreadButton summary={summary} onClick={onOpenThread} label={t("讨论")} />
        </div>
      </div>
    </article>
  );
}

function MessageBubble({
  message,
  mine,
  compactTop,
  threadSummary,
  onOpenThread,
  onQuote,
  insideThread = false,
  highlighted = false,
}: {
  message: RdTaskDiscussionMessage;
  mine: boolean;
  compactTop: boolean;
  threadSummary?: RdTaskDiscussionThreadSummary;
  onOpenThread?: () => void;
  onQuote?: () => void;
  insideThread?: boolean;
  highlighted?: boolean;
}) {
  return (
    <motion.div
      data-message-id={message.id}
      layout="position"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: CHAT_EASE }}
      className={cn(
        "flex items-end gap-1.5",
        mine ? "justify-end" : "justify-start",
        compactTop ? "mt-0.5" : "mt-2",
      )}
    >
      {!mine && <ConversationAvatar name={message.author_name} userId={message.author_id} hidden={compactTop} />}
      <div className={cn("min-w-0 max-w-[78%]", mine ? "items-end" : "items-start")}>
        {!mine && !compactTop && (
          <div className="mb-0.5 px-1 text-[10px] font-semibold text-slate-600">
            {message.author_name}
            {message.author_role && <span className="ml-1 font-normal text-slate-400">· {t(message.author_role)}</span>}
          </div>
        )}
        <div
          className={cn(
            "relative overflow-hidden px-3 py-2 shadow-sm transition-[box-shadow,background-color]",
            mine
              ? "rounded-[20px] rounded-br-[7px] bg-indigo-600 text-white shadow-indigo-200/60"
              : "rounded-[20px] rounded-bl-[7px] border border-slate-200 bg-white text-slate-800",
            highlighted && (mine
              ? "ring-2 ring-indigo-300 ring-offset-2"
              : "border-indigo-300 bg-indigo-50 ring-2 ring-indigo-200 ring-offset-2"),
          )}
        >
          {message.reply_to && (
            <div
              className={cn(
                "mb-1.5 rounded-lg border-l-2 px-2 py-1 text-[11px]",
                mine ? "border-white/70 bg-white/12 text-indigo-50" : "border-indigo-400 bg-slate-50 text-slate-500",
              )}
            >
              <div className={cn("font-semibold", mine ? "text-white" : "text-slate-700")}>{message.reply_to.author_name}</div>
              <div className="mt-0.5 line-clamp-2 whitespace-pre-wrap">{message.reply_to.body || t("附件消息")}</div>
            </div>
          )}
          {message.body && (
            <p className="whitespace-pre-wrap break-words text-sm leading-5">
              {renderTextWithMentions(
                message.body,
                message.mentions,
                mine
                  ? "rounded bg-white/20 px-1 font-semibold text-white"
                  : "rounded bg-indigo-50 px-1 font-semibold text-indigo-700",
              )}
            </p>
          )}
          <ProgressAttachmentGrid attachments={message.attachments} compact className="mt-2" />
          <div className={cn("mt-1 flex items-center justify-end gap-1 text-[10px] tabular-nums", mine ? "text-indigo-100" : "text-slate-400")}>
            <span>{formatTime(message.created_at)}</span>
            {message.edited_at && <span>· {t("已编辑")}</span>}
          </div>
        </div>
        <div className={cn("flex items-center gap-1", mine && "justify-end")}>
          {insideThread && onQuote ? (
            <button
              type="button"
              onClick={onQuote}
              className="mt-1 cursor-pointer rounded-full px-2 py-1 text-[11px] font-semibold text-slate-500 transition-colors hover:bg-slate-100 hover:text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              {t("引用回复")}
            </button>
          ) : onOpenThread ? (
            <ThreadButton summary={threadSummary} onClick={onOpenThread} inverted={mine} />
          ) : null}
        </div>
      </div>
      {mine && <ConversationAvatar name={message.author_name} userId={message.author_id} hidden={compactTop} />}
    </motion.div>
  );
}

function Composer({
  taskId,
  anchor,
  candidates,
  variant,
  placeholder,
  contextHint,
  replyTarget,
  onClearReply,
  onSent,
}: {
  taskId: string;
  anchor: { type: RdDiscussionAnchorType; id?: string | null };
  candidates: MentionCandidate[];
  variant: "desktop" | "mobile";
  placeholder: string;
  contextHint: string;
  replyTarget?: RdTaskDiscussionMessage | null;
  onClearReply?: () => void;
  onSent: (message: RdTaskDiscussionMessage) => void;
}) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mention = useMentions({ value: text, setValue: setText, inputRef, candidates });

  const addFiles = useCallback((picked: File[]) => {
    if (picked.length === 0) return;
    const blocked = picked.find(blockedAttachment);
    if (blocked) {
      toast.error(t("附件 {name} 属于高风险可执行文件，不能上传", { name: blocked.name }));
      return;
    }
    const oversized = picked.find((file) => file.size > DISCUSSION_MAX_FILE_BYTES);
    if (oversized) {
      toast.error(t("附件 {name} 超过单文件 25MB 限制", { name: oversized.name }));
      return;
    }
    const next = [...files, ...picked];
    if (next.length > DISCUSSION_MAX_FILES) {
      toast.error(t("每条消息最多上传 {n} 个附件", { n: DISCUSSION_MAX_FILES }));
      return;
    }
    const totalBytes = next.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > DISCUSSION_MAX_TOTAL_BYTES) {
      toast.error(t("单条消息附件总大小不能超过 50MB"));
      return;
    }
    setFiles(next);
  }, [files]);

  const submit = async () => {
    if ((!text.trim() && files.length === 0) || sending) return;
    setSending(true);
    try {
      const result = await createRdTaskDiscussionMessage({
        task_id: taskId,
        anchor,
        text: text.trim(),
        reply_to_id: replyTarget?.id,
        mentions: mention.mentionsForSubmit(text),
        files,
      });
      setText("");
      setFiles([]);
      mention.resetMentions();
      onClearReply?.();
      onSent(result.message);
      announceDiscussionUpdated(taskId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("发送失败，请重试"));
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className={cn(
        "relative border-t border-slate-200 bg-white/95 px-3 py-2 backdrop-blur-xl",
        variant === "mobile" && "[padding-bottom:calc(0.5rem+env(safe-area-inset-bottom))]",
      )}
      onDragEnter={(event) => {
        if (variant !== "desktop" || !event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setDraggingFiles(true);
      }}
      onDragOver={(event) => {
        if (variant !== "desktop" || !event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setDraggingFiles(false);
      }}
      onDrop={(event) => {
        if (variant !== "desktop") return;
        event.preventDefault();
        setDraggingFiles(false);
        addFiles(Array.from(event.dataTransfer.files ?? []));
      }}
    >
      <AnimatePresence>
        {draggingFiles && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-2 z-20 flex items-center justify-center rounded-2xl border-2 border-dashed border-indigo-300 bg-indigo-50/95 text-indigo-700 shadow-lg"
          >
            <span className="inline-flex items-center gap-2 text-sm font-bold">
              <UploadCloud className="h-5 w-5" />
              {t("松开即可添加到本条消息")}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
      <MentionSuggestionPanel
        open={mention.open}
        candidates={mention.filtered}
        highlightIndex={mention.highlightIndex}
        onPick={mention.pick}
        variant={variant}
      />
      <AnimatePresence initial={false}>
        {replyTarget && (
          <motion.div
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.16 }}
            className="mb-1.5 flex items-center gap-2 rounded-xl border border-indigo-100 bg-indigo-50/70 px-3 py-1.5"
          >
            <MessageCircleReply className="h-4 w-4 shrink-0 text-indigo-500" />
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-bold text-indigo-700">{t("回复 {name}", { name: replyTarget.author_name })}</div>
              <div className="truncate text-xs text-slate-600">{replyTarget.body || t("附件消息")}</div>
            </div>
            <button
              type="button"
              onClick={onClearReply}
              className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-white hover:text-slate-700"
              aria-label={t("取消引用")}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      {files.length > 0 && (
        <div className="mb-1.5 flex gap-2 overflow-x-auto pb-1" aria-label={t("待发送附件")}>
          {files.map((file, index) => (
            <PendingAttachment
              key={`${file.name}-${file.lastModified}-${index}`}
              file={file}
              onRemove={() => setFiles((current) => current.filter((_, i) => i !== index))}
            />
          ))}
        </div>
      )}
      <div className="flex items-end gap-2 rounded-[22px] border border-slate-200 bg-slate-50 p-1.5 transition-colors focus-within:border-indigo-300 focus-within:bg-white focus-within:ring-4 focus-within:ring-indigo-50">
        <label
          className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-white hover:text-indigo-600"
          title={t("添加附件")}
        >
          <Paperclip className="h-4 w-4" />
          <input
            type="file"
            multiple
            aria-label={t("选择讨论附件")}
            className="hidden"
            onChange={(event) => {
              addFiles(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
        </label>
        <textarea
          ref={inputRef}
          value={text}
          rows={1}
          maxLength={4000}
          aria-label={t("输入协作消息")}
          placeholder={placeholder}
          onChange={(event) => {
            setText(event.target.value);
            mention.syncActiveQuery();
            event.currentTarget.style.height = "auto";
            event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 112)}px`;
          }}
          onClick={mention.syncActiveQuery}
          onKeyUp={mention.syncActiveQuery}
          onKeyDown={(event) => {
            if (mention.handleKeyDown(event)) return;
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void submit();
            }
          }}
          className="min-h-9 max-h-28 min-w-0 flex-1 resize-none bg-transparent px-1 py-2 text-sm leading-5 text-slate-800 outline-none placeholder:text-slate-400"
        />
        <motion.button
          type="button"
          whileTap={{ scale: 0.92 }}
          onClick={() => void submit()}
          disabled={(!text.trim() && files.length === 0) || sending}
          className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-indigo-600 text-white shadow-[0_6px_16px_rgba(79,70,229,0.28)] transition-colors hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
          aria-label={t("发送消息")}
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </motion.button>
      </div>
      <div className="mt-1 flex items-center justify-between gap-3 px-2 text-[10px] text-slate-500">
        <span>
          {contextHint}
          {variant === "mobile" ? t(" · 可上传图片、视频或文件") : ""}
        </span>
        <span className="hidden shrink-0 sm:inline">
          {text.length >= 3600
            ? `${text.length}/4000`
            : t("图片、视频或文件 · 最多 10 个 · Ctrl / ⌘ + Enter 发送")}
        </span>
      </div>
      <div className="sr-only" aria-live="polite">
        {sending
          ? t("正在上传并发送 {n} 个附件", { n: files.length })
          : files.length > 0
            ? t("已选择 {n} 个附件", { n: files.length })
            : ""}
      </div>
    </div>
  );
}

function ReadOnlyComposerNotice() {
  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500">
        <LockKeyhole className="h-3.5 w-3.5" />
      </span>
      <span>{t("当前账号可查看讨论，但没有发送权限。")}</span>
    </div>
  );
}

function AnchorPreview({
  anchor,
  compact = false,
}: {
  anchor: ConversationAnchor;
  compact?: boolean;
}) {
  const attachments = anchor.note?.attachments ?? anchor.message?.attachments ?? anchor.attachments ?? [];
  const authorId = anchor.note?.actor.id ?? anchor.message?.author_id ?? anchor.authorId ?? null;
  return (
    <div className="border-b border-slate-200 bg-slate-50/80 px-3 py-2">
      <div className="flex items-center gap-2 text-[10px] font-bold tracking-[0.08em] text-indigo-600">
        {anchor.type === "progress_note" ? <Sparkles className="h-3.5 w-3.5" /> : <MessageCircleMore className="h-3.5 w-3.5" />}
        {anchor.type === "progress_note" ? t("原始进度记录") : t("原始任务消息")}
      </div>
      <div className="mt-1.5 rounded-lg border border-slate-200 border-l-2 border-l-indigo-400 bg-white px-2.5 py-2 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-1.5">
            <ConversationAvatar name={anchor.author} userId={authorId} size="xs" />
            <div className="truncate text-[11px] font-semibold text-slate-700">{anchor.author}</div>
          </div>
          <div className="shrink-0 text-[10px] tabular-nums text-slate-400">
            {new Date(anchor.createdAt).toLocaleString(i18nLocale(), {
              month: "numeric",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
        </div>
        <div className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs leading-4 text-slate-600">
          {anchor.preview || t("附件消息")}
        </div>
        {attachments.length > 0 && !compact && (
          <ProgressAttachmentGrid attachments={attachments} compact className="mt-1.5" />
        )}
        {attachments.length > 0 && compact && (
          <div className="mt-1 text-[10px] font-semibold text-slate-500">
            {t("{n} 个附件", { n: attachments.length })}
          </div>
        )}
      </div>
      {anchor.type === "progress_note" && (
        <p className="mt-1 text-[10px] leading-4 text-slate-500">
          {t("回复只显示在本条进度下，不会修改原始记录。")}
        </p>
      )}
    </div>
  );
}

function ThreadInvitationBanner({
  inviterName,
  compact,
}: {
  inviterName: string;
  compact: boolean;
}) {
  return (
    <div className={cn("border-b border-indigo-100 bg-indigo-50/70", compact ? "px-2.5 py-2" : "px-3 py-2.5")}>
      <div className="rounded-lg border border-indigo-200 bg-white/90 px-2.5 py-2 shadow-[0_2px_8px_rgba(79,70,229,0.06)]">
        <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-700">
          <Sparkles className="h-3.5 w-3.5" />
          <span>{t("{name} 邀请你参与这条讨论", { name: inviterName || t("任务成员") })}</span>
          <span className="ml-auto shrink-0 rounded-full bg-indigo-600 px-2 py-0.5 text-[9px] text-white">{t("受邀参与")}</span>
        </div>
        <p className="mt-1 text-[10px] leading-4 text-slate-600">
          {t("你可以查看原始留痕并在本线程回复，不会加入整个任务。")}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1">
          <span className="inline-flex items-center gap-1 rounded-md border border-indigo-100 bg-indigo-50 px-1.5 py-1 text-[9px] font-semibold text-indigo-700">
            <Eye className="h-3 w-3" />
            {t("可查看本线程")}
          </span>
          <span className="inline-flex items-center gap-1 rounded-md border border-indigo-100 bg-indigo-50 px-1.5 py-1 text-[9px] font-semibold text-indigo-700">
            <Paperclip className="h-3 w-3" />
            {t("可回复 / 上传附件")}
          </span>
          <span className="inline-flex items-center gap-1 rounded-md border border-rose-100 bg-rose-50 px-1.5 py-1 text-[9px] font-semibold text-rose-600">
            <LockKeyhole className="h-3 w-3" />
            {t("不可查看其他讨论")}
          </span>
        </div>
      </div>
    </div>
  );
}

export function RDTaskConversation({
  taskId,
  taskTitle,
  notes,
  mode = "task",
  variant = "desktop",
  notesLoading = false,
  notesError,
  onRetryNotes,
  progressComposer,
  showHeader = true,
  threadLayout = "responsive",
  focusAnchor,
  focusMessageId,
  className,
  onActivity,
  onMessageSent,
  onCloseFocus,
  onUnreadChange,
  onThreadOpenChange,
}: {
  taskId: string;
  taskTitle: string;
  notes: RdTaskProgressNote[];
  mode?: "task" | "progress";
  variant?: "desktop" | "mobile";
  notesLoading?: boolean;
  notesError?: string | null;
  onRetryNotes?: () => void;
  progressComposer?: React.ReactNode;
  showHeader?: boolean;
  threadLayout?: "responsive" | "replace";
  focusAnchor?: RdFocusedDiscussionAnchor;
  focusMessageId?: string | null;
  className?: string;
  onActivity?: () => void;
  onMessageSent?: (message: RdTaskDiscussionMessage) => void;
  onCloseFocus?: () => void;
  onUnreadChange?: (count: number) => void;
  onThreadOpenChange?: (open: boolean) => void;
}) {
  useI18n();
  const { user } = useAuth();
  const reduceMotion = useReducedMotion();
  const [main, setMain] = useState<RdTaskDiscussionResponse | null>(null);
  const [mainLoading, setMainLoading] = useState(true);
  const [activeAnchor, setActiveAnchor] = useState<ConversationAnchor | null>(null);
  const [thread, setThread] = useState<RdTaskDiscussionResponse | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [mainEarlierLoading, setMainEarlierLoading] = useState(false);
  const [threadEarlierLoading, setThreadEarlierLoading] = useState(false);
  const [replyTarget, setReplyTarget] = useState<RdTaskDiscussionMessage | null>(null);
  const [people, setPeople] = useState<MentionCandidate[]>([]);
  const mainScrollRef = useRef<HTMLDivElement>(null);
  const threadScrollRef = useRef<HTMLDivElement>(null);
  const preserveMainScrollRef = useRef(false);
  const preserveThreadScrollRef = useRef(false);
  const focusOpenedRef = useRef("");

  useEffect(() => {
    onThreadOpenChange?.(Boolean(activeAnchor));
    return () => onThreadOpenChange?.(false);
  }, [activeAnchor, onThreadOpenChange]);

  const loadMain = useCallback(async (showLoading = true) => {
    if (focusAnchor && focusAnchor.type !== "task") {
      setMainLoading(false);
      return;
    }
    if (showLoading) setMainLoading(true);
    try {
      const response = await fetchRdTaskDiscussion(taskId, { type: "task" });
      const normalized = {
        ...response,
        thread: {
          ...response.thread,
          unread_count: mode === "task" ? 0 : response.thread.unread_count,
        },
      };
      setMain((current) => showLoading || !current
        ? normalized
        : {
            ...normalized,
            messages: mergeDiscussionMessages(current.messages, normalized.messages),
            page_info: current.page_info,
          });
      if (mode === "task" && response.thread.unread_count > 0) {
        void markRdTaskDiscussionRead(taskId, response.thread.id)
          .then(() => announceDiscussionUpdated(taskId))
          .catch(() => {});
        onActivity?.();
      }
    } catch (error) {
      if (showLoading) toast.error(error instanceof Error ? error.message : t("协作对话加载失败"));
    } finally {
      if (showLoading) setMainLoading(false);
    }
  }, [focusAnchor, mode, onActivity, taskId]);

  const loadEarlierMain = useCallback(async () => {
    const cursor = main?.page_info.next_cursor;
    if (!cursor || mainEarlierLoading) return;
    setMainEarlierLoading(true);
    const scroller = mainScrollRef.current;
    const previousHeight = scroller?.scrollHeight ?? 0;
    const previousTop = scroller?.scrollTop ?? 0;
    try {
      const response = await fetchRdTaskDiscussion(taskId, { type: "task" }, { cursor });
      setMain((current) => current
        ? {
            ...current,
            messages: mergeDiscussionMessages(response.messages, current.messages),
            page_info: response.page_info,
          }
        : response);
      preserveMainScrollRef.current = true;
      requestAnimationFrame(() => {
        if (scroller) scroller.scrollTop = previousTop + (scroller.scrollHeight - previousHeight);
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("更早消息加载失败"));
    } finally {
      setMainEarlierLoading(false);
    }
  }, [main?.page_info.next_cursor, mainEarlierLoading, taskId]);

  useEffect(() => {
    void loadMain();
  }, [loadMain]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void loadMain(false);
    };
    const onDiscussionUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ taskId?: string }>).detail;
      if (!detail?.taskId || detail.taskId === taskId) refresh();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const interval = window.setInterval(refresh, DISCUSSION_POLL_INTERVAL_MS);
    window.addEventListener("focus", refresh);
    window.addEventListener("rd:discussion-updated", onDiscussionUpdated as EventListener);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("rd:discussion-updated", onDiscussionUpdated as EventListener);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [loadMain, taskId]);

  useEffect(() => {
    let cancelled = false;
    fetchRdPeople()
      .then((list) => {
        if (cancelled) return;
        setPeople(list.map((person) => ({
          user_id: person.user_id ?? null,
          name: person.name,
          hint: person.position,
        })));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const candidates = useMemo(() => {
    const map = new Map<string, MentionCandidate>();
    const add = (candidate: MentionCandidate) => {
      const key = candidate.user_id || candidate.name;
      if (candidate.name.trim() && !map.has(key)) map.set(key, candidate);
    };
    for (const person of people) add(person);
    for (const note of notes) add({ user_id: note.actor.id, name: note.actor.name, hint: note.actor.role });
    if (user) add({ user_id: user.id, name: user.name, hint: t("我") });
    return Array.from(map.values());
  }, [notes, people, user]);

  const feedItems = useMemo<ConversationFeedItem[]>(() => {
    const items: ConversationFeedItem[] = mode === "progress"
      ? notes.map((note) => ({ kind: "note" as const, createdAt: note.created_at, note }))
      : (main?.messages ?? []).map((message) => ({
          kind: "message" as const,
          createdAt: message.created_at,
          message,
        }));
    return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [main?.messages, mode, notes]);

  const relatedProgressThreads = useMemo(() => {
    if (mode !== "task") return [];
    return notes
      .map((note) => {
        const summary = summaryFor(main?.thread_summaries ?? [], "progress_note", note.id);
        return summary && summary.message_count > 0 ? { note, summary } : null;
      })
      .filter((item): item is { note: RdTaskProgressNote; summary: RdTaskDiscussionThreadSummary } => Boolean(item))
      .sort((a, b) => (b.summary.last_message_at ?? "").localeCompare(a.summary.last_message_at ?? ""));
  }, [main?.thread_summaries, mode, notes]);

  useEffect(() => {
    if (!main || !onUnreadChange) return;
    const summaryUnread = main.thread_summaries.reduce((sum, item) => sum + item.unread_count, 0);
    onUnreadChange(summaryUnread || main.thread.unread_count);
  }, [main, onUnreadChange]);

  useEffect(() => {
    if (mainLoading || (mode === "progress" && notesLoading) || !mainScrollRef.current) return;
    if (preserveMainScrollRef.current) {
      preserveMainScrollRef.current = false;
      return;
    }
    const frame = requestAnimationFrame(() => {
      if (mainScrollRef.current) mainScrollRef.current.scrollTop = mainScrollRef.current.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [feedItems.length, mainLoading, mode, notesLoading]);

  const loadThread = useCallback(async (anchor: ConversationAnchor, showLoading = false) => {
    if (showLoading) {
      setThread(null);
      setThreadLoading(true);
    }
    try {
      const response = await fetchRdTaskDiscussion(taskId, { type: anchor.type, id: anchor.id });
      if (response.anchor_preview) {
        const preview = response.anchor_preview;
        setActiveAnchor((current) => current
          ? {
              ...current,
              author: preview.author_name,
              authorId: preview.author_id,
              preview: preview.body,
              createdAt: preview.created_at,
              attachments: preview.attachments,
            }
          : current);
      }
      const normalized = { ...response, thread: { ...response.thread, unread_count: 0 } };
      setThread((current) => showLoading || !current
        ? normalized
        : {
            ...normalized,
            messages: mergeDiscussionMessages(current.messages, normalized.messages),
            page_info: current.page_info,
          });
      if (response.thread.unread_count > 0) {
        await markRdTaskDiscussionRead(taskId, response.thread.id);
        announceDiscussionUpdated(taskId);
        onActivity?.();
      }
      setMain((current) => current
        ? {
            ...current,
            thread_summaries: response.thread_summaries.map((item) =>
              item.thread_id === response.thread.id ? { ...item, unread_count: 0 } : item,
            ),
          }
        : current);
    } catch (error) {
      if (showLoading) {
        toast.error(error instanceof Error ? error.message : t("讨论线程加载失败"));
        setActiveAnchor(null);
      }
    } finally {
      if (showLoading) setThreadLoading(false);
    }
  }, [onActivity, taskId]);

  const openThread = useCallback(async (anchor: ConversationAnchor) => {
    setActiveAnchor(anchor);
    setReplyTarget(null);
    await loadThread(anchor, true);
  }, [loadThread]);

  useEffect(() => {
    if (!focusAnchor || focusAnchor.type === "task" || !focusAnchor.id) return;
    const key = `${focusAnchor.type}:${focusAnchor.id}`;
    if (focusOpenedRef.current === key) return;
    focusOpenedRef.current = key;
    void openThread({
      type: focusAnchor.type,
      id: focusAnchor.id,
      author: focusAnchor.author || t("任务成员"),
      authorId: focusAnchor.authorId,
      preview: focusAnchor.preview || "",
      createdAt: focusAnchor.createdAt || new Date().toISOString(),
    });
  }, [focusAnchor, openThread]);

  const loadEarlierThread = useCallback(async () => {
    const cursor = thread?.page_info.next_cursor;
    if (!cursor || !activeAnchor || threadEarlierLoading) return;
    setThreadEarlierLoading(true);
    const scroller = threadScrollRef.current;
    const previousHeight = scroller?.scrollHeight ?? 0;
    const previousTop = scroller?.scrollTop ?? 0;
    try {
      const response = await fetchRdTaskDiscussion(
        taskId,
        { type: activeAnchor.type, id: activeAnchor.id },
        { cursor },
      );
      setThread((current) => current
        ? {
            ...current,
            messages: mergeDiscussionMessages(response.messages, current.messages),
            page_info: response.page_info,
          }
        : response);
      preserveThreadScrollRef.current = true;
      requestAnimationFrame(() => {
        if (scroller) scroller.scrollTop = previousTop + (scroller.scrollHeight - previousHeight);
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("更早消息加载失败"));
    } finally {
      setThreadEarlierLoading(false);
    }
  }, [activeAnchor, taskId, thread?.page_info.next_cursor, threadEarlierLoading]);

  useEffect(() => {
    if (!activeAnchor) return undefined;
    const refresh = () => {
      if (document.visibilityState === "visible") void loadThread(activeAnchor, false);
    };
    const interval = window.setInterval(refresh, DISCUSSION_POLL_INTERVAL_MS);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, [activeAnchor, loadThread]);

  useEffect(() => {
    if (threadLoading || !threadScrollRef.current) return;
    if (preserveThreadScrollRef.current) {
      preserveThreadScrollRef.current = false;
      return;
    }
    const frame = requestAnimationFrame(() => {
      if (threadScrollRef.current) threadScrollRef.current.scrollTop = threadScrollRef.current.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [thread?.messages.length, threadLoading]);

  useEffect(() => {
    if (!focusMessageId) return;
    const root = activeAnchor ? threadScrollRef.current : mainScrollRef.current;
    const target = root?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(focusMessageId)}"]`);
    if (!target) return;
    const frame = requestAnimationFrame(() => {
      target.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeAnchor, focusMessageId, main?.messages.length, reduceMotion, thread?.messages.length]);

  const closeThread = () => {
    if (focusAnchor && focusAnchor.type !== "task") {
      onCloseFocus?.();
      return;
    }
    setActiveAnchor(null);
    setThread(null);
    setReplyTarget(null);
    void loadMain(false);
  };

  const appendMainMessage = (message: RdTaskDiscussionMessage) => {
    setMain((current) => current
      ? {
          ...current,
          messages: [...current.messages, message],
          thread: { ...current.thread, message_count: current.thread.message_count + 1 },
        }
      : current);
    onMessageSent?.(message);
    onActivity?.();
  };

  const appendThreadMessage = (message: RdTaskDiscussionMessage) => {
    setThread((current) => current
      ? {
          ...current,
          messages: [...current.messages, message],
          thread: { ...current.thread, message_count: current.thread.message_count + 1 },
        }
      : current);
    setReplyTarget(null);
    if (!focusAnchor || focusAnchor.type === "task") void loadMain(false);
    onMessageSent?.(message);
    onActivity?.();
  };

  const mainContent = (
    <section
      className="flex min-w-0 flex-1 flex-col bg-[radial-gradient(circle_at_top,_rgba(238,242,255,0.82),_rgba(248,250,252,0.64)_36%,_white_76%)]"
      aria-label={`${mode === "progress" ? t("进度留痕") : t("任务讨论")}：${taskTitle}`}
    >
      {main?.access_scope === "thread_invitee" && (
        <ThreadInvitationBanner
          inviterName={main.invitation?.invited_by_name ?? ""}
          compact={variant === "mobile"}
        />
      )}
      <div ref={mainScrollRef} className="cockpit-scroll min-h-0 flex-1 overflow-y-auto px-2.5 pb-2 sm:px-4" aria-live="polite">
        {mainLoading || (mode === "progress" && notesLoading) ? (
          <div className="space-y-3 py-5">
            {[0, 1, 2].map((item) => (
              <div key={item} className={cn("flex animate-pulse gap-2", item % 2 ? "justify-end" : "justify-start")}>
                <div className="h-8 w-8 rounded-full bg-slate-200" />
                <div className="h-16 w-[58%] rounded-2xl bg-slate-100" />
              </div>
            ))}
          </div>
        ) : mode === "progress" && notesError ? (
          <div className="flex h-full min-h-72 flex-col items-center justify-center px-8 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-rose-100 bg-rose-50 text-rose-500">
              <X className="h-6 w-6" />
            </span>
            <h5 className="mt-4 text-sm font-bold text-slate-800">{t("进度留痕加载失败")}</h5>
            <p className="mt-1 max-w-xs text-xs leading-5 text-slate-500">{notesError}</p>
            {onRetryNotes && (
              <button
                type="button"
                onClick={onRetryNotes}
                className="mt-4 min-h-10 cursor-pointer rounded-xl bg-indigo-600 px-4 text-xs font-bold text-white transition-colors hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2"
              >
                {t("重新加载")}
              </button>
            )}
          </div>
        ) : feedItems.length === 0 && relatedProgressThreads.length === 0 ? (
          <div className="flex h-full min-h-72 flex-col items-center justify-center px-8 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-indigo-100 bg-indigo-50 text-indigo-600">
              {mode === "progress" ? <Sparkles className="h-6 w-6" /> : <MessageCircleMore className="h-6 w-6" />}
            </span>
            <h5 className="mt-4 text-sm font-bold text-slate-800">
              {mode === "progress" ? t("还没有进度留痕") : t("开始这个任务的第一段讨论")}
            </h5>
            <p className="mt-1 max-w-xs text-xs leading-5 text-slate-500">
              {mode === "progress"
                ? t("记录发生了什么；需要沟通时，可从具体记录发起讨论。")
                : t("这里讨论整个任务；回复具体进度，请前往“进度留痕”。")}
            </p>
          </div>
        ) : (
          <div className={cn("mx-auto w-full", mode === "progress" ? "max-w-6xl" : "max-w-3xl")}>
            {mode === "progress" && <TaskImageGallery notes={notes} defaultCollapsed className="mt-2" />}
            {mode === "task" && main?.page_info.has_more && (
              <LoadEarlierButton loading={mainEarlierLoading} onClick={() => void loadEarlierMain()} />
            )}
            {mode === "task" && relatedProgressThreads.length > 0 && (
              <section className="mt-2 rounded-xl border border-indigo-100 bg-white/90 p-2.5 shadow-[0_5px_18px_rgba(79,70,229,0.05)]">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h5 className="text-xs font-bold text-slate-800">{t("相关进度讨论")}</h5>
                    <p className="mt-0.5 text-[10px] text-slate-500">{t("仅显示已经产生回复的进度记录")}</p>
                  </div>
                  <span className="rounded-full bg-indigo-50 px-2 py-1 text-[10px] font-bold text-indigo-700">
                    {relatedProgressThreads.length}
                  </span>
                </div>
                <div className="mt-1.5 grid grid-cols-[repeat(auto-fit,minmax(min(100%,20rem),1fr))] gap-1.5">
                  {relatedProgressThreads.map(({ note, summary }) => {
                    const anchor: ConversationAnchor = {
                      type: "progress_note",
                      id: note.id,
                      author: note.actor.name,
                      preview: note.text,
                      createdAt: note.created_at,
                      note,
                    };
                    return (
                      <button
                        key={note.id}
                        type="button"
                        onClick={() => void openThread(anchor)}
                        className="group flex min-h-14 cursor-pointer items-start gap-2 rounded-lg border border-slate-200 bg-slate-50/70 px-2.5 py-2 text-left transition-colors duration-200 hover:border-indigo-200 hover:bg-indigo-50/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                      >
                        <ConversationAvatar name={note.actor.name} userId={note.actor.id} size="xs" />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2 text-[10px] text-slate-500">
                            <span className="truncate font-semibold text-slate-700">{note.actor.name}</span>
                            <span className="ml-auto shrink-0 tabular-nums">{formatDayLabel(note.created_at)}</span>
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-slate-600">{note.text || t("附件进度记录")}</span>
                          <span className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-bold text-indigo-700">
                            {t("{n} 条讨论", { n: summary.message_count })}
                            {summary.unread_count > 0 && (
                              <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[9px] text-white">
                                {summary.unread_count > 99 ? "99+" : summary.unread_count}
                              </span>
                            )}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}
            {mode === "progress" ? (
              <div className="mt-1.5 grid grid-cols-[repeat(auto-fit,minmax(min(100%,20rem),1fr))] items-start gap-1.5">
                {feedItems.map((item) => {
                  if (item.kind !== "note") return null;
                  const noteSummary = summaryFor(main?.thread_summaries ?? [], "progress_note", item.note.id);
                  const anchor: ConversationAnchor = {
                    type: "progress_note",
                    id: item.note.id,
                    author: item.note.actor.name,
                    preview: item.note.text,
                    createdAt: item.note.created_at,
                    note: item.note,
                  };
                  return (
                    <ProgressAnchorCard
                      key={item.note.id}
                      note={item.note}
                      summary={noteSummary}
                      onOpenThread={() => void openThread(anchor)}
                    />
                  );
                })}
              </div>
            ) : (
              feedItems.map((item, index) => {
                if (item.kind !== "message") return null;
                const previous = feedItems[index - 1];
                const showDay = !previous || localDayKey(previous.createdAt) !== localDayKey(item.createdAt);
                const mine = Boolean(
                  user && (item.message.author_id === user.id || (!item.message.author_id && item.message.author_name === user.name)),
                );
                const previousMessage = previous?.kind === "message" ? previous.message : null;
                const compactTop = Boolean(
                  !showDay &&
                  previousMessage &&
                  previousMessage.author_id === item.message.author_id &&
                  previousMessage.author_name === item.message.author_name &&
                  new Date(item.message.created_at).getTime() - new Date(previousMessage.created_at).getTime() < 5 * 60_000,
                );
                const messageSummary = summaryFor(main?.thread_summaries ?? [], "message", item.message.id);
                const anchor: ConversationAnchor = {
                  type: "message",
                  id: item.message.id,
                  author: item.message.author_name,
                  preview: item.message.body,
                  createdAt: item.message.created_at,
                  message: item.message,
                };
                return (
                  <React.Fragment key={`message-${item.message.id}`}>
                    {showDay && <DateDivider iso={item.createdAt} />}
                    <MessageBubble
                      message={item.message}
                      mine={mine}
                      compactTop={compactTop}
                      highlighted={item.message.id === focusMessageId}
                      threadSummary={messageSummary}
                      onOpenThread={() => void openThread(anchor)}
                    />
                  </React.Fragment>
                );
              })
            )}
          </div>
        )}
      </div>
      {mode === "task" && main?.can_post ? (
        <Composer
          taskId={taskId}
          anchor={{ type: "task" }}
          candidates={candidates}
          variant={variant}
          placeholder={t("讨论整个任务，@ 提及成员…")}
          contextHint={t("发送到任务讨论")}
          onSent={appendMainMessage}
        />
      ) : mode === "task" && main ? (
        <ReadOnlyComposerNotice />
      ) : progressComposer ? (
        progressComposer
      ) : null}
    </section>
  );

  return (
    <div className={cn("relative flex min-h-0 flex-1 overflow-hidden bg-white", className)}>
      {mainContent}
      <AnimatePresence initial={false}>
        {activeAnchor && (
          <>
            {variant === "desktop" && threadLayout === "responsive" && (
              <motion.button
                type="button"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={closeThread}
                className="absolute inset-0 z-10 cursor-default bg-slate-950/20 backdrop-blur-[1px] xl:hidden"
                aria-label={t("关闭讨论线程")}
              />
            )}
            <motion.aside
              role="dialog"
              aria-modal={variant === "mobile" || undefined}
              aria-label={activeAnchor.type === "progress_note" ? t("关于这条进度的讨论") : t("消息讨论")}
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 36 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 28 }}
              transition={{ duration: reduceMotion ? 0.1 : 0.24, ease: CHAT_EASE }}
              className={cn(
                "z-20 flex min-h-0 flex-col border-l border-slate-200 bg-white shadow-[-18px_0_50px_rgba(15,23,42,0.14)]",
                variant === "mobile"
                  ? "absolute inset-0"
                  : threadLayout === "replace"
                    ? "absolute inset-0 w-full border-l-0 shadow-none"
                    : "absolute inset-y-0 right-0 w-full max-w-[440px] xl:static xl:w-[420px] xl:shrink-0 xl:shadow-none",
              )}
            >
              <header className="flex h-12 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-2.5">
                <button
                  type="button"
                  onClick={closeThread}
                  className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                  aria-label={mode === "progress" ? t("返回进度留痕") : t("返回任务讨论")}
                >
                  <ArrowLeft className="h-4.5 w-4.5" />
                </button>
                <div className="min-w-0 flex-1">
                  <h5 className="truncate text-sm font-bold text-slate-900">
                    {activeAnchor.type === "progress_note" ? t("关于这条进度的讨论") : t("消息讨论")}
                  </h5>
                  <p className="truncate text-[10px] text-slate-500">
                    {threadLoading ? t("读取中…") : t("{n} 条回复", { n: thread?.messages.length ?? 0 })}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeThread}
                  className="hidden h-8 w-8 cursor-pointer items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 sm:flex"
                  aria-label={t("关闭")}
                >
                  <X className="h-4 w-4" />
                </button>
              </header>
              {thread?.access_scope === "thread_invitee" && (
                <ThreadInvitationBanner
                  inviterName={thread.invitation?.invited_by_name ?? ""}
                  compact={variant === "mobile" || threadLayout === "replace"}
                />
              )}
              <AnchorPreview
                anchor={activeAnchor}
                compact={variant === "desktop" && threadLayout === "replace"}
              />
              <div ref={threadScrollRef} className="cockpit-scroll min-h-0 flex-1 overflow-y-auto bg-slate-50/60 px-2.5 py-2" aria-live="polite">
                {threadLoading ? (
                  <div className="flex h-full items-center justify-center text-slate-400">
                    <Loader2 className="h-5 w-5 animate-spin" />
                  </div>
                ) : (thread?.messages.length ?? 0) === 0 ? (
                  <div className="flex h-full min-h-48 flex-col items-center justify-center px-8 text-center">
                    <MessageCircleReply className="h-7 w-7 text-indigo-300" />
                    <div className="mt-3 text-sm font-semibold text-slate-700">{t("还没有相关讨论")}</div>
                    <div className="mt-1 max-w-xs text-xs leading-5 text-slate-500">
                      {activeAnchor.type === "progress_note"
                        ? t("可以就这条进度提出问题、补充说明或上传材料。")
                        : t("在下面发送第一条相关讨论。")}
                    </div>
                  </div>
                ) : (
                  <div className="pb-2">
                    {thread?.page_info.has_more && (
                      <LoadEarlierButton loading={threadEarlierLoading} onClick={() => void loadEarlierThread()} />
                    )}
                    {thread?.messages.map((message, index) => {
                      const previous = thread.messages[index - 1];
                      const showDay = !previous || localDayKey(previous.created_at) !== localDayKey(message.created_at);
                      const mine = Boolean(
                        user && (message.author_id === user.id || (!message.author_id && message.author_name === user.name)),
                      );
                      const compactTop = Boolean(
                        !showDay &&
                        previous &&
                        previous.author_id === message.author_id &&
                        previous.author_name === message.author_name &&
                        new Date(message.created_at).getTime() - new Date(previous.created_at).getTime() < 5 * 60_000,
                      );
                      return (
                        <React.Fragment key={message.id}>
                          {showDay && <DateDivider iso={message.created_at} />}
                          <MessageBubble
                            message={message}
                            mine={mine}
                            compactTop={compactTop}
                            highlighted={message.id === focusMessageId}
                            insideThread
                            onQuote={() => setReplyTarget(message)}
                          />
                        </React.Fragment>
                      );
                    })}
                  </div>
                )}
              </div>
              {thread?.can_post ? (
                <Composer
                  taskId={taskId}
                  anchor={{ type: activeAnchor.type, id: activeAnchor.id }}
                  candidates={candidates}
                  variant={variant}
                  placeholder={activeAnchor.type === "progress_note" ? t("回复这条进度…") : t("回复这条消息…")}
                  contextHint={activeAnchor.type === "progress_note" ? t("仅发送到本条进度讨论") : t("仅发送到本条消息讨论")}
                  replyTarget={replyTarget}
                  onClearReply={() => setReplyTarget(null)}
                  onSent={appendThreadMessage}
                />
              ) : thread ? (
                <ReadOnlyComposerNotice />
              ) : null}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
