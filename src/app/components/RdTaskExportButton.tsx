/**
 * 研发任务驾驶舱「导出完成情况」按钮 + 起止时间弹窗。
 * 自包含：管理弹窗状态、调用 exportRdTasksXlsx 生成并下载 Excel。
 * 只读操作；导出前仍按当前研发驾驶舱配置人员目录做数据边界校验。
 */
import * as React from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { exportRdTasksXlsx } from "../lib/rdTaskExport";
import { t, useI18n } from "../lib/i18n";
import type { RdTask } from "../lib/rdApi";
import type { RdMemberDirectoryEntry } from "../lib/rdMemberIdentity";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

function toYmd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function RdTaskExportButton({
  allTasks,
  peopleDirectory,
}: {
  allTasks: RdTask[];
  peopleDirectory: readonly RdMemberDirectoryEntry[];
}) {
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
      const count = await exportRdTasksXlsx(allTasks, { start, end }, peopleDirectory);
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
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (nextOpen) setOpen(true);
      else close();
    }}>
      <DialogTrigger asChild>
        <Button variant="unstyled"
          type="button"
          title="按时间段导出研发驾驶舱配置人员的任务完成情况（Excel）"
          className="group flex flex-none items-center gap-2 rounded-xl border border-[#dce6ff] bg-white px-2.5 py-2 text-left text-xs font-semibold text-slate-700 shadow-sm hover:border-primary/25 hover:bg-accent hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent text-primary ring-1 ring-[#dce6ff]">
            <Download className="size-4" />
          </span>
          <span className="min-w-0">{t("导出")}</span>
        </Button>
      </DialogTrigger>

      <DialogContent
        className="horizon-portal gap-0 overflow-hidden border-slate-200 bg-white p-0 sm:max-w-md"
        onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }}
        onInteractOutside={(event) => { if (busy) event.preventDefault(); }}
      >
        <DialogHeader className="border-b border-slate-200 px-5 py-4 pr-12">
          <DialogTitle className="text-balance text-base text-[#1b2559]">导出任务完成情况</DialogTitle>
          <DialogDescription className="text-pretty text-xs leading-5 text-slate-500">
            选择起止日期，仅导出当前研发驾驶舱配置人员的任务与完成状态
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-5 py-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">起始日期</span>
                  <Input
                    type="date"
                    value={start}
                    max={end || undefined}
                    onChange={(e) => setStart(e.target.value)}
                className="h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm tabular-nums text-slate-800 outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
                  />
                </label>
                <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">结束日期</span>
                  <Input
                    type="date"
                    value={end}
                    min={start || undefined}
                    onChange={(e) => setEnd(e.target.value)}
                className="h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm tabular-nums text-slate-800 outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                {([
                  { label: "近 7 天", days: 7 },
                  { label: "近 30 天", days: 30 },
                  { label: "本月", month: true },
                ] as const).map((q) => (
                  <Button variant="unstyled"
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
                className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600 hover:border-primary/25 hover:bg-accent hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                  >
                    {q.label}
                  </Button>
                ))}
              </div>
          <p className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-pretty text-[11px] leading-5 text-slate-500">
                说明：含「人员汇总」与「任务明细」两个工作表；按任务最近活动时间归入时间段，非研发配置人员、离职及封存任务不计入。
              </p>
            </div>

        <DialogFooter className="border-t border-slate-200 px-5 py-4">
              <Button variant="unstyled"
                type="button"
                onClick={close}
                disabled={busy}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                取消
              </Button>
              <Button variant="unstyled"
                type="button"
                onClick={run}
                disabled={busy}
            className="hz-primary-action inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-60"
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                导出 Excel
              </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
