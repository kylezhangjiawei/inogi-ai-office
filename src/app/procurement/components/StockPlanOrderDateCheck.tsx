import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { AutoTranslatedText } from '../../components/TranslatableText';
import { Button } from '../../components/ui/button';
import { cn } from '../../components/ui/utils';
import { useAnyPermission, usePermission } from '../../hooks/usePermission';
import { i18nLocale, useI18n } from '../../lib/i18n';
import { getProcStockPlanOrderDateCheck, type ProcStockPlanOrderDateCheckResponse, type ProcStockPlanOrderDateRow, type ProcStockPlanOrderDateSource, type ProcStockPlanOrderDateStatus } from '../../lib/procurementApi';
import './StockPlanOrderDateCheck.css';

const PAGE_SIZE = 10;
const DATE_LABELS: Record<ProcStockPlanOrderDateStatus, string> = {
  on_or_before_target: '可用日期不晚于计划日期',
  after_target: '可用日期晚于计划日期',
  target_missing: '计划日期未设置',
  unconfirmed: '可用日期未确认',
  cleared: '可用日期已撤销',
  needs_reconfirmation: '可用日期需重确认',
};

function timestamp(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString(i18nLocale(), {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }) : '—';
}

export function StockPlanOrderDateCheck({ planId, onOpenOrderLine }: {
  planId: string;
  onOpenOrderLine: (orderNo: string, lineId: string) => void;
}) {
  const { t } = useI18n();
  const canViewPlan = usePermission('page:proc-cockpit');
  const canViewOrders = useAnyPermission('page:purchase-orders', 'page:purchase-order-detail');
  const canRead = canViewPlan && canViewOrders;
  const canViewDetail = usePermission('page:purchase-order-detail');
  const permissionsRef = useRef({ canRead, canViewDetail });
  permissionsRef.current = { canRead, canViewDetail };
  const id = planId.trim();
  const [pagination, setPagination] = useState({ id, page: 1 });
  const page = pagination.id === id ? pagination.page : 1;
  const scope = JSON.stringify([canRead, id, page]);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const requestRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const [result, setResult] = useState<{ scope: string; request: number; data: ProcStockPlanOrderDateCheckResponse } | null>(null);
  const [failure, setFailure] = useState<{ scope: string; message: string } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { setPagination({ id, page: 1 }); }, [id]);

  const load = useCallback(async () => {
    if (!canRead || !id) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const request = ++requestRef.current;
    const isCurrent = () => requestRef.current === request && scopeRef.current === scope && !controller.signal.aborted;
    setLoading(true);
    setResult(null);
    setFailure(null);
    try {
      const data = await getProcStockPlanOrderDateCheck(id, { page, pageSize: PAGE_SIZE }, controller.signal);
      if (!isCurrent()) return;
      if (data.plan.id !== id) throw new Error(t('返回的计划与当前计划不一致，请重新读取。'));
      setResult({ scope, request, data });
    } catch (cause) {
      if (!isCurrent()) return;
      setFailure({ scope, message: cause instanceof Error ? cause.message : t('关联订单日期读取失败，请重试。') });
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [canRead, id, page, scope, t]);

  useEffect(() => {
    void load();
    return () => { requestRef.current += 1; controllerRef.current?.abort(); };
  }, [load]);

  const current = result?.scope === scope ? result : null;
  const error = failure?.scope === scope ? failure.message : '';
  const busy = Boolean(canRead && id && (loading || (!current && !error)));
  const rows = !busy && !error ? current?.data.rows : null;

  return <section aria-label={t('关联订单日期核对')} aria-busy={busy} className="proc-stock-order-date-check min-w-0 rounded-xl border border-slate-200 bg-white">
    <div className="flex items-center justify-between gap-3 px-4 pt-4">
      <h4 className="min-w-0 text-balance text-xs font-semibold text-slate-700">{t('关联订单日期核对')}</h4>
      {canRead && id ? <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void load()} aria-label={t('刷新本计划关联订单日期')} className="h-8 shrink-0 px-2 text-xs text-slate-600">
        <RefreshCw className="size-3.5" aria-hidden="true" />{t('刷新')}
      </Button> : null}
    </div>
    <p className="px-4 pb-3 pt-2 text-pretty text-xs leading-5 text-slate-500">{t('仅核对关联订单日期，不代表已分配数量或按期齐套。')}</p>
    {!canRead ? <p className="px-4 pb-4 text-pretty text-xs leading-5 text-slate-500">{t('暂无计划或采购订单查看权限。')}</p>
      : !id ? <p className="px-4 pb-4 text-pretty text-xs leading-5 text-slate-500">{t('计划信息缺失，暂无法核对关联订单日期。')}</p>
        : error ? <div className="border-t border-slate-100 px-4 py-3">
          <p role="alert" className="text-pretty text-xs leading-5 text-rose-700">{error}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void load()} className="mt-2 text-xs">{t('重新读取关联订单日期')}</Button>
        </div>
          : busy ? <div className="space-y-3 border-t border-slate-100 px-4 py-4" role="status">
            <span className="text-xs text-slate-500">{t('正在读取关联订单日期…')}</span>
            <div aria-hidden="true" className="h-24 rounded-lg bg-slate-50" />
          </div>
            : !rows?.items.length ? <p role="status" className="border-t border-slate-100 px-4 py-4 text-pretty text-xs leading-5 text-slate-500">{t('暂无可核对的订单关联。请在采购批次或采购任务中明确关联订单行。')}</p>
              : <>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-3">
                  <p className="text-xs text-slate-500 tabular-nums">{t('第 {page} / {pages} 页，共 {count} 条', { page: rows.page, pages: rows.totalPages, count: rows.total })}</p>
                  <div className="ml-auto flex gap-1">
                    <Button type="button" variant="outline" size="sm" disabled={rows.page <= 1} aria-label={t('上一页关联订单日期')} onClick={() => setPagination({ id, page: Math.max(1, rows.page - 1) })} className="h-8 px-2 text-xs">
                      <ChevronLeft className="size-3.5" aria-hidden="true" />{t('上一页')}
                    </Button>
                    <Button type="button" variant="outline" size="sm" disabled={rows.page >= rows.totalPages} aria-label={t('下一页关联订单日期')} onClick={() => setPagination({ id, page: rows.page + 1 })} className="h-8 px-2 text-xs">
                      {t('下一页')}<ChevronRight className="size-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
                <ul aria-label={t('本计划关联订单日期')} className="divide-y divide-slate-100 border-t border-slate-100">
                  {rows.items.map((row) => row.kind === 'line' ? <OrderDateCard key={row.key} row={row} targetDate={current?.data.plan.targetDate ?? null} canViewDetail={canViewDetail}
                    onOpen={() => {
                      if (scopeRef.current === scope && requestRef.current === current?.request && permissionsRef.current.canRead && permissionsRef.current.canViewDetail) onOpenOrderLine(row.orderNo, row.lineId);
                    }} /> : <li key={row.key} className="min-w-0 space-y-2 p-4">
                    <p className="break-all text-xs font-semibold text-slate-700">{row.orderNo || t('订单未明确')}{row.lineNo ? ` · ${t('行号')} ${row.lineNo}` : ''}</p>
                    <p className="break-words text-pretty text-xs leading-5 text-amber-800">{row.reason}</p>
                    <OrderSources sources={row.sources} />
                  </li>)}
                </ul>
              </>}
  </section>;
}

function OrderSources({ sources }: { sources: ProcStockPlanOrderDateSource[] }) {
  const { t } = useI18n();
  return <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs leading-5 text-slate-500">
    {sources.map((source) => <span key={`${source.kind}:${source.id}`} className="min-w-0 break-words">{t(source.kind === 'batch' ? '采购批次' : '采购任务')}：<AutoTranslatedText text={source.label || source.id} /></span>)}
  </div>;
}

function OrderDateCard({ row, targetDate, canViewDetail, onOpen }: {
  row: Extract<ProcStockPlanOrderDateRow, { kind: 'line' }>;
  targetDate: string | null;
  canViewDetail: boolean;
  onOpen: () => void;
}) {
  const { t } = useI18n();
  const availability = row.availability;
  const needsAttention = row.dateCheck === 'after_target' || row.dateCheck === 'needs_reconfirmation';
  return <li className="min-w-0 space-y-3 p-4">
    <div className="proc-stock-order-date-layout">
      <div className="proc-stock-order-date-identity min-w-0">
        <p className="break-all text-xs font-semibold text-slate-900 tabular-nums">{row.orderNo} · {t('行号')} {row.lineNo || t('未提供')}</p>
        <p className="mt-1 break-words text-xs leading-5 text-slate-600"><AutoTranslatedText text={row.supplierName || t('供应商未提供')} /></p>
        <p className="mt-1 break-words text-pretty text-xs leading-5 text-slate-500"><span className="tabular-nums">{row.inventoryCode}</span>{row.inventoryName ? <> · <AutoTranslatedText text={row.inventoryName} /></> : null}</p>
      </div>
      {canViewDetail ? <div className="proc-stock-order-date-action flex justify-end">
        <Button type="button" variant="outline" size="sm" disabled={!row.lineId || !row.orderNo} onClick={onOpen}
          aria-label={t('查看采购订单 {order} 第 {line} 行', { order: row.orderNo, line: row.lineNo || t('未提供') })} className="h-8 shrink-0 text-xs">{t('查看订单行')}</Button>
      </div> : null}
      <div className="proc-stock-order-date-comparison min-w-0">
        <dl className="proc-stock-order-date-values grid gap-x-4 gap-y-3 text-xs [&>div]:min-w-0 [&_dd]:break-words">
          <div><dt className="text-slate-500">{t('预计到货')}</dt><dd className="mt-1 font-medium text-slate-900 tabular-nums">{row.etaDate || t('未提供')}</dd></div>
          <div><dt className="text-slate-500">{t('人工预计检验后可用')}</dt><dd className="mt-1 font-medium text-slate-900 tabular-nums">{availability?.availableDate || '—'}</dd></div>
          <div><dt className="text-slate-500">{t('计划完成日期')}</dt><dd className="mt-1 font-medium text-slate-900 tabular-nums">{targetDate || t('未设置')}</dd></div>
        </dl>
        <div className="mt-2 space-y-1">
          <span className={cn('inline-block rounded px-1.5 py-0.5 text-xs', needsAttention ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-600')}>{t(DATE_LABELS[row.dateCheck])}</span>
          {row.dateCheck === 'needs_reconfirmation' ? <p className="text-pretty text-xs leading-5 text-amber-800">{t('订单来源已变化，请核对后重新确认日期。')}</p> : null}
        </div>
      </div>
    </div>
    <div className="space-y-1 border-t border-slate-100 pt-2 text-xs leading-5 text-slate-500">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <OrderSources sources={row.sources} />
        {availability ? <p className="min-w-0 break-words text-pretty">{t('确认人')}：{availability.confirmedByName || t('未提供')} · <span className="tabular-nums">{timestamp(availability.confirmedAt)}</span></p> : null}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs leading-5 text-slate-500">
        <span className="min-w-0 break-words">{t('ERP 状态')}：{row.orderStatus || t('未提供')}</span>
        {row.approvalStatus ? <span className="min-w-0 break-words">{t('审批')}：{row.approvalStatus}</span> : null}
        <span className="tabular-nums">{t('最近同步')}：{timestamp(row.syncedAt)}</span>
        {availability?.note ? <details className="proc-stock-order-date-note min-w-0"><summary className="cursor-pointer rounded text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('查看确认说明')}</summary><p className="mt-1 whitespace-pre-wrap break-words text-pretty">{availability.note}</p></details> : null}
      </div>
    </div>
  </li>;
}
