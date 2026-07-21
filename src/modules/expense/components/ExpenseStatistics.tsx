import { BarChart3, Bot, Loader2 } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { ExpenseCategory, ExpenseDashboardData } from "../types";
import { i18nLocale, useI18n } from "../../../app/lib/i18n";
import { EmptyState } from "./EmptyState";
import { KPICard } from "./KPICard";

const CATEGORY_META: Array<{ key: ExpenseCategory; color: string }> = [
  { key: "差旅", color: "var(--chart-1)" },
  { key: "餐饮", color: "var(--chart-5)" },
  { key: "采购", color: "var(--chart-3)" },
  { key: "办公", color: "var(--chart-2)" },
  { key: "其他", color: "var(--chart-4)" },
];

const STATUS_COLORS: Record<string, string> = {
  待识别: "#94a3b8",
  已识别: "#3b82f6",
  待确认: "#f59e0b",
  已关联: "#10b981",
  异常: "#ef4444",
  已报销: "#6366f1",
};

const fmtCNY = (value: number) =>
  new Intl.NumberFormat(i18nLocale(), { style: "currency", currency: "CNY", maximumFractionDigits: 0 }).format(value);

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="material-panel flex flex-col px-4 py-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div className="text-sm font-bold text-slate-800">{title}</div>
        {subtitle ? <div className="text-xs text-slate-400">{subtitle}</div> : null}
      </div>
      {children}
    </div>
  );
}

function CurrencyTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name?: string; value?: number; color?: string }>; label?: string }) {
  const { t } = useI18n();
  if (!active || !payload?.length) return null;
  // 堆叠面积图会把当月所有分类都塞进 payload，金额为 0 的分类不展示，避免一长串 ¥0 噪音。
  const items = payload.filter((entry) => Number(entry.value ?? 0) > 0);
  if (!items.length) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-lg">
      {label ? <div className="mb-1 font-semibold text-slate-700">{label}</div> : null}
      {items.map((entry, index) => (
        <div key={index} className="flex items-center gap-2 text-slate-600">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: entry.color }} />
          <span className="min-w-12">{t(entry.name ?? '')}</span>
          <span className="ml-auto font-medium text-slate-800">{fmtCNY(Number(entry.value ?? 0))}</span>
        </div>
      ))}
    </div>
  );
}

export function ExpenseStatistics({
  dashboard,
  loading,
}: {
  dashboard: ExpenseDashboardData | null;
  loading: boolean;
}) {
  const { t } = useI18n();
  const translateMetric = (value?: string) => {
    if (!value) return undefined;
    const accumulated = value.match(/^(\d+)\s*张\s*·\s*累计\s*(.+)$/);
    if (accumulated) return `${accumulated[1]} ${t('张')} · ${t('累计')} ${accumulated[2]}`;
    const counted = value.match(/^(\d+)\s*(张|异常|单)$/);
    if (counted) return `${counted[1]} ${t(counted[2])}`;
    return t(value);
  };
  if (!dashboard && loading) {
    return (
      <div className="flex h-full items-center justify-center text-slate-400">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> {t('正在加载统计数据…')}
      </div>
    );
  }

  // 接口未返回（首次加载失败/无 dashboard）才整页空态；只要有 dashboard 就渲染 KPI。
  if (!dashboard) {
    return (
      <div className="px-5 py-6">
        <EmptyState
          icon={BarChart3}
          title={t('暂无报销统计数据')}
          detail={t('上传发票或付款凭证、创建报销单后，本月报销总额、分类占比、月度趋势等指标会自动汇总。')}
        />
      </div>
    );
  }

  const categoryShare = dashboard.categoryShare.filter((item) => item.amount > 0);
  const statusBreakdown = dashboard.statusBreakdown.filter((item) => item.count > 0);
  const projectTop = dashboard.projectTop.filter((item) => item.amount > 0);
  const hasTrend = dashboard.monthlyTrend.length > 0;
  // KPI 始终展示（含「企微审批中」等仅报销单也有的指标）；图表区只有在彻底无图表数据时整体收起。
  const hasChartData = hasTrend || categoryShare.length > 0 || statusBreakdown.length > 0 || projectTop.length > 0;

  return (
    <div className="h-full overflow-y-auto px-5 py-4">
      <div className="flex flex-col gap-4">
        {/* KPI 概览：本月总额 / 待处理 / AI 自动处理率 / 企微审批中 */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {dashboard.kpis.map((kpi, index) => (
            <KPICard
              key={index}
              title={t(kpi.title)}
              value={translateMetric(kpi.value) ?? kpi.value}
              icon={kpi.icon}
              trend={translateMetric(kpi.trend)}
              badge={translateMetric(kpi.badge)}
              progress={kpi.progress}
            />
          ))}
        </div>

        {!hasChartData ? (
          <EmptyState
            icon={BarChart3}
            title={t('暂无图表统计数据')}
            detail={t('上传发票或付款凭证并完成识别后，分类占比、月度趋势、票据状态分布等图表会自动汇总。')}
          />
        ) : (
        <>
        {/* 月度分类趋势（按发票 issued_date 落桶，近 6 个月） */}
        <ChartCard title={t('月度分类趋势')} subtitle={t('近 6 个月 · 按开票日期')}>
          {hasTrend ? (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dashboard.monthlyTrend} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                <defs>
                  {CATEGORY_META.map((meta) => (
                    <linearGradient key={meta.key} id={`grad-${meta.key}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={meta.color} stopOpacity={0.35} />
                      <stop offset="95%" stopColor={meta.color} stopOpacity={0.04} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 11, fill: "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                  width={56}
                  tickFormatter={(value: number) => (value >= 10000 ? `${(value / 10000).toFixed(0)}${t('万')}` : `${value}`)}
                />
                <Tooltip content={<CurrencyTooltip />} />
                <Legend iconType="circle" formatter={(value) => t(String(value))} wrapperStyle={{ fontSize: 12 }} />
                {CATEGORY_META.map((meta) => (
                  <Area
                    key={meta.key}
                    type="monotone"
                    dataKey={meta.key}
                    name={t(meta.key)}
                    stackId="1"
                    stroke={meta.color}
                    strokeWidth={2}
                    fill={`url(#grad-${meta.key})`}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
          ) : (
            <EmptyState compact title={t('暂无月度数据')} />
          )}
        </ChartCard>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* 分类金额占比 */}
          <ChartCard title={t('分类金额占比')} subtitle={t('累计')}>
            {categoryShare.length ? (
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={categoryShare}
                      dataKey="amount"
                      nameKey="category"
                      cx="50%"
                      cy="50%"
                      innerRadius={56}
                      outerRadius={88}
                      paddingAngle={2}
                      isAnimationActive={false}
                    >
                      {categoryShare.map((entry) => (
                        <Cell
                          key={entry.category}
                          fill={CATEGORY_META.find((meta) => meta.key === entry.category)?.color ?? "#cbd5e1"}
                        />
                      ))}
                    </Pie>
                    <Tooltip content={<CurrencyTooltip />} />
                    <Legend iconType="circle" formatter={(value) => t(String(value))} wrapperStyle={{ fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyState compact title={t('暂无分类数据')} />
            )}
          </ChartCard>

          {/* 票据状态分布 */}
          <ChartCard title={t('票据状态分布')} subtitle={t('张数')}>
            {statusBreakdown.length ? (
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={statusBreakdown} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                    <XAxis dataKey="status" tickFormatter={(value: string) => t(value)} tick={{ fontSize: 12, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={32} />
                    <Tooltip
                      cursor={{ fill: "rgba(148,163,184,0.08)" }}
                      formatter={(value: number, _name, item) => [`${value} ${t('张')} · ${fmtCNY(Number((item?.payload as { amount?: number })?.amount ?? 0))}`, t('票据')]}
                    />
                    <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={48}>
                      {statusBreakdown.map((entry) => (
                        <Cell key={entry.status} fill={STATUS_COLORS[entry.status] ?? "#94a3b8"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyState compact title={t('暂无票据')} />
            )}
          </ChartCard>
        </div>

        {/* 项目报销 Top */}
        <ChartCard title={t('项目报销 Top 5')} subtitle={t('按累计金额')}>
          {projectTop.length ? (
            <div className="w-full" style={{ height: Math.max(160, projectTop.length * 52) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart layout="vertical" data={projectTop} margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 11, fill: "#94a3b8" }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(value: number) => (value >= 10000 ? `${(value / 10000).toFixed(0)}${t('万')}` : `${value}`)}
                  />
                  <YAxis
                    type="category"
                    dataKey="project"
                    width={140}
                    tick={{ fontSize: 12, fill: "#475569" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip cursor={{ fill: "rgba(148,163,184,0.08)" }} content={<CurrencyTooltip />} />
                  <Bar dataKey="amount" name={t('报销金额')} radius={[0, 6, 6, 0]} fill="var(--chart-1)" maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState compact title={t('暂无项目数据')} icon={Bot} />
          )}
        </ChartCard>
        </>
        )}
      </div>
    </div>
  );
}
