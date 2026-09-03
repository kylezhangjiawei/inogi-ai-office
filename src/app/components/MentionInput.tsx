import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "./ui/utils";
import { t } from "../lib/i18n";

/**
 * 评论 @ 提及的共享逻辑与候选面板。
 *
 * 设计：一套数据逻辑（useMentions）+ 两种呈现（MentionSuggestionPanel 的
 * desktop 下拉 / mobile 横向候选条）。宿主输入框保持普通 textarea——
 * 正文中以纯文本 `@姓名 ` 存在，提交时以「结构化 mentions + 正文仍含 @姓名」
 * 双条件过滤（用户手动删掉 @ 文本后不再通知该人）。
 */

export type MentionCandidate = {
  user_id: string | null;
  name: string;
  /** 展示用小注（如 任务主责人 / 协作人 / 角色名） */
  hint?: string;
};

type ActiveQuery = { query: string; start: number };

/**
 * 从光标前文本解析未完成的 @ 查询片段：`…@张` → { query: '张' }。
 * 查询允许含单个空格（英文全名 "John Smith"），但两个连续空格视为查询结束，
 * 避免 @ 一直吞掉后续整句正文。
 */
function parseActiveQuery(value: string, caret: number): ActiveQuery | null {
  const before = value.slice(0, caret);
  // @ 前需是行首或空白；查询体不含 @、不含换行、不含连续空格，长度 ≤20
  const match = /(?:^|[\s　])@((?:[^@\s　]| (?! )){0,20})$/.exec(before);
  if (!match) return null;
  return { query: match[1], start: caret - match[1].length - 1 };
}

export function useMentions(opts: {
  value: string;
  setValue: (next: string) => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  candidates: MentionCandidate[];
}) {
  const { value, setValue, inputRef, candidates } = opts;
  const [active, setActive] = useState<ActiveQuery | null>(null);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [selected, setSelected] = useState<MentionCandidate[]>([]);

  /**
   * 输入/点击/移动光标后重算当前 @ 查询（宿主在 onChange/onClick/onKeyUp 里调用）。
   * 查询没变时必须原样返回：↑/↓ 在 keydown 里已 preventDefault（光标不动），但 keyup 照常触发，
   * 若这里无条件把高亮清零，键盘上下选择就永远停在第一个候选。
   */
  const syncActiveQuery = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const next = parseActiveQuery(el.value, el.selectionStart ?? el.value.length);
    if (active && next && active.query === next.query && active.start === next.start) return;
    setActive(next);
    setHighlightIndex(0);
  }, [active, inputRef]);

  // 不截断候选：面板/候选条本身可滚动；一旦截断，部门人数多于上限时后面的人永远选不到。
  const filtered = useMemo(() => {
    if (active === null) return [];
    const kw = active.query.trim().toLowerCase();
    if (!kw) return candidates;
    return candidates.filter((c) => c.name.toLowerCase().includes(kw));
  }, [active, candidates]);

  const open = active !== null && filtered.length > 0;

  /** 选中候选：把 `@查询` 替换为 `@姓名 `，光标落在其后 */
  const pick = useCallback((candidate: MentionCandidate) => {
    const el = inputRef.current;
    if (!el || active === null) return;
    const caret = el.selectionStart ?? el.value.length;
    const inserted = `@${candidate.name} `;
    const next = el.value.slice(0, active.start) + inserted + el.value.slice(caret);
    setValue(next);
    setSelected((prev) => (prev.some((m) => (m.user_id && m.user_id === candidate.user_id) || m.name === candidate.name) ? prev : [...prev, candidate]));
    setActive(null);
    // React 受控更新后再落光标
    const pos = active.start + inserted.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }, [active, inputRef, setValue]);

  /** 宿主 onKeyDown 前置调用：面板打开时接管 上下/回车/ESC，返回 true 表示事件已消费 */
  const handleKeyDown = useCallback((event: React.KeyboardEvent): boolean => {
    if (!open) return false;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightIndex((i) => (i + 1) % filtered.length);
      return true;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightIndex((i) => (i - 1 + filtered.length) % filtered.length);
      return true;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      pick(filtered[highlightIndex] ?? filtered[0]);
      return true;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setActive(null);
      return true;
    }
    return false;
  }, [open, filtered, highlightIndex, pick]);

  /**
   * 提交时取有效提及：正文中仍存在「@姓名」且其后是边界（空白/串尾/标点）的才算数，
   * 并按 user_id / 姓名去重。边界匹配避免「@张三丰」误判为包含「@张三」。
   */
  const mentionsForSubmit = useCallback((text: string) => {
    const seen = new Set<string>();
    const out: Array<{ user_id?: string; name: string }> = [];
    for (const m of selected) {
      const escaped = m.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // @姓名 后必须是空白 / 串尾 / 非「名字字符」的标点，杜绝前缀误命中
      const re = new RegExp(`@${escaped}(?=$|[\\s　]|[^\\w\\u4e00-\\u9fa5])`);
      if (!re.test(text)) continue;
      const key = m.user_id || `name:${m.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ user_id: m.user_id ?? undefined, name: m.name });
    }
    return out;
  }, [selected]);

  const resetMentions = useCallback(() => {
    setSelected([]);
    setActive(null);
  }, []);

  return { open, filtered, highlightIndex, pick, handleKeyDown, syncActiveQuery, mentionsForSubmit, resetMentions };
}

/** 候选面板高度：上限 420px（约 13 人一屏），下限 160px（空间再窄也留 5 行），与视口边缘留 12px。 */
const PANEL_MAX_HEIGHT = 420;
const PANEL_MIN_HEIGHT = 160;
const PANEL_VIEWPORT_MARGIN = 12;

/**
 * 面板可用的上下边界：视口内缩 PANEL_VIEWPORT_MARGIN，再被每一层「会裁剪的祖先」收窄。
 * 绝对定位的面板会被 overflow 非 visible 的祖先裁掉，只按视口算高度会撑出容器外看不见。
 */
function clipBounds(anchor: HTMLElement): { top: number; bottom: number } {
  let top = PANEL_VIEWPORT_MARGIN;
  let bottom = window.innerHeight - PANEL_VIEWPORT_MARGIN;
  for (let node = anchor.parentElement; node; node = node.parentElement) {
    const style = window.getComputedStyle(node);
    // overflow-x/y 只要有一侧非 visible，另一侧就会被浏览器算成 auto，故任一侧非 visible 即裁剪
    if (style.overflowY === "visible" && style.overflowX === "visible") continue;
    const rect = node.getBoundingClientRect();
    top = Math.max(top, rect.top);
    bottom = Math.min(bottom, rect.bottom);
  }
  return { top, bottom };
}

/** 候选面板：desktop = 贴着输入框上/下弹的列表；mobile = 输入框上方的横向候选条 */
export function MentionSuggestionPanel({
  open,
  candidates,
  highlightIndex,
  onPick,
  variant,
  className,
}: {
  open: boolean;
  candidates: MentionCandidate[];
  highlightIndex: number;
  onPick: (candidate: MentionCandidate) => void;
  variant: "desktop" | "mobile";
  className?: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<{ placement: "up" | "down"; maxHeight: number }>({
    placement: "up",
    maxHeight: PANEL_MAX_HEIGHT,
  });

  // 按输入框上下的剩余空间决定往上弹还是往下弹，并把面板撑到该侧可用高度（上限 PANEL_MAX_HEIGHT）。
  // 原先写死向上弹 + 固定 224px：输入框贴近视口顶部时面板会被裁掉，且一屏只装得下 7 个人。
  useLayoutEffect(() => {
    if (!open || variant !== "desktop") return;
    const anchor = panelRef.current?.offsetParent;
    if (!(anchor instanceof HTMLElement)) return;
    const rect = anchor.getBoundingClientRect();
    const bounds = clipBounds(anchor);
    const spaceAbove = rect.top - bounds.top;
    const spaceBelow = bounds.bottom - rect.bottom;
    // 空间相当时保持向上（沿用原有观感），只有下方明显更宽裕才翻到下面
    const up = spaceAbove >= spaceBelow;
    const available = up ? spaceAbove : spaceBelow;
    setLayout({
      placement: up ? "up" : "down",
      maxHeight: Math.max(PANEL_MIN_HEIGHT, Math.min(PANEL_MAX_HEIGHT, available)),
    });
  }, [open, variant, candidates.length]);

  // 候选不再截断，键盘上下移动时需把高亮项带进可视区，否则长名单下高亮会跑出滚动区。
  // 只改候选区自身的 scrollTop（不用 scrollIntoView），避免连带滚动外层评论流。
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    const item = list?.children[highlightIndex];
    if (!list || !(item instanceof HTMLElement)) return;
    const listRect = list.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    if (itemRect.top < listRect.top) list.scrollTop -= listRect.top - itemRect.top;
    else if (itemRect.bottom > listRect.bottom) list.scrollTop += itemRect.bottom - listRect.bottom;
  }, [open, highlightIndex]);

  if (!open) return null;

  if (variant === "mobile") {
    return (
      <div ref={listRef} className={cn("flex gap-1.5 overflow-x-auto px-1 pb-1.5", className)}>
        {candidates.map((c) => (
          <button
            key={c.user_id ?? c.name}
            type="button"
            // 软键盘不失焦：mousedown/touch 阶段阻止默认，避免键盘收起
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(c)}
            className="flex shrink-0 items-center gap-1 rounded-[4px] border border-[#b8c8ec] bg-[#eef3ff] px-3 py-1.5 text-[13px] font-medium text-[#002fa7] active:bg-[#dfe8ff]"
          >
            @{c.name}
            {c.hint && <span className="text-[10px] text-[#526da8]">{c.hint}</span>}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div
      ref={panelRef}
      style={{ maxHeight: layout.maxHeight }}
      className={cn(
        "absolute left-0 z-30 flex w-64 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg",
        layout.placement === "up" ? "bottom-full mb-1" : "top-full mt-1",
        className,
      )}
    >
      <div className="shrink-0 border-b border-slate-100 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        {t("选择要提及的成员")}
      </div>
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1">
        {candidates.map((c, i) => (
          <button
            key={c.user_id ?? c.name}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(c)}
            className={cn(
              "flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-left text-sm",
              i === highlightIndex ? "bg-[#eef3ff] text-[#002fa7]" : "text-slate-700 hover:bg-slate-50",
            )}
          >
            <span className="truncate font-medium">@{c.name}</span>
            {c.hint && <span className="shrink-0 text-[11px] text-slate-400">{c.hint}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 渲染态高亮：把正文中的 @姓名 片段渲染为蓝色（按结构化 mentions 匹配，避免误伤普通 @ 文本） */
export function renderTextWithMentions(
  text: string,
  mentions?: Array<{ user_id?: string | null; name?: string | null }> | null,
  mentionClassName = "rounded-[3px] bg-[#eef3ff] px-1 font-semibold text-[#002fa7]",
): React.ReactNode {
  const names = (mentions ?? [])
    .map((m) => (m.name ?? "").trim())
    .filter(Boolean)
    // 长名优先匹配，防止「张三丰」被「张三」截胡
    .sort((a, b) => b.length - a.length);
  if (names.length === 0) return text;
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`@(?:${escaped.join("|")})`, "g");
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(re)) {
    const idx = match.index ?? 0;
    if (idx > last) parts.push(text.slice(last, idx));
    parts.push(
      <span key={`${idx}-${match[0]}`} className={mentionClassName}>
        {match[0]}
      </span>,
    );
    last = idx + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
