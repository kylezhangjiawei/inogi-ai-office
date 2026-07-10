/**
 * 用户内容按需翻译（方案 P3/C）：中方写的留痕/描述/日报存库是中文原文，
 * 英文界面用户看到内容下方的「Translate」按钮，点击用系统内 AI 即时翻译（服务端缓存）。
 * 中文界面或内容本身无中文时不渲染按钮，显示原文；随时可切回原文。
 */
import React, { useEffect, useState } from "react";
import { Languages, Loader2 } from "lucide-react";
import { authFetch } from "../lib/authSession";
import { t, useI18n } from "../lib/i18n";
import { cn } from "./ui/utils";

// ── 自动翻译（混合模式的"短文本"路线）────────────────────────────────────────
// 模块级缓存 + in-flight 去重 + 并发限制：列表页几十条标题同时挂载时，
// 相同文本只发一次请求，且并发不超过上限（服务端有 sha256 缓存，二次访问秒回）。
const autoCache = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();
const MAX_CONCURRENT = 4;
let running = 0;
const waiters: Array<() => void> = [];

async function acquireSlot(): Promise<void> {
  if (running < MAX_CONCURRENT) {
    running += 1;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  running += 1;
}

function releaseSlot() {
  running -= 1;
  waiters.shift()?.();
}

async function fetchTranslation(source: string): Promise<string | null> {
  const cached = autoCache.get(source);
  if (cached) return cached;
  const pending = inflight.get(source);
  if (pending) return pending;
  const task = (async () => {
    await acquireSlot();
    try {
      const res = await authFetch("/api/i18n/translate-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: source }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { text?: string };
      if (data.text) {
        autoCache.set(source, data.text);
        return data.text;
      }
      return null;
    } catch {
      return null;
    } finally {
      releaseSlot();
      inflight.delete(source);
    }
  })();
  inflight.set(source, task);
  return task;
}

/**
 * 短文本自动翻译（任务标题、通知正文等一两句话的动态内容）：
 * 英文界面下含中文时自动请求翻译，等待期先显示原文（不闪烁不跳版），
 * 译文渲染后悬停可见中文原文；中文界面或纯英文内容原样直出，零行为差异。
 * 长正文（留痕、描述）请继续用 TranslatableText 的按钮式翻译，保住存证保真。
 */
export function AutoTranslatedText({
  text,
  className,
  as: Tag = "span",
}: {
  text: string;
  className?: string;
  as?: "p" | "div" | "span";
}) {
  const { lang } = useI18n();
  const source = (text ?? "").trim();
  const need = lang === "en" && /[一-鿿]/.test(source);
  const [translated, setTranslated] = useState<string | null>(() =>
    need ? (autoCache.get(source) ?? null) : null,
  );

  useEffect(() => {
    if (!need) return;
    const cached = autoCache.get(source);
    if (cached) {
      setTranslated(cached);
      return;
    }
    let alive = true;
    void fetchTranslation(source).then((result) => {
      if (alive && result) setTranslated(result);
    });
    return () => {
      alive = false;
    };
  }, [source, need]);

  if (!source) return null;
  const showTranslated = need && translated;
  return (
    <Tag className={className} title={showTranslated ? source : undefined}>
      {showTranslated ? translated : source}
    </Tag>
  );
}

export function TranslatableText({
  text,
  className,
  as: Tag = "p",
}: {
  text: string;
  className?: string;
  /** 渲染原文的标签（默认 p；留痕列表等场景可传 span/div） */
  as?: "p" | "div" | "span";
}) {
  const { lang } = useI18n();
  const [translated, setTranslated] = useState<string | null>(null);
  const [showTranslated, setShowTranslated] = useState(false);
  const [loading, setLoading] = useState(false);

  const source = (text ?? "").trim();
  const canTranslate = lang === "en" && /[一-鿿]/.test(source);

  const handleTranslate = async () => {
    if (translated) {
      setShowTranslated((prev) => !prev);
      return;
    }
    setLoading(true);
    try {
      const res = await authFetch("/api/i18n/translate-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: source }),
      });
      if (!res.ok) throw new Error("translate failed");
      const data = (await res.json()) as { text: string };
      setTranslated(data.text);
      setShowTranslated(true);
    } catch {
      // 静默失败：保持原文，按钮可重试
    } finally {
      setLoading(false);
    }
  };

  if (!source) return null;

  return (
    <>
      <Tag className={className}>{showTranslated && translated ? translated : source}</Tag>
      {canTranslate && (
        <button
          type="button"
          onClick={() => void handleTranslate()}
          disabled={loading}
          className={cn(
            "mt-1 inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors",
            showTranslated ? "text-slate-400 hover:text-slate-600" : "text-indigo-500 hover:bg-indigo-50 hover:text-indigo-700",
          )}
        >
          {loading ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Languages className="h-2.5 w-2.5" />}
          {showTranslated ? t("显示原文") : "Translate"}
        </button>
      )}
    </>
  );
}
