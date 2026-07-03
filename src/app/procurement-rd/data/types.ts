// 采购与研发协同 · 演示原型数据类型（纯前端内存 mock，无后端）。

export type ReqStatus =
  | "draft" // 草稿
  | "pending_inquiry" // 待询价
  | "inquiring" // 询价中
  | "pending_sample" // 待到样
  | "testing" // 测试中
  | "priced" // 已定价
  | "pending_contract"; // 待签合同

export type ReqSource = "rd" | "self"; // 研发流转 / 采购自建

export interface Quote {
  id: string;
  supplier: string;
  unitPrice: number;
  leadDays: number;
  createdAt: string;
  selected?: boolean;
  requestedSample?: boolean;
}

export interface ProcLog {
  id: string;
  at: string;
  text: string;
  kind?: "system" | "action";
}

export interface Requirement {
  id: string;
  code: string;
  materialName: string;
  spec: string;
  quantity: number;
  unit: string;
  expectedDate: string;
  source: ReqSource;
  owner: string; // 采购负责人
  rdContact?: string; // 研发对接人
  useDesc?: string; // 用途说明
  status: ReqStatus;
  note?: string;
  relatedRdTaskId?: string;
  hasAttachment?: boolean;
  quotes: Quote[];
  selectedQuoteId?: string;
  sampleArrivedAt?: string;
  testConclusion?: string;
  relatedContractId?: string;
  logs: ProcLog[];
  createdAt: string;
  updatedAt: string;
}

export type ContractApproval = "approving" | "effective" | "rejected";
export type PaymentApproval = "none" | "approving" | "approved" | "partial";

export interface Delivery {
  batch: string;
  date: string;
  qty: number;
  operator: string;
}
export interface Payment {
  label: string;
  ratio: string;
  amount: number;
  status: "approving" | "approved";
}

export interface Contract {
  id: string;
  code: string;
  supplier: string;
  materialName: string;
  quantity: number;
  delivered: number;
  amount: number;
  contractApproval: ContractApproval;
  paymentApproval: PaymentApproval;
  deliveries: Delivery[];
  payments: Payment[];
  deliveryPlan: number[]; // 剩余待注入的到货批次序列
  relatedRequirementId?: string;
  updatedAt: string;
}

export interface PriceHistoryRow {
  id: string;
  material: string;
  supplier: string;
  unitPrice: number;
  leadDays: number;
  date: string;
}

export interface RdTaskTimelineItem {
  id: string;
  at: string;
  text: string;
  kind: "rd" | "proc"; // proc=采购动态回传
}

export interface RdTask {
  id: string;
  title: string;
  owner: string;
  priority: "high" | "medium" | "low";
  statusText: string;
  due: string;
  desc?: string;
  isMain?: boolean;
  tags?: string[];
  timeline: RdTaskTimelineItem[];
  relatedRequirementId?: string;
}

export interface Supplier {
  id: string;
  name: string;
  category: string; // 供货类别
  contact: string; // 联系人
  phone: string;
  address: string;
  rating: number; // 评级 1-5
  certExpiry: string; // 资质有效期
  cooperationYears: number;
  status: "active" | "review" | "disabled"; // 启用 / 待评估 / 停用
  materials: string[]; // 主要供货物料
  note?: string;
}

export interface ReviewItem {
  key: string; // ①..⑥
  label: string; // 待确认①
  title: string;
  text: string;
}
