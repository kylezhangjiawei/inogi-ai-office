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
  SLOT_HISTORY_MAX,
  slotHistoryKey,
  type SlotHistoryEntry,
} from '../chat/chat-streak.service';

export const CONTENT_SLOT_LOGIN_BG_KEY = 'content_slot.login_background';
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
  type: 'image' | 'text';
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
  staticText: string;
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
      staticText: typeof v.staticText === 'string' ? v.staticText : '',
    };
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
      type: 'image' | 'text';
      modes: SlotMode[];
      prompt_vars: string[];
      note: string;
      default_prompt: string;
      mode: SlotMode;
      prompt_template: string;
      static_text: string;
      has_static_image: boolean;
      current: { image_url: string | null; text: string | null; date: string | null } | null;
    }> = [];
    for (const def of SLOTS) {
      const config = await this.readConfig(def);
      let current: { image_url: string | null; text: string | null; date: string | null } | null = null;
      if (def.type === 'image') {
        if (config.mode === 'static') {
          current = { image_url: this.signStatic(config.staticImageObjectKey), text: null, date: null };
        } else if (def.key === 'matechat_mascot' && config.mode === 'ai_daily') {
          const m = await this.streakService.getCurrentMascot();
          current = { image_url: m.url, text: null, date: m.date };
        } else if (def.key === 'login_background' && config.mode === 'ai_daily') {
          const daily = await this.readLoginBgDaily();
          current = { image_url: daily.objectKey ? this.signStatic(daily.objectKey) : null, text: null, date: daily.date || null };
        } else if (def.key === 'login_background') {
          current = { image_url: DEFAULT_LOGIN_BG, text: null, date: null };
        }
      } else if (config.mode === 'static') {
        current = { image_url: null, text: config.staticText || null, date: null };
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
        has_static_image: Boolean(config.staticImageObjectKey),
        current,
      });
    }
    return { items };
  }

  /** 保存素材位配置（模式 + prompt + 固定文案 + 固定图 objectKey） */
  async updateConfig(
    key: string,
    payload: { mode?: string; promptTemplate?: string; staticText?: string; staticImageObjectKey?: string },
  ) {
    const def = this.def(key);
    const current = await this.readConfig(def);
    const mode: SlotMode =
      payload.mode === 'ai_daily' || payload.mode === 'static' || payload.mode === 'off'
        ? payload.mode
        : current.mode;
    if (!def.modes.includes(mode)) throw new BadRequestException('该素材位不支持此模式');

    const newObjectKey =
      typeof payload.staticImageObjectKey === 'string' && payload.staticImageObjectKey.trim()
        ? payload.staticImageObjectKey.trim()
        : current.staticImageObjectKey;
    const next: SlotConfig = {
      mode,
      promptTemplate:
        typeof payload.promptTemplate === 'string' && payload.promptTemplate.trim()
          ? payload.promptTemplate.trim()
          : current.promptTemplate,
      staticText: typeof payload.staticText === 'string' ? payload.staticText : current.staticText,
      staticImageObjectKey: newObjectKey,
    };
    await this.prisma.systemSetting.upsert({
      where: { key: def.kvKey },
      create: { key: def.kvKey, category: 'content_slot', value: next, description: def.name },
      update: { value: next, description: def.name },
    });
    // 新上传的固定图入历史
    if (newObjectKey && newObjectKey !== current.staticImageObjectKey) {
      await this.appendHistory(def.kvKey, {
        date: this.today(),
        objectKey: newObjectKey,
        source: 'upload',
      });
    }
    return { ok: true };
  }

  private today(): string {
    const sh = new Date(Date.now() + 8 * 3600 * 1000);
    return `${sh.getUTCFullYear()}-${String(sh.getUTCMonth() + 1).padStart(2, '0')}-${String(sh.getUTCDate()).padStart(2, '0')}`;
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

  /** 登录页背景（公开，免鉴权）：AI 每日 > 静态素材 > 系统默认外链 */
  async getLoginBackground(): Promise<{ url: string }> {
    const def = this.def('login_background');
    const config = await this.readConfig(def);
    if (config.mode === 'static') {
      const url = this.signStatic(config.staticImageObjectKey);
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
  @Cron('5 6 * * *', { name: 'content-slots-login-bg-daily' })
  async loginBgCron(): Promise<void> {
    await this.ensureLoginBgDaily(false);
  }

  /** 确保当日登录背景已生成（幂等 + 防并发）。force 无视「今日已就绪」与「非 AI 模式」。 */
  async ensureLoginBgDaily(force: boolean): Promise<{ url: string | null }> {
    const def = this.def('login_background');
    const config = await this.readConfig(def);
    if (!force && config.mode !== 'ai_daily') return { url: null };
    if (this.loginBgGenerating) return { url: null };
    const today = this.today();
    const daily = await this.readLoginBgDaily();
    if (!force && daily.date === today && daily.objectKey) {
      return { url: this.signStatic(daily.objectKey) };
    }
    this.loginBgGenerating = true;
    try {
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
