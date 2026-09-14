import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { AutoTranslatedText } from '../../components/TranslatableText';
import { Button } from '../../components/ui/button';
import { cn } from '../../components/ui/utils';
import { useAnyPermission, usePermission } from '../../hooks/usePermission';
import { i18nLocale, useI18n } from '../../lib/i18n';
import { orderProcessingApi, type MaterialPurchaseOrderLine, type MaterialPurchaseOrderLinesResponse } from '../../lib/orderProcessingApi';

const PAGE_SIZE = 10;

function quantity(value: number) {
  return Number.isFinite(value) ? value.toLocaleString(i18nLocale(), { maximumFractionDigits: 3 }) : '—';
}

function timestamp(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString(i18nLocale(), {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }) : '—';
}

export function MaterialPurchaseOrderLines({ inventoryCode, onOpenOrderLine }: {
  inventoryCode: string;
  onOpenOrderLine: (orderNo: string, lineId: string) => void;
}) {
  const { t } = useI18n();
  const canRead = useAnyPermission('page:purchase-orders', 'page:purchase-order-detail');
  const canViewDetail = usePermission('page:purchase-order-detail');
  const code = inventoryCode.trim();
  const [pagination, setPagination] = useState({ code, page: 1 });
  const page = pagination.code === code ? pagination.page : 1;
  const scope = JSON.stringify([canRead, code, page]);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const requestRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const [result, setResult] = useState<{ scope: string; data: MaterialPurchaseOrderLinesResponse } | null>(null);
  const [failure, setFailure] = useState<{ scope: string; message: string } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { setPagination({ code, page: 1 }); }, [code]);

  const load = useCallback(async () => {
    if (!canRead || !code) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const request = ++requestRef.current;
    const isCurrent = () => request === requestRef.current && scopeRef.current === scope && !controller.signal.aborted;
    setLoading(true);
    setResult(null);
    setFailure(null);
    try {
      const data = await orderProcessingApi.getMaterialPurchaseOrderLines({ inventoryCode: code, page, pageSize: PAGE_SIZE }, controller.signal);
      if (!isCurrent()) return;
      if (data.inventoryCode !== code || data.lines.items.some((line) => line.inventoryCode !== code)) {
        throw new Error(t('返回的物料编码与当前物料不一致，请重新读取。'));
      }
      setResult({ scope, data });
    } catch (cause) {
      if (!isCurrent()) return;
      setFailure({ scope, message: cause instanceof Error ? cause.message : t('物料采购订单读取失败，请重试。') });
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [canRead, code, page, scope, t]);

  useEffect(() => {
    void load();
    return () => { requestRef.current += 1; controllerRef.current?.abort(); };
  }, [load]);

  const data = result?.scope === scope ? result.data : null;
  const error = failure?.scope === scope ? failure.message : '';
  const busy = Boolean(canRead && code && (loading || (!data && !error)));
  const lines = !busy && !error ? data?.lines : null;

  return <section aria-label={t('采购订单与可用日期')} aria-busy={busy} className="min-w-0 rounded-xl border border-slate-200 bg-white">
    <div className="flex items-center justify-between gap-3 px-4 pt-4">
      <h3 className="min-w-0 text-balance text-xs font-bold text-slate-900">{t('采购订单与可用日期')}</h3>
      {canRead && code ? <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void load()} aria-label={t('刷新当前物料的采购订单')} className="h-8 shrink-0 px-2 text-xs text-slate-600">
        <RefreshCw className="size-3.5" aria-hidden="true" />{t('刷新')}
      </Button> : null}
    </div>
    <p className="px-4 pb-3 pt-2 text-pretty text-xs leading-5 text-slate-500">{t('同编码订单记录，不代表本计划已获配数量；不参与当前齐套计算。')}</p>
    {!canRead ? <p className="px-4 pb-4 text-pretty text-xs leading-5 text-slate-500">{t('暂无采购订单查看权限。')}</p>
      : !code ? <p className="px-4 pb-4 text-pretty text-xs leading-5 text-slate-500">{t('物料编码待补充，补齐后可查看同编码订单记录。')}</p>
        : error ? <div className="border-t border-slate-100 px-4 py-3">
          <p role="alert" className="text-pretty text-xs leading-5 text-rose-700">{error}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void load()} className="mt-2 text-xs">{t('重新读取采购订单')}</Button>
        </div>
          : busy ? <div className="space-y-3 border-t border-slate-100 px-4 py-4" role="status">
            <span className="text-xs text-slate-500">{t('正在读取同编码订单…')}</span>
            <div aria-hidden="true" className="h-24 rounded-lg bg-slate-50" />
          </div>
            : !lines?.items.length ? <p role="status" className="border-t border-slate-100 px-4 py-4 text-pretty text-xs leading-5 text-slate-500">{t('暂无同编码订单记录。记录来自已同步的 ERP 订单，不代表该物料没有采购安排。')}</p>
              : <>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-3">
                  <p className="text-xs text-slate-500 tabular-nums">{t('第 {page} / {pages} 页，共 {count} 行', { page: lines.page, pages: lines.totalPages, count: lines.total })}</p>
                  <div className="flex gap-1">
                    <Button type="button" variant="outline" size="sm" disabled={lines.page <= 1} aria-label={t('上一页采购订单行')} onClick={() => setPagination({ code, page: Math.max(1, lines.page - 1) })} className="h-8 px-2 text-xs">
                      <ChevronLeft className="size-3.5" aria-hidden="true" />{t('上一页')}
                    </Button>
                    <Button type="button" variant="outline" size="sm" disabled={lines.page >= lines.totalPages} aria-label={t('下一页采购订单行')} onClick={() => setPagination({ code, page: lines.page + 1 })} className="h-8 px-2 text-xs">
                      {t('下一页')}<ChevronRight className="size-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
                <ul aria-label={t('同编码采购订单行')} className="divide-y divide-slate-100 border-t border-slate-100">
                  {lines.items.map((line) => <OrderLineCard key={line.id} line={line} canViewDetail={canViewDetail}
                    onOpen={() => { if (scopeRef.current === scope) onOpenOrderLine(line.orderNo, line.id); }} />)}
                </ul>
              </>}
  </section>;
}

function OrderLineCard({ line, canViewDetail, onOpen }: { line: MaterialPurchaseOrderLine; canViewDetail: boolean; onOpen: () => void }) {
  const { t } = useI18n();
  const availability = line.availability;
  const availabilityLabel = availability?.needsReconfirmation ? '需重确认' : !availability ? '未确认' : availability.availableDate ? '已确认' : '已撤销';
  return <li className="min-w-0 space-y-3 p-4">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0 flex-1 basis-40">
        <p className="break-all text-xs font-semibold text-slate-900 tabular-nums">{line.orderNo} · {t('行号')} {line.lineNo || t('未提供')}</p>
        <p className="mt-1 break-words text-xs leading-5 text-slate-600"><AutoTranslatedText text={line.supplierName || t('供应商未提供')} /></p>
      </div>
      {canViewDetail ? <Button type="button" variant="outline" size="sm" onClick={onOpen} disabled={!line.id || !line.orderNo}
        aria-label={t('查看采购订单 {order} 第 {line} 行', { order: line.orderNo, line: line.lineNo || t('未提供') })} className="ml-auto h-8 shrink-0 text-xs">{t('查看订单行')}</Button> : null}
    </div>
    <p className="break-words text-pretty text-xs leading-5 text-slate-500"><AutoTranslatedText text={[line.inventoryName, line.spec].filter(Boolean).join(' · ')} /></p>
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs [&>div]:min-w-0 [&_dd]:break-words">
      <div><dt className="text-slate-500">{t('采购量')}</dt><dd className="mt-1 font-medium text-slate-900 tabular-nums">{quantity(line.orderedQty)} {line.unit}</dd></div>
      <div><dt className="text-slate-500">{t('ERP 已到货')}</dt><dd className="mt-1 font-medium text-slate-900 tabular-nums">{quantity(line.receivedQty)} {line.unit}</dd></div>
      <div><dt className="text-slate-500">{t('预计到货')}</dt><dd className="mt-1 font-medium text-slate-900 tabular-nums">{line.etaDate || t('待确认')}</dd></div>
      <div><dt className="text-slate-500">{t('预计检验后可用')}</dt><dd className="mt-1 font-medium text-slate-900 tabular-nums">{availability?.availableDate || '—'}</dd>
        <span className={cn('mt-1 inline-block rounded px-1.5 py-0.5 text-xs', availability?.needsReconfirmation ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-600')}>{t(availabilityLabel)}</span>
      </div>
    </dl>
    {availability ? <div className="space-y-1 text-xs leading-5 text-slate-500">
      <p className="break-words text-pretty">{t('确认人')}：{availability.confirmedByName || t('未提供')} · <span className="tabular-nums">{timestamp(availability.confirmedAt)}</span></p>
      {availability.needsReconfirmation ? <p className="text-pretty text-amber-800">{t('订单来源已变化，请核对后重新确认日期。')}</p> : null}
      {availability.note ? <details><summary className="cursor-pointer rounded text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('查看确认说明')}</summary><p className="mt-1 whitespace-pre-wrap break-words text-pretty">{availability.note}</p></details> : null}
    </div> : null}
    <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-slate-100 pt-2 text-xs leading-5 text-slate-500">
      <span className="min-w-0 break-words">{t('ERP 状态')}：{line.status || t('未提供')}</span>
      {line.approvalStatus ? <span className="min-w-0 break-words">{t('审批')}：{line.approvalStatus}</span> : null}
      <span className="tabular-nums">{t('下单')}：{line.orderDate || '—'}</span>
      <span className="tabular-nums">{t('最近同步')}：{timestamp(line.syncedAt)}</span>
    </div>
  </li>;
}
