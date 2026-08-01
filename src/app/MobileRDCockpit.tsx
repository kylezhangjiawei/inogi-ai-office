import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, ArrowLeft, Clock, History, ImageIcon, Inbox, Loader2, MessageCircleMore, RefreshCw, Search, Send, Users, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "./components/ui/utils";
import { t, useI18n } from "./lib/i18n";
import { recordAudit, useAuditActor } from "./lib/auditLog";
import { useRDCockpitData } from "./hooks/useRDCockpitData";
import {
  createRdTaskProgressNote,
  fetchRdNoteUnreadSummary,
  fetchRdPeople,
  fetchRdTaskProgressNotes,
  markRdTaskNotesRead,
  type RdTask,
  type RdTaskProgressNote,
  type RdTaskStatus,
} from "./lib/rdApi";
import { MentionSuggestionPanel, useMentions, type MentionCandidate } from "./components/MentionInput";
import { RDTaskConversation } from "./RDTaskConversation";
import { MobileAttachmentPreviewHost } from "./RDProgressEvidence";
import {
  closeMobileOverlay,
  isCurrentMobileOverlay,
  pushMobileOverlayState,
  useBodyScrollLock,
  useMobileOverlayBack,
} from "./hooks/useMobileOverlay";

const TASK_DETAIL_OVERLAY = "rd-mobile-task-detail";
const CARD_IMAGE_OVERLAY = "rd-mobile-card-image";

// ─── 文案 / 配色映射（移动端自带一份，与桌面同口径、样式独立）────────────────────
const STATUS_META: Record<RdTaskStatus, { label: string; dot: string; tint: string }> = {
  draft: { label: "草稿", dot: "bg-slate-400", tint: "bg-slate-100 text-slate-500" },
  in_progress: { label: "进行中", dot: "bg-indigo-500", tint: "bg-indigo-50 text-indigo-600" },
  paused_leave: { label: "请假", dot: "bg-amber-500", tint: "bg-amber-50 text-amber-600" },
  paused_blocked: { label: "阻塞", dot: "bg-red-500", tint: "bg-red-50 text-red-600" },
  completed: { label: "已完成", dot: "bg-emerald-500", tint: "bg-emerald-50 text-emerald-600" },
  pending_assign: { label: "待指派", dot: "bg-violet-500", tint: "bg-violet-50 text-violet-600" },
  pending_review: { label: "待审核", dot: "bg-purple-500", tint: "bg-purple-50 text-purple-600" },
  on_hold: { label: "已挂起", dot: "bg-slate-400", tint: "bg-slate-100 text-slate-500" },
  archived: { label: "已封存", dot: "bg-slate-400", tint: "bg-slate-100 text-slate-500" },
};

type MobileFilter = "all" | "in_progress" | "completed" | "blocked" | "risk";

const FILTERS: Array<{ key: MobileFilter; label: string }> = [
  { key: "all", label: "全部" },
  { key: "in_progress", label: "进行中" },
  { key: "blocked", label: "阻塞待派" },
  { key: "completed", label: "已完成" },
  { key: "risk", label: "风险" },
];

const TASK_PAGE = 6;

function daysLeft(due?: string): number | null {
  if (!due) return null;
  const d = new Date(due);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date(new Date().toISOString().slice(0, 10));
  return Math.ceil((d.getTime() - today.getTime()) / 86_400_000);
}

function formatDue(due?: string): { text: string; overdue: boolean } | null {
  if (!due) return null;
  const md = due.slice(5, 10);
  const left = daysLeft(due);
  if (left === null) return { text: t("止 {date}", { date: md }), overdue: false };
  if (left < 0) return { text: t("逾期 {n} 天", { n: -left }), overdue: true };
  if (left === 0) return { text: t("今日截止"), overdue: false };
  if (left <= 2) return { text: t("{n} 天内", { n: left }), overdue: false };
  return { text: t("止 {date}", { date: md }), overdue: false };
}

function progressColor(status: RdTaskStatus): string {
  if (status === "completed") return "bg-emerald-500";
  if (status === "paused_blocked" || status === "pending_assign") return "bg-red-400";
  return "bg-indigo-500";
}

function ownerInitial(owner: string): string {
  const trimmed = owner.trim();
  return trimmed ? trimmed[0].toUpperCase() : "?";
}

function sameUnreadCounts(current: Record<string, number>, next: Record<string, number>): boolean {
  const currentKeys = Object.keys(current);
  const nextKeys = Object.keys(next);
  return currentKeys.length === nextKeys.length
    && currentKeys.every((key) => current[key] === next[key]);
}

/** 取分类路径最后一级作为话题标签（小红书风格的 # 标签）。 */
function lastCategory(path?: string): string {
  if (!path) return "";
  const parts = path
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

/** 相对时间（刚刚 / N 分钟前 / N 小时前 / N 天前 / N 个月前），供卡片显示最近活动时间。 */
function formatRelativeTime(iso?: string): string {
  if (!iso) return "";
  // 局部变量不可命名为 t：会遮蔽 import 的翻译函数导致运行时崩溃
  const timestamp = new Date(iso).getTime();
  if (Number.isNaN(timestamp)) return "";
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return t("刚刚");
  const min = Math.floor(diff / 60_000);
  if (min < 60) return t("{n} 分钟前", { n: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t("{n} 小时前", { n: hr });
  const day = Math.floor(hr / 24);
  if (day < 30) return t("{n} 天前", { n: day });
  const mon = Math.floor(day / 30);
  if (mon < 12) return t("{n} 个月前", { n: mon });
  return t("{n} 年前", { n: Math.floor(mon / 12) });
}

/**
 * 最近活动时间的「新鲜度」分级：让领导一眼看出任务是否还在持续推进。
 * 用红绿灯配色高亮显示——绿=最近有动静（放心），红=久未更新（重点关注）。
 *  - 3 天内：绿（活跃）
 *  - 3~7 天：琥珀（开始转冷，留意）
 *  - 超 7 天：红（久未推进）
 */
function activityFreshness(iso?: string): { text: string; tint: string } | null {
  const text = formatRelativeTime(iso);
  if (!text || !iso) return null;
  const days = (Date.now() - new Date(iso).getTime()) / 86_400_000;
  if (days < 3) return { text, tint: "bg-emerald-100 text-emerald-700" };
  if (days < 7) return { text, tint: "bg-amber-100 text-amber-700" };
  return { text, tint: "bg-rose-100 text-rose-600" };
}

/** AI 复盘评分等级配色（A 优 / B 良 / C 中 / D 差）。 */
function scoreChipTint(grade: string): string {
  switch (grade.toUpperCase()) {
    case "A":
      return "bg-emerald-50 text-emerald-600";
    case "B":
      return "bg-blue-50 text-blue-600";
    case "C":
      return "bg-amber-50 text-amber-600";
    default:
      return "bg-red-50 text-red-600";
  }
}

// ─── 图片预览灯箱（流式卡片封面点击放大；纯图片、支持多图切换）────────────────────
function ImageLightbox({
  images,
  thumbnails,
  startIndex,
  onClose,
}: {
  images: string[];
  thumbnails?: string[];
  startIndex: number;
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(startIndex);
  useBodyScrollLock(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const safeIdx = Math.min(Math.max(idx, 0), images.length - 1);
  const current = images[safeIdx];

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex flex-col overscroll-none bg-slate-950/90 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="图片预览">
      <div className="flex shrink-0 items-center justify-between px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-white/90">
        <span className="text-xs tabular-nums">
          {safeIdx + 1} / {images.length}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭预览"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 active:bg-white/20"
        >
          <X size={20} />
        </button>
      </div>
      <div
        className="flex min-h-0 flex-1 items-center justify-center px-4 pb-4"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={current}
          alt="附件预览"
          loading="eager"
          decoding="async"
          className="max-h-full max-w-full rounded-lg object-contain"
        />
      </div>
      {images.length > 1 && (
        <div
          className="flex shrink-0 gap-2 overflow-x-auto px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {images.map((u, i) => (
            <button
              key={`${u}-${i}`}
              type="button"
              onClick={() => setIdx(i)}
              className={cn(
                "h-14 w-14 shrink-0 overflow-hidden rounded-lg ring-2 transition",
                i === safeIdx ? "ring-white" : "opacity-60 ring-transparent",
              )}
            >
              <img
                src={thumbnails?.[i] ?? u}
                alt=""
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}

// ─── 瀑布流卡片（竖向：状态 + 标签 → 封面 → 标题 → 最新进展 → 进度 → 负责人行）──────
function MobileFeedCard({
  task,
  isRisk,
  onOpen,
  onPreview,
  unreadCount = 0,
  priority = false,
}: {
  task: RdTask;
  isRisk: boolean;
  onOpen: () => void;
  onPreview: (images: string[], thumbnails: string[], index: number) => void;
  /** 未读评论数（微信式红点，>0 才显示） */
  unreadCount?: number;
  priority?: boolean;
}) {
  const status = STATUS_META[task.status] ?? STATUS_META.draft;
  const due = formatDue(task.due_date);
  const owner = (task.primary_owner || "").trim() || t("未指派");
  const progress = Math.max(0, Math.min(100, task.progress));
  const summary = task.latest_progress_summary?.text?.trim();
  const cat = lastCategory(task.category_path);
  const isHigh = (task.final_priority ?? task.ai_priority) === "high";
  const cover = task.cover_images ?? [];
  const coverThumbnails = task.cover_image_thumbnails ?? cover;
  const score = task.completion_score;
  const freshness = activityFreshness(
    task.last_activity_at ?? task.latest_progress_summary?.created_at ?? task.updated_at,
  );

  return (
    <article
      style={{ contentVisibility: "auto", containIntrinsicSize: "420px" }}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        "block w-full cursor-pointer overflow-hidden rounded-2xl border bg-white text-left shadow-sm transition active:scale-[0.99]",
        isRisk ? "border-red-200" : "border-slate-200/70",
      )}
    >
      {/* 顶部：状态胶囊 + 话题标签 + 评分 + 风险 */}
      <div className="flex items-center gap-1.5 px-3 pt-3">
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
            status.tint,
          )}
        >
          <span className={cn("h-1.5 w-1.5 rounded-full", status.dot)} />
          {t(status.label)}
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-slate-400">
          {cat ? `# ${cat}` : ""}
        </span>
        {unreadCount > 0 && (
          <span
            className="inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold leading-none text-white shadow-sm"
            title={t("有 {n} 条未读评论", { n: unreadCount })}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
        {score && (
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold",
              scoreChipTint(score.grade),
            )}
          >
            {score.grade}·{score.total}
          </span>
        )}
        {isRisk && (
          <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-600">
            <AlertTriangle size={10} />
            {t("风险")}
          </span>
        )}
      </div>

      {/* 封面：进度留痕里的图片附件缩略图，点击放大预览（阻止冒泡，避免误开详情）*/}
      {cover.length > 0 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPreview(cover, coverThumbnails, 0);
          }}
          aria-label="预览附件图片"
          className="mt-2.5 block w-full px-3"
        >
          <div className="relative overflow-hidden rounded-xl bg-slate-100">
            <img
              src={coverThumbnails[0] ?? cover[0]}
              alt="附件封面"
              loading={priority ? "eager" : "lazy"}
              decoding="async"
              className="aspect-[4/3] w-full object-cover"
            />
            {cover.length > 1 && (
              <span className="absolute bottom-1.5 right-1.5 inline-flex items-center gap-1 rounded-full bg-slate-900/70 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
                <ImageIcon size={10} />
                {cover.length}
              </span>
            )}
          </div>
        </button>
      )}

      {/* 标题 */}
      <h3 className="px-3 pt-2 text-[14px] font-semibold leading-snug text-slate-900 line-clamp-3 break-words">
        {task.title}
      </h3>

      {/* 最新进展（部分任务有 → 制造瀑布高度差）*/}
      {summary && (
        <p className="px-3 pt-1.5 text-[12px] leading-relaxed text-slate-400 line-clamp-2 break-words">
          {summary}
        </p>
      )}

      {/* 进度 */}
      <div className="flex items-center gap-2 px-3 pt-2.5">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
          <div
            className={cn("h-full rounded-full", progressColor(task.status))}
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="shrink-0 text-[11px] font-bold text-slate-500">{progress}%</span>
      </div>

      {/* 负责人行（小红书作者行）+ 最近活动时间 */}
      <div className="mt-2.5 border-t border-slate-100 px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-[10px] font-bold text-indigo-600">
            {ownerInitial(owner)}
          </span>
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-slate-500">{owner}</span>
          {isHigh && (
            <span className="shrink-0 rounded bg-red-50 px-1 text-[10px] font-bold text-red-500">{t("高")}</span>
          )}
          {due && (
            <span className={cn("shrink-0 text-[11px]", due.overdue ? "font-bold text-red-500" : "text-slate-400")}>
              {due.text}
            </span>
          )}
        </div>
        {freshness && (
          <div className="mt-1.5">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-bold",
                freshness.tint,
              )}
            >
              <Clock size={11} />
              {freshness.text}{t("更新")}
            </span>
          </div>
        )}
      </div>
    </article>
  );
}

// ─── 主页面 ───────────────────────────────────────────────────────────────────
export function MobileRDCockpit() {
  useI18n(); // 订阅语言切换（移动端文案已 t() 化）
  const { loading, error, reload, risks, allTasks } = useRDCockpitData();

  const [filter, setFilter] = useState<MobileFilter>("all");
  const [person, setPerson] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [visible, setVisible] = useState(TASK_PAGE);
  const [activeTask, setActiveTask] = useState<RdTask | null>(null);
  // 灯箱状态提升到页面级：避免在 columns 多列容器里渲染 fixed 元素的布局怪相，
  // 也避免灯箱作为卡片子节点时 onClick 经 React 树冒泡回卡片误开详情。
  const [lightbox, setLightbox] = useState<{ images: string[]; thumbnails: string[]; index: number } | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const riskTaskIds = useMemo(() => new Set(risks.map((r) => r.task.task_id)), [risks]);

  // 非归档任务总数（人员「全部」标记用）
  const activeCount = useMemo(() => allTasks.filter((t) => !t.archived).length, [allTasks]);

  // 人员过滤项：直接由当前任务的 primary_owner 聚合，保证 chip 计数与筛选结果一致。
  const owners = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of allTasks) {
      if (t.archived) continue;
      const name = (t.primary_owner || "").trim() || "未指派";
      m.set(name, (m.get(name) ?? 0) + 1);
    }
    return Array.from(m, ([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  }, [allTasks]);

  const normalizedKeyword = keyword.trim().toLocaleLowerCase();

  // 搜索 + 状态 + 人员三重过滤（AND）。搜索仅使用驾驶舱已加载的数据，不新增接口请求。
  const filteredTasks = useMemo(() => {
    let list = allTasks.filter((t) => !t.archived);
    switch (filter) {
      case "in_progress":
        list = list.filter((t) => t.status === "in_progress");
        break;
      case "completed":
        list = list.filter((t) => t.status === "completed");
        break;
      case "blocked":
        list = list.filter((t) => t.status === "paused_blocked" || t.status === "pending_assign");
        break;
      case "risk":
        list = list.filter((t) => riskTaskIds.has(t.task_id));
        break;
      default:
        break;
    }
    if (person) list = list.filter((t) => ((t.primary_owner || "").trim() || "未指派") === person);
    if (normalizedKeyword) {
      list = list.filter((task) =>
        [task.title, task.task_id, (task.primary_owner || "").trim() || "未指派", task.category_path]
          .some((value) => String(value ?? "").toLocaleLowerCase().includes(normalizedKeyword)),
      );
    }
    // 按最近活动时间倒序，使卡片按行从左到右呈现时对应时间顺序（最新在前）。
    const tsOf = (t: (typeof list)[number]) =>
      String(t.last_activity_at ?? t.latest_progress_summary?.created_at ?? t.updated_at ?? "");
    return [...list].sort((a, b) => tsOf(b).localeCompare(tsOf(a)));
  }, [allTasks, filter, normalizedKeyword, person, riskTaskIds]);

  // 切换过滤回到第一页
  useEffect(() => {
    setVisible(TASK_PAGE);
  }, [filter, normalizedKeyword, person]);

  // 触底加载更多
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisible((v) => (v < filteredTasks.length ? v + TASK_PAGE : v));
        }
      },
      { rootMargin: "120px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [filteredTasks.length]);

  const dismissActiveTask = useCallback(() => setActiveTask(null), []);
  const dismissLightbox = useCallback(() => setLightbox(null), []);
  const closeActiveTask = useCallback(
    () => closeMobileOverlay(TASK_DETAIL_OVERLAY, dismissActiveTask),
    [dismissActiveTask],
  );
  useMobileOverlayBack(Boolean(activeTask), TASK_DETAIL_OVERLAY, dismissActiveTask);
  useMobileOverlayBack(Boolean(lightbox), CARD_IMAGE_OVERLAY, dismissLightbox);

  const shownTasks = filteredTasks.slice(0, visible);

  const scrollTop = () => {
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "auto" });
  };
  const pickStatus = (k: MobileFilter) => {
    setFilter(k);
    scrollTop();
  };
  const pickPerson = (name: string | null) => {
    setPerson((prev) => (name && prev === name ? null : name));
    scrollTop();
  };

  // ── 评论未读红点（微信式）：任务级未读数，点开详情即标记已读（全端同步消失）──
  const [noteUnread, setNoteUnread] = useState<Record<string, number>>({});
  const refreshNoteUnread = useCallback(() => {
    return fetchRdNoteUnreadSummary()
      .then((next) => {
        setNoteUnread((current) => sameUnreadCounts(current, next) ? current : next);
      })
      .catch(() => {});
  }, []);
  const handleTaskDataChanged = useCallback(() => {
    reload();
    void refreshNoteUnread();
  }, [refreshNoteUnread, reload]);
  const handleDiscussionActivity = useCallback(() => {
    void refreshNoteUnread();
  }, [refreshNoteUnread]);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void refreshNoteUnread();
    };
    const interval = window.setInterval(refresh, 15_000);
    void refreshNoteUnread();
    window.addEventListener("focus", refresh);
    window.addEventListener("rd:discussion-updated", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("rd:discussion-updated", refresh);
    };
  }, [refreshNoteUnread]);

  // 打开任务详情：压入一条 history，使「系统返回键 / 详情内返回」都只关详情、不退出 /m。
  const openTask = (task: RdTask) => {
    pushMobileOverlayState(TASK_DETAIL_OVERLAY);
    setActiveTask(task);
    // 只标记正式留痕已读；讨论仍按线程逐个已读，避免打开任务时把尚未查看的对话误清空。
    void markRdTaskNotesRead(task.task_id)
      .catch(() => {})
      .finally(() => { void refreshNoteUnread(); });
  };

  // 首屏加载 / 错误（仅当还没有任何数据时占满）
  if (loading && allTasks.length === 0) {
    return (
      <div className="flex min-h-[70dvh] flex-col items-center justify-center gap-3 text-slate-400">
        <Loader2 className="animate-spin" size={28} />
        <span className="text-sm">{t("正在加载驾驶舱…")}</span>
      </div>
    );
  }
  if (error && allTasks.length === 0) {
    return (
      <div className="flex min-h-[70dvh] flex-col items-center justify-center gap-4 px-8 text-center">
        <AlertTriangle className="text-red-400" size={30} />
        <p className="text-sm text-slate-500">{error}</p>
        <button
          type="button"
          onClick={reload}
          className="rounded-full bg-indigo-600 px-7 py-2.5 text-sm font-semibold text-white active:bg-indigo-700"
        >
          {t("重试")}
        </button>
      </div>
    );
  }

  return (
    <div className="w-full pb-[max(2.5rem,env(safe-area-inset-bottom))]">
      {/* ── 页头过滤区（吸顶）────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 border-b border-slate-200/70 bg-slate-50/95 backdrop-blur-md">
        {/* 状态过滤：手机宽度固定五等分，避免末项被刷新按钮挤出视口。 */}
        <div className="grid grid-cols-5 gap-1.5 px-3 pt-3 sm:flex sm:gap-2 sm:px-4">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => pickStatus(f.key)}
              aria-pressed={filter === f.key}
              className={cn(
                "min-w-0 whitespace-nowrap rounded-full px-1 py-1.5 text-[11px] font-semibold transition active:scale-[0.97] sm:shrink-0 sm:px-3.5 sm:text-[13px]",
                filter === f.key
                  ? "bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-sm"
                  : "bg-white text-slate-500 ring-1 ring-slate-200/70 active:bg-slate-50",
              )}
            >
              {t(f.label)}
            </button>
          ))}
        </div>

        {/* 本地任务搜索：与状态、人员筛选叠加，不改变接口与其它驾驶舱逻辑。 */}
        <div className="px-4 pt-2">
          <label className="relative block">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              type="search"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder={t("搜索任务、编号、负责人、路径")}
              aria-label={t("搜索任务")}
              className="h-9 w-full appearance-none rounded-xl border border-slate-200/80 bg-white pl-9 pr-9 text-[13px] text-slate-700 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 [&::-webkit-search-cancel-button]:hidden"
            />
            {keyword && (
              <button
                type="button"
                onClick={() => setKeyword("")}
                aria-label={t("清空搜索")}
                className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 active:bg-slate-100 active:text-slate-600"
              >
                <X size={14} />
              </button>
            )}
          </label>
        </div>

        {/* 人员过滤 + 刷新 */}
        <div className="flex items-center gap-2 px-4 pb-2.5 pt-2">
          <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <button
              type="button"
              onClick={() => pickPerson(null)}
              aria-pressed={person === null}
              className={cn(
                "flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-[12px] font-semibold transition active:scale-[0.97]",
                person === null ? "bg-slate-900 text-white" : "bg-white text-slate-500 ring-1 ring-slate-200/70",
              )}
            >
              <Users size={13} />
              {t("全部")}
              <span
                className={cn(
                  "ml-0.5 rounded-full px-1 text-[10px] font-bold",
                  person === null ? "bg-white/20 text-white" : "bg-slate-100 text-slate-400",
                )}
              >
                {activeCount}
              </span>
            </button>
            {owners.map((o) => {
              const active = person === o.name;
              return (
                <button
                  key={o.name}
                  type="button"
                  onClick={() => pickPerson(o.name)}
                  aria-pressed={active}
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 rounded-full py-1 pl-1 pr-2.5 text-[12px] font-semibold transition active:scale-[0.97]",
                    active ? "bg-slate-900 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200/70",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold",
                      active ? "bg-white/20 text-white" : "bg-indigo-50 text-indigo-600",
                    )}
                  >
                    {ownerInitial(o.name)}
                  </span>
                  {/* 「未指派/待指派」是系统占位（比较逻辑用原文），仅显示层本地化；真人名不翻 */}
                  <span className="max-w-[5rem] truncate">{o.name === "未指派" || o.name === "待指派" ? t(o.name) : o.name}</span>
                  <span
                    className={cn(
                      "rounded-full px-1 text-[10px] font-bold",
                      active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-400",
                    )}
                  >
                    {o.count}
                  </span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={reload}
            disabled={loading}
            aria-label={t("刷新")}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-slate-500 ring-1 ring-slate-200/70 active:bg-slate-50 disabled:opacity-60"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* ── 任务瀑布流 ───────────────────────────────────────────────────── */}
      <div className="px-4 pt-3">
        <div className="mb-2.5 flex items-center justify-between">
          <span className="text-[13px] font-bold text-slate-900">
            {filter === "all" && !person && !normalizedKeyword ? t("全部任务") : t("筛选结果")}
          </span>
          <span className="text-[11px] font-semibold text-slate-400">{filteredTasks.length}</span>
        </div>

        {shownTasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2.5 rounded-2xl border border-dashed border-slate-200 bg-white/60 py-14 text-slate-300">
            <Inbox size={30} />
            <span className="text-xs font-medium text-slate-400">{t("没有符合条件的任务")}</span>
          </div>
        ) : (
          // 双列瀑布流：两列各自独立堆叠（非 grid 刚性行对齐），带附件封面的高卡片只撑长
          // 自己那列，不会把同行邻格顶出大片空白。轮转分列(i%2)保证「最新优先」顺排稳定。
          <div className="flex items-start gap-3">
            {[0, 1].map((col) => (
              <div key={col} className="flex min-w-0 flex-1 flex-col gap-3">
                {shownTasks.filter((_, i) => i % 2 === col).map((t, columnIndex) => (
                  <MobileFeedCard
                    key={t.task_id}
                    task={t}
                    isRisk={riskTaskIds.has(t.task_id)}
                    priority={columnIndex === 0}
                    onOpen={() => openTask(t)}
                    onPreview={(images, thumbnails, index) => {
                      pushMobileOverlayState(CARD_IMAGE_OVERLAY);
                      setLightbox({ images, thumbnails, index });
                    }}
                    unreadCount={noteUnread[t.task_id] ?? 0}
                  />
                ))}
              </div>
            ))}
          </div>
        )}

        {visible < filteredTasks.length && (
          <div ref={sentinelRef} className="flex items-center justify-center py-5 text-slate-400">
            <Loader2 className="animate-spin" size={20} />
          </div>
        )}
      </div>

      {/* ── 任务详情（操作留痕 + 图片预览 + 备注）—— 全屏覆盖层 ── */}
      {activeTask && (
        <MobileTaskDetail
          task={activeTask}
          isRisk={riskTaskIds.has(activeTask.task_id)}
          onClose={closeActiveTask}
          onAfterSubmit={handleTaskDataChanged}
          onDiscussionActivity={handleDiscussionActivity}
        />
      )}

      {/* ── 封面缩略图点击放大 —— 页面级灯箱（层级高于详情）── */}
      {lightbox && (
        <ImageLightbox
          images={lightbox.images}
          thumbnails={lightbox.thumbnails}
          startIndex={lightbox.index}
          onClose={() => closeMobileOverlay(CARD_IMAGE_OVERLAY, dismissLightbox)}
        />
      )}

      {/* 常驻于任务页级别，避免讨论轮询/消息卡片重建导致附件预览被卸载。 */}
      <MobileAttachmentPreviewHost />
    </div>
  );
}

// ─── 任务详情覆盖层：操作留痕（含图片附件点击放大）+ 底部备注输入 ──────────────────
const MobileTaskDetail = memo(function MobileTaskDetail({
  task,
  isRisk,
  onClose,
  onAfterSubmit,
  onDiscussionActivity,
}: {
  task: RdTask;
  isRisk: boolean;
  onClose: () => void;
  onAfterSubmit?: () => void;
  onDiscussionActivity?: () => void;
}) {
  const [notes, setNotes] = useState<RdTaskProgressNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [detailTab, setDetailTab] = useState<"conversation" | "progress">("progress");
  const auditActor = useAuditActor("研发成员");

  // ── 评论 @ 提及（移动端呈现：输入框上方横向候选条，点选插入）──────────────
  const draftInputRef = useRef<HTMLTextAreaElement>(null);
  const [people, setPeople] = useState<Array<{ name: string; user_id?: string | null }>>([]);
  useEffect(() => {
    let cancelled = false;
    // 懒加载全员候选：失败静默（仍有任务参与人候选可用）
    fetchRdPeople()
      .then((list) => { if (!cancelled) setPeople(list.map((p) => ({ name: p.name, user_id: p.user_id ?? null }))); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const mentionCandidates = useMemo<MentionCandidate[]>(() => {
    const seen = new Set<string>();
    const out: MentionCandidate[] = [];
    const push = (name?: string | null, userId?: string | null, hint?: string) => {
      const n = (name ?? "").trim();
      if (!n || seen.has(n)) return;
      seen.add(n);
      out.push({ user_id: userId ?? null, name: n, hint });
    };
    push(task.primary_owner, task.primary_owner_user_id, t("主责人"));
    for (const c of task.collaborators ?? []) push(c.name, c.user_id, t("协作人"));
    for (const p of people) push(p.name, p.user_id ?? null);
    return out;
  }, [task.primary_owner, task.primary_owner_user_id, task.collaborators, people]);
  const mention = useMentions({ value: draft, setValue: setDraft, inputRef: draftInputRef, candidates: mentionCandidates });

  const status = STATUS_META[task.status] ?? STATUS_META.draft;
  const owner = (task.primary_owner || "").trim() || t("未指派");

  const loadNotes = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setNotes(await fetchRdTaskProgressNotes(task.task_id));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : t("加载操作留痕失败"));
    } finally {
      setLoading(false);
    }
  }, [task.task_id]);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  useBodyScrollLock(true);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isCurrentMobileOverlay(TASK_DETAIL_OVERLAY)) onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const submitNote = async () => {
    const text = draft.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    try {
      const savedNote = await createRdTaskProgressNote({
        task_id: task.task_id,
        text,
        // @ 提及：仅正文仍包含 @姓名 的才生效
        mentions: mention.mentionsForSubmit(text),
      });
      mention.resetMentions();
      // 同步记一条「进度更新」操作留痕，使 PC 端 rd-task-management 的操作留痕时间线能看到该备注
      // （PC 添加进展时也是这样记的；移动端此前只建了 note、漏了这条 audit，导致 PC 看不到）。
      recordAudit({
        actor: auditActor,
        action: "task.progress_updated",
        resource: { type: "task", id: task.task_id, name: task.title },
        comment: text,
        metadata: { source: "mobile", ...(savedNote?.id ? { note_id: savedNote.id } : {}) },
        source: "web",
      });
      setDraft("");
      toast.success(t("备注已提交"));
      await loadNotes();
      onAfterSubmit?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("提交失败，请重试"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col overscroll-none bg-slate-50" role="dialog" aria-modal="true" aria-label={t("任务详情")}>
      {/* 顶栏：返回 + 标题 + 状态/负责人 */}
      <header className="flex items-center gap-1.5 border-b border-slate-200 bg-white px-2 pb-1.5 pt-[max(0.375rem,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={onClose}
          aria-label="返回"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-500 active:bg-slate-100"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-bold text-slate-900">{task.title}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px]">
            <span className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-semibold", status.tint)}>
              <span className={cn("h-1.5 w-1.5 rounded-full", status.dot)} />
              {status.label}
            </span>
            <span className="min-w-0 truncate text-slate-400">{owner}</span>
            {isRisk && (
              <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-red-50 px-1.5 py-0.5 font-bold text-red-600">
                <AlertTriangle size={10} />
                {t("风险")}
</span>
            )}
          </div>
        </div>
      </header>

      <nav className="grid shrink-0 grid-cols-2 gap-1 border-b border-slate-200 bg-white px-3 py-1.5" aria-label={t("任务详情视图")}>
        {([
          { key: "progress", label: t("进度留痕"), icon: History },
          { key: "conversation", label: t("任务讨论"), icon: MessageCircleMore },
        ] as const).map((item) => {
          const Icon = item.icon;
          const active = detailTab === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setDetailTab(item.key)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-9 items-center justify-center gap-1.5 rounded-xl text-xs font-bold transition-colors",
                active ? "bg-indigo-50 text-indigo-700" : "text-slate-500 active:bg-slate-50",
              )}
            >
              <Icon size={14} />
              {item.label}
            </button>
          );
        })}
      </nav>

      {detailTab === "conversation" && (
        <RDTaskConversation
          taskId={task.task_id}
          taskTitle={task.title}
          notes={notes}
          mode="task"
          variant="mobile"
          onActivity={onDiscussionActivity}
        />
      )}

      {detailTab === "progress" && (
        <RDTaskConversation
          taskId={task.task_id}
          taskTitle={task.title}
          notes={notes}
          mode="progress"
          variant="mobile"
          notesLoading={loading}
          notesError={loadError}
          onRetryNotes={() => void loadNotes()}
          onActivity={onDiscussionActivity}
          progressComposer={(
            <div className="border-t border-slate-200 bg-white px-3 py-2 [padding-bottom:calc(0.5rem+env(safe-area-inset-bottom))]">
              <MentionSuggestionPanel
                open={mention.open}
                candidates={mention.filtered}
                highlightIndex={mention.highlightIndex}
                onPick={mention.pick}
                variant="mobile"
              />
              <div className="flex items-end gap-2">
                <textarea
                  ref={draftInputRef}
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    mention.syncActiveQuery();
                  }}
                  onKeyUp={mention.syncActiveQuery}
                  onClick={mention.syncActiveQuery}
                  rows={1}
                  aria-label={t("记录新进展")}
                  placeholder={t("记录新进展，@ 提及成员…")}
                  className="max-h-28 min-h-11 flex-1 resize-none rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-[14px] leading-snug text-slate-800 outline-none placeholder:text-slate-400 focus:border-indigo-300 focus:bg-white focus:ring-4 focus:ring-indigo-50"
                />
                <button
                  type="button"
                  onClick={submitNote}
                  disabled={!draft.trim() || submitting}
                  className="flex h-11 shrink-0 cursor-pointer items-center gap-1 rounded-full bg-indigo-600 px-4 text-sm font-semibold text-white transition-colors active:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {submitting ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                  {t("留痕")}
                </button>
              </div>
            </div>
          )}
        />
      )}
    </div>
  );
});
