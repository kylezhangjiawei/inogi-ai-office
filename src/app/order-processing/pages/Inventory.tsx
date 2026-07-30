import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Eye,
  Layers3,
  Loader2,
  PackageOpen,
  RefreshCw,
  Search,
  ShieldCheck,
  Truck,
  Warehouse,
} from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
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
import { AutoTranslatedText } from '../../components/TranslatableText';
import { usePermission } from '../../hooks/usePermission';
import {
  type InventoryItem,
  type InventoryDetailResponse,
  type InventoryResponse,
  orderProcessingApi,
} from '../../lib/orderProcessingApi';
import {
  getTplusStatus,
  getTplusSyncJob,
  syncTplusOperations,
  waitApplyJob,
} from '../../lib/procurementApi';
import { i18nLocale, useI18n } from '../../lib/i18n';
import { DataPagination } from '../components/DataPagination';

const EMPTY_SUMMARY = { totalSku: 0, normal: 0, low: 0, shortage: 0 };

function statusClass(status: InventoryItem['status']) {
  if (status === '缺货') return 'border-rose-100 bg-rose-50 text-rose-700';
  if (status === '偏低') return 'border-amber-100 bg-amber-50 text-amber-700';
  return 'border-emerald-100 bg-emerald-50 text-emerald-700';
}

function quantity(value: number | undefined) {
  return new Intl.NumberFormat(i18nLocale(), { maximumFractionDigits: 3 }).format(value ?? 0);
}

export function Inventory() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const canSync = usePermission('proc:sync-erp');
  const [data, setData] = useState<InventoryResponse | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState('');
  const [integration, setIntegration] = useState<{ configured: boolean; authorized: boolean } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<InventoryDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  const loadInventory = useCallback(async () => {
    setLoading(true);
    try {
      const response = await orderProcessingApi.getInventory({
        q: query,
        category,
        status,
        page,
        pageSize,
      });
      setData(response);
      setPage(response.inventory.page);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('库存加载失败'));
    } finally {
      setLoading(false);
    }
  }, [category, page, pageSize, query, status, t]);

  useEffect(() => {
    void loadInventory();
  }, [loadInventory]);

  useEffect(() => {
    let alive = true;
    getTplusStatus()
      .then((result) => {
        if (alive) setIntegration(result);
      })
      .catch(() => {
        if (alive) setIntegration(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    setSyncProgress(t('正在启动畅捷通同步…'));
    try {
      const { jobId } = await syncTplusOperations();
      await waitApplyJob(jobId, setSyncProgress, getTplusSyncJob);
      const [nextStatus] = await Promise.all([getTplusStatus(), loadInventory()]);
      setIntegration(nextStatus);
      toast.success(t('畅捷通库存和采购订单已同步'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('畅捷通同步失败'));
    } finally {
      setSyncing(false);
      setSyncProgress('');
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      await orderProcessingApi.exportInventory({ q: query, category, status });
      toast.success(t('库存数据已导出'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('库存导出失败'));
    } finally {
      setExporting(false);
    }
  };

  const openDetail = async (itemId: string) => {
    setDetailId(itemId);
    setDetail(null);
    setDetailError('');
    setDetailLoading(true);
    try {
      setDetail(await orderProcessingApi.getInventoryDetail(itemId));
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : t('库存详情加载失败'));
    } finally {
      setDetailLoading(false);
    }
  };

  const summary = data?.summary ?? EMPTY_SUMMARY;
  const rows = data?.inventory.items ?? [];
  const categories = data?.categories ?? [];
  const paging = data?.inventory;
  const lastSync = data?.syncedAt
    ? new Date(data.syncedAt).toLocaleString(i18nLocale())
    : '-';
  const warehouseCount = useMemo(
    () => new Set(rows.flatMap((item) => item.warehouses?.map((warehouse) => warehouse.name) ?? [])).size,
    [rows],
  );

  const updateQuery = (value: string) => {
    setQuery(value);
    setPage(1);
  };

  const updateCategory = (value: string) => {
    setCategory(value);
    setPage(1);
  };

  const updateStatus = (value: string) => {
    setStatus(value);
    setPage(1);
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden px-5 py-4">
      <div className="mb-4 flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Warehouse className="h-4 w-4 text-blue-500" />
            {t('订单与库存')}
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900 text-balance">{t('库存管理')}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>{t('数据来源：畅捷通 T+（只读）')}</span>
            <span>·</span>
            <span>{t('最后同步')}：{lastSync}</span>
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
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={exporting}
            onClick={() => void handleExport()}
            className="h-9 rounded-full border-slate-200 px-3 text-slate-600">
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {t('导出')}
          </Button>
          {canSync ? (
            <Button
              type="button"
              size="sm"
              disabled={syncing || !integration?.configured || !integration?.authorized}
              onClick={() => void handleSync()}
              className="h-9 rounded-full bg-blue-600 px-3 text-white shadow-sm shadow-blue-200 hover:bg-blue-700">
              <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? t('同步中') : t('同步畅捷通')}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="mb-4 grid shrink-0 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-2xl border border-slate-100 bg-white px-4 py-3 shadow-sm">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>{t('总SKU数量')}</span>
            <Layers3 className="h-4 w-4 text-blue-500" />
          </div>
          <div className="mt-2 text-2xl font-semibold text-slate-900">{summary.totalSku}</div>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white px-4 py-3 shadow-sm">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>{t('库存正常')}</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="mt-2 text-2xl font-semibold text-slate-900">{summary.normal}</div>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white px-4 py-3 shadow-sm">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>{t('库存偏低')}</span>
            <ShieldCheck className="h-4 w-4 text-amber-500" />
          </div>
          <div className="mt-2 text-2xl font-semibold text-slate-900">{summary.low}</div>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white px-4 py-3 shadow-sm">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>{t('缺货状态')}</span>
            <AlertCircle className="h-4 w-4 text-rose-500" />
          </div>
          <div className="mt-2 text-2xl font-semibold text-slate-900">{summary.shortage}</div>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white px-4 py-3 shadow-sm">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>{t('当前仓库')}</span>
            <Warehouse className="h-4 w-4 text-indigo-500" />
          </div>
          <div className="mt-2 text-2xl font-semibold text-slate-900">{warehouseCount}</div>
          <div className="mt-1 text-[11px] text-slate-400">{t('当前页涉及仓库')}</div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
          <div className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={query}
              onChange={(event) => updateQuery(event.target.value)}
              placeholder={t('搜索存货编码、名称或规格')}
              className="h-9 rounded-full border-slate-200 bg-slate-50 pl-9 text-sm"
            />
          </div>
          <Select value={category} onValueChange={updateCategory}>
            <SelectTrigger className="h-9 w-[170px] rounded-full border-slate-200 bg-white text-sm">
              <SelectValue placeholder={t('分类')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('所有类目')}</SelectItem>
              {categories.map((item) => (
                <SelectItem key={item} value={item}><AutoTranslatedText text={item} /></SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={updateStatus}>
            <SelectTrigger className="h-9 w-[140px] rounded-full border-slate-200 bg-white text-sm">
              <SelectValue placeholder={t('状态')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('所有状态')}</SelectItem>
              <SelectItem value="正常">{t('库存正常')}</SelectItem>
              <SelectItem value="偏低">{t('库存偏低')}</SelectItem>
              <SelectItem value="缺货">{t('缺货')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="relative min-h-0 flex-1">
          <Table containerClassName="absolute inset-0 h-full overflow-auto">
            <TableHeader className="sticky top-0 z-10 bg-slate-50">
              <TableRow className="border-slate-100">
                <TableHead className="px-4">{t('存货编码')}</TableHead>
                <TableHead>{t('存货名称 / 规格')}</TableHead>
                <TableHead>{t('分类')}</TableHead>
                <TableHead>{t('仓库')}</TableHead>
                <TableHead className="text-right">{t('现存量')}</TableHead>
                <TableHead className="text-right">{t('可用量')}</TableHead>
                <TableHead className="text-right">{t('在途量')}</TableHead>
                <TableHead className="text-right">{t('安全库存')}</TableHead>
                <TableHead className="text-right">{t('状态')}</TableHead>
                <TableHead className="sticky right-0 bg-slate-50 text-right">{t('操作')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((item) => {
                const warehouseNames = item.warehouses?.map((warehouse) => warehouse.name) ?? [];
                return (
                  <TableRow key={item.id} className="border-slate-100">
                    <TableCell className="px-4 font-mono text-sm text-slate-800">{item.id}</TableCell>
                    <TableCell>
                      <div className="font-medium text-slate-900"><AutoTranslatedText text={item.name} /></div>
                      <div className="mt-0.5 text-xs text-slate-400">
                        <AutoTranslatedText text={item.spec || '-'} /> {item.unit ? `· ${t(item.unit)}` : ''}
                      </div>
                    </TableCell>
                    <TableCell className="text-slate-600"><AutoTranslatedText text={item.category} /></TableCell>
                    <TableCell className="max-w-[220px] text-slate-600" title={warehouseNames.join('、')}>
                      <div className="truncate">{warehouseNames.length ? warehouseNames.join('、') : '-'}</div>
                      {warehouseNames.length > 1 ? <div className="text-[11px] text-slate-400">{warehouseNames.length} {t('个仓库')}</div> : null}
                    </TableCell>
                    <TableCell className="text-right font-semibold text-slate-900">{quantity(item.stock)}</TableCell>
                    <TableCell className="text-right text-slate-700">{quantity(item.available)}</TableCell>
                    <TableCell className="text-right">
                      <span className="inline-flex items-center justify-end gap-1 text-indigo-700">
                        {item.in > 0 ? <Truck className="h-3.5 w-3.5" /> : null}
                        {quantity(item.in)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-slate-700">{quantity(item.safe)}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant="secondary" className={`rounded-full border px-2.5 py-1 font-medium ${statusClass(item.status)}`}>
                        {t(item.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="sticky right-0 bg-white text-right">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void openDetail(item.id)}
                        className="h-8 rounded-full border-blue-100 bg-blue-50 px-3 text-xs text-blue-700 hover:bg-blue-100">
                        <Eye className="size-3.5" />
                        {t('详情')}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!loading && rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="h-36 text-center">
                    <div className="flex flex-col items-center gap-2 text-sm text-slate-400">
                      <PackageOpen className="h-9 w-9 text-slate-300" />
                      <span>{integration?.authorized ? t('畅捷通暂无匹配库存数据') : t('请先配置并授权畅捷通 T+')}</span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : null}
              {loading && rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="h-36 text-center text-sm text-slate-400">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t('正在加载畅捷通库存')}
                    </span>
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>

        <DataPagination
          page={paging?.page ?? page}
          pageSize={pageSize}
          total={paging?.total ?? 0}
          totalPages={paging?.totalPages ?? 1}
          loading={loading}
          onPageChange={setPage}
          onPageSizeChange={(nextPageSize) => {
            setPageSize(nextPageSize);
            setPage(1);
          }}
        />
      </div>

      <Dialog open={Boolean(detailId)} onOpenChange={(open) => {
        if (!open) {
          setDetailId(null);
          setDetail(null);
          setDetailError('');
        }
      }}>
        <DialogContent className="max-h-[90vh] gap-0 overflow-hidden p-0 sm:max-w-5xl">
          <DialogHeader className="border-b border-slate-100 px-6 py-5 pr-14">
            <DialogTitle className="text-balance">
              {detail?.item.name || t('库存详情')}
            </DialogTitle>
            <DialogDescription className="text-pretty">
              {detail?.item.id || detailId} · {t('畅捷通 T+ 多仓库存只读明细')}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[calc(90vh-88px)] overflow-y-auto p-6">
            {detailLoading ? (
              <div className="flex min-h-56 items-center justify-center text-sm text-slate-500">
                <Loader2 className="mr-2 size-4 animate-spin" />
                {t('正在加载库存详情')}
              </div>
            ) : detailError ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                {detailError}
              </div>
            ) : detail ? (
              <div className="space-y-5">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  {[
                    [t('现存量'), quantity(detail.item.stock)],
                    [t('可用量'), quantity(detail.item.available)],
                    [t('在途量'), quantity(detail.item.in)],
                    [t('安全库存'), quantity(detail.item.safe)],
                    [t('库存状态'), t(detail.item.status)],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                      <div className="text-xs text-slate-500">{label}</div>
                      <div className="mt-1 text-lg font-semibold text-slate-900 tabular-nums">{value}</div>
                    </div>
                  ))}
                </div>

                <section className="rounded-2xl border border-slate-100">
                  <div className="border-b border-slate-100 px-4 py-3">
                    <h3 className="text-sm font-semibold text-slate-900 text-balance">{t('分仓库存')}</h3>
                  </div>
                  <Table>
                    <TableHeader className="bg-slate-50">
                      <TableRow>
                        <TableHead className="px-4">{t('仓库')}</TableHead>
                        <TableHead className="text-right">{t('现存量')}</TableHead>
                        <TableHead className="text-right">{t('可用量')}</TableHead>
                        <TableHead className="text-right">{t('在途量')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(detail.item.warehouses ?? []).map((warehouse) => (
                        <TableRow key={warehouse.name}>
                          <TableCell className="px-4 font-medium text-slate-800"><AutoTranslatedText text={warehouse.name} /></TableCell>
                          <TableCell className="text-right tabular-nums">{quantity(warehouse.stock)}</TableCell>
                          <TableCell className="text-right tabular-nums">{quantity(warehouse.available)}</TableCell>
                          <TableCell className="text-right tabular-nums">{quantity(warehouse.inTransit)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </section>

                <section className="rounded-2xl border border-slate-100">
                  <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                    <h3 className="text-sm font-semibold text-slate-900 text-balance">{t('近期采购订单')}</h3>
                    <span className="text-xs text-slate-400">{detail.relatedPurchaseOrders?.length ?? 0} {t('条')}</span>
                  </div>
                  <Table>
                    <TableHeader className="bg-slate-50">
                      <TableRow>
                        <TableHead className="px-4">{t('采购单号')}</TableHead>
                        <TableHead>{t('供应商')}</TableHead>
                        <TableHead>{t('下单日期')}</TableHead>
                        <TableHead className="text-right">{t('采购数量')}</TableHead>
                        <TableHead className="text-right">{t('已到货')}</TableHead>
                        <TableHead className="text-right">{t('状态')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(detail.relatedPurchaseOrders ?? []).map((order) => (
                        <TableRow key={order.id}>
                          <TableCell className="px-4">
                            <button
                              type="button"
                              onClick={() => navigate(`/purchase-orders/${encodeURIComponent(order.poNo)}`)}
                              className="font-mono text-blue-700 hover:underline">
                              {order.poNo}
                            </button>
                          </TableCell>
                          <TableCell><AutoTranslatedText text={order.supplier || '-'} /></TableCell>
                          <TableCell className="text-slate-600">{order.orderDate}</TableCell>
                          <TableCell className="text-right tabular-nums">{quantity(order.orderedQty)}</TableCell>
                          <TableCell className="text-right tabular-nums">{quantity(order.receivedQty)}</TableCell>
                          <TableCell className="text-right">
                            <Badge variant="secondary" className={`rounded-full border ${statusClass(
                              order.status === '已完成' ? '正常' : order.status === '部分到货' ? '偏低' : '缺货',
                            )}`}>
                              {t(order.status)}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                      {(detail.relatedPurchaseOrders?.length ?? 0) === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="h-24 text-center text-sm text-slate-400">
                            {t('暂无关联采购订单')}
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </TableBody>
                  </Table>
                </section>

                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                  <span>{t('分类')}：<AutoTranslatedText text={detail.item.category} /> · {t('规格')}：<AutoTranslatedText text={detail.item.spec || '-'} /></span>
                  <span>{t('最后同步')}：{detail.item.syncedAt ? new Date(detail.item.syncedAt).toLocaleString(i18nLocale()) : '-'}</span>
                </div>
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
