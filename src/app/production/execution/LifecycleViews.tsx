import { useId, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { ArrowLeft, Search } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { NativeSelect } from '../../components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { ProductionEmpty, ProductionPagination } from './ProductionView';
import { productionPage, productionSearch } from './productionViewState';

export type LifecycleRecordType = 'transfer' | 'ecn' | 'batch' | 'shipment';

/** Detail navigation must retain the plan, month and each list's filters. */
export function lifecycleRecordParams(current: URLSearchParams, record?: { type: LifecycleRecordType; id: string }) {
  const next = new URLSearchParams(current);
  if (record) {
    next.set('record', record.id);
    next.set('recordType', record.type);
  } else {
    next.delete('record');
    next.delete('recordType');
  }
  return next;
}

export interface LifecycleColumn<T> {
  label: string;
  cell: (row: T) => ReactNode;
  className?: string;
}

export function LifecycleTable<T>({ title, description, scope, rows, columns, rowKey, searchText, searchPlaceholder = '搜索编号、名称或经办人', status, actions, emptyTitle = '暂无记录', emptyDescription }: {
  title: string;
  description?: string;
  scope: string;
  rows: T[];
  columns: LifecycleColumn<T>[];
  rowKey: (row: T) => string;
  searchText: (row: T) => string;
  searchPlaceholder?: string;
  status?: { value: (row: T) => string; options: { value: string; label: string }[] };
  actions?: ReactNode;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  const id = useId();
  const [params, setParams] = useSearchParams();
  const searchKey = `${scope}Search`, statusKey = `${scope}Status`, pageKey = `${scope}Page`;
  const query = params.get(searchKey) ?? '', selectedStatus = params.get(statusKey) ?? 'all';
  const filtered = rows.filter(row => productionSearch(query, [searchText(row)]) && (!status || selectedStatus === 'all' || status.value(row) === selectedStatus));
  const { page, pageCount, rows: visibleRows } = productionPage(filtered, params.get(pageKey));
  function update(key: string, value: string) {
    setParams(previous => {
      const next = new URLSearchParams(previous);
      if (!value || value === 'all' || (key === pageKey && value === '1')) next.delete(key);
      else next.set(key, value);
      if (key !== pageKey) next.delete(pageKey);
      return next;
    }, { replace: true });
  }
  return <section className="production-surface overflow-hidden rounded-2xl border border-border bg-card" aria-labelledby={id}>
    <div className="production-section-heading flex flex-wrap items-start justify-between gap-3 p-4">
      <div className="min-w-0"><h2 id={id} className="text-base font-semibold">{title}<span className="ml-2 text-xs font-normal text-muted-foreground">{rows.length} 项</span></h2>{description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}</div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
    {rows.length > 0 ? <>
      <div className="production-toolbar flex flex-wrap items-center gap-3 border-y border-border px-4 py-3">
        <div className="relative min-w-0 flex-1 sm:max-w-sm"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><Input type="search" aria-label={`搜索${title}`} className="pl-9" placeholder={searchPlaceholder} value={query} onChange={event => update(searchKey, event.target.value)} /></div>
        {status && <NativeSelect aria-label={`${title}状态`} className="w-full sm:w-36" value={selectedStatus} onChange={event => update(statusKey, event.target.value)}><option value="all">全部状态</option>{status.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</NativeSelect>}
      </div>
      {filtered.length ? <Table className="production-table"><caption className="sr-only">{title}</caption><TableHeader><TableRow>{columns.map(column => <TableHead key={column.label} scope="col">{column.label}</TableHead>)}</TableRow></TableHeader><TableBody>{visibleRows.map(row => <TableRow key={rowKey(row)}>{columns.map(column => <TableCell key={column.label} className={column.className}>{column.cell(row)}</TableCell>)}</TableRow>)}</TableBody></Table> : <ProductionEmpty title="没有符合条件的记录" description="调整关键词或状态后重试。"><Button variant="outline" onClick={() => { setParams(previous => { const next = new URLSearchParams(previous); next.delete(searchKey); next.delete(statusKey); next.delete(pageKey); return next; }, { replace: true }); }}>清除筛选</Button></ProductionEmpty>}
      <ProductionPagination page={page} pageCount={pageCount} total={filtered.length} onPageChange={next => update(pageKey, String(next))} />
    </> : <ProductionEmpty title={emptyTitle} description={emptyDescription} />}
  </section>;
}

export function LifecycleDetailHeader({ title, description, status, actions, onBack }: { title: string; description: string; status?: ReactNode; actions?: ReactNode; onBack: () => void }) {
  return <header className="space-y-3">
    <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="size-4" aria-hidden="true" />返回列表</Button>
    <div className="production-detail-heading"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="break-words text-xl font-semibold">{title}</h2>{status}</div><p className="mt-1 text-sm text-muted-foreground">{description}</p></div>{actions && <div className="flex flex-wrap gap-2">{actions}</div>}</div>
  </header>;
}

export function LifecycleFields({ title, items }: { title: string; items: { label: string; value: ReactNode; full?: boolean }[] }) {
  return <section className="production-surface"><div className="production-section-heading"><h3>{title}</h3></div><dl className="production-details production-details--two">{items.map(item => <div key={item.label} className={item.full ? 'min-w-0 col-span-full' : 'min-w-0'}><dt>{item.label}</dt><dd>{item.value ?? '未登记'}</dd></div>)}</dl></section>;
}

export function LifecycleLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <Button variant="unstyled" type="button" className="production-link max-w-full whitespace-normal break-words text-left font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={onClick}>{children}</Button>;
}

export function lifecycleDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}
