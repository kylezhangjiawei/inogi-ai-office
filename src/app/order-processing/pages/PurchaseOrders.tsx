import { DatePicker } from '../../components/ui/date-picker';
import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import {
  AlertCircle,
  CalendarDays,
  Eye,
  FileSpreadsheet,
  Filter,
  Loader2,
  PackageCheck,
  RefreshCw,
  Search,
  Truck,
} from 'lucide-react';

import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { AutoTranslatedText } from '../../components/TranslatableText';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import {
  orderProcessingApi,
  type PurchaseOrder,
  type PurchaseOrderStats,
  type PurchaseOrderStatus,
} from '../../lib/orderProcessingApi';
import { i18nLocale, useI18n } from '../../lib/i18n';
import { usePermission } from '../../hooks/usePermission';
import {
  getTplusStatus,
  getTplusSyncJob,
  syncTplusOperations,
  waitApplyJob,
} from '../../lib/procurementApi';
import { DataPagination } from '../components/DataPagination';
import {
  OrderEmptyState,
  OrderMetric,
  OrderMetricGrid,
  OrderPageHeader,
} from '../components/HorizonPage';
// 页面路径以「页面路由管理」的配置为准，随主路径变更自动跟随
import { routePath } from "../../lib/routePaths";

export type { PurchaseOrder, PurchaseOrderLine, PurchaseOrderStatus } from '../../lib/orderProcessingApi';

export const STATUS_OPTIONS: PurchaseOrderStatus[] = ['待确认', '已下单', '部分到货', '已完成', '异常'];
const STATUS_FILTER_VALUES = new Set<string>(['all', 'in_transit', ...STATUS_OPTIONS]);

const EMPTY_STATS: PurchaseOrderStats = { total: 0, open: 0, inbound: 0, abnormal: 0, amount: 0 };
type PurchaseOrderQuery = {
  q: string;
  status: string;
  supplier: string;
  dateFrom: string;
  dateTo: string;
  page: number;
  pageSize: number;
};

export function formatCurrency(value: number, currency: PurchaseOrder['currency']) {
  return new Intl.NumberFormat(i18nLocale(), {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(value);
}

export function statusBadgeClass(status: PurchaseOrderStatus) {
  switch (status) {
    case '待确认':
      return 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-50';
    case '已下单':
      return 'border-[#cbd8f6] bg-accent text-primary hover:bg-accent';
    case '部分到货':
      return 'border-amber-100 bg-amber-50 text-amber-700 hover:bg-amber-50';
    case '已完成':
      return 'border-emerald-100 bg-emerald-50 text-emerald-700 hover:bg-emerald-50';
    case '异常':
      return 'border-rose-100 bg-rose-50 text-rose-700 hover:bg-rose-50';
  }
}

export function PurchaseOrders() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { t } = useI18n();
  const canSync = usePermission('proc:sync-erp');
  const canViewDetail = usePermission('page:purchase-order-detail');
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [stats, setStats] = useState<PurchaseOrderStats>(EMPTY_STATS);
  const [suppliers, setSuppliers] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState(() => {
    const requested = searchParams.get('status')?.trim() ?? '';
    return STATUS_FILTER_VALUES.has(requested) ? requested : 'all';
  });
  const [supplierFilter, setSupplierFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState('');
  const [syncError, setSyncError] = useState('');
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [integration, setIntegration] = useState<{ configured: boolean; authorized: boolean } | null>(null);
  const mountedRef = useRef(false);
  const loadRequestRef = useRef(0);
  const syncingRef = useRef(false);
  const deferredQuery = useDeferredValue(query.trim());
  const requestParams = useMemo<PurchaseOrderQuery>(() => ({
    q: deferredQuery,
    status: statusFilter,
    supplier: supplierFilter,
    dateFrom,
    dateTo,
    page,
    pageSize,
  }), [dateFrom, dateTo, deferredQuery, page, pageSize, statusFilter, supplierFilter]);
  const requestParamsRef = useRef(requestParams);
  requestParamsRef.current = requestParams;

  const loadOrders = useCallback(
    async (params: PurchaseOrderQuery = requestParamsRef.current) => {
      const requestId = ++loadRequestRef.current;
      setLoading(true);
      setLoadError('');
      try {
        const data = await orderProcessingApi.getPurchaseOrders({
          q: params.q,
          status: params.status,
          supplier: params.supplier,
          dateFrom: params.dateFrom,
          dateTo: params.dateTo,
          page: params.page,
          pageSize: params.pageSize,
        });
        if (requestId !== loadRequestRef.current) return true;
        setStats(data.stats);
        setSuppliers(data.suppliers);
        setSyncedAt(data.syncedAt ?? null);
        setTotal(data.orders.total);
        setPage(data.orders.page);
        setTotalPages(data.orders.totalPages);
        setOrders(data.orders.items);
        return true;
      } catch (error) {
        if (requestId !== loadRequestRef.current) return true;
        setLoadError(error instanceof Error ? error.message : t('采购订单加载失败'));
        return false;
      } finally {
        if (requestId === loadRequestRef.current) setLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    void loadOrders(requestParams);
    return () => {
      loadRequestRef.current += 1;
    };
  }, [loadOrders, requestParams]);

  useEffect(() => {
    let alive = true;
    getTplusStatus()
      .then((status) => {
        if (alive) setIntegration(status);
      })
      .catch(() => {
        if (alive) setIntegration(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  const resetFilters = () => {
    setQuery('');
    setStatusFilter('all');
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('status');
      return next;
    }, { replace: true });
    setSupplierFilter('all');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  };

  const activeFilterCount = [
    Boolean(query.trim()),
    statusFilter !== 'all',
    supplierFilter !== 'all',
    Boolean(dateFrom),
    Boolean(dateTo),
  ].filter(Boolean).length;
  const hasActiveFilters = activeFilterCount > 0;

  const handleSync = async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    setSyncError('');
    setSyncProgress(t('正在启动畅捷通同步…'));
    try {
      const { jobId } = await syncTplusOperations();
      await waitApplyJob(jobId, (message) => {
        if (mountedRef.current) setSyncProgress(message);
      }, getTplusSyncJob);
      if (!mountedRef.current) return;
      const [status, loaded] = await Promise.all([getTplusStatus(), loadOrders()]);
      if (!loaded) throw new Error(t('同步已完成，但采购订单刷新失败，请重试'));
      if (!mountedRef.current) return;
      setIntegration(status);
      toast.success(t('畅捷通采购订单和库存已同步'));
    } catch (error) {
      if (!mountedRef.current) return;
      const message = error instanceof Error ? error.message : t('畅捷通同步失败');
      setSyncError(message);
      toast.error(message);
    } finally {
      syncingRef.current = false;
      if (mountedRef.current) {
        setSyncing(false);
        setSyncProgress('');
      }
    }
  };

  const displayedAmount = useMemo(() => orders.reduce((sum, order) => sum + order.amount, 0), [orders]);
  return (
    <div className="order-horizon flex h-full min-h-0 flex-1 flex-col overflow-auto px-4 py-4 sm:px-5">
      <OrderPageHeader
        Icon={PackageCheck}
        eyebrow={t('订单与库存')}
        title={t('采购订单')}
        meta={(
          <>
            <span>{t('数据来源：畅捷通 T+（只读）')} · </span>
            <span>{t('最后同步')}：{syncedAt ? new Date(syncedAt).toLocaleString(i18nLocale()) : '-'}</span>
            {syncProgress ? <span role="status" aria-live="polite" className="text-blue-700">· {syncProgress}</span> : null}
            {syncError ? <span role="alert" className="text-rose-700">· {syncError}</span> : null}
          </>
        )}
        actions={(
          <>
          <Badge
            variant="secondary"
            className={integration?.authorized
              ? 'rounded-full border border-emerald-100 bg-emerald-50 text-emerald-700'
              : 'rounded-full border border-amber-100 bg-amber-50 text-amber-700'}>
            {integration?.authorized ? t('T+ 已授权') : t('T+ 未授权')}
          </Badge>
          {canSync ? (
            <Button
              type="button"
              size="sm"
              disabled={syncing || !integration?.configured || !integration?.authorized}
              onClick={() => void handleSync()}
              className="order-horizon-primary-action h-10 px-3 text-white">
              <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? t('同步中') : t('同步畅捷通')}
            </Button>
          ) : null}
          </>
        )}
      />

      <OrderMetricGrid>
        <OrderMetric Icon={FileSpreadsheet} label={t('采购单数')} value={stats.total} tone="primary" />
        <OrderMetric Icon={Truck} label={t('待推进')} value={stats.open} tone="primary" />
        <OrderMetric Icon={CalendarDays} label={t('部分到货')} value={stats.inbound} tone="warning" />
        <OrderMetric Icon={AlertCircle} label={t('异常')} value={stats.abnormal} tone="danger" />
      </OrderMetricGrid>

      <div className="order-horizon-data-surface flex min-h-fit flex-1 shrink-0 flex-col overflow-hidden border bg-white" aria-busy={loading}>
        <div className="order-horizon-toolbar shrink-0 border-b border-slate-100 px-4 py-3">
          <div role="search" aria-label={t('采购订单筛选')} className="flex flex-wrap items-end gap-2">
            <div className="relative w-full min-w-0 sm:min-w-[220px] sm:max-w-xl sm:flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
                aria-label={t('搜索采购订单')}
                placeholder={t('搜索采购单号、供应商、采购员...')}
                className="h-9 border-slate-200 bg-white pl-9 text-sm"
              />
            </div>
            <Select value={statusFilter} onValueChange={(value) => {
              setStatusFilter(value);
              setSearchParams((current) => {
                const next = new URLSearchParams(current);
                if (value === 'all') next.delete('status');
                else next.set('status', value);
                return next;
              }, { replace: true });
              setPage(1);
            }}>
              <SelectTrigger aria-label={t('按订单状态筛选')} className="h-9 w-full rounded-full border-slate-200 bg-white text-sm sm:w-[148px]">
                <SelectValue placeholder={t('状态')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('全部状态')}</SelectItem>
                <SelectItem value="in_transit">{t('在途未完成')}</SelectItem>
                {STATUS_OPTIONS.map((status) => (
                  <SelectItem key={status} value={status}>
                    {t(status)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={supplierFilter} onValueChange={(value) => {
              setSupplierFilter(value);
              setPage(1);
            }}>
              <SelectTrigger aria-label={t('按供应商筛选')} className="h-9 w-full rounded-full border-slate-200 bg-white text-sm sm:w-[184px]">
                <SelectValue placeholder={t('供应商')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('全部供应商')}</SelectItem>
                {suppliers.map((supplier) => (
                  <SelectItem key={supplier} value={supplier}>
                    <AutoTranslatedText text={supplier} />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <fieldset className="flex min-w-0 w-full flex-wrap items-center gap-2 sm:w-auto">
              <legend className="mb-1 text-xs font-medium text-muted-foreground">{t('下单日期')}</legend>
            <DatePicker
              aria-label={t('下单开始日期')}
              max={dateTo || undefined}
              value={dateFrom}
              onValueChange={(event) => {
                setDateFrom(event);
                setPage(1);
              }}
              className="h-9 min-w-0 flex-1 border-slate-200 bg-white text-sm sm:w-[146px] sm:flex-none"
            />
            <span className="text-xs text-muted-foreground">{t('至')}</span>
            <DatePicker
              aria-label={t('下单结束日期')}
              min={dateFrom || undefined}
              value={dateTo}
              onValueChange={(event) => {
                setDateTo(event);
                setPage(1);
              }}
              className="h-9 min-w-0 flex-1 border-slate-200 bg-white text-sm sm:w-[146px] sm:flex-none"
            />
            </fieldset>
            {hasActiveFilters ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={t('清除全部采购订单筛选，共 {count} 项', { count: activeFilterCount })}
                onClick={resetFilters}
                className="order-horizon-secondary-action h-9 w-full border-slate-200 px-3 text-slate-600 sm:w-auto">
                <Filter className="h-4 w-4" />
                {t('清除筛选')}
                <span className="tabular-nums" aria-hidden="true">({activeFilterCount})</span>
              </Button>
            ) : null}
            {loading && orders.length > 0 ? (
              <span role="status" aria-live="polite" className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                <Loader2 className="size-3.5 animate-spin" />
                {t('正在更新结果')}
              </span>
            ) : null}
          </div>
        </div>

        {loadError && orders.length > 0 ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-2 border-b border-rose-100 bg-rose-50 px-4 py-2.5 text-sm text-rose-700">
            <span className="min-w-0 text-pretty">{t('采购订单更新失败')}：{loadError}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => void loadOrders()} className="h-8 border-rose-200 bg-white text-rose-700 hover:bg-rose-50">
              <RefreshCw className="size-3.5" />
              {t('重试')}
            </Button>
          </div>
        ) : null}

        <div
          role="region"
          aria-label={t('采购订单列表，可横向滚动查看更多字段')}
          tabIndex={0}
          className="relative min-h-72 flex-1 lg:min-h-64 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
          <span role="status" aria-live="polite" className="sr-only">
            {loading ? t('正在加载采购订单') : t('采购订单加载完成，共 {count} 条', { count: total })}
          </span>
          <Table containerClassName="order-horizon-table absolute inset-0 h-full overflow-auto" className="min-w-[1120px]" aria-label={t('采购订单数据')}>
            <TableHeader className="sticky top-0 z-10 bg-slate-50">
              <TableRow className="border-slate-100">
                <TableHead className="px-4">{t('采购单号')}</TableHead>
                <TableHead>{t('供应商')}</TableHead>
                <TableHead>{t('状态')}</TableHead>
                <TableHead>{t('采购员')}</TableHead>
                <TableHead>{t('下单日期')}</TableHead>
                <TableHead>{t('预计到货')}</TableHead>
                <TableHead className="text-right">SKU</TableHead>
                <TableHead className="text-right">{t('金额')}</TableHead>
                <TableHead>{t('到货仓')}</TableHead>
                <TableHead>{t('来源')}</TableHead>
                <TableHead className="order-horizon-sticky-action sticky right-0 bg-slate-50 text-right">{t('操作')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order) => (
                <TableRow key={order.id} className="border-slate-100">
                  <TableCell className="px-4 font-mono text-sm text-slate-800 tabular-nums">{order.poNo}</TableCell>
                  <TableCell className="max-w-[220px] truncate font-medium text-slate-800" title={order.supplier}><AutoTranslatedText text={order.supplier} /></TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={`rounded-full px-2.5 py-1 font-medium ${statusBadgeClass(order.status)}`}>
                      {t(order.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-slate-600">{order.buyer}</TableCell>
                  <TableCell className="text-slate-600 tabular-nums">{order.orderDate}</TableCell>
                  <TableCell className="text-slate-800 tabular-nums">{order.etaDate || '-'}</TableCell>
                  <TableCell className="text-right text-slate-700 tabular-nums">{order.itemCount}</TableCell>
                  <TableCell className="text-right font-semibold text-slate-900 tabular-nums">{formatCurrency(order.amount, order.currency)}</TableCell>
                  <TableCell className="text-slate-600"><AutoTranslatedText text={order.warehouse} /></TableCell>
                  <TableCell className="max-w-[160px] truncate text-slate-500"><AutoTranslatedText text={order.sourceFile || t('畅捷通 T+')} /></TableCell>
                  <TableCell className="order-horizon-sticky-action sticky right-0 bg-white text-right">
                    {canViewDetail ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={t('查看采购订单 {poNo}', { poNo: order.poNo })}
                        onClick={() => navigate(`${routePath("page:purchase-orders", "/purchase-orders")}/${encodeURIComponent(order.id)}`)}
                        className="order-horizon-row-action h-8 px-3 text-xs font-medium">
                        <Eye className="h-3.5 w-3.5" />
                        {t('查看')}
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">{t('无详情权限')}</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!loading && loadError && orders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} className="h-44 text-center text-sm text-muted-foreground">
                    <OrderEmptyState
                      Icon={AlertCircle}
                      title={t('采购订单加载失败')}
                      description={loadError}
                      action={(
                        <Button type="button" variant="outline" size="sm" onClick={() => void loadOrders()} className="order-horizon-secondary-action">
                          <RefreshCw className="size-4" />
                          {t('重新加载')}
                        </Button>
                      )}
                    />
                  </TableCell>
                </TableRow>
              ) : null}
              {!loading && !loadError && orders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} className="h-44 text-center text-sm text-muted-foreground">
                    <OrderEmptyState
                      Icon={PackageCheck}
                      title={hasActiveFilters ? t('暂无匹配的采购订单') : t('暂无采购订单')}
                      description={hasActiveFilters
                        ? t('可清除筛选条件后重新查看全部采购单。')
                        : t('当前没有可显示的采购订单，可重新加载畅捷通数据。')}
                      action={hasActiveFilters ? (
                        <Button type="button" variant="outline" size="sm" onClick={resetFilters} className="order-horizon-secondary-action">
                          <Filter className="size-4" />
                          {t('清除筛选')}
                        </Button>
                      ) : (
                        <Button type="button" variant="outline" size="sm" onClick={() => void loadOrders()} className="order-horizon-secondary-action">
                          <RefreshCw className="size-4" />
                          {t('刷新数据')}
                        </Button>
                      )}
                    />
                  </TableCell>
                </TableRow>
              ) : null}
              {loading && orders.length === 0 ? (
                <>
                  {Array.from({ length: 6 }, (_, rowIndex) => (
                    <TableRow key={`purchase-order-skeleton-${rowIndex}`} aria-hidden="true" className="border-slate-100">
                      {Array.from({ length: 11 }, (_, cellIndex) => (
                        <TableCell key={cellIndex} className="h-12">
                          <span className="block h-3 w-full max-w-24 animate-pulse rounded-full bg-slate-100" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </>
              ) : null}
            </TableBody>
          </Table>
        </div>

        <div className="shrink-0 border-t border-slate-100 px-4 py-2 text-right text-xs text-slate-500 tabular-nums">
          {t('当前页合计')} {formatCurrency(displayedAmount, 'CNY')} / {t('筛选结果总额')} {formatCurrency(stats.amount, 'CNY')}
        </div>
        <DataPagination
          page={page}
          pageSize={pageSize}
          total={total}
          totalPages={totalPages}
          loading={loading}
          onPageChange={setPage}
          onPageSizeChange={(nextPageSize) => {
            setPageSize(nextPageSize);
            setPage(1);
          }}
        />
      </div>
    </div>
  );
}
