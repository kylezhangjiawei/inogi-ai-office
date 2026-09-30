import { Button } from "./components/ui/button";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import {
  ArrowLeft,
  ChevronDown,
  Eye,
  FileText,
  GitBranch,
  ImageIcon,
  LockKeyhole,
  Loader2,
  MessageCircleMore,
  MessageCircleReply,
  Paperclip,
  RefreshCw,
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
  isMentionablePerson,
  fetchRdTaskDiscussion,
  isUsCollabWorkspace,
  markRdTaskDiscussionRead,
  type RdDiscussionAnchorType,
  type RdTaskDiscussionMessage,
  type RdTaskDiscussionResponse,
  type RdTaskDiscussionThreadSummary,
  type RdTaskProgressAttachment,
  type RdTaskProgressNote,
} from "./lib/rdApi";
import { auditActorMatchesIdentity, type AuditActorIdentity } from "./lib/auditLog";
import { i18nLocale, t, useI18n } from "./lib/i18n";
import { useAvatarDirectory } from "./lib/userAvatar";
import { formatRdFileSize, ProgressAttachmentGrid, TaskImageGallery, TaskImageGalleryScope } from "./RDProgressEvidence";
import { Input } from "./components/ui/input";
import { Textarea } from "./components/ui/textarea";

const DISCUSSION_MAX_FILES = 10;
const DISCUSSION_MAX_FILE_BYTES = 25 * 1024 * 1024;
const DISCUSSION_MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const DISCUSSION_POLL_INTERVAL_MS = 5_000;
const STICK_TO_BOTTOM_THRESHOLD_PX = 72;
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
  taskId?: string;
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

type ProgressFeedNote = Extract<ConversationFeedItem, { kind: "note" }>;

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
  disabled,
  onRemove,
}: {
  file: File;
  disabled?: boolean;
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
        <div className="flex h-20 items-center justify-center bg-slate-50 text-muted-foreground">
          <FileText className="h-7 w-7" />
        </div>
      )}
      <div className="px-2 py-1.5">
        <div className="flex items-center gap-1 text-[10px] font-semibold text-slate-500">
          {icon}
          <span>{label}</span>
          <span className="ml-auto tabular-nums text-muted-foreground">{formatRdFileSize(file.size)}</span>
        </div>
        <div className="mt-0.5 truncate text-[11px] font-medium text-slate-700" title={file.name}>{file.name}</div>
      </div>
      <Button variant="unstyled"
        type="button"
        onClick={onRemove}
        disabled={disabled}
        className="absolute right-1.5 top-1.5 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-slate-950/72 text-white shadow-sm transition-colors hover:bg-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        aria-label={t("移除附件")}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
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
      style={{ background: `hsl(${hue} 58% 48%)` }}
      title={name}
    >
      {name.trim().slice(0, 1) || "?"}
    </span>
  );
}

/** 讨论气泡时间：刻意只到分钟——聊天流逐条显示秒太吵。留痕请用 formatTimeWithSeconds。 */
function formatTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(i18nLocale(), { hour: "2-digit", minute: "2-digit" });
}

/** 留痕时间：精确到秒（进展留痕卡、留痕引用卡）。 */
function formatTimeWithSeconds(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(i18nLocale(), {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
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
  // 留痕卡的时间戳 → 精确到秒
  return `${day} ${formatTimeWithSeconds(iso)}`;
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
    <div className="rd-conversation-date-divider flex items-center gap-2 py-2" role="separator" aria-label={formatDayLabel(iso)}>
      <span className="h-px flex-1 bg-slate-200" />
      <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[10px] font-semibold text-slate-500 shadow-sm">
        {formatDayLabel(iso)}
      </span>
      <span className="h-px flex-1 bg-slate-200" />
    </div>
  );
}

function ProgressDateHeader({ iso }: { iso: string }) {
  const label = formatDayLabel(iso);
  return (
    <div className="flex items-center gap-2 py-1" role="separator" aria-label={label}>
      <time
        dateTime={localDayKey(iso)}
        className="shrink-0 rounded-md bg-slate-100 px-2 py-1 text-[11px] font-semibold tabular-nums text-slate-600"
      >
        {label}
      </time>
      <span className="h-px flex-1 bg-slate-200" aria-hidden="true" />
    </div>
  );
}

function formatTimelineDate(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { primary: iso.slice(0, 10), secondary: "" };
  const now = new Date();
  const dateKey = localDayKey(iso);
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const numericDate = `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return dateKey === todayKey
    ? { primary: t("今天"), secondary: numericDate }
    : { primary: numericDate, secondary: "" };
}

function discussionSummaryKey(
  type: RdDiscussionAnchorType,
  id: string,
) {
  return `${type}:${id}`;
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

function sameAttachments(
  current: RdTaskProgressAttachment[] | undefined,
  next: RdTaskProgressAttachment[] | undefined,
): boolean {
  const left = current ?? [];
  const right = next ?? [];
  return left.length === right.length && left.every((attachment, index) => {
    const candidate = right[index];
    return attachment.id === candidate.id
      && attachment.name === candidate.name
      && attachment.mime === candidate.mime
      && attachment.size === candidate.size
      && attachment.object_key === candidate.object_key
      && attachment.preview_url === candidate.preview_url
      && attachment.download_url === candidate.download_url
      && attachment.thumb_url === candidate.thumb_url;
  });
}

function sameDiscussionMessage(
  current: RdTaskDiscussionMessage,
  next: RdTaskDiscussionMessage,
): boolean {
  return current.id === next.id
    && current.author_id === next.author_id
    && current.author_name === next.author_name
    && current.author_role === next.author_role
    && current.body === next.body
    && current.reply_to_id === next.reply_to_id
    && current.created_at === next.created_at
    && current.edited_at === next.edited_at
    && current.reply_to?.id === next.reply_to?.id
    && current.reply_to?.author_name === next.reply_to?.author_name
    && current.reply_to?.body === next.reply_to?.body
    && sameAttachments(current.attachments, next.attachments)
    && current.mentions.length === next.mentions.length
    && current.mentions.every((mention, index) => (
      mention.user_id === next.mentions[index]?.user_id
      && mention.name === next.mentions[index]?.name
    ));
}

function sameThreadSummary(
  current: RdTaskDiscussionThreadSummary,
  next: RdTaskDiscussionThreadSummary,
): boolean {
  return current.thread_id === next.thread_id
    && current.anchor_type === next.anchor_type
    && current.anchor_id === next.anchor_id
    && current.message_count === next.message_count
    && current.unread_count === next.unread_count
    && current.last_message_at === next.last_message_at;
}

/**
 * Returning the existing state for an unchanged poll keeps the motion/chat
 * tree and its scroll container untouched. The comparison deliberately avoids
 * reading large data-URI attachment payloads, which could itself cause a frame
 * hitch on low-memory phones.
 */
function sameDiscussionResponse(
  current: RdTaskDiscussionResponse,
  next: RdTaskDiscussionResponse,
): boolean {
  const currentInvitation = current.invitation;
  const nextInvitation = next.invitation;
  const sameInvitation = currentInvitation === nextInvitation || Boolean(
    currentInvitation
    && nextInvitation
    && currentInvitation.invited_by_id === nextInvitation.invited_by_id
    && currentInvitation.invited_by_name === nextInvitation.invited_by_name
    && currentInvitation.invited_at === nextInvitation.invited_at,
  );
  const currentAnchor = current.anchor_preview;
  const nextAnchor = next.anchor_preview;
  const sameAnchor = currentAnchor === nextAnchor || Boolean(
    currentAnchor
    && nextAnchor
    && currentAnchor.type === nextAnchor.type
    && currentAnchor.id === nextAnchor.id
    && currentAnchor.author_id === nextAnchor.author_id
    && currentAnchor.author_name === nextAnchor.author_name
    && currentAnchor.body === nextAnchor.body
    && currentAnchor.created_at === nextAnchor.created_at
    && sameAttachments(currentAnchor.attachments, nextAnchor.attachments),
  );
  return current.can_post === next.can_post
    && current.access_scope === next.access_scope
    && current.task_title === next.task_title
    && sameInvitation
    && sameAnchor
    && current.thread.id === next.thread.id
    && current.thread.task_id === next.thread.task_id
    && current.thread.anchor_type === next.thread.anchor_type
    && current.thread.anchor_id === next.thread.anchor_id
    && current.thread.message_count === next.thread.message_count
    && current.thread.unread_count === next.thread.unread_count
    && current.messages.length === next.messages.length
    && current.messages.every((message, index) => sameDiscussionMessage(message, next.messages[index]))
    && current.thread_summaries.length === next.thread_summaries.length
    && current.thread_summaries.every((summary, index) => sameThreadSummary(summary, next.thread_summaries[index]))
    && current.page_info.has_more === next.page_info.has_more
    && current.page_info.next_cursor === next.page_info.next_cursor;
}

function sameConversationAnchor(current: ConversationAnchor, next: ConversationAnchor): boolean {
  return current.type === next.type
    && current.id === next.id
    && current.taskId === next.taskId
    && current.author === next.author
    && current.authorId === next.authorId
    && current.preview === next.preview
    && current.createdAt === next.createdAt
    && current.note === next.note
    && current.message === next.message
    && sameAttachments(current.attachments, next.attachments);
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
      <Button variant="unstyled"
        type="button"
        onClick={onClick}
        disabled={loading}
        className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 text-[10px] font-bold text-slate-600 shadow-sm transition-colors hover:border-primary/25 hover:bg-accent hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-wait disabled:opacity-60"
      >
        {loading && <Loader2 className="h-3 w-3 animate-spin" />}
        {loading ? t("正在加载…") : t("加载更早消息")}
      </Button>
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
      badge: "bg-emerald-700",
    };
  }
  if (progress >= 60) {
    return {
      border: "border-l-sky-500",
      header: "bg-sky-50/70",
      badge: "bg-sky-700",
    };
  }
  if (progress > 0) {
    return {
      border: "border-l-amber-500",
      header: "bg-amber-50/70",
      badge: "bg-amber-700",
    };
  }
  return {
    border: "border-l-[var(--primary)]",
    header: "bg-blue-50/70",
    badge: "bg-primary",
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
    <Button variant="unstyled"
      type="button"
      onClick={onClick}
      className={cn(
        "group inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs font-bold sm:min-h-8 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1",
        inverted
          ? "bg-white/12 text-primary hover:bg-white/20"
          : count > 0
            ? "bg-accent text-primary hover:bg-accent"
            : "text-slate-500 hover:bg-slate-100 hover:text-slate-700",
      )}
      aria-label={count > 0 ? t("查看 {n} 条讨论", { n: count }) : label}
    >
      <MessageCircleMore className="h-3 w-3" />
      <span>{count > 0 ? t("{n} 条讨论", { n: count }) : label}</span>
      {unread > 0 && (
        <span className="min-w-4 rounded-full bg-rose-500 px-1 text-center text-[9px] leading-4 text-white">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Button>
  );
}

// ── 进度留痕瀑布流 ───────────────────────────────────────────────────────────
// 留痕卡高度天然参差（有无正文/附件/讨论数各不相同）。CSS grid 的行高按该行最高卡对齐，
// 矮卡下方会拉出大片空白，所以改成 N 个各自纵向堆叠、互不影响高度的独立列。
// 轮转分配（第 i 条进第 i % N 列）保留原 grid 的「先左后右、逐行往下」阅读顺序；
// 输入列表已按时间倒序，因此最左上角始终是最新留痕。
function distributeIntoColumns<T>(items: T[], columnCount: number): T[][] {
  const columns: T[][] = Array.from({ length: columnCount }, () => []);
  items.forEach((item, index) => columns[index % columnCount].push(item));
  return columns;
}

/** 20rem / gap-1.5：与原 `repeat(auto-fit, minmax(min(100%,20rem),1fr))` 保持同一口径 */
const PROGRESS_COLUMN_MIN_PX = 320;
const PROGRESS_COLUMN_GAP_PX = 6;
const INLINE_COMMENT_PREVIEW_COUNT = 3;
const INLINE_COMMENT_DEPTH_CLASSES = ["", "ml-4", "ml-8", "ml-12", "ml-16"] as const;

type InlineCommentNode = {
  message: RdTaskDiscussionMessage;
  children: InlineCommentNode[];
};

type FlatInlineComment = {
  message: RdTaskDiscussionMessage;
  depth: number;
};

/** 把 reply_to_id 还原为任意深度的树；缺失父节点的分页数据按根留言降级展示。 */
function buildInlineCommentForest(messages: RdTaskDiscussionMessage[]): InlineCommentNode[] {
  const nodes = new Map<string, InlineCommentNode>();
  for (const message of messages) nodes.set(message.id, { message, children: [] });
  const roots: InlineCommentNode[] = [];
  for (const message of messages) {
    const node = nodes.get(message.id);
    if (!node) continue;
    const parent = message.reply_to_id ? nodes.get(message.reply_to_id) : undefined;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/** 递归遍历不限制深度；仅把视觉缩进封顶，避免极深回复在窄卡片中挤成一列字。 */
function flattenInlineCommentNodes(
  nodes: InlineCommentNode[],
  depth = 0,
  visited = new Set<string>(),
): FlatInlineComment[] {
  const flattened: FlatInlineComment[] = [];
  for (const node of nodes) {
    if (visited.has(node.message.id)) continue;
    visited.add(node.message.id);
    flattened.push({ message: node.message, depth });
    flattened.push(...flattenInlineCommentNodes(node.children, depth + 1, visited));
  }
  return flattened;
}

/**
 * 列数跟随「容器」宽度而非视口：本组件会被放进任务详情页主列、驾驶舱抽屉、移动端全屏，
 * 同一视口下可用宽度差别很大，用媒体查询断点必然算错（抽屉里会误判成 3 列）。
 */
function useProgressColumns(element: HTMLElement | null): number {
  const [columns, setColumns] = useState(1);
  // useLayoutEffect：首帧就量好列数，否则会看到「先 1 列、再跳到 3 列」的闪动
  React.useLayoutEffect(() => {
    if (!element) return undefined;
    const update = () => {
      const width = element.clientWidth;
      if (!width) return;
      setColumns(Math.max(1, Math.floor(
        (width + PROGRESS_COLUMN_GAP_PX) / (PROGRESS_COLUMN_MIN_PX + PROGRESS_COLUMN_GAP_PX),
      )));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return columns;
}

function InlineCommentItem({
  item,
  currentUserId,
  currentUserName,
  onReply,
}: {
  item: FlatInlineComment;
  currentUserId?: string | null;
  currentUserName?: string | null;
  onReply: (message: RdTaskDiscussionMessage) => void;
}) {
  const { message, depth } = item;
  const mine = Boolean(
    (currentUserId && message.author_id === currentUserId)
    || (currentUserName && message.author_name === currentUserName),
  );
  const depthClass = INLINE_COMMENT_DEPTH_CLASSES[Math.min(depth, INLINE_COMMENT_DEPTH_CLASSES.length - 1)];
  return (
    <li
      role="treeitem"
      aria-level={depth + 1}
      className={cn(
        "relative flex min-w-0 gap-2 rounded-lg px-2 py-1.5 transition-colors",
        depthClass,
        mine ? "bg-blue-50/70" : "hover:bg-white",
      )}
    >
      {depth > 0 ? <span className="absolute -left-2 top-0 h-full w-px bg-blue-100" aria-hidden="true" /> : null}
      <ConversationAvatar name={message.author_name} userId={message.author_id} size="xs" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-1 text-[11px] leading-4">
          <span className="font-bold text-slate-800">{message.author_name}</span>
          {message.reply_to ? (
            <>
              <span className="text-muted-foreground">{t("回复")}</span>
              <span className="font-semibold text-primary">{message.reply_to.author_name}</span>
            </>
          ) : null}
          {mine ? <span className="rounded bg-blue-100 px-1 text-[9px] font-semibold text-primary">{t("我")}</span> : null}
        </div>
        {message.body ? (
          <p className="mt-0.5 whitespace-pre-wrap break-words text-pretty text-xs leading-[18px] text-slate-700">
            {renderTextWithMentions(message.body, message.mentions)}
          </p>
        ) : null}
        <ProgressAttachmentGrid
          attachments={message.attachments}
          compact
          imageDisplay="thumbnails"
          maxVisibleImages={3}
          className="mt-1.5"
        />
        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
          <time className="tabular-nums">{formatCompactDateTime(message.created_at)}</time>
          <Button variant="unstyled"
            type="button"
            onClick={() => onReply(message)}
            className="cursor-pointer rounded px-1 py-0.5 font-semibold text-slate-500 transition-colors hover:bg-accent hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
          >
            {t("回复")}
          </Button>
        </div>
      </div>
    </li>
  );
}

function InlineNoteComments({
  id,
  taskId,
  noteId,
  candidates,
  variant,
}: {
  id: string;
  taskId: string;
  noteId: string;
  candidates: MentionCandidate[];
  variant: "desktop" | "mobile";
}) {
  const { user } = useAuth();
  const [discussion, setDiscussion] = useState<RdTaskDiscussionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [replyTarget, setReplyTarget] = useState<RdTaskDiscussionMessage | null>(null);

  const loadComments = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetchRdTaskDiscussion(taskId, { type: "progress_note", id: noteId }, { limit: 200 });
      setDiscussion(response);
      if (response.thread.message_count > 0) {
        void markRdTaskDiscussionRead(taskId, response.thread.id)
          .then(() => announceDiscussionUpdated(taskId))
          .catch(() => {});
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("留言加载失败"));
    } finally {
      setLoading(false);
    }
  }, [noteId, taskId]);

  useEffect(() => {
    void loadComments();
  }, [loadComments]);

  const comments = useMemo(
    () => flattenInlineCommentNodes(buildInlineCommentForest(discussion?.messages ?? [])),
    [discussion?.messages],
  );
  const visibleComments = expanded ? comments : comments.slice(0, INLINE_COMMENT_PREVIEW_COUNT);
  const totalCount = Math.max(comments.length, discussion?.thread.message_count ?? 0);
  const hiddenCount = Math.max(0, totalCount - INLINE_COMMENT_PREVIEW_COUNT);

  const loadEarlier = async () => {
    const cursor = discussion?.page_info.next_cursor;
    if (!cursor || loadingEarlier) return;
    setLoadingEarlier(true);
    try {
      const page = await fetchRdTaskDiscussion(
        taskId,
        { type: "progress_note", id: noteId },
        { cursor, limit: 200 },
      );
      setDiscussion((current) => current ? {
        ...current,
        messages: mergeDiscussionMessages(page.messages, current.messages),
        page_info: page.page_info,
      } : page);
    } catch (loadError) {
      toast.error(loadError instanceof Error ? loadError.message : t("留言加载失败"));
    } finally {
      setLoadingEarlier(false);
    }
  };

  const appendInlineMessage = (message: RdTaskDiscussionMessage) => {
    setDiscussion((current) => current ? {
      ...current,
      thread: {
        ...current.thread,
        message_count: current.thread.message_count + 1,
        unread_count: 0,
      },
      messages: mergeDiscussionMessages(current.messages, [message]),
    } : current);
    setExpanded(true);
    setReplyTarget(null);
  };

  return (
    <section id={id} aria-label={t("留痕留言")} className="rd-inline-note-comments mt-1.5 border-t border-slate-200 pt-2">
      {loading ? (
        <div className="space-y-2 py-1" aria-label={t("正在加载留言")}>
          {[0, 1].map((item) => (
            <div key={item} className="flex animate-pulse items-center gap-2 rounded-lg bg-white/80 px-2 py-2">
              <span className="size-5 rounded-full bg-slate-200" />
              <span className="h-2.5 flex-1 rounded bg-slate-200" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div role="alert" className="flex items-center justify-between gap-2 rounded-lg border border-rose-100 bg-rose-50 px-2.5 py-2 text-xs text-rose-700">
          <span className="min-w-0 truncate">{error}</span>
          <Button variant="unstyled"
            type="button"
            onClick={() => void loadComments()}
            className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded px-1.5 py-1 font-semibold hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
          >
            <RefreshCw className="size-3" />
            {t("重试")}
          </Button>
        </div>
      ) : (
        <>
          {comments.length > 0 ? (
            <ol role="tree" className="space-y-0.5">
              {visibleComments.map((item) => (
                <InlineCommentItem
                  key={item.message.id}
                  item={item}
                  currentUserId={user?.id}
                  currentUserName={user?.name}
                  onReply={setReplyTarget}
                />
              ))}
            </ol>
          ) : (
            <p className="px-2 py-1.5 text-xs text-slate-500">{t("还没有留言，来写第一条吧")}</p>
          )}

          <div className="mt-1 flex flex-wrap items-center gap-1">
            {hiddenCount > 0 ? (
              <Button variant="unstyled"
                type="button"
                aria-expanded={expanded}
                onClick={() => setExpanded((current) => !current)}
                className="inline-flex min-h-7 cursor-pointer items-center gap-1 rounded-md px-2 text-[10px] font-semibold text-primary transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
              >
                <ChevronDown className={cn("size-3 transition-transform", expanded && "rotate-180")} />
                {expanded ? t("收起留言") : t("展开其余 {n} 条留言", { n: hiddenCount })}
              </Button>
            ) : null}
            {expanded && discussion?.page_info.has_more ? (
              <Button variant="unstyled"
                type="button"
                onClick={() => void loadEarlier()}
                disabled={loadingEarlier}
                className="inline-flex min-h-7 cursor-pointer items-center gap-1 rounded-md px-2 text-[10px] font-semibold text-slate-600 transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 disabled:cursor-wait disabled:opacity-60"
              >
                {loadingEarlier ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
                {t("加载更早留言")}
              </Button>
            ) : null}
          </div>

          {discussion?.can_post ? (
            <Composer
              taskId={taskId}
              anchor={{ type: "progress_note", id: noteId }}
              candidates={candidates}
              variant={variant}
              presentation="inline"
              placeholder={replyTarget ? `${t("回复 {name}", { name: replyTarget.author_name })}…` : t("写下留言…")}
              contextHint={t("支持 @ 成员、附件和逐层回复")}
              replyTarget={replyTarget}
              onClearReply={() => setReplyTarget(null)}
              onSent={appendInlineMessage}
            />
          ) : (
            <div className="mt-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-500">
              {t("当前账号可查看留言，但没有发送权限。")}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function ProgressAnchorCard({
  note,
  summary,
  onOpenThread,
  onOpenSourceTask,
  selectedActor,
  onActorClick,
  candidates,
  variant,
  presentation = "card",
}: {
  note: RdTaskProgressNote;
  summary?: RdTaskDiscussionThreadSummary;
  onOpenThread: () => void;
  onOpenSourceTask?: (taskId: string) => void;
  selectedActor?: AuditActorIdentity | null;
  onActorClick?: (actor: AuditActorIdentity) => void;
  candidates: MentionCandidate[];
  variant: "desktop" | "mobile";
  presentation?: "card" | "timeline";
}) {
  const tone = progressTone(note.progress);
  const sourceTask = note.source_task;
  const [commentsOpen, setCommentsOpen] = useState(false);
  const commentsRegionId = React.useId();
  const commentCount = summary?.message_count ?? 0;
  const actorSelected = Boolean(selectedActor && (
    auditActorMatchesIdentity(note.actor, selectedActor)
    || auditActorMatchesIdentity(selectedActor, note.actor)
  ));
  const timeline = presentation === "timeline";
  return (
    <article className={cn(
      "rd-progress-anchor-card overflow-hidden border border-slate-200 border-l-[3px] bg-white",
      timeline
        ? "rounded-xl shadow-[0_5px_18px_rgba(15,23,42,0.055)]"
        : "rounded-lg shadow-[0_3px_12px_rgba(15,23,42,0.05)]",
      tone.border,
    )}>
      <div className={cn(
        "rd-progress-anchor-card__header flex items-center border-b border-slate-200/80",
        timeline ? "min-h-10 gap-2 px-3 py-1.5" : "min-h-8 gap-1.5 px-2 py-1",
        tone.header,
      )}>
        <span className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-primary">
          <Sparkles className="h-3 w-3" />
          {t(timeline ? "进度更新" : "留痕")}
        </span>
        <span className="h-3.5 w-px shrink-0 bg-slate-300/80" aria-hidden="true" />
        {onActorClick ? (
          <Button variant="unstyled"
            type="button"
            aria-pressed={actorSelected}
            onClick={() => onActorClick({ id: note.actor.id, name: note.actor.name })}
            title={t(actorSelected ? "再次点击恢复全部人员" : "只看此人的留痕与操作记录")}
            className={cn(
              "inline-flex min-w-0 shrink cursor-pointer items-center gap-1 rounded-md px-1 py-0.5 text-xs transition-colors hover:bg-accent/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35",
              actorSelected && "bg-accent text-primary ring-1 ring-inset ring-primary/25",
            )}
          >
            <ConversationAvatar name={note.actor.name} userId={note.actor.id} size="xs" />
            <span className="truncate font-bold text-slate-800">{note.actor.name}</span>
          </Button>
        ) : (
          <span className="inline-flex min-w-0 shrink items-center gap-1 text-xs">
            <ConversationAvatar name={note.actor.name} userId={note.actor.id} size="xs" />
            <span className="truncate font-bold text-slate-800">{note.actor.name}</span>
          </span>
        )}
        <div className="min-w-0 flex-1 truncate text-xs text-slate-500">
          <span>{note.actor.role ? t(note.actor.role) : t("研发成员")}</span>
        </div>
        {typeof note.progress === "number" && (
          <span className={cn("rd-progress-anchor-card__progress shrink-0 rounded px-1.5 py-0.5 text-xs font-bold leading-none text-white", tone.badge)}>
            {note.progress}%
          </span>
        )}
        <time className="shrink-0 font-mono text-xs tabular-nums text-slate-500">{formatTimeWithSeconds(note.created_at)}</time>
      </div>
      <div className={cn("rd-progress-anchor-card__body", timeline ? "px-4 py-3" : "px-2.5 py-1.5")}>
        {sourceTask && (
          <div className="mb-1.5 flex min-w-0 items-center gap-1.5">
            <Button variant="unstyled"
              type="button"
              onClick={() => onOpenSourceTask?.(sourceTask.task_id)}
              disabled={!onOpenSourceTask}
              title={sourceTask.path.join(" / ")}
              className="inline-flex min-w-0 max-w-full cursor-pointer items-center gap-1 rounded-md bg-accent px-1.5 py-1 text-xs font-semibold text-primary transition-colors hover:bg-accent disabled:cursor-default"
            >
              <GitBranch className="h-3 w-3 shrink-0" />
              <span className="truncate">{sourceTask.title}</span>
            </Button>
            {sourceTask.is_before_merge && (
              <span className="shrink-0 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-xs font-semibold text-amber-700">
                {t("合并前")}
              </span>
            )}
          </div>
        )}
        {note.text && (
          <p className="whitespace-pre-wrap break-words text-pretty text-sm leading-6 text-slate-800">
            {renderTextWithMentions(note.text, note.mentions)}
          </p>
        )}
        <ProgressAttachmentGrid
          attachments={note.attachments}
          compact
          imageDisplay="clipped-cards"
          className={note.text ? "mt-1.5" : undefined}
        />
        <div className="mt-1.5 flex items-center gap-1 border-t border-slate-100 pt-1">
          <ThreadButton summary={summary} onClick={onOpenThread} label={t("讨论")} />
          <Button variant="unstyled"
            type="button"
            aria-expanded={commentsOpen}
            aria-controls={commentsRegionId}
            onClick={() => setCommentsOpen((current) => !current)}
            className={cn(
              "inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs font-bold sm:min-h-8 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1",
              commentsOpen || commentCount > 0
                ? "bg-accent text-primary hover:bg-accent"
                : "text-slate-500 hover:bg-slate-100 hover:text-slate-700",
            )}
          >
            <MessageCircleReply className="size-3" />
            <span>{t("留言")}{commentCount > 0 ? ` ${commentCount}` : ""}</span>
            <ChevronDown className={cn("size-3 transition-transform", commentsOpen && "rotate-180")} />
          </Button>
        </div>
        {commentsOpen ? (
          <InlineNoteComments
            id={commentsRegionId}
            taskId={note.source_task?.task_id ?? note.task_id}
            noteId={note.id}
            candidates={candidates}
            variant={variant}
          />
        ) : null}
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
    <div
      data-message-id={message.id}
      data-mine={mine ? "true" : "false"}
      className={cn(
        "rd-message-bubble flex items-end gap-1.5",
        mine ? "justify-end" : "justify-start",
        compactTop ? "mt-0.5" : "mt-2",
      )}
    >
      {!mine && <ConversationAvatar name={message.author_name} userId={message.author_id} hidden={compactTop} />}
      <div className={cn("min-w-0 max-w-[78%]", mine ? "items-end" : "items-start")}>
        {!mine && !compactTop && (
          <div className="mb-0.5 px-1 text-[10px] font-semibold text-slate-600">
            {message.author_name}
            {message.author_role && <span className="ml-1 font-normal text-muted-foreground">· {t(message.author_role)}</span>}
          </div>
        )}
        <div
          className={cn(
            "rd-message-bubble__surface relative overflow-hidden px-3 py-2 shadow-sm transition-[box-shadow,background-color]",
            mine
              ? "rounded-[20px] rounded-br-[7px] bg-primary text-white shadow-[0_8px_18px_rgba(var(--primary-rgb),0.16)]"
              : "rounded-[20px] rounded-bl-[7px] border border-slate-200 bg-white text-slate-800",
            highlighted && (mine
              ? "ring-2 ring-primary/30 ring-offset-2"
              : "border-blue-300 bg-blue-50 ring-2 ring-blue-200 ring-offset-2"),
          )}
        >
          {message.reply_to && (
            <div
              className={cn(
                "mb-1.5 rounded-lg border-l-2 px-2 py-1 text-[11px]",
                mine ? "border-white/70 bg-white/12 text-blue-50" : "border-primary/55 bg-slate-50 text-slate-500",
              )}
            >
              <div className={cn("font-semibold", mine ? "text-white" : "text-slate-700")}>{message.reply_to.author_name}</div>
              <div className="mt-0.5 line-clamp-2 whitespace-pre-wrap">{message.reply_to.body || t("附件消息")}</div>
            </div>
          )}
          {message.body && (
            <p className="whitespace-pre-wrap break-words text-pretty text-sm leading-5">
              {renderTextWithMentions(
                message.body,
                message.mentions,
                mine
                  ? "rounded bg-white/20 px-1 font-semibold text-white"
                  : "rounded bg-blue-50 px-1 font-semibold text-primary",
              )}
            </p>
          )}
          <ProgressAttachmentGrid attachments={message.attachments} compact imageDisplay="clipped-cards" className="mt-2" />
          <div className={cn("mt-1 flex items-center justify-end gap-1 text-[10px] tabular-nums", mine ? "text-blue-100" : "text-muted-foreground")}>
            <span>{formatTime(message.created_at)}</span>
            {message.edited_at && <span>· {t("已编辑")}</span>}
          </div>
        </div>
        <div className={cn("flex items-center gap-1", mine && "justify-end")}>
          {insideThread && onQuote ? (
            <Button variant="unstyled"
              type="button"
              onClick={onQuote}
              className="mt-1 cursor-pointer rounded-full px-2 py-1 text-[11px] font-semibold text-slate-500 transition-colors hover:bg-slate-100 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {t("引用回复")}
            </Button>
          ) : onOpenThread ? (
            <ThreadButton summary={threadSummary} onClick={onOpenThread} inverted={mine} />
          ) : null}
        </div>
      </div>
      {mine && <ConversationAvatar name={message.author_name} userId={message.author_id} hidden={compactTop} />}
    </div>
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
  presentation = "panel",
}: {
  taskId: string;
  anchor: { type: RdDiscussionAnchorType; id?: string | null };
  candidates: MentionCandidate[];
  variant: "desktop" | "mobile";
  placeholder: string;
  contextHint: string;
  replyTarget?: RdTaskDiscussionMessage | null;
  onClearReply?: () => void;
  onSent: (message: RdTaskDiscussionMessage, threadId: string) => void;
  presentation?: "panel" | "inline";
}) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mountedRef = useRef(true);
  const sendRequestRef = useRef(0);
  const composerIdentity = `${taskId}:${anchor.type}:${anchor.id ?? ""}`;
  const composerIdentityRef = useRef(composerIdentity);
  composerIdentityRef.current = composerIdentity;
  const mention = useMentions({ value: text, setValue: setText, inputRef, candidates });

  useEffect(() => () => {
    mountedRef.current = false;
    sendRequestRef.current += 1;
  }, []);

  const addFiles = useCallback((picked: File[]) => {
    if (picked.length === 0 || sending) return;
    const blocked = picked.find(blockedAttachment);
    if (blocked) {
      const message = t("附件 {name} 属于高风险可执行文件，不能上传", { name: blocked.name });
      setSubmitError(message);
      toast.error(message);
      return;
    }
    const oversized = picked.find((file) => file.size > DISCUSSION_MAX_FILE_BYTES);
    if (oversized) {
      const message = t("附件 {name} 超过单文件 25MB 限制", { name: oversized.name });
      setSubmitError(message);
      toast.error(message);
      return;
    }
    const next = [...files, ...picked];
    if (next.length > DISCUSSION_MAX_FILES) {
      const message = t("每条消息最多上传 {n} 个附件", { n: DISCUSSION_MAX_FILES });
      setSubmitError(message);
      toast.error(message);
      return;
    }
    const totalBytes = next.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > DISCUSSION_MAX_TOTAL_BYTES) {
      const message = t("单条消息附件总大小不能超过 50MB");
      setSubmitError(message);
      toast.error(message);
      return;
    }
    setSubmitError("");
    setFiles(next);
  }, [files, sending]);

  const submit = async () => {
    if ((!text.trim() && files.length === 0) || sending) return;
    const requestId = ++sendRequestRef.current;
    const expectedIdentity = composerIdentity;
    setSubmitError("");
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
      if (!mountedRef.current || requestId !== sendRequestRef.current || composerIdentityRef.current !== expectedIdentity) return;
      setText("");
      setFiles([]);
      mention.resetMentions();
      onClearReply?.();
      onSent(result.message, result.thread_id);
      announceDiscussionUpdated(taskId);
    } catch (error) {
      if (!mountedRef.current || requestId !== sendRequestRef.current || composerIdentityRef.current !== expectedIdentity) return;
      const message = error instanceof Error ? error.message : t("发送失败，请重试");
      setSubmitError(message);
      toast.error(message);
    } finally {
      if (mountedRef.current && requestId === sendRequestRef.current && composerIdentityRef.current === expectedIdentity) {
        setSending(false);
      }
    }
  };

  return (
    <div
      className={cn(
        "rd-conversation-composer @container relative shrink-0 bg-white",
        presentation === "inline"
          ? "mt-2"
          : "border-t border-slate-200 px-3 py-2",
        variant === "mobile" && presentation === "panel" && "[padding-bottom:calc(0.5rem+env(safe-area-inset-bottom))]",
      )}
      onDragEnter={(event) => {
        if (sending || variant !== "desktop" || !event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setDraggingFiles(true);
      }}
      onDragOver={(event) => {
        if (sending || variant !== "desktop" || !event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setDraggingFiles(false);
      }}
      onDrop={(event) => {
        if (sending || variant !== "desktop") return;
        event.preventDefault();
        setDraggingFiles(false);
        addFiles(Array.from(event.dataTransfer.files ?? []));
      }}
    >
      {draggingFiles && (
          <div className="absolute inset-2 z-20 flex items-center justify-center rounded-2xl border-2 border-dashed border-blue-300 bg-blue-50/95 text-primary shadow-lg">
            <span className="inline-flex items-center gap-2 text-sm font-bold">
              <UploadCloud className="h-5 w-5" />
              {t("松开即可添加到本条消息")}
            </span>
          </div>
      )}
      <MentionSuggestionPanel
        open={mention.open}
        candidates={mention.filtered}
        highlightIndex={mention.highlightIndex}
        onPick={mention.pick}
        variant={variant}
      />
      {replyTarget && (
          <div className="mb-1.5 flex items-center gap-2 rounded-xl border border-blue-100 bg-blue-50/70 px-3 py-1.5">
            <MessageCircleReply className="h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-bold text-primary">{t("回复 {name}", { name: replyTarget.author_name })}</div>
              <div className="truncate text-xs text-slate-600">{replyTarget.body || t("附件消息")}</div>
            </div>
            <Button variant="unstyled"
              type="button"
              onClick={onClearReply}
              className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white hover:text-slate-700"
              aria-label={t("取消引用")}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
      )}
      {files.length > 0 && (
        <div className="mb-1.5 flex gap-2 overflow-x-auto pb-1" aria-label={t("待发送附件")}>
          {files.map((file, index) => (
            <PendingAttachment
              key={`${file.name}-${file.lastModified}-${index}`}
              file={file}
              disabled={sending}
              onRemove={() => setFiles((current) => current.filter((_, i) => i !== index))}
            />
          ))}
        </div>
      )}
      <div className="rd-conversation-composer__field flex items-end gap-2 rounded-xl border border-slate-200 bg-slate-50 p-1.5 transition-colors">
        <label
          className={cn(
            "rd-conversation-composer__attachment relative flex shrink-0 cursor-pointer items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-white hover:text-primary",
            variant === "mobile" ? "size-11" : "size-9",
          )}
          title={t("添加附件")}
        >
          <Paperclip className="h-4 w-4" />
          <Input
            type="file"
            multiple
            disabled={sending}
            aria-label={t("选择讨论附件")}
            className="sr-only"
            onChange={(event) => {
              addFiles(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
        </label>
        <Textarea
          ref={inputRef}
          value={text}
          rows={1}
          maxLength={4000}
          aria-label={t("输入协作消息")}
          placeholder={placeholder}
          disabled={sending}
          onChange={(event) => {
            setText(event.target.value);
            if (submitError) setSubmitError("");
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
          className={cn(
            "max-h-28 min-w-0 flex-1 resize-none border-0 bg-transparent px-1 py-2 leading-5 text-slate-800 shadow-none outline-none focus-visible:ring-0 placeholder:text-muted-foreground",
            variant === "mobile" ? "min-h-11 text-base" : "min-h-9 text-sm",
          )}
        />
        <Button variant="unstyled"
          type="button"
          onClick={() => void submit()}
          disabled={(!text.trim() && files.length === 0) || sending}
          className={cn(
            "rd-conversation-composer__send flex shrink-0 cursor-pointer items-center justify-center rounded-full bg-primary text-white shadow-[0_6px_16px_rgba(var(--primary-rgb),0.24)] transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none",
            variant === "mobile" ? "size-11" : "size-9",
          )}
          aria-label={sending ? t("正在发送消息") : t("发送消息")}
          aria-busy={sending}
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
      {submitError ? (
        <p className="mx-2 mt-1.5 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-pretty text-[11px] text-rose-700" role="alert">
          {submitError}
        </p>
      ) : null}
      <div className="mt-1 flex items-center justify-between gap-3 px-2 text-xs text-slate-500">
        <span>
          {contextHint}
          {variant === "mobile" ? t(" · 可上传图片、视频或文件") : ""}
        </span>
        <span className="hidden shrink-0 tabular-nums @[480px]:inline">
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
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setExpanded(false);
  }, [anchor.id, anchor.type]);

  return (
    <div className="border-b border-slate-200 bg-slate-50/80 px-3 py-2">
      <div className="flex items-center gap-2 text-[10px] font-bold text-primary">
        {anchor.type === "progress_note" ? <Sparkles className="h-3.5 w-3.5" /> : <MessageCircleMore className="h-3.5 w-3.5" />}
        {anchor.type === "progress_note" ? t("原始进度记录") : t("原始任务消息")}
      </div>
      <div className="mt-1.5 rounded-lg border border-slate-200 border-l-2 border-l-[var(--primary)]/55 bg-white px-2.5 py-2 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-1.5">
            <ConversationAvatar name={anchor.author} userId={authorId} size="xs" />
            <div className="truncate text-[11px] font-semibold text-slate-700">{anchor.author}</div>
          </div>
          <div className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
            {/* 留痕引用卡：精确到秒 */}
            {new Date(anchor.createdAt).toLocaleString(i18nLocale(), {
              month: "numeric",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              hour12: false,
            })}
          </div>
        </div>
        <div className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs leading-4 text-slate-600">
          {anchor.preview || t("附件消息")}
        </div>
        {attachments.length > 0 && !compact && (
          <ProgressAttachmentGrid attachments={attachments} compact imageDisplay="clipped-cards" className="mt-1.5" />
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
    <div className={cn("rd-thread-invitation border-b border-blue-100 bg-blue-50/70", compact ? "px-2.5 py-2" : "px-3 py-2.5")}>
      <div className="rd-thread-invitation__content rounded-lg border border-blue-200 bg-white/90 px-2.5 py-2 shadow-[0_2px_8px_rgba(var(--primary-rgb),0.06)]">
        <div className="flex items-center gap-1.5 text-xs font-bold text-primary">
          <Sparkles className="h-3.5 w-3.5" />
          <span>{t("{name} 邀请你参与这条讨论", { name: inviterName || t("任务成员") })}</span>
          <span className="ml-auto shrink-0 rounded-full bg-primary px-2 py-0.5 text-[9px] text-white">{t("受邀参与")}</span>
        </div>
        <p className="mt-1 text-[10px] leading-4 text-slate-600">
          {t("你可以查看原始留痕并在本线程回复，不会加入整个任务。")}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1">
          <span className="inline-flex items-center gap-1 rounded-md border border-blue-100 bg-blue-50 px-1.5 py-1 text-[9px] font-semibold text-primary">
            <Eye className="h-3 w-3" />
            {t("可查看本线程")}
          </span>
          <span className="inline-flex items-center gap-1 rounded-md border border-blue-100 bg-blue-50 px-1.5 py-1 text-[9px] font-semibold text-primary">
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
  showHeader = true,
  threadLayout = "responsive",
  progressPresentation = "cards",
  focusAnchor,
  focusMessageId,
  className,
  onActivity,
  onMessageSent,
  onCloseFocus,
  onUnreadChange,
  onThreadOpenChange,
  onOpenSourceTask,
  selectedActor,
  onActorClick,
}: {
  taskId: string;
  taskTitle: string;
  notes: RdTaskProgressNote[];
  mode?: "task" | "progress";
  variant?: "desktop" | "mobile";
  notesLoading?: boolean;
  notesError?: string | null;
  onRetryNotes?: () => void;
  showHeader?: boolean;
  threadLayout?: "responsive" | "replace";
  progressPresentation?: "cards" | "timeline";
  focusAnchor?: RdFocusedDiscussionAnchor;
  focusMessageId?: string | null;
  className?: string;
  onActivity?: () => void;
  onMessageSent?: (message: RdTaskDiscussionMessage) => void;
  onCloseFocus?: () => void;
  onUnreadChange?: (count: number) => void;
  onThreadOpenChange?: (open: boolean) => void;
  onOpenSourceTask?: (taskId: string) => void;
  selectedActor?: AuditActorIdentity | null;
  onActorClick?: (actor: AuditActorIdentity) => void;
}) {
  useI18n();
  const { user } = useAuth();
  const reduceMotion = useReducedMotion();
  const workspaceKey = isUsCollabWorkspace() ? "us-collab" : "rd";
  const [main, setMain] = useState<RdTaskDiscussionResponse | null>(null);
  const [mainLoading, setMainLoading] = useState(true);
  const [mainError, setMainError] = useState("");
  const [activeAnchor, setActiveAnchor] = useState<ConversationAnchor | null>(null);
  const [thread, setThread] = useState<RdTaskDiscussionResponse | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState("");
  const [mainEarlierLoading, setMainEarlierLoading] = useState(false);
  const [threadEarlierLoading, setThreadEarlierLoading] = useState(false);
  const [replyTarget, setReplyTarget] = useState<RdTaskDiscussionMessage | null>(null);
  const [people, setPeople] = useState<MentionCandidate[]>([]);
  const mainScrollRef = useRef<HTMLDivElement>(null);
  const mainContentRef = useRef<HTMLElement>(null);
  const threadScrollRef = useRef<HTMLDivElement>(null);
  const preserveMainScrollRef = useRef(false);
  const preserveThreadScrollRef = useRef(false);
  const mainStickToBottomRef = useRef(true);
  const threadStickToBottomRef = useRef(true);
  const mainInitialScrollRef = useRef(true);
  const threadInitialScrollRef = useRef(true);
  const focusOpenedRef = useRef("");
  const threadPanelRef = useRef<HTMLElement>(null);
  const threadBackButtonRef = useRef<HTMLButtonElement>(null);
  const threadReturnFocusRef = useRef<HTMLElement | null>(null);
  const onActivityRef = useRef(onActivity);
  const mainLoadSeqRef = useRef(0);
  const threadLoadSeqRef = useRef(0);
  const mainPageSeqRef = useRef(0);
  const threadPageSeqRef = useRef(0);
  const activeTaskIdRef = useRef(taskId);
  const activeWorkspaceKeyRef = useRef(workspaceKey);
  const activeAnchorRef = useRef<ConversationAnchor | null>(activeAnchor);
  activeTaskIdRef.current = taskId;
  activeWorkspaceKeyRef.current = workspaceKey;
  activeAnchorRef.current = activeAnchor;

  const anchorIdentity = useCallback((anchor: ConversationAnchor | null) => (
    anchor ? `${workspaceKey}:${anchor.taskId ?? taskId}:${anchor.type}:${anchor.id ?? ""}` : ""
  ), [taskId, workspaceKey]);

  useEffect(() => {
    onActivityRef.current = onActivity;
  }, [onActivity]);

  const conversationRef = useRef<HTMLDivElement>(null);
  const [responsiveThreadOverlay, setResponsiveThreadOverlay] = useState(true);
  React.useLayoutEffect(() => {
    const element = conversationRef.current;
    if (!element) return;
    // 双栏至少各留 420px；工作台抽屉的宽度不能用浏览器断点推断。
    const update = () => setResponsiveThreadOverlay(element.clientWidth < 840);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const threadIsOverlay = variant === "mobile"
    || threadLayout === "replace"
    || (variant === "desktop" && threadLayout === "responsive" && responsiveThreadOverlay);

  const updateStickToBottom = useCallback((scroller: HTMLDivElement, target: { current: boolean }) => {
    const distanceFromBottom = scroller.scrollHeight - scroller.clientHeight - Math.max(0, scroller.scrollTop);
    target.current = distanceFromBottom <= STICK_TO_BOTTOM_THRESHOLD_PX;
  }, []);

  useEffect(() => {
    mainStickToBottomRef.current = true;
    mainInitialScrollRef.current = true;
  }, [mode, taskId]);

  useEffect(() => {
    mainLoadSeqRef.current += 1;
    threadLoadSeqRef.current += 1;
    mainPageSeqRef.current += 1;
    threadPageSeqRef.current += 1;
    activeAnchorRef.current = null;
    setMain(null);
    setMainLoading(true);
    setMainError("");
    setMainEarlierLoading(false);
    setActiveAnchor(null);
    setThread(null);
    setThreadLoading(false);
    setThreadError("");
    setThreadEarlierLoading(false);
    setReplyTarget(null);
    focusOpenedRef.current = "";
    onUnreadChange?.(0);
  }, [mode, onUnreadChange, taskId, workspaceKey]);

  useEffect(() => {
    onThreadOpenChange?.(Boolean(activeAnchor));
    return () => onThreadOpenChange?.(false);
  }, [activeAnchor, onThreadOpenChange]);

  const skipMainDiscussion = Boolean(focusAnchor && focusAnchor.type !== "task");

  const loadMain = useCallback(async (showLoading = true) => {
    const expectedTaskId = taskId;
    const expectedWorkspaceKey = workspaceKey;
    const seq = ++mainLoadSeqRef.current;
    if (skipMainDiscussion) {
      setMainError("");
      setMainLoading(false);
      return;
    }
    if (showLoading) {
      setMainLoading(true);
      setMainError("");
    }
    try {
      const response = await fetchRdTaskDiscussion(taskId, { type: "task" });
      if (seq !== mainLoadSeqRef.current || activeTaskIdRef.current !== expectedTaskId || activeWorkspaceKeyRef.current !== expectedWorkspaceKey) return;
      setMainError("");
      const normalized = {
        ...response,
        thread: {
          ...response.thread,
          unread_count: mode === "task" ? 0 : response.thread.unread_count,
        },
      };
      setMain((current) => {
        if (showLoading || !current) return normalized;
        const next = {
          ...normalized,
          messages: mergeDiscussionMessages(current.messages, normalized.messages),
          page_info: current.page_info,
        };
        return sameDiscussionResponse(current, next) ? current : next;
      });
      if (mode === "task" && response.thread.unread_count > 0) {
        void markRdTaskDiscussionRead(taskId, response.thread.id)
          .then(() => announceDiscussionUpdated(taskId))
          .catch(() => {});
        onActivityRef.current?.();
      }
    } catch (error) {
      if (seq !== mainLoadSeqRef.current || activeTaskIdRef.current !== expectedTaskId || activeWorkspaceKeyRef.current !== expectedWorkspaceKey) return;
      const message = error instanceof Error ? error.message : t("协作对话加载失败");
      if (showLoading) setMainError(message);
      if (showLoading) toast.error(message);
    } finally {
      if (showLoading && seq === mainLoadSeqRef.current && activeTaskIdRef.current === expectedTaskId && activeWorkspaceKeyRef.current === expectedWorkspaceKey) setMainLoading(false);
    }
  }, [mode, skipMainDiscussion, taskId, workspaceKey]);

  const loadEarlierMain = useCallback(async () => {
    const cursor = main?.page_info.next_cursor;
    if (!cursor || mainEarlierLoading) return;
    const expectedTaskId = taskId;
    const expectedWorkspaceKey = workspaceKey;
    const pageSeq = ++mainPageSeqRef.current;
    setMainEarlierLoading(true);
    const scroller = mainScrollRef.current;
    const previousHeight = scroller?.scrollHeight ?? 0;
    const previousTop = scroller?.scrollTop ?? 0;
    try {
      const response = await fetchRdTaskDiscussion(taskId, { type: "task" }, { cursor });
      if (pageSeq !== mainPageSeqRef.current || activeTaskIdRef.current !== expectedTaskId || activeWorkspaceKeyRef.current !== expectedWorkspaceKey) return;
      setMain((current) => {
        if (!current || current.thread.id !== response.thread.id) return current;
        const next = {
            ...current,
            messages: mergeDiscussionMessages(response.messages, current.messages),
            page_info: response.page_info,
          };
        return sameDiscussionResponse(current, next) ? current : next;
      });
      preserveMainScrollRef.current = true;
      requestAnimationFrame(() => {
        if (pageSeq === mainPageSeqRef.current && activeTaskIdRef.current === expectedTaskId && activeWorkspaceKeyRef.current === expectedWorkspaceKey && scroller) {
          scroller.scrollTop = previousTop + (scroller.scrollHeight - previousHeight);
        }
      });
    } catch (error) {
      if (pageSeq === mainPageSeqRef.current && activeTaskIdRef.current === expectedTaskId && activeWorkspaceKeyRef.current === expectedWorkspaceKey) {
        toast.error(error instanceof Error ? error.message : t("更早消息加载失败"));
      }
    } finally {
      if (pageSeq === mainPageSeqRef.current && activeTaskIdRef.current === expectedTaskId && activeWorkspaceKeyRef.current === expectedWorkspaceKey) setMainEarlierLoading(false);
    }
  }, [main?.page_info.next_cursor, mainEarlierLoading, taskId, workspaceKey]);

  useEffect(() => {
    void loadMain();
    return () => { mainLoadSeqRef.current += 1; };
  }, [loadMain]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible" && !mainLoading) void loadMain(false);
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
  }, [loadMain, mainLoading, taskId]);

  useEffect(() => {
    let cancelled = false;
    setPeople([]);
    fetchRdPeople()
      .then((list) => {
        if (cancelled) return;
        setPeople(list.filter(isMentionablePerson).map((person) => ({
          user_id: person.user_id ?? null,
          name: person.name,
          hint: person.position,
        })));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [workspaceKey]);

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
    return items.sort((a, b) => mode === "progress"
      ? b.createdAt.localeCompare(a.createdAt)
      : a.createdAt.localeCompare(b.createdAt));
  }, [main?.messages, mode, notes]);

  // 进度留痕瀑布流：先滤出留痕条目再分列，保证各列条数均衡
  const progressFeedNotes = useMemo(
    () => feedItems.filter((item): item is Extract<ConversationFeedItem, { kind: "note" }> => item.kind === "note"),
    [feedItems],
  );
  const progressFeedGroups = useMemo(() => {
    const groups: Array<{
      dayKey: string;
      firstCreatedAt: string;
      items: typeof progressFeedNotes;
    }> = [];
    for (const item of progressFeedNotes) {
      const dayKey = localDayKey(item.createdAt);
      const lastGroup = groups[groups.length - 1];
      if (lastGroup?.dayKey === dayKey) lastGroup.items.push(item);
      else groups.push({ dayKey, firstCreatedAt: item.createdAt, items: [item] });
    }
    return groups;
  }, [progressFeedNotes]);
  const [progressFeedEl, setProgressFeedEl] = useState<HTMLDivElement | null>(null);
  // 列数不超过条数：留痕只有 1~2 条时不留空列（对齐原 grid `auto-fit` 折叠空轨道的行为）
  const progressColumns = Math.min(useProgressColumns(progressFeedEl), Math.max(1, progressFeedNotes.length));
  const threadSummaryByAnchor = useMemo(
    () => new Map((main?.thread_summaries ?? []).map((summary) => [
      discussionSummaryKey(summary.anchor_type, summary.anchor_id),
      summary,
    ] as const)),
    [main?.thread_summaries],
  );

  const relatedProgressThreads = useMemo(() => {
    if (mode !== "task") return [];
    return notes
      .map((note) => {
        const summary = threadSummaryByAnchor.get(discussionSummaryKey("progress_note", note.id));
        return summary && summary.message_count > 0 ? { note, summary } : null;
      })
      .filter((item): item is { note: RdTaskProgressNote; summary: RdTaskDiscussionThreadSummary } => Boolean(item))
      .sort((a, b) => (b.summary.last_message_at ?? "").localeCompare(a.summary.last_message_at ?? ""));
  }, [mode, notes, threadSummaryByAnchor]);

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
    // 进度留痕按最新优先展示，首次进入时应停在列表顶部；任务讨论仍保持聊天式的底部定位。
    if (mode === "progress") {
      if (!mainInitialScrollRef.current) return;
      const frame = requestAnimationFrame(() => {
        if (mainScrollRef.current) {
          mainScrollRef.current.scrollTop = 0;
          mainStickToBottomRef.current = false;
          mainInitialScrollRef.current = false;
        }
      });
      return () => cancelAnimationFrame(frame);
    }
    if (!mainInitialScrollRef.current && !mainStickToBottomRef.current) return;
    const frame = requestAnimationFrame(() => {
      if (mainScrollRef.current) {
        mainScrollRef.current.scrollTop = mainScrollRef.current.scrollHeight;
        mainStickToBottomRef.current = true;
        mainInitialScrollRef.current = false;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [feedItems.length, mainLoading, mode, notesLoading]);

  const loadThread = useCallback(async (anchor: ConversationAnchor, showLoading = false) => {
    const expectedTaskId = taskId;
    const expectedWorkspaceKey = workspaceKey;
    const expectedAnchorIdentity = anchorIdentity(anchor);
    const seq = ++threadLoadSeqRef.current;
    if (showLoading) {
      setThread(null);
      setThreadLoading(true);
      setThreadError("");
    }
    try {
      const anchorTaskId = anchor.taskId ?? taskId;
      const response = await fetchRdTaskDiscussion(anchorTaskId, { type: anchor.type, id: anchor.id });
      if (seq !== threadLoadSeqRef.current || activeTaskIdRef.current !== expectedTaskId || activeWorkspaceKeyRef.current !== expectedWorkspaceKey || anchorIdentity(activeAnchorRef.current) !== expectedAnchorIdentity) return;
      setThreadError("");
      if (response.anchor_preview) {
        const preview = response.anchor_preview;
        setActiveAnchor((current) => {
          if (!current) return current;
          const next = {
            ...current,
            author: preview.author_name,
            authorId: preview.author_id,
            preview: preview.body,
            createdAt: preview.created_at,
            attachments: preview.attachments,
          };
          return sameConversationAnchor(current, next) ? current : next;
        });
      }
      const normalized = { ...response, thread: { ...response.thread, unread_count: 0 } };
      setThread((current) => {
        if (showLoading || !current) return normalized;
        const next = {
          ...normalized,
          messages: mergeDiscussionMessages(current.messages, normalized.messages),
          page_info: current.page_info,
        };
        return sameDiscussionResponse(current, next) ? current : next;
      });
      if (response.thread.unread_count > 0) {
        void markRdTaskDiscussionRead(anchorTaskId, response.thread.id)
          .then(() => {
            if (seq !== threadLoadSeqRef.current || activeTaskIdRef.current !== expectedTaskId || activeWorkspaceKeyRef.current !== expectedWorkspaceKey || anchorIdentity(activeAnchorRef.current) !== expectedAnchorIdentity) return;
            announceDiscussionUpdated(anchorTaskId);
            onActivityRef.current?.();
          })
          .catch(() => {});
      }
      if (anchorTaskId === taskId) {
        setMain((current) => {
          if (!current) return current;
          const next = {
            ...current,
            thread_summaries: response.thread_summaries.map((item) =>
              item.thread_id === response.thread.id ? { ...item, unread_count: 0 } : item,
            ),
          };
          return sameDiscussionResponse(current, next) ? current : next;
        });
      }
    } catch (error) {
      if (seq !== threadLoadSeqRef.current || activeTaskIdRef.current !== expectedTaskId || activeWorkspaceKeyRef.current !== expectedWorkspaceKey || anchorIdentity(activeAnchorRef.current) !== expectedAnchorIdentity) return;
      const message = error instanceof Error ? error.message : t("讨论线程加载失败");
      if (showLoading) setThreadError(message);
      if (showLoading) toast.error(message);
    } finally {
      if (showLoading && seq === threadLoadSeqRef.current && activeTaskIdRef.current === expectedTaskId && activeWorkspaceKeyRef.current === expectedWorkspaceKey && anchorIdentity(activeAnchorRef.current) === expectedAnchorIdentity) setThreadLoading(false);
    }
  }, [anchorIdentity, taskId, workspaceKey]);

  const openThread = useCallback(async (anchor: ConversationAnchor) => {
    if (document.activeElement instanceof HTMLElement && !threadPanelRef.current?.contains(document.activeElement)) {
      threadReturnFocusRef.current = document.activeElement;
    }
    threadPageSeqRef.current += 1;
    setThreadEarlierLoading(false);
    threadStickToBottomRef.current = true;
    threadInitialScrollRef.current = true;
    activeAnchorRef.current = anchor;
    setActiveAnchor(anchor);
    setReplyTarget(null);
    await loadThread(anchor, true);
  }, [loadThread]);

  const openProgressThread = useCallback((note: RdTaskProgressNote) => {
    void openThread({
      type: "progress_note",
      id: note.id,
      taskId: note.source_task?.task_id ?? note.task_id,
      author: note.actor.name,
      preview: note.text,
      createdAt: note.created_at,
      note,
    });
  }, [openThread]);

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
    const expectedTaskId = taskId;
    const expectedWorkspaceKey = workspaceKey;
    const expectedAnchorIdentity = anchorIdentity(activeAnchor);
    const pageSeq = ++threadPageSeqRef.current;
    setThreadEarlierLoading(true);
    const scroller = threadScrollRef.current;
    const previousHeight = scroller?.scrollHeight ?? 0;
    const previousTop = scroller?.scrollTop ?? 0;
    try {
      const response = await fetchRdTaskDiscussion(
        activeAnchor.taskId ?? taskId,
        { type: activeAnchor.type, id: activeAnchor.id },
        { cursor },
      );
      if (pageSeq !== threadPageSeqRef.current || activeTaskIdRef.current !== expectedTaskId || activeWorkspaceKeyRef.current !== expectedWorkspaceKey || anchorIdentity(activeAnchorRef.current) !== expectedAnchorIdentity) return;
      setThread((current) => {
        if (!current || current.thread.id !== response.thread.id) return current;
        const next = {
            ...current,
            messages: mergeDiscussionMessages(response.messages, current.messages),
            page_info: response.page_info,
          };
        return sameDiscussionResponse(current, next) ? current : next;
      });
      preserveThreadScrollRef.current = true;
      requestAnimationFrame(() => {
        if (pageSeq === threadPageSeqRef.current && activeTaskIdRef.current === expectedTaskId && activeWorkspaceKeyRef.current === expectedWorkspaceKey && anchorIdentity(activeAnchorRef.current) === expectedAnchorIdentity && scroller) {
          scroller.scrollTop = previousTop + (scroller.scrollHeight - previousHeight);
        }
      });
    } catch (error) {
      if (pageSeq === threadPageSeqRef.current && activeTaskIdRef.current === expectedTaskId && activeWorkspaceKeyRef.current === expectedWorkspaceKey && anchorIdentity(activeAnchorRef.current) === expectedAnchorIdentity) {
        toast.error(error instanceof Error ? error.message : t("更早消息加载失败"));
      }
    } finally {
      if (pageSeq === threadPageSeqRef.current && activeTaskIdRef.current === expectedTaskId && activeWorkspaceKeyRef.current === expectedWorkspaceKey && anchorIdentity(activeAnchorRef.current) === expectedAnchorIdentity) setThreadEarlierLoading(false);
    }
  }, [activeAnchor, anchorIdentity, taskId, thread?.page_info.next_cursor, threadEarlierLoading, workspaceKey]);

  useEffect(() => {
    if (!activeAnchor) return undefined;
    const refresh = () => {
      if (document.visibilityState === "visible" && !threadLoading) void loadThread(activeAnchor, false);
    };
    const interval = window.setInterval(refresh, DISCUSSION_POLL_INTERVAL_MS);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, [activeAnchor, loadThread, threadLoading]);

  useEffect(() => {
    if (threadLoading || !threadScrollRef.current) return;
    if (preserveThreadScrollRef.current) {
      preserveThreadScrollRef.current = false;
      return;
    }
    if (!threadInitialScrollRef.current && !threadStickToBottomRef.current) return;
    const frame = requestAnimationFrame(() => {
      if (threadScrollRef.current) {
        threadScrollRef.current.scrollTop = threadScrollRef.current.scrollHeight;
        threadStickToBottomRef.current = true;
        threadInitialScrollRef.current = false;
      }
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

  const closeThread = useCallback(() => {
    const focusTarget = threadReturnFocusRef.current;
    threadReturnFocusRef.current = null;
    const restoreFocus = () => {
      if (focusTarget?.isConnected) window.requestAnimationFrame(() => focusTarget.focus());
    };
    if (focusAnchor && focusAnchor.type !== "task") {
      onCloseFocus?.();
      restoreFocus();
      return;
    }
    const anchorTaskId = activeAnchor?.taskId ?? taskId;
    threadLoadSeqRef.current += 1;
    threadPageSeqRef.current += 1;
    setThreadEarlierLoading(false);
    activeAnchorRef.current = null;
    setActiveAnchor(null);
    setThread(null);
    setThreadError("");
    setReplyTarget(null);
    if (anchorTaskId === taskId) void loadMain(false);
    restoreFocus();
  }, [activeAnchor?.taskId, focusAnchor, loadMain, onCloseFocus, taskId]);

  useEffect(() => {
    if (!activeAnchor || !threadIsOverlay) return undefined;
    const frame = window.requestAnimationFrame(() => threadBackButtonRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeThread();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = threadPanelRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((element) => !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true");
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [activeAnchor, closeThread, threadIsOverlay]);

  useEffect(() => {
    const mainElement = mainContentRef.current;
    if (!mainElement) return undefined;
    if (activeAnchor && threadIsOverlay) mainElement.setAttribute("inert", "");
    else mainElement.removeAttribute("inert");
    return () => mainElement.removeAttribute("inert");
  }, [activeAnchor, threadIsOverlay]);

  const appendMainMessage = (message: RdTaskDiscussionMessage, threadId: string) => {
    if (activeTaskIdRef.current !== taskId || activeWorkspaceKeyRef.current !== workspaceKey || !main || main.thread.id !== threadId) return;
    mainStickToBottomRef.current = true;
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

  const appendThreadMessage = (message: RdTaskDiscussionMessage, threadId: string) => {
    if (activeTaskIdRef.current !== taskId || activeWorkspaceKeyRef.current !== workspaceKey || !thread || thread.thread.id !== threadId) return;
    threadStickToBottomRef.current = true;
    setThread((current) => current
      ? {
          ...current,
          messages: [...current.messages, message],
          thread: { ...current.thread, message_count: current.thread.message_count + 1 },
        }
      : current);
    setReplyTarget(null);
    if ((!focusAnchor || focusAnchor.type === "task") && (activeAnchor?.taskId ?? taskId) === taskId) {
      void loadMain(false);
    }
    onMessageSent?.(message);
    onActivity?.();
  };

  const mainContent = (
    <section
      ref={mainContentRef}
      aria-hidden={activeAnchor && threadIsOverlay ? true : undefined}
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col",
        mode === "progress" && progressPresentation === "timeline"
          ? "bg-white"
          : "bg-slate-50/70",
      )}
      aria-label={`${mode === "progress" ? t("进度留痕") : t("任务讨论")}：${taskTitle}`}
    >
      {main?.access_scope === "thread_invitee" && (
        <ThreadInvitationBanner
          inviterName={main.invitation?.invited_by_name ?? ""}
          compact={variant === "mobile"}
        />
      )}
      <div
        ref={mainScrollRef}
        onScroll={(event) => updateStickToBottom(event.currentTarget, mainStickToBottomRef)}
        className="cockpit-scroll min-h-0 flex-1 overflow-y-auto px-2.5 pb-2 sm:px-4"
        aria-live="polite"
      >
        {(mainLoading && !main) || (mode === "progress" && notesLoading && notes.length === 0) ? (
          <div className="space-y-3 py-5">
            {[0, 1, 2].map((item) => (
              <div key={item} className={cn("flex animate-pulse gap-2", item % 2 ? "justify-end" : "justify-start")}>
                <div className="h-8 w-8 rounded-full bg-slate-200" />
                <div className="h-16 w-[58%] rounded-2xl bg-slate-100" />
              </div>
            ))}
          </div>
        ) : mainError && !main ? (
          <div className="flex h-full min-h-72 flex-col items-center justify-center px-8 text-center" role="alert">
            <span className="flex size-14 items-center justify-center rounded-xl border border-amber-200 bg-amber-50 text-amber-600">
              <RefreshCw className="size-6" aria-hidden="true" />
            </span>
            <h5 className="mt-4 text-balance text-sm font-bold text-slate-800">{t("任务讨论暂不可用")}</h5>
            <p className="mt-1 max-w-xs text-pretty text-xs leading-5 text-slate-500">{mainError}</p>
            <Button
              type="button"
              onClick={() => void loadMain()}
              className="mt-4 min-h-10 cursor-pointer rounded-xl px-4 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2"
            >
              {t("重新加载讨论")}
            </Button>
          </div>
        ) : mode === "progress" && notesError ? (
          <div className="flex h-full min-h-72 flex-col items-center justify-center px-8 text-center" role="alert">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-rose-100 bg-rose-50 text-rose-500">
              <X className="h-6 w-6" />
            </span>
            <h5 className="mt-4 text-balance text-sm font-bold text-slate-800">{t("进度留痕加载失败")}</h5>
            <p className="mt-1 max-w-xs text-pretty text-xs leading-5 text-slate-500">{notesError}</p>
            {onRetryNotes && (
              <Button
                type="button"
                onClick={onRetryNotes}
                className="mt-4 min-h-10 cursor-pointer rounded-xl px-4 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2"
              >
                {t("重新加载进度留痕")}
              </Button>
            )}
          </div>
        ) : feedItems.length === 0 && relatedProgressThreads.length === 0 ? (
          <div className="flex h-full min-h-72 flex-col items-center justify-center px-8 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-blue-100 bg-blue-50 text-primary">
              {mode === "progress" ? <Sparkles className="h-6 w-6" /> : <MessageCircleMore className="h-6 w-6" />}
            </span>
            <h5 className="mt-4 text-balance text-sm font-bold text-slate-800">
              {mode === "progress" ? t("还没有进度留痕") : t("开始这个任务的第一段讨论")}
            </h5>
            <p className="mt-1 max-w-xs text-pretty text-xs leading-5 text-slate-500">
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
              <section className="rd-related-progress-threads mt-2 rounded-xl border border-blue-100 bg-white/90 p-2.5 shadow-[0_5px_18px_rgba(var(--primary-rgb),0.05)]">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h5 className="text-xs font-bold text-slate-800">{t("相关进度讨论")}</h5>
                    <p className="mt-0.5 text-[10px] text-slate-500">{t("仅显示已经产生回复的进度记录")}</p>
                  </div>
                  <span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-bold text-primary">
                    {relatedProgressThreads.length}
                  </span>
                </div>
                <div className="mt-1.5 grid grid-cols-[repeat(auto-fit,minmax(min(100%,20rem),1fr))] gap-1.5">
                  {relatedProgressThreads.map(({ note, summary }) => {
                    const anchor: ConversationAnchor = {
                      type: "progress_note",
                      id: note.id,
                      taskId: note.source_task?.task_id ?? note.task_id,
                      author: note.actor.name,
                      preview: note.text,
                      createdAt: note.created_at,
                      note,
                    };
                    return (
                      <Button variant="unstyled"
                        key={note.id}
                        type="button"
                        onClick={() => void openThread(anchor)}
                        className="rd-related-progress-threads__item group flex min-h-14 cursor-pointer items-start gap-2 rounded-lg border border-slate-200 bg-slate-50/70 px-2.5 py-2 text-left transition-colors duration-200 hover:border-primary/25 hover:bg-accent/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                      >
                        <ConversationAvatar name={note.actor.name} userId={note.actor.id} size="xs" />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2 text-[10px] text-slate-500">
                            <span className="truncate font-semibold text-slate-700">{note.actor.name}</span>
                            {/* 这是某条留痕的时间（不是日期分隔条），精确到秒 */}
                            <span className="ml-auto shrink-0 tabular-nums">{formatCompactDateTime(note.created_at)}</span>
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-slate-600">{note.text || t("附件进度记录")}</span>
                          <span className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-bold text-primary">
                            {t("{n} 条讨论", { n: summary.message_count })}
                            {summary.unread_count > 0 && (
                              <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[9px] text-white">
                                {summary.unread_count > 99 ? "99+" : summary.unread_count}
                              </span>
                            )}
                          </span>
                        </span>
                      </Button>
                    );
                  })}
                </div>
              </section>
            )}
            {mode === "progress" ? (
              progressPresentation === "timeline" ? (
                <ProgressTimeline
                  items={progressFeedNotes}
                  summaryByAnchor={threadSummaryByAnchor}
                  onOpenThread={openProgressThread}
                  onOpenSourceTask={onOpenSourceTask}
                  selectedActor={selectedActor}
                  onActorClick={onActorClick}
                  candidates={candidates}
                  variant={variant}
                />
              ) : (
                <div ref={setProgressFeedEl} className="mt-1.5 space-y-3">
                  {progressFeedGroups.map((group) => (
                    <section key={group.dayKey} aria-label={formatDayLabel(group.firstCreatedAt)}>
                      <ProgressDateHeader iso={group.firstCreatedAt} />
                      <div className="mt-1 flex items-start gap-1.5">
                        {distributeIntoColumns(group.items, Math.min(progressColumns, group.items.length)).map((column, columnIndex) => (
                          <div key={columnIndex} className="flex min-w-0 flex-1 flex-col gap-1.5">
                            {column.map((item) => {
                              const noteSummary = threadSummaryByAnchor.get(discussionSummaryKey("progress_note", item.note.id));
                              const anchor: ConversationAnchor = {
                                type: "progress_note",
                                id: item.note.id,
                                taskId: item.note.source_task?.task_id ?? item.note.task_id,
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
                                  onOpenSourceTask={onOpenSourceTask}
                                  selectedActor={selectedActor}
                                  onActorClick={onActorClick}
                                  candidates={candidates}
                                  variant={variant}
                                />
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              )
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
                const messageSummary = threadSummaryByAnchor.get(discussionSummaryKey("message", item.message.id));
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
          key={`main-composer:${taskId}`}
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
      ) : null}
    </section>
  );

  return (
    <TaskImageGalleryScope notes={notes}>
      <div ref={conversationRef} className={cn("relative flex min-h-0 min-w-0 flex-1 overflow-hidden bg-white", className)}>
      {mainContent}
      {activeAnchor && (
          <>
            <aside
              ref={threadPanelRef}
              role={threadIsOverlay ? "dialog" : undefined}
              aria-modal={threadIsOverlay ? true : undefined}
              tabIndex={threadIsOverlay ? -1 : undefined}
              aria-label={activeAnchor.type === "progress_note" ? t("关于这条进度的讨论") : t("消息讨论")}
              className={cn(
                "z-20 flex min-h-0 flex-col border-l border-slate-200 bg-white shadow-[-18px_0_50px_rgba(15,23,42,0.14)]",
                threadIsOverlay
                  ? "absolute inset-0 w-full border-l-0 shadow-none"
                  : "static w-[420px] shrink-0 shadow-none",
              )}
            >
              <header className="flex h-12 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-2.5">
                <Button variant="unstyled"
                  ref={threadBackButtonRef}
                  type="button"
                  onClick={closeThread}
                  className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  aria-label={mode === "progress" ? t("返回进度留痕") : t("返回任务讨论")}
                >
                  <ArrowLeft className="h-4.5 w-4.5" />
                </Button>
                <div className="min-w-0 flex-1">
                  <h5 className="truncate text-balance text-sm font-bold text-slate-900">
                    {activeAnchor.type === "progress_note" ? t("关于这条进度的讨论") : t("消息讨论")}
                  </h5>
                  <p className="truncate text-[10px] text-slate-500">
                    {threadLoading ? t("读取中…") : t("{n} 条回复", { n: thread?.messages.length ?? 0 })}
                  </p>
                </div>
                <Button variant="unstyled"
                  type="button"
                  onClick={closeThread}
                  className="hidden h-8 w-8 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-slate-100 hover:text-slate-700 sm:flex"
                  aria-label={t("关闭")}
                >
                  <X className="h-4 w-4" />
                </Button>
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
              <div
                ref={threadScrollRef}
                onScroll={(event) => updateStickToBottom(event.currentTarget, threadStickToBottomRef)}
                className="cockpit-scroll min-h-0 flex-1 overflow-y-auto bg-slate-50/60 px-2.5 py-2"
                aria-live="polite"
              >
                {threadLoading ? (
                  <div className="space-y-3 p-3" role="status" aria-label={t("正在读取讨论线程")}>
                    {[0, 1, 2].map((item) => (
                      <div key={item} className={cn("flex gap-2", item % 2 ? "justify-end" : "justify-start")}>
                        <span className="size-7 animate-pulse rounded-full bg-slate-200 motion-reduce:animate-none" />
                        <span className="h-14 w-[68%] animate-pulse rounded-xl bg-slate-100 motion-reduce:animate-none" />
                      </div>
                    ))}
                    <span className="sr-only">{t("正在读取讨论线程")}</span>
                  </div>
                ) : threadError ? (
                  <div className="flex h-full min-h-48 flex-col items-center justify-center px-8 text-center" role="alert">
                    <RefreshCw className="size-7 text-amber-500" aria-hidden="true" />
                    <h6 className="mt-3 text-balance text-sm font-semibold text-slate-800">{t("讨论线程加载失败")}</h6>
                    <p className="mt-1 max-w-xs text-pretty text-xs leading-5 text-slate-500">{threadError}</p>
                    <Button type="button" onClick={() => void loadThread(activeAnchor, true)} className="mt-3 rounded-lg px-3 py-2 text-xs font-semibold">
                      {t("重新加载线程")}
                    </Button>
                  </div>
                ) : (thread?.messages.length ?? 0) === 0 ? (
                  <div className="flex h-full min-h-48 flex-col items-center justify-center px-8 text-center">
                    <MessageCircleReply className="h-7 w-7 text-primary/35" />
                    <div className="mt-3 text-balance text-sm font-semibold text-slate-700">{t("还没有相关讨论")}</div>
                    <div className="mt-1 max-w-xs text-pretty text-xs leading-5 text-slate-500">
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
                  key={`thread-composer:${activeAnchor.taskId ?? taskId}:${activeAnchor.type}:${activeAnchor.id ?? ""}`}
                  taskId={activeAnchor.taskId ?? taskId}
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
            </aside>
          </>
      )}
      </div>
    </TaskImageGalleryScope>
  );
}

function ProgressTimeline({
  items,
  summaryByAnchor,
  onOpenThread,
  onOpenSourceTask,
  selectedActor,
  onActorClick,
  candidates,
  variant,
}: {
  items: ProgressFeedNote[];
  summaryByAnchor: ReadonlyMap<string, RdTaskDiscussionThreadSummary>;
  onOpenThread: (note: RdTaskProgressNote) => void;
  onOpenSourceTask?: (taskId: string) => void;
  selectedActor?: AuditActorIdentity | null;
  onActorClick?: (actor: AuditActorIdentity) => void;
  candidates: MentionCandidate[];
  variant: "desktop" | "mobile";
}) {
  return (
    <div className="rd-progress-timeline mt-3 pb-2" aria-label={t("进展留痕时间线")}>
      {items.map((item, index) => {
        const previous = items[index - 1];
        const showDate = !previous || localDayKey(previous.createdAt) !== localDayKey(item.createdAt);
        const date = formatTimelineDate(item.createdAt);
        return (
          <div
            key={item.note.id}
            className="rd-progress-timeline__row grid grid-cols-[64px_22px_minmax(0,1fr)] sm:grid-cols-[76px_26px_minmax(0,1fr)]"
            style={{ contentVisibility: "auto", containIntrinsicSize: "180px" }}
          >
            <time
              dateTime={localDayKey(item.createdAt)}
              aria-hidden={!showDate || undefined}
              className={cn(
                "pr-2 pt-1 text-right text-[11px] font-semibold tabular-nums text-slate-500",
                !showDate && "invisible",
              )}
            >
              <span className={cn("block", date.secondary && "font-bold text-slate-700")}>{date.primary}</span>
              {date.secondary ? <span className="mt-0.5 block text-[10px] font-medium text-muted-foreground">{date.secondary}</span> : null}
            </time>
            <div className="relative flex justify-center" aria-hidden="true">
              {index > 0 ? <span className="rd-progress-timeline__line absolute left-1/2 top-0 h-4 w-px -translate-x-1/2 bg-slate-200" /> : null}
              {index < items.length - 1 ? <span className="rd-progress-timeline__line absolute bottom-0 left-1/2 top-4 w-px -translate-x-1/2 bg-slate-200" /> : null}
              <span className="rd-progress-timeline__dot relative mt-3 h-2.5 w-2.5 rounded-full border-2 border-white bg-primary shadow-[0_0_0_3px_rgba(var(--primary-rgb),0.13)]" />
            </div>
            <div className={cn("min-w-0", index < items.length - 1 ? "pb-4" : "pb-1")}>
              <ProgressAnchorCard
                note={item.note}
                summary={summaryByAnchor.get(discussionSummaryKey("progress_note", item.note.id))}
                onOpenThread={() => onOpenThread(item.note)}
                onOpenSourceTask={onOpenSourceTask}
                selectedActor={selectedActor}
                onActorClick={onActorClick}
                candidates={candidates}
                variant={variant}
                presentation="timeline"
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
