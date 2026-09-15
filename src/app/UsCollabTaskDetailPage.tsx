import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MentionSuggestionPanel, useMentions, type MentionCandidate } from "./components/MentionInput";
import { useLocation, useNavigate, useParams } from "react-router";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Loader2,
  MessageCircleMore,
  Pencil,
  RefreshCw,
  ShieldAlert,
  Moon,
  Sparkles,
  Sun,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "./components/ui/utils";
import { Button } from "./components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";
import { Progress } from "./components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { useAnyPermission } from "./hooks/usePermission";
import { useAuth } from "./auth";
import { Input } from "./components/ui/input";
import { Textarea } from "./components/ui/textarea";
import { HorizonEmptyState, HorizonPageHeader } from "./components/horizon/HorizonPage";
import { PERMISSIONS } from "./lib/permissions";
import { t, useI18n } from "./lib/i18n";
import { AutoTranslatedText } from "./components/TranslatableText";
import { AuditTimeline } from "./RDAuditTimeline";
import {
  addAuditLogNote,
  auditActorMatchesIdentity,
  filterAuditLogsByActor,
  filterAuditLogsForViewer,
  useAuditActor,
  type AuditActorIdentity,
  type AuditLog,
  useAuditLogs,
} from "./lib/auditLog";
import { inferAttachmentMime } from "./components/AttachmentPreviewDialog";
import { ResourceDownloadLink } from "./components/ResourceDownloadLink";
import { refreshRdAttachment } from "./lib/attachmentAccess";
import { AttachmentPreviewModal, ProgressAttachmentGrid, TaskImageGallery, TaskImageGalleryScope, formatRdFileSize, formatTraceDateTime } from "./RDProgressEvidence";
import { RDTaskConversation } from "./RDTaskConversation";
import {
  STATUS_CONFIG,
  PRIORITY_CONFIG,
  WorkItemsSection,
  HandoverDialog,
  AddCollaboratorsDialog,
  CompleteConfirmDialog,
  ApprovalActionDialog,
  displayPersonName,
  downloadUsCollabTaskReport,
  flattenTasks,
  OwnerAvatar,
  type PersonProfile,
} from "./RDTaskManagementPage";
import { getReviewTypeMeta } from "./lib/reviewTypes";
// 页面路径以「页面路由管理」的配置为准，随主路径变更自动跟随
import { routePath } from "./lib/routePaths";
import {
  blockedDaysOf,
  createRdTaskProgressNote,
  fetchMergedTaskCategories,
  fetchRdPeople,
  isMentionablePerson,
  fetchRdTaskProgressNoteGroup,
  fetchRdTaskProgressNotes,
  generateRdTaskBrief,
  getAttachmentDownloadUrl,
  getAttachmentUrl,
  markRdTaskNotesRead,
  updateRdTask,
  type RdCollaborator,
  type RdPriority,
  type RdTask,
  type RdTaskBrief,
  type RdTaskProgressAttachment,
  type RdTaskProgressNote,
} from "./lib/rdApi";

type DetailTab = "notes" | "conversation" | "attachments" | "audit";

// ── 跨时区协同：成员当地时间 ──────────────────────────────────────────────────
// 时区启发：名字含中文或角色含「中方/中国」→ 北京；否则按美东（波士顿团队）。
function personTimeZone(name: string, role?: string): { tz: string; label: string } {
  const isChina = /[一-鿿]/.test(name) || /中方|中国/.test(role ?? "");
  return isChina ? { tz: "Asia/Shanghai", label: t("北京") } : { tz: "America/New_York", label: t("波士顿") };
}

/** 成员当地时间小徽标（每分钟刷新）：跨时区找人前先看对方那边几点 */
function LocalClock({ name, role, lang }: { name: string; role?: string; lang: "zh" | "en" }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const { tz, label } = personTimeZone(name, role);
  const displayName = name === "待指派" || name === "未指派" ? t(name) : name;
  const displayLocation = lang === "en" ? (tz === "America/New_York" ? "Boston" : "Beijing") : label;
  const time = new Intl.DateTimeFormat(lang === "en" ? "en-US" : "zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(now);
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: tz }).format(now));
  const isDaytime = hour >= 7 && hour < 19;
  return (
    <span
      className="ml-auto inline-flex shrink-0 items-center gap-1 text-[11px] tabular-nums text-slate-400"
      title={t("{name} 当地时间（{location}）", { name: displayName, location: displayLocation })}
    >
      {displayLocation} {time}
      {isDaytime ? <Sun className="h-3 w-3" aria-hidden="true" /> : <Moon className="h-3 w-3" aria-hidden="true" />}
    </span>
  );
}

/**
 * 中美协同 · 任务全屏详情页（双栏布局，Velzon 任务详情式）：
 * 左栏为任务档案（字段表 / 人员 / 快捷操作），右主栏为纵向过程叙事
 * （AI 小结 → 描述 → 工作项 → 留痕/附件库/操作记录 Tab）。
 * 仅协同模块入口可达（驾驶舱详情抽屉「全屏查看」），不影响其他驾驶舱。
 */
export default function UsCollabTaskDetailPage() {
  const { taskId = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const activityActor = useMemo<AuditActorIdentity | null>(() => {
    const params = new URLSearchParams(location.search);
    const id = params.get("activity_user_id")?.trim() ?? "";
    const name = params.get("activity_user_name")?.trim() ?? "";
    return id || name ? { id: id || null, name: name || null } : null;
  }, [location.search]);
  const cockpitReturnPath = `${routePath("page:us-collab-cockpit", "/us-collab-cockpit")}${location.search}`;
  const taskDetailPath = useCallback(
    (id: string) => `/us-collab-task/${encodeURIComponent(id)}${location.search}`,
    [location.search],
  );
  const shouldReduceMotion = useReducedMotion();
  const { lang } = useI18n(); // i18n：订阅语言切换（本页文案已 t() 化）
  void lang;
  const { user } = useAuth();
  const canView = useAnyPermission("page:us-collab-cockpit", "page:us-collab-workspace");
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
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [notes, setNotes] = useState<RdTaskProgressNote[]>([]);
  const [groupNotes, setGroupNotes] = useState<RdTaskProgressNote[]>([]);
  const [previewAttachment, setPreviewAttachment] = useState<RdTaskProgressAttachment | null>(null);
  const [notesLoading, setNotesLoading] = useState(true);
  const [tab, setTab] = useState<DetailTab>("notes");
  const [discussionUnread, setDiscussionUnread] = useState(0);
  const [discussionThreadOpen, setDiscussionThreadOpen] = useState(false);
  const [noteItemFilter, setNoteItemFilter] = useState<string>("all");
  const [brief, setBrief] = useState<RdTaskBrief | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [people, setPeople] = useState<PersonProfile[]>([]);
  const [showHandover, setShowHandover] = useState(false);
  const [showEditInfo, setShowEditInfo] = useState(false);
  const [showAddCollab, setShowAddCollab] = useState(false);
  const [showComplete, setShowComplete] = useState(false);
  const [showApproval, setShowApproval] = useState<"approve" | "reject" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [savingPriority, setSavingPriority] = useState(false);
  /** 点击人员后展示其名下任务的弹层（点任务跳转到该任务的详情页） */
  const [personTasksFor, setPersonTasksFor] = useState<string | null>(null);
  // ── 评论式留痕框（时间线底部常驻，「在哪看就在哪写」）──
  const [composerText, setComposerText] = useState("");
  const [composerFiles, setComposerFiles] = useState<File[]>([]);
  const [composerItemId, setComposerItemId] = useState("");
  const [sendingNote, setSendingNote] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const editTaskButtonRef = useRef<HTMLButtonElement>(null);
  const closeEditInfo = useCallback(() => {
    setShowEditInfo(false);
    window.requestAnimationFrame(() => editTaskButtonRef.current?.focus());
  }, []);
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
      for (const c of task.collaborators ?? []) push(c.name, c.user_id, c.role ? t(c.role) : t("协作人"));
    }
    // 只在 @ 候选里排除离职/停用；其他用途仍用完整名单
    for (const p of people.filter(isMentionablePerson)) push(p.name, p.user_id ?? null);
    return out;
  }, [task, people]);
  const mention = useMentions({ value: composerText, setValue: setComposerText, inputRef: composerRef, candidates: mentionCandidates });
  const allAuditLogs = useAuditLogs({ resourceType: "task", resourceId: taskId });
  const auditLogs = useMemo(
    () => activityActor ? filterAuditLogsByActor(allAuditLogs, activityActor) : allAuditLogs,
    [activityActor, allAuditLogs],
  );

  // 视口内布局的可用高度：实测容器到视口顶的距离（覆盖全局顶栏/面包屑/内边距的任意组合），
  // 不猜固定偏移。xl 以下仍是单列，返回 null 走自然文档流，避免 1024–1279px 被固定高度裁切。
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  useEffect(() => {
    const measure = () => {
      if (!rootRef.current || window.innerWidth < 1280) {
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
      const found = all.find((t) => t.task_id === taskId) ?? null;
      if (!found) setLoadError(t("任务不存在或已被删除"));
      setTask(found);
    } catch (error) {
      if (seq !== loadSeqRef.current) return;
      setLoadError(error instanceof Error ? error.message : t("任务加载失败"));
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  }, [taskId]);

  // 秒开：驾驶舱/序列导航经 location.state 带来任务快照，先渲染再后台静默拉最新覆盖

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
      // status / user_status 必须带上：@ 候选要靠它们排除离职与停用账号
      .then((data) => setPeople(data.map((p) => ({
        id: p.id,
        user_id: p.user_id ?? null,
        name: p.name,
        position: p.position ?? "",
        status: p.status,
        user_status: p.user_status ?? null,
      }))))
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

  // 附件库要覆盖整棵关系树（合并进来的子任务 + 自建子任务），单任务留痕接口取不到；
  // 留痕 Tab 仍按当前任务展示，所以两份数据并存而不是互相替换。
  useEffect(() => {
    let cancelled = false;
    fetchRdTaskProgressNoteGroup(taskId)
      .then((data) => { if (!cancelled) setGroupNotes(data.notes); })
      .catch(() => { if (!cancelled) setGroupNotes([]); });
    return () => { cancelled = true; };
  }, [taskId]);

  const activityNotes = useMemo(
    () => activityActor ? notes.filter((note) => auditActorMatchesIdentity(note.actor, activityActor)) : notes,
    [activityActor, notes],
  );
  const noteCountByItem = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of activityNotes) {
      if (n.work_item_id) m.set(n.work_item_id, (m.get(n.work_item_id) ?? 0) + 1);
    }
    return m;
  }, [activityNotes]);

  const filteredNotes = useMemo(() => {
    if (noteItemFilter === "all") return activityNotes;
    if (noteItemFilter === "main") {
      // 「未关联」含孤儿留痕：关联的工作项被删除后，其留痕归入这里（承诺"删除工作项后留痕保留在主任务"）
      const existingItemIds = new Set((task?.work_items ?? []).map((it) => it.id));
      return activityNotes.filter((n) => !n.work_item_id || !existingItemIds.has(n.work_item_id));
    }
    return activityNotes.filter((n) => n.work_item_id === noteItemFilter);
  }, [activityNotes, noteItemFilter, task?.work_items]);

  // 整组接口拿不到时（任务不在任务池、镜像任务等会 404）退回当前任务的留痕：
  // 附件库原先就是用它渲染的，不能因为多加了一次聚合请求反而把已有附件弄没了。
  const attachmentSourceNotes = groupNotes.length > 0 ? groupNotes : notes;
  const docAttachments = useMemo(() => {
    const seen = new Set<string>();
    return attachmentSourceNotes
      .flatMap((n) =>
        (n.attachments ?? [])
          .filter((att) => !inferAttachmentMime(att).startsWith("image/"))
          .map((att) => ({
            att,
            createdAt: n.created_at,
            actor: n.actor?.name ?? "",
            sourceTaskId: n.source_task?.task_id ?? n.task_id,
            sourceTaskTitle: n.source_task?.title ?? "",
          })),
      )
      .filter((item) => {
        const key = item.att.object_key || item.att.id || `${item.att.name}|${item.att.size}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [attachmentSourceNotes]);

  // 导出报告用：audit 记录 + 无对应 audit 的留痕合成条目（保证报告时间线完整）
  const reportLogs = useMemo<AuditLog[]>(() => {
    const matchedNoteIds = new Set(
      auditLogs.map((log) => (typeof log.metadata?.note_id === "string" ? log.metadata.note_id : "")).filter(Boolean),
    );
    const orphanLogs: AuditLog[] = activityNotes
      .filter((n) => !matchedNoteIds.has(n.id))
      .map((n) => ({
        id: `report-note-${n.id}`,
        timestamp: n.created_at,
        actor: { id: n.actor?.id ?? null, name: n.actor?.name ?? "研发成员", role: n.actor?.role ?? "研发成员" },
        action: "task.progress_updated" as const,
        resource: { type: "task" as const, id: taskId, name: task?.title ?? "" },
        comment: n.text || "更新任务进度",
        metadata: { note_id: n.id, synthetic: true },
        source: "web" as const,
      }));
    return filterAuditLogsForViewer([...auditLogs, ...orphanLogs], user);
  }, [activityNotes, auditLogs, taskId, task?.title, user]);
  const noteById = useMemo(() => new Map(activityNotes.map((n) => [n.id, n] as const)), [activityNotes]);
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
    setSendingNote(true);
    try {
      await createRdTaskProgressNote({
        task_id: task.task_id,
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
      // 重拉留痕让时间线/附件库即时可见
      try {
        setNotes(await fetchRdTaskProgressNotes(task.task_id));
      } catch {
        /* 拉取失败不影响已提交结果 */
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "记录进展失败");
    } finally {
      setSendingNote(false);
    }
  };

  const handleGenerateBrief = async () => {
    if (briefLoading) return;
    setBriefLoading(true);
    try {
      setBrief(await generateRdTaskBrief(taskId));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "生成任务小结失败");
    } finally {
      setBriefLoading(false);
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
    const currentTitle = task.title ?? "";
    const titleChanged = title !== currentTitle;
    const descChanged = nextDescription !== (task.description ?? "");
    if (titleChanged) changes.push({ field: "title", before: currentTitle, after: title });
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
      closeEditInfo();
      return;
    }
    // 只提交实际变更的字段，避免把 undefined 描述静默覆写成空串
    await updateRdTask(task.task_id, {
      ...(titleChanged ? { title } : {}),
      ...(descChanged ? { description: nextDescription } : {}),
    });
    setTask((prev) => (prev ? { ...prev, title, description: nextDescription } : prev));
    setAllTasks((prev) => prev.map((item) => (item.task_id === task.task_id ? { ...item, title, description: nextDescription } : item)));
    closeEditInfo();
    toast.success(t("任务信息已更新"));
  };

  const savePriority = async (next: RdPriority) => {
    if (!task || savingPriority || next === task.final_priority) return;
    const prev = task.final_priority;
    setSavingPriority(true);
    try {
      await updateRdTask(task.task_id, { final_priority: next });
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
      toast.success(t("任务已标记完成"));
      setShowComplete(false);
      void loadTask();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败");
    } finally {
      setSubmitting(false);
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
      if (target) navigate(taskDetailPath(target.task_id), { state: { task: target } });
    },
    [taskSeq, seqIndex, navigate, taskDetailPath],
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
      <div className="horizon-theme hz-page mx-auto flex min-h-[40vh] w-full max-w-[1500px] items-center justify-center px-4 py-6" role="alert">
        <HorizonEmptyState
          Icon={ShieldAlert}
          title={t("您没有访问此页面的权限")}
          description={t("如需查看协同任务档案，请联系管理员开通协同驾驶舱或协同工作台权限。")}
          action={(
            <Button type="button" variant="outline" onClick={() => navigate(cockpitReturnPath)}>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              {t("返回驾驶舱")}
            </Button>
          )}
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="horizon-theme hz-page mx-auto flex min-h-[40vh] w-full max-w-[1500px] items-center justify-center gap-2 px-4 py-6 text-sm text-slate-500" role="status" aria-live="polite">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("正在加载任务…")}
      </div>
    );
  }

  if (!task) {
    return (
      <div className="horizon-theme hz-page mx-auto flex min-h-[40vh] w-full max-w-[1500px] items-center justify-center px-4 py-6">
        <HorizonEmptyState
          Icon={AlertTriangle}
          title={t("无法打开协同任务")}
          description={loadError || t("任务不存在，可能已被归档或移除。")}
          action={(
            <div className="flex flex-wrap justify-center gap-2">
              <Button type="button" variant="outline" onClick={() => void loadTask()}>
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                {t("重新加载")}
              </Button>
              <Button type="button" onClick={() => navigate(cockpitReturnPath)}>
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                {t("返回驾驶舱")}
              </Button>
            </div>
          )}
        />
      </div>
    );
  }

  const sCfg = STATUS_CONFIG[task.status] ?? STATUS_CONFIG.in_progress;
  const pCfg = PRIORITY_CONFIG[task.final_priority] ?? PRIORITY_CONFIG.medium;
  const blockedDays = blockedDaysOf(task);
  const workItems = task.work_items ?? [];
  const displayTaskTitle = task.title?.trim() || t("未命名协同任务");

  // 大屏（xl+）视口内布局：整页不滚，AI 小结/时间线各自内滚；窄屏维持自然文档流
  return (
    <TaskImageGalleryScope notes={attachmentSourceNotes}>
      <motion.div
      ref={rootRef}
      initial={shouldReduceMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      style={viewportHeight ? { height: viewportHeight } : undefined}
      className="horizon-theme hz-page rd-horizon-module rd-horizon-us-detail mx-auto flex w-full max-w-[1500px] min-w-0 flex-col gap-4 overflow-x-hidden px-3 py-4 sm:px-4 lg:px-5"
    >
      <HorizonPageHeader
        Icon={MessageCircleMore}
        eyebrow={t("中美协同 · 任务档案")}
        title={<AutoTranslatedText text={displayTaskTitle} />}
        description={t("集中查看跨时区协作责任、工作项、进展证据与任务讨论。")}
        className="rd-horizon-us-detail-command shrink-0"
        meta={(
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="rounded-md border border-slate-200 bg-white px-2 py-1 font-mono text-[11px] text-slate-500">{task.task_id}</span>
            <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", sCfg.bg, sCfg.text)}>
              <span className={cn("h-1.5 w-1.5 rounded-full", sCfg.dot)} />
              {t(sCfg.label)}
            </span>
            {canManage && !task.archived && task.status !== "completed" ? (
              <Select value={task.final_priority} disabled={savingPriority} onValueChange={(value) => void savePriority(value as RdPriority)}>
                <SelectTrigger
                  className={cn(
                    "w-auto shrink-0 gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold shadow-none",
                    "min-h-0 data-[size=default]:h-auto data-[size=sm]:h-auto [&_svg:not([class*='size-'])]:size-3 [&_svg:not([class*='text-'])]:text-current",
                    pCfg.bg,
                    pCfg.text,
                  )}
                  aria-label={t("调整任务优先级")}
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
        )}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => navigate(cockpitReturnPath)}>
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              {t("返回驾驶舱")}
            </Button>
            {seqIndex >= 0 && taskSeq.length > 1 ? (
              <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1" role="group" aria-label={t("任务序列导航")}>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => gotoSeq(-1)}
                  disabled={seqIndex <= 0}
                  aria-label={t("上一条任务（k）")}
                  className="h-7 w-7 p-0"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="min-w-12 text-center text-xs tabular-nums text-slate-500">{seqIndex + 1} / {taskSeq.length}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => gotoSeq(1)}
                  disabled={seqIndex >= taskSeq.length - 1}
                  aria-label={t("下一条任务（j）")}
                  className="h-7 w-7 p-0"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            ) : null}
            {canManage && !task.archived ? (
              <Button ref={editTaskButtonRef} type="button" size="sm" onClick={() => setShowEditInfo(true)}>
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                {t("编辑任务")}
              </Button>
            ) : null}
          </div>
        )}
      />

      {/* 美式 content-first 布局：主内容（描述/工作项/时间线）居左，Properties 侧栏居右（GitHub issue / Linear 范式） */}
      <div className="grid min-h-0 flex-1 gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
        {/* ══ 右侧 Properties 栏（单一面板，分节细线分隔；超高自身内滚）══ */}
        <div className="cockpit-scroll min-h-0 xl:order-2 xl:overflow-y-auto">
        <div className="hz-surface overflow-hidden border divide-y divide-slate-100">
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
              // 注：「分类路径」是研发侧 BOM 系统概念，协同任务不展示
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

          {/* 人员节（点击查看其名下任务，可跳转到对应任务详情） */}
          <div className="px-4 py-3.5">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500">{t("主责人")}</span>
              {canManage && !task.archived && (
                <button
                  type="button"
                  onClick={() => setShowAddCollab(true)}
                  className="cursor-pointer rounded-md px-1.5 py-1 text-[11px] font-semibold text-[#002fa7] transition-colors hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#002fa7]/25"
                >
                  + {t("添加协作人")}
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => setPersonTasksFor(task.primary_owner)}
              className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-1 py-0.5 text-left hover:bg-slate-50"
              title={t("查看 {name} 名下的任务", { name: displayPersonName(task.primary_owner) })}
            >
              <OwnerAvatar name={task.primary_owner} userId={task.primary_owner_user_id} size="sm" />
              <span className="text-sm font-medium text-slate-800">{displayPersonName(task.primary_owner)}</span>
              <LocalClock name={task.primary_owner} lang={lang} />
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
                      title={t("查看 {name} 名下的任务", { name: c.name })}
                    >
                      <OwnerAvatar name={c.name} userId={c.user_id} size="xs" />
                      <span className="text-sm text-slate-700">{c.name}</span>
                      <span className="text-[11px] text-slate-400">{t(c.role)}</span>
                      <LocalClock name={c.name} role={c.role} lang={lang} />
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* 操作节（紧凑列表式，Linear 风） */}
          <div className="space-y-1.5 px-4 py-3.5">
            <Button type="button" size="sm" onClick={() => void handleGenerateBrief()} disabled={briefLoading} className="h-8 w-full gap-1.5 text-xs">
              {briefLoading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {t("AI 任务小结")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void downloadUsCollabTaskReport(task, reportLogs, reportNoteOf)}
              className="h-8 w-full gap-1.5 text-xs"
            >
              <Download className="h-3.5 w-3.5" />
              {t("导出过程报告")}
            </Button>
            {/* 审批：待审核任务的通过/驳回（协同侧唯一审批入口——驾驶舱直达本页，抽屉不再打开） */}
            {canManage && task.status === "pending_review" && getReviewTypeMeta(task.pending_review_type) && (
              <>
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
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
          </div>
        </div>
        </div>

        {/* ══ 主内容列（左）：纵向过程叙事——Tab 卡吃掉剩余高度，内容内滚 ══ */}
        <div className="flex min-h-0 min-w-0 flex-col gap-4 xl:order-1">
          {/* AI 小结卡：限最大高度，超出内滚 */}
          {brief && (
            <div className="shrink-0 rounded-xl border border-blue-200 bg-blue-50/70 px-4 py-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="flex items-center gap-1 text-xs font-semibold text-[#002fa7]">
                  <Sparkles className="h-3.5 w-3.5" />
                  {t("任务小结")}{brief.source === "local" ? t("（AI 未配置，基础事实版）") : ""}
                </span>
                <button
                  type="button"
                  onClick={() => setBrief(null)}
                  aria-label={t("关闭任务小结")}
                  className="cursor-pointer rounded p-0.5 text-blue-400 transition-colors hover:bg-blue-100 hover:text-[#002fa7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#002fa7]/30"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <AutoTranslatedText
                as="p"
                text={brief.text}
                className="cockpit-scroll max-h-52 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-slate-700"
              />
            </div>
          )}

          {/* 任务描述 */}
          {task.description && (
            <div className="hz-surface shrink-0 border px-4 py-3">
              <div className="mb-1.5 text-xs font-semibold text-slate-500">{t("任务描述")}</div>
              <AutoTranslatedText
                as="p"
                text={task.description}
                className="cockpit-scroll max-h-40 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-slate-700"
              />
            </div>
          )}

          {/* 工作项（只读展示）：创建/勾选/删除入口在协同工作台，成员按需自建 */}
          <div className="shrink-0">
            <WorkItemsSection
              task={task}
              canEdit={false}
              noteCountByItem={noteCountByItem}
              onTaskPatched={(_, patch) => setTask((prev) => (prev ? { ...prev, ...patch } : prev))}
            />
          </div>

          {/* Tab：进度留痕 / 任务讨论 / 操作记录 / 附件库 —— 卡片吃掉主列剩余高度，内容区各自内滚 */}
          <div className="hz-surface flex min-h-0 flex-1 flex-col overflow-hidden border p-0 lg:min-h-[280px]">
            <Tabs value={tab} onValueChange={(value) => setTab(value as DetailTab)} className="flex min-h-0 flex-1 flex-col">
              <TabsList className="cockpit-scroll h-auto w-full shrink-0 justify-start gap-3 overflow-x-auto rounded-none border-b border-slate-200/80 bg-transparent p-0 px-3 sm:gap-5 sm:px-4">
                {([
                  { key: "notes", label: t("进展留痕"), count: activityNotes.length },
                  { key: "conversation", label: t("任务讨论"), count: discussionUnread },
                  { key: "audit", label: t("操作记录"), count: timelineLogs.length },
                  { key: "attachments", label: t("附件库"), count: null },
                ] as const).map((tabItem) => (
                  <TabsTrigger
                    key={tabItem.key}
                    value={tabItem.key}
                    className="-mb-px flex-none cursor-pointer gap-1.5 rounded-none border-0 border-b-2 border-transparent bg-transparent px-1 pb-3 pt-3.5 text-sm font-medium text-slate-500 shadow-none transition-colors hover:text-slate-800 data-[state=active]:border-[#002fa7] data-[state=active]:bg-transparent data-[state=active]:font-semibold data-[state=active]:text-slate-900 data-[state=active]:shadow-none"
                  >
                    {tabItem.key === "conversation" && <MessageCircleMore className="h-3.5 w-3.5 text-[#002fa7]" />}
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

              <TabsContent value="notes" className="min-h-0 min-w-0 flex-1 overflow-hidden data-[state=active]:flex">
                <RDTaskConversation
                  key={`progress-${task.task_id}`}
                  taskId={task.task_id}
                  taskTitle={displayTaskTitle}
                  notes={filteredNotes}
                  mode="progress"
                  variant="desktop"
                  notesLoading={notesLoading}
                  showHeader={false}
                  threadLayout="replace"
                  onUnreadChange={setDiscussionUnread}
                  onThreadOpenChange={setDiscussionThreadOpen}
                />
              </TabsContent>

              <TabsContent value="conversation" className="min-h-0 min-w-0 flex-1 overflow-hidden data-[state=active]:flex">
                <RDTaskConversation
                  key={`conversation-${task.task_id}`}
                  taskId={task.task_id}
                  taskTitle={displayTaskTitle}
                  notes={notes}
                  mode="task"
                  variant="desktop"
                  showHeader={false}
                  threadLayout="replace"
                  onUnreadChange={setDiscussionUnread}
                />
              </TabsContent>

              <TabsContent value="attachments" className="cockpit-scroll min-h-0 min-w-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
              <motion.div initial={shouldReduceMotion ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16 }} className="space-y-3">
                <TaskImageGallery notes={attachmentSourceNotes} />
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
                            <TableHead className="text-xs text-slate-400">{t("来源任务")}</TableHead>
                            <TableHead className="text-xs text-slate-400">{t("大小")}</TableHead>
                            <TableHead className="text-xs text-slate-400">{t("上传时间")}</TableHead>
                            <TableHead className="text-xs text-slate-400">{t("上传人")}</TableHead>
                            <TableHead className="text-xs text-slate-400">{t("操作")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {docAttachments.map(({ att, createdAt, actor, sourceTaskId, sourceTaskTitle }) => (
                            <TableRow key={att.id} className="border-slate-50 hover:bg-slate-50/60">
                              <TableCell className="max-w-[320px]">
                                {/* 文件名即预览入口：与留痕里的附件磁贴共用同一个弹窗 */}
                                <button
                                  type="button"
                                  onClick={() => setPreviewAttachment(att)}
                                  title={att.name}
                                  className="flex w-full min-w-0 cursor-pointer items-center gap-1.5 text-left transition hover:text-[#002fa7]"
                                >
                                  <FileText className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                                  <span className="min-w-0 truncate text-sm text-slate-700">{att.name}</span>
                                </button>
                              </TableCell>
                              <TableCell className="max-w-[200px]">
                                <span className="block min-w-0 truncate text-xs text-slate-500" title={sourceTaskTitle || sourceTaskId}>
                                  {sourceTaskId && sourceTaskId !== taskId ? (sourceTaskTitle || sourceTaskId) : t("本任务")}
                                </span>
                              </TableCell>
                              <TableCell className="whitespace-nowrap text-xs text-slate-500">{formatRdFileSize(att.size)}</TableCell>
                              <TableCell className="whitespace-nowrap text-xs text-slate-500">{formatTraceDateTime(createdAt)}</TableCell>
                              <TableCell className="whitespace-nowrap text-xs text-slate-500">{actor || "—"}</TableCell>
                              <TableCell className="whitespace-nowrap">
                                <ResourceDownloadLink
                                  refresh={att.task_id ? async () => getAttachmentDownloadUrl(await refreshRdAttachment(att)) : undefined}
                                  href={getAttachmentDownloadUrl(att)}
                                  download={att.name}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-xs font-semibold text-[#002fa7] hover:text-blue-800"
                                >
                                  <Download className="h-3 w-3" />
                                  {t("下载")}
                                </ResourceDownloadLink>
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
                  showResource={false}
                  emptyText={t("暂无操作记录")}
                  canAddNote={canManage}
                  onAddNote={async (logId, text) => {
                    await addAuditLogNote(logId, { text });
                  }}
                  notePlaceholder={t("填写备注（最多 200 字），仅主管可添加…")}
                  renderExtra={(log) => {
                    const note = reportNoteOf(log.id);
                    if (!note || note.attachments.length === 0) return null;
                    return <ProgressAttachmentGrid attachments={note.attachments} compact imageDisplay="clipped-cards" />;
                  }}
                />
              </motion.div>
              </TabsContent>
            </Tabs>

            {/* 正式留痕输入框只属于“进度留痕”，避免与任务讨论输入框混淆。 */}
            {tab === "notes" && canComposeNote && !discussionThreadOpen && (
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
          initialTitle={task.title ?? ""}
          initialDescription={task.description ?? ""}
          onConfirm={handleEditInfo}
          onCancel={closeEditInfo}
        />
      )}
      {showHandover && (
        <HandoverDialog
          taskId={task.task_id}
          taskTitle={displayTaskTitle}
          currentOwner={task.primary_owner}
          people={people}
          onConfirm={handleHandover}
          onCancel={() => setShowHandover(false)}
        />
      )}
      {showAddCollab && (
        <AddCollaboratorsDialog
          taskTitle={displayTaskTitle}
          currentOwner={task.primary_owner}
          existingCollaborators={task.collaborators ?? []}
          people={people}
          onConfirm={handleAddCollaborators}
          onCancel={() => setShowAddCollab(false)}
        />
      )}
      {showComplete && (
        <CompleteConfirmDialog
          taskTitle={displayTaskTitle}
          submitting={submitting}
          onConfirm={() => void handleDirectComplete()}
          onCancel={() => setShowComplete(false)}
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

      {/* 人员名下任务弹层（Radix Dialog）：点任务跳转到该任务的详情页 */}
      <Dialog open={Boolean(personTasksFor)} onOpenChange={(open) => { if (!open) setPersonTasksFor(null); }}>
        <DialogContent className="horizon-theme horizon-portal rounded-2xl border-slate-200 bg-white p-5 shadow-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              {personTasksFor && <OwnerAvatar name={personTasksFor} size="sm" />}
              <span>
                {personTasksFor}
                <span className="ml-2 text-[11px] font-normal text-slate-400">{t("名下活跃任务 {count} 条", { count: tasksOfPerson.length })}</span>
              </span>
            </DialogTitle>
          </DialogHeader>
          <div className="cockpit-scroll max-h-[50vh] space-y-1.5 overflow-y-auto">
            {tasksOfPerson.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-400">{t("暂无活跃任务")}</p>
            ) : (
              tasksOfPerson.map((t) => {
                const tCfg = STATUS_CONFIG[t.status] ?? STATUS_CONFIG.in_progress;
                return (
                  <button
                    key={t.task_id}
                    type="button"
                    onClick={() => {
                      setPersonTasksFor(null);
                      if (t.task_id !== taskId) navigate(taskDetailPath(t.task_id));
                    }}
                    className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg border border-slate-100 px-3 py-2 text-left transition-colors hover:border-blue-200 hover:bg-blue-50/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#002fa7]/20"
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
      {previewAttachment && (
        <AttachmentPreviewModal attachment={previewAttachment} onClose={() => setPreviewAttachment(null)} />
      )}
    </TaskImageGalleryScope>
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
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onCancel(); }}>
      <DialogContent
        className="horizon-theme horizon-portal rd-horizon-us-detail-dialog sm:max-w-md"
        onEscapeKeyDown={(event) => { if (saving) event.preventDefault(); }}
        onInteractOutside={(event) => { if (saving) event.preventDefault(); }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-950">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-[#002fa7]" aria-hidden="true">
              <Pencil className="h-4 w-4" />
            </span>
            {t("编辑任务信息")}
          </DialogTitle>
          <DialogDescription>{t("更新协同任务的标题与说明，保存后将同步到任务驾驶舱。")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!saving && title.trim()) void handleSave();
          }}
        >
          <div className="space-y-1.5">
            <label htmlFor="us-collab-task-title" className="block text-xs font-medium text-slate-700">{t("任务标题")} <span className="text-red-500">*</span></label>
            <Input
              id="us-collab-task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              autoFocus
              required
              aria-required="true"
              className="h-10 rounded-lg border-slate-200 text-base sm:text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="us-collab-task-description" className="block text-xs font-medium text-slate-700">{t("任务描述")}</label>
            <Textarea
              id="us-collab-task-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              placeholder={t("补充任务背景、目标与交付要求…")}
              className="cockpit-scroll w-full resize-none rounded-lg border-slate-200 text-base sm:text-sm"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={onCancel}>
              {t("取消")}
            </Button>
            <Button type="submit" disabled={saving || !title.trim()} className="bg-[#002fa7] text-white hover:bg-[#002787]">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {saving ? t("保存中…") : t("保存")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
