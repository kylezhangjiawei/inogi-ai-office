import { useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { useI18n } from '../../lib/i18n';
import { transferActionLabels, type TransferAction, type TransferActionContext, type TransferEvidence, type TransferRecord } from './transferTypes';

export function TransferActionForm({ record, actorId, context, onSubmit, onDirtyChange, onCancel }: { record: TransferRecord; actorId: string; context: TransferActionContext; onSubmit: (action: TransferAction) => Promise<void>; onDirtyChange: (dirty: boolean) => void; onCancel: () => void }) {
  const { t } = useI18n();
  const document = record.documents.find((item) => item.id === context.targetId);
  const [revision, setRevision] = useState(document?.revision ?? '');
  const [note, setNote] = useState(context.kind === 'document' ? document?.summary ?? '' : '');
  const [date, setDate] = useState('2026-09-14');
  const [quantity, setQuantity] = useState(String(record.minTrialQuantity));
  const [passed, setPassed] = useState(true);
  const [reviewed, setReviewed] = useState(false);
  const [evidence, setEvidence] = useState<TransferEvidence[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const lock = useRef(false);
  const fileGeneration = useRef(0);
  function change(action: () => void) { action(); onDirtyChange(true); setError(''); }
  async function attach(file?: File) {
    if (!file) return;
    if (!['image/jpeg','image/png','image/webp','video/mp4'].includes(file.type) || file.size > 5 * 1024 * 1024 || file.size === 0) { setError(t('请选择不超过 5 MB 的 PNG、JPG、WebP 图片或 MP4 视频。')); return; }
    if (evidence.length >= 4) { setError(t('最多添加 4 份证据，请先移除不需要的证据。')); return; }
    const generation = ++fileGeneration.current; setReading(true); onDirtyChange(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('读取失败')); reader.readAsDataURL(file); });
      if (generation !== fileGeneration.current) return;
      setEvidence((old) => [...old, { id:`evidence-${Date.now()}-${old.length}`, name:file.name, type:file.type === 'video/mp4' ? 'video' : 'photo', dataUrl }]); setError('');
    } catch { setError(t('文件读取失败，请重新选择文件。')); } finally { setReading(false); }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (lock.current || reading) return;
    const base = { actorId, recordId: record.id };
    let input: TransferAction;
    switch (context.kind) {
      case 'document': input = {...base, kind:'document', documentId:context.targetId ?? '', revision, summary:note, published:reviewed}; break;
      case 'trial': input = {...base, kind:'trial', date, quantity:Number(quantity), passed, result:note, evidence}; break;
      case 'remedy': input = {...base, kind:'remedy', problemId:context.targetId ?? '', note}; break;
      case 'verify': input = {...base, kind:'verify', problemId:context.targetId ?? '', note, passed}; break;
      default: input = {...base, kind:context.kind, reviewed, note};
    }
    lock.current = true; setBusy(true); setError('');
    try { await onSubmit(input); } catch (reason) { setError(reason instanceof Error ? reason.message : t('保存失败，填写已保留，请重试。')); } finally { lock.current = false; setBusy(false); }
  }
  return <form className="tp-action-form" onSubmit={save}>
    <h2>{t(transferActionLabels[context.kind])}</h2><p className="tp-note">{record.batch}{document ? ` · ${document.code}` : ''}</p>
    <fieldset disabled={busy}>
      {context.kind === 'document' ? <><Label htmlFor="tp-revision">{t('适用版本')}</Label><Input id="tp-revision" value={revision} maxLength={80} onChange={(event) => change(() => setRevision(event.target.value))} /><p className="tp-callout">{t('资料更新后，旧试装与岗位确认保留在历史中，需按新版本重新验证和确认。')}</p></> : null}
      {context.kind === 'trial' ? <><div className="tp-form-pair"><div><Label htmlFor="tp-date">{t('试装日期')}</Label><Input id="tp-date" type="date" value={date} onChange={(event) => change(() => setDate(event.target.value))} /></div><div><Label htmlFor="tp-quantity">{t('试装数量（件）')}</Label><Input id="tp-quantity" type="number" min={1} max={10000} step={1} value={quantity} onChange={(event) => change(() => setQuantity(event.target.value))} /></div></div><p className="tp-note">{t('本类型至少验证 {count} 件，最新一次验证须全部通过。', {count:record.minTrialQuantity})}</p></> : null}
      {context.kind === 'trial' || context.kind === 'verify' ? <><Label htmlFor="tp-result">{t('验证结论')}</Label><select id="tp-result" value={passed ? 'passed':'failed'} onChange={(event) => change(() => setPassed(event.target.value === 'passed'))}><option value="passed">{t('通过')}</option><option value="failed">{t('未通过')}</option></select></> : null}
      <Label htmlFor="tp-note">{t(context.kind === 'document' ? '版本与适用说明' : context.kind === 'trial' ? '验证方法与结果' : context.kind === 'verify' ? '复验依据与结论' : context.kind === 'remedy' ? '整改说明' : '确认意见')}</Label>
      <textarea id="tp-note" value={note} maxLength={1200} rows={4} placeholder={t('记录具体依据、范围及结果')} onChange={(event) => change(() => setNote(event.target.value))} />
      {context.kind === 'trial' ? <div className="tp-upload"><Label htmlFor="tp-file">{t(record.requireVideo ? '试装证据（本类型要求视频）' : '试装照片或视频（选填）')}</Label><Input id="tp-file" type="file" accept="image/png,image/jpeg,image/webp,video/mp4" disabled={reading || evidence.length >= 4} onChange={(event) => {void attach(event.target.files?.[0]); event.target.value = '';}} /><p className="tp-note">{t('最多 4 份，每份 5 MB；仅在本次预览内保留。')}</p>{reading ? <p role="status">{t('正在读取文件…')}</p> : null}{evidence.map((item) => <div className="tp-evidence-row" key={item.id}><span>{item.name}</span><Button type="button" size="sm" variant="ghost" aria-label={t('移除 {name}', {name:item.name})} onClick={() => change(() => setEvidence((old) => old.filter((entry) => entry.id !== item.id)))}>{t('移除')}</Button></div>)}</div> : null}
      {context.kind === 'document' || context.kind === 'confirm' || context.kind === 'submit' ? <label className="tp-check"><input type="checkbox" checked={reviewed} onChange={(event) => change(() => setReviewed(event.target.checked))} /><span>{t(context.kind === 'document' ? '已核对资料发布状态、版本与当前批次适用范围' : '已核对当前资料、试装结果与问题复验，确认本岗位意见')}</span></label> : null}
      {error ? <p className="tp-error" role="alert">{error}</p> : null}
      <div className="tp-form-actions"><Button type="button" variant="outline" disabled={busy || reading} onClick={onCancel}>{t('取消')}</Button><Button type="submit" disabled={busy || reading}>{t(busy ? '正在保存…' : transferActionLabels[context.kind])}</Button></div>
    </fieldset>
  </form>;
}
