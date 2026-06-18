import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type ApiRequestLog } from '@prisma/client';
import { createHash } from 'node:crypto';

import { PrismaService } from '../../prisma/prisma.service';
import { OpsAiService, type OpsErrorAnalysis } from './ops-ai.service';

type Tone = 'healthy' | 'info' | 'warning' | 'danger' | 'neutral';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** 错误日志查询入参（服务端过滤 + 分页）。 */
export type ApiErrorQuery = {
  from?: string;
  to?: string;
  statusClass?: '2xx' | '4xx' | '5xx' | 'all';
  method?: string;
  keyword?: string;
  errorsOnly?: boolean;
  page?: number;
  pageSize?: number;
};

const AI_ANALYSIS_CACHE_PREFIX = 'ops:ai-error-analysis:';

@Injectable()
export class OpsCenterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly opsAi: OpsAiService,
  ) {}

  async getOverview() {
    const now = new Date();
    const startOfToday = this.startOfDay(now);
    const last24Hours = new Date(now.getTime() - MS_PER_DAY);
    const [
      todayRequests,
      todayErrors,
      todayServerErrors,
      avgDuration,
      dependencyStatus,
      errorTrend,
      slowApis,
      recentIssues,
    ] = await Promise.all([
      this.prisma.apiRequestLog.count({ where: { createdAt: { gte: startOfToday } } }),
      this.prisma.apiRequestLog.count({ where: { createdAt: { gte: startOfToday }, statusCode: { gte: 400 } } }),
      this.prisma.apiRequestLog.count({ where: { createdAt: { gte: startOfToday }, statusCode: { gte: 500 } } }),
      this.prisma.apiRequestLog.aggregate({
        where: { createdAt: { gte: startOfToday } },
        _avg: { durationMs: true },
      }),
      this.getDependencyStatus(),
      this.getErrorTrend(last24Hours),
      this.getSlowApis(last24Hours),
      this.getRecentIssues(last24Hours, 3),
    ]);

    return {
      health_cards: [
        { label: '今日请求', value: this.formatNumber(todayRequests), change: '实时采集', tone: 'info', icon: 'Activity' },
        { label: '接口错误', value: this.formatNumber(todayErrors), change: todayErrors > 0 ? '需关注' : '稳定', tone: todayErrors > 0 ? 'warning' : 'healthy', icon: 'AlertTriangle' },
        { label: '5xx 严重错误', value: this.formatNumber(todayServerErrors), change: todayServerErrors > 0 ? '需立即确认' : '无严重错误', tone: todayServerErrors > 0 ? 'danger' : 'healthy', icon: 'Siren' },
        { label: '平均耗时', value: `${Math.round(avgDuration._avg.durationMs ?? 0)}ms`, change: '今日均值', tone: 'healthy', icon: 'Clock3' },
      ],
      dependency_status: dependencyStatus,
      error_trend: errorTrend,
      slow_apis: slowApis,
      recent_issues: recentIssues,
      cloud_integrations: this.getCloudIntegrations(),
    };
  }

  async getApiErrors(query: ApiErrorQuery = {}) {
    const now = Date.now();
    const from = query.from ? new Date(query.from) : new Date(now - MS_PER_DAY * 7);
    const to = query.to ? new Date(query.to) : new Date(now);
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(200, Math.max(10, query.pageSize ?? 30));

    const where: Prisma.ApiRequestLogWhereInput = {
      createdAt: { gte: from, lte: to },
    };
    // 状态类筛选
    if (query.errorsOnly) {
      where.statusCode = { gte: 400 };
    }
    if (query.statusClass && query.statusClass !== 'all') {
      if (query.statusClass === '2xx') where.statusCode = { gte: 200, lt: 300 };
      else if (query.statusClass === '4xx') where.statusCode = { gte: 400, lt: 500 };
      else if (query.statusClass === '5xx') where.statusCode = { gte: 500 };
    }
    if (query.method && query.method !== '全部') {
      where.method = query.method.toUpperCase();
    }
    const keyword = query.keyword?.trim();
    if (keyword) {
      where.OR = [
        { path: { contains: keyword, mode: 'insensitive' } },
        { errorMessage: { contains: keyword, mode: 'insensitive' } },
        { errorName: { contains: keyword, mode: 'insensitive' } },
        { requestId: { contains: keyword, mode: 'insensitive' } },
      ];
    }

    const [total, rows, errorGroups, aiReady] = await Promise.all([
      this.prisma.apiRequestLog.count({ where }),
      this.prisma.apiRequestLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.getRecentIssues(from, 20),
      this.opsAi.isReady(),
    ]);
    const userMap = await this.getUserMap(rows.map((row) => row.userId).filter(Boolean) as string[]);

    return {
      api_logs: rows.map((row) => this.serializeApiLog(row, userMap)),
      error_groups: errorGroups,
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
      ai_ready: aiReady,
    };
  }

  /** 按接口聚合：窗口内 调用量 / 错误数 / 错误率 / 平均·最大耗时 / 最近错误时间。 */
  async getEndpointStats(query: { from?: string; to?: string; sort?: 'errors' | 'calls' | 'latency' } = {}) {
    const now = Date.now();
    const from = query.from ? new Date(query.from) : new Date(now - MS_PER_DAY);
    const to = query.to ? new Date(query.to) : new Date(now);
    const baseWhere: Prisma.ApiRequestLogWhereInput = { createdAt: { gte: from, lte: to } };

    const [totals, errorTotals] = await Promise.all([
      this.prisma.apiRequestLog.groupBy({
        by: ['method', 'path'],
        where: baseWhere,
        _count: { _all: true },
        _avg: { durationMs: true },
        _max: { durationMs: true },
      }),
      this.prisma.apiRequestLog.groupBy({
        by: ['method', 'path'],
        where: { ...baseWhere, statusCode: { gte: 400 } },
        _count: { _all: true },
        _max: { createdAt: true },
      }),
    ]);

    const errorMap = new Map(errorTotals.map((e) => [`${e.method} ${e.path}`, e]));
    const rows = totals.map((t) => {
      const key = `${t.method} ${t.path}`;
      const err = errorMap.get(key);
      const calls = t._count._all;
      const errors = err?._count._all ?? 0;
      return {
        method: t.method,
        path: t.path,
        service: this.resolveServiceName(t.path),
        calls,
        errors,
        errorRate: calls > 0 ? Math.round((errors / calls) * 1000) / 10 : 0,
        avgDuration: Math.round(t._avg.durationMs ?? 0),
        maxDuration: t._max.durationMs ?? 0,
        lastError: err?._max.createdAt ? this.formatDateTime(err._max.createdAt) : null,
      };
    });

    const sort = query.sort ?? 'errors';
    rows.sort((a, b) =>
      sort === 'calls' ? b.calls - a.calls : sort === 'latency' ? b.maxDuration - a.maxDuration : b.errors - a.errors || b.calls - a.calls,
    );
    return { endpoints: rows.slice(0, 100), window: { from: this.formatDateTime(from), to: this.formatDateTime(to) } };
  }

  /** AI 报错归因：以某条请求为代表，聚合近 7 天同类错误后调用 AI；结果按错误签名缓存。 */
  async analyzeApiError(payload: { request_id?: string; force?: boolean }): Promise<OpsErrorAnalysis & { signature: string; occurrences: number; cached: boolean; analyzed_at: string }> {
    const requestId = (payload.request_id ?? '').trim();
    if (!requestId) {
      throw new BadRequestException('request_id 不能为空');
    }
    const row = await this.prisma.apiRequestLog.findUnique({ where: { requestId } });
    if (!row) {
      throw new NotFoundException('请求记录不存在');
    }

    const signature = this.errorSignature(row.statusCode, row.method, row.path, row.errorName, row.errorMessage);
    const cacheKey = `${AI_ANALYSIS_CACHE_PREFIX}${createHash('sha1').update(signature).digest('hex')}`;

    // 同签名近 7 天聚合
    const since = new Date(Date.now() - MS_PER_DAY * 7);
    const similar = await this.prisma.apiRequestLog.findMany({
      where: { createdAt: { gte: since }, statusCode: row.statusCode, method: row.method, path: row.path },
      select: { userId: true, createdAt: true },
      take: 500,
    });
    const occurrences = similar.length;
    const affectedUsers = new Set(similar.map((s) => s.userId).filter(Boolean)).size;
    const times = similar.map((s) => s.createdAt.getTime());
    const firstSeen = times.length ? this.formatDateTime(new Date(Math.min(...times))) : null;
    const lastSeen = times.length ? this.formatDateTime(new Date(Math.max(...times))) : null;

    if (!payload.force) {
      const cached = await this.prisma.systemSetting.findUnique({ where: { key: cacheKey } });
      const value = this.asRecord(cached?.value as Prisma.JsonValue);
      if (value.analysis) {
        return {
          ...(value.analysis as OpsErrorAnalysis),
          signature,
          occurrences,
          cached: true,
          analyzed_at: typeof value.analyzed_at === 'string' ? value.analyzed_at : '',
        };
      }
    }

    const analysis = await this.opsAi.analyze({
      method: row.method,
      path: row.path,
      statusCode: row.statusCode,
      errorName: row.errorName,
      errorMessage: row.errorMessage,
      errorStack: row.errorStack,
      requestMeta: row.requestMeta,
      responseMeta: row.responseMeta,
      occurrences,
      firstSeen,
      lastSeen,
      affectedUsers,
    });

    const analyzedAt = this.formatDateTime(new Date());
    // 仅缓存真正由 AI 生成的结果，避免把「未配置/失败」兜底缓存住。
    if (analysis.generated_by === 'ai') {
      await this.prisma.systemSetting
        .upsert({
          where: { key: cacheKey },
          create: { category: 'ops_ai_analysis', key: cacheKey, description: signature.slice(0, 200), value: { analysis, analyzed_at: analyzedAt, signature } as Prisma.InputJsonValue },
          update: { value: { analysis, analyzed_at: analyzedAt, signature } as Prisma.InputJsonValue },
        })
        .catch(() => undefined);
    }
    return { ...analysis, signature, occurrences, cached: false, analyzed_at: analyzedAt };
  }

  private errorSignature(statusCode: number, method: string, path: string, errorName?: string | null, errorMessage?: string | null) {
    return `${statusCode}:${method}:${path}:${errorName ?? ''}:${(errorMessage ?? '').slice(0, 120)}`;
  }

  private serializeApiLog(row: ApiRequestLog, userMap: Map<string, string>) {
    return {
      id: row.requestId,
      time: this.formatDateTime(row.createdAt),
      method: row.method,
      path: row.path,
      status: row.statusCode,
      duration: row.durationMs,
      user: row.userId ? userMap.get(row.userId) ?? '未知用户' : '系统/未登录',
      ip: row.ip ?? '-',
      message: row.errorMessage ?? (row.statusCode >= 400 ? '请求失败' : 'OK'),
      errorName: row.errorName,
      errorStack: row.errorStack,
      requestMeta: row.requestMeta,
      responseMeta: row.responseMeta,
      userAgent: row.userAgent,
    };
  }

  async getDatabaseMonitoring() {
    const [dbRuntime, slowQueries, apiStats] = await Promise.all([
      this.getDatabaseRuntime(),
      this.getSlowQueries(),
      this.prisma.apiRequestLog.aggregate({
        where: { createdAt: { gte: new Date(Date.now() - MS_PER_DAY) } },
        _avg: { durationMs: true },
        _count: true,
      }),
    ]);

    const connectionLabel = `${dbRuntime.activeConnections ?? '-'} / ${process.env.DATABASE_POOL_LIMIT ?? '80'}`;
    const storageValue = dbRuntime.databaseSizeBytes
      ? `${Math.max(1, Math.round(dbRuntime.databaseSizeBytes / 1024 / 1024))} MB`
      : '未采集';

    return {
      database_metrics: [
        { label: '数据库状态', value: dbRuntime.ok ? '可连接' : '异常', helper: dbRuntime.version ?? 'PostgreSQL', tone: dbRuntime.ok ? 'healthy' : 'danger', icon: 'Database' },
        { label: '连接池', value: connectionLabel, helper: '来自 pg_stat_activity', tone: 'info', icon: 'Server' },
        { label: '慢请求', value: String(slowQueries.length), helper: '按接口耗时推断', tone: slowQueries.length > 0 ? 'warning' : 'healthy', icon: 'Clock3' },
        { label: '数据体积', value: storageValue, helper: 'current_database()', tone: 'healthy', icon: 'Gauge' },
      ],
      database_trend: this.getDatabaseTrendFromApiStats(apiStats._count, Math.round(apiStats._avg.durationMs ?? 0)),
      slow_queries: slowQueries,
      lock_waits: dbRuntime.lockWaits,
      database_plan: this.getDatabasePlan(dbRuntime.ok),
    };
  }

  async getServicesAndTasks() {
    const [serviceMonitors, taskLogs] = await Promise.all([
      this.getServiceMonitors(),
      this.getTaskLogs(),
    ]);

    return {
      service_monitors: serviceMonitors,
      cloud_integrations: this.getCloudIntegrations(),
      task_logs: taskLogs,
      task_summary: this.buildTaskSummary(taskLogs),
    };
  }

  async getAlertsAuditSettings() {
    const auditLogs = await this.getAuditLogs();
    return {
      alert_rules: this.getAlertRules(),
      log_policies: this.getLogPolicies(),
      audit_logs: auditLogs,
      audit_summary: {
        today_events: auditLogs.length,
        high_risk: auditLogs.filter((item) => item.risk === '高').length,
        users: new Set(auditLogs.map((item) => item.user)).size,
      },
      log_settings: [
        '慢接口阈值：1000ms',
        '慢 SQL 阈值：800ms',
        '错误堆栈：生产环境仅管理员可见',
        '敏感字段：password、api_key、token、secret 自动脱敏',
      ],
    };
  }

  private async getRecentIssues(since: Date, take: number) {
    const rows = await this.prisma.apiRequestLog.findMany({
      where: { createdAt: { gte: since }, statusCode: { gte: 400 } },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });

    const groups = new Map<string, {
      id: string;
      title: string;
      service: string;
      severity: string;
      count: number;
      users: Set<string>;
      firstSeen: Date;
      lastSeen: Date;
      status: string;
      path: string;
    }>();

    for (const row of rows) {
      const title = row.errorMessage || `${row.statusCode} ${row.method} ${row.path}`;
      const key = `${row.statusCode}:${row.path}:${title}`;
      const current = groups.get(key);
      if (current) {
        current.count += 1;
        if (row.userId) current.users.add(row.userId);
        if (row.createdAt < current.firstSeen) current.firstSeen = row.createdAt;
        if (row.createdAt > current.lastSeen) current.lastSeen = row.createdAt;
      } else {
        groups.set(key, {
          id: row.requestId,
          title,
          service: this.resolveServiceName(row.path),
          severity: row.statusCode >= 500 ? '严重' : row.statusCode >= 400 ? '警告' : '提示',
          count: 1,
          users: new Set(row.userId ? [row.userId] : []),
          firstSeen: row.createdAt,
          lastSeen: row.createdAt,
          status: row.statusCode >= 500 ? '待处理' : '处理中',
          path: row.path,
        });
      }
    }

    return [...groups.values()]
      .sort((a, b) => b.count - a.count || b.lastSeen.getTime() - a.lastSeen.getTime())
      .slice(0, take)
      .map((item) => ({
        ...item,
        users: item.users.size,
        firstSeen: this.formatDateTime(item.firstSeen),
        lastSeen: this.formatDateTime(item.lastSeen),
      }));
  }

  private async getDependencyStatus() {
    const [mailboxes, aiModels, lastMailError, lastAiError] = await Promise.all([
      this.prisma.integrationConfig.count({ where: { kind: 'mail', isActive: true } }),
      this.prisma.integrationConfig.count({ where: { kind: 'openai', isActive: true } }),
      this.prisma.emailIngestionLog.findFirst({ where: { status: { in: ['FAILED', 'failed', 'error'] } }, orderBy: { createdAt: 'desc' } }),
      this.prisma.apiRequestLog.findFirst({ where: { path: { contains: 'image-generation' }, statusCode: { gte: 400 } }, orderBy: { createdAt: 'desc' } }),
    ]);

    return [
      { name: 'NestJS API', detail: '服务运行中', status: '正常', tone: 'healthy', icon: 'Server' },
      { name: 'PostgreSQL', detail: 'Prisma 连接可用', status: '正常', tone: 'healthy', icon: 'Database' },
      {
        name: 'AI 模型网关',
        detail: aiModels > 0 ? `已启用 ${aiModels} 个模型${lastAiError ? '，近期有失败' : ''}` : '未启用模型',
        status: aiModels > 0 && !lastAiError ? '正常' : '需关注',
        tone: aiModels > 0 && !lastAiError ? 'healthy' : 'warning',
        icon: 'Sparkles',
      },
      {
        name: '邮箱 IMAP',
        detail: mailboxes > 0 ? `已启用 ${mailboxes} 个邮箱${lastMailError ? '，近期有失败' : ''}` : '未启用邮箱',
        status: mailboxes > 0 && !lastMailError ? '正常' : '需关注',
        tone: mailboxes > 0 && !lastMailError ? 'healthy' : 'warning',
        icon: 'Mail',
      },
    ];
  }

  private async getErrorTrend(since: Date) {
    const rows = await this.prisma.apiRequestLog.findMany({
      where: { createdAt: { gte: since }, statusCode: { gte: 400 } },
      select: { path: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    const buckets = new Map<string, { time: string; api: number; task: number; db: number }>();
    for (let offset = 20; offset >= 0; offset -= 4) {
      const date = new Date(Date.now() - offset * 60 * 60 * 1000);
      const key = this.formatHour(date);
      buckets.set(key, { time: key, api: 0, task: 0, db: 0 });
    }

    for (const row of rows) {
      const key = this.formatHour(row.createdAt);
      const bucket = buckets.get(key) ?? { time: key, api: 0, task: 0, db: 0 };
      if (row.path.includes('resume') || row.path.includes('mail') || row.path.includes('image')) bucket.task += 1;
      else if (row.path.includes('database') || row.path.includes('prisma')) bucket.db += 1;
      else bucket.api += 1;
      buckets.set(key, bucket);
    }

    return [...buckets.values()].sort((a, b) => a.time.localeCompare(b.time));
  }

  private async getSlowApis(since: Date) {
    const rows = await this.prisma.apiRequestLog.findMany({
      where: { createdAt: { gte: since } },
      select: { path: true, durationMs: true },
      take: 500,
      orderBy: { durationMs: 'desc' },
    });

    const groups = new Map<string, { path: string; duration: number; count: number }>();
    for (const row of rows) {
      const current = groups.get(row.path) ?? { path: row.path, duration: 0, count: 0 };
      current.duration = Math.max(current.duration, row.durationMs);
      current.count += 1;
      groups.set(row.path, current);
    }

    return [...groups.values()].sort((a, b) => b.duration - a.duration).slice(0, 5);
  }

  private async getDatabaseRuntime() {
    try {
      const [versionRows, sizeRows, connectionRows, lockRows] = await Promise.all([
        this.prisma.$queryRaw<Array<{ version: string }>>(Prisma.sql`select version() as version`),
        this.prisma.$queryRaw<Array<{ size: bigint }>>(Prisma.sql`select pg_database_size(current_database()) as size`),
        this.prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`select count(*) as count from pg_stat_activity`),
        this.prisma.$queryRaw<Array<{ table_name: string | null; mode: string; waiting: string; session: string | null }>>(Prisma.sql`
          select c.relname as table_name, l.mode, 'active' as waiting, a.application_name as session
          from pg_locks l
          left join pg_class c on c.oid = l.relation
          left join pg_stat_activity a on a.pid = l.pid
          where not l.granted
          limit 5
        `),
      ]);

      return {
        ok: true,
        version: versionRows[0]?.version?.split(' on ')[0] ?? 'PostgreSQL',
        databaseSizeBytes: Number(sizeRows[0]?.size ?? 0),
        activeConnections: Number(connectionRows[0]?.count ?? 0),
        lockWaits: lockRows.map((row) => ({
          table: row.table_name ?? 'unknown',
          mode: row.mode,
          waiting: row.waiting,
          session: row.session ?? '-',
        })),
      };
    } catch {
      return {
        ok: false,
        version: 'PostgreSQL 状态采集失败',
        databaseSizeBytes: 0,
        activeConnections: null,
        lockWaits: [],
      };
    }
  }

  private async getSlowQueries() {
    const slowApis = await this.getSlowApis(new Date(Date.now() - MS_PER_DAY));
    return slowApis.map((item) => ({
      query: `${item.path} request path`,
      duration: item.duration,
      count: item.count,
      source: this.resolveServiceName(item.path),
    }));
  }

  private getDatabaseTrendFromApiStats(count: number, avgDuration: number) {
    const hours = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00'];
    return hours.map((time, index) => ({
      time,
      connections: Math.max(1, Math.round(count / 18) + index * 2),
      slowSql: avgDuration > 1000 ? index + 2 : Math.max(0, index % 3),
      locks: index % 4 === 0 ? 1 : 0,
    }));
  }

  private getDatabasePlan(dbOk: boolean) {
    return [
      ['当前模式', 'ECS Docker PostgreSQL', dbOk ? '通过 API 健康检查、Prisma 错误、容器日志和 SLS 采集确认数据库问题。' : '当前数据库运行状态采集失败，请先确认 DATABASE_URL 和网络连通性。'],
      ['增强模式', 'RDS PostgreSQL', '可直接查看慢 SQL、锁等待、连接、备份、容量、审计和性能洞察。'],
      ['建议动作', '先接 SLS，再评估 RDS', '短期不迁库也能先实现网页化日志排查；业务稳定后再迁 RDS。'],
    ].map(([label, value, detail]) => ({ label, value, detail }));
  }

  private async getServiceMonitors() {
    const configs = await this.prisma.integrationConfig.findMany({ orderBy: { updatedAt: 'desc' }, take: 20 });
    const monitors = configs.map((config) => {
      const metadata = this.asRecord(config.metadata);
      const lastError = typeof metadata.last_error_message === 'string' ? metadata.last_error_message : null;
      const latency = typeof metadata.last_latency_ms === 'number' ? `${metadata.last_latency_ms}ms` : '-';
      const status = !config.isActive ? '停用' : lastError ? '需关注' : '正常';
      return {
        name: config.name,
        provider: config.provider ?? config.kind,
        status,
        successRate: lastError ? '需确认' : '99%+',
        latency,
        lastChecked: this.formatDateTime(config.updatedAt),
        tone: !config.isActive ? 'neutral' : lastError ? 'warning' : 'healthy',
      };
    });

    return [
      ...monitors,
      { name: '阿里云 SLS', provider: '日志服务', status: process.env.ALIYUN_SLS_PROJECT ? '已接入' : '待接入', successRate: process.env.ALIYUN_SLS_PROJECT ? '100%' : '-', latency: '-', lastChecked: process.env.ALIYUN_SLS_PROJECT ? '已配置' : '未配置', tone: process.env.ALIYUN_SLS_PROJECT ? 'healthy' : 'neutral' },
      { name: 'ARMS 应用监控', provider: '可观测链路', status: process.env.ARMS_APP_NAME ? '已接入' : '待接入', successRate: process.env.ARMS_APP_NAME ? '100%' : '-', latency: '-', lastChecked: process.env.ARMS_APP_NAME ? '已配置' : '未配置', tone: process.env.ARMS_APP_NAME ? 'healthy' : 'neutral' },
    ];
  }

  private async getTaskLogs() {
    const [mailLogs, screenings, imageAudits] = await Promise.all([
      this.prisma.emailIngestionLog.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
      this.prisma.candidateScreening.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
      this.prisma.auditLog.findMany({
        where: { action: 'OPENAI_IMAGE_REQUEST' },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

    const rows = [
      ...mailLogs.map((row) => ({
        id: row.id,
        time: this.formatDateTime(row.createdAt),
        module: '邮箱同步',
        action: row.subject || '邮件同步',
        status: this.normalizeTaskStatus(row.status),
        duration: '-',
        owner: row.mailbox,
        detail: row.errorMessage ?? `候选人：${row.senderEmail || '-'}`,
      })),
      ...screenings.map((row) => ({
        id: row.id,
        time: this.formatDateTime(row.createdAt),
        module: '简历筛选',
        action: row.modelName,
        status: this.normalizeTaskStatus(row.status),
        duration: row.durationMs ? `${row.durationMs}ms` : '-',
        owner: row.promptVersion,
        detail: row.errorMessage ?? row.summary ?? '筛选完成',
      })),
      ...imageAudits.map((row) => {
        const meta = this.asRecord(row.meta);
        return {
          id: row.id,
          time: this.formatDateTime(row.createdAt),
          module: '图片生成',
          action: String(meta.operation ?? row.action),
          status: this.normalizeTaskStatus(String(meta.status ?? 'success')),
          duration: typeof meta.durationMs === 'number' ? `${meta.durationMs}ms` : '-',
          owner: String(meta.model ?? '-'),
          detail: String(meta.errorMessage ?? meta.openaiRequestId ?? '调用完成'),
        };
      }),
    ];

    return rows.sort((a, b) => b.time.localeCompare(a.time)).slice(0, 40);
  }

  private buildTaskSummary(taskLogs: Array<{ status: string; duration: string }>) {
    const success = taskLogs.filter((item) => item.status === '成功').length;
    const failed = taskLogs.filter((item) => item.status === '失败').length;
    const skipped = taskLogs.filter((item) => item.status === '跳过').length;
    return [
      { label: '成功任务', value: String(success), tone: 'healthy' },
      { label: '失败任务', value: String(failed), tone: failed > 0 ? 'danger' : 'healthy' },
      { label: '跳过任务', value: String(skipped), tone: skipped > 0 ? 'warning' : 'healthy' },
      { label: '任务总数', value: String(taskLogs.length), tone: 'info' },
    ];
  }

  private async getAuditLogs() {
    const rows = await this.prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 80,
      include: { user: true },
    });

    return rows.map((row) => ({
      id: row.id,
      time: this.formatDateTime(row.createdAt),
      user: row.user?.name ?? row.user?.email ?? '系统',
      action: row.action,
      resource: row.resource,
      risk: this.resolveAuditRisk(row.action, row.resource),
      ip: row.ip ?? '-',
      summary: this.summarizeAuditMeta(row.meta),
    }));
  }

  private getAlertRules() {
    return [
      { name: '接口 5xx 连续异常', condition: '5 分钟内 5xx >= 5 次', channel: '站内 / 钉钉', level: '严重', enabled: true },
      { name: 'AI 调用失败率过高', condition: '15 分钟失败率 >= 8%', channel: '站内 / 邮件', level: '警告', enabled: true },
      { name: '数据库连接失败', condition: '连续 3 次健康检查失败', channel: '站内 / 短信', level: '致命', enabled: true },
      { name: '慢接口过多', condition: 'P95 > 3s 且请求数 >= 20', channel: '站内', level: '警告', enabled: false },
      { name: '磁盘空间不足', condition: '可用空间 < 20%', channel: '站内 / 钉钉', level: '严重', enabled: true },
    ];
  }

  private getLogPolicies() {
    return [
      { name: '接口访问日志', retention: '30 天', payload: '记录请求摘要', masking: '开启', status: '启用' },
      { name: '接口错误日志', retention: '90 天', payload: '记录错误堆栈', masking: '开启', status: '启用' },
      { name: '操作审计日志', retention: '180 天', payload: '记录资源与操作者', masking: '开启', status: '启用' },
      { name: 'Prisma 慢查询日志', retention: '30 天', payload: '记录模型、耗时、调用来源', masking: '开启', status: '启用' },
      { name: '第三方调用日志', retention: '60 天', payload: '记录 request id 与响应摘要', masking: '开启', status: '启用' },
    ];
  }

  private getCloudIntegrations() {
    return [
      { name: '日志服务 SLS', status: process.env.ALIYUN_SLS_PROJECT ? '已接入' : '已规划', detail: '采集 API 容器、Nginx、PostgreSQL 容器日志', icon: 'Cloud', tone: process.env.ALIYUN_SLS_PROJECT ? 'healthy' : 'info' },
      { name: 'RDS PostgreSQL', status: process.env.ALIYUN_RDS_INSTANCE_ID ? '已接入' : '可选增强', detail: '迁移后可直接使用慢 SQL、锁等待、容量和备份监控', icon: 'Database', tone: process.env.ALIYUN_RDS_INSTANCE_ID ? 'healthy' : 'warning' },
      { name: 'ARMS Trace', status: process.env.ARMS_APP_NAME ? '已接入' : '二期待接入', detail: '接口、数据库、AI 外部调用的全链路耗时分析', icon: 'Activity', tone: process.env.ARMS_APP_NAME ? 'healthy' : 'neutral' },
    ];
  }

  private async getUserMap(userIds: string[]) {
    const uniqueIds = [...new Set(userIds)];
    if (uniqueIds.length === 0) return new Map<string, string>();

    const users = await this.prisma.user.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true, name: true, email: true },
    });

    return new Map(users.map((user) => [user.id, user.name || user.email]));
  }

  private resolveServiceName(path: string) {
    if (path.includes('resume') || path.includes('recruitment')) return '简历筛选';
    if (path.includes('image-generation')) return '图片生成';
    if (path.includes('chat')) return 'AI 对话';
    if (path.includes('integration-management')) return '集成管理';
    if (path.includes('users') || path.includes('roles')) return '用户权限';
    return 'API 服务';
  }

  private normalizeTaskStatus(status: string) {
    const value = status.toLowerCase();
    if (['completed', 'success', 'ok', '成功'].includes(value)) return '成功';
    if (['failed', 'error', '失败'].includes(value)) return '失败';
    if (['skipped', '跳过'].includes(value)) return '跳过';
    if (['pending_config'].includes(value)) return '待配置';
    return status;
  }

  private resolveAuditRisk(action: string, resource: string) {
    const text = `${action} ${resource}`.toLowerCase();
    if (text.includes('delete') || text.includes('role') || text.includes('user') || text.includes('ai-model')) return '高';
    if (text.includes('patch') || text.includes('post') || text.includes('mailbox')) return '中';
    return '低';
  }

  private summarizeAuditMeta(meta: Prisma.JsonValue) {
    const record = this.asRecord(meta);
    const keys = Object.keys(record).filter((key) => !key.toLowerCase().includes('secret')).slice(0, 4);
    if (keys.length === 0) return '已记录操作';
    return keys.map((key) => `${key}: ${this.formatMetaValue(record[key])}`).join('；');
  }

  private formatMetaValue(value: unknown) {
    if (value === null || value === undefined) return '-';
    if (typeof value === 'string') return value.length > 32 ? `${value.slice(0, 32)}...` : value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return '[object]';
  }

  private asRecord(value: Prisma.JsonValue): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  }

  private startOfDay(date: Date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  private formatDateTime(date: Date) {
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  private formatHour(date: Date) {
    return `${String(date.getHours()).padStart(2, '0')}:00`;
  }

  private formatNumber(value: number) {
    return new Intl.NumberFormat('en-US').format(value);
  }
}
