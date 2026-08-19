import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { UPLOADED_MEDIA_MARKER } from '../../common/media-upload.constants';

export type UsageRange = 'today' | 'month' | 'year';

export type AiUsageDetailsQuery = {
  range?: string;
  modality?: string;
  model?: string;
  userId?: string;
  date?: string;
  page?: string;
  pageSize?: string;
};

export type AiUsageEntry = {
  userId: string;
  modality: 'chat' | 'image' | 'video' | 'embedding' | 'document';
  model: string;
  provider?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  costYuan?: number;
  costUsd?: number;
  seconds?: number;
  estimated?: boolean;
  source?: string;
  refId?: string | null;
};

type ModelRow = {
  model: string;
  modality: string;
  calls: number;
  tokens: number;
  cost_yuan: number;
  cost_usd: number;
  seconds: number;
  cost_cny_approx: number;
};

type UserRow = {
  user_id: string;
  name: string;
  department: string | null;
  calls: number;
  chat_calls: number;
  image_calls: number;
  video_calls: number;
  tokens: number;
  video_cost_yuan: number;
  image_cost_usd: number;
  cost_cny_approx: number;
};

const round2 = (n: number) => Math.round((n || 0) * 100) / 100;
const SHANGHAI_OFFSET_MS = 8 * 3600 * 1000;
// 图片成本以美元估算，统一折合人民币的近似汇率（仅用于「约合¥」展示，非结算价）
const USD_TO_CNY = 7.2;

@Injectable()
export class AiUsageService {
  private readonly logger = new Logger(AiUsageService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 记录一次 AI 用量（fire-and-forget，best-effort，绝不影响主流程） */
  record(entry: AiUsageEntry): void {
    if (!entry.userId || !entry.model) return;
    const prompt = Math.max(0, Math.round(entry.promptTokens ?? 0));
    const completion = Math.max(0, Math.round(entry.completionTokens ?? 0));
    const total = Math.max(0, Math.round(entry.totalTokens ?? prompt + completion));
    void this.prisma.aiUsageLog
      .create({
        data: {
          userId: entry.userId,
          modality: entry.modality,
          provider: entry.provider ?? '',
          model: entry.model,
          promptTokens: prompt,
          completionTokens: completion,
          totalTokens: total,
          costYuan: entry.costYuan ?? 0,
          costUsd: entry.costUsd ?? 0,
          seconds: Math.max(0, Math.round(entry.seconds ?? 0)),
          estimated: entry.estimated ?? false,
          source: entry.source ?? '',
          refId: entry.refId ?? null,
        },
      })
      .catch((err) => this.logger.warn(`用量记录失败: ${err instanceof Error ? err.message : err}`));
  }

  private rangeSince(range: UsageRange): Date {
    const sh = new Date(Date.now() + SHANGHAI_OFFSET_MS);
    const y = sh.getUTCFullYear();
    const m = sh.getUTCMonth();
    const d = sh.getUTCDate();
    if (range === 'year') return new Date(Date.UTC(y, 0, 1) - SHANGHAI_OFFSET_MS);
    if (range === 'month') return new Date(Date.UTC(y, m, 1) - SHANGHAI_OFFSET_MS);
    return new Date(Date.UTC(y, m, d) - SHANGHAI_OFFSET_MS);
  }

  private shanghaiDayRange(dateInput?: string): { gte: Date; lt: Date } | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateInput ?? '');
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const utcDay = new Date(Date.UTC(year, month - 1, day));
    if (
      utcDay.getUTCFullYear() !== year ||
      utcDay.getUTCMonth() !== month - 1 ||
      utcDay.getUTCDate() !== day
    ) {
      return null;
    }
    const start = new Date(utcDay.getTime() - SHANGHAI_OFFSET_MS);
    return { gte: start, lt: new Date(start.getTime() + 24 * 3600 * 1000) };
  }

  async getDashboard(rangeInput?: string) {
    const range: UsageRange =
      rangeInput === 'month' || rangeInput === 'year' ? rangeInput : 'today';
    const since = this.rangeSince(range);

    // ── 按模型 ──（统一从 AiUsageLog 聚合）
    const modelGroups = await this.prisma.aiUsageLog.groupBy({
      by: ['model', 'modality'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
      _sum: { totalTokens: true, costYuan: true, costUsd: true, seconds: true },
    });
    const byModel: ModelRow[] = modelGroups
      .map((r) => {
        const yuan = round2(r._sum.costYuan ?? 0);
        const usd = round2(r._sum.costUsd ?? 0);
        return {
          model: r.model,
          modality: r.modality,
          calls: r._count._all,
          tokens: r._sum.totalTokens ?? 0,
          cost_yuan: yuan,
          cost_usd: usd,
          seconds: r._sum.seconds ?? 0,
          cost_cny_approx: round2(yuan + usd * USD_TO_CNY),
        };
      })
      .sort((a, b) => b.calls - a.calls);

    // ── 按人员 ──
    const userGroups = await this.prisma.aiUsageLog.groupBy({
      by: ['userId', 'modality'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
      _sum: { totalTokens: true, costYuan: true, costUsd: true },
    });
    const userMap = new Map<string, UserRow>();
    const ensure = (uid: string): UserRow => {
      let row = userMap.get(uid);
      if (!row) {
        row = {
          user_id: uid,
          name: '未知用户',
          department: null,
          calls: 0,
          chat_calls: 0,
          image_calls: 0,
          video_calls: 0,
          tokens: 0,
          video_cost_yuan: 0,
          image_cost_usd: 0,
          cost_cny_approx: 0,
        };
        userMap.set(uid, row);
      }
      return row;
    };
    for (const g of userGroups) {
      const row = ensure(g.userId);
      const calls = g._count._all;
      row.calls += calls;
      row.tokens += g._sum.totalTokens ?? 0;
      if (g.modality === 'chat') row.chat_calls += calls;
      else if (g.modality === 'image') row.image_calls += calls;
      else if (g.modality === 'video') row.video_calls += calls;
      row.video_cost_yuan += g.modality === 'video' ? g._sum.costYuan ?? 0 : 0;
      row.image_cost_usd += g.modality === 'image' ? g._sum.costUsd ?? 0 : 0;
    }
    const users =
      userMap.size > 0
        ? await this.prisma.user.findMany({
            where: { id: { in: [...userMap.keys()] } },
            select: { id: true, name: true, department: true },
          })
        : [];
    const nameMap = new Map(users.map((u) => [u.id, u]));
    const byUser: UserRow[] = [...userMap.values()]
      .map((u) => ({
        ...u,
        name: nameMap.get(u.user_id)?.name ?? '未知用户',
        department: nameMap.get(u.user_id)?.department ?? null,
        video_cost_yuan: round2(u.video_cost_yuan),
        image_cost_usd: round2(u.image_cost_usd),
        cost_cny_approx: round2(u.video_cost_yuan + u.image_cost_usd * USD_TO_CNY),
      }))
      .sort((a, b) => b.calls - a.calls);

    const totals = {
      calls: byModel.reduce((s, r) => s + r.calls, 0),
      chat_calls: byModel.filter((r) => r.modality === 'chat').reduce((s, r) => s + r.calls, 0),
      image_calls: byModel.filter((r) => r.modality === 'image').reduce((s, r) => s + r.calls, 0),
      video_calls: byModel.filter((r) => r.modality === 'video').reduce((s, r) => s + r.calls, 0),
      tokens: byModel.reduce((s, r) => s + r.tokens, 0),
      video_cost_yuan: round2(byModel.reduce((s, r) => s + r.cost_yuan, 0)),
      image_cost_usd: round2(byModel.reduce((s, r) => s + r.cost_usd, 0)),
      cost_cny_approx: round2(byModel.reduce((s, r) => s + r.cost_cny_approx, 0)),
      active_users: byUser.length,
    };

    const trend = await this.dailyTrend(30);
    return { range, totals, by_model: byModel, by_user: byUser, trend };
  }

  async getDetails(query: AiUsageDetailsQuery) {
    const range: UsageRange =
      query.range === 'month' || query.range === 'year' ? query.range : 'today';
    const page = Math.max(1, Number.parseInt(query.page ?? '1', 10) || 1);
    const pageSize = Math.min(100, Math.max(10, Number.parseInt(query.pageSize ?? '20', 10) || 20));
    const dayRange = this.shanghaiDayRange(query.date);
    const where: Prisma.AiUsageLogWhereInput = {
      createdAt: dayRange ?? { gte: this.rangeSince(range) },
    };
    if (query.modality?.trim()) where.modality = query.modality.trim();
    if (query.model?.trim()) where.model = query.model.trim();
    if (query.userId?.trim()) where.userId = query.userId.trim();

    const [total, sums, modalityGroups, rows] = await Promise.all([
      this.prisma.aiUsageLog.count({ where }),
      this.prisma.aiUsageLog.aggregate({
        where,
        _sum: {
          promptTokens: true,
          completionTokens: true,
          totalTokens: true,
          costYuan: true,
          costUsd: true,
          seconds: true,
        },
      }),
      this.prisma.aiUsageLog.groupBy({
        by: ['modality'],
        where,
        _count: { _all: true },
      }),
      this.prisma.aiUsageLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          user: {
            select: { id: true, name: true, department: true },
          },
        },
      }),
    ]);

    const modalityCalls = Object.fromEntries(
      modalityGroups.map((group) => [group.modality, group._count._all]),
    );
    const costYuan = round2(sums._sum.costYuan ?? 0);
    const costUsd = round2(sums._sum.costUsd ?? 0);

    return {
      filters: {
        range,
        modality: query.modality?.trim() || null,
        model: query.model?.trim() || null,
        user_id: query.userId?.trim() || null,
        date: dayRange ? query.date : null,
      },
      summary: {
        calls: total,
        chat_calls: modalityCalls.chat ?? 0,
        image_calls: modalityCalls.image ?? 0,
        video_calls: modalityCalls.video ?? 0,
        prompt_tokens: sums._sum.promptTokens ?? 0,
        completion_tokens: sums._sum.completionTokens ?? 0,
        total_tokens: sums._sum.totalTokens ?? 0,
        cost_yuan: costYuan,
        cost_usd: costUsd,
        cost_cny_approx: round2(costYuan + costUsd * USD_TO_CNY),
        seconds: sums._sum.seconds ?? 0,
      },
      items: rows.map((row) => ({
        id: row.id,
        created_at: row.createdAt.toISOString(),
        user_id: row.userId,
        user_name: row.user.name,
        department: row.user.department,
        modality: row.modality,
        provider: row.provider,
        model: row.model,
        prompt_tokens: row.promptTokens,
        completion_tokens: row.completionTokens,
        total_tokens: row.totalTokens,
        cost_yuan: round2(row.costYuan),
        cost_usd: round2(row.costUsd),
        cost_cny_approx: round2(row.costYuan + row.costUsd * USD_TO_CNY),
        seconds: row.seconds,
        estimated: row.estimated,
        source: row.source,
        ref_id: row.refId,
      })),
      pagination: {
        page,
        page_size: pageSize,
        total,
        total_pages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }

  private async dailyTrend(days: number): Promise<Array<{ date: string; calls: number }>> {
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);
    const rows = await this.prisma.$queryRawUnsafe<Array<{ date: string; calls: number }>>(
      `SELECT to_char(("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai')::date, 'YYYY-MM-DD') AS date, count(*)::int AS calls
       FROM "AiUsageLog" WHERE "createdAt" >= $1 GROUP BY 1`,
      since,
    );
    const map = new Map<string, number>();
    for (const r of rows) map.set(r.date, Number(r.calls));
    const out: Array<{ date: string; calls: number }> = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() + SHANGHAI_OFFSET_MS - i * 24 * 3600 * 1000);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      out.push({ date: key, calls: map.get(key) ?? 0 });
    }
    return out;
  }

  /**
   * 从既有业务表回填历史用量到 AiUsageLog（一次性，幂等：先清空再回填）。
   * 对话历史（ChatUsageEvent）无 token，回填为 0（诚实）；图片/视频回填真实成本。
   */
  async backfill(): Promise<{ chat: number; image: number; video: number }> {
    await this.prisma.aiUsageLog.deleteMany({ where: { source: 'backfill' } });

    // 只回填「实时埋点最早一条记录之前」的历史，避免与实时写入的记录重复计数
    // （回填与实时是同一批业务事件的两份日志，重叠区间会导致看板数字翻倍）。
    const earliest = await this.prisma.aiUsageLog.findFirst({
      where: { source: { not: 'backfill' } },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });
    const cutoff = earliest?.createdAt ?? new Date();

    const chatEvents = await this.prisma.chatUsageEvent.findMany({
      where: { eventType: 'question_submitted', model: { not: null }, createdAt: { lt: cutoff } },
      select: { userId: true, model: true, createdAt: true, conversationId: true },
    });
    if (chatEvents.length) {
      await this.prisma.aiUsageLog.createMany({
        data: chatEvents.map((e) => ({
          userId: e.userId,
          modality: 'chat',
          model: e.model ?? '未知',
          source: 'backfill',
          refId: e.conversationId ?? null,
          createdAt: e.createdAt,
        })),
      });
    }

    // 上传入库的作品不是 AI 调用，成本与 token 都是 0，回填进用量表会凭空多出一堆零成本记录
    const images = await this.prisma.generatedImage.findMany({
      where: { createdAt: { lt: cutoff }, model: { not: UPLOADED_MEDIA_MARKER } },
      select: { userId: true, model: true, totalTokens: true, estimatedCostUsd: true, createdAt: true },
    });
    if (images.length) {
      await this.prisma.aiUsageLog.createMany({
        data: images.map((im) => ({
          userId: im.userId,
          modality: 'image',
          model: im.model,
          totalTokens: im.totalTokens,
          costUsd: im.estimatedCostUsd,
          source: 'backfill',
          createdAt: im.createdAt,
        })),
      });
    }

    const videos = await this.prisma.videoGeneration.findMany({
      where: {
        status: { not: 'failed' },
        mode: { not: UPLOADED_MEDIA_MARKER },
        createdAt: { lt: cutoff },
      },
      select: { userId: true, model: true, costYuan: true, billedSeconds: true, createdAt: true },
    });
    if (videos.length) {
      await this.prisma.aiUsageLog.createMany({
        data: videos.map((v) => ({
          userId: v.userId,
          modality: 'video',
          model: v.model,
          costYuan: v.costYuan,
          seconds: v.billedSeconds,
          source: 'backfill',
          createdAt: v.createdAt,
        })),
      });
    }

    return { chat: chatEvents.length, image: images.length, video: videos.length };
  }
}
