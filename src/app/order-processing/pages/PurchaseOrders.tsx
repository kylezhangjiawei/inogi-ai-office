import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
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

export type { PurchaseOrder, PurchaseOrderLine, PurchaseOrderStatus } from '../../lib/orderProcessingApi';

export const STATUS_OPTIONS: PurchaseOrderStatus[] = ['待确认', '已下单', '部分到货', '已完成', '异常'];

const EMPTY_STATS: PurchaseOrderStats = { total: 0, open: 0, inbound: 0, abnormal: 0, amount: 0 };
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
      return 'border-blue-100 bg-blue-50 text-blue-700 hover:bg-blue-50';
    case '已下单':
      return 'border-indigo-100 bg-indigo-50 text-indigo-700 hover:bg-indigo-50';
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
  const { t } = useI18n();
  const canSync = usePermission('proc:sync-erp');
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [stats, setStats] = useState<PurchaseOrderStats>(EMPTY_STATS);
  const [suppliers, setSuppliers] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [supplierFilter, setSupplierFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState('');
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [integration, setIntegration] = useState<{ configured: boolean; authorized: boolean } | null>(null);

  const loadOrders = useCallback(
    async () => {
      setLoading(true);
      try {
        const data = await orderProcessingApi.getPurchaseOrders({
          q: query,
          status: statusFilter,
          supplier: supplierFilter,
          dateFrom,
          dateTo,
          page,
          pageSize,
        });
        setStats(data.stats);
        setSuppliers(data.suppliers);
        setSyncedAt(data.syncedAt ?? null);
        setTotal(data.orders.total);
        setPage(data.orders.page);
        setTotalPages(data.orders.totalPages);
        setOrders(data.orders.items);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t('采购订单加载失败'));
      } finally {
        setLoading(false);
      }
    },
    [dateFrom, dateTo, page, pageSize, query, statusFilter, supplierFilter, t],
  );

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

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
    setSupplierFilter('all');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncProgress(t('正在启动畅捷通同步…'));
    try {
      const { jobId } = await syncTplusOperations();
      await waitApplyJob(jobId, setSyncProgress, getTplusSyncJob);
      const [status] = await Promise.all([getTplusStatus(), loadOrders()]);
      setIntegration(status);
      toast.success(t('畅捷通采购订单和库存已同步'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('畅捷通同步失败'));
    } finally {
      setSyncing(false);
      setSyncProgress('');
    }
  };

  const displayedAmount = useMemo(() => orders.reduce((sum, order) => sum + order.amount, 0), [orders]);
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden px-5 py-4">
      <div className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <PackageCheck className="h-4 w-4 text-blue-500" />
            {t('订单与库存')}
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900 text-balance">{t('采购订单')}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>{t('数据来源：畅捷通 T+（只读）')}</span>
            <span>·</span>
            <span>{t('最后同步')}：{syncedAt ? new Date(syncedAt).toLocaleString(i18nLocale()) : '-'}</span>
            {syncProgress ? <span className="text-blue-600">· {syncProgress}</span> : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
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
              className="h-9 bg-blue-600 px-3 text-white shadow-sm shadow-blue-200 hover:bg-blue-700">
              <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? t('同步中') : t('同步畅捷通')}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="mb-4 grid shrink-0 gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-slate-100 bg-white px-4 py-3 shadow-sm">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>{t('采购单数')}</span>
            <FileSpreadsheet className="h-4 w-4 text-blue-500" />
          </div>
          <div className="mt-2 text-2xl font-semibold text-slate-900">{stats.total}</div>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white px-4 py-3 shadow-sm">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>{t('待推进')}</span>
            <Truck className="h-4 w-4 text-indigo-500" />
          </div>
          <div className="mt-2 text-2xl font-semibold text-slate-900">{stats.open}</div>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white px-4 py-3 shadow-sm">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>{t('部分到货')}</span>
            <CalendarDays className="h-4 w-4 text-amber-500" />
          </div>
          <div className="mt-2 text-2xl font-semibold text-slate-900">{stats.inbound}</div>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white px-4 py-3 shadow-sm">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>{t('异常')}</span>
            <AlertCircle className="h-4 w-4 text-rose-500" />
          </div>
          <div className="mt-2 text-2xl font-semibold text-slate-900">{stats.abnormal}</div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
        <div className="shrink-0 border-b border-slate-100 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
                placeholder={t('搜索采购单号、供应商、采购员...')}
                className="h-9 rounded-full border-slate-200 bg-slate-50 pl-9 text-sm"
              />
            </div>
            <Select value={statusFilter} onValueChange={(value) => {
              setStatusFilter(value);
              setPage(1);
            }}>
              <SelectTrigger className="h-9 w-[132px] rounded-full border-slate-200 bg-white text-sm">
                <SelectValue placeholder={t('状态')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('全部状态')}</SelectItem>
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
              <SelectTrigger className="h-9 w-[176px] rounded-full border-slate-200 bg-white text-sm">
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
            <Input
              type="date"
              value={dateFrom}
              onChange={(event) => {
                setDateFrom(event.target.value);
                setPage(1);
              }}
              className="h-9 w-[148px] rounded-full border-slate-200 bg-white text-sm"
            />
            <Input
              type="date"
              value={dateTo}
              onChange={(event) => {
                setDateTo(event.target.value);
                setPage(1);
              }}
              className="h-9 w-[148px] rounded-full border-slate-200 bg-white text-sm"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={resetFilters}
              className="h-9 rounded-full border-slate-200 px-3 text-slate-600">
              <Filter className="h-4 w-4" />
              {t('重置')}
            </Button>
          </div>
        </div>

        <div className="relative min-h-0 flex-1">
          <Table containerClassName="absolute inset-0 h-full overflow-auto">
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
                <TableHead className="sticky right-0 bg-slate-50 text-right">{t('操作')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order) => (
                <TableRow key={order.id} className="border-slate-100">
                  <TableCell className="px-4 font-mono text-sm text-slate-800">{order.poNo}</TableCell>
                  <TableCell className="max-w-[220px] truncate font-medium text-slate-800"><AutoTranslatedText text={order.supplier} /></TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={`rounded-full px-2.5 py-1 font-medium ${statusBadgeClass(order.status)}`}>
                      {t(order.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-slate-600">{order.buyer}</TableCell>
                  <TableCell className="text-slate-600">{order.orderDate}</TableCell>
                  <TableCell className="text-slate-800">{order.etaDate}</TableCell>
                  <TableCell className="text-right text-slate-700">{order.itemCount}</TableCell>
                  <TableCell className="text-right font-semibold text-slate-900">{formatCurrency(order.amount, order.currency)}</TableCell>
                  <TableCell className="text-slate-600"><AutoTranslatedText text={order.warehouse} /></TableCell>
                  <TableCell className="max-w-[160px] truncate text-slate-500"><AutoTranslatedText text={order.sourceFile || t('畅捷通 T+')} /></TableCell>
                  <TableCell className="sticky right-0 bg-white text-right">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => navigate(`/purchase-orders/${encodeURIComponent(order.id)}`)}
                      className="h-8 rounded-full border-blue-100 bg-blue-50 px-3 text-xs font-medium text-blue-700 hover:bg-blue-100">
                      <Eye className="h-3.5 w-3.5" />
                      {t('查看')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!loading && orders.length === 0 && (
                <TableRow>
                  <TableCell colSpan={11} className="h-28 text-center text-sm text-slate-400">
                    {t('暂无匹配的采购订单')}
                  </TableCell>
                </TableRow>
              )}
              {loading && orders.length === 0 && (
                <TableRow>
                  <TableCell colSpan={11} className="h-28 text-center text-sm text-slate-400">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t('正在加载采购订单')}
                    </span>
                  </TableCell>
                </TableRow>
              )}
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
