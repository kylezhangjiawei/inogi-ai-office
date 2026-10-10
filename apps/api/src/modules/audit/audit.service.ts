import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';
import { rdTaskReadViewer } from '../research-development/rd-task-access';
import { isWorkspaceAllowed } from '../research-development/rd-workspace.context';

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
 * 操作人去重的取数上限。这个维度的基数就是账号数（几十到几百），正常永远到不了顶；
 * 上限只是防脏数据（actorName 千奇百怪）把整批结果拉进内存。到顶时显示 “N+”。
 *
 * 对象去重不走这条路 —— 它的基数与行数同量级，见 buildStats 里的 count 子查询。
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

function canViewMeetingAudit(viewer: AuditViewer): boolean {
  return Boolean(viewer.userId && rdTaskReadViewer(viewer).hasFullAccess && isWorkspaceAllowed('rd', viewer.permissions));
}

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

    // 统计只跟筛选条件走，翻页不必重算。指纹由服务端按「实际生效的筛选」算：
    // 交给前端自己维护的话，将来新增一个筛选维度却忘了并进指纹，统计就会静默不刷新。
    const filterSignature = this.filterSignature(query, viewer);
    const needStats = query.statsSignature !== filterSignature;

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
      filterSignature,
      // 不要时返回 null，让调用方明确知道「这次没算」而不是「算出来是 0」
      stats: needStats ? await this.buildStats(where, this.buildSqlWhere(query, viewer, snapshotAt)) : null,
      items: rows.map((row) => this.toItem(row)),
    };
  }

  /**
   * 概览数字。必须在服务端按当前筛选条件整体统计——合并前是前端拿全量日志自己算的，
   * 改成分页拉取后若沿用前端统计，卡片只会反映当前这一页，等于给了个错数。
   */
  private async buildStats(where: Prisma.AuditLogWhereInput, sqlWhere: Prisma.Sql) {
    const [actors, resources, aiCount, riskCount] = await Promise.all([
      // 操作人去重上限就是账号数（几十到几百），Prisma 的 distinct 足够，不值得再写一份 SQL
      this.prisma.auditLog.findMany({
        where,
        distinct: ['userId', 'actorName'],
        select: { userId: true },
        take: DISTINCT_STAT_CAP,
      }),
      // 对象去重与行数同量级（研发池实测 412 行 / 254 个对象），必须在库里数完只回传一个数
      this.prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*)::bigint AS count
        FROM (SELECT DISTINCT "resource", "resourceId" FROM "AuditLog" WHERE ${sqlWhere}) AS t
      `,
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
      uniqueResources: Number(resources[0]?.count ?? 0),
      // 操作人到顶说明真实值还更大，前端据此显示 “N+”；对象数是精确值，永不封顶
      actorsCapped: actors.length >= DISTINCT_STAT_CAP,
      aiCount,
      riskCount,
    };
  }

  /**
   * 筛选器选项（模块 / 操作人 / 动作 / 资源类型）及各自条数。
   * 只受可见范围与模块约束，不受其他筛选条件影响——否则选中一项后其余选项会互相抹掉。
   */
  async listFacets(viewer: AuditViewer, module?: string) {
    const scopeOnly = { AND: [this.scopeWhere(viewer), this.meetingAuditWhere(viewer)] };
    const where: Prisma.AuditLogWhereInput = module
      ? { AND: [scopeOnly, { module }] }
      : scopeOnly;

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

  /**
   * 当前筛选条件的指纹。snapshotAt 与 page/pageSize/sort 不参与 —— 它们不影响统计口径。
   * 可见范围也要进指纹：同一组筛选条件在不同人眼里命中的记录集不同。
   *
   * 取哈希而不是原文：指纹要由调用方回带，会出现在 URL 上，而 URL 会被 ApiRequestLog 记下来。
   * 原文里含操作人 id 与姓名，不该进查询串。
   */
  private filterSignature(query: AuditLogQueryDto, viewer: AuditViewer): string {
    const raw = JSON.stringify([
      query.module ?? '',
      query.source ?? '',
      query.resource ?? '',
      query.resourceId ?? '',
      query.actorUserId ?? '',
      this.parseActions(query.actions),
      query.dateFrom ?? '',
      query.dateTo ?? '',
      query.keyword ?? '',
      auditViewAllModules(viewer.permissions),
      canViewMeetingAudit(viewer),
      viewer.userId ?? '',
      viewer.userName ?? '',
    ]);
    return createHash('sha256').update(raw).digest('hex').slice(0, 16);
  }

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
    const filters: Prisma.AuditLogWhereInput[] = [this.scopeWhere(viewer), this.meetingAuditWhere(viewer)];

    if (query.module) filters.push({ module: query.module });
    if (query.source) filters.push({ source: query.source });
    if (query.resource) filters.push({ resource: query.resource });
    if (query.resourceId) filters.push({ resourceId: query.resourceId });
    if (query.actorUserId) filters.push({ userId: query.actorUserId });

    const actions = this.parseActions(query.actions);
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

  /** Private meeting contents stay private even in an administrator's old logs or raw API payloads. */
  private meetingAuditWhere(viewer: AuditViewer): Prisma.AuditLogWhereInput {
    if (canViewMeetingAudit(viewer)) return {};
    return { AND: [
      { resource: { notIn: ['meeting-todo', 'meeting-week'] } },
      { OR: [{ resource: { not: 'research-development' } }, { resourceId: null }, { resourceId: { not: 'meeting-todos' } }] },
    ] };
  }

  /**
   * buildWhere 的 SQL 版本，只服务于「涉及对象」的去重计数。
   *
   * 为什么要有第二份实现：去重对象数在真实分布下与行数同量级（研发池实测 412 行 / 254 个对象），
   * Prisma 拿不到 count(distinct)，只能 findMany + distinct 把整批结果拉进 Node 再数长度。
   * 换成 `count(*) FROM (SELECT DISTINCT …)` 只回传一个数，30 万行实测 36ms
   * （对比：materialize 78ms、count(DISTINCT (a,b)) 走排序要 1346ms）。
   *
   * ⚠️ 这里包含可见范围规则，与 buildWhere 必须逐条对齐 —— 两份实现挨在一起写、
   * 并由 audit-where-parity.spec.ts 用同一批 fixture 跑两条路径断言结果一致，防止改一处漏一处。
   */
  private buildSqlWhere(query: AuditLogQueryDto, viewer: AuditViewer, snapshotAt: Date): Prisma.Sql {
    const parts: Prisma.Sql[] = [this.scopeSqlWhere(viewer)];
    if (!canViewMeetingAudit(viewer)) {
      parts.push(Prisma.sql`("resource" NOT IN ('meeting-todo', 'meeting-week') AND
        ("resource" <> 'research-development' OR "resourceId" IS NULL OR "resourceId" <> 'meeting-todos'))`);
    }

    if (query.module) parts.push(Prisma.sql`"module" = ${query.module}`);
    if (query.source) parts.push(Prisma.sql`"source" = ${query.source}`);
    if (query.resource) parts.push(Prisma.sql`"resource" = ${query.resource}`);
    if (query.resourceId) parts.push(Prisma.sql`"resourceId" = ${query.resourceId}`);
    if (query.actorUserId) parts.push(Prisma.sql`"userId" = ${query.actorUserId}`);

    const actions = this.parseActions(query.actions);
    if (actions.length > 0) parts.push(Prisma.sql`"action" IN (${Prisma.join(actions)})`);

    parts.push(Prisma.sql`"createdAt" <= ${snapshotAt}`);
    const from = query.dateFrom ? new Date(query.dateFrom) : null;
    const to = query.dateTo ? new Date(query.dateTo) : null;
    if (from && !Number.isNaN(from.getTime())) parts.push(Prisma.sql`"createdAt" >= ${from}`);
    if (to && !Number.isNaN(to.getTime())) parts.push(Prisma.sql`"createdAt" < ${to}`);

    if (query.keyword) {
      // ILIKE 与 Prisma 的 mode:'insensitive' 同义；% 由参数携带，不做字符串拼接
      const like = `%${query.keyword}%`;
      parts.push(Prisma.sql`(
        "summary" ILIKE ${like} OR "action" ILIKE ${like} OR "resourceName" ILIKE ${like}
        OR "resourceId" ILIKE ${like} OR "actorName" ILIKE ${like}
        OR "userId" IN (
          SELECT "id" FROM "User"
          WHERE "name" ILIKE ${like} OR "englishName" ILIKE ${like} OR "username" ILIKE ${like}
        )
      )`);
    }

    return Prisma.join(parts, ' AND ');
  }

  /** scopeWhere 的 SQL 版本，逐条对应上面那份。 */
  private scopeSqlWhere(viewer: AuditViewer): Prisma.Sql {
    const fullModules = auditViewAllModules(viewer.permissions);
    if (fullModules === '*') return Prisma.sql`TRUE`;

    const conditions: Prisma.Sql[] = [];
    if (fullModules.length > 0) conditions.push(Prisma.sql`"module" IN (${Prisma.join(fullModules)})`);
    if (viewer.userId) conditions.push(Prisma.sql`"userId" = ${viewer.userId}`);
    if (viewer.userName) conditions.push(Prisma.sql`("userId" IS NULL AND "actorName" = ${viewer.userName})`);
    if (conditions.length === 0) return Prisma.sql`"id" = '__no_audit_visibility__'`;
    return Prisma.sql`(${Prisma.join(conditions, ' OR ')})`;
  }

  /** 动作码逗号列表 → 去空白去空项的数组。两份 where 实现共用，避免解析口径分叉。 */
  private parseActions(raw?: string): string[] {
    return (raw ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, MAX_ACTION_FILTERS);
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
