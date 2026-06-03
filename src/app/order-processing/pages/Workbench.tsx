import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Search,
  Mail,
  Upload,
  FileText,
  CheckCircle,
  Clock,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  X,
  Check,
  FileDown,
  Layers,
  Sparkles,
  Loader2,
} from
'lucide-react';
import { StatItem } from '../components/StatItem';
import { StatusBadge } from '../components/StatusBadge';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow
} from '../../components/ui/table';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink
} from '../../components/ui/pagination';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../../components/ui/select';
import { ScrollArea } from '../../components/ui/scroll-area';
import {
  integrationManagementApi,
  type MailboxItem
} from '../../lib/integrationManagementApi';
import {
  orderProcessingApi,
  type InvoiceInfo,
  type InvoiceLine,
  type OrderDetail,
  type OrderProduct,
  type OrderSummary,
  type WorkbenchResponse
} from '../../lib/orderProcessingApi';
const ORDER_QUEUE_PAGE_SIZE = 6;
const PRODUCT_TABLE_PAGE_SIZE = 12;

type InvoiceDraftLine = {
  id: string;
  lineId?: string;
  name: string;
  spec: string;
  unit: string;
  quantity: number;
  quantityText: string;
  unitPrice: number;
  unitPriceText: string;
  subtotal: number;
  subtotalText: string;
};

type InvoiceDraftInfo = InvoiceInfo;

const parseMoney = (value: string | number) => {
  const number = Number(String(value).replace(/[¥,\s]/g, ''));
  return Number.isFinite(number) ? number : 0;
};

const formatInvoiceMoney = (value: number) =>
  `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatDraftNumber = (value: number) => Number.isFinite(value) ? String(value) : '';
const formatDraftMoneyInput = (value: number) => Number.isFinite(value) ? value.toFixed(2).replace(/\.00$/, '') : '';
const roundMoney = (value: number) => Math.round(value * 100) / 100;

const buildInvoiceDraftLines = (products: OrderProduct[]): InvoiceDraftLine[] =>
  products.map((product) => ({
    id: product.id,
    lineId: product.lineId,
    name: product.name,
    spec: product.spec,
    unit: product.unit,
    quantity: product.orderQty,
    quantityText: formatDraftNumber(product.orderQty),
    unitPrice: parseMoney(product.orderPrice || product.sysPrice),
    unitPriceText: formatDraftMoneyInput(parseMoney(product.orderPrice || product.sysPrice)),
    subtotal: parseMoney(product.subtotal) || product.orderQty * parseMoney(product.orderPrice || product.sysPrice),
    subtotalText: formatDraftMoneyInput(parseMoney(product.subtotal) || product.orderQty * parseMoney(product.orderPrice || product.sysPrice))
  }));

const buildInvoiceDraftLinesFromInvoice = (lines: InvoiceLine[]): InvoiceDraftLine[] =>
  lines.map((line) => ({
    id: line.id,
    lineId: line.lineId,
    name: line.name,
    spec: line.spec,
    unit: line.unit,
    quantity: line.quantity,
    quantityText: formatDraftNumber(line.quantity),
    unitPrice: parseMoney(line.unitPrice),
    unitPriceText: formatDraftMoneyInput(parseMoney(line.unitPrice)),
    subtotal: parseMoney(line.subtotal),
    subtotalText: formatDraftMoneyInput(parseMoney(line.subtotal))
  }));

const buildInvoiceLinesForDetail = (detail: OrderDetail): InvoiceDraftLine[] =>
  detail.invoiceLines?.length ? buildInvoiceDraftLinesFromInvoice(detail.invoiceLines) : buildInvoiceDraftLines(detail.products ?? []);

const buildInvoiceInfoForDetail = (detail: OrderDetail): InvoiceDraftInfo => ({
  customer: detail.invoiceInfo?.customer || detail.customer || '',
  orderId: detail.invoiceInfo?.orderId || detail.orderId || '',
  date: detail.invoiceInfo?.date || detail.date || ''
});

export function Workbench() {
  const orderQueueRef = useRef<HTMLDivElement | null>(null);
  const orderUploadInputRef = useRef<HTMLInputElement | null>(null);
  const aiTemplateInputRef = useRef<HTMLInputElement | null>(null);
  const [workbench, setWorkbench] = useState<WorkbenchResponse | null>(null);
  const [queueItems, setQueueItems] = useState<OrderSummary[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [orderSearch, setOrderSearch] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [productCategoryFilter, setProductCategoryFilter] = useState('all');
  const [orderPage, setOrderPage] = useState(1);
  const [productPage, setProductPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingMoreOrders, setLoadingMoreOrders] = useState(false);
  const [loadingWecomMailboxes, setLoadingWecomMailboxes] = useState(false);
  const [syncingWecomOrders, setSyncingWecomOrders] = useState(false);
  const [wecomMailboxes, setWecomMailboxes] = useState<MailboxItem[]>([]);
  const [selectedWecomMailboxId, setSelectedWecomMailboxId] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [activeModal, setActiveModal] = useState<'original' | 'preview' | 'aiTemplate' | 'invoiceDraft' | null>(null);
  const [invoiceDraftInfo, setInvoiceDraftInfo] = useState<InvoiceDraftInfo>({ customer: '', orderId: '', date: '' });
  const [invoiceDraftLines, setInvoiceDraftLines] = useState<InvoiceDraftLine[]>([]);
  const [invoiceSubmitting, setInvoiceSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<'wecom_mail' | 'upload'>('upload');
  // --- AI Template Generation State ---
  type AIPhase = 'idle' | 'uploading' | 'analyzing' | 'generating' | 'done';
  const [aiPhase, setAiPhase] = useState<AIPhase>('idle');
  const [aiFiles, setAiFiles] = useState<
    Array<{
      name: string;
      size: string;
    }>>(
    []);
  const resetAi = () => {
    setAiPhase('idle');
    setAiFiles([]);
  };

  const enabledWecomMailboxes = useMemo(
    () => wecomMailboxes.filter((mailbox) => mailbox.enabled),
    [wecomMailboxes]
  );

  const loadWorkbench = useCallback(async () => {
    const isLoadingMore = orderPage > 1;
    setLoading(!isLoadingMore);
    setLoadingMoreOrders(isLoadingMore);
    try {
      const data = await orderProcessingApi.getWorkbench({
        q: orderSearch,
        source: activeTab,
        mailboxId: activeTab === 'wecom_mail' ? selectedWecomMailboxId || undefined : undefined,
        orderId: selectedOrderId || undefined,
        orderPage,
        orderPageSize: ORDER_QUEUE_PAGE_SIZE
      });
      setWorkbench(data);
      setQueueItems((prev) => {
        if (data.queue.page <= 1) return data.queue.items;
        const byId = new Map(prev.map((item) => [item.id, item]));
        data.queue.items.forEach((item) => byId.set(item.id, item));
        return Array.from(byId.values());
      });
      if (data.selectedOrder?.id && data.selectedOrder.id !== selectedOrderId) {
        setSelectedOrderId(data.selectedOrder.id);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '订单工作台加载失败');
    } finally {
      setLoading(false);
      setLoadingMoreOrders(false);
    }
  }, [activeTab, orderPage, orderSearch, selectedOrderId, selectedWecomMailboxId]);

  useEffect(() => {
    void loadWorkbench();
  }, [loadWorkbench]);

  useEffect(() => {
    let alive = true;
    setLoadingWecomMailboxes(true);
    integrationManagementApi.listMailboxes({ page: 1, pageSize: 100 })
      .then((data) => {
        if (!alive) return;
        setWecomMailboxes(data.items);
        const firstEnabled = data.items.find((mailbox) => mailbox.enabled);
        setSelectedWecomMailboxId((current) => current || firstEnabled?.id || '');
      })
      .catch((error) => {
        if (!alive) return;
        toast.error(error instanceof Error ? error.message : '企业微信邮箱列表加载失败');
      })
      .finally(() => {
        if (alive) setLoadingWecomMailboxes(false);
      });

    return () => {
      alive = false;
    };
  }, []);

  const templates = workbench?.templates ?? [];
  const selectableTemplates = useMemo(() => templates.filter((template) => template.id !== 'custom'), [templates]);
  const fallbackTemplateId = selectableTemplates[0]?.id ?? 'weoxy';
  const defaultTemplate = workbench?.activeTemplateId && workbench.activeTemplateId !== 'custom' ? workbench.activeTemplateId : fallbackTemplateId;
  const activeTemplate = selectedTemplateId && selectedTemplateId !== 'custom' ? selectedTemplateId : defaultTemplate;
  const selectedOrder = workbench?.selectedOrder ?? null;
  const orderDetails: OrderDetail = workbench?.orderDetails ?? {
    id: '',
    customer: '',
    orderId: '',
    date: '',
    amount: '¥0.00',
    invoiceNo: '',
    products: []
  };
  const allProductRows = orderDetails.products ?? [];
  const productCategories = useMemo(
    () => Array.from(new Set(allProductRows.map((item) => item.category).filter(Boolean))),
    [allProductRows]
  );
  const filteredProductRows = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    return allProductRows.filter((item) => {
      const matchesQuery = !q || [item.id, item.name, item.category, item.spec, item.remark].some((value) => value.toLowerCase().includes(q));
      const matchesCategory = productCategoryFilter === 'all' || item.category === productCategoryFilter;
      return matchesQuery && matchesCategory;
    });
  }, [allProductRows, productCategoryFilter, productSearch]);
  const productTotalPages = Math.max(1, Math.ceil(filteredProductRows.length / PRODUCT_TABLE_PAGE_SIZE));
  const normalizedProductPage = Math.min(productPage, productTotalPages);
  const productRows = filteredProductRows.slice((normalizedProductPage - 1) * PRODUCT_TABLE_PAGE_SIZE, normalizedProductPage * PRODUCT_TABLE_PAGE_SIZE);
  const productMeta = {
    page: normalizedProductPage,
    pageSize: PRODUCT_TABLE_PAGE_SIZE,
    total: filteredProductRows.length,
    totalPages: productTotalPages
  };
  const queue = workbench?.queue;
  const visibleQueueItems = queueItems.length > 0 ? queueItems : queue?.items ?? [];
  const hasMoreOrders = Boolean(queue && queue.page < queue.totalPages);
  const loadedOrderCount = Math.min(visibleQueueItems.length, queue?.total ?? visibleQueueItems.length);
  const activeTemplateName = selectableTemplates.find((template) => template.id === activeTemplate)?.name ?? '当前发票模板';
  const rawInvoicePreviewTemplate = orderDetails.invoiceTemplateId || activeTemplate;
  const invoicePreviewTemplate = rawInvoicePreviewTemplate === 'custom' ? fallbackTemplateId : rawInvoicePreviewTemplate;
  const invoicePreviewTemplateName = selectableTemplates.find((template) => template.id === invoicePreviewTemplate)?.name ?? activeTemplateName;
  const invoicePreviewInfo = useMemo(() => buildInvoiceInfoForDetail(orderDetails), [orderDetails]);
  const invoicePreviewLines = useMemo(() => buildInvoiceLinesForDetail(orderDetails), [orderDetails]);
  const invoicePreviewAmount = useMemo(
    () => invoicePreviewLines.reduce((sum, line) => sum + line.subtotal, 0),
    [invoicePreviewLines]
  );
  const invoicePreviewAmountText = formatInvoiceMoney(invoicePreviewAmount);
  const invoiceDraftAmount = useMemo(
    () => invoiceDraftLines.reduce((sum, line) => sum + line.subtotal, 0),
    [invoiceDraftLines]
  );
  const invoiceDraftAmountText = formatInvoiceMoney(invoiceDraftAmount);
  const originalOrderAmountText = useMemo(
    () => (orderDetails.products ?? []).reduce((sum, product) => sum + product.orderQty * parseMoney(product.orderPrice), 0),
    [orderDetails.products]
  );

  const refreshAfterMutation = async () => {
	    await loadWorkbench();
	  };

  useEffect(() => {
    if (selectedTemplateId && selectableTemplates.some((template) => template.id === selectedTemplateId)) return;
    if (defaultTemplate) setSelectedTemplateId(defaultTemplate);
  }, [defaultTemplate, selectableTemplates, selectedTemplateId]);

  useEffect(() => {
    setProductPage(1);
  }, [productCategoryFilter, productSearch, selectedOrderId]);

	  const handleSelectOrder = (orderId: string) => {
    setSelectedOrderId(orderId);
    setProductPage(1);
  };

  const resetOrderQueue = () => {
    setQueueItems([]);
    setOrderPage(1);
    orderQueueRef.current?.scrollTo({ top: 0 });
  };

  const handleOrderQueueScroll = (event: React.UIEvent<HTMLDivElement>) => {
    if (loading || loadingMoreOrders || !queue || queue.page >= queue.totalPages) return;
    const target = event.currentTarget;
    const distanceToBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    if (distanceToBottom <= 96) {
      setOrderPage((page) => Math.min(page + 1, queue.totalPages));
    }
  };

  const handleUploadOrders = async (files: File[] = []) => {
    if (files.length === 0) {
      toast.error('请选择要上传的订货单文件');
      return;
    }
    try {
      const result = await orderProcessingApi.uploadOrders(files);
      toast.success(result.message);
      resetOrderQueue();
      setProductPage(1);
      if (result.created[0]?.id) setSelectedOrderId(result.created[0].id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '订货单上传失败');
    }
  };

  const handleRefreshOrders = async () => {
    if (activeTab !== 'wecom_mail') {
      resetOrderQueue();
      if (orderPage === 1) void loadWorkbench();
      return;
    }

    if (!selectedWecomMailboxId) {
      toast.info('请先选择企业微信邮箱');
      return;
    }

    setSyncingWecomOrders(true);
    try {
      const result = await orderProcessingApi.syncWecomMailOrders({ mailboxId: selectedWecomMailboxId, ignoreLastUid: true });
      const skippedReason = result.created.length === 0 ? result.skipped[0]?.reason : '';
      const syncMessage = skippedReason ? `${result.message} 原因：${skippedReason}` : result.message;
      if (result.created.length > 0) {
        toast.success(syncMessage);
      } else if (result.matchedCount > 0 || skippedReason) {
        toast.warning(syncMessage);
      } else {
        toast.info(syncMessage);
      }
      resetOrderQueue();
      setProductPage(1);
      if (result.created[0]?.id) {
        setSelectedOrderId(result.created[0].id);
      } else if (orderPage === 1) {
        await loadWorkbench();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '企业微信邮箱同步失败');
    } finally {
      setSyncingWecomOrders(false);
    }
  };

  const handleOpenInvoiceDraft = () => {
    if (!selectedOrder?.id) {
      toast.info('请先选择一张订货单');
      return;
    }
    const lines = buildInvoiceLinesForDetail(orderDetails);
    if (lines.length === 0) {
      toast.error('当前订货单没有可生成发票的商品明细');
      return;
    }
    setInvoiceDraftInfo(buildInvoiceInfoForDetail(orderDetails));
    setInvoiceDraftLines(lines);
    setActiveModal('invoiceDraft');
  };

  const handleInvoiceDraftLineChange = (lineId: string, field: 'quantity' | 'unitPrice', value: string) => {
    const number = Number(value);
    setInvoiceDraftLines((lines) =>
      lines.map((line) => {
        if ((line.lineId ?? line.id) !== lineId) return line;
        if (field === 'quantity') {
          const quantity = Number.isFinite(number) && value !== '' ? Math.max(0, Math.floor(number)) : 0;
          const subtotal = roundMoney(quantity * line.unitPrice);
          return {
            ...line,
            quantity,
            quantityText: value,
            subtotal,
            subtotalText: value === '' ? '' : formatDraftMoneyInput(subtotal)
          };
        }
        const unitPrice = Number.isFinite(number) && value !== '' ? Math.max(0, roundMoney(number)) : 0;
        const subtotal = roundMoney(line.quantity * unitPrice);
        return {
          ...line,
          unitPrice,
          unitPriceText: value,
          subtotal,
          subtotalText: value === '' ? '' : formatDraftMoneyInput(subtotal)
        };
      })
    );
  };

  const handleInvoiceDraftLineTextChange = (lineId: string, field: 'name' | 'spec' | 'unit', value: string) => {
    setInvoiceDraftLines((lines) =>
      lines.map((line) => (line.lineId ?? line.id) === lineId ? { ...line, [field]: value } : line)
    );
  };

  const handleInvoiceDraftLineAmountChange = (lineId: string, value: string) => {
    const amount = Number(value);
    setInvoiceDraftLines((lines) =>
      lines.map((line) => {
        if ((line.lineId ?? line.id) !== lineId) return line;
        const subtotal = Number.isFinite(amount) && value !== '' ? Math.max(0, roundMoney(amount)) : 0;
        return { ...line, subtotal, subtotalText: value };
      })
    );
  };

  const handleInvoiceDraftInfoChange = (field: keyof InvoiceDraftInfo, value: string) => {
    setInvoiceDraftInfo((info) => ({ ...info, [field]: value }));
  };

  const handleConfirmGenerateInvoice = async () => {
    if (!selectedOrder?.id) return;
    if (invoiceDraftLines.length === 0) {
      toast.error('当前发票没有商品明细');
      return;
    }
    const invalidLine = invoiceDraftLines.find((line) =>
      !line.name.trim() ||
      line.quantityText.trim() === '' ||
      line.unitPriceText.trim() === '' ||
      line.subtotalText.trim() === '' ||
      line.quantity <= 0 ||
      line.unitPrice < 0 ||
      line.subtotal < 0
    );
    if (invalidLine) {
      toast.error('请检查商品名称、数量、单价和金额，数量必须大于 0，金额不能小于 0');
      return;
    }
    setInvoiceSubmitting(true);
    try {
      const result = await orderProcessingApi.generateInvoice(selectedOrder.id, {
        templateId: activeTemplate,
        info: invoiceDraftInfo,
        lines: invoiceDraftLines.map((line) => ({
          id: line.id,
          lineId: line.lineId,
          name: line.name.trim(),
          spec: line.spec.trim(),
          unit: line.unit.trim(),
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          subtotal: line.subtotal
        }))
      });
      toast.success(result.message);
      await refreshAfterMutation();
      setActiveModal('preview');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '发票生成失败');
    } finally {
      setInvoiceSubmitting(false);
    }
  };

  const handleExportInvoice = async () => {
    if (!selectedOrder?.id) return;
    try {
      const result = await orderProcessingApi.exportInvoice(selectedOrder.id);
      toast.success(result.message ?? '发票 PDF 已导出');
      await refreshAfterMutation();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '发票导出失败');
    }
  };

  const handleSelectTemplate = (templateId: string) => {
    setSelectedTemplateId(templateId);
  };

  const formatLocalFileSize = (size: number) => {
    if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
  };

  const simulateAiTemplateGeneration = async (files: File[] = []) => {
    if (files.length === 0) {
      toast.error('请选择参考发票文件');
      return;
    }
    setAiPhase('uploading');
    setAiFiles(
      files.map((file) => ({ name: file.name, size: formatLocalFileSize(file.size) }))
    );
    await new Promise((resolve) => window.setTimeout(resolve, 700));
    setAiPhase('analyzing');
    await new Promise((resolve) => window.setTimeout(resolve, 900));
    setAiPhase('generating');
    try {
      const result = await orderProcessingApi.generateAiTemplate(files);
      toast.success(result.message);
      setSelectedTemplateId(result.activeTemplateId);
      await refreshAfterMutation();
      setAiPhase('done');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'AI 模板生成失败');
      resetAi();
    }
  };

  const saveAiTemplate = async () => {
    setActiveModal(null);
    resetAi();
    await refreshAfterMutation();
  };
  return (
    <div className="material-scrollbar flex h-full min-h-0 w-full flex-col overflow-x-auto p-3 pb-4">
      <input
        ref={orderUploadInputRef}
        type="file"
        multiple
        className="hidden"
        accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls,.csv"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          void handleUploadOrders(files);
        }} />
      <input
        ref={aiTemplateInputRef}
        type="file"
        multiple
        className="hidden"
        accept=".pdf,.png,.jpg,.jpeg"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          void simulateAiTemplateGeneration(files);
        }} />
      {/* Main Workbench Container */}
      <div className="bg-gradient-mesh rounded-[20px] elevation-2 flex min-h-0 min-w-[1536px] flex-1 flex-col overflow-hidden">
        {/* Overview Strip */}
        <div className="min-h-14 bg-slate-50/80 border-b border-slate-100 flex items-center justify-between gap-4 px-6 py-3 shrink-0">
          <div className="flex items-center gap-3 flex-wrap">
            <StatItem label="待处理" value={String(workbench?.stats.pending ?? 0)} color="blue" />
            <StatItem label="异常" value={String(workbench?.stats.abnormal ?? 0)} color="rose" />
            <StatItem label="已生成" value={String(workbench?.stats.generated ?? 0)} color="emerald" />
            <StatItem label="未导出" value={String(workbench?.stats.unexported ?? 0)} color="amber" />
          </div>

        </div>

        {/* Three Column Layout */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* LEFT: Order Queue */}
          <div className="w-[280px] border-r border-slate-100 flex min-h-0 flex-col bg-white shrink-0 z-10">
            <div className="px-4 py-3 border-b border-slate-100">
              <div className="flex p-0.5 bg-slate-100/80 rounded-full mb-2.5">
                <button
                  className={`flex-1 text-[11px] leading-none py-1.5 rounded-full font-medium transition-all ${activeTab === 'wecom_mail' ? 'bg-blue-100 text-blue-700' : 'text-slate-500 hover:bg-slate-200/50'}`}
                  onClick={() => {
                    setActiveTab('wecom_mail');
                    resetOrderQueue();
                  }}>
                  企业微信邮箱
                </button>
                <button
                  className={`flex-1 text-[11px] leading-none py-1.5 rounded-full font-medium transition-all ${activeTab === 'upload' ? 'bg-blue-100 text-blue-700' : 'text-slate-500 hover:bg-slate-200/50'}`}
                  onClick={() => {
                    setActiveTab('upload');
                    resetOrderQueue();
                  }}>
                  手动上传
                </button>
              </div>

              {activeTab === 'wecom_mail' &&
                <div className="mb-2">
                  <Select
                    value={selectedWecomMailboxId || undefined}
                    onValueChange={(value) => {
                      setSelectedWecomMailboxId(value);
                      resetOrderQueue();
                    }}
                    disabled={loadingWecomMailboxes || enabledWecomMailboxes.length === 0}>
                    <SelectTrigger className="h-7 rounded-full border-blue-100 bg-white px-3 text-[11px] text-slate-700 shadow-sm shadow-blue-100/40 focus:ring-blue-500/20">
                      <SelectValue
                        placeholder={
                          loadingWecomMailboxes ?
                            '加载企业微信邮箱...' :
                            enabledWecomMailboxes.length > 0 ?
                              '选择企业微信邮箱' :
                              '暂无可用企业微信邮箱'
                        } />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
                      {enabledWecomMailboxes.map((mailbox) =>
                      <SelectItem
                        key={mailbox.id}
                        value={mailbox.id}
                        className="rounded-lg py-2 pl-3 pr-9 text-sm text-slate-700">
                        {mailbox.email}
                      </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              }

              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={orderSearch}
	                  onChange={(event) => {
	                    setOrderSearch(event.target.value);
	                    resetOrderQueue();
	                  }}
                  placeholder="搜索客户 / 订单号"
                  className="h-8 w-full pl-8 pr-3 bg-slate-100 border-none rounded-full text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all" />
                
              </div>
            </div>

	            <div
	              ref={orderQueueRef}
	              onScroll={handleOrderQueueScroll}
	              className="min-h-0 flex-1 overflow-y-auto p-3 space-y-1.5">
	              {visibleQueueItems.map((order) =>
	              <div
	                key={order.id}
                onClick={() => handleSelectOrder(order.id)}
                className={`relative p-3.5 rounded-2xl cursor-pointer transition-all overflow-hidden ${selectedOrderId === order.id ? 'bg-blue-50' : 'hover:bg-blue-50/40'}`}>
                
                  {selectedOrderId === order.id &&
                <div className="absolute left-0 top-3 bottom-3 w-1 bg-blue-500 rounded-r-full"></div>
                }
                  <div className="flex justify-between items-start mb-1.5">
                    <span
                    className={`text-sm font-medium truncate pr-2 ${selectedOrderId === order.id ? 'text-blue-900' : 'text-slate-800'}`}>
                    
                      {order.customer}
                    </span>
                    <StatusBadge type={order.type} text={order.status} />
                  </div>
                  <div
                  className={`text-xs font-mono mb-1.5 ${selectedOrderId === order.id ? 'text-blue-700/70' : 'text-slate-500'}`}>
                  
                    {order.id}
                  </div>
                  <div
                  className={`text-xs flex items-center gap-1 ${selectedOrderId === order.id ? 'text-blue-700/60' : 'text-slate-400'}`}>
                  
                    <Clock className="w-3.5 h-3.5" /> 发货: {order.date}
                  </div>
                </div>
              )}
		              {!loading && visibleQueueItems.length === 0 &&
		              <div className="py-10 text-center text-sm text-slate-400">
		                {activeTab === 'wecom_mail' ?
		                enabledWecomMailboxes.length > 0 ?
		                  '当前企业微信邮箱暂无订货单' :
		                  '暂无可用企业微信邮箱，请先在邮箱管理启用通道' :
		                '暂无匹配订单'}
		              </div>
		              }
	              {visibleQueueItems.length > 0 &&
	              <div className="py-3 text-center text-xs text-slate-400">
	                {loadingMoreOrders &&
	                <span className="inline-flex items-center justify-center gap-2">
	                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> 正在加载更多
	                </span>
	                }
	                {!loadingMoreOrders && hasMoreOrders && `已显示 ${loadedOrderCount} / ${queue?.total ?? loadedOrderCount}，继续下滑加载更多`}
	                {!loadingMoreOrders && !hasMoreOrders && `已加载全部 ${queue?.total ?? loadedOrderCount} 条`}
	              </div>
	              }
	            </div>

		            <div className="p-4 border-t border-slate-100 bg-slate-50/30">
		              <div className="flex gap-3">
		                <button
		                  onClick={() => void handleRefreshOrders()}
		                  disabled={syncingWecomOrders}
		                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-blue-50 text-blue-700 rounded-full text-sm font-medium hover:bg-blue-100 transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-60">
		                  {syncingWecomOrders ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />} 刷新
		                </button>
                <button
                  onClick={() => orderUploadInputRef.current?.click()}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-blue-50 text-blue-700 rounded-full text-sm font-medium hover:bg-blue-100 transition-all active:scale-95">
                  <Upload className="w-4 h-4" /> 上传
                </button>
              </div>
            </div>
          </div>

          {/* CENTER: Order Comparison */}
          <div className="flex-1 flex min-h-0 min-w-[860px] flex-col bg-slate-50/30">
            {/* Compact Summary */}
            <div className="mx-5 mt-4 mb-3 px-4 py-2.5 bg-white rounded-2xl elevation-1 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm shrink-0">
              <div className="flex items-center gap-2 whitespace-nowrap">
                <span className="text-slate-400">客户:</span>
                <span className="font-medium text-slate-800">
                  {orderDetails.customer}
                </span>
              </div>
              <div className="flex items-center gap-2 whitespace-nowrap">
                <span className="text-slate-400">订单号:</span>
                <span className="font-mono text-slate-800">
                  {orderDetails.orderId}
                </span>
              </div>
              <div className="flex items-center gap-2 whitespace-nowrap">
                <span className="text-slate-400">发货日:</span>
                <span className="text-slate-800">{orderDetails.date}</span>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <div className="flex items-center gap-2 bg-blue-50/50 px-3.5 py-1 rounded-full whitespace-nowrap">
                  <span className="text-slate-500">金额:</span>
                  <span className="font-semibold text-blue-700">
                    {orderDetails.amount}
                  </span>
                </div>
                <button
                  onClick={() => setActiveModal('original')}
                  disabled={!selectedOrder?.id}
                  className="h-8 px-3 text-xs font-medium text-blue-700 bg-blue-50 rounded-full hover:bg-blue-100 transition-all active:scale-95 flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed">
                  <FileText className="w-3.5 h-3.5" /> 查看原单
                </button>
                {selectedOrder?.generated &&
                  <button
                    onClick={() => setActiveModal('preview')}
                    disabled={!selectedOrder?.id || loading}
                    className="h-8 px-3.5 text-xs font-medium text-white bg-gradient-primary rounded-full glow-blue transition-all active:scale-95 flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed">
                    <Eye className="w-3.5 h-3.5" />
                    查看发票
                  </button>
                }
              </div>
            </div>

            {/* Product Table Area */}
	            <div className="flex-1 mx-5 mb-4 bg-white rounded-3xl elevation-1 flex min-h-0 flex-col overflow-hidden">
	              <div className="px-4 py-3 border-b border-slate-50 bg-white shrink-0">
	                <div className="flex flex-wrap items-center gap-3">
	                  <h3 className="font-semibold text-slate-800 whitespace-nowrap">商品明细</h3>
	                  <div className="ml-auto flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
	                    <div className="relative min-w-[180px] flex-1 max-w-[260px]">
	                      <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
	                      <input
	                        value={productSearch}
	                        onChange={(event) => setProductSearch(event.target.value)}
	                        placeholder="筛商品 / SKU / 备注"
	                        className="h-8 w-full rounded-full border border-slate-200 bg-slate-50 pl-8 pr-3 text-xs text-slate-700 outline-none transition-all focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-500/10" />
	                    </div>
	                    <select
	                      value={productCategoryFilter}
	                      onChange={(event) => setProductCategoryFilter(event.target.value)}
	                      className="h-8 rounded-full border border-slate-200 bg-slate-50 px-3 text-xs text-slate-700 outline-none transition-all focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-500/10">
	                      <option value="all">全部类目</option>
	                      {productCategories.map((category) =>
	                      <option key={category} value={category}>{category}</option>
	                      )}
	                    </select>
	                  </div>
	                </div>
	              </div>

              <ScrollArea type="always" scrollbars="both" className="min-h-0 min-w-0 flex-1">
                <Table containerClassName="overflow-visible" className="min-w-[980px] text-sm text-left whitespace-nowrap">
                  <TableHeader className="text-xs text-slate-600 [&_th]:sticky [&_th]:top-0 [&_th]:z-30 [&_th]:bg-slate-50 [&_th]:shadow-[0_1px_0_rgba(148,163,184,0.25)]">
                    <TableRow>
                      <TableHead className="px-4 py-2.5 font-medium">序号</TableHead>
                      <TableHead className="px-4 py-2.5 font-medium">商品编码</TableHead>
                      <TableHead className="px-4 py-2.5 font-medium">商品名称</TableHead>
                      <TableHead className="px-4 py-2.5 font-medium">类目</TableHead>
                      <TableHead className="px-4 py-2.5 font-medium">规格</TableHead>
                      <TableHead className="px-4 py-2.5 font-medium">单位</TableHead>
                      <TableHead className="px-4 py-2.5 font-medium text-right">
                        订货数量
                      </TableHead>
                      <TableHead className="px-4 py-2.5 font-medium text-right">
                        订单单价
                      </TableHead>
                      <TableHead className="px-4 py-2.5 font-medium text-right">
                        系统单价
                      </TableHead>
                      <TableHead className="px-4 py-2.5 font-medium text-right">
                        小计金额
                      </TableHead>
                      <TableHead className="px-4 py-2.5 font-medium">备注</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="divide-y divide-slate-50">
	                    {productRows.map((p, idx: number) =>
	                    <TableRow
                      key={p.id}
                      className={`
                        hover:bg-blue-50/30 transition-colors
                      `}>
                      
                        <TableCell className="px-4 py-2.5 text-slate-500">
                          {((productMeta?.page ?? 1) - 1) * (productMeta?.pageSize ?? 8) + idx + 1}
                        </TableCell>
                        <TableCell className="px-4 py-2.5 font-mono text-slate-600">
                          {p.id}
                        </TableCell>
                        <TableCell className="px-4 py-2.5 font-medium text-slate-800">
                          {p.name}
                        </TableCell>
                        <TableCell className="px-4 py-2.5 text-slate-600">
                          {p.category}
                        </TableCell>
                        <TableCell className="px-4 py-2.5 text-slate-600">{p.spec}</TableCell>
                        <TableCell className="px-4 py-2.5 text-slate-600">{p.unit}</TableCell>
                        <TableCell className="px-4 py-2.5 text-right font-medium text-slate-800">
                          {p.orderQty}
                        </TableCell>
                        <TableCell className="px-4 py-2.5 text-right text-slate-600">
                          ¥{p.orderPrice}
                        </TableCell>
                        <TableCell
                        className={`px-4 py-2.5 text-right ${p.orderPrice !== p.sysPrice ? 'text-amber-600 font-medium' : 'text-slate-600'}`}>
                        
                          ¥{p.sysPrice}
                        </TableCell>
                        <TableCell className="px-4 py-2.5 text-right font-medium text-slate-800">
                          ¥{p.subtotal}
                        </TableCell>
                        <TableCell
                        className="px-4 py-2.5 text-slate-500 text-xs max-w-[150px] truncate"
                        title={p.remark}>
                        
                          {p.remark}
                        </TableCell>
	                      </TableRow>
	                    )}
	                    {productRows.length === 0 &&
	                    <TableRow>
	                      <TableCell colSpan={11} className="px-4 py-10 text-center text-sm text-slate-400">
	                        暂无匹配商品
	                      </TableCell>
	                    </TableRow>
	                    }
	                  </TableBody>
                </Table>
              </ScrollArea>

              <div className="px-4 py-2.5 border-t border-slate-50 bg-white flex items-center justify-between shrink-0">
                <div className="text-xs text-slate-500 px-2">
                  显示 {productRows.length > 0 ? ((productMeta?.page ?? 1) - 1) * (productMeta?.pageSize ?? 8) + 1 : 0}-
                  {((productMeta?.page ?? 1) - 1) * (productMeta?.pageSize ?? 8) + productRows.length} / 共 {productMeta?.total ?? 0} 条
                </div>
	                {(productMeta?.totalPages ?? 1) > 1 &&
	                <Pagination className="mx-0 w-auto justify-end">
                  <PaginationContent className="gap-1 text-xs">
                    <PaginationItem>
                      <PaginationLink
                        href="#"
                        aria-label="上一页"
                        onClick={(event) => {
                          event.preventDefault();
                          setProductPage((page) => Math.max(1, page - 1));
                        }}
                        className="size-8 rounded-full border-transparent text-slate-500 hover:bg-slate-100">
                        
                        <ChevronLeft className="w-4 h-4" />
                      </PaginationLink>
                    </PaginationItem>
                    <PaginationItem>
                      <PaginationLink
                        href="#"
                        isActive={(productMeta?.page ?? 1) === 1}
                        onClick={(event) => {
                          event.preventDefault();
                          setProductPage(1);
                        }}
                        className="size-8 rounded-full border-blue-600 bg-blue-600 text-white shadow-sm hover:bg-blue-600 hover:text-white">
                        
                        1
                      </PaginationLink>
                    </PaginationItem>
                    <PaginationItem>
                      {(productMeta?.totalPages ?? 1) >= 2 &&
                      <PaginationLink
                        href="#"
                        isActive={(productMeta?.page ?? 1) === 2}
                        onClick={(event) => {
                          event.preventDefault();
                          setProductPage(2);
                        }}
                        className="size-8 rounded-full border-transparent text-slate-600 hover:bg-slate-100">
                        
                        2
                      </PaginationLink>
                      }
                    </PaginationItem>
                    <PaginationItem>
                      {(productMeta?.totalPages ?? 1) >= 3 &&
                      <PaginationLink
                        href="#"
                        isActive={(productMeta?.page ?? 1) === 3}
                        onClick={(event) => {
                          event.preventDefault();
                          setProductPage(3);
                        }}
                        className="size-8 rounded-full border-transparent text-slate-600 hover:bg-slate-100">
                        
                        3
                      </PaginationLink>
                      }
                    </PaginationItem>
                    <PaginationItem>
                      <PaginationLink
                        href="#"
                        aria-label="下一页"
                        onClick={(event) => {
                          event.preventDefault();
                          setProductPage((page) => Math.min(productMeta?.totalPages ?? 1, page + 1));
                        }}
                        className="size-8 rounded-full border-transparent text-slate-500 hover:bg-slate-100">
                        
                        <ChevronRight className="w-4 h-4" />
                      </PaginationLink>
                    </PaginationItem>
                  </PaginationContent>
	                </Pagination>
	                }
              </div>
            </div>

          </div>

          {/* RIGHT: Shipment Summary */}
          <div className="flex w-[320px] border-l border-slate-100 min-h-0 flex-col bg-white shrink-0 z-10">
            <div className="min-h-0 flex-1 overflow-y-auto p-4 pb-24 space-y-4 bg-slate-50/30">
              {/* Shipment Action Card */}
              <div className="bg-white rounded-3xl p-5 elevation-1">
                <div className="space-y-3 text-sm mb-5">
                  <div className="flex justify-between">
                    <span className="text-slate-400">客户</span>
                    <span className="text-slate-800 truncate max-w-[140px]">
                      {orderDetails.customer}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">订单号</span>
                    <span className="text-slate-800 font-mono">
                      {orderDetails.orderId}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">发货日</span>
                    <span className="text-slate-800">{orderDetails.date}</span>
                  </div>
                  <div className="flex justify-between pt-3 border-t border-slate-50">
                    <span className="text-slate-400">金额</span>
                    <span className="text-blue-700 font-semibold">
                      {orderDetails.amount}
                    </span>
                  </div>
                </div>
                <button
                  onClick={handleOpenInvoiceDraft}
                  disabled={!selectedOrder?.id}
                  className="mb-3 flex w-full items-center justify-center gap-1.5 rounded-full bg-blue-600 py-2.5 text-sm font-medium text-white shadow-sm shadow-blue-200 transition-all hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
                  <FileDown className="w-4 h-4" /> 生成发票
                </button>
                <div className="flex gap-3">
                  <button
                    onClick={() => setActiveModal('preview')}
                    disabled={!selectedOrder?.generated}
                    title={selectedOrder?.generated ? "预览商业发票" : "请先点击「生成发票」"}
                    className="flex-1 py-2 bg-blue-50 text-blue-700 rounded-full text-sm font-medium enabled:hover:bg-blue-100 transition-all flex items-center justify-center gap-1.5 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed">

                    <Eye className="w-4 h-4" /> 预览
                  </button>
                  <button
                    onClick={handleExportInvoice}
	                    disabled={!selectedOrder?.generated}
	                    className="flex-1 py-2 bg-gradient-primary text-white rounded-full text-sm font-medium glow-blue transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed">
                    <Download className="w-4 h-4" /> 导出
                  </button>
                </div>
              </div>

              {/* Template Card */}
              <div className="bg-white rounded-3xl p-5 elevation-1">
                <div className="flex justify-between items-center gap-3 mb-4">
                  <h3 className="text-sm font-medium text-slate-800 flex items-center gap-2">
                    <Layers className="w-4.5 h-4.5 text-indigo-500" /> 发票模板
                  </h3>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setActiveModal('aiTemplate')}
                      className="px-2.5 py-1.5 bg-gradient-to-br from-violet-50 to-blue-50 text-violet-700 border border-violet-100 rounded-full text-xs font-medium hover:bg-violet-100/50 transition-colors flex items-center justify-center gap-1">
                      
                      <Sparkles className="w-3.5 h-3.5" /> AI 模板
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5 mb-4">
                  {selectableTemplates.map((t) =>
                  <div
                    key={t.id}
                    onClick={() => void handleSelectTemplate(t.id)}
                    className={`p-3 rounded-2xl flex items-center justify-between cursor-pointer transition-colors ${activeTemplate === t.id ? 'bg-blue-50' : 'hover:bg-blue-50/40'}`}>
                    
                      <div className="flex items-center gap-2.5">
                        <FileDown
                        className={`w-4.5 h-4.5 ${activeTemplate === t.id ? 'text-blue-600' : 'text-slate-400'}`} />
                      
                        <span
                        className={`text-sm flex items-center gap-2 ${activeTemplate === t.id ? 'font-medium text-blue-900' : 'text-slate-600'}`}>
                        
                          {t.name}
                          {t.source === 'ai' &&
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-violet-50 text-violet-600 rounded text-[10px] font-medium border border-violet-100">
                              <Sparkles className="w-2.5 h-2.5" /> AI
                            </span>
                        }
                        </span>
                      </div>
                      {activeTemplate === t.id &&
                    <div className="w-2 h-2 rounded-full bg-blue-600"></div>
                    }
                    </div>
                  )}
                </div>
              </div>

            </div>
          </div>
        </div>
      </div>

      {/* MODALS */}
      {activeModal &&
      <div
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onClick={() => {
          if (activeModal === 'aiTemplate') resetAi();
          setActiveModal(null);
        }}>
        
          {/* AI Template Generation Modal */}
          {activeModal === 'aiTemplate' &&
        <div
          className="bg-white rounded-3xl elevation-3 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}>
          
              <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-white">
                <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-violet-500" /> AI 生成模板
                </h2>
                <button
              onClick={() => {
                setActiveModal(null);
                resetAi();
              }}
              className="w-9 h-9 flex items-center justify-center text-slate-400 hover:bg-slate-100 rounded-full transition-colors">
              
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 bg-slate-50/30 space-y-6">
                {aiPhase === 'idle' &&
            <div className="relative bg-gradient-to-br from-violet-50 via-blue-50 to-indigo-50 border border-violet-100 rounded-3xl p-8 overflow-hidden text-center">
                    <div className="absolute -right-8 -top-8 w-32 h-32 bg-violet-200/30 rounded-full blur-3xl pointer-events-none"></div>
                    <div className="absolute -left-8 -bottom-8 w-32 h-32 bg-blue-200/30 rounded-full blur-3xl pointer-events-none"></div>

                    <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center shadow-lg shadow-violet-500/20 mb-6 relative z-10">
                      <Sparkles className="w-8 h-8 text-white" />
                    </div>

                    <h3 className="text-xl font-semibold text-slate-800 mb-3 relative z-10">
                      上传参考发票
                    </h3>
                    <p className="text-sm text-slate-600 leading-relaxed mb-8 max-w-md mx-auto relative z-10">
	                      上传客户提供的发票样式图片或 PDF，系统会提取可用字段并生成一个可复核的模板草稿。
                    </p>

                    <div className="flex items-center justify-center gap-4 relative z-10">
                      <button
                  onClick={() => aiTemplateInputRef.current?.click()}
                  className="px-6 py-3 bg-gradient-to-br from-violet-500 to-blue-600 text-white rounded-full text-sm font-medium shadow-md hover:shadow-lg transition-all flex items-center gap-2">
                  
                        <Upload className="w-4 h-4" /> 选择文件并生成
                      </button>
                    </div>
                    <p className="text-xs text-slate-400 mt-4 relative z-10">
                      支持 JPG · PNG · PDF，最大 10MB
                    </p>
                  </div>
            }

                {(aiPhase === 'uploading' ||
            aiPhase === 'analyzing' ||
            aiPhase === 'generating') &&
            <div className="bg-white border border-violet-100 rounded-3xl p-8 elevation-1 text-center">
                    <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center shadow-lg shadow-violet-500/20 mb-6">
                      <Loader2 className="w-8 h-8 text-white animate-spin" />
                    </div>

                    <h3 className="text-lg font-semibold text-slate-800 mb-2">
                      {aiPhase === 'uploading' && '正在上传参考文件...'}
	                      {aiPhase === 'analyzing' && '正在提取模板字段...'}
	                      {aiPhase === 'generating' && '正在生成模板草稿...'}
                    </h3>
                    <p className="text-sm text-slate-500 mb-8">
	                      {aiPhase === 'uploading' && '即将开始文件解析'}
	                      {aiPhase === 'analyzing' &&
	                '提取表头、订单号、客户和金额等字段'}
                      {aiPhase === 'generating' && '这可能需要几秒钟时间'}
                    </p>

                    <div className="max-w-sm mx-auto space-y-3">
                      {aiFiles.map((f, i) =>
                <div
                  key={i}
                  className="flex items-center gap-3 p-3 bg-slate-50 rounded-2xl text-left">
                  
                          <FileText className="w-5 h-5 text-slate-400 shrink-0" />
                          <span className="text-sm text-slate-700 flex-1 truncate">
                            {f.name}
                          </span>
                          <span className="text-xs text-slate-400">
                            {f.size}
                          </span>
                        </div>
                )}
                    </div>

                    <div className="max-w-sm mx-auto mt-8 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                  className={`h-full bg-gradient-to-r from-violet-500 to-blue-600 rounded-full transition-all duration-1000 ease-out
                          ${aiPhase === 'uploading' ? 'w-1/4' : ''}
                          ${aiPhase === 'analyzing' ? 'w-2/4' : ''}
                          ${aiPhase === 'generating' ? 'w-4/5' : ''}
                        `}>
                </div>
                    </div>
                  </div>
            }

                {aiPhase === 'done' &&
            <div className="space-y-6">
                    <div className="bg-emerald-50 border border-emerald-100 rounded-3xl p-5 flex items-start gap-4">
                      <div className="w-10 h-10 rounded-2xl bg-emerald-100 flex items-center justify-center shrink-0">
                        <CheckCircle className="w-5 h-5 text-emerald-600" />
                      </div>
                      <div>
                        <h3 className="text-base font-semibold text-emerald-900 mb-1">
                          模板生成成功！
                        </h3>
                        <p className="text-sm text-emerald-700/80">
                          AI
                          已成功解析参考文件，并生成了对应的高保真模板。您可以保存并在预览中使用它。
                        </p>
                      </div>
                    </div>

                    <div className="bg-white border border-slate-200 rounded-3xl p-6 elevation-1">
                      <h4 className="text-sm font-medium text-slate-800 mb-4">
                        模板预览
                      </h4>
                      <div className="aspect-[1/1.4] w-full max-w-sm mx-auto bg-slate-50 border border-slate-200 rounded-xl overflow-hidden relative shadow-sm">
                        {/* Placeholder for generated template thumbnail */}
                        <div className="absolute inset-0 p-6 flex flex-col">
                          <div className="w-1/3 h-6 bg-violet-200 rounded mb-8"></div>
                          <div className="flex justify-between mb-8">
                            <div className="w-1/4 h-16 bg-slate-200 rounded"></div>
                            <div className="w-1/4 h-16 bg-slate-200 rounded"></div>
                          </div>
                          <div className="w-full h-4 bg-slate-200 rounded mb-2"></div>
                          <div className="w-full h-4 bg-slate-200 rounded mb-2"></div>
                          <div className="w-full h-4 bg-slate-200 rounded mb-8"></div>
                          <div className="w-full flex-1 bg-slate-100 rounded border border-slate-200"></div>
                        </div>
                      </div>
                    </div>
                  </div>
            }
              </div>

              {aiPhase === 'done' &&
          <div className="px-6 py-4 border-t border-slate-100 bg-white flex justify-end gap-3">
                  <button
              onClick={resetAi}
              className="px-5 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-full hover:bg-slate-200 transition-all">
              
                    重新生成
                  </button>
                  <button
              onClick={() => void saveAiTemplate()}
              className="px-6 py-2 text-sm font-medium text-white bg-gradient-to-br from-violet-500 to-blue-600 rounded-full shadow-md shadow-violet-500/20 hover:shadow-lg transition-all flex items-center gap-1.5">
              
                    <Check className="w-4 h-4" /> 保存并应用新模板
                  </button>
                </div>
          }
            </div>
        }

          {/* Invoice Draft Modal */}
          {activeModal === 'invoiceDraft' &&
        <div
          className="bg-white rounded-3xl elevation-3 w-full max-w-6xl max-h-[calc(100vh-4rem)] flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}>
          
              <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-white">
                <div>
                  <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
                    <FileDown className="w-5 h-5 text-blue-500" /> 生成发票
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    当前模板：{activeTemplateName}，保存后可在“查看发票”中看到最新内容。
                  </p>
                </div>
                <button
              onClick={() => setActiveModal(null)}
              disabled={invoiceSubmitting}
              className="w-9 h-9 flex items-center justify-center text-slate-400 hover:bg-slate-100 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50">
              
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/60 p-6 pb-10">
                <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
                  <div className="min-w-0 overflow-hidden rounded-3xl border border-slate-100 bg-white elevation-1">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-800">发票商品明细</h3>
                        <p className="mt-1 text-xs text-slate-500">
                          {invoiceDraftInfo.customer || '-'} · {invoiceDraftInfo.orderId || '-'}
                        </p>
                      </div>
                      <div className="rounded-full bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-700">
                        {invoiceDraftAmountText}
                      </div>
                    </div>
                    <ScrollArea type="always" scrollbars="both" className="max-h-[calc(100vh-340px)] min-h-[280px] min-w-0 pb-3">
                      <Table containerClassName="overflow-visible" className="min-w-[820px] text-sm whitespace-nowrap">
                        <TableHeader className="bg-slate-50 text-xs text-slate-600">
                          <TableRow>
                            <TableHead className="px-4 py-3 font-medium">商品编码</TableHead>
                            <TableHead className="px-4 py-3 font-medium">商品名称</TableHead>
                            <TableHead className="px-4 py-3 font-medium">规格</TableHead>
                            <TableHead className="px-4 py-3 font-medium">单位</TableHead>
                            <TableHead className="px-4 py-3 text-right font-medium">数量</TableHead>
                            <TableHead className="px-4 py-3 text-right font-medium">单价</TableHead>
                            <TableHead className="px-4 py-3 text-right font-medium">金额</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody className="divide-y divide-slate-50">
                          {invoiceDraftLines.map((line) => {
                            const lineKey = line.lineId ?? line.id;
                            return (
                              <TableRow key={lineKey} className="hover:bg-blue-50/30">
                                <TableCell className="px-4 py-3 font-mono text-slate-600">{line.id}</TableCell>
                                <TableCell className="px-4 py-3 font-medium text-slate-800">{line.name}</TableCell>
                                <TableCell className="px-4 py-3 text-slate-600">{line.spec}</TableCell>
                                <TableCell className="px-4 py-3 text-slate-600">{line.unit}</TableCell>
                                <TableCell className="px-4 py-3 text-right">
                                  <input
                                    type="number"
                                    min={1}
                                    step={1}
                                    value={line.quantityText}
                                    onChange={(event) => handleInvoiceDraftLineChange(lineKey, 'quantity', event.target.value)}
                                    className="h-8 w-24 rounded-full border border-slate-200 bg-slate-50 px-3 text-right text-sm font-medium text-slate-800 outline-none transition-all focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-500/10" />
                                </TableCell>
                                <TableCell className="px-4 py-3 text-right">
                                  <input
                                    type="number"
                                    min={0}
                                    step="0.01"
                                    value={line.unitPriceText}
                                    onChange={(event) => handleInvoiceDraftLineChange(lineKey, 'unitPrice', event.target.value)}
                                    className="h-8 w-28 rounded-full border border-slate-200 bg-slate-50 px-3 text-right text-sm font-medium text-slate-800 outline-none transition-all focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-500/10" />
                                </TableCell>
                                <TableCell className="px-4 py-3 text-right font-semibold text-slate-800">
                                  {formatInvoiceMoney(line.subtotal)}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                  </div>

                  <div
                    className={`rounded-3xl border p-5 elevation-1 ${
                      activeTemplate === 'inogi' ?
                        'border-[#0a2342] bg-[#0a2342] text-white' :
                        activeTemplate.startsWith('ai-') ?
                          'border-violet-100 bg-white text-slate-800' :
                          'border-slate-100 bg-white text-slate-800'
                    }`}>
                    <div className="mb-5 flex items-start justify-between gap-3">
                      <div>
                        <div className={`text-xs font-semibold uppercase tracking-[0.2em] ${activeTemplate === 'inogi' ? 'text-white/70' : 'text-slate-400'}`}>
                          Invoice Template
                        </div>
                        <div className="mt-2 text-xl font-black">
                          {activeTemplate === 'weoxy' ? 'WEOXY.CO' : activeTemplate === 'inogi' ? 'INOGI' : activeTemplateName}
                        </div>
                      </div>
                      <div className={`rounded-full px-3 py-1 text-xs font-medium ${activeTemplate === 'inogi' ? 'bg-white/10 text-white' : 'bg-blue-50 text-blue-700'}`}>
                        {activeTemplateName}
                      </div>
                    </div>

                    <div className={`space-y-2 rounded-2xl p-4 text-sm ${activeTemplate === 'inogi' ? 'bg-white/10' : 'bg-slate-50'}`}>
                      <div className="flex justify-between gap-3">
                        <span className={activeTemplate === 'inogi' ? 'text-white/60' : 'text-slate-400'}>客户</span>
                        <input
                          value={invoiceDraftInfo.customer}
                          onChange={(event) => handleInvoiceDraftInfoChange('customer', event.target.value)}
                          className={`min-w-0 flex-1 rounded-lg bg-transparent px-2 py-0.5 text-right font-medium outline-none transition-colors focus:ring-2 ${
                            activeTemplate === 'inogi' ? 'text-white focus:bg-white/10 focus:ring-white/20' : 'text-slate-800 focus:bg-white focus:ring-blue-500/10'
                          }`} />
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className={activeTemplate === 'inogi' ? 'text-white/60' : 'text-slate-400'}>订单号</span>
                        <input
                          value={invoiceDraftInfo.orderId}
                          onChange={(event) => handleInvoiceDraftInfoChange('orderId', event.target.value)}
                          className={`min-w-0 flex-1 rounded-lg bg-transparent px-2 py-0.5 text-right font-mono outline-none transition-colors focus:ring-2 ${
                            activeTemplate === 'inogi' ? 'text-white focus:bg-white/10 focus:ring-white/20' : 'text-slate-800 focus:bg-white focus:ring-blue-500/10'
                          }`} />
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className={activeTemplate === 'inogi' ? 'text-white/60' : 'text-slate-400'}>发货日</span>
                        <input
                          value={invoiceDraftInfo.date}
                          onChange={(event) => handleInvoiceDraftInfoChange('date', event.target.value)}
                          className={`min-w-0 flex-1 rounded-lg bg-transparent px-2 py-0.5 text-right outline-none transition-colors focus:ring-2 ${
                            activeTemplate === 'inogi' ? 'text-white focus:bg-white/10 focus:ring-white/20' : 'text-slate-800 focus:bg-white focus:ring-blue-500/10'
                          }`} />
                      </div>
                    </div>

                    <div className={`mt-4 overflow-hidden rounded-2xl border ${activeTemplate === 'inogi' ? 'border-white/20' : 'border-slate-100'}`}>
                      <div className={`grid grid-cols-[minmax(0,1fr)_64px_104px] gap-2 px-3 py-2 text-xs font-semibold ${activeTemplate === 'inogi' ? 'bg-white/10 text-white/80' : 'bg-slate-50 text-slate-500'}`}>
                        <span>商品</span>
                        <span className="text-right">数量</span>
                        <span className="text-right">金额</span>
                      </div>
                      <div className="max-h-[270px] overflow-y-auto">
                        {invoiceDraftLines.map((line) => {
                          const lineKey = line.lineId ?? line.id;
                          return (
                            <div
                              key={lineKey}
                              className={`grid grid-cols-[minmax(0,1fr)_64px_104px] gap-2 border-t px-3 py-2 text-xs ${activeTemplate === 'inogi' ? 'border-white/10' : 'border-slate-100'}`}>
                              <input
                                value={line.name}
                                onChange={(event) => handleInvoiceDraftLineTextChange(lineKey, 'name', event.target.value)}
                                className={`min-w-0 truncate rounded-md bg-transparent px-1 py-0.5 font-medium outline-none transition-colors focus:ring-2 ${
                                  activeTemplate === 'inogi' ? 'text-white focus:bg-white/10 focus:ring-white/20' : 'text-slate-800 focus:bg-white focus:ring-blue-500/10'
                                }`} />
                              <input
                                type="number"
                                min={1}
                                step={1}
                                value={line.quantityText}
                                onChange={(event) => handleInvoiceDraftLineChange(lineKey, 'quantity', event.target.value)}
                                className={`min-w-0 rounded-md bg-transparent px-1 py-0.5 text-right outline-none transition-colors focus:ring-2 ${
                                  activeTemplate === 'inogi' ? 'text-white focus:bg-white/10 focus:ring-white/20' : 'text-slate-800 focus:bg-white focus:ring-blue-500/10'
                                }`} />
                              <div className="flex min-w-0 items-center justify-end gap-0.5 font-semibold">
                                <span className={activeTemplate === 'inogi' ? 'text-white/70' : 'text-slate-400'}>¥</span>
                                <input
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  value={line.subtotalText}
                                  onChange={(event) => handleInvoiceDraftLineAmountChange(lineKey, event.target.value)}
                                  className={`w-20 rounded-md bg-transparent px-1 py-0.5 text-right font-semibold outline-none transition-colors focus:ring-2 ${
                                    activeTemplate === 'inogi' ? 'text-white focus:bg-white/10 focus:ring-white/20' : 'text-slate-800 focus:bg-white focus:ring-blue-500/10'
                                  }`} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <div className={`mt-5 flex items-center justify-between border-t pt-4 text-base font-bold ${activeTemplate === 'inogi' ? 'border-white/20' : 'border-slate-100'}`}>
                      <span>合计</span>
                      <span>{invoiceDraftAmountText}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-100 bg-white px-6 pt-4 pb-[calc(1.75rem+env(safe-area-inset-bottom))] flex justify-end">
                <div className="flex gap-3 lg:mr-44">
                  <button
              onClick={() => setActiveModal(null)}
              disabled={invoiceSubmitting}
              className="px-5 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-full hover:bg-slate-200 transition-all disabled:cursor-not-allowed disabled:opacity-50">
              
                    取消
                  </button>
                  <button
              onClick={() => void handleConfirmGenerateInvoice()}
              disabled={invoiceSubmitting || invoiceDraftLines.length === 0}
              className="px-6 py-2 text-sm font-medium text-white bg-gradient-primary rounded-full shadow-md shadow-blue-500/20 hover:shadow-lg transition-all flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-50">
              
                    {invoiceSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    保存并生成发票
                  </button>
                </div>
              </div>
            </div>
        }

          {/* Original Order Modal */}
          {activeModal === 'original' &&
        <div
          className="bg-white rounded-3xl elevation-3 w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}>
          
              <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-white">
                <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
                  <FileText className="w-5 h-5 text-blue-500" /> 原始订货单
                </h2>
                <button
              onClick={() => setActiveModal(null)}
              className="w-9 h-9 flex items-center justify-center text-slate-400 hover:bg-slate-100 rounded-full transition-colors">
              
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 overflow-y-auto bg-slate-50/50 flex-1 flex justify-center">
                <div className="bg-white p-8 shadow-sm border border-slate-200 w-full max-w-2xl min-h-[500px] rounded-xl">
                  <div className="text-center mb-8">
                    <h1 className="text-2xl font-bold text-slate-800 mb-2">
                      PURCHASE ORDER
                    </h1>
	                    <p className="text-slate-500">{orderDetails.customer || '未识别客户'}</p>
                  </div>
                  <div className="flex justify-between mb-8 text-sm">
                    <div>
                      <p>
                        <span className="text-slate-500 w-16 inline-block">
                          PO No:
                        </span>{' '}
                        {orderDetails.orderId}
                      </p>
                      <p>
                        <span className="text-slate-500 w-16 inline-block">
                          Date:
                        </span>{' '}
	                        {selectedOrder?.createdAt ? selectedOrder.createdAt.slice(0, 10) : orderDetails.date || '-'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p>
                        <span className="text-slate-500">Ship Date:</span>{' '}
                        {orderDetails.date}
                      </p>
                    </div>
                  </div>
                  <Table className="w-full text-sm mb-8">
                    <TableHeader className="border-b-2 border-slate-800">
                      <TableRow>
                        <TableHead className="py-2 text-left">Item</TableHead>
                        <TableHead className="py-2 text-left">Description</TableHead>
                        <TableHead className="py-2 text-right">Qty</TableHead>
                        <TableHead className="py-2 text-right">Unit Price</TableHead>
                        <TableHead className="py-2 text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody className="divide-y divide-slate-100">
                      {orderDetails.products.map((p: any) =>
                  <TableRow key={p.id}>
                          <TableCell className="py-2">{p.id}</TableCell>
                          <TableCell className="py-2">{p.name}</TableCell>
                          <TableCell className="py-2 text-right">{p.orderQty}</TableCell>
                          <TableCell className="py-2 text-right">¥{p.orderPrice}</TableCell>
                          <TableCell className="py-2 text-right">
                            {formatInvoiceMoney(p.orderQty * parseMoney(p.orderPrice))}
                          </TableCell>
                        </TableRow>
                  )}
                    </TableBody>
                    <TableFooter className="border-t-2 border-slate-800 font-bold">
                      <TableRow>
                        <TableCell colSpan={4} className="py-2 text-right">
                          Total:
                        </TableCell>
                        <TableCell className="py-2 text-right">
                          {formatInvoiceMoney(originalOrderAmountText)}
                        </TableCell>
                      </TableRow>
                    </TableFooter>
                  </Table>
                </div>
              </div>
            </div>
        }

          {/* Shipment Preview Modal */}
          {activeModal === 'preview' &&
        <div
          className="bg-white rounded-3xl elevation-3 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}>
          
              <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-white">
                <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
                  <Eye className="w-5 h-5 text-blue-500" /> 商业发票预览
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">
                    {invoicePreviewTemplateName}
                  </span>
                </h2>
                <div className="flex items-center gap-3">
	                  <button
	                    onClick={handleExportInvoice}
	                    disabled={!selectedOrder?.generated}
	                    className="px-5 py-2 text-sm font-medium text-white bg-gradient-primary rounded-full glow-blue transition-all flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed">
	                    <Download className="w-4 h-4" /> 导出 PDF
                  </button>
                  <button
                onClick={() => setActiveModal(null)}
                className="w-9 h-9 flex items-center justify-center text-slate-400 hover:bg-slate-100 rounded-full transition-colors">
                
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>
              <div className="p-6 overflow-y-auto bg-slate-100/60 flex-1 flex justify-center">
                {/* TEMPLATE A: WEOXY (Standard) */}
                {invoicePreviewTemplate === 'weoxy' &&
            <div className="bg-white p-10 elevation-1 w-full max-w-3xl relative overflow-hidden font-sans text-[#0a2342]">
                    <div className="flex justify-between items-start mb-12">
                      <h1 className="text-5xl font-black tracking-tight text-[#0a2342]">
                        WEOXY.CO
                      </h1>
                      <div className="text-right">
                        <h2 className="text-2xl font-black tracking-wide text-[#0a2342] mb-1">
                          INVOICE
                        </h2>
                        <p className="text-sm text-[#0a2342]">
                          degang.wang@gmail.com
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-8 mb-10 text-sm">
                      <div className="space-y-4">
                        <div>
                          <h4 className="font-bold mb-1">Seller:</h4>
                          <p>WeOxy Co., LTD.</p>
                        </div>
                        <div>
                          <h4 className="font-bold mb-1">Bill To:</h4>
                          <p>{invoicePreviewInfo.customer}</p>
                          <p>110 Cedar Street, STE 105,</p>
                          <p>Wellesley, MA 02481, U.S.A.</p>
                        </div>
                        <div>
                          <h4 className="font-bold mb-1">Ship To:</h4>
                          <p>Oximedical Inc</p>
                          <p>16680 N 51st Ave Suite 5,</p>
                          <p>Glendale, AZ 85306</p>
                        </div>
                      </div>
                      <div className="text-right space-y-1">
                        <div className="flex justify-end gap-2">
                          <span className="font-bold">Invoice:</span>
	                          <span>#{orderDetails.invoiceNo || '未生成'}</span>
                        </div>
                        <div className="flex justify-end gap-2">
                          <span className="font-bold">Date:</span>
                          <span>{invoicePreviewInfo.date}</span>
                        </div>
                        <div className="flex justify-end gap-2">
                          <span className="font-bold">Purchase Order:</span>
                          <span>{invoicePreviewInfo.orderId}</span>
                        </div>
                        <div className="flex justify-end gap-2">
                          <span className="font-bold">Incoterm:</span>
                          <span>DDP</span>
                        </div>
                        <div className="flex justify-end gap-2 mt-2">
                          <span className="font-bold">Terms:</span>
                          <span>
                            Full Payment Due upon
                            <br />
                            Receipt
                          </span>
                        </div>
                      </div>
                    </div>

                    <Table className="w-full text-sm mb-12">
                      <TableHeader>
                        <TableRow className="border-y-4 border-[#0a2342]">
                          <TableHead className="py-3 text-left font-bold uppercase tracking-wide">
                            DESCRIPTION
                          </TableHead>
                          <TableHead className="py-3 text-right font-bold uppercase tracking-wide">
                            AMOUNT
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {invoicePreviewLines.map((p) =>
                  <TableRow key={p.lineId ?? p.id} className="border-b border-slate-200">
                            <TableCell className="py-4">
                              <div className="font-bold mb-1">
                                {p.name} ({p.spec})
                              </div>
                              <div className="text-slate-600">
                                {p.quantity} {p.unit} × {formatInvoiceMoney(p.unitPrice)}
                              </div>
                            </TableCell>
                            <TableCell className="py-4 text-right font-medium">
                              {formatInvoiceMoney(p.subtotal)}
                            </TableCell>
                          </TableRow>
                  )}
                      </TableBody>
                    </Table>

                    <div className="w-full border-y-4 border-[#0a2342] py-4 mb-12">
                      <div className="flex justify-between text-lg font-bold mb-2">
                        <span>Subtotal</span>
                        <span>{invoicePreviewAmountText}</span>
                      </div>
                      <div className="flex justify-between text-lg font-bold">
                        <span>Total Amount Due (100%)</span>
                        <span>{invoicePreviewAmountText}</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-8 text-sm">
                      <div>
                        <h4 className="font-bold uppercase tracking-wide mb-3">
                          PAYMENT INSTRUCTIONS
                        </h4>
                        <div className="space-y-1">
                          <p>
                            <span className="font-bold">Beneficiary Name:</span>{' '}
                            WEOXY CO LTD
                          </p>
                          <p>
                            <span className="font-bold">
                              Beneficiary Address:
                            </span>{' '}
                            16 S Woodside Ave, Wellesley, MA 02482-2300, USA
                          </p>
                          <p>
                            <span className="font-bold">Bank Name:</span>{' '}
                            Bank of America, N.A.
                          </p>
                          <p>
                            <span className="font-bold">Account Number:</span>{' '}
                            4660 2223 4812
                          </p>
                          <p>
                            <span className="font-bold">SWIFT Code:</span>{' '}
                            BOFAUS3N
                          </p>
                          <p>
                            <span className="font-bold">Bank Address:</span>{' '}
                            P.O. Box 25118, Tampa, FL 33622-5118, USA
                          </p>
                        </div>
                      </div>
                      <div>
                        <h4 className="font-bold uppercase tracking-wide mb-3">
                          Additional Notes
                        </h4>
                        <ul className="list-disc pl-4 space-y-2">
                          <li>
                            Goods were delivered and received by the customer on
                            March 16, 2026.
                          </li>
                        </ul>
                      </div>
                    </div>
                  </div>
            }

                {/* TEMPLATE B: INOGI (Consolidated) */}
                {invoicePreviewTemplate === 'inogi' &&
            <div className="w-full max-w-3xl elevation-1 flex flex-col font-sans">
                    <div className="bg-[#0a2342] text-white p-10 pb-12">
                      <div className="flex justify-between items-start mb-12">
                        <h1 className="text-5xl font-bold tracking-tight">
                          INOGI
                        </h1>
                        <div className="text-right">
                          <h2 className="text-xl font-bold tracking-wide mb-1">
                            INVOICE SERVICE
                          </h2>
                          <p className="text-sm opacity-90">www.inogi.cn</p>
                          <p className="text-sm opacity-90">
                            geshuang@inogi.cn
                          </p>
                        </div>
                      </div>

                      <h2 className="text-3xl font-bold mb-10">
                        Final Consolidated Balance Invoice
                      </h2>

                      <div className="grid grid-cols-2 gap-8 mb-10 text-sm">
                        <div>
                          <h4 className="font-bold text-lg mb-1 uppercase tracking-wide">
                            CLIENT NAME
                          </h4>
                          <p className="font-bold text-base mb-1">
                            {invoicePreviewInfo.customer}
                          </p>
                          <p className="opacity-90">
                            110 Cedar Street, STE 105,
                          </p>
                          <p className="opacity-90">
                            Wellesley, MA 02481, U.S.A.
                          </p>
                          <p className="opacity-90">degang.wang@gmail.com</p>
                        </div>
                        <div className="text-right space-y-1 font-medium">
                          <div className="flex justify-end gap-2">
                            <span>Invoice:</span>
	                            <span>#{orderDetails.invoiceNo || '未生成'}</span>
                          </div>
                          <div className="flex justify-end gap-2">
                            <span>Date:</span>
                            <span>{invoicePreviewInfo.date}</span>
                          </div>
                          <div className="flex justify-end gap-2">
                            <span>Purchase Order:</span>
                            <span>{invoicePreviewInfo.orderId}</span>
                          </div>
                          <div className="flex justify-end gap-2">
                            <span>Incoterm:</span>
                            <span>DDP</span>
                          </div>
                        </div>
                      </div>

                      <Table className="w-full text-base mb-10">
                        <TableHeader>
                          <TableRow className="border-b-4 border-white">
                            <TableHead className="py-3 text-left font-bold uppercase tracking-wide">
                              ORIGINAL INVOICE AMOUNT
                            </TableHead>
                            <TableHead className="py-3 text-right font-bold uppercase tracking-wide">
                              AMOUNT
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {invoicePreviewLines.map((p) =>
                    <TableRow key={p.lineId ?? p.id}>
                              <TableCell className="py-3 font-bold">
                                WH-{p.id}-INOGI
                              </TableCell>
                              <TableCell className="py-3 text-right">
                                {formatInvoiceMoney(p.subtotal)}
                              </TableCell>
                            </TableRow>
                    )}
                        </TableBody>
                      </Table>

                      <div className="w-full border-y-4 border-white py-4">
                        <div className="flex justify-between text-xl font-bold mb-2">
                          <span>Total Goods Value:</span>
                          <span>{invoicePreviewAmountText}</span>
                        </div>
                        <div className="flex justify-between text-xl font-bold mb-2">
                          <span>Total Payment Received:</span>
                          <span>¥0.00</span>
                        </div>
                        <div className="flex justify-between text-xl font-bold">
                          <span>Balance Due:</span>
                          <span>{invoicePreviewAmountText}</span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-[#e2e2e2] text-[#0a2342] p-10 pt-8 flex-1">
                      <div className="grid grid-cols-2 gap-8 text-sm mb-16">
                        <div>
                          <h4 className="font-bold uppercase tracking-wide text-base mb-4">
                            PAYMENT INSTRUCTIONS
                          </h4>
                          <div className="space-y-1.5 leading-relaxed">
                            <p>
                              <span className="font-bold">Bank Name:</span>{' '}
                              BANK OF CHINA JIANGSU BRANCH NANJING WENDE ROAD SUB-BRANCH
                            </p>
                            <p>
                              <span className="font-bold">Account Name:</span>{' '}
                              NANJING YINUOJI MEDICAL TECHNOLOGY CO., LTD.
                            </p>
                            <p>
                              <span className="font-bold">
                              Company Address:
                            </span>{' '}
                              4th Floor, Building 8, Phase VI Accelerator, No. 71 Xinghui Road, Jiangbei New District, Nanjing, Jiangsu, China
                            </p>
                            <p>
                              <span className="font-bold">Account Number:</span>{' '}
                              485880964815
                            </p>
                            <p>
                              <span className="font-bold">SWIFT Code:</span>{' '}
                              BKCHCNBJ940
                            </p>
                            <p>
                              <span className="font-bold">Bank Address:</span>{' '}
                              No. 1 Wende East Road, Pukou District, Nanjing, China
                            </p>
                          </div>
                        </div>
                        <div>
                          <h4 className="font-bold uppercase tracking-wide text-base mb-4">
                            ADDITIONAL NOTES
                          </h4>
                          <ul className="list-disc pl-4 space-y-4">
                            <li>
                              This invoice represents the final outstanding
                              balance for the above purchase orders.
                            </li>
                            <li>
	                              Please include Invoice #{orderDetails.invoiceNo || '未生成'} in the wire
                              memo.
                            </li>
                          </ul>
                        </div>
                      </div>
                      <div className="text-right font-bold text-sm">
                        Nanjing Yinuoji Medical Technology Co.,Ltd
                      </div>
                    </div>
                  </div>
            }

                {/* TEMPLATE C: AI GENERATED */}
                {invoicePreviewTemplate.startsWith('ai-') &&
            <div className="bg-white p-10 elevation-1 w-full max-w-3xl relative overflow-hidden font-sans">
                    {/* Decorative header accent */}
                    <div className="absolute top-0 left-0 w-full h-3 bg-gradient-to-r from-violet-500 to-blue-500"></div>

                    <div className="flex justify-between items-start mb-12 mt-4">
                      <div>
                        <div className="w-12 h-12 rounded-xl bg-violet-100 flex items-center justify-center mb-4">
                          <Layers className="w-6 h-6 text-violet-600" />
                        </div>
                        <h1 className="text-3xl font-bold text-slate-800 tracking-tight mb-1">
                          COMMERCIAL INVOICE
                        </h1>
                        <p className="text-sm text-slate-500">
                          Generated by AI Template Engine
                        </p>
                      </div>
                      <div className="text-right bg-slate-50 p-4 rounded-2xl border border-slate-100">
                        <div className="flex justify-end gap-3 mb-2">
                          <span className="text-slate-500">Invoice No:</span>
	                          <span className="font-bold text-slate-800">
	                            #{orderDetails.invoiceNo || '未生成'}
	                          </span>
                        </div>
                        <div className="flex justify-end gap-3 mb-2">
                          <span className="text-slate-500">Date:</span>
                          <span className="font-medium text-slate-800">
                            {invoicePreviewInfo.date}
                          </span>
                        </div>
                        <div className="flex justify-end gap-3">
                          <span className="text-slate-500">PO Number:</span>
                          <span className="font-medium text-slate-800">
                            {invoicePreviewInfo.orderId}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-8 mb-10">
                      <div className="p-5 rounded-2xl bg-violet-50/50 border border-violet-100">
                        <h4 className="text-xs font-bold text-violet-800 uppercase tracking-wider mb-3">
                          Billed To
                        </h4>
                        <p className="font-bold text-slate-800 text-lg mb-1">
                          {invoicePreviewInfo.customer}
                        </p>
                        <p className="text-slate-600 text-sm">
                          110 Cedar Street, STE 105
                        </p>
                        <p className="text-slate-600 text-sm">
                          Wellesley, MA 02481, U.S.A.
                        </p>
                      </div>
                      <div className="p-5 rounded-2xl bg-slate-50 border border-slate-100">
                        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
                          From
                        </h4>
                        <p className="font-bold text-slate-800 text-lg mb-1">
                          Your Company Ltd.
                        </p>
                        <p className="text-slate-600 text-sm">
                          Tech Park, Building A
                        </p>
                        <p className="text-slate-600 text-sm">
                          contact@yourcompany.com
                        </p>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-slate-200 overflow-hidden mb-8">
                      <Table className="w-full text-sm">
                        <TableHeader className="bg-slate-50 border-b border-slate-200">
                          <TableRow>
                            <TableHead className="py-3 px-4 text-left font-semibold text-slate-600">
                              Description
                            </TableHead>
                            <TableHead className="py-3 px-4 text-right font-semibold text-slate-600">
                              Qty
                            </TableHead>
                            <TableHead className="py-3 px-4 text-right font-semibold text-slate-600">
                              Unit Price
                            </TableHead>
                            <TableHead className="py-3 px-4 text-right font-semibold text-slate-600">
                              Total
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody className="divide-y divide-slate-100">
                          {invoicePreviewLines.map((p) =>
                    <TableRow key={p.lineId ?? p.id}>
                              <TableCell className="py-4 px-4">
                                <div className="font-medium text-slate-800">
                                  {p.name}
                                </div>
                                <div className="text-xs text-slate-500 mt-1">
                                  {p.spec}
                                </div>
                              </TableCell>
                              <TableCell className="py-4 px-4 text-right text-slate-600">
                                {p.quantity}
                              </TableCell>
                              <TableCell className="py-4 px-4 text-right text-slate-600">
                                {formatInvoiceMoney(p.unitPrice)}
                              </TableCell>
                              <TableCell className="py-4 px-4 text-right font-medium text-slate-800">
                                {formatInvoiceMoney(p.subtotal)}
                              </TableCell>
                            </TableRow>
                    )}
                        </TableBody>
                      </Table>
                    </div>

                    <div className="flex justify-end mb-12">
                      <div className="w-64">
                        <div className="flex justify-between py-2 text-sm text-slate-600">
                          <span>Subtotal</span>
                          <span>{invoicePreviewAmountText}</span>
                        </div>
                        <div className="flex justify-between py-2 text-sm text-slate-600 border-b border-slate-200">
                          <span>Tax (0%)</span>
                          <span>¥0.00</span>
                        </div>
                        <div className="flex justify-between py-3 text-lg font-bold text-violet-700">
                          <span>Total Due</span>
                          <span>{invoicePreviewAmountText}</span>
                        </div>
                      </div>
                    </div>

                    <div className="text-sm text-slate-500 border-t border-slate-200 pt-6">
                      <p className="font-medium text-slate-700 mb-1">
                        Payment Terms
                      </p>
                      <p>
                        Please pay within 30 days of receiving this invoice.
                        Thank you for your business!
                      </p>
                    </div>
                  </div>
            }
              </div>
            </div>
        }

        </div>
      }
    </div>);

}
