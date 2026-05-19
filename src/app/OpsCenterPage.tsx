import React, { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import {
  Activity,
  AlertTriangle,
  BellRing,
  Bot,
  CheckCircle2,
  Cloud,
  Clock3,
  Database,
  Download,
  Eye,
  FileSearch,
  Filter,
  Gauge,
  Mail,
  PlugZap,
  RefreshCw,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  Siren,
  Sparkles,
  Trash2,
  UserRound,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { cn } from "./components/ui/utils";
import { opsCenterApi, OpsCenterSectionData } from "./lib/opsCenterApi";

type OpsSection = "overview" | "api-errors" | "database" | "services-tasks" | "alerts-audit";
type Tone = "healthy" | "info" | "warning" | "danger" | "neutral";

type OpsCenterPageProps = {
  section: OpsSection;
};

const sectionMeta: Record<OpsSection, { title: string; eyebrow: string; description: string }> = {
  overview: {
    title: "运维总览",
    eyebrow: "Operations Overview",
    description: "集中查看接口、数据库、AI、邮箱同步和后台任务的运行状态。",
  },
  "api-errors": {
    title: "接口与错误",
    eyebrow: "API & Incident Center",
    description: "按接口、状态码、耗时、错误聚合和处理状态定位线上问题。",
  },
  database: {
    title: "数据库监控",
    eyebrow: "PostgreSQL Observability",
    description: "查看数据库连接、慢 SQL、锁等待、容量、RDS/ECS 接入状态。",
  },
  "services-tasks": {
    title: "服务与任务",
    eyebrow: "Third-party Services & Jobs",
    description: "监控 AI 模型、邮箱、阿里云集成和业务自动化任务执行结果。",
  },
  "alerts-audit": {
    title: "告警与审计设置",
    eyebrow: "Alerting, Audit & Log Policy",
    description: "配置告警规则、日志保留、敏感字段脱敏、SLS/RDS/ARMS 集成策略。",
  },
};

const healthCards = [
  { label: "今日请求", value: "18,426", change: "+12.4%", tone: "info" as Tone, icon: Activity },
  { label: "接口错误", value: "37", change: "-8.1%", tone: "warning" as Tone, icon: AlertTriangle },
  { label: "5xx 严重错误", value: "6", change: "需关注", tone: "danger" as Tone, icon: Siren },
  { label: "平均耗时", value: "238ms", change: "稳定", tone: "healthy" as Tone, icon: Clock3 },
];

const dependencyStatus = [
  { name: "NestJS API", detail: "ECS 容器运行中", status: "正常", tone: "healthy" as Tone, icon: Server },
  { name: "PostgreSQL", detail: "连接池 18 / 80", status: "正常", tone: "healthy" as Tone, icon: Database },
  { name: "AI 模型网关", detail: "近 1 小时失败 3 次", status: "轻微波动", tone: "warning" as Tone, icon: Sparkles },
  { name: "邮箱 IMAP", detail: "上次同步 09:42", status: "正常", tone: "healthy" as Tone, icon: Mail },
];

const errorTrend = [
  { time: "00:00", api: 3, task: 1, db: 0 },
  { time: "04:00", api: 2, task: 0, db: 0 },
  { time: "08:00", api: 8, task: 3, db: 1 },
  { time: "12:00", api: 12, task: 5, db: 0 },
  { time: "16:00", api: 7, task: 2, db: 1 },
  { time: "20:00", api: 5, task: 1, db: 0 },
];

const slowApis = [
  { path: "/api/resume-screening/upload-folder", duration: 4280, count: 14 },
  { path: "/api/image-generation/edit", duration: 3190, count: 8 },
  { path: "/api/chat/stream", duration: 2660, count: 21 },
  { path: "/api/integration-management/test", duration: 1840, count: 6 },
  { path: "/api/candidates/re-screen", duration: 1520, count: 9 },
];

const apiLogs = [
  {
    id: "REQ-20260512-1842",
    time: "2026-05-12 13:48:21",
    method: "POST",
    path: "/api/resume-screening/upload-folder",
    status: 500,
    duration: 4280,
    user: "管理员",
    ip: "120.27.18.42",
    message: "AI 文件读取模型连接超时",
    errorName: "GatewayTimeoutError",
    errorStack: "GatewayTimeoutError: AI 文件读取模型连接超时\n    at ResumeScreeningService.uploadFolder\n    at async ResumeScreeningController.uploadFolder",
    requestMeta: { body: { folderId: "[redacted]" }, query: {} },
    responseMeta: { statusCode: 500, durationMs: 4280 },
  },
  {
    id: "REQ-20260512-1836",
    time: "2026-05-12 13:42:06",
    method: "POST",
    path: "/api/image-generation/edit",
    status: 400,
    duration: 3190,
    user: "设计部-王敏",
    ip: "10.0.2.18",
    message: "图片编辑模型未返回有效图片数据",
    errorName: "BadRequestException",
    errorStack: "BadRequestException: 图片编辑模型未返回有效图片数据\n    at ImageGenerationService.editImage",
    requestMeta: { body: { prompt: "[truncated]" }, query: {} },
    responseMeta: { statusCode: 400, durationMs: 3190 },
  },
  {
    id: "REQ-20260512-1825",
    time: "2026-05-12 13:36:44",
    method: "GET",
    path: "/api/integration-management/ai-models",
    status: 200,
    duration: 116,
    user: "管理员",
    ip: "10.0.2.11",
    message: "OK",
  },
  {
    id: "REQ-20260512-1819",
    time: "2026-05-12 13:29:11",
    method: "POST",
    path: "/api/integration-management/mailboxes/test",
    status: 502,
    duration: 1840,
    user: "HR-李娜",
    ip: "10.0.3.22",
    message: "IMAP 登录被远端拒绝",
  },
  {
    id: "REQ-20260512-1804",
    time: "2026-05-12 13:16:38",
    method: "PATCH",
    path: "/api/users/cuid-admin",
    status: 403,
    duration: 78,
    user: "普通用户",
    ip: "10.0.4.12",
    message: "无权限修改其他用户信息",
  },
  {
    id: "REQ-20260512-1749",
    time: "2026-05-12 12:58:10",
    method: "POST",
    path: "/api/chat/stream",
    status: 200,
    duration: 2660,
    user: "销售-陈浩",
    ip: "10.0.2.44",
    message: "SSE completed",
  },
];

const errorGroups = [
  {
    id: "ERR-AI-TIMEOUT",
    title: "AI 文件读取模型连接超时",
    service: "简历筛选",
    severity: "严重",
    count: 12,
    users: 3,
    firstSeen: "2026-05-12 09:18",
    lastSeen: "2026-05-12 13:48",
    status: "处理中",
    path: "/api/resume-screening/upload-folder",
  },
  {
    id: "ERR-IMAP-AUTH",
    title: "IMAP 登录被远端拒绝",
    service: "邮箱同步",
    severity: "警告",
    count: 7,
    users: 2,
    firstSeen: "2026-05-12 08:22",
    lastSeen: "2026-05-12 13:29",
    status: "待处理",
    path: "/api/integration-management/mailboxes/test",
  },
  {
    id: "ERR-IMAGE-NO-DATA",
    title: "图片编辑模型未返回有效图片数据",
    service: "图片生成",
    severity: "警告",
    count: 4,
    users: 1,
    firstSeen: "2026-05-12 11:09",
    lastSeen: "2026-05-12 13:42",
    status: "待处理",
    path: "/api/image-generation/edit",
  },
  {
    id: "ERR-RBAC-DENIED",
    title: "角色权限校验拦截",
    service: "用户权限",
    severity: "提示",
    count: 18,
    users: 6,
    firstSeen: "2026-05-12 09:01",
    lastSeen: "2026-05-12 13:16",
    status: "已忽略",
    path: "/api/users/:id",
  },
];

const taskLogs = [
  {
    id: "TASK-9038",
    time: "2026-05-12 13:47:55",
    module: "简历筛选",
    action: "文件夹上传 AI 初筛",
    status: "失败",
    duration: "4.3s",
    owner: "HR-李娜",
    detail: "AI 文件读取模型连接超时，候选人已入库但未完成评分",
  },
  {
    id: "TASK-9021",
    time: "2026-05-12 13:41:12",
    module: "邮箱同步",
    action: "智联招聘邮箱同步",
    status: "成功",
    duration: "1.2s",
    owner: "系统任务",
    detail: "同步 7 封邮件，新增候选人 3 位，跳过重复 4 封",
  },
  {
    id: "TASK-9009",
    time: "2026-05-12 13:32:44",
    module: "AI 模型",
    action: "连接测试",
    status: "成功",
    duration: "680ms",
    owner: "管理员",
    detail: "默认文本模型返回正常",
  },
  {
    id: "TASK-8997",
    time: "2026-05-12 13:20:18",
    module: "图片生成",
    action: "图生图编辑",
    status: "失败",
    duration: "3.1s",
    owner: "设计部-王敏",
    detail: "上游返回空图片数据，已记录 OpenAI request id",
  },
  {
    id: "TASK-8982",
    time: "2026-05-12 13:02:06",
    module: "简历筛选",
    action: "候选人二次筛选",
    status: "跳过",
    duration: "120ms",
    owner: "HR-李娜",
    detail: "岗位规则未匹配，未提交 AI 分析",
  },
];

const auditLogs = [
  {
    id: "AUD-4481",
    time: "2026-05-12 13:45:30",
    user: "管理员",
    action: "修改 AI 模型配置",
    resource: "ai-model-management",
    risk: "高",
    ip: "10.0.2.11",
    summary: "更新默认模型 base_url，API Key 已脱敏",
  },
  {
    id: "AUD-4472",
    time: "2026-05-12 13:33:12",
    user: "HR-李娜",
    action: "测试邮箱连接",
    resource: "mailbox-management",
    risk: "中",
    ip: "10.0.3.22",
    summary: "邮箱 hr@example.com 连接测试失败",
  },
  {
    id: "AUD-4463",
    time: "2026-05-12 12:50:09",
    user: "管理员",
    action: "新增角色权限",
    resource: "roles",
    risk: "高",
    ip: "10.0.2.11",
    summary: "为运维角色增加日志查看权限",
  },
  {
    id: "AUD-4457",
    time: "2026-05-12 12:22:41",
    user: "销售-陈浩",
    action: "导出候选人列表",
    resource: "resume-screening",
    risk: "中",
    ip: "10.0.2.44",
    summary: "导出 32 条候选人筛选结果",
  },
  {
    id: "AUD-4449",
    time: "2026-05-12 11:59:13",
    user: "管理员",
    action: "停用用户",
    resource: "users",
    risk: "高",
    ip: "10.0.2.11",
    summary: "停用离职员工账号",
  },
];

const databaseMetrics = [
  { label: "数据库状态", value: "可连接", helper: "PostgreSQL 16 / ECS Docker", tone: "healthy" as Tone, icon: Database },
  { label: "连接池", value: "18 / 80", helper: "峰值 43，未触顶", tone: "info" as Tone, icon: Server },
  { label: "慢 SQL", value: "11", helper: "阈值 800ms", tone: "warning" as Tone, icon: Clock3 },
  { label: "存储空间", value: "42%", helper: "预计 68 天后需扩容", tone: "healthy" as Tone, icon: Gauge },
];

const databaseTrend = [
  { time: "09:00", connections: 14, slowSql: 2, locks: 0 },
  { time: "10:00", connections: 21, slowSql: 4, locks: 1 },
  { time: "11:00", connections: 28, slowSql: 6, locks: 0 },
  { time: "12:00", connections: 18, slowSql: 3, locks: 0 },
  { time: "13:00", connections: 31, slowSql: 8, locks: 2 },
  { time: "14:00", connections: 24, slowSql: 5, locks: 1 },
];

const slowQueries = [
  { query: "CandidateScreening.findMany + orderBy createdAt", duration: 1280, count: 18, source: "简历筛选列表" },
  { query: "AuditLog.findMany where createdAt range", duration: 940, count: 42, source: "操作审计" },
  { query: "GeneratedImage.findMany include user", duration: 860, count: 9, source: "图片生成记录" },
  { query: "EmailIngestionLog.findMany by mailbox", duration: 790, count: 16, source: "邮箱同步日志" },
];

const lockWaits = [
  { table: "Candidate", mode: "RowExclusiveLock", waiting: "120ms", session: "resume-screening-worker" },
  { table: "IntegrationConfig", mode: "AccessShareLock", waiting: "48ms", session: "admin-api" },
  { table: "AuditLog", mode: "RowExclusiveLock", waiting: "32ms", session: "audit-interceptor" },
];

const serviceMonitors = [
  { name: "OpenAI 兼容模型", provider: "AI 网关", status: "轻微波动", successRate: "97.8%", latency: "1.2s", lastChecked: "13:49", tone: "warning" as Tone },
  { name: "qwen-doc-turbo 文件读取", provider: "DashScope", status: "异常增多", successRate: "91.4%", latency: "3.9s", lastChecked: "13:48", tone: "danger" as Tone },
  { name: "智联招聘 IMAP", provider: "邮箱服务", status: "正常", successRate: "99.2%", latency: "620ms", lastChecked: "13:42", tone: "healthy" as Tone },
  { name: "阿里云 SLS", provider: "日志服务", status: "已接入", successRate: "100%", latency: "180ms", lastChecked: "13:50", tone: "healthy" as Tone },
  { name: "阿里云 RDS 控制台", provider: "数据库", status: "待切换", successRate: "-", latency: "-", lastChecked: "未启用", tone: "neutral" as Tone },
  { name: "ARMS 应用监控", provider: "可观测链路", status: "待接入", successRate: "-", latency: "-", lastChecked: "未启用", tone: "neutral" as Tone },
];

const cloudIntegrations = [
  { name: "日志服务 SLS", status: "已规划", detail: "采集 API 容器、Nginx、PostgreSQL 容器日志", icon: Cloud, tone: "info" as Tone },
  { name: "RDS PostgreSQL", status: "可选增强", detail: "迁移后可直接使用慢 SQL、锁等待、容量和备份监控", icon: Database, tone: "warning" as Tone },
  { name: "ARMS Trace", status: "二期待接入", detail: "接口、数据库、AI 外部调用的全链路耗时分析", icon: Activity, tone: "neutral" as Tone },
];

const alertRules = [
  { name: "接口 5xx 连续异常", condition: "5 分钟内 5xx >= 5 次", channel: "站内 / 钉钉", level: "严重", enabled: true },
  { name: "AI 调用失败率过高", condition: "15 分钟失败率 >= 8%", channel: "站内 / 邮件", level: "警告", enabled: true },
  { name: "数据库连接失败", condition: "连续 3 次健康检查失败", channel: "站内 / 短信", level: "致命", enabled: true },
  { name: "慢接口过多", condition: "P95 > 3s 且请求数 >= 20", channel: "站内", level: "警告", enabled: false },
  { name: "磁盘空间不足", condition: "可用空间 < 20%", channel: "站内 / 钉钉", level: "严重", enabled: true },
];

const logPolicies = [
  { name: "接口访问日志", retention: "30 天", payload: "记录请求摘要", masking: "开启", status: "启用" },
  { name: "接口错误日志", retention: "90 天", payload: "记录错误堆栈", masking: "开启", status: "启用" },
  { name: "操作审计日志", retention: "180 天", payload: "记录资源与操作者", masking: "开启", status: "启用" },
  { name: "Prisma 慢查询日志", retention: "30 天", payload: "记录模型、耗时、调用来源", masking: "开启", status: "启用" },
  { name: "第三方调用日志", retention: "60 天", payload: "记录 request id 与响应摘要", masking: "开启", status: "启用" },
];

const statusColors: Record<Tone, string> = {
  healthy: "border-emerald-200 bg-emerald-50 text-emerald-700",
  info: "border-blue-200 bg-blue-50 text-blue-700",
  warning: "border-amber-200 bg-amber-50 text-amber-700",
  danger: "border-rose-200 bg-rose-50 text-rose-700",
  neutral: "border-slate-200 bg-slate-100 text-slate-600",
};

const chartColors = ["#1e40af", "#0891b2", "#f59e0b", "#e11d48", "#7c3aed"];
const selectTriggerClass = "h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm outline-none transition focus-visible:border-blue-300 focus-visible:ring-2 focus-visible:ring-blue-100";
const OPS_TABLE_PAGE_SIZE = 8;

function SelectControl({
  value,
  onValueChange,
  options,
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className={cn(selectTriggerClass, className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} className="rounded-lg py-2 pl-3 pr-9 text-sm text-slate-700">
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function usePagedRows<T>(rows: T[], resetKey: string, pageSize = OPS_TABLE_PAGE_SIZE) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));

  useEffect(() => {
    setPage(1);
  }, [resetKey]);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  const pagedRows = useMemo(
    () => rows.slice((page - 1) * pageSize, page * pageSize),
    [page, pageSize, rows],
  );

  return { page, setPage, totalPages, pagedRows };
}

function PaginationControls({
  page,
  total,
  totalPages,
  onPageChange,
}: {
  page: number;
  total: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-sm text-slate-500">
        共 {total} 条，第 {page} / {totalPages} 页
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          className="material-button-secondary !px-3 !py-2"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
        >
          上一页
        </button>
        <button
          type="button"
          className="material-button-secondary !px-3 !py-2"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
        >
          下一页
        </button>
      </div>
    </div>
  );
}

const iconMap = {
  Activity,
  AlertTriangle,
  BellRing,
  Bot,
  Clock3,
  Cloud,
  Database,
  Gauge,
  Mail,
  PlugZap,
  Server,
  ShieldCheck,
  Siren,
  Sparkles,
};

function resolveIcon(value: unknown, fallback: React.ComponentType<{ className?: string }>) {
  if (typeof value === "string" && value in iconMap) {
    return iconMap[value as keyof typeof iconMap];
  }
  return fallback;
}

function getArray<T>(data: OpsCenterSectionData | null, key: string, fallback: T[]): T[] {
  const value = data?.[key];
  return Array.isArray(value) ? (value as T[]) : fallback;
}

function toneForStatus(status: string): Tone {
  if (status === "成功" || status === "正常" || status === "已解决") return "healthy";
  if (status === "失败" || status === "严重" || status === "致命") return "danger";
  if (status === "警告" || status === "处理中" || status === "待处理" || status === "跳过") return "warning";
  if (status === "提示") return "info";
  return "neutral";
}

function toneForCode(status: number): Tone {
  if (status >= 500) return "danger";
  if (status >= 400) return "warning";
  if (status >= 300) return "info";
  return "healthy";
}

function Hero({ section }: { section: OpsSection }) {
  const meta = sectionMeta[section];
  return (
    <section className="material-card relative overflow-hidden p-6 md:p-8">
      <div className="absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,#1e40af,#0891b2,#10b981,#f59e0b,#e11d48)]" />
      <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
        <div className="max-w-3xl">
          <span className="material-chip border border-blue-100 bg-blue-50 text-blue-700">{meta.eyebrow}</span>
          <h2 className="mt-4 text-2xl font-bold tracking-tight text-slate-950 md:text-3xl">{meta.title}</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">{meta.description}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className="material-button-secondary"
            onClick={() => toast.success("已刷新当前运维视图")}
          >
            <RefreshCw className="h-4 w-4" />
            刷新
          </button>
          <button
            type="button"
            className="material-button-primary"
            onClick={() => toast.success("已生成导出任务")}
          >
            <Download className="h-4 w-4" />
            导出
          </button>
        </div>
      </div>
    </section>
  );
}

function MetricCard({ item }: { item: any }) {
  const Icon = resolveIcon(item.icon, Activity);
  return (
    <div className="material-card-flat min-w-0 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-500">{item.label}</div>
          <div className="mt-3 text-3xl font-bold tracking-tight text-slate-950">{item.value}</div>
        </div>
        <div className={cn("flex h-11 w-11 items-center justify-center rounded border", statusColors[item.tone])}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <div className="mt-4 text-xs font-semibold text-slate-500">{item.change}</div>
    </div>
  );
}

function OverviewPage({ data }: { data: OpsCenterSectionData | null }) {
  const cards = getArray(data, "health_cards", healthCards);
  const dependencies = getArray(data, "dependency_status", dependencyStatus);
  const trend = getArray(data, "error_trend", errorTrend);
  const slowRows = getArray(data, "slow_apis", slowApis);
  const issues = getArray(data, "recent_issues", errorGroups.slice(0, 3));
  const cloudRows = getArray(data, "cloud_integrations", cloudIntegrations);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-4">
        {cards.map((item: any) => (
          <MetricCard key={item.label} item={item} />
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
        <section className="material-card p-5">
          <PanelTitle icon={Activity} title="24 小时错误趋势" action="按来源拆分" />
          <div className="mt-5 h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ left: 0, right: 12, top: 10, bottom: 0 }}>
                <defs>
                  <linearGradient id="apiErrors" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#1e40af" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#1e40af" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="time" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                <Tooltip />
                <Area type="monotone" dataKey="api" name="接口错误" stroke="#1e40af" fill="url(#apiErrors)" strokeWidth={2} />
                <Line type="monotone" dataKey="task" name="任务错误" stroke="#f59e0b" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="db" name="数据库错误" stroke="#e11d48" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="material-card p-5">
          <PanelTitle icon={Server} title="依赖服务状态" action="实时健康" />
          <div className="mt-5 space-y-3">
            {dependencies.map((item: any) => {
              const Icon = resolveIcon(item.icon, Server);
              return (
              <div key={item.name} className="rounded border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 gap-3">
                    <div className={cn("flex h-10 w-10 items-center justify-center rounded border", statusColors[item.tone])}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold text-slate-900">{item.name}</div>
                      <div className="mt-1 truncate text-xs text-slate-500">{item.detail}</div>
                    </div>
                  </div>
                  <span className={cn("material-chip shrink-0", statusColors[item.tone])}>{item.status}</span>
                </div>
              </div>
            )})}
          </div>
        </section>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="material-card p-5">
          <PanelTitle icon={Clock3} title="慢接口 Top 5" action="P95 耗时" />
          <div className="mt-5 h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={slowRows} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                <CartesianGrid stroke="#e2e8f0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="path" width={190} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(value) => [`${value}ms`, "P95 耗时"]} />
                <Bar dataKey="duration" radius={[0, 4, 4, 0]}>
                  {slowRows.map((item: any, index) => (
                    <Cell key={item.path} fill={chartColors[index % chartColors.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="material-card p-5">
          <PanelTitle icon={Siren} title="最近严重问题" action="待处理优先" />
          <div className="mt-5 space-y-3">
            {issues.map((item: any) => (
              <Link
                key={item.id}
                to="/ops-center/api-errors"
                className="block rounded border border-slate-200 bg-white p-4 transition-colors hover:border-blue-200 hover:bg-blue-50/35"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold text-slate-900">{item.title}</div>
                    <div className="mt-1 text-xs text-slate-500">{item.service} · {item.path}</div>
                  </div>
                  <span className={cn("material-chip shrink-0", statusColors[toneForStatus(item.severity)])}>{item.severity}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                  <span>发生 {item.count} 次</span>
                  <span>影响 {item.users} 人</span>
                  <span>最近 {item.lastSeen}</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      </div>

      <section className="material-card p-5">
        <PanelTitle icon={Cloud} title="二期可观测能力接入状态" action="SLS / RDS / ARMS" />
        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          {cloudRows.map((item: any) => {
            const Icon = resolveIcon(item.icon, Cloud);
            return (
            <div key={item.name} className="rounded border border-slate-200 bg-white p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 gap-3">
                  <div className={cn("flex h-10 w-10 items-center justify-center rounded border", statusColors[item.tone])}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold text-slate-950">{item.name}</div>
                    <div className="mt-1 text-xs leading-5 text-slate-500">{item.detail}</div>
                  </div>
                </div>
                <span className={cn("material-chip shrink-0", statusColors[item.tone])}>{item.status}</span>
              </div>
            </div>
          )})}
        </div>
      </section>
    </div>
  );
}

function ApiErrorsPage({ data }: { data: OpsCenterSectionData | null }) {
  return (
    <div className="space-y-5">
      <ApiLogsPage data={data} />
      <ErrorsPage data={data} />
    </div>
  );
}

function DatabaseMonitoringPage({ data }: { data: OpsCenterSectionData | null }) {
  const [slowKeyword, setSlowKeyword] = useState("");
  const metrics = getArray(data, "database_metrics", databaseMetrics);
  const trend = getArray(data, "database_trend", databaseTrend);
  const slowRows = getArray(data, "slow_queries", slowQueries);
  const deferredSlowKeyword = useDeferredValue(slowKeyword);
  const filteredSlowRows = useMemo(() => {
    const normalized = deferredSlowKeyword.trim().toLowerCase();
    if (!normalized) return slowRows;
    return slowRows.filter((row: any) =>
      row.source.toLowerCase().includes(normalized) ||
      row.query.toLowerCase().includes(normalized),
    );
  }, [deferredSlowKeyword, slowRows]);
  const {
    page: slowPage,
    setPage: setSlowPage,
    totalPages: slowTotalPages,
    pagedRows: pagedSlowRows,
  } = usePagedRows(filteredSlowRows, deferredSlowKeyword, 6);
  const lockRows = getArray(data, "lock_waits", lockWaits);
  const planRows = getArray(data, "database_plan", [
    { label: "当前模式", value: "ECS Docker PostgreSQL", detail: "通过 API 健康检查、Prisma 错误、容器日志和 SLS 采集确认数据库问题。" },
    { label: "增强模式", value: "RDS PostgreSQL", detail: "可直接查看慢 SQL、锁等待、连接、备份、容量、审计和性能洞察。" },
    { label: "建议动作", value: "先接 SLS，再评估 RDS", detail: "短期不迁库也能先实现网页化日志排查；业务稳定后再迁 RDS。" },
  ]);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-4">
        {metrics.map((item: any) => {
          const Icon = resolveIcon(item.icon, Database);
          return (
          <div key={item.label} className="material-card-flat p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-500">{item.label}</div>
                <div className="mt-3 text-2xl font-bold text-slate-950">{item.value}</div>
                <div className="mt-2 text-xs text-slate-500">{item.helper}</div>
              </div>
              <div className={cn("flex h-11 w-11 items-center justify-center rounded border", statusColors[item.tone])}>
                <Icon className="h-5 w-5" />
              </div>
            </div>
          </div>
        )})}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
        <section className="material-card p-5">
          <PanelTitle icon={Database} title="连接、慢 SQL 与锁等待趋势" action="近 6 小时" />
          <div className="mt-5 h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend} margin={{ left: 0, right: 14, top: 10, bottom: 0 }}>
                <CartesianGrid stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="time" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                <Tooltip />
                <Line type="monotone" dataKey="connections" name="连接数" stroke="#1e40af" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="slowSql" name="慢 SQL" stroke="#f59e0b" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="locks" name="锁等待" stroke="#e11d48" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="material-card p-5">
          <PanelTitle icon={Cloud} title="阿里云数据库方案" action="部署模式" />
          <div className="mt-5 space-y-3">
            {planRows.map((row: any) => (
              <div key={row.label} className="rounded border border-slate-200 bg-white p-4">
                <div className="text-xs font-semibold text-slate-500">{row.label}</div>
                <div className="mt-1 font-bold text-slate-950">{row.value}</div>
                <div className="mt-2 text-sm leading-6 text-slate-600">{row.detail}</div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="material-card p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <PanelTitle icon={Clock3} title="慢 SQL 列表" action={`${filteredSlowRows.length} 条`} />
            <div className="relative w-full sm:w-[320px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input className="material-input py-2.5 pl-10" value={slowKeyword} onChange={(event) => setSlowKeyword(event.target.value)} placeholder="搜索来源或 Prisma 操作" />
            </div>
          </div>
          <div className="mt-5 overflow-hidden rounded border border-slate-200">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>查询来源</TableHead>
                  <TableHead>Prisma 操作</TableHead>
                  <TableHead>耗时</TableHead>
                  <TableHead>次数</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedSlowRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-10 text-center text-sm text-slate-400">暂无匹配慢 SQL</TableCell>
                  </TableRow>
                ) : pagedSlowRows.map((row: any) => (
                  <TableRow key={row.query}>
                    <TableCell>{row.source}</TableCell>
                    <TableCell className="font-mono text-xs">{row.query}</TableCell>
                    <TableCell className="font-semibold text-amber-700">{row.duration}ms</TableCell>
                    <TableCell>{row.count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <PaginationControls page={slowPage} total={filteredSlowRows.length} totalPages={slowTotalPages} onPageChange={setSlowPage} />
        </section>

        <section className="material-card p-5">
          <PanelTitle icon={AlertTriangle} title="锁等待与连接风险" action="实时采样" />
          <div className="mt-5 space-y-3">
            {lockRows.map((row: any) => (
              <div key={`${row.table}-${row.session}`} className="rounded border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-bold text-slate-950">{row.table}</div>
                    <div className="mt-1 font-mono text-xs text-slate-500">{row.mode} · {row.session}</div>
                  </div>
                  <span className="material-chip bg-amber-50 text-amber-700">{row.waiting}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function ServicesTasksPage({ data }: { data: OpsCenterSectionData | null }) {
  const services = getArray(data, "service_monitors", serviceMonitors);
  const cloudRows = getArray(data, "cloud_integrations", cloudIntegrations);
  return (
    <div className="space-y-5">
      <section className="material-card p-5">
        <PanelTitle icon={PlugZap} title="第三方服务监控" action="AI / 邮箱 / 阿里云" />
        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          {services.map((item: any) => (
            <div key={item.name} className="rounded border border-slate-200 bg-white p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-bold text-slate-950">{item.name}</div>
                  <div className="mt-1 text-xs text-slate-500">{item.provider} · {item.lastChecked}</div>
                </div>
                <span className={cn("material-chip shrink-0", statusColors[item.tone])}>{item.status}</span>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-3">
                <MiniMetric label="成功率" value={item.successRate} />
                <MiniMetric label="平均耗时" value={item.latency} />
              </div>
              <button type="button" className="material-button-secondary mt-4 w-full !py-2" onClick={() => toast.success(`${item.name} 连接测试已提交`)}>
                <RefreshCw className="h-4 w-4" />
                测试连接
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="material-card p-5">
        <PanelTitle icon={Cloud} title="阿里云可观测集成" action="二期能力" />
        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          {cloudRows.map((item: any) => {
            const Icon = resolveIcon(item.icon, Cloud);
            return (
            <div key={item.name} className="rounded border border-slate-200 bg-white p-5">
              <div className={cn("mb-4 flex h-11 w-11 items-center justify-center rounded border", statusColors[item.tone])}>
                <Icon className="h-5 w-5" />
              </div>
              <div className="font-bold text-slate-950">{item.name}</div>
              <div className="mt-2 text-sm leading-6 text-slate-600">{item.detail}</div>
              <span className={cn("material-chip mt-4", statusColors[item.tone])}>{item.status}</span>
            </div>
          )})}
        </div>
      </section>

      <TaskLogsPage data={data} />
    </div>
  );
}

function AlertsAuditSettingsPage({ data }: { data: OpsCenterSectionData | null }) {
  const [ruleKeyword, setRuleKeyword] = useState("");
  const [ruleLevelFilter, setRuleLevelFilter] = useState("全部");
  const [policyKeyword, setPolicyKeyword] = useState("");
  const rules = getArray(data, "alert_rules", alertRules);
  const policies = getArray(data, "log_policies", logPolicies);
  const deferredRuleKeyword = useDeferredValue(ruleKeyword);
  const deferredPolicyKeyword = useDeferredValue(policyKeyword);
  const filteredRules = useMemo(() => {
    const normalized = deferredRuleKeyword.trim().toLowerCase();
    return rules.filter((row: any) => {
      const levelMatched = ruleLevelFilter === "全部" || row.level === ruleLevelFilter;
      const keywordMatched =
        !normalized ||
        row.name.toLowerCase().includes(normalized) ||
        row.condition.toLowerCase().includes(normalized) ||
        row.channel.toLowerCase().includes(normalized);
      return levelMatched && keywordMatched;
    });
  }, [deferredRuleKeyword, ruleLevelFilter, rules]);
  const filteredPolicies = useMemo(() => {
    const normalized = deferredPolicyKeyword.trim().toLowerCase();
    if (!normalized) return policies;
    return policies.filter((row: any) =>
      row.name.toLowerCase().includes(normalized) ||
      row.retention.toLowerCase().includes(normalized) ||
      row.payload.toLowerCase().includes(normalized) ||
      row.status.toLowerCase().includes(normalized),
    );
  }, [deferredPolicyKeyword, policies]);
  const {
    page: rulePage,
    setPage: setRulePage,
    totalPages: ruleTotalPages,
    pagedRows: pagedRules,
  } = usePagedRows(filteredRules, `${deferredRuleKeyword}|${ruleLevelFilter}`, 6);
  const {
    page: policyPage,
    setPage: setPolicyPage,
    totalPages: policyTotalPages,
    pagedRows: pagedPolicies,
  } = usePagedRows(filteredPolicies, deferredPolicyKeyword, 6);
  const settings = getArray(data, "log_settings", ["慢接口阈值：1000ms", "慢 SQL 阈值：800ms", "错误堆栈：生产环境仅管理员可见", "敏感字段：password、api_key、token、secret 自动脱敏"]);

  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
        <section className="material-card p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <PanelTitle icon={BellRing} title="告警规则" action={`${filteredRules.length} 条`} />
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="relative w-full sm:w-[280px]">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input className="material-input py-2.5 pl-10" value={ruleKeyword} onChange={(event) => setRuleKeyword(event.target.value)} placeholder="搜索规则、条件、渠道" />
              </div>
              <SelectControl
                value={ruleLevelFilter}
                onValueChange={setRuleLevelFilter}
                options={["全部", "严重", "警告", "提示"].map((item) => ({ label: item, value: item }))}
                className="w-full sm:w-28"
              />
            </div>
          </div>
          <div className="mt-5 overflow-hidden rounded border border-slate-200">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>规则</TableHead>
                  <TableHead>触发条件</TableHead>
                  <TableHead>渠道</TableHead>
                  <TableHead>级别</TableHead>
                  <TableHead>状态</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedRules.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center text-sm text-slate-400">暂无匹配告警规则</TableCell>
                  </TableRow>
                ) : pagedRules.map((row: any) => (
                  <TableRow key={row.name}>
                    <TableCell className="font-semibold text-slate-900">{row.name}</TableCell>
                    <TableCell>{row.condition}</TableCell>
                    <TableCell>{row.channel}</TableCell>
                    <TableCell><span className={cn("material-chip", statusColors[toneForStatus(row.level)])}>{row.level}</span></TableCell>
                    <TableCell><span className={cn("material-chip", row.enabled ? statusColors.healthy : statusColors.neutral)}>{row.enabled ? "启用" : "停用"}</span></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <PaginationControls page={rulePage} total={filteredRules.length} totalPages={ruleTotalPages} onPageChange={setRulePage} />
        </section>

        <section className="material-card p-5">
          <PanelTitle icon={Settings2} title="日志设置" action="保留与脱敏" />
          <div className="mt-5 space-y-3">
            {settings.map((item: string) => (
              <div key={item} className="rounded border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-700">{item}</div>
            ))}
            <button type="button" className="material-button-primary w-full" onClick={() => toast.success("日志策略已保存")}>
              <Settings2 className="h-4 w-4" />
              保存策略
            </button>
            <button type="button" className="material-button-secondary w-full text-red-600 hover:border-red-200 hover:bg-red-50" onClick={() => toast.success("已创建过期日志清理任务")}>
              <Trash2 className="h-4 w-4" />
              清理过期日志
            </button>
          </div>
        </section>
      </div>

      <section className="material-card p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <PanelTitle icon={FileSearch} title="日志保留策略" action={`${filteredPolicies.length} 条`} />
          <div className="relative w-full sm:w-[320px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input className="material-input py-2.5 pl-10" value={policyKeyword} onChange={(event) => setPolicyKeyword(event.target.value)} placeholder="搜索日志类型、内容、状态" />
          </div>
        </div>
        <div className="mt-5 overflow-hidden rounded border border-slate-200">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>日志类型</TableHead>
                <TableHead>保留时间</TableHead>
                <TableHead>记录内容</TableHead>
                <TableHead>脱敏</TableHead>
                <TableHead>状态</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagedPolicies.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-sm text-slate-400">暂无匹配日志策略</TableCell>
                </TableRow>
              ) : pagedPolicies.map((row: any) => (
                <TableRow key={row.name}>
                  <TableCell className="font-semibold text-slate-900">{row.name}</TableCell>
                  <TableCell>{row.retention}</TableCell>
                  <TableCell>{row.payload}</TableCell>
                  <TableCell>{row.masking}</TableCell>
                  <TableCell><span className="material-chip bg-emerald-50 text-emerald-700">{row.status}</span></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <PaginationControls page={policyPage} total={filteredPolicies.length} totalPages={policyTotalPages} onPageChange={setPolicyPage} />
      </section>

      <AuditLogsPage data={data} />
    </div>
  );
}

function ApiLogsPage({ data }: { data: OpsCenterSectionData | null }) {
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState("全部");
  const [selectedLogId, setSelectedLogId] = useState("");
  const deferredKeyword = useDeferredValue(keyword);
  const rows = getArray(data, "api_logs", apiLogs);
  const errorRows = useMemo(() => rows.filter((item: any) => item.status >= 400), [rows]);
  const filteredRows = useMemo(() => {
    const normalized = deferredKeyword.trim().toLowerCase();
    return rows.filter((item: any) => {
      const statusMatched =
        statusFilter === "全部" ||
        (statusFilter === "2xx" && item.status >= 200 && item.status < 300) ||
        (statusFilter === "4xx" && item.status >= 400 && item.status < 500) ||
        (statusFilter === "5xx" && item.status >= 500);
      const keywordMatched =
        !normalized ||
        item.path.toLowerCase().includes(normalized) ||
        item.user.toLowerCase().includes(normalized) ||
        item.message.toLowerCase().includes(normalized) ||
        item.id.toLowerCase().includes(normalized);
      return statusMatched && keywordMatched;
    });
  }, [deferredKeyword, rows, statusFilter]);
  const {
    page,
    setPage,
    totalPages,
    pagedRows,
  } = usePagedRows(filteredRows, `${deferredKeyword}|${statusFilter}`);

  useEffect(() => {
    if (!filteredRows.length) {
      setSelectedLogId("");
      return;
    }
    setSelectedLogId((current) => {
      if (current && filteredRows.some((item: any) => item.id === current)) return current;
      return filteredRows[0]?.id ?? "";
    });
  }, [filteredRows]);

  const selected = filteredRows.find((item: any) => item.id === selectedLogId) ?? filteredRows[0] ?? rows[0] ?? apiLogs[0];
  const selectedHasError = selected.status >= 400 || selected.errorName || selected.errorStack;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="material-card min-w-0 p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <PanelTitle icon={Activity} title="请求记录" action={`${filteredRows.length} 条`} />
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative w-full sm:w-[320px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input className="material-input py-2.5 pl-10" value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索接口、用户、错误信息" />
            </div>
            <SelectControl
              value={statusFilter}
              onValueChange={setStatusFilter}
              options={["全部", "2xx", "4xx", "5xx"].map((item) => ({ label: item, value: item }))}
              className="w-full sm:w-28"
            />
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <MiniMetric label="当前错误日志" value={String(errorRows.length)} />
          <MiniMetric label="5xx 严重错误" value={String(rows.filter((item: any) => item.status >= 500).length)} />
          <MiniMetric label="当前选中" value={selected?.id ?? "-"} />
        </div>

        <div className="mt-5 overflow-hidden rounded border border-slate-200">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>时间</TableHead>
                <TableHead>接口</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>耗时</TableHead>
                <TableHead>用户</TableHead>
                <TableHead>说明</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagedRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-sm text-slate-400">暂无匹配接口日志</TableCell>
                </TableRow>
              ) : pagedRows.map((row) => (
                <TableRow
                  key={row.id}
                  className={cn(
                    "cursor-pointer align-top transition hover:bg-blue-50/40",
                    selected.id === row.id && "bg-blue-50/70 ring-1 ring-inset ring-blue-200",
                  )}
                  onClick={() => setSelectedLogId(row.id)}
                >
                  <TableCell className="whitespace-nowrap text-xs text-slate-500">{row.time}</TableCell>
                  <TableCell>
                    <div className="font-mono text-xs font-semibold text-slate-800">{row.method} {row.path}</div>
                    <div className="mt-1 font-mono text-[11px] text-slate-400">{row.id}</div>
                  </TableCell>
                  <TableCell><span className={cn("material-chip", statusColors[toneForCode(row.status)])}>{row.status}</span></TableCell>
                  <TableCell className={cn("font-semibold", row.duration > 2000 ? "text-amber-700" : "text-slate-600")}>{row.duration}ms</TableCell>
                  <TableCell>{row.user}</TableCell>
                  <TableCell className="max-w-[260px] truncate text-slate-600">{row.message}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <PaginationControls page={page} total={filteredRows.length} totalPages={totalPages} onPageChange={setPage} />
      </section>

      <DetailPanel title="接口详情" icon={Eye}>
        <KeyValue label="Request ID" value={selected.id} mono />
        <KeyValue label="接口路径" value={`${selected.method} ${selected.path}`} mono />
        <KeyValue label="状态码" value={String(selected.status)} />
        <KeyValue label="请求耗时" value={`${selected.duration}ms`} />
        <KeyValue label="触发用户" value={selected.user} />
        <KeyValue label="来源 IP" value={selected.ip} />
        <div className={cn("rounded border p-3 text-sm leading-6", selectedHasError ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-emerald-50 text-emerald-800")}>
          <div className="mb-1 text-xs font-semibold uppercase tracking-[0.12em] opacity-80">{selectedHasError ? "错误信息" : "响应摘要"}</div>
          {selected.message}
        </div>
        {selected.errorName ? <KeyValue label="错误类型" value={selected.errorName} mono /> : null}
        {selected.errorStack ? (
          <div className="rounded border border-slate-200 bg-slate-950 p-3 text-xs leading-5 text-slate-100">
            <div className="mb-2 font-semibold text-slate-300">错误堆栈</div>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono">{selected.errorStack}</pre>
          </div>
        ) : null}
        <div className="grid gap-3">
          <JsonBlock title="请求摘要" value={selected.requestMeta} />
          <JsonBlock title="响应摘要" value={selected.responseMeta} />
        </div>
      </DetailPanel>
    </div>
  );
}

function ErrorsPage({ data }: { data: OpsCenterSectionData | null }) {
  const [keyword, setKeyword] = useState("");
  const [severityFilter, setSeverityFilter] = useState("全部");
  const [selectedIssueId, setSelectedIssueId] = useState("");
  const rows = getArray(data, "error_groups", errorGroups);
  const deferredKeyword = useDeferredValue(keyword);
  const filteredRows = useMemo(() => {
    const normalized = deferredKeyword.trim().toLowerCase();
    return rows.filter((item: any) => {
      const severityMatched = severityFilter === "全部" || item.severity === severityFilter;
      const keywordMatched =
        !normalized ||
        item.title.toLowerCase().includes(normalized) ||
        item.service.toLowerCase().includes(normalized) ||
        item.path.toLowerCase().includes(normalized) ||
        item.status.toLowerCase().includes(normalized);
      return severityMatched && keywordMatched;
    });
  }, [deferredKeyword, rows, severityFilter]);
  const {
    page,
    setPage,
    totalPages,
    pagedRows,
  } = usePagedRows(filteredRows, `${deferredKeyword}|${severityFilter}`, 6);

  useEffect(() => {
    if (!filteredRows.length) {
      setSelectedIssueId("");
      return;
    }
    setSelectedIssueId((current) => {
      if (current && filteredRows.some((item: any) => item.id === current)) return current;
      return (filteredRows[0] as any)?.id ?? "";
    });
  }, [filteredRows]);
  const selectedIssue = filteredRows.find((item: any) => item.id === selectedIssueId) ?? filteredRows[0] ?? null;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <section className="material-card min-w-0 p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <PanelTitle icon={Siren} title="错误聚合" action={`${filteredRows.length} 条`} />
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative w-full sm:w-[320px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input className="material-input py-2.5 pl-10" value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索错误、接口、服务、状态" />
            </div>
            <SelectControl
              value={severityFilter}
              onValueChange={setSeverityFilter}
              options={["全部", "严重", "警告", "提示"].map((item) => ({ label: item, value: item }))}
              className="w-full sm:w-28"
            />
          </div>
        </div>
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          {pagedRows.length === 0 ? (
            <div className="rounded border border-dashed border-slate-200 bg-slate-50 px-4 py-12 text-center text-sm text-slate-400 lg:col-span-2">暂无匹配错误聚合</div>
          ) : pagedRows.map((item: any) => (
            <div
              key={item.id}
              className={cn(
                "cursor-pointer rounded border bg-white p-5 transition hover:border-blue-200 hover:bg-blue-50/30",
                selectedIssue?.id === item.id ? "border-blue-300 bg-blue-50/40 ring-1 ring-blue-200" : "border-slate-200",
              )}
              onClick={() => setSelectedIssueId(item.id)}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="truncate text-base font-bold text-slate-950">{item.title}</div>
                  <div className="mt-1 text-xs text-slate-500">{item.service} · {item.path}</div>
                </div>
                <span className={cn("material-chip shrink-0", statusColors[toneForStatus(item.severity)])}>{item.severity}</span>
              </div>
              <div className="mt-5 grid grid-cols-3 gap-3">
                <MiniMetric label="次数" value={String(item.count)} />
                <MiniMetric label="用户" value={String(item.users)} />
                <MiniMetric label="状态" value={item.status} />
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" className="material-button-secondary !px-3 !py-2" onClick={(event) => { event.stopPropagation(); setSelectedIssueId(item.id); toast.success("已在右侧展示关联错误"); }}>
                  <FileSearch className="h-4 w-4" />
                  关联日志
                </button>
                <button type="button" className="material-button-secondary !px-3 !py-2" onClick={(event) => { event.stopPropagation(); toast.success("已更新处理状态"); }}>
                  <CheckCircle2 className="h-4 w-4" />
                  标记处理
                </button>
              </div>
            </div>
          ))}
        </div>
        <PaginationControls page={page} total={filteredRows.length} totalPages={totalPages} onPageChange={setPage} />
      </section>

      <DetailPanel title="处理建议" icon={AlertTriangle}>
        {selectedIssue ? (
          <div className="rounded border border-rose-200 bg-rose-50 p-4">
            <div className="font-bold text-rose-800">{selectedIssue.title}</div>
            <p className="mt-2 text-sm leading-6 text-rose-700">
              最近 {selectedIssue.count} 次，影响 {selectedIssue.users} 位用户；最后出现于 {selectedIssue.lastSeen}。优先检查 {selectedIssue.service} 对应接口和上游依赖。
            </p>
            <div className="mt-3 rounded bg-white/70 p-2 font-mono text-xs text-rose-700">{selectedIssue.path}</div>
          </div>
        ) : null}
        <div className="space-y-3">
          {[
            "先打开上方接口日志，确认最新 request id、错误堆栈和请求摘要",
            "按接口路径排查对应服务配置、上游连接和数据库依赖",
            "若为 5xx 或连续出现，将错误同步到阿里云 SLS / 告警规则",
          ].map((item, index) => (
            <div key={item} className="flex gap-3 rounded border border-slate-200 bg-white p-3 text-sm text-slate-700">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-slate-950 text-xs font-bold text-white">{index + 1}</span>
              {item}
            </div>
          ))}
        </div>
      </DetailPanel>
    </div>
  );
}

function TaskLogsPage({ data }: { data: OpsCenterSectionData | null }) {
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState("全部");
  const rows = getArray(data, "task_logs", taskLogs);
  const deferredKeyword = useDeferredValue(keyword);
  const filteredRows = useMemo(() => {
    const normalized = deferredKeyword.trim().toLowerCase();
    return rows.filter((row: any) => {
      const statusMatched = statusFilter === "全部" || row.status === statusFilter;
      const keywordMatched =
        !normalized ||
        row.module.toLowerCase().includes(normalized) ||
        row.action.toLowerCase().includes(normalized) ||
        row.owner.toLowerCase().includes(normalized) ||
        row.detail.toLowerCase().includes(normalized);
      return statusMatched && keywordMatched;
    });
  }, [deferredKeyword, rows, statusFilter]);
  const {
    page,
    setPage,
    totalPages,
    pagedRows,
  } = usePagedRows(filteredRows, `${deferredKeyword}|${statusFilter}`);
  const summary = getArray(data, "task_summary", [
    { label: "成功任务", value: "126", tone: "healthy" as Tone },
    { label: "失败任务", value: "9", tone: "danger" as Tone },
    { label: "跳过任务", value: "18", tone: "warning" as Tone },
    { label: "平均耗时", value: "1.8s", tone: "info" as Tone },
  ]);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-4">
        {summary.map((item: any) => (
          <div key={item.label} className={cn("rounded border p-5", statusColors[item.tone])}>
            <div className="text-sm font-semibold opacity-80">{item.label}</div>
            <div className="mt-2 text-3xl font-bold">{item.value}</div>
          </div>
        ))}
      </div>

      <section className="material-card p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <PanelTitle icon={Bot} title="任务执行记录" action={`${filteredRows.length} 条`} />
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative w-full sm:w-[320px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input className="material-input py-2.5 pl-10" value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索模块、动作、执行人、结果" />
            </div>
            <SelectControl
              value={statusFilter}
              onValueChange={setStatusFilter}
              options={["全部", "成功", "失败", "跳过"].map((item) => ({ label: item, value: item }))}
              className="w-full sm:w-28"
            />
          </div>
        </div>
        <div className="mt-5 overflow-hidden rounded border border-slate-200">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>时间</TableHead>
                <TableHead>模块</TableHead>
                <TableHead>动作</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>耗时</TableHead>
                <TableHead>执行人</TableHead>
                <TableHead>结果</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagedRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-sm text-slate-400">暂无匹配任务日志</TableCell>
                </TableRow>
              ) : pagedRows.map((row: any) => (
                <TableRow key={row.id} className="align-top">
                  <TableCell className="whitespace-nowrap text-xs text-slate-500">{row.time}</TableCell>
                  <TableCell><span className="material-chip bg-slate-100 text-slate-700">{row.module}</span></TableCell>
                  <TableCell className="font-semibold text-slate-800">{row.action}</TableCell>
                  <TableCell><span className={cn("material-chip", statusColors[toneForStatus(row.status)])}>{row.status}</span></TableCell>
                  <TableCell>{row.duration}</TableCell>
                  <TableCell>{row.owner}</TableCell>
                  <TableCell className="max-w-[360px] text-sm leading-6 text-slate-600">{row.detail}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <PaginationControls page={page} total={filteredRows.length} totalPages={totalPages} onPageChange={setPage} />
      </section>
    </div>
  );
}

function AuditLogsPage({ data }: { data: OpsCenterSectionData | null }) {
  const [keyword, setKeyword] = useState("");
  const [riskFilter, setRiskFilter] = useState("全部");
  const rows = getArray(data, "audit_logs", auditLogs);
  const deferredKeyword = useDeferredValue(keyword);
  const filteredRows = useMemo(() => {
    const normalized = deferredKeyword.trim().toLowerCase();
    return rows.filter((row: any) => {
      const riskMatched = riskFilter === "全部" || row.risk === riskFilter;
      const keywordMatched =
        !normalized ||
        row.user.toLowerCase().includes(normalized) ||
        row.action.toLowerCase().includes(normalized) ||
        row.resource.toLowerCase().includes(normalized) ||
        row.summary.toLowerCase().includes(normalized) ||
        row.ip.toLowerCase().includes(normalized);
      return riskMatched && keywordMatched;
    });
  }, [deferredKeyword, riskFilter, rows]);
  const {
    page,
    setPage,
    totalPages,
    pagedRows,
  } = usePagedRows(filteredRows, `${deferredKeyword}|${riskFilter}`);
  const summary = data?.audit_summary as { today_events?: number; high_risk?: number; users?: number } | undefined;
  const highRiskCount = summary?.high_risk ?? rows.filter((item: any) => item.risk === "高").length;
  const todayEvents = summary?.today_events ?? rows.length;
  const userCount = summary?.users ?? new Set(rows.map((item: any) => item.user)).size;
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="material-card min-w-0 p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <PanelTitle icon={ShieldCheck} title="用户操作审计" action={`${filteredRows.length} 条`} />
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative w-full sm:w-[320px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input className="material-input py-2.5 pl-10" value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索用户、操作、模块、IP" />
            </div>
            <SelectControl
              value={riskFilter}
              onValueChange={setRiskFilter}
              options={["全部", "高", "中", "低"].map((item) => ({ label: item, value: item }))}
              className="w-full sm:w-28"
            />
          </div>
        </div>
        <div className="mt-5 overflow-hidden rounded border border-slate-200">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>时间</TableHead>
                <TableHead>用户</TableHead>
                <TableHead>操作</TableHead>
                <TableHead>模块</TableHead>
                <TableHead>风险</TableHead>
                <TableHead>IP</TableHead>
                <TableHead>摘要</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagedRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-sm text-slate-400">暂无匹配审计日志</TableCell>
                </TableRow>
              ) : pagedRows.map((row: any) => (
                <TableRow key={row.id} className="align-top">
                  <TableCell className="whitespace-nowrap text-xs text-slate-500">{row.time}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2 font-semibold text-slate-800">
                      <UserRound className="h-4 w-4 text-slate-400" />
                      {row.user}
                    </div>
                  </TableCell>
                  <TableCell>{row.action}</TableCell>
                  <TableCell><span className="material-chip bg-slate-100 text-slate-700">{row.resource}</span></TableCell>
                  <TableCell><span className={cn("material-chip", row.risk === "高" ? statusColors.danger : statusColors.warning)}>{row.risk}</span></TableCell>
                  <TableCell className="font-mono text-xs">{row.ip}</TableCell>
                  <TableCell className="max-w-[320px] text-sm leading-6 text-slate-600">{row.summary}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <PaginationControls page={page} total={filteredRows.length} totalPages={totalPages} onPageChange={setPage} />
      </section>

      <DetailPanel title="审计摘要" icon={ShieldCheck}>
        <MiniMetric label="今日审计事件" value={String(todayEvents)} />
        <MiniMetric label="高风险操作" value={String(highRiskCount)} />
        <MiniMetric label="涉及用户" value={String(userCount)} />
        <div className="rounded border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-800">
          建议将修改 AI Key、角色权限、停用用户、删除数据等操作保持 90 天以上审计保留。
        </div>
      </DetailPanel>
    </div>
  );
}

function PanelTitle({ icon: Icon, title, action }: { icon: React.ComponentType<{ className?: string }>; title: string; action?: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-slate-200 bg-white text-slate-700 shadow-sm">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h3 className="truncate text-base font-bold text-slate-950">{title}</h3>
        </div>
      </div>
      {action ? <span className="material-chip shrink-0 bg-slate-100 text-slate-600">{action}</span> : null}
    </div>
  );
}

function DetailPanel({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <aside className="material-card h-fit p-5">
      <PanelTitle icon={icon} title={title} />
      <div className="mt-5 space-y-4">{children}</div>
    </aside>
  );
}

function KeyValue({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded border border-slate-200 bg-slate-50 p-3">
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <div className={cn("mt-1 break-all text-sm font-semibold text-slate-900", mono ? "font-mono" : "")}>{value}</div>
    </div>
  );
}

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  const content = value ? JSON.stringify(value, null, 2) : "-";
  return (
    <div className="rounded border border-slate-200 bg-slate-50 p-3">
      <div className="mb-2 text-xs font-semibold text-slate-500">{title}</div>
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-slate-700">{content}</pre>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-slate-200 bg-slate-50 p-3">
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-bold text-slate-950">{value}</div>
    </div>
  );
}

function SectionContent({ section, data }: { section: OpsSection; data: OpsCenterSectionData | null }) {
  if (section === "api-errors") return <ApiErrorsPage data={data} />;
  if (section === "database") return <DatabaseMonitoringPage data={data} />;
  if (section === "services-tasks") return <ServicesTasksPage data={data} />;
  if (section === "alerts-audit") return <AlertsAuditSettingsPage data={data} />;
  return <OverviewPage data={data} />;
}

export function OpsCenterPage({ section }: OpsCenterPageProps) {
  const [data, setData] = useState<OpsCenterSectionData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    opsCenterApi.getSection(section)
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((error) => {
        if (!cancelled) {
          setData(null);
          const message = error instanceof Error ? error.message : "运维数据加载失败";
          setLoadError(message);
          toast.error(message);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [section]);

  return (
    <div className="min-w-[960px] space-y-5">
      <Hero section={section} />
      {(loading || loadError) ? (
        <div className={cn("material-card px-4 py-3 text-sm font-semibold", loadError ? "text-amber-700" : "text-slate-600")}>
          {loading ? "正在加载真实运维数据..." : `已使用页面降级数据：${loadError}`}
        </div>
      ) : null}
      <div className="relative">
        <div className="pointer-events-none absolute -left-3 top-6 h-20 w-1 rounded-full bg-[linear-gradient(180deg,#1e40af,#0891b2,#10b981)]" />
        <SectionContent section={section} data={data} />
      </div>
    </div>
  );
}
