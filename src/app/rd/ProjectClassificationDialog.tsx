import { type Task, isArchivedTask } from "./taskModel";
import { RD_PANEL_TRANSITION } from "./taskMotion";
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  useMemo,
} from "react";
import { motion } from "motion/react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CopyCheck,
  FileUp,
  GitBranch,
  Layers3,
  Loader2,
  Paperclip,
  FileText,
  Sparkles,
  X,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { cn } from "../components/ui/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";
import { classifyRdProject, attachRdTasksToParent, type RdAiProjectClassificationResult } from "../lib/rdApi";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import { RadioGroupItem } from "../components/ui/radio-group";
import { RadioGroup } from "../components/ui/radio-group";

type ProjectClassificationDialogProps = {
  productId?: string;
  categoryId?: string;
  subProjectId?: string;
  scopeLabel: string;
  tasks: Task[];
  onClose: () => void;
  onOpenTask: (task: Task) => void;
  onMerged: () => void | Promise<void>;
};

type ProjectClassificationMergeDraft = {
  id: string;
  kind: "duplicate" | "homogeneous";
  label: string;
  reason: string;
  confidence?: number;
  taskIds: string[];
  primaryTaskId: string;
  sourceTaskIds: string[];
  enabled: boolean;
};

const PROJECT_CLASSIFICATION_MAX_FILES = 5;

const PROJECT_CLASSIFICATION_MAX_FILE_BYTES = 25 * 1024 * 1024;

const PROJECT_CLASSIFICATION_MAX_TOTAL_BYTES = 50 * 1024 * 1024;

const PROJECT_CLASSIFICATION_FILE_ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.csv,.json,.png,.jpg,.jpeg,.webp";

const PROJECT_CLASSIFICATION_FILE_EXTENSIONS = new Set(
  PROJECT_CLASSIFICATION_FILE_ACCEPT.split(",").map((extension) => extension.slice(1)),
);

function flattenClassificationTasks(tasks: Task[]): Task[] {
  const output: Task[] = [];
  const visit = (items: Task[]) => {
    for (const task of items) {
      if (isArchivedTask(task)) continue;
      output.push(task);
      visit(task.subtasks ?? []);
    }
  };
  visit(tasks);
  return output;
}

export function ProjectClassificationDialog({
  productId,
  categoryId,
  subProjectId,
  scopeLabel,
  tasks,
  onClose,
  onOpenTask,
  onMerged,
}: ProjectClassificationDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const [instruction, setInstruction] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [result, setResult] = useState<RdAiProjectClassificationResult | null>(null);
  const [mergeDrafts, setMergeDrafts] = useState<ProjectClassificationMergeDraft[]>([]);
  const [showMergeConfirm, setShowMergeConfirm] = useState(false);
  const [merging, setMerging] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scopedTasks = useMemo(() => flattenClassificationTasks(tasks), [tasks]);
  const taskById = useMemo(() => new Map(scopedTasks.map((task) => [task.task_id, task])), [scopedTasks]);
  const rootTaskIds = useMemo(() => new Set(tasks.map((task) => task.task_id)), [tasks]);

  const addFiles = useCallback((incoming: File[]) => {
    const accepted: File[] = [];
    const existing = new Set(files.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
    let totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    for (const file of incoming) {
      const key = `${file.name}:${file.size}:${file.lastModified}`;
      if (existing.has(key)) continue;
      if (files.length + accepted.length >= PROJECT_CLASSIFICATION_MAX_FILES) {
        toast.error(`一次最多上传 ${PROJECT_CLASSIFICATION_MAX_FILES} 个附件`);
        break;
      }
      const extension = file.name.includes(".") ? file.name.split(".").pop()?.toLowerCase() ?? "" : "";
      if (!PROJECT_CLASSIFICATION_FILE_EXTENSIONS.has(extension)) {
        toast.error(`${file.name} 的文件类型暂不支持`);
        continue;
      }
      if (file.size > PROJECT_CLASSIFICATION_MAX_FILE_BYTES) {
        toast.error(`${file.name} 超过 25 MB，未加入分析`);
        continue;
      }
      if (totalBytes + file.size > PROJECT_CLASSIFICATION_MAX_TOTAL_BYTES) {
        toast.error("附件总大小不能超过 50 MB");
        continue;
      }
      accepted.push(file);
      existing.add(key);
      totalBytes += file.size;
    }
    if (accepted.length > 0) setFiles((current) => [...current, ...accepted]);
  }, [files]);

  const resetFileDragState = useCallback(() => {
    dragDepthRef.current = 0;
    setIsDraggingFiles(false);
  }, []);

  useEffect(() => {
    window.addEventListener("dragend", resetFileDragState);
    window.addEventListener("drop", resetFileDragState);
    return () => {
      window.removeEventListener("dragend", resetFileDragState);
      window.removeEventListener("drop", resetFileDragState);
    };
  }, [resetFileDragState]);

  const handleFileDragEnter = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current += 1;
    setIsDraggingFiles(true);
  }, []);

  const handleFileDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = analyzing ? "none" : "copy";
  }, [analyzing]);

  const handleFileDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (dragDepthRef.current <= 0) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDraggingFiles(false);
  }, []);

  const handleFileDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    const droppedFiles = Array.from(event.dataTransfer.files);
    if (!Array.from(event.dataTransfer.types).includes("Files") && droppedFiles.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    resetFileDragState();
    if (!analyzing && droppedFiles.length > 0) addFiles(droppedFiles);
  }, [addFiles, analyzing, resetFileDragState]);

  const runAnalysis = async () => {
    setAnalyzing(true);
    setError(null);
    try {
      const next = await classifyRdProject({
        productId,
        categoryId,
        subProjectId,
        instruction,
        files,
      });
      setResult(next);
      const duplicateDrafts = next.duplicate_groups.map((group, index): ProjectClassificationMergeDraft => {
        const primaryTaskId = group.recommended_primary_task_id && group.task_ids.includes(group.recommended_primary_task_id)
          ? group.recommended_primary_task_id
          : group.task_ids[0] ?? "";
        return {
          id: `duplicate-${index}`,
          kind: "duplicate",
          label: group.title,
          reason: group.reason,
          confidence: group.confidence,
          taskIds: group.task_ids,
          primaryTaskId,
          sourceTaskIds: group.task_ids.filter((taskId) => taskId !== primaryTaskId && rootTaskIds.has(taskId)),
          // 高置信组默认勾选：AI 已逐组判定并选好主任务，用户扫一眼点一次「应用」即可。
          // 合并只是父子挂接（内容与留痕完整保留、可批量拆回），误判的代价远低于逐组手动勾选的成本。
          enabled: true,
        };
      });
      const homogeneousDrafts = next.homogeneous_clusters.map((group, index): ProjectClassificationMergeDraft => {
        const primaryTaskId = group.recommended_primary_task_id && group.task_ids.includes(group.recommended_primary_task_id)
          ? group.recommended_primary_task_id
          : group.task_ids[0] ?? "";
        return {
          id: `homogeneous-${index}`,
          kind: "homogeneous",
          label: group.label,
          reason: group.reason,
          taskIds: group.task_ids,
          primaryTaskId,
          sourceTaskIds: group.task_ids.filter((taskId) => taskId !== primaryTaskId && rootTaskIds.has(taskId)),
          enabled: false,
        };
      });
      setMergeDrafts([...duplicateDrafts, ...homogeneousDrafts]);
    } catch (analysisError) {
      setError(analysisError instanceof Error ? analysisError.message : "AI 全量任务归纳失败，请稍后重试");
    } finally {
      setAnalyzing(false);
    }
  };

  const approvedMergeDrafts = useMemo(
    () => mergeDrafts.filter((draft) => draft.enabled && draft.primaryTaskId && draft.sourceTaskIds.length > 0),
    [mergeDrafts],
  );
  const approvedMergeTaskCount = useMemo(
    () => approvedMergeDrafts.reduce((sum, draft) => sum + draft.sourceTaskIds.length, 0),
    [approvedMergeDrafts],
  );
  const memberTaskLinesByOwner = useMemo(() => {
    const grouped = new Map<string, RdAiProjectClassificationResult["member_task_lines"]>();
    for (const line of result?.member_task_lines ?? []) {
      const owner = line.primary_owner || "待指派";
      grouped.set(owner, [...(grouped.get(owner) ?? []), line]);
    }
    return [...grouped.entries()];
  }, [result]);

  const updateMergeDraft = useCallback((draftId: string, update: (draft: ProjectClassificationMergeDraft) => ProjectClassificationMergeDraft) => {
    setMergeDrafts((current) => current.map((draft) => (draft.id === draftId ? update(draft) : draft)));
  }, []);

  const chooseMergePrimary = useCallback((draftId: string, primaryTaskId: string) => {
    updateMergeDraft(draftId, (draft) => {
      if (!draft.taskIds.includes(primaryTaskId)) return draft;
      const nextSources = new Set(draft.sourceTaskIds);
      nextSources.delete(primaryTaskId);
      if (draft.primaryTaskId && rootTaskIds.has(draft.primaryTaskId)) nextSources.add(draft.primaryTaskId);
      return { ...draft, primaryTaskId, sourceTaskIds: [...nextSources] };
    });
  }, [rootTaskIds, updateMergeDraft]);

  const toggleMergeSource = useCallback((draftId: string, taskId: string) => {
    if (!rootTaskIds.has(taskId)) return;
    updateMergeDraft(draftId, (draft) => {
      if (draft.primaryTaskId === taskId) return draft;
      const nextSources = new Set(draft.sourceTaskIds);
      if (nextSources.has(taskId)) nextSources.delete(taskId);
      else nextSources.add(taskId);
      return { ...draft, sourceTaskIds: [...nextSources] };
    });
  }, [rootTaskIds, updateMergeDraft]);

  const requestMergeConfirmation = useCallback(() => {
    if (approvedMergeDrafts.length === 0) {
      toast.error("请先勾选至少一组，并选择要并入的任务");
      return;
    }
    const usedTaskIds = new Set<string>();
    for (const draft of approvedMergeDrafts) {
      for (const taskId of [draft.primaryTaskId, ...draft.sourceTaskIds]) {
        if (usedTaskIds.has(taskId)) {
          toast.error("同一任务不能同时出现在多个待合并组，请先调整分析结果");
          return;
        }
        usedTaskIds.add(taskId);
      }
    }
    setShowMergeConfirm(true);
  }, [approvedMergeDrafts]);

  const executeApprovedMerges = useCallback(async () => {
    if (merging || approvedMergeDrafts.length === 0) return;
    setMerging(true);
    setError(null);
    let completedGroups = 0;
    try {
      for (const draft of approvedMergeDrafts) {
        await attachRdTasksToParent(draft.sourceTaskIds, draft.primaryTaskId);
        const primaryTask = taskById.get(draft.primaryTaskId);
        for (const sourceTaskId of draft.sourceTaskIds) {
          const sourceTask = taskById.get(sourceTaskId);
        }
        completedGroups += 1;
      }
      await onMerged();
      toast.success(`已确认 ${completedGroups} 组主任务线，并入 ${approvedMergeTaskCount} 条任务`);
      setShowMergeConfirm(false);
      onClose();
    } catch (mergeError) {
      if (completedGroups > 0) await onMerged();
      setShowMergeConfirm(false);
      setResult(null);
      setMergeDrafts([]);
      setError(
        `${completedGroups > 0 ? `已完成 ${completedGroups} 组；` : ""}${mergeError instanceof Error ? mergeError.message : "任务合并失败，请重新分析后重试"}`,
      );
    } finally {
      setMerging(false);
    }
  }, [approvedMergeDrafts, approvedMergeTaskCount, merging, onClose, onMerged, taskById]);

  const renderTaskLinks = (taskIds: string[], primaryTaskId?: string | null) => (
    <div className="mt-3 flex max-h-32 flex-wrap gap-2 overflow-y-auto pr-1">
      {taskIds.map((taskId) => {
        const task = taskById.get(taskId);
        if (!task) return null;
        return (
          <Button variant="unstyled"
            key={taskId}
            type="button"
            onClick={() => onOpenTask(task)}
            className={cn(
              "group inline-flex max-w-full items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-left text-xs font-medium transition-colors",
              primaryTaskId === taskId
                ? "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100"
                : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50",
            )}
          >
            <span className="max-w-[260px] truncate">{task.title}</span>
            {primaryTaskId === taskId && <span className="shrink-0 text-[10px] text-amber-700">建议保留</span>}
            <ArrowRight className="h-3 w-3 shrink-0 opacity-50 transition-transform group-hover:translate-x-0.5" />
          </Button>
        );
      })}
    </div>
  );

  const renderMergeDraftEditor = (draft: ProjectClassificationMergeDraft, advice: string) => (
    <article
      key={draft.id}
      className={cn(
        "rounded-xl border p-4 transition-colors",
        draft.enabled
          ? draft.kind === "duplicate" ? "border-amber-300 bg-amber-50/60" : "border-blue-300 bg-blue-50/60"
          : "border-slate-200 bg-slate-50/50",
      )}
    >
      <div className="flex items-start gap-3">
        <Checkbox
          checked={draft.enabled}
          disabled={draft.sourceTaskIds.length === 0}
          onCheckedChange={(checkedValue) => updateMergeDraft(draft.id, (current) => ({ ...current, enabled: (checkedValue === true) }))}
          className="mt-1 h-4 w-4 shrink-0 accent-slate-950"
          aria-label={`纳入合并：${draft.label}`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <Input
              value={draft.label}
              onChange={(event) => updateMergeDraft(draft.id, (current) => ({ ...current, label: event.target.value.slice(0, 120) }))}
              className="h-8 min-w-0 border-transparent bg-transparent px-1 text-sm font-semibold text-slate-900 shadow-none hover:border-slate-200 focus-visible:border-slate-300 focus-visible:bg-white focus-visible:ring-0"
              aria-label="调整任务组名称"
            />
            {draft.confidence !== undefined && (
              <span className="mt-1 shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                {Math.round(draft.confidence * 100)}%
              </span>
            )}
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-600">{draft.reason}</p>
        </div>
      </div>

      <RadioGroup name={`classification-primary-${draft.id}`} value={draft.primaryTaskId} onValueChange={(taskId) => chooseMergePrimary(draft.id, taskId)} aria-label="保留主任务" className="mt-3 gap-0 overflow-hidden rounded-lg border border-slate-200 bg-white">
        {draft.taskIds.map((taskId) => {
          const task = taskById.get(taskId);
          if (!task) return null;
          const isPrimary = draft.primaryTaskId === taskId;
          const canAttach = rootTaskIds.has(taskId);
          const selectedAsSource = draft.sourceTaskIds.includes(taskId);
          return (
            <div key={taskId} className="flex items-center gap-2 border-b border-slate-100 px-3 py-2.5 last:border-b-0">
              <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[11px] font-medium text-slate-600">
                <RadioGroupItem value={taskId}
                  className="h-3.5 w-3.5 accent-slate-950"
                />
                保留
              </label>
              {!isPrimary && (
                <label
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 text-[11px] font-medium",
                    canAttach ? "cursor-pointer text-slate-600" : "cursor-not-allowed text-muted-foreground",
                  )}
                  title={canAttach ? "确认后作为完整子任务并入" : "已有父任务，只能保留为目标，不能再次并入"}
                >
                  <Checkbox
                    checked={selectedAsSource}
                    disabled={!canAttach}
                    onCheckedChange={() => toggleMergeSource(draft.id, taskId)}
                    className="h-3.5 w-3.5 accent-slate-950"
                  />
                  并入
                </label>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-slate-800">{task.title}</p>
                <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                  {task.primary_owner || "待指派"}{task.category_path ? ` · ${task.category_path}` : ""}
                </p>
              </div>
              {!canAttach && !isPrimary && (
                <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-muted-foreground">已有上级</span>
              )}
              <Button variant="unstyled"
                type="button"
                onClick={() => onOpenTask(task)}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-slate-100 hover:text-slate-700"
                aria-label={`查看任务 ${task.title}`}
              >
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          );
        })}
      </RadioGroup>
      <div className="mt-3 flex items-start justify-between gap-3 border-t border-slate-200/80 pt-3 text-xs leading-5">
        <p className={draft.kind === "duplicate" ? "text-amber-900" : "text-blue-900"}>
          <span className="font-semibold">建议：</span>{advice}
        </p>
        <span className="shrink-0 text-muted-foreground">已选 {draft.sourceTaskIds.length} 条</span>
      </div>
    </article>
  );

  return (
    <motion.div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-sm sm:p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="project-classification-title"
    >
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.99 }}
        transition={RD_PANEL_TRANSITION}
        className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-[#f7f8fa] shadow-[0_30px_90px_rgba(15,23,42,0.35)]"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4 sm:px-7">
          <div className="flex min-w-0 items-start gap-3.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-amber-300 shadow-sm">
              <Layers3 className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="project-classification-title" className="text-lg font-semibold tracking-tight text-slate-950">
                  AI 全量任务归纳
                </h2>
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                  人工确认后执行
                </span>
              </div>
              <p className="mt-1 truncate text-sm text-slate-500">
                {scopeLabel} · {scopedTasks.length} 条未归档任务
              </p>
            </div>
          </div>
          <Button variant="unstyled"
            type="button"
            onClick={onClose}
            disabled={analyzing || merging}
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="关闭全量任务归纳"
          >
            <X className="h-5 w-5" />
          </Button>
        </header>

        {!result ? (
          <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[0.78fr_1.22fr]">
            <aside className="border-b border-slate-200 bg-slate-950 px-6 py-7 text-white lg:border-b-0 lg:border-r lg:px-7">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-300">Analysis brief</p>
              <h3 className="mt-3 max-w-sm text-2xl font-semibold leading-tight tracking-tight">
                先把任务看成一个组合，再判断哪些应该合并。
              </h3>
              <p className="mt-4 max-w-md text-sm leading-6 text-slate-300">
                系统会结合任务标题、描述、主责人、进度和父子层级，识别真正重复与“相似但应并行”的任务。
              </p>
              <div className="mt-7 space-y-3">
                {[
                  [CopyCheck, "疑似重复", "给出置信度、保留建议和人工复核动作"],
                  [Layers3, "同质聚类", "把目标相近的任务集中呈现，避免重复投入"],
                  [ShieldCheck, "确认前不改数据", "可调整保留任务与并入项，只有二次确认后才执行"],
                ].map(([Icon, title, description]) => {
                  const ItemIcon = Icon as React.ComponentType<{ className?: string }>;
                  return (
                    <div key={String(title)} className="flex gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-3.5">
                      <ItemIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                      <div>
                        <p className="text-sm font-medium text-white">{String(title)}</p>
                        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{String(description)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </aside>

            <main className="flex flex-col p-5 sm:p-7">
              <label htmlFor="project-classification-instruction" className="text-sm font-semibold text-slate-900">
                本次分析重点 <span className="font-normal text-muted-foreground">（选填）</span>
              </label>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                可补充产品阶段、交付边界或你特别担心的重复方向；留空则执行完整检查。
              </p>
              <Textarea
                id="project-classification-instruction"
                value={instruction}
                onChange={(event) => setInstruction(event.target.value.slice(0, 8000))}
                placeholder="例如：重点检查测试验证类任务是否重复；同一物料的打样、验证和问题关闭应视为一个交付链路，不要误判为重复。"
                className="mt-3 min-h-[150px] resize-y rounded-xl border-slate-200 bg-white px-4 py-3 text-sm leading-6 shadow-sm focus-visible:ring-slate-400"
              />
              <div className="mt-2 text-right text-[11px] text-muted-foreground">{instruction.length} / 8000</div>

              <div className="mt-5 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">补充附件 <span className="font-normal text-muted-foreground">（选填）</span></p>
                  <p className="mt-1 text-xs text-slate-500">最多 5 个，每个不超过 25 MB</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={analyzing || files.length >= PROJECT_CLASSIFICATION_MAX_FILES}
                  className="h-9 rounded-lg border-slate-300 bg-white text-slate-700"
                >
                  <Paperclip className="mr-1.5 h-4 w-4" />
                  选择附件
                </Button>
                <Input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  disabled={analyzing}
                  className="hidden"
                  accept={PROJECT_CLASSIFICATION_FILE_ACCEPT}
                  onChange={(event) => {
                    addFiles(Array.from(event.target.files ?? []));
                    event.target.value = "";
                  }}
                />
              </div>

              <div
                onDragEnter={handleFileDragEnter}
                onDragOver={handleFileDragOver}
                onDragLeave={handleFileDragLeave}
                onDrop={handleFileDrop}
                data-drag-active={isDraggingFiles ? "true" : "false"}
                aria-label="附件拖拽上传区域"
                aria-live="polite"
                className={cn(
                  "relative mt-3 min-h-[76px] rounded-xl border border-dashed p-3 transition-[border-color,background-color,box-shadow] duration-150",
                  isDraggingFiles
                    ? "border-amber-400 bg-amber-50 shadow-[0_0_0_4px_rgba(251,191,36,0.13)]"
                    : "border-slate-300 bg-white/70",
                )}
              >
                {isDraggingFiles && (
                  <div className="pointer-events-none absolute inset-1 z-10 flex items-center justify-center gap-2 rounded-lg bg-amber-50/95 text-sm font-semibold text-amber-800 backdrop-blur-[1px]">
                    <FileUp className="h-4 w-4 animate-bounce" />
                    松开即可添加附件
                  </div>
                )}
                <div className={cn("transition-opacity", isDraggingFiles && "opacity-20")}>
                  {files.length === 0 ? (
                    <Button variant="unstyled"
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={analyzing}
                      className="flex h-12 w-full items-center justify-center gap-2 rounded-lg text-sm text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700"
                    >
                      <FileUp className="h-4 w-4" />
                      拖拽附件到此处，或点击选择
                    </Button>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {files.map((file) => (
                        <div key={`${file.name}-${file.lastModified}`} className="flex min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
                          <FileText className="h-4 w-4 shrink-0 text-slate-500" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-medium text-slate-800">{file.name}</p>
                            <p className="text-[10px] text-muted-foreground">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
                          </div>
                          <Button variant="unstyled"
                            type="button"
                            onClick={() => setFiles((current) => current.filter((item) => item !== file))}
                            className="rounded p-1 text-muted-foreground hover:bg-slate-100 hover:text-slate-700"
                            aria-label={`移除 ${file.name}`}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {error && (
                <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div className="mt-auto flex flex-col-reverse gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
                <p className="max-w-md text-xs leading-5 text-slate-500">
                  AI 只生成分析草稿，不会自动改任务；结果页可人工调整并在二次确认后执行合并。
                </p>
                <Button
                  type="button"
                  onClick={runAnalysis}
                  disabled={analyzing}
                  className="h-10 shrink-0 rounded-lg bg-slate-950 px-5 text-white shadow-sm hover:bg-slate-800"
                >
                  {analyzing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4 text-amber-300" />}
                  {analyzing ? "正在分批分析线上任务…" : "生成全量归纳分析"}
                </Button>
              </div>
            </main>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-medium text-slate-500">已分析任务</p>
                <p className="mt-1 text-2xl font-semibold text-slate-950">{result.scope.analyzed_task_count}</p>
              </div>
              <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 shadow-sm">
                <p className="text-xs font-medium text-amber-700">疑似重复组</p>
                <p className="mt-1 text-2xl font-semibold text-amber-950">{result.duplicate_groups.length}</p>
              </div>
              <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-4 shadow-sm">
                <p className="text-xs font-medium text-blue-700">同质任务组</p>
                <p className="mt-1 text-2xl font-semibold text-blue-950">{result.homogeneous_clusters.length}</p>
              </div>
            </div>

            <section className="mt-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                全量任务概览
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{result.summary}</p>
              <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-slate-500">
                <span className="rounded-full bg-slate-100 px-2.5 py-1">{result.provider === "local" ? "本地初筛" : "AI 语义分析"}</span>
                {result.scope.attachment_count > 0 && <span className="rounded-full bg-slate-100 px-2.5 py-1">参考 {result.scope.attachment_count} 个附件</span>}
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700">确认前不修改任务</span>
              </div>
            </section>

            {result.warnings.length > 0 && (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">
                {result.warnings.map((warning) => <p key={warning}>• {warning}</p>)}
              </div>
            )}

            <section className="mt-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                    <GitBranch className="h-4 w-4 text-indigo-600" />成员主任务线
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">按主责人整理根任务，已存在的子任务不会被重复计算。</p>
                </div>
                <span className="text-xs text-muted-foreground">{result.member_task_lines.length} 条主任务线</span>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {memberTaskLinesByOwner.map(([owner, lines]) => (
                  <article key={owner} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
                    <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-2.5">
                      <span className="truncate text-sm font-semibold text-slate-900">{owner}</span>
                      <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[10px] text-slate-500 ring-1 ring-slate-200">{lines.length} 条</span>
                    </div>
                    <div className="mt-3 space-y-3">
                      {lines.map((line, index) => (
                        <div key={`${line.line_title}-${index}`}>
                          <p className="text-xs font-semibold text-slate-800">{line.line_title}</p>
                          {line.rationale && <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-500">{line.rationale}</p>}
                          {renderTaskLinks(line.task_ids, line.recommended_primary_task_id)}
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
                {memberTaskLinesByOwner.length === 0 && (
                  <p className="text-sm text-slate-500">本次没有生成成员主任务线。</p>
                )}
              </div>
            </section>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-950"><CopyCheck className="h-4 w-4 text-amber-600" />疑似重复</h3>
                  <span className="text-xs text-muted-foreground">{result.duplicate_groups.length} 组</span>
                </div>
                <div className="mt-4 space-y-3">
                  {result.duplicate_groups.length === 0 ? (
                    <p className="rounded-lg bg-slate-50 px-3 py-4 text-sm text-slate-500">未发现需要优先复核的重复任务。</p>
                  ) : result.duplicate_groups.map((group, index) => {
                    const draft = mergeDrafts.find((item) => item.id === `duplicate-${index}`);
                    return draft ? renderMergeDraftEditor(draft, group.action) : null;
                  })}
                </div>
              </section>

              <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-950"><Layers3 className="h-4 w-4 text-blue-600" />同质任务聚类</h3>
                  <span className="text-xs text-muted-foreground">{result.homogeneous_clusters.length} 组</span>
                </div>
                <div className="mt-4 space-y-3">
                  {result.homogeneous_clusters.length === 0 ? (
                    <p className="rounded-lg bg-slate-50 px-3 py-4 text-sm text-slate-500">未发现明显的同质任务集中现象。</p>
                  ) : result.homogeneous_clusters.map((cluster, index) => {
                    const draft = mergeDrafts.find((item) => item.id === `homogeneous-${index}`);
                    return draft ? renderMergeDraftEditor(draft, cluster.consolidation_advice) : null;
                  })}
                </div>
              </section>
            </div>

            <section className="mt-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-950">建议分类</h3>
              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {result.categories.map((category, index) => (
                  <article key={`${category.label}-${index}`} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="text-sm font-semibold text-slate-900">{category.label}</h4>
                      <span className="text-[11px] text-muted-foreground">{category.task_ids.length} 条</span>
                    </div>
                    <p className="mt-1.5 text-xs leading-5 text-slate-500">{category.rationale}</p>
                    {renderTaskLinks(category.task_ids)}
                  </article>
                ))}
                {result.categories.length === 0 && <p className="text-sm text-slate-500">本次没有生成新的分类建议。</p>}
              </div>
            </section>

            {result.recommendations.length > 0 && (
              <section className="mt-4 rounded-xl border border-slate-800 bg-slate-950 p-5 text-white shadow-sm">
                <h3 className="text-sm font-semibold text-white">下一步治理建议</h3>
                <ol className="mt-3 space-y-2">
                  {result.recommendations.map((recommendation, index) => (
                    <li key={`${recommendation}-${index}`} className="flex gap-3 text-sm leading-6 text-slate-300">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-amber-300/40 bg-amber-300/10 text-[10px] font-semibold text-amber-300">{index + 1}</span>
                      {recommendation}
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </div>
        )}

        {result && (
          <footer className="flex flex-col-reverse gap-3 border-t border-slate-200 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
            <div>
              <p className="text-xs text-slate-500">结果生成于 {new Date(result.generated_at).toLocaleString("zh-CN")}，合并后源任务将作为完整子任务保留。</p>
              {approvedMergeTaskCount > 0 && (
                <p className="mt-1 text-xs font-medium text-slate-800">已选择 {approvedMergeDrafts.length} 组，共 {approvedMergeTaskCount} 条任务待并入</p>
              )}
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={merging}
                onClick={() => {
                  setResult(null);
                  setMergeDrafts([]);
                }}
                className="rounded-lg border-slate-300"
              >
                调整条件并重算
              </Button>
              <Button type="button" variant="outline" disabled={merging} onClick={onClose} className="rounded-lg border-slate-300">关闭</Button>
              <Button
                type="button"
                disabled={merging || approvedMergeTaskCount === 0}
                onClick={requestMergeConfirmation}
                className="rounded-lg bg-slate-950 text-white hover:bg-slate-800"
              >
                <GitBranch className="mr-1.5 h-4 w-4 text-amber-300" />
                确认合并 {approvedMergeTaskCount > 0 ? `${approvedMergeTaskCount} 条` : ""}
              </Button>
            </div>
          </footer>
        )}
      </motion.div>

      <AlertDialog open={showMergeConfirm} onOpenChange={(open) => { if (!merging) setShowMergeConfirm(open); }}>
        <AlertDialogContent overlayClassName="z-[90]" className="z-[91] sm:max-w-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>确认整理为主任务线？</AlertDialogTitle>
            <AlertDialogDescription className="space-y-3 text-left">
              <span className="block">
                将执行 {approvedMergeDrafts.length} 组合并，把 {approvedMergeTaskCount} 条独立任务挂到选定主任务下。任务标题、描述、主责人、日期、评分、审批状态、进展留痕、讨论、附件和操作记录均保留。
              </span>
              <span className="block rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
                {approvedMergeDrafts.slice(0, 5).map((draft) => {
                  const primary = taskById.get(draft.primaryTaskId);
                  return `${draft.label}：${draft.sourceTaskIds.length} 条 → ${primary?.title ?? draft.primaryTaskId}`;
                }).join("\n")}
                {approvedMergeDrafts.length > 5 ? `\n另有 ${approvedMergeDrafts.length - 5} 组` : ""}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={merging}>返回调整</AlertDialogCancel>
            <AlertDialogAction
              disabled={merging}
              onClick={(event) => {
                event.preventDefault();
                void executeApprovedMerges();
              }}
              className="bg-slate-950 text-white hover:bg-slate-800"
            >
              {merging ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              {merging ? "正在合并…" : "确认并执行"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}
