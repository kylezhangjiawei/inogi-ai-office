/**
 * 问题模块共享的展示原子（徽标/芯片/等宽文本）。
 * 列表视图与详情视图都用这些，保证 6M 维度/严重度/状态/方案类型的视觉一致。
 */
import * as React from "react";
import { cn } from "../components/ui/utils";
import {
  DIMENSION_CONFIG,
  LIKELIHOOD_CONFIG,
  SEVERITY_CONFIG,
  SOLUTION_TYPE_CONFIG,
  SOURCE_LABEL,
  STATUS_CONFIG,
} from "../lib/issue/config";
import type { CauseDimension, IssueSource, IssueStatus, Likelihood, Severity, SolutionType } from "../lib/issue/types";
import { t } from "../lib/i18n";

/** 等宽文本：编号 / 时间戳 / 不良率 / 版本号。 */
export function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("font-mono tabular-nums", className)}>{children}</span>;
}

const pillBase = "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap";

export function SeverityBadge({ value, className }: { value: Severity; className?: string }) {
  const c = SEVERITY_CONFIG[value];
  return <span className={cn(pillBase, c.className, className)}>{t(c.label)}</span>;
}

export function StatusBadge({ value, className }: { value: IssueStatus; className?: string }) {
  const c = STATUS_CONFIG[value];
  return (
    <span className={cn(pillBase, c.className, className)}>
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", c.dot)} />
      {t(c.label)}
    </span>
  );
}

export function SourceTag({ value, className }: { value: IssueSource; className?: string }) {
  return <span className={cn("text-xs text-slate-500 dark:text-slate-400", className)}>{t(SOURCE_LABEL[value])}</span>;
}

export function SolutionTypeBadge({ value, className }: { value: SolutionType; className?: string }) {
  const c = SOLUTION_TYPE_CONFIG[value];
  return <span className={cn(pillBase, c.className, className)}>{t(c.label)}</span>;
}

/** 6M 维度芯片：可只显示单字色块，或带完整中文标签。 */
export function DimensionChip({ value, full = false, className }: { value: CauseDimension; full?: boolean; className?: string }) {
  const c = DIMENSION_CONFIG[value];
  return <span className={cn(pillBase, c.chip, className)}>{t(full ? c.full : c.label)}</span>;
}

/** 维度色块（小方块），用于分布图/图例。 */
export function DimensionSwatch({ value, className }: { value: CauseDimension; className?: string }) {
  return <span className={cn("h-2.5 w-2.5 shrink-0 rounded-[3px]", DIMENSION_CONFIG[value].swatch, className)} />;
}

export function LikelihoodIndicator({ value, className }: { value: Likelihood; className?: string }) {
  const c = LIKELIHOOD_CONFIG[value];
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", c.className, className)}>
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", c.dot)} />
      {t("可能性{level}", { level: t(c.label) })}
    </span>
  );
}
