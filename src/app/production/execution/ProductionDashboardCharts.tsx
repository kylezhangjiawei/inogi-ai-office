import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BarChart3, ShieldCheck, TriangleAlert } from 'lucide-react';

export interface DashboardStatistics {
  daily: { date: string; reportedQty: number; finalQuantity: number; finalGoodQty: number }[];
  today: { date: string; firstFinal: { quantity: number; goodQty: number; firstPassRate: number | null }; defects: { process: string; quantity: number; unit: '台' }[] };
}
const number = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 3 });
const colors = ['#e35265', '#3478ed', '#ef9b37', '#7292c8'];
const tooltipStyle = { border: '1px solid #dce5f3', borderRadius: 8, fontSize: 12, color: '#1b2c54', boxShadow: '0 4px 16px #1b2c5412' };
export function ProductionDashboardCharts({ statistics, month, loading, error }: { statistics?: DashboardStatistics; month: string; loading: boolean; error: boolean }) {
  const currentDate = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  let cumulative = 0;
  const daily = statistics?.daily.map(row => { cumulative += row.finalGoodQty; return { ...row, day: row.date.slice(5), cumulative: row.date > currentDate ? null : cumulative }; }) ?? [];
  const reported = daily.reduce((sum, row) => sum + row.reportedQty, 0), finalGood = daily.reduce((sum, row) => sum + row.finalGoodQty, 0);
  const hasActivity = daily.some(row => row.reportedQty || row.finalQuantity);
  const first = statistics?.today.firstFinal, defects = statistics?.today.defects ?? [];
  const message = loading ? '正在读取统计…' : error ? '统计暂时不可用，请重新加载' : '统计数据尚未接入';
  return <div className="cockpit-charts-grid">
    <section className="cockpit-card cockpit-trend" aria-label="整机生产趋势">
      <div className="cockpit-section-title"><h2><BarChart3 size={18} aria-hidden="true" />整机生产趋势</h2><span>{month} · 台</span></div>
      <div className="cockpit-trend-summary"><div><span>本月整机报工</span><strong>{statistics ? number(reported) : '—'}<small>台</small></strong></div><div><span>本月首次终检合格</span><strong>{statistics ? number(finalGood) : '—'}<small>台</small></strong></div><div className="cockpit-chart-legend"><span><i className="cockpit-legend-bar" />当日报工</span><span><i className="cockpit-legend-line" />累计终检合格</span></div></div>
      <div className="cockpit-trend-chart" role="img" aria-label={statistics ? '所选月份整机报工 ' + number(reported) + ' 台，首次终检合格 ' + number(finalGood) + ' 台；不代表闸门完工' : message}>
        {!statistics ? <p className="cockpit-chart-empty" role="status">{message}</p> : !hasActivity ? <p className="cockpit-chart-empty">本月暂无整机报工或首次终检记录</p> : <ResponsiveContainer width="100%" height="100%"><ComposedChart data={daily} margin={{ top: 8, right: 12, left: -18, bottom: 0 }} accessibilityLayer>
          <CartesianGrid stroke="#e7edf6" strokeDasharray="3 4" vertical={false} />
          <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: '#647491', fontSize: 11 }} interval={Math.max(1, Math.floor(daily.length / 6))} minTickGap={8} />
          <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: '#647491', fontSize: 11 }} width={52} />
          <Tooltip contentStyle={tooltipStyle} formatter={(value: number, name: string) => [number(value) + ' 台', name]} labelFormatter={label => month.slice(0, 4) + '-' + label} />
          <Bar dataKey="reportedQty" name="当日报工" fill="#b9d0ff" radius={[3, 3, 0, 0]} maxBarSize={18} isAnimationActive={false} />
          <Line type="monotone" dataKey="cumulative" name="累计终检合格" stroke="#1958e5" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
        </ComposedChart></ResponsiveContainer>}
      </div>
      <p className="cockpit-chart-note">按实际报工 / 检验日期统计，含跨月生产单。最终闸门未接入，暂不绘制完工曲线。</p>
    </section>
    <section className="cockpit-card cockpit-quality" aria-label="今日生产质量">
      <div className="cockpit-section-title"><h2><TriangleAlert size={18} aria-hidden="true" />今日终检不良分布</h2><span>{statistics?.today.date.slice(5) || currentDate.slice(5)} · 台</span></div>
      <div className="cockpit-defect-chart" role="img" aria-label={!statistics ? message : defects.length ? defects.map(row => row.process + '不良 ' + number(row.quantity) + ' 台').join('；') : '今日暂无首次终检不良记录'}>
        {!statistics ? <p className="cockpit-chart-empty" role="status">{message}</p> : !defects.length ? <p className="cockpit-chart-empty">{first?.quantity ? '今日首次终检未记录不良' : '今日暂无首次终检记录'}</p> : <ResponsiveContainer width="100%" height="100%"><BarChart data={defects} margin={{ top: 18, right: 10, left: -28, bottom: 0 }} accessibilityLayer>
          <CartesianGrid stroke="#e7edf6" strokeDasharray="3 4" vertical={false} />
          <XAxis dataKey="process" axisLine={false} tickLine={false} tick={{ fill: '#647491', fontSize: 11 }} tickFormatter={value => value.length > 6 ? value.slice(0, 6) + '…' : value} />
          <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: '#647491', fontSize: 11 }} />
          <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => [number(value) + ' 台', '首次终检不良']} cursor={{ fill: '#f5f8fd' }} />
          <Bar dataKey="quantity" maxBarSize={58} radius={[4, 4, 0, 0]} label={{ position: 'top', fill: '#23375d', fontSize: 13 }} isAnimationActive={false}>{defects.map((row, index) => <Cell key={row.process} fill={colors[index % colors.length]} />)}</Bar>
        </BarChart></ResponsiveContainer>}
      </div>
      <div className="cockpit-pass-rate"><ShieldCheck size={30} aria-hidden="true" /><div><h3>今日终检一次合格率</h3><strong>{first?.firstPassRate == null ? '—' : first.firstPassRate.toFixed(1) + '%'}<small>{first ? '(' + number(first.goodQty) + ' / ' + number(first.quantity) + ' 台)' : '暂无统计'}</small></strong></div></div>
      <p className="cockpit-chart-note">仅整机首次终检；复验不改写首次结果，不混入组件及过程检。</p>
    </section>
  </div>;
}
