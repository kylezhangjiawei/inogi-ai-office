import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '../../components/ui/button';
import { usePermission } from '../../hooks/usePermission';
import { getStockPlanExecution, linkPurchaseOrders, type ProcStockPlan, type StockExecutionTask } from '../../lib/procurementApi';
import { erpPurchaseOrderApi } from '../../lib/erpPurchaseOrderApi';
import { ErpPurchaseOrderDialog } from '../../order-processing/components/ErpPurchaseOrderDialog';
import { buildPurchaseOrderLinePath } from '../../lib/purchaseOrderLineNavigation';
import { refreshProcurement } from '../data';
import { InventoryTip } from './ComponentInventory';
import { useAuth } from '../../auth';
const qty = (value: number | null) => value === null ? '待核对' : new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 3 }).format(value);
export function StockPlanExecution({ plan }: { plan: ProcStockPlan }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const recoveryKey = `stock-plan-order-link:${user?.id ?? 'unknown'}:${plan.id}`;
  const canWrite = usePermission('proc-purchase-order:write-erp'), canLink = usePermission('proc-task:order'), canReadOrder = usePermission('page:purchase-orders');
  const [tasks, setTasks] = useState<StockExecutionTask[]>([]), [error, setError] = useState(''), [loading, setLoading] = useState(true), [revision, setRevision] = useState(0);
  const [creating, setCreating] = useState<StockExecutionTask | null>(null), [linking, setLinking] = useState(false);
  const [unlinked, setUnlinked] = useState<{ task: StockExecutionTask; orderNo: string } | null>(() => {
    try { const saved = JSON.parse(localStorage.getItem(recoveryKey) || 'null'); return saved?.task?.id && typeof saved.orderNo === 'string' ? saved : null; } catch { return null; }
  });
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    void getStockPlanExecution(plan.id, controller.signal).then(value => { if (!controller.signal.aborted) setTasks(value.tasks); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '执行进度读取失败'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [plan.id, plan.updatedAt, plan.tasks.length, revision]);
  const marker = (task: StockExecutionTask) => `备货任务 ${plan.code} / ${task.code}`;
  const linkSavedOrder = async (task: StockExecutionTask, orderNo: string) => {
    setCreating(null); setLinking(true); setUnlinked({ task, orderNo }); setError('');
    try { localStorage.setItem(recoveryKey, JSON.stringify({ task, orderNo })); } catch { /* ERP request journal still retains the saved order. */ }
    try {
      const order = await erpPurchaseOrderApi.read(orderNo);
      if (!order.memo.includes(marker(task)) || !order.lines.length || order.lines.some(line => line.inventoryCode !== task.inventoryCode || line.unitName !== task.unit || !line.lineNo)) throw new Error('已保存订单与当前任务的标识或物料不一致，请到采购任务核对后手工关联');
      const current = (await getStockPlanExecution(plan.id)).tasks.find(row => row.id === task.id);
      if (!current) throw new Error('原采购任务已不属于当前备货计划');
      const missing = order.lines.filter(line => !current.orders.some(ref => ref.orderNo === orderNo && ref.lineNo === line.lineNo));
      if (missing.length) await linkPurchaseOrders(task.id, missing.map(line => ({ tpOrderNo: order.orderNo, tpOrderId: order.id, tpLineNo: line.lineNo, supplierName: order.supplierName, orderedQty: line.quantity, orderDate: order.orderDate, etaDate: line.etaDate })));
      try { localStorage.removeItem(recoveryKey); } catch { /* Already-linked orders are reconciled above on retry. */ }
      setUnlinked(null); setRevision(value => value + 1); void refreshProcurement();
    } catch (cause) { setError(`ERP 订单 ${orderNo} 已存在，任务关联未完成：${cause instanceof Error ? cause.message : '请核对'}。请勿重复下单。`); }
    finally { setLinking(false); }
  };
  return <section className="mb-4 rounded-lg border border-slate-200 bg-white p-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-balance text-sm font-semibold">采购执行与签收</h4><Button size="sm" variant="outline" disabled={loading || linking} onClick={() => setRevision(value => value + 1)}>刷新进度</Button></div>
    <p className="mt-1 text-pretty text-xs text-muted-foreground">备货计划 → 下单 → 在途 → 到货。按物料分别跟进，签收即到货；检验合格数量另行记录。</p>
    {error && <p role="alert" className="mt-2 break-words text-xs text-destructive">{error}</p>}
    {unlinked && <div className="mt-2 flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={linking} onClick={() => void linkSavedOrder(unlinked.task, unlinked.orderNo)}>{linking ? '关联中…' : `重新核对并关联 ${unlinked.orderNo}`}</Button><Button size="sm" variant="outline" onClick={() => navigate(`/proc-cockpit?line=production&task=${encodeURIComponent(unlinked.task.id)}`)}>打开原采购任务</Button></div>}
    {loading ? <p role="status" className="mt-3 text-xs text-muted-foreground">读取订单与签收记录…</p> : tasks.length === 0 ? <p className="mt-3 text-xs text-muted-foreground">先核算库存，再按缺口生成采购执行任务；库存已覆盖时无需重复采购。</p> : <div className="mt-3 grid gap-2">{tasks.map(task => <article key={task.id} className="rounded-lg border p-3 text-xs">
      <div className="flex flex-wrap justify-between gap-2"><strong className="break-words">{task.materialName} · {task.code}</strong><span className="font-semibold text-primary">{task.stage}</span></div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 tabular-nums"><span>需采购 {qty(task.quantity)} {task.unit}</span><span>已下单 {qty(task.orderedQty)}</span><span>在途 {qty(task.inTransitQty)}</span><InventoryTip label={`已到货 ${qty(task.signedQty)}`}><p>有本地签收记录时使用本地净签收量，没有时采用 ERP 到货量；两者不相加。退货、冲销按原台账扣减，来源不明确时显示待核对。</p><p>签收即可计到货，不以检验合格为前提。</p></InventoryTip></div>
      {task.orders.map((order, index) => <div key={`${order.orderNo}-${index}`} className="mt-2 rounded bg-muted p-2"><div className="flex flex-wrap items-center gap-2"><span>{order.orderNo} / {order.lineNo || '行号待核对'} · {order.source} {qty(order.signedQty)} {task.unit}</span>{canReadOrder && order.lineId && <Button size="sm" variant="link" className="h-auto p-0 text-xs" onClick={() => { const path = buildPurchaseOrderLinePath(order.orderNo, order.lineId!); if (path) navigate(path); }}>查看订单／登记签收</Button>}</div>{order.issues.map(issue => <p key={issue} className="mt-1 text-amber-800">{issue}</p>)}</div>)}
      <div className="mt-2 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => navigate(`/proc-cockpit?line=production&task=${encodeURIComponent(task.id)}`)}>处理采购任务</Button>
        {canWrite && canLink && canReadOrder && task.inventoryCode && ['priced', 'pending_purchase', 'in_transit', 'partial_arrival'].includes(task.status) && task.orderedQty !== null && task.orderedQty < task.quantity && <Button size="sm" disabled={linking || Boolean(unlinked)} onClick={() => setCreating(task)}>创建采购订单并同步 ERP</Button>}
      </div>
    </article>)}</div>}
    {creating && <ErpPurchaseOrderDialog mode="create" initial={{ memo: marker(creating), lines: [{ inventoryCode: creating.inventoryCode!, unitName: creating.unit, quantity: Math.max(0, creating.quantity - (creating.orderedQty ?? 0)), unitPrice: 0, taxRate: 0, etaDate: plan.targetDate || '' }] }} onClose={() => setCreating(null)} onSaved={result => void linkSavedOrder(creating, result.orderNo)} />}
  </section>;
}
