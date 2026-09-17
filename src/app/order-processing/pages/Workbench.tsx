import { Button } from "../../components/ui/button";
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
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
  Inbox,
  RefreshCw,
} from
'lucide-react';
import { StatItem } from '../components/StatItem';
import { StatusBadge } from '../components/StatusBadge';
import { OrderPageHeader } from '../components/HorizonPage';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { cn } from '../../components/ui/utils';
import { AutoTranslatedText } from '../../components/TranslatableText';
import { i18nLocale, useI18n } from '../../lib/i18n';
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
import { Input } from "../../components/ui/input";
import { NativeSelect } from "../../components/ui/native-select";
const ORDER_QUEUE_PAGE_SIZE = 6;
const PRODUCT_TABLE_PAGE_SIZE = 12;

type ActiveModal = 'original' | 'preview' | 'aiTemplate' | 'invoiceDraft' | null;
type AIPhase = 'idle' | 'generating' | 'done';

function WorkbenchDialogSurface({
  open,
  title,
  description,
  busy = false,
  className,
  returnFocusRef,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  description: string;
  busy?: boolean;
  className?: string;
  returnFocusRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !busy) onClose();
      }}>
      <DialogContent
        aria-busy={busy}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (busy) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          const target = returnFocusRef.current;
          if (!target?.isConnected || target.disabled) return;
          event.preventDefault();
          target.focus();
        }}
        className={cn(
          'order-horizon-overlay horizon-portal max-h-[calc(100dvh-2rem)] gap-0 overflow-hidden p-0 pb-[env(safe-area-inset-bottom)] [&>button:last-child]:hidden',
          className,
        )}>
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">{description}</DialogDescription>
        {children}
      </DialogContent>
    </Dialog>
  );
}

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
};

type InvoiceDraftInfo = InvoiceInfo;

const parseMoney = (value: string | number) => {
  const number = Number(String(value).replace(/[¥,\s]/g, ''));
  return Number.isFinite(number) ? number : 0;
};

const formatInvoiceMoney = (value: number) =>
  `¥${value.toLocaleString(i18nLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatDraftNumber = (value: number) => Number.isFinite(value) ? String(value) : '';
const formatDraftMoneyInput = (value: number) => Number.isFinite(value) ? value.toFixed(2).replace(/\.00$/, '') : '';
const roundMoney = (value: number) => Math.round(value * 100) / 100;

const buildInvoiceDraftLines = (products: OrderProduct[]): InvoiceDraftLine[] =>
  products.map((product) => {
    const unitPrice = parseMoney(product.orderPrice || product.sysPrice);
    const subtotal = roundMoney(product.orderQty * unitPrice);
    return {
      id: product.id,
      lineId: product.lineId,
      name: product.name,
      spec: product.spec,
      unit: product.unit,
      quantity: product.orderQty,
      quantityText: formatDraftNumber(product.orderQty),
      unitPrice,
      unitPriceText: formatDraftMoneyInput(unitPrice),
      subtotal,
    };
  });

const buildInvoiceDraftLinesFromInvoice = (lines: InvoiceLine[]): InvoiceDraftLine[] =>
  lines.map((line) => {
    const unitPrice = parseMoney(line.unitPrice);
    const subtotal = roundMoney(line.quantity * unitPrice);
    return {
      id: line.id,
      lineId: line.lineId,
      name: line.name,
      spec: line.spec,
      unit: line.unit,
      quantity: line.quantity,
      quantityText: formatDraftNumber(line.quantity),
      unitPrice,
      unitPriceText: formatDraftMoneyInput(unitPrice),
      subtotal,
    };
  });

const buildInvoiceLinesForDetail = (detail: OrderDetail): InvoiceDraftLine[] =>
  detail.invoiceLines?.length ? buildInvoiceDraftLinesFromInvoice(detail.invoiceLines) : buildInvoiceDraftLines(detail.products ?? []);

const buildInvoiceInfoForDetail = (detail: OrderDetail): InvoiceDraftInfo => ({
  customer: detail.invoiceInfo?.customer || detail.customer || '',
  orderId: detail.invoiceInfo?.orderId || detail.orderId || '',
  date: detail.invoiceInfo?.date || detail.date || ''
});

export function Workbench() {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const orderQueueRef = useRef<HTMLDivElement | null>(null);
  const orderUploadInputRef = useRef<HTMLInputElement | null>(null);
  const aiTemplateInputRef = useRef<HTMLInputElement | null>(null);
  const modalReturnFocusRef = useRef<HTMLButtonElement | null>(null);
  const loadRequestIdRef = useRef(0);
  const mailboxRequestIdRef = useRef(0);
  const uploadLockRef = useRef(false);
  const invoiceSubmitLockRef = useRef(false);
  const invoiceExportLockRef = useRef(false);
  const aiRequestIdRef = useRef(0);
  const [workbench, setWorkbench] = useState<WorkbenchResponse | null>(null);
  const [queueItems, setQueueItems] = useState<OrderSummary[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState(() => searchParams.get('order')?.trim() ?? '');
  const [orderSearch, setOrderSearch] = useState(() => searchParams.get('q') ?? '');
  const [debouncedOrderSearch, setDebouncedOrderSearch] = useState(() => searchParams.get('q')?.trim() ?? '');
  const [productSearch, setProductSearch] = useState('');
  const [productCategoryFilter, setProductCategoryFilter] = useState('all');
  const [orderPage, setOrderPage] = useState(1);
  const [productPage, setProductPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingMoreOrders, setLoadingMoreOrders] = useState(false);
  const [workbenchError, setWorkbenchError] = useState('');
  const [loadingWecomMailboxes, setLoadingWecomMailboxes] = useState(false);
  const [mailboxError, setMailboxError] = useState('');
  const [syncingWecomOrders, setSyncingWecomOrders] = useState(false);
  const [uploadingOrders, setUploadingOrders] = useState(false);
  const [wecomMailboxes, setWecomMailboxes] = useState<MailboxItem[]>([]);
  const [selectedWecomMailboxId, setSelectedWecomMailboxId] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);
  const [invoiceDraftInfo, setInvoiceDraftInfo] = useState<InvoiceDraftInfo>({ customer: '', orderId: '', date: '' });
  const [invoiceDraftLines, setInvoiceDraftLines] = useState<InvoiceDraftLine[]>([]);
  const [invoiceSubmitting, setInvoiceSubmitting] = useState(false);
  const [invoiceExporting, setInvoiceExporting] = useState(false);
  const [invoiceValidationError, setInvoiceValidationError] = useState('');
  const [invoiceInvalidField, setInvoiceInvalidField] = useState('');
  const [activeTab, setActiveTab] = useState<'wecom_mail' | 'upload'>(() =>
    searchParams.get('source') === 'wecom_mail' ? 'wecom_mail' : 'upload',
  );
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

  const closeActiveModal = () => {
    if (activeModal === 'invoiceDraft' && invoiceSubmitting) return;
    if (activeModal === 'preview' && invoiceExporting) return;
    if (activeModal === 'aiTemplate') {
      aiRequestIdRef.current += 1;
      resetAi();
    }
    setActiveModal(null);
  };

  const openModal = (modal: Exclude<ActiveModal, null>, trigger: HTMLButtonElement) => {
    modalReturnFocusRef.current = trigger;
    setActiveModal(modal);
  };

  const enabledWecomMailboxes = useMemo(
    () => wecomMailboxes.filter((mailbox) => mailbox.enabled),
    [wecomMailboxes]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedOrderSearch(orderSearch.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [orderSearch]);

  useEffect(() => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (debouncedOrderSearch) next.set('q', debouncedOrderSearch);
      else next.delete('q');
      if (activeTab === 'wecom_mail') next.set('source', activeTab);
      else next.delete('source');
      if (selectedOrderId) next.set('order', selectedOrderId);
      else next.delete('order');
      return next;
    }, { replace: true });
  }, [activeTab, debouncedOrderSearch, selectedOrderId, setSearchParams]);

  const loadWorkbench = useCallback(async () => {
    const requestId = ++loadRequestIdRef.current;
    const isLoadingMore = orderPage > 1;
    setLoading(!isLoadingMore);
    setLoadingMoreOrders(isLoadingMore);
    setWorkbenchError('');
    try {
      const data = await orderProcessingApi.getWorkbench({
        q: debouncedOrderSearch,
        source: activeTab,
        mailboxId: activeTab === 'wecom_mail' ? selectedWecomMailboxId || undefined : undefined,
        orderId: selectedOrderId || undefined,
        orderPage,
        orderPageSize: ORDER_QUEUE_PAGE_SIZE
      });
      if (requestId !== loadRequestIdRef.current) return;
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
      if (requestId !== loadRequestIdRef.current) return;
      const message = error instanceof Error ? error.message : t('订单工作台加载失败');
      setWorkbenchError(message);
      toast.error(message);
    } finally {
      if (requestId === loadRequestIdRef.current) {
        setLoading(false);
        setLoadingMoreOrders(false);
      }
    }
  }, [activeTab, debouncedOrderSearch, orderPage, selectedOrderId, selectedWecomMailboxId, t]);

  useEffect(() => {
    void loadWorkbench();
  }, [loadWorkbench]);

  const loadMailboxes = useCallback(async () => {
    const requestId = ++mailboxRequestIdRef.current;
    setLoadingWecomMailboxes(true);
    setMailboxError('');
    try {
      const data = await integrationManagementApi.listMailboxes({ page: 1, pageSize: 100 });
      if (requestId !== mailboxRequestIdRef.current) return;
      setWecomMailboxes(data.items);
      const firstEnabled = data.items.find((mailbox) => mailbox.enabled);
      setSelectedWecomMailboxId((current) => current || firstEnabled?.id || '');
    } catch (error) {
      if (requestId !== mailboxRequestIdRef.current) return;
      const message = error instanceof Error ? error.message : t('企业微信邮箱列表加载失败');
      setMailboxError(message);
      toast.error(message);
    } finally {
      if (requestId === mailboxRequestIdRef.current) setLoadingWecomMailboxes(false);
    }
  }, [t]);

  useEffect(() => {
    void loadMailboxes();
    return () => {
      mailboxRequestIdRef.current += 1;
    };
  }, [loadMailboxes]);

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
  const selectedTemplateName = selectableTemplates.find((template) => template.id === activeTemplate)?.name;
  const activeTemplateName = selectedTemplateName ? t(selectedTemplateName.trim()) : t('当前发票模板');
  const rawInvoicePreviewTemplate = orderDetails.invoiceTemplateId || activeTemplate;
  const invoicePreviewTemplate = rawInvoicePreviewTemplate === 'custom' ? fallbackTemplateId : rawInvoicePreviewTemplate;
  const invoicePreviewTemplateName = t((selectableTemplates.find((template) => template.id === invoicePreviewTemplate)?.name ?? activeTemplateName).trim());
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

  const resetOrderQueue = (clearSelection = false) => {
    setQueueItems([]);
    setOrderPage(1);
    if (clearSelection) setSelectedOrderId('');
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
      toast.error(t('请选择要上传的订货单文件'));
      return;
    }
    if (uploadLockRef.current) return;
    uploadLockRef.current = true;
    setUploadingOrders(true);
    try {
      const result = await orderProcessingApi.uploadOrders(files);
      toast.success(result.message);
      resetOrderQueue();
      setProductPage(1);
      if (result.created[0]?.id) setSelectedOrderId(result.created[0].id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('订货单上传失败'));
    } finally {
      uploadLockRef.current = false;
      setUploadingOrders(false);
    }
  };

  const handleRefreshOrders = async () => {
    if (activeTab !== 'wecom_mail') {
      resetOrderQueue();
      if (orderPage === 1) void loadWorkbench();
      return;
    }

    if (!selectedWecomMailboxId) {
      toast.info(t('请先选择企业微信邮箱'));
      return;
    }

    setSyncingWecomOrders(true);
    try {
      const result = await orderProcessingApi.syncWecomMailOrders({ mailboxId: selectedWecomMailboxId, ignoreLastUid: true });
      const skippedReason = result.created.length === 0 ? result.skipped[0]?.reason : '';
      const syncMessage = skippedReason ? t('{message} 原因：{reason}', { message: result.message, reason: skippedReason }) : result.message;
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
      toast.error(error instanceof Error ? error.message : t('企业微信邮箱同步失败'));
    } finally {
      setSyncingWecomOrders(false);
    }
  };

  const handleOpenInvoiceDraft = (event: React.MouseEvent<HTMLButtonElement>) => {
    modalReturnFocusRef.current = event.currentTarget;
    if (!selectedOrder?.id) {
      toast.info(t('请先选择一张订货单'));
      return;
    }
    const lines = buildInvoiceLinesForDetail(orderDetails);
    if (lines.length === 0) {
      toast.error(t('当前订货单没有可生成发票的商品明细'));
      return;
    }
    setInvoiceValidationError('');
    setInvoiceInvalidField('');
    setInvoiceDraftInfo(buildInvoiceInfoForDetail(orderDetails));
    setInvoiceDraftLines(lines);
    setActiveModal('invoiceDraft');
  };

  const handleInvoiceDraftLineChange = (lineId: string, field: 'quantity' | 'unitPrice', value: string) => {
    const number = Number(value);
    if (invoiceInvalidField === `line-${lineId}`) {
      setInvoiceInvalidField('');
      setInvoiceValidationError('');
    }
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
          };
        }
        const unitPrice = Number.isFinite(number) && value !== '' ? Math.max(0, roundMoney(number)) : 0;
        const subtotal = roundMoney(line.quantity * unitPrice);
        return {
          ...line,
          unitPrice,
          unitPriceText: value,
          subtotal,
        };
      })
    );
  };

  const handleInvoiceDraftLineTextChange = (lineId: string, field: 'name' | 'spec' | 'unit', value: string) => {
    if (invoiceInvalidField === `line-${lineId}`) {
      setInvoiceInvalidField('');
      setInvoiceValidationError('');
    }
    setInvoiceDraftLines((lines) =>
      lines.map((line) => (line.lineId ?? line.id) === lineId ? { ...line, [field]: value } : line)
    );
  };

  const handleInvoiceDraftInfoChange = (field: keyof InvoiceDraftInfo, value: string) => {
    setInvoiceDraftInfo((info) => ({ ...info, [field]: value }));
    if (invoiceInvalidField === field) {
      setInvoiceInvalidField('');
      setInvoiceValidationError('');
    }
  };

  const showInvoiceValidationError = (field: string, message: string) => {
    setInvoiceInvalidField(field);
    setInvoiceValidationError(message);
    window.requestAnimationFrame(() => {
      const target = Array.from(document.querySelectorAll<HTMLElement>('[data-invoice-field]'))
        .find((element) => element.dataset.invoiceField === field);
      target?.focus();
    });
  };

  const handleConfirmGenerateInvoice = async () => {
    const orderId = selectedOrder?.id;
    if (!orderId || invoiceSubmitLockRef.current) return;
    if (!invoiceDraftInfo.customer.trim()) {
      showInvoiceValidationError('customer', t('请填写客户名称'));
      return;
    }
    if (!invoiceDraftInfo.orderId.trim()) {
      showInvoiceValidationError('orderId', t('请填写订单号'));
      return;
    }
    if (!invoiceDraftInfo.date.trim()) {
      showInvoiceValidationError('date', t('请填写发货日期'));
      return;
    }
    if (invoiceDraftLines.length === 0) {
      showInvoiceValidationError('lines', t('当前发票没有商品明细'));
      return;
    }
    const invalidLine = invoiceDraftLines.find((line) =>
      !line.name.trim() ||
      line.quantityText.trim() === '' ||
      line.unitPriceText.trim() === '' ||
      line.quantity <= 0 ||
      line.unitPrice < 0 ||
      !Number.isFinite(line.quantity) ||
      !Number.isFinite(line.unitPrice) ||
      Math.abs(line.subtotal - roundMoney(line.quantity * line.unitPrice)) > 0.009
    );
    if (invalidLine) {
      showInvoiceValidationError(
        `line-${invalidLine.lineId ?? invalidLine.id}`,
        t('请检查商品名称、数量和单价；金额将由数量乘以单价自动计算。'),
      );
      return;
    }
    setInvoiceValidationError('');
    setInvoiceInvalidField('');
    invoiceSubmitLockRef.current = true;
    setInvoiceSubmitting(true);
    try {
      const result = await orderProcessingApi.generateInvoice(orderId, {
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
          subtotal: roundMoney(line.quantity * line.unitPrice)
        }))
      });
      toast.success(result.message);
      await refreshAfterMutation();
      setActiveModal('preview');
    } catch (error) {
      const message = error instanceof Error ? error.message : t('发票生成失败');
      setInvoiceValidationError(message);
      toast.error(message);
    } finally {
      invoiceSubmitLockRef.current = false;
      setInvoiceSubmitting(false);
    }
  };

  const handleExportInvoice = async () => {
    const orderId = selectedOrder?.id;
    if (!orderId || invoiceExportLockRef.current) return;
    invoiceExportLockRef.current = true;
    setInvoiceExporting(true);
    try {
      const result = await orderProcessingApi.exportInvoice(orderId);
      toast.success(result.message ?? t('发票 PDF 已导出'));
      await refreshAfterMutation();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('发票导出失败'));
    } finally {
      invoiceExportLockRef.current = false;
      setInvoiceExporting(false);
    }
  };

  const handleSelectTemplate = (templateId: string) => {
    setSelectedTemplateId(templateId);
  };

  const formatLocalFileSize = (size: number) => {
    if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
  };

  const generateAiTemplate = async (files: File[] = []) => {
    if (files.length === 0) {
      toast.error(t('请选择参考发票文件'));
      return;
    }
    const requestId = ++aiRequestIdRef.current;
    setAiPhase('generating');
    setAiFiles(
      files.map((file) => ({ name: file.name, size: formatLocalFileSize(file.size) }))
    );
    try {
      const result = await orderProcessingApi.generateAiTemplate(files);
      if (requestId !== aiRequestIdRef.current || activeModal !== 'aiTemplate') return;
      toast.success(result.message);
      setSelectedTemplateId(result.activeTemplateId);
      await refreshAfterMutation();
      setAiPhase('done');
    } catch (error) {
      if (requestId !== aiRequestIdRef.current) return;
      toast.error(error instanceof Error ? error.message : t('AI 模板生成失败'));
      resetAi();
    }
  };

  const saveAiTemplate = () => {
    setActiveModal(null);
    resetAi();
  };
  return (
    <div className="order-horizon order-horizon-workbench material-scrollbar flex h-full min-h-0 w-full flex-col overflow-auto p-3 pb-4">
      <Input
        ref={orderUploadInputRef}
        type="file"
        multiple
        disabled={uploadingOrders}
        className="hidden"
        accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls,.csv"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          void handleUploadOrders(files);
        }} />
      <Input
        ref={aiTemplateInputRef}
        type="file"
        multiple
        className="hidden"
        accept=".pdf,.png,.jpg,.jpeg"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          void generateAiTemplate(files);
        }} />
      <OrderPageHeader
        Icon={Inbox}
        eyebrow={t('订单与库存')}
        title={t('订货单处理工作台')}
        description={t('统一接收企业微信邮箱与手动上传订货单，完成商品核对、发票生成和导出。')}
        meta={(
          <>
            <span>{t('当前队列')}：{workbench?.stats.pending ?? 0}</span>
            <span>· {t('数据来源')}：{activeTab === 'wecom_mail' ? t('企业微信邮箱') : t('手动上传')}</span>
          </>
        )}
        actions={(
          <>
            <Button variant="unstyled"
              type="button"
              onClick={() => void handleRefreshOrders()}
              disabled={syncingWecomOrders}
              className="order-horizon-secondary-action inline-flex items-center justify-center gap-2 border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600 disabled:cursor-not-allowed disabled:opacity-60">
              {syncingWecomOrders ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              {t('刷新队列')}
            </Button>
            <Button variant="unstyled"
              type="button"
              onClick={() => orderUploadInputRef.current?.click()}
              disabled={uploadingOrders}
              className="order-horizon-primary-action inline-flex items-center justify-center gap-2 border px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60">
              {uploadingOrders ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
              {uploadingOrders ? t('上传中') : t('上传订货单')}
            </Button>
          </>
        )}
      />
      {workbenchError ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">
          <span className="text-pretty">{workbenchError}</span>
          <Button variant="unstyled"
            type="button"
            onClick={() => void loadWorkbench()}
            className="min-h-10 border border-rose-200 bg-white px-3 font-medium text-rose-700 hover:bg-rose-100">
            {t('重试加载')}
          </Button>
        </div>
      ) : null}
      {/* Main Workbench Container */}
      <div className="order-horizon-workbench-shell flex min-h-[38rem] min-w-0 flex-1 flex-col overflow-hidden">
        {/* Overview Strip */}
        <div className="order-horizon-kpi-strip min-h-14 border-b border-slate-100 shrink-0">
          <div className="contents">
            <StatItem label={t("待处理")} value={String(workbench?.stats.pending ?? 0)} color="blue" />
            <StatItem label={t("异常")} value={String(workbench?.stats.abnormal ?? 0)} color="rose" />
            <StatItem label={t("已生成")} value={String(workbench?.stats.generated ?? 0)} color="emerald" />
            <StatItem label={t("未导出")} value={String(workbench?.stats.unexported ?? 0)} color="amber" />
          </div>

        </div>

        {/* Three Column Layout */}
        <div className="order-horizon-workbench-layout min-h-0 flex-1 overflow-hidden">
          {/* LEFT: Order Queue */}
          <aside className="order-horizon-queue w-[280px] border-r border-slate-100 flex min-h-0 flex-col bg-white shrink-0 z-10">
            <div className="px-4 py-3 border-b border-slate-100">
              <Tabs
                value={activeTab}
                onValueChange={(value) => {
                  setActiveTab(value as 'wecom_mail' | 'upload');
                  resetOrderQueue(true);
                }}>
                <TabsList className="mb-2.5 grid h-11 w-full grid-cols-2 rounded-lg bg-slate-100/80 p-1" aria-label={t('订货单来源')}>
                  <TabsTrigger value="wecom_mail" className="min-h-9 text-xs">
                    {t('企业微信邮箱')}
                  </TabsTrigger>
                  <TabsTrigger value="upload" className="min-h-9 text-xs">
                    {t('手动上传')}
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              {activeTab === 'wecom_mail' &&
                <div className="mb-2">
                  {mailboxError ? (
                    <div className="mb-2 flex items-center justify-between gap-2 text-xs text-rose-700" role="alert">
                      <span className="min-w-0 text-pretty">{mailboxError}</span>
                      <Button variant="unstyled" type="button" onClick={() => void loadMailboxes()} className="min-h-9 shrink-0 border border-rose-200 bg-white px-2 font-medium">
                        {t('重试')}
                      </Button>
                    </div>
                  ) : null}
                  <Select
                    value={selectedWecomMailboxId || undefined}
                    onValueChange={(value) => {
                      setSelectedWecomMailboxId(value);
                      resetOrderQueue(true);
                    }}
                    disabled={loadingWecomMailboxes || enabledWecomMailboxes.length === 0}>
                    <SelectTrigger aria-label={t('选择企业微信邮箱')} className="min-h-10 rounded-lg border-primary/25 bg-white px-3 text-xs text-slate-700 shadow-sm shadow-blue-100/40 focus:ring-primary/20">
                      <SelectValue
                        placeholder={
                          loadingWecomMailboxes ?
                            t('加载企业微信邮箱...') :
                            enabledWecomMailboxes.length > 0 ?
                              t('选择企业微信邮箱') :
                              t('暂无可用企业微信邮箱')
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
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="text"
                  value={orderSearch}
	                  onChange={(event) => {
	                    setOrderSearch(event.target.value);
	                    resetOrderQueue(true);
	                  }}
                  placeholder={t("搜索客户 / 订单号")}
                  aria-label={t('搜索订货单')}
                  className="min-h-10 w-full rounded-lg border-none bg-slate-100 pl-8 pr-3 text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20" />
                
              </div>
            </div>

	            <div
	              ref={orderQueueRef}
	              onScroll={handleOrderQueueScroll}
	              aria-busy={loading || loadingMoreOrders}
	              className="min-h-0 flex-1 overflow-y-auto p-3 space-y-1.5">
	              {visibleQueueItems.map((order) =>
	              <Button variant="unstyled"
	                key={order.id}
                    type="button"
                onClick={() => handleSelectOrder(order.id)}
                data-selected={selectedOrderId === order.id}
                aria-pressed={selectedOrderId === order.id}
                className={`order-horizon-order-item relative p-3.5 cursor-pointer overflow-hidden ${selectedOrderId === order.id ? 'bg-accent' : 'hover:bg-accent/40'}`}>
                
                  {selectedOrderId === order.id &&
                <span className="absolute left-0 top-3 bottom-3 w-1 bg-blue-500 rounded-r-full" />
                }
                  <span className="mb-1.5 flex items-start justify-between">
                    <span
                    className={`text-sm font-medium truncate pr-2 ${selectedOrderId === order.id ? 'text-blue-900' : 'text-slate-800'}`}>
                    
                      {order.customer}
                    </span>
                    <StatusBadge type={order.type} text={order.status} />
                  </span>
                  <span
                  className={`mb-1.5 block text-xs font-mono ${selectedOrderId === order.id ? 'text-blue-700/70' : 'text-slate-500'}`}>
                  
                    {order.id}
                  </span>
                  <span
                  className={`flex items-center gap-1 text-xs ${selectedOrderId === order.id ? 'text-blue-700/60' : 'text-muted-foreground'}`}>
                  
                    <Clock className="w-3.5 h-3.5" /> {t("发货：{date}", { date: order.date })}
                  </span>
                </Button>
              )}
		              {loading && visibleQueueItems.length === 0 ? (
		                <div className="space-y-2" aria-label={t('正在加载订货单')}>
		                  {[0, 1, 2].map((item) => (
		                    <div key={item} className="h-20 rounded-xl bg-slate-100" />
		                  ))}
		                </div>
		              ) : null}
		              {!loading && visibleQueueItems.length === 0 &&
		              <div className="flex flex-col items-center gap-3 py-10 text-center text-sm text-slate-500">
		                {activeTab === 'wecom_mail' ?
		                enabledWecomMailboxes.length > 0 ?
                  t('当前企业微信邮箱暂无订货单') :
                  t('暂无可用企业微信邮箱，请先在邮箱管理启用通道') :
                t('暂无匹配订单')}
		                {orderSearch ? (
		                  <Button variant="unstyled" type="button" className="min-h-10 border border-slate-200 bg-white px-3 font-medium text-slate-700" onClick={() => {
		                    setOrderSearch('');
		                    resetOrderQueue(true);
		                  }}>
		                    {t('清除搜索')}
		                  </Button>
		                ) : activeTab === 'upload' ? (
		                  <Button type="button" disabled={uploadingOrders} className="min-h-10 px-3 font-medium disabled:opacity-60" onClick={() => orderUploadInputRef.current?.click()}>
		                    {t('上传订货单')}
		                  </Button>
		                ) : null}
		              </div>
		              }
	              {visibleQueueItems.length > 0 &&
	              <div className="py-3 text-center text-xs text-muted-foreground">
	                {loadingMoreOrders &&
	                <span className="inline-flex items-center justify-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t("正在加载更多")}
	                </span>
	                }
                {!loadingMoreOrders && hasMoreOrders && t("已显示 {loaded} / {total}，继续下滑加载更多", { loaded: loadedOrderCount, total: queue?.total ?? loadedOrderCount })}
                {!loadingMoreOrders && !hasMoreOrders && t("已加载全部 {count} 条", { count: queue?.total ?? loadedOrderCount })}
	              </div>
	              }
	            </div>

		            <div className="p-4 border-t border-slate-100 bg-slate-50/30">
		              <div className="flex gap-3">
		                <Button variant="unstyled"
		                  onClick={() => void handleRefreshOrders()}
		                  disabled={syncingWecomOrders}
		                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-accent text-primary text-sm font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60">
                  {syncingWecomOrders ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />} {t("刷新")}
		                </Button>
                <Button variant="unstyled"
                  onClick={() => orderUploadInputRef.current?.click()}
                  disabled={uploadingOrders}
                  className="flex min-h-11 flex-1 items-center justify-center gap-1.5 bg-accent py-2.5 text-sm font-medium text-primary hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60">
                  {uploadingOrders ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                  {uploadingOrders ? t('上传中') : t('上传')}
                </Button>
              </div>
            </div>
          </aside>

          {/* CENTER: Order Comparison */}
          <main className="order-horizon-compare flex-1 flex min-h-0 min-w-[860px] flex-col bg-slate-50/30">
            {/* Compact Summary */}
            <div className="order-horizon-summary mx-5 mt-4 mb-3 px-4 py-2.5 bg-white flex flex-wrap items-center gap-x-5 gap-y-2 text-sm shrink-0">
              <div className="flex items-center gap-2 whitespace-nowrap">
                <span className="text-muted-foreground">{t("客户：")}</span>
                <span className="font-medium text-slate-800">
                  {orderDetails.customer}
                </span>
              </div>
              <div className="flex items-center gap-2 whitespace-nowrap">
                <span className="text-muted-foreground">{t("订单号：")}</span>
                <span className="font-mono text-slate-800">
                  {orderDetails.orderId}
                </span>
              </div>
              <div className="flex items-center gap-2 whitespace-nowrap">
                <span className="text-muted-foreground">{t("发货日：")}</span>
                <span className="text-slate-800">{orderDetails.date}</span>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <div className="flex items-center gap-2 bg-blue-50/50 px-3.5 py-1 rounded-full whitespace-nowrap">
                  <span className="text-slate-500">{t("金额：")}</span>
                  <span className="font-semibold text-blue-700">
                    {orderDetails.amount}
                  </span>
                </div>
                <Button variant="unstyled"
                  onClick={(event) => openModal('original', event.currentTarget)}
                  disabled={!selectedOrder?.id}
                    className="flex min-h-10 items-center gap-1.5 whitespace-nowrap bg-accent px-3 text-xs font-medium text-primary hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50">
                  <FileText className="w-3.5 h-3.5" /> {t("查看原单")}
                </Button>
                {selectedOrder?.generated &&
                  <Button
                    onClick={(event) => openModal('preview', event.currentTarget)}
                    disabled={!selectedOrder?.id || loading}
                    className="flex min-h-10 items-center gap-1.5 whitespace-nowrap px-3.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50">
                    <Eye className="w-3.5 h-3.5" />
                    {t("查看发票")}
                  </Button>
                }
              </div>
            </div>

            {/* Product Table Area */}
	            <div className="order-horizon-panel flex-1 mx-5 mb-4 bg-white flex min-h-0 flex-col overflow-hidden" aria-busy={loading}>
	              <div className="px-4 py-3 border-b border-slate-50 bg-white shrink-0">
	                <div className="flex flex-wrap items-center gap-3">
	                  <h3 className="font-semibold text-slate-800 whitespace-nowrap">{t("商品明细")}</h3>
	                  <div className="ml-auto flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
	                    <div className="relative min-w-[180px] flex-1 max-w-[260px]">
	                      <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
	                      <Input
	                        value={productSearch}
	                        onChange={(event) => setProductSearch(event.target.value)}
	                        placeholder={t("筛商品 / SKU / 备注")}
	                        aria-label={t('搜索商品明细')}
	                        className="min-h-10 w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-3 text-xs text-slate-700 outline-none focus:border-primary/25 focus:bg-white focus:ring-2 focus:ring-primary/10" />
	                    </div>
	                    <NativeSelect
	                      value={productCategoryFilter}
	                      onChange={(event) => setProductCategoryFilter(event.target.value)}
	                      aria-label={t('商品类目')}
	                      className="min-h-10 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs text-slate-700 outline-none focus:border-primary/25 focus:bg-white focus:ring-2 focus:ring-primary/10">
	                      <option value="all">{t("全部类目")}</option>
	                      {productCategories.map((category) =>
	                      <option key={category} value={category}>{t(category.trim())}</option>
	                      )}
	                    </NativeSelect>
	                  </div>
	                </div>
	              </div>

              <ScrollArea type="always" scrollbars="both" className="order-horizon-table min-h-0 min-w-0 flex-1">
                <Table containerClassName="overflow-visible" className="min-w-[980px] text-sm text-left whitespace-nowrap">
                  <TableHeader className="text-xs text-slate-600 [&_th]:sticky [&_th]:top-0 [&_th]:z-30 [&_th]:bg-slate-50 [&_th]:shadow-[0_1px_0_rgba(148,163,184,0.25)]">
                    <TableRow>
                      <TableHead className="px-4 py-2.5 font-medium">{t("序号")}</TableHead>
                      <TableHead className="px-4 py-2.5 font-medium">{t("商品编码")}</TableHead>
                      <TableHead className="px-4 py-2.5 font-medium">{t("商品名称")}</TableHead>
                      <TableHead className="px-4 py-2.5 font-medium">{t("类目")}</TableHead>
                      <TableHead className="px-4 py-2.5 font-medium">{t("规格")}</TableHead>
                      <TableHead className="px-4 py-2.5 font-medium">{t("单位")}</TableHead>
                      <TableHead className="px-4 py-2.5 font-medium text-right">
                        {t("订货数量")}
                      </TableHead>
                      <TableHead className="px-4 py-2.5 font-medium text-right">
                        {t("订单单价")}
                      </TableHead>
                      <TableHead className="px-4 py-2.5 font-medium text-right">
                        {t("系统单价")}
                      </TableHead>
                      <TableHead className="px-4 py-2.5 font-medium text-right">
                        {t("小计金额")}
                      </TableHead>
                      <TableHead className="px-4 py-2.5 font-medium">{t("备注")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="divide-y divide-slate-50">
	                    {productRows.map((p, idx: number) =>
	                    <TableRow
                      key={p.id}
                      className={`
                        hover:bg-accent/30 transition-colors
                      `}>
                      
                        <TableCell className="px-4 py-2.5 text-slate-500">
                          {((productMeta?.page ?? 1) - 1) * (productMeta?.pageSize ?? 8) + idx + 1}
                        </TableCell>
                        <TableCell className="px-4 py-2.5 font-mono text-slate-600">
                          {p.id}
                        </TableCell>
                        <TableCell className="px-4 py-2.5 font-medium text-slate-800">
                          <AutoTranslatedText text={p.name} />
                        </TableCell>
                        <TableCell className="px-4 py-2.5 text-slate-600">
                          <AutoTranslatedText text={t(p.category.trim())} />
                        </TableCell>
                        <TableCell className="px-4 py-2.5 text-slate-600"><AutoTranslatedText text={p.spec} /></TableCell>
                        <TableCell className="px-4 py-2.5 text-slate-600">{t(p.unit.trim())}</TableCell>
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
                        
                          <AutoTranslatedText text={p.remark} />
                        </TableCell>
	                      </TableRow>
	                    )}
	                    {productRows.length === 0 &&
	                    <TableRow>
	                      <TableCell colSpan={11} className="px-4 py-10 text-center text-sm text-muted-foreground">
	                        {loading
	                          ? t('正在加载商品明细...')
	                          : !selectedOrder
	                            ? t('请先从左侧选择一张订货单')
	                            : allProductRows.length === 0
	                              ? t('当前订货单没有可用商品明细')
	                              : t('暂无匹配商品')}
	                      </TableCell>
	                    </TableRow>
	                    }
	                  </TableBody>
                </Table>
              </ScrollArea>

              <div className="px-4 py-2.5 border-t border-slate-50 bg-white flex items-center justify-between shrink-0">
                <div className="text-xs text-slate-500 px-2">
                  {t("显示 {start}-{end} / 共 {total} 条", {
                    start: productRows.length > 0 ? ((productMeta?.page ?? 1) - 1) * (productMeta?.pageSize ?? 8) + 1 : 0,
                    end: ((productMeta?.page ?? 1) - 1) * (productMeta?.pageSize ?? 8) + productRows.length,
                    total: productMeta?.total ?? 0,
                  })}
                </div>
	                {(productMeta?.totalPages ?? 1) > 1 &&
	                <Pagination className="mx-0 w-auto justify-end">
                  <PaginationContent className="gap-1 text-xs">
                    <PaginationItem>
                      <PaginationLink
                        href="#"
                        aria-label={t("上一页")}
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
                        className="size-8 rounded-full border-blue-600 bg-blue-600 text-white shadow-sm hover:bg-primary-hover hover:text-white">
                        
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
                        aria-label={t("下一页")}
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

          </main>

          {/* RIGHT: Shipment Summary */}
          <aside className="order-horizon-invoice-rail flex w-[320px] border-l border-slate-100 min-h-0 flex-col bg-white shrink-0 z-10">
            <div className="min-h-0 flex-1 overflow-y-auto p-4 pb-24 space-y-4 bg-slate-50/30">
              {/* Shipment Action Card */}
              <section className="order-horizon-panel bg-white p-5">
                <div className="space-y-3 text-sm mb-5">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("客户")}</span>
                    <span className="text-slate-800 truncate max-w-[140px]">
                      {orderDetails.customer}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("订单号")}</span>
                    <span className="text-slate-800 font-mono">
                      {orderDetails.orderId}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("发货日")}</span>
                    <span className="text-slate-800">{orderDetails.date}</span>
                  </div>
                  <div className="flex justify-between pt-3 border-t border-slate-50">
                    <span className="text-muted-foreground">{t("金额")}</span>
                    <span className="text-blue-700 font-semibold">
                      {orderDetails.amount}
                    </span>
                  </div>
                </div>
                <Button
                  onClick={handleOpenInvoiceDraft}
                  disabled={!selectedOrder?.id}
                  className="mb-3 flex w-full items-center justify-center gap-1.5 py-2.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50">
                  <FileDown className="w-4 h-4" /> {t("生成发票")}
                </Button>
                <div className="flex gap-3">
                  <Button variant="unstyled"
                    onClick={(event) => openModal('preview', event.currentTarget)}
                    disabled={!selectedOrder?.generated}
                    title={selectedOrder?.generated ? t("预览商业发票") : t("请先点击「生成发票」")}
                    className="flex-1 py-2 bg-accent text-primary text-sm font-medium enabled:hover:bg-accent flex items-center justify-center gap-1.5 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed">

                    <Eye className="w-4 h-4" /> {t("预览")}
                  </Button>
                  <Button
                    onClick={handleExportInvoice}
	                    disabled={!selectedOrder?.generated}
	                    className="flex-1 py-2 text-sm font-medium flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed">
                    <Download className="w-4 h-4" /> {t("导出")}
                  </Button>
                </div>
              </section>

              {/* Template Card */}
              <section className="order-horizon-panel bg-white p-5">
                <div className="flex justify-between items-center gap-3 mb-4">
                  <h3 className="text-sm font-medium text-slate-800 flex items-center gap-2">
                    <Layers className="w-4.5 h-4.5 text-primary" /> {t("发票模板")}
                  </h3>
                  <div className="flex items-center gap-1.5">
                    <Button variant="unstyled"
                      onClick={(event) => openModal('aiTemplate', event.currentTarget)}
                      className="flex min-h-10 items-center justify-center gap-1 border border-primary/25 bg-accent px-2.5 text-xs font-medium text-primary hover:bg-accent">
                      
                      <Sparkles className="w-3.5 h-3.5" /> {t("AI 模板")}
                    </Button>
                  </div>
                </div>
                <div className="space-y-1.5 mb-4">
                  {selectableTemplates.map((template) =>
                  <Button variant="unstyled"
                    key={template.id}
                    type="button"
                    onClick={() => void handleSelectTemplate(template.id)}
                    data-selected={activeTemplate === template.id}
                    aria-pressed={activeTemplate === template.id}
                    className={`order-horizon-template-option p-3 flex items-center justify-between cursor-pointer ${activeTemplate === template.id ? 'bg-accent' : 'hover:bg-accent/40'}`}>
                    
                      <span className="flex items-center gap-2.5">
                        <FileDown
                        className={`w-4.5 h-4.5 ${activeTemplate === template.id ? 'text-blue-600' : 'text-muted-foreground'}`} />
                      
                        <span
                        className={`text-sm flex items-center gap-2 ${activeTemplate === template.id ? 'font-medium text-blue-900' : 'text-slate-600'}`}>
                        
                          {t(template.name.trim())}
                          {template.source === 'ai' &&
                        <span className="inline-flex items-center gap-0.5 rounded border border-[#c8d6ff] bg-accent px-1.5 py-0.5 text-[10px] font-medium text-primary">
                              <Sparkles className="w-2.5 h-2.5" /> AI
                            </span>
                        }
                        </span>
                      </span>
                      {activeTemplate === template.id &&
                    <span className="size-2 rounded-full bg-blue-600" />
                    }
                    </Button>
                  )}
                </div>
              </section>

            </div>
          </aside>
        </div>
      </div>

      {/* MODALS */}
      {/* AI Template Generation Modal */}
      <WorkbenchDialogSurface
        open={activeModal === 'aiTemplate'}
        title={t('AI 生成模板')}
        description={t('上传参考发票并生成可复核的模板草稿。')}
        busy={aiPhase === 'generating'}
        returnFocusRef={modalReturnFocusRef}
        onClose={closeActiveModal}
        className="flex w-full flex-col bg-white sm:max-w-2xl">
          
              <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-white">
                <h2 id="ai-template-title" className="text-lg font-semibold text-slate-800 flex items-center gap-2 text-balance">
                  <Sparkles className="size-5 text-blue-700" /> {t('AI 生成模板')}
                </h2>
                <Button variant="unstyled"
              type="button"
              aria-label={t('关闭 AI 模板窗口')}
              onClick={closeActiveModal}
              disabled={aiPhase === 'generating'}
              className="flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50">
              
                  <X className="w-5 h-5" />
                </Button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 bg-slate-50/30 space-y-6">
                {aiPhase === 'idle' &&
            <div className="relative overflow-hidden rounded-2xl border border-[#c8d6ff] bg-accent p-8 text-center">
                    <div className="relative z-10 mx-auto mb-6 flex size-16 items-center justify-center rounded-2xl bg-primary">
                      <Sparkles className="w-8 h-8 text-white" />
                    </div>

                    <h3 className="text-xl font-semibold text-slate-800 mb-3 relative z-10">
                      {t('上传参考发票')}
                    </h3>
                    <p className="relative z-10 mx-auto mb-8 max-w-md text-pretty text-sm leading-relaxed text-slate-600">
	                      {t('上传客户提供的发票样式图片或 PDF，系统会提取可用字段并生成一个可复核的模板草稿。')}
                    </p>

                    <div className="flex items-center justify-center gap-4 relative z-10">
                      <Button
                  onClick={() => aiTemplateInputRef.current?.click()}
                  className="px-6 py-3 text-sm font-medium flex items-center gap-2">
                  
                        <Upload className="w-4 h-4" /> {t('选择文件并生成')}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-4 relative z-10">
                      {t('支持 JPG · PNG · PDF，最大 10MB')}
                    </p>
                  </div>
            }

                {aiPhase === 'generating' &&
            <div className="rounded-3xl border border-[#dbe5ff] bg-white p-8 text-center elevation-1">
                    <div className="size-16 mx-auto rounded-2xl bg-primary flex items-center justify-center mb-6">
                      <Loader2 className="w-8 h-8 text-white animate-spin" />
                    </div>

                    <h3 className="text-lg font-semibold text-slate-800 mb-2">
                      {t('正在解析并生成模板草稿...')}
                    </h3>
                    <p className="mb-8 text-pretty text-sm text-slate-500">
                      {t('正在提取表头、订单号、客户和金额等字段，这可能需要几秒钟。')}
                    </p>

                    <div className="max-w-sm mx-auto space-y-3">
                      {aiFiles.map((f, i) =>
                <div
                  key={i}
                  className="flex items-center gap-3 p-3 bg-slate-50 rounded-2xl text-left">
                  
                          <FileText className="w-5 h-5 text-muted-foreground shrink-0" />
                          <span className="text-sm text-slate-700 flex-1 truncate">
                            {f.name}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {f.size}
                          </span>
                        </div>
                )}
                    </div>

                    <div className="max-w-sm mx-auto mt-8 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                  className={`h-full bg-primary rounded-full transition-[width] duration-500 ease-out
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
                          {t('模板生成成功！')}
                        </h3>
                        <p className="text-pretty text-sm text-emerald-700/80">
                          {t('AI 已成功解析参考文件，并生成了对应的高保真模板。您可以保存并在预览中使用它。')}
                        </p>
                      </div>
                    </div>

                    <div className="bg-white border border-slate-200 rounded-3xl p-6 elevation-1">
                      <h4 className="text-sm font-medium text-slate-800 mb-4">
                        {t('模板预览')}
                      </h4>
                      <div className="aspect-[1/1.4] w-full max-w-sm mx-auto bg-slate-50 border border-slate-200 rounded-xl overflow-hidden relative shadow-sm">
                        {/* Placeholder for generated template thumbnail */}
                        <div className="absolute inset-0 p-6 flex flex-col">
                          <div className="mb-8 h-6 w-1/3 rounded bg-[#c8d6ff]"></div>
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
                  <Button variant="unstyled"
              onClick={resetAi}
              className="px-5 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200">
              
                    {t('重新生成')}
                  </Button>
                  <Button
              onClick={saveAiTemplate}
              className="px-6 py-2 text-sm font-medium flex items-center gap-1.5">
              
                    <Check className="w-4 h-4" /> {t('保存并应用新模板')}
                  </Button>
                </div>
          }
            </WorkbenchDialogSurface>

      {/* Invoice Draft Modal */}
      <WorkbenchDialogSurface
        open={activeModal === 'invoiceDraft'}
        title={t('生成发票')}
        description={t('复核客户、订单和商品明细后生成商业发票。')}
        busy={invoiceSubmitting}
        returnFocusRef={modalReturnFocusRef}
        onClose={closeActiveModal}
        className="flex w-full flex-col bg-white sm:max-w-6xl">
          
              <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-white">
                <div>
                  <h2 id="invoice-draft-title" className="text-lg font-semibold text-slate-800 flex items-center gap-2 text-balance">
                    <FileDown className="w-5 h-5 text-blue-500" /> {t('生成发票')}
                  </h2>
                  <p className="mt-1 text-pretty text-xs text-slate-500">
                    {t('当前模板：{name}，保存后可在“查看发票”中看到最新内容。', { name: activeTemplateName })}
                  </p>
                </div>
                <Button variant="unstyled"
              type="button"
              aria-label={t('关闭发票生成窗口')}
              onClick={closeActiveModal}
              disabled={invoiceSubmitting}
              className="flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50">
              
                  <X className="w-5 h-5" />
                </Button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/60 p-6 pb-10">
                <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
                  <div className="min-w-0 overflow-hidden rounded-3xl border border-slate-100 bg-white elevation-1">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-800">{t('发票商品明细')}</h3>
                        <p className="mt-1 text-xs text-slate-500">
                          {invoiceDraftInfo.customer || '-'} · {invoiceDraftInfo.orderId || '-'}
                        </p>
                      </div>
                      <div className="rounded-full bg-blue-50 px-3 py-1 text-sm font-semibold tabular-nums text-blue-700">
                        {invoiceDraftAmountText}
                      </div>
                    </div>
                    <ScrollArea type="always" scrollbars="both" className="max-h-[calc(100dvh-340px)] min-h-[280px] min-w-0 pb-3">
                      <Table containerClassName="overflow-visible" className="min-w-[820px] text-sm whitespace-nowrap">
                        <TableHeader className="bg-slate-50 text-xs text-slate-600">
                          <TableRow>
                            <TableHead className="px-4 py-3 font-medium">{t('商品编码')}</TableHead>
                            <TableHead className="px-4 py-3 font-medium">{t('商品名称')}</TableHead>
                            <TableHead className="px-4 py-3 font-medium">{t('规格')}</TableHead>
                            <TableHead className="px-4 py-3 font-medium">{t('单位')}</TableHead>
                            <TableHead className="px-4 py-3 text-right font-medium">{t('数量')}</TableHead>
                            <TableHead className="px-4 py-3 text-right font-medium">{t('单价')}</TableHead>
                            <TableHead className="px-4 py-3 text-right font-medium">{t('金额')}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody className="divide-y divide-slate-50">
                          {invoiceDraftLines.map((line) => {
                            const lineKey = line.lineId ?? line.id;
                            return (
                              <TableRow key={lineKey} className="hover:bg-accent/30">
                                <TableCell className="px-4 py-3 font-mono text-slate-600">{line.id}</TableCell>
                                <TableCell className="px-4 py-3 font-medium text-slate-800">{line.name}</TableCell>
                                <TableCell className="px-4 py-3 text-slate-600">{line.spec}</TableCell>
                                <TableCell className="px-4 py-3 text-slate-600">{line.unit}</TableCell>
                                <TableCell className="px-4 py-3 text-right">
                                  <Input
                                    type="number"
                                    min={1}
                                    step={1}
                                    value={line.quantityText}
                                    data-invoice-field={`line-${lineKey}`}
                                    aria-label={`${line.name || line.id} ${t('数量')}`}
                                    aria-invalid={invoiceInvalidField === `line-${lineKey}`}
                                    aria-describedby={invoiceValidationError ? 'invoice-validation-error' : undefined}
                                    onChange={(event) => handleInvoiceDraftLineChange(lineKey, 'quantity', event.target.value)}
                                    className="min-h-10 w-24 rounded-lg border border-slate-200 bg-slate-50 px-3 text-right text-sm font-medium tabular-nums text-slate-800 outline-none focus:border-primary/25 focus:bg-white focus:ring-2 focus:ring-primary/10" />
                                </TableCell>
                                <TableCell className="px-4 py-3 text-right">
                                  <Input
                                    type="number"
                                    min={0}
                                    step="0.01"
                                    value={line.unitPriceText}
                                    aria-label={`${line.name || line.id} ${t('单价')}`}
                                    aria-invalid={invoiceInvalidField === `line-${lineKey}`}
                                    aria-describedby={invoiceValidationError ? 'invoice-validation-error' : undefined}
                                    onChange={(event) => handleInvoiceDraftLineChange(lineKey, 'unitPrice', event.target.value)}
                                    className="min-h-10 w-28 rounded-lg border border-slate-200 bg-slate-50 px-3 text-right text-sm font-medium tabular-nums text-slate-800 outline-none focus:border-primary/25 focus:bg-white focus:ring-2 focus:ring-primary/10" />
                                </TableCell>
                                <TableCell className="px-4 py-3 text-right font-semibold tabular-nums text-slate-800">
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
                          'border-[#dbe5ff] bg-white text-slate-800' :
                          'border-slate-100 bg-white text-slate-800'
                    }`}>
                    <div className="mb-5 flex items-start justify-between gap-3">
                      <div>
                        <div className={`text-xs font-semibold uppercase ${activeTemplate === 'inogi' ? 'text-white/70' : 'text-muted-foreground'}`}>
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
                        <span className={activeTemplate === 'inogi' ? 'text-white/60' : 'text-muted-foreground'}>{t('客户')}</span>
                        <Input
                          value={invoiceDraftInfo.customer}
                          data-invoice-field="customer"
                          aria-label={t('客户名称')}
                          aria-invalid={invoiceInvalidField === 'customer'}
                          aria-describedby={invoiceValidationError ? 'invoice-validation-error' : undefined}
                          onChange={(event) => handleInvoiceDraftInfoChange('customer', event.target.value)}
                          className={`min-w-0 flex-1 rounded-lg bg-transparent px-2 py-0.5 text-right font-medium outline-none transition-colors focus:ring-2 ${
                            activeTemplate === 'inogi' ? 'text-white focus:bg-white/10 focus:ring-white/20' : 'text-slate-800 focus:bg-white focus:ring-primary/10'
                          }`} />
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className={activeTemplate === 'inogi' ? 'text-white/60' : 'text-muted-foreground'}>{t('订单号')}</span>
                        <Input
                          value={invoiceDraftInfo.orderId}
                          data-invoice-field="orderId"
                          aria-label={t('订单号')}
                          aria-invalid={invoiceInvalidField === 'orderId'}
                          aria-describedby={invoiceValidationError ? 'invoice-validation-error' : undefined}
                          onChange={(event) => handleInvoiceDraftInfoChange('orderId', event.target.value)}
                          className={`min-w-0 flex-1 rounded-lg bg-transparent px-2 py-0.5 text-right font-mono outline-none transition-colors focus:ring-2 ${
                            activeTemplate === 'inogi' ? 'text-white focus:bg-white/10 focus:ring-white/20' : 'text-slate-800 focus:bg-white focus:ring-primary/10'
                          }`} />
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className={activeTemplate === 'inogi' ? 'text-white/60' : 'text-muted-foreground'}>{t('发货日')}</span>
                        <Input
                          value={invoiceDraftInfo.date}
                          data-invoice-field="date"
                          aria-label={t('发货日期')}
                          aria-invalid={invoiceInvalidField === 'date'}
                          aria-describedby={invoiceValidationError ? 'invoice-validation-error' : undefined}
                          onChange={(event) => handleInvoiceDraftInfoChange('date', event.target.value)}
                          className={`min-w-0 flex-1 rounded-lg bg-transparent px-2 py-0.5 text-right outline-none transition-colors focus:ring-2 ${
                            activeTemplate === 'inogi' ? 'text-white focus:bg-white/10 focus:ring-white/20' : 'text-slate-800 focus:bg-white focus:ring-primary/10'
                          }`} />
                      </div>
                    </div>

                    <div className={`mt-4 overflow-hidden rounded-2xl border ${activeTemplate === 'inogi' ? 'border-white/20' : 'border-slate-100'}`}>
                      <div className={`grid grid-cols-[minmax(0,1fr)_64px_104px] gap-2 px-3 py-2 text-xs font-semibold ${activeTemplate === 'inogi' ? 'bg-white/10 text-white/80' : 'bg-slate-50 text-slate-500'}`}>
                        <span>{t('商品')}</span>
                        <span className="text-right">{t('数量')}</span>
                        <span className="text-right">{t('金额')}</span>
                      </div>
                      <div className="max-h-[270px] overflow-y-auto">
                        {invoiceDraftLines.map((line) => {
                          const lineKey = line.lineId ?? line.id;
                          return (
                            <div
                              key={lineKey}
                              className={`grid grid-cols-[minmax(0,1fr)_64px_104px] gap-2 border-t px-3 py-2 text-xs ${activeTemplate === 'inogi' ? 'border-white/10' : 'border-slate-100'}`}>
                              <Input
                                value={line.name}
                                data-invoice-field={`line-${lineKey}`}
                                aria-label={`${line.id} ${t('商品名称')}`}
                                aria-invalid={invoiceInvalidField === `line-${lineKey}`}
                                aria-describedby={invoiceValidationError ? 'invoice-validation-error' : undefined}
                                onChange={(event) => handleInvoiceDraftLineTextChange(lineKey, 'name', event.target.value)}
                                className={`min-w-0 truncate rounded-md bg-transparent px-1 py-0.5 font-medium outline-none transition-colors focus:ring-2 ${
                                  activeTemplate === 'inogi' ? 'text-white focus:bg-white/10 focus:ring-white/20' : 'text-slate-800 focus:bg-white focus:ring-primary/10'
                                }`} />
                              <Input
                                type="number"
                                min={1}
                                step={1}
                                value={line.quantityText}
                                aria-label={`${line.name || line.id} ${t('数量')}`}
                                aria-invalid={invoiceInvalidField === `line-${lineKey}`}
                                aria-describedby={invoiceValidationError ? 'invoice-validation-error' : undefined}
                                onChange={(event) => handleInvoiceDraftLineChange(lineKey, 'quantity', event.target.value)}
                                className={`min-w-0 rounded-md bg-transparent px-1 py-0.5 text-right outline-none transition-colors focus:ring-2 ${
                                  activeTemplate === 'inogi' ? 'text-white focus:bg-white/10 focus:ring-white/20' : 'text-slate-800 focus:bg-white focus:ring-primary/10'
                                }`} />
                              <div className="flex min-w-0 items-center justify-end gap-0.5 font-semibold">
                                <span className={activeTemplate === 'inogi' ? 'text-white/70' : 'text-muted-foreground'}>¥</span>
                                <span className="w-20 truncate text-right" title={formatInvoiceMoney(line.subtotal)}>
                                  {line.subtotal.toFixed(2)}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <div className={`mt-5 flex items-center justify-between border-t pt-4 text-base font-bold tabular-nums ${activeTemplate === 'inogi' ? 'border-white/20' : 'border-slate-100'}`}>
                      <span>{t('合计')}</span>
                      <span>{invoiceDraftAmountText}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-white px-6 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-4">
                <p id="invoice-validation-error" className="max-w-2xl text-pretty text-sm text-rose-700" role={invoiceValidationError ? 'alert' : undefined}>
                  {invoiceValidationError || t('金额由数量乘以单价自动计算。')}
                </p>
                <div className="flex gap-3 lg:mr-44">
                  <Button variant="unstyled"
              type="button"
              onClick={closeActiveModal}
              disabled={invoiceSubmitting}
              className="px-5 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50">
              
                    {t('取消')}
                  </Button>
                  <Button
              onClick={() => void handleConfirmGenerateInvoice()}
              disabled={invoiceSubmitting || invoiceDraftLines.length === 0}
              className="px-6 py-2 text-sm font-medium flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-50">
              
                    {invoiceSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    {t('保存并生成发票')}
                  </Button>
                </div>
              </div>
            </WorkbenchDialogSurface>

      {/* OCR Result Modal */}
      <WorkbenchDialogSurface
        open={activeModal === 'original'}
        title={t('订货单识别结果')}
        description={t('展示系统从原始订货单提取出的结构化内容，不代表原文件版式。')}
        returnFocusRef={modalReturnFocusRef}
        onClose={closeActiveModal}
        className="flex w-full flex-col bg-white sm:max-w-3xl">
          
              <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-white">
                <h2 id="original-order-title" className="text-lg font-semibold text-slate-800 flex items-center gap-2 text-balance">
                  <FileText className="w-5 h-5 text-blue-500" /> {t('订货单识别结果')}
                </h2>
                <Button variant="unstyled"
              type="button"
              aria-label={t('关闭订货单识别结果窗口')}
              onClick={closeActiveModal}
              className="flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-slate-100">
              
                  <X className="w-5 h-5" />
                </Button>
              </div>
              <div className="p-6 overflow-y-auto bg-slate-50/50 flex-1 flex justify-center">
                <div className="bg-white p-8 shadow-sm border border-slate-200 w-full max-w-2xl min-h-[500px] rounded-xl">
                  <div className="text-center mb-8">
                    <h1 className="text-2xl font-bold text-slate-800 mb-2">
                      PURCHASE ORDER
                    </h1>
	                    <p className="text-slate-500">{orderDetails.customer || t('未识别客户')}</p>
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
                      {orderDetails.products.map((p) =>
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
            </WorkbenchDialogSurface>

      {/* Invoice Preview Modal */}
      <WorkbenchDialogSurface
        open={activeModal === 'preview'}
        title={t('商业发票预览')}
        description={t('核对发票内容；未配置的企业和收款信息不会被虚构。')}
        busy={invoiceExporting}
        returnFocusRef={modalReturnFocusRef}
        onClose={closeActiveModal}
        className="flex w-full flex-col bg-white sm:max-w-4xl">
          
              <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-white">
                <h2 id="invoice-preview-title" className="text-lg font-semibold text-slate-800 flex items-center gap-2 text-balance">
                  <Eye className="w-5 h-5 text-blue-500" /> {t('商业发票预览')}
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">
                    {invoicePreviewTemplateName}
                  </span>
                </h2>
                <div className="flex items-center gap-3">
	                  <Button
	                    type="button"
	                    onClick={handleExportInvoice}
	                    disabled={!selectedOrder?.generated || invoiceExporting}
	                    className="px-5 py-2 text-sm font-medium flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed">
	                    {invoiceExporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
	                    {invoiceExporting ? t('导出中') : t('导出 PDF')}
                  </Button>
                  <Button variant="unstyled"
                type="button"
                aria-label={t('关闭发票预览窗口')}
                onClick={closeActiveModal}
                disabled={invoiceExporting}
                className="flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50">
                
                    <X className="w-5 h-5" />
                  </Button>
                </div>
              </div>
              <div className="p-6 overflow-y-auto bg-slate-100/60 flex-1 flex justify-center">
                {/* TEMPLATE A: WEOXY (Standard) */}
                {invoicePreviewTemplate === 'weoxy' &&
            <div className="relative w-full max-w-3xl overflow-hidden bg-white p-10 font-sans text-[#0a2342] tabular-nums elevation-1">
                    <div className="flex justify-between items-start mb-12">
                      <h1 className="text-5xl font-black text-[#0a2342]">
                        WEOXY.CO
                      </h1>
                      <div className="text-right">
                        <h2 className="mb-1 text-2xl font-black text-[#0a2342]">
                          INVOICE
                        </h2>
                        <p className="text-sm text-[#0a2342]">{invoicePreviewTemplateName}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-8 mb-10 text-sm">
                      <div className="space-y-4">
                        <div>
                          <h4 className="font-bold mb-1">Seller:</h4>
                          <p>{t('企业信息未配置')}</p>
                        </div>
                        <div>
                          <h4 className="font-bold mb-1">Bill To:</h4>
                          <p>{invoicePreviewInfo.customer}</p>
                        </div>
                      </div>
                      <div className="text-right space-y-1">
                        <div className="flex justify-end gap-2">
                          <span className="font-bold">Invoice:</span>
	                          <span>#{orderDetails.invoiceNo || t('未生成')}</span>
                        </div>
                        <div className="flex justify-end gap-2">
                          <span className="font-bold">Date:</span>
                          <span>{invoicePreviewInfo.date}</span>
                        </div>
                        <div className="flex justify-end gap-2">
                          <span className="font-bold">Purchase Order:</span>
                          <span>{invoicePreviewInfo.orderId}</span>
                        </div>
                      </div>
                    </div>

                    <Table className="w-full text-sm mb-12">
                      <TableHeader>
                        <TableRow className="border-y-4 border-[#0a2342]">
                          <TableHead className="py-3 text-left font-bold uppercase">
                            DESCRIPTION
                          </TableHead>
                          <TableHead className="py-3 text-right font-bold uppercase">
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
                        <span>Invoice Total</span>
                        <span>{invoicePreviewAmountText}</span>
                      </div>
                    </div>

                    <div className="border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                      <h4 className="mb-1 font-bold">{t('企业与收款信息')}</h4>
                      <p className="text-pretty">{t('未配置的企业、地址和收款信息不会出现在预览或导出文件中，请由财务复核后再对外发送。')}</p>
                    </div>
                  </div>
            }

                {/* TEMPLATE B: INOGI (Consolidated) */}
                {invoicePreviewTemplate === 'inogi' &&
            <div className="flex w-full max-w-3xl flex-col font-sans tabular-nums elevation-1">
                    <div className="bg-[#0a2342] text-white p-10 pb-12">
                      <div className="flex justify-between items-start mb-12">
                        <h1 className="text-5xl font-bold">
                          INOGI
                        </h1>
                        <div className="text-right">
                          <h2 className="mb-1 text-xl font-bold">
                            INVOICE SERVICE
                          </h2>
                          <p className="text-sm opacity-90">{invoicePreviewTemplateName}</p>
                        </div>
                      </div>

                      <h2 className="text-3xl font-bold mb-10">
                        Final Consolidated Balance Invoice
                      </h2>

                      <div className="grid grid-cols-2 gap-8 mb-10 text-sm">
                        <div>
                          <h4 className="mb-1 text-lg font-bold uppercase">
                            CLIENT NAME
                          </h4>
                          <p className="font-bold text-base mb-1">
                            {invoicePreviewInfo.customer}
                          </p>
                        </div>
                        <div className="text-right space-y-1 font-medium">
                          <div className="flex justify-end gap-2">
                            <span>Invoice:</span>
	                            <span>#{orderDetails.invoiceNo || t('未生成')}</span>
                          </div>
                          <div className="flex justify-end gap-2">
                            <span>Date:</span>
                            <span>{invoicePreviewInfo.date}</span>
                          </div>
                          <div className="flex justify-end gap-2">
                            <span>Purchase Order:</span>
                            <span>{invoicePreviewInfo.orderId}</span>
                          </div>
                        </div>
                      </div>

                      <Table className="w-full text-base mb-10">
                        <TableHeader>
                          <TableRow className="border-b-4 border-white">
                            <TableHead className="py-3 text-left font-bold uppercase">
                              ORIGINAL INVOICE AMOUNT
                            </TableHead>
                            <TableHead className="py-3 text-right font-bold uppercase">
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
                      </div>
                    </div>

                    <div className="flex-1 bg-[#e2e2e2] p-10 pt-8 text-[#0a2342]">
                      <div className="border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                        <h4 className="mb-1 font-bold">{t('企业与收款信息')}</h4>
                        <p className="text-pretty">{t('当前模板未提供经过审核的企业、地址或收款资料，因此这些字段已从预览中省略。')}</p>
                      </div>
                    </div>
                  </div>
            }

                {/* TEMPLATE C: AI GENERATED */}
                {invoicePreviewTemplate.startsWith('ai-') &&
            <div className="relative w-full max-w-3xl overflow-hidden bg-white p-10 font-sans tabular-nums elevation-1">
                    {/* Decorative header accent */}
                    <div className="absolute top-0 left-0 w-full h-3 bg-primary"></div>

                    <div className="flex justify-between items-start mb-12 mt-4">
                      <div>
                        <div className="mb-4 flex size-12 items-center justify-center rounded-xl bg-accent">
                          <Layers className="size-6 text-primary" />
                        </div>
                        <h1 className="mb-1 text-3xl font-bold text-slate-800">
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
	                            #{orderDetails.invoiceNo || t('未生成')}
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
                      <div className="rounded-2xl border border-[#c8d6ff] bg-accent p-5">
                        <h4 className="mb-3 text-xs font-bold uppercase text-primary">
                          Billed To
                        </h4>
                        <p className="font-bold text-slate-800 text-lg mb-1">
                          {invoicePreviewInfo.customer}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-900">
                        <h4 className="mb-3 text-xs font-bold uppercase text-slate-500">
                          From
                        </h4>
                        <p className="text-pretty text-sm">{t('企业信息未配置，导出时将省略未审核的企业与收款字段。')}</p>
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
                        <div className="flex justify-between py-3 text-lg font-bold text-primary">
                          <span>Invoice Total</span>
                          <span>{invoicePreviewAmountText}</span>
                        </div>
                      </div>
                    </div>

                    <div className="border-t border-slate-200 pt-6 text-sm text-slate-500">
                      <p className="text-pretty">{t('付款条件、税费和收款信息仅在模板中经过审核并明确配置后展示。')}</p>
                    </div>
                  </div>
            }
              </div>
            </WorkbenchDialogSurface>
    </div>
  );

}
