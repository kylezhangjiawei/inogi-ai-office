import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
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
  RollbackProcTaskDto,
  SetProcCoreMaterialsDto,
  SetProcTaskCriticalMaterialsDto,
  TransferFromRdDto,
  TransitionProcTaskDto,
  UpdateProcTaskTreeNodeDto,
  UpdateProcTaskDto,
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

function procurementPersonNameKey(value?: string | null): string {
  return (value ?? '').trim().replace(/[（(].*?[）)]/g, '').toLocaleLowerCase('zh-CN').replace(/\s+/g, '');
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

type ProcTaskView = Prisma.ProcTaskGetPayload<{ include: typeof PROC_TASK_VIEW_INCLUDE }>;
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
    if (query.rdTaskId) where.rdTaskId = query.rdTaskId;
    const canReviewRdTransfer = actor?.permissions.includes('*')
      || actor?.permissions.includes('rd-procurement:review');
    const canReadAllProcurementTasks = actor?.permissions.includes('*')
      || actor?.permissions.includes('page:proc-cockpit')
      || actor?.permissions.includes('page:proc-materials');
    const canReadOwnProcurementTasks = actor?.permissions.includes('page:proc-my-workspace');
    if (query.rdLink === 'true') {
      // 待研发审核仅允许原提交人或研发审核人通过研发任务关联查询读取。
      if (!canReviewRdTransfer) {
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

  /** 研发侧「转采购」：先进入研发管理员审核，通过后才进入采购侧。 */
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
    if (existing && existing.status !== 'cancelled') {
      return { ...this.serializeTask(existing), alreadyTransferred: true };
    }
    if (existing) {
      // 审核驳回（或取消）后的重新提交：更新需求内容、回到待处理重走审核，保留历史日志与旧附件。
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
          rdTaskTitle: rdTask.title,
          rdContact: rdContactName ?? existing.rdContact,
          rdContactUserId: rdContactUserId ?? existing.rdContactUserId,
          requester: actor.name,
          requesterUserId: actor.id,
          requesterDept,
          consumableNote: dto.consumableNote ?? existing.consumableNote,
          status: 'pending_rd_review',
          buyer: '',
          buyerUserId: null,
          cancelReason: null,
          ...(newAttachments.length
            ? { attachments: { create: newAttachments.map((a) => this.attachmentData(a, actor)) } }
            : {}),
          logs: {
            create: {
              kind: 'action',
              text: '研发修改后重新提交转采购，待研发管理员审核',
              fromStatus: 'cancelled',
              toStatus: 'pending_rd_review',
              actor: actor.name,
              actorUserId: actor.id,
            },
          },
        },
        include: PROC_TASK_VIEW_INCLUDE,
      });
      await this.notifyRdAdminsOfTransferReview(updated);
      return { ...this.serializeTask(updated), alreadyTransferred: false };
    }
    if (!dto.attachments?.length) {
      // 研发侧不强制校验业务字段，但必须带附件（图纸/说明），否则采购无从下手
      throw new BadRequestException('转采购需至少上传 1 个附件');
    }
    try {
      const created = await this.insertTask(dto, actor, {
        source: 'rd',
        status: 'pending_rd_review',
        rdTaskId,
        rdTaskTitle: rdTask.title,
        rdContact: rdContactName,
        rdContactUserId,
      });
      await this.notifyRdAdminsOfTransferReviewById(created.id);
      return created;
    } catch (error) {
      // 数据库唯一约束兜住并发双击/网络重试；若另一请求已成功，返回同一采购任务。
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const transferred = await this.prisma.procTask.findUnique({
          where: { rdTaskId },
          include: PROC_TASK_VIEW_INCLUDE,
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
    const awaitsRdReview = extra.source === 'rd' && extra.status === 'pending_rd_review';
    const requestedBuyer = awaitsRdReview ? '' : dto.buyer?.trim();
    const automaticBuyer = awaitsRdReview || requestedBuyer ? null : await this.pickAutomaticBuyer();
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
        attachments: { create: (dto.attachments ?? []).map((a) => this.attachmentData(a, actor)) },
        logs: {
          create: {
            kind: 'system',
            text:
              extra.source === 'rd'
                ? `由研发任务「${extra.rdTaskTitle ?? extra.rdTaskId ?? '-'}」提交转采购，待研发管理员审核`
                : `采购自建任务${automaticBuyer ? `；按当前负载自动分配给 ${automaticBuyer.name}` : ''}`,
            toStatus: extra.status,
            actor: actor.name,
            actorUserId: actor.id,
          },
        },
      },
      include: PROC_TASK_VIEW_INCLUDE,
    });
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
    const updated = await this.applyTransition(id, next, actor, '采购已确认接收');
    if (task.source === 'rd') {
      await this.notifyProcReviewResult(task, actor, 'approved', next);
    }
    return updated;
  }

  /** 研发管理员通过前置审核：此刻才给采购部门成员分配任务并进入采购待处理。 */
  async approveRdTransfer(id: string, actor: ProcActor) {
    const task = await this.requireTask(id);
    if (task.source !== 'rd' || task.status !== 'pending_rd_review') {
      throw new BadRequestException('仅「待研发审核」的转采购申请可审核通过');
    }
    const buyer = await this.pickAutomaticBuyer();
    if (!buyer) {
      throw new BadRequestException('采购部门暂无同时具备采购个人工作台权限的在职人员，请先配置人员与角色权限');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.procTask.updateMany({
        where: { id, source: 'rd', status: 'pending_rd_review' },
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
          text: `研发管理员审核通过，按当前负载分配给采购负责人 ${buyer.name}`,
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
    await this.notifyRdTransferReviewResult(task, actor, 'approved', '', buyer.name).catch((error) =>
      new Logger(ProcurementService.name).warn(`转采购通过结果通知失败（${task.code}）: ${(error as Error).message}`),
    );
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

  /** 研发前置审核通过后，明确通知实际采购负责人，避免任务只进入工作台却无人知晓。 */
  private async notifyBuyerOfRdTransferAssignment(
    task: ProcReviewNoticeTask,
    buyer: { id: string; name: string },
    actor: ProcActor,
  ) {
    await this.rdService.createMessage({
      source: 'procurement',
      sender: { id: actor.id, name: actor.name, role: '研发管理员' },
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
   * 已登记免费样品来货的供应商名集合。
   * 只能按名字匹配：采购单关联表上没有 supplierId，它与报价两侧共有的字段只有供应商名。
   */
  private async freeSampleSuppliers(taskId: string): Promise<Set<string>> {
    const refs = await this.prisma.procPurchaseOrderRef.findMany({
      where: { taskId, metadata: { path: ['freeSample'], equals: true } },
      select: { supplierName: true },
    });
    return new Set(refs.map((ref) => ref.supplierName.trim()).filter(Boolean));
  }

  /** 该任务是否登记过免费样品来货（不区分供应商）。 */
  private async hasFreeSampleArrival(taskId: string): Promise<boolean> {
    return (await this.freeSampleSuppliers(taskId)).size > 0;
  }

  /**
   * 选定报价后的去向：
   *   不需要打样                    → 已定价（原有行为）
   *   需打样 且 选定供应商都已寄样    → 测试中（跳过「待到样」）
   *   其余                          → 待到样（原有行为）
   *
   * 判据必须按供应商核对，不能只看「这个任务有没有免费样品」：手上是甲家的样、
   * 却选了乙家的报价时，乙家的样根本没到，跳过「待到样」等于跳过了本该做的收样确认。
   * 重新维护报价换供应商后再次选定，也走的是这条路。
   * 多家一起选时要求每家都已寄样：只要有一家没到，就还得等样。
   */
  private async nextAfterQuoteSelected(
    task: { id: string; needSample: boolean },
    selectedSuppliers: string[],
  ): Promise<ProcStatus> {
    if (!task.needSample) return 'priced';
    const arrived = await this.freeSampleSuppliers(task.id);
    const wanted = [...new Set(selectedSuppliers.map((name) => name.trim()).filter(Boolean))];
    const allArrived = wanted.length > 0 && wanted.every((name) => arrived.has(name));
    return allArrived ? 'testing' : 'pending_sample';
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
    const next = await this.nextAfterQuoteSelected(
      task,
      selected.map((row) => row.supplierName),
    );
    return this.applyTransition(
      taskId,
      next,
      actor,
      note?.trim()
        || `完成询价，进入「${PROC_STATUS_LABELS[next] ?? next}」（已确认 ${selected.length} 条报价）`,
    );
  }

  /**
   * 回退到流程中任意一个更早的节点。
   *
   * 与 transitionTask 的区别：那条路只走 PROC_STATUS_TRANSITIONS 允许的前进边，
   * 这条路专用于纠错，可以跨多个节点往回退，但绝不允许往前跳（rollbackTargetsOf 只返回更早的节点）。
   * 回退会连带清理目标状态下本不该存在的数据，否则任务会停在自相矛盾的状态里。
   */
  async rollbackTask(id: string, dto: RollbackProcTaskDto, actor: ProcActor) {
    const task = await this.requireTask(id);
    const current = task.status as ProcStatus;
    const target = dto.status as ProcStatus;

    if (PROC_ROLLBACK_BLOCKED_STATUSES.includes(current)) {
      throw new BadRequestException(
        current === 'pending_rd_review'
          ? '该申请尚待研发管理员审核，不在采购流程内，无法回退'
          : '已取消的任务不能回退，请重新发起采购申请',
      );
    }
    // 客户端拿的是过期数据时直接拒绝，理由同 transitionTask：
    // 用户看到的当前节点与实际不符，那他选的回退目标也未必是他真正想要的
    if (dto.from_status !== current) {
      throw new ConflictException(
        `任务已是「${PROC_STATUS_LABELS[current] ?? current}」，页面数据已过期，请刷新后再操作`,
      );
    }
    const targets = rollbackTargetsOf(current, task.method);
    if (!targets.includes(target)) {
      throw new BadRequestException(
        `不能从「${PROC_STATUS_LABELS[current] ?? current}」回退到「${
          PROC_STATUS_LABELS[target] ?? target
        }」：只能回退到当前流程中更早的节点`,
      );
    }

    const cleanup = rollbackCleanupFor(target);
    const updated = await this.prisma.$transaction(async (tx) => {
      // 条件更新占位：并发下别人可能刚推进了状态，那时这次回退的前提已不成立
      const claimed = await tx.procTask.updateMany({
        where: { id, status: current },
        data: {
          status: target,
          // 回退离开终态时必须撤掉完成标记，否则任务会以「已完成」的身份继续留在统计里
          businessDone: false,
          // 到货量记在任务上（由采购单的 receivedQty 汇总而来），退到下单之前必须归零，
          // 否则「待询价」的任务还挂着到货数量
          ...(cleanup.arrivals ? { arrivedQty: new Prisma.Decimal(0) } : {}),
          ...(cleanup.quotations
            ? {
                selectedQuotationId: null,
                quotationSubtotal: null,
                quotationDiscount: null,
                quotationTotal: null,
              }
            : {}),
        },
      });
      if (claimed.count !== 1) throw new ConflictException('任务状态已被其他操作更新，请刷新后重试');

      const cleared: string[] = [];
      if (cleanup.quotations) {
        const { count } = await tx.procQuotation.deleteMany({ where: { taskId: id } });
        if (count > 0) cleared.push(`${count} 条报价`);
      }
      if (cleanup.purchaseOrders) {
        // 免费样品登记保留：它记录的是「样品已到手」这个事实，与采购单无关，
        // 清掉会让退回询价后重新选报价时又要求多等一轮「待到样」。
        const { count } = await tx.procPurchaseOrderRef.deleteMany({
          where: { taskId: id, NOT: { metadata: { path: ['freeSample'], equals: true } } },
        });
        if (count > 0) cleared.push(`${count} 条采购单关联`);
      }

      await tx.procTaskLog.create({
        data: {
          taskId: id,
          kind: 'action',
          text: `回退到「${PROC_STATUS_LABELS[target] ?? target}」`
            + `${cleared.length > 0 ? `，已清理 ${cleared.join('、')}` : ''}`
            + `；原因：${dto.reason.trim()}`,
          fromStatus: current,
          toStatus: target,
          actor: actor.name,
          actorUserId: actor.id,
        },
      });
      return tx.procTask.findUniqueOrThrow({ where: { id }, include: PROC_TASK_VIEW_INCLUDE });
    });
    return this.serializeTask(updated);
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
    const target = dto.status as ProcStatus;
    const allowed = PROC_STATUS_TRANSITIONS[task.status as ProcStatus] ?? [];
    if (!allowed.includes(target)) {
      throw new BadRequestException(
        `不允许从「${PROC_STATUS_LABELS[task.status as ProcStatus] ?? task.status}」流转到「${
          PROC_STATUS_LABELS[target] ?? target
        }」`,
      );
    }
    // 「询价中 → 测试中」是样品提前到手的快捷路径，不是常规流转：静态表放行只是必要条件。
    // 没登记过免费样品就放行，等于允许绕过打样直接进测试。
    if (task.status === 'inquiring' && target === 'testing' && !(await this.hasFreeSampleArrival(id))) {
      throw new BadRequestException('该任务没有登记免费样品来货，不能跳过「待到样」');
    }
    return this.applyTransition(id, target, actor, dto.note);
  }

  private async applyTransition(id: string, next: ProcStatus, actor: ProcActor, note?: string) {
    const task = await this.prisma.procTask.findUniqueOrThrow({ where: { id } });
    const updated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.procTask.updateMany({
        where: { id, status: task.status },
        data: {
          status: next,
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
    });
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
    const deleted = await this.prisma.procTask.deleteMany({
      where: { id, source: 'rd', status: 'pending_confirm' },
    });
    if (deleted.count !== 1) throw new ConflictException('该任务已被其他审核人处理，请刷新后查看');
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
      include: PROC_TASK_VIEW_INCLUDE,
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

  async deleteTask(id: string) {
    const task = await this.requireTask(id);
    if (task.status === 'pending_rd_review') {
      throw new BadRequestException('该申请尚待研发管理员审核，请通过审核入口打回');
    }
    await this.prisma.procTask.delete({ where: { id } });
    return { ok: true };
  }

  async addAttachments(id: string, items: ProcAttachmentInputDto[], actor: ProcActor) {
    const task = await this.requireTask(id);
    if (task.status === 'pending_rd_review') {
      throw new BadRequestException('该申请尚待研发管理员审核，采购侧不能修改附件');
    }
    await this.prisma.procTaskAttachment.createMany({
      data: items.map((a) => ({ taskId: id, ...this.attachmentData(a, actor) })),
    });
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
    const next = await this.nextAfterQuoteSelected(task, [quotation.supplierName]);
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
      tpOrderNo: (item.tpOrderNo ?? '').trim(),
      isFreeSample: Boolean(item.isFreeSample),
    }));
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
    const nextStatus = task.status === 'priced' || task.status === 'pending_purchase' ? 'in_transit' : task.status;
    const isSampleOrder = task.status === 'pending_sample';
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
    }`;
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
          metadata: item.isFreeSample ? { freeSample: true } : {},
        })),
      });
      await tx.procTask.update({
        where: { id: taskId },
        data: {
          status: nextStatus,
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
    });
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
    // 免费样品行在 T+ 里没有单号，同步永远不会给它写 receivedQty；
    // 强制 delta=0 也正好兑现前端弹窗「已登记的到货数量不受影响」这句承诺。
    const delta = freeSample ? 0 : num(ref.receivedQty);
    const nextArrived = Math.max(0, num(task.arrivedQty) - delta);

    // 到货量被扣减后状态必须跟着降档，否则会造出「部分到货但到货量为 0」
    // 或「已完成但到货量不足」这种自相矛盾的行。
    let nextStatus = task.status as ProcStatus;
    if (delta > 0 && (task.status === 'partial_arrival' || task.status === 'completed')) {
      const quantity = num(task.quantity);
      if (nextArrived === 0) nextStatus = 'in_transit';
      else if (quantity > 0 && nextArrived < quantity) nextStatus = 'partial_arrival';
    }
    const leavingCompleted = task.status === 'completed' && nextStatus !== 'completed';

    // 预计到货是覆盖式写入且不留原值，只有「当前值与本条 ref 的日期完全相等」
    // 才能证明它是这条带来的；此时回落到剩余 ref 的最早日期，没有就清空。
    // 不清空的话，一个已无任何采购单的任务会继续被算进各页「本周到货」。
    const refEta = ref.etaDate;
    const ownsEta = refEta !== null && task.expectedArrivalDate?.getTime() === refEta.getTime();

    await this.prisma.$transaction(async (tx) => {
      await tx.procPurchaseOrderRef.deleteMany({ where: { id: refId, taskId } });

      const data: Prisma.ProcTaskUncheckedUpdateManyInput = {};
      if (delta > 0) data.arrivedQty = new Prisma.Decimal(nextArrived);
      if (nextStatus !== task.status) data.status = nextStatus;
      if (leavingCompleted) data.businessDone = false;
      if (ownsEta) {
        const rest = await tx.procPurchaseOrderRef.findMany({ where: { taskId }, select: { etaDate: true } });
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
        // 重复关联（同单同行两条 ref）时删掉一条不该释放镜像，剩余那条仍指着它
        const siblings = await tx.procPurchaseOrderRef.count({
          where: { taskId, tpOrderNo: ref.tpOrderNo, tpLineNo: ref.tpLineNo },
        });
        if (siblings === 0) {
          await tx.procPurchaseOrderMirror.updateMany({
            where: {
              tpOrderNo: ref.tpOrderNo,
              tpLineNo: ref.tpLineNo ?? '',
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
    });

    return this.getTask(taskId, actor);
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
   * 采购负责人候选按稳定部门编码 PURCHASING 和角色权限共同限定：
   * eligible 仅返回采购部门内、能打开采购个人工作台的在职账号；department 用于人员统计，
   * 会保留采购部门内缺权限账号并显式标记，避免“任务分到了人但本人打不开”。
   */
  async listBuyerCandidates(scope: 'eligible' | 'all' | 'department' = 'eligible') {
    const [users, roster, purchasingDepartmentName] = await Promise.all([
      this.prisma.user.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, name: true, department: true, role: { select: { permissions: true } } },
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

  private async getPurchasingDepartmentName(): Promise<string> {
    const department = await this.prisma.department.findUnique({
      where: { code: 'PURCHASING' },
      select: { name: true },
    });
    return department?.name.trim() || '采购部';
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
    const [entries, purchasingDepartmentName] = await Promise.all([
      this.readBuyerRosterEntries(),
      this.getPurchasingDepartmentName(),
    ]);
    const procurementUsers = await this.prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        department: purchasingDepartmentName,
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
          disabled: false,
          managedByDepartment: true,
          canReceiveTasks: permissions.includes('*') || permissions.includes('page:proc-my-workspace'),
        };
      }),
    };
  }

  async addBuyerRosterMember(userId: string) {
    const [user, purchasingDepartmentName] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, status: true, department: true } }),
      this.getPurchasingDepartmentName(),
    ]);
    if (!user || user.status !== 'ACTIVE' || user.department?.trim() !== purchasingDepartmentName) {
      throw new NotFoundException('仅可维护采购部门内的在职人员');
    }
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
    const [user, purchasingDepartmentName] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { department: true, status: true },
      }),
      this.getPurchasingDepartmentName(),
    ]);
    if (user?.status === 'ACTIVE' && user.department?.trim() === purchasingDepartmentName) {
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

  private serializeTask(
    task: ProcTaskView,
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
          fileUrl: (objectKey ? this.ossService.buildInlinePreviewUrl(objectKey) : null) ?? a.fileUrl,
          ...(thumbUrl ? { thumbUrl } : {}),
          fileSize: a.fileSize,
          mimeType: a.mimeType ?? undefined,
          kind: a.kind,
        };
      }),
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
        freeSample: (r.metadata as { freeSample?: boolean } | null)?.freeSample === true,
      })),
      criticalMaterials: task.criticalMaterials.map((item) => ({
        materialId: item.materialId,
        leadTimeDays: item.leadTimeDays ?? undefined,
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
      balances: {
        warehouse: string;
        stockQty: Prisma.Decimal | number;
        availableQty: Prisma.Decimal | number;
        inTransitQty: Prisma.Decimal | number;
        syncedAt: Date | null;
      }[];
    },
  ) {
    const stockQty = m.balances.reduce((sum, b) => sum + num(b.stockQty), 0);
    const availableQty = m.balances.reduce((sum, b) => sum + num(b.availableQty), 0);
    const inTransitQty = m.balances.reduce((sum, b) => sum + num(b.inTransitQty), 0);
    // stockQty 是各仓存量的累加值，详情页要能看清它由哪几个仓库、各多少构成。
    const warehouses = m.balances
      .map((b) => ({
        name: b.warehouse || '未指定仓库',
        stock: num(b.stockQty),
        available: num(b.availableQty),
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
