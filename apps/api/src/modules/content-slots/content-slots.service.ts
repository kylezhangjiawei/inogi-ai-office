import { BadRequestException, Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { PrismaService } from '../../prisma/prisma.service';
import { OssService } from '../oss/oss.service';
import {
  ChatStreakService,
  CONTENT_SLOT_DAILY_MESSAGE_KEY,
  CONTENT_SLOT_MASCOT_KEY,
  DEFAULT_DAILY_MESSAGE_PROMPT,
  DEFAULT_MASCOT_PROMPT,
  MATECHAT_TIME_ZONE,
  SLOT_HISTORY_MAX,
  dayOrdinal,
  shanghaiDayKey,
  slotHistoryKey,
  type SlotHistoryEntry,
} from '../chat/chat-streak.service';
import {
  CONTENT_SLOT_QUICK_SUGGESTIONS_KEY,
  DEFAULT_QUICK_SUGGESTIONS,
} from '../chat/chat-tools.service';

export const CONTENT_SLOT_LOGIN_BG_KEY = 'content_slot.login_background';
/** 运营素材 AI 生成月度上限配置 KV 键 */
const GEN_BUDGET_KEY = 'content_slot.gen_budget';
/** 登录背景 AI 每日生成的当日图存储键 */
const LOGIN_BG_DAILY_KEY = 'content_slot_daily.login_background';
/** 登录页默认背景（未配置静态素材 / 生成未就绪时回退） */
const DEFAULT_LOGIN_BG = 'https://matechat.gitcode.com/png/home/bgHome.png';
/** 登录背景 AI 每日生成默认 prompt（宽屏、留白便于叠加登录卡片） */
const DEFAULT_LOGIN_BG_PROMPT =
  '宽屏企业级 AI 智能办公主题背景，抽象科技感的柔和流体光影与几何线条，靛蓝到浅紫的清爽渐变，明亮通透，画面简洁、中部留白便于叠加登录卡片，高级、专业、宁静，不要任何文字与人物';

type SlotMode = 'ai_daily' | 'static' | 'off';

type SlotDef = {
  key: string;
  kvKey: string;
  name: string;
  location: string;
  type: 'image' | 'text' | 'list';
  /** 生成/展示的归属：streak 由 MateChat 打卡服务负责，content 由本服务直接负责 */
  owner: 'streak' | 'content';
  modes: SlotMode[];
  /** 未配置时的默认模式（吉祥物/文案保持 ai_daily 沿用现状；登录背景默认 off 保持系统默认背景） */
  defaultMode: SlotMode;
  defaultPrompt: string;
  promptVars: string[];
  note: string;
};

const SLOTS: SlotDef[] = [
  {
    key: 'matechat_mascot',
    kvKey: CONTENT_SLOT_MASCOT_KEY,
    name: 'MateChat 每日吉祥物图',
    location: 'MateChat 打卡卡片背景（全员共享一张 / 天，每天 6:00 自动生成）',
    type: 'image',
    owner: 'streak',
    modes: ['ai_daily', 'static', 'off'],
    defaultMode: 'ai_daily',
    defaultPrompt: DEFAULT_MASCOT_PROMPT,
    promptVars: ['{{animal}}', '{{date}}'],
    note: '{{animal}} 会替换为当日轮换的卡通动物，{{date}} 为日期',
  },
  {
    key: 'matechat_daily_message',
    kvKey: CONTENT_SLOT_DAILY_MESSAGE_KEY,
    name: 'MateChat 每日激励文案',
    location: 'MateChat 打卡卡片文案（每人每天一句，AI 生成）',
    type: 'text',
    owner: 'streak',
    modes: ['ai_daily', 'static', 'off'],
    defaultMode: 'ai_daily',
    defaultPrompt: DEFAULT_DAILY_MESSAGE_PROMPT,
    promptVars: [],
    note: '这是生成文案用的 system 提示词；固定模式下改用下方「固定文案」',
  },
  {
    key: 'matechat_quick_suggestions',
    kvKey: CONTENT_SLOT_QUICK_SUGGESTIONS_KEY,
    name: 'MateChat 快捷建议',
    location: 'MateChat 输入框上方的快捷提问（个性化条目由系统按用户任务生成，此处配置通用兜底池）',
    type: 'list',
    owner: 'content',
    modes: ['static', 'off'],
    defaultMode: 'off',
    defaultPrompt: '',
    promptVars: [],
    note: '固定模式使用下方自定义列表；关闭时使用系统内置默认建议',
  },
  {
    key: 'login_background',
    kvKey: CONTENT_SLOT_LOGIN_BG_KEY,
    name: '登录页背景图',
    location: '登录页整屏背景（每天 6:00 可自动生成一张）',
    type: 'image',
    owner: 'content',
    modes: ['ai_daily', 'static', 'off'],
    defaultMode: 'off',
    defaultPrompt: DEFAULT_LOGIN_BG_PROMPT,
    promptVars: ['{{date}}'],
    note: '关闭时使用系统默认背景；AI 每日生成为全站共享一张 / 天',
  },
];

type SlotConfig = {
  mode: SlotMode;
  promptTemplate: string;
  staticImageObjectKey: string;
  staticImagePool: string[];
  staticText: string;
  staticList: string[];
};

type SlotCurrent = {
  image_url: string | null;
  text: string | null;
  list: string[] | null;
  date: string | null;
};

type SlotAutomation = {
  active: boolean;
  status: 'ready' | 'catching_up' | 'on_demand' | 'live' | 'manual' | 'disabled';
  title: string;
  detail: string;
};

@Injectable()
export class ContentSlotsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly streakService: ChatStreakService,
    private readonly ossService: OssService,
  ) {}

  private def(key: string): SlotDef {
    const def = SLOTS.find((s) => s.key === key);
    if (!def) throw new BadRequestException('未知素材位');
    return def;
  }

  private async readConfig(def: SlotDef): Promise<SlotConfig> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: def.kvKey }, select: { value: true } });
    const v = (row?.value ?? {}) as Record<string, unknown>;
    const rawMode = v.mode;
    const mode: SlotMode =
      rawMode === 'static' || rawMode === 'off' || rawMode === 'ai_daily'
        ? rawMode
        : v.enabled === false
          ? 'off'
          : def.defaultMode;
    return {
      mode: def.modes.includes(mode) ? mode : def.modes[0],
      promptTemplate:
        typeof v.promptTemplate === 'string' && v.promptTemplate.trim() ? v.promptTemplate : def.defaultPrompt,
      staticImageObjectKey: typeof v.staticImageObjectKey === 'string' ? v.staticImageObjectKey : '',
      staticImagePool: this.parsePool(v.staticImagePool, v.staticImageObjectKey),
      staticText: typeof v.staticText === 'string' ? v.staticText : '',
      staticList: Array.isArray(v.staticList)
        ? v.staticList.map((x) => String(x).trim()).filter(Boolean)
        : [],
    };
  }

  /** 解析图片池：优先 pool，回退旧单图 staticImageObjectKey（向后兼容） */
  private parsePool(pool: unknown, single: unknown): string[] {
    if (Array.isArray(pool)) {
      const arr = pool.map((x) => String(x)).filter(Boolean);
      if (arr.length > 0) return arr;
    }
    return typeof single === 'string' && single ? [single] : [];
  }

  /** 图片池按当日轮换选一张（同一天稳定、不同天变化） */
  private pickFromPool(pool: string[]): string {
    if (pool.length === 0) return '';
    if (pool.length === 1) return pool[0];
    return pool[dayOrdinal(this.today()) % pool.length];
  }

  private signStatic(objectKey: string): string | null {
    return objectKey ? this.ossService.getSignedUrl(objectKey, 3600) : null;
  }

  /** 列出所有素材位（含配置与当前内容预览） */
  async list() {
    const items: Array<{
      key: string;
      name: string;
      location: string;
      type: 'image' | 'text' | 'list';
      modes: SlotMode[];
      prompt_vars: string[];
      note: string;
      default_prompt: string;
      mode: SlotMode;
      prompt_template: string;
      static_text: string;
      static_list: string[];
      has_static_image: boolean;
      static_image_pool: Array<{ object_key: string; url: string | null }>;
      current: SlotCurrent | null;
      automation: SlotAutomation;
    }> = [];
    for (const def of SLOTS) {
      const config = await this.readConfig(def);
      let current: SlotCurrent | null = null;
      if (def.type === 'list') {
        const list = config.mode === 'static' && config.staticList.length > 0 ? config.staticList : DEFAULT_QUICK_SUGGESTIONS;
        current = { image_url: null, text: null, list, date: null };
      } else if (def.type === 'image') {
        if (config.mode === 'static') {
          current = { image_url: this.signStatic(this.pickFromPool(config.staticImagePool)), text: null, list: null, date: null };
        } else if (def.key === 'matechat_mascot' && config.mode === 'ai_daily') {
          const m = await this.streakService.getCurrentMascot();
          current = { image_url: m.url, text: null, list: null, date: m.date };
          if (m.date !== this.today()) {
            // 管理页本身也可触发幂等补跑，避免错过 6 点后一直显示昨天的图。
            void this.streakService.ensureTodayMascot().catch(() => undefined);
          }
        } else if (def.key === 'login_background' && config.mode === 'ai_daily') {
          const daily = await this.readLoginBgDaily();
          current = { image_url: daily.objectKey ? this.signStatic(daily.objectKey) : null, text: null, list: null, date: daily.date || null };
          if (daily.date !== this.today()) {
            void this.ensureLoginBgDaily(false).catch(() => undefined);
          }
        } else if (def.key === 'login_background') {
          current = { image_url: DEFAULT_LOGIN_BG, text: null, list: null, date: null };
        }
      } else if (config.mode === 'static') {
        current = { image_url: null, text: config.staticText || null, list: null, date: null };
      }
      items.push({
        key: def.key,
        name: def.name,
        location: def.location,
        type: def.type,
        modes: def.modes,
        prompt_vars: def.promptVars,
        note: def.note,
        default_prompt: def.defaultPrompt,
        mode: config.mode,
        prompt_template: config.promptTemplate,
        static_text: config.staticText,
        static_list: config.staticList,
        has_static_image: config.staticImagePool.length > 0,
        static_image_pool: config.staticImagePool.map((k) => ({ object_key: k, url: this.signStatic(k) })),
        current,
        automation: this.automationStatus(def, config, current),
      });
    }
    return { items };
  }

  private automationStatus(def: SlotDef, config: SlotConfig, current: SlotCurrent | null): SlotAutomation {
    if (def.key === 'matechat_quick_suggestions') {
      return config.mode === 'static'
        ? {
            active: false,
            status: 'manual',
            title: '人工兜底列表',
            detail: '个性化任务建议仍由系统实时生成，此列表只替换通用兜底内容。',
          }
        : {
            active: true,
            status: 'live',
            title: '系统自动更新中',
            detail: '每次打开 MateChat 都会按当前账号的任务、待办与权限重新匹配。',
          };
    }
    if (config.mode === 'static') {
      return { active: false, status: 'manual', title: '人工固定', detail: '将持续展示固定内容，直到手动修改模式或素材。' };
    }
    if (config.mode === 'off') {
      return { active: false, status: 'disabled', title: '自动更新已停用', detail: def.note };
    }
    if (def.key === 'matechat_daily_message') {
      return {
        active: true,
        status: 'on_demand',
        title: '按用户每日自动生成',
        detail: '每位用户每天首次查看时生成一句新文案；提示词只是生成规则，不会固定最终内容。',
      };
    }
    const ready = current?.date === this.today() && Boolean(current.image_url);
    return ready
      ? {
          active: true,
          status: 'ready',
          title: `今日素材已自动更新 · ${current?.date}`,
          detail: def.key === 'matechat_mascot'
            ? '每天 06:00（上海时间）生成；手动重生成只替换今天，明天仍会继续自动更新。'
            : '每天 06:05（上海时间）生成；手动重生成只替换今天，明天仍会继续自动更新。',
        }
      : {
          active: true,
          status: 'catching_up',
          title: '今日素材正在自动补跑',
          detail: '错过定时点或服务重启后会自动补生成；生成完成后刷新即可看到今天的内容。',
        };
  }

  /** 保存素材位配置（模式 + prompt + 固定文案 + 固定图 objectKey） */
  async updateConfig(
    key: string,
    payload: {
      mode?: string;
      promptTemplate?: string;
      staticText?: string;
      staticImageObjectKey?: string;
      staticImagePool?: string[];
      staticList?: string[];
    },
  ) {
    const def = this.def(key);
    const current = await this.readConfig(def);
    const mode: SlotMode =
      payload.mode === 'ai_daily' || payload.mode === 'static' || payload.mode === 'off'
        ? payload.mode
        : current.mode;
    if (!def.modes.includes(mode)) throw new BadRequestException('该素材位不支持此模式');

    // 图片池：优先用传入的 pool；否则兼容旧单图字段（追加/替换到池）
    let nextPool = current.staticImagePool;
    if (Array.isArray(payload.staticImagePool)) {
      nextPool = payload.staticImagePool.map((x) => String(x)).filter(Boolean).slice(0, 12);
    } else if (typeof payload.staticImageObjectKey === 'string' && payload.staticImageObjectKey.trim()) {
      nextPool = [...current.staticImagePool, payload.staticImageObjectKey.trim()].slice(0, 12);
    }
    const next: SlotConfig = {
      mode,
      promptTemplate:
        typeof payload.promptTemplate === 'string' && payload.promptTemplate.trim()
          ? payload.promptTemplate.trim()
          : current.promptTemplate,
      staticText: typeof payload.staticText === 'string' ? payload.staticText : current.staticText,
      staticImageObjectKey: nextPool[0] ?? '', // 保留兼容字段指向池首项
      staticImagePool: nextPool,
      staticList: Array.isArray(payload.staticList)
        ? payload.staticList.map((x) => String(x).trim()).filter(Boolean).slice(0, 12)
        : current.staticList,
    };
    await this.prisma.systemSetting.upsert({
      where: { key: def.kvKey },
      create: { key: def.kvKey, category: 'content_slot', value: next, description: def.name },
      update: { value: next, description: def.name },
    });
    // 新增进池的图入历史
    const added = nextPool.filter((k) => !current.staticImagePool.includes(k));
    for (const objectKey of added) {
      await this.appendHistory(def.kvKey, { date: this.today(), objectKey, source: 'upload' });
    }
    if (def.key === 'matechat_daily_message') {
      this.streakService.invalidateDailyMessageCache();
    } else if (mode === 'ai_daily' && def.key === 'matechat_mascot') {
      void this.streakService.ensureTodayMascot().catch(() => undefined);
    } else if (mode === 'ai_daily' && def.key === 'login_background') {
      void this.ensureLoginBgDaily(false).catch(() => undefined);
    }
    return { ok: true };
  }

  private today(): string {
    return shanghaiDayKey(new Date());
  }

  private async appendHistory(configKey: string, entry: SlotHistoryEntry): Promise<void> {
    const key = slotHistoryKey(configKey);
    const row = await this.prisma.systemSetting.findUnique({ where: { key }, select: { value: true } });
    const raw = ((row?.value as { items?: unknown })?.items ?? []) as SlotHistoryEntry[];
    const items = [entry, ...raw.filter((e) => e && e.objectKey && e.date !== entry.date)].slice(0, SLOT_HISTORY_MAX);
    await this.prisma.systemSetting.upsert({
      where: { key },
      create: { key, category: 'content_slot', value: { items } },
      update: { value: { items } },
    });
  }

  /** 素材位历史（图片）：返回带签名 URL 的历史条目 */
  async history(key: string): Promise<{ items: Array<{ date: string; url: string | null; source: string }> }> {
    const def = this.def(key);
    if (def.type !== 'image') return { items: [] };
    const hKey = slotHistoryKey(def.kvKey);
    const row = await this.prisma.systemSetting.findUnique({ where: { key: hKey }, select: { value: true } });
    const raw = ((row?.value as { items?: unknown })?.items ?? []) as SlotHistoryEntry[];
    return {
      items: raw
        .filter((e) => e && e.objectKey)
        .map((e) => ({ date: e.date, url: this.signStatic(e.objectKey), source: e.source ?? 'ai' })),
    };
  }

  /** 立即重新生成 / 预览（仅 AI 模式的 streak 素材位支持） */
  async regenerate(key: string): Promise<{ image_url?: string | null; sample_text?: string }> {
    const def = this.def(key);
    // 文案预览不消耗图像预算；图片生成受月度上限约束
    if (def.type === 'image' && (await this.genBudgetExceeded())) {
      const { monthly_cap, used_this_month } = await this.getGenBudget();
      throw new BadRequestException(`本月 AI 生成已达上限（${used_this_month}/${monthly_cap}），请调高上限或下月再试`);
    }
    if (def.key === 'matechat_mascot') {
      const m = await this.streakService.forceRegenerateMascot();
      return { image_url: m.url };
    }
    if (def.key === 'matechat_daily_message') {
      return { sample_text: await this.streakService.generateSampleMessage() };
    }
    if (def.key === 'login_background') {
      const r = await this.ensureLoginBgDaily(true);
      return { image_url: r.url };
    }
    throw new BadRequestException('该素材位不支持重新生成');
  }

  // ── AI 生成成本闸门（月度次数上限）─────────────────────────────────────────

  async getGenBudget(): Promise<{ monthly_cap: number; used_this_month: number }> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: GEN_BUDGET_KEY }, select: { value: true } });
    const v = (row?.value ?? {}) as { monthlyCap?: unknown };
    const monthlyCap = typeof v.monthlyCap === 'number' && v.monthlyCap > 0 ? Math.floor(v.monthlyCap) : 0;
    return { monthly_cap: monthlyCap, used_this_month: await this.countMonthlyAiGen() };
  }

  async saveGenBudget(monthlyCap: number): Promise<{ monthly_cap: number }> {
    const cap = typeof monthlyCap === 'number' && monthlyCap > 0 ? Math.floor(monthlyCap) : 0;
    await this.prisma.systemSetting.upsert({
      where: { key: GEN_BUDGET_KEY },
      create: { key: GEN_BUDGET_KEY, category: 'content_slot', value: { monthlyCap: cap }, description: '运营素材 AI 生成月度上限' },
      update: { value: { monthlyCap: cap }, description: '运营素材 AI 生成月度上限' },
    });
    return { monthly_cap: cap };
  }

  /** 本月 AI 生成次数：统计各图片素材位历史里 source='ai' 且日期在当月的条目 */
  private async countMonthlyAiGen(): Promise<number> {
    const month = this.today().slice(0, 7); // YYYY-MM
    const keys = [slotHistoryKey(CONTENT_SLOT_MASCOT_KEY), slotHistoryKey(CONTENT_SLOT_LOGIN_BG_KEY)];
    let count = 0;
    for (const key of keys) {
      const row = await this.prisma.systemSetting.findUnique({ where: { key }, select: { value: true } });
      const raw = ((row?.value as { items?: unknown })?.items ?? []) as SlotHistoryEntry[];
      count += raw.filter((e) => e && e.source === 'ai' && typeof e.date === 'string' && e.date.startsWith(month)).length;
    }
    return count;
  }

  /** 闸门：达到月度上限时返回 true（force 手动重生成也受限，避免绕过）。上限 0 = 不限。 */
  private async genBudgetExceeded(): Promise<boolean> {
    const { monthly_cap, used_this_month } = await this.getGenBudget();
    return monthly_cap > 0 && used_this_month >= monthly_cap;
  }

  /** 登录页背景（公开，免鉴权）：AI 每日 > 静态素材 > 系统默认外链 */
  async getLoginBackground(): Promise<{ url: string }> {
    const def = this.def('login_background');
    const config = await this.readConfig(def);
    if (config.mode === 'static') {
      const url = this.signStatic(this.pickFromPool(config.staticImagePool));
      if (url) return { url };
    } else if (config.mode === 'ai_daily') {
      const daily = await this.readLoginBgDaily();
      if (daily.date === this.today() && daily.objectKey) {
        const url = this.signStatic(daily.objectKey);
        if (url) return { url };
      }
      // 当日未就绪：后台触发生成，本次回退默认
      void this.ensureLoginBgDaily(false);
    }
    return { url: DEFAULT_LOGIN_BG };
  }

  // ── 登录背景 AI 每日生成 ─────────────────────────────────────────────────────

  private loginBgGenerating = false;

  private async readLoginBgDaily(): Promise<{ date: string; objectKey: string }> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: LOGIN_BG_DAILY_KEY }, select: { value: true } });
    const v = (row?.value ?? {}) as { date?: string; objectKey?: string };
    return { date: v.date ?? '', objectKey: v.objectKey ?? '' };
  }

  /** 每天 6:05 预生成登录背景（错开吉祥物 6:00） */
  @Cron('5 6 * * *', { name: 'content-slots-login-bg-daily', timeZone: MATECHAT_TIME_ZONE })
  async loginBgCron(): Promise<void> {
    await this.ensureLoginBgDaily(false);
  }

  /** 6 点后的整点补跑，覆盖服务在 06:05 停机或重启的情况。 */
  @Cron('35 6-23 * * *', { name: 'content-slots-login-bg-catch-up', timeZone: MATECHAT_TIME_ZONE })
  async loginBgCatchUpCron(): Promise<void> {
    await this.ensureLoginBgDaily(false);
  }

  /** 确保当日登录背景已生成（幂等 + 防并发）。force 无视「今日已就绪」与「非 AI 模式」。 */
  async ensureLoginBgDaily(force: boolean): Promise<{ url: string | null }> {
    if (this.loginBgGenerating) return { url: null };
    this.loginBgGenerating = true;
    try {
      const def = this.def('login_background');
      const config = await this.readConfig(def);
      if (!force && config.mode !== 'ai_daily') return { url: null };
      const today = this.today();
      const daily = await this.readLoginBgDaily();
      if (!force && daily.date === today && daily.objectKey) {
        return { url: this.signStatic(daily.objectKey) };
      }
      // 成本闸门：达到月度上限则不再自动生成（保留昨日/默认）
      if (await this.genBudgetExceeded()) {
        return { url: daily.objectKey ? this.signStatic(daily.objectKey) : null };
      }
      const prompt = config.promptTemplate.replace(/\{\{\s*date\s*\}\}/g, today);
      const objectKey = await this.streakService.generateImageForSlot(prompt);
      if (!objectKey) return { url: null };
      await this.prisma.systemSetting.upsert({
        where: { key: LOGIN_BG_DAILY_KEY },
        create: { key: LOGIN_BG_DAILY_KEY, category: 'content_slot', value: { date: today, objectKey } },
        update: { value: { date: today, objectKey } },
      });
      await this.appendHistory(def.kvKey, { date: today, objectKey, source: 'ai' });
      return { url: this.signStatic(objectKey) };
    } finally {
      this.loginBgGenerating = false;
    }
  }
}
