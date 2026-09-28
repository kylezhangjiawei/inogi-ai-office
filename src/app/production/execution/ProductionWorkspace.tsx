import { useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ArrowLeft, CalendarDays, Plus, RefreshCw } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Skeleton } from '../../components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { HorizonPageHeader } from '../../components/horizon/HorizonPage';
import { usePermission } from '../../hooks/usePermission';
import { useAuth } from '../../auth';
import { useI18n } from '../../lib/i18n';
import { listExecutionPlans, type ExecutionPlan } from '../../lib/productionExecutionApi';
import type { QualityRecord } from '../../lib/procurementOperationsApi';
import { QualityVerificationDialog } from '../../procurement/components/QualityVerificationDialog';
import { LifecyclePanel } from './LifecyclePanel';
import { ReadinessPanel } from './ReadinessPanel';
import { ProductionEmpty, ProductionMetrics } from './ProductionView';
import { ProductionBatchList, ProductionInspectionList, ProductionPlanHistory, ProductionPlanList, ProductionTaskList } from './ProductionLists';
import { ProductionScenarioPanel } from './ProductionScenarioPanel';
import { ProductionSchedule } from './ProductionSchedule';
import { QualityRecordsPanel } from '../../procurement/quality/QualityRecordsPanel';
import { ProductionFieldIssueDialog } from './ProductionFieldIssueDialog';
import { ProductionTaskDetail } from './ProductionTaskDetail';
import { productionQuery } from './productionViewState';
import type { Editor } from './ProductionExecutionPage';

export type ProductionEditorProps = { editor: Editor; plan?: ExecutionPlan; month: string; onClose: () => void; onSaved: (id: string) => void };
const views = [['batches', '批次与派工'], ['schedule', '生产日程'], ['tasks', '现场作业'], ['inspections', '生产检验'], ['quality', '质量闭环'], ['readiness', '齐套与占用'], ['transfer', '转产与 ECN'], ['shipments', '放行与发货'], ['archive', '批次档案'], ['history', '进展留痕']];
const qty = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 3 });
const detailKeys = { task: null, inspection: null, taskSection: null, taskFrom: null, record: null, recordType: null };

type WorkspaceProps = { renderEditor: (props: ProductionEditorProps) => ReactNode; actionLabels: Record<string, string> };
export function ProductionWorkspace(props: WorkspaceProps) {
  const { user } = useAuth();
  return <ProductionWorkspaceContent key={`${user?.id ?? ''}:${user?.permissions?.join(',') ?? ''}`} {...props} />;
}

function ProductionWorkspaceContent({ renderEditor, actionLabels }: WorkspaceProps) {
  const { t } = useI18n(), { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(params.get('month') || '') ? params.get('month')! : new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 7);
  const [plans, setPlans] = useState<ExecutionPlan[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState(''), [reload, setReload] = useState(0);
  const [editor, setEditor] = useState<Editor | null>(null), [verification, setVerification] = useState<QualityRecord | null>(null);
  const canPlan = usePermission('production:plan'), canReport = usePermission('proc-production:report'), canInspect = usePermission('production:inspect');
  const canPublishBom = usePermission('bom:publish');
  const canReadBomMaterials = usePermission('page:proc-materials'), canReadBomCockpit = usePermission('page:proc-cockpit'), canReadBomReadiness = usePermission('page:proc-inventory-readiness');
  const canReviewBom = canPublishBom && (canReadBomMaterials || canReadBomCockpit || canReadBomReadiness);
  const canManageQuality = usePermission('proc-quality:manage'), canVerify = usePermission('proc-quality:verify'), canViewAll = usePermission('production:view-all');
  const canCollaborate = usePermission('proc-quality:collaborate'), canWarehouse = usePermission('page:warehouse-flow');
  const canReadReadiness = canPlan || canInspect || canViewAll;
  const requestedPlanId = params.get('plan'), requestedTaskId = params.get('task'), requestedView = params.get('view');
  const plan = plans.find(row => row.id === requestedPlanId);
  const task = plan?.tasks.find(row => row.id === requestedTaskId);
  const view = views.some(([key]) => key === requestedView && (key !== 'readiness' || canReadReadiness)) ? requestedView! : 'batches';
  const actorKey = `${user?.id ?? ''}:${user?.permissions?.join(',') ?? ''}`;
  useEffect(() => { setEditor(null); setVerification(null); }, [requestedPlanId, requestedTaskId, actorKey]);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setPlans([]); setError(''); setEditor(null); setVerification(null);
    listExecutionPlans(month, controller.signal).then(value => { if (!controller.signal.aborted) setPlans(value); }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : t('计划读取失败')); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [month, reload, t, actorKey]);
  const allPlansHref = `?${productionQuery(params, { plan: null, view: null, batch: null, ...detailKeys })}`;
  const taskFrom = ['schedule', 'inspections'].includes(params.get('taskFrom') || '') ? params.get('taskFrom')! : 'tasks';
  const backLabel = taskFrom === 'schedule' ? '返回生产日程' : taskFrom === 'inspections' ? '返回生产检验' : '返回作业列表';
  const backToTasksHref = `?${productionQuery(params, { view: taskFrom, ...detailKeys })}`;
  const lifecycleView = ['transfer', 'shipments', 'archive'].includes(view) ? view as 'transfer' | 'shipments' | 'archive' : null;
  const isRecordDetail = Boolean(lifecycleView && params.get('record'));
  const isScenario = !requestedPlanId && requestedView === 'scenario' && canReadReadiness;
  return <main className="production-page execution-page">
    {plan?.bomRetiredAt && <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{t('该版本已停用，仅保留历史核算，不可用于新计划。')} · BOM V{plan.bomVersion}</p>}
    {requestedPlanId && <nav className="flex flex-wrap items-center gap-x-4 gap-y-1" aria-label="生产页面路径"><Link className="production-back" to={requestedTaskId ? backToTasksHref : allPlansHref}><ArrowLeft className="size-3.5" aria-hidden="true" />{requestedTaskId ? backLabel : '返回计划列表'}</Link>{requestedTaskId && <Link className="production-back" to={allPlansHref}>全部计划</Link>}</nav>}
    <HorizonPageHeader Icon={CalendarDays} eyebrow={task ? '现场作业详情' : plan ? '生产计划详情' : '质量与生产'} title={requestedTaskId ? task?.name || '作业详情' : plan ? `${plan.productName} · ${plan.productLine}` : '生产计划与执行'} description={plan ? `${plan.month} 月度计划${plan.carryover ? ' · 跨月未完' : ''}` : '选择月度计划，查看批次安排与现场进度。'} actions={<><Button variant="outline" disabled={loading} onClick={() => setReload(value => value + 1)}><RefreshCw className="size-4" aria-hidden="true" />刷新</Button>{canReadReadiness && !requestedPlanId && !isScenario && <Button variant="outline" asChild><Link to={`?${productionQuery(params, { view: 'scenario', plan: null, ...detailKeys })}`}>草稿情景试算</Link></Button>}{canPlan && !requestedPlanId && !isScenario && <Button disabled={loading || !!error} onClick={() => setEditor({ action: 'create' })}><Plus className="size-4" aria-hidden="true" />月度计划</Button>}{canPlan && plan && !requestedTaskId && !isRecordDetail && <Button variant="outline" onClick={() => setEditor({ action: 'targets' })}>调整目标</Button>}</>} />
    {!requestedPlanId && <label className="flex w-fit max-w-full flex-wrap items-center gap-3 text-sm text-muted-foreground">计划月份<Input className="w-44" type="month" value={month} onChange={event => { if (event.target.value) setParams(previous => productionQuery(previous, { month: event.target.value, planPage: null, ...detailKeys })); }} /></label>}
    {error ? <section className="production-surface p-5" role="alert"><p className="text-sm text-destructive">{error}</p><Button className="mt-3" variant="outline" onClick={() => setReload(value => value + 1)}>重新加载</Button></section> : loading ? <div role="status" aria-label="加载生产计划" className="space-y-4"><Skeleton className="h-24 w-full rounded-2xl" /><Skeleton className="h-72 w-full rounded-2xl" /></div> : isScenario ? <><Button className="w-fit" variant="outline" asChild><Link to={`?${productionQuery(params, { view: null, ...detailKeys })}`}>返回正式计划</Link></Button><ProductionScenarioPanel month={month} /></> : !requestedPlanId ? <ProductionPlanList plans={plans} onCreate={canPlan ? () => setEditor({ action: 'create' }) : undefined} /> : !plan ? <section className="production-surface"><ProductionEmpty title="所选计划不存在或无权查看" description="返回计划列表，重新选择当前可见的月度计划。"><Button variant="outline" asChild><Link to={allPlansHref}>返回计划列表</Link></Button></ProductionEmpty></section> : requestedTaskId ? task ? <ProductionTaskDetail task={task} plan={plan} userId={user?.id} permissions={{ canPlan, canReport, canInspect, canWarehouse, canManageQuality, canVerify, canCollaborate }} onEdit={setEditor} onVerify={setVerification} onSaved={() => setReload(value => value + 1)} /> : <section className="production-surface"><ProductionEmpty title="该作业不存在或无权查看"><Button variant="outline" asChild><Link to={backToTasksHref}>返回作业列表</Link></Button></ProductionEmpty></section> : <>
      {!isRecordDetail && <ProductionMetrics items={[{ label: '月度生产目标', value: `${qty(plan.targetQty)} 台` }, { label: '月度发货目标', value: `${qty(plan.shipmentTargetQty)} 台` }, { label: '已分批数量', value: `${qty(plan.summary.batchQty)} 台` }, { label: '整机检验合格', value: `${qty(plan.summary.completedQty)} 台` }]} />}
      {!plan.bomRevisionId && <section className="production-surface flex flex-wrap items-center justify-between gap-3 p-4"><div className="space-y-1 text-sm"><h2 className="font-semibold">{plan.basisVerified ? '历史执行依据已核对' : '历史执行依据待核对'}</h2><p className="text-muted-foreground">{plan.basisVerified ? `${plan.legacyBasisReview?.actorName} · ${plan.legacyBasisReview?.reason}；保留原用料快照。` : '未核对前不能新增或扩大派工；原已派发作业可继续报工、检验及退料。'}</p></div>{canPlan && canReviewBom ? <Button variant="outline" onClick={() => setEditor({ action: 'review-basis' })}>核对历史依据</Button> : <p className="text-sm text-muted-foreground">请联系同时具备计划办理和 BOM 发布权限的人员。</p>}</section>}
      {Number(plan.summary.legacyCompletedQty) > 0 && <p className="production-note">整机检验合格数包含 {qty(plan.summary.legacyCompletedQty!)} 台历史未分类记录；首次终检统计仅包含明确标记的终检。</p>}
      {plan.scope === 'assigned' && <p className="production-note">目标为计划整体目标；作业、已分批数量和检验合格数仅包含您有权查看的记录。</p>}
      {isRecordDetail && lifecycleView ? <LifecyclePanel key={plan.id} plan={plan} view={lifecycleView} /> : <Tabs value={view} onValueChange={value => setParams(previous => productionQuery(previous, { view: value, ...detailKeys }))} className="gap-4"><div className="flex flex-wrap items-center justify-between gap-3"><div className="production-tabs"><TabsList aria-label="生产流程">{views.filter(([key]) => key !== 'readiness' || canReadReadiness).map(([key, label]) => <TabsTrigger key={key} value={key}>{label}</TabsTrigger>)}</TabsList></div>{canPlan && view === 'batches' && <Button onClick={() => setEditor({ action: 'batch' })}><Plus className="size-4" aria-hidden="true" />生产批次</Button>}</div>
        <TabsContent value="batches"><ProductionBatchList plan={plan} onCreateTask={canPlan ? batchId => setEditor({ action: 'task', batchId }) : undefined} /></TabsContent>
        <TabsContent value="tasks"><ProductionTaskList plan={plan} /></TabsContent>
        <TabsContent value="schedule"><ProductionSchedule plan={plan} /></TabsContent>
        <TabsContent value="inspections"><ProductionInspectionList plan={plan} /></TabsContent>
        <TabsContent value="quality"><section className="production-surface p-4"><QualityRecordsPanel records={plan.tasks.flatMap(task => [...task.inspections.flatMap(row => row.quality ? [row.quality] : []), ...(task.fieldIssues ?? []).flatMap(row => row.quality ? [row.quality] : [])])} onSaved={() => setReload(value => value + 1)} /></section></TabsContent>
        {canReadReadiness && <TabsContent value="readiness"><ReadinessPanel key={plan.id} plan={plan} /></TabsContent>}
        {(['transfer', 'shipments', 'archive'] as const).map(key => <TabsContent value={key} key={key}><LifecyclePanel key={plan.id} plan={plan} view={key} /></TabsContent>)}
        <TabsContent value="history"><ProductionPlanHistory plan={plan} actionLabels={actionLabels} /></TabsContent>
      </Tabs>}
    </>}
    {verification && <QualityVerificationDialog key={verification.id} record={verification} canVerify={canVerify} onClose={() => setVerification(null)} onSaved={() => { setVerification(null); setReload(value => value + 1); }} />}
    {editor?.action === 'field-issue' && plan && editor.task && <ProductionFieldIssueDialog task={editor.task} plan={plan} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); setReload(value => value + 1); }} />}
    {editor && editor.action !== 'field-issue' && renderEditor({ editor, plan, month, onClose: () => setEditor(null), onSaved: id => { setEditor(null); setParams(previous => productionQuery(previous, { plan: id, ...(editor.action === 'create' ? { view: 'batches', ...detailKeys } : {}) })); setReload(value => value + 1); } })}
  </main>;
}
