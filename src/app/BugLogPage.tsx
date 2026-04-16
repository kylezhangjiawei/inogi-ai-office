import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Bug, GitBranch, Send } from "lucide-react";
import { Dialog, DialogActions, DialogContent, DialogTitle } from "@mui/material";
import { toast } from "sonner";
import { cn } from "./components/ui/utils";

const bugs = [
  { id: "BUG-4401", title: "售后详情页备注在移动端换行异常", severity: "中", owner: "前端组", status: "处理中", note: "已定位到表格布局样式", module: "售后" },
  { id: "BUG-4392", title: "报关单证字段抽取偶发为空", severity: "高", owner: "AI 服务", status: "待修复", note: "疑似 OCR 超时", module: "报关" },
  { id: "BUG-4388", title: "会议纪要导出 PDF 图标错位", severity: "低", owner: "前端组", status: "已完成", note: "已回归通过", module: "会议" },
  { id: "BUG-4381", title: "员工档案筛选后分页未重置", severity: "中", owner: "平台组", status: "待修复", note: "筛选联动缺少页码复位", module: "HR" },
];

const sprintSummary = [
  { label: "本周新增", value: "7", helper: "其中高优先 2 个" },
  { label: "已关闭", value: "5", helper: "回归全部通过" },
  { label: "平均修复时长", value: "1.8d", helper: "较上周下降" },
];

const tone: Record<string, string> = {
  高: "bg-rose-50 text-rose-700",
  中: "bg-amber-50 text-amber-700",
  低: "bg-emerald-50 text-emerald-700",
};

const statusTone: Record<string, string> = {
  待修复: "bg-blue-50 text-blue-700",
  处理中: "bg-amber-50 text-amber-700",
  已完成: "bg-emerald-50 text-emerald-700",
};

const pageSize = 3;
type DialogMode = "iterate" | "regression" | "notify" | null;

export function BugLogPage() {
  const [selectedId, setSelectedId] = useState(bugs[0].id);
  const [severity, setSeverity] = useState("全部");
  const [page, setPage] = useState(1);
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const filtered = useMemo(() => bugs.filter((item) => severity === "全部" || item.severity === severity), [severity]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pagedBugs = filtered.slice((page - 1) * pageSize, page * pageSize);
  const selected = filtered.find((item) => item.id === selectedId) ?? filtered[0] ?? null;

  useEffect(() => {
    setPage(1);
  }, [severity]);

  useEffect(() => {
    if (!filtered.some((item) => item.id === selectedId) && filtered[0]) {
      setSelectedId(filtered[0].id);
    }
  }, [filtered, selectedId]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="material-card p-6 md:p-8">
        <span className="material-chip bg-blue-50 text-blue-700">Bug Center</span>
        <h2 className="mt-3 text-[2rem] font-bold tracking-tight text-slate-900">BUG 日志</h2>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">把严重度筛选、分页和缺陷动作弹窗补齐，方便研发和业务一起走完缺陷推进、回归和同步通知流程。</p>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
        {[
          ["待修复", "5", "高优先 2 个"],
          ["处理中", "8", "本周集中收敛"],
          ["已完成", "22", "回归通过"],
          ["复开率", "4%", "持续下降"],
        ].map(([label, value, helper]) => (
          <div key={label} className="material-card-flat p-5">
            <div className="text-sm text-slate-500">{label}</div>
            <div className="mt-3 text-4xl font-bold tracking-tight text-slate-900">{value}</div>
            <div className="mt-2 text-sm text-slate-500">{helper}</div>
          </div>
        ))}
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="material-card p-6">
          <div className="mb-5 flex flex-wrap gap-2">
            {["全部", "高", "中", "低"].map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setSeverity(item)}
                className={cn("rounded-full border px-4 py-2 text-sm font-semibold", severity === item ? "border-blue-200 bg-blue-50 text-primary" : "border-slate-200 bg-white text-slate-500")}
              >
                {item === "全部" ? "全部严重度" : `${item}严重度`}
              </button>
            ))}
          </div>
          <div className="space-y-4">
            {pagedBugs.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedId(item.id)}
                className={cn("w-full rounded-[24px] border p-5 text-left", selectedId === item.id ? "border-blue-200 bg-blue-50/40" : "border-slate-100 bg-slate-50/60")}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-800">{item.title}</div>
                    <div className="mt-2 text-sm text-slate-500">
                      {item.id} · {item.owner}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <span className={cn("material-chip", tone[item.severity])}>{item.severity}</span>
                    <span className={cn("material-chip", statusTone[item.status])}>{item.status}</span>
                  </div>
                </div>
                <div className="mt-3 text-sm text-slate-600">{item.note}</div>
              </button>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between">
            <div className="text-sm text-slate-500">
              共 {filtered.length} 条，当前第 {page}/{totalPages} 页
            </div>
            <div className="flex gap-2">
              <button type="button" className="material-button-secondary !px-3 !py-2 disabled:cursor-not-allowed disabled:opacity-50" onClick={() => setPage((prev) => Math.max(1, prev - 1))} disabled={page === 1}>
                上一页
              </button>
              <button type="button" className="material-button-secondary !px-3 !py-2 disabled:cursor-not-allowed disabled:opacity-50" onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))} disabled={page === totalPages}>
                下一页
              </button>
            </div>
          </div>
        </div>

        <aside className="space-y-6">
          <section className="material-card p-6">
            <h3 className="text-slate-900">缺陷详情</h3>
            {selected ? (
              <div className="mt-4 space-y-4">
                <div className="rounded-[24px] bg-[linear-gradient(135deg,#fff1f2_0%,#ffffff_58%,#fff7ed_100%)] p-5">
                  <div className="text-lg font-semibold text-slate-900">{selected.title}</div>
                  <div className="mt-3 space-y-2 text-sm text-slate-600">
                    <div>编号：{selected.id}</div>
                    <div>责任：{selected.owner}</div>
                    <div>状态：{selected.status}</div>
                    <div>说明：{selected.note}</div>
                  </div>
                </div>
                {[
                  ["定位建议", "优先检查接口超时与页面布局约束"],
                  ["影响范围", `${selected.module} 模块及相关联动页`],
                  ["下一步", "修复后安排回归并同步业务负责人"],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                    <div className="text-xs uppercase tracking-[0.14em] text-slate-400">{label}</div>
                    <div className="mt-2 text-sm text-slate-700">{value}</div>
                  </div>
                ))}
              </div>
            ) : null}
          </section>
          <section className="material-card p-6">
            <div className="space-y-3">
              <button type="button" onClick={() => setDialogMode("iterate")} className="material-button-primary w-full justify-center">
                <Bug className="h-4 w-4" />
                加入修复迭代
              </button>
              <button type="button" onClick={() => setDialogMode("regression")} className="material-button-secondary w-full justify-center">
                <GitBranch className="h-4 w-4" />
                创建回归任务
              </button>
              <button type="button" onClick={() => setDialogMode("notify")} className="material-button-secondary w-full justify-center">
                <Send className="h-4 w-4" />
                通知责任人
              </button>
            </div>
          </section>
        </aside>
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="material-card p-6">
          <h3 className="text-slate-900">本轮缺陷摘要</h3>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
            {sprintSummary.map((item) => (
              <div key={item.label} className="rounded-[22px] border border-slate-100 bg-slate-50/80 p-4">
                <div className="text-xs uppercase tracking-[0.14em] text-slate-400">{item.label}</div>
                <div className="mt-3 text-2xl font-bold text-slate-900">{item.value}</div>
                <div className="mt-2 text-sm text-slate-500">{item.helper}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="material-card p-6">
          <h3 className="text-slate-900">研发建议</h3>
          <div className="mt-4 space-y-3">
            {[
              "高优先 BUG 建议默认关联回归任务，避免修完漏测。",
              "AI/OCR 类异常可增加超时兜底与重试日志。",
              "前端布局问题建议补一轮移动端视觉回归截图。",
            ].map((item) => (
              <div key={item} className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm text-slate-700">
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>

      <Dialog open={dialogMode === "iterate"} onClose={() => setDialogMode(null)} fullWidth maxWidth="sm">
        <DialogTitle>加入修复迭代</DialogTitle>
        <DialogContent dividers>
          <div className="space-y-2 text-sm text-slate-600">
            <div>缺陷：{selected?.title}</div>
            <div>建议归属：本周迭代 Sprint-16</div>
          </div>
        </DialogContent>
        <DialogActions>
          <button type="button" className="material-button-secondary" onClick={() => setDialogMode(null)}>
            取消
          </button>
          <button type="button" className="material-button-primary" onClick={() => { setDialogMode(null); toast.success("缺陷已加入迭代修复清单"); }}>
            确认加入
          </button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialogMode === "regression"} onClose={() => setDialogMode(null)} fullWidth maxWidth="sm">
        <DialogTitle>创建回归任务</DialogTitle>
        <DialogContent dividers>
          <p className="text-sm leading-7 text-slate-600">将自动带出模块、缺陷编号和验证点，创建给 QA 的回归任务。</p>
        </DialogContent>
        <DialogActions>
          <button type="button" className="material-button-secondary" onClick={() => setDialogMode(null)}>
            关闭
          </button>
          <button type="button" className="material-button-primary" onClick={() => { setDialogMode(null); toast.success("回归任务已创建"); }}>
            创建
          </button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialogMode === "notify"} onClose={() => setDialogMode(null)} fullWidth maxWidth="sm">
        <DialogTitle>通知责任人</DialogTitle>
        <DialogContent dividers>
          <p className="text-sm leading-7 text-slate-600">将同步消息到责任人和业务联系人，并附带当前缺陷摘要与截止时间。</p>
        </DialogContent>
        <DialogActions>
          <button type="button" className="material-button-secondary" onClick={() => setDialogMode(null)}>
            关闭
          </button>
          <button type="button" className="material-button-primary" onClick={() => { setDialogMode(null); toast.success("异常同步已发送"); }}>
            发送
          </button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
