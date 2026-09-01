import { useCallback, useEffect, useMemo, useRef, useState, Fragment, type DragEvent as ReactDragEvent, type ReactNode } from 'react';
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
  BarChart3,
  ClipboardCheck,
  Hash,
  type LucideIcon,
} from 'lucide-react';
import {
  expenseService,
  type ExpenseDepartmentOption,
  type ExpenseIntegrationRequirements,
} from '../services/expenseService';
import type { ExpenseDashboardData, InvoiceRecord, ReimbursementRecord, VoucherUploadRecord } from '../types';
import { ExpenseStatistics } from '../components/ExpenseStatistics';
import { useAuth } from '../../../app/auth';
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../../app/components/ui/alert-dialog';
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
import { integrationManagementApi, type MailboxItem } from '../../../app/lib/integrationManagementApi';
import { AutoTranslatedText } from '../../../app/components/TranslatableText';
import {
  HorizonMetricGrid,
  HorizonPageHeader,
  HorizonSectionHeader,
} from '../../../app/components/horizon/HorizonPage';
import { t as translate, useI18n } from '../../../app/lib/i18n';
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
  project?: string;
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
  project?: string; // 项目/成本归属
  notifyEmails?: string[]; // 邮件通知收件人（来自邮箱管理）
  ccEmails?: string[]; // 邮件抄送人
};

type ReimbursementInspector = {
  itemId: string;
  kind: 'invoice' | 'link';
};

const expenseCategoryColor: Record<string, string> = {
  餐饮: 'bg-orange-100',
  交通: 'bg-blue-100',
  差旅: 'bg-cyan-100',
  办公: 'bg-rose-100',
  采购: 'bg-emerald-100',
  其他: 'bg-slate-100',
};

const toErrorMessage = (error: unknown) => error instanceof Error ? error.message : '操作失败';

const formatMoney = (value: number) => `¥${value.toFixed(2)}`;
const REIMBURSEMENT_PAGE_SIZE = 4;

function formatDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getMonthRange(monthOffset = 0) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + monthOffset + 1, 0);
  return { start: formatDateInput(start), end: formatDateInput(end) };
}

function getCurrentQuarterRange() {
  const now = new Date();
  const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
  return {
    start: formatDateInput(new Date(now.getFullYear(), quarterStartMonth, 1)),
    end: formatDateInput(new Date(now.getFullYear(), quarterStartMonth + 3, 0)),
  };
}

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
    project: invoice.project,
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
    project: reimbursement.project,
    notifyEmails: reimbursement.notifyEmails ?? [],
    ccEmails: reimbursement.ccEmails ?? [],
    carbonCopy: [
      { name: '财务共享中心', department: '财务部' },
      ...(reimbursement.ccEmails ?? []).map((email) => ({ name: email, department: '邮件抄送' })),
    ],
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
},
{
  id: 'statistics',
  label: '统计分析',
  icon: BarChart3
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
  color: 'blue',
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
    window.alert(translate('已忽略 {count} 个不支持的文件，仅支持 PDF / PNG / JPG / JPEG / WebP', { count: rejected }));
  }
  if (accepted.length === 0) return [];
  if (accepted.length > MAX_UPLOAD_BATCH) {
    window.alert(translate('「{label}」一次最多上传 {max} 张，本次为 {count} 张，请分批上传', { label: translate(label), max: MAX_UPLOAD_BATCH, count: accepted.length }));
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
      translate('已识别并自动关联 {count} 张票据', { count: matches.auto_linked }) +
        (matches.manual_review > 0 ? translate('，另有 {count} 张待人工确认', { count: matches.manual_review }) : ''),
    );
  } else if (matches.manual_review > 0) {
    toast.info(translate('已上传 {uploaded} 个{label}，{review} 张匹配度不足，可人工确认或手动关联', { uploaded: uploadedCount, label: translate(label), review: matches.manual_review }));
  } else {
    toast.success(translate('已上传并识别 {count} 个{label}', { count: uploadedCount, label: translate(label) }));
  }
}

/** 报销邮件通知收件人/抄送的多选 chip 选择器，候选来自「邮箱管理」已启用邮箱。 */
function EmailChipSelector({
  options,
  selected,
  onToggle,
  emptyHint,
}: {
  options: MailboxItem[];
  selected: string[];
  onToggle: (email: string) => void;
  emptyHint: string;
}) {
  if (options.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-400">
        {emptyHint}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5">
      {options.map((mailbox) => {
        const active = selected.includes(mailbox.email);
        return (
          <button
            key={mailbox.id}
            type="button"
            onClick={() => onToggle(mailbox.email)}
            aria-pressed={active}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              active
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/30'
                : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-blue-50 hover:text-blue-700'
            }`}>
            {active ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
            <span className="max-w-[180px] truncate">{mailbox.email}</span>
          </button>
        );
      })}
    </div>
  );
}

function ExpenseMetricButton({
  Icon,
  label,
  value,
  note,
  tone = 'neutral',
  onClick,
}: {
  Icon: LucideIcon;
  label: string;
  value: ReactNode;
  note: string;
  tone?: 'brand' | 'success' | 'warning' | 'danger' | 'neutral';
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="hz-stat text-left hover:bg-[#f7f9ff]"
      data-tone={tone}
      onClick={onClick}
    >
      <span className="min-w-0">
        <span className="hz-stat-label block">{label}</span>
        <span className="hz-stat-value block tabular-nums">{value}</span>
        <span className="hz-stat-note block text-pretty">{note}</span>
      </span>
      <span className="hz-stat-icon" aria-hidden="true"><Icon className="size-4" /></span>
    </button>
  );
}

export function ExpenseModule() {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState('vouchers');
  const [selectedExpense, setSelectedExpense] = useState<string | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<string | null>(null);
  // 原始凭证影像预览（报销凭证 / 发票凭证）
  const [docPreview, setDocPreview] = useState<DocPreview | null>(null);
  const [aiMatching, setAiMatching] = useState(false);
  const [manualLinking, setManualLinking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expenseVouchers, setExpenseVouchers] = useState<ExpenseVoucherView[]>([]);
  const [invoiceVouchers, setInvoiceVouchers] = useState<InvoiceVoucherView[]>([]);
  const [approvals, setApprovals] = useState<ApprovalView[]>([]);
  const [selectedApproval, setSelectedApproval] = useState<ApprovalView | null>(null);
  const [approvalActionBusy, setApprovalActionBusy] = useState(false);
  const [draftDeleteConfirmOpen, setDraftDeleteConfirmOpen] = useState(false);
  const [dashboard, setDashboard] = useState<ExpenseDashboardData | null>(null);
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
  // 企业微信审批所需补充字段：项目/成本归属、申请人企微 UserID（applyevent 提单人）
  const [reimbursementProject, setReimbursementProject] = useState('');
  const [reimbursementCreatorUserid, setReimbursementCreatorUserid] = useState('');
  // 邮件通知：收件人/抄送，候选来自「邮箱管理」已启用邮箱
  const [reimbursementNotifyEmails, setReimbursementNotifyEmails] = useState<string[]>([]);
  const [reimbursementCcEmails, setReimbursementCcEmails] = useState<string[]>([]);
  const [mailboxOptions, setMailboxOptions] = useState<MailboxItem[]>([]);
  const [mailboxLoadError, setMailboxLoadError] = useState('');
  const [submittingReimbursement, setSubmittingReimbursement] = useState(false);
  const [reimbursementFormError, setReimbursementFormError] = useState('');
  const expenseUploadInputRef = useRef<HTMLInputElement | null>(null);
  const invoiceUploadInputRef = useRef<HTMLInputElement | null>(null);
  // 拖拽上传：当前被拖入的面板（用于高亮蒙层）；鼠标悬停的面板（用于粘贴路由）
  const [dragZone, setDragZone] = useState<'invoice' | 'voucher' | null>(null);
  const hoverZoneRef = useRef<'invoice' | 'voucher' | null>(null);
  const loadingRef = useRef(false);
  const [dateRange, setDateRange] = useState(() => getMonthRange());
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
  const [archiveExcludedIds, setArchiveExcludedIds] = useState<Set<string>>(() => new Set());
  const [archiveConfigError, setArchiveConfigError] = useState('');
  // 归档列表行操作目标
  const [moveItemTarget, setMoveItemTarget] = useState<ExpenseVoucherView | null>(null);
  const [deleteItemTarget, setDeleteItemTarget] = useState<ExpenseVoucherView | null>(null);
  // 凭证管理 Tab 的搜索与状态筛选（关键字 + 全部/已关联/待关联）
  const [voucherKeyword, setVoucherKeyword] = useState('');
  const [voucherStatusFilter, setVoucherStatusFilter] = useState<'all' | 'matched' | 'unmatched'>('all');

  // ── 部门作用域 ────────────────────────────────────────────────────────────
  const { user } = useAuth();
  const hasViewAll = Boolean(
    user?.permissions?.includes('*') || user?.permissions?.includes('expense:view-all'),
  );
  const canSubmitOnBehalf = Boolean(
    user?.permissions?.includes('*') || user?.permissions?.includes('expense:submit-on-behalf'),
  );
  const canManageArchive = Boolean(
    user?.permissions?.includes('*') || user?.permissions?.includes('expense:archive-manage'),
  );
  const ownDeptName = user?.department ?? null;
  const ownDeptCode = user?.departmentCode ?? null;
  // 普通用户无部门 → 后端不返回数据且禁止录入，前端给出明确提示。
  const blockedNoDept = !hasViewAll && !ownDeptCode;
  // view-all 的部门筛选：'all' | 'unassigned' | 具体 code
  const [departmentFilter, setDepartmentFilter] = useState<string>('all');
  const [departmentOptions, setDepartmentOptions] = useState<ExpenseDepartmentOption[]>([]);
  const [reassignTargetCode, setReassignTargetCode] = useState<string>('');
  const [reassigning, setReassigning] = useState(false);
  // 当前列表加载到的原始记录 id（供批量改派使用）
  const loadedIdsRef = useRef<{ invoices: string[]; vouchers: string[]; reimbursements: string[] }>({
    invoices: [],
    vouchers: [],
    reimbursements: [],
  });
  const [dataLoadError, setDataLoadError] = useState('');
  const [integrationRequirements, setIntegrationRequirements] = useState<ExpenseIntegrationRequirements | null>(null);
  const [integrationRequirementsError, setIntegrationRequirementsError] = useState('');
  // 传给接口的部门参数：仅 view-all 生效，'all' → 不传。
  const departmentParam = hasViewAll && departmentFilter !== 'all' ? departmentFilter : undefined;

  useEffect(() => {
    if (!hasViewAll) return;
    void (async () => {
      const opts = await expenseService.listDepartmentOptions();
      setDepartmentOptions(opts);
    })();
  }, [hasViewAll]);

  useEffect(() => {
    let cancelled = false;
    void expenseService.getIntegrationRequirements()
      .then((requirements) => {
        if (cancelled) return;
        setIntegrationRequirements(requirements);
        setIntegrationRequirementsError('');
      })
      .catch((error) => {
        if (cancelled) return;
        setIntegrationRequirements(null);
        setIntegrationRequirementsError(toErrorMessage(error));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void expenseService.getArchiveConfig()
      .then((config) => {
        if (cancelled) return;
        setArchiveTree(config.tree.length > 0 ? config.tree : ARCHIVE_TREE);
        setManualCategory(config.manual_category);
        setArchiveExcludedIds(new Set(config.excluded_ids));
        setArchiveConfigError('');
      })
      .catch((error) => {
        if (!cancelled) setArchiveConfigError(toErrorMessage(error));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const reloadExpenseData = useCallback(async () => {
    setLoading(true);
    try {
      const [invoices, vouchers, reimbursements, dashboardData] = await Promise.all([
        expenseService.listInvoicesStrict(undefined, departmentParam),
        expenseService.listVouchers(departmentParam),
        expenseService.listReimbursementsStrict(departmentParam),
        expenseService.getDashboardStrict(departmentParam),
      ]);
      loadedIdsRef.current = {
        invoices: invoices.map((i) => i.id),
        vouchers: vouchers.map((v) => v.id),
        reimbursements: reimbursements.map((r) => r.id),
      };
      setDataLoadError('');
      setDashboard(dashboardData);

      // 后端为唯一数据源：直接以接口结果覆盖（空数据 → 清空，不再回落到 mock 假数据）。
      const nextInvoiceVouchers = invoices.map(invoiceToInvoiceVoucher);
      setInvoiceVouchers(nextInvoiceVouchers);

      const projectedExpenseVouchers = invoices
        .filter((invoice) => isInvoiceMatched(invoice))
        .map(invoiceToExpenseVoucher);
      const uploadedExpenseVouchers = vouchers.map((voucher) => {
        const item = uploadedVoucherToExpenseVoucher(voucher);
        const invoice = nextInvoiceVouchers.find(
          (entry) => entry.id === voucher.matchedInvoiceId || entry.sourceInvoiceId === voucher.matchedInvoiceId,
        );
        return {
          ...item,
          category: invoice
            ? invoices.find((entry) => entry.id === invoice.sourceInvoiceId)?.category ?? item.category
            : item.category,
          sourceInvoiceId: invoice?.sourceInvoiceId,
          sourceInvoiceStatus: invoice?.status,
        };
      });
      const uploadedIds = new Set(uploadedExpenseVouchers.flatMap((item) => [item.id, item.sourceVoucherId].filter(Boolean)));
      const compatibilityProjections = projectedExpenseVouchers.filter(
        (item) => !uploadedIds.has(item.id) && !uploadedIds.has(item.sourceVoucherId),
      );
      const nextExpenseVouchers = mergeById(uploadedExpenseVouchers, compatibilityProjections);
      setExpenseVouchers(nextExpenseVouchers);

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
        nextApprovals.find((item) => item.id === current?.id) ?? nextApprovals[0] ?? null
      );
    } catch (error) {
      setDataLoadError(toErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [departmentParam]);

  useEffect(() => {
    void reloadExpenseData();
  }, [reloadExpenseData]);

  // 批量改派：把当前列表里的发票与报销单改派到目标部门（仅 view-all）。
  const handleReassignDepartment = useCallback(async () => {
    if (!hasViewAll || !reassignTargetCode) return;
    const { invoices, vouchers, reimbursements } = loadedIdsRef.current;
    if (invoices.length === 0 && vouchers.length === 0 && reimbursements.length === 0) {
      toast.info(t('当前没有可改派的记录'));
      return;
    }
    setReassigning(true);
    try {
      if (invoices.length > 0) {
        await expenseService.reassignDepartment({ type: 'invoice', ids: invoices, department_code: reassignTargetCode });
      }
      if (vouchers.length > 0) {
        await expenseService.reassignDepartment({ type: 'voucher', ids: vouchers, department_code: reassignTargetCode });
      }
      if (reimbursements.length > 0) {
        await expenseService.reassignDepartment({ type: 'reimbursement', ids: reimbursements, department_code: reassignTargetCode });
      }
      const target = departmentOptions.find((d) => d.code === reassignTargetCode);
      toast.success(t('已改派至「{name}」', { name: target?.name ?? reassignTargetCode }));
      setReassignTargetCode('');
      await reloadExpenseData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('改派失败，请稍后重试'));
    } finally {
      setReassigning(false);
    }
  }, [hasViewAll, reassignTargetCode, departmentOptions, reloadExpenseData]);

  // 拉取「邮箱管理」中已启用的邮箱，作为报销邮件通知的收件人/抄送候选。
  // 无权限或接口异常时静默降级为空列表（表单仍可手填）。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await integrationManagementApi.listMailboxes({ page: 1, pageSize: 200 });
        if (cancelled) return;
        setMailboxOptions(response.items.filter((item) => item.enabled));
        setMailboxLoadError('');
      } catch (error) {
        if (!cancelled) {
          setMailboxOptions([]);
          setMailboxLoadError(toErrorMessage(error));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 切换归档分类节点时清空已勾选项并回到第一页，避免跨分类误操作
  useEffect(() => {
    setArchiveSelectedIds(new Set());
    setArchivePage(1);
  }, [archiveSelected]);

  // 本月报销总额取后端按 issued_date 月度汇总（真实口径），不再用前端「已关联凭证求和」近似。
  const monthAmount = dashboard?.monthAmount ?? 0;
  const unmatched = expenseVouchers.filter((v) => !v.matched).length;
  const matched = expenseVouchers.filter((v) => v.matched).length;
  const totalInvoices = invoiceVouchers.length;
  const pendingApprovals = approvals.filter((a) => a.status === 'pending').length;
  const invalidDateRange = Boolean(dateRange.start && dateRange.end && dateRange.start > dateRange.end);
  const filteredInvoices = invoiceVouchers.filter((iv) => {
    if (invalidDateRange) return false;
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
      window.alert(t('上传报销凭证失败：{message}', { message: toErrorMessage(error) }));
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
      window.alert(t('上传发票凭证失败：{message}', { message: toErrorMessage(error) }));
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
        window.alert(t('请先把鼠标移到「报销凭证」或「发票凭证」区域，再粘贴文件'));
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
          t('AI 已自动关联 {count} 张票据', { count: result.auto_linked }) +
            (result.manual_review > 0 ? t('，另有 {count} 张待人工确认', { count: result.manual_review }) : ''),
        );
      } else if (result.manual_review > 0) {
        toast.info(t('暂无可自动关联的票据，{count} 张匹配度不足，请人工确认或手动关联', { count: result.manual_review }));
      } else {
        toast.info(t('未发现可自动关联的票据'));
      }
    } catch {
      const local = runLocalMatch();
      if (local > 0) toast.success(t('AI 服务暂不可用，已用本地规则临时关联 {count} 张', { count: local }));
      else toast.error(t('AI 匹配服务暂不可用，请稍后重试'));
    } finally {
      window.setTimeout(() => setAiMatching(false), 700);
    }
  }, [applyMatchLinks, reloadExpenseData, runLocalMatch]);

  // 手动关联：写入后端并落库。允许对未关联和已关联的凭证重新关联（后端会先释放旧对端再改绑）。
  const handleManualLink = useCallback(async () => {
    if (!selectedExpense || !selectedInvoice) {
      window.alert(t('请先在左右两侧各选择一条凭证'));
      return;
    }
    const voucher = expenseVouchers.find((item) => item.id === selectedExpense);
    const voucherId = voucher?.sourceVoucherId ?? voucher?.id;
    if (!voucherId || voucherId.startsWith('EV-')) {
      window.alert(t('该付款凭证暂无可关联的凭证记录，请重新上传后再试'));
      return;
    }
    setManualLinking(true);
    try {
      await expenseService.linkVoucher(selectedInvoice, voucherId);
      setSelectedExpense(null);
      setSelectedInvoice(null);
      await reloadExpenseData();
      toast.success(t('已手动关联'));
    } catch (error) {
      window.alert(t('手动关联失败：{message}', { message: toErrorMessage(error) }));
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
    setReimbursementTitle(t('{month} 月费用报销申请', { month: new Date().getMonth() + 1 }));
    setReimbursementApplicant(user?.name?.trim() || t('当前用户'));
    setReimbursementReason(targetItems[0]?.category ? t('{category}费用报销', { category: t(targetItems[0].category) }) : t('费用报销'));
    // 项目/成本归属：默认带出第一张关联发票的项目，可在表单中修改
    const firstInvoice = targetItems[0] ? findInvoiceForExpenseItem(targetItems[0], invoiceVouchers) : undefined;
    setReimbursementProject(firstInvoice?.project ?? '');
    setReimbursementCreatorUserid('');
    setReimbursementNotifyEmails([]);
    setReimbursementCcEmails([]);
    setReimbursementFormError('');
    setReimbursementDialogOpen(true);
  }, [expenseVouchers, invoiceVouchers, user?.name]);

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

  const handleConfirmCreateApproval = useCallback(async () => {
    setReimbursementFormError('');
    const targetItems = reimbursementDraftItems.filter((item) =>
      selectedReimbursementItemIds.has(item.id)
    );
    const invoiceIds = Array.from(new Set(targetItems.map((item) => item.matchedTo).filter(Boolean) as string[]));
    const voucherIds = Array.from(new Set(targetItems.map(getVoucherSubmitId).filter(Boolean)));
    if (!targetItems.length || !invoiceIds.length) {
      setReimbursementFormError(t('请先选择要报销的已关联发票'));
      return;
    }
    const materials = buildApprovalMaterialsFromItems(targetItems, invoiceVouchers);
    const title = reimbursementTitle.trim() || t('{month} 月费用报销申请', { month: new Date().getMonth() + 1 });
    const applicant = reimbursementApplicant.trim() || t('当前用户');
    const reason = reimbursementReason.trim() || t('费用报销');
    const project = reimbursementProject.trim();
    const creatorUserid = reimbursementCreatorUserid.trim();

    setSubmittingReimbursement(true);
    try {
      const reimbursement = await expenseService.createReimbursement({
        title,
        applicant,
        project: project || targetItems[0]?.category || t('费用报销'),
        reason,
        invoice_ids: invoiceIds,
        voucher_ids: voucherIds,
        wecom_creator_userid: creatorUserid || undefined,
        notify_emails: reimbursementNotifyEmails,
        cc_emails: reimbursementCcEmails,
      });
      let next = reimbursement;
      let wecomSubmitError = '';
      if (integrationRequirements?.wecom.ready) {
        try {
          next = await expenseService.submitWeComApproval(reimbursement.id);
        } catch (error) {
          wecomSubmitError = toErrorMessage(error);
        }
      } else {
        wecomSubmitError = integrationRequirements
          ? integrationRequirements.wecom.missing.map((item) => item.label).join('、')
          : t('企业微信配置状态尚未加载');
      }
      const approval = reimbursementToApproval(next, materials);
      setApprovals((current) => mergeById([approval, ...current], [approval]));
      setSelectedApproval(approval);
      setActiveTab('approval');
      setReimbursementDialogOpen(false);
      await reloadExpenseData();
      if (wecomSubmitError) {
        toast.warning(t('报销单已保存为草稿，企业微信提交未完成：{message}', { message: wecomSubmitError }));
      } else {
        toast.success(t('报销单已创建并提交企业微信审批'));
      }
    } catch (error) {
      const message = t('创建报销单失败：{message}', { message: toErrorMessage(error) });
      setReimbursementFormError(message);
      toast.error(message);
    } finally {
      setSubmittingReimbursement(false);
    }
  }, [integrationRequirements, invoiceVouchers, reimbursementApplicant, reimbursementCcEmails, reimbursementCreatorUserid, reimbursementDraftItems, reimbursementNotifyEmails, reimbursementProject, reimbursementReason, reimbursementTitle, reloadExpenseData, selectedReimbursementItemIds]);

  const handleSyncSelectedApproval = useCallback(async () => {
    if (!selectedApproval) return;
    setApprovalActionBusy(true);
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
      toast.error(t('同步审批状态失败：{message}', { message: toErrorMessage(error) }));
    } finally {
      setApprovalActionBusy(false);
    }
  }, [expenseVouchers, invoiceVouchers, selectedApproval]);

  const handleSubmitSelectedApproval = useCallback(async () => {
    if (!selectedApproval || selectedApproval.status !== 'draft') return;
    setApprovalActionBusy(true);
    try {
      const reimbursement = await expenseService.submitWeComApproval(selectedApproval.id);
      const approval = reimbursementToApproval(
        reimbursement,
        buildApprovalMaterialsFromIds(
          reimbursement.invoiceIds,
          reimbursement.voucherIds,
          expenseVouchers,
          invoiceVouchers,
        ),
      );
      setApprovals((current) => mergeById(current, [approval]));
      setSelectedApproval(approval);
      toast.success(t('报销草稿已提交企业微信审批'));
    } catch (error) {
      toast.error(t('提交企业微信审批失败：{message}', { message: toErrorMessage(error) }));
    } finally {
      setApprovalActionBusy(false);
    }
  }, [expenseVouchers, invoiceVouchers, selectedApproval]);

  const handleDeleteSelectedDraft = useCallback(async () => {
    if (!selectedApproval || selectedApproval.status !== 'draft') return;
    setApprovalActionBusy(true);
    try {
      await expenseService.deleteDraftReimbursement(selectedApproval.id);
      await reloadExpenseData();
      toast.success(t('报销草稿已删除，票据已释放'));
    } catch (error) {
      toast.error(t('删除报销草稿失败：{message}', { message: toErrorMessage(error) }));
    } finally {
      setApprovalActionBusy(false);
    }
  }, [reloadExpenseData, selectedApproval]);

  const persistArchiveConfig = useCallback(async (
    nextTree: TreeNode[],
    nextManualCategory: Record<string, string>,
    nextExcludedIds: Set<string>,
    successMessage?: string,
  ) => {
    if (!canManageArchive) {
      toast.error(t('你没有管理费用归档的权限'));
      return false;
    }
    try {
      const saved = await expenseService.saveArchiveConfig({
        tree: nextTree,
        manual_category: nextManualCategory,
        excluded_ids: Array.from(nextExcludedIds),
      });
      setArchiveTree(saved.tree);
      setManualCategory(saved.manual_category);
      setArchiveExcludedIds(new Set(saved.excluded_ids));
      setArchiveConfigError('');
      if (successMessage) toast.success(successMessage);
      return true;
    } catch (error) {
      const message = toErrorMessage(error);
      setArchiveConfigError(message);
      toast.error(t('归档配置保存失败：{message}', { message }));
      return false;
    }
  }, [canManageArchive]);

  const getItemsForNode = (nodeId: string) => {
    const matchedItems = expenseVouchers.filter((v) => v.matched && !archiveExcludedIds.has(v.id));
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
  const addCategoryNode = async (parentId: string | null, name: string, icon: string) => {
    const newNode: TreeNode = parentId ?
      { id: genCategoryId(), name, vendorFilter: [] } :
      { id: genCategoryId(), name, icon: icon || '📁', children: [] };
    const insert = (nodes: TreeNode[]): TreeNode[] =>
      nodes.map((n) =>
        n.id === parentId ?
          { ...n, children: [...(n.children ?? []), newNode] } :
          n.children ? { ...n, children: insert(n.children) } : n
      );
    const nextTree = parentId ? insert(archiveTree) : [...archiveTree, newNode];
    const saved = await persistArchiveConfig(
      nextTree,
      manualCategory,
      archiveExcludedIds,
      t('费用分类已保存'),
    );
    if (saved && parentId) {
      setArchiveExpanded((prev) => new Set(prev).add(parentId));
    }
  };
  const renameCategoryNode = async (nodeId: string, name: string, icon: string) => {
    const rename = (nodes: TreeNode[]): TreeNode[] =>
      nodes.map((n) =>
        n.id === nodeId ?
          { ...n, name, ...(n.icon !== undefined ? { icon: icon || n.icon } : {}) } :
          n.children ? { ...n, children: rename(n.children) } : n
      );
    await persistArchiveConfig(
      rename(archiveTree),
      manualCategory,
      archiveExcludedIds,
      t('费用分类已更新'),
    );
  };
  const removeCategoryNode = async (nodeId: string) => {
    const remove = (nodes: TreeNode[]): TreeNode[] =>
      nodes.filter((n) => n.id !== nodeId).map((n) =>
        n.children ? { ...n, children: remove(n.children) } : n
      );
    const nextManualCategory = Object.fromEntries(
      Object.entries(manualCategory).filter(([, targetNodeId]) => targetNodeId !== nodeId),
    );
    const saved = await persistArchiveConfig(
      remove(archiveTree),
      nextManualCategory,
      archiveExcludedIds,
      t('费用分类已删除'),
    );
    if (saved) setArchiveSelected((cur) => (cur === nodeId ? 'all' : cur));
  };
  const submitCategoryEditor = async () => {
    if (!categoryEditor) return;
    const name = categoryEditor.name.trim();
    if (!name) return;
    if (categoryEditor.mode === 'rename' && categoryEditor.nodeId) {
      await renameCategoryNode(categoryEditor.nodeId, name, categoryEditor.icon);
    } else if (categoryEditor.mode === 'add-child' && categoryEditor.parentId) {
      await addCategoryNode(categoryEditor.parentId, name, categoryEditor.icon);
    } else {
      await addCategoryNode(null, name, categoryEditor.icon);
    }
    setCategoryEditor(null);
  };
  // 将凭证移动到目标分类节点（覆盖 AI 自动分组），并同步顶级类目名用于展示
  const moveVoucherToNode = async (itemId: string, nodeId: string) => {
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
    const nextManualCategory = { ...manualCategory, [itemId]: nodeId };
    const nextExcludedIds = new Set(archiveExcludedIds);
    nextExcludedIds.delete(itemId);
    const saved = await persistArchiveConfig(
      archiveTree,
      nextManualCategory,
      nextExcludedIds,
      t('归档位置已保存'),
    );
    if (saved) {
      if (rootName) {
        setExpenseVouchers((prev) => prev.map((v) => (v.id === itemId ? { ...v, category: rootName } : v)));
      }
      setMoveItemTarget(null);
    }
  };
  // 财务原始凭证不可物理删除；此操作仅将其移出归档视图，原始发票/付款凭证仍保留。
  const deleteArchiveVoucher = async (itemId: string) => {
    const nextExcludedIds = new Set(archiveExcludedIds).add(itemId);
    const nextManualCategory = { ...manualCategory };
    delete nextManualCategory[itemId];
    const saved = await persistArchiveConfig(
      archiveTree,
      nextManualCategory,
      nextExcludedIds,
      t('凭证已移出归档，原始记录仍保留'),
    );
    if (saved) {
      setArchiveSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
      setDeleteItemTarget(null);
    }
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
    <div className="horizon-theme hz-page flex min-h-full w-full min-w-0 flex-col gap-3 overflow-x-hidden px-3 py-3 sm:px-4 lg:px-5 xl:h-full xl:min-h-0 xl:overflow-hidden">
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
      <HorizonPageHeader
        Icon={Wallet}
        eyebrow={t('财务运营 · EXPENSE HORIZON')}
        title={t('费用与报销工作台')}
        description={t('集中处理凭证导入、OCR 识别、AI 匹配、分类归档、审批与统计分析。')}
        meta={(
          <>
            <span>{ownDeptName ? t('当前部门：{name}', { name: ownDeptName }) : t('部门范围：按权限')}</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">{t('{count} 张凭证 · {approvalCount} 份审批单', { count: expenseVouchers.length, approvalCount: approvals.length })}</span>
          </>
        )}
        actions={(
          <>
            <Button type="button" variant="outline" onClick={runAiMatch} disabled={aiMatching || loading}>
              {aiMatching ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              {aiMatching ? t('匹配中') : t('运行 AI 匹配')}
            </Button>
            <Button type="button" className="hz-primary-action" onClick={() => openReimbursementDialog()} disabled={loading}>
              <Plus className="size-4" /> {t('新建报销单')}
            </Button>
          </>
        )}
      />
      <div className="flex min-w-0 flex-col gap-3 xl:min-h-0 xl:flex-1 xl:overflow-hidden">
        {/* 部门作用域条 */}
        <div className="shrink-0">
          {blockedNoDept ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2 text-xs text-amber-700">
              {t('你的账号尚未设置部门，暂无法查看或录入费用数据，请联系管理员分配部门。')}
            </div>
          ) : hasViewAll ? (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2">
              <label htmlFor="expense-department-filter" className="text-xs font-semibold text-slate-500">{t('部门')}</label>
              <select
                id="expense-department-filter"
                value={departmentFilter}
                onChange={(e) => setDepartmentFilter(e.target.value)}
                className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
              >
                <option value="all">{t('全部部门')}</option>
                <option value="unassigned">{t('未分配')}</option>
                {departmentOptions.map((d) => (
                  <option key={d.code} value={d.code}>{t(d.name.trim())}</option>
                ))}
              </select>
              <span className="ml-1 text-[11px] text-slate-400">{t('跨部门查看权 · 数据已按部门隔离')}</span>
              {/* 批量改派：把当前筛选下的发票/报销单归到目标部门 */}
              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                <label htmlFor="expense-reassign-department" className="sr-only">{t('改派目标部门')}</label>
                <select
                  id="expense-reassign-department"
                  value={reassignTargetCode}
                  onChange={(e) => setReassignTargetCode(e.target.value)}
                  className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                >
                  <option value="">{t('改派到…')}</option>
                  {departmentOptions.map((d) => (
                    <option key={d.code} value={d.code}>{t(d.name.trim())}</option>
                  ))}
                </select>
                <Button
                  type="button"
                  size="sm"
                  disabled={!reassignTargetCode || reassigning}
                  onClick={() => void handleReassignDepartment()}
                  className="h-8 bg-[#002fa7] text-xs hover:bg-[#002581]"
                >
                  {reassigning ? t('改派中…') : t('批量改派当前列表')}
                </Button>
              </div>
            </div>
          ) : ownDeptName ? (
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-500">
              <span className="font-semibold text-slate-600">{t('当前部门：')}<AutoTranslatedText text={ownDeptName} /></span>
              <span className="text-slate-400">{t('· 仅展示本部门费用数据')}</span>
            </div>
          ) : null}
          {dataLoadError ? (
            <div className="mt-2 flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs text-rose-700">
              <span>{t('费用数据加载失败：{message}', { message: dataLoadError })}</span>
              <button
                type="button"
                onClick={() => void reloadExpenseData()}
                className="shrink-0 rounded-md bg-white px-2 py-1 font-medium text-rose-700 ring-1 ring-rose-200 hover:bg-rose-100"
              >
                {t('重试')}
              </button>
            </div>
          ) : null}
          {integrationRequirementsError ? (
            <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2 text-xs text-amber-700">
              {t('第三方配置状态加载失败：{message}', { message: integrationRequirementsError })}
            </div>
          ) : integrationRequirements && (
            !integrationRequirements.storage.ready ||
            !integrationRequirements.tencent_ocr.ready ||
            !integrationRequirements.wecom.ready ||
            !integrationRequirements.email.ready
          ) ? (
            <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2 text-xs text-amber-800">
              {[
                !integrationRequirements.storage.ready
                  ? t('文件存储未就绪：上传已停用，以避免生成缺少原始附件的财务记录。')
                  : '',
                !integrationRequirements.tencent_ocr.ready
                  ? t('OCR 未就绪：{items}。上传文件会暂存为待识别。', {
                      items: integrationRequirements.tencent_ocr.missing.map((item) => item.label).join('、'),
                    })
                  : '',
                !integrationRequirements.wecom.ready
                  ? t('企业微信审批未就绪：{count} 项配置缺失，报销单只能保存为草稿。', {
                      count: integrationRequirements.wecom.missing.length,
                    })
                  : '',
                !integrationRequirements.email.ready
                  ? t('SMTP 未就绪：审批可继续，但邮件通知不会发送。')
                  : '',
              ].filter(Boolean).join(' ')}
            </div>
          ) : null}
          {archiveConfigError ? (
            <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2 text-xs text-amber-700">
              {t('归档配置加载失败，本次操作不会自动保存：{message}', { message: archiveConfigError })}
            </div>
          ) : null}
        </div>
        {/* Stats Strip */}
        <HorizonMetricGrid>
          <ExpenseMetricButton Icon={Wallet} label={t('本月报销总额')} value={`¥${monthAmount.toFixed(2)}`} note={t('查看全部报销凭证')} tone="brand" onClick={() => goToVouchers('all')} />
          <ExpenseMetricButton Icon={Link2} label={t('已关联凭证')} value={matched} note={t('进入已关联队列')} tone="success" onClick={() => goToVouchers('matched')} />
          <ExpenseMetricButton Icon={AlertCircle} label={t('待关联凭证')} value={unmatched} note={t('进入人工复核队列')} tone="warning" onClick={() => goToVouchers('unmatched')} />
          <ExpenseMetricButton Icon={Clock} label={t('审批中')} value={pendingApprovals} note={t('查看审批进度')} tone="brand" onClick={() => setActiveTab('approval')} />
        </HorizonMetricGrid>

        {/* Tabs Nav */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="min-w-0 gap-0">
        <div className="hz-surface hz-toolbar flex min-w-0 shrink-0 flex-col gap-3 px-3 py-3 xl:flex-row xl:items-center xl:justify-between">
          <TabsList className="flex h-auto max-w-full items-center justify-start gap-1 overflow-x-auto rounded-xl bg-slate-100/80 p-1">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              return (
                <TabsTrigger
                  key={tab.id}
                  value={tab.id}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg border-0 bg-transparent px-3.5 py-1.5 text-sm font-medium text-slate-500 shadow-none transition-colors focus-visible:ring-0 focus-visible:outline-none hover:text-slate-700 data-[state=active]:bg-white data-[state=active]:text-[#002fa7] data-[state=active]:shadow-sm">
                  <Icon className="w-4 h-4" />
                  {t(tab.label)}
                </TabsTrigger>);

            })}
          </TabsList>

          <div className="flex min-w-0 flex-wrap items-center gap-2 xl:ml-auto xl:justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={loading || integrationRequirements?.storage.ready === false}
                  title={integrationRequirements?.storage.ready === false ? t('请先完成 OSS 文件存储配置') : undefined}
                  className="h-8 border-slate-200 bg-white text-slate-600 hover:border-emerald-200 hover:bg-emerald-50/70 hover:text-emerald-700">
                  <Upload className="h-3.5 w-3.5" /> {t('上传')}
                  <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40 rounded-2xl p-2">
                <DropdownMenuItem
                  disabled={loading || integrationRequirements?.storage.ready === false}
                  onSelect={() => expenseUploadInputRef.current?.click()}
                  className="rounded-xl text-orange-700">
                  <Receipt className="h-4 w-4" /> {t('报销凭证')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={loading || integrationRequirements?.storage.ready === false}
                  onSelect={() => invoiceUploadInputRef.current?.click()}
                  className="rounded-xl text-blue-700">
                  <FileText className="h-4 w-4" /> {t('发票凭证')}
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
              {aiMatching ? t('匹配中') : t('AI 匹配')}
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
                {manualLinking ? t('关联中') : t('手动关联')}
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
                    {archiveSelectedIds.size ? `${t('已选')} ${archiveSelectedIds.size}` : t('本组操作')}
                    <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48 rounded-2xl p-2">
                  <DropdownMenuItem
                  onSelect={exportArchiveItems}
                  disabled={archiveOperationItems.length === 0}
                  className="rounded-xl">
                    <Download className="h-4 w-4" /> {archiveSelectedIds.size ? `${t('导出所选')} (${archiveOperationItems.length})` : t('导出当前分类')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                  onSelect={() => openReimbursementDialog(archiveOperationItems)}
                  disabled={archiveOperationItems.length === 0}
                  className="rounded-xl text-emerald-700">
                    <Send className="h-4 w-4" /> {archiveSelectedIds.size ? `${t('提交所选')} (${archiveOperationItems.length})` : t('提交本组审批')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            }
            {activeTab === 'approval' &&
              selectedApproval?.status === 'draft' ?
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setDraftDeleteConfirmOpen(true)}
                  disabled={approvalActionBusy}
                  className="h-8 border-rose-200 bg-white text-rose-600 hover:bg-rose-50 hover:text-rose-700">
                  <Trash2 className="h-3.5 w-3.5" /> {t('删除草稿')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void handleSubmitSelectedApproval()}
                  disabled={approvalActionBusy || !integrationRequirements?.wecom.ready}
                  title={!integrationRequirements?.wecom.ready ? t('请先完成企业微信审批配置') : undefined}
                  className="h-8 border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50 disabled:text-slate-400">
                  {approvalActionBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  {t('提交企业微信')}
                </Button>
              </> :
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleSyncSelectedApproval()}
                disabled={!selectedApproval || approvalActionBusy}
                className="h-8 border-slate-200 bg-white text-slate-600 hover:border-emerald-200 hover:bg-emerald-50/70 hover:text-emerald-700">
                  {approvalActionBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageCircle className="h-3.5 w-3.5" />}
                  {t('同步状态')}
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
                    {t('导出')}
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
              className="h-8 bg-[#002fa7] text-white hover:bg-[#002581]">
              <Plus className="h-3.5 w-3.5" /> {t('新建报销单')}
            </Button>
          </div>
        </div>
        </Tabs>

        {/* Tab Content */}
        <div className="h-[48rem] min-w-0 flex-none overflow-hidden xl:h-auto xl:min-h-0 xl:flex-1">
          {/* TAB: STATISTICS（统计分析，数据来自后端 /api/expenses/dashboard 实时汇总） */}
          {activeTab === 'statistics' &&
          <div className="h-full">
              <ExpenseStatistics dashboard={dashboard} loading={loading} />
            </div>
          }
          {/* TAB 1: VOUCHERS */}
          {activeTab === 'vouchers' &&
          <div className="flex h-full min-w-0 flex-col">
              {/* Toolbar */}
              <div className="hz-toolbar flex shrink-0 flex-col gap-3 rounded-2xl px-3 py-2.5 sm:flex-row sm:items-center">
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                  {[
                    { id: 'all' as const, label: t('全部'), count: expenseVouchers.length, active: 'bg-slate-200 text-slate-700 ring-1 ring-slate-300', idle: 'bg-slate-100 text-slate-600 hover:bg-slate-200/70' },
                    { id: 'matched' as const, label: t('已关联'), count: matched, active: 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-300', idle: 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100/70' },
                    { id: 'unmatched' as const, label: t('待关联'), count: unmatched, active: 'bg-amber-100 text-amber-700 ring-1 ring-amber-300', idle: 'bg-amber-50 text-amber-700 hover:bg-amber-100/70' },
                  ].map((chip) => (
                    <button
                      key={chip.id}
                      type="button"
                      onClick={() => setVoucherStatusFilter(chip.id)}
                      aria-pressed={voucherStatusFilter === chip.id}
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${voucherStatusFilter === chip.id ? chip.active : chip.idle}`}>
                      {chip.label} {chip.count}
                    </button>
                  ))}
                </div>
                <div className="flex min-w-0 items-center gap-2 sm:ml-auto">
                  <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
                    <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                    <input
                    type="text"
                    aria-label={t('搜索凭证、发票或供应商')}
                    value={voucherKeyword}
                    onChange={(e) => setVoucherKeyword(e.target.value)}
                    placeholder={t('搜索凭证 / 发票 / 供应商')}
                    className="w-full pl-10 pr-8 py-1 bg-slate-100 border-none rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
                    {voucherKeyword &&
                    <button
                      type="button"
                      aria-label={t('清空凭证搜索')}
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
                        aria-label={t('筛选凭证')}
                        className={`hover:bg-slate-100 ${voucherFilterActive ? 'bg-blue-50 text-blue-600' : 'text-slate-500'}`}>
                        <Filter className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40 rounded-2xl p-2">
                      {[
                        { id: 'all' as const, label: t('全部凭证') },
                        { id: 'matched' as const, label: t('仅已关联') },
                        { id: 'unmatched' as const, label: t('仅待关联') },
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
                        <X className="h-4 w-4" /> {t('清空筛选')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              {/* Two-column matching area */}
              <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-1 pt-3 xl:grid-cols-[minmax(0,1fr)_64px_minmax(0,1fr)] xl:overflow-hidden">
                {/* LEFT: Expense vouchers */}
                <div
                  {...makeZoneDropProps('voucher')}
                  className="hz-surface relative flex min-h-[320px] min-w-0 flex-col overflow-hidden xl:min-h-0">
                  {dragZone === 'voucher' && (
                    <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-orange-400 bg-orange-50/95">
                      <Upload className="h-8 w-8 text-orange-500" />
                      <p className="text-sm font-medium text-orange-700">{t('松开鼠标上传报销凭证')}</p>
                      <p className="text-xs text-orange-500/80">{t('单次最多 {count} 张 · PDF/PNG/JPG/WebP', { count: MAX_UPLOAD_BATCH })}</p>
                    </div>
                  )}
                  <HorizonSectionHeader
                    Icon={Receipt}
                    title={t('报销凭证')}
                    description={t('上传消费凭据，核对 OCR 结果并选择待关联记录。')}
                    trailing={<div className="text-xs text-slate-500 tabular-nums">
                      {t('已匹配')}{' '}
                      <span className="text-emerald-600 font-medium">
                        {matched}
                      </span>{' '}
                      / {t('待匹配')}{' '}
                      <span className="text-amber-600 font-medium">
                        {unmatched}
                      </span>
                      <span className="ml-1 text-slate-400">({voucherFilterActive ? `${filteredExpenseVouchers.length}/${expenseVouchers.length}` : expenseVouchers.length})</span>
                    </div>}
                  />
                  <div className="flex-1 overflow-y-auto p-3 space-y-2">
                    {filteredExpenseVouchers.length === 0 ?
                    <div className="flex h-full flex-col items-center justify-center py-10 text-center text-slate-400">
                      <Receipt className="mb-2 h-9 w-9 text-slate-300" />
                      <p className="text-sm">{voucherFilterActive ? t('没有符合条件的报销凭证') : t('暂无报销凭证')}</p>
                      {voucherFilterActive &&
                      <button
                        type="button"
                        onClick={() => { setVoucherStatusFilter('all'); setVoucherKeyword(''); }}
                        className="mt-2 text-xs text-blue-600 hover:underline">
                        {t('清空筛选条件')}
                      </button>
                      }
                    </div> :
                    filteredExpenseVouchers.map((v) => {
                    const isSelected = selectedExpense === v.id;
                    return (
                      <div
                        key={v.id}
                        role="button"
                        tabIndex={0}
                        aria-pressed={isSelected}
                        onClick={() =>
                        setSelectedExpense(isSelected ? null : v.id)
                        }
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setSelectedExpense(isSelected ? null : v.id);
                          }
                        }}
                        className={`flex cursor-pointer items-center gap-3 rounded-2xl border-2 p-3 transition-colors ${isSelected ? 'border-blue-400 bg-blue-50/50 shadow-sm' : v.matched ? 'border-transparent bg-emerald-50/40 hover:bg-emerald-50/70' : 'border-transparent bg-slate-50 hover:bg-slate-100/60'}`}>
                        
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
                            <div className="text-sm font-bold text-slate-800 tabular-nums">
                              ¥{v.amount.toFixed(2)}
                            </div>
                            {v.matched ?
                          <div className="text-[10px] text-emerald-600 flex items-center gap-0.5 mt-0.5">
                                <CheckCircle className="w-3 h-3" /> {t('已关联')}
                              </div> :

                          <div className="text-[10px] text-amber-600 flex items-center gap-0.5 mt-0.5">
                                <AlertCircle className="w-3 h-3" /> {t('待关联')}
                              </div>
                          }
                          </div>
                          <button
                          type="button"
                          title={t('查看原始凭证')}
                          aria-label={t('查看原始凭证')}
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
                <div className="flex h-14 w-full shrink-0 items-center justify-center gap-2 xl:h-auto xl:w-16 xl:flex-col">
                  <div
                  className={`flex size-12 items-center justify-center rounded-full transition-colors ${aiMatching ? 'bg-[#002fa7] shadow-sm' : 'border-2 border-slate-200 bg-white'}`}>
                  
                    {aiMatching ?
                  <Sparkles className="w-5 h-5 text-white animate-pulse" /> :

                  <Link2 className="w-5 h-5 text-slate-400" />
                  }
                  </div>
                  <div className="text-center text-[10px] leading-tight text-slate-400 xl:mt-2">
                    {aiMatching ? t('AI 匹配中') : t('智能关联')}
                  </div>
                </div>

                {/* RIGHT: Invoice vouchers */}
                <div
                  {...makeZoneDropProps('invoice')}
                  className="hz-surface relative flex min-h-[320px] min-w-0 flex-col overflow-hidden xl:min-h-0">
                  {dragZone === 'invoice' && (
                    <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-blue-400 bg-blue-50/95">
                      <Upload className="h-8 w-8 text-blue-500" />
                      <p className="text-sm font-medium text-blue-700">{t('松开鼠标上传发票凭证')}</p>
                      <p className="text-xs text-blue-500/80">{t('单次最多 {count} 张 · PDF/PNG/JPG/WebP', { count: MAX_UPLOAD_BATCH })}</p>
                    </div>
                  )}
                  <HorizonSectionHeader
                    Icon={FileText}
                    title={t('发票凭证')}
                    description={t('核对发票识别结果并完成自动或人工关联。')}
                    trailing={<span className="text-xs text-slate-500 tabular-nums">{t('已导入 {count}', { count: totalInvoices })} · {voucherFilterActive ? `${filteredVoucherInvoices.length}/${totalInvoices}` : totalInvoices}</span>}
                  />
                  <div className="flex-1 overflow-y-auto p-3 space-y-2">
                    {filteredVoucherInvoices.length === 0 ?
                    <div className="flex h-full flex-col items-center justify-center py-10 text-center text-slate-400">
                      <FileText className="mb-2 h-9 w-9 text-slate-300" />
                      <p className="text-sm">{voucherFilterActive ? t('没有符合条件的发票凭证') : t('暂无发票凭证')}</p>
                      {voucherFilterActive &&
                      <button
                        type="button"
                        onClick={() => { setVoucherStatusFilter('all'); setVoucherKeyword(''); }}
                        className="mt-2 text-xs text-blue-600 hover:underline">
                        {t('清空筛选条件')}
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
                        role="button"
                        tabIndex={0}
                        aria-pressed={isInvoiceSelected}
                        onClick={() => setSelectedInvoice(isInvoiceSelected ? null : iv.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setSelectedInvoice(isInvoiceSelected ? null : iv.id);
                          }
                        }}
                        className={`flex cursor-pointer items-center gap-3 rounded-2xl border-2 p-3 transition-colors ${highlightedAsMatch || isInvoiceSelected ? 'border-blue-400 bg-blue-50/50 shadow-sm' : iv.matched ? 'border-transparent bg-emerald-50/40' : 'border-transparent bg-slate-50 hover:bg-slate-100/60'}`}>
                        
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
                              {t(iv.type)} {t('· 税额 ¥{amount}', { amount: iv.taxAmount.toFixed(2) })}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-sm font-bold text-slate-800 tabular-nums">
                              ¥{iv.amount.toFixed(2)}
                            </div>
                            {iv.matched && associatedExpense ?
                          <div className="text-[10px] text-emerald-600 flex items-center gap-0.5 mt-0.5">
                                <Link2 className="w-3 h-3" />{' '}
                                {associatedExpense.id}
                              </div> :

                          <div className="text-[10px] text-amber-600 flex items-center gap-0.5 mt-0.5">
                                <AlertCircle className="w-3 h-3" /> {t('待匹配')}
                              </div>
                          }
                          </div>
                          <button
                          type="button"
                          title={t('查看原始凭证')}
                          aria-label={t('查看原始凭证')}
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
                    role="button"
                    tabIndex={0}
                    aria-current={isSelected ? 'page' : undefined}
                    onClick={() => setArchiveSelected(node.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setArchiveSelected(node.id);
                      }
                    }}
                    className={`group flex cursor-pointer items-center gap-1.5 rounded-xl py-1.5 pr-2 transition-colors ${isSelected ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-100/60'}`}
                    style={{
                      paddingLeft: `${depth * 16 + 8}px`
                    }}>
                    
                      {hasChildren ?
                    <button
                      type="button"
                      aria-label={t(isExpanded ? '收起分类' : '展开分类')}
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
                      
                        {t(node.name)}
                      </span>
                      {nodeItems.length > 0 &&
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${isSelected ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>

                          {nodeItems.length}
                        </span>
                    }
                      {/* 行内增删改（hover 显示）；有数据的分类锁定 */}
                      {canManageArchive &&
                        <div
                        className="hidden group-hover:flex items-center gap-0.5 shrink-0"
                        onClick={(e) => e.stopPropagation()}>
                          {depth === 0 &&
                        <button
                          type="button"
                          title={t('添加子类')}
                          aria-label={t('添加子类')}
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
                          title={t('该分类下已有归档数据，不可修改 / 删除')}
                          className="w-5 h-5 flex items-center justify-center text-slate-300">
                            <Lock className="w-3 h-3" />
                          </span> :

                        <>
                            <button
                            type="button"
                            title={t('重命名')}
                            aria-label={t('重命名')}
                            onClick={(e) => {
                              e.stopPropagation();
                              setCategoryEditor({ mode: 'rename', nodeId: node.id, name: node.name, icon: node.icon ?? '', withIcon: depth === 0 });
                            }}
                            className="w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:text-blue-600 hover:bg-blue-100/60">
                              <Pencil className="w-3 h-3" />
                            </button>
                            <button
                            type="button"
                            title={t('删除')}
                            aria-label={t('删除分类')}
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
              <div className="grid h-full min-h-0 min-w-0 grid-cols-1 gap-3 overflow-y-auto p-1 pt-3 xl:grid-cols-[232px_minmax(0,1fr)] xl:overflow-hidden">
                  {/* LEFT: Tree Sidebar */}
                  <div className="hz-surface flex min-h-[300px] min-w-0 flex-col overflow-hidden xl:min-h-0">
                    <div className="px-4 py-3 border-b border-slate-100 shrink-0">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="flex items-center gap-2 text-balance text-sm font-semibold text-slate-800">
                          <Archive className="w-4 h-4 text-blue-500" /> {t('分类导航')}
                        </h3>
                        {canManageArchive &&
                          <button
                            type="button"
                            title={t('新增费用类别')}
                            aria-label={t('新增费用类别')}
                            onClick={() => setCategoryEditor({ mode: 'add-root', name: '', icon: '📁', withIcon: true })}
                            className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors">
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        }
                      </div>
                      <div className="relative">
                        <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                        type="text"
                        aria-label={t('搜索归档分类')}
                        value={archiveKeyword}
                        onChange={(e) => setArchiveKeyword(e.target.value)}
                        placeholder={t('搜索分类')}
                        className="w-full pl-8 pr-7 py-1.5 bg-slate-50 border-none rounded-full text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
                        {archiveKeyword &&
                        <button
                          type="button"
                          aria-label={t('清空分类搜索')}
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
                      role="button"
                      tabIndex={0}
                      aria-current={archiveSelected === 'all' ? 'page' : undefined}
                      onClick={() => setArchiveSelected('all')}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setArchiveSelected('all');
                        }
                      }}
                      className={`flex cursor-pointer items-center gap-2 rounded-xl px-2 py-2 transition-colors ${archiveSelected === 'all' ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-100/60'}`}>
                      
                        <FolderOpen
                        className={`w-4 h-4 shrink-0 ${archiveSelected === 'all' ? 'text-blue-600' : 'text-slate-400'}`} />
                      
                        <span
                        className={`text-sm flex-1 ${archiveSelected === 'all' ? 'font-medium' : ''}`}>
                        
                          {t('全部归档')}
                        </span>
                        <span
                        className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${archiveSelected === 'all' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
                        
                          {
                        expenseVouchers.filter((v) => v.matched && !archiveExcludedIds.has(v.id)).
                        length
                        }
                        </span>
                      </div>

                      <div className="px-2 pt-3 pb-1 flex items-center justify-between">
                        <span className="text-[10px] font-medium uppercase text-slate-400">
                          {t('费用类别')}
                        </span>
                        <span
                        className="inline-flex items-center gap-0.5 text-[9px] text-[#002fa7]"
                        title={t('发票首次导入时由 AI 自动分组生成；已有归档数据的分类不可修改 / 删除')}>
                          <Sparkles className="w-2.5 h-2.5" /> {t('AI 自动分组')}
                        </span>
                      </div>
                      {visibleTree.length ?
                      visibleTree.map((node) => renderTreeNode(node, 0)) :
                      <div className="px-2 py-4 text-center text-xs text-slate-400">{t('未找到匹配的分类')}</div>
                      }
                    </div>

                    <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50/50 shrink-0">
                      <div className="text-[10px] text-slate-500 mb-1">
                        {t('本月已归档')}
                      </div>
                      <div className="flex items-baseline justify-between">
                        <div className="text-lg font-bold text-slate-800 tabular-nums">
                          ¥
                          {expenseVouchers.filter((v) => v.matched && !archiveExcludedIds.has(v.id)).
                        reduce((s, v) => s + v.amount, 0).
                        toFixed(2)}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {
                        expenseVouchers.filter((v) => v.matched && !archiveExcludedIds.has(v.id)).
                        length
                        }{' '}
                          {t('项')}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* RIGHT: Detail Panel */}
                  <div className="hz-surface flex min-h-[420px] min-w-0 flex-col overflow-hidden xl:min-h-0">
                    {/* Header with breadcrumb */}
                    <div className="px-5 py-3 border-b border-slate-100 shrink-0">
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1">
                            <button
                            type="button"
                            className="cursor-pointer hover:text-blue-600"
                            onClick={() => setArchiveSelected('all')}>
                            
                              {t('全部归档')}
                            </button>
                            {breadcrumb.map((b, idx) =>
                          <Fragment key={b.id}>
                                <ChevronRight className="w-3 h-3" />
                                <button
                              type="button"
                              aria-current={idx === breadcrumb.length - 1 ? 'page' : undefined}
                              className={`${idx === breadcrumb.length - 1 ? 'font-medium text-slate-700' : 'cursor-pointer hover:text-blue-600'}`}
                              onClick={() => setArchiveSelected(b.id)}>
                              
                                  {t(b.name)}
                                </button>
                              </Fragment>
                          )}
                          </div>
                          <h3 className="flex items-center gap-2 text-balance text-lg font-semibold text-slate-800">
                            {currentNode?.icon &&
                          <span className="text-xl">
                                {currentNode.icon}
                              </span>
                          }
                            {archiveSelected === 'all' ?
                          t('全部归档凭证') :
                          (currentNode ? t(currentNode.name) : '')}
                          </h3>
                        </div>
                        <div className="flex items-center gap-2 text-xs font-medium text-slate-400">
                          {archiveSelectedIds.size > 0 &&
                          <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-blue-600">
                            {t('已选')} {archiveSelectedIds.size}
                            <button
                              type="button"
                              aria-label={t('清除归档选择')}
                              onClick={() => setArchiveSelectedIds(new Set())}
                              className="text-blue-400 hover:text-blue-700">
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                          }
                          <span>{currentItems.length} {t('项')}</span>
                        </div>
                      </div>
                    </div>

                    {/* Mini stats */}
                    <div className="grid shrink-0 grid-cols-2 gap-2 border-b border-slate-100 bg-slate-50/30 px-3 py-3 sm:grid-cols-4 sm:px-5">
                      <div className="flex-1 bg-white rounded-2xl px-4 py-2.5 border border-slate-100">
                        <div className="text-[10px] text-slate-500 mb-0.5">
                          {t('凭证数量')}
                        </div>
                        <div className="text-lg font-bold text-slate-800 tabular-nums">
                          {currentItems.length}
                        </div>
                      </div>
                      <div className="flex-1 bg-white rounded-2xl px-4 py-2.5 border border-slate-100">
                        <div className="text-[10px] text-slate-500 mb-0.5">
                          {t('合计金额')}
                        </div>
                        <div className="text-lg font-bold text-slate-800 tabular-nums">
                          ¥{currentTotal.toFixed(2)}
                        </div>
                      </div>
                      <div className="flex-1 bg-white rounded-2xl px-4 py-2.5 border border-slate-100">
                        <div className="text-[10px] text-slate-500 mb-0.5">
                          {t('可抵扣税额')}
                        </div>
                        <div className="text-lg font-bold text-emerald-600 tabular-nums">
                          ¥{currentTaxTotal.toFixed(2)}
                        </div>
                      </div>
                      <div className="flex-1 bg-white rounded-2xl px-4 py-2.5 border border-slate-100">
                        <div className="text-[10px] text-slate-500 mb-0.5">
                          {t('关联订单')}
                        </div>
                        <div className="text-lg font-bold text-blue-600 tabular-nums">
                          {currentItems.filter((v) => v.matched).length}
                        </div>
                      </div>
                    </div>

                    {/* Items table */}
                    <div className="flex-1 overflow-auto">
                      {currentItems.length === 0 ?
                    <div className="flex h-full flex-col items-center justify-center p-6 text-center text-slate-400">
                          <Archive className="w-12 h-12 mb-3 text-slate-300" />
                          <p className="text-balance text-sm font-semibold text-slate-700">{t('该分类下暂无归档凭证')}</p>
                          <p className="mt-1 text-pretty text-xs">
                            {t('在「凭证管理」中关联后将自动归档至此')}
                          </p>
                          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => setActiveTab('vouchers')}>
                            {t('前往凭证管理')}
                          </Button>
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
                              aria-label={t('全选当前分类')}
                              onCheckedChange={toggleArchiveSelectAll}
                              className="h-4 w-4 rounded border-slate-300 data-[state=checked]:border-blue-500 data-[state=checked]:bg-blue-500 data-[state=indeterminate]:border-blue-500 data-[state=indeterminate]:bg-blue-500" />
                              </th>
                              <th className="px-3 py-2.5 text-left font-medium">
                                {t('报销凭证')}
                              </th>
                              <th className="px-3 py-2.5 text-left font-medium">
                                {t('关联发票')}
                              </th>
                              <th className="px-3 py-2.5 text-right font-medium">
                                {t('金额')}
                              </th>
                              <th className="px-3 py-2.5 text-center font-medium">
                                {t('状态')}
                              </th>
                              <th className="px-3 py-2.5 text-center font-medium">
                                {t('操作')}
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
                                    <div className="font-medium text-slate-800 tabular-nums">¥{v.amount.toFixed(2)}</div>
                                    <div className="mt-0.5 text-[10px] text-slate-400">
                                      {t('税')} ¥{iv?.taxAmount.toFixed(2) || '0.00'}
                                    </div>
                                  </td>
                                  <td className="px-3 py-3 text-center">
                                    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                                      <Check className="w-3 h-3" /> {t('已归档')}
                                    </span>
                                  </td>
                                  <td className="px-3 py-3">
                                    <div className="flex items-center justify-center gap-1">
                                      <button
                                    type="button"
                                    title={t('查看原始凭证')}
                                    aria-label={t('查看原始凭证')}
                                    onClick={() => setDocPreview({ kind: 'voucher', data: v })}
                                    className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-blue-50 hover:text-blue-600">
                                        <Eye className="h-3.5 w-3.5" />
                                      </button>
                                      {canManageArchive &&
                                        <>
                                          <button
                                        type="button"
                                        title={t('移动到其他类目')}
                                        aria-label={t('移动到其他类目')}
                                        onClick={() => setMoveItemTarget(v)}
                                        className="flex size-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-blue-50 hover:text-[#002fa7]">
                                            <FolderOpen className="h-3.5 w-3.5" />
                                          </button>
                                          <button
                                        type="button"
                                        title={t('移出归档')}
                                        aria-label={t('移出归档')}
                                        onClick={() => setDeleteItemTarget(v)}
                                        className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600">
                                            <Trash2 className="h-3.5 w-3.5" />
                                          </button>
                                        </>
                                      }
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
                          {t('共')} {currentItems.length} {t('项')} · {t('每页')} {ARCHIVE_PAGE_SIZE} {t('条')}
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                        type="button"
                        aria-label={t('上一页')}
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
                        aria-label={t('下一页')}
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
          <div className="grid h-full min-h-0 min-w-0 grid-cols-1 gap-3 overflow-y-auto p-1 pt-3 xl:grid-cols-[360px_minmax(0,1fr)] xl:overflow-hidden">
              {/* LEFT: Approval list */}
              <div className="hz-surface flex min-h-[300px] min-w-0 flex-col overflow-hidden xl:min-h-0">
                <HorizonSectionHeader Icon={ClipboardCheck} title={t('报销申请单')} description={t('查看草稿、企业微信审批与回调状态。')} trailing={<span className="text-xs text-slate-500 tabular-nums">{approvals.length} {t('单')}</span>} />
                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                  {approvals.map((a) => {
                  const isSelected = selectedApproval?.id === a.id;
                  const statusStyle =
                  a.status === 'approved' ?
                  'bg-emerald-50 text-emerald-700' :
                  a.status === 'rejected' ?
                  'bg-rose-50 text-rose-700' :
                  a.status === 'draft' ?
                  'bg-slate-100 text-slate-600' :
                  'bg-amber-50 text-amber-700';
                  const statusLabel =
                  a.status === 'approved' ?
                  t('已通过') :
                  a.status === 'rejected' ?
                  t('已驳回') :
                  a.status === 'draft' ?
                  t('草稿') :
                  t('审批中');
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
                      role="button"
                      tabIndex={0}
                      aria-pressed={isSelected}
                      onClick={() => setSelectedApproval(a)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setSelectedApproval(a);
                        }
                      }}
                      className={`cursor-pointer rounded-2xl p-4 transition-colors ${isSelected ? 'bg-blue-50 ring-2 ring-blue-200' : 'bg-slate-50 hover:bg-slate-100/60'}`}>
                      
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex-1 min-w-0">
                            <h4 className="truncate text-balance text-sm font-semibold text-slate-800">
                              <AutoTranslatedText text={a.title} />
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
                            {a.applicant} · {t(a.department)}
                          </div>
                          <div className="text-base font-bold text-slate-800 tabular-nums">
                            ¥{a.amount.toFixed(2)}
                          </div>
                        </div>
                        {a.status === 'pending' &&
                      <div className="mt-3">
                            <div className="h-1 bg-slate-200 rounded-full overflow-hidden">
                              <div
                            className="h-full rounded-full bg-[#002fa7]"
                            style={{
                              width: `${a.currentStep / a.totalSteps * 100}%`
                            }} />
                          
                            </div>
                            <p className="text-[10px] text-slate-500 mt-1">
                              {t('进度')} {a.currentStep}/{a.totalSteps} · {t('当前节点')}{' '}
                              {t(a.flow[a.currentStep - 1]?.role ?? '')}
                            </p>
                          </div>
                      }
                      </div>);

                })}
                  {approvals.length === 0 &&
                    <div className="flex h-full min-h-64 flex-col items-center justify-center px-6 text-center text-slate-400">
                      <ClipboardCheck className="mb-3 h-11 w-11 text-slate-300" />
                      <p className="text-balance text-sm font-medium text-slate-600">{t('暂无报销申请')}</p>
                      <p className="mt-1 text-pretty text-xs">{t('关联发票与凭证后即可创建报销单')}</p>
                      <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => setActiveTab('vouchers')}>{t('前往凭证管理')}</Button>
                    </div>
                  }
                </div>
              </div>

              {/* RIGHT: Approval detail */}
              {selectedApproval ? (() => {
              const meta = deriveWeComMeta(selectedApproval);
              const statusLabel =
              selectedApproval.status === 'approved' ? t('已通过') :
              selectedApproval.status === 'rejected' ? t('已驳回') :
              selectedApproval.status === 'draft' ? t('草稿') : t('审批中');
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
            <div className="hz-surface flex min-h-[440px] min-w-0 flex-col overflow-hidden xl:min-h-0">
                  <div className="px-6 py-4 border-b border-slate-100 flex items-start justify-between gap-3 shrink-0">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate text-balance text-base font-semibold text-slate-800">
                          <AutoTranslatedText text={selectedApproval.title} />
                        </h3>
                        <span className="shrink-0 rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-600">
                          {t(meta.template)}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1 font-mono">
                        {selectedApproval.id} · {t('提交于')} {selectedApproval.submitDate}
                      </p>
                    </div>
                    <span className={`shrink-0 inline-flex items-center rounded-full px-3 py-1.5 text-xs font-medium ${statusBadgeStyle}`}>
                      {statusLabel}
                    </span>
                  </div>

                  <div className="flex-1 overflow-y-auto p-6 space-y-5">
                    {/* 企业微信审批信息 */}
                    <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-4">
                      <div className="flex items-center justify-between mb-3.5">
                        <div className="flex items-center gap-2">
                          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600">
                            <MessageCircle className="h-3.5 w-3.5" />
                          </span>
                          <span className="text-sm font-semibold text-slate-700">{t('企业微信审批')}</span>
                        </div>
                        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${syncBadgeStyle}`}>
                          <span className="h-1.5 w-1.5 rounded-full bg-current" />
                          {t(meta.syncStatus)}
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-x-6 gap-y-3 text-xs sm:grid-cols-2">
                        <div>
                          <p className="text-slate-400 mb-0.5 flex items-center gap-1"><Hash className="h-3 w-3" />{t('审批单号 SpNo')}</p>
                          <p className="font-mono font-medium text-slate-700 truncate">{meta.spNo}</p>
                        </div>
                        <div>
                          <p className="text-slate-400 mb-0.5">{t('审批模板')}</p>
                          <p className="font-medium text-slate-700">{t(meta.template)}</p>
                        </div>
                        <div>
                          <p className="text-slate-400 mb-0.5">{t('申请人')}</p>
                          <p className="font-medium text-slate-700">{selectedApproval.applicant} · {t(selectedApproval.department)}</p>
                        </div>
                        <div>
                          <p className="text-slate-400 mb-0.5">{t('审批方式')}</p>
                          <p className="font-medium text-slate-700">{t(meta.method)}</p>
                        </div>
                        <div>
                          <p className="text-slate-400 mb-0.5">{t('当前节点')}</p>
                          <p className="font-medium text-slate-700">{t(meta.currentNode)}</p>
                        </div>
                        <div>
                          <p className="text-slate-400 mb-0.5">{t('提交时间')}</p>
                          <p className="font-medium text-slate-700">{selectedApproval.submitDate}</p>
                        </div>
                        {selectedApproval.project &&
                        <div>
                          <p className="text-slate-400 mb-0.5">{t('项目 / 成本归属')}</p>
                          <p className="font-medium text-slate-700"><AutoTranslatedText text={selectedApproval.project} /></p>
                        </div>
                        }
                      </div>
                      {(selectedApproval.notifyEmails?.length ?? 0) > 0 &&
                      <div className="mt-3.5 pt-3 border-t border-blue-100/70 flex items-start gap-2 flex-wrap">
                        <span className="flex items-center gap-1 text-xs text-slate-400">
                          <Send className="h-3.5 w-3.5" />{t('邮件通知')}
                        </span>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {selectedApproval.notifyEmails?.map((email) =>
                          <span key={email} className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2.5 py-0.5 text-xs text-slate-600">
                            {email}
                          </span>
                          )}
                        </div>
                      </div>
                      }
                      <div className="mt-3.5 pt-3 border-t border-blue-100/70 flex items-center gap-2 flex-wrap">
                        <span className="flex items-center gap-1 text-xs text-slate-400">
                          <Users className="h-3.5 w-3.5" />{t('抄送人')}
                        </span>
                        {meta.carbonCopy.length ?
                      <div className="flex flex-wrap items-center gap-1.5">
                            {meta.carbonCopy.map((cc) =>
                        <span key={cc.name} className="inline-flex items-center gap-1.5 rounded-full bg-white/80 py-0.5 pl-0.5 pr-2.5 text-xs text-slate-600">
                                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-200 text-[10px] font-medium text-slate-600">
                                  {cc.name.charAt(0)}
                                </span>
                                {cc.name}
                                {cc.department && <span className="text-slate-400">{t(cc.department)}</span>}
                              </span>
                        )}
                          </div> :
                      <span className="text-xs text-slate-400">{t('无')}</span>
                      }
                      </div>
                    </div>

                    {/* Summary */}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div className="bg-slate-50 rounded-2xl p-4">
                        <p className="text-xs text-slate-500 mb-1">{t('报销金额')}</p>
                        <p className="text-xl font-bold text-slate-800 tabular-nums">
                          {formatMoney(selectedApproval.amount)}
                        </p>
                      </div>
                      <div className="bg-slate-50 rounded-2xl p-4">
                        <p className="text-xs text-slate-500 mb-1">{t('单据数量')}</p>
                        <p className="text-xl font-bold text-slate-800 tabular-nums">
                          {selectedApproval.materials?.length ? `${selectedApproval.materials.length} ${t('笔')}` : `${selectedApproval.items} ${t('项')}`}
                          {selectedApproval.materials?.length ?
                        <span className="text-xs font-normal text-slate-400 ml-1">{selectedApproval.materials.length * 2} {t('份附件')}</span> :
                        null}
                        </p>
                      </div>
                      <div className="bg-slate-50 rounded-2xl p-4">
                        <p className="text-xs text-slate-500 mb-1">{t('审批进度')}</p>
                        <p className="text-xl font-bold text-slate-800 tabular-nums">
                          {selectedApproval.currentStep}
                          <span className="text-sm font-normal text-slate-400">/{selectedApproval.totalSteps}</span>
                        </p>
                        <div className="mt-2 h-1 bg-slate-200 rounded-full overflow-hidden">
                          <div className="h-full rounded-full bg-[#002fa7]" style={{ width: `${selectedApproval.currentStep / selectedApproval.totalSteps * 100}%` }} />
                        </div>
                      </div>
                    </div>

                    {selectedApproval.materials && selectedApproval.materials.length > 0 &&
                  <div>
                        <h4 className="mb-3 flex items-center gap-2 text-balance text-sm font-semibold text-slate-800">
                          <Archive className="w-4 h-4 text-emerald-500" />
                          {t('提交材料')}
                          <span className="ml-auto text-xs font-normal text-slate-400">{t('合计')} {formatMoney(materialTotal)}</span>
                        </h4>
                        <div className="overflow-x-auto rounded-2xl border border-slate-100">
                          <div className="min-w-[620px]">
                          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_96px] bg-slate-50 px-4 py-2 text-xs font-medium text-slate-500">
                            <span>{t('发票')}</span>
                            <span>{t('关联凭证')}</span>
                            <span className="text-right">{t('金额')}</span>
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
                      </div>
                  }

                    {/* Approval Flow Steps */}
                    <div>
                      <h4 className="mb-4 flex items-center gap-2 text-balance text-sm font-semibold text-slate-800">
                        <TrendingUp className="w-4 h-4 text-blue-500" />
                        {t('审批流程')}
                        <span className="ml-auto text-xs font-normal text-slate-400">{t('共')} {selectedApproval.flow.length} {t('个节点')}</span>
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
                                      {t(step.role)}
                                    </span>
                                    {!step.role.includes('申请') &&
                                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                                      {t(step.approvalMethod ?? meta.method)}
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
                                    {t('审批中...')}
                                  </p>
                            }
                                {step.status === 'pending' &&
                            <p className="text-xs text-slate-400 mt-1">
                                    {t('待审批')}
                                  </p>
                            }
                              </div>
                            </div>);

                    })}
                      </div>
                    </div>
                  </div>
                </div>);
              })() :
                <div className="hz-surface flex min-h-[320px] flex-1 flex-col items-center justify-center p-6 text-center">
                  <ClipboardCheck className="mb-3 h-14 w-14 text-slate-200" />
                  <p className="text-balance text-sm font-medium text-slate-600">{t('暂无可查看的报销申请')}</p>
                  <p className="mt-1 text-pretty text-xs text-slate-400">{t('请先在凭证管理中完成关联，再新建报销单')}</p>
                  <Button
                    type="button"
                    size="sm"
                    className="mt-4 bg-[#002fa7] text-white hover:bg-[#002581]"
                    onClick={() => openReimbursementDialog()}>
                    <Plus className="h-3.5 w-3.5" /> {t('新建报销单')}
                  </Button>
                </div>
              }
            </div>
          }

          {/* TAB 4: BUYBACK */}
          {activeTab === 'buyback' &&
          <div className="flex h-full min-w-0 flex-col gap-3 overflow-hidden pt-3">
              {/* Date Range Selector */}
              <div className="hz-surface shrink-0 overflow-hidden">
                <HorizonSectionHeader Icon={Calendar} title={t('发票回购明细生成')} description={t('按开票日期生成明细、税额汇总与导出范围。')} />
                <div className="flex flex-wrap items-center gap-4 p-4">
                  <div className="flex items-center gap-2">
                    <label htmlFor="buyback-start-date" className="text-xs font-medium text-slate-500">{t('开始日期')}</label>
                    <input
                    id="buyback-start-date"
                    type="date"
                    value={dateRange.start}
                    onChange={(e) =>
                    setDateRange({
                      ...dateRange,
                      start: e.target.value
                    })
                    }
                    className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm tabular-nums outline-none transition-colors focus:border-blue-300 focus:ring-2 focus:ring-blue-100" />
                  
                  </div>
                  <span className="text-slate-400">{t('至')}</span>
                  <div className="flex items-center gap-2">
                    <label htmlFor="buyback-end-date" className="text-xs font-medium text-slate-500">{t('结束日期')}</label>
                    <input
                    id="buyback-end-date"
                    type="date"
                    value={dateRange.end}
                    onChange={(e) =>
                    setDateRange({
                      ...dateRange,
                      end: e.target.value
                    })
                    }
                    className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm tabular-nums outline-none transition-colors focus:border-blue-300 focus:ring-2 focus:ring-blue-100" />
                  
                  </div>
                  <div className="flex p-1 bg-slate-100 rounded-full">
                    {[
                  { l: '本月', ...getMonthRange() },
                  { l: '上月', ...getMonthRange(-1) },
                  {
                    l: `Q${Math.floor(new Date().getMonth() / 3) + 1}`,
                    ...getCurrentQuarterRange()
                  }].
                  map((p) =>
                  <button
                    key={p.l}
                    type="button"
                    onClick={() =>
                    setDateRange({
                      start: p.start,
                      end: p.end
                    })
                    }
                    className="rounded-lg px-3 py-1 text-xs text-slate-600 transition-colors hover:bg-white hover:text-[#002fa7]">
                    
                        {t(p.l)}
                      </button>
                  )}
                  </div>
                  {invalidDateRange &&
                    <p className="w-full text-xs text-rose-600">
                      {t('开始日期不能晚于结束日期，请重新选择日期区间。')}
                    </p>
                  }
                </div>
              </div>

              {/* Summary cards */}
              <div className="grid shrink-0 grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="hz-surface bg-blue-50/70 p-5">
                  <p className="mb-1 text-xs text-[#002fa7]">{t('日期区间内发票数')}</p>
                  <p className="text-3xl font-bold text-[#002fa7] tabular-nums">
                    {filteredInvoices.length} {t('张')}
                  </p>
                  <p className="mt-2 text-xs text-blue-700 tabular-nums">
                    {dateRange.start} ~ {dateRange.end}
                  </p>
                </div>
                <div className="hz-surface p-5">
                  <p className="text-xs text-slate-500 mb-1">{t('价税合计')}</p>
                  <p className="text-3xl font-bold text-slate-800 tabular-nums">
                    ¥{buybackTotal.toFixed(2)}
                  </p>
                  <p className="text-xs text-slate-400 mt-2">{t('含税金额')}</p>
                </div>
                <div className="hz-surface p-5">
                  <p className="text-xs text-slate-500 mb-1">{t('可抵扣税额')}</p>
                  <p className="text-3xl font-bold text-emerald-600 tabular-nums">
                    ¥{buybackTax.toFixed(2)}
                  </p>
                  <p className="text-xs text-slate-400 mt-2">
                    {t('占比')} {(buybackTax / buybackTotal * 100 || 0).toFixed(1)}%
                  </p>
                </div>
              </div>

              {/* Buyback table */}
              <div className="hz-surface flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                <HorizonSectionHeader Icon={FileText} title={t('发票回购明细表单')} description={t('逐笔核对原始票据、关联凭证与价税合计。')} trailing={<span className="text-xs text-slate-500 tabular-nums">{t('共')} {filteredInvoices.length} {t('条记录')}</span>} />
                <div className="min-h-0 flex-1 overflow-auto">
                <table className="w-full min-w-[900px] text-sm">
                  <thead className="text-xs text-slate-500 bg-slate-50 sticky top-0 z-10">
                    <tr>
                      <th className="px-5 py-3 text-left font-medium">{t('序号')}</th>
                      <th className="px-5 py-3 text-left font-medium">
                        {t('发票号码')}
                      </th>
                      <th className="px-5 py-3 text-left font-medium">
                        {t('开票方')}
                      </th>
                      <th className="px-5 py-3 text-left font-medium">
                        {t('发票类型')}
                      </th>
                      <th className="px-5 py-3 text-left font-medium">
                        {t('开票日期')}
                      </th>
                      <th className="px-5 py-3 text-right font-medium">
                        {t('不含税金额')}
                      </th>
                      <th className="px-5 py-3 text-right font-medium">{t('税额')}</th>
                      <th className="px-5 py-3 text-right font-medium">
                        {t('价税合计')}
                      </th>
                      <th className="px-5 py-3 text-right font-medium">{t('操作')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {filteredInvoices.map((iv, idx) =>
                  <tr key={iv.id} className="hover:bg-slate-50/50">
                        <td className="px-5 py-3 text-slate-500 tabular-nums">{idx + 1}</td>
                        <td className="px-5 py-3 font-mono text-slate-700 tabular-nums">
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
                        <td className="px-5 py-3 text-slate-600 tabular-nums">{iv.date}</td>
                        <td className="px-5 py-3 text-right text-slate-700 tabular-nums">
                          ¥{(iv.amount - iv.taxAmount).toFixed(2)}
                        </td>
                        <td className="px-5 py-3 text-right text-emerald-600 tabular-nums">
                          ¥{iv.taxAmount.toFixed(2)}
                        </td>
                        <td className="px-5 py-3 text-right font-medium text-slate-800 tabular-nums">
                          ¥{iv.amount.toFixed(2)}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                          type="button"
                          onClick={() => setDocPreview({ kind: 'invoice', data: iv })}
                          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 transition-colors whitespace-nowrap">

                              <Eye className="h-3.5 w-3.5" />{t('原始票据')}
                            </button>
                            {(() => {
                          const linkedVoucher = findVoucherForInvoice(iv, expenseVouchers);
                          return linkedVoucher ?
                          <button
                            type="button"
                            onClick={() => setDocPreview({ kind: 'voucher', data: linkedVoucher })}
                            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-emerald-600 hover:bg-emerald-50 transition-colors whitespace-nowrap">

                                  <Link2 className="h-3.5 w-3.5" />{t('关联凭证')}
                                </button> :
                          <span className="inline-flex items-center rounded-lg px-2 py-1 text-xs text-slate-300 whitespace-nowrap">{t('未关联')}</span>;
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

                          <div className="flex flex-col items-center gap-3">
                            <span>{t('所选日期区间内暂无发票')}</span>
                            <Button type="button" variant="outline" size="sm" onClick={() => setDateRange(getMonthRange())}>{t('查看本月')}</Button>
                          </div>
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
                      
                          {t('合计')}
                        </td>
                        <td className="px-5 py-3 text-right text-slate-800 tabular-nums">
                          ¥{(buybackTotal - buybackTax).toFixed(2)}
                        </td>
                        <td className="px-5 py-3 text-right text-emerald-600 tabular-nums">
                          ¥{buybackTax.toFixed(2)}
                        </td>
                        <td className="px-5 py-3 text-right text-blue-700 text-base font-bold tabular-nums">
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
        <DialogContent className="horizon-portal flex max-h-[88vh] w-[calc(100vw-2rem)] max-w-5xl grid-rows-none flex-col gap-0 overflow-hidden rounded-3xl border-0 bg-white p-0 elevation-3 sm:max-w-5xl">
            <DialogHeader className="border-b border-slate-100 px-6 py-5 text-left">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <DialogTitle className="text-balance text-lg font-semibold text-slate-900">{t('新建报销单')}</DialogTitle>
                  <DialogDescription className="mt-1 text-pretty text-xs text-slate-500">
                    {t('请确认报销信息与凭证范围，确认后才会创建审批单。')}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className={`flex-1 overflow-y-auto p-6 ${inspectedReimbursementItem ? 'lg:pr-[360px]' : ''}`}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-2xl bg-emerald-50 px-4 py-3">
                  <div className="text-xs text-emerald-700">{t('已选金额')}</div>
                  <div className="mt-1 text-xl font-bold text-emerald-800 tabular-nums">
                    {formatMoney(reimbursementDraftTotal)}
                  </div>
                </div>
                <div className="rounded-2xl bg-blue-50 px-4 py-3">
                  <div className="text-xs text-blue-700">{t('材料数量')}</div>
                  <div className="mt-1 text-xl font-bold text-blue-800 tabular-nums">
                    {selectedReimbursementItems.length * 2} / {reimbursementDraftItems.length * 2} {t('份')}
                  </div>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <div className="text-xs text-slate-500">{t('关联发票')}</div>
                  <div className="mt-1 text-xl font-bold text-slate-800 tabular-nums">
                    {reimbursementDraftInvoiceCount} {t('张')}
                  </div>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-slate-500">{t('报销标题')}</span>
                  <input
                    value={reimbursementTitle}
                    onChange={(event) => setReimbursementTitle(event.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-800 outline-none transition-colors focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100"
                    placeholder={t('例如：6 月费用报销申请')} />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-slate-500">{t('申请人')}</span>
                  <input
                    value={reimbursementApplicant}
                    onChange={(event) => setReimbursementApplicant(event.target.value)}
                    disabled={!canSubmitOnBehalf}
                    title={!canSubmitOnBehalf ? t('申请人由当前登录账号确定') : undefined}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-800 outline-none transition-colors focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:text-slate-500"
                    placeholder={t('申请人姓名')} />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-slate-500">{t('项目 / 成本归属')}</span>
                  <input
                    value={reimbursementProject}
                    onChange={(event) => setReimbursementProject(event.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-800 outline-none transition-colors focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100"
                    placeholder={t('留空则取发票所属项目')} />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-slate-500">
                    {t('申请人企微 UserID')}
                    <span className="ml-1 font-normal text-slate-400">{t('（企业微信提单人）')}</span>
                  </span>
                  <input
                    value={reimbursementCreatorUserid}
                    onChange={(event) => setReimbursementCreatorUserid(event.target.value)}
                    disabled={!canSubmitOnBehalf}
                    title={!canSubmitOnBehalf ? t('仅具有代提交权限的用户可以指定企业微信提单人') : undefined}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-800 outline-none transition-colors focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:text-slate-500"
                    placeholder={t('留空则用系统默认提单人')} />
                </label>
                <label className="block md:col-span-2">
                  <span className="mb-1.5 block text-xs font-medium text-slate-500">{t('报销事由')}</span>
                  <textarea
                    value={reimbursementReason}
                    onChange={(event) => setReimbursementReason(event.target.value)}
                    className="min-h-[78px] w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 outline-none transition-colors focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100"
                    placeholder={t('填写本次报销用途、项目或说明')} />
                </label>
                <div className="md:col-span-2">
                  <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-500">
                    <Send className="h-3.5 w-3.5 text-blue-500" /> {t('邮件通知收件人')}
                    {reimbursementNotifyEmails.length > 0 && (
                      <span className="text-blue-600">{t('已选 {count}', { count: reimbursementNotifyEmails.length })}</span>
                    )}
                  </div>
                  <EmailChipSelector
                    options={mailboxOptions}
                    selected={reimbursementNotifyEmails}
                    onToggle={(email) =>
                      setReimbursementNotifyEmails((current) =>
                        current.includes(email) ? current.filter((item) => item !== email) : [...current, email],
                      )
                    }
                    emptyHint={
                      mailboxLoadError
                        ? t('邮箱列表加载失败：{message}', { message: mailboxLoadError })
                        : t('「邮箱管理」暂无已启用邮箱，可前往邮箱管理页配置后再选择收件人。')
                    }
                  />
                </div>
                <div className="md:col-span-2">
                  <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-500">
                    <Users className="h-3.5 w-3.5 text-emerald-500" /> {t('抄送人')}
                    {reimbursementCcEmails.length > 0 && (
                      <span className="text-emerald-600">{t('已选 {count}', { count: reimbursementCcEmails.length })}</span>
                    )}
                  </div>
                  <EmailChipSelector
                    options={mailboxOptions}
                    selected={reimbursementCcEmails}
                    onToggle={(email) =>
                      setReimbursementCcEmails((current) =>
                        current.includes(email) ? current.filter((item) => item !== email) : [...current, email],
                      )
                    }
                    emptyHint={
                      mailboxLoadError
                        ? t('邮箱列表加载失败：{message}', { message: mailboxLoadError })
                        : t('暂无可选抄送邮箱（同上，来自「邮箱管理」已启用邮箱）。')
                    }
                  />
                </div>
              </div>

              <div className="mt-5 overflow-hidden rounded-2xl border border-slate-100">
                <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-3">
                  <span className="text-sm font-semibold text-slate-800">{t('选择报销发票')}</span>
                  <span className="text-xs text-slate-500">
                    {t('仅显示未审批成功单据 · 显示 {visible} / {total}', { visible: filteredReimbursementItems.length, total: reimbursementDraftItems.length })}
                  </span>
                </div>
                {reimbursementDraftItems.length ? (
                  <>
                    <div className="space-y-3 border-b border-slate-100 bg-white px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="relative w-full min-w-0 max-w-[540px] flex-[1_1_360px]">
                          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                          <input
                            aria-label={t('搜索待报销的发票或凭证')}
                            value={reimbursementKeyword}
                            onChange={(event) => {
                              setReimbursementKeyword(event.target.value);
                              setReimbursementPage(1);
                              setReimbursementInspector(null);
                            }}
                            className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-9 text-sm text-slate-800 outline-none transition-colors focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100"
                            placeholder={t('搜索发票号码、开票方或凭证')} />
                          {reimbursementKeyword &&
                        <button
                          type="button"
                          aria-label={t('清空待报销票据搜索')}
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
                            <SelectTrigger aria-label={t('筛选报销类别')} className="h-9 w-[136px] rounded-xl border-slate-200 bg-white text-sm text-slate-700 focus:ring-blue-100">
                              <SelectValue placeholder={t('全部类别')} />
                            </SelectTrigger>
                            <SelectContent className="z-50">
                              <SelectItem value="all">{t('全部类别')}</SelectItem>
                              {reimbursementCategoryOptions.map((category) =>
                            <SelectItem key={category} value={category}>{t(category)}</SelectItem>
                            )}
                            </SelectContent>
                          </Select>
                          <ToggleGroup
                            aria-label={t('筛选票据选择状态')}
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
                                {t(option.label)}
                              </ToggleGroupItem>
                          )}
                          </ToggleGroup>
                          {reimbursementFilterActive &&
                        <button
                          type="button"
                          onClick={resetReimbursementFilters}
                          className="inline-flex h-9 items-center gap-1.5 rounded-full bg-slate-100 px-3 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-200">
                              <Filter className="h-3.5 w-3.5" /> {t('重置')}
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
                        <Check className="h-3.5 w-3.5" /> {t('全选结果')}
                      </button>
                      <button
                        type="button"
                        onClick={clearFilteredReimbursementItems}
                        disabled={filteredReimbursementItems.length === 0}
                        className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-200">
                        <X className="h-3.5 w-3.5" /> {t('清空结果')}
                      </button>
                      {reimbursementDraftGroups.map((group) => {
                        const allSelected = group.selectedCount === group.items.length;
                        const partiallySelected = group.selectedCount > 0 && !allSelected;
                        return (
                          <button
                            key={group.category}
                            type="button"
                            onClick={() => toggleReimbursementCategory(group.category)}
                            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${allSelected ? 'border-blue-200 bg-blue-50 text-blue-700' : partiallySelected ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}`}>
                            {t(group.category)} {group.selectedCount}/{group.items.length}
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
                                  aria-label={t('选择{category}分类', { category: t(group.category) })}
                                  onClick={(event) => event.stopPropagation()}
                                  onCheckedChange={() => toggleReimbursementCategory(group.category)}
                                  className="h-4 w-4 rounded border-slate-300 data-[state=checked]:border-blue-500 data-[state=checked]:bg-blue-500 data-[state=indeterminate]:border-blue-500 data-[state=indeterminate]:bg-blue-500" />
                                <span className="truncate">{t(group.category)}</span>
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
                                    role="button"
                                    tabIndex={0}
                                    aria-pressed={selected}
                                    onClick={() => toggleReimbursementItem(item.id)}
                                    onKeyDown={(event) => {
                                      if (event.key === 'Enter' || event.key === ' ') {
                                        event.preventDefault();
                                        toggleReimbursementItem(item.id);
                                      }
                                    }}
                                    className={`grid w-full cursor-pointer grid-cols-[24px_minmax(0,1fr)_74px_112px] items-center gap-3 px-4 py-3 text-left text-sm transition-colors ${selected ? 'bg-emerald-50/40' : 'hover:bg-slate-50'}`}>
                                    <Checkbox
                                      checked={selected}
                                      aria-label={t('选择 {name}', { name: invoice?.invoiceNumber ?? item.id })}
                                      onClick={(event) => event.stopPropagation()}
                                      onCheckedChange={() => toggleReimbursementItem(item.id)}
                                      className="h-5 w-5 rounded-md border-slate-300 data-[state=checked]:border-emerald-500 data-[state=checked]:bg-emerald-500" />
                                    <span className="min-w-0">
                                      <span className="block truncate font-medium text-slate-800" title={invoice?.issuer ?? item.vendor}>
                                        {invoice?.issuer ?? item.vendor}
                                      </span>
                                      <span className="mt-0.5 block truncate text-xs text-slate-400">
                                        {t('发票')} {invoice?.invoiceNumber ?? item.matchedTo ?? '-'} {t('· 凭证')} {item.id} · {item.vendor}
                                      </span>
                                    </span>
                                    <span className="flex items-center justify-end gap-1">
                                      <button
                                        type="button"
                                        title={t('查看发票详情')}
                                        aria-label={t('查看发票详情')}
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          setReimbursementInspector({ itemId: item.id, kind: 'invoice' });
                                        }}
                                        className="flex h-7 w-7 items-center justify-center rounded-full text-blue-600 transition-colors hover:bg-blue-50">
                                        <FileText className="h-3.5 w-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        title={t('查看关联详情')}
                                        aria-label={t('查看关联详情')}
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
                        {t('没有匹配的发票/凭证，请调整筛选条件。')}
                      </div>
                      }
                    </div>
                    <div className="flex items-center justify-between border-t border-slate-100 bg-white px-4 py-3">
                      <span className="text-xs text-slate-500">
                        {reimbursementPageStart}-{reimbursementPageEnd} / {filteredReimbursementItems.length} {t('项')}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setReimbursementPage((page) => Math.max(1, page - 1))}
                          disabled={reimbursementCurrentPage <= 1}
                          className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-200 disabled:opacity-40">
                          <ChevronLeft className="h-3.5 w-3.5" /> {t('上一页')}
                        </button>
                        <span className="min-w-12 text-center text-xs font-medium text-slate-600">
                          {reimbursementCurrentPage} / {reimbursementTotalPages}
                        </span>
                        <button
                          type="button"
                          onClick={() => setReimbursementPage((page) => Math.min(reimbursementTotalPages, page + 1))}
                          disabled={reimbursementCurrentPage >= reimbursementTotalPages}
                          className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-200 disabled:opacity-40">
                          {t('下一页')} <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="px-4 py-10 text-center text-sm text-slate-400">
                    {t('暂无可提交凭证，请先完成发票关联；已审批成功的票据不会重复展示。')}
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
                      <h4 className="truncate text-balance text-sm font-semibold text-slate-900">
                        {t(reimbursementInspector?.kind === 'invoice' ? '发票详情' : '关联详情')}
                      </h4>
                      <p className="truncate text-xs text-slate-400">
                        {inspectedReimbursementInvoice?.invoiceNumber ?? inspectedReimbursementItem.id}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label={t('关闭票据详情')}
                    onClick={() => setReimbursementInspector(null)}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700">
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {reimbursementInspector?.kind === 'invoice' ?
            <div className="space-y-4 p-4">
                    <div>
                      <div className="text-xs text-slate-400">{t('开票方')}</div>
                      <div className="mt-1 text-sm font-semibold text-slate-900">
                        {inspectedReimbursementInvoice?.issuer ?? '-'}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                      <div>
                        <div className="text-xs text-slate-400">{t('发票号码')}</div>
                        <div className="mt-1 font-mono text-slate-800">{inspectedReimbursementInvoice?.invoiceNumber ?? '-'}</div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-400">{t('开票日期')}</div>
                        <div className="mt-1 text-slate-800">{inspectedReimbursementInvoice?.date ?? inspectedReimbursementItem.date}</div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-400">{t('价税合计')}</div>
                        <div className="mt-1 font-semibold text-slate-900">{formatMoney(inspectedReimbursementInvoice?.amount ?? inspectedReimbursementItem.amount)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-400">{t('税额')}</div>
                        <div className="mt-1 text-emerald-700">{formatMoney(inspectedReimbursementInvoice?.taxAmount ?? 0)}</div>
                      </div>
                    </div>
                    <div className="rounded-2xl bg-slate-50 px-4 py-3">
                      <div className="text-xs text-slate-400">{t('审批状态')}</div>
                      <div className="mt-1 text-sm font-medium text-slate-800">
                        {t(inspectedReimbursementInvoice?.status ?? inspectedReimbursementItem.sourceInvoiceStatus ?? '未审批成功')}
                      </div>
                    </div>
                  </div> :
            <div className="space-y-4 p-4">
                    <div>
                      <div className="mb-2 text-xs font-medium text-blue-600">{t('发票')}</div>
                      <div className="text-sm font-semibold text-slate-900">{inspectedReimbursementInvoice?.issuer ?? '-'}</div>
                      <div className="mt-1 font-mono text-xs text-slate-500">{inspectedReimbursementInvoice?.invoiceNumber ?? inspectedReimbursementItem.matchedTo ?? '-'}</div>
                      <div className="mt-2 text-sm font-semibold text-slate-900">
                        {formatMoney(inspectedReimbursementInvoice?.amount ?? inspectedReimbursementItem.amount)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-xs font-medium text-emerald-600">
                      <span className="h-px flex-1 bg-emerald-100" />
                      <Link2 className="h-4 w-4" />
                      {t('已关联')}
                      <span className="h-px flex-1 bg-emerald-100" />
                    </div>
                    <div>
                      <div className="mb-2 text-xs font-medium text-emerald-600">{t('凭证')}</div>
                      <div className="text-sm font-semibold text-slate-900">{inspectedReimbursementItem.vendor}</div>
                      <div className="mt-1 font-mono text-xs text-slate-500">{getVoucherSubmitId(inspectedReimbursementItem)}</div>
                      <div className="mt-2 text-sm font-semibold text-slate-900">{formatMoney(inspectedReimbursementItem.amount)}</div>
                    </div>
                    <div className="rounded-2xl bg-slate-50 px-4 py-3 text-xs text-slate-500">
                      {t(inspectedReimbursementItem.category)} · {inspectedReimbursementItem.date}
                    </div>
                  </div>
            }
              </aside>
          }

            <DialogFooter className="flex-row items-center justify-between border-t border-slate-100 bg-slate-50 px-6 py-4 sm:justify-between">
              <div className="min-w-0">
              <p className="text-pretty text-xs text-slate-500">
                {t('确认后将创建报销单并尝试提交企业微信审批')}
                {(reimbursementNotifyEmails.length > 0 || reimbursementCcEmails.length > 0)
                  ? t('，并通知 {count} 个邮箱。', { count: reimbursementNotifyEmails.length + reimbursementCcEmails.length })
                  : '。'}
              </p>
              {reimbursementFormError ? <p role="alert" className="mt-1 text-pretty text-xs font-medium text-rose-600">{reimbursementFormError}</p> : null}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={closeReimbursementDialog}
                  className="rounded-xl">
                  {t('取消')}
                </Button>
                <Button
                  type="button"
                  onClick={() => void handleConfirmCreateApproval()}
                  disabled={submittingReimbursement || selectedReimbursementItems.length === 0}
                  className="rounded-xl bg-[#002fa7] text-white hover:bg-[#002581]">
                  {submittingReimbursement ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {t(submittingReimbursement ? '创建中...' : '确认创建')}
                </Button>
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
          <DialogContent className="horizon-portal w-full gap-0 overflow-hidden rounded-3xl border-0 bg-white p-0 elevation-3 sm:max-w-lg">
            <DialogHeader className="border-b border-slate-100 px-5 py-4 text-left">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                  <Eye className="h-4 w-4" />
                </span>
                <div>
                  <DialogTitle className="text-balance text-base font-semibold text-slate-900">{t('原始凭证影像')}</DialogTitle>
                  <DialogDescription className="mt-0.5 text-pretty text-xs text-slate-500">
                    {t(docPreview?.kind === 'invoice' ? '发票凭证' : '报销凭证')} · {docPreview?.data.id}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            {docPreview && (() => {
              const isInvoice = docPreview.kind === 'invoice';
              const counterpart = isInvoice
                ? findVoucherForInvoice(docPreview.data, expenseVouchers)
                : findInvoiceForExpenseItem(docPreview.data, invoiceVouchers);
              const label = t(isInvoice ? '关联凭证' : '关联发票');
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
                    <p className="text-xs text-slate-400">{t('暂无{label}', { label })}</p>
                    }
                  </div>
                  {counterpart &&
                  <>
                    <span className="shrink-0 text-xs font-semibold text-slate-700 tabular-nums">¥{counterpart.amount.toFixed(2)}</span>
                    <button
                    type="button"
                    onClick={() => setDocPreview(isInvoice
                      ? { kind: 'voucher', data: counterpart as ExpenseVoucherView }
                      : { kind: 'invoice', data: counterpart as InvoiceVoucherView })}
                    className="shrink-0 inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-xs font-medium text-blue-600 ring-1 ring-slate-200 transition-colors hover:bg-blue-50">
                      <Eye className="h-3 w-3" />{t('查看')}
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
                      <div className="text-base font-bold text-rose-600">{t(iv.type)}</div>
                      <div className="mt-1.5 flex items-center justify-between text-[11px] text-rose-500/90">
                        <span>{t('发票代码：')}044002600</span>
                        <span>{t('发票号码：')}{iv.invoiceNumber}</span>
                      </div>
                    </div>
                    <div className="px-5 py-4 text-xs text-slate-700">
                      <div className="flex items-start justify-between py-1">
                        <span className="text-slate-400">{t('开票日期')}</span>
                        <span className="font-mono">{iv.date}</span>
                      </div>
                      <div className="flex items-start justify-between py-1">
                        <span className="shrink-0 text-slate-400">{t('销售方')}</span>
                        <span className="ml-4 text-right font-medium text-slate-800">{iv.issuer}</span>
                      </div>
                      <div className="my-2.5 border-t border-slate-100" />
                      <div className="flex items-center justify-between py-1 text-slate-500">
                        <span>{t('金额（不含税）')}</span>
                        <span className="font-mono">¥{(iv.amount - iv.taxAmount).toFixed(2)}</span>
                      </div>
                      <div className="flex items-center justify-between py-1 text-slate-500">
                        <span>{t('税额')}</span>
                        <span className="font-mono">¥{iv.taxAmount.toFixed(2)}</span>
                      </div>
                      <div className="mt-2.5 flex items-center justify-between border-t border-slate-100 pt-2.5">
                        <span className="text-sm font-semibold text-slate-800">{t('价税合计')}</span>
                        <span className="text-lg font-bold text-rose-600 tabular-nums">¥{iv.amount.toFixed(2)}</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between px-5 pb-5">
                      <span className="text-[10px] text-slate-300">{t('收款人：系统 · 复核：系统 · 开票人：系统')}</span>
                      <div className="flex h-[72px] w-[72px] rotate-[-14deg] items-center justify-center rounded-full border-[2.5px] border-rose-400/70 text-center">
                        <span className="px-1 text-[8px] font-semibold leading-tight text-rose-500/80">{t('发票')}<br />{t('专用章')}<br />★</span>
                      </div>
                    </div>
                  </div>);

              })()}

              {docPreview?.kind === 'voucher' && (() => {
                const v = docPreview.data;
                return (
                  <div className="mx-auto w-full max-w-[300px] bg-white px-6 py-6 font-mono text-xs text-slate-700 shadow-sm">
                    <div className="text-center">
                      <div className="text-sm font-bold text-slate-800">{v.vendor}</div>
                      <div className="mt-1 text-[11px] text-slate-400">{t('消费凭据')} · {t(v.type)}</div>
                    </div>
                    <div className="my-3 border-t border-dashed border-slate-300" />
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-slate-400">{t('凭证编号')}</span>
                        <span>{v.id}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">{t('消费类别')}</span>
                        <span>{t(v.category)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">{t('消费日期')}</span>
                        <span>{v.date}</span>
                      </div>
                    </div>
                    <div className="my-3 border-t border-dashed border-slate-300" />
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-slate-700">{t('消费金额')}</span>
                      <span className="text-lg font-bold text-slate-900 tabular-nums">¥{v.amount.toFixed(2)}</span>
                    </div>
                    <div className="mt-5 text-center text-[10px] text-slate-300">— {t('凭据底部')} —</div>
                  </div>);

              })()}
            </div>

            <DialogFooter className="flex-row items-center justify-between border-t border-slate-100 bg-slate-50 px-5 py-3 sm:justify-between">
              <p className="text-[11px] text-slate-400">{t('影像在凭证上传时由系统留存')}</p>
              <button
                type="button"
                onClick={() => setDocPreview(null)}
                className="rounded-full bg-white px-4 py-1.5 text-sm font-medium text-slate-600 ring-1 ring-slate-200 transition-colors hover:bg-slate-100">

                {t('关闭')}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog open={draftDeleteConfirmOpen} onOpenChange={setDraftDeleteConfirmOpen}>
          <AlertDialogContent className="horizon-portal sm:max-w-md">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-balance text-slate-900">{t('删除报销草稿？')}</AlertDialogTitle>
              <AlertDialogDescription className="text-pretty">
                {t('确认删除草稿「{name}」？删除后会释放其中票据，可重新组单。', { name: selectedApproval?.title ?? '' })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('取消')}</AlertDialogCancel>
              <AlertDialogAction className="bg-rose-600 text-white hover:bg-rose-700" onClick={() => void handleDeleteSelectedDraft()}>
                <Trash2 className="size-4" /> {t('删除草稿')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* 归档分类 · 新增 / 重命名 */}
        <Dialog
          open={categoryEditor !== null}
          onOpenChange={(open) => {
            if (!open) setCategoryEditor(null);
          }}>
          <DialogContent className="horizon-portal w-full gap-0 overflow-hidden rounded-3xl border-0 bg-white p-0 elevation-3 sm:max-w-sm">
            <DialogHeader className="border-b border-slate-100 px-5 py-4 text-left">
              <DialogTitle className="text-balance text-base font-semibold text-slate-900">
                {t(categoryEditor?.mode === 'rename' ? '重命名分类' : categoryEditor?.mode === 'add-child' ? '新增子分类' : '新增费用类别')}
              </DialogTitle>
              <DialogDescription className="mt-0.5 text-pretty text-xs text-slate-500">
                {t(categoryEditor?.mode === 'add-child' ? '在所选费用类别下创建子分类' : '用于报销凭证的归档分类管理')}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 px-5 py-4">
              {categoryEditor?.withIcon &&
              <div>
                <label htmlFor="expense-category-icon" className="mb-1.5 block text-xs font-medium text-slate-500">{t('图标')}</label>
                <div className="flex items-center gap-2">
                  <input
                    id="expense-category-icon"
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
                      aria-label={t('选择图标 {icon}', { icon: emo })}
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
                <label htmlFor="expense-category-name" className="mb-1.5 block text-xs font-medium text-slate-500">{t('分类名称')}</label>
                <input
                  id="expense-category-name"
                  type="text"
                  autoFocus
                  value={categoryEditor?.name ?? ''}
                  onChange={(e) => setCategoryEditor((prev) => prev ? { ...prev, name: e.target.value } : prev)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitCategoryEditor();
                  }}
                  placeholder={t('请输入分类名称')}
                  className="w-full rounded-xl border-none bg-slate-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
              </div>
            </div>
            <DialogFooter className="flex-row items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3">
              <button
                type="button"
                onClick={() => setCategoryEditor(null)}
                className="rounded-full bg-white px-4 py-1.5 text-sm font-medium text-slate-600 ring-1 ring-slate-200 transition-colors hover:bg-slate-100">
                {t('取消')}
              </button>
              <button
                type="button"
                onClick={submitCategoryEditor}
                disabled={!categoryEditor?.name.trim()}
                className="inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50">
                <Check className="h-4 w-4" /> {t('保存')}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 归档分类 · 删除确认 */}
        <AlertDialog
          open={categoryDeleteTarget !== null}
          onOpenChange={(open) => {
            if (!open) setCategoryDeleteTarget(null);
          }}>
          <AlertDialogContent className="horizon-portal w-full gap-0 overflow-hidden rounded-3xl border-0 bg-white p-0 elevation-3 sm:max-w-sm">
            <AlertDialogHeader className="px-5 py-4 text-left">
              <AlertDialogTitle className="text-balance text-base font-semibold text-slate-900">{t('删除分类')}</AlertDialogTitle>
              <AlertDialogDescription className="text-pretty mt-1 text-xs leading-relaxed text-slate-500">
                {t('确认删除「{name}」{children}？该操作不可撤销。', {
                  name: categoryDeleteTarget?.name ?? '',
                  children: categoryDeleteTarget?.children && categoryDeleteTarget.children.length > 0 ? t('及其全部子分类') : '',
                })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="flex-row items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3">
              <AlertDialogCancel>{t('取消')}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (categoryDeleteTarget) removeCategoryNode(categoryDeleteTarget.id);
                  setCategoryDeleteTarget(null);
                }}
                className="bg-rose-600 text-white hover:bg-rose-700">
                <Trash2 className="h-4 w-4" /> {t('删除')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* 归档凭证 · 移动到其他类目 */}
        <Dialog
          open={moveItemTarget !== null}
          onOpenChange={(open) => {
            if (!open) setMoveItemTarget(null);
          }}>
          <DialogContent className="horizon-portal w-full gap-0 overflow-hidden rounded-3xl border-0 bg-white p-0 elevation-3 sm:max-w-md">
            <DialogHeader className="border-b border-slate-100 px-5 py-4 text-left">
              <DialogTitle className="text-balance text-base font-semibold text-slate-900">{t('移动到其他类目')}</DialogTitle>
              <DialogDescription className="mt-0.5 text-pretty text-xs text-slate-500">
                {t('将「{name}」（{id}）移动到所选分类下', { name: moveItemTarget?.vendor ?? '', id: moveItemTarget?.id ?? '' })}
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
                      <AutoTranslatedText className="flex-1 truncate" text={node.name} />
                      {current === node.id &&
                      <span className="shrink-0 text-[10px] text-blue-500">{t('当前')}</span>
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
                {t('取消')}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 归档凭证 · 移出确认 */}
        <AlertDialog
          open={deleteItemTarget !== null}
          onOpenChange={(open) => {
            if (!open) setDeleteItemTarget(null);
          }}>
          <AlertDialogContent className="horizon-portal w-full gap-0 overflow-hidden rounded-3xl border-0 bg-white p-0 elevation-3 sm:max-w-sm">
            <AlertDialogHeader className="px-5 py-4 text-left">
              <AlertDialogTitle className="text-balance text-base font-semibold text-slate-900">{t('移出归档')}</AlertDialogTitle>
              <AlertDialogDescription className="text-pretty mt-1 text-xs leading-relaxed text-slate-500">
                {t('确认将报销凭证「{name}」（{id} · ¥{amount}）移出归档列表？原始发票与付款凭证仍会保留，后续可通过重新归类恢复。', {
                  name: deleteItemTarget?.vendor ?? '',
                  id: deleteItemTarget?.id ?? '',
                  amount: deleteItemTarget?.amount.toFixed(2) ?? '',
                })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="flex-row items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3">
              <AlertDialogCancel>{t('取消')}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (deleteItemTarget) void deleteArchiveVoucher(deleteItemTarget.id);
                }}
                className="bg-rose-600 text-white hover:bg-rose-700">
                <Trash2 className="h-4 w-4" /> {t('移出归档')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
    </div>);

}
