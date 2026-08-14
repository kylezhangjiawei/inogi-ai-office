import { createHash } from 'node:crypto';

import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { ChatService } from '../chat/chat.service';

/** 支持的界面语言。中文是源语言（文案以中文原文为 key），字典只存非中文语言。 */
export const I18N_LANGS = ['zh', 'en'] as const;
export type I18nLang = (typeof I18N_LANGS)[number];

const DICT_KEY = (lang: string) => `i18n.dict.${lang}`;
/** 译文状态元数据：{ 中文key: { status: 'ai' | 'human', updatedAt } } */
const META_KEY = (lang: string) => `i18n.meta.${lang}`;
/** 已登记的文案 key 全集（extract 脚本扫源码 t() 上报）：{ 中文key: { module } } */
const KEYS_KEY = 'i18n.keys';
const USER_LANGS_KEY = 'i18n.user-langs';
/** 用户内容按需翻译缓存：{ sha16(text): { en, at } }，FIFO 上限裁剪 */
const CONTENT_CACHE_KEY = 'i18n.content-cache';
const CONTENT_CACHE_MAX = 2000;
const CONTENT_MAX_CHARS = 4000;
const CATEGORY = 'i18n';
/** 单条译文长度上限（防误存长文/攻击性数据） */
const MAX_ENTRY_LEN = 500;
/** 字典条数上限 */
const MAX_ENTRIES = 20_000;

/**
 * i18n 基建（P0）：
 * - 字典存 systemSetting KV（i18n.dict.en = { 中文原文: 英文 }），改完即时生效不需发版；
 * - 用户语言偏好存 i18n.user-langs = { userId: 'en' | 'zh' }（KV，免 DB 迁移）；
 * - 中文即 key：前端 t("中文原文") 在英文态查字典，缺 key 回退中文，永不白屏。
 */
@Injectable()
export class I18nService {
  private readonly logger = new Logger(I18nService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chatService: ChatService,
  ) {}

  /** 读任意 i18n KV（对象形态），异常/缺失返回 {} */
  private async readKv(key: string): Promise<Record<string, unknown>> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key },
      select: { value: true },
    });
    const value = setting?.value;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private async writeKv(key: string, value: unknown, description: string): Promise<void> {
    await this.prisma.systemSetting.upsert({
      where: { key },
      create: { category: CATEGORY, key, value: value as never, description },
      update: { value: value as never },
    });
  }

  private assertLang(lang: string): asserts lang is I18nLang {
    if (!I18N_LANGS.includes(lang as I18nLang)) {
      throw new BadRequestException(`不支持的语言：${lang}`);
    }
  }

  async getDict(lang: string): Promise<Record<string, string>> {
    this.assertLang(lang);
    if (lang === 'zh') return {}; // 中文是源语言，无需字典
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: DICT_KEY(lang) },
      select: { value: true },
    });
    const value = setting?.value;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, string>)
      : {};
  }

  /**
   * 保存字典。mode=merge（默认）：在现有字典上合并/覆盖传入条目，值为 null/空串的键删除；
   * mode=replace：整体替换（导入 JSON 用）。
   */
  async saveDict(
    lang: string,
    entries: Record<string, string | null>,
    mode: 'merge' | 'replace' = 'merge',
    /** 状态标记：管理页人工编辑传 human（默认），AI 初翻链路传 ai */
    markStatus: 'ai' | 'human' = 'human',
  ): Promise<{ ok: true; count: number }> {
    this.assertLang(lang);
    if (lang === 'zh') throw new BadRequestException('中文是源语言，不存字典');
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
      throw new BadRequestException('entries 必须是 { 中文原文: 英文 } 对象');
    }

    const base = mode === 'replace' ? {} : await this.getDict(lang);
    for (const [key, value] of Object.entries(entries)) {
      const k = key.trim();
      if (!k || k.length > MAX_ENTRY_LEN) continue;
      if (value === null || (typeof value === 'string' && !value.trim())) {
        delete base[k];
        continue;
      }
      if (typeof value !== 'string') continue;
      base[k] = value.trim().slice(0, MAX_ENTRY_LEN);
    }
    const count = Object.keys(base).length;
    if (count > MAX_ENTRIES) {
      throw new BadRequestException(`字典条数超过上限 ${MAX_ENTRIES}`);
    }

    await this.writeKv(DICT_KEY(lang), base, `i18n dictionary: ${lang}`);

    // 同步译文状态元数据：新增/覆盖的 key 打标，删除的 key 清理；replace 模式整体重建
    const now = new Date().toISOString();
    const meta = mode === 'replace' ? {} : await this.readKv(META_KEY(lang));
    for (const [key, value] of Object.entries(entries)) {
      const k = key.trim();
      if (!k) continue;
      if (value === null || (typeof value === 'string' && !value.trim())) delete meta[k];
      else if (typeof value === 'string') meta[k] = { status: markStatus, updatedAt: now };
    }
    if (mode === 'replace') {
      for (const k of Object.keys(base)) {
        if (!meta[k]) meta[k] = { status: markStatus, updatedAt: now };
      }
    }
    await this.writeKv(META_KEY(lang), meta, `i18n translation status: ${lang}`);

    return { ok: true, count };
  }

  /** 登记文案 key 全集（extract 脚本上报）：{ 中文key: module }。replace 语义（以最新扫描为准）。 */
  async saveKeys(keys: Record<string, string>): Promise<{ ok: true; count: number }> {
    if (!keys || typeof keys !== 'object' || Array.isArray(keys)) {
      throw new BadRequestException('keys 必须是 { 中文原文: 模块名 } 对象');
    }
    const clean: Record<string, { module: string }> = {};
    for (const [key, module] of Object.entries(keys)) {
      const k = key.trim();
      if (!k || k.length > MAX_ENTRY_LEN) continue;
      clean[k] = { module: typeof module === 'string' ? module.slice(0, 80) : '' };
    }
    if (Object.keys(clean).length > MAX_ENTRIES) {
      throw new BadRequestException(`key 数超过上限 ${MAX_ENTRIES}`);
    }
    await this.writeKv(KEYS_KEY, clean, 'i18n registered source keys');
    return { ok: true, count: Object.keys(clean).length };
  }

  /**
   * 翻译管理页总览：key 全集（登记 ∪ 字典）+ 英文 + 状态 + 模块。
   * missingOnly=true 只返回缺英文的条目（AI 初翻的输入清单）。
   */
  async overview(lang: string, missingOnly = false) {
    this.assertLang(lang);
    const [dict, meta, keys] = await Promise.all([
      this.getDict(lang),
      this.readKv(META_KEY(lang)),
      this.readKv(KEYS_KEY),
    ]);
    const allKeys = new Set([...Object.keys(keys), ...Object.keys(dict)]);
    const rows = [...allKeys]
      .map((zh) => {
        const m = meta[zh] as { status?: string; updatedAt?: string } | undefined;
        const k = keys[zh] as { module?: string } | undefined;
        return {
          zh,
          en: dict[zh] ?? '',
          status: dict[zh] ? (m?.status === 'human' ? 'human' : 'ai') : 'missing',
          module: k?.module ?? '',
          updatedAt: m?.updatedAt ?? '',
        };
      })
      .filter((row) => !missingOnly || row.status === 'missing')
      .sort((a, b) => a.module.localeCompare(b.module) || a.zh.localeCompare(b.zh, 'zh-CN'));
    return { total: rows.length, rows };
  }

  /**
   * AI 双轮翻译（初翻 + UX Writer 校对），结果入库并标记 status=ai。
   * keys 为空时自动取全部「缺英文」的登记 key。分批调用，单批失败跳过不阻断。
   */
  async aiTranslate(lang: string, keys?: string[]): Promise<{ ok: true; translated: number; failed: number }> {
    this.assertLang(lang);
    if (lang === 'zh') throw new BadRequestException('中文是源语言');

    let targets = (keys ?? []).map((k) => k.trim()).filter(Boolean);
    if (targets.length === 0) {
      const { rows } = await this.overview(lang, true);
      targets = rows.map((r) => r.zh);
    }
    if (targets.length === 0) return { ok: true, translated: 0, failed: 0 };

    // 术语基准：现有字典里人工校准 + 已入库条目（AI 必须保持一致）
    const dict = await this.getDict(lang);
    const glossary = Object.entries(dict)
      .slice(0, 120)
      .map(([zh, en]) => `${zh} = ${en}`)
      .join('\n');

    const BATCH = 40;
    let translated = 0;
    let failed = 0;
    for (let i = 0; i < targets.length; i += BATCH) {
      const batch = targets.slice(i, i + BATCH);
      try {
        const draft = await this.translateBatch(batch, glossary);
        const reviewed = await this.reviewBatch(draft, glossary).catch(() => draft);
        const entries: Record<string, string> = {};
        for (const key of batch) {
          const value = reviewed[key] ?? draft[key];
          if (typeof value === 'string' && value.trim()) entries[key] = value.trim();
        }
        if (Object.keys(entries).length > 0) {
          await this.saveDict(lang, entries, 'merge', 'ai');
          translated += Object.keys(entries).length;
        }
        failed += batch.length - Object.keys(entries).length;
      } catch (err) {
        this.logger.warn(`AI 翻译批次失败(${i / BATCH + 1}): ${err instanceof Error ? err.message : err}`);
        failed += batch.length;
      }
    }
    return { ok: true, translated, failed };
  }

  /** 第一轮：带术语基准与 UI 语境的批量初翻，输出 JSON 字典 */
  private async translateBatch(keys: string[], glossary: string): Promise<Record<string, string>> {
    const result = await this.chatService.complete({
      scene: 'i18n.translation',
      system: [
        '你是企业办公系统的 UI 本地化译者，把中文界面文案翻译成简洁地道的英文。',
        '规则：',
        '1) 按钮/标签类短文案 ≤3 个词，用主流英文 SaaS 的惯用表达（如 Save / Batch Reassign）；',
        '2) 文案中的 {name} {n} 等花括号占位符必须原样保留在英文中；',
        '3) 下面的术语基准必须严格沿用，不得另造译法；',
        '4) 只输出 JSON 对象 { "中文原文": "English" }，key 与输入完全一致，不要输出其他内容。',
        '',
        '【术语基准】',
        glossary || '（暂无）',
      ].join('\n'),
      messages: [{ role: 'user', content: `翻译以下界面文案：\n${JSON.stringify(keys, null, 2)}` }],
      json: true,
      temperature: 0.2,
    });
    return this.parseJsonDict(result.content);
  }

  /** 第二轮：换 UX Writer 视角校对（术语一致性/母语语感/长度），输出修正后的完整 JSON */
  private async reviewBatch(
    draft: Record<string, string>,
    glossary: string,
  ): Promise<Record<string, string>> {
    const result = await this.chatService.complete({
      scene: 'i18n.translation',
      system: [
        'You are a senior UX writer for an English-first SaaS product.',
        'Review the machine-translated UI strings below. Fix: terminology inconsistency (must follow the glossary), unnatural phrasing, button labels longer than 3 words, and any lost {placeholder} tokens.',
        'Output ONLY the corrected full JSON object with identical keys.',
        '',
        '[Glossary]',
        glossary || '(none)',
      ].join('\n'),
      messages: [{ role: 'user', content: JSON.stringify(draft, null, 2) }],
      json: true,
      temperature: 0.2,
    });
    return this.parseJsonDict(result.content);
  }

  /**
   * 用户内容按需翻译（方案 P3/C：留痕正文、日报正文、任务描述等存库中文，英文用户点「翻译」时
   * 用系统内 AI 模型即时翻译并缓存——历史数据零迁移，不改变存库原文）。
   * 命中缓存直接返回；缓存 FIFO 上限裁剪防膨胀。
   */
  async translateContent(text: string): Promise<{ text: string; cached: boolean }> {
    const source = (text ?? '').trim();
    if (!source) throw new BadRequestException('text 不能为空');
    if (source.length > CONTENT_MAX_CHARS) {
      throw new BadRequestException(`内容超过 ${CONTENT_MAX_CHARS} 字上限`);
    }
    // 已是纯英文/无中文内容：原样返回，不浪费一次 AI 调用
    if (!/[一-鿿]/.test(source)) return { text: source, cached: true };

    const hash = createHash('sha256').update(source).digest('hex').slice(0, 16);
    const cache = await this.readKv(CONTENT_CACHE_KEY);
    const hit = cache[hash] as { en?: string } | undefined;
    if (hit?.en) return { text: hit.en, cached: true };

    const result = await this.chatService.complete({
      scene: 'i18n.translation',
      system:
        'You are a professional translator for an enterprise collaboration tool. Translate the user-generated content below from Chinese to natural English. ' +
        'Preserve line breaks, numbers, file names, person names and technical identifiers as-is. Output ONLY the translation, no preamble.',
      messages: [{ role: 'user', content: source }],
      temperature: 0.2,
    });
    const translated = (result.content ?? '').trim();
    if (!translated) throw new BadRequestException('翻译失败，请重试');

    // 超长内容不入缓存：2000 条长译文会把 KV 行撑到数 MB，每次请求整行读写线性变慢
    if (source.length > 1500) return { text: translated, cached: false };

    // 写缓存（FIFO：超上限丢最早写入的条目）
    const entries = Object.entries(cache);
    if (entries.length >= CONTENT_CACHE_MAX) {
      entries
        .sort((a, b) => String((a[1] as { at?: string })?.at ?? '').localeCompare(String((b[1] as { at?: string })?.at ?? '')))
        .slice(0, entries.length - CONTENT_CACHE_MAX + 1)
        .forEach(([k]) => delete cache[k]);
    }
    cache[hash] = { en: translated, at: new Date().toISOString() };
    await this.writeKv(CONTENT_CACHE_KEY, cache, 'i18n on-demand content translation cache');

    return { text: translated, cached: false };
  }

  private parseJsonDict(content: string): Record<string, string> {
    const raw = content.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new BadRequestException('AI 输出不是 JSON 对象');
    }
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  }

  async getUserLang(userId: string): Promise<I18nLang> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: USER_LANGS_KEY },
      select: { value: true },
    });
    const map =
      setting?.value && typeof setting.value === 'object' && !Array.isArray(setting.value)
        ? (setting.value as Record<string, string>)
        : {};
    const lang = map[userId];
    return I18N_LANGS.includes(lang as I18nLang) ? (lang as I18nLang) : 'zh';
  }

  async setUserLang(userId: string, lang: string): Promise<{ ok: true; lang: I18nLang }> {
    this.assertLang(lang);
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: USER_LANGS_KEY },
      select: { value: true },
    });
    const map =
      setting?.value && typeof setting.value === 'object' && !Array.isArray(setting.value)
        ? { ...(setting.value as Record<string, string>) }
        : {};
    if (lang === 'zh') delete map[userId];
    else map[userId] = lang;
    await this.prisma.systemSetting.upsert({
      where: { key: USER_LANGS_KEY },
      create: { category: CATEGORY, key: USER_LANGS_KEY, value: map, description: 'i18n per-user language preference' },
      update: { value: map },
    });
    return { ok: true, lang };
  }
}
