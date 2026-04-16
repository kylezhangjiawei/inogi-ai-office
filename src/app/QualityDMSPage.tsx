import React, { useEffect, useMemo, useState } from "react";
import { CheckCheck, FileText, FolderSync, Lock, Search } from "lucide-react";
import { Dialog, DialogActions, DialogContent, DialogTitle } from "@mui/material";
import { toast } from "sonner";
import { cn } from "./components/ui/utils";

const docs = [
  { code: "CX-001", name: "文件控制程序", version: "V3.2", owner: "刘嘉", status: "已发布", approver: "QA 经理", type: "程序文件", dept: "质量" },
  { code: "JL-014", name: "来料检验记录", version: "V1.6", owner: "周远", status: "审核中", approver: "质量主管", type: "记录表单", dept: "IQC" },
  { code: "WI-022", name: "装配作业指导书", version: "V2.1", owner: "王工", status: "待发布", approver: "制造经理", type: "作业指导", dept: "制造" },
  { code: "SOP-018", name: "售后返修流程", version: "V1.9", owner: "韩青", status: "已发布", approver: "服务总监", type: "流程文件", dept: "售后" },
  { code: "TM-009", name: "灭菌验证培训记录", version: "V1.1", owner: "林娜", status: "审核中", approver: "QA 经理", type: "培训记录", dept: "质量" },
];

const statusTone: Record<string, string> = {
  已发布: "bg-emerald-50 text-emerald-700",
  审核中: "bg-amber-50 text-amber-700",
  待发布: "bg-blue-50 text-blue-700",
};

const pageSize = 3;
type DialogMode = "approve" | "distribute" | "lock" | "filter" | null;

export function QualityDMSPage() {
  const [keyword, setKeyword] = useState("");
  const [selectedCode, setSelectedCode] = useState(docs[0].code);
  const [deptFilter, setDeptFilter] = useState("全部部门");
  const [page, setPage] = useState(1);
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);

  const filtered = useMemo(
    () => docs.filter((item) => (!keyword || [item.code, item.name, item.owner, item.type].join(" ").toLowerCase().includes(keyword.toLowerCase())) && (deptFilter === "全部部门" || item.dept === deptFilter)),
    [deptFilter, keyword],
  );

  useEffect(() => {
    setPage(1);
  }, [keyword, deptFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pagedDocs = filtered.slice((page - 1) * pageSize, page * pageSize);
  const selected = filtered.find((item) => item.code === selectedCode) ?? filtered[0] ?? null;

  useEffect(() => {
    if (!filtered.some((item) => item.code === selectedCode) && filtered[0]) {
      setSelectedCode(filtered[0].code);
    }
  }, [filtered, selectedCode]);

  const closeDialog = () => setDialogMode(null);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="material-card p-6 md:p-8">
        <span className="material-chip bg-blue-50 text-blue-700">QMS DMS</span>
        <h2 className="mt-3 text-[2rem] font-bold tracking-tight text-slate-900">质量文件管理</h2>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">这页补上搜索、部门筛选、分页和审批动作弹窗，便于演示受控文件从审核到分发的完整链路。</p>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
        {[
          ["受控文件", "86", "含历史版本"],
          ["审核中", "7", "跨部门会签"],
          ["本周发布", "4", "已自动分发"],
          ["即将失效", "3", "需更新培训"],
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
              <input value={keyword} onChange={(e) => setKeyword(e.target.value)} className="material-input pl-11" placeholder="搜索编号、文件名、负责人" />
            </div>
            <button type="button" className="material-button-secondary" onClick={() => setDialogMode("filter")}>
              <FileText className="h-4 w-4" />
              部门筛选
            </button>
          </div>
          <div className="space-y-4">
            {pagedDocs.map((item) => (
              <button key={item.code} type="button" onClick={() => setSelectedCode(item.code)} className={cn("w-full rounded-[24px] border p-5 text-left transition", selectedCode === item.code ? "border-blue-200 bg-blue-50/40" : "border-slate-100 bg-slate-50/60")}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-800">{item.name}</div>
                    <div className="mt-2 text-sm text-slate-500">
                      {item.code} · {item.type} · 负责人 {item.owner}
                    </div>
                  </div>
                  <span className={cn("material-chip", statusTone[item.status])}>{item.status}</span>
                </div>
                <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
                  <span>版本 {item.version}</span>
                  <span>审批人 {item.approver}</span>
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
            <h3 className="text-slate-900">文件详情</h3>
            {selected ? (
              <div className="mt-4 space-y-4">
                <div className="rounded-[24px] bg-[linear-gradient(135deg,#edf5ff_0%,#ffffff_58%,#eef9f7_100%)] p-5">
                  <div className="text-lg font-semibold text-slate-900">{selected.name}</div>
                  <div className="mt-3 space-y-2 text-sm text-slate-600">
                    <div>编号：{selected.code}</div>
                    <div>版本：{selected.version}</div>
                    <div>当前审批：{selected.approver}</div>
                    <div>状态：{selected.status}</div>
                  </div>
                </div>
                <div className="space-y-3">
                  {[
                    ["受控分发", "售后、制造、质量部门已接收"],
                    ["培训记录", "3 个班组待确认学习"],
                    ["历史版本", "V3.1 / V3.0 可追溯"],
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
              <button type="button" onClick={() => setDialogMode("approve")} className="material-button-primary w-full justify-center">
                <CheckCheck className="h-4 w-4" />
                推进审批
              </button>
              <button type="button" onClick={() => setDialogMode("distribute")} className="material-button-secondary w-full justify-center">
                <FolderSync className="h-4 w-4" />
                重新分发
              </button>
              <button type="button" onClick={() => setDialogMode("lock")} className="material-button-secondary w-full justify-center">
                <Lock className="h-4 w-4" />
                锁定旧版
              </button>
            </div>
          </section>
        </aside>
      </section>

      <Dialog open={dialogMode === "filter"} onClose={closeDialog} fullWidth maxWidth="sm">
        <DialogTitle>部门筛选</DialogTitle>
        <DialogContent dividers>
          <select className="material-input" value={deptFilter} onChange={(event) => setDeptFilter(event.target.value)}>
            {["全部部门", "质量", "IQC", "制造", "售后"].map((item) => (
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

      <Dialog open={dialogMode === "approve"} onClose={closeDialog} fullWidth maxWidth="sm">
        <DialogTitle>推进审批</DialogTitle>
        <DialogContent dividers>
          <div className="space-y-2 text-sm text-slate-600">
            <div>文件：{selected?.name}</div>
            <div>下一节点：{selected?.status === "审核中" ? "发布确认" : "质量主管复核"}</div>
          </div>
        </DialogContent>
        <DialogActions>
          <button type="button" className="material-button-secondary" onClick={closeDialog}>
            取消
          </button>
          <button type="button" className="material-button-primary" onClick={() => { closeDialog(); toast.success("文件已进入下一审批节点"); }}>
            确认
          </button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialogMode === "distribute"} onClose={closeDialog} fullWidth maxWidth="sm">
        <DialogTitle>重新分发</DialogTitle>
        <DialogContent dividers>
          <p className="text-sm leading-7 text-slate-600">将重新推送给制造、质量、售后部门，并补发培训提醒。</p>
        </DialogContent>
        <DialogActions>
          <button type="button" className="material-button-secondary" onClick={closeDialog}>
            关闭
          </button>
          <button type="button" className="material-button-primary" onClick={() => { closeDialog(); toast.success("受控副本已重新分发"); }}>
            执行分发
          </button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialogMode === "lock"} onClose={closeDialog} fullWidth maxWidth="sm">
        <DialogTitle>锁定旧版</DialogTitle>
        <DialogContent dividers>
          <p className="text-sm leading-7 text-slate-600">将把历史版本标记为只读，并保留查询与追溯权限。</p>
        </DialogContent>
        <DialogActions>
          <button type="button" className="material-button-secondary" onClick={closeDialog}>
            关闭
          </button>
          <button type="button" className="material-button-primary" onClick={() => { closeDialog(); toast.success("历史版本已锁定"); }}>
            锁定
          </button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
