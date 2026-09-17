import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import { useI18n } from '../../lib/i18n';
import { updateProcSampleRecords, type ProcSampleTestDetail, type UpdateProcSampleRecordsInput } from '../../lib/procurementApi';
import { sampleDraftTimingError, sampleInputTimestamp, sampleRecordsDraft } from './sampleRecordsModel';
import { SAMPLE_LEAD_START_LABELS, SAMPLE_TAX_LABELS, SampleConditionsView } from './SampleRoundHistory';
import { Input } from "../../components/ui/input";
import { NativeSelect } from "../../components/ui/native-select";
import { Textarea } from "../../components/ui/textarea";

export function SampleRecordsPanel({ detail, disabled, unavailable, identity = '', onSaved, onReload, onInteractionStateChange }: {
  detail: ProcSampleTestDetail; disabled?: boolean; unavailable?: boolean; identity?: string;
  onSaved: (detail: ProcSampleTestDetail) => void;
  onReload?: () => void;
  onInteractionStateChange: (state: { dirty: boolean; busy: boolean }) => void;
}) {
  const { t } = useI18n();
  const scope = JSON.stringify([detail.task.id, detail.sampleTest?.roundId, identity]);
  const seed = () => ({ scope, baseUpdatedAt: detail.task.updatedAt, initial: sampleRecordsDraft(detail.sampleTest), draft: sampleRecordsDraft(detail.sampleTest) });
  const [snapshot, setSnapshot] = useState(seed);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const lock = useRef(false);
  const latest = useRef({ scope, detail, disabled });
  latest.current = { scope, detail, disabled };
  const dirty = JSON.stringify(snapshot.draft) !== JSON.stringify(snapshot.initial);
  if (snapshot.scope !== scope || (!dirty && snapshot.baseUpdatedAt !== detail.task.updatedAt)) setSnapshot(seed());
  const stale = snapshot.baseUpdatedAt !== detail.task.updatedAt;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setError(''); }, [scope]);
  useEffect(() => {
    onInteractionStateChange({ dirty, busy });
    return () => onInteractionStateChange({ dirty: false, busy: false });
  }, [dirty, busy, onInteractionStateChange]);
  const blocked = Boolean(disabled || busy || stale);
  const edit = (next: (draft: typeof snapshot.draft) => typeof snapshot.draft) => {
    if (lock.current || latest.current.scope !== scope || latest.current.disabled || stale) return;
    setSnapshot((value) => ({ ...value, draft: next(value.draft) }));
    setError('');
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (lock.current || latest.current.scope !== scope || latest.current.disabled || disabled || stale || !dirty || !detail.sampleTest) return;
    const input: UpdateProcSampleRecordsInput = { roundId: detail.sampleTest.roundId, baseUpdatedAt: snapshot.baseUpdatedAt };
    const timingError = sampleDraftTimingError(snapshot.draft);
    if (timingError) { setError(t(timingError)); return; }
    for (const key of ['arrivedAt', 'startedAt', 'finishedAt'] as const) {
      if (snapshot.draft[key] !== snapshot.initial[key]) {
        if (key === 'arrivedAt' ? !detail.canRecordArrival : !detail.canRecordTesting) { setError(t('登记权限已变化，请重新加载')); return; }
        const value = sampleInputTimestamp(snapshot.draft[key]);
        if (!value) { setError(t('已登记的实际时间不能清空')); return; }
        input[key] = value;
      }
    }
    if (JSON.stringify(snapshot.draft.commercial) !== JSON.stringify(snapshot.initial.commercial)) {
      if (!detail.canRecordArrival) { setError(t('登记权限已变化，请重新加载')); return; }
      input.commercial = snapshot.draft.commercial;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const updated = await updateProcSampleRecords(detail.task.id, input);
      if (!mounted.current || latest.current.scope !== scope) return;
      if (updated.task.id !== detail.task.id || updated.sampleTest?.roundId !== input.roundId
        || Date.parse(latest.current.detail.task.updatedAt) > Date.parse(updated.task.updatedAt)) {
        setError(t('任务记录已变化，请重新加载后核对')); return;
      }
      setSnapshot({ scope, baseUpdatedAt: updated.task.updatedAt, initial: sampleRecordsDraft(updated.sampleTest), draft: sampleRecordsDraft(updated.sampleTest) });
      onSaved(updated);
    } catch (cause) {
      if (mounted.current && latest.current.scope === scope) setError(cause instanceof Error ? cause.message : t('样品登记保存失败'));
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  };
  const inputClass = 'mt-1 min-h-11 w-full rounded-lg border border-input bg-background px-3 py-2 text-base disabled:opacity-60';
  const commercial = snapshot.draft.commercial;
  const canEdit = detail.canRecordArrival || detail.canRecordTesting;
  return <section className="mb-4 rounded-xl border border-border bg-card p-4" aria-label={t('本轮样品登记')}>
    <h3 className="text-sm font-semibold">{t('本轮样品登记')}</h3>
    {unavailable ? <p role="status" className="mt-3 text-xs text-muted-foreground">{t('登记记录暂不可用，请重新加载后查看。')}</p> : canEdit ? <form onSubmit={(event) => { void submit(event); }} className="mt-3 space-y-4">
      <p className="text-xs leading-5 text-muted-foreground">{t('采购登记到样及采购条件，指定测试人登记开测和结束。按实际发生时间填写；修改会保留登记历史。')}</p>
      <div className="grid gap-3 lg:grid-cols-3">{(['arrivedAt', 'startedAt', 'finishedAt'] as const).map((key) => <label key={key} className="min-w-0 text-sm">
        {t({ arrivedAt: '实际到样时间', startedAt: '实际开测时间', finishedAt: '实际结束时间' }[key])}
        <Input type="datetime-local" step="1" aria-label={t({ arrivedAt: '实际到样时间', startedAt: '实际开测时间', finishedAt: '实际结束时间' }[key])} value={snapshot.draft[key]}
          disabled={blocked || (key === 'arrivedAt' ? !detail.canRecordArrival : !detail.canRecordTesting)} className={inputClass}
          onChange={(event) => edit((draft) => ({ ...draft, [key]: event.target.value }))} />
      </label>)}</div>
      {detail.canReadCommercial && <details className="rounded-lg border border-border p-3">
        <summary className="cursor-pointer text-sm font-medium">{t('本轮任务级采购条件')}</summary>
        <p className="my-3 text-xs leading-5 text-muted-foreground">{t('此处独立登记本轮约定；不自动套用某个供应商报价，也不据此推算到货日期。供应商及价格仍以采购报价记录为准。')}</p>
        {detail.canRecordArrival ? <fieldset disabled={blocked} className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">{t('报价计价单位')}<Input aria-label={t('报价计价单位')} maxLength={80} value={commercial.priceUnit} className={inputClass} onChange={(event) => edit((draft) => ({ ...draft, commercial: { ...draft.commercial, priceUnit: event.target.value } }))} /></label>
          <label className="text-sm">{t('含税口径')}<NativeSelect aria-label={t('含税口径')} value={commercial.taxBasis} className={inputClass} onChange={(event) => edit((draft) => ({ ...draft, commercial: { ...draft.commercial, taxBasis: event.target.value as typeof commercial.taxBasis } }))}>{Object.entries(SAMPLE_TAX_LABELS).map(([key, label]) => <option key={key} value={key}>{t(label)}</option>)}</NativeSelect></label>
          <label className="text-sm">{t('税率（%，未约定留空）')}<Input aria-label={t('税率')} type="number" min="0" max="100" step="any" value={commercial.taxRate ?? ''} className={inputClass} onChange={(event) => edit((draft) => ({ ...draft, commercial: { ...draft.commercial, taxRate: event.target.value === '' ? null : Number(event.target.value) } }))} /></label>
          <label className="text-sm">{t('交期起算')}<NativeSelect aria-label={t('交期起算')} value={commercial.leadTimeStart} className={inputClass} onChange={(event) => edit((draft) => ({ ...draft, commercial: { ...draft.commercial, leadTimeStart: event.target.value as typeof commercial.leadTimeStart, leadTimeStartDate: null } }))}>{Object.entries(SAMPLE_LEAD_START_LABELS).map(([key, label]) => <option key={key} value={key}>{t(label)}</option>)}</NativeSelect></label>
          {commercial.leadTimeStart === 'agreed_date' && <label className="text-sm">{t('约定起算日期')}<Input aria-label={t('约定起算日期')} type="date" required value={commercial.leadTimeStartDate ?? ''} className={inputClass} onChange={(event) => edit((draft) => ({ ...draft, commercial: { ...draft.commercial, leadTimeStartDate: event.target.value || null } }))} /></label>}
          {(['paymentTerms', 'freightTerms', 'note'] as const).map((key) => <label key={key} className="text-sm">{t({ paymentTerms: '付款条件', freightTerms: '运费承担与交付条件', note: '条件备注' }[key])}<Textarea aria-label={t({ paymentTerms: '付款条件', freightTerms: '运费承担与交付条件', note: '条件备注' }[key])} value={commercial[key]} rows={2} maxLength={500} className={inputClass} onChange={(event) => edit((draft) => ({ ...draft, commercial: { ...draft.commercial, [key]: event.target.value } }))} /></label>)}
        </fieldset> : <SampleConditionsView conditions={detail.sampleTest?.commercial} />}
      </details>}
      {stale && <p role="alert" className="text-sm text-amber-700">{t('服务端记录已更新，草稿已保留。请核对后重新载入记录，再填写。')}</p>}
      {error && <div role="alert" className="text-sm text-rose-700"><p>{error}</p>{onReload && <Button type="button" variant="link" disabled={Boolean(disabled || busy)} onClick={() => { if (!lock.current && !latest.current.disabled) onReload(); }}>{t('重新读取记录（保留草稿）')}</Button>}</div>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" disabled={Boolean(disabled || busy || !dirty)} onClick={() => { if (lock.current || latest.current.disabled) return; setSnapshot(seed()); setError(''); }}>{t(stale ? '放弃草稿并载入最新记录' : '撤销未保存修改')}</Button>
        <Button type="submit" disabled={blocked || !dirty}>{t(busy ? '正在保存…' : '保存本轮登记')}</Button>
      </div>
    </form> : <div className="mt-3 space-y-3"><p className="text-xs text-muted-foreground">{t('当前轮次不可登记；已保存的时间与条件可在历史中查看。')}</p>{detail.canReadCommercial && !disabled && <SampleConditionsView conditions={detail.sampleTest?.commercial} />}</div>}
  </section>;
}
