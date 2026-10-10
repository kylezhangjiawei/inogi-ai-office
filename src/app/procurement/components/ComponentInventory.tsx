import { useState, type ReactNode } from 'react';
import { Info } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { NativeSelect } from '../../components/ui/native-select';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog';
import { saveComponentInventory, type ComponentInventory, type Material } from '../../lib/procurementApi';

export function InventoryTip({ label, children }: { label: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <Tooltip open={open} onOpenChange={setOpen}><TooltipTrigger asChild>
    <Button variant="unstyled" type="button" onClick={event => { event.stopPropagation(); setOpen(true); }} className="inline-flex min-h-8 items-center gap-1 rounded text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" aria-label={typeof label === 'string' ? `${label}：查看说明` : undefined}>
      {label}<Info className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Button>
  </TooltipTrigger><TooltipContent className="space-y-1 border border-slate-200 bg-white! text-left leading-5 text-slate-800! shadow-md text-pretty [&_svg]:bg-white! [&_svg]:fill-white!" onPointerDownOutside={() => setOpen(false)}>{children}</TooltipContent></Tooltip>;
}
const qty = (value: number | null | undefined) => value == null ? '待核对' : new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 3 }).format(value);
export function ComponentInventoryValue({ stock, error, grouped = false }: { stock?: ComponentInventory; error?: string; grouped?: boolean }) {
  return <InventoryTip label={<span>组件实际库存 <strong className="tabular-nums">{grouped ? '按组件查看' : qty(stock?.quantity)}</strong>{stock?.quantity != null ? ` ${stock.unit}` : ''}</span>}>
    {grouped ? <p>分类包含不同组件，不直接累加为一个库存数。请进入具体组件查看实际库存。</p> : <>
      <p>仅统计当前组件本身，包含所选范围内的仓库库存；不累加子物料，也不再重复扣减仓库数量。</p>
      <p>来源：{stock ? stock.source === 'manual' ? '人工盘点（替代同范围 ERP 值）' : 'ERP 量产仓／量产仓库' : '未读取或未关联组件物料'}</p>
      <p>实际库存 {qty(stock?.quantity)} · 可用 {qty(stock?.available)} · 不可用／已占用 {qty(stock?.unavailable)} {stock?.unit}</p>
      <p>备货按可用量抵扣，在途与已签收数量单独计算；此数值不代表库存已预留。</p>
      <p>统计时间：{stock?.countedAt ? new Date(stock.countedAt).toLocaleString('zh-CN') : '无记录'}</p>
      {stock?.updatedBy && <p>登记人：{stock.updatedBy}</p>}{stock?.note && <p>{stock.note}</p>}
      {(error || stock?.issues.length) ? <p>{error || stock?.issues.join('；')}</p> : null}
    </>}
  </InventoryTip>;
}
export function ComponentInventoryEditor({ material, stock, onClose, onSaved }: { material: Material; stock: ComponentInventory; onClose: () => void; onSaved: (value: ComponentInventory) => void }) {
  const [source, setSource] = useState(stock.source);
  const [quantity, setQuantity] = useState(stock.quantity == null ? '' : String(stock.quantity));
  const [unavailable, setUnavailable] = useState(stock.unavailable == null ? '' : String(stock.unavailable));
  const localDate = new Date(); localDate.setMinutes(localDate.getMinutes() - localDate.getTimezoneOffset());
  const [countedAt, setCountedAt] = useState(localDate.toISOString().slice(0, 16));
  const [note, setNote] = useState(stock.note || '');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const save = async () => {
    if (busy) return;
    if (source === 'manual' && (!quantity.trim() || !unavailable.trim() || !countedAt || !Number.isFinite(Date.parse(countedAt)))) { setError('请填写实际库存、不可用数量（没有则填 0）及盘点时间'); return; }
    setBusy(true); setError('');
    try { onSaved(await saveComponentInventory(material.id, { source, unit: material.unit, expectedVersion: stock.version,
      ...(source === 'manual' ? { quantity: Number(quantity), unavailable: Number(unavailable), countedAt: new Date(countedAt).toISOString() } : {}), note })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败'); }
    finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent onInteractOutside={event => event.preventDefault()}>
    <DialogHeader><DialogTitle>维护组件实际库存</DialogTitle><DialogDescription>{material.name} · {material.unit}。人工值替代同范围 ERP 库存，不相加，不回写 ERP。</DialogDescription></DialogHeader>
    <fieldset disabled={busy} className="grid gap-3 text-sm">
      <label>库存来源<NativeSelect aria-label="库存来源" value={source} onChange={event => setSource(event.target.value as typeof source)} className="mt-1 w-full rounded-md border p-2"><option value="erp">ERP 量产库存</option><option value="manual">人工盘点</option></NativeSelect></label>
      {source === 'manual' && <><label>实际库存（{material.unit}）<Input aria-label="实际库存" type="number" min="0" step="0.001" value={quantity} onChange={event => setQuantity(event.target.value)} /></label>
        <label>不可用／已占用数量（{material.unit}）<Input aria-label="不可用数量" type="number" min="0" step="0.001" value={unavailable} onChange={event => setUnavailable(event.target.value)} /></label>
        <p className="text-xs text-muted-foreground">填写待检、不良、冻结及已占用的合计；用于备货的可用量＝实际库存－不可用数量。</p>
        <label>盘点时间<Input aria-label="盘点时间" type="datetime-local" value={countedAt} onChange={event => setCountedAt(event.target.value)} /></label></>}
      <label>说明<Input aria-label="库存说明" maxLength={1000} value={note} onChange={event => setNote(event.target.value)} placeholder="盘点依据或切换来源的原因" /></label>
    </fieldset>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <DialogFooter><Button variant="outline" disabled={busy} onClick={onClose}>取消</Button><Button disabled={busy} onClick={() => void save()}>{busy ? '保存中…' : '保存库存'}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
