import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, FileText, Plus, RefreshCw } from 'lucide-react';
import { useAuth } from '../../auth';
import { AttachmentPreviewDialog, type PreviewableAttachment } from '../../components/AttachmentPreviewDialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { NativeSelect } from '../../components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { useI18n } from '../../lib/i18n';
import { getQualificationEvidence, listSupplyQualifications, type QualificationDirectory, type SupplyQualification } from '../../lib/supplierQualificationsApi';
import { filterSupplyQualifications, SUPPLY_QUALIFICATION_LABELS } from '../supplierQualificationsModel';
import { SupplierQualificationForm } from './SupplierQualificationForm';

export function SupplierQualificationsPanel({ materialId, supplierId, compact = false }: { materialId?: string; supplierId?: string; compact?: boolean }) {
  const { t } = useI18n(); const { user } = useAuth();
  const identity = JSON.stringify([user?.id, [...(user?.permissions ?? [])].sort(), materialId, supplierId]);
  const scopeRef = useRef(identity); scopeRef.current = identity;
  const [stored, setStored] = useState<{ identity: string; value: QualificationDirectory } | null>(null);
  const data = stored?.identity === identity ? stored.value : null;
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [reload, setReload] = useState(0);
  const [search, setSearch] = useState(''), [status, setStatus] = useState(''), [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null), [editing, setEditing] = useState<SupplyQualification | 'new' | null>(null);
  const [preview, setPreview] = useState<PreviewableAttachment | null>(null);
  useEffect(() => {
    const abort = new AbortController(); setLoading(true); setError(''); setPreview(null); setEditing(null);
    void listSupplyQualifications(materialId, supplierId, abort.signal).then(value => { if (!abort.signal.aborted) setStored({ identity, value }); })
      .catch(cause => { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : t('供货关系读取失败')); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [identity, reload, materialId, supplierId, t]);
  const rows = filterSupplyQualifications(data?.relations ?? [], search, status), pages = Math.max(1, Math.ceil(rows.length / 12)), currentPage = Math.min(page, pages);
  const selected = data?.relations.find(row => row.id === selectedId);
  const openEvidence = async (row: SupplyQualification, fileId: string) => {
    try { const attachment = await getQualificationEvidence(row.id, fileId); if (scopeRef.current === identity) setPreview(attachment); }
    catch (cause) { if (scopeRef.current === identity) setError(cause instanceof Error ? cause.message : t('证据打开失败')); }
  };
  return <section className="min-w-0 space-y-4" aria-label={t('物料供货资格')}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>{selected && <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedId(null)}><ArrowLeft className="size-4" />{t('返回供货关系列表')}</Button>}
        <h2 className="text-base font-semibold">{t(selected ? '供货关系详情' : '物料供货资格')}</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">{t('按正式物料与供应商分别审核。报价、供应商启用和样品通过均不自动赋予供货资格。')}</p></div>
      <div className="flex gap-2"><Button type="button" size="sm" variant="outline" disabled={loading} onClick={() => setReload(value => value + 1)}><RefreshCw className="size-4" />{t('刷新')}</Button>{data?.canRegister && !selected && <Button type="button" size="sm" disabled={loading || Boolean(error)} onClick={() => setEditing('new')}><Plus className="size-4" />{t('登记供货关系')}</Button>}</div>
    </div>
    {loading ? <p role="status" className="rounded-xl border border-border p-6 text-sm text-muted-foreground">{t('正在读取供货关系…')}</p> : error ? <div role="alert" className="rounded-xl border border-rose-200 p-4 text-sm text-rose-700"><p>{error}</p><Button variant="outline" className="mt-3" onClick={() => setReload(value => value + 1)}>{t('重新加载')}</Button></div> : data && <>
      {selectedId && !selected ? <p role="status" className="rounded-xl border border-border p-5 text-sm">{t('此关系不在当前范围，返回列表重新选择。')}<Button variant="link" onClick={() => setSelectedId(null)}>{t('返回列表')}</Button></p> : selected ? <>
        <div className="rounded-xl border border-border bg-card p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-semibold">{selected.materialName}</h3><p className="mt-1 text-sm text-muted-foreground">{selected.materialCode || t('编码待确认')} · {selected.supplierName}</p></div><span className="rounded-md bg-muted px-2 py-1 text-xs font-medium">{t(SUPPLY_QUALIFICATION_LABELS[selected.effectiveStatus])}</span></div>
          <dl className="mt-5 grid gap-4 border-t border-border pt-4 sm:grid-cols-3"><div><dt className="text-xs text-muted-foreground">{t('适用产品')}</dt><dd className="mt-1 text-sm">{selected.products.map(product => product.name).join('、')}</dd></div><div><dt className="text-xs text-muted-foreground">{t('生效期间')}</dt><dd className="mt-1 text-sm tabular-nums">{selected.effectiveFrom} — {selected.effectiveUntil || t('长期有效')}</dd></div><div><dt className="text-xs text-muted-foreground">{t('最后确认')}</dt><dd className="mt-1 text-sm">{selected.actorName} · {new Date(selected.at).toLocaleDateString()}</dd></div></dl>
          <p className="mt-4 whitespace-pre-wrap text-sm leading-6">{selected.reason}</p>
          <div className="mt-4 flex flex-wrap gap-2">{selected.evidence.map(file => <Button key={file.fileId} variant="outline" size="sm" onClick={() => void openEvidence(selected, file.fileId)}><FileText className="size-4" />{file.name}</Button>)}{!selected.evidence.length && <p className="text-xs text-muted-foreground">{t('尚未上传审核依据，不能确认可供货。')}</p>}</div>
          {(data.canReview || (data.canRegister && selected.status === 'pending')) && <div className="mt-5 border-t border-border pt-4"><Button onClick={() => setEditing(selected)}><CheckCircle2 className="size-4" />{t(data.canReview ? '审核或变更状态' : '补充并提交审核')}</Button></div>}
        </div>
        <section className="rounded-xl border border-border bg-card p-4 sm:p-5"><h3 className="text-sm font-semibold">{t('变更历史')} · {selected.history.length + 1}</h3><ol className="mt-3 divide-y divide-border">{[selected, ...[...selected.history].reverse()].map(revision => <li key={revision.version} className="py-3"><p className="text-sm font-medium">{t(SUPPLY_QUALIFICATION_LABELS[revision.status])} · {t('版本')} {revision.version}</p><p className="mt-1 text-xs text-muted-foreground">{revision.actorName} · {new Date(revision.at).toLocaleString()} · {revision.effectiveFrom} — {revision.effectiveUntil || t('长期有效')}</p><p className="mt-1 text-xs text-muted-foreground">{revision.products.map(product => product.name).join('、')}</p><p className="mt-2 whitespace-pre-wrap text-sm">{revision.reason}</p><div className="mt-2 flex flex-wrap gap-2">{revision.evidence.map(file => <Button key={file.fileId} variant="link" size="sm" onClick={() => void openEvidence(selected, file.fileId)}>{file.name}</Button>)}</div></li>)}</ol></section>
      </> : <>
        <div className="flex flex-wrap gap-3"><Input className="min-w-48 flex-1" aria-label={t('搜索供货关系')} placeholder={t('物料、编码、供应商或产品')} value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} /><div className="w-40"><NativeSelect aria-label={t('供货资格状态')} value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="">{t('全部状态')}</option>{Object.entries(SUPPLY_QUALIFICATION_LABELS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</NativeSelect></div></div>
        <div className="overflow-hidden rounded-xl border border-border bg-card [&>[data-slot=table-container]]:max-h-[52dvh] [&>[data-slot=table-container]]:overflow-auto"><Table className={compact ? 'min-w-[38rem]' : 'min-w-[48rem]'}><TableHeader className="sticky top-0 z-10 bg-card"><TableRow><TableHead>{t('物料 / 编码')}</TableHead><TableHead>{t('供应商')}</TableHead><TableHead>{t('当前资格')}</TableHead><TableHead>{t('适用产品')}</TableHead><TableHead>{t('生效期间')}</TableHead><TableHead className="text-right">{t('操作')}</TableHead></TableRow></TableHeader><TableBody>
          {rows.slice((currentPage - 1) * 12, currentPage * 12).map(row => <TableRow key={row.id}><TableCell><p className="font-medium">{row.materialName}</p><p className="mt-1 text-xs text-muted-foreground">{row.materialCode || t('编码待确认')}</p></TableCell><TableCell>{row.supplierName}</TableCell><TableCell><span className="rounded-md bg-muted px-2 py-1 text-xs">{t(SUPPLY_QUALIFICATION_LABELS[row.effectiveStatus])}</span></TableCell><TableCell className="max-w-56 whitespace-normal">{row.products.map(product => product.name).join('、')}</TableCell><TableCell className="text-xs tabular-nums">{row.effectiveFrom}<br />{row.effectiveUntil || t('长期有效')}</TableCell><TableCell className="text-right"><Button variant="ghost" size="sm" onClick={() => setSelectedId(row.id)}>{t('查看详情')}</Button></TableCell></TableRow>)}
          {!rows.length && <TableRow><TableCell colSpan={6} className="h-36 text-center text-sm text-muted-foreground">{t(search || status ? '没有符合筛选条件的供货关系' : '尚未登记供货资格。现有报价仍保留，资格需要单独审核。')}</TableCell></TableRow>}
        </TableBody></Table><div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs text-muted-foreground"><span>{t('共')} {rows.length} {t('条')} · {t('每页')} 12 {t('条')}</span><div className="flex items-center gap-3"><Button size="icon" variant="outline" aria-label={t('供货关系上一页')} disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft className="size-4" /></Button><span>{currentPage} / {pages}</span><Button size="icon" variant="outline" aria-label={t('供货关系下一页')} disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}><ChevronRight className="size-4" /></Button></div></div></div>
      </>}
    </>}
    {editing && data && <SupplierQualificationForm key={`${identity}:${editing === 'new' ? 'new' : editing.id}`} directory={data} relation={editing === 'new' ? undefined : editing} materialId={materialId} supplierId={supplierId} onClose={() => setEditing(null)} onSaved={id => { setSelectedId(id); setEditing(null); setReload(value => value + 1); }} />}
    {preview && <AttachmentPreviewDialog attachment={preview} onClose={() => setPreview(null)} />}
  </section>;
}
