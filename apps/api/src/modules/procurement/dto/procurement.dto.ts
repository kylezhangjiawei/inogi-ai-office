import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { PROC_STATUSES } from '../procurement.types';

/** 任务附件：已先经 /api/files/upload 拿到 OSS 地址，此处只登记引用。 */
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
  @Min(0)
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

export class TransitionProcTaskDto {
  @IsIn(PROC_STATUSES)
  status!: string;

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

export class CreateQuotationDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  supplierId?: string;

  @IsString()
  @MaxLength(200)
  supplierName!: string;

  @IsNumber()
  @Min(0)
  unitPrice!: number;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  leadTimeDays?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minOrderQty?: number;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  quoteDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  validUntil?: string;

  @IsOptional()
  @IsIn(['manual', 'mail'])
  channel?: 'manual' | 'mail';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** 关联 T+ 采购单：本系统不创建采购单，只登记接缝。 */
export class LinkPurchaseOrderDto {
  @IsString()
  @MaxLength(64)
  tpOrderNo!: string;

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

export class ReviewMaterialDto {
  @IsIn(['approved', 'rejected'])
  reviewStatus!: 'approved' | 'rejected';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reviewNote?: string;
}

export class ImportMaterialsDto {
  @IsArray()
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => UpsertMaterialDto)
  items!: UpsertMaterialDto[];
}
