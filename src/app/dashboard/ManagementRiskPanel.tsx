import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Button } from '../components/ui/button';
import { NativeSelect } from '../components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { authFetch, readErrorMessage } from '../lib/authSession';
import { useAuth } from '../auth';
import { routePath } from '../lib/routePaths';
import { ProductionEmpty, ProductionPagination } from '../production/execution/ProductionView';
import { productionPage } from '../production/execution/productionViewState';
import { canReadManagementRisks, managementRiskHref, type ManagementRiskResponse as Data } from '../lib/managementRiskApi';
import { QualityAnalysisDialog } from '../procurement/quality/QualityAnalysisDialog';

const labels = { quality: '质量异常', ecn: 'ECN 反馈', material: '物料齐套', schedule: '作业逾期', procurement: '采购逾期', 'purchase-order': '订单逾期' };
export function ManagementRiskPanel({ month, presentation = 'default', refreshKey = 0 }: { month: string; presentation?: 'default' | 'production'; refreshKey?: number }) {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const canRead = Boolean(user?.id) && canReadManagementRisks(user?.permissions);
  const [view, setView] = useState<'risk' | 'batches'>('risk'), [kind, setKind] = useState('all'), [period, setPeriod] = useState('all');
  const [pageNo, setPageNo] = useState(1), [stored, setStored] = useState<{ scope: string; value: Data } | null>(null), [error, setError] = useState(''), [reload, setReload] = useState(0);
  const permissionKey = JSON.stringify([user?.id, user?.permissions]);
  const product = params.get('riskProduct') ?? '';
  const scope = JSON.stringify([month, product, permissionKey, reload, refreshKey]);
  const data = stored?.scope === scope ? stored.value : null;
  useEffect(() => {
    if (!canRead) return;
    const controller = new AbortController(); setStored(null); setError(''); setPageNo(1);
    authFetch(`/api/procurement/management-risk?${new URLSearchParams({ month, ...(product ? { productId: product } : {}) })}`, { signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error(await readErrorMessage(response, '交付风险读取失败')); return response.json() as Promise<Data>; })
      .then(value => { if (!controller.signal.aborted) setStored({ scope, value }); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [month, product, reload, refreshKey, permissionKey, canRead]);
  if (!canRead) return null;
  const risks = productionPage(data?.risks.filter(row => (kind === 'all' || row.kind === kind) && (period === 'all' || (row.period ?? 'current') === period)) ?? [], pageNo, presentation === 'production' ? 3 : 8);
  const batches = productionPage(data?.batches ?? [], pageNo, presentation === 'production' ? 3 : 8), canReadProduction = data?.scopes?.production === true;
  const riskView = view === 'risk' || !canReadProduction;
  const href = (planId: string, values: Record<string,string>) => `${routePath('page:production-execution', '/production-execution')}?${new URLSearchParams({ month, plan: planId, ...values })}`;
  const openQuality = (id: string | null) => setParams(previous => { const next = new URLSearchParams(previous); id ? next.set('riskQuality', id) : next.delete('riskQuality'); return next; }, { replace: true });
  const qualityId = params.get('riskQuality');
  const selectedQuality = data?.risks.find(row => row.target?.type === 'quality' && row.target.qualityId === qualityId);
  if (presentation === 'production') return <section className="cockpit-card cockpit-coordination" aria-label="交付风险与齐套">
    <div className="cockpit-section-title"><h2><span className="cockpit-risk-mark" aria-hidden="true">!</span>待处理问题与协调</h2><span>{data ? data.risks.length + ' 项待跟进' : '读取中'}</span></div>
    <div className="cockpit-risk-toolbar"><div role="group" aria-label="交付风险视图"><Button size="sm" variant={riskView ? 'secondary' : 'ghost'} aria-pressed={riskView} onClick={() => { setView('risk'); setPageNo(1); }}>问题协调</Button>{canReadProduction && <Button size="sm" variant={!riskView ? 'secondary' : 'ghost'} aria-pressed={!riskView} onClick={() => { setView('batches'); setPageNo(1); }}>批次齐套</Button>}</div><details><summary>筛选</summary><div className="cockpit-risk-filters"><NativeSelect aria-label="风险产品" value={product} onChange={event => { const value = event.target.value; setParams(previous => { const next = new URLSearchParams(previous); value ? next.set('riskProduct', value) : next.delete('riskProduct'); return next; }, { replace: true }); }}><option value="">全部产品</option>{data?.products.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</NativeSelect><NativeSelect aria-label="风险类型" value={kind} onChange={event => { setKind(event.target.value); setPageNo(1); }}><option value="all">全部风险</option>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</NativeSelect><NativeSelect aria-label="风险月份范围" value={period} onChange={event => { setPeriod(event.target.value); setPageNo(1); }}><option value="all">本月与跨月</option><option value="current">本月风险</option><option value="carryover">跨月未完</option></NativeSelect></div></details><Button size="sm" variant="ghost" onClick={() => setReload(value => value + 1)}>刷新风险</Button></div>
    {error ? <div className="production-inline-error" role="alert"><p>{error}</p><Button variant="outline" onClick={() => setReload(value => value + 1)}>重新读取风险</Button></div> : !data ? <p role="status" className="cockpit-loading">正在核对交付风险…</p> : riskView ? <>
      {!risks.total ? <ProductionEmpty title="当前范围暂无待处理风险" /> : <Table className="cockpit-risk-table"><TableHeader><TableRow>{['待办事项 / 影响生产单', '当前经办', '期限', '下一步'].map(label => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>{risks.rows.map(row => {
        const link = managementRiskHref(row, month);
        return <TableRow key={row.id}><TableCell><div className="cockpit-risk-title"><i data-kind={row.kind} /><strong>{row.title}</strong></div><p>{row.product} · {row.batchCodes.join('、') || labels[row.kind]}{row.period === 'carryover' ? ' · 跨月' : ''}</p></TableCell><TableCell>{row.owner || '待确认'}</TableCell><TableCell><time dateTime={row.dueDate || undefined}>{row.dueDate?.slice(5) || '待确认'}</time></TableCell><TableCell>{row.target?.type === 'quality' ? <Button size="sm" variant="ghost" onClick={() => openQuality(row.target!.type === 'quality' ? row.target!.qualityId : null)}>处理原记录</Button> : link ? <Link className="production-link" to={link}>处理原记录</Link> : <span>关联待确认</span>}</TableCell></TableRow>;
      })}</TableBody></Table>}<ProductionPagination {...risks} onPageChange={setPageNo} />
    </> : <>
      {!batches.total ? <ProductionEmpty title="暂无可核对的生产批次" /> : <Table className="cockpit-risk-table"><TableHeader><TableRow>{['产品 / 生产单', '当前可齐套', '按期可齐套', '依据'].map(label => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>{batches.rows.map(row => <TableRow key={row.id}><TableCell><strong>{row.product} · {row.code}</strong><p>需求 {row.date || '待确认'}</p></TableCell><TableCell>{row.current == null ? '待核对' : row.current + ' 套'}</TableCell><TableCell>{row.onTime == null ? '待核对' : row.onTime + ' 套'}</TableCell><TableCell><Link className="production-link" to={href(row.planId, { view: 'readiness', ...(row.batchId ? { readinessBatch: row.batchId } : {}) })}>查看依据</Link></TableCell></TableRow>)}</TableBody></Table>}<ProductionPagination {...batches} onPageChange={setPageNo} />
    </>}
    {data && <p className="cockpit-risk-footnote">含跨月未关闭事项 · {new Date(data.calculatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 更新</p>}
    {qualityId && !selectedQuality && data && <p role="alert" className="p-4 text-sm text-muted-foreground">所选质量异常不在当前授权风险范围。</p>}
    {qualityId && selectedQuality && <QualityAnalysisDialog id={qualityId} onClose={() => openQuality(null)} onSaved={() => setReload(value => value + 1)} />}
  </section>;

  return <section className="rounded-2xl border border-border bg-card" aria-label="交付风险与齐套">
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border p-4">
      <h2 className="text-base font-semibold">交付风险与齐套</h2>
      <div className="flex flex-wrap gap-2"><NativeSelect className="w-44" aria-label="风险产品" value={product} onChange={event => { const value = event.target.value; setParams(previous => { const next = new URLSearchParams(previous); value ? next.set('riskProduct', value) : next.delete('riskProduct'); return next; }, { replace: true }); }}><option value="">全部产品</option>{data?.products.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</NativeSelect><Button variant="outline" size="sm" onClick={() => setReload(n => n + 1)}>刷新</Button></div>
    </div>
    {data && canReadProduction && data.firstFinal && <div className="flex flex-wrap gap-x-8 gap-y-2 px-4 py-3 text-sm tabular-nums">
      <span className="text-muted-foreground">本月计划合格完成 <strong className="ml-2 text-foreground">{data.completed} 台</strong></span>
      <span className="text-muted-foreground">本月计划待完成 <strong className="ml-2 text-foreground">{data.remaining} 台</strong></span>
      <span className="text-muted-foreground">本月首次终检 <strong className="ml-2 text-foreground">{data.firstFinal.firstPassRate == null ? '暂无终检' : `${data.firstFinal.firstPassRate.toFixed(1)}%`}<span className="ml-2 font-normal">{data.firstFinal.goodQty} / {data.firstFinal.quantity}</span></strong></span>
    </div>}
    <div className="flex flex-wrap items-center gap-2 border-y border-border px-4 py-3">
      <div role="group" aria-label="交付风险视图" className="flex gap-1"><Button size="sm" variant={riskView ? 'secondary' : 'ghost'} aria-pressed={riskView} onClick={() => { setView('risk'); setPageNo(1); }}>待处理风险 {data?.risks.length ?? '—'}</Button>{canReadProduction && <Button size="sm" variant={!riskView ? 'secondary' : 'ghost'} aria-pressed={!riskView} onClick={() => { setView('batches'); setPageNo(1); }}>批次齐套</Button>}</div>
      {riskView && <><NativeSelect className="ml-auto w-40" aria-label="风险类型" value={kind} onChange={event => { setKind(event.target.value); setPageNo(1); }}><option value="all">全部类型</option>{Object.entries(labels).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</NativeSelect><NativeSelect className="w-36" aria-label="风险月份范围" value={period} onChange={event => { setPeriod(event.target.value); setPageNo(1); }}><option value="all">本月与跨月</option><option value="current">本月风险</option><option value="carryover">跨月未完</option></NativeSelect></>}
    </div>
    {error ? <p role="alert" className="p-4 text-sm text-destructive">{error}</p> : !data ? <p role="status" className="p-5 text-sm text-muted-foreground">正在核对正式业务…</p> : <>
      {riskView ? <><Table className="min-w-[820px]"><TableHeader><TableRow>{['风险 / 原记录','影响范围','当前经办','截止日期','操作'].map(label => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>{risks.rows.map(row => {
        const link = managementRiskHref(row, month), target = row.target;
        return <TableRow key={row.id}>
          <TableCell className="max-w-80 whitespace-normal"><p className="font-medium">{row.title}</p><p className="mt-1 text-xs text-muted-foreground">{labels[row.kind]} · {row.note}</p></TableCell>
          <TableCell><p>{row.product}</p><p className="mt-1 text-xs text-muted-foreground">{row.period === 'carryover' ? '跨月未完' : '本月'}{row.batchCodes.length ? ` · ${row.batchCodes.join('、')}` : ' · 未登记影响批次'}</p>{row.keyMaterialId && data.scopes.keyMaterials && <Link className="mt-1 inline-block text-xs text-primary hover:underline" to={`${routePath('page:proc-key-materials', '/proc-key-materials')}?${new URLSearchParams({ view: 'monthly', month, material: row.keyMaterialId })}`}>查看关键物料</Link>}</TableCell>
          <TableCell>{row.owner || '待确认'}</TableCell><TableCell>{row.dueDate || '待确认'}</TableCell>
          <TableCell>{target?.type === 'quality' ? <Button variant="outline" size="sm" onClick={() => openQuality(target.qualityId)}>处理原记录</Button> : link ? <Button asChild variant="outline" size="sm"><Link to={link}>处理原记录</Link></Button> : <span className="text-xs text-muted-foreground">原单关联待确认</span>}</TableCell>
        </TableRow>;
      })}</TableBody></Table>{!risks.total && <ProductionEmpty title="当前范围暂无待处理风险" />}<ProductionPagination {...risks} onPageChange={setPageNo} /></>
      : <><Table className="min-w-[850px]"><TableHeader><TableRow>{['产品 / 批次','需求日期','尚未完成','当前可齐套','按期可齐套','操作'].map(label => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>{batches.rows.map(row => <TableRow key={row.id}><TableCell className="max-w-80 whitespace-normal"><p className="font-medium">{row.product} · {row.code}</p><p className="mt-1 text-xs text-muted-foreground">{row.note}</p></TableCell><TableCell>{row.date || '待确认'}</TableCell><TableCell>{row.remaining} 台</TableCell><TableCell>{row.current == null ? '待核对' : `${row.current} 套`}</TableCell><TableCell>{row.onTime == null ? '待核对' : `${row.onTime} 套`}</TableCell><TableCell><Button asChild variant="outline" size="sm"><Link to={href(row.planId, { view: 'readiness', ...(row.batchId ? { readinessBatch: row.batchId } : {}) })}>查看依据</Link></Button></TableCell></TableRow>)}</TableBody></Table>{!batches.total && <ProductionEmpty title="当前范围暂无生产批次" />}<ProductionPagination {...batches} onPageChange={setPageNo} /></>}
      <details className="border-t border-border p-4 text-xs text-muted-foreground"><summary className="cursor-pointer">统计口径 · {new Date(data.calculatedAt).toLocaleString()}</summary><p className="mt-2 leading-5">{data.notice}{canReadProduction && ' 首次终检仅包含明确分类的终检；过程检、历史未分类与复验不会改写分母。各产品的套数分别查看，不跨产品加总。'}</p></details>
      {qualityId && !selectedQuality && <p role="alert" className="px-4 pb-4 text-sm text-muted-foreground">所选质量异常不在当前授权风险范围。</p>}
      {qualityId && selectedQuality && <QualityAnalysisDialog id={qualityId} onClose={() => openQuality(null)} onSaved={() => setReload(value => value + 1)} />}
    </>}
  </section>;
}
