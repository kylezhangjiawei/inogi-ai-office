import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import {
  AlertCircle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  Link2,
  Loader2,
  Mail,
  PackageCheck,
  Phone,
  RefreshCw,
  Truck,
  UserRound,
} from 'lucide-react';

import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { AutoTranslatedText } from '../../components/TranslatableText';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import {
  formatCurrency,
  statusBadgeClass,
  type PurchaseOrder,
} from './PurchaseOrders';
import { orderProcessingApi, type PurchaseOrderLine } from '../../lib/orderProcessingApi';
import { i18nLocale, useI18n } from '../../lib/i18n';
import { routePath } from '../../lib/routePaths';
import { inventoryReadinessReturnPath } from '../../lib/inventoryReadinessNavigation';
import { stockPlanReturnPath } from '../../lib/stockPlanNavigation';
import { workspaceArrivalReturnPath } from '../../lib/workspaceArrivalNavigation';
import { findPurchaseOrderLine, purchaseOrderIdFromPathname, purchaseOrderLineTarget } from '../../lib/purchaseOrderLineNavigation';
import { usePermission } from '../../hooks/usePermission';
import {
  OrderEmptyState,
  OrderMetric,
  OrderMetricGrid,
  OrderPageHeader,
} from '../components/HorizonPage';
import { PurchaseOrderAvailabilityDialog, availabilityConfirmedAt } from '../components/PurchaseOrderAvailabilityDialog';
import { PurchaseReceiptDrawer } from '../components/PurchaseReceiptDrawer';
import { PurchaseOrderHistoryDrawer } from '../components/PurchaseOrderHistoryDrawer';
import { buildPurchaseOrderFulfillment } from '../purchaseOrderFulfillment';
import { PurchaseOrderQuantitySummary } from '../components/PurchaseOrderQuantitySummary';

type LineView = 'all' | 'outstanding' | 'over_received' | 'unverified';
const quantityIssueLabels = {
  invalid_ordered_qty: '订购数量缺失或无效', zero_ordered_qty: '订购数量为零，需核对样品或来源记录',
  invalid_received_qty: '已到数量缺失或无效', missing_unit: '未记录计量单位',
};

function InfoItem({ label, value }: { label: string; value?: React.ReactNode }) {
  const displayedValue = value === null || value === undefined || value === '' ? '-' : value;
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-50 py-2.5 last:border-b-0">
      <span className="shrink-0 text-sm text-slate-400">{label}</span>
      <span className="min-w-0 break-words text-right text-sm font-medium text-slate-800 text-pretty">{displayedValue}</span>
    </div>
  );
}

function TimelineItem({ active, title, desc }: { active: boolean; title: string; desc: string }) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <span className={`mt-1 size-3 rounded-full ${active ? 'bg-blue-600 ring-4 ring-blue-100' : 'bg-slate-200'}`} />
        <span className="h-full min-h-8 w-px bg-slate-100" />
      </div>
      <div className="pb-4">
        <div className={`text-balance text-sm font-semibold ${active ? 'text-slate-900' : 'text-slate-500'}`}>{title}</div>
        <div className="mt-1 text-pretty text-xs leading-5 text-slate-500">{desc}</div>
      </div>
    </div>
  );
}

export function PurchaseOrderDetail() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useI18n();
  const { id = '' } = useParams();
  const decodedId = purchaseOrderIdFromPathname(location.pathname) ?? id;
  const purchaseOrdersPath = routePath('page:purchase-orders', '/purchase-orders');
  const procurementCockpitPath = routePath('page:proc-cockpit', '/proc-cockpit');
  const canOpenProcurementCockpit = usePermission('page:proc-cockpit');
  const canViewOrder = usePermission('page:purchase-order-detail');
  const canConfirmAvailability = usePermission('proc-purchase-order:confirm-availability') && canViewOrder;
  const canOpenInventoryReadiness = usePermission('page:proc-inventory-readiness');
  const readinessReturn = canOpenInventoryReadiness ? inventoryReadinessReturnPath(location.state) : null;
  const stockPlanReturn = canOpenProcurementCockpit ? stockPlanReturnPath(location.state) : null;
  const canOpenWorkspace = usePermission('page:proc-my-workspace');
  const workspaceReturn = canOpenWorkspace ? workspaceArrivalReturnPath(location.state) : null;
  const requestedLine = useMemo(() => purchaseOrderLineTarget(location.search), [location.search]);
  const lineRegion = useRef<HTMLDivElement>(null);
  const focusedLineNavigation = useRef<string | null>(null);
  const focusedLineElement = useRef<HTMLTableRowElement | null>(null);
  const [availabilityLine, setAvailabilityLine] = useState<PurchaseOrderLine | null>(null);
  const [receiptLine, setReceiptLine] = useState<{ orderId: string; lineId: string } | null>(null);
  const [historyLine, setHistoryLine] = useState<{ orderId: string; lineId: string } | null>(null);
  const historyTrigger = useRef<HTMLButtonElement | null>(null);
  const historyLocateTarget = useRef<{ orderId: string; lineId: string } | null>(null);
  const receiptTrigger = useRef<HTMLButtonElement | null>(null);
  const availabilityActions = useRef(new Map<string, HTMLButtonElement>());
  const availabilityTrigger = useRef<{ orderId: string; lineId: string; element: HTMLButtonElement } | null>(null);
  const [availabilityFocusTarget, setAvailabilityFocusTarget] = useState<{ orderId: string; lineId: string } | null>(null);
  const [order, setOrder] = useState<PurchaseOrder | null>(null);
  const [resolvedId, setResolvedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [lineViewSelection, setLineViewSelection] = useState<{ key: string; value: LineView }>({ key: '', value: 'all' });
  const loadRequestRef = useRef(0);

  const loadOrder = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    setOrder(null);
    setResolvedId('');
    setErrorMessage('');
    setNotFound(false);
    setAvailabilityLine(null);
    setReceiptLine(null);
    setHistoryLine(null);
    try {
      const data = await orderProcessingApi.getPurchaseOrder(decodedId);
      if (requestId !== loadRequestRef.current) return;
      setOrder(data.order);
      setResolvedId(decodedId);
    } catch (error) {
      if (requestId !== loadRequestRef.current) return;
      const message = error instanceof Error ? error.message : t('采购订单加载失败');
      setNotFound(/(?:不存在|未找到|not\s+found|404)/i.test(message));
      setErrorMessage(message);
      setResolvedId(decodedId);
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, [decodedId, t]);

  useEffect(() => {
    void loadOrder();
    return () => {
      loadRequestRef.current += 1;
    };
  }, [loadOrder]);

  useEffect(function restoreAvailabilityFocus() {
    if (!availabilityFocusTarget) return;
    if (decodedId !== availabilityFocusTarget.orderId) {
      setAvailabilityFocusTarget(null);
      return;
    }
    if (loading || resolvedId !== decodedId) return;
    const button = availabilityActions.current.get(availabilityFocusTarget.lineId);
    const active = document.activeElement;
    // A successful save replaces the table. Resolve the new button by line ID, and
    // leave focus alone if the user has already moved to another control meanwhile.
    if (button?.isConnected && (active === document.body || active === document.documentElement || !active?.isConnected || active === button)) {
      button.focus({ preventScroll: true });
    }
    setAvailabilityFocusTarget(null);
  }, [availabilityFocusTarget, decodedId, loading, resolvedId, order]);

  const items = order?.items ?? [];
  const fulfillment = useMemo(() => buildPurchaseOrderFulfillment(items), [items]);
  // A new navigation may request an exact line outside the previous local filter.
  const lineViewKey = JSON.stringify([location.key, decodedId]);
  if (lineViewSelection.key !== lineViewKey) {
    // Advance the stored scope as well: POP must not resurrect a filter from an old history entry.
    setLineViewSelection({ key: lineViewKey, value: 'all' });
  }
  const lineView = lineViewSelection.key === lineViewKey ? lineViewSelection.value : 'all';
  const visibleLines = fulfillment.lines.filter((line) => lineView === 'all'
    || (lineView === 'outstanding' ? line.state === 'not_received' || line.state === 'partial' : line.state === lineView));
  const targetLine = findPurchaseOrderLine(items, requestedLine.lineId);
  useEffect(function focusRequestedOrderLine() {
    const navigationKey = JSON.stringify([location.key, decodedId, requestedLine.lineId]);
    if (focusedLineNavigation.current === navigationKey || !targetLine || loading || resolvedId !== decodedId) return;
    if (availabilityLine || availabilityFocusTarget || receiptLine || historyLine) return;
    // TableRow is a presentational component. Read its committed DOM through the
    // native region rather than relying on a component ref or a SKU selector.
    const row = Array.from(lineRegion.current?.querySelectorAll<HTMLTableRowElement>('tr[data-purchase-order-line-id]') ?? [])
      .find((element) => element.dataset.purchaseOrderLineId === targetLine.id);
    if (!row?.isConnected) return;
    focusedLineNavigation.current = navigationKey;
    row.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
    const active = document.activeElement;
    if (active === document.body || active === document.documentElement || !active?.isConnected || active === row || active === focusedLineElement.current) {
      row.focus({ preventScroll: true });
      focusedLineElement.current = row;
    }
  }, [location.key, decodedId, requestedLine.lineId, targetLine, loading, resolvedId, availabilityLine, availabilityFocusTarget, receiptLine, historyLine]);

  const returnToReadiness = () => {
    if (!readinessReturn) return;
    if (location.state?.inventoryReadinessHistoryBack === true) navigate(-1);
    else navigate(readinessReturn, { replace: true });
  };
  const returnToStockPlan = () => {
    if (!stockPlanReturn) return;
    if (location.state?.stockPlanHistoryBack === true) navigate(-1);
    else navigate(stockPlanReturn, { replace: true });
  };
  const returnToWorkspace = () => {
    if (!workspaceReturn) return;
    if (location.state?.workspaceArrivalHistoryBack === true) navigate(-1);
    else navigate(workspaceReturn, { replace: true });
  };
  const hasItemDetails = items.length > 0;
  const itemAmount = items.every((item) => Number.isFinite(item.qty) && item.qty >= 0 && Number.isFinite(item.unitPrice) && item.unitPrice >= 0)
    ? items.reduce((amount, item) => amount + item.qty * item.unitPrice, 0) : null;
  const outstandingLines = fulfillment.checkableLines - fulfillment.receivedLines;
  const taskLinks = order?.taskLinks ?? [];

  if (loading || resolvedId !== decodedId) {
    return (
      <div className="order-horizon flex min-h-[520px] flex-1 flex-col gap-3 px-4 py-4 sm:px-5" aria-busy="true">
        <span role="status" aria-live="polite" className="sr-only">{t('正在加载采购订单详情')}</span>
        <div className="order-horizon-command min-h-24 animate-pulse" />
        <div className="order-horizon-metric-grid min-h-20 animate-pulse" />
        <div className="order-horizon-data-surface flex flex-1 items-center justify-center border text-sm text-slate-500">
          <Loader2 className="mr-2 size-4 animate-spin text-blue-700" />
          {t('正在加载采购订单详情')}
        </div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="order-horizon flex min-h-[520px] flex-1 items-center justify-center px-4 py-4 sm:px-5">
        <div className="order-horizon-data-surface w-full max-w-2xl border" role={notFound ? 'status' : 'alert'}>
          <OrderEmptyState
            Icon={notFound ? PackageCheck : AlertCircle}
            title={notFound ? t('未找到采购订单') : t('采购订单加载失败')}
            description={notFound
              ? t('当前畅捷通采购订单不存在，可能尚未同步或已被移除。')
              : errorMessage || t('暂时无法读取采购订单，请稍后重试。')}
            action={(
              <div className="flex flex-wrap items-center justify-center gap-2">
                {workspaceReturn ? <Button type="button" variant="outline" className="order-horizon-secondary-action" onClick={returnToWorkspace}>
                  <ArrowLeft className="size-4" />{t('返回采购工作台')}
                </Button> : null}
                {stockPlanReturn ? <Button type="button" variant="outline" className="order-horizon-secondary-action" onClick={returnToStockPlan}>
                  <ArrowLeft className="size-4" />{t('返回备货计划')}
                </Button> : null}
                {readinessReturn ? <Button type="button" variant="outline" className="order-horizon-secondary-action" onClick={returnToReadiness}>
                  <ArrowLeft className="size-4" />{t('返回齐套中心')}
                </Button> : null}
                {!notFound ? (
                  <Button type="button" className="order-horizon-primary-action bg-blue-700 text-white" onClick={() => void loadOrder()}>
                    <RefreshCw className="size-4" />
                    {t('重新加载')}
                  </Button>
                ) : null}
                <Button type="button" variant="outline" className="order-horizon-secondary-action" onClick={() => navigate(purchaseOrdersPath)}>
                  <ArrowLeft className="size-4" />
                  {t('返回采购订单')}
                </Button>
              </div>
            )}
          />
        </div>
      </div>
    );
  }

  const timeline = [
    {
      key: 'created',
      active: Boolean(order.orderDate && order.orderDate !== '-'),
      title: t('创建采购单'),
      desc: t('{date} 下单，采购员 {buyer}，所属 {owner}', {
        date: order.orderDate,
        buyer: order.buyer,
        owner: order.owner,
      }),
    },
    {
      key: 'approved',
      active: Boolean(order.approvalStatus),
      title: t('审批记录'),
      desc: order.approvalStatus ? t(order.approvalStatus) : t('畅捷通未返回独立审批状态'),
    },
    {
      key: 'ordered',
      active: Boolean(order.deliveryTerm),
      title: t('供应商交付方式'),
      desc: order.deliveryTerm ? t(order.deliveryTerm) : t('畅捷通未返回交付方式'),
    },
    {
      key: 'inbound',
      active: hasItemDetails,
      title: t('ERP 到货记录'),
      desc: hasItemDetails
        ? t('已读 {total} 行，{received} 行数量已收齐，{outstanding} 行未收齐，{unverified} 行待核对。到货数量不代表质检通过或入库。', {
          total: fulfillment.totalLines, received: fulfillment.receivedLines, outstanding: outstandingLines, unverified: fulfillment.unverifiedLines,
        }) : t('商品明细尚未同步，不能判断逐行到货情况。'),
    },
  ];

  return (
    <div className="order-horizon flex min-h-0 flex-1 flex-col overflow-auto px-4 py-4 sm:px-5">
      <OrderPageHeader
        Icon={PackageCheck}
        eyebrow={t('采购订单详情')}
        title={order.poNo}
        description={<AutoTranslatedText text={`${order.supplier} · ${order.owner}`} />}
        meta={(
          <>
          {stockPlanReturn ? <Button type="button" variant="outline" size="sm" onClick={returnToStockPlan}
            className="order-horizon-secondary-action h-10 border-slate-200 bg-white px-3 text-slate-600 hover:bg-slate-50">
            <ArrowLeft className="h-4 w-4" />{t('返回备货计划')}
          </Button> : null}
            <span>{t('下单日期')}：{order.orderDate}</span>
            <span>· {t('预计到货')}：{order.etaDate || '-'}</span>
            <span>· {t('数据来源')}：<AutoTranslatedText text={order.sourceFile || t('畅捷通 T+')} /></span>
          </>
        )}
        actions={(
          <>
          {workspaceReturn ? <Button type="button" variant="outline" size="sm" onClick={returnToWorkspace}
            className="order-horizon-secondary-action h-10 border-slate-200 bg-white px-3 text-slate-600 hover:bg-slate-50">
            <ArrowLeft className="size-4" />{t('返回采购工作台')}
          </Button> : null}
          {readinessReturn ? <Button type="button" variant="outline" size="sm" onClick={returnToReadiness}
            className="order-horizon-secondary-action h-10 border-slate-200 bg-white px-3 text-slate-600 hover:bg-slate-50">
            <ArrowLeft className="h-4 w-4" />{t('返回齐套中心')}
          </Button> : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={t('返回采购订单列表')}
            onClick={() => navigate(purchaseOrdersPath)}
            className="order-horizon-secondary-action h-10 border-slate-200 bg-white px-3 text-slate-600 hover:bg-slate-50">
            <ArrowLeft className="h-4 w-4" />
            {t('返回')}
          </Button>
            <Badge variant="secondary" className={`px-3 py-1.5 font-medium ${statusBadgeClass(order.status)}`}>
              {t(order.status)}
            </Badge>
          </>
        )}
      />

      <OrderMetricGrid>
        <OrderMetric Icon={FileText} label={t('订单金额')} value={formatCurrency(order.amount, order.currency)} tone="primary" />
        <OrderMetric Icon={PackageCheck} label={t('已读取订单行')} value={hasItemDetails ? t('{count} 行', { count: items.length }) : '-'} note={t('来源汇总 {count} 项', { count: order.itemCount })} tone="primary" />
        <OrderMetric Icon={CheckCircle2} label={t('数量已收齐行')} value={hasItemDetails ? `${fulfillment.receivedLines} / ${items.length}` : '-'} note={hasItemDetails ? fulfillment.overReceivedLines ? t('其中 {count} 行超收，需核对', { count: fulfillment.overReceivedLines }) : t('按已读取明细逐行核对') : t('明细尚未同步')} tone={fulfillment.overReceivedLines ? 'warning' : 'primary'} />
        <OrderMetric Icon={Truck} label={t('数量未收齐行')} value={hasItemDetails ? outstandingLines : '-'} note={hasItemDetails ? t('另有 {count} 行数据待核对', { count: fulfillment.unverifiedLines }) : t('明细尚未同步')} tone={outstandingLines || fulfillment.unverifiedLines ? 'warning' : 'neutral'} />
        <OrderMetric Icon={CalendarDays} label={t('预计到货')} value={<span className="whitespace-nowrap text-base sm:text-lg">{order.etaDate || '-'}</span>} tone="warning" />
      </OrderMetricGrid>

      {hasItemDetails ? <PurchaseOrderQuantitySummary summary={fulfillment} /> : null}

          <div className="order-horizon-detail-surface min-w-0 shrink-0 overflow-hidden border bg-white">
            <div className="border-b border-slate-100 px-4 py-3">
              <h2 id="purchase-order-lines-title" className="text-balance text-base font-semibold text-slate-900">{t('商品明细')}</h2>
              <p className="mt-1 text-pretty text-xs leading-5 text-slate-500">{t('预计到货来自采购订单；预计检验后可用日期由经办人逐行确认。确认日期不代表当前库存已可用。')}</p>
              {hasItemDetails ? <p className="mt-1 text-xs leading-5 text-slate-400">{t('横向滚动查看更多字段')}</p> : null}
              {hasItemDetails ? <div role="group" aria-label={t('按到货数量筛选订单行')} className="mt-3 flex flex-wrap gap-2">
                {([
                  ['all', '全部明细', fulfillment.totalLines], ['outstanding', '未收齐', outstandingLines],
                  ['over_received', '超收', fulfillment.overReceivedLines], ['unverified', '待核对', fulfillment.unverifiedLines],
                ] as const).map(([value, label, count]) => <Button key={value} type="button" variant={lineView === value ? 'default' : 'outline'} size="sm" aria-pressed={lineView === value}
                  onClick={() => setLineViewSelection({ key: lineViewKey, value })}>{t(label)} {count}</Button>)}
                <span role="status" className="self-center text-xs text-slate-500">{t('显示 {visible} / {total} 行', { visible: visibleLines.length, total: items.length })}</span>
              </div> : null}
              {requestedLine.requested && !targetLine ? <p role="status" className="mt-2 text-sm leading-5 text-amber-700">{t('目标订单行不存在或已变更，请核对当前订单明细。')}</p> : null}
            </div>
            {hasItemDetails ? (
              <>
                <div
                  ref={lineRegion}
                  role="region"
                  aria-labelledby="purchase-order-lines-title"
                  tabIndex={0}
                  className="overflow-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#002fa7]">
                  <Table containerClassName="order-horizon-table overflow-visible" className="min-w-[1280px]" aria-label={t('采购订单商品明细，可横向滚动查看更多字段')}>
                    <TableHeader className="bg-slate-50">
                      <TableRow>
                        <TableHead className="px-4">SKU</TableHead>
                        <TableHead>{t('商品名称')}</TableHead>
                        <TableHead>{t('规格')}</TableHead>
                        <TableHead className="text-right">{t('采购数量')}</TableHead>
                        <TableHead className="text-right">{t('已到货')}</TableHead>
                        <TableHead className="text-right">{t('到货数量核对')}</TableHead>
                        <TableHead className="text-right">{t('单价')}</TableHead>
                        <TableHead className="text-right">{t('小计')}</TableHead>
                        <TableHead className="min-w-32">{t('预计到货')}</TableHead>
                        <TableHead className="min-w-52">{t('预计检验后可用')}</TableHead>
                        {canViewOrder ? <TableHead className="order-horizon-sticky-action sticky right-0 min-w-32 bg-slate-50 text-right">{t('操作')}</TableHead> : null}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleLines.map((line) => { const index = line.index; const item = items[index]; return (
                        <TableRow key={`${item.id || item.sku}:${index}`}
                          data-purchase-order-line-id={item.id || undefined}
                          aria-current={item === targetLine ? 'true' : undefined}
                          tabIndex={item === targetLine ? -1 : undefined}
                          className={item === targetLine ? 'bg-blue-50 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-700' : undefined}>
                          <TableCell className="px-4 text-slate-800"><span className="font-mono tabular-nums">{item.sku}</span><p className="mt-1 text-xs text-slate-400 tabular-nums">{t('行号')} {item.lineNo || '—'}</p>{item === targetLine ? <p className="mt-1 text-xs font-semibold text-blue-700">{t('当前核对行')}</p> : null}</TableCell>
                          <TableCell className="max-w-[220px] font-medium text-slate-900"><div className="truncate" title={item.name}><AutoTranslatedText text={item.name} /></div></TableCell>
                          <TableCell className="max-w-[240px] text-slate-600"><div className="truncate" title={item.spec}><AutoTranslatedText text={item.spec || '-'} /></div></TableCell>
                          <TableCell className="text-right text-slate-700 tabular-nums">{Number.isFinite(item.qty) ? item.qty : t('待核对')} {line.unit ? t(line.unit) : t('单位待核对')}</TableCell>
                          <TableCell className="text-right text-slate-700 tabular-nums">{Number.isFinite(item.receivedQty) ? item.receivedQty : t('待核对')} {line.unit ? t(line.unit) : t('单位待核对')}</TableCell>
                          <TableCell className="text-right">
                            <span className={`whitespace-nowrap text-xs font-medium ${line.state === 'unverified' || line.state === 'over_received' ? 'text-amber-700' : 'text-slate-700'}`}>{t({ not_received: '未收货', partial: '部分到货', received: '数量已收齐', over_received: '超收待核对', unverified: '数据待核对' }[line.state])}</span>
                            {line.remainingQty !== null && line.remainingQty > 0 ? <p className="mt-1 whitespace-nowrap text-xs tabular-nums text-slate-500">{t('未收差额 {count} {unit}', { count: line.remainingQty.toLocaleString(i18nLocale(), { maximumFractionDigits: 8 }), unit: line.unit })}</p> : null}
                            {line.overReceivedQty !== null && line.overReceivedQty > 0 ? <p className="mt-1 whitespace-nowrap text-xs tabular-nums text-amber-700">{t('超收 {count} {unit}', { count: line.overReceivedQty.toLocaleString(i18nLocale(), { maximumFractionDigits: 8 }), unit: line.unit })}</p> : null}
                            {line.state === 'unverified' ? <p className="mt-1 min-w-28 max-w-44 whitespace-normal text-xs leading-5 text-amber-700">{line.issues.map((issue) => t(quantityIssueLabels[issue])).join('；')}</p> : null}
                          </TableCell>
                          <TableCell className="text-right text-slate-700 tabular-nums">{Number.isFinite(item.unitPrice) && item.unitPrice >= 0 ? formatCurrency(item.unitPrice, order.currency) : t('待核对')}</TableCell>
                          <TableCell className="text-right font-semibold text-slate-900 tabular-nums">{Number.isFinite(item.qty) && Number.isFinite(item.unitPrice) && Number.isFinite(item.qty * item.unitPrice) && item.qty >= 0 && item.unitPrice >= 0 ? formatCurrency(item.qty * item.unitPrice, order.currency) : t('待核对')}</TableCell>
                          <TableCell className="align-top text-slate-700 tabular-nums">{item.etaDate || t('待确认')}</TableCell>
                          <TableCell className="align-top">
                            <p className="font-medium text-slate-900 tabular-nums">{item.availability?.availableDate || t(item.availability ? '已撤销日期确认' : '未确认')}</p>
                            {item.availability ? <>
                              {item.availability.needsReconfirmation ? <p className="mt-1 text-xs font-medium text-amber-700">{t('订单来源已变化，需重确认')}</p> : null}
                              <p className="mt-1 whitespace-normal break-words text-xs leading-5 text-slate-500">{item.availability.confirmedByName || t('未记录确认人')}<br /><span className="tabular-nums">{availabilityConfirmedAt(item.availability.confirmedAt)}</span></p>
                              {item.availability.note ? <p className="mt-1 max-w-60 whitespace-pre-wrap break-words text-pretty text-xs leading-5 text-slate-500">{item.availability.note}</p> : null}
                            </> : null}
                          </TableCell>
                          {canViewOrder ? <TableCell className={`order-horizon-sticky-action sticky right-0 text-right align-top ${item === targetLine ? 'bg-blue-50' : 'bg-white'}`}>
                            <div className="flex flex-col items-end gap-2">
                            <Button type="button" variant="outline" size="sm" disabled={!item.id}
                              aria-label={t('查看订单行 {line} 的日期确认记录：{name}', { line: item.lineNo || String(index + 1), name: item.name })}
                              onClick={(event) => {
                                historyTrigger.current = event.currentTarget;
                                historyLocateTarget.current = null;
                                setHistoryLine({ orderId: decodedId, lineId: item.id });
                              }}>
                              {t('日期确认记录')}
                            </Button>
                            <Button type="button" variant="outline" size="sm" disabled={!item.id}
                              aria-label={t('查看订单行 {line} 的收货与检验：{name}', { line: item.lineNo || String(index + 1), name: item.name })}
                              onClick={(event) => {
                                receiptTrigger.current = event.currentTarget;
                                setReceiptLine({ orderId: decodedId, lineId: item.id });
                              }}>
                              {t('收货与检验')}
                            </Button>
                            {canConfirmAvailability ? <Button type="button" variant="outline" size="sm" disabled={!item.id || !item.sourceUpdatedAt}
                              ref={(element) => {
                                if (!item.id) return;
                                if (element) availabilityActions.current.set(item.id, element);
                                else availabilityActions.current.delete(item.id);
                              }}
                              aria-label={t('确认订单行 {line} 的预计检验后可用日期：{name}', { line: item.lineNo || String(index + 1), name: item.name })}
                              onClick={(event) => {
                                availabilityTrigger.current = { orderId: decodedId, lineId: item.id, element: event.currentTarget };
                                setAvailabilityLine(item);
                              }}>
                              {t(item.availability?.needsReconfirmation ? '重新确认' : item.availability ? '修改确认' : '确认可用日期')}
                            </Button> : null}
                            </div>
                          </TableCell> : null}
                        </TableRow>
                      ); })}
                      {!visibleLines.length ? <TableRow><TableCell colSpan={canViewOrder ? 11 : 10} className="py-10 text-center text-sm text-slate-500">{t('当前筛选没有匹配的订单行，可切换全部明细。')}</TableCell></TableRow> : null}
                    </TableBody>
                  </Table>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-3 text-sm">
                  <span className="text-slate-500">{t('全部已读明细金额（不随筛选变化）')}</span>
                  <span className="font-semibold text-slate-900 tabular-nums">{itemAmount !== null && Number.isFinite(itemAmount) ? formatCurrency(itemAmount, order.currency) : t('待核对')}</span>
                </div>
              </>
            ) : (
              <OrderEmptyState
                Icon={PackageCheck}
                title={t('商品明细尚未同步')}
                description={t('当前仅有采购订单汇总信息，可稍后重新加载畅捷通商品明细。')}
                action={(
                  <Button type="button" variant="outline" size="sm" onClick={() => void loadOrder()} className="order-horizon-secondary-action">
                    <RefreshCw className="size-4" />
                    {t('重新加载详情')}
                  </Button>
                )}
              />
            )}
          </div>

      <div className="mt-4 grid min-h-0 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-h-0 min-w-0 space-y-4">
          <div className="order-horizon-detail-surface grid overflow-hidden border bg-white 2xl:grid-cols-2">
            <section aria-labelledby="purchase-supplier-title" className="p-4 2xl:border-r 2xl:border-slate-100">
              <h2 id="purchase-supplier-title" className="mb-2 flex items-center gap-2 text-balance text-base font-semibold text-slate-900">
                <UserRound className="h-4 w-4 text-blue-500" />
                {t('采购与供应商')}
              </h2>
              <InfoItem label={t('供应商')} value={<AutoTranslatedText text={order.supplier} />} />
              <InfoItem label={t('联系人')} value={order.supplierContact} />
              <InfoItem label={t('联系电话')} value={order.supplierPhone ? (
                <a href={`tel:${order.supplierPhone}`} className="inline-flex items-center gap-1 text-[#002fa7] underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#002fa7]">
                  <Phone className="h-3.5 w-3.5" />{order.supplierPhone}
                </a>
              ) : '-'} />
              <InfoItem label={t('邮箱')} value={order.supplierEmail ? (
                <a href={`mailto:${order.supplierEmail}`} className="inline-flex items-center gap-1 text-[#002fa7] underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#002fa7]">
                  <Mail className="h-3.5 w-3.5" />{order.supplierEmail}
                </a>
              ) : '-'} />
              <InfoItem label={t('采购员')} value={order.buyer} />
              <InfoItem label={t('采购组')} value={<AutoTranslatedText text={order.owner} />} />
              <InfoItem label={t('订单登记仓库')} value={<AutoTranslatedText text={order.warehouse || t('未提供')} />} />
            </section>

            <section aria-labelledby="purchase-settlement-title" className="border-t border-slate-100 p-4 2xl:border-t-0">
              <h2 id="purchase-settlement-title" className="mb-2 flex items-center gap-2 text-balance text-base font-semibold text-slate-900">
                <ClipboardCheck className="h-4 w-4 text-blue-500" />
                {t('合同与结算')}
              </h2>
              <InfoItem label={t('付款条件')} value={<AutoTranslatedText text={order.paymentTerm || t('未配置')} />} />
              <InfoItem label={t('交付方式')} value={<AutoTranslatedText text={order.deliveryTerm || t('未配置')} />} />
              <InfoItem label={t('发票类型')} value={<AutoTranslatedText text={order.invoiceType || t('未配置')} />} />
              <InfoItem label={t('审批状态')} value={<AutoTranslatedText text={order.approvalStatus || t('未配置')} />} />
              <InfoItem label={t('数据来源')} value={<AutoTranslatedText text={order.sourceFile || t('畅捷通 T+')} />} />
              <InfoItem label={t('最后同步')} value={order.syncedAt ? <span className="tabular-nums">{new Date(order.syncedAt).toLocaleString(i18nLocale())}</span> : '-'} />
              <InfoItem label={t('内部 ID')} value={<span className="font-mono tabular-nums">{order.id}</span>} />
            </section>
          </div>
        </div>

        <aside aria-label={t('采购订单补充信息')} className="space-y-4">
          <section aria-labelledby="related-procurement-tasks-title" className="order-horizon-detail-surface border bg-white p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 id="related-procurement-tasks-title" className="flex items-center gap-2 text-balance text-base font-semibold text-slate-900">
                <Link2 className="h-4 w-4 text-blue-500" />
                {t('关联采购任务')}
              </h2>
              <span className="text-xs text-slate-400 tabular-nums">{taskLinks.length}</span>
            </div>
            {taskLinks.length > 0 ? (
              <div className="space-y-2">
                {taskLinks.map((task) => {
                  const cardContent = (
                    <>
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-mono text-sm font-medium text-blue-700 tabular-nums">{task.code}</span>
                        <span className="text-xs text-slate-500">{t(task.status)}</span>
                      </div>
                      <div className="mt-1 truncate text-sm text-slate-700"><AutoTranslatedText text={task.materialName} /></div>
                      <div className="mt-1 flex justify-between gap-3 text-xs text-slate-400 tabular-nums">
                        <span className="truncate">{task.buyer || t('未分配采购员')}</span>
                        <span className="shrink-0">{task.arrivedQty}/{task.quantity}</span>
                      </div>
                    </>
                  );
                  return canOpenProcurementCockpit ? (
                    <button
                      key={task.id}
                      type="button"
                      aria-label={t('打开关联采购任务 {code}', { code: task.code })}
                      onClick={() => navigate(`${procurementCockpitPath}?task=${encodeURIComponent(task.id)}`)}
                      className="w-full rounded-xl border border-slate-100 bg-slate-50 p-3 text-left hover:border-blue-200 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#002fa7] focus-visible:ring-offset-2">
                      {cardContent}
                    </button>
                  ) : (
                    <div key={task.id} aria-disabled="true" className="w-full rounded-xl border border-slate-100 bg-slate-50 p-3 text-left">
                      {cardContent}
                      <div className="mt-2 text-xs text-slate-400">{t('无采购任务查看权限')}</div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-xl bg-slate-50 px-3 py-5 text-center text-sm text-slate-400 text-pretty">
                {t('该采购单尚未关联采购任务')}
              </div>
            )}
          </section>

          <section aria-labelledby="purchase-fulfillment-title" className="order-horizon-detail-surface border bg-white p-4">
            <h2 id="purchase-fulfillment-title" className="mb-4 flex items-center gap-2 text-balance text-base font-semibold text-slate-900">
              <Truck className="h-4 w-4 text-blue-500" />
              {t('订单记录')}
            </h2>
            <div>
              {timeline.map((item) => (
                <TimelineItem key={item.key} active={item.active} title={item.title} desc={item.desc} />
              ))}
            </div>
          </section>

          <section aria-labelledby="purchase-remark-title" className="order-horizon-detail-surface border bg-white p-4">
            <h2 id="purchase-remark-title" className="mb-3 text-balance text-base font-semibold text-slate-900">{t('备注')}</h2>
            <p className="min-h-24 rounded-xl bg-slate-50 px-3 py-3 text-sm leading-6 text-slate-600 text-pretty">
              <AutoTranslatedText text={order.remark || t('暂无备注')} />
            </p>
          </section>
        </aside>
      </div>
      {historyLine && canViewOrder && historyLine.orderId === decodedId && findPurchaseOrderLine(items, historyLine.lineId) ? <PurchaseOrderHistoryDrawer
        key={`${decodedId}:${historyLine.lineId}`} orderId={decodedId} orderNo={order.poNo}
        line={findPurchaseOrderLine(items, historyLine.lineId)!}
        onClose={() => setHistoryLine(null)}
        onLocateLine={() => {
          const params = new URLSearchParams(location.search);
          params.set('lineId', historyLine.lineId);
          historyLocateTarget.current = historyLine;
          historyTrigger.current = null;
          focusedLineNavigation.current = null;
          setHistoryLine(null);
          navigate({ pathname: location.pathname, search: params.toString() }, { replace: true, state: location.state });
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const target = historyLocateTarget.current;
          historyLocateTarget.current = null;
          if (target?.orderId === decodedId) {
            const row = Array.from(lineRegion.current?.querySelectorAll<HTMLTableRowElement>('tr[data-purchase-order-line-id]') ?? [])
              .find((element) => element.dataset.purchaseOrderLineId === target.lineId);
            if (row?.isConnected) {
              row.focus({ preventScroll: true });
              focusedLineElement.current = row;
              return;
            }
          }
          const trigger = historyTrigger.current;
          historyTrigger.current = null;
          if (trigger?.isConnected) trigger.focus({ preventScroll: true });
        }} /> : null}
      {receiptLine && canViewOrder && receiptLine.orderId === decodedId && items.some((item) => item.id === receiptLine.lineId) ? <PurchaseReceiptDrawer
        key={`${decodedId}:${receiptLine.lineId}`} lineId={receiptLine.lineId} orderNo={order.poNo}
        onClose={() => setReceiptLine(null)}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const trigger = receiptTrigger.current;
          receiptTrigger.current = null;
          if (trigger?.isConnected) trigger.focus({ preventScroll: true });
        }} /> : null}
      {availabilityLine && canConfirmAvailability ? <PurchaseOrderAvailabilityDialog key={`${order.id}:${availabilityLine.id}`}
        orderId={order.id} orderNo={order.poNo} line={availabilityLine}
        onClose={() => setAvailabilityLine(null)}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const trigger = availabilityTrigger.current;
          availabilityTrigger.current = null;
          if (!trigger) return;
          const active = document.activeElement;
          if (active === document.body || active === document.documentElement || !active?.isConnected || active === trigger.element) {
            setAvailabilityFocusTarget({ orderId: trigger.orderId, lineId: trigger.lineId });
          }
        }}
        onSaved={() => {
          setAvailabilityLine(null);
          toast.success(t('预计检验后可用日期已保存'));
          void loadOrder();
        }} /> : null}
    </div>
  );
}
