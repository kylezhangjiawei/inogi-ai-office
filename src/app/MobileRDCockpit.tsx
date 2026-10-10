import { Button } from "./components/ui/button";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Activity, AlertTriangle, ArrowLeft, CheckCircle2, ClipboardList, Clock, GitBranch, History, ImageIcon, Inbox, Info, Loader2, MessageCircleMore, Paperclip, RefreshCw, Search, Users, X } from "lucide-react";
import { useLocation, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { cn } from "./components/ui/utils";
import { MobileZoomableImage } from "./components/MobileZoomableImage";
import { t, useI18n } from "./lib/i18n";
import { useRDCockpitData } from "./hooks/useRDCockpitData";
import { daysUntilDue } from "./lib/taskDue";
import { memberIdentityKey } from "./lib/rdMemberIdentity";
import { procurementWorkspaceReturnPath } from "./lib/procurementWorkspaceNavigation";
import { rdWorkspaceReturnPath } from "./lib/rdWorkspaceNavigation";
import {
  fetchRdNoteUnreadSummary,
  currentRdWorkspace,
  fetchRdTaskProgressNoteGroup,
  markRdTaskNotesRead,
  type RdCategory,
  type RdTask,
  type RdTaskProgressAttachment,
  type RdTaskProgressNote,
  type RdTaskProgressGroupTask,
  type RdTaskStatus,
} from "./lib/rdApi";
import { RDTaskConversation } from "./RDTaskConversation";
import { MobileAttachmentPreviewHost, openMobileAttachmentPreview, ProgressAttachmentGrid } from "./RDProgressEvidence";
import { TechnicalDocumentsPanel } from "./rd/TechnicalDocumentsPanel";
import { getAuditActionMeta, useAuditLogs } from "./lib/auditLog";
import { ProcurementActivitySection, useProcurementTaskLink } from "./procurement/components/rdInsertion";
import {
  closeMobileOverlay,
  pushMobileOverlayState,
  useBodyScrollLock,
  useMobileOverlayBack,
} from "./hooks/useMobileOverlay";
import { useModalFocus } from "./hooks/useModalFocus";
import { Input } from "./components/ui/input";

const MOBILE_DATA_REFRESH_INTERVAL_MS = 15_000;
const CARD_IMAGE_OVERLAY = "rd-mobile-card-image";

// ─── 文案 / 配色映射（移动端自带一份，与桌面同口径、样式独立）────────────────────
const STATUS_META: Record<RdTaskStatus, { label: string; dot: string; tint: string }> = {
  draft: { label: "草稿", dot: "bg-slate-400", tint: "bg-slate-100 text-slate-500" },
  in_progress: { label: "进行中", dot: "bg-primary", tint: "bg-blue-50 text-primary" },
  paused_leave: { label: "请假", dot: "bg-amber-500", tint: "bg-amber-50 text-amber-600" },
  paused_blocked: { label: "阻塞", dot: "bg-red-500", tint: "bg-red-50 text-red-600" },
  completed: { label: "已完成", dot: "bg-emerald-500", tint: "bg-emerald-50 text-emerald-600" },
  pending_assign: { label: "待指派", dot: "bg-amber-500", tint: "bg-amber-50 text-amber-700" },
  pending_review: { label: "待审核", dot: "bg-primary", tint: "bg-blue-50 text-primary" },
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
/** 「未指派」筛选桶的哨兵键，与 memberIdentityKey 产生的键不会冲突。 */
const UNASSIGNED_KEY = "__unassigned__";

/** 与桌面驾驶舱、个人工作台同源。原实现用 toISOString() 取 UTC 日期，UTC+8 每天 0–8 点会整体错一天。 */
function daysLeft(due?: string): number | null {
  return daysUntilDue(due);
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
  return "bg-primary";
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

type MobileTaskIndex = {
  byId: Map<string, RdTask>;
};

function buildMobileTaskIndex(categories: RdCategory[]): MobileTaskIndex {
  const byId = new Map<string, RdTask>();
  const visit = (task: RdTask): void => {
    byId.set(task.task_id, task);
    for (const child of task.subtasks ?? []) visit(child);
  };
  for (const category of categories) {
    for (const subProject of category.children) {
      for (const task of subProject.tasks) visit(task);
    }
  }
  return { byId };
}

function mobileWorkspaceBase(pathname: string): "/m" | "/us-collab-m" | "/production-m" {
  if (pathname.startsWith("/us-collab-m")) return "/us-collab-m";
  if (pathname.startsWith("/production-m")) return "/production-m";
  return "/m";
}

function priorityLabel(task: RdTask): string {
  const priority = task.final_priority ?? task.ai_priority;
  if (priority === "high") return t("高优先");
  if (priority === "low") return t("低优先");
  return t("中优先");
}

function formatFullDate(value?: string): string {
  const text = value?.trim();
  if (!text) return "—";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return text;
  return parsed.toLocaleString();
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
  const dialogRef = useModalFocus<HTMLDivElement>(true, onClose);

  const safeIdx = Math.min(Math.max(idx, 0), images.length - 1);
  const current = images[safeIdx];

  return createPortal(
    <div
      ref={dialogRef}
      className="horizon-theme fixed inset-0 z-50 flex h-dvh min-w-0 flex-col overflow-x-hidden overscroll-none bg-slate-950/95"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rd-mobile-image-preview-title"
      tabIndex={-1}
    >
      <h2 id="rd-mobile-image-preview-title" className="sr-only">{t("图片预览")}</h2>
      <div className="flex shrink-0 items-center justify-between px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-white/90">
        <span className="text-xs tabular-nums">
          {safeIdx + 1} / {images.length}
        </span>
        <Button variant="unstyled"
          type="button"
          onClick={onClose}
          aria-label="关闭预览"
          data-dialog-autofocus
          className="flex size-11 items-center justify-center rounded-xl bg-white/10 active:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <X size={20} />
        </Button>
      </div>
      <div
        className={cn(
          "flex min-h-0 flex-1 items-center justify-center px-4",
          images.length > 1 ? "pb-4" : "pb-[max(1rem,env(safe-area-inset-bottom))]",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <MobileZoomableImage
          src={current}
          alt="附件预览"
          loading="eager"
          decoding="async"
          className="h-full w-full"
          imageClassName="rounded-lg"
          controlsClassName={images.length > 1 ? "!bottom-20" : undefined}
        />
      </div>
      {images.length > 1 && (
        <div
          className="flex shrink-0 gap-2 overflow-x-auto px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {images.map((u, i) => (
            <Button variant="unstyled"
              key={`${u}-${i}`}
              type="button"
              onClick={() => setIdx(i)}
              aria-label={t("查看第 {n} 张图片", { n: i + 1 })}
              aria-current={i === safeIdx ? "true" : undefined}
              className={cn(
                "size-14 shrink-0 overflow-hidden rounded-lg ring-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950",
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
            </Button>
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}

// ─── 瀑布流卡片（竖向：状态 + 标签 → 标题 → 最新进展 → 封面 → 进度 → 负责人行）──────
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
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        "block min-w-0 w-full cursor-pointer overflow-hidden rounded-2xl border bg-white text-left shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
        isRisk ? "border-red-200" : "border-slate-200/70",
      )}
    >
      {/* 顶部：状态胶囊 + 话题标签 + 评分 + 风险。
          话题标签是这行唯一可伸缩的元素（flex-1 基准宽为 0），两侧胶囊都是 shrink-0，
          卡片仅约 140px 内宽时它会被压到 25px、只剩一个「#」。给它一个最小宽度，
          配合 flex-wrap：放得下就同排，放不下让右侧胶囊换到第二行，而不是把标签压没。 */}
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 px-3 pt-3">
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
            status.tint,
          )}
        >
          <span className={cn("size-1.5 rounded-full", status.dot)} />
          {t(status.label)}
        </span>
        <span className="min-w-[3.5rem] flex-1 truncate text-[11px] font-medium text-muted-foreground">
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


      {/* 标题 */}
      <h3 className="px-3 pt-2.5 text-balance text-sm font-semibold leading-6 text-slate-900 line-clamp-3 break-words">
        {task.title}
      </h3>

      {/* 最新进展（部分任务有 → 制造瀑布高度差）*/}
      {summary && (
        <p className="px-3 pt-1.5 text-pretty text-xs leading-5 text-slate-500 line-clamp-2 break-words">
          {summary}
        </p>
      )}

      {/* 封面：放在进度条上方，点击放大预览（阻止冒泡，避免误开详情）*/}
      {cover.length > 0 && (
        <Button variant="unstyled"
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPreview(cover, coverThumbnails, 0);
          }}
          aria-label="预览附件图片"
          className="mt-2.5 block min-h-11 w-full px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
        >
          <div className="relative overflow-hidden rounded-xl bg-slate-100">
            <img
              src={coverThumbnails[0] ?? cover[0]}
              alt="附件封面"
              loading={priority ? "eager" : "lazy"}
              decoding="async"
              className="aspect-[4/3] max-h-40 w-full object-cover"
            />
            {cover.length > 1 && (
              <span className="absolute bottom-1.5 right-1.5 inline-flex items-center gap-1 rounded-full bg-slate-900/80 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                <ImageIcon size={10} />
                {cover.length}
              </span>
            )}
          </div>
        </Button>
      )}

      {/* 进度 */}
      <div className="flex items-center gap-2 px-3 pt-2.5">
        <div
          className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100"
          role="progressbar"
          aria-label={t("任务完成进度")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
        >
          <div
            className={cn("h-full rounded-full", progressColor(task.status))}
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="shrink-0 text-[11px] font-bold tabular-nums text-slate-500">{progress}%</span>
      </div>

      {/* 负责人行（小红书作者行）+ 最近活动时间 */}
      <div className="mt-2.5 border-t border-slate-100 px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-primary">
            {ownerInitial(owner)}
          </span>
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-slate-500">{owner}</span>
          {isHigh && (
            <span className="shrink-0 rounded bg-red-50 px-1 text-[10px] font-bold text-red-500">{t("高")}</span>
          )}
          {due && (
            <span className={cn("shrink-0 text-[11px]", due.overdue ? "font-bold text-red-500" : "text-muted-foreground")}>
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
  const location = useLocation();
  const navigate = useNavigate();
  const { taskId: routeTaskId } = useParams<{ taskId: string }>();
  const { categories, loading, error, reload, risks, allTasks, personLoads } = useRDCockpitData();
  const workspaceBase = mobileWorkspaceBase(location.pathname);
  const procurementReturnPath = workspaceBase === "/m" ? procurementWorkspaceReturnPath(location.state) : null;
  const workspaceReturnPath = workspaceBase === "/m" ? rdWorkspaceReturnPath(location.state) : null;
  const detailReturnPath = procurementReturnPath ?? workspaceReturnPath ?? workspaceBase;
  const detailReturnLabel = procurementReturnPath ? t("返回采购工作台") : workspaceReturnPath ? t("返回工作台") : t("返回驾驶舱");
  const taskReturnState = useMemo(() => procurementReturnPath || workspaceReturnPath ? {
    ...(procurementReturnPath ? { procurementWorkspaceReturn: procurementReturnPath } : {}),
    ...(workspaceReturnPath ? { rdWorkspaceReturn: workspaceReturnPath } : {}),
  } : undefined, [procurementReturnPath, workspaceReturnPath]);
  const workspaceMeta = workspaceBase === "/us-collab-m"
    ? {
        eyebrow: t("中美协同工作区"),
        title: t("协同任务总览"),
        description: t("集中查看跨区域任务、责任人和最新进展。"),
      }
    : workspaceBase === "/production-m"
      ? {
          eyebrow: t("生产协同工作区"),
          title: t("生产任务总览"),
          description: t("跟踪生产协同任务、同步状态和交付风险。"),
        }
      : {
          eyebrow: t("研发工作区"),
          title: t("研发任务总览"),
          description: t("聚合研发任务、人员负载和风险进展。"),
        };
  const taskIndex = useMemo(() => buildMobileTaskIndex(categories), [categories]);
  const activeTask = routeTaskId ? taskIndex.byId.get(routeTaskId) ?? null : null;

  const [filter, setFilter] = useState<MobileFilter>("all");
  // 存身份主键而非姓名：同名同事必须能分开筛选。
  const [person, setPerson] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [visible, setVisible] = useState(TASK_PAGE);
  // 灯箱状态提升到页面级：避免在 columns 多列容器里渲染 fixed 元素的布局怪相，
  // 也避免灯箱作为卡片子节点时 onClick 经 React 树冒泡回卡片误开详情。
  const [lightbox, setLightbox] = useState<{ images: string[]; thumbnails: string[]; index: number } | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Keep task facts fresh while the mobile shell remains mounted. The detail
  // route derives from this response, so a desktop edit replaces the visible
  // mobile task object instead of leaving a stale open-time snapshot behind.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") reload();
    };
    const interval = window.setInterval(refresh, MOBILE_DATA_REFRESH_INTERVAL_MS);
    window.addEventListener("focus", refresh);
    window.addEventListener("rd:task-updated", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("rd:task-updated", refresh);
    };
  }, [reload]);

  const riskTaskIds = useMemo(() => new Set(risks.map((r) => r.task.task_id)), [risks]);

  // 非归档任务总数（人员「全部」标记用）
  const activeCount = useMemo(() => allTasks.filter((t) => !t.archived).length, [allTasks]);

  // 人员过滤项直接复用 personLoads —— 与桌面驾驶舱的头像角标同一份计算：
  // 只保留人员目录里配置的成员（不再把「采购 / 研发团队 / 系统 / 待指派」当成人），
  // 按身份主键区分同名同事，且只统计活跃（非归档未完成）根任务。
  // 「未指派」单独保留成一个桶：它不是人，但移动端确实要能筛出无主任务。
  // 计数必须与 filteredTasks 用同一个任务集合（非归档，含已完成）——移动端有「已完成」状态页签，
  // 若 chip 只数活跃任务，点进去看到的条数会比 chip 上的数字多。personLoads 只决定「谁出现」。
  const owners = useMemo(() => {
    const counts = new Map<string, number>();
    let unassigned = 0;
    for (const task of allTasks) {
      if (task.archived) continue;
      const primaryName = (task.primary_owner || "").trim();
      if (!primaryName) unassigned += 1;
      const memberKeys = new Set<string>();
      if (primaryName) memberKeys.add(memberIdentityKey(primaryName, task.primary_owner_user_id));
      for (const collaborator of task.collaborators ?? []) {
        const collaboratorName = collaborator.name.trim();
        if (collaboratorName) memberKeys.add(memberIdentityKey(collaboratorName, collaborator.user_id));
      }
      for (const key of memberKeys) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const list = personLoads
      .map((load) => ({ key: load.key, name: load.name, count: counts.get(load.key) ?? 0 }))
      .filter((row) => row.count > 0)
      .sort((a, b) => b.count - a.count);
    if (unassigned > 0) list.push({ key: UNASSIGNED_KEY, name: t("未指派"), count: unassigned });
    return list;
  }, [allTasks, personLoads]);

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
    if (person === UNASSIGNED_KEY) {
      list = list.filter((t) => !(t.primary_owner || "").trim());
    } else if (person) {
      list = list.filter((task) =>
        memberIdentityKey(task.primary_owner, task.primary_owner_user_id) === person
        || (task.collaborators ?? []).some(
          (collaborator) => memberIdentityKey(collaborator.name, collaborator.user_id) === person,
        ),
      );
    }
    if (normalizedKeyword) {
      list = list.filter((task) =>
        [
          task.title,
          task.task_id,
          (task.primary_owner || "").trim() || "未指派",
          ...(task.collaborators ?? []).map((collaborator) => collaborator.name),
          task.category_path,
        ]
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

  const dismissLightbox = useCallback(() => setLightbox(null), []);
  const closeActiveTask = useCallback(() => navigate(detailReturnPath), [detailReturnPath, navigate]);
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
  const resetFilters = () => {
    setFilter("all");
    setPerson(null);
    setKeyword("");
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
  const handleDiscussionActivity = useCallback(() => {
    void refreshNoteUnread();
  }, [refreshNoteUnread]);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void refreshNoteUnread();
    };
    const interval = window.setInterval(refresh, MOBILE_DATA_REFRESH_INTERVAL_MS);
    void refreshNoteUnread();
    window.addEventListener("focus", refresh);
    window.addEventListener("rd:discussion-updated", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("rd:discussion-updated", refresh);
    };
  }, [refreshNoteUnread]);

  const openTask = useCallback((task: RdTask) => {
    void reload();
    navigate(`${workspaceBase}/task/${encodeURIComponent(task.task_id)}`, { state: taskReturnState });
    // Formal progress is displayed for the full relation group. The API marks
    // that same group read; discussion threads retain their own read receipts.
    void markRdTaskNotesRead(task.task_id)
      .catch(() => {})
      .finally(() => { void refreshNoteUnread(); });
  }, [navigate, refreshNoteUnread, reload, taskReturnState, workspaceBase]);

  const openTaskById = useCallback((taskId: string) => {
    void reload();
    navigate(`${workspaceBase}/task/${encodeURIComponent(taskId)}${workspaceBase === "/m" ? location.search : ""}`, { state: taskReturnState });
  }, [location.search, navigate, reload, taskReturnState, workspaceBase]);

  // 首屏加载 / 错误（仅当还没有任何数据时占满）
  if (loading && allTasks.length === 0) {
    return (
      <div
        className="horizon-theme hz-page flex min-h-[70dvh] min-w-0 w-full flex-col overflow-x-clip bg-background px-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-4"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="h-3 w-24 rounded bg-blue-100" />
          <div className="mt-3 h-6 w-44 rounded bg-slate-200" />
          <div className="mt-2 h-3 w-full max-w-72 rounded bg-slate-100" />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3" aria-hidden="true">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="h-44 rounded-2xl border border-slate-200 bg-white shadow-sm" />
          ))}
        </div>
        <span className="sr-only">{t("正在加载驾驶舱…")}</span>
      </div>
    );
  }
  if (error && allTasks.length === 0) {
    return (
      <div className="horizon-theme hz-page flex min-h-[70dvh] min-w-0 w-full flex-col items-center justify-center gap-4 overflow-x-clip bg-background px-8 pb-[max(2.5rem,env(safe-area-inset-bottom))] text-center" role="alert">
        <AlertTriangle className="text-red-400" size={30} />
        <div>
          <h1 className="text-balance text-base font-semibold text-slate-950">{t("驾驶舱加载失败")}</h1>
          <p className="mt-1 text-pretty text-sm text-slate-500">{error}</p>
        </div>
        <Button
          type="button"
          onClick={reload}
          className="inline-flex min-h-11 items-center justify-center rounded-xl px-7 text-sm font-semibold active:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          {t("重试")}
        </Button>
      </div>
    );
  }

  return (
    <div className="horizon-theme hz-page min-h-[70dvh] min-w-0 w-full overflow-x-clip bg-background pb-[max(2.5rem,env(safe-area-inset-bottom))]">
      <header className="border-b border-slate-200 bg-white px-4 py-4" aria-labelledby="mobile-rd-cockpit-title">
        <p className="text-[11px] font-semibold text-primary">{workspaceMeta.eyebrow}</p>
        <div className="mt-1 flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 id="mobile-rd-cockpit-title" className="text-balance text-lg font-semibold leading-6 text-slate-950">
              {workspaceMeta.title}
            </h1>
            <p className="mt-1 text-pretty text-xs leading-5 text-slate-500">{workspaceMeta.description}</p>
          </div>
          <div className="shrink-0 rounded-xl border border-primary/10 bg-accent px-3 py-2 text-right">
            <div className="text-lg font-semibold leading-none tabular-nums text-primary">{activeCount}</div>
            <div className="mt-1 text-[10px] font-medium text-slate-500">{t("当前任务")}</div>
          </div>
        </div>
      </header>

      {/* ── 页头过滤区（吸顶）────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 border-b border-slate-200 bg-white">
        {/* 状态过滤：手机宽度固定五等分，避免末项被刷新按钮挤出视口。 */}
        <div className="grid grid-cols-5 gap-1.5 px-3 pt-3 sm:flex sm:gap-2 sm:px-4">
          {FILTERS.map((f) => (
            <Button variant="unstyled"
              key={f.key}
              type="button"
              onClick={() => pickStatus(f.key)}
              aria-pressed={filter === f.key}
              className={cn(
                "min-h-11 min-w-0 whitespace-nowrap rounded-xl px-1 text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 sm:shrink-0 sm:px-3.5 sm:text-[13px]",
                filter === f.key
                  ? "bg-primary text-white shadow-sm"
                  : "bg-white text-slate-500 ring-1 ring-slate-200/70 active:bg-slate-50",
              )}
            >
              {t(f.label)}
            </Button>
          ))}
        </div>

        {/* 本地任务搜索：与状态、人员筛选叠加，不改变接口与其它驾驶舱逻辑。 */}
        <div className="px-4 pt-2">
          <label className="relative block">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder={t("搜索任务、编号、负责人、路径")}
              aria-label={t("搜索任务")}
              className="h-11 w-full appearance-none rounded-xl border border-slate-200 bg-white pl-9 pr-12 text-[13px] text-slate-700 shadow-sm outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 [&::-webkit-search-cancel-button]:hidden"
            />
            {keyword && (
              <Button variant="unstyled"
                type="button"
                onClick={() => setKeyword("")}
                aria-label={t("清空搜索")}
                className="absolute right-0 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-xl text-muted-foreground active:bg-slate-100 active:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
              >
                <X size={14} />
              </Button>
            )}
          </label>
        </div>

        {/* 人员过滤 + 刷新 */}
        <div className="flex items-center gap-2 px-4 pb-2.5 pt-2">
          <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <Button variant="unstyled"
              type="button"
              onClick={() => pickPerson(null)}
              aria-pressed={person === null}
              className={cn(
                "flex min-h-11 shrink-0 items-center gap-1 rounded-xl px-3 text-[12px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1",
                person === null ? "bg-primary text-white" : "bg-white text-slate-500 ring-1 ring-slate-200/70",
              )}
            >
              <Users size={13} />
              {t("全部")}
              <span
                className={cn(
                  "ml-0.5 rounded-full px-1 text-[10px] font-bold",
                  person === null ? "bg-white/20 text-white" : "bg-slate-100 text-muted-foreground",
                )}
              >
                {activeCount}
              </span>
            </Button>
            {owners.map((o) => {
              const active = person === o.key;
              return (
                <Button variant="unstyled"
                  key={o.key}
                  type="button"
                  onClick={() => pickPerson(o.key)}
                  aria-pressed={active}
                  className={cn(
                    "flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl py-1 pl-1.5 pr-2.5 text-[12px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1",
                    active ? "bg-primary text-white" : "bg-white text-slate-600 ring-1 ring-slate-200/70",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-7 items-center justify-center rounded-lg text-[10px] font-bold",
                      active ? "bg-white/15 text-white" : "bg-accent text-primary",
                    )}
                  >
                    {ownerInitial(o.name)}
                  </span>
                  {/* 「未指派/待指派」是系统占位（比较逻辑用原文），仅显示层本地化；真人名不翻 */}
                  <span className="max-w-[5rem] truncate">{o.name === "未指派" || o.name === "待指派" ? t(o.name) : o.name}</span>
                  <span
                    className={cn(
                      "rounded-full px-1 text-[10px] font-bold",
                      active ? "bg-white/20 text-white" : "bg-slate-100 text-muted-foreground",
                    )}
                  >
                    {o.count}
                  </span>
                </Button>
              );
            })}
          </div>
          <Button variant="unstyled"
            type="button"
            onClick={reload}
            disabled={loading}
            aria-label={t("刷新")}
            className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white text-primary ring-1 ring-slate-200 active:bg-accent disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
          >
            <RefreshCw size={14} className={loading ? "animate-spin motion-reduce:animate-none" : ""} />
          </Button>
        </div>
      </div>

      {error && allTasks.length > 0 ? (
        <div role="status" className="mx-4 mt-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          <AlertTriangle size={14} className="shrink-0" />
          <span className="min-w-0 flex-1">{t("刷新失败，当前显示上次同步的数据")}</span>
          <Button variant="unstyled"
            type="button"
            onClick={reload}
            className="min-h-11 shrink-0 rounded-lg bg-white px-3 font-semibold text-amber-800 ring-1 ring-amber-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          >
            {t("重试")}
          </Button>
        </div>
      ) : null}

      {/* ── 任务瀑布流 ───────────────────────────────────────────────────── */}
      <div className="px-4 pt-3">
        <div className="mb-2.5 flex items-center justify-between">
          <span className="text-[13px] font-bold text-slate-900">
            {filter === "all" && !person && !normalizedKeyword ? t("全部任务") : t("筛选结果")}
          </span>
          <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">{filteredTasks.length}</span>
        </div>

        {shownTasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2.5 rounded-2xl border border-dashed border-slate-200 bg-white px-5 py-12 text-center text-muted-foreground">
            <Inbox size={30} />
            <span className="text-pretty text-xs font-medium text-slate-500">{t("没有符合条件的任务")}</span>
            <Button variant="unstyled"
              type="button"
              onClick={allTasks.length > 0 ? resetFilters : reload}
              className="mt-1 inline-flex min-h-11 items-center justify-center rounded-xl border border-primary/20 bg-accent px-4 text-xs font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              {allTasks.length > 0 ? t("清除筛选") : t("重新加载")}
            </Button>
          </div>
        ) : (
          // 双列独立堆叠，封面和长内容只撑高所在列；轮转分列保持最新任务顺序。
          <div className="flex items-start gap-3">
            {[0, 1].map((column) => (
              <div key={column} className="flex min-w-0 flex-1 flex-col gap-3">
                {shownTasks.filter((_, index) => index % 2 === column).map((task, columnIndex) => (
                  <MobileFeedCard
                    key={task.task_id}
                    task={task}
                    isRisk={riskTaskIds.has(task.task_id)}
                    priority={columnIndex === 0}
                    onOpen={() => openTask(task)}
                    onPreview={(images, thumbnails, imageIndex) => {
                      pushMobileOverlayState(CARD_IMAGE_OVERLAY);
                      setLightbox({ images, thumbnails, index: imageIndex });
                    }}
                    unreadCount={noteUnread[task.task_id] ?? 0}
                  />
                ))}
              </div>
            ))}
          </div>
        )}

        {visible < filteredTasks.length && (
          <div ref={sentinelRef} className="flex items-center justify-center py-5 text-muted-foreground">
            <Loader2 className="animate-spin motion-reduce:animate-none" size={20} />
          </div>
        )}
      </div>

      {/* ── 任务详情（操作留痕 + 图片预览 + 备注）—— 全屏覆盖层 ── */}
      {activeTask && (
        <MobileTaskDetail
          task={activeTask}
          key={activeTask.task_id}
          isRisk={riskTaskIds.has(activeTask.task_id)}
          onClose={closeActiveTask}
          returnLabel={detailReturnLabel}
          onOpenTask={openTaskById}
          onDiscussionActivity={handleDiscussionActivity}
        />
      )}
      {routeTaskId && !activeTask && !loading && (
        <MissingTaskDialog taskId={routeTaskId} onClose={closeActiveTask} returnLabel={detailReturnLabel} />
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

function MissingTaskDialog({ taskId, onClose, returnLabel }: { taskId: string; onClose: () => void; returnLabel: string }) {
  useBodyScrollLock(true);
  const dialogRef = useModalFocus<HTMLDivElement>(true, onClose);

  return (
    <div
      ref={dialogRef}
      className="horizon-theme fixed inset-0 z-40 flex h-dvh min-w-0 flex-col items-center justify-center gap-4 overflow-x-hidden bg-background px-8 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] text-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rd-mobile-missing-task-title"
      aria-describedby="rd-mobile-missing-task-id"
      tabIndex={-1}
    >
      <span className="flex size-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
        <AlertTriangle size={26} />
      </span>
      <div>
        <h2 id="rd-mobile-missing-task-title" className="text-balance text-base font-semibold text-slate-950">
          {t("任务不存在或无权访问")}
        </h2>
        <p id="rd-mobile-missing-task-id" className="mt-1 break-all text-xs tabular-nums text-slate-500">{taskId}</p>
      </div>
      <Button
        type="button"
        onClick={onClose}
        data-dialog-autofocus
        className="inline-flex min-h-11 items-center justify-center rounded-xl px-6 text-sm font-semibold active:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      >
        {returnLabel}
      </Button>
    </div>
  );
}

// ─── 任务详情覆盖层：操作留痕（含图片附件点击放大）+ 卡片内留言 ──────────────────
const MobileTaskDetail = memo(function MobileTaskDetail({
  task,
  isRisk,
  onClose,
  returnLabel,
  onOpenTask,
  onDiscussionActivity,
}: {
  task: RdTask;
  isRisk: boolean;
  onClose: () => void;
  returnLabel: string;
  onOpenTask: (taskId: string) => void;
  onDiscussionActivity?: () => void;
}) {
  const location = useLocation();
  const [notes, setNotes] = useState<RdTaskProgressNote[]>([]);
  const technicalDocumentsEnabled = currentRdWorkspace() === null;
  const [groupNotes, setGroupNotes] = useState<RdTaskProgressNote[]>([]);
  const [groupTasks, setGroupTasks] = useState<RdTaskProgressGroupTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const noteRequestRef = useRef<AbortController | null>(null);
  const [detailTab, setDetailTab] = useState<"overview" | "progress" | "conversation" | "attachments" | "activity">(() => technicalDocumentsEnabled && new URLSearchParams(location.search).get("tab") === "conversation" ? "conversation" : "progress");
  useEffect(() => {
    if (technicalDocumentsEnabled) setDetailTab(new URLSearchParams(location.search).get("tab") === "conversation" ? "conversation" : "progress");
  }, [location.search, task.task_id, technicalDocumentsEnabled]);
  const allTaskAuditLogs = useAuditLogs({ resourceType: "task" });
  const { task: procurementTask } = useProcurementTaskLink(task.task_id);
  const dialogRef = useModalFocus<HTMLDivElement>(true, onClose);

  const status = STATUS_META[task.status] ?? STATUS_META.draft;
  const owner = (task.primary_owner || "").trim() || t("未指派");

  const loadNotes = useCallback(async (showLoading = true) => {
    noteRequestRef.current?.abort();
    const controller = new AbortController();
    noteRequestRef.current = controller;
    if (showLoading) setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchRdTaskProgressNoteGroup(task.task_id, controller.signal);
      if (controller.signal.aborted) return;
      setGroupTasks(data.tasks);
      setGroupNotes(data.notes);
      setNotes(data.notes.filter((note) => (note.source_task?.task_id ?? note.task_id) === task.task_id));
      void markRdTaskNotesRead(task.task_id).catch(() => {}).finally(onDiscussionActivity);
    } catch (e) {
      if (controller.signal.aborted) return;
      setLoadError(e instanceof Error ? e.message : t("加载操作留痕失败"));
    } finally {
      if (noteRequestRef.current === controller) {
        noteRequestRef.current = null;
        setLoading(false);
      }
    }
  }, [onDiscussionActivity, task.task_id]);

  useEffect(() => {
    void loadNotes();
    return () => noteRequestRef.current?.abort();
  }, [loadNotes]);

  useBodyScrollLock(true);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void loadNotes(false);
    };
    const interval = window.setInterval(refresh, MOBILE_DATA_REFRESH_INTERVAL_MS);
    window.addEventListener("focus", refresh);
    window.addEventListener("rd:discussion-updated", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("rd:discussion-updated", refresh);
    };
  }, [loadNotes]);

  const groupTaskIds = useMemo(
    () => new Set([task.task_id, ...groupTasks.map((groupTask) => groupTask.task_id)]),
    [groupTasks, task.task_id],
  );
  const attachments = useMemo(() => {
    const seen = new Set<string>();
    return groupNotes.flatMap((note) => note.attachments ?? []).filter((attachment) => {
      const key = attachment.object_key ?? attachment.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }) as RdTaskProgressAttachment[];
  }, [groupNotes]);
  const auditLogs = useMemo(
    () => allTaskAuditLogs
      .filter((log) => groupTaskIds.has(log.resource.id))
      .sort((left, right) => right.timestamp.localeCompare(left.timestamp)),
    [allTaskAuditLogs, groupTaskIds],
  );
  const workItems = task.work_items ?? [];
  const completedWorkItems = workItems.filter((item) => item.done).length;

  return (
    <div
      ref={dialogRef}
      className="horizon-theme fixed inset-0 z-40 flex h-dvh min-w-0 flex-col overflow-x-hidden overscroll-none bg-background"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rd-mobile-task-detail-title"
      tabIndex={-1}
    >
      {/* 顶栏：返回 + 标题 + 状态/负责人 */}
      <header className="flex min-w-0 items-center gap-1.5 border-b border-slate-200 bg-white px-2 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <Button variant="unstyled"
          type="button"
          onClick={onClose}
          aria-label={returnLabel}
          data-dialog-autofocus
          className="flex size-11 shrink-0 items-center justify-center rounded-xl text-slate-500 active:bg-accent active:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <ArrowLeft size={20} />
        </Button>
        <div className="min-w-0 flex-1">
          <h2 id="rd-mobile-task-detail-title" className="line-clamp-1 text-balance text-[15px] font-semibold text-slate-950">{task.title}</h2>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px]">
            <span className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-semibold", status.tint)}>
              <span className={cn("size-1.5 rounded-full", status.dot)} />
              {t(status.label)}
            </span>
            <span className="min-w-0 truncate text-muted-foreground">{owner}</span>
            {isRisk && (
              <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-red-50 px-1.5 py-0.5 font-bold text-red-600">
                <AlertTriangle size={10} />
                {t("风险")}
              </span>
            )}
          </div>
        </div>
      </header>

      <nav className="grid shrink-0 grid-cols-5 gap-1 border-b border-slate-200 bg-white px-2 py-1.5" aria-label={t("任务详情视图")}>
        {([
          { key: "progress", label: t("进度留痕"), icon: History },
          { key: "overview", label: t("任务概览"), icon: Info },
          { key: "conversation", label: t("任务讨论"), icon: MessageCircleMore },
          { key: "attachments", label: technicalDocumentsEnabled ? t("资料与附件") : t("附件库"), icon: Paperclip },
          { key: "activity", label: t("操作记录"), icon: Activity },
        ] as const).map((item) => {
          const Icon = item.icon;
          const active = detailTab === item.key;
          return (
            <Button variant="unstyled"
              key={item.key}
              type="button"
              onClick={() => setDetailTab(item.key)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-1 py-2 text-center text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary",
                active ? "bg-accent text-primary" : "text-slate-500 active:bg-slate-50",
              )}
            >
              <Icon size={14} />
              <span className="max-w-full break-words text-balance">{item.label}</span>
            </Button>
          );
        })}
      </nav>

      {detailTab === "overview" && (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {task.production_sync && (
            <section className="rounded-2xl border border-blue-200 bg-blue-50 p-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                <GitBranch size={15} />
                {t("研发同步只读任务")}
              </div>
              <div className="mt-1 text-pretty text-xs leading-relaxed text-blue-700">
                {t("源任务")}：{task.production_sync.source_task_id} · {t("同步时间")}：{formatFullDate(task.production_sync.synced_at)}
              </div>
            </section>
          )}

          <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="text-xs font-bold text-slate-500">{t("任务描述")}</div>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">
              {task.description?.trim() || t("暂无任务描述")}
            </p>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-bold text-slate-500">{t("任务信息")}</div>
              <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", isRisk ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-600")}>
                {isRisk ? t("风险") : t("正常")}
              </span>
            </div>
            <dl className="grid grid-cols-2 gap-2">
              {[
                { label: t("任务编号"), value: task.task_id },
                { label: t("完成进度"), value: `${Math.max(0, Math.min(100, task.progress))}%` },
                { label: t("任务状态"), value: t(status.label) },
                { label: t("优先级"), value: priorityLabel(task) },
                { label: t("开始日期"), value: formatFullDate(task.start_date) },
                { label: t("截止日期"), value: formatFullDate(task.due_date) },
                { label: t("附件数量"), value: String(attachments.length || task.attachments || 0) },
                { label: t("最后更新"), value: formatFullDate(task.last_activity_at ?? task.updated_at) },
              ].map((item) => (
                <div key={item.label} className="min-w-0 rounded-xl bg-slate-50 p-2.5">
                  <dt className="text-[10px] font-semibold text-muted-foreground">{item.label}</dt>
                  <dd className="mt-1 break-words text-xs font-bold tabular-nums text-slate-700">{item.value}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-2 rounded-xl bg-slate-50 p-2.5">
              <div className="text-[10px] font-semibold text-muted-foreground">{t("完整分类")}</div>
              <div className="mt-1 break-words text-xs font-bold text-slate-700">{task.category_path || "—"}</div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="mb-2 flex items-center gap-2 text-xs font-bold text-slate-500">
              <Users size={14} />
              {t("任务成员")}
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-accent px-2.5 py-1 text-xs font-bold text-primary">
                {t("主责")} · {owner}
              </span>
              {(task.collaborators ?? []).map((collaborator) => (
                <span key={collaborator.id || collaborator.user_id || collaborator.name} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                  {collaborator.name}{collaborator.role ? ` · ${collaborator.role}` : ""}
                </span>
              ))}
              {(task.collaborators ?? []).length === 0 && (
                <span className="text-xs text-muted-foreground">{t("暂无协作人")}</span>
              )}
            </div>
          </section>

          {workItems.length > 0 && (
            <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
                  <ClipboardList size={14} />
                  {t("工作项")}
                </div>
                <span className="text-[11px] font-bold text-muted-foreground">{completedWorkItems}/{workItems.length}</span>
              </div>
              <ul className="space-y-2">
                {workItems.map((item) => (
                  <li key={item.id} className="flex items-start gap-2 rounded-xl bg-slate-50 p-2.5">
                    <CheckCircle2 size={15} className={item.done ? "mt-0.5 shrink-0 text-emerald-500" : "mt-0.5 shrink-0 text-muted-foreground"} />
                    <div className="min-w-0 flex-1">
                      <div className={cn("break-words text-xs font-semibold", item.done ? "text-muted-foreground line-through" : "text-slate-700")}>{item.title}</div>
                      {item.owner_name && <div className="mt-0.5 text-[10px] text-muted-foreground">{item.owner_name}</div>}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {groupTasks.length > 1 && (
            <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="mb-2 flex items-center gap-2 text-xs font-bold text-slate-500">
                <GitBranch size={14} />
                {t("合并关系")} · {groupTasks.length}
              </div>
              <div className="space-y-1.5">
                {groupTasks.map((groupTask) => (
                  <Button variant="unstyled"
                    key={groupTask.task_id}
                    type="button"
                    onClick={() => onOpenTask(groupTask.task_id)}
                    disabled={groupTask.task_id === task.task_id}
                    className={cn(
                      "flex min-h-11 w-full items-start gap-2 rounded-xl px-2.5 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary disabled:cursor-default",
                      groupTask.task_id === task.task_id ? "bg-accent" : "bg-slate-50 active:bg-slate-100",
                    )}
                  >
                    <span className="mt-0.5 shrink-0 text-[10px] font-bold text-muted-foreground">{groupTask.note_count}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-xs font-bold text-slate-700">{groupTask.title}</span>
                      <span className="mt-0.5 block break-words text-[10px] text-muted-foreground">{groupTask.path.join(" / ")}</span>
                    </span>
                  </Button>
                ))}
              </div>
            </section>
          )}

          {task.completion_score && (
            <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold text-emerald-700">{t("完成质量评分")}</div>
                <div className="text-lg font-black text-emerald-700">{task.completion_score.grade} · {task.completion_score.total}</div>
              </div>
            </section>
          )}

          {procurementTask && <ProcurementActivitySection task={procurementTask} />}
        </div>
      )}

      {detailTab === "attachments" && (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {technicalDocumentsEnabled && !loading && !loadError && <div className="mb-4"><TechnicalDocumentsPanel key={task.task_id} taskId={task.task_id} notes={notes} onPreview={openMobileAttachmentPreview} onNotesChanged={() => { void loadNotes(false); }} /></div>}
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-bold text-slate-900">{t("附件库")}</div>
            <span className="text-xs font-semibold text-muted-foreground">{attachments.length}</span>
          </div>
          {loading ? (
            <div className="flex justify-center py-12 text-muted-foreground" role="status" aria-label={t("正在加载附件")}><Loader2 className="animate-spin motion-reduce:animate-none" size={22} /></div>
          ) : loadError ? (
            <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-8 text-center">
              <div className="text-xs font-semibold text-rose-700">{loadError}</div>
              <Button variant="unstyled"
                type="button"
                onClick={() => void loadNotes()}
                className="mt-3 inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-white px-4 text-xs font-bold text-rose-700 active:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2"
              >
                <RefreshCw size={14} />
                {t("重新加载")}
              </Button>
            </div>
          ) : attachments.length > 0 ? (
            <ProgressAttachmentGrid attachments={attachments} imageDisplay="cards" className="space-y-2" />
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white py-12 text-center text-xs text-muted-foreground">{t("暂无附件")}</div>
          )}
        </div>
      )}

      {detailTab === "activity" && (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {auditLogs.length > 0 ? (
            <ol className="space-y-2">
              {auditLogs.map((log) => (
                <li key={log.id} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-xs font-bold text-slate-700">{t(getAuditActionMeta(log.action).label)}</div>
                    <div className="shrink-0 text-[10px] text-muted-foreground">{new Date(log.timestamp).toLocaleString()}</div>
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">{log.actor.name}{log.actor.role ? ` · ${log.actor.role}` : ""}</div>
                  {(log.comment || log.resource.name) && <div className="mt-2 break-words text-xs leading-5 text-slate-600">{log.comment || log.resource.name}</div>}
                </li>
              ))}
            </ol>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white py-12 text-center text-xs text-muted-foreground">{t("暂无操作记录")}</div>
          )}
        </div>
      )}

      {detailTab === "conversation" && (
        <RDTaskConversation
          key={`mobile-conversation:${task.task_id}`}
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
          key={`mobile-progress:${task.task_id}`}
          taskId={task.task_id}
          taskTitle={task.title}
          notes={groupNotes}
          mode="progress"
          variant="mobile"
          notesLoading={loading}
          notesError={loadError}
          onRetryNotes={() => void loadNotes()}
          onActivity={onDiscussionActivity}
        />
      )}
    </div>
  );
});
