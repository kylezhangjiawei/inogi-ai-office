import React, { useMemo, useState } from "react";
import { motion } from "motion/react";
import { Link } from "react-router";
import { Plus, Search, Filter, MoreHorizontal, ChevronRight, Clock, AlertCircle, CheckCircle2, User, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "./components/ui/utils";

const initialTickets = [
  { id: "CS-2024-0892", customer: "Medline International", product: "OC-5", sn: "20240315001", issue: "不出氧", priority: "P2", status: "处理中", assignee: "王工", date: "2024-04-07", updated: "1小时前" },
  { id: "CS-2024-0891", customer: "上海瑞医科技", product: "OC-3", sn: "20240310023", issue: "报警", priority: "P1", status: "待处理", assignee: "李技术", date: "2024-04-06", updated: "3小时前" },
  { id: "CS-2024-0890", customer: "Aircare Mexico", product: "OC-10", sn: "20240228015", issue: "异常噪音", priority: "P3", status: "待客户", assignee: "陈工", date: "2024-04-05", updated: "1天前" },
  { id: "CS-2024-0889", customer: "北京嘉和医疗", product: "OC-5", sn: "20240220008", issue: "开机故障", priority: "P1", status: "处理中", assignee: "王工", date: "2024-04-04", updated: "2天前" },
  { id: "CS-2024-0888", customer: "PT Medika Jakarta", product: "OC-3", sn: "20240215044", issue: "报警", priority: "P2", status: "已完成", assignee: "李技术", date: "2024-04-01", updated: "5天前" },
  { id: "CS-2024-0887", customer: "广州博达设备", product: "OC-10", sn: "20240210031", issue: "其他", priority: "P3", status: "已完成", assignee: "陈工", date: "2024-03-29", updated: "1周前" },
  { id: "CS-2024-0886", customer: "Medline International", product: "OC-5", sn: "20240205019", issue: "不出氧", priority: "P2", status: "已关闭", assignee: "王工", date: "2024-03-25", updated: "2周前" },
];

const statusConfig: Record<string, { label: string; className: string; icon: React.FC<any> }> = {
  待处理: { label: "待处理", className: "bg-red-50 text-red-600 border-red-100", icon: AlertCircle },
  处理中: { label: "处理中", className: "bg-blue-50 text-[#1976D2] border-blue-100", icon: RefreshCw },
  待客户: { label: "待客户", className: "bg-amber-50 text-amber-600 border-amber-100", icon: Clock },
  已完成: { label: "已完成", className: "bg-green-50 text-green-600 border-green-100", icon: CheckCircle2 },
  已关闭: { label: "已关闭", className: "bg-gray-50 text-gray-400 border-gray-100", icon: CheckCircle2 },
};

const priorityConfig: Record<string, string> = {
  P1: "bg-red-500 text-white",
  P2: "bg-orange-400 text-white",
  P3: "bg-gray-200 text-gray-600",
};

const filterTabs = ["全部", "待处理", "处理中", "待客户", "已完成"];
const pageSize = 5;

const queueInsights = [
  { title: "高优先级工单", value: "2", helper: "建议今天内完成初步诊断", tone: "bg-rose-50 text-rose-700" },
  { title: "客户待反馈", value: "1", helper: "可补发视频采集指引", tone: "bg-amber-50 text-amber-700" },
  { title: "跨部门协同", value: "3", helper: "已同步研发、法规与质量", tone: "bg-blue-50 text-blue-700" },
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
    () =>
      tickets.filter((ticket) => {
        const matchStatus = activeFilter === "全部" || ticket.status === activeFilter;
        const matchSearch =
          !search ||
          ticket.id.includes(search) ||
          ticket.customer.toLowerCase().includes(search.toLowerCase()) ||
          ticket.sn.includes(search) ||
          ticket.product.toLowerCase().includes(search.toLowerCase());
        const matchPriority = priorityFilter === "全部" || ticket.priority === priorityFilter;
        const matchAssignee = assigneeFilter === "全部" || ticket.assignee === assigneeFilter;
        return matchStatus && matchSearch && matchPriority && matchAssignee;
      }),
    [activeFilter, assigneeFilter, priorityFilter, search, tickets],
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pagedTickets = filtered.slice((page - 1) * pageSize, page * pageSize);
  const selectedTicket = tickets.find((ticket) => ticket.id === selectedTicketId) ?? tickets[0];

  function advanceTicket(id: string) {
    setTickets((prev) =>
      prev.map((ticket) =>
        ticket.id === id ? { ...ticket, status: nextStatus(ticket.status), updated: "刚刚更新" } : ticket,
      ),
    );
    toast.success(`工单 ${id} 状态已推进`);
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-800">售后工单</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            共 {tickets.length} 条工单，{tickets.filter((ticket) => ticket.status === "待处理").length} 条待处理
          </p>
        </div>
        <Link
          to="/after-sales/new"
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#1976D2] text-white rounded-xl text-sm font-bold shadow-lg shadow-blue-900/10 hover:shadow-xl hover:-translate-y-0.5 transition-all"
        >
          <Plus className="w-4 h-4" />
          新建工单
        </Link>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "待处理", count: tickets.filter((ticket) => ticket.status === "待处理").length, color: "text-red-600", bg: "bg-red-50" },
          { label: "处理中", count: tickets.filter((ticket) => ticket.status === "处理中").length, color: "text-blue-600", bg: "bg-blue-50" },
          { label: "待客户", count: tickets.filter((ticket) => ticket.status === "待客户").length, color: "text-amber-600", bg: "bg-amber-50" },
          { label: "已完成", count: tickets.filter((ticket) => ticket.status === "已完成").length, color: "text-green-600", bg: "bg-green-50" },
        ].map((stat, index) => (
          <motion.div key={stat.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }} className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex items-center gap-4">
            <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", stat.bg)}>
              <span className={cn("text-lg font-bold", stat.color)}>{stat.count}</span>
            </div>
            <span className="text-sm text-gray-500 font-medium">{stat.label}</span>
          </motion.div>
        ))}
      </div>

      <section className="grid grid-cols-12 gap-6">
        <div className="col-span-12 xl:col-span-8">
          <div className="material-card p-6">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-slate-900">队列摘要</h3>
                <p className="mt-1 text-sm text-slate-500">让售后列表页先看到当前最需要处理的信号，而不只是表格。</p>
              </div>
              <span className="material-chip bg-slate-100 text-slate-600">Service Pulse</span>
            </div>
            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
              {queueInsights.map((item) => (
                <div key={item.title} className="material-panel">
                  <span className={cn("material-chip", item.tone)}>{item.title}</span>
                  <div className="mt-3 text-3xl font-bold tracking-tight text-slate-900">{item.value}</div>
                  <div className="mt-2 text-sm text-slate-600">{item.helper}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="col-span-12 xl:col-span-4">
          <div className="material-card p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-slate-900">协同动态</h3>
                <p className="mt-1 text-sm text-slate-500">补上售后与其他模块的联动记录。</p>
              </div>
              <span className="material-chip bg-blue-50 text-blue-700">Live</span>
            </div>
            <div className="mt-5 space-y-3">
              {collaborationFeed.map((item) => (
                <div key={item.id} className="material-panel">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-slate-800">{item.title}</div>
                    <span className="material-chip bg-white text-slate-500">{item.time}</span>
                  </div>
                  <div className="mt-2 text-sm text-slate-600">{item.helper}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-4 border-b border-gray-50 flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="flex items-center gap-2 flex-1 flex-wrap">
            {filterTabs.map((tab) => (
              <button
                key={tab}
                onClick={() => {
                  setActiveFilter(tab);
                  setPage(1);
                }}
                className={cn("px-3 py-1.5 rounded-lg text-xs font-bold transition-all", activeFilter === tab ? "bg-[#1976D2] text-white shadow-sm" : "text-gray-500 hover:bg-gray-50")}
              >
                {tab}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="搜索工单号/客户/SN..."
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              className="pl-9 pr-4 py-2 bg-gray-50 border border-transparent rounded-xl text-xs font-medium outline-none focus:bg-white focus:border-blue-200 transition-all w-52"
            />
          </div>
          <button className="p-2 rounded-xl border border-gray-100 text-gray-400 hover:bg-gray-50 transition-colors" onClick={() => setShowFilterDialog(true)}>
            <Filter className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-gray-50/60">
                {["工单编号", "客户", "产品/SN", "问题类型", "优先级", "负责人", "状态", "更新时间", "操作"].map((header) => (
                  <th key={header} className="px-5 py-3.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider whitespace-nowrap">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {pagedTickets.map((ticket, index) => {
                const statusCfg = statusConfig[ticket.status];
                const StatusIcon = statusCfg.icon;
                return (
                  <motion.tr key={ticket.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: index * 0.03 }} className="hover:bg-blue-50/20 transition-colors group">
                    <td className="px-5 py-4">
                      <Link to={`/after-sales/${ticket.id}`} onMouseEnter={() => setSelectedTicketId(ticket.id)} className="font-mono text-sm font-bold text-[#1976D2] hover:underline">
                        {ticket.id}
                      </Link>
                    </td>
                    <td className="px-5 py-4 text-sm font-medium text-gray-700 whitespace-nowrap">{ticket.customer}</td>
                    <td className="px-5 py-4">
                      <p className="text-xs font-bold text-gray-700">{ticket.product}</p>
                      <p className="text-[10px] font-mono text-gray-400">{ticket.sn}</p>
                    </td>
                    <td className="px-5 py-4">
                      <span className="px-2 py-1 bg-gray-50 text-gray-600 rounded-lg text-[11px] font-bold border border-gray-100">{ticket.issue}</span>
                    </td>
                    <td className="px-5 py-4">
                      <span className={cn("px-2 py-1 rounded text-[10px] font-bold", priorityConfig[ticket.priority])}>{ticket.priority}</span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center">
                          <User className="w-3 h-3 text-gray-400" />
                        </div>
                        <span className="text-xs text-gray-600 font-medium">{ticket.assignee}</span>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border", statusCfg.className)}>
                        <StatusIcon className={cn("w-3 h-3", ticket.status === "处理中" ? "animate-spin" : "")} />
                        {statusCfg.label}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-[11px] text-gray-400 font-medium whitespace-nowrap">{ticket.updated}</td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <button className="rounded-lg border border-gray-100 px-2.5 py-1.5 text-[11px] font-bold text-gray-500 hover:bg-gray-50" onClick={() => advanceTicket(ticket.id)}>
                          推进一步
                        </button>
                        <Link to={`/after-sales/${ticket.id}`} className="p-1.5 hover:bg-gray-100 rounded-lg inline-flex">
                          <ChevronRight className="w-4 h-4 text-gray-400" />
                        </Link>
                      </div>
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 ? (
            <div className="py-16 text-center text-gray-400">
              <Search className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm font-medium">未找到匹配的工单</p>
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between border-t border-gray-50 px-5 py-4">
          <div className="text-xs font-medium text-gray-400">第 {page} / {totalPages} 页</div>
          <div className="flex items-center gap-2">
            <button className="rounded-lg border border-gray-100 px-3 py-1.5 text-xs font-bold text-gray-500 hover:bg-gray-50 disabled:opacity-40" onClick={() => setPage((prev) => Math.max(1, prev - 1))} disabled={page === 1}>
              上一页
            </button>
            <button className="rounded-lg border border-gray-100 px-3 py-1.5 text-xs font-bold text-gray-500 hover:bg-gray-50 disabled:opacity-40" onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))} disabled={page === totalPages}>
              下一页
            </button>
            <button className="rounded-lg border border-gray-100 p-2 text-gray-400 hover:bg-gray-50" onClick={() => setShowActionsDialog(true)}>
              <MoreHorizontal className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      <section className="grid grid-cols-12 gap-6">
        <div className="col-span-12 xl:col-span-7">
          <div className="material-card p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-slate-900">当前聚焦工单</h3>
                <p className="mt-1 text-sm text-slate-500">通过列表 hover 快速切换下方摘要，减少频繁跳详情页的成本。</p>
              </div>
              <span className="material-chip bg-slate-100 text-slate-600">{selectedTicket.priority}</span>
            </div>
            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="material-panel">
                <div className="text-xs uppercase tracking-[0.14em] text-slate-400">Ticket</div>
                <div className="mt-3 text-lg font-semibold text-slate-900">{selectedTicket.id}</div>
                <div className="mt-2 text-sm text-slate-600">{selectedTicket.customer}</div>
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-slate-600">
                  <div>
                    <div className="text-xs text-slate-400">产品</div>
                    <div className="mt-1">{selectedTicket.product}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-400">SN</div>
                    <div className="mt-1 font-mono">{selectedTicket.sn}</div>
                  </div>
                </div>
              </div>
              <div className="material-panel">
                <div className="text-xs uppercase tracking-[0.14em] text-slate-400">Process</div>
                <div className="mt-3 text-sm font-semibold text-slate-800">问题类型：{selectedTicket.issue}</div>
                <div className="mt-2 text-sm text-slate-600">负责人：{selectedTicket.assignee}</div>
                <div className="mt-2 text-sm text-slate-600">最近更新时间：{selectedTicket.updated}</div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <span className={cn("material-chip", statusConfig[selectedTicket.status].className)}>{selectedTicket.status}</span>
                  <span className="material-chip bg-slate-100 text-slate-600">建议下一步：推进诊断</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="col-span-12 xl:col-span-5">
          <div className="material-card p-6">
            <h3 className="text-slate-900">处理建议</h3>
            <div className="mt-4 space-y-3">
              {[
                "高优先级工单建议先补齐客户现场图片、视频和运行日志。",
                "若问题涉及异常噪音或硬件失效，可直接同步研发问题分流。",
                "涉及对外投诉风险的案例建议同时抄送法规与质量模块留痕。",
              ].map((item) => (
                <div key={item} className="material-panel text-sm text-slate-700">
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {showFilterDialog ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/28 px-4">
          <div className="material-card w-full max-w-xl p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-slate-900">高级筛选</h3>
                <p className="mt-1 text-sm text-slate-500">按优先级和负责人进一步筛选当前工单列表。</p>
              </div>
              <button type="button" className="material-button-secondary px-3 py-2" onClick={() => setShowFilterDialog(false)}>
                关闭
              </button>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-medium text-slate-600">优先级</span>
                <select className="material-input" value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}>
                  {["全部", "P1", "P2", "P3"].map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-slate-600">负责人</span>
                <select className="material-input" value={assigneeFilter} onChange={(event) => setAssigneeFilter(event.target.value)}>
                  {["全部", ...Array.from(new Set(initialTickets.map((item) => item.assignee)))].map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-6 flex items-center justify-between">
              <div className="text-sm text-slate-500">当前结果：{filtered.length} 条工单</div>
              <div className="flex gap-3">
                <button
                  type="button"
                  className="material-button-secondary"
                  onClick={() => {
                    setPriorityFilter("全部");
                    setAssigneeFilter("全部");
                    setPage(1);
                  }}
                >
                  重置
                </button>
                <button
                  type="button"
                  className="material-button-primary"
                  onClick={() => {
                    setPage(1);
                    setShowFilterDialog(false);
                    toast.success("高级筛选已应用");
                  }}
                >
                  应用筛选
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {showActionsDialog ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/28 px-4">
          <div className="material-card w-full max-w-lg p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-slate-900">列表动作</h3>
                <p className="mt-1 text-sm text-slate-500">把原来占位的“更多”改成可操作弹窗。</p>
              </div>
              <button type="button" className="material-button-secondary px-3 py-2" onClick={() => setShowActionsDialog(false)}>
                关闭
              </button>
            </div>
            <div className="mt-5 space-y-3">
              {[
                "导出当前筛选结果",
                "批量提醒负责人更新工单",
                "同步高优先级工单到首页待办",
              ].map((item) => (
                <button
                  key={item}
                  type="button"
                  className="material-panel w-full text-left text-sm text-slate-700 transition hover:border-blue-200"
                  onClick={() => toast.success(`${item} 已触发`)}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
