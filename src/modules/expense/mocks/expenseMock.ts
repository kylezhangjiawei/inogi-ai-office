import {
  AlertTriangle,
  BarChart3,
  Bot,
  Clock3,
  Receipt,
  TrendingUp,
} from "lucide-react";

import type {
  ActivityLog,
  ExpenseCategory,
  ExpenseDashboardData,
  ExpenseRule,
  InvoiceRecord,
  InvoiceStatus,
  ReimbursementRecord,
  VoucherCandidate,
} from "../types";

const vendors = [
  "中国国际航空",
  "汉庭酒店北京望京店",
  "苏宁工业品采购",
  "湖畔商务餐厅",
  "上海云研科技有限公司",
  "深圳通用办公用品",
  "北京东方会议服务",
  "广州精密零件有限公司",
  "携程商旅服务",
  "南京智造供应链",
];

const projects = [
  "MEDICA 展会样机沟通",
  "北京售后培训",
  "样机阀门配件",
  "渠道客户接待",
  "德国注册资料准备",
  "QMS 内审支持",
  "研发试制批次",
  "行政月度采购",
];

const categories: ExpenseCategory[] = ["差旅", "餐饮", "采购", "办公", "其他"];
const statuses: InvoiceStatus[] = ["已识别", "待确认", "已关联", "异常", "已报销", "待识别"];
const uploaders = ["周林", "刘敏", "陈睿", "王澜", "赵航", "钱静", "孙悦", "李岩"];

const amountByCategory: Record<ExpenseCategory, number> = {
  差旅: 4800,
  餐饮: 860,
  采购: 3200,
  办公: 540,
  其他: 1280,
};

export const invoiceRecords: InvoiceRecord[] = Array.from({ length: 32 }, (_, index) => {
  const category = categories[index % categories.length];
  const status = statuses[index % statuses.length];
  const confidence = [0.96, 0.88, 0.74, 0.63, 0.91, 0.81, 0.57, 0.93][index % 8];
  const amount = amountByCategory[category] + (index % 6) * 230 + (index % 3) * 67;
  const vendor = vendors[index % vendors.length];
  const project = projects[index % projects.length];
  const day = String((index % 26) + 1).padStart(2, "0");
  const uploadedHour = (index % 9) + 1;

  return {
    id: `INV-${String(index + 1).padStart(4, "0")}`,
    thumbnailType: index % 5 === 0 ? "PDF" : index % 2 === 0 ? "JPG" : "PNG",
    invoiceNo: `${37810000 + index * 931}`,
    invoiceCode: `${44001900000 + index * 17}`,
    issuedDate: `2026-05-${day}`,
    vendor,
    vendorTaxNo: `91${String(100000000000000 + index * 13729).slice(0, 16)}`,
    amount,
    tax: Math.round(amount * 0.06),
    category,
    categoryConfidence: confidence,
    project,
    status,
    uploader: uploaders[index % uploaders.length],
    uploaderAvatar: uploaders[index % uploaders.length].slice(0, 1),
    uploadedAt: `2026-05-${day} ${String(9 + (index % 8)).padStart(2, "0")}:30`,
    relativeUploadedAt: `${uploadedHour} 小时前`,
    aiInsight:
      confidence >= 0.9
        ? "AI 已根据供应商、金额和项目关键词完成自动归类。"
        : confidence >= 0.7
          ? "AI 建议人工复核类别或项目归属。"
          : "AI 置信度偏低，需要人工确认发票字段和材料完整性。",
    materialMissing:
      status === "异常"
        ? category === "餐饮"
          ? ["参与人", "事由"]
          : ["负责人签字"]
        : confidence < 0.7
          ? ["原图清晰度"]
          : [],
    voucherNo: status === "已关联" || status === "已报销" ? `PAY-2605-${String(90 + index).padStart(3, "0")}` : undefined,
    matchConfidence: status === "已关联" || status === "已报销" ? Math.min(0.98, confidence + 0.03) : undefined,
    paymentVoucher: status === "已关联" || status === "已报销" ? `${category}付款凭证` : undefined,
  };
});

export const voucherCandidates: VoucherCandidate[] = [
  { id: "V-001", voucherNo: "PAY-2605-118", amount: 4820, date: "2026-05-11", project: "MEDICA 展会样机沟通", subject: "差旅费", confidence: 0.96, reason: "金额一致、日期相差 1 天、项目完全匹配" },
  { id: "V-002", voucherNo: "PAY-2605-121", amount: 1260, date: "2026-05-09", project: "样机阀门配件", subject: "研发材料", confidence: 0.87, reason: "供应商和项目匹配，金额一致" },
  { id: "V-003", voucherNo: "PAY-2605-099", amount: 1860, date: "2026-05-08", project: "渠道客户接待", subject: "业务招待费", confidence: 0.74, reason: "金额一致，项目相近，需确认参与人名单" },
];

export const reimbursements: ReimbursementRecord[] = [
  { id: "EXP-642", title: "MEDICA 展会差旅报销", applicant: "周林", appliedDate: "2026-05-10", amount: 4820, invoiceCount: 2, status: "审批中", node: "部门负责人", weComFlowId: "WW-APPROVAL-2605-642", weComSyncStatus: "审批中", weComApprover: "赵航", weComUpdatedAt: "2026-05-12 09:42" },
  { id: "EXP-638", title: "渠道客户接待", applicant: "王澜", appliedDate: "2026-05-08", amount: 1860, invoiceCount: 1, status: "已驳回", node: "补充材料", weComFlowId: "WW-APPROVAL-2605-638", weComSyncStatus: "已回调", weComApprover: "钱静", weComUpdatedAt: "2026-05-11 17:28" },
  { id: "EXP-627", title: "行政月度采购", applicant: "行政部", appliedDate: "2026-05-04", amount: 4200, invoiceCount: 9, status: "已付款", node: "出纳付款", weComFlowId: "WW-APPROVAL-2605-627", weComSyncStatus: "已回调", weComApprover: "财务共享", weComUpdatedAt: "2026-05-06 15:10" },
  { id: "EXP-611", title: "样机阀门配件采购", applicant: "陈睿", appliedDate: "2026-04-28", amount: 1260, invoiceCount: 1, status: "已通过", node: "财务复核", weComFlowId: "WW-APPROVAL-2604-611", weComSyncStatus: "已同步", weComApprover: "钱静", weComUpdatedAt: "2026-04-29 11:06" },
];

export const expenseRules: ExpenseRule[] = [
  { id: "RULE-001", name: "航司/火车票归差旅", keywords: "航空,航旅,火车,高铁", matchType: "销售方包含", targetCategory: "差旅", priority: 90, hits: 128, enabled: true },
  { id: "RULE-002", name: "工业品平台归采购", keywords: "工业品,配件,供应链", matchType: "关键词", targetCategory: "采购", priority: 84, hits: 76, enabled: true },
  { id: "RULE-003", name: "餐厅且项目含客户归餐饮", keywords: "餐厅,客户,接待", matchType: "复合条件", targetCategory: "餐饮", priority: 72, hits: 33, enabled: true },
  { id: "RULE-004", name: "低置信度进入人工池", keywords: "< 0.7", matchType: "AI 阈值", targetCategory: "其他", priority: 99, hits: 19, enabled: true },
];

export const dashboardData: ExpenseDashboardData = {
  kpis: [
    { title: "本月报销总额", value: "¥72,200", trend: "环比 +17.8%", icon: TrendingUp },
    { title: "待处理票据数", value: "18 张", badge: "5 异常", icon: Receipt },
    { title: "AI 自动处理率", value: "86%", progress: 86, icon: Bot },
    { title: "节省人工工时", value: "31.5 h", trend: "本月估算", icon: Clock3 },
  ],
  todos: [
    { id: "todo-1", title: "5 张发票缺失签字", detail: "差旅与招待票据需要补齐材料", drawer: "invoice-detail", severity: "error" },
    { id: "todo-2", title: "12 张发票待人工确认分类", detail: "AI 中低置信度集中处理", drawer: "batch-classify", severity: "warning" },
    { id: "todo-3", title: "3 笔凭证关联失败", detail: "金额或项目不一致，建议手动比对", drawer: "link-voucher", severity: "info" },
  ],
  activities: [
    { id: "act-1", time: "09:42", title: "AI 已自动识别并分类周林的差旅发票", detail: "中国国际航空 ¥4,820 / 置信度 96%" },
    { id: "act-2", time: "09:18", title: "凭证 PAY-2605-118 自动关联成功", detail: "金额、日期、项目三项匹配" },
    { id: "act-3", time: "08:55", title: "系统生成 5 月费用月报草稿", detail: "等待财务负责人确认推送对象" },
    { id: "act-4", time: "08:21", title: "招待类票据触发材料清单校验", detail: "缺参与人名单与接待事由" },
  ],
  monthlyTrend: [
    { month: "6月", 差旅: 22000, 餐饮: 5400, 采购: 10800, 办公: 3800, 其他: 2200 },
    { month: "7月", 差旅: 24800, 餐饮: 6200, 采购: 9800, 办公: 4100, 其他: 2600 },
    { month: "8月", 差旅: 21800, 餐饮: 6800, 采购: 12400, 办公: 3900, 其他: 2400 },
    { month: "9月", 差旅: 28600, 餐饮: 7100, 采购: 15200, 办公: 4200, 其他: 2800 },
    { month: "10月", 差旅: 30200, 餐饮: 7600, 采购: 14800, 办公: 4500, 其他: 3000 },
    { month: "11月", 差旅: 31800, 餐饮: 7300, 采购: 16400, 办公: 4800, 其他: 3100 },
    { month: "12月", 差旅: 34200, 餐饮: 7900, 采购: 17800, 办公: 5200, 其他: 3600 },
    { month: "1月", 差旅: 28600, 餐饮: 6500, 采购: 14200, 办公: 3900, 其他: 2400 },
    { month: "2月", 差旅: 26400, 餐饮: 5900, 采购: 13600, 办公: 4100, 其他: 2200 },
    { month: "3月", 差旅: 32600, 餐饮: 6800, 采购: 15800, 办公: 4600, 其他: 2700 },
    { month: "4月", 差旅: 35100, 餐饮: 7200, 采购: 16200, 办公: 4900, 其他: 3100 },
    { month: "5月", 差旅: 35580, 餐饮: 6800, 采购: 16420, 办公: 4200, 其他: 9200 },
  ],
  categoryShare: [
    { category: "差旅", amount: 35580 },
    { category: "采购", amount: 16420 },
    { category: "其他", amount: 9200 },
    { category: "餐饮", amount: 6800 },
    { category: "办公", amount: 4200 },
  ],
  departmentBars: [
    { dept: "销售部", amount: 24800 },
    { dept: "研发部", amount: 18400 },
    { dept: "售后部", amount: 12260 },
    { dept: "质量部", amount: 8200 },
    { dept: "行政部", amount: 5400 },
  ],
  projectTop: [
    { project: "MEDICA 展会样机沟通", amount: 12680 },
    { project: "研发试制批次", amount: 10420 },
    { project: "渠道客户接待", amount: 9200 },
    { project: "北京售后培训", amount: 7820 },
    { project: "德国注册资料准备", amount: 6600 },
  ],
};

export const categoryColors: Record<ExpenseCategory, string> = {
  差旅: "var(--primary)",
  餐饮: "var(--chart-5)",
  采购: "var(--chart-3)",
  办公: "var(--chart-2)",
  其他: "var(--muted-foreground)",
};

export const moduleWarnings = [
  { icon: AlertTriangle, label: "AI 低置信度需人工确认" },
  { icon: BarChart3, label: "月报可自动推送负责人" },
];
