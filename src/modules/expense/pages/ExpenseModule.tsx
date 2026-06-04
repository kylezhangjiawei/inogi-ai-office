import { useCallback, useEffect, useMemo, useRef, useState, Fragment } from 'react';
import {
  ChevronLeft,
  Wallet,
  Upload,
  Sparkles,
  Receipt,
  FileText,
  Link2,
  Archive,
  CheckCircle,
  Clock,
  XCircle,
  AlertCircle,
  Search,
  Calendar,
  Download,
  ChevronRight,
  ChevronDown,
  Send,
  TrendingUp,
  Filter,
  Check,
  X,
  Loader2,
  MessageCircle,
  FileDown,
  Plus,
  FolderOpen } from
'lucide-react';
import {
  MOCK_EXPENSE_VOUCHERS,
  MOCK_INVOICE_VOUCHERS,
  MOCK_APPROVALS } from
'../mocks/expenseImportedMock';
import { expenseService } from '../services/expenseService';
import type { InvoiceRecord, ReimbursementRecord, VoucherUploadRecord } from '../types';
import { Badge } from '../../../app/components/ui/badge';
import { Button } from '../../../app/components/ui/button';
import { Checkbox } from '../../../app/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../app/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../../app/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../app/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '../../../app/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '../../../app/components/ui/toggle-group';

type ExpenseVoucherView = {
  id: string;
  vendor: string;
  amount: number;
  date: string;
  category: string;
  type: string;
  matched: boolean;
  matchedTo?: string;
  thumbColor: string;
  sourceInvoiceId?: string;
  sourceInvoiceStatus?: InvoiceRecord['status'];
  sourceVoucherId?: string;
};

type InvoiceVoucherView = {
  id: string;
  issuer: string;
  invoiceNumber: string;
  amount: number;
  taxAmount: number;
  date: string;
  type: string;
  matched: boolean;
  matchedTo?: string;
  status?: InvoiceRecord['status'];
  sourceInvoiceId?: string;
};

type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'draft';

type ApprovalFlowStep = {
  name: string;
  role: string;
  status: 'done' | 'current' | 'pending' | 'rejected';
  time: string;
  remark?: string;
};

type ApprovalMaterialItem = {
  invoiceId: string;
  invoiceNo: string;
  invoiceIssuer: string;
  invoiceDate: string;
  invoiceAmount: number;
  voucherId: string;
  voucherNo: string;
  voucherVendor: string;
  voucherDate: string;
  voucherAmount: number;
  category: string;
};

type ApprovalView = {
  id: string;
  title: string;
  applicant: string;
  department: string;
  amount: number;
  submitDate: string;
  currentStep: number;
  totalSteps: number;
  status: ApprovalStatus;
  items: number;
  invoiceIds?: string[];
  voucherIds?: string[];
  materials?: ApprovalMaterialItem[];
  flow: ApprovalFlowStep[];
};

type ReimbursementInspector = {
  itemId: string;
  kind: 'invoice' | 'link';
};

const expenseCategoryColor: Record<string, string> = {
  餐饮: 'bg-orange-100',
  交通: 'bg-blue-100',
  差旅: 'bg-purple-100',
  办公: 'bg-rose-100',
  采购: 'bg-emerald-100',
  其他: 'bg-slate-100',
};

const toErrorMessage = (error: unknown) => error instanceof Error ? error.message : '操作失败';

const formatMoney = (value: number) => `¥${value.toFixed(2)}`;
const REIMBURSEMENT_PAGE_SIZE = 4;

function isSuccessfullyApprovedInvoice(status?: InvoiceRecord['status']) {
  return status === '已报销';
}

function isInvoiceMatched(invoice: InvoiceRecord) {
  return Boolean(invoice.voucherNo || invoice.matchedVoucherId || invoice.status === '已关联' || invoice.status === '已报销');
}

function getVoucherSubmitId(item: ExpenseVoucherView) {
  return item.sourceVoucherId ?? item.id;
}

function findInvoiceForExpenseItem(item: ExpenseVoucherView, invoices: InvoiceVoucherView[]) {
  return invoices.find((invoice) =>
    invoice.id === item.matchedTo ||
    invoice.sourceInvoiceId === item.matchedTo ||
    (Boolean(item.sourceInvoiceId) && invoice.id === item.sourceInvoiceId) ||
    (Boolean(item.sourceInvoiceId) && invoice.sourceInvoiceId === item.sourceInvoiceId)
  );
}

function buildApprovalMaterialsFromItems(items: ExpenseVoucherView[], invoices: InvoiceVoucherView[]): ApprovalMaterialItem[] {
  return items.map((item) => {
    const invoice = findInvoiceForExpenseItem(item, invoices);
    return {
      invoiceId: invoice?.sourceInvoiceId ?? invoice?.id ?? item.matchedTo ?? '-',
      invoiceNo: invoice?.invoiceNumber ?? item.matchedTo ?? '-',
      invoiceIssuer: invoice?.issuer ?? '-',
      invoiceDate: invoice?.date ?? item.date,
      invoiceAmount: invoice?.amount ?? item.amount,
      voucherId: getVoucherSubmitId(item),
      voucherNo: item.id,
      voucherVendor: item.vendor,
      voucherDate: item.date,
      voucherAmount: item.amount,
      category: item.category,
    };
  });
}

function buildApprovalMaterialsFromIds(
  invoiceIds: string[] = [],
  voucherIds: string[] = [],
  expenses: ExpenseVoucherView[],
  invoices: InvoiceVoucherView[]
) {
  return invoiceIds.map((invoiceId, index) => {
    const item = expenses.find((voucher) =>
      voucher.matchedTo === invoiceId ||
      voucher.sourceInvoiceId === invoiceId ||
      voucher.id === voucherIds[index] ||
      voucher.sourceVoucherId === voucherIds[index]
    );
    if (item) {
      return buildApprovalMaterialsFromItems([item], invoices)[0];
    }
    const invoice = invoices.find((entry) => entry.id === invoiceId || entry.sourceInvoiceId === invoiceId);
    return {
      invoiceId,
      invoiceNo: invoice?.invoiceNumber ?? invoiceId,
      invoiceIssuer: invoice?.issuer ?? '-',
      invoiceDate: invoice?.date ?? '-',
      invoiceAmount: invoice?.amount ?? 0,
      voucherId: voucherIds[index] ?? invoice?.matchedTo ?? '-',
      voucherNo: voucherIds[index] ?? invoice?.matchedTo ?? '-',
      voucherVendor: '-',
      voucherDate: '-',
      voucherAmount: invoice?.amount ?? 0,
      category: invoice?.type ?? '费用',
    };
  });
}

function invoiceToInvoiceVoucher(invoice: InvoiceRecord): InvoiceVoucherView {
  const matchedTo = invoice.matchedVoucherId ?? invoice.voucherNo;
  return {
    id: invoice.id,
    issuer: invoice.vendor,
    invoiceNumber: invoice.invoiceNo,
    amount: invoice.amount,
    taxAmount: invoice.tax,
    date: invoice.issuedDate,
    type: invoice.thumbnailType === 'PDF' ? 'PDF 发票' : '增值税电子发票',
    matched: isInvoiceMatched(invoice),
    matchedTo,
    status: invoice.status,
    sourceInvoiceId: invoice.id,
  };
}

function invoiceToExpenseVoucher(invoice: InvoiceRecord): ExpenseVoucherView {
  const voucherId = invoice.matchedVoucherId ?? invoice.voucherNo ?? `EV-${invoice.id}`;
  const matched = isInvoiceMatched(invoice);
  return {
    id: voucherId,
    vendor: invoice.paymentVoucher ?? invoice.vendor,
    amount: invoice.amount,
    date: invoice.issuedDate,
    category: invoice.category,
    type: invoice.paymentVoucher ? '付款凭证' : invoice.thumbnailType,
    matched,
    matchedTo: matched ? invoice.id : undefined,
    thumbColor: expenseCategoryColor[invoice.category] ?? 'bg-slate-100',
    sourceInvoiceId: invoice.id,
    sourceInvoiceStatus: invoice.status,
    sourceVoucherId: invoice.matchedVoucherId,
  };
}

function uploadedVoucherToExpenseVoucher(voucher: VoucherUploadRecord): ExpenseVoucherView {
  return {
    id: voucher.id,
    vendor: voucher.counterparty ?? voucher.subject ?? voucher.fileName,
    amount: voucher.amount,
    date: voucher.date,
    category: '其他',
    type: voucher.detectedType ?? '付款凭证',
    matched: Boolean(voucher.matchedInvoiceId),
    matchedTo: voucher.matchedInvoiceId,
    thumbColor: 'bg-slate-100',
    sourceVoucherId: voucher.id,
  };
}

function reimbursementToApproval(reimbursement: ReimbursementRecord, materials: ApprovalMaterialItem[] = []): ApprovalView {
  const approved = reimbursement.status === '已通过' || reimbursement.status === '已付款';
  const rejected = reimbursement.status === '已驳回';
  const pending = reimbursement.status === '审批中';
  return {
    id: reimbursement.id,
    title: reimbursement.title,
    applicant: reimbursement.applicant,
    department: reimbursement.node || '费用报销',
    amount: reimbursement.amount,
    submitDate: reimbursement.weComUpdatedAt || reimbursement.appliedDate,
    currentStep: approved || rejected ? 4 : pending ? 3 : 1,
    totalSteps: 4,
    status: rejected ? 'rejected' : approved ? 'approved' : pending ? 'pending' : 'draft',
    items: materials.length || reimbursement.invoiceCount,
    invoiceIds: reimbursement.invoiceIds,
    voucherIds: reimbursement.voucherIds,
    materials,
    flow: [
      { name: reimbursement.applicant, role: '申请人', status: 'done', time: reimbursement.appliedDate },
      { name: '部门主管', role: '部门审批', status: approved || rejected || pending ? 'done' : 'pending', time: pending || approved || rejected ? reimbursement.appliedDate : '' },
      {
        name: reimbursement.weComApprover || '财务审核',
        role: '财务审核',
        status: rejected ? 'rejected' : approved ? 'done' : pending ? 'current' : 'pending',
        time: reimbursement.weComUpdatedAt,
        remark: rejected ? '审批驳回，请检查材料' : undefined,
      },
      { name: '出纳', role: '付款确认', status: reimbursement.status === '已付款' ? 'done' : 'pending', time: reimbursement.status === '已付款' ? reimbursement.weComUpdatedAt : '' },
    ],
  };
}

function mergeById<T extends { id: string }>(current: T[], incoming: T[]) {
  const next = new Map(current.map((item) => [item.id, item]));
  incoming.forEach((item) => next.set(item.id, item));
  return Array.from(next.values());
}

const TABS = [
{
  id: 'vouchers',
  label: '凭证管理',
  icon: Receipt
},
{
  id: 'archive',
  label: '归档分类',
  icon: Archive
},
{
  id: 'approval',
  label: '审批流',
  icon: CheckCircle
},
{
  id: 'buyback',
  label: '发票回购',
  icon: FileDown
}];

type TreeNode = {
  id: string;
  name: string;
  icon?: string;
  color?: string;
  // vendor keyword filters that map items into this leaf node
  vendorFilter?: string[];
  children?: TreeNode[];
};
const ARCHIVE_TREE: TreeNode[] = [
{
  id: 'cat-food',
  name: '餐饮',
  icon: '🍜',
  color: 'orange',
  children: [
  {
    id: 'cat-food-work',
    name: '工作餐',
    vendorFilter: ['星巴克']
  },
  {
    id: 'cat-food-host',
    name: '接待餐',
    vendorFilter: ['蜀大侠']
  },
  {
    id: 'cat-food-ot',
    name: '加班餐',
    vendorFilter: []
  }]

},
{
  id: 'cat-transport',
  name: '交通',
  icon: '🚗',
  color: 'blue',
  children: [
  {
    id: 'cat-transport-taxi',
    name: '打车',
    vendorFilter: ['滴滴', '出租车']
  },
  {
    id: 'cat-transport-rail',
    name: '高铁/动车',
    vendorFilter: ['高铁', '铁路']
  },
  {
    id: 'cat-transport-flight',
    name: '飞机',
    vendorFilter: ['航空']
  },
  {
    id: 'cat-transport-public',
    name: '地铁/公交',
    vendorFilter: ['地铁', '公交']
  }]

},
{
  id: 'cat-office',
  name: '办公',
  icon: '📦',
  color: 'rose',
  children: [
  {
    id: 'cat-office-supplies',
    name: '办公用品',
    vendorFilter: ['京东', '天猫']
  },
  {
    id: 'cat-office-print',
    name: '打印耗材',
    vendorFilter: []
  },
  {
    id: 'cat-office-software',
    name: '软件订阅',
    vendorFilter: []
  }]

},
{
  id: 'cat-travel',
  name: '差旅',
  icon: '🏨',
  color: 'purple',
  children: [
  {
    id: 'cat-travel-hotel',
    name: '酒店住宿',
    vendorFilter: ['锦江', '酒店']
  },
  {
    id: 'cat-travel-transport',
    name: '长途交通',
    vendorFilter: []
  },
  {
    id: 'cat-travel-meal',
    name: '差旅餐饮',
    vendorFilter: []
  }]

},
{
  id: 'cat-other',
  name: '其他',
  icon: '📄',
  color: 'slate',
  children: []
}];

export function ExpenseModule() {
  const [activeTab, setActiveTab] = useState('vouchers');
  const [selectedExpense, setSelectedExpense] = useState<string | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<string | null>(null);
  const [aiMatching, setAiMatching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expenseVouchers, setExpenseVouchers] = useState<ExpenseVoucherView[]>(
    MOCK_EXPENSE_VOUCHERS as ExpenseVoucherView[]
  );
  const [invoiceVouchers, setInvoiceVouchers] = useState<InvoiceVoucherView[]>(
    MOCK_INVOICE_VOUCHERS as InvoiceVoucherView[]
  );
  const [approvals, setApprovals] = useState<ApprovalView[]>(
    MOCK_APPROVALS as ApprovalView[]
  );
  const [selectedApproval, setSelectedApproval] = useState<ApprovalView | null>(
    (MOCK_APPROVALS as ApprovalView[])[0] ?? null
  );
  const [reimbursementDialogOpen, setReimbursementDialogOpen] = useState(false);
  const [reimbursementDraftItems, setReimbursementDraftItems] = useState<ExpenseVoucherView[]>([]);
  const [selectedReimbursementItemIds, setSelectedReimbursementItemIds] = useState<Set<string>>(
    () => new Set()
  );
  const [reimbursementPage, setReimbursementPage] = useState(1);
  const [reimbursementInspector, setReimbursementInspector] = useState<ReimbursementInspector | null>(null);
  const [reimbursementKeyword, setReimbursementKeyword] = useState('');
  const [reimbursementCategoryFilter, setReimbursementCategoryFilter] = useState('all');
  const [reimbursementSelectionFilter, setReimbursementSelectionFilter] = useState<'all' | 'selected' | 'unselected'>('all');
  const [reimbursementTitle, setReimbursementTitle] = useState('');
  const [reimbursementApplicant, setReimbursementApplicant] = useState('当前用户');
  const [reimbursementReason, setReimbursementReason] = useState('费用报销');
  const [submittingReimbursement, setSubmittingReimbursement] = useState(false);
  const expenseUploadInputRef = useRef<HTMLInputElement | null>(null);
  const invoiceUploadInputRef = useRef<HTMLInputElement | null>(null);
  const [dateRange, setDateRange] = useState({
    start: '2026-05-01',
    end: '2026-05-31'
  });
  const [archiveSelected, setArchiveSelected] = useState<string>('all');
  const [archiveExpanded, setArchiveExpanded] = useState<Set<string>>(
    new Set(['all', 'cat-food', 'cat-transport'])
  );

  const reloadExpenseData = useCallback(async () => {
    setLoading(true);
    try {
      const [invoices, reimbursements] = await Promise.all([
        expenseService.listInvoices(),
        expenseService.listReimbursements(),
      ]);
      let nextInvoiceVouchers: InvoiceVoucherView[] = [];
      let nextExpenseVouchers: ExpenseVoucherView[] = [];

      if (invoices.length) {
        nextInvoiceVouchers = invoices.map(invoiceToInvoiceVoucher);
        setInvoiceVouchers(nextInvoiceVouchers);
        nextExpenseVouchers = invoices
          .filter((invoice) => isInvoiceMatched(invoice))
          .map(invoiceToExpenseVoucher);
        if (nextExpenseVouchers.length) {
          setExpenseVouchers(nextExpenseVouchers);
        }
      }

      if (reimbursements.length) {
        const nextApprovals = reimbursements.map((reimbursement) =>
          reimbursementToApproval(
            reimbursement,
            buildApprovalMaterialsFromIds(
              reimbursement.invoiceIds,
              reimbursement.voucherIds,
              nextExpenseVouchers,
              nextInvoiceVouchers
            )
          )
        );
        setApprovals(nextApprovals);
        setSelectedApproval((current) =>
          nextApprovals.find((item) => item.id === current?.id) ?? nextApprovals[0] ?? current
        );
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reloadExpenseData();
  }, [reloadExpenseData]);

  const totalAmount = expenseVouchers.reduce((s, v) => s + v.amount, 0);
  const unmatched = expenseVouchers.filter((v) => !v.matched).length;
  const matched = expenseVouchers.filter((v) => v.matched).length;
  const totalInvoices = invoiceVouchers.length;
  const pendingApprovals = approvals.filter((a) => a.status === 'pending').length;
  const filteredInvoices = invoiceVouchers.filter((iv) => {
    return iv.date >= dateRange.start && iv.date <= dateRange.end;
  });
  const buybackTotal = filteredInvoices.reduce((s, v) => s + v.amount, 0);
  const buybackTax = filteredInvoices.reduce((s, v) => s + v.taxAmount, 0);

  const handleExpenseUpload = useCallback(async (files: File[]) => {
    if (!files.length) return;
    setLoading(true);
    try {
      const uploaded = await expenseService.uploadVoucherFiles(files);
      const nextVouchers = uploaded.map(uploadedVoucherToExpenseVoucher);
      setExpenseVouchers((current) => mergeById(current, nextVouchers));
      await reloadExpenseData();
    } catch (error) {
      window.alert(`上传报销凭证失败：${toErrorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  }, [reloadExpenseData]);

  const handleInvoiceUpload = useCallback(async (files: File[]) => {
    if (!files.length) return;
    setLoading(true);
    try {
      const uploaded = await expenseService.uploadInvoiceFiles(files);
      setInvoiceVouchers((current) => mergeById(current, uploaded.map(invoiceToInvoiceVoucher)));
      const matchedUploads = uploaded.filter((invoice) => isInvoiceMatched(invoice)).map(invoiceToExpenseVoucher);
      if (matchedUploads.length) {
        setExpenseVouchers((current) => mergeById(current, matchedUploads));
      }
      await reloadExpenseData();
    } catch (error) {
      window.alert(`上传发票凭证失败：${toErrorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  }, [reloadExpenseData]);

  const applyMatchLinks = useCallback((links: Array<{ invoice_id: string; voucher_id: string; voucher_no?: string }>) => {
    if (!links.length) return;
    setExpenseVouchers((current) =>
      current.map((voucher) => {
        const link = links.find((item) => item.voucher_id === voucher.sourceVoucherId || item.voucher_id === voucher.id || item.voucher_no === voucher.id);
        return link ? { ...voucher, matched: true, matchedTo: link.invoice_id } : voucher;
      })
    );
    setInvoiceVouchers((current) =>
      current.map((invoice) => {
        const link = links.find((item) => item.invoice_id === invoice.sourceInvoiceId || item.invoice_id === invoice.id);
        return link ? { ...invoice, matched: true, matchedTo: link.voucher_id || link.voucher_no } : invoice;
      })
    );
  }, []);

  const runLocalMatch = useCallback(() => {
    const unmatchedExpenses = expenseVouchers.filter((voucher) => !voucher.matched);
    const unmatchedInvoices = invoiceVouchers.filter((invoice) => !invoice.matched);
    const links: Array<{ invoice_id: string; voucher_id: string }> = [];
    const usedInvoiceIds = new Set<string>();

    unmatchedExpenses.forEach((voucher) => {
      const invoice = unmatchedInvoices.find((item) => {
        if (usedInvoiceIds.has(item.id)) return false;
        const amountMatched = Math.abs(item.amount - voucher.amount) < 1;
        const vendorMatched = item.issuer.includes(voucher.vendor.slice(0, 2)) || voucher.vendor.includes(item.issuer.slice(0, 2));
        return amountMatched || vendorMatched;
      });
      if (invoice) {
        usedInvoiceIds.add(invoice.id);
        links.push({ invoice_id: invoice.id, voucher_id: voucher.id });
      }
    });

    applyMatchLinks(links);
    return links.length;
  }, [applyMatchLinks, expenseVouchers, invoiceVouchers]);

  const runAiMatch = useCallback(async () => {
    setAiMatching(true);
    try {
      const result = await expenseService.autoMatchVouchers();
      if (result.links.length) {
        applyMatchLinks(result.links);
      } else {
        runLocalMatch();
      }
      await reloadExpenseData();
    } catch {
      runLocalMatch();
    } finally {
      window.setTimeout(() => setAiMatching(false), 700);
    }
  }, [applyMatchLinks, reloadExpenseData, runLocalMatch]);

  const handleManualLink = useCallback(() => {
    if (!selectedExpense || !selectedInvoice) {
      window.alert('请先在左右两侧各选择一条待关联凭证');
      return;
    }
    applyMatchLinks([{ invoice_id: selectedInvoice, voucher_id: selectedExpense }]);
  }, [applyMatchLinks, selectedExpense, selectedInvoice]);

  const openReimbursementDialog = useCallback((items?: ExpenseVoucherView[]) => {
    const sourceItems = items?.length ? items : expenseVouchers;
    const targetItems = sourceItems.filter((voucher) => {
      const invoice = findInvoiceForExpenseItem(voucher, invoiceVouchers);
      return voucher.matched && !isSuccessfullyApprovedInvoice(invoice?.status ?? voucher.sourceInvoiceStatus);
    });
    setReimbursementDraftItems(targetItems);
    setSelectedReimbursementItemIds(new Set(targetItems.map((item) => item.id)));
    setReimbursementPage(1);
    setReimbursementInspector(null);
    setReimbursementKeyword('');
    setReimbursementCategoryFilter('all');
    setReimbursementSelectionFilter('all');
    setReimbursementTitle(`${new Date().getMonth() + 1} 月费用报销申请`);
    setReimbursementApplicant('当前用户');
    setReimbursementReason(targetItems[0]?.category ? `${targetItems[0].category}费用报销` : '费用报销');
    setReimbursementDialogOpen(true);
  }, [expenseVouchers, invoiceVouchers]);

  const toggleReimbursementItem = useCallback((itemId: string) => {
    setSelectedReimbursementItemIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }, []);

  const toggleReimbursementCategory = useCallback((category: string) => {
    const categoryItemIds = reimbursementDraftItems
      .filter((item) => item.category === category)
      .map((item) => item.id);

    setSelectedReimbursementItemIds((current) => {
      const next = new Set(current);
      const allSelected = categoryItemIds.every((id) => next.has(id));
      categoryItemIds.forEach((id) => {
        if (allSelected) {
          next.delete(id);
        } else {
          next.add(id);
        }
      });
      return next;
    });
  }, [reimbursementDraftItems]);

  const closeReimbursementDialog = useCallback(() => {
    if (submittingReimbursement) return;
    setReimbursementDialogOpen(false);
  }, [submittingReimbursement]);

  const createLocalApproval = useCallback((items: ExpenseVoucherView[], title = '费用报销申请', applicant = '当前用户') => {
    const amount = items.reduce((sum, item) => sum + item.amount, 0);
    const now = new Date();
    const materials = buildApprovalMaterialsFromItems(items, invoiceVouchers);
    const created: ApprovalView = {
      id: `BX-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(approvals.length + 1).padStart(2, '0')}`,
      title,
      applicant,
      department: '费用报销',
      amount,
      submitDate: now.toISOString().slice(0, 16).replace('T', ' '),
      currentStep: 2,
      totalSteps: 4,
      status: 'pending',
      items: items.length,
      invoiceIds: materials.map((item) => item.invoiceId),
      voucherIds: materials.map((item) => item.voucherId),
      materials,
      flow: [
        { name: applicant, role: '申请人', status: 'done', time: now.toISOString().slice(0, 10) },
        { name: '部门主管', role: '部门主管', status: 'current', time: '' },
        { name: '财务审核', role: '财务审核', status: 'pending', time: '' },
        { name: '出纳', role: '付款确认', status: 'pending', time: '' },
      ],
    };
    setApprovals((current) => [created, ...current]);
    setSelectedApproval(created);
    setActiveTab('approval');
  }, [approvals.length, invoiceVouchers]);

  const handleConfirmCreateApproval = useCallback(async () => {
    const targetItems = reimbursementDraftItems.filter((item) =>
      selectedReimbursementItemIds.has(item.id)
    );
    const invoiceIds = Array.from(new Set(targetItems.map((item) => item.matchedTo).filter(Boolean) as string[]));
    const voucherIds = Array.from(new Set(targetItems.map(getVoucherSubmitId).filter(Boolean)));
    if (!targetItems.length || !invoiceIds.length) {
      window.alert('请先选择要报销的已关联发票');
      return;
    }
    const materials = buildApprovalMaterialsFromItems(targetItems, invoiceVouchers);
    const title = reimbursementTitle.trim() || `${new Date().getMonth() + 1} 月费用报销申请`;
    const applicant = reimbursementApplicant.trim() || '当前用户';
    const reason = reimbursementReason.trim() || '费用报销';

    setSubmittingReimbursement(true);
    try {
      const reimbursement = await expenseService.createReimbursement({
        title,
        applicant,
        project: targetItems[0]?.category ?? '费用报销',
        reason,
        invoice_ids: invoiceIds,
        voucher_ids: voucherIds,
      });
      let next = reimbursement;
      try {
        next = await expenseService.submitWeComApproval(reimbursement.id);
      } catch {
        // 企微未配置时，保留已创建的报销单并在页面中展示草稿/待提交状态。
      }
      const approval = reimbursementToApproval(next, materials);
      setApprovals((current) => mergeById([approval, ...current], [approval]));
      setSelectedApproval(approval);
      setActiveTab('approval');
      setReimbursementDialogOpen(false);
      await reloadExpenseData();
    } catch {
      createLocalApproval(targetItems, title, applicant);
      setReimbursementDialogOpen(false);
    } finally {
      setSubmittingReimbursement(false);
    }
  }, [createLocalApproval, invoiceVouchers, reimbursementApplicant, reimbursementDraftItems, reimbursementReason, reimbursementTitle, reloadExpenseData, selectedReimbursementItemIds]);

  const handleSyncSelectedApproval = useCallback(async () => {
    if (!selectedApproval) return;
    try {
      const reimbursement = await expenseService.syncWeComApproval(selectedApproval.id);
      const approval = reimbursementToApproval(
        reimbursement,
        buildApprovalMaterialsFromIds(
          reimbursement.invoiceIds,
          reimbursement.voucherIds,
          expenseVouchers,
          invoiceVouchers
        )
      );
      setApprovals((current) => mergeById(current, [approval]));
      setSelectedApproval(approval);
    } catch (error) {
      window.alert(`同步审批状态失败：${toErrorMessage(error)}`);
    }
  }, [expenseVouchers, invoiceVouchers, selectedApproval]);

  const getItemsForNode = (nodeId: string) => {
    const matchedItems = expenseVouchers.filter((v) => v.matched);
    if (nodeId === 'all') return matchedItems;
    // Find node in tree
    const findNode = (nodes: TreeNode[], id: string): TreeNode | null => {
      for (const n of nodes) {
        if (n.id === id) return n;
        if (n.children) {
          const found = findNode(n.children, id);
          if (found) return found;
        }
      }
      return null;
    };
    const node = findNode(ARCHIVE_TREE, nodeId);
    if (!node) return [];
    // Top-level category (no vendorFilter, has children) -> map by category name
    if (node.children && node.children.length > 0) {
      return matchedItems.filter((v) => v.category === node.name);
    }
    // Leaf node with vendorFilter
    if (node.vendorFilter && node.vendorFilter.length > 0) {
      return matchedItems.filter((v) =>
      node.vendorFilter!.some((k) => v.vendor.includes(k))
      );
    }
    // Empty leaf
    return [];
  };
  const toggleArchiveExpanded = (id: string) => {
    setArchiveExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);else
      next.add(id);
      return next;
    });
  };
  const selectedReimbursementItems = useMemo(
    () => reimbursementDraftItems.filter((item) => selectedReimbursementItemIds.has(item.id)),
    [reimbursementDraftItems, selectedReimbursementItemIds]
  );
  const reimbursementDraftGroups = useMemo(() => {
    const groups = new Map<string, ExpenseVoucherView[]>();
    reimbursementDraftItems.forEach((item) => {
      const category = item.category || '其他';
      const items = groups.get(category) ?? [];
      items.push(item);
      groups.set(category, items);
    });
    return Array.from(groups.entries()).map(([category, items]) => {
      const selectedItems = items.filter((item) => selectedReimbursementItemIds.has(item.id));
      return {
        category,
        items,
        selectedAmount: selectedItems.reduce((sum, item) => sum + item.amount, 0),
        selectedCount: selectedItems.length,
      };
    });
  }, [reimbursementDraftItems, selectedReimbursementItemIds]);
  const reimbursementCategoryOptions = useMemo(
    () => Array.from(new Set(reimbursementDraftItems.map((item) => item.category || '其他'))),
    [reimbursementDraftItems]
  );
  const filteredReimbursementItems = useMemo(() => {
    const keyword = reimbursementKeyword.trim().toLowerCase();
    return reimbursementDraftItems.filter((item) => {
      const invoice = findInvoiceForExpenseItem(item, invoiceVouchers);
      const selected = selectedReimbursementItemIds.has(item.id);
      const categoryMatched =
        reimbursementCategoryFilter === 'all' || item.category === reimbursementCategoryFilter;
      const selectionMatched =
        reimbursementSelectionFilter === 'all' ||
        (reimbursementSelectionFilter === 'selected' && selected) ||
        (reimbursementSelectionFilter === 'unselected' && !selected);
      const keywordMatched = !keyword || [
        item.id,
        item.vendor,
        item.category,
        item.type,
        item.date,
        item.matchedTo,
        item.sourceVoucherId,
        invoice?.issuer,
        invoice?.invoiceNumber,
        invoice?.type,
        invoice?.date,
      ].filter(Boolean).join(' ').toLowerCase().includes(keyword);
      return categoryMatched && selectionMatched && keywordMatched;
    });
  }, [
    invoiceVouchers,
    reimbursementCategoryFilter,
    reimbursementDraftItems,
    reimbursementKeyword,
    reimbursementSelectionFilter,
    selectedReimbursementItemIds,
  ]);
  const selectFilteredReimbursementItems = useCallback(() => {
    setSelectedReimbursementItemIds((current) => {
      const next = new Set(current);
      filteredReimbursementItems.forEach((item) => next.add(item.id));
      return next;
    });
  }, [filteredReimbursementItems]);
  const clearFilteredReimbursementItems = useCallback(() => {
    setSelectedReimbursementItemIds((current) => {
      const next = new Set(current);
      filteredReimbursementItems.forEach((item) => next.delete(item.id));
      return next;
    });
  }, [filteredReimbursementItems]);
  const resetReimbursementFilters = useCallback(() => {
    setReimbursementKeyword('');
    setReimbursementCategoryFilter('all');
    setReimbursementSelectionFilter('all');
    setReimbursementPage(1);
    setReimbursementInspector(null);
  }, []);
  const reimbursementFilterActive =
    reimbursementKeyword.trim() || reimbursementCategoryFilter !== 'all' || reimbursementSelectionFilter !== 'all';
  const reimbursementTotalPages = Math.max(1, Math.ceil(filteredReimbursementItems.length / REIMBURSEMENT_PAGE_SIZE));
  const reimbursementCurrentPage = Math.min(reimbursementPage, reimbursementTotalPages);
  const pagedReimbursementItems = useMemo(() => {
    const start = (reimbursementCurrentPage - 1) * REIMBURSEMENT_PAGE_SIZE;
    return filteredReimbursementItems.slice(start, start + REIMBURSEMENT_PAGE_SIZE);
  }, [filteredReimbursementItems, reimbursementCurrentPage]);
  const pagedReimbursementGroups = useMemo(() => {
    const groups = new Map<string, ExpenseVoucherView[]>();
    pagedReimbursementItems.forEach((item) => {
      const category = item.category || '其他';
      const items = groups.get(category) ?? [];
      items.push(item);
      groups.set(category, items);
    });
    return Array.from(groups.entries()).map(([category, items]) => {
      const selectedItems = items.filter((item) => selectedReimbursementItemIds.has(item.id));
      return {
        category,
        items,
        selectedAmount: selectedItems.reduce((sum, item) => sum + item.amount, 0),
        selectedCount: selectedItems.length,
      };
    });
  }, [pagedReimbursementItems, selectedReimbursementItemIds]);
  const reimbursementPageStart = filteredReimbursementItems.length
    ? (reimbursementCurrentPage - 1) * REIMBURSEMENT_PAGE_SIZE + 1
    : 0;
  const reimbursementPageEnd = Math.min(
    reimbursementCurrentPage * REIMBURSEMENT_PAGE_SIZE,
    filteredReimbursementItems.length
  );
  const inspectedReimbursementItem = reimbursementInspector
    ? reimbursementDraftItems.find((item) => item.id === reimbursementInspector.itemId)
    : undefined;
  const inspectedReimbursementInvoice = inspectedReimbursementItem
    ? findInvoiceForExpenseItem(inspectedReimbursementItem, invoiceVouchers)
    : undefined;
  const reimbursementDraftTotal = selectedReimbursementItems.reduce((sum, item) => sum + item.amount, 0);
  const reimbursementDraftInvoiceCount = new Set(
    selectedReimbursementItems.map((item) => item.matchedTo).filter(Boolean)
  ).size;
  const archiveActionItems = getItemsForNode(archiveSelected);
  const downloadCsv = useCallback((filename: string, rows: Array<Array<string | number>>) => {
    const csv = rows
      .map((row) =>
        row
          .map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`)
          .join(',')
      )
      .join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }, []);
  const exportArchiveItems = useCallback(() => {
    const rows: Array<Array<string | number>> = [
      ['报销凭证', '供应商', '分类', '日期', '金额', '关联发票', '开票方', '税额'],
      ...archiveActionItems.map((item) => {
        const invoice = findInvoiceForExpenseItem(item, invoiceVouchers);
        return [
          item.id,
          item.vendor,
          item.category,
          item.date,
          item.amount.toFixed(2),
          invoice?.invoiceNumber ?? '',
          invoice?.issuer ?? '',
          invoice?.taxAmount.toFixed(2) ?? '0.00',
        ];
      }),
    ];
    downloadCsv(`归档凭证-${archiveSelected}.csv`, rows);
  }, [archiveActionItems, archiveSelected, downloadCsv, invoiceVouchers]);
  const exportBuybackItems = useCallback(() => {
    const rows: Array<Array<string | number>> = [
      ['发票号码', '开票方', '类型', '日期', '价税合计', '税额', '状态'],
      ...filteredInvoices.map((invoice) => [
        invoice.invoiceNumber,
        invoice.issuer,
        invoice.type,
        invoice.date,
        invoice.amount.toFixed(2),
        invoice.taxAmount.toFixed(2),
        invoice.status ?? '',
      ]),
    ];
    downloadCsv(`发票回购-${dateRange.start}-${dateRange.end}.csv`, rows);
  }, [dateRange.end, dateRange.start, downloadCsv, filteredInvoices]);
  const generateBuybackPdf = useCallback(() => {
    window.print();
  }, []);

  return (
    <div className="flex h-full min-h-0 w-full flex-col p-3 bg-[#f0f4f9]">
      <input
        ref={expenseUploadInputRef}
        type="file"
        multiple
        className="hidden"
        accept=".pdf,.png,.jpg,.jpeg,.webp"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          void handleExpenseUpload(files);
        }}
      />
      <input
        ref={invoiceUploadInputRef}
        type="file"
        multiple
        className="hidden"
        accept=".pdf,.png,.jpg,.jpeg,.webp"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          void handleInvoiceUpload(files);
        }}
      />
      <div className="bg-gradient-mesh rounded-[20px] elevation-2 flex min-h-0 flex-col flex-1 overflow-hidden">
        {/* Stats Strip */}
        <div className="px-5 py-2 bg-slate-50/30 border-b border-slate-100 flex gap-3 shrink-0">
          <div className="flex-1 bg-white px-3.5 py-2 rounded-2xl elevation-1 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-emerald-50 flex items-center justify-center">
              <Wallet className="w-4 h-4 text-emerald-600" />
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-0.5">本月报销总额</p>
              <p className="text-lg font-bold text-slate-800">
                ¥{totalAmount.toFixed(2)}
              </p>
            </div>
          </div>
          <div className="flex-1 bg-white px-3.5 py-2 rounded-2xl elevation-1 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center">
              <Link2 className="w-4 h-4 text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-0.5">已关联凭证</p>
              <p className="text-lg font-bold text-slate-800">{matched}</p>
            </div>
          </div>
          <div className="flex-1 bg-white px-3.5 py-2 rounded-2xl elevation-1 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-amber-50 flex items-center justify-center">
              <AlertCircle className="w-4 h-4 text-amber-600" />
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-0.5">待关联凭证</p>
              <p className="text-lg font-bold text-slate-800">{unmatched}</p>
            </div>
          </div>
          <div className="flex-1 bg-white px-3.5 py-2 rounded-2xl elevation-1 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-purple-50 flex items-center justify-center">
              <Clock className="w-4 h-4 text-purple-600" />
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-0.5">审批中</p>
              <p className="text-lg font-bold text-slate-800">
                {pendingApprovals}
              </p>
            </div>
          </div>
        </div>

        {/* Tabs Nav */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="gap-0">
        <div className="flex items-center justify-between gap-4 border-b border-slate-100 bg-slate-50/25 px-6 shrink-0">
          <TabsList className="h-10 rounded-none bg-transparent p-0">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              return (
                <TabsTrigger
                  key={tab.id}
                  value={tab.id}
                  className="h-10 rounded-none border-x-0 border-t-0 border-b-2 border-transparent bg-transparent px-4 text-sm font-medium text-slate-500 shadow-none focus-visible:ring-0 focus-visible:outline-none data-[state=active]:border-b-emerald-500 data-[state=active]:border-x-transparent data-[state=active]:border-t-transparent data-[state=active]:bg-transparent data-[state=active]:text-emerald-700 data-[state=active]:shadow-none hover:bg-emerald-50/40 hover:text-slate-800">
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </TabsTrigger>);

            })}
          </TabsList>

          <div className="ml-auto flex min-w-0 items-center justify-end gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={loading}
                  className="h-8 bg-transparent text-slate-700 shadow-none hover:bg-emerald-50/70 hover:text-emerald-700">
                  <Upload className="h-3.5 w-3.5" /> 上传
                  <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40 rounded-2xl p-2">
                <DropdownMenuItem
                  disabled={loading}
                  onSelect={() => expenseUploadInputRef.current?.click()}
                  className="rounded-xl text-orange-700">
                  <Receipt className="h-4 w-4" /> 报销凭证
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={loading}
                  onSelect={() => invoiceUploadInputRef.current?.click()}
                  className="rounded-xl text-blue-700">
                  <FileText className="h-4 w-4" /> 发票凭证
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={runAiMatch}
              disabled={aiMatching || loading}
              className="h-8 bg-transparent text-slate-700 shadow-none hover:bg-emerald-50/70 hover:text-emerald-700">
              {aiMatching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {aiMatching ? '匹配中' : 'AI 匹配'}
            </Button>

            {activeTab === 'vouchers' &&
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleManualLink}
              disabled={!selectedExpense || !selectedInvoice}
              className="h-8 bg-transparent text-slate-700 shadow-none hover:bg-emerald-50/70 hover:text-emerald-700">
                <Link2 className="h-3.5 w-3.5" /> 手动关联
              </Button>
            }
            {activeTab === 'archive' &&
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={archiveActionItems.length === 0}
                  className="h-8 bg-transparent text-slate-700 shadow-none hover:bg-emerald-50/70 hover:text-emerald-700">
                    本组操作
                    <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44 rounded-2xl p-2">
                  <DropdownMenuItem
                  onSelect={exportArchiveItems}
                  disabled={archiveActionItems.length === 0}
                  className="rounded-xl">
                    <Download className="h-4 w-4" /> 导出当前分类
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                  onSelect={() => openReimbursementDialog(archiveActionItems)}
                  disabled={archiveActionItems.length === 0}
                  className="rounded-xl text-emerald-700">
                    <Send className="h-4 w-4" /> 提交本组审批
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            }
            {activeTab === 'approval' &&
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleSyncSelectedApproval()}
              disabled={!selectedApproval}
              className="h-8 bg-transparent text-slate-700 shadow-none hover:bg-emerald-50/70 hover:text-emerald-700">
                <MessageCircle className="h-3.5 w-3.5" /> 同步状态
              </Button>
            }
            {activeTab === 'buyback' &&
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={filteredInvoices.length === 0}
                  className="h-8 bg-transparent text-slate-700 shadow-none hover:bg-emerald-50/70 hover:text-emerald-700">
                    导出
                    <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-36 rounded-2xl p-2">
                  <DropdownMenuItem
                  onSelect={exportBuybackItems}
                  disabled={filteredInvoices.length === 0}
                  className="rounded-xl">
                    <FileDown className="h-4 w-4" /> Excel
                  </DropdownMenuItem>
                  <DropdownMenuItem
                  onSelect={generateBuybackPdf}
                  disabled={filteredInvoices.length === 0}
                  className="rounded-xl text-blue-700">
                    <Download className="h-4 w-4" /> PDF
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            }

            <Button
              type="button"
              size="sm"
              onClick={() => openReimbursementDialog()}
              disabled={loading}
              className="h-8 bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-sm shadow-emerald-500/25 hover:shadow-md">
              <Plus className="h-3.5 w-3.5" /> 新建报销单
            </Button>
          </div>
        </div>
        </Tabs>

        {/* Tab Content */}
        <div className="flex-1 overflow-hidden bg-slate-50/30">
          {/* TAB 1: VOUCHERS */}
          {activeTab === 'vouchers' &&
          <div className="h-full flex flex-col">
              {/* Toolbar */}
              <div className="px-5 py-2 flex items-center gap-3 border-b border-slate-100 bg-white shrink-0">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <Badge variant="secondary" className="rounded-full border-0 bg-slate-100 text-slate-600">全部 {expenseVouchers.length}</Badge>
                  <Badge variant="secondary" className="rounded-full border-0 bg-emerald-50 text-emerald-700">已关联 {matched}</Badge>
                  <Badge variant="secondary" className="rounded-full border-0 bg-amber-50 text-amber-700">待关联 {unmatched}</Badge>
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <div className="relative w-48">
                    <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                    type="text"
                    placeholder="搜索凭证"
                    className="w-full pl-10 pr-3 py-1 bg-slate-100 border-none rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
                  
                  </div>
                  <Button type="button" variant="ghost" size="icon" className="text-slate-500 hover:bg-slate-100">
                    <Filter className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {/* Two-column matching area */}
              <div className="flex-1 overflow-hidden flex p-3 gap-3">
                {/* LEFT: Expense vouchers */}
                <div className="flex-1 bg-white rounded-3xl elevation-1 flex flex-col overflow-hidden min-w-0">
                  <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between shrink-0">
                    <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                      <Receipt className="w-4 h-4 text-orange-500" />
                      报销凭证
                      <span className="text-xs text-slate-400 font-normal ml-1">
                        ({expenseVouchers.length})
                      </span>
                    </h3>
                    <div className="text-xs text-slate-500">
                      已匹配{' '}
                      <span className="text-emerald-600 font-medium">
                        {matched}
                      </span>{' '}
                      / 待匹配{' '}
                      <span className="text-amber-600 font-medium">
                        {unmatched}
                      </span>
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto p-3 space-y-2">
                    {expenseVouchers.map((v) => {
                    const isSelected = selectedExpense === v.id;
                    return (
                      <div
                        key={v.id}
                        onClick={() =>
                        setSelectedExpense(isSelected ? null : v.id)
                        }
                        className={`p-3 rounded-2xl border-2 cursor-pointer transition-all flex items-center gap-3 ${isSelected ? 'border-blue-400 bg-blue-50/50 shadow-sm' : v.matched ? 'border-transparent bg-emerald-50/40 hover:bg-emerald-50/70' : 'border-transparent bg-slate-50 hover:bg-slate-100/60'}`}>
                        
                          <div
                          className={`w-12 h-12 rounded-xl ${v.thumbColor} flex items-center justify-center shrink-0`}>
                          
                            <Receipt className="w-5 h-5 text-slate-600" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="text-sm font-medium text-slate-800 truncate">
                                {v.vendor}
                              </span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-600 shrink-0">
                                {v.type}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-slate-500">
                              <span className="font-mono">{v.id}</span>
                              <span>·</span>
                              <span>{v.date}</span>
                              <span>·</span>
                              <span>{v.category}</span>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-sm font-bold text-slate-800">
                              ¥{v.amount.toFixed(2)}
                            </div>
                            {v.matched ?
                          <div className="text-[10px] text-emerald-600 flex items-center gap-0.5 mt-0.5">
                                <CheckCircle className="w-3 h-3" /> 已关联
                              </div> :

                          <div className="text-[10px] text-amber-600 flex items-center gap-0.5 mt-0.5">
                                <AlertCircle className="w-3 h-3" /> 待关联
                              </div>
                          }
                          </div>
                        </div>);

                  })}
                  </div>
                </div>

                {/* CENTER: Association indicator */}
                <div className="w-16 flex flex-col items-center justify-center shrink-0">
                  <div
                  className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${aiMatching ? 'bg-gradient-to-br from-violet-500 to-blue-600 shadow-lg shadow-violet-500/30' : 'bg-white border-2 border-slate-200'}`}>
                  
                    {aiMatching ?
                  <Sparkles className="w-5 h-5 text-white animate-pulse" /> :

                  <Link2 className="w-5 h-5 text-slate-400" />
                  }
                  </div>
                  <div className="text-[10px] text-slate-400 mt-2 text-center leading-tight">
                    {aiMatching ? 'AI 匹配中' : '智能关联'}
                  </div>
                </div>

                {/* RIGHT: Invoice vouchers */}
                <div className="flex-1 bg-white rounded-3xl elevation-1 flex flex-col overflow-hidden min-w-0">
                  <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between shrink-0">
                    <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                      <FileText className="w-4 h-4 text-blue-500" />
                      发票凭证
                      <span className="text-xs text-slate-400 font-normal ml-1">
                        ({totalInvoices})
                      </span>
                    </h3>
                    <span className="text-xs text-slate-400">已导入 {totalInvoices}</span>
                  </div>
                  <div className="flex-1 overflow-y-auto p-3 space-y-2">
                    {invoiceVouchers.map((iv) => {
                    const associatedExpense = expenseVouchers.find(
                      (e) => e.id === iv.matchedTo
                    );
                    const highlightedAsMatch =
                    selectedExpense &&
                    expenseVouchers.find(
                      (e) => e.id === selectedExpense
                    )?.matchedTo === iv.id;
                    const isInvoiceSelected = selectedInvoice === iv.id;
                    return (
                      <div
                        key={iv.id}
                        onClick={() => setSelectedInvoice(isInvoiceSelected ? null : iv.id)}
                        className={`p-3 rounded-2xl border-2 cursor-pointer transition-all flex items-center gap-3 ${highlightedAsMatch || isInvoiceSelected ? 'border-blue-400 bg-blue-50/50 shadow-sm' : iv.matched ? 'border-transparent bg-emerald-50/40' : 'border-transparent bg-slate-50 hover:bg-slate-100/60'}`}>
                        
                          <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center shrink-0">
                            <FileText className="w-5 h-5 text-blue-600" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-slate-800 truncate mb-0.5">
                              {iv.issuer}
                            </div>
                            <div className="flex items-center gap-2 text-xs text-slate-500">
                              <span className="font-mono">
                                {iv.invoiceNumber}
                              </span>
                              <span>·</span>
                              <span>{iv.date}</span>
                            </div>
                            <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                              {iv.type} · 税额 ¥{iv.taxAmount.toFixed(2)}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-sm font-bold text-slate-800">
                              ¥{iv.amount.toFixed(2)}
                            </div>
                            {iv.matched && associatedExpense ?
                          <div className="text-[10px] text-emerald-600 flex items-center gap-0.5 mt-0.5">
                                <Link2 className="w-3 h-3" />{' '}
                                {associatedExpense.id}
                              </div> :

                          <div className="text-[10px] text-amber-600 flex items-center gap-0.5 mt-0.5">
                                <AlertCircle className="w-3 h-3" /> 待匹配
                              </div>
                          }
                          </div>
                        </div>);

                  })}
                  </div>
                </div>
              </div>
            </div>
          }

          {/* TAB 2: ARCHIVE */}
          {activeTab === 'archive' &&
          (() => {
            const currentItems = getItemsForNode(archiveSelected);
            const currentTotal = currentItems.reduce(
              (s, v) => s + v.amount,
              0
            );
            const currentTaxTotal = currentItems.reduce((s, v) => {
              const iv = invoiceVouchers.find(
                (i) => i.id === v.matchedTo
              );
              return s + (iv?.taxAmount || 0);
            }, 0);
            // Build breadcrumb
            const findPath = (
            nodes: TreeNode[],
            id: string,
            path: TreeNode[] = [])
            : TreeNode[] | null => {
              for (const n of nodes) {
                const next = [...path, n];
                if (n.id === id) return next;
                if (n.children) {
                  const found = findPath(n.children, id, next);
                  if (found) return found;
                }
              }
              return null;
            };
            const breadcrumb =
            archiveSelected === 'all' ?
            [] :
            findPath(ARCHIVE_TREE, archiveSelected) || [];
            const currentNode = breadcrumb[breadcrumb.length - 1];
            const renderTreeNode = (node: TreeNode, depth: number) => {
              const hasChildren = node.children && node.children.length > 0;
              const isExpanded = archiveExpanded.has(node.id);
              const isSelected = archiveSelected === node.id;
              const nodeItems = getItemsForNode(node.id);
              const nodeTotal = nodeItems.reduce((s, v) => s + v.amount, 0);
              return (
                <div key={node.id}>
                    <div
                    onClick={() => setArchiveSelected(node.id)}
                    className={`flex items-center gap-1.5 pr-2 py-1.5 rounded-xl cursor-pointer transition-all group ${isSelected ? 'bg-blue-50 text-blue-700' : 'hover:bg-slate-100/60 text-slate-700'}`}
                    style={{
                      paddingLeft: `${depth * 16 + 8}px`
                    }}>
                    
                      {hasChildren ?
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleArchiveExpanded(node.id);
                      }}
                      className="w-4 h-4 flex items-center justify-center text-slate-400 hover:text-slate-700 shrink-0">
                      
                          {isExpanded ?
                      <ChevronDown className="w-3.5 h-3.5" /> :

                      <ChevronRight className="w-3.5 h-3.5" />
                      }
                        </button> :

                    <span className="w-4 h-4 shrink-0"></span>
                    }
                      {hasChildren ?
                    <span className="text-base">{node.icon}</span> :

                    <span className="w-1.5 h-1.5 rounded-full bg-slate-300 ml-1 shrink-0"></span>
                    }
                      <span
                      className={`text-sm flex-1 truncate ${isSelected ? 'font-medium' : ''}`}>
                      
                        {node.name}
                      </span>
                      {nodeItems.length > 0 &&
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${isSelected ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
                      
                          {nodeItems.length}
                        </span>
                    }
                    </div>
                    {hasChildren && isExpanded &&
                  <div>
                        {node.children!.map((child) =>
                    renderTreeNode(child, depth + 1)
                    )}
                      </div>
                  }
                  </div>);

            };
            return (
              <div className="h-full flex overflow-hidden p-4 gap-4">
                  {/* LEFT: Tree Sidebar */}
                  <div className="w-[232px] bg-white rounded-3xl elevation-1 flex flex-col overflow-hidden shrink-0">
                    <div className="px-4 py-3 border-b border-slate-100 shrink-0">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                          <Archive className="w-4 h-4 text-blue-500" /> 分类导航
                        </h3>
                        <button className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors">
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="relative">
                        <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                        type="text"
                        placeholder="搜索分类"
                        className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border-none rounded-full text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
                      
                      </div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
                      {/* All node */}
                      <div
                      onClick={() => setArchiveSelected('all')}
                      className={`flex items-center gap-2 px-2 py-2 rounded-xl cursor-pointer transition-all ${archiveSelected === 'all' ? 'bg-blue-50 text-blue-700' : 'hover:bg-slate-100/60 text-slate-700'}`}>
                      
                        <FolderOpen
                        className={`w-4 h-4 shrink-0 ${archiveSelected === 'all' ? 'text-blue-600' : 'text-slate-400'}`} />
                      
                        <span
                        className={`text-sm flex-1 ${archiveSelected === 'all' ? 'font-medium' : ''}`}>
                        
                          全部归档
                        </span>
                        <span
                        className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${archiveSelected === 'all' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
                        
                          {
                        expenseVouchers.filter((v) => v.matched).
                        length
                        }
                        </span>
                      </div>

                      <div className="px-2 pt-3 pb-1 text-[10px] font-medium text-slate-400 uppercase tracking-wide">
                        费用类别
                      </div>
                      {ARCHIVE_TREE.map((node) => renderTreeNode(node, 0))}
                    </div>

                    <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50/50 shrink-0">
                      <div className="text-[10px] text-slate-500 mb-1">
                        本月已归档
                      </div>
                      <div className="flex items-baseline justify-between">
                        <div className="text-lg font-bold text-slate-800">
                          ¥
                          {expenseVouchers.filter((v) => v.matched).
                        reduce((s, v) => s + v.amount, 0).
                        toFixed(2)}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {
                        expenseVouchers.filter((v) => v.matched).
                        length
                        }{' '}
                          项
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* RIGHT: Detail Panel */}
                  <div className="flex-1 bg-white rounded-3xl elevation-1 flex flex-col overflow-hidden min-w-0">
                    {/* Header with breadcrumb */}
                    <div className="px-5 py-3 border-b border-slate-100 shrink-0">
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1">
                            <span
                            className="hover:text-blue-600 cursor-pointer"
                            onClick={() => setArchiveSelected('all')}>
                            
                              全部归档
                            </span>
                            {breadcrumb.map((b, idx) =>
                          <Fragment key={b.id}>
                                <ChevronRight className="w-3 h-3" />
                                <span
                              className={`${idx === breadcrumb.length - 1 ? 'text-slate-700 font-medium' : 'hover:text-blue-600 cursor-pointer'}`}
                              onClick={() => setArchiveSelected(b.id)}>
                              
                                  {b.name}
                                </span>
                              </Fragment>
                          )}
                          </div>
                          <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
                            {currentNode?.icon &&
                          <span className="text-xl">
                                {currentNode.icon}
                              </span>
                          }
                            {archiveSelected === 'all' ?
                          '全部归档凭证' :
                          currentNode?.name}
                          </h3>
                        </div>
                        <div className="text-xs font-medium text-slate-400">
                          {currentItems.length} 项
                        </div>
                      </div>
                    </div>

                    {/* Mini stats */}
                    <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/30 shrink-0 flex gap-3">
                      <div className="flex-1 bg-white rounded-2xl px-4 py-2.5 border border-slate-100">
                        <div className="text-[10px] text-slate-500 mb-0.5">
                          凭证数量
                        </div>
                        <div className="text-lg font-bold text-slate-800">
                          {currentItems.length}
                        </div>
                      </div>
                      <div className="flex-1 bg-white rounded-2xl px-4 py-2.5 border border-slate-100">
                        <div className="text-[10px] text-slate-500 mb-0.5">
                          合计金额
                        </div>
                        <div className="text-lg font-bold text-slate-800">
                          ¥{currentTotal.toFixed(2)}
                        </div>
                      </div>
                      <div className="flex-1 bg-white rounded-2xl px-4 py-2.5 border border-slate-100">
                        <div className="text-[10px] text-slate-500 mb-0.5">
                          可抵扣税额
                        </div>
                        <div className="text-lg font-bold text-emerald-600">
                          ¥{currentTaxTotal.toFixed(2)}
                        </div>
                      </div>
                      <div className="flex-1 bg-white rounded-2xl px-4 py-2.5 border border-slate-100">
                        <div className="text-[10px] text-slate-500 mb-0.5">
                          关联订单
                        </div>
                        <div className="text-lg font-bold text-blue-600">
                          {currentItems.filter((v) => v.matched).length}
                        </div>
                      </div>
                    </div>

                    {/* Items table */}
                    <div className="flex-1 overflow-auto">
                      {currentItems.length === 0 ?
                    <div className="h-full flex flex-col items-center justify-center text-slate-400">
                          <Archive className="w-12 h-12 mb-3 text-slate-300" />
                          <p className="text-sm">该分类下暂无归档凭证</p>
                          <p className="text-xs mt-1">
                            在「凭证管理」中关联后将自动归档至此
                          </p>
                        </div> :

                    <table className="w-full min-w-[560px] table-fixed text-sm">
                          <colgroup>
                            <col className="w-10" />
                            <col />
                            <col className="w-[36%]" />
                            <col className="w-[104px]" />
                            <col className="w-[86px]" />
                          </colgroup>
                          <thead className="text-xs text-slate-500 bg-slate-50/50 sticky top-0 z-10">
                            <tr>
                              <th className="px-3 py-2.5 text-left font-medium">
                                <input
                              type="checkbox"
                              className="rounded border-slate-300" />
                            
                              </th>
                              <th className="px-3 py-2.5 text-left font-medium">
                                报销凭证
                              </th>
                              <th className="px-3 py-2.5 text-left font-medium">
                                关联发票
                              </th>
                              <th className="px-3 py-2.5 text-right font-medium">
                                金额
                              </th>
                              <th className="px-3 py-2.5 text-center font-medium">
                                状态
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50">
                            {currentItems.map((v) => {
                          const iv = invoiceVouchers.find(
                            (i) => i.id === v.matchedTo
                          );
                          return (
                            <tr
                              key={v.id}
                              className="hover:bg-slate-50/50 transition-colors">
                              
                                  <td className="px-3 py-3">
                                    <input
                                  type="checkbox"
                                  className="rounded border-slate-300" />
                                
                                  </td>
                                  <td className="px-3 py-3">
                                    <div className="truncate font-medium text-slate-800" title={v.vendor}>
                                      {v.vendor}
                                    </div>
                                    <div className="mt-0.5 truncate text-[10px] text-slate-400">
                                      <span className="font-mono">{v.id}</span>
                                      <span className="mx-1">·</span>
                                      <span>{v.date}</span>
                                      <span className="mx-1">·</span>
                                      <span>{v.category}</span>
                                    </div>
                                  </td>
                                  <td className="px-3 py-3">
                                    <div
                                  className="truncate text-xs text-slate-700"
                                  title={iv?.issuer}>
                                  
                                      {iv?.issuer || '-'}
                                    </div>
                                    <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                                      {iv?.invoiceNumber || '-'}
                                    </div>
                                  </td>
                                  <td className="px-3 py-3 text-right whitespace-nowrap">
                                    <div className="font-medium text-slate-800">¥{v.amount.toFixed(2)}</div>
                                    <div className="mt-0.5 text-[10px] text-slate-400">
                                      税 ¥{iv?.taxAmount.toFixed(2) || '0.00'}
                                    </div>
                                  </td>
                                  <td className="px-3 py-3 text-center">
                                    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                                      <Check className="w-3 h-3" /> 已归档
                                    </span>
                                  </td>
                                </tr>);

                        })}
                          </tbody>
                        </table>
                    }
                    </div>
                  </div>
                </div>);

          })()}

          {/* TAB 3: APPROVAL */}
          {activeTab === 'approval' &&
          <div className="h-full flex overflow-hidden p-5 gap-5">
              {/* LEFT: Approval list */}
              <div className="w-[380px] bg-white rounded-3xl elevation-1 flex flex-col overflow-hidden shrink-0">
                <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
                  <h3 className="text-sm font-semibold text-slate-800">
                    报销申请单
                  </h3>
                  <span className="text-xs text-slate-400">{approvals.length} 单</span>
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                  {approvals.map((a) => {
                  const isSelected = selectedApproval?.id === a.id;
                  const statusStyle =
                  a.status === 'approved' ?
                  'bg-emerald-50 text-emerald-700' :
                  a.status === 'rejected' ?
                  'bg-rose-50 text-rose-700' :
                  'bg-amber-50 text-amber-700';
                  const statusLabel =
                  a.status === 'approved' ?
                  '已通过' :
                  a.status === 'rejected' ?
                  '已驳回' :
                  '审批中';
                  const statusIcon =
                  a.status === 'approved' ?
                  CheckCircle :
                  a.status === 'rejected' ?
                  XCircle :
                  Clock;
                  const StatusIcon = statusIcon;
                  return (
                    <div
                      key={a.id}
                      onClick={() => setSelectedApproval(a)}
                      className={`p-4 rounded-2xl cursor-pointer transition-all ${isSelected ? 'bg-blue-50 ring-2 ring-blue-200' : 'bg-slate-50 hover:bg-slate-100/60'}`}>
                      
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex-1 min-w-0">
                            <h4 className="text-sm font-semibold text-slate-800 truncate">
                              {a.title}
                            </h4>
                            <p className="text-xs text-slate-500 mt-0.5 font-mono">
                              {a.id}
                            </p>
                          </div>
                          <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${statusStyle} shrink-0`}>
                          
                            <StatusIcon className="w-3 h-3" />
                            {statusLabel}
                          </span>
                        </div>
                        <div className="flex items-center justify-between mt-3">
                          <div className="text-xs text-slate-500">
                            {a.applicant} · {a.department}
                          </div>
                          <div className="text-base font-bold text-slate-800">
                            ¥{a.amount.toFixed(2)}
                          </div>
                        </div>
                        {a.status === 'pending' &&
                      <div className="mt-3">
                            <div className="h-1 bg-slate-200 rounded-full overflow-hidden">
                              <div
                            className="h-full bg-gradient-to-r from-blue-500 to-blue-600 rounded-full"
                            style={{
                              width: `${a.currentStep / a.totalSteps * 100}%`
                            }} />
                          
                            </div>
                            <p className="text-[10px] text-slate-500 mt-1">
                              进度 {a.currentStep}/{a.totalSteps} · 当前节点{' '}
                              {a.flow[a.currentStep - 1]?.role}
                            </p>
                          </div>
                      }
                      </div>);

                })}
                </div>
              </div>

              {/* RIGHT: Approval detail */}
              {selectedApproval &&
            <div className="flex-1 bg-white rounded-3xl elevation-1 flex flex-col overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
                    <div>
                      <h3 className="text-base font-semibold text-slate-800">
                        {selectedApproval.title}
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {selectedApproval.id} · 提交于{' '}
                        {selectedApproval.submitDate}
                      </p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-500">
                      {selectedApproval.status === 'approved' ? '已通过' : selectedApproval.status === 'rejected' ? '已驳回' : '审批中'}
                    </span>
                  </div>

                  <div className="flex-1 overflow-y-auto p-6 space-y-5">
                    {/* Summary */}
                    <div className="grid grid-cols-3 gap-4">
                      <div className="bg-slate-50 rounded-2xl p-4">
                        <p className="text-xs text-slate-500 mb-1">报销金额</p>
                        <p className="text-xl font-bold text-slate-800">
                          ¥{selectedApproval.amount.toFixed(2)}
                        </p>
                      </div>
                      <div className="bg-slate-50 rounded-2xl p-4">
                        <p className="text-xs text-slate-500 mb-1">材料数量</p>
                        <p className="text-xl font-bold text-slate-800">
                          {selectedApproval.materials?.length ? `${selectedApproval.materials.length * 2} 份` : `${selectedApproval.items} 项`}
                        </p>
                      </div>
                      <div className="bg-slate-50 rounded-2xl p-4">
                        <p className="text-xs text-slate-500 mb-1">申请人</p>
                        <p className="text-base font-semibold text-slate-800 mt-1">
                          {selectedApproval.applicant}
                          <span className="text-xs text-slate-500 font-normal ml-1">
                            · {selectedApproval.department}
                          </span>
                        </p>
                      </div>
                    </div>

                    {selectedApproval.materials && selectedApproval.materials.length > 0 &&
                  <div>
                        <h4 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
                          <Archive className="w-4 h-4 text-emerald-500" />{' '}
                          提交材料
                        </h4>
                        <div className="overflow-hidden rounded-2xl border border-slate-100">
                          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_96px] bg-slate-50 px-4 py-2 text-xs font-medium text-slate-500">
                            <span>发票</span>
                            <span>关联凭证</span>
                            <span className="text-right">金额</span>
                          </div>
                          <div className="divide-y divide-slate-50">
                            {selectedApproval.materials.map((material) =>
                        <div key={`${material.invoiceId}-${material.voucherId}`} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_96px] gap-3 px-4 py-3 text-sm">
                                <div className="min-w-0">
                                  <div className="truncate font-medium text-slate-800">{material.invoiceIssuer}</div>
                                  <div className="mt-0.5 truncate text-xs text-slate-400">
                                    {material.invoiceNo} · {material.invoiceDate}
                                  </div>
                                </div>
                                <div className="min-w-0">
                                  <div className="truncate font-medium text-slate-700">{material.voucherVendor}</div>
                                  <div className="mt-0.5 truncate text-xs text-slate-400">
                                    {material.voucherNo} · {material.category}
                                  </div>
                                </div>
                                <div className="text-right font-semibold text-slate-900">{formatMoney(material.invoiceAmount)}</div>
                              </div>
                        )}
                          </div>
                        </div>
                      </div>
                  }

                    {/* Approval Flow Steps */}
                    <div>
                      <h4 className="text-sm font-semibold text-slate-800 mb-4 flex items-center gap-2">
                        <TrendingUp className="w-4 h-4 text-blue-500" />{' '}
                        审批流程
                      </h4>
                      <div className="space-y-4">
                        {selectedApproval.flow.map((step: any, idx: number) => {
                      const isLast =
                      idx === selectedApproval.flow.length - 1;
                      const stepColor =
                      step.status === 'done' ?
                      'bg-emerald-500 text-white' :
                      step.status === 'current' ?
                      'bg-blue-500 text-white animate-pulse' :
                      step.status === 'rejected' ?
                      'bg-rose-500 text-white' :
                      'bg-slate-200 text-slate-400';
                      const stepIcon =
                      step.status === 'done' ?
                      <Check className="w-4 h-4" /> :
                      step.status === 'rejected' ?
                      <X className="w-4 h-4" /> :
                      step.status === 'current' ?
                      <Loader2 className="w-4 h-4 animate-spin" /> :

                      <span className="text-xs font-medium">
                                {idx + 1}
                              </span>;

                      return (
                        <div key={idx} className="flex gap-4 relative">
                              {!isLast &&
                          <div
                            className={`absolute left-4 top-9 w-0.5 h-full -translate-x-1/2 ${step.status === 'done' ? 'bg-emerald-300' : 'bg-slate-200'}`} />

                          }
                              <div
                            className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 z-10 ${stepColor}`}>
                            
                                {stepIcon}
                              </div>
                              <div className="flex-1 pb-2">
                                <div className="flex items-baseline justify-between gap-3">
                                  <div>
                                    <span className="text-sm font-medium text-slate-800">
                                      {step.name}
                                    </span>
                                    <span className="text-xs text-slate-500 ml-2">
                                      {step.role}
                                    </span>
                                  </div>
                                  {step.time &&
                              <span className="text-xs text-slate-400 font-mono">
                                      {step.time}
                                    </span>
                              }
                                </div>
                                {step.remark &&
                            <div
                              className={`mt-1.5 text-xs px-3 py-2 rounded-xl inline-block ${step.status === 'rejected' ? 'bg-rose-50 text-rose-700' : 'bg-slate-50 text-slate-600'}`}>
                              
                                    {step.remark}
                                  </div>
                            }
                                {step.status === 'current' &&
                            <p className="text-xs text-blue-600 mt-1">
                                    审批中...
                                  </p>
                            }
                                {step.status === 'pending' &&
                            <p className="text-xs text-slate-400 mt-1">
                                    待审批
                                  </p>
                            }
                              </div>
                            </div>);

                    })}
                      </div>
                    </div>
                  </div>
                </div>
            }
            </div>
          }

          {/* TAB 4: BUYBACK */}
          {activeTab === 'buyback' &&
          <div className="h-full overflow-y-auto p-6 space-y-5">
              {/* Date Range Selector */}
              <div className="bg-white rounded-3xl p-5 elevation-1">
                <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2 mb-4">
                  <Calendar className="w-4 h-4 text-blue-500" />{' '}
                  发票回购明细生成
                </h3>
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-slate-500">开始日期</label>
                    <input
                    type="date"
                    value={dateRange.start}
                    onChange={(e) =>
                    setDateRange({
                      ...dateRange,
                      start: e.target.value
                    })
                    }
                    className="px-3 py-1.5 bg-slate-100 border-none rounded-full text-sm focus:ring-2 focus:ring-blue-500/20 focus:bg-white outline-none transition-all" />
                  
                  </div>
                  <span className="text-slate-400">至</span>
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-slate-500">结束日期</label>
                    <input
                    type="date"
                    value={dateRange.end}
                    onChange={(e) =>
                    setDateRange({
                      ...dateRange,
                      end: e.target.value
                    })
                    }
                    className="px-3 py-1.5 bg-slate-100 border-none rounded-full text-sm focus:ring-2 focus:ring-blue-500/20 focus:bg-white outline-none transition-all" />
                  
                  </div>
                  <div className="flex p-1 bg-slate-100 rounded-full">
                    {[
                  {
                    l: '本月',
                    s: '2026-05-01',
                    e: '2026-05-31'
                  },
                  {
                    l: '上月',
                    s: '2026-04-01',
                    e: '2026-04-30'
                  },
                  {
                    l: 'Q2',
                    s: '2026-04-01',
                    e: '2026-06-30'
                  }].
                  map((p) =>
                  <button
                    key={p.l}
                    onClick={() =>
                    setDateRange({
                      start: p.s,
                      end: p.e
                    })
                    }
                    className="px-3 py-1 text-xs text-slate-600 hover:bg-white hover:shadow-sm rounded-full transition-all">
                    
                        {p.l}
                      </button>
                  )}
                  </div>
                </div>
              </div>

              {/* Summary cards */}
              <div className="grid grid-cols-3 gap-5">
                <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-3xl p-5 text-white">
                  <p className="text-xs text-blue-100 mb-1">日期区间内发票数</p>
                  <p className="text-3xl font-bold">
                    {filteredInvoices.length} 张
                  </p>
                  <p className="text-xs text-blue-100 mt-2">
                    {dateRange.start} ~ {dateRange.end}
                  </p>
                </div>
                <div className="bg-white rounded-3xl p-5 elevation-1">
                  <p className="text-xs text-slate-500 mb-1">价税合计</p>
                  <p className="text-3xl font-bold text-slate-800">
                    ¥{buybackTotal.toFixed(2)}
                  </p>
                  <p className="text-xs text-slate-400 mt-2">含税金额</p>
                </div>
                <div className="bg-white rounded-3xl p-5 elevation-1">
                  <p className="text-xs text-slate-500 mb-1">可抵扣税额</p>
                  <p className="text-3xl font-bold text-emerald-600">
                    ¥{buybackTax.toFixed(2)}
                  </p>
                  <p className="text-xs text-slate-400 mt-2">
                    占比 {(buybackTax / buybackTotal * 100 || 0).toFixed(1)}%
                  </p>
                </div>
              </div>

              {/* Buyback table */}
              <div className="bg-white rounded-3xl elevation-1 overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-blue-500" />{' '}
                    发票回购明细表单
                  </h3>
                  <span className="text-xs text-slate-500">
                    共 {filteredInvoices.length} 条记录
                  </span>
                </div>
                <table className="w-full text-sm">
                  <thead className="text-xs text-slate-500 bg-slate-50/50">
                    <tr>
                      <th className="px-5 py-3 text-left font-medium">序号</th>
                      <th className="px-5 py-3 text-left font-medium">
                        发票号码
                      </th>
                      <th className="px-5 py-3 text-left font-medium">
                        开票方
                      </th>
                      <th className="px-5 py-3 text-left font-medium">
                        发票类型
                      </th>
                      <th className="px-5 py-3 text-left font-medium">
                        开票日期
                      </th>
                      <th className="px-5 py-3 text-right font-medium">
                        不含税金额
                      </th>
                      <th className="px-5 py-3 text-right font-medium">税额</th>
                      <th className="px-5 py-3 text-right font-medium">
                        价税合计
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {filteredInvoices.map((iv, idx) =>
                  <tr key={iv.id} className="hover:bg-slate-50/50">
                        <td className="px-5 py-3 text-slate-500">{idx + 1}</td>
                        <td className="px-5 py-3 font-mono text-slate-700">
                          {iv.invoiceNumber}
                        </td>
                        <td className="px-5 py-3 text-slate-800">
                          {iv.issuer}
                        </td>
                        <td className="px-5 py-3">
                          <span className="px-2 py-0.5 rounded-full text-xs bg-blue-50 text-blue-700">
                            {iv.type}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-slate-600">{iv.date}</td>
                        <td className="px-5 py-3 text-right text-slate-700">
                          ¥{(iv.amount - iv.taxAmount).toFixed(2)}
                        </td>
                        <td className="px-5 py-3 text-right text-emerald-600">
                          ¥{iv.taxAmount.toFixed(2)}
                        </td>
                        <td className="px-5 py-3 text-right font-medium text-slate-800">
                          ¥{iv.amount.toFixed(2)}
                        </td>
                      </tr>
                  )}
                    {filteredInvoices.length === 0 &&
                  <tr>
                        <td
                      colSpan={8}
                      className="px-5 py-10 text-center text-sm text-slate-400">
                      
                          所选日期区间内暂无发票
                        </td>
                      </tr>
                  }
                  </tbody>
                  {filteredInvoices.length > 0 &&
                <tfoot className="bg-slate-50 font-medium">
                      <tr>
                        <td
                      colSpan={5}
                      className="px-5 py-3 text-right text-slate-600">
                      
                          合计
                        </td>
                        <td className="px-5 py-3 text-right text-slate-800">
                          ¥{(buybackTotal - buybackTax).toFixed(2)}
                        </td>
                        <td className="px-5 py-3 text-right text-emerald-600">
                          ¥{buybackTax.toFixed(2)}
                        </td>
                        <td className="px-5 py-3 text-right text-blue-700 text-base font-bold">
                          ¥{buybackTotal.toFixed(2)}
                        </td>
                      </tr>
                    </tfoot>
                }
                </table>
              </div>
            </div>
          }
        </div>
      </div>
      <Dialog
        open={reimbursementDialogOpen}
        onOpenChange={(open) => {
          if (!open) closeReimbursementDialog();
        }}>
        <DialogContent className="flex max-h-[88vh] w-full max-w-5xl grid-rows-none flex-col gap-0 overflow-hidden rounded-3xl border-0 bg-white p-0 elevation-3 sm:max-w-5xl">
            <DialogHeader className="border-b border-slate-100 px-6 py-5 text-left">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <DialogTitle className="text-lg font-semibold text-slate-900">新建报销单</DialogTitle>
                  <DialogDescription className="mt-1 text-xs text-slate-500">
                    请确认报销信息与凭证范围，确认后才会创建审批单。
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className={`flex-1 overflow-y-auto p-6 ${inspectedReimbursementItem ? 'lg:pr-[360px]' : ''}`}>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-2xl bg-emerald-50 px-4 py-3">
                  <div className="text-xs text-emerald-700">已选金额</div>
                  <div className="mt-1 text-xl font-bold text-emerald-800">
                    {formatMoney(reimbursementDraftTotal)}
                  </div>
                </div>
                <div className="rounded-2xl bg-blue-50 px-4 py-3">
                  <div className="text-xs text-blue-700">材料数量</div>
                  <div className="mt-1 text-xl font-bold text-blue-800">
                    {selectedReimbursementItems.length * 2} / {reimbursementDraftItems.length * 2} 份
                  </div>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <div className="text-xs text-slate-500">关联发票</div>
                  <div className="mt-1 text-xl font-bold text-slate-800">
                    {reimbursementDraftInvoiceCount} 张
                  </div>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-4">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-slate-500">报销标题</span>
                  <input
                    value={reimbursementTitle}
                    onChange={(event) => setReimbursementTitle(event.target.value)}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-800 outline-none transition-all focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-100"
                    placeholder="例如：6 月费用报销申请" />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-slate-500">申请人</span>
                  <input
                    value={reimbursementApplicant}
                    onChange={(event) => setReimbursementApplicant(event.target.value)}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-800 outline-none transition-all focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-100"
                    placeholder="申请人姓名" />
                </label>
                <label className="col-span-2 block">
                  <span className="mb-1.5 block text-xs font-medium text-slate-500">报销事由</span>
                  <textarea
                    value={reimbursementReason}
                    onChange={(event) => setReimbursementReason(event.target.value)}
                    className="min-h-[78px] w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 outline-none transition-all focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-100"
                    placeholder="填写本次报销用途、项目或说明" />
                </label>
              </div>

              <div className="mt-5 overflow-hidden rounded-2xl border border-slate-100">
                <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-3">
                  <span className="text-sm font-semibold text-slate-800">选择报销发票</span>
                  <span className="text-xs text-slate-500">
                    仅显示未审批成功单据 · 显示 {filteredReimbursementItems.length} / {reimbursementDraftItems.length}
                  </span>
                </div>
                {reimbursementDraftItems.length ? (
                  <>
                    <div className="space-y-3 border-b border-slate-100 bg-white px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="relative w-full min-w-[240px] max-w-[540px] flex-[1_1_360px]">
                          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                          <input
                            value={reimbursementKeyword}
                            onChange={(event) => {
                              setReimbursementKeyword(event.target.value);
                              setReimbursementPage(1);
                              setReimbursementInspector(null);
                            }}
                            className="h-9 w-full rounded-full border border-slate-200 bg-slate-50 pl-9 pr-9 text-sm text-slate-800 outline-none transition-all focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-100"
                            placeholder="搜索发票号码、开票方或凭证" />
                          {reimbursementKeyword &&
                        <button
                          type="button"
                          onClick={() => {
                            setReimbursementKeyword('');
                            setReimbursementPage(1);
                            setReimbursementInspector(null);
                          }}
                          className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200 hover:text-slate-700">
                              <X className="h-3.5 w-3.5" />
                            </button>
                        }
                        </div>
                        <div className="ml-auto flex shrink-0 items-center gap-2">
                          <Select
                            value={reimbursementCategoryFilter}
                            onValueChange={(value) => {
                              setReimbursementCategoryFilter(value);
                              setReimbursementPage(1);
                              setReimbursementInspector(null);
                            }}>
                            <SelectTrigger className="h-9 w-[136px] rounded-full border-slate-200 bg-white text-sm text-slate-700 focus:ring-blue-100">
                              <SelectValue placeholder="全部类别" />
                            </SelectTrigger>
                            <SelectContent className="z-[80]">
                              <SelectItem value="all">全部类别</SelectItem>
                              {reimbursementCategoryOptions.map((category) =>
                            <SelectItem key={category} value={category}>{category}</SelectItem>
                            )}
                            </SelectContent>
                          </Select>
                          <ToggleGroup
                            type="single"
                            value={reimbursementSelectionFilter}
                          onValueChange={(value) => {
                            if (!value) return;
                            setReimbursementSelectionFilter(value as 'all' | 'selected' | 'unselected');
                            setReimbursementPage(1);
                            setReimbursementInspector(null);
                          }}
                            className="overflow-hidden rounded-full bg-slate-100 p-1">
                            {[
                              { id: 'all', label: '全部' },
                              { id: 'selected', label: '已选' },
                              { id: 'unselected', label: '未选' },
                            ].map((option) =>
                          <ToggleGroupItem
                            key={option.id}
                            value={option.id}
                            className="h-7 min-w-11 !rounded-full border-0 px-3 text-xs font-medium text-slate-500 shadow-none hover:bg-white/50 data-[state=on]:bg-blue-50 data-[state=on]:text-blue-700 data-[state=on]:shadow-none">
                                {option.label}
                              </ToggleGroupItem>
                          )}
                          </ToggleGroup>
                          {reimbursementFilterActive &&
                        <button
                          type="button"
                          onClick={resetReimbursementFilters}
                          className="inline-flex h-9 items-center gap-1.5 rounded-full bg-slate-100 px-3 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-200">
                              <Filter className="h-3.5 w-3.5" /> 重置
                            </button>
                        }
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={selectFilteredReimbursementItems}
                        disabled={filteredReimbursementItems.length === 0}
                        className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-100">
                        <Check className="h-3.5 w-3.5" /> 全选结果
                      </button>
                      <button
                        type="button"
                        onClick={clearFilteredReimbursementItems}
                        disabled={filteredReimbursementItems.length === 0}
                        className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-200">
                        <X className="h-3.5 w-3.5" /> 清空结果
                      </button>
                      {reimbursementDraftGroups.map((group) => {
                        const allSelected = group.selectedCount === group.items.length;
                        const partiallySelected = group.selectedCount > 0 && !allSelected;
                        return (
                          <button
                            key={group.category}
                            type="button"
                            onClick={() => toggleReimbursementCategory(group.category)}
                            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${allSelected ? 'border-blue-200 bg-blue-50 text-blue-700' : partiallySelected ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}`}>
                            {group.category} {group.selectedCount}/{group.items.length}
                          </button>
                        );
                      })}
                      </div>
                    </div>
                    <div className="max-h-64 overflow-y-auto">
                      {filteredReimbursementItems.length ? pagedReimbursementGroups.map((group) => {
                        const allSelected = group.selectedCount === group.items.length;
                        const partiallySelected = group.selectedCount > 0 && !allSelected;
                        return (
                          <div key={group.category} className="border-b border-slate-50 last:border-b-0">
                            <div className="flex items-center justify-between gap-3 bg-slate-50/70 px-4 py-2">
                              <div
                                role="button"
                                tabIndex={0}
                                onClick={() => toggleReimbursementCategory(group.category)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault();
                                    toggleReimbursementCategory(group.category);
                                  }
                                }}
                                className="inline-flex min-w-0 items-center gap-2 text-xs font-medium text-slate-700">
                                <Checkbox
                                  checked={allSelected ? true : partiallySelected ? 'indeterminate' : false}
                                  aria-label={`选择${group.category}分类`}
                                  onClick={(event) => event.stopPropagation()}
                                  onCheckedChange={() => toggleReimbursementCategory(group.category)}
                                  className="h-4 w-4 rounded border-slate-300 data-[state=checked]:border-blue-500 data-[state=checked]:bg-blue-500 data-[state=indeterminate]:border-blue-500 data-[state=indeterminate]:bg-blue-500" />
                                <span className="truncate">{group.category}</span>
                              </div>
                              <span className="shrink-0 text-xs text-slate-500">
                                {group.selectedCount}/{group.items.length} · {formatMoney(group.selectedAmount)}
                              </span>
                            </div>
                            <div className="divide-y divide-slate-50">
                              {group.items.map((item) => {
                                const invoice = findInvoiceForExpenseItem(item, invoiceVouchers);
                                const selected = selectedReimbursementItemIds.has(item.id);
                                return (
                                  <div
                                    key={item.id}
                                    aria-pressed={selected}
                                    onClick={() => toggleReimbursementItem(item.id)}
                                    className={`grid w-full cursor-pointer grid-cols-[24px_minmax(0,1fr)_74px_112px] items-center gap-3 px-4 py-3 text-left text-sm transition-colors ${selected ? 'bg-emerald-50/40' : 'hover:bg-slate-50'}`}>
                                    <Checkbox
                                      checked={selected}
                                      aria-label={`选择 ${invoice?.invoiceNumber ?? item.id}`}
                                      onClick={(event) => event.stopPropagation()}
                                      onCheckedChange={() => toggleReimbursementItem(item.id)}
                                      className="h-5 w-5 rounded-md border-slate-300 data-[state=checked]:border-emerald-500 data-[state=checked]:bg-emerald-500" />
                                    <span className="min-w-0">
                                      <span className="block truncate font-medium text-slate-800" title={invoice?.issuer ?? item.vendor}>
                                        {invoice?.issuer ?? item.vendor}
                                      </span>
                                      <span className="mt-0.5 block truncate text-xs text-slate-400">
                                        发票 {invoice?.invoiceNumber ?? item.matchedTo ?? '-'} · 凭证 {item.id} · {item.vendor}
                                      </span>
                                    </span>
                                    <span className="flex items-center justify-end gap-1">
                                      <button
                                        type="button"
                                        title="查看发票详情"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          setReimbursementInspector({ itemId: item.id, kind: 'invoice' });
                                        }}
                                        className="flex h-7 w-7 items-center justify-center rounded-full text-blue-600 transition-colors hover:bg-blue-50">
                                        <FileText className="h-3.5 w-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        title="查看关联详情"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          setReimbursementInspector({ itemId: item.id, kind: 'link' });
                                        }}
                                        className="flex h-7 w-7 items-center justify-center rounded-full text-emerald-600 transition-colors hover:bg-emerald-50">
                                        <Link2 className="h-3.5 w-3.5" />
                                      </button>
                                    </span>
                                    <span className="text-right font-semibold text-slate-900">{formatMoney(item.amount)}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      }) :
                      <div className="px-4 py-10 text-center text-sm text-slate-400">
                        没有匹配的发票/凭证，请调整筛选条件。
                      </div>
                      }
                    </div>
                    <div className="flex items-center justify-between border-t border-slate-100 bg-white px-4 py-3">
                      <span className="text-xs text-slate-500">
                        {reimbursementPageStart}-{reimbursementPageEnd} / {filteredReimbursementItems.length} 项
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setReimbursementPage((page) => Math.max(1, page - 1))}
                          disabled={reimbursementCurrentPage <= 1}
                          className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-200 disabled:opacity-40">
                          <ChevronLeft className="h-3.5 w-3.5" /> 上一页
                        </button>
                        <span className="min-w-12 text-center text-xs font-medium text-slate-600">
                          {reimbursementCurrentPage} / {reimbursementTotalPages}
                        </span>
                        <button
                          type="button"
                          onClick={() => setReimbursementPage((page) => Math.min(reimbursementTotalPages, page + 1))}
                          disabled={reimbursementCurrentPage >= reimbursementTotalPages}
                          className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-200 disabled:opacity-40">
                          下一页 <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="px-4 py-10 text-center text-sm text-slate-400">
                    暂无可提交凭证，请先完成发票关联；已审批成功的票据不会重复展示。
                  </div>
                )}
              </div>
            </div>

            {inspectedReimbursementItem &&
          <aside className="absolute bottom-[78px] right-4 top-[92px] hidden w-[328px] overflow-y-auto rounded-2xl border border-slate-100 bg-white shadow-xl shadow-slate-900/10 lg:block">
                <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-4 py-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${reimbursementInspector?.kind === 'invoice' ? 'bg-blue-50 text-blue-600' : 'bg-emerald-50 text-emerald-600'}`}>
                      {reimbursementInspector?.kind === 'invoice' ? <FileText className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
                    </span>
                    <div className="min-w-0">
                      <h4 className="truncate text-sm font-semibold text-slate-900">
                        {reimbursementInspector?.kind === 'invoice' ? '发票详情' : '关联详情'}
                      </h4>
                      <p className="truncate text-xs text-slate-400">
                        {inspectedReimbursementInvoice?.invoiceNumber ?? inspectedReimbursementItem.id}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setReimbursementInspector(null)}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700">
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {reimbursementInspector?.kind === 'invoice' ?
            <div className="space-y-4 p-4">
                    <div>
                      <div className="text-xs text-slate-400">开票方</div>
                      <div className="mt-1 text-sm font-semibold text-slate-900">
                        {inspectedReimbursementInvoice?.issuer ?? '-'}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                      <div>
                        <div className="text-xs text-slate-400">发票号码</div>
                        <div className="mt-1 font-mono text-slate-800">{inspectedReimbursementInvoice?.invoiceNumber ?? '-'}</div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-400">开票日期</div>
                        <div className="mt-1 text-slate-800">{inspectedReimbursementInvoice?.date ?? inspectedReimbursementItem.date}</div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-400">价税合计</div>
                        <div className="mt-1 font-semibold text-slate-900">{formatMoney(inspectedReimbursementInvoice?.amount ?? inspectedReimbursementItem.amount)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-400">税额</div>
                        <div className="mt-1 text-emerald-700">{formatMoney(inspectedReimbursementInvoice?.taxAmount ?? 0)}</div>
                      </div>
                    </div>
                    <div className="rounded-2xl bg-slate-50 px-4 py-3">
                      <div className="text-xs text-slate-400">审批状态</div>
                      <div className="mt-1 text-sm font-medium text-slate-800">
                        {inspectedReimbursementInvoice?.status ?? inspectedReimbursementItem.sourceInvoiceStatus ?? '未审批成功'}
                      </div>
                    </div>
                  </div> :
            <div className="space-y-4 p-4">
                    <div>
                      <div className="mb-2 text-xs font-medium text-blue-600">发票</div>
                      <div className="text-sm font-semibold text-slate-900">{inspectedReimbursementInvoice?.issuer ?? '-'}</div>
                      <div className="mt-1 font-mono text-xs text-slate-500">{inspectedReimbursementInvoice?.invoiceNumber ?? inspectedReimbursementItem.matchedTo ?? '-'}</div>
                      <div className="mt-2 text-sm font-semibold text-slate-900">
                        {formatMoney(inspectedReimbursementInvoice?.amount ?? inspectedReimbursementItem.amount)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-xs font-medium text-emerald-600">
                      <span className="h-px flex-1 bg-emerald-100" />
                      <Link2 className="h-4 w-4" />
                      已关联
                      <span className="h-px flex-1 bg-emerald-100" />
                    </div>
                    <div>
                      <div className="mb-2 text-xs font-medium text-emerald-600">凭证</div>
                      <div className="text-sm font-semibold text-slate-900">{inspectedReimbursementItem.vendor}</div>
                      <div className="mt-1 font-mono text-xs text-slate-500">{getVoucherSubmitId(inspectedReimbursementItem)}</div>
                      <div className="mt-2 text-sm font-semibold text-slate-900">{formatMoney(inspectedReimbursementItem.amount)}</div>
                    </div>
                    <div className="rounded-2xl bg-slate-50 px-4 py-3 text-xs text-slate-500">
                      {inspectedReimbursementItem.category} · {inspectedReimbursementItem.date}
                    </div>
                  </div>
            }
              </aside>
          }

            <DialogFooter className="flex-row items-center justify-between border-t border-slate-100 bg-slate-50 px-6 py-4 sm:justify-between">
              <p className="text-xs text-slate-500">
                确认后将创建报销单，并尝试提交企业微信审批。
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={closeReimbursementDialog}
                  className="rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-600 ring-1 ring-slate-200 transition-colors hover:bg-slate-100">
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => void handleConfirmCreateApproval()}
                  disabled={submittingReimbursement || selectedReimbursementItems.length === 0}
                  className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 px-5 py-2 text-sm font-medium text-white shadow-sm shadow-emerald-500/30 transition-all hover:shadow-md disabled:opacity-50">
                  {submittingReimbursement ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {submittingReimbursement ? '创建中...' : '确认创建'}
                </button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
    </div>);

}
