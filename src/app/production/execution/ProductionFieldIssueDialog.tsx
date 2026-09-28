import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { NativeSelect } from '../../components/ui/native-select';
import { commandExecutionPlan, type ExecutionPlan, type ExecutionTask } from '../../lib/productionExecutionApi';
import { getWarehouseFlows, type WarehouseIssue } from '../../lib/warehouseFlowApi';
import { uploadResourceFile } from '../../lib/resourceUpload';

export function ProductionFieldIssueDialog({ task, plan, onClose, onSaved }: { task: ExecutionTask; plan: ExecutionPlan; onClose: () => void; onSaved: () => void }) {
  const reports = task.reports.filter(row => row.quantity > row.goodQty && !task.fieldIssues?.some(item => item.reportId === row.id) && !task.inspections.some(item => item.reportId === row.id && item.qualityId));
  const [reportId, setReportId] = useState(reports[0]?.id || ''), [issue,setIssue] = useState(''), [evidence,setEvidence] = useState('');
  const [phenomena,setPhenomena] = useState([{name:'',count:1}]), [files,setFiles] = useState<{fileId:string;name:string}[]>([]);
  const [lines,setLines] = useState<WarehouseIssue['lines']>([]), [selected,setSelected] = useState<Record<string,string>>({});
  const [loading,setLoading] = useState(true), [error,setError] = useState(''), [busy,setBusy] = useState(false), [dirty,setDirty] = useState(false), [discard,setDiscard] = useState(false), [reload,setReload] = useState(0);
  const mounted=useRef(true), lock=useRef(false), upload=useRef<AbortController|null>(null), request=useRef<{signature:string;id:string}|null>(null);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;upload.current?.abort();};},[]);
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError('');
    getWarehouseFlows(task.id,'all',controller.signal).then(result=>{if(!controller.signal.aborted)setLines(result.items.find(row=>row.taskId===task.id)?.lines.filter(row=>(row.signedQty||0)>0)||[]);})
      .catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'实领物料读取失败');})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[task.id,reload]);
  const report=reports.find(row=>row.id===reportId),defective=report?Number((report.quantity-report.goodQty).toFixed(3)):0;
  const change=(callback:()=>void)=>{callback();setDirty(true);};
  const close=()=>{if(lock.current)return;if(dirty)setDiscard(true);else onClose();};
  async function uploadFiles(local:FileList|null){
    if(!local?.length||lock.current)return;
    if(local.length+files.length>20){setError('最多上传 20 个证据附件');return;}
    lock.current=true;setBusy(true);setError('');upload.current=new AbortController();
    try{for(const file of Array.from(local)){const saved=await uploadResourceFile(file,'assets',{signal:upload.current.signal});if(mounted.current){setFiles(old=>[...old,{fileId:saved.fileId,name:saved.fileName}]);setDirty(true);}}}
    catch(cause){if(mounted.current)setError(cause instanceof Error?cause.message:'上传失败');}
    finally{lock.current=false;if(mounted.current)setBusy(false);}
  }
  async function save(){
    if(lock.current||!report)return;
    if(!issue.trim()||!evidence.trim()||phenomena.some(row=>!row.name.trim()||!Number.isSafeInteger(row.count)||row.count<1)){setError('请填写现场现象、次数及证据说明');return;}
    const data={taskId:task.id,reportId,defectiveQty:defective,issue,reason:evidence,phenomena,fileIds:files.map(row=>row.fileId),materialBatches:lines.map(row=>({code:row.code,batchNo:selected[row.code]||null}))};
    const signature=JSON.stringify([plan.version,data]);if(request.current?.signature!==signature)request.current={signature,id:crypto.randomUUID()};
    lock.current=true;setBusy(true);setError('');
    try{await commandExecutionPlan(plan.id,{action:'field-issue',version:plan.version,requestId:request.current.id,data});if(mounted.current)onSaved();}
    catch(cause){if(mounted.current)setError(cause instanceof Error?cause.message:'提交失败，草稿已保留');}
    finally{lock.current=false;if(mounted.current)setBusy(false);}
  }
  return <Dialog open onOpenChange={open=>{if(!open)close();}}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl" onInteractOutside={event=>event.preventDefault()} onEscapeKeyDown={event=>{if(busy)event.preventDefault();}}><DialogHeader><DialogTitle>登记现场不良</DialogTitle><DialogDescription>{task.name} · {task.line} · 同次报工沿用一个原异常编号</DialogDescription></DialogHeader>
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
    {loading?<p role="status">读取实领物料…</p>:!reports.length?<p className="text-sm text-muted-foreground">没有尚未关联异常的不良报工；请在原异常补充现象和证据。</p>:<fieldset disabled={busy} className="space-y-4">
      <label className="grid gap-1 text-sm">对应报工<NativeSelect value={reportId} onChange={event=>change(()=>setReportId(event.target.value))}>{reports.map(row=><option key={row.id} value={row.id}>{row.date} · {row.quantity} {task.unit} · 不良 {Number((row.quantity-row.goodQty).toFixed(3))}</option>)}</NativeSelect></label>
      <div className="rounded-lg bg-muted/50 p-3 text-sm">本次唯一不良 <strong>{defective} {task.unit}</strong>；同件多现象分别填写次数，质检继续使用原异常。</div>
      <label className="grid gap-1 text-sm">不良摘要<Input maxLength={2000} value={issue} onChange={event=>change(()=>setIssue(event.target.value))}/></label>
      {phenomena.map((row,index)=><div className="flex gap-2" key={index}><Input aria-label={`现场现象 ${index+1}`} placeholder="现象名称" value={row.name} onChange={event=>change(()=>setPhenomena(old=>old.map((item,i)=>i===index?{...item,name:event.target.value}:item)))}/><Input className="w-28" type="number" min="1" step="1" aria-label={`现场现象 ${index+1} 次数`} value={row.count} onChange={event=>change(()=>setPhenomena(old=>old.map((item,i)=>i===index?{...item,count:Number(event.target.value)}:item)))}/></div>)}
      <Button variant="outline" size="sm" onClick={()=>change(()=>setPhenomena(old=>[...old,{name:'',count:1}]))}>添加现象</Button>
      <label className="grid gap-1 text-sm">现场证据说明<Textarea rows={3} value={evidence} onChange={event=>change(()=>setEvidence(event.target.value))}/></label>
      <label className="grid gap-1 text-sm">现场照片或附件<Input type="file" multiple onChange={event=>{void uploadFiles(event.target.files);event.target.value='';}}/></label>
      {files.map(file=><p className="text-xs text-muted-foreground" key={file.fileId}>{file.name} · 已上传，随记录保存</p>)}
      <details className="rounded-lg border p-3" open><summary className="cursor-pointer text-sm font-medium">实际领用物料批次</summary><p className="my-2 text-xs text-muted-foreground">选项来自本作业已签收物料；未查清批号时标记待补，不使用生产批次替代。</p>{lines.map(row=><label className="my-2 grid gap-1 text-sm" key={row.code}>{row.name} · {row.code} · 已签收 {row.signedQty} {row.unit}<NativeSelect value={selected[row.code]||''} onChange={event=>change(()=>setSelected(old=>({...old,[row.code]:event.target.value})))}><option value="">批号待补</option>{row.signedBatches?.map(batch=><option key={batch.batchNo} value={batch.batchNo}>{batch.batchNo} · {batch.quantity} {row.unit}</option>)}</NativeSelect></label>)}{!lines.length&&<p className="text-sm text-muted-foreground">暂无已签收物料，批次信息待补。</p>}</details>
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={()=>setReload(value=>value+1)}>刷新实领批次</Button><Button onClick={()=>void save()} disabled={!!error&&lines.length===0}>提交原异常</Button></div>
    </fieldset>}
    {discard&&<div role="alert" className="rounded-lg border p-3"><p>现场记录尚未保存。</p><div className="mt-2 flex justify-end gap-2"><Button variant="outline" onClick={()=>setDiscard(false)}>继续填写</Button><Button variant="destructive" onClick={onClose}>放弃并关闭</Button></div></div>}
  </DialogContent></Dialog>;
}
