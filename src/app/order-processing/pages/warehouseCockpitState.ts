import { useEffect, useState } from 'react';
import { hasPermission } from '../../lib/permissions';
import type { WarehouseIssue } from '../../lib/warehouseFlowApi';

export function warehouseCockpitAccess(permissions: string[]) {
  const can = (code: string) => hasPermission(permissions, code);
  return {
    inventory: can('page:inventory-management'),
    receipts: can('page:purchase-order-detail') && ['page:proc-cockpit', 'proc-purchase-order:receive', 'proc-purchase-order:inspect'].some(can),
    flows: can('page:warehouse-flow') || can('page:production-execution'),
    allFlows: can('page:warehouse-flow') || can('production:plan'),
    counts: can('page:warehouse-flow') || can('page:warehouse-count'),
    startCount: (can('page:warehouse-flow') || can('page:warehouse-count')) && can('warehouse:count-initiate'),
  };
}

export function warehouseIssueSummary(issues: WarehouseIssue[]) {
  const active = issues.filter(issue => issue.status !== 'cancelled' && issue.status !== 'signed');
  return {
    pending: active.filter(issue => issue.lines.some(line => line.quantity > (line.issuedQty ?? 0))),
    signing: active.filter(issue => issue.lines.some(line => (line.issuedQty ?? 0) > (line.signedQty ?? 0))),
  };
}

/** Query identity includes permission scope; late responses never replace a newer query. */
export function useWarehouseResource<T>(key: string | null, load: (signal: AbortSignal) => Promise<T>) {
  const [state, setState] = useState<{ key: string | null; data: T | null; loading: boolean; error: string }>({ key: null, data: null, loading: false, error: '' });
  useEffect(() => {
    if (key === null) return;
    const controller = new AbortController();
    setState({ key, data: null, loading: true, error: '' });
    void load(controller.signal).then(data => {
      if (!controller.signal.aborted) setState({ key, data, loading: false, error: '' });
    }).catch(cause => {
      if (!controller.signal.aborted) setState({ key, data: null, loading: false, error: cause instanceof Error ? cause.message : '数据加载失败' });
    });
    return () => controller.abort();
  }, [key, load]);
  return key === null ? { data: null, loading: false, error: '' } : state.key === key ? state : { data: null, loading: true, error: '' };
}
