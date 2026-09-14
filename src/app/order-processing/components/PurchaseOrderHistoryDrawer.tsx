import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, History, LocateFixed, RefreshCw } from 'lucide-react';
import { useAuth } from '../../auth';
import { Button } from '../../components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../../components/ui/sheet';
import { usePermission } from '../../hooks/usePermission';
import { fetchAuditLogPage } from '../../lib/auditLog';
import { i18nLocale, useI18n } from '../../lib/i18n';
import type { PurchaseOrderLine } from '../../lib/orderProcessingApi';
import { historyValueText, purchaseOrderHistoryQuery, readPurchaseOrderHistoryPage, type HistoryChange, type PurchaseOrderHistoryPage } from '../history/purchaseOrderHistoryModel';
import './purchase-order-history.css';

function timeLabel(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString(i18nLocale(), { timeZone: 'Asia/Shanghai', hour12: false }) : '—';
}

function ChangeRow({ label, change, field }: { label: string; change: HistoryChange; field: 'date' | 'note' | 'version' }) {
  const { t } = useI18n();
  return <div className="po-history-change">
    <dt>{label}</dt>
    <dd><span className="po-history-side">{t('变更前')}</span><span>{t(historyValueText(change.before, field))}</span></dd>
    <dd><span className="po-history-side">{t('变更后')}</span><span>{t(historyValueText(change.after, field))}</span></dd>
  </div>;
}

export function PurchaseOrderHistoryDrawer({ orderId, orderNo, line, onClose, onLocateLine, onCloseAutoFocus }: {
  orderId: string; orderNo: string; line: PurchaseOrderLine;
  onClose: () => void; onLocateLine: () => void; onCloseAutoFocus?: (event: Event) => void;
}) {
  const { t } = useI18n();
  const { user } = useAuth();
  const canViewOrder = usePermission('page:purchase-order-detail');
  const canViewAudit = usePermission('page:audit-log');
  const canRead = canViewOrder && canViewAudit && Boolean(user?.id && line.id);
  // Changes to account or any permission invalidate former results, even if the two page rights remain.
  const scope = JSON.stringify([orderId, orderNo, line.id, line.sourceUpdatedAt, line.availability?.version,
    user?.id, user?.name, [...(user?.permissions ?? [])].sort(), canRead]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const sequence = useRef(0);
  const [loaded, setLoaded] = useState<{ scope: string; value: PurchaseOrderHistoryPage; readAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retryPage, setRetryPage] = useState(1);
  const [retryFresh, setRetryFresh] = useState(false);
  const data = canRead && loaded?.scope === scope ? loaded.value : null;

  async function load(page = 1, fresh = false) {
    if (!canRead || currentScope.current !== scope) return;
    const request = ++sequence.current;
    setBusy(true); setError(''); setRetryPage(page); setRetryFresh(fresh);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const query = purchaseOrderHistoryQuery(line.id, page, !fresh && data ? data : undefined);
      const reply = await Promise.race([
        fetchAuditLogPage(query),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error(t('日期确认记录读取超时，请重试。'))), 30_000); }),
      ]);
      if (request !== sequence.current || currentScope.current !== scope) return;
      const value = readPurchaseOrderHistoryPage(reply, line.id);
      setLoaded({ scope, value, readAt: new Date().toISOString() });
    } catch (cause) {
      if (request !== sequence.current || currentScope.current !== scope) return;
      setError(cause instanceof Error ? cause.message : t('日期确认记录读取失败，请重试。'));
    } finally {
      if (timeout) clearTimeout(timeout);
      if (request === sequence.current && currentScope.current === scope) setBusy(false);
    }
  }

  useEffect(() => {
    setLoaded(null); setError(''); setBusy(false); setRetryPage(1); setRetryFresh(false);
    void load();
    return () => { sequence.current += 1; };
    // Each request captures this account, permission and exact order-line scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
    <SheetContent className="po-history-drawer" onCloseAutoFocus={onCloseAutoFocus}>
      <SheetHeader className="border-b border-slate-100">
        <SheetTitle className="flex items-center gap-2"><History className="size-5 text-blue-700" />{t('检验后可用日期确认记录')}</SheetTitle>
        <SheetDescription className="break-words">{canViewOrder ? <>{orderNo} · {t('行号')} {line.lineNo || '—'} · {line.name} · {line.sku}</> : t('订单查看权限已变化')}</SheetDescription>
      </SheetHeader>
      <div className="po-history-body">
        {canViewOrder ? <section className="po-history-source" aria-label={t('本次载入的订单日期')}>
          <dl className="po-history-dates">
            <div><dt>{t('供应商原承诺日')}</dt><dd>{t('见供应商承诺与 ERP 交期记录')}</dd></div>
            <div><dt>{t('ERP 当前预计到货')}</dt><dd>{line.etaDate || t('待确认')}</dd></div>
            <div><dt>{t('人工预计检验后可用')}</dt><dd>{line.availability?.availableDate || t(line.availability ? '已撤销日期确认' : '未确认')}</dd></div>
          </dl>
          {line.availability ? <p className="mt-3 text-xs leading-5 text-slate-500">{t('当前确认版本')} {line.availability.version} · {line.availability.confirmedByName || t('未记录确认人')} · {timeLabel(line.availability.confirmedAt)}</p> : null}
          {line.availability?.needsReconfirmation ? <p className="mt-2 text-sm text-amber-700">{t('订单来源已变化，当前人工可用日期需重确认。')}</p> : null}
          <p className="mt-2 text-xs leading-5 text-slate-500">{t('日期来自本次载入的订单。以下仅追溯人工可用日期确认，不是供应商交期变更记录；首条确认不能作为原承诺日。')}</p>
        </section> : null}
        {!canViewOrder ? <p role="status" className="po-history-notice">{t('没有采购订单详情查看权限，无法读取记录。')}</p>
          : !canViewAudit ? <p role="status" className="po-history-notice">{t('查看确认记录需要操作留痕查看权限。订单明细和当前日期仍可在原页查看。')}</p>
            : !canRead ? <p role="status" className="po-history-notice">{t('订单行或账号信息不完整，请关闭后重新打开。')}</p>
              : <>
                <p className="text-xs leading-5 text-slate-500">{t('仅展示当前账号可见的记录，可能不是该订单行的全部历史。未找到记录不代表从未修改。')}</p>
                <div className="po-history-controls">
                  <Button type="button" variant="outline" disabled={busy} onClick={() => void load(1, true)}><RefreshCw className="size-4" />{t('刷新记录')}</Button>
                  {data ? <nav aria-label={t('确认记录翻页')} className="flex items-center gap-2">
                    <Button type="button" variant="outline" aria-label={t('上一页确认记录')} disabled={busy || data.page <= 1} onClick={() => void load(data.page - 1)}><ChevronLeft className="size-4" /></Button>
                    <span className="text-sm tabular-nums">{data.page} / {pageCount}</span>
                    <Button type="button" variant="outline" aria-label={t('下一页确认记录')} disabled={busy || data.page >= pageCount} onClick={() => void load(data.page + 1)}><ChevronRight className="size-4" /></Button>
                  </nav> : null}
                </div>
                {error ? <div role="alert" className="po-history-error"><p>{error}</p>{data ? <p>{t('仍显示上次成功读取的第 {page} 页，请重试后核对最新记录。', { page: data.page })}</p> : null}<Button type="button" variant="outline" disabled={busy} onClick={() => void load(retryPage, retryFresh)}>{t('重试读取记录')}</Button></div> : null}
                {busy ? <p role="status" aria-live="polite" className="text-sm text-slate-500">{t('正在读取确认记录…')}</p> : null}
                {data ? <>
                  <p className="text-xs leading-5 text-slate-500">{t('可见记录 {count} 条', { count: data.total })} · {t('记录截止')} {timeLabel(data.snapshotAt)}<br />{t('上次读取')} {timeLabel(loaded!.readAt)}</p>
                  {!data.entries.length ? <p role="status" className="po-history-notice">{t('当前可见范围内暂无日期确认记录。')}</p> : <ol className="po-history-list" aria-label={t('日期确认记录列表')}>
                    {data.entries.map((entry) => <li key={entry.id} className="po-history-entry">
                      <div className="po-history-entry-heading"><strong>{entry.actor || t('未记录操作人')}</strong><time dateTime={entry.timestamp}>{timeLabel(entry.timestamp)}</time></div>
                      <dl>
                        <ChangeRow label={t('可用日期')} field="date" change={entry.availableDate} />
                        <ChangeRow label={t('确认说明')} field="note" change={entry.note} />
                        <ChangeRow label={t('确认版本')} field="version" change={entry.version} />
                      </dl>
                      <p className="mt-3 text-xs leading-5 text-slate-500">{t('来源')}：{t(entry.source === 'web' ? '网页人工确认' : entry.source === 'api' ? '接口记录' : entry.source === 'system' ? '系统记录' : entry.source === 'ai' ? 'AI 记录' : '未识别来源')}{entry.sourceChanged === true ? ` · ${t('本次确认所依据的订单来源发生变化')}` : ''}</p>
                    </li>)}
                  </ol>}
                </> : null}
              </>}
      </div>
      <div className="po-history-footer"><Button type="button" variant="outline" onClick={onClose}>{t('关闭')}</Button><Button type="button" disabled={!canViewOrder || !line.id} onClick={onLocateLine}><LocateFixed className="size-4" />{t('返回原订单行')}</Button></div>
    </SheetContent>
  </Sheet>;
}
