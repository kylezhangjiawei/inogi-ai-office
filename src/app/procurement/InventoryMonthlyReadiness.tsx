import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../auth';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { NativeSelect } from '../components/ui/native-select';
import { cn } from '../components/ui/utils';
import { useAnyPermission, usePermission } from '../hooks/usePermission';
import { i18nLocale, useI18n } from '../lib/i18n';
import { listExecutionPlans, type ExecutionPlan } from '../lib/productionExecutionApi';
import { commandProductionLifecycle, getProductionReadiness, type Readiness } from '../lib/productionLifecycleApi';
import { routePath } from '../lib/routePaths';
import { OperationalDialog, type OperationEditor } from '../production/execution/OperationalDialog';

type Props = { month: string; productLine: string; refreshVersion: number };
const quantity = (value: number) => value.toLocaleString(i18nLocale());
const endOfMonth = (month: string) => {
  const [year, number] = month.split('-').map(Number);
  return `${month}-${new Date(year, number, 0).getDate()}`;
};

export function InventoryMonthlyReadiness(props: Props) {
  const { t } = useI18n();
  const { user } = useAuth();
  const canView = usePermission('page:production-execution');
  const canRead = useAnyPermission('production:plan', 'production:view-all', 'production:inspect');
  return <section aria-label={t('月度计划与齐套评估')} className="order-4 min-w-0 rounded-[var(--radius-panel)] border border-border bg-card p-4 sm:p-5 xl:order-3">
    {canView && canRead ? <MonthlyPlans key={`${user?.id}:${props.month}:${props.productLine}:${props.refreshVersion}`} {...props} /> : <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1"><h2 className="text-balance text-base font-bold">{t('月度计划与齐套评估')}</h2><p className="text-pretty text-sm text-muted-foreground">{t('需要生产计划或全局查看权限；库存能力核算仍可使用。')}</p></div>}
  </section>;
}

function MonthlyPlans({ month, productLine }: Props) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [plans, setPlans] = useState<ExecutionPlan[] | null>(null);
  const [nextPlans, setNextPlans] = useState<ExecutionPlan[] | null>(null);
  const [error, setError] = useState('');
  const [nextError, setNextError] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [reload, setReload] = useState(0);
  const [year, number] = month.split('-').map(Number);
  const nextMonth = `${number === 12 ? year + 1 : year}-${String(number === 12 ? 1 : number + 1).padStart(2, '0')}`;
  useEffect(() => {
    const controller = new AbortController();
    setPlans(null); setNextPlans(null); setError(''); setNextError(false);
    const matching = (values: ExecutionPlan[], target: string) => values.filter(plan => plan.month === target && plan.productLine === productLine);
    void listExecutionPlans(month, controller.signal).then(values => {
      if (!controller.signal.aborted) setPlans(matching(values, month));
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : t('月度计划加载失败')); });
    void listExecutionPlans(nextMonth, controller.signal).then(values => {
      if (!controller.signal.aborted) setNextPlans(matching(values, nextMonth));
    }).catch(() => { if (!controller.signal.aborted) setNextError(true); });
    return () => controller.abort();
  }, [month, productLine, nextMonth, reload, t]);
  const plan = plans?.find(row => row.id === selectedId) ?? plans?.[0];
  const nextTarget = nextPlans?.length ? nextPlans.reduce((sum, row) => sum + row.targetQty, 0) : null;
  const nextCompleted = nextPlans?.length ? nextPlans.reduce((sum, row) => sum + row.summary.completedQty, 0) : null;
  const nextRemaining = nextPlans?.length ? nextPlans.reduce((sum, row) => sum + Math.max(0, row.targetQty - row.summary.completedQty), 0) : null;
  const nextValue = (value: number | null) => nextError ? t('暂不可用') : nextPlans === null ? t('加载中…') : value === null ? t('未确认') : `${quantity(value)} ${t('台')}`;
  return <>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1"><h2 className="text-balance text-base font-bold">{t('月度计划与齐套评估')}</h2><span className="text-pretty text-xs text-muted-foreground">{month} · {productLine} · {t('生产计划口径，不等同于出货目标')}</span></div>
      <Button type="button" variant="outline" size="sm" onClick={() => setReload(value => value + 1)}>{t('刷新月度数据')}</Button>
    </div>
    {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : plans === null ? <p role="status" className="mt-3 text-sm text-muted-foreground">{t('正在加载月度计划…')}</p> : !plan ? <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2"><p className="text-sm text-muted-foreground">{t('所选月份与型号暂无正式生产计划')}</p><Button type="button" variant="outline" size="sm" onClick={() => navigate(routePath('page:production-execution', '/production-execution') + `?${new URLSearchParams({ month })}`)}>{t('查看生产计划')}</Button></div> : <>
      <div className="mt-4 grid gap-4 border-b border-border pb-4 xl:grid-cols-[minmax(14rem,1fr)_2fr]">
        <label className="grid min-w-0 gap-1 text-xs font-semibold text-muted-foreground">{t('正式生产计划')}
          <NativeSelect aria-label={t('选择月度生产计划')} value={plan.id} onChange={event => setSelectedId(event.target.value)} className="h-11 w-full">
            {plans.map(row => <option key={row.id} value={row.id}>{row.productName} · {quantity(row.targetQty)} {t('台')} · {row.id.slice(-8)}</option>)}
          </NativeSelect>
          <span title={plan.bomFingerprint} className="mt-1 break-all font-normal">{t('计划版本 {version} · 冻结 BOM {bom}', { version: plan.version, bom: plan.bomFingerprint.slice(0, 12) })}</span>
        </label>
        <dl className="grid grid-cols-3 gap-2 sm:gap-4">
          <Metric label={t('整机计划')} value={plan.targetQty} unit={t('台')} />
          <Metric label={t('已完工')} value={plan.summary.completedQty} unit={t('台')} />
          <Metric label={t('本月剩余需求')} value={Math.max(0, plan.targetQty - plan.summary.completedQty)} unit={t('台')} prominent />
        </dl>
      </div>
      <div className="mt-4 flex items-center gap-3 text-xs text-muted-foreground">
        <span>{t('完工进度')}</span><progress aria-label={t('本月完工进度')} className="h-2 min-w-0 flex-1 accent-primary" max={Math.max(1, plan.targetQty)} value={Math.min(plan.targetQty, plan.summary.completedQty)} /><span className="tabular-nums">{plan.targetQty > 0 ? `${Math.round(Math.min(1, plan.summary.completedQty / plan.targetQty) * 100)}%` : '—'}</span>
      </div>
      <MonthlyAssessment key={`${plan.id}:${plan.version}:${reload}`} plan={plan} />
      <details className="mt-4 border-t border-border pt-3">
        <summary className="cursor-pointer py-1 text-sm font-semibold focus-visible:outline-primary">{t('本月及下月需求对比')}</summary>
        <p className="mt-2 text-pretty text-xs text-muted-foreground">{t('本月为所选计划；下月为同型号正式计划合计。没有计划不记为零，不包含待下单情景。')}</p>
        <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm tabular-nums"><thead className="bg-muted/50"><tr>{[t('项目'), month, nextMonth].map(label => <th key={label} scope="col" className="px-3 py-2 font-medium">{label}</th>)}</tr></thead><tbody>
          {[[t('计划需求'), plan.targetQty, nextTarget], [t('已完工'), plan.summary.completedQty, nextCompleted], [t('剩余需求'), Math.max(0, plan.targetQty - plan.summary.completedQty), nextRemaining]].map(([label, current, next]) => <tr key={String(label)} className="border-b border-border last:border-0"><th scope="row" className="px-3 py-2 font-medium">{label}</th><td className="px-3 py-2">{quantity(Number(current))} {t('台')}</td><td className="px-3 py-2">{nextValue(next as number | null)}</td></tr>)}
        </tbody></table></div>
      </details>
    </>}
  </>;
}

function Metric({ label, value, unit, prominent = false }: { label: string; value: number | null; unit: string; prominent?: boolean }) {
  const { t } = useI18n();
  return <div className={cn('min-w-0 rounded-lg p-3', prominent ? 'bg-primary/5' : 'bg-muted/40')}><dt className="text-xs text-muted-foreground">{label}</dt><dd className={cn('mt-2 break-words font-bold tabular-nums', value === null ? 'text-xl text-amber-700' : 'text-2xl sm:text-3xl', prominent && value !== null && 'text-primary')}>{value === null ? t('待核对') : quantity(value)}{value !== null && <span className="ml-1 text-xs font-medium text-muted-foreground">{unit}</span>}</dd></div>;
}

function MonthlyAssessment({ plan }: { plan: ExecutionPlan }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const canPlan = usePermission('production:plan');
  const [date, setDate] = useState(() => endOfMonth(plan.month));
  const [batchId, setBatchId] = useState('');
  const [snapshotId, setSnapshotId] = useState('');
  const [history, setHistory] = useState<Readiness['history']>([]);
  const [result, setResult] = useState<{ key: string; value: Readiness } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [reload, setReload] = useState(0);
  const [editor, setEditor] = useState<OperationEditor | null>(null);
  const requestKey = `${plan.id}:${plan.version}:${date}:${batchId}:${snapshotId}:${reload}`;
  useEffect(() => {
    const controller = new AbortController();
    void getProductionReadiness(plan.id, date, controller.signal, snapshotId, batchId).then(value => {
      if (controller.signal.aborted) return;
      if (value.planId !== plan.id || (value.batchId ?? '') !== batchId) throw new Error(t('返回的齐套范围不一致，请刷新后重试。'));
      setResult({ key: requestKey, value });
      if (!snapshotId) setHistory(value.history);
    }).catch(cause => { if (!controller.signal.aborted) setFailure({ key: requestKey, message: cause instanceof Error ? cause.message : t('月度齐套加载失败') }); });
    return () => controller.abort();
  }, [plan.id, plan.version, date, batchId, snapshotId, requestKey, t]);
  const data = result?.key === requestKey ? result.value : null;
  const error = failure?.key === requestKey ? failure.message : '';
  const problems = data?.lines.filter(row => row.problems.length > 0) ?? [];
  const snapshot = history.find(row => row.id === snapshotId);
  const openBasis = () => navigate(routePath('page:production-execution', '/production-execution') + `?${new URLSearchParams({ month: plan.month, plan: plan.id, view: 'readiness', readinessDate: date, ...(batchId ? { readinessBatch: batchId } : {}) })}`);
  const saveSnapshot = () => {
    if (!data || snapshotId || !canPlan) return;
    const basis = data;
    setEditor({ title: t('保存齐套快照'), description: t('保存当前核算依据用于历史对比，不调整库存，也不覆盖已有快照。'), fields: [{ key: 'reason', label: t('核对依据'), type: 'textarea' }], submit: (values, requestId) => commandProductionLifecycle(plan.id, 'readiness', { action: 'snapshot', requestId, version: basis.planVersion, data: { ...values, date: basis.date, batchId, sourceToken: basis.sourceToken } }) });
  };
  return <div className="mt-5 min-w-0">
    <div className="flex flex-wrap items-end gap-3">
      <label className="grid gap-1 text-xs font-semibold text-muted-foreground">{t('评估范围')}<NativeSelect aria-label={t('月度评估范围')} className="h-11 w-full sm:w-48" disabled={!!snapshotId} value={batchId} onChange={event => { const id = event.target.value; setBatchId(id); setHistory([]); setDate(plan.batches.find(row => row.id === id)?.dueDate ?? endOfMonth(plan.month)); }}><option value="">{t('整月计划')}</option>{plan.batches.map(batch => <option key={batch.id} value={batch.id}>{batch.code} · {quantity(batch.quantity)} {t('台')}</option>)}</NativeSelect></label>
      <label className="grid gap-1 text-xs font-semibold text-muted-foreground">{t('需求日期')}<Input aria-label={t('月度需求日期')} className="h-11 w-full sm:w-44" type="date" disabled={!!snapshotId} value={date} onChange={event => { if (event.target.value) setDate(event.target.value); }} /></label>
      <div className="flex flex-wrap gap-2 sm:ml-auto">{!snapshotId && <Button type="button" variant="outline" onClick={() => setReload(value => value + 1)}>{t('重新核算')}</Button>}{canPlan && !snapshotId && <Button type="button" disabled={!data || !!error} onClick={saveSnapshot}>{t('保存快照')}</Button>}</div>
    </div>
    {snapshotId && <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900"><span>{t('历史快照 · 只读，不随当前库存更新')} · {snapshot ? new Date(snapshot.at).toLocaleString(i18nLocale()) : '—'} · {t('计划版本')} {data?.planVersion ?? '—'}</span><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" onClick={() => setSnapshotId('')}>{t('返回当前数据')}</Button><Button type="button" variant="outline" size="sm" disabled={!data} onClick={() => { if (data) { setDate(data.date); setSnapshotId(''); setReload(value => value + 1); } }}>{t('按当前数据重算')}</Button></div></div>}
    {error ? <p role="alert" className="mt-4 text-sm text-destructive">{error}</p> : !data ? <p role="status" className="py-8 text-sm text-muted-foreground">{t('正在核对月度齐套依据…')}</p> : <>
      <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Metric label={t('当前可齐套')} value={data.currentSets} unit={t('套')} prominent />
        <Metric label={t('截至 {date} 预计可齐套', { date: data.date })} value={data.projectedSets} unit={t('套')} prominent />
        <Metric label={batchId ? t('本批剩余需求') : t('月度剩余需求')} value={data.remainingQty} unit={t('台')} />
      </dl>
      <details className={cn('mt-3 rounded-lg border px-3', problems.length ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-border')}>
        <summary className="cursor-pointer py-3 text-sm font-semibold focus-visible:outline-primary">{problems.length ? t('{count} 项物料依据待核对', { count: problems.length }) : data.currentSets === null || data.projectedSets === null ? t('齐套依据待完善') : t('齐套依据已核对')} · {t('查看依据')}</summary>
        <p className="mt-3 text-pretty text-xs leading-5 text-muted-foreground">{t('采用所选计划冻结 BOM；当前覆盖含当日确认的未耗用线边量，按期预测仅计有效日期内、分配给本范围的已下单采购。与全量库存能力口径不同。')}</p>
        <div className="border-t border-current/10 py-3 text-sm"><ul className="max-h-48 space-y-2 overflow-y-auto">{problems.map(row => <li key={row.code}><strong>{row.name} · {row.code}</strong><p className="mt-1 text-xs">{row.problems.join('；')}</p></li>)}</ul>{!snapshotId && <Button type="button" variant="outline" size="sm" className="mt-3" onClick={openBasis}>{t('打开齐套核对')}</Button>}</div>
      </details>
    </>}
    <details className="mt-4 border-t border-border pt-3">
      <summary className="cursor-pointer py-1 text-sm font-semibold focus-visible:outline-primary">{t('历史数据快照')} · {history.length}</summary>
      <p className="mt-2 text-pretty text-xs text-muted-foreground">{t('快照保留当时依据；按当前数据重算仅重新评估，不改写历史。')}</p>
      {!history.length ? <p className="py-3 text-sm text-muted-foreground">{t('当前范围暂无已保存快照')}</p> : <ul className="mt-2 max-h-64 divide-y divide-border overflow-y-auto">{history.map(row => <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-xs"><span className="tabular-nums">{new Date(row.at).toLocaleString(i18nLocale())} · {t('需求日期')} {row.date}<br /><span className="text-muted-foreground">{t('当前 / 按期预计')}：{row.currentSets ?? t('待核对')} / {row.projectedSets ?? t('待核对')} {t('套')}</span></span><Button type="button" size="sm" variant="outline" onClick={() => { setDate(row.date); setSnapshotId(row.id); }}>{t('查看快照')}</Button></li>)}</ul>}
    </details>
    {editor && <OperationalDialog editor={editor} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); setReload(value => value + 1); }} />}
  </div>;
}
