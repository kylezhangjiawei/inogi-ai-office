import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertCircle,
  BarChart3,
  CheckCircle2,
  Clock3,
  FileSearch,
  FileText,
  Folder,
  PackageCheck,
  Plus,
  Receipt,
  RefreshCw,
  Ticket,
  TrendingUp,
  Upload,
  UserCheck,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Link } from "react-router";

import { useAuth } from "./auth";
import { cn } from "./components/ui/utils";
import { fetchDashboardData, type DashboardData, type DashboardSource } from "./lib/dashboardApi";
import { hasPermission } from "./lib/permissions";

type TodoStatus = "待处理" | "处理中" | "待审批";
type TodoPriority = "高" | "中" | "低";

type DashboardTodoItem = {
  id: string;
  name: string;
  description: string;
  module: string;
  user: string;
  date: string;
  status: TodoStatus;
  priority: TodoPriority;
  path: string;
};

type DashboardActivityItem = {
  id: string;
  title: string;
  helper: string;
  time: string;
  timestamp: number;
  path: string;
  source: string;
};

type ModuleCard = {
  title: string;
  value: string;
  helper: string;
  description: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
};

const pageSize = 5;

const sourceNames: Record<DashboardSource, string> = {
  health: "系统健康检查",
  rd: "研发个人工作台",
  issues: "问题记录与 AI 定位",
  expenses: "费用报销看板",
  orders: "订货单处理工作台",
};

const issueStatusLabels = {
  pending: "待分析",
  analyzing: "分析中",
  adjusting: "调整中",
  adopted: "已采纳",
  archived: "已归档",
} as const;

const quickActionCatalog = [
  { title: "更新研发进度", icon: CheckCircle2, path: "/rd-my-workspace", permission: "page:rd-my-workspace" },
  { title: "记录研发问题", icon: Ticket, path: "/issue-ai", permission: "page:issue-ai" },
  { title: "处理订货单", icon: PackageCheck, path: "/order-workbench", permission: "page:order-workbench" },
  { title: "发起费用报销", icon: Receipt, path: "/expense-center", permission: "page:expense-center" },
  { title: "新建售后工单", icon: Plus, path: "/after-sales/new", permission: "page:after-sales" },
  { title: "上传报关资料", icon: Upload, path: "/customs-ai", permission: "page:customs-ai" },
  { title: "生成会议纪要", icon: FileSearch, path: "/meeting", permission: "page:meeting" },
  { title: "查询注册进度", icon: Clock3, path: "/registration-projects", permission: "page:registration-projects" },
  { title: "筛选候选人", icon: UserCheck, path: "/resume-screening", permission: "page:resume-screening" },
];

const statusTone: Record<TodoStatus, string> = {
  待处理: "bg-red-50 text-red-700",
  处理中: "bg-blue-50 text-blue-700",
  待审批: "bg-amber-50 text-amber-700",
};

const priorityTone: Record<TodoPriority, string> = {
  高: "bg-rose-50 text-rose-700",
  中: "bg-sky-50 text-sky-700",
  低: "bg-emerald-50 text-emerald-700",
};

function toTimestamp(value?: string | null) {
  if (!value) return 0;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value) ? value.replace(" ", "T") : value;
  const timestamp = new Date(normalized).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const timestamp = toTimestamp(value);
  if (!timestamp) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(timestamp);
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const timestamp = toTimestamp(value);
  if (!timestamp) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(timestamp);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 0,
  }).format(value);
}

function percent(value: number) {
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`;
}

function EmptyBlock({ title, helper }: { title: string; helper: string }) {
  return (
    <div className="flex min-h-36 flex-col items-center justify-center rounded-[22px] border border-dashed border-slate-200 bg-slate-50/60 px-6 text-center">
      <Folder className="h-7 w-7 text-slate-300" />
      <div className="mt-3 text-sm font-semibold text-slate-700">{title}</div>
      <div className="mt-1 max-w-md text-xs leading-5 text-slate-500">{helper}</div>
    </div>
  );
}

export function Dashboard() {
  const { user } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState("全部");
  const [page, setPage] = useState(1);
  const [selectedFeedId, setSelectedFeedId] = useState("");
  const [chartOpen, setChartOpen] = useState(false);
  const [focusedTodo, setFocusedTodo] = useState<DashboardTodoItem | null>(null);

  const permissionKey = (user?.permissions ?? []).join("\u0001");
  const userId = user?.id ?? "";
  const lastLoadedRef = useRef(0);

  const loadData = useCallback(
    async (initial = false) => {
      if (initial) setLoading(true);
      else setRefreshing(true);
      try {
        const next = await fetchDashboardData(user?.permissions ?? []);
        setData(next);
        lastLoadedRef.current = Date.now();
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    // permissionKey intentionally refreshes the aggregation after role/permission changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [permissionKey, userId],
  );

  useEffect(() => {
    void loadData(true);
    // 前台可见才轮询：后台标签页不再每 60s 打 5 个接口
    const interval = window.setInterval(() => {
      if (!document.hidden) void loadData(false);
    }, 60_000);
    // 切回前台/聚焦时，仅当数据已过期（>30s）才刷新，避免频繁 alt-tab 反复全量拉取
    const MIN_REFRESH_GAP = 30_000;
    const refreshIfStale = () => {
      if (document.hidden) return;
      if (Date.now() - lastLoadedRef.current < MIN_REFRESH_GAP) return;
      void loadData(false);
    };
    document.addEventListener("visibilitychange", refreshIfStale);
    window.addEventListener("focus", refreshIfStale);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshIfStale);
      window.removeEventListener("focus", refreshIfStale);
    };
  }, [loadData]);

  const rdTasks = useMemo(() => [...(data?.rd?.myTasks ?? []), ...(data?.rd?.collabTasks ?? [])], [data?.rd]);
  const activeRdTasks = useMemo(
    () => rdTasks.filter((task) => !["completed", "archived"].includes(task.status)),
    [rdTasks],
  );
  const completedRdTasks = rdTasks.length - activeRdTasks.length;
  const pendingReviewTasks = rdTasks.filter((task) => task.status === "pending_review").length;
  const expensePending = (data?.expenses?.statusBreakdown ?? [])
    .filter((item) => ["待识别", "待确认", "异常"].includes(item.status))
    .reduce((sum, item) => sum + item.count, 0);

  const loadedBusinessCount = [data?.rd, data?.issues, data?.expenses, data?.orders].filter(Boolean).length;
  const expectedBusinessCount = Math.max(0, (data?.enabledSources.length ?? 1) - 1);
  const totalPending =
    activeRdTasks.length +
    (data?.issues?.stats.pending ?? 0) +
    expensePending +
    (data?.orders?.stats.pending ?? 0);
  const totalClosed = completedRdTasks + (data?.issues?.stats.solved ?? 0) + (data?.orders?.stats.generated ?? 0);
  const currentTodos = (data?.rd?.todayTodos.length ?? 0) + (data?.expenses?.todos.length ?? 0);

  const heroMetrics = [
    {
      label: "数据模块",
      value: loading && !data ? "—" : `${loadedBusinessCount}/${expectedBusinessCount}`,
      helper: "按当前权限实时接入",
      icon: Activity,
    },
    { label: "待推进事项", value: loading && !data ? "—" : String(totalPending), helper: "跨已接入业务汇总", icon: Clock3 },
    { label: "已闭环记录", value: loading && !data ? "—" : String(totalClosed), helper: "任务、问题与订单", icon: CheckCircle2 },
    { label: "今日待办", value: loading && !data ? "—" : String(currentTodos), helper: "研发与费用接口", icon: TrendingUp },
  ];

  const moduleCards = useMemo<ModuleCard[]>(() => {
    const cards: ModuleCard[] = [];
    if (data?.rd) {
      cards.push({
        title: "研发待推进",
        value: String(activeRdTasks.length),
        helper: `${data.rd.myTasks.length} 项主责 · ${data.rd.collabTasks.length} 项协作`,
        description: `${pendingReviewTasks} 项待审核，${data.rd.todayTodos.length} 项今日待办`,
        path: "/rd-my-workspace",
        icon: CheckCircle2,
        tone: "text-indigo-700 bg-indigo-50",
      });
    }
    if (data?.issues) {
      cards.push({
        title: "问题待处理",
        value: String(data.issues.stats.pending),
        helper: `${data.issues.stats.solved} 项已解决 · 共 ${data.issues.stats.total} 项`,
        description: `平均定位 ${data.issues.stats.avgLocateHours} 小时，方案复用率 ${percent(data.issues.stats.reuseRate * 100)}`,
        path: "/issue-ai",
        icon: Ticket,
        tone: "text-red-600 bg-red-50",
      });
    }
    if (data?.expenses) {
      cards.push({
        title: "费用待处理",
        value: String(expensePending),
        helper: `本月 ${formatCurrency(data.expenses.monthAmount)}`,
        description: `${data.expenses.todos.length} 条费用提醒，累计 ${formatCurrency(data.expenses.totalAmount)}`,
        path: "/expense-center",
        icon: Receipt,
        tone: "text-amber-700 bg-amber-50",
      });
    }
    if (data?.orders) {
      cards.push({
        title: "订单待处理",
        value: String(data.orders.stats.pending),
        helper: `${data.orders.stats.abnormal} 项异常 · ${data.orders.stats.unexported} 项待导出`,
        description: `${data.orders.stats.generated} 项已生成单据，队列共 ${data.orders.queue.total} 项`,
        path: "/order-workbench",
        icon: PackageCheck,
        tone: "text-emerald-700 bg-emerald-50",
      });
    }
    return cards;
  }, [activeRdTasks.length, data, expensePending, pendingReviewTasks]);

  const quickActions = useMemo(
    () => quickActionCatalog.filter((action) => hasPermission(user?.permissions ?? [], action.permission)).slice(0, 6),
    [permissionKey, user?.permissions],
  );

  const activityItems = useMemo<DashboardActivityItem[]>(() => {
    const items: DashboardActivityItem[] = [];

    for (const notification of data?.rd?.notifications ?? []) {
      const rawTime = notification.created_at ?? notification.time;
      items.push({
        id: `rd-${notification.id}`,
        title: notification.title,
        helper: notification.message,
        time: formatDateTime(rawTime),
        timestamp: toTimestamp(rawTime),
        path: "/rd-my-workspace",
        source: "研发工作台",
      });
    }

    for (const issue of data?.issues?.recent ?? []) {
      items.push({
        id: `issue-${issue.id}`,
        title: issue.title,
        helper: `${issue.id} · ${issue.product || (issue.source === "rd" ? "研发" : "生产")} · ${issueStatusLabels[issue.status]}`,
        time: formatDateTime(issue.updatedAt),
        timestamp: toTimestamp(issue.updatedAt),
        path: "/issue-ai",
        source: "问题记录",
      });
    }

    for (const activity of data?.expenses?.activities ?? []) {
      items.push({
        id: `expense-${activity.id}`,
        title: activity.title,
        helper: activity.detail,
        time: formatDateTime(activity.time),
        timestamp: toTimestamp(activity.time),
        path: "/expense-center",
        source: "费用报销",
      });
    }

    for (const order of data?.orders?.queue.items ?? []) {
      const rawTime = order.createdAt || order.date;
      items.push({
        id: `order-${order.id}`,
        title: `${order.customer} · ${order.id}`,
        helper: `${order.status}${order.generated ? " · 单据已生成" : " · 待生成单据"}`,
        time: formatDateTime(rawTime),
        timestamp: toTimestamp(rawTime),
        path: "/order-workbench",
        source: "订货单处理",
      });
    }

    return items.sort((left, right) => right.timestamp - left.timestamp).slice(0, 8);
  }, [data]);

  useEffect(() => {
    if (!activityItems.length) {
      setSelectedFeedId("");
      return;
    }
    if (!activityItems.some((item) => item.id === selectedFeedId)) {
      setSelectedFeedId(activityItems[0].id);
    }
  }, [activityItems, selectedFeedId]);

  const selectedFeed = activityItems.find((item) => item.id === selectedFeedId) ?? activityItems[0] ?? null;

  const chartConfig = useMemo(() => {
    if (data?.issues) {
      return {
        title: "问题处理状态",
        helper: "来自问题记录与 AI 定位接口的实时统计",
        path: "/issue-ai",
        data: [
          { name: "待分析", value: data.issues.distribution.pending },
          { name: "分析中", value: data.issues.distribution.processing },
          { name: "已解决", value: data.issues.distribution.solved },
        ],
      };
    }
    if (data?.orders) {
      return {
        title: "订单处理状态",
        helper: "来自订货单处理工作台接口的实时统计",
        path: "/order-workbench",
        data: [
          { name: "待处理", value: data.orders.stats.pending },
          { name: "异常", value: data.orders.stats.abnormal },
          { name: "已生成", value: data.orders.stats.generated },
          { name: "待导出", value: data.orders.stats.unexported },
        ],
      };
    }
    return { title: "业务状态分布", helper: "暂无有权限且支持统计的业务接口", path: "/", data: [] };
  }, [data]);

  const todoItems = useMemo<DashboardTodoItem[]>(() => {
    const items: DashboardTodoItem[] = [];

    for (const task of activeRdTasks) {
      const status: TodoStatus = task.status === "pending_review" ? "待审批" : task.status === "in_progress" ? "处理中" : "待处理";
      items.push({
        id: `rd-${task.task_id}`,
        name: task.title,
        description: task.next_action || task.description || "进入研发工作台查看任务详情",
        module: "研发任务",
        user: task.owner || user?.name || "—",
        date: formatDate(task.due_date),
        status,
        priority: task.priority === "high" ? "高" : task.priority === "medium" ? "中" : "低",
        path: "/rd-my-workspace",
      });
    }

    for (const issue of data?.issues?.recent ?? []) {
      if (["adopted", "archived"].includes(issue.status)) continue;
      items.push({
        id: `issue-${issue.id}`,
        name: issue.title,
        description: `${issue.id} · ${issue.description || "进入问题记录查看详情"}`,
        module: "问题记录",
        user: issue.createdBy || "—",
        date: formatDate(issue.updatedAt),
        status: issue.status === "pending" ? "待处理" : "处理中",
        priority: ["fatal", "major"].includes(issue.severity) ? "高" : issue.severity === "normal" ? "中" : "低",
        path: "/issue-ai",
      });
    }

    for (const todo of data?.expenses?.todos ?? []) {
      items.push({
        id: `expense-${todo.id}`,
        name: todo.title,
        description: todo.detail,
        module: "费用报销",
        user: user?.name || "当前用户",
        date: "—",
        status: todo.severity === "info" ? "处理中" : "待处理",
        priority: todo.severity === "error" ? "高" : todo.severity === "warning" ? "中" : "低",
        path: "/expense-center",
      });
    }

    for (const order of data?.orders?.queue.items ?? []) {
      if (order.generated && order.type === "success") continue;
      items.push({
        id: `order-${order.id}`,
        name: `${order.customer} · ${order.id}`,
        description: order.status,
        module: "订货单处理",
        user: "订单处理人",
        date: formatDate(order.date),
        status: order.type === "error" ? "待处理" : "处理中",
        priority: order.type === "error" ? "高" : order.type === "warning" ? "中" : "低",
        path: "/order-workbench",
      });
    }

    const priorityOrder: Record<TodoPriority, number> = { 高: 0, 中: 1, 低: 2 };
    return items.sort((left, right) => priorityOrder[left.priority] - priorityOrder[right.priority]);
  }, [activeRdTasks, data, user?.name]);

  const filteredTodos = useMemo(
    () => todoItems.filter((item) => statusFilter === "全部" || item.status === statusFilter),
    [statusFilter, todoItems],
  );
  const totalPages = Math.max(1, Math.ceil(filteredTodos.length / pageSize));
  const pagedTodos = filteredTodos.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  const changeFilter = (nextFilter: string) => {
    setStatusFilter(nextFilter);
    setPage(1);
  };

  const errorEntries = Object.entries(data?.errors ?? {}) as Array<[DashboardSource, string]>;
  const enabledCount = data?.enabledSources.length ?? 1;
  const loadedCount =
    Number(Boolean(data?.health)) + Number(Boolean(data?.rd)) + Number(Boolean(data?.issues)) + Number(Boolean(data?.expenses)) + Number(Boolean(data?.orders));
  const syncRate = enabledCount > 0 ? (loadedCount / enabledCount) * 100 : 0;
  const closeRate = totalPending + totalClosed > 0 ? (totalClosed / (totalPending + totalClosed)) * 100 : 0;
  const healthState = data?.health?.ok ? (errorEntries.length ? "partial" : "stable") : "offline";
  const healthMetrics = [
    { label: "核心接口健康度", value: data?.health?.ok ? 100 : 0, color: data?.health?.ok ? "bg-emerald-500" : "bg-red-500" },
    { label: "数据源加载完整度", value: syncRate, color: "bg-indigo-500" },
    { label: "当前事项闭环率", value: closeRate, color: "bg-indigo-500" },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="grid grid-cols-12 gap-6">
        <div className="col-span-12 xl:col-span-8">
          <div className="material-card material-glow relative h-full overflow-hidden p-7 md:p-8">
            <div className="absolute inset-y-0 right-0 hidden w-[42%] bg-[radial-gradient(circle_at_center,rgba(79,70,229,0.08),transparent_64%)] xl:block" />
            <div className="relative z-10 flex h-full flex-col gap-8">
              <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                <div className="max-w-2xl space-y-4">
                  <span className="material-chip bg-indigo-50 text-indigo-700">Realtime Workspace</span>
                  <div>
                    <h2 className="text-[2rem] font-bold tracking-tight text-slate-900 md:text-[2.35rem]">智能办公总览</h2>
                    <p className="mt-3 text-sm leading-7 text-slate-600 md:text-base">
                      首页已按当前账号权限汇总研发、问题、费用与订单模块；每个数字均来自对应业务接口，未接入模块不再展示演示数据。
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs text-slate-500">
                    <span className="material-chip bg-white/85 text-slate-700 shadow-sm">当前用户：{user?.name || "—"}</span>
                    <span className="material-chip bg-white/85 text-slate-700 shadow-sm">
                      最近同步：{data ? formatDateTime(data.loadedAt) : "正在连接"}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => void loadData(false)}
                  disabled={refreshing}
                  className="material-button-secondary w-fit shrink-0 self-start whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
                  {refreshing ? "同步中" : "刷新数据"}
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {heroMetrics.map((item) => (
                  <div key={item.label} className="rounded-[24px] border border-slate-200/70 bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-2">
                        <div className="whitespace-nowrap text-sm font-semibold text-slate-500">{item.label}</div>
                        <div className="text-[1.8rem] font-bold leading-none tracking-tight text-slate-900">{item.value}</div>
                        <div className="text-xs font-medium text-slate-500">{item.helper}</div>
                      </div>
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-sm">
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
              <div
                className={cn(
                  "rounded-2xl px-3 py-1 text-xs font-semibold",
                  healthState === "stable" && "bg-emerald-50 text-emerald-700",
                  healthState === "partial" && "bg-amber-50 text-amber-700",
                  healthState === "offline" && "bg-red-50 text-red-700",
                )}
              >
                {healthState === "stable" ? "运行正常" : healthState === "partial" ? "部分可用" : "连接异常"}
              </div>
            </div>

            <div className="space-y-4">
              {healthMetrics.map((item) => (
                <div key={item.label} className="rounded-[20px] border border-slate-100 bg-slate-50/70 p-4">
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="font-medium text-slate-600">{item.label}</span>
                    <span className="font-semibold text-slate-900">{percent(item.value)}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white">
                    <div className={cn("h-2 rounded-full transition-[width] duration-300", item.color)} style={{ width: percent(item.value) }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 text-xs leading-5 text-slate-500">
              后端版本 {data?.health?.release || "—"} · 服务 {data?.health?.service || "未连接"}
            </div>
          </div>
        </div>
      </section>

      {errorEntries.length ? (
        <section role="alert" className="flex flex-col gap-3 rounded-[24px] border border-amber-200 bg-amber-50/80 px-5 py-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
            <div>
              <div className="text-sm font-semibold text-amber-900">部分数据暂未同步</div>
              <div className="mt-1 text-xs leading-5 text-amber-800">
                {errorEntries.map(([source, message]) => `${sourceNames[source]}：${message}`).join("；")}
              </div>
            </div>
          </div>
          <button type="button" onClick={() => void loadData(false)} className="material-button-secondary shrink-0 self-start md:self-auto">
            重试失败项
          </button>
        </section>
      ) : null}

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {loading && !data
          ? Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="material-card-flat animate-pulse p-5">
                <div className="h-4 w-24 rounded bg-slate-100" />
                <div className="mt-4 h-10 w-16 rounded bg-slate-100" />
                <div className="mt-3 h-3 w-40 rounded bg-slate-100" />
              </div>
            ))
          : moduleCards.map((card) => (
              <Link key={card.title} to={card.path} className="material-card-flat block p-5 transition hover:-translate-y-0.5 hover:border-indigo-200">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-500">{card.title}</div>
                    <div className="mt-3 text-4xl font-bold tracking-tight text-slate-900">{card.value}</div>
                    <div className="mt-2 truncate text-sm text-slate-500">{card.helper}</div>
                  </div>
                  <div className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl", card.tone)}>
                    <card.icon className="h-6 w-6" />
                  </div>
                </div>
              </Link>
            ))}
      </section>

      {!loading && !moduleCards.length ? (
        <EmptyBlock title="暂无可汇总的业务模块" helper="当前账号只有首页权限，或尚未开通支持首页汇总的研发、问题、费用与订单模块。" />
      ) : null}

      <section className="grid grid-cols-12 gap-6">
        <div className="col-span-12 xl:col-span-7">
          <div className="material-card h-full p-6">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h3 className="text-slate-900">{chartConfig.title}</h3>
                <p className="mt-1 text-sm text-slate-500">{chartConfig.helper}</p>
              </div>
              {chartConfig.data.length ? (
                <button
                  type="button"
                  onClick={() => setChartOpen(true)}
                  aria-label="查看状态明细"
                  className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-500 transition hover:bg-slate-200"
                >
                  <BarChart3 className="h-5 w-5" />
                </button>
              ) : null}
            </div>

            {chartConfig.data.length ? (
              <div className="rounded-[24px] bg-slate-50/60 p-4">
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartConfig.data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                      <CartesianGrid horizontal={false} stroke="#e5edf7" />
                      <XAxis type="number" allowDecimals={false} hide />
                      <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} width={68} tick={{ fill: "#5f6b7a", fontSize: 13 }} />
                      <Tooltip
                        cursor={{ fill: "rgba(79, 70, 229, 0.06)" }}
                        contentStyle={{ borderRadius: 16, border: "1px solid #d8e2ee", boxShadow: "0 12px 28px rgba(15, 23, 42, 0.12)" }}
                      />
                      <Bar dataKey="value" radius={[0, 10, 10, 0]} barSize={22}>
                        {chartConfig.data.map((item, index) => (
                          <Cell key={item.name} fill={["#c7d2fe", "#a5b4fc", "#6366f1", "#4f46e5"][index]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ) : (
              <EmptyBlock title="暂无状态统计" helper="问题或订单模块开通后，这里会显示对应接口的状态分布。" />
            )}
          </div>
        </div>

        <div className="col-span-12 xl:col-span-5">
          <div className="material-card h-full p-6">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h3 className="text-slate-900">快捷操作</h3>
                <p className="mt-1 text-sm text-slate-500">仅展示当前账号有权限进入的高频功能。</p>
              </div>
              <span className="material-chip bg-slate-100 text-slate-600">{quickActions.length} Actions</span>
            </div>

            {quickActions.length ? (
              <div className="grid grid-cols-2 gap-4">
                {quickActions.map((action) => (
                  <Link key={action.title} to={action.path} className="group rounded-[24px] border border-slate-200 bg-white p-4 transition hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-[0_10px_22px_-8px_rgba(79,70,229,0.18)]">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-primary transition group-hover:bg-indigo-100">
                      <action.icon className="h-5 w-5" />
                    </div>
                    <div className="mt-4 text-sm font-semibold leading-6 text-slate-800">{action.title}</div>
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyBlock title="暂无快捷操作" helper="快捷入口会依据当前账号的页面权限自动生成。" />
            )}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-12 gap-6">
        <div className="col-span-12">
          <div className="material-card p-6">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h3 className="text-slate-900">跨模块动态</h3>
                <p className="mt-1 text-sm text-slate-500">研发通知、问题更新、费用事件与订单队列的最近记录。</p>
              </div>
              <span className="material-chip bg-slate-100 text-slate-600">{activityItems.length} Events</span>
            </div>
            {activityItems.length && selectedFeed ? (
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
                <div className="space-y-3">
                  {activityItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedFeedId(item.id)}
                      className={cn(
                        "w-full rounded-[22px] border p-4 text-left transition",
                        selectedFeedId === item.id ? "border-indigo-200 bg-indigo-50/50" : "border-slate-100 bg-slate-50/70 hover:border-slate-200",
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold text-slate-800">{item.title}</div>
                        <span className="material-chip shrink-0 bg-white text-slate-500">{item.time}</span>
                      </div>
                      <div className="mt-2 line-clamp-2 text-sm text-slate-600">{item.helper}</div>
                    </button>
                  ))}
                </div>
                <div className="rounded-[24px] border border-slate-100 bg-slate-50/60 p-5">
                  <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">{selectedFeed.source}</div>
                  <div className="mt-3 text-lg font-semibold text-slate-900">{selectedFeed.title}</div>
                  <div className="mt-3 text-sm leading-6 text-slate-600">{selectedFeed.helper}</div>
                  <div className="mt-5 flex items-center justify-between rounded-2xl border border-slate-100 bg-white px-4 py-3">
                    <div>
                      <div className="text-xs text-slate-400">更新时间</div>
                      <div className="mt-1 text-sm font-semibold text-slate-800">{selectedFeed.time}</div>
                    </div>
                    <Link to={selectedFeed.path} className="material-button-secondary">打开模块</Link>
                  </div>
                </div>
              </div>
            ) : (
              <EmptyBlock title="暂无动态记录" helper="已接入模块当前没有通知、活动或最近更新。" />
            )}
          </div>
        </div>

      </section>

      <section className="material-card overflow-hidden">
        <div className="flex flex-col gap-4 border-b border-slate-100 px-6 py-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-slate-900">待办事项</h3>
              <p className="mt-1 text-sm text-slate-500">来自研发任务、待处理问题、费用提醒与订单队列。</p>
            </div>
            <button type="button" onClick={() => void loadData(false)} disabled={refreshing} className="material-button-primary w-fit disabled:cursor-not-allowed disabled:opacity-60">
              <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
              同步待办
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
                  statusFilter === item ? "border-indigo-200 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white text-slate-500 hover:border-slate-300",
                )}
              >
                {item}
              </button>
            ))}
          </div>
        </div>

        <div className="material-scrollbar overflow-x-auto">
          <table className="w-full min-w-[900px] text-left">
            <thead className="bg-slate-50/90">
              <tr>
                {["事项名称", "来源模块", "负责人", "截止/更新时间", "状态", "优先级", "操作"].map((title) => (
                  <th key={title} className="px-6 py-4 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{title}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pagedTodos.map((item) => (
                <tr key={item.id} className="transition hover:bg-indigo-50/40">
                  <td className="max-w-[280px] px-6 py-4">
                    <div className="truncate text-sm font-semibold text-slate-800">{item.name}</div>
                    <div className="mt-1 truncate text-xs text-slate-400">{item.description}</div>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-500">{item.module}</td>
                  <td className="px-6 py-4 text-sm text-slate-700">{item.user}</td>
                  <td className="px-6 py-4 text-sm text-slate-500">{item.date}</td>
                  <td className="px-6 py-4"><span className={cn("material-chip", statusTone[item.status])}>{item.status}</span></td>
                  <td className="px-6 py-4"><span className={cn("material-chip", priorityTone[item.priority])}>{item.priority}</span></td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <Link to={item.path} className="material-button-secondary px-3 py-2 text-xs">进入模块</Link>
                      <button type="button" onClick={() => setFocusedTodo(item)} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-200">查看详情</button>
                    </div>
                  </td>
                </tr>
              ))}
              {!pagedTodos.length ? (
                <tr><td colSpan={7} className="px-6 py-12 text-center text-sm text-slate-500">当前筛选条件下没有待办事项</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-4 border-t border-slate-100 px-6 py-4 md:flex-row md:items-center md:justify-between">
          <div className="text-sm text-slate-500">共 {filteredTodos.length} 条待办，当前第 {page}/{totalPages} 页</div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1} className="material-button-secondary disabled:cursor-not-allowed disabled:opacity-50">上一页</button>
            <button type="button" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page === totalPages} className="material-button-secondary disabled:cursor-not-allowed disabled:opacity-50">下一页</button>
          </div>
        </div>
      </section>

      {chartOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/28 px-4" role="dialog" aria-modal="true" aria-label="状态统计明细">
          <div className="material-card w-full max-w-2xl p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-slate-900">{chartConfig.title}明细</h3>
                <p className="mt-1 text-sm text-slate-500">以下数字与首页图表使用同一份接口结果。</p>
              </div>
              <button type="button" className="material-button-secondary px-3 py-2" onClick={() => setChartOpen(false)}>关闭</button>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {chartConfig.data.map((item) => (
                <div key={item.name} className="material-panel">
                  <div className="text-sm font-semibold text-slate-800">{item.name}</div>
                  <div className="mt-2 text-2xl font-bold text-slate-900">{item.value}</div>
                </div>
              ))}
            </div>
            {chartConfig.path !== "/" ? <Link to={chartConfig.path} className="material-button-primary mt-5 w-fit">进入数据来源模块</Link> : null}
          </div>
        </div>
      ) : null}

      {focusedTodo ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/28 px-4" role="dialog" aria-modal="true" aria-label="待办事项详情">
          <div className="material-card w-full max-w-2xl p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-slate-900">待办事项详情</h3>
                <p className="mt-1 text-sm text-slate-500">数据来源：{focusedTodo.module}</p>
              </div>
              <button type="button" className="material-button-secondary px-3 py-2" onClick={() => setFocusedTodo(null)}>关闭</button>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="material-panel">
                <div className="text-base font-semibold text-slate-900">{focusedTodo.name}</div>
                <div className="mt-3 text-sm leading-6 text-slate-600">{focusedTodo.description}</div>
              </div>
              <div className="material-panel space-y-2 text-sm text-slate-600">
                <div>负责人：{focusedTodo.user}</div>
                <div>截止/更新时间：{focusedTodo.date}</div>
                <div>状态：{focusedTodo.status}</div>
                <div>优先级：{focusedTodo.priority}</div>
              </div>
            </div>
            <Link to={focusedTodo.path} className="material-button-primary mt-5 w-fit">进入模块处理</Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
