import React, { useState, useMemo } from "react";
import { ArrowRight, Check, CheckCircle2, Loader2, UserPlus, RotateCcw, Send } from "lucide-react";
import { toast } from "sonner";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { cn } from "../components/ui/utils";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../components/ui/dialog";
import { type RdCollaborator } from "../lib/rdApi";
import { t } from "../lib/i18n";
import { Button } from "../components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { type PersonProfile, type Task } from './taskModel';
import { OwnerAvatar } from './TaskIdentity';

// ─── SubmitConfirmDialog ──────────────────────────────────────────────────────
function TaskActionDialogFrame({
  busy,
  onCancel,
  children,
  className,
}: {
  busy: boolean;
  onCancel: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onCancel(); }}>
      <DialogContent
        onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }}
        onPointerDownOutside={(event) => { if (busy) event.preventDefault(); }}
        className={cn("rd-task-overlay-surface gap-0 overflow-hidden p-0 sm:max-w-md", className)}
      >
        {children}
      </DialogContent>
    </Dialog>
  );
}

export function SubmitConfirmDialog({
  taskTitle,
  onConfirm,
  onCancel,
  submitting,
  directCompletion = false,
}: {
  taskTitle: string;
  onConfirm: () => void;
  onCancel: () => void;
  submitting: boolean;
  directCompletion?: boolean;
}) {
  return (
    <TaskActionDialogFrame busy={submitting} onCancel={onCancel}>
        <div className="flex items-center gap-3 border-b border-slate-100 px-6 py-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-600">
            <Send className="h-4 w-4" />
          </div>
          <DialogTitle className="text-base font-semibold text-slate-900">{t(directCompletion ? "标记任务完成" : "提交任务审核")}</DialogTitle>
        </div>
        <div className="space-y-3 px-6 py-5">
          <DialogDescription className="text-sm text-slate-700">
            {t(directCompletion ? "确认将「" : "确认提交「")}<span className="font-semibold text-slate-900">{taskTitle}</span>{t(directCompletion ? "」直接标记为已完成？" : "」进入待审核状态？")}
          </DialogDescription>
          <p className="text-xs text-slate-500">{t(directCompletion ? "确认后立即生效，无需审核" : "提交将任务进入待审核状态，请确认成果已准备好。")}</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-3">
          <Button variant="unstyled"
            type="button"
            disabled={submitting}
            onClick={onCancel}
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            {t("取消")}
          </Button>
          <Button
            type="button"
            disabled={submitting}
            onClick={onConfirm}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors disabled:opacity-60"
          >
            {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
            {t(directCompletion ? "确认完成" : "确认提交")}
          </Button>
        </div>
    </TaskActionDialogFrame>
  );
}

// ─── HandoverDialog ───────────────────────────────────────────────────────────
export function CompleteConfirmDialog({
  taskTitle,
  onConfirm,
  onCancel,
  submitting,
  directCompletion = false,
}: {
  taskTitle: string;
  onConfirm: () => void;
  onCancel: () => void;
  submitting: boolean;
  directCompletion?: boolean;
}) {
  return (
    <TaskActionDialogFrame busy={submitting} onCancel={onCancel}>
        <div className="flex items-center gap-3 border-b border-emerald-100 bg-emerald-50/60 px-6 py-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
            <CheckCircle2 className="h-4 w-4" />
          </div>
          <DialogTitle className="text-base font-semibold text-slate-900">{t("标记任务完成")}</DialogTitle>
        </div>
        <div className="space-y-3 px-6 py-5">
          <DialogDescription className="text-sm text-slate-700">
            {t("确认将「")}<span className="font-semibold text-slate-900">{taskTitle}</span>{t("」直接标记为已完成？")}
          </DialogDescription>
          <p className="text-xs text-slate-500">{t(directCompletion ? "确认后立即生效，无需审核" : "管理员/主管操作会跳过提交审核，任务进度将设为 100%。")}</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-3">
          <Button variant="unstyled"
            type="button"
            disabled={submitting}
            onClick={onCancel}
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            {t("取消")}
          </Button>
          <Button variant="unstyled"
            type="button"
            disabled={submitting}
            onClick={onConfirm}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:opacity-60"
          >
            {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
            {t("确认完成")}
          </Button>
        </div>
    </TaskActionDialogFrame>
  );
}

export function HandoverDialog({
  taskTitle,
  currentOwner,
  people,
  onConfirm,
  onCancel,
  horizonVariant = false,
}: {
  taskId: string;
  taskTitle: string;
  currentOwner: string;
  people: { name: string }[];
  onConfirm: (newOwner: string) => Promise<void>;
  onCancel: () => void;
  horizonVariant?: boolean;
}) {
  const [newOwner, setNewOwner] = useState("");
  const [saving, setSaving] = useState(false);

  const options = people.filter((p) => p.name !== currentOwner);

  const handleConfirm = async () => {
    if (!newOwner) { toast.error(t("请选择新责任人")); return; }
    if (newOwner === currentOwner) { toast.error(t("新责任人与当前负责人相同")); return; }
    setSaving(true);
    try {
      await onConfirm(newOwner);
    } finally {
      setSaving(false);
    }
  };

  return (
    <TaskActionDialogFrame busy={saving} onCancel={onCancel}>
        <div className="flex items-center gap-3 border-b border-slate-100 px-6 py-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600">
            <ArrowRight className="h-4 w-4" />
          </div>
          <DialogTitle className="text-base font-semibold text-slate-900">{t("移交任务")}</DialogTitle>
        </div>
        <div className="space-y-4 px-6 py-5">
          <DialogDescription className="text-sm text-slate-700">
            {t("将「")}<span className="font-semibold text-slate-900">{taskTitle}</span>{t("」移交给新责任人")}
          </DialogDescription>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-700">{t("当前负责人")}</label>
            <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-500">{currentOwner}</div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-700">{t("新责任人")}</label>
            <Select value={newOwner} onValueChange={setNewOwner} disabled={saving}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("请选择新责任人")} />
              </SelectTrigger>
              <SelectContent className={cn(horizonVariant && "rd-horizon-detail-select")}>
                {options.length === 0 ? (
                  <div className="px-3 py-4 text-center text-xs text-muted-foreground">{t("暂无可选人员")}</div>
                ) : (
                  options.map((p) => (
                    <SelectItem key={p.name} value={p.name}>{p.name}</SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-3">
          <Button variant="unstyled"
            type="button"
            disabled={saving}
            onClick={onCancel}
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            {t("取消")}
          </Button>
          <Button variant="unstyled"
            type="button"
            disabled={saving || !newOwner}
            onClick={handleConfirm}
            className="inline-flex items-center gap-1.5 rounded-md bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-slate-800 disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowRight className="h-3 w-3" />}
            {t("确认移交")}
          </Button>
        </div>
    </TaskActionDialogFrame>
  );
}

// ─── AddCollaboratorsDialog（管理员专用：直接添加，不走审核流程）──────────────
export function AddCollaboratorsDialog({
  taskTitle,
  currentOwner,
  existingCollaborators,
  people,
  onConfirm,
  onCancel,
}: {
  taskTitle: string;
  currentOwner: string;
  existingCollaborators: RdCollaborator[];
  people: PersonProfile[];
  onConfirm: (newCollaborators: RdCollaborator[]) => Promise<void>;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const existingNames = useMemo(
    () => new Set(existingCollaborators.map((c) => c.name).concat([currentOwner])),
    [existingCollaborators, currentOwner],
  );

  // 候选人 = 全部人员 - 主责人 - 已有协作人
  const candidates = useMemo(
    () => people.filter((p) => p.name && !existingNames.has(p.name)),
    [people, existingNames],
  );

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleConfirm = async () => {
    if (selected.size === 0) { toast.error(t("请至少选择一位协作人")); return; }
    const additions: RdCollaborator[] = candidates
      .filter((p) => selected.has(p.id))
      .map((p) => ({
        id: p.id,
        name: p.name,
        role: p.position || "协作人",
        user_id: p.user_id ?? null,
      }));
    setSaving(true);
    try {
      await onConfirm(additions);
    } finally {
      setSaving(false);
    }
  };

  return (
    <TaskActionDialogFrame busy={saving} onCancel={onCancel} className="flex flex-col">
        <div className="flex items-center gap-3 border-b border-indigo-100 bg-indigo-50/60 px-6 py-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-600">
            <UserPlus className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-base font-semibold text-slate-900">{t("添加协作人")}</DialogTitle>
            <p className="mt-0.5 truncate text-[11px] text-slate-500">{taskTitle}</p>
          </div>
        </div>
        <div className="space-y-3 px-6 py-4">
          <DialogDescription className="text-xs leading-relaxed text-slate-500">
            {t("管理员直接添加将")}<span className="font-semibold text-indigo-700">{t("立即生效")}</span>{t("，不需要走审核流程。")}
            {t("已选")} <span className="font-semibold text-slate-700 tabular-nums">{selected.size}</span> / {candidates.length}
          </DialogDescription>
          <div className="max-h-72 overflow-y-auto rounded-md border border-slate-200">
            {candidates.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">{t("无可添加的人员（其他人都已在协作或主责）")}</div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {candidates.map((p) => {
                  const isSelected = selected.has(p.id);
                  return (
                    <li key={p.id}>
                      <Button variant="unstyled"
                        type="button"
                        onClick={() => toggle(p.id)}
                        className={cn(
                          "flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors",
                          isSelected ? "bg-accent text-primary" : "hover:bg-slate-50 text-slate-700",
                        )}
                      >
                        <span
                          className={cn(
                            "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                            isSelected ? "border-indigo-500 bg-indigo-500 text-white" : "border-slate-300 bg-white",
                          )}
                        >
                          {isSelected && <Check className="h-3 w-3" />}
                        </span>
                        <OwnerAvatar name={p.name} userId={p.user_id} size="xs" />
                        <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                        {p.position && <span className="shrink-0 text-[11px] text-muted-foreground">{p.position}</span>}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-3">
          <Button variant="unstyled"
            type="button"
            disabled={saving}
            onClick={onCancel}
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            {t("取消")}
          </Button>
          <Button
            type="button"
            disabled={saving || selected.size === 0}
            onClick={handleConfirm}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserPlus className="h-3 w-3" />}
            {t("确认添加")} {selected.size > 0 ? `(${selected.size})` : ""}
          </Button>
        </div>
    </TaskActionDialogFrame>
  );
}

// ─── ApprovalActionDialog ─────────────────────────────────────────────────────
export function ApprovalActionDialog({
  mode,
  task,
  onConfirm,
  onCancel,
  submitting,
}: {
  mode: "approve" | "reject";
  task: Task;
  onConfirm: (reason?: string, rollbackProgress?: number) => Promise<void>;
  onCancel: () => void;
  submitting: boolean;
}) {
  const [reason, setReason] = useState("");
  const [rollbackProgress, setRollbackProgress] = useState(Math.max(0, task.progress - 10));

  const isApprove = mode === "approve";

  const handleConfirm = async () => {
    if (!isApprove && !reason.trim()) { toast.error(t("请填写打回原因")); return; }
    await onConfirm(reason.trim() || undefined, isApprove ? undefined : rollbackProgress);
  };

  return (
    <TaskActionDialogFrame busy={submitting} onCancel={onCancel}>
        <div className={cn(
          "flex items-center gap-3 border-b px-6 py-4",
          isApprove ? "border-emerald-100 bg-emerald-50/60" : "border-red-100 bg-red-50/60",
        )}>
          <div className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
            isApprove ? "bg-emerald-100 text-emerald-600" : "bg-red-100 text-red-600",
          )}>
            {isApprove ? <CheckCircle2 className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}
          </div>
          <DialogTitle className="text-base font-semibold text-slate-900">
            {isApprove ? t("审核通过") : t("打回修改")}
          </DialogTitle>
        </div>
        <div className="space-y-4 px-6 py-5">
          <DialogDescription className="text-sm text-slate-700">
            {isApprove
              ? task.pending_review_type === "proposal"
                ? <>{t("确认通过「")}<span className="font-semibold text-slate-900">{task.title}</span>{t("」的立项审核？通过后任务将正式立项并进入进行中状态。")}</>
                : task.pending_review_type === "collaboration"
                ? <>{t("确认通过「")}<span className="font-semibold text-slate-900">{task.title}</span>{t("」的协作变更审核？通过后协同人变更将生效，任务回到进行中。")}</>
                : task.pending_review_type === "due_date"
                ? <>{t("确认通过「")}<span className="font-semibold text-slate-900">{task.title}</span>{t("」的截止日期变更审核？通过后任务的截止日期将更新为申请值，并回到进行中。")}</>
                : task.pending_review_type === "merge"
                ? <>{t("确认通过「")}<span className="font-semibold text-slate-900">{task.title}</span>{t("」的合并审核？通过后本任务的子任务、进展留痕、附件与协作人将并入目标任务，本任务随即归档。")}</>
                : task.pending_review_type === "abandon"
                ? <>{t("确认通过「")}<span className="font-semibold text-slate-900">{task.title}</span>{t("」的放弃审核？通过后本任务及其子任务将被彻底移除，不可恢复。")}</>
                : <>{t("确认通过「")}<span className="font-semibold text-slate-900">{task.title}</span>{t("」的审核？任务将标记为已完成，进度设为 100%。")}</>
              : <>{t("将「")}<span className="font-semibold text-slate-900">{task.title}</span>{t("」打回给负责人重新修改。")}</>
            }
          </DialogDescription>
          {!isApprove && (
            <>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-700">{t("打回原因")} <span className="text-red-500">*</span></label>
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  placeholder={t("请说明需要修改的原因…")}
                  className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-primary/25 focus:ring-2 focus:ring-primary/25"
                  autoFocus
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-700">{t("回退进度（%）")}</label>
                <Input
                  type="number"
                  min={0}
                  max={99}
                  value={rollbackProgress}
                  onChange={(e) => setRollbackProgress(Math.min(99, Math.max(0, Number(e.target.value))))}
                  className="w-24"
                />
                <span className="ml-2 text-xs text-muted-foreground">{t("当前进度")} {task.progress}%</span>
              </div>
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-3">
          <Button variant="unstyled"
            type="button"
            disabled={submitting}
            onClick={onCancel}
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            {t("取消")}
          </Button>
          <Button variant="unstyled"
            type="button"
            disabled={submitting || (!isApprove && !reason.trim())}
            onClick={handleConfirm}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors disabled:opacity-60",
              isApprove ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700",
            )}
          >
            {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : isApprove ? <CheckCircle2 className="h-3 w-3" /> : <RotateCcw className="h-3 w-3" />}
            {isApprove ? t("确认通过") : t("确认打回")}
          </Button>
        </div>
    </TaskActionDialogFrame>
  );
}
