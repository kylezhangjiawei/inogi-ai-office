import React from 'react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '../../components/ui/utils';
import { HorizonPageHeader, HorizonMetricGrid, HorizonMetric } from '../../components/horizon/HorizonPage';

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
  return <HorizonPageHeader Icon={Icon} eyebrow={eyebrow} title={title} description={description}
    meta={meta} actions={actions} className={cn('horizon-theme order-horizon-page-header', className)} />;
}

export function OrderMetricGrid({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <HorizonMetricGrid className={cn('horizon-theme order-horizon-metric-grid', className)}>{children}</HorizonMetricGrid>;
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
  return <HorizonMetric Icon={Icon} label={label} value={value} note={note}
    tone={tone === 'primary' ? 'brand' : tone} />;
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
