import React from 'react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '../ui/utils';

export type HorizonTone = 'brand' | 'success' | 'warning' | 'danger' | 'neutral';

export function HorizonPageHeader({
  Icon,
  eyebrow,
  title,
  description,
  meta,
  actions,
  className,
  titleLevel = 1,
}: {
  Icon: LucideIcon;
  eyebrow: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  titleLevel?: 1 | 2;
}) {
  const TitleTag = titleLevel === 2 ? 'h2' : 'h1';
  return (
    <header className={cn('hz-command', className)}>
      <div className="hz-command-heading">
        <span className="hz-command-mark" aria-hidden="true"><Icon className="size-5" /></span>
        <div className="min-w-0">
          <div className="hz-eyebrow">{eyebrow}</div>
          <TitleTag className="hz-title text-balance">{title}</TitleTag>
          {description ? <div className="hz-description text-pretty">{description}</div> : null}
          {meta ? <div className="hz-meta">{meta}</div> : null}
        </div>
      </div>
      {actions ? <div className="hz-actions">{actions}</div> : null}
    </header>
  );
}

export function HorizonMetricGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={cn('hz-stat-strip', className)}>{children}</section>;
}

export function HorizonMetric({
  Icon,
  label,
  value,
  note,
  tone = 'neutral',
}: {
  Icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  note?: React.ReactNode;
  tone?: HorizonTone;
}) {
  return (
    <div className="hz-stat" data-tone={tone}>
      <div className="min-w-0">
        <div className="hz-stat-label">{label}</div>
        <div className="hz-stat-value tabular-nums">{value}</div>
        {note ? <div className="hz-stat-note text-pretty">{note}</div> : null}
      </div>
      <span className="hz-stat-icon" aria-hidden="true"><Icon className="size-4" /></span>
    </div>
  );
}

export function HorizonSectionHeader({
  Icon,
  title,
  description,
  trailing,
}: {
  Icon?: LucideIcon;
  title: string;
  description?: string;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="hz-section-header">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-balance">
          {Icon ? <Icon className="size-4 text-[#002fa7]" aria-hidden="true" /> : null}
          {title}
        </h2>
        {description ? <p className="mt-1 text-pretty">{description}</p> : null}
      </div>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </div>
  );
}

export function HorizonEmptyState({
  Icon,
  title,
  description,
  action,
}: {
  Icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="hz-empty">
      <span className="hz-empty-icon" aria-hidden="true"><Icon className="size-5" /></span>
      <div className="font-semibold text-slate-800">{title}</div>
      {description ? <p className="max-w-md text-pretty">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
