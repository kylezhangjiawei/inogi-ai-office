import React, { useEffect, useMemo, useState } from "react";
import { FolderKanban, Languages, Search, Send, ShieldCheck } from "lucide-react";
import { Dialog, DialogActions, DialogContent, DialogTitle } from "@mui/material";
import { toast } from "sonner";
import { cn } from "./components/ui/utils";

const docs = [
  { id: "DOC-201", name: "CE 认证资料包", stage: "L2", locale: "EN", version: "V2.1", status: "可外发", owner: "周宁" },
  { id: "DOC-188", name: "产品彩页", stage: "L1", locale: "CN/EN", version: "V3.0", status: "可外发", owner: "市场部" },
  { id: "DOC-173", name: "客户 FAQ", stage: "L2", locale: "EN", version: "V1.8", status: "待更新", owner: "售后部" },
  { id: "DOC-159", name: "注册说明模板", stage: "L3", locale: "CN", version: "V1.3", status: "限制外发", owner: "RA 团队" },
  { id: "DOC-144", name: "经销商培训手册", stage: "L2", locale: "EN/ES", version: "V2.4", status: "可外发", owner: "市场部" },
];

const statusTone: Record<string, string> = {
  可外发: "bg-emerald-50 text-emerald-700",
  待更新: "bg-amber-50 text-amber-700",
  限制外发: "bg-slate-100 text-slate-600",
};

const pageSize = 3;
type DialogMode = "package" | "script" | "permission" | null;

export function ExternalDocsPage() {
  const [keyword, setKeyword] = useState("");
  const [stage, setStage] = useState("全部");
  const [selectedId, setSelectedId] = useState(docs[0].id);
  const [page, setPage] = useState(1);
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);

  const filtered = useMemo(
    () =>
      docs.filter((item) => {
        const matchKeyword = !keyword || [item.id, item.name, item.locale, item.owner].join(" ").toLowerCase().includes(keyword.toLowerCase());
        const matchStage = stage === "全部" || item.stage === stage;
        return matchKeyword && matchStage;
      }),
    [keyword, stage],
  );

  useEffect(() => {
    setPage(1);
  }, [keyword, stage]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pagedDocs = filtered.slice((page - 1) * pageSize, page * pageSize);
  const selected = filtered.find((item) => item.id === selectedId) ?? filtered[0] ?? null;

  useEffect(() => {
    if (!filtered.some((item) => item.id === selectedId) && filtered[0]) {
      setSelectedId(filtered[0].id);
    }
  }, [filtered, selectedId]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="material-card p-6 md:p-8">
        <span className="material-chip bg-blue-50 text-blue-700">Enablement</span>
        <h2 className="mt-3 text-[2rem] font-bold tracking-tight text-slate-900">对外资料版本</h2>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">把对外资料页补上分页和外发动作弹窗，让市场、注册和售后能完整演示“选资料 - 生成话术 - 校验权限”的流转。</p>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
        {[
          ["资料总数", "28", "分 L1/L2/L3"],
          ["推荐命中", "5", "按客户阶段推荐"],
          ["待更新", "3", "旧版需替换"],
          ["限制外发", "4", "需主管审批"],
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
          <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={keyword} onChange={(e) => setKeyword(e.target.value)} className="material-input pl-11" placeholder="搜索资料名称、编号、语言" />
            </div>
            <div className="flex flex-wrap gap-2">
              {["全部", "L1", "L2", "L3"].map((item) => (
                <button key={item} type="button" onClick={() => setStage(item)} className={cn("rounded-full border px-4 py-2 text-sm font-semibold", stage === item ? "border-blue-200 bg-blue-50 text-primary" : "border-slate-200 bg-white text-slate-500")}>
                  {item}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            {pagedDocs.map((item) => (
              <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} className={cn("w-full rounded-[24px] border p-5 text-left", selectedId === item.id ? "border-blue-200 bg-blue-50/40" : "border-slate-100 bg-slate-50/60")}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-800">{item.name}</div>
                    <div className="mt-2 text-sm text-slate-500">
                      {item.id} · {item.locale} · {item.owner}
                    </div>
                  </div>
                  <span className={cn("material-chip", statusTone[item.status])}>{item.status}</span>
                </div>
                <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
                  <span>阶段 {item.stage}</span>
                  <span>版本 {item.version}</span>
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
            <h3 className="text-slate-900">资料详情</h3>
            {selected ? (
              <div className="mt-4 space-y-4">
                <div className="rounded-[24px] bg-[linear-gradient(135deg,#edf5ff_0%,#ffffff_58%,#eef9f7_100%)] p-5">
                  <div className="text-lg font-semibold text-slate-900">{selected.name}</div>
                  <div className="mt-3 space-y-2 text-sm text-slate-600">
                    <div>编号：{selected.id}</div>
                    <div>语言：{selected.locale}</div>
                    <div>阶段：{selected.stage}</div>
                    <div>版本：{selected.version}</div>
                  </div>
                </div>
                {[
                  ["推荐客户场景", "注册推进、首轮介绍、售后答疑"],
                  ["话术建议", "外发时附带本地化介绍和版本说明"],
                  ["安全提醒", "L3 文件需主管审批后可对外发送"],
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
              <button type="button" onClick={() => setDialogMode("package")} className="material-button-primary w-full justify-center">
                <Send className="h-4 w-4" />
                加入外发清单
              </button>
              <button type="button" onClick={() => setDialogMode("script")} className="material-button-secondary w-full justify-center">
                <Languages className="h-4 w-4" />
                生成外发话术
              </button>
              <button type="button" onClick={() => setDialogMode("permission")} className="material-button-secondary w-full justify-center">
                <ShieldCheck className="h-4 w-4" />
                校验外发权限
              </button>
            </div>
          </section>
        </aside>
      </section>

      <Dialog open={dialogMode === "package"} onClose={() => setDialogMode(null)} fullWidth maxWidth="sm">
        <DialogTitle>加入外发清单</DialogTitle>
        <DialogContent dividers>
          <div className="space-y-2 text-sm text-slate-600">
            <div>资料：{selected?.name}</div>
            <div>将自动带出版本号、语言和使用建议。</div>
          </div>
        </DialogContent>
        <DialogActions>
          <button type="button" className="material-button-secondary" onClick={() => setDialogMode(null)}>
            取消
          </button>
          <button type="button" className="material-button-primary" onClick={() => { setDialogMode(null); toast.success("资料包已加入外发清单"); }}>
            确认加入
          </button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialogMode === "script"} onClose={() => setDialogMode(null)} fullWidth maxWidth="sm">
        <DialogTitle>生成外发话术</DialogTitle>
        <DialogContent dividers>
          <p className="text-sm leading-7 text-slate-600">会根据资料语言版本和客户阶段，生成邮件正文与发送备注。</p>
        </DialogContent>
        <DialogActions>
          <button type="button" className="material-button-secondary" onClick={() => setDialogMode(null)}>
            关闭
          </button>
          <button type="button" className="material-button-primary" onClick={() => { setDialogMode(null); toast.success("已生成多语言外发话术"); }}>
            生成
          </button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialogMode === "permission"} onClose={() => setDialogMode(null)} fullWidth maxWidth="sm">
        <DialogTitle>校验外发权限</DialogTitle>
        <DialogContent dividers>
          <div className="space-y-2 text-sm text-slate-600">
            <div>当前阶段：{selected?.stage}</div>
            <div>校验项：资料级别、审批状态、接收对象范围</div>
          </div>
        </DialogContent>
        <DialogActions>
          <button type="button" className="material-button-secondary" onClick={() => setDialogMode(null)}>
            关闭
          </button>
          <button type="button" className="material-button-primary" onClick={() => { setDialogMode(null); toast.success("外发权限校验通过"); }}>
            开始校验
          </button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
