import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useAuth } from '../../auth';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { NativeSelect } from '../../components/ui/native-select';
import { useI18n } from '../../lib/i18n';
import { getProcurementDecision, type ProcurementDecision } from '../../lib/procurementDecisionApi';
import type { ProcurementTask } from '../data';

export function ProcurementDecisionPanel({ task, compact = false }: { task: ProcurementTask; compact?: boolean }) {
  const { t } = useI18n(), { user } = useAuth();
  const context = JSON.stringify([task.id, task.updatedAt, user?.id, [...(user?.permissions ?? [])].sort()]);
  const [selection, setSelection] = useState({ context, plan: '', batch: '', date: task.needDate || '' });
  const selected = selection.context === context ? selection : { context, plan: '', batch: '', date: task.needDate || '' };
  const queryKey = JSON.stringify([context, selected.plan, selected.batch, selected.date]);
  const [stored, setStored] = useState<{ context: string; key: string; value: ProcurementDecision } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null), [loadingKey, setLoadingKey] = useState(''), [refresh, setRefresh] = useState(0);
  const directory = stored?.context === context ? stored.value : null, data = stored?.key === queryKey && !failure ? stored.value : null;
  const error = failure?.key === queryKey ? failure.message : '';
  const loading = loadingKey === queryKey;
  useEffect(() => {
    const abort = new AbortController(); setFailure(null);
    if (selected.plan && !selected.date) { setLoadingKey(''); return () => abort.abort(); }
    setLoadingKey(queryKey);
    void getProcurementDecision(task.id, { planId: selected.plan || undefined, batchId: selected.batch || undefined, date: selected.date || undefined }, abort.signal)
      .then(value => { if (!abort.signal.aborted) setStored({ context, key: queryKey, value }); })
      .catch(cause => { if (!abort.signal.aborted) setFailure({ key: queryKey, message: cause instanceof Error ? cause.message : t('采购决策读取失败') }); })
      .finally(() => { if (!abort.signal.aborted) setLoadingKey(''); });
    return () => abort.abort();
  }, [context, queryKey, task.id, selected.plan, selected.batch, selected.date, refresh, t]);
  const plan = directory?.candidates.find(row => row.id === selected.plan);
  const value = (quantity: number | null | undefined) => quantity == null ? t('待核对') : `${quantity.toLocaleString()} ${t(task.unit)}`;
  const facts = [{ key: 'shortage', label: '当前缺料', note: '计划剩余需求扣除当前可用' }, { key: 'unaccepted', label: '本任务未验收', note: '关联订单净订购减确认合格' }, { key: 'covered', label: '按期可覆盖', note: '已分配且预计可用日不晚于需求日' }, { key: 'suggested', label: '建议新增采购', note: '缺料扣除按期可覆盖' }] as const;
  return <section className={compact ? 'border-b border-border p-4' : 'rounded-xl border border-border p-4 sm:p-5'} aria-label={t('净采购决策')}>
    <div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">{t('净采购决策')}</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">{t('先确定计划、批次与需求日，再判断是否需要新增采购。')}</p></div><Button type="button" size="icon" variant="ghost" aria-label={t('刷新采购决策')} disabled={loading} onClick={() => setRefresh(current => current + 1)}><RefreshCw className="size-4" /></Button></div>
    <div className={`mt-4 grid gap-3 ${compact ? '' : 'sm:grid-cols-3'}`}><label className="space-y-1 text-xs text-muted-foreground"><span>{t('正式计划')}</span><NativeSelect value={selected.plan} onChange={event => setSelection({ ...selected, plan: event.target.value, batch: '' })}><option value="">{t(directory?.candidates.length ? '请选择计划' : '暂无匹配计划')}</option>{directory?.candidates.map(row => <option key={row.id} value={row.id}>{row.month} · {row.productName}</option>)}</NativeSelect></label><label className="space-y-1 text-xs text-muted-foreground"><span>{t('批次范围')}</span><NativeSelect disabled={!plan} value={selected.batch} onChange={event => setSelection({ ...selected, batch: event.target.value })}><option value="">{t('整月计划')}</option>{plan?.batches.map(row => <option key={row.id} value={row.id}>{row.code} · {row.dueDate}</option>)}</NativeSelect></label><label className="space-y-1 text-xs text-muted-foreground"><span>{t('需求日期')}</span><Input type="date" value={selected.date} onChange={event => setSelection({ ...selected, date: event.target.value })} /></label></div>
    {loading && <p role="status" className="mt-3 text-xs text-muted-foreground">{t('正在核对库存、订单分配与可用日期…')}</p>}
    {error && <p role="alert" className="mt-3 text-xs text-rose-700">{error}</p>}
    {!loading && !error && !selected.plan && <p className="mt-3 text-xs leading-5 text-muted-foreground">{directory?.problems.length ? directory.problems.map(problem => t(problem)).join('；') : t('计划需要明确选择，任务需求数量不会直接当作缺料。')}</p>}
    {selected.plan && !selected.date && <p role="alert" className="mt-3 text-xs text-amber-700">{t('请明确需求日期后核对按期覆盖。')}</p>}
    <dl className={`mt-4 grid grid-cols-2 gap-x-4 gap-y-4 border-t border-border pt-4 ${compact ? '' : 'lg:grid-cols-4'}`}>{facts.map(fact => <div key={fact.key}><dt className="text-xs text-muted-foreground">{t(fact.label)}</dt><dd className={`mt-1 text-base font-semibold tabular-nums ${fact.key === 'suggested' && data?.suggested ? 'text-primary' : ''}`}>{loading || error ? t('待核对') : value(data?.[fact.key])}</dd><p className="mt-1 text-xs leading-5 text-muted-foreground">{t(fact.note)}</p></div>)}</dl>
    {data && [...data.problems, ...data.orderProblems].length > 0 && <ul role="status" className="mt-3 space-y-1 text-xs leading-5 text-amber-700">{[...new Set([...data.problems, ...data.orderProblems])].map(problem => <li key={problem}>{t(problem)}</li>)}</ul>}
    {data?.basis && !loading && <details className="mt-4 border-t border-border pt-3"><summary className="cursor-pointer text-xs font-medium text-muted-foreground">{t('查看计算依据')} · {data.code} · {t('计划版本')} {data.basis.planVersion}</summary><dl className="mt-3 grid grid-cols-2 gap-3 text-xs"><div><dt className="text-muted-foreground">{t('计划剩余物料需求')}</dt><dd className="mt-1 tabular-nums">{value(data.basis.remainingDemand)}</dd></div><div><dt className="text-muted-foreground">{t('当前可用（含确认线边余料）')}</dt><dd className="mt-1 tabular-nums">{value(data.basis.current)}</dd></div><div><dt className="text-muted-foreground">{t('库存待回写扣减')}</dt><dd className="mt-1 tabular-nums">{value(data.basis.warehousePending)}</dd></div><div><dt className="text-muted-foreground">{t('其他计划占用')}</dt><dd className="mt-1 tabular-nums">{value(data.basis.otherReserved)}</dd></div></dl><p className="mt-3 text-xs leading-5 text-muted-foreground">{t('按期覆盖仅计入本计划已确认分配，供应商最新改期、检验可用日期及共享分配变化会重新核对。')} {t('未计入预计覆盖的订单行')}：{data.basis.excludedOrders}</p><p className="mt-2 text-xs leading-5 text-muted-foreground">{t('本任务未验收只统计本任务关联的正式订单；收货不等于合格，不良和待判仍未完成验收。')}</p>{data.basis.orders.map(order => <div key={`${order.orderNo}:${order.lineNo}`} className="mt-3 border-t border-border pt-2 text-xs leading-5"><p className="font-medium">{order.orderNo} · {t('行号')} {order.lineNo}</p><p className="text-muted-foreground">{t('净订购')} {value(order.ordered)} · {t('已确认合格')} {value(order.qualified)} · {t('未验收')} {value(order.unaccepted)}</p></div>)}</details>}
  </section>;
}
