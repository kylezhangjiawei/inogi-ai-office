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

const NEW_USER_FALLBACK_LINES = [
  '今天也可以从第一个问题开始，MateChat 已就位 🔥',
  '给 MateChat 一个问题，今天的灵感就开机了 ✨',
  '把手头最卡的一件事交给 MateChat 试试 🚀',
  '今天的 AI 连续记录，等你的第一个问题来点亮 💡',
  '先问一个小问题，也是在给今天的效率加速 ⚡',
  'MateChat 今日营业中，来开启你的第一问吧 🙌',
];

/** 每日文案创意主题池，按上海日期轮换，避免每天生成出相近套路。 */
const DAILY_MESSAGE_THEMES = [
  '轻松开工',
  '效率加速',
  '灵感续航',
  '挑战打卡',
  '成长复利',
  '团队协作',
  '问题拆解',
  '下班前收尾',
];

export const MATECHAT_TIME_ZONE = 'Asia/Shanghai';

/** 将任意时间统一归入上海自然日，避免部署服务器时区改变每日内容边界。 */
export function shanghaiDayKey(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MATECHAT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function shiftDayKey(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** 稳定的自然日序号，确保相邻日期轮换到相邻素材，而不是在 09→10 等进位时重复。 */
export function dayOrdinal(dateKey: string): number {
  return Math.floor(Date.parse(`${dateKey}T00:00:00.000Z`) / 86_400_000);
}

/** 每日吉祥物图存储键 */
const MASCOT_SETTING_KEY = 'matechat.streak.daily_mascot';
/** 卡通动物物种池，按日期轮换 */
const MASCOT_ANIMALS = [
  '小狐狸', '橘猫', '柴犬', '小熊猫', '企鹅', '考拉', '小兔子', '小老虎',
  '水獭', '刺猬', '羊驼', '浣熊', '小熊', '柯基犬', '仓鼠', '树懒',
];

/** 运营素材位配置 KV 键（由「运营素材管理」页读写；本服务只读，缺省回退内置默认） */
export const CONTENT_SLOT_MASCOT_KEY = 'content_slot.matechat_mascot';
export const CONTENT_SLOT_DAILY_MESSAGE_KEY = 'content_slot.matechat_daily_message';
/** 素材位历史留存 KV 键前缀：<prefix><slotKey 去掉 content_slot. 前缀> */
export const CONTENT_SLOT_HISTORY_PREFIX = 'content_slot_history.';
/** 历史条目结构（图片素材位） */
export type SlotHistoryEntry = { date: string; objectKey: string; source: 'ai' | 'upload' };
/** 历史留存上限 */
export const SLOT_HISTORY_MAX = 30;
/** 由配置 KV 键推导历史 KV 键：content_slot.xxx → content_slot_history.xxx */
export function slotHistoryKey(configKey: string): string {
  return CONTENT_SLOT_HISTORY_PREFIX + configKey.replace(/^content_slot\./, '');
}
/** 吉祥物默认 prompt 模板；{{animal}} 会替换为当日动物、{{date}} 为日期 */
export const DEFAULT_MASCOT_PROMPT =
  '一只可爱的卡通{{animal}}，作为卡片背景的完整场景插画，主体偏右下方、铺满整个画面，梦幻柔和的光影，明快而不刺眼的配色，画面上方与左上区域留出较简洁的空间便于叠加白色文字，半扁平插画风格，画面中不要出现任何文字';
/** 每日激励文案默认 system prompt */
export const DEFAULT_DAILY_MESSAGE_PROMPT = [
  '你是一个活泼、会玩梗的 AI 助手打卡教练，任务是激励用户每天使用公司内部 AI 助手「MateChat」。',
  '请只输出一句中文激励语，20 字以内，口语化、有趣、可带 1 个 emoji。',
  '不要引号、不要解释、不要换行，直接给这一句话。每次尽量换新花样，别重复套路。',
].join('\n');

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
    const dates = new Set(events.map((e) => shanghaiDayKey(e.createdAt)));

    const todayKey = shanghaiDayKey(new Date());
    const todayDone = dates.has(todayKey);

    const currentStreak = this.computeCurrentStreak(dates, todayKey);
    const bestStreak = this.computeBestStreak(dates);
    const weekActivity = this.computeWeekActivity(dates, todayKey);
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
  @Cron('0 6 * * *', { name: 'matechat-streak-daily-mascot', timeZone: MATECHAT_TIME_ZONE })
  async dailyMascotCron(): Promise<void> {
    await this.ensureTodayMascot();
  }

  /**
   * 6 点后的整点补跑：服务若在 6 点停机或重启，不会一直沿用昨天图片。
   * ensureDailyMascot 本身幂等，今日已生成时不会产生额外调用。
   */
  @Cron('20 6-23 * * *', { name: 'matechat-streak-daily-mascot-catch-up', timeZone: MATECHAT_TIME_ZONE })
  async dailyMascotCatchUpCron(): Promise<void> {
    await this.ensureTodayMascot();
  }

  /** 取当日吉祥物签名 URL；未生成则后台触发生成（fire-and-forget），本次返回 null。 */
  private async resolveDailyMascotUrl(todayKey: string): Promise<string | null> {
    const config = await this.readSlotConfig(CONTENT_SLOT_MASCOT_KEY, DEFAULT_MASCOT_PROMPT);
    if (config.mode === 'off') return null; // 停用：卡片回退为无背景图
    if (config.mode === 'static') {
      // 固定素材：图片池按当日轮换选一张
      const objectKey = this.pickFromPool(config.staticImagePool, todayKey);
      return objectKey ? this.ossService.getSignedUrl(objectKey, 3600) : null;
    }
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

  /**
   * 读取素材位配置（缺省回退内置默认）。本服务只读，写入由「运营素材管理」页负责。
   * mode: ai_daily（AI 每日生成）| static（固定素材）| off（停用）。向后兼容旧 { enabled } 字段。
   */
  private async readSlotConfig(
    key: string,
    defaultPrompt: string,
  ): Promise<{
    mode: 'ai_daily' | 'static' | 'off';
    promptTemplate: string;
    staticImageObjectKey: string;
    staticImagePool: string[];
    staticText: string;
  }> {
    try {
      const row = await this.prisma.systemSetting.findUnique({ where: { key }, select: { value: true } });
      const v = (row?.value ?? {}) as {
        mode?: unknown;
        enabled?: unknown;
        promptTemplate?: unknown;
        staticImageObjectKey?: unknown;
        staticImagePool?: unknown;
        staticText?: unknown;
      };
      const mode: 'ai_daily' | 'static' | 'off' =
        v.mode === 'static' || v.mode === 'off' || v.mode === 'ai_daily'
          ? v.mode
          : v.enabled === false
            ? 'off'
            : 'ai_daily';
      const single = typeof v.staticImageObjectKey === 'string' ? v.staticImageObjectKey : '';
      const pool = Array.isArray(v.staticImagePool)
        ? v.staticImagePool.map((x) => String(x)).filter(Boolean)
        : single
          ? [single] // 向后兼容旧单图
          : [];
      return {
        mode,
        promptTemplate:
          typeof v.promptTemplate === 'string' && v.promptTemplate.trim() ? v.promptTemplate : defaultPrompt,
        staticImageObjectKey: single,
        staticImagePool: pool,
        staticText: typeof v.staticText === 'string' ? v.staticText : '',
      };
    } catch {
      return { mode: 'ai_daily', promptTemplate: defaultPrompt, staticImageObjectKey: '', staticImagePool: [], staticText: '' };
    }
  }

  /** 从图片池按当日日期轮换选一张（同一天稳定、不同天变化） */
  private pickFromPool(pool: string[], dateKey: string): string {
    if (pool.length === 0) return '';
    if (pool.length === 1) return pool[0];
    return pool[this.seedFromKey(dateKey) % pool.length];
  }

  /** 确保当日吉祥物已生成并入库（幂等 + 防并发）。force=true 时无视「今日已就绪」与「已停用」，强制重生成。 */
  private async ensureDailyMascot(dateKey: string, force = false): Promise<void> {
    if (this.mascotGenerating.has(dateKey)) return;
    this.mascotGenerating.add(dateKey);
    try {
      const config = await this.readSlotConfig(CONTENT_SLOT_MASCOT_KEY, DEFAULT_MASCOT_PROMPT);
      // 仅「AI 每日」模式才自动生成；static/off 不生成（force 例外，供管理页强制预览）
      if (!force && config.mode !== 'ai_daily') return;
      const existing = await this.prisma.systemSetting.findUnique({
        where: { key: MASCOT_SETTING_KEY },
        select: { value: true },
      });
      const value = (existing?.value ?? null) as { date?: string; objectKey?: string } | null;
      if (!force && value && value.date === dateKey && value.objectKey) return; // 今日已就绪

      const userId = await this.resolveSystemUserId();
      if (!userId) return;
      const animal = MASCOT_ANIMALS[this.seedFromKey(dateKey) % MASCOT_ANIMALS.length];
      const prompt = config.promptTemplate
        .replace(/\{\{\s*animal\s*\}\}/g, animal)
        .replace(/\{\{\s*date\s*\}\}/g, dateKey);
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
      await this.appendSlotHistory(CONTENT_SLOT_MASCOT_KEY, { date: dateKey, objectKey, source: 'ai' });
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
    if (/^\d{4}-\d{2}-\d{2}$/.test(key)) return dayOrdinal(key);
    return [...key].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  }

  /** 从今天（或今天未打卡时从昨天）往回数连续打卡天数 */
  private computeCurrentStreak(dates: Set<string>, todayKey: string): number {
    let cursor = todayKey;
    if (!dates.has(cursor)) {
      // 今天没打卡：若昨天有则 streak 仍存活，从昨天往回数；否则已中断
      cursor = shiftDayKey(cursor, -1);
      if (!dates.has(cursor)) return 0;
    }
    let streak = 0;
    while (dates.has(cursor)) {
      streak += 1;
      cursor = shiftDayKey(cursor, -1);
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
  private computeWeekActivity(dates: Set<string>, todayKey: string): boolean[] {
    const today = new Date(`${todayKey}T12:00:00.000Z`);
    const mondayOffset = (today.getUTCDay() + 6) % 7; // 周一=0 ... 周日=6
    const mondayKey = shiftDayKey(todayKey, -mondayOffset);
    return Array.from({ length: 7 }, (_, i) => dates.has(shiftDayKey(mondayKey, i)));
  }

  private isNextDay(prevKey: string, key: string): boolean {
    return shiftDayKey(prevKey, 1) === key;
  }

  /** 取当日 AI 文案（按 userId+日期缓存，失败回退文案池） */
  private async resolveDailyMessage(
    userId: string,
    todayKey: string,
    ctx: { currentStreak: number; todayDone: boolean; bestStreak: number },
  ): Promise<string> {
    const cached = this.dailyMessageCache.get(userId);
    if (cached && cached.date === todayKey) return cached.message;

    const config = await this.readSlotConfig(CONTENT_SLOT_DAILY_MESSAGE_KEY, DEFAULT_DAILY_MESSAGE_PROMPT);
    let message: string;
    if (config.mode === 'static') {
      // 固定文案：用管理页填写的文案，未填则回退兜底池
      message = config.staticText.trim() || this.fallbackMessage(ctx.currentStreak, todayKey);
    } else if (config.mode === 'off') {
      message = this.fallbackMessage(ctx.currentStreak, todayKey);
    } else {
      try {
        message = await this.generateDailyMessage(ctx, todayKey);
      } catch (error) {
        this.logger.warn(`每日文案生成失败，使用兜底：${error instanceof Error ? error.message : error}`);
        message = this.fallbackMessage(ctx.currentStreak, todayKey);
      }
    }
    this.dailyMessageCache.set(userId, { date: todayKey, message });
    return message;
  }

  private async generateDailyMessage(ctx: {
    currentStreak: number;
    todayDone: boolean;
    bestStreak: number;
  }, todayKey: string): Promise<string> {
    const config = await this.readSlotConfig(CONTENT_SLOT_DAILY_MESSAGE_KEY, DEFAULT_DAILY_MESSAGE_PROMPT);
    const system = config.promptTemplate;
    const activityState = ctx.todayDone
      ? `用户今天已经用过 MateChat，当前连续 ${ctx.currentStreak} 天，历史最长 ${ctx.bestStreak} 天。夸奖并鼓励保持。`
      : ctx.currentStreak > 0
        ? `用户已连续 ${ctx.currentStreak} 天使用 MateChat，但今天还没用。提醒别中断连续记录，催他今天来提个问题。`
        : '用户还没有连续记录。用轻松的方式邀请他今天向 MateChat 提第一个问题。';
    const theme = DAILY_MESSAGE_THEMES[this.seedFromKey(todayKey) % DAILY_MESSAGE_THEMES.length];
    const state = [
      `上海日期：${todayKey}，今日创意主题：${theme}。`,
      activityState,
      '请围绕今日主题换一种新表达，避免沿用前一天的句式或固定开场。',
    ].join('\n');

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
    // 按日期取模，保证同一天稳定、不同天变化
    const seed = dayOrdinal(todayKey);
    if (currentStreak <= 0) return NEW_USER_FALLBACK_LINES[seed % NEW_USER_FALLBACK_LINES.length];
    const line = FALLBACK_LINES[seed % FALLBACK_LINES.length];
    return line.replace('{n}', String(currentStreak));
  }

  // ── 供「运营素材管理」页调用 ──────────────────────────────────────────────

  /** 当前吉祥物图（管理页预览）：返回签名 URL 与日期 */
  async getCurrentMascot(): Promise<{ url: string | null; date: string | null }> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: MASCOT_SETTING_KEY },
      select: { value: true },
    });
    const value = (setting?.value ?? null) as { date?: string; objectKey?: string } | null;
    const url = value?.objectKey ? this.ossService.getSignedUrl(value.objectKey, 3600) : null;
    return { url, date: value?.date ?? null };
  }

  /** 供定时补跑、管理页加载及切回 AI 模式时确保当天素材存在。 */
  async ensureTodayMascot(): Promise<void> {
    await this.ensureDailyMascot(shanghaiDayKey(new Date()));
  }

  /** 修改每日文案规则后清理当日内存缓存，使新规则立即用于下一次读取。 */
  invalidateDailyMessageCache(): void {
    this.dailyMessageCache.clear();
  }

  /** 强制重新生成当日吉祥物（管理页「立即重新生成」）；用当前配置的 prompt。 */
  async forceRegenerateMascot(): Promise<{ url: string | null; date: string | null }> {
    const today = shanghaiDayKey(new Date());
    await this.ensureDailyMascot(today, true);
    return this.getCurrentMascot();
  }

  /**
   * 通用：按 prompt 生成一张图并返回 OSS objectKey（复用吉祥物的多渠道兜底 + 等待落库）。
   * 供「运营素材管理」的其它图片素材位（如登录背景）复用，避免重复实现生成逻辑。
   */
  async generateImageForSlot(prompt: string): Promise<string | null> {
    const userId = await this.resolveSystemUserId();
    if (!userId) return null;
    const imageId = await this.generateMascotWithFallback(userId, prompt);
    if (!imageId) return null;
    return this.waitForObjectKey(imageId);
  }

  /** 向素材位历史追加一条（去重同日、按上限裁剪）。图片素材位共用。 */
  private async appendSlotHistory(configKey: string, entry: SlotHistoryEntry): Promise<void> {
    try {
      const key = slotHistoryKey(configKey);
      const row = await this.prisma.systemSetting.findUnique({ where: { key }, select: { value: true } });
      const raw = ((row?.value as { items?: unknown })?.items ?? []) as SlotHistoryEntry[];
      const items = [entry, ...raw.filter((e) => e && e.objectKey && e.date !== entry.date)].slice(
        0,
        SLOT_HISTORY_MAX,
      );
      await this.prisma.systemSetting.upsert({
        where: { key },
        create: { key, category: 'content_slot', value: { items } },
        update: { value: { items } },
      });
    } catch (err) {
      this.logger.warn(`素材位历史写入失败: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** 生成一条示例每日文案（管理页预览用，不写缓存） */
  async generateSampleMessage(): Promise<string> {
    const today = shanghaiDayKey(new Date());
    try {
      return await this.generateDailyMessage({ currentStreak: 5, todayDone: true, bestStreak: 12 }, today);
    } catch {
      return this.fallbackMessage(5, today);
    }
  }
}
