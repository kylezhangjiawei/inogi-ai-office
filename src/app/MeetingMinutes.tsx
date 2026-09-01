import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  Calendar,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  Edit3,
  FileText,
  History,
  ListChecks,
  NotebookPen,
  Plus,
  Search,
  Send,
  Share2,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import {
  HorizonEmptyState,
  HorizonMetric,
  HorizonMetricGrid,
  HorizonPageHeader,
  HorizonSectionHeader,
} from "./components/horizon/HorizonPage";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./components/ui/alert-dialog";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { cn } from "./components/ui/utils";

const steps = [
  { id: 1, label: "输入内容" },
  { id: 2, label: "AI 生成" },
  { id: 3, label: "确认发布" },
];

const initialActions = [
  { id: 1, action: "联系墨西哥客户确认演示排期", owner: "张明", deadline: "2026-04-18", status: "待开始", statusColor: "border-blue-100 bg-blue-50 text-[#002fa7]" },
  { id: 2, action: "完成售后工单系统 UI 评审", owner: "研发团队", deadline: "2026-04-20", status: "进行中", statusColor: "border-orange-100 bg-orange-50 text-orange-700" },
  { id: 3, action: "补充 FDA 510(k) 资料清单", owner: "RA 专员李华", deadline: "2026-04-30", status: "待开始", statusColor: "border-blue-100 bg-blue-50 text-[#002fa7]" },
  { id: 4, action: "整理 Q1 销售数据并汇报", owner: "销售总监", deadline: "2026-04-12", status: "已完成", statusColor: "border-green-100 bg-green-50 text-green-700" },
  { id: 5, action: "确认越南市场合作条款修订", owner: "法务顾问", deadline: "2026-04-22", status: "进行中", statusColor: "border-orange-100 bg-orange-50 text-orange-700" },
  { id: 6, action: "输出客户培训资料目录", owner: "销售市场部", deadline: "2026-04-25", status: "待开始", statusColor: "border-blue-100 bg-blue-50 text-[#002fa7]" },
];

const initialConclusions = [
  "决定 Q2 重点推进墨西哥市场，目标新增 3 家分销商。",
  "售后工单系统 MVP 计划 5 月 5 日前上线。",
  "认证资料需在 4 月 20 日前完成 FDA 文件补充。",
];

const attendees = ["张明", "王芳", "李华", "陈工", "刘敏", "赵倩"];
const meetingHistory = [
  { date: "2026-04-16", title: "市场部周会", note: "AI 摘要已生成，6 项行动待跟进", active: true },
  { date: "2026-04-09", title: "市场部周会", note: "墨西哥客户名单与资料准备", active: false },
  { date: "2026-04-02", title: "Q2 市场启动会", note: "确认季度目标与渠道分工", active: false },
];
const pageSize = 3;
const selectClassName = "h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus-visible:border-[#002fa7] focus-visible:ring-2 focus-visible:ring-[#002fa7]/20";

export function MeetingMinutes() {
  const [currentStep] = useState(2);
  const [editingConclusion, setEditingConclusion] = useState<number | null>(null);
  const [conclusionTexts, setConclusionTexts] = useState(initialConclusions);
  const [actions, setActions] = useState(initialActions);
  const [addingAction, setAddingAction] = useState(false);
  const [newAction, setNewAction] = useState({ action: "", owner: "", deadline: "", status: "待开始" });
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState("全部");
  const [page, setPage] = useState(1);
  const [selectedActionId, setSelectedActionId] = useState<number | null>(initialActions[0].id);
  const [deleteActionId, setDeleteActionId] = useState<number | null>(null);

  const filteredActions = useMemo(() => actions.filter((item) => {
    const matchKeyword = !keyword || [item.action, item.owner, item.deadline].join(" ").toLowerCase().includes(keyword.toLowerCase());
    const matchStatus = statusFilter === "全部" || item.status === statusFilter;
    return matchKeyword && matchStatus;
  }), [actions, keyword, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredActions.length / pageSize));
  const pagedActions = filteredActions.slice((page - 1) * pageSize, page * pageSize);
  const selectedAction = actions.find((item) => item.id === selectedActionId) ?? null;
  const actionToDelete = actions.find((item) => item.id === deleteActionId) ?? null;
  const completedCount = actions.filter((item) => item.status === "已完成").length;
  const inProgressCount = actions.filter((item) => item.status === "进行中").length;

  const handleAddAction = () => {
    const errors: Record<string, string> = {};
    if (!newAction.action.trim()) errors.action = "请输入行动项描述";
    if (!newAction.owner.trim()) errors.owner = "请输入负责人";
    if (!newAction.deadline) errors.deadline = "请选择截止日期";
    if (Object.keys(errors).length > 0) {
      setActionErrors(errors);
      toast.error("请补全行动项、负责人和截止日期");
      return;
    }
    const created = {
      ...newAction,
      id: Math.max(0, ...actions.map((item) => item.id)) + 1,
      statusColor: newAction.status === "已完成" ? "border-green-100 bg-green-50 text-green-700" : newAction.status === "进行中" ? "border-orange-100 bg-orange-50 text-orange-700" : "border-blue-100 bg-blue-50 text-[#002fa7]",
    };
    setActions((prev) => [...prev, created]);
    setSelectedActionId(created.id);
    setNewAction({ action: "", owner: "", deadline: "", status: "待开始" });
    setActionErrors({});
    setAddingAction(false);
    setPage(Math.max(1, Math.ceil((filteredActions.length + 1) / pageSize)));
    toast.success("行动项已添加");
  };

  const handleDeleteAction = (id: number) => {
    setActions((prev) => prev.filter((item) => item.id !== id));
    if (selectedActionId === id) setSelectedActionId(null);
    setDeleteActionId(null);
    toast.success("行动项已删除");
  };

  const handleStatusChange = (id: number) => {
    setActions((prev) => prev.map((item) => {
      if (item.id !== id) return item;
      if (item.status === "待开始") return { ...item, status: "进行中", statusColor: "border-orange-100 bg-orange-50 text-orange-700" };
      if (item.status === "进行中") return { ...item, status: "已完成", statusColor: "border-green-100 bg-green-50 text-green-700" };
      return { ...item, status: "待开始", statusColor: "border-blue-100 bg-blue-50 text-[#002fa7]" };
    }));
    toast.success("行动项状态已切换");
  };

  const changeFilter = (nextFilter: string) => { setStatusFilter(nextFilter); setPage(1); };
  const resetActionFilters = () => { setKeyword(""); setStatusFilter("全部"); setPage(1); };

  return (
    <div className="horizon-theme hz-page mx-auto flex min-h-full max-w-[1600px] min-w-0 flex-col gap-4 px-3 py-4 sm:p-5 lg:p-6">
      <HorizonPageHeader
        Icon={NotebookPen}
        eyebrow="协同办公 · 会议工作台"
        title="会议纪要与行动追踪"
        description="从会议转写中提炼结论、分派行动项，并持续跟踪历史会议与交付状态。"
        meta={<><span>市场部周会</span><span aria-hidden="true">·</span><span>2026-04-16 14:00</span><span aria-hidden="true">·</span><span>转写 3,240 字</span></>}
        actions={<><Button type="button" variant="outline" onClick={() => toast.success("原始转写内容已重新打开")}><Edit3 className="size-4" />重新编辑转写</Button><Button type="button" className="hz-primary-action" onClick={() => toast.success("行动项已推送给各负责人")}><Send className="size-4" />推送行动项</Button></>}
      />

      <HorizonMetricGrid>
        <HorizonMetric Icon={ListChecks} label="行动项" value={actions.length} note="当前会议提炼结果" tone="brand" />
        <HorizonMetric Icon={Sparkles} label="进行中" value={inProgressCount} note="需要持续跟进" tone="warning" />
        <HorizonMetric Icon={CheckCircle2} label="已完成" value={completedCount} note="已闭环行动项" tone="success" />
        <HorizonMetric Icon={Users} label="参会人员" value={attendees.length} note="市场、销售、研发与 RA" tone="neutral" />
      </HorizonMetricGrid>

      <section className="hz-surface min-w-0 overflow-hidden">
        <HorizonSectionHeader Icon={Sparkles} title="会议录入与 AI 提炼" description="当前处于 AI 生成阶段，确认后可发布纪要。" trailing={<Button type="button" variant="ghost" size="sm" onClick={() => toast.success("原始转写内容已重新打开")}>查看原始转写</Button>} />
        <ol className="grid min-w-[480px] grid-cols-3 overflow-x-auto px-4 py-3" aria-label="会议纪要处理步骤">
          {steps.map((step, index) => <li key={step.id} className="relative flex items-center gap-3 after:absolute after:left-[calc(50%+1.5rem)] after:right-[calc(-50%+1.5rem)] after:top-1/2 after:h-px after:bg-slate-200 last:after:hidden"><span className={cn("relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border bg-white text-xs font-semibold tabular-nums", currentStep >= step.id ? "border-[#002fa7] text-[#002fa7]" : "border-slate-200 text-slate-400")} aria-hidden="true">{currentStep > step.id ? <Check className="size-4" /> : step.id}</span><span className={cn("relative z-10 bg-white pr-2 text-sm font-semibold", currentStep >= step.id ? "text-slate-800" : "text-slate-400")}>{step.label}</span></li>)}
        </ol>
      </section>

      <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <main className="hz-surface min-w-0 overflow-hidden">
          <HorizonSectionHeader
            Icon={Sparkles}
            title="AI 生成纪要"
            description="会议结论、行动项、参会人员与下次会议安排。"
            trailing={<div className="flex gap-1"><Button type="button" variant="ghost" size="icon" aria-label="编辑会议纪要" onClick={() => toast.success("纪要进入编辑模式")}><Edit3 className="size-4" /></Button><Button type="button" variant="ghost" size="icon" aria-label="导出会议纪要文档" onClick={() => toast.info("正在导出文档…")}><Download className="size-4" /></Button></div>}
          />

          <section className="border-b border-slate-100 p-4 sm:p-5" aria-labelledby="meeting-conclusions">
            <h2 id="meeting-conclusions" className="text-balance text-sm font-semibold text-slate-800">会议结论</h2>
            <ol className="mt-3 space-y-2">
              {conclusionTexts.map((item, index) => <li key={index} className="group grid grid-cols-[24px_minmax(0,1fr)_32px] items-start gap-2"><span className="flex size-6 items-center justify-center rounded-full bg-[#eef3ff] text-xs font-semibold text-[#002fa7] tabular-nums" aria-hidden="true">{index + 1}</span>{editingConclusion === index ? <Input autoFocus value={item} onChange={(event) => setConclusionTexts((current) => current.map((value, itemIndex) => itemIndex === index ? event.target.value : value))} onBlur={() => setEditingConclusion(null)} aria-label={`编辑会议结论 ${index + 1}`} className="h-9 rounded-lg" /> : <button type="button" className="min-w-0 rounded-lg px-2 py-1 text-left text-sm text-pretty leading-6 text-slate-700 hover:bg-slate-50" onDoubleClick={() => setEditingConclusion(index)} onClick={() => setEditingConclusion(index)}>{item}</button>}<Button type="button" variant="ghost" size="icon" aria-label={`编辑会议结论 ${index + 1}`} onClick={() => setEditingConclusion(index)}><Edit3 className="size-3.5" /></Button></li>)}
            </ol>
          </section>

          <section className="border-b border-slate-100" aria-labelledby="meeting-actions">
            <div className="px-4 pt-4 sm:px-5 sm:pt-5"><div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between"><div><h2 id="meeting-actions" className="text-balance text-sm font-semibold text-slate-800">行动项</h2><p className="mt-1 text-xs text-slate-500 tabular-nums">当前筛选 {filteredActions.length} 条</p></div><div className="flex min-w-0 flex-col gap-2 sm:flex-row"><div className="relative min-w-0 flex-1 sm:w-56"><Label htmlFor="meeting-action-search" className="sr-only">搜索行动项或负责人</Label><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" /><Input id="meeting-action-search" type="search" value={keyword} onChange={(event) => { setKeyword(event.target.value); setPage(1); }} placeholder="行动项或负责人" className="h-9 rounded-xl pl-9" /></div><div className="flex flex-wrap gap-1.5">{["全部", "待开始", "进行中", "已完成"].map((item) => <Button key={item} type="button" size="sm" variant={statusFilter === item ? "default" : "outline"} aria-pressed={statusFilter === item} className={cn(statusFilter === item && "bg-[#002fa7] hover:bg-[#002581]")} onClick={() => changeFilter(item)}>{item}</Button>)}</div></div></div></div>

            <div className="mt-4 min-w-0 overflow-x-auto border-y border-slate-100">
              <table className="w-full min-w-[760px] text-left">
                <thead className="bg-slate-50/80"><tr>{["#", "行动项", "负责人", "截止", "状态", "操作"].map((title) => <th key={title} scope="col" className="px-4 py-3 text-xs font-semibold text-slate-500">{title}</th>)}</tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {pagedActions.map((item) => <tr key={item.id} className={cn("hover:bg-[#f7f9ff]", selectedActionId === item.id && "bg-blue-50/50")}><td className="px-4 py-3 font-mono text-xs text-slate-500 tabular-nums">{item.id}</td><td className="max-w-80 px-4 py-3"><button type="button" className="block w-full truncate text-left text-sm font-medium text-slate-800 hover:text-[#002fa7]" onClick={() => setSelectedActionId(item.id)} title={item.action}>{item.action}</button></td><td className="whitespace-nowrap px-4 py-3 text-xs text-slate-600">{item.owner}</td><td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-600 tabular-nums">{item.deadline}</td><td className="px-4 py-3"><button type="button" className={cn("rounded-full border px-2.5 py-1 text-xs font-semibold", item.statusColor)} onClick={() => handleStatusChange(item.id)}>{item.status}</button></td><td className="px-4 py-3"><Button type="button" variant="ghost" size="icon" aria-label={`删除行动项 ${item.action}`} onClick={() => setDeleteActionId(item.id)}><Trash2 className="size-4 text-red-500" /></Button></td></tr>)}
                  {pagedActions.length === 0 ? <tr><td colSpan={6}><HorizonEmptyState Icon={Search} title="没有匹配行动项" description="调整搜索词或恢复全部状态。" action={<Button type="button" variant="outline" size="sm" onClick={resetActionFilters}>清除筛选</Button>} /></td></tr> : null}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5"><span className="text-xs text-slate-500 tabular-nums">第 {page} / {totalPages} 页</span><div className="flex gap-2"><Button type="button" variant="outline" size="icon" aria-label="上一页行动项" disabled={page === 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><ChevronLeft className="size-4" /></Button><Button type="button" variant="outline" size="icon" aria-label="下一页行动项" disabled={page === totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}><ChevronRight className="size-4" /></Button></div></div>

            {addingAction ? <div className="border-t border-blue-100 bg-blue-50/40 p-4 sm:p-5"><div className="grid gap-4 md:grid-cols-2"><FormField label="行动项描述" htmlFor="new-meeting-action" error={actionErrors.action}><Input id="new-meeting-action" value={newAction.action} onChange={(event) => { setNewAction((prev) => ({ ...prev, action: event.target.value })); if (actionErrors.action) setActionErrors((current) => ({ ...current, action: "" })); }} aria-invalid={Boolean(actionErrors.action)} className="h-10 rounded-xl" /></FormField><FormField label="负责人" htmlFor="new-meeting-owner" error={actionErrors.owner}><Input id="new-meeting-owner" value={newAction.owner} onChange={(event) => { setNewAction((prev) => ({ ...prev, owner: event.target.value })); if (actionErrors.owner) setActionErrors((current) => ({ ...current, owner: "" })); }} aria-invalid={Boolean(actionErrors.owner)} className="h-10 rounded-xl" /></FormField><FormField label="截止日期" htmlFor="new-meeting-deadline" error={actionErrors.deadline}><Input id="new-meeting-deadline" type="date" value={newAction.deadline} onChange={(event) => { setNewAction((prev) => ({ ...prev, deadline: event.target.value })); if (actionErrors.deadline) setActionErrors((current) => ({ ...current, deadline: "" })); }} aria-invalid={Boolean(actionErrors.deadline)} className="h-10 rounded-xl tabular-nums" /></FormField><div className="space-y-2"><Label htmlFor="new-meeting-status">初始状态</Label><select id="new-meeting-status" value={newAction.status} onChange={(event) => setNewAction((prev) => ({ ...prev, status: event.target.value }))} className={selectClassName}><option value="待开始">待开始</option><option value="进行中">进行中</option><option value="已完成">已完成</option></select></div></div><div className="mt-4 flex gap-2"><Button type="button" className="bg-[#002fa7] hover:bg-[#002581]" onClick={handleAddAction}>确认添加</Button><Button type="button" variant="outline" onClick={() => { setAddingAction(false); setActionErrors({}); }}>取消</Button></div></div> : null}

            <div className="px-4 pb-4 sm:px-5 sm:pb-5"><Button type="button" variant="ghost" size="sm" className="mt-2 text-[#002fa7]" onClick={() => setAddingAction((current) => !current)}><Plus className="size-4" />添加行动项</Button></div>
          </section>

          <div className="grid gap-px bg-slate-100 sm:grid-cols-2">
            <section className="bg-white p-4 sm:p-5" aria-labelledby="meeting-attendees"><h2 id="meeting-attendees" className="text-balance text-sm font-semibold text-slate-800">参会人员</h2><div className="mt-3 flex flex-wrap gap-2">{attendees.map((name, index) => <span key={name} className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium", index < 4 ? "border-blue-100 bg-blue-50 text-[#002fa7]" : "border-slate-200 bg-slate-50 text-slate-600")}><Users className="size-3" aria-hidden="true" />{name}</span>)}</div></section>
            <section className="bg-white p-4 sm:p-5" aria-labelledby="next-meeting"><h2 id="next-meeting" className="text-balance text-sm font-semibold text-slate-800">下次会议</h2><p className="mt-2 text-sm font-medium text-slate-700 tabular-nums">2026-04-23 14:00</p><p className="mt-1 text-xs text-slate-500">市场部周会跟进</p><Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => toast.success("已添加到日历")}><Calendar className="size-4" />添加到日历</Button></section>
          </div>
        </main>

        <aside className="min-w-0 space-y-4">
          <section className="hz-surface overflow-hidden">
            <HorizonSectionHeader Icon={ListChecks} title="行动详情" description="负责人、状态与后续动作。" />
            {selectedAction ? <div className="p-4"><h2 className="text-balance text-base font-semibold text-slate-900">{selectedAction.action}</h2><dl className="mt-4 divide-y divide-slate-100 border-y border-slate-100"><DetailRow label="负责人" value={selectedAction.owner} /><DetailRow label="截止日期" value={selectedAction.deadline} /><DetailRow label="当前状态" value={selectedAction.status} /></dl><div className="mt-4 space-y-2"><Button type="button" className="w-full bg-[#002fa7] hover:bg-[#002581]" onClick={() => handleStatusChange(selectedAction.id)}>推进一步</Button><Button type="button" variant="outline" className="w-full" onClick={() => toast.success(`${selectedAction.owner} 已收到提醒`)}>发送提醒</Button><Button type="button" variant="outline" className="w-full" onClick={() => toast.success(`${selectedAction.action} 已同步到首页待办`)}>同步到首页</Button></div></div> : <HorizonEmptyState Icon={ListChecks} title="请选择行动项" description="从行动项表格选择一项查看详情。" action={<Button type="button" variant="outline" size="sm" onClick={resetActionFilters}>查看全部行动项</Button>} />}
          </section>

          <section className="hz-surface overflow-hidden">
            <HorizonSectionHeader Icon={History} title="会议历史" description="最近会议与提炼状态。" />
            <ol className="divide-y divide-slate-100 px-4">{meetingHistory.map((meeting) => <li key={meeting.date} className="flex gap-3 py-3"><span className={cn("mt-1 size-2 shrink-0 rounded-full", meeting.active ? "bg-[#002fa7]" : "bg-slate-300")} aria-hidden="true" /><div className="min-w-0"><div className="flex items-start justify-between gap-2"><h3 className="text-balance text-sm font-semibold text-slate-800">{meeting.title}</h3><time className="shrink-0 text-xs text-slate-500 tabular-nums">{meeting.date}</time></div><p className="mt-1 text-xs text-pretty text-slate-600">{meeting.note}</p></div></li>)}</ol>
          </section>

          <section className="hz-surface overflow-hidden">
            <HorizonSectionHeader Icon={Download} title="发布与导出" description="推送团队或导出外部文件。" />
            <div className="space-y-2 p-4"><Button type="button" className="w-full bg-[#002fa7] hover:bg-[#002581]" onClick={() => toast.success("行动项已推送给各负责人")}><Send className="size-4" />推送行动项</Button><Button type="button" variant="outline" className="w-full" onClick={() => toast.info("正在导出 Word…")}><Download className="size-4" />导出 Word</Button><Button type="button" variant="outline" className="w-full" onClick={() => toast.info("正在导出 PDF…")}><FileText className="size-4" />导出 PDF</Button><Button type="button" variant="outline" className="w-full" onClick={() => toast.success("分享链接已复制")}><Share2 className="size-4" />分享链接</Button></div>
          </section>
        </aside>
      </div>

      <AlertDialog open={deleteActionId !== null} onOpenChange={(open) => !open && setDeleteActionId(null)}>
        <AlertDialogContent className="horizon-portal"><AlertDialogHeader><AlertDialogTitle className="text-balance text-slate-900">删除该行动项？</AlertDialogTitle><AlertDialogDescription className="text-pretty">“{actionToDelete?.action ?? "当前行动项"}”将从本次会议纪要中移除，此操作无法直接撤销。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => deleteActionId !== null && handleDeleteAction(deleteActionId)}>确认删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function FormField({ label, htmlFor, error, children }: { label: string; htmlFor: string; error?: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label htmlFor={htmlFor}>{label}</Label>{children}{error ? <p className="flex items-center gap-1.5 text-xs text-red-600" role="alert"><AlertTriangle className="size-3.5" aria-hidden="true" />{error}</p> : null}</div>;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return <div className="grid grid-cols-[84px_minmax(0,1fr)] gap-3 py-2.5"><dt className="text-xs text-slate-500">{label}</dt><dd className="text-sm font-medium text-slate-800 tabular-nums">{value}</dd></div>;
}
