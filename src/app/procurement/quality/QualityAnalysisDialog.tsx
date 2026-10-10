import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../../components/ui/alert-dialog';
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
import '../../production/execution/production-theme.css';
import './quality-prototype.css';
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
  return <><Dialog open onOpenChange={open => { if (!open) close(); }}><DialogContent closeDisabled={busy} className="production-ui-theme quality-detail flex! max-h-[92dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1280px]" onInteractOutside={event => event.preventDefault()} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}>
    <DialogHeader className="quality-detail-header"><DialogTitle>质量异常处置详情</DialogTitle><DialogDescription>{loaded ? `${qualitySourceNames[loaded.record.source]} · ${loaded.record.batchNo} · 原异常 ${id}` : '沿原异常查看原因、责任、处置与复验。'}</DialogDescription></DialogHeader>
    <div className="quality-detail-body">
    {error && <p role="alert" className="rounded-lg bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
    {loading ? <p role="status">正在读取质量记录…</p> : !loaded || !draft ? <Button variant="outline" onClick={() => setReload(value => value + 1)}>重新加载</Button> : <>
      <section className="quality-identity" aria-label="原异常信息">
        <div className="quality-identity-title"><h3>{loaded.record.issue}</h3><span className="quality-status" data-closed={loaded.record.status==='closed'}>{loaded.record.status==='closed'?'已关闭':loaded.record.status==='processing'?'处理中':'待处理'}</span></div>
        <dl><div><dt>物料 / 工序</dt><dd>{loaded.record.materialName || loaded.record.treeNodeName || '未登记'}</dd></div><div><dt>供应商</dt><dd>{loaded.record.supplierName || '未关联'}</dd></div><div><dt>登记人</dt><dd>{loaded.record.createdByName || '未登记'}</dd></div><div><dt>检验日期</dt><dd>{loaded.record.inspectionDate}</dd></div><div><dt>当前经办</dt><dd>{loaded.record.collaboration?.ownerName || '未分派'}</dd></div><div><dt>办理期限</dt><dd>{loaded.record.collaboration?.dueDate || '未设定'}</dd></div></dl>
        {loaded.record.collaboration && <p className="quality-identity-note">{loaded.record.collaboration.department && <span>协同部门：{loaded.record.collaboration.department}</span>}{loaded.record.collaboration.priority && <span>优先级：{{high:'高',medium:'中',low:'低'}[loaded.record.collaboration.priority]}</span>}<span>发起人：{loaded.record.collaboration.originatorName}</span></p>}
      </section>
      <div className="quality-detail-columns">
        <section className="quality-detail-card" aria-label="现象与实际证据">
          <div className="quality-detail-card-heading"><span>01</span><h3>现象与实际证据</h3></div>
          <div className="quality-evidence-metrics"><div><span>样本检验量</span><strong>{loaded.record.inspectedQty.toLocaleString()} {loaded.record.unit}</strong></div><div><span>唯一不良数量</span><strong>{loaded.record.defectiveQty.toLocaleString()} {loaded.record.unit}</strong></div><div><span>现象发生次数</span><strong>{draft.phenomena.reduce((sum,row)=>sum+row.count,0).toLocaleString()} 次</strong></div></div>
          <p className="quality-help">同件多现象可重复记录，现象次数不加到不良数量。</p>
          <fieldset disabled={busy || !editable} className="quality-fields">
            {draft.phenomena.map((row,index)=><div className="quality-phenomenon-row" key={index}><Input aria-label={`现象 ${index+1}`} value={row.name} onChange={event=>set({phenomena:draft.phenomena.map((item,i)=>i===index?{...item,name:event.target.value}:item)})}/><Input type="number" min="1" step="1" aria-label={`现象 ${index+1} 发生次数`} value={row.count} onChange={event=>set({phenomena:draft.phenomena.map((item,i)=>i===index?{...item,count:Number(event.target.value)}:item)})}/>{editable&&<Button size="sm" variant="ghost" aria-label={`移除现象 ${index+1}`} onClick={()=>set({phenomena:draft.phenomena.filter((_,i)=>i!==index)})}>移除</Button>}</div>)}
            {editable&&<Button className="justify-self-start" variant="outline" size="sm" onClick={()=>set({phenomena:[...draft.phenomena,{name:'',count:1}]})}>添加现象</Button>}
            <label>证据与分析依据<Textarea rows={4} value={draft.evidence} onChange={event=>set({evidence:event.target.value})}/></label>
            {editable&&<label>上传照片、视频或附件<Input type="file" multiple onChange={event=>{void uploadFiles(event.target.files);event.target.value='';}}/><span className="quality-help">最多 20 个附件，保存后可打开预览。</span></label>}
            {loaded.productionSource?.fieldIssueId&&<details className="quality-inset"><summary>现场实领批次 · 缺码可待补</summary>{(draft.materialBatches??[]).map((row,index)=><label className="mt-3" key={index}>{row.code}<NativeSelect value={row.batchNo||''} onChange={event=>set({materialBatches:draft.materialBatches!.map((item,i)=>i===index?{...item,batchNo:event.target.value||null}:item)})}><option value="">批号待补</option>{loaded.receivedBatches.find(item=>item.code===row.code)?.batches.map(batch=><option key={batch.batchNo} value={batch.batchNo}>{batch.batchNo}</option>)}</NativeSelect></label>)}{!draft.materialBatches?.length&&<p className="quality-help">现场尚未记录物料批次。</p>}<p className="quality-help">只可选择原作业已签收批次，修改保留历史。</p></details>}
          </fieldset>
          <div className="quality-attachments"><h4>证据附件 <span>{draft.files.length} 个</span></h4>{draft.files.length>0?draft.files.map(file=><Button key={file.fileId} variant="outline" size="sm" onClick={()=>void openFile(file.fileId)}>{file.name}</Button>):<p className="quality-help">尚未上传证据附件。</p>}</div>
        </section>
        <section className="quality-detail-card" aria-label="主因与责任认定">
          <div className="quality-detail-card-heading"><span>02</span><h3>主因与责任认定</h3></div>
          <div className="quality-cause-state" data-confirmed={draft.state==='confirmed'}><strong>{draft.state==='confirmed'?'已授权确认':'待分析 / 确认'}</strong><p>{draft.state==='confirmed'?`${qualityCauseNames[draft.category]} · ${draft.confirmedByName || '质量授权人员'}`:'原因暂不明确时可保存待分析，不必猜测根因。'}</p></div>
          <fieldset disabled={busy || !editable} className="quality-fields">
            <label>主因类别<NativeSelect value={draft.category} onChange={event=>set({category:event.target.value as QualityAnalysis['category']})}>{Object.entries(qualityCauseNames).map(([value,label])=><option key={value} value={value}>{label}</option>)}</NativeSelect></label>
            <label>原因说明<Textarea rows={4} value={draft.detail} onChange={event=>set({detail:event.target.value})}/></label>
            <label>责任类型<NativeSelect value={draft.responsibility.kind} onChange={event=>set({responsibility:{kind:event.target.value as QualityAnalysis['responsibility']['kind'],name:''}})}>{[['unknown','待认定'],['internal','内部责任人'],['supplier','供应商'],['other','其他主体']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</NativeSelect></label>
            {['internal','supplier'].includes(draft.responsibility.kind)&&<label>责任主体<NativeSelect value={draft.responsibility.id||''} onChange={event=>set({responsibility:{...draft.responsibility,id:event.target.value}})}><option value="">请选择</option>{(draft.responsibility.kind==='internal'?loaded.people:loaded.suppliers).map(row=><option key={row.id} value={row.id}>{row.name} · {row.id}</option>)}</NativeSelect>{!editable&&<span>{draft.responsibility.name}</span>}</label>}
            {draft.responsibility.kind==='other'&&<label>责任主体<Input value={draft.responsibility.name} onChange={event=>set({responsibility:{...draft.responsibility,name:event.target.value}})}/></label>}
            <p className="quality-help">协同经办只负责处理流转；责任主体由质量授权人员按依据独立认定。</p>
            {editable&&<label>本次修改或确认依据<Textarea rows={3} value={reason} onChange={event=>{setReason(event.target.value);setDirty(true);}}/></label>}
            <details className="quality-inset"><summary>跨来源反馈 · {draft.references.length} 条</summary><p className="quality-help">引用同一异常，不再次累加不良数量。</p>{draft.references.map((row,index)=><div key={index} className="quality-reference"><NativeSelect aria-label={`反馈 ${index+1} 来源`} value={row.source} onChange={event=>set({references:draft.references.map((item,i)=>i===index?{...item,source:event.target.value as QualitySource}:item)})}>{Object.entries(qualitySourceNames).map(([value,label])=><option key={value} value={value}>{label}</option>)}</NativeSelect><Input aria-label={`反馈 ${index+1} 原记录`} placeholder="原单号或记录编号" value={row.reference} onChange={event=>set({references:draft.references.map((item,i)=>i===index?{...item,reference:event.target.value}:item)})}/><Input aria-label={`反馈 ${index+1} 说明`} placeholder="反馈说明" value={row.note} onChange={event=>set({references:draft.references.map((item,i)=>i===index?{...item,note:event.target.value}:item)})}/></div>)}{editable&&<Button variant="outline" size="sm" onClick={()=>set({references:[...draft.references,{source:'warehouse',reference:'',note:''}]})}>关联来源反馈</Button>}</details>
          </fieldset>
        </section>
        <section className="quality-detail-card" aria-label="处置与独立复验">
          <div className="quality-detail-card-heading"><span>03</span><h3>处置与独立复验</h3></div>
          <p className="quality-help">处置状态：{loaded.record.status==='closed'?'已关闭':'待闭环'}</p>
          {editable?<div className="quality-fields"><label>处置方式<NativeSelect disabled={busy} aria-label="质量处置方式" value={disposition} onChange={event=>{setDisposition(event.target.value);setDirty(true);}}>{[['pending','待判定'],['return','退货'],['rework','返工'],['scrap','报废'],['concession','让步接收'],['replacement','换货']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</NativeSelect></label><label>处置结果<Textarea rows={4} disabled={busy} aria-label="处置结果" value={resolution} onChange={event=>{setResolution(event.target.value);setDirty(true);}}/></label><p className="quality-help">随底部保存操作一起保存。仅更新处置保留已确认主因；修改分析内容后需重新确认。</p></div>:<p className="quality-resolution">{loaded.record.resolution||'尚未登记处置结果'}</p>}
          <div className="quality-verification"><Button variant="outline" disabled={busy||dirty||(canVerify&&loaded.record.status!=='closed'&&(disposition==='pending'||!resolution.trim()))} onClick={()=>setVerify(true)}>{canVerify?loaded.record.status==='closed'?'重新打开':'独立复验':'查看验证记录'}</Button><p className="quality-help">{dirty?'请先保存当前填写内容，再进行复验。':loaded.record.status==='closed'?'异常已关闭，可查看复验记录。':disposition==='pending'||!resolution.trim()?'填写并保存处置方式与结果后，可发起独立复验。':'复验沿用原不良数量，全部通过后才关闭异常。'}</p></div>
          {loaded.record.collaboration&&<section className="quality-collaboration"><h4>原异常协同</h4><p>当前经办：{loaded.record.collaboration.ownerName}</p><p>待补资料：{loaded.record.collaboration.requiredInfo||'待确认'}</p><p>验证安排：{loaded.record.collaboration.verificationPlan||'待确认'}</p>{loaded.record.collaboration.reply&&<p className="whitespace-pre-wrap">回复：{loaded.record.collaboration.reply}</p>}{canCollaborate&&loaded.record.collaboration.phase==='waiting_reply'&&loaded.record.collaboration.ownerId===user?.id&&<><Textarea aria-label="回复原质量异常" disabled={busy} value={reply} onChange={event=>{setReply(event.target.value);setDirty(true);}}/><Button disabled={busy||!reply.trim()} onClick={()=>void replyOriginal()}>回复原异常</Button></>}</section>}
        </section>
      </div>
      <section className="quality-history" aria-label="原因认定历史"><h3>原因认定历史 <span>{draft.history.length} 次</span></h3>{draft.history.length>0?<ol>{[...draft.history].reverse().map((row,index)=><li key={index}><div><strong>{row.actorName}</strong><span>{row.action==='confirm'?'确认':'修改'} · {new Date(row.at).toLocaleString()}</span></div><p>{row.reason}</p><p className="quality-help">{qualityCauseNames[row.snapshot.category]} · {row.snapshot.responsibility.name||'责任待定'} · {row.snapshot.phenomena.reduce((sum,item)=>sum+item.count,0)} 次现象</p></li>)}</ol>:<p className="quality-help">尚无原因认定记录。</p>}</section>
    </>}
    </div>
    {loaded&&draft&&!loading&&<div className="quality-detail-footer"><p>{dirty?'有未保存内容':'原因、证据与处置沿原异常留痕'}</p><div><Button variant="outline" disabled={busy} onClick={close}>关闭</Button>{editable&&<><Button variant="outline" disabled={busy||!dirty} onClick={()=>void save('save')}>{busy?'保存中…':draft.state==='confirmed'?'保存处置与补充信息':'保存待分析'}</Button><Button disabled={busy||!dirty} onClick={()=>void save('confirm')}>确认主因与责任</Button></>}</div></div>}
    {loaded && verify && <QualityVerificationDialog record={loaded.record} canVerify={canVerify} onClose={()=>setVerify(false)} onSaved={()=>{setVerify(false);saved();}} />}
    {preview && <AttachmentPreviewDialog attachment={preview} attachments={[preview]} onClose={()=>setPreview(null)} />}
  </DialogContent></Dialog><AlertDialog open={discard} onOpenChange={setDiscard}><AlertDialogContent className="production-ui-theme"><AlertDialogHeader><AlertDialogTitle>放弃未保存的内容？</AlertDialogTitle><AlertDialogDescription>填写内容尚未保存，关闭后将丢失。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>继续填写</AlertDialogCancel><AlertDialogAction onClick={onClose}>放弃并关闭</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></>;
}
