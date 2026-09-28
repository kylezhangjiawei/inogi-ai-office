import { useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ArrowLeft, ArrowRight, ArrowUpRight, BarChart3, Boxes, CheckCircle2, CircleAlert, Factory, FlaskConical, PackageCheck, RefreshCw, ShoppingCart, Truck } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { NativeSelect } from '../components/ui/native-select';
import { Progress } from '../components/ui/progress';
import { HorizonEmptyState, HorizonMetric, HorizonMetricGrid, HorizonPageHeader, HorizonSectionHeader } from '../components/horizon/HorizonPage';
import { fetchManagementDashboard, type ManagementDashboardData } from '../lib/managementDashboardApi';
import { managementRiskHref, type ManagementRisk } from '../lib/managementRiskApi';
import { i18nLocale, useI18n } from '../lib/i18n';
import { hasPermission } from '../lib/permissions';
import { routePath } from '../lib/routePaths';
import { knownManagementQuantity, managementDashboardAccess, managementMonth, managementQuery } from './managementDashboardModel';
import { deriveDashboardInsights } from './managementDashboardInsights';
import { ManagementDashboardCharts } from './ManagementDashboardCharts';
import { ManagementRiskPanel } from './ManagementRiskPanel';
import './managementDashboard.css';

const riskNames: Record<ManagementRisk['kind'], string> = { quality: '质量异常', ecn: '工程变更', material: '物料齐套', schedule: '生产进度', procurement: '采购任务', 'purchase-order': '采购订单' };
const sourceNames = { overview: '生产概况', plans: '生产计划', risks: '交付风险', rd: '研发概况', procurement: '采购概况' };

export function ManagementDashboard({ permissions, navigation }: { permissions: string[]; navigation?: ReactNode }) {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const month = managementMonth(params.get('month'));
  const access = managementDashboardAccess(permissions);
  const detail = params.get('homeSection') === 'risks' && access.canReadRisks;
  const [reload, setReload] = useState(0);
  const [stored, setStored] = useState<{ scope: string; data: ManagementDashboardData } | null>(null);
  const [failure, setFailure] = useState<{ scope: string; message: string } | null>(null);
  const permissionKey = [...permissions].sort().join('\u0001');
  const scope = JSON.stringify([month, permissionKey, reload]);
  const data = stored?.scope === scope ? stored.data : null;
  const error = failure?.scope === scope ? failure.message : '';
  const loading = !data && !error;
  useEffect(() => {
    if (!access.canManage || detail) return;
    const controller = new AbortController();
    fetchManagementDashboard(month, permissions, controller.signal)
      .then(value => { if (!controller.signal.aborted) setStored({ scope, data: value }); })
      .catch(cause => { if (!controller.signal.aborted) setFailure({ scope, message: cause instanceof Error ? cause.message : t('管理总览读取失败') }); });
    return () => controller.abort();
    // 权限集合决定读取范围，避免数组引用变化触发重复请求。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, permissionKey, reload, scope, detail, t]);

  const change = (patch: Record<string, string | null>) => setParams(current => managementQuery(current, patch));
  const homeHref = (patch: Record<string, string | null> = {}) => `/?${managementQuery(params, { home: 'management', month, homeSection: null, riskQuality: null, riskProduct: null, riskPage: null, ...patch })}`;
  const insights = deriveDashboardInsights(data, month);
  const number = (value: unknown) => knownManagementQuantity(value) ? value.toLocaleString(i18nLocale(), { maximumFractionDigits: 1 }) : t('待核对');
  const quantity = (value: unknown, unit = '台') => loading ? '—' : knownManagementQuantity(value) ? `${number(value)} ${t(unit)}` : t('待核对');
  const percent = (value: unknown) => knownManagementQuantity(value) ? `${number(value)}%` : t('待核对');
  const productionHref = `${routePath('page:production-execution', '/production-execution')}?${new URLSearchParams({ month })}`;
  const procurementHref = routePath('page:proc-cockpit', '/proc-cockpit');
  const rdHref = hasPermission(permissions, 'page:rd-task-management') ? routePath('page:rd-task-management', '/rd-task-management')
    : hasPermission(permissions, 'page:rd-director-dashboard') ? routePath('page:rd-director-dashboard', '/rd-director-dashboard') : routePath('page:rd-my-workspace', '/rd-my-workspace');
  const overview = access.canReadOverview ? data?.overview : null;
  const rd = access.canReadRd ? data?.rd : null;
  const procurement = access.canReadProcurement ? data?.procurement : null;
  const batches = data?.risks?.scopes.production ? data.risks.batches : [];
  const batch = batches.find(item => item.id === params.get('homeBatch')) ?? batches[0];
  const readinessHref = batch && access.canReadPlans ? `${productionHref}&${new URLSearchParams({ plan: batch.planId, view: 'readiness', ...(batch.batchId ? { readinessBatch: batch.batchId } : {}) })}` : null;
  const completion = insights.currentMonth.target && insights.currentMonth.completed != null ? insights.currentMonth.completed / insights.currentMonth.target * 100 : null;
  const shipmentRemaining = knownManagementQuantity(overview?.shipmentTargetQty) && knownManagementQuantity(overview?.actualShippedQty) ? Math.max(0, overview.shipmentTargetQty - overview.actualShippedQty) : null;
  const riskTotal = data?.risks?.risks.length;
  const riskHref = (risk: ManagementRisk) => managementRiskHref(risk, month) || homeHref({ homeSection: 'risks', ...(risk.target?.type === 'quality' ? { riskQuality: risk.target.qualityId } : {}) });
  const more = (to: string, label = '查看详情') => <Link to={to} className="md-text-link">{t(label)}<ArrowUpRight className="size-3.5" aria-hidden="true" /></Link>;
  const retry = <Button variant="outline" size="sm" onClick={() => setReload(value => value + 1)}>{t('重新加载')}</Button>;
  if (!access.canManage) return null;

  if (detail) return <section className="horizon-theme management-dashboard" aria-label={t('交付风险明细')}>
    <Link to={homeHref()} className="md-text-link self-start"><ArrowLeft className="size-4" aria-hidden="true" />{t('返回数据看板')}</Link>
    <HorizonPageHeader Icon={CircleAlert} eyebrow={t('管理总览 / 交付风险')} title={t('交付风险明细')} description={t('按产品和风险类型定位问题，进入原记录跟进。')} actions={navigation} />
    <ManagementRiskPanel key={scope} month={month} />
  </section>;

  return <section className="horizon-theme management-dashboard" aria-label={t('公司管理数据看板')} aria-busy={loading}>
    <HorizonPageHeader Icon={BarChart3} eyebrow={t('系统首页')} title={t('公司管理总览')} description={t('从研发到交付，一眼掌握业务进展。')} actions={<>
      <label className="md-month-label">{t('统计月份')}<Input aria-label={t('管理总览月份')} type="month" className="w-40" value={month} onChange={event => { if (/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value)) change({ month: event.target.value, homeBatch: null }); }} /></label>
      <Button variant="outline" disabled={loading} onClick={() => setReload(value => value + 1)}><RefreshCw className="size-4" aria-hidden="true" />{t('刷新')}</Button>{navigation}
    </>} />

    {(error || (data && Object.keys(data.errors).length > 0)) && <section role="alert" className="md-source-alert"><div><strong>{t('部分数据暂未就绪')}</strong>{error ? <p>{error}</p> : Object.entries(data!.errors).map(([source, message]) => <p key={source}>{t(sourceNames[source as keyof typeof sourceNames])}：{message}</p>)}</div>{retry}</section>}

    <div className="md-topline">
      {access.canReadOverview && <section className="md-shipment-strip" aria-label={t('月度发货概况')}>
        <div className="md-month"><Truck className="size-5" aria-hidden="true" /><span>{month.replace('-', ' / ')}</span><small>{t('月度交付')}</small></div>
        <dl><div><dt>{t('发货目标')}</dt><dd>{quantity(overview?.shipmentTargetQty)}</dd></div><div><dt>{t('已净发货')}</dt><dd className="md-success">{quantity(overview?.actualShippedQty)}</dd></div><div><dt>{t('距目标还差')}</dt><dd>{quantity(shipmentRemaining)}</dd></div></dl>
      </section>}
      <nav className="md-module-links" aria-label={t('业务看板入口')}>
        {access.canReadProcurement && <Button asChild variant="outline"><Link to={procurementHref}><ShoppingCart className="size-4" aria-hidden="true" />{t('供应链总览')}</Link></Button>}
        {access.canReadPlans && <Button asChild variant="outline"><Link to={productionHref}><Factory className="size-4" aria-hidden="true" />{t('生产总览')}</Link></Button>}
        {access.canReadRd && <Button asChild variant="outline"><Link to={rdHref}><FlaskConical className="size-4" aria-hidden="true" />{t('研发任务')}</Link></Button>}
      </nav>
    </div>

    <section className="md-pipeline" aria-label={t('业务链路概况')}>
      {access.canReadRd && <div className="md-stage"><span className="md-stage-icon"><FlaskConical /></span><div><h2>{t('研发')}</h2><p>{t('进行中')} <b>{loading ? '—' : number(rd?.inProgress)}</b><span>·</span>{t('已完成')} <b>{loading ? '—' : number(rd?.completed)}</b></p><small>{t(rd?.scope === 'participating' ? '当前参与范围' : '当前任务概况')}</small></div><ArrowRight className="md-stage-arrow" aria-hidden="true" /></div>}
      {access.canReadProcurement && <div className="md-stage"><span className="md-stage-icon"><ShoppingCart /></span><div><h2>{t('样品与采购')}</h2><p>{t('测试中')} <b>{loading ? '—' : number(procurement?.sampleTesting)}</b><span>·</span>{t('在途')} <b>{loading ? '—' : number(procurement?.inTransit)}</b></p><small>{t('当前采购任务')}</small></div><ArrowRight className="md-stage-arrow" aria-hidden="true" /></div>}
      {access.canReadOverview && <><div className="md-stage"><span className="md-stage-icon"><Factory /></span><div><h2>{t('配料与生产')}</h2><p>{t('月度目标')} <b>{loading ? '—' : number(insights.currentMonth.target)}</b><span>·</span>{t('合格完成')} <b>{loading ? '—' : number(insights.currentMonth.completed)}</b></p><small>{t('所选月份正式计划 · 台')}</small></div><ArrowRight className="md-stage-arrow" aria-hidden="true" /></div><div className="md-stage"><span className="md-stage-icon"><PackageCheck /></span><div><h2>{t('检验与出货')}</h2><p>{t('首次终检')} <b>{loading ? '—' : number(insights.firstFinal?.quantity)}</b><span>·</span>{t('净发货')} <b>{loading ? '—' : number(overview?.actualShippedQty)}</b></p><small>{t('所选月份实际记录 · 台')}</small></div></div></>}
    </section>

    <HorizonMetricGrid>
      {access.canReadOverview && <><HorizonMetric Icon={CheckCircle2} label={t('本月合格完成')} value={quantity(insights.currentMonth.completed)} tone="brand" note={t('本月正式计划 · 整机合格数量')} /><HorizonMetric Icon={Factory} label={t('本月待完成')} value={quantity(insights.currentMonth.remaining)} note={knownManagementQuantity(insights.currentMonth.target) ? t('生产目标 {count} 台', { count: number(insights.currentMonth.target) }) : t('本月正式计划 · 待核对')} /></>}
      {(access.canReadPlans || data?.risks?.scopes.production) && <HorizonMetric Icon={Boxes} label={t('当前批次可齐套')} value={quantity(batch?.current, '套')} note={batch ? `${batch.product} · ${batch.code}` : t('暂无可核对的生产批次')} tone={knownManagementQuantity(batch?.current) && knownManagementQuantity(batch?.remaining) ? batch.current >= batch.remaining ? 'success' : 'warning' : 'neutral'} />}
      {access.canReadRisks && <HorizonMetric Icon={CircleAlert} label={t('待关注风险')} value={quantity(riskTotal, '项')} note={t('当前授权范围 · 本月与跨月未完')} tone={riskTotal ? 'danger' : 'neutral'} />}
    </HorizonMetricGrid>

    <div className="md-domains">
      {access.canReadRd && <section className="md-panel" aria-label={t('研发与转产概况')}>
        <HorizonSectionHeader Icon={FlaskConical} title={t('研发与转产')} trailing={more(rdHref)} />
        <div className="md-panel-body"><div className="md-domain-value"><div><span>{t('研发进行中')}</span><strong>{quantity(rd?.inProgress, '项')}</strong></div><span className="md-scope-tag">{t(rd?.scope === 'participating' ? '我的参与范围' : '当前任务')}</span></div>
          <dl className="md-mini-stats"><div><dt>{t('任务总数')}</dt><dd>{quantity(rd?.total, '项')}</dd></div><div><dt>{t('已完成')}</dt><dd>{quantity(rd?.completed, '项')}</dd></div><div><dt>{t('阻塞中')}</dt><dd className={rd?.blocked ? 'md-warning' : ''}>{quantity(rd?.blocked, '项')}</dd></div></dl>
          <div className="md-domain-foot"><span>{t('工程变更待处理')}</span><strong>{data?.risks?.scopes.production ? quantity(insights.riskCounts?.ecn, '项') : t('当前范围未包含')}</strong></div>
        </div>
      </section>}
      {(access.canReadProcurement || access.canReadPlans || data?.risks?.scopes.production) && <section className="md-panel" aria-label={t('供应链交付概况')}>
        <HorizonSectionHeader Icon={Boxes} title={t('供应链交付')} trailing={readinessHref ? more(readinessHref, '查看齐套') : access.canReadProcurement ? more(procurementHref) : null} />
        <div className="md-panel-body">
          {batches.length > 0 ? <><NativeSelect aria-label={t('齐套批次')} value={batch?.id} onChange={event => change({ homeBatch: event.target.value })}>{batches.map(item => <option key={item.id} value={item.id}>{item.product} · {item.code}</option>)}</NativeSelect>
            <div className="md-readiness-value"><div><strong>{quantity(batch?.current, '套')}</strong><span>{t('当前可齐套')}</span></div><div><b>{quantity(batch?.remaining)}</b><span>{t('批次待生产')}</span></div></div>
            {knownManagementQuantity(batch?.current) && knownManagementQuantity(batch?.remaining) && batch.remaining > 0 && <Progress value={Math.min(100, batch.current / batch.remaining * 100)} className="h-2" aria-label={t('当前批次待生产数量的齐套覆盖率')} />}
            <div className="md-domain-foot"><span>{t('按期可齐套')} <b>{quantity(batch?.onTime, '套')}</b></span><span>{batch?.date || t('计划日期待核对')}</span></div>
          </> : <><div className="md-domain-value"><div><span>{t('采购在途')}</span><strong>{quantity(procurement?.inTransit, '项')}</strong></div></div><dl className="md-mini-stats"><div><dt>{t('待确认')}</dt><dd>{quantity(procurement?.pending, '项')}</dd></div><div><dt>{t('询价中')}</dt><dd>{quantity(procurement?.inquiry, '项')}</dd></div><div><dt>{t('部分到货')}</dt><dd>{quantity(procurement?.partialArrival, '项')}</dd></div></dl><p className="md-domain-foot">{t('批次齐套在有权限的生产计划中查看。')}</p></>}
        </div>
      </section>}
      {access.canReadOverview && <section className="md-panel" aria-label={t('生产与品质概况')}>
        <HorizonSectionHeader Icon={PackageCheck} title={t('生产与品质')} trailing={access.canReadPlans ? more(productionHref) : null} />
        <div className="md-panel-body"><div className="md-domain-value"><div><span>{t('本月首次终检合格率')}</span><strong className={insights.firstFinal?.quantity ? "md-success" : undefined}>{loading ? '—' : insights.firstFinal?.quantity === 0 ? t('暂无终检') : percent(insights.firstFinal?.firstPassRate)}</strong></div></div>
          {knownManagementQuantity(insights.firstFinal?.firstPassRate) && <Progress value={Math.min(100, insights.firstFinal.firstPassRate)} className="md-quality-progress h-2" aria-label={t('首次终检合格率')} />}
          <dl className="md-mini-stats"><div><dt>{t('首次终检')}</dt><dd>{quantity(insights.firstFinal?.quantity)}</dd></div><div><dt>{t('首次合格')}</dt><dd>{quantity(insights.firstFinal?.goodQty)}</dd></div><div><dt>{t('质量风险')}</dt><dd>{quantity(insights.riskCounts?.quality, '项')}</dd></div></dl>
          <div className="md-domain-foot"><span>{t('本月计划完成率')}</span><strong>{loading ? '—' : percent(completion)}</strong></div>
        </div>
      </section>}
    </div>

    <ManagementDashboardCharts insights={insights} showProduction={access.canReadOverview} showRisks={access.canReadRisks} loading={loading} />

    {access.canReadRisks && <section className="md-panel md-risk-preview" aria-label={t('重点关注风险')}>
      <HorizonSectionHeader Icon={CircleAlert} title={t('重点关注')} description={t('优先查看临近或已过截止日期的风险，最多展示 5 项。')} trailing={more(homeHref({ homeSection: 'risks' }), '查看全部风险')} />
      {loading ? <p role="status" className="md-inline-empty">{t('正在汇总风险…')}</p> : !insights.risks ? <p className="md-inline-empty">{t('风险暂未读取成功，请重新加载。')}</p> : insights.risks.length === 0 ? <HorizonEmptyState Icon={CheckCircle2} title={t('当前没有待处理风险')} description={t('当前授权范围内的风险已清空，可进入业务模块查看进展。')} /> : <ul className="md-risk-list">{insights.risks.map(risk => <li key={risk.id}>
        <span className={`md-risk-dot md-risk-dot-${risk.kind}`} aria-hidden="true" />
        <div className="md-risk-subject"><Link to={riskHref(risk)} title={risk.title}>{risk.title}</Link><p>{t(riskNames[risk.kind])}<span>·</span>{risk.product || t('范围待确认')}{risk.period === 'carryover' && <span>{t('跨月未完')}</span>}</p></div>
        <span className="md-risk-owner">{risk.owner || t('经办人待确认')}</span><time className="md-risk-date" dateTime={risk.dueDate || undefined}>{risk.dueDate || t('日期待确认')}</time>
        <Link className="md-text-link" to={riskHref(risk)} aria-label={t('查看风险：{title}', { title: risk.title })}>{t('查看')}<ArrowRight className="size-3.5" aria-hidden="true" /></Link>
      </li>)}</ul>}
    </section>}

    <footer className="md-footer"><span>{data ? t('更新于 {time}', { time: new Date(data.loadedAt).toLocaleTimeString(i18nLocale(), { hour: '2-digit', minute: '2-digit' }) }) : t('正在读取业务数据')}</span><details><summary>{t('数据范围与口径')}</summary><p>{t('生产与发货按所选月份统计；研发与采购展示当前任务。合格完成按本月正式计划核算；发货按实际日期计算，包含往月计划并扣除撤销记录。齐套按所选批次展示，不跨产品相加。风险仅包含当前授权范围。')}</p></details></footer>
  </section>;
}
