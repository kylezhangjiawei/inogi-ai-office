import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { MentionSuggestionPanel, useMentions, type MentionCandidate } from "./components/MentionInput";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Loader2,
  MessageCircleMore,
  Pencil,
  Send,
  ShoppingCart,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "./components/ui/utils";
import { Button } from "./components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./components/ui/dialog";
import { Progress } from "./components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { useAnyPermission } from "./hooks/usePermission";
import { useAuth } from "./auth";
import { Input } from "./components/ui/input";
import { Textarea } from "./components/ui/textarea";
import { PERMISSIONS } from "./lib/permissions";
import { t, useI18n } from "./lib/i18n";
import { AutoTranslatedText } from "./components/TranslatableText";
import { AuditTimeline } from "./RDAuditTimeline";
import { addAuditLogNote, recordAudit, useAuditActor, type AuditLog, useAuditLogs } from "./lib/auditLog";
import { ProgressAttachmentGrid, ProgressNoteList, TaskImageGallery, formatRdFileSize } from "./RDProgressEvidence";
import { RDTaskConversation } from "./RDTaskConversation";
import {
  STATUS_CONFIG,
  PRIORITY_CONFIG,
  WorkItemsSection,
  HandoverDialog,
  AddCollaboratorsDialog,
  CompleteConfirmDialog,
  ApprovalActionDialog,
  MoveTaskDialog,
  SubmitConfirmDialog,
  TaskCompletionScoreCard,
  blobToDataUrl,
  buildSubtaskParentIndex,
  collectTopLevelTasks,
  displayPersonName,
  flattenTasks,
  OwnerAvatar,
  SubtaskBadge,
  type PersonProfile,
} from "./RDTaskManagementPage";
import { ProcurementActivitySection, ProcurementLinkChip, TransferToProcurementModal, useProcurementTaskLink } from "./procurement/components/rdInsertion";
import { createHttpIssueService } from "./lib/issue/issueHttpService";
import { getReviewTypeMeta } from "./lib/reviewTypes";
import {
  attachRdTaskToParent,
  blockedDaysOf,
  createRdTask,
  createRdTaskProgressNote,
  detachRdSubtask,
  fetchMergedTaskCategories,
  fetchRdPeople,
  fetchRdProducts,
  fetchRdTaskCategories,
  fetchRdTaskProgressNotes,
  getAttachmentPreviewUrl,
  getAttachmentUrl,
  markRdTaskNotesRead,
  moveRdTasks,
  updateRdTask,
  type RdCategory,
  type RdCollaborator,
  type RdPriority,
  type RdProductDef,
  type RdTask,
  type RdTaskProgressNote,
} from "./lib/rdApi";

type DetailTab = "notes" | "conversation" | "attachments" | "audit";

/** 模块级常量：保证 useAuditLogs 的订阅条件恒定，避免任何重订阅/重拉取。 */
const TASK_AUDIT_FILTER = { resourceType: "task" } as const;

/**
 * 研发任务 · 全屏详情页（双栏布局，与协同任务详情同款范式）：
 * 左栏为任务档案（字段表 / 人员 / 快捷操作），右主栏为纵向过程叙事
 * （描述 → 工作项 → 留痕/附件库/操作记录 Tab）。
 * 由 UsCollabTaskDetailPage 复刻并按研发功能裁剪：去掉协同专属的跨时区
 * LocalClock / AI 小结 / 导出过程报告，补充研发侧的分类路径字段。
 * 独立文件 + 独立路由（/rd-task/:taskId，无 /us-collab 前缀 → rdApi 自动落研发池），
 * 与协同详情页互不干扰。
 */
export default function RDTaskDetailPage() {
  const { taskId = "" } = useParams();
  const navigate = useNavigate();
  const shouldReduceMotion = useReducedMotion();
  const { lang } = useI18n(); // i18n：订阅语言切换（本页文案已 t() 化）
  void lang;
  const { user } = useAuth();
  const canView = useAnyPermission("page:rd-task-management");
  // 管理动作口径与驾驶舱抽屉的 canManageTaskFlow 一致
  const canManage = useAnyPermission(
    PERMISSIONS.RD_PROJECT_DIRECT,
    PERMISSIONS.RD_PROJECT_REVIEW_L1,
    PERMISSIONS.RD_PROJECT_REVIEW_L2,
    PERMISSIONS.RD_PEOPLE_MANAGE,
    PERMISSIONS.RD_TASK_REASSIGN,
  );
  const AUDIT_ACTOR = useAuditActor("研发管理员");

  const [task, setTask] = useState<RdTask | null>(null);
  const [allTasks, setAllTasks] = useState<RdTask[]>([]);
  // 子任务上下文：父子关系按「结构位置」建索引（存量子任务无 parent_task_id 字段，只认字段会漏判）
  const [subtaskParents, setSubtaskParents] = useState<Map<string, RdTask>>(() => new Map());
  const [topLevelTasks, setTopLevelTasks] = useState<RdTask[]>([]);
  const [showCreateSubtask, setShowCreateSubtask] = useState(false);
  const [showAttachSubtasks, setShowAttachSubtasks] = useState(false);
  const [detaching, setDetaching] = useState(false);
  /**
   * 留痕/操作记录的视图范围：
   * - 'all'  主线：本任务 + 全部子任务的记录混排，每条标出来源（只读，写入需先选定具体任务）
   * - 'self' 仅本任务（原行为，带撰写框）
   * - 其他   某个子任务的 task_id（带撰写框，写入落到该子任务）
   * 有子任务时默认落在主线。
   */
  const [traceScope, setTraceScope] = useState<string>("self");
  /** 各子任务的留痕（按 task_id 缓存），主线聚合与子任务视图共用。 */
  const [subtaskNotes, setSubtaskNotes] = useState<Record<string, RdTaskProgressNote[]>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [notes, setNotes] = useState<RdTaskProgressNote[]>([]);
  const [notesLoading, setNotesLoading] = useState(true);
  const [tab, setTab] = useState<DetailTab>("notes");
  const [discussionUnread, setDiscussionUnread] = useState(0);
  const [discussionThreadOpen, setDiscussionThreadOpen] = useState(false);
  const [people, setPeople] = useState<PersonProfile[]>([]);
  const [showHandover, setShowHandover] = useState(false);
  const [showEditInfo, setShowEditInfo] = useState(false);
  const [showAddCollab, setShowAddCollab] = useState(false);
  const [showComplete, setShowComplete] = useState(false);
  // ── 研发侧特有动作（与驾驶舱抽屉同口径）：提交审核 / 转采购 / 生成问题 / 移动类目 ──
  const issueService = useMemo(() => createHttpIssueService(), []);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [generatingIssue, setGeneratingIssue] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  // 转采购操作码（系统管理·权限目录可配），已转的跳转芯片保持只读可见
  const canTransferProc = useAnyPermission("proc-task:transfer");
  const [showMove, setShowMove] = useState(false);
  const [categories, setCategories] = useState<RdCategory[]>([]);
  const [products, setProducts] = useState<RdProductDef[]>([]);
  // 完成质量评分区收起/展开（默认展开但限高内滚，避免长点评把 Tab 区挤出视口）
  const [scoreOpen, setScoreOpen] = useState(true);
  const [showApproval, setShowApproval] = useState<"approve" | "reject" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [savingPriority, setSavingPriority] = useState(false);
  /** 点击人员后展示其名下任务的弹层（点任务跳转到该任务的详情页） */
  const [personTasksFor, setPersonTasksFor] = useState<string | null>(null);
  // ── 评论式留痕框（时间线底部常驻，「在哪看就在哪写」）──
  const [composerText, setComposerText] = useState("");
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const mentionCandidates = useMemo<MentionCandidate[]>(() => {
    const seen = new Set<string>();
    const out: MentionCandidate[] = [];
    const push = (name?: string | null, userId?: string | null, hint?: string) => {
      const nm = (name ?? "").trim();
      if (!nm || seen.has(nm)) return;
      seen.add(nm);
      out.push({ user_id: userId ?? null, name: nm, hint });
    };
    if (task) {
      push(task.primary_owner, task.primary_owner_user_id, t("主责人"));
      for (const c of task.collaborators ?? []) push(c.name, c.user_id, t("协作人"));
    }
    for (const p of people) push(p.name, p.user_id ?? null);
    return out;
  }, [task, people]);
  const mention = useMentions({ value: composerText, setValue: setComposerText, inputRef: composerRef, candidates: mentionCandidates });
  const [composerFiles, setComposerFiles] = useState<File[]>([]);
  const [composerItemId, setComposerItemId] = useState("");
  const [sendingNote, setSendingNote] = useState(false);
  /**
   * 审计日志按「任务」整类订阅，范围过滤在下方 useMemo 里做。
   * ⚠️ 不要把范围条件塞进 useAuditLogs 的 filter：它的 effect 依赖 filter 的字符串化值，
   * 条件一变就重跑 fetchRdAuditLogs()（全量拉取），点一次范围切换就多一次网络往返。
   * 日志本来就是全量取回再客户端过滤的，这里保持过滤条件恒定 → 每个任务只拉一次。
   */
  const allTaskAuditLogs = useAuditLogs(TASK_AUDIT_FILTER);
  const { task: procTask, setTask: setProcTask } = useProcurementTaskLink(taskId);

  // 视口内布局的可用高度：实测容器到视口顶的距离（覆盖全局顶栏/面包屑/内边距的任意组合），
  // 不猜固定偏移。lg 以下返回 null 走自然文档流。
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  useEffect(() => {
    const measure = () => {
      if (!rootRef.current || window.innerWidth < 1024) {
        setViewportHeight(null);
        return;
      }
      const top = rootRef.current.getBoundingClientRect().top + window.scrollY;
      setViewportHeight(Math.max(480, window.innerHeight - top - 24));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [loading]);

  // 竞态守卫：人员弹层跳转会快速切换 taskId，旧请求晚到不得覆盖新任务的状态
  const loadSeqRef = React.useRef(0);
  const loadTask = useCallback(async (opts?: { silent?: boolean }) => {
    const seq = ++loadSeqRef.current;
    if (!opts?.silent) setLoading(true);
    setLoadError("");
    try {
      const categories = await fetchMergedTaskCategories();
      if (seq !== loadSeqRef.current) return;
      const all = flattenTasks(categories.flatMap((c) => c.children.flatMap((s) => s.tasks)));
      setAllTasks(all);
      setSubtaskParents(buildSubtaskParentIndex(categories));
      setTopLevelTasks(collectTopLevelTasks(categories));
      const found = all.find((t) => t.task_id === taskId) ?? null;
      if (!found) setLoadError("任务不存在或已被删除");
      setTask(found);
    } catch (error) {
      if (seq !== loadSeqRef.current) return;
      setLoadError(error instanceof Error ? error.message : "任务加载失败");
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  }, [taskId]);

  // 秒开：驾驶舱/序列导航经 location.state 带来任务快照，先渲染再后台静默拉最新覆盖

  const location = useLocation();
  useEffect(() => {
    const seeded = (location.state as { task?: RdTask } | null)?.task;
    const hasSeed = Boolean(seeded && seeded.task_id === taskId);
    if (hasSeed) {
      setTask(seeded!);
      setLoading(false);
    }
    void loadTask({ silent: hasSeed });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadTask, taskId]);

  useEffect(() => {
    fetchRdPeople()
      .then((data) => setPeople(data.map((p) => ({ id: p.id, user_id: p.user_id ?? null, name: p.name, position: p.position ?? "" }))))
      .catch(() => setPeople([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setNotesLoading(true);
    fetchRdTaskProgressNotes(taskId)
      .then((data) => { if (!cancelled) { setNotes(data); void markRdTaskNotesRead(taskId).catch(() => {}); } })
      .catch(() => { if (!cancelled) setNotes([]); })
      .finally(() => { if (!cancelled) setNotesLoading(false); });
    return () => { cancelled = true; };
  }, [taskId]);

  const noteCountByItem = useMemo(() => {
    const counts = new Map<string, number>();
    for (const note of notes) {
      if (note.work_item_id) counts.set(note.work_item_id, (counts.get(note.work_item_id) ?? 0) + 1);
    }
    return counts;
  }, [notes]);

  // 子任务留痕：一层结构下数量有限，按 task_id 并行拉取（单任务路由带参与人可见性口径，
  // 比 listAllTaskProgressNotes 的全量拉取更省且权限语义正确）。
  const subtaskIdsKey = (task?.subtasks ?? []).map((s) => s.task_id).join(",");
  useEffect(() => {
    const ids = subtaskIdsKey ? subtaskIdsKey.split(",") : [];
    if (ids.length === 0) { setSubtaskNotes({}); return; }
    let cancelled = false;
    void Promise.all(
      ids.map((id) =>
        fetchRdTaskProgressNotes(id)
          .then((data) => [id, data] as const)
          .catch(() => [id, [] as RdTaskProgressNote[]] as const),
      ),
    ).then((pairs) => { if (!cancelled) setSubtaskNotes(Object.fromEntries(pairs)); });
    return () => { cancelled = true; };
  }, [subtaskIdsKey]);

  // 有子任务的任务默认落在「主线」；无子任务（或切换到别的任务）回到仅本任务。
  useEffect(() => {
    setTraceScope(subtaskIdsKey ? "all" : "self");
  }, [taskId, subtaskIdsKey]);

  // 讨论 Tab 没有「主线」选项（见范围条注释）→ 从主线切进讨论时落回仅主任务
  useEffect(() => {
    if (tab === "conversation") setTraceScope((prev) => (prev === "all" ? "self" : prev));
  }, [tab]);

  // ── 留痕视图范围（主线 / 本任务 / 某个子任务）────────────────────────────────

  const subtasks = useMemo(() => task?.subtasks ?? [], [task]);

  /** taskId → 任务标题（含子任务），供来源标签与合成日志取名。 */
  const traceTitleOf = useMemo(() => {
    const m = new Map<string, string>();
    if (task) m.set(taskId, task.title);
    for (const s of subtasks) m.set(s.task_id, s.title);
    return m;
  }, [task, taskId, subtasks]);

  /**
   * 留痕 id → 所属任务 id。用旁挂 Map 而不是往留痕对象上加字段：
   * 单任务范围可以直接复用原数组引用（零拷贝、引用稳定，不会让下游 memo 全部失效）。
   * 留痕 id 全局唯一（note-<ts>-<rand>），跨任务同表不会撞键。
   */
  const noteSourceOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of notes) m.set(n.id, taskId);
    for (const s of subtasks) for (const n of subtaskNotes[s.task_id] ?? []) m.set(n.id, s.task_id);
    return m;
  }, [notes, subtaskNotes, subtasks, taskId]);

  /** 当前范围下的留痕（主线按时间倒序混排；单任务范围原样返回，不做拷贝）。 */
  const scopedNotes = useMemo(() => {
    if (traceScope === "self") return notes;
    if (traceScope !== "all") return subtaskNotes[traceScope] ?? [];
    return [...notes, ...subtasks.flatMap((s) => subtaskNotes[s.task_id] ?? [])].sort((a, b) =>
      (b.created_at ?? "").localeCompare(a.created_at ?? ""),
    );
  }, [traceScope, notes, subtaskNotes, subtasks]);

  /** 讨论/留痕撰写指向的具体任务：主线与「仅主任务」都落到本任务，否则落到选中的子任务。 */
  const conversationTaskId = traceScope === "all" || traceScope === "self" ? taskId : traceScope;

  /** 当前范围覆盖的任务 id 集合，用于过滤审计日志。 */
  const traceTaskIds = useMemo(() => {
    if (traceScope === "all") return new Set([taskId, ...subtasks.map((s) => s.task_id)]);
    if (traceScope === "self") return new Set([taskId]);
    return new Set([traceScope]);
  }, [traceScope, taskId, subtasks]);

  const auditLogs = useMemo(
    () => allTaskAuditLogs.filter((log) => traceTaskIds.has(log.resource.id)),
    [allTaskAuditLogs, traceTaskIds],
  );

  const docAttachments = useMemo(
    () =>
      scopedNotes.flatMap((n) =>
        (n.attachments ?? [])
          .filter((att) => !(att.mime ?? "").startsWith("image/"))
          .map((att) => ({ att, createdAt: n.created_at, actor: n.actor?.name ?? "" })),
      ),
    [scopedNotes],
  );

  // 导出报告用：audit 记录 + 无对应 audit 的留痕合成条目（保证报告时间线完整）
  // 合成条目的 resource.id/name 取该留痕自身所属任务，主线视图下才能正确标出来源。
  const reportLogs = useMemo<AuditLog[]>(() => {
    const matchedNoteIds = new Set(
      auditLogs.map((log) => (typeof log.metadata?.note_id === "string" ? log.metadata.note_id : "")).filter(Boolean),
    );
    const orphanLogs: AuditLog[] = scopedNotes
      .filter((n) => !matchedNoteIds.has(n.id))
      .map((n) => ({
        id: `report-note-${n.id}`,
        timestamp: n.created_at,
        actor: { id: n.actor?.id ?? null, name: n.actor?.name ?? "研发成员", role: n.actor?.role ?? "研发成员" },
        action: "task.progress_updated" as const,
        resource: {
          type: "task" as const,
          id: noteSourceOf.get(n.id) ?? taskId,
          name: traceTitleOf.get(noteSourceOf.get(n.id) ?? taskId) ?? task?.title ?? "",
        },
        comment: n.text || "更新任务进度",
        metadata: { note_id: n.id, synthetic: true },
        source: "web" as const,
      }));
    return [...auditLogs, ...orphanLogs];
  }, [auditLogs, scopedNotes, noteSourceOf, traceTitleOf, taskId, task?.title]);
  const noteById = useMemo(() => new Map(scopedNotes.map((n) => [n.id, n] as const)), [scopedNotes]);
  const reportNoteOf = useCallback(
    (logId: string) => {
      const log = reportLogs.find((l) => l.id === logId);
      const noteId = typeof log?.metadata?.note_id === "string" ? log.metadata.note_id : "";
      return noteId ? noteById.get(noteId) : undefined;
    },
    [reportLogs, noteById],
  );
  // 操作记录 Tab 的完整时间线（动作 + 进展合成，时间倒序）——与驾驶舱抽屉/导出报告同一份口径
  const timelineLogs = useMemo(
    () => [...reportLogs].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
    [reportLogs],
  );

  // 参与人（主责/协作）或管理员可在时间线底部直接记进展（后端同口径校验兜底）
  const isParticipant = useMemo(() => {
    if (!task || !user) return false;
    if (task.primary_owner_user_id === user.id || task.primary_owner === user.name) return true;
    return (task.collaborators ?? []).some((c) => c.user_id === user.id || c.name === user.name);
  }, [task, user]);
  const canComposeNote = Boolean(task && !task.archived && task.status !== "completed" && (canManage || isParticipant));

  const submitComposerNote = async () => {
    if (!task || sendingNote) return;
    const text = composerText.trim();
    if (!text && composerFiles.length === 0) {
      toast.error(t("写点什么或附上文件再发送"));
      return;
    }
    // 留痕落到当前范围指向的任务：子任务范围写进该子任务，主线/仅主任务写进本任务
    const targetId = conversationTaskId;
    setSendingNote(true);
    try {
      await createRdTaskProgressNote({
        task_id: targetId,
        text,
        files: composerFiles,
        work_item_id: composerItemId || undefined,
        mentions: mention.mentionsForSubmit(text),
      });
      mention.resetMentions();
      setComposerText("");
      setComposerFiles([]);
      setComposerItemId("");
      toast.success(t("进展已记录"));
      // 重拉留痕让时间线/附件库即时可见（子任务范围只刷该子任务那一份）
      try {
        if (targetId === task.task_id) {
          setNotes(await fetchRdTaskProgressNotes(task.task_id));
        } else {
          const fresh = await fetchRdTaskProgressNotes(targetId);
          setSubtaskNotes((prev) => ({ ...prev, [targetId]: fresh }));
        }
      } catch {
        /* 拉取失败不影响已提交结果 */
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "记录进展失败");
    } finally {
      setSendingNote(false);
    }
  };


  // ── 管理动作（API 口径与驾驶舱抽屉完全一致） ──────────────────────────────

  /** 编辑标题/描述（主管）：PATCH 后乐观更新双数据源并留审计 diff */
  const handleEditInfo = async (nextTitle: string, nextDescription: string) => {
    if (!task) return;
    const title = nextTitle.trim();
    if (!title) {
      toast.error(t("标题不能为空"));
      return;
    }
    const changes: { field: string; before: string; after: string }[] = [];
    const titleChanged = title !== task.title;
    const descChanged = nextDescription !== (task.description ?? "");
    if (titleChanged) changes.push({ field: "title", before: task.title, after: title });
    if (descChanged) {
      // 从首个差异处截取摘要：长描述只改结尾时，头 120 字相同会记出 before===after 的无效 diff
      const before = task.description ?? "";
      let diffAt = 0;
      while (diffAt < before.length && diffAt < nextDescription.length && before[diffAt] === nextDescription[diffAt]) diffAt += 1;
      const from = Math.max(0, diffAt - 30);
      const clip = (s: string) => (from > 0 ? "…" : "") + s.slice(from, from + 120) + (s.length > from + 120 ? "…" : "");
      changes.push({ field: "description", before: clip(before), after: clip(nextDescription) });
    }
    if (changes.length === 0) {
      setShowEditInfo(false);
      return;
    }
    // 只提交实际变更的字段，避免把 undefined 描述静默覆写成空串
    await updateRdTask(task.task_id, {
      ...(titleChanged ? { title } : {}),
      ...(descChanged ? { description: nextDescription } : {}),
    });
    recordAudit({
      actor: AUDIT_ACTOR,
      action: "task.edited",
      resource: { type: "task", id: task.task_id, name: title },
      changes,
      comment: t("研发详情页编辑任务信息"),
      source: "web",
    });
    setTask((prev) => (prev ? { ...prev, title, description: nextDescription } : prev));
    setAllTasks((prev) => prev.map((item) => (item.task_id === task.task_id ? { ...item, title, description: nextDescription } : item)));
    setShowEditInfo(false);
    toast.success(t("任务信息已更新"));
  };

  const savePriority = async (next: RdPriority) => {
    if (!task || savingPriority || next === task.final_priority) return;
    const prev = task.final_priority;
    setSavingPriority(true);
    try {
      await updateRdTask(task.task_id, { final_priority: next });
      recordAudit({
        actor: AUDIT_ACTOR,
        action: "task.updated",
        resource: { type: "task", id: task.task_id, name: task.title },
        // 脏数据兜底：库里可能存在枚举外的优先级值，直接取 label 会在写库成功后抛错误导用户重试
        changes: [{ field: "priority", before: PRIORITY_CONFIG[prev]?.label ?? String(prev), after: PRIORITY_CONFIG[next]?.label ?? String(next) }],
        comment: "更新任务优先级",
        source: "web",
      });
      setTask((prevTask) => (prevTask ? { ...prevTask, final_priority: next } : prevTask));
      // 同步 allTasks，保证人员任务弹层等派生视图显示新值（task 与 allTasks 双源须一起更新）
      setAllTasks((prevAll) => prevAll.map((t) => (t.task_id === task.task_id ? { ...t, final_priority: next } : t)));
      toast.success(t("优先级已更新"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "更新优先级失败");
    } finally {
      setSavingPriority(false);
    }
  };

  /** 审批（通过/驳回）：口径与驾驶舱抽屉 handleApproval 一致——状态裁决完全交给后端 _review_action。 */
  const handleApproval = async (reason?: string, rollbackProgress?: number) => {
    if (!task || !showApproval) return;
    setSubmitting(true);
    try {
      const isApprove = showApproval === "approve";
      const meta = getReviewTypeMeta(task.pending_review_type);
      if (!meta) {
        toast.error(t("无法识别该任务的审核类型，请刷新后重试"));
        return;
      }
      await updateRdTask(task.task_id, {
        _review_action: isApprove ? "approve" : "reject",
        _reviewer_name: AUDIT_ACTOR.name,
        ...(isApprove ? {} : { _reject_reason: reason ?? `驳回${meta.label}` }),
        ...(!isApprove && typeof rollbackProgress === "number" ? { progress: rollbackProgress } : {}),
      } as Parameters<typeof updateRdTask>[1]);
      recordAudit({
        actor: AUDIT_ACTOR,
        action: isApprove ? meta.approveAction : meta.rejectAction,
        resource: { type: "task", id: task.task_id, name: task.title },
        comment: `${isApprove ? "审核通过" : "驳回"}了${meta.label}${reason ? `：${reason}` : ""}`,
        metadata: { task_id: task.task_id, pending_review_type: task.pending_review_type },
        source: "web",
      });
      toast.success(`${t(meta.label)}${isApprove ? t("已通过") : t("已驳回")}`);
      setShowApproval(null);
      void loadTask();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败");
    } finally {
      setSubmitting(false);
    }
  };

  const handleHandover = async (newOwner: string) => {
    if (!task) return;
    setSubmitting(true);
    try {
      await updateRdTask(task.task_id, {
        primary_owner: newOwner,
        _actor_name: user?.name || "管理员",
      } as Partial<Omit<RdTask, "task_id">> & { _actor_name?: string });
      recordAudit({
        actor: AUDIT_ACTOR,
        action: "task.updated",
        resource: { type: "task", id: task.task_id, name: task.title },
        changes: [{ field: "primary_owner", before: task.primary_owner, after: newOwner }],
        comment: `移交任务给 ${newOwner}`,
        source: "web",
      });
      toast.success(t("任务已移交给 {name}", { name: newOwner }));
      setShowHandover(false);
      void loadTask();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "移交失败");
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddCollaborators = async (newCollaborators: RdCollaborator[]) => {
    if (!task) return;
    try {
      // 全屏页可能停留很久，页面快照的 collaborators 会过期——提交前取服务器最新值再合并，
      // 避免全量覆盖把期间他端新增的协作人静默挤掉
      let baseCollaborators = task.collaborators ?? [];
      try {
        const categories = await fetchMergedTaskCategories();
        const fresh = flattenTasks(categories.flatMap((c) => c.children.flatMap((s) => s.tasks))).find(
          (t) => t.task_id === task.task_id,
        );
        if (fresh) baseCollaborators = fresh.collaborators ?? [];
      } catch {
        // 取最新失败时退回页面快照（后端 normalizeCollaboratorList 仍会去重）
      }
      const existingKeys = new Set(baseCollaborators.map((c) => c.user_id || c.name));
      const merged = [...baseCollaborators, ...newCollaborators.filter((c) => !existingKeys.has(c.user_id || c.name))];
      await updateRdTask(task.task_id, {
        collaborators: merged,
        _actor_name: user?.name || "管理员",
      } as Partial<Omit<RdTask, "task_id">> & { _actor_name?: string });
      recordAudit({
        actor: AUDIT_ACTOR,
        action: "task.updated",
        resource: { type: "task", id: task.task_id, name: task.title },
        comment: `管理员直接添加协作人：${newCollaborators.map((c) => c.name).join("、")}`,
        source: "web",
      });
      toast.success(t("已添加 {n} 位协作人", { n: newCollaborators.length }));
      setShowAddCollab(false);
      void loadTask();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "添加协作人失败");
    }
  };

  const handleDirectComplete = async () => {
    if (!task) return;
    setSubmitting(true);
    try {
      await updateRdTask(task.task_id, { status: "completed", progress: 100 });
      recordAudit({
        actor: AUDIT_ACTOR,
        action: "task.updated",
        resource: { type: "task", id: task.task_id, name: task.title },
        changes: [
          { field: "status", before: task.status, after: "completed" },
          { field: "progress", before: String(task.progress), after: "100" },
        ],
        comment: "管理员直接标记任务完成",
        source: "web",
      });
      toast.success(t("任务已标记完成"));
      setShowComplete(false);
      void loadTask();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败");
    } finally {
      setSubmitting(false);
    }
  };

  // ── 研发侧特有动作（与驾驶舱抽屉同口径） ────────────────────────────────────

  /** 仅主责人本人（且非管理员）可提交完成审核，与抽屉 canSubmitForReview 口径一致 */
  const isCurrentOwner = Boolean(
    task && user && (
      (task.primary_owner_user_id && task.primary_owner_user_id === user.id) ||
      task.primary_owner === user.name
    ),
  );
  const canSubmitForReview = Boolean(task && task.status === "in_progress" && isCurrentOwner && !canManage);

  /** 转采购弹窗默认带入的任务附件（全部进度留痕附件拍平） */
  const transferAttachments = useMemo(
    () => notes.flatMap((note) => note.attachments.map((a) => ({
      id: a.id,
      name: a.name,
      size: a.size,
      mimeType: a.mime,
      fileUrl: getAttachmentUrl(a),
      fileKey: a.object_key,
    }))).filter((attachment) => Boolean(attachment.fileUrl)),
    [notes],
  );

  const handleSubmitForReview = async () => {
    if (!task) return;
    setSubmitting(true);
    try {
      await updateRdTask(task.task_id, { status: "pending_review", progress: 100 });
      const changes: { field: string; before: string; after: string }[] = [
        { field: "status", before: task.status, after: "pending_review" },
      ];
      if (task.progress !== 100) {
        changes.push({ field: "progress", before: String(task.progress), after: "100" });
      }
      recordAudit({
        actor: AUDIT_ACTOR,
        action: "task.updated",
        resource: { type: "task", id: task.task_id, name: task.title },
        changes,
        comment: "提交任务审核，进度自动置为 100%",
        source: "web",
      });
      toast.success(t("任务已提交审核，等待确认"));
      window.dispatchEvent(new CustomEvent("rd:review-submitted"));
      setShowSubmitConfirm(false);
      void loadTask();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  /** 生成问题：把任务内容（描述+留痕+附件）一键建到「问题记录与 AI 定位」，与抽屉实现同源 */
  const handleGenerateIssue = async () => {
    if (!task || generatingIssue) return;
    setGeneratingIssue(true);
    try {
      const parts: string[] = [];
      if (task.description?.trim()) parts.push(task.description.trim());
      const noteTexts = notes.map((n) => (n.text ?? "").trim()).filter(Boolean);
      if (noteTexts.length > 0) parts.push("【进展 / 问题记录】\n" + noteTexts.map((s, i) => `${i + 1}. ${s}`).join("\n"));
      parts.push(`（自研发任务生成：${task.task_id}${task.category_path ? "｜" + task.category_path : ""}）`);

      // 把留痕附件经同源 preview_url 取回字节，走问题模块 uploadAttachment 搬运（与抽屉逻辑一致）
      const seen = new Set<string>();
      const srcAtts = notes
        .flatMap((n) => n.attachments)
        .filter((a) => {
          const k = a.id || `${a.name}-${a.size}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
      if (srcAtts.length > 0) toast.info(`正在搬运 ${srcAtts.length} 个附件到问题…`);
      const issueAttachments: NonNullable<Parameters<typeof issueService.create>[0]["attachments"]> = [];
      for (const a of srcAtts) {
        try {
          const url = getAttachmentPreviewUrl(a) || getAttachmentUrl(a);
          if (!url) continue;
          const resp = await fetch(url);
          if (!resp.ok) continue;
          const blob = await resp.blob();
          const raw = await issueService.uploadAttachment({
            fileName: a.name,
            fileType: a.mime || blob.type || "application/octet-stream",
            size: a.size ?? blob.size,
            dataUrl: await blobToDataUrl(blob),
          });
          const processed = await issueService.processAttachment(raw, "ai").catch(() => raw);
          const extractedText = (processed.extractedText && processed.extractedText.trim()) || (a.extracted_text && a.extracted_text.trim()) || undefined;
          issueAttachments.push({ id: processed.id, fileName: processed.fileName, fileType: processed.fileType, fileUrl: processed.fileUrl, extractedText });
        } catch {
          // 单个附件搬运失败不阻断整体生成
        }
      }
      if (issueAttachments.length < srcAtts.length) {
        const names = srcAtts.map((a) => a.name).join("、");
        if (names) parts.splice(parts.length - 1, 0, "【相关附件】" + names);
      }

      const issue = await issueService.create({
        title: task.title,
        description: parts.join("\n\n"),
        source: "rd",
        attachments: issueAttachments.length > 0 ? issueAttachments : undefined,
      });
      toast.success(`已生成问题${issueAttachments.length > 0 ? `（含 ${issueAttachments.length} 个附件）` : ""}，正在跳转…`);
      navigate(`/issue-ai?issue=${encodeURIComponent(issue.id)}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "生成问题失败，请重试");
      setGeneratingIssue(false);
    }
  };

  /** 打开「移动到其他类目」：按需拉主产品树与产品列表（详情页平时用不到这两份数据） */
  const openMoveDialog = async () => {
    try {
      const [cats, prods] = await Promise.all([
        categories.length > 0 ? Promise.resolve(categories) : fetchRdTaskCategories(),
        products.length > 0 ? Promise.resolve(products) : fetchRdProducts(),
      ]);
      setCategories(cats);
      setProducts(prods);
      setShowMove(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "分类数据加载失败，请重试");
    }
  };

  const handleMoveConfirm = async (targetProductId: string, targetCatId: string, targetSubId: string) => {
    if (!task) return;
    try {
      const result = await moveRdTasks({
        taskIds: [task.task_id],
        targetProductId,
        targetCategoryId: targetCatId,
        targetSubId,
      });
      const productLabel = products.find((p) => p.id === targetProductId)?.name ?? "";
      const movedPath = `${result.targetCategoryLabel} / ${result.targetSubLabel}`;
      recordAudit({
        actor: AUDIT_ACTOR,
        action: "task.updated",
        resource: { type: "task", id: task.task_id, name: task.title },
        changes: [{ field: "category_path", before: task.category_path, after: productLabel ? `${productLabel} / ${movedPath}` : movedPath }],
        comment: `手动调整任务类目 → ${productLabel ? `${productLabel} / ` : ""}${movedPath}`,
        source: "web",
      });
      toast.success(productLabel ? `任务已移动到 ${productLabel} · ${movedPath}` : `任务已移动到 ${movedPath}`);
      setShowMove(false);
      void loadTask();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "移动失败，请重试");
    }
  };

  // ── 子任务（一层）：父任务面包屑 / 子任务清单 / 直建 / 并入已有任务 / 取消关系 ──

  /** 当前任务的父任务（本任务是子任务时非空）。按结构索引判定，不看 parent_task_id 字段。 */
  const parentTask = subtaskParents.get(taskId) ?? null;
  /**
   * 可并入为子任务的候选：顶层任务、非自身、未归档、且自身不带子任务
   * （后端拒绝把带子任务的任务挂到别处——子任务仅支持一层）。
   */
  const attachCandidates = useMemo(
    () =>
      topLevelTasks.filter(
        (candidate) =>
          candidate.task_id !== taskId &&
          !candidate.archived &&
          candidate.status !== "archived" &&
          !(candidate.subtasks?.length),
      ),
    [topLevelTasks, taskId],
  );

  const handleCreateSubtask = async (input: {
    title: string;
    primary_owner: string;
    primary_owner_user_id: string | null;
    due_date: string;
    final_priority: RdPriority;
    description: string;
  }) => {
    if (!task) return;
    const created = await createRdTask({
      parent_task_id: task.task_id,
      title: input.title,
      primary_owner: input.primary_owner,
      primary_owner_user_id: input.primary_owner_user_id,
      status: "in_progress",
      final_priority: input.final_priority,
      ai_priority: input.final_priority,
      due_date: input.due_date || undefined,
      description: input.description || undefined,
    });
    recordAudit({
      actor: AUDIT_ACTOR,
      action: "task.created",
      resource: { type: "task", id: created.task_id, name: created.title },
      comment: `在任务 ${task.task_id} 下新建子任务`,
      metadata: { parent_task_id: task.task_id, subtask_origin: "created" },
      source: "web",
    });
    toast.success(t("子任务已创建"));
    setShowCreateSubtask(false);
    void loadTask({ silent: true });
  };

  const handleAttachSubtasks = async (childIds: string[]) => {
    if (!task || childIds.length === 0) return;
    // 逐个调用（后端每次调用各自加任务树写锁，串行提交避免并发写互相覆盖）
    const failed: string[] = [];
    for (const childId of childIds) {
      try {
        await attachRdTaskToParent(childId, task.task_id);
        const child = topLevelTasks.find((c) => c.task_id === childId);
        recordAudit({
          actor: AUDIT_ACTOR,
          action: "task.updated",
          resource: { type: "task", id: childId, name: child?.title ?? childId },
          changes: [{ field: "parent_task_id", before: "", after: task.task_id }],
          comment: `并入任务 ${task.task_id}（${task.title}）成为其子任务`,
          metadata: { parent_task_id: task.task_id, subtask_origin: "attached" },
          source: "web",
        });
      } catch (error) {
        failed.push(`${childId}：${error instanceof Error ? error.message : t("未知错误")}`);
      }
    }
    const okCount = childIds.length - failed.length;
    if (okCount > 0) toast.success(t("已并入 {n} 个任务为子任务", { n: okCount }));
    if (failed.length > 0) toast.error(failed.join("\n"));
    setShowAttachSubtasks(false);
    void loadTask({ silent: true });
  };

  const handleDetachSubtask = async () => {
    if (!task || detaching) return;
    setDetaching(true);
    try {
      await detachRdSubtask(task.task_id);
      recordAudit({
        actor: AUDIT_ACTOR,
        action: "task.updated",
        resource: { type: "task", id: task.task_id, name: task.title },
        changes: [{ field: "parent_task_id", before: parentTask?.task_id ?? "", after: "" }],
        comment: `取消子任务关系，提升为顶层任务`,
        source: "web",
      });
      toast.success(t("已取消子任务关系，该任务已提升为独立任务"));
      void loadTask({ silent: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("取消子任务失败，请重试"));
    } finally {
      setDetaching(false);
    }
  };

  /** 某人名下的活跃任务（供人员任务弹层展示，点击可跳到对应任务详情页） */
  const tasksOfPerson = useMemo(() => {
    if (!personTasksFor) return [];
    return allTasks.filter(
      (t) => t.primary_owner === personTasksFor && !t.archived && t.status !== "archived",
    );
  }, [allTasks, personTasksFor]);

  // ── 上一条/下一条任务导航（j/k 快捷键 + 页头按钮）：领导逐条过任务不用来回跳驾驶舱 ──
  // 序列按最近活动倒序（与驾驶舱「全部」卡片流同口径）
  const taskSeq = useMemo(
    () =>
      allTasks
        .filter((t) => !t.archived && t.status !== "archived")
        .sort((a, b) =>
          String(b.last_activity_at ?? b.updated_at ?? "").localeCompare(String(a.last_activity_at ?? a.updated_at ?? "")),
        ),
    [allTasks],
  );
  const seqIndex = useMemo(() => taskSeq.findIndex((t) => t.task_id === taskId), [taskSeq, taskId]);
  const gotoSeq = useCallback(
    (offset: number) => {
      const target = taskSeq[seqIndex + offset];
      if (target) navigate(`/rd-task/${encodeURIComponent(target.task_id)}`, { state: { task: target } });
    },
    [taskSeq, seqIndex, navigate],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      // 输入场景不劫持按键
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      if (e.key === "j") gotoSeq(1);
      if (e.key === "k") gotoSeq(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [gotoSeq]);

  if (!canView) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-slate-500">
        <div className="text-4xl">🔒</div>
        <p className="text-base font-medium">您没有访问此页面的权限</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center gap-2 text-sm text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("正在加载任务…")}
      </div>
    );
  }

  if (!task) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-slate-500">
        <AlertTriangle className="h-8 w-8 text-amber-400" />
        <p className="text-sm">{loadError || t("任务不存在")}</p>
        <button
          type="button"
          onClick={() => navigate("/rd-task-management")}
          className="cursor-pointer rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
        >
          {t("返回驾驶舱")}
        </button>
      </div>
    );
  }

  const sCfg = STATUS_CONFIG[task.status] ?? STATUS_CONFIG.in_progress;
  const pCfg = PRIORITY_CONFIG[task.final_priority] ?? PRIORITY_CONFIG.medium;
  const blockedDays = blockedDaysOf(task);
  const workItems = task.work_items ?? [];

  // 大屏（lg+）视口内布局：整页不滚，AI 小结/时间线各自内滚；窄屏维持自然文档流
  return (
    <motion.div
      ref={rootRef}
      initial={shouldReduceMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      style={viewportHeight ? { height: viewportHeight } : undefined}
      className="mx-auto flex max-w-[1200px] flex-col gap-4 px-2 pt-4 sm:px-4"
    >
      {/* ── 顶部：返回 + 标题 + 徽章 ── */}
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        {/* 直接回驾驶舱（不用 navigate(-1)：序列导航翻过 N 条任务后逐条回退历史体验极差） */}
        <Button type="button" variant="outline" size="sm" onClick={() => navigate("/rd-task-management")} className="gap-1">
          <ArrowLeft className="h-3.5 w-3.5" />
          {t("返回")}
        </Button>
        {/* 序列导航：按驾驶舱同口径顺序穿行任务（j/k 快捷键同效） */}
        {seqIndex >= 0 && taskSeq.length > 1 && (
          <div className="flex items-center gap-0.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => gotoSeq(-1)}
              disabled={seqIndex <= 0}
              title={t("上一条任务（k）")}
              className="h-8 w-8 p-0"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="px-1 text-xs tabular-nums text-slate-400">{seqIndex + 1} / {taskSeq.length}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => gotoSeq(1)}
              disabled={seqIndex >= taskSeq.length - 1}
              title={t("下一条任务（j）")}
              className="h-8 w-8 p-0"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
        <span className="font-mono text-xs text-slate-400">{task.task_id}</span>
        <h1 className="min-w-0 flex-1 truncate text-xl font-bold text-slate-900">
          <AutoTranslatedText text={task.title} />
          {canManage && !task.archived && (
            <button
              type="button"
              onClick={() => setShowEditInfo(true)}
              title={t("编辑标题与描述")}
              className="ml-2 inline-flex cursor-pointer items-center rounded p-1 align-middle text-slate-300 transition-colors hover:bg-slate-100 hover:text-slate-600"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
        </h1>
        <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", sCfg.bg, sCfg.text)}>
          <span className={cn("h-1.5 w-1.5 rounded-full", sCfg.dot)} />
          {t(sCfg.label)}
        </span>
        {canManage && !task.archived && task.status !== "completed" ? (
          <Select value={task.final_priority} disabled={savingPriority} onValueChange={(value) => void savePriority(value as RdPriority)}>
            <SelectTrigger
              className={cn(
                // 与旁边的状态胶囊完全同构：覆盖 shadcn 默认的 h-9/px-3/text-sm/size-4 箭头
                "w-auto shrink-0 gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold shadow-none",
                "min-h-0 data-[size=default]:h-auto data-[size=sm]:h-auto [&_svg:not([class*='size-'])]:size-3 [&_svg:not([class*='text-'])]:text-current",
                pCfg.bg,
                pCfg.text,
              )}
              title={lang === "en" ? "Change task priority" : "调整任务优先级"}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
              <SelectItem value="high">{t("高优先")}</SelectItem>
              <SelectItem value="medium">{t("中优先")}</SelectItem>
              <SelectItem value="low">{t("低优先")}</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <span className={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold", pCfg.bg, pCfg.text)}>
            {t(`${pCfg.label}优先`)}
          </span>
        )}
      </div>

      {/* 美式 content-first 布局：主内容（描述/工作项/时间线）居左，Properties 侧栏居右（GitHub issue / Linear 范式） */}
      <div className="grid min-h-0 flex-1 gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
        {/* ══ 右侧 Properties 栏（单一面板，分节细线分隔；超高自身内滚）══ */}
        <div className="cockpit-scroll min-h-0 xl:order-2 xl:overflow-y-auto">
        <div className="material-card divide-y divide-slate-100">
          {/* 字段节 */}
          <div className="space-y-2.5 px-4 py-3.5">
            {[
              { label: t("完成进度"), value: (
                <span className="flex items-center gap-2">
                  <Progress value={task.progress} className="h-1.5 w-24" />
                  <span className="tabular-nums">{task.progress}%</span>
                </span>
              ) },
              { label: t("开始日期"), value: task.start_date || "—" },
              { label: t("截止日期"), value: (
                <span className="flex items-center gap-1">
                  <CalendarClock className="h-3.5 w-3.5 text-amber-500" />
                  {task.due_date || "—"}
                </span>
              ) },
              // 研发侧特有：BOM 分类路径（协同池无此概念，协同详情页不展示）+ 移动类目入口
              { label: t("分类路径"), value: (
                <span className="flex min-w-0 items-center justify-end gap-2">
                  <span className="truncate" title={task.category_path || undefined}>{task.category_path || "—"}</span>
                  {canManage && !task.archived && (
                    <button
                      type="button"
                      onClick={() => void openMoveDialog()}
                      className="shrink-0 cursor-pointer text-xs font-medium text-indigo-600 hover:underline"
                    >
                      {t("移动")}
                    </button>
                  )}
                </span>
              ) },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-3 text-sm">
                <span className="shrink-0 text-xs text-slate-400">{row.label}</span>
                <span className="min-w-0 truncate text-right font-medium text-slate-700">{row.value}</span>
              </div>
            ))}
          </div>

          {/* 阻塞提示节 */}
          {task.status === "paused_blocked" && (
            <div className="flex items-start gap-2 bg-red-50/70 px-4 py-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
              <div className="text-sm text-red-700">
                <span className="font-semibold">{t("任务阻塞中")}{blockedDays != null ? t("，已阻塞 {n} 天", { n: blockedDays }) : ""}</span>
                {blockedDays != null && blockedDays >= 3 && <div className="mt-0.5 text-xs">{t("建议尽快协调对方团队解除依赖。")}</div>}
              </div>
            </div>
          )}

          {/* ── 子任务关系节（一层）──
              子任务态：显示父任务面包屑 + 取消关系；顶层态：子任务清单 + 直建/并入入口。 */}
          {parentTask ? (
            <div className="bg-sky-50/60 px-4 py-3.5">
              <div className="mb-2 flex items-center gap-1.5">
                <SubtaskBadge task={task} />
                <span className="text-xs font-semibold text-slate-500">{t("所属父任务")}</span>
              </div>
              <button
                type="button"
                onClick={() => navigate(`/rd-task/${encodeURIComponent(parentTask.task_id)}`)}
                className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-sky-200 bg-white px-3 py-2 text-left transition hover:border-sky-300 hover:bg-sky-50/60"
              >
                <ChevronLeft className="h-3.5 w-3.5 shrink-0 text-sky-500" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700">
                  <AutoTranslatedText text={parentTask.title} />
                </span>
                <span className="shrink-0 font-mono text-[11px] text-slate-400">{parentTask.task_id}</span>
              </button>
              {task.subtask_origin === "attached" && task.subtask_attached_at && (
                <p className="mt-1.5 text-[11px] text-slate-500">
                  {t("由独立任务并入")}
                  {task.subtask_attached_by ? t("，操作人 {name}", { name: task.subtask_attached_by }) : ""}
                  {t("（{time}）", { time: task.subtask_attached_at.slice(0, 16).replace("T", " ") })}
                </p>
              )}
              {canManage && !task.archived && (
                <button
                  type="button"
                  disabled={detaching}
                  onClick={() => void handleDetachSubtask()}
                  className="mt-2 inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
                >
                  {detaching ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                  {t("取消子任务关系（提升为独立任务）")}
                </button>
              )}
            </div>
          ) : (
            <div className="px-4 py-3.5">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-500">
                  {t("子任务")}
                  {subtasks.length > 0 && (
                    <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-px text-[10px] font-semibold text-slate-600">
                      {subtasks.length}
                    </span>
                  )}
                </span>
                {canManage && !task.archived && (
                  <span className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setShowCreateSubtask(true)}
                      className="cursor-pointer rounded px-1.5 py-0.5 text-[11px] font-semibold text-indigo-600 hover:bg-indigo-50"
                    >
                      {t("新建")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowAttachSubtasks(true)}
                      className="cursor-pointer rounded px-1.5 py-0.5 text-[11px] font-semibold text-amber-600 hover:bg-amber-50"
                    >
                      {t("并入已有任务")}
                    </button>
                  </span>
                )}
              </div>
              {subtasks.length === 0 ? (
                <p className="text-xs text-slate-400">{t("暂无子任务")}</p>
              ) : (
                <>
                  {/* 进度汇总：子任务完成数 + 平均进度 */}
                  <div className="mb-2 flex items-center gap-2 text-[11px] text-slate-500">
                    <span>
                      {t("已完成 {done}/{total}", {
                        done: subtasks.filter((s) => s.status === "completed").length,
                        total: subtasks.length,
                      })}
                    </span>
                    <Progress
                      value={Math.round(subtasks.reduce((sum, s) => sum + s.progress, 0) / subtasks.length)}
                      className="h-1.5 flex-1"
                    />
                    <span className="tabular-nums">
                      {Math.round(subtasks.reduce((sum, s) => sum + s.progress, 0) / subtasks.length)}%
                    </span>
                  </div>
                  <div className="space-y-1">
                    {subtasks.map((sub) => {
                      const subCfg = STATUS_CONFIG[sub.status] ?? STATUS_CONFIG.in_progress;
                      return (
                        <button
                          key={sub.task_id}
                          type="button"
                          onClick={() => navigate(`/rd-task/${encodeURIComponent(sub.task_id)}`)}
                          className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-slate-100 px-2.5 py-1.5 text-left transition hover:border-indigo-200 hover:bg-indigo-50/40"
                        >
                          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", subCfg.dot)} />
                          <SubtaskBadge task={sub} />
                          <span className="min-w-0 flex-1 truncate text-xs text-slate-700">
                            <AutoTranslatedText text={sub.title} />
                          </span>
                          <span className="shrink-0 text-[11px] tabular-nums text-slate-400">{sub.progress}%</span>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {/* 人员节（点击查看其名下任务，可跳转到对应任务详情） */}
          <div className="px-4 py-3.5">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500">{t("主责人")}</span>
              {canManage && !task.archived && (
                <button
                  type="button"
                  onClick={() => setShowAddCollab(true)}
                  className="cursor-pointer rounded px-1.5 py-0.5 text-[11px] font-semibold text-indigo-600 hover:bg-indigo-50"
                >
                  + {t("添加协作人")}
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => setPersonTasksFor(task.primary_owner)}
              className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-1 py-0.5 text-left hover:bg-slate-50"
              title={`查看 ${task.primary_owner} 名下的任务`}
            >
              <OwnerAvatar name={task.primary_owner} userId={task.primary_owner_user_id} size="sm" />
              <span className="text-sm font-medium text-slate-800">{displayPersonName(task.primary_owner)}</span>
            </button>
            {(task.collaborators ?? []).length > 0 && (
              <>
                <div className="mb-2 mt-3 text-xs font-semibold text-slate-500">{t("协作人")}</div>
                <div className="space-y-1">
                  {(task.collaborators ?? []).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setPersonTasksFor(c.name)}
                      className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-1 py-0.5 text-left hover:bg-slate-50"
                      title={`查看 ${c.name} 名下的任务`}
                    >
                      <OwnerAvatar name={c.name} userId={c.user_id} size="xs" />
                      <span className="text-sm text-slate-700">{c.name}</span>
                      <span className="text-[11px] text-slate-400">{t(c.role)}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* 操作节（紧凑列表式，Linear 风）——研发侧不含协同专属的 AI 小结/导出报告 */}
          <div className="space-y-1.5 px-4 py-3.5">
            {/* 审批：待审核任务的通过/驳回（口径与驾驶舱抽屉一致） */}
            {/* 提交审核（研发侧成员动作）：主责人本人对进行中任务提交完成审核 */}
            {canSubmitForReview && (
              <Button type="button" size="sm" onClick={() => setShowSubmitConfirm(true)} className="h-8 w-full gap-1.5 text-xs">
                <Send className="h-3.5 w-3.5" />
                {t("提交审核")}
              </Button>
            )}
            {canManage && task.status === "pending_review" && getReviewTypeMeta(task.pending_review_type) && (
              <>
                <div className="rounded-lg bg-purple-50 px-3 py-2 text-xs text-purple-700">
                  {t("待审核")}：{t(getReviewTypeMeta(task.pending_review_type)!.label)}
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setShowApproval("approve")}
                  className="h-8 w-full gap-1.5 bg-emerald-600 text-xs hover:bg-emerald-700"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {t("审核通过")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowApproval("reject")}
                  className="h-8 w-full gap-1.5 border-red-200 text-xs text-red-600 hover:bg-red-50 hover:text-red-700"
                >
                  <X className="h-3.5 w-3.5" />
                  {t("驳回")}
                </Button>
              </>
            )}
            {/* 移交/直接完成仅对进行中任务开放（对齐抽屉 canCompleteDirectly 口径）：
                待审核任务必须走上方审批，避免绕过后端 _review_action 仲裁残留待审字段 */}
            {canManage && !task.archived && task.status === "in_progress" && (
              <>
                <Button type="button" variant="outline" size="sm" onClick={() => setShowHandover(true)} className="h-8 w-full gap-1.5 text-xs">
                  <ArrowLeft className="h-3.5 w-3.5 rotate-180" />
                  {t("移交任务")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowComplete(true)}
                  className="h-8 w-full gap-1.5 border-emerald-200 text-xs text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {t("标记完成")}
                </Button>
              </>
            )}
            {/* 研发侧特有：转采购 / 生成问题（非归档任务始终可用，与抽屉口径一致）。
                已转采购的任务显示跳转芯片而非再次转出 */}
            {!task.archived && (
              <>
                {procTask ? (
                  <ProcurementLinkChip
                    task={procTask}
                    onJump={(procTaskId) => navigate(`/proc-cockpit?task=${encodeURIComponent(procTaskId)}`)}
                  />
                ) : canTransferProc ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setTransferOpen(true)}
                    title={t("把本任务转为采购任务（需携带图纸附件）")}
                    className="h-8 w-full gap-1.5 text-xs"
                  >
                    <ShoppingCart className="h-3.5 w-3.5" />
                    {t("转采购")}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void handleGenerateIssue()}
                  disabled={generatingIssue}
                  className="h-8 w-full gap-1.5 border-amber-200 text-xs text-amber-700 hover:bg-amber-50 hover:text-amber-800"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {generatingIssue ? t("生成中…") : t("生成问题")}
                </Button>
              </>
            )}
          </div>
        </div>
        </div>

        {/* ══ 主内容列（左）：纵向过程叙事——Tab 卡吃掉剩余高度，内容内滚 ══ */}
        <div className="flex min-h-0 min-w-0 flex-col gap-4 xl:order-1">
          {/* 任务描述 */}
          {task.description && (
            <div className="shrink-0 material-card px-4 py-3">
              <div className="mb-1.5 text-xs font-semibold text-slate-500">{t("任务描述")}</div>
              <AutoTranslatedText
                as="p"
                text={task.description}
                className="cockpit-scroll max-h-40 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-slate-700"
              />
            </div>
          )}

          {/* 工作项（只读展示）：创建/勾选/删除入口在个人工作台，成员按需自建 */}
          <div className="shrink-0">
            <WorkItemsSection
              task={task}
              canEdit={false}
              noteCountByItem={noteCountByItem}
              onTaskPatched={(_, patch) => setTask((prev) => (prev ? { ...prev, ...patch } : prev))}
            />
          </div>

          {/* 完成质量评分（研发侧特有）：可收起 + 限高内滚。容器允许被 flex 压缩
              （非 shrink-0），主列空间不足时评分区自动让位给下方 Tab 区，整页不出滚动条。
              评分卡组件与驾驶舱抽屉共享，此处只做外层容器，不改其内部。 */}
          {task.status === "completed" && (
            <div
              className={cn(
                "flex min-h-0 flex-col overflow-hidden rounded-[10px] border border-slate-200 bg-white",
                scoreOpen ? "max-h-[260px]" : "shrink-0",
              )}
            >
              <button
                type="button"
                onClick={() => setScoreOpen((v) => !v)}
                className="flex w-full shrink-0 cursor-pointer items-center justify-between px-4 py-2.5 text-left hover:bg-slate-50/70"
              >
                <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                  <Sparkles className="h-3.5 w-3.5 text-indigo-500" />
                  {t("完成质量评分")}
                </span>
                <span className="flex items-center gap-1 text-[11px] text-slate-400">
                  {scoreOpen ? t("收起") : t("展开")}
                  <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", scoreOpen && "rotate-180")} />
                </span>
              </button>
              {scoreOpen && (
                <div className="cockpit-scroll min-h-0 flex-1 overflow-y-auto border-t border-slate-100 p-2">
                  <TaskCompletionScoreCard
                    task={task}
                    notes={notes}
                    loading={notesLoading}
                    canView={canManage || isParticipant}
                  />
                </div>
              )}
            </div>
          )}

          {/* 已转采购的任务：展示对应采购任务的活动流（研发侧特有） */}
          {procTask && (
            <div className="shrink-0">
              <ProcurementActivitySection task={procTask} />
            </div>
          )}

          {/* Tab：进度留痕 / 任务讨论 / 操作记录 / 附件库 —— 卡片吃掉主列剩余高度，内容区各自内滚 */}
          <div className="material-card flex min-h-0 flex-1 flex-col overflow-hidden p-0 lg:min-h-[280px]">
            <Tabs value={tab} onValueChange={(value) => setTab(value as DetailTab)} className="flex min-h-0 flex-1 flex-col gap-0">
              <TabsList className="cockpit-scroll h-auto w-full shrink-0 justify-start gap-3 overflow-x-auto rounded-none border-b border-slate-200/80 bg-transparent p-0 px-3 sm:gap-5 sm:px-4">
                {([
                  { key: "notes", label: t("进展留痕"), count: scopedNotes.length },
                  { key: "conversation", label: t("任务讨论"), count: discussionUnread },
                  { key: "audit", label: t("操作记录"), count: timelineLogs.length },
                  { key: "attachments", label: t("附件库"), count: null },
                ] as const).map((tabItem) => (
                  <TabsTrigger
                    key={tabItem.key}
                    value={tabItem.key}
                    className="-mb-px flex-none cursor-pointer gap-1.5 rounded-none border-0 border-b-2 border-transparent bg-transparent px-1 pb-3 pt-3.5 text-sm font-medium text-slate-500 shadow-none transition-colors hover:text-slate-800 data-[state=active]:border-indigo-600 data-[state=active]:bg-transparent data-[state=active]:font-semibold data-[state=active]:text-slate-900 data-[state=active]:shadow-none"
                  >
                    {tabItem.key === "conversation" && <MessageCircleMore className="h-3.5 w-3.5 text-indigo-500" />}
                    {tabItem.label}
                    {tabItem.count != null && tabItem.count > 0 && (
                      <span className={cn(
                        "rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                        tabItem.key === "conversation" ? "bg-rose-500 text-white" : "bg-slate-100 text-slate-500",
                      )}>{tabItem.count}</span>
                    )}
                  </TabsTrigger>
                ))}
              </TabsList>

              {/* ── 范围切换条（仅有子任务时出现，作用于「进展留痕」「操作记录」「任务讨论」）──
                  主线把本任务与全部子任务的记录混排并标出来源；切到具体任务才可写入。
                  ⚠️ 任务讨论不提供「主线」：讨论是每任务一套线程 + 独立已读游标，
                  跨任务合并会误清其他任务的未读，只允许切到具体任务看它自己的讨论。 */}
              {subtasks.length > 0 && (tab === "notes" || tab === "audit" || tab === "conversation") && (
                <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-slate-100 bg-slate-50/60 px-3 py-2 sm:px-4">
                  <span className="mr-0.5 text-[11px] font-semibold text-slate-400">{t("范围")}</span>
                  {[
                    ...(tab === "conversation"
                      ? []
                      : [{ id: "all", label: t("主线（全部）"), count: notes.length + subtasks.reduce((n, s) => n + (subtaskNotes[s.task_id]?.length ?? 0), 0) }]),
                    { id: "self", label: t("仅主任务"), count: notes.length },
                    ...subtasks.map((s) => ({ id: s.task_id, label: s.title, count: subtaskNotes[s.task_id]?.length ?? 0, sub: s })),
                  ].map((opt) => {
                    const active = traceScope === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setTraceScope(opt.id)}
                        title={opt.label}
                        className={cn(
                          "flex max-w-[220px] cursor-pointer items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition",
                          active
                            ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                            : "border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:bg-indigo-50/40",
                        )}
                      >
                        {"sub" in opt && opt.sub ? <SubtaskBadge task={opt.sub} /> : null}
                        <span className="min-w-0 truncate">{opt.label}</span>
                        <span className={cn("shrink-0 tabular-nums", active ? "text-indigo-500" : "text-slate-400")}>
                          {opt.count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              <TabsContent value="notes" className="min-h-0 min-w-0 flex-1 overflow-hidden data-[state=active]:flex">
                {traceScope === "all" && subtasks.length > 0 ? (
                  // 主线：跨任务混排，只读（写入需先切到具体任务——留痕必须落到唯一的目标任务）
                  <div className="cockpit-scroll min-h-0 min-w-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
                    <p className="mb-2.5 rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
                      {t("主线汇总本任务与 {n} 个子任务的全部进展留痕。要记录新进展，请先切到「仅主任务」或某个子任务。", { n: subtasks.length })}
                    </p>
                    <ProgressNoteList
                      notes={scopedNotes}
                      loading={notesLoading}
                      emptyText={t("本任务与其子任务暂无进展留痕")}
                      renderSource={(note) => {
                        const sourceId = noteSourceOf.get(note.id);
                        if (!sourceId || sourceId === taskId) {
                          return (
                            <span className="shrink-0 rounded bg-slate-100 px-1.5 py-px text-[10px] font-semibold text-slate-600 ring-1 ring-inset ring-slate-200">
                              {t("主任务")}
                            </span>
                          );
                        }
                        const sub = subtasks.find((s) => s.task_id === sourceId);
                        return (
                          <button
                            type="button"
                            onClick={() => navigate(`/rd-task/${encodeURIComponent(sourceId)}`)}
                            className="flex max-w-[200px] shrink-0 cursor-pointer items-center gap-1 rounded bg-sky-50 px-1.5 py-px text-[10px] font-semibold text-sky-700 ring-1 ring-inset ring-sky-200 hover:bg-sky-100"
                            title={traceTitleOf.get(sourceId) ?? sourceId}
                          >
                            {sub ? <SubtaskBadge task={sub} /> : null}
                            <span className="min-w-0 truncate">{traceTitleOf.get(sourceId) ?? sourceId}</span>
                          </button>
                        );
                      }}
                    />
                  </div>
                ) : (
                  <RDTaskConversation
                    key={`progress-${conversationTaskId}`}
                    taskId={conversationTaskId}
                    taskTitle={traceTitleOf.get(conversationTaskId) ?? task.title}
                    notes={scopedNotes}
                    mode="progress"
                    variant="desktop"
                    notesLoading={notesLoading}
                    showHeader={false}
                    threadLayout="replace"
                    onUnreadChange={setDiscussionUnread}
                    onThreadOpenChange={setDiscussionThreadOpen}
                  />
                )}
              </TabsContent>

              <TabsContent value="conversation" className="min-h-0 min-w-0 flex-1 overflow-hidden data-[state=active]:flex">
                {/* 讨论绑定到范围选中的任务（无「主线」）；key 带 taskId 保证切换时线程与已读游标整体重建 */}
                <RDTaskConversation
                  key={`conversation-${conversationTaskId}`}
                  taskId={conversationTaskId}
                  taskTitle={traceTitleOf.get(conversationTaskId) ?? task.title}
                  notes={scopedNotes}
                  mode="task"
                  variant="desktop"
                  showHeader={false}
                  threadLayout="replace"
                  onUnreadChange={setDiscussionUnread}
                />
              </TabsContent>

              <TabsContent value="attachments" className="cockpit-scroll min-h-0 min-w-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
              <motion.div initial={shouldReduceMotion ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16 }} className="space-y-3">
                <TaskImageGallery notes={scopedNotes} />
                <div>
                  <div className="mb-2 text-xs font-semibold text-slate-500">{t("文档附件（{n}）", { n: docAttachments.length })}</div>
                  {docAttachments.length === 0 ? (
                    <p className="py-4 text-center text-sm text-slate-400">{t("暂无文档附件")}</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="border-slate-100 hover:bg-transparent">
                            <TableHead className="text-xs text-slate-400">{t("文件名")}</TableHead>
                            <TableHead className="text-xs text-slate-400">{t("大小")}</TableHead>
                            <TableHead className="text-xs text-slate-400">{t("上传时间")}</TableHead>
                            <TableHead className="text-xs text-slate-400">{t("上传人")}</TableHead>
                            <TableHead className="text-xs text-slate-400">{t("操作")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {docAttachments.map(({ att, createdAt, actor }) => (
                            <TableRow key={att.id} className="border-slate-50 hover:bg-slate-50/60">
                              <TableCell className="max-w-[320px]">
                                <span className="flex items-center gap-1.5">
                                  <FileText className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                                  <span className="min-w-0 truncate text-sm text-slate-700">{att.name}</span>
                                </span>
                              </TableCell>
                              <TableCell className="whitespace-nowrap text-xs text-slate-500">{formatRdFileSize(att.size)}</TableCell>
                              <TableCell className="whitespace-nowrap text-xs text-slate-500">{(createdAt ?? "").slice(0, 10)}</TableCell>
                              <TableCell className="whitespace-nowrap text-xs text-slate-500">{actor || "—"}</TableCell>
                              <TableCell className="whitespace-nowrap">
                                <a
                                  href={getAttachmentUrl(att)}
                                  download={att.name}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700"
                                >
                                  <Download className="h-3 w-3" />
                                  {t("下载")}
                                </a>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              </motion.div>
              </TabsContent>

              <TabsContent value="audit" className="cockpit-scroll min-h-0 min-w-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
              <motion.div initial={shouldReduceMotion ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16 }} className="px-1 py-1">
                {/* 完整时间线：操作动作 + 进展留痕合成，进展条目下挂附件缩略图（与抽屉口径一致） */}
                <AuditTimeline
                  logs={timelineLogs}
                  // 主线视图跨任务混排 → 打开归属任务名，否则分不清哪条属于哪个子任务
                  showResource={traceScope === "all" && subtasks.length > 0}
                  emptyText={t("暂无操作记录")}
                  canAddNote={canManage}
                  onAddNote={async (logId, text) => {
                    await addAuditLogNote(logId, { text, actor: AUDIT_ACTOR });
                  }}
                  notePlaceholder={t("填写备注（最多 200 字），仅主管可添加…")}
                  renderExtra={(log) => {
                    const note = reportNoteOf(log.id);
                    if (!note || note.attachments.length === 0) return null;
                    return <ProgressAttachmentGrid attachments={note.attachments} compact />;
                  }}
                />
              </motion.div>
              </TabsContent>
            </Tabs>

            {/* 正式留痕输入框只属于“进度留痕”，避免与任务讨论输入框混淆。
                主线范围下隐藏：留痕必须落到唯一目标任务，跨任务混排时无法确定写给谁。 */}
            {tab === "notes" && canComposeNote && !discussionThreadOpen
              && !(traceScope === "all" && subtasks.length > 0) && (
              <div className="shrink-0 border-t border-slate-200/80 px-4 py-3">
                <div className="relative">
                  <MentionSuggestionPanel
                    open={mention.open}
                    candidates={mention.filtered}
                    highlightIndex={mention.highlightIndex}
                    onPick={mention.pick}
                    variant="desktop"
                  />
                  <Textarea
                    ref={composerRef}
                    value={composerText}
                    onChange={(e) => { setComposerText(e.target.value); mention.syncActiveQuery(); }}
                    onKeyUp={mention.syncActiveQuery}
                    onClick={mention.syncActiveQuery}
                    onKeyDown={(e) => {
                      if (mention.handleKeyDown(e)) return;
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        void submitComposerNote();
                      }
                    }}
                    rows={2}
                    placeholder={t("写一条进展…（输入 @ 提及成员，Ctrl+Enter 发送）")}
                    className="cockpit-scroll w-full resize-none rounded-lg border-slate-200 text-sm"
                  />
                </div>
                {composerFiles.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {composerFiles.map((f, i) => (
                      <span key={`${f.name}-${i}`} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                        {f.name}
                        <button
                          type="button"
                          onClick={() => setComposerFiles((prev) => prev.filter((_, idx) => idx !== i))}
                          className="cursor-pointer text-slate-400 hover:text-slate-600"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="mt-2 flex items-center gap-2">
                  <label className="flex cursor-pointer items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50">
                    <FileText className="h-3.5 w-3.5" />
                    {t("附件")}
                    <input
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        const picked = Array.from(e.target.files ?? []);
                        if (picked.length) setComposerFiles((prev) => [...prev, ...picked].slice(0, 10));
                        e.target.value = "";
                      }}
                    />
                  </label>
                  {workItems.length > 0 && (
                    <Select value={composerItemId || "none"} onValueChange={(v) => setComposerItemId(v === "none" ? "" : v)}>
                      <SelectTrigger size="sm" className="h-7 w-auto max-w-[200px] rounded-lg text-xs text-slate-500">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
                        <SelectItem value="none">{t("不关联工作项")}</SelectItem>
                        {workItems.map((it) => (
                          <SelectItem key={it.id} value={it.id}>{it.title}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void submitComposerNote()}
                    disabled={sendingNote || (!composerText.trim() && composerFiles.length === 0)}
                    className="ml-auto h-7 gap-1 px-3 text-xs"
                  >
                    {sendingNote ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                    {t("发送")}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── 管理弹窗 ── */}
      {showEditInfo && (
        <EditTaskInfoDialog
          initialTitle={task.title}
          initialDescription={task.description ?? ""}
          onConfirm={handleEditInfo}
          onCancel={() => setShowEditInfo(false)}
        />
      )}
      {showHandover && (
        <HandoverDialog
          taskId={task.task_id}
          taskTitle={task.title}
          currentOwner={task.primary_owner}
          people={people}
          onConfirm={handleHandover}
          onCancel={() => setShowHandover(false)}
        />
      )}
      {showAddCollab && (
        <AddCollaboratorsDialog
          taskTitle={task.title}
          currentOwner={task.primary_owner}
          existingCollaborators={task.collaborators ?? []}
          people={people}
          onConfirm={handleAddCollaborators}
          onCancel={() => setShowAddCollab(false)}
        />
      )}
      {showComplete && (
        <CompleteConfirmDialog
          taskTitle={task.title}
          submitting={submitting}
          onConfirm={() => void handleDirectComplete()}
          onCancel={() => setShowComplete(false)}
        />
      )}
      {showSubmitConfirm && (
        <SubmitConfirmDialog
          taskTitle={task.title}
          submitting={submitting}
          onConfirm={() => void handleSubmitForReview()}
          onCancel={() => setShowSubmitConfirm(false)}
        />
      )}
      {showMove && (
        <MoveTaskDialog
          key={`move-task-${task.task_id}`}
          task={task}
          categories={categories}
          products={products}
          onConfirm={handleMoveConfirm}
          onClose={() => setShowMove(false)}
        />
      )}
      {transferOpen && (
        <TransferToProcurementModal
          taskId={task.task_id}
          taskTitle={task.title}
          owner={task.primary_owner}
          priority={task.final_priority}
          dueDate={task.due_date}
          attachments={transferAttachments}
          onTransferred={setProcTask}
          onClose={() => setTransferOpen(false)}
        />
      )}
      {showApproval && (
        <ApprovalActionDialog
          mode={showApproval}
          task={task}
          submitting={submitting}
          onConfirm={handleApproval}
          onCancel={() => setShowApproval(null)}
        />
      )}
      {showCreateSubtask && (
        <CreateSubtaskDialog
          parentTask={task}
          people={people}
          onConfirm={handleCreateSubtask}
          onCancel={() => setShowCreateSubtask(false)}
        />
      )}
      {showAttachSubtasks && (
        <AttachSubtasksDialog
          parentTask={task}
          candidates={attachCandidates}
          onConfirm={handleAttachSubtasks}
          onCancel={() => setShowAttachSubtasks(false)}
        />
      )}

      {/* 人员名下任务弹层（Radix Dialog）：点任务跳转到该任务的详情页 */}
      <Dialog open={Boolean(personTasksFor)} onOpenChange={(open) => { if (!open) setPersonTasksFor(null); }}>
        <DialogContent className="max-w-md rounded-2xl border-slate-200 bg-white p-5 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              {personTasksFor && <OwnerAvatar name={personTasksFor} size="sm" />}
              <span>
                {personTasksFor}
                <span className="ml-2 text-[11px] font-normal text-slate-400">名下活跃任务 {tasksOfPerson.length} 条</span>
              </span>
            </DialogTitle>
          </DialogHeader>
          <div className="cockpit-scroll max-h-[50vh] space-y-1.5 overflow-y-auto">
            {tasksOfPerson.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-400">暂无活跃任务</p>
            ) : (
              tasksOfPerson.map((t) => {
                const tCfg = STATUS_CONFIG[t.status] ?? STATUS_CONFIG.in_progress;
                return (
                  <button
                    key={t.task_id}
                    type="button"
                    onClick={() => {
                      setPersonTasksFor(null);
                      if (t.task_id !== taskId) navigate(`/rd-task/${encodeURIComponent(t.task_id)}`);
                    }}
                    className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg border border-slate-100 px-3 py-2 text-left transition hover:border-indigo-200 hover:bg-indigo-50/40"
                  >
                    <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", tCfg.dot)} />
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{t.title}</span>
                    <span className={cn("shrink-0 text-[11px] font-medium", tCfg.text)}>{tCfg.label}</span>
                    <span className="shrink-0 text-[11px] tabular-nums text-slate-400">{t.progress}%</span>
                  </button>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}

/** 编辑任务标题/描述（主管）：与移交/协作人弹窗同风格的轻量弹窗 */
function EditTaskInfoDialog({
  initialTitle,
  initialDescription,
  onConfirm,
  onCancel,
}: {
  initialTitle: string;
  initialDescription: string;
  onConfirm: (title: string, description: string) => Promise<void>;
  onCancel: () => void;
}) {
  useI18n();
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onConfirm(title, description);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("保存失败，请重试"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={saving ? undefined : onCancel}>
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-slate-100 px-6 py-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600">
            <Pencil className="h-4 w-4" />
          </div>
          <h3 className="text-base font-semibold text-slate-900">{t("编辑任务信息")}</h3>
        </div>
        <div className="space-y-4 px-6 py-5">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-700">{t("任务标题")} <span className="text-red-500">*</span></label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              autoFocus
              className="h-9 rounded-lg border-slate-200 text-sm"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-700">{t("任务描述")}</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              placeholder={t("补充任务背景、目标与交付要求…")}
              className="cockpit-scroll w-full resize-none rounded-lg border-slate-200 text-sm"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-3">
          <button
            type="button"
            disabled={saving}
            onClick={onCancel}
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            {t("取消")}
          </button>
          <button
            type="button"
            disabled={saving || !title.trim()}
            onClick={() => void handleSave()}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
            {t("保存")}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 在父任务下直建子任务。分类/产品库继承父任务，故无需选类目；
 * 状态直接给 in_progress（管理员在详情页操作，按约定不走立项审批）。
 */
function CreateSubtaskDialog({
  parentTask,
  people,
  onConfirm,
  onCancel,
}: {
  parentTask: RdTask;
  people: PersonProfile[];
  onConfirm: (input: {
    title: string;
    primary_owner: string;
    primary_owner_user_id: string | null;
    due_date: string;
    final_priority: RdPriority;
    description: string;
  }) => Promise<void>;
  onCancel: () => void;
}) {
  useI18n();
  const [title, setTitle] = useState("");
  const [ownerName, setOwnerName] = useState(parentTask.primary_owner ?? "");
  const [dueDate, setDueDate] = useState(parentTask.due_date ?? "");
  const [priority, setPriority] = useState<RdPriority>(parentTask.final_priority ?? "medium");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const activePeople = useMemo(
    () => people.filter((p) => p.status !== "left" && p.status !== "resigned"),
    [people],
  );

  const handleSave = async () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      const picked = activePeople.find((p) => p.name === ownerName);
      await onConfirm({
        title: title.trim(),
        primary_owner: ownerName.trim() || "待指派",
        primary_owner_user_id: picked?.user_id ?? null,
        due_date: dueDate,
        final_priority: priority,
        description: description.trim(),
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("创建子任务失败，请重试"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={saving ? undefined : onCancel}
    >
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-slate-100 px-6 py-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-50 text-sky-600">
            <FileText className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-slate-900">{t("新建子任务")}</h3>
            <p className="truncate text-[11px] text-slate-400">
              {t("父任务：{title}", { title: parentTask.title })}
            </p>
          </div>
        </div>
        <div className="space-y-4 px-6 py-5">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-700">
              {t("子任务标题")} <span className="text-red-500">*</span>
            </label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              autoFocus
              placeholder={t("这个子任务要交付什么…")}
              className="h-9 rounded-lg border-slate-200 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-700">{t("主责人")}</label>
              <Select value={ownerName || "待指派"} onValueChange={setOwnerName}>
                <SelectTrigger className="h-9 rounded-lg border-slate-200 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="待指派">{t("待指派")}</SelectItem>
                  {activePeople.map((p) => (
                    <SelectItem key={p.id} value={p.name}>
                      {displayPersonName(p.name)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-700">{t("优先级")}</label>
              <Select value={priority} onValueChange={(v) => setPriority(v as RdPriority)}>
                <SelectTrigger className="h-9 rounded-lg border-slate-200 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="high">{t("高")}</SelectItem>
                  <SelectItem value="medium">{t("中")}</SelectItem>
                  <SelectItem value="low">{t("低")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-700">{t("截止日期")}</label>
            <Input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="h-9 rounded-lg border-slate-200 text-sm"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-700">{t("任务描述")}</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder={t("补充子任务的目标与交付要求…")}
              className="cockpit-scroll w-full resize-none rounded-lg border-slate-200 text-sm"
            />
          </div>
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
            {t("子任务的产品库与分类路径继承父任务；子任务下不能再挂子任务（仅支持一层）。")}
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-3">
          <button
            type="button"
            disabled={saving}
            onClick={onCancel}
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            {t("取消")}
          </button>
          <button
            type="button"
            disabled={saving || !title.trim()}
            onClick={() => void handleSave()}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
            {t("创建子任务")}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 把已有的独立任务并入当前任务成为子任务（可多选）。任务本体完整保留，仅改变归属位置。
 * 与「合并申请」不同：这里不归档源任务、不改写描述、不改主责人，也不走审批。
 */
function AttachSubtasksDialog({
  parentTask,
  candidates,
  onConfirm,
  onCancel,
}: {
  parentTask: RdTask;
  candidates: RdTask[];
  onConfirm: (childIds: string[]) => Promise<void>;
  onCancel: () => void;
}) {
  useI18n();
  const [keyword, setKeyword] = useState("");
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return candidates;
    return candidates.filter(
      (c) =>
        c.title.toLowerCase().includes(kw) ||
        c.task_id.toLowerCase().includes(kw) ||
        (c.primary_owner ?? "").toLowerCase().includes(kw),
    );
  }, [candidates, keyword]);

  const toggle = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    if (picked.size === 0 || saving) return;
    setSaving(true);
    try {
      await onConfirm(Array.from(picked));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("并入失败，请重试"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={saving ? undefined : onCancel}
    >
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-slate-100 px-6 py-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600">
            <ChevronRight className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-slate-900">{t("并入已有任务为子任务")}</h3>
            <p className="truncate text-[11px] text-slate-400">
              {t("父任务：{title}", { title: parentTask.title })}
            </p>
          </div>
        </div>
        <div className="border-b border-slate-100 px-6 py-3">
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            autoFocus
            placeholder={t("搜索任务标题 / 编号 / 主责人")}
            className="h-9 rounded-lg border-slate-200 text-sm"
          />
        </div>
        <div className="cockpit-scroll min-h-0 flex-1 space-y-1.5 overflow-y-auto px-6 py-3">
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">
              {candidates.length === 0 ? t("没有可并入的独立任务") : t("没有匹配的任务")}
            </p>
          ) : (
            filtered.map((c) => {
              const cfg = STATUS_CONFIG[c.status] ?? STATUS_CONFIG.in_progress;
              const checked = picked.has(c.task_id);
              return (
                <button
                  key={c.task_id}
                  type="button"
                  onClick={() => toggle(c.task_id)}
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition",
                    checked
                      ? "border-amber-300 bg-amber-50/70"
                      : "border-slate-100 hover:border-amber-200 hover:bg-amber-50/30",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                      checked ? "border-amber-500 bg-amber-500 text-white" : "border-slate-300 bg-white",
                    )}
                  >
                    {checked && <CheckCircle2 className="h-3 w-3" />}
                  </span>
                  <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", cfg.dot)} />
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-700">
                    <AutoTranslatedText text={c.title} />
                  </span>
                  <span className="shrink-0 text-[11px] text-slate-400">{displayPersonName(c.primary_owner)}</span>
                  <span className="shrink-0 font-mono text-[11px] text-slate-400">{c.task_id}</span>
                </button>
              );
            })
          )}
        </div>
        <div className="border-t border-slate-100 px-6 py-3">
          <p className="mb-2 text-[11px] leading-relaxed text-slate-500">
            {t("并入后任务本体完整保留（标题 / 主责人 / 进度 / 留痕 / 附件），仅归属变为本任务的子任务，可随时取消。跨产品库的任务会一并迁到本任务所在产品库。")}
          </p>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-slate-500">{t("已选 {n} 个", { n: picked.size })}</span>
            <span className="flex gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={onCancel}
                className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                {t("取消")}
              </button>
              <button
                type="button"
                disabled={saving || picked.size === 0}
                onClick={() => void handleSave()}
                className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-amber-700 disabled:opacity-60"
              >
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                {t("并入为子任务")}
              </button>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
