import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertCircle,
  Boxes,
  ClipboardCheck,
  DatabaseZap,
  RefreshCw,
  Warehouse,
} from "lucide-react";

import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { cn } from "../components/ui/utils";
import { usePermission } from "../hooks/usePermission";
import { i18nLocale, useI18n } from "../lib/i18n";
import {
  getInventoryQualityOverview,
  getInventoryShipmentOverview,
  type InventoryQualityOverview,
  type InventoryShipmentOverview,
} from "../lib/inventoryCenterOverviewApi";
import { buildInventoryReadinessPath, parseInventoryReadinessViewState } from "../lib/inventoryReadinessNavigation";
import { getInventoryReadiness, type InventoryReadinessResponse } from "../lib/procurementApi";
import { routePath, subRoutePath } from "../lib/routePaths";
import { isProcurementTaskOverdue, useProcurementData } from "./data";
import { InventoryMonthlyReadiness } from "./InventoryMonthlyReadiness";

type LoadState = "idle" | "loading" | "ready" | "unavailable" | "error";

const chartTooltipStyle = { border: "1px solid var(--border)", borderRadius: 8, background: "var(--card)", color: "var(--foreground)", fontSize: 12 };
const chartAxis = { fontSize: 11, fill: "var(--muted-foreground)" };

function quantity(value: number, maximumFractionDigits = 0) {
  return new Intl.NumberFormat(i18nLocale(), { maximumFractionDigits }).format(value);
}

function percent(value: number) {
  return new Intl.NumberFormat(i18nLocale(), { style: "percent", maximumFractionDigits: 0 }).format(value);
}

function nonNegative(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function syncDate(value?: string | null) {
  const timestamp = value ? Date.parse(value) : NaN;
  return Number.isFinite(timestamp)
    ? new Intl.DateTimeFormat(i18nLocale(), { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(timestamp)
    : null;
}

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function safeMonth(value: string | null) {
  return value && /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : currentMonth();
}

function ShipmentStat({ label, value, unit = "台" }: { label: string; value: number | null; unit?: string }) {
  const { t } = useI18n();
  return (
    <div className="min-w-0 px-2 py-1.5 text-center sm:px-4">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-lg font-bold tracking-tight text-foreground tabular-nums sm:text-xl">
        {value === null ? t("待核对") : quantity(value)}{value === null ? null : <span className="ml-1 text-xs font-semibold text-muted-foreground">{t(unit)}</span>}
      </dd>
    </div>
  );
}

type RiskItem = {
  key: "current-gap" | "overdue" | "warning-materials" | "todo";
  label: string;
  value: number | null;
  unit: string;
  tone: "danger" | "warning";
  emptyText?: string;
};

function RiskMetric({ item, primary = false }: { item: RiskItem; primary?: boolean }) {
  const { t } = useI18n();
  const active = item.value !== null && item.value > 0;
  const tone = active ? item.tone : "default";
  return (
    <div
      data-risk-key={item.key}
      data-primary-risk={primary ? item.key : undefined}
      className={cn(
        "min-w-0",
        primary
          ? "rounded-lg border border-l-4 p-4"
          : "border-l-2 pl-3",
        tone === "danger"
          ? primary
            ? "border-rose-300 bg-rose-50/80 dark:border-rose-800 dark:bg-rose-950/30"
            : "border-rose-300 dark:border-rose-800"
          : tone === "warning"
            ? primary
              ? "border-amber-300 bg-amber-50/80 dark:border-amber-800 dark:bg-amber-950/30"
              : "border-amber-300 dark:border-amber-800"
            : primary
              ? "border-border bg-muted/35"
              : "border-border",
      )}
    >
      <dt className="text-xs font-medium text-muted-foreground">
        {primary ? (
          <span className="mb-2 flex items-center gap-2">
            <span className="font-semibold text-foreground">{t("首要风险")}</span>
            <span className={cn(
              "rounded-full px-2 py-0.5 text-[11px] font-bold",
              item.tone === "danger"
                ? "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300"
                : "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
            )}>
              {t(item.tone === "danger" ? "需处理" : "需关注")}
            </span>
          </span>
        ) : null}
        {item.label}
      </dt>
      <dd className={cn(
        "mt-1 font-mono font-bold tracking-tight tabular-nums",
        primary ? "text-3xl" : "text-xl",
        tone === "danger" ? "text-rose-700 dark:text-rose-300" : tone === "warning" ? "text-amber-700 dark:text-amber-300" : "text-foreground",
      )}>
        {item.value === null ? item.emptyText ?? t("待核对") : quantity(item.value)}
        {item.value === null ? null : <span className="ml-1 text-xs font-semibold">{item.unit}</span>}
      </dd>
    </div>
  );
}

function RiskOverview({
  currentGap,
  warningMaterials,
  overdue,
  todo,
  taskState,
  taskScope,
  className,
}: {
  currentGap: number | null;
  warningMaterials: number | null;
  overdue: number | null;
  todo: number | null;
  taskState: "known" | "pending" | "unavailable" | "error";
  taskScope: "authorized" | "personal" | "unavailable";
  className?: string;
}) {
  const { t } = useI18n();
  const unknownTaskText = taskState === "unavailable" ? t("无权限") : taskState === "error" ? t("加载失败") : t("待核对");
  const risks: RiskItem[] = [
    { key: "current-gap", label: t("当前缺口"), value: currentGap, unit: t("套"), tone: "danger" },
    { key: "overdue", label: t("逾期"), value: overdue, unit: t("项"), tone: "danger", emptyText: unknownTaskText },
    { key: "warning-materials", label: t("异常物料"), value: warningMaterials, unit: t("项"), tone: "warning" },
    { key: "todo", label: t("待办"), value: todo, unit: t("项"), tone: "warning", emptyText: unknownTaskText },
  ];
  const primary = risks.find((risk) => risk.value !== null && risk.value > 0);
  const remaining = primary ? risks.filter((risk) => risk.key !== primary.key) : risks;
  const riskCount = risks.filter((risk) => risk.value !== null && risk.value > 0).length;
  const batchRiskCount = Number(currentGap !== null && currentGap > 0) + Number(warningMaterials !== null && warningMaterials > 0);
  const headline = taskState === "known"
    ? riskCount > 0
      ? t("{count} 类风险需处理", { count: riskCount })
      : currentGap === null ? t("数据待核对") : t("暂无明确风险")
    : taskState === "error"
      ? batchRiskCount > 0
        ? t("{count} 类批次风险，任务风险加载失败，未计入", { count: batchRiskCount })
        : t("任务风险加载失败，未计入")
    : taskState === "unavailable"
      ? batchRiskCount > 0
        ? t("{count} 类批次风险，任务风险未计入", { count: batchRiskCount })
        : currentGap === null ? t("数据待核对") : t("暂无批次风险，任务风险未计入")
      : batchRiskCount > 0
        ? t("{count} 类已确认风险，任务风险待核对", { count: batchRiskCount })
        : currentGap === null ? t("数据待核对") : t("批次风险未发现，任务风险待核对");
  const summaryTone = primary?.tone ?? (taskState === "known" && currentGap !== null ? "clear" : "unknown");
  const scopeCopy = taskScope === "authorized"
    ? t("本批缺口；任务按当前授权范围统计")
    : taskScope === "personal"
      ? t("本批缺口；任务仅统计本人")
      : t("本批缺口；当前无采购任务读取权限");
  return (
    <section aria-label={t("风险速览")} data-cockpit-panel="risks" className={className}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-foreground">{t("风险速览")}</h2>
          <p className={cn(
            "mt-2 text-lg font-bold leading-tight",
            summaryTone === "danger" ? "text-rose-700 dark:text-rose-300" : summaryTone === "warning" || summaryTone === "unknown" ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-300",
          )}>{headline}</p>
        </div>
        <span className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg",
          summaryTone === "danger" ? "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300" : summaryTone === "warning" || summaryTone === "unknown" ? "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
        )} aria-hidden="true">
          {summaryTone === "clear" ? <ClipboardCheck className="size-4" /> : <AlertCircle className="size-4" />}
        </span>
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{scopeCopy}</p>
      {primary ? <dl className="mt-4"><RiskMetric item={primary} primary /></dl> : null}
      <dl className={cn("mt-4 grid grid-cols-2 gap-x-4 gap-y-4 border-t border-border pt-4 xl:grid-cols-1", primary ? "2xl:grid-cols-3" : "2xl:grid-cols-2")}>
        {remaining.map((risk) => <RiskMetric key={risk.key} item={risk} />)}
      </dl>
    </section>
  );
}

function TaskRiskOverview({ currentGap, warningMaterials, taskScope, className }: {
  currentGap: number | null;
  warningMaterials: number | null;
  taskScope: "authorized" | "personal";
  className?: string;
}) {
  const procurement = useProcurementData();
  const taskState = procurement.error ? "error" : procurement.loading ? "pending" : "known";
  const overdue = procurement.tasks.filter(isProcurementTaskOverdue).length;
  const todo = procurement.tasks.filter((task) => task.status === "pending_confirm").length;
  return (
    <RiskOverview
      currentGap={currentGap}
      warningMaterials={warningMaterials}
      overdue={taskState === "known" ? overdue : null}
      todo={taskState === "known" ? todo : null}
      taskState={taskState}
      taskScope={taskScope}
      className={className}
    />
  );
}

function ReadinessCockpit({ data, canReadTaskCounts, taskScope, className }: {
  data: InventoryReadinessResponse;
  canReadTaskCounts: boolean;
  taskScope: "authorized" | "personal" | "unavailable";
  className?: string;
}) {
  const { t } = useI18n();
  const target = nonNegative(data.summary.targetSets);
  const current = data.summary.currentBuildableSets === null ? null : nonNegative(data.summary.currentBuildableSets);
  const afterTransit = data.summary.withTransitBuildableSets === null ? null : nonNegative(data.summary.withTransitBuildableSets);
  const gain = current === null || afterTransit === null || data.summary.inTransitGainSets === null ? null : nonNegative(data.summary.inTransitGainSets);
  const gap = afterTransit === null || data.summary.targetGapAfterTransit === null ? null : nonNegative(data.summary.targetGapAfterTransit);
  const currentGap = current === null ? null : Math.max(0, target - current);
  const scale = Math.max(1, target, current ?? 0, afterTransit ?? 0);
  const resultText = (value: number | null) => value === null ? t("待核对") : quantity(value);
  const capabilityData = [
    { name: t("当前可配"), value: current, color: "#059669" },
    { name: t("全部在途到齐后"), value: afterTransit, color: "var(--primary)" },
  ];
  const capabilityLabel = t("装配物料齐套能力对比：目标 {target} 套，当前可配 {current} 套，在途增益 {gain} 套，全部在途到齐后 {afterTransit} 套，到齐后缺口 {gap} 套", {
    target: quantity(target),
    current: resultText(current),
    gain: resultText(gain),
    afterTransit: resultText(afterTransit),
    gap: resultText(gap),
  });
  return (
    <section aria-label={t("库存齐套驾驶舱")} className={cn("min-w-0 overflow-hidden rounded-[var(--radius-panel)] border border-border bg-card", className)}>
      <div className="grid min-w-0 xl:grid-cols-[minmax(13rem,.72fr)_minmax(25rem,1.45fr)_minmax(17rem,.83fr)]">
        <div className="order-1 min-w-0 border-b border-border bg-accent/30 p-5 xl:border-b-0 xl:border-r sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-foreground">{t("装配物料齐套率")}</h2>
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              {data.productLine === "Q5" ? <span className="rounded-md border border-border bg-card px-2 py-1 text-xs font-semibold text-muted-foreground">{t("不含包材")}</span> : null}
              {data.dataQuality.provisional ? <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">{t("数据待核对")}</span> : null}
            </div>
          </div>
          <strong data-primary-result="readiness-rate" className={cn("mt-5 block font-mono font-black tracking-[-0.04em] tabular-nums", target === 0 || current === null ? "text-2xl text-foreground" : current >= target ? "text-5xl text-emerald-700 dark:text-emerald-300" : "text-5xl text-rose-700 dark:text-rose-300")}>
            {target === 0 ? t("未设置目标") : current === null ? t("待核对") : percent(current / target)}
          </strong>
          <p className="mt-3 text-sm font-semibold text-foreground">{t("当前可配 {current} / 目标 {target} 套", { current: resultText(current), target: quantity(target) })}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {target === 0 ? t("设置批次目标后显示齐套率。") : currentGap === null ? null : currentGap > 0 ? t("当前库存距离目标还差 {gap} 套。", { gap: quantity(currentGap) }) : t("当前库存已覆盖本批需求。")}
          </p>
          {data.productLine === "Q5" ? <p className="mt-3 text-xs leading-5 text-muted-foreground">{t("包材与随箱配件未计入，完整齐套需另行确认。")}</p> : null}
          {data.dataQuality.provisional ? <p className="mt-4 border-t border-amber-200 pt-3 text-xs leading-5 text-amber-800 dark:border-amber-800 dark:text-amber-200">{t("BOM 仍有待完善数据，当前结果仅供风险判断。")}</p> : null}
        </div>

        <section aria-label={t("装配物料齐套能力")} data-cockpit-panel="capability" className="order-3 min-w-0 p-5 xl:order-2 xl:border-r sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-foreground">{t("装配物料齐套能力")}</h2>
            </div>
            <span className="font-mono text-xs font-semibold text-muted-foreground">{data.productLine}</span>
          </div>
          <div className="mt-2 h-44 min-w-0 sm:h-48" role="img" aria-label={capabilityLabel}>
            {current === null && afterTransit === null ? (
              <dl className="flex h-full flex-col justify-center gap-6 text-sm">
                {capabilityData.map(item => <div key={item.name} className="flex items-center justify-between gap-3 border-b border-border pb-3"><dt className="text-muted-foreground">{item.name}</dt><dd className="font-semibold text-muted-foreground">{t("待核对")}</dd></div>)}
              </dl>
            ) : <ResponsiveContainer width="100%" height="100%">
              <BarChart data={capabilityData} layout="vertical" margin={{ top: 14, right: 28, left: 0, bottom: 4 }} accessibilityLayer barSize={20}>
                <CartesianGrid horizontal={false} stroke="var(--border)" strokeDasharray="3 4" />
                <XAxis type="number" domain={[0, scale]} tick={chartAxis} tickLine={false} axisLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="name" width={112} tick={chartAxis} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={chartTooltipStyle} cursor={{ fill: "var(--muted)", opacity: 0.45 }} formatter={(value: number) => [`${quantity(value)} ${t("套")}`, t("可配数量")]} />
                {target > 0 ? <ReferenceLine x={target} stroke="var(--foreground)" strokeDasharray="4 3" label={{ value: t("目标 {target}", { target: quantity(target) }), position: "insideTopRight", fill: "var(--foreground)", fontSize: 11 }} /> : null}
                <Bar dataKey="value" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                  {capabilityData.map((item) => <Cell key={item.name} fill={item.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>}
          </div>
          {current !== afterTransit && (current === null || afterTransit === null) ? <p className="mb-2 text-xs text-muted-foreground">{current === null ? t("当前可配") : t("全部在途到齐后")} · {t("待核对")}</p> : null}
          <dl className="grid grid-cols-3 divide-x divide-border border-t border-border pt-3 text-center">
            <div className="px-2"><dt className="text-[11px] text-muted-foreground">{t("目标")}</dt><dd className="mt-1 font-mono text-sm font-bold tabular-nums text-foreground">{quantity(target)} {t("套")}</dd></div>
            <div className="px-2"><dt className="text-[11px] text-muted-foreground">{t("在途增益")}</dt><dd className={cn("mt-1 font-mono text-sm font-bold tabular-nums", gain === null ? "text-muted-foreground" : "text-primary")}>{gain === null ? t("待核对") : `+${quantity(gain)} ${t("套")}`}</dd></div>
            <div className="px-2"><dt className="text-[11px] text-muted-foreground">{t("到齐后缺口")}</dt><dd className={cn("mt-1 font-mono text-sm font-bold tabular-nums", gap === null ? "text-muted-foreground" : gap > 0 ? "text-rose-700 dark:text-rose-300" : "text-emerald-700 dark:text-emerald-300")}>{gap === null ? t("待核对") : `${quantity(gap)} ${t("套")}`}</dd></div>
          </dl>
        </section>

        {canReadTaskCounts ? (
          <TaskRiskOverview
            currentGap={currentGap}
            warningMaterials={nonNegative(data.summary.warningMaterials)}
            taskScope={taskScope === "authorized" ? "authorized" : "personal"}
            className="order-2 min-w-0 border-b border-border p-5 xl:order-3 xl:border-b-0 sm:p-6"
          />
        ) : (
          <RiskOverview
            currentGap={currentGap}
            warningMaterials={nonNegative(data.summary.warningMaterials)}
            overdue={null}
            todo={null}
            taskState="unavailable"
            taskScope="unavailable"
            className="order-2 min-w-0 border-b border-border p-5 xl:order-3 xl:border-b-0 sm:p-6"
          />
        )}
      </div>
    </section>
  );
}

function BomStatusChart({ data }: { data: InventoryReadinessResponse }) {
  const { t } = useI18n();
  const statusData = [
    { name: t("齐套"), value: data.items.filter((item) => item.status === "ready").length, color: "#059669" },
    { name: t("库存风险"), value: data.items.filter((item) => ["low", "gap", "shortage"].includes(item.status)).length, color: "var(--chart-5)" },
    { name: t("数据待完善"), value: data.items.filter((item) => ["unmatched", "data_missing"].includes(item.status)).length, color: "var(--destructive)" },
  ];
  const total = statusData.reduce((sum, item) => sum + item.value, 0);
  const label = t("BOM 状态分布：齐套 {ready} 项，库存风险 {risk} 项，数据待完善 {dataIssue} 项", {
    ready: quantity(statusData[0].value),
    risk: quantity(statusData[1].value),
    dataIssue: quantity(statusData[2].value),
  });
  return (
    <section className="min-w-0 rounded-[var(--radius-panel)] border border-border bg-card p-4 sm:p-5" aria-labelledby="bom-status-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="bom-status-title" className="text-sm font-bold text-foreground">{t("BOM 状态分布")}</h2>
        </div>
        <strong className="font-mono text-xl font-bold tabular-nums text-foreground">{quantity(total)}<span className="ml-1 text-xs font-semibold text-muted-foreground">{t("项")}</span></strong>
      </div>
      <div className="mt-2 grid min-w-0 gap-3 sm:grid-cols-[minmax(10rem,.8fr)_minmax(12rem,1.2fr)] sm:items-center">
        <div className="h-40 min-w-0" role="img" aria-label={label}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart accessibilityLayer>
              <Tooltip contentStyle={chartTooltipStyle} formatter={(value: number) => [`${quantity(value)} ${t("项")}`, t("物料数量")]} />
              <Pie data={statusData} dataKey="value" nameKey="name" innerRadius={43} outerRadius={67} paddingAngle={2} stroke="var(--card)" strokeWidth={2} isAnimationActive={false}>
                {statusData.map((item) => <Cell key={item.name} fill={item.color} />)}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>
        <dl className="grid gap-3">
          {statusData.map((item) => (
            <div key={item.name} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-border pb-2 last:border-b-0 last:pb-0">
              <span className="size-2.5 rounded-sm" style={{ backgroundColor: item.color }} aria-hidden="true" />
              <dt className="text-xs font-medium text-muted-foreground">{item.name}</dt>
              <dd className="font-mono text-sm font-bold tabular-nums text-foreground">{quantity(item.value)} {t("项")}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function QualityReasonPanel({ overview, state, productLine, onOpenRecords, onRetry }: {
  overview: InventoryQualityOverview | null;
  state: LoadState;
  productLine: string;
  onOpenRecords?: () => void;
  onRetry: () => void;
}) {
  const { t } = useI18n();
  const reasons = overview?.reasons ?? [];
  const maximum = Math.max(1, ...reasons.map((reason) => reason.quantity));
  let emptyCopy = t("本月暂无已归因的来料不良记录");
  if (state === "loading") emptyCopy = t("正在读取来料质量数据…");
  if (state === "unavailable") emptyCopy = t("当前权限不含来料质量数据");
  if (state === "error") emptyCopy = t("来料质量数据暂时不可用");
  if (overview && !overview.mapped) emptyCopy = t("{model} 尚未关联产品档案，来料质量暂不可用", { model: productLine });
  return (
    <section className="min-w-0 rounded-[var(--radius-panel)] border border-border bg-card p-4 sm:p-5" aria-labelledby="quality-reason-title">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="quality-reason-title" className="text-sm font-bold text-foreground">{t("来料不良原因")}</h2>
        <span className="text-xs leading-5 text-muted-foreground">{t("按本月来料检验不良数量统计")}</span>
      </div>
      {reasons.length > 0 ? (
        <div className="mt-5 space-y-4">
          {reasons.slice(0, 6).map((reason) => (
            <div key={reason.key} className="grid grid-cols-[5rem_minmax(0,1fr)_3rem] items-center gap-3 text-xs">
              <span className="truncate font-medium text-muted-foreground">{t(reason.label)}</span>
              <span className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                <span className="block h-full rounded-full bg-primary" style={{ width: `${reason.quantity / maximum * 100}%` }} />
              </span>
              <strong className="text-right text-sm text-foreground tabular-nums">{quantity(reason.quantity)}</strong>
            </div>
          ))}
        </div>
      ) : (
        <div role="status" aria-live="polite" aria-label={t("来料质量状态")} className="mt-4 flex items-start gap-3 rounded-lg border border-dashed border-border bg-muted/40 px-4 py-4 text-left">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-card text-muted-foreground shadow-sm"><ClipboardCheck className="size-4" aria-hidden="true" /></span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{emptyCopy}</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{state === 'loading' ? t('正在核对统计依据，请稍候。') : state === 'unavailable' ? t('请由有来料质量查看权限的人员核对，本区域暂不提供质量判断。') : state === 'error' ? t('暂无法判断本月来料质量，请重新读取；此状态不代表零不良。') : overview && !overview.mapped ? t('请由产品档案维护人员关联设备型号；完成前暂无法汇总该型号的检验结果。') : t('暂无可用于统计的已归因记录，请由质量人员核对本月来料检验及不良原因。')}</p>
            {state === 'error' ? <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onRetry}>{t('重新读取')}</Button> : state === 'ready' && overview?.mapped && onOpenRecords ? <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onOpenRecords}>{t('查看检验记录')}</Button> : null}
          </div>
        </div>
      )}
    </section>
  );
}

export function InventoryReadinessPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedQuery = searchParams.toString();
  const requestedView = useMemo(() => parseInventoryReadinessViewState(requestedQuery), [requestedQuery]);
  const canViewMaterials = usePermission("page:proc-materials");
  const canViewCockpit = usePermission("page:proc-cockpit");
  const canViewWorkspace = usePermission("page:proc-my-workspace");
  const canViewProduction = usePermission("page:production-execution");
  const canViewDirector = usePermission("page:rd-director-dashboard");
  const canReadTaskCounts = canViewCockpit || canViewMaterials || canViewWorkspace;
  const canReadShipment = canViewProduction || canViewDirector;
  const canReadQuality = canViewCockpit;
  const canViewInspection = usePermission('page:inspection-release');
  const taskScope = !canReadTaskCounts ? "unavailable" : canViewCockpit || canViewMaterials ? "authorized" : "personal";

  const [data, setData] = useState<InventoryReadinessResponse | null>(null);
  const [productLine, setProductLine] = useState(requestedView.productLine);
  const [revisionId, setRevisionId] = useState(requestedView.revisionId);
  const [targetDraft, setTargetDraft] = useState(String(requestedView.targetSets));
  const [targetSets, setTargetSets] = useState(requestedView.targetSets);
  const [month, setMonth] = useState(() => safeMonth(new URLSearchParams(requestedQuery).get("month")));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [targetError, setTargetError] = useState("");
  const [shipment, setShipment] = useState<InventoryShipmentOverview | null>(null);
  const [shipmentState, setShipmentState] = useState<LoadState>(canReadShipment ? "loading" : "unavailable");
  const [quality, setQuality] = useState<InventoryQualityOverview | null>(null);
  const [qualityState, setQualityState] = useState<LoadState>(canReadQuality ? "loading" : "unavailable");
  const [supplementVersion, setSupplementVersion] = useState(0);
  const requestRef = useRef(0);

  useEffect(() => {
    setProductLine(requestedView.productLine);
    setRevisionId(requestedView.revisionId);
    setTargetSets(requestedView.targetSets);
    setTargetDraft(String(requestedView.targetSets));
    setTargetError("");
  }, [requestedView]);

  const load = useCallback(async (signal?: AbortSignal, requestedTarget = targetSets) => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError("");
    try {
      const next = await getInventoryReadiness({ productLine, targetSets: requestedTarget, ...(revisionId ? { revisionId } : {}) }, signal);
      if (signal?.aborted || requestId !== requestRef.current) return;
      if (next.productLine !== productLine) throw new Error(t("返回的 BOM 型号与所选型号不一致，请刷新后重试。"));
      if (revisionId && (next.bomBasis?.kind !== 'published' || next.bomBasis.revisionId !== revisionId)) throw new Error(t("返回的 BOM 版本与所选依据不一致，请刷新后重试。"));
      setData(next);
    } catch (cause) {
      if (signal?.aborted || requestId !== requestRef.current) return;
      setError(cause instanceof Error ? cause.message : t("库存齐套数据加载失败"));
    } finally {
      if (!signal?.aborted && requestId === requestRef.current) setLoading(false);
    }
  }, [productLine, targetSets, revisionId, t]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => {
      requestRef.current += 1;
      controller.abort();
    };
  }, [load]);

  useEffect(() => {
    const controller = new AbortController();
    if (canReadShipment) {
      setShipmentState("loading");
      void getInventoryShipmentOverview(month, controller.signal)
        .then((value) => { if (!controller.signal.aborted) { setShipment(value); setShipmentState("ready"); } })
        .catch((cause) => { if (!controller.signal.aborted && cause?.name !== "AbortError") { setShipment(null); setShipmentState("error"); } });
    } else {
      setShipment(null);
      setShipmentState("unavailable");
    }
    if (canReadQuality) {
      setQualityState("loading");
      void getInventoryQualityOverview(month, productLine, controller.signal)
        .then((value) => { if (!controller.signal.aborted) { setQuality(value); setQualityState("ready"); } })
        .catch((cause) => { if (!controller.signal.aborted && cause?.name !== "AbortError") { setQuality(null); setQualityState("error"); } });
    } else {
      setQuality(null);
      setQualityState("unavailable");
    }
    return () => controller.abort();
  }, [canReadQuality, canReadShipment, month, productLine, supplementVersion]);

  const commitTarget = () => {
    const parsed = Number(targetDraft);
    if (!targetDraft.trim() || !Number.isInteger(parsed) || parsed < 0 || parsed > 1_000_000) {
      setTargetError(t("请输入 0 到 1,000,000 之间的整数套数"));
      return null;
    }
    setTargetError("");
    setTargetDraft(String(parsed));
    setTargetSets(parsed);
    return parsed;
  };

  const openMaterialLibrary = () => {
    const returnPath = buildInventoryReadinessPath({
      productLine,
      revisionId,
      targetSets,
      q: "",
      category: "all",
      status: "all",
      page: 1,
      pageSize: 20,
    });
    navigate(returnPath, { replace: true });
    navigate(routePath("page:proc-materials", "/proc-materials"), {
      state: { inventoryReadinessReturnTo: returnPath, inventoryReadinessHistoryBack: true },
    });
  };

  const resultScopeMatches = Boolean(data && data.productLine === productLine && data.summary.targetSets === targetSets && (revisionId ? data.bomBasis?.kind === 'published' && data.bomBasis.revisionId === revisionId : data.bomBasis?.kind !== 'published'));
  const currentData = Boolean(resultScopeMatches && !loading && !error && targetDraft.trim() && Number(targetDraft) === targetSets);
  const shipmentTarget = shipmentState === "ready" ? shipment?.shipmentTargetQty ?? null : null;
  const shipped = shipmentState === "ready" ? shipment?.actualShippedQty ?? null : null;
  const pendingShipment = shipmentTarget !== null && shipped !== null ? Math.max(0, shipmentTarget - shipped) : null;
  const lastSync = syncDate(data?.syncedAt);
  const inventorySyncTimes = new Map<string, number>();
  for (const item of [...(data?.items ?? []), ...(data?.packaging?.items ?? [])]) {
    const timestamp = item.syncedAt ? Date.parse(item.syncedAt) : NaN;
    if (!Number.isFinite(timestamp)) continue;
    const key = item.code || item.id;
    const previous = inventorySyncTimes.get(key);
    if (previous === undefined || timestamp < previous) inventorySyncTimes.set(key, timestamp);
  }
  const syncTimes = [...inventorySyncTimes.values()];
  const oldestSyncTime = syncTimes.length > 0 ? Math.min(...syncTimes) : null;
  const oldestSync = oldestSyncTime === null ? null : syncDate(new Date(oldestSyncTime).toISOString());
  const staleInventoryCount = syncTimes.filter((timestamp) => Date.now() - timestamp > 24 * 60 * 60 * 1000).length;
  const matchRate = data && Number.isFinite(data.dataQuality.inventoryMatchRate)
    ? data.dataQuality.inventoryMatchRate
    : data?.dataQuality.totalBomLines
      ? data.dataQuality.inventoryMatchedLines / data.dataQuality.totalBomLines
      : 0;
  const busy = loading || shipmentState === "loading" || qualityState === "loading";

  return (
    <div className="proc-horizon flex min-w-0 flex-col gap-3">
      <section aria-label={t("月度出货概览")} className="order-2 rounded-[var(--radius-panel)] border border-border bg-card px-3 py-3 sm:px-4 xl:order-1">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <label className="flex shrink-0 items-center rounded-lg bg-muted/50 px-3 text-sm font-semibold text-foreground focus-within:ring-2 focus-within:ring-primary/30 focus-within:ring-offset-2">
            <span className="sr-only">{t("统计月份")}</span>
            <Input type="month" value={month} onChange={(event) => setMonth(safeMonth(event.target.value))} className="h-11 w-full min-w-0 border-0 bg-transparent p-0 font-bold text-primary shadow-none focus-visible:ring-2 focus-visible:ring-primary/30 sm:w-40" aria-label={t("统计月份")} />
          </label>
          <dl className="grid min-w-0 flex-1 grid-cols-3 divide-x divide-border">
            <ShipmentStat label={t("月度出货目标")} value={shipmentTarget} />
            <ShipmentStat label={t("已出货")} value={shipped} />
            <ShipmentStat label={t("待出货")} value={pendingShipment} />
          </dl>
          <p className="shrink-0 text-xs text-muted-foreground xl:max-w-44">
            {shipmentState === "ready" && shipment?.scope === "assigned" ? t("当前显示授权范围") : shipmentState === "unavailable" ? t("当前权限不含生产出货数据") : shipmentState === "error" ? t("出货数据暂时不可用") : null}
          </p>
        </div>
      </section>

      <section aria-label={t("齐套核算条件")} className="order-3 rounded-[var(--radius-panel)] border border-border bg-card p-4 xl:order-2">
        <div data-layout="readiness-controls" className="grid grid-cols-2 gap-3 xl:grid-cols-[minmax(12rem,1.25fr)_minmax(10rem,1fr)_9rem_minmax(10rem,1fr)_auto] xl:items-end">
          <label className="grid min-w-0 gap-1 text-xs font-semibold text-muted-foreground">
            <span>{t("产品型号")}</span>
            <Select value={productLine} onValueChange={(value) => { setProductLine(value); setRevisionId(undefined); }} disabled={!data?.models.length}>
              <SelectTrigger className="h-11 min-w-0 border-border bg-card" aria-label={t("选择产品型号")}><SelectValue placeholder={t(loading ? "正在加载型号" : "暂无型号")} /></SelectTrigger>
              <SelectContent>
                {(data?.models ?? []).map((model) => <SelectItem key={model.id} value={model.id}>{model.id === "Q5" ? t("Q5 · 整机装配") : model.label} · {model.bomLines}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
          <div className="grid min-w-0 gap-1 text-xs font-semibold text-muted-foreground">
            <span>{t("BOM")}</span>
            <div className="flex min-h-11 min-w-0 items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm font-semibold text-foreground"><DatabaseZap className="size-4 shrink-0 text-primary" aria-hidden="true" /><span>{resultScopeMatches ? data?.bomBasis?.kind === 'published' ? t("发布版本 V{version}", { version: data.bomBasis.version }) : t("工作稿 · 仅供估算") : t("待核对")}</span></div>
          </div>
          <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
            <span>{t("批次目标")}</span>
            <Input type="number" min={0} max={1_000_000} step={1} value={targetDraft} onChange={(event) => { setTargetDraft(event.target.value); setTargetError(""); }} onBlur={commitTarget} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} aria-invalid={Boolean(targetError)} aria-describedby={targetError ? "readiness-target-error" : undefined} className="h-11 border-border bg-card text-right font-bold tabular-nums" aria-label={t("批次目标")} />
          </label>
          <div className="grid min-w-0 gap-1 text-xs font-semibold text-muted-foreground">
            <span>{t("库存范围")}</span>
            <div className="flex h-11 items-center gap-2 rounded-md bg-muted/50 px-3 text-sm font-semibold text-foreground"><Warehouse className="size-4 text-primary" aria-hidden="true" />{t("量产仓库")}</div>
          </div>
          <div className="col-span-2 flex items-center gap-2 xl:col-span-1 xl:justify-end">
            {canViewMaterials ? <Button type="button" variant="outline" onClick={() => navigate(`${subRoutePath("page:proc-materials", "/proc-materials", "bom")}?${new URLSearchParams({ productLine })}`)} className="h-11 flex-1 xl:flex-none">{t("BOM清单")}</Button> : null}
            {canViewMaterials ? <Button type="button" variant="outline" onClick={openMaterialLibrary} className="h-11 flex-1 border-border bg-card text-foreground xl:flex-none"><Boxes className="size-4" aria-hidden="true" />{t("打开物料库")}</Button> : null}
            <Button type="button" variant="outline" disabled={busy} onClick={() => { const target = commitTarget(); if (target !== null) { void load(undefined, target); setSupplementVersion((value) => value + 1); } }} className="h-11 flex-1 border-border bg-card text-foreground xl:flex-none"><RefreshCw className={cn("size-4", busy && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />{t("刷新")}</Button>
          </div>
        </div>
        {targetError ? <p id="readiness-target-error" role="alert" className="mt-2 text-xs text-rose-700">{targetError}</p> : null}
        {resultScopeMatches && data?.bomBasis?.kind === 'published' && data.bomBasis.retiredAt ? <p className="mt-2 text-xs text-amber-700">{t("该版本已停用，仅保留历史核算，不可用于新计划。")}</p> : null}
      </section>

      <InventoryMonthlyReadiness month={month} productLine={productLine} refreshVersion={supplementVersion} />

      {error ? (
        <div role="alert" className="order-1 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-panel)] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 xl:order-3">
          <span className="flex items-center gap-2"><AlertCircle className="size-4" aria-hidden="true" />{error}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void load()} className="border-rose-200 bg-card text-rose-700">{t("重新加载")}</Button>
        </div>
      ) : null}

      {data && resultScopeMatches && data.dataQuality.totalBomLines > 0 ? (
        <>
          <ReadinessCockpit data={data} canReadTaskCounts={canReadTaskCounts} taskScope={taskScope} className="order-1 xl:order-3" />

          <details className={cn("group order-4 rounded-[var(--radius-panel)] border px-4 text-xs", data.dataQuality.provisional || oldestSyncTime === null || staleInventoryCount > 0 ? "border-amber-200 bg-amber-50/70 text-amber-900" : "border-border bg-card text-muted-foreground")}>
            <summary className="flex min-h-11 cursor-pointer list-none items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
              <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <strong>{t("数据可信度")}</strong>
                {data.summary.currentBuildableSets === null || data.summary.withTransitBuildableSets === null ? <span className="font-semibold">{data.summary.currentBuildableSets === null ? t("当前可配") : t("全部在途到齐后")} · {t("待核对")}</span> : null}
                <span>{t("BOM 可核算率")} {percent(data.dataQuality.bomCompleteness)}</span>
                <span>{t("库存匹配率")} {percent(matchRate)}</span>
                <span>{t("最早记录")} {oldestSync ?? t("待核对")}</span>
                <span>{t("最近写入")} {lastSync ?? t("待核对")}</span>
                {staleInventoryCount > 0 ? <span className="font-semibold">{t("{count} 项库存记录超过 24 小时", { count: quantity(staleInventoryCount) })}</span> : null}
                <span className="ml-auto font-semibold text-primary group-open:hidden">{t("查看口径")}</span>
                <span className="ml-auto hidden font-semibold text-primary group-open:inline">{t("收起口径")}</span>
              </span>
            </summary>
            <div className="border-t border-current/10 py-3 leading-5">
              {[...new Set(data.items.flatMap(item => item.issues ?? []))].map(issue => <p key={issue}>{issue}</p>)}
              {data.stockReadAt && <p>{t('核对时间')}：{new Date(data.stockReadAt).toLocaleString()} · {t('量产仓库')}</p>}
              {!!data.stockRows?.length && <div className="mt-2 max-h-64 overflow-auto"><table className="w-full min-w-[32rem] text-left tabular-nums"><thead><tr>{['物料编码', '仓库', '可用量', 'ERP 同步时间'].map(label => <th className="p-2" key={label}>{t(label)}</th>)}</tr></thead><tbody>{data.stockRows.map(row => <tr key={`${row.code}:${row.warehouse}`} className="border-t border-current/10"><td className="p-2">{row.code}</td><td className="p-2">{row.warehouse}</td><td className="p-2">{row.available === null ? t('待核对') : `${quantity(row.available)} ${row.unit}`}</td><td className="p-2">{row.syncedAt ? new Date(row.syncedAt).toLocaleString() : t('未同步')}</td></tr>)}</tbody></table></div>}
              <p>{t("齐套仅按当前生效 BOM 与量产仓库可用量核算；全部在途到齐后未按到货日期筛选，不代表按期齐套。")}</p>
              {data.productLine === "Q5" ? <p className="mt-1">{t("Q5 包材与随箱配件的配套数量待确认，未计入装配物料齐套率。")}</p> : null}
              {data.dataQuality.provisional ? <p className="mt-1">{t("仍有 {invalid} 条 BOM 待完善，当前数字用于风险判断，不直接作为采购数量。", { invalid: data.dataQuality.invalidBomLines })}</p> : null}
              {staleInventoryCount > 0 ? <p className="mt-1">{t("部分物料库存记录超过 24 小时未重新写入，请先核对同步覆盖范围。")}</p> : null}
            </div>
          </details>

          <div className="order-5 grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1.25fr)_minmax(20rem,.75fr)]">
            <BomStatusChart data={data} />
            <QualityReasonPanel overview={quality} state={qualityState} productLine={productLine}
              onRetry={() => setSupplementVersion(value => value + 1)}
              onOpenRecords={canViewInspection ? () => navigate(routePath('page:inspection-release', '/inspection-release')) : undefined} />
          </div>

          <div className="order-6 flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-muted-foreground">
            <span>{t("数据来源：畅捷通 T+（只读）")} · {t("最近记录写入")}：{lastSync ?? t("待核对")}</span>
            <span>{data.warehouse.matchedNames.length > 0 ? `${t("已匹配仓库")}：${data.warehouse.matchedNames.join(" / ")}` : t("量产仓库匹配待核对")}</span>
          </div>
        </>
      ) : data && resultScopeMatches ? (
        <div className="order-1 flex min-h-72 flex-col items-center justify-center rounded-[var(--radius-panel)] border border-border bg-card px-6 text-center xl:order-3">
          <span className="flex size-11 items-center justify-center rounded-lg bg-accent text-primary"><Boxes className="size-5" aria-hidden="true" /></span>
          <h2 className="mt-4 text-base font-bold text-foreground">{t("尚未找到 {model} 的可核算 BOM", { model: data.productLine || productLine })}</h2>
          <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{t("请先在物料库完成产品 BOM 初始化，再返回核算量产仓库存。")}</p>
          {canViewMaterials ? <Button type="button" variant="outline" onClick={openMaterialLibrary} className="mt-4 border-border bg-card text-foreground">{t("打开物料库")}</Button> : null}
        </div>
      ) : loading || (!error && !currentData) ? (
        <div role="status" aria-live="polite" className="order-1 flex min-h-64 items-center justify-center rounded-[var(--radius-panel)] border border-border bg-card text-sm text-muted-foreground xl:order-3"><RefreshCw className="mr-2 size-4 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />{t("正在核算库存齐套情况…")}</div>
      ) : null}
      {!(data && resultScopeMatches && data.dataQuality.totalBomLines > 0) && (
        <div className="order-5 grid min-w-0 gap-3 xl:grid-cols-2">
          {canReadTaskCounts ? (
            <TaskRiskOverview currentGap={null} warningMaterials={null} taskScope={taskScope === "authorized" ? "authorized" : "personal"} className="min-w-0 rounded-[var(--radius-panel)] border border-border bg-card p-5" />
          ) : (
            <RiskOverview currentGap={null} warningMaterials={null} overdue={null} todo={null} taskState="unavailable" taskScope="unavailable" className="min-w-0 rounded-[var(--radius-panel)] border border-border bg-card p-5" />
          )}
          <QualityReasonPanel overview={quality} state={qualityState} productLine={productLine}
            onRetry={() => setSupplementVersion(value => value + 1)}
            onOpenRecords={canViewInspection ? () => navigate(routePath('page:inspection-release', '/inspection-release')) : undefined} />
        </div>
      )}
    </div>
  );
}
