import { ProductionWorkspace } from './ProductionWorkspace';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { NativeSelect } from '../../components/ui/native-select';
import { Checkbox } from '../../components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../../components/ui/alert-dialog';
import { useI18n } from '../../lib/i18n';
import type { QualityRecord } from '../../lib/procurementOperationsApi';
import { commandExecutionPlan, createExecutionPlan, getExecutionOptions, type ExecutionOptions, type ExecutionPlan, type ExecutionTask } from '../../lib/productionExecutionApi';

const today = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const ACTIONS: Record<string, string> = { 'review-basis': '核对历史执行依据', create: '确认月度计划', targets: '调整月度目标', batch: '新增生产批次', task: '编制作业', adjust: '调整作业安排', dispatch: '确认派工', cancel: '取消作业', report: '登记报工', inspect: '登记生产检验', disposition: '登记质量处置', 'assign-quality': '转交协同处理', 'reply-quality': '回复原异常' };
export type Editor = { action: string; task?: ExecutionTask; batchId?: string; quality?: QualityRecord };

export function ProductionExecutionPage() {
  return <ProductionWorkspace actionLabels={ACTIONS} renderEditor={(props) => <ExecutionEditor key={`${props.plan?.id ?? 'new'}:${props.editor.action}:${props.editor.task?.id ?? ''}`} {...props} />} />;
}
function Field({ label, children }: { label: string; children: (id: string) => ReactNode }) { const id = useId(); return <div className="space-y-2"><Label htmlFor={id}>{label}</Label>{children(id)}</div>; }
function ExecutionEditor({ editor, plan, month, onClose, onSaved }: { editor: Editor; plan?: ExecutionPlan; month: string; onClose: () => void; onSaved: (id: string) => void }) {
  const { t } = useI18n(), id = useId();
  const action = editor.action;
  const initial = { productId: '', productLine: '', targetQty: plan ? String(plan.targetQty) : '', shipmentTargetQty: plan ? String(plan.shipmentTargetQty) : '', reason: '', code: '', quantity: '', goodQty: '', dueDate: action === 'assign-quality' ? today() : `${month}-01`, requiredInfo: '', verificationPlan: '', date: today(), name: '', batchId: editor.batchId ?? plan?.batches[0]?.id ?? '', treeNodeId: '', ownerId: '', output: 'component', unit: '件', line: '', reportId: '', qualityId: '', issue: '', inspectionKind: '', process: '', sip: '', disposition: editor.quality?.disposition === 'pending' ? '' : editor.quality?.disposition ?? '', ...(action === 'adjust' && editor.task ? { quantity: String(editor.task.quantity), date: editor.task.date, line: editor.task.line, ownerId: editor.task.ownerId } : {}) };
  const [values, setValues] = useState({ ...initial, deviceId: '', bomRevisionId: '' }), [materials, setMaterials] = useState<Record<string, string>>({}), [search, setSearch] = useState('');
  const [options, setOptions] = useState<ExecutionOptions | null>(null), [loadError, setLoadError] = useState(''), [reload, setReload] = useState(0), [error, setError] = useState(''), [busy, setBusy] = useState(false), [discard, setDiscard] = useState(false);
  const locked = useRef(false), mounted = useRef(true), request = useRef<{ signature: string; id: string } | null>(null);
  const needsOptions = action === 'create' || action === 'review-basis' || action === 'task' || action === 'assign-quality' || action === 'adjust';
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (!needsOptions) return; const controller = new AbortController(); setLoadError(''); getExecutionOptions(controller.signal).then((value) => { if (!controller.signal.aborted) setOptions(value); }).catch((cause) => { if (!controller.signal.aborted) setLoadError(cause instanceof Error ? cause.message : t('选项读取失败')); }); return () => controller.abort(); }, [needsOptions, reload, t]);
  const dirty = JSON.stringify(values) !== JSON.stringify({ ...initial, deviceId: '', bomRevisionId: '' }) || Object.keys(materials).length > 0;
  const set = (key: keyof typeof values, value: string) => setValues((previous) => ({ ...previous, [key]: value, ...(key === 'productId' ? { deviceId: '', bomRevisionId: '' } : key === 'deviceId' ? { bomRevisionId: '' } : {}) }));
  const selectedProductId = action === 'review-basis' ? plan?.productId : values.productId;
  const roots = options?.nodes.filter(row => !row.parentId && row.productId === selectedProductId) ?? [];
  const devices = (options?.devices ?? []).filter(row => roots.some(root => root.id === row.productRootId) && (action === 'review-basis' || row.revisions.length > 0));
  const close = () => { if (!locked.current) dirty ? setDiscard(true) : onClose(); };
  const textInput = (key: keyof typeof values, label: string, type = 'text') => <Field label={t(label)}>{(fieldId) => <Input id={fieldId} type={type} value={values[key]} onChange={(event) => set(key, event.target.value)} required {...(type === 'number' ? { min: 0, step: key === 'targetQty' || key === 'shipmentTargetQty' ? 1 : '0.001' } : {})} />}</Field>;
  const select = (key: keyof typeof values, label: string, items: { value: string; label: string }[]) => <Field label={t(label)}>{(fieldId) => <NativeSelect id={fieldId} value={values[key]} onChange={(event) => set(key, event.target.value)} required><option value="">{t('请选择')}</option>{items.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</NativeSelect>}</Field>;
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (locked.current) return;
    const data: Record<string, unknown> = { reason: values.reason.trim() };
    if (!data.reason) { setError(t('请填写操作依据')); return; }
    const numeric = (key: keyof typeof values) => { if (!values[key].trim() || !Number.isFinite(Number(values[key])) || Number(values[key]) < 0) throw new Error(t('请填写有效数量')); return Number(values[key]); };
    try {
      if (action === 'create' || action === 'targets') Object.assign(data, { targetQty: numeric('targetQty'), shipmentTargetQty: numeric('shipmentTargetQty') });
      if (action === 'create') {
        const device = devices.find(row => row.id === values.deviceId);
        if (!device?.revisions.some(row => row.id === values.bomRevisionId)) throw new Error(t('请选择当前产品设备的有效发布版本'));
        Object.assign(data, { month, productId: values.productId, deviceId: values.deviceId, bomRevisionId: values.bomRevisionId });
      }
      if (action === 'review-basis') Object.assign(data, { deviceId: values.deviceId, sourceFingerprint: plan?.bomSourceFingerprint });
      if (action === 'batch') Object.assign(data, { code: values.code, quantity: numeric('quantity'), dueDate: values.dueDate });
      if (action === 'task') Object.assign(data, { name: values.name, batchId: values.batchId, treeNodeId: values.treeNodeId, ownerId: values.ownerId, output: values.output, unit: values.unit, line: values.line, quantity: numeric('quantity'), date: values.date, materials: Object.entries(materials).map(([code, qtyPer]) => { if (!qtyPer.trim() || !Number.isFinite(Number(qtyPer)) || Number(qtyPer) <= 0) throw new Error(t('请填写有效的每件领料用量')); return { code, qtyPer: Number(qtyPer) }; }) });
      if (editor.task) data.taskId = editor.task.id;
      if (action === 'adjust') Object.assign(data, { date: values.date, line: values.line, ownerId: values.ownerId, quantity: numeric('quantity') });
      if (action === 'report') Object.assign(data, { date: values.date, quantity: numeric('quantity'), goodQty: numeric('goodQty') });
      if (action === 'inspect') {
        if (!['process', 'final'].includes(values.inspectionKind) || !values.process.trim()) throw new Error(t('请选择检验类型并填写检验工序'));
        if (!editor.task?.basis?.sip?.trim() && !editor.task?.basis?.documents?.some(row => row.kind === 'sip') && !values.sip.trim()) throw new Error(t('请填写 SIP 检验依据'));
        Object.assign(data, { date: values.date, quantity: numeric('quantity'), goodQty: numeric('goodQty'), reportId: values.reportId, issue: values.issue, kind: values.inspectionKind, process: values.process, sip: values.sip, ...(values.qualityId ? { qualityId: values.qualityId } : {}) });
      }
      if (action === 'disposition') Object.assign(data, { qualityId: editor.quality!.id, baseUpdatedAt: editor.quality!.updatedAt, disposition: values.disposition });
      if (action === 'assign-quality' || action === 'reply-quality') Object.assign(data, { qualityId: editor.quality!.id, baseUpdatedAt: editor.quality!.updatedAt, ...(action === 'assign-quality' ? { ownerId: values.ownerId, dueDate: values.dueDate, requiredInfo: values.requiredInfo, verificationPlan: values.verificationPlan } : {}) });
      const signature = JSON.stringify([action, plan?.id, plan?.version, data]);
      if (request.current?.signature !== signature) request.current = { signature, id: crypto.randomUUID() };
      locked.current = true; setBusy(true); setError('');
      const result = action === 'create' ? await createExecutionPlan({ ...data, requestId: request.current.id }) : await commandExecutionPlan(plan!.id, { action, version: plan!.version, data, requestId: request.current.id });
      if (mounted.current) onSaved(result.id);
    } catch (cause) { if (mounted.current) { setError(cause instanceof Error ? cause.message : t('提交失败')); requestAnimationFrame(() => document.getElementById(`${id}-error`)?.focus()); } }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  }
  return <><Dialog open onOpenChange={(open) => { if (!open) close(); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl" onInteractOutside={(event) => event.preventDefault()} onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }}><DialogHeader><DialogTitle>{t(ACTIONS[action])}</DialogTitle><DialogDescription>{editor.task ? `${editor.task.name} · ${editor.task.line} · ${editor.task.ownerName}` : `${month} · ${plan?.productLine || t('确认后保留 BOM 版本与计划依据')}`}</DialogDescription></DialogHeader>
    {loadError ? <div role="alert"><p className="text-destructive">{loadError}</p><Button variant="outline" onClick={() => setReload((value) => value + 1)}>{t('重新加载')}</Button></div> : needsOptions && !options ? <p role="status" className="p-6 text-muted-foreground">{t('加载可选产品与人员…')}</p> : <form onSubmit={submit} className="space-y-5"><fieldset disabled={busy} className="space-y-4"><div className="grid gap-4 sm:grid-cols-2">
      {action === 'create' && <>{select('productId', '所属产品', [...new Map(options!.nodes.filter((node) => !node.parentId).map((node) => [node.productId, { value: node.productId, label: node.name }])).values()])}{select('deviceId', '生产 BOM 型号', devices.map(row => ({ value: row.id, label: row.productLine })))}{select('bomRevisionId', '已发布 BOM 版本', (devices.find(row => row.id === values.deviceId)?.revisions ?? []).map(row => ({ value: row.id, label: `V${row.version}` })))}{!devices.length && <p className="text-sm text-muted-foreground">{t('请先在 BOM 页面确认产品归属并发布版本。')}</p>}</>}
      {action === 'review-basis' && <>{select('deviceId', '原计划所属设备', devices.map(row => ({ value: row.id, label: row.productLine })))}<p className="text-sm text-muted-foreground">{t('仅确认历史产品与设备归属，保留以下原始用料，不替换为当前 BOM。')}</p><div className="max-h-60 overflow-auto sm:col-span-2"><table className="w-full text-sm tabular-nums"><thead><tr className="text-left"><th>{t('物料编码')}</th><th>{t('物料名称')}</th><th>{t('单机用量')}</th><th>{t('单位')}</th></tr></thead><tbody>{plan?.bom.map(row => <tr key={row.code} className="border-b"><td className="py-2">{row.code}</td><td>{row.name}</td><td>{row.qtyPer}</td><td>{row.unit}</td></tr>)}</tbody></table></div></>}
      {(action === 'create' || action === 'targets') && <>{textInput('targetQty', '月度生产目标（台）', 'number')}{textInput('shipmentTargetQty', '月度发货目标（台）', 'number')}</>}
      {action === 'batch' && <>{textInput('code', '批次编号')}{textInput('quantity', '批次目标（台）', 'number')}{textInput('dueDate', '批次交期', 'date')}</>}
      {action === 'task' && <>{select('batchId', '所属批次', plan!.batches.map((batch) => ({ value: batch.id, label: `${batch.code} · ${batch.quantity} ${t('台')}` })))}{textInput('name', '作业名称')}{select('treeNodeId', '所属子系统', options!.nodes.filter((node) => node.parentId && node.productId === plan!.productId).map((node) => ({ value: node.id, label: node.name })))}{select('output', '产出类型', [{ value: 'component', label: t('组件 / 工序产出') }, { value: 'whole', label: t('最终整机产出') }])}{textInput('quantity', '派工数量', 'number')}{values.output === 'component' && textInput('unit', '组件产出单位')}{textInput('date', '作业日期', 'date')}{textInput('line', '产线或工位')}{select('ownerId', '现场负责人', options!.users.filter((user) => user.canReport).map((user) => ({ value: user.id, label: user.name })))}</>}
      {action === 'report' && <>{textInput('date', '报工日期', 'date')}{textInput('quantity', `本次产量（${editor.task!.unit}）`, 'number')}{textInput('goodQty', `本次报工良品（${editor.task!.unit}）`, 'number')}</>}
      {action === 'adjust' && <>{textInput('date', '调整后作业日期', 'date')}{textInput('line', '产线或工位')}{select('ownerId', '现场负责人', options!.users.filter(user => user.canReport).map(user => ({ value: user.id, label: user.name })))}{textInput('quantity', `调整后目标（${editor.task!.unit}）`, 'number')}</>}
      {action === 'inspect' && <>{select('inspectionKind', '检验类型', [{ value: 'process', label: t('过程检') }, { value: 'final', label: t('终检') }])}{textInput('process', '检验工序')}{select('reportId', '对应报工', editor.task!.reports.map((row) => ({ value: row.id, label: `${row.date} · ${row.actorName} · ${row.quantity} ${editor.task!.unit}` })))}{editor.task?.fieldIssues?.some(row => !row.inspectionId) && <Field label={t('沿用现场原异常')}>{fieldId => <NativeSelect id={fieldId} value={values.qualityId} onChange={event => set('qualityId', event.target.value)}><option value="">请选择对应报工的原异常</option>{editor.task!.fieldIssues!.filter(row => !row.inspectionId && (!values.reportId || row.reportId === values.reportId)).map(row => <option key={row.qualityId} value={row.qualityId}>{row.date} · {row.defectiveQty} {editor.task!.unit} · {row.issue}</option>)}</NativeSelect>}</Field>}{textInput('date', '检验日期', 'date')}{textInput('quantity', `本次初检数（${editor.task!.unit}）`, 'number')}{textInput('goodQty', `首次合格数（${editor.task!.unit}）`, 'number')}{editor.task?.basis?.sip || editor.task?.basis?.documents?.some(row => row.kind === 'sip') ? <Field label={t('SIP 依据（派工快照）')}>{fieldId => <Input id={fieldId} value={editor.task!.basis!.sip || editor.task!.basis!.documents!.find(row => row.kind === 'sip')!.name} readOnly />}</Field> : textInput('sip', 'SIP 检验依据')}{Number(values.quantity) > Number(values.goodQty) && textInput('issue', '不良现象')}</>}
      {action === 'disposition' && <>{select('disposition', '处置方式', [{ value: 'rework', label: t('返工') }, { value: 'return', label: t('退货') }, { value: 'replacement', label: t('换货') }, { value: 'scrap', label: t('报废') }, { value: 'concession', label: t('让步接收') }])}<p className="text-pretty text-sm text-muted-foreground">{t('保存处置结果后仍须获授权的验证人登记验证结论，不能直接关闭。')}</p></>}
      {action === 'assign-quality' && <>{select('ownerId', '研发或协同处理人', options!.users.filter((person) => person.canCollaborate).map((person) => ({ value: person.id, label: person.name })))}{textInput('dueDate', '协同期限', 'date')}{textInput('requiredInfo', '待补资料')}{textInput('verificationPlan', '验证安排')}<p className="text-pretty text-sm text-muted-foreground">{t('沿用原异常编号及不良数量。新经办成为当前处理人，回复后回到发起人继续处置与验证。')}</p></>}
      {action === 'reply-quality' && <p className="text-pretty text-sm text-muted-foreground">{editor.quality?.collaboration?.reason}<span className="mt-2 block">{t('请填写分析结论、处理建议及验证依据。回复保留在原异常下，不会直接关闭异常。')}</span></p>}
    </div>
    {action === 'task' && <section className="space-y-3 rounded-xl border border-border p-4"><h3 className="text-sm font-semibold">{t('本作业领料明细')}</h3><p className="text-xs text-muted-foreground">{t('仅选择本工序实际领用物料，确认每件产出的用量。数量按派工数自动计算，避免多个工序重复领用整机 BOM。')}</p><Input aria-label={t('搜索 BOM 物料')} placeholder={t('搜索编码或名称')} value={search} onChange={(event) => setSearch(event.target.value)} /><div className="max-h-60 space-y-3 overflow-y-auto">{plan!.bom.filter((row) => `${row.code} ${row.name}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map((row) => <div key={row.code} className="flex items-center gap-3"><Checkbox aria-label={`${t('领用')} ${row.name}`} checked={row.code in materials} onCheckedChange={(checked) => setMaterials((previous) => { const next = { ...previous }; if (checked) next[row.code] = String(row.qtyPer); else delete next[row.code]; return next; })} /><div className="min-w-0 flex-1 text-sm"><p>{row.name}</p><p className="text-xs text-muted-foreground">{row.code} · {row.unit}</p></div>{row.code in materials && <Input className="w-28" type="number" min="0.001" step="0.001" required aria-label={`${row.name} ${t('每件用量')}`} value={materials[row.code]} onChange={(event) => setMaterials((previous) => ({ ...previous, [row.code]: event.target.value }))} />}</div>)}</div><p className="text-xs tabular-nums text-muted-foreground">{t('已选')} {Object.keys(materials).length} {t('种物料')}</p></section>}
    {action === 'dispatch' && <p className="rounded-xl bg-muted/60 p-4 text-pretty text-sm">{t('确认后将派发给现场负责人，并生成对应物料的仓库领料需求。重复提交只产生一份需求。')}</p>}
    {action === 'inspect' && <p className="rounded-xl bg-muted/60 p-4 text-pretty text-sm">{t('同工序过程检与终检分别按不重叠实物登记。过程检不计整机完成；复验沿原异常办理，不改写首次终检分母。无派工 SIP 快照时，请填写实际使用的依据，系统不会补造版本。')}</p>}
    {action === 'adjust' && <p className="rounded-xl bg-muted/60 p-4 text-pretty text-sm">{t('保留原作业编号、报工、已发和已签收数量。新目标不得低于已报工或已领物料对应数量；同批整机目标不能超额。修改日期、产线、负责人和数量均保留前后值及原因。')}</p>}
    {action === 'cancel' && <p className="rounded-xl bg-muted/60 p-4 text-pretty text-sm">{t('取消后保留历史。已有报工或领料已办理的作业不能直接取消。')}</p>}
    <Field label={t(action === 'report' ? '报工说明' : '操作依据与原因')}>{(fieldId) => <Textarea id={fieldId} value={values.reason} required maxLength={2000} onChange={(event) => set('reason', event.target.value)} />}</Field></fieldset>
    {error && <p id={`${id}-error`} tabIndex={-1} role="alert" className="rounded-lg bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
    <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={close}>{t('取消')}</Button><Button type="submit" disabled={busy}>{busy && <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}{t(busy ? '正在提交' : ACTIONS[action])}</Button></DialogFooter>
  </form>}</DialogContent></Dialog><AlertDialog open={discard} onOpenChange={setDiscard}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t('放弃尚未保存的内容？')}</AlertDialogTitle><AlertDialogDescription>{t('本次填写尚未提交，关闭后将丢失。')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t('继续填写')}</AlertDialogCancel><AlertDialogAction onClick={onClose}>{t('放弃填写')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></>;
}
