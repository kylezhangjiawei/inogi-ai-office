import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import {
  AlertCircle,
  CalendarDays,
  Download,
  Eye,
  FileSpreadsheet,
  Filter,
  Loader2,
  PackageCheck,
  RefreshCw,
  Search,
  Truck,
  Upload,
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

export type { PurchaseOrder, PurchaseOrderLine, PurchaseOrderStatus } from '../../lib/orderProcessingApi';

export const STATUS_OPTIONS: PurchaseOrderStatus[] = ['待确认', '已下单', '部分到货', '已完成', '异常'];

const EMPTY_STATS: PurchaseOrderStats = { total: 0, open: 0, inbound: 0, abnormal: 0, amount: 0 };
const PAGE_SIZE = 50;

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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [stats, setStats] = useState<PurchaseOrderStats>(EMPTY_STATS);
  const [suppliers, setSuppliers] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [supplierFilter, setSupplierFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);

  const loadOrders = useCallback(
    async (nextPage = 1) => {
      setLoading(true);
      try {
        const data = await orderProcessingApi.getPurchaseOrders({
          q: query,
          status: statusFilter,
          supplier: supplierFilter,
          dateFrom,
          dateTo,
          page: nextPage,
          pageSize: PAGE_SIZE,
        });
        setStats(data.stats);
        setSuppliers(data.suppliers);
        setTotal(data.orders.total);
        setPage(data.orders.page);
        setOrders((current) => {
          if (nextPage <= 1) return data.orders.items;
          const merged = new Map(current.map((order) => [order.id, order]));
          data.orders.items.forEach((order) => merged.set(order.id, order));
          return Array.from(merged.values());
        });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t('采购订单加载失败'));
      } finally {
        setLoading(false);
      }
    },
    [dateFrom, dateTo, query, statusFilter, supplierFilter, t],
  );

  useEffect(() => {
    void loadOrders(1);
  }, [loadOrders]);

  const resetFilters = () => {
    setQuery('');
    setStatusFilter('all');
    setSupplierFilter('all');
    setDateFrom('');
    setDateTo('');
  };

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setImporting(true);
    try {
      const result = await orderProcessingApi.importPurchaseOrders([file]);
      toast.success(result.message);
      await loadOrders(1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('采购订单导入失败'));
    } finally {
      setImporting(false);
    }
  };

  const downloadTemplate = () => {
    const header = [
      '采购单号',
      '供应商',
      '采购员',
      '状态',
      '下单日期',
      '预计到货日',
      'SKU',
      '商品名称',
      '规格',
      '单位',
      '采购数量',
      '单价',
      '币种',
      '仓库',
      '采购组',
    ];
    const sample = ['PO-20260601-001', '示例供应商', '王芳', '待确认', '2026-06-01', '2026-06-08', 'BT-001', '无线蓝牙耳机', '黑色', '个', '120', '89', 'CNY', '主仓 - 上海', '采购一组'];
    const blob = new Blob([`\uFEFF${header.join(',')}\n${sample.join(',')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = t('采购订单导入模板.csv');
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const displayedAmount = useMemo(() => orders.reduce((sum, order) => sum + order.amount, 0), [orders]);
  const canLoadMore = orders.length < total;

  return (
    <div className="flex min-h-0 flex-1 flex-col   px-5 py-4">
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv,.tsv"
        className="hidden"
        onChange={handleImport}
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <PackageCheck className="h-4 w-4 text-blue-500" />
            {t('订单与库存')}
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal text-slate-900">{t('采购订单')}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={downloadTemplate}
            className="h-9 border-slate-200 bg-white px-3 text-slate-600 shadow-sm hover:bg-slate-50">
            <Download className="h-4 w-4" />
            {t('模板')}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={importing}
            onClick={() => fileInputRef.current?.click()}
            className="h-9 bg-blue-600 px-3 text-white shadow-sm shadow-blue-200 hover:bg-blue-700">
            {importing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {t('导入')}
          </Button>
        </div>
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-4">
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

      <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-slate-100 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('搜索采购单号、供应商、采购员...')}
                className="h-9 rounded-full border-slate-200 bg-slate-50 pl-9 text-sm"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
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
            <Select value={supplierFilter} onValueChange={setSupplierFilter}>
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
              onChange={(event) => setDateFrom(event.target.value)}
              className="h-9 w-[148px] rounded-full border-slate-200 bg-white text-sm"
            />
            <Input
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
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

        <div className="min-h-0 flex-1 overflow-hidden">
          <Table containerClassName="max-h-full overflow-auto">
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
                  <TableCell className="max-w-[160px] truncate text-slate-500"><AutoTranslatedText text={order.sourceFile || t('系统样例')} /></TableCell>
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

        <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
          <span>
            {t('显示')} {orders.length} / {t('共')} {total} {t('条')}
          </span>
          <div className="flex items-center gap-3">
            <span>{t('当前合计')} {formatCurrency(displayedAmount, 'CNY')} / {t('总额')} {formatCurrency(stats.amount, 'CNY')}</span>
            {canLoadMore && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={loading}
                onClick={() => void loadOrders(page + 1)}
                className="h-8 rounded-full border-slate-200 px-3 text-xs text-slate-600">
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {t('加载更多')}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
