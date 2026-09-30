import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import { usePermission } from '../../hooks/usePermission';
import { OperationalDialog, type OperationEditor } from '../../production/execution/OperationalDialog';
import { createErpReceipt, getErpReceiptWarehouses, getWarehouseRecords, refreshErpReceipt, type ErpReceiptSync, type WarehouseRecord } from '../../lib/warehouseRecordsApi';

export function ErpPurchaseReceiptPanel({record, receipts, onSaved}: {record: WarehouseRecord; receipts: ErpReceiptSync[]; onSaved: () => void}) {
  const canWrite = usePermission('warehouse:write-erp');
  const [rows, setRows] = useState(receipts), [busy, setBusy] = useState(false), [error, setError] = useState(''), [editor, setEditor] = useState<OperationEditor | null>(null);
  const mounted = useRef(true), locked = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setRows(receipts); }, [receipts]);
  const exported = rows.filter(row => row.state === 'verified').reduce((sum, row) => sum + row.quantity, 0);
  const available = Math.max(0, Math.round((record.qualifiedQty - exported) * 1000) / 1000);
  const uncertain = rows.some(row => row.state !== 'rejected' && (row.state !== 'verified' || row.error));
  async function run(action: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try { await action(); } catch(cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : 'ERP 入库请求失败'); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  }
  async function openCreate() {
    const warehouses = (await getErpReceiptWarehouses()).filter(row => row.name === record.warehouse);
    if (!warehouses.length) throw new Error('ERP 未找到同名仓库，请先核对实际接收仓库与 ERP 仓库名称。');
    if (!mounted.current) return;
    setEditor({title: '创建 ERP 采购入库单', description: `本次同步 ${available} ${record.unit}合格物料。ERP 生成入库单后，仍按原审核流程处理；不良和待判数量继续保留。`,
      fields: [{key: 'warehouseCode', label: 'ERP 接收仓库', value: warehouses.length === 1 ? warehouses[0].code : '', options: warehouses.map(row => ({value: row.code, label: `${row.name}（${row.code}）`}))}, {key: 'date', label: '入库日期', type: 'date', value: record.date}, {key: 'reason', label: '入库依据（最多 1000 字）', type: 'textarea'}],
      submit: async(values, requestId) => {
        try { await createErpReceipt({requestId, recordId: record.id, expectedVersion: record.version, warehouseCode: String(values.warehouseCode), date: String(values.date), reason: String(values.reason)}); }
        catch(cause) {
          let rejected = false;
          try {
            const latest = await getWarehouseRecords();
            const receipts = (latest.erpReceipts ?? []).filter(row => row.recordId === record.id);
            rejected = receipts.some(row => row.requestId === requestId && row.state === 'rejected');
            if (mounted.current) setRows(receipts);
          } catch { /* The original error remains actionable; the durable server journal survives. */ }
          if (rejected) throw new Error(`${cause instanceof Error ? cause.message : 'ERP 入库请求失败'} 本次未创建入库单。请先处理失败原因，关闭此表单后重新点击“创建 ERP 采购入库单”提交。`);
          throw new Error(`${cause instanceof Error ? cause.message : 'ERP 入库请求失败'} 保持填写内容不变并再次确认，可核对原请求；也可关闭表单后刷新 ERP 状态。`);
        }
      }});
  }
  return <section className="warehouse-detail-section" aria-label="ERP 采购入库单">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2>ERP 采购入库单</h2>{rows.some(row => row.state !== 'rejected') && <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(async() => { const latest = await refreshErpReceipt(record.id); if (mounted.current) { setRows(latest); onSaved(); } })}>{busy ? '正在核对…' : '刷新 ERP 状态'}</Button>}</div>
    <p className="mt-2 text-sm text-muted-foreground">只创建入库单，审核保留在 ERP 内完成。库存以 ERP 审核及后续库存同步结果为准。</p>
    <dl className="warehouse-facts mt-3"><div><dt>已创建数量</dt><dd>{exported.toLocaleString()} {record.unit}</dd></div><div><dt>尚未同步的合格数量</dt><dd>{available.toLocaleString()} {record.unit}</dd></div></dl>
    {!rows.length && <p className="mt-3 text-sm text-muted-foreground">尚未创建 ERP 采购入库单。</p>}
    <ul className="mt-3 space-y-3">{rows.map(row => <li key={row.requestId} className="rounded-lg border border-border p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><span className="font-medium break-all">{row.result?.voucherCode || (row.state === 'rejected' ? 'ERP 创建已拒绝' : '创建结果待核对')}</span><span>{row.state === 'verified' ? row.result?.approvalStatus || '状态待核对' : row.state === 'rejected' ? '未创建' : '待核对'}</span></div><p className="mt-1 text-xs text-muted-foreground">{row.quantity} {record.unit} · {row.date} · {row.actorName}</p>{row.result && <p className="mt-1 text-xs text-muted-foreground">查询时间：{new Date(row.result.checkedAt).toLocaleString()}{row.result.auditor ? ` · 审核人：${row.result.auditor}` : ''}</p>}{row.error && <p className="mt-2 break-words text-xs text-destructive">{row.error}</p>}</li>)}</ul>
    {uncertain && <p className="mt-3 text-sm text-amber-700">请先刷新 ERP 状态核对原请求，避免重复创建。</p>}
    {canWrite && record.status === 'confirmed' && !record.reconciliation && available > 0 && !uncertain && <Button className="mt-4" disabled={busy} onClick={() => void run(openCreate)}>{busy ? '正在读取仓库…' : '创建 ERP 采购入库单'}</Button>}
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    {editor && <OperationalDialog editor={editor} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); onSaved(); }} />}
  </section>;
}
