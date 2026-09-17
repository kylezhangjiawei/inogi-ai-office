import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ColorPicker } from "@univerjs/preset-sheets-core";
import type { IColorPickerProps } from "@univerjs/preset-sheets-core";
import "./RDSheetRecentColorPicker.css";
import { Button } from "./components/ui/button";

const RECENT_COLOR_LIMIT = 9;
const RECENT_COLORS_CHANGED_EVENT = "inogi:rd-sheet-recent-colors-changed";

type Props = IColorPickerProps & {
  storageKey: string;
};

function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const color = value.trim();
  const shortMatch = /^#([0-9a-f]{3})$/i.exec(color);
  if (shortMatch) {
    return `#${shortMatch[1]
      .split("")
      .map((part) => `${part}${part}`)
      .join("")}`.toUpperCase();
  }
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toUpperCase() : null;
}

function readRecentColors(storageKey: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    const colors: string[] = [];
    for (const item of parsed) {
      const color = normalizeHexColor(item);
      if (color && !colors.includes(color)) colors.push(color);
      if (colors.length >= RECENT_COLOR_LIMIT) break;
    }
    return colors;
  } catch {
    return [];
  }
}

function rememberColor(storageKey: string, value: string): string[] {
  const color = normalizeHexColor(value);
  if (!color) return readRecentColors(storageKey);
  const next = [
    color,
    ...readRecentColors(storageKey).filter((item) => item !== color),
  ].slice(0, RECENT_COLOR_LIMIT);
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(RECENT_COLORS_CHANGED_EVENT, { detail: storageKey }));
  } catch {
    // 隐私模式或浏览器禁用本地存储时，当前会话仍可通过组件 state 使用最近颜色。
  }
  return next;
}

/**
 * Univer 内置颜色面板的薄包装：保留原主题色/更多颜色能力，并补充按用户持久化的最近使用颜色。
 */
export function RDSheetRecentColorPicker({ storageKey, value, onChange, ...props }: Props) {
  const [recentColors, setRecentColors] = useState<string[]>(() => readRecentColors(storageKey));

  useEffect(() => {
    const refresh = () => setRecentColors(readRecentColors(storageKey));
    const handleStorage = (event: StorageEvent) => {
      if (event.key === storageKey) refresh();
    };
    const handleLocalChange = (event: Event) => {
      if (event instanceof CustomEvent && event.detail === storageKey) refresh();
    };
    refresh();
    window.addEventListener("storage", handleStorage);
    window.addEventListener(RECENT_COLORS_CHANGED_EVENT, handleLocalChange);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(RECENT_COLORS_CHANGED_EVENT, handleLocalChange);
    };
  }, [storageKey]);

  const selectedColor = useMemo(() => normalizeHexColor(value), [value]);
  const selectColor = useCallback((color: string) => {
    setRecentColors(rememberColor(storageKey, color));
    onChange?.(color);
  }, [onChange, storageKey]);

  return (
    <div
      className="rd-sheet-color-picker"
      data-rd-sheet-color-picker="true"
      onClick={(event) => event.stopPropagation()}
    >
      <ColorPicker {...props} value={value} onChange={selectColor} />
      <section className="rd-sheet-recent-colors" aria-label="最近使用颜色">
        <div className="rd-sheet-recent-colors__title">最近使用颜色</div>
        <div className="rd-sheet-recent-colors__grid">
          {recentColors.map((color) => {
            const selected = color === selectedColor;
            return (
              <Button variant="unstyled"
                key={color}
                type="button"
                className="rd-sheet-recent-colors__swatch"
                data-selected={selected ? "true" : "false"}
                style={{ backgroundColor: color }}
                title={`使用最近颜色 ${color}`}
                aria-label={`使用最近颜色 ${color}`}
                aria-pressed={selected}
                onClick={() => selectColor(color)}
              />
            );
          })}
        </div>
      </section>
    </div>
  );
}

