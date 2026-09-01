import React, { useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Archive,
  Check,
  Clock3,
  FileText,
  Filter,
  GitBranch,
  Plus,
  Search,
  Send,
} from "lucide-react";
import { toast } from "sonner";
import {
  HorizonEmptyState,
  HorizonMetric,
  HorizonMetricGrid,
  HorizonPageHeader,
  HorizonSectionHeader,
} from "./components/horizon/HorizonPage";
import { Button } from "./components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
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
  const deferredKeyword = useDeferredValue(keyword);

  const filtered = useMemo(() => {
    return changes.filter((item) => {
      const matchKeyword = !deferredKeyword || [item.id, item.title, item.type, item.owner].join(" ").toLowerCase().includes(deferredKeyword.toLowerCase());
      const matchStatus = status === "全部" || item.status === status;
      const matchImpact = impactFilter === "全部" || item.impact === impactFilter;
      const matchStage = stageFilter === "全部" || item.stage === stageFilter;
      return matchKeyword && matchStatus && matchImpact && matchStage;
    });
  }, [deferredKeyword, impactFilter, stageFilter, status]);

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

  const dialogTitle: Record<Exclude<DialogMode, null>, string> = {
    filter: "高级筛选",
    create: "新建设计变更",
    review: "发起评审",
    impact: "生成影响评估",
    dhf: "导出 DHF 摘要",
    calendar: "安排评审会",
  };

  const dialogDescription: Record<Exclude<DialogMode, null>, string> = {
    filter: "按影响等级与所属阶段缩小变更清单范围。",
    create: "创建一条待提交的 ECO 草稿，后续可继续补充影响项。",
    review: "将所选变更同步给研发、质量和注册进行会签。",
    impact: "基于当前变更生成影响范围与建议动作。",
    dhf: "汇总影响项、版本、会签结果和归档要求。",
    calendar: "为当前变更安排跨部门评审会议。",
  };

  const confirmLabel: Record<Exclude<DialogMode, null>, string> = {
    filter: "应用筛选",
    create: "创建草稿",
    review: "确认发起",
    impact: "确认生成",
    dhf: "导出摘要",
    calendar: "加入日历",
  };

  const handleDialogConfirm = () => {
    if (!dialogMode) return;
    const message: Record<Exclude<DialogMode, null>, string> = {
      filter: "筛选条件已应用",
      create: "新的设计变更草稿已创建",
      review: "评审任务已推送",
      impact: "影响评估已生成",
      dhf: "DHF 摘要已导出",
      calendar: "评审会议已加入日历",
    };
    closeDialog();
    toast.success(message[dialogMode]);
  };

  return (
    <div className="horizon-theme hz-page mx-auto flex min-h-full max-w-[1600px] flex-col gap-4 px-3 py-4 sm:p-5 lg:p-6">
      <HorizonPageHeader
        Icon={GitBranch}
        eyebrow="DESIGN CONTROL · ECO"
        title="设计开发变更"
        description="把 ECO 申请、影响评估、DHF 版本和流转动作集中在一个可追溯工作台。"
        meta={<><span>{changes.length} 条变更</span><span aria-hidden="true">·</span><span>{changes.filter((item) => item.status === "评审中").length} 条正在评审</span></>}
        actions={(
          <>
            <Button type="button" className="hz-primary-action" onClick={() => setDialogMode("create")}><Plus className="size-4" />新建变更</Button>
            <Button type="button" variant="outline" onClick={() => setDialogMode("review")}><Send className="size-4" />发起评审</Button>
          </>
        )}
      />

      <HorizonMetricGrid>
        <HorizonMetric Icon={FileText} label="变更总数" value={changes.length} note="当前变更台账" />
        <HorizonMetric Icon={Clock3} label="评审中" value={changes.filter((item) => item.status === "评审中").length} note="等待跨部门会签" tone="warning" />
        <HorizonMetric Icon={AlertTriangle} label="高影响" value={changes.filter((item) => item.impact === "高").length} note="需要优先完成评估" tone="danger" />
        <HorizonMetric Icon={Archive} label="已完成" value={changes.filter((item) => item.status === "已完成").length} note="DHF 记录可归档" tone="success" />
      </HorizonMetricGrid>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="hz-surface min-w-0 overflow-hidden" aria-label="设计开发变更清单">
          <HorizonSectionHeader Icon={FileText} title="变更清单" description="筛选、勾选并进入当前 ECO 记录" trailing={<span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] text-slate-600 tabular-nums">{filtered.length} 条</span>} />
          <div className="hz-toolbar border-b px-4 py-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex min-w-0 flex-1 gap-2">
                <div className="relative min-w-0 flex-1">
                  <Label htmlFor="design-change-search" className="sr-only">搜索设计变更</Label>
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                  <Input id="design-change-search" value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索 ECO 编号、标题或负责人" className="pl-9" />
                </div>
                <Button type="button" variant="outline" onClick={() => setDialogMode("filter")}><Filter className="size-4" />筛选</Button>
              </div>
              <div className="flex flex-wrap gap-2" aria-label="按状态筛选">
                {["全部", "评审中", "待提交", "已完成"].map((item) => (
                  <Button key={item} type="button" size="sm" variant="outline" aria-pressed={status === item} className={cn("rounded-lg", status === item && "border-[#002fa7] bg-[#eef3ff] text-[#002fa7]")} onClick={() => setStatus(item)}>{item}</Button>
                ))}
              </div>
            </div>
          </div>

          <div className="p-4">
            {selectedCount > 0 ? <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#dce4f8] bg-[#f4f7fe] px-4 py-3 text-sm text-slate-700"><span>已选 <strong className="tabular-nums">{selectedCount}</strong> 条，可批量发起评审或同步 DHF。</span><Button type="button" size="sm" variant="outline" onClick={() => setSelectedRows({})}>清除选择</Button></div> : null}

            {pagedChanges.length > 0 ? (
              <div className="material-scrollbar overflow-x-auto rounded-xl border border-[#e9edf7]">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <caption className="sr-only">设计开发变更清单，包含编号、标题、类型、负责人、影响、状态和版本</caption>
                  <thead className="bg-slate-50 text-xs text-slate-600">
                    <tr>
                      {["选择", "编号", "标题", "状态", "影响", "负责人", "类型", "版本"].map((title) => <th key={title} scope="col" className="px-4 py-3 font-semibold">{title}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e9edf7]">
                    {pagedChanges.map((item) => {
                      const active = selected?.id === item.id;
                      return (
                        <tr key={item.id} aria-selected={active} className={cn("hover:bg-slate-50", active && "bg-[#f4f7fe]")}>
                          <td className="px-4 py-3">
                            <button type="button" aria-label={`${selectedRows[item.id] ? "取消选择" : "选择"} ${item.id}`} aria-pressed={Boolean(selectedRows[item.id])} onClick={() => toggleRow(item.id)} className={cn("flex size-8 items-center justify-center rounded-lg border transition-colors", selectedRows[item.id] ? "border-[#002fa7] bg-[#002fa7] text-white" : "border-slate-200 bg-white text-slate-500 hover:border-[#002fa7]")}>{selectedRows[item.id] ? <Check className="size-4" /> : <Plus className="size-4" />}</button>
                          </td>
                          <td className="px-4 py-3"><button type="button" aria-current={active ? "true" : undefined} aria-label={`查看 ${item.id} ${item.title}`} onClick={() => setSelectedId(item.id)} className="font-semibold text-[#1b2559] underline-offset-4 hover:text-[#002fa7] hover:underline tabular-nums">{item.id}</button></td>
                          <td className="max-w-[18rem] px-4 py-3 font-medium text-slate-800"><span className="line-clamp-2">{item.title}</span></td>
                          <td className="px-4 py-3"><span className={cn("rounded-full px-2 py-1 text-xs font-semibold", statusTone[item.status])}>{item.status}</span></td>
                          <td className="px-4 py-3"><span className={cn("rounded-full px-2 py-1 text-xs font-semibold", impactTone[item.impact])}>{item.impact}</span></td>
                          <td className="px-4 py-3 text-slate-600">{item.owner}</td>
                          <td className="px-4 py-3 text-slate-600">{item.type}</td>
                          <td className="px-4 py-3 text-slate-600 tabular-nums">{item.version}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <HorizonEmptyState Icon={Search} title="没有匹配的变更记录" description="调整搜索词或清除筛选条件后重试。" action={<Button type="button" variant="outline" onClick={() => { setKeyword(""); setStatus("全部"); setImpactFilter("全部"); setStageFilter("全部"); }}>清除筛选</Button>} />
            )}

            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-slate-500 tabular-nums">共 {filtered.length} 条 · 第 {page}/{totalPages} 页</div>
              <div className="flex gap-2"><Button type="button" size="sm" variant="outline" onClick={() => setPage((prev) => Math.max(1, prev - 1))} disabled={page === 1}>上一页</Button><Button type="button" size="sm" variant="outline" onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))} disabled={page === totalPages}>下一页</Button></div>
            </div>
          </div>
        </section>

        <aside className="hz-surface min-w-0 overflow-hidden" aria-label="当前设计变更">
          <HorizonSectionHeader Icon={GitBranch} title="当前变更" description="影响范围与下一步动作" />
          {selected ? (
            <div className="space-y-4 p-4">
              <div className="rounded-xl border border-[#dce4f8] bg-[#f4f7fe] p-4">
                <div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-[#002fa7] tabular-nums">{selected.id}</span><span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", statusTone[selected.status])}>{selected.status}</span></div>
                <h2 className="mt-2 text-balance text-base font-semibold text-[#1b2559]">{selected.title}</h2>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-xs text-slate-500">负责人</dt><dd className="mt-1 font-medium text-slate-800">{selected.owner}</dd></div><div><dt className="text-xs text-slate-500">版本</dt><dd className="mt-1 font-medium text-slate-800 tabular-nums">{selected.version}</dd></div><div><dt className="text-xs text-slate-500">所属阶段</dt><dd className="mt-1 font-medium text-slate-800">{selected.stage}</dd></div><div><dt className="text-xs text-slate-500">申请日期</dt><dd className="mt-1 font-medium text-slate-800 tabular-nums">{selected.date}</dd></div></dl>
              </div>
              <dl className="divide-y divide-[#e9edf7] rounded-xl border border-[#e9edf7] px-4">
                {[
                  ["影响评估", "涉及电源主板、验证报告和说明书同步。"],
                  ["会签部门", "研发、质量、注册"],
                  ["下一步", "完成评审后同步到 BOM 与 DMS"],
                ].map(([label, value]) => <div key={label} className="py-3"><dt className="text-xs font-semibold text-slate-500">{label}</dt><dd className="mt-1 text-pretty text-sm leading-6 text-slate-700">{value}</dd></div>)}
              </dl>
              <div className="space-y-2"><Button type="button" className="hz-primary-action w-full" onClick={() => setDialogMode("impact")}><GitBranch className="size-4" />生成影响评估</Button><Button type="button" variant="outline" className="w-full" onClick={() => setDialogMode("dhf")}><FileText className="size-4" />导出 DHF 摘要</Button><Button type="button" variant="outline" className="w-full" onClick={() => setDialogMode("calendar")}><Clock3 className="size-4" />安排评审会</Button></div>
            </div>
          ) : <HorizonEmptyState Icon={FileText} title="请选择一条变更" description="从左侧清单选择 ECO 后查看影响范围。" />}
        </aside>
      </div>

      <Dialog open={dialogMode !== null} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="horizon-portal gap-0 overflow-hidden p-0 sm:max-w-lg">
          {dialogMode ? (
            <>
              <DialogHeader className="border-b border-[#e9edf7] px-5 py-4 text-left"><DialogTitle className="text-balance text-[#1b2559]">{dialogTitle[dialogMode]}</DialogTitle><DialogDescription className="text-pretty">{dialogDescription[dialogMode]}</DialogDescription></DialogHeader>
              <div className="px-5 py-5">
                {dialogMode === "filter" ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5"><Label htmlFor="design-impact-filter">影响等级</Label><select id="design-impact-filter" className="material-input" value={impactFilter} onChange={(event) => setImpactFilter(event.target.value)}>{["全部", "高", "中", "低"].map((item) => <option key={item}>{item}</option>)}</select></div>
                    <div className="space-y-1.5"><Label htmlFor="design-stage-filter">所属阶段</Label><select id="design-stage-filter" className="material-input" value={stageFilter} onChange={(event) => setStageFilter(event.target.value)}>{["全部", "研发", "验证", "结构", "软件", "注册"].map((item) => <option key={item}>{item}</option>)}</select></div>
                  </div>
                ) : dialogMode === "create" ? (
                  <dl className="grid gap-3 rounded-xl bg-[#f4f7fe] p-4 text-sm"><div><dt className="text-xs text-slate-500">默认标题</dt><dd className="mt-1 font-medium text-slate-800">压缩机启动阈值优化</dd></div><div><dt className="text-xs text-slate-500">默认负责人</dt><dd className="mt-1 font-medium text-slate-800">王宁</dd></div><div><dt className="text-xs text-slate-500">初始状态</dt><dd className="mt-1 font-medium text-slate-800">待提交</dd></div></dl>
                ) : dialogMode === "review" ? (
                  <div className="space-y-3"><p className="text-pretty text-sm leading-6 text-slate-700">已选择 <strong className="tabular-nums">{selectedCount || 1}</strong> 条变更单，准备同步给研发、质量和注册进行会签。</p><div className="rounded-xl border border-[#dce4f8] bg-[#f4f7fe] p-3 text-sm text-slate-700">预计 2 个工作日内完成；完成后自动回写 DHF 版本记录。</div></div>
                ) : dialogMode === "impact" ? (
                  <dl className="grid gap-3 text-sm"><div><dt className="text-xs text-slate-500">预计影响</dt><dd className="mt-1 text-slate-800">BOM、验证方案、IFU 说明书</dd></div><div><dt className="text-xs text-slate-500">风险等级</dt><dd className="mt-1 text-slate-800">{selected?.impact ?? "中"}</dd></div><div><dt className="text-xs text-slate-500">建议动作</dt><dd className="mt-1 text-slate-800">补充验证，并同步注册评估</dd></div></dl>
                ) : dialogMode === "dhf" ? (
                  <p className="text-pretty text-sm leading-7 text-slate-700">将导出当前变更对应的影响项、版本号、会签结果和归档要求，方便归档或注册审阅。</p>
                ) : (
                  <dl className="grid gap-3 text-sm"><div><dt className="text-xs text-slate-500">会议主题</dt><dd className="mt-1 text-slate-800">{selected?.id ?? "ECO"} 设计变更评审</dd></div><div><dt className="text-xs text-slate-500">默认参会</dt><dd className="mt-1 text-slate-800">研发、质量、注册</dd></div><div><dt className="text-xs text-slate-500">建议时间</dt><dd className="mt-1 text-slate-800 tabular-nums">2026-04-18 14:00</dd></div></dl>
                )}
              </div>
              <DialogFooter className="border-t border-[#e9edf7] bg-slate-50 px-5 py-4">
                {dialogMode === "filter" ? <Button type="button" variant="outline" onClick={() => { setImpactFilter("全部"); setStageFilter("全部"); }}>重置</Button> : <Button type="button" variant="outline" onClick={closeDialog}>取消</Button>}
                <Button type="button" className="hz-primary-action" onClick={handleDialogConfirm}>{confirmLabel[dialogMode]}</Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
