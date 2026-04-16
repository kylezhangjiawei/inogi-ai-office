import React, { useEffect, useMemo, useState } from "react";
import { Clock3, FileText, Filter, GitBranch, Plus, Send } from "lucide-react";
import { Dialog, DialogActions, DialogContent, DialogTitle } from "@mui/material";
import { toast } from "sonner";
import { cn } from "./components/ui/utils";

const changes = [
  { id: "ECO-2416", title: "主板供电保护逻辑修订", type: "电气设计", owner: "王宁", impact: "高", version: "DHF-2.4", status: "评审中", date: "2026-04-16", stage: "研发" },
  { id: "ECO-2412", title: "流量传感器测试规范更新", type: "验证文件", owner: "陈序", impact: "中", version: "VR-1.8", status: "待提交", date: "2026-04-14", stage: "验证" },
  { id: "ECO-2409", title: "外壳卡扣公差优化", type: "结构设计", owner: "刘敏", impact: "中", version: "ME-3.1", status: "已完成", date: "2026-04-12", stage: "结构" },
  { id: "ECO-2403", title: "报警阈值默认参数调整", type: "软件配置", owner: "韩青", impact: "高", version: "SW-5.0", status: "评审中", date: "2026-04-10", stage: "软件" },
  { id: "ECO-2398", title: "关键原材料替代说明补录", type: "风险评估", owner: "李成", impact: "低", version: "RM-1.4", status: "已完成", date: "2026-04-08", stage: "注册" },
  { id: "ECO-2394", title: "标签版式统一到 CE 版本", type: "外部资料", owner: "周月", impact: "低", version: "LAB-1.5", status: "待提交", date: "2026-04-05", stage: "注册" },
];

const impactTone: Record<string, string> = {
  高: "bg-rose-50 text-rose-700",
  中: "bg-sky-50 text-sky-700",
  低: "bg-emerald-50 text-emerald-700",
};

const statusTone: Record<string, string> = {
  评审中: "bg-amber-50 text-amber-700",
  待提交: "bg-blue-50 text-blue-700",
  已完成: "bg-emerald-50 text-emerald-700",
};

const pageSize = 4;

type DialogMode = "filter" | "create" | "review" | "impact" | "dhf" | "calendar" | null;

export function DesignChangesPage() {
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState("全部");
  const [impactFilter, setImpactFilter] = useState("全部");
  const [stageFilter, setStageFilter] = useState("全部");
  const [selectedId, setSelectedId] = useState(changes[0].id);
  const [selectedRows, setSelectedRows] = useState<Record<string, boolean>>({});
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    return changes.filter((item) => {
      const matchKeyword = !keyword || [item.id, item.title, item.type, item.owner].join(" ").toLowerCase().includes(keyword.toLowerCase());
      const matchStatus = status === "全部" || item.status === status;
      const matchImpact = impactFilter === "全部" || item.impact === impactFilter;
      const matchStage = stageFilter === "全部" || item.stage === stageFilter;
      return matchKeyword && matchStatus && matchImpact && matchStage;
    });
  }, [impactFilter, keyword, stageFilter, status]);

  useEffect(() => {
    setPage(1);
  }, [keyword, status, impactFilter, stageFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pagedChanges = filtered.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    if (!filtered.some((item) => item.id === selectedId) && filtered[0]) {
      setSelectedId(filtered[0].id);
    }
  }, [filtered, selectedId]);

  const selected = filtered.find((item) => item.id === selectedId) ?? filtered[0] ?? null;
  const selectedCount = Object.values(selectedRows).filter(Boolean).length;

  const toggleRow = (id: string) => {
    setSelectedRows((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const closeDialog = () => setDialogMode(null);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="material-card p-6 md:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <span className="material-chip bg-blue-50 text-blue-700">DHF Workspace</span>
            <h2 className="mt-3 text-[2rem] font-bold tracking-tight text-slate-900">设计开发变更</h2>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">把 ECO 申请、影响评估、DHF 版本和流转动作放在一页里，方便研发、质量和注册一起跟踪。</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={() => setDialogMode("create")} className="material-button-primary">
              <Plus className="h-4 w-4" />
              新建变更
            </button>
            <button type="button" onClick={() => setDialogMode("review")} className="material-button-secondary">
              <Send className="h-4 w-4" />
              发起评审
            </button>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
        {[
          ["本月变更", "18", "高影响 3 项"],
          ["待评审", "6", "跨部门会签"],
          ["已归档", "12", "DHF 已同步"],
          ["待补材料", "2", "需注册确认"],
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
            <div className="flex flex-1 items-center gap-3">
              <div className="relative flex-1">
                <input
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  placeholder="搜索 ECO 编号、标题、负责人"
                  className="material-input"
                />
              </div>
              <button type="button" className="material-button-secondary" onClick={() => setDialogMode("filter")}>
                <Filter className="h-4 w-4" />
                筛选
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {["全部", "评审中", "待提交", "已完成"].map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setStatus(item)}
                  className={cn(
                    "rounded-full border px-4 py-2 text-sm font-semibold transition",
                    status === item ? "border-blue-200 bg-blue-50 text-primary" : "border-slate-200 bg-white text-slate-500",
                  )}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          {selectedCount > 0 ? (
            <div className="mb-4 rounded-[22px] border border-blue-100 bg-blue-50/60 p-4 text-sm text-slate-700">
              已选 {selectedCount} 条，可批量发起评审或同步 DHF。
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-[24px] border border-slate-100">
            <table className="min-w-full text-left">
              <thead className="bg-slate-50">
                <tr>
                  {["选择", "编号", "标题", "类型", "负责人", "影响", "状态", "版本"].map((title) => (
                    <th key={title} className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                      {title}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pagedChanges.map((item) => (
                  <tr key={item.id} className="cursor-pointer hover:bg-slate-50/70" onClick={() => setSelectedId(item.id)}>
                    <td className="px-4 py-3" onClick={(event) => event.stopPropagation()}>
                      <button type="button" onClick={() => toggleRow(item.id)} className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 text-slate-500">
                        {selectedRows[item.id] ? "✓" : "+"}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-sm font-semibold text-slate-700">{item.id}</td>
                    <td className="px-4 py-3 text-sm text-slate-700">{item.title}</td>
                    <td className="px-4 py-3 text-sm text-slate-500">{item.type}</td>
                    <td className="px-4 py-3 text-sm text-slate-500">{item.owner}</td>
                    <td className="px-4 py-3">
                      <span className={cn("material-chip", impactTone[item.impact])}>{item.impact}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("material-chip", statusTone[item.status])}>{item.status}</span>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-500">{item.version}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
            <h3 className="text-slate-900">变更详情</h3>
            {selected ? (
              <div className="mt-4 space-y-4">
                <div className="rounded-[24px] bg-[linear-gradient(135deg,#edf5ff_0%,#ffffff_58%,#eef9f7_100%)] p-5">
                  <div className="text-lg font-semibold text-slate-900">{selected.title}</div>
                  <div className="mt-3 space-y-2 text-sm text-slate-600">
                    <div>编号：{selected.id}</div>
                    <div>负责人：{selected.owner}</div>
                    <div>日期：{selected.date}</div>
                    <div>版本：{selected.version}</div>
                  </div>
                </div>
                <div className="grid gap-3">
                  {[
                    ["影响评估", "涉及电源主板、验证报告和说明书同步。"],
                    ["会签部门", "研发、质量、注册"],
                    ["下一步", "完成评审后同步到 BOM 与 DMS"],
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
              <button type="button" onClick={() => setDialogMode("impact")} className="material-button-primary w-full justify-center">
                <GitBranch className="h-4 w-4" />
                生成影响评估
              </button>
              <button type="button" onClick={() => setDialogMode("dhf")} className="material-button-secondary w-full justify-center">
                <FileText className="h-4 w-4" />
                导出 DHF 摘要
              </button>
              <button type="button" onClick={() => setDialogMode("calendar")} className="material-button-secondary w-full justify-center">
                <Clock3 className="h-4 w-4" />
                安排评审会
              </button>
            </div>
          </section>
        </aside>
      </section>

      <Dialog open={dialogMode === "filter"} onClose={closeDialog} fullWidth maxWidth="sm">
        <DialogTitle>高级筛选</DialogTitle>
        <DialogContent dividers>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2 text-sm text-slate-600">
              <span>影响等级</span>
              <select className="material-input" value={impactFilter} onChange={(event) => setImpactFilter(event.target.value)}>
                {["全部", "高", "中", "低"].map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label className="space-y-2 text-sm text-slate-600">
              <span>所属阶段</span>
              <select className="material-input" value={stageFilter} onChange={(event) => setStageFilter(event.target.value)}>
                {["全部", "研发", "验证", "结构", "软件", "注册"].map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
          </div>
        </DialogContent>
        <DialogActions>
          <button
            type="button"
            className="material-button-secondary"
            onClick={() => {
              setImpactFilter("全部");
              setStageFilter("全部");
              toast.success("筛选条件已重置");
            }}
          >
            重置
          </button>
          <button type="button" className="material-button-primary" onClick={closeDialog}>
            完成
          </button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialogMode === "create"} onClose={closeDialog} fullWidth maxWidth="sm">
        <DialogTitle>新建设计变更</DialogTitle>
        <DialogContent dividers>
          <div className="space-y-4 text-sm text-slate-600">
            <p>这里先补上演示流程需要的创建弹窗，确认后会生成一条待提交的 ECO 草稿。</p>
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
              <div>默认标题：压缩机启动阈值优化</div>
              <div className="mt-2">默认负责人：王宁</div>
              <div className="mt-2">默认状态：待提交</div>
            </div>
          </div>
        </DialogContent>
        <DialogActions>
          <button type="button" className="material-button-secondary" onClick={closeDialog}>
            取消
          </button>
          <button
            type="button"
            className="material-button-primary"
            onClick={() => {
              closeDialog();
              toast.success("新的设计变更草稿已创建");
            }}
          >
            创建草稿
          </button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialogMode === "review"} onClose={closeDialog} fullWidth maxWidth="sm">
        <DialogTitle>发起评审</DialogTitle>
        <DialogContent dividers>
          <div className="space-y-3 text-sm text-slate-600">
            <p>已选择 {selectedCount || 1} 条变更单，准备同步给研发、质量和注册进行会签。</p>
            <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4 text-slate-700">会签预计在 2 个工作日内完成，完成后将自动回写 DHF 版本记录。</div>
          </div>
        </DialogContent>
        <DialogActions>
          <button type="button" className="material-button-secondary" onClick={closeDialog}>
            取消
          </button>
          <button
            type="button"
            className="material-button-primary"
            onClick={() => {
              closeDialog();
              toast.success("评审任务已推送");
            }}
          >
            确认发起
          </button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialogMode === "impact"} onClose={closeDialog} fullWidth maxWidth="sm">
        <DialogTitle>影响评估</DialogTitle>
        <DialogContent dividers>
          <div className="space-y-2 text-sm text-slate-600">
            <div>预计影响：BOM、验证方案、IFU 说明书</div>
            <div>风险等级：{selected?.impact ?? "中"}</div>
            <div>建议动作：补充验证 + 注册同步评估</div>
          </div>
        </DialogContent>
        <DialogActions>
          <button type="button" className="material-button-secondary" onClick={closeDialog}>
            关闭
          </button>
          <button
            type="button"
            className="material-button-primary"
            onClick={() => {
              closeDialog();
              toast.success("影响评估已生成");
            }}
          >
            确认生成
          </button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialogMode === "dhf"} onClose={closeDialog} fullWidth maxWidth="sm">
        <DialogTitle>DHF 摘要导出</DialogTitle>
        <DialogContent dividers>
          <p className="text-sm leading-7 text-slate-600">将导出当前变更对应的影响项、版本号、会签结果和归档要求，方便归档或注册审阅。</p>
        </DialogContent>
        <DialogActions>
          <button type="button" className="material-button-secondary" onClick={closeDialog}>
            关闭
          </button>
          <button
            type="button"
            className="material-button-primary"
            onClick={() => {
              closeDialog();
              toast.success("DHF 摘要已导出");
            }}
          >
            导出
          </button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialogMode === "calendar"} onClose={closeDialog} fullWidth maxWidth="sm">
        <DialogTitle>安排评审会</DialogTitle>
        <DialogContent dividers>
          <div className="space-y-2 text-sm text-slate-600">
            <div>会议主题：{selected?.id ?? "ECO"} 设计变更评审</div>
            <div>默认参会：研发、质量、注册</div>
            <div>建议时间：2026-04-18 14:00</div>
          </div>
        </DialogContent>
        <DialogActions>
          <button type="button" className="material-button-secondary" onClick={closeDialog}>
            取消
          </button>
          <button
            type="button"
            className="material-button-primary"
            onClick={() => {
              closeDialog();
              toast.success("评审会议已加入日历");
            }}
          >
            加入日历
          </button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
