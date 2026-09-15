import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CheckCircle2, ChevronRight, Undo2, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '/src/app/components/ui/dialog';
import { Input } from '/src/app/components/ui/input';
import { cn } from '/src/app/components/ui/utils';
import '/src/styles/index.css';
const t = (text, params = {}) => text.replace(/\{(\w+)\}/g, (m, key) => params[key] ?? m);
const useI18n = () => {};
const toast = { error() {} };
const STATUS_CONFIG = { in_progress: { dot: 'bg-blue-500' } };
const displayPersonName = value => value;
const AutoTranslatedText = ({ text }) => <>{text}</>;
function countRelationNodes(task: RdTask): number {
  return 1 + (task.subtasks ?? []).reduce((total, child) => total + countRelationNodes(child), 0);
}
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
  const [submitError, setSubmitError] = useState("");

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
    setSubmitError("");
    setSaving(true);
    try {
      await onConfirm(Array.from(picked));
    } catch (error) {
      const message = error instanceof Error ? error.message : t("并入失败，请重试");
      setSubmitError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onCancel(); }}>
      <DialogContent
        className="rd-horizon-detail-dialog flex max-h-[88dvh] flex-col gap-0 overflow-hidden rounded-xl border-slate-200 bg-white p-0 sm:max-w-lg"
        onEscapeKeyDown={(event) => { if (saving) event.preventDefault(); }}
        onPointerDownOutside={(event) => { if (saving) event.preventDefault(); }}
      >
        <DialogHeader className="flex-row items-center gap-3 border-b border-slate-100 px-5 py-4 text-left sm:px-6">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600">
            <ChevronRight className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <DialogTitle className="text-balance text-base font-semibold text-slate-900">{t("并入已有任务为子任务")}</DialogTitle>
            <DialogDescription className="mt-1 truncate text-[11px] text-slate-500">
              {t("父任务：{title}", { title: parentTask.title })}
            </DialogDescription>
          </div>
        </DialogHeader>
        <div className="border-b border-slate-100 px-5 py-3 sm:px-6">
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            autoFocus
            placeholder={t("搜索任务标题 / 编号 / 主责人")}
            className="h-9 rounded-lg border-slate-200 text-sm"
          />
        </div>
        <div className="cockpit-scroll min-h-0 flex-1 space-y-1.5 overflow-y-auto px-5 py-3 sm:px-6" role="group" aria-label={t("可并入任务列表")}>
          {filtered.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-pretty text-sm text-slate-500">{candidates.length === 0 ? t("没有可并入的独立任务") : t("没有匹配的任务")}</p>
              {keyword ? <button type="button" onClick={() => setKeyword("")} className="mt-2 text-xs font-semibold text-[#002fa7] hover:underline">{t("清空搜索")}</button> : null}
            </div>
          ) : (
            filtered.map((c) => {
              const cfg = STATUS_CONFIG[c.status] ?? STATUS_CONFIG.in_progress;
              const checked = picked.has(c.task_id);
              return (
                <button
                  key={c.task_id}
                  type="button"
                  onClick={() => toggle(c.task_id)}
                  aria-pressed={checked}
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors",
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
                  <span className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-2.5">
                    <span className="block min-w-0 flex-1 truncate text-sm text-slate-700">
                      <AutoTranslatedText text={c.title} />
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 sm:mt-0 sm:shrink-0 sm:flex-nowrap">
                      {(c.subtasks?.length ?? 0) > 0 ? (
                        <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] tabular-nums text-slate-500">
                          {t("含 {n} 个下级", { n: countRelationNodes(c) - 1 })}
                        </span>
                      ) : null}
                      <span className="text-[11px] text-slate-400">{displayPersonName(c.primary_owner)}</span>
                      <span className="break-all font-mono text-[11px] text-slate-400">{c.task_id}</span>
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
        <div className="border-t border-slate-100 px-5 py-3 sm:px-6">
          {submitError ? <p className="mb-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-pretty text-xs text-rose-700" role="alert">{submitError}</p> : null}
          <p className="mb-2 text-pretty text-[11px] leading-relaxed text-slate-500">
            {t("并入后任务本体及其全部下级层级永久保留，仅整棵任务树的归属发生变化，可随时取消。跨产品库时，整棵任务树会一并迁入当前产品库。")}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-[11px] tabular-nums text-slate-500">{t("已选 {n} 个", { n: picked.size })}</span>
            <span className="flex justify-end gap-2">
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
                {saving ? t("并入中…") : t("并入为子任务")}
              </button>
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
function DetachSubtasksDialog({
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
  const [submitError, setSubmitError] = useState("");

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return candidates;
    return candidates.filter(
      (candidate) =>
        candidate.title.toLowerCase().includes(kw) ||
        candidate.task_id.toLowerCase().includes(kw) ||
        (candidate.primary_owner ?? "").toLowerCase().includes(kw),
    );
  }, [candidates, keyword]);

  const toggle = (taskId: string) => {
    setPicked((previous) => {
      const next = new Set(previous);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const toggleAll = () => {
    setPicked((previous) =>
      previous.size === candidates.length
        ? new Set()
        : new Set(candidates.map((candidate) => candidate.task_id)),
    );
  };

  const handleSave = async () => {
    if (picked.size === 0 || saving) return;
    setSubmitError("");
    setSaving(true);
    try {
      await onConfirm(Array.from(picked));
    } catch (error) {
      const message = error instanceof Error ? error.message : t("批量取消失败，请重试");
      setSubmitError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onCancel(); }}>
      <DialogContent
        className="rd-horizon-detail-dialog flex max-h-[88dvh] flex-col gap-0 overflow-hidden rounded-xl border-slate-200 bg-white p-0 sm:max-w-lg"
        onEscapeKeyDown={(event) => { if (saving) event.preventDefault(); }}
        onPointerDownOutside={(event) => { if (saving) event.preventDefault(); }}
      >
        <DialogHeader className="flex-row items-center gap-3 border-b border-slate-100 px-5 py-4 text-left sm:px-6">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600">
            <Undo2 className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-balance text-base font-semibold text-slate-900">{t("批量取消子任务关系")}</DialogTitle>
            <DialogDescription className="mt-1 truncate text-[11px] text-slate-500">
              {t("父任务：{title}", { title: parentTask.title })}
            </DialogDescription>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={toggleAll}
            className="mr-7 rounded px-2 py-1 text-xs font-semibold text-[#002fa7] hover:bg-[#eef3ff] disabled:opacity-40"
          >
            {picked.size === candidates.length ? t("取消全选") : t("全选")}
          </button>
        </DialogHeader>
        <div className="border-b border-slate-100 px-5 py-3 sm:px-6">
          <Input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            autoFocus
            placeholder={t("搜索任务标题 / 编号 / 主责人")}
            className="h-9 rounded-lg border-slate-200 text-sm"
          />
        </div>
        <div className="cockpit-scroll min-h-0 flex-1 space-y-1.5 overflow-y-auto px-5 py-3 sm:px-6" role="group" aria-label={t("可取消关系任务列表")}>
          {filtered.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-pretty text-sm text-slate-500">{t("没有匹配的子任务")}</p>
              {keyword ? <button type="button" onClick={() => setKeyword("")} className="mt-2 text-xs font-semibold text-[#002fa7] hover:underline">{t("清空搜索")}</button> : null}
            </div>
          ) : filtered.map((candidate) => {
            const checked = picked.has(candidate.task_id);
            const descendantCount = countRelationNodes(candidate) - 1;
            return (
              <button
                key={candidate.task_id}
                type="button"
                onClick={() => toggle(candidate.task_id)}
                aria-pressed={checked}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors",
                  checked
                    ? "border-slate-400 bg-slate-50"
                    : "border-slate-100 hover:border-slate-300 hover:bg-slate-50/70",
                )}
              >
                <span
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded border",
                    checked ? "border-slate-600 bg-slate-600 text-white" : "border-slate-300 bg-white",
                  )}
                >
                  {checked ? <CheckCircle2 className="size-3" /> : null}
                </span>
                <span className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-2.5">
                  <span className="block min-w-0 flex-1 truncate text-sm text-slate-700">
                    <AutoTranslatedText text={candidate.title} />
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 sm:mt-0 sm:shrink-0 sm:flex-nowrap">
                    {descendantCount > 0 ? (
                      <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] tabular-nums text-slate-500">
                        {t("含 {n} 个下级", { n: descendantCount })}
                      </span>
                    ) : null}
                    <span className="break-all font-mono text-[11px] text-slate-400">{candidate.task_id}</span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="border-t border-slate-100 px-5 py-3 sm:px-6">
          {submitError ? <p className="mb-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-pretty text-xs text-rose-700" role="alert">{submitError}</p> : null}
          <p className="mb-2 text-pretty text-[11px] leading-relaxed text-slate-500">
            {t("取消后，所选任务会连同其全部下级任务一起提升为独立任务，不会删除任何留痕或附件。")}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-[11px] tabular-nums text-slate-500">{t("已选 {n} 个", { n: picked.size })}</span>
            <span className="flex justify-end gap-2">
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
                className="inline-flex items-center gap-1.5 rounded-md bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-slate-800 disabled:opacity-60"
              >
                {saving ? <Loader2 className="size-3 animate-spin" /> : <Undo2 className="size-3" />}
                {saving ? t("取消中…") : t("确认取消关系")}
              </button>
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
function Harness() {
  const [result, setResult] = useState('');
  const query = new URLSearchParams(location.search);
  const Component = query.get('kind') === 'detach' ? DetachSubtasksDialog : AttachSubtasksDialog;
  const candidates = Array.from({ length: query.get('count') === '0' ? 0 : 80 }, (_, i) => ({ task_id: 'RD-2026-' + String(i + 1).padStart(6, '0') + '-J8Y', title: '验证任务 ' + (i + 1) + '：Q7 各档位浓度及流量复测和文档输出', primary_owner: '测试工程师', status: 'in_progress', subtasks: i % 3 === 0 ? [{ task_id: 'child-' + i, title: '保留的下级', subtasks: [] }] : [] }));
  return result ? <p role="status">{result}</p> : <Component parentTask={{ task_id: 'PARENT', title: 'Q7 各档位数据复测及 ECN 文档归档' }} candidates={candidates} onCancel={() => setResult('取消成功')} onConfirm={async ids => { setResult('确认成功：' + ids.join(', ')); }} />;
}
createRoot(document.getElementById('root')).render(<Harness />);
setInterval(() => {
 const dialog = document.querySelector('[role="dialog"]');
 if (!dialog) return;
 const list = dialog.querySelector('[role="group"]');
 const sections = [...dialog.children].filter(el => el.tagName !== 'BUTTON');
 const rect = el => {const r=el.getBoundingClientRect();return {x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height), scrollWidth:el.scrollWidth, clientWidth:el.clientWidth}};
 parent.postMessage({kind:'layout', viewport:[innerWidth,innerHeight], direction:getComputedStyle(dialog).flexDirection, dialog:rect(dialog), sections:sections.map(rect), listScrollable:list.scrollHeight>list.clientHeight, listScrollTop:list.scrollTop}, location.origin);
}, 500);
