import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import {
  AlertCircle,
  CalendarDays,
  Download,
  Eye,
  FileSpreadsheet,
  Filter,
  PackageCheck,
  RefreshCw,
  Search,
  Truck,
  Upload,
} from 'lucide-react';

import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
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

export type PurchaseOrderStatus = '待确认' | '已下单' | '部分到货' | '已完成' | '异常';

export type PurchaseOrderLine = {
  sku: string;
  name: string;
  spec: string;
  unit: string;
  qty: number;
  receivedQty: number;
  unitPrice: number;
};

export type PurchaseOrder = {
  id: string;
  poNo: string;
  supplier: string;
  supplierContact?: string;
  supplierPhone?: string;
  supplierEmail?: string;
  buyer: string;
  status: PurchaseOrderStatus;
  orderDate: string;
  etaDate: string;
  itemCount: number;
  amount: number;
  currency: 'CNY' | 'USD';
  warehouse: string;
  owner: string;
  paymentTerm?: string;
  deliveryTerm?: string;
  invoiceType?: string;
  approvalStatus?: string;
  remark?: string;
  items?: PurchaseOrderLine[];
  sourceFile?: string;
};

export const STATUS_OPTIONS: PurchaseOrderStatus[] = ['待确认', '已下单', '部分到货', '已完成', '异常'];
export const PURCHASE_ORDER_STORAGE_KEY = 'inogi:purchase-orders:v1';

export const INITIAL_PURCHASE_ORDERS: PurchaseOrder[] = [
  {
    id: 'po-20260601-001',
    poNo: 'PO-20260601-001',
    supplier: '苏州晨光电子商务有限公司',
    supplierContact: '赵经理',
    supplierPhone: '138-0000-6101',
    supplierEmail: 'sales@suzhou-chen.example.com',
    buyer: '王芳',
    status: '待确认',
    orderDate: '2026-06-01',
    etaDate: '2026-06-08',
    itemCount: 3,
    amount: 19480,
    currency: 'CNY',
    warehouse: '主仓 - 上海',
    owner: '采购一组',
    paymentTerm: '月结 30 天',
    deliveryTerm: '供应商送货',
    invoiceType: '增值税专用发票',
    approvalStatus: '待采购主管确认',
    remark: '耳机与线材为补库急单，请优先确认交期。',
    items: [
      { sku: 'BT-001', name: '无线蓝牙耳机', spec: '黑色', unit: '个', qty: 120, receivedQty: 0, unitPrice: 89 },
      { sku: 'TC-002', name: 'Type-C 数据线', spec: '1m 白色', unit: '条', qty: 300, receivedQty: 0, unitPrice: 12 },
      { sku: 'PB-100', name: '移动电源 10000mAh', spec: '黑色', unit: '个', qty: 80, receivedQty: 0, unitPrice: 65 },
    ],
  },
  {
    id: 'po-20260531-014',
    poNo: 'PO-20260531-014',
    supplier: '杭州优品电子有限公司',
    supplierContact: '刘欣',
    supplierPhone: '0571-8800-1024',
    supplierEmail: 'po@youpin.example.com',
    buyer: '李华',
    status: '已下单',
    orderDate: '2026-05-31',
    etaDate: '2026-06-06',
    itemCount: 2,
    amount: 11580,
    currency: 'CNY',
    warehouse: '华东备货仓',
    owner: '采购二组',
    paymentTerm: '预付 30%，到货付清',
    deliveryTerm: '物流到仓',
    invoiceType: '普通发票',
    approvalStatus: '已审批',
    remark: '供应商已确认 2026-06-06 前发货。',
    items: [
      { sku: 'SP-002', name: '蓝牙音箱', spec: '灰色', unit: '台', qty: 60, receivedQty: 0, unitPrice: 118 },
      { sku: 'HS-005', name: '手机支架', spec: '铝合金', unit: '个', qty: 180, receivedQty: 0, unitPrice: 25 },
    ],
  },
  {
    id: 'po-20260530-009',
    poNo: 'PO-20260530-009',
    supplier: '广东宏达科技有限公司',
    supplierContact: '陈伟',
    supplierPhone: '020-6600-8899',
    supplierEmail: 'supply@hongda.example.com',
    buyer: '陈晨',
    status: '部分到货',
    orderDate: '2026-05-30',
    etaDate: '2026-06-04',
    itemCount: 3,
    amount: 33200,
    currency: 'CNY',
    warehouse: '主仓 - 上海',
    owner: '采购一组',
    paymentTerm: '月结 45 天',
    deliveryTerm: '分批到货',
    invoiceType: '增值税专用发票',
    approvalStatus: '已审批',
    remark: '第一批已入库，第二批等待承运商排车。',
    items: [
      { sku: 'HD-010', name: 'HDMI高清线', spec: '2m', unit: '条', qty: 500, receivedQty: 260, unitPrice: 28 },
      { sku: 'BOX-022', name: '包装纸箱', spec: '中号', unit: '个', qty: 1200, receivedQty: 600, unitPrice: 5 },
      { sku: 'AD-011', name: '多功能转换器', spec: '7合1', unit: '个', qty: 150, receivedQty: 50, unitPrice: 88 },
    ],
  },
  {
    id: 'po-20260529-017',
    poNo: 'PO-20260529-017',
    supplier: '深圳市捷通实业有限公司',
    supplierContact: '黄倩',
    supplierPhone: '0755-8899-1200',
    supplierEmail: 'service@jietong.example.com',
    buyer: '周敏',
    status: '异常',
    orderDate: '2026-05-29',
    etaDate: '2026-06-02',
    itemCount: 2,
    amount: 9600,
    currency: 'CNY',
    warehouse: '华南中转仓',
    owner: '采购三组',
    paymentTerm: '货到 15 天',
    deliveryTerm: '供应商送货',
    invoiceType: '增值税专用发票',
    approvalStatus: '异常待处理',
    remark: '供应商反馈键盘缺料，需采购员确认替代型号。',
    items: [
      { sku: 'KB-008', name: '机械键盘', spec: '87键', unit: '个', qty: 40, receivedQty: 0, unitPrice: 168 },
      { sku: 'MS-006', name: '无线鼠标', spec: '静音', unit: '个', qty: 90, receivedQty: 0, unitPrice: 32 },
    ],
  },
  {
    id: 'po-20260525-003',
    poNo: 'PO-20260525-003',
    supplier: '南京耀华供应链有限公司',
    supplierContact: '沈南',
    supplierPhone: '025-8800-5521',
    supplierEmail: 'sales@yaohua.example.com',
    buyer: '王芳',
    status: '已完成',
    orderDate: '2026-05-25',
    etaDate: '2026-05-31',
    itemCount: 2,
    amount: 9400,
    currency: 'CNY',
    warehouse: '主仓 - 上海',
    owner: '采购一组',
    paymentTerm: '月结 30 天',
    deliveryTerm: '物流到仓',
    invoiceType: '普通发票',
    approvalStatus: '已关闭',
    remark: '已完成验收入库。',
    items: [
      { sku: 'CL-020', name: '屏幕清洁套装', spec: '100ml', unit: '套', qty: 300, receivedQty: 300, unitPrice: 18 },
      { sku: 'BOX-022', name: '包装纸箱', spec: '中号', unit: '个', qty: 800, receivedQty: 800, unitPrice: 5 },
    ],
  },
];

export function formatCurrency(value: number, currency: PurchaseOrder['currency']) {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(value);
}

function formatDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parseNumber(value: unknown) {
  const text = String(value ?? '').replace(/[^\d.-]/g, '');
  const number = Number(text);
  return Number.isFinite(number) ? number : 0;
}

function parseDateValue(value: unknown) {
  if (typeof value === 'number' && value > 25569) {
    return formatDateInput(new Date((value - 25569) * 86400 * 1000));
  }
  const text = String(value ?? '').trim();
  if (!text) return '';
  const normalized = text.replace(/\./g, '-').replace(/\//g, '-');
  const parsed = new Date(normalized);
  if (!Number.isNaN(parsed.getTime())) return formatDateInput(parsed);
  const monthDay = normalized.match(/^(\d{1,2})-(\d{1,2})$/);
  if (monthDay) {
    const year = new Date().getFullYear();
    const date = new Date(year, Number(monthDay[1]) - 1, Number(monthDay[2]));
    return formatDateInput(date);
  }
  return '';
}

function readField(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const direct = row[key];
    if (direct !== undefined && String(direct).trim()) return direct;
    const matchedKey = Object.keys(row).find((candidate) => candidate.trim().toLowerCase() === key.trim().toLowerCase());
    if (matchedKey && String(row[matchedKey]).trim()) return row[matchedKey];
  }
  return '';
}

function normalizeStatus(value: unknown): PurchaseOrderStatus {
  const text = String(value ?? '').trim();
  if (STATUS_OPTIONS.includes(text as PurchaseOrderStatus)) return text as PurchaseOrderStatus;
  if (/异常|取消|逾期|错误/.test(text)) return '异常';
  if (/完成|关闭|已入库/.test(text)) return '已完成';
  if (/部分|到货中/.test(text)) return '部分到货';
  if (/下单|已发|采购中/.test(text)) return '已下单';
  return '待确认';
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

export function loadStoredOrders() {
  if (typeof window === 'undefined') return INITIAL_PURCHASE_ORDERS;
  try {
    const raw = window.localStorage.getItem(PURCHASE_ORDER_STORAGE_KEY);
    if (!raw) return INITIAL_PURCHASE_ORDERS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return INITIAL_PURCHASE_ORDERS;
    const initialById = new Map(INITIAL_PURCHASE_ORDERS.map((order) => [order.id, order]));
    const initialByPoNo = new Map(INITIAL_PURCHASE_ORDERS.map((order) => [order.poNo, order]));
    const stored = parsed.filter((item) => item && typeof item === 'object' && typeof item.poNo === 'string') as PurchaseOrder[];
    const merged = stored.map((item) => {
      const base = initialById.get(item.id) ?? initialByPoNo.get(item.poNo);
      if (base && !item.sourceFile) {
        return {
          ...item,
          ...base,
          items: base.items?.length ? base.items : item.items,
        };
      }
      return {
        ...base,
        ...item,
        items: item.items?.length ? item.items : base?.items,
      };
    });
    const seen = new Set(merged.map((order) => order.id));
    const missingInitial = INITIAL_PURCHASE_ORDERS.filter((order) => !seen.has(order.id));
    return [...merged, ...missingInitial];
  } catch {
    return INITIAL_PURCHASE_ORDERS;
  }
}

function normalizeImportedOrder(row: Record<string, unknown>, index: number, fileName: string): PurchaseOrder {
  const today = formatDateInput(new Date());
  const poNo =
    String(readField(row, ['采购单号', '采购订单号', 'PO号', 'PO No', 'PO', '单号', 'poNo']) || '').trim() ||
    `PO-IMPORT-${Date.now()}-${index + 1}`;
  const etaDate = parseDateValue(readField(row, ['预计到货日', '预计到货', '交期', 'ETA', '到货日期'])) || today;
  return {
    id: `${poNo}-${index}-${Date.now()}`,
    poNo,
    supplier: String(readField(row, ['供应商', '供应商名称', 'Supplier', 'Vendor']) || '未命名供应商').trim(),
    supplierContact: String(readField(row, ['供应商联系人', '联系人', 'Contact']) || '').trim(),
    supplierPhone: String(readField(row, ['供应商电话', '联系电话', 'Phone']) || '').trim(),
    supplierEmail: String(readField(row, ['供应商邮箱', '邮箱', 'Email']) || '').trim(),
    buyer: String(readField(row, ['采购员', '采购负责人', 'Buyer']) || '未指定').trim(),
    status: normalizeStatus(readField(row, ['状态', '订单状态', 'Status'])),
    orderDate: parseDateValue(readField(row, ['下单日期', '订单日期', '采购日期', 'Order Date'])) || today,
    etaDate,
    itemCount: Math.max(0, Math.round(parseNumber(readField(row, ['SKU数', '商品数', '明细数', 'Item Count', '数量'])))),
    amount: parseNumber(readField(row, ['金额', '采购金额', '总金额', 'Amount', 'Total'])),
    currency: String(readField(row, ['币种', 'Currency'])).toUpperCase() === 'USD' ? 'USD' : 'CNY',
    warehouse: String(readField(row, ['仓库', '到货仓', 'Warehouse']) || '主仓 - 上海').trim(),
    owner: String(readField(row, ['采购组', '部门', 'Owner']) || '采购一组').trim(),
    paymentTerm: String(readField(row, ['付款条件', '账期', 'Payment Term']) || '').trim(),
    deliveryTerm: String(readField(row, ['交付方式', '运输方式', 'Delivery Term']) || '').trim(),
    invoiceType: String(readField(row, ['发票类型', 'Invoice Type']) || '').trim(),
    approvalStatus: String(readField(row, ['审批状态', 'Approval']) || '').trim(),
    remark: String(readField(row, ['备注', '说明', 'Remark']) || '').trim(),
    sourceFile: fileName,
  };
}

export function PurchaseOrders() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [orders, setOrders] = useState<PurchaseOrder[]>(loadStoredOrders);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [supplierFilter, setSupplierFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [importing, setImporting] = useState(false);

  const suppliers = useMemo(() => Array.from(new Set(orders.map((order) => order.supplier))).sort(), [orders]);

  useEffect(() => {
    window.localStorage.setItem(PURCHASE_ORDER_STORAGE_KEY, JSON.stringify(orders));
  }, [orders]);

  const filteredOrders = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return orders.filter((order) => {
      const matchesKeyword =
        !keyword ||
        [order.poNo, order.supplier, order.buyer, order.warehouse, order.owner].some((value) => value.toLowerCase().includes(keyword));
      const matchesStatus = statusFilter === 'all' || order.status === statusFilter;
      const matchesSupplier = supplierFilter === 'all' || order.supplier === supplierFilter;
      const matchesStart = !dateFrom || order.etaDate >= dateFrom;
      const matchesEnd = !dateTo || order.etaDate <= dateTo;
      return matchesKeyword && matchesStatus && matchesSupplier && matchesStart && matchesEnd;
    });
  }, [dateFrom, dateTo, orders, query, statusFilter, supplierFilter]);

  const stats = useMemo(() => {
    const open = orders.filter((order) => order.status === '待确认' || order.status === '已下单').length;
    const inbound = orders.filter((order) => order.status === '部分到货').length;
    const abnormal = orders.filter((order) => order.status === '异常').length;
    const amount = orders.reduce((sum, order) => sum + order.amount, 0);
    return { total: orders.length, open, inbound, abnormal, amount };
  }, [orders]);

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
      const [{ default: XLSX }, buffer] = await Promise.all([
        import('xlsx') as Promise<{ default: typeof import('xlsx') }>,
        file.arrayBuffer(),
      ]);
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) throw new Error('未识别到可导入的工作表');
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[firstSheetName], { defval: '' });
      const imported = rows
        .filter((row) => Object.values(row).some((value) => String(value).trim()))
        .map((row, index) => normalizeImportedOrder(row, index, file.name));
      if (imported.length === 0) throw new Error('文件中没有可导入的采购订单');
      setOrders((current) => [...imported, ...current]);
      toast.success(`已导入 ${imported.length} 条采购订单`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '采购订单导入失败');
    } finally {
      setImporting(false);
    }
  };

  const downloadTemplate = () => {
    const header = ['采购单号', '供应商', '采购员', '状态', '下单日期', '预计到货日', 'SKU数', '金额', '币种', '仓库', '采购组'];
    const sample = ['PO-20260601-001', '示例供应商', '王芳', '待确认', '2026-06-01', '2026-06-08', '8', '28650', 'CNY', '主仓 - 上海', '采购一组'];
    const blob = new Blob([`\uFEFF${header.join(',')}\n${sample.join(',')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = '采购订单导入模板.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-slate-50 px-5 py-4">
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
            订单与库存
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal text-slate-900">采购订单</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={downloadTemplate}
            className="h-9 border-slate-200 bg-white px-3 text-slate-600 shadow-sm hover:bg-slate-50">
            <Download className="h-4 w-4" />
            模板
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={importing}
            onClick={() => fileInputRef.current?.click()}
            className="h-9 bg-blue-600 px-3 text-white shadow-sm shadow-blue-200 hover:bg-blue-700">
            {importing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            导入
          </Button>
        </div>
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-slate-100 bg-white px-4 py-3 shadow-sm">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>采购单数</span>
            <FileSpreadsheet className="h-4 w-4 text-blue-500" />
          </div>
          <div className="mt-2 text-2xl font-semibold text-slate-900">{stats.total}</div>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white px-4 py-3 shadow-sm">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>待推进</span>
            <Truck className="h-4 w-4 text-indigo-500" />
          </div>
          <div className="mt-2 text-2xl font-semibold text-slate-900">{stats.open}</div>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white px-4 py-3 shadow-sm">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>部分到货</span>
            <CalendarDays className="h-4 w-4 text-amber-500" />
          </div>
          <div className="mt-2 text-2xl font-semibold text-slate-900">{stats.inbound}</div>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white px-4 py-3 shadow-sm">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>异常</span>
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
                placeholder="搜索采购单号、供应商、采购员..."
                className="h-9 rounded-full border-slate-200 bg-slate-50 pl-9 text-sm"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 w-[132px] rounded-full border-slate-200 bg-white text-sm">
                <SelectValue placeholder="状态" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部状态</SelectItem>
                {STATUS_OPTIONS.map((status) => (
                  <SelectItem key={status} value={status}>
                    {status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={supplierFilter} onValueChange={setSupplierFilter}>
              <SelectTrigger className="h-9 w-[176px] rounded-full border-slate-200 bg-white text-sm">
                <SelectValue placeholder="供应商" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部供应商</SelectItem>
                {suppliers.map((supplier) => (
                  <SelectItem key={supplier} value={supplier}>
                    {supplier}
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
              重置
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          <Table containerClassName="max-h-full overflow-auto">
            <TableHeader className="sticky top-0 z-10 bg-slate-50">
              <TableRow className="border-slate-100">
                <TableHead className="px-4">采购单号</TableHead>
                <TableHead>供应商</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>采购员</TableHead>
                <TableHead>下单日期</TableHead>
                <TableHead>预计到货</TableHead>
                <TableHead className="text-right">SKU</TableHead>
                <TableHead className="text-right">金额</TableHead>
                <TableHead>到货仓</TableHead>
                <TableHead>来源</TableHead>
                <TableHead className="sticky right-0 bg-slate-50 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredOrders.map((order) => (
                <TableRow key={order.id} className="border-slate-100">
                  <TableCell className="px-4 font-mono text-sm text-slate-800">{order.poNo}</TableCell>
                  <TableCell className="max-w-[220px] truncate font-medium text-slate-800">{order.supplier}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={`rounded-full px-2.5 py-1 font-medium ${statusBadgeClass(order.status)}`}>
                      {order.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-slate-600">{order.buyer}</TableCell>
                  <TableCell className="text-slate-600">{order.orderDate}</TableCell>
                  <TableCell className="text-slate-800">{order.etaDate}</TableCell>
                  <TableCell className="text-right text-slate-700">{order.itemCount}</TableCell>
                  <TableCell className="text-right font-semibold text-slate-900">{formatCurrency(order.amount, order.currency)}</TableCell>
                  <TableCell className="text-slate-600">{order.warehouse}</TableCell>
                  <TableCell className="max-w-[160px] truncate text-slate-500">{order.sourceFile || '系统样例'}</TableCell>
                  <TableCell className="sticky right-0 bg-white text-right">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => navigate(`/purchase-orders/${encodeURIComponent(order.id)}`)}
                      className="h-8 rounded-full border-blue-100 bg-blue-50 px-3 text-xs font-medium text-blue-700 hover:bg-blue-100">
                      <Eye className="h-3.5 w-3.5" />
                      查看
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {filteredOrders.length === 0 && (
                <TableRow>
                  <TableCell colSpan={11} className="h-28 text-center text-sm text-slate-400">
                    暂无匹配的采购订单
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
          <span>
            显示 {filteredOrders.length} / 共 {orders.length} 条
          </span>
          <span>合计金额 {formatCurrency(stats.amount, 'CNY')}</span>
        </div>
      </div>
    </div>
  );
}
