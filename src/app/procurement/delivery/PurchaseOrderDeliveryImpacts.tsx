import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../auth';
import { Button } from '../../components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { getPurchaseDeliveryImpacts, type PurchaseDeliveryImpacts } from '../../lib/purchaseDeliveryApi';
import { routePath } from '../../lib/routePaths';

export function PurchaseOrderDeliveryImpacts({ lineId, orderNo, refreshKey }: { lineId: string; orderNo: string; refreshKey: string }) {
  const { user } = useAuth(), permissions = user?.permissions ?? [];
  const canRead = permissions.includes('*') || (permissions.some(permission => ['page:purchase-orders', 'page:purchase-order-detail'].includes(permission)) && permissions.includes('page:production-execution') && permissions.some(permission => ['production:plan', 'production:view-all', 'production:inspect'].includes(permission)));
  const [open, setOpen] = useState(false), [page, setPage] = useState(1), [reload, setReload] = useState(0);
  const [stored, setStored] = useState<{ scope: string; data?: PurchaseDeliveryImpacts; error?: string } | null>(null);
  const scope = JSON.stringify([lineId, orderNo, refreshKey, page, reload, user?.id, permissions]);
  const current = stored?.scope === scope ? stored : null;
  useEffect(() => {
    if (!open || !canRead) return;
    const controller = new AbortController();
    getPurchaseDeliveryImpacts(lineId, orderNo, page, controller.signal).then(data => { if (!controller.signal.aborted) setStored({ scope, data }); }).catch(cause => { if (!controller.signal.aborted) setStored({ scope, error: cause instanceof Error ? cause.message : '影响计划读取失败' }); });
    return () => controller.abort();
  }, [open, canRead, scope, lineId, orderNo, page]);
  if (!canRead) return null;
  const data = current?.data, quantity = (value: number | null, unit: string) => value === null ? '待核对' : `${value.toLocaleString()} ${unit}`;
  return <details className="rounded-xl border border-border p-3" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer text-sm font-semibold">影响计划与批次</summary>
    {open && <div className="mt-3 space-y-3">
      <p className="text-xs leading-5 text-muted-foreground">查看本订单行已分配的计划与批次，核对数量和预计可用日期。</p>
      {!current ? <p role="status" className="text-sm text-muted-foreground">正在核对原分配…</p> : current.error ? <p role="alert" className="text-sm text-destructive">{current.error}</p> : data && <>
        {!!data.unresolvedCount && <p role="status" className="text-xs text-amber-700">另有 {data.unresolvedCount} 项原分配的计划或批次已不可用，需核对原记录。</p>}
        {data.items.length ? <Table containerClassName="max-h-[min(50dvh,30rem)] overflow-auto" className="min-w-[700px]"><TableHeader className="sticky top-0 bg-card"><TableRow>{['产品 / 范围', '需求 / 检验后可用', '原登记 / 有效分配', '按期覆盖 / 判断', '操作'].map(label => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>{data.items.map(row => <TableRow key={row.scopeId}><TableCell className="max-w-56 whitespace-normal"><p className="font-medium">{row.productName}</p><p className="mt-1 text-xs text-muted-foreground">{row.month} · {row.productLine} · {row.batchCode || '整月计划'}</p></TableCell><TableCell className="text-xs"><p>需求 {row.needDate || '待确认'}</p><p className="mt-1 text-muted-foreground">检验后可用 {row.availableDate || '待核对'}</p></TableCell><TableCell className="text-xs tabular-nums"><p>{quantity(row.assignedQty, row.unit)}</p><p className="mt-1 text-muted-foreground">有效 {quantity(row.effectiveQty, row.unit)}</p></TableCell><TableCell className="max-w-64 whitespace-normal text-xs"><p className="tabular-nums">{quantity(row.onTimeQty, row.unit)} · {row.status === 'pending' ? '待核对' : row.status === 'late' ? `晚于需求 ${row.delayDays} 天` : '按期'}</p><p className="mt-1 leading-5 text-muted-foreground">{row.note}</p></TableCell><TableCell><Button asChild variant="outline" size="sm"><Link target="_blank" rel="noopener noreferrer" to={routePath('page:production-execution', '/production-execution') + '?' + new URLSearchParams({ month: row.month, plan: row.planId, view: 'readiness', ...(row.batchId ? { readinessBatch: row.batchId } : {}) })}>查看齐套<span className="sr-only">（新标签页）</span></Link></Button></TableCell></TableRow>)}</TableBody></Table> : <p role="status" className="py-3 text-sm text-muted-foreground">暂无已明确分配的可查看计划；这不代表没有潜在需求。</p>}
        <p className="text-xs leading-5 text-muted-foreground">{data.notice}</p>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span>{data.total} 项 · {data.page} / {data.totalPages} · {new Date(data.readAt).toLocaleTimeString()}</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={data.page <= 1} onClick={() => setPage(data.page - 1)}>上一页</Button><Button variant="outline" size="sm" disabled={data.page >= data.totalPages} onClick={() => setPage(data.page + 1)}>下一页</Button></div></div>
      </>}
      <Button size="sm" variant="outline" disabled={!current} onClick={() => setReload(value => value + 1)}>重新核对影响</Button>
    </div>}
  </details>;
}
