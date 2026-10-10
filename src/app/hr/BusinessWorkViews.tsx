import React, { useState } from 'react';
import { Input } from '../components/ui/input';
import { HorizonSectionHeader } from '../components/horizon/HorizonPage';
import type { HrProps } from '../../mocks/hrPreview';
import { Badge, Notice } from './WorkViews';
import { scoreAverage } from './businessLogic';
import { CompetencyView, OrganizationView, PositionView } from './OrganizationBusinessViews';
import { AssetView, ExpenseView, MeetingView, RoomView } from './AdministrativeBusinessViews';
import './business.css';

const metrics = [
  { group: '公司业绩达成', name: '营业收入', unit: '元', formula: '统计月确认的营业收入', source: '财务收入台账' },
  { group: '公司业绩达成', name: '营业收入同比增长率', unit: '%', formula: '（本期营业收入 − 上年同期）÷ 上年同期；分母为 0 时不计算', source: '本期与上年同期财务数据' },
  { group: '公司业绩达成', name: '营业收入目标完成率', unit: '%', formula: '本期营业收入 ÷ 本期收入目标', source: '财务收入与经营目标' },
  { group: '公司业绩达成', name: '净利润', unit: '元', formula: '统计月税后净利润', source: '财务利润表' },
  { group: '公司业绩达成', name: '净利润同比增长率', unit: '%', formula: '（本期净利润 − 上年同期）÷ 上年同期绝对值；分母为 0 时不计算', source: '本期与上年同期利润表；负基期口径待确认' },
  { group: '公司业绩达成', name: '净利润目标完成率', unit: '%', formula: '本期净利润 ÷ 本期利润目标；目标为 0 时不计算', source: '财务利润与经营目标' },
  { group: '人效分析', name: '员工人数', unit: '人', formula: '当月员工名册人数；当前仅有 2026-10 演示快照', source: '员工档案演示快照' },
  { group: '人效分析', name: '人均营业收入', unit: '元/人', formula: '营业收入 ÷ 当月平均在职人数', source: '财务收入与员工月均人数' },
  { group: '人效分析', name: '人均净利润', unit: '元/人', formula: '净利润 ÷ 当月平均在职人数', source: '财务利润与员工月均人数' },
  { group: '人效分析', name: '人均净利润同比', unit: '%', formula: '（本期人均净利润 − 上年同期）÷ 上年同期绝对值', source: '本期与上年同期利润、人数组合数据' },
  { group: '人效分析', name: '人力成本效率', unit: '倍', formula: '营业收入 ÷ 人力成本（建议口径，待财务确认）', source: '收入与完整人力成本' },
  { group: '人效分析', name: '人力成本利润效率', unit: '倍', formula: '净利润 ÷ 人力成本（建议口径，待财务确认）', source: '利润与完整人力成本' },
  { group: '人效分析', name: '人力成本含量', unit: '%', formula: '人力成本 ÷ 总成本（建议口径，待财务确认）', source: '人力成本及总成本台账' },
  { group: '薪酬分析', name: '人力成本', unit: '元', formula: '工资、奖金、单位承担社保公积金及其他约定人力支出', source: '薪酬与财务成本台账；范围待确认' },
  { group: '薪酬分析', name: '人力成本同比', unit: '%', formula: '（本期人力成本 − 上年同期）÷ 上年同期', source: '本期与上年同期人力成本' },
  { group: '薪酬分析', name: '人均薪酬成本', unit: '元/人', formula: '薪酬成本 ÷ 当月平均在职人数', source: '薪酬成本与员工月均人数' },
  { group: '薪酬分析', name: '人力成本占营业收入比', unit: '%', formula: '人力成本 ÷ 营业收入', source: '人力成本与财务收入' },
  { group: '薪酬分析', name: '人力成本占毛利比', unit: '%', formula: '人力成本 ÷ 毛利；毛利小于等于 0 时单独说明', source: '人力成本与财务毛利' },
];

function DashboardView({ p }: { p: HrProps }) {
  const [month, setMonth] = useState('2026-10');
  const performance = p.all.performance.filter(row => row.fields['考核月份'] === month);
  const self = scoreAverage(performance, '自评分');
  const manager = scoreAverage(performance, '上级评分');
  const departments = [...new Set([...p.all.org.map(row => row.title), ...p.all.archive.map(row => row.dept), ...performance.map(row => row.dept)])];
  return <><div className="hr-toolbar"><label className="hr-business-label">统计月份<Input aria-label="统计月份" type="month" value={month} onChange={event => { if (event.target.value) setMonth(event.target.value); }} /></label><Badge>演示数据 · 按来源展示</Badge></div><div className="hr-dashboard-grid"><section className="hr-panel"><HorizonSectionHeader title="人员与招聘" description="人员与需求为 2026-10 会话快照；其他月份缺少完整历史快照。" /><div className="hr-number-grid">{[['员工人数', p.all.archive.length], ['招聘需求', p.all.req01.length], ['待复核候选人', p.all.resume.filter(row => row.status === '待复核').length], ['进行中任务', p.all.tasks.filter(row => row.status === '进行中').length]].map(([name, value]) => <div key={name}><span>{name}</span><strong>{month === '2026-10' ? value : '—'}</strong><small>{month === '2026-10' ? '当前演示快照' : '历史快照缺失'}</small></div>)}</div></section><section className="hr-panel"><HorizonSectionHeader title="全员绩效平均分" description="分别对已录入的有效自评、直属上级评分求算术平均；不代表最终考核结果。" /><div className="hr-number-grid"><div><span>全员自评平均分</span><strong>{self.average}</strong><small>有效自評 {self.count} 人 / 当月 {performance.length} 条</small></div><div><span>直属上级评平均分</span><strong>{manager.average}</strong><small>有效上级评 {manager.count} 人 / 当月 {performance.length} 条</small></div></div>{!performance.length && <Notice>该月份尚无绩效记录，可在绩效考核页面建立月份后返回查看。</Notice>}</section><section className="hr-panel hr-wide"><HorizonSectionHeader title="各部门绩效考核得分对比" description="同一统计月份内按部门聚合。空部门保留，不将缺失评分计作 0 分。" /><p className="hr-table-hint">左右滚动查看完整数据列。</p><div className="hr-table-scroll"><table className="hr-table"><thead><tr><th>部门</th><th>自评平均分 / 有效人数</th><th>直属上级评平均分 / 有效人数</th><th>当月考核人数</th></tr></thead><tbody>{departments.map(dept => {
    const rows = performance.filter(row => row.dept === dept);
    const selfScore = scoreAverage(rows, '自评分'), managerScore = scoreAverage(rows, '上级评分');
    return <tr key={dept}><td>{dept}</td><td><div className="hr-average-cell">{selfScore.average !== '—' && <meter min="0" max="100" value={Number(selfScore.average)} />}<strong>{selfScore.average}</strong><small>{selfScore.count} 人</small></div></td><td><div className="hr-average-cell">{managerScore.average !== '—' && <meter min="0" max="100" value={Number(managerScore.average)} />}<strong>{managerScore.average}</strong><small>{managerScore.count} 人</small></div></td><td>{rows.length || '—'}</td></tr>;
  })}</tbody></table></div></section>{['公司业绩达成', '人效分析', '薪酬分析'].map(group => <section className="hr-panel hr-wide" key={group}><HorizonSectionHeader title={group} description="每个指标独立展示取值、计算口径和来源状态；缺少来源时不推算金额。" /><p className="hr-table-hint">左右滚动查看完整数据列。</p><div className="hr-table-scroll"><table className="hr-table hr-metric-table"><thead><tr><th>指标</th><th>当月数值</th><th>统计口径</th><th>来源 / 接入状态</th></tr></thead><tbody>{metrics.filter(metric => metric.group === group).map(metric => {
    const hasSnapshot = metric.name === '员工人数' && month === '2026-10';
    return <tr key={metric.name}><td><strong>{metric.name}</strong><small>{metric.unit}</small></td><td>{hasSnapshot ? p.all.archive.length : '—'}</td><td>{metric.formula}</td><td>{metric.source}<small>{hasSnapshot ? '演示快照可用' : '来源数据缺失 · 待接入'}</small></td></tr>;
  })}</tbody></table></div></section>)}</div></>;
}

export function BusinessWorkViews({ p }: { p: HrProps }) {
  switch (p.module.id) {
    case 'dashboard': return <DashboardView p={p} />;
    case 'org': return <OrganizationView p={p} />;
    case 'position': return <PositionView p={p} />;
    case 'spec': return <CompetencyView p={p} />;
    case 'asset': return <AssetView p={p} />;
    case 'expense': return <ExpenseView p={p} />;
    case 'room': return <RoomView p={p} />;
    case 'meeting': return <MeetingView p={p} />;
    default: return null;
  }
}
