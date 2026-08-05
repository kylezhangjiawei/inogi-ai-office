import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { ChatService } from '../chat/chat.service';
import { ResearchDevelopmentService } from '../research-development/research-development.service';
import { OSS_BUSINESS_TYPES, SIGNED_URL_TTL_SECONDS } from '../oss/oss.constants';
import { OssService } from '../oss/oss.service';
import {
  AiParseTaskDto,
  ApplyQuoteBookQuotesDto,
  BatchReassignDto,
  MoveProcTasksDto,
  BomNodeInputDto,
  CancelProcTaskDto,
  ConfirmQuoteBookQuotesDto,
  CreateProcTaskTreeNodeDto,
  CreateProcTaskDto,
  ImportBomDto,
  ImportMaterialsDto,
  LinkPurchaseOrderDto,
  ProcAttachmentInputDto,
  ReassignProcTaskDto,
  ReceiveGoodsDto,
  RenameCategoryDto,
  ReviewMaterialDto,
  TransferFromRdDto,
  TransitionProcTaskDto,
  UpdateProcTaskTreeNodeDto,
  UpdateProcTaskDto,
  UpsertMaterialDto,
} from './dto/procurement.dto';
import {
  PROC_ARRIVAL_STATUSES,
  PROC_STATUS_LABELS,
  PROC_STATUS_TRANSITIONS,
  PROC_TERMINAL_STATUSES,
  type ProcActor,
  type ProcMaterialListQuery,
  type ProcStatus,
  type ProcTaskListQuery,
} from './procurement.types';
import { INITIAL_PROC_TASK_TREE } from './proc-task-tree.seed';

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

/** BOM 树出参节点。 */
export interface BomTreeNode {
  id: string;
  name: string;
  code: string | null;
  level: number;
  productLine: string;
  qtyPer: number | null;
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

@Injectable()
export class ProcurementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ossService: OssService,
    private readonly chatService: ChatService,
    private readonly rdService: ResearchDevelopmentService,
  ) {}

  // ── 任务 ────────────────────────────────────────────────────────────────────

  async listTasks(query: ProcTaskListQuery) {
    const where: Prisma.ProcTaskWhereInput = {};
    if (query.status) where.status = { in: query.status.split(',').filter(Boolean) };
    if (query.businessLine) where.businessLine = query.businessLine;
    if (query.source) where.source = query.source;
    if (query.method) where.method = query.method;
    if (query.priority) where.priority = query.priority;
    if (query.buyerUserId) where.buyerUserId = query.buyerUserId;
    if (query.materialId) where.materialId = query.materialId;
    if (query.rdTaskId) where.rdTaskId = query.rdTaskId;
    if (query.activeOnly === 'true') where.status = { notIn: PROC_TERMINAL_STATUSES };
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
        include: {
          attachments: { orderBy: { createdAt: 'asc' } },
          logs: { orderBy: { createdAt: 'asc' } },
          purchaseOrderRefs: true,
        },
      }),
    ]);

    const requesterDepartments = await this.getRequesterDepartmentMap(rows);
    return {
      total,
      page,
      pageSize,
      items: rows.map((row) =>
        this.serializeTask(
          row,
          row.requesterUserId && requesterDepartments.has(row.requesterUserId)
            ? requesterDepartments.get(row.requesterUserId)
            : undefined,
        ),
      ),
    };
  }

  async getTask(id: string) {
    const task = await this.prisma.procTask.findUnique({
      where: { id },
      include: {
        attachments: { orderBy: { createdAt: 'asc' } },
        logs: { orderBy: { createdAt: 'asc' } },
        purchaseOrderRefs: true,
        quotations: { orderBy: { quoteDate: 'desc' } },
        material: true,
      },
    });
    if (!task) throw new NotFoundException('采购任务不存在');
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

  /** 研发侧「转采购」：落到待处理，由采购确认后才进入询价/直购分支。 */
  async transferFromRd(dto: TransferFromRdDto, actor: ProcActor) {
    const rdTaskId = dto.rdTaskId.trim();
    const requesterDept = await this.resolveRequesterDepartment(actor.id, dto.requesterDept);
    const existing = await this.prisma.procTask.findUnique({
      where: { rdTaskId },
      include: { attachments: true, logs: true, purchaseOrderRefs: true },
    });
    if (existing && existing.status !== 'cancelled') {
      return { ...this.serializeTask(existing), alreadyTransferred: true };
    }
    if (existing) {
      // 审核驳回（或取消）后的重新提交：更新需求内容、回到待处理重走审核，保留历史日志与旧附件
      const updated = await this.prisma.procTask.update({
        where: { id: existing.id },
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
          rdTaskTitle: dto.rdTaskTitle ?? existing.rdTaskTitle,
          rdContact: dto.rdContact ?? existing.rdContact,
          requester: actor.name,
          requesterUserId: actor.id,
          requesterDept,
          consumableNote: dto.consumableNote ?? existing.consumableNote,
          status: 'pending_confirm',
          cancelReason: null,
          ...(dto.attachments?.length
            ? { attachments: { create: dto.attachments.map((a) => this.attachmentData(a, actor)) } }
            : {}),
          logs: {
            create: {
              kind: 'action',
              text: '研发修改后重新提交转采购，待采购重新审核',
              fromStatus: 'cancelled',
              toStatus: 'pending_confirm',
              actor: actor.name,
              actorUserId: actor.id,
            },
          },
        },
        include: { attachments: true, logs: true, purchaseOrderRefs: true },
      });
      return { ...this.serializeTask(updated), alreadyTransferred: false };
    }
    if (!dto.attachments?.length) {
      // 研发侧不强制校验业务字段，但必须带附件（图纸/说明），否则采购无从下手
      throw new BadRequestException('转采购需至少上传 1 个附件');
    }
    try {
      return await this.insertTask(dto, actor, {
        source: 'rd',
        status: 'pending_confirm',
        rdTaskId,
        rdTaskTitle: dto.rdTaskTitle,
        rdContact: dto.rdContact,
      });
    } catch (error) {
      // 数据库唯一约束兜住并发双击/网络重试；若另一请求已成功，返回同一采购任务。
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const transferred = await this.prisma.procTask.findUnique({
          where: { rdTaskId },
          include: { attachments: true, logs: true, purchaseOrderRefs: true },
        });
        if (transferred) {
          return { ...this.serializeTask(transferred), alreadyTransferred: true };
        }
      }
      throw error;
    }
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
    const requestedBuyer = dto.buyer?.trim();
    const automaticBuyer = requestedBuyer ? null : await this.pickAutomaticBuyer();
    const buyer = requestedBuyer || automaticBuyer?.name || '';
    const buyerUserId = dto.buyerUserId ?? automaticBuyer?.id ?? null;
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
        requester: actor.name,
        requesterUserId: actor.id,
        requesterDept,
        consumableNote: dto.consumableNote ?? null,
        createdBy: actor.id,
        attachments: { create: (dto.attachments ?? []).map((a) => this.attachmentData(a, actor)) },
        logs: {
          create: {
            kind: 'system',
            text:
              extra.source === 'rd'
                ? `由研发任务「${extra.rdTaskTitle ?? extra.rdTaskId ?? '-'}」流转生成，待采购确认${automaticBuyer ? `；按当前负载自动分配给 ${automaticBuyer.name}` : ''}`
                : `采购自建任务${automaticBuyer ? `；按当前负载自动分配给 ${automaticBuyer.name}` : ''}`,
            toStatus: extra.status,
            actor: actor.name,
            actorUserId: actor.id,
          },
        },
      },
      include: { attachments: true, logs: true, purchaseOrderRefs: true },
    });
    return this.serializeTask(task);
  }

  private attachmentData(a: ProcAttachmentInputDto, actor: ProcActor) {
    return {
      fileName: a.fileName,
      fileUrl: a.fileUrl,
      fileKey: a.fileKey ?? null,
      fileSize: a.fileSize ?? 0,
      mimeType: a.mimeType ?? null,
      kind: a.kind ?? 'drawing',
      uploadedBy: actor.id,
    };
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
    await this.requireTask(id);
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
      include: { attachments: true, logs: true, purchaseOrderRefs: true },
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
    return this.applyTransition(id, next, actor, '采购已确认接收');
  }

  /** 通用状态流转：受 PROC_STATUS_TRANSITIONS 约束。 */
  async transitionTask(id: string, dto: TransitionProcTaskDto, actor: ProcActor) {
    const task = await this.requireTask(id);
    const target = dto.status as ProcStatus;
    const allowed = PROC_STATUS_TRANSITIONS[task.status as ProcStatus] ?? [];
    if (!allowed.includes(target)) {
      throw new BadRequestException(
        `不允许从「${PROC_STATUS_LABELS[task.status as ProcStatus] ?? task.status}」流转到「${
          PROC_STATUS_LABELS[target] ?? target
        }」`,
      );
    }
    return this.applyTransition(id, target, actor, dto.note);
  }

  private async applyTransition(id: string, next: ProcStatus, actor: ProcActor, note?: string) {
    const task = await this.prisma.procTask.findUniqueOrThrow({ where: { id } });
    const updated = await this.prisma.procTask.update({
      where: { id },
      data: {
        status: next,
        businessDone: next === 'completed' ? true : task.businessDone,
        logs: {
          create: {
            kind: 'system',
            text: note ?? `状态更新为「${PROC_STATUS_LABELS[next] ?? next}」`,
            fromStatus: task.status,
            toStatus: next,
            actor: actor.name,
            actorUserId: actor.id,
          },
        },
      },
      include: { attachments: true, logs: true, purchaseOrderRefs: true },
    });
    return this.serializeTask(updated);
  }

  /**
   * 审核驳回研发流转任务：仅限「待处理」的研发来源任务。落为 cancelled + 驳回理由留痕，
   * 站内通知研发对接人；研发侧修改后可重新转采购（transferFromRd 对 cancelled 任务重激活）。
   */
  async rejectRdTask(id: string, reason: string, actor: ProcActor) {
    const trimmed = reason.trim();
    if (!trimmed) throw new BadRequestException('驳回必须填写理由');
    const task = await this.requireTask(id);
    if (task.source !== 'rd' || task.status !== 'pending_confirm') {
      throw new BadRequestException('仅「待处理」的研发流转任务可审核驳回');
    }
    const updated = await this.prisma.procTask.update({
      where: { id },
      data: {
        status: 'cancelled',
        cancelReason: `审核驳回：${trimmed}`,
        logs: {
          create: {
            kind: 'action',
            text: `采购审核驳回：${trimmed}`,
            fromStatus: task.status,
            toStatus: 'cancelled',
            actor: actor.name,
            actorUserId: actor.id,
          },
        },
      },
      include: { attachments: true, logs: true, purchaseOrderRefs: true },
    });
    // 站内通知研发对接人/需求提出人（通知失败不影响驳回本身）
    const recipient = task.rdContact || task.requester;
    if (recipient) {
      try {
        await this.rdService.createMessage({
          sender: { id: actor.id, name: actor.name, role: '采购' },
          recipient_name: recipient,
          subject: '转采购需求被驳回',
          body: `你转采购的需求「${task.materialName}」（${task.code}${task.rdTaskTitle ? `，来源研发任务：${task.rdTaskTitle}` : ''}）被采购审核驳回。\n驳回理由：${trimmed}\n请在研发任务里修改后重新转采购。`,
        });
      } catch (error) {
        // 同名多人等场景通知可能失败，驳回结果不回滚
        new Logger(ProcurementService.name).warn(`驳回通知发送失败: ${(error as Error).message}`);
      }
    }
    return this.serializeTask(updated);
  }

  async cancelTask(id: string, dto: CancelProcTaskDto, actor: ProcActor) {
    const task = await this.requireTask(id);
    if (PROC_TERMINAL_STATUSES.includes(task.status as ProcStatus)) {
      throw new BadRequestException('任务已完结，无法取消');
    }
    const updated = await this.prisma.procTask.update({
      where: { id },
      data: {
        status: 'cancelled',
        cancelReason: dto.reason ?? null,
        logs: {
          create: {
            kind: 'action',
            text: dto.reason ? `任务取消：${dto.reason}` : '任务取消',
            fromStatus: task.status,
            toStatus: 'cancelled',
            actor: actor.name,
            actorUserId: actor.id,
          },
        },
      },
      include: { attachments: true, logs: true, purchaseOrderRefs: true },
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
      include: { attachments: true, logs: true, purchaseOrderRefs: true },
    });
    return this.serializeTask(updated);
  }

  async reassignTask(id: string, dto: ReassignProcTaskDto, actor: ProcActor) {
    await this.requireTask(id);
    const updated = await this.prisma.procTask.update({
      where: { id },
      data: {
        buyerUserId: dto.buyerUserId ?? null,
        buyer: dto.buyer,
        logs: {
          create: {
            kind: 'action',
            text: `转派采购负责人为 ${dto.buyer}`,
            actor: actor.name,
            actorUserId: actor.id,
          },
        },
      },
      include: { attachments: true, logs: true, purchaseOrderRefs: true },
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
      select: { id: true, code: true, productId: true },
    });
    if (tasks.length !== ids.length) {
      throw new NotFoundException('部分任务不存在或已被删除，请刷新后重试');
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
    await this.prisma.$transaction(
      ids.map((id) =>
        this.prisma.procTask.update({
          where: { id },
          data: {
            buyerUserId: dto.buyerUserId ?? null,
            buyer: dto.buyer,
            logs: {
              create: {
                kind: 'action',
                text: `批量转派采购负责人为 ${dto.buyer}`,
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
    const candidates = await this.listBuyerCandidates(false);
    if (candidates.length === 0) {
      throw new BadRequestException('没有可用的采购成员，请先在部门管理中配置采购部门人员');
    }
    const [tasks, active] = await Promise.all([
      this.prisma.procTask.findMany({
        where: {
          buyer: '',
          status: { notIn: PROC_TERMINAL_STATUSES },
        },
        select: { id: true, code: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.procTask.groupBy({
        by: ['buyerUserId'],
        where: {
          buyerUserId: { in: candidates.map((candidate) => candidate.id) },
          status: { notIn: PROC_TERMINAL_STATUSES },
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

  async deleteTask(id: string) {
    await this.requireTask(id);
    await this.prisma.procTask.delete({ where: { id } });
    return { ok: true };
  }

  async addAttachments(id: string, items: ProcAttachmentInputDto[], actor: ProcActor) {
    await this.requireTask(id);
    await this.prisma.procTaskAttachment.createMany({
      data: items.map((a) => ({ taskId: id, ...this.attachmentData(a, actor) })),
    });
    return this.getTask(id);
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
        OR: [{ validUntil: null }, { validUntil: { gte: today } }],
      },
      include: { material: { select: { name: true, spec: true } } },
      orderBy: [{ updatedAt: 'desc' }],
    });

    const quotes: TaskQuoteBookOption[] = rows.flatMap((quote): TaskQuoteBookOption[] => {
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
      select: { materialId: true, supplierName: true },
    });
    const existingKeys = new Set(existing.map((quote) => `${quote.materialId ?? ''}\u0000${quote.supplierName}`));
    const additions = selected
      .filter((quote): quote is NonNullable<typeof quote> => Boolean(quote))
      .filter((quote) => !existingKeys.has(`${quote.materialId}\u0000${quote.supplierName}`));
    if (additions.length === 0) throw new BadRequestException('所选报价已带入当前任务');

    await this.prisma.procQuotation.createMany({
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

    if (task.status === 'pending_inquiry') {
      await this.applyTransition(
        taskId,
        'inquiring',
        actor,
        `从供应商报价库带入 ${additions.length} 条报价，进入询价中`,
      );
    } else {
      await this.prisma.procTaskLog.create({
        data: {
          taskId,
          kind: 'action',
          text: `从供应商报价库补充 ${additions.length} 条报价`,
          actor: actor.name,
          actorUserId: actor.id,
        },
      });
    }

    return this.listQuotations({ taskId });
  }

  /**
   * 从报价库批量生成并确认任务报价。
   * 这是「待询价」阶段的完整业务动作：一次保存多条不可变快照，并直接进入待到样/已定价，
   * 不再要求采购人员在下一节点逐条单选。selectedQuotationId 仅保留首条用于兼容旧客户端。
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

    const next: ProcStatus = task.needSample ? 'pending_sample' : 'priced';
    await this.prisma.$transaction(async (tx) => {
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
              text: `从供应商报价库批量确认 ${snapshots.length} 条报价，报价小计 ${currency} ${subtotal.toFixed(4)}，折扣 ${discount.toFixed(4)}，最终总价 ${total.toFixed(4)}`,
              fromStatus: task.status,
              toStatus: next,
              actor: actor.name,
              actorUserId: actor.id,
            },
          },
        },
      });
    });

    return this.getTask(taskId);
  }

  /** 选定报价：需样 → 待到样，免样 → 已定价；同时回写物料最新价。 */
  async selectQuotation(taskId: string, quotationId: string, actor: ProcActor) {
    const task = await this.requireTask(taskId);
    const quotation = await this.prisma.procQuotation.findUnique({ where: { id: quotationId } });
    if (!quotation || quotation.taskId !== taskId) throw new NotFoundException('报价不存在');
    if (task.status !== 'inquiring') throw new BadRequestException('只有「询价中」的任务可选定报价');

    const selectedQuantity = quotation.quantity ?? task.quantity;
    const selectedLineTotal = quotation.unitPrice.mul(selectedQuantity).toDecimalPlaces(4);
    await this.prisma.$transaction([
      this.prisma.procQuotation.updateMany({ where: { taskId }, data: { isSelected: false } }),
      this.prisma.procQuotation.update({
        where: { id: quotationId },
        data: {
          isSelected: true,
          quantity: selectedQuantity,
          lineTotal: selectedLineTotal,
        },
      }),
      this.prisma.procTask.update({
        where: { id: taskId },
        data: {
          selectedQuotationId: quotationId,
          quotationSubtotal: selectedLineTotal,
          quotationDiscount: new Prisma.Decimal(0),
          quotationTotal: selectedLineTotal,
          quotationCurrency: quotation.currency,
        },
      }),
    ]);
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

  /** 多供应商采购单一次性关联；任意一条失败则全部回滚。 */
  async linkPurchaseOrders(taskId: string, items: LinkPurchaseOrderDto[], actor: ProcActor) {
    const task = await this.requireTask(taskId);
    if (!['priced', 'pending_purchase', 'in_transit', 'partial_arrival'].includes(task.status)) {
      throw new BadRequestException('当前状态不允许关联采购单');
    }
    const normalized = items.map((item) => ({ ...item, tpOrderNo: item.tpOrderNo.trim() }));
    if (normalized.some((item) => !item.tpOrderNo)) {
      throw new BadRequestException('采购单号不能为空');
    }
    const keys = normalized.map((item) => `${item.tpOrderNo}\u0000${item.tpLineNo ?? ''}`);
    if (new Set(keys).size !== keys.length) {
      throw new BadRequestException('同一采购单及行号不能重复关联');
    }
    const nextStatus = task.status === 'priced' || task.status === 'pending_purchase' ? 'in_transit' : task.status;
    await this.prisma.$transaction(async (tx) => {
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
        })),
      });
      await tx.procTask.update({
        where: { id: taskId },
        data: {
          status: nextStatus,
          logs: {
            create: {
              kind: 'system',
              text: `一次关联 ${normalized.length} 张采购单：${normalized.map((item) => item.tpOrderNo).join('、')}`,
              fromStatus: task.status,
              toStatus: nextStatus,
              actor: actor.name,
              actorUserId: actor.id,
            },
          },
        },
      });
    });
    return this.getTask(taskId);
  }

  async unlinkPurchaseOrder(taskId: string, refId: string) {
    await this.requireTask(taskId);
    await this.prisma.procPurchaseOrderRef.deleteMany({ where: { id: refId, taskId } });
    return this.getTask(taskId);
  }

  /**
   * 依据已关联的 T+ 采购单重算任务到货量与状态。
   * T+ 同步落库后调用；到货齐 → 已完成，部分到货 → partial_arrival。
   */
  async recomputeArrival(taskId: string) {
    const task = await this.prisma.procTask.findUnique({
      where: { id: taskId },
      include: { purchaseOrderRefs: true },
    });
    if (!task) return null;
    const received = task.purchaseOrderRefs.reduce((sum, r) => sum + num(r.receivedQty), 0);
    const quantity = num(task.quantity);
    let status = task.status;
    if (PROC_ARRIVAL_STATUSES.includes(task.status as ProcStatus)) {
      if (quantity > 0 && received >= quantity) status = 'completed';
      else if (received > 0) status = 'partial_arrival';
    }
    const eta = task.purchaseOrderRefs
      .map((r) => r.etaDate)
      .filter((d): d is Date => Boolean(d))
      .sort((a, b) => a.getTime() - b.getTime())[0];

    await this.prisma.procTask.update({
      where: { id: taskId },
      data: {
        arrivedQty: new Prisma.Decimal(received),
        status,
        businessDone: status === 'completed' ? true : task.businessDone,
        expectedArrivalDate: eta ?? task.expectedArrivalDate,
      },
    });
    return { taskId, arrivedQty: received, status };
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

    let items = rows.map((r) => this.serializeMaterial(r));
    // 缺料筛选：库存 < 安全库存。阈值本地维护，库存来自 T+ 镜像。
    if (query.shortageOnly === 'true') {
      items = items.filter((m) => m.safeStock > 0 && m.stockQty < m.safeStock);
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
      const row = await this.prisma.procMaterial.update({ where: { id }, data });
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
        ...(productId ? { where: { productId } } : {}),
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
    if (dto.replace) await this.prisma.procBomNode.deleteMany({});
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
        ? await this.prisma.procMaterial.findUnique({ where: { tpInventoryCode: code }, select: { id: true } })
        : null;
      const row = await this.prisma.procBomNode.create({
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
      const material = await this.prisma.procMaterial.findUnique({
        where: { tpInventoryCode: code },
        select: { id: true, metadata: true },
      });
      if (!material) continue;
      const lines = [...u.lines].filter(Boolean);
      const productLine = lines.length === 1 ? lines[0] : lines.length > 1 ? '通用' : '';
      const meta = (material.metadata ?? {}) as Record<string, unknown>;
      await this.prisma.procMaterial.update({
        where: { id: material.id },
        data: {
          ...(productLine ? { productLine } : {}),
          metadata: { ...meta, bom: { systems: [...u.systems], lines } } as Prisma.InputJsonObject,
        },
      });
      touchedMaterials += 1;
    }
    return { nodes: nodeCount, matchedMaterials: usage.size, touchedMaterials };
  }

  /** BOM 树查询：全量返回（数据量为部件×原料级，数百节点）。 */
  async getBomTree() {
    const rows = await this.prisma.procBomNode.findMany({
      orderBy: [{ level: 'asc' }, { sortOrder: 'asc' }],
      include: { material: { select: { id: true, name: true, spec: true, unit: true } } },
    });
    const byId = new Map<string, BomTreeNode>();
    const roots: BomTreeNode[] = [];
    for (const r of rows) {
      byId.set(r.id, {
        id: r.id,
        name: r.name,
        code: r.code,
        level: r.level,
        productLine: r.productLine,
        qtyPer: numOrNull(r.qtyPer),
        material: r.material,
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
   * 转派/建单的负责人候选：全部启用用户的 id/name/部门。
   * 排序：采购成员名录 > 部门含「采购」 > 其余按姓名；名录成员带 inRoster 标记。
   * 开放度与 GET /auth/avatars 一致（登录即可读全员 id/name），不落敏感字段。
   */
  async listBuyerCandidates(includeAll = false) {
    const [users, roster] = await Promise.all([
      this.prisma.user.findMany({
        where: { status: { not: 'DISABLED' } },
        select: { id: true, name: true, department: true },
        orderBy: { name: 'asc' },
      }),
      this.readBuyerRoster(),
    ]);
    const rosterSet = new Set(roster);
    const isProc = (d: string | null) => Boolean(d && d.includes('采购'));
    return users
      .filter((user) => includeAll || rosterSet.has(user.id) || isProc(user.department))
      .sort(
        (a, b) =>
          Number(rosterSet.has(b.id)) - Number(rosterSet.has(a.id)) ||
          Number(isProc(b.department)) - Number(isProc(a.department)),
      )
      .map((u) => ({
        id: u.id,
        name: u.name,
        department: u.department ?? undefined,
        inRoster: rosterSet.has(u.id) || isProc(u.department),
      }));
  }

  /** 新任务默认分配给当前在制任务最少的采购成员。 */
  private async pickAutomaticBuyer() {
    const candidates = await this.listBuyerCandidates(false);
    if (candidates.length === 0) return null;
    const grouped = await this.prisma.procTask.groupBy({
      by: ['buyerUserId'],
      where: {
        buyerUserId: { in: candidates.map((candidate) => candidate.id) },
        status: { notIn: PROC_TERMINAL_STATUSES },
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
  private async readBuyerRosterEntries(): Promise<Array<{ userId: string; note?: string }>> {
    const row = await this.prisma.runtimeState.findUnique({
      where: { key: ProcurementService.BUYER_ROSTER_KEY },
    });
    if (!row) return [];
    try {
      const parsed = JSON.parse(row.value) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((x) => {
          if (typeof x === 'string') return { userId: x };
          if (x && typeof x === 'object' && typeof (x as { userId?: unknown }).userId === 'string') {
            const note = (x as { note?: unknown }).note;
            return { userId: (x as { userId: string }).userId, note: typeof note === 'string' ? note : undefined };
          }
          return null;
        })
        .filter((x): x is { userId: string; note?: string } => Boolean(x));
    } catch {
      return [];
    }
  }

  private async readBuyerRoster(): Promise<string[]> {
    return (await this.readBuyerRosterEntries()).map((e) => e.userId);
  }

  private async writeBuyerRosterEntries(entries: Array<{ userId: string; note?: string }>) {
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
    const entries = await this.readBuyerRosterEntries();
    const procurementUsers = await this.prisma.user.findMany({
      where: {
        status: { not: 'DISABLED' },
        department: { contains: '采购', mode: 'insensitive' },
      },
      select: { id: true, name: true, department: true, status: true },
      orderBy: { name: 'asc' },
    });
    const procurementIds = new Set(procurementUsers.map((user) => user.id));
    const effectiveEntries = [
      ...entries,
      ...procurementUsers
        .filter((user) => !entries.some((entry) => entry.userId === user.id))
        .map((user) => ({ userId: user.id })),
    ];
    if (effectiveEntries.length === 0) return { members: [] };
    const users = await this.prisma.user.findMany({
      where: { id: { in: effectiveEntries.map((e) => e.userId) } },
      select: { id: true, name: true, department: true, status: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    return {
      members: effectiveEntries
        .map((e) => ({ entry: e, user: byId.get(e.userId) }))
        .filter((x): x is { entry: { userId: string; note?: string }; user: NonNullable<ReturnType<typeof byId.get>> } => Boolean(x.user))
        .map(({ entry, user }) => ({
          id: user.id,
          name: user.name,
          department: user.department ?? undefined,
          note: entry.note,
          disabled: user.status === 'DISABLED',
          managedByDepartment: procurementIds.has(user.id),
        })),
    };
  }

  async addBuyerRosterMember(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new NotFoundException('用户不存在');
    const entries = await this.readBuyerRosterEntries();
    if (!entries.some((e) => e.userId === userId)) {
      entries.push({ userId });
      await this.writeBuyerRosterEntries(entries);
    }
    return this.getBuyerRoster();
  }

  /** 更新成员岗位备注（如「电子料询价」「包材/耗材」），仅名录内成员。 */
  async updateBuyerRosterMember(userId: string, note: string) {
    const entries = await this.readBuyerRosterEntries();
    let entry = entries.find((e) => e.userId === userId);
    if (!entry) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { department: true, status: true },
      });
      if (user?.status === 'DISABLED' || !user?.department?.includes('采购')) {
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
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { department: true, status: true },
    });
    if (user?.status !== 'DISABLED' && user?.department?.includes('采购')) {
      throw new BadRequestException('采购部门在职成员由系统自动维护，请先在部门管理中调整该人员所属部门');
    }
    const entries = await this.readBuyerRosterEntries();
    await this.writeBuyerRosterEntries(entries.filter((e) => e.userId !== userId));
    return this.getBuyerRoster();
  }

  // ── 汇总 ────────────────────────────────────────────────────────────────────

  /** 驾驶舱顶部指标：各状态计数 + 逾期 + 缺料。 */
  async summary() {
    const grouped = await this.prisma.procTask.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    const byStatus: Record<string, number> = {};
    for (const g of grouped) byStatus[g.status] = g._count._all;

    const today = new Date(new Date().toISOString().slice(0, 10));
    const overdue = await this.prisma.procTask.count({
      where: {
        status: { notIn: PROC_TERMINAL_STATUSES },
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

  private serializeTask(
    task: Prisma.ProcTaskGetPayload<{
      include: { attachments: true; logs: true; purchaseOrderRefs: true };
    }>,
    currentRequesterDepartment?: string | null,
  ) {
    return {
      id: task.id,
      code: task.code,
      productId: task.productId,
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
      attachmentList: task.attachments.map((a) => ({
        id: a.id,
        fileName: a.fileName,
        // 采购任务保存 OSS object key，读取时重签，避免转采购时保存的短效链接过期。
        fileUrl: a.fileKey
          ? this.ossService.getSignedUrl(a.fileKey, SIGNED_URL_TTL_SECONDS.DOCUMENT) ?? a.fileUrl
          : a.fileUrl,
        fileSize: a.fileSize,
        mimeType: a.mimeType ?? undefined,
        kind: a.kind,
      })),
      purchaseOrders: task.purchaseOrderRefs.map((r) => ({
        id: r.id,
        tpOrderNo: r.tpOrderNo,
        tpLineNo: r.tpLineNo ?? undefined,
        supplierName: r.supplierName,
        orderedQty: num(r.orderedQty),
        receivedQty: num(r.receivedQty),
        unitPrice: numOrNull(r.unitPrice),
        orderDate: day(r.orderDate),
        etaDate: day(r.etaDate),
        approvalStatus: r.approvalStatus ?? undefined,
        status: r.status ?? undefined,
      })),
      logs: task.logs.map((l) => ({
        at: l.createdAt.toISOString().slice(0, 10),
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
      balances: { stockQty: Prisma.Decimal | number }[];
    },
  ) {
    const stockQty = m.balances.reduce((sum, b) => sum + num(b.stockQty), 0);
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
