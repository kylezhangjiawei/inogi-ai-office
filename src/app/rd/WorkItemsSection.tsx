import { useState } from "react";
import { Plus, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { Textarea } from "../components/ui/textarea";
import { cn } from "../components/ui/utils";
import { updateRdTask, type RdWorkItem } from "../lib/rdApi";
import { t } from "../lib/i18n";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import { type Task } from './taskModel';

/**
 * 工作项清单（任务详情内）：任务内部的轻量拆分——如文档类任务的各个文件。
 * 工作项不是任务：无独立审批/优先级/截止日，不进任务树，驾驶舱/统计/负载/AI 立项对其零感知。
 * 数据存于任务对象的 work_items 字段（PATCH 持久化）；进度留痕可关联工作项，留痕区按 Tab 分组查看。
 */
export function WorkItemsSection({
  task,
  canEdit,
  noteCountByItem,
  onTaskPatched,
  onTaskMutated,
}: {
  task: Task;
  canEdit: boolean;
  /** 各工作项已关联的留痕数（work_item_id → count），来自主任务 progressNotes */
  noteCountByItem: Map<string, number>;
  onTaskPatched?: (taskId: string, patch: Partial<Task>) => void;
  onTaskMutated?: () => void;
}) {
  const items = task.work_items ?? [];
  const doneCount = items.filter((it) => it.done).length;
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  /** 工作项动作 → 操作留痕（带 work_item_id，留痕区按工作项 Tab 呈现完整时间线：创建→进展→完成） */
  const auditWorkItem = (comment: string, workItemId?: string) => {
  };

  const persist = async (next: RdWorkItem[], successText?: string) => {
    setSaving(true);
    try {
      await updateRdTask(task.task_id, { work_items: next } as Partial<Task>);
      if (successText) toast.success(successText);
      onTaskPatched?.(task.task_id, { work_items: next } as Partial<Task>);
      onTaskMutated?.();
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("保存工作项失败"));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = async () => {
    const titles = draft.split("\n").map((t) => t.trim()).filter(Boolean);
    if (titles.length === 0) {
      toast.error(t("请每行输入一个工作项标题"));
      return;
    }
    const stamp = Date.now();
    const created: RdWorkItem[] = titles.map((title, index) => ({
      id: `wi-${stamp}-${index}-${Math.random().toString(36).slice(2, 6)}`,
      title,
      done: false,
    }));
    if (await persist([...items, ...created], `已添加 ${created.length} 个工作项`)) {
      created.forEach((it) => auditWorkItem(`添加了工作项《${it.title}》`, it.id));
      setDraft("");
      setAdding(false);
    }
  };

  const toggleDone = async (id: string) => {
    if (!canEdit || saving) return;
    const target = items.find((it) => it.id === id);
    if (!target) return;
    if (await persist(items.map((it) => (it.id === id ? { ...it, done: !it.done } : it)))) {
      auditWorkItem(target.done ? `重新打开了工作项《${target.title}》` : `完成了工作项《${target.title}》`, id);
    }
  };

  const removeItem = async (id: string) => {
    if (!canEdit || saving) return;
    const target = items.find((it) => it.id === id);
    if (await persist(items.filter((it) => it.id !== id))) {
      // 删除记录不带 work_item_id：该工作项 Tab 已不存在，归入「未关联」保证可见
      auditWorkItem(`删除了工作项《${target?.title ?? id}》`);
    }
  };

  if (items.length === 0 && !canEdit) return null;

  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-slate-500">
          {t("工作项")}{items.length > 0 ? ` ${doneCount}/${items.length}` : ""}
        </span>
        {canEdit && !adding && (
          <Button variant="unstyled"
            type="button"
            onClick={() => setAdding(true)}
            className="flex cursor-pointer items-center gap-1 rounded px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-slate-200 hover:text-slate-700"
          >
            <Plus className="h-2.5 w-2.5" />
            {t("添加工作项")}
          </Button>
        )}
      </div>

      {items.length > 0 && (
        <ul className={cn("cockpit-scroll max-h-52 overflow-y-auto", canEdit ? "space-y-1.5" : "space-y-0.5")}>
          {items.map((it) => {
            const noteCount = noteCountByItem.get(it.id) ?? 0;
            return (
              // 只读展示（驾驶舱/详情页）用无框简洁行（美式 checklist）；编辑态（工作台入口）保留框行
              <li
                key={it.id}
                className={cn(
                  "group flex items-center gap-2.5 text-sm",
                  canEdit ? "rounded-lg border border-slate-200 bg-white px-2.5 py-1.5" : "px-1 py-1",
                )}
              >
                <Checkbox
                  checked={it.done}
                  disabled={!canEdit || saving}
                  onCheckedChange={() => void toggleDone(it.id)}
                  className="border-slate-300"
                />
                <span className={cn("min-w-0 flex-1 truncate", it.done ? "text-muted-foreground line-through" : "text-slate-700")}>{it.title}</span>
                {it.owner_name && <span className="shrink-0 text-[11px] text-muted-foreground">{it.owner_name}</span>}
                {noteCount > 0 && (
                  <span className="rd-work-item-note-count shrink-0 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-500">{t("{n} 条留痕", { n: noteCount })}</span>
                )}
                {canEdit && (
                  <Button variant="unstyled"
                    type="button"
                    onClick={() => void removeItem(it.id)}
                    className="shrink-0 cursor-pointer rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-slate-100 hover:text-slate-500 group-hover:opacity-100"
                    title={t("删除工作项（已关联的留痕保留在主任务）")}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {adding ? (
        <div className="mt-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            placeholder={t("每行一个工作项，例如：\n用户手册（英文版）\nFDA 提交材料 · 附录B\n装配 SOP 文档")}
            className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-primary/25 focus:ring-2 focus:ring-primary/25"
            autoFocus
          />
          <div className="mt-2 flex items-center justify-end gap-1.5">
            <Button variant="unstyled"
              type="button"
              onClick={() => { setAdding(false); setDraft(""); }}
              className="cursor-pointer rounded px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-200"
            >
              {t("取消")}
            </Button>
            <Button
              type="button"
              onClick={handleCreate}
              disabled={saving}
              className="flex cursor-pointer items-center gap-1 rounded px-2.5 py-1 text-[11px] font-semibold disabled:opacity-60"
            >
              {saving ? <RefreshCw className="h-2.5 w-2.5 animate-spin" /> : <Plus className="h-2.5 w-2.5" />}
              {t("批量添加")}
            </Button>
          </div>
        </div>
      ) : (
        items.length === 0 && (
          <div className="rounded-lg border border-dashed border-slate-200 py-3 text-center text-xs text-muted-foreground">
            {t("暂无工作项，可把任务拆成几个小块（如不同类型文档各一项），进度留痕可关联到工作项分组查看")}
          </div>
        )
      )}
    </div>
  );
}
