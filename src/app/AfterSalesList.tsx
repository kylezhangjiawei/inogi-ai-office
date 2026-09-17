import { ToggleGroup, ToggleGroupItem } from "./components/ui/toggle-group";
import React, { useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Clock,
  Filter,
  Headphones,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  TriangleAlert,
  User,
  Users,
} from "lucide-react";
import { Link } from "react-router";
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
// 页面路径以「页面路由管理」的配置为准，随主路径变更自动跟随
import { routePath, subRoutePath } from "./lib/routePaths";
import { NativeSelect } from "./components/ui/native-select";

const initialTickets = [
  { id: "CS-2024-0892", customer: "Medline International", product: "OC-5", sn: "20240315001", issue: "不出氧", priority: "P2", status: "处理中", assignee: "王工", date: "2024-04-07", updated: "1小时前" },
  { id: "CS-2024-0891", customer: "上海瑞医科技", product: "OC-3", sn: "20240310023", issue: "报警", priority: "P1", status: "待处理", assignee: "李技术", date: "2024-04-06", updated: "3小时前" },
  { id: "CS-2024-0890", customer: "Aircare Mexico", product: "OC-10", sn: "20240228015", issue: "异常噪音", priority: "P3", status: "待客户", assignee: "陈工", date: "2024-04-05", updated: "1天前" },
  { id: "CS-2024-0889", customer: "北京嘉和医疗", product: "OC-5", sn: "20240220008", issue: "开机故障", priority: "P1", status: "处理中", assignee: "王工", date: "2024-04-04", updated: "2天前" },
  { id: "CS-2024-0888", customer: "PT Medika Jakarta", product: "OC-3", sn: "20240215044", issue: "报警", priority: "P2", status: "已完成", assignee: "李技术", date: "2024-04-01", updated: "5天前" },
  { id: "CS-2024-0887", customer: "广州博达设备", product: "OC-10", sn: "20240210031", issue: "其他", priority: "P3", status: "已完成", assignee: "陈工", date: "2024-03-29", updated: "1周前" },
  { id: "CS-2024-0886", customer: "Medline International", product: "OC-5", sn: "20240205019", issue: "不出氧", priority: "P2", status: "已关闭", assignee: "王工", date: "2024-03-25", updated: "2周前" },
];

const statusConfig: Record<string, { className: string; icon: LucideIcon }> = {
  待处理: { className: "border-red-100 bg-red-50 text-red-700", icon: AlertCircle },
  处理中: { className: "border-blue-100 bg-blue-50 text-primary", icon: RefreshCw },
  待客户: { className: "border-amber-100 bg-amber-50 text-amber-700", icon: Clock },
  已完成: { className: "border-emerald-100 bg-emerald-50 text-emerald-700", icon: CheckCircle2 },
  已关闭: { className: "border-slate-200 bg-slate-50 text-slate-500", icon: CheckCircle2 },
};

const priorityConfig: Record<string, string> = {
  P1: "border-red-200 bg-red-50 text-red-700",
  P2: "border-amber-200 bg-amber-50 text-amber-700",
  P3: "border-slate-200 bg-slate-50 text-slate-600",
};

const filterTabs = ["全部", "待处理", "处理中", "待客户", "已完成"];
const pageSize = 5;

const queueInsights = [
  { title: "高优先级工单", value: "2", helper: "建议今天内完成初步诊断", tone: "text-red-700" },
  { title: "客户待反馈", value: "1", helper: "可补发视频采集指引", tone: "text-amber-700" },
  { title: "跨部门协同", value: "3", helper: "已同步研发、法规与质量", tone: "text-primary" },
];

const collaborationFeed = [
  { id: "flow-01", title: "OC-10 异常噪音已同步研发分流", helper: "等待历史方案匹配结果", time: "10:20" },
  { id: "flow-02", title: "Medline 工单追加报关资料核对", helper: "需要确认箱数与发票字段", time: "11:45" },
  { id: "flow-03", title: "CE 投诉案例已抄送法规知识库", helper: "用于补充标签风险案例", time: "14:10" },
];

function nextStatus(status: string) {
  if (status === "待处理") return "处理中";
  if (status === "处理中") return "待客户";
  if (status === "待客户") return "已完成";
  if (status === "已完成") return "已关闭";
  return "待处理";
}

export function AfterSalesList() {
  const [tickets, setTickets] = useState(initialTickets);
  const [activeFilter, setActiveFilter] = useState("全部");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedTicketId, setSelectedTicketId] = useState(initialTickets[0].id);
  const [showFilterDialog, setShowFilterDialog] = useState(false);
  const [showActionsDialog, setShowActionsDialog] = useState(false);
  const [priorityFilter, setPriorityFilter] = useState("全部");
  const [assigneeFilter, setAssigneeFilter] = useState("全部");

  const filtered = useMemo(
    () => tickets.filter((ticket) => {
      const query = search.toLowerCase();
      const matchStatus = activeFilter === "全部" || ticket.status === activeFilter;
      const matchSearch = !search || ticket.id.toLowerCase().includes(query) || ticket.customer.toLowerCase().includes(query) || ticket.sn.includes(search) || ticket.product.toLowerCase().includes(query);
      const matchPriority = priorityFilter === "全部" || ticket.priority === priorityFilter;
      const matchAssignee = assigneeFilter === "全部" || ticket.assignee === assigneeFilter;
      return matchStatus && matchSearch && matchPriority && matchAssignee;
    }),
    [activeFilter, assigneeFilter, priorityFilter, search, tickets],
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pagedTickets = filtered.slice((page - 1) * pageSize, page * pageSize);
  const selectedTicket = tickets.find((ticket) => ticket.id === selectedTicketId) ?? tickets[0];
  const pendingCount = tickets.filter((ticket) => ticket.status === "待处理").length;
  const processingCount = tickets.filter((ticket) => ticket.status === "处理中").length;
  const waitingCount = tickets.filter((ticket) => ticket.status === "待客户").length;
  const completedCount = tickets.filter((ticket) => ticket.status === "已完成").length;
  const hasAdvancedFilters = priorityFilter !== "全部" || assigneeFilter !== "全部";

  function resetFilters() {
    setActiveFilter("全部");
    setPriorityFilter("全部");
    setAssigneeFilter("全部");
    setSearch("");
    setPage(1);
  }

  function advanceTicket(id: string) {
    setTickets((prev) => prev.map((ticket) => ticket.id === id ? { ...ticket, status: nextStatus(ticket.status), updated: "刚刚更新" } : ticket));
    toast.success(`工单 ${id} 状态已推进`);
  }

  return (
    <div className="horizon-theme hz-page mx-auto flex min-h-full max-w-[1600px] min-w-0 flex-col gap-4 px-3 py-4 sm:p-5 lg:p-6">
      <HorizonPageHeader
        Icon={Headphones}
        eyebrow="售后服务 · Case 管理"
        title="售后工单"
        description="统一查看客户问题、响应时效与跨部门处理进度。"
        meta={<><span>共 {tickets.length} 条工单</span><span aria-hidden="true">·</span><span>{pendingCount} 条等待受理</span></>}
        actions={
          <Button asChild className="hz-primary-action">
            <Link to={subRoutePath("page:after-sales", "/after-sales", "new")}><Plus className="size-4" />新建工单</Link>
          </Button>
        }
      />

      <HorizonMetricGrid>
        <HorizonMetric Icon={TriangleAlert} label="待处理" value={pendingCount} note="需尽快完成首次响应" tone="danger" />
        <HorizonMetric Icon={Activity} label="处理中" value={processingCount} note="技术团队正在跟进" tone="brand" />
        <HorizonMetric Icon={Clock} label="待客户" value={waitingCount} note="等待客户补充或确认" tone="warning" />
        <HorizonMetric Icon={CheckCircle2} label="已完成" value={completedCount} note="本周期已完成处理" tone="success" />
      </HorizonMetricGrid>

      <section className="hz-surface min-w-0 overflow-hidden">
        <HorizonSectionHeader Icon={Headphones} title="Case 处理队列" description="按状态、客户、设备和负责人快速定位当前工单。" trailing={<span className="text-xs text-slate-500 tabular-nums">当前结果 {filtered.length} 条</span>} />

        <div className="hz-toolbar flex flex-col gap-3 border-b px-4 py-3 xl:flex-row xl:items-center xl:justify-between">
          <ToggleGroup type="single" value={activeFilter} onValueChange={(value) => { if (value) { setActiveFilter(value); setPage(1); } }} className="min-w-0 flex-wrap gap-2" aria-label="工单状态筛选">
            {filterTabs.map((tab) => (
              <ToggleGroupItem key={tab} value={tab} size="sm" className="flex-none rounded-lg data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                {tab}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <div className="flex w-full min-w-0 items-center gap-2 xl:w-auto">
            <div className="relative min-w-0 flex-1 xl:w-72 xl:flex-none">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input type="search" aria-label="搜索工单" placeholder="搜索工单号、客户、型号或 SN" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} className="h-10 rounded-xl bg-white pl-9" />
            </div>
            <Button type="button" variant="outline" className={cn("h-10 rounded-xl", hasAdvancedFilters && "border-primary text-primary")} onClick={() => setShowFilterDialog(true)}>
              <Filter className="size-4" />筛选{hasAdvancedFilters ? "（已应用）" : ""}
            </Button>
          </div>
        </div>

          <div className="min-w-0 overflow-x-auto">
            <table className="w-full min-w-[980px] text-left">
              <caption className="sr-only">售后 Case 处理队列，包含工单编号、客户、设备、优先级、负责人、状态与更新时间</caption>
              <thead className="bg-slate-50/80">
              <tr>{["工单编号", "客户", "产品 / SN", "问题类型", "优先级", "负责人", "状态", "更新时间", "操作"].map((header) => <th key={header} scope="col" className="whitespace-nowrap px-4 py-3 text-xs font-semibold text-slate-500">{header}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pagedTickets.map((ticket) => {
                const statusCfg = statusConfig[ticket.status];
                const StatusIcon = statusCfg.icon;
                return (
                  <tr key={ticket.id} className="bg-white hover:bg-[#f7f9ff]" onMouseEnter={() => setSelectedTicketId(ticket.id)}>
                    <td className="px-4 py-3.5"><Link to={`${routePath("page:after-sales", "/after-sales")}/${ticket.id}`} className="font-mono text-sm font-semibold text-primary hover:underline">{ticket.id}</Link></td>
                    <td className="max-w-48 px-4 py-3.5 text-sm font-medium text-slate-700"><span className="block truncate" title={ticket.customer}>{ticket.customer}</span></td>
                    <td className="px-4 py-3.5"><p className="text-sm font-semibold text-slate-700">{ticket.product}</p><p className="mt-0.5 font-mono text-xs text-slate-500 tabular-nums">{ticket.sn}</p></td>
                    <td className="px-4 py-3.5 text-sm text-slate-600">{ticket.issue}</td>
                    <td className="px-4 py-3.5"><span className={cn("inline-flex rounded-full border px-2 py-1 text-xs font-semibold tabular-nums", priorityConfig[ticket.priority])}>{ticket.priority}</span></td>
                    <td className="px-4 py-3.5"><div className="flex items-center gap-2 text-sm text-slate-600"><span className="flex size-7 items-center justify-center rounded-full bg-slate-100" aria-hidden="true"><User className="size-3.5 text-slate-500" /></span>{ticket.assignee}</div></td>
                    <td className="px-4 py-3.5"><span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold", statusCfg.className)}><StatusIcon className="size-3.5" aria-hidden="true" />{ticket.status}</span></td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-xs text-slate-500 tabular-nums">{ticket.updated}</td>
                    <td className="px-4 py-3.5"><div className="flex items-center gap-1"><Button type="button" variant="outline" size="sm" onClick={() => advanceTicket(ticket.id)}>推进一步</Button><Button asChild variant="ghost" size="icon"><Link to={`${routePath("page:after-sales", "/after-sales")}/${ticket.id}`} aria-label={`查看工单 ${ticket.id}`}><ChevronRight className="size-4" /></Link></Button></div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 ? <HorizonEmptyState Icon={Search} title="没有找到匹配工单" description="请调整搜索词或清除筛选条件后重试。" action={<Button type="button" variant="outline" onClick={resetFilters}>清除筛选</Button>} /> : null}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
          <div className="text-xs text-slate-500 tabular-nums">第 {page} / {totalPages} 页</div>
          <div className="flex items-center gap-2"><Button type="button" variant="outline" size="sm" onClick={() => setPage((prev) => Math.max(1, prev - 1))} disabled={page === 1}>上一页</Button><Button type="button" variant="outline" size="sm" onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))} disabled={page === totalPages}>下一页</Button><Button type="button" variant="ghost" size="icon" aria-label="打开列表更多操作" onClick={() => setShowActionsDialog(true)}><MoreHorizontal className="size-4" /></Button></div>
        </div>
      </section>

      <section className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
        <div className="hz-surface min-w-0 overflow-hidden">
          <HorizonSectionHeader Icon={Activity} title="当前聚焦工单" description="将鼠标移到列表行即可更新摘要。" trailing={<span className={cn("rounded-full border px-2 py-1 text-xs font-semibold", priorityConfig[selectedTicket.priority])}>{selectedTicket.priority}</span>} />
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <div className="min-w-0 border-b border-slate-100 pb-4 sm:border-b-0 sm:border-r sm:pb-0 sm:pr-4"><div className="text-xs font-semibold text-slate-500">客户与设备</div><div className="mt-2 font-mono text-base font-semibold text-primary tabular-nums">{selectedTicket.id}</div><p className="mt-1 truncate text-sm font-medium text-slate-800">{selectedTicket.customer}</p><p className="mt-2 text-sm text-slate-600">{selectedTicket.product} · <span className="font-mono tabular-nums">{selectedTicket.sn}</span></p></div>
            <div className="min-w-0"><div className="text-xs font-semibold text-slate-500">处理状态</div><p className="mt-2 text-sm font-semibold text-slate-800">{selectedTicket.issue} · {selectedTicket.assignee}</p><p className="mt-1 text-sm text-slate-600">最近更新：<span className="tabular-nums">{selectedTicket.updated}</span></p><div className="mt-3 flex flex-wrap gap-2"><span className={cn("rounded-full border px-2.5 py-1 text-xs font-semibold", statusConfig[selectedTicket.status].className)}>{selectedTicket.status}</span><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">下一步：推进诊断</span></div></div>
          </div>
        </div>
        <div className="hz-surface min-w-0 overflow-hidden">
          <HorizonSectionHeader Icon={Users} title="队列信号" description="今日需要优先关注的服务信号。" />
          <div className="divide-y divide-slate-100 px-4">{queueInsights.map((item) => <div key={item.title} className="flex items-start justify-between gap-4 py-3"><div className="min-w-0"><div className="text-sm font-semibold text-slate-800">{item.title}</div><p className="mt-1 text-xs text-pretty text-slate-500">{item.helper}</p></div><span className={cn("text-lg font-semibold tabular-nums", item.tone)}>{item.value}</span></div>)}</div>
        </div>
      </section>

      <div className="hz-surface min-w-0 overflow-hidden">
        <HorizonSectionHeader Icon={Users} title="协同动态" description="售后与研发、法规、质量模块的最新联动。" />
        <div className="grid divide-y divide-slate-100 px-4 lg:grid-cols-3 lg:divide-x lg:divide-y-0 lg:px-0">{collaborationFeed.map((item) => <div key={item.id} className="min-w-0 py-3 lg:px-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0 text-sm font-semibold text-slate-800">{item.title}</div><time className="shrink-0 text-xs text-slate-500 tabular-nums">{item.time}</time></div><p className="mt-1 text-xs text-pretty text-slate-500">{item.helper}</p></div>)}</div>
      </div>

      <Dialog open={showFilterDialog} onOpenChange={setShowFilterDialog}>
        <DialogContent className="horizon-portal sm:max-w-xl">
          <DialogHeader><DialogTitle className="text-balance text-slate-900">高级筛选</DialogTitle><DialogDescription className="text-pretty">按优先级和负责人进一步缩小工单范围。</DialogDescription></DialogHeader>
          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="after-sales-priority">优先级</Label><NativeSelect id="after-sales-priority" className="material-input" value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}>{["全部", "P1", "P2", "P3"].map((item) => <option key={item} value={item}>{item}</option>)}</NativeSelect></div>
            <div className="space-y-2"><Label htmlFor="after-sales-assignee">负责人</Label><NativeSelect id="after-sales-assignee" className="material-input" value={assigneeFilter} onChange={(event) => setAssigneeFilter(event.target.value)}>{["全部", ...Array.from(new Set(initialTickets.map((item) => item.assignee)))].map((item) => <option key={item} value={item}>{item}</option>)}</NativeSelect></div>
          </div>
          <div className="text-sm text-slate-500 tabular-nums">当前结果：{filtered.length} 条工单</div>
          <DialogFooter><Button type="button" variant="outline" onClick={() => { setPriorityFilter("全部"); setAssigneeFilter("全部"); setPage(1); }}>重置</Button><Button type="button" className="bg-primary hover:bg-primary-hover" onClick={() => { setPage(1); setShowFilterDialog(false); toast.success("高级筛选已应用"); }}>应用筛选</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showActionsDialog} onOpenChange={setShowActionsDialog}>
        <DialogContent className="horizon-portal sm:max-w-lg">
          <DialogHeader><DialogTitle className="text-balance text-slate-900">列表操作</DialogTitle><DialogDescription className="text-pretty">对当前筛选结果执行批量协同操作。</DialogDescription></DialogHeader>
          <div className="space-y-2 py-1">{["导出当前筛选结果", "批量提醒负责人更新工单", "同步高优先级工单到首页待办"].map((item) => <Button key={item} type="button" variant="outline" className="h-auto w-full justify-start whitespace-normal rounded-xl px-4 py-3 text-left" onClick={() => { setShowActionsDialog(false); toast.success(`${item} 已触发`); }}>{item}</Button>)}</div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
