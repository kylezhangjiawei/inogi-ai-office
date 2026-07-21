import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import {
  ChevronLeft,
  ChevronRight,
  Layers,
  Download,
  CheckCircle,
  AlertTriangle,
  AlertCircle,
  Search,
  Clock,
  Plus,
  X,
  Calendar,
  Package,
  User,
  FileText,
  Truck,
  Sparkles,
  Upload,
  ImageIcon,
  RotateCw,
  Loader2,
  ScanLine,
  Edit3,
  BarChart3,
  TrendingUp,
  MapPin,
  Tag,
  History,
  ShoppingCart,
  ArrowRight } from
'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '../../components/ui/table';
import { AutoTranslatedText } from '../../components/TranslatableText';
import {
  orderProcessingApi,
  type InventoryDetailResponse,
  type InventoryItem,
  type InventoryResponse
} from '../../lib/orderProcessingApi';
import { useI18n } from '../../lib/i18n';
const TIME_FILTERS = [
{
  id: 'all',
  label: '全部'
},
{
  id: 'today',
  label: '今天'
},
{
  id: 'week',
  label: '本周'
},
{
  id: 'month',
  label: '本月'
},
{
  id: 'custom',
  label: '自定义'
}];

const STOCK_IN_TYPES = [
{
  id: 'purchase',
  label: '采购入库'
},
{
  id: 'return',
  label: '退货入库'
},
{
  id: 'transfer',
  label: '调拨入库'
},
{
  id: 'other',
  label: '其他'
}];

function formatDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function Inventory() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const stockInFileInputRef = useRef<HTMLInputElement | null>(null);
  const [inventoryData, setInventoryData] = useState<InventoryResponse | null>(null);
  const [detailData, setDetailData] = useState<InventoryDetailResponse | null>(null);
  const [inventorySearch, setInventorySearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [inventoryPage, setInventoryPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [timeFilter, setTimeFilter] = useState('all');
  const [customStartDate, setCustomStartDate] = useState(formatDateInput(addDays(new Date(), -30)));
  const [customEndDate, setCustomEndDate] = useState(formatDateInput(new Date()));
  const [showStockIn, setShowStockIn] = useState(false);
  const [stockInType, setStockInType] = useState('purchase');
  const [stockInDocumentNo, setStockInDocumentNo] = useState('');
  const [stockInDate, setStockInDate] = useState(formatDateInput(new Date()));
  const [warehouse, setWarehouse] = useState('主仓 - 上海');
  const [stockInRemark, setStockInRemark] = useState('');
  const [skuOptions, setSkuOptions] = useState<InventoryItem[]>([]);
  const [stockInItems, setStockInItems] = useState<
    Array<{
      id: string;
      qty: number;
    }>>(
    [
    {
      id: '',
      qty: 0
    }]
  );
  const detailItem = detailData?.item ?? null;
  const inventoryItems = inventoryData?.inventory.items ?? [];
  const inventoryMeta = inventoryData?.inventory;
  const inventorySummary = inventoryData?.summary ?? { totalSku: 0, normal: 0, low: 0, shortage: 0 };
  const categories = inventoryData?.categories ?? [];
  const recentMovements = inventoryData?.recentMovements ?? [];

  const loadInventory = useCallback(async () => {
    setLoading(true);
    try {
      const data = await orderProcessingApi.getInventory({
        q: inventorySearch,
        category: categoryFilter,
        status: statusFilter,
        timeFilter,
        startDate: timeFilter === 'custom' ? customStartDate : undefined,
        endDate: timeFilter === 'custom' ? customEndDate : undefined,
        page: inventoryPage,
        pageSize: 12
      });
      setInventoryData(data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('库存数据加载失败'));
    } finally {
      setLoading(false);
    }
  }, [categoryFilter, customEndDate, customStartDate, inventoryPage, inventorySearch, statusFilter, t, timeFilter]);

  useEffect(() => {
    void loadInventory();
  }, [loadInventory]);

  const openDetail = async (itemId: string) => {
    try {
      const data = await orderProcessingApi.getInventoryDetail(itemId);
      setDetailData(data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('商品详情加载失败'));
    }
  };

  const loadSkuOptions = useCallback(async () => {
    try {
      const data = await orderProcessingApi.getInventory({ page: 1, pageSize: 10000 });
      setSkuOptions(data.inventory.items);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('商品选项加载失败'));
    }
  }, [t]);

  const openStockInModal = (item?: InventoryItem | null) => {
    if (item?.id) setStockInItems([{ id: item.id, qty: 1 }]);
    setShowStockIn(true);
    void loadSkuOptions();
  };

  const addStockInRow = () => {
    setStockInItems([
    ...stockInItems,
    {
      id: '',
      qty: 0
    }]
    );
  };
  const removeStockInRow = (idx: number) => {
    setStockInItems(stockInItems.filter((_, i) => i !== idx));
  };
  const updateStockInRow = (
  idx: number,
  field: 'id' | 'qty',
  value: string | number) =>
  {
    const next = [...stockInItems];
    (next[idx] as any)[field] = value;
    setStockInItems(next);
  };
  // --- AI Recognition State ---
  type AIPhase = 'idle' | 'uploading' | 'analyzing' | 'reviewed';
  const [aiPhase, setAiPhase] = useState<AIPhase>('idle');
  const [aiFiles, setAiFiles] = useState<
    Array<{
      name: string;
      size: string;
    }>>(
    []);
  const [aiFields, setAiFields] = useState<Set<string>>(new Set());
  const [supplier, setSupplier] = useState('深圳市恒丰电子有限公司');
  const [poNumber, setPoNumber] = useState('');
  const [handler, setHandler] = useState('李华');
  const resetAi = () => {
    setAiPhase('idle');
    setAiFiles([]);
    setAiFields(new Set());
  };
  const simulateUpload = async (files: File[] = []) => {
    setAiPhase('uploading');
    try {
      const result = await orderProcessingApi.recognizeStockIn(files);
      setAiFiles(result.files);
      await new Promise((resolve) => window.setTimeout(resolve, 600));
      setAiPhase('analyzing');
      await new Promise((resolve) => window.setTimeout(resolve, 900));
      setStockInType(result.stockIn.type);
      setSupplier(result.stockIn.supplier);
      setPoNumber(result.stockIn.poNumber);
      setHandler(result.stockIn.handler);
      setStockInDocumentNo(result.stockIn.documentNo);
      setStockInDate(result.stockIn.businessDate || formatDateInput(new Date()));
      setWarehouse(result.stockIn.warehouse || '主仓 - 上海');
      setStockInRemark(result.stockIn.remark || '');
      setStockInItems(result.stockIn.items);
      setAiFields(new Set(result.fields));
      setAiPhase('reviewed');
      toast.success(result.message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('AI 识别失败'));
      resetAi();
    }
  };
  const submitStockIn = async () => {
    try {
      const result = await orderProcessingApi.createStockIn({
        type: stockInType,
        supplier,
        poNumber,
        handler,
        documentNo: stockInDocumentNo,
        businessDate: stockInDate,
        warehouse,
        remark: stockInRemark,
        items: stockInItems,
      });
      toast.success(result.message);
      setShowStockIn(false);
      resetAi();
      await loadInventory();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('入库失败'));
    }
  };
  const exportInventory = async () => {
    try {
      await orderProcessingApi.exportInventory({
        q: inventorySearch,
        category: categoryFilter,
        status: statusFilter,
        timeFilter,
        startDate: timeFilter === 'custom' ? customStartDate : undefined,
        endDate: timeFilter === 'custom' ? customEndDate : undefined
      });
      toast.success(t('库存已导出'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('导出失败'));
    }
  };
  const adjustCurrentInventory = async () => {
    if (!detailItem) return;
    const input = window.prompt(t('请输入调整后的库存数量'), String(detailItem.stock));
    if (input == null) return;
    const stock = Number(input);
    if (!Number.isFinite(stock) || stock < 0) {
      toast.error(t('请输入有效库存数量'));
      return;
    }
    try {
      const data = await orderProcessingApi.adjustInventory(detailItem.id, { stock, operator: handler });
      setDetailData(data);
      await loadInventory();
      toast.success(t('库存已调整'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('库存调整失败'));
    }
  };
  const stockOutCurrentItem = async () => {
    if (!detailItem) return;
    const input = window.prompt(t('请输入出库数量'), '1');
    if (input == null) return;
    const qty = Number(input);
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error(t('请输入有效出库数量'));
      return;
    }
    try {
      const data = await orderProcessingApi.createStockOut(detailItem.id, { qty, operator: handler, note: '手工出库' });
      setDetailData(data);
      await loadInventory();
      toast.success(t('出库已登记'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('出库失败'));
    }
  };
  const AiBadge = ({ fieldKey }: {fieldKey: string;}) => {
    if (!aiFields.has(fieldKey)) return null;
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-violet-50 text-violet-600 rounded text-[10px] font-medium border border-violet-100">
        <Sparkles className="w-2.5 h-2.5" /> AI
      </span>);

  };
  const todayLabel = formatDateInput(new Date());
  const timeRangeText =
    timeFilter === 'all' ? t('显示全部库存数据') :
    timeFilter === 'today' ? `${todayLabel} ${t('当日变动')}` :
    timeFilter === 'week' ? `${formatDateInput(addDays(new Date(), -6))} ~ ${todayLabel}` :
    timeFilter === 'month' ? `${todayLabel.slice(0, 8)}01 ~ ${todayLabel}` :
    timeFilter === 'custom' ? `${customStartDate} ~ ${customEndDate}` :
    '';
  return (
    <div className="flex h-full min-h-0 w-full flex-col  p-3">
      <input
        ref={stockInFileInputRef}
        type="file"
        multiple
        className="hidden"
        accept=".pdf,.png,.jpg,.jpeg"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          void simulateUpload(files);
        }} />
      {/* Main Container */}
      <div className="bg-gradient-mesh rounded-[20px] elevation-2 flex min-h-0 flex-col flex-1 overflow-hidden">
        {/* Stats Strip */}
        <div className="p-5 bg-slate-50/30 border-b border-slate-100 flex gap-5 shrink-0">
          <div className="flex-1 bg-white p-5 rounded-3xl elevation-1 flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center">
              <Layers className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-0.5">{t('总SKU数量')}</p>
              <p className="text-2xl font-bold text-slate-800">{inventorySummary.totalSku}</p>
            </div>
          </div>
          <div className="flex-1 bg-white p-5 rounded-3xl elevation-1 flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center">
              <CheckCircle className="w-6 h-6 text-emerald-600" />
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-0.5">{t('库存正常')}</p>
              <p className="text-2xl font-bold text-slate-800">{inventorySummary.normal}</p>
            </div>
          </div>
          <div className="flex-1 bg-white p-5 rounded-3xl elevation-1 flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-amber-50 flex items-center justify-center">
              <AlertTriangle className="w-6 h-6 text-amber-600" />
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-0.5">{t('库存偏低')}</p>
              <p className="text-2xl font-bold text-slate-800">{inventorySummary.low}</p>
            </div>
          </div>
          <div className="flex-1 bg-white p-5 rounded-3xl elevation-1 flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-rose-50 flex items-center justify-center">
              <AlertCircle className="w-6 h-6 text-rose-600" />
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-0.5">{t('缺货状态')}</p>
              <p className="text-2xl font-bold text-slate-800">{inventorySummary.shortage}</p>
            </div>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex min-h-0 flex-1 overflow-hidden p-5 gap-5 bg-slate-50/30">
          {/* LEFT: Inventory Table Card */}
          <div className="flex-1 bg-white rounded-3xl elevation-1 flex min-h-0 flex-col overflow-hidden min-w-0">
            <div className="p-5 flex items-center justify-between border-b border-slate-100 shrink-0 gap-3 flex-wrap">
              <div className="flex items-center gap-3 shrink-0">
                <button
                  onClick={() => navigate('/order-workbench')}
                  className="px-3 py-2 text-sm font-medium text-slate-600 bg-slate-100 rounded-full hover:bg-slate-200 transition-all flex items-center gap-1.5 whitespace-nowrap">
                  
                  <ChevronLeft className="w-4 h-4" /> {t('返回工作台')}
                </button>
                <h2 className="font-semibold text-slate-800">
                  {t('库存清单')}
                </h2>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <div className="relative w-56">
                  <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={inventorySearch}
                    onChange={(event) => {
                      setInventorySearch(event.target.value);
                      setInventoryPage(1);
                    }}
                    placeholder={t('搜索商品编码/名称')}
                    className="w-full pl-10 pr-4 py-2 bg-slate-100 border-none rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all" />
                  
                </div>
                <select
                  value={categoryFilter}
                  onChange={(event) => {
                    setCategoryFilter(event.target.value);
                    setInventoryPage(1);
                  }}
                  className="py-2 px-4 bg-slate-100 border-none rounded-full text-sm text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20 transition-all whitespace-nowrap">
                  <option value="all">{t('所有类目')}</option>
                  {categories.map((category) =>
                  <option key={category} value={category}>{t(category)}</option>
                  )}
                </select>
                <select
                  value={statusFilter}
                  onChange={(event) => {
                    setStatusFilter(event.target.value);
                    setInventoryPage(1);
                  }}
                  className="py-2 px-4 bg-slate-100 border-none rounded-full text-sm text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20 transition-all whitespace-nowrap">
                  <option value="all">{t('所有状态')}</option>
                  <option value="正常">{t('库存正常')}</option>
                  <option value="偏低">{t('库存偏低')}</option>
                  <option value="缺货">{t('缺货')}</option>
                </select>
                <button
                  onClick={exportInventory}
                  className="px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 rounded-full hover:bg-blue-100 transition-all flex items-center gap-1.5 whitespace-nowrap">
                  <Download className="w-4 h-4" /> {t('导出库存')}
                </button>
                <button
                  onClick={() => openStockInModal()}
                  className="px-5 py-2 text-sm font-medium text-white bg-gradient-primary rounded-full glow-blue transition-all flex items-center gap-1.5 whitespace-nowrap">
                  
                  <Plus className="w-4 h-4" /> {t('入库登记')}
                </button>
              </div>
            </div>

            {/* Time filter segmented control */}
            <div className="px-5 pt-4 pb-3 border-b border-slate-50 shrink-0 flex items-center gap-3">
              <span className="text-xs text-slate-500 flex items-center gap-1.5 shrink-0">
                <Calendar className="w-3.5 h-3.5" /> {t('时间范围')}
              </span>
              <div className="flex p-1 bg-slate-100/80 rounded-full">
                {TIME_FILTERS.map((tf) =>
                <button
                  key={tf.id}
                  onClick={() => {
                    setTimeFilter(tf.id);
                    setInventoryPage(1);
                  }}
                  className={`px-3 py-1 text-xs rounded-full font-medium transition-all ${timeFilter === tf.id ? 'bg-blue-100 text-blue-700' : 'text-slate-500 hover:text-slate-700'}`}>
                  
                    {t(tf.label)}
                  </button>
                )}
              </div>
              {timeFilter === 'custom' &&
              <div className="flex items-center gap-2 text-xs">
                  <input
                  type="date"
                  value={customStartDate}
                  onChange={(event) => {
                    setCustomStartDate(event.target.value);
                    setInventoryPage(1);
                  }}
                  className="px-3 py-1.5 bg-slate-100 border-none rounded-full text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all" />
                
                  <span className="text-slate-400">{t('至')}</span>
                  <input
                  type="date"
                  value={customEndDate}
                  onChange={(event) => {
                    setCustomEndDate(event.target.value);
                    setInventoryPage(1);
                  }}
                  className="px-3 py-1.5 bg-slate-100 border-none rounded-full text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all" />
                
                </div>
              }
              <div className="ml-auto text-xs text-slate-400">
                {timeRangeText}
              </div>
            </div>

            <Table containerClassName="min-h-0 flex-1 overflow-auto" className="w-full text-sm text-left whitespace-nowrap">
                <TableHeader className="text-xs text-slate-600 [&_th]:sticky [&_th]:top-0 [&_th]:z-30 [&_th]:bg-slate-50 [&_th]:shadow-[0_1px_0_rgba(148,163,184,0.25)]">
                  <TableRow>
                    <TableHead className="px-5 py-3.5 font-medium">{t('商品编码')}</TableHead>
                    <TableHead className="px-5 py-3.5 font-medium">{t('商品名称')}</TableHead>
                    <TableHead className="px-5 py-3.5 font-medium">{t('类目')}</TableHead>
                    <TableHead className="px-5 py-3.5 font-medium">{t('规格')}</TableHead>
                    <TableHead className="px-5 py-3.5 font-medium text-right">
                      {t('当前库存')}
                    </TableHead>
                    <TableHead className="px-5 py-3.5 font-medium text-right">
                      {t('安全库存')}
                    </TableHead>
                    <TableHead className="px-5 py-3.5 font-medium text-right">
                      {t('待入库')}
                    </TableHead>
                    <TableHead className="px-5 py-3.5 font-medium text-right">
                      {t('待出库')}
                    </TableHead>
                    <TableHead className="px-5 py-3.5 font-medium">{t('状态')}</TableHead>
                    <TableHead className="px-5 py-3.5 font-medium text-right">{t('操作')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-slate-50">
                  {inventoryItems.map((item) =>
                  <TableRow
                    key={item.id}
                    className="hover:bg-blue-50/30 transition-colors">
                    
                      <TableCell className="px-5 py-3.5 font-mono text-slate-600">
                        {item.id}
                      </TableCell>
                      <TableCell className="px-5 py-3.5 font-medium text-slate-800">
                        <button
                        onClick={() => void openDetail(item.id)}
                        className="text-left hover:text-blue-600 hover:underline transition-colors">
                        
                          <AutoTranslatedText text={item.name} />
                        </button>
                      </TableCell>
                      <TableCell className="px-5 py-3.5 text-slate-600">
                        <AutoTranslatedText text={item.category} />
                      </TableCell>
                      <TableCell className="px-5 py-3.5 text-slate-600">
                        <AutoTranslatedText text={item.spec} />
                      </TableCell>
                      <TableCell
                      className={`px-5 py-3.5 text-right font-medium ${item.status === '缺货' ? 'text-rose-600' : item.status === '偏低' ? 'text-amber-600' : 'text-slate-800'}`}>
                      
                        {item.stock}
                      </TableCell>
                      <TableCell className="px-5 py-3.5 text-right text-slate-500">
                        {item.safe}
                      </TableCell>
                      <TableCell className="px-5 py-3.5 text-right text-emerald-600">
                        {item.in > 0 ? `+${item.in}` : '-'}
                      </TableCell>
                      <TableCell className="px-5 py-3.5 text-right text-blue-600">
                        {item.out > 0 ? `-${item.out}` : '-'}
                      </TableCell>
                      <TableCell className="px-5 py-3.5">
                        <span
                        className={`inline-flex px-3 py-1 rounded-full text-xs font-medium
                          ${item.status === '正常' ? 'text-emerald-700 bg-emerald-50' : ''}
                          ${item.status === '偏低' ? 'text-amber-700 bg-amber-50' : ''}
                          ${item.status === '缺货' ? 'text-rose-700 bg-rose-50' : ''}
                        `}>
                        
                          {t(item.status)}
                        </span>
                      </TableCell>
                      <TableCell className="px-5 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                          onClick={() => void openDetail(item.id)}
                          className="text-slate-500 hover:text-slate-800 font-medium text-xs px-2 py-1 rounded-full hover:bg-slate-100 transition-colors">
                          
                            {t('详情')}
                          </button>
                          <button
                          onClick={() => openStockInModal(item)}
                          className="text-blue-700 bg-blue-50 px-3 py-1.5 rounded-full hover:bg-blue-100 font-medium text-xs transition-colors">
                          
                            {t('入库')}
                          </button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
            </Table>

            <div className="p-4 pr-52 border-t border-slate-50 bg-white flex items-center justify-between shrink-0">
              <div className="text-xs text-slate-500 px-2">
                {t('显示')} {inventoryItems.length > 0 ? ((inventoryMeta?.page ?? 1) - 1) * (inventoryMeta?.pageSize ?? 12) + 1 : 0}-
                {((inventoryMeta?.page ?? 1) - 1) * (inventoryMeta?.pageSize ?? 12) + inventoryItems.length} / {t('共')} {inventoryMeta?.total ?? 0} {t('条')}
              </div>
              <div className="flex items-center gap-1 text-xs">
                <button
                  onClick={() => setInventoryPage((page) => Math.max(1, page - 1))}
                  disabled={(inventoryMeta?.page ?? 1) <= 1}
                  className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-500 transition-colors disabled:opacity-30">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                {Array.from({ length: Math.min(3, inventoryMeta?.totalPages ?? 1) }, (_, idx) => idx + 1).map((page) =>
                <button
                  key={page}
                  onClick={() => setInventoryPage(page)}
                  className={`w-8 h-8 flex items-center justify-center rounded-full font-medium transition-colors ${page === (inventoryMeta?.page ?? 1) ? 'bg-blue-600 text-white shadow-sm' : 'hover:bg-slate-100 text-slate-600'}`}>
                  
                  {page}
                </button>
                )}
                {(inventoryMeta?.totalPages ?? 1) > 3 &&
                <span className="w-8 h-8 flex items-center justify-center text-slate-400">...</span>
                }
                {(inventoryMeta?.totalPages ?? 1) > 3 &&
                <button
                  onClick={() => setInventoryPage(inventoryMeta?.totalPages ?? 1)}
                  className="w-8 h-8 flex items-center justify-center hover:bg-slate-100 rounded-full text-slate-600 transition-colors">
                  
                  {inventoryMeta?.totalPages}
                </button>
                }
                <button
                  onClick={() => setInventoryPage((page) => Math.min(inventoryMeta?.totalPages ?? 1, page + 1))}
                  disabled={(inventoryMeta?.page ?? 1) >= (inventoryMeta?.totalPages ?? 1)}
                  className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-500 transition-colors disabled:opacity-30">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* RIGHT: Sidebar */}
          <div className="hidden w-[320px] 2xl:flex min-h-0 flex-col gap-5 shrink-0 overflow-y-auto pb-24">
            {/* Alerts Card */}
            <div className="bg-white rounded-3xl p-5 elevation-1">
              <h3 className="text-sm font-medium text-slate-800 mb-4 flex items-center gap-2">
                <AlertTriangle className="w-4.5 h-4.5 text-amber-500" />{' '}
                {t('库存预警')}
              </h3>
              <div className="space-y-2">
                {(inventoryData?.inventory.items ?? []).filter((i) => i.status !== '正常').
                slice(0, 4).
                map((item) =>
                <div
                  key={item.id}
                  className="p-3 rounded-2xl hover:bg-slate-50 transition-colors flex items-center justify-between group">
                  
                      <div>
                        <div className="text-sm font-medium text-slate-800 truncate max-w-[140px]">
                          <AutoTranslatedText text={item.name} />
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {t('库存')}{' '}
                          <span
                        className={
                        item.status === '缺货' ?
                        'text-rose-600 font-medium' :
                        'text-amber-600 font-medium'
                        }>
                        
                            {item.stock}
                          </span>{' '}
                          / {t('安全')} {item.safe}
                        </div>
                      </div>
                      <button
                    onClick={() => openStockInModal(item)}
                    className="px-3 py-1.5 bg-blue-50 text-blue-700 rounded-full text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity hover:bg-blue-100">
                    
                        {t('补货')}
                      </button>
                    </div>
                )}
              </div>
            </div>

            {/* Timeline Card */}
            <div className="bg-white rounded-3xl p-5 elevation-1 flex-1">
              <h3 className="text-sm font-medium text-slate-800 mb-5 flex items-center gap-2">
                <Clock className="w-4.5 h-4.5 text-blue-500" /> {t('最近变动')}
              </h3>
              <div className="relative pl-3 border-l-2 border-slate-100 space-y-6 ml-2">
                {recentMovements.map((move) =>
                <div key={move.id} className="relative">
                    <div
                    className={`absolute -left-[17px] top-1 w-2.5 h-2.5 rounded-full border-2 border-white ${move.type === 'in' ? 'bg-emerald-500' : 'bg-rose-500'}`}>
                  </div>
                    <div className="text-sm text-slate-800 font-medium">
                      <AutoTranslatedText text={move.note} />
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                      {move.time}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Stock-In Registration Modal */}
      {showStockIn &&
      <div
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onClick={() => {
          setShowStockIn(false);
          resetAi();
        }}>
        
          <div
          className="bg-white rounded-3xl elevation-3 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}>
          
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-white">
              <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
                <Plus className="w-5 h-5 text-blue-500" /> {t('入库登记')}
                {aiPhase === 'reviewed' &&
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-violet-50 text-violet-700 rounded-full text-xs font-medium border border-violet-100">
                    <Sparkles className="w-3 h-3" /> {t('AI 已识别 · 待人工审核')}
                  </span>
              }
              </h2>
              <button
              onClick={() => {
                setShowStockIn(false);
                resetAi();
              }}
              className="w-9 h-9 flex items-center justify-center text-slate-400 hover:bg-slate-100 rounded-full transition-colors">
              
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 bg-slate-50/30 space-y-5">
              {/* AI Recognition Section */}
              {aiPhase === 'idle' &&
            <div className="relative bg-gradient-to-br from-violet-50 via-blue-50 to-indigo-50 border border-violet-100 rounded-3xl p-5 overflow-hidden">
                  <div className="absolute -right-8 -top-8 w-32 h-32 bg-violet-200/30 rounded-full blur-3xl pointer-events-none"></div>
                  <div className="flex items-start gap-4 relative">
                    <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center shrink-0 shadow-md shadow-violet-500/20">
                      <Sparkles className="w-5 h-5 text-white" />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-sm font-semibold text-slate-800 mb-1">
                        {t('AI 智能识别')}
                      </h3>
                      <p className="text-xs text-slate-600 leading-relaxed mb-3">
                        {t('上传送货单、采购单、发票或包装清单等图片/PDF，AI 将自动识别并预填入库信息，结果可人工审核后提交。')}
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                      onClick={() => stockInFileInputRef.current?.click()}
                      className="px-4 py-2 bg-gradient-to-br from-violet-500 to-blue-600 text-white rounded-full text-sm font-medium shadow-sm hover:shadow-md transition-all flex items-center gap-1.5">
                      
                          <Upload className="w-4 h-4" /> {t('上传识别')}
                        </button>
                        <button
                      onClick={() => stockInFileInputRef.current?.click()}
                      className="px-4 py-2 bg-white text-slate-700 rounded-full text-sm font-medium border border-slate-200 hover:bg-slate-50 transition-all flex items-center gap-1.5">
                      
                          <ImageIcon className="w-4 h-4" /> {t('选择文件')}
                        </button>
                        <span className="text-xs text-slate-400 ml-1">
                          {t('支持 JPG · PNG · PDF')}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
            }

              {(aiPhase === 'uploading' || aiPhase === 'analyzing') &&
            <div className="bg-white border border-violet-100 rounded-3xl p-5 elevation-1">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center shrink-0 shadow-md shadow-violet-500/20">
                      <Loader2 className="w-5 h-5 text-white animate-spin" />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-sm font-semibold text-slate-800">
                        {aiPhase === 'uploading' ?
                    t('AI 正在上传文件...') :
                    t('AI 正在分析单据内容...')}
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {aiPhase === 'uploading' ?
                    t('准备识别引擎') :
                    t('提取供应商、商品、数量等字段')}
                      </p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {aiFiles.map((f, i) =>
                <div
                  key={i}
                  className="flex items-center gap-3 p-2.5 bg-slate-50 rounded-2xl">
                  
                        <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                        <span className="text-sm text-slate-700 flex-1 truncate">
                          {f.name}
                        </span>
                        <span className="text-xs text-slate-400">{f.size}</span>
                        {aiPhase === 'analyzing' &&
                  <span className="inline-flex items-center gap-1 text-xs text-violet-600">
                            <ScanLine className="w-3 h-3 animate-pulse" />{' '}
                            {t('识别中')}
                          </span>
                  }
                      </div>
                )}
                  </div>
                  <div className="mt-4 h-1 bg-slate-100 rounded-full overflow-hidden">
                    <div
                  className={`h-full bg-gradient-to-r from-violet-500 to-blue-600 rounded-full transition-all duration-1000 ${aiPhase === 'uploading' ? 'w-1/3' : 'w-4/5'}`}>
                </div>
                  </div>
                </div>
            }

              {aiPhase === 'reviewed' &&
            <div className="bg-violet-50/60 border border-violet-200 rounded-3xl p-4 flex items-start gap-3">
                  <div className="w-8 h-8 rounded-xl bg-violet-100 flex items-center justify-center shrink-0">
                    <Sparkles className="w-4 h-4 text-violet-600" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-sm font-semibold text-violet-900">
                        {t('AI 识别完成')}
                      </h3>
                      <span className="text-xs text-violet-600 bg-white px-2 py-0.5 rounded-full border border-violet-100">
                        {t('置信度 96%')}
                      </span>
                    </div>
                    <p className="text-xs text-violet-700/80 leading-relaxed">
                      {t('已从')} {aiFiles.length} {t('个文件中识别出供应商、采购单号、')}
                      {stockInItems.length}{' '}
                      {t('项商品及数量。请核对下方紫色标记的字段，确认无误后提交。')}
                    </p>
                  </div>
                  <button
                onClick={resetAi}
                className="px-3 py-1.5 text-xs font-medium text-violet-700 bg-white rounded-full border border-violet-200 hover:bg-violet-50 transition-all flex items-center gap-1 shrink-0">
                
                    <RotateCw className="w-3 h-3" /> {t('重新识别')}
                  </button>
                </div>
            }

              {/* Stock-in Type */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-2 flex items-center gap-2">
                  {t('入库类型')} <AiBadge fieldKey="type" />
                </label>
                <div className="flex gap-2 flex-wrap">
                  {STOCK_IN_TYPES.map((stockType) =>
                <button
                  key={stockType.id}
                  onClick={() => setStockInType(stockType.id)}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${stockInType === stockType.id ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}`}>
                  
                      {t(stockType.label)}
                    </button>
                )}
                </div>
              </div>

              {/* Basic Info Card */}
              <div className="bg-white rounded-3xl p-5 elevation-1 space-y-4">
                <h3 className="text-sm font-medium text-slate-800 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-blue-500" /> {t('基本信息')}
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1.5">
                      {t('入库单号')}
                    </label>
	                    <input
	                    type="text"
	                    value={stockInDocumentNo}
	                    onChange={(event) => setStockInDocumentNo(event.target.value)}
	                    placeholder={t('如 IN-20260601-001')}
	                    className="w-full px-4 py-2 bg-slate-100 border-none rounded-full text-sm font-mono focus:ring-2 focus:ring-blue-500/20 focus:bg-white outline-none transition-all" />
                  
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1.5 flex items-center gap-1.5">
                      {t('入库日期')} <AiBadge fieldKey="date" />
                    </label>
	                    <input
	                    type="date"
	                    value={stockInDate}
	                    onChange={(event) => setStockInDate(event.target.value)}
	                    className={`w-full px-4 py-2 border-none rounded-full text-sm focus:ring-2 focus:ring-blue-500/20 focus:bg-white outline-none transition-all ${aiFields.has('date') ? 'bg-violet-50/60 ring-1 ring-violet-100' : 'bg-slate-100'}`} />
                  
                  </div>
                  {stockInType === 'purchase' &&
                <>
                      <div>
                        <label className="text-xs text-slate-500 mb-1.5 flex items-center gap-1.5">
                          <Truck className="w-3 h-3" /> {t('供应商')}{' '}
                          <AiBadge fieldKey="supplier" />
                        </label>
                        <select
                      value={supplier}
                      onChange={(e) => setSupplier(e.target.value)}
                      className={`w-full px-4 py-2 border-none rounded-full text-sm text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20 transition-all ${aiFields.has('supplier') ? 'bg-violet-50/60 ring-1 ring-violet-100' : 'bg-slate-100'}`}>
                      
                          <option value="深圳市恒丰电子有限公司">{t('深圳市恒丰电子有限公司')}</option>
                          <option value="东莞市嘉鸿科技有限公司">{t('东莞市嘉鸿科技有限公司')}</option>
                          <option value="上海星诚贸易有限公司">{t('上海星诚贸易有限公司')}</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-slate-500 mb-1.5 flex items-center gap-1.5">
                          {t('关联采购单')} <AiBadge fieldKey="po" />
                        </label>
                        <input
                      type="text"
                      value={poNumber}
                      onChange={(e) => setPoNumber(e.target.value)}
                      placeholder={t('可选, 如 PO-20260520-03')}
                      className={`w-full px-4 py-2 border-none rounded-full text-sm font-mono focus:ring-2 focus:ring-blue-500/20 focus:bg-white outline-none transition-all ${aiFields.has('po') ? 'bg-violet-50/60 ring-1 ring-violet-100' : 'bg-slate-100'}`} />
                    
                      </div>
                    </>
                }
                  <div>
                    <label className="text-xs text-slate-500 mb-1.5 flex items-center gap-1.5">
                      <User className="w-3 h-3" /> {t('经办人')}{' '}
                      <AiBadge fieldKey="handler" />
                    </label>
                    <input
                    type="text"
                    value={handler}
                    onChange={(e) => setHandler(e.target.value)}
                    className={`w-full px-4 py-2 border-none rounded-full text-sm focus:ring-2 focus:ring-blue-500/20 focus:bg-white outline-none transition-all ${aiFields.has('handler') ? 'bg-violet-50/60 ring-1 ring-violet-100' : 'bg-slate-100'}`} />
                  
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1.5">
                      {t('入库仓库')}
                    </label>
	                    <select
	                    value={warehouse}
	                    onChange={(event) => setWarehouse(event.target.value)}
	                    className="w-full px-4 py-2 bg-slate-100 border-none rounded-full text-sm text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20 transition-all">
                      <option value="主仓 - 上海">{t('主仓 - 上海')}</option>
                      <option value="分仓 - 深圳">{t('分仓 - 深圳')}</option>
                      <option value="分仓 - 杭州">{t('分仓 - 杭州')}</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Items Card */}
              <div className="bg-white rounded-3xl p-5 elevation-1">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-medium text-slate-800 flex items-center gap-2">
                    <Package className="w-4 h-4 text-blue-500" /> {t('入库商品')}
                  </h3>
                  <span className="text-xs text-slate-500">
                    {t('共')} {stockInItems.length} {t('项')}
                  </span>
                </div>
                <div className="space-y-2">
                  {stockInItems.map((row, idx) =>
                <div
                  key={idx}
                  className={`flex items-center gap-2 p-2 rounded-2xl transition-colors ${aiFields.has(`item-${idx}`) ? 'bg-violet-50/60 ring-1 ring-violet-100' : 'bg-slate-50'}`}>
                  
                      <span className="text-xs text-slate-400 w-6 text-center">
                        {idx + 1}
                      </span>
                      {aiFields.has(`item-${idx}`) &&
                  <Sparkles className="w-3 h-3 text-violet-500 shrink-0" />
                  }
                      <select
                    value={row.id}
                    onChange={(e) =>
                    updateStockInRow(idx, 'id', e.target.value)
                    }
                    className="flex-1 px-3 py-1.5 bg-white border-none rounded-full text-sm text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20 transition-all">
                    
                        <option value="">{t('选择商品...')}</option>
	                        {(skuOptions.length > 0 ? skuOptions : inventoryData?.inventory.items ?? []).map((p) =>
                    <option key={p.id} value={p.id}>
                            {p.id} · {p.name} ({p.spec})
                          </option>
                    )}
                      </select>
                      <input
                    type="number"
                    placeholder={t('数量')}
                    value={row.qty || ''}
                    onChange={(e) =>
                    updateStockInRow(
                      idx,
                      'qty',
                      parseInt(e.target.value) || 0
                    )
                    }
                    className="w-24 px-3 py-1.5 bg-white border-none rounded-full text-sm text-right focus:ring-2 focus:ring-blue-500/20 outline-none transition-all" />
                  
                      <button
                    onClick={() => removeStockInRow(idx)}
                    disabled={stockInItems.length === 1}
                    className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-full transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400">
                    
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                )}
                </div>
                <button
                onClick={addStockInRow}
                className="mt-3 text-sm text-blue-700 bg-blue-50 px-4 py-2 rounded-full font-medium flex items-center gap-1.5 hover:bg-blue-100 transition-colors">
                
                  <Plus className="w-4 h-4" /> {t('添加商品')}
                </button>
              </div>

              {/* Remarks */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-2">
                  {t('备注')} <span className="text-slate-400">{t('(可选)')}</span>
                </label>
	                <textarea
	                rows={3}
	                value={stockInRemark}
	                onChange={(event) => setStockInRemark(event.target.value)}
	                placeholder={t('可填写来源、批次、质检情况等...')}
                className="w-full px-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 outline-none transition-all resize-none" />
              
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-100 bg-white flex items-center justify-between">
              <div className="text-xs text-slate-500 flex items-center gap-2">
                {t('合计入库')}{' '}
                <span className="font-semibold text-blue-700">
                  {stockInItems.reduce((s, r) => s + (r.qty || 0), 0)}
                </span>{' '}
                {t('件')}
                {aiPhase === 'reviewed' &&
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-violet-50 text-violet-600 rounded-full text-[10px] font-medium border border-violet-100 ml-1">
                    <Sparkles className="w-2.5 h-2.5" /> {t('AI 预填，待您确认')}
                  </span>
              }
              </div>
              <div className="flex items-center gap-3">
                <button
                onClick={() => {
                  setShowStockIn(false);
                  resetAi();
                }}
                className="px-5 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-full hover:bg-slate-200 transition-all">
                
                  {t('取消')}
                </button>
                <button
                onClick={() => void submitStockIn()}
                className="px-6 py-2 text-sm font-medium text-white bg-gradient-primary rounded-full glow-blue transition-all flex items-center gap-1.5">
                
                  <CheckCircle className="w-4 h-4" /> {t('确认入库')}
                </button>
              </div>
            </div>
          </div>
        </div>
      }

      {/* Product Detail Modal */}
      {detailItem &&
      <div
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onClick={() => setDetailData(null)}>
        
          <div
          className="bg-white rounded-3xl elevation-3 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}>
          
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-white">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-100 to-indigo-100 flex items-center justify-center shrink-0">
                  <Package className="w-6 h-6 text-blue-600" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold text-slate-800">
                      <AutoTranslatedText text={detailItem.name} />
                    </h2>
                    <span
                    className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium
                      ${detailItem.status === '正常' ? 'text-emerald-700 bg-emerald-50' : ''}
                      ${detailItem.status === '偏低' ? 'text-amber-700 bg-amber-50' : ''}
                      ${detailItem.status === '缺货' ? 'text-rose-700 bg-rose-50' : ''}`}>
                    
                      {t(detailItem.status)}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5 font-mono">
                    SKU: {detailItem.id} · {t('条码')}: 690
                    {detailItem.id.replace(/[^0-9]/g, '').padStart(10, '0')}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={adjustCurrentInventory}
                  className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 rounded-full hover:bg-slate-200 transition-all flex items-center gap-1.5">
                  <Edit3 className="w-3.5 h-3.5" /> {t('编辑')}
                </button>
                <button
                onClick={() => setDetailData(null)}
                className="w-9 h-9 flex items-center justify-center text-slate-400 hover:bg-slate-100 rounded-full transition-colors">
                
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 bg-slate-50/30 space-y-5">
              {/* Top stats grid */}
              <div className="grid grid-cols-4 gap-4">
                <div className="bg-white rounded-2xl p-4 elevation-1">
                  <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1.5">
                    <BarChart3 className="w-3.5 h-3.5" /> {t('当前库存')}
                  </div>
                  <div
                  className={`text-2xl font-bold ${detailItem.status === '缺货' ? 'text-rose-600' : detailItem.status === '偏低' ? 'text-amber-600' : 'text-slate-800'}`}>
                  
                    {detailItem.stock}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    {t('安全库存')} {detailItem.safe}
                  </div>
                </div>
                <div className="bg-white rounded-2xl p-4 elevation-1">
                  <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1.5">
                    <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />{' '}
                    {t('待入库')}
                  </div>
                  <div className="text-2xl font-bold text-emerald-600">
                    {detailItem.in > 0 ? `+${detailItem.in}` : '0'}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    {t('采购单待入库')}
                  </div>
                </div>
                <div className="bg-white rounded-2xl p-4 elevation-1">
                  <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1.5">
                    <ShoppingCart className="w-3.5 h-3.5 text-blue-500" />{' '}
                    {t('待出库')}
                  </div>
                  <div className="text-2xl font-bold text-blue-600">
                    {detailItem.out > 0 ? `-${detailItem.out}` : '0'}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    {t('订单已占用')}
                  </div>
                </div>
                <div className="bg-white rounded-2xl p-4 elevation-1">
                  <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1.5">
                    <Layers className="w-3.5 h-3.5 text-indigo-500" /> {t('可用库存')}
                  </div>
                  <div className="text-2xl font-bold text-slate-800">
                    {detailItem.stock - detailItem.out + detailItem.in}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    {t('含待入库')}
                  </div>
                </div>
              </div>

              {/* Stock health bar */}
              <div className="bg-white rounded-2xl p-4 elevation-1">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-slate-800">
                    {t('库存健康度')}
                  </h3>
                  <span className="text-xs text-slate-500">
                    {t('占安全库存')}{' '}
                    {Math.round(detailItem.stock / detailItem.safe * 100)}%
                  </span>
                </div>
                <div className="relative h-2.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                  className={`absolute left-0 top-0 h-full rounded-full transition-all
                      ${detailItem.stock >= detailItem.safe ? 'bg-emerald-500' : detailItem.stock >= detailItem.safe * 0.5 ? 'bg-amber-500' : 'bg-rose-500'}`}
                  style={{
                    width: `${Math.min(100, detailItem.stock / detailItem.safe * 100)}%`
                  }}>
                </div>
                  <div
                  className="absolute top-0 h-full w-0.5 bg-slate-400"
                  style={{
                    left: '100%',
                    transform: 'translateX(-1px)'
                  }}>
                </div>
                </div>
                <div className="flex justify-between text-[10px] text-slate-400 mt-1.5">
                  <span>0</span>
                  <span>{t('安全库存')} {detailItem.safe}</span>
                </div>
              </div>

              {/* Two column body */}
              <div className="grid grid-cols-2 gap-5">
                {/* Basic Info */}
                <div className="bg-white rounded-2xl p-5 elevation-1">
                  <h3 className="text-sm font-medium text-slate-800 mb-4 flex items-center gap-2">
                    <Tag className="w-4 h-4 text-blue-500" /> {t('基本信息')}
                  </h3>
                  <div className="space-y-2.5 text-sm">
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-500">{t('商品类目')}</span>
                      <span className="text-slate-800">
                        <AutoTranslatedText text={detailItem.category} />
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-500">{t('规格')}</span>
                      <span className="text-slate-800"><AutoTranslatedText text={detailItem.spec} /></span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-500">{t('计量单位')}</span>
                      <span className="text-slate-800">{t('个')}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-500">{t('默认供应商')}</span>
                      <span
                      className="text-slate-800 truncate max-w-[180px]"
                      title="深圳市恒丰电子有限公司">
                      
                        {t('深圳市恒丰电子')}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-500 flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        {t('存放位置')}
                      </span>
                      <span className="text-slate-800 font-mono">
                        {t('A区-3排-')}{detailItem.id.slice(-2)}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-500">{t('采购成本')}</span>
                      <span className="text-slate-800 font-medium">
                        ¥
                        {(
                      parseFloat(
                        detailItem.id.replace(/[^0-9]/g, '') || '50'
                      ) * 1.2).
                      toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-500">{t('销售单价')}</span>
                      <span className="text-blue-700 font-medium">
                        ¥
                        {(
                      parseFloat(
                        detailItem.id.replace(/[^0-9]/g, '') || '50'
                      ) * 2.5).
                      toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Related Orders */}
                <div className="bg-white rounded-2xl p-5 elevation-1">
                  <h3 className="text-sm font-medium text-slate-800 mb-4 flex items-center gap-2">
                    <ShoppingCart className="w-4 h-4 text-blue-500" /> {t('关联订单')}
                  </h3>
                  <div className="space-y-2">
                    {(() => {
                    const relatedOrders = detailData?.relatedOrders ?? [];
                    if (relatedOrders.length === 0) {
                      return (
                        <div className="text-xs text-slate-400 text-center py-6">
                            {t('暂无关联订单')}
                          </div>);

                    }
                    return relatedOrders.
                    slice(0, 4).
                    map((o: any, i: number) =>
                    <div
                      key={i}
                      className="flex items-center justify-between p-2.5 hover:bg-slate-50 rounded-xl transition-colors">
                      
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-mono text-blue-700">
                                {o.orderId}
                              </div>
                              <div className="text-xs text-slate-500 truncate mt-0.5">
                                <AutoTranslatedText text={o.customer} />
                              </div>
                            </div>
                            <div className="text-right shrink-0 ml-3">
                              <div className="text-xs font-medium text-slate-700">
                                ×{o.orderQty}
                              </div>
                              <div className="text-[10px] text-slate-400 mt-0.5">
                                {o.date}
                              </div>
                            </div>
                          </div>
                    );
                  })()}
                  </div>
                </div>
              </div>

              {/* Recent Movements */}
              <div className="bg-white rounded-2xl p-5 elevation-1">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-medium text-slate-800 flex items-center gap-2">
                    <History className="w-4 h-4 text-blue-500" /> {t('出入库记录')}
                  </h3>
                  <button
                    onClick={() => toast.info(t('当前已显示最近出入库记录'))}
                    className="text-xs text-blue-600 hover:bg-blue-50 px-2 py-1 rounded-full transition-colors flex items-center gap-1">
                    {t('查看全部')} <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
                <div className="space-y-2">
                  {(detailData?.movements ?? []).
                map((m) =>
                <div
                  key={m.id}
                  className="flex items-center gap-3 p-2.5 hover:bg-slate-50 rounded-xl transition-colors">
                  
                      <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${m.type === 'in' ? 'bg-emerald-50 text-emerald-600' : m.type === 'out' ? 'bg-rose-50 text-rose-600' : 'bg-slate-100 text-slate-600'}`}>
                    
                        {m.type === 'in' ? t('入') : m.type === 'out' ? t('出') : t('调')}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                        className={`text-sm font-medium ${m.type === 'in' ? 'text-emerald-600' : m.type === 'out' ? 'text-rose-600' : 'text-slate-600'}`}>
                        
                            {m.type === 'in' ? '+' : m.type === 'out' ? '-' : ''}
                            {m.qty}
                          </span>
                          <span className="text-xs text-slate-600 truncate">
                            <AutoTranslatedText text={m.note} />
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          {m.time} · {t('经办人')} {m.operator}
                        </div>
                      </div>
                    </div>
                )}
                </div>
              </div>
            </div>

            {/* Footer Actions */}
            <div className="px-6 py-4 border-t border-slate-100 bg-white flex items-center justify-between">
              <div className="text-xs text-slate-500">
                {t('最后更新')}: {detailData?.movements[0]?.time ?? '-'}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={adjustCurrentInventory}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-full hover:bg-slate-200 transition-all">
                  {t('调整库存')}
                </button>
                <button
                  onClick={stockOutCurrentItem}
                  className="px-4 py-2 text-sm font-medium text-rose-700 bg-rose-50 rounded-full hover:bg-rose-100 transition-all flex items-center gap-1.5">
                  <ArrowRight className="w-4 h-4 rotate-180" /> {t('出库登记')}
                </button>
                <button
                onClick={() => {
                  openStockInModal(detailItem);
                  setDetailData(null);
                }}
                className="px-5 py-2 text-sm font-medium text-white bg-gradient-primary rounded-full glow-blue transition-all flex items-center gap-1.5">
                
                  <Plus className="w-4 h-4" /> {t('入库登记')}
                </button>
              </div>
            </div>
          </div>
        </div>
      }
    </div>);

}
