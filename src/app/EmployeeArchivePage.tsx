import React, { useEffect, useMemo, useState } from "react";
import { BadgeCheck, FolderSync, Search, UserPlus } from "lucide-react";
import { Dialog, DialogActions, DialogContent, DialogTitle } from "@mui/material";
import { toast } from "sonner";
import { cn } from "./components/ui/utils";

const employees = [
  { id: "EMP-118", name: "王思远", dept: "研发部", status: "在职", stage: "档案齐全", note: "已完成入职培训与保密协议" },
  { id: "EMP-114", name: "陈雅楠", dept: "质量部", status: "在职", stage: "待补材料", note: "缺少体检报告扫描件" },
  { id: "EMP-109", name: "周子恬", dept: "市场部", status: "试用期", stage: "档案齐全", note: "待发起转正评估" },
  { id: "EMP-097", name: "李诗涵", dept: "法务部", status: "离职", stage: "已归档", note: "离职交接已完成" },
  { id: "EMP-091", name: "林知行", dept: "售后部", status: "在职", stage: "待补材料", note: "学历证明原件待补录" },
];

const stageTone: Record<string, string> = {
  档案齐全: "bg-emerald-50 text-emerald-700",
  待补材料: "bg-amber-50 text-amber-700",
  已归档: "bg-slate-100 text-slate-600",
};

const pageSize = 3;
type DialogMode = "create" | "remind" | "verify" | "filter" | null;

export function EmployeeArchivePage() {
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState("全部状态");
  const [selectedId, setSelectedId] = useState(employees[0].id);
  const [page, setPage] = useState(1);
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);

  const filtered = useMemo(
    () => employees.filter((item) => (!keyword || [item.id, item.name, item.dept, item.status].join(" ").toLowerCase().includes(keyword.toLowerCase())) && (statusFilter === "全部状态" || item.status === statusFilter)),
    [keyword, statusFilter],
  );

  useEffect(() => {
    setPage(1);
  }, [keyword, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pagedEmployees = filtered.slice((page - 1) * pageSize, page * pageSize);
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
        <span className="material-chip bg-blue-50 text-blue-700">HR Archive</span>
        <h2 className="mt-3 text-[2rem] font-bold tracking-tight text-slate-900">员工归档</h2>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">把档案检索、状态过滤、分页和补件提醒做成真交互，方便演示人事档案从入职到离职的维护流程。</p>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
        {[
          ["在职员工", "42", "含试用期 6 人"],
          ["待补档案", "3", "需本周补齐"],
          ["新入职", "5", "待发培训资料"],
          ["已归档离职", "12", "可追溯"],
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
            <div className="relative max-w-md flex-1">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={keyword} onChange={(e) => setKeyword(e.target.value)} className="material-input pl-11" placeholder="搜索工号、姓名、部门" />
            </div>
            <button type="button" className="material-button-secondary" onClick={() => setDialogMode("filter")}>
              <FolderSync className="h-4 w-4" />
              状态筛选
            </button>
          </div>
          <div className="space-y-4">
            {pagedEmployees.map((item) => (
              <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} className={cn("w-full rounded-[24px] border p-5 text-left", selectedId === item.id ? "border-blue-200 bg-blue-50/40" : "border-slate-100 bg-slate-50/60")}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-800">{item.name}</div>
                    <div className="mt-2 text-sm text-slate-500">
                      {item.id} · {item.dept} · {item.status}
                    </div>
                  </div>
                  <span className={cn("material-chip", stageTone[item.stage])}>{item.stage}</span>
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
            <h3 className="text-slate-900">档案详情</h3>
            {selected ? (
              <div className="mt-4 space-y-4">
                <div className="rounded-[24px] bg-[linear-gradient(135deg,#edf5ff_0%,#ffffff_58%,#eef9f7_100%)] p-5">
                  <div className="text-lg font-semibold text-slate-900">{selected.name}</div>
                  <div className="mt-3 space-y-2 text-sm text-slate-600">
                    <div>工号：{selected.id}</div>
                    <div>部门：{selected.dept}</div>
                    <div>状态：{selected.status}</div>
                    <div>档案状态：{selected.stage}</div>
                  </div>
                </div>
                {[
                  ["已收材料", "身份证、学历证明、劳动合同"],
                  ["待办提醒", selected.stage === "待补材料" ? "补交缺失材料" : "暂无待补材料"],
                  ["下一步", selected.status === "试用期" ? "准备转正评估" : "保持常规档案维护"],
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
              <button type="button" onClick={() => setDialogMode("create")} className="material-button-primary w-full justify-center">
                <UserPlus className="h-4 w-4" />
                新增员工档案
              </button>
              <button type="button" onClick={() => setDialogMode("remind")} className="material-button-secondary w-full justify-center">
                <FolderSync className="h-4 w-4" />
                发送补件提醒
              </button>
              <button type="button" onClick={() => setDialogMode("verify")} className="material-button-secondary w-full justify-center">
                <BadgeCheck className="h-4 w-4" />
                校验完整性
              </button>
            </div>
          </section>
        </aside>
      </section>

      <Dialog open={dialogMode === "filter"} onClose={closeDialog} fullWidth maxWidth="sm">
        <DialogTitle>状态筛选</DialogTitle>
        <DialogContent dividers>
          <select className="material-input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            {["全部状态", "在职", "试用期", "离职"].map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </DialogContent>
        <DialogActions>
          <button type="button" className="material-button-secondary" onClick={() => setStatusFilter("全部状态")}>
            重置
          </button>
          <button type="button" className="material-button-primary" onClick={closeDialog}>
            完成
          </button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialogMode === "create"} onClose={closeDialog} fullWidth maxWidth="sm">
        <DialogTitle>新增员工档案</DialogTitle>
        <DialogContent dividers>
          <div className="space-y-2 text-sm text-slate-600">
            <div>默认流程：HR 建档 → 部门确认 → 行政归档</div>
            <div>默认初始状态：待补材料</div>
          </div>
        </DialogContent>
        <DialogActions>
          <button type="button" className="material-button-secondary" onClick={closeDialog}>
            取消
          </button>
          <button type="button" className="material-button-primary" onClick={() => { closeDialog(); toast.success("已发起新员工档案流程"); }}>
            创建
          </button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialogMode === "remind"} onClose={closeDialog} fullWidth maxWidth="sm">
        <DialogTitle>补件提醒</DialogTitle>
        <DialogContent dividers>
          <p className="text-sm leading-7 text-slate-600">将同步提醒给员工本人和直属主管，并在首页待办生成跟进任务。</p>
        </DialogContent>
        <DialogActions>
          <button type="button" className="material-button-secondary" onClick={closeDialog}>
            关闭
          </button>
          <button type="button" className="material-button-primary" onClick={() => { closeDialog(); toast.success("材料催交通知已发送"); }}>
            发送
          </button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialogMode === "verify"} onClose={closeDialog} fullWidth maxWidth="sm">
        <DialogTitle>完整性校验</DialogTitle>
        <DialogContent dividers>
          <p className="text-sm leading-7 text-slate-600">会核对身份证、学历、合同、培训记录和离职交接单等必要字段。</p>
        </DialogContent>
        <DialogActions>
          <button type="button" className="material-button-secondary" onClick={closeDialog}>
            关闭
          </button>
          <button type="button" className="material-button-primary" onClick={() => { closeDialog(); toast.success("档案校验已通过"); }}>
            开始校验
          </button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
