import { useEffect, useRef, useState } from 'react';
import { NativeSelect } from '../../components/ui/native-select';
import { Button } from '../../components/ui/button';
import { Textarea } from '../../components/ui/textarea';
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../../components/ui/alert-dialog';
import { usePermission } from '../../hooks/usePermission';
import { useI18n } from '../../lib/i18n';
import { confirmStockPlanBomBasis, readBomDeviceOptions, type BomDeviceOption, type ProcStockPlan } from '../../lib/procurementApi';

export function StockPlanBomBasis({ plan, canCreate, onSaved }: { plan: ProcStockPlan; canCreate: boolean; onSaved: () => void }) {
  const { t } = useI18n(), canPublish = usePermission('bom:publish');
  const [open, setOpen] = useState(false), [options, setOptions] = useState<BomDeviceOption[] | null>(null);
  const [revisionId, setRevisionId] = useState(''), [reason, setReason] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const request = useRef<{ signature: string; id: string } | null>(null), pending = useRef(false);
  useEffect(() => { if (!open) return; const controller = new AbortController(); setError(''); readBomDeviceOptions(controller.signal).then(data => { if (!controller.signal.aborted) setOptions(data.devices); }).catch(e => { if (!controller.signal.aborted) setError(e.message); }); return () => controller.abort(); }, [open]);
  if (plan.planType !== 'machine') return null;
  const revisions = (options ?? []).filter(row => row.productRoot.productId === plan.productId && row.productLine === plan.productLine).flatMap(row => row.revisions);
  const submit = async () => {
    if (pending.current || !reason.trim() || !revisions.some(row => row.id === revisionId)) return;
    pending.current = true; setBusy(true); setError('');
    const signature = JSON.stringify([plan.id, plan.updatedAt, revisionId, reason]);
    if (request.current?.signature !== signature) request.current = { signature, id: crypto.randomUUID() };
    try { await confirmStockPlanBomBasis(plan.id, { revisionId, expectedUpdatedAt: plan.updatedAt, requestId: request.current.id, reason: reason.trim() }); setOpen(false); onSaved(); }
    catch (e) { setError(e instanceof Error ? e.message : t('核对失败')); }
    finally { pending.current = false; setBusy(false); }
  };
  return <section className="mb-4 space-y-2 border-b pb-3 text-sm"><h4 className="font-semibold text-balance">{t('BOM 执行依据')}</h4>{plan.bomRevisionId ? <p className="text-muted-foreground">{plan.bomBasis ? `${t('从确认时起采用发布版本')} · ${plan.bomBasis.actorName} · ${plan.bomBasis.reason}` : t('采用创建计划时选定的发布版本，工作稿修改不影响本计划。')}</p> : <><p className="text-amber-700">{t('历史备货没有原始 BOM 快照，请确认从现在起采用的发布版本。')}</p>{canCreate && canPublish ? <Button variant="outline" size="sm" onClick={() => setOpen(true)}>{t('确认备货 BOM 依据')}</Button> : <p className="text-muted-foreground">{t('请联系同时具备采购办理与 BOM 发布权限的人员。')}</p>}</>}{Boolean(plan.tasks?.length) && <p className="text-muted-foreground">{t('已生成采购任务保留原需求和履约，本次确认不覆盖、不重复生成。')}</p>}
    <AlertDialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}><AlertDialogContent className="horizon-theme horizon-portal"><AlertDialogHeader><AlertDialogTitle>{t('确认备货 BOM 依据')}</AlertDialogTitle><AlertDialogDescription>{t('此次采用当前发布版本，不代表历史 BOM 已被还原；确认后不能直接替换。')}</AlertDialogDescription></AlertDialogHeader><label className="grid gap-2 text-sm">{t('已发布 BOM 版本')}<NativeSelect className="rounded-md border bg-background p-2" disabled={busy} value={revisionId} onChange={e => setRevisionId(e.target.value)}><option value="">{t(options ? '请选择有效发布版本' : '加载中…')}</option>{revisions.map(row => <option key={row.id} value={row.id}>V{row.version}</option>)}</NativeSelect></label><label className="grid gap-2 text-sm">{t('核对依据')}<Textarea disabled={busy} value={reason} maxLength={2000} onChange={e => setReason(e.target.value)} /></label>{error && <p role="alert" className="text-destructive">{error}</p>}<AlertDialogFooter><Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>{t('取消')}</Button><Button disabled={busy || !revisionId || !reason.trim()} onClick={() => void submit()}>{t(busy ? '正在提交…' : '确认采用')}</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>;
}
