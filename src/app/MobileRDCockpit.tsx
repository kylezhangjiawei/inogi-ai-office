import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, Clock, History, ImageIcon, Inbox, Loader2, RefreshCw, Send, Users, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "./components/ui/utils";
import { ProgressNoteList } from "./RDProgressEvidence";
import { recordAudit, useAuditActor } from "./lib/auditLog";
import { useRDCockpitData } from "./hooks/useRDCockpitData";
import {
  createRdTaskProgressNote,
  fetchRdTaskProgressNotes,
  type RdTask,
  type RdTaskProgressNote,
  type RdTaskStatus,
} from "./lib/rdApi";

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

const TASK_PAGE = 12;

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
  if (left === null) return { text: `止 ${md}`, overdue: false };
  if (left < 0) return { text: `逾期 ${-left} 天`, overdue: true };
  if (left === 0) return { text: `今日截止`, overdue: false };
  if (left <= 2) return { text: `${left} 天内`, overdue: false };
  return { text: `止 ${md}`, overdue: false };
}

function progressColor(status: RdTaskStatus): string {
  if (status === "completed") return "bg-emerald-500";
  if (status === "paused_blocked" || status === "pending_assign") return "bg-red-400";
  return "bg-indigo-500";
}

function ownerInitial(owner: string): string {
  const t = owner.trim();
  return t ? t[0].toUpperCase() : "?";
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
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diff = Date.now() - t;
  if (diff < 60_000) return "刚刚";
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 天前`;
  const mon = Math.floor(day / 30);
  if (mon < 12) return `${mon} 个月前`;
  return `${Math.floor(mon / 12)} 年前`;
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
  startIndex,
  onClose,
}: {
  images: string[];
  startIndex: number;
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(startIndex);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const safeIdx = Math.min(Math.max(idx, 0), images.length - 1);
  const current = images[safeIdx];

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-slate-950/90 backdrop-blur-sm" onClick={onClose}>
      <div className="flex shrink-0 items-center justify-between px-4 py-3 text-white/90">
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
        <img src={current} alt="附件预览" className="max-h-full max-w-full rounded-lg object-contain" />
      </div>
      {images.length > 1 && (
        <div
          className="flex shrink-0 gap-2 overflow-x-auto px-4 py-3 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
              <img src={u} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── 瀑布流卡片（竖向：状态 + 标签 → 封面 → 标题 → 最新进展 → 进度 → 负责人行）──────
function MobileFeedCard({
  task,
  isRisk,
  onOpen,
  onPreview,
}: {
  task: RdTask;
  isRisk: boolean;
  onOpen: () => void;
  onPreview: (images: string[], index: number) => void;
}) {
  const status = STATUS_META[task.status] ?? STATUS_META.draft;
  const due = formatDue(task.due_date);
  const owner = (task.primary_owner || "").trim() || "未指派";
  const progress = Math.max(0, Math.min(100, task.progress));
  const summary = task.latest_progress_summary?.text?.trim();
  const cat = lastCategory(task.category_path);
  const isHigh = (task.final_priority ?? task.ai_priority) === "high";
  const cover = task.cover_images ?? [];
  const score = task.completion_score;
  const freshness = activityFreshness(
    task.last_activity_at ?? task.latest_progress_summary?.created_at ?? task.updated_at,
  );

  return (
    <article
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
          {status.label}
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-slate-400">
          {cat ? `# ${cat}` : ""}
        </span>
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
            风险
          </span>
        )}
      </div>

      {/* 封面：进度留痕里的图片附件缩略图，点击放大预览（阻止冒泡，避免误开详情）*/}
      {cover.length > 0 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPreview(cover, 0);
          }}
          aria-label="预览附件图片"
          className="mt-2.5 block w-full px-3"
        >
          <div className="relative overflow-hidden rounded-xl bg-slate-100">
            <img
              src={cover[0]}
              alt="附件封面"
              loading="lazy"
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
            <span className="shrink-0 rounded bg-red-50 px-1 text-[10px] font-bold text-red-500">高</span>
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
              {freshness.text}更新
            </span>
          </div>
        )}
      </div>
    </article>
  );
}

// ─── 主页面 ───────────────────────────────────────────────────────────────────
export function MobileRDCockpit() {
  const { loading, error, reload, risks, allTasks } = useRDCockpitData();

  const [filter, setFilter] = useState<MobileFilter>("all");
  const [person, setPerson] = useState<string | null>(null);
  const [visible, setVisible] = useState(TASK_PAGE);
  const [activeTask, setActiveTask] = useState<RdTask | null>(null);
  // 灯箱状态提升到页面级：避免在 columns 多列容器里渲染 fixed 元素的布局怪相，
  // 也避免灯箱作为卡片子节点时 onClick 经 React 树冒泡回卡片误开详情。
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);
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

  // 状态 + 人员 双重过滤（AND）
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
    // 按最近活动时间倒序，使卡片按行从左到右呈现时对应时间顺序（最新在前）。
    const tsOf = (t: (typeof list)[number]) =>
      String(t.last_activity_at ?? t.latest_progress_summary?.created_at ?? t.updated_at ?? "");
    return [...list].sort((a, b) => tsOf(b).localeCompare(tsOf(a)));
  }, [allTasks, filter, person, riskTaskIds]);

  // 切换过滤回到第一页
  useEffect(() => {
    setVisible(TASK_PAGE);
  }, [filter, person]);

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
      { rootMargin: "320px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [filteredTasks.length]);

  // 详情打开时监听返回：系统/浏览器返回键触发 popstate → 关闭详情（消费掉 pushState 那条记录）。
  useEffect(() => {
    if (!activeTask) return;
    const onPop = () => setActiveTask(null);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [activeTask]);

  const shownTasks = filteredTasks.slice(0, visible);

  const scrollTop = () => {
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const pickStatus = (k: MobileFilter) => {
    setFilter(k);
    scrollTop();
  };
  const pickPerson = (name: string | null) => {
    setPerson((prev) => (name && prev === name ? null : name));
    scrollTop();
  };

  // 打开任务详情：压入一条 history，使「系统返回键 / 详情内返回」都只关详情、不退出 /m。
  const openTask = (task: RdTask) => {
    window.history.pushState({ mobileTaskDetail: true }, "");
    setActiveTask(task);
  };

  // 首屏加载 / 错误（仅当还没有任何数据时占满）
  if (loading && allTasks.length === 0) {
    return (
      <div className="flex min-h-[70dvh] flex-col items-center justify-center gap-3 text-slate-400">
        <Loader2 className="animate-spin" size={28} />
        <span className="text-sm">正在加载驾驶舱…</span>
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
          重试
        </button>
      </div>
    );
  }

  return (
    <div className="w-full pb-10">
      {/* ── 页头过滤区（吸顶）────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 border-b border-slate-200/70 bg-slate-50/95 backdrop-blur-md">
        {/* 状态过滤 + 刷新 */}
        <div className="flex items-center gap-2 px-4 pt-3">
          <div className="flex flex-1 gap-2 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => pickStatus(f.key)}
                className={cn(
                  "shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition active:scale-[0.97]",
                  filter === f.key
                    ? "bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-sm"
                    : "bg-white text-slate-500 ring-1 ring-slate-200/70 active:bg-slate-50",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={reload}
            disabled={loading}
            aria-label="刷新"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-slate-500 ring-1 ring-slate-200/70 active:bg-slate-50 disabled:opacity-60"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>

        {/* 人员过滤 */}
        <div className="flex gap-2 overflow-x-auto px-4 pb-2.5 pt-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button
            type="button"
            onClick={() => pickPerson(null)}
            className={cn(
              "flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-[12px] font-semibold transition active:scale-[0.97]",
              person === null ? "bg-slate-900 text-white" : "bg-white text-slate-500 ring-1 ring-slate-200/70",
            )}
          >
            <Users size={13} />
            全部
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
                <span className="max-w-[5rem] truncate">{o.name}</span>
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
      </div>

      {/* ── 任务瀑布流 ───────────────────────────────────────────────────── */}
      <div className="px-4 pt-3">
        <div className="mb-2.5 flex items-center justify-between">
          <span className="text-[13px] font-bold text-slate-900">
            {filter === "all" && !person ? "全部任务" : "筛选结果"}
          </span>
          <span className="text-[11px] font-semibold text-slate-400">{filteredTasks.length} 条</span>
        </div>

        {shownTasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2.5 rounded-2xl border border-dashed border-slate-200 bg-white/60 py-14 text-slate-300">
            <Inbox size={30} />
            <span className="text-xs font-medium text-slate-400">没有符合条件的任务</span>
          </div>
        ) : (
          <div className="grid grid-cols-2 items-start gap-3">
            {shownTasks.map((t) => (
              <MobileFeedCard
                key={t.task_id}
                task={t}
                isRisk={riskTaskIds.has(t.task_id)}
                onOpen={() => openTask(t)}
                onPreview={(images, index) => setLightbox({ images, index })}
              />
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
          onClose={() => window.history.back()}
          onAfterSubmit={reload}
        />
      )}

      {/* ── 封面缩略图点击放大 —— 页面级灯箱（层级高于详情）── */}
      {lightbox && (
        <ImageLightbox
          images={lightbox.images}
          startIndex={lightbox.index}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}

// ─── 任务详情覆盖层：操作留痕（含图片附件点击放大）+ 底部备注输入 ──────────────────
function MobileTaskDetail({
  task,
  isRisk,
  onClose,
  onAfterSubmit,
}: {
  task: RdTask;
  isRisk: boolean;
  onClose: () => void;
  onAfterSubmit?: () => void;
}) {
  const [notes, setNotes] = useState<RdTaskProgressNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const auditActor = useAuditActor("研发成员");

  const status = STATUS_META[task.status] ?? STATUS_META.draft;
  const owner = (task.primary_owner || "").trim() || "未指派";

  const loadNotes = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setNotes(await fetchRdTaskProgressNotes(task.task_id));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "加载操作留痕失败");
    } finally {
      setLoading(false);
    }
  }, [task.task_id]);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  // 详情打开期间锁住身后的列表滚动（移动路由下 body 才是滚动容器，行内样式压过样式表）。
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const submitNote = async () => {
    const text = draft.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    try {
      const savedNote = await createRdTaskProgressNote({ task_id: task.task_id, text });
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
      toast.success("备注已提交");
      await loadNotes();
      onAfterSubmit?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "提交失败，请重试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-slate-50">
      {/* 顶栏：返回 + 标题 + 状态/负责人 */}
      <header className="flex items-center gap-1.5 border-b border-slate-200 bg-white px-2 py-2.5">
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
                风险
              </span>
            )}
          </div>
        </div>
      </header>

      {/* 内容：操作留痕（图片附件可点击放大预览）*/}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="mb-2.5 flex items-center gap-1.5 text-[13px] font-bold text-slate-900">
          <History size={15} className="text-slate-400" />
          操作留痕
        </div>
        {loadError ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-red-200 bg-white py-10 text-center">
            <AlertTriangle className="text-red-400" size={24} />
            <span className="px-6 text-xs text-slate-500">{loadError}</span>
            <button
              type="button"
              onClick={() => void loadNotes()}
              className="rounded-full bg-indigo-600 px-5 py-1.5 text-xs font-semibold text-white active:bg-indigo-700"
            >
              重试
            </button>
          </div>
        ) : (
          <ProgressNoteList notes={notes} loading={loading} compact emptyText="暂无操作留痕" />
        )}
      </div>

      {/* 底部：备注输入（纯文本，其余从简）*/}
      <div className="border-t border-slate-200 bg-white px-3 py-2.5 [padding-bottom:calc(0.625rem+env(safe-area-inset-bottom))]">
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={1}
            placeholder="添加备注…"
            className="max-h-28 min-h-[2.5rem] flex-1 resize-none rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-[14px] leading-snug text-slate-800 outline-none placeholder:text-slate-400 focus:border-indigo-300 focus:bg-white"
          />
          <button
            type="button"
            onClick={submitNote}
            disabled={!draft.trim() || submitting}
            className="flex h-10 shrink-0 items-center gap-1 rounded-full bg-indigo-600 px-4 text-sm font-semibold text-white transition active:bg-indigo-700 disabled:opacity-40"
          >
            {submitting ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            提交
          </button>
        </div>
      </div>
    </div>
  );
}
