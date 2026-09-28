import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { NativeSelect } from '../../components/ui/native-select';
import { Table, TableHeader, TableBody, TableHead, TableCell, TableRow } from '../../components/ui/table';
import type { QualityRecord } from '../../lib/procurementOperationsApi';
import { QualityAnalysisDialog, qualityCauseNames, qualitySourceNames } from './QualityAnalysisDialog';

export function qualityRecordSummary(records: QualityRecord[]) {
  const unique = [...new Map(records.map(row => [row.id, row])).values()];
  const units = [...new Set(unique.map(row => row.unit))].map(unit => ({ unit, defective: unique.filter(row => row.unit === unit).reduce((sum,row)=>sum+row.defectiveQty,0) }));
  const unknown = unique.filter(row => row.analysis?.state !== 'confirmed' || row.analysis.category === 'unknown').length;
  const phenomena = new Map<string,number>();
  const suppliers = new Map<string,{ material:string; supplier:string; unit:string; inspected:number; defective:number }>();
  for(const row of unique.filter(item=>item.source==='procurement'&&item.materialId&&item.supplierId)) {
    const key=JSON.stringify([row.materialId,row.supplierId,row.unit]);
    const item=suppliers.get(key)||{material:row.materialName||row.materialId!,supplier:row.supplierName||row.supplierId!,unit:row.unit,inspected:0,defective:0};
    item.inspected+=row.inspectedQty;item.defective+=row.defectiveQty;suppliers.set(key,item);
  }
  for(const row of unique)for(const item of row.analysis?.phenomena || [])phenomena.set(item.name,(phenomena.get(item.name)||0)+item.count);
  return { records:unique, units, unknown, suppliers:[...suppliers.values()], occurrences:[...phenomena.values()].reduce((sum,value)=>sum+value,0), top:[...phenomena].sort((a,b)=>b[1]-a[1]).slice(0,10) };
}
export function QualityRecordsPanel({ records, onSaved }: { records: QualityRecord[]; onSaved: () => void }) {
  const [params,setParams] = useSearchParams();
  const [source,setSource]=useState('all'),[status,setStatus]=useState('all'),[cause,setCause]=useState('all'),[query,setQuery]=useState(''),[page,setPage]=useState(1),[selected,setSelected]=useState<string|null>(null);
  const base=qualityRecordSummary(records).records.filter(row=>(source==='all'||row.source===source)&&(status==='all'||(status==='closed'?row.status==='closed':row.status!=='closed'))&&[row.issue,row.batchNo,row.materialName,row.supplierName,row.taskCode,row.treeNodeName].some(value=>value?.toLowerCase().includes(query.trim().toLowerCase())));
  const linkedId = params.get('quality');
  const selectedId = linkedId && records.some(row => row.id === linkedId) ? linkedId : selected;
  const close = () => { setSelected(null); if (linkedId) setParams(previous => { const next = new URLSearchParams(previous); next.delete('quality'); return next; }, { replace: true }); };
  const summary=qualityRecordSummary(base);
  const rows=base.filter(row=>cause==='all'||(cause==='unknown'?(row.analysis?.state!=='confirmed'||row.analysis.category==='unknown'):row.analysis?.state==='confirmed'&&row.analysis.category===cause));
  const pages=Math.max(1,Math.ceil(rows.length/10)),current=Math.min(page,pages),visible=rows.slice((current-1)*10,current*10);
  const filter=(setter:(value:string)=>void,value:string)=>{setter(value);setPage(1);};
  return <section className="space-y-4">
    <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-xl bg-muted/50 p-4 text-sm"><span>原异常 <strong>{summary.records.length}</strong> 条</span><span>不良 {summary.units.map(row=>`${row.defective.toLocaleString()} ${row.unit}`).join(' / ')||'0'}</span><span>现象 <strong>{summary.occurrences}</strong> 次</span><span>原因未知 / 待确认 <strong>{summary.unknown}</strong> 条</span></div>
    <div className="flex flex-wrap gap-2"><Input className="min-w-48 flex-1" aria-label="搜索质量异常" placeholder="搜索批次、物料、供应商或现象" value={query} onChange={event=>filter(setQuery,event.target.value)}/><NativeSelect className="w-auto" aria-label="质量来源" value={source} onChange={event=>filter(setSource,event.target.value)}><option value="all">全部来源</option>{Object.entries(qualitySourceNames).map(([value,label])=><option key={value} value={value}>{label}</option>)}</NativeSelect><NativeSelect className="w-auto" aria-label="质量状态" value={status} onChange={event=>filter(setStatus,event.target.value)}><option value="all">全部状态</option><option value="open">待闭环</option><option value="closed">已关闭</option></NativeSelect><NativeSelect className="w-auto" aria-label="质量主因" value={cause} onChange={event=>filter(setCause,event.target.value)}><option value="all">全部主因</option>{Object.entries(qualityCauseNames).map(([value,label])=><option key={value} value={value}>{label}</option>)}</NativeSelect></div>
    <p className="text-xs text-muted-foreground">按原异常编号去重。每件可出现多个现象；跨来源反馈不重复累计不良件数。主因未授权确认时计入未知。</p>
    {!rows.length?<p className="py-10 text-center text-sm text-muted-foreground">当前条件下没有质量异常。</p>:<Table className="min-w-[780px]"><TableHeader><TableRow>{['日期 / 来源','原异常 / 批次','不良件数','现象次数','主因 / 责任认定','状态','操作'].map(label=><TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>{visible.map(row=><TableRow key={row.id}><TableCell>{row.inspectionDate}<p className="text-xs text-muted-foreground">{qualitySourceNames[row.source]}</p></TableCell><TableCell className="max-w-80"><Button variant="link" className="h-auto justify-start whitespace-normal p-0 text-left font-medium" onClick={()=>setSelected(row.id)}>{row.issue}</Button><p className="text-xs text-muted-foreground">{row.batchNo} · {row.treeNodeName}</p></TableCell><TableCell>{row.defectiveQty} {row.unit}</TableCell><TableCell>{row.analysis?.phenomena.reduce((sum,item)=>sum+item.count,0)??'待补'}</TableCell><TableCell>{row.analysis?.state==='confirmed'?qualityCauseNames[row.analysis.category]:'未知 / 待确认'}<p className="text-xs text-muted-foreground">{row.analysis?.state==='confirmed'?row.analysis.responsibility.name:'责任待认定'}</p></TableCell><TableCell>{row.status==='closed'?'已关闭':row.status==='processing'?'处理中':'待处理'}</TableCell><TableCell><Button variant="outline" size="sm" onClick={()=>setSelected(row.id)}>查看与处理</Button></TableCell></TableRow>)}</TableBody></Table>}
    <div className="flex items-center justify-between text-xs text-muted-foreground"><span>{rows.length} 条 · 第 {current} / {pages} 页</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={current===1} onClick={()=>setPage(current-1)}>上一页</Button><Button size="sm" variant="outline" disabled={current===pages} onClick={()=>setPage(current+1)}>下一页</Button></div></div>
    {summary.top.length>0&&<details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">当前范围高频现象 · Top 10</summary><ol className="mt-3 grid gap-2 text-sm sm:grid-cols-2">{summary.top.map(([name,count])=><li className="flex justify-between gap-4" key={name}><span>{name}</span><span className="tabular-nums text-muted-foreground">{count} 次</span></li>)}</ol></details>}
    {summary.suppliers.length>0&&<details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">同物料供应商记录比较</summary><p className="my-3 text-xs text-muted-foreground">按实际物料 ID 和单位分组，仅比较当前范围已登记检验批次，不代表供应商全部交付合格率。缺少物料或供应商的记录不猜测归属。</p><Table><TableHeader><TableRow>{['物料','供应商','不良 / 检验','记录不良率'].map(label=><TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>{summary.suppliers.map((row,index)=><TableRow key={index}><TableCell>{row.material}</TableCell><TableCell>{row.supplier}</TableCell><TableCell>{row.defective} / {row.inspected} {row.unit}</TableCell><TableCell>{row.inspected>0?`${(row.defective/row.inspected*100).toFixed(1)}%`:'—'}</TableCell></TableRow>)}</TableBody></Table></details>}
    {linkedId && !records.some(row => row.id === linkedId) && <p role="alert" className="text-sm text-muted-foreground">所选质量异常不存在或不在当前授权范围。</p>}
    {selectedId&&<QualityAnalysisDialog id={selectedId} onClose={close} onSaved={onSaved}/>}
  </section>;
}
