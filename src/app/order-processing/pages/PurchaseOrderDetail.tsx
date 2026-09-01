import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
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
import { orderProcessingApi } from '../../lib/orderProcessingApi';
import { i18nLocale, useI18n } from '../../lib/i18n';
import { routePath } from '../../lib/routePaths';
import { usePermission } from '../../hooks/usePermission';
import {
  OrderEmptyState,
  OrderMetric,
  OrderMetricGrid,
  OrderPageHeader,
} from '../components/HorizonPage';

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

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
  const { t } = useI18n();
  const { id = '' } = useParams();
  const decodedId = safeDecode(id);
  const purchaseOrdersPath = routePath('page:purchase-orders', '/purchase-orders');
  const procurementCockpitPath = routePath('page:proc-cockpit', '/proc-cockpit');
  const canOpenProcurementCockpit = usePermission('page:proc-cockpit');
  const [order, setOrder] = useState<PurchaseOrder | null>(null);
  const [resolvedId, setResolvedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [notFound, setNotFound] = useState(false);
  const loadRequestRef = useRef(0);

  const loadOrder = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    setOrder(null);
    setResolvedId('');
    setErrorMessage('');
    setNotFound(false);
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

  const items = order?.items ?? [];
  const itemSummary = useMemo(() => items.reduce(
    (summary, item) => ({
      amount: summary.amount + item.qty * item.unitPrice,
      received: summary.received + item.receivedQty,
      ordered: summary.ordered + item.qty,
    }),
    { amount: 0, received: 0, ordered: 0 },
  ), [items]);
  const hasItemDetails = items.length > 0;
  const itemAmount = itemSummary.amount;
  const receivedTotal = itemSummary.received;
  const orderedTotal = itemSummary.ordered;
  const fulfillment = orderedTotal > 0 ? Math.min(100, Math.round((receivedTotal / orderedTotal) * 100)) : 0;
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

  const isCompleted = order.status === '已完成';
  const isPartial = order.status === '部分到货';
  const warehouseKnown = Boolean(order.warehouse && order.warehouse !== '-');
  const etaKnown = Boolean(order.etaDate && order.etaDate !== '-');
  const timeline = [
    {
      key: 'created',
      title: t('创建采购单'),
      desc: t('{date} 由 {buyer} 创建，所属 {owner}', {
        date: order.orderDate,
        buyer: order.buyer,
        owner: order.owner,
      }),
    },
    {
      key: 'approved',
      title: t('审批确认'),
      desc: order.approvalStatus
        ? t(order.approvalStatus)
        : isCompleted
          ? t('订单已完成，畅捷通未返回独立审批状态')
          : t('畅捷通未返回独立审批状态'),
    },
    {
      key: 'ordered',
      title: t('供应商履约'),
      desc: order.deliveryTerm
        ? t(order.deliveryTerm)
        : isCompleted
          ? t('供应商已完成本单履约')
          : isPartial
            ? hasItemDetails
              ? t('供应商持续履约，已到货 {received}/{ordered}', { received: receivedTotal, ordered: orderedTotal })
              : t('供应商持续履约，商品明细数量尚未同步')
            : t('采购单已下达，畅捷通未返回交付方式'),
    },
    {
      key: 'inbound',
      title: t('到货入库'),
      desc: isCompleted
        ? hasItemDetails
          ? t('已全部到货 {received}/{ordered}{warehouse}', {
            received: receivedTotal,
            ordered: orderedTotal,
            warehouse: warehouseKnown ? t('，入库仓库：{name}', { name: order.warehouse }) : '',
          })
          : t('采购单已完成，商品明细数量尚未同步{warehouse}', {
            warehouse: warehouseKnown ? t('，入库仓库：{name}', { name: order.warehouse }) : '',
          })
        : isPartial
          ? hasItemDetails
            ? t('已到货 {received}/{ordered}{eta}', {
              received: receivedTotal,
              ordered: orderedTotal,
              eta: etaKnown ? t('，预计 {date} 完成', { date: order.etaDate }) : '',
            })
            : t('采购单处于部分到货状态，商品明细数量尚未同步{eta}', {
              eta: etaKnown ? t('，预计 {date} 完成', { date: order.etaDate }) : '',
            })
          : warehouseKnown || etaKnown
            ? t('目标仓库：{warehouse}，预计到货：{date}', {
              warehouse: warehouseKnown ? t(order.warehouse) : t('暂未提供'),
              date: etaKnown ? order.etaDate : t('暂未提供'),
            })
            : t('等待畅捷通同步仓库及预计到货信息'),
    },
  ];
  const activeTimelineCount =
    order.status === '已完成' ? 4 : order.status === '部分到货' ? 3 : order.status === '已下单' ? 2 : order.status === '异常' ? 2 : 1;

  return (
    <div className="order-horizon flex min-h-0 flex-1 flex-col overflow-auto px-4 py-4 sm:px-5">
      <OrderPageHeader
        Icon={PackageCheck}
        eyebrow={t('采购订单详情')}
        title={order.poNo}
        description={<AutoTranslatedText text={`${order.supplier} · ${order.owner}`} />}
        meta={(
          <>
            <span>{t('下单日期')}：{order.orderDate}</span>
            <span>· {t('预计到货')}：{order.etaDate || '-'}</span>
            <span>· {t('数据来源')}：<AutoTranslatedText text={order.sourceFile || t('畅捷通 T+')} /></span>
          </>
        )}
        actions={(
          <>
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
        <OrderMetric Icon={PackageCheck} label={t('SKU / 数量')} value={`${order.itemCount || items.length} / ${hasItemDetails ? orderedTotal : '-'}`} tone="primary" />
        <OrderMetric Icon={CheckCircle2} label={t('已到货数量')} value={hasItemDetails ? receivedTotal : '-'} tone="success" />
        <OrderMetric Icon={CalendarDays} label={t('预计到货')} value={order.etaDate || '-'} tone="warning" />
        <OrderMetric
          Icon={Truck}
          label={t('到货进度')}
          value={hasItemDetails ? `${fulfillment}%` : '-'}
          note={hasItemDetails ? `${receivedTotal}/${orderedTotal}` : t('明细尚未同步')}
          tone={hasItemDetails && fulfillment === 100 ? 'success' : 'primary'}
        />
      </OrderMetricGrid>

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-h-0 space-y-4">
          <div className="order-horizon-detail-surface overflow-hidden border bg-white">
            <div className="border-b border-slate-100 px-4 py-3">
              <h2 id="purchase-order-lines-title" className="text-balance text-base font-semibold text-slate-900">{t('商品明细')}</h2>
            </div>
            {hasItemDetails ? (
              <>
                <div
                  role="region"
                  aria-labelledby="purchase-order-lines-title"
                  tabIndex={0}
                  className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#002fa7]">
                  <Table containerClassName="order-horizon-table overflow-auto" className="min-w-[820px]" aria-label={t('采购订单商品明细')}>
                    <TableHeader className="bg-slate-50">
                      <TableRow>
                        <TableHead className="px-4">SKU</TableHead>
                        <TableHead>{t('商品名称')}</TableHead>
                        <TableHead>{t('规格')}</TableHead>
                        <TableHead className="text-right">{t('采购数量')}</TableHead>
                        <TableHead className="text-right">{t('已到货')}</TableHead>
                        <TableHead className="text-right">{t('进度')}</TableHead>
                        <TableHead className="text-right">{t('单价')}</TableHead>
                        <TableHead className="text-right">{t('小计')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((item) => (
                        <TableRow key={`${item.sku}-${item.name}`}>
                          <TableCell className="px-4 font-mono text-slate-800 tabular-nums">{item.sku}</TableCell>
                          <TableCell className="max-w-[220px] font-medium text-slate-900"><div className="truncate" title={item.name}><AutoTranslatedText text={item.name} /></div></TableCell>
                          <TableCell className="max-w-[240px] text-slate-600"><div className="truncate" title={item.spec}><AutoTranslatedText text={item.spec || '-'} /></div></TableCell>
                          <TableCell className="text-right text-slate-700 tabular-nums">{item.qty} {t(item.unit)}</TableCell>
                          <TableCell className="text-right text-slate-700 tabular-nums">{item.receivedQty} {t(item.unit)}</TableCell>
                          <TableCell className="text-right">
                            <span className="tabular-nums text-slate-600">
                              {item.qty > 0 ? Math.min(100, Math.round((item.receivedQty / item.qty) * 100)) : 0}%
                            </span>
                          </TableCell>
                          <TableCell className="text-right text-slate-700 tabular-nums">{formatCurrency(item.unitPrice, order.currency)}</TableCell>
                          <TableCell className="text-right font-semibold text-slate-900 tabular-nums">{formatCurrency(item.qty * item.unitPrice, order.currency)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-3 text-sm">
                  <span className="text-slate-500">{t('明细合计')}</span>
                  <span className="font-semibold text-slate-900 tabular-nums">{formatCurrency(itemAmount, order.currency)}</span>
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

          <div className="order-horizon-detail-surface grid overflow-hidden border bg-white lg:grid-cols-2">
            <section aria-labelledby="purchase-supplier-title" className="p-4 lg:border-r lg:border-slate-100">
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
            </section>

            <section aria-labelledby="purchase-settlement-title" className="border-t border-slate-100 p-4 lg:border-t-0">
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
              {t('履约进度')}
            </h2>
            <div>
              {timeline.map((item, index) => (
                <TimelineItem key={item.key} active={index < activeTimelineCount} title={item.title} desc={item.desc} />
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
    </div>
  );
}
