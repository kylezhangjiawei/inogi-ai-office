import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ArrowLeft, ClipboardList, Plus, RefreshCw } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { NativeSelect } from '../../components/ui/native-select';
import { Skeleton } from '../../components/ui/skeleton';
import { usePermission } from '../../hooks/usePermission';
import { useAuth } from '../../auth';
import { useI18n } from '../../lib/i18n';
import { listExecutionPlans, type ExecutionPlan } from '../../lib/productionExecutionApi';
import type { QualityRecord } from '../../lib/procurementOperationsApi';
import { QualityVerificationDialog } from '../../procurement/components/QualityVerificationDialog';
import { LifecyclePanel } from './LifecyclePanel';
import { ReadinessPanel } from './ReadinessPanel';
import { ProductionEmpty } from './ProductionView';
import { ProductionPlanHistory } from './ProductionLists';
import { ProductionScenarioPanel } from './ProductionScenarioPanel';
import { ProductionSchedule } from './ProductionSchedule';
import { ProductionWorkQueue } from './ProductionWorkQueue';
import { ProductionFieldIssueDialog } from './ProductionFieldIssueDialog';
import { ProductionTaskDetail } from './ProductionTaskDetail';
import { ProductionPlanningPage } from './ProductionPlanningPage';
import { ProductionInspectionOverview } from './ProductionInspectionOverview';
import { ProductionQualityPage } from './ProductionQualityPage';
import { ProductionAllTasks } from './ProductionAllTasks';
import { productionQuery } from './productionViewState';
import { routePath } from '../../lib/routePaths';
import type { Editor } from './ProductionExecutionPage';
import './production-prototype.css';
import './production-theme.css';

export type ProductionEditorProps = { editor: Editor; plan?: ExecutionPlan; month: string; onClose: () => void; onSaved: (id: string) => void };
const pages: Record<string, { code: string; title: string; description: string }> = {
  batches: { code: 'P01', title: '生产计划与派工', description: '编制组件与工序计划，确认产线、负责人及用料安排。' },
  schedule: { code: 'P07', title: '批次计划与工序安排', description: '按生产单查看日计划与各产线工序，调整安排并保留变更记录。' },
  tasks: { code: 'P02', title: '现场任务与不良登记', description: '选择派工任务，完成现场报工、不良登记与领料核对。' },
  inspections: { code: 'P03', title: '生产检验与复验', description: '区分过程检、首次终检和复验，沿原检验记录处理异常。' },
  quality: { code: 'P08', title: '生产不良处理', description: '跟踪现场与检验异常、协同处置及复验结果。' },
  collaboration: { code: 'P04', title: '生产问题协同', description: '对应生产问题转研发；按会议要求支持跨部门协助，跟进原异常回复与验证。' },
  transfer: { code: 'P05', title: '转产确认与批次档案', description: '核对转产依据、受控版本及未闭环问题，查看生产单档案。' },
  archive: { code: 'P05', title: '转产确认与批次档案', description: '按生产单追溯作业、检验、版本与交付记录。' },
  ecn: { code: 'P10', title: 'ECN 变更查看与确认', description: '查看变更内容与适用范围，完成岗位确认和执行反馈。' },
  'all-tasks': { code: 'P06', title: '生产全部任务', description: '汇总已接入的派工、待终检和不良任务，直接进入原业务办理。' },
  readiness: { code: 'P01', title: '用料与缺口', description: '核对生产用料、可用库存和到货依据。' },
  shipments: { code: 'P05', title: '质量放行与实际发货', description: '分别记录批次放行和实际发货，保留原始凭证。' },
  history: { code: 'P07', title: '计划变更记录', description: '查看原计划、派工和调整依据。' },
  scenario: { code: '辅助', title: '草稿情景试算', description: '独立辅助工具，不改变正式计划。' },
};
const mainPages = [['batches','生产计划与派工'],['tasks','现场任务与不良登记'],['inspections','生产检验与复验'],['quality','生产不良处理'],['collaboration','生产问题协同'],['transfer','转产与批次档案']];
const planViews = ['batches','schedule','transfer','ecn','archive','readiness','shipments','history'];
const scopeKeys = Object.fromEntries(['batch','workQueueQ','workQueueModel','workQueueLine','workQueueScope','workQueuePage','inspectQueueQ','inspectQueueModel','inspectQueueLine','inspectQueueScope','inspectQueuePage','taskQ','taskStatus','qualityQ','scheduleDate','scheduleTask','dispatchBatch','dispatchTask','dispatchPage','dispatchLine','dispatchDate','dispatchQ','scheduleBatch','scheduleOwner','scheduleLine','schedulePage','scheduleStart','scheduleEnd','readinessBatch','allSelected','allPage','allLine','allQ','qualityPendingPage','qualityPage','qualityOpenPage'].map(key => [key, null]));
const detailKeys = { task: null, inspection: null, taskSection: null, taskFrom: null, record: null, recordType: null, quality: null };
export type ProductionEntry = { title: string; view: 'inspections' | 'archive' };
type WorkspaceProps = { entry?: ProductionEntry; renderEditor: (props: ProductionEditorProps) => React.ReactNode; actionLabels: Record<string, string> };
export function ProductionWorkspace(props: WorkspaceProps) {
  const { user } = useAuth();
  return <ProductionWorkspaceContent key={user?.id + ':' + user?.permissions?.join(',')} {...props} />;
}
function ProductionWorkspaceContent({ renderEditor, actionLabels, entry }: WorkspaceProps) {
  const { t } = useI18n(), { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(params.get('month') || '') ? params.get('month')! : new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 7);
  const [plans, setPlans] = useState<ExecutionPlan[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState(''), [reload, setReload] = useState(0);
  const [editor, setEditor] = useState<Editor | null>(null), [editorPlanId, setEditorPlanId] = useState<string | null>(null), [verification, setVerification] = useState<QualityRecord | null>(null);
  const canPlan = usePermission('production:plan'), canReport = usePermission('proc-production:report'), canInspect = usePermission('production:inspect');
  const canPublishBom = usePermission('bom:publish');
  const canReadBomMaterials = usePermission('page:proc-materials'), canReadBomCockpit = usePermission('page:proc-cockpit'), canReadBomReadiness = usePermission('page:proc-inventory-readiness');
  const canReviewBom = canPublishBom && (canReadBomMaterials || canReadBomCockpit || canReadBomReadiness);
  const canManageQuality = usePermission('proc-quality:manage'), canVerify = usePermission('proc-quality:verify'), canViewAll = usePermission('production:view-all');
  const canCollaborate = usePermission('proc-quality:collaborate'), canWarehouse = usePermission('page:warehouse-flow');
  const canReadReadiness = canPlan || canInspect || canViewAll;
  const requestedPlanId = params.get('plan'), requestedTaskId = params.get('task'), requestedView = params.get('view');
  const view = requestedView && pages[requestedView] && (!['readiness','scenario'].includes(requestedView) || canReadReadiness) ? requestedView : entry?.view || 'batches';
  const explicitPlan = plans.find(row => row.id === requestedPlanId);
  const model = explicitPlan?.productLine || params.get('planModel') || 'all', filteredPlans = plans.filter(row => model === 'all' || row.productLine === model);
  const plan = requestedPlanId ? plans.find(row => row.id === requestedPlanId) : planViews.includes(view) ? filteredPlans[0] : undefined;
  const task = plan?.tasks.find(row => row.id === requestedTaskId);
  const scopedPlans = requestedPlanId ? plan ? [plan] : [] : filteredPlans;
  const editorPlan = editorPlanId ? plans.find(row => row.id === editorPlanId) : undefined;
  const actorKey = user?.id + ':' + user?.permissions?.join(',');
  const recordType = params.get('recordType');
  const recordPage = ({ ecn: 'ecn', transfer: 'transfer', batch: 'archive', shipment: 'shipments' } as Record<string, string>)[recordType || ''];
  const page = pages[params.get('inspection') ? 'inspections' : params.get('record') && recordPage ? recordPage : requestedTaskId ? 'tasks' : view];
  const lifecycleView = ['transfer','ecn','shipments','archive'].includes(view) ? view === 'ecn' ? 'transfer' : view as 'transfer' | 'shipments' | 'archive' : null;
  const selectedRecord = Boolean(lifecycleView && params.get('record'));
  useEffect(() => { setEditor(null); setVerification(null); }, [requestedPlanId, requestedTaskId, actorKey]);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setPlans([]); setError(''); setEditor(null); setVerification(null);
    listExecutionPlans(month, controller.signal).then(value => { if (!controller.signal.aborted) setPlans(value); }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : t('计划读取失败')); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [month, reload, t, actorKey]);
  function openEditor(value: Editor, source?: ExecutionPlan) { setEditorPlanId(value.action === 'create' ? null : (source ?? plan)?.id ?? null); setEditor(value); }
  const pageHref = (next: string, keepPlan = false, leaveEntry = false) => (entry && leaveEntry ? routePath('page:production-execution', '/production-execution') : '') + '?' + productionQuery(params, { view: next, planModel: model === 'all' ? null : model, plan: keepPlan ? plan?.id ?? null : null, workbench: null, ...detailKeys });
  const taskFrom = ['schedule','inspections','batches','all-tasks'].includes(params.get('taskFrom') || '') ? params.get('taskFrom')! : 'tasks';
  const workbench = ['tasks','inspections','all-tasks'].includes(params.get('workbench') || '') ? params.get('workbench')! : null;
  const backToTasksHref = '?' + productionQuery(params, { view: taskFrom, ...(workbench && taskFrom !== 'schedule' ? { plan: null } : {}), ...detailKeys });
  const onEditorSaved = (id: string) => {
    const creating = editor?.action === 'create'; setEditor(null); setReload(value => value + 1);
    if (creating) setParams(previous => productionQuery(previous, { plan: id, planModel: null, view: 'batches', ...scopeKeys, ...detailKeys }));
  };
  return <main className="production-page execution-page production-prototype production-ui-theme">
    <header className="pp-page-heading"><div><h1>{entry && view === entry.view && !requestedTaskId && !selectedRecord ? entry.title : page.title}<span className="pp-page-code">{page.code}</span></h1><p>{page.description}</p></div><div className="pp-page-actions"><Button size="sm" variant="outline" asChild><Link to="/production-dashboard">生产总览</Link></Button><Button size="sm" variant="outline" asChild><Link to={pageHref('all-tasks', false, true)}><ClipboardList size={15} aria-hidden="true" />全部任务</Link></Button><Button size="sm" variant="outline" disabled={loading} onClick={() => setReload(value => value + 1)}><RefreshCw size={15} aria-hidden="true" />刷新</Button>{canPlan && view === 'batches' && !requestedTaskId && <Button size="sm" disabled={loading || !!error} onClick={() => openEditor({ action: 'create' })}><Plus size={15} aria-hidden="true" />新建月度计划</Button>}</div></header>
    <nav className="pp-main-nav" aria-label="生产原型页面">{mainPages.map(([key,label]) => {
      const active = key === view || key === 'batches' && ['schedule','readiness','history'].includes(view) || key === 'transfer' && ['ecn','archive','shipments'].includes(view);
      return <Link key={key} aria-current={active ? 'page' : undefined} to={pageHref(key, false, true)}>{label}</Link>;
    })}</nav>
    <div className="pp-context-bar"><label>计划月份<Input aria-label="计划月份" type="month" value={month} onChange={event => { if (event.target.value) setParams(previous => productionQuery(previous, { month: event.target.value, plan: null, planPage: null, ...scopeKeys, ...detailKeys })); }} /></label><NativeSelect aria-label="计划产品型号" value={model} onChange={event => setParams(previous => productionQuery(previous, { planModel: event.target.value === 'all' ? null : event.target.value, plan: null, ...scopeKeys, ...detailKeys }), { replace: true })}><option value="all">全部型号</option>{[...new Set(plans.map(row => row.productLine))].filter(Boolean).sort().map(value => <option key={value}>{value}</option>)}</NativeSelect><NativeSelect aria-label="当前生产计划" value={plan?.id || 'all'} onChange={event => setParams(previous => productionQuery(previous, { plan: event.target.value === 'all' ? null : event.target.value, ...scopeKeys, ...detailKeys }), { replace: true })}>{(!planViews.includes(view) || !filteredPlans.length) && <option value="all">{filteredPlans.length ? '全部计划' : '暂无计划'}</option>}{filteredPlans.map(row => <option key={row.id} value={row.id}>{row.productLine} · {row.month}{row.carryover ? ' · 跨月未完' : ''}</option>)}</NativeSelect>{plan && <span>{plan.productName}{plan.scope === 'assigned' ? ' · 仅授权作业' : ''}</span>}</div>
    {!requestedTaskId && !selectedRecord && ['batches','schedule','readiness','history'].includes(view) && <nav className="pp-sub-nav" aria-label="计划相关页面"><Link to={pageHref('batches',true)} aria-current={view === 'batches' ? 'page' : undefined}>P01 生产计划与派工</Link><Link to={pageHref('schedule',true)} aria-current={view === 'schedule' ? 'page' : undefined}>P07 批次计划与工序安排</Link>{canReadReadiness && <Link to={pageHref('readiness',true)} aria-current={view === 'readiness' ? 'page' : undefined}>用料与缺口</Link>}<Link to={pageHref('history',true)} aria-current={view === 'history' ? 'page' : undefined}>变更记录</Link></nav>}
    {!requestedTaskId && !selectedRecord && ['transfer','ecn','archive','shipments'].includes(view) && <nav className="pp-sub-nav" aria-label="转产与档案页面"><Link to={pageHref('transfer',true)} aria-current={view === 'transfer' ? 'page' : undefined}>P05 转产确认</Link><Link to={pageHref('archive',true)} aria-current={view === 'archive' ? 'page' : undefined}>P05 批次档案</Link><Link to={pageHref('ecn',true)} aria-current={view === 'ecn' ? 'page' : undefined}>P10 ECN 变更查看与确认</Link><Link to={pageHref('shipments',true)} aria-current={view === 'shipments' ? 'page' : undefined}>放行与发货</Link></nav>}
    {requestedTaskId && <nav className="flex flex-wrap gap-4" aria-label="生产页面路径"><Link className="production-back" to={backToTasksHref}><ArrowLeft size={14} aria-hidden="true" />{taskFrom === 'inspections' ? '返回生产检验' : taskFrom === 'all-tasks' ? '返回全部任务' : taskFrom === 'schedule' ? '返回生产日程' : taskFrom === 'batches' ? '返回生产计划' : '返回作业列表'}</Link><Link className="production-back" to={pageHref('tasks', false, true)}>全部现场任务</Link></nav>}
    {error ? <section className="production-surface p-5" role="alert"><p className="text-sm text-destructive">{error}</p><Button className="mt-3" variant="outline" onClick={() => setReload(value => value + 1)}>重新加载</Button></section> : loading ? <div role="status" aria-label="加载生产计划" className="space-y-4"><Skeleton className="h-24 w-full rounded-2xl" /><Skeleton className="h-72 w-full rounded-2xl" /></div> : requestedPlanId && !plan ? <section className="production-surface"><ProductionEmpty title="所选计划不存在或无权查看"><Button asChild variant="outline"><Link to={pageHref(view)}>返回当前页面</Link></Button></ProductionEmpty></section> : requestedTaskId ? task && plan ? <ProductionTaskDetail task={task} plan={plan} userId={user?.id} permissions={{ canPlan, canReport, canInspect, canWarehouse, canManageQuality, canVerify, canCollaborate }} onEdit={value => openEditor(value,plan)} onVerify={setVerification} onSaved={() => setReload(value => value + 1)} /> : <ProductionEmpty title="该作业不存在或无权查看" /> : view === 'scenario' ? <ProductionScenarioPanel month={month} /> : view === 'tasks' ? <ProductionWorkQueue plans={scopedPlans} /> : view === 'inspections' ? <ProductionInspectionOverview plans={scopedPlans} onVerify={setVerification} /> : view === 'quality' || view === 'collaboration' ? <ProductionQualityPage plans={scopedPlans} collaborationOnly={view === 'collaboration'} onEdit={(source,value) => openEditor(value,source)} onVerify={setVerification} onSaved={() => setReload(value => value + 1)} /> : view === 'all-tasks' ? <ProductionAllTasks plans={scopedPlans} /> : !plan ? <section className="production-surface"><ProductionEmpty title="当前范围暂无生产计划" description="可切换月份或型号，计划员也可先新建月度计划。">{canPlan && <Button onClick={() => openEditor({ action: 'create' })}>新建月度计划</Button>}</ProductionEmpty></section> : <>
      {plan.bomRetiredAt && <p role="status" className="pp-inline-notice">该 BOM 版本已停用，仅保留原生产记录。</p>}
      {!plan.bomRevisionId && <section className="pp-inline-notice"><span>{plan.basisVerified ? '历史执行依据已核对，保留原用料快照。' : '历史计划尚未核对执行依据，不能新增或扩大派工。'}</span>{canPlan && canReviewBom && <Button size="sm" variant="outline" onClick={() => openEditor({ action: 'review-basis' })}>核对历史依据</Button>}</section>}
      {view === 'batches' ? <><ProductionPlanningPage plan={plan} onEdit={openEditor} />{canPlan && <div className="pp-secondary-actions"><Button size="sm" variant="ghost" onClick={() => openEditor({ action: 'targets' })}>调整月度目标</Button></div>}</> : view === 'schedule' ? <ProductionSchedule plan={plan} prototype /> : view === 'readiness' ? <ReadinessPanel key={plan.id} plan={plan} /> : view === 'history' ? <ProductionPlanHistory plan={plan} actionLabels={actionLabels} /> : lifecycleView ? <LifecyclePanel key={plan.id + view} plan={plan} view={lifecycleView} section={view === 'ecn' ? 'ecn' : view === 'transfer' ? 'transfer' : undefined} /> : null}
    </>}
    {verification && <QualityVerificationDialog key={verification.id} record={verification} canVerify={canVerify} onClose={() => setVerification(null)} onSaved={() => { setVerification(null); setReload(value => value + 1); }} />}
    {editor?.action === 'field-issue' && editorPlan && editor.task && <ProductionFieldIssueDialog task={editor.task} plan={editorPlan} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); setReload(value => value + 1); }} />}
    {editor && editor.action !== 'field-issue' && renderEditor({ editor, plan: editorPlan, month, onClose: () => setEditor(null), onSaved: onEditorSaved })}
  </main>;
}
