import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { PrismaService } from '../../prisma/prisma.service';
import { OssService } from '../oss/oss.service';
import { ImageGenerationService } from '../image-generation/image-generation.service';
import { ChatService } from './chat.service';

export type MateChatStreak = {
  /** 当前连续使用天数（今天未打卡但昨天打卡时仍保留，视为“待续” streak） */
  currentStreak: number;
  /** 历史最长连续天数 */
  bestStreak: number;
  /** 今天是否已提问打卡 */
  todayDone: boolean;
  /** 本周一~周日 7 天打卡情况 */
  weekActivity: boolean[];
  /** 累计提问次数 */
  totalQuestions: number;
  /** 当前连续天数是否达到里程碑（用于前端庆祝动效） */
  milestone: boolean;
  /** AI 每日生成的趣味激励文案（同一天同一用户缓存，失败回退内置文案池） */
  message: string;
  /** AI 每日生成的卡通动物吉祥物图（全员共享一张/天）的签名 URL；未就绪为 null */
  mascotUrl: string | null;
};

/** 达到即视为里程碑的连续天数节点 */
const MILESTONES = new Set([3, 7, 14, 30, 50, 100, 200, 365]);

/** AI 不可用时的兜底趣味文案；{n} 会被替换为当前连续天数 */
const FALLBACK_LINES = [
  '连续 {n} 天，手感正热，今天也来一发 🔥',
  '{n} 天不间断，你已经比 90% 的人更会用 AI 了 💪',
  '别小看每天一问，{n} 天下来就是复利 ✨',
  '火苗已燃 {n} 天，别让它熄灭哦 🔥',
  '今天的问题，交给 MateChat 想想？连续 {n} 天等你续上 🚀',
  '{n} 天连击！保持节奏，灵感不断电 ⚡',
];

const NEW_USER_FALLBACK = '还没开始？向 MateChat 提第一个问题，点燃你的连续记录 🔥';

/** 每日吉祥物图存储键 */
const MASCOT_SETTING_KEY = 'matechat.streak.daily_mascot';
/** 卡通动物物种池，按日期轮换 */
const MASCOT_ANIMALS = [
  '小狐狸', '橘猫', '柴犬', '小熊猫', '企鹅', '考拉', '小兔子', '小老虎',
  '水獭', '刺猬', '羊驼', '浣熊', '小熊', '柯基犬', '仓鼠', '树懒',
];

@Injectable()
export class ChatStreakService {
  private readonly logger = new Logger(ChatStreakService.name);
  /** 每日文案缓存：userId -> { date: 'YYYY-MM-DD', message } */
  private readonly dailyMessageCache = new Map<string, { date: string; message: string }>();
  /** 正在生成吉祥物的日期集合，避免并发重复生成 */
  private readonly mascotGenerating = new Set<string>();
  /** 系统用户 id 缓存（生成吉祥物需归属一个用户） */
  private systemUserId: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly chatService: ChatService,
    private readonly imageGenerationService: ImageGenerationService,
    private readonly ossService: OssService,
  ) {}

  async getMyStreak(userId: string): Promise<MateChatStreak> {
    const events = await this.prisma.chatUsageEvent.findMany({
      where: { userId, eventType: 'question_submitted' },
      select: { createdAt: true },
    });
    const dates = new Set(events.map((e) => this.dayKey(e.createdAt)));

    const now = new Date();
    const todayKey = this.dayKey(now);
    const todayDone = dates.has(todayKey);

    const currentStreak = this.computeCurrentStreak(dates, now);
    const bestStreak = this.computeBestStreak(dates);
    const weekActivity = this.computeWeekActivity(dates, now);
    const milestone = todayDone && MILESTONES.has(currentStreak);

    const message = await this.resolveDailyMessage(userId, todayKey, {
      currentStreak,
      todayDone,
      bestStreak,
    });
    const mascotUrl = await this.resolveDailyMascotUrl(todayKey);

    return {
      currentStreak,
      bestStreak,
      todayDone,
      weekActivity,
      totalQuestions: events.length,
      milestone,
      message,
      mascotUrl,
    };
  }

  /** 每天 6:00 预生成当日吉祥物（全员共享一张） */
  @Cron('0 6 * * *', { name: 'matechat-streak-daily-mascot' })
  async dailyMascotCron(): Promise<void> {
    await this.ensureDailyMascot(this.dayKey(new Date()));
  }

  /** 取当日吉祥物签名 URL；未生成则后台触发生成（fire-and-forget），本次返回 null。 */
  private async resolveDailyMascotUrl(todayKey: string): Promise<string | null> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: MASCOT_SETTING_KEY },
      select: { value: true },
    });
    const value = (setting?.value ?? null) as { date?: string; objectKey?: string } | null;
    if (value && value.date === todayKey && value.objectKey) {
      // 私有 Bucket：每次返回新的短时签名 URL
      return this.ossService.getSignedUrl(value.objectKey, 3600);
    }
    // 当日尚未就绪：后台触发生成，不阻塞本次响应
    void this.ensureDailyMascot(todayKey);
    return null;
  }

  /** 确保当日吉祥物已生成并入库（幂等 + 防并发） */
  private async ensureDailyMascot(dateKey: string): Promise<void> {
    if (this.mascotGenerating.has(dateKey)) return;
    const existing = await this.prisma.systemSetting.findUnique({
      where: { key: MASCOT_SETTING_KEY },
      select: { value: true },
    });
    const value = (existing?.value ?? null) as { date?: string; objectKey?: string } | null;
    if (value && value.date === dateKey && value.objectKey) return; // 今日已就绪

    this.mascotGenerating.add(dateKey);
    try {
      const userId = await this.resolveSystemUserId();
      if (!userId) return;
      const animal = MASCOT_ANIMALS[this.seedFromKey(dateKey) % MASCOT_ANIMALS.length];
      const prompt = `一只可爱的卡通${animal}，作为卡片背景的完整场景插画，主体偏右下方、铺满整个画面，梦幻柔和的光影，明快而不刺眼的配色，画面上方与左上区域留出较简洁的空间便于叠加白色文字，半扁平插画风格，画面中不要出现任何文字`;
      const imageId = await this.generateMascotWithFallback(userId, prompt);
      if (!imageId) throw new Error('所有启用的图像模型均生成失败');

      // generate 的 OSS 上传是后台异步，轮询等待 objectKey 落库（最多 ~30s）
      const objectKey = await this.waitForObjectKey(imageId);
      if (!objectKey) throw new Error('OSS objectKey 未就绪');

      await this.prisma.systemSetting.upsert({
        where: { key: MASCOT_SETTING_KEY },
        create: { key: MASCOT_SETTING_KEY, category: 'matechat', value: { date: dateKey, objectKey, imageId } },
        update: { value: { date: dateKey, objectKey, imageId } },
      });
      this.logger.log(`已生成当日吉祥物（${animal}）：${dateKey}`);
    } catch (error) {
      this.logger.warn(`当日吉祥物生成失败：${error instanceof Error ? error.message : error}`);
    } finally {
      this.mascotGenerating.delete(dateKey);
    }
  }

  /**
   * 生成吉祥物图：优先 image-2 系列模型，失败时依次换其他启用的图像模型兜底（最多尝试 3 个渠道）。
   * 全部失败返回 null，由调用方统一记日志。
   */
  private async generateMascotWithFallback(userId: string, prompt: string): Promise<string | null> {
    // 排序与聊天生图工具一致：image-2 系优先 → 默认启用优先 → 最近更新优先
    const configs = await this.imageGenerationService.listActiveImageModelConfigs();
    const candidates: Array<{ id?: string; model: string }> = [...configs]
      .sort((a, b) => {
        const aImg2 = /image[-_]?2/i.test(a.model) ? 0 : 1;
        const bImg2 = /image[-_]?2/i.test(b.model) ? 0 : 1;
        if (aImg2 !== bImg2) return aImg2 - bImg2;
        return (a.isDefault ? 0 : 1) - (b.isDefault ? 0 : 1);
      })
      .slice(0, 4);
    // 管理台没有任何图像模型配置时，仍按环境变量兜底试一次 image-2
    if (candidates.length === 0) candidates.push({ model: 'gpt-image-2' });

    for (const candidate of candidates) {
      try {
        const result = (await this.imageGenerationService.generate(userId, {
          prompt,
          size: '1024x1024',
          quality: 'low',
          model: candidate.model,
          ...(candidate.id ? { model_id: candidate.id } : {}),
        })) as { id?: string };
        if (result?.id) return result.id;
        this.logger.warn(`吉祥物生成异常（模型 ${candidate.model}）：generate 未返回图片 id，尝试下一个兜底`);
      } catch (error) {
        this.logger.warn(
          `吉祥物生成失败（模型 ${candidate.model}），尝试下一个兜底：${error instanceof Error ? error.message : error}`,
        );
      }
    }
    return null;
  }

  private async waitForObjectKey(imageId: string): Promise<string | null> {
    for (let i = 0; i < 15; i += 1) {
      const img = await this.prisma.generatedImage.findUnique({
        where: { id: imageId },
        select: { imageUrl: true },
      });
      const key = img?.imageUrl?.trim();
      if (key) return key; // imageUrl 存的是 objectKey（私有 Bucket），后台上传完成后写回
      await new Promise((r) => setTimeout(r, 2000));
    }
    return null;
  }

  private async resolveSystemUserId(): Promise<string | null> {
    if (this.systemUserId) return this.systemUserId;
    const user = await this.prisma.user.findFirst({
      where: { status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    this.systemUserId = user?.id ?? null;
    return this.systemUserId;
  }

  private seedFromKey(key: string): number {
    return [...key].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  }

  /** 从今天（或今天未打卡时从昨天）往回数连续打卡天数 */
  private computeCurrentStreak(dates: Set<string>, now: Date): number {
    const cursor = new Date(now);
    cursor.setHours(0, 0, 0, 0);
    if (!dates.has(this.dayKey(cursor))) {
      // 今天没打卡：若昨天有则 streak 仍存活，从昨天往回数；否则已中断
      cursor.setDate(cursor.getDate() - 1);
      if (!dates.has(this.dayKey(cursor))) return 0;
    }
    let streak = 0;
    while (dates.has(this.dayKey(cursor))) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  }

  /** 历史最长连续天数 */
  private computeBestStreak(dates: Set<string>): number {
    const sorted = [...dates].sort();
    let best = 0;
    let run = 0;
    let prev: string | null = null;
    for (const key of sorted) {
      run = prev && this.isNextDay(prev, key) ? run + 1 : 1;
      if (run > best) best = run;
      prev = key;
    }
    return best;
  }

  /** 本周一~周日的打卡情况 */
  private computeWeekActivity(dates: Set<string>, now: Date): boolean[] {
    const monday = new Date(now);
    monday.setHours(0, 0, 0, 0);
    const mondayOffset = (monday.getDay() + 6) % 7; // 周一=0 ... 周日=6
    monday.setDate(monday.getDate() - mondayOffset);
    return Array.from({ length: 7 }, (_, i) => {
      const day = new Date(monday);
      day.setDate(monday.getDate() + i);
      return dates.has(this.dayKey(day));
    });
  }

  /** 本地时区 YYYY-MM-DD */
  private dayKey(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private isNextDay(prevKey: string, key: string): boolean {
    const prev = new Date(`${prevKey}T00:00:00`);
    prev.setDate(prev.getDate() + 1);
    return this.dayKey(prev) === key;
  }

  /** 取当日 AI 文案（按 userId+日期缓存，失败回退文案池） */
  private async resolveDailyMessage(
    userId: string,
    todayKey: string,
    ctx: { currentStreak: number; todayDone: boolean; bestStreak: number },
  ): Promise<string> {
    const cached = this.dailyMessageCache.get(userId);
    if (cached && cached.date === todayKey) return cached.message;

    let message: string;
    try {
      message = await this.generateDailyMessage(ctx);
    } catch (error) {
      this.logger.warn(`每日文案生成失败，使用兜底：${error instanceof Error ? error.message : error}`);
      message = this.fallbackMessage(ctx.currentStreak, todayKey);
    }
    this.dailyMessageCache.set(userId, { date: todayKey, message });
    return message;
  }

  private async generateDailyMessage(ctx: {
    currentStreak: number;
    todayDone: boolean;
    bestStreak: number;
  }): Promise<string> {
    const system = [
      '你是一个活泼、会玩梗的 AI 助手打卡教练，任务是激励用户每天使用公司内部 AI 助手「MateChat」。',
      '请只输出一句中文激励语，20 字以内，口语化、有趣、可带 1 个 emoji。',
      '不要引号、不要解释、不要换行，直接给这一句话。每次尽量换新花样，别重复套路。',
    ].join('\n');
    const state = ctx.todayDone
      ? `用户今天已经用过 MateChat，当前连续 ${ctx.currentStreak} 天，历史最长 ${ctx.bestStreak} 天。夸奖并鼓励保持。`
      : ctx.currentStreak > 0
        ? `用户已连续 ${ctx.currentStreak} 天使用 MateChat，但今天还没用。提醒别中断连续记录，催他今天来提个问题。`
        : '用户还没有连续记录。用轻松的方式邀请他今天向 MateChat 提第一个问题。';

    const result = await this.chatService.complete({
      system,
      messages: [{ role: 'user', content: state }],
      temperature: 1,
      maxTokens: 80,
      timeoutMs: 8000,
      maxRetries: 1,
    });
    const text = result.content.trim().replace(/^["'“”]|["'“”]$/g, '').split('\n')[0].trim();
    if (!text) throw new Error('empty message');
    return text.slice(0, 40);
  }

  private fallbackMessage(currentStreak: number, todayKey: string): string {
    if (currentStreak <= 0) return NEW_USER_FALLBACK;
    // 按日期取模，保证同一天稳定、不同天变化
    const seed = [...todayKey].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
    const line = FALLBACK_LINES[seed % FALLBACK_LINES.length];
    return line.replace('{n}', String(currentStreak));
  }
}
