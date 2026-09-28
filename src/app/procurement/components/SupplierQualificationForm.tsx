import { useEffect, useRef, useState } from 'react';
import { FileText, Upload, X } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Checkbox } from '../../components/ui/checkbox';
import { NativeSelect } from '../../components/ui/native-select';
import { Textarea } from '../../components/ui/textarea';
import { useI18n } from '../../lib/i18n';
import { uploadProcurementAttachment } from '../../lib/procurementApi';
import { saveSupplyQualification, type QualificationDirectory, type SupplyQualification, type SupplyQualificationStatus } from '../../lib/supplierQualificationsApi';
import { SUPPLY_QUALIFICATION_LABELS } from '../supplierQualificationsModel';

export function SupplierQualificationForm({ directory, relation, materialId, supplierId, onClose, onSaved }: { directory: QualificationDirectory; relation?: SupplyQualification; materialId?: string; supplierId?: string; onClose: () => void; onSaved: (id: string) => void }) {
  const { t } = useI18n();
  const [material, setMaterial] = useState(relation?.materialId ?? materialId ?? ''), [supplier, setSupplier] = useState(relation?.supplierId ?? supplierId ?? '');
  const [search, setSearch] = useState(''), [status, setStatus] = useState<SupplyQualificationStatus>(relation && directory.canReview && relation.status !== 'withdrawn' ? relation.status : 'pending');
  const [productIds, setProductIds] = useState(relation?.products.map(product => product.id) ?? []);
  const [from, setFrom] = useState(relation?.effectiveFrom ?? new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)), [until, setUntil] = useState(relation?.effectiveUntil ?? '');
  const [reason, setReason] = useState(''), [evidence, setEvidence] = useState<Array<{ fileId: string; name: string }>>(relation?.evidence ?? []);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const active = useRef(true), pending = useRef(false), fileInput = useRef<HTMLInputElement>(null);
  const request = useRef<{ payload: string; id: string } | null>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const materials = directory.materials.filter(row => row.reviewStatus === 'approved' && (!search.trim() || `${row.name} ${row.spec} ${row.tpInventoryCode || row.erpCode}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())));
  const chosenMaterial = directory.materials.find(row => row.id === material), chosenSupplier = directory.suppliers.find(row => row.id === supplier);
  const upload = async (files: FileList | null) => {
    if (!files?.length || pending.current) return;
    if (files.length + evidence.length > 20) { setError(t('最多保留 20 份证据')); return; }
    pending.current = true; setBusy(true); setError('');
    try {
      for (const file of Array.from(files)) {
        const saved = await uploadProcurementAttachment(file);
        if (!active.current) return;
        if (!saved.fileId) throw new Error(t('文件未完成登记，请重新上传'));
        setEvidence(current => [...current, { fileId: saved.fileId!, name: file.name }]);
      }
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : t('证据上传失败')); }
    finally { pending.current = false; if (active.current) setBusy(false); }
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (pending.current) return; setError('');
    if (!material || !supplier || !productIds.length || !from || !reason.trim()) { setError(t('请确认物料、供应商、适用产品、生效日期与本次依据')); return; }
    if (until && until < from) { setError(t('失效日期不能早于生效日期')); return; }
    if (status === 'approved' && !evidence.length) { setError(t('确认可供货前，请上传审核或验证依据')); return; }
    const fields = { version: relation?.version ?? 0, materialId: material, supplierId: supplier, status, productIds, effectiveFrom: from, effectiveUntil: until || undefined, reason: reason.trim(), evidenceFileIds: evidence.map(file => file.fileId) };
    const payload = JSON.stringify(fields);
    if (request.current?.payload !== payload) request.current = { payload, id: crypto.randomUUID() };
    pending.current = true; setBusy(true);
    try { const saved = await saveSupplyQualification({ ...fields, requestId: request.current.id }); if (active.current) onSaved(saved.id); }
    catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : t('供货关系保存失败')); }
    finally { pending.current = false; if (active.current) setBusy(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !pending.current) onClose(); }}><DialogContent closeDisabled={busy} className="flex max-h-[90dvh] flex-col overflow-hidden sm:max-w-3xl">
    <DialogHeader><DialogTitle>{t(relation ? '审核供货关系' : '登记供货关系')}</DialogTitle><DialogDescription>{t('明确适用产品、有效期间与审核依据。每次确认都会保留版本和操作人。')}</DialogDescription></DialogHeader>
    <form onSubmit={event => void submit(event)} className="flex min-h-0 flex-col gap-4"><fieldset disabled={busy} className="min-h-0 space-y-5 overflow-y-auto pr-1">
      <section className="space-y-3"><h3 className="text-sm font-semibold">{t('物料与供应商')}</h3>{relation ? <div className="rounded-lg bg-muted/50 p-3 text-sm"><p className="font-medium">{relation.materialName} · {relation.materialCode || t('编码待确认')}</p><p className="mt-1 text-muted-foreground">{relation.supplierName}</p></div> : <><Input value={search} aria-label={t('搜索正式物料')} placeholder={t('按物料名、规格或编码查找')} onChange={event => setSearch(event.target.value)} /><div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1 text-xs text-muted-foreground"><span>{t('已审核物料')}</span><NativeSelect value={material} onChange={event => setMaterial(event.target.value)} required><option value="">{t('选择正式物料')}</option>{chosenMaterial && !materials.some(row => row.id === material) && <option value={material}>{chosenMaterial.name}</option>}{materials.map(row => <option key={row.id} value={row.id}>{row.name} · {row.tpInventoryCode || row.erpCode || row.spec}</option>)}</NativeSelect></label><label className="space-y-1 text-xs text-muted-foreground"><span>{t('供应商档案')}</span><NativeSelect value={supplier} onChange={event => setSupplier(event.target.value)} required><option value="">{t('选择供应商')}</option>{directory.suppliers.map(row => <option key={row.id} value={row.id}>{row.name}{row.enabled ? '' : ` · ${t('已停用')}`}</option>)}</NativeSelect></label></div></>}</section>
      <section className="space-y-3 border-t border-border pt-4"><h3 className="text-sm font-semibold">{t('适用范围与状态')}</h3><div className="flex flex-wrap gap-x-5 gap-y-3">{directory.products.map(product => <label key={product.id} className="flex items-center gap-2 text-sm"><Checkbox checked={productIds.includes(product.id)} onCheckedChange={checked => setProductIds(current => checked === true ? [...current, product.id] : current.filter(id => id !== product.id))} />{product.name}</label>)}{!directory.products.length && <p className="text-sm text-amber-700">{t('尚未配置产品目录，请先维护适用产品。')}</p>}</div><div className="grid gap-3 sm:grid-cols-3"><label className="space-y-1 text-xs text-muted-foreground"><span>{t('本次确认状态')}</span><NativeSelect value={status} onChange={event => setStatus(event.target.value as SupplyQualificationStatus)}>{(!relation || !directory.canReview || relation.status === 'withdrawn' ? ['pending'] : ['pending', 'approved', 'suspended', 'withdrawn']).map(value => <option key={value} value={value}>{t(SUPPLY_QUALIFICATION_LABELS[value])}</option>)}</NativeSelect></label><label className="space-y-1 text-xs text-muted-foreground"><span>{t('生效日期')}</span><Input type="date" required value={from} onChange={event => setFrom(event.target.value)} /></label><label className="space-y-1 text-xs text-muted-foreground"><span>{t('失效日期（可选）')}</span><Input type="date" min={from} value={until} onChange={event => setUntil(event.target.value)} /></label></div>{chosenSupplier && !chosenSupplier.enabled && <p className="text-xs text-amber-700">{t('此供应商已停用，不能确认可供货。')}</p>}</section>
      <section className="space-y-3 border-t border-border pt-4"><div className="flex items-center justify-between"><h3 className="text-sm font-semibold">{t('审核依据')} · {evidence.length}</h3><Button type="button" variant="outline" size="sm" disabled={busy || evidence.length >= 20} onClick={() => fileInput.current?.click()}><Upload className="size-4" />{t('上传证据')}</Button><Input ref={fileInput} type="file" multiple className="hidden" onChange={event => { void upload(event.target.files); event.target.value = ''; }} /></div><p className="text-xs leading-5 text-muted-foreground">{t('提供检验、审核或验证记录。待审核可稍后补充；确认可供货必须具有真实文件依据。')}</p><ul className="space-y-2">{evidence.map(file => <li key={file.fileId} className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-sm"><FileText className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate" title={file.name}>{file.name}</span><Button type="button" variant="ghost" size="icon" aria-label={`${t('移除证据')} ${file.name}`} onClick={() => setEvidence(current => current.filter(item => item.fileId !== file.fileId))}><X className="size-4" /></Button></li>)}</ul><label className="block space-y-1 text-xs text-muted-foreground"><span>{t('本次依据与原因')}</span><Textarea required maxLength={2000} rows={3} value={reason} onChange={event => setReason(event.target.value)} placeholder={t('说明本次登记、确认、暂停或撤销的具体原因')} /></label></section>
    </fieldset>{error && <p role="alert" className="text-sm text-rose-700">{error}</p>}<DialogFooter className="border-t border-border pt-4"><Button type="button" variant="outline" disabled={busy} onClick={onClose}>{t('取消')}</Button><Button type="submit" disabled={busy || !directory.products.length}>{t(busy ? '正在保存…' : status === 'pending' ? '保存待审核' : '确认本次变更')}</Button></DialogFooter></form>
  </DialogContent></Dialog>;
}
