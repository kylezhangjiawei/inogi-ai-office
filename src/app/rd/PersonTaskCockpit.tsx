import {
  type Priority,
  type Task,
  STATUS_CONFIG,
  PRIORITY_CONFIG,
  displayPersonName,
  taskVisibleTitle,
} from "./taskModel";
import { RD_MOTION_EASE, RD_FAST_TRANSITION, RD_LIST_TRANSITION, RD_PANEL_TRANSITION } from "./taskMotion";
import { hashColor, OwnerAvatar } from "./TaskIdentity";
import React, {
  useCallback,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  useMemo,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Flame,
  GitBranch,
  ListChecks,
  Loader2,
  Lock,
  MoreVertical,
  Paperclip,
  FileText,
  Trash2,
  UserCog,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Input } from "../components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";
import { cn } from "../components/ui/utils";
import { inferAttachmentMime } from "../components/AttachmentPreviewDialog";
import { useAuth } from "../auth";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../components/ui/dropdown-menu";
import {
  backfillRdTaskCompletionScores,
  backfillRdTaskProgressNoteExtraction,
  fetchRdTaskCompletionScore,
  fetchRdTaskCompletionScores,
  fetchRdTaskAttachmentPreviews,
  fetchRdTaskAttachments,
  fetchRdTaskProgressNotes,
  buildRdTaskAttachmentPayload,
  type RdTaskCompletionScore,
  type RdTaskAttachmentPreview,
  type RdTaskProgressAttachment,
  type RdTaskProgressNote,
  isUsCollabWorkspace,
  isProductionWorkspace,
  isProductionMirrorTask,
  workItemsFeatureEnabled,
  blockedDaysOf,
  RD_DEFAULT_SUBPROJECT_LABEL,
} from "../lib/rdApi";
import { getGradeTone } from "../lib/taskCompletionScore";
import { openBatchCompletionReport } from "../lib/taskCompletionReport";
import { useAvatarDirectory } from "../lib/userAvatar";
import { t, useI18n } from "../lib/i18n";
import { memberIdentityKey } from "../lib/rdMemberIdentity";
import { type PersonLoad, type Risk } from "../lib/rdCockpitMetrics";
import { AutoTranslatedText } from "../components/TranslatableText";
import { Button } from "../components/ui/button";
import {
  type TaskActivityActor,
  type KpiFilter,
  NoteReceiptContext,
  taskActivityKey,
  taskMatches,
  matchesCurrentTaskParticipant,
  formatRelativeUpdate,
  splitCategoryPath,
  RELATIVE_UPDATE_TONE_CLASS,
  KPI_FILTER_LABEL,
} from "./cockpitModel";
import {
  TaskAttachmentStrip,
  ImageGallery,
  TaskAttachmentCollectionDialog,
} from "./TaskAttachmentGallery";

// 带并发上限地映射数组，避免批量导出时一次性发起成百上千个请求压垮浏览器/后端。
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

// ─── PersonTaskCockpit ────────────────────────────────────────────────────────
// 决策焦点：风险任务 + 人员负载合并为顶部 Tab 导航
// 负载环只使用单一状态色，避免渐变装饰干扰领导快速识别负载等级。
function loadRingColor(ratio: number, onLeave: boolean) {
  if (onLeave) return "#64748b"; // slate
  if (ratio >= 1) return "#dc2626"; // red
  if (ratio >= 0.8) return "#ea580c"; // orange
  if (ratio >= 0.6) return "#d97706"; // amber
  return "#059669"; // emerald
}

/** 返回成员页签标识（身份主键），不是姓名 —— 同名同事必须能分开选中。 */
function resolveActivityPersonTab(personLoads: PersonLoad[], actor?: TaskActivityActor | null) {
  if (!actor) return "all";
  const matchedById = actor.id
    ? personLoads.find((person) => person.user_id === actor.id)
    : undefined;
  if (matchedById) return matchedById.key;
  return personLoads.find((person) => person.name === actor.name)?.key ?? "all";
}

// 首批 6 个，后续滚动每批再加载 6 个
const TASK_PAGE_SIZE = 6;
const MAX_ATTACHMENT_PREVIEW = 5;

// ── Masonry (瀑布流) helpers for the task feed ──
// 把已排序的任务按轮转 (round-robin) 分配到 N 个独立列：第 i 个任务进入第 i % N 列。
// 每列各自纵向堆叠、互不影响高度，所以带附件的高卡片只撑高自己所在列，不会像 CSS grid
// 那样把同一行里的矮卡片拉出大片空白。轮转对前缀稳定：滚动加载追加新任务时已有卡片位置不变。
function distributeIntoColumns<T>(items: T[], columnCount: number): T[][] {
  const columns: T[][] = Array.from({ length: columnCount }, () => []);
  items.forEach((item, index) => columns[index % columnCount].push(item));
  return columns;
}

// 以任务区实际宽度分列；侧栏折叠、平板抽屉和大屏模式均会改变可用空间。
function useMasonryColumns(container: HTMLDivElement | null): number {
  const [columns, setColumns] = useState(1);
  useEffect(() => {
    if (!container) return;
    const touchQuery = window.matchMedia("(pointer: coarse)");
    const tabletQuery = window.matchMedia("(max-width: 1023px)");
    const update = () => {
      const availableWidth = container.clientWidth - 8;
      if (availableWidth <= 0) return;
      // 窄触屏保持纵向阅读顺序；桌面每张任务卡至少约 288px。
      const next = touchQuery.matches && tabletQuery.matches
        ? 1
        : Math.max(1, Math.min(6, Math.floor((availableWidth + 16) / (288 + 16))));
      setColumns((previous) => previous === next ? previous : next);
    };
    const observer = new ResizeObserver(update);
    observer.observe(container);
    touchQuery.addEventListener("change", update);
    tabletQuery.addEventListener("change", update);
    update();
    return () => {
      observer.disconnect();
      touchQuery.removeEventListener("change", update);
      tabletQuery.removeEventListener("change", update);
    };
  }, [container]);
  return columns;
}

function useCockpitSearchKeyword(keyword?: string, onKeywordChange?: (value: string) => void) {
  const [value, setValue] = useState(keyword ?? "");
  const [committedKeyword, setCommittedKeyword] = useState(keyword ?? "");
  const composingRef = useRef(false);
  const lastPublishedRef = useRef(keyword ?? "");

  useEffect(() => {
    if (keyword === undefined) return;
    lastPublishedRef.current = keyword;
    // URL 回传不能覆盖正在由输入法编辑的草稿。
    if (!composingRef.current) {
      setValue(keyword);
      setCommittedKeyword(keyword);
    }
  }, [keyword]);

  const setKeyword = useCallback((next: string) => {
    setValue(next);
    if (composingRef.current) return;
    setCommittedKeyword(next);
    if (lastPublishedRef.current !== next) {
      lastPublishedRef.current = next;
      onKeywordChange?.(next);
    }
  }, [onKeywordChange]);

  return {
    value,
    committedKeyword,
    setKeyword,
    composingRef,
    onCompositionStart: () => { composingRef.current = true; },
    onCompositionEnd: (next: string) => {
      composingRef.current = false;
      setKeyword(next);
    },
  };
}

export function PersonTaskCockpit({
  risks,
  personLoads,
  allTasks,
  initialActivityActor,
  keyword,
  onKeywordChange,
  onSelectTask,
  onSelectPerson,
  canReassign,
  onReassignTask,
  canDelete,
  canDeleteAny,
  onDeleteTask,
  canSyncProduction,
  syncedProductionTaskIds,
  syncingProductionTaskId,
  onToggleProductionSync,
  kpiFilter = "all",
  onClearKpiFilter,
  headerCollapsed = false,
  onHeaderCollapseChange,
}: {
  risks: Risk[];
  personLoads: PersonLoad[];
  allTasks: Task[];
  initialActivityActor?: TaskActivityActor | null;
  keyword?: string;
  onKeywordChange?: (value: string) => void;
  onSelectTask: (t: Task, activityActor?: TaskActivityActor) => void;
  onSelectPerson: (person: PersonLoad) => void;
  canReassign?: boolean;
  onReassignTask?: (task: Task) => void;
  canDelete?: boolean;
  canDeleteAny?: boolean;
  onDeleteTask?: (task: Task) => void;
  canSyncProduction?: boolean;
  syncedProductionTaskIds?: Set<string>;
  syncingProductionTaskId?: string | null;
  onToggleProductionSync?: (task: Task) => void;
  kpiFilter?: KpiFilter;
  onClearKpiFilter?: () => void;
  /** 顶部模块当前是否收起：重新计算任务区剩余可见高度。 */
  headerCollapsed?: boolean;
  /** 任务 feed 下滑时请求收起顶部；进入沉浸模式后由顶部控制条显式退出，避免上滑时丢失整屏视野 */
  onHeaderCollapseChange?: (collapsed: boolean) => void;
}) {
  const shouldReduceMotion = useReducedMotion();
  const { lang } = useI18n();
  const { user } = useAuth();
  const noteReceipts = React.useContext(NoteReceiptContext); // 备注回执 map（父级驾驶舱下发）
  const [taskStreamEl, setTaskStreamEl] = useState<HTMLDivElement | null>(null);
  const masonryColumns = useMasonryColumns(taskStreamEl);
  // 协同侧信息密度降一档：卡片内边距与卡片间距放宽（欧美工具风的呼吸感）；研发侧维持紧凑
  const spaciousCards = isUsCollabWorkspace();
  const researchCards = !spaciousCards && !isProductionWorkspace();
  // 跨用户头像解析（人员 Stories 头像 = 文字 → 真实头像，按姓名兜底匹配）
  const resolveAvatar = useAvatarDirectory();

  // ── Tab state (with prev-tab for slide direction) ──
  const initialActivityTab = resolveActivityPersonTab(personLoads, initialActivityActor);
  const [activeTab, setActiveTab] = useState(() => resolveActivityPersonTab(personLoads, initialActivityActor));
  const [prevTab, setPrevTab] = useState(() => resolveActivityPersonTab(personLoads, initialActivityActor));
  const activityRestorePendingRef = useRef(Boolean(initialActivityActor && initialActivityTab === "all"));
  const tabOrder = useMemo(() => ["all", ...personLoads.map((p) => p.key)], [personLoads]);
  const direction = tabOrder.indexOf(activeTab) >= tabOrder.indexOf(prevTab) ? 1 : -1;

  // 跨产品合并树可能比主库稍晚返回：若首次挂载时尚未找到目标成员，等人员数据补齐后恢复一次。
  // 用户若已主动切换页签，则取消这次延迟恢复，避免异步响应覆盖用户的新选择。
  useEffect(() => {
    if (!activityRestorePendingRef.current || !initialActivityActor) return;
    const restoredTab = resolveActivityPersonTab(personLoads, initialActivityActor);
    if (restoredTab === "all") return;
    activityRestorePendingRef.current = false;
    setActiveTab(restoredTab);
    setPrevTab(restoredTab);
  }, [initialActivityActor, personLoads]);

  const handleTabChange = useCallback((v: string) => {
    activityRestorePendingRef.current = false;
    setPrevTab(activeTab);
    setActiveTab(v);
  }, [activeTab]);

  // ── 任务搜索（头像行右端图标态收纳，展开为小输入框）──
  // 关键字与 KPI 筛选走同一管线（直接揉进 allActiveTasks / personTasksMap 两个 memo），
  // 懒加载留痕/AI 评分、无限滚动、批量导出等所有下游自动同口径。
  const {
    value: cockpitKeyword,
    committedKeyword,
    setKeyword: setCockpitKeyword,
    composingRef: searchComposingRef,
    onCompositionStart: startSearchComposition,
    onCompositionEnd: endSearchComposition,
  } = useCockpitSearchKeyword(keyword, onKeywordChange);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const cockpitSearch = committedKeyword.trim();
  const deferredCockpitSearch = useDeferredValue(cockpitSearch);
  const searchPending = deferredCockpitSearch !== cockpitSearch;
  const clearSearchAndRestoreFocus = useCallback(() => {
    setCockpitKeyword("");
    requestAnimationFrame(() => searchInputRef.current?.focus());
  }, [setCockpitKeyword]);

  // 异步刷新后（如删除了某人最后一个任务），该成员会从 personLoads 中消失。
  // 此时停留在已不存在的人员 tab 上会让内容区空白，回退到「全部」。
  // 其余刷新（成员仍有任务）保持当前选中人员不变。
  useEffect(() => {
    if (activeTab !== "all" && !personLoads.some((p) => p.key === activeTab)) {
      setActiveTab("all");
      setPrevTab("all");
    }
  }, [activeTab, personLoads]);

  // Full notes are reserved for reports/details; cockpit cards use a dedicated lightweight batch map.
  const [notesMap, setNotesMap] = useState<Record<string, RdTaskProgressNote[]>>({});
  const [attachmentPreviewMap, setAttachmentPreviewMap] = useState<Record<string, RdTaskAttachmentPreview>>({});
  const [loadingNotes, setLoadingNotes] = useState(false);
  // ── AI 完成质量评分 lazy fetch（已完成任务，按需拉取）──
  // 值为 null 表示已请求但后端尚未生成评分（或当前用户无权查看）
  const [aiScoreMap, setAiScoreMap] = useState<Record<string, RdTaskCompletionScore | null>>({});
  // 一次性补跑全部已完成任务 AI 评分的进行中标记
  const [backfillBusy, setBackfillBusy] = useState(false);
  // 批量补抽取历史附件的进行中标记
  const [extractionBackfillBusy, setExtractionBackfillBusy] = useState(false);
  // 批量导出报告的进行中标记
  const [batchExportBusy, setBatchExportBusy] = useState(false);

  const handleBackfillScores = useCallback(async (force = false) => {
    if (backfillBusy) return;
    setBackfillBusy(true);
    const toastId = toast.loading(t("[1/2] 正在抽取历史附件文本（OCR/文档/视觉）…"));

    // Step 1：先做附件抽取，让评分时 AI 能"看到"附件内容
    let extractionSummary = "";
    let extractionHasMore = false;
    try {
      const extractResult = await backfillRdTaskProgressNoteExtraction({ max_items: 50 });
      if (extractResult.processed === 0) {
        extractionSummary = t("附件全部已抽取");
      } else {
        extractionSummary = t("附件抽取 {succeeded} 成功{failed}", {
          succeeded: extractResult.succeeded,
          failed: extractResult.failed > 0 ? ` ${t("/ {count} 失败", { count: extractResult.failed })}` : "",
        });
        if (extractResult.has_more) {
          extractionHasMore = true;
          extractionSummary += t("（剩 {count} 个待处理）", { count: extractResult.total_pending - extractResult.processed });
        }
      }
    } catch (err) {
      extractionSummary = t("附件抽取失败：{error}", { error: err instanceof Error ? err.message : t("未知错误") });
      // 抽取失败不阻塞评分，AI 依然能基于元数据评分
    }

    // Step 2：AI 评分
    toast.loading(t("[2/2] {summary} → 生成 AI 评分中…", { summary: extractionSummary }), { id: toastId });
    try {
      const result = await backfillRdTaskCompletionScores({ force });
      const scoreSummary = force
        ? t("AI 重新评分：{scored} 个已按新标准更新{failed}", {
            scored: result.scored,
            failed: result.failed > 0 ? ` ${t("/ {count} 失败", { count: result.failed })}` : "",
          })
        : t("AI 评分：{scored} 新评分 / {skipped} 已存在{failed}", {
            scored: result.scored,
            skipped: result.skipped,
            failed: result.failed > 0 ? ` ${t("/ {count} 失败", { count: result.failed })}` : "",
          });
      const finalMsg = [extractionSummary, scoreSummary, extractionHasMore ? t("提示：附件仍有未抽取项，可再次点击继续完善评分") : ""]
        .filter(Boolean)
        .join("\n");
      if (result.failed > 0 || extractionHasMore) {
        toast.warning(finalMsg, { id: toastId, duration: 8000 });
      } else {
        toast.success(finalMsg, { id: toastId, duration: 6000 });
      }
      // 清空两个 map，触发可见任务重新拉取
      setAiScoreMap({});
      setNotesMap({});
    } catch (err) {
      toast.error(t("AI 评分失败：{error}", { error: err instanceof Error ? err.message : t("未知错误") }), { id: toastId });
    } finally {
      setBackfillBusy(false);
    }
  }, [backfillBusy]);

  const handleBackfillExtraction = useCallback(async () => {
    if (extractionBackfillBusy) return;
    setExtractionBackfillBusy(true);
    const toastId = toast.loading(t("正在批量抽取历史附件文本（OCR/文档/视觉，每个 5-30 秒）…"));
    try {
      const result = await backfillRdTaskProgressNoteExtraction({ max_items: 50 });
      const lines = [
        t("本次处理 {processed} / 待处理 {pending}", { processed: result.processed, pending: result.total_pending }),
        t("成功 {succeeded}{failed}", { succeeded: result.succeeded, failed: result.failed > 0 ? ` ${t("· 失败 {count}", { count: result.failed })}` : "" }),
      ];
      if (result.has_more) {
        lines.push(t("（剩余附件较多，可再次点击继续）"));
      }
      const msg = lines.join("，");
      if (result.failed > 0) toast.warning(msg, { id: toastId, duration: 6000 });
      else if (result.processed === 0) toast.info(t("没有待抽取的附件，全部已处理过"), { id: toastId });
      else toast.success(msg, { id: toastId, duration: 6000 });
      // 清空 notesMap，触发可见任务重新拉取（这样新的 extracted_text 会反映出来）
      setNotesMap({});
      // 评分也清空，因为下次评分能用上新抽取的内容
      setAiScoreMap({});
    } catch (err) {
      toast.error(t("批量抽取失败：{error}", { error: err instanceof Error ? err.message : t("未知错误") }), { id: toastId });
    } finally {
      setExtractionBackfillBusy(false);
    }
  }, [extractionBackfillBusy]);

  // ── Per-tab visible counts (for infinite scroll pagination) ──
  // 研发与协同驾驶舱统一：首批只渲染 6 条，后续按滚动增量加载。
  const taskPageSize = TASK_PAGE_SIZE;
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>({});
  // 协助段折叠态（按成员身份主键记）。默认折叠：驾驶舱给领导看的是「谁负责什么」，
  // 协助是下钻上下文；折叠标题上仍带数量，不看也知道他还搭了几件事。
  const [expandedCollabTabs, setExpandedCollabTabs] = useState<Set<string>>(() => new Set());
  const toggleCollabSegment = useCallback((tabKey: string) => {
    setExpandedCollabTabs((prev) => {
      const next = new Set(prev);
      if (next.has(tabKey)) next.delete(tabKey);
      else next.add(tabKey);
      return next;
    });
  }, []);
  // 当前激活 tab 的滚动容器。用 callback-ref 把节点存进 state，而不是 useRef：
  // AnimatePresence mode="wait" 下切 tab 时旧容器会先退场动画(~220ms)再卸载、新容器随后才挂载；
  // 用 useRef + 仅依赖 activeTab 的 effect 会在退场期测到旧容器、且新容器挂载后不再重跑 effect，
  // 导致少卡片的新 tab 永不自动填充。把节点放进 state 后，节点挂载/卸载即触发 effect 重跑，时序正确。
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  // 任务流使用主区域剩余高度；报告展开、筛选、语言和侧栏变化后重新测量。
  const [flowHeight, setFlowHeight] = useState<number | null>(null);
  useEffect(() => {
    if (!scrollEl) return;
    const main = scrollEl.closest("main");
    const overview = scrollEl.closest(".rd-horizon-layout")?.querySelector(".rd-horizon-overview-top");
    const peopleNav = taskStreamEl?.querySelector(".rd-horizon-people-nav");
    const measure = () => {
      const top = scrollEl.getBoundingClientRect().top;
      const bottom = main?.getBoundingClientRect().bottom ?? window.innerHeight;
      // 很短的窗口允许外层自然滚动，避免把任务卡压成无法操作的小窗。
      const next = Math.max(256, Math.floor(bottom - top - 12));
      setFlowHeight((previous) => previous === next ? previous : next);
    };
    const observer = new ResizeObserver(measure);
    for (const element of [main, overview, peopleNav, taskStreamEl]) {
      if (element) observer.observe(element);
    }
    measure();
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [scrollEl, taskStreamEl, headerCollapsed, kpiFilter, lang]);
  const flowHeightStyle = (_collapsed: boolean): React.CSSProperties => ({
    height: flowHeight ?? "60dvh",
  });
  const setScrollRef = useCallback((node: HTMLDivElement | null) => setScrollEl(node), []);
  // 上一次滚动位置：用于识别下滑并自动进入沉浸模式，带滞回阈值防抖动
  const lastScrollTopRef = useRef(0);
  // 自动收起后的短暂冷却：feed 高度变化会让浏览器把超出新范围的 scrollTop 夹紧、回弹出一串
  // 滚动事件；锁定窗口内只同步基准，避免高度动画干扰后续方向判断。
  const collapseLockUntilRef = useRef(0);
  const loadNextTaskPage = useCallback((tabKey: string, totalTasks: number) => {
    setVisibleCounts((prev) => {
      const current = prev[tabKey] ?? taskPageSize;
      if (current >= totalTasks) return prev;
      return { ...prev, [tabKey]: Math.min(current + TASK_PAGE_SIZE, totalTasks) };
    });
  }, [taskPageSize]);

  // 固定高度容器内的 onScroll 触发分页
  const handleTaskScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>, tabKey: string, totalTasks: number) => {
      const el = e.currentTarget;
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
      if (nearBottom) {
        loadNextTaskPage(tabKey, totalTasks);
      }
      // 顶部模块「下滑收起」：滞回阈值（累计 > 6px、且越过 80px）避免抖动。
      // 进入沉浸模式后不再因上滑自动展开，让用户能在整屏状态回到第一排；退出交给顶部控制条。
      // 冷却锁继续吸收高度变化引发的滚动回弹。父级在「钉住」时忽略该信号。
      if (onHeaderCollapseChange) {
        const top = el.scrollTop;
        if (Date.now() < collapseLockUntilRef.current) {
          lastScrollTopRef.current = top;
          return;
        }
        const lock = () => {
          collapseLockUntilRef.current = Date.now() + 420;
          lastScrollTopRef.current = top;
        };
        if (top <= 8) {
          lastScrollTopRef.current = top;
        } else {
          const delta = top - lastScrollTopRef.current;
          if (delta > 6 && top > 80 && !headerCollapsed) {
            onHeaderCollapseChange(true);
            lock();
          } else if (Math.abs(delta) > 6) {
            // 状态无需变化：仅推进基准，保持滞回灵敏度
            lastScrollTopRef.current = top;
          }
        }
      }
    },
    [headerCollapsed, loadNextTaskPage, onHeaderCollapseChange],
  );

  // ── Gallery lightbox ──
  const [galleryState, setGalleryState] = useState<{ images: RdTaskProgressAttachment[]; startIndex: number } | null>(null);
  const [attachmentCollectionState, setAttachmentCollectionState] = useState<{
    taskTitle: string;
    attachments: RdTaskProgressAttachment[];
  } | null>(null);
  const [attachmentLoadingTaskId, setAttachmentLoadingTaskId] = useState<string | null>(null);
  const fullAttachmentCacheRef = useRef(new Map<string, RdTaskAttachmentPreview>());
  const fullAttachmentInflightRef = useRef(new Map<string, Promise<RdTaskAttachmentPreview>>());
  const attachmentOpenSequenceRef = useRef(0);

  const loadAllTaskAttachments = useCallback(async (taskId: string, expectedCount: number) => {
    const cached = fullAttachmentCacheRef.current.get(taskId);
    if (cached && (expectedCount <= 0 || cached.attachment_count === expectedCount)) return cached;
    const inflight = fullAttachmentInflightRef.current.get(taskId);
    if (inflight) return inflight;
    const request = fetchRdTaskAttachments(taskId);
    fullAttachmentInflightRef.current.set(taskId, request);
    try {
      const result = await request;
      fullAttachmentCacheRef.current.set(taskId, result);
      return result;
    } finally {
      if (fullAttachmentInflightRef.current.get(taskId) === request) {
        fullAttachmentInflightRef.current.delete(taskId);
      }
    }
  }, []);

  const openCompleteImageGallery = useCallback(async (
    task: Task,
    previewImages: RdTaskProgressAttachment[],
    startIndex: number,
    expectedCount: number,
  ) => {
    const requestSequence = ++attachmentOpenSequenceRef.current;
    setAttachmentLoadingTaskId(task.task_id);
    try {
      const result = await loadAllTaskAttachments(task.task_id, expectedCount);
      if (requestSequence !== attachmentOpenSequenceRef.current) return;
      const images = result.attachments.filter((attachment) => inferAttachmentMime(attachment).startsWith("image/"));
      if (images.length === 0) {
        toast.info(t("该任务暂无图片附件"));
        return;
      }
      const startAttachmentId = previewImages[startIndex]?.id;
      const resolvedIndex = startAttachmentId
        ? images.findIndex((attachment) => attachment.id === startAttachmentId)
        : 0;
      setGalleryState({ images, startIndex: Math.max(0, resolvedIndex) });
    } catch (error) {
      if (requestSequence === attachmentOpenSequenceRef.current) {
        toast.error(error instanceof Error ? error.message : t("完整附件加载失败"));
      }
    } finally {
      if (requestSequence === attachmentOpenSequenceRef.current) {
        setAttachmentLoadingTaskId(null);
      }
    }
  }, [loadAllTaskAttachments]);

  const openCompleteAttachmentCollection = useCallback(async (task: Task, expectedCount: number) => {
    const requestSequence = ++attachmentOpenSequenceRef.current;
    setAttachmentLoadingTaskId(task.task_id);
    try {
      const result = await loadAllTaskAttachments(task.task_id, expectedCount);
      if (requestSequence !== attachmentOpenSequenceRef.current) return;
      setAttachmentCollectionState({ taskTitle: task.title, attachments: result.attachments });
    } catch (error) {
      if (requestSequence === attachmentOpenSequenceRef.current) {
        toast.error(error instanceof Error ? error.message : t("完整附件加载失败"));
      }
    } finally {
      if (requestSequence === attachmentOpenSequenceRef.current) {
        setAttachmentLoadingTaskId(null);
      }
    }
  }, [loadAllTaskAttachments]);

  // ── Sort helper: newest activity first ──
  // 排序键用后端派生的 last_activity_at（= max(updated_at, 最新留痕时间)），与卡片「最近更新」
  // 显示同一口径。进度留痕不刷新 updated_at，单用 updated_at 排序会让刚留痕的任务沉底、出现逆序。
  // 关键：兜底链必须与卡片标签 lastUpdateIso 完全一致（last_activity_at → 最新留痕时间 → updated_at），
  // 否则当 last_activity_at 缺失时，标签按留痕时间显示「N 分钟前」、排序却退回 updated_at，
  // 会出现「刚留痕的任务标签很新但排在很后面」的逆序观感。统一走模块级 taskActivityKey。
  const sortByUpdatedDesc = useCallback((arr: Task[]): Task[] => {
    return arr.slice().sort((a, b) => {
      const at = taskActivityKey(a);
      const bt = taskActivityKey(b);
      if (at === bt) return 0;
      return at < bt ? 1 : -1;
    });
  }, []);

  // Risk task IDs for quick lookup (to show risk indicator in "全部" tab)
  const riskTaskIds = useMemo(() => new Set(risks.map((r) => r.task.task_id)), [risks]);

  // KPI 卡片筛选谓词：与顶部 KPI 计数口径保持一致
  // - 阻塞/待派 与 catStat.blocked 保持一致（paused_blocked || pending_assign）
  const matchesKpiFilter = useCallback(
    (t: Task): boolean => {
      switch (kpiFilter) {
        case "in_progress":
          return t.status === "in_progress";
        case "completed":
          return t.status === "completed";
        case "blocked":
          return t.status === "paused_blocked" || t.status === "pending_assign";
        case "risk":
          return riskTaskIds.has(t.task_id);
        case "all":
        default:
          return true;
      }
    },
    [kpiFilter, riskTaskIds],
  );

  // ── Derived data ──
  // "全部" tab — 默认包含所有非归档任务（含已完成），按更新时间倒序；如有 KPI 筛选则再过滤
  const filteredTasks = useMemo(() => {
    return sortByUpdatedDesc(
      allTasks.filter((task) =>
        !task.archived
        && matchesKpiFilter(task)
        && taskMatches(task, deferredCockpitSearch, "all", "all", "all"),
      ),
    );
  }, [allTasks, deferredCockpitSearch, matchesKpiFilter, sortByUpdatedDesc]);

  const allActiveTasks = filteredTasks;

  // Per-person — 同步包含已完成任务并应用 KPI 筛选与搜索关键字
  // 驾驶舱是给领导看「谁在负责什么」的，所以主责与协助必须分开：
  // 主责段占第一屏，协助段作为下钻上下文默认折叠。两段应用同一套 KPI 筛选与搜索。
  const personTasksMap = useMemo(() => {
    const map = new Map<string, { primary: Task[]; collaborating: Task[] }>();
    for (const person of personLoads) {
      map.set(person.key, { primary: [], collaborating: [] });
    }
    // filteredTasks 已按最后活动时间排序；单次遍历即可保持各成员分组同序，
    // 避免原先“人员 × 任务”的嵌套扫描。同一任务的重复协作者用 Set 去重。
    for (const task of filteredTasks) {
      const ownerKey = memberIdentityKey(task.primary_owner, task.primary_owner_user_id);
      map.get(ownerKey)?.primary.push(task);

      const collaboratorKeys = new Set(
        task.collaborators.map((collaborator) => memberIdentityKey(collaborator.name, collaborator.user_id)),
      );
      collaboratorKeys.delete(ownerKey);
      for (const collaboratorKey of collaboratorKeys) {
        map.get(collaboratorKey)?.collaborating.push(task);
      }
    }
    return map;
  }, [filteredTasks, personLoads]);

  /** 分页、导出等下游只关心「该成员页签下的全部任务」，主责在前、协助在后。 */
  const personScopeTasks = useCallback(
    (tabKey: string): Task[] => {
      const segments = personTasksMap.get(tabKey);
      return segments ? [...segments.primary, ...segments.collaborating] : [];
    },
    [personTasksMap],
  );

  // 当前 tab 的搜索命中数（展示在搜索框内）
  const activePersonSegments = activeTab === "all" ? undefined : personTasksMap.get(activeTab);
  const cockpitHitCount = activePersonSegments
    ? activePersonSegments.primary.length + activePersonSegments.collaborating.length
    : allActiveTasks.length;

  // 批量导出报告：把当前范围（"全部" / 某成员）已完成且已评分的任务，汇总成一份多页 PDF。
  // 注意：依赖 allActiveTasks / personTasksMap，必须定义在它们的 useMemo 之后，否则触发 TDZ。
  const handleBatchExportReports = useCallback(async () => {
    if (batchExportBusy) return;
    const scopeTasks = (activeTab === "all" ? allActiveTasks : personScopeTasks(activeTab))
      .filter((t) => t.status === "completed");
    if (scopeTasks.length === 0) {
      toast.info(t("当前范围没有已完成任务可导出"));
      return;
    }
    if (
      scopeTasks.length > 50 &&
      !window.confirm(t("当前范围有 {count} 个已完成任务，将逐个拉取评分与留痕并生成多页报告，可能较慢。确定继续？", { count: scopeTasks.length }))
    ) {
      return;
    }
    setBatchExportBusy(true);
    const toastId = toast.loading(t("正在汇总 {count} 个任务的评分…", { count: scopeTasks.length }));
    try {
      // 1) 评分接口每批最多 60 个；批量导出不再按任务放大成 N 个请求。
      const missingScoreIds = scopeTasks
        .filter((task) => aiScoreMap[task.task_id] === undefined)
        .map((task) => task.task_id);
      const scoreBatches = Array.from(
        { length: Math.ceil(missingScoreIds.length / 60) },
        (_, index) => missingScoreIds.slice(index * 60, (index + 1) * 60),
      );
      const fetchedScoreMaps = await mapWithConcurrency(scoreBatches, 2, async (batch) => {
        try {
          return await fetchRdTaskCompletionScores(batch);
        } catch {
          // Rolling deploy compatibility for an older API instance.
          const entries = await mapWithConcurrency(batch, 4, async (taskId) => [
            taskId,
            await fetchRdTaskCompletionScore(taskId).catch(() => null),
          ] as const);
          return Object.fromEntries(entries);
        }
      });
      const fetchedScores = Object.assign({}, ...fetchedScoreMaps) as Record<string, RdTaskCompletionScore | null>;
      const scoreEntries = scopeTasks.map((task) => [
        task,
        aiScoreMap[task.task_id] !== undefined ? aiScoreMap[task.task_id] : fetchedScores[task.task_id] ?? null,
      ] as const);
      const scored = scoreEntries.filter(
        (e): e is readonly [Task, RdTaskCompletionScore] => e[1] != null,
      );
      if (scored.length === 0) {
        toast.error(t("这些任务尚未生成 AI 评分，请先点击「AI 复盘评分」"), { id: toastId });
        return;
      }
      // 2) 拉进度留痕（并发上限 6），优先用 notesMap 缓存
      toast.loading(t("正在汇总 {count} 个任务的进度留痕…", { count: scored.length }), { id: toastId });
      const items = await mapWithConcurrency(scored, 6, async ([t, score]) => {
        const cachedNotes = notesMap[t.task_id];
        const noteList = cachedNotes !== undefined ? cachedNotes : await fetchRdTaskProgressNotes(t.task_id).catch(() => []);
        return { task: t, score, notes: noteList };
      });
      const scopeLabel = activeTab === "all"
        ? t("管理员视角")
        : (personLoads.find((person) => person.key === activeTab)?.name ?? activeTab);
      const ok = openBatchCompletionReport(scopeLabel, items);
      if (!ok) {
        toast.error(t("报告窗口被浏览器拦截，请允许本站弹出窗口后重试"), { id: toastId });
        return;
      }
      const skipped = scopeTasks.length - scored.length;
      toast.success(
        t("已生成 {count} 份报告{skipped}", { count: items.length, skipped: skipped > 0 ? t("，跳过 {count} 个未评分任务", { count: skipped }) : "" }),
        { id: toastId, duration: 6000 },
      );
    } catch (err) {
      toast.error(t("批量导出失败：{error}", { error: err instanceof Error ? err.message : t("未知错误") }), { id: toastId });
    } finally {
      setBatchExportBusy(false);
    }
  }, [activeTab, aiScoreMap, allActiveTasks, batchExportBusy, notesMap, personLoads, personScopeTasks]);

  // 切换 KPI 筛选 / 搜索关键字时重置分页计数，避免旧偏移导致空白
  useEffect(() => {
    setVisibleCounts({});
  }, [deferredCockpitSearch, kpiFilter]);

  // One card-summary request per visible page. The previous implementation emitted one full-notes
  // request per task and repeated the backend's full JSON scans, which scaled poorly with task count.
  useEffect(() => {
    const visibleCount = visibleCounts[activeTab] ?? taskPageSize;
    const sourceTasks = activeTab === "all"
      ? allActiveTasks
      : personScopeTasks(activeTab);
    const toFetch = sourceTasks
      .slice(0, visibleCount)
      .filter((task) => task.attachments > 0 && !(task.task_id in attachmentPreviewMap));
    if (toFetch.length === 0) {
      setLoadingNotes(false);
      return;
    }
    const controller = new AbortController();
    setLoadingNotes(true);
    fetchRdTaskAttachmentPreviews(
      toFetch.map((task) => task.task_id),
      { signal: controller.signal },
    )
      .catch(async (error) => {
        if (controller.signal.aborted) return null;
        // Rolling deploy/dev compatibility: a newer frontend can briefly run against an API that
        // does not have the batch-summary route yet. Fall back to the established per-task notes
        // endpoint instead of translating an integration error into "this task has no attachments".
        const entries = await mapWithConcurrency(toFetch, 3, async (task) => {
          try {
            const notes = await fetchRdTaskProgressNotes(task.task_id, controller.signal);
            return [task.task_id, buildRdTaskAttachmentPayload(notes, MAX_ATTACHMENT_PREVIEW)] as const;
          } catch {
            return [
              task.task_id,
              { attachment_count: task.attachments, attachments: [] as RdTaskProgressAttachment[] },
            ] as const;
          }
        });
        return Object.fromEntries(entries);
      })
      .then((previews) => {
        if (!controller.signal.aborted && previews) {
          setAttachmentPreviewMap((prev) => ({ ...prev, ...previews }));
        }
      })
      .finally(() => { if (!controller.signal.aborted) setLoadingNotes(false); });
    return () => { controller.abort(); };
  }, [activeTab, allActiveTasks, personTasksMap, visibleCounts, attachmentPreviewMap]);

  // Lazy-fetch AI completion scores — 仅针对可见的已完成任务
  useEffect(() => {
    const visibleCount = activeTab === "all"
      ? (visibleCounts["all"] ?? taskPageSize)
      : (visibleCounts[activeTab] ?? taskPageSize);
    const sourceTasks = activeTab === "all"
      ? allActiveTasks
      : personScopeTasks(activeTab);
    const visibleCompleted = sourceTasks
      .slice(0, visibleCount)
      .filter((t) => t.status === "completed" && !(t.task_id in aiScoreMap));
    if (visibleCompleted.length === 0) return;
    const controller = new AbortController();
    fetchRdTaskCompletionScores(
      visibleCompleted.map((task) => task.task_id),
      controller.signal,
    )
      .catch(async () => {
        if (controller.signal.aborted) return null;
        // Rolling deploy compatibility for an older API instance.
        const entries = await mapWithConcurrency(visibleCompleted, 4, (task) =>
          fetchRdTaskCompletionScore(task.task_id, controller.signal)
            .then((score) => [task.task_id, score] as const)
            .catch(() => [task.task_id, null] as const),
        );
        return Object.fromEntries(entries);
      })
      .then((scores) => {
        if (!controller.signal.aborted && scores) {
          setAiScoreMap((prev) => ({ ...prev, ...scores }));
        }
      });
    return () => { controller.abort(); };
  }, [activeTab, allActiveTasks, personTasksMap, visibleCounts]);

  // 三列瀑布流在首批 6 张卡片较矮时可能没有滚动条，onScroll 因而永远不会触发。
  // 内容不足时自动追加一批，直到产生可滚动空间或全部展示；底部按钮仍保留手动兜底。
  useEffect(() => {
    if (!scrollEl) return;
    // 分页只驱动主责段（协助段展开后一次给完），补页判断必须用同一口径，
    // 否则合计数大于主责数时会一直认为「还有下一页」，反复触发补页。
    const totalTasks = activeTab === "all"
      ? allActiveTasks.length
      : (personTasksMap.get(activeTab)?.primary.length ?? 0);
    const visibleCount = visibleCounts[activeTab] ?? taskPageSize;
    if (visibleCount >= totalTasks) return;
    if (scrollEl.scrollHeight - scrollEl.clientHeight >= 120) return;
    loadNextTaskPage(activeTab, totalTasks);
  }, [
    activeTab,
    allActiveTasks,
    attachmentPreviewMap,
    flowHeight,
    headerCollapsed,
    loadNextTaskPage,
    masonryColumns,
    personTasksMap,
    scrollEl,
    taskPageSize,
    visibleCounts,
  ]);

  // Slide variants for tab content transitions
  const slideVariants = {
    enter: (dir: number) => ({
      x: shouldReduceMotion ? 0 : dir > 0 ? 36 : -36,
      opacity: 0,
    }),
    center: { x: 0, opacity: 1 },
    exit: (dir: number) => ({
      x: shouldReduceMotion ? 0 : dir > 0 ? -36 : 36,
      opacity: 0,
    }),
  };

  const activeMember = useMemo(
    () => activeTab === "all" ? undefined : personLoads.find((person) => person.key === activeTab),
    [activeTab, personLoads],
  );
  const activityActor = useMemo(
    () => activeMember ? { id: activeMember.user_id, name: activeMember.name } : undefined,
    [activeMember],
  );

  // ── Shared task card renderer (used by both "全部" and per-person tabs) ──
  const renderTaskCard = (
    task: Task,
    taskIdx: number,
    accentColor: string,
  ) => {
    const visibleTaskTitle = taskVisibleTitle(task);
    // 协助段的卡片必须标明主责人，领导才知道这件事到底归谁
    const isSelectedPersonCollaborator = Boolean(
      activeMember && memberIdentityKey(task.primary_owner, task.primary_owner_user_id) !== activeMember.key,
    );
    const priorityKey: Priority = task.final_priority ?? task.ai_priority ?? "medium";
    const pCfg = PRIORITY_CONFIG[priorityKey] ?? PRIORITY_CONFIG.medium;
    const attachmentPreview = attachmentPreviewMap[task.task_id];
    const taskAttachments: RdTaskProgressAttachment[] = attachmentPreview?.attachments ?? [];
    // 按扩展名兜底判定：存成 application/octet-stream 的图片此前既不进图片位、也不算文档
    const taskImages = taskAttachments.filter((a) => inferAttachmentMime(a).startsWith("image/"));
    const taskAttachmentCount = attachmentPreview?.attachment_count ?? task.attachments;
    const hasLoadedAttachments = Boolean(attachmentPreview && attachmentPreview.attachment_count > 0);
    const isRisk = riskTaskIds.has(task.task_id);
    const productionMirror = isProductionMirrorTask(task);
    const researchCard = researchCards && task.source_workspace !== "us-collab" && !productionMirror;
    const isCurrentUserParticipant = Boolean(user && (
      matchesCurrentTaskParticipant(
        task.primary_owner_user_id,
        task.primary_owner,
        user.id,
        user.name,
      )
      || task.collaborators.some((collaborator) => matchesCurrentTaskParticipant(
        collaborator.user_id,
        collaborator.name,
        user.id,
        user.name,
      ))
    ));
    const showDeleteTaskAction = Boolean(canDelete && (canDeleteAny || isCurrentUserParticipant));
    const productionSynced = syncedProductionTaskIds?.has(task.task_id) ?? false;
    const showProductionSyncAction = Boolean(canSyncProduction && onToggleProductionSync && !productionMirror);
    // 最近更新时间：用后端派生的 last_activity_at（= max(updated_at, 最新留痕时间)），与列表排序同口径。
    // 兜底依次回退到留痕时间 / updated_at，保证后端字段缺失时仍能显示。
    const lastUpdateIso =
      task.last_activity_at ?? task.latest_progress_summary?.created_at ?? task.updated_at ?? null;
    const relativeUpdate = formatRelativeUpdate(lastUpdateIso);
    // 已完成任务的质量评分：仅展示 AI 评分；未生成时显示"评分待生成"占位，不再用规则估算误导
    const aiScore = task.status === "completed" ? aiScoreMap[task.task_id] ?? null : null;
    const aiScoreFetched = task.status === "completed" && task.task_id in aiScoreMap;
    const completionScore = aiScore
      ? {
          total: aiScore.total,
          grade: aiScore.grade,
          gradeLabel: aiScore.grade_label,
          dimensions: aiScore.dimensions.map((d) => ({
            key: d.key,
            label: d.label,
            score: d.score,
            max: d.max,
            detail: d.comment,
          })),
          summary: aiScore.summary,
          isFallback: Boolean(aiScore.fallback_reason),
        }
      : null;
    const gradeTone = completionScore ? getGradeTone(completionScore.grade) : null;
    const showPendingScoreBadge = task.status === "completed" && !aiScore;
    // 存储里的 category_path 对纯一级分类是「系统 / 默认 / 类型」三段（格式刻意不变，
    // 改成两段会让按位置解析的消费方把类型段误当子项）。展示时把「默认」那段剔掉。
    const hierarchySegments = splitCategoryPath(task.category_path)
      .filter((seg) => seg !== RD_DEFAULT_SUBPROJECT_LABEL)
      .slice(-2);
    const directSubtaskCount = task.subtasks?.length ?? 0;
    const hierarchyRoleLabel = task.parent_task_id
      ? t("子任务")
      : directSubtaskCount > 0
        ? t("主任务 · {count} 个下级", { count: directSubtaskCount })
        : null;
    const cardSummary =
      task.latest_progress_summary?.text?.trim()
      || task.description?.trim()
      || t("暂无进展摘要");
    const workItems = task.work_items ?? [];
    const completedWorkItemCount = workItems.reduce((count, item) => count + (item.done ? 1 : 0), 0);

    return (
      <motion.div
        key={task.task_id}
        style={{ contentVisibility: "auto", containIntrinsicSize: "360px" }}
        // 协同侧：筛选/切换泳道时卡片平滑重排归位（layout 动画）；研发侧维持原进场行为
        layout={spaciousCards && !shouldReduceMotion ? "position" : undefined}
        initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...RD_LIST_TRANSITION, delay: taskIdx * 0.03 }}
        onClick={() => onSelectTask(task, activityActor)}
        role="button"
        tabIndex={0}
        aria-label={t("打开任务：{title}", { title: visibleTaskTitle })}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelectTask(task, activityActor);
          }
        }}
        className={cn(
          "rd-horizon-task-card group relative cursor-pointer overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.05)] transition-[border-color,box-shadow] duration-200 hover:border-primary/20 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
        )}
      >
        <div className={cn("rd-horizon-task-card-body flex min-h-[220px] min-w-0 flex-col", spaciousCards ? "gap-3 px-5 py-4" : "gap-2.5 px-4 py-3.5")}>
          {researchCard && (
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {task.latest_progress_summary ? <>
                <OwnerAvatar name={task.latest_progress_summary.actor_name || t("未记录")}
                  userId={task.latest_progress_summary.actor_user_id} size="xs" />
                <span className="font-semibold text-foreground">{displayPersonName(task.latest_progress_summary.actor_name) || t("更新人未记录")}</span>
                <span>{t("更新进展")}</span>
                <time className="ml-auto tabular-nums" dateTime={task.latest_progress_summary.created_at} title={task.latest_progress_summary.created_at}>
                  {formatRelativeUpdate(task.latest_progress_summary.created_at)?.label}
                </time>
              </> : <span>{t("暂无进展记录")}</span>}
            </div>
          )}
          {/* 保留时间流排序；任务标题与最新工作内容是阅读主线。 */}
          <div className="flex items-start gap-3">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 overflow-hidden">
              {researchCard && (
                <>
                  <h3 className="mb-0.5 line-clamp-2 min-w-0 basis-full break-words text-balance text-[15px] font-bold leading-snug text-foreground">
                    <AutoTranslatedText text={visibleTaskTitle} />
                  </h3>
                  <span className="inline-flex shrink-0 items-center rounded-md bg-accent px-2 py-1 text-xs font-semibold text-primary">
                    {t(STATUS_CONFIG[task.status]?.label ?? task.status)}
                  </span>
                </>
              )}
              {hierarchySegments.map((segment) => (
                <span
                  key={segment}
                  className="rd-horizon-task-path max-w-[138px] truncate rounded-md bg-accent px-2 py-1 text-[10px] font-semibold text-primary"
                  title={segment}
                >
                  {segment}
                </span>
              ))}
              {hierarchyRoleLabel && (
                <span className="rd-horizon-structure-tag inline-flex shrink-0 items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-700">
                  <GitBranch className="h-3 w-3" />
                  {hierarchyRoleLabel}
                </span>
              )}
              {isSelectedPersonCollaborator && (
                <span className="rd-horizon-structure-tag inline-flex shrink-0 items-center gap-1 rounded-md bg-sky-50 px-2 py-1 text-[10px] font-semibold text-sky-700">
                  <Users className="h-3 w-3" />
                  {t("协助")}
                </span>
              )}
              {productionMirror && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-sky-50 px-2 py-1 text-[10px] font-semibold text-sky-700">
                  <Lock className="h-3 w-3" />
                  {t("研发同步 · 只读")}
                </span>
              )}
              {completionScore && gradeTone && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      onClick={(event) => event.stopPropagation()}
                      className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-bold", gradeTone.bg, gradeTone.border, gradeTone.text)}
                    >
                      <Sparkles className="h-3 w-3" />
                      AI {completionScore.total}/100 · {completionScore.grade}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" align="start" className="max-w-xs text-xs">
                    {completionScore.summary || t("AI 复盘评分")}
                  </TooltipContent>
                </Tooltip>
              )}
              {showPendingScoreBadge && (
                <span
                  onClick={(event) => event.stopPropagation()}
                  className="inline-flex items-center gap-1 rounded-md bg-slate-50 px-2 py-1 text-[10px] font-semibold text-muted-foreground"
                  title={aiScoreFetched ? t("评分待生成") : t("评分加载中")}
                >
                  <Sparkles className="h-3 w-3" />
                  {aiScoreFetched ? t("评分待生成") : t("评分加载中")}
                </span>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              {!researchCard && taskAttachmentCount > 0 && (
                <Button variant="unstyled"
                  type="button"
                  disabled={attachmentLoadingTaskId === task.task_id}
                  onClick={(event) => {
                    event.stopPropagation();
                    void openCompleteAttachmentCollection(task, taskAttachmentCount);
                  }}
                  className="rd-horizon-attachment-action inline-flex min-h-9 items-center gap-1 rounded-lg bg-accent px-2 text-[10px] font-semibold text-primary transition-colors hover:bg-primary/10 disabled:cursor-wait disabled:opacity-60"
                  aria-label={t("查看全部附件")}
                >
                  {attachmentLoadingTaskId === task.task_id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Paperclip className="h-3 w-3" />}
                  {t("附件")} <span className="tabular-nums">{taskAttachmentCount}</span>
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="unstyled"
                    type="button"
                    onClick={(event) => event.stopPropagation()}
                    className="rd-horizon-more-action flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition-colors hover:border-primary/20 hover:bg-accent hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                    aria-label={t("更多操作")}
                  >
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-40" onClick={(event) => event.stopPropagation()}>
                  <DropdownMenuItem onSelect={() => onSelectTask(task, activityActor)}>
                    <ArrowRight className="h-4 w-4" />
                    {t("查看任务")}
                  </DropdownMenuItem>
                  {researchCard && taskAttachmentCount > 0 && (
                    <DropdownMenuItem
                      disabled={attachmentLoadingTaskId === task.task_id}
                      onSelect={() => { void openCompleteAttachmentCollection(task, taskAttachmentCount); }}
                    >
                      <Paperclip className="h-4 w-4" />
                      {t("查看全部附件")} · {taskAttachmentCount}
                    </DropdownMenuItem>
                  )}
                  {!productionMirror && showProductionSyncAction && onToggleProductionSync && (
                    <DropdownMenuItem
                      disabled={syncingProductionTaskId === task.task_id}
                      onSelect={() => onToggleProductionSync(task)}
                    >
                      {syncingProductionTaskId === task.task_id
                        ? <RefreshCw className="h-4 w-4 animate-spin" />
                        : productionSynced
                          ? <RotateCcw className="h-4 w-4" />
                          : <RefreshCw className="h-4 w-4" />}
                      {productionSynced ? t("撤销同步") : t("同步到生产驾驶舱")}
                    </DropdownMenuItem>
                  )}
                  {!productionMirror && canReassign && onReassignTask && task.status !== "completed" && (
                    <DropdownMenuItem onSelect={() => onReassignTask(task)}>
                      <UserCog className="h-4 w-4" />
                      {t("转派")}
                    </DropdownMenuItem>
                  )}
                  {!productionMirror && showDeleteTaskAction && onDeleteTask && (
                    <DropdownMenuItem variant="destructive" onSelect={() => onDeleteTask(task)}>
                      <Trash2 className="h-4 w-4" />
                      {t("删除")}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {!researchCard && (
            <h3 className="line-clamp-2 break-words text-balance text-[15px] font-bold leading-snug text-slate-900">
              <AutoTranslatedText text={visibleTaskTitle} />
            </h3>
          )}

          {/* ─── 备注回执状态条（管理视角：他人给任务留的备注是否被目标人查看/跟进） ─── */}
          {(() => {
            const receipt = noteReceipts[task.task_id];
            if (!receipt) return null;
            const unread = receipt.state === "unread";
            return (
              <div
                className={cn(
                  "rd-horizon-note-receipt flex items-center gap-1.5 rounded-md border-l-[3px] px-2.5 py-1.5 text-xs font-medium",
                  unread ? "border-red-400 bg-red-50 text-red-700" : "border-amber-400 bg-amber-50 text-amber-700",
                )}
                title={`${receipt.author_name}${t("的备注")}：${receipt.excerpt}`}
              >
                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", unread ? "bg-red-500" : "bg-amber-500")} />
                <span className="truncate">
                  {receipt.author_name}{t("的备注")} · {unread ? t("待查看") : t("已查看")} · {t("给")}{receipt.target_name}
                </span>
              </div>
            );
          })()}

          {/* 无进展时明确这是任务说明，不将描述伪装为成员更新。 */}
          {researchCard && !task.latest_progress_summary?.text?.trim() && <span className="text-xs text-muted-foreground">{t("任务说明")}</span>}
          <AutoTranslatedText
            as="p"
            text={cardSummary}
            className="rd-horizon-task-summary line-clamp-3 min-h-10 break-words text-pretty text-sm leading-6 text-foreground"
          />

          {researchCard && <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <div className="flex min-w-0 gap-1"><dt>{t("负责人")}</dt><dd className="truncate" title={displayPersonName(task.primary_owner)}>{displayPersonName(task.primary_owner) || t("待指派")}</dd></div>
            <div className="flex gap-1"><dt>{t("截止")}</dt><dd className="tabular-nums">{task.due_date || t("未设置")}</dd></div>
          </dl>}

          {hasLoadedAttachments && (
            <TaskAttachmentStrip
              attachments={taskAttachments}
              totalCount={taskAttachmentCount}
              loadingFull={attachmentLoadingTaskId === task.task_id}
              priority={taskIdx < 2}
              onOpenGallery={(startIdx) => {
                void openCompleteImageGallery(
                  task,
                  taskImages,
                  startIdx,
                  taskAttachmentCount,
                );
              }}
              onOpenAll={() => {
                void openCompleteAttachmentCollection(
                  task,
                  taskAttachmentCount,
                );
              }}
            />
          )}

          {/* ─── 进度条：与参考卡片一致，放在执行信息之前 ─── */}
          {!researchCard && <div className="mt-auto flex items-center gap-2 pt-0.5">
            <div className="rd-horizon-progress-track h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
              <motion.div
                className={cn("rd-horizon-task-progress h-full rounded-full", task.progress === 100 && "rd-horizon-task-progress--complete")}
                initial={shouldReduceMotion ? false : { scaleX: 0 }}
                animate={{ scaleX: task.progress / 100 }}
                transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.28, ease: RD_MOTION_EASE, delay: taskIdx * 0.02 }}
                style={{
                  width: "100%",
                  transformOrigin: "left center",
                  background: task.progress === 100 ? "#10b981" : accentColor,
                }}
              />
            </div>
            <span className="w-9 shrink-0 text-right text-xs font-bold tabular-nums text-slate-700">
              {task.progress}%
            </span>
          </div>}

          {/* 参考卡片尾部：优先级 / 截止 / 风险在左，更新人与头像在右。 */}
          <div className="rd-horizon-task-footer flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 border-t border-slate-100 pt-2 text-[10px] text-slate-500">
            <span
              data-priority={researchCard ? undefined : priorityKey}
              className={cn("rd-horizon-priority inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-semibold", researchCard ? "text-muted-foreground" : [pCfg.bg, pCfg.text])}
            >
              {!researchCard && <Flame className="h-3 w-3" />}
              {t(`${pCfg.label}优先`)}
            </span>
            {!researchCard && task.due_date && (
              <span className="inline-flex items-center gap-1">
                <CalendarClock className="h-3 w-3 text-muted-foreground" />
                {t("截止：")}{task.due_date.slice(5)}
              </span>
            )}
            {isRisk && (
              <span className="inline-flex items-center gap-1 rounded-md bg-red-50 px-1.5 py-0.5 font-semibold text-red-600">
                <AlertTriangle className="h-3 w-3" />
                {t("风险")}
              </span>
            )}
            {/* 协同专属：阻塞时长显性化（其他驾驶舱不显示） */}
            {isUsCollabWorkspace() && task.status === "paused_blocked" && blockedDaysOf(task) != null && (
              <span className="inline-flex items-center gap-0.5 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700">
                {t("已阻塞 {n} 天", { n: blockedDaysOf(task) })}
              </span>
            )}
            {workItemsFeatureEnabled() && workItems.length > 0 && (
              <span
                className="inline-flex items-center gap-0.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500"
                title={t("工作项 {done}/{total}", { done: completedWorkItemCount, total: workItems.length })}
              >
                <ListChecks className="h-3 w-3" />
                {completedWorkItemCount}/{workItems.length}
              </span>
            )}
            {researchCard && task.progress > 0 && <span className="tabular-nums text-muted-foreground">{t("进度")} {task.progress}%</span>}
            <span className="ml-auto inline-flex min-w-0 items-center gap-1.5 text-muted-foreground">
              {relativeUpdate && (
                // shrink-0 + nowrap：这行与头像、姓名共享空间，不锁住就会被挤成
                // 「更新：19 天 / 前」这样的折行。空间不足时让姓名去截断（它有 truncate）。
                <span className={cn("shrink-0 whitespace-nowrap", RELATIVE_UPDATE_TONE_CLASS[relativeUpdate.tone])}>
                  {t("更新：")}{relativeUpdate.label}
                </span>
              )}
              {!researchCard && <><OwnerAvatar
                name={task.latest_progress_summary?.actor_name || task.primary_owner}
                userId={task.latest_progress_summary
                  ? task.latest_progress_summary.actor_user_id
                  : task.primary_owner_user_id}
                size="xs"
              />
              <span
                className="min-w-0 max-w-[72px] truncate font-medium text-slate-600 xl:max-w-[8rem]"
                title={displayPersonName(task.latest_progress_summary?.actor_name || task.primary_owner)}
              >
                {displayPersonName(task.latest_progress_summary?.actor_name || task.primary_owner)}
              </span></>}
            </span>
          </div>
        </div>
      </motion.div>
    );
  };

  return (
    <>
      {/* ── Gallery Lightbox ──
          必须真的 portal 到 body：就地渲染时 z-[90] 会被祖先的 motion 动画
          （transform / opacity 都会新建层叠上下文）关在里面，于是同样 portal 到
          body 的「退出大屏」按钮（z-40）反而画在上层，盖住右上角的关闭按钮 ——
          大屏模式下看图就关不掉。层级数值维持本文件既有阶梯（弹窗 60/70/80 →
          附件集合 85 → 看图 90），无需抬高。
          AnimatePresence 连同子组件整体搬进 portal，退场动画的父子关系不变。 */}
      {typeof document !== "undefined" && createPortal(
        <AnimatePresence>
          {galleryState && (
            <ImageGallery
              images={galleryState.images}
              startIndex={galleryState.startIndex}
              onClose={() => setGalleryState(null)}
            />
          )}
        </AnimatePresence>,
        document.body,
      )}
      {attachmentCollectionState && (
        <TaskAttachmentCollectionDialog
          taskTitle={attachmentCollectionState.taskTitle}
          attachments={attachmentCollectionState.attachments}
          onClose={() => setAttachmentCollectionState(null)}
        />
      )}

      <motion.div
        initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={RD_PANEL_TRANSITION}
        ref={setTaskStreamEl}
        className="rd-horizon-task-stream overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-12px_rgba(15,23,42,0.10)]"
      >
        <Tabs value={activeTab} onValueChange={handleTabChange} className="gap-0">

          {/* ── INS Stories-style 人员导航栏 (with visible horizontal scrollbar) ──
              外层 flex 承载底边框/底色：头像区可横向滚动，右端搜索控件钉死不随之滚走。 */}
          <div className="rd-horizon-people-nav flex w-full min-w-0 flex-col items-stretch border-b border-border bg-slate-50/50 sm:flex-row sm:items-center sm:pr-4">
          <TabsList className="rd-horizon-people-list flex h-auto min-w-0 flex-1 snap-x snap-proximity justify-start gap-0 overflow-x-auto overscroll-x-contain rounded-none border-none bg-transparent px-4 pt-4 pb-2 touch-pan-x [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300/70 [&::-webkit-scrollbar-thumb:hover]:bg-slate-400">

            {/* 管理员视角 — 所有活跃任务入口；详情沿用原权限规则，不附加成员筛选 */}
            <TabsTrigger
              value="all"
              aria-label={t("管理员视角") + ` · ${allActiveTasks.length}`}
              className="rd-horizon-person-tab flex min-h-11 min-w-24 shrink-0 snap-start flex-col items-center gap-1.5 rounded-none border-none bg-transparent px-3 py-0 shadow-none outline-none ring-0 transition-none focus-visible:ring-2 focus-visible:ring-primary/30 data-[state=active]:bg-transparent"
            >
              <div className="relative">
                <div
                  className="rd-horizon-admin-ring rd-horizon-avatar-ring flex h-[54px] w-[54px] items-center justify-center rounded-full p-[2.5px] transition-colors duration-200"
                  style={{
                    background: activeTab === "all"
                      ? "var(--primary)"
                      : risks.length > 0
                        ? "#dc2626"
                        : "#94a3b8",
                  }}
                >
                  <div className={cn(
                    "flex h-full w-full items-center justify-center rounded-full bg-white transition-[padding]",
                    activeTab === "all" ? "p-[2px]" : "p-0",
                  )}>
                    <div className="rd-horizon-avatar-core flex h-full w-full items-center justify-center rounded-full bg-accent">
                      <ListChecks className={cn("h-5 w-5 transition-colors", activeTab === "all" ? "text-primary" : "text-slate-500")} />
                    </div>
                  </div>
                </div>
              </div>
              <span className={cn("rd-horizon-person-name text-[10px] font-semibold leading-none", activeTab === "all" ? "text-primary" : "text-slate-500")}>
                {t("管理员视角")}
              </span>
              <span className="rd-horizon-total-count rounded-md bg-muted px-1.5 py-0.5 text-xs font-semibold tabular-nums">{allActiveTasks.length}</span>
            </TabsTrigger>

            {/* Per-person Stories avatars */}
            {personLoads.map((p) => {
              const ratio = p.max > 0 ? p.count / p.max : 0;
              const accentColor = loadRingColor(ratio, p.onLeave);
              const isActive = activeTab === p.key;
              const initial = p.name.replace(/\(.+?\)/g, "").trim().slice(0, 1) || "?";
              const avatarUrl = resolveAvatar(p.name, p.user_id);
              return (
                <TabsTrigger
                  key={p.key}
                  value={p.key}
                  aria-label={`${p.name} · ${p.count}`}
                  title={`${p.name} · ${p.count}`}
                  className="rd-horizon-person-tab flex min-h-11 min-w-24 shrink-0 snap-start flex-col items-center gap-1.5 rounded-none border-none bg-transparent px-3 py-0 shadow-none outline-none ring-0 transition-none focus-visible:ring-2 focus-visible:ring-primary/30 data-[state=active]:bg-transparent"
                >
                  <div className="relative">
                    <div
                      className="rd-horizon-avatar-ring flex h-[54px] w-[54px] items-center justify-center rounded-full transition-[padding] duration-200"
                      style={{
                        background: p.onLeave ? "#e2e8f0" : accentColor,
                        padding: isActive ? "2.5px" : "2px",
                      }}
                    >
                      <div className={cn("flex h-full w-full items-center justify-center rounded-full bg-white", isActive ? "p-[2px]" : "p-[1.5px]")}>
                        {avatarUrl ? (
                          <img
                            src={avatarUrl}
                            alt={p.name}
                            loading="lazy"
                            className={cn("h-full w-full rounded-full object-cover", p.onLeave && "opacity-50")}
                          />
                        ) : (
                          <div className={cn("flex h-full w-full items-center justify-center rounded-full text-sm font-bold text-white select-none", hashColor(p.name), p.onLeave && "opacity-50")}>
                            {initial}
                          </div>
                        )}
                      </div>
                    </div>
                    {p.onLeave && (
                      <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 rounded-sm bg-amber-400 px-1 text-[8px] font-black text-white leading-none py-0.5">
                        {t("假")}
                      </span>
                    )}
                  </div>
                  <span className={cn("rd-horizon-person-name max-w-[56px] truncate text-[10px] font-semibold leading-none", isActive ? "text-primary" : "text-slate-500")}>
                    {p.name}
                  </span>
                  <span className="rd-horizon-load-count rounded-md bg-muted px-1.5 py-0.5 text-xs font-semibold tabular-nums">{p.count}</span>
                  {isActive && (
                    <motion.span
                      layoutId="cockpit-tab-dot"
                      className="rd-horizon-person-indicator mt-0 h-1 w-4 rounded-full"
                      style={{ background: accentColor }}
                      transition={{ duration: 0.22, ease: RD_MOTION_EASE }}
                    />
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>

          {/* 搜索常驻人员栏右侧；与顶栏共享关键词，大屏和普通视图保持同一个输入框。 */}
          <div className="rd-horizon-search flex w-full shrink-0 items-center px-4 pb-3 sm:ml-2 sm:w-auto sm:px-0 sm:pb-0">
              <label className="relative block w-full sm:w-auto">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  ref={searchInputRef}
                  type="search"
                  value={cockpitKeyword}
                  onChange={(e) => setCockpitKeyword(e.target.value)}
                  onCompositionStart={startSearchComposition}
                  onCompositionEnd={(e) => endSearchComposition(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (searchComposingRef.current || e.nativeEvent.isComposing || e.keyCode === 229) return;
                    if (e.key === "Escape") {
                      e.preventDefault();
                      clearSearchAndRestoreFocus();
                    }
                  }}
                  placeholder={t("搜索任务全部内容")}
                  aria-label={t("搜索任务全部内容")}
                  aria-describedby="rd-cockpit-search-results"
                  className="min-h-11 w-full rounded-full border border-slate-200 bg-white pl-8 pr-16 text-xs text-slate-700 shadow-sm outline-none transition-[border-color,box-shadow] focus:border-primary/50 focus:ring-2 focus:ring-primary/15 sm:w-52"
                />
                <span
                  id="rd-cockpit-search-results"
                  className={cn(
                    "rd-horizon-search-count pointer-events-none absolute right-9 top-1/2 -translate-y-1/2 text-[10px] font-semibold tabular-nums text-primary",
                    !cockpitSearch && "sr-only",
                  )}
                  aria-live="polite"
                >
                  {searchPending ? t("筛选中…") : t("{n} 条", { n: cockpitHitCount })}
                </span>
                {cockpitKeyword ? (
                  <Button variant="unstyled"
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setCockpitKeyword("");
                      searchInputRef.current?.focus();
                    }}
                    className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                    aria-label={t("清空搜索")}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
              </label>
          </div>
          </div>

          {/* ── 当前 KPI 筛选条 ── */}
          {kpiFilter !== "all" && (
            <div className="rd-horizon-filter-bar flex flex-col items-stretch justify-between gap-3 border-b border-border bg-accent/50 px-4 py-2 text-xs sm:flex-row sm:items-center">
              <div className="flex min-w-0 items-center gap-2">
                <span className="rd-horizon-filter-label inline-flex shrink-0 items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-primary ring-1 ring-primary/20">
                  <ListChecks className="h-3 w-3" />
                  {t("当前筛选：")}
                  <span className="ml-0.5">{t(KPI_FILTER_LABEL[kpiFilter])}</span>
                </span>
                <span className="truncate text-slate-500">
                  {t("共 {count} 个任务符合此筛选", { count: allActiveTasks.length })}
                </span>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {kpiFilter === "completed" && canReassign && (
                  <>
                    <Button variant="unstyled"
                      type="button"
                      onClick={() => handleBackfillScores(false)}
                      disabled={backfillBusy}
                      className="rd-horizon-brand-control inline-flex min-h-9 shrink-0 items-center gap-1 rounded-md border border-primary/20 bg-white px-2 text-[11px] font-semibold text-primary transition-colors hover:border-primary/35 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                      title={t("一键执行：① 自动抽取附件文本（OCR/文档/视觉） → ② 调 AI 评分。已抽取/已评分的会跳过（幂等）。")}
                    >
                      {backfillBusy ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Sparkles className="h-3 w-3" />
                      )}
                      {backfillBusy ? t("抽取+评分中…") : t("AI 复盘评分")}
                    </Button>
                    <Button variant="unstyled"
                      type="button"
                      onClick={() => {
                        if (
                          window.confirm(
                            t("将对【所有已完成任务】按最新评分标准重新评分，并覆盖现有分数（消耗 AI 额度、耗时较长）。\n通常仅在评分标准调整后执行一次。确定继续？"),
                          )
                        ) {
                          void handleBackfillScores(true);
                        }
                      }}
                      disabled={backfillBusy}
                      className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-md border border-amber-200 bg-white px-2 text-[11px] font-semibold text-amber-700 transition-colors hover:border-amber-300 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60"
                      title={t("强制重算：对所有已完成任务按最新评分标准重新评分并覆盖旧分。用于评分标准升级后统一刷新历史分。")}
                    >
                      <RotateCcw className="h-3 w-3" />
                      {t("按新标准重算")}
                    </Button>
                    <Button variant="unstyled"
                      type="button"
                      onClick={handleBatchExportReports}
                      disabled={batchExportBusy}
                      className="rd-horizon-brand-control inline-flex min-h-9 shrink-0 items-center gap-1 rounded-md border border-primary/20 bg-white px-2 text-[11px] font-semibold text-primary transition-colors hover:border-primary/35 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                      title={t("把当前范围（管理员视角 / 选中成员）已完成且已评分的任务，汇总成一份多页正式报告，可在打印对话框中选择「另存为 PDF」下载。")}
                    >
                      {batchExportBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}
                      {batchExportBusy ? t("汇总中…") : t("批量导出报告")}
                    </Button>
                  </>
                )}
                {canReassign && (
                  <Button variant="unstyled"
                    type="button"
                    onClick={handleBackfillExtraction}
                    disabled={extractionBackfillBusy}
                    className="rd-horizon-brand-control inline-flex min-h-9 shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-600 transition-colors hover:border-primary/20 hover:bg-accent hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
                    title={t("仅抽取附件文本（不触发评分）。用于进行中/暂停任务的附件抽取，便于知识库 RAG 检索；已完成任务请直接用 AI 复盘评分（已包含抽取）。")}
                  >
                    {extractionBackfillBusy ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <FileText className="h-3 w-3" />
                    )}
                    {extractionBackfillBusy ? t("抽取中…") : t("仅抽取附件")}
                  </Button>
                )}
                {onClearKpiFilter && (
                  <Button variant="unstyled"
                    type="button"
                    onClick={onClearKpiFilter}
                    className="rd-horizon-brand-control inline-flex min-h-9 shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-600 transition-colors hover:border-primary/20 hover:bg-accent hover:text-primary"
                  >
                    <X className="h-3 w-3" />
                    {t("清除筛选")}
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* ── Animated tab content area ── */}
          <div className="rd-horizon-task-feed relative min-w-0 overflow-hidden bg-slate-50/40" aria-busy={searchPending}>
            <AnimatePresence mode="wait" custom={direction}>
              <motion.div
                key={activeTab}
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.22, ease: RD_MOTION_EASE }}
              >

                {/* ── "全部" Tab — 全部活跃任务，按更新时间倒序 ── */}
                {activeTab === "all" && (() => {
                  const visibleCount = visibleCounts["all"] ?? taskPageSize;
                  const shownTasks = allActiveTasks.slice(0, visibleCount);
                  const hasMore = visibleCount < allActiveTasks.length;
                  const allAccentColor = "var(--primary)";

                  return (
                    <div>
                      <AnimatePresence>
                        {loadingNotes && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={RD_FAST_TRANSITION}
                            className="rd-horizon-loading-strip flex items-center gap-2 border-b border-border bg-accent px-4 py-2 text-[11px] text-primary"
                            role="status"
                            aria-live="polite"
                          >
                            <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                            {t("正在加载任务附件图片…")}
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {allActiveTasks.length === 0 ? (
                        <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 px-6 py-12 text-center text-sm text-slate-500" role="status">
                          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-primary">
                            <Search className="h-5 w-5" aria-hidden="true" />
                          </span>
                          <h3 className="text-balance text-base font-semibold text-slate-900">
                            {cockpitSearch
                              ? t("没有匹配「{keyword}」的任务", { keyword: cockpitSearch })
                              : kpiFilter === "all"
                                ? t("暂无任务")
                                : t("当前筛选「{filter}」下暂无任务", { filter: t(KPI_FILTER_LABEL[kpiFilter]) })}
                          </h3>
                          <p className="max-w-md text-pretty text-xs leading-5 text-slate-500">
                            {cockpitSearch
                              ? t("请调整关键词，或清除搜索查看当前范围内的全部任务。")
                              : kpiFilter === "all"
                                ? t("当前工作区还没有可展示的非归档任务。")
                                : t("请清除筛选，或切换其他决策指标继续查看。")}
                          </p>
                          <div className="flex flex-wrap items-center justify-center gap-2">
                          {cockpitSearch && (
                            <Button variant="unstyled"
                              type="button"
                              onClick={clearSearchAndRestoreFocus}
                              className="inline-flex min-h-11 items-center gap-1 rounded-md border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-600 transition-colors hover:border-primary/20 hover:bg-accent hover:text-primary"
                            >
                              <X className="h-3 w-3" />
                              {t("清除搜索")}
                            </Button>
                          )}
                          {kpiFilter !== "all" && onClearKpiFilter && (
                            <Button variant="unstyled"
                              type="button"
                              onClick={onClearKpiFilter}
                              className="inline-flex min-h-11 items-center gap-1 rounded-md border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-600 transition-colors hover:border-primary/20 hover:bg-accent hover:text-primary"
                            >
                              <X className="h-3 w-3" />
                              {t("清除筛选")}
                            </Button>
                          )}
                          </div>
                        </div>
                      ) : (
                        <div
                          ref={setScrollRef}
                          className={cn("cockpit-scroll overflow-y-auto", headerCollapsed ? "overscroll-y-contain" : "overscroll-y-auto")}
                          style={flowHeightStyle(headerCollapsed)}
                          onScroll={(e) => handleTaskScroll(e, "all", allActiveTasks.length)}
                        >
                          <div className={cn("rd-horizon-masonry flex items-start", spaciousCards ? "gap-4 px-4 py-4" : "gap-2.5 px-4 py-3")}>
                            {distributeIntoColumns(shownTasks, masonryColumns).map((column, colIdx) => (
                              <div key={colIdx} className={cn("rd-horizon-masonry-column flex min-w-0 flex-1 flex-col", spaciousCards ? "gap-4" : "gap-2.5")}>
                                <AnimatePresence>
                                  {column.map((task, rowIdx) =>
                                    renderTaskCard(task, colIdx + rowIdx * masonryColumns, allAccentColor),
                                  )}
                                </AnimatePresence>
                              </div>
                            ))}
                          </div>

                          {hasMore ? (
                            <Button variant="unstyled"
                              type="button"
                              onClick={() => loadNextTaskPage("all", allActiveTasks.length)}
                              className="flex min-h-11 w-full cursor-pointer items-center justify-center gap-1.5 py-3.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent/50 hover:text-primary"
                            >
                              <ChevronDown className="h-3 w-3" />
                              <span>{t("继续向下滚动 · 已显示")} <span className="font-semibold tabular-nums text-slate-500">{shownTasks.length}</span> / {t("共")} <span className="font-semibold tabular-nums text-slate-500">{allActiveTasks.length}</span> {t("个任务")}</span>
                            </Button>
                          ) : (
                            <div className="flex items-center justify-center gap-1.5 py-3.5 text-[11px] text-muted-foreground">
                              <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                              <span>
                                {t("已显示全部")} <span className="font-semibold tabular-nums text-slate-500">{allActiveTasks.length}</span> {t("个任务")}
                                {kpiFilter === "all" && !cockpitSearch && risks.length > 0 && (
                                  <> · <span className="text-red-500 font-semibold">{t("{n} 个风险", { n: risks.length })}</span></>
                                )}
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* ── Per-person Tab ── */}
                {activeTab !== "all" && (() => {
                  const p = personLoads.find((x) => x.key === activeTab);
                  if (!p) return null;
                  const segments = personTasksMap.get(p.key) ?? { primary: [], collaborating: [] };
                  const primaryTasks = segments.primary;
                  const collabTasks = segments.collaborating;
                  const tasks = [...primaryTasks, ...collabTasks];
                  // 分页只驱动主责段：协助段是下钻上下文，展开后一次给完。
                  const visibleCount = visibleCounts[p.key] ?? taskPageSize;
                  const shownTasks = primaryTasks.slice(0, visibleCount);
                  const hasMore = visibleCount < primaryTasks.length;
                  const collabExpanded = expandedCollabTabs.has(p.key);
                  const ratio = p.max > 0 ? p.count / p.max : 0;
                  const accentColor = loadRingColor(ratio, p.onLeave);
                  const initial = p.name.replace(/\(.+?\)/g, "").trim().slice(0, 1) || "?";
                  return (
                    <div>
                      {/* 附件图片加载中提示 */}
                      <AnimatePresence>
                        {loadingNotes && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={RD_FAST_TRANSITION}
                            className="rd-horizon-loading-strip flex items-center gap-2 border-b border-border bg-accent px-4 py-2 text-[11px] text-primary"
                            role="status"
                            aria-live="polite"
                          >
                            <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                            {t("正在加载任务附件图片…")}
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* Task list — 与"全部"相同的 INS 风格滚动 feed */}
                      {tasks.length === 0 ? (
                        <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 px-6 py-12 text-center text-sm text-slate-500" role="status">
                          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-primary">
                            <Users className="h-5 w-5" aria-hidden="true" />
                          </span>
                          <h3 className="text-balance text-base font-semibold text-slate-900">
                            {cockpitSearch
                              ? t("该成员下没有匹配「{keyword}」的任务", { keyword: cockpitSearch })
                              : kpiFilter === "all" ? t("该成员当前暂无任务") : t("该成员当前筛选「{filter}」下暂无任务", { filter: t(KPI_FILTER_LABEL[kpiFilter]) })}
                          </h3>
                          <p className="max-w-md text-pretty text-xs leading-5 text-slate-500">
                            {cockpitSearch
                              ? t("请调整关键词，或清除搜索查看该成员的主责与协助任务。")
                              : kpiFilter === "all"
                                ? t("该成员当前没有符合工作区范围的任务。")
                                : t("请清除筛选，或切换其他人员继续查看。")}
                          </p>
                          <div className="flex flex-wrap items-center justify-center gap-2">
                          {cockpitSearch && (
                            <Button variant="unstyled"
                              type="button"
                              onClick={clearSearchAndRestoreFocus}
                              className="inline-flex min-h-11 items-center gap-1 rounded-md border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-600 transition-colors hover:border-primary/20 hover:bg-accent hover:text-primary"
                            >
                              <X className="h-3 w-3" />
                              {t("清除搜索")}
                            </Button>
                          )}
                          {kpiFilter !== "all" && onClearKpiFilter && (
                            <Button variant="unstyled"
                              type="button"
                              onClick={onClearKpiFilter}
                              className="inline-flex min-h-11 items-center gap-1 rounded-md border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-600 transition-colors hover:border-primary/20 hover:bg-accent hover:text-primary"
                            >
                              <X className="h-3 w-3" />
                              {t("清除筛选")}
                            </Button>
                          )}
                          </div>
                        </div>
                      ) : (
                        <div
                          ref={setScrollRef}
                          className={cn("cockpit-scroll overflow-y-auto", headerCollapsed ? "overscroll-y-contain" : "overscroll-y-auto")}
                          style={flowHeightStyle(headerCollapsed)}
                          onScroll={(e) => handleTaskScroll(e, p.key, primaryTasks.length)}
                        >
                          {/* ── 主责段：领导最关心「这个人负责什么」，占第一屏 ── */}
                          <div className="flex items-center gap-2 px-4 pt-3 text-[11px] font-semibold text-slate-500">
                            <span className="h-3 w-0.5 rounded-full bg-primary" />
                            <span>{t("主责")}</span>
                            <span className="tabular-nums text-muted-foreground">{primaryTasks.length}</span>
                          </div>
                          {primaryTasks.length === 0 ? (
                            <div className="px-4 py-6 text-center text-[12px] text-muted-foreground">{t("该成员当前没有主责任务")}</div>
                          ) : (
                            <div className={cn("rd-horizon-masonry flex items-start", spaciousCards ? "gap-4 px-4 py-4" : "gap-2.5 px-4 py-3")}>
                              {distributeIntoColumns(shownTasks, masonryColumns).map((column, colIdx) => (
                                <div key={colIdx} className={cn("rd-horizon-masonry-column flex min-w-0 flex-1 flex-col", spaciousCards ? "gap-4" : "gap-2.5")}>
                                  <AnimatePresence>
                                    {column.map((task, rowIdx) =>
                                      renderTaskCard(task, colIdx + rowIdx * masonryColumns, accentColor),
                                    )}
                                  </AnimatePresence>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* ── 协助段：默认折叠，但折叠态也要露出数量，一眼知道他还搭了几件事 ── */}
                          {collabTasks.length > 0 && (
                            <div className="border-t border-slate-100">
                              <Button variant="unstyled"
                                type="button"
                                onClick={() => toggleCollabSegment(p.key)}
                                aria-expanded={collabExpanded}
                                className="flex w-full items-center gap-2 px-4 py-2.5 text-[11px] font-semibold text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700"
                              >
                                <span className="h-3 w-0.5 rounded-full bg-slate-300" />
                                <span>{t("协助")}</span>
                                <span className="tabular-nums text-muted-foreground">{collabTasks.length}</span>
                                <ChevronDown className={cn("ml-auto h-3.5 w-3.5 transition-transform", collabExpanded && "rotate-180")} />
                              </Button>
                              {collabExpanded && (
                                <div className={cn("rd-horizon-masonry flex items-start", spaciousCards ? "gap-4 px-4 pb-4" : "gap-2.5 px-4 pb-3")}>
                                  {distributeIntoColumns(collabTasks, masonryColumns).map((column, colIdx) => (
                                    <div key={colIdx} className={cn("rd-horizon-masonry-column flex min-w-0 flex-1 flex-col", spaciousCards ? "gap-4" : "gap-2.5")}>
                                      <AnimatePresence>
                                        {column.map((task, rowIdx) =>
                                          renderTaskCard(task, colIdx + rowIdx * masonryColumns, accentColor),
                                        )}
                                      </AnimatePresence>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}

                          {/* 底部状态 */}
                          {hasMore ? (
                            <Button variant="unstyled"
                              type="button"
                              onClick={() => loadNextTaskPage(p.key, primaryTasks.length)}
                              className="flex min-h-11 w-full cursor-pointer items-center justify-center gap-1.5 py-3.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent/50 hover:text-primary"
                            >
                              <ChevronDown className="h-3 w-3" />
                              <span>{t("继续向下滚动 · 已显示主责")} <span className="font-semibold tabular-nums text-slate-500">{shownTasks.length}</span> / {t("共")} <span className="font-semibold tabular-nums text-slate-500">{primaryTasks.length}</span> {t("个任务")}</span>
                            </Button>
                          ) : tasks.length > 0 ? (
                            <div className="flex items-center justify-center gap-1.5 py-3.5 text-[11px] text-muted-foreground">
                              <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                              <span>
                                {t("已显示全部主责")} <span className="font-semibold tabular-nums text-slate-500">{primaryTasks.length}</span> {t("个任务")}
                                {/* 角标 = 主责且活跃；本段是其超集（另含已完成），故两数可以不同 */}
                                {kpiFilter === "all" && !cockpitSearch && (
                                  <> · {t("其中活跃 {count} 个（= 头像角标）", { count: p.count })}</>
                                )}
                                {collabTasks.length > 0 && <> · {t("另协助 {count} 个", { count: collabTasks.length })}</>}
                              </span>
                            </div>
                          ) : null}
                        </div>
                      )}
                    </div>
                  );
                })()}

              </motion.div>
            </AnimatePresence>
          </div>
        </Tabs>
      </motion.div>
    </>
  );
}
