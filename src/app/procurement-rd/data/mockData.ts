// 采购与研发协同 · 演示原型 mock 数据。人名/物料/供应商集中在此，便于会前替换。
import type {
  Contract,
  PriceHistoryRow,
  Requirement,
  RdTask,
  ReviewItem,
  Supplier,
} from "./types";

// ── 人员（沿用现有系统团队名）───────────────────────────────────────────────
export const RD_PEOPLE = ["包毓飞", "刘至远", "李松", "顾磊", "裴奥文"];
export const PURCHASER = "周敏"; // 采购负责人（占位名，会前可改）
export const CURRENT_USER = "超级管理员";

export const SUPPLIERS = ["华东橡塑", "宁波恒力", "苏州澎润", "深圳风华"];

const T = "2026-07-03"; // 演示当日

// ── 研发任务卡（场景1）──────────────────────────────────────────────────────
export function buildRdTasks(): RdTask[] {
  return [
    {
      id: "RD-950-DZ",
      title: "新压缩机950减震垫选型",
      owner: "包毓飞",
      priority: "high",
      statusText: "进行中",
      due: "2026-07-20",
      isMain: true,
      tags: ["选型", "压缩机"],
      desc: "针对新压缩机 950 机型的振动噪声问题，选型合适的橡胶减震垫（DZ-950，50×20mm），需完成供应商选样、装机测试与定价，目标 7 月底前定点。",
      relatedRequirementId: undefined,
      timeline: [
        { id: "t1", at: "2026-06-28", text: "创建任务并上传结构图纸", kind: "rd" },
        { id: "t2", at: "2026-07-01", text: "完成减震垫规格初步确认：50×20mm 橡胶", kind: "rd" },
      ],
    },
    {
      id: "RD-BAT-01",
      title: "电池盒样件问题反馈",
      owner: "刘至远",
      priority: "medium",
      statusText: "进行中",
      due: "2026-07-15",
      desc: "电池盒上盖密封圈样件出现装配后回弹、密封面渗漏问题，需复核胶料硬度与结构公差，并推动供应商重新打样。",
      relatedRequirementId: "PR-003",
      timeline: [
        { id: "b1", at: "2026-06-27", text: "记录样件密封渗漏问题并拍照留档", kind: "rd" },
        { id: "b2", at: "2026-06-29", text: "已提交采购发起密封圈打样需求", kind: "proc" },
      ],
    },
    {
      id: "RD-MS-30",
      title: "分子筛筛筒装配间隙核查",
      owner: "李松",
      priority: "medium",
      statusText: "进行中",
      due: "2026-07-18",
      desc: "核查分子筛筛筒 MS-30 与外壳的装配间隙，确认公差链，评估是否需要调整筛筒外径或采购不同批次料件。",
      relatedRequirementId: "PR-002",
      timeline: [
        { id: "m1", at: "2026-06-30", text: "完成装配间隙测量，超出设计上限 0.15mm", kind: "rd" },
        { id: "m2", at: "2026-07-01", text: "已转采购询价 3 家供应商，进入报价对比", kind: "proc" },
      ],
    },
    {
      id: "RD-COVER",
      title: "大外罩散热方案复核",
      owner: "顾磊",
      priority: "low",
      statusText: "进行中",
      due: "2026-07-22",
      desc: "复核大外罩在满载工况下的散热能力，评估增开散热孔位与更换散热风扇的方案可行性。",
      timeline: [{ id: "c1", at: "2026-06-30", text: "完成热仿真，最高温升 42K，接近上限", kind: "rd" }],
    },
    {
      id: "RD-3W",
      title: "减3W压缩机续航测试",
      owner: "裴奥文",
      priority: "medium",
      statusText: "测试中",
      due: "2026-07-16",
      desc: "对减 3W 压缩机进行连续续航与噪声测试，采集样机运行数据，验证功耗与振动是否满足新机型要求。",
      timeline: [
        { id: "w1", at: "2026-07-01", text: "启动 72 小时连续运行测试", kind: "rd" },
        { id: "w2", at: "2026-07-02", text: "阶段数据：功耗达标，振动待复测", kind: "rd" },
      ],
    },
    {
      id: "RD-SIEVE",
      title: "筛筒与筛盖设计调整",
      owner: "李松",
      priority: "low",
      statusText: "待评审",
      due: "2026-07-25",
      desc: "根据装配间隙核查结论，调整筛筒与筛盖的配合结构与卡扣设计，输出改版图纸待评审。",
      timeline: [{ id: "s1", at: "2026-07-02", text: "输出筛盖改版结构草图，待评审", kind: "rd" }],
    },
  ];
}

// ── 采购需求单预置（场景2）──────────────────────────────────────────────────
// 主线 001 在演示中动态生成，初始不预置。
export function buildRequirements(): Requirement[] {
  return [
    {
      id: "PR-002",
      code: "PR-20260703-002",
      materialName: "分子筛筛筒 MS-30",
      spec: "Φ30×120mm 不锈钢",
      quantity: 200,
      unit: "件",
      expectedDate: "2026-07-20",
      source: "rd",
      owner: PURCHASER,
      rdContact: "李松",
      status: "inquiring",
      relatedRdTaskId: "RD-MS-30",
      hasAttachment: true,
      selectedQuoteId: undefined,
      quotes: [
        { id: "q-002-1", supplier: "华东橡塑", unitPrice: 12.5, leadDays: 12, createdAt: "2026-07-02" },
        { id: "q-002-2", supplier: "宁波恒力", unitPrice: 11.8, leadDays: 15, createdAt: "2026-07-02" },
        { id: "q-002-3", supplier: "苏州澎润", unitPrice: 13.0, leadDays: 8, createdAt: "2026-07-02" },
      ],
      logs: [
        { id: "l1", at: "2026-07-01", text: "由研发任务流转生成需求单" },
        { id: "l2", at: "2026-07-02", text: "已录入 3 条供应商报价，进入询价对比" },
      ],
      createdAt: "2026-07-01",
      updatedAt: "2026-07-02",
    },
    {
      id: "PR-003",
      code: "PR-20260703-003",
      materialName: "电池盒上盖硅胶密封圈",
      spec: "定制 · 邵氏50A",
      quantity: 500,
      unit: "件",
      expectedDate: "2026-07-18",
      source: "rd",
      owner: PURCHASER,
      rdContact: "刘至远",
      status: "pending_sample",
      relatedRdTaskId: "RD-BAT-01",
      hasAttachment: true,
      quotes: [
        { id: "q-003-1", supplier: "华东橡塑", unitPrice: 0.85, leadDays: 10, createdAt: "2026-06-30", selected: true, requestedSample: true },
        { id: "q-003-2", supplier: "苏州澎润", unitPrice: 0.92, leadDays: 7, createdAt: "2026-06-30" },
      ],
      selectedQuoteId: "q-003-1",
      logs: [
        { id: "l1", at: "2026-06-29", text: "由研发任务流转生成需求单" },
        { id: "l2", at: "2026-06-30", text: "选定华东橡塑报价并发起打样" },
      ],
      createdAt: "2026-06-29",
      updatedAt: "2026-06-30",
    },
    {
      id: "PR-004",
      code: "PR-20260703-004",
      materialName: "无油活塞环",
      spec: "Φ42 · 石墨填充",
      quantity: 1000,
      unit: "件",
      expectedDate: "2026-07-25",
      source: "self",
      owner: PURCHASER,
      status: "priced",
      quotes: [
        { id: "q-004-1", supplier: "宁波恒力", unitPrice: 5.6, leadDays: 20, createdAt: "2026-06-20", selected: true, requestedSample: true },
      ],
      selectedQuoteId: "q-004-1",
      testConclusion: "测试通过，定点宁波恒力",
      logs: [{ id: "l1", at: "2026-06-25", text: "测试通过，已定价" }],
      createdAt: "2026-06-18",
      updatedAt: "2026-06-25",
    },
    {
      id: "PR-005",
      code: "PR-20260703-005",
      materialName: "散热风扇 9225",
      spec: "92×92×25mm 12V",
      quantity: 1000,
      unit: "个",
      expectedDate: "2026-07-28",
      source: "self",
      owner: PURCHASER,
      status: "pending_contract",
      relatedContractId: "HT-2026-002",
      quotes: [
        { id: "q-005-1", supplier: "深圳风华", unitPrice: 8.2, leadDays: 14, createdAt: "2026-06-22", selected: true, requestedSample: true },
      ],
      selectedQuoteId: "q-005-1",
      testConclusion: "测试通过，关联合同 HT-2026-002",
      logs: [{ id: "l1", at: "2026-06-26", text: "测试通过并进入合同流程" }],
      createdAt: "2026-06-20",
      updatedAt: "2026-06-26",
    },
    {
      id: "PR-006",
      code: "PR-20260703-006",
      materialName: "湿化瓶接头",
      spec: "PC 透明 · 快插",
      quantity: 300,
      unit: "件",
      expectedDate: "2026-07-30",
      source: "self",
      owner: PURCHASER,
      status: "draft",
      quotes: [],
      logs: [{ id: "l1", at: T, text: "采购自建草稿，待补全提交" }],
      createdAt: T,
      updatedAt: T,
    },
    {
      id: "PR-007", code: "PR-20260703-007", materialName: "铜编织带", spec: "20mm² 镀锡", quantity: 300, unit: "根",
      expectedDate: "2026-07-24", source: "self", owner: PURCHASER, status: "inquiring",
      quotes: [
        { id: "q-007-1", supplier: "广州铜业", unitPrice: 6.4, leadDays: 10, createdAt: "2026-07-01" },
        { id: "q-007-2", supplier: "常州线缆", unitPrice: 6.8, leadDays: 8, createdAt: "2026-07-01" },
      ],
      logs: [{ id: "l1", at: "2026-07-01", text: "录入 2 条报价，进入询价对比" }], createdAt: "2026-06-30", updatedAt: "2026-07-01",
    },
    {
      id: "PR-008", code: "PR-20260703-008", materialName: "电源线束", spec: "定制 · UL1007", quantity: 800, unit: "套",
      expectedDate: "2026-08-05", source: "self", owner: PURCHASER, status: "pending_inquiry",
      quotes: [], logs: [{ id: "l1", at: "2026-07-02", text: "已提交，待供应商报价" }], createdAt: "2026-07-01", updatedAt: "2026-07-02",
    },
    {
      id: "PR-009", code: "PR-20260703-009", materialName: "大外罩注塑件", spec: "ABS 阻燃", quantity: 1500, unit: "件",
      expectedDate: "2026-08-10", source: "rd", owner: PURCHASER, rdContact: "顾磊", status: "pending_sample", relatedRdTaskId: "RD-COVER", hasAttachment: true,
      quotes: [
        { id: "q-009-1", supplier: "昆山塑胶", unitPrice: 9.5, leadDays: 18, createdAt: "2026-06-28", selected: true, requestedSample: true },
        { id: "q-009-2", supplier: "苏州澎润", unitPrice: 10.2, leadDays: 14, createdAt: "2026-06-28" },
      ],
      selectedQuoteId: "q-009-1", logs: [{ id: "l1", at: "2026-06-28", text: "选定昆山塑胶并发起打样" }], createdAt: "2026-06-26", updatedAt: "2026-06-28",
    },
    {
      id: "PR-010", code: "PR-20260703-010", materialName: "压缩机脚垫", spec: "丁腈橡胶 60A", quantity: 2000, unit: "件",
      expectedDate: "2026-07-26", source: "self", owner: PURCHASER, status: "priced",
      quotes: [{ id: "q-010-1", supplier: "华东橡塑", unitPrice: 1.2, leadDays: 10, createdAt: "2026-06-24", selected: true, requestedSample: true }],
      selectedQuoteId: "q-010-1", testConclusion: "测试通过，定点华东橡塑", logs: [{ id: "l1", at: "2026-06-26", text: "测试通过，已定价" }], createdAt: "2026-06-22", updatedAt: "2026-06-26",
    },
    {
      id: "PR-011", code: "PR-20260703-011", materialName: "湿化瓶密封垫", spec: "医用硅胶", quantity: 1200, unit: "件",
      expectedDate: "2026-08-12", source: "self", owner: PURCHASER, status: "draft",
      quotes: [], logs: [{ id: "l1", at: T, text: "采购自建草稿，待补全提交" }], createdAt: T, updatedAt: T,
    },
    {
      id: "PR-012", code: "PR-20260703-012", materialName: "铝散热片", spec: "6063-T5 阳极氧化", quantity: 5000, unit: "件",
      expectedDate: "2026-08-15", source: "self", owner: PURCHASER, status: "pending_contract", relatedContractId: "HT-2026-004",
      quotes: [{ id: "q-012-1", supplier: "无锡热管", unitPrice: 3.1, leadDays: 20, createdAt: "2026-06-20", selected: true, requestedSample: true }],
      selectedQuoteId: "q-012-1", testConclusion: "测试通过，关联合同 HT-2026-004", logs: [{ id: "l1", at: "2026-06-27", text: "测试通过并进入合同流程" }], createdAt: "2026-06-19", updatedAt: "2026-06-27",
    },
  ];
}

// ── 合同台账预置（场景5）────────────────────────────────────────────────────
export function buildContracts(): Contract[] {
  return [
    {
      id: "HT-2026-001",
      code: "HT-2026-001",
      supplier: "苏州澎润",
      materialName: "减震垫 DZ-950",
      quantity: 2000,
      delivered: 0,
      amount: 7000,
      contractApproval: "approving",
      paymentApproval: "none",
      deliveries: [],
      payments: [],
      deliveryPlan: [800, 1200], // 演示中依次注入
      relatedRequirementId: "PR-001",
      updatedAt: T,
    },
    {
      id: "HT-2026-002",
      code: "HT-2026-002",
      supplier: "深圳风华",
      materialName: "散热风扇 9225",
      quantity: 1000,
      delivered: 400,
      amount: 8200,
      contractApproval: "effective",
      paymentApproval: "partial",
      deliveries: [{ batch: "第1批", date: "2026-06-28", qty: 400, operator: "仓管·王芳" }],
      payments: [{ label: "首付款", ratio: "30%", amount: 2460, status: "approved" }],
      deliveryPlan: [600],
      relatedRequirementId: "PR-005",
      updatedAt: "2026-06-28",
    },
    {
      id: "HT-2026-003",
      code: "HT-2026-003",
      supplier: "华东橡塑",
      materialName: "硅胶管 φ6",
      quantity: 5000,
      delivered: 5000,
      amount: 10500,
      contractApproval: "effective",
      paymentApproval: "approved",
      deliveries: [
        { batch: "第1批", date: "2026-06-10", qty: 3000, operator: "仓管·王芳" },
        { batch: "第2批", date: "2026-06-24", qty: 2000, operator: "仓管·王芳" },
      ],
      payments: [{ label: "全额付款", ratio: "100%", amount: 10500, status: "approved" }],
      deliveryPlan: [],
      relatedRequirementId: undefined,
      updatedAt: "2026-06-24",
    },
    {
      id: "HT-2026-004", code: "HT-2026-004", supplier: "无锡热管", materialName: "铝散热片", quantity: 5000, delivered: 0, amount: 15500,
      contractApproval: "approving", paymentApproval: "none", deliveries: [], payments: [], deliveryPlan: [2000, 3000], relatedRequirementId: "PR-012", updatedAt: T,
    },
    {
      id: "HT-2026-005", code: "HT-2026-005", supplier: "常州线缆", materialName: "电源线束", quantity: 800, delivered: 300, amount: 6400,
      contractApproval: "effective", paymentApproval: "partial", deliveries: [{ batch: "第1批", date: "2026-06-30", qty: 300, operator: "仓管·王芳" }], payments: [{ label: "首付款", ratio: "30%", amount: 1920, status: "approved" }], deliveryPlan: [500], relatedRequirementId: undefined, updatedAt: "2026-06-30",
    },
    {
      id: "HT-2026-006", code: "HT-2026-006", supplier: "宁波恒力", materialName: "分子筛筛筒 MS-30", quantity: 2000, delivered: 2000, amount: 23600,
      contractApproval: "effective", paymentApproval: "approved", deliveries: [{ batch: "第1批", date: "2026-06-15", qty: 1000, operator: "仓管·王芳" }, { batch: "第2批", date: "2026-06-28", qty: 1000, operator: "仓管·王芳" }], payments: [{ label: "全额付款", ratio: "100%", amount: 23600, status: "approved" }], deliveryPlan: [], relatedRequirementId: undefined, updatedAt: "2026-06-28",
    },
    {
      id: "HT-2026-007", code: "HT-2026-007", supplier: "华东橡塑", materialName: "压缩机脚垫", quantity: 2000, delivered: 0, amount: 2400,
      contractApproval: "approving", paymentApproval: "none", deliveries: [], payments: [], deliveryPlan: [1000, 1000], relatedRequirementId: "PR-010", updatedAt: T,
    },
    {
      id: "HT-2026-008", code: "HT-2026-008", supplier: "广州铜业", materialName: "铜编织带", quantity: 300, delivered: 150, amount: 1920,
      contractApproval: "effective", paymentApproval: "partial", deliveries: [{ batch: "第1批", date: "2026-06-29", qty: 150, operator: "仓管·王芳" }], payments: [{ label: "首付款", ratio: "50%", amount: 960, status: "approved" }], deliveryPlan: [150], relatedRequirementId: undefined, updatedAt: "2026-06-29",
    },
  ];
}

// ── 供应商档案（基础数据 · 可维护）──────────────────────────────────────────
export function buildSuppliers(): Supplier[] {
  return [
    { id: "S-001", name: "华东橡塑", category: "橡胶 / 密封件", contact: "张建国", phone: "138-0000-1001", address: "上海市松江区工业园 12 号", rating: 5, certExpiry: "2027-03-31", cooperationYears: 4, status: "active", materials: ["减震垫 DZ-950", "硅胶管 φ6", "密封圈"], note: "长期合作，交期稳定，价格有优势" },
    { id: "S-002", name: "宁波恒力", category: "金属结构件", contact: "李慧敏", phone: "138-0000-1002", address: "浙江省宁波市北仑区滨海大道 88 号", rating: 4, certExpiry: "2026-12-31", cooperationYears: 3, status: "active", materials: ["无油活塞环", "分子筛筛筒 MS-30"], note: "结构件精度高，交期偏长" },
    { id: "S-003", name: "苏州澎润", category: "橡胶 / 注塑", contact: "王涛", phone: "138-0000-1003", address: "江苏省苏州市工业园区星湖街 66 号", rating: 4, certExpiry: "2027-06-30", cooperationYears: 2, status: "active", materials: ["减震垫 DZ-950", "湿化瓶接头"], note: "打样响应快，新引入供应商" },
    { id: "S-004", name: "深圳风华", category: "电子 / 散热", contact: "陈晓芸", phone: "138-0000-1004", address: "广东省深圳市宝安区福永街道 5 栋", rating: 5, certExpiry: "2026-09-30", cooperationYears: 5, status: "review", materials: ["散热风扇 9225"], note: "资质将到期，需在 9 月底前完成再评定" },
    { id: "S-005", name: "昆山塑胶", category: "注塑 / 结构件", contact: "赵敏", phone: "138-0000-1005", address: "江苏省昆山市开发区前进路 18 号", rating: 4, certExpiry: "2027-05-31", cooperationYears: 2, status: "active", materials: ["大外罩注塑件"], note: "大件注塑能力强" },
    { id: "S-006", name: "常州线缆", category: "线束 / 线材", contact: "孙浩", phone: "138-0000-1006", address: "江苏省常州市武进区龙城大道 200 号", rating: 4, certExpiry: "2027-02-28", cooperationYears: 3, status: "active", materials: ["电源线束", "铜编织带"] },
    { id: "S-007", name: "广州铜业", category: "铜材 / 导电件", contact: "周琳", phone: "138-0000-1007", address: "广东省广州市黄埔区科学城 9 号", rating: 3, certExpiry: "2026-11-30", cooperationYears: 1, status: "review", materials: ["铜编织带"], note: "新引入，待首批质量评定" },
    { id: "S-008", name: "无锡热管", category: "散热 / 铝材", contact: "吴敏杰", phone: "138-0000-1008", address: "江苏省无锡市新吴区菱湖大道 111 号", rating: 5, certExpiry: "2027-08-31", cooperationYears: 4, status: "active", materials: ["铝散热片"] },
    { id: "S-009", name: "东莞精密", category: "金属结构件", contact: "郑凯", phone: "138-0000-1009", address: "广东省东莞市长安镇振安路 33 号", rating: 4, certExpiry: "2027-04-30", cooperationYears: 3, status: "active", materials: ["无油活塞环", "压缩机脚垫"] },
    { id: "S-010", name: "佛山密封", category: "橡胶 / 密封件", contact: "冯洁", phone: "138-0000-1010", address: "广东省佛山市南海区狮山镇工业大道 7 号", rating: 2, certExpiry: "2026-08-15", cooperationYears: 1, status: "disabled", materials: ["密封圈"], note: "近期来料合格率偏低，暂停合作" },
  ];
}

// ── 物料历史价格（场景4 · 硅胶管 φ6）────────────────────────────────────────
export const PRICE_HISTORY_MATERIAL = "硅胶管 φ6";
export function buildPriceHistory(): PriceHistoryRow[] {
  return [
    { id: "ph1", material: PRICE_HISTORY_MATERIAL, supplier: "华东橡塑", unitPrice: 2.6, leadDays: 12, date: "2025-08-15" },
    { id: "ph2", material: PRICE_HISTORY_MATERIAL, supplier: "宁波恒力", unitPrice: 2.45, leadDays: 15, date: "2025-11-20" },
    { id: "ph3", material: PRICE_HISTORY_MATERIAL, supplier: "华东橡塑", unitPrice: 2.35, leadDays: 12, date: "2026-02-10" },
    { id: "ph4", material: PRICE_HISTORY_MATERIAL, supplier: "苏州澎润", unitPrice: 2.28, leadDays: 10, date: "2026-04-18" },
    { id: "ph5", material: PRICE_HISTORY_MATERIAL, supplier: "华东橡塑", unitPrice: 2.1, leadDays: 12, date: "2026-06-12" },
  ];
}

// ── 评审模式「待确认」事项（场景3 会议核心道具）──────────────────────────────
export const REVIEW_ITEMS: ReviewItem[] = [
  { key: "①", label: "待确认①", title: "研发转采购的流程节点是否完整", text: "从「研发提出需求 → 出图 → 转采购询价 → 到样通知研发 → 研发测试 → 定价 → 合同签订（企微审批）→ 付款 → 分批到货 → 完成」，请各部门确认流程节点是否覆盖实际业务，有无遗漏或需要合并的环节。" },
  { key: "②", label: "待确认②", title: "每个流程节点的责任人是否明确", text: "各节点责任人（研发负责人 / 采购负责人 / 研发对接人 / 财务）是否与实际分工一致？跨节点交接（如到样通知、测试反馈）由谁发起、谁接收，请确认。" },
  { key: "③", label: "待确认③", title: "合同审批、付款审批是否都接入企业微信", text: "合同审批与付款审批均计划接入企业微信审批流，审批结果回调后系统自动更新状态。请确认审批入口、审批人配置与回调口径。" },
  { key: "④", label: "待确认④", title: "数量计算方式（合同−已到货=在途）是否确认", text: "剩余在途数量 = 合同数量 − 已到货数量，按分批入库累加已到货。请确认该口径，以及是否需要区分「已入库」与「在途未入库」。" },
  { key: "⑤", label: "待确认⑤", title: "物料历史报价是否需要按供应商对比", text: "同一物料的历史报价支持按供应商分组、按时间/单价排序对比，并在询价时提示历史最低价与最近价。请确认该对比维度是否满足采购议价需要。" },
  { key: "⑥", label: "待确认⑥", title: "其他需要补充的流程或字段", text: "除以上流程与字段外，是否还有需要补充的环节、字段或对接系统？会上口头收集补充意见。" },
];
