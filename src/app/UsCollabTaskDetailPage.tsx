import React, { useCallback, useEffect, useMemo, useState } from "react";
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
  Pencil,
  RefreshCw,
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
import { AutoTranslatedText, TranslatableText } from "./components/TranslatableText";
import { AuditTimeline } from "./RDAuditTimeline";
import { addAuditLogNote, recordAudit, useAuditActor, type AuditLog, useAuditLogs } from "./lib/auditLog";
import { ProgressAttachmentGrid, ProgressNoteList, TaskImageGallery, formatRdFileSize } from "./RDProgressEvidence";
import {
  STATUS_CONFIG,
  PRIORITY_CONFIG,
  WorkItemsSection,
  HandoverDialog,
  AddCollaboratorsDialog,
  CompleteConfirmDialog,
  ApprovalActionDialog,
  downloadUsCollabTaskReport,
  flattenTasks,
  OwnerAvatar,
  type PersonProfile,
} from "./RDTaskManagementPage";
import { getReviewTypeMeta } from "./lib/reviewTypes";
import {
  blockedDaysOf,
  createRdTaskProgressNote,
  fetchMergedTaskCategories,
  fetchRdPeople,
  fetchRdTaskProgressNotes,
  generateRdTaskBrief,
  getAttachmentUrl,
  updateRdTask,
  type RdCollaborator,
  type RdPriority,
  type RdTask,
  type RdTaskBrief,
  type RdTaskProgressNote,
} from "./lib/rdApi";

type DetailTab = "notes" | "attachments" | "audit";

// ── 跨时区协同：成员当地时间 ──────────────────────────────────────────────────
// 时区启发：名字含中文或角色含「中方/中国」→ 北京；否则按美东（波士顿团队）。
function personTimeZone(name: string, role?: string): { tz: string; label: string } {
  const isChina = /[一-鿿]/.test(name) || /中方|中国/.test(role ?? "");
  return isChina ? { tz: "Asia/Shanghai", label: t("北京") } : { tz: "America/New_York", label: t("波士顿") };
}

/** 成员当地时间小徽标（每分钟刷新）：跨时区找人前先看对方那边几点 */
function LocalClock({ name, role }: { name: string; role?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const { tz, label } = personTimeZone(name, role);
  const time = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(now);
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: tz }).format(now));
  const emoji = hour >= 7 && hour < 19 ? "☀️" : "🌙";
  return (
    <span className="ml-auto shrink-0 text-[11px] tabular-nums text-slate-400" title={`${name} 当地时间（${label}）`}>
      {label} {time} {emoji}
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
  const [notesLoading, setNotesLoading] = useState(true);
  const [tab, setTab] = useState<DetailTab>("audit");
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
  const auditLogs = useAuditLogs({ resourceType: "task", resourceId: taskId });

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
      .then((data) => { if (!cancelled) setNotes(data); })
      .catch(() => { if (!cancelled) setNotes([]); })
      .finally(() => { if (!cancelled) setNotesLoading(false); });
    return () => { cancelled = true; };
  }, [taskId]);

  const noteCountByItem = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of notes) {
      if (n.work_item_id) m.set(n.work_item_id, (m.get(n.work_item_id) ?? 0) + 1);
    }
    return m;
  }, [notes]);

  const filteredNotes = useMemo(() => {
    if (noteItemFilter === "all") return notes;
    if (noteItemFilter === "main") {
      // 「未关联」含孤儿留痕：关联的工作项被删除后，其留痕归入这里（承诺"删除工作项后留痕保留在主任务"）
      const existingItemIds = new Set((task?.work_items ?? []).map((it) => it.id));
      return notes.filter((n) => !n.work_item_id || !existingItemIds.has(n.work_item_id));
    }
    return notes.filter((n) => n.work_item_id === noteItemFilter);
  }, [notes, noteItemFilter, task?.work_items]);

  const docAttachments = useMemo(
    () =>
      notes.flatMap((n) =>
        (n.attachments ?? [])
          .filter((att) => !(att.mime ?? "").startsWith("image/"))
          .map((att) => ({ att, createdAt: n.created_at, actor: n.actor?.name ?? "" })),
      ),
    [notes],
  );

  // 导出报告用：audit 记录 + 无对应 audit 的留痕合成条目（保证报告时间线完整）
  const reportLogs = useMemo<AuditLog[]>(() => {
    const matchedNoteIds = new Set(
      auditLogs.map((log) => (typeof log.metadata?.note_id === "string" ? log.metadata.note_id : "")).filter(Boolean),
    );
    const orphanLogs: AuditLog[] = notes
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
    return [...auditLogs, ...orphanLogs];
  }, [auditLogs, notes, taskId, task?.title]);
  const noteById = useMemo(() => new Map(notes.map((n) => [n.id, n] as const)), [notes]);
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
      });
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
      comment: t("协同详情页编辑任务信息"),
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
      if (target) navigate(`/us-collab-task/${encodeURIComponent(target.task_id)}`, { state: { task: target } });
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
          onClick={() => navigate("/us-collab-cockpit")}
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
        <Button type="button" variant="outline" size="sm" onClick={() => navigate("/us-collab-cockpit")} className="gap-1">
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
              title="调整任务优先级"
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
      <div className="grid min-h-0 flex-1 gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* ══ 右侧 Properties 栏（单一面板，分节细线分隔；超高自身内滚）══ */}
        <div className="cockpit-scroll min-h-0 lg:order-2 lg:overflow-y-auto">
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
              <span className="text-sm font-medium text-slate-800">{task.primary_owner}</span>
              <LocalClock name={task.primary_owner} />
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
                      <LocalClock name={c.name} role={c.role} />
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
              onClick={() => downloadUsCollabTaskReport(task, reportLogs, reportNoteOf)}
              className="h-8 w-full gap-1.5 text-xs"
            >
              <Download className="h-3.5 w-3.5" />
              {t("导出过程报告")}
            </Button>
            {/* 审批：待审核任务的通过/驳回（协同侧唯一审批入口——驾驶舱直达本页，抽屉不再打开） */}
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
          </div>
        </div>
        </div>

        {/* ══ 主内容列（左）：纵向过程叙事——Tab 卡吃掉剩余高度，内容内滚 ══ */}
        <div className="flex min-h-0 min-w-0 flex-col gap-4 lg:order-1">
          {/* AI 小结卡：限最大高度，超出内滚 */}
          {brief && (
            <div className="shrink-0 rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="flex items-center gap-1 text-xs font-semibold text-indigo-700">
                  <Sparkles className="h-3.5 w-3.5" />
                  {t("任务小结")}{brief.source === "local" ? t("（AI 未配置，基础事实版）") : ""}
                </span>
                <button type="button" onClick={() => setBrief(null)} className="cursor-pointer rounded p-0.5 text-indigo-300 hover:bg-indigo-100 hover:text-indigo-500">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="cockpit-scroll max-h-52 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{brief.text}</p>
            </div>
          )}

          {/* 任务描述 */}
          {task.description && (
            <div className="shrink-0 material-card px-4 py-3">
              <div className="mb-1.5 text-xs font-semibold text-slate-500">{t("任务描述")}</div>
              <TranslatableText
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

          {/* Tab：操作记录 / 进展留痕 / 附件库 —— 卡片吃掉主列剩余高度，内容区各自内滚 */}
          <div className="material-card flex min-h-0 flex-1 flex-col overflow-hidden p-0 lg:min-h-[280px]">
            <Tabs value={tab} onValueChange={(value) => setTab(value as DetailTab)} className="flex min-h-0 flex-1 flex-col">
              <TabsList className="h-auto w-full shrink-0 justify-start gap-6 rounded-none border-b border-slate-200/80 bg-transparent p-0 px-4">
                {([
                  { key: "audit", label: t("操作记录"), count: timelineLogs.length },
                  { key: "notes", label: t("进展留痕"), count: notes.length },
                  { key: "attachments", label: t("附件库"), count: null },
                ] as const).map((tabItem) => (
                  <TabsTrigger
                    key={tabItem.key}
                    value={tabItem.key}
                    className="-mb-px flex-none cursor-pointer gap-1.5 rounded-none border-0 border-b-2 border-transparent bg-transparent px-1 pb-3 pt-3.5 text-sm font-medium text-slate-500 shadow-none transition-colors hover:text-slate-800 data-[state=active]:border-indigo-600 data-[state=active]:bg-transparent data-[state=active]:font-semibold data-[state=active]:text-slate-900 data-[state=active]:shadow-none"
                  >
                    {tabItem.label}
                    {tabItem.count != null && tabItem.count > 0 && (
                      <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-slate-500">{tabItem.count}</span>
                    )}
                  </TabsTrigger>
                ))}
              </TabsList>

              <TabsContent value="notes" className="cockpit-scroll min-h-0 min-w-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
              <motion.div initial={shouldReduceMotion ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16 }}>
                {workItems.length > 0 && (
                  <div className="mb-3 flex flex-wrap items-center gap-1">
                    {[
                      { key: "all", label: t("全部") },
                      { key: "main", label: t("未关联") },
                      ...workItems.map((it) => ({
                        key: it.id,
                        label: `${it.title}${(noteCountByItem.get(it.id) ?? 0) > 0 ? ` ${noteCountByItem.get(it.id)}` : ""}`,
                      })),
                    ].map((chip) => (
                      <button
                        key={chip.key}
                        type="button"
                        onClick={() => setNoteItemFilter(chip.key)}
                        className={cn(
                          "max-w-[200px] cursor-pointer truncate rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                          noteItemFilter === chip.key
                            ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                            : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50",
                        )}
                        title={chip.label}
                      >
                        {chip.label}
                      </button>
                    ))}
                  </div>
                )}
                <ProgressNoteList
                  notes={filteredNotes}
                  loading={notesLoading}
                  emptyText={noteItemFilter === "all" ? t("暂无进展留痕") : t("该工作项暂无留痕")}
                />
              </motion.div>
              </TabsContent>

              <TabsContent value="attachments" className="cockpit-scroll min-h-0 min-w-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
              <motion.div initial={shouldReduceMotion ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16 }} className="space-y-3">
                <TaskImageGallery notes={notes} />
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
                  showResource={false}
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

            {/* 评论式留痕框：卡底常驻（仅操作记录 Tab、任务参与人/管理员可见），在哪看就在哪写 */}
            {tab === "audit" && canComposeNote && (
              <div className="shrink-0 border-t border-slate-200/80 px-4 py-3">
                <Textarea
                  value={composerText}
                  onChange={(e) => setComposerText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      void submitComposerNote();
                    }
                  }}
                  rows={2}
                  placeholder={t("写一条进展…（Ctrl+Enter 发送）")}
                  className="cockpit-scroll w-full resize-none rounded-lg border-slate-200 text-sm"
                />
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
                      if (t.task_id !== taskId) navigate(`/us-collab-task/${encodeURIComponent(t.task_id)}`);
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
