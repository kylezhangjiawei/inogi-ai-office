import React, { useMemo, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  Clock3,
  FileSearch,
  FileText,
  Folder,
  MoreHorizontal,
  Plus,
  Receipt,
  Ticket,
  TrendingUp,
  Upload,
  UserCheck,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Link } from "react-router";
import { toast } from "sonner";
import { cn } from "./components/ui/utils";

const statCards = [
  { title: "待处理工单", value: "12", helper: "较昨日 +2", icon: Ticket, tone: "text-red-600 bg-red-50" },
  { title: "本月报关单", value: "8", helper: "流程正常", icon: FileText, tone: "text-blue-700 bg-blue-50" },
  { title: "资料待更新", value: "3", helper: "需要复核", icon: Folder, tone: "text-amber-600 bg-amber-50" },
  { title: "待审批任务", value: "5", helper: "两项超时", icon: CheckCircle2, tone: "text-emerald-600 bg-emerald-50" },
];

const heroMetrics = [
  { label: "今日新增", value: "24", helper: "较昨日提升", icon: Activity, accent: "from-blue-500 to-cyan-500" },
  { label: "已完成", value: "156", helper: "本周累计", icon: CheckCircle2, accent: "from-sky-500 to-blue-600" },
  { label: "响应率", value: "98%", helper: "SLA 达成", icon: TrendingUp, accent: "from-emerald-500 to-teal-500" },
];

const barData = [
  { name: "新建", value: 4 },
  { name: "处理中", value: 5 },
  { name: "待客户", value: 2 },
  { name: "已完成", value: 18 },
];

const quickActions = [
  { title: "新建售后工单", icon: Plus, path: "/after-sales/new" },
  { title: "上传报关资料", icon: Upload, path: "/customs-ai" },
  { title: "生成会议纪要", icon: FileSearch, path: "/meeting" },
  { title: "查询注册进度", icon: Clock3, path: "/registration-projects" },
  { title: "筛选候选人", icon: UserCheck, path: "/resume-screening" },
  { title: "发起费用报销", icon: Receipt, path: "/expense-center" },
];

const workspacePulse = [
  { title: "售后与研发联动", helper: "3 个问题已同步进入紧急队列", tone: "bg-blue-50 text-blue-700" },
  { title: "对外资料版本", helper: "OC-10 英文 IFU 等待法规确认", tone: "bg-cyan-50 text-cyan-700" },
  { title: "质量闭环", helper: "2 条检验放行记录缺主管签批", tone: "bg-amber-50 text-amber-700" },
];

const activityFeed = [
  {
    id: "feed-01",
    title: "售后异常 Case 已推送研发分流",
    helper: "OC-10 启动重启问题自动匹配到历史方案",
    time: "10:24",
    path: "/rd-triage",
  },
  {
    id: "feed-02",
    title: "报关单证 AI 已完成 CI/PL 一致性检查",
    helper: "发现 1 项数量字段待人工确认",
    time: "11:10",
    path: "/customs-ai",
  },
  {
    id: "feed-03",
    title: "合同审查生成高风险条款建议",
    helper: "竞业限制条款建议补充适用范围说明",
    time: "13:35",
    path: "/contract-review",
  },
  {
    id: "feed-04",
    title: "员工归档模块发出补件提醒",
    helper: "2 位新员工仍缺学历证明扫描件",
    time: "15:00",
    path: "/employee-archive",
  },
];

const moduleSpotlights = [
  {
    title: "注册项目里程碑",
    helper: "显示资料缺口、关键节点和风险提醒",
    value: "6 个项目",
    path: "/registration-projects",
  },
  {
    title: "质量 DMS",
    helper: "统一收口 SOP、审批状态和发放记录",
    value: "18 份受控文件",
    path: "/quality-dms",
  },
  {
    title: "BUG 日志",
    helper: "集中跟踪修复进度、回归动作与研发建议",
    value: "7 条待修复",
    path: "/bug-log",
  },
];

const todoItems = [
  {
    id: "todo-001",
    name: "Medline 氧浓度异常工单处理",
    module: "售后工单",
    user: "王工",
    deadline: "2026-04-15",
    status: "待处理",
    priority: "高",
    path: "/after-sales",
  },
  {
    id: "todo-002",
    name: "4 月海关资料复核归档",
    module: "报关单证",
    user: "李静",
    deadline: "2026-04-16",
    status: "处理中",
    priority: "中",
    path: "/customs-ai",
  },
  {
    id: "todo-003",
    name: "研发二部 Q2 质量评审",
    module: "研发问题",
    user: "陈健",
    deadline: "2026-04-17",
    status: "待审批",
    priority: "高",
    path: "/rd-triage",
  },
  {
    id: "todo-004",
    name: "新员工入职资料校验",
    module: "人事行政",
    user: "张雅",
    deadline: "2026-04-18",
    status: "处理中",
    priority: "低",
    path: "/employee-archive",
  },
  {
    id: "todo-005",
    name: "OC-10 产品手册更新",
    module: "资料库",
    user: "周伟",
    deadline: "2026-04-19",
    status: "待处理",
    priority: "中",
    path: "/external-docs",
  },
  {
    id: "todo-006",
    name: "合同条款 AI 复核",
    module: "合同审查",
    user: "赵倩",
    deadline: "2026-04-20",
    status: "待审批",
    priority: "高",
    path: "/contract-review",
  },
  {
    id: "todo-007",
    name: "研发缺陷回归验证",
    module: "BUG 日志",
    user: "刘畅",
    deadline: "2026-04-21",
    status: "处理中",
    priority: "中",
    path: "/bug-log",
  },
];

const statusTone: Record<string, string> = {
  待处理: "bg-red-50 text-red-700",
  处理中: "bg-blue-50 text-blue-700",
  待审批: "bg-amber-50 text-amber-700",
};

const priorityTone: Record<string, string> = {
  高: "bg-rose-50 text-rose-700",
  中: "bg-sky-50 text-sky-700",
  低: "bg-emerald-50 text-emerald-700",
};

const pageSize = 4;

export function Dashboard() {
  const [statusFilter, setStatusFilter] = useState("全部");
  const [page, setPage] = useState(1);
  const [selectedFeedId, setSelectedFeedId] = useState(activityFeed[0].id);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [chartOpen, setChartOpen] = useState(false);
  const [focusedTodo, setFocusedTodo] = useState<(typeof todoItems)[number] | null>(null);

  const filteredTodos = useMemo(() => {
    return todoItems.filter((item) => statusFilter === "全部" || item.status === statusFilter);
  }, [statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredTodos.length / pageSize));
  const pagedTodos = filteredTodos.slice((page - 1) * pageSize, page * pageSize);
  const selectedFeed = activityFeed.find((item) => item.id === selectedFeedId) ?? activityFeed[0];

  const changeFilter = (nextFilter: string) => {
    setStatusFilter(nextFilter);
    setPage(1);
  };

  const handlePromote = (name: string) => {
    toast.success(`${name} 已加入今日重点跟进`);
  };

  const handleReport = () => {
    toast.success("完整报表已生成到经营分析中心");
  };

  const handleAnalysis = () => {
    toast.success("经营分析视图即将开放，当前先展示演示反馈");
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="grid grid-cols-12 gap-6">
        <div className="col-span-12 xl:col-span-8">
          <div className="material-card material-glow relative overflow-hidden p-7 md:p-8">
            <div className="absolute inset-y-0 right-0 hidden w-[42%] bg-[radial-gradient(circle_at_center,rgba(66,165,245,0.24),transparent_64%)] xl:block" />
            <div className="absolute -right-14 top-8 hidden h-40 w-40 rounded-full border border-white/60 bg-white/20 xl:block" />
            <div className="absolute right-20 top-16 hidden h-24 w-24 rounded-full border border-white/50 bg-white/10 xl:block" />

            <div className="relative z-10 flex flex-col gap-8">
              <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
                <div className="max-w-2xl space-y-4">
                  <span className="material-chip bg-blue-50 text-blue-700">Workspace Overview</span>
                  <div>
                    <h2 className="text-[2rem] font-bold tracking-tight text-slate-900 md:text-[2.35rem]">智能办公总览</h2>
                    <p className="mt-3 text-sm leading-7 text-slate-600 md:text-base">
                      将售后、报关、知识、审批与人事入口聚合在同一工作台中，用更清晰的层级、柔和的表面与更接近
                      Material 3 的节奏提升日常协同效率。
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <span className="material-chip bg-white/85 text-slate-700 shadow-sm">Material 3 Surface</span>
                    <span className="material-chip bg-white/85 text-slate-700 shadow-sm">Vuetify Console</span>
                    <span className="material-chip bg-white/85 text-slate-700 shadow-sm">Enterprise Flow</span>
                  </div>
                </div>

                <button type="button" onClick={() => setAnalysisOpen(true)} className="material-button-secondary w-fit self-start">
                  <ArrowUpRight className="h-4 w-4" />
                  进入经营分析
                </button>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {heroMetrics.map((item) => (
                  <div
                    key={item.label}
                    className="rounded-[26px] border border-white/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(242,247,255,0.9))] p-5 shadow-[0_16px_28px_rgba(15,23,42,0.08)]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-2">
                        <div className="text-sm font-semibold text-slate-500">{item.label}</div>
                        <div className="text-[2rem] font-bold leading-none tracking-tight text-slate-900">{item.value}</div>
                        <div className="text-xs font-medium text-slate-500">{item.helper}</div>
                      </div>
                      <div
                        className={cn(
                          "flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-sm",
                          item.accent,
                        )}
                      >
                        <item.icon className="h-5 w-5" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="col-span-12 xl:col-span-4">
          <div className="material-card h-full p-6">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">System Health</div>
                <h3 className="mt-1 text-slate-900">运行概况</h3>
              </div>
              <div className="rounded-2xl bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">Stable</div>
            </div>

            <div className="space-y-4">
              {[
                { label: "工单处理效率", value: "92%", width: "w-[92%]", color: "bg-blue-500" },
                { label: "资料更新完成度", value: "76%", width: "w-[76%]", color: "bg-cyan-500" },
                { label: "跨部门响应率", value: "88%", width: "w-[88%]", color: "bg-emerald-500" },
              ].map((item) => (
                <div key={item.label} className="rounded-[20px] border border-slate-100 bg-slate-50/70 p-4">
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="font-medium text-slate-600">{item.label}</span>
                    <span className="font-semibold text-slate-900">{item.value}</span>
                  </div>
                  <div className="h-2 rounded-full bg-white">
                    <div className={cn("h-2 rounded-full", item.width, item.color)} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {statCards.map((card) => (
          <div key={card.title} className="material-card-flat p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-sm font-medium text-slate-500">{card.title}</div>
                <div className="mt-3 text-4xl font-bold tracking-tight text-slate-900">{card.value}</div>
                <div className="mt-2 text-sm text-slate-500">{card.helper}</div>
              </div>
              <div className={cn("flex h-12 w-12 items-center justify-center rounded-2xl", card.tone)}>
                <card.icon className="h-6 w-6" />
              </div>
            </div>
          </div>
        ))}
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.2fr)_360px]">
        <div className="material-card p-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-slate-900">工作台脉冲</h3>
              <p className="mt-1 text-sm text-slate-500">把跨模块的关键进展浓缩成更容易扫描的状态条。</p>
            </div>
            <span className="material-chip bg-slate-100 text-slate-600">Live Summary</span>
          </div>
          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
            {workspacePulse.map((item) => (
              <div key={item.title} className="material-panel">
                <div className={cn("material-chip", item.tone)}>{item.title}</div>
                <div className="mt-3 text-sm leading-6 text-slate-600">{item.helper}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="material-card p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-slate-900">今日节奏</h3>
              <p className="mt-1 text-sm text-slate-500">给首页补一块更有产品感的运营提醒。</p>
            </div>
            <span className="material-chip bg-emerald-50 text-emerald-700">On Track</span>
          </div>
          <div className="mt-5 space-y-4">
            {[
              ["09:30", "售后晨会已同步 4 条异常记录"],
              ["13:00", "法规库新增 MDR 标签条款摘要"],
              ["16:00", "质量放行记录建议完成主管签批"],
            ].map(([time, text]) => (
              <div key={time} className="flex gap-3 rounded-[20px] border border-slate-100 bg-slate-50/80 p-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-primary shadow-sm">
                  <Activity className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">{time}</div>
                  <div className="mt-1 text-sm text-slate-700">{text}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-12 gap-6">
        <div className="col-span-12 xl:col-span-7">
          <div className="material-card h-full p-6">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h3 className="text-slate-900">近期工单状态</h3>
                <p className="mt-1 text-sm text-slate-500">用更有层次的图表卡强化处理趋势与状态对比。</p>
              </div>
              <button
                type="button"
                onClick={() => setChartOpen(true)}
                className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-500 transition hover:bg-slate-200"
              >
                <MoreHorizontal className="h-5 w-5" />
              </button>
            </div>

            <div className="rounded-[24px] bg-[linear-gradient(180deg,#ffffff_0%,#f7faff_100%)] p-4">
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={barData} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                    <CartesianGrid horizontal={false} stroke="#e5edf7" />
                    <XAxis type="number" hide />
                    <YAxis
                      type="category"
                      dataKey="name"
                      axisLine={false}
                      tickLine={false}
                      width={68}
                      tick={{ fill: "#5f6b7a", fontSize: 13 }}
                    />
                    <Tooltip
                      cursor={{ fill: "rgba(25, 118, 210, 0.06)" }}
                      contentStyle={{
                        borderRadius: 16,
                        border: "1px solid #d8e2ee",
                        boxShadow: "0 12px 28px rgba(15, 23, 42, 0.12)",
                      }}
                    />
                    <Bar dataKey="value" radius={[0, 10, 10, 0]} barSize={22}>
                      {barData.map((_, index) => (
                        <Cell key={index} fill={["#bbdefb", "#64b5f6", "#1e88e5", "#1565c0"][index]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>

        <div className="col-span-12 xl:col-span-5">
          <div className="material-card h-full p-6">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h3 className="text-slate-900">快捷操作</h3>
                <p className="mt-1 text-sm text-slate-500">让高频动作更像产品化功能入口，而不是普通按钮集合。</p>
              </div>
              <span className="material-chip bg-slate-100 text-slate-600">6 Actions</span>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {quickActions.map((action, index) => (
                <Link
                  key={action.title}
                  to={action.path}
                  className={cn(
                    "group rounded-[24px] border border-slate-200 p-4 transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-[0_16px_24px_rgba(25,118,210,0.12)]",
                    index === 0
                      ? "bg-[linear-gradient(135deg,#eaf3ff_0%,#ffffff_52%,#eef9f8_100%)]"
                      : "bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)]",
                  )}
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-primary transition group-hover:bg-blue-100">
                    <action.icon className="h-5 w-5" />
                  </div>
                  <div className="mt-4 text-sm font-semibold leading-6 text-slate-800">{action.title}</div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-12 gap-6">
        <div className="col-span-12 xl:col-span-7">
          <div className="material-card p-6">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h3 className="text-slate-900">跨模块动态</h3>
                <p className="mt-1 text-sm text-slate-500">用点击列表快速切换查看今天最值得关注的系统动作。</p>
              </div>
              <span className="material-chip bg-slate-100 text-slate-600">{activityFeed.length} Events</span>
            </div>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
              <div className="space-y-3">
                {activityFeed.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedFeedId(item.id)}
                    className={cn(
                      "w-full rounded-[22px] border p-4 text-left transition",
                      selectedFeedId === item.id ? "border-blue-200 bg-blue-50/50" : "border-slate-100 bg-slate-50/70 hover:border-slate-200",
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-slate-800">{item.title}</div>
                      <span className="material-chip bg-white text-slate-500">{item.time}</span>
                    </div>
                    <div className="mt-2 text-sm text-slate-600">{item.helper}</div>
                  </button>
                ))}
              </div>
              <div className="rounded-[24px] bg-[linear-gradient(180deg,#f8fbff_0%,#ffffff_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Event Detail</div>
                <div className="mt-3 text-lg font-semibold text-slate-900">{selectedFeed.title}</div>
                <div className="mt-3 text-sm leading-6 text-slate-600">{selectedFeed.helper}</div>
                <div className="mt-5 flex items-center justify-between rounded-2xl border border-slate-100 bg-white px-4 py-3">
                  <div>
                    <div className="text-xs text-slate-400">更新时间</div>
                    <div className="mt-1 text-sm font-semibold text-slate-800">{selectedFeed.time}</div>
                  </div>
                  <Link to={selectedFeed.path} className="material-button-secondary">
                    打开模块
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="col-span-12 xl:col-span-5">
          <div className="material-card p-6">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h3 className="text-slate-900">模块聚焦</h3>
                <p className="mt-1 text-sm text-slate-500">让首页不只是总览，也能承担导航和引导角色。</p>
              </div>
              <span className="material-chip bg-blue-50 text-blue-700">Featured</span>
            </div>
            <div className="space-y-4">
              {moduleSpotlights.map((item) => (
                <Link
                  key={item.title}
                  to={item.path}
                  className="block rounded-[24px] border border-slate-100 bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] p-5 transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-[0_16px_28px_rgba(25,118,210,0.12)]"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-base font-semibold text-slate-900">{item.title}</div>
                    <ArrowUpRight className="h-4 w-4 text-slate-400" />
                  </div>
                  <div className="mt-2 text-sm leading-6 text-slate-600">{item.helper}</div>
                  <div className="mt-4 text-sm font-semibold text-primary">{item.value}</div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="material-card overflow-hidden">
        <div className="flex flex-col gap-4 border-b border-slate-100 px-6 py-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-slate-900">待办事项</h3>
              <p className="mt-1 text-sm text-slate-500">首页就能筛选、分页并快速把任务推进到对应模块。</p>
            </div>
            <button type="button" onClick={() => setReportOpen(true)} className="material-button-primary w-fit">
              <BarChart3 className="h-4 w-4" />
              查看完整报表
            </button>
          </div>

          <div className="flex flex-wrap gap-3">
            {["全部", "待处理", "处理中", "待审批"].map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => changeFilter(item)}
                className={cn(
                  "rounded-full border px-4 py-2 text-sm font-semibold transition",
                  statusFilter === item
                    ? "border-blue-200 bg-blue-50 text-primary"
                    : "border-slate-200 bg-white text-slate-500 hover:border-slate-300",
                )}
              >
                {item}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-left">
            <thead className="bg-slate-50/90">
              <tr>
                {["事项名称", "来源模块", "负责人", "截止日期", "状态", "优先级", "操作"].map((title) => (
                  <th key={title} className="px-6 py-4 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    {title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pagedTodos.map((item) => (
                <tr key={item.id} className="transition hover:bg-blue-50/35">
                  <td className="px-6 py-4 text-sm font-semibold text-slate-800">{item.name}</td>
                  <td className="px-6 py-4 text-sm text-slate-500">{item.module}</td>
                  <td className="px-6 py-4 text-sm text-slate-700">{item.user}</td>
                  <td className="px-6 py-4 text-sm text-slate-500">{item.deadline}</td>
                  <td className="px-6 py-4">
                    <span className={cn("material-chip", statusTone[item.status])}>{item.status}</span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={cn("material-chip", priorityTone[item.priority])}>{item.priority}</span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <Link to={item.path} className="material-button-secondary px-3 py-2 text-xs">
                        进入模块
                      </Link>
                      <button
                        type="button"
                        onClick={() => {
                          setFocusedTodo(item);
                          handlePromote(item.name);
                        }}
                        className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-200"
                      >
                        标记重点
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-4 border-t border-slate-100 px-6 py-4 md:flex-row md:items-center md:justify-between">
          <div className="text-sm text-slate-500">
            共 {filteredTodos.length} 条待办，当前第 {page}/{totalPages} 页
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page === 1}
              className="material-button-secondary disabled:cursor-not-allowed disabled:opacity-50"
            >
              上一页
            </button>
            <button
              type="button"
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={page === totalPages}
              className="material-button-secondary disabled:cursor-not-allowed disabled:opacity-50"
            >
              下一页
            </button>
          </div>
        </div>
      </section>

      {analysisOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/28 px-4">
          <div className="material-card w-full max-w-3xl p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-slate-900">经营分析视图</h3>
                <p className="mt-1 text-sm text-slate-500">把首页入口改成真实可展开的分析面板。</p>
              </div>
              <button type="button" className="material-button-secondary px-3 py-2" onClick={() => setAnalysisOpen(false)}>
                关闭
              </button>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-3">
              {[
                ["售后闭环效率", "92%", "高优先级工单平均 3.1 小时进入诊断"],
                ["法规协同进度", "76%", "本周 4 个资料更新事项已关闭 3 个"],
                ["质量放行稳定度", "88%", "2 条记录仍待主管签批"],
              ].map(([label, value, helper]) => (
                <div key={label} className="material-panel">
                  <div className="text-xs uppercase tracking-[0.14em] text-slate-400">{label}</div>
                  <div className="mt-3 text-3xl font-bold text-slate-900">{value}</div>
                  <div className="mt-2 text-sm text-slate-600">{helper}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {reportOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/28 px-4">
          <div className="material-card w-full max-w-3xl p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-slate-900">完整报表</h3>
                <p className="mt-1 text-sm text-slate-500">这里先承接报表总览、导出和同步动作。</p>
              </div>
              <button type="button" className="material-button-secondary px-3 py-2" onClick={() => setReportOpen(false)}>
                关闭
              </button>
            </div>
            <div className="mt-5 space-y-3">
              {[
                "导出首页待办清单",
                "生成跨模块周报摘要",
                "同步高优先级事项到邮件摘要",
              ].map((item) => (
                <button key={item} type="button" className="material-panel w-full text-left text-sm text-slate-700 transition hover:border-blue-200" onClick={() => toast.success(`${item} 已触发`)}>
                  {item}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {chartOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/28 px-4">
          <div className="material-card w-full max-w-2xl p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-slate-900">图表钻取</h3>
                <p className="mt-1 text-sm text-slate-500">图表入口现在会展开状态明细，而不是只提示。</p>
              </div>
              <button type="button" className="material-button-secondary px-3 py-2" onClick={() => setChartOpen(false)}>
                关闭
              </button>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {barData.map((item) => (
                <div key={item.name} className="material-panel">
                  <div className="text-sm font-semibold text-slate-800">{item.name}</div>
                  <div className="mt-2 text-2xl font-bold text-slate-900">{item.value}</div>
                  <div className="mt-2 text-sm text-slate-600">当前状态对应的工单数量和推进建议可继续联动到售后列表。</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {focusedTodo ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/28 px-4">
          <div className="material-card w-full max-w-2xl p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-slate-900">重点事项详情</h3>
                <p className="mt-1 text-sm text-slate-500">“标记重点”现在会展开当前待办的详情卡。</p>
              </div>
              <button type="button" className="material-button-secondary px-3 py-2" onClick={() => setFocusedTodo(null)}>
                关闭
              </button>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="material-panel">
                <div className="text-base font-semibold text-slate-900">{focusedTodo.name}</div>
                <div className="mt-3 text-sm text-slate-600">来源模块：{focusedTodo.module}</div>
                <div className="mt-2 text-sm text-slate-600">负责人：{focusedTodo.user}</div>
                <div className="mt-2 text-sm text-slate-600">截止日期：{focusedTodo.deadline}</div>
              </div>
              <div className="material-panel">
                <div className="text-sm font-semibold text-slate-800">跟进建议</div>
                <div className="mt-3 space-y-2 text-sm text-slate-600">
                  <div>1. 先确认当前状态阻塞点。</div>
                  <div>2. 必要时直接进入对应模块补录信息。</div>
                  <div>3. 若超时风险较高，建议同步负责人并抄送部门主管。</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
