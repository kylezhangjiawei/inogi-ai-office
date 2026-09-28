import { useI18n } from '../../lib/i18n';
import { useEffect, useRef, useState } from 'react';
import { NativeSelect } from '../../components/ui/native-select';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { orderProcessingApi, type OrderMaterialOption, type OrderProduct } from '../../lib/orderProcessingApi';

export function OrderMaterialMappingDialog({ orderId, product, onClose, onRefresh }: { orderId: string; product: OrderProduct; onClose: () => void; onRefresh: () => Promise<void> }) {
  const { t } = useI18n();
  const [search, setSearch] = useState(product.id), [options, setOptions] = useState<OrderMaterialOption[]>([]);
  const [materialId, setMaterialId] = useState(''), [reason, setReason] = useState(''), [error, setError] = useState('');
  const [loading, setLoading] = useState(false), [saving, setSaving] = useState(false);
  const pending = useRef<{ signature: string; requestId: string } | null>(null), lock = useRef(false);
  useEffect(() => {
    let alive = true; setLoading(true);
    const timer = window.setTimeout(() => { orderProcessingApi.materialOptions(search).then(data => { if (alive) { setOptions(data.materials); setError(''); } }).catch(cause => { if (alive) setError(cause instanceof Error ? cause.message : t('物料查询失败')); }).finally(() => { if (alive) setLoading(false); }); }, 200);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [search]);
  const selected = options.find(row => row.id === materialId), basis = product.stockCheck;
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (lock.current || !basis || !selected) return;
    const content = { materialId, expectedUpdatedAt: basis.updatedAt, expectedSourceFingerprint: basis.sourceFingerprint, reason: reason.trim() };
    const signature = JSON.stringify(content);
    if (pending.current?.signature !== signature) pending.current = { signature, requestId: crypto.randomUUID() };
    lock.current = true; setSaving(true); setError('');
    try { await orderProcessingApi.confirmMaterial(orderId, product.lineId!, { ...content, requestId: pending.current.requestId }); await onRefresh(); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t('核对失败，填写内容已保留')); }
    finally { lock.current = false; setSaving(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !saving) onClose(); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl"><DialogHeader><DialogTitle>{t('核对订单物料')}</DialogTitle><DialogDescription>{t('只建立正式物料关联，不修改订单原文、发票或库存。')}</DialogDescription></DialogHeader>
    <form className="space-y-4" onSubmit={save}>
      <dl className="rounded-lg border bg-muted/30 p-3 text-sm"><dt className="text-muted-foreground">{t('原始订单商品')}</dt><dd className="mt-1 break-words font-medium">{product.id} · {product.name}</dd><dd className="mt-1">{product.spec || t('规格未填写')} · {product.orderQty} {product.unit}</dd></dl>
      <div className="space-y-2"><Label htmlFor="order-material-search">{t('搜索正式物料')}</Label><Input id="order-material-search" value={search} maxLength={128} onChange={event => { setSearch(event.target.value); setMaterialId(''); }} placeholder={t('名称、ERP 编码或规格')} /></div>
      <div className="space-y-2"><Label htmlFor="order-material-choice">{t('物料库中的物料')}</Label><NativeSelect id="order-material-choice" required disabled={loading || saving} value={materialId} onChange={event => setMaterialId(event.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="">{loading ? t('正在查询…') : options.length ? t('请选择并逐项核对规格') : t('没有匹配的已审核物料，请调整搜索')}</option>{options.map(row => <option key={row.id} value={row.id} disabled={row.unit.trim() !== product.unit.trim()}>{row.tpInventoryCode} · {row.name} · {row.spec || t('无规格')} · {row.unit}{row.unit.trim() !== product.unit.trim() ? t('（单位不同）') : ''}</option>)}</NativeSelect><p className="text-xs text-muted-foreground">{t('最多显示 50 条候选；单位必须与订单一致，不自动换算。')}</p></div>
      {selected && <p className="break-words rounded-lg border p-3 text-sm">{t('确认关联')}：{selected.tpInventoryCode} · {selected.name} · {selected.spec || t('规格未填写')} · {selected.unit}</p>}
      <div className="space-y-2"><Label htmlFor="order-material-reason">{t('核对依据')}</Label><Textarea id="order-material-reason" required maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} placeholder={t('例如：与客户订单、规格图纸核对一致')} /></div>
      {error && <div role="alert" className="space-y-2 text-sm text-destructive"><p>{error}</p><Button type="button" variant="outline" onClick={() => void onRefresh()} disabled={saving}>{t('刷新依据，保留填写内容')}</Button></div>}
      <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" onClick={onClose} disabled={saving}>{t('取消')}</Button><Button type="submit" disabled={saving || loading || !selected || !reason.trim() || !basis?.updatedAt}>{saving ? t('正在保存…') : t('确认物料关联')}</Button></div>
    </form></DialogContent></Dialog>;
}
