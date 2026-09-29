import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
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
  type LucideIcon,
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

import {
  HorizonEmptyState,
  HorizonMetric,
  HorizonMetricGrid,
  HorizonPageHeader,
  type HorizonTone,
} from "./components/horizon/HorizonPage";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "./components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { cn } from "./components/ui/utils";
import { opsCenterApi, type OpsCenterSectionData, type OpsErrorAnalysis } from "./lib/opsCenterApi";
// 页面路径以「页面路由管理」的配置为准，随主路径变更自动跟随
import { routePath } from "./lib/routePaths";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";

type OpsSection = "overview" | "api-errors" | "database" | "services-tasks" | "alerts-audit";
type Tone = "healthy" | "info" | "warning" | "danger" | "neutral";

type OpsCenterPageProps = {
  section: OpsSection;
};

const sectionMeta: Record<OpsSection, { title: string; eyebrow: string; description: string; icon: LucideIcon }> = {
  overview: {
    title: "运维总览",
    eyebrow: "Operations Overview",
    description: "集中查看接口、数据库、AI、邮箱同步和后台任务的运行状态。",
    icon: Activity,
  },
  "api-errors": {
    title: "接口与错误",
    eyebrow: "API & Incident Center",
    description: "按接口、状态码、耗时、错误聚合和处理状态定位线上问题。",
    icon: Siren,
  },
  database: {
    title: "数据库监控",
    eyebrow: "PostgreSQL Observability",
    description: "查看数据库连接、慢 SQL、锁等待、容量、RDS/ECS 接入状态。",
    icon: Database,
  },
  "services-tasks": {
    title: "服务与任务",
    eyebrow: "Third-party Services & Jobs",
    description: "监控 AI 模型、邮箱、阿里云集成和业务自动化任务执行结果。",
    icon: PlugZap,
  },
  "alerts-audit": {
    title: "告警与审计设置",
    eyebrow: "Alerting, Audit & Log Policy",
    description: "配置告警规则、日志保留、敏感字段脱敏、SLS/RDS/ARMS 集成策略。",
    icon: ShieldCheck,
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

const statusColors: Record<Tone, string> = {
  healthy: "border-emerald-200 bg-emerald-50 text-emerald-700",
  info: "border-blue-200 bg-blue-50 text-blue-700",
  warning: "border-amber-200 bg-amber-50 text-amber-700",
  danger: "border-rose-200 bg-rose-50 text-rose-700",
  neutral: "border-slate-200 bg-slate-100 text-slate-600",
};

const chartColors = ["var(--primary)", "#1d4ed8", "#0284c7", "#f59e0b", "#dc2626"];
const selectTriggerClass = "h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-none outline-none transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary";
const inputClass = "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 shadow-none outline-none transition-colors placeholder:text-muted-foreground hover:border-slate-300 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25";
const secondaryActionClass = "inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-none transition-colors hover:border-primary/25 hover:bg-accent hover:text-primary disabled:cursor-not-allowed disabled:opacity-50";
const primaryActionClass = "hz-primary-action inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const chipClass = "inline-flex items-center rounded-md border px-2 py-1 text-xs font-semibold";
const OPS_TABLE_PAGE_SIZE = 8;

function SelectControl({
  value,
  onValueChange,
  options,
  className,
  ariaLabel = "筛选选项",
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className={cn(selectTriggerClass, className)} aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="horizon-portal rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
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
    <nav className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between" aria-label="数据分页">
      <div className="text-sm tabular-nums text-slate-500" aria-live="polite">
        共 {total} 条，第 {page} / {totalPages} 页
      </div>
      <div className="flex gap-2">
        <Button variant="unstyled"
          type="button"
          className={secondaryActionClass}
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          aria-label="上一页"
        >
          上一页
        </Button>
        <Button variant="unstyled"
          type="button"
          className={secondaryActionClass}
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          aria-label="下一页"
        >
          下一页
        </Button>
      </div>
    </nav>
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

function resolveIcon(value: unknown, fallback: LucideIcon): LucideIcon {
  if (typeof value === "string" && value in iconMap) {
    return iconMap[value as keyof typeof iconMap];
  }
  return fallback;
}

function getArray<T>(data: OpsCenterSectionData | null, key: string, fallback: T[]): T[] {
  const value = data?.[key];
  return Array.isArray(value) ? (value as T[]) : fallback;
}

type OpsHeaderMetric = {
  label: string;
  value: React.ReactNode;
  note: React.ReactNode;
  tone: HorizonTone;
  icon: LucideIcon;
};

function toHorizonTone(tone: unknown): HorizonTone {
  if (tone === "healthy") return "success";
  if (tone === "warning") return "warning";
  if (tone === "danger") return "danger";
  if (tone === "info") return "brand";
  return "neutral";
}

function metricFromRow(row: any, fallback: any): OpsHeaderMetric {
  const item = row ?? fallback;
  return {
    label: String(item.label ?? fallback.label),
    value: item.value ?? fallback.value,
    note: item.change ?? item.helper ?? fallback.change ?? fallback.helper ?? "实时数据",
    tone: toHorizonTone(item.tone ?? fallback.tone),
    icon: resolveIcon(item.icon, resolveIcon(fallback.icon, Activity)),
  };
}

function buildSectionMetrics(section: OpsSection, data: OpsCenterSectionData | null): [OpsHeaderMetric, OpsHeaderMetric, OpsHeaderMetric, OpsHeaderMetric] {
  if (section === "overview") {
    const rows = getArray<any>(data, "health_cards", healthCards);
    return healthCards.map((fallback, index) => metricFromRow(rows[index], fallback)) as [OpsHeaderMetric, OpsHeaderMetric, OpsHeaderMetric, OpsHeaderMetric];
  }

  if (section === "database") {
    const rows = getArray<any>(data, "database_metrics", databaseMetrics);
    return databaseMetrics.map((fallback, index) => metricFromRow(rows[index], fallback)) as [OpsHeaderMetric, OpsHeaderMetric, OpsHeaderMetric, OpsHeaderMetric];
  }

  if (section === "services-tasks") {
    const unavailableNote = data ? "当前响应未返回统计" : "等待实时数据";
    const fallback = [
      { label: "成功任务", value: "—", helper: unavailableNote, tone: "neutral", icon: CheckCircle2 },
      { label: "失败任务", value: "—", helper: unavailableNote, tone: "neutral", icon: AlertTriangle },
      { label: "跳过任务", value: "—", helper: unavailableNote, tone: "neutral", icon: Clock3 },
      { label: "任务总数", value: "—", helper: unavailableNote, tone: "neutral", icon: Gauge },
    ];
    const rows = getArray<any>(data, "task_summary", []);
    return fallback.map((item, index) => metricFromRow(rows[index], item)) as [OpsHeaderMetric, OpsHeaderMetric, OpsHeaderMetric, OpsHeaderMetric];
  }

  if (section === "alerts-audit") {
    const rules = getArray<any>(data, "alert_rules", []);
    const policies = getArray<any>(data, "log_policies", []);
    const audits = getArray<any>(data, "audit_logs", auditLogs);
    const summary = data?.audit_summary as { today_events?: number; high_risk?: number; users?: number } | undefined;
    return [
      { label: "启用告警", value: rules.filter((row) => row.enabled).length, note: `共 ${rules.length} 条规则`, tone: "brand", icon: BellRing },
      { label: "今日审计", value: summary?.today_events ?? audits.length, note: "实时操作事件", tone: "neutral", icon: ShieldCheck },
      { label: "高风险操作", value: summary?.high_risk ?? audits.filter((row) => row.risk === "高").length, note: "建议优先复核", tone: "danger", icon: Siren },
      { label: "日志策略", value: policies.length, note: `${summary?.users ?? new Set(audits.map((row) => row.user)).size} 位相关用户`, tone: "success", icon: FileSearch },
    ];
  }

  const logs = getArray<any>(data, "api_logs", apiLogs);
  const groups = getArray<any>(data, "error_groups", errorGroups);
  const pagination = data?.pagination as { total?: number } | undefined;
  return [
    { label: "请求记录", value: pagination?.total ?? logs.length, note: "当前查询窗口", tone: "brand", icon: Activity },
    { label: "4xx 错误", value: logs.filter((row) => row.status >= 400 && row.status < 500).length, note: "当前返回批次", tone: "warning", icon: AlertTriangle },
    { label: "5xx 错误", value: logs.filter((row) => row.status >= 500).length, note: "当前返回批次", tone: "danger", icon: Siren },
    { label: "待处理聚合", value: groups.filter((row) => !["已解决", "已忽略"].includes(row.status)).length, note: `共 ${groups.length} 个错误簇`, tone: "warning", icon: FileSearch },
  ];
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

function OverviewPage({ data }: { data: OpsCenterSectionData | null }) {
  const dependencies = getArray(data, "dependency_status", dependencyStatus);
  const trend = getArray(data, "error_trend", errorTrend);
  const slowRows = getArray(data, "slow_apis", slowApis);
  const issues = getArray(data, "recent_issues", errorGroups.slice(0, 3));
  const cloudRows = getArray(data, "cloud_integrations", cloudIntegrations);

  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
        <section className="hz-surface min-w-0 border border-slate-200 p-5">
          <PanelTitle icon={Activity} title="24 小时错误趋势" action="按来源拆分" />
          <div className="mt-5 h-[280px] min-w-0" aria-label="24 小时错误趋势图">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ left: 0, right: 12, top: 10, bottom: 0 }}>
                <CartesianGrid stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="time" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                <Tooltip />
                <Area type="monotone" dataKey="api" name="接口错误" stroke="var(--primary)" fill="#e7efff" strokeWidth={2} />
                <Line type="monotone" dataKey="task" name="任务错误" stroke="#f59e0b" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="db" name="数据库错误" stroke="#e11d48" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="hz-surface min-w-0 border border-slate-200 p-5">
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
                  <span className={cn(chipClass, "shrink-0", statusColors[item.tone])}>{item.status}</span>
                </div>
              </div>
            )})}
          </div>
        </section>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="hz-surface min-w-0 border border-slate-200 p-5">
          <PanelTitle icon={Clock3} title="慢接口 Top 5" action="P95 耗时" />
          <div className="mt-5 h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={slowRows} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                <CartesianGrid stroke="#e2e8f0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="path" width={190} axisLine={false} tickLine={false}
                  tick={({ x, y, payload }) => {
                    const path = String(payload.value);
                    const label = path.length > 26 ? `${path.slice(0, 10)}…${path.slice(-15)}` : path;
                    return <g transform={`translate(${x},${y})`}><title>{path}</title><text x={-3} dy="0.32em" textAnchor="end" fill="var(--muted-foreground)" fontSize={11}>{label}</text></g>;
                  }}
                />
                <Tooltip formatter={(value) => [`${value}ms`, "P95 耗时"]} contentStyle={{ maxWidth: 320, overflowWrap: "anywhere" }} />
                <Bar dataKey="duration" radius={[0, 4, 4, 0]}>
                  {slowRows.map((item: any, index) => (
                    <Cell key={item.path} fill={chartColors[index % chartColors.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="hz-surface min-w-0 border border-slate-200 p-5">
          <PanelTitle icon={Siren} title="最近严重问题" action="待处理优先" />
          <div className="mt-5 space-y-3">
            {issues.map((item: any) => (
              <Link
                key={item.id}
                to={routePath("page:ops-api-errors", "/ops-center/api-errors")}
                className="block rounded-lg border border-slate-200 bg-white p-4 transition-colors hover:border-primary/25 hover:bg-accent/40"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold text-slate-900">{item.title}</div>
                    <div className="mt-1 text-xs text-slate-500">{item.service} · {item.path}</div>
                  </div>
                  <span className={cn(chipClass, "shrink-0", statusColors[toneForStatus(item.severity)])}>{item.severity}</span>
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

      <section className="hz-surface min-w-0 border border-slate-200 p-5">
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
                <span className={cn(chipClass, "shrink-0", statusColors[item.tone])}>{item.status}</span>
              </div>
            </div>
          )})}
        </div>
      </section>
    </div>
  );
}

function AiList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <div className="font-semibold text-slate-800">{title}</div>
      <ul className="mt-1 list-disc space-y-1 pl-4">
        {items.map((it, i) => <li key={i}>{it}</li>)}
      </ul>
    </div>
  );
}

/** AI 报错归因块：按 requestId 触发分析，展示 可能原因/影响面/排查建议/修复方向。 */
function AiAnalysisBlock({ requestId, aiReady }: { requestId: string; aiReady?: boolean }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<OpsErrorAnalysis | null>(null);

  useEffect(() => { setResult(null); }, [requestId]);

  const run = async (force: boolean) => {
    if (!requestId) return;
    setLoading(true);
    try {
      const r = await opsCenterApi.analyzeApiError({ request_id: requestId, force });
      setResult(r);
      if (r.generated_by !== "ai") toast.error(r.summary || "AI 暂不可用");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "AI 分析失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-w-0 rounded-lg border border-blue-200 bg-blue-50/50 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
          <Sparkles className="size-3.5" aria-hidden="true" />
          AI 报错归因
        </div>
        <Button variant="unstyled"
          type="button"
          className={cn(secondaryActionClass, "min-h-8 px-2.5 py-1.5 text-xs")}
          disabled={loading}
          onClick={() => run(!!result)}
        >
          {loading ? "分析中…" : result ? "重新分析" : "AI 分析原因"}
        </Button>
      </div>
      {aiReady === false && !result ? (
        <p className="mt-2 text-xs text-amber-600">未配置可用 AI 模型，请到「集成管理 → AI 模型」启用后再试。</p>
      ) : null}
      {result && result.generated_by === "ai" ? (
        <div className="mt-3 space-y-2 text-xs leading-5 text-slate-700 [overflow-wrap:anywhere]">
          {result.summary ? <div className="rounded bg-white p-2 font-semibold text-slate-800">{result.summary}</div> : null}
          {result.probable_causes.length ? <AiList title="可能原因" items={result.probable_causes} /> : null}
          {result.impact ? <div><span className="font-semibold text-slate-800">影响面：</span>{result.impact}</div> : null}
          {result.investigation_steps.length ? <AiList title="排查建议" items={result.investigation_steps} /> : null}
          {result.fix_suggestions.length ? <AiList title="修复方向" items={result.fix_suggestions} /> : null}
          <div className="pt-1 text-[11px] text-muted-foreground">
            近 7 天同类 {result.occurrences} 次 · {result.cached ? "缓存结果" : "实时生成"}{result.model ? ` · ${result.model}` : ""} · {result.analyzed_at}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** 按接口聚合统计表：窗口内 调用量/错误数/错误率/平均·最大耗时/最近错误。 */
function EndpointStatsPanel() {
  const [rows, setRows] = useState<any[]>([]);
  const [sort, setSort] = useState<"errors" | "calls" | "latency">("errors");
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    opsCenterApi
      .getEndpointStats({ sort })
      .then((r) => { if (!cancelled) setRows(r.endpoints ?? []); })
      .catch(() => { if (!cancelled) setRows([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [reloadKey, sort]);

  const { page, setPage, totalPages, pagedRows } = usePagedRows(rows, sort, 8);

  return (
    <section className="hz-surface min-w-0 border border-slate-200 p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <PanelTitle icon={Activity} title="按接口调用统计" action="近 24 小时" />
        <SelectControl
          value={sort}
          onValueChange={(v) => setSort(v as "errors" | "calls" | "latency")}
          options={[{ label: "按错误数", value: "errors" }, { label: "按调用量", value: "calls" }, { label: "按最大耗时", value: "latency" }]}
          className="w-full sm:w-40"
          ariaLabel="接口统计排序方式"
        />
      </div>
      <div className="mt-5 overflow-hidden rounded border border-slate-200">
        <Table className="min-w-[900px]">
          <TableCaption className="sr-only">近 24 小时接口调用统计</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>接口</TableHead>
              <TableHead>调用量</TableHead>
              <TableHead>错误数</TableHead>
              <TableHead>错误率</TableHead>
              <TableHead>平均耗时</TableHead>
              <TableHead>最大耗时</TableHead>
              <TableHead>最近错误</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">加载中…</TableCell></TableRow>
            ) : pagedRows.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="p-0 whitespace-normal"><HorizonEmptyState Icon={Activity} title="暂无调用数据" description="当前统计窗口内没有可展示的接口调用。" action={<Button variant="unstyled" type="button" className={secondaryActionClass} onClick={() => setReloadKey((key) => key + 1)}>重新加载</Button>} /></TableCell></TableRow>
            ) : pagedRows.map((row: any) => (
              <TableRow key={`${row.method} ${row.path}`}>
                <TableCell>
                  <div className="font-mono text-xs font-semibold text-slate-800">{row.method} {row.path}</div>
                  <div className="mt-1 text-[11px] text-muted-foreground">{row.service}</div>
                </TableCell>
                <TableCell className="tabular-nums">{row.calls}</TableCell>
                <TableCell className={cn("tabular-nums font-semibold", row.errors > 0 ? "text-rose-600" : "text-slate-500")}>{row.errors}</TableCell>
                <TableCell className={cn("tabular-nums", row.errorRate >= 5 ? "text-rose-600 font-semibold" : "text-slate-600")}>{row.errorRate}%</TableCell>
                <TableCell className="tabular-nums text-slate-600">{row.avgDuration}ms</TableCell>
                <TableCell className={cn("tabular-nums", row.maxDuration > 2000 ? "text-amber-700 font-semibold" : "text-slate-600")}>{row.maxDuration}ms</TableCell>
                <TableCell className="max-w-[220px] truncate text-xs text-slate-500" title={row.lastError ?? undefined}>{row.lastError ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <PaginationControls page={page} total={rows.length} totalPages={totalPages} onPageChange={setPage} />
    </section>
  );
}

function ApiErrorsPage({ data }: { data: OpsCenterSectionData | null }) {
  // 「关联日志」：把错误聚合的接口路径下发给请求记录做关键字过滤，并滚动到该面板
  const [linkedLog, setLinkedLog] = useState<{ keyword: string; ts: number } | null>(null);
  return (
    <div className="space-y-5">
      <EndpointStatsPanel />
      <div id="ops-api-logs-anchor" className="scroll-mt-24">
        <ApiLogsPage data={data} linked={linkedLog} />
      </div>
      <ErrorsPage
        data={data}
        onLinkLogs={(path) => {
          setLinkedLog({ keyword: path, ts: Date.now() });
          document.getElementById("ops-api-logs-anchor")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }}
      />
    </div>
  );
}

function DatabaseMonitoringPage({ data }: { data: OpsCenterSectionData | null }) {
  const [slowKeyword, setSlowKeyword] = useState("");
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
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
        <section className="hz-surface min-w-0 border border-slate-200 p-5">
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

        <section className="hz-surface min-w-0 border border-slate-200 p-5">
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
        <section className="hz-surface min-w-0 border border-slate-200 p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <PanelTitle icon={Clock3} title="慢 SQL 列表" action={`${filteredSlowRows.length} 条`} />
            <div className="relative w-full sm:w-[320px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input type="search" name="slow-query-search" autoComplete="off" spellCheck={false} className={cn(inputClass, "pl-10")} value={slowKeyword} onChange={(event) => setSlowKeyword(event.target.value)} placeholder="搜索来源或 Prisma 操作…" aria-label="搜索慢 SQL" />
            </div>
          </div>
          <div className="mt-5 overflow-hidden rounded border border-slate-200">
            <Table className="min-w-[680px]">
              <TableCaption className="sr-only">慢 SQL 查询列表</TableCaption>
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
                    <TableCell colSpan={4} className="p-0 whitespace-normal">
                      <HorizonEmptyState
                        Icon={Search}
                        title="暂无匹配慢 SQL"
                        description="清除搜索条件后查看全部慢查询。"
                        action={<Button variant="unstyled" type="button" className={secondaryActionClass} onClick={() => setSlowKeyword("")}>清除搜索</Button>}
                      />
                    </TableCell>
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

        <section className="hz-surface min-w-0 border border-slate-200 p-5">
          <PanelTitle icon={AlertTriangle} title="锁等待与连接风险" action="实时采样" />
          <div className="mt-5 space-y-3">
            {lockRows.map((row: any) => (
              <div key={`${row.table}-${row.session}`} className="rounded border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-bold text-slate-950">{row.table}</div>
                    <div className="mt-1 font-mono text-xs text-slate-500">{row.mode} · {row.session}</div>
                  </div>
                  <span className={cn(chipClass, "border-amber-200 bg-amber-50 text-amber-700")}>{row.waiting}</span>
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
  // 「测试连接」= 重新拉取服务端聚合数据并回报该服务最新状态；本地维护一份可更新的行数据
  const [serviceRows, setServiceRows] = useState<any[]>(services);
  const [testingName, setTestingName] = useState<string | null>(null);
  useEffect(() => { setServiceRows(getArray(data, "service_monitors", serviceMonitors)); }, [data]);

  const handleTestConnection = async (name: string) => {
    setTestingName(name);
    try {
      const fresh = await opsCenterApi.getSection("services-tasks");
      const list = getArray<any>(fresh, "service_monitors", []);
      if (list.length) setServiceRows(list);
      const hit = list.find((row: any) => row.name === name);
      if (hit) {
        const rate = hit.successRate && hit.successRate !== "-" ? ` · 成功率 ${hit.successRate}` : "";
        toast.success(`${name} 最新状态：${hit.status}${rate}`);
      } else {
        toast.info(`已重新采样，未获取到「${name}」的最新状态`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `${name} 连接测试失败`);
    } finally {
      setTestingName(null);
    }
  };

  return (
    <div className="space-y-5">
      <section className="hz-surface min-w-0 border border-slate-200 p-5">
        <PanelTitle icon={PlugZap} title="第三方服务监控" action="AI / 邮箱 / 阿里云" />
        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          {serviceRows.map((item: any) => (
            <div key={item.name} className="rounded border border-slate-200 bg-white p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-bold text-slate-950">{item.name}</div>
                  <div className="mt-1 text-xs text-slate-500">{item.provider} · {item.lastChecked}</div>
                </div>
                <span className={cn(chipClass, "shrink-0", statusColors[item.tone])}>{item.status}</span>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-3">
                <MiniMetric label="成功率" value={item.successRate} />
                <MiniMetric label="平均耗时" value={item.latency} />
              </div>
              <Button variant="unstyled"
                type="button"
                className={cn(secondaryActionClass, "mt-4 w-full")}
                disabled={testingName === item.name}
                onClick={() => handleTestConnection(item.name)}
              >
                <RefreshCw className={cn("h-4 w-4", testingName === item.name && "animate-spin")} />
                {testingName === item.name ? "检测中…" : "测试连接"}
              </Button>
            </div>
          ))}
        </div>
      </section>

      <section className="hz-surface min-w-0 border border-slate-200 p-5">
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
              <span className={cn(chipClass, "mt-4", statusColors[item.tone])}>{item.status}</span>
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
  const rules = getArray<any>(data, "alert_rules", []);
  const policies = getArray<any>(data, "log_policies", []);
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
  const settings = getArray<string>(data, "log_settings", []);

  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
        <section className="hz-surface min-w-0 border border-slate-200 p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <PanelTitle icon={BellRing} title="告警规则" action={`${filteredRules.length} 条`} />
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="relative w-full sm:w-[280px]">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input type="search" name="alert-rule-search" autoComplete="off" spellCheck={false} className={cn(inputClass, "pl-10")} value={ruleKeyword} onChange={(event) => setRuleKeyword(event.target.value)} placeholder="搜索规则、条件、渠道…" aria-label="搜索告警规则" />
              </div>
              <SelectControl
                value={ruleLevelFilter}
                onValueChange={setRuleLevelFilter}
                options={["全部", "严重", "警告", "提示"].map((item) => ({ label: item, value: item }))}
                className="w-full sm:w-28"
                ariaLabel="筛选告警级别"
              />
            </div>
          </div>
          <p className="mt-3 text-sm text-slate-600">自动告警尚未接入，以下为规则建议，不会发送通知。</p>
          <div className="mt-5 overflow-hidden rounded border border-slate-200">
            <Table className="min-w-[760px]">
              <TableCaption className="sr-only">告警规则与启停状态</TableCaption>
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
                    <TableCell colSpan={5} className="p-0 whitespace-normal">
                      <HorizonEmptyState
                        Icon={BellRing}
                        title="暂无匹配告警规则"
                        description="清除关键词和级别筛选后查看全部规则。"
                        action={<Button variant="unstyled" type="button" className={secondaryActionClass} onClick={() => { setRuleKeyword(""); setRuleLevelFilter("全部"); }}>清除筛选</Button>}
                      />
                    </TableCell>
                  </TableRow>
                ) : pagedRules.map((row: any) => (
                  <TableRow key={row.name}>
                    <TableCell className="font-semibold text-slate-900">{row.name}</TableCell>
                    <TableCell>{row.condition}</TableCell>
                    <TableCell>{row.channel}</TableCell>
                    <TableCell><span className={cn(chipClass, statusColors[toneForStatus(row.level)])}>{row.level}</span></TableCell>
                    <TableCell>
                      <span className={cn(chipClass, row.enabled ? statusColors.healthy : statusColors.neutral)}>
                        {row.status ?? (row.enabled ? "启用" : "未启用")}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <PaginationControls page={rulePage} total={filteredRules.length} totalPages={ruleTotalPages} onPageChange={setRulePage} />
        </section>

        <section className="hz-surface min-w-0 border border-slate-200 p-5">
          <PanelTitle icon={Settings2} title="日志设置" action="保留与脱敏" />
          <div className="mt-5 space-y-3">
            {settings.map((item: string) => (
              <div key={item} className="rounded border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-700">{item}</div>
            ))}
            <p className="text-sm text-slate-600">此处展示当前日志策略。审计日志按配置自动清理，暂不支持在此修改策略或手动清理。</p>
          </div>
        </section>
      </div>

      <section className="hz-surface min-w-0 border border-slate-200 p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <PanelTitle icon={FileSearch} title="日志保留策略" action={`${filteredPolicies.length} 条`} />
          <div className="relative w-full sm:w-[320px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" name="log-policy-search" autoComplete="off" spellCheck={false} className={cn(inputClass, "pl-10")} value={policyKeyword} onChange={(event) => setPolicyKeyword(event.target.value)} placeholder="搜索日志类型、内容、状态…" aria-label="搜索日志策略" />
          </div>
        </div>
        <div className="mt-5 overflow-hidden rounded border border-slate-200">
          <Table className="min-w-[760px]">
            <TableCaption className="sr-only">日志保留与脱敏策略</TableCaption>
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
                  <TableCell colSpan={5} className="p-0 whitespace-normal">
                    <HorizonEmptyState
                      Icon={FileSearch}
                      title="暂无匹配日志策略"
                      description="清除搜索条件后查看全部保留策略。"
                      action={<Button variant="unstyled" type="button" className={secondaryActionClass} onClick={() => setPolicyKeyword("")}>清除搜索</Button>}
                    />
                  </TableCell>
                </TableRow>
              ) : pagedPolicies.map((row: any) => (
                <TableRow key={row.name}>
                  <TableCell className="font-semibold text-slate-900">{row.name}</TableCell>
                  <TableCell>{row.retention}</TableCell>
                  <TableCell>{row.payload}</TableCell>
                  <TableCell>{row.masking}</TableCell>
                  <TableCell><span className={cn(chipClass, "border-emerald-200 bg-emerald-50 text-emerald-700")}>{row.status}</span></TableCell>
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

const OPS_RANGE_PRESETS: Array<{ label: string; value: string; ms: number }> = [
  { label: "近 1 小时", value: "1h", ms: 3600_000 },
  { label: "近 24 小时", value: "24h", ms: 24 * 3600_000 },
  { label: "近 7 天", value: "7d", ms: 7 * 24 * 3600_000 },
  { label: "近 30 天", value: "30d", ms: 30 * 24 * 3600_000 },
];

function ApiLogsPage({ linked }: { data: OpsCenterSectionData | null; linked?: { keyword: string; ts: number } | null }) {
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState("全部");
  const [methodFilter, setMethodFilter] = useState("全部");
  const [range, setRange] = useState("24h");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [aiReady, setAiReady] = useState<boolean | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [selectedLogId, setSelectedLogId] = useState("");
  const deferredKeyword = useDeferredValue(keyword);

  // 过滤条件变化时回到第 1 页
  useEffect(() => { setPage(1); }, [deferredKeyword, statusFilter, methodFilter, range]);

  // 「关联日志」下发的接口路径 → 填入搜索框触发过滤（带 ts，重复点击同一路径也能重新触发）
  useEffect(() => {
    if (linked?.keyword) setKeyword(linked.keyword);
  }, [linked]);

  // 服务端查询：时间范围 + 状态类 + 方法 + 关键字 + 分页（突破"只看最近 80 条"的限制）。
  useEffect(() => {
    let cancelled = false;
    const preset = OPS_RANGE_PRESETS.find((p) => p.value === range) ?? OPS_RANGE_PRESETS[1];
    const from = new Date(Date.now() - preset.ms).toISOString();
    setLoading(true);
    opsCenterApi
      .getApiErrors({
        from,
        statusClass: statusFilter === "全部" ? "all" : (statusFilter as "2xx" | "4xx" | "5xx"),
        method: methodFilter,
        keyword: deferredKeyword,
        page,
        pageSize: 30,
      })
      .then((res: any) => {
        if (cancelled) return;
        setRows(res.api_logs ?? []);
        setTotal(res.pagination?.total ?? (res.api_logs?.length ?? 0));
        setTotalPages(res.pagination?.totalPages ?? 1);
        setAiReady(Boolean(res.ai_ready));
      })
      .catch(() => {
        if (cancelled) return;
        setRows([]); setTotal(0); setTotalPages(1);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [deferredKeyword, statusFilter, methodFilter, range, page]);

  useEffect(() => {
    if (!rows.length) { setSelectedLogId(""); return; }
    setSelectedLogId((current) => (current && rows.some((r) => r.id === current) ? current : rows[0].id));
  }, [rows]);

  const selected = rows.find((r) => r.id === selectedLogId) ?? rows[0] ?? null;
  const selectedHasError = selected ? selected.status >= 400 || selected.errorName || selected.errorStack : false;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="hz-surface min-w-0 border border-slate-200 p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <PanelTitle icon={Activity} title="请求记录" action={loading ? "加载中…" : `${total} 条`} />
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <div className="relative w-full sm:w-[240px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input type="search" name="api-log-search" autoComplete="off" spellCheck={false} className={cn(inputClass, "pl-10")} value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索接口、错误信息、Request ID…" aria-label="搜索接口请求记录" />
            </div>
            <SelectControl value={range} onValueChange={setRange} options={OPS_RANGE_PRESETS.map((p) => ({ label: p.label, value: p.value }))} className="w-full sm:w-32" ariaLabel="筛选请求时间范围" />
            <SelectControl value={methodFilter} onValueChange={setMethodFilter} options={["全部", "GET", "POST", "PATCH", "PUT", "DELETE"].map((m) => ({ label: m, value: m }))} className="w-full sm:w-28" ariaLabel="筛选请求方法" />
            <SelectControl value={statusFilter} onValueChange={setStatusFilter} options={["全部", "2xx", "4xx", "5xx"].map((m) => ({ label: m, value: m }))} className="w-full sm:w-24" ariaLabel="筛选响应状态" />
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <MiniMetric label="当前结果" value={String(total)} />
          <MiniMetric label="本页错误" value={String(rows.filter((item: any) => item.status >= 400).length)} />
          <MiniMetric label="当前选中" value={selected?.id ?? "-"} />
        </div>

        <div className="mt-5 overflow-hidden rounded border border-slate-200">
          <Table className="min-w-[980px]">
            <TableCaption className="sr-only">接口请求记录</TableCaption>
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
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">加载中…</TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="p-0 whitespace-normal">
                    <HorizonEmptyState
                      Icon={Search}
                      title="暂无匹配接口日志"
                      description="清除查询条件后重新加载请求记录。"
                      action={<Button variant="unstyled" type="button" className={secondaryActionClass} onClick={() => { setKeyword(""); setStatusFilter("全部"); setMethodFilter("全部"); setRange("24h"); }}>清除筛选</Button>}
                    />
                  </TableCell>
                </TableRow>
              ) : rows.map((row) => (
                <TableRow
                  key={row.id}
                  className={cn(
                    "cursor-pointer align-top transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary",
                    selected?.id === row.id && "bg-blue-50/70 ring-1 ring-inset ring-blue-200",
                  )}
                  onClick={() => setSelectedLogId(row.id)}
                  tabIndex={0}
                  aria-selected={selected?.id === row.id}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedLogId(row.id);
                    }
                  }}
                >
                  <TableCell className="whitespace-nowrap text-xs text-slate-500">{row.time}</TableCell>
                  <TableCell>
                    <div className="font-mono text-xs font-semibold text-slate-800">{row.method} {row.path}</div>
                    <div className="mt-1 font-mono text-[11px] text-muted-foreground">{row.id}</div>
                  </TableCell>
                  <TableCell><span className={cn(chipClass, statusColors[toneForCode(row.status)])}>{row.status}</span></TableCell>
                  <TableCell className={cn("font-semibold", row.duration > 2000 ? "text-amber-700" : "text-slate-600")}>{row.duration}ms</TableCell>
                  <TableCell>{row.user}</TableCell>
                  <TableCell className="max-w-[260px] truncate text-slate-600">{row.message}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <PaginationControls page={page} total={total} totalPages={totalPages} onPageChange={setPage} />
      </section>

      <DetailPanel title="接口详情" icon={Eye}>
        {selected ? (
          <>
            <KeyValue label="Request ID" value={selected.id} mono />
            <KeyValue label="接口路径" value={`${selected.method} ${selected.path}`} mono />
            <KeyValue label="状态码" value={String(selected.status)} />
            <KeyValue label="请求耗时" value={`${selected.duration}ms`} />
            <KeyValue label="触发用户" value={selected.user} />
            <KeyValue label="来源 IP" value={selected.ip} />
            <div className={cn("rounded border p-3 text-sm leading-6 [overflow-wrap:anywhere]", selectedHasError ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-emerald-50 text-emerald-800")}>
              <div className="mb-1 text-xs font-semibold opacity-80">{selectedHasError ? "错误信息" : "响应摘要"}</div>
              {selected.message}
            </div>
            {selectedHasError ? <AiAnalysisBlock requestId={selected.id} aiReady={aiReady} /> : null}
            {selected.errorName ? <KeyValue label="错误类型" value={selected.errorName} mono /> : null}
            {selected.errorStack ? (
              <div className="min-w-0 rounded border border-slate-200 bg-slate-950 p-3 text-xs leading-5 text-slate-100">
                <div className="mb-2 font-semibold text-slate-300">错误堆栈</div>
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all font-mono">{selected.errorStack}</pre>
              </div>
            ) : null}
            <div className="grid gap-3">
              <JsonBlock title="请求摘要" value={selected.requestMeta} />
              <JsonBlock title="响应摘要" value={selected.responseMeta} />
            </div>
          </>
        ) : (
          <div className="py-10 text-center text-sm text-muted-foreground">选择左侧一条请求查看详情</div>
        )}
      </DetailPanel>
    </div>
  );
}

const ISSUE_NEXT_STATUS: Record<string, string> = { 待处理: "处理中", 处理中: "已解决", 已解决: "待处理" };

function ErrorsPage({ data, onLinkLogs }: { data: OpsCenterSectionData | null; onLinkLogs?: (path: string) => void }) {
  const [keyword, setKeyword] = useState("");
  const [severityFilter, setSeverityFilter] = useState("全部");
  const [selectedIssueId, setSelectedIssueId] = useState("");
  // 「标记处理」本地状态流转：待处理 → 处理中 → 已解决（后端暂无写端点，仅本页生效）
  const [statusOverrides, setStatusOverrides] = useState<Record<string, string>>({});
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
      <section className="hz-surface min-w-0 border border-slate-200 p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <PanelTitle icon={Siren} title="错误聚合" action={`${filteredRows.length} 条`} />
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative w-full sm:w-[320px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input type="search" name="error-group-search" autoComplete="off" spellCheck={false} className={cn(inputClass, "pl-10")} value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索错误、接口、服务、状态…" aria-label="搜索错误聚合" />
            </div>
            <SelectControl
              value={severityFilter}
              onValueChange={setSeverityFilter}
              options={["全部", "严重", "警告", "提示"].map((item) => ({ label: item, value: item }))}
              className="w-full sm:w-28"
              ariaLabel="筛选错误严重级别"
            />
          </div>
        </div>
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          {pagedRows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 lg:col-span-2">
              <HorizonEmptyState
                Icon={Search}
                title="暂无匹配错误聚合"
                description="清除关键词和严重级别后查看全部错误簇。"
                action={<Button variant="unstyled" type="button" className={secondaryActionClass} onClick={() => { setKeyword(""); setSeverityFilter("全部"); }}>清除筛选</Button>}
              />
            </div>
          ) : pagedRows.map((item: any) => (
            <article
              key={item.id}
              className={cn(
                "rounded-lg border bg-white p-5 transition-colors hover:border-primary/25 hover:bg-accent/30",
                selectedIssue?.id === item.id ? "border-blue-300 bg-blue-50/40 ring-1 ring-blue-200" : "border-slate-200",
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="truncate text-base font-bold text-slate-950">{item.title}</div>
                  <div className="mt-1 text-xs text-slate-500">{item.service} · {item.path}</div>
                </div>
                <span className={cn(chipClass, "shrink-0", statusColors[toneForStatus(item.severity)])}>{item.severity}</span>
              </div>
              <div className="mt-5 grid grid-cols-3 gap-3">
                <MiniMetric label="次数" value={String(item.count)} />
                <MiniMetric label="用户" value={String(item.users)} />
                <MiniMetric label="状态" value={statusOverrides[item.id] ?? item.status} />
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="unstyled"
                  type="button"
                  className={cn(secondaryActionClass, selectedIssue?.id === item.id && "border-primary/25 bg-accent text-primary")}
                  aria-pressed={selectedIssue?.id === item.id}
                  onClick={() => setSelectedIssueId(item.id)}
                >
                  <Eye className="size-4" aria-hidden="true" />
                  查看建议
                </Button>
                <Button variant="unstyled"
                  type="button"
                  className={secondaryActionClass}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedIssueId(item.id);
                    onLinkLogs?.(item.path);
                    toast.success(`已按 ${item.path} 过滤上方请求记录`);
                  }}
                >
                  <FileSearch className="h-4 w-4" />
                  关联日志
                </Button>
                <Button variant="unstyled"
                  type="button"
                  className={secondaryActionClass}
                  onClick={(event) => {
                    event.stopPropagation();
                    const current = statusOverrides[item.id] ?? item.status;
                    const next = ISSUE_NEXT_STATUS[current] ?? "处理中";
                    setStatusOverrides((overrides) => ({ ...overrides, [item.id]: next }));
                    toast.success(`处理状态已更新为「${next}」`);
                  }}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {(statusOverrides[item.id] ?? item.status) === "已解决" ? "重新打开" : "标记处理"}
                </Button>
              </div>
            </article>
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
            <div className="mt-3 break-all rounded bg-white/70 p-2 font-mono text-xs text-rose-700">{selectedIssue.path}</div>
          </div>
        ) : null}
        {selectedIssue?.id ? <AiAnalysisBlock requestId={selectedIssue.id} /> : null}
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
  return (
    <div className="space-y-5">
      <section className="hz-surface min-w-0 border border-slate-200 p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <PanelTitle icon={Bot} title="任务执行记录" action={`${filteredRows.length} 条`} />
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative w-full sm:w-[320px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input type="search" name="task-log-search" autoComplete="off" spellCheck={false} className={cn(inputClass, "pl-10")} value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索模块、动作、执行人、结果…" aria-label="搜索任务执行记录" />
            </div>
            <SelectControl
              value={statusFilter}
              onValueChange={setStatusFilter}
              options={["全部", "成功", "失败", "跳过"].map((item) => ({ label: item, value: item }))}
              className="w-full sm:w-28"
              ariaLabel="筛选任务状态"
            />
          </div>
        </div>
        <div className="mt-5 overflow-hidden rounded border border-slate-200">
          <Table className="min-w-[1040px]">
            <TableCaption className="sr-only">后台任务执行记录</TableCaption>
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
                  <TableCell colSpan={7} className="p-0 whitespace-normal">
                    <HorizonEmptyState Icon={Bot} title="暂无匹配任务日志" description="清除任务关键词和状态筛选后重试。" action={<Button variant="unstyled" type="button" className={secondaryActionClass} onClick={() => { setKeyword(""); setStatusFilter("全部"); }}>清除筛选</Button>} />
                  </TableCell>
                </TableRow>
              ) : pagedRows.map((row: any) => (
                <TableRow key={row.id} className="align-top">
                  <TableCell className="whitespace-nowrap text-xs text-slate-500">{row.time}</TableCell>
                  <TableCell><span className={cn(chipClass, "border-slate-200 bg-slate-100 text-slate-700")}>{row.module}</span></TableCell>
                  <TableCell className="font-semibold text-slate-800">{row.action}</TableCell>
                  <TableCell><span className={cn(chipClass, statusColors[toneForStatus(row.status)])}>{row.status}</span></TableCell>
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
      <section className="hz-surface min-w-0 border border-slate-200 p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <PanelTitle icon={ShieldCheck} title="用户操作审计" action={`${filteredRows.length} 条`} />
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative w-full sm:w-[320px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input type="search" name="audit-log-search" autoComplete="off" spellCheck={false} className={cn(inputClass, "pl-10")} value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索用户、操作、模块、IP…" aria-label="搜索用户操作审计" />
            </div>
            <SelectControl
              value={riskFilter}
              onValueChange={setRiskFilter}
              options={["全部", "高", "中", "低"].map((item) => ({ label: item, value: item }))}
              className="w-full sm:w-28"
              ariaLabel="筛选审计风险级别"
            />
          </div>
        </div>
        <div className="mt-5 overflow-hidden rounded border border-slate-200">
          <Table className="min-w-[1080px]">
            <TableCaption className="sr-only">用户操作审计日志</TableCaption>
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
                  <TableCell colSpan={7} className="p-0 whitespace-normal">
                    <HorizonEmptyState Icon={ShieldCheck} title="暂无匹配审计日志" description="清除用户关键词和风险级别后重试。" action={<Button variant="unstyled" type="button" className={secondaryActionClass} onClick={() => { setKeyword(""); setRiskFilter("全部"); }}>清除筛选</Button>} />
                  </TableCell>
                </TableRow>
              ) : pagedRows.map((row: any) => (
                <TableRow key={row.id} className="align-top">
                  <TableCell className="whitespace-nowrap text-xs text-slate-500">{row.time}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2 font-semibold text-slate-800">
                      <UserRound className="h-4 w-4 text-muted-foreground" />
                      {row.user}
                    </div>
                  </TableCell>
                  <TableCell>{row.action}</TableCell>
                  <TableCell><span className={cn(chipClass, "border-slate-200 bg-slate-100 text-slate-700")}>{row.resource}</span></TableCell>
                  <TableCell><span className={cn(chipClass, row.risk === "高" ? statusColors.danger : statusColors.warning)}>{row.risk}</span></TableCell>
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
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-pretty text-sm leading-6 text-blue-900">
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
      {action ? <span className={cn(chipClass, "shrink-0 border-slate-200 bg-slate-100 text-slate-600")}>{action}</span> : null}
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
    <aside className="hz-surface h-fit min-w-0 border border-slate-200 p-5">
      <PanelTitle icon={icon} title={title} />
      <div className="mt-5 min-w-0 space-y-4">{children}</div>
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
    <div className="min-w-0 rounded border border-slate-200 bg-slate-50 p-3">
      <div className="mb-2 text-xs font-semibold text-slate-500">{title}</div>
      {/* break-all：超长无空格 JSON 字符串的 min-content 会撑开 grid 详情栏，break-words 治不了 */}
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all font-mono text-xs leading-5 text-slate-700">{content}</pre>
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
  // 刷新按钮：+1 触发重新拉取，并通过 SectionContent 的 key 重挂载子面板（其内部请求随之重发）
  const [reloadKey, setReloadKey] = useState(0);
  // 仅手动点刷新时置位：切换分区也会触发拉取，但不应弹「已刷新」提示
  const manualRefreshRef = useRef(false);
  const meta = sectionMeta[section];
  const metrics = useMemo(() => buildSectionMetrics(section, data), [data, section]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    opsCenterApi.getSection(section)
      .then((payload) => {
        if (!cancelled) {
          setData(payload);
          if (manualRefreshRef.current) {
            manualRefreshRef.current = false;
            toast.success("运维数据已刷新");
          }
        }
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
  }, [section, reloadKey]);

  const handleExport = () => {
    if (!data) {
      toast.info("暂无服务端数据可导出");
      return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const blob = new Blob(
      [JSON.stringify({ section, title: sectionMeta[section].title, exported_at: new Date().toISOString(), data }, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `ops-${section}-${stamp}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast.success("已导出当前视图数据（JSON）");
  };

  return (
    <div className="horizon-theme hz-page mx-auto flex min-h-full w-full max-w-[1800px] min-w-0 flex-col gap-4 overflow-x-hidden px-3 py-4 sm:px-4 lg:px-5">
      <HorizonPageHeader
        Icon={meta.icon}
        eyebrow={meta.eyebrow}
        title={meta.title}
        description={meta.description}
        meta={
          <span aria-live="polite">
            {loading ? "正在同步实时运维数据…" : loadError ? "实时数据暂不可用，当前为非实时降级视图" : "实时数据已连接"}
          </span>
        }
        actions={
          <>
            <Button variant="unstyled"
              type="button"
              className={secondaryActionClass}
              disabled={loading}
              onClick={() => {
                manualRefreshRef.current = true;
                setReloadKey((key) => key + 1);
              }}
            >
              <RefreshCw className={cn("size-4", loading && "animate-spin")} aria-hidden="true" />
              {loading ? "刷新中…" : "刷新数据"}
            </Button>
            <Button variant="unstyled" type="button" className={primaryActionClass} onClick={handleExport}>
              <Download className="size-4" aria-hidden="true" />
              导出当前视图
            </Button>
          </>
        }
      />

      <HorizonMetricGrid>
        <HorizonMetric Icon={metrics[0].icon} label={metrics[0].label} value={metrics[0].value} note={metrics[0].note} tone={metrics[0].tone} />
        <HorizonMetric Icon={metrics[1].icon} label={metrics[1].label} value={metrics[1].value} note={metrics[1].note} tone={metrics[1].tone} />
        <HorizonMetric Icon={metrics[2].icon} label={metrics[2].label} value={metrics[2].value} note={metrics[2].note} tone={metrics[2].tone} />
        <HorizonMetric Icon={metrics[3].icon} label={metrics[3].label} value={metrics[3].value} note={metrics[3].note} tone={metrics[3].tone} />
      </HorizonMetricGrid>

      {loadError ? (
        <div className="hz-surface flex flex-col gap-3 border border-amber-200 px-4 py-3 text-sm text-amber-800 sm:flex-row sm:items-center sm:justify-between" role="alert">
          <div className="flex min-w-0 items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 break-words">实时数据加载失败，当前展示示例降级视图（非实时）：{loadError}</span>
          </div>
          <Button variant="unstyled" type="button" className={cn(secondaryActionClass, "shrink-0")} onClick={() => setReloadKey((key) => key + 1)}>
            重新连接
          </Button>
        </div>
      ) : null}

      <div className="min-w-0" aria-busy={loading}>
        {loading && !data ? (
          <div className="grid min-w-0 gap-4 lg:grid-cols-2" role="status" aria-label="正在加载运维数据">
            <div className="hz-surface h-72 animate-pulse border border-slate-200 bg-white" />
            <div className="hz-surface h-72 animate-pulse border border-slate-200 bg-white" />
            <span className="sr-only">正在加载运维数据…</span>
          </div>
        ) : (
          <SectionContent key={`${section}-${reloadKey}`} section={section} data={data} />
        )}
      </div>
    </div>
  );
}
