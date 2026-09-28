import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight, ClipboardList } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { HorizonEmptyState } from '../../components/horizon/HorizonPage';
import './production.css';

export function ProductionEmpty({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  return <HorizonEmptyState Icon={ClipboardList} title={title} description={description} action={children} />;
}

export function ProductionPagination({ page, pageCount, total, onPageChange }: { page: number; pageCount: number; total: number; onPageChange: (page: number) => void }) {
  return <nav className="production-pagination" aria-label="列表分页"><span className="text-xs text-muted-foreground tabular-nums">共 {total} 项</span><div className="flex items-center gap-2"><Button type="button" size="sm" variant="outline" disabled={page <= 1} onClick={() => onPageChange(page - 1)} aria-label="上一页"><ChevronLeft className="size-4" aria-hidden="true" /></Button><span className="min-w-16 text-center text-xs tabular-nums">{page} / {pageCount}</span><Button type="button" size="sm" variant="outline" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)} aria-label="下一页"><ChevronRight className="size-4" aria-hidden="true" /></Button></div></nav>;
}

export function ProductionStatus({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'success' | 'warning' }) {
  return <span className="production-status" data-tone={tone}>{children}</span>;
}

export function ProductionMetrics({ items }: { items: { label: string; value: ReactNode; note?: ReactNode }[] }) {
  return <dl className="production-metrics">{items.map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd>{item.note ? <p>{item.note}</p> : null}</div>)}</dl>;
}
