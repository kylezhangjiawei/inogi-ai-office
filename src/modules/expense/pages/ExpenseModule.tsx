import { useCallback, useEffect, useMemo, useRef, useState, Fragment, type DragEvent as ReactDragEvent } from 'react';
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
  FolderOpen,
  Eye,
  Pencil,
  Trash2,
  Lock,
  Users,
  Building2,
  Hash } from
'lucide-react';
import {
  MOCK_EXPENSE_VOUCHERS,
  MOCK_INVOICE_VOUCHERS,
  MOCK_APPROVALS } from
'../mocks/expenseImportedMock';
import { expenseService } from '../services/expenseService';
import type { InvoiceRecord, ReimbursementRecord, VoucherUploadRecord } from '../types';
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
import { toast } from 'sonner';

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

type DocPreview =
  | { kind: 'voucher'; data: ExpenseVoucherView }
  | { kind: 'invoice'; data: InvoiceVoucherView };

type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'draft';

type ApprovalFlowStep = {
  name: string;
  role: string;
  status: 'done' | 'current' | 'pending' | 'rejected';
  time: string;
  remark?: string;
  // 企业微信审批节点信息
  nodeType?: 'approval' | 'cc';
  approvalMethod?: string; // 或签 / 会签
};

// 企业微信抄送人
type ApprovalCarbonCopy = {
  name: string;
  department?: string;
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
  // 企业微信审批单信息
  weComSpNo?: string; // 审批单号 SpNo
  weComTemplate?: string; // 审批模板名称
  weComSyncStatus?: string; // 同步/回调状态：未提交/已同步/审批中/已回调/同步失败
  weComApprovalMethod?: string; // 整体审批方式：或签/会签
  currentNode?: string; // 当前审批节点
  carbonCopy?: ApprovalCarbonCopy[]; // 抄送人
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

// 由发票反查其关联的报销凭证（findInvoiceForExpenseItem 的逆向）
function findVoucherForInvoice(invoice: InvoiceVoucherView, vouchers: ExpenseVoucherView[]) {
  return vouchers.find((voucher) =>
    voucher.id === invoice.matchedTo ||
    voucher.sourceVoucherId === invoice.matchedTo ||
    voucher.matchedTo === invoice.id ||
    (Boolean(invoice.sourceInvoiceId) && voucher.sourceInvoiceId === invoice.sourceInvoiceId) ||
    (Boolean(invoice.sourceInvoiceId) && voucher.matchedTo === invoice.sourceInvoiceId)
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
    weComSpNo: reimbursement.weComFlowId,
    weComTemplate: '费用报销申请',
    weComSyncStatus: reimbursement.weComSyncStatus,
    weComApprovalMethod: '或签',
    currentNode: reimbursement.node,
    carbonCopy: [{ name: '财务共享中心', department: '财务部' }],
    flow: [
      { name: reimbursement.applicant, role: '申请人', status: 'done', time: reimbursement.appliedDate, nodeType: 'approval' },
      { name: '部门主管', role: '部门审批', status: approved || rejected || pending ? 'done' : 'pending', time: pending || approved || rejected ? reimbursement.appliedDate : '', nodeType: 'approval', approvalMethod: '或签' },
      {
        name: reimbursement.weComApprover || '财务审核',
        role: '财务审核',
        status: rejected ? 'rejected' : approved ? 'done' : pending ? 'current' : 'pending',
        time: reimbursement.weComUpdatedAt,
        remark: rejected ? '审批驳回，请检查材料' : undefined,
        nodeType: 'approval',
        approvalMethod: '或签',
      },
      { name: '出纳', role: '付款确认', status: reimbursement.status === '已付款' ? 'done' : 'pending', time: reimbursement.status === '已付款' ? reimbursement.weComUpdatedAt : '', nodeType: 'approval', approvalMethod: '或签' },
    ],
  };
}

// 基于审批单计算企业微信审批的展示元信息（缺省时给出合理回退，保证 mock 与接口数据一致呈现）
function deriveWeComMeta(approval: ApprovalView) {
  const syncStatus =
    approval.weComSyncStatus ||
    (approval.status === 'pending'
      ? '审批中'
      : approval.status === 'draft'
      ? '未提交'
      : '已回调');
  const currentStep = approval.flow.find((step) => step.status === 'current');
  const digits = approval.id.replace(/[^0-9]/g, '');
  return {
    spNo: approval.weComSpNo || `WW-APPROVAL-${digits.slice(-7) || '0000000'}`,
    template: approval.weComTemplate || '费用报销申请',
    method: approval.weComApprovalMethod || '或签',
    syncStatus,
    currentNode:
      approval.currentNode ||
      currentStep?.role ||
      (approval.status === 'approved' ? '审批完成' : approval.status === 'rejected' ? '已驳回' : '—'),
    carbonCopy: approval.carbonCopy ?? [],
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

/** 发票/凭证单次上传上限（张） */
const MAX_UPLOAD_BATCH = 20;
const ACCEPTED_UPLOAD_MIME = /^(image\/(png|jpe?g|webp)|application\/pdf)$/i;
const ACCEPTED_UPLOAD_EXT = /\.(pdf|png|jpe?g|webp)$/i;

/** 拖拽事件是否携带文件 */
function dragHasFiles(e: ReactDragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files');
}

/** 仅保留支持的发票/凭证文件类型（PDF / PNG / JPG / JPEG / WebP） */
function isAcceptedUploadFile(file: File): boolean {
  return ACCEPTED_UPLOAD_MIME.test(file.type) || ACCEPTED_UPLOAD_EXT.test(file.name);
}

/**
 * 选文件 / 拖拽 / 粘贴三种入口共用的预处理：过滤不支持类型 + 限制单次最多 20 张。
 * 返回可上传的文件；为空或超限时弹提示并返回空数组（调用方据此中止）。
 */
function prepareUploadFiles(rawFiles: File[], label: string): File[] {
  const accepted = rawFiles.filter(isAcceptedUploadFile);
  const rejected = rawFiles.length - accepted.length;
  if (rejected > 0) {
    window.alert(`已忽略 ${rejected} 个不支持的文件，仅支持 PDF / PNG / JPG / JPEG / WebP`);
  }
  if (accepted.length === 0) return [];
  if (accepted.length > MAX_UPLOAD_BATCH) {
    window.alert(`「${label}」一次最多上传 ${MAX_UPLOAD_BATCH} 张，本次为 ${accepted.length} 张，请分批上传`);
    return [];
  }
  return accepted;
}

/** 上传后把后端自动关联结果反馈给用户（上传即触发 AI 识别+关联）。 */
function notifyAutoMatch(
  matches: { auto_linked: number; manual_review: number },
  uploadedCount: number,
  label: string,
): void {
  if (matches.auto_linked > 0) {
    toast.success(
      `已识别并自动关联 ${matches.auto_linked} 张票据` +
        (matches.manual_review > 0 ? `，另有 ${matches.manual_review} 张待人工确认` : ''),
    );
  } else if (matches.manual_review > 0) {
    toast.info(`已上传 ${uploadedCount} 个${label}，${matches.manual_review} 张匹配度不足，可人工确认或手动关联`);
  } else {
    toast.success(`已上传并识别 ${uploadedCount} 个${label}`);
  }
}

export function ExpenseModule() {
  const [activeTab, setActiveTab] = useState('vouchers');
  const [selectedExpense, setSelectedExpense] = useState<string | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<string | null>(null);
  // 原始凭证影像预览（报销凭证 / 发票凭证）
  const [docPreview, setDocPreview] = useState<DocPreview | null>(null);
  const [aiMatching, setAiMatching] = useState(false);
  const [manualLinking, setManualLinking] = useState(false);
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
  // 拖拽上传：当前被拖入的面板（用于高亮蒙层）；鼠标悬停的面板（用于粘贴路由）
  const [dragZone, setDragZone] = useState<'invoice' | 'voucher' | null>(null);
  const hoverZoneRef = useRef<'invoice' | 'voucher' | null>(null);
  const loadingRef = useRef(false);
  const [dateRange, setDateRange] = useState({
    start: '2026-05-01',
    end: '2026-05-31'
  });
  const [archiveSelected, setArchiveSelected] = useState<string>('all');
  const [archiveExpanded, setArchiveExpanded] = useState<Set<string>>(
    new Set(['all', 'cat-food', 'cat-transport'])
  );
  const [archiveKeyword, setArchiveKeyword] = useState('');
  const [archiveSelectedIds, setArchiveSelectedIds] = useState<Set<string>>(() => new Set());
  // 归档分类树：默认由发票首次导入时 AI 自动分组生成，支持增删改查（有数据的分类锁定）
  const [archiveTree, setArchiveTree] = useState<TreeNode[]>(ARCHIVE_TREE);
  const [categoryEditor, setCategoryEditor] = useState<
    { mode: 'add-root' | 'add-child' | 'rename'; parentId?: string; nodeId?: string; name: string; icon: string; withIcon: boolean } | null
  >(null);
  const [categoryDeleteTarget, setCategoryDeleteTarget] = useState<TreeNode | null>(null);
  // 归档列表分页
  const [archivePage, setArchivePage] = useState(1);
  // 已手动移动归类的凭证：voucherId -> 目标分类节点 id（覆盖 AI 自动分组）
  const [manualCategory, setManualCategory] = useState<Record<string, string>>({});
  // 归档列表行操作目标
  const [moveItemTarget, setMoveItemTarget] = useState<ExpenseVoucherView | null>(null);
  const [deleteItemTarget, setDeleteItemTarget] = useState<ExpenseVoucherView | null>(null);
  // 凭证管理 Tab 的搜索与状态筛选（关键字 + 全部/已关联/待关联）
  const [voucherKeyword, setVoucherKeyword] = useState('');
  const [voucherStatusFilter, setVoucherStatusFilter] = useState<'all' | 'matched' | 'unmatched'>('all');

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
        // 已关联发票投影为左栏「报销凭证」；同时保留本会话内上传但尚未关联的付款凭证，
        // 避免 reload 把刚上传、待手动关联的凭证从界面清空。
        setExpenseVouchers((current) => {
          const projectedIds = new Set(nextExpenseVouchers.map((item) => item.id));
          const survivingUploads = current.filter(
            (item) =>
              item.sourceVoucherId &&
              !item.matched &&
              !projectedIds.has(item.id) &&
              !projectedIds.has(item.sourceVoucherId),
          );
          const merged = [...nextExpenseVouchers, ...survivingUploads];
          return merged.length ? merged : current;
        });
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

  // 切换归档分类节点时清空已勾选项并回到第一页，避免跨分类误操作
  useEffect(() => {
    setArchiveSelectedIds(new Set());
    setArchivePage(1);
  }, [archiveSelected]);

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

  // 凭证管理 Tab：按关键字 + 关联状态过滤左右两列
  const filteredExpenseVouchers = useMemo(() => {
    const kw = voucherKeyword.trim().toLowerCase();
    return expenseVouchers.filter((v) => {
      const statusOk =
        voucherStatusFilter === 'all' ||
        (voucherStatusFilter === 'matched' && v.matched) ||
        (voucherStatusFilter === 'unmatched' && !v.matched);
      const kwOk =
        !kw ||
        [v.vendor, v.id, v.category, v.type, v.date, v.matchedTo]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(kw);
      return statusOk && kwOk;
    });
  }, [expenseVouchers, voucherKeyword, voucherStatusFilter]);
  const filteredVoucherInvoices = useMemo(() => {
    const kw = voucherKeyword.trim().toLowerCase();
    return invoiceVouchers.filter((iv) => {
      const statusOk =
        voucherStatusFilter === 'all' ||
        (voucherStatusFilter === 'matched' && iv.matched) ||
        (voucherStatusFilter === 'unmatched' && !iv.matched);
      const kwOk =
        !kw ||
        [iv.issuer, iv.invoiceNumber, iv.type, iv.date, iv.matchedTo]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(kw);
      return statusOk && kwOk;
    });
  }, [invoiceVouchers, voucherKeyword, voucherStatusFilter]);
  const voucherFilterActive = voucherStatusFilter !== 'all' || voucherKeyword.trim().length > 0;

  const handleExpenseUpload = useCallback(async (rawFiles: File[]) => {
    if (loadingRef.current) return;
    const files = prepareUploadFiles(rawFiles, '报销凭证');
    if (!files.length) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const { items: uploaded, matches } = await expenseService.uploadVoucherFiles(files);
      const nextVouchers = uploaded.map(uploadedVoucherToExpenseVoucher);
      setExpenseVouchers((current) => mergeById(current, nextVouchers));
      await reloadExpenseData();
      notifyAutoMatch(matches, uploaded.length, '报销凭证');
    } catch (error) {
      window.alert(`上传报销凭证失败：${toErrorMessage(error)}`);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [reloadExpenseData]);

  const handleInvoiceUpload = useCallback(async (rawFiles: File[]) => {
    if (loadingRef.current) return;
    const files = prepareUploadFiles(rawFiles, '发票凭证');
    if (!files.length) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const { items: uploaded, matches } = await expenseService.uploadInvoiceFiles(files);
      setInvoiceVouchers((current) => mergeById(current, uploaded.map(invoiceToInvoiceVoucher)));
      const matchedUploads = uploaded.filter((invoice) => isInvoiceMatched(invoice)).map(invoiceToExpenseVoucher);
      if (matchedUploads.length) {
        setExpenseVouchers((current) => mergeById(current, matchedUploads));
      }
      await reloadExpenseData();
      notifyAutoMatch(matches, uploaded.length, '发票凭证');
    } catch (error) {
      window.alert(`上传发票凭证失败：${toErrorMessage(error)}`);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [reloadExpenseData]);

  // 拖拽上传：为某个面板生成 drag/drop + 悬停记录的事件属性（拖到哪栏传哪类）
  const makeZoneDropProps = useCallback(
    (zone: 'invoice' | 'voucher') => {
      const onFiles = zone === 'invoice' ? handleInvoiceUpload : handleExpenseUpload;
      return {
        onMouseEnter: () => {
          hoverZoneRef.current = zone;
        },
        onMouseLeave: () => {
          if (hoverZoneRef.current === zone) hoverZoneRef.current = null;
        },
        onDragOver: (e: ReactDragEvent) => {
          if (!dragHasFiles(e)) return;
          e.preventDefault();
          setDragZone(zone);
        },
        onDragLeave: (e: ReactDragEvent) => {
          if ((e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) return;
          setDragZone((z) => (z === zone ? null : z));
        },
        onDrop: (e: ReactDragEvent) => {
          e.preventDefault();
          setDragZone(null);
          const dropped = Array.from(e.dataTransfer?.files ?? []);
          if (dropped.length) void onFiles(dropped);
        },
      };
    },
    [handleInvoiceUpload, handleExpenseUpload],
  );

  // 粘贴上传：鼠标悬停在「报销凭证」或「发票凭证」面板时，粘贴的文件上传到对应面板
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (activeTab !== 'vouchers') return;
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (const it of Array.from(items)) {
        if (it.kind === 'file') {
          const f = it.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length === 0) return; // 纯文本粘贴：放行（搜索框等正常使用）
      const zone = hoverZoneRef.current;
      if (!zone) {
        window.alert('请先把鼠标移到「报销凭证」或「发票凭证」区域，再粘贴文件');
        return;
      }
      e.preventDefault();
      if (zone === 'invoice') void handleInvoiceUpload(files);
      else void handleExpenseUpload(files);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [activeTab, handleInvoiceUpload, handleExpenseUpload]);

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

  // AI 匹配：只对未关联的票据/凭证建链（已关联的后端不会触碰）。手动触发时反馈关联结果。
  const runAiMatch = useCallback(async () => {
    setAiMatching(true);
    try {
      const result = await expenseService.autoMatchVouchers();
      if (result.links.length) {
        applyMatchLinks(result.links);
      }
      await reloadExpenseData();
      if (result.auto_linked > 0) {
        toast.success(
          `AI 已自动关联 ${result.auto_linked} 张票据` +
            (result.manual_review > 0 ? `，另有 ${result.manual_review} 张待人工确认` : ''),
        );
      } else if (result.manual_review > 0) {
        toast.info(`暂无可自动关联的票据，${result.manual_review} 张匹配度不足，请人工确认或手动关联`);
      } else {
        toast.info('未发现可自动关联的票据');
      }
    } catch {
      const local = runLocalMatch();
      if (local > 0) toast.success(`AI 服务暂不可用，已用本地规则临时关联 ${local} 张`);
      else toast.error('AI 匹配服务暂不可用，请稍后重试');
    } finally {
      window.setTimeout(() => setAiMatching(false), 700);
    }
  }, [applyMatchLinks, reloadExpenseData, runLocalMatch]);

  // 手动关联：写入后端并落库。允许对未关联和已关联的凭证重新关联（后端会先释放旧对端再改绑）。
  const handleManualLink = useCallback(async () => {
    if (!selectedExpense || !selectedInvoice) {
      window.alert('请先在左右两侧各选择一条凭证');
      return;
    }
    const voucher = expenseVouchers.find((item) => item.id === selectedExpense);
    const voucherId = voucher?.sourceVoucherId ?? voucher?.id;
    if (!voucherId || voucherId.startsWith('EV-')) {
      window.alert('该付款凭证暂无可关联的凭证记录，请重新上传后再试');
      return;
    }
    setManualLinking(true);
    try {
      await expenseService.linkVoucher(selectedInvoice, voucherId);
      setSelectedExpense(null);
      setSelectedInvoice(null);
      await reloadExpenseData();
      toast.success('已手动关联');
    } catch (error) {
      window.alert(`手动关联失败：${toErrorMessage(error)}`);
    } finally {
      setManualLinking(false);
    }
  }, [expenseVouchers, selectedExpense, selectedInvoice, reloadExpenseData]);

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
    const node = findNode(archiveTree, nodeId);
    if (!node) return [];
    // 该节点子树内所有节点 id（含自身），用于把「移动到子分类」的项聚合到父级
    const subtreeIds = new Set<string>();
    const collect = (n: TreeNode) => {
      subtreeIds.add(n.id);
      n.children?.forEach(collect);
    };
    collect(node);
    return matchedItems.filter((v) => {
      const manual = manualCategory[v.id];
      // 已手动移动归类的项：只归入其目标分类及其父级聚合，脱离原 AI 分组
      if (manual) return subtreeIds.has(manual);
      // 未手动移动：沿用 AI 自动分组的隐式映射
      if (node.children && node.children.length > 0) {
        return v.category === node.name;
      }
      if (node.vendorFilter && node.vendorFilter.length > 0) {
        return node.vendorFilter.some((k) => v.vendor.includes(k));
      }
      return false;
    });
  };
  const toggleArchiveExpanded = (id: string) => {
    setArchiveExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);else
      next.add(id);
      return next;
    });
  };
  // 节点本身或任一子孙存在归档数据时视为「有数据」，按规则锁定修改 / 删除
  const nodeHasData = (node: TreeNode): boolean =>
    getItemsForNode(node.id).length > 0 || (node.children?.some(nodeHasData) ?? false);
  const genCategoryId = () =>
    `cat-custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const addCategoryNode = (parentId: string | null, name: string, icon: string) => {
    const newNode: TreeNode = parentId ?
      { id: genCategoryId(), name, vendorFilter: [] } :
      { id: genCategoryId(), name, icon: icon || '📁', children: [] };
    setArchiveTree((prev) => {
      if (!parentId) return [...prev, newNode];
      const insert = (nodes: TreeNode[]): TreeNode[] =>
        nodes.map((n) =>
          n.id === parentId ?
            { ...n, children: [...(n.children ?? []), newNode] } :
            n.children ? { ...n, children: insert(n.children) } : n
        );
      return insert(prev);
    });
    if (parentId) {
      setArchiveExpanded((prev) => new Set(prev).add(parentId));
    }
  };
  const renameCategoryNode = (nodeId: string, name: string, icon: string) => {
    setArchiveTree((prev) => {
      const rename = (nodes: TreeNode[]): TreeNode[] =>
        nodes.map((n) =>
          n.id === nodeId ?
            { ...n, name, ...(n.icon !== undefined ? { icon: icon || n.icon } : {}) } :
            n.children ? { ...n, children: rename(n.children) } : n
        );
      return rename(prev);
    });
  };
  const removeCategoryNode = (nodeId: string) => {
    setArchiveTree((prev) => {
      const remove = (nodes: TreeNode[]): TreeNode[] =>
        nodes.filter((n) => n.id !== nodeId).map((n) =>
          n.children ? { ...n, children: remove(n.children) } : n
        );
      return remove(prev);
    });
    setArchiveSelected((cur) => (cur === nodeId ? 'all' : cur));
  };
  const submitCategoryEditor = () => {
    if (!categoryEditor) return;
    const name = categoryEditor.name.trim();
    if (!name) return;
    if (categoryEditor.mode === 'rename' && categoryEditor.nodeId) {
      renameCategoryNode(categoryEditor.nodeId, name, categoryEditor.icon);
    } else if (categoryEditor.mode === 'add-child' && categoryEditor.parentId) {
      addCategoryNode(categoryEditor.parentId, name, categoryEditor.icon);
    } else {
      addCategoryNode(null, name, categoryEditor.icon);
    }
    setCategoryEditor(null);
  };
  // 将凭证移动到目标分类节点（覆盖 AI 自动分组），并同步顶级类目名用于展示
  const moveVoucherToNode = (itemId: string, nodeId: string) => {
    const findCatPath = (nodes: TreeNode[], id: string, path: TreeNode[] = []): TreeNode[] | null => {
      for (const n of nodes) {
        const next = [...path, n];
        if (n.id === id) return next;
        if (n.children) {
          const found = findCatPath(n.children, id, next);
          if (found) return found;
        }
      }
      return null;
    };
    const rootName = findCatPath(archiveTree, nodeId)?.[0]?.name;
    setManualCategory((prev) => ({ ...prev, [itemId]: nodeId }));
    if (rootName) {
      setExpenseVouchers((prev) => prev.map((v) => (v.id === itemId ? { ...v, category: rootName } : v)));
    }
    setMoveItemTarget(null);
  };
  // 删除归档凭证（前端移除；接口接入后改为后端删除）
  const deleteArchiveVoucher = (itemId: string) => {
    setExpenseVouchers((prev) => prev.filter((v) => v.id !== itemId));
    setManualCategory((prev) => {
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
    setArchiveSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(itemId);
      return next;
    });
    setDeleteItemTarget(null);
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
  // 归档表格勾选：有勾选时批量操作仅作用于已选项，否则作用于当前分类全部
  const archiveOperationItems = archiveSelectedIds.size
    ? archiveActionItems.filter((item) => archiveSelectedIds.has(item.id))
    : archiveActionItems;
  const archiveAllSelected =
    archiveActionItems.length > 0 && archiveActionItems.every((item) => archiveSelectedIds.has(item.id));
  const archiveSomeSelected = archiveSelectedIds.size > 0 && !archiveAllSelected;
  const toggleArchiveItem = useCallback((itemId: string) => {
    setArchiveSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }, []);
  const toggleArchiveSelectAll = useCallback(() => {
    setArchiveSelectedIds((current) => {
      const allSelected =
        archiveActionItems.length > 0 && archiveActionItems.every((item) => current.has(item.id));
      return allSelected ? new Set<string>() : new Set(archiveActionItems.map((item) => item.id));
    });
  }, [archiveActionItems]);
  const goToVouchers = useCallback((filter: 'all' | 'matched' | 'unmatched') => {
    setVoucherStatusFilter(filter);
    setActiveTab('vouchers');
  }, []);
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
      ...archiveOperationItems.map((item) => {
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
  }, [archiveOperationItems, archiveSelected, downloadCsv, invoiceVouchers]);
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
    <div className="flex h-full min-h-0 w-full flex-col">
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
      <div className=" flex min-h-0 flex-col flex-1 overflow-hidden">
        {/* Stats Strip */}
        <div className="px-5 py-2 flex gap-3 shrink-0">
          <button
            type="button"
            onClick={() => goToVouchers('all')}
            title="查看全部报销凭证"
            className="flex-1 bg-white px-3.5 py-2 rounded-2xl ring-1 ring-slate-900/5 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_4px_12px_-2px_rgba(16,24,40,0.08)] flex items-center gap-3 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_2px_4px_rgba(16,24,40,0.05),0_16px_28px_-8px_rgba(16,24,40,0.14)] focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300">
            <div className="w-8 h-8 rounded-full bg-emerald-50 flex items-center justify-center">
              <Wallet className="w-4 h-4 text-emerald-600" />
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-0.5">本月报销总额</p>
              <p className="text-lg font-bold text-slate-800">
                ¥{totalAmount.toFixed(2)}
              </p>
            </div>
          </button>
          <button
            type="button"
            onClick={() => goToVouchers('matched')}
            title="筛选已关联凭证"
            className="flex-1 bg-white px-3.5 py-2 rounded-2xl ring-1 ring-slate-900/5 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_4px_12px_-2px_rgba(16,24,40,0.08)] flex items-center gap-3 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_2px_4px_rgba(16,24,40,0.05),0_16px_28px_-8px_rgba(16,24,40,0.14)] focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300">
            <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center">
              <Link2 className="w-4 h-4 text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-0.5">已关联凭证</p>
              <p className="text-lg font-bold text-slate-800">{matched}</p>
            </div>
          </button>
          <button
            type="button"
            onClick={() => goToVouchers('unmatched')}
            title="筛选待关联凭证"
            className="flex-1 bg-white px-3.5 py-2 rounded-2xl ring-1 ring-slate-900/5 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_4px_12px_-2px_rgba(16,24,40,0.08)] flex items-center gap-3 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_2px_4px_rgba(16,24,40,0.05),0_16px_28px_-8px_rgba(16,24,40,0.14)] focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300">
            <div className="w-8 h-8 rounded-full bg-amber-50 flex items-center justify-center">
              <AlertCircle className="w-4 h-4 text-amber-600" />
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-0.5">待关联凭证</p>
              <p className="text-lg font-bold text-slate-800">{unmatched}</p>
            </div>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('approval')}
            title="查看审批流"
            className="flex-1 bg-white px-3.5 py-2 rounded-2xl ring-1 ring-slate-900/5 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_4px_12px_-2px_rgba(16,24,40,0.08)] flex items-center gap-3 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_2px_4px_rgba(16,24,40,0.05),0_16px_28px_-8px_rgba(16,24,40,0.14)] focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-300">
            <div className="w-8 h-8 rounded-full bg-purple-50 flex items-center justify-center">
              <Clock className="w-4 h-4 text-purple-600" />
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-0.5">审批中</p>
              <p className="text-lg font-bold text-slate-800">
                {pendingApprovals}
              </p>
            </div>
          </button>
        </div>

        {/* Tabs Nav */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="gap-0">
        <div className="flex items-center justify-between gap-4  px-5 py-4 shrink-0">
          <TabsList className="flex h-auto items-center gap-1 rounded-full bg-slate-100/80 p-1">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              return (
                <TabsTrigger
                  key={tab.id}
                  value={tab.id}
                  className="flex items-center gap-1.5 rounded-full border-0 bg-transparent px-3.5 py-1.5 text-sm font-medium text-slate-500 shadow-none transition-all focus-visible:ring-0 focus-visible:outline-none hover:text-slate-700 data-[state=active]:bg-white data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm data-[state=active]:shadow-slate-900/5">
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
                  className="h-8 border-slate-200 bg-white text-slate-600 hover:border-emerald-200 hover:bg-emerald-50/70 hover:text-emerald-700">
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
              className="h-8 border-slate-200 bg-white text-slate-600 hover:border-emerald-200 hover:bg-emerald-50/70 hover:text-emerald-700">
              {aiMatching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {aiMatching ? '匹配中' : 'AI 匹配'}
            </Button>

            {activeTab === 'vouchers' &&
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleManualLink}
              disabled={!selectedExpense || !selectedInvoice || manualLinking || loading}
              className="h-8 border-slate-200 bg-white text-slate-600 hover:border-emerald-200 hover:bg-emerald-50/70 hover:text-emerald-700">
                {manualLinking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
                {manualLinking ? '关联中' : '手动关联'}
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
                  className="h-8 border-slate-200 bg-white text-slate-600 hover:border-emerald-200 hover:bg-emerald-50/70 hover:text-emerald-700">
                    {archiveSelectedIds.size ? `已选 ${archiveSelectedIds.size}` : '本组操作'}
                    <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48 rounded-2xl p-2">
                  <DropdownMenuItem
                  onSelect={exportArchiveItems}
                  disabled={archiveOperationItems.length === 0}
                  className="rounded-xl">
                    <Download className="h-4 w-4" /> {archiveSelectedIds.size ? `导出所选 (${archiveOperationItems.length})` : '导出当前分类'}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                  onSelect={() => openReimbursementDialog(archiveOperationItems)}
                  disabled={archiveOperationItems.length === 0}
                  className="rounded-xl text-emerald-700">
                    <Send className="h-4 w-4" /> {archiveSelectedIds.size ? `提交所选 (${archiveOperationItems.length})` : '提交本组审批'}
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
              className="h-8 border-slate-200 bg-white text-slate-600 hover:border-emerald-200 hover:bg-emerald-50/70 hover:text-emerald-700">
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
                  className="h-8 border-slate-200 bg-white text-slate-600 hover:border-emerald-200 hover:bg-emerald-50/70 hover:text-emerald-700">
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
        <div className="flex-1 overflow-hidden ">
          {/* TAB 1: VOUCHERS */}
          {activeTab === 'vouchers' &&
          <div className="h-full flex flex-col">
              {/* Toolbar */}
              <div className="px-5 py-2 flex items-center gap-3   shrink-0">
                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                  {[
                    { id: 'all' as const, label: '全部', count: expenseVouchers.length, active: 'bg-slate-200 text-slate-700 ring-1 ring-slate-300', idle: 'bg-slate-100 text-slate-600 hover:bg-slate-200/70' },
                    { id: 'matched' as const, label: '已关联', count: matched, active: 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-300', idle: 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100/70' },
                    { id: 'unmatched' as const, label: '待关联', count: unmatched, active: 'bg-amber-100 text-amber-700 ring-1 ring-amber-300', idle: 'bg-amber-50 text-amber-700 hover:bg-amber-100/70' },
                  ].map((chip) => (
                    <button
                      key={chip.id}
                      type="button"
                      onClick={() => setVoucherStatusFilter(chip.id)}
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-all ${voucherStatusFilter === chip.id ? chip.active : chip.idle}`}>
                      {chip.label} {chip.count}
                    </button>
                  ))}
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <div className="relative w-52">
                    <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                    type="text"
                    value={voucherKeyword}
                    onChange={(e) => setVoucherKeyword(e.target.value)}
                    placeholder="搜索凭证 / 发票 / 供应商"
                    className="w-full pl-10 pr-8 py-1 bg-slate-100 border-none rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
                    {voucherKeyword &&
                    <button
                      type="button"
                      onClick={() => setVoucherKeyword('')}
                      className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200 hover:text-slate-700">
                      <X className="w-3 h-3" />
                    </button>
                    }
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className={`hover:bg-slate-100 ${voucherFilterActive ? 'bg-blue-50 text-blue-600' : 'text-slate-500'}`}>
                        <Filter className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40 rounded-2xl p-2">
                      {[
                        { id: 'all' as const, label: '全部凭证' },
                        { id: 'matched' as const, label: '仅已关联' },
                        { id: 'unmatched' as const, label: '仅待关联' },
                      ].map((opt) => (
                        <DropdownMenuItem
                          key={opt.id}
                          onSelect={() => setVoucherStatusFilter(opt.id)}
                          className="rounded-xl">
                          <Check className={`h-4 w-4 ${voucherStatusFilter === opt.id ? 'text-blue-600' : 'opacity-0'}`} />
                          {opt.label}
                        </DropdownMenuItem>
                      ))}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        disabled={!voucherFilterActive}
                        onSelect={() => {
                          setVoucherStatusFilter('all');
                          setVoucherKeyword('');
                        }}
                        className="rounded-xl text-slate-600">
                        <X className="h-4 w-4" /> 清空筛选
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              {/* Two-column matching area */}
              <div className="flex-1 overflow-hidden flex p-3 gap-3">
                {/* LEFT: Expense vouchers */}
                <div
                  {...makeZoneDropProps('voucher')}
                  className="relative flex-1 bg-white rounded-3xl elevation-1 flex flex-col overflow-hidden min-w-0">
                  {dragZone === 'voucher' && (
                    <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-orange-400 bg-orange-50/85 backdrop-blur-sm">
                      <Upload className="h-8 w-8 text-orange-500" />
                      <p className="text-sm font-medium text-orange-700">松开鼠标上传报销凭证</p>
                      <p className="text-xs text-orange-500/80">单次最多 {MAX_UPLOAD_BATCH} 张 · PDF/PNG/JPG/WebP</p>
                    </div>
                  )}
                  <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between shrink-0">
                    <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                      <Receipt className="w-4 h-4 text-orange-500" />
                      报销凭证
                      <span className="text-xs text-slate-400 font-normal ml-1">
                        ({voucherFilterActive ? `${filteredExpenseVouchers.length}/${expenseVouchers.length}` : expenseVouchers.length})
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
                    {filteredExpenseVouchers.length === 0 ?
                    <div className="flex h-full flex-col items-center justify-center py-10 text-center text-slate-400">
                      <Receipt className="mb-2 h-9 w-9 text-slate-300" />
                      <p className="text-sm">{voucherFilterActive ? '没有符合条件的报销凭证' : '暂无报销凭证'}</p>
                      {voucherFilterActive &&
                      <button
                        type="button"
                        onClick={() => { setVoucherStatusFilter('all'); setVoucherKeyword(''); }}
                        className="mt-2 text-xs text-blue-600 hover:underline">
                        清空筛选条件
                      </button>
                      }
                    </div> :
                    filteredExpenseVouchers.map((v) => {
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
                          <button
                          type="button"
                          title="查看原始凭证"
                          aria-label="查看原始凭证"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDocPreview({ kind: 'voucher', data: v });
                          }}
                          className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors">

                            <Eye className="w-4 h-4" />
                          </button>
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
                <div
                  {...makeZoneDropProps('invoice')}
                  className="relative flex-1 bg-white rounded-3xl elevation-1 flex flex-col overflow-hidden min-w-0">
                  {dragZone === 'invoice' && (
                    <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-blue-400 bg-blue-50/85 backdrop-blur-sm">
                      <Upload className="h-8 w-8 text-blue-500" />
                      <p className="text-sm font-medium text-blue-700">松开鼠标上传发票凭证</p>
                      <p className="text-xs text-blue-500/80">单次最多 {MAX_UPLOAD_BATCH} 张 · PDF/PNG/JPG/WebP</p>
                    </div>
                  )}
                  <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between shrink-0">
                    <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                      <FileText className="w-4 h-4 text-blue-500" />
                      发票凭证
                      <span className="text-xs text-slate-400 font-normal ml-1">
                        ({voucherFilterActive ? `${filteredVoucherInvoices.length}/${totalInvoices}` : totalInvoices})
                      </span>
                    </h3>
                    <span className="text-xs text-slate-400">已导入 {totalInvoices}</span>
                  </div>
                  <div className="flex-1 overflow-y-auto p-3 space-y-2">
                    {filteredVoucherInvoices.length === 0 ?
                    <div className="flex h-full flex-col items-center justify-center py-10 text-center text-slate-400">
                      <FileText className="mb-2 h-9 w-9 text-slate-300" />
                      <p className="text-sm">{voucherFilterActive ? '没有符合条件的发票凭证' : '暂无发票凭证'}</p>
                      {voucherFilterActive &&
                      <button
                        type="button"
                        onClick={() => { setVoucherStatusFilter('all'); setVoucherKeyword(''); }}
                        className="mt-2 text-xs text-blue-600 hover:underline">
                        清空筛选条件
                      </button>
                      }
                    </div> :
                    filteredVoucherInvoices.map((iv) => {
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
                          <button
                          type="button"
                          title="查看原始凭证"
                          aria-label="查看原始凭证"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDocPreview({ kind: 'invoice', data: iv });
                          }}
                          className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors">

                            <Eye className="w-4 h-4" />
                          </button>
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
            // 分页
            const ARCHIVE_PAGE_SIZE = 8;
            const archiveTotalPages = Math.max(1, Math.ceil(currentItems.length / ARCHIVE_PAGE_SIZE));
            const safeArchivePage = Math.min(archivePage, archiveTotalPages);
            const pagedArchiveItems = currentItems.slice(
              (safeArchivePage - 1) * ARCHIVE_PAGE_SIZE,
              safeArchivePage * ARCHIVE_PAGE_SIZE
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
            findPath(archiveTree, archiveSelected) || [];
            const currentNode = breadcrumb[breadcrumb.length - 1];
            const archiveKw = archiveKeyword.trim().toLowerCase();
            // 按关键字过滤分类树：命中节点或其子节点命中时保留
            const filterTreeNodes = (nodes: TreeNode[]): TreeNode[] => {
              if (!archiveKw) return nodes;
              return nodes.reduce<TreeNode[]>((acc, node) => {
                const selfMatch = node.name.toLowerCase().includes(archiveKw);
                const matchedChildren = node.children ? filterTreeNodes(node.children) : undefined;
                if (selfMatch || (matchedChildren && matchedChildren.length)) {
                  acc.push({ ...node, children: matchedChildren && matchedChildren.length ? matchedChildren : node.children });
                }
                return acc;
              }, []);
            };
            const visibleTree = filterTreeNodes(archiveTree);
            const renderTreeNode = (node: TreeNode, depth: number) => {
              const hasChildren = node.children && node.children.length > 0;
              const isExpanded = archiveExpanded.has(node.id) || archiveKw.length > 0;
              const isSelected = archiveSelected === node.id;
              const nodeItems = getItemsForNode(node.id);
              const nodeTotal = nodeItems.reduce((s, v) => s + v.amount, 0);
              const hasData = nodeHasData(node);
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
                      {/* 行内增删改（hover 显示）；有数据的分类锁定 */}
                      <div
                      className="hidden group-hover:flex items-center gap-0.5 shrink-0"
                      onClick={(e) => e.stopPropagation()}>
                        {depth === 0 &&
                      <button
                        type="button"
                        title="添加子类"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCategoryEditor({ mode: 'add-child', parentId: node.id, name: '', icon: '', withIcon: false });
                        }}
                        className="w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:text-blue-600 hover:bg-blue-100/60">
                          <Plus className="w-3 h-3" />
                        </button>
                      }
                        {hasData ?
                      <span
                        title="该分类下已有归档数据，不可修改 / 删除"
                        className="w-5 h-5 flex items-center justify-center text-slate-300">
                          <Lock className="w-3 h-3" />
                        </span> :

                      <>
                          <button
                          type="button"
                          title="重命名"
                          onClick={(e) => {
                            e.stopPropagation();
                            setCategoryEditor({ mode: 'rename', nodeId: node.id, name: node.name, icon: node.icon ?? '', withIcon: depth === 0 });
                          }}
                          className="w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:text-blue-600 hover:bg-blue-100/60">
                            <Pencil className="w-3 h-3" />
                          </button>
                          <button
                          type="button"
                          title="删除"
                          onClick={(e) => {
                            e.stopPropagation();
                            setCategoryDeleteTarget(node);
                          }}
                          className="w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:text-rose-600 hover:bg-rose-100/60">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </>
                      }
                      </div>
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
                        <button
                          type="button"
                          title="新增费用类别"
                          onClick={() => setCategoryEditor({ mode: 'add-root', name: '', icon: '📁', withIcon: true })}
                          className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors">
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="relative">
                        <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                        type="text"
                        value={archiveKeyword}
                        onChange={(e) => setArchiveKeyword(e.target.value)}
                        placeholder="搜索分类"
                        className="w-full pl-8 pr-7 py-1.5 bg-slate-50 border-none rounded-full text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
                        {archiveKeyword &&
                        <button
                          type="button"
                          onClick={() => setArchiveKeyword('')}
                          className="absolute right-2 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200 hover:text-slate-700">
                          <X className="w-3 h-3" />
                        </button>
                        }
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

                      <div className="px-2 pt-3 pb-1 flex items-center justify-between">
                        <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">
                          费用类别
                        </span>
                        <span
                        className="inline-flex items-center gap-0.5 text-[9px] text-violet-500"
                        title="发票首次导入时由 AI 自动分组生成；已有归档数据的分类不可修改 / 删除">
                          <Sparkles className="w-2.5 h-2.5" /> AI 自动分组
                        </span>
                      </div>
                      {visibleTree.length ?
                      visibleTree.map((node) => renderTreeNode(node, 0)) :
                      <div className="px-2 py-4 text-center text-xs text-slate-400">未找到匹配的分类</div>
                      }
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
                        <div className="flex items-center gap-2 text-xs font-medium text-slate-400">
                          {archiveSelectedIds.size > 0 &&
                          <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-blue-600">
                            已选 {archiveSelectedIds.size}
                            <button
                              type="button"
                              onClick={() => setArchiveSelectedIds(new Set())}
                              className="text-blue-400 hover:text-blue-700">
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                          }
                          <span>{currentItems.length} 项</span>
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

                    <table className="w-full min-w-[660px] table-fixed text-sm">
                          <colgroup>
                            <col className="w-10" />
                            <col />
                            <col className="w-[32%]" />
                            <col className="w-[104px]" />
                            <col className="w-[78px]" />
                            <col className="w-[112px]" />
                          </colgroup>
                          <thead className="text-xs text-slate-500 bg-slate-50/50 sticky top-0 z-10">
                            <tr>
                              <th className="px-3 py-2.5 text-left font-medium">
                                <Checkbox
                              checked={archiveAllSelected ? true : archiveSomeSelected ? 'indeterminate' : false}
                              aria-label="全选当前分类"
                              onCheckedChange={toggleArchiveSelectAll}
                              className="h-4 w-4 rounded border-slate-300 data-[state=checked]:border-blue-500 data-[state=checked]:bg-blue-500 data-[state=indeterminate]:border-blue-500 data-[state=indeterminate]:bg-blue-500" />
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
                              <th className="px-3 py-2.5 text-center font-medium">
                                操作
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50">
                            {pagedArchiveItems.map((v) => {
                          const iv = invoiceVouchers.find(
                            (i) => i.id === v.matchedTo
                          );
                          return (
                            <tr
                              key={v.id}
                              className={`transition-colors ${archiveSelectedIds.has(v.id) ? 'bg-blue-50/40' : 'hover:bg-slate-50/50'}`}>

                                  <td className="px-3 py-3">
                                    <Checkbox
                                  checked={archiveSelectedIds.has(v.id)}
                                  aria-label={`选择 ${v.id}`}
                                  onCheckedChange={() => toggleArchiveItem(v.id)}
                                  className="h-4 w-4 rounded border-slate-300 data-[state=checked]:border-blue-500 data-[state=checked]:bg-blue-500" />
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
                                  <td className="px-3 py-3">
                                    <div className="flex items-center justify-center gap-1">
                                      <button
                                    type="button"
                                    title="查看原始凭证"
                                    onClick={() => setDocPreview({ kind: 'voucher', data: v })}
                                    className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-blue-50 hover:text-blue-600">
                                        <Eye className="h-3.5 w-3.5" />
                                      </button>
                                      <button
                                    type="button"
                                    title="移动到其他类目"
                                    onClick={() => setMoveItemTarget(v)}
                                    className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-violet-50 hover:text-violet-600">
                                        <FolderOpen className="h-3.5 w-3.5" />
                                      </button>
                                      <button
                                    type="button"
                                    title="删除"
                                    onClick={() => setDeleteItemTarget(v)}
                                    className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600">
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                  </td>
                                </tr>);

                        })}
                          </tbody>
                        </table>
                    }
                    </div>
                    {/* 分页栏 */}
                    {currentItems.length > 0 &&
                  <div className="flex shrink-0 items-center justify-between border-t border-slate-100 bg-white px-5 py-2.5">
                        <span className="text-xs text-slate-400">
                          共 {currentItems.length} 项 · 每页 {ARCHIVE_PAGE_SIZE} 条
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                        type="button"
                        disabled={safeArchivePage <= 1}
                        onClick={() => setArchivePage(safeArchivePage - 1)}
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40">
                            <ChevronLeft className="h-4 w-4" />
                          </button>
                          {Array.from({ length: archiveTotalPages }, (_, i) => i + 1).map((p) =>
                        <button
                          key={p}
                          type="button"
                          onClick={() => setArchivePage(p)}
                          className={`h-7 min-w-[28px] rounded-lg px-1.5 text-xs font-medium transition-colors ${p === safeArchivePage ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}>
                              {p}
                            </button>
                        )}
                          <button
                        type="button"
                        disabled={safeArchivePage >= archiveTotalPages}
                        onClick={() => setArchivePage(safeArchivePage + 1)}
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40">
                            <ChevronRight className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                  }
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
              {selectedApproval && (() => {
              const meta = deriveWeComMeta(selectedApproval);
              const statusLabel =
              selectedApproval.status === 'approved' ? '已通过' :
              selectedApproval.status === 'rejected' ? '已驳回' :
              selectedApproval.status === 'draft' ? '草稿' : '审批中';
              const statusBadgeStyle =
              selectedApproval.status === 'approved' ? 'bg-emerald-50 text-emerald-700' :
              selectedApproval.status === 'rejected' ? 'bg-rose-50 text-rose-700' :
              selectedApproval.status === 'draft' ? 'bg-slate-100 text-slate-500' : 'bg-amber-50 text-amber-700';
              const syncBadgeStyle =
              meta.syncStatus === '同步失败' ? 'bg-rose-50 text-rose-600 border-rose-100' :
              meta.syncStatus === '审批中' ? 'bg-amber-50 text-amber-600 border-amber-100' :
              meta.syncStatus === '未提交' ? 'bg-slate-100 text-slate-500 border-slate-200' :
              'bg-emerald-50 text-emerald-600 border-emerald-100';
              const materialTotal = (selectedApproval.materials ?? []).reduce((sum, m) => sum + m.invoiceAmount, 0);
              return (
            <div className="flex-1 bg-white rounded-3xl elevation-1 flex flex-col overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-100 flex items-start justify-between gap-3 shrink-0">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-semibold text-slate-800 truncate">
                          {selectedApproval.title}
                        </h3>
                        <span className="shrink-0 rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-600">
                          {meta.template}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1 font-mono">
                        {selectedApproval.id} · 提交于 {selectedApproval.submitDate}
                      </p>
                    </div>
                    <span className={`shrink-0 inline-flex items-center rounded-full px-3 py-1.5 text-xs font-medium ${statusBadgeStyle}`}>
                      {statusLabel}
                    </span>
                  </div>

                  <div className="flex-1 overflow-y-auto p-6 space-y-5">
                    {/* 企业微信审批信息 */}
                    <div className="rounded-2xl border border-blue-100/80 bg-gradient-to-br from-blue-50/80 to-indigo-50/30 p-4">
                      <div className="flex items-center justify-between mb-3.5">
                        <div className="flex items-center gap-2">
                          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600">
                            <MessageCircle className="h-3.5 w-3.5" />
                          </span>
                          <span className="text-sm font-semibold text-slate-700">企业微信审批</span>
                        </div>
                        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${syncBadgeStyle}`}>
                          <span className="h-1.5 w-1.5 rounded-full bg-current" />
                          {meta.syncStatus}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-xs">
                        <div>
                          <p className="text-slate-400 mb-0.5 flex items-center gap-1"><Hash className="h-3 w-3" />审批单号 SpNo</p>
                          <p className="font-mono font-medium text-slate-700 truncate">{meta.spNo}</p>
                        </div>
                        <div>
                          <p className="text-slate-400 mb-0.5">审批模板</p>
                          <p className="font-medium text-slate-700">{meta.template}</p>
                        </div>
                        <div>
                          <p className="text-slate-400 mb-0.5">申请人</p>
                          <p className="font-medium text-slate-700">{selectedApproval.applicant} · {selectedApproval.department}</p>
                        </div>
                        <div>
                          <p className="text-slate-400 mb-0.5">审批方式</p>
                          <p className="font-medium text-slate-700">{meta.method}</p>
                        </div>
                        <div>
                          <p className="text-slate-400 mb-0.5">当前节点</p>
                          <p className="font-medium text-slate-700">{meta.currentNode}</p>
                        </div>
                        <div>
                          <p className="text-slate-400 mb-0.5">提交时间</p>
                          <p className="font-medium text-slate-700">{selectedApproval.submitDate}</p>
                        </div>
                      </div>
                      <div className="mt-3.5 pt-3 border-t border-blue-100/70 flex items-center gap-2 flex-wrap">
                        <span className="flex items-center gap-1 text-xs text-slate-400">
                          <Users className="h-3.5 w-3.5" />抄送人
                        </span>
                        {meta.carbonCopy.length ?
                      <div className="flex flex-wrap items-center gap-1.5">
                            {meta.carbonCopy.map((cc) =>
                        <span key={cc.name} className="inline-flex items-center gap-1.5 rounded-full bg-white/80 py-0.5 pl-0.5 pr-2.5 text-xs text-slate-600">
                                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-200 text-[10px] font-medium text-slate-600">
                                  {cc.name.charAt(0)}
                                </span>
                                {cc.name}
                                {cc.department && <span className="text-slate-400">{cc.department}</span>}
                              </span>
                        )}
                          </div> :
                      <span className="text-xs text-slate-400">无</span>
                      }
                      </div>
                    </div>

                    {/* Summary */}
                    <div className="grid grid-cols-3 gap-4">
                      <div className="bg-slate-50 rounded-2xl p-4">
                        <p className="text-xs text-slate-500 mb-1">报销金额</p>
                        <p className="text-xl font-bold text-slate-800">
                          {formatMoney(selectedApproval.amount)}
                        </p>
                      </div>
                      <div className="bg-slate-50 rounded-2xl p-4">
                        <p className="text-xs text-slate-500 mb-1">单据数量</p>
                        <p className="text-xl font-bold text-slate-800">
                          {selectedApproval.materials?.length ? `${selectedApproval.materials.length} 笔` : `${selectedApproval.items} 项`}
                          {selectedApproval.materials?.length ?
                        <span className="text-xs font-normal text-slate-400 ml-1">{selectedApproval.materials.length * 2} 份附件</span> :
                        null}
                        </p>
                      </div>
                      <div className="bg-slate-50 rounded-2xl p-4">
                        <p className="text-xs text-slate-500 mb-1">审批进度</p>
                        <p className="text-xl font-bold text-slate-800">
                          {selectedApproval.currentStep}
                          <span className="text-sm font-normal text-slate-400">/{selectedApproval.totalSteps}</span>
                        </p>
                        <div className="mt-2 h-1 bg-slate-200 rounded-full overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-blue-500 to-blue-600 rounded-full" style={{ width: `${selectedApproval.currentStep / selectedApproval.totalSteps * 100}%` }} />
                        </div>
                      </div>
                    </div>

                    {selectedApproval.materials && selectedApproval.materials.length > 0 &&
                  <div>
                        <h4 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
                          <Archive className="w-4 h-4 text-emerald-500" />
                          提交材料
                          <span className="ml-auto text-xs font-normal text-slate-400">合计 {formatMoney(materialTotal)}</span>
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
                        <TrendingUp className="w-4 h-4 text-blue-500" />
                        审批流程
                        <span className="ml-auto text-xs font-normal text-slate-400">共 {selectedApproval.flow.length} 个节点</span>
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
                                <div className="flex items-center justify-between gap-3">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-[11px] font-medium text-slate-500 shrink-0">
                                      {step.name.charAt(0)}
                                    </span>
                                    <span className="text-sm font-medium text-slate-800">
                                      {step.name}
                                    </span>
                                    <span className="text-xs text-slate-400">
                                      {step.role}
                                    </span>
                                    {!step.role.includes('申请') &&
                                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                                      {step.approvalMethod ?? meta.method}
                                    </span>
                                }
                                  </div>
                                  {step.time &&
                              <span className="text-xs text-slate-400 font-mono shrink-0">
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
                </div>);
              })()}
            </div>
          }

          {/* TAB 4: BUYBACK */}
          {activeTab === 'buyback' &&
          <div className="h-full flex flex-col overflow-hidden p-6 gap-5">
              {/* Date Range Selector */}
              <div className="bg-white rounded-3xl p-5 elevation-1 shrink-0">
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
              <div className="grid grid-cols-3 gap-5 shrink-0">
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
              <div className="bg-white rounded-3xl elevation-1 overflow-hidden flex-1 flex flex-col min-h-0">
                <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
                  <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-blue-500" />
                    发票回购明细表单
                  </h3>
                  <span className="text-xs text-slate-500">
                    共 {filteredInvoices.length} 条记录
                  </span>
                </div>
                <div className="flex-1 overflow-y-auto min-h-0">
                <table className="w-full text-sm">
                  <thead className="text-xs text-slate-500 bg-slate-50 sticky top-0 z-10">
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
                      <th className="px-5 py-3 text-right font-medium">操作</th>
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
                        <td className="px-5 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                          onClick={() => setDocPreview({ kind: 'invoice', data: iv })}
                          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 transition-colors whitespace-nowrap">

                              <Eye className="h-3.5 w-3.5" />原始票据
                            </button>
                            {(() => {
                          const linkedVoucher = findVoucherForInvoice(iv, expenseVouchers);
                          return linkedVoucher ?
                          <button
                            onClick={() => setDocPreview({ kind: 'voucher', data: linkedVoucher })}
                            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-emerald-600 hover:bg-emerald-50 transition-colors whitespace-nowrap">

                                  <Link2 className="h-3.5 w-3.5" />关联凭证
                                </button> :
                          <span className="inline-flex items-center rounded-lg px-2 py-1 text-xs text-slate-300 whitespace-nowrap">未关联</span>;
                        })()}
                          </div>
                        </td>
                      </tr>
                  )}
                    {filteredInvoices.length === 0 &&
                  <tr>
                        <td
                      colSpan={9}
                      className="px-5 py-10 text-center text-sm text-slate-400">

                          所选日期区间内暂无发票
                        </td>
                      </tr>
                  }
                  </tbody>
                  {filteredInvoices.length > 0 &&
                <tfoot className="bg-slate-50 font-medium sticky bottom-0 z-10 border-t border-slate-100">
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
                        <td className="px-5 py-3"></td>
                      </tr>
                    </tfoot>
                }
                </table>
                </div>
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

        {/* 原始凭证影像预览 */}
        <Dialog
          open={docPreview !== null}
          onOpenChange={(open) => {
            if (!open) setDocPreview(null);
          }}>
          <DialogContent className="w-full max-w-lg gap-0 overflow-hidden rounded-3xl border-0 bg-white p-0 elevation-3">
            <DialogHeader className="border-b border-slate-100 px-5 py-4 text-left">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                  <Eye className="h-4 w-4" />
                </span>
                <div>
                  <DialogTitle className="text-base font-semibold text-slate-900">原始凭证影像</DialogTitle>
                  <DialogDescription className="mt-0.5 text-xs text-slate-500">
                    {docPreview?.kind === 'invoice' ? '发票凭证' : '报销凭证'} · {docPreview?.data.id}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            {docPreview && (() => {
              const isInvoice = docPreview.kind === 'invoice';
              const counterpart = isInvoice
                ? findVoucherForInvoice(docPreview.data, expenseVouchers)
                : findInvoiceForExpenseItem(docPreview.data, invoiceVouchers);
              const label = isInvoice ? '关联凭证' : '关联发票';
              const cpName = counterpart ? (isInvoice ? (counterpart as ExpenseVoucherView).vendor : (counterpart as InvoiceVoucherView).issuer) : '';
              const cpNo = counterpart ? (isInvoice ? (counterpart as ExpenseVoucherView).id : (counterpart as InvoiceVoucherView).invoiceNumber) : '';
              return (
                <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/70 px-5 py-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                    <Link2 className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] text-slate-400">{label}</p>
                    {counterpart ?
                    <p className="truncate text-xs font-medium text-slate-700">{cpName} · <span className="font-mono text-slate-500">{cpNo}</span></p> :
                    <p className="text-xs text-slate-400">暂无{label}</p>
                    }
                  </div>
                  {counterpart &&
                  <>
                    <span className="shrink-0 text-xs font-semibold text-slate-700">¥{counterpart.amount.toFixed(2)}</span>
                    <button
                    type="button"
                    onClick={() => setDocPreview(isInvoice
                      ? { kind: 'voucher', data: counterpart as ExpenseVoucherView }
                      : { kind: 'invoice', data: counterpart as InvoiceVoucherView })}
                    className="shrink-0 inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-xs font-medium text-blue-600 ring-1 ring-slate-200 transition-colors hover:bg-blue-50">
                      <Eye className="h-3 w-3" />查看
                    </button>
                  </>
                  }
                </div>);
            })()}

            <div className="max-h-[70vh] overflow-y-auto bg-slate-100/70 px-5 py-6">
              {docPreview?.kind === 'invoice' && (() => {
                const iv = docPreview.data;
                return (
                  <div className="mx-auto w-full max-w-md rounded-lg border-2 border-rose-300 bg-white shadow-sm">
                    <div className="border-b-2 border-dashed border-rose-200 px-5 pb-3 pt-4 text-center">
                      <div className="text-base font-bold tracking-[0.25em] text-rose-600">{iv.type}</div>
                      <div className="mt-1.5 flex items-center justify-between text-[11px] text-rose-500/90">
                        <span>发票代码：044002600</span>
                        <span>发票号码：{iv.invoiceNumber}</span>
                      </div>
                    </div>
                    <div className="px-5 py-4 text-xs text-slate-700">
                      <div className="flex items-start justify-between py-1">
                        <span className="text-slate-400">开票日期</span>
                        <span className="font-mono">{iv.date}</span>
                      </div>
                      <div className="flex items-start justify-between py-1">
                        <span className="shrink-0 text-slate-400">销售方</span>
                        <span className="ml-4 text-right font-medium text-slate-800">{iv.issuer}</span>
                      </div>
                      <div className="my-2.5 border-t border-slate-100" />
                      <div className="flex items-center justify-between py-1 text-slate-500">
                        <span>金额（不含税）</span>
                        <span className="font-mono">¥{(iv.amount - iv.taxAmount).toFixed(2)}</span>
                      </div>
                      <div className="flex items-center justify-between py-1 text-slate-500">
                        <span>税额</span>
                        <span className="font-mono">¥{iv.taxAmount.toFixed(2)}</span>
                      </div>
                      <div className="mt-2.5 flex items-center justify-between border-t border-slate-100 pt-2.5">
                        <span className="text-sm font-semibold text-slate-800">价税合计</span>
                        <span className="text-lg font-bold text-rose-600">¥{iv.amount.toFixed(2)}</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between px-5 pb-5">
                      <span className="text-[10px] text-slate-300">收款人：系统 · 复核：系统 · 开票人：系统</span>
                      <div className="flex h-[72px] w-[72px] rotate-[-14deg] items-center justify-center rounded-full border-[2.5px] border-rose-400/70 text-center">
                        <span className="px-1 text-[8px] font-semibold leading-tight text-rose-500/80">发票<br />专用章<br />★</span>
                      </div>
                    </div>
                  </div>);

              })()}

              {docPreview?.kind === 'voucher' && (() => {
                const v = docPreview.data;
                return (
                  <div className="mx-auto w-full max-w-[300px] bg-white px-6 py-6 font-mono text-xs text-slate-700 shadow-sm">
                    <div className="text-center">
                      <div className="text-sm font-bold tracking-wider text-slate-800">{v.vendor}</div>
                      <div className="mt-1 text-[11px] text-slate-400">消费凭据 · {v.type}</div>
                    </div>
                    <div className="my-3 border-t border-dashed border-slate-300" />
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-slate-400">凭证编号</span>
                        <span>{v.id}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">消费类别</span>
                        <span>{v.category}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">消费日期</span>
                        <span>{v.date}</span>
                      </div>
                    </div>
                    <div className="my-3 border-t border-dashed border-slate-300" />
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-slate-700">消费金额</span>
                      <span className="text-lg font-bold text-slate-900">¥{v.amount.toFixed(2)}</span>
                    </div>
                    <div className="mt-5 text-center text-[10px] tracking-widest text-slate-300">— 凭据底部 —</div>
                  </div>);

              })()}
            </div>

            <DialogFooter className="flex-row items-center justify-between border-t border-slate-100 bg-slate-50 px-5 py-3 sm:justify-between">
              <p className="text-[11px] text-slate-400">影像在凭证上传时由系统留存</p>
              <button
                type="button"
                onClick={() => setDocPreview(null)}
                className="rounded-full bg-white px-4 py-1.5 text-sm font-medium text-slate-600 ring-1 ring-slate-200 transition-colors hover:bg-slate-100">

                关闭
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 归档分类 · 新增 / 重命名 */}
        <Dialog
          open={categoryEditor !== null}
          onOpenChange={(open) => {
            if (!open) setCategoryEditor(null);
          }}>
          <DialogContent className="w-full max-w-sm gap-0 overflow-hidden rounded-3xl border-0 bg-white p-0 elevation-3">
            <DialogHeader className="border-b border-slate-100 px-5 py-4 text-left">
              <DialogTitle className="text-base font-semibold text-slate-900">
                {categoryEditor?.mode === 'rename' ? '重命名分类' : categoryEditor?.mode === 'add-child' ? '新增子分类' : '新增费用类别'}
              </DialogTitle>
              <DialogDescription className="mt-0.5 text-xs text-slate-500">
                {categoryEditor?.mode === 'add-child' ? '在所选费用类别下创建子分类' : '用于报销凭证的归档分类管理'}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 px-5 py-4">
              {categoryEditor?.withIcon &&
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-500">图标</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={categoryEditor.icon}
                    maxLength={2}
                    onChange={(e) => setCategoryEditor((prev) => prev ? { ...prev, icon: e.target.value } : prev)}
                    className="h-10 w-12 rounded-xl border-none bg-slate-50 text-center text-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
                  <div className="flex flex-wrap gap-1">
                    {['📁', '🍜', '🚗', '📦', '🏨', '✈️', '💼', '🎫', '🏷️', '📄'].map((emo) =>
                    <button
                      key={emo}
                      type="button"
                      onClick={() => setCategoryEditor((prev) => prev ? { ...prev, icon: emo } : prev)}
                      className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-slate-100">
                        {emo}
                      </button>
                    )}
                  </div>
                </div>
              </div>
              }
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-500">分类名称</label>
                <input
                  type="text"
                  autoFocus
                  value={categoryEditor?.name ?? ''}
                  onChange={(e) => setCategoryEditor((prev) => prev ? { ...prev, name: e.target.value } : prev)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitCategoryEditor();
                  }}
                  placeholder="请输入分类名称"
                  className="w-full rounded-xl border-none bg-slate-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
              </div>
            </div>
            <DialogFooter className="flex-row items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3">
              <button
                type="button"
                onClick={() => setCategoryEditor(null)}
                className="rounded-full bg-white px-4 py-1.5 text-sm font-medium text-slate-600 ring-1 ring-slate-200 transition-colors hover:bg-slate-100">
                取消
              </button>
              <button
                type="button"
                onClick={submitCategoryEditor}
                disabled={!categoryEditor?.name.trim()}
                className="inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50">
                <Check className="h-4 w-4" /> 保存
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 归档分类 · 删除确认 */}
        <Dialog
          open={categoryDeleteTarget !== null}
          onOpenChange={(open) => {
            if (!open) setCategoryDeleteTarget(null);
          }}>
          <DialogContent className="w-full max-w-sm gap-0 overflow-hidden rounded-3xl border-0 bg-white p-0 elevation-3">
            <DialogHeader className="px-5 py-4 text-left">
              <DialogTitle className="text-base font-semibold text-slate-900">删除分类</DialogTitle>
              <DialogDescription className="mt-1 text-xs leading-relaxed text-slate-500">
                确认删除「{categoryDeleteTarget?.name}」
                {categoryDeleteTarget?.children && categoryDeleteTarget.children.length > 0 ? ' 及其全部子分类' : ''}
                ？该操作不可撤销。
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex-row items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3">
              <button
                type="button"
                onClick={() => setCategoryDeleteTarget(null)}
                className="rounded-full bg-white px-4 py-1.5 text-sm font-medium text-slate-600 ring-1 ring-slate-200 transition-colors hover:bg-slate-100">
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  if (categoryDeleteTarget) removeCategoryNode(categoryDeleteTarget.id);
                  setCategoryDeleteTarget(null);
                }}
                className="inline-flex items-center gap-1.5 rounded-full bg-rose-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-rose-700">
                <Trash2 className="h-4 w-4" /> 删除
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 归档凭证 · 移动到其他类目 */}
        <Dialog
          open={moveItemTarget !== null}
          onOpenChange={(open) => {
            if (!open) setMoveItemTarget(null);
          }}>
          <DialogContent className="w-full max-w-md gap-0 overflow-hidden rounded-3xl border-0 bg-white p-0 elevation-3">
            <DialogHeader className="border-b border-slate-100 px-5 py-4 text-left">
              <DialogTitle className="text-base font-semibold text-slate-900">移动到其他类目</DialogTitle>
              <DialogDescription className="mt-0.5 text-xs text-slate-500">
                将「{moveItemTarget?.vendor}」（{moveItemTarget?.id}）移动到所选分类下
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[55vh] overflow-y-auto px-3 py-3">
              {(() => {
                const current = moveItemTarget ? manualCategory[moveItemTarget.id] : undefined;
                const renderOption = (node: TreeNode, depth: number) =>
                  <Fragment key={node.id}>
                    <button
                      type="button"
                      onClick={() => {
                        if (moveItemTarget) moveVoucherToNode(moveItemTarget.id, node.id);
                      }}
                      className={`flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-sm transition-colors ${current === node.id ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-100/70'}`}
                      style={{ paddingLeft: `${depth * 16 + 8}px` }}>
                      {node.icon ?
                      <span className="text-base">{node.icon}</span> :
                      <span className="ml-1 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
                      }
                      <span className="flex-1 truncate">{node.name}</span>
                      {current === node.id &&
                      <span className="shrink-0 text-[10px] text-blue-500">当前</span>
                      }
                    </button>
                    {node.children?.map((c) => renderOption(c, depth + 1))}
                  </Fragment>;
                return archiveTree.map((node) => renderOption(node, 0));
              })()}
            </div>
            <DialogFooter className="flex-row items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3">
              <button
                type="button"
                onClick={() => setMoveItemTarget(null)}
                className="rounded-full bg-white px-4 py-1.5 text-sm font-medium text-slate-600 ring-1 ring-slate-200 transition-colors hover:bg-slate-100">
                取消
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 归档凭证 · 删除确认 */}
        <Dialog
          open={deleteItemTarget !== null}
          onOpenChange={(open) => {
            if (!open) setDeleteItemTarget(null);
          }}>
          <DialogContent className="w-full max-w-sm gap-0 overflow-hidden rounded-3xl border-0 bg-white p-0 elevation-3">
            <DialogHeader className="px-5 py-4 text-left">
              <DialogTitle className="text-base font-semibold text-slate-900">删除归档凭证</DialogTitle>
              <DialogDescription className="mt-1 text-xs leading-relaxed text-slate-500">
                确认删除报销凭证「{deleteItemTarget?.vendor}」（{deleteItemTarget?.id} · ¥{deleteItemTarget?.amount.toFixed(2)}）？删除后将从归档列表移除，该操作不可撤销。
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex-row items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3">
              <button
                type="button"
                onClick={() => setDeleteItemTarget(null)}
                className="rounded-full bg-white px-4 py-1.5 text-sm font-medium text-slate-600 ring-1 ring-slate-200 transition-colors hover:bg-slate-100">
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  if (deleteItemTarget) deleteArchiveVoucher(deleteItemTarget.id);
                }}
                className="inline-flex items-center gap-1.5 rounded-full bg-rose-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-rose-700">
                <Trash2 className="h-4 w-4" /> 删除
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
    </div>);

}
