import React, { useEffect, useMemo, useState } from "react";
import { Briefcase, Filter, Send, UserCheck } from "lucide-react";
import { Dialog, DialogActions, DialogContent, DialogTitle } from "@mui/material";
import { toast } from "sonner";
import { cn } from "./components/ui/utils";

const candidates = [
  { id: "CV-301", name: "林嘉雪", role: "注册专员", score: 92, status: "推荐面试", years: "5年", note: "有 FDA / MDR 实操经验", dept: "注册" },
  { id: "CV-298", name: "周一鸣", role: "质量工程师", score: 86, status: "待复筛", years: "4年", note: "熟悉 QMS / CAPA", dept: "质量" },
  { id: "CV-287", name: "赵子轩", role: "售后工程师", score: 74, status: "待复筛", years: "3年", note: "现场支持经验较强", dept: "售后" },
  { id: "CV-275", name: "陈舒宁", role: "法务专员", score: 68, status: "暂缓", years: "2年", note: "合同审查基础较好", dept: "法务" },
  { id: "CV-266", name: "许南乔", role: "研发工程师", score: 81, status: "推荐面试", years: "4年", note: "结构设计与试制经验扎实", dept: "研发" },
];

const statusTone: Record<string, string> = {
  推荐面试: "bg-emerald-50 text-emerald-700",
  待复筛: "bg-blue-50 text-blue-700",
  暂缓: "bg-slate-100 text-slate-600",
};

const pageSize = 3;
type DialogMode = "job" | "interview" | "sync" | "talent" | null;

export function ResumeScreeningPage() {
  const [status, setStatus] = useState("全部");
  const [deptFilter, setDeptFilter] = useState("全部部门");
  const [selectedId, setSelectedId] = useState(candidates[0].id);
  const [page, setPage] = useState(1);
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);

  const filtered = useMemo(
    () => candidates.filter((item) => (status === "全部" || item.status === status) && (deptFilter === "全部部门" || item.dept === deptFilter)),
    [deptFilter, status],
  );

  useEffect(() => {
    setPage(1);
  }, [status, deptFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pagedCandidates = filtered.slice((page - 1) * pageSize, page * pageSize);
  const selected = filtered.find((item) => item.id === selectedId) ?? filtered[0] ?? null;

  useEffect(() => {
    if (!filtered.some((item) => item.id === selectedId) && filtered[0]) {
      setSelectedId(filtered[0].id);
    }
  }, [filtered, selectedId]);

  const closeDialog = () => setDialogMode(null);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="material-card p-6 md:p-8">
        <span className="material-chip bg-blue-50 text-blue-700">Talent AI</span>
        <h2 className="mt-3 text-[2rem] font-bold tracking-tight text-slate-900">简历筛选</h2>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">补齐岗位过滤、分页和候选人动作弹窗，让 HR 与部门主管可以更顺畅地推进筛选演示流程。</p>
      </section>
      <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
        {[
          ["待筛简历", "24", "本周新增 9 份"],
          ["推荐面试", "6", "可直接安排"],
          ["复筛中", "11", "待主管确认"],
          ["人才库", "43", "可复用历史候选人"],
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
          <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap gap-2">
              {["全部", "推荐面试", "待复筛", "暂缓"].map((item) => (
                <button key={item} type="button" onClick={() => setStatus(item)} className={cn("rounded-full border px-4 py-2 text-sm font-semibold", status === item ? "border-blue-200 bg-blue-50 text-primary" : "border-slate-200 bg-white text-slate-500")}>
                  {item}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setDialogMode("job")} className="material-button-secondary">
              <Filter className="h-4 w-4" />
              岗位筛选
            </button>
          </div>
          <div className="space-y-4">
            {pagedCandidates.map((item) => (
              <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} className={cn("w-full rounded-[24px] border p-5 text-left", selectedId === item.id ? "border-blue-200 bg-blue-50/40" : "border-slate-100 bg-slate-50/60")}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-800">{item.name}</div>
                    <div className="mt-2 text-sm text-slate-500">
                      {item.role} · {item.years}
                    </div>
                  </div>
                  <span className={cn("material-chip", statusTone[item.status])}>{item.status}</span>
                </div>
                <div className="mt-4 flex items-center justify-between">
                  <span className="text-sm text-slate-600">{item.note}</span>
                  <span className="text-lg font-bold text-slate-900">{item.score}</span>
                </div>
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
            <h3 className="text-slate-900">候选人详情</h3>
            {selected ? (
              <div className="mt-4 space-y-4">
                <div className="rounded-[24px] bg-[linear-gradient(135deg,#edf5ff_0%,#ffffff_58%,#eef9f7_100%)] p-5">
                  <div className="text-lg font-semibold text-slate-900">{selected.name}</div>
                  <div className="mt-3 space-y-2 text-sm text-slate-600">
                    <div>岗位：{selected.role}</div>
                    <div>经验：{selected.years}</div>
                    <div>匹配分：{selected.score}</div>
                    <div>AI 摘要：{selected.note}</div>
                  </div>
                </div>
                <div className="space-y-3">
                  {[
                    ["核心亮点", "法规经验、跨部门沟通、英文读写"],
                    ["风险提示", "薪资预期略高，需提前确认"],
                    ["推荐动作", "进入一面并同步部门主管"],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                      <div className="text-xs uppercase tracking-[0.14em] text-slate-400">{label}</div>
                      <div className="mt-2 text-sm text-slate-700">{value}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
          <section className="material-card p-6">
            <div className="space-y-3">
              <button type="button" onClick={() => setDialogMode("interview")} className="material-button-primary w-full justify-center">
                <UserCheck className="h-4 w-4" />
                推荐面试
              </button>
              <button type="button" onClick={() => setDialogMode("sync")} className="material-button-secondary w-full justify-center">
                <Send className="h-4 w-4" />
                发送主管复筛
              </button>
              <button type="button" onClick={() => setDialogMode("talent")} className="material-button-secondary w-full justify-center">
                <Briefcase className="h-4 w-4" />
                加入人才库
              </button>
            </div>
          </section>
        </aside>
      </section>

      <Dialog open={dialogMode === "job"} onClose={closeDialog} fullWidth maxWidth="sm">
        <DialogTitle>岗位筛选</DialogTitle>
        <DialogContent dividers>
          <select className="material-input" value={deptFilter} onChange={(event) => setDeptFilter(event.target.value)}>
            {["全部部门", "注册", "质量", "售后", "法务", "研发"].map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </DialogContent>
        <DialogActions>
          <button type="button" className="material-button-secondary" onClick={() => setDeptFilter("全部部门")}>
            重置
          </button>
          <button type="button" className="material-button-primary" onClick={closeDialog}>
            完成
          </button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialogMode === "interview"} onClose={closeDialog} fullWidth maxWidth="sm">
        <DialogTitle>推荐面试</DialogTitle>
        <DialogContent dividers>
          <div className="space-y-2 text-sm text-slate-600">
            <div>候选人：{selected?.name}</div>
            <div>建议安排：48 小时内完成一面</div>
          </div>
        </DialogContent>
        <DialogActions>
          <button type="button" className="material-button-secondary" onClick={closeDialog}>
            取消
          </button>
          <button type="button" className="material-button-primary" onClick={() => { closeDialog(); toast.success("候选人已加入面试流程"); }}>
            确认
          </button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialogMode === "sync"} onClose={closeDialog} fullWidth maxWidth="sm">
        <DialogTitle>发送主管复筛</DialogTitle>
        <DialogContent dividers>
          <p className="text-sm leading-7 text-slate-600">将同步候选人简历摘要、匹配分和面试建议给对应部门主管。</p>
        </DialogContent>
        <DialogActions>
          <button type="button" className="material-button-secondary" onClick={closeDialog}>
            关闭
          </button>
          <button type="button" className="material-button-primary" onClick={() => { closeDialog(); toast.success("已同步给部门主管"); }}>
            发送
          </button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialogMode === "talent"} onClose={closeDialog} fullWidth maxWidth="sm">
        <DialogTitle>加入人才库</DialogTitle>
        <DialogContent dividers>
          <p className="text-sm leading-7 text-slate-600">会保留候选人画像、岗位方向与后续跟进建议，便于后续复用。</p>
        </DialogContent>
        <DialogActions>
          <button type="button" className="material-button-secondary" onClick={closeDialog}>
            关闭
          </button>
          <button type="button" className="material-button-primary" onClick={() => { closeDialog(); toast.success("候选人已加入人才库标签"); }}>
            确认加入
          </button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
