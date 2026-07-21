/**
 * 采购模块领域类型与状态机。
 *
 * 三条分支（与前端 src/mock/procurement.ts 的状态取值保持一致，前端类型不变）：
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
  pending_confirm: ['pending_inquiry', 'pending_purchase'],
  pending_inquiry: ['inquiring'],
  inquiring: ['pending_sample', 'priced'],
  pending_sample: ['testing'],
  testing: ['priced', 'inquiring'], // 测试不通过可退回重新询价
  priced: ['in_transit'],
  pending_purchase: ['in_transit'],
  in_transit: ['partial_arrival', 'completed'],
  partial_arrival: ['completed'],
  completed: [],
  cancelled: [],
};

/** 已下单及之后：到货数据由 T+ 采购单驱动。 */
export const PROC_ARRIVAL_STATUSES: ProcStatus[] = ['in_transit', 'partial_arrival', 'completed'];

/** 终态：不可再流转，也不计入待办统计。 */
export const PROC_TERMINAL_STATUSES: ProcStatus[] = ['completed', 'cancelled'];

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
