import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ArrowLeft, ArrowUpRight, RefreshCw, Search } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { NativeSelect } from '../../components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { usePermission } from '../../hooks/usePermission';
import { useAuth } from '../../auth';
import { useI18n } from '../../lib/i18n';
import { routePath } from '../../lib/routePaths';
import { buildPurchaseOrderLinePath } from '../../lib/purchaseOrderLineNavigation';
import { getKeyMaterialMonthly, type KeyMaterialMonthly } from '../../lib/keyMaterialsApi';
import { filterMonthlyMaterials, keyMaterialContext, keyMaterialPage, keyMaterialSearch, scopedMonthlyMaterials, validKeyMaterialDate, validKeyMaterialMonth, type MonthlyMaterial } from './keyMaterialWorkspaceModel';
import { KeyMaterialPagination } from './KeyMaterialPagination';
import { QualityAnalysisDialog } from '../quality/QualityAnalysisDialog';

export function KeyMaterialMonthlyPanel() {
  const { t } = useI18n(), [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const canReadQuality = ['*', 'proc-quality:manage', 'proc-quality:verify', 'page:proc-cockpit', 'page:rd-director-dashboard', 'production:plan', 'production:inspect', 'production:view-all'].some(permission => user?.permissions?.includes(permission));
  const { month, date, productId, productLine } = keyMaterialContext(params);
  const [stored, setStored] = useState<{ scope: string; data: KeyMaterialMonthly; at: string } | null>(null), [failure, setFailure] = useState<{ scope: string; message: string } | null>(null), [reload, setReload] = useState(0);
  const scope = JSON.stringify([month, date, reload, user?.id, user?.permissions]);
  const data = stored?.scope === scope ? stored.data : null, error = failure?.scope === scope ? failure.message : '';
  useEffect(() => {
    const controller = new AbortController();
    getKeyMaterialMonthly(month, date, controller.signal).then(value => { if (!controller.signal.aborted) setStored({ scope, data: value, at: new Date().toLocaleString() }); })
      .catch(cause => { if (!controller.signal.aborted) setFailure({ scope, message: cause instanceof Error ? cause.message : t('月度数据读取失败') }); });
    return () => controller.abort();
  }, [month, date, reload, scope, t]);
  const query = params.get('monthlyQ') || '', filter = params.get('monthlyFilter') || 'all', selectedId = params.get('material');
  const change = (patch: Record<string, string | null>) => setParams(current => keyMaterialSearch(current, patch));
  const href = (patch: Record<string, string | null>) => '?' + keyMaterialSearch(params, patch);
  const scoped = useMemo(() => data ? scopedMonthlyMaterials(data, productLine, productId) : [], [data, productLine, productId]);
  const rows = filterMonthlyMaterials(scoped, query, filter, Boolean(data?.planCount)), page = keyMaterialPage(rows, params.get('monthlyPage'));
  const allPlans = data?.materials.flatMap(material => material.plans) ?? [];
  const productOptions = new Map(allPlans.filter(plan => plan.productId).map(plan => [plan.productId!, plan.productName || plan.productId!]));
  if (productId && !productOptions.has(productId)) productOptions.set(productId, t('来源产品（关联待核对）'));
  const products = [...new Set([productLine, ...allPlans.filter(plan => !productId || plan.productId === productId).map(plan => plan.productLine)].filter(Boolean))];
  const selected = data?.materials.find(material => material.id === selectedId);
  const qualityId = canReadQuality && selected?.quality.some(row => row.id === params.get('quality')) ? params.get('quality') : null;
  const planCount = productLine || productId ? new Set(scoped.flatMap(material => material.plans.map(plan => plan.planId))).size : data?.planCount;
  const loading = !data && !error;
  return <section className={selectedId ? "space-y-4" : "km-workspace-monthly"} aria-label={t(selectedId ? '关键物料详情' : '关键物料月度跟踪')}>
    {selectedId && <Button variant="ghost" onClick={() => change({ material: null })}><ArrowLeft className="size-4" aria-hidden="true" />{t(params.get('clue') ? '返回线索详情' : params.get('view') === 'monthly' ? '返回月度跟踪' : '返回全量目录')}</Button>}
    <div className="km-workspace-surface"><div className="km-workspace-toolbar">
      <label>{t('计划月份')}<Input type="month" aria-label={t('关键物料计划月份')} value={month} onChange={event => { if (validKeyMaterialMonth(event.target.value)) change({ month: event.target.value, date: null, monthlyPage: null }); }} /></label>
      <label>{t('需求日期')}<Input type="date" aria-label={t('关键物料需求日期')} value={date} onChange={event => { if (validKeyMaterialDate(event.target.value)) change({ date: event.target.value, monthlyPage: null }); }} /></label>
      <label>{t('产品')}<NativeSelect aria-label={t('关键物料产品')} value={productId} onChange={event => change({ product: event.target.value, productLine: null, monthlyPage: null })}><option value="">{t('全部产品')}</option>{[...productOptions].map(([id, name]) => <option key={id} value={id}>{name}</option>)}</NativeSelect></label>
      <label>{t('产品型号')}<NativeSelect aria-label={t('关键物料产品型号')} value={productLine} onChange={event => change({ productLine: event.target.value, monthlyPage: null })}><option value="">{t('全部型号')}</option>{products.map(product => <option key={product} value={product}>{product}</option>)}</NativeSelect></label>
      <Button className="ml-auto" variant="outline" disabled={loading} onClick={() => setReload(value => value + 1)}><RefreshCw className="size-4" aria-hidden="true" />{t('刷新月度数据')}</Button>
    </div>{!selectedId && <div className="km-workspace-toolbar border-b-0"><div className="km-workspace-search"><Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden="true" /><Input className="pl-9" aria-label={t('搜索月度物料')} value={query} onChange={event => change({ monthlyQ: event.target.value, monthlyPage: null })} placeholder={t('物料名称、编码或规格')} /></div><NativeSelect aria-label={t('月度跟踪范围')} value={filter} onChange={event => change({ monthlyFilter: event.target.value, monthlyPage: null })}><option value="all">{t('全部物料')}</option><option value="gap">{t('存在日期缺口')}</option><option value="unverified">{t('依据待核对')}</option><option value="quality">{t('有关联未闭环异常')}</option></NativeSelect></div>}</div>
    {data && !selectedId && <div className="flex flex-wrap gap-2" aria-label={t('月度风险速览')}>{[['gap', '存在日期缺口'], ['unverified', '依据待核对'], ['quality', '未闭环质量异常']].map(([key, label]) => <Button key={key} variant={filter === key ? 'secondary' : 'outline'} aria-pressed={filter === key} onClick={() => change({ monthlyFilter: filter === key ? null : key, monthlyPage: null })}>{t(label)}<strong className="ml-2 text-lg tabular-nums">{filterMonthlyMaterials(scoped, '', key, Boolean(data.planCount)).length}</strong><span className="text-xs">{t('种物料')}</span></Button>)}</div>}
    <p className="text-pretty text-xs leading-5 text-muted-foreground">{month} · {productId ? productOptions.get(productId) : t('全部产品')} · {productLine || t('全部型号')}{data ? ' · ' + t('{count} 个关联计划', { count: planCount ?? 0 }) : ''}。{t('按剩余需求逐计划核对，数量不跨计划相加。库存为当前快照；异常包含全部日期。')}{data && <span className="ml-2">{t('最近读取')} {stored?.at} · {t('原单办理后请刷新月度数据。')}</span>}</p>
    {error ? <div role="alert" className="km-workspace-surface p-5"><p className="text-sm text-destructive">{error}</p><Button variant="outline" className="mt-3" onClick={() => setReload(value => value + 1)}>{t('重新加载')}</Button></div> : loading ? <p role="status" className="p-5 text-sm text-muted-foreground">{t('正在读取月度需求…')}</p>
      : selectedId ? selected ? <KeyMaterialDetail material={{ ...selected, plans: scoped.find(material => material.id === selected.id)?.plans ?? [] }} clues={data!.clues.filter(clue => clue.mapping.materialIds.includes(selected.id)).map(clue => ({ id: clue.id, name: clue.name }))} clueHref={id => href({ material: null, clue: id, view: 'review' })} month={month} onQuality={canReadQuality ? id => change({ quality: id }) : undefined} /> : <p role="status" className="km-workspace-surface p-6 text-sm text-muted-foreground">{t('该物料已不在当前关联目录，请返回重新选择。')}</p>
        : <div className="km-workspace-surface km-workspace-results">{!rows.length ? <div className="p-8 text-center"><p className="text-sm text-muted-foreground">{t(!data?.planCount ? '本月尚无正式生产计划，月度需求待确认。' : '没有符合当前范围的物料。')}</p><Button variant="link" onClick={() => change({ monthlyQ: null, monthlyFilter: null, product: null, productLine: null, monthlyPage: null })}>{t('清除筛选')}</Button></div> : <div className="km-workspace-table-scroll"><Table containerClassName="overflow-visible" className="min-w-[680px]"><TableHeader><TableRow>{['物料 / 规格', '关联计划', '截至日期缺口', '未闭环异常', '操作'].map(label => <TableHead key={label}>{t(label)}</TableHead>)}</TableRow></TableHeader><TableBody>{page.items.map(material => {
          const gaps = material.plans.filter(plan => plan.gap != null && plan.gap > 0).length, unknown = !data?.planCount || material.plans.some(plan => plan.gap == null);
          return <TableRow key={material.id}><TableCell className="whitespace-normal"><Link className="font-medium hover:text-primary hover:underline" to={href({ material: material.id })}>{material.name}</Link><p className="mt-1 text-xs text-muted-foreground">{material.tpInventoryCode || material.erpCode} · {material.spec || t('规格待补齐')}</p></TableCell><TableCell className="text-xs">{material.plans.length ? [...new Set(material.plans.map(plan => plan.productLine))].join('、') : t('暂无匹配计划')}</TableCell><TableCell className="text-xs">{gaps ? <span className="font-medium text-destructive">{t('{count} 个计划有缺口', { count: gaps })}</span> : <span className="text-muted-foreground">{t(unknown ? '待核对' : !material.plans.length || material.plans.every(plan => plan.remainingDemand === 0) ? '本期无剩余需求' : '已覆盖')}</span>}{gaps > 0 && unknown && <p className="mt-1 text-muted-foreground">{t('另有依据待核对')}</p>}</TableCell><TableCell className="tabular-nums text-xs">{material.quality.length}</TableCell><TableCell><Button asChild variant="ghost" size="sm"><Link to={href({ material: material.id })}>{t('查看详情')}<ArrowUpRight className="size-3.5" aria-hidden="true" /></Link></Button></TableCell></TableRow>;
        })}</TableBody></Table></div>}<KeyMaterialPagination {...page} onPage={value => change({ monthlyPage: String(value) })} /></div>}
    {qualityId && <QualityAnalysisDialog id={qualityId} onClose={() => change({ quality: null })} onSaved={() => setReload(value => value + 1)} />}
  </section>;
}

function KeyMaterialDetail({ material, clues, clueHref, month, onQuality }: { material: MonthlyMaterial; clues: { id: string; name: string }[]; clueHref: (id: string) => string; month: string; onQuality?: (id: string) => void }) {
  const { t } = useI18n();
  const canMaterials = usePermission('page:proc-materials'), canOrders = usePermission('page:purchase-orders'), canOrderDetail = usePermission('page:purchase-order-detail'), canCockpit = usePermission('page:proc-cockpit'), canProduction = usePermission('page:production-execution'), canSuppliers = usePermission('page:proc-quote-book');
  const code = material.tpInventoryCode || material.erpCode;
  const quantity = (value?: number | null) => value == null ? t('待补齐') : value.toLocaleString();
  const orders = material.plans.flatMap(plan => plan.purchase.map(order => ({ ...order, planId: plan.planId, productLine: plan.productLine })));
  const openProps = { target: '_blank', rel: 'noopener noreferrer' };
  return <article className="space-y-4">
    <header className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs text-muted-foreground">{code || t('编码待补齐')} · {material.category || t('分类待补齐')}</p><h2 className="mt-1 text-xl font-semibold text-balance">{material.name}</h2><p className="mt-2 text-sm text-muted-foreground">{material.spec || t('规格待补齐')}</p></div><div className="flex flex-wrap gap-2">{canSuppliers && <Button asChild variant="outline"><Link {...openProps} to={routePath('page:proc-quote-book', '/proc-quote-book') + '?' + new URLSearchParams({ view: 'qualifications', materialId: material.id })}>{t('供应商资质')}<ArrowUpRight className="size-4" aria-hidden="true" /><span className="sr-only">{t('新标签页')}</span></Link></Button>}{canMaterials && code && <Button asChild variant="outline"><Link {...openProps} to={routePath('page:proc-materials', '/proc-materials') + '?' + new URLSearchParams({ materialCode: code })}>{t('打开物料原记录')}<ArrowUpRight className="size-4" aria-hidden="true" /><span className="sr-only">{t('新标签页')}</span></Link></Button>}</div></header>
    <dl className="km-workspace-facts"><div><dt>{t('量产仓当前可用')}</dt><dd>{quantity(material.available)} {material.unit}</dd></div><div><dt>{t('ERP 当前在途')}</dt><dd>{quantity(material.inTransit)} {material.unit}</dd></div><div><dt>{t('库存同步时间')}</dt><dd className="!text-sm">{material.syncedAt ? new Date(material.syncedAt).toLocaleString() : t('待补齐')}</dd></div></dl>
    <div className="km-workspace-detail-grid"><div className="km-workspace-surface">
      <section className="km-workspace-detail-section"><h2>{t('计划需求与供给依据')}</h2>{material.plans.length ? <ul className="km-workspace-detail-list">{material.plans.map(plan => <li key={plan.planId}>
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-medium">{plan.productName || plan.productLine}</h3><p className="mt-1 break-all text-xs text-muted-foreground">{plan.planId}</p></div>{canProduction && <Link {...openProps} className="inline-flex items-center gap-1 text-xs text-primary" to={routePath('page:production-execution', '/production-execution') + '?' + new URLSearchParams({ month, plan: plan.planId, view: 'readiness', readinessDate: plan.date })}>{t('查看原计划')}<ArrowUpRight className="size-3" aria-hidden="true" /></Link>}</div>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">{[['剩余需求', quantity(plan.remainingDemand)], ['截至日期缺口', plan.gap == null ? t('待核对') : quantity(plan.gap)], ['日期内采购', quantity(plan.incoming)], ['计划总需求', quantity(plan.demand)], ['需求日期', plan.date]].map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{t(label)}</dt><dd className={label === '剩余需求' ? 'mt-1 text-xl font-semibold tabular-nums' : 'mt-1 tabular-nums'}>{value}{label === '需求日期' || value === t('待核对') || value === t('待补齐') ? '' : ' ' + material.unit}</dd></div>)}</dl>
        {plan.problems.map(problem => <p className="mt-2 text-pretty text-xs text-amber-700" key={problem}>{problem}</p>)}
      </li>)}</ul> : <p className="text-sm text-muted-foreground">{t('当前范围没有匹配的生产计划，不作缺口判断。')}</p>}</section>
      <section className="km-workspace-detail-section"><h2>{t('采购订单依据')}</h2>{orders.length ? <ul className="km-workspace-detail-list">{orders.map(order => { const path = buildPurchaseOrderLinePath(order.orderNo, order.id); return <li key={`${order.planId}:${order.id}`} className="text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{order.orderNo}</span>{path && (canOrders || canOrderDetail) && <Link {...openProps} className="inline-flex items-center gap-1 text-xs text-primary" to={path}>{t('查看订单行')}<ArrowUpRight className="size-3" aria-hidden="true" /></Link>}</div><p className="mt-1 break-all text-xs text-muted-foreground">{order.productLine} · {order.planId}</p><p className="mt-1 text-xs text-muted-foreground">{order.supplier} · {t('检验可用')} {order.date || t('日期未确认')} · {t(order.included ? '计入本计划日期供给' : '未计入本计划日期供给')}</p></li>; })}</ul> : <p className="text-sm text-muted-foreground">{t('暂无采购单依据')}</p>}</section>
    </div><aside className="km-workspace-surface">
      <section className="km-workspace-detail-section"><h2>{t('关联采购任务')}</h2><p className="mb-3 text-xs text-muted-foreground">{t('以下为该物料全部日期的关联任务。')}</p>{material.tasks.length ? <ul className="km-workspace-detail-list">{material.tasks.map(task => <li key={task.id} className="text-sm">{canCockpit ? <Link {...openProps} to={routePath('page:proc-cockpit', '/proc-cockpit') + '?' + new URLSearchParams({ task: task.id })} className="inline-flex items-center gap-1 font-medium hover:text-primary">{task.code}<ArrowUpRight className="size-3" aria-hidden="true" /></Link> : <p className="font-medium">{task.code}</p>}<p className="mt-1 text-xs text-muted-foreground">{task.buyer || t('待分配')}</p></li>)}</ul> : <p className="text-sm text-muted-foreground">{t('暂无关联任务')}</p>}</section>
      <section className="km-workspace-detail-section"><h2>{t('未闭环质量异常')}</h2>{material.quality.length ? <ul className="km-workspace-detail-list">{material.quality.map(row => <li key={row.id}><p className="text-pretty text-sm">{row.issue}</p><p className="mt-1 break-all text-xs text-muted-foreground">{t('异常编号')} {row.id}</p>{onQuality && <Button variant="link" size="sm" className="mt-1 h-auto p-0" onClick={() => onQuality(row.id)}>{t('查看原质量记录')}</Button>}</li>)}</ul> : <p className="text-sm text-muted-foreground">{t('暂无关联未闭环异常')}</p>}</section>
      <section className="km-workspace-detail-section"><h2>{t('会议线索')}</h2><ul className="space-y-2">{clues.map(clue => <li key={clue.id}><Link to={clueHref(clue.id)} className="text-sm hover:text-primary hover:underline">{clue.id} · {clue.name}</Link></li>)}</ul></section>
    </aside></div>
    <p className="text-pretty text-xs text-muted-foreground">{t('原记录办理后，点击“刷新月度数据”重新核对；月份、型号与筛选保留。质量异常关闭不代表库存已可用，仍以库存及齐套依据为准。')}</p>
  </article>;
}
