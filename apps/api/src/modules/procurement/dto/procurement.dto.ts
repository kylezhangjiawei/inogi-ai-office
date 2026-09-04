import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { PROC_STATUSES } from '../procurement.types';

export class ProcAttachmentInputDto {
  @IsString()
  @MaxLength(255)
  fileName!: string;

  @IsString()
  @MaxLength(2000)
  fileUrl!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  fileKey?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  fileSize?: number;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  mimeType?: string;

  @IsOptional()
  @IsIn(['drawing', 'quote', 'other'])
  kind?: 'drawing' | 'quote' | 'other';
}

export class CreateProcTaskDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  productId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  materialId?: string;

  @IsString()
  @MaxLength(200)
  materialName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  spec?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;

  @IsNumber()
  @Min(0.001)
  quantity!: number;

  @IsOptional()
  @IsIn(['inquiry', 'direct'])
  method?: 'inquiry' | 'direct';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  purchaseLink?: string;

  @IsOptional()
  @IsIn(['rd', 'production'])
  businessLine?: 'rd' | 'production';

  @IsOptional()
  @IsIn(['high', 'medium', 'low'])
  priority?: 'high' | 'medium' | 'low';

  @IsOptional()
  @IsBoolean()
  needSample?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  needDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  deadline?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  buyerUserId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  buyer?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  requesterDept?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  consumableNote?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ProcAttachmentInputDto)
  attachments?: ProcAttachmentInputDto[];
}

/** 研发侧「转采购」：附带研发任务上下文，附件必填（无强制字段校验，有附件即可）。 */
export class TransferFromRdDto extends CreateProcTaskDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  rdTaskId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  rdTaskTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  rdContact?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  rdContactUserId?: string;
}

export class UpdateProcTaskDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  quantity?: number;

  @IsOptional()
  @IsIn(['high', 'medium', 'low'])
  priority?: 'high' | 'medium' | 'low';

  @IsOptional()
  @IsString()
  @MaxLength(32)
  needDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  deadline?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  expectedArrivalDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  paymentDate?: string;

  @IsOptional()
  @IsIn(['unpaid', 'partial', 'paid'])
  paymentStatus?: 'unpaid' | 'partial' | 'paid';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  paymentNote?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  consumableNote?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  purchaseLink?: string;

  @IsOptional()
  @IsBoolean()
  businessDone?: boolean;
}

/** 采购自建的备货总计划。 */
export class CreateProcStockPlanDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  materialId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  materialName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  spec?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  targetQty!: number;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  targetDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class UpdateProcStockPlanDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  materialId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  materialName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  spec?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  targetQty?: number;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  targetDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class CreateProcStockPlanBatchDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  supplierId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  supplierName!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  purchaseQty!: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  purchaseOrderNo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  orderDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  expectedArrivalDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class UpdateProcStockPlanBatchDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  supplierId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  supplierName?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  purchaseQty?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  purchaseOrderNo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  orderDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  expectedArrivalDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ProcTaskCriticalMaterialInputDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  materialId!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(36500)
  leadTimeDays?: number | null;
}

export class SetProcTaskCriticalMaterialsDto {
  @IsArray()
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => ProcTaskCriticalMaterialInputDto)
  items!: ProcTaskCriticalMaterialInputDto[];
}

export class SetProcCoreMaterialsDto {
  @IsArray()
  @ArrayMaxSize(30)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  materialIds!: string[];
}

export class TransitionProcTaskDto {
  @IsIn(PROC_STATUSES)
  status!: string;

  /**
   * 客户端渲染这次操作时看到的状态。服务端据此识别「界面已经过期、用户在重复推进」并拒绝，
   * 而不是把一串各自合法的单步流转一路走到已完成。
   *
   * 必填。此前是可选的「老客户端兼容」，但可选就等于这道防护形同虚设：不带它的调用方
   * 照样能连推数级直达终态（实测 询价中→已定价→已下单→已完成 三连全部放行）。
   * 现有调用方本来就都带，改必填不影响任何一处。
   */
  @IsIn(PROC_STATUSES)
  from_status!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class CancelProcTaskDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ReassignProcTaskDto {
  // 人员选择器尚未接入时允许只填姓名，故 userId 可选
  @IsOptional()
  @IsString()
  @MaxLength(64)
  buyerUserId?: string;

  @IsString()
  @MaxLength(64)
  buyer!: string;
}

/** 批量转派：事务内整体成功或整体回滚。 */
export class BatchReassignDto extends ReassignProcTaskDto {
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  taskIds!: string[];
}

/** 批量移动任务归类。targetNodeId 省略或为空 = 解除显式归属，退回按物料自动推导。 */
export class MoveProcTasksDto {
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  taskIds!: string[];

  @IsOptional()
  @IsString()
  @MaxLength(80)
  targetNodeId?: string;
}

/**
 * 手工登记到货（过渡期）。
 * T+ 接通后到货以同步为准，此入口应改为只读——届时删掉本 DTO 与对应端点即可。
 */
export class ReceiveGoodsDto {
  @IsNumber()
  @Min(0)
  qty!: number;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  receivedDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** 从供应商报价库选择现行报价，服务端按任务数量匹配阶梯并生成任务报价快照。 */
export class ApplyQuoteBookQuotesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  quoteIds!: string[];
}

export class ConfirmQuoteBookQuoteItemDto {
  @IsString()
  quoteId!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  quantity!: number;
}

/** 批量确认报价：逐条提交采购数量，折扣按金额从报价小计中扣减。 */
export class ConfirmQuoteBookQuotesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ConfirmQuoteBookQuoteItemDto)
  selections!: ConfirmQuoteBookQuoteItemDto[];

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  discountAmount!: number;
}

/** 重新维护报价：清空任务已确认的报价并退回「待询价」。 */
/** 完成询价：只带备注，去向由服务端按需样情况判定。 */
export class CompleteInquiryDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/**
 * 回退到流程中更早的节点。
 * reason 必填：回退会清掉报价/采购单关联等业务数据，留痕里必须能查到是谁、为什么退的。
 */
export class RollbackProcTaskDto {
  @IsIn(PROC_STATUSES)
  status!: string;

  /** 客户端渲染这次操作时看到的状态，用于识别过期页面，语义同 TransitionProcTaskDto。 */
  @IsIn(PROC_STATUSES)
  from_status!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  reason!: string;
}

export class ResetTaskQuotationsDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

/** 关联 T+ 采购单：本系统不创建采购单，只登记接缝。 */
export class LinkPurchaseOrderDto {
  /** 免费样品来货时 T+ 里没有采购单，单号允许留空，由 isFreeSample 兜底。 */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  tpOrderNo?: string;

  /** 免费样品（无采购单号）：只登记供应商/数量/预计到货，不参与 T+ 采购单同步。 */
  @IsOptional()
  @IsBoolean()
  isFreeSample?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  tpOrderId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  tpLineNo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  supplierName?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  orderedQty?: number;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  orderDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  etaDate?: string;
}

/** 一次关联多张采购单：用于一项任务的确认报价来自多个供应商时原子提交。 */
export class BatchLinkPurchaseOrdersDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => LinkPurchaseOrderDto)
  items!: LinkPurchaseOrderDto[];

  /** 批量下单数量与任务需求数量不一致时，把任务采购数量同步成本次登记总量。 */
  @IsOptional()
  @IsBoolean()
  syncTaskQuantity?: boolean;
}

export class UpsertMaterialDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  spec?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  productLine?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  erpCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  tpInventoryCode?: string;

  @IsOptional()
  @IsBoolean()
  isSpecial?: boolean;

  @IsOptional()
  @IsBoolean()
  isConsumable?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  safeStock?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  remark?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  imageKey?: string;
}

/** AI 建单：粘贴自然语言需求（或含商品链接），解析出建单草稿。 */
export class AiParseTaskDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  text!: string;
}

/** 分类重命名/合并：目标名已存在即为合并，两个分类下的物料归到一起。 */
export class RenameCategoryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  from!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  to!: string;
}

/** 畅捷通 T+ 集成配置：appSecret 走 HTTPS 明文传输、落库加密；不传则保留已存值。 */
export class TplusConfigDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  baseUrl?: string;

  /** 不传则保留已存值（如仅切换 autoSync 开关）；首次配置必须传。 */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  appKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  appSecret?: string;

  /** OAuth 回调地址：须与开放平台应用配置一致，换 token 时要原样带上。 */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  redirectUri?: string;

  /** 每日自动同步开关（默认开启；不传则保留已存值）。 */
  @IsOptional()
  @IsBoolean()
  autoSync?: boolean;
}

/** 手动粘贴授权码换 token（回调直达不可用时的兜底）。 */
export class TplusExchangeCodeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  code!: string;
}

export class ReviewMaterialDto {
  @IsIn(['approved', 'rejected'])
  reviewStatus!: 'approved' | 'rejected';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reviewNote?: string;
}

/** BOM 树节点：机型/部件/组件为中间层，叶子为原料（code 按 T+ 存货编码匹配物料）。 */
export class BomNodeInputDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  code?: string;

  /** 根节点机型（R1 / R2 / 通用），子孙继承。 */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  productLine?: string;

  /** 单机用量（叶子原料）。 */
  @IsOptional()
  @IsNumber()
  @Min(0)
  qtyPer?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BomNodeInputDto)
  children?: BomNodeInputDto[];
}

export class ImportBomDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => BomNodeInputDto)
  roots!: BomNodeInputDto[];

  /** true 则先清空现有 BOM 再导入（全量替换）。 */
  @IsOptional()
  @IsBoolean()
  replace?: boolean;
}

/** 采购任务驾驶舱系统树节点。parentId 为空时创建分类根节点。 */
export class CreateProcTaskTreeNodeDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  productId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  parentId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  spec?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  materialId?: string;
}

export class UpdateProcTaskTreeNodeDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  spec?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  materialId?: string;
}

export class ImportMaterialsDto {
  @IsArray()
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => UpsertMaterialDto)
  items!: UpsertMaterialDto[];
}

// ── 供应商报价库 ─────────────────────────────────────────────────────────────

/** 阶梯价档位：minQty=0 表示无起订量约束的单一价。 */
export class QuoteTierDto {
  @IsNumber()
  @Min(0)
  minQty!: number;

  @IsNumber()
  @Min(0)
  unitPrice!: number;
}

/** 历史轮次价格（导入表里被最新价覆盖的早前轮次 /「6.2报价」类额外价格列）。 */
export class HistoryPriceDto {
  @IsNumber()
  @Min(0)
  unitPrice!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minQty?: number;

  /** 轮次说明（如列头「6.2报价」/「早前轮次」） */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;
}

/** 导入行：按物料名匹配（找不到自动建待审核物料），同商品同厂家合并 upsert。 */
export class ImportSupplierQuoteItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  materialName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  spec?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  supplierName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  supplierModel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @IsOptional()
  @IsBoolean()
  taxIncluded?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  leadTimeDays?: number;

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => QuoteTierDto)
  tiers!: QuoteTierDto[];

  @IsOptional()
  @IsString()
  @MaxLength(32)
  quoteDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  validUntil?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  imageKey?: string;

  /** 历史轮次价格：写入 ProcQuotation 流水（channel=quote-book），供历史价格弹窗展示 */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => HistoryPriceDto)
  historyPrices?: HistoryPriceDto[];
}

export class ImportSupplierQuotesDto {
  @IsArray()
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => ImportSupplierQuoteItemDto)
  items!: ImportSupplierQuoteItemDto[];
}

/** AI 识别报价表：前端把工作簿序列化为 CSV 文本后提交。 */
export class AiParseQuotesDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80_000)
  text!: string;
}

export class UpsertSupplierQuoteDto {
  @IsString()
  @MaxLength(64)
  materialId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  supplierId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  supplierName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  supplierModel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @IsOptional()
  @IsBoolean()
  taxIncluded?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  leadTimeDays?: number;

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => QuoteTierDto)
  tiers!: QuoteTierDto[];

  @IsOptional()
  @IsString()
  @MaxLength(32)
  quoteDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  validUntil?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  imageKey?: string;
}
