import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { CalendarDays, ChevronDown, RefreshCw } from 'lucide-react';
import { useAuth } from '../../auth';
import { Button } from '../../components/ui/button';
import { useI18n } from '../../lib/i18n';
import { buildPurchaseOrderLinePath } from '../../lib/purchaseOrderLineNavigation';
import { buildPurchaseDeliveryReturnPath } from '../../lib/purchaseDeliveryNavigation';
import { getDeliverySchedule, isDeliveryDay, PURCHASE_DELIVERY_CHANGED, type DeliverySchedule, type DeliveryScheduleRow } from '../../lib/purchaseDeliveryApi';
import { PurchaseOrderDeliveryDrawer } from './PurchaseOrderDeliveryDrawer';
import { deliveryGanttSegment, deliveryMonthGrid, isDeliveryMonth } from './deliveryScheduleModel';
import './delivery-schedule.css';
import { Input } from "../../components/ui/input";

export function ProcurementDeliverySchedule() {
  const { user } = useAuth();
  return <DeliveryScheduleContent key={JSON.stringify([user?.id, [...(user?.permissions ?? [])].sort()])} />;
}
function DeliveryScheduleContent() {
  const { t } = useI18n(), { user } = useAuth(), navigate = useNavigate(), location = useLocation();
  const [params, setParams] = useSearchParams();
  const canRead = (user?.permissions ?? []).some((permission) => ['*', 'page:purchase-orders', 'page:purchase-order-detail'].includes(permission));
  const open = params.get('deliveryOpen') === 'true';
  const defaultMonth = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 7), rawMonth = params.get('deliveryMonth') ?? '';
  const month = isDeliveryMonth(rawMonth) ? rawMonth : defaultMonth;
  const bucket = (['month', 'all', 'undated', 'outside'].includes(params.get('deliveryBucket') || '') ? params.get('deliveryBucket') : 'month') as 'month' | 'all' | 'undated' | 'outside';
  const rawDay = params.get('deliveryDay'), date = isDeliveryDay(rawDay) && rawDay.startsWith(month + '-') ? rawDay : undefined;
  const query = params.get('deliveryQ') || '', supplier = params.get('deliverySupplier') || '';
  const view = params.get('deliveryView') === 'gantt' ? 'gantt' : 'calendar';
  const requestedPage = Number(params.get('deliveryPage')), page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const scope = JSON.stringify([open, month, bucket, date, query, supplier]);
  const currentScope = useRef(scope); currentScope.current = scope;
  const [loaded, setLoaded] = useState<{ scope: string; value: DeliverySchedule } | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [revision, setRevision] = useState(0), [selected, setSelected] = useState<DeliveryScheduleRow | null>(null);
  const generation = useRef(0), snapshot = useRef<{ scope: string; value: string } | null>(null), trigger = useRef<HTMLButtonElement | null>(null);
  const data = loaded?.scope === scope ? loaded.value : null;
  const grid = useMemo(() => deliveryMonthGrid(month, data?.days ?? []), [month, data?.days]);
  const [search, setSearch] = useState(query), [supplierInput, setSupplierInput] = useState(supplier);
  const rowRegion = useRef<HTMLDivElement>(null), handledReturn = useRef<string | null>(null);
  const focusLine = params.get('deliveryFocus');
  function patch(values: Record<string, string | null>) {
    setParams((current) => { const next = new URLSearchParams(current); for (const [key, value] of Object.entries(values)) { if (value === null) next.delete(key); else next.set(key, value); } return next; }, { replace: true });
  }
  const filter = (values: Record<string, string | null>) => patch({ deliveryPage: '1', deliveryFocus: null, ...values });
  const refresh = () => { snapshot.current = null; setRevision((value) => value + 1); };
  useEffect(() => { setSearch(query); setSupplierInput(supplier); }, [query, supplier]);
  useEffect(() => { window.addEventListener(PURCHASE_DELIVERY_CHANGED, refresh); return () => window.removeEventListener(PURCHASE_DELIVERY_CHANGED, refresh); }, []);
  useEffect(() => {
    if (!open || !canRead) return;
    const controller = new AbortController(), current = ++generation.current;
    setLoading(true); setError('');
    const token = snapshot.current?.scope === scope && page > 1 ? snapshot.current.value : undefined;
    void getDeliverySchedule({ month, bucket, date, q: query, supplier, page, pageSize: 20, snapshot: token }, controller.signal).then((value) => {
      if (controller.signal.aborted || current !== generation.current || currentScope.current !== scope) return;
      snapshot.current = { scope, value: value.snapshot }; setLoaded({ scope, value });
    }).catch((cause) => { if (!controller.signal.aborted && current === generation.current) { setError(cause instanceof Error ? cause.message : t('ERP 交期读取失败')); setLoaded(null); } })
      .finally(() => { if (!controller.signal.aborted && current === generation.current) setLoading(false); });
    return () => { controller.abort(); generation.current++; };
  }, [scope, page, revision, canRead]);
  useEffect(() => {
    if (!focusLine || !data || loading || selected || handledReturn.current === location.key) return;
    const element = Array.from(rowRegion.current?.querySelectorAll<HTMLButtonElement>('[data-delivery-line-id]') ?? []).find((item) => item.dataset.deliveryLineId === focusLine);
    if (element) { element.focus({ preventScroll: true }); element.scrollIntoView({ block: 'center', behavior: 'auto' }); handledReturn.current = location.key; }
  }, [data, loading, focusLine, location.key, selected]);
  function showDelivery(row: DeliveryScheduleRow, button: HTMLButtonElement) {
    if (loading || !data?.rows.items.some((item) => item.lineId === row.lineId && item.orderNo === row.orderNo)) return;
    trigger.current = button; setSelected(row);
  }
  function showOrder(row: DeliveryScheduleRow) {
    const destination = buildPurchaseOrderLinePath(row.orderNo, row.lineId), source = buildPurchaseDeliveryReturnPath(params, row.lineId);
    if (!destination || !source || loading) return;
    navigate(source, { replace: true }); navigate(destination, { state: { purchaseDeliveryReturnTo: source, purchaseDeliveryHistoryBack: true } });
  }
  return <section className="delivery-schedule" aria-label={t('ERP 交期日历与甘特')}>
    <div className="delivery-schedule-heading"><div><h2><CalendarDays size={18} aria-hidden="true" />{t('ERP 交期日历与甘特')}</h2><p>{t('按订单镜像查看全部可见订单行，包含尚未关联采购任务的记录。')}</p></div><Button variant="outline" onClick={() => patch({ deliveryOpen: open ? null : 'true' })} aria-expanded={open}><ChevronDown size={16} />{t(open ? '收起' : '展开交期视图')}</Button></div>
    {open ? !canRead ? <p role="status" className="delivery-schedule-notice">{t('需要采购订单查看权限才能读取全量镜像日期；本人任务关联到货仍可在原区域查看。')}</p> : <div className="delivery-schedule-body">
      <form className="delivery-schedule-filters" onSubmit={(event) => { event.preventDefault(); filter({ deliveryQ: search.trim() || null, deliverySupplier: supplierInput.trim() || null }); }}>
        <label>{t('交期月份')}<Input type="month" value={month} min="0001-01" max="9999-12" onChange={(event) => { if (isDeliveryMonth(event.target.value)) filter({ deliveryMonth: event.target.value, deliveryDay: null }); }} /></label>
        <label>{t('搜索订单、物料或规格')}<Input value={search} maxLength={200} onChange={(event) => setSearch(event.target.value)} /></label>
        <label>{t('供应商名称（精确）')}<Input value={supplierInput} maxLength={200} onChange={(event) => setSupplierInput(event.target.value)} /></label>
        <Button type="submit" variant="outline">{t('应用筛选')}</Button><Button type="button" variant="outline" onClick={refresh} disabled={loading}><RefreshCw size={16} />{t('刷新交期')}</Button>
      </form>
      <div className="delivery-schedule-ranges">{([['month', '本月', data?.summary.inMonth], ['all', '全部镜像', data?.summary.all], ['undated', '日期待确认', data?.summary.undated], ['outside', '月外日期', data?.summary.outside]] as const).map(([key, label, count]) => <Button key={key} variant={bucket === key && !date ? 'default' : 'outline'} aria-pressed={bucket === key && !date} onClick={() => filter({ deliveryBucket: key, deliveryDay: null })}>{t(label)} <span>{loading || !data ? '—' : `${count} ${t('行')}`}</span></Button>)}</div>
      <div className="delivery-schedule-toolbar"><div role="group" aria-label={t('交期视图')}><Button variant={view === 'calendar' ? 'default' : 'outline'} aria-pressed={view === 'calendar'} onClick={() => patch({ deliveryView: 'calendar' })}>{t('日历')}</Button><Button variant={view === 'gantt' ? 'default' : 'outline'} aria-pressed={view === 'gantt'} onClick={() => patch({ deliveryView: 'gantt' })}>{t('甘特')}</Button></div><span>{t('日期按 ERP 当前预计到货归日；数字表示订单行数。')}</span></div>
      {error ? <div role="alert" className="delivery-error"><p>{error}</p><Button variant="outline" onClick={refresh} disabled={loading}>{t('重试日期视图')}</Button></div> : null}
      {loading ? <p role="status">{t('正在读取 ERP 交期…')}</p> : null}
      {data ? <>
        <p className="delivery-explanation">{t('镜像最近同步')}：{data.syncedAt ? new Date(data.syncedAt).toLocaleString() : t('未提供')} · {t('最早订单日')}：{data.oldestOrderDate || t('未提供')}。{t('全量范围指本系统已同步且账号可查看的镜像，不代表 ERP 尚未同步的记录。')}</p>
        {view === 'calendar' && grid ? <div className="delivery-month-grid" role="group" aria-label={`${month} ERP 交期日历`}>
          {['一','二','三','四','五','六','日'].map((day) => <span className="delivery-weekday" key={day}>{t(`周${day}`)}</span>)}
          {grid.cells.map((cell, index) => cell.date ? <Button variant="unstyled" key={cell.date} type="button" aria-label={`${cell.date}，${cell.count} 行`} aria-pressed={date === cell.date} className={date === cell.date ? 'selected' : ''} onClick={() => filter({ deliveryBucket: 'month', deliveryDay: cell.date })}><strong>{cell.number}</strong><span>{cell.count} {t('行')}</span></Button> : <span key={`empty-${index}`} />)}
        </div> : null}
        {date ? <p role="status" className="delivery-explanation">{t('已选日期')}：{date} · {data.rows.total} {t('行')}</p> : null}
        {view === 'gantt' && grid ? <><p className="delivery-explanation">{t('条形表示下单日至 ERP 预计到货的区间，只画当前页。缺少下单日时仅标到货日；不代表实际生产排期或检验放行。')}</p><div className="delivery-gantt-scroll" role="region" aria-label={t('本页 ERP 交期甘特')} tabIndex={0}><div className="delivery-gantt" style={{ minWidth: 190 + grid.length * 22 }}><div className="delivery-gantt-scale"><span>{t('订单行')}</span><div style={{ gridTemplateColumns: `repeat(${grid.length},1fr)` }}>{Array.from({ length: grid.length }, (_, index) => <span key={index}>{index + 1}</span>)}</div></div>{data.rows.items.map((row) => { const segment = deliveryGanttSegment(row, month); return <div className="delivery-gantt-row" key={row.lineId}><Button variant="unstyled" onClick={(event) => showDelivery(row, event.currentTarget)} title={`${row.orderNo} · ${row.lineNo} · ${row.inventoryName}`}>{row.inventoryName}<small>{row.orderNo} · {row.lineNo}</small></Button><div className="delivery-gantt-track" style={{ gridTemplateColumns: `repeat(${grid.length},1fr)` }} aria-label={`${row.orderDate || t('下单日未知')} 至 ${row.erpExpectedDate || t('到货日未知')}`}>{segment.kind === 'range' || segment.kind === 'point' ? <span className={`delivery-gantt-bar ${segment.kind}`} style={{ gridColumn: `${segment.start}/span ${segment.span}` }} title={`${row.orderDate || t('下单日未知')} → ${row.erpExpectedDate}`} /> : <span className="delivery-gantt-note">{t(segment.kind === 'invalid' ? '日期顺序待核对' : segment.kind === 'outside' ? '区间在本月之外' : '预计到货日期待确认')}</span>}</div></div>; })}</div></div></> : null}
        <div ref={rowRegion} className="delivery-schedule-lines" aria-label={t('ERP 订单行列表')}>
          {!data.rows.items.length ? <p role="status" className="delivery-schedule-notice">{t('当前日期范围没有订单行；可查看全部镜像、月外或日期待确认。')}</p> : data.rows.items.map((row) => <article key={row.lineId}><div><strong>{row.inventoryName || t('未记录物料名')}</strong><p>{row.orderNo} · {t('行')} {row.lineNo} · {row.inventoryCode}</p><p>{row.supplierName || t('未记录供应商')}</p></div><dl><div><dt>{t('ERP 预计到货')}</dt><dd>{row.erpExpectedDate || t('待确认')}</dd></div><div><dt>{t('供应商登记承诺')}</dt><dd>{row.supplierPromisedDate || t('未登记')}{row.supplierSourceChanged ? ` · ${t('旧来源待核对')}` : ''}</dd></div><div><dt>{t('订购 / ERP 已到')}</dt><dd>{row.orderedQty} / {row.receivedQty} {row.unit || t('单位待确认')}</dd></div></dl><div className="delivery-line-actions"><Button variant="outline" data-delivery-line-id={row.lineId} onClick={(event) => showDelivery(row, event.currentTarget)}>{t('承诺与交期记录')}</Button><Button variant="ghost" onClick={() => showOrder(row)}>{t('查看订单')}</Button></div></article>)}
        </div>
        {focusLine && !loading && !data.rows.items.some((row) => row.lineId === focusLine) ? <p role="status" className="delivery-warning">{t('返回的原订单行已不在当前页或日期范围，请调整筛选核对。系统未替换成其他行。')}</p> : null}
        <nav className="delivery-history-pager" aria-label={t('镜像交期分页')}><span>{data.rows.total} {t('行')} · {data.rows.page}/{data.rows.totalPages}</span><Button variant="outline" disabled={loading || data.rows.page <= 1} onClick={() => patch({ deliveryPage: String(data.rows.page - 1), deliveryFocus: null })}>{t('上一页')}</Button><Button variant="outline" disabled={loading || data.rows.page >= data.rows.totalPages} onClick={() => patch({ deliveryPage: String(data.rows.page + 1), deliveryFocus: null })}>{t('下一页')}</Button></nav>
      </> : null}
    </div> : null}
    {selected ? <PurchaseOrderDeliveryDrawer lineId={selected.lineId} orderNo={selected.orderNo} onClose={() => setSelected(null)} onCloseAutoFocus={(event) => { if (trigger.current?.isConnected) { event.preventDefault(); trigger.current.focus(); } }} /> : null}
  </section>;
}
