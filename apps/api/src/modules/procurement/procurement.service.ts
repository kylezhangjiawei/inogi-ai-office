import { assertRdTransferRequirements } from './rd-transfer-requirements';
import { lockOrderDependency } from './purchase-delivery-store';
import { sampleValidationReferences, confirmSampleValidation } from './sample-validation';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SaveBomNodeDto } from './dto/procurement.dto';
import { createHash, randomUUID } from 'node:crypto';

import { PrismaService } from '../../prisma/prisma.service';
import { BomRevisionsService } from './bom-revisions.service';
import { InventoryStockService } from '../inventory-stock/inventory-stock.service';
import { stockForCode, type StockSnapshot } from '../inventory-stock/inventory-stock.model';
import { buildBomSnapshot, bomHash } from './bom-revisions.model';
import { recalculateStockPlanFulfillment } from './purchase-fulfillment.service';
import { ChatService } from '../chat/chat.service';
import { ResearchDevelopmentService } from '../research-development/research-development.service';
import { RdTechnicalDocumentsService } from '../research-development/rd-technical-documents.service';
import { OSS_BUSINESS_TYPES, SIGNED_URL_TTL_SECONDS } from '../oss/oss.constants';
import { OssService } from '../oss/oss.service';
import {
  AiParseTaskDto,
  AssignSampleTestDto,
  ConfirmSampleTestDto,
  UpdateSampleRecordsDto,
  ApplyQuoteBookQuotesDto,
  BatchReassignDto,
  MoveProcTasksDto,
  BomNodeInputDto,
  CancelProcTaskDto,
  ConfirmQuoteBookQuotesDto,
  CreateProcStockPlanBatchDto,
  CreateInventoryBomLineDto,
  UpdateInventoryBomLineDto,
  InventoryBomLineVersionDto,
  CreateProcStockPlanDto,
  CreateProcTaskTreeNodeDto,
  CreateProcTaskDto,
  ImportBomDto,
  ImportMaterialsDto,
  LinkPurchaseOrderDto,
  ListProcStockPlansQueryDto,
  ProcAttachmentInputDto,
  ReassignProcTaskDto,
  ReceiveGoodsDto,
  RenameCategoryDto,
  ReviewMaterialDto,
  RollbackProcTaskDto,
  SetProcCoreMaterialsDto,
  SetProcTaskCriticalMaterialsDto,
  TransferFromRdDto,
  SampleEvidenceDto,
  TransitionProcTaskDto,
  UpdateProcTaskTreeNodeDto,
  UpdateProcTaskDto,
  UpdateProcStockPlanBatchDto,
  UpdateProcStockPlanDto,
  UpsertMaterialDto,
} from './dto/procurement.dto';
import {
  PROC_ARRIVAL_STATUSES,
  PROC_FREE_SAMPLE_ONLY_STATUSES,
  PROC_ROLLBACK_BLOCKED_STATUSES,
  PROC_STATUS_LABELS,
  PROC_PO_LINKABLE_STATUSES,
  PROC_QUOTATION_RESETTABLE_STATUSES,
  PROC_STATUS_TRANSITIONS,
  PROC_TERMINAL_STATUSES,
  rollbackCleanupFor,
  rollbackTargetsOf,
  type ProcActor,
  type ProcMaterialListQuery,
  type ProcStatus,
  type ProcTaskListQuery,
} from './procurement.types';
import { INITIAL_PROC_TASK_TREE } from './proc-task-tree.seed';
import { isVoidedOrderStatus } from './replenish-core';
import {
  calculateInventoryReadiness,
  isProductionWarehouse,
  type InventoryReadinessBalance,
  type InventoryReadinessBomLeaf,
} from './inventory-readiness';
import { buildQ5PackagingReference, Q5_PACKAGING_REFERENCE_SOURCE } from './q5-packaging-reference';
import { buildInventoryMatchDiagnostics } from './inventory-match-diagnostic';
import { sampleTestOf, sampleTestHistoryOf, archiveSampleTest, sampleTestWithoutCommercial, sampleTimestamp, sampleTimingError, SAMPLE_TEST_RESULTS, SAMPLE_TEST_RESULT_LABELS, type ProcurementSampleTest } from './sample-test';
import { appendRdTransferSnapshot, rdTransferSnapshotsOf, type RdTransferSnapshotAttachment } from './rd-transfer-snapshot';
import { readStockPlanOrderDateCheck } from './stock-plan-order-date-check';
import { readWorkspaceArrivalDates } from './workspace-arrival-dates';

const DEFAULT_PROC_PRODUCT_ID = 'prod-portable-o2';

function normalizeProcProductId(value?: string | null): string {
  return value?.trim() || DEFAULT_PROC_PRODUCT_ID;
}

/** 前端一律用 number/ISO 字符串，Decimal/Date 在出口统一序列化。 */
function num(value: Prisma.Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === 'number' ? value : Number(value);
}
function numOrNull(value: Prisma.Decimal | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'number' ? value : Number(value);
}
/** 日期出口统一成 YYYY-MM-DD（前端全部按日粒度展示与比较）。 */
function day(value: Date | null | undefined): string | undefined {
  if (!value) return undefined;
  return value.toISOString().slice(0, 10);
}
/** 入参日期：空串/非法一律落 null，避免 Invalid Date 进库。 */
function parseDay(value: string | null | undefined): Date | null {
  if (!value) return null;
  const t = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(t.getTime()) ? null : t;
}

function isInventoryBomMaterial(row: { code?: string | null; qtyPer?: unknown; materialId?: string | null; material?: unknown }): boolean {
  return Boolean(row.code?.trim() || row.materialId || row.material)
    || (row.qtyPer !== null && row.qtyPer !== undefined);
}

function parseStockPlanArrivalDate(value: string | null | undefined): Date | null {
  if (value === '' || value === null || value === undefined) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException('实际到货日期必须是有效的 YYYY-MM-DD 日期');
  const parsed = parseDay(value);
  if (!parsed || day(parsed) !== value) throw new BadRequestException('实际到货日期必须是有效的 YYYY-MM-DD 日期');
  return parsed;
}

function stockPlanMonthRange(month: string) {
  if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new BadRequestException('月份格式应为 YYYY-MM');
  const gte = new Date(`${month}-01T00:00:00.000Z`);
  const lt = new Date(gte);
  lt.setUTCMonth(lt.getUTCMonth() + 1);
  return { gte, lt };
}

function procurementPersonNameKey(value?: string | null): string {
  return (value ?? '').trim().replace(/[（(].*?[）)]/g, '').toLocaleLowerCase('zh-CN').replace(/\s+/g, '');
}

/** BOM 树出参节点。 */
export interface BomTreeNode {
  id: string;
  parentId: string | null;
  updatedAt: string;
  sortOrder: number;
  name: string;
  code: string | null;
  level: number;
  productLine: string;
  qtyPer: number | null;
  remark: string | null;
  material: { id: string; name: string; spec: string; unit: string } | null;
  children: BomTreeNode[];
}

/** AI 建单草稿（不落库，前端确认后走 createTask）。 */
export interface AiTaskDraft {
  materialName?: string;
  materialId?: string;
  spec?: string;
  unit?: string;
  quantity?: number;
  method?: 'inquiry' | 'direct';
  purchaseLink?: string;
  needDate?: string;
  deadline?: string;
  priority?: 'high' | 'medium' | 'low';
  needSample?: boolean;
}

export interface ProcTaskTreeNodeView {
  id: string;
  productId: string;
  parentId: string | null;
  name: string;
  code: string | null;
  spec: string | null;
  materialId: string | null;
  taskCount: number;
  taskIds: string[];
  children: ProcTaskTreeNodeView[];
}

type ProcTaskTreeDbClient = Pick<
  Prisma.TransactionClient,
  'procTaskTreeNode' | 'procTask' | 'procMaterial'
>;

export interface TaskQuoteBookOption {
  id: string;
  materialId: string;
  materialName: string;
  materialSpec: string;
  supplierId?: string;
  supplierName: string;
  supplierModel: string;
  currency: string;
  taxIncluded: boolean;
  leadTimeDays: number;
  tiers: Array<{ minQty: number; unitPrice: number }>;
  matchedTier: { minQty: number; unitPrice: number };
  belowMinOrder: boolean;
  quoteDate?: string;
  validUntil?: string;
  note?: string;
  updatedAt: string;
}

export interface TaskQuoteBookOptionsResult {
  materialId: string | null;
  quantity: number;
  scope: 'material' | 'all';
  quotes: TaskQuoteBookOption[];
}

const PROC_AUDIT_SAFE_META_FIELDS = new Set([
  'buyer',
  'buyerUserId',
  'code',
  'materialId',
  'materialIds',
  'method',
  'name',
  'nodeId',
  'parentId',
  'priority',
  'productId',
  'purchaseOrderId',
  'quantity',
  'quotationId',
  'receivedQty',
  'status',
  'targetStatus',
  'taskId',
  'taskIds',
  'userId',
]);


function auditDetailValue(value: Prisma.JsonValue | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return `${value.length} 项`;
  if (typeof value === 'object') return '已提交';
  if (typeof value === 'boolean') return value ? '是' : '否';
  const text = String(value).trim();
  if (!text) return null;
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

const PROC_TASK_VIEW_INCLUDE = Prisma.validator<Prisma.ProcTaskInclude>()({
  attachments: { orderBy: { createdAt: 'asc' } },
  logs: { orderBy: { createdAt: 'asc' } },
  purchaseOrderRefs: true,
  criticalMaterials: { orderBy: { sortOrder: 'asc' } },
});

const PROC_STOCK_PLAN_VIEW_INCLUDE = Prisma.validator<Prisma.ProcStockPlanInclude>()({
  bomRevision: { select: { version: true, retiredAt: true } },
  batches: { orderBy: [{ orderDate: 'asc' }, { createdAt: 'asc' }], include: { purchaseOrderMirror: true } },
  tasks: { orderBy: { createdAt: 'asc' }, select: { id: true, code: true, materialId: true, materialName: true, quantity: true, status: true, needDate: true } },
  _count: { select: { productionReports: true, qualityRecords: true } },
});

type ProcTaskView = Prisma.ProcTaskGetPayload<{ include: typeof PROC_TASK_VIEW_INCLUDE }>;
type ProcStockPlanView = Prisma.ProcStockPlanGetPayload<{ include: typeof PROC_STOCK_PLAN_VIEW_INCLUDE }>;
type ProcReviewNoticeTask = Pick<
  Prisma.ProcTaskGetPayload<object>,
  | 'id'
  | 'code'
  | 'source'
  | 'materialName'
  | 'spec'
  | 'unit'
  | 'quantity'
  | 'method'
  | 'needDate'
  | 'deadline'
  | 'priority'
  | 'rdTaskId'
  | 'rdTaskTitle'
  | 'rdContact'
  | 'rdContactUserId'
  | 'buyer'
  | 'buyerUserId'
  | 'requester'
  | 'requesterUserId'
  | 'requesterDept'
>;

@Injectable()
export class ProcurementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ossService: OssService,
    private readonly chatService: ChatService,
    private readonly rdService: ResearchDevelopmentService,
    @Optional() private readonly technicalDocuments?: RdTechnicalDocumentsService,
    @Optional() private readonly bomRevisions: BomRevisionsService = new BomRevisionsService(prisma),
    @Optional() private readonly inventoryStock: InventoryStockService = new InventoryStockService(prisma),
  ) {}

  /**
   * 采购附件与研发驾驶舱共用同一套 OSS 内联预览能力。
   * bucket 默认强制下载，直接签名 URL 放进 iframe 会触发下载，因此优先返回 CDN inline URL，
   * 未配置 CDN 时退回带 HMAC capability token 的同源预览代理。
   */
  private isAllowedAttachmentFileKey(fileKey: string): boolean {
    return [
      OSS_BUSINESS_TYPES.RD_PROGRESS_NOTES,
      OSS_BUSINESS_TYPES.ASSETS,
      OSS_BUSINESS_TYPES.UPLOADS_TEMP,
    ].some((businessType) => this.ossService.isKeyUnderBusinessType(fileKey, businessType));
  }

  /**
   * 兼容历史采购附件：旧记录只有短效 oss_url，没有单独保存 fileKey。
   * 从旧同源预览 URL 的 key 参数或 OSS 路径中恢复 object key，并再次校验业务前缀，
   * 避免把数据库中的任意 URL 变成可签名的 OSS 读取能力。
   */
  private resolveAttachmentFileKey(storedFileKey: string | null, fallbackUrl: string): string | null {
    const directKey = storedFileKey?.trim().replace(/^\/+/, '') ?? '';
    if (directKey && this.isAllowedAttachmentFileKey(directKey)) return directKey;
    if (!fallbackUrl) return null;
    try {
      const parsed = new URL(fallbackUrl, 'http://inogi.local');
      const queryKey = parsed.searchParams.get('key')?.trim().replace(/^\/+/, '') ?? '';
      if (queryKey && this.isAllowedAttachmentFileKey(queryKey)) return queryKey;
      const pathKey = decodeURIComponent(parsed.pathname).replace(/^\/+/, '');
      return pathKey && this.isAllowedAttachmentFileKey(pathKey) ? pathKey : null;
    } catch {
      return null;
    }
  }

  // ── 备货计划 ────────────────────────────────────────────────────────────────

  getStockPlanOrderDateCheck(id: string, query: Record<string, unknown>, actor: ProcActor) {
    return readStockPlanOrderDateCheck(this.prisma, id, query, actor);
  }

  async listStockPlans(query: ListProcStockPlansQueryDto = {}) {
    const where: Prisma.ProcStockPlanWhereInput = {};
    if (query.type) {
      if (!['material', 'machine', 'packaging'].includes(query.type)) throw new BadRequestException('未知的备货计划类型');
      where.planType = query.type;
    }
    if (query.productId?.trim()) where.productId = query.productId.trim();
    if (query.treeNodeId?.trim()) where.treeNodeId = query.treeNodeId.trim();
    if (query.month) {
      where.targetDate = stockPlanMonthRange(query.month);
    }
    const rows = await this.prisma.procStockPlan.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      include: PROC_STOCK_PLAN_VIEW_INCLUDE,
    });
    const unresolvedOrders = await this.unresolvedStockPlanOrders(rows);
    return { items: await Promise.all(rows.map(async (row) => ({ ...this.serializeStockPlan(row, unresolvedOrders), fulfillmentSummary: await recalculateStockPlanFulfillment(this.prisma, row) }))) };
  }

  async createStockPlan(dto: CreateProcStockPlanDto, actor: ProcActor) {
    return this.prisma.$transaction(async (tx) => {
      const data = await this.stockPlanData(dto, tx);
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('procurement-stock-plan-code'))::text`;
      const row = await tx.procStockPlan.create({
        data: { ...data, code: await this.nextStockPlanCode(tx), createdBy: actor.id, createdByName: actor.name },
        include: PROC_STOCK_PLAN_VIEW_INCLUDE,
      });
      return this.serializeStockPlan(row);
    });
  }

  async updateStockPlan(id: string, dto: UpdateProcStockPlanDto) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockStockPlan(tx, id);
      const current = await this.requireStockPlan(id, tx);
      const next: CreateProcStockPlanDto = {
        planType: current.planType as CreateProcStockPlanDto['planType'],
        productId: current.productId ?? '', treeNodeId: current.treeNodeId ?? '',
        productLine: current.productLine ?? '', productionTaskId: current.productionTaskId ?? '',
        bomRevisionId: current.bomRevisionId ?? undefined,
        materialId: current.materialId ?? '', materialName: current.materialName,
        spec: current.spec, unit: current.unit, targetQty: num(current.targetQty),
        targetDate: day(current.targetDate), note: current.note ?? '', ...dto,
      };
      const hasOperations = (current._count?.productionReports ?? 0) > 0 || (current._count?.qualityRecords ?? 0) > 0;
      const frozen: Array<keyof CreateProcStockPlanDto> = current.tasks.length > 0
        ? ['planType', 'materialId', 'materialName', 'spec', 'unit', 'productId', 'treeNodeId', 'productLine', 'productionTaskId', 'targetQty', 'targetDate']
        : hasOperations ? ['planType', 'materialId', 'materialName', 'spec', 'unit', 'productId', 'treeNodeId', 'productLine', 'productionTaskId']
          : current.batches.length > 0 ? ['planType', 'materialId', 'materialName', 'spec', 'unit', 'productLine'] : [];
      for (const key of frozen) {
        const oldValue = key === 'targetQty' ? num(current.targetQty) : key === 'targetDate' ? day(current.targetDate) : current[key];
        if (dto[key] !== undefined && String(dto[key] ?? '') !== String(oldValue ?? '')) {
          throw new BadRequestException('计划已有采购批次、任务或生产质量记录，不能修改已使用的物料、单位或归属；已生成采购任务的目标也不可修改，请另建计划');
        }
      }
      if (dto.bomRevisionId !== undefined && dto.bomRevisionId !== current.bomRevisionId) throw new BadRequestException('不能直接更换原计划 BOM，请通过执行依据核对入口办理');
      const data = await this.stockPlanData(next, tx, current);
      await tx.procStockPlan.update({ where: { id }, data });
      return this.getStockPlanView(id, tx);
    });
  }

  async createStockPlanBatch(id: string, dto: CreateProcStockPlanBatchDto, actor: ProcActor) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockStockPlan(tx, id);
        const plan = await this.requireStockPlan(id, tx);
        const data = await this.stockPlanBatchData(plan, dto, tx);
        await tx.procStockPlanBatch.create({ data: { ...data, planId: id, createdBy: actor.id, createdByName: actor.name } });
        return this.getStockPlanView(id, tx);
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new ConflictException('该采购订单行已关联其他备货批次，不能重复计入');
      throw error;
    }
  }

  async updateStockPlanBatch(
    planId: string,
    batchId: string,
    dto: UpdateProcStockPlanBatchDto,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockStockPlan(tx, planId);
        const plan = await this.requireStockPlan(planId, tx);
        const batch = plan.batches.find((entry) => entry.id === batchId);
        if (!batch) throw new NotFoundException('采购批次不存在');
        const data = await this.stockPlanBatchData(plan, dto, tx, batch);
        await tx.procStockPlanBatch.update({ where: { id: batchId }, data });
        return this.getStockPlanView(planId, tx);
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new ConflictException('该采购订单行已关联其他备货批次，不能重复计入');
      throw error;
    }
  }

  async deleteStockPlanBatch(planId: string, batchId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockStockPlan(tx, planId);
      const plan = await this.requireStockPlan(planId, tx);
      if (!plan.batches.some((batch) => batch.id === batchId)) throw new NotFoundException('采购批次不存在');
      await tx.procStockPlanBatch.delete({ where: { id: batchId } });
      return this.getStockPlanView(planId, tx);
    });
  }

  private async lockStockPlan(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw`SELECT "id" FROM "ProcStockPlan" WHERE "id" = ${id} FOR UPDATE`;
  }

  private async requireStockPlan(id: string, client: Prisma.TransactionClient = this.prisma) {
    const plan = await client.procStockPlan.findUnique({ where: { id }, include: PROC_STOCK_PLAN_VIEW_INCLUDE });
    if (!plan) throw new NotFoundException('备货计划不存在');
    return plan;
  }

  async getStockPlanView(id: string, client: Prisma.TransactionClient = this.prisma) {
    const row = await this.requireStockPlan(id, client);
    return { ...this.serializeStockPlan(row, await this.unresolvedStockPlanOrders([row], client)), fulfillmentSummary: await recalculateStockPlanFulfillment(client, row) };
  }

  /** 订单号只能证明可能重叠，不能确定行号或物料；保留历史行并要求用户明确关联。 */
  private async unresolvedStockPlanOrders(plans: ProcStockPlanView[], client: Prisma.TransactionClient = this.prisma) {
    const orderNumbers = [...new Set(plans.flatMap((plan) => plan.batches
      .filter((batch) => !batch.purchaseOrderMirrorId && batch.purchaseOrderNo?.trim())
      .map((batch) => batch.purchaseOrderNo!.trim())))];
    if (orderNumbers.length === 0) return new Set<string>();
    const mirrors = await client.procPurchaseOrderMirror.findMany({
      where: { tpOrderNo: { in: orderNumbers } }, select: { tpOrderNo: true },
    });
    return new Set(mirrors.map((mirror) => mirror.tpOrderNo));
  }

  /** 备货计划编号 SP-YYYYMMDD-NNN，按天累计。 */
  private async nextStockPlanCode(client: Prisma.TransactionClient = this.prisma) {
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const prefix = `SP-${stamp}-`;
    const last = await client.procStockPlan.findFirst({
      where: { code: { startsWith: prefix } },
      orderBy: { code: 'desc' },
      select: { code: true },
    });
    const seq = last ? Number(last.code.slice(prefix.length)) + 1 : 1;
    return `${prefix}${String(Number.isFinite(seq) ? seq : 1).padStart(3, '0')}`;
  }

  private async stockPlanData(dto: CreateProcStockPlanDto, tx: Prisma.TransactionClient, current?: ProcStockPlanView) {
    const planType = dto.planType ?? 'material';
    if (!['material', 'machine', 'packaging'].includes(planType)) throw new BadRequestException('未知的备货计划类型');
    if (!dto.materialName?.trim()) throw new BadRequestException('请填写备货对象名称');
    if (!Number.isFinite(dto.targetQty) || dto.targetQty <= 0) throw new BadRequestException('目标数量必须大于 0');
    let productLine = dto.productLine?.trim() || null;
    let bomRevisionId = current?.bomRevisionId ?? null;
    const materialId = dto.materialId?.trim() || null;
    const treeNodeId = dto.treeNodeId?.trim() || null;
    let productId = dto.productId?.trim() || null;
    if (current?.planType === 'machine' && (planType !== current.planType || productLine !== current.productLine || productId !== current.productId)) {
      throw new BadRequestException('原整机计划的产品与 BOM 身份不能直接更改');
    }
    const material = materialId ? await tx.procMaterial.findUnique({ where: { id: materialId }, select: { id: true, unit: true } }) : null;
    if (materialId && !material) throw new BadRequestException('所选物料不存在');
    let unit = dto.unit?.trim() ?? '';
    if (material && planType !== 'machine') {
      const materialUnit = material.unit.trim();
      if (!materialUnit) throw new BadRequestException('请先维护所选物料的计量单位');
      if (unit && unit !== materialUnit) throw new BadRequestException('计划单位必须与物料计量单位一致，不能直接换算库存数量');
      unit = materialUnit;
    }
    if (planType === 'machine' && !unit) unit = material?.unit.trim() || '套';
    if (treeNodeId) {
      const node = await tx.procTaskTreeNode.findUnique({ where: { id: treeNodeId }, select: { productId: true } });
      if (!node || (productId && node.productId !== productId)) throw new BadRequestException('子系统与所选产品不匹配');
      productId = node.productId;
    }
    if (planType === 'machine') {
      if (!productLine || !Number.isInteger(dto.targetQty) || dto.targetQty > 1_000_000) throw new BadRequestException('整机计划必须选择 BOM 型号，目标套数必须为 1 至 1000000 的整数');
      const nodes = await tx.procBomNode.findMany({ where: { productLine }, select: { id: true, parentId: true, materialId: true } });
      if (nodes.length === 0) throw new BadRequestException('所选型号没有 BOM，请先维护 BOM');
      const parents = new Set(nodes.map((node) => node.parentId).filter(Boolean));
      if (materialId && nodes.some((node) => node.materialId === materialId && !parents.has(node.id))) {
        throw new BadRequestException('整机计划的物料必须是整机本身，不能选择 BOM 零部件作为整机');
      }
      if (!current) {
        if (!dto.bomRevisionId || !productId) throw new BadRequestException('整机计划必须选择产品及 BOM 发布版本');
        const revision = await tx.procBomRevision.findUnique({ where: { id: dto.bomRevisionId } });
        if (!revision) throw new BadRequestException('BOM 发布版本不存在');
        const root = await tx.procTaskTreeNode.findUnique({ where: { id: revision.productRootId } });
        if (!root || root.parentId || root.productId !== productId) throw new BadRequestException('BOM 发布版本不属于所选产品');
        const selected = await this.bomRevisions.requireRevision(tx, { revisionId: revision.id, deviceId: revision.deviceId, productRootId: root.id });
        productLine = selected.productLine; bomRevisionId = selected.id;
      } else if (current.productId !== productId || current.productLine !== productLine || current.planType !== planType) throw new BadRequestException('原整机计划的产品与 BOM 身份不能直接更改');
    }
    const productionTaskId = dto.productionTaskId?.trim() || null;
    if (productionTaskId) await this.requireProductionStockPlanSource(tx, productionTaskId, productId);
    return {
      planType, productId, treeNodeId, productLine, productionTaskId, materialId, bomRevisionId,
      materialName: dto.materialName.trim(), spec: dto.spec?.trim() ?? '', unit,
      targetQty: new Prisma.Decimal(dto.targetQty), targetDate: parseDay(dto.targetDate), note: dto.note?.trim() || null,
    };
  }

  /** 只读取生产工作区的任务池，不跨回研发/协同，也不触发镜像刷新写入。 */
  private async requireProductionStockPlanSource(tx: Prisma.TransactionClient, taskId: string, productId: string | null) {
    const rows = await tx.systemSetting.findMany({
      where: { key: { in: ['rdws.production.taskCategories', 'rdws.production.productTaskCategories'] } },
      select: { key: true, value: true },
    });
    const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
    const hasTask = (tasks: unknown): boolean => Array.isArray(tasks) && tasks.some((task) => record(task) && (
      (task.task_id === taskId && task.archived !== true) || hasTask(task.subtasks)
    ));
    const hasCategoryTask = (value: unknown): boolean => Array.isArray(value) && value.some((category) => record(category)
      && Array.isArray(category.children) && category.children.some((child) => record(child) && hasTask(child.tasks)));
    const matches = rows.some((row) => row.key.endsWith('.productTaskCategories')
      ? record(row.value) && Object.entries(row.value).some(([id, categories]) => (!productId || id === productId) && hasCategoryTask(categories))
      : (!productId || productId === DEFAULT_PROC_PRODUCT_ID) && hasCategoryTask(row.value));
    if (!matches) throw new BadRequestException('生产任务不存在、已归档或不属于所选产品');
  }

  private async stockPlanBatchData(
    plan: ProcStockPlanView,
    dto: CreateProcStockPlanBatchDto | UpdateProcStockPlanBatchDto,
    tx: Prisma.TransactionClient,
    current?: ProcStockPlanView['batches'][number],
  ) {
    const mirrorId = dto.purchaseOrderMirrorId === undefined ? current?.purchaseOrderMirrorId ?? null : dto.purchaseOrderMirrorId?.trim() || null;
    let mirror = mirrorId ? await tx.procPurchaseOrderMirror.findUnique({ where: { id: mirrorId } }) : null;
    if (mirrorId && !mirror) throw new BadRequestException('采购订单行不存在');
    const purchaseOrderNo = mirror?.tpOrderNo ?? (dto.purchaseOrderNo === undefined ? current?.purchaseOrderNo ?? null : dto.purchaseOrderNo?.trim() || null);
    if (purchaseOrderNo) await lockOrderDependency(tx, purchaseOrderNo);
    if (mirrorId) {
      mirror = await tx.procPurchaseOrderMirror.findUnique({where:{id:mirrorId}});
      if (!mirror) throw new ConflictException('采购订单行已更新，请重新选择');
    }
    if (!mirror && purchaseOrderNo) {
      const existingOrder = await tx.procPurchaseOrderMirror.findFirst({ where: { tpOrderNo: purchaseOrderNo }, select: { id: true } });
      if (existingOrder) throw new BadRequestException('该采购单号已同步到 ERP，请选择并关联实际采购订单行，不能再按手工批次重复登记');
    }
    if (plan.planType === 'machine' && !plan.materialId) throw new BadRequestException('请先关联整机自身物料；BOM 零部件采购应通过生成采购任务进行');
    if (mirror) {
      const controlled = ['supplierId', 'supplierName', 'purchaseQty', 'receivedQty', 'purchaseOrderNo', 'orderDate', 'expectedArrivalDate'] as const;
      if (controlled.some((key) => dto[key] !== undefined)) throw new BadRequestException('关联采购订单后，供应商、采购量、到货量及订单日期由订单同步，不能手工覆盖');
      const material = plan.materialId ? await tx.procMaterial.findUnique({ where: { id: plan.materialId }, select: { id: true, tpInventoryCode: true } }) : null;
      if (!material || !(mirror.materialId === material.id || (material.tpInventoryCode && mirror.inventoryCode === material.tpInventoryCode))) {
        throw new BadRequestException('采购订单物料与备货计划不匹配，整机计划不能关联零部件订单');
      }
      if (plan.unit.trim() && mirror.unit?.trim() && plan.unit.trim() !== mirror.unit.trim()) {
        throw new BadRequestException('采购订单单位与计划单位不一致，请先核对物料单位，不能直接相加');
      }
      const linked = await tx.procStockPlanBatch.findUnique({ where: { purchaseOrderMirrorId: mirror.id }, select: { id: true } });
      if (linked && linked.id !== current?.id) throw new ConflictException('该采购订单行已关联其他备货批次，不能重复计入');
    }
    const supplierId = mirror ? null : dto.supplierId === undefined ? current?.supplierId ?? null : dto.supplierId?.trim() || null;
    const supplier = supplierId ? await tx.procSupplier.findUnique({ where: { id: supplierId }, select: { name: true } }) : null;
    if (supplierId && !supplier) throw new BadRequestException('供应商不存在');
    const supplierName = mirror?.supplierName ?? supplier?.name ?? dto.supplierName?.trim() ?? current?.supplierName ?? '';
    const purchaseQty = mirror ? num(mirror.orderedQty) : dto.purchaseQty ?? num(current?.purchaseQty);
    const receivedQty = mirror ? num(mirror.receivedQty) : dto.receivedQty ?? num(current?.receivedQty);
    const qualifiedQty = dto.qualifiedQty ?? num(current?.qualifiedQty);
    if (!supplierName.trim() || !Number.isFinite(purchaseQty) || purchaseQty <= 0) throw new BadRequestException('请填写供应商及大于 0 的采购量');
    if (![receivedQty, qualifiedQty].every((value) => Number.isFinite(value) && value >= 0)
      || qualifiedQty > receivedQty || (!mirror && receivedQty > purchaseQty)) {
      throw new BadRequestException('到货量、合格量必须非负，合格量不能超过到货量，手工到货量不能超过采购量');
    }
    if (plan.planType === 'machine' && ![purchaseQty, receivedQty, qualifiedQty].every(Number.isInteger)) {
      throw new BadRequestException('整机采购、到货和合格数量必须是整数套数');
    }
    return {
      purchaseOrderMirrorId: mirrorId, supplierId, supplierName: supplierName.trim(),
      purchaseQty: new Prisma.Decimal(purchaseQty), receivedQty: new Prisma.Decimal(receivedQty), qualifiedQty: new Prisma.Decimal(qualifiedQty),
      purchaseOrderNo,
      orderDate: mirror ? mirror.orderDate : dto.orderDate === undefined ? current?.orderDate ?? null : parseDay(dto.orderDate),
      expectedArrivalDate: mirror ? mirror.etaDate : dto.expectedArrivalDate === undefined ? current?.expectedArrivalDate ?? null : parseDay(dto.expectedArrivalDate),
      actualArrivalDate: dto.actualArrivalDate === undefined ? current?.actualArrivalDate ?? null : parseStockPlanArrivalDate(dto.actualArrivalDate),
      note: dto.note === undefined ? current?.note ?? null : dto.note?.trim() || null,
    };
  }

  async getStockPlanReadiness(id: string, month?: string) {
    const targetDate = month === undefined ? undefined : stockPlanMonthRange(month);
    const anchor = await this.requireStockPlan(id);
    if (!targetDate) return this.stockPlanReadiness(anchor);
    if (anchor.planType === 'machine' ? !anchor.productLine : !anchor.materialId) {
      throw new BadRequestException('月度核算需要明确的整机型号或采购物料关联，不能按名称合并');
    }
    const plans = await this.prisma.procStockPlan.findMany({
      where: {
        planType: anchor.planType, productId: anchor.productId, unit: anchor.unit, targetDate,
        ...(anchor.planType === 'machine' ? { productLine: anchor.productLine, bomRevisionId: anchor.bomRevisionId ?? null } : { materialId: anchor.materialId }),
      },
      include: PROC_STOCK_PLAN_VIEW_INCLUDE,
    });
    const targetQty = plans.reduce((sum, plan) => sum.add(plan.targetQty), new Prisma.Decimal(0));
    const result = await this.stockPlanReadiness({ ...anchor, targetQty, batches: plans.flatMap((plan) => plan.batches) });
    return { ...result, scopePlanCount: plans.length, scopeTargetQty: num(targetQty) };
  }

  private async stockPlanReadiness(plan: ProcStockPlanView, db?: Prisma.TransactionClient) {
    if (!db) return this.prisma.$transaction(tx => this.stockPlanReadiness(plan, tx), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    const unresolvedOrders = await this.unresolvedStockPlanOrders([plan], db);
    const view = this.serializeStockPlan(plan, unresolvedOrders);
    const fulfillmentSummary = await recalculateStockPlanFulfillment(db, plan);
    const orderIssues = view.batches.filter((batch) => batch.orderDataIssue).map((batch) => ({ batchId: batch.id, code: batch.orderIssueCode!, message: batch.orderIssue! }));
    if (plan.planType === 'machine') {
      const purchasedQty = fulfillmentSummary.orderedQty;
      if (purchasedQty === null) throw new BadRequestException('订单履约数量尚未核对，请先处理取消、退货或冲销的 ERP 覆盖后再核算整机计划');
      if (!plan.productLine || !Number.isInteger(num(plan.targetQty)) || num(plan.targetQty) > 1_000_000 || !Number.isInteger(purchasedQty)) throw new BadRequestException('整机计划缺少有效的 BOM 型号或整数目标、采购套数');
      const targetSets = Math.max(0, num(plan.targetQty) - purchasedQty);
      const result = await this.getInventoryReadiness({ productLine: plan.productLine, targetSets, ...(plan.bomRevisionId ? { revisionId: plan.bomRevisionId } : {}) }, db);
      if (result.productLine !== plan.productLine || result.items.length === 0) throw new BadRequestException('所选型号没有有效 BOM');
      return { ...result, orderIssues, fulfillmentSummary, dataQuality: { ...result.dataQuality, provisional: result.dataQuality.provisional || unresolvedOrders.size > 0 || fulfillmentSummary.hasAdjustments } };
    }
    const material = plan.materialId ? await db.procMaterial.findUnique({ where: { id: plan.materialId } }) : null;
    if (!material?.tpInventoryCode?.trim()) throw new BadRequestException('请先将备货物料关联到有效的 ERP 存货编码');
    if (!material.unit.trim() || (plan.unit.trim() && plan.unit.trim() !== material.unit.trim())) {
      throw new BadRequestException('计划单位与物料计量单位不一致或未维护，请先编辑计划或物料，不能直接扣减库存');
    }
    const candidates = await db.procInventoryBalance.findMany({ where: { tpInventoryCode: material.tpInventoryCode }, orderBy: { syncedAt: 'desc' } });
    const snapshot = await this.inventoryStock.read({ codes: [material.tpInventoryCode], scope: { kind: 'production' } }, db);
    const base = stockForCode(snapshot, material.tpInventoryCode, material.unit);
    const rows = candidates.filter((row) => isProductionWarehouse(row.warehouse));
    const latest = rows.map((row) => row.syncedAt?.toISOString()).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
    // ERP 已出现同单号的历史手工行不能再加一次；行身份未确认前只认 ERP 库存里的供给。
    const manualInTransit = view.batches.filter((batch) => !batch.purchaseOrderMirrorId)
      .reduce((sum, batch) => sum + batch.inTransitQty, 0);
    const balances = rows.length > 0 ? [{
      code: material.tpInventoryCode, stock: rows.reduce((sum, row) => sum + num(row.stockQty), 0),
      available: base.available, issues: base.issues,
      inTransit: rows.reduce((sum, row) => sum + num(row.inTransitQty), 0) + manualInTransit,
      safeStock: num(material.safeStock), syncedAt: latest,
    }] : [];
    const calculation = calculateInventoryReadiness([{
      id: material.id, category: material.category || '物料', code: material.tpInventoryCode,
      name: material.name, spec: material.spec, unit: material.unit, qtyPer: 1,
    }], balances, Math.ceil(num(plan.targetQty)));
    // 单物料允许小数采购量，不把整数“套数”算法的向上取整带进实际采购需求。
    for (const item of calculation.items) {
      item.targetDemand = num(plan.targetQty);
      item.gapAfterTransit = item.available === null ? null : Prisma.Decimal.max(new Prisma.Decimal(plan.targetQty).minus(item.available).minus(item.inTransit), 0).toNumber();
      item.currentSets = item.available;
      item.withTransitSets = item.available === null ? null : new Prisma.Decimal(item.available).plus(item.inTransit).toNumber();
      if (!item.issue && item.available !== null) item.status = item.available <= 0 ? 'shortage' : item.gapAfterTransit! > 0 ? 'gap' : item.safeStock > item.available ? 'low' : 'ready';
    }
    calculation.summary.currentBuildableSets = calculation.items[0].currentSets;
    calculation.summary.withTransitBuildableSets = calculation.items[0].withTransitSets;
    calculation.summary.inTransitGainSets = calculation.items[0].available === null ? null : calculation.items[0].inTransit;
    calculation.summary.warningMaterials = calculation.items.filter((item) => item.status !== 'ready').length;
    calculation.summary.targetSets = num(plan.targetQty);
    calculation.summary.targetGapAfterTransit = calculation.items[0].gapAfterTransit;
    return {
      source: 'tplus' as const, readOnly: true, productLine: plan.productLine || material.productLine,
      models: [{ id: plan.productLine || material.id, label: material.name, bomLines: 1 }],
      warehouse: { keyword: '量产', label: '量产仓库', matchedNames: [...new Set(rows.map((row) => row.warehouse))] },
      syncedAt: latest, stockScope: snapshot.scope, stockReadAt: snapshot.readAt, stockRows: snapshot.rows, ...calculation, orderIssues, fulfillmentSummary,
      dataQuality: { ...calculation.dataQuality, provisional: calculation.dataQuality.provisional || unresolvedOrders.size > 0 || fulfillmentSummary.hasAdjustments || fulfillmentSummary.orderedQty === null },
    };
  }

  /** 同一计划加行锁，整批建单与留痕在一个事务中；重复点击只返回已有任务。 */
  async generateStockPlanTasks(id: string, actor: ProcActor) {
    if (!actor.permissions.some((permission) => permission === '*' || permission === 'proc-task:create')) {
      throw new ForbiddenException('没有创建采购任务的权限');
    }
    return this.prisma.$transaction(async (tx) => {
      await this.lockStockPlan(tx, id);
      const plan = await this.requireStockPlan(id, tx);
      if (plan.tasks.length > 0) return { plan: await this.getStockPlanView(id, tx), createdCount: 0, existingCount: plan.tasks.length };
      if (plan.planType === 'machine' && !plan.bomRevisionId) throw new BadRequestException('请先确认本计划的 BOM 执行依据及发布版本，再首次生成采购任务');
      const productId = plan.productId?.trim();
      if (!productId) throw new BadRequestException('请先编辑备货计划并选择所属产品，再生成采购任务');
      const products = await tx.systemSetting.findUnique({ where: { key: 'rd.products' }, select: { value: true } });
      const catalog = Array.isArray(products?.value) ? products.value : [];
      const productExists = catalog.length > 0
        ? catalog.some((product) => product && typeof product === 'object' && !Array.isArray(product) && product.id === productId)
        : productId === DEFAULT_PROC_PRODUCT_ID || Boolean(await tx.procTaskTreeNode.findFirst({ where: { productId }, select: { id: true } }));
      if (!productExists) throw new BadRequestException('所属产品不存在，请先编辑备货计划并重新选择产品');
      const readiness = await this.stockPlanReadiness(plan, tx);
      if (readiness.orderIssues.some((issue) => issue.code === 'unlinked')) {
        throw new BadRequestException('存在已同步 ERP 但未明确关联订单行的手工批次，请先关联后再生成采购任务');
      }
      if (readiness.dataQuality.provisional || readiness.dataQuality.totalBomLines === 0) {
        throw new BadRequestException('BOM 用量、ERP 编码或量产库存映射不完整，请补齐后再生成采购任务');
      }
      const needed = readiness.items.filter((item) => item.gapAfterTransit !== null && item.gapAfterTransit > 0);
      const materials = await tx.procMaterial.findMany({ where: { tpInventoryCode: { in: needed.map((item) => item.code!).filter(Boolean) } } });
      const byCode = new Map(materials.map((material) => [material.tpInventoryCode, material]));
      if (needed.some((item) => !item.code || !byCode.has(item.code))) throw new BadRequestException('BOM 缺口物料尚未映射到采购物料主数据');
      const buyer = needed.length > 0 ? await this.pickAutomaticBuyer() : null;
      for (const item of needed) {
        const material = byCode.get(item.code!)!;
        const suffix = createHash('sha256').update(material.id).digest('hex').slice(0, 12);
        await tx.procTask.create({
          data: {
            code: `PR-${plan.code}-${suffix}`, stockPlanId: plan.id,
            productId, treeNodeId: plan.treeNodeId,
            materialId: material.id, materialName: material.name, spec: material.spec, unit: material.unit,
            quantity: new Prisma.Decimal(item.gapAfterTransit!).toDecimalPlaces(3, Prisma.Decimal.ROUND_CEIL),
            source: 'self', businessLine: 'production', method: 'inquiry', status: 'pending_confirm', needSample: false,
            needDate: plan.targetDate, deadline: plan.targetDate,
            buyer: buyer?.name ?? '', buyerUserId: buyer?.id ?? null,
            requester: actor.name, requesterUserId: actor.id, createdBy: actor.id,
            metadata: { stockPlanId: plan.id, stockPlanCode: plan.code, productionTaskId: plan.productionTaskId, productLine: plan.productLine, targetQty: num(plan.targetQty), gapAfterTransit: item.gapAfterTransit },
            logs: { create: { kind: 'system', text: `由备货计划 ${plan.code} 按库存及在途缺口生成${buyer ? `；自动分配给 ${buyer.name}` : ''}`, toStatus: 'pending_confirm', actor: actor.name, actorUserId: actor.id } },
          },
        });
      }
      return { plan: await this.getStockPlanView(id, tx), createdCount: needed.length, existingCount: 0 };
    }, { timeout: 30_000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  // ── 任务 ────────────────────────────────────────────────────────────────────

  async listTasks(query: ProcTaskListQuery, actor?: ProcActor) {
    const where: Prisma.ProcTaskWhereInput = {};
    const requestedStatuses = query.status?.split(',').map((status) => status.trim()).filter(Boolean) ?? [];
    if (query.businessLine) where.businessLine = query.businessLine;
    if (query.source) where.source = query.source;
    if (query.method) where.method = query.method;
    if (query.priority) where.priority = query.priority;
    if (query.buyerUserId) where.buyerUserId = query.buyerUserId;
    if (query.materialId) where.materialId = query.materialId;
    if (query.rdTaskId !== undefined && typeof query.rdTaskId !== 'string') {
      throw new BadRequestException('研发任务 ID 格式不正确');
    }
    const rdTaskId = query.rdTaskId?.trim();
    let linkedRdTaskIds = rdTaskId ? [rdTaskId] : [];
    if (query.rdTaskIds !== undefined) {
      if (query.rdLink !== 'true') throw new BadRequestException('批量研发任务查询仅支持关联采购读取');
      if (typeof query.rdTaskIds !== 'string') throw new BadRequestException('研发任务 ID 列表格式不正确');
      linkedRdTaskIds = [...new Set([...linkedRdTaskIds, ...query.rdTaskIds.split(',').map((id) => id.trim()).filter(Boolean)])];
      if (!linkedRdTaskIds.length || linkedRdTaskIds.length > 50) {
        throw new BadRequestException('请提供 1 至 50 个研发任务 ID');
      }
      where.rdTaskId = { in: linkedRdTaskIds };
    } else if (rdTaskId) {
      where.rdTaskId = rdTaskId;
    }
    const canReviewRdTransfer = actor?.permissions.includes('*')
      || actor?.permissions.includes('rd-procurement:review');
    const canReadAllProcurementTasks = actor?.permissions.includes('*')
      || actor?.permissions.includes('page:proc-cockpit')
      || actor?.permissions.includes('page:proc-materials');
    const canReadOwnProcurementTasks = actor?.permissions.includes('page:proc-my-workspace');
    if (query.rdLink === 'true') {
      // 指定任务的关联读取与继续转采购共用参与权限；无任务 ID 时仍限制原有列表范围。
      if (linkedRdTaskIds.length) {
        if (!actor) throw new ForbiddenException('请登录后查看研发任务的采购关联');
        for (const linkedRdTaskId of linkedRdTaskIds) {
          await this.rdService.requireTaskReadAccess(linkedRdTaskId, {
            userId: actor.id,
            userName: actor.name,
            permissions: actor.permissions,
          });
        }
      } else if (!canReviewRdTransfer) {
        const actorId = actor?.id || '__missing_actor__';
        where.AND = [{ OR: [{ requesterUserId: actorId }, { rdContactUserId: actorId }] }];
      }
      if (requestedStatuses.length > 0) where.status = { in: requestedStatuses };
    } else {
      if (!canReadAllProcurementTasks && !canReadOwnProcurementTasks) {
        throw new ForbiddenException('你没有查看采购任务列表的权限');
      }
      if (!canReadAllProcurementTasks) {
        const actorId = actor?.id || '__missing_actor__';
        const actorName = actor?.name?.trim() || '__missing_actor_name__';
        where.AND = [
          ...((Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []) as Prisma.ProcTaskWhereInput[]),
          {
            OR: [
              { buyerUserId: actorId },
              // 兼容历史数据：早期任务只保存了采购人姓名。新任务始终按账号 ID 归属。
              { buyerUserId: null, buyer: actorName },
            ],
          },
        ];
      }
      // 采购驾驶舱、采购工作台及采购系统树均不得看到尚未通过研发审核的申请。
      const visibleStatuses = requestedStatuses.filter((status) => status !== 'pending_rd_review');
      where.status = requestedStatuses.length > 0
        ? { in: visibleStatuses.length > 0 ? visibleStatuses : ['__hidden_status__'] }
        : { not: 'pending_rd_review' };
    }
    if (query.activeOnly === 'true') {
      const excluded = new Set<string>(PROC_TERMINAL_STATUSES);
      if (query.rdLink !== 'true') excluded.add('pending_rd_review');
      where.AND = [
        ...((Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []) as Prisma.ProcTaskWhereInput[]),
        { status: { notIn: [...excluded] } },
      ];
    }
    if (query.keyword?.trim()) {
      const kw = query.keyword.trim();
      where.OR = [
        { materialName: { contains: kw, mode: 'insensitive' } },
        { spec: { contains: kw, mode: 'insensitive' } },
        { code: { contains: kw, mode: 'insensitive' } },
        { rdTaskTitle: { contains: kw, mode: 'insensitive' } },
      ];
    }

    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 100));

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.procTask.count({ where }),
      this.prisma.procTask.findMany({
        where,
        // 驾驶舱按「最近更新」排序：确认过的排序口径，勿改回 createdAt
        // id 作为稳定次序，避免相同更新时间在 offset 分页间重复或漏项。
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: PROC_TASK_VIEW_INCLUDE,
      }),
    ]);

    const requesterDepartments = await this.getRequesterDepartmentMap(rows);
    return {
      total,
      page,
      pageSize,
      items: rows.map((row) => {
        const task = this.serializeTask(
          row,
          row.requesterUserId && requesterDepartments.has(row.requesterUserId)
            ? requesterDepartments.get(row.requesterUserId)
            : undefined,
        );
        return query.rdLink === 'true' ? this.rdLinkedTaskView(task) : task;
      }),
    };
  }

  getWorkspaceArrivalDates(refId: unknown, actor: ProcActor) {
    return readWorkspaceArrivalDates(this.prisma, refId, actor);
  }

  /** 研发关联只暴露交付状态，避免采购日志和订单行带出报价/结算细节。 */
  private rdLinkedTaskView(task: ReturnType<ProcurementService['serializeTask']>) {
    return {
      ...task,
      paymentDate: undefined, paymentStatus: undefined, paymentNote: undefined,
      selectedQuotationId: undefined, quotationSubtotal: undefined, quotationDiscount: undefined,
      quotationTotal: undefined, quotationCurrency: undefined, purchaseOrders: [],
      attachmentList: (task.attachmentList ?? []).filter((attachment) => attachment.kind !== 'quote'),
      rdTransferSnapshots: (task.rdTransferSnapshots ?? []).map((snapshot) => ({
        ...snapshot, attachments: snapshot.attachments.filter((attachment) => attachment.kind !== 'quote'),
      })),
      logs: (Array.isArray(task.logs) ? task.logs : []).filter((log) => log.fromStatus && log.toStatus && log.fromStatus !== log.toStatus)
        .map((log) => ({ ...log, text: `${PROC_STATUS_LABELS[log.fromStatus as ProcStatus] ?? log.fromStatus} → ${PROC_STATUS_LABELS[log.toStatus as ProcStatus] ?? log.toStatus}` })),
    };
  }

  async getTask(id: string, actor?: ProcActor) {
    const task = await this.prisma.procTask.findUnique({
      where: { id },
      include: {
        ...PROC_TASK_VIEW_INCLUDE,
        quotations: { orderBy: { quoteDate: 'desc' } },
        material: true,
      },
    });
    if (!task) throw new NotFoundException('采购任务不存在');
    const canReadAll = actor?.permissions.includes('*')
      || actor?.permissions.includes('page:proc-cockpit')
      || actor?.permissions.includes('page:proc-materials');
    const canReadOwn = actor?.permissions.includes('page:proc-my-workspace') && (
      task.buyerUserId === actor?.id
      || (!task.buyerUserId && Boolean(actor?.name?.trim()) && task.buyer.trim() === actor?.name.trim())
    );
    const canReadRdReview = task.status === 'pending_rd_review' && (
      actor?.permissions.includes('rd-procurement:review')
      || task.requesterUserId === actor?.id
      || task.rdContactUserId === actor?.id
    );
    if (!canReadAll && !canReadOwn && !canReadRdReview) throw new NotFoundException('采购任务不存在');
    const requesterDepartments = await this.getRequesterDepartmentMap([task]);
    return {
      ...this.serializeTask(
        task,
        task.requesterUserId && requesterDepartments.has(task.requesterUserId)
          ? requesterDepartments.get(task.requesterUserId)
          : undefined,
      ),
      quotations: task.quotations.map((q) => this.serializeQuotation(q)),
    };
  }

  async createTask(dto: CreateProcTaskDto, actor: ProcActor) {
    return this.insertTask(dto, actor, { source: 'self', status: 'pending_inquiry' });
  }

  private async notifyRdAdminsOfTransferReviewById(id: string): Promise<void> {
    const task = await this.prisma.procTask.findUnique({ where: { id } });
    if (task) await this.notifyRdAdminsOfTransferReview(task);
  }

  /** 提交后只通知具备独立“研发转采购审核”权限的启用账号。 */
  private async notifyRdAdminsOfTransferReview(task: ProcReviewNoticeTask): Promise<void> {
    try {
      const reviewers = await this.prisma.user.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, name: true, role: { select: { permissions: true } } },
      });
      const recipients = reviewers.filter((user) => {
        const permissions = Array.isArray(user.role?.permissions)
          ? (user.role.permissions as unknown[]).filter((item): item is string => typeof item === 'string')
          : [];
        return permissions.includes('*') || permissions.includes('rd-procurement:review');
      });
      const body = JSON.stringify({
        type: 'review_request',
        review_type: 'procurement_transfer',
        task_id: task.id,
        task_title: task.rdTaskTitle || task.materialName,
        rd_task_id: task.rdTaskId,
        procurement_code: task.code,
        material_name: task.materialName,
        specification: task.spec || null,
        quantity: num(task.quantity),
        unit: task.unit || null,
        procurement_method_label: task.method === 'direct' ? '电商直购' : '询价采购',
        submitter_name: task.requester || '',
        submitter_user_id: task.requesterUserId || '',
        rd_contact: task.rdContact || null,
        note: task.requesterDept ? `提出部门：${task.requesterDept}` : '',
      });
      for (const reviewer of recipients) {
        try {
          await this.rdService.createMessage({
            source: 'procurement',
            sender: { id: null, name: '系统通知', role: 'system' },
            recipient_id: reviewer.id,
            recipient_name: reviewer.name,
            subject: `[待审核·转采购] 「${task.rdTaskTitle || task.materialName}」申请转采购`,
            body,
            meta: { kind: 'rd_procurement_review', task_id: task.id },
          });
        } catch (error) {
          new Logger(ProcurementService.name).warn(
            `研发转采购待审通知发送失败（${reviewer.name}）: ${(error as Error).message}`,
          );
        }
      }
    } catch (error) {
      new Logger(ProcurementService.name).warn(
        `研发转采购审核通知发送失败（${task.code}）: ${(error as Error).message}`,
      );
    }
  }

  /**
   * 畅捷通授权断链告警：通知持有「同步畅捷通 T+」权限的人。
   *
   * 由 TplusSyncService 在自动同步发现未授权时调用，且只在状态由正常转异常时发一次。
   * 没有这条通知，断链只会体现为「补货建议悄悄少了几十条」——线上就这么过了一个月。
   */
  async notifyErpAuthBroken(reason: string, brokenSince: string): Promise<void> {
    const users = await this.prisma.user.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, name: true, role: { select: { permissions: true } } },
    });
    const recipients = users.filter((user) => {
      const permissions = Array.isArray(user.role?.permissions)
        ? (user.role.permissions as unknown[]).filter((item): item is string => typeof item === 'string')
        : [];
      return permissions.includes('*') || permissions.includes('proc:sync-erp');
    });
    const brokenDate = brokenSince.slice(0, 10);
    const body = JSON.stringify({
      type: 'system_alert',
      alert: 'tplus_auth_broken',
      reason,
      broken_since: brokenSince,
      route: '/proc-materials',
      action_label: '去重新授权',
      next_action: '畅捷通授权已失效，自动同步已停止。请到「T+ 集成」重新授权，'
        + '否则库存与采购单数据会持续过期，补货建议会把陈旧在途当成有效在途。',
    });
    for (const recipient of recipients) {
      try {
        await this.rdService.createMessage({
          source: 'procurement',
          sender: { id: null, name: '系统通知', role: 'system' },
          recipient_id: recipient.id,
          recipient_name: recipient.name,
          subject: `[畅捷通 T+] 授权已失效，自动同步自 ${brokenDate} 起停止`,
          body,
          meta: { kind: 'tplus_auth_broken', broken_since: brokenSince },
        });
      } catch (error) {
        new Logger(ProcurementService.name).warn(
          `畅捷通授权断链通知发送失败（${recipient.name}）: ${(error as Error).message}`,
        );
      }
    }
  }

  /** 研发侧「转采购」：直接进入采购待处理并自动分配采购负责人。 */
  async transferFromRd(dto: TransferFromRdDto, actor: ProcActor) {
    const rdTaskId = dto.rdTaskId.trim();
    const rdTask = await this.rdService.requireProcurementTransferAccess(rdTaskId, {
      userId: actor.id,
      userName: actor.name,
      permissions: actor.permissions,
    });
    const requesterDept = await this.resolveRequesterDepartment(actor.id, dto.requesterDept);
    const rdContact = await this.resolveRdContact(dto.rdContactUserId, dto.rdContact);
    const rdContactUserId = rdContact?.id;
    const rdContactName = rdContact?.name;
    if (
      rdContactUserId
      && !rdTask.participantUserIds.includes(rdContactUserId)
      && (!rdContactName || !rdTask.participantNames.some(
        (name) => procurementPersonNameKey(name) === procurementPersonNameKey(rdContactName),
      ))
    ) {
      throw new BadRequestException('研发对接人必须是该研发任务的主责人或协作人');
    }
    const existing = await this.prisma.procTask.findUnique({
      where: { rdTaskId },
      include: PROC_TASK_VIEW_INCLUDE,
    });
    if (existing && !['cancelled', 'pending_rd_review'].includes(existing.status)) {
      return { ...this.rdLinkedTaskView(this.serializeTask(existing)), alreadyTransferred: true };
    }
    if (!dto.attachments?.length) throw new BadRequestException('转采购需至少选择 1 个本次交付附件');
    const prepared = await this.prepareRdTransferAttachments(dto, actor);
    assertRdTransferRequirements(dto, prepared.snapshots);
    dto = { ...dto, productId: normalizeProcProductId(dto.productId ?? existing?.productId), attachments: prepared.inputs };
    const metadata = appendRdTransferSnapshot(existing?.metadata, dto, actor, rdTask.title, prepared.snapshots, {
      id: randomUUID(), submittedAt: new Date().toISOString(),
    });
    if (existing) {
      // 取消后的重新提交：更新需求内容、回到采购待处理，保留历史日志与旧附件。
      // 弹窗默认带入研发任务全部附件，与旧附件指向同一批 OSS 对象，不去重的话每重提一次就多出
      // 一份同名附件。存量附件可能没落 fileKey、只把 key 藏在 oss-preview 的 query 里，所以三种
      // 身份（fileKey / fileUrl / url 里的 key）任一命中即视为同一份。
      const attachmentIdentities = (a: { fileKey?: string | null; fileUrl?: string | null }): string[] => {
        const ids: string[] = [];
        if (a.fileKey) ids.push(`key:${a.fileKey}`);
        if (a.fileUrl) {
          ids.push(`url:${a.fileUrl}`);
          const embedded = /[?&]key=([^&]+)/.exec(a.fileUrl);
          // 存量地址可能带坏的百分号转义，decode 抛错不该让整个重新提交 500
          if (embedded) {
            try {
              ids.push(`key:${decodeURIComponent(embedded[1])}`);
            } catch {
              ids.push(`key:${embedded[1]}`);
            }
          }
        }
        return ids;
      };
      const keptAttachmentKeys = new Set(existing.attachments.flatMap(attachmentIdentities));
      const newAttachments = (dto.attachments ?? []).filter(
        (a) => !attachmentIdentities(a).some((id) => keptAttachmentKeys.has(id)),
      );
      const buyer = await this.requireAutomaticRdBuyer();
      const updated = await this.prisma.procTask.update({
        // 同一次条件更新写入状态、附件与日志，阻止并发重提覆盖已进入采购处理的任务。
        where: { id: existing.id, status: existing.status, updatedAt: existing.updatedAt },
        data: {
          productId: normalizeProcProductId(dto.productId ?? existing.productId),
          materialName: dto.materialName,
          spec: dto.spec ?? '',
          unit: dto.unit ?? '',
          quantity: new Prisma.Decimal(dto.quantity ?? 0),
          method: dto.method ?? 'inquiry',
          purchaseLink: dto.purchaseLink ?? null,
          priority: dto.priority ?? 'medium',
          needSample: dto.needSample ?? false,
          needDate: parseDay(dto.needDate),
          deadline: parseDay(dto.deadline),
          rdTaskTitle: rdTask.title,
          rdContact: rdContactName ?? existing.rdContact,
          rdContactUserId: rdContactUserId ?? existing.rdContactUserId,
          requester: actor.name,
          requesterUserId: actor.id,
          requesterDept,
          consumableNote: dto.consumableNote ?? existing.consumableNote,
          status: 'pending_confirm',
          buyer: buyer.name,
          buyerUserId: buyer.id,
          cancelReason: null,
          metadata,
          ...(newAttachments.length
            ? { attachments: { create: newAttachments.map((a) => this.attachmentData(a, actor)) } }
            : {}),
          logs: {
            create: {
              kind: 'action',
              text: `研发修改后重新提交转采购，自动分配给采购负责人 ${buyer.name}`,
              fromStatus: existing.status,
              toStatus: 'pending_confirm',
              actor: actor.name,
              actorUserId: actor.id,
            },
          },
        },
        include: PROC_TASK_VIEW_INCLUDE,
      }).catch((error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
          throw new ConflictException('该采购任务已重新提交或已进入采购处理，请刷新后查看');
        }
        throw error;
      });
      if (existing.status === 'pending_rd_review') await this.markRdTransferReviewMessagesHandled(existing.id).catch((error) => new Logger(ProcurementService.name).warn(`转采购待审消息置为已处理失败（${existing.code}）: ${(error as Error).message}`));
      await this.notifyBuyerOfRdTransferAssignment(updated, buyer, actor).catch((error) =>
        new Logger(ProcurementService.name).warn(`转采购分配通知失败（${updated.code}）: ${(error as Error).message}`),
      );
      return { ...this.rdLinkedTaskView(this.serializeTask(updated)), alreadyTransferred: false };
    }
    if (!dto.attachments?.length) {
      // 研发侧不强制校验业务字段，但必须带附件（图纸/说明），否则采购无从下手
      throw new BadRequestException('转采购需至少上传 1 个附件');
    }
    try {
      const created = await this.insertTask(dto, actor, {
        source: 'rd',
        status: 'pending_confirm',
        rdTaskId,
        rdTaskTitle: rdTask.title,
        rdContact: rdContactName,
        rdContactUserId,
        metadata,
      });
      return this.rdLinkedTaskView(created);
    } catch (error) {
      // 数据库唯一约束兜住并发双击/网络重试；若另一请求已成功，返回同一采购任务。
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const transferred = await this.prisma.procTask.findUnique({
          where: { rdTaskId },
          include: PROC_TASK_VIEW_INCLUDE,
        });
        if (transferred) {
          return { ...this.rdLinkedTaskView(this.serializeTask(transferred)), alreadyTransferred: true };
        }
      }
      throw error;
    }
  }

  private async prepareRdTransferAttachments(dto: TransferFromRdDto, actor: ProcActor) {
    const versionIds = [...new Set((dto.attachments ?? []).flatMap((attachment) =>
      attachment.technicalDocumentVersionId ? [attachment.technicalDocumentVersionId.trim()] : []))];
    if (versionIds.some((id) => !id)) throw new BadRequestException('技术资料版本编号不能为空');
    if (versionIds.length && !this.technicalDocuments) throw new BadRequestException('技术资料版本服务暂不可用，请稍后重试');
    const versions = versionIds.length ? await this.technicalDocuments!.resolveTransferVersions(dto.rdTaskId.trim(), versionIds, {
      userId: actor.id, userName: actor.name, permissions: actor.permissions,
    }) : [];
    const byVersion = new Map(versions.map((version) => [version.id, version]));
    const snapshots: RdTransferSnapshotAttachment[] = [];
    const inputs = (dto.attachments ?? []).map((input): ProcAttachmentInputDto => {
      const versionId = input.technicalDocumentVersionId?.trim();
      const version = versionId ? byVersion.get(versionId) : undefined;
      if (versionId && !version) throw new BadRequestException('所选技术资料版本不存在或不属于该研发任务');
      // A version ID is a reference only: file identity and display fields come from the server.
      const attachment: ProcAttachmentInputDto = version ? {
        technicalDocumentVersionId: version.id, fileName: version.fileName,
        fileUrl: version.fileUrl, fileKey: version.fileKey ?? undefined,
        fileSize: version.fileSize, mimeType: version.mimeType ?? undefined, kind: 'drawing',
      } : input;
      if (attachment.fileKey && !this.isAllowedAttachmentFileKey(attachment.fileKey)) {
        throw new BadRequestException(`附件「${attachment.fileName}」的存储路径不合法`);
      }
      const stored = this.attachmentData(attachment, actor);
      snapshots.push({
        fileName: stored.fileName, fileUrl: stored.fileUrl, fileKey: stored.fileKey ?? null,
        fileSize: stored.fileSize ?? 0, mimeType: stored.mimeType ?? null, kind: stored.kind ?? 'drawing',
        technicalDocumentVersionId: version?.id ?? null, documentId: version?.documentId ?? null,
        version: version ? String(version.version) : null, category: version?.category ?? null,
        title: version?.title ?? null, attachmentId: version?.attachmentId ?? null,
        sourceNoteId: version?.sourceNoteId ?? null, versionCreatedAt: version?.createdAt.toISOString() ?? null,
      });
      return attachment;
    });
    return { inputs, snapshots };
  }

  /**
   * AI 建单解析：自然语言/商品链接 → 建单草稿（不落库，前端确认后走 createTask）。
   * AI 超时或输出不可解析时降级启发式（数量/单位/链接/日期正则），保证入口始终可用。
   */
  async aiParseTask(dto: AiParseTaskDto) {
    const text = dto.text.trim();
    let draft = this.heuristicParseTask(text);
    let model = 'heuristic';
    let usedAI = false;
    try {
      const result = await this.chatService.complete({
        system: [
          '你是采购需求解析助手。把用户输入的采购需求（可能含电商商品链接）解析为 JSON 对象，字段：',
          'materialName(物料名称,string,必填,尽量简短规范)、spec(规格型号,string)、unit(单位,string,如 件/个/米)、',
          'quantity(数量,number)、method("inquiry"询价|"direct"电商直购,含商品链接时为direct)、purchaseLink(商品链接,string)、',
          'needDate(需求日期,YYYY-MM-DD)、deadline(最晚到货,YYYY-MM-DD)、priority("high"|"medium"|"low")、needSample(是否需要样品,boolean)。',
          `今天是 ${new Date().toISOString().slice(0, 10)}，「7月中旬」这类模糊时间换算成具体日期。`,
          '未提及的字段省略，不要编造。只输出 JSON。',
        ].join('\n'),
        messages: [{ role: 'user', content: text }],
        // 显式声明场景：漏传时会落进 chat.utility_completion 兜底，导致控制台里的
        // 「采购需求解析」成为永远匹配不上的死场景（配了路由也不生效）
        scene: 'procurement.requirement_parse',
        json: true,
        temperature: 0,
        timeoutMs: 30_000,
        maxRetries: 0,
        maxTokens: 400,
      });
      const parsed = this.parseAiTaskDraft(result.content);
      if (parsed?.materialName) {
        draft = { ...draft, ...parsed };
        model = result.model;
        usedAI = true;
      }
    } catch {
      // AI 不可用时静默降级启发式草稿
    }
    // 物料主数据匹配：命中已有物料则带上 materialId，规格/单位回填
    if (draft.materialName) {
      const material = await this.prisma.procMaterial.findFirst({
        where: { name: { contains: draft.materialName.slice(0, 20), mode: 'insensitive' } },
        select: { id: true, name: true, spec: true, unit: true },
      });
      if (material) {
        draft.materialId = material.id;
        draft.materialName = material.name;
        if (!draft.spec) draft.spec = material.spec;
        if (!draft.unit) draft.unit = material.unit;
      }
    }
    return { draft, model, usedAI };
  }

  private parseAiTaskDraft(content: string): AiTaskDraft | null {
    try {
      const jsonText = content.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
      const raw = JSON.parse(jsonText) as Record<string, unknown>;
      const str = (v: unknown, max: number) =>
        typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;
      const draft: AiTaskDraft = {};
      const materialName = str(raw.materialName, 200);
      if (materialName) draft.materialName = materialName;
      const spec = str(raw.spec, 200);
      if (spec) draft.spec = spec;
      const unit = str(raw.unit, 20);
      if (unit) draft.unit = unit;
      const quantity = Number(raw.quantity);
      if (Number.isFinite(quantity) && quantity > 0) draft.quantity = quantity;
      if (raw.method === 'inquiry' || raw.method === 'direct') draft.method = raw.method;
      const purchaseLink = str(raw.purchaseLink, 1000);
      if (purchaseLink) draft.purchaseLink = purchaseLink;
      const dayRe = /^\d{4}-\d{2}-\d{2}$/;
      const needDate = str(raw.needDate, 32);
      if (needDate && dayRe.test(needDate)) draft.needDate = needDate;
      const deadline = str(raw.deadline, 32);
      if (deadline && dayRe.test(deadline)) draft.deadline = deadline;
      if (raw.priority === 'high' || raw.priority === 'medium' || raw.priority === 'low')
        draft.priority = raw.priority;
      if (typeof raw.needSample === 'boolean') draft.needSample = raw.needSample;
      return draft;
    } catch {
      return null;
    }
  }

  /** 启发式兜底：链接/数量+单位/日期正则，物料名取去掉链接与数量后的主体。 */
  private heuristicParseTask(text: string): AiTaskDraft {
    const linkMatch = text.match(/https?:\/\/\S+/);
    const qtyMatch = text.match(
      /(\d+(?:\.\d+)?)\s*(件|个|只|米|张|套|条|台|支|卷|包|盒|片|公斤|千克|kg|吨|桶|瓶)/i,
    );
    const dateMatch = text.match(/(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})/);
    let name = text
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/(\d+(?:\.\d+)?)\s*(件|个|只|米|张|套|条|台|支|卷|包|盒|片|公斤|千克|kg|吨|桶|瓶)/gi, ' ')
      .replace(/(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})日?/g, ' ')
      .replace(/^(采购|购买|需要|申购|求购|买)\s*/g, '')
      .replace(/[，。,.;；:：]?(前到货|之前到货|到货|要求|尽快|急).*$/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (name.length > 60) name = name.slice(0, 60);
    return {
      ...(name ? { materialName: name } : {}),
      ...(qtyMatch ? { quantity: Number(qtyMatch[1]), unit: qtyMatch[2] } : {}),
      ...(linkMatch
        ? { method: 'direct' as const, purchaseLink: linkMatch[0].replace(/[，。,.;；]+$/, '') }
        : { method: 'inquiry' as const }),
      ...(dateMatch
        ? {
            needDate: `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}`,
          }
        : {}),
    };
  }

  private async insertTask(
    dto: CreateProcTaskDto,
    actor: ProcActor,
    extra: {
      source: 'rd' | 'self';
      status: ProcStatus;
      rdTaskId?: string;
      rdTaskTitle?: string;
      rdContact?: string;
      rdContactUserId?: string;
      metadata?: Prisma.InputJsonObject;
    },
  ) {
    for (const attachment of dto.attachments ?? []) {
      if (!attachment.fileKey) continue;
      const allowed = [
        OSS_BUSINESS_TYPES.RD_PROGRESS_NOTES,
        OSS_BUSINESS_TYPES.ASSETS,
        OSS_BUSINESS_TYPES.UPLOADS_TEMP,
      ].some((businessType) => this.ossService.isKeyUnderBusinessType(attachment.fileKey!, businessType));
      if (!allowed) throw new BadRequestException(`附件「${attachment.fileName}」的存储路径不合法`);
    }
    const code = await this.nextTaskCode();
    const method = dto.method ?? 'inquiry';
    const requesterDept = await this.resolveRequesterDepartment(actor.id, dto.requesterDept);
    const requestedBuyer = extra.source === 'rd' ? '' : dto.buyer?.trim();
    const automaticBuyer = extra.source === 'rd'
      ? await this.requireAutomaticRdBuyer()
      : requestedBuyer ? null : await this.pickAutomaticBuyer();
    const resolvedBuyer = requestedBuyer
      ? await this.resolveAssignableBuyer(dto.buyerUserId, requestedBuyer)
      : automaticBuyer;
    const buyer = resolvedBuyer?.name || '';
    const buyerUserId = resolvedBuyer?.id ?? null;
    const task = await this.prisma.procTask.create({
      data: {
        code,
        productId: normalizeProcProductId(dto.productId),
        materialId: dto.materialId ?? null,
        materialName: dto.materialName,
        spec: dto.spec ?? '',
        unit: dto.unit ?? '',
        quantity: new Prisma.Decimal(dto.quantity ?? 0),
        method,
        purchaseLink: dto.purchaseLink ?? null,
        source: extra.source,
        businessLine: dto.businessLine ?? (extra.source === 'rd' ? 'rd' : 'production'),
        status: extra.status,
        priority: dto.priority ?? 'medium',
        needSample: dto.needSample ?? false,
        needDate: parseDay(dto.needDate),
        deadline: parseDay(dto.deadline),
        buyer,
        buyerUserId,
        rdTaskId: extra.rdTaskId ?? null,
        rdTaskTitle: extra.rdTaskTitle ?? null,
        rdContact: extra.rdContact ?? null,
        rdContactUserId: extra.rdContactUserId ?? null,
        requester: actor.name,
        requesterUserId: actor.id,
        requesterDept,
        consumableNote: dto.consumableNote ?? null,
        createdBy: actor.id,
        ...(extra.metadata ? { metadata: extra.metadata } : {}),
        attachments: { create: (dto.attachments ?? []).map((a) => this.attachmentData(a, actor)) },
        logs: {
          create: {
            kind: 'system',
            text:
              extra.source === 'rd'
                ? `由研发任务「${extra.rdTaskTitle ?? extra.rdTaskId ?? '-'}」转采购，自动分配给采购负责人 ${buyer}`
                : `采购自建任务${automaticBuyer ? `；按当前负载自动分配给 ${automaticBuyer.name}` : ''}`,
            toStatus: extra.status,
            actor: actor.name,
            actorUserId: actor.id,
          },
        },
      },
      include: PROC_TASK_VIEW_INCLUDE,
    });
    if (extra.source === 'rd' && resolvedBuyer) {
      await this.notifyBuyerOfRdTransferAssignment(task, resolvedBuyer, actor).catch((error) =>
        new Logger(ProcurementService.name).warn(`转采购分配通知失败（${task.code}）: ${(error as Error).message}`),
      );
    }
    return this.serializeTask(task);
  }

  private attachmentData(a: ProcAttachmentInputDto, actor: ProcActor) {
    return {
      fileName: a.fileName,
      fileUrl: a.fileUrl,
      // 客户端没带 key 时从地址反解：只存一条会过期的短效地址、又没有 key 可重签，
      // 正是存量附件打不开的原因，新数据不要再走进同一个坑。
      // 必须走 resolveAttachmentFileKey 而不是裸的 extractObjectKey：insertTask 的业务前缀
      // 白名单只在客户端显式传了 fileKey 时才生效，这里若不校验，把 key 藏进 fileUrl 就能
      // 绕过它、往库里写一个越权路径。写入侧与读取侧必须同口径。
      fileKey: this.resolveAttachmentFileKey(a.fileKey ?? null, a.fileUrl),
      fileSize: a.fileSize ?? 0,
      mimeType: a.mimeType ?? null,
      kind: a.kind ?? 'drawing',
      uploadedBy: actor.id,
    };
  }

  /** 客户端只提供提示；账号必须由后端校验，防止伪造 user id 把通知投递给无关人员。 */
  private async resolveRdContact(
    userId?: string,
    contactName?: string,
  ): Promise<{ id: string; name: string } | undefined> {
    const cleanId = userId?.trim();
    const cleanName = contactName?.trim();
    if (cleanId) {
      const user = await this.prisma.user.findFirst({
        where: { id: cleanId, status: 'ACTIVE' },
        select: { id: true, name: true },
      });
      if (!user) throw new BadRequestException('研发对接人账号不存在、未激活或已停用');
      if (cleanName && procurementPersonNameKey(user.name) !== procurementPersonNameKey(cleanName)) {
        throw new BadRequestException('研发对接人与账号不匹配，请重新选择');
      }
      return user;
    }
    if (!cleanName) return undefined;
    const activeUsers = await this.prisma.user.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, name: true },
    });
    const contactKey = procurementPersonNameKey(cleanName);
    const matches = activeUsers.filter((user) => procurementPersonNameKey(user.name) === contactKey);
    if (matches.length === 0) throw new BadRequestException('研发对接人账号不存在、未激活或已停用');
    if (matches.length > 1) throw new BadRequestException('存在同名研发对接人，请从人员列表重新选择');
    return matches[0];
  }

  /** 任务编号 PR-YYYYMMDD-NNN，按天累计。 */
  private async nextTaskCode() {
    const today = new Date();
    const stamp = today.toISOString().slice(0, 10).replace(/-/g, '');
    const prefix = `PR-${stamp}-`;
    const last = await this.prisma.procTask.findFirst({
      where: { code: { startsWith: prefix } },
      orderBy: { code: 'desc' },
      select: { code: true },
    });
    const seq = last ? Number(last.code.slice(prefix.length)) + 1 : 1;
    return `${prefix}${String(Number.isFinite(seq) ? seq : 1).padStart(3, '0')}`;
  }

  async updateTask(id: string, dto: UpdateProcTaskDto, actor: ProcActor) {
    const current = await this.requireTask(id);
    if (current.status === 'pending_rd_review') {
      throw new BadRequestException('该申请尚待研发管理员审核，采购侧不能修改任务');
    }
    const data: Prisma.ProcTaskUpdateInput = {};
    if (dto.quantity !== undefined) data.quantity = new Prisma.Decimal(dto.quantity);
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.needDate !== undefined) data.needDate = parseDay(dto.needDate);
    if (dto.deadline !== undefined) data.deadline = parseDay(dto.deadline);
    if (dto.expectedArrivalDate !== undefined)
      data.expectedArrivalDate = parseDay(dto.expectedArrivalDate);
    if (dto.paymentDate !== undefined) data.paymentDate = parseDay(dto.paymentDate);
    if (dto.paymentStatus !== undefined) data.paymentStatus = dto.paymentStatus;
    if (dto.paymentNote !== undefined) data.paymentNote = dto.paymentNote;
    if (dto.consumableNote !== undefined) data.consumableNote = dto.consumableNote;
    if (dto.purchaseLink !== undefined) data.purchaseLink = dto.purchaseLink;
    if (dto.businessDone !== undefined) data.businessDone = dto.businessDone;

    const task = await this.prisma.procTask.update({
      where: { id },
      data: {
        ...data,
        logs: {
          create: { kind: 'action', text: '更新任务信息', actor: actor.name, actorUserId: actor.id },
        },
      },
      include: PROC_TASK_VIEW_INCLUDE,
    });
    return this.serializeTask(task);
  }

  async setTaskCriticalMaterials(
    id: string,
    dto: SetProcTaskCriticalMaterialsDto,
    actor: ProcActor,
  ) {
    const current = await this.requireTask(id);
    if (current.status === 'pending_rd_review') {
      throw new BadRequestException('该申请尚待研发管理员审核，采购侧不能配置重点物料');
    }
    const items = dto.items.map((item) => ({
      materialId: item.materialId.trim(),
      leadTimeDays: item.leadTimeDays ?? null,
    }));
    const materialIds = items.map((item) => item.materialId);
    if (new Set(materialIds).size !== materialIds.length) {
      throw new BadRequestException('同一任务不能重复配置同一个重点物料');
    }

    if (materialIds.length > 0) {
      const existingMaterials = await this.prisma.procMaterial.findMany({
        where: { id: { in: materialIds } },
        select: {
          id: true,
          tpInventoryCode: true,
          balances: {
            where: { syncedAt: { not: null } },
            select: { id: true },
            take: 1,
          },
        },
      });
      if (existingMaterials.length !== materialIds.length) {
        throw new BadRequestException('重点物料配置中包含不存在的物料');
      }
      const hasUnavailableMaterial = existingMaterials.some((material) => (
        !material.tpInventoryCode?.trim() || material.balances.length === 0
      ));
      if (hasUnavailableMaterial) {
        throw new BadRequestException('重点物料必须已关联 T+ 并完成库存同步');
      }
    }

    const task = await this.prisma.procTask.update({
      where: { id },
      data: {
        criticalMaterials: {
          deleteMany: {},
          ...(items.length > 0
            ? {
                create: items.map((item, sortOrder) => ({
                  material: { connect: { id: item.materialId } },
                  sortOrder,
                  leadTimeDays: item.leadTimeDays,
                })),
              }
            : {}),
        },
        logs: {
          create: {
            kind: 'action',
            text: `更新重点物料库存配置（${items.length} 项）`,
            actor: actor.name,
            actorUserId: actor.id,
          },
        },
      },
      include: PROC_TASK_VIEW_INCLUDE,
    });
    return this.serializeTask(task);
  }

  /** 采购确认（待处理 → 待询价 / 待购买）。分支由 method 决定。 */
  async confirmTask(id: string, actor: ProcActor) {
    const task = await this.requireTask(id);
    if (task.status !== 'pending_confirm') {
      throw new BadRequestException('只有「待处理」的任务需要确认');
    }
    const next: ProcStatus = task.method === 'direct' ? 'pending_purchase' : 'pending_inquiry';
    const updated = await this.applyTransition(id, next, actor, '采购已确认接收', task.status);
    if (task.source === 'rd') {
      await this.notifyProcReviewResult(task, actor, 'approved', next);
    }
    return updated;
  }

  private async requireAutomaticRdBuyer() {
    const buyer = await this.pickAutomaticBuyer();
    if (!buyer) {
      throw new BadRequestException('采购部门暂无同时具备采购个人工作台权限的在职人员，请先配置人员与角色权限');
    }
    return buyer;
  }

  /** 存量前置待审申请由原任务参与人继续流转；不要求研发审核权限，也不在读取时改库。 */
  async continueRdTransfer(id: string, actor: ProcActor) {
    const task = await this.prisma.procTask.findUnique({ where: { id }, include: PROC_TASK_VIEW_INCLUDE });
    if (!task) throw new NotFoundException('采购任务不存在');
    if (task.source !== 'rd' || !task.rdTaskId) {
      throw new BadRequestException('该采购任务不是研发流转任务');
    }
    await this.rdService.requireProcurementTransferAccess(task.rdTaskId, {
      userId: actor.id,
      userName: actor.name,
      permissions: actor.permissions,
    });
    if (task.status !== 'pending_rd_review') {
      if (task.status === 'cancelled') throw new BadRequestException('已取消的采购任务请修改后重新提交');
      return { ...this.rdLinkedTaskView(this.serializeTask(task)), alreadyTransferred: true };
    }
    return this.rdLinkedTaskView(await this.activateLegacyRdTransfer(task, actor, false));
  }

  /** 兼容旧版审核入口；新增流转均直接进入采购待处理。 */
  async approveRdTransfer(id: string, actor: ProcActor) {
    const task = await this.requireTask(id);
    if (task.source !== 'rd' || task.status !== 'pending_rd_review') {
      throw new BadRequestException('仅「待研发审核」的转采购申请可审核通过');
    }
    return this.activateLegacyRdTransfer(task, actor, true);
  }

  private async activateLegacyRdTransfer(task: ProcReviewNoticeTask, actor: ProcActor, legacyReview: boolean) {
    const id = task.id;
    const saved = await this.prisma.procTask.findUniqueOrThrow({ where: { id } });
    const delivery = rdTransferSnapshotsOf(saved.metadata).at(-1);
    assertRdTransferRequirements({ rdTaskId: saved.rdTaskId!, materialName: saved.materialName, quantity: num(saved.quantity), unit: saved.unit, spec: saved.spec, needDate: day(saved.needDate), needDateNotApplicableReason: delivery?.requirement.needDateNotApplicableReason ?? undefined, specNotApplicableReason: delivery?.requirement.specNotApplicableReason ?? undefined }, delivery?.attachments ?? []);
    const buyer = await this.requireAutomaticRdBuyer();
    const updated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.procTask.updateMany({
        where: { id, source: 'rd', status: 'pending_rd_review', updatedAt: saved.updatedAt },
        data: {
          status: 'pending_confirm',
          buyer: buyer.name,
          buyerUserId: buyer.id,
        },
      });
      if (claimed.count !== 1) throw new ConflictException('该转采购申请已被其他审核人处理，请刷新后查看');
      await tx.procTaskLog.create({
        data: {
          taskId: id,
          kind: 'action',
          text: `研发任务继续转采购，按当前负载分配给采购负责人 ${buyer.name}`,
          fromStatus: 'pending_rd_review',
          toStatus: 'pending_confirm',
          actor: actor.name,
          actorUserId: actor.id,
        },
      });
      return tx.procTask.findUniqueOrThrow({ where: { id }, include: PROC_TASK_VIEW_INCLUDE });
    });
    await this.markRdTransferReviewMessagesHandled(id).catch((error) =>
      new Logger(ProcurementService.name).warn(`转采购待审消息置为已处理失败（${task.code}）: ${(error as Error).message}`),
    );
    if (legacyReview) {
      await this.notifyRdTransferReviewResult(task, actor, 'approved', '', buyer.name).catch((error) =>
        new Logger(ProcurementService.name).warn(`转采购通过结果通知失败（${task.code}）: ${(error as Error).message}`),
      );
    }
    await this.notifyBuyerOfRdTransferAssignment(task, buyer, actor).catch((error) =>
      new Logger(ProcurementService.name).warn(`转采购分配通知失败（${task.code}）: ${(error as Error).message}`),
    );
    return this.serializeTask(updated);
  }

  /** 研发管理员打回前置审核：删除本次流转，原研发任务可修改后再次提交。 */
  async rejectRdTransfer(id: string, reason: string, actor: ProcActor) {
    const trimmed = reason.trim();
    if (!trimmed) throw new BadRequestException('打回必须填写理由');
    const task = await this.requireTask(id);
    if (task.source !== 'rd' || task.status !== 'pending_rd_review') {
      throw new BadRequestException('仅「待研发审核」的转采购申请可打回');
    }
    const deleted = await this.prisma.procTask.deleteMany({
      where: { id, source: 'rd', status: 'pending_rd_review' },
    });
    if (deleted.count !== 1) throw new ConflictException('该转采购申请已被其他审核人处理，请刷新后查看');
    await this.markRdTransferReviewMessagesHandled(id).catch((error) =>
      new Logger(ProcurementService.name).warn(`转采购待审消息置为已处理失败（${task.code}）: ${(error as Error).message}`),
    );
    await this.notifyRdTransferReviewResult(task, actor, 'rejected', trimmed).catch((error) =>
      new Logger(ProcurementService.name).warn(`转采购打回结果通知失败（${task.code}）: ${(error as Error).message}`),
    );
    return { ok: true, deletedId: id };
  }

  private async markRdTransferReviewMessagesHandled(procTaskId: string) {
    await this.prisma.rdMessage.updateMany({
      where: { type: 'review_request', taskId: procTaskId, handled: false },
      data: { handled: true, read: true },
    });
    await this.prisma.rdMessage.updateMany({
      where: { type: 'procurement_transfer_returned', taskId: procTaskId, handled: false },
      data: { handled: true, read: true },
    });
  }

  /** 回退后由原研发参与人继续流转；收件人必须当前有转采购权限及可打开的研发入口。 */
  private async notifyRdTransferReturned(task: ProcReviewNoticeTask, actor: ProcActor, reason: string): Promise<void> {
    if (!task.rdTaskId) return;
    const logger = new Logger(ProcurementService.name);
    try {
      const users = await this.prisma.user.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, name: true, role: { select: { permissions: true } } },
      });
      const relatedIds = new Set<string>();
      for (const [id, name] of [[task.requesterUserId, task.requester], [task.rdContactUserId, task.rdContact]]) {
        // 已有账号不改投同名账号；仅历史无账号记录允许唯一姓名回填。
        if (id) relatedIds.add(id);
        else if (name?.trim()) {
          const matches = users.filter((user) => user.name.trim() === name.trim());
          if (matches.length === 1) relatedIds.add(matches[0].id);
        }
      }
      const recipients: Array<{ id: string; name: string; route: string }> = [];
      const fallbackManagers: typeof recipients = [];
      const encodedTaskId = encodeURIComponent(task.rdTaskId);
      for (const user of users) {
        const permissions = Array.isArray(user.role?.permissions)
          ? user.role.permissions.filter((value): value is string => typeof value === 'string') : [];
        if (!permissions.includes('*') && !permissions.includes('proc-task:transfer')) continue;
        const route = permissions.includes('*') ? `/rd-task/${encodedTaskId}`
          : permissions.includes('page:rd-my-workspace') ? `/rd-my-workspace?task=${encodedTaskId}`
            : permissions.some((permission) => ['page:rd-task-management', 'page:rd-director-dashboard'].includes(permission))
              ? `/rd-task/${encodedTaskId}` : null;
        if (!route) continue;
        try {
          const rdTask = await this.rdService.requireProcurementTransferAccess(task.rdTaskId, {
            userId: user.id, userName: user.name, permissions,
          });
          const isParticipant = rdTask.participantUserIds.includes(user.id)
            || (!rdTask.participantUserIds.length && rdTask.participantNames.includes(user.name.trim())
              && users.filter((candidate) => candidate.name.trim() === user.name.trim()).length === 1);
          const recipient = { id: user.id, name: user.name, route };
          if (relatedIds.has(user.id) || isParticipant || permissions.includes('*')) recipients.push(recipient);
          else fallbackManagers.push(recipient);
        } catch {
          // 与继续入口复用同一任务参与校验；已离开任务或任务不可继续时不投递处理待办。
        }
      }
      if (!recipients.length) recipients.push(...fallbackManagers);
      if (!recipients.length) logger.warn(`退回研发通知无可处理收件人（${task.code}）`);
      await this.prisma.$transaction(async (tx) => {
        // 继续转采购与通知发布串行，避免继续动作先完成、迟到通知又变成永久待办。
        await tx.$queryRaw`SELECT id FROM "ProcTask" WHERE id = ${task.id} FOR NO KEY UPDATE`;
        const current = await tx.procTask.findUnique({ where: { id: task.id }, select: { status: true } });
        if (current?.status !== 'pending_rd_review') return;
        for (const recipient of recipients) {
          try {
            await this.rdService.createMessage({
              source: 'procurement', sender: { id: actor.id, name: actor.name, role: '采购' },
              recipient_id: recipient.id, recipient_name: recipient.name,
              subject: `采购已退回 · 请继续转采购 · ${task.materialName}`,
              body: JSON.stringify({
                type: 'procurement_transfer_returned', task_id: task.id, procurement_task_id: task.id,
                procurement_code: task.code, rd_task_id: task.rdTaskId, rd_task_title: task.rdTaskTitle,
                material_name: task.materialName, specification: task.spec || null, quantity: num(task.quantity), unit: task.unit || null,
                reason, returned_by: actor.name, returned_at: new Date().toISOString(),
                route: recipient.route, action_label: '继续转采购',
                next_action: '请返回原研发任务，核对退回原因后点击「继续转采购」；继续后系统自动分配采购负责人。无需管理员审批。',
              }),
              meta: { kind: 'procurement_transfer_returned', task_id: task.id, route: recipient.route },
            }, tx);
          } catch (error) {
            logger.warn(`退回研发通知发送失败（${recipient.name}）: ${(error as Error).message}`);
          }
        }
      });
    } catch (error) {
      logger.warn(`退回研发通知处理失败: ${(error as Error).message}`);
    }
  }

  private async notifyRdTransferReviewResult(
    task: ProcReviewNoticeTask,
    actor: ProcActor,
    outcome: 'approved' | 'rejected',
    reason = '',
    buyerName = '',
  ) {
    const relatedRecipientIds = new Set(
      [task.requesterUserId, task.rdContactUserId].filter((id): id is string => Boolean(id)),
    );
    const directory = await this.prisma.user.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, name: true, role: { select: { permissions: true } } },
    });
    const users = directory.filter((user) => {
      const permissions = Array.isArray(user.role?.permissions)
        ? (user.role.permissions as unknown[]).filter((item): item is string => typeof item === 'string')
        : [];
      return relatedRecipientIds.has(user.id) || permissions.includes('*');
    });
    const approved = outcome === 'approved';
    for (const recipient of users) {
      try {
        await this.rdService.createMessage({
          source: 'procurement',
          sender: { id: actor.id, name: actor.name, role: '研发管理员' },
          recipient_id: recipient.id,
          recipient_name: recipient.name,
          subject: approved
            ? `[审核结果·转采购] 「${task.rdTaskTitle || task.materialName}」已通过研发审核`
            : `[审核结果·转采购] 「${task.rdTaskTitle || task.materialName}」被打回`,
          body: JSON.stringify({
            type: 'review_result',
            review_type: 'procurement_transfer',
            review_stage: 'rd_gate',
            result: outcome,
            task_id: task.rdTaskId || task.id,
            rd_task_id: task.rdTaskId,
            procurement_task_id: task.id,
            procurement_code: task.code,
            task_title: task.rdTaskTitle || task.materialName,
            material_name: task.materialName,
            specification: task.spec || null,
            quantity: num(task.quantity),
            unit: task.unit || null,
            procurement_method_label: task.method === 'direct' ? '电商直购' : '询价采购',
            buyer_name: approved ? buyerName : null,
            reviewer_name: actor.name,
            reason: reason || null,
            note: approved
              ? `已分配给采购负责人 ${buyerName}，等待采购确认接收。`
              : '请按打回原因修改后重新转采购。',
          }),
        });
      } catch (error) {
        new Logger(ProcurementService.name).warn(
          `转采购前置审核结果通知发送失败（${recipient.name}）: ${(error as Error).message}`,
        );
      }
    }
  }

  /** 研发任务分配后通知实际采购负责人。 */
  private async notifyBuyerOfRdTransferAssignment(
    task: ProcReviewNoticeTask,
    buyer: { id: string; name: string },
    actor: ProcActor,
  ) {
    await this.rdService.createMessage({
      source: 'procurement',
      sender: { id: actor.id, name: actor.name, role: '研发人员' },
      recipient_id: buyer.id,
      recipient_name: buyer.name,
      subject: `新采购任务已分配 · ${task.materialName}`,
      body: JSON.stringify({
        type: 'procurement_assignment',
        task_id: task.id,
        procurement_task_id: task.id,
        procurement_code: task.code,
        rd_task_id: task.rdTaskId,
        rd_task_title: task.rdTaskTitle,
        material_name: task.materialName,
        specification: task.spec || null,
        quantity: num(task.quantity),
        unit: task.unit || null,
        procurement_method_label: task.method === 'direct' ? '电商直购' : '询价采购',
        assigned_by: actor.name,
        route: `/proc-my-workspace?task=${encodeURIComponent(task.id)}`,
        action_label: '打开采购任务',
        next_action: '请在采购个人工作台确认接收并继续处理。',
      }),
      meta: { kind: 'procurement_assignment', task_id: task.id },
    });
  }

  /**
   * 完成询价：由「询价中」按需样情况决定去向，是报价确认之后的第二步。
   *
   * 拆成独立一步是为了消灭跳步——此前「待询价」确认报价会一次性写到
   * 已定价/待到样/测试中，用户看到的就是「点一下从待询价窜到已定价」。
   * 现在确认报价只到「询价中」，去哪一档由这里单独决定，每次点击只走一格。
   */
  async completeInquiry(taskId: string, actor: ProcActor, note?: string) {
    const task = await this.requireTask(taskId);
    if (task.status !== 'inquiring') {
      throw new BadRequestException(
        `只有「询价中」的任务可完成询价，当前是「${PROC_STATUS_LABELS[task.status as ProcStatus] ?? task.status}」`,
      );
    }
    const selected = await this.prisma.procQuotation.findMany({
      where: { taskId, isSelected: true },
      select: { supplierName: true },
    });
    if (selected.length === 0) {
      throw new BadRequestException('该任务还没有已确认的报价，不能完成询价');
    }
    // 免费样品登记不代表实际收样；需样任务必须等待收样确认。
    const next: ProcStatus = task.needSample ? 'pending_sample' : 'priced';
    return this.applyTransition(
      taskId,
      next,
      actor,
      note?.trim()
        || `完成询价，进入「${PROC_STATUS_LABELS[next] ?? next}」（已确认 ${selected.length} 条报价）`,
      task.status,
    );
  }

  /** 回退到同一流程的任意更早节点，并原子清理目标节点下不应存在的数据。 */
  async rollbackTask(id: string, dto: RollbackProcTaskDto, actor: ProcActor) {
    const reason = typeof dto.reason === 'string' ? dto.reason.trim() : '';
    if (reason.length < 2 || reason.length > 200) {
      throw new BadRequestException('请填写 2–200 个字符的回退原因');
    }
    const task = await this.requireTask(id);
    const current = task.status as ProcStatus;
    const target = dto.status as ProcStatus;
    if (PROC_ROLLBACK_BLOCKED_STATUSES.includes(current)) {
      throw new BadRequestException(current === 'pending_rd_review'
        ? '该申请已在「待继续转采购」，无法继续回退'
        : current === 'completed'
          ? '已完成的任务不能回退'
          : '已取消的任务不能回退，请重新发起采购申请');
    }
    if (dto.from_status !== current) {
      throw new ConflictException(
        `任务已是「${PROC_STATUS_LABELS[current] ?? current}」，页面数据已过期，请刷新后再操作`,
      );
    }
    if (!rollbackTargetsOf(current, task.method, task).includes(target)) {
      throw new BadRequestException(
        `不能从「${PROC_STATUS_LABELS[current] ?? current}」回退到「${PROC_STATUS_LABELS[target] ?? target}」：只能回退到当前流程中更早的节点`,
      );
    }

    const cleanup = rollbackCleanupFor(target);
    const returnToRdReview = target === 'pending_rd_review';
    const updated = await this.prisma.$transaction(async (tx) => {
      // 同步到货或转派可能不改变状态；锁后读取实际清理前数据，避免日志沿用页面旧快照。
      await tx.$queryRaw`SELECT id FROM "ProcTask" WHERE id = ${id} FOR UPDATE`;
      const beforeCleanup = await tx.procTask.findUnique({
        where: { id },
        select: { arrivedQty: true, unit: true, buyer: true, buyerUserId: true },
      });
      if (!beforeCleanup) throw new ConflictException('任务状态已被其他操作更新，请刷新后重试');
      // 先抢占状态再清理，避免过期页面或并发推进导致误删业务数据。
      const claimed = await tx.procTask.updateMany({
        where: { id, status: current, ...(returnToRdReview ? { source: 'rd', rdTaskId: task.rdTaskId } : {}) },
        data: {
          status: target,
          businessDone: false,
          ...(returnToRdReview ? { buyer: '', buyerUserId: null } : {}),
          ...(cleanup.arrivals ? { arrivedQty: new Prisma.Decimal(0) } : {}),
          ...(cleanup.quotations ? {
            selectedQuotationId: null,
            quotationSubtotal: null,
            quotationDiscount: null,
            quotationTotal: null,
          } : {}),
        },
      });
      if (claimed.count !== 1) throw new ConflictException('任务状态已被其他操作更新，请刷新后重试');

      const cleared: string[] = [];
      if (cleanup.quotations) {
        const { count } = await tx.procQuotation.deleteMany({ where: { taskId: id } });
        if (count > 0) cleared.push(`${count} 条报价`);
      }
      if (cleanup.purchaseOrders) {
        // 缺少 freeSample 键时 JSON path 比较为 SQL NULL，不能用 NOT equals true。
        // 按实际元数据选出需解除的关联，仅保留严格标记为 true 的免费收样事实。
        const refs = await tx.procPurchaseOrderRef.findMany({
          where: { taskId: id }, select: { id: true, metadata: true },
        });
        const ids = refs.filter((ref) =>
          (ref.metadata as { freeSample?: unknown } | null)?.freeSample !== true,
        ).map((ref) => ref.id);
        if (ids.length > 0) {
          const { count } = await tx.procPurchaseOrderRef.deleteMany({ where: { taskId: id, id: { in: ids } } });
          if (count > 0) cleared.push(`${count} 条采购单关联`);
        }
      }
      const endedSampleTest = await this.endPendingSampleTest(tx, id);
      const resetDetails: string[] = [];
      if (cleanup.arrivals && num(beforeCleanup.arrivedQty) !== 0) {
        resetDetails.push(`到货数量由 ${num(beforeCleanup.arrivedQty)} ${beforeCleanup.unit ?? ''}清零`);
      }
      if (returnToRdReview && (beforeCleanup.buyer || beforeCleanup.buyerUserId)) {
        resetDetails.push(`解除采购负责人：${beforeCleanup.buyer || beforeCleanup.buyerUserId}`);
      }
      if (endedSampleTest) resetDetails.push(`终止未确认测试：${endedSampleTest.testerName}`);
      if (returnToRdReview) {
        // 结束存量审核待办；提交后通知原研发参与人直接继续转采购。
        await tx.rdMessage.updateMany({
          where: { type: 'review_request', taskId: id, handled: false },
          data: { handled: true, read: true },
        });
      }
      await tx.procTaskLog.create({
        data: {
          taskId: id,
          kind: 'action',
          text: `回退到「${PROC_STATUS_LABELS[target] ?? target}」`
            + `${cleared.length > 0 ? `，已清理 ${cleared.join('、')}` : ''}`
            + `${resetDetails.length > 0 ? `；${resetDetails.join('；')}` : ''}`
            + `；原因：${reason}`,
          fromStatus: current,
          toStatus: target,
          actor: actor.name,
          actorUserId: actor.id,
        },
      });
      return tx.procTask.findUniqueOrThrow({ where: { id }, include: PROC_TASK_VIEW_INCLUDE });
    });
    if (returnToRdReview) await this.notifyRdTransferReturned(updated, actor, reason);
    return this.serializeTask(updated);
  }

  private async sampleTestUsers(client: Pick<Prisma.TransactionClient, 'user'> = this.prisma) {
    const users = await client.user.findMany({
      select: { id: true, name: true, department: true, status: true, role: { select: { permissions: true } } },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return users.map((user) => ({ ...user, permissions: Array.isArray(user.role?.permissions)
      ? user.role.permissions.filter((permission): permission is string => typeof permission === 'string') : [] }));
  }

  async listSampleTesters() {
    const users = await this.sampleTestUsers();
    return users.filter((user) => user.status === 'ACTIVE' && user.name.trim()
      && (user.permissions.includes('*') || user.permissions.includes('page:rd-my-workspace')))
      .map(({ id, name, department }) => ({ id, name, department }));
  }

  private sampleTestBuyer(task: { buyerUserId: string | null; buyer: string }, users: Awaited<ReturnType<ProcurementService['sampleTestUsers']>>) {
    const matches = task.buyerUserId
      ? users.filter((user) => user.id === task.buyerUserId)
      : users.filter((user) => task.buyer.trim() && user.name.trim() === task.buyer.trim());
    if (matches.length !== 1) return null;
    const buyer = matches[0];
    if (buyer.status !== 'ACTIVE' || !buyer.name.trim()) return null;
    const route = buyer.permissions.includes('page:proc-my-workspace')
      ? '/proc-my-workspace' : buyer.permissions.includes('*') || buyer.permissions.includes('page:proc-cockpit') ? '/proc-cockpit' : null;
    return route ? { ...buyer, route } : null;
  }

  private sampleTestResponse(task: ProcTaskView, actor: ProcActor, canReadProcurement: boolean) {
    const serialized = this.serializeTask(task);
    const visible = canReadProcurement ? serialized : this.rdLinkedTaskView(serialized);
    const sampleTest = sampleTestOf(task.metadata);
    const history = sampleTestHistoryOf(task.metadata);
    const rawHistory = task.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata) ? task.metadata.sampleTestHistory : undefined;
    return {
      task: { id: task.id, code: task.code, materialName: task.materialName, spec: task.spec,
        quantity: num(task.quantity), unit: task.unit, status: task.status, buyer: task.buyer,
        rdTaskId: task.rdTaskId ?? undefined, rdTaskTitle: task.rdTaskTitle ?? undefined,
        attachmentList: visible.attachmentList, rdTransferSnapshots: visible.rdTransferSnapshots,
        needSample: serialized.needSample, sampleStatusNeedsReview: serialized.sampleStatusNeedsReview,
        updatedAt: serialized.updatedAt, expectedArrivalDate: serialized.expectedArrivalDate,
        logs: serialized.logs.filter((log) => log.fromStatus && log.toStatus && log.fromStatus !== log.toStatus)
          .map((log) => ({ id: log.id, createdAt: log.createdAt, at: log.at, fromStatus: log.fromStatus,
            toStatus: log.toStatus, actor: log.actor, text: '状态变更' })) },
      validationReferences: sampleValidationReferences(task),
      sampleTest: canReadProcurement ? sampleTest : sampleTestWithoutCommercial(sampleTest),
      history: history.map((round) => canReadProcurement ? round : sampleTestWithoutCommercial(round)!),
      historyIncomplete: Array.isArray(rawHistory) && rawHistory.length !== history.length,
      canRecordArrival: task.status === 'testing' && sampleTest?.result === null && canReadProcurement
        && actor.permissions.some((permission) => permission === '*' || permission === 'proc-task:inquiry'),
      canRecordTesting: task.status === 'testing' && sampleTest?.testerUserId === actor.id && sampleTest.result === null,
      canReadCommercial: canReadProcurement,
      canConfirm: task.status === 'testing' && sampleTest?.testerUserId === actor.id && sampleTest.result === null,
    };
  }

  async getSampleTest(id: string, actor: ProcActor) {
    const task = await this.prisma.procTask.findUnique({ where: { id }, include: PROC_TASK_VIEW_INCLUDE });
    if (!task) throw new NotFoundException('样品测试任务不存在');
    const assigned = sampleTestOf(task.metadata)?.testerUserId === actor.id;
    const readAll = actor.permissions.some((permission) => ['*', 'page:proc-cockpit', 'page:proc-materials'].includes(permission));
    let readOwn = false;
    if (!readAll && actor.permissions.includes('page:proc-my-workspace')) {
      readOwn = this.sampleTestBuyer(task, await this.sampleTestUsers())?.id === actor.id;
    }
    if (!assigned && !readAll && !readOwn) throw new NotFoundException('样品测试任务不存在');
    return this.sampleTestResponse(task, actor, readAll || readOwn);
  }

  private async handleSampleTestRequests(tx: Prisma.TransactionClient, taskId: string) {
    await tx.rdMessage.updateMany({
      where: { type: 'procurement_sample_test_request', taskId, handled: false },
      data: { handled: true, read: true },
    });
  }

  /** 调用方已锁定/更新任务行：关闭待办并失效未确认轮次，已确认结论仍保留。 */
  private async endPendingSampleTest(tx: Prisma.TransactionClient, taskId: string) {
    await this.handleSampleTestRequests(tx, taskId);
    const task = await tx.procTask.findUniqueOrThrow({ where: { id: taskId }, select: { metadata: true } });
    const current = sampleTestOf(task.metadata);
    if (current?.result === null) {
      await tx.procTask.updateMany({ where: { id: taskId }, data: {
        metadata: { ...archiveSampleTest(task.metadata, 'workflow_ended'), sampleTest: null } as Prisma.InputJsonObject,
      } });
      return current;
    }
    return null;
  }

  async assignSampleTest(id: string, dto: AssignSampleTestDto, actor: ProcActor) {
    if (!actor.permissions.some((permission) => permission === '*' || permission === 'proc-task:inquiry')) throw new ForbiddenException('没有指定样品测试人员的权限');
    const base = new Date(dto.baseUpdatedAt);
    if (!Number.isFinite(base.getTime()) || !['pending_sample', 'testing'].includes(dto.fromStatus)) throw new BadRequestException('请刷新任务后重新指定测试人员');
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ProcTask" WHERE id = ${id} FOR UPDATE`;
      const task = await tx.procTask.findUnique({ where: { id } });
      if (!task) throw new NotFoundException('采购任务不存在');
      if (task.status !== dto.fromStatus || task.updatedAt.getTime() !== base.getTime()) throw new ConflictException('任务已更新，请刷新后重新指定测试人员');
      const users = await this.sampleTestUsers(tx);
      const readAll = actor.permissions.some((permission) => ['*', 'page:proc-cockpit', 'page:proc-materials'].includes(permission));
      const readOwn = actor.permissions.includes('page:proc-my-workspace') && this.sampleTestBuyer(task, users)?.id === actor.id;
      if (!readAll && !readOwn) throw new ForbiddenException('没有本任务的样品分派与到样登记权限');
      const tester = users.find((user) => user.id === dto.testerUserId?.trim()
        && user.status === 'ACTIVE' && user.name.trim()
        && (user.permissions.includes('*') || user.permissions.includes('page:rd-my-workspace')));
      if (!tester) throw new BadRequestException('请选择启用且有研发个人工作台权限的测试人员');
      const current = sampleTestOf(task.metadata);
      if (task.status === 'testing' && current?.testerUserId === tester.id && current.result === null) throw new ConflictException('该人员已收到本轮测试任务，无需重复指定');
      const sampleTest: ProcurementSampleTest = {
        roundId: randomUUID(), testerUserId: tester.id, testerName: tester.name,
        assignedAt: new Date().toISOString(), assignedByName: actor.name,
        result: null, note: null, confirmedAt: null, confirmedByName: null,
        recordsVersion: 1,
        arrivedAt: dto.arrivedAt !== undefined ? sampleTimestamp(dto.arrivedAt) : task.status === 'testing' && current?.result === null ? current.arrivedAt ?? null : null,
        startedAt: null, finishedAt: null, commercial: null, revisions: [],
      };
      if (dto.arrivedAt !== undefined && !sampleTimestamp(dto.arrivedAt)) throw new BadRequestException('实际到样时间无效');
      const timingError = sampleTimingError(sampleTest);
      if (timingError) throw new BadRequestException(timingError);
      if (sampleTest.arrivedAt) sampleTest.revisions!.push({ recordedAt: sampleTest.assignedAt, recordedById: actor.id, recordedByName: actor.name,
        arrivedAt: sampleTest.arrivedAt, startedAt: null, finishedAt: null });
      const metadata = archiveSampleTest(task.metadata, task.status === 'testing' && current?.result === null ? 'reassigned' : 'new_sample');
      const claimed = await tx.procTask.updateMany({ where: { id, status: dto.fromStatus, updatedAt: base }, data: {
        status: 'testing', needSample: true, updatedAt: new Date(Math.max(Date.now(), base.getTime() + 1)),
        metadata: { ...metadata, sampleTest } as unknown as Prisma.InputJsonObject,
      } });
      if (claimed.count !== 1) throw new ConflictException('任务已更新，请刷新后重试');
      await this.handleSampleTestRequests(tx, id);
      await tx.procTaskLog.create({ data: { taskId: id, kind: 'action',
        text: `${sampleTest.arrivedAt ? '登记样品到样并指定测试' : '指定样品测试（实际到样待登记）'}，由 ${tester.name} 测试并确认结论`,
        fromStatus: task.status, toStatus: 'testing', actor: actor.name, actorUserId: actor.id } });
      await this.rdService.createMessage({ source: 'procurement', sender: { id: actor.id, name: actor.name, role: '采购人员' },
        recipient_id: tester.id, recipient_name: tester.name, subject: `待测试样品 · ${task.materialName}`,
        body: JSON.stringify({ type: 'procurement_sample_test_request', procurement_task_id: id, task_id: id,
          procurement_code: task.code, rd_task_id: task.rdTaskId, rd_task_title: task.rdTaskTitle,
          material_name: task.materialName, specification: task.spec, quantity: num(task.quantity), unit: task.unit,
          tester_name: tester.name, buyer_name: task.buyer, round_id: sampleTest.roundId,
          route: `/rd-my-workspace?sampleTest=${encodeURIComponent(id)}`, action_label: '填写并确认测试结论', next_action: '完成样品测试并确认结论' }),
      }, tx);
      return tx.procTask.findUniqueOrThrow({ where: { id }, include: PROC_TASK_VIEW_INCLUDE });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    return this.serializeTask(updated);
  }

  async updateSampleRecords(id: string, dto: UpdateSampleRecordsDto, actor: ProcActor) {
    const base = sampleTimestamp(dto.baseUpdatedAt);
    if (!base || !dto.roundId?.trim()) throw new BadRequestException('请刷新样品记录后重试');
    const hasArrival = Object.prototype.hasOwnProperty.call(dto, 'arrivedAt');
    const hasTesting = ['startedAt', 'finishedAt'].some((key) => Object.prototype.hasOwnProperty.call(dto, key));
    const hasCommercial = Object.prototype.hasOwnProperty.call(dto, 'commercial');
    if (!hasArrival && !hasTesting && !hasCommercial) throw new BadRequestException('请填写需要登记的时间或采购条件');
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ProcTask" WHERE id = ${id} FOR UPDATE`;
      const task = await tx.procTask.findUnique({ where: { id }, include: { attachments: true } });
      if (!task) throw new NotFoundException('样品测试任务不存在');
      const current = sampleTestOf(task.metadata);
      const buyer = this.sampleTestBuyer(task, await this.sampleTestUsers(tx));
      const readAll = actor.permissions.some((permission) => ['*', 'page:proc-cockpit', 'page:proc-materials'].includes(permission));
      const canReadProcurement = readAll || (actor.permissions.includes('page:proc-my-workspace') && buyer?.id === actor.id);
      const canWriteProcurement = canReadProcurement && actor.permissions.some((permission) => permission === '*' || permission === 'proc-task:inquiry');
      if ((hasArrival || hasCommercial) && !canWriteProcurement) throw new ForbiddenException('仅有询价权限且可读取本任务的采购人员可以登记到样和采购条件');
      if (hasTesting && current?.testerUserId !== actor.id) throw new ForbiddenException('仅当前指定测试人员本人可以登记开测和结束时间');
      if (!current || current.roundId !== dto.roundId || current.result !== null || task.status !== 'testing') throw new ConflictException('该轮测试已结束或已改派，请刷新任务');
      if (task.updatedAt.getTime() !== Date.parse(base)) throw new ConflictException('样品记录已更新，请刷新后核对再保存');
      const next: ProcurementSampleTest = { ...current, recordsVersion: 1 };
      for (const key of ['arrivedAt', 'startedAt', 'finishedAt'] as const) {
        if (Object.prototype.hasOwnProperty.call(dto, key)) {
          const value = sampleTimestamp(dto[key]);
          if (!value) throw new BadRequestException('实际时间无效，不能清除已登记时间');
          next[key] = value;
        }
      }
      const timingError = sampleTimingError(next);
      if (timingError) throw new BadRequestException(timingError);
      if (hasCommercial) {
        const conditions = dto.commercial;
        if (!conditions || !['priceUnit', 'paymentTerms', 'freightTerms', 'note'].every((key) => typeof conditions[key as keyof typeof conditions] === 'string')
          || !['inclusive', 'exclusive', 'unspecified'].includes(conditions.taxBasis)
          || !['order', 'deposit', 'approval', 'agreed_date', 'other', 'unspecified'].includes(conditions.leadTimeStart)
          || (conditions.taxRate != null && (!Number.isFinite(conditions.taxRate) || conditions.taxRate < 0 || conditions.taxRate > 100))) throw new BadRequestException('采购条件格式无效');
        if (conditions.priceUnit.length > 80 || [conditions.paymentTerms, conditions.freightTerms, conditions.note].some((value) => value.length > 500)) throw new BadRequestException('采购条件超出允许长度');
        if (conditions.leadTimeStart === 'agreed_date') {
          if (typeof conditions.leadTimeStartDate !== 'string' || !sampleTimestamp(`${conditions.leadTimeStartDate}T00:00:00Z`)) throw new BadRequestException('请填写有效的约定起算日期');
        } else if (conditions.leadTimeStartDate != null) throw new BadRequestException('仅约定日期起算方式可填写起算日期');
        next.commercial = { priceUnit: conditions.priceUnit.trim(), taxBasis: conditions.taxBasis, taxRate: conditions.taxRate ?? null,
          paymentTerms: conditions.paymentTerms.trim(), freightTerms: conditions.freightTerms.trim(), leadTimeStart: conditions.leadTimeStart,
          leadTimeStartDate: conditions.leadTimeStartDate ?? null, note: conditions.note.trim() };
      }
      next.revisions = [...(current.revisions ?? []), { recordedAt: new Date().toISOString(), recordedById: actor.id, recordedByName: actor.name,
        arrivedAt: next.arrivedAt ?? null, startedAt: next.startedAt ?? null, finishedAt: next.finishedAt ?? null, commercial: next.commercial ?? null }];
      const metadata = task.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata) ? task.metadata : {};
      const claimed = await tx.procTask.updateMany({ where: { id, status: 'testing', updatedAt: new Date(base), metadata: { path: ['sampleTest', 'roundId'], equals: dto.roundId } }, data: {
        updatedAt: new Date(Math.max(Date.now(), Date.parse(base) + 1)), metadata: { ...metadata, sampleTest: next } as unknown as Prisma.InputJsonObject,
      } });
      if (claimed.count !== 1) throw new ConflictException('样品记录已更新，请刷新后重试');
      await tx.procTaskLog.create({ data: { taskId: id, kind: 'action', text: hasCommercial ? '登记本轮样品采购条件及时间记录' : '登记本轮样品实际时间', actor: actor.name, actorUserId: actor.id } });
      return { task: await tx.procTask.findUniqueOrThrow({ where: { id }, include: PROC_TASK_VIEW_INCLUDE }), canReadProcurement };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    return this.sampleTestResponse(updated.task, actor, updated.canReadProcurement);
  }

  async addSampleEvidence(id: string, dto: SampleEvidenceDto, actor: ProcActor) {
    const task = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ProcTask" WHERE id = ${id} FOR UPDATE`;
      const currentTask = await tx.procTask.findUnique({ where: { id } });
      if (!currentTask) throw new NotFoundException('样品测试任务不存在');
      const round = sampleTestOf(currentTask.metadata);
      if (!round || round.testerUserId !== actor.id) throw new ForbiddenException('仅当前测试人员本人可以上传本轮验证证据');
      if (currentTask.status !== 'testing' || round.result !== null || round.roundId !== dto.roundId) throw new ConflictException('该轮测试已结束或已改派，请刷新任务');
      if (currentTask.updatedAt.toISOString() !== sampleTimestamp(dto.baseUpdatedAt)) throw new ConflictException('样品记录已更新，请刷新后重试');
      if (!Array.isArray(dto.items) || !dto.items.length || dto.items.length > 10) throw new BadRequestException('每次请选择 1–10 份证据');
      const assets = await tx.fileAsset.findMany({ where: { id: { in: dto.items.map((item) => item.fileId) }, status: 'active', deletedAt: null } });
      const items = dto.items.map((item) => {
        const asset = assets.find((file) => file.id === item.fileId);
        if (!asset || asset.uploadedBy !== actor.id || asset.fileSize <= 0 || !this.isAllowedAttachmentFileKey(asset.objectKey)) throw new BadRequestException('请使用本人已上传且有效的本轮证据文件');
        return this.attachmentData({ fileName: asset.fileName, fileUrl: this.ossService.buildInlinePreviewUrl(asset.objectKey) || '', fileKey: asset.objectKey, fileSize: asset.fileSize, mimeType: asset.mimeType, kind: 'other' }, actor);
      });
      const changed = await tx.procTask.updateMany({ where: { id, status: 'testing', updatedAt: currentTask.updatedAt }, data: { updatedAt: new Date(Math.max(Date.now(), currentTask.updatedAt.getTime() + 1)) } });
      if (changed.count !== 1) throw new ConflictException('样品记录已更新，请刷新后重试');
      await tx.procTaskAttachment.createMany({ data: items.map((item) => ({ ...item, taskId: id })) });
      await tx.procTaskLog.create({ data: { taskId: id, kind: 'action', text: `上传本轮样品验证证据 ${items.length} 份`, actor: actor.name, actorUserId: actor.id } });
      return tx.procTask.findUniqueOrThrow({ where: { id }, include: PROC_TASK_VIEW_INCLUDE });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    // Reuse the normal per-task read policy after the write.
    return this.getSampleTest(task.id, actor);
  }

  async confirmSampleTest(id: string, dto: ConfirmSampleTestDto, actor: ProcActor) {
    const note = typeof dto.note === 'string' ? dto.note.trim() : '';
    if (!note || note.length > 500 || !SAMPLE_TEST_RESULTS.includes(dto.result)) throw new BadRequestException('请选择测试结果并填写 1–500 字测试结论');
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ProcTask" WHERE id = ${id} FOR UPDATE`;
      const task = await tx.procTask.findUnique({ where: { id }, include: { attachments: true } });
      if (!task) throw new NotFoundException('样品测试任务不存在');
      const current = sampleTestOf(task.metadata);
      if (!current || current.testerUserId !== actor.id) throw new ForbiddenException('仅当前指定的测试人员本人可以确认测试结论');
      if (task.status !== 'testing' || current.roundId !== dto.roundId || current.result !== null) throw new ConflictException('该轮测试已结束或已改派，请刷新任务');
      if (current.recordsVersion === 1 && (!current.arrivedAt || !current.startedAt || !current.finishedAt || sampleTimingError(current))) {
        throw new BadRequestException('请先登记有效的实际到样、开测和结束时间，再确认测试结论');
      }
      const buyer = this.sampleTestBuyer(task, await this.sampleTestUsers(tx));
      if (!buyer) throw new BadRequestException('采购负责人未指派、已停用、同名不唯一或无采购工作台权限，请先明确指派有效负责人');
      const confirmedAt = new Date().toISOString();
      const validation = confirmSampleValidation(dto.validation, dto.result, sampleValidationReferences(task), actor, confirmedAt);
      const sampleTest: ProcurementSampleTest = { ...current, validation, result: dto.result, note, confirmedAt, confirmedByName: actor.name };
      const next = dto.result === 'passed' ? 'priced' : dto.result === 'failed_resample' ? 'pending_sample' : 'inquiring';
      const metadata = task.metadata as Prisma.JsonObject;
      const claimed = await tx.procTask.updateMany({ where: { id, status: 'testing', updatedAt: task.updatedAt,
        metadata: { path: ['sampleTest', 'roundId'], equals: dto.roundId } }, data: {
        status: next, metadata: { ...metadata, sampleTest } as unknown as Prisma.InputJsonObject,
      } });
      if (claimed.count !== 1) throw new ConflictException('该轮测试已被其他操作更新，请刷新后重试');
      await this.handleSampleTestRequests(tx, id);
      const conclusion = SAMPLE_TEST_RESULT_LABELS[dto.result];
      await tx.procTaskLog.create({ data: { taskId: id, kind: 'action', text: `${actor.name} 确认${conclusion}；测试结论：${note}`,
        fromStatus: 'testing', toStatus: next, actor: actor.name, actorUserId: actor.id } });
      await this.rdService.createMessage({ source: 'procurement', sender: { id: actor.id, name: actor.name, role: '样品测试人员' },
        recipient_id: buyer.id, recipient_name: buyer.name, subject: `样品${conclusion} · ${task.materialName}`,
        body: JSON.stringify({ type: 'procurement_sample_test_result', procurement_task_id: id, task_id: id,
          procurement_code: task.code, rd_task_id: task.rdTaskId, rd_task_title: task.rdTaskTitle,
          material_name: task.materialName, specification: task.spec, quantity: num(task.quantity), unit: task.unit,
          tester_name: current.testerName, buyer_name: buyer.name, round_id: current.roundId,
          result: dto.result, conclusion: note, confirmed_at: confirmedAt,
          route: `${buyer.route}?task=${encodeURIComponent(id)}`, action_label: '查看测试结论并继续采购',
          next_action: dto.result === 'passed' ? '继续采购流程' : dto.result === 'failed_resample' ? '安排重新送样' : '重新询价' }),
      }, tx);
      return {
        task: await tx.procTask.findUniqueOrThrow({ where: { id }, include: PROC_TASK_VIEW_INCLUDE }),
        canReadProcurement: actor.permissions.some((permission) => ['*', 'page:proc-cockpit', 'page:proc-materials'].includes(permission))
          || (actor.permissions.includes('page:proc-my-workspace') && buyer.id === actor.id),
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    return this.sampleTestResponse(updated.task, actor, updated.canReadProcurement);
  }

  /** 通用状态流转：受 PROC_STATUS_TRANSITIONS 约束。 */
  async transitionTask(id: string, dto: TransitionProcTaskDto, actor: ProcActor) {
    const task = await this.requireTask(id);
    if (task.status === 'pending_rd_review') {
      throw new BadRequestException('该申请尚待研发管理员审核，不能从采购流程直接推进');
    }
    // 客户端声明的来源状态与实际不符：说明它拿的是过期数据（例如上一次保存后界面没刷新，
    // 用户又点了一次）。此时每一步单看都合法，放行就会一路推到终态，所以直接拒绝。
    if (dto.from_status !== task.status) {
      throw new ConflictException(
        `任务已是「${PROC_STATUS_LABELS[task.status as ProcStatus] ?? task.status}」，页面数据已过期，请刷新后再操作`,
      );
    }
    return this.applyTransition(id, dto.status as ProcStatus, actor, dto.note, task.status as ProcStatus, true);
  }

  private async applyTransition(
    id: string,
    next: ProcStatus,
    actor: ProcActor,
    note: string | undefined,
    expectedStatus: ProcStatus,
    correctionOnly = false,
  ) {
    const updated = await this.prisma.$transaction(async (tx) => {
      // 与样品登记/解除共用任务行锁，校验和写入必须基于调用方已确认的来源状态。
      await tx.$queryRaw`SELECT id FROM "ProcTask" WHERE id = ${id} FOR UPDATE`;
      const task = await tx.procTask.findUniqueOrThrow({ where: { id } });
      if (task.status !== expectedStatus) {
        throw new ConflictException('任务状态已被其他操作更新，请刷新后重试');
      }
      const allowed = PROC_STATUS_TRANSITIONS[expectedStatus] ?? [];
      if (!allowed.includes(next)) {
        throw new BadRequestException(
          `不允许从「${PROC_STATUS_LABELS[expectedStatus] ?? expectedStatus}」流转到「${PROC_STATUS_LABELS[next] ?? next}」`,
        );
      }
      if (next === 'testing' || (expectedStatus === 'testing' && !(next === 'pending_sample' && !sampleTestOf(task.metadata)))) {
        throw new BadRequestException('样品测试须指定测试人员，并由该人员在样品测试入口确认结论');
      }
      // 对外的通用接口只纠正历史免费样品；正式推进必须经过各业务入口及其权限、依据校验。
      if (correctionOnly && next !== 'pending_sample') {
        throw new BadRequestException('请通过确认需求、确认报价、完成询价、采购单或到货登记入口推进任务，不能直接修改状态');
      }
      // 待询价直达待到样只用于已有免费样品登记的纠正，不放开普通任务跳过询价。
      if ((expectedStatus === 'pending_inquiry' || correctionOnly) && next === 'pending_sample') {
        const freeSamples = await tx.procPurchaseOrderRef.findMany({
          where: { taskId: id, metadata: { path: ['freeSample'], equals: true } },
          select: { id: true },
          take: 1,
        });
        if (freeSamples.length === 0) {
          throw new BadRequestException('该任务没有登记免费样品，不能直接纠正到「待到样」');
        }
      }
      const claimed = await tx.procTask.updateMany({
        where: { id, status: expectedStatus },
        data: {
          status: next,
          ...(next === 'pending_sample' ? { needSample: true } : {}),
          businessDone: next === 'completed' ? true : task.businessDone,
        },
      });
      if (claimed.count !== 1) throw new ConflictException('任务状态已被其他操作更新，请刷新后重试');
      await tx.procTaskLog.create({
        data: {
          taskId: id,
          kind: 'system',
          text: note ?? `状态更新为「${PROC_STATUS_LABELS[next] ?? next}」`,
          fromStatus: task.status,
          toStatus: next,
          actor: actor.name,
          actorUserId: actor.id,
        },
      });
      return tx.procTask.findUniqueOrThrow({ where: { id }, include: PROC_TASK_VIEW_INCLUDE });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    return this.serializeTask(updated);
  }

  /**
   * 审核驳回研发流转任务：仅限「待处理」的研发来源任务。
   * 采购任务及其采购侧关联数据会级联删除，不在驾驶舱保留；研发源文件仍由研发任务持有。
   * 删除后通知研发相关人员与超级管理员，研发修改后可重新生成一条采购任务。
   */
  async rejectRdTask(id: string, reason: string, actor: ProcActor) {
    const trimmed = reason.trim();
    if (!trimmed) throw new BadRequestException('驳回必须填写理由');
    const task = await this.requireTask(id);
    if (task.source !== 'rd' || task.status !== 'pending_confirm') {
      throw new BadRequestException('仅「待处理」的研发流转任务可审核驳回');
    }
    // 外键均配置了级联删除：采购附件记录、报价快照、采购单关联、重点物料配置和日志一并移除。
    // OSS 文件不在这里物理删除，因为转采购附件可能复用研发任务的原始文件。
    await this.prisma.$transaction(async (tx) => {
      await this.preserveDeletedTaskAudit(tx, task, actor, trimmed, '审核驳回并删除采购任务');
      const deleted = await tx.procTask.deleteMany({
        where: { id, source: 'rd', status: 'pending_confirm' },
      });
      if (deleted.count !== 1) throw new ConflictException('该任务已被其他审核人处理，请刷新后查看');
    });
    await this.notifyProcReviewResult(task, actor, 'rejected', 'cancelled', trimmed);
    return { ok: true, deletedId: id };
  }

  /**
   * 转采购审核结果同时通知研发相关人员与全部启用的超级管理员。
   *
   * 收件人包含研发对接人、实际转采购人及全部超级管理员，同一账号会自动合并。
   * 所有人员优先按稳定 user id 投递；仅对存量数据做“姓名唯一匹配”，绝不向同名账号猜测投递。
   * 每位收件人的跳转入口按其权限单独生成，避免“收到了消息但点击后 403”。
   */
  private async notifyProcReviewResult(
    task: ProcReviewNoticeTask,
    actor: ProcActor,
    outcome: 'approved' | 'rejected',
    nextStatus: ProcStatus,
    reason?: string,
  ): Promise<void> {
    let users: Array<{ id: string; name: string; role: { permissions: Prisma.JsonValue } | null }>;
    try {
      users = await this.prisma.user.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, name: true, role: { select: { permissions: true } } },
      });
    } catch (error) {
      new Logger(ProcurementService.name).warn(
        `转采购审核通知收件人查询失败: ${(error as Error).message}`,
      );
      return;
    }
    type RecipientReason = 'rd_contact' | 'requester' | 'super_admin';
    type DirectoryUser = (typeof users)[number];
    type Recipient = {
      id: string;
      name: string;
      permissions: string[];
      reasons: Set<RecipientReason>;
    };
    const permissionsOf = (user: DirectoryUser): string[] =>
      Array.isArray(user.role?.permissions)
        ? (user.role.permissions as unknown[]).filter((item): item is string => typeof item === 'string')
        : [];
    const recipients = new Map<string, Recipient>();
    const addUser = (user: DirectoryUser, reason: RecipientReason) => {
      const existing = recipients.get(user.id);
      if (existing) {
        existing.reasons.add(reason);
        return;
      }
      recipients.set(user.id, {
        id: user.id,
        name: user.name,
        permissions: permissionsOf(user),
        reasons: new Set([reason]),
      });
    };

    const contactName = task.rdContact?.trim() || '';
    const contactById = task.rdContactUserId
      ? users.find((user) => user.id === task.rdContactUserId)
      : undefined;
    const contactByUniqueName = !task.rdContactUserId && contactName
      ? users.filter((user) => user.name.trim() === contactName)
      : [];
    const contact = contactById ?? (contactByUniqueName.length === 1 ? contactByUniqueName[0] : undefined);
    if (contact) {
      addUser(contact, 'rd_contact');
    } else if (contactName || task.rdContactUserId) {
      new Logger(ProcurementService.name).warn(
        `转采购审核通知未投递研发对接人：账号不存在或姓名无法唯一匹配（${contactName || task.rdContactUserId}）`,
      );
    }

    const requesterName = task.requester?.trim() || '';
    const requesterById = task.requesterUserId
      ? users.find((user) => user.id === task.requesterUserId)
      : undefined;
    const requesterByUniqueName = !task.requesterUserId && requesterName
      ? users.filter((user) => user.name.trim() === requesterName)
      : [];
    const requester = requesterById ?? (requesterByUniqueName.length === 1 ? requesterByUniqueName[0] : undefined);
    if (requester) {
      addUser(requester, 'requester');
    } else if (requesterName || task.requesterUserId) {
      new Logger(ProcurementService.name).warn(
        `转采购审核通知未投递需求提出人：账号不存在或姓名无法唯一匹配（${requesterName || task.requesterUserId}）`,
      );
    }

    for (const user of users) {
      if (permissionsOf(user).includes('*')) addUser(user, 'super_admin');
    }

    const approved = outcome === 'approved';
    const subject = approved
      ? `转采购审核通过 · ${task.materialName}`
      : `转采购已打回 · ${task.materialName}`;
    const commonBody = {
      type: 'procurement_review_result',
      result: outcome,
      task_id: task.rdTaskId ?? task.id,
      procurement_task_id: task.id,
      procurement_code: task.code,
      rd_task_id: task.rdTaskId,
      rd_task_title: task.rdTaskTitle,
      material_name: task.materialName,
      specification: task.spec || null,
      quantity: num(task.quantity),
      unit: task.unit || null,
      procurement_method: task.method,
      procurement_method_label: task.method === 'direct' ? '电商直购' : '询价采购',
      requester_name: task.requester,
      requester_department: task.requesterDept,
      rd_contact: task.rdContact,
      reviewer_id: actor.id,
      reviewer_name: actor.name,
      reason: reason || null,
      priority: task.priority,
      need_date: day(task.needDate),
      deadline: day(task.deadline),
      next_status: approved ? nextStatus : null,
      next_status_label: approved ? (PROC_STATUS_LABELS[nextStatus] ?? nextStatus) : null,
      task_deleted: !approved,
    };
    const recipientReasonLabels: Record<RecipientReason, string> = {
      rd_contact: '研发对接人',
      requester: '需求提出人',
      super_admin: '超级管理员',
    };
    const rdRouteOf = (permissions: string[]): string | null => {
      if (!task.rdTaskId) return null;
      const encodedId = encodeURIComponent(task.rdTaskId);
      if (permissions.includes('*')) return `/rd-task/${encodedId}`;
      if (permissions.includes('page:rd-my-workspace')) return `/rd-my-workspace?task=${encodedId}`;
      if (
        permissions.includes('page:rd-task-management')
        || permissions.includes('page:rd-director-dashboard')
      ) return `/rd-task/${encodedId}`;
      return null;
    };

    // 单个收件人投递失败不影响其他人，也不回滚已完成的审核状态。
    for (const recipient of recipients.values()) {
      const canOpenProcurement = recipient.permissions.includes('*')
        || recipient.permissions.includes('page:proc-cockpit');
      const route = approved && canOpenProcurement
        ? `/proc-cockpit?task=${encodeURIComponent(task.id)}`
        : rdRouteOf(recipient.permissions);
      const actionLabel = route
        ? approved && canOpenProcurement
          ? '查看采购任务'
          : '查看原研发任务'
        : null;
      const nextAction = approved
        ? canOpenProcurement
          ? task.method === 'direct'
            ? '采购任务已进入待购买，可前往采购驾驶舱查看并继续下单。'
            : '采购任务已进入待询价，可前往采购驾驶舱查看并推进询价。'
          : '采购已接收该需求，后续采购执行由采购人员推进；你可返回原研发任务查看关联信息。'
        : '请返回原研发任务，根据打回原因修改资料后重新转采购。';
      const body = JSON.stringify({
        ...commonBody,
        next_action: nextAction,
        route,
        action_label: actionLabel,
        recipient_reason: [...recipient.reasons].map((reasonCode) => recipientReasonLabels[reasonCode]).join('、'),
      });
      try {
        await this.rdService.createMessage({
          source: 'procurement',
          sender: { id: actor.id, name: actor.name, role: '采购' },
          recipient_id: recipient.id,
          recipient_name: recipient.name,
          subject,
          body,
          meta: {
            kind: 'procurement_review_result',
            task_id: task.id,
            outcome,
            route,
          },
        });
      } catch (error) {
        new Logger(ProcurementService.name).warn(
          `转采购审核${approved ? '通过' : '驳回'}通知发送失败（${recipient.name}）: ${(error as Error).message}`,
        );
      }
    }
  }

  async cancelTask(id: string, dto: CancelProcTaskDto, actor: ProcActor) {
    const task = await this.requireTask(id);
    if (task.status === 'pending_rd_review') {
      throw new BadRequestException('该申请尚待研发管理员审核，请由研发管理员通过或打回');
    }
    if (PROC_TERMINAL_STATUSES.includes(task.status as ProcStatus)) {
      throw new BadRequestException('任务已完结，无法取消');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.procTask.updateMany({ where: { id, status: task.status }, data: {
        status: 'cancelled',
        cancelReason: dto.reason ?? null,
      } });
      if (claimed.count !== 1) throw new ConflictException('任务状态已被其他操作更新，请刷新后重试');
      await this.endPendingSampleTest(tx, id);
      await tx.procTaskLog.create({ data: {
        taskId: id,
        kind: 'action',
        text: dto.reason ? `任务取消：${dto.reason}` : '任务取消',
        fromStatus: task.status,
        toStatus: 'cancelled',
        actor: actor.name,
        actorUserId: actor.id,
      } });
      return tx.procTask.findUniqueOrThrow({ where: { id }, include: PROC_TASK_VIEW_INCLUDE });
    });
    return this.serializeTask(updated);
  }

  /**
   * 手工登记到货（过渡期能力）。
   * T+ 接通后到货量应由 syncPurchaseOrders → recomputeArrival 驱动，
   * 届时移除本方法与对应端点，避免两个写入源打架。
   */
  async receiveGoods(id: string, dto: ReceiveGoodsDto, actor: ProcActor) {
    const task = await this.requireTask(id);
    if (!['in_transit', 'partial_arrival'].includes(task.status)) {
      throw new BadRequestException('只有「已下单 / 部分到货」的任务可登记到货');
    }
    if (dto.qty <= 0) throw new BadRequestException('到货数量需大于 0');

    const quantity = num(task.quantity);
    const received = Math.min(num(task.arrivedQty) + dto.qty, quantity || Infinity);
    const next: ProcStatus = quantity > 0 && received >= quantity ? 'completed' : 'partial_arrival';

    const updated = await this.prisma.procTask.update({
      where: { id },
      data: {
        arrivedQty: new Prisma.Decimal(received),
        status: next,
        businessDone: next === 'completed',
        logs: {
          create: {
            kind: 'action',
            text: dto.note
              ? `登记到货 +${dto.qty}（累计 ${received}/${quantity}）：${dto.note}`
              : `登记到货 +${dto.qty}（累计 ${received}/${quantity}）`,
            fromStatus: task.status,
            toStatus: next,
            actor: actor.name,
            actorUserId: actor.id,
            createdAt: parseDay(dto.receivedDate) ?? new Date(),
          },
        },
      },
      include: PROC_TASK_VIEW_INCLUDE,
    });
    return this.serializeTask(updated);
  }

  async reassignTask(id: string, dto: ReassignProcTaskDto, actor: ProcActor) {
    const task = await this.requireTask(id);
    if (task.status === 'pending_rd_review') {
      throw new BadRequestException('该申请尚待研发管理员审核，不能分配采购负责人');
    }
    const buyer = await this.resolveAssignableBuyer(dto.buyerUserId, dto.buyer);
    const updated = await this.prisma.procTask.update({
      where: { id },
      data: {
        buyerUserId: buyer?.id ?? null,
        buyer: buyer?.name ?? '',
        logs: {
          create: {
            kind: 'action',
            text: buyer ? `转派采购负责人为 ${buyer.name}` : '取消采购负责人指派',
            actor: actor.name,
            actorUserId: actor.id,
          },
        },
      },
      include: PROC_TASK_VIEW_INCLUDE,
    });
    return this.serializeTask(updated);
  }

  /**
   * 批量移动任务归类：把任务显式挂到子系统树的某个节点，或解除归属退回自动推导。
   *
   * 与转派不同，已完结的任务也允许移动——归类是整理动作，不改变业务状态，历史任务
   * 同样需要能归到正确的子系统下。目标节点可以是树里任意一层（机型/部件/组件/原料），
   * 因为采购的树是自引用、层级不固定的。
   */
  async moveTasks(dto: MoveProcTasksDto, actor: ProcActor) {
    const ids = Array.from(new Set(dto.taskIds));
    if (ids.length === 0) throw new BadRequestException('请至少选择一个任务');

    const tasks = await this.prisma.procTask.findMany({
      where: { id: { in: ids } },
      select: { id: true, code: true, productId: true, status: true },
    });
    if (tasks.length !== ids.length) {
      throw new NotFoundException('部分任务不存在或已被删除，请刷新后重试');
    }
    const awaitingRdReview = tasks.filter((task) => task.status === 'pending_rd_review');
    if (awaitingRdReview.length > 0) {
      throw new BadRequestException(
        `任务 ${awaitingRdReview.map((task) => task.code).join('、')} 尚待研发管理员审核，不能归入采购系统树`,
      );
    }

    // targetNodeId 为空 = 解除显式归属，退回按物料推导
    let targetLabel = '自动归类（按物料推导）';
    if (dto.targetNodeId) {
      const node = await this.prisma.procTaskTreeNode.findUnique({
        where: { id: dto.targetNodeId },
        select: { id: true, name: true, productId: true },
      });
      if (!node) throw new NotFoundException('目标类目不存在或已被删除，请刷新后重试');
      targetLabel = node.name;
      // 跨产品移动会让任务从原产品的驾驶舱消失，容易误操作，明确拦掉
      const crossProduct = tasks.filter((task) => task.productId !== node.productId);
      if (crossProduct.length > 0) {
        throw new BadRequestException(
          `任务 ${crossProduct.map((task) => task.code).join('、')} 不属于目标类目所在的产品，不能跨产品移动`,
        );
      }
    }

    await this.prisma.$transaction(
      ids.map((id) =>
        this.prisma.procTask.update({
          where: { id },
          data: {
            treeNodeId: dto.targetNodeId ?? null,
            logs: {
              create: {
                kind: 'action',
                text: `移动归类到「${targetLabel}」`,
                actor: actor.name,
                actorUserId: actor.id,
              },
            },
          },
        }),
      ),
    );

    // 不回传整棵树：前端的系统树按任务指纹（含 updatedAt）自动重载，
    // 这里再查一遍全树纯属多余开销。
    return {
      moved: ids.length,
      targetNodeId: dto.targetNodeId ?? null,
      targetLabel,
    };
  }

  /** 批量转派：单事务原子执行，任一任务不存在/已完结则整体回滚。 */
  async batchReassign(dto: BatchReassignDto, actor: ProcActor) {
    const ids = Array.from(new Set(dto.taskIds));
    if (ids.length === 0) throw new BadRequestException('请至少选择一个任务');
    const buyer = await this.resolveAssignableBuyer(dto.buyerUserId, dto.buyer);
    const tasks = await this.prisma.procTask.findMany({
      where: { id: { in: ids } },
      select: { id: true, code: true, status: true },
    });
    if (tasks.length !== ids.length) {
      throw new NotFoundException('部分任务不存在或已被删除，请刷新后重试');
    }
    const terminal = tasks.filter((t) => PROC_TERMINAL_STATUSES.includes(t.status as ProcStatus));
    if (terminal.length > 0) {
      throw new BadRequestException(
        `任务 ${terminal.map((t) => t.code).join('、')} 已完结，不能转派`,
      );
    }
    const awaitingRdReview = tasks.filter((task) => task.status === 'pending_rd_review');
    if (awaitingRdReview.length > 0) {
      throw new BadRequestException(
        `任务 ${awaitingRdReview.map((task) => task.code).join('、')} 尚待研发管理员审核，不能转派`,
      );
    }
    await this.prisma.$transaction(
      ids.map((id) =>
        this.prisma.procTask.update({
          where: { id },
          data: {
            buyerUserId: buyer?.id ?? null,
            buyer: buyer?.name ?? '',
            logs: {
              create: {
                kind: 'action',
                text: buyer ? `批量转派采购负责人为 ${buyer.name}` : '批量取消采购负责人指派',
                actor: actor.name,
                actorUserId: actor.id,
              },
            },
          },
        }),
      ),
    );
    return { updated: ids.length };
  }

  /** 把全部未指派的进行中任务按当前在制负载均衡分给采购成员。 */
  async autoAssignUnassigned(actor: ProcActor) {
    const candidates = await this.listBuyerCandidates();
    if (candidates.length === 0) {
      throw new BadRequestException('没有可用的采购成员，请先在部门管理中配置采购部门人员');
    }
    const [tasks, active] = await Promise.all([
      this.prisma.procTask.findMany({
        where: {
          buyer: '',
          status: { notIn: [...PROC_TERMINAL_STATUSES, 'pending_rd_review'] },
        },
        select: { id: true, code: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.procTask.groupBy({
        by: ['buyerUserId'],
        where: {
          buyerUserId: { in: candidates.map((candidate) => candidate.id) },
          status: { notIn: [...PROC_TERMINAL_STATUSES, 'pending_rd_review'] },
        },
        _count: { _all: true },
      }),
    ]);
    if (tasks.length === 0) return { assigned: 0, distribution: [] };

    const load = new Map(candidates.map((candidate) => [candidate.id, 0]));
    for (const row of active) {
      if (row.buyerUserId) load.set(row.buyerUserId, row._count._all);
    }
    const distribution = new Map<string, { id: string; name: string; count: number }>();
    const updates = tasks.map((task) => {
      const candidate = [...candidates].sort(
        (a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0) || a.name.localeCompare(b.name, 'zh-CN'),
      )[0];
      load.set(candidate.id, (load.get(candidate.id) ?? 0) + 1);
      const current = distribution.get(candidate.id) ?? { id: candidate.id, name: candidate.name, count: 0 };
      current.count += 1;
      distribution.set(candidate.id, current);
      return this.prisma.procTask.update({
        where: { id: task.id },
        data: {
          buyer: candidate.name,
          buyerUserId: candidate.id,
          logs: {
            create: {
              kind: 'action',
              text: `系统按负载自动分配采购负责人为 ${candidate.name}`,
              actor: actor.name,
              actorUserId: actor.id,
            },
          },
        },
      });
    });
    await this.prisma.$transaction(updates);
    return { assigned: tasks.length, distribution: [...distribution.values()] };
  }

  /** 删除会级联移除任务日志，先在同一事务中保存独立审计及历史快照。 */
  private async preserveDeletedTaskAudit(
    tx: Prisma.TransactionClient,
    expectedTask: { id: string; status: string; source: string },
    actor: ProcActor,
    reason: string,
    actionLabel: string,
  ) {
    const id = expectedTask.id;
    await tx.$queryRaw`SELECT id FROM "ProcTask" WHERE id = ${id} FOR UPDATE`;
    const task = await tx.procTask.findUnique({
      where: { id },
      include: { logs: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
    });
    if (!task || task.status !== expectedTask.status || task.source !== expectedTask.source) {
      throw new ConflictException('任务已被其他操作更新，请刷新后重试');
    }
    await tx.auditLog.create({
      data: {
        module: 'procurement',
        source: 'web',
        action: 'task.deleted',
        resource: 'proc-task',
        resourceId: task.id,
        resourceName: `${task.code} · ${task.materialName}`,
        userId: actor.id,
        actorName: actor.name,
        summary: `${actionLabel}「${task.code} · ${task.materialName}」；原因：${reason}`,
        meta: {
          changes: [{ field: 'status', before: task.status, after: 'deleted' }],
          metadata: {
            reason,
            task: {
              id: task.id, code: task.code, materialName: task.materialName,
              spec: task.spec, quantity: num(task.quantity), unit: task.unit,
              status: task.status, source: task.source, rdTaskId: task.rdTaskId,
              buyer: task.buyer, buyerUserId: task.buyerUserId,
            },
            logs: task.logs.map((log) => ({
              id: log.id, kind: log.kind, text: log.text,
              actor: log.actor, actorUserId: log.actorUserId,
              fromStatus: log.fromStatus, toStatus: log.toStatus,
              createdAt: log.createdAt.toISOString(),
            })),
          },
        },
      },
    });
  }

  async deleteTask(id: string, actor: ProcActor) {
    const task = await this.requireTask(id);
    if (task.status === 'pending_rd_review') {
      throw new BadRequestException('该申请尚待研发管理员审核，请通过审核入口打回');
    }
    await this.prisma.$transaction(async (tx) => {
      await this.preserveDeletedTaskAudit(tx, task, actor, '用户确认手动删除', '删除采购任务');
      await tx.procTask.delete({ where: { id } });
      await this.handleSampleTestRequests(tx, id);
    });
    return { ok: true };
  }

  async addAttachments(id: string, items: ProcAttachmentInputDto[], actor: ProcActor) {
    const task = await this.requireTask(id);
    if (task.status === 'pending_rd_review') {
      throw new BadRequestException('该申请尚待研发管理员审核，采购侧不能修改附件');
    }
    if (items.length > 0) {
      const attachments = items.map((a) => ({ taskId: id, ...this.attachmentData(a, actor) }));
      await this.prisma.$transaction(async (tx) => {
        await tx.procTaskAttachment.createMany({ data: attachments });
        await tx.procTaskLog.create({
          data: {
            taskId: id, kind: 'action',
            text: `追加 ${attachments.length} 个附件：${attachments.map((item) => item.fileName).join('、')}`,
            actor: actor.name, actorUserId: actor.id,
          },
        });
      });
    }
    // getTask 不带 actor 会一律判无权限抛 404：写入已提交、接口却报错，前端弹红条还不刷新
    return this.getTask(id, actor);
  }

  private async requireTask(id: string) {
    const task = await this.prisma.procTask.findUnique({ where: { id } });
    if (!task) throw new NotFoundException('采购任务不存在');
    return task;
  }

  // ── 报价 ────────────────────────────────────────────────────────────────────

  /**
   * 任务可选的报价库记录。
   * 只返回当前有效报价，并按任务数量自动匹配阶梯；数量低于首档时仍返回首档并标记需按 MOQ 采购。
   */
  async listTaskQuoteBookOptions(taskId: string): Promise<TaskQuoteBookOptionsResult> {
    const task = await this.requireTask(taskId);
    if (task.status === 'pending_rd_review') {
      throw new BadRequestException('该申请尚待研发管理员审核，采购侧不能读取报价');
    }
    const quantity = num(task.quantity);
    const materialId = task.materialId ?? (
      await this.prisma.procMaterial.findFirst({
        where: {
          name: task.materialName,
          ...(task.spec ? { spec: task.spec } : {}),
        },
        select: { id: true },
      })
    )?.id;

    const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
    const rows = await this.prisma.procSupplierQuote.findMany({
      where: {
        ...(materialId ? { materialId } : {}),
        source: { not: 'tplus-order' },
        OR: [{ validUntil: null }, { validUntil: { gte: today } }],
      },
      include: { material: { select: { name: true, spec: true } } },
      orderBy: [{ updatedAt: 'desc' }],
    });

    const quotes: TaskQuoteBookOption[] = rows.flatMap((quote): TaskQuoteBookOption[] => {
      if (quote.source === 'tplus-order') return [];
      const tiers = this.readQuoteBookTiers(quote.tiers);
      const matchedTier = this.matchQuoteBookTier(tiers, quantity);
      if (!matchedTier) return [];
      return [{
        id: quote.id,
        materialId: quote.materialId,
        materialName: quote.material.name,
        materialSpec: quote.material.spec,
        supplierId: quote.supplierId ?? undefined,
        supplierName: quote.supplierName,
        supplierModel: quote.supplierModel,
        currency: quote.currency,
        taxIncluded: quote.taxIncluded,
        leadTimeDays: quote.leadTimeDays,
        tiers,
        matchedTier,
        belowMinOrder: matchedTier.minQty > quantity,
        quoteDate: day(quote.quoteDate),
        validUntil: day(quote.validUntil),
        note: quote.note ?? undefined,
        updatedAt: quote.updatedAt.toISOString(),
      }];
    }).sort((a, b) =>
      a.materialName.localeCompare(b.materialName, 'zh-CN')
      || a.supplierName.localeCompare(b.supplierName, 'zh-CN'),
    );

    return { materialId: materialId ?? null, quantity, scope: materialId ? 'material' : 'all', quotes };
  }

  /** 从供应商报价库生成任务报价快照；客户端不能提交或改写价格字段。 */
  async addQuotationsFromQuoteBook(
    taskId: string,
    dto: ApplyQuoteBookQuotesDto,
    actor: ProcActor,
  ) {
    const task = await this.requireTask(taskId);
    if (!['pending_inquiry', 'inquiring'].includes(task.status)) {
      throw new BadRequestException('只有「待询价」或「询价中」的任务可从报价库带入报价');
    }

    const requestedIds = Array.from(new Set(dto.quoteIds));
    const options = await this.listTaskQuoteBookOptions(taskId);
    const availableById = new Map(options.quotes.map((quote) => [quote.id, quote] as const));
    const selected = requestedIds.map((id) => availableById.get(id));
    if (selected.some((quote) => !quote)) {
      throw new BadRequestException('所选报价不存在、已过期或当前任务不可用，请刷新后重试');
    }

    const existing = await this.prisma.procQuotation.findMany({
      where: { taskId, channel: 'quote-book' },
      select: { materialId: true, supplierId: true, supplierName: true },
    });
    const identity = (quote: { materialId?: string | null; supplierId?: string | null; supplierName: string }) =>
      JSON.stringify([quote.materialId ?? '', quote.supplierId ? ['id', quote.supplierId] : ['legacy-name', quote.supplierName]]);
    const existingKeys = new Set(existing.map(identity));
    const additions = selected
      .filter((quote): quote is NonNullable<typeof quote> => Boolean(quote))
      .filter((quote) => !existingKeys.has(identity(quote)));
    if (additions.length === 0) throw new BadRequestException('所选报价已带入当前任务');

    await this.prisma.$transaction(async (tx) => {
      await tx.procQuotation.createMany({
        data: additions.map((quote) => ({
          taskId,
          materialId: task.materialId ?? quote.materialId,
          materialName: task.materialId ? task.materialName : quote.materialName,
          supplierId: quote.supplierId ?? null,
          supplierName: quote.supplierName,
          unitPrice: new Prisma.Decimal(quote.matchedTier.unitPrice),
          currency: quote.currency,
          leadTimeDays: quote.leadTimeDays,
          minOrderQty: new Prisma.Decimal(quote.matchedTier.minQty),
          quoteDate: parseDay(quote.quoteDate) ?? new Date(),
          validUntil: parseDay(quote.validUntil),
          channel: 'quote-book',
          note: [
            quote.supplierModel ? `供应商型号：${quote.supplierModel}` : '',
            `税费：${quote.taxIncluded ? '含税' : '未税'}`,
            quote.belowMinOrder ? `任务数量低于起订量，按 MOQ ${quote.matchedTier.minQty} 计价` : '',
            quote.note ?? '',
          ].filter(Boolean).join('；'),
          createdBy: actor.id,
        })),
      });
      await tx.procTaskLog.create({
        data: {
          taskId, kind: 'action',
          text: `从供应商报价库带入 ${additions.length} 条报价：${additions.map((quote) => quote.supplierName).join('、')}`,
          actor: actor.name, actorUserId: actor.id,
        },
      });
    });

    if (task.status === 'pending_inquiry') {
      await this.applyTransition(
        taskId,
        'inquiring',
        actor,
        `从供应商报价库带入 ${additions.length} 条报价，进入询价中`,
        task.status,
      );
    }

    return this.listQuotations({ taskId });
  }

  /**
   * 从报价库批量生成并确认任务报价：「待询价」→「询价中」，只走一格。
   *
   * 曾经这里直接写到 已定价/待到样/测试中，于是界面上表现为「点一下从待询价窜到已定价」，
   * 用户反复报「跳步」。报价确认与询价完成是两件事：确认的是价格快照，完成询价才决定
   * 下一站去哪。后者现在由 completeInquiry 单独承担。
   * selectedQuotationId 仍写首条，供旧客户端与报价汇总使用。
   */
  async confirmQuotationsFromQuoteBook(
    taskId: string,
    dto: ConfirmQuoteBookQuotesDto,
    actor: ProcActor,
  ) {
    const task = await this.requireTask(taskId);
    if (task.status !== 'pending_inquiry') {
      throw new BadRequestException('只有「待询价」的任务可从报价库批量确认报价');
    }

    if (
      !Number.isFinite(dto.discountAmount)
      || dto.discountAmount < 0
      || dto.selections.some((selection) => !Number.isFinite(selection.quantity) || selection.quantity <= 0)
    ) {
      throw new BadRequestException('采购数量或折扣金额无效');
    }
    const requestedIds = dto.selections.map((selection) => selection.quoteId);
    if (new Set(requestedIds).size !== requestedIds.length) {
      throw new BadRequestException('同一条供应商报价不能重复确认');
    }
    const options = await this.listTaskQuoteBookOptions(taskId);
    const availableById = new Map(options.quotes.map((quote) => [quote.id, quote] as const));
    const selected = dto.selections.map((selection) => {
      const quote = availableById.get(selection.quoteId);
      if (!quote) return null;
      const matchedTier = this.matchQuoteBookTier(quote.tiers, selection.quantity);
      if (!matchedTier) return null;
      const quantity = new Prisma.Decimal(selection.quantity);
      const unitPrice = new Prisma.Decimal(matchedTier.unitPrice);
      return {
        quote,
        quantity,
        unitPrice,
        matchedTier,
        lineTotal: unitPrice.mul(quantity).toDecimalPlaces(4),
      };
    });
    if (selected.some((row) => !row)) {
      throw new BadRequestException('所选报价不存在、已过期或当前任务不可用，请刷新后重试');
    }
    const selectedRows = selected.filter(
      (row): row is NonNullable<typeof row> => Boolean(row),
    );
    if (selectedRows.length === 0) {
      throw new BadRequestException('请至少选择一条供应商报价');
    }
    const currencies = new Set(selectedRows.map((row) => row.quote.currency));
    if (currencies.size !== 1) {
      throw new BadRequestException('不同币种的报价不能合并计算总价，请分开确认');
    }
    const currency = selectedRows[0].quote.currency;
    const subtotal = selectedRows
      .reduce((sum, row) => sum.plus(row.lineTotal), new Prisma.Decimal(0))
      .toDecimalPlaces(4);
    const discount = new Prisma.Decimal(dto.discountAmount).toDecimalPlaces(4);
    if (discount.gt(subtotal)) {
      throw new BadRequestException('折扣金额不能大于报价小计');
    }
    const total = subtotal.minus(discount).toDecimalPlaces(4);

    // 确认报价固定停在「询价中」：去哪一档由后续的「完成询价」按需样情况决定，
    // 一次操作只前进一个节点，避免用户看到状态跨越式跳变。
    const next: ProcStatus = 'inquiring';
    await this.prisma.$transaction(async (tx) => {
      // 先原子占用来源状态，再创建报价；并发/过期保存整笔拒绝，失败由事务恢复状态。
      const claimed = await tx.procTask.updateMany({
        where: { id: taskId, status: 'pending_inquiry', updatedAt: task.updatedAt },
        data: { status: next },
      });
      if (claimed.count !== 1) throw new ConflictException('任务状态已被其他操作更新，请刷新后重新确认报价');
      const snapshots: Prisma.ProcQuotationGetPayload<object>[] = [];
      for (const row of selectedRows) {
        const { quote } = row;
        snapshots.push(await tx.procQuotation.create({
          data: {
            taskId,
            materialId: task.materialId ?? quote.materialId,
            materialName: task.materialId ? task.materialName : quote.materialName,
            supplierId: quote.supplierId ?? null,
            supplierName: quote.supplierName,
            unitPrice: row.unitPrice,
            quantity: row.quantity,
            lineTotal: row.lineTotal,
            currency: quote.currency,
            leadTimeDays: quote.leadTimeDays,
            minOrderQty: new Prisma.Decimal(row.matchedTier.minQty),
            quoteDate: parseDay(quote.quoteDate) ?? new Date(),
            validUntil: parseDay(quote.validUntil),
            channel: 'quote-book',
            isSelected: true,
            note: [
              quote.supplierModel ? `供应商型号：${quote.supplierModel}` : '',
              `税费：${quote.taxIncluded ? '含税' : '未税'}`,
              row.matchedTier.minQty > num(row.quantity)
                ? `采购数量低于起订量，按 MOQ ${row.matchedTier.minQty} 计价`
                : '',
              quote.note ?? '',
            ].filter(Boolean).join('；'),
            createdBy: actor.id,
          },
        }));
      }

      // 物料主数据只有一个「最新报价」槽位；同一物料多条同时确认时，以最低单价作为最新参考价。
      const latestByMaterial = new Map<string, (typeof snapshots)[number]>();
      for (const quotation of snapshots) {
        if (!quotation.materialId) continue;
        const current = latestByMaterial.get(quotation.materialId);
        if (!current || num(quotation.unitPrice) < num(current.unitPrice)) {
          latestByMaterial.set(quotation.materialId, quotation);
        }
      }
      for (const [materialId, quotation] of latestByMaterial) {
        await tx.procMaterial.updateMany({
          where: { id: materialId },
          data: {
            latestPrice: quotation.unitPrice,
            latestSupplier: quotation.supplierName,
            latestQuoteDate: quotation.quoteDate,
          },
        });
      }

      await tx.procTask.update({
        where: { id: taskId },
        data: {
          status: next,
          selectedQuotationId: snapshots[0]?.id ?? null,
          quotationSubtotal: subtotal,
          quotationDiscount: discount,
          quotationTotal: total,
          quotationCurrency: currency,
          logs: {
            create: {
              kind: 'action',
              text: `从供应商报价库批量确认 ${snapshots.length} 条报价，报价小计 ${currency} ${subtotal.toFixed(4)}，折扣 ${discount.toFixed(4)}，最终总价 ${total.toFixed(4)}；任务进入「询价中」，待「完成询价」后继续`,
              fromStatus: task.status,
              toStatus: next,
              actor: actor.name,
              actorUserId: actor.id,
            },
          },
        },
      });
    });

    return this.getTask(taskId, actor);
  }

  /** 选定报价：需样 → 待到样，免样 → 已定价；同时回写物料最新价。 */
  /**
   * 撤销本任务已维护的报价，退回「待询价」重做。
   *
   * 报价一旦确认，此前没有任何入口可以改：维护错了只能带着错误单价走完流程，
   * 或者把整条任务作废重建。这里补上重做入口。
   *
   * 边界：只允许在「还没下单」的阶段撤销。进入在途之后单价已经跟着采购单出去了，
   * 再改这里只会让系统与 T+ 对不上，那种情况应当走采购单撤销而不是改报价。
   */
  async resetTaskQuotations(taskId: string, reason: string | undefined, actor: ProcActor) {
    const task = await this.requireTask(taskId);
    // 先看有没有报价：没有报价时说「请先撤销采购单关联」是答非所问，
    // 而重置后任务回到「待询价」，此时再点一次正好落进这一支。
    const existing = await this.prisma.procQuotation.count({ where: { taskId } });
    if (existing === 0) throw new BadRequestException('该任务还没有已确认的报价，无需重新维护');

    if (!PROC_QUOTATION_RESETTABLE_STATUSES.includes(task.status as ProcStatus)) {
      throw new BadRequestException(
        `「${PROC_STATUS_LABELS[task.status as ProcStatus] ?? task.status}」不能重新维护报价：`
        + '已下单及之后的阶段请先撤销采购单关联',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // 条件更新占位：并发下另一个人可能刚把任务推到在途，那时不能再清
      const claimed = await tx.procTask.updateMany({
        where: { id: taskId, status: task.status },
        data: {
          status: 'pending_inquiry',
          selectedQuotationId: null,
          quotationSubtotal: null,
          quotationDiscount: null,
          quotationTotal: null,
        },
      });
      if (claimed.count !== 1) throw new ConflictException('任务状态已被其他操作更新，请刷新后重试');

      await tx.procQuotation.deleteMany({ where: { taskId } });
      await this.endPendingSampleTest(tx, taskId);
      await tx.procTaskLog.create({
        data: {
          taskId,
          kind: 'action',
          // 物料主数据上的「最新参考价」不回滚：它没有留存上一版，且下次确认会覆盖。
          // 这里如实写进留痕，避免有人以为参考价也跟着退回去了。
          text: `重新维护报价：清除 ${existing} 条报价并退回「待询价」${reason ? `；原因：${reason}` : ''}`
            + '（物料主数据的最新参考价不回滚，将在下次确认时更新）',
          fromStatus: task.status,
          toStatus: 'pending_inquiry',
          actor: actor.name,
          actorUserId: actor.id,
        },
      });
      return tx.procTask.findUniqueOrThrow({ where: { id: taskId }, include: PROC_TASK_VIEW_INCLUDE });
    });
    return this.serializeTask(updated);
  }

  async selectQuotation(taskId: string, quotationId: string, actor: ProcActor) {
    const task = await this.requireTask(taskId);
    const quotation = await this.prisma.procQuotation.findUnique({ where: { id: quotationId } });
    if (!quotation || quotation.taskId !== taskId) throw new NotFoundException('报价不存在');
    if (task.status !== 'inquiring') throw new BadRequestException('只有「询价中」的任务可选定报价');

    const selectedQuantity = quotation.quantity ?? task.quantity;
    const selectedLineTotal = quotation.unitPrice.mul(selectedQuantity).toDecimalPlaces(4);
    await this.prisma.$transaction(async (tx) => {
      await tx.procQuotation.updateMany({ where: { taskId }, data: { isSelected: false } });
      await tx.procQuotation.update({
        where: { id: quotationId },
        data: {
          isSelected: true,
          quantity: selectedQuantity,
          lineTotal: selectedLineTotal,
        },
      });
      await tx.procTask.update({
        where: { id: taskId },
        data: {
          selectedQuotationId: quotationId,
          quotationSubtotal: selectedLineTotal,
          quotationDiscount: new Prisma.Decimal(0),
          quotationTotal: selectedLineTotal,
          quotationCurrency: quotation.currency,
          logs: {
            create: {
              kind: 'action',
              text: `选定报价：${quotation.supplierName}；单价 ${quotation.currency} ${num(quotation.unitPrice)}，数量 ${num(selectedQuantity)}，总价 ${selectedLineTotal.toFixed(4)}`,
              actor: actor.name,
              actorUserId: actor.id,
            },
          },
        },
      });
    });
    if (task.materialId) {
      await this.prisma.procMaterial.update({
        where: { id: task.materialId },
        data: {
          latestPrice: quotation.unitPrice,
          latestSupplier: quotation.supplierName,
          latestQuoteDate: quotation.quoteDate,
        },
      });
    }
    const next: ProcStatus = task.needSample ? 'pending_sample' : 'priced';
    return this.applyTransition(
      taskId,
      next,
      actor,
      `选定 ${quotation.supplierName}（${num(quotation.unitPrice)}）`,
      task.status,
    );
  }

  /** 物料历史价格：跨任务聚合，用于价格趋势对比。 */
  async listQuotations(params: { materialId?: string; materialName?: string; taskId?: string }) {
    const where: Prisma.ProcQuotationWhereInput = {};
    if (params.taskId) where.taskId = params.taskId;
    if (params.materialId) where.materialId = params.materialId;
    if (params.materialName) where.materialName = params.materialName;
    const rows = await this.prisma.procQuotation.findMany({
      where,
      orderBy: { quoteDate: 'desc' },
      take: 200,
    });
    return rows.map((r) => this.serializeQuotation(r));
  }

  private readQuoteBookTiers(value: Prisma.JsonValue): Array<{ minQty: number; unitPrice: number }> {
    if (!Array.isArray(value)) return [];
    return value
      .map((tier) => {
        if (!tier || typeof tier !== 'object' || Array.isArray(tier)) return null;
        const row = tier as Record<string, Prisma.JsonValue>;
        const minQty = Number(row.minQty);
        const unitPrice = Number(row.unitPrice);
        if (!Number.isFinite(minQty) || minQty < 0 || !Number.isFinite(unitPrice) || unitPrice <= 0) return null;
        return { minQty, unitPrice };
      })
      .filter((tier): tier is { minQty: number; unitPrice: number } => Boolean(tier))
      .sort((a, b) => a.minQty - b.minQty);
  }

  private matchQuoteBookTier(
    tiers: Array<{ minQty: number; unitPrice: number }>,
    quantity: number,
  ): { minQty: number; unitPrice: number } | null {
    if (tiers.length === 0) return null;
    let matched = tiers[0];
    for (const tier of tiers) {
      if (tier.minQty > quantity) break;
      matched = tier;
    }
    return matched;
  }

  // ── T+ 采购单接缝 ───────────────────────────────────────────────────────────

  /** 关联 T+ 采购单：任务进入「已下单」。本系统不创建 T+ 单据，只登记引用。 */
  async linkPurchaseOrder(taskId: string, dto: LinkPurchaseOrderDto, actor: ProcActor) {
    return this.linkPurchaseOrders(taskId, [dto], actor);
  }

  /**
   * 多供应商采购单一次性关联；任意一条失败则全部回滚。
   *
   * 「待到样」是出样单登记：打样迭代要下出样单（可能是模具单，也可能免费来样），
   * 但样品没到之前任务不能算「已下单/在途」，所以这一档只登记关联，不动状态。
   */
  async linkPurchaseOrders(
    taskId: string,
    items: LinkPurchaseOrderDto[],
    actor: ProcActor,
    options?: { syncTaskQuantity?: boolean },
  ) {
    const task = await this.requireTask(taskId);
    if (!PROC_PO_LINKABLE_STATUSES.includes(task.status as ProcStatus)) {
      throw new BadRequestException('当前状态不允许关联采购单');
    }
    const normalized = items.map((item) => ({
      ...item,
      tpOrderNo: item.isFreeSample ? '' : (item.tpOrderNo ?? '').trim(),
      tpLineNo: item.isFreeSample ? null : item.tpLineNo?.trim() || null,
      isFreeSample: Boolean(item.isFreeSample),
    }));
    if (normalized.length === 0) throw new BadRequestException('请至少登记一条采购单或免费样品');
    // 待询价 / 询价中放开登记，是为了让「供应商提前寄样」当场留痕，不是为了在定价前登记正式采购单：
    // 这两档还没选定报价，T+ 里不可能有对应的采购单号。
    if (
      PROC_FREE_SAMPLE_ONLY_STATUSES.includes(task.status as ProcStatus)
      && normalized.some((item) => !item.isFreeSample)
    ) {
      throw new BadRequestException(
        `「${PROC_STATUS_LABELS[task.status as ProcStatus] ?? task.status}」只能登记免费样品来货，正式采购单请在定价后登记`,
      );
    }
    // 免费样品来货 T+ 里没有采购单，单号必然为空；其余情况仍必须给号，否则后续同步无从对账。
    if (normalized.some((item) => !item.isFreeSample && !item.tpOrderNo)) {
      throw new BadRequestException('采购单号不能为空');
    }
    // 免费样品行单号都是空串，天然互相「重复」，去重只校验有号的行。
    const keys = normalized
      .filter((item) => !item.isFreeSample)
      .map((item) => `${item.tpOrderNo}\u0000${item.tpLineNo ?? ''}`);
    if (new Set(keys).size !== keys.length) {
      throw new BadRequestException('同一采购单及行号不能重复关联');
    }
    if (normalized.some((item, index) => !item.isFreeSample && normalized.some((other, otherIndex) =>
      otherIndex !== index && !other.isFreeSample && item.tpOrderNo === other.tpOrderNo
      && (!item.tpLineNo || !other.tpLineNo)))) {
      throw new BadRequestException('同一采购单不能混用未指定行号和明确行号，请填写各条采购单行号');
    }
    const startsSampleWait = PROC_FREE_SAMPLE_ONLY_STATUSES.includes(task.status as ProcStatus);
    const nextStatus = startsSampleWait
      ? 'pending_sample'
      : task.status === 'priced' || task.status === 'pending_purchase' ? 'in_transit' : task.status;
    const isSampleOrder = task.status === 'pending_sample' || startsSampleWait;
    // 预计到货只有 T+ 同步会回填到任务上，免费样品和出样单没有同步可依，这里按最早的一条落回去。
    const earliestEta = normalized
      .map((item) => parseDay(item.etaDate))
      .filter((date): date is Date => Boolean(date))
      .sort((a, b) => a.getTime() - b.getTime())[0];
    // 出样 1 件的任务改下 500 件批量单时，任务数量不跟着改，到货 1 件就会判完成。
    // 免费样品不是需求量的一部分（样品 1 件 + 批量 500 件 ≠ 需要 501 件），不计入。
    const orderedTotal = normalized
      .filter((item) => !item.isFreeSample)
      .reduce((sum, item) => sum + (item.orderedQty ?? 0), 0);
    const syncQuantity = Boolean(options?.syncTaskQuantity)
      && !isSampleOrder
      && orderedTotal > 0
      && orderedTotal !== num(task.quantity);
    // 免费样品行没有单号可写进留痕，退而记供应商，否则日志里只剩一串顿号。
    const supplierOf = (item: (typeof normalized)[number]) => item.supplierName?.trim() || '未指定供应商';
    const freeSampleOnly = normalized.every((item) => item.isFreeSample);
    const detail = freeSampleOnly
      ? normalized.map(supplierOf).join('、')
      : normalized
          .map((item) => (item.isFreeSample ? `免费样品·${supplierOf(item)}` : item.tpOrderNo))
          .join('、');
    const head = isSampleOrder
      ? (freeSampleOnly ? `登记 ${normalized.length} 条免费出样（T+ 无采购单）` : `登记 ${normalized.length} 张出样单`)
      : (freeSampleOnly ? `登记 ${normalized.length} 条免费样品来货（T+ 无采购单）` : `一次关联 ${normalized.length} 张采购单`);
    const logText = `${head}：${detail}${
      syncQuantity ? `；任务采购数量由 ${num(task.quantity)} 更新为 ${orderedTotal}` : ''
    }${startsSampleWait ? '；进入「待到样」，等待实际到样后确认收样' : ''}`;
    await this.prisma.$transaction(async (tx) => {
      for (const orderNo of [...new Set(normalized.filter(row=>!row.isFreeSample).map(row=>row.tpOrderNo))].sort()) {
        await lockOrderDependency(tx, orderNo);
      }
      // 所有关联入口复用这里；按任务行加锁，使历史查重与新增在并发请求中保持原子。
      await tx.$queryRaw`SELECT id FROM "ProcTask" WHERE id = ${taskId} FOR UPDATE`;
      const existingRefs = await tx.procPurchaseOrderRef.findMany({ where: { taskId } });
      for (const item of normalized.filter((row) => !row.isFreeSample)) {
        const sameOrder = existingRefs.filter((ref) => ref.tpOrderNo.trim() === item.tpOrderNo
          && (ref.metadata as Prisma.JsonObject | null)?.freeSample !== true);
        if (sameOrder.some((ref) => (ref.tpLineNo?.trim() || null) === item.tpLineNo)) {
          throw new ConflictException(`采购单 ${item.tpOrderNo}${item.tpLineNo ? ` 第 ${item.tpLineNo} 行` : ''} 已关联，请勿重复关联`);
        }
        if (sameOrder.some((ref) => !ref.tpLineNo?.trim() || !item.tpLineNo)) {
          throw new ConflictException(`采购单 ${item.tpOrderNo} 的行号不明确，请先解除原关联并按明确行号重新关联`);
        }
      }
      const currentTask = await tx.procTask.findUnique({ where: { id: taskId } });
      if (!currentTask || currentTask.status !== task.status || num(currentTask.quantity) !== num(task.quantity)) {
        throw new ConflictException('任务状态或采购数量已被更新，请刷新后重新关联');
      }
      await tx.procPurchaseOrderRef.createMany({
        data: normalized.map((item) => ({
          taskId,
          tpOrderNo: item.tpOrderNo,
          tpOrderId: item.tpOrderId ?? null,
          tpLineNo: item.tpLineNo ?? null,
          supplierName: item.supplierName?.trim() ?? '',
          orderedQty: new Prisma.Decimal(item.orderedQty ?? 0),
          orderDate: parseDay(item.orderDate),
          etaDate: parseDay(item.etaDate),
          linkedBy: actor.id,
          metadata: item.isFreeSample ? { freeSample: true } : {},
        })),
      });
      await tx.procTask.update({
        where: { id: taskId },
        data: {
          status: nextStatus,
          ...(startsSampleWait ? { needSample: true } : {}),
          ...(syncQuantity ? { quantity: new Prisma.Decimal(orderedTotal) } : {}),
          ...(earliestEta ? { expectedArrivalDate: earliestEta } : {}),
          logs: {
            create: {
              kind: 'system',
              text: logText,
              fromStatus: task.status,
              toStatus: nextStatus,
              actor: actor.name,
              actorUserId: actor.id,
            },
          },
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    return this.getTask(taskId, actor);
  }

  /**
   * 撤销一条采购单关联，并撤掉这条关联自己带进来的东西。
   *
   * 只回滚「能证明归属于这条 ref」的增量：它同步进来的到货量、它在 T+ 镜像上占的
   * confirmed 名额、它写进任务的预计到货日。无法判定归属的一律不猜：
   *   - quantity 关联时可能被 syncTaskQuantity 覆写，但原值全库没有第二份留存
   *     （日志只有中文自由文本，且会被 updateTask 改数量、多次关联等情形击穿），
   *     猜错的代价是完成判定与缺料统计的分母错，所以只在留痕里写明当前值供人工决定。
   *   - 更早的状态回退没有可信目标值，那是 rollbackTask 的职责。
   *
   * 刻意不调 recomputeArrival：它会用剩余 ref 的 receivedQty 覆盖 arrivedQty，
   * 把 receiveGoods 手工登记的到货一次抹零，语义与「移除这一单的到货量」不符。
   * 注意这里的定额扣减不是终态——只要任务还剩带号的 ref，夜间同步仍会整体重算。
   */
  async unlinkPurchaseOrder(taskId: string, refId: string, actor: ProcActor) {
    const task = await this.requireTask(taskId);
    const ref = await this.prisma.procPurchaseOrderRef.findFirst({ where: { id: refId, taskId } });
    // 已经删掉了：双击垃圾桶、多标签页重复提交都应当是成功而不是红字报错
    if (!ref) return this.getTask(taskId, actor);

    const metadata = (ref.metadata ?? {}) as Prisma.JsonObject;
    const freeSample = metadata.freeSample === true;
    // 预计到货是覆盖式写入且不留原值，只有「当前值与本条 ref 的日期完全相等」
    // 才能证明它是这条带来的；此时回落到剩余 ref 的最早日期，没有就清空。
    // 不清空的话，一个已无任何采购单的任务会继续被算进各页「本周到货」。
    const refEta = ref.etaDate;
    const ownsEta = refEta !== null && task.expectedArrivalDate?.getTime() === refEta.getTime();

    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ProcTask" WHERE id = ${taskId} FOR UPDATE`;
      const removed = await tx.procPurchaseOrderRef.deleteMany({ where: { id: refId, taskId } });
      if (removed.count === 0) return;
      const rest = await tx.procPurchaseOrderRef.findMany({ where: { taskId } });
      const hasSameOrderLine = rest.some((row) => row.tpOrderNo.trim() === ref.tpOrderNo.trim()
        && (row.tpLineNo?.trim() || '') === (ref.tpLineNo?.trim() || '')
        && (row.metadata as Prisma.JsonObject | null)?.freeSample !== true);
      // 同一 ERP 行的历史重复引用只计一份，只有删到最后一条才撤掉该行到货量。
      // 免费样品的到货由人工登记，解除引用不扣减。
      const delta = freeSample || hasSameOrderLine ? 0 : num(ref.receivedQty);
      const nextArrived = Math.max(0, num(task.arrivedQty) - delta);
      let nextStatus = task.status as ProcStatus;
      if (delta > 0 && (task.status === 'partial_arrival' || task.status === 'completed')) {
        const quantity = num(task.quantity);
        if (nextArrived === 0) nextStatus = 'in_transit';
        else if (quantity > 0 && nextArrived < quantity) nextStatus = 'partial_arrival';
      }
      const leavingCompleted = task.status === 'completed' && nextStatus !== 'completed';

      const data: Prisma.ProcTaskUncheckedUpdateManyInput = {};
      if (delta > 0) data.arrivedQty = new Prisma.Decimal(nextArrived);
      if (nextStatus !== task.status) data.status = nextStatus;
      if (leavingCompleted) data.businessDone = false;
      if (ownsEta) {
        data.expectedArrivalDate = rest
          .map((row) => row.etaDate)
          .filter((date): date is Date => date !== null)
          .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
      }

      // 条件占位必须连 arrivedQty 一起守：只守 status 挡不住并发解除另一条 ref，
      // 也挡不住夜间同步在状态不变的情况下重算到货量，两者都会让这次扣减基于陈旧读数。
      if (Object.keys(data).length > 0) {
        const claimed = await tx.procTask.updateMany({
          where: {
            id: taskId,
            status: task.status,
            ...(delta > 0 ? { arrivedQty: task.arrivedQty } : {}),
          },
          data,
        });
        if (claimed.count !== 1) throw new ConflictException('任务已被其他操作更新，请刷新后重试');
      }

      // 镜像行不复位，这张 T+ 单据就在系统里死锁：自动匹配只捞未匹配的行，
      // 重新确认会被「已确认过」挡回，忽略也被同样排除，全仓没有其它复位入口。
      if (!freeSample && ref.tpOrderNo) {
        if (!hasSameOrderLine) {
          await tx.procPurchaseOrderMirror.updateMany({
            where: {
              tpOrderNo: ref.tpOrderNo.trim(),
              tpLineNo: ref.tpLineNo?.trim() || '',
              matchTaskId: taskId,
              matchStatus: 'confirmed',
            },
            data: { matchStatus: 'unmatched', matchTaskId: null, matchConfidence: null, matchReason: null },
          });
        }
      }

      const parts = [
        `撤销采购单关联：${freeSample ? `免费样品·${ref.supplierName || '未指定供应商'}` : ref.tpOrderNo}`,
        delta > 0 ? `已扣减到货量 ${delta}` : '本单无已同步到货量，到货数不变',
        freeSample ? '' : `任务采购数量 ${num(task.quantity)} 保持不变（本单原下单数 ${num(ref.orderedQty)}）`,
      ].filter(Boolean);
      await tx.procTaskLog.create({
        data: {
          taskId,
          kind: 'action',
          text: parts.join('；'),
          fromStatus: task.status,
          toStatus: nextStatus,
          actor: actor.name,
          actorUserId: actor.id,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });

    return this.getTask(taskId, actor);
  }

  /**
   * 依据已关联的 T+ 采购单重算任务到货量与状态。
   * T+ 同步落库后调用；到货齐 → 已完成，部分到货 → partial_arrival。
   */
  async recomputeArrival(taskId: string) {
    return this.prisma.$transaction(async (tx) => {
      // 与样品分派、测试确认及采购单关联串行；锁后读取，避免同步把已推进的状态写回旧值。
      await tx.$queryRaw`SELECT id FROM "ProcTask" WHERE id = ${taskId} FOR NO KEY UPDATE`;
      const task = await tx.procTask.findUnique({
        where: { id: taskId },
        include: { purchaseOrderRefs: true },
      });
      if (!task) return null;
      // 历史重复引用仍保留以便人工核查；同一 ERP 行只采用最近同步的一份累计到货量。
      const latestRefs = new Map<string, (typeof task.purchaseOrderRefs)[number]>();
      for (const ref of task.purchaseOrderRefs) {
        if ((ref.metadata as Prisma.JsonObject | null)?.freeSample === true) continue;
        const key = !ref.tpOrderNo.trim() ? ref.id : `${ref.tpOrderNo.trim()}\u0000${ref.tpLineNo?.trim() || ''}`;
        const previous = latestRefs.get(key);
        const timestamp = (row: typeof ref) => row.syncedAt?.getTime() ?? row.updatedAt?.getTime() ?? row.createdAt?.getTime() ?? 0;
        if (!previous || timestamp(ref) > timestamp(previous)) latestRefs.set(key, ref);
      }
      const received = [...latestRefs.values()].reduce((sum, ref) => sum + num(ref.receivedQty), 0);
      const quantity = num(task.quantity);
      let status = task.status;
      if (PROC_ARRIVAL_STATUSES.includes(task.status as ProcStatus)) {
        if (quantity > 0 && received >= quantity) status = 'completed';
        else if (received > 0) status = 'partial_arrival';
        else status = 'in_transit';
      }
      const eta = task.purchaseOrderRefs
        .map((r) => r.etaDate)
        .filter((d): d is Date => Boolean(d))
        .sort((a, b) => a.getTime() - b.getTime())[0];

      await tx.procTask.update({
        where: { id: taskId },
        data: {
          arrivedQty: new Prisma.Decimal(received),
          status,
          businessDone: PROC_ARRIVAL_STATUSES.includes(task.status as ProcStatus) ? status === 'completed' : task.businessDone,
          expectedArrivalDate: eta ?? task.expectedArrivalDate,
        },
      });
      return { taskId, arrivedQty: received, status };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  // ── 物料主数据 ───────────────────────────────────────────────────────────────

  async listMaterials(query: ProcMaterialListQuery) {
    const where: Prisma.ProcMaterialWhereInput = {};
    if (query.category) where.category = query.category;
    if (query.productLine) where.productLine = query.productLine;
    if (query.reviewStatus) where.reviewStatus = { in: query.reviewStatus.split(',') };
    if (query.keyword?.trim()) {
      const kw = query.keyword.trim();
      where.OR = [
        { name: { contains: kw, mode: 'insensitive' } },
        { spec: { contains: kw, mode: 'insensitive' } },
        { erpCode: { contains: kw, mode: 'insensitive' } },
        { tpInventoryCode: { contains: kw, mode: 'insensitive' } },
      ];
    }
    const page = Math.max(1, Number(query.page) || 1);
    // 物料主档全量供前端树形表使用（数千条量级，序列化后 <2MB）
    const pageSize = Math.min(10000, Math.max(1, Number(query.pageSize) || 200));

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.procMaterial.count({ where }),
      this.prisma.procMaterial.findMany({
        where,
        orderBy: [{ category: 'asc' }, { name: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { balances: true },
      }),
    ]);

    const snapshot = await this.inventoryStock.read({ codes: rows.flatMap(row => row.tpInventoryCode?.trim() ? [row.tpInventoryCode] : []), scope: { kind: 'all' } });
    let items = rows.map((r) => this.serializeMaterial(r, snapshot));
    // 缺料筛选：库存 < 安全库存。阈值本地维护，库存来自 T+ 镜像。
    if (query.shortageOnly === 'true') {
      items = items.filter((m) => m.safeStock > 0 && m.stockQty !== null && m.stockQty < m.safeStock);
    }
    return { total, page, pageSize, items };
  }

  async upsertMaterial(dto: UpsertMaterialDto, actor: ProcActor, id?: string) {
    if (id) {
      // 更新走部分更新：只改 dto 里显式传入的字段，未传字段保留原值。
      // 调用方（前端编辑表单 / Excel 导入）想清空某字段须显式传空串。
      const data: Prisma.ProcMaterialUpdateInput = { name: dto.name };
      if (dto.spec !== undefined) data.spec = dto.spec;
      if (dto.unit !== undefined) data.unit = dto.unit;
      if (dto.category !== undefined) data.category = dto.category;
      if (dto.productLine !== undefined) data.productLine = dto.productLine;
      if (dto.erpCode !== undefined) data.erpCode = dto.erpCode;
      if (dto.tpInventoryCode !== undefined) data.tpInventoryCode = dto.tpInventoryCode || null;
      if (dto.isSpecial !== undefined) data.isSpecial = dto.isSpecial;
      if (dto.isConsumable !== undefined) data.isConsumable = dto.isConsumable;
      if (dto.safeStock !== undefined) data.safeStock = new Prisma.Decimal(dto.safeStock);
      if (dto.remark !== undefined) data.remark = dto.remark || null;
      if (dto.imageKey !== undefined) data.imageKey = dto.imageKey.trim() || null;
      const row = await this.prisma.$transaction(async tx=>{
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${'tplus-publish-material:'+id}))::text`;
        const pending=await tx.runtimeState.findUnique({where:{key:'erp-material-publish:'+id}});
        if(pending?.value){
          const attempt=JSON.parse(pending.value) as {identity:string};
          const current=await tx.procMaterial.findUniqueOrThrow({where:{id}});
          const nextIdentity=JSON.stringify([dto.name??current.name,dto.spec??current.spec,dto.unit??current.unit,dto.category??current.category].map(value=>value.trim()));
          if(nextIdentity!==attempt.identity || dto.tpInventoryCode && dto.tpInventoryCode!==current.tpInventoryCode || dto.erpCode!==undefined && dto.erpCode!==current.erpCode) {
            throw new ConflictException('ERP录入结果待核对，暂不能修改物料名称、规格、单位、分类或编码');
          }
        }
        return tx.procMaterial.update({where:{id},data});
      });
      return this.serializeMaterial({ ...row, balances: [] });
    }
    const row = await this.prisma.procMaterial.create({
      data: {
        name: dto.name,
        spec: dto.spec ?? '',
        unit: dto.unit ?? '',
        category: dto.category ?? '',
        productLine: dto.productLine ?? '',
        erpCode: dto.erpCode ?? '',
        tpInventoryCode: dto.tpInventoryCode || null,
        isSpecial: dto.isSpecial ?? false,
        isConsumable: dto.isConsumable ?? false,
        safeStock: new Prisma.Decimal(dto.safeStock ?? 0),
        remark: dto.remark ?? null,
        imageKey: dto.imageKey?.trim() || null,
        reviewSource: 'manual',
        createdBy: actor.id,
      },
    });
    return this.serializeMaterial({ ...row, balances: [] });
  }

  async reviewMaterial(id: string, dto: ReviewMaterialDto, actor: ProcActor) {
    const row = await this.prisma.procMaterial.update({
      where: { id },
      data: {
        reviewStatus: dto.reviewStatus,
        reviewNote: dto.reviewNote ?? null,
        reviewedBy: actor.name,
        reviewedAt: new Date(),
      },
    });
    return this.serializeMaterial({ ...row, balances: [] });
  }

  /** 批量导入：按 tpInventoryCode 或 name+spec 去重，已存在则更新，不存在则建为待审核。 */
  async importMaterials(dto: ImportMaterialsDto, actor: ProcActor) {
    let created = 0;
    let updated = 0;
    for (const item of dto.items) {
      const existing = await this.prisma.procMaterial.findFirst({
        where: item.tpInventoryCode
          ? { tpInventoryCode: item.tpInventoryCode }
          : { name: item.name, spec: item.spec ?? '' },
        select: { id: true },
      });
      if (existing) {
        await this.upsertMaterial(item, actor, existing.id);
        updated += 1;
      } else {
        const row = await this.upsertMaterial(item, actor);
        // 带 T+ 存货编码的视为 ERP 主档（事实源）免审核；其余进入审核队列
        await this.prisma.procMaterial.update({
          where: { id: row.id },
          data: item.tpInventoryCode
            ? { reviewStatus: 'approved', reviewSource: 'import' }
            : { reviewStatus: 'pending', reviewSource: 'import' },
        });
        created += 1;
      }
    }
    return { created, updated, total: dto.items.length };
  }

  // ── 采购任务系统树 ───────────────────────────────────────────────────────────

  private static readonly CORE_MATERIALS_KEY_PREFIX = 'procurement:core-materials:v1:';
  private static readonly MAX_CORE_MATERIALS_PER_PRODUCT = 30;

  async getCoreMaterialConfig() {
    const rows = await this.prisma.runtimeState.findMany({
      where: { key: { startsWith: ProcurementService.CORE_MATERIALS_KEY_PREFIX } },
    });
    const products: Record<string, string[]> = {};
    for (const row of rows) {
      const productId = row.key.slice(ProcurementService.CORE_MATERIALS_KEY_PREFIX.length);
      if (!productId) continue;
      try {
        const parsed = JSON.parse(row.value) as { materialIds?: unknown };
        if (!Array.isArray(parsed.materialIds)) continue;
        products[productId] = parsed.materialIds.filter((id): id is string => typeof id === 'string');
      } catch {
        products[productId] = [];
      }
    }
    return { maxItems: ProcurementService.MAX_CORE_MATERIALS_PER_PRODUCT, products };
  }

  async setCoreMaterialConfig(
    productId: string,
    dto: SetProcCoreMaterialsDto,
    actor: ProcActor,
  ) {
    const normalizedProductId = normalizeProcProductId(productId);
    const materialIds = dto.materialIds.map((id) => id.trim());
    if (materialIds.some((id) => !id)) {
      throw new BadRequestException('核心配件不能包含空物料编号');
    }
    if (materialIds.length > ProcurementService.MAX_CORE_MATERIALS_PER_PRODUCT) {
      throw new BadRequestException(`每个产品最多配置 ${ProcurementService.MAX_CORE_MATERIALS_PER_PRODUCT} 个核心配件`);
    }
    if (new Set(materialIds).size !== materialIds.length) {
      throw new BadRequestException('同一产品不能重复配置同一个核心配件');
    }

    if (materialIds.length > 0) {
      const [nodes, materials] = await Promise.all([
        this.prisma.procTaskTreeNode.findMany({
          where: {
            productId: normalizedProductId,
            parentId: { not: null },
            children: { none: {} },
            materialId: { in: materialIds },
          },
          select: { materialId: true },
        }),
        this.prisma.procMaterial.findMany({
          where: { id: { in: materialIds } },
          select: {
            id: true,
            tpInventoryCode: true,
            balances: {
              where: { syncedAt: { not: null } },
              select: { id: true },
              take: 1,
            },
          },
        }),
      ]);
      const productMaterialIds = new Set(nodes.flatMap((node) => node.materialId ? [node.materialId] : []));
      if (materialIds.some((id) => !productMaterialIds.has(id))) {
        throw new BadRequestException('核心配件必须来自当前产品的子系统叶子物料');
      }
      if (materials.length !== materialIds.length) {
        throw new BadRequestException('核心配件配置中包含不存在的物料');
      }
      if (materials.some((material) => !material.tpInventoryCode?.trim() || material.balances.length === 0)) {
        throw new BadRequestException('核心配件必须已关联 T+ 并完成库存同步');
      }
    }

    await this.prisma.runtimeState.upsert({
      where: { key: `${ProcurementService.CORE_MATERIALS_KEY_PREFIX}${normalizedProductId}` },
      create: {
        key: `${ProcurementService.CORE_MATERIALS_KEY_PREFIX}${normalizedProductId}`,
        value: JSON.stringify({ materialIds, updatedAt: new Date().toISOString(), updatedBy: actor.id }),
      },
      update: {
        value: JSON.stringify({ materialIds, updatedAt: new Date().toISOString(), updatedBy: actor.id }),
      },
    });
    return {
      maxItems: ProcurementService.MAX_CORE_MATERIALS_PER_PRODUCT,
      productId: normalizedProductId,
      materialIds,
    };
  }

  /** 首次打开时用库存 BOM 附件中的「分类 / 名称」初始化两级目录。 */
  private async ensureProcTaskTreeSeeded() {
    const existing = await this.prisma.procTaskTreeNode.count();
    if (existing > 0) return;
    const seedStateKey = 'procurement.task-tree.initialized';
    const seedState = await this.prisma.runtimeState.findUnique({ where: { key: seedStateKey } });
    if (seedState) return;

    const materials = await this.prisma.procMaterial.findMany({
      select: { id: true, erpCode: true, tpInventoryCode: true },
    });
    const materialByTpCode = new Map<string, string>();
    const materialByUniqueErpCode = new Map<string, string>();
    const erpCodeCounts = new Map<string, number>();
    for (const material of materials) {
      const erpCode = material.erpCode.trim();
      if (erpCode) {
        erpCodeCounts.set(erpCode, (erpCodeCounts.get(erpCode) ?? 0) + 1);
        materialByUniqueErpCode.set(erpCode, material.id);
      }
      const tpCode = material.tpInventoryCode?.trim();
      if (tpCode) materialByTpCode.set(tpCode, material.id);
    }

    const roots: Prisma.ProcTaskTreeNodeCreateManyInput[] = [];
    const children: Prisma.ProcTaskTreeNodeCreateManyInput[] = [];
    let childIndex = 0;
    INITIAL_PROC_TASK_TREE.forEach((root, rootIndex) => {
      const rootId = `proc-task-tree-root-${rootIndex + 1}`;
      roots.push({ id: rootId, productId: DEFAULT_PROC_PRODUCT_ID, name: root.name, sortOrder: rootIndex });
      root.children.forEach((child, sortOrder) => {
        childIndex += 1;
        children.push({
          id: `proc-task-tree-item-${childIndex}`,
          productId: DEFAULT_PROC_PRODUCT_ID,
          parentId: rootId,
          name: child.name,
          code: child.code || null,
          spec: child.spec || null,
          materialId:
            materialByTpCode.get(child.code) ??
            (erpCodeCounts.get(child.code) === 1 ? materialByUniqueErpCode.get(child.code) : undefined) ??
            null,
          sortOrder,
        });
      });
    });

    await this.prisma.$transaction([
      this.prisma.procTaskTreeNode.createMany({ data: roots, skipDuplicates: true }),
      this.prisma.procTaskTreeNode.createMany({ data: children, skipDuplicates: true }),
      this.prisma.runtimeState.upsert({
        where: { key: seedStateKey },
        create: { key: seedStateKey, value: new Date().toISOString() },
        update: {},
      }),
    ]);
  }

  /**
   * 给已经存在、但尚未关联物料的任务树叶子补链。
   *
   * T+ 主档可能晚于任务树初始化进入系统，因此不能只依赖首次 seed。匹配规则与 seed
   * 保持一致：T+ 存货编码优先；ERP 编码只有在全库唯一时才使用，避免错误串料。
   * 已经有关联的节点一律不覆盖，方法可安全重复执行。
   */
  async reconcileProcTaskTreeMaterialLinks() {
    const [nodes, materials] = await Promise.all([
      this.prisma.procTaskTreeNode.findMany({
        where: { materialId: null, code: { not: null } },
        select: { id: true, code: true },
      }),
      this.prisma.procMaterial.findMany({
        select: { id: true, erpCode: true, tpInventoryCode: true },
      }),
    ]);

    const materialByTpCode = new Map<string, string>();
    const materialByErpCode = new Map<string, string>();
    const erpCodeCounts = new Map<string, number>();
    for (const material of materials) {
      const tpCode = material.tpInventoryCode?.trim();
      if (tpCode) materialByTpCode.set(tpCode, material.id);

      const erpCode = material.erpCode.trim();
      if (erpCode) {
        erpCodeCounts.set(erpCode, (erpCodeCounts.get(erpCode) ?? 0) + 1);
        materialByErpCode.set(erpCode, material.id);
      }
    }

    let linkedNodes = 0;
    let unmatchedNodes = 0;
    let ambiguousNodes = 0;
    for (const node of nodes) {
      const code = node.code?.trim();
      if (!code) {
        unmatchedNodes += 1;
        continue;
      }
      const tpMaterialId = materialByTpCode.get(code);
      const erpCount = erpCodeCounts.get(code) ?? 0;
      const materialId = tpMaterialId ?? (erpCount === 1 ? materialByErpCode.get(code) : undefined);
      if (!materialId) {
        if (erpCount > 1) ambiguousNodes += 1;
        else unmatchedNodes += 1;
        continue;
      }
      const result = await this.prisma.procTaskTreeNode.updateMany({
        where: { id: node.id, materialId: null },
        data: { materialId },
      });
      linkedNodes += result.count;
    }

    return { scannedNodes: nodes.length, linkedNodes, unmatchedNodes, ambiguousNodes };
  }

  /**
   * 返回两级系统树，并把采购任务按 materialId 归入叶子节点。
   * 未匹配物料的手工节点按名称兜底，保证旧任务也能显示。
   */
  async getProcTaskTree(productId?: string): Promise<{ roots: ProcTaskTreeNodeView[] }> {
    await this.ensureProcTaskTreeSeeded();
    return this.getProcTaskTreeWithClient(this.prisma, normalizeProcProductId(productId));
  }

  private async getProcTaskTreeWithClient(
    client: ProcTaskTreeDbClient,
    productId?: string,
  ): Promise<{ roots: ProcTaskTreeNodeView[] }> {
    const [rows, tasks] = await Promise.all([
      client.procTaskTreeNode.findMany({
        ...(productId ? { where: { productId } } : {}),
        orderBy: [{ parentId: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
      client.procTask.findMany({
        where: { ...(productId ? { productId } : {}), status: { not: 'pending_rd_review' } },
        select: { id: true, productId: true, treeNodeId: true, materialId: true, materialName: true },
      }),
    ]);

    // 显式归属（手工移动过归类）优先；没写过的任务才回落到按物料/名称推导。
    // 两者分开统计，避免同一个任务既算进显式节点又被推导挂到另一个节点。
    const taskIdsByNode = new Map<string, string[]>();
    const nodeIds = new Set(rows.map((row) => row.id));
    const derivedTasks: typeof tasks = [];
    for (const task of tasks) {
      if (task.treeNodeId && nodeIds.has(task.treeNodeId)) {
        const ids = taskIdsByNode.get(task.treeNodeId) ?? [];
        ids.push(task.id);
        taskIdsByNode.set(task.treeNodeId, ids);
        continue;
      }
      derivedTasks.push(task);
    }

    const taskIdsByMaterial = new Map<string, string[]>();
    const taskIdsByName = new Map<string, string[]>();
    const fallbackLeafCountByName = new Map<string, number>();
    for (const row of rows) {
      if (row.parentId && !row.materialId) {
        const nameKey = `${row.productId}:${row.name}`;
        fallbackLeafCountByName.set(nameKey, (fallbackLeafCountByName.get(nameKey) ?? 0) + 1);
      }
    }
    for (const task of derivedTasks) {
      if (task.materialId) {
        const materialKey = `${task.productId}:${task.materialId}`;
        const ids = taskIdsByMaterial.get(materialKey) ?? [];
        ids.push(task.id);
        taskIdsByMaterial.set(materialKey, ids);
        continue;
      }
      const nameKey = `${task.productId}:${task.materialName}`;
      if (fallbackLeafCountByName.get(nameKey) === 1) {
        const ids = taskIdsByName.get(nameKey) ?? [];
        ids.push(task.id);
        taskIdsByName.set(nameKey, ids);
      }
    }

    const byId = new Map<string, ProcTaskTreeNodeView>();
    const roots: ProcTaskTreeNodeView[] = [];
    for (const row of rows) {
      const derivedIds = row.materialId
        ? taskIdsByMaterial.get(`${row.productId}:${row.materialId}`) ?? []
        : row.parentId
          ? taskIdsByName.get(`${row.productId}:${row.name}`) ?? []
          : [];
      // 显式归属的任务排在推导结果前面
      const ownTaskIds = [...(taskIdsByNode.get(row.id) ?? []), ...derivedIds];
      byId.set(row.id, {
        id: row.id,
        productId: row.productId,
        parentId: row.parentId,
        name: row.name,
        code: row.code,
        spec: row.spec,
        materialId: row.materialId,
        taskCount: ownTaskIds.length,
        taskIds: [...ownTaskIds],
        children: [],
      });
    }
    for (const row of rows) {
      const node = byId.get(row.id)!;
      if (row.parentId && byId.has(row.parentId)) byId.get(row.parentId)!.children.push(node);
      else roots.push(node);
    }

    const aggregateTasks = (node: ProcTaskTreeNodeView): Set<string> => {
      const taskIds = new Set(node.taskIds);
      for (const child of node.children) {
        for (const taskId of aggregateTasks(child)) taskIds.add(taskId);
      }
      node.taskIds = [...taskIds];
      node.taskCount = taskIds.size;
      return taskIds;
    };
    roots.forEach(aggregateTasks);
    return { roots };
  }

  async createProcTaskTreeNode(dto: CreateProcTaskTreeNodeDto) {
    await this.ensureProcTaskTreeSeeded();
    const name = dto.name.trim();
    const parentId = dto.parentId?.trim() || null;
    let productId = normalizeProcProductId(dto.productId);
    if (!name) throw new BadRequestException('节点名称不能为空');

    return this.prisma.$transaction(async (tx) => {
      // 所有目录写入串行化，避免“先查重、后创建”并发插入重复节点或相同排序号。
      await tx.$executeRawUnsafe('LOCK TABLE "ProcTaskTreeNode" IN SHARE ROW EXCLUSIVE MODE');

      if (parentId) {
        const parent = await tx.procTaskTreeNode.findUnique({
          where: { id: parentId },
          select: { id: true, parentId: true, productId: true },
        });
        if (!parent) throw new NotFoundException('父节点不存在');
        if (parent.parentId) throw new BadRequestException('采购任务系统树只允许分类和名称两级');
        if (dto.productId && productId !== parent.productId) {
          throw new BadRequestException('子节点必须与所属分类处于同一产品系统');
        }
        productId = parent.productId;
      }

      const code = parentId ? dto.code?.trim() || null : null;
      const duplicate = await tx.procTaskTreeNode.findFirst({
        where: { productId, parentId, name, code },
        select: { id: true },
      });
      if (duplicate) throw new ConflictException('同一分类下已存在相同节点');

      const material = parentId
        ? await this.resolveProcTaskTreeMaterial(tx, dto.materialId, code, name)
        : null;
      const sortOrder = await tx.procTaskTreeNode.count({ where: { productId, parentId } });
      const created = await tx.procTaskTreeNode.create({
        data: {
          productId,
          parentId,
          name,
          code,
          spec: parentId ? dto.spec?.trim() || null : null,
          materialId: material?.id ?? null,
          sortOrder,
        },
        select: { id: true },
      });
      return this.findProcTaskTreeNodeView(created.id, tx);
    });
  }

  async updateProcTaskTreeNode(id: string, dto: UpdateProcTaskTreeNodeDto) {
    await this.ensureProcTaskTreeSeeded();
    return this.prisma.$transaction(async (tx) => {
      await this.lockProcTaskTreeForProtectedWrite(tx);
      const current = await this.findProcTaskTreeNodeView(id, tx);
      if (current.taskCount > 0) {
        throw new ConflictException(`节点下已有 ${current.taskCount} 个采购任务，不能修改`);
      }

      const name = dto.name === undefined ? current.name : dto.name.trim();
      if (!name) throw new BadRequestException('节点名称不能为空');
      const isRoot = current.parentId === null;
      const code = isRoot ? null : dto.code === undefined ? current.code : dto.code.trim() || null;
      const spec = isRoot ? null : dto.spec === undefined ? current.spec : dto.spec.trim() || null;

      const duplicate = await tx.procTaskTreeNode.findFirst({
        where: { productId: current.productId, parentId: current.parentId, name, code, NOT: { id } },
        select: { id: true },
      });
      if (duplicate) throw new ConflictException('同一分类下已存在相同节点');

      let materialId = current.materialId;
      if (!isRoot && (dto.materialId !== undefined || dto.code !== undefined)) {
        const material = await this.resolveProcTaskTreeMaterial(tx, dto.materialId, code, name);
        materialId = material?.id ?? null;
      }
      await tx.procTaskTreeNode.update({
        where: { id },
        data: { name, code, spec, materialId },
      });
      return this.findProcTaskTreeNodeView(id, tx);
    });
  }

  async deleteProcTaskTreeNode(id: string) {
    await this.ensureProcTaskTreeSeeded();
    return this.prisma.$transaction(async (tx) => {
      await this.lockProcTaskTreeForProtectedWrite(tx);
      const current = await this.findProcTaskTreeNodeView(id, tx);
      if (current.taskCount > 0) {
        throw new ConflictException(`节点下已有 ${current.taskCount} 个采购任务，不能删除`);
      }
      if (!current.parentId && (await tx.procBomNode.findFirst({ where: { productRootId: id }, select: { id: true } })
        || await tx.procBomRevision.findFirst({ where: { productRootId: id }, select: { id: true } }))) {
        throw new ConflictException('该产品已作为 BOM 设备或发布版本的归属，不能删除；请保留历史身份');
      }
      await tx.procTaskTreeNode.delete({ where: { id } });
      return { deleted: 1 };
    });
  }

  private async lockProcTaskTreeForProtectedWrite(tx: Prisma.TransactionClient) {
    // 目录写互斥；任务表 SHARE 锁会等待已开始的任务写入完成，并阻止检查后的新写入。
    await tx.$executeRawUnsafe('LOCK TABLE "ProcTaskTreeNode" IN SHARE ROW EXCLUSIVE MODE');
    await tx.$executeRawUnsafe('LOCK TABLE "ProcTask" IN SHARE MODE');
  }

  private async findProcTaskTreeNodeView(
    id: string,
    client: ProcTaskTreeDbClient = this.prisma,
  ): Promise<ProcTaskTreeNodeView> {
    const { roots } = await this.getProcTaskTreeWithClient(client);
    const visit = (nodes: ProcTaskTreeNodeView[]): ProcTaskTreeNodeView | null => {
      for (const node of nodes) {
        if (node.id === id) return node;
        const child = visit(node.children);
        if (child) return child;
      }
      return null;
    };
    const node = visit(roots);
    if (!node) throw new NotFoundException('采购任务系统树节点不存在');
    return node;
  }

  private async resolveProcTaskTreeMaterial(
    client: ProcTaskTreeDbClient,
    materialId: string | undefined,
    code: string | null,
    name: string,
  ) {
    const explicitId = materialId?.trim();
    if (explicitId) {
      const material = await client.procMaterial.findUnique({
        where: { id: explicitId },
        select: { id: true },
      });
      if (!material) throw new NotFoundException('关联物料不存在');
      return material;
    }
    if (code) {
      const tpMaterial = await client.procMaterial.findUnique({
        where: { tpInventoryCode: code },
        select: { id: true },
      });
      if (tpMaterial) return tpMaterial;
      const erpMatches = await client.procMaterial.findMany({
        where: { erpCode: code },
        select: { id: true },
        take: 2,
      });
      if (erpMatches.length === 1) return erpMatches[0];
      if (erpMatches.length > 1) return null;
    }
    const matches = await client.procMaterial.findMany({
      where: { name },
      select: { id: true },
      take: 2,
    });
    return matches.length === 1 ? matches[0] : null;
  }

  // ── BOM ─────────────────────────────────────────────────────────────────────

  /**
   * BOM 导入：树形建 ProcBomNode（机型/部件/组件 → 原料叶子），
   * 叶子 code 按 T+ 存货编码匹配物料并回填物料的产品线与 BOM 归属：
   * 出现在单一机型 → 该机型；跨机型共用 → 「通用」。
   */
  async importBom(dto: ImportBomDto) {
    return this.mutateInventoryBomLine(async (tx) => {
    // 校验在替换前完成，失败时保留原 BOM；所有写入同一事务提交。
    const validateNode = async (node: BomNodeInputDto): Promise<void> => {
      if (!node.children?.length && (node.code || node.qtyPer !== undefined)) {
        const material = node.code?.trim() ? await tx.procMaterial.findUnique({ where: { tpInventoryCode: node.code.trim() }, select: { id: true } }) : null;
        if (!material) throw new BadRequestException(`物料库中不存在「${node.name}」的编码，请先建立物料档案`);
        if (!Number.isFinite(node.qtyPer) || node.qtyPer! <= 0 || node.qtyPer! > 9999999999.9999 || new Prisma.Decimal(node.qtyPer!).decimalPlaces() > 4) {
          throw new BadRequestException(`「${node.name}」的单机用量必须大于 0，最多保留 4 位小数`);
        }
      }
      for (const child of node.children ?? []) await validateNode(child);
    };
    for (const root of dto.roots) await validateNode(root);
    if (dto.replace) {
      if (await tx.procBomRevision.findFirst({ select: { id: true } })) throw new ConflictException('存在已发布设备，不能全量替换；请编辑工作稿并发布新版本');
      await tx.procBomNode.deleteMany({});
    }
    // 物料编码 → { productLines, systems }（systems=所属组件/部件名，供物料详情展示）
    const usage = new Map<string, { lines: Set<string>; systems: Set<string> }>();
    let nodeCount = 0;

    const createNode = async (
      node: BomNodeInputDto,
      parentId: string | null,
      level: number,
      productLine: string,
      chain: string[],
      sortOrder: number,
    ): Promise<void> => {
      const line = node.productLine?.trim() || productLine;
      const code = node.code?.trim() || null;
      const material = code
        ? await tx.procMaterial.findUnique({ where: { tpInventoryCode: code }, select: { id: true } })
        : null;
      const row = await tx.procBomNode.create({
        data: {
          parentId,
          name: node.name,
          code,
          level,
          productLine: line,
          materialId: material?.id ?? null,
          qtyPer: node.qtyPer === undefined ? null : new Prisma.Decimal(node.qtyPer),
          sortOrder,
        },
        select: { id: true },
      });
      nodeCount += 1;
      if (code && material) {
        const u = usage.get(code) ?? { lines: new Set<string>(), systems: new Set<string>() };
        if (line) u.lines.add(line);
        if (chain.length > 0) u.systems.add(chain[chain.length - 1]);
        usage.set(code, u);
      }
      for (const [index, child] of (node.children ?? []).entries()) {
        await createNode(child, row.id, level + 1, line, [...chain, node.name], index);
      }
    };

    for (const [index, root] of dto.roots.entries()) {
      await createNode(root, null, 0, root.productLine?.trim() ?? '', [], index);
    }

    // 回填物料产品线与 BOM 归属
    let touchedMaterials = 0;
    for (const [code, u] of usage) {
      const material = await tx.procMaterial.findUnique({
        where: { tpInventoryCode: code },
        select: { id: true, metadata: true },
      });
      if (!material) continue;
      const lines = [...u.lines].filter(Boolean);
      const productLine = lines.length === 1 ? lines[0] : lines.length > 1 ? '通用' : '';
      const meta = (material.metadata ?? {}) as Record<string, unknown>;
      await tx.procMaterial.update({
        where: { id: material.id },
        data: {
          ...(productLine ? { productLine } : {}),
          metadata: { ...meta, bom: { systems: [...u.systems], lines } } as Prisma.InputJsonObject,
        },
      });
      touchedMaterials += 1;
    }
    return { nodes: nodeCount, matchedMaterials: usage.size, touchedMaterials };
    });
  }

  /** BOM 树查询：全量返回（数据量为部件×原料级，数百节点）。 */
  async getBomTree() {
    const rows = await this.prisma.procBomNode.findMany({
      orderBy: [{ level: 'asc' }, { sortOrder: 'asc' }],
    });
    // 与齐套中心使用相同的当前编码匹配，旧导入的空关联或过时关联不冒充最新主档。
    const codes = [...new Set(rows.map((row) => row.code?.trim()).filter((code): code is string => Boolean(code)))];
    const materials = codes.length ? await this.prisma.procMaterial.findMany({
      where: { tpInventoryCode: { in: codes } }, select: { id: true, tpInventoryCode: true, name: true, spec: true, unit: true },
    }) : [];
    const materialByCode = new Map(materials.map((material) => [material.tpInventoryCode, material]));
    const byId = new Map<string, BomTreeNode>();
    const roots: BomTreeNode[] = [];
    for (const r of rows) {
      byId.set(r.id, {
        id: r.id,
        parentId: r.parentId,
        updatedAt: r.updatedAt.toISOString(),
        sortOrder: r.sortOrder,
        name: r.name,
        code: r.code,
        level: r.level,
        productLine: r.productLine,
        qtyPer: numOrNull(r.qtyPer),
        remark: r.remark,
        material: materialByCode.get(r.code?.trim() || '') ?? null,
        children: [],
      });
    }
    for (const r of rows) {
      const node = byId.get(r.id)!;
      if (r.parentId && byId.has(r.parentId)) byId.get(r.parentId)!.children.push(node);
      else roots.push(node);
    }
    return { roots };
  }

  async confirmStockPlanBomBasis(id: string, input: { revisionId: string; expectedUpdatedAt: string; requestId: string; reason: string }, actor: ProcActor) {
    if (!actor.id || (!actor.permissions.includes('*') && !['page:proc-cockpit', 'proc-task:create', 'bom:publish'].every(p => actor.permissions.includes(p)))) throw new ForbiddenException('需要备货页面、备货办理及 BOM 发布权限');
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(input.requestId) || !input.reason?.trim() || input.reason.length > 2000) throw new BadRequestException('请填写有效提交标识和核对依据');
    const signature = bomHash([actor.id, id, input]), key = `procurement:bom-revisions:v1:request:${input.requestId}`;
    try {
      return await this.prisma.$transaction(async tx => {
        await this.lockStockPlan(tx, id);
        const previous = await tx.runtimeState.findUnique({ where: { key } });
        if (previous) { const saved = JSON.parse(previous.value); if (saved.signature !== signature) throw new ConflictException('提交标识已用于其他内容'); return saved.result; }
        const plan = await this.requireStockPlan(id, tx);
        if (plan.updatedAt.toISOString() !== input.expectedUpdatedAt) throw new ConflictException('备货计划已更新，请保留填写内容并刷新');
        if (plan.planType !== 'machine' || plan.bomRevisionId) throw new BadRequestException('仅未确认 BOM 依据的历史整机计划可办理；已确认版本不能替换');
        const revision = await tx.procBomRevision.findUnique({ where: { id: input.revisionId } });
        if (!revision) throw new BadRequestException('请选择有效发布版本');
        const root = await tx.procTaskTreeNode.findUnique({ where: { id: revision.productRootId } });
        if (!root || root.parentId || root.productId !== plan.productId) throw new BadRequestException('BOM 不属于本计划产品');
        const selected = await this.bomRevisions.requireRevision(tx, { productRootId: root.id, deviceId: revision.deviceId, revisionId: revision.id });
        if (selected.productLine !== plan.productLine) throw new BadRequestException('发布版本型号与原计划不一致，请先核对原计划');
        const basis = { origin: 'confirmed-current', revisionId: selected.id, fingerprint: selected.fingerprint, actorId: actor.id, actorName: actor.name, at: new Date().toISOString(), reason: input.reason.trim() };
        await tx.procStockPlan.update({ where: { id }, data: { bomRevisionId: selected.id, bomBasis: basis } });
        const result = { id, bomRevisionId: selected.id };
        await tx.runtimeState.create({ data: { key, value: JSON.stringify({ signature, result }) } });
        await tx.auditLog.create({ data: { module: 'procurement', source: 'web', action: 'stock-plan.confirm-bom-basis', resource: 'stock-plan', resourceId: id, userId: actor.id, actorName: actor.name, summary: basis.reason, meta: basis } });
        return result;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) { if (['P2002', 'P2034'].includes((error as { code?: string }).code ?? '')) throw new ConflictException('备货依据正在更新，请刷新后重试'); throw error; }
  }

  async saveBomNode(dto: SaveBomNodeDto, id?: string) {
    return this.mutateInventoryBomLine(async (tx) => {
      const current = id ? await tx.procBomNode.findUnique({ where: { id }, include: { _count: { select: { children: true } } } }) : null;
      if (id && !current) throw new NotFoundException('该 BOM 节点已不存在，请刷新');
      if (current && (!dto.baseUpdatedAt || new Date(dto.baseUpdatedAt).getTime() !== current.updatedAt.getTime())) {
        throw new ConflictException('BOM 已被其他操作更新，请刷新后重试');
      }
      const productLine = dto.productLine.trim();
      if (!productLine) throw new BadRequestException('请填写设备型号');
      if (current && current.productLine !== productLine) throw new BadRequestException('不能将 BOM 节点转移到其他设备');
      const parentId = dto.parentId?.trim() || null;
      if (current && !current.parentId && parentId && await tx.procBomRevision.findFirst({ where: { deviceId: id }, select: { id: true } })) {
        throw new ConflictException('已发布设备根身份不能改为子节点，请保留历史并另建设备');
      }
      const parent = parentId ? await tx.procBomNode.findUnique({ where: { id: parentId } }) : null;
      if (parentId && (!parent || parent.productLine !== productLine || isInventoryBomMaterial(parent))) {
        throw new BadRequestException('请选择当前设备下的组件分类');
      }
      if (id && parentId === id) throw new BadRequestException('节点不能归入自身');
      if (current && current._count.children > 0 && parentId !== current.parentId) {
        throw new BadRequestException('包含子项的分类不能移动，请先移动其物料');
      }
      if (current && isInventoryBomMaterial(current) !== (dto.kind === 'material')) {
        throw new BadRequestException('物料与结构分类不能相互转换');
      }
      if (dto.kind === 'device') {
        if (parentId || current?.parentId) throw new BadRequestException('设备必须是 BOM 根节点');
        if (!current && await tx.procBomNode.findFirst({ where: { productLine: { equals: productLine, mode: 'insensitive' } } })) {
          throw new ConflictException('设备型号已存在，请在对应 BOM 中添加物料');
        }
      } else if (!await tx.procBomNode.findFirst({ where: { productLine } })) {
        throw new BadRequestException('请先创建设备');
      }
      let name = dto.name?.trim() || '';
      let code: string | null = null;
      let materialId: string | null = null;
      let qtyPer: Prisma.Decimal | null = null;
      if (dto.kind === 'material') {
        const material = dto.materialId ? await tx.procMaterial.findUnique({ where: { id: dto.materialId } }) : null;
        if (!material) throw new BadRequestException('请选择物料库中已有的物料');
        if (!material.tpInventoryCode?.trim()) throw new BadRequestException('该物料缺少库存编码，请先在物料库完善后再加入 BOM');
        if (!Number.isFinite(dto.qtyPer) || dto.qtyPer! <= 0 || dto.qtyPer! > 9999999999.9999 || new Prisma.Decimal(dto.qtyPer!).decimalPlaces() > 4) {
          throw new BadRequestException('单机用量必须大于 0，最多保留 4 位小数');
        }
        name = material.name;
        code = material.tpInventoryCode;
        materialId = material.id;
        qtyPer = new Prisma.Decimal(dto.qtyPer!);
      } else if (!name) throw new BadRequestException('请填写设备或分类名称');
      const data = { name, code, materialId, qtyPer, productLine, parentId, level: parent ? parent.level + 1 : 0,
        remark: dto.remark?.trim() || null, sortOrder: dto.sortOrder ?? current?.sortOrder ?? 0 };
      if (current) {
        const result = await tx.procBomNode.updateMany({ where: { id, updatedAt: current.updatedAt }, data });
        if (result.count !== 1) throw new ConflictException('BOM 已被其他操作更新，请刷新后重试');
        return tx.procBomNode.findUniqueOrThrow({ where: { id } });
      }
      return tx.procBomNode.create({ data });
    });
  }

  async deleteBomNode(id: string, baseUpdatedAt: string) {
    return this.mutateInventoryBomLine(async (tx) => {
      const row = await tx.procBomNode.findUnique({ where: { id }, include: { _count: { select: { children: true } } } });
      if (!row) throw new NotFoundException('该 BOM 节点已不存在，请刷新');
      if (new Date(baseUpdatedAt).getTime() !== row.updatedAt.getTime()) throw new ConflictException('BOM 已被其他操作更新，请刷新后重试');
      if (row._count.children) throw new BadRequestException('请先移除分类或设备下的所有子项');
      if (!row.parentId && await tx.procBomRevision.findFirst({ where: { deviceId: id }, select: { id: true } })) throw new ConflictException('设备已有发布版本，不能删除；请停用版本并保留历史');
      const result = await tx.procBomNode.deleteMany({ where: { id, updatedAt: row.updatedAt, children: { none: {} } } });
      if (result.count !== 1) throw new ConflictException('BOM 已变更，请刷新后重试');
      return { id, deleted: true };
    });
  }

  private async mutateInventoryBomLine<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('procurement-common-bom-lines'))::text`;
        return work(tx);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2034') {
        throw new ConflictException('BOM 物料已被其他操作更新，请刷新后重试');
      }
      if ((error as { code?: string }).code === 'P2003') {
        throw new ConflictException('所属分类已变更，请刷新后重试');
      }
      throw error;
    }
  }

  private async requireInventoryBomLine(tx: Prisma.TransactionClient, id: string, baseUpdatedAt: string, allowQ5Update = false) {
    const row = await tx.procBomNode.findUnique({ where: { id }, include: { _count: { select: { children: true } } } });
    if (!row) throw new NotFoundException('该 BOM 物料已不存在，请刷新列表');
    if (row.productLine.trim() !== '通用' && !(allowQ5Update && row.productLine.trim() === 'Q5')) {
      throw new ForbiddenException(allowQ5Update ? '仅支持修改通用或 Q5 装配物料' : '仅支持维护通用物料');
    }
    if (row._count.children > 0 || !isInventoryBomMaterial(row)) {
      throw new BadRequestException('该节点是结构分类，不能作为物料修改或删除');
    }
    const version = new Date(baseUpdatedAt);
    if (!baseUpdatedAt || Number.isNaN(version.getTime()) || version.getTime() !== row.updatedAt.getTime()) {
      throw new ConflictException('BOM 物料已被其他操作更新，请刷新后重试');
    }
    return row;
  }

  private async inventoryBomLineData(
    tx: Prisma.TransactionClient,
    dto: CreateInventoryBomLineDto,
    current?: { id: string; productLine: string; parentId: string | null; level: number },
  ) {
    const name = dto.name?.trim();
    const code = dto.code?.trim();
    const qtyPer = dto.qtyPer;
    if (!name || name.length > 200) throw new BadRequestException('请填写物料名称（最多 200 字）');
    if (!code || code.length > 100) throw new BadRequestException('请填写物料编码（最多 100 字）');
    if (!Number.isFinite(qtyPer) || qtyPer <= 0 || qtyPer > 9999999999.9999
      || new Prisma.Decimal(qtyPer).decimalPlaces() > 4) {
      throw new BadRequestException('单机用量必须大于 0，最多保留 4 位小数');
    }
    const isQ5Update = current?.productLine.trim() === 'Q5';
    let parentId = dto.parentId?.trim() || null;
    let level = 0;
    if (isQ5Update) {
      if (dto.parentId !== undefined && parentId !== current.parentId) {
        throw new BadRequestException('Q5 装配物料只能原位修改，不能更改所属位置');
      }
      parentId = current.parentId;
      level = current.level;
    } else if (parentId) {
      if (parentId === current?.id) throw new BadRequestException('物料不能归入自身');
      const parent = await tx.procBomNode.findUnique({ where: { id: parentId }, include: { _count: { select: { children: true } } } });
      if (!parent || parent.productLine.trim() !== '通用') throw new BadRequestException('请选择通用物料的所属分类');
      if (isInventoryBomMaterial(parent) && parent._count.children === 0) {
        throw new BadRequestException('不能将物料归入另一条物料，请选择结构分类');
      }
      level = parent.level + 1;
    }
    const material = await tx.procMaterial.findUnique({ where: { tpInventoryCode: code }, select: { id: true } });
    if (!material) throw new BadRequestException('物料库中不存在该编码，请先建立物料档案');
    const remark = dto.remark?.trim() || null;
    if (remark && remark.length > 1000) throw new BadRequestException('规格备注最多 1000 字');
    return { name, code, qtyPer: new Prisma.Decimal(qtyPer), parentId, level, productLine: isQ5Update ? current.productLine : '通用', materialId: material?.id ?? null, remark };
  }

  async createInventoryBomLine(dto: CreateInventoryBomLineDto) {
    return this.mutateInventoryBomLine(async (tx) => {
      const data = await this.inventoryBomLineData(tx, dto);
      const row = await tx.procBomNode.create({ data, select: { id: true, updatedAt: true } });
      return { id: row.id, updatedAt: row.updatedAt.toISOString() };
    });
  }

  async updateInventoryBomLine(id: string, dto: UpdateInventoryBomLineDto) {
    return this.mutateInventoryBomLine(async (tx) => {
      const current = await this.requireInventoryBomLine(tx, id, dto.baseUpdatedAt, true);
      const data = await this.inventoryBomLineData(tx, dto, current);
      const updated = await tx.procBomNode.updateMany({ where: { id, updatedAt: current.updatedAt }, data });
      if (updated.count !== 1) throw new ConflictException('BOM 物料已被其他操作更新，请刷新后重试');
      const row = await tx.procBomNode.findUniqueOrThrow({ where: { id }, select: { id: true, updatedAt: true } });
      return { id: row.id, updatedAt: row.updatedAt.toISOString() };
    });
  }

  async deleteInventoryBomLine(id: string, dto: InventoryBomLineVersionDto) {
    return this.mutateInventoryBomLine(async (tx) => {
      const current = await this.requireInventoryBomLine(tx, id, dto.baseUpdatedAt);
      const deleted = await tx.procBomNode.deleteMany({ where: { id, updatedAt: current.updatedAt, children: { none: {} } } });
      if (deleted.count !== 1) throw new ConflictException('通用物料已被其他操作更新，请刷新后重试');
      return { id, deleted: true };
    });
  }

  /** 按库存编码读取物料库分类，供齐套维护表单即时展示；不回写 BOM 或主数据。 */
  async getInventoryReadinessMaterial(value: unknown) {
    const code = typeof value === 'string' ? value.trim() : '';
    if (code.length > 100) throw new BadRequestException('物料编码最多 100 字');
    const material = code ? await this.prisma.procMaterial.findUnique({
      where: { tpInventoryCode: code },
      select: { category: true, unit: true },
    }) : null;
    return { matched: Boolean(material), category: material?.category?.trim() || '未分类', unit: material?.unit?.trim() || '件' };
  }

  /**
   * 库存齐套中心：用 BOM 单机用量连接畅捷通库存镜像。
   * 按编码读取全仓镜像用于解释未匹配原因，数量仍精确限定「量产仓 / 量产仓库」，
   * 避免把「研发量产仓」、样品仓或售后备件仓计入可齐套量。
   */
  async getInventoryReadiness(query: Record<string, unknown>, db?: Prisma.TransactionClient) {
    if (!db) return this.prisma.$transaction(tx => this.getInventoryReadiness(query, tx), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    const targetSets = Math.min(1_000_000, Math.max(0, Math.floor(Number(query.targetSets) || 0)));
    let requestedProductLine = typeof query.productLine === 'string' ? query.productLine.trim() : '';
    const revision = typeof query.revisionId === 'string' && query.revisionId ? await db.procBomRevision.findUnique({ where: { id: query.revisionId }, include: { device: true } }) : null;
    if (query.revisionId && !revision) throw new NotFoundException('BOM 发布版本不存在');
    const frozen = revision ? buildBomSnapshot(revision.snapshot as unknown as Parameters<typeof buildBomSnapshot>[0]) : null;
    if (revision && frozen) {
      if (revision.fingerprint !== frozen.fingerprint) throw new ConflictException('BOM 快照校验失败');
      if (requestedProductLine && requestedProductLine !== revision.device.productLine) throw new BadRequestException('所选版本不属于当前型号');
      requestedProductLine = revision.device.productLine;
    }
    const warehouseKeyword = '量产';
    let bomRows = await db.procBomNode.findMany({
      orderBy: [{ level: 'asc' }, { sortOrder: 'asc' }],
      select: {
        id: true,
        parentId: true,
        name: true,
        code: true,
        level: true,
        productLine: true,
        qtyPer: true,
        remark: true,
        updatedAt: true,
        material: { select: { name: true, spec: true, unit: true } },
      },
    });
    if (frozen && revision) {
      bomRows = frozen.structure.map(node => {
        const leaf = frozen.leaves.find(row => row.nodeId === node.id);
        return { id: node.id, parentId: node.parentId, name: leaf?.name ?? node.name, code: leaf?.code ?? null, level: 0,
          productLine: revision.device.productLine, qtyPer: leaf ? new Prisma.Decimal(leaf.qtyPer) : null, remark: null, updatedAt: revision.publishedAt,
          material: leaf ? { name: leaf.name, spec: '', unit: leaf.unit } : null };
      });
    }
    const byId = new Map(bomRows.map((row) => [row.id, row]));
    const parentIds = new Set(bomRows.map((row) => row.parentId).filter((id): id is string => Boolean(id)));
    const modelMap = new Map<string, { id: string; label: string; bomLines: number }>();
    for (const row of bomRows) {
      const line = row.productLine.trim();
      if (!line) continue;
      const current = modelMap.get(line) ?? { id: line, label: line, bomLines: 0 };
      if (!parentIds.has(row.id) && isInventoryBomMaterial(row)) current.bomLines += 1;
      modelMap.set(line, current);
    }
    for (const [line, model] of modelMap) {
      const roots = bomRows.filter((row) => row.productLine.trim() === line && row.parentId === null);
      // 多个根通常是并列子系统，不能让最后一个子系统名覆盖产品型号。
      const rootName = roots.length === 1 ? roots[0].name.trim() : '';
      model.label = rootName && rootName !== line ? `${line} · ${rootName}` : line;
    }
    const models = [...modelMap.values()].sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
    // 整机齐套默认使用 Q5 清单；缺少所选型号时保留空态，不能拿其他 BOM 代算。
    const productLine = requestedProductLine || 'Q5';
    const materialRows = bomRows.filter((row) => row.productLine === productLine && !parentIds.has(row.id) && isInventoryBomMaterial(row));
    const codes = [...new Set([
      ...materialRows.map((row) => row.code?.trim()).filter((code): code is string => Boolean(code)),
      ...(productLine === 'Q5' ? Q5_PACKAGING_REFERENCE_SOURCE.items.map((row) => row.code) : []),
    ])];
    // 以当前编码匹配物料库，不能依赖导入时可能缺失或已过时的 materialId。
    const materials = codes.length > 0 ? await db.procMaterial.findMany({
      where: { tpInventoryCode: { in: codes } },
      select: { tpInventoryCode: true, category: true, unit: true },
    }) : [];
    const materialByCode = new Map(materials.map((material) => [material.tpInventoryCode, material]));
    const leaves: InventoryReadinessBomLeaf[] = materialRows.map((row) => {
      const material = materialByCode.get(row.code?.trim() || '');
      const parentName = row.parentId ? byId.get(row.parentId)?.name : undefined;
      const category = productLine === 'Q5' ? parentName?.trim() || '未分类' : material?.category?.trim() || '未分类';
      const bomPosition = parentName ?? '未指定位置';
      const unit = frozen ? row.material?.unit ?? '' : material?.unit?.trim() || '';
      return {
        id: row.id,
        category,
        bomPosition,
        code: row.code?.trim() || null,
        // Q5 装配清单定义名称与规格，ERP 仅按当前编码提供库存及单位。
        name: productLine === '通用' || productLine === 'Q5' ? row.name : row.material?.name || row.name,
        spec: productLine === 'Q5' ? row.remark || '' : productLine === '通用' ? row.remark || row.material?.spec || '' : row.material?.spec || row.remark || '',
        unit,
        qtyPer: numOrNull(row.qtyPer),
        ...(productLine === '通用' || productLine === 'Q5' ? {
          sourceLines: [{
            id: row.id,
            name: row.name,
            code: row.code?.trim() || null,
            qtyPer: numOrNull(row.qtyPer),
            remark: row.remark,
            parentId: row.parentId,
            category,
            bomPosition,
            updatedAt: row.updatedAt.toISOString(),
            unit,
          }],
        } : {}),
      };
    });
    const inventoryCandidates = codes.length > 0
      ? await db.procInventoryBalance.findMany({
          where: {
            tpInventoryCode: { in: codes },
          },
          select: {
            tpInventoryCode: true,
            warehouse: true,
            unit: true,
            stockQty: true,
            availableQty: true,
            inTransitQty: true,
            syncedAt: true,
            material: { select: { safeStock: true } },
          },
          orderBy: [{ tpInventoryCode: 'asc' }, { warehouse: 'asc' }],
        })
      : [];
    const inventoryRows = inventoryCandidates.filter((row) => isProductionWarehouse(row.warehouse));
    const snapshot = await this.inventoryStock.read({ codes, scope: { kind: 'production' } }, db);
    const balanceMap = new Map<string, InventoryReadinessBalance>();
    for (const row of inventoryRows) {
      const current = balanceMap.get(row.tpInventoryCode) ?? {
        code: row.tpInventoryCode,
        stock: 0,
        available: 0,
        inTransit: 0,
        safeStock: 0,
        syncedAt: null,
      };
      current.stock += num(row.stockQty);
      const base = stockForCode(snapshot, row.tpInventoryCode, leaves.find(leaf => leaf.code === row.tpInventoryCode)?.unit);
      current.available = base.available;
      current.issues = base.issues;
      current.inTransit += num(row.inTransitQty);
      current.safeStock = Math.max(current.safeStock, num(row.material?.safeStock));
      const syncedAt = row.syncedAt?.toISOString() ?? null;
      if (syncedAt && (!current.syncedAt || syncedAt > current.syncedAt)) current.syncedAt = syncedAt;
      balanceMap.set(row.tpInventoryCode, current);
    }
    const calculation = calculateInventoryReadiness(leaves, [...balanceMap.values()], targetSets);
    const inventoryDiagnostics = buildInventoryMatchDiagnostics(codes, materials, inventoryCandidates);
    const items = calculation.items.map((item) => {
      const inventoryDiagnostic = item.code ? inventoryDiagnostics.get(item.code) : undefined;
      return inventoryDiagnostic ? { ...item, inventoryDiagnostic } : item;
    });
    const packaging = productLine === 'Q5' ? buildQ5PackagingReference(leaves, balanceMap, materials, inventoryDiagnostics) : undefined;
    const warehouseNames = [...new Set(inventoryRows.map((row) => row.warehouse || '未指定仓库'))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    const syncedAt = [...balanceMap.values()]
      .map((balance) => balance.syncedAt)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null;

    return {
      source: 'tplus',
      readOnly: true,
      stockScope: snapshot.scope, stockReadAt: snapshot.readAt, stockRows: snapshot.rows,
      bomBasis: revision ? { kind: 'published' as const, revisionId: revision.id, version: revision.version, retiredAt: revision.retiredAt } : { kind: 'draft' as const },
      productLine,
      models,
      bomPositions: productLine === '通用'
        ? bomRows.filter((row) => row.productLine === '通用' && (parentIds.has(row.id) || !isInventoryBomMaterial(row)))
          .map((row) => ({ id: row.id, name: row.name }))
        : [],
      warehouse: {
        keyword: warehouseKeyword,
        label: '量产仓库',
        matchedNames: warehouseNames,
      },
      syncedAt,
      ...calculation,
      items,
      ...(packaging ? { packaging } : {}),
    };
  }

  /** 分类重命名/合并：目标名已存在即合并。分类没有独立表，直接改物料上的冗余字段。 */
  async renameCategory(dto: RenameCategoryDto) {
    const from = dto.from.trim();
    const to = dto.to.trim();
    if (!from || !to) throw new BadRequestException('分类名不能为空');
    if (from === to) throw new BadRequestException('新旧分类名相同');
    const result = await this.prisma.procMaterial.updateMany({
      where: { category: from },
      data: { category: to },
    });
    if (result.count === 0) throw new NotFoundException(`分类「${from}」下没有物料`);
    return { updated: result.count };
  }

  /**
   * 采购负责人候选按稳定部门编码 PURCHASING 和角色权限共同限定：
   * eligible 仅返回采购部门内、能打开采购个人工作台的在职账号；department 用于人员统计，
   * 会保留采购部门内缺权限账号并显式标记，避免“任务分到了人但本人打不开”。
   */
  async listBuyerCandidates(scope: 'eligible' | 'all' | 'department' = 'eligible') {
    const [users, roster, purchasingDepartmentName] = await Promise.all([
      this.prisma.user.findMany({
        where: scope === 'all' ? {} : { status: 'ACTIVE' },
        select: { id: true, name: true, department: true, status: true, role: { select: { permissions: true } } },
        orderBy: { name: 'asc' },
      }),
      this.readBuyerRoster(),
      this.getPurchasingDepartmentName(),
    ]);
    const rosterSet = new Set(roster);
    const isProc = (department: string | null) => department?.trim() === purchasingDepartmentName;
    const canReceiveTasks = (user: (typeof users)[number]) => {
      const permissions = Array.isArray(user.role?.permissions)
        ? (user.role.permissions as unknown[]).filter((item): item is string => typeof item === 'string')
        : [];
      return permissions.includes('*') || permissions.includes('page:proc-my-workspace');
    };
    return users
      .filter((user) =>
        scope === 'all'
        || (isProc(user.department) && (scope === 'department' || canReceiveTasks(user))),
      )
      .sort(
        (a, b) =>
          Number(canReceiveTasks(b)) - Number(canReceiveTasks(a)) ||
          Number(rosterSet.has(b.id)) - Number(rosterSet.has(a.id)) ||
          Number(isProc(b.department)) - Number(isProc(a.department)),
      )
      .map((u) => ({
        id: u.id,
        name: u.name,
        department: u.department ?? undefined,
        disabled: u.status !== undefined && u.status !== 'ACTIVE',
        inRoster: rosterSet.has(u.id) || isProc(u.department),
        canReceiveTasks: canReceiveTasks(u),
      }));
  }

  /** 服务端最终确认负责人，不能依赖前端下拉框或姓名文本。空姓名表示取消指派。 */
  private async resolveAssignableBuyer(userId?: string, buyerName?: string) {
    const name = buyerName?.trim() || '';
    if (!name && !userId) return null;
    const candidates = await this.listBuyerCandidates('eligible');
    const byId = userId ? candidates.find((candidate) => candidate.id === userId) : undefined;
    const byName = !userId ? candidates.filter((candidate) => candidate.name.trim() === name) : [];
    const buyer = byId ?? (byName.length === 1 ? byName[0] : undefined);
    if (!buyer || (name && buyer.name.trim() !== name)) {
      throw new BadRequestException('采购负责人必须是采购部门内、在职且具备采购个人工作台权限的唯一账号');
    }
    return buyer;
  }

  /** 新任务默认分配给当前在制任务最少的采购成员。 */
  private async pickAutomaticBuyer(scope: 'eligible' | 'department' = 'eligible') {
    const candidates = await this.listBuyerCandidates(scope);
    if (candidates.length === 0) return null;
    const grouped = await this.prisma.procTask.groupBy({
      by: ['buyerUserId'],
      where: {
        buyerUserId: { in: candidates.map((candidate) => candidate.id) },
        status: { notIn: [...PROC_TERMINAL_STATUSES, 'pending_rd_review'] },
      },
      _count: { _all: true },
    });
    const load = new Map(grouped.map((row) => [row.buyerUserId, row._count._all]));
    return [...candidates].sort(
      (a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0) || a.name.localeCompare(b.name, 'zh-CN'),
    )[0];
  }

  // ── 采购成员名录（对齐研发人员名录模式；KV 存储免 migration）────────────────

  private static readonly BUYER_ROSTER_KEY = 'procurement:buyer-roster:v1';

  /** 名录条目：兼容早期纯 userId 字符串数组格式。 */
  private async readBuyerRosterEntries(): Promise<Array<{ userId: string; note?: string; excluded?: boolean }>> {
    const row = await this.prisma.runtimeState.findUnique({
      where: { key: ProcurementService.BUYER_ROSTER_KEY },
    });
    if (!row) return [];
    try {
      const parsed = JSON.parse(row.value) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((x): { userId: string; note?: string; excluded?: boolean } | null => {
          if (typeof x === 'string') return { userId: x };
          if (x && typeof x === 'object' && typeof (x as { userId?: unknown }).userId === 'string') {
            const note = (x as { note?: unknown }).note;
            return { userId: (x as { userId: string }).userId, note: typeof note === 'string' ? note : undefined, excluded: (x as { excluded?: unknown }).excluded === true };
          }
          return null;
        })
        .filter((x): x is { userId: string; note?: string; excluded?: boolean } => Boolean(x));
    } catch {
      return [];
    }
  }

  private async readBuyerRoster(): Promise<string[]> {
    return (await this.readBuyerRosterEntries()).filter(e => !e.excluded).map((e) => e.userId);
  }

  private async getPurchasingDepartmentName(): Promise<string> {
    const department = await this.prisma.department.findUnique({
      where: { code: 'PURCHASING' },
      select: { name: true },
    });
    return department?.name.trim() || '采购部';
  }

  private async writeBuyerRosterEntries(entries: Array<{ userId: string; note?: string; excluded?: boolean }>) {
    const seen = new Set<string>();
    const unique = entries.filter((e) => (seen.has(e.userId) ? false : (seen.add(e.userId), true)));
    await this.prisma.runtimeState.upsert({
      where: { key: ProcurementService.BUYER_ROSTER_KEY },
      create: { key: ProcurementService.BUYER_ROSTER_KEY, value: JSON.stringify(unique) },
      update: { value: JSON.stringify(unique) },
    });
  }

  /** 名录成员（实时回填姓名/部门；已禁用用户标记出来供清理）。 */
  async getBuyerRoster() {
    const [entries, purchasingDepartmentName] = await Promise.all([
      this.readBuyerRosterEntries(),
      this.getPurchasingDepartmentName(),
    ]);
    const procurementUsers = await this.prisma.user.findMany({
      where: {
        OR: [
          { status: 'ACTIVE', department: purchasingDepartmentName },
          { id: { in: entries.filter(entry => !entry.excluded).map(entry => entry.userId) } },
        ],
        id: { notIn: entries.filter(entry => entry.excluded).map(entry => entry.userId) },
      },
      select: { id: true, name: true, department: true, status: true, role: { select: { permissions: true } } },
      orderBy: { name: 'asc' },
    });
    const notes = new Map(entries.map((entry) => [entry.userId, entry.note]));
    return {
      members: procurementUsers.map((user) => {
        const permissions = Array.isArray(user.role?.permissions)
          ? (user.role.permissions as unknown[]).filter((item): item is string => typeof item === 'string')
          : [];
        return {
          id: user.id,
          name: user.name,
          department: user.department ?? undefined,
          note: notes.get(user.id),
          disabled: user.status !== 'ACTIVE',
          managedByDepartment: false,
          canReceiveTasks: permissions.includes('*') || permissions.includes('page:proc-my-workspace'),
        };
      }),
    };
  }

  async addBuyerRosterMember(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, status: true } });
    if (!user || user.status !== 'ACTIVE') {
      throw new NotFoundException('请选择用户管理中已启用的用户');
    }
    const entries = await this.readBuyerRosterEntries();
    const existing = entries.find(e => e.userId === userId);
    if (existing?.excluded) {
      existing.excluded = false;
      await this.writeBuyerRosterEntries(entries);
    } else if (!existing) {
      entries.push({ userId });
      await this.writeBuyerRosterEntries(entries);
    }
    return this.getBuyerRoster();
  }

  /** 更新成员岗位备注（如「电子料询价」「包材/耗材」），仅名录内成员。 */
  async updateBuyerRosterMember(userId: string, note: string) {
    const entries = await this.readBuyerRosterEntries();
    let entry = entries.find((e) => e.userId === userId);
    if (entry?.excluded) throw new NotFoundException('该用户不在采购成员名录中');
    if (!entry) {
      const [user, purchasingDepartmentName] = await Promise.all([
        this.prisma.user.findUnique({
          where: { id: userId },
          select: { department: true, status: true },
        }),
        this.getPurchasingDepartmentName(),
      ]);
      if (user?.status !== 'ACTIVE' || user.department?.trim() !== purchasingDepartmentName) {
        throw new NotFoundException('该用户不在采购成员名录中');
      }
      entry = { userId };
      entries.push(entry);
    }
    entry.note = note.trim().slice(0, 100) || undefined;
    await this.writeBuyerRosterEntries(entries);
    return this.getBuyerRoster();
  }

  async removeBuyerRosterMember(userId: string) {
    const entries = await this.readBuyerRosterEntries();
    // 保留排除标记，避免原部门默认成员在下次读取时被重新加入；不改用户或任务。
    const entry = entries.find(e => e.userId === userId);
    if (entry) entry.excluded = true;
    else entries.push({ userId, excluded: true });
    await this.writeBuyerRosterEntries(entries);
    return this.getBuyerRoster();
  }

  // ── 汇总 ────────────────────────────────────────────────────────────────────

  /** 驾驶舱顶部指标：各状态计数 + 逾期 + 缺料。 */
  async summary() {
    const grouped = await this.prisma.procTask.groupBy({
      by: ['status'],
      where: { status: { not: 'pending_rd_review' } },
      _count: { _all: true },
    });
    const byStatus: Record<string, number> = {};
    for (const g of grouped) byStatus[g.status] = g._count._all;

    const today = new Date(new Date().toISOString().slice(0, 10));
    const overdue = await this.prisma.procTask.count({
      where: {
        status: { notIn: [...PROC_TERMINAL_STATUSES, 'pending_rd_review'] },
        OR: [{ deadline: { lt: today } }, { deadline: null, needDate: { lt: today } }],
      },
    });

    const materials = await this.prisma.procMaterial.findMany({
      where: { safeStock: { gt: 0 } },
      select: { id: true, safeStock: true, balances: { select: { stockQty: true } } },
    });
    const shortage = materials.filter((m) => {
      const stock = m.balances.reduce((sum, b) => sum + num(b.stockQty), 0);
      return stock < num(m.safeStock);
    }).length;

    const pendingReview = await this.prisma.procMaterial.count({
      where: { reviewStatus: 'pending' },
    });

    return {
      byStatus,
      total: Object.values(byStatus).reduce((a, b) => a + b, 0),
      overdue,
      shortage,
      pendingReview,
    };
  }

  private async resolveRequesterDepartment(userId: string, fallback?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { department: true },
    });
    return user?.department?.trim() || fallback?.trim() || null;
  }

  private async getRequesterDepartmentMap(
    tasks: Array<{ requesterUserId: string | null }>,
  ): Promise<Map<string, string | null>> {
    const userIds = Array.from(
      new Set(tasks.map((task) => task.requesterUserId).filter(Boolean)),
    ) as string[];
    if (userIds.length === 0) return new Map();

    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, department: true },
    });
    return new Map(
      users.map((user) => [user.id, user.department?.trim() || null]),
    );
  }

  // ── 序列化 ───────────────────────────────────────────────────────────────────

  private serializeStockPlan(plan: ProcStockPlanView, unresolvedOrders = new Set<string>()) {
    const targetQty = num(plan.targetQty);
    const contextLocked = (plan.tasks?.length ?? 0) > 0 || (plan._count?.productionReports ?? 0) > 0 || (plan._count?.qualityRecords ?? 0) > 0;
    const batches = plan.batches.map((batch) => {
      const mirror = batch.purchaseOrderMirror;
      const orderVoided = Boolean(mirror && isVoidedOrderStatus(mirror.status, mirror.approvalStatus));
      const orderUnlinked = !mirror && Boolean(batch.purchaseOrderNo && unresolvedOrders.has(batch.purchaseOrderNo.trim()));
      const orderDataIssue = orderVoided || orderUnlinked;
      const orderIssueCode = orderVoided ? 'voided' : orderUnlinked ? 'unlinked' : undefined;
      const orderIssue = orderVoided ? '订单已作废或取消，未计入采购、到货及需求抵扣'
        : orderUnlinked ? '此手工单号已同步 ERP，需明确关联订单行；暂不重复计入需求抵扣' : undefined;
      const recordedPurchaseQty = Math.max(0, num(mirror ? mirror.orderedQty : batch.purchaseQty));
      const recordedReceivedQty = Math.max(0, num(mirror ? mirror.receivedQty : batch.receivedQty));
      const purchaseQty = orderDataIssue ? 0 : recordedPurchaseQty;
      const receivedQty = orderDataIssue ? 0 : recordedReceivedQty;
      const recordedQualifiedQty = Math.max(0, num(batch.qualifiedQty));
      return {
        id: batch.id, supplierId: mirror ? undefined : batch.supplierId ?? undefined,
        supplierName: mirror?.supplierName ?? batch.supplierName,
        purchaseOrderMirrorId: batch.purchaseOrderMirrorId ?? undefined,
        purchaseQty, receivedQty, qualifiedQty: Math.min(receivedQty, recordedQualifiedQty), recordedQualifiedQty,
        recordedPurchaseQty, recordedReceivedQty, orderDataIssue, orderIssue, orderIssueCode,
        orderStatus: mirror?.status ?? undefined, orderApprovalStatus: mirror?.approvalStatus ?? undefined,
        qualityDataIssue: recordedQualifiedQty > recordedReceivedQty,
        inTransitQty: Math.max(0, purchaseQty - receivedQty),
        purchaseOrderNo: mirror?.tpOrderNo ?? batch.purchaseOrderNo ?? undefined,
        orderDate: day(mirror ? mirror.orderDate : batch.orderDate),
        expectedArrivalDate: day(mirror ? mirror.etaDate : batch.expectedArrivalDate),
        actualArrivalDate: day(batch.actualArrivalDate),
        note: batch.note ?? undefined, createdBy: batch.createdBy ?? undefined, createdByName: batch.createdByName,
        createdAt: batch.createdAt.toISOString(), updatedAt: batch.updatedAt.toISOString(),
      };
    });
    const purchasedQty = batches.reduce((sum, batch) => sum + batch.purchaseQty, 0);
    const receivedQty = batches.reduce((sum, batch) => sum + batch.receivedQty, 0);
    const qualifiedQty = batches.reduce((sum, batch) => sum + batch.qualifiedQty, 0);
    const inTransitQty = batches.reduce((sum, batch) => sum + batch.inTransitQty, 0);
    const remainingQty = Math.max(targetQty - purchasedQty, 0);
    const status = purchasedQty >= targetQty
      ? 'completed'
      : purchasedQty > 0
        ? 'in_progress'
        : 'not_started';
    return {
      id: plan.id,
      code: plan.code,
      planType: plan.planType ?? 'material',
      contextLocked, materialLocked: contextLocked || plan.batches.length > 0,
      productId: plan.productId ?? undefined, treeNodeId: plan.treeNodeId ?? undefined,
      productLine: plan.productLine ?? undefined, productionTaskId: plan.productionTaskId ?? undefined,
      bomRevisionId: plan.bomRevisionId ?? undefined, bomBasis: plan.bomBasis ?? undefined,
      bomVersion: plan.bomRevision?.version, bomRetiredAt: plan.bomRevision?.retiredAt?.toISOString() ?? null,
      materialId: plan.materialId ?? undefined,
      materialName: plan.materialName,
      spec: plan.spec,
      unit: plan.unit,
      targetQty,
      purchasedQty,
      receivedQty, qualifiedQty, inTransitQty,
      arrivalProgress: targetQty > 0 ? Math.min(100, receivedQty / targetQty * 100) : 0,
      qualificationProgress: targetQty > 0 ? Math.min(100, qualifiedQty / targetQty * 100) : 0,
      readinessStatus: qualifiedQty >= targetQty ? 'qualified' : receivedQty >= targetQty ? 'pending_inspection' : receivedQty > 0 ? 'partial_received' : 'not_received',
      qualityDataIssue: batches.some((batch) => batch.qualityDataIssue),
      orderDataIssue: batches.some((batch) => batch.orderDataIssue),
      remainingQty,
      progress: targetQty > 0 ? Math.min(100, (purchasedQty / targetQty) * 100) : 0,
      status,
      targetDate: day(plan.targetDate),
      note: plan.note ?? undefined,
      createdBy: plan.createdBy ?? undefined,
      createdByName: plan.createdByName,
      batches,
      tasks: (plan.tasks ?? []).map((task) => ({ ...task, quantity: num(task.quantity), needDate: day(task.needDate) })),
      createdAt: plan.createdAt.toISOString(),
      updatedAt: plan.updatedAt.toISOString(),
    };
  }

  private serializeTask(
    task: ProcTaskView,
    currentRequesterDepartment?: string | null,
  ) {
    // 日志按时间升序读取；同状态操作不覆盖最后一次实际迁移的来源。
    const lastTransition = task.status === 'testing'
      ? [...task.logs].reverse().find((log) => log.fromStatus !== log.toStatus)
      : undefined;
    const transferSnapshots = rdTransferSnapshotsOf(task.metadata);
    // Embedded legacy files have no OSS key. Only a server-verified transfer snapshot may
    // grant a fresh version-file capability; never infer it from a client-provided URL.
    const embeddedPreviewByFile = new Map<string, string>();
    const snapshotViews = transferSnapshots.map((snapshot) => ({
      ...snapshot,
      attachments: snapshot.attachments.map((attachment) => {
        const objectKey = this.resolveAttachmentFileKey(attachment.fileKey, attachment.fileUrl);
        let fileUrl = (objectKey ? this.ossService.buildInlinePreviewUrl(objectKey) : null) ?? attachment.fileUrl;
        if (!objectKey && attachment.fileUrl.startsWith('data:') && attachment.technicalDocumentVersionId && attachment.documentId) {
          const { exp, sig } = this.ossService.signPreviewToken(`rd-tech-doc:${attachment.technicalDocumentVersionId}`, 600);
          fileUrl = `/api/research-development/technical-document-files/${encodeURIComponent(attachment.technicalDocumentVersionId)}?${new URLSearchParams({ exp: String(exp), sig })}`;
          embeddedPreviewByFile.set(JSON.stringify([attachment.fileName, attachment.fileUrl]), fileUrl);
        }
        return { ...attachment, fileUrl };
      }),
    }));
    return {
      id: task.id,
      code: task.code,
      productId: task.productId,
      stockPlanId: task.stockPlanId ?? undefined,
      treeNodeId: task.treeNodeId,
      materialId: task.materialId,
      materialName: task.materialName,
      spec: task.spec,
      unit: task.unit,
      quantity: num(task.quantity),
      method: task.method,
      purchaseLink: task.purchaseLink ?? undefined,
      source: task.source,
      businessLine: task.businessLine,
      status: task.status,
      sampleStatusNeedsReview: task.status === 'testing'
        && lastTransition?.fromStatus === 'inquiring' && lastTransition.toStatus === 'testing',
      sampleTest: sampleTestWithoutCommercial(sampleTestOf(task.metadata)),
      rdTransferSnapshots: snapshotViews,
      priority: task.priority,
      needSample: task.needSample,
      needDate: day(task.needDate),
      deadline: day(task.deadline),
      expectedArrivalDate: day(task.expectedArrivalDate),
      paymentDate: day(task.paymentDate),
      paymentStatus: task.paymentStatus,
      paymentNote: task.paymentNote ?? undefined,
      arrivedQty: num(task.arrivedQty),
      buyer: task.buyer,
      buyerUserId: task.buyerUserId ?? undefined,
      rdTaskId: task.rdTaskId ?? undefined,
      rdTaskTitle: task.rdTaskTitle ?? undefined,
      rdContact: task.rdContact ?? undefined,
      rdContactUserId: task.rdContactUserId ?? undefined,
      requester: task.requester ?? undefined,
      requesterDept:
        currentRequesterDepartment !== undefined
          ? currentRequesterDepartment ?? undefined
          : task.requesterDept ?? undefined,
      consumableNote: task.consumableNote ?? undefined,
      selectedQuotationId: task.selectedQuotationId ?? undefined,
      quotationSubtotal: numOrNull(task.quotationSubtotal) ?? undefined,
      quotationDiscount: numOrNull(task.quotationDiscount) ?? undefined,
      quotationTotal: numOrNull(task.quotationTotal) ?? undefined,
      quotationCurrency: task.quotationCurrency ?? undefined,
      businessDone: task.businessDone,
      cancelReason: task.cancelReason ?? undefined,
      // 前端 ProcurementTask.attachments 是数量占位，这里同时给出数量与明细
      attachments: task.attachments.length,
      attachmentList: task.attachments.map((a) => {
        // 转采购时存下来的是研发模块的短效能力地址（24h 令牌），过期后必然 404。
        // 这里一律按 object key 在读取时重新构造：存量数据没落 fileKey，就从旧地址的
        // key 参数里反解。用内联预览地址而不是 OSS 直链——bucket 设了 x-oss-force-download，
        // 直链会把图片变成强制下载，等于预览不了。
        // 键解析走 resolveAttachmentFileKey：fileUrl 是客户端可传字段，不校验业务前缀就能
        // 把任意 OSS key 换成一条带签名的预览能力地址。
        const objectKey = this.resolveAttachmentFileKey(a.fileKey, a.fileUrl);
        // 卡片上是 64px 高的缩略图，直接挂原图会让每张卡都下载整张大图（列表几十条时
        // 足以把接口压满）。图片类附件额外给一条 OSS 实时缩放地址，前端优先用它。
        const thumbUrl = objectKey && (a.mimeType ?? '').startsWith('image/')
          ? this.ossService.buildInlinePreviewUrl(objectKey, 'image/resize,m_lfit,w_480/format,webp/quality,q_72')
          : null;
        return {
          id: a.id,
          fileName: a.fileName,
          fileUrl: (objectKey ? this.ossService.buildInlinePreviewUrl(objectKey) : null)
            ?? embeddedPreviewByFile.get(JSON.stringify([a.fileName, a.fileUrl])) ?? a.fileUrl,
          ...(thumbUrl ? { thumbUrl } : {}),
          fileSize: a.fileSize,
          mimeType: a.mimeType ?? undefined,
          kind: a.kind,
        };
      }),
      purchaseOrders: task.purchaseOrderRefs.map((r) => ({
        id: r.id,
        tpOrderNo: r.tpOrderNo,
        tpOrderId: r.tpOrderId ?? undefined,
        tpLineNo: r.tpLineNo ?? undefined,
        supplierName: r.supplierName,
        orderedQty: num(r.orderedQty),
        receivedQty: num(r.receivedQty),
        unitPrice: numOrNull(r.unitPrice),
        orderDate: day(r.orderDate),
        etaDate: day(r.etaDate),
        approvalStatus: r.approvalStatus ?? undefined,
        status: r.status ?? undefined,
        freeSample: (r.metadata as { freeSample?: boolean } | null)?.freeSample === true,
      })),
      criticalMaterials: task.criticalMaterials.map((item) => ({
        materialId: item.materialId,
        leadTimeDays: item.leadTimeDays ?? undefined,
      })),
      logs: task.logs.map((l) => ({
        id: l.id,
        at: l.createdAt.toISOString().slice(0, 10),
        createdAt: l.createdAt.toISOString(),
        actor: l.actor ?? undefined,
        actorUserId: l.actorUserId ?? undefined,
        fromStatus: l.fromStatus ?? undefined,
        toStatus: l.toStatus ?? undefined,
        text: l.text,
        kind: l.kind as 'system' | 'action',
      })),
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
    };
  }

  private serializeQuotation(q: Prisma.ProcQuotationGetPayload<object>) {
    return {
      id: q.id,
      taskId: q.taskId ?? undefined,
      materialId: q.materialId ?? undefined,
      materialName: q.materialName,
      supplierId: q.supplierId ?? undefined,
      supplierName: q.supplierName,
      unitPrice: num(q.unitPrice),
      quantity: numOrNull(q.quantity) ?? undefined,
      lineTotal: numOrNull(q.lineTotal) ?? undefined,
      currency: q.currency,
      leadTimeDays: q.leadTimeDays,
      minOrderQty: numOrNull(q.minOrderQty),
      quoteDate: day(q.quoteDate),
      validUntil: day(q.validUntil),
      channel: q.channel,
      isSelected: q.isSelected,
      note: q.note ?? undefined,
    };
  }

  private serializeMaterial(
    m: Prisma.ProcMaterialGetPayload<object> & {
      balances: {
        warehouse: string;
        stockQty: Prisma.Decimal | number;
        availableQty: Prisma.Decimal | number;
        inTransitQty: Prisma.Decimal | number;
        syncedAt: Date | null;
      }[];
    },
    snapshot?: StockSnapshot,
  ) {
    const base = snapshot ? stockForCode(snapshot, m.tpInventoryCode ?? '', m.unit) : null;
    const stockQty = base && base.stockState === 'known' ? base.rows.reduce((sum, row) => sum.plus(row.bookQty!), new Prisma.Decimal(0)).toNumber() : null;
    const availableQty = base?.available ?? null;
    const inTransitQty = m.balances.reduce((sum, b) => sum + num(b.inTransitQty), 0);
    // stockQty 是各仓存量的累加值，详情页要能看清它由哪几个仓库、各多少构成。
    const warehouses = m.balances
      .map((b) => ({
        name: b.warehouse || '未指定仓库',
        stock: num(b.stockQty),
        available: base?.rows.find(row => row.warehouse === b.warehouse)?.available ?? null,
        syncedAt: base?.rows.find(row => row.warehouse === b.warehouse)?.syncedAt ?? null,
      }))
      .sort((a, b) => b.stock - a.stock);
    const inventorySyncedAt = m.balances.reduce<string | undefined>((latest, balance) => {
      const current = balance.syncedAt?.toISOString();
      return current && (!latest || current > latest) ? current : latest;
    }, undefined);
    return {
      id: m.id,
      name: m.name,
      spec: m.spec,
      unit: m.unit,
      category: m.category,
      productLine: m.productLine,
      erpCode: m.erpCode,
      tpInventoryCode: m.tpInventoryCode ?? undefined,
      isSpecial: m.isSpecial,
      isConsumable: m.isConsumable,
      safeStock: num(m.safeStock),
      stockQty,
      availableQty,
      stockState: base?.stockState ?? 'unknown', stockIssues: base?.issues ?? ['缺少 ERP 库存依据'], stockScope: snapshot?.scope ?? { kind: 'all' }, stockReadAt: snapshot?.readAt ?? null,
      inTransitQty,
      warehouses,
      inventorySyncedAt,
      reviewStatus: m.reviewStatus,
      reviewSource: m.reviewSource ?? undefined,
      reviewNote: m.reviewNote ?? undefined,
      latestPrice: numOrNull(m.latestPrice),
      latestSupplier: m.latestSupplier ?? undefined,
      latestQuoteDate: day(m.latestQuoteDate),
      imageUrl: m.imageKey
        ? this.ossService.getSignedUrl(m.imageKey, SIGNED_URL_TTL_SECONDS.DOCUMENT) ?? undefined
        : undefined,
      remark: m.remark ?? undefined,
    };
  }
}
