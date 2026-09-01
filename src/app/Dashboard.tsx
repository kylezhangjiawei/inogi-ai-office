import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertCircle,
  ArrowUpRight,
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

function EmptyBlock({ title, helper }: { title: string; helper: string }) {
  return <HorizonEmptyState Icon={Folder} title={title} description={helper} />;
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
        tone: "text-[#002fa7] bg-[#eef3ff]",
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
        tone: "text-red-600 bg-red-50",
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
        tone: "text-amber-700 bg-amber-50",
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
        tone: "text-emerald-700 bg-emerald-50",
      });
    }
    return cards;
  }, [activeRdTasks.length, data, expensePending, lang, locale, pendingReviewTasks, t]);

  const quickActions = useMemo(
    () => quickActionCatalog.filter((action) => hasPermission(user?.permissions ?? [], action.permission)).slice(0, 6),
    [permissionKey, user?.permissions],
  );

  const pulseItems = moduleCards.map((card) => ({
    title: card.title,
    helper: `${card.helper}${lang === "en" ? ". " : "。"}${card.description}`,
    path: card.path,
    tone: card.tone,
  }));

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
        helper: t("来自问题记录与 AI 定位接口的实时统计"),
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
        helper: t("来自订货单处理工作台接口的实时统计"),
        path: "/order-workbench",
        data: [
          { name: t("待处理"), value: data.orders.stats.pending },
          { name: t("异常"), value: data.orders.stats.abnormal },
          { name: t("已生成"), value: data.orders.stats.generated },
          { name: t("待导出"), value: data.orders.stats.unexported },
        ],
      };
    }
    return { title: t("业务状态分布"), helper: t("暂无有权限且支持统计的业务接口"), path: "/", data: [] };
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
    { label: t("核心接口健康度"), value: data?.health?.ok ? 100 : 0, color: data?.health?.ok ? "bg-emerald-500" : "bg-red-500" },
    { label: t("数据源加载完整度"), value: syncRate, color: "bg-[#2563eb]" },
    { label: t("当前事项闭环率"), value: closeRate, color: "bg-[#002fa7]" },
  ];

  return (
    <div className="horizon-theme hz-page mx-auto max-w-[1500px] space-y-4">
      <HorizonPageHeader
        Icon={Activity}
        eyebrow="Workspace / Realtime"
        title={t("智能办公总览")}
        description={t("按当前账号权限汇总研发、问题、费用与订单模块；所有数字均来自真实业务接口。")}
        meta={(
          <>
            <span>{t("当前用户：{name}", { name: user?.name || "—" })}</span>
            <span aria-hidden="true">·</span>
            <span>{t("最近同步：{time}", { time: data ? formatDateTime(data.loadedAt, locale) : t("正在连接") })}</span>
            <span aria-hidden="true">·</span>
            <span className={cn(
              "rounded-full px-2 py-0.5 font-semibold",
              healthState === "stable" && "bg-emerald-50 text-emerald-700",
              healthState === "partial" && "bg-amber-50 text-amber-700",
              healthState === "offline" && "bg-red-50 text-red-700",
            )}>
              {healthState === "stable" ? t("运行正常") : healthState === "partial" ? t("部分可用") : t("连接异常")}
            </span>
          </>
        )}
        actions={(
          <button
            type="button"
            onClick={() => void loadData(false)}
            disabled={refreshing}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[#dfe6f3] bg-white px-4 text-sm font-semibold text-slate-700 hover:border-[#b8c7e8] hover:bg-[#f7f9fd] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} aria-hidden="true" />
            {refreshing ? t("同步中") : t("刷新数据")}
          </button>
        )}
      />

      <HorizonMetricGrid>
        <HorizonMetric Icon={Activity} label={t("数据模块")} value={loading && !data ? "—" : `${loadedBusinessCount}/${expectedBusinessCount}`} note={t("按当前权限实时接入")} tone="brand" />
        <HorizonMetric Icon={Clock3} label={t("待推进事项")} value={loading && !data ? "—" : totalPending} note={t("跨已接入业务汇总")} tone={totalPending > 0 ? "warning" : "neutral"} />
        <HorizonMetric Icon={CheckCircle2} label={t("已闭环记录")} value={loading && !data ? "—" : totalClosed} note={t("任务、问题与订单")} tone="success" />
        <HorizonMetric Icon={TrendingUp} label={t("今日待办")} value={loading && !data ? "—" : currentTodos} note={t("研发与费用接口")} tone="neutral" />
      </HorizonMetricGrid>

      {errorEntries.length ? (
        <section role="alert" className="flex flex-col gap-3 rounded-[18px] border border-amber-200 bg-amber-50/80 px-5 py-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
            <div>
              <div className="text-sm font-semibold text-amber-900">{t("部分数据暂未同步")}</div>
              <div className="mt-1 text-xs leading-5 text-amber-800">
                {errorEntries.map(([source, message], index) => (
                  <React.Fragment key={source}>
                    {index > 0 ? (lang === "en" ? "; " : "；") : ""}
                    {t(sourceNames[source])}{lang === "en" ? ": " : "："}<AutoTranslatedText text={message} />
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>
          <button type="button" onClick={() => void loadData(false)} className="shrink-0 self-start rounded-xl border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100 md:self-auto">
            {t("重试失败项")}
          </button>
        </section>
      ) : null}

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {loading && !data
          ? Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="hz-surface animate-pulse p-5">
                <div className="h-4 w-24 rounded bg-slate-100" />
                <div className="mt-4 h-10 w-16 rounded bg-slate-100" />
                <div className="mt-3 h-3 w-40 rounded bg-slate-100" />
              </div>
            ))
          : moduleCards.map((card) => (
              <Link key={card.title} to={card.path} className="hz-surface block p-5 hover:bg-[#f8faff] focus-visible:outline-none">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-500">{card.title}</div>
                    <div className="mt-3 text-3xl font-bold text-[#1b2559]">{card.value}</div>
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
        <EmptyBlock title={t("暂无可汇总的业务模块")} helper={t("当前账号只有首页权限，或尚未开通支持首页汇总的研发、问题、费用与订单模块。")} />
      ) : null}

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.2fr)_360px]">
        <div className="hz-surface overflow-hidden">
          <HorizonSectionHeader
            Icon={Activity}
            title={t("工作台脉冲")}
            description={t("按模块浓缩当前真实业务状态，点击可直接进入对应工作台。")}
            trailing={<span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">API Summary</span>}
          />
          {pulseItems.length ? (
            <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
              {pulseItems.map((item) => (
                <Link key={item.title} to={item.path} className="rounded-xl border border-[#e9edf7] bg-[#f8faff] p-4 hover:border-[#c8d5ee] focus-visible:outline-none">
                  <div className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-semibold", item.tone)}>{item.title}</div>
                  <div className="mt-3 text-sm leading-6 text-slate-600">{item.helper}</div>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyBlock title={t("暂无模块摘要")} helper={t("完成业务模块授权后，这里会显示对应接口的实时摘要。")} />
          )}
        </div>

        <div className="hz-surface overflow-hidden">
          <HorizonSectionHeader
            Icon={CheckCircle2}
            title={t("运行概况")}
            description={t("接口健康、数据完整度与事项闭环率。")}
            trailing={<span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", healthState === "stable" ? "bg-emerald-50 text-emerald-700" : healthState === "partial" ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700")}>{healthState === "stable" ? t("运行正常") : healthState === "partial" ? t("部分可用") : t("连接异常")}</span>}
          />
          <div className="space-y-3 p-4">
            {healthMetrics.map((item) => (
              <div key={item.label} className="rounded-xl border border-[#e9edf7] bg-[#f8faff] p-3">
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-600">{item.label}</span>
                  <span className="font-semibold text-[#1b2559]">{percent(item.value)}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white" aria-hidden="true">
                  <div className={cn("h-full rounded-full transition-[width] duration-300", item.color)} style={{ width: percent(item.value) }} />
                </div>
              </div>
            ))}
            <p className="text-xs leading-5 text-slate-500">
              {t("后端版本 {version} · 服务 {service}", { version: data?.health?.release || "—", service: data?.health?.service || t("未连接") })}
            </p>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-12 gap-4">
        <div className="col-span-12 xl:col-span-7">
          <div className="hz-surface h-full overflow-hidden">
            <HorizonSectionHeader
              Icon={BarChart3}
              title={chartConfig.title}
              description={chartConfig.helper}
              trailing={chartConfig.data.length ? (
                <button
                  type="button"
                  onClick={() => setChartOpen(true)}
                  aria-label={t("查看状态明细")}
                  className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#e0e5f2] bg-white text-slate-600 hover:border-[#b8c7e8] hover:bg-[#f7f9fd]"
                >
                  <BarChart3 className="h-5 w-5" />
                </button>
              ) : null}
            />

            {chartConfig.data.length ? (
              <div className="p-4">
                <div className="rounded-xl border border-[#e9edf7] bg-[#f8faff] p-3">
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartConfig.data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                      <CartesianGrid horizontal={false} stroke="#e5edf7" />
                      <XAxis type="number" allowDecimals={false} hide />
                      <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} width={68} tick={{ fill: "#5f6b7a", fontSize: 13 }} />
                      <Tooltip
                        cursor={{ fill: "rgba(0, 47, 167, 0.06)" }}
                        contentStyle={{ borderRadius: 12, border: "1px solid #d8e2ee", boxShadow: "0 12px 28px rgba(15, 23, 42, 0.12)" }}
                      />
                      <Bar dataKey="value" radius={[0, 8, 8, 0]} barSize={22}>
                        {chartConfig.data.map((item, index) => (
                          <Cell key={item.name} fill={["#bfdbfe", "#60a5fa", "#2563eb", "#002fa7"][index]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                </div>
              </div>
            ) : (
              <EmptyBlock title={t("暂无状态统计")} helper={t("问题或订单模块开通后，这里会显示对应接口的状态分布。")} />
            )}
          </div>
        </div>

        <div className="col-span-12 xl:col-span-5">
          <div className="hz-surface h-full overflow-hidden">
            <HorizonSectionHeader
              Icon={ArrowUpRight}
              title={t("快捷操作")}
              description={t("仅展示当前账号有权限进入的高频功能。")}
              trailing={<span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{quickActions.length} Actions</span>}
            />

            {quickActions.length ? (
              <div className="grid grid-cols-2 gap-3 p-4">
                {quickActions.map((action) => (
                  <Link key={action.title} to={action.path} className="group rounded-xl border border-[#e9edf7] bg-white p-4 hover:border-[#b8c7e8] hover:bg-[#f8faff] focus-visible:outline-none">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#eef3ff] text-[#002fa7] group-hover:bg-[#e2eaff]">
                      <action.icon className="h-5 w-5" />
                    </div>
                    <div className="mt-4 text-sm font-semibold leading-6 text-slate-800">{t(action.title)}</div>
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyBlock title={t("暂无快捷操作")} helper={t("快捷入口会依据当前账号的页面权限自动生成。")} />
            )}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-12 gap-4">
        <div className="col-span-12 xl:col-span-7">
          <div className="hz-surface h-full overflow-hidden">
            <HorizonSectionHeader
              Icon={Activity}
              title={t("跨模块动态")}
              description={t("研发通知、问题更新、费用事件与订单队列的最近记录。")}
              trailing={<span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{activityItems.length} Events</span>}
            />
            {activityItems.length && selectedFeed ? (
              <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_250px]">
                <div className="space-y-3">
                  {activityItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedFeedId(item.id)}
                      className={cn(
                        "w-full rounded-xl border p-4 text-left",
                        selectedFeedId === item.id ? "border-[#b8c7e8] bg-[#eef3ff]" : "border-[#e9edf7] bg-[#f8faff] hover:border-[#d2daea]",
                      )}
                      aria-pressed={selectedFeedId === item.id}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <AutoTranslatedText as="div" className="text-sm font-semibold text-slate-800" text={item.title} />
                        <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-500">{item.time}</span>
                      </div>
                      <AutoTranslatedText as="div" className="mt-2 line-clamp-2 text-sm text-slate-600" text={item.helper} />
                    </button>
                  ))}
                </div>
                <div className="rounded-xl border border-[#e9edf7] bg-[#f8faff] p-5">
                  <div className="text-xs font-semibold text-[#002fa7]">{selectedFeed.source}</div>
                  <AutoTranslatedText as="div" className="mt-3 text-lg font-semibold text-slate-900" text={selectedFeed.title} />
                  <AutoTranslatedText as="div" className="mt-3 text-sm leading-6 text-slate-600" text={selectedFeed.helper} />
                  <div className="mt-5 flex items-center justify-between rounded-xl border border-[#e9edf7] bg-white px-4 py-3">
                    <div>
                      <div className="text-xs text-slate-400">{t("更新时间")}</div>
                      <div className="mt-1 text-sm font-semibold text-slate-800">{selectedFeed.time}</div>
                    </div>
                    <Link to={selectedFeed.path} className="rounded-lg border border-[#dfe6f3] bg-white px-3 py-2 text-xs font-semibold text-[#002fa7] hover:bg-[#eef3ff]">{t("打开模块")}</Link>
                  </div>
                </div>
              </div>
            ) : (
              <EmptyBlock title={t("暂无动态记录")} helper={t("已接入模块当前没有通知、活动或最近更新。")} />
            )}
          </div>
        </div>

        <div className="col-span-12 xl:col-span-5">
          <div className="hz-surface h-full overflow-hidden">
            <HorizonSectionHeader
              Icon={ArrowUpRight}
              title={t("模块聚焦")}
              description={t("可直接下钻到产生首页数据的业务模块。")}
              trailing={<span className="rounded-full bg-[#eef3ff] px-2.5 py-1 text-xs font-semibold text-[#002fa7]">Connected</span>}
            />
            <div className="space-y-3 p-4">
              {moduleCards.slice(0, 3).map((item) => (
                <Link key={item.title} to={item.path} className="block rounded-xl border border-[#e9edf7] bg-white p-5 hover:border-[#b8c7e8] hover:bg-[#f8faff] focus-visible:outline-none">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-base font-semibold text-slate-900">{item.title}</div>
                    <ArrowUpRight className="h-4 w-4 text-slate-400" />
                  </div>
                  <div className="mt-2 text-sm leading-6 text-slate-600">{item.description}</div>
                  <div className="mt-4 text-sm font-semibold text-[#002fa7]">{item.value} · {item.helper}</div>
                </Link>
              ))}
              {!moduleCards.length ? <EmptyBlock title={t("暂无已接入模块")} helper={t("这里会列出首页数据的真实来源和当前摘要。")} /> : null}
            </div>
          </div>
        </div>
      </section>

      <section className="hz-surface overflow-hidden">
        <HorizonSectionHeader
          Icon={Clock3}
          title={t("待办事项")}
          description={t("来自研发任务、待处理问题、费用提醒与订单队列。")}
          trailing={(
            <button type="button" onClick={() => void loadData(false)} disabled={refreshing} className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#002fa7] px-3.5 text-xs font-semibold text-white hover:bg-[#002581] disabled:cursor-not-allowed disabled:opacity-60">
              <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
              {t("同步待办")}
            </button>
          )}
        />
        <div className="hz-toolbar flex flex-wrap gap-2 border-b px-4 py-3" role="group" aria-label={t("待办状态筛选")}>
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
                  "rounded-full border px-3.5 py-1.5 text-xs font-semibold",
                  statusFilter === item.key ? "border-[#b8c7e8] bg-[#eef3ff] text-[#002fa7]" : "border-[#dfe6f3] bg-white text-slate-500 hover:border-[#b8c7e8]",
                )}
                aria-pressed={statusFilter === item.key}
              >
                {item.label}
              </button>
            ))}
        </div>

        <div className="material-scrollbar overflow-x-auto">
          <table className="w-full min-w-[900px] text-left">
            <caption className="sr-only">{t("跨研发、问题、费用与订单模块的待办事项")}</caption>
            <thead className="bg-slate-50/90">
              <tr>
                {[t("事项名称"), t("来源模块"), t("负责人"), t("截止/更新时间"), t("状态"), t("优先级"), t("操作")].map((title) => (
                  <th key={title} scope="col" className="px-6 py-4 text-xs font-semibold text-slate-500">{t(title)}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pagedTodos.map((item) => (
                <tr key={item.id} className="hover:bg-[#f8faff]">
                  <td className="max-w-[280px] px-6 py-4">
                    <AutoTranslatedText as="div" className="truncate text-sm font-semibold text-slate-800" text={item.name} />
                    <AutoTranslatedText as="div" className="mt-1 truncate text-xs text-slate-400" text={item.description} />
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-500">{item.module}</td>
                  <td className="px-6 py-4 text-sm text-slate-700">{item.user}</td>
                  <td className="px-6 py-4 text-sm text-slate-500">{item.date}</td>
                  <td className="px-6 py-4"><span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-semibold", statusTone[item.status])}>{t(item.status)}</span></td>
                  <td className="px-6 py-4"><span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-semibold", priorityTone[item.priority])}>{t(item.priority)}</span></td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <Link to={item.path} className="rounded-lg border border-[#dfe6f3] bg-white px-3 py-2 text-xs font-semibold text-[#002fa7] hover:bg-[#eef3ff]">{t("进入模块")}</Link>
                      <button type="button" onClick={() => setFocusedTodo(item)} className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200">{t("查看详情")}</button>
                    </div>
                  </td>
                </tr>
              ))}
              {!pagedTodos.length ? (
                <tr><td colSpan={7} className="px-6 py-12 text-center text-sm text-slate-500">{t("当前筛选条件下没有待办事项")}</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-4 border-t border-slate-100 px-6 py-4 md:flex-row md:items-center md:justify-between">
          <div className="text-sm text-slate-500">{t("共 {count} 条待办，当前第 {page}/{total} 页", { count: filteredTodos.length, page, total: totalPages })}</div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1} className="rounded-lg border border-[#dfe6f3] bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-[#f7f9fd] disabled:cursor-not-allowed disabled:opacity-50">{t("上一页")}</button>
            <button type="button" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page === totalPages} className="rounded-lg border border-[#dfe6f3] bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-[#f7f9fd] disabled:cursor-not-allowed disabled:opacity-50">{t("下一页")}</button>
          </div>
        </div>
      </section>

      <Dialog open={chartOpen} onOpenChange={setChartOpen}>
        <DialogContent className="horizon-portal sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>{t("{title}明细", { title: chartConfig.title })}</DialogTitle>
              <DialogDescription>{t("以下数字与首页图表使用同一份接口结果。")}</DialogDescription>
            </DialogHeader>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {chartConfig.data.map((item) => (
                <div key={item.name} className="rounded-xl border border-[#e9edf7] bg-[#f8faff] p-4">
                  <div className="text-sm font-semibold text-slate-800">{item.name}</div>
                  <div className="mt-2 text-2xl font-bold text-slate-900">{item.value}</div>
                </div>
              ))}
            </div>
            {chartConfig.path !== "/" ? (
              <DialogFooter>
                <Link to={chartConfig.path} className="inline-flex h-10 items-center justify-center rounded-xl bg-[#002fa7] px-4 text-sm font-semibold text-white hover:bg-[#002581]">{t("进入数据来源模块")}</Link>
              </DialogFooter>
            ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(focusedTodo)} onOpenChange={(open) => { if (!open) setFocusedTodo(null); }}>
        {focusedTodo ? (
          <DialogContent className="horizon-portal sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>{t("待办事项详情")}</DialogTitle>
              <DialogDescription>{t("数据来源：{module}", { module: focusedTodo.module })}</DialogDescription>
            </DialogHeader>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-[#e9edf7] bg-[#f8faff] p-4">
                <AutoTranslatedText as="div" className="text-base font-semibold text-slate-900" text={focusedTodo.name} />
                <AutoTranslatedText as="div" className="mt-3 text-sm leading-6 text-slate-600" text={focusedTodo.description} />
              </div>
              <div className="space-y-2 rounded-xl border border-[#e9edf7] bg-[#f8faff] p-4 text-sm text-slate-600">
                <div>{t("负责人：{name}", { name: focusedTodo.user })}</div>
                <div>{t("截止/更新时间：{time}", { time: focusedTodo.date })}</div>
                <div>{t("状态：{status}", { status: t(focusedTodo.status) })}</div>
                <div>{t("优先级：{priority}", { priority: t(focusedTodo.priority) })}</div>
              </div>
            </div>
            <DialogFooter>
              <Link to={focusedTodo.path} className="inline-flex h-10 items-center justify-center rounded-xl bg-[#002fa7] px-4 text-sm font-semibold text-white hover:bg-[#002581]">{t("进入模块处理")}</Link>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}
