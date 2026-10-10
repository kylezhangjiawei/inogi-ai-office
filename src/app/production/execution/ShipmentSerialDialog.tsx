import './production-theme.css';
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import type { Lifecycle, LifecycleVersionRange } from '../../lib/productionLifecycleApi';

export function availableShipmentSerials(batchId: string, ranges: LifecycleVersionRange[], shipments: Lifecycle['shipments']) {
  const canonical = (value: string) => value.normalize('NFKC').toUpperCase();
  const used = new Set(shipments.filter(row => !row.reversed).flatMap(row => (row.serials ?? []).map(serial => canonical(serial.number))));
  return ranges.filter(row => row.batchId === batchId && !ranges.some(next => next.supersedesId === row.id)).flatMap(row => row.serialNumbers.filter(number => !used.has(canonical(number))).map(number => ({ number, softwareVersion: row.softwareVersion, hardwareVersion: row.hardwareVersion })));
}

export function ShipmentSerialDialog({ shipment, ranges, shipments, submit, onClose, onSaved }: {
  shipment: Lifecycle['shipments'][number]; ranges: LifecycleVersionRange[]; shipments: Lifecycle['shipments'];
  submit: (serialNumbers: string[], reason: string, requestId: string) => Promise<unknown>; onClose: () => void; onSaved: () => void;
}) {
  const id = useId(), [search, setSearch] = useState(''), [selected, setSelected] = useState<string[]>([]), [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const locked = useRef(false), mounted = useRef(true), request = useRef({ signature: '', id: '' });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const pending = Math.max(0, shipment.quantity - (shipment.serials?.length ?? 0));
  const available = availableShipmentSerials(shipment.batchId, ranges, shipments);
  const visible = available.filter(row => `${row.number} ${row.softwareVersion} ${row.hardwareVersion}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (locked.current) return;
    if (!selected.length || selected.length > pending || !reason.trim()) { setError('请选择不超过待补数量的 SN，并填写核对依据。'); return; }
    const signature = JSON.stringify([selected, reason.trim()]);
    if (signature !== request.current.signature) request.current = { signature, id: crypto.randomUUID() };
    locked.current = true; setBusy(true); setError('');
    try { await submit(selected, reason.trim(), request.current.id); if (mounted.current) onSaved(); }
    catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : '关联失败，请保留选择并重试'); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !locked.current) onClose(); }}><DialogContent className="production-ui-theme max-h-[90dvh] overflow-y-auto sm:max-w-2xl" onInteractOutside={event => event.preventDefault()} onEscapeKeyDown={event => event.preventDefault()}><DialogHeader><DialogTitle>补录本次实发 SN</DialogTitle><DialogDescription>{shipment.voucher} · 实发 {shipment.quantity} 台 · 已关联 {shipment.serials?.length ?? 0} 个 · 待补 {pending} 台。仅选择本次实际发出的号码。</DialogDescription></DialogHeader>
    <form onSubmit={save} className="space-y-4"><fieldset disabled={busy} className="space-y-4">
      <div className="space-y-2"><Label htmlFor={`${id}-search`}>搜索批次已有 SN</Label><Input id={`${id}-search`} value={search} onChange={event => setSearch(event.target.value)} placeholder="SN、软件或硬件版本" /></div>
      <p className="production-meta">已选 {selected.length} / 待补 {pending} · 本批次可关联 {available.length} 个</p>
      <div className="max-h-64 overflow-y-auto rounded-lg border border-border divide-y divide-border">{visible.map(row => <Label key={row.number} className="flex cursor-pointer items-start gap-3 p-3 font-normal"><Checkbox disabled={busy || (!selected.includes(row.number) && selected.length >= pending)} checked={selected.includes(row.number)} onCheckedChange={checked => setSelected(previous => checked === true ? [...previous, row.number] : previous.filter(number => number !== row.number))} /><span className="min-w-0"><span className="block break-all font-medium">{row.number}</span><span className="production-meta">软件 {row.softwareVersion || '待补'} · 硬件 {row.hardwareVersion || '待补'}</span></span></Label>)}{!visible.length && <p className="p-4 text-sm text-muted-foreground">{available.length ? '没有匹配的号码。' : '暂无可关联的已有 SN，请先在本批次档案登记；其他有效发货单已关联的号码不可重复选择。'}</p>}</div>
      <div className="space-y-2"><Label htmlFor={`${id}-reason`}>实发清单与核对依据</Label><Textarea id={`${id}-reason`} required maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} /></div>
    </fieldset>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={onClose}>取消</Button><Button disabled={busy || !selected.length || !reason.trim()}>{busy ? '正在关联…' : '确认关联'}</Button></DialogFooter></form>
  </DialogContent></Dialog>;
}
