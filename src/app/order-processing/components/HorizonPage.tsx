import React from 'react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '../../components/ui/utils';

export type OrderMetricTone = 'primary' | 'success' | 'warning' | 'danger' | 'neutral';

export function OrderPageHeader({
  Icon,
  eyebrow,
  title,
  description,
  meta,
  actions,
  className,
}: {
  Icon: LucideIcon;
  eyebrow: string;
  title: string;
  description?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('order-horizon-command', className)}>
      <div className="order-horizon-command-heading">
        <span className="order-horizon-command-mark" aria-hidden="true">
          <Icon className="size-5" />
        </span>
        <div className="order-horizon-command-copy">
          <div className="order-horizon-eyebrow">{eyebrow}</div>
          <h1 className="text-balance">{title}</h1>
          {description ? <div className="order-horizon-description text-pretty">{description}</div> : null}
          {meta ? <div className="order-horizon-meta">{meta}</div> : null}
        </div>
      </div>
      {actions ? <div className="order-horizon-actions">{actions}</div> : null}
    </header>
  );
}

export function OrderMetricGrid({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <section className={cn('order-horizon-metric-grid', className)}>{children}</section>;
}

export function OrderMetric({
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
  tone?: OrderMetricTone;
}) {
  return (
    <div className="order-horizon-metric" data-tone={tone}>
      <div className="order-horizon-metric-copy">
        <div className="order-horizon-metric-label">{label}</div>
        <div className="order-horizon-metric-value tabular-nums">{value}</div>
        {note ? <div className="order-horizon-metric-note text-pretty">{note}</div> : null}
      </div>
      <span className="order-horizon-metric-icon" aria-hidden="true">
        <Icon className="size-4" />
      </span>
    </div>
  );
}

export function OrderEmptyState({
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
    <div className="order-horizon-empty">
      <span className="order-horizon-empty-icon" aria-hidden="true"><Icon className="size-5" /></span>
      <div className="font-semibold text-slate-800">{title}</div>
      {description ? <p className="max-w-md text-pretty">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
