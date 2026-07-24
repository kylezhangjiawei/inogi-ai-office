import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { ChatService } from '../chat/chat.service';
import { OSS_BUSINESS_TYPES, SIGNED_URL_TTL_SECONDS } from '../oss/oss.constants';
import { OssService } from '../oss/oss.service';
import {
  AiParseTaskDto,
  BatchReassignDto,
  BomNodeInputDto,
  CancelProcTaskDto,
  CreateProcTaskDto,
  CreateQuotationDto,
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

@Injectable()
export class ProcurementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ossService: OssService,
    private readonly chatService: ChatService,
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
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          attachments: { orderBy: { createdAt: 'asc' } },
          logs: { orderBy: { createdAt: 'asc' } },
          purchaseOrderRefs: true,
        },
      }),
    ]);

    return { total, page, pageSize, items: rows.map((r) => this.serializeTask(r)) };
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
    return {
      ...this.serializeTask(task),
      quotations: task.quotations.map((q) => this.serializeQuotation(q)),
    };
  }

  async createTask(dto: CreateProcTaskDto, actor: ProcActor) {
    return this.insertTask(dto, actor, { source: 'self', status: 'pending_inquiry' });
  }

  /** 研发侧「转采购」：落到待处理，由采购确认后才进入询价/直购分支。 */
  async transferFromRd(dto: TransferFromRdDto, actor: ProcActor) {
    const rdTaskId = dto.rdTaskId.trim();
    const existing = await this.prisma.procTask.findUnique({
      where: { rdTaskId },
      include: { attachments: true, logs: true, purchaseOrderRefs: true },
    });
    if (existing) {
      return { ...this.serializeTask(existing), alreadyTransferred: true };
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
    const task = await this.prisma.procTask.create({
      data: {
        code,
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
        buyer: dto.buyer ?? '',
        buyerUserId: dto.buyerUserId ?? null,
        rdTaskId: extra.rdTaskId ?? null,
        rdTaskTitle: extra.rdTaskTitle ?? null,
        rdContact: extra.rdContact ?? null,
        requester: actor.name,
        requesterUserId: actor.id,
        requesterDept: dto.requesterDept ?? null,
        consumableNote: dto.consumableNote ?? null,
        createdBy: actor.id,
        attachments: { create: (dto.attachments ?? []).map((a) => this.attachmentData(a, actor)) },
        logs: {
          create: {
            kind: 'system',
            text:
              extra.source === 'rd'
                ? `由研发任务「${extra.rdTaskTitle ?? extra.rdTaskId ?? '-'}」流转生成，待采购确认`
                : '采购自建任务',
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

  async addQuotation(taskId: string, dto: CreateQuotationDto, actor: ProcActor) {
    const task = await this.requireTask(taskId);
    const quotation = await this.prisma.procQuotation.create({
      data: {
        taskId,
        materialId: task.materialId,
        materialName: task.materialName,
        supplierId: dto.supplierId ?? null,
        supplierName: dto.supplierName,
        unitPrice: new Prisma.Decimal(dto.unitPrice),
        currency: dto.currency ?? 'CNY',
        leadTimeDays: dto.leadTimeDays ?? 0,
        minOrderQty: dto.minOrderQty === undefined ? null : new Prisma.Decimal(dto.minOrderQty),
        quoteDate: parseDay(dto.quoteDate) ?? new Date(),
        validUntil: parseDay(dto.validUntil),
        channel: dto.channel ?? 'manual',
        note: dto.note ?? null,
        createdBy: actor.id,
      },
    });
    // 首次录入报价即视为进入询价中
    if (task.status === 'pending_inquiry') {
      await this.applyTransition(taskId, 'inquiring', actor, '已录入供应商报价，进入询价中');
    } else {
      await this.prisma.procTaskLog.create({
        data: {
          taskId,
          kind: 'action',
          text: `录入 ${dto.supplierName} 报价 ${dto.unitPrice}`,
          actor: actor.name,
          actorUserId: actor.id,
        },
      });
    }
    return this.serializeQuotation(quotation);
  }

  /** 选定报价：需样 → 待到样，免样 → 已定价；同时回写物料最新价。 */
  async selectQuotation(taskId: string, quotationId: string, actor: ProcActor) {
    const task = await this.requireTask(taskId);
    const quotation = await this.prisma.procQuotation.findUnique({ where: { id: quotationId } });
    if (!quotation || quotation.taskId !== taskId) throw new NotFoundException('报价不存在');
    if (task.status !== 'inquiring') throw new BadRequestException('只有「询价中」的任务可选定报价');

    await this.prisma.$transaction([
      this.prisma.procQuotation.updateMany({ where: { taskId }, data: { isSelected: false } }),
      this.prisma.procQuotation.update({ where: { id: quotationId }, data: { isSelected: true } }),
      this.prisma.procTask.update({
        where: { id: taskId },
        data: { selectedQuotationId: quotationId },
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

  // ── T+ 采购单接缝 ───────────────────────────────────────────────────────────

  /** 关联 T+ 采购单：任务进入「已下单」。本系统不创建 T+ 单据，只登记引用。 */
  async linkPurchaseOrder(taskId: string, dto: LinkPurchaseOrderDto, actor: ProcActor) {
    const task = await this.requireTask(taskId);
    if (!['priced', 'pending_purchase', 'in_transit', 'partial_arrival'].includes(task.status)) {
      throw new BadRequestException('当前状态不允许关联采购单');
    }
    await this.prisma.procPurchaseOrderRef.create({
      data: {
        taskId,
        tpOrderNo: dto.tpOrderNo,
        tpOrderId: dto.tpOrderId ?? null,
        tpLineNo: dto.tpLineNo ?? null,
        supplierName: dto.supplierName ?? '',
        orderedQty: new Prisma.Decimal(dto.orderedQty ?? 0),
        orderDate: parseDay(dto.orderDate),
        etaDate: parseDay(dto.etaDate),
        linkedBy: actor.id,
      },
    });
    if (task.status === 'priced' || task.status === 'pending_purchase') {
      return this.applyTransition(taskId, 'in_transit', actor, `关联采购单 ${dto.tpOrderNo}`);
    }
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
  async listBuyerCandidates() {
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
      .sort(
        (a, b) =>
          Number(rosterSet.has(b.id)) - Number(rosterSet.has(a.id)) ||
          Number(isProc(b.department)) - Number(isProc(a.department)),
      )
      .map((u) => ({
        id: u.id,
        name: u.name,
        department: u.department ?? undefined,
        inRoster: rosterSet.has(u.id),
      }));
  }

  // ── 采购成员名录（对齐研发人员名录模式；KV 存储免 migration）────────────────

  private static readonly BUYER_ROSTER_KEY = 'procurement:buyer-roster:v1';

  private async readBuyerRoster(): Promise<string[]> {
    const row = await this.prisma.runtimeState.findUnique({
      where: { key: ProcurementService.BUYER_ROSTER_KEY },
    });
    if (!row) return [];
    try {
      const parsed = JSON.parse(row.value) as unknown;
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }

  private async writeBuyerRoster(ids: string[]) {
    const value = JSON.stringify([...new Set(ids)]);
    await this.prisma.runtimeState.upsert({
      where: { key: ProcurementService.BUYER_ROSTER_KEY },
      create: { key: ProcurementService.BUYER_ROSTER_KEY, value },
      update: { value },
    });
  }

  /** 名录成员（实时回填姓名/部门；已禁用用户标记出来供清理）。 */
  async getBuyerRoster() {
    const ids = await this.readBuyerRoster();
    if (ids.length === 0) return { members: [] };
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, department: true, status: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    return {
      members: ids
        .map((id) => byId.get(id))
        .filter((u): u is NonNullable<typeof u> => Boolean(u))
        .map((u) => ({
          id: u.id,
          name: u.name,
          department: u.department ?? undefined,
          disabled: u.status === 'DISABLED',
        })),
    };
  }

  async addBuyerRosterMember(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new NotFoundException('用户不存在');
    const ids = await this.readBuyerRoster();
    if (!ids.includes(userId)) {
      ids.push(userId);
      await this.writeBuyerRoster(ids);
    }
    return this.getBuyerRoster();
  }

  async removeBuyerRosterMember(userId: string) {
    const ids = await this.readBuyerRoster();
    await this.writeBuyerRoster(ids.filter((id) => id !== userId));
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

  // ── 序列化 ───────────────────────────────────────────────────────────────────

  private serializeTask(
    task: Prisma.ProcTaskGetPayload<{
      include: { attachments: true; logs: true; purchaseOrderRefs: true };
    }>,
  ) {
    return {
      id: task.id,
      code: task.code,
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
      requesterDept: task.requesterDept ?? undefined,
      consumableNote: task.consumableNote ?? undefined,
      selectedQuotationId: task.selectedQuotationId ?? undefined,
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
      remark: m.remark ?? undefined,
    };
  }
}
