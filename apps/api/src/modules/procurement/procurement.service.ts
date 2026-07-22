import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { OSS_BUSINESS_TYPES, SIGNED_URL_TTL_SECONDS } from '../oss/oss.constants';
import { OssService } from '../oss/oss.service';
import {
  CancelProcTaskDto,
  CreateProcTaskDto,
  CreateQuotationDto,
  ImportMaterialsDto,
  LinkPurchaseOrderDto,
  ProcAttachmentInputDto,
  ReassignProcTaskDto,
  ReceiveGoodsDto,
  ReviewMaterialDto,
  TransferFromRdDto,
  TransitionProcTaskDto,
  UpdateProcTaskDto,
  UpsertMaterialDto,
} from './dto/procurement.dto';
import {
  SEED_MATERIALS,
  SEED_QUOTATIONS,
  SEED_SUPPLIERS,
  SEED_TASKS,
} from './procurement.seed';
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

@Injectable()
export class ProcurementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ossService: OssService,
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
    const pageSize = Math.min(500, Math.max(1, Number(query.pageSize) || 200));

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
    const data = {
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
    };
    const row = id
      ? await this.prisma.procMaterial.update({ where: { id }, data })
      : await this.prisma.procMaterial.create({
          data: { ...data, reviewSource: 'manual', createdBy: actor.id },
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
        await this.prisma.procMaterial.update({
          where: { id: row.id },
          data: { reviewStatus: 'pending', reviewSource: 'import' },
        });
        created += 1;
      }
    }
    return { created, updated, total: dto.items.length };
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

  // ── 演示种子 ─────────────────────────────────────────────────────────────────

  /**
   * 灌入演示数据（与前端原 mock 同源）。
   * 默认幂等保护：库中已有任务时直接返回 skipped，force=true 才清空重灌。
   */
  async seedDemoData(actor: ProcActor, force = false) {
    const existing = await this.prisma.procTask.count();
    if (existing > 0 && !force) {
      return { skipped: true, reason: `已存在 ${existing} 条采购任务，如需重灌请传 force=true` };
    }
    if (force) {
      // 顺序无关：附件/日志/报价/采购单引用均为级联删除
      await this.prisma.procTask.deleteMany({});
      await this.prisma.procQuotation.deleteMany({});
      await this.prisma.procInventoryBalance.deleteMany({});
      await this.prisma.procMaterial.deleteMany({});
      await this.prisma.procSupplier.deleteMany({});
    }

    const base = new Date(new Date().toISOString().slice(0, 10));
    const shift = (days: number | undefined | null): Date | null =>
      days === undefined || days === null
        ? null
        : new Date(base.getTime() + days * 24 * 3600 * 1000);

    for (const s of SEED_SUPPLIERS) {
      await this.prisma.procSupplier.create({
        data: { name: s.name, contact: s.contact, phone: s.phone, source: 'local' },
      });
    }

    const materialIdByName = new Map<string, string>();
    for (const m of SEED_MATERIALS) {
      const row = await this.prisma.procMaterial.create({
        data: {
          name: m.name,
          spec: m.spec,
          unit: m.unit,
          category: m.category,
          productLine: m.productLine,
          erpCode: m.erpCode,
          isSpecial: m.isSpecial ?? false,
          isConsumable: m.isConsumable ?? false,
          safeStock: new Prisma.Decimal(m.safeStock),
          reviewStatus: m.reviewStatus,
          reviewSource: m.reviewSource ?? null,
          latestPrice: m.latestPrice === undefined ? null : new Prisma.Decimal(m.latestPrice),
          latestSupplier: m.latestSupplier ?? null,
          latestQuoteDate: shift(m.latestQuoteDay),
          createdBy: actor.id,
        },
      });
      materialIdByName.set(m.name, row.id);
      // 库存先落本地镜像（warehouse 留空），正式接 T+ 后由同步覆盖
      await this.prisma.procInventoryBalance.create({
        data: {
          tpInventoryCode: m.erpCode,
          materialId: row.id,
          materialName: m.name,
          spec: m.spec,
          unit: m.unit,
          warehouse: '',
          stockQty: new Prisma.Decimal(m.stockQty),
          availableQty: new Prisma.Decimal(m.stockQty),
        },
      });
    }

    let seq = 0;
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    for (const t of SEED_TASKS) {
      seq += 1;
      await this.prisma.procTask.create({
        data: {
          code: `PR-${stamp}-${String(seq).padStart(3, '0')}`,
          materialId: materialIdByName.get(t.materialName) ?? null,
          materialName: t.materialName,
          spec: t.spec,
          unit: t.unit,
          quantity: new Prisma.Decimal(t.quantity),
          method: t.method,
          purchaseLink: t.purchaseLink ?? null,
          source: t.source,
          businessLine: t.businessLine,
          status: t.status,
          priority: t.priority,
          needSample: t.needSample,
          needDate: shift(t.needDay),
          deadline: shift(t.deadlineDay),
          expectedArrivalDate: shift(t.etaDay),
          paymentDate: shift(t.paymentDay),
          paymentStatus: t.paymentStatus,
          paymentNote: t.paymentNote ?? null,
          arrivedQty: new Prisma.Decimal(t.arrivedQty),
          buyer: t.buyer,
          rdTaskTitle: t.rdTaskTitle ?? null,
          rdContact: t.rdContact ?? null,
          requester: t.requester,
          requesterDept: t.requesterDept,
          consumableNote: t.consumableNote ?? null,
          businessDone: t.status === 'completed',
          createdBy: actor.id,
          attachments: {
            create: Array.from({ length: t.attachmentCount }, (_, i) => ({
              fileName: `${t.materialName}-图纸${i + 1}.pdf`,
              fileUrl: '',
              kind: 'drawing',
              uploadedBy: actor.id,
            })),
          },
          logs: {
            create: t.logs.map((l) => ({
              kind: 'system',
              text: l.text,
              createdAt: shift(l.day) ?? base,
            })),
          },
        },
      });
    }

    for (const [materialName, quotes] of Object.entries(SEED_QUOTATIONS)) {
      const materialId = materialIdByName.get(materialName) ?? null;
      const task = await this.prisma.procTask.findFirst({
        where: { materialName },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      for (const q of quotes) {
        const supplier = await this.prisma.procSupplier.findFirst({
          where: { name: q.supplierName },
          select: { id: true },
        });
        await this.prisma.procQuotation.create({
          data: {
            taskId: task?.id ?? null,
            materialId,
            materialName,
            supplierId: supplier?.id ?? null,
            supplierName: q.supplierName,
            unitPrice: new Prisma.Decimal(q.unitPrice),
            leadTimeDays: q.leadTimeDays,
            quoteDate: shift(q.quoteDay) ?? base,
            isSelected: q.isSelected ?? false,
            createdBy: actor.id,
          },
        });
      }
    }

    const [tasks, materials, quotations] = await this.prisma.$transaction([
      this.prisma.procTask.count(),
      this.prisma.procMaterial.count(),
      this.prisma.procQuotation.count(),
    ]);
    return { skipped: false, tasks, materials, quotations };
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
