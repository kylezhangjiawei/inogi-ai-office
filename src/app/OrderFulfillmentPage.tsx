import React, { useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
import {
  AlertTriangle,
  ArrowRight,
  BellRing,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  ClipboardCheck,
  DatabaseZap,
  Download,
  FileSpreadsheet,
  FileText,
  Gauge,
  ListFilter,
  MailCheck,
  PackageCheck,
  PanelsTopLeft,
  ScanLine,
  Search,
  Settings2,
  ShieldCheck,
  UploadCloud,
  Warehouse,
} from "lucide-react";

import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { Progress } from "./components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./components/ui/table";
import { cn } from "./components/ui/utils";

type StatusTone = "success" | "warning" | "info" | "danger" | "neutral";

const statusToneClass: Record<StatusTone, string> = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warning: "border-amber-200 bg-amber-50 text-amber-700",
  info: "border-blue-200 bg-blue-50 text-blue-700",
  danger: "border-rose-200 bg-rose-50 text-rose-700",
  neutral: "border-slate-200 bg-slate-50 text-slate-700",
};

const statusAccentClass: Record<StatusTone, string> = {
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  info: "bg-blue-500",
  danger: "bg-rose-500",
  neutral: "bg-slate-400",
};

const statusIconClass: Record<StatusTone, string> = {
  success: "text-emerald-700",
  warning: "text-amber-700",
  info: "text-blue-700",
  danger: "text-rose-700",
  neutral: "text-slate-700",
};

const moduleTabs = [
  { label: "履约中心", path: "/order-fulfillment", icon: PanelsTopLeft },
  { label: "订单核对", path: "/order-fulfillment/review", icon: ClipboardCheck },
  { label: "出货单生成", path: "/order-fulfillment/shipments", icon: FileSpreadsheet },
  { label: "库存与价格", path: "/order-fulfillment/inventory", icon: Warehouse },
  { label: "模板配置", path: "/order-fulfillment/templates", icon: Settings2 },
  { label: "发货提醒", path: "/order-fulfillment/alerts", icon: BellRing },
];

const focusActions = [
  {
    label: "订单核对",
    path: "/order-fulfillment/review",
    value: "5",
    hint: "待人工确认",
    action: "处理异常项",
    icon: ClipboardCheck,
    tone: "warning" as const,
  },
  {
    label: "出货单生成",
    path: "/order-fulfillment/shipments",
    value: "12",
    hint: "可直接导出",
    action: "生成出货单",
    icon: FileSpreadsheet,
    tone: "success" as const,
  },
  {
    label: "发货提醒",
    path: "/order-fulfillment/alerts",
    value: "3",
    hint: "48h 内",
    action: "查看提醒",
    icon: BellRing,
    tone: "danger" as const,
  },
];

const intakeCommands = [
  { label: "同步", fullLabel: "同步 Gmail", icon: MailCheck, tone: "info" as const },
  { label: "上传", fullLabel: "上传附件", icon: UploadCloud, tone: "success" as const },
  { label: "记录", fullLabel: "导入记录", icon: FileText, tone: "neutral" as const },
];

const processSteps = [
  { label: "接入订货单", path: "/order-fulfillment", state: "今日新增 18 单" },
  { label: "AI 识别", path: "/order-fulfillment/review", state: "94% 平均置信度" },
  { label: "仓库比对", path: "/order-fulfillment/review", state: "5 项待核" },
  { label: "生成出货单", path: "/order-fulfillment/shipments", state: "12 单可导出" },
  { label: "发货提醒", path: "/order-fulfillment/alerts", state: "规则启用" },
];

const priorityOrders = [
  {
    po: "PO-2026-0527",
    customer: "NorthBridge Medical",
    due: "2026-05-29",
    issue: "库存不足 38 件",
    next: "核对替代批次",
    tone: "warning" as const,
  },
  {
    po: "PO-2026-0528",
    customer: "Aster Labs",
    due: "2026-05-30",
    issue: "客户价待确认",
    next: "确认价格规则",
    tone: "danger" as const,
  },
  {
    po: "PO-2026-0530",
    customer: "BrightPath Supply",
    due: "2026-06-03",
    issue: "字段完整",
    next: "生成出货单",
    tone: "success" as const,
  },
];

const orderLines = [
  {
    sku: "INO-CATH-2240",
    name: "导管套件 A 型",
    spec: "2.2mm / 40cm",
    orderQty: 240,
    stockQty: 320,
    price: "$18.50",
    total: "$4,440.00",
    status: "通过",
    tone: "success" as const,
  },
  {
    sku: "INO-VALVE-0512",
    name: "精密阀组件",
    spec: "5mm / 12pcs",
    orderQty: 180,
    stockQty: 142,
    price: "$9.20",
    total: "$1,656.00",
    status: "库存不足",
    tone: "warning" as const,
  },
  {
    sku: "INO-PACK-S",
    name: "无菌包装袋",
    spec: "S / 100pcs",
    orderQty: 60,
    stockQty: 860,
    price: "$3.80",
    total: "$228.00",
    status: "单价待核",
    tone: "danger" as const,
  },
];

const templates = [
  { name: "标准英文出货单", format: "Excel", fields: "36 字段", state: "默认", tone: "success" as const },
  { name: "客户定制版", format: "PDF", fields: "36 字段", state: "已启用", tone: "info" as const },
  { name: "财务归档版", format: "Excel", fields: "28 字段", state: "草稿", tone: "neutral" as const },
];

const inventoryRows = [
  { sku: "INO-CATH-2240", name: "导管套件 A 型", stock: 320, safety: 120, price: "$18.50", state: "充足", tone: "success" as const },
  { sku: "INO-VALVE-0512", name: "精密阀组件", stock: 142, safety: 180, price: "$9.20", state: "低于需求", tone: "warning" as const },
  { sku: "INO-PACK-S", name: "无菌包装袋", stock: 860, safety: 240, price: "$3.80", state: "需核价", tone: "danger" as const },
];

const reminderRows = [
  { customer: "NorthBridge Medical", po: "PO-2026-0527", date: "2026-05-29", channel: "站内信 + 邮件", state: "48h 内", tone: "danger" as const },
  { customer: "Aster Labs", po: "PO-2026-0528", date: "2026-05-30", channel: "站内信", state: "待复核", tone: "warning" as const },
  { customer: "BrightPath Supply", po: "PO-2026-0530", date: "2026-06-03", channel: "邮件", state: "已排程", tone: "success" as const },
];

const fieldMappings = [
  { system: "customerName", target: "Customer", source: "订货单识别", state: "已映射", tone: "success" as const },
  { system: "shipDate", target: "Ship Date", source: "订单字段", state: "已映射", tone: "success" as const },
  { system: "sku", target: "Item Code", source: "仓库主数据", state: "已映射", tone: "success" as const },
  { system: "lineTotal", target: "Amount", source: "系统计算", state: "已映射", tone: "success" as const },
];

const tableToneOptions = [
  { label: "全部状态", value: "all" },
  { label: "正常", value: "success" },
  { label: "关注", value: "warning" },
  { label: "风险", value: "danger" },
  { label: "信息", value: "info" },
  { label: "其他", value: "neutral" },
] as const;

type TableToneFilter = "all" | StatusTone;

function useFulfillmentTable<T extends Record<string, unknown> & { tone?: StatusTone }>(
  rows: T[],
  searchFields: Array<keyof T>,
  defaultPageSize = 5,
) {
  const [query, setQuery] = useState("");
  const [tone, setTone] = useState<TableToneFilter>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesQuery =
        normalizedQuery.length === 0 ||
        searchFields.some((field) => String(row[field] ?? "").toLowerCase().includes(normalizedQuery));
      const matchesTone = tone === "all" || row.tone === tone;
      return matchesQuery && matchesTone;
    });
  }, [pageSize, query, rows, searchFields, tone]);

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pagedRows = filteredRows.slice((safePage - 1) * pageSize, safePage * pageSize);

  const updateQuery = (value: string) => {
    setQuery(value);
    setPage(1);
  };

  const updateTone = (value: TableToneFilter) => {
    setTone(value);
    setPage(1);
  };

  const updatePageSize = (value: number) => {
    setPageSize(value);
    setPage(1);
  };

  return {
    query,
    tone,
    page: safePage,
    pageSize,
    pageCount,
    total: filteredRows.length,
    pagedRows,
    setQuery: updateQuery,
    setTone: updateTone,
    setPage,
    setPageSize: updatePageSize,
  };
}

function ToneBadge({ tone, children }: { tone: StatusTone; children: React.ReactNode }) {
  return (
    <Badge
      variant="outline"
      className={cn("rounded-[4px] px-2.5 py-1 font-semibold shadow-[0_1px_0_rgba(255,255,255,0.78)_inset]", statusToneClass[tone])}
    >
      {children}
    </Badge>
  );
}

function ModuleNav() {
  const { pathname } = useLocation();

  return (
    <nav className="fulfillment-tabs flex min-w-0 flex-wrap gap-1.5" aria-label="订单履约功能导航">
      {moduleTabs.map((item) => {
        const Icon = item.icon;
        const active = pathname === item.path;
        return (
          <Link
            key={item.path}
            to={item.path}
            className={cn(
              "group inline-flex h-8 cursor-pointer items-center gap-2 rounded-[6px] border px-2.5 text-xs font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
              active
                ? "border-slate-900 bg-slate-950 text-white shadow-[0_10px_22px_rgba(15,23,42,0.16)]"
                : "border-slate-200 bg-white/82 text-slate-600 hover:border-slate-300 hover:bg-white hover:text-slate-950",
            )}
          >
            <Icon className={cn("h-4 w-4 transition-transform duration-200", !active && "group-hover:-translate-y-0.5")} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function PageShell({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="fulfillment-shell material-scrollbar h-full overflow-y-auto">
      <div className="min-h-full px-3 py-3 md:px-5">
        <div className="mx-auto max-w-[1440px] space-y-3">
          <header className="fulfillment-hero relative overflow-hidden rounded-[8px] border border-slate-200/80 bg-white px-4 py-3.5">
            <div className="relative z-10 flex min-w-0 flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
              <div className="min-w-0">
                <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                  <CircleDot className="h-3.5 w-3.5 text-primary" />
                  {eyebrow}
                </div>
                <h1 className="mt-2 max-w-4xl text-[1.5rem] font-bold leading-tight text-slate-950 md:text-[1.75rem]">
                  {title}
                </h1>
                <p className="mt-1.5 max-w-3xl text-sm leading-5 text-slate-600">{description}</p>
              </div>
              <div className="min-w-0 xl:max-w-[720px]">
                <ModuleNav />
              </div>
            </div>
          </header>
          {children}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone: StatusTone;
}) {
  return (
    <Card className="rounded-[8px] border-slate-200 bg-white/88 shadow-[0_12px_30px_rgba(15,23,42,0.06)]">
      <CardContent className="p-4">
        <p className="text-sm text-slate-500">{label}</p>
        <div className="mt-2 flex items-end justify-between gap-3">
          <span className="text-3xl font-bold leading-none text-slate-950">{value}</span>
          <ToneBadge tone={tone}>{hint}</ToneBadge>
        </div>
      </CardContent>
    </Card>
  );
}

function SectionCard({
  icon: Icon,
  title,
  action,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="fulfillment-card rounded-[8px] border-slate-200/90 bg-white/92 shadow-[0_16px_38px_rgba(15,23,42,0.055)]">
      <CardHeader className="flex flex-row items-center justify-between gap-3 px-4 pt-4">
        <CardTitle className="flex items-center gap-2 text-base text-slate-950">
          <span className="flex h-8 w-8 items-center justify-center rounded-[6px] border border-slate-200 bg-slate-50">
            <Icon className="h-4 w-4 text-primary" />
          </span>
          {title}
        </CardTitle>
        {action}
      </CardHeader>
      <CardContent className="px-4 pb-4">{children}</CardContent>
    </Card>
  );
}

function RouteButton({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Button asChild size="sm" className="cursor-pointer rounded-full shadow-[0_10px_20px_rgba(30,64,175,0.16)] transition-transform duration-200 hover:-translate-y-0.5">
      <Link to={to}>
        {children}
        <ArrowRight className="h-4 w-4" />
      </Link>
    </Button>
  );
}

function OrderIntakePanel() {
  return (
    <div className="fulfillment-action grid h-[72px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-[8px] border border-slate-200/90 bg-white/92 px-3.5 py-2.5 shadow-[0_10px_24px_rgba(15,23,42,0.045)]">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] border border-blue-200 bg-blue-50 text-blue-700">
        <MailCheck className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <div className="truncate text-sm font-semibold text-slate-900">订货单接入</div>
          <span className="shrink-0 rounded-[4px] bg-blue-50 px-1.5 py-0.5 text-xs font-bold text-blue-700">18</span>
        </div>
        <div className="mt-1 truncate text-xs text-slate-500">同步、上传、记录</div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {intakeCommands.map((command) => {
          const Icon = command.icon;
          return (
            <Button
              key={command.fullLabel}
              type="button"
              variant="outline"
              size="sm"
              aria-label={command.fullLabel}
              title={command.fullLabel}
              className="h-8 cursor-pointer rounded-[6px] border-slate-200 bg-white px-2 text-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/25 hover:bg-primary-container/40"
            >
              <Icon className={cn("h-4 w-4", statusIconClass[command.tone])} />
              {command.label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

function TableToolbar({
  query,
  onQueryChange,
  tone,
  onToneChange,
  pageSize,
  onPageSizeChange,
  total,
  placeholder,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  tone: TableToneFilter;
  onToneChange: (value: TableToneFilter) => void;
  pageSize: number;
  onPageSizeChange: (value: number) => void;
  total: number;
  placeholder: string;
}) {
  return (
    <div className="mb-3 flex flex-col gap-2 rounded-[7px] border border-slate-200 bg-slate-50/70 p-2.5 lg:flex-row lg:items-center lg:justify-between">
      <label className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={placeholder}
          className="h-9 w-full rounded-[6px] border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-800 outline-none transition-all duration-200 placeholder:text-slate-400 focus:border-primary/45 focus:ring-4 focus:ring-primary/10"
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex h-9 items-center gap-2 rounded-[6px] border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600">
          <ListFilter className="h-4 w-4 text-slate-400" />
          <select
            value={tone}
            onChange={(event) => onToneChange(event.target.value as TableToneFilter)}
            className="cursor-pointer bg-transparent text-xs font-semibold text-slate-700 outline-none"
          >
            {tableToneOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-flex h-9 items-center gap-2 rounded-[6px] border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600">
          每页
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            className="cursor-pointer bg-transparent text-xs font-semibold text-slate-700 outline-none"
          >
            {[3, 5, 10].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <span className="text-xs font-medium text-slate-500">共 {total} 条</span>
      </div>
    </div>
  );
}

function TablePager({
  page,
  pageCount,
  onPageChange,
}: {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
      <span className="text-xs font-medium text-slate-500">
        第 {page} / {pageCount} 页
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-8 cursor-pointer rounded-[6px]"
          disabled={page <= 1}
          onClick={() => onPageChange(Math.max(1, page - 1))}
        >
          <ChevronLeft className="h-4 w-4" />
          上一页
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 cursor-pointer rounded-[6px]"
          disabled={page >= pageCount}
          onClick={() => onPageChange(Math.min(pageCount, page + 1))}
        >
          下一页
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export function OrderFulfillmentPage() {
  const priorityTable = useFulfillmentTable(priorityOrders, ["po", "customer", "due", "issue", "next"], 5);

  return (
    <PageShell
      eyebrow="订单履约"
      title="订单履约工作台"
      description="接入动作留在工作台内完成，独立页面聚焦核对、出货、库存、模板和提醒。"
    >
      <section className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-3">
        <OrderIntakePanel />
        {focusActions.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.path}
              to={item.path}
              className="fulfillment-action group grid h-[72px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-[8px] border border-slate-200/90 bg-white/92 px-3.5 py-2.5 shadow-[0_10px_24px_rgba(15,23,42,0.045)] transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/25 hover:bg-white hover:shadow-[0_18px_34px_rgba(30,64,175,0.10)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] border transition-transform duration-200 group-hover:-rotate-2 group-hover:scale-105", statusToneClass[item.tone])}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-900">{item.label}</div>
                <div className="mt-1 truncate text-xs text-slate-500">{item.action}</div>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-2xl font-bold leading-none text-slate-950">{item.value}</span>
                <ChevronRight className="h-4 w-4 text-slate-400 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-primary" />
              </div>
            </Link>
          );
        })}
      </section>

      <section className="grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_330px]">
        <div className="space-y-3">
          <SectionCard
            icon={AlertTriangle}
            title="优先处理队列"
            action={<RouteButton to="/order-fulfillment/review">进入核对</RouteButton>}
          >
            <TableToolbar
              query={priorityTable.query}
              onQueryChange={priorityTable.setQuery}
              tone={priorityTable.tone}
              onToneChange={priorityTable.setTone}
              pageSize={priorityTable.pageSize}
              onPageSizeChange={priorityTable.setPageSize}
              total={priorityTable.total}
              placeholder="搜索 PO、客户、问题或下一步"
            />
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/85">
                  <TableHead>PO</TableHead>
                  <TableHead>客户</TableHead>
                  <TableHead>发货日期</TableHead>
                  <TableHead>问题</TableHead>
                  <TableHead>下一步</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {priorityTable.pagedRows.map((order) => (
                  <TableRow key={order.po} className="group">
                    <TableCell className="font-semibold text-slate-950">{order.po}</TableCell>
                    <TableCell>{order.customer}</TableCell>
                    <TableCell>{order.due}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className={cn("h-2 w-2 rounded-full", statusAccentClass[order.tone])} />
                        <ToneBadge tone={order.tone}>{order.issue}</ToneBadge>
                      </div>
                    </TableCell>
                    <TableCell className="font-medium text-primary transition-transform duration-200 group-hover:translate-x-0.5">{order.next}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <TablePager page={priorityTable.page} pageCount={priorityTable.pageCount} onPageChange={priorityTable.setPage} />
          </SectionCard>

          <SectionCard icon={ClipboardCheck} title="今日处理策略">
            <div className="grid gap-3 md:grid-cols-3">
              {[
                { label: "先核对高风险", desc: "库存不足与客户价待确认优先处理", tone: "warning" as const },
                { label: "再批量导出", desc: "字段完整订单直接进入出货单生成", tone: "success" as const },
                { label: "最后检查提醒", desc: "48h 内发货单确认提醒状态", tone: "info" as const },
              ].map((item) => (
                <div key={item.label} className="fulfillment-mini-card rounded-[6px] border border-slate-200 bg-slate-50/70 p-3 transition-all duration-200 hover:border-primary/20 hover:bg-white hover:shadow-[0_10px_22px_rgba(15,23,42,0.055)]">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-slate-900">{item.label}</div>
                    <ToneBadge tone={item.tone}>今日</ToneBadge>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-slate-500">{item.desc}</p>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>

        <div className="space-y-3">
          <SectionCard icon={Gauge} title="流程状态">
            <div className="mb-4 rounded-[7px] border border-slate-200 bg-slate-50/80 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900">自动化完成度</div>
                  <div className="mt-1 text-xs text-slate-500">已覆盖导入、识别、比对和提醒链路</div>
                </div>
                <span className="text-xl font-bold leading-none text-slate-950">86%</span>
              </div>
              <Progress value={86} className="mt-3 h-2 bg-slate-100 [&_[data-slot=progress-indicator]]:bg-primary [&_[data-slot=progress-indicator]]:transition-all [&_[data-slot=progress-indicator]]:duration-700" />
            </div>
            <div className="fulfillment-flow space-y-2">
              {processSteps.map((step, index) => (
                <Link key={`${step.label}-${index}`} to={step.path} className="fulfillment-step group relative flex items-center gap-3 rounded-[6px] border border-slate-200 bg-slate-50/70 px-3 py-2 transition-all duration-200 hover:border-primary/25 hover:bg-white hover:shadow-[0_10px_22px_rgba(30,64,175,0.08)]">
                  <div className="fulfillment-step-dot flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
                    {index + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-slate-900">{step.label}</div>
                    <div className="mt-0.5 truncate text-xs text-slate-500">{step.state}</div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-400 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-primary" />
                </Link>
              ))}
            </div>
          </SectionCard>
        </div>
      </section>
    </PageShell>
  );
}

export function OrderIntakePage() {
  return (
    <PageShell
      eyebrow="Order Intake"
      title="从 Gmail 和附件池获取订货单"
      description="配置邮件抓取规则、人工上传入口和重复识别策略，让订单来源先变成可追踪的结构化队列。"
    >
      <section className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <SectionCard icon={MailCheck} title="Gmail 同步规则" action={<Button size="sm" className="cursor-pointer rounded-full">连接 Gmail</Button>}>
          <div className="grid gap-3 md:grid-cols-3">
            {[
              ["扫描频率", "每 15 分钟"],
              ["邮件条件", "from + attachment"],
              ["重复拦截", "Message-ID"],
            ].map(([label, value]) => (
              <div key={label} className="fulfillment-mini-card rounded-[6px] border border-slate-200 bg-slate-50 p-4 transition-all duration-200 hover:border-primary/20 hover:bg-white hover:shadow-[0_10px_22px_rgba(15,23,42,0.055)]">
                <div className="text-xs text-slate-500">{label}</div>
                <div className="mt-2 text-sm font-semibold text-slate-950">{value}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-[6px] border border-blue-100 bg-blue-50 p-4 text-sm text-slate-700 shadow-[0_1px_0_rgba(255,255,255,0.8)_inset]">
            当前规则会抓取客户邮件中的 PDF、Excel、Word 和图片附件，识别完成后进入“订单核对”。
          </div>
        </SectionCard>

        <SectionCard icon={UploadCloud} title="附件上传队列" action={<Button variant="outline" size="sm" className="cursor-pointer rounded-full">上传附件</Button>}>
          <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
            <div className="group flex min-h-[190px] cursor-pointer flex-col items-center justify-center rounded-[8px] border border-dashed border-slate-300 bg-slate-50 text-center transition-all duration-200 hover:border-primary/40 hover:bg-white hover:shadow-[0_14px_28px_rgba(30,64,175,0.08)]">
              <UploadCloud className="h-9 w-9 text-slate-400 transition-transform duration-200 group-hover:-translate-y-1 group-hover:text-primary" />
              <div className="mt-3 text-sm font-semibold text-slate-900">拖入订货单附件</div>
              <p className="mt-1 text-xs text-slate-500">PDF / Excel / Word / 图片</p>
            </div>
            <div className="space-y-3">
              {["NBM_PO_0527.pdf", "Aster_Order_1882.xlsx", "邮件正文截图.png"].map((file, index) => (
                <div key={file} className="fulfillment-mini-card flex items-center justify-between gap-3 rounded-[6px] border border-slate-200 bg-white p-3 transition-all duration-200 hover:border-primary/20 hover:shadow-[0_10px_22px_rgba(15,23,42,0.055)]">
                  <div className="flex min-w-0 items-center gap-3">
                    <FileText className="h-4 w-4 text-primary" />
                    <span className="truncate text-sm font-medium text-slate-800">{file}</span>
                  </div>
                  <ToneBadge tone={index === 0 ? "info" : "neutral"}>{index === 0 ? "识别中" : "待解析"}</ToneBadge>
                </div>
              ))}
            </div>
          </div>
        </SectionCard>
      </section>
    </PageShell>
  );
}

export function OrderReviewPage() {
  const orderLineTable = useFulfillmentTable(orderLines, ["sku", "name", "spec", "status", "price"], 5);

  return (
    <PageShell
      eyebrow="AI Review"
      title="核对订单字段、库存、单价和总价"
      description="将 AI 识别结果与仓库主数据放在同一张表里，异常项先处理，正常项直接进入出货单生成。"
    >
      <section className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <SectionCard icon={ScanLine} title="订单识别与仓库比对" action={<ToneBadge tone="warning">2 项需确认</ToneBadge>}>
          <div className="mb-4 grid gap-3 md:grid-cols-4">
            {[
              ["客户", "NorthBridge Medical"],
              ["PO 编号", "PO-2026-0527"],
              ["发货日期", "2026-05-29"],
              ["识别置信度", "94%"],
            ].map(([label, value]) => (
              <div key={label} className="fulfillment-mini-card rounded-[6px] border border-slate-200 bg-slate-50 p-3 transition-all duration-200 hover:border-primary/20 hover:bg-white hover:shadow-[0_10px_22px_rgba(15,23,42,0.055)]">
                <div className="text-xs text-slate-500">{label}</div>
                <div className="mt-1 truncate text-sm font-semibold text-slate-950">{value}</div>
              </div>
            ))}
          </div>
          <TableToolbar
            query={orderLineTable.query}
            onQueryChange={orderLineTable.setQuery}
            tone={orderLineTable.tone}
            onToneChange={orderLineTable.setTone}
            pageSize={orderLineTable.pageSize}
            onPageSizeChange={orderLineTable.setPageSize}
            total={orderLineTable.total}
            placeholder="搜索 SKU、品名、规格或状态"
          />
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/85">
                <TableHead>SKU</TableHead>
                <TableHead>品名</TableHead>
                <TableHead>规格</TableHead>
                <TableHead className="text-right">订单数</TableHead>
                <TableHead className="text-right">库存</TableHead>
                <TableHead className="text-right">单价</TableHead>
                <TableHead>状态</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orderLineTable.pagedRows.map((line) => (
                <TableRow key={line.sku} className="group">
                  <TableCell className="font-semibold text-slate-950">{line.sku}</TableCell>
                  <TableCell>{line.name}</TableCell>
                  <TableCell>{line.spec}</TableCell>
                  <TableCell className="text-right font-semibold">{line.orderQty}</TableCell>
                  <TableCell className="text-right">{line.stockQty}</TableCell>
                  <TableCell className="text-right">{line.price}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className={cn("h-2 w-2 rounded-full", statusAccentClass[line.tone])} />
                      <ToneBadge tone={line.tone}>{line.status}</ToneBadge>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <TablePager page={orderLineTable.page} pageCount={orderLineTable.pageCount} onPageChange={orderLineTable.setPage} />
        </SectionCard>

        <SectionCard icon={ShieldCheck} title="校验规则">
          <div className="space-y-3">
            {[
              ["SKU 精确匹配", "通过"],
              ["规格差异检测", "通过"],
              ["库存安全线", "1 项异常"],
              ["客户价规则", "1 项待确认"],
              ["总价重算", "通过"],
            ].map(([label, state]) => (
              <div key={label} className="fulfillment-mini-card flex items-center justify-between gap-3 rounded-[6px] border border-slate-200 bg-white p-3 transition-all duration-200 hover:border-primary/20 hover:shadow-[0_10px_22px_rgba(15,23,42,0.055)]">
                <span className="text-sm font-medium text-slate-800">{label}</span>
                <ToneBadge tone={state === "通过" ? "success" : "warning"}>{state}</ToneBadge>
              </div>
            ))}
          </div>
          <Button className="mt-4 w-full cursor-pointer rounded-full shadow-[0_12px_24px_rgba(30,64,175,0.16)] transition-transform duration-200 hover:-translate-y-0.5">确认并生成出货单</Button>
        </SectionCard>
      </section>
    </PageShell>
  );
}

export function ShipmentGenerationPage() {
  return (
    <PageShell
      eyebrow="Shipping Note"
      title="按模板生成并导出出货单"
      description="同一份订单数据可以写入不同模板，适配客户版本、财务归档版本和标准英文出货单。"
    >
      <section className="grid gap-5 xl:grid-cols-[0.86fr_1.14fr]">
        <SectionCard icon={PackageCheck} title="可生成队列" action={<Button size="sm" className="cursor-pointer rounded-full">批量生成</Button>}>
          <div className="space-y-3">
            {priorityOrders.map((order) => (
              <div key={order.po} className="fulfillment-mini-card flex items-center justify-between gap-4 rounded-[6px] border border-slate-200 bg-white p-4 transition-all duration-200 hover:border-primary/20 hover:shadow-[0_10px_22px_rgba(15,23,42,0.055)]">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-950">{order.po}</div>
                  <div className="mt-1 truncate text-xs text-slate-500">{order.customer} · 预计发货 {order.due}</div>
                </div>
                <ToneBadge tone={order.tone}>{order.next}</ToneBadge>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard icon={FileSpreadsheet} title="出货单预览" action={<Button variant="outline" size="sm" className="cursor-pointer rounded-full"><Download className="h-4 w-4" />导出</Button>}>
          <div className="fulfillment-document rounded-[8px] border border-slate-200 bg-[linear-gradient(180deg,#ffffff,#f8fbff)] p-5 shadow-[0_16px_34px_rgba(15,23,42,0.06)]">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="text-xl font-bold text-slate-950">Shipping Note</div>
                <div className="mt-1 text-xs text-slate-500">SN-2026-0527-018 · 标准英文出货单</div>
              </div>
              <ToneBadge tone="success">字段完整</ToneBadge>
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              <div className="rounded-[6px] border border-slate-200/70 bg-slate-50 p-3">
                <div className="text-xs text-slate-500">Customer</div>
                <div className="mt-1 font-semibold text-slate-950">NorthBridge Medical</div>
              </div>
              <div className="rounded-[6px] border border-slate-200/70 bg-slate-50 p-3">
                <div className="text-xs text-slate-500">Ship Date</div>
                <div className="mt-1 font-semibold text-slate-950">2026-05-29</div>
              </div>
            </div>
            <div className="mt-4 divide-y divide-slate-100">
              {orderLines.map((line) => (
                <div key={line.sku} className="grid grid-cols-[1fr_auto] gap-3 py-3 transition-colors duration-200 hover:bg-slate-50/75">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-900">{line.name}</div>
                    <div className="mt-1 text-xs text-slate-500">{line.sku} · {line.spec}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold text-slate-950">{line.orderQty}</div>
                    <div className="mt-1 text-xs text-slate-500">{line.total}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </SectionCard>
      </section>
    </PageShell>
  );
}

export function InventoryPricingPage() {
  const inventoryTable = useFulfillmentTable(inventoryRows, ["sku", "name", "state", "price"], 5);

  return (
    <PageShell
      eyebrow="Inventory & Pricing"
      title="维护库存、规格和客户价格规则"
      description="库存和价格作为后续校验的主数据，支持安全库存、客户价、规格别名和异常拦截策略配置。"
    >
      <section className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <SectionCard icon={Warehouse} title="库存与价格主数据" action={<Button size="sm" className="cursor-pointer rounded-full">导入库存表</Button>}>
          <TableToolbar
            query={inventoryTable.query}
            onQueryChange={inventoryTable.setQuery}
            tone={inventoryTable.tone}
            onToneChange={inventoryTable.setTone}
            pageSize={inventoryTable.pageSize}
            onPageSizeChange={inventoryTable.setPageSize}
            total={inventoryTable.total}
            placeholder="搜索 SKU、品名、价格或状态"
          />
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/85">
                <TableHead>SKU</TableHead>
                <TableHead>品名</TableHead>
                <TableHead className="text-right">当前库存</TableHead>
                <TableHead className="text-right">安全库存</TableHead>
                <TableHead className="text-right">客户价</TableHead>
                <TableHead>状态</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {inventoryTable.pagedRows.map((row) => (
                <TableRow key={row.sku} className="group">
                  <TableCell className="font-semibold text-slate-950">{row.sku}</TableCell>
                  <TableCell>{row.name}</TableCell>
                  <TableCell className="text-right">{row.stock}</TableCell>
                  <TableCell className="text-right">{row.safety}</TableCell>
                  <TableCell className="text-right">{row.price}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className={cn("h-2 w-2 rounded-full", statusAccentClass[row.tone])} />
                      <ToneBadge tone={row.tone}>{row.state}</ToneBadge>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <TablePager page={inventoryTable.page} pageCount={inventoryTable.pageCount} onPageChange={inventoryTable.setPage} />
        </SectionCard>

        <div className="space-y-3">
          <SectionCard icon={DatabaseZap} title="配置缺口">
            <div className="space-y-3">
              {[
                { label: "库存主数据", value: "1 个 SKU 低于安全库存", tone: "warning" as const },
                { label: "客户价格规则", value: "Aster Labs 客户价待确认", tone: "danger" as const },
              ].map((item) => (
                <div key={item.label} className="fulfillment-mini-card rounded-[6px] border border-slate-200 bg-white p-3 transition-all duration-200 hover:border-primary/20 hover:shadow-[0_10px_22px_rgba(15,23,42,0.055)]">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-slate-900">{item.label}</div>
                    <ToneBadge tone={item.tone}>待处理</ToneBadge>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">{item.value}</div>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard icon={Settings2} title="校验策略">
            <div className="space-y-3">
              {[
                ["安全库存阈值", "低于阈值需确认"],
                ["客户价优先级", "客户专属价 > 标准价"],
                ["规格别名", "6 组别名启用"],
                ["总价重算", "数量 x 单价自动校验"],
              ].map(([label, value]) => (
                <div key={label} className="fulfillment-mini-card rounded-[6px] border border-slate-200 bg-white p-3 transition-all duration-200 hover:border-primary/20 hover:shadow-[0_10px_22px_rgba(15,23,42,0.055)]">
                  <div className="text-sm font-semibold text-slate-900">{label}</div>
                  <div className="mt-1 text-xs text-slate-500">{value}</div>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
      </section>
    </PageShell>
  );
}

export function TemplateConfigurationPage() {
  const mappingTable = useFulfillmentTable(fieldMappings, ["system", "target", "source", "state"], 5);

  return (
    <PageShell
      eyebrow="Template Mapping"
      title="配置出货单模板和字段映射"
      description="模板外观可以切换，但核心字段保持一致。字段映射决定订单数据如何写入 Excel、PDF 或客户定制模板。"
    >
      <section className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
        <SectionCard icon={PanelsTopLeft} title="模板库" action={<Button size="sm" className="cursor-pointer rounded-full">新增模板</Button>}>
          <div className="space-y-3">
            {templates.map((template) => (
              <div key={template.name} className="fulfillment-mini-card rounded-[6px] border border-slate-200 bg-white p-4 transition-all duration-200 hover:border-primary/20 hover:shadow-[0_10px_22px_rgba(15,23,42,0.055)]">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-semibold text-slate-950">{template.name}</div>
                  <ToneBadge tone={template.tone}>{template.state}</ToneBadge>
                </div>
                <div className="mt-3 flex gap-2">
                  <Badge variant="secondary" className="rounded-[4px]">{template.format}</Badge>
                  <Badge variant="outline" className="rounded-[4px]">{template.fields}</Badge>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        <div className="space-y-3">
          <SectionCard icon={ClipboardCheck} title="字段映射">
            <TableToolbar
              query={mappingTable.query}
              onQueryChange={mappingTable.setQuery}
              tone={mappingTable.tone}
              onToneChange={mappingTable.setTone}
              pageSize={mappingTable.pageSize}
              onPageSizeChange={mappingTable.setPageSize}
              total={mappingTable.total}
              placeholder="搜索系统字段、模板字段或来源"
            />
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/85">
                  <TableHead>系统字段</TableHead>
                  <TableHead>模板字段</TableHead>
                  <TableHead>来源</TableHead>
                  <TableHead>状态</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mappingTable.pagedRows.map(({ system, target, source, state, tone }) => (
                  <TableRow key={system} className="group">
                    <TableCell className="font-semibold text-slate-950">{system}</TableCell>
                    <TableCell>{target}</TableCell>
                    <TableCell>{source}</TableCell>
                    <TableCell><ToneBadge tone={tone}>{state}</ToneBadge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <TablePager page={mappingTable.page} pageCount={mappingTable.pageCount} onPageChange={mappingTable.setPage} />
          </SectionCard>

          <SectionCard icon={DatabaseZap} title="配置缺口">
            <div className="grid gap-3 md:grid-cols-2">
              {[
                { label: "模板字段映射", value: "3 套模板字段保持一致", tone: "success" as const },
                { label: "客户定制版", value: "待确认页脚签章位置", tone: "warning" as const },
              ].map((item) => (
                <div key={item.label} className="fulfillment-mini-card rounded-[6px] border border-slate-200 bg-white p-3 transition-all duration-200 hover:border-primary/20 hover:shadow-[0_10px_22px_rgba(15,23,42,0.055)]">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-slate-900">{item.label}</div>
                    <ToneBadge tone={item.tone}>{item.tone === "success" ? "正常" : "待确认"}</ToneBadge>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">{item.value}</div>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
      </section>
    </PageShell>
  );
}

export function ShippingAlertsPage() {
  const reminderTable = useFulfillmentTable(reminderRows, ["customer", "po", "date", "channel", "state"], 5);

  return (
    <PageShell
      eyebrow="Shipping Alerts"
      title="临近发货日期自动提醒"
      description="按发货日期、订单风险和库存状态生成提醒，可扩展站内信、邮件和企业协同工具通知。"
    >
      <section className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <SectionCard icon={BellRing} title="提醒队列" action={<Button size="sm" className="cursor-pointer rounded-full">新增规则</Button>}>
          <TableToolbar
            query={reminderTable.query}
            onQueryChange={reminderTable.setQuery}
            tone={reminderTable.tone}
            onToneChange={reminderTable.setTone}
            pageSize={reminderTable.pageSize}
            onPageSizeChange={reminderTable.setPageSize}
            total={reminderTable.total}
            placeholder="搜索客户、PO、日期或通知方式"
          />
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/85">
                <TableHead>客户</TableHead>
                <TableHead>PO</TableHead>
                <TableHead>发货日期</TableHead>
                <TableHead>通知方式</TableHead>
                <TableHead>状态</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reminderTable.pagedRows.map((row) => (
                <TableRow key={row.po} className="group">
                  <TableCell className="font-semibold text-slate-950">{row.customer}</TableCell>
                  <TableCell>{row.po}</TableCell>
                  <TableCell>{row.date}</TableCell>
                  <TableCell>{row.channel}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className={cn("h-2 w-2 rounded-full", statusAccentClass[row.tone])} />
                      <ToneBadge tone={row.tone}>{row.state}</ToneBadge>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <TablePager page={reminderTable.page} pageCount={reminderTable.pageCount} onPageChange={reminderTable.setPage} />
        </SectionCard>

        <SectionCard icon={CalendarClock} title="提醒策略">
          <div className="space-y-3">
            {[
              ["提前 7 天", "检查库存和模板"],
              ["提前 3 天", "确认客户价和数量"],
              ["提前 1 天", "催办未导出的出货单"],
              ["逾期", "升级给管理员"],
            ].map(([time, rule]) => (
              <div key={time} className="fulfillment-mini-card flex items-start gap-3 rounded-[6px] border border-slate-200 bg-white p-3 transition-all duration-200 hover:border-primary/20 hover:shadow-[0_10px_22px_rgba(15,23,42,0.055)]">
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary" />
                <div>
                  <div className="text-sm font-semibold text-slate-900">{time}</div>
                  <div className="mt-1 text-xs text-slate-500">{rule}</div>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </section>
    </PageShell>
  );
}
