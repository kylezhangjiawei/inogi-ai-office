import '../../production/execution/production-theme.css';
import { useEffect, useId, useRef, useState } from 'react';
import { ClipboardCheck, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../../components/ui/alert-dialog';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { useI18n } from '../../lib/i18n';
import { getQualityVerifications, reopenQualityRecord, verifyQualityRecord, type QualityRecord, type QualityVerification } from '../../lib/procurementOperationsApi';

export function QualityVerificationDialog({ record, canVerify, onClose, onSaved }: {
  record: QualityRecord; canVerify: boolean; onClose: () => void; onSaved: () => void;
}) {
  const { t } = useI18n();
  const id = useId(), errorRef = useRef<HTMLParagraphElement>(null);
  const requestRef = useRef<{ signature: string; id: string } | null>(null);
  const submitLock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [history, setHistory] = useState<QualityVerification[]>([]);
  const [loading, setLoading] = useState(true), [loadError, setLoadError] = useState(''), [reload, setReload] = useState(0);
  const [date, setDate] = useState(() => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10));
  const [inspected, setInspected] = useState(String(record.defectiveQty)), [passed, setPassed] = useState('');
  const [evidence, setEvidence] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<'close' | 'reopen' | 'discard' | null>(null);
  const closed = record.status === 'closed';
  const latest = history[0];
  const accepted = latest?.kind === 'verification' && latest.source.disposition === record.disposition && latest.source.resolution === record.resolution && Number(latest.source.defectiveQty) === record.defectiveQty ? latest.effectivePassedQty ?? latest.passedQty ?? 0 : 0;
  const remaining = Math.max(0, Number((record.defectiveQty - accepted).toFixed(3)));
  const complete = Number(passed) === remaining;
  const dirty = Boolean(evidence || passed || inspected !== String(remaining));

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setLoadError('');
    getQualityVerifications(record.id, controller.signal).then((rows) => { if (!controller.signal.aborted) { setHistory(rows); const last = rows[0]; const done = last?.kind === 'verification' && last.source.disposition === record.disposition && last.source.resolution === record.resolution && Number(last.source.defectiveQty) === record.defectiveQty ? last.effectivePassedQty ?? last.passedQty ?? 0 : 0; setInspected(String(Math.max(0, Number((record.defectiveQty - done).toFixed(3))))); } })
      .catch((cause) => { if (!controller.signal.aborted) setLoadError(cause instanceof Error ? cause.message : t('复验历史读取失败')); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [record.id, reload, t]);

  function showError(message: string) { setError(message); requestAnimationFrame(() => errorRef.current?.focus()); }
  async function submit() {
    if (submitLock.current) return;
    submitLock.current = true; setBusy(true); setError('');
    const payload = closed ? { baseUpdatedAt: record.updatedAt, reason: evidence.trim() }
      : { baseUpdatedAt: record.updatedAt, scope: 'remaining' as const, verificationDate: date, inspectedQty: Number(inspected), passedQty: Number(passed), evidence: evidence.trim() };
    const signature = JSON.stringify([record.id, closed, payload]);
    if (requestRef.current?.signature !== signature) requestRef.current = { signature, id: crypto.randomUUID() };
    try {
      const result = closed ? await reopenQualityRecord(record.id, { baseUpdatedAt: record.updatedAt, reason: evidence.trim(), requestId: requestRef.current.id })
        : await verifyQualityRecord(record.id, { baseUpdatedAt: record.updatedAt, scope: 'remaining' as const, verificationDate: date, inspectedQty: Number(inspected), passedQty: Number(passed), evidence: evidence.trim(), requestId: requestRef.current.id });
      if (!mounted.current) return;
      toast.success(t(closed ? '已重新打开，历史验证记录保留' : result.closed ? '复验通过，异常已关闭' : '复验已记录，异常继续处理'));
      onSaved();
    } catch (cause) { if (mounted.current) showError(cause instanceof Error ? cause.message : t('保存失败，填写内容已保留')); }
    finally { submitLock.current = false; if (mounted.current) setBusy(false); }
  }
  function requestClose() { if (!busy) dirty ? setConfirm('discard') : onClose(); }

  return <>
    <Dialog open onOpenChange={(open) => { if (!open) requestClose(); }}>
      <DialogContent className="production-ui-theme max-h-[90dvh] overflow-y-auto sm:max-w-xl" onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }} onPointerDownOutside={(event) => { if (busy) event.preventDefault(); }}>
        <DialogHeader><DialogTitle className="flex items-center gap-2 text-balance"><ClipboardCheck className="size-5 text-primary" aria-hidden="true" />{t('质量验证')}</DialogTitle><DialogDescription className="text-pretty">{record.batchNo} · {record.issue}</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 gap-4 rounded-xl bg-muted/60 p-4 text-sm"><div><p className="text-muted-foreground">{t('原不良数量')}</p><p className="mt-1 font-semibold tabular-nums">{record.defectiveQty} {record.unit}</p></div><div><p className="text-muted-foreground">{t('当前状态')}</p><p className="mt-1 font-semibold">{t(closed ? '已关闭' : '待验证')}</p></div><p className="col-span-2 whitespace-pre-wrap text-pretty text-muted-foreground">{record.resolution || t('尚未填写处理结果，请先完成处置。')}</p></div>
        {loading ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden="true" />{t('读取验证记录')}</p> : loadError ? <div role="alert"><p className="text-sm text-destructive">{loadError}</p><Button variant="outline" className="mt-2" onClick={() => setReload((value) => value + 1)}>{t('重新读取')}</Button></div> : <section aria-label={t('验证历史')} className="space-y-3">
          <h3 className="text-sm font-semibold">{t('验证历史')} <span className="text-muted-foreground tabular-nums">{history.length}</span></h3>
          {!history.length ? <p className="text-sm text-muted-foreground">{t(closed ? '历史关闭记录没有独立复验依据，可重新打开后补充验证。' : '暂无复验记录。')}</p> : history.map((entry) => <article key={entry.requestId} className="rounded-xl border border-border p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><strong>{t(entry.kind === 'reopen' ? '重新打开' : entry.closed ? '验证通过并关闭' : '继续处理')}</strong><span className="text-xs text-muted-foreground">{entry.actorName} · {entry.verificationDate || entry.recordedAt.slice(0, 10)}</span></div>{entry.kind === 'verification' && <p className="mt-1 tabular-nums text-muted-foreground">{t('验证通过 / 本轮复验')}：{entry.passedQty} / {entry.inspectedQty} {entry.source.unit}</p>}<p className="mt-2 whitespace-pre-wrap text-pretty">{entry.evidence}</p></article>)}
        </section>}
        {canVerify && !loading && !loadError ? <form onSubmit={(event) => {
          event.preventDefault();
          if (!evidence.trim()) { showError(t('请填写验证依据或重新打开原因')); return; }
          if (!closed && (!passed.trim() || Number(passed) > Number(inspected) || Number(inspected) > remaining)) { showError(t('验证通过数量不能超过本轮复验数量')); return; }
          if (closed || complete) setConfirm(closed ? 'reopen' : 'close'); else void submit();
        }}><fieldset disabled={busy} className="space-y-4 border-t border-border pt-4">
          {!closed ? <><p className="text-pretty text-xs leading-5 text-muted-foreground">{t('仅登记尚未通过的实物，已通过数量保留且不重复累计。全部处置验证完成后关闭；首次检验数量保持不变。')}</p><div className="grid gap-3 sm:grid-cols-3"><div className="space-y-2"><Label htmlFor={`${id}-date`}>{t('复验日期')}</Label><Input id={`${id}-date`} required type="date" min={record.inspectionDate} value={date} onChange={(event) => setDate(event.target.value)} /></div><div className="space-y-2"><Label htmlFor={`${id}-inspected`}>{t('本轮复验数')}</Label><Input id={`${id}-inspected`} required type="number" min="0.001" step="0.001" max={remaining} value={inspected} onChange={(event) => setInspected(event.target.value)} /></div><div className="space-y-2"><Label htmlFor={`${id}-passed`}>{t('验证通过数')}</Label><Input id={`${id}-passed`} required type="number" min="0" step="0.001" max={Number(inspected)} value={passed} onChange={(event) => setPassed(event.target.value)} /></div></div></> : null}
          <div className="space-y-2"><Label htmlFor={`${id}-evidence`}>{t(closed ? '重新打开原因' : '复验依据与结论')}</Label><Textarea id={`${id}-evidence`} required maxLength={4000} rows={3} value={evidence} onChange={(event) => setEvidence(event.target.value)} placeholder={t(closed ? '说明需要重新处理的原因' : '填写检验单号、采用标准、验证结果或处置完成凭据')} /></div>
          {error && <p ref={errorRef} tabIndex={-1} role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
          <DialogFooter><Button type="button" variant="outline" onClick={requestClose}>{t('取消')}</Button><Button type="submit">{busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}{t(closed ? '重新打开' : complete ? '确认验证并关闭' : '记录复验')}</Button></DialogFooter>
        </fieldset></form> : <DialogFooter><Button variant="outline" onClick={requestClose}>{t('返回')}</Button></DialogFooter>}
      </DialogContent>
    </Dialog>
    <AlertDialog open={confirm !== null} onOpenChange={(open) => { if (!open) setConfirm(null); }}><AlertDialogContent className="production-ui-theme"><AlertDialogHeader><AlertDialogTitle>{t(confirm === 'discard' ? '放弃尚未保存的填写？' : confirm === 'reopen' ? '重新打开这条异常？' : '确认验证通过并关闭？')}</AlertDialogTitle><AlertDialogDescription>{t(confirm === 'discard' ? '已保存的验证记录会保留。' : confirm === 'reopen' ? '原验证历史会保留，异常重新进入处理中。' : '将记录您的验证身份、数量和依据，关闭后普通处理人不能直接修改。')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t('继续核对')}</AlertDialogCancel><AlertDialogAction onClick={() => { const action = confirm; setConfirm(null); if (action === 'discard') onClose(); else void submit(); }}>{t('确认')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </>;
}
