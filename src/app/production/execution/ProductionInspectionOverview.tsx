import { Link, useSearchParams } from 'react-router';
import { ClipboardCheck, CircleCheck, CircleX, Percent, Search } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { NativeSelect } from '../../components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { usePermission } from '../../hooks/usePermission';
import type { ExecutionPlan, ExecutionTask } from '../../lib/productionExecutionApi';
import type { QualityRecord } from '../../lib/procurementOperationsApi';
import { ProductionEmpty, ProductionPagination, ProductionStatus } from './ProductionView';
import { firstFinalInspection, inspectionKind, inspectionKindLabel } from './productionInspectionModel';
import { productionPage, productionPendingInspection, productionQuery, productionSearch } from './productionViewState';
import { routePath } from '../../lib/routePaths';
import './prototype-execution.css';
import './production-inspection-links.css';

const qty = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 3 });

/** P03 uses only authorized production records; gate, IQC and reinspection are not invented. */
export function ProductionInspectionOverview({ plans, onVerify }: { plans: ExecutionPlan[]; onVerify: (quality: QualityRecord) => void }) {
  const [params, setParams] = useSearchParams();
  const canInspect = usePermission('production:inspect'), canVerify = usePermission('proc-quality:verify');
  const canOrders = usePermission('page:purchase-orders'), canWarehouse = usePermission('page:warehouse-flow');
  const incoming = params.get('inspectionScope') === 'incoming';
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const date = params.get('qualityDate') === 'all' ? '' : params.get('qualityDate') || today;
  const kind = params.get('qualityKind') || 'all', search = params.get('qualityQ') || '';
  const batchId = params.get('batch') || 'all';
  const batches = plans.flatMap(plan => plan.batches.map(batch => ({ ...batch, model: plan.productLine })));
  const staleBatch = batchId !== 'all' && !batches.some(batch => batch.id === batchId);
  const tasks = plans.flatMap(plan => plan.tasks.map(task => ({ plan, task })))
    .filter(({ plan, task }) => (batchId === 'all' || task.batchId === batchId) && productionSearch(search, [plan.productLine, task.name, task.line, task.ownerName, plan.batches.find(batch => batch.id === task.batchId)?.code]));
  const firstFinal = firstFinalInspection(tasks.filter(({ task }) => task.output === 'whole' && task.unit === '台').flatMap(({ task }) => task.inspections), date || undefined);
  const pending = tasks.filter(({ task }) => task.status === 'dispatched' && productionPendingInspection(task) > 0)
    .sort((a, b) => (a.task.date || '9999').localeCompare(b.task.date || '9999'));
  const pendingPage = productionPage(pending, params.get('qualityPendingPage'), 5);
  const inspections = tasks.flatMap(({ plan, task }) => task.inspections.map(inspection => ({ plan, task, inspection })))
    .filter(({ inspection }) => (!date || inspection.date === date) && (kind === 'all' || inspectionKind(inspection) === kind))
    .sort((a, b) => b.inspection.date.localeCompare(a.inspection.date));
  const page = productionPage(inspections, params.get('qualityPage'), 6);
  const quality = [...new Map(tasks.flatMap(({ plan, task }) => [...task.inspections, ...(task.fieldIssues || [])]
    .flatMap(row => row.quality && row.quality.status !== 'closed' ? [[row.quality.id, { plan, task, quality: row.quality }] as const] : []))).values()];
  const qualityPage = productionPage(quality, params.get('qualityOpenPage'), 4);
  const filter = (key: string, value: string) => setParams(previous => productionQuery(previous, { [key]: value, qualityPage: null, qualityPendingPage: null, qualityOpenPage: null }), { replace: true });
  const href = (plan: ExecutionPlan, task: ExecutionTask, inspection?: string) => `?${productionQuery(params, { plan: plan.id, task: task.id, view: 'tasks', taskSection: 'quality', taskFrom: 'inspections', inspection: inspection || null, workbench: params.has('plan') ? null : 'inspections' })}`;
  const dateLabel = !date ? '全部日期' : date === today ? '今日' : date;
  const cards = [
    { label: `${dateLabel}首次终检`, value: qty(firstFinal.quantity), unit: '台', Icon: ClipboardCheck, tone: 'blue' },
    { label: '首次合格', value: qty(firstFinal.goodQty), unit: '台', Icon: CircleCheck, tone: 'good' },
    { label: '首次不合格', value: qty(Math.max(0, firstFinal.quantity - firstFinal.goodQty)), unit: '台', Icon: CircleX, tone: 'bad' },
    { label: '一次合格率', value: firstFinal.rate === null ? '—' : `${firstFinal.rate.toFixed(1)}%`, unit: '', Icon: Percent, tone: 'blue' },
  ];
  const scopeNav = <div className="inspection-scope-tabs" role="group" aria-label="检验业务"><Button variant={!incoming ? 'default' : 'outline'} aria-pressed={!incoming} onClick={() => filter('inspectionScope', 'production')}>生产检验与复验</Button><Button variant={incoming ? 'default' : 'outline'} aria-pressed={incoming} onClick={() => filter('inspectionScope', 'incoming')}>原料检验 · S10</Button></div>;
  if (incoming) return <div className="production-inspection-overview">{scopeNav}<section className="production-surface incoming-inspection-entry" aria-labelledby="incoming-inspection-title"><div className="production-section-heading"><div><h2 id="incoming-inspection-title">原料检验</h2><p>按采购订单进入收货与检验，沿用仓库登记的原收货记录。</p></div><ProductionStatus tone="neutral">采购订单关联</ProductionStatus></div><ol className="incoming-inspection-steps"><li><strong>1 · 仓库登记到货</strong><p>登记实收数量、日期与附件，系统建立收货记录。</p></li><li><strong>2 · 质检提交结论</strong><p>按收货批次登记合格、不良与待判数量；不良自动关联质量异常。</p></li><li><strong>3 · 仓库分类接收</strong><p>合格入库、不良隔离，待判物料不计为合格可用。</p></li></ol><div className="incoming-inspection-actions">{canOrders ? <Button asChild><Link to={routePath('page:purchase-orders', '/purchase-orders')}>打开采购收货与检验</Link></Button> : <p>当前账号没有采购订单访问权限，请由授权质检人员办理。</p>}{canWarehouse && <Button asChild variant="outline"><Link to={routePath('page:warehouse-flow', '/warehouse-flow') + '?warehouseView=records'}>查看仓库入库记录</Link></Button>}</div><p className="incoming-inspection-boundary">计划员确认用途、需求日期与检验优先级的环节尚未接入；当前入口不代表已完成计划审批。原料检验数据不计入整机首次终检指标。</p></section></div>;
  return <div className="production-prototype production-inspection-overview" aria-label="生产检验与复验">
    {scopeNav}
    <div className="production-prototype-inspection-metrics">{cards.map(({ label, value, unit, Icon, tone }) => <article key={label} data-tone={tone}><Icon aria-hidden="true" /><div><h2>{label}</h2><strong>{value}<small>{unit}</small></strong></div></article>)}</div>
    <p className="production-note">上方统计整机首次终检（台）；检验类型筛选仅作用记录列表，复验不改变首次合格率。终检合格不代表最终闸门通过或 QA 放行。</p>
    <section className="production-surface" aria-label="检验筛选"><div className="production-toolbar"><div className="production-search-field"><Search className="size-4" aria-hidden="true" /><Input aria-label="搜索生产检验" placeholder="搜索任务、生产单或负责人" value={search} onChange={event => filter('qualityQ', event.target.value)} /></div><NativeSelect aria-label="检验记录类型" value={kind} onChange={event => filter('qualityKind', event.target.value)}><option value="all">全部检验类型</option><option value="process">过程检</option><option value="final">终检</option><option value="legacy">历史未分类</option></NativeSelect><NativeSelect aria-label="检验生产单" value={batchId} onChange={event => filter('batch', event.target.value)}><option value="all">全部生产单</option>{staleBatch && <option value={batchId}>生产单不在当前范围</option>}{batches.map(batch => <option key={batch.id} value={batch.id}>{batch.code} · {batch.model}</option>)}</NativeSelect><label>检验日期<Input aria-label="生产检验日期" type="date" value={date} onChange={event => filter('qualityDate', event.target.value || 'all')} /></label>{date && <Button variant="ghost" size="sm" onClick={() => filter('qualityDate', 'all')}>全部日期</Button>}</div></section>
    {staleBatch && <p className="production-inline-error" role="status">原生产单不在当前计划范围内。<Button variant="link" onClick={() => filter('batch', 'all')}>查看全部生产单</Button></p>}
    <div className="production-prototype-inspection-grid"><div className="production-prototype-inspection-main">
      <section className="production-surface" aria-labelledby="inspection-pending-title"><div className="production-section-heading"><div><h2 id="inspection-pending-title">待终检任务</h2><p>已报工尚未完成终检，包含跨日、跨月未检任务。</p></div><span className="production-result-count">{pending.length} 项</span></div>{!pending.length ? <ProductionEmpty title="当前范围没有待终检任务" description="已完成的检验可在下方记录中查阅。" /> : <Table className="production-table production-prototype-inspection-table"><TableHeader><TableRow>{['生产单 / 任务', '产线 / 负责人', '待终检', '计划日期', '操作'].map(label => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>{pendingPage.rows.map(({ plan, task }) => <TableRow key={task.id}><TableCell className="production-cell-main"><Link className="production-link" to={href(plan, task)}>{plan.batches.find(batch => batch.id === task.batchId)?.code || '生产单待确认'}</Link><p className="production-meta">{plan.productLine} · {task.name}</p></TableCell><TableCell>{task.line || '待确认'}<p className="production-meta">{task.ownerName || '待确认'}</p></TableCell><TableCell>{qty(productionPendingInspection(task))} {task.unit}</TableCell><TableCell>{task.date || '待安排'}{plan.carryover && <p className="production-meta">跨月未完</p>}</TableCell><TableCell><Button variant="outline" size="sm" asChild><Link to={href(plan, task)}>{canInspect ? '进入检验' : '查看任务'}</Link></Button></TableCell></TableRow>)}</TableBody></Table>}<ProductionPagination {...pendingPage} onPageChange={value => setParams(previous => productionQuery(previous, { qualityPendingPage: String(value) }))} /></section>
      <section className="production-surface" aria-labelledby="inspection-records-title"><div className="production-section-heading"><div><h2 id="inspection-records-title">检验与复验记录</h2><p>{dateLabel} · 复验数量来自原异常的验证记录。</p></div><span className="production-result-count">{inspections.length} 条</span></div>{!inspections.length ? <ProductionEmpty title="当前筛选范围暂无检验记录" description="可切换检验日期或类型，查看已有的过程检与终检。" /> : <Table className="production-table production-prototype-inspection-table"><TableHeader><TableRow>{['生产单 / 类型', '检验数量', '首次合格', '复验合格', '检验人 / 日期', '操作'].map(label => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>{page.rows.map(({ plan, task, inspection }) => <TableRow key={inspection.id}><TableCell className="production-cell-main"><Link className="production-link" to={href(plan, task, inspection.id)}>{plan.batches.find(batch => batch.id === task.batchId)?.code || '生产单待确认'}</Link><p className="production-meta">{inspectionKindLabel(inspection)} · {task.name}</p></TableCell><TableCell>{qty(inspection.quantity)} {task.unit}</TableCell><TableCell>{qty(inspection.goodQty)} {task.unit}</TableCell><TableCell>{qty(inspection.verifiedGoodQty || 0)} {task.unit}</TableCell><TableCell>{inspection.actorName}<p className="production-meta">{inspection.date}</p></TableCell><TableCell><Button variant="outline" size="sm" asChild><Link to={href(plan, task, inspection.id)}>查看检验</Link></Button></TableCell></TableRow>)}</TableBody></Table>}<ProductionPagination {...page} onPageChange={value => setParams(previous => productionQuery(previous, { qualityPage: String(value) }))} /></section>
    </div><aside className="production-prototype-inspection-side"><section className="production-surface"><div className="production-section-heading"><div><h2>不良处置与复验</h2><p>当前任务范围尚未关闭的质量异常</p></div><ProductionStatus tone={quality.length ? 'warning' : 'neutral'}>{quality.length} 项</ProductionStatus></div>{!quality.length ? <ProductionEmpty title="当前范围没有待处理异常" /> : <ul className="production-prototype-quality-list">{qualityPage.rows.map(({ plan, task, quality }) => <li key={quality.id}><div className="flex items-start justify-between gap-2"><Link className="production-link" to={href(plan, task)}>{quality.issue}</Link><ProductionStatus tone="warning">{quality.status === 'processing' ? '处理中' : '待处理'}</ProductionStatus></div><p>{plan.batches.find(batch => batch.id === task.batchId)?.code || '生产单待确认'} · {task.name}</p><dl><div><dt>不良数量</dt><dd>{qty(quality.defectiveQty)} {quality.unit}</dd></div><div><dt>当前协同人</dt><dd>{quality.collaboration?.ownerName || '未指定'}</dd></div></dl><Button size="sm" variant="outline" onClick={() => onVerify(quality)}>{canVerify ? '复验与记录' : '查看验证记录'}</Button></li>)}</ul>}<ProductionPagination {...qualityPage} onPageChange={value => setParams(previous => productionQuery(previous, { qualityOpenPage: String(value) }))} /></section><section className="production-surface production-prototype-boundary"><h2>检验衔接</h2><p>先完成不良处置，再在原异常登记复验结果；复验失败继续处理，全部数量验证完成后关闭。</p><p>原料检验从上方入口办理。性能测试和最终闸门尚未接入，当前不生成这两类待办。</p></section></aside></div>
  </div>;
}
