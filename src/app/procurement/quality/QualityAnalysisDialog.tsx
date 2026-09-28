import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { NativeSelect } from '../../components/ui/native-select';
import { AttachmentPreviewDialog, type PreviewableAttachment } from '../../components/AttachmentPreviewDialog';
import { useAuth } from '../../auth';
import { usePermission } from '../../hooks/usePermission';
import { uploadResourceFile } from '../../lib/resourceUpload';
import { commandExecutionPlan } from '../../lib/productionExecutionApi';
import { getQualityAnalysis, getQualityAttachment, saveQualityAnalysis, type QualityAnalysis, type QualityAnalysisResponse, type QualitySource } from '../../lib/procurementOperationsApi';
import { QualityVerificationDialog } from '../components/QualityVerificationDialog';
export const qualitySourceNames: Record<QualitySource, string> = { procurement: '采购', production: '生产', warehouse: '仓库', after_sales: '售后' };
export const qualityCauseNames = { unknown: '未知 / 待分析', process: '工艺', packaging: '包装', standard: '检验标准', revision: '版本', material: '物料', other: '其他' };
export function QualityAnalysisDialog(props: { id: string; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth();
  return <QualityAnalysisContent key={`${props.id}:${user?.id}:${user?.permissions?.join(',')}`} {...props} />;
}
function QualityAnalysisContent({ id, onClose, onSaved }: { id: string; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth();
  const canCollaborate = usePermission('proc-quality:collaborate');
  const canManage = usePermission('proc-quality:manage'), canVerify = usePermission('proc-quality:verify');
  const [loaded, setLoaded] = useState<QualityAnalysisResponse | null>(null), [draft, setDraft] = useState<QualityAnalysis | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [reload, setReload] = useState(0), [busy, setBusy] = useState(false);
  const [reason, setReason] = useState(''), [dirty, setDirty] = useState(false), [discard, setDiscard] = useState(false), [verify, setVerify] = useState(false);
  const [disposition, setDisposition] = useState('pending'), [resolution, setResolution] = useState('');
  const [preview, setPreview] = useState<PreviewableAttachment | null>(null);
  const [reply,setReply] = useState('');
  const mounted = useRef(true), lock = useRef(false), upload = useRef<AbortController | null>(null), request = useRef<{ signature: string; id: string } | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; upload.current?.abort(); }; }, []);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    getQualityAnalysis(id, controller.signal).then(value => { if (!controller.signal.aborted) { setLoaded(value); setDraft(value.analysis); setDisposition(value.record.disposition); setResolution(value.record.resolution || ''); setDirty(false); setReason(''); } })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '质量记录读取失败'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, reload]);
  const set = (patch: Partial<QualityAnalysis>) => { setDraft(value => value ? { ...value, ...patch, state: 'pending', confirmedBy: undefined, confirmedByName: undefined, confirmedAt: undefined } : value); setDirty(true); };
  const close = () => { if (lock.current) return; if (dirty) setDiscard(true); else onClose(); };
  const saved = () => { onSaved(); setReload(value => value + 1); };
  async function save(action: 'save' | 'confirm') {
    if (!loaded || !draft || lock.current) return; lock.current = true; setBusy(true); setError('');
    try {
      {
        const data = { category: draft.category, detail: draft.detail, evidence: draft.evidence, responsibility: draft.responsibility, phenomena: draft.phenomena, references: draft.references, fileIds: draft.files.map(row => row.fileId), disposition, resolution, reason, ...(loaded.productionSource?.fieldIssueId ? { materialBatches: draft.materialBatches ?? [] } : {}) };
        const signature = JSON.stringify([action, draft.version, loaded.record.updatedAt, data]);
        if (request.current?.signature !== signature) request.current = { signature, id: crypto.randomUUID() };
        await saveQualityAnalysis(id, { requestId: request.current.id, version: draft.version, baseUpdatedAt: loaded.record.updatedAt, action, data });
      }
      if (mounted.current) saved();
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : '保存失败，填写内容已保留'); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  async function uploadFiles(files: FileList | null) {
    if (!files?.length || !draft || lock.current) return;
    if (draft.files.length + files.length > 20) { setError('最多保存 20 个证据附件'); return; }
    lock.current = true; setBusy(true); setError(''); upload.current = new AbortController();
    try {
      for (const file of Array.from(files)) {
        const item = await uploadResourceFile(file, 'assets', { signal: upload.current.signal });
        if (mounted.current) { setDraft(value => value ? { ...value, files: [...value.files, { fileId: item.fileId, name: item.fileName, mime: item.mimeType, size: item.fileSize }] } : value); setDirty(true); }
      }
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : '附件上传失败'); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  async function openFile(fileId: string) {
    setError('');
    try {
      const refresh = () => getQualityAttachment(id, fileId);
      const attachment = await refresh();
      if (mounted.current) setPreview({ ...attachment, refresh });
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : '请先保存新上传的附件，再打开预览'); }
  }
  const editable = canManage && loaded?.record.status !== 'closed';
  async function replyOriginal() {
    if (lock.current || !loaded?.productionSource?.planVersion || !reply.trim()) return;
    const data = { qualityId:id,baseUpdatedAt:loaded.record.updatedAt,reason:reply.trim() };
    const signature = JSON.stringify(['reply-quality',loaded.productionSource.planVersion,data]);
    if(request.current?.signature!==signature)request.current={signature,id:crypto.randomUUID()};
    lock.current=true;setBusy(true);setError('');
    try { await commandExecutionPlan(loaded.productionSource.planId,{requestId:request.current.id,version:loaded.productionSource.planVersion,action:'reply-quality',data});if(mounted.current){setReply('');saved();} }
    catch(cause){if(mounted.current)setError(cause instanceof Error?cause.message:'回复失败，内容已保留');}
    finally{lock.current=false;if(mounted.current)setBusy(false);}
  }
  return <Dialog open onOpenChange={open => { if (!open) close(); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-4xl" onInteractOutside={event => event.preventDefault()} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}>
    <DialogHeader><DialogTitle>质量异常详情</DialogTitle><DialogDescription>{loaded ? `${qualitySourceNames[loaded.record.source]} · ${loaded.record.batchNo} · 原异常 ${id}` : '沿原异常查看原因、责任、处置与复验。'}</DialogDescription></DialogHeader>
    {error && <p role="alert" className="rounded-lg bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
    {loading ? <p role="status">正在读取质量记录…</p> : !loaded || !draft ? <Button variant="outline" onClick={() => setReload(value => value + 1)}>重新加载</Button> : <>
      <div className="grid gap-3 rounded-xl bg-muted/50 p-4 sm:grid-cols-3"><div><p className="text-xs text-muted-foreground">唯一不良件数</p><strong>{loaded.record.defectiveQty} {loaded.record.unit}</strong><p className="text-xs text-muted-foreground">检验 {loaded.record.inspectedQty} {loaded.record.unit}</p></div><div><p className="text-xs text-muted-foreground">现象发生次数</p><strong>{draft.phenomena.reduce((sum, row) => sum + row.count, 0)} 次</strong><p className="text-xs text-muted-foreground">同件多现象可重复，不加到不良件数</p></div><div><p className="text-xs text-muted-foreground">主因确认</p><strong>{draft.state === 'confirmed' ? '已授权确认' : '待分析 / 确认'}</strong><p className="text-xs text-muted-foreground">{draft.confirmedByName || '未知原因单独统计'}</p></div></div>
      <p className="whitespace-pre-wrap text-sm">{loaded.record.issue}</p>
      {loaded.record.collaboration && <section className="space-y-2 rounded-lg border p-4 text-sm"><h3 className="font-semibold">原异常协同</h3><p>当前经办：{loaded.record.collaboration.ownerName} · 期限：{loaded.record.collaboration.dueDate || '待确认'}</p><p>待补资料：{loaded.record.collaboration.requiredInfo || '待确认'}</p><p>验证安排：{loaded.record.collaboration.verificationPlan || '待确认'}</p>{loaded.record.collaboration.reply && <p className="whitespace-pre-wrap">回复：{loaded.record.collaboration.reply}</p>}{canCollaborate && loaded.record.collaboration.phase==='waiting_reply' && loaded.record.collaboration.ownerId===user?.id && <><Textarea aria-label="回复原质量异常" disabled={busy} value={reply} onChange={event=>{setReply(event.target.value);setDirty(true);}}/><Button disabled={busy||!reply.trim()} onClick={()=>void replyOriginal()}>回复原异常</Button></>}</section>}
      <fieldset disabled={busy || !editable} className="space-y-5">
        <section className="space-y-3 border-t pt-4"><h3 className="text-sm font-semibold">现象与实际证据</h3>{draft.phenomena.map((row, index) => <div className="flex gap-2" key={index}><Input aria-label={`现象 ${index + 1}`} value={row.name} onChange={event => set({ phenomena: draft.phenomena.map((item, i) => i === index ? { ...item, name: event.target.value } : item) })} /><Input className="w-28" type="number" min="1" step="1" aria-label={`现象 ${index + 1} 发生次数`} value={row.count} onChange={event => set({ phenomena: draft.phenomena.map((item, i) => i === index ? { ...item, count: Number(event.target.value) } : item) })} /><Button variant="ghost" onClick={() => set({ phenomena: draft.phenomena.filter((_, i) => i !== index) })}>移除</Button></div>)}{editable && <Button variant="outline" size="sm" onClick={() => set({ phenomena: [...draft.phenomena, { name: '', count: 1 }] })}>添加现象</Button>}
          <label className="grid gap-1 text-sm">证据与分析依据<Textarea rows={3} value={draft.evidence} onChange={event => set({ evidence: event.target.value })} /></label>
          {editable && <label className="grid gap-1 text-sm">上传照片或附件<Input type="file" multiple onChange={event => { void uploadFiles(event.target.files); event.target.value = ''; }} /></label>}
        </section>
        {loaded.productionSource?.fieldIssueId && <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-semibold">现场实领批次 · 缺码可待补</summary>{(draft.materialBatches ?? []).map((row,index) => <label className="my-3 grid gap-1 text-sm" key={index}>{row.code}<NativeSelect value={row.batchNo || ''} onChange={event => set({ materialBatches: draft.materialBatches!.map((item,i)=>i===index?{...item,batchNo:event.target.value||null}:item) })}><option value="">批号待补</option>{loaded.receivedBatches.find(item=>item.code===row.code)?.batches.map(batch=><option key={batch.batchNo} value={batch.batchNo}>{batch.batchNo}</option>)}</NativeSelect></label>)}{!(draft.materialBatches?.length) && <p className="my-3 text-sm text-muted-foreground">现场尚未记录物料批次。</p>}<p className="text-xs text-muted-foreground">只可选择原作业已签收批次，修改随原因分析保留历史。</p></details>}
        <section className="grid gap-3 border-t pt-4 sm:grid-cols-2"><h3 className="col-span-full text-sm font-semibold">主因与责任认定</h3><label className="grid gap-1 text-sm">主因类别<NativeSelect value={draft.category} onChange={event => set({ category: event.target.value as QualityAnalysis['category'] })}>{Object.entries(qualityCauseNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</NativeSelect></label><label className="grid gap-1 text-sm">责任类型<NativeSelect value={draft.responsibility.kind} onChange={event => set({ responsibility: { kind: event.target.value as QualityAnalysis['responsibility']['kind'], name: '' } })}>{[['unknown','待认定'],['internal','内部责任人'],['supplier','供应商'],['other','其他主体']].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</NativeSelect></label>
          {['internal', 'supplier'].includes(draft.responsibility.kind) && <label className="grid gap-1 text-sm">责任主体<NativeSelect value={draft.responsibility.id || ''} onChange={event => set({ responsibility: { ...draft.responsibility, id: event.target.value } })}><option value="">请选择</option>{(draft.responsibility.kind === 'internal' ? loaded.people : loaded.suppliers).map(row => <option key={row.id} value={row.id}>{row.name} · {row.id}</option>)}</NativeSelect>{!editable && <span>{draft.responsibility.name}</span>}</label>}
          {draft.responsibility.kind === 'other' && <label className="grid gap-1 text-sm">责任主体<Input value={draft.responsibility.name} onChange={event => set({ responsibility: { ...draft.responsibility, name: event.target.value } })} /></label>}
          <label className="col-span-full grid gap-1 text-sm">原因说明<Textarea rows={3} value={draft.detail} onChange={event => set({ detail: event.target.value })} /></label><p className="col-span-full text-xs text-muted-foreground">协同经办只负责处理流转；责任主体须由质量授权人员按依据独立认定。</p>
        </section>
        <details className="border-t pt-4"><summary className="cursor-pointer text-sm font-semibold">跨来源反馈 · {draft.references.length} 条</summary><p className="my-3 text-xs text-muted-foreground">采购、生产、仓库和售后引用同一异常，不再次累加不良件数。</p>{draft.references.map((row,index) => <div key={index} className="mb-3 grid gap-2 sm:grid-cols-3"><NativeSelect aria-label={`反馈 ${index+1} 来源`} value={row.source} onChange={event => set({references:draft.references.map((item,i)=>i===index?{...item,source:event.target.value as QualitySource}:item)})}>{Object.entries(qualitySourceNames).map(([value,label])=><option key={value} value={value}>{label}</option>)}</NativeSelect><Input aria-label={`反馈 ${index+1} 原记录`} placeholder="原单号或记录编号" value={row.reference} onChange={event=>set({references:draft.references.map((item,i)=>i===index?{...item,reference:event.target.value}:item)})}/><Input aria-label={`反馈 ${index+1} 说明`} placeholder="反馈说明" value={row.note} onChange={event=>set({references:draft.references.map((item,i)=>i===index?{...item,note:event.target.value}:item)})}/></div>)}{editable&&<Button variant="outline" size="sm" onClick={()=>set({references:[...draft.references,{source:'warehouse',reference:'',note:''}]})}>关联来源反馈</Button>}</details>
        {editable && <><label className="grid gap-1 text-sm">本次修改或确认依据<Textarea value={reason} onChange={event => { setReason(event.target.value); setDirty(true); }} /></label><div className="flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={() => void save('save')}>保存待分析</Button><Button onClick={() => void save('confirm')}>确认主因与责任</Button></div></>}
      </fieldset>
      {draft.files.length > 0 && <div className="flex flex-wrap gap-2">{draft.files.map(file => <Button key={file.fileId} variant="outline" size="sm" onClick={() => void openFile(file.fileId)}>{file.name}</Button>)}</div>}
      <details className="border-t pt-4"><summary className="cursor-pointer text-sm font-semibold">处置与独立复验 · {loaded.record.status === 'closed' ? '已关闭' : '待闭环'}</summary><p className="my-3 whitespace-pre-wrap text-sm">{loaded.record.resolution || '尚未登记处置结果'}</p>{editable && <div className="space-y-3"><NativeSelect aria-label="质量处置方式" value={disposition} onChange={event => { setDisposition(event.target.value); setDirty(true); }}>{[['pending','待判定'],['return','退货'],['rework','返工'],['scrap','报废'],['concession','让步接收'],['replacement','换货']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</NativeSelect><Textarea aria-label="处置结果" value={resolution} onChange={event => {setResolution(event.target.value);setDirty(true);}}/><p className="text-xs text-muted-foreground">处置内容随上方“保存待分析”或“确认主因与责任”一起保存。</p></div>}<Button className="mt-3" variant="outline" disabled={busy||dirty} onClick={()=>setVerify(true)}>{canVerify?'独立复验 / 重开':'查看验证记录'}</Button><p className="mt-2 text-xs text-muted-foreground">复验继续使用原不良数量与原记录；请先保存当前填写内容。</p></details>
      <details className="border-t pt-4"><summary className="cursor-pointer text-sm font-semibold">原因认定历史 · {draft.history.length} 次</summary>{[...draft.history].reverse().map((row,index)=><div className="border-b py-3 text-sm" key={index}><p>{row.actorName} · {new Date(row.at).toLocaleString()} · {row.action==='confirm'?'确认':'修改'}</p><p>{row.reason}</p><p className="text-xs text-muted-foreground">{qualityCauseNames[row.snapshot.category]} · {row.snapshot.responsibility.name || '责任待定'} · {row.snapshot.phenomena.reduce((sum,item)=>sum+item.count,0)} 次现象</p></div>)}</details>
    </>}
    {discard && <div role="alert" className="rounded-lg border p-3"><p className="text-sm">填写内容尚未保存。</p><div className="mt-2 flex justify-end gap-2"><Button variant="outline" onClick={()=>setDiscard(false)}>继续填写</Button><Button variant="destructive" onClick={onClose}>放弃并关闭</Button></div></div>}
    {loaded && verify && <QualityVerificationDialog record={loaded.record} canVerify={canVerify} onClose={()=>setVerify(false)} onSaved={()=>{setVerify(false);saved();}} />}
    {preview && <AttachmentPreviewDialog attachment={preview} attachments={[preview]} onClose={()=>setPreview(null)} />}
  </DialogContent></Dialog>;
}
