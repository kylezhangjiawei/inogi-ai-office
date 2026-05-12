import React, { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  Columns3,
  Download,
  FileCheck2,
  FileText,
  FolderOpen,
  Link2,
  ListFilter,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  UploadCloud,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";

import { Badge } from "../../../app/components/ui/badge";
import { Button } from "../../../app/components/ui/button";
import { Checkbox } from "../../../app/components/ui/checkbox";
import { Input } from "../../../app/components/ui/input";
import { Progress } from "../../../app/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../app/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../app/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../app/components/ui/tabs";
import { Textarea } from "../../../app/components/ui/textarea";
import { cn } from "../../../app/components/ui/utils";
import { ConfidenceTag } from "../components/ConfidenceTag";
import { DrawerShell } from "../components/DrawerShell";
import { EmptyState } from "../components/EmptyState";
import { FilterBar } from "../components/FilterBar";
import { InvoiceThumbnail } from "../components/InvoiceThumbnail";
import { KPICard } from "../components/KPICard";
import { StatusBadge } from "../components/StatusBadge";
import { UploadDropzone } from "../components/UploadDropzone";
import { categoryColors } from "../mocks/expenseMock";
import { expenseService } from "../services/expenseService";
import { expenseText } from "../locales/zh-CN";
import type {
  DrawerKind,
  DrawerWidth,
  ExpenseCategory,
  ExpenseDashboardData,
  ExpenseRule,
  ExpenseSubMenu,
  InvoiceFilters,
  InvoiceRecord,
  ReimbursementRecord,
  VoucherCandidate,
} from "../types";

const defaultFilters: InvoiceFilters = {
  quickRange: "本月",
  status: "全部",
  category: "全部",
  amountMin: "",
  amountMax: "",
  keyword: "",
  maxConfidence: 1,
};

const subMenus: Array<{ key: ExpenseSubMenu; icon: React.ElementType }> = [
  { key: "workspace", icon: BarChart3 },
  { key: "invoices", icon: FolderOpen },
  { key: "reimbursements", icon: FileCheck2 },
  { key: "matching", icon: Link2 },
  { key: "rules", icon: Settings2 },
];

const pageMotion = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] },
};

const columns = [
  { key: "thumbnail", label: "缩略图" },
  { key: "invoiceNo", label: "发票号" },
  { key: "issuedDate", label: "开票日期" },
  { key: "vendor", label: "销售方" },
  { key: "amount", label: "金额" },
  { key: "category", label: "类别" },
  { key: "project", label: "项目" },
  { key: "status", label: "状态" },
  { key: "uploader", label: "上传人" },
  { key: "uploadedAt", label: "上传时间" },
  { key: "actions", label: "操作" },
] as const;

const chartBarPalette = [
  "var(--primary)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "#22c55e",
  "#f472b6",
  "#14b8a6",
  "#f97316",
  "#64748b",
];

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 0,
  }).format(value);

const getDrawerTitle = (drawer: DrawerKind) => {
  if (drawer === "upload") return expenseText.drawers.upload;
  if (drawer === "voucher-upload") return expenseText.drawers.voucherUpload;
  if (drawer === "invoice-detail") return expenseText.drawers.invoiceDetail;
  if (drawer === "batch-classify") return expenseText.drawers.batchClassify;
  if (drawer === "link-voucher") return expenseText.drawers.linkVoucher;
  if (drawer === "new-reimbursement") return expenseText.drawers.newReimbursement;
  if (drawer === "reimbursement-detail") return expenseText.drawers.reimbursementDetail;
  if (drawer === "matching-detail") return expenseText.drawers.matchingDetail;
  if (drawer === "push-settings") return expenseText.drawers.pushSettings;
  return expenseText.drawers.ruleEditor;
};

const getDrawerWidth = (drawer: DrawerKind): DrawerWidth => {
  if (drawer === "upload" || drawer === "voucher-upload" || drawer === "push-settings" || drawer === "rule-editor") return "narrow";
  if (drawer === "batch-classify" || drawer === "new-reimbursement" || drawer === "reimbursement-detail" || drawer === "matching-detail") return "wide";
  return "medium";
};

export function ExpenseModule() {
  const [activeMenu, setActiveMenu] = useState<ExpenseSubMenu>("workspace");
  const [filters, setFilters] = useState<InvoiceFilters>(defaultFilters);
  const [advancedFilters, setAdvancedFilters] = useState(false);
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [dashboard, setDashboard] = useState<ExpenseDashboardData | null>(null);
  const [reimbursements, setReimbursements] = useState<ReimbursementRecord[]>([]);
  const [rules, setRules] = useState<ExpenseRule[]>([]);
  const [voucherCandidates, setVoucherCandidates] = useState<VoucherCandidate[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<DrawerKind>(null);
  const [viewMode, setViewMode] = useState<"table" | "grid">("table");
  const [sortKey, setSortKey] = useState<"issuedDate" | "amount" | "confidence">("issuedDate");
  const [visibleColumns, setVisibleColumns] = useState(() => new Set(columns.map((column) => column.key)));
  const [loading, setLoading] = useState(true);
  const [dirtyDrawer, setDirtyDrawer] = useState(false);
  const deferredFilters = useDeferredValue(filters);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    Promise.all([
      expenseService.listInvoices(deferredFilters),
      expenseService.getDashboard(),
      expenseService.listReimbursements(),
      expenseService.listRules(),
    ]).then(([invoiceResult, dashboardResult, reimbursementResult, ruleResult]) => {
      if (cancelled) return;
      setInvoices(invoiceResult);
      setDashboard(dashboardResult);
      setReimbursements(reimbursementResult);
      setRules(ruleResult);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [deferredFilters]);

  const selectedInvoice = useMemo(
    () => invoices.find((invoice) => invoice.id === selectedInvoiceId) ?? invoices[0] ?? null,
    [invoices, selectedInvoiceId],
  );

  const sortedInvoices = useMemo(() => {
    const next = [...invoices];
    if (sortKey === "amount") next.sort((a, b) => b.amount - a.amount);
    if (sortKey === "confidence") next.sort((a, b) => a.categoryConfidence - b.categoryConfidence);
    if (sortKey === "issuedDate") next.sort((a, b) => b.issuedDate.localeCompare(a.issuedDate));
    return next;
  }, [invoices, sortKey]);

  const pageInvoices = useMemo(() => sortedInvoices.slice(0, 20), [sortedInvoices]);

  const selectedInvoices = useMemo(
    () => invoices.filter((invoice) => selectedIds.has(invoice.id)),
    [invoices, selectedIds],
  );

  const openDrawer = useCallback((nextDrawer: DrawerKind, invoice?: InvoiceRecord) => {
    if (invoice) setSelectedInvoiceId(invoice.id);
    setDirtyDrawer(false);
    setDrawer(nextDrawer);
  }, []);

  const openLinkDrawer = useCallback((invoice?: InvoiceRecord) => {
    const targetInvoice = invoice ?? selectedInvoice ?? invoices[0];
    if (!targetInvoice) return;
    setSelectedInvoiceId(targetInvoice.id);
    expenseService.listVoucherCandidates(targetInvoice.id).then(setVoucherCandidates);
    openDrawer("link-voucher", targetInvoice);
  }, [invoices, openDrawer, selectedInvoice]);

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAllVisible = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected = pageInvoices.every((invoice) => next.has(invoice.id));
      pageInvoices.forEach((invoice) => {
        if (allSelected) next.delete(invoice.id);
        else next.add(invoice.id);
      });
      return next;
    });
  }, [pageInvoices]);

  return (
    <div className="expense-tech-surface min-h-full min-w-[1120px] text-slate-900" style={{background: 'transparent'}}>
      <div className="mx-auto max-w-[1480px] space-y-4">
        <ModuleHeader activeMenu={activeMenu} onMenuChange={setActiveMenu} />

        <AnimatePresence mode="wait">
          <motion.div key={activeMenu} {...pageMotion}>
            {activeMenu === "workspace" ? (
              <WorkspacePage dashboard={dashboard} loading={loading} onOpenDrawer={openDrawer} />
            ) : null}

            {activeMenu === "invoices" ? (
              <InvoiceFolderPage
                invoices={pageInvoices}
                total={sortedInvoices.length}
                loading={loading}
                filters={filters}
                advancedFilters={advancedFilters}
                selectedIds={selectedIds}
                selectedInvoices={selectedInvoices}
                sortKey={sortKey}
                viewMode={viewMode}
                visibleColumns={visibleColumns}
                onFiltersChange={setFilters}
                onResetFilters={() => setFilters(defaultFilters)}
                onToggleAdvanced={() => setAdvancedFilters((value) => !value)}
                onToggleSelected={toggleSelected}
                onToggleAllVisible={toggleAllVisible}
                onOpenDrawer={openDrawer}
                onOpenLinkDrawer={openLinkDrawer}
                onSortChange={setSortKey}
                onViewModeChange={setViewMode}
                onVisibleColumnsChange={setVisibleColumns}
              />
            ) : null}

            {activeMenu === "reimbursements" ? (
              <ReimbursementPage reimbursements={reimbursements} invoices={invoices} onOpenDrawer={openDrawer} />
            ) : null}

            {activeMenu === "matching" ? (
              <MatchingPage invoices={invoices} onOpenDrawer={openLinkDrawer} onOpenVoucherUpload={() => openDrawer("voucher-upload")} />
            ) : null}

            {activeMenu === "rules" ? (
              <RulesPage rules={rules} onOpenDrawer={openDrawer} />
            ) : null}
          </motion.div>
        </AnimatePresence>
      </div>

      <DrawerShell
        open={drawer !== null}
        title={getDrawerTitle(drawer)}
        description={expenseText.drawers.description}
        width={getDrawerWidth(drawer)}
        dirty={dirtyDrawer}
        onOpenChange={(open) => {
          if (!open) setDrawer(null);
        }}
        footer={<DrawerFooterActions drawer={drawer} selectedCount={selectedIds.size} onClose={() => setDrawer(null)} />}
      >
        {drawer === "upload" ? <UploadInvoiceDrawer onDirtyChange={setDirtyDrawer} /> : null}
        {drawer === "voucher-upload" ? <UploadVoucherDrawer onDirtyChange={setDirtyDrawer} /> : null}
        {drawer === "invoice-detail" && selectedInvoice ? (
          <InvoiceDetailDrawer invoice={selectedInvoice} onDirtyChange={setDirtyDrawer} onLink={() => openLinkDrawer(selectedInvoice)} />
        ) : null}
        {drawer === "batch-classify" ? <BatchClassifyDrawer invoices={selectedInvoices.length ? selectedInvoices : pageInvoices.slice(0, 4)} onDirtyChange={setDirtyDrawer} /> : null}
        {drawer === "link-voucher" && selectedInvoice ? <LinkVoucherDrawer invoice={selectedInvoice} candidates={voucherCandidates} /> : null}
        {drawer === "new-reimbursement" ? <NewReimbursementDrawer invoices={invoices.slice(0, 8)} onDirtyChange={setDirtyDrawer} /> : null}
        {drawer === "reimbursement-detail" ? <ReimbursementDetailDrawer reimbursements={reimbursements} /> : null}
        {drawer === "matching-detail" && selectedInvoice ? <MatchingDetailDrawer invoice={selectedInvoice} candidates={voucherCandidates} /> : null}
        {drawer === "push-settings" ? <PushSettingsDrawer onDirtyChange={setDirtyDrawer} /> : null}
        {drawer === "rule-editor" ? <RuleEditorDrawer onDirtyChange={setDirtyDrawer} /> : null}
      </DrawerShell>
    </div>
  );
}

function ModuleHeader({
  activeMenu,
  onMenuChange,
}: {
  activeMenu: ExpenseSubMenu;
  onMenuChange: (menu: ExpenseSubMenu) => void;
}) {
  return (
    <section className="material-panel overflow-hidden p-0">
      <div className="expense-module-hero relative flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,var(--primary),var(--chart-2),var(--chart-4),var(--chart-3),#f472b6,var(--chart-5),#22c55e,var(--primary-container))]" />
        <div className="relative z-10 flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--m3-shape-medium)] border border-blue-100 bg-white/80 text-blue-700 shadow-sm">
            <BarChart3 className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="truncate text-xl font-bold text-slate-950">{expenseText.moduleTitle}</h2>
              <span className="shrink-0 rounded-full border border-blue-100 bg-white/80 px-2 py-0.5 text-[11px] font-bold text-blue-700 shadow-sm">
                {expenseText.moduleBadge}
              </span>
            </div>
            <p className="mt-0.5 truncate text-xs text-slate-500">{expenseText.moduleSubtitle}</p>
          </div>
        </div>
        <div className="relative z-10 flex shrink-0 rounded-full border border-slate-200 bg-white/72 p-1 shadow-sm backdrop-blur">
          {subMenus.map((item) => {
            const Icon = item.icon;
            const active = item.key === activeMenu;
            return (
              <motion.div key={item.key} whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }}>
              <Button
                type="button"
                variant="outline"
                onClick={() => onMenuChange(item.key)}
                className={cn(
                  "h-9 border-transparent bg-transparent px-4",
                  active
                    ? "border-blue-100 bg-[linear-gradient(135deg,#ffffff,var(--primary-container))] text-blue-700 shadow-[0_8px_18px_rgba(30,64,175,0.08)]"
                    : "text-slate-600 hover:bg-white/80",
                )}
              >
                <Icon className="h-4 w-4" />
                {expenseText.menus[item.key]}
              </Button>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function WorkspacePage({
  dashboard,
  loading,
  onOpenDrawer,
}: {
  dashboard: ExpenseDashboardData | null;
  loading: boolean;
  onOpenDrawer: (drawer: DrawerKind) => void;
}) {
  if (loading || !dashboard) {
    return <EmptyState title="正在加载工作台数据" detail="KPI、图表和待办会从费用模块 service 层统一读取。" />;
  }

  return (
    <div className="space-y-4">
      <section className="grid auto-rows-[1fr] grid-cols-4 items-stretch gap-3">
        {dashboard.kpis.map((item) => <KPICard key={item.title} {...item} />)}
      </section>

      <section className="material-panel p-4">
        <PanelTitle icon={AlertTriangle} title={expenseText.workspace.todoTitle} right="点击后打开对应处理 Drawer" />
        <div className="grid auto-rows-[1fr] grid-cols-3 items-stretch gap-3">
          {dashboard.todos.map((todo, index) => (
            <motion.button
              key={todo.id}
              type="button"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.04, duration: 0.22 }}
              whileHover={{ y: -2 }}
              onClick={() => onOpenDrawer(todo.drawer)}
              className={cn(
                "expense-tip-card relative flex h-full min-h-[116px] w-full cursor-pointer flex-col justify-between overflow-hidden rounded-[var(--m3-shape-large)] border bg-white px-4 py-3 pl-5 text-left transition-colors hover:bg-blue-50",
                todo.severity === "error" ? "border-red-100" : todo.severity === "warning" ? "border-amber-100" : "border-blue-100",
              )}
            >
              <span
                className={cn(
                  "absolute inset-y-0 left-0 w-1",
                  todo.severity === "error" ? "bg-red-400" : todo.severity === "warning" ? "bg-amber-400" : "bg-blue-500",
                )}
              />
              <div>
                <div className="text-sm font-bold text-slate-900">{todo.title}</div>
                <div className="mt-1 text-xs leading-5 text-slate-500">{todo.detail}</div>
              </div>
              <span className="mt-3 text-xs font-bold text-blue-700">打开处理</span>
            </motion.button>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <div className="expense-analysis-toolbar material-panel flex items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-[var(--m3-shape-medium)] border border-blue-100 bg-white text-blue-700 shadow-sm">
              <BarChart3 className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">统计分析</h3>
              <div className="mt-1 text-xs text-slate-500">已整合到工作台，避免看板数据重复分散。</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Input type="month" defaultValue="2026-05" className="h-9 w-40" />
            <Select defaultValue="department">
              <SelectTrigger className="material-input h-9 w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="department">按部门</SelectItem>
                <SelectItem value="category">按类别</SelectItem>
                <SelectItem value="project">按项目</SelectItem>
              </SelectContent>
            </Select>
            <Button type="button" variant="outline"><Download className="h-4 w-4" />导出报表</Button>
            <Button type="button" onClick={() => onOpenDrawer("push-settings")}><Send className="h-4 w-4" />订阅推送</Button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <ChartPanel title="月度趋势折线图" data={dashboard.monthlyTrend} type="trend" />
          <ChartPanel title="类别占比饼图" data={dashboard.categoryShare} type="pie" />
          <ChartPanel title="部门对比柱状图" data={dashboard.departmentBars} type="bar" />
          <ChartPanel title="项目费用 Top 10" data={dashboard.projectTop} type="project" />
        </div>
      </section>

      <section className="material-panel p-4">
        <PanelTitle icon={ShieldCheck} title={expenseText.workspace.activityTitle} />
        <div className="grid auto-rows-[1fr] grid-cols-4 gap-3">
          {dashboard.activities.map((activity) => (
            <div key={activity.id} className="flex h-full flex-col rounded-[var(--m3-shape-large)] border border-slate-200 bg-slate-50 p-3">
              <div className="mb-2 w-fit rounded-full border border-blue-100 bg-white px-2 py-0.5 text-xs font-bold text-blue-700">{activity.time}</div>
              <div className="mt-2 text-sm font-bold text-slate-900">{activity.title}</div>
              <div className="mt-1 flex-1 text-xs leading-5 text-slate-500">{activity.detail}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function InvoiceFolderPage(props: {
  invoices: InvoiceRecord[];
  total: number;
  loading: boolean;
  filters: InvoiceFilters;
  advancedFilters: boolean;
  selectedIds: Set<string>;
  selectedInvoices: InvoiceRecord[];
  sortKey: "issuedDate" | "amount" | "confidence";
  viewMode: "table" | "grid";
  visibleColumns: Set<(typeof columns)[number]["key"]>;
  onFiltersChange: (filters: InvoiceFilters) => void;
  onResetFilters: () => void;
  onToggleAdvanced: () => void;
  onToggleSelected: (id: string) => void;
  onToggleAllVisible: () => void;
  onOpenDrawer: (drawer: DrawerKind, invoice?: InvoiceRecord) => void;
  onOpenLinkDrawer: (invoice?: InvoiceRecord) => void;
  onSortChange: (sort: "issuedDate" | "amount" | "confidence") => void;
  onViewModeChange: (mode: "table" | "grid") => void;
  onVisibleColumnsChange: (columns: Set<(typeof columns)[number]["key"]>) => void;
}) {
  const allVisibleSelected = props.invoices.length > 0 && props.invoices.every((invoice) => props.selectedIds.has(invoice.id));

  return (
    <div className="space-y-4">
      <FilterBar
        filters={props.filters}
        advanced={props.advancedFilters}
        onFiltersChange={props.onFiltersChange}
        onReset={props.onResetFilters}
        onToggleAdvanced={props.onToggleAdvanced}
      />

      <section className="material-panel p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button type="button" onClick={() => props.onOpenDrawer("upload")}>
              <Plus className="h-4 w-4" />
              {expenseText.invoices.upload}
            </Button>
            <Button type="button" variant="outline" onClick={() => props.onOpenDrawer("upload")}>
              <UploadCloud className="h-4 w-4" />
              {expenseText.invoices.batchImport}
            </Button>
          </div>

          {props.selectedIds.size > 0 ? (
            <div className="flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3 py-1">
              <span className="text-xs font-bold text-blue-700">{expenseText.common.selected} {props.selectedIds.size}</span>
              <Button type="button" size="sm" variant="outline" onClick={() => props.onOpenDrawer("batch-classify")}>{expenseText.invoices.batchClassify}</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => props.onOpenLinkDrawer()}>{expenseText.invoices.batchLink}</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => toast.success("已导出选中票据")}>{expenseText.invoices.batchExport}</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => toast.success("已生成删除确认任务")}>{expenseText.invoices.batchDelete}</Button>
            </div>
          ) : null}

          <div className="flex items-center gap-2">
            <Select value={props.sortKey} onValueChange={(value) => props.onSortChange(value as "issuedDate" | "amount" | "confidence")}>
              <SelectTrigger className="material-input h-9 w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="issuedDate">按开票日期</SelectItem>
                <SelectItem value="amount">按金额</SelectItem>
                <SelectItem value="confidence">按低置信度</SelectItem>
              </SelectContent>
            </Select>
            <ColumnSettings columns={props.visibleColumns} onChange={props.onVisibleColumnsChange} />
            <Button type="button" variant="outline" size="icon" onClick={() => toast.success("票夹已刷新")} title={expenseText.invoices.refresh}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button type="button" variant={props.viewMode === "table" ? "default" : "outline"} size="sm" onClick={() => props.onViewModeChange("table")}>{expenseText.invoices.tableView}</Button>
            <Button type="button" variant={props.viewMode === "grid" ? "default" : "outline"} size="sm" onClick={() => props.onViewModeChange("grid")}>{expenseText.invoices.gridView}</Button>
          </div>
        </div>

        {props.loading ? <EmptyState title="正在加载票夹" /> : null}
        {!props.loading && props.viewMode === "table" ? (
          <InvoiceTable
            invoices={props.invoices}
            visibleColumns={props.visibleColumns}
            selectedIds={props.selectedIds}
            allVisibleSelected={allVisibleSelected}
            onToggleAllVisible={props.onToggleAllVisible}
            onToggleSelected={props.onToggleSelected}
            onOpenDrawer={props.onOpenDrawer}
            onOpenLinkDrawer={props.onOpenLinkDrawer}
          />
        ) : null}
        {!props.loading && props.viewMode === "grid" ? (
          <InvoiceGrid invoices={props.invoices} onOpenDrawer={props.onOpenDrawer} />
        ) : null}

        <div className="mt-3 flex items-center justify-between border-t border-slate-200 pt-3 text-xs text-slate-500">
          <span>{expenseText.common.total} {props.total} {expenseText.common.rows}，当前展示 20 条/页</span>
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" variant="outline" disabled>上一页</Button>
            <Badge variant="outline" className="bg-white">1</Badge>
            <Button type="button" size="sm" variant="outline">下一页</Button>
          </div>
        </div>
      </section>
    </div>
  );
}

function InvoiceTable({
  invoices,
  visibleColumns,
  selectedIds,
  allVisibleSelected,
  onToggleAllVisible,
  onToggleSelected,
  onOpenDrawer,
  onOpenLinkDrawer,
}: {
  invoices: InvoiceRecord[];
  visibleColumns: Set<(typeof columns)[number]["key"]>;
  selectedIds: Set<string>;
  allVisibleSelected: boolean;
  onToggleAllVisible: () => void;
  onToggleSelected: (id: string) => void;
  onOpenDrawer: (drawer: DrawerKind, invoice?: InvoiceRecord) => void;
  onOpenLinkDrawer: (invoice: InvoiceRecord) => void;
}) {
  if (!invoices.length) return <EmptyState title="没有符合条件的票据" detail="调整筛选条件后再试。" />;

  return (
    <div className="overflow-hidden rounded-[var(--m3-shape-large)] border border-slate-200">
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-blue-50">
          <TableRow>
            <TableHead className="w-[50px]"><Checkbox checked={allVisibleSelected} onCheckedChange={onToggleAllVisible} /></TableHead>
            {columns.map((column) => visibleColumns.has(column.key) ? <TableHead key={column.key}>{column.label}</TableHead> : null)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {invoices.map((invoice, index) => (
            <motion.tr
              key={invoice.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(index * 0.018, 0.18), duration: 0.2 }}
              className={cn("h-16 border-b transition-colors hover:bg-muted/50", invoice.status === "异常" ? "border-l-4 border-l-red-500" : "")}
            >
              <TableCell><Checkbox checked={selectedIds.has(invoice.id)} onCheckedChange={() => onToggleSelected(invoice.id)} /></TableCell>
              {visibleColumns.has("thumbnail") ? <TableCell><InvoiceThumbnail invoice={invoice} /></TableCell> : null}
              {visibleColumns.has("invoiceNo") ? <TableCell className="font-medium text-slate-900">{invoice.invoiceNo}</TableCell> : null}
              {visibleColumns.has("issuedDate") ? <TableCell>{invoice.issuedDate}</TableCell> : null}
              {visibleColumns.has("vendor") ? <TableCell className="max-w-[210px] truncate" title={invoice.vendor}>{invoice.vendor}</TableCell> : null}
              {visibleColumns.has("amount") ? <TableCell className={cn("text-right font-bold", invoice.amount > 5000 ? "text-amber-700" : "text-slate-950")}>{formatCurrency(invoice.amount)}</TableCell> : null}
              {visibleColumns.has("category") ? (
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className="bg-white">{invoice.category}</Badge>
                    <ConfidenceTag value={invoice.categoryConfidence} />
                  </div>
                </TableCell>
              ) : null}
              {visibleColumns.has("project") ? <TableCell className="max-w-[150px] truncate text-blue-700" title={invoice.project}>{invoice.project}</TableCell> : null}
              {visibleColumns.has("status") ? <TableCell><StatusBadge status={invoice.status} /></TableCell> : null}
              {visibleColumns.has("uploader") ? (
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-50 text-xs font-bold text-blue-700">{invoice.uploaderAvatar}</span>
                    {invoice.uploader}
                  </div>
                </TableCell>
              ) : null}
              {visibleColumns.has("uploadedAt") ? <TableCell title={invoice.uploadedAt}>{invoice.relativeUploadedAt}</TableCell> : null}
              {visibleColumns.has("actions") ? (
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Button type="button" size="sm" variant="outline" onClick={() => onOpenDrawer("invoice-detail", invoice)}>详情</Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => onOpenLinkDrawer(invoice)}>手动关联</Button>
                    <Button type="button" size="icon" variant="ghost" title="编辑、删除、导出 PDF、查看变更历史">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              ) : null}
            </motion.tr>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function InvoiceGrid({ invoices, onOpenDrawer }: { invoices: InvoiceRecord[]; onOpenDrawer: (drawer: DrawerKind, invoice?: InvoiceRecord) => void }) {
  if (!invoices.length) return <EmptyState title="没有符合条件的票据" />;
  return (
    <div className="grid grid-cols-5 gap-3">
      {invoices.map((invoice) => (
        <button key={invoice.id} type="button" onClick={() => onOpenDrawer("invoice-detail", invoice)} className="cursor-pointer rounded-[var(--m3-shape-large)] border border-slate-200 bg-white p-3 text-left transition-colors hover:border-blue-300 hover:bg-blue-50">
          <div className="mb-3 flex items-center justify-between gap-2">
            <InvoiceThumbnail invoice={invoice} />
            <StatusBadge status={invoice.status} />
          </div>
          <div className="truncate text-sm font-bold text-slate-900">{invoice.vendor}</div>
          <div className="mt-1 text-xs text-slate-500">{invoice.invoiceNo}</div>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-sm font-bold text-slate-950">{formatCurrency(invoice.amount)}</span>
            <ConfidenceTag value={invoice.categoryConfidence} />
          </div>
        </button>
      ))}
    </div>
  );
}

function ColumnSettings({
  columns: visibleColumns,
  onChange,
}: {
  columns: Set<(typeof columns)[number]["key"]>;
  onChange: (columns: Set<(typeof columns)[number]["key"]>) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <Button type="button" variant="outline" size="icon" onClick={() => setOpen((value) => !value)} title={expenseText.invoices.columnSettings}>
        <Columns3 className="h-4 w-4" />
      </Button>
      {open ? (
        <div className="absolute right-0 top-10 z-20 w-48 rounded-[var(--m3-shape-large)] border border-slate-200 bg-white p-2 shadow-lg">
          {columns.map((column) => (
            <label key={column.key} className="flex cursor-pointer items-center gap-2 rounded-[var(--m3-shape-medium)] px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-blue-50">
              <Checkbox
                checked={visibleColumns.has(column.key)}
                onCheckedChange={() => {
                  const next = new Set(visibleColumns);
                  if (next.has(column.key)) next.delete(column.key);
                  else next.add(column.key);
                  onChange(next);
                }}
              />
              {column.label}
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ReimbursementPage({
  reimbursements,
  invoices,
  onOpenDrawer,
}: {
  reimbursements: ReimbursementRecord[];
  invoices: InvoiceRecord[];
  onOpenDrawer: (drawer: DrawerKind) => void;
}) {
  const pending = reimbursements.filter((item) => item.status === "审批中").length;
  const weComSynced = reimbursements.filter((item) => item.weComSyncStatus !== "未提交" && item.weComSyncStatus !== "同步失败").length;
  const weComActive = reimbursements.filter((item) => item.weComSyncStatus === "审批中").length;
  return (
    <div className="space-y-4">
      <section className="grid auto-rows-[1fr] grid-cols-4 items-stretch gap-3">
        <KPICard title="本月报销笔数" value={`${reimbursements.length} 笔`} icon={FileCheck2} />
        <KPICard title="平均处理时长" value="1.8 天" icon={CalendarDays} trend="较上月 -0.4 天" />
        <KPICard title="待审批数" value={`${pending} 笔`} icon={AlertTriangle} />
        <KPICard title="企微审批同步" value={`${weComSynced}/${reimbursements.length}`} icon={Send} trend={`${weComActive} 笔审批中`} />
      </section>
      <section className="material-panel p-4">
        <PanelTitle icon={FileCheck2} title="报销单列表" right={<Button type="button" onClick={() => onOpenDrawer("new-reimbursement")}><Plus className="h-4 w-4" />新建报销单</Button>} />
        <Table>
          <TableHeader><TableRow><TableHead>报销单号</TableHead><TableHead>申请人</TableHead><TableHead>申请日期</TableHead><TableHead>总金额</TableHead><TableHead>票据数</TableHead><TableHead>当前状态</TableHead><TableHead>企业微信审批</TableHead><TableHead>操作</TableHead></TableRow></TableHeader>
          <TableBody>
            {reimbursements.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-bold">{item.id}</TableCell>
                <TableCell>{item.applicant}</TableCell>
                <TableCell>{item.appliedDate}</TableCell>
                <TableCell className="font-bold">{formatCurrency(item.amount)}</TableCell>
                <TableCell>{item.invoiceCount}</TableCell>
                <TableCell><StatusBadge status={item.status} /> <span className="ml-2 text-xs text-slate-500">{item.node}</span></TableCell>
                <TableCell>
                  <div className="space-y-1">
                    <StatusBadge status={item.weComSyncStatus} />
                    <div className="text-xs text-slate-500">{item.weComFlowId}</div>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button type="button" size="sm" variant="outline" onClick={() => onOpenDrawer("reimbursement-detail")}>详情</Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => toast.success("已同步企业微信审批状态")}>同步企微</Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
      <section className="material-panel p-4">
        <PanelTitle icon={FolderOpen} title="可引用票夹票据" right={`${invoices.filter((item) => item.status === "已关联").length} 张已关联票据`} />
      </section>
    </div>
  );
}

function MatchingPage({
  invoices,
  onOpenDrawer,
  onOpenVoucherUpload,
}: {
  invoices: InvoiceRecord[];
  onOpenDrawer: (invoice?: InvoiceRecord) => void;
  onOpenVoucherUpload: () => void;
}) {
  const failed = invoices.filter((invoice) => invoice.status === "异常" || invoice.categoryConfidence < 0.7);
  return (
    <section className="material-panel p-4">
      <PanelTitle
        icon={Link2}
        title="凭证关联管理"
        right={(
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={onOpenVoucherUpload}>
              <UploadCloud className="h-4 w-4" />
              上传付款凭证
            </Button>
            <Button type="button" onClick={() => toast.success("已自动处理所有高置信度关联")}>
              <Link2 className="h-4 w-4" />
              批量自动关联
            </Button>
          </div>
        )}
      />
      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending">待关联</TabsTrigger>
          <TabsTrigger value="linked">已关联</TabsTrigger>
          <TabsTrigger value="failed">关联失败</TabsTrigger>
        </TabsList>
        <TabsContent value="pending"><MatchingTable invoices={invoices.filter((item) => !item.voucherNo).slice(0, 12)} onOpenDrawer={onOpenDrawer} /></TabsContent>
        <TabsContent value="linked"><MatchingTable invoices={invoices.filter((item) => item.voucherNo).slice(0, 12)} onOpenDrawer={onOpenDrawer} /></TabsContent>
        <TabsContent value="failed"><MatchingTable invoices={failed.slice(0, 12)} onOpenDrawer={onOpenDrawer} /></TabsContent>
      </Tabs>
    </section>
  );
}

function MatchingTable({ invoices, onOpenDrawer }: { invoices: InvoiceRecord[]; onOpenDrawer: (invoice?: InvoiceRecord) => void }) {
  return (
    <Table>
      <TableHeader><TableRow><TableHead>发票号</TableHead><TableHead>金额</TableHead><TableHead>AI 推荐凭证</TableHead><TableHead>置信度</TableHead><TableHead>状态</TableHead><TableHead>操作</TableHead></TableRow></TableHeader>
      <TableBody>
        {invoices.map((invoice) => (
          <TableRow key={invoice.id}>
            <TableCell className="font-bold">{invoice.invoiceNo}</TableCell>
            <TableCell>{formatCurrency(invoice.amount)}</TableCell>
            <TableCell>{invoice.voucherNo ?? "等待 AI 推荐"}</TableCell>
            <TableCell><ConfidenceTag value={invoice.matchConfidence ?? invoice.categoryConfidence} /></TableCell>
            <TableCell><StatusBadge status={invoice.voucherNo ? "已关联" : invoice.status === "异常" ? "关联失败" : "待关联"} /></TableCell>
            <TableCell><Button type="button" size="sm" variant="outline" onClick={() => onOpenDrawer(invoice)}>手动关联</Button></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function RulesPage({ rules, onOpenDrawer }: { rules: ExpenseRule[]; onOpenDrawer: (drawer: DrawerKind) => void }) {
  return (
    <section className="material-panel p-4">
      <PanelTitle icon={Settings2} title="规则配置" right={<Button type="button" onClick={() => onOpenDrawer("rule-editor")}><Plus className="h-4 w-4" />新增规则</Button>} />
      <Tabs defaultValue="category">
        <TabsList>
          <TabsTrigger value="category">分类规则</TabsTrigger>
          <TabsTrigger value="threshold">AI 阈值</TabsTrigger>
          <TabsTrigger value="approval">审批流</TabsTrigger>
          <TabsTrigger value="materials">必备材料清单</TabsTrigger>
        </TabsList>
        <TabsContent value="category">
          <Table>
            <TableHeader><TableRow><TableHead>规则名</TableHead><TableHead>关键词</TableHead><TableHead>匹配类型</TableHead><TableHead>目标类别</TableHead><TableHead>优先级</TableHead><TableHead>命中次数</TableHead><TableHead>启用</TableHead></TableRow></TableHeader>
            <TableBody>
              {rules.map((rule) => (
                <TableRow key={rule.id}>
                  <TableCell className="font-bold">{rule.name}</TableCell>
                  <TableCell>{rule.keywords}</TableCell>
                  <TableCell>{rule.matchType}</TableCell>
                  <TableCell><Badge variant="outline">{rule.targetCategory}</Badge></TableCell>
                  <TableCell>{rule.priority}</TableCell>
                  <TableCell>{rule.hits}</TableCell>
                  <TableCell><Checkbox checked={rule.enabled} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>
        <TabsContent value="threshold"><ThresholdCards /></TabsContent>
        <TabsContent value="approval"><FlowConfig /></TabsContent>
        <TabsContent value="materials"><MaterialRules /></TabsContent>
      </Tabs>
    </section>
  );
}

function UploadInvoiceDrawer({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  return (
    <div className="space-y-4">
      <UploadDropzone processing />
      <div className="rounded-[var(--m3-shape-large)] border border-slate-200 bg-slate-50 p-4">
        <PanelTitle icon={Search} title="OCR 识别结果" />
        <div className="space-y-2">
          {["发票号 37814562", "金额 ¥4,820", "日期 2026-05-10", "类别 差旅 / AI 96%"].map((item) => (
            <div key={item} className="rounded border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700">{item}</div>
          ))}
        </div>
      </div>
      <Button type="button" variant="outline" onClick={() => onDirtyChange(true)}>编辑识别字段</Button>
    </div>
  );
}

function UploadVoucherDrawer({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  return (
    <div className="space-y-4">
      <UploadDropzone
        processing
        title="拖拽或点击上传付款凭证"
        description="支持银行回单、付款截图、PDF / JPG / PNG / XLSX，上传后自动提取金额、付款日期和流水号"
        accept=".jpg,.jpeg,.png,.pdf,.xlsx"
        processingLabel="AI 正在提取凭证字段并匹配发票..."
      />
      <div className="rounded-[var(--m3-shape-large)] border border-blue-100 bg-gradient-to-br from-blue-50 via-white to-emerald-50 p-4">
        <PanelTitle icon={Link2} title="凭证入库与关联规则" right={<Badge variant="outline" className="border-blue-100 bg-white text-blue-700">自动匹配</Badge>} />
        <div className="grid grid-cols-4 gap-3 text-sm">
          <Info label="识别字段" value="流水号 / 金额 / 日期 / 付款方" />
          <Info label="匹配条件" value="金额 + 项目 + 日期窗口" />
          <Info label="低置信度处理" value="进入人工关联池" />
          <Info label="关联结果" value="写回票夹与报销单" />
        </div>
      </div>
      <div className="rounded-[var(--m3-shape-large)] border border-slate-200 bg-slate-50 p-4">
        <PanelTitle icon={Search} title="本次识别预览" />
        <div className="grid grid-cols-2 gap-2">
          {["付款凭证 PAY-2605-118", "金额 ¥4,820", "付款日期 2026-05-11", "推荐关联发票 37814562"].map((item) => (
            <div key={item} className="rounded border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700">{item}</div>
          ))}
        </div>
      </div>
      <Button type="button" variant="outline" onClick={() => onDirtyChange(true)}>编辑凭证识别字段</Button>
    </div>
  );
}

function InvoiceDetailDrawer({ invoice, onDirtyChange, onLink }: { invoice: InvoiceRecord; onDirtyChange: (dirty: boolean) => void; onLink: () => void }) {
  const fields = [
    ["发票号", invoice.invoiceNo],
    ["发票代码", invoice.invoiceCode],
    ["开票日期", invoice.issuedDate],
    ["销售方", invoice.vendor],
    ["税号", invoice.vendorTaxNo],
    ["金额", formatCurrency(invoice.amount)],
    ["税额", formatCurrency(invoice.tax)],
    ["类别", invoice.category],
    ["项目", invoice.project],
  ];
  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="rounded-[var(--m3-shape-large)] border border-slate-200 bg-slate-50 p-4">
        <PanelTitle icon={FileText} title="票据原图" />
        <div className="flex h-[440px] items-center justify-center rounded-[var(--m3-shape-large)] border border-dashed border-slate-300 bg-white">
          <InvoiceThumbnail invoice={invoice} className="scale-[2.2]" />
        </div>
        <div className="mt-3 flex gap-2"><Button variant="outline" size="sm">缩放</Button><Button variant="outline" size="sm">旋转</Button><Button variant="outline" size="sm">全屏</Button></div>
      </div>
      <div className="space-y-4">
        <div className="rounded-[var(--m3-shape-large)] border border-slate-200 bg-white p-4">
          <PanelTitle icon={ListFilter} title="字段表单" right={<ConfidenceTag value={invoice.categoryConfidence} />} />
          <div className="grid grid-cols-2 gap-3">
            {fields.map(([label, value]) => (
              <label key={label} className="block">
                <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
                <Input defaultValue={value} onChange={() => onDirtyChange(true)} className="h-9" />
              </label>
            ))}
          </div>
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => toast.success("已恢复 AI 原值")}>恢复 AI 原值</Button>
        </div>
        <div className="rounded-[var(--m3-shape-large)] border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900">
          <div className="mb-1 font-bold">AI 智能建议</div>
          <div className="text-xs leading-5">{invoice.aiInsight}</div>
        </div>
        <div className="rounded-[var(--m3-shape-large)] border border-slate-200 bg-slate-50 p-4">
          <PanelTitle icon={ClockIcon} title="操作历史" />
          <div className="space-y-2 text-xs text-slate-600">
            <div>09:42 AI 完成 OCR 字段提取</div>
            <div>09:43 系统按规则归入 {invoice.category}</div>
            <div>09:45 材料清单校验完成</div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button type="button" onClick={onLink}>关联凭证</Button>
          <Button type="button" variant="outline" onClick={() => toast.success("票据已保存")}>保存</Button>
          <Button type="button" variant="outline" onClick={() => toast.success("已生成删除确认任务")}>删除</Button>
        </div>
      </div>
    </div>
  );
}

function BatchClassifyDrawer({ invoices, onDirtyChange }: { invoices: InvoiceRecord[]; onDirtyChange: (dirty: boolean) => void }) {
  return (
    <div className="grid grid-cols-[330px_minmax(0,1fr)] gap-4">
      <div className="rounded-[var(--m3-shape-large)] border border-slate-200 bg-slate-50 p-4">
        <PanelTitle icon={FolderOpen} title={`已勾选票据 ${invoices.length} 张`} />
        <div className="material-scrollbar max-h-[560px] space-y-2 overflow-y-auto">
          {invoices.map((invoice) => (
            <div key={invoice.id} className="flex items-center gap-2 rounded border border-slate-200 bg-white p-2">
              <InvoiceThumbnail invoice={invoice} />
              <div className="min-w-0"><div className="truncate text-sm font-bold">{invoice.vendor}</div><div className="text-xs text-slate-500">{formatCurrency(invoice.amount)}</div></div>
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-4">
        <div className="rounded-[var(--m3-shape-large)] border border-slate-200 bg-white p-4">
          <PanelTitle icon={Settings2} title="统一设置" />
          <div className="grid grid-cols-2 gap-3">
            <Select defaultValue="差旅" onValueChange={() => onDirtyChange(true)}>
              <SelectTrigger className="material-input h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["差旅", "采购", "餐饮", "办公", "其他"].map((item) => (
                  <SelectItem key={item} value={item}>{item}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input placeholder="关联项目" onChange={() => onDirtyChange(true)} />
          </div>
          <Textarea className="mt-3" placeholder="备注" onChange={() => onDirtyChange(true)} />
        </div>
        <div className="rounded-[var(--m3-shape-large)] border border-blue-100 bg-blue-50 p-4">
          <PanelTitle icon={ShieldCheck} title="AI 建议方案" />
          <div className="grid grid-cols-2 gap-3">
            <SuggestionCard title="展会差旅组" detail="4 张票据，建议归入差旅 / MEDICA 项目" confidence={0.94} />
            <SuggestionCard title="采购配件组" detail="3 张票据，建议归入采购 / 样机阀门配件" confidence={0.88} />
          </div>
        </div>
        <Button type="button" onClick={() => toast.success(`已应用到 ${invoices.length} 张票据`)}>应用到 {invoices.length} 张</Button>
      </div>
    </div>
  );
}

function LinkVoucherDrawer({ invoice, candidates }: { invoice: InvoiceRecord; candidates: VoucherCandidate[] }) {
  return (
    <div className="space-y-4">
      <div className="rounded-[var(--m3-shape-large)] border border-slate-200 bg-slate-50 p-4">
        <PanelTitle icon={ReceiptIcon} title="当前票据" right={<StatusBadge status={invoice.status} />} />
        <div className="grid grid-cols-4 gap-3 text-sm"><Info label="发票号" value={invoice.invoiceNo} /><Info label="金额" value={formatCurrency(invoice.amount)} /><Info label="日期" value={invoice.issuedDate} /><Info label="项目" value={invoice.project} /></div>
      </div>
      <div className="rounded-[var(--m3-shape-large)] border border-slate-200 bg-white p-4">
        <PanelTitle icon={Link2} title="AI 推荐候选凭证 Top 3" />
        <div className="space-y-2">
          {candidates.map((candidate, index) => (
            <motion.button
              key={candidate.id}
              type="button"
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.04 }}
              whileHover={{ x: 3 }}
              className="w-full cursor-pointer rounded-[var(--m3-shape-medium)] border border-slate-200 bg-slate-50 p-3 text-left transition-colors hover:border-blue-300 hover:bg-blue-50"
            >
              <div className="mb-2 flex items-center justify-between"><span className="font-bold text-slate-900">{candidate.voucherNo}</span><ConfidenceTag value={candidate.confidence} /></div>
              <div className="grid grid-cols-3 gap-3 text-xs text-slate-600"><span>{formatCurrency(candidate.amount)}</span><span>{candidate.date}</span><span>{candidate.subject}</span></div>
              <div className="mt-2 text-xs text-slate-500">{candidate.reason}</div>
            </motion.button>
          ))}
        </div>
      </div>

      <div className="manual-link-panel rounded-[var(--m3-shape-large)] border p-4">
        <PanelTitle
          icon={Search}
          title="人工关联工作台"
          right={<Badge variant="outline" className="border-blue-100 bg-white/80 text-blue-700">手动优先模式</Badge>}
        />
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2">
          <Input placeholder="手动搜索凭证号 / 金额 / 日期 / 项目" className="bg-white/90" />
          <Button type="button" variant="outline"><Search className="h-4 w-4" />搜索凭证</Button>
          <Button type="button" onClick={() => toast.success("已进入人工指定关联流程")}><Link2 className="h-4 w-4" />人工指定</Button>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3">
          {(candidates.length ? candidates : []).map((candidate) => (
            <button
              key={`manual-${candidate.id}`}
              type="button"
              onClick={() => toast.success(`已选择 ${candidate.voucherNo} 作为人工关联凭证`)}
              className="cursor-pointer rounded-[var(--m3-shape-medium)] border border-blue-100 bg-white/88 p-3 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-[0_14px_30px_rgba(30,64,175,0.12)]"
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="truncate text-sm font-bold text-slate-900">{candidate.voucherNo}</span>
                <span className="text-xs font-bold text-blue-700">{Math.round(candidate.confidence * 100)}%</span>
              </div>
              <div className="text-xs text-slate-500">{candidate.project}</div>
              <div className="mt-2 text-sm font-bold text-slate-950">{formatCurrency(candidate.amount)}</div>
            </button>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between rounded-[var(--m3-shape-medium)] border border-blue-100 bg-white/70 px-3 py-2 text-xs text-blue-900">
          <span>人工关联会保留操作者、选择理由和原 AI 推荐结果，方便财务复核追溯。</span>
          <Button type="button" size="sm" onClick={() => toast.success("人工关联已确认并写入票夹")}>确认人工关联</Button>
        </div>
      </div>
    </div>
  );
}

function NewReimbursementDrawer({ invoices, onDirtyChange }: { invoices: InvoiceRecord[]; onDirtyChange: (dirty: boolean) => void }) {
  const total = invoices.slice(0, 3).reduce((sum, invoice) => sum + invoice.amount, 0);
  return (
    <div className="space-y-4">
      <div className="rounded-[var(--m3-shape-large)] border border-slate-200 bg-white p-4">
        <PanelTitle icon={FileCheck2} title="基本信息" />
        <div className="grid grid-cols-2 gap-3">
          <Input defaultValue="5 月费用报销申请" onChange={() => onDirtyChange(true)} />
          <Input defaultValue="2026-05-12" type="date" onChange={() => onDirtyChange(true)} />
          <Input placeholder="关联项目" onChange={() => onDirtyChange(true)} />
          <Input placeholder="报销事由" onChange={() => onDirtyChange(true)} />
        </div>
      </div>
      <div className="rounded-[var(--m3-shape-large)] border border-blue-100 bg-gradient-to-br from-blue-50 via-white to-emerald-50 p-4 shadow-[0_18px_45px_rgba(37,99,235,0.10)]">
        <PanelTitle icon={Send} title="企业微信审批提交" right={<StatusBadge status="未提交" />} />
        <div className="grid grid-cols-4 gap-3 text-sm">
          <Info label="审批模板" value="费用报销审批" />
          <Info label="发起方式" value="确认后创建企微审批单" />
          <Info label="审批节点" value="部门负责人 → 财务复核 → 出纳付款" />
          <Info label="状态回写" value="企微回调自动同步" />
        </div>
        <div className="mt-3 flex items-center justify-between rounded-[var(--m3-shape-medium)] border border-blue-100 bg-white/70 px-3 py-2 text-xs text-blue-900">
          <span>提交后系统生成 WeCom Approval ID，并把审批通过、驳回、付款节点回写到报销单。</span>
          <Button type="button" size="sm" variant="outline" onClick={() => toast.success("已校验企业微信审批模板与回调地址")}>校验企微配置</Button>
        </div>
      </div>
      <div className="rounded-[var(--m3-shape-large)] border border-slate-200 bg-slate-50 p-4">
        <PanelTitle icon={FolderOpen} title="从票夹中选取票据" right={`自动汇总 ${formatCurrency(total)}`} />
        <InvoiceTableMini invoices={invoices} />
      </div>
    </div>
  );
}

function ReimbursementDetailDrawer({ reimbursements }: { reimbursements: ReimbursementRecord[] }) {
  const current = reimbursements[0];
  return (
    <div className="space-y-4">
      <div className="rounded-[var(--m3-shape-large)] border border-slate-200 bg-slate-50 p-4">
        <PanelTitle icon={FileCheck2} title={current?.title ?? "报销单详情"} right={current ? <StatusBadge status={current.status} /> : null} />
        <div className="grid grid-cols-4 gap-3 text-sm"><Info label="申请人" value={current?.applicant ?? "-"} /><Info label="申请日期" value={current?.appliedDate ?? "-"} /><Info label="总金额" value={formatCurrency(current?.amount ?? 0)} /><Info label="当前节点" value={current?.node ?? "-"} /></div>
      </div>
      {current ? (
        <div className="rounded-[var(--m3-shape-large)] border border-blue-100 bg-gradient-to-br from-blue-50 via-white to-cyan-50 p-4">
          <PanelTitle icon={Send} title="企业微信审批流" right={<StatusBadge status={current.weComSyncStatus} />} />
          <div className="grid grid-cols-4 gap-3 text-sm">
            <Info label="企微审批 ID" value={current.weComFlowId} />
            <Info label="当前处理人" value={current.weComApprover} />
            <Info label="最近回写" value={current.weComUpdatedAt} />
            <Info label="回调路径" value={`/expense/reimbursements/${current.id}/wecom/callback`} />
          </div>
          <div className="mt-3 flex gap-2">
            <Button type="button" size="sm" onClick={() => toast.success("已拉取企业微信最新审批状态")}><RefreshCw className="h-4 w-4" />同步企微状态</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => toast.success("已打开企业微信审批单预览")}>打开企微审批</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => toast.success("已重新推送企业微信审批流")}>重新推送</Button>
          </div>
        </div>
      ) : null}
      <FlowConfig />
      <div className="flex gap-2"><Button>通过</Button><Button variant="outline">驳回</Button><Button variant="outline">转他人</Button></div>
    </div>
  );
}

function MatchingDetailDrawer({ invoice, candidates }: { invoice: InvoiceRecord; candidates: VoucherCandidate[] }) {
  const candidate = candidates[0];
  return (
    <div className="grid grid-cols-[1fr_180px_1fr] gap-4">
      <ComparePane title="发票详情" rows={[["发票号", invoice.invoiceNo], ["金额", formatCurrency(invoice.amount)], ["日期", invoice.issuedDate], ["项目", invoice.project]]} />
      <div className="rounded-[var(--m3-shape-large)] border border-blue-100 bg-blue-50 p-4 text-center">
        <Link2 className="mx-auto mb-3 h-6 w-6 text-blue-700" />
        <div className="text-sm font-bold text-blue-900">匹配维度</div>
        <div className="mt-3 space-y-2 text-xs text-blue-800"><div>金额一致</div><div>日期相差 1 天</div><div>项目匹配</div><div>科目匹配</div></div>
      </div>
      <ComparePane title="凭证详情" rows={[["凭证号", candidate?.voucherNo ?? "-"], ["金额", formatCurrency(candidate?.amount ?? 0)], ["日期", candidate?.date ?? "-"], ["科目", candidate?.subject ?? "-"]]} />
    </div>
  );
}

function PushSettingsDrawer({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  return (
    <div className="space-y-4">
      <Select defaultValue="monthly" onValueChange={() => onDirtyChange(true)}>
        <SelectTrigger className="material-input h-10">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="daily">每日</SelectItem>
          <SelectItem value="weekly">每周</SelectItem>
          <SelectItem value="monthly">每月</SelectItem>
        </SelectContent>
      </Select>
      <div className="grid grid-cols-3 gap-2">{["企微", "钉钉", "邮件"].map((item) => <label key={item} className="rounded border border-slate-200 bg-white px-3 py-2 text-sm"><Checkbox defaultChecked={item === "企微"} /> <span className="ml-2">{item}</span></label>)}</div>
      <Input defaultValue="财务负责人、部门负责人" onChange={() => onDirtyChange(true)} />
      <Textarea placeholder="异常阈值设置：超预算告警、突增告警" onChange={() => onDirtyChange(true)} />
    </div>
  );
}

function RuleEditorDrawer({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  return (
    <div className="space-y-3">
      <Input placeholder="规则名称" onChange={() => onDirtyChange(true)} />
      <Textarea placeholder="匹配条件：关键词 / 销售方包含 / 金额范围 / 复合条件" onChange={() => onDirtyChange(true)} />
      <Select defaultValue="travel" onValueChange={() => onDirtyChange(true)}>
        <SelectTrigger className="material-input h-10">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="travel">归类到差旅</SelectItem>
          <SelectItem value="purchase">归类到采购</SelectItem>
          <SelectItem value="approval">触发审批</SelectItem>
        </SelectContent>
      </Select>
      <Input placeholder="优先级" onChange={() => onDirtyChange(true)} />
    </div>
  );
}

function DrawerFooterActions({ drawer, selectedCount, onClose }: { drawer: DrawerKind; selectedCount: number; onClose: () => void }) {
  if (!drawer) return null;
  const saveLabel =
    drawer === "batch-classify"
      ? `应用到 ${Math.max(selectedCount, 1)} 张`
      : drawer === "upload"
        ? "确认入库"
        : drawer === "voucher-upload"
          ? "确认导入凭证"
        : drawer === "new-reimbursement"
          ? "提交企微审批"
          : drawer === "reimbursement-detail"
            ? "同步企微状态"
            : "保存";
  return (
    <div className="flex w-full justify-end gap-2">
      <Button type="button" variant="outline" onClick={onClose}>取消</Button>
      <Button type="button" variant="outline" onClick={() => toast.success("草稿已保存")}>保存草稿</Button>
      <Button type="button" onClick={() => { toast.success("操作已完成"); onClose(); }}><Save className="h-4 w-4" />{saveLabel}</Button>
    </div>
  );
}

function PanelTitle({ icon: Icon, title, right }: { icon: React.ElementType; title: string; right?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-blue-700" />
        <h3 className="text-sm font-bold text-slate-900">{title}</h3>
      </div>
      {right ? <div className="text-xs font-medium text-slate-500">{right}</div> : null}
    </div>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="rounded border border-slate-200 bg-white p-3"><div className="text-xs text-slate-500">{label}</div><div className="mt-1 truncate font-bold text-slate-900">{value}</div></div>;
}

function SuggestionCard({ title, detail, confidence }: { title: string; detail: string; confidence: number }) {
  return <div className="rounded border border-blue-100 bg-white p-3"><div className="mb-2 flex items-center justify-between"><span className="font-bold text-slate-900">{title}</span><ConfidenceTag value={confidence} /></div><div className="text-xs text-slate-500">{detail}</div></div>;
}

function InvoiceTableMini({ invoices }: { invoices: InvoiceRecord[] }) {
  return <div className="grid grid-cols-2 gap-2">{invoices.slice(0, 8).map((invoice) => <label key={invoice.id} className="flex items-center gap-2 rounded border border-slate-200 bg-white p-2 text-sm"><Checkbox defaultChecked={invoice.status === "已关联"} /><InvoiceThumbnail invoice={invoice} /><span className="min-w-0 flex-1 truncate">{invoice.vendor}</span><span className="font-bold">{formatCurrency(invoice.amount)}</span></label>)}</div>;
}

function ComparePane({ title, rows }: { title: string; rows: Array<[string, React.ReactNode]> }) {
  return <div className="rounded-[var(--m3-shape-large)] border border-slate-200 bg-white p-4"><PanelTitle icon={FileText} title={title} />{rows.map(([label, value]) => <Info key={label} label={label} value={value} />)}</div>;
}

function ChartPanel({ title, data, type }: { title: string; data: any[]; type: "trend" | "pie" | "bar" | "project" }) {
  return (
    <div className="expense-chart-panel material-panel p-4">
      <PanelTitle
        icon={BarChart3}
        title={title}
        right={type === "bar" || type === "project" ? <span className="text-[11px] text-slate-500">逐条独立色彩</span> : null}
      />
      <div className="h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          {type === "pie" ? (
            <PieChart><Pie data={data} dataKey="amount" nameKey="category" innerRadius={56} outerRadius={92}>{data.map((item) => <Cell key={item.category} fill={categoryColors[item.category as ExpenseCategory]} />)}</Pie><Tooltip formatter={(value: number | string) => [formatCurrency(Number(value)), "金额"]} /></PieChart>
          ) : type === "bar" || type === "project" ? (
            <BarChart data={data} layout="vertical" margin={{ top: 8, right: 12, bottom: 0, left: 8 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey={type === "bar" ? "dept" : "project"} width={92} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
              <Tooltip formatter={(value: number | string) => [formatCurrency(Number(value)), "金额"]} />
              <Bar dataKey="amount" radius={[0, 6, 6, 0]}>
                {data.map((item, index) => (
                  <Cell key={`${type}-${item.dept ?? item.project ?? index}`} fill={chartBarPalette[index % chartBarPalette.length]} />
                ))}
              </Bar>
            </BarChart>
          ) : (
            <LineChart data={data}><CartesianGrid stroke="var(--outline-variant)" vertical={false} /><XAxis dataKey="month" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} /><YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} /><Tooltip formatter={(value: number | string) => [formatCurrency(Number(value)), "金额"]} /><Line dataKey="差旅" stroke="var(--primary)" dot={false} /><Line dataKey="采购" stroke="var(--chart-3)" dot={false} /></LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function ThresholdCards() {
  return <div className="grid grid-cols-3 gap-3">{[["分类自动入库置信度阈值", 90], ["关联自动通过置信度阈值", 85], ["异常告警置信度阈值", 70]].map(([label, value]) => <div key={label} className="rounded border border-slate-200 bg-slate-50 p-4"><div className="mb-2 text-sm font-bold">{label}</div><Progress value={Number(value)} /><div className="mt-2 text-xs text-slate-500">{value}%</div></div>)}</div>;
}

function FlowConfig() {
  return <div className="rounded-[var(--m3-shape-large)] border border-slate-200 bg-slate-50 p-4"><PanelTitle icon={ShieldCheck} title="审批流" /><div className="grid grid-cols-4 gap-2">{["申请人提交", "部门负责人", "财务复核", "出纳付款"].map((step, index) => <div key={step} className="rounded border border-slate-200 bg-white p-3 text-center text-sm font-bold">{index + 1}. {step}</div>)}</div></div>;
}

function MaterialRules() {
  return <div className="grid grid-cols-4 gap-3">{(["差旅", "餐饮", "采购", "办公"] as ExpenseCategory[]).map((category) => <div key={category} className="rounded border border-slate-200 bg-slate-50 p-4"><div className="mb-2 font-bold">{category}</div><div className="text-xs leading-5 text-slate-500">{category === "差旅" ? "发票 + 行程单 + 审批单" : category === "餐饮" ? "发票 + 参与人 + 事由" : category === "采购" ? "发票 + 合同 + 入库单" : "发票 + 申请说明"}</div></div>)}</div>;
}

const ClockIcon = CalendarDays;
const ReceiptIcon = FileText;
