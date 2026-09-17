import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { cn } from '../../components/ui/utils';
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
  type PurchaseOrderStatus,
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
import {
  OrderEmptyState,
  OrderMetric,
  OrderMetricGrid,
  OrderPageHeader,
} from '../components/HorizonPage';
// 页面路径以「页面路由管理」的配置为准，随主路径变更自动跟随
import { routePath } from "../../lib/routePaths";

const EMPTY_SUMMARY = { totalSku: 0, normal: 0, low: 0, shortage: 0 };
const LOADING_ROW_KEYS = ['inventory-loading-1', 'inventory-loading-2', 'inventory-loading-3', 'inventory-loading-4'];
const DETAIL_LOADING_KEYS = [...LOADING_ROW_KEYS, 'inventory-detail-loading-5'];

type InventoryQuery = {
  q: string;
  category: string;
  status: string;
  page: number;
  pageSize: number;
};

function statusClass(status: InventoryItem['status']) {
  if (status === '缺货') return 'border-rose-100 bg-rose-50 text-rose-700';
  if (status === '偏低') return 'border-amber-100 bg-amber-50 text-amber-700';
  return 'border-emerald-100 bg-emerald-50 text-emerald-700';
}

function purchaseOrderStatusClass(status: PurchaseOrderStatus) {
  switch (status) {
    case '待确认':
      return 'border-slate-200 bg-slate-50 text-slate-600';
    case '已下单':
      return 'border-[#cbd8f6] bg-accent text-primary';
    case '部分到货':
      return 'border-amber-100 bg-amber-50 text-amber-700';
    case '已完成':
      return 'border-emerald-100 bg-emerald-50 text-emerald-700';
    case '异常':
      return 'border-rose-100 bg-rose-50 text-rose-700';
  }
}

function quantity(value: number | undefined) {
  return new Intl.NumberFormat(i18nLocale(), { maximumFractionDigits: 3 }).format(value ?? 0);
}

export function Inventory() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const canSync = usePermission('proc:sync-erp');
  const canViewPurchaseOrderDetail = usePermission('page:purchase-order-detail');
  const [data, setData] = useState<InventoryResponse | null>(null);
  const [query, setQuery] = useState('');
  const [queryDraft, setQueryDraft] = useState('');
  const [category, setCategory] = useState('all');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState('');
  const [syncError, setSyncError] = useState('');
  const [integration, setIntegration] = useState<{ configured: boolean; authorized: boolean } | null>(null);
  const [integrationLoading, setIntegrationLoading] = useState(true);
  const [integrationError, setIntegrationError] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<InventoryDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  const mountedRef = useRef(false);
  const listRequestRef = useRef(0);
  const integrationRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const detailIdRef = useRef<string | null>(null);
  const syncingRef = useRef(false);
  const syncOperationRef = useRef(0);
  const exportingRef = useRef(false);
  const exportOperationRef = useRef(0);

  const requestParams = useMemo<InventoryQuery>(() => ({
    q: query,
    category,
    status,
    page,
    pageSize,
  }), [category, page, pageSize, query, status]);
  const requestParamsRef = useRef(requestParams);
  requestParamsRef.current = requestParams;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      listRequestRef.current += 1;
      integrationRequestRef.current += 1;
      detailRequestRef.current += 1;
      detailIdRef.current = null;
    };
  }, []);

  const loadInventory = useCallback(async (params: InventoryQuery = requestParamsRef.current) => {
    const requestId = ++listRequestRef.current;
    setLoading(true);
    setListError('');
    try {
      const response = await orderProcessingApi.getInventory({
        q: params.q,
        category: params.category,
        status: params.status,
        page: params.page,
        pageSize: params.pageSize,
      });
      if (!mountedRef.current || requestId !== listRequestRef.current) return true;
      setData(response);
      setPage(response.inventory.page);
      return true;
    } catch (error) {
      if (!mountedRef.current || requestId !== listRequestRef.current) return true;
      setListError(error instanceof Error ? error.message : t('库存加载失败'));
      return false;
    } finally {
      if (mountedRef.current && requestId === listRequestRef.current) setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadInventory(requestParams);
  }, [loadInventory, requestParams]);

  const loadIntegration = useCallback(async () => {
    const requestId = ++integrationRequestRef.current;
    setIntegrationLoading(true);
    setIntegrationError('');
    try {
      const result = await getTplusStatus();
      if (!mountedRef.current || requestId !== integrationRequestRef.current) return true;
      setIntegration(result);
      return true;
    } catch (error) {
      if (!mountedRef.current || requestId !== integrationRequestRef.current) return true;
      setIntegration(null);
      setIntegrationError(error instanceof Error ? error.message : t('畅捷通连接状态加载失败'));
      return false;
    } finally {
      if (mountedRef.current && requestId === integrationRequestRef.current) setIntegrationLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadIntegration();
  }, [loadIntegration]);

  const handleSync = async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    const operationId = ++syncOperationRef.current;
    setSyncing(true);
    setSyncError('');
    setSyncProgress(t('正在启动畅捷通同步…'));
    try {
      const { jobId } = await syncTplusOperations();
      await waitApplyJob(jobId, (message) => {
        if (mountedRef.current && syncingRef.current && operationId === syncOperationRef.current) setSyncProgress(message);
      }, getTplusSyncJob);
      if (!mountedRef.current || operationId !== syncOperationRef.current) return;
      const [inventoryLoaded, integrationLoaded] = await Promise.all([
        loadInventory(),
        loadIntegration(),
      ]);
      if (!inventoryLoaded || !integrationLoaded) {
        throw new Error(t('同步已完成，但页面数据刷新失败，请重试'));
      }
      if (!mountedRef.current || operationId !== syncOperationRef.current) return;
      toast.success(t('畅捷通库存和采购订单已同步'));
    } catch (error) {
      if (!mountedRef.current || operationId !== syncOperationRef.current) return;
      const message = error instanceof Error ? error.message : t('畅捷通同步失败');
      setSyncError(message);
      toast.error(message);
    } finally {
      if (operationId === syncOperationRef.current) {
        syncingRef.current = false;
        if (mountedRef.current) {
          setSyncing(false);
          setSyncProgress('');
        }
      }
    }
  };

  const handleExport = async () => {
    if (exportingRef.current) return;
    exportingRef.current = true;
    const operationId = ++exportOperationRef.current;
    setExporting(true);
    setExportError('');
    try {
      const params = requestParamsRef.current;
      await orderProcessingApi.exportInventory({ q: params.q, category: params.category, status: params.status });
      if (!mountedRef.current || operationId !== exportOperationRef.current) return;
      toast.success(t('库存数据已导出'));
    } catch (error) {
      if (!mountedRef.current || operationId !== exportOperationRef.current) return;
      const message = error instanceof Error ? error.message : t('库存导出失败');
      setExportError(message);
      toast.error(message);
    } finally {
      if (operationId === exportOperationRef.current) {
        exportingRef.current = false;
        if (mountedRef.current) setExporting(false);
      }
    }
  };

  const loadDetail = useCallback(async (itemId: string) => {
    const requestId = ++detailRequestRef.current;
    setDetailError('');
    setDetailLoading(true);
    try {
      const response = await orderProcessingApi.getInventoryDetail(itemId);
      if (
        !mountedRef.current
        || requestId !== detailRequestRef.current
        || detailIdRef.current !== itemId
      ) return;
      setDetail(response);
    } catch (error) {
      if (
        !mountedRef.current
        || requestId !== detailRequestRef.current
        || detailIdRef.current !== itemId
      ) return;
      setDetailError(error instanceof Error ? error.message : t('库存详情加载失败'));
    } finally {
      if (
        mountedRef.current
        && requestId === detailRequestRef.current
        && detailIdRef.current === itemId
      ) setDetailLoading(false);
    }
  }, [t]);

  const openDetail = (itemId: string) => {
    detailIdRef.current = itemId;
    setDetailId(itemId);
    setDetail(null);
    void loadDetail(itemId);
  };

  const closeDetail = () => {
    detailRequestRef.current += 1;
    detailIdRef.current = null;
    setDetailId(null);
    setDetail(null);
    setDetailError('');
    setDetailLoading(false);
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

  const updateCategory = (value: string) => {
    setCategory(value);
    setPage(1);
  };

  const updateStatus = (value: string) => {
    setStatus(value);
    setPage(1);
  };

  const resetFilters = () => {
    setQuery('');
    setQueryDraft('');
    setCategory('all');
    setStatus('all');
    setPage(1);
  };

  const submitSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextQuery = queryDraft.trim();
    if (nextQuery === query && page === 1) {
      void loadInventory({ ...requestParamsRef.current, q: nextQuery, page: 1 });
      return;
    }
    setQuery(nextQuery);
    setPage(1);
  };

  const activeFilterCount = Number(Boolean(query)) + Number(category !== 'all') + Number(status !== 'all');
  const hasActiveFilters = activeFilterCount > 0;
  const integrationLabel = integrationLoading
    ? t('正在检查 T+ 状态')
    : integration?.authorized
      ? t('T+ 已授权')
      : integrationError
        ? t('T+ 状态未知')
        : t('T+ 未授权');

  return (
    <div className="order-horizon flex h-full min-h-0 flex-1 flex-col overflow-auto px-3 py-3 sm:px-5 sm:py-4">
      <OrderPageHeader
        Icon={Warehouse}
        eyebrow={t('订单与库存')}
        title={t('库存管理')}
        description={t('聚合多仓现存量、可用量与在途量，优先识别缺货和低库存风险。')}
        meta={(
          <>
            <span>{t('数据来源：畅捷通 T+（只读）')}</span>
            <span>· {t('最后同步')}：{lastSync}</span>
            {syncProgress ? <span role="status" aria-live="polite" className="text-blue-700">· {syncProgress}</span> : null}
          </>
        )}
        actions={(
          <>
          <Badge
            variant="secondary"
            role="status"
            aria-live="polite"
            className={cn(
              'rounded-full border',
              integration?.authorized
                ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
                : integrationError
                  ? 'border-rose-100 bg-rose-50 text-rose-700'
                  : 'border-amber-100 bg-amber-50 text-amber-700',
            )}>
            {integrationLoading ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : null}
            {integrationLabel}
          </Badge>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={exporting}
            aria-busy={exporting}
            aria-describedby={exportError ? 'inventory-export-error' : undefined}
            onClick={() => void handleExport()}
            className="order-horizon-secondary-action h-10 border-slate-200 px-3 text-slate-600">
            {exporting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Download className="size-4" aria-hidden="true" />}
            {exporting ? t('正在导出') : t('导出')}
          </Button>
          {canSync ? (
            <Button
              type="button"
              size="sm"
              disabled={syncing || integrationLoading || !integration?.configured || !integration?.authorized}
              aria-busy={syncing}
              aria-describedby={syncError ? 'inventory-sync-error' : undefined}
              onClick={() => void handleSync()}
              className="order-horizon-primary-action h-10 px-3 text-white">
              <RefreshCw className={cn('size-4', syncing && 'animate-spin')} aria-hidden="true" />
              {syncing ? t('同步中') : t('同步畅捷通')}
            </Button>
          ) : null}
          </>
        )}
      />

      {integrationError || exportError || syncError ? (
        <div className="mb-3 grid shrink-0 gap-2" aria-live="polite">
          {integrationError ? (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              <span className="flex min-w-0 items-center gap-2 text-pretty">
                <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
                {integrationError}
              </span>
              <Button type="button" variant="outline" size="sm" disabled={integrationLoading} onClick={() => void loadIntegration()} className="h-8 border-rose-200 bg-white text-rose-700 hover:bg-rose-100">
                {t('重试连接检查')}
              </Button>
            </div>
          ) : null}
          {exportError ? (
            <div id="inventory-export-error" role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              <span className="flex min-w-0 items-center gap-2 text-pretty">
                <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
                {exportError}
              </span>
              <Button type="button" variant="outline" size="sm" disabled={exporting} onClick={() => void handleExport()} className="h-8 border-rose-200 bg-white text-rose-700 hover:bg-rose-100">
                {t('重新导出')}
              </Button>
            </div>
          ) : null}
          {syncError ? (
            <div id="inventory-sync-error" role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              <span className="flex min-w-0 items-center gap-2 text-pretty">
                <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
                {syncError}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={syncing || integrationLoading || !integration?.configured || !integration?.authorized}
                onClick={() => void handleSync()}
                className="h-8 border-rose-200 bg-white text-rose-700 hover:bg-rose-100">
                {t('重新同步')}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <OrderMetricGrid>
        <OrderMetric Icon={Layers3} label={t('总 SKU 数量')} value={summary.totalSku} tone="primary" />
        <OrderMetric Icon={CheckCircle2} label={t('库存正常')} value={summary.normal} tone="success" />
        <OrderMetric Icon={ShieldCheck} label={t('库存偏低')} value={summary.low} tone="warning" />
        <OrderMetric Icon={AlertCircle} label={t('缺货状态')} value={summary.shortage} tone="danger" />
        <OrderMetric Icon={Warehouse} label={t('当前仓库')} value={warehouseCount} note={t('当前页涉及仓库')} tone="primary" />
      </OrderMetricGrid>

      <div className="order-horizon-data-surface flex min-h-[28rem] flex-1 flex-col overflow-hidden border bg-white sm:min-h-[32rem]" aria-busy={loading}>
        <div className="order-horizon-toolbar shrink-0 border-b border-slate-100 px-3 py-3 sm:px-4">
          <form role="search" aria-label={t('库存筛选')} onSubmit={submitSearch} className="flex w-full flex-wrap items-center gap-2">
            <div className="flex w-full min-w-0 flex-1 items-center gap-2 sm:min-w-[320px]">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  name="inventory-query"
                  value={queryDraft}
                  onChange={(event) => setQueryDraft(event.target.value)}
                  aria-label={t('搜索库存')}
                  aria-controls="inventory-table"
                  placeholder={t('搜索存货编码、名称或规格')}
                  className="h-9 border-slate-200 bg-white pl-9 text-sm"
                />
              </div>
              <Button type="submit" variant="outline" size="sm" className="order-horizon-secondary-action h-9 border-slate-200 px-3 text-slate-700">
                <Search className="size-4" aria-hidden="true" />
                {t('搜索')}
              </Button>
            </div>
            <Select value={category} onValueChange={updateCategory}>
              <SelectTrigger aria-label={t('按库存分类筛选')} aria-controls="inventory-table" className="h-9 w-full rounded-full border-slate-200 bg-white text-sm sm:w-[170px]">
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
              <SelectTrigger aria-label={t('按库存状态筛选')} aria-controls="inventory-table" className="h-9 w-full rounded-full border-slate-200 bg-white text-sm sm:w-[140px]">
                <SelectValue placeholder={t('状态')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('所有状态')}</SelectItem>
                <SelectItem value="正常">{t('库存正常')}</SelectItem>
                <SelectItem value="偏低">{t('库存偏低')}</SelectItem>
                <SelectItem value="缺货">{t('缺货')}</SelectItem>
              </SelectContent>
            </Select>
            {hasActiveFilters ? (
              <Button type="button" variant="ghost" size="sm" onClick={resetFilters} className="order-horizon-secondary-action h-9 text-slate-600">
                {t('清除筛选')}
              </Button>
            ) : null}
          </form>
          <div id="inventory-filter-summary" role="status" aria-live="polite" className="mt-2 flex min-h-4 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            <span>
              {loading
                ? t('正在更新库存列表')
                : listError && rows.length > 0
                  ? t('库存更新失败，当前显示上次数据')
                : hasActiveFilters
                  ? `${t('已启用筛选')}：${activeFilterCount}`
                  : t('当前显示全部库存')}
            </span>
            {queryDraft.trim() !== query ? <span>{t('按“搜索”应用新的关键词')}</span> : null}
          </div>
        </div>

        {listError && rows.length > 0 ? (
          <div role="alert" className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 sm:px-4">
            <span className="flex min-w-0 items-center gap-2 text-pretty">
              <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
              <span>{t('库存更新失败，当前显示上次成功加载的数据。')} {listError}</span>
            </span>
            <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void loadInventory()} className="h-8 border-rose-200 bg-white text-rose-700 hover:bg-rose-100">
              {t('重新加载')}
            </Button>
          </div>
        ) : null}

        <div className="relative min-h-0 flex-1">
          {loading ? <span className="sr-only" role="status">{t('正在加载畅捷通库存')}</span> : null}
          <Table id="inventory-table" containerClassName="order-horizon-table absolute inset-0 h-full overflow-auto" className="min-w-[1040px]">
            <TableHeader className="sticky top-0 z-10 bg-slate-50">
              <TableRow className="border-slate-100">
                <TableHead className="px-4">{t('存货编码')}</TableHead>
                <TableHead>{t('存货名称 / 规格')}</TableHead>
                <TableHead className="text-right">{t('现存量')}</TableHead>
                <TableHead className="text-right">{t('可用量')}</TableHead>
                <TableHead className="text-right">{t('状态')}</TableHead>
                <TableHead className="text-right">{t('在途量')}</TableHead>
                <TableHead className="text-right">{t('安全库存')}</TableHead>
                <TableHead>{t('分类')}</TableHead>
                <TableHead>{t('仓库')}</TableHead>
                <TableHead className="order-horizon-sticky-action sticky right-0 bg-slate-50 text-right">{t('操作')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((item) => {
                const warehouseNames = item.warehouses?.map((warehouse) => warehouse.name) ?? [];
                const itemLabel = item.name?.trim() || `${t('未命名存货')}（${item.id}）`;
                return (
                  <TableRow key={item.id} className="border-slate-100">
                    <TableCell className="px-4 font-mono text-sm text-slate-800">{item.id}</TableCell>
                    <TableCell>
                      <div className="max-w-[260px] truncate font-medium text-slate-900"><AutoTranslatedText text={itemLabel} /></div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        <AutoTranslatedText text={item.spec || '-'} /> {item.unit ? `· ${t(item.unit)}` : ''}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-semibold text-slate-900 tabular-nums">{quantity(item.stock)}</TableCell>
                    <TableCell className="text-right text-slate-700 tabular-nums">{quantity(item.available)}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant="secondary" className={cn('rounded-full border px-2.5 py-1 font-medium', statusClass(item.status))}>
                        {t(item.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="inline-flex items-center justify-end gap-1 text-primary tabular-nums">
                        {item.in > 0 ? <Truck className="size-3.5" aria-hidden="true" /> : null}
                        {quantity(item.in)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-slate-700 tabular-nums">{quantity(item.safe)}</TableCell>
                    <TableCell className="text-slate-600"><AutoTranslatedText text={item.category} /></TableCell>
                    <TableCell className="max-w-[220px] text-slate-600" title={warehouseNames.join('、')}>
                      <div className="truncate">{warehouseNames.length ? warehouseNames.join('、') : '-'}</div>
                      {warehouseNames.length > 1 ? <div className="text-[11px] text-muted-foreground">{warehouseNames.length} {t('个仓库')}</div> : null}
                    </TableCell>
                    <TableCell className="order-horizon-sticky-action sticky right-0 bg-white text-right">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-haspopup="dialog"
                        aria-label={`${t('查看库存详情')}：${itemLabel}`}
                        onClick={() => openDetail(item.id)}
                        className="order-horizon-row-action h-8 px-3 text-xs">
                        <Eye className="size-3.5" aria-hidden="true" />
                        {t('详情')}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!loading && listError && rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="h-48 text-center">
                    <div role="alert">
                      <OrderEmptyState
                        Icon={AlertCircle}
                        title={t('库存加载失败')}
                        description={listError}
                        action={(
                          <Button type="button" variant="outline" size="sm" onClick={() => void loadInventory()} className="order-horizon-secondary-action">
                            <RefreshCw className="size-4" aria-hidden="true" />
                            {t('重新加载')}
                          </Button>
                        )}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ) : null}
              {!loading && !listError && rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="h-48 text-center">
                    <OrderEmptyState
                      Icon={PackageOpen}
                      title={hasActiveFilters
                        ? t('暂无匹配库存')
                        : integration?.authorized
                          ? t('暂无库存数据')
                          : t('尚未连接畅捷通 T+')}
                      description={hasActiveFilters
                        ? t('调整筛选条件，或清除筛选后查看全部库存。')
                        : integration?.authorized
                          ? t('可重新加载列表，或同步畅捷通获取最新库存。')
                          : t('完成配置和授权后即可同步多仓库存数据。')}
                      action={hasActiveFilters ? (
                        <Button type="button" variant="outline" size="sm" onClick={resetFilters} className="order-horizon-secondary-action">
                          {t('清除筛选')}
                        </Button>
                      ) : integration?.authorized ? (
                        <Button type="button" variant="outline" size="sm" onClick={() => void loadInventory()} className="order-horizon-secondary-action">
                          <RefreshCw className="size-4" aria-hidden="true" />
                          {t('重新加载')}
                        </Button>
                      ) : null}
                    />
                  </TableCell>
                </TableRow>
              ) : null}
              {loading && rows.length === 0 ? (
                LOADING_ROW_KEYS.map((key) => (
                  <TableRow key={key} aria-hidden="true" className="border-slate-100">
                    <TableCell className="px-4"><span className="block h-3 w-24 rounded-full bg-slate-100" /></TableCell>
                    <TableCell><span className="block h-3 w-44 rounded-full bg-slate-100" /></TableCell>
                    <TableCell><span className="ml-auto block h-3 w-14 rounded-full bg-slate-100" /></TableCell>
                    <TableCell><span className="ml-auto block h-3 w-14 rounded-full bg-slate-100" /></TableCell>
                    <TableCell><span className="ml-auto block h-6 w-14 rounded-full bg-slate-100" /></TableCell>
                    <TableCell><span className="ml-auto block h-3 w-12 rounded-full bg-slate-100" /></TableCell>
                    <TableCell><span className="ml-auto block h-3 w-12 rounded-full bg-slate-100" /></TableCell>
                    <TableCell><span className="block h-3 w-20 rounded-full bg-slate-100" /></TableCell>
                    <TableCell><span className="block h-3 w-28 rounded-full bg-slate-100" /></TableCell>
                    <TableCell><span className="ml-auto block h-8 w-16 rounded-full bg-slate-100" /></TableCell>
                  </TableRow>
                ))
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
        if (!open) closeDetail();
      }}>
        <DialogContent className="order-horizon-overlay max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-5xl"
          aria-busy={detailLoading}>
          <DialogHeader className="border-b border-slate-100 px-4 py-4 pr-12 sm:px-6 sm:py-5 sm:pr-14">
            <DialogTitle className="text-balance">
              {detail?.item.name?.trim() || t('库存详情')}
            </DialogTitle>
            <DialogDescription className="text-pretty">
              {detail?.item.id || detailId} · {t('畅捷通 T+ 多仓库存只读明细')}
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 overflow-y-auto p-4 sm:p-6">
            {detailLoading ? (
              <div className="space-y-5">
                <span className="sr-only" role="status">{t('正在加载库存详情')}</span>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-5" aria-hidden="true">
                  {DETAIL_LOADING_KEYS.map((key) => (
                    <div key={key} className="h-20 rounded-xl border border-slate-100 bg-slate-50 p-3">
                      <span className="block h-3 w-16 rounded-full bg-slate-200" />
                      <span className="mt-3 block h-5 w-20 rounded-full bg-slate-200" />
                    </div>
                  ))}
                </div>
                <div className="h-44 rounded-2xl border border-slate-100 bg-slate-50" aria-hidden="true" />
              </div>
            ) : detailError ? (
              <div role="alert" className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-center text-sm text-rose-700">
                <AlertCircle className="size-6" aria-hidden="true" />
                <p className="max-w-lg text-pretty">{detailError}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={detailLoading || !detailId}
                  onClick={() => {
                    const currentId = detailIdRef.current;
                    if (currentId) void loadDetail(currentId);
                  }}
                  className="border-rose-200 bg-white text-rose-700 hover:bg-rose-100">
                  <RefreshCw className="size-4" aria-hidden="true" />
                  {t('重新加载详情')}
                </Button>
              </div>
            ) : detail ? (
              <div className="space-y-5">
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
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

                <section className="overflow-hidden rounded-2xl border border-slate-100">
                  <div className="border-b border-slate-100 px-4 py-3">
                    <h3 className="text-sm font-semibold text-slate-900 text-balance">{t('分仓库存')}</h3>
                  </div>
                  <Table className="min-w-[520px]">
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
                      {(detail.item.warehouses?.length ?? 0) === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} className="h-24 text-center text-sm text-muted-foreground">
                            {t('暂无分仓库存')}
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </TableBody>
                  </Table>
                </section>

                <section className="overflow-hidden rounded-2xl border border-slate-100">
                  <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                    <h3 className="text-sm font-semibold text-slate-900 text-balance">{t('近期采购订单')}</h3>
                    <span className="text-xs text-muted-foreground">{detail.relatedPurchaseOrders?.length ?? 0} {t('条')}</span>
                  </div>
                  <Table className="min-w-[760px]">
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
                            {canViewPurchaseOrderDetail ? (
                              <Button variant="unstyled"
                                type="button"
                                aria-label={`${t('查看采购订单')}：${order.poNo}`}
                                onClick={() => {
                                  closeDetail();
                                  navigate(`${routePath("page:purchase-orders", "/purchase-orders")}/${encodeURIComponent(order.id)}`);
                                }}
                                className="rounded-sm font-mono text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
                                {order.poNo}
                              </Button>
                            ) : (
                              <span className="font-mono text-slate-700">{order.poNo}</span>
                            )}
                          </TableCell>
                          <TableCell><AutoTranslatedText text={order.supplier || '-'} /></TableCell>
                          <TableCell className="text-slate-600">{order.orderDate}</TableCell>
                          <TableCell className="text-right tabular-nums">{quantity(order.orderedQty)}</TableCell>
                          <TableCell className="text-right tabular-nums">{quantity(order.receivedQty)}</TableCell>
                          <TableCell className="text-right">
                            <Badge variant="secondary" className={cn('rounded-full border', purchaseOrderStatusClass(order.status))}>
                              {t(order.status)}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                      {(detail.relatedPurchaseOrders?.length ?? 0) === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="h-24 text-center text-sm text-muted-foreground">
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
