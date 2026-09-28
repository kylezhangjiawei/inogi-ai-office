import { useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { ArrowLeft, RefreshCw, Truck } from 'lucide-react';
import { useAuth } from '../../auth';
import { hasPermission } from '../../lib/permissions';
import { useI18n } from '../../lib/i18n';
import { routePath, subRoutePath } from '../../lib/routePaths';
import { listExecutionPlans, type ExecutionPlan } from '../../lib/productionExecutionApi';
import { LifecyclePanel } from '../../production/execution/LifecyclePanel';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { NativeSelect } from '../../components/ui/native-select';
import { Skeleton } from '../../components/ui/skeleton';
import { OrderEmptyState, OrderPageHeader } from '../components/HorizonPage';
import '../horizon.css';
import '../../production/execution/production.css';

export function ShipmentRecordsPage() {
  const { user } = useAuth();
  return <ShipmentRecordsContent key={JSON.stringify([user?.id, user?.roleId, user?.permissions])} />;
}

function ShipmentRecordsContent() {
  const { user } = useAuth(), { t } = useI18n();
  const allowed = hasPermission(user?.permissions ?? [], 'page:production-execution');
  const [params, setParams] = useSearchParams();
  const currentMonth = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 7);
  const rawMonth = params.get('month') ?? '';
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(rawMonth) ? rawMonth : currentMonth;
  const [reload, setReload] = useState(0);
  const [resource, setResource] = useState<{ month: string; plans: ExecutionPlan[]; error: string; loading: boolean }>({ month: '', plans: [], error: '', loading: true });
  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    setResource({ month, plans: [], error: '', loading: true });
    listExecutionPlans(month, controller.signal).then(plans => {
      if (!controller.signal.aborted) setResource({ month, plans, error: '', loading: false });
    }).catch(cause => {
      if (!controller.signal.aborted) setResource({ month, plans: [], error: cause instanceof Error ? cause.message : '计划读取失败', loading: false });
    });
    return () => controller.abort();
  }, [allowed, month, reload]);
  const loading = resource.month !== month || resource.loading;
  const plans = resource.month === month ? resource.plans : [];
  const selectedId = params.get('plan');
  const plan = selectedId ? plans.find(row => row.id === selectedId) : plans.find(row => row.month === month) ?? plans[0];
  const error = resource.month === month ? resource.error : '';
  const refresh = () => setReload(value => value + 1);
  const select = (nextMonth: string, nextPlan?: string) => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(nextMonth)) return;
    // Old record IDs and table filters must never leak into a different plan.
    const next = new URLSearchParams({ month: nextMonth, view: 'shipments' });
    if (nextPlan) next.set('plan', nextPlan);
    setParams(next);
  };
  // Persist the initial plan so refreshes and copied record links retain the same source.
  if (allowed && !loading && plan && !selectedId) {
    const next = new URLSearchParams(params);
    next.set('month', month); next.set('plan', plan.id); next.set('view', 'shipments');
    return <Navigate replace to={`${subRoutePath('page:warehouse-flow', '/warehouse-flow', 'shipments')}?${next}`} />;
  }
  // Batch traceability may open a production task; that task keeps its existing route and permissions.
  if (allowed && plan && params.has('task')) return <Navigate replace to={`${routePath('page:production-execution', '/production-execution')}?${params}`} />;

  return <main className="horizon-theme order-horizon production-page mx-auto flex w-full min-w-0 max-w-[1600px] flex-col gap-4 pb-5">
    <OrderPageHeader Icon={Truck} eyebrow={t('订单与库存 / 仓库工作台')} title={t('实际出货记录')} description={t('查看正式出货凭证、批次放行与实发 SN；出货办理沿用原权限和校验。')} actions={<>
      <Button asChild variant="outline"><Link to={routePath('page:warehouse-flow', '/warehouse-flow')}><ArrowLeft className="size-4" aria-hidden="true" />{t('仓库工作台')}</Link></Button>
      {allowed && <Button variant="outline" disabled={loading} onClick={refresh}><RefreshCw className="size-4" aria-hidden="true" />{t('刷新')}</Button>}
    </>} />
    {!allowed ? <OrderEmptyState Icon={Truck} title={t('暂无此项数据的查看权限')} description={t('请联系管理员配置生产计划与执行查看权限。')} /> : <>
      <section className="production-surface flex flex-wrap items-end gap-4 p-4" aria-label={t('出货范围')}>
        <div className="space-y-2"><Label htmlFor="shipment-plan-month">{t('计划月份')}</Label><Input id="shipment-plan-month" aria-label={t('计划月份')} type="month" value={month} className="w-44" onChange={event => select(event.target.value)} /></div>
        <div className="min-w-0 flex-1 basis-64 space-y-2"><Label htmlFor="shipment-plan">{t('生产计划')}</Label><NativeSelect id="shipment-plan" aria-label={t('生产计划')} value={plan?.id ?? ''} disabled={loading || !plans.length} onChange={event => select(month, event.target.value)}>
          <option value="" disabled>{t('请选择生产计划')}</option>
          {plans.map(row => <option key={row.id} value={row.id}>{row.productName} · {row.productLine} · {row.month}{row.carryover ? ` · ${t('跨月未完')}` : ''}</option>)}
        </NativeSelect></div>
      </section>
      <p className="text-pretty text-xs text-muted-foreground">{t('按所选生产计划查看出货，不是全仓月度汇总；冲销记录保留原单，不计入净发货。')}</p>
      {loading ? <div role="status" aria-label={t('正在加载')}><Skeleton className="h-24 w-full rounded-xl" /><Skeleton className="mt-4 h-64 w-full rounded-xl" /></div> : error ? <section role="alert" className="production-surface p-5"><p className="mb-3 text-sm text-destructive">{error}</p><Button variant="outline" onClick={refresh}>{t('重新加载')}</Button></section> : !plan ? <OrderEmptyState Icon={Truck} title={t(selectedId ? '所选计划不存在或无权查看' : '该月份暂无可查看的生产计划')} action={selectedId ? <Button variant="outline" onClick={() => select(month)}>{t('重新选择计划')}</Button> : undefined} /> : <LifecyclePanel key={`${plan.id}:${reload}`} plan={plan} view="shipments" shipmentFirst />}
    </>}
  </main>;
}
