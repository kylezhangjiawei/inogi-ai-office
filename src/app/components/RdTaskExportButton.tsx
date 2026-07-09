/**
 * 研发任务驾驶舱「导出完成情况」按钮 + 起止时间弹窗。
 * 自包含：管理弹窗状态、调用 exportRdTasksXlsx 生成并下载 Excel。
 * 只读操作（导出已在页面可见的数据），不额外加权限门。
 */
import * as React from "react";
import { createPortal } from "react-dom";
import { Download, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { exportRdTasksXlsx } from "../lib/rdTaskExport";
import { t, useI18n } from "../lib/i18n";
import type { RdTask } from "../lib/rdApi";

function toYmd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function RdTaskExportButton({ allTasks }: { allTasks: RdTask[] }) {
  useI18n(); // 订阅语言切换（按钮文案 t()）
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  // 默认本月初 → 今天
  const today = React.useMemo(() => new Date(), []);
  const [start, setStart] = React.useState(() => toYmd(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [end, setEnd] = React.useState(() => toYmd(today));

  const close = () => {
    if (busy) return;
    setOpen(false);
  };

  const run = async () => {
    if (!start || !end) {
      toast.error("请选择起始和结束日期");
      return;
    }
    if (start > end) {
      toast.error("起始日期不能晚于结束日期");
      return;
    }
    setBusy(true);
    try {
      const count = await exportRdTasksXlsx(allTasks, { start, end });
      if (count === 0) {
        toast.message("该时间段内没有有活动记录的任务", { description: "已导出空表，可调整时间范围后重试。" });
      } else {
        toast.success(`已导出 ${count} 条任务（人员汇总 + 任务明细）`);
      }
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "导出失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="按时间段导出所有人员任务完成情况（Excel）"
        className="group flex flex-none items-center gap-2 rounded-xl border border-sky-100 bg-white/90 px-2.5 py-2 text-left text-xs font-semibold text-slate-700 shadow-[0_8px_18px_rgba(15,23,42,0.05)] transition-all hover:-translate-y-0.5 hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700 active:translate-y-0 active:scale-[0.98]"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-600 ring-1 ring-sky-100">
          <Download className="h-4 w-4" />
        </span>
        <span className="min-w-0">{t("导出")}</span>
      </button>

      {open && createPortal(
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-slate-900/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="导出任务完成情况"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-700">
              <div>
                <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">导出任务完成情况</h3>
                <p className="mt-0.5 text-xs text-slate-400">选择起止日期，导出该时间段内所有人员的任务与完成状态</p>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="关闭"
                className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="space-y-4 px-5 py-4">
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">起始日期</span>
                  <input
                    type="date"
                    value={start}
                    max={end || undefined}
                    onChange={(e) => setStart(e.target.value)}
                    className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-800 outline-none focus-visible:border-indigo-400 focus-visible:ring-2 focus-visible:ring-indigo-500/30 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">结束日期</span>
                  <input
                    type="date"
                    value={end}
                    min={start || undefined}
                    onChange={(e) => setEnd(e.target.value)}
                    className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-800 outline-none focus-visible:border-indigo-400 focus-visible:ring-2 focus-visible:ring-indigo-500/30 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                {([
                  { label: "近 7 天", days: 7 },
                  { label: "近 30 天", days: 30 },
                  { label: "本月", month: true },
                ] as const).map((q) => (
                  <button
                    key={q.label}
                    type="button"
                    onClick={() => {
                      const now = new Date();
                      setEnd(toYmd(now));
                      if ("month" in q && q.month) {
                        setStart(toYmd(new Date(now.getFullYear(), now.getMonth(), 1)));
                      } else if ("days" in q) {
                        const s = new Date(now);
                        s.setDate(s.getDate() - (q.days - 1));
                        setStart(toYmd(s));
                      }
                    }}
                    className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600 transition-colors hover:border-indigo-200 hover:text-indigo-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                  >
                    {q.label}
                  </button>
                ))}
              </div>
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-400 dark:bg-slate-800/50">
                说明：含「人员汇总」与「任务明细」两个工作表；按任务最近活动时间归入时间段，封存任务不计入。
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-4 dark:border-slate-700">
              <button
                type="button"
                onClick={close}
                disabled={busy}
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                取消
              </button>
              <button
                type="button"
                onClick={run}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-60"
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                导出 Excel
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
