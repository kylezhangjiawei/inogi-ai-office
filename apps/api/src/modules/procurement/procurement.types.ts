/**
 * 采购模块领域类型与状态机。
 *
 * 三条分支（与前端 src/mock/procurement.ts 的状态取值保持一致，前端类型不变）：
 *  研发流转直接进入 pending_confirm；pending_rd_review 仅兼容存量待继续流转记录。
 *  1. 电商直购  pending_confirm? → pending_purchase → in_transit → partial_arrival → completed
 *  2. 询价·需样  pending_inquiry → inquiring → pending_sample → testing → priced → in_transit → ...
 *  3. 询价·免样  pending_inquiry → inquiring → priced → in_transit → ...
 *
 * 边界：下单/入库在畅捷通 T+ 内完成，本系统 in_transit 之后的到货量由 T+ 采购单同步驱动。
 */

export type ProcMethod = 'inquiry' | 'direct';
export type ProcSource = 'rd' | 'self';
export type ProcBusinessLine = 'rd' | 'production';
export type ProcPriority = 'high' | 'medium' | 'low';
export type ProcPaymentStatus = 'unpaid' | 'partial' | 'paid';

export type ProcStatus =
  | 'pending_rd_review'
  | 'pending_confirm'
  | 'pending_inquiry'
  | 'inquiring'
  | 'pending_sample'
  | 'testing'
  | 'priced'
  | 'pending_purchase'
  | 'in_transit'
  | 'partial_arrival'
  | 'completed'
  | 'cancelled';

export const PROC_STATUSES: ProcStatus[] = [
  'pending_rd_review',
  'pending_confirm',
  'pending_inquiry',
  'inquiring',
  'pending_sample',
  'testing',
  'priced',
  'pending_purchase',
  'in_transit',
  'partial_arrival',
  'completed',
  'cancelled',
];

export const PROC_STATUS_LABELS: Record<ProcStatus, string> = {
  pending_rd_review: '待继续转采购',
  pending_confirm: '待处理',
  pending_inquiry: '待询价',
  inquiring: '询价中',
  pending_sample: '待到样',
  testing: '测试中',
  priced: '已定价',
  pending_purchase: '待购买',
  in_transit: '已下单',
  partial_arrival: '部分到货',
  completed: '已完成',
  cancelled: '已取消',
};

/** 允许的状态流转。cancelled 由 cancel 接口单独处理，不列入常规迁移表。 */
export const PROC_STATUS_TRANSITIONS: Record<ProcStatus, ProcStatus[]> = {
  pending_rd_review: ['pending_confirm'],
  pending_confirm: ['pending_inquiry', 'pending_purchase'],
  // 待到样仅用于纠正已有免费样品登记的任务，服务在事务中检查登记是否仍存在。
  pending_inquiry: ['inquiring', 'pending_sample'],
  inquiring: ['pending_sample', 'priced'],
  pending_sample: ['testing'],
  // 测试不通过有两条路：同一家供应商改图再出一次样（回「待到样」），或换供应商重新询价
  testing: ['priced', 'inquiring', 'pending_sample'],
  priced: ['in_transit'],
  pending_purchase: ['in_transit'],
  in_transit: ['partial_arrival', 'completed'],
  partial_arrival: ['completed'],
  completed: [],
  cancelled: [],
};

/**
 * 允许登记 T+ 采购单关联的状态。
 * 「待询价 / 询价中」只收免费样品来货：供应商寄样往往早于定价，T+ 里根本没有对应采购单，
 * 带单号的正式采购单由 PROC_FREE_SAMPLE_ONLY_STATUSES 挡在这两档之外。
 * 「待到样」是打样轮次的出样单，只登记不流转；其余是正式采购单。
 */
export const PROC_PO_LINKABLE_STATUSES: ProcStatus[] = [
  'pending_inquiry',
  'inquiring',
  'pending_sample',
  'priced',
  'pending_purchase',
  'in_transit',
  'partial_arrival',
];

/** 只接受免费样品行的状态：这两档还没定价，不可能有 T+ 采购单号。 */
export const PROC_FREE_SAMPLE_ONLY_STATUSES: ProcStatus[] = ['pending_inquiry', 'inquiring'];

/**
 * T+ 单据匹配的候选任务状态。
 * 刻意不复用 PROC_PO_LINKABLE_STATUSES —— 这两份现在是不同的集合，不是重复定义：
 * 询价两档只可能挂免费样品（T+ 里无单），放进候选只会让真实采购单被建议关联到还在询价的任务上。
 */
export const PROC_PO_MATCHABLE_STATUSES: ProcStatus[] = [
  'pending_sample',
  'priced',
  'pending_purchase',
  'in_transit',
  'partial_arrival',
];

/** 已下单及之后：到货数据由 T+ 采购单驱动。 */
export const PROC_ARRIVAL_STATUSES: ProcStatus[] = ['in_transit', 'partial_arrival', 'completed'];

/**
 * 允许「重新维护报价」的状态：报价已确认但还没下单。
 * 进入在途之后单价已随采购单出去，再改这里会与 T+ 对不上，须先撤销采购单关联。
 */
export const PROC_QUOTATION_RESETTABLE_STATUSES: ProcStatus[] = [
  'inquiring',
  'pending_sample',
  'testing',
  'priced',
];

/** 终态：不可再流转，也不计入待办统计。 */
export const PROC_TERMINAL_STATUSES: ProcStatus[] = ['completed', 'cancelled'];

/**
 * 主干流程顺序。回退功能据此判断「谁在谁前面」——只有排在当前状态之前的节点才是回退目标。
 *
 * 刻意不含 pending_purchase：直购走的是 待处理 → 待购买 → 已下单 的旁路，
 * 与询价主干不在同一条线上，把它塞进同一个序列会让「上一个节点」失去意义。
 * 直购任务的回退目标由 rollbackTargetsOf 单独给。
 */
export const PROC_ROLLBACK_MAIN_FLOW: ProcStatus[] = [
  'pending_confirm',
  'pending_inquiry',
  'inquiring',
  'pending_sample',
  'testing',
  'priced',
  'in_transit',
  'partial_arrival',
  'completed',
];

/** 直购旁路的回退序列。 */
export const PROC_ROLLBACK_DIRECT_FLOW: ProcStatus[] = [
  'pending_confirm',
  'pending_purchase',
  'in_transit',
  'partial_arrival',
  'completed',
];

/**
 * 不可回退的状态。
 * pending_rd_review 是采购流程之前的审核环节，采购侧无权处置；
 * cancelled 已经是作废态，要恢复走的是重新发起而不是回退。
 */
export const PROC_ROLLBACK_BLOCKED_STATUSES: ProcStatus[] = ['pending_rd_review', 'cancelled'];

/**
 * 回退到该状态时必须一并清理的业务数据。
 * 回退不是单纯改一个字段：退到「待询价」却留着已确认的报价，任务会卡在
 * 「有报价但状态说还没询价」的矛盾态，下一步动作全部失效。
 */
export interface ProcRollbackCleanup {
  /** 清空本任务的报价快照与报价金额 */
  quotations: boolean;
  /** 解除 T+ 采购单关联（免费样品登记独立保留，不代表实际收样） */
  purchaseOrders: boolean;
  /** 把任务上的到货累计量归零（到货量由采购单汇总而来，没有独立的到货表） */
  arrivals: boolean;
}

/**
 * 回退到目标状态需要清理什么。
 * 判据是「目标状态下这份数据本不该存在」：退回「待询价」时报价还没维护，
 * 退回「已定价」时采购单还没下，退到「已下单」之前到货记录不可能有。
 */
export function rollbackCleanupFor(target: ProcStatus): ProcRollbackCleanup {
  const index = PROC_ROLLBACK_MAIN_FLOW.indexOf(target);
  const pricedIndex = PROC_ROLLBACK_MAIN_FLOW.indexOf('priced');
  const inTransitIndex = PROC_ROLLBACK_MAIN_FLOW.indexOf('in_transit');
  // 直购的「待购买」在主干序列里找不到，它排在下单之前，按 priced 同档处理
  const effectiveIndex = target === 'pending_purchase' ? pricedIndex : index;
  return {
    quotations: effectiveIndex >= 0 && effectiveIndex <= PROC_ROLLBACK_MAIN_FLOW.indexOf('pending_inquiry'),
    purchaseOrders: effectiveIndex >= 0 && effectiveIndex < inTransitIndex,
    arrivals: effectiveIndex >= 0 && effectiveIndex < inTransitIndex,
  };
}

/**
 * 某状态可回退到哪些节点：同一条流程线上排在它前面的全部节点。
 * 「可回退到任意流程节点」的边界就在这里——只能往回，不能借回退往前跳。
 */
export function rollbackTargetsOf(current: ProcStatus, method?: string | null): ProcStatus[] {
  if (PROC_ROLLBACK_BLOCKED_STATUSES.includes(current)) return [];
  const flow = method === 'direct' ? PROC_ROLLBACK_DIRECT_FLOW : PROC_ROLLBACK_MAIN_FLOW;
  const index = flow.indexOf(current);
  if (index <= 0) return [];
  return flow.slice(0, index);
}

export type MaterialReviewStatus = 'pending' | 'approved' | 'rejected';
export type MaterialReviewSource = 'import' | 'auto' | 'manual';
export type QuotationChannel = 'manual' | 'mail';

/** 操作人：由控制器从 JWT 载荷装配后传入 service，service 不直接依赖 request。 */
export interface ProcActor {
  id: string;
  name: string;
  permissions: string[];
}

export interface ProcTaskListQuery {
  status?: string;
  businessLine?: string;
  source?: string;
  method?: string;
  priority?: string;
  buyerUserId?: string;
  materialId?: string;
  rdTaskId?: string;
  keyword?: string;
  /** 只看未完结（排除 completed/cancelled） */
  activeOnly?: string;
  /** 研发任务详情查询关联时启用；普通采购列表永不返回待研发审核任务。 */
  rdLink?: string;
  page?: string;
  pageSize?: string;
}

export interface ProcMaterialListQuery {
  keyword?: string;
  category?: string;
  productLine?: string;
  reviewStatus?: string;
  /** 只看低于安全库存的物料 */
  shortageOnly?: string;
  page?: string;
  pageSize?: string;
}
