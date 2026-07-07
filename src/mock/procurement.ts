// 采购模块 · 静态演示 mock 数据（初期只做流程页面，无业务逻辑）。
// 人名/物料/分类常量置顶便于会前替换；日期基于固定 DEMO_TODAY，保证「逾期/临期/剩N天」稳定可评审。

// ── 常量：人员 / 分类 / 产品线 ────────────────────────────────────────────────
export const PROC_BUYER = "周敏"; // 采购负责人（占位可改）
export const PROC_RD_CONTACTS = ["包毓飞", "刘至远", "李松"];
export const PROC_REVIEWER = "王林";

/** 复用研发子系统分类。 */
export const PROC_CATEGORIES = [
  "电源部分", "底部结构", "压缩系统", "310阀系统", "风冷系统", "储气系统",
  "210阀系统", "Top结构", "分子筛系统", "外观结构", "配件系统", "气管系统",
  "线束系统", "紧固件系统", "密封系统",
] as const;

export const PROC_PRODUCT_LINES = ["便携式制氧机", "5L直流式制氧机", "正压式呼吸器", "通用"] as const;

/** 演示当日：所有相对日期计算的基准（勿用真实 Date，保证逾期/临期渲染稳定）。 */
export const DEMO_TODAY = "2026-07-03";

// ── 类型 ──────────────────────────────────────────────────────────────────────
export type ProcMethod = "inquiry" | "direct"; // 询价采购 / 电商直购
export type PaymentStatus = "unpaid" | "partial" | "paid";
export type ProcSource = "rd" | "self"; // 研发流转 / 采购自建（任务如何进入采购）
export type BusinessLine = "rd" | "production"; // 业务线：研发 / 生产（采购服务对象，与 source 正交）
export type ProcStatus =
  | "pending_confirm" // 待处理（仅 rd）
  | "pending_inquiry" // 待询价
  | "inquiring" // 询价中
  | "pending_sample" // 待到样
  | "testing" // 测试中
  | "priced" // 已定价
  | "pending_purchase" // 待购买（仅 direct）
  | "in_transit" // 已下单 / 在途
  | "partial_arrival" // 部分到货
  | "completed" // 已完成
  | "cancelled"; // 已取消

export interface ProcLog {
  at: string;
  text: string;
  kind?: "system" | "action";
}

export interface ProcurementTask {
  id: string;
  code: string;
  materialName: string;
  spec: string;
  unit: string;
  quantity: number;
  method: ProcMethod;
  purchaseLink?: string;
  needDate: string;
  deadline?: string;
  expectedArrivalDate?: string;
  paymentDate?: string;
  paymentStatus: PaymentStatus;
  paymentNote?: string; // 如「首付30%已付」
  arrivedQty: number;
  source: ProcSource;
  businessLine: BusinessLine; // 研发 / 生产
  rdTaskTitle?: string;
  buyer: string;
  rdContact?: string;
  requester?: string; // 需求提出人
  requesterDept?: string; // 提出人所在部门
  priority: "high" | "medium" | "low";
  needSample: boolean;
  attachments: number; // 占位数量
  consumableNote?: string; // 低值易耗品备注
  status: ProcStatus;
  logs: ProcLog[];
}

export type MaterialReviewStatus = "pending" | "approved";
export type MaterialReviewSource = "import" | "auto"; // 导入 / 任务沉淀

export interface Material {
  id: string;
  name: string;
  spec: string;
  unit: string;
  category: (typeof PROC_CATEGORIES)[number];
  productLine: (typeof PROC_PRODUCT_LINES)[number];
  erpCode: string;
  isSpecial: boolean;
  reviewStatus: MaterialReviewStatus;
  reviewSource?: MaterialReviewSource;
  stockQty: number;
  latestPrice?: number;
  latestSupplier?: string;
  latestQuoteDate?: string;
}

export interface Quotation {
  materialName: string;
  supplierName: string;
  unitPrice: number;
  leadTimeDays: number;
  quoteDate: string;
  isSelected?: boolean;
}

// ── 采购任务（覆盖全部状态）───────────────────────────────────────────────────
export const PROCUREMENT_TASKS: ProcurementTask[] = [
  {
    id: "PR-010", code: "PR-20260703-010", businessLine: "rd", materialName: "底盖模具镶件", spec: "SKD11 精加工", unit: "件", quantity: 4,
    method: "inquiry", needDate: "2026-07-16", deadline: "2026-07-14", paymentStatus: "unpaid", arrivedQty: 0,
    source: "rd", rdTaskTitle: "底盖模具图完善", buyer: PROC_BUYER, rdContact: "刘至远", requester: "刘至远", requesterDept: "研发部", priority: "high", needSample: false, attachments: 2,
    status: "pending_confirm",
    logs: [{ at: "2026-07-02", text: "由研发任务「底盖模具图完善」流转生成，待采购确认提交" }],
  },
  {
    id: "PR-007", code: "PR-20260703-007", businessLine: "production", materialName: "PU管 φ8", spec: "φ8×5 蓝色", unit: "米", quantity: 100,
    method: "inquiry", needDate: "2026-07-22", deadline: "2026-07-20", paymentStatus: "unpaid", arrivedQty: 0,
    source: "self", buyer: PROC_BUYER, requester: "王建军", requesterDept: "生产部", priority: "low", needSample: false, attachments: 0, consumableNote: "低值易耗品，按年用量备货",
    status: "pending_inquiry",
    logs: [{ at: "2026-07-02", text: "采购自建，待向供应商询价" }],
  },
  {
    id: "PR-002", code: "PR-20260703-002", businessLine: "rd", materialName: "分子筛筛筒 MS-30", spec: "Φ30×120mm 不锈钢", unit: "件", quantity: 200,
    method: "inquiry", needDate: "2026-07-12", deadline: "2026-07-10", paymentStatus: "unpaid", arrivedQty: 0,
    source: "rd", rdTaskTitle: "分子筛筛筒装配间隙核查", buyer: PROC_BUYER, rdContact: "李松", requester: "李松", requesterDept: "研发部", priority: "high", needSample: false, attachments: 1,
    status: "inquiring",
    logs: [{ at: "2026-07-01", text: "研发流转生成" }, { at: "2026-07-02", text: "已录入 3 条供应商报价" }],
  },
  {
    id: "PR-003", code: "PR-20260703-003", businessLine: "rd", materialName: "电池盒上盖硅胶密封圈", spec: "定制 · 邵氏50A", unit: "件", quantity: 500,
    method: "inquiry", needDate: "2026-07-18", deadline: "2026-07-17", paymentStatus: "unpaid", arrivedQty: 0,
    source: "rd", rdTaskTitle: "电池盒样件问题反馈", buyer: PROC_BUYER, rdContact: "包毓飞", requester: "包毓飞", requesterDept: "研发部", priority: "medium", needSample: true, attachments: 2,
    status: "pending_sample",
    logs: [{ at: "2026-06-30", text: "选定华东橡塑并发起打样，待到样" }],
  },
  {
    id: "PR-008", code: "PR-20260703-008", businessLine: "rd", materialName: "TOP板 PCB", spec: "4 层 · 沉金", unit: "件", quantity: 50,
    method: "inquiry", needDate: "2026-07-19", deadline: "2026-07-18", paymentStatus: "unpaid", arrivedQty: 0,
    source: "rd", rdTaskTitle: "TOP板控制逻辑验证", buyer: PROC_BUYER, rdContact: "李松", requester: "李松", requesterDept: "研发部", priority: "medium", needSample: true, attachments: 1,
    status: "testing",
    logs: [{ at: "2026-06-28", text: "样品已到，研发测试中" }],
  },
  {
    id: "PR-004", code: "PR-20260703-004", businessLine: "rd", materialName: "无油活塞环", spec: "Φ42 · 石墨填充", unit: "件", quantity: 1000,
    method: "inquiry", needDate: "2026-07-24", deadline: "2026-07-25", paymentStatus: "unpaid", arrivedQty: 0,
    source: "self", buyer: PROC_BUYER, requester: PROC_BUYER, requesterDept: "采购部", priority: "medium", needSample: true, attachments: 0,
    status: "priced",
    logs: [{ at: "2026-06-26", text: "测试通过，已定价，待下单" }],
  },
  {
    id: "PR-006", code: "PR-20260703-006", businessLine: "production", materialName: "湿化瓶接头", spec: "PC 透明 · 快插", unit: "件", quantity: 300,
    method: "direct", purchaseLink: "https://mall.example.com/item/humidifier-joint", needDate: "2026-07-06", deadline: "2026-07-05", paymentStatus: "unpaid", arrivedQty: 0,
    source: "self", buyer: PROC_BUYER, requester: "王建军", requesterDept: "生产部", priority: "high", needSample: false, attachments: 0, consumableNote: "低值易耗品",
    status: "pending_purchase",
    logs: [{ at: "2026-07-02", text: "电商直购，待下单购买" }],
  },
  {
    id: "PR-005", code: "PR-20260703-005", businessLine: "production", materialName: "散热风扇 9225", spec: "92×92×25mm 12V", unit: "个", quantity: 1000,
    method: "direct", purchaseLink: "https://mall.example.com/item/fan-9225", needDate: "2026-07-10", expectedArrivalDate: "2026-07-08", paymentDate: "2026-07-04", paymentStatus: "paid", arrivedQty: 0,
    source: "self", buyer: PROC_BUYER, requester: "赵天成", requesterDept: "生产部", priority: "medium", needSample: false, attachments: 0,
    status: "in_transit",
    logs: [{ at: "2026-07-03", text: "已下单，在途" }],
  },
  {
    id: "PR-011", code: "PR-20260703-011", businessLine: "production", materialName: "压缩机阀片", spec: "0.15mm 弹簧钢", unit: "件", quantity: 500,
    method: "inquiry", needDate: "2026-06-28", expectedArrivalDate: "2026-06-30", paymentDate: "2026-06-25", paymentStatus: "paid", arrivedQty: 0,
    source: "self", buyer: PROC_BUYER, requester: "王建军", requesterDept: "生产部", priority: "high", needSample: false, attachments: 0,
    status: "in_transit",
    logs: [{ at: "2026-06-25", text: "已下单，在途（预计到货已逾期）" }],
  },
  {
    id: "PR-001", code: "PR-20260703-001", businessLine: "rd", materialName: "减震垫 DZC-950", spec: "50×20mm 橡胶", unit: "件", quantity: 2000,
    method: "inquiry", needDate: "2026-07-16", expectedArrivalDate: "2026-07-15", paymentDate: "2026-07-01", paymentStatus: "partial", paymentNote: "首付 30% 已付", arrivedQty: 800,
    source: "rd", rdTaskTitle: "新压缩机950减震垫选型", buyer: PROC_BUYER, rdContact: "包毓飞", requester: "包毓飞", requesterDept: "研发部", priority: "high", needSample: true, attachments: 2,
    status: "partial_arrival",
    logs: [{ at: "2026-06-20", text: "选定苏州澎润并签约" }, { at: "2026-06-28", text: "第1批到货 +800" }],
  },
  {
    id: "PR-009", code: "PR-20260703-009", businessLine: "production", materialName: "硅胶管 φ6", spec: "φ6×2 医用级", unit: "米", quantity: 5000,
    method: "inquiry", needDate: "2026-06-10", expectedArrivalDate: "2026-06-24", paymentDate: "2026-06-24", paymentStatus: "paid", arrivedQty: 5000,
    source: "self", buyer: PROC_BUYER, requester: "赵天成", requesterDept: "生产部", priority: "low", needSample: false, attachments: 0,
    status: "completed",
    logs: [{ at: "2026-06-24", text: "全部到货，已完成" }],
  },
];

/** 需求提出人：优先取显式 requester；研发流转回退研发对接人，自建回退采购负责人。 */
export function taskRequester(task: ProcurementTask): { name: string; dept: string } {
  return {
    name: task.requester ?? task.rdContact ?? task.buyer,
    dept: task.requesterDept ?? (task.source === "rd" ? "研发部" : "采购部"),
  };
}

// ── 物料（跨分类，与任务数字自洽）─────────────────────────────────────────────
export const MATERIALS: Material[] = [
  { id: "M-001", name: "减震垫 DZC-950", spec: "50×20mm 橡胶", unit: "件", category: "压缩系统", productLine: "便携式制氧机", erpCode: "ERP-CY-0950", isSpecial: false, reviewStatus: "approved", stockQty: 1240, latestPrice: 3.5, latestSupplier: "苏州澎润", latestQuoteDate: "2026-06-20" },
  { id: "M-002", name: "分子筛筛筒 MS-30", spec: "Φ30×120mm 不锈钢", unit: "件", category: "分子筛系统", productLine: "便携式制氧机", erpCode: "ERP-FZS-0030", isSpecial: false, reviewStatus: "approved", stockQty: 0, latestPrice: 11.8, latestSupplier: "宁波恒力", latestQuoteDate: "2026-07-02" },
  { id: "M-003", name: "压缩机阀片", spec: "0.15mm 弹簧钢", unit: "件", category: "310阀系统", productLine: "便携式制氧机", erpCode: "ERP-310-0015", isSpecial: false, reviewStatus: "approved", stockQty: 320, latestPrice: 0.6, latestSupplier: "宁波恒力", latestQuoteDate: "2026-06-22" },
  { id: "M-004", name: "无油活塞环", spec: "Φ42 · 石墨填充", unit: "件", category: "压缩系统", productLine: "5L直流式制氧机", erpCode: "ERP-CY-0042", isSpecial: false, reviewStatus: "approved", stockQty: 150, latestPrice: 5.6, latestSupplier: "宁波恒力", latestQuoteDate: "2026-06-24" },
  { id: "M-005", name: "散热风扇 9225", spec: "92×92×25mm 12V", unit: "个", category: "风冷系统", productLine: "5L直流式制氧机", erpCode: "ERP-FL-9225", isSpecial: false, reviewStatus: "approved", stockQty: 200, latestPrice: 8.2, latestSupplier: "深圳风华", latestQuoteDate: "2026-06-22" },
  { id: "M-006", name: "电池 PD 电源板", spec: "定制 · 65W", unit: "块", category: "电源部分", productLine: "便携式制氧机", erpCode: "ERP-DY-0065", isSpecial: false, reviewStatus: "approved", stockQty: 88, latestPrice: 42.0, latestSupplier: "深圳风华", latestQuoteDate: "2026-06-15" },
  { id: "M-007", name: "TOP板 PCB", spec: "4 层 · 沉金", unit: "件", category: "Top结构", productLine: "便携式制氧机", erpCode: "ERP-TOP-0004", isSpecial: false, reviewStatus: "approved", stockQty: 60, latestPrice: 18.5, latestSupplier: "昆山塑胶", latestQuoteDate: "2026-06-18" },
  { id: "M-008", name: "底盖模具镶件", spec: "SKD11 精加工", unit: "件", category: "底部结构", productLine: "通用", erpCode: "ERP-DB-0011", isSpecial: false, reviewStatus: "approved", stockQty: 12, latestPrice: 260.0, latestSupplier: "东莞精密", latestQuoteDate: "2026-05-30" },
  { id: "M-009", name: "湿化瓶接头", spec: "PC 透明 · 快插", unit: "件", category: "配件系统", productLine: "正压式呼吸器", erpCode: "ERP-PJ-0001", isSpecial: false, reviewStatus: "approved", stockQty: 500, latestPrice: 1.2, latestSupplier: "苏州澎润", latestQuoteDate: "2026-06-10" },
  { id: "M-010", name: "PU管 φ8", spec: "φ8×5 蓝色", unit: "米", category: "气管系统", productLine: "通用", erpCode: "ERP-QG-0008", isSpecial: true, reviewStatus: "approved", stockQty: 800, latestPrice: 1.8, latestSupplier: "华东橡塑", latestQuoteDate: "2026-06-12" },
  { id: "M-011", name: "主线束", spec: "定制 · UL1007", unit: "套", category: "线束系统", productLine: "5L直流式制氧机", erpCode: "ERP-XS-0001", isSpecial: true, reviewStatus: "pending", reviewSource: "import", stockQty: 40, latestPrice: 12.0, latestSupplier: "常州线缆", latestQuoteDate: "2026-06-20" },
  { id: "M-012", name: "硅胶管 φ6", spec: "φ6×2 医用级", unit: "米", category: "气管系统", productLine: "通用", erpCode: "ERP-QG-0006", isSpecial: false, reviewStatus: "approved", stockQty: 5000, latestPrice: 2.1, latestSupplier: "华东橡塑", latestQuoteDate: "2026-06-12" },
  { id: "M-013", name: "电池盒上盖硅胶密封圈", spec: "定制 · 邵氏50A", unit: "件", category: "密封系统", productLine: "便携式制氧机", erpCode: "ERP-MF-0001", isSpecial: false, reviewStatus: "pending", reviewSource: "auto", stockQty: 0, latestPrice: 0.85, latestSupplier: "华东橡塑", latestQuoteDate: "2026-06-30" },
];

// ── 历史报价（价格对比演示）────────────────────────────────────────────────────
export const QUOTATIONS: Quotation[] = [
  // 硅胶管 φ6 · 5 条跨供应商递降
  { materialName: "硅胶管 φ6", supplierName: "华东橡塑", unitPrice: 2.6, leadTimeDays: 12, quoteDate: "2025-08-15" },
  { materialName: "硅胶管 φ6", supplierName: "宁波恒力", unitPrice: 2.45, leadTimeDays: 15, quoteDate: "2025-11-20" },
  { materialName: "硅胶管 φ6", supplierName: "华东橡塑", unitPrice: 2.35, leadTimeDays: 12, quoteDate: "2026-02-10" },
  { materialName: "硅胶管 φ6", supplierName: "苏州澎润", unitPrice: 2.28, leadTimeDays: 10, quoteDate: "2026-04-18" },
  { materialName: "硅胶管 φ6", supplierName: "华东橡塑", unitPrice: 2.1, leadTimeDays: 12, quoteDate: "2026-06-12" },
  // 减震垫 DZC-950 · 3 条（PR-001 询价中所用）
  { materialName: "减震垫 DZC-950", supplierName: "华东橡塑", unitPrice: 3.8, leadTimeDays: 10, quoteDate: "2026-06-18" },
  { materialName: "减震垫 DZC-950", supplierName: "宁波恒力", unitPrice: 4.2, leadTimeDays: 7, quoteDate: "2026-06-18" },
  { materialName: "减震垫 DZC-950", supplierName: "苏州澎润", unitPrice: 3.5, leadTimeDays: 12, quoteDate: "2026-06-18", isSelected: true },
  // 分子筛筛筒 MS-30 · 3 条（PR-002 询价中）
  { materialName: "分子筛筛筒 MS-30", supplierName: "华东橡塑", unitPrice: 12.5, leadTimeDays: 12, quoteDate: "2026-07-02" },
  { materialName: "分子筛筛筒 MS-30", supplierName: "宁波恒力", unitPrice: 11.8, leadTimeDays: 15, quoteDate: "2026-07-02" },
  { materialName: "分子筛筛筒 MS-30", supplierName: "苏州澎润", unitPrice: 13.0, leadTimeDays: 8, quoteDate: "2026-07-02" },
];

// ── 日期 / 汇总助手（相对 DEMO_TODAY）─────────────────────────────────────────
const ONE_DAY = 24 * 3600 * 1000;
/** 相对 DEMO_TODAY 的天数差：正=未来剩 N 天，负=已逾期 N 天。 */
export function daysFromDemoToday(dateStr?: string): number | null {
  if (!dateStr) return null;
  const t = Date.parse(`${dateStr}T00:00:00`);
  const base = Date.parse(`${DEMO_TODAY}T00:00:00`);
  if (Number.isNaN(t) || Number.isNaN(base)) return null;
  return Math.round((t - base) / ONE_DAY);
}

/** 已下单及之后显示「预计到货」，之前显示「Deadline / 需求日期」。 */
const ARRIVAL_STATUSES: ProcStatus[] = ["in_transit", "partial_arrival", "completed"];
export function taskMainDate(task: ProcurementTask): { label: string; date?: string; days: number | null } {
  if (ARRIVAL_STATUSES.includes(task.status)) {
    return { label: "预计到货", date: task.expectedArrivalDate, days: daysFromDemoToday(task.expectedArrivalDate) };
  }
  const date = task.deadline ?? task.needDate;
  return { label: task.deadline ? "Deadline" : "需求日期", date, days: daysFromDemoToday(date) };
}

/** 物料汇总：在途量 / 关联任务数 由任务实时计算，保证两页自洽。 */
export function materialAggregates(materialName: string): { inTransit: number; taskCount: number } {
  let inTransit = 0;
  let taskCount = 0;
  for (const t of PROCUREMENT_TASKS) {
    if (t.materialName !== materialName) continue;
    taskCount += 1;
    if (t.status === "in_transit" || t.status === "partial_arrival") {
      inTransit += Math.max(0, t.quantity - t.arrivedQty);
    }
  }
  return { inTransit, taskCount };
}
