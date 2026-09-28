import { Link, useSearchParams } from 'react-router';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { NativeSelect } from '../../components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import type { ExecutionPlan } from '../../lib/productionExecutionApi';
import { ProductionEmpty, ProductionPagination, ProductionStatus } from './ProductionView';
import { productionPage, productionQuery, productionSearch, productionTaskState } from './productionViewState';
import { firstFinalInspection, inspectionKind, inspectionKindLabel } from './productionInspectionModel';

const qty = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 3 });

export function ProductionPlanList({ plans, onCreate }: { plans: ExecutionPlan[]; onCreate?: () => void }) {
  const [params, setParams] = useSearchParams();
  const query = params.get('planQ') || '', scope = params.get('planScope') || 'all';
  const rows = plans.filter(plan => (scope === 'all' || (scope === 'carryover' ? plan.carryover : !plan.carryover)) && productionSearch(query, [plan.productName, plan.productLine, plan.month]));
  const page = productionPage(rows, params.get('planPage'));
  const filter = (key: string, value: string) => setParams(previous => productionQuery(previous, { [key]: value, planPage: null }), { replace: true });
  return <section className="production-surface"><div className="production-section-heading"><div><h2>月度计划</h2><p>先选择产品计划，再查看批次、作业和履约记录。</p></div></div><div className="production-toolbar"><Input aria-label="搜索生产计划" value={query} placeholder="搜索产品、型号或计划月份" onChange={event => filter('planQ', event.target.value)} /><NativeSelect aria-label="计划范围" value={scope} onChange={event => filter('planScope', event.target.value)}><option value="all">全部可见计划</option><option value="current">当月计划</option><option value="carryover">跨月未完</option></NativeSelect></div>
    {!rows.length ? <ProductionEmpty title={plans.length ? '没有匹配的计划' : '本月尚未确认生产计划'} description={plans.length ? '调整搜索或范围后重试。' : '确认生产与发货目标后，再建立批次。采购备货不会自动变成生产目标。'}>{!plans.length && onCreate && <Button onClick={onCreate}>确认月度计划</Button>}</ProductionEmpty> : <Table className="production-table"><TableHeader><TableRow>{['产品 / 型号', '计划月份', '生产目标', '发货目标', '批次 / 作业', '整机检验合格', '操作'].map(label => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>{page.rows.map(plan => {
      const href = `?${productionQuery(params, { plan: plan.id, view: 'batches', task: null, batch: null, record: null, recordType: null })}`;
      return <TableRow key={plan.id}><TableCell className="production-cell-main"><Link className="production-link" to={href}>{plan.productName}</Link><p className="production-meta">{plan.productLine}</p></TableCell><TableCell>{plan.month}{plan.carryover && <p className="production-meta">跨月未完</p>}</TableCell><TableCell>{qty(plan.targetQty)} 台</TableCell><TableCell>{qty(plan.shipmentTargetQty)} 台</TableCell><TableCell>{plan.batches.length} 批 / {plan.tasks.length} 项</TableCell><TableCell>{qty(plan.summary.completedQty)} 台{plan.scope === 'assigned' && <p className="production-meta">仅授权范围</p>}</TableCell><TableCell><Button variant="outline" size="sm" asChild><Link to={href}>查看计划</Link></Button></TableCell></TableRow>;
    })}</TableBody></Table>}<ProductionPagination {...page} onPageChange={value => setParams(previous => productionQuery(previous, { planPage: String(value) }))} /></section>;
}

export function ProductionBatchList({ plan, onCreateTask }: { plan: ExecutionPlan; onCreateTask?: (batchId: string) => void }) {
  const [params, setParams] = useSearchParams();
  const query = params.get('batchQ') || '';
  const rows = plan.batches.filter(batch => productionSearch(query, [batch.code, batch.dueDate]));
  const page = productionPage(rows, params.get('batchPage'));
  return <section className="production-surface"><div className="production-section-heading"><div><h2>批次与派工</h2><p>批次目标以整机计，组件作业数量保留各自单位。</p></div></div><div className="production-toolbar"><Input aria-label="搜索生产批次" value={query} placeholder="搜索批次或交期" onChange={event => setParams(previous => productionQuery(previous, { batchQ: event.target.value, batchPage: null }), { replace: true })} /></div>
    {!rows.length ? <ProductionEmpty title={plan.batches.length ? '没有匹配的批次' : '尚未拆分生产批次'} description="批次合计不能超过已确认的月度生产目标。" /> : <Table className="production-table"><TableHeader><TableRow>{['批次', '交期', '整机目标', '作业数', '待派工', '操作'].map(label => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>{page.rows.map(batch => {
      const tasks = plan.tasks.filter(task => task.batchId === batch.id);
      const href = `?${productionQuery(params, { view: 'tasks', batch: batch.id, task: null, taskPage: null })}`;
      return <TableRow key={batch.id}><TableCell className="production-cell-main"><Link className="production-link" to={href}>{batch.code}</Link></TableCell><TableCell>{batch.dueDate || '待确认'}</TableCell><TableCell>{qty(batch.quantity)} 台</TableCell><TableCell>{tasks.length} 项</TableCell><TableCell>{tasks.filter(task => task.status === 'draft').length} 项</TableCell><TableCell><div className="flex gap-2"><Button size="sm" variant="outline" asChild><Link to={href}>查看作业</Link></Button>{onCreateTask && <Button size="sm" variant="outline" onClick={() => onCreateTask(batch.id)}>编制作业</Button>}</div></TableCell></TableRow>;
    })}</TableBody></Table>}<ProductionPagination {...page} onPageChange={value => setParams(previous => productionQuery(previous, { batchPage: String(value) }))} /></section>;
}

export function ProductionTaskList({ plan }: { plan: ExecutionPlan }) {
  const [params, setParams] = useSearchParams();
  const query = params.get('taskQ') || '', status = params.get('taskStatus') || 'all', batchId = params.get('batch') || 'all';
  const rows = plan.tasks.filter(task => (batchId === 'all' || task.batchId === batchId) && (status === 'all' || productionTaskState(task).key === status) && productionSearch(query, [task.name, task.line, task.ownerName, plan.batches.find(batch => batch.id === task.batchId)?.code]));
  const page = productionPage(rows, params.get('taskPage'));
  const filter = (key: string, value: string) => setParams(previous => productionQuery(previous, { [key]: value === 'all' ? null : value, taskPage: null }), { replace: true });
  return <section className="production-surface"><div className="production-section-heading"><div><h2>现场作业</h2><p>选中一项作业，查看领料、报工、检验与原异常。</p></div></div><div className="production-toolbar"><Input aria-label="搜索计划内作业" value={query} placeholder="搜索作业、产线或负责人" onChange={event => filter('taskQ', event.target.value)} /><NativeSelect aria-label="所属批次" value={batchId} onChange={event => filter('batch', event.target.value)}><option value="all">全部批次</option>{plan.batches.map(batch => <option key={batch.id} value={batch.id}>{batch.code}</option>)}</NativeSelect><NativeSelect aria-label="现场作业状态" value={status} onChange={event => filter('taskStatus', event.target.value)}><option value="all">全部状态</option>{[['draft', '待派工'], ['dispatched', '执行中'], ['inspection', '待终检'], ['quality', '质量待处理'], ['reported', '报工已齐'], ['cancelled', '已取消']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</NativeSelect></div>
    {!rows.length ? <ProductionEmpty title={plan.tasks.length ? '没有匹配的作业' : '还没有现场作业'} description={plan.tasks.length ? '调整搜索、批次或状态筛选。' : '先在批次中编制作业，确认派工后进入现场执行。'} /> : <Table className="production-table"><TableHeader><TableRow>{['作业 / 批次', '负责人 / 产线', '计划日期', '状态', '已报 / 目标', '报工良品', '下一步'].map(label => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>{page.rows.map(task => {
      const state = productionTaskState(task), href = `?${productionQuery(params, { view: 'tasks', task: task.id, taskSection: null, inspection: null })}`;
      const reported = task.reports.reduce((sum, row) => sum + row.quantity, 0), good = task.reports.reduce((sum, row) => sum + row.goodQty, 0);
      return <TableRow key={task.id}><TableCell className="production-cell-main"><Link className="production-link" to={href}>{task.name}</Link><p className="production-meta">{plan.batches.find(batch => batch.id === task.batchId)?.code || '批次待确认'} · {task.output === 'whole' ? '整机' : '组件'}</p></TableCell><TableCell>{task.ownerName || '待确认'}<p className="production-meta">{task.line || '产线待确认'}</p></TableCell><TableCell>{task.date || '待确认'}</TableCell><TableCell><ProductionStatus tone={['draft', 'quality', 'inspection'].includes(state.key) ? 'warning' : 'neutral'}>{state.label}</ProductionStatus></TableCell><TableCell>{qty(reported)} / {qty(task.quantity)} {task.unit}</TableCell><TableCell>{qty(good)} {task.unit}</TableCell><TableCell><Button size="sm" variant="outline" asChild><Link to={href}>{state.next}</Link></Button></TableCell></TableRow>;
    })}</TableBody></Table>}<ProductionPagination {...page} onPageChange={value => setParams(previous => productionQuery(previous, { taskPage: String(value) }))} /></section>;
}

export function ProductionInspectionList({ plan }: { plan: ExecutionPlan }) {
  const [params, setParams] = useSearchParams();
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const date = params.get('qualityDate') === 'all' ? '' : params.get('qualityDate') || today;
  const kind = params.get('qualityKind') || 'all', query = params.get('qualityQ') || '';
  const all = plan.tasks.filter(task => task.status !== 'cancelled').flatMap(task => task.inspections.map(inspection => ({ task, inspection })));
  const first = firstFinalInspection(all.filter(row => row.task.output === 'whole').map(row => row.inspection), date || undefined);
  const rows = all.filter(({ task, inspection }) => (!date || inspection.date === date) && (kind === 'all' || inspectionKind(inspection) === kind) && productionSearch(query, [task.name, task.line, task.ownerName, inspection.process, inspection.sip?.text, plan.batches.find(batch => batch.id === task.batchId)?.code])).sort((a, b) => b.inspection.date.localeCompare(a.inspection.date));
  const page = productionPage(rows, params.get('qualityPage'));
  const filter = (key: string, value: string) => setParams(previous => productionQuery(previous, { [key]: value, qualityPage: null }), { replace: true });
  return <section className="production-surface"><div className="production-section-heading"><div><h2>生产检验</h2><p>过程检、终检分开记录；复验沿用原异常，保留首次检验结果。</p></div></div>
    <div className="production-toolbar"><Input aria-label="搜索生产检验" value={query} placeholder="搜索作业、批次、工序或 SIP" onChange={event => filter('qualityQ', event.target.value)} /><label className="flex items-center gap-2 text-sm text-muted-foreground">检验日期<Input className="w-40" type="date" aria-label="生产检验日期" value={date} onChange={event => filter('qualityDate', event.target.value || 'all')} /></label><NativeSelect aria-label="生产检验类型" value={kind} onChange={event => filter('qualityKind', event.target.value)}><option value="all">全部类型</option><option value="process">过程检</option><option value="final">终检</option><option value="legacy">历史未分类初检</option></NativeSelect></div>
    <div className="px-5 pb-4 text-sm"><strong>{date ? '当日' : '全部日期'}整机首次终检合格率 {first.rate === null ? '—' : `${first.rate.toFixed(1)}%`}</strong><span className="ml-3 text-muted-foreground">{qty(first.goodQty)} / {qty(first.quantity)} 台；仅明确标记的整机终检，复验与过程检不改变分母。</span></div>
    {!rows.length ? <ProductionEmpty title="当前筛选下没有检验记录" description="调整日期、类型或搜索条件；历史未分类记录单独显示。" /> : <Table className="production-table"><TableHeader><TableRow>{['日期 / 类型', '作业 / 批次', '工序 / SIP', '首次合格 / 初检', '复验认可', '异常', '操作'].map(label => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>{page.rows.map(({ task, inspection }) => {
      const href = `?${productionQuery(params, { view: 'tasks', task: task.id, taskSection: 'quality', inspection: inspection.id, taskFrom: 'inspections' })}`;
      return <TableRow key={inspection.id}><TableCell>{inspection.date}<p className="production-meta">{inspectionKindLabel(inspection)}</p></TableCell><TableCell className="production-cell-main"><Link className="production-link" to={href}>{task.name}</Link><p className="production-meta">{plan.batches.find(batch => batch.id === task.batchId)?.code || '批次待确认'} · {task.output === 'whole' ? '整机' : '组件'}</p></TableCell><TableCell className="production-cell-note">{inspection.process || '历史未记录'}<p className="production-meta">{inspection.sip?.text || 'SIP 历史未记录'}</p></TableCell><TableCell>{qty(inspection.goodQty)} / {qty(inspection.quantity)} {task.unit}</TableCell><TableCell>{qty(inspection.verifiedGoodQty || 0)} {task.unit}</TableCell><TableCell><ProductionStatus tone={inspection.quality && inspection.quality.status !== 'closed' ? 'warning' : 'neutral'}>{inspection.quality ? inspection.quality.status === 'closed' ? '已验证关闭' : '待处置 / 验证' : '无异常'}</ProductionStatus></TableCell><TableCell><Button size="sm" variant="outline" asChild><Link to={href}>查看检验</Link></Button></TableCell></TableRow>;
    })}</TableBody></Table>}<ProductionPagination {...page} onPageChange={value => setParams(previous => productionQuery(previous, { qualityPage: String(value) }))} /></section>;
}

export function ProductionPlanHistory({ plan, actionLabels }: { plan: ExecutionPlan; actionLabels: Record<string, string> }) {
  const [params, setParams] = useSearchParams();
  const query = params.get('historyQ') || '';
  const page = productionPage([...plan.events].reverse().filter(row => productionSearch(query, [row.actorName, row.reason, actionLabels[row.action] || row.action])), params.get('historyPage'));
  return <section className="production-surface"><div className="production-section-heading"><h2>进展留痕</h2></div><div className="production-toolbar"><Input aria-label="搜索操作历史" value={query} placeholder="搜索操作、经办人或原因" onChange={event => setParams(previous => productionQuery(previous, { historyQ: event.target.value, historyPage: null }), { replace: true })} /></div>{!page.total ? <ProductionEmpty title="当前范围没有操作记录" /> : <Table className="production-table"><TableHeader><TableRow>{['时间', '操作', '经办人', '依据与原因'].map(label => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>{page.rows.map(event => <TableRow key={event.id}><TableCell>{new Date(event.at).toLocaleString()}</TableCell><TableCell>{actionLabels[event.action] || event.action}</TableCell><TableCell>{event.actorName}</TableCell><TableCell className="production-cell-note">{event.reason}</TableCell></TableRow>)}</TableBody></Table>}<ProductionPagination {...page} onPageChange={value => setParams(previous => productionQuery(previous, { historyPage: String(value) }))} /></section>;
}
