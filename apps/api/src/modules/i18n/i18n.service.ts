import { BadRequestException, Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';

/** 支持的界面语言。中文是源语言（文案以中文原文为 key），字典只存非中文语言。 */
export const I18N_LANGS = ['zh', 'en'] as const;
export type I18nLang = (typeof I18N_LANGS)[number];

const DICT_KEY = (lang: string) => `i18n.dict.${lang}`;
const USER_LANGS_KEY = 'i18n.user-langs';
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
  constructor(private readonly prisma: PrismaService) {}

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

    const storeKey = DICT_KEY(lang);
    await this.prisma.systemSetting.upsert({
      where: { key: storeKey },
      create: { category: CATEGORY, key: storeKey, value: base, description: `i18n dictionary: ${lang}` },
      update: { value: base },
    });
    return { ok: true, count };
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
