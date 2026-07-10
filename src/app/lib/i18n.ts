/**
 * i18n 基建（P0）——轻量自研，不引第三方框架。
 *
 * 设计（docs/i18n-双语方案.md 定稿）：
 * - 「中文即 key」：t("批量转派") 在英文态查服务端字典 { 中文原文: 英文 }，
 *   缺 key 回退中文原文，永不白屏；中文态零查找直接返回。
 * - 字典存 systemSetting KV（i18n.dict.en），启动拉一次缓存；翻译管理页改完刷新即生效，不需发版。
 * - 语言偏好按用户存服务端（美国成员设英文后全模块英文，中方同页面看中文），
 *   localStorage 兜底缓存避免登录后闪中文。
 * - 模板插值：t("移交任务给 {name}", { name }) —— 字典里英文同样写 "Hand over to {name}"。
 */
import { useSyncExternalStore } from "react";
import { authFetch } from "./authSession";

export type I18nLang = "zh" | "en";

const LANG_CACHE_KEY = "inogi-lang";

let currentLang: I18nLang = (() => {
  try {
    const cached = localStorage.getItem(LANG_CACHE_KEY);
    return cached === "en" ? "en" : "zh";
  } catch {
    return "zh";
  }
})();
let dict: Record<string, string> = {};
let dictLoaded = false;
let dictVersion = 0;
/** 快照对象：语言或字典变化时替换引用，驱动 useSyncExternalStore 重渲染 */
let snapshot = { lang: currentLang, dictVersion };
const listeners = new Set<() => void>();

function emit() {
  snapshot = { lang: currentLang, dictVersion };
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 当前语言（非响应式；组件内请用 useI18n 保证切换即重渲染） */
export function currentI18nLang(): I18nLang {
  return currentLang;
}

/** 日期/时间格式化用的 locale（toLocaleDateString 等传参）：随界面语言切换 */
export function i18nLocale(): string {
  return currentLang === "en" ? "en-US" : "zh-CN";
}

/**
 * 翻译函数。zhText 是中文原文（即字典 key），vars 做 {name} 模板插值。
 * 英文态查字典，缺 key（含字典未加载完）回退中文。
 */
export function t(zhText: string, vars?: Record<string, string | number>): string {
  const template = currentLang === "en" ? (dict[zhText] ?? zhText) : zhText;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

/** 响应式入口：组件里 const { lang, t } = useI18n()；切换语言自动重渲染 */
export function useI18n() {
  const snap = useSyncExternalStore(subscribe, () => snapshot);
  return { lang: snap.lang, t };
}

async function loadDict(lang: I18nLang): Promise<void> {
  if (lang !== "en" || dictLoaded) return;
  try {
    const res = await authFetch(`/api/i18n/dict/en`);
    if (res.ok) {
      dict = (await res.json()) as Record<string, string>;
      dictLoaded = true;
      // 字典异步就绪必须广播：localStorage 缓存 en 时首屏在字典到位前已渲染（回退中文），
      // 没有数据加载的静态组件（如侧边栏）不会自行重渲染，会永远停在中文
      dictVersion += 1;
      emit();
    }
  } catch {
    // 字典拉取失败 → 全量回退中文，不影响使用
  }
}

/**
 * 登录后初始化：拉用户语言偏好 + （英文时）字典。
 * 失败时静默保持 localStorage 缓存的语言，不阻塞应用启动。
 */
export async function initI18n(): Promise<void> {
  try {
    const res = await authFetch(`/api/i18n/preference`);
    if (res.ok) {
      const { lang } = (await res.json()) as { lang?: string };
      const next: I18nLang = lang === "en" ? "en" : "zh";
      await loadDict(next);
      if (next !== currentLang) {
        currentLang = next;
        try {
          localStorage.setItem(LANG_CACHE_KEY, next);
        } catch { /* ignore */ }
        emit();
      }
    }
  } catch {
    // 离线/未登录：保持缓存语言
  }
  // localStorage 缓存了 en 但服务端偏好读取失败的场景：字典仍需可用
  await loadDict(currentLang);
}

/** 切换语言：本地立即生效（乐观），偏好异步写服务端 */
export async function setI18nLang(lang: I18nLang): Promise<void> {
  if (lang === currentLang) return;
  await loadDict(lang); // 先备好字典再切，避免闪中文
  currentLang = lang;
  try {
    localStorage.setItem(LANG_CACHE_KEY, lang);
  } catch { /* ignore */ }
  emit();
  void authFetch(`/api/i18n/preference`, {
    method: "PUT",
    body: JSON.stringify({ lang }),
    headers: { "Content-Type": "application/json" },
  }).catch(() => {});
}

/** 供翻译管理页/AI 初翻脚本刷新本地字典缓存（保存字典后调用） */
export async function reloadI18nDict(): Promise<void> {
  dictLoaded = false;
  await loadDict("en"); // 成功路径内部已 emit
}
