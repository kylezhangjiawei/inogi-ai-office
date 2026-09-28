import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BarChart3, ChartNoAxesCombined } from 'lucide-react';
import { HorizonSectionHeader } from '../components/horizon/HorizonPage';
import { useI18n } from '../lib/i18n';
import type { ManagementDashboardInsights } from './managementDashboardInsights';

const tooltipStyle = { border: '1px solid var(--border)', borderRadius: 10, background: 'var(--card)', color: 'var(--foreground)', fontSize: 12 };
const axis = { fontSize: 11, fill: 'var(--muted-foreground)' };
const riskTypes = [
  { key: 'procurement', label: '采购任务', color: 'var(--primary)' },
  { key: 'purchase-order', label: '采购订单', color: 'var(--chart-2)' },
  { key: 'material', label: '物料齐套', color: 'var(--chart-4)' },
  { key: 'schedule', label: '生产进度', color: 'var(--chart-3)' },
  { key: 'quality', label: '质量异常', color: 'var(--destructive)' },
  { key: 'ecn', label: '工程变更', color: 'var(--chart-5)' },
] as const;

export function ManagementDashboardCharts({ insights, showProduction, showRisks, loading }: { insights: ManagementDashboardInsights; showProduction: boolean; showRisks: boolean; loading: boolean }) {
  const { t } = useI18n();
  const risks = riskTypes.map(item => ({ name: t(item.label), value: insights.riskCounts?.[item.key] ?? 0, color: item.color }));
  const total = risks.reduce((sum, item) => sum + item.value, 0);
  const planned = insights.trend.at(-1)?.plannedQty;
  const actual = [...insights.trend].reverse().find(item => item.actualGoodQty != null)?.actualGoodQty;
  const hasActual = insights.actualAvailable && actual != null;
  if (!showProduction && !showRisks) return null;
  return <div className="md-charts">
    {showProduction && <section className="md-panel md-trend" aria-label={t('月度生产趋势')}>
      <HorizonSectionHeader Icon={ChartNoAxesCombined} title={t('本月派工与首次终检')} description={t('整机累计数量 · 按实际业务日期')} trailing={<div className="md-chart-legend"><span><i className="md-legend-planned" />{t('累计派工')}</span>{hasActual && <span><i className="md-legend-actual" />{t('首次终检合格')}</span>}</div>} />
      {loading || !insights.trend.length ? <p className="md-chart-empty" role="status">{t(loading ? '正在汇总生产趋势…' : '暂无可展示的派工记录')}</p> : <>
        <div className="md-chart-summary"><span>{t('月内派工')} <b>{planned} {t('台')}</b></span>{hasActual && <span>{t('截至当前首次合格')} <b>{actual ?? 0} {t('台')}</b></span>}</div>
        <div className="md-chart-canvas" role="img" aria-label={t('月内累计派工 {planned} 台，首次终检合格 {actual}', { planned: planned ?? 0, actual: hasActual ? `${actual} ${t('台')}` : t(insights.actualAvailable ? '所选月份尚未开始' : '明细待核对') })}>
          <ResponsiveContainer width="100%" height="100%"><LineChart data={insights.trend} margin={{ top: 10, right: 20, left: -16, bottom: 0 }} accessibilityLayer>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 4" />
            <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} minTickGap={32} dy={8} />
            <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} width={56} />
            <Tooltip contentStyle={tooltipStyle} formatter={(value: number, name: string) => [`${value} ${t('台')}`, name]} />
            <Line dataKey="plannedQty" name={t('累计派工')} type="linear" stroke="var(--chart-2)" strokeWidth={2} strokeDasharray="5 4" dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
            {hasActual && <Line dataKey="actualGoodQty" name={t('首次终检合格')} type="linear" stroke="var(--primary)" strokeWidth={3} dot={false} activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />}
          </LineChart></ResponsiveContainer>
        </div>
        <p className="md-chart-note">{t(hasActual ? '首次终检不含返工复验；派工不含草稿与组件。' : insights.actualAvailable ? '所选月份尚未开始，实际数量将在业务发生后展示。' : '首次终检日明细尚未完整核对，暂不绘制实际线。')}</p>
      </>}
    </section>}
    {showRisks && <section className="md-panel md-risk-chart" aria-label={t('风险来源分布')}>
      <HorizonSectionHeader Icon={BarChart3} title={t('风险来源分布')} description={t('本月与跨月未完 · 当前授权范围')} trailing={insights.riskCounts && <span className="md-chart-total">{total} <small>{t('项')}</small></span>} />
      {loading || !insights.riskCounts ? <p className="md-chart-empty" role="status">{t(loading ? '正在汇总风险…' : '风险数据暂未就绪')}</p> : total === 0 ? <p className="md-chart-empty">{t('当前没有待处理风险')}</p> : <><div className="md-chart-canvas md-risk-chart-canvas" role="img" aria-label={risks.map(item => `${item.name} ${item.value} ${t('项')}`).join('，')}>
        <ResponsiveContainer width="100%" height="100%"><BarChart data={risks} margin={{ top: 20, right: 12, left: -24, bottom: 0 }} accessibilityLayer barSize={30}>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 4" />
          <XAxis dataKey="name" tick={axis} tickLine={false} axisLine={false} interval={0} dy={6} />
          <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} width={46} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'var(--muted)', opacity: .5 }} formatter={(value: number) => [`${value} ${t('项')}`, t('风险数量')]} />
          <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive={false} label={{ position: 'top', fill: 'var(--foreground)', fontSize: 12 }}>{risks.map(item => <Cell key={item.name} fill={item.color} />)}</Bar>
        </BarChart></ResponsiveContainer>
      </div><p className="md-chart-note">{t('按风险记录归类；同一批次可能存在多项风险。')}</p></>}
    </section>}
  </div>;
}
