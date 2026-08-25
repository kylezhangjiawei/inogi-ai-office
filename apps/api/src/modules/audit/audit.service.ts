import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';

/**
 * 「能看全部人的留痕」按模块授权。
 *
 * 合并前每个留痕页各管一摊：研发管理员看研发池、page:proc-audit-log 看采购。
 * 合并成一个页面后若只留一份「看全部」名单，采购管理者会连研发留痕一起看到——
 * 那是合并带来的越权，不是需求。所以判定保留模块维度：各管理角色仍只看得到自己那摊，
 * 超级管理员（*）才是真正的全量。
 */
const VIEW_ALL_RULES: ReadonlyArray<{ permissions: readonly string[]; modules: readonly string[] }> = [
  {
    // 与合并前研发留痕页的 canReadAllAuditLogs 同口径
    permissions: ['rd-task:reassign', 'rd-project:direct', 'rd-project:review-l1', 'rd-project:review-l2', 'rd-people:manage'],
    modules: ['rd', 'us-collab', 'production'],
  },
  {
    // 补上采购：合并前 page:proc-audit-log 拿到即可看全部采购留痕，不补就等于砍了采购管理者的查询能力
    permissions: ['proc-task:reassign', 'rd-procurement:review'],
    modules: ['procurement'],
  },
];

const MAX_ACTION_FILTERS = 200;
const MAX_ACTOR_OPTIONS = 200;
/**
 * 「涉及对象 / 操作人数」这类去重统计的取数上限。
 *
 * distinct 查询不封顶的话，留痕攒到几十万行时会把整批去重结果拉进内存，只为求一个长度。
 * 概览数字超过这个量级已经没有阅读价值，到顶就显示 “N+”。
 */
const DISTINCT_STAT_CAP = 2000;
const DEFAULT_PAGE_SIZE = 25;

/** 「高风险」概览口径，与合并前研发留痕页顶部卡片保持一致。 */
const RISK_ACTIONS = ['proposal.rejected', 'task.reassigned', 'task.archived', 'flow.reset'] as const;

export type AuditViewer = {
  userId?: string;
  userName?: string;
  permissions: string[];
};

/** 该用户能「看全部人记录」的模块。'*' 代表不限模块。 */
export function auditViewAllModules(permissions: string[]): '*' | string[] {
  if (permissions.includes('*')) return '*';
  const modules = new Set<string>();
  for (const rule of VIEW_ALL_RULES) {
    if (rule.permissions.some((code) => permissions.includes(code))) {
      for (const item of rule.modules) modules.add(item);
    }
  }
  return [...modules];
}

/** 是否至少在一个模块里能看全部（页面据此决定要不要显示「操作人」筛选）。 */
export function canViewAllAuditLogs(permissions: string[]): boolean {
  const modules = auditViewAllModules(permissions);
  return modules === '*' || modules.length > 0;
}

type AuditLogRow = Prisma.AuditLogGetPayload<{
  include: { user: { select: { id: true; name: true; englishName: true; username: true } } };
}>;

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async listLogs(query: AuditLogQueryDto, viewer: AuditViewer) {
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const requestedPage = query.page ?? 1;
    const snapshotAt = this.resolveSnapshot(query.snapshotAt);
    const where = this.buildWhere(query, viewer, snapshotAt);

    const { total, page, rows } = await this.prisma.$transaction(
      async (tx) => {
        const snapshotTotal = await tx.auditLog.count({ where });
        const snapshotPage = Math.min(requestedPage, Math.max(1, Math.ceil(snapshotTotal / pageSize)));
        const direction: Prisma.SortOrder = query.sort === 'oldest' ? 'asc' : 'desc';
        const snapshotRows = await tx.auditLog.findMany({
          where,
          orderBy: [{ createdAt: direction }, { id: direction }],
          skip: (snapshotPage - 1) * pageSize,
          take: pageSize,
          include: {
            user: { select: { id: true, name: true, englishName: true, username: true } },
          },
        });
        return { total: snapshotTotal, page: snapshotPage, rows: snapshotRows };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );

    return {
      total,
      page,
      pageSize,
      snapshotAt: snapshotAt.toISOString(),
      canViewAll: canViewAllAuditLogs(viewer.permissions),
      // 不要时返回 null，让调用方明确知道「这次没算」而不是「算出来是 0」
      stats: query.withStats === false ? null : await this.buildStats(where),
      items: rows.map((row) => this.toItem(row)),
    };
  }

  /**
   * 概览数字。必须在服务端按当前筛选条件整体统计——合并前是前端拿全量日志自己算的，
   * 改成分页拉取后若沿用前端统计，卡片只会反映当前这一页，等于给了个错数。
   */
  private async buildStats(where: Prisma.AuditLogWhereInput) {
    const [actors, resources, aiCount, riskCount] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        distinct: ['userId', 'actorName'],
        select: { userId: true },
        take: DISTINCT_STAT_CAP,
      }),
      this.prisma.auditLog.findMany({
        where,
        distinct: ['resource', 'resourceId'],
        select: { resource: true },
        take: DISTINCT_STAT_CAP,
      }),
      this.prisma.auditLog.count({
        // 与前端 AUDIT_ACTION_META 的 ai 类目同口径：ai.* 动作码 + source=ai 的代执行
        where: { AND: [where, { OR: [{ source: 'ai' }, { action: { startsWith: 'ai.' } }] }] },
      }),
      this.prisma.auditLog.count({
        where: { AND: [where, { action: { in: [...RISK_ACTIONS] } }] },
      }),
    ]);
    return {
      uniqueActors: actors.length,
      uniqueResources: resources.length,
      // 到顶说明真实值还更大，前端据此显示 “N+”，不谎报成确切数字
      actorsCapped: actors.length >= DISTINCT_STAT_CAP,
      resourcesCapped: resources.length >= DISTINCT_STAT_CAP,
      aiCount,
      riskCount,
    };
  }

  /**
   * 筛选器选项（模块 / 操作人 / 动作 / 资源类型）及各自条数。
   * 只受可见范围与模块约束，不受其他筛选条件影响——否则选中一项后其余选项会互相抹掉。
   */
  async listFacets(viewer: AuditViewer, module?: string) {
    const where: Prisma.AuditLogWhereInput = module
      ? { AND: [this.scopeWhere(viewer), { module }] }
      : this.scopeWhere(viewer);
    const scopeOnly = this.scopeWhere(viewer);

    const [modules, actions, resources, actorRows] = await Promise.all([
      this.prisma.auditLog.groupBy({ by: ['module'], where: scopeOnly, _count: { _all: true } }),
      this.prisma.auditLog.groupBy({ by: ['action'], where, _count: { _all: true } }),
      this.prisma.auditLog.groupBy({ by: ['resource'], where, _count: { _all: true } }),
      this.prisma.auditLog.groupBy({
        by: ['userId', 'actorName'],
        where,
        _count: { _all: true },
      }),
    ]);

    const byCount = <T extends { _count: { _all: number } }>(a: T, b: T) => b._count._all - a._count._all;

    return {
      modules: modules.sort(byCount).map((row) => ({ value: row.module, count: row._count._all })),
      actions: actions.sort(byCount).map((row) => ({ value: row.action, count: row._count._all })),
      resources: resources.sort(byCount).map((row) => ({ value: row.resource, count: row._count._all })),
      actors: actorRows
        .sort(byCount)
        .map((row) => ({
          id: row.userId,
          name: row.actorName ?? '系统',
          count: row._count._all,
        }))
        .slice(0, MAX_ACTOR_OPTIONS),
    };
  }

  // ── 内部 ──────────────────────────────────────────────────────────────────

  private resolveSnapshot(raw?: string) {
    const now = new Date();
    if (!raw) return now;
    const parsed = new Date(raw);
    return !Number.isNaN(parsed.getTime()) && parsed < now ? parsed : now;
  }

  /**
   * 可见范围。无管理权限只看得到自己的操作：
   * userId 命中是主路径；账号被删过（userId 被 SetNull）的历史留痕靠姓名快照兜底，
   * 按精确姓名匹配 —— 宁可少认几条自己的旧记录，也不能把重名同事的操作算给别人看。
   */
  private scopeWhere(viewer: AuditViewer): Prisma.AuditLogWhereInput {
    const fullModules = auditViewAllModules(viewer.permissions);
    if (fullModules === '*') return {};

    const conditions: Prisma.AuditLogWhereInput[] = [];
    // 管得到的模块：该模块下所有人的记录都看得到
    if (fullModules.length > 0) conditions.push({ module: { in: fullModules } });
    // 管不到的模块：只看得到自己的
    if (viewer.userId) conditions.push({ userId: viewer.userId });
    if (viewer.userName) conditions.push({ userId: null, actorName: viewer.userName });
    // 既无管理模块，又无 id 和姓名：查不出任何东西，好过放行全表
    if (conditions.length === 0) return { id: '__no_audit_visibility__' };
    return { OR: conditions };
  }

  private buildWhere(query: AuditLogQueryDto, viewer: AuditViewer, snapshotAt: Date): Prisma.AuditLogWhereInput {
    const filters: Prisma.AuditLogWhereInput[] = [this.scopeWhere(viewer)];

    if (query.module) filters.push({ module: query.module });
    if (query.source) filters.push({ source: query.source });
    if (query.resource) filters.push({ resource: query.resource });
    if (query.resourceId) filters.push({ resourceId: query.resourceId });
    if (query.actorUserId) filters.push({ userId: query.actorUserId });

    const actions = (query.actions ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, MAX_ACTION_FILTERS);
    if (actions.length > 0) filters.push({ action: { in: actions } });

    const createdAt: Prisma.DateTimeFilter = { lte: snapshotAt };
    const from = query.dateFrom ? new Date(query.dateFrom) : null;
    const to = query.dateTo ? new Date(query.dateTo) : null;
    if (from && !Number.isNaN(from.getTime())) createdAt.gte = from;
    if (to && !Number.isNaN(to.getTime())) createdAt.lt = to;
    filters.push({ createdAt });

    const keyword = query.keyword;
    if (keyword) {
      const like = { contains: keyword, mode: Prisma.QueryMode.insensitive };
      filters.push({
        OR: [
          { summary: like },
          { action: like },
          { resourceName: like },
          { resourceId: like },
          { actorName: like },
          {
            user: {
              is: {
                OR: [{ name: like }, { englishName: like }, { username: like }],
              },
            },
          },
        ],
      });
    }

    return { AND: filters };
  }

  /** 输出结构与前端既有的 AuditLog 类型一一对应，页面渲染逻辑不用为合并改写。 */
  private toItem(row: AuditLogRow) {
    const meta = (row.meta ?? {}) as Record<string, unknown>;
    return {
      id: row.id,
      timestamp: row.createdAt.toISOString(),
      module: row.module,
      source: row.source,
      action: row.action,
      actor: {
        id: row.user?.id ?? null,
        name: row.user?.name || row.user?.englishName || row.user?.username || row.actorName || '系统',
        deleted: !row.user && Boolean(row.actorName),
      },
      resource: {
        type: row.resource,
        id: row.resourceId,
        name: row.resourceName,
      },
      changes: Array.isArray(meta.changes) ? meta.changes : [],
      comment: row.summary,
      metadata: (meta.metadata ?? {}) as Record<string, unknown>,
      notes: Array.isArray(row.notes) ? row.notes : [],
      ip: row.ip,
    };
  }
}
