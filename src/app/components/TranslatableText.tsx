/**
 * 用户内容按需翻译（方案 P3/C）：中方写的留痕/描述/日报存库是中文原文，
 * 英文界面用户看到内容下方的「Translate」按钮，点击用系统内 AI 即时翻译（服务端缓存）。
 * 中文界面或内容本身无中文时不渲染按钮，显示原文；随时可切回原文。
 */
import React, { useState } from "react";
import { Languages, Loader2 } from "lucide-react";
import { authFetch } from "../lib/authSession";
import { t, useI18n } from "../lib/i18n";
import { cn } from "./ui/utils";

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
