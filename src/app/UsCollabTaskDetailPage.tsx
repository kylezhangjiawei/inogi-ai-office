import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  Download,
  FileText,
  Loader2,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "./components/ui/utils";
import { useAnyPermission } from "./hooks/usePermission";
import { useAuth } from "./auth";
import { PERMISSIONS } from "./lib/permissions";
import { AuditTimeline } from "./RDAuditTimeline";
import { addAuditLogNote, recordAudit, useAuditActor, type AuditLog, useAuditLogs } from "./lib/auditLog";
import { ProgressNoteList, TaskImageGallery, formatRdFileSize } from "./RDProgressEvidence";
import {
  STATUS_CONFIG,
  PRIORITY_CONFIG,
  WorkItemsSection,
  HandoverDialog,
  AddCollaboratorsDialog,
  CompleteConfirmDialog,
  downloadUsCollabTaskReport,
  flattenTasks,
  OwnerAvatar,
  type PersonProfile,
} from "./RDTaskManagementPage";
import {
  blockedDaysOf,
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

/**
 * 中美协同 · 任务全屏详情页（双栏布局，Velzon 任务详情式）：
 * 左栏为任务档案（字段表 / 人员 / 快捷操作），右主栏为纵向过程叙事
 * （AI 小结 → 描述 → 工作项 → 留痕/附件库/操作记录 Tab）。
 * 仅协同模块入口可达（驾驶舱详情抽屉「全屏查看」），不影响其他驾驶舱。
 */
export default function UsCollabTaskDetailPage() {
  const { taskId = "" } = useParams();
  const navigate = useNavigate();
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
  const [tab, setTab] = useState<DetailTab>("notes");
  const [noteItemFilter, setNoteItemFilter] = useState<string>("all");
  const [brief, setBrief] = useState<RdTaskBrief | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [people, setPeople] = useState<PersonProfile[]>([]);
  const [showHandover, setShowHandover] = useState(false);
  const [showAddCollab, setShowAddCollab] = useState(false);
  const [showComplete, setShowComplete] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [savingPriority, setSavingPriority] = useState(false);
  /** 点击人员后展示其名下任务的弹层（点任务跳转到该任务的详情页） */
  const [personTasksFor, setPersonTasksFor] = useState<string | null>(null);
  const auditLogs = useAuditLogs({ resourceType: "task", resourceId: taskId });

  const loadTask = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const categories = await fetchMergedTaskCategories();
      const all = flattenTasks(categories.flatMap((c) => c.children.flatMap((s) => s.tasks)));
      setAllTasks(all);
      const found = all.find((t) => t.task_id === taskId) ?? null;
      if (!found) setLoadError("任务不存在或已被删除");
      setTask(found);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "任务加载失败");
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    void loadTask();
  }, [loadTask]);

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
    if (noteItemFilter === "main") return notes.filter((n) => !n.work_item_id);
    return notes.filter((n) => n.work_item_id === noteItemFilter);
  }, [notes, noteItemFilter]);

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
        changes: [{ field: "priority", before: PRIORITY_CONFIG[prev].label, after: PRIORITY_CONFIG[next].label }],
        comment: "更新任务优先级",
        source: "web",
      });
      setTask((prevTask) => (prevTask ? { ...prevTask, final_priority: next } : prevTask));
      toast.success("优先级已更新");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "更新优先级失败");
    } finally {
      setSavingPriority(false);
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
      toast.success(`任务已移交给 ${newOwner}`);
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
      await updateRdTask(task.task_id, {
        collaborators: [...(task.collaborators ?? []), ...newCollaborators],
        _actor_name: user?.name || "管理员",
      } as Partial<Omit<RdTask, "task_id">> & { _actor_name?: string });
      recordAudit({
        actor: AUDIT_ACTOR,
        action: "task.updated",
        resource: { type: "task", id: task.task_id, name: task.title },
        comment: `管理员直接添加协作人：${newCollaborators.map((c) => c.name).join("、")}`,
        source: "web",
      });
      toast.success(`已添加 ${newCollaborators.length} 位协作人`);
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
      toast.success("任务已标记完成");
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
        正在加载任务…
      </div>
    );
  }

  if (!task) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-slate-500">
        <AlertTriangle className="h-8 w-8 text-amber-400" />
        <p className="text-sm">{loadError || "任务不存在"}</p>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="cursor-pointer rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
        >
          返回
        </button>
      </div>
    );
  }

  const sCfg = STATUS_CONFIG[task.status] ?? STATUS_CONFIG.in_progress;
  const pCfg = PRIORITY_CONFIG[task.final_priority] ?? PRIORITY_CONFIG.medium;
  const blockedDays = blockedDaysOf(task);
  const workItems = task.work_items ?? [];

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 px-4 py-4">
      {/* ── 顶部：返回 + 标题 + 徽章 ── */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex cursor-pointer items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          返回
        </button>
        <span className="font-mono text-xs text-slate-400">{task.task_id}</span>
        <h1 className="min-w-0 flex-1 truncate text-xl font-bold text-slate-900">{task.title}</h1>
        <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", sCfg.bg, sCfg.text)}>
          <span className={cn("h-1.5 w-1.5 rounded-full", sCfg.dot)} />
          {sCfg.label}
        </span>
        {canManage && !task.archived && task.status !== "completed" ? (
          <select
            value={task.final_priority}
            disabled={savingPriority}
            onChange={(e) => void savePriority(e.target.value as RdPriority)}
            className={cn("cursor-pointer rounded-full border px-2.5 py-1 text-xs font-semibold outline-none", pCfg.bg, pCfg.text)}
            title="调整任务优先级"
          >
            <option value="high">高优先</option>
            <option value="medium">中优先</option>
            <option value="low">低优先</option>
          </select>
        ) : (
          <span className={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold", pCfg.bg, pCfg.text)}>
            {pCfg.label}优先
          </span>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        {/* ══ 左栏：任务档案 ══ */}
        <div className="space-y-3">
          {/* 字段表 */}
          <div className="material-card space-y-0 divide-y divide-slate-100 px-4 py-1">
            {[
              { label: "完成进度", value: (
                <span className="flex items-center gap-2">
                  <span className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
                    <span className="block h-full rounded-full bg-indigo-500" style={{ width: `${task.progress}%` }} />
                  </span>
                  <span className="tabular-nums">{task.progress}%</span>
                </span>
              ) },
              { label: "开始日期", value: task.start_date || "—" },
              { label: "截止日期", value: (
                <span className="flex items-center gap-1">
                  <CalendarClock className="h-3.5 w-3.5 text-amber-500" />
                  {task.due_date || "—"}
                </span>
              ) },
              { label: "分类路径", value: task.category_path || "—" },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="shrink-0 text-xs text-slate-400">{row.label}</span>
                <span className="min-w-0 truncate text-right font-medium text-slate-700">{row.value}</span>
              </div>
            ))}
          </div>

          {/* 阻塞提示 */}
          {task.status === "paused_blocked" && (
            <div className="flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
              <div className="text-sm text-red-700">
                <span className="font-semibold">任务阻塞中{blockedDays != null ? `，已阻塞 ${blockedDays} 天` : ""}</span>
                {blockedDays != null && blockedDays >= 3 && <div className="mt-0.5 text-xs">建议尽快协调对方团队解除依赖。</div>}
              </div>
            </div>
          )}

          {/* 人员（点击查看其名下任务，可跳转到对应任务详情） */}
          <div className="material-card px-4 py-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500">主责人</span>
              {canManage && !task.archived && (
                <button
                  type="button"
                  onClick={() => setShowAddCollab(true)}
                  className="cursor-pointer rounded px-1.5 py-0.5 text-[11px] font-semibold text-indigo-600 hover:bg-indigo-50"
                >
                  + 添加协作人
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
            </button>
            {(task.collaborators ?? []).length > 0 && (
              <>
                <div className="mb-2 mt-3 text-xs font-semibold text-slate-500">协作人</div>
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
                      <span className="text-[11px] text-slate-400">{c.role}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* 快捷操作 */}
          <div className="material-card space-y-2 px-4 py-3">
            <button
              type="button"
              onClick={() => void handleGenerateBrief()}
              disabled={briefLoading}
              className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {briefLoading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              AI 任务小结
            </button>
            <button
              type="button"
              onClick={() => downloadUsCollabTaskReport(task, reportLogs, reportNoteOf)}
              className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Download className="h-3.5 w-3.5" />
              导出过程报告
            </button>
            {canManage && !task.archived && task.status !== "completed" && (
              <>
                <button
                  type="button"
                  onClick={() => setShowHandover(true)}
                  className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <ArrowLeft className="h-3.5 w-3.5 rotate-180" />
                  移交任务
                </button>
                <button
                  type="button"
                  onClick={() => setShowComplete(true)}
                  className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  标记完成
                </button>
              </>
            )}
          </div>
        </div>

        {/* ══ 右主栏：纵向过程叙事 ══ */}
        <div className="min-w-0 space-y-3">
          {/* AI 小结卡 */}
          {brief && (
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="flex items-center gap-1 text-xs font-semibold text-indigo-700">
                  <Sparkles className="h-3.5 w-3.5" />
                  任务小结{brief.source === "local" ? "（AI 未配置，基础事实版）" : ""}
                </span>
                <button type="button" onClick={() => setBrief(null)} className="cursor-pointer rounded p-0.5 text-indigo-300 hover:bg-indigo-100 hover:text-indigo-500">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{brief.text}</p>
            </div>
          )}

          {/* 任务描述 */}
          {task.description && (
            <div className="material-card px-4 py-3">
              <div className="mb-1.5 text-xs font-semibold text-slate-500">任务描述</div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{task.description}</p>
            </div>
          )}

          {/* 工作项（只读展示）：创建/勾选/删除入口在协同工作台，成员按需自建 */}
          <WorkItemsSection
            task={task}
            canEdit={false}
            noteCountByItem={noteCountByItem}
            onTaskPatched={(_, patch) => setTask((prev) => (prev ? { ...prev, ...patch } : prev))}
          />

          {/* Tab：留痕 / 附件库 / 操作记录 */}
          <div className="material-card px-4 py-3">
            <div className="mb-3 flex items-center gap-1 border-b border-slate-100 pb-2">
              {([
                { key: "notes", label: `进展留痕 ${notes.length}` },
                { key: "attachments", label: "附件库" },
                { key: "audit", label: `操作记录 ${auditLogs.length}` },
              ] as const).map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={cn(
                    "cursor-pointer rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                    tab === t.key ? "bg-indigo-50 text-indigo-700" : "text-slate-500 hover:bg-slate-50 hover:text-slate-700",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {tab === "notes" && (
              <div>
                {workItems.length > 0 && (
                  <div className="mb-3 flex flex-wrap items-center gap-1">
                    {[
                      { key: "all", label: "全部" },
                      { key: "main", label: "未关联" },
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
                  emptyText={noteItemFilter === "all" ? "暂无进展留痕" : "该工作项暂无留痕"}
                />
              </div>
            )}

            {tab === "attachments" && (
              <div className="space-y-3">
                <TaskImageGallery notes={notes} />
                <div>
                  <div className="mb-2 text-xs font-semibold text-slate-500">文档附件（{docAttachments.length}）</div>
                  {docAttachments.length === 0 ? (
                    <p className="py-4 text-center text-sm text-slate-400">暂无文档附件</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                            <th className="py-2 pr-3 font-medium">文件名</th>
                            <th className="px-3 py-2 font-medium">大小</th>
                            <th className="px-3 py-2 font-medium">上传时间</th>
                            <th className="px-3 py-2 font-medium">上传人</th>
                            <th className="px-3 py-2 font-medium">操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {docAttachments.map(({ att, createdAt, actor }) => (
                            <tr key={att.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                              <td className="max-w-[320px] py-2 pr-3">
                                <span className="flex items-center gap-1.5">
                                  <FileText className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                                  <span className="min-w-0 truncate text-slate-700">{att.name}</span>
                                </span>
                              </td>
                              <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">{formatRdFileSize(att.size)}</td>
                              <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">{(createdAt ?? "").slice(0, 10)}</td>
                              <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">{actor || "—"}</td>
                              <td className="whitespace-nowrap px-3 py-2">
                                <a
                                  href={getAttachmentUrl(att)}
                                  download={att.name}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700"
                                >
                                  <Download className="h-3 w-3" />
                                  下载
                                </a>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {tab === "audit" && (
              <div className="max-h-[560px] overflow-y-auto rounded-lg border border-slate-100 bg-slate-50/40 px-2 py-2">
                <AuditTimeline
                  logs={auditLogs}
                  showResource={false}
                  emptyText="暂无操作记录"
                  canAddNote={canManage}
                  onAddNote={async (logId, text) => {
                    await addAuditLogNote(logId, { text, actor: AUDIT_ACTOR });
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── 管理弹窗 ── */}
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

      {/* 人员名下任务弹层：点任务跳转到该任务的详情页 */}
      {personTasksFor && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
          <button type="button" className="absolute inset-0 cursor-default" onClick={() => setPersonTasksFor(null)} aria-label="关闭" />
          <div className="relative w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <OwnerAvatar name={personTasksFor} size="sm" />
                <div>
                  <div className="text-sm font-semibold text-slate-800">{personTasksFor}</div>
                  <div className="text-[11px] text-slate-400">名下活跃任务 {tasksOfPerson.length} 条</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPersonTasksFor(null)}
                className="cursor-pointer rounded-lg p-1.5 hover:bg-slate-100"
              >
                <X className="h-4 w-4 text-slate-500" />
              </button>
            </div>
            <div className="max-h-[50vh] space-y-1.5 overflow-y-auto">
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
          </div>
        </div>
      )}
    </div>
  );
}
