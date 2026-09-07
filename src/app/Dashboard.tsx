import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertCircle,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  Clock3,
  FileSearch,
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
import { AutoTranslatedText } from "./components/TranslatableText";
import {
  HorizonEmptyState,
  HorizonMetric,
  HorizonMetricGrid,
  HorizonPageHeader,
  HorizonSectionHeader,
} from "./components/horizon/HorizonPage";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";
import { cn } from "./components/ui/utils";
import { fetchDashboardData, type DashboardData, type DashboardSource } from "./lib/dashboardApi";
import { i18nLocale, useI18n } from "./lib/i18n";
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
  待处理: "bg-muted text-muted-foreground",
  处理中: "bg-primary/10 text-primary",
  待审批: "bg-amber-50 text-amber-700",
};

const priorityTone: Record<TodoPriority, string> = {
  高: "bg-rose-50 text-rose-700",
  中: "bg-muted text-muted-foreground",
  低: "bg-muted text-muted-foreground",
};

function toTimestamp(value?: string | null) {
  if (!value) return 0;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value) ? value.replace(" ", "T") : value;
  const timestamp = new Date(normalized).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function formatDateTime(value?: string | null, locale = i18nLocale()) {
  if (!value) return "—";
  const timestamp = toTimestamp(value);
  if (!timestamp) return value;
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(timestamp);
}

function formatDate(value?: string | null, locale = i18nLocale()) {
  if (!value) return "—";
  const timestamp = toTimestamp(value);
  if (!timestamp) return value;
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(timestamp);
}

function formatCurrency(value: number, locale = i18nLocale()) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 0,
  }).format(value);
}

function percent(value: number) {
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`;
}

function EmptyBlock({ title, helper, action }: { title: string; helper: string; action?: React.ReactNode }) {
  return <HorizonEmptyState Icon={Folder} title={title} description={helper} action={action} />;
}

export function Dashboard() {
  const { lang, t } = useI18n();
  const locale = i18nLocale();
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

  const moduleCards = useMemo<ModuleCard[]>(() => {
    const cards: ModuleCard[] = [];
    if (data?.rd) {
      cards.push({
        title: t("研发待推进"),
        value: String(activeRdTasks.length),
        helper: t("{primary} 项主责 · {collab} 项协作", { primary: data.rd.myTasks.length, collab: data.rd.collabTasks.length }),
        description: t("{reviews} 项待审核，{todos} 项今日待办", { reviews: pendingReviewTasks, todos: data.rd.todayTodos.length }),
        path: "/rd-my-workspace",
        icon: CheckCircle2,
      });
    }
    if (data?.issues) {
      cards.push({
        title: t("问题待处理"),
        value: String(data.issues.stats.pending),
        helper: t("{solved} 项已解决 · 共 {total} 项", { solved: data.issues.stats.solved, total: data.issues.stats.total }),
        description: t("平均定位 {hours} 小时，方案复用率 {rate}", { hours: data.issues.stats.avgLocateHours, rate: percent(data.issues.stats.reuseRate * 100) }),
        path: "/issue-ai",
        icon: Ticket,
      });
    }
    if (data?.expenses) {
      cards.push({
        title: t("费用待处理"),
        value: String(expensePending),
        helper: t("本月 {amount}", { amount: formatCurrency(data.expenses.monthAmount, locale) }),
        description: t("{count} 条费用提醒，累计 {amount}", { count: data.expenses.todos.length, amount: formatCurrency(data.expenses.totalAmount, locale) }),
        path: "/expense-center",
        icon: Receipt,
      });
    }
    if (data?.orders) {
      cards.push({
        title: t("订单待处理"),
        value: String(data.orders.stats.pending),
        helper: t("{abnormal} 项异常 · {unexported} 项待导出", { abnormal: data.orders.stats.abnormal, unexported: data.orders.stats.unexported }),
        description: t("{generated} 项已生成单据，队列共 {total} 项", { generated: data.orders.stats.generated, total: data.orders.queue.total }),
        path: "/order-workbench",
        icon: PackageCheck,
      });
    }
    return cards;
  }, [activeRdTasks.length, data, expensePending, lang, locale, pendingReviewTasks, t]);

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
        time: formatDateTime(rawTime, locale),
        timestamp: toTimestamp(rawTime),
        path: "/rd-my-workspace",
        source: t("研发工作台"),
      });
    }

    for (const issue of data?.issues?.recent ?? []) {
      items.push({
        id: `issue-${issue.id}`,
        title: issue.title,
        helper: `${issue.id} · ${t(issue.product || (issue.source === "rd" ? "研发" : "生产"))} · ${t(issueStatusLabels[issue.status])}`,
        time: formatDateTime(issue.updatedAt, locale),
        timestamp: toTimestamp(issue.updatedAt),
        path: "/issue-ai",
        source: t("问题记录"),
      });
    }

    for (const activity of data?.expenses?.activities ?? []) {
      items.push({
        id: `expense-${activity.id}`,
        title: activity.title,
        helper: activity.detail,
        time: formatDateTime(activity.time, locale),
        timestamp: toTimestamp(activity.time),
        path: "/expense-center",
        source: t("费用报销"),
      });
    }

    for (const order of data?.orders?.queue.items ?? []) {
      const rawTime = order.createdAt || order.date;
      items.push({
        id: `order-${order.id}`,
        title: `${order.customer} · ${order.id}`,
        helper: `${t(order.status)} · ${order.generated ? t("单据已生成") : t("待生成单据")}`,
        time: formatDateTime(rawTime, locale),
        timestamp: toTimestamp(rawTime),
        path: "/order-workbench",
        source: t("订货单处理"),
      });
    }

    return items.sort((left, right) => right.timestamp - left.timestamp).slice(0, 8);
  }, [data, lang, locale, t]);

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
        title: t("问题处理状态"),
        helper: t("查看各阶段的问题数量，优先跟进待处理事项。"),
        path: "/issue-ai",
        data: [
          { name: t("待分析"), value: data.issues.distribution.pending },
          { name: t("分析中"), value: data.issues.distribution.processing },
          { name: t("已解决"), value: data.issues.distribution.solved },
        ],
      };
    }
    if (data?.orders) {
      return {
        title: t("订单处理状态"),
        helper: t("查看订单处理进度，及时跟进异常与待导出单据。"),
        path: "/order-workbench",
        data: [
          { name: t("待处理"), value: data.orders.stats.pending },
          { name: t("异常"), value: data.orders.stats.abnormal },
          { name: t("已生成"), value: data.orders.stats.generated },
          { name: t("待导出"), value: data.orders.stats.unexported },
        ],
      };
    }
    return { title: t("业务状态分布"), helper: t("问题与订单的当前处理进度。"), path: "/", data: [] };
  }, [data, lang, t]);

  const todoItems = useMemo<DashboardTodoItem[]>(() => {
    const items: DashboardTodoItem[] = [];

    for (const task of activeRdTasks) {
      const status: TodoStatus = task.status === "pending_review" ? "待审批" : task.status === "in_progress" ? "处理中" : "待处理";
      items.push({
        id: `rd-${task.task_id}`,
        name: task.title,
        description: task.next_action || task.description || t("进入研发工作台查看任务详情"),
        module: t("研发任务"),
        user: task.owner || user?.name || "—",
        date: formatDate(task.due_date, locale),
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
        description: `${issue.id} · ${issue.description || t("进入问题记录查看详情")}`,
        module: t("问题记录"),
        user: issue.createdBy || "—",
        date: formatDate(issue.updatedAt, locale),
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
        module: t("费用报销"),
        user: user?.name || t("当前用户"),
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
        module: t("订货单处理"),
        user: t("订单处理人"),
        date: formatDate(order.date, locale),
        status: order.type === "error" ? "待处理" : "处理中",
        priority: order.type === "error" ? "高" : order.type === "warning" ? "中" : "低",
        path: "/order-workbench",
      });
    }

    const priorityOrder: Record<TodoPriority, number> = { 高: 0, 中: 1, 低: 2 };
    return items.sort((left, right) => priorityOrder[left.priority] - priorityOrder[right.priority]);
  }, [activeRdTasks, data, lang, locale, t, user?.name]);

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
    { label: t("核心接口健康度"), value: data?.health?.ok ? 100 : 0, color: data?.health?.ok ? "bg-primary" : "bg-red-500" },
    { label: t("数据源加载完整度"), value: syncRate, color: "bg-primary/70" },
    { label: t("当前事项闭环率"), value: closeRate, color: "bg-primary/40" },
  ];

  const refreshAction = (
    <button
      type="button"
      onClick={() => void loadData(false)}
      disabled={refreshing}
      className="inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-semibold text-primary hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <RefreshCw className="size-4" aria-hidden="true" />
      {refreshing ? t("同步中") : t("刷新数据")}
    </button>
  );

  return (
    <div className="horizon-theme hz-page hz-dashboard mx-auto max-w-[1500px] space-y-6">
      <HorizonPageHeader
        Icon={Activity}
        titleLevel={2}
        eyebrow={t("我的工作台")}
        title={t("欢迎回来，{name}", { name: user?.name || t("当前用户") })}
        description={t("从待办开始，掌握研发、问题、费用与订单的最新进展。")}
        meta={(
          <>
            <span className="tabular-nums">{t("最近同步：{time}", { time: data ? formatDateTime(data.loadedAt, locale) : t("正在连接") })}</span>
            <span className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium",
              loading && !data ? "bg-muted text-muted-foreground" : healthState === "stable" ? "bg-primary/10 text-primary" : healthState === "partial" ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700",
            )}>
              <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
              {loading && !data ? t("正在连接") : healthState === "stable" ? t("运行正常") : healthState === "partial" ? t("部分可用") : t("连接异常")}
            </span>
          </>
        )}
        actions={refreshAction}
      />

      <HorizonMetricGrid>
        <HorizonMetric Icon={Clock3} label={t("待推进事项")} value={loading && !data ? "—" : totalPending} note={t("跨已接入业务汇总")} tone="brand" />
        <HorizonMetric Icon={TrendingUp} label={t("今日待办")} value={loading && !data ? "—" : currentTodos} note={t("研发与费用提醒")} tone="neutral" />
        <HorizonMetric Icon={CheckCircle2} label={t("已闭环记录")} value={loading && !data ? "—" : totalClosed} note={t("任务、问题与订单")} tone="neutral" />
        <HorizonMetric Icon={Activity} label={t("数据模块")} value={loading && !data ? "—" : `${loadedBusinessCount}/${expectedBusinessCount}`} note={t("按当前权限汇总")} tone="neutral" />
      </HorizonMetricGrid>

      {errorEntries.length ? (
        <section role="alert" className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 size-5 shrink-0 text-amber-700" aria-hidden="true" />
            <div className="min-w-0">
              <h2 className="text-balance text-sm font-semibold text-amber-900">{t("部分数据暂未同步")}</h2>
              <div className="mt-1 text-pretty break-words text-xs leading-5 text-amber-800">
                {errorEntries.map(([source, message], index) => (
                  <React.Fragment key={source}>
                    {index > 0 ? (lang === "en" ? "; " : "；") : ""}
                    {t(sourceNames[source])}{lang === "en" ? ": " : "："}<AutoTranslatedText text={message} />
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>
          <button type="button" onClick={() => void loadData(false)} disabled={refreshing} className="min-h-10 shrink-0 cursor-pointer self-start rounded-xl border border-amber-300 bg-card px-4 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60 md:self-auto">
            {refreshing ? t("同步中") : t("重试失败项")}
          </button>
        </section>
      ) : null}

      <div className="hz-dashboard-work grid min-w-0 grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="hz-surface hz-dashboard-todos min-w-0 overflow-hidden" aria-busy={loading && !data}>
          <HorizonSectionHeader
            Icon={Clock3}
            title={t("待办事项")}
            description={t("优先处理高优先级事项，再跟进进行中的工作。")}
            trailing={(
              <button type="button" onClick={() => void loadData(false)} disabled={refreshing} className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60">
                <RefreshCw className="size-4" aria-hidden="true" />
                {refreshing ? t("同步中") : t("同步待办")}
              </button>
            )}
          />
          <div className="hz-toolbar flex flex-wrap gap-2 border-b px-5 py-3" role="group" aria-label={t("待办状态筛选")}>
            {([
              { key: "全部", label: t("全部") },
              { key: "待处理", label: t("待处理") },
              { key: "处理中", label: t("处理中") },
              { key: "待审批", label: t("待审批") },
            ] as const).map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => changeFilter(item.key)}
                className={cn(
                  "min-h-9 cursor-pointer rounded-xl px-3.5 py-2 text-xs font-semibold",
                  statusFilter === item.key ? "bg-primary text-primary-foreground" : "bg-transparent text-muted-foreground hover:bg-muted",
                )}
                aria-pressed={statusFilter === item.key}
              >
                {item.label}
              </button>
            ))}
          </div>

          {loading && !data ? (
            <div className="space-y-5 px-5 py-6" role="status" aria-label={t("正在加载待办") }>
              <span className="sr-only">{t("正在加载待办")}</span>
              {Array.from({ length: 4 }, (_, index) => (
                <div key={index} className="flex items-center gap-4" aria-hidden="true">
                  <div className="size-10 shrink-0 rounded-xl bg-muted" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-3/4 rounded bg-muted" />
                    <div className="h-3 w-1/2 rounded bg-muted" />
                  </div>
                  <div className="h-7 w-16 rounded-lg bg-muted" />
                </div>
              ))}
            </div>
          ) : pagedTodos.length ? (
            <>
              <div className="divide-y divide-border px-5 md:hidden">
                {pagedTodos.map((item) => (
                  <article key={item.id} className="py-5">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="text-xs text-muted-foreground">{item.module}</span>
                      <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", statusTone[item.status])}>{t(item.status)}</span>
                      <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", priorityTone[item.priority])}>{t("优先级：{priority}", { priority: t(item.priority) })}</span>
                    </div>
                    <h3 className="text-balance break-words text-sm font-semibold text-foreground"><AutoTranslatedText text={item.name} /></h3>
                    <AutoTranslatedText as="p" className="mt-1 line-clamp-2 text-pretty text-xs leading-5 text-muted-foreground" text={item.description} />
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>{t("负责人：{name}", { name: item.user })}</span>
                      <span className="tabular-nums">{item.date}</span>
                    </div>
                    <div className="mt-4 flex gap-2">
                      <Link to={item.path} className="inline-flex min-h-10 items-center justify-center rounded-xl bg-primary/10 px-3 text-xs font-semibold text-primary hover:bg-primary/15">{t("进入模块")}</Link>
                      <button type="button" onClick={() => setFocusedTodo(item)} className="min-h-10 cursor-pointer rounded-xl bg-muted px-3 text-xs font-semibold text-muted-foreground hover:bg-muted/70">{t("查看详情")}</button>
                    </div>
                  </article>
                ))}
              </div>
              <div className="material-scrollbar hidden overflow-x-auto md:block">
                <table className="w-full min-w-[760px] text-left">
                  <caption className="sr-only">{t("跨研发、问题、费用与订单模块的待办事项")}</caption>
                  <thead>
                    <tr>
                      {[t("事项名称"), t("负责人"), t("截止/更新时间"), t("状态"), t("优先级"), t("操作")].map((title) => (
                        <th key={title} scope="col" className="px-5 py-4 text-xs font-medium text-muted-foreground">{title}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {pagedTodos.map((item) => (
                      <tr key={item.id} className="hover:bg-muted/40">
                        <td className="max-w-64 px-5 py-4">
                          <AutoTranslatedText as="div" className="truncate text-sm font-semibold text-foreground" text={item.name} />
                          <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                            <span className="shrink-0">{item.module}</span>
                            <span aria-hidden="true">·</span>
                            <AutoTranslatedText as="span" className="truncate" text={item.description} />
                          </div>
                        </td>
                        <td className="px-5 py-4 text-xs text-muted-foreground">{item.user}</td>
                        <td className="whitespace-nowrap px-5 py-4 text-xs tabular-nums text-muted-foreground">{item.date}</td>
                        <td className="px-5 py-4"><span className={cn("inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium", statusTone[item.status])}>{t(item.status)}</span></td>
                        <td className="px-5 py-4"><span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-medium", priorityTone[item.priority])}>{t(item.priority)}</span></td>
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3 whitespace-nowrap">
                            <Link to={item.path} className="inline-flex min-h-9 items-center text-xs font-semibold text-primary hover:underline">{t("进入模块")}</Link>
                            <button type="button" onClick={() => setFocusedTodo(item)} className="min-h-9 cursor-pointer text-xs font-medium text-muted-foreground hover:text-primary">{t("查看详情")}</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <EmptyBlock
              title={t("当前筛选条件下没有待办事项")}
              helper={statusFilter === "全部" ? t("新任务和提醒会显示在这里。") : t("切换到全部，查看其他状态的待办。")}
              action={statusFilter === "全部" ? refreshAction : <button type="button" onClick={() => changeFilter("全部")} className="min-h-10 cursor-pointer rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90">{t("查看全部待办")}</button>}
            />
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4">
            <div className="text-xs tabular-nums text-muted-foreground">{t("共 {count} 条待办，当前第 {page}/{total} 页", { count: filteredTodos.length, page, total: totalPages })}</div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1} className="min-h-9 cursor-pointer rounded-xl border border-border bg-card px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50">{t("上一页")}</button>
              <button type="button" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page === totalPages} className="min-h-9 cursor-pointer rounded-xl border border-border bg-card px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50">{t("下一页")}</button>
            </div>
          </div>
        </section>

        <section className="hz-surface hz-dashboard-quick min-w-0 overflow-hidden">
          <HorizonSectionHeader Icon={ArrowUpRight} title={t("快捷操作")} description={t("常用工作，一步进入。") } />
          {quickActions.length ? (
            <div className="grid grid-cols-2 gap-3 p-5 xl:grid-cols-1">
              {quickActions.map((action) => (
                <Link key={action.title} to={action.path} className="group flex min-w-0 cursor-pointer flex-col items-start gap-3 rounded-2xl bg-muted/50 p-4 hover:bg-primary/5 xl:flex-row xl:items-center">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-card text-primary">
                    <action.icon className="size-5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1 text-pretty text-sm font-semibold leading-6 text-foreground">{t(action.title)}</span>
                  <ArrowUpRight className="hidden size-4 shrink-0 text-muted-foreground group-hover:text-primary xl:block" aria-hidden="true" />
                </Link>
              ))}
            </div>
          ) : (
            <EmptyBlock title={t("暂无快捷操作")} helper={t("快捷入口会依据当前账号的页面权限自动生成。")} action={refreshAction} />
          )}
        </section>
      </div>

      <section className="space-y-4" aria-labelledby="dashboard-modules-heading">
        <div className="flex items-end justify-between gap-3 px-1">
          <div>
            <h2 id="dashboard-modules-heading" className="text-balance text-lg font-bold text-foreground">{t("业务模块")}</h2>
            <p className="mt-1 text-pretty text-sm text-muted-foreground">{t("查看各模块的待处理事项与工作进展。")}</p>
          </div>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{t("{count} 个模块", { count: moduleCards.length })}</span>
        </div>
        <div className="hz-dashboard-modules grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-4">
          {loading && !data
            ? Array.from({ length: 4 }, (_, index) => (
                <div key={index} className="hz-surface p-6" aria-hidden="true">
                  <div className="h-4 w-24 rounded bg-muted" />
                  <div className="mt-4 h-10 w-16 rounded bg-muted" />
                  <div className="mt-3 h-3 w-40 rounded bg-muted" />
                </div>
              ))
            : moduleCards.map((card) => (
                <Link key={card.title} to={card.path} className="hz-surface hz-dashboard-module group block min-w-0 cursor-pointer p-6">
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary"><card.icon className="size-5" aria-hidden="true" /></span>
                    <ArrowUpRight className="size-4 text-muted-foreground group-hover:text-primary" aria-hidden="true" />
                  </div>
                  <h3 className="mt-4 text-balance text-sm font-medium text-muted-foreground">{card.title}</h3>
                  <div className="mt-1 text-3xl font-bold tabular-nums text-foreground">{card.value}</div>
                  <div className="mt-2 text-pretty text-sm tabular-nums text-muted-foreground">{card.helper}</div>
                  <p className="mt-4 border-t border-border pt-4 text-pretty text-xs leading-5 tabular-nums text-muted-foreground">{card.description}</p>
                </Link>
              ))}
        </div>
        {!loading && !moduleCards.length ? (
          <div className="hz-surface"><EmptyBlock title={t("暂无可汇总的业务模块")} helper={t("当前账号只有首页权限，或尚未开通支持首页汇总的研发、问题、费用与订单模块。")} action={refreshAction} /></div>
        ) : null}
      </section>

      <div className="hz-dashboard-insights grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="hz-surface min-w-0 overflow-hidden">
          <HorizonSectionHeader
            Icon={BarChart3}
            title={chartConfig.title}
            description={chartConfig.helper}
            trailing={chartConfig.data.length ? (
              <button type="button" onClick={() => setChartOpen(true)} aria-label={t("查看状态明细")} className="flex size-10 cursor-pointer items-center justify-center rounded-xl bg-muted text-primary hover:bg-primary/10"><BarChart3 className="size-5" aria-hidden="true" /></button>
            ) : null}
          />
          {chartConfig.data.length ? (
            <div className="p-4 sm:p-6">
              <div className="h-64" role="img" aria-label={chartConfig.data.map((item) => `${item.name}: ${item.value}`).join("，")}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartConfig.data} layout="vertical" margin={{ top: 8, right: 24, left: 0, bottom: 8 }}>
                    <CartesianGrid horizontal={false} stroke="var(--border)" strokeDasharray="4 4" />
                    <XAxis type="number" allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} />
                    <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} width={72} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} />
                    <Tooltip cursor={{ fill: "var(--muted)" }} contentStyle={{ borderRadius: 16, border: "1px solid var(--border)", boxShadow: "var(--hz-shadow-card)" }} />
                    <Bar dataKey="value" name={t("数量")} radius={[0, 8, 8, 0]} barSize={24} isAnimationActive={false}>
                      {chartConfig.data.map((item, index) => <Cell key={item.name} fill="var(--primary)" fillOpacity={[1, 0.7, 0.45, 0.25][index]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : <EmptyBlock title={t("暂无状态统计")} helper={t("问题或订单模块开通后，这里会显示对应接口的状态分布。")} action={refreshAction} />}
        </section>

        <section className="hz-surface min-w-0 overflow-hidden">
          <HorizonSectionHeader Icon={CheckCircle2} title={t("运行概况")} description={t("数据同步与事项完成情况。") } />
          <div className="space-y-6 p-6">
            {healthMetrics.map((item) => (
              <div key={item.label}>
                <div className="mb-3 flex items-center justify-between gap-3 text-xs">
                  <span className="font-medium text-muted-foreground">{item.label}</span>
                  <span className="font-semibold tabular-nums text-foreground">{loading && !data ? "—" : percent(item.value)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true"><div className={cn("h-full rounded-full", item.color)} style={{ width: percent(item.value) }} /></div>
              </div>
            ))}
            <p className="border-t border-border pt-4 text-pretty text-xs leading-5 text-muted-foreground">{t("后端版本 {version} · 服务 {service}", { version: data?.health?.release || "—", service: data?.health?.service || t("未连接") })}</p>
          </div>
        </section>
      </div>

      <section className="hz-surface hz-dashboard-activity min-w-0 overflow-hidden">
        <HorizonSectionHeader
          Icon={Activity}
          title={t("跨模块动态")}
          description={t("研发通知、问题更新、费用事件与订单队列的最近记录。")}
          trailing={<span className="rounded-full bg-muted px-3 py-1.5 text-xs font-medium tabular-nums text-muted-foreground">{t("{count} 条动态", { count: activityItems.length })}</span>}
        />
        {activityItems.length && selectedFeed ? (
          <div className="grid grid-cols-1 gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.65fr)] sm:p-6">
            <div className="min-w-0 space-y-2">
              {activityItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedFeedId(item.id)}
                  className={cn("flex w-full min-w-0 cursor-pointer items-start gap-3 rounded-2xl p-4 text-left", selectedFeedId === item.id ? "bg-primary/5" : "bg-transparent hover:bg-muted/60")}
                  aria-pressed={selectedFeedId === item.id}
                >
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", selectedFeedId === item.id ? "bg-primary" : "bg-muted-foreground/40")} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <span className="text-xs font-medium text-primary">{item.source}</span>
                      <span className="text-xs tabular-nums text-muted-foreground">{item.time}</span>
                    </div>
                    <AutoTranslatedText as="div" className="mt-1 truncate text-sm font-semibold text-foreground" text={item.title} />
                    <AutoTranslatedText as="div" className="mt-1 line-clamp-1 text-pretty text-xs leading-5 text-muted-foreground" text={item.helper} />
                  </div>
                </button>
              ))}
            </div>
            <div className="min-w-0 self-start rounded-2xl bg-muted/60 p-5 sm:p-6">
              <div className="text-xs font-semibold text-primary">{selectedFeed.source}</div>
              <h3 className="mt-3 text-balance break-words text-lg font-bold text-foreground"><AutoTranslatedText text={selectedFeed.title} /></h3>
              <AutoTranslatedText as="p" className="mt-3 text-pretty break-words text-sm leading-7 text-muted-foreground" text={selectedFeed.helper} />
              <div className="mt-6 border-t border-border pt-5">
                <div className="text-xs text-muted-foreground">{t("更新时间")}</div>
                <div className="mt-1 text-sm font-semibold tabular-nums text-foreground">{selectedFeed.time}</div>
                <Link to={selectedFeed.path} className="mt-5 inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-card px-4 text-sm font-semibold text-primary hover:bg-primary/5">{t("打开模块")}<ArrowUpRight className="size-4" aria-hidden="true" /></Link>
              </div>
            </div>
          </div>
        ) : <EmptyBlock title={t("暂无动态记录")} helper={t("已接入模块当前没有通知、活动或最近更新。")} action={refreshAction} />}
      </section>

      <Dialog open={chartOpen} onOpenChange={setChartOpen}>
        <DialogContent className="horizon-portal sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-balance">{t("{title}明细", { title: chartConfig.title })}</DialogTitle>
            <DialogDescription className="text-pretty">{t("以下数字与首页图表同步更新。")}</DialogDescription>
          </DialogHeader>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {chartConfig.data.map((item) => (
              <div key={item.name} className="rounded-2xl bg-muted p-5">
                <div className="text-sm font-medium text-muted-foreground">{item.name}</div>
                <div className="mt-2 text-2xl font-bold tabular-nums text-foreground">{item.value}</div>
              </div>
            ))}
          </div>
          {chartConfig.path !== "/" ? <DialogFooter><Link to={chartConfig.path} className="inline-flex min-h-10 items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90">{t("进入数据来源模块")}</Link></DialogFooter> : null}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(focusedTodo)} onOpenChange={(open) => { if (!open) setFocusedTodo(null); }}>
        {focusedTodo ? (
          <DialogContent className="horizon-portal sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle className="text-balance">{t("待办事项详情")}</DialogTitle>
              <DialogDescription className="text-pretty">{t("数据来源：{module}", { module: focusedTodo.module })}</DialogDescription>
            </DialogHeader>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl bg-muted p-5">
                <h3 className="text-balance break-words text-base font-semibold text-foreground"><AutoTranslatedText text={focusedTodo.name} /></h3>
                <AutoTranslatedText as="p" className="mt-3 text-pretty break-words text-sm leading-6 text-muted-foreground" text={focusedTodo.description} />
              </div>
              <div className="space-y-3 rounded-2xl bg-muted p-5 text-sm text-muted-foreground">
                <div>{t("负责人：{name}", { name: focusedTodo.user })}</div>
                <div className="tabular-nums">{t("截止/更新时间：{time}", { time: focusedTodo.date })}</div>
                <div>{t("状态：{status}", { status: t(focusedTodo.status) })}</div>
                <div>{t("优先级：{priority}", { priority: t(focusedTodo.priority) })}</div>
              </div>
            </div>
            <DialogFooter><Link to={focusedTodo.path} className="inline-flex min-h-10 items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90">{t("进入模块处理")}</Link></DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}
