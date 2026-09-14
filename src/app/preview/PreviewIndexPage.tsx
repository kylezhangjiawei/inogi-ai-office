import { ArrowRight, PanelsTopLeft } from 'lucide-react';
import { Link } from 'react-router';
import { OrderPageHeader } from '../order-processing/components/HorizonPage';
import '../order-processing/horizon.css';
import './preview-index.css';

const groups: { title: string; items: [string, string, string, string][] }[] = [
  { title: '管理与供应链', items: [
    ['G00', '公司管理总览', 'company-overview', '部门风险、原单依据与跟进草稿'],
    ['S15', '月度齐套与历史预测', 'monthly-readiness', '整月剩余需求、日期预测与历史快照'],
    ['S18', '关键物料全量看板', 'key-materials', '31 条会议线索、正式料号与人工核对'],
  ] },
  { title: '生产流程', items: [
    ['P00', '生产管理总览', 'production-overview', '完工、分线安排、在岗与风险'],
    ['P01', '计划派工', 'production-planning', '生产目标、组件任务与人员安排'],
    ['P02', '现场报工', 'field-tasks', '现场任务、报工数量与过程记录'],
    ['P03', '生产检验与复验', 'production-inspections', '初检、复验与独立检验依据'],
    ['P04', '生产问题转研发', 'production-rd', '技术处理、补充资料与现场验证'],
    ['P05', '转产确认', 'production-transfer', '资料、试装与分岗位确认门槛'],
    ['P06', '生产全部任务', 'production-tasks', '原业务待办聚合与跨月未完'],
    ['P07', '批次日安排', 'production-planning?view=schedule', '按日期核对批次和组件安排'],
    ['P08', '生产不良处理', 'production-defects', '分派、整改、交检与关闭'],
    ['P09', '批次档案', 'batch-archives', '批次依据与过程追溯'],
    ['P10', 'ECN', 'ecn', '变更发布、适用范围与执行'],
  ] },
  { title: '仓库与质量衔接', items: [
    ['到货', '到货处置', 'receipt-disposition', '待验、合格、不良与处置记录'],
    ['质量', '质量异常处理', 'quality-exceptions', '原异常、整改与复验闭环'],
    ['仓库', '仓库作业', 'warehouse', '收货、入库、领退料与数量核对'],
    ['出货', '出货作业', 'shipments', '放行依据与实际出货记录'],
  ] },
];

export function PreviewIndexPage() {
  return <main className="order-horizon preview-index">
    <OrderPageHeader Icon={PanelsTopLeft} eyebrow="INOGI · 开发评审" title="业务页面预览" description="从流程入口进入页面，检查信息、操作和异常恢复。" />
    <p className="preview-index-note"><strong>前端演示</strong> 页面使用各自的演示数据；P04 与 P08 在同一浏览器会话共用原异常。刷新可能恢复样例。页面覆盖率与正式业务接通进度分别统计。</p>
    {groups.map(group => <section key={group.title} className="preview-index-section" aria-label={group.title}>
      <h2>{group.title}</h2>
      <div className="preview-index-links">{group.items.map(([code, title, path, description]) => <Link key={code} to={`/__preview/${path}`}>
        <span className="preview-index-code">{code}</span><div><h3>{title}</h3><p>{description}</p></div><ArrowRight size={17} aria-hidden="true" />
      </Link>)}</div>
    </section>)}
  </main>;
}
