import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { NativeSelect } from '../../components/ui/native-select';
import { Table, TableHeader, TableBody, TableHead, TableCell, TableRow } from '../../components/ui/table';
import type { QualityRecord } from '../../lib/procurementOperationsApi';
import { QualityAnalysisDialog, qualityCauseNames, qualitySourceNames } from './QualityAnalysisDialog';
import '../../production/execution/production-theme.css';
import './quality-prototype.css';

export function qualityRecordSummary(records: QualityRecord[]) {
  const unique = [...new Map(records.map(row => [row.id, row])).values()];
  const units = [...new Set(unique.map(row => row.unit))].map(unit => {
    const samples = unique.filter(row => row.unit === unit);
    return { unit, inspected: samples.reduce((sum,row)=>sum+row.inspectedQty,0), defective: samples.reduce((sum,row)=>sum+row.defectiveQty,0) };
  });
  const unknown = unique.filter(row => row.analysis?.state !== 'confirmed' || row.analysis.category === 'unknown').length;
  const phenomena = new Map<string,number>();
  const suppliers = new Map<string,{ materialId:string; supplierId:string; material:string; supplier:string; unit:string; inspected:number; defective:number }>();
  const causes = new Map<string,{ category:keyof typeof qualityCauseNames; unit:string; defective:number; records:number }>();
  for(const row of unique.filter(item=>item.source==='procurement'&&item.materialId&&item.supplierId)) {
    const key=JSON.stringify([row.materialId,row.supplierId,row.unit]);
    const item=suppliers.get(key)||{materialId:row.materialId!,supplierId:row.supplierId!,material:row.materialName||row.materialId!,supplier:row.supplierName||row.supplierId!,unit:row.unit,inspected:0,defective:0};
    item.inspected+=row.inspectedQty;item.defective+=row.defectiveQty;suppliers.set(key,item);
  }
  for(const row of unique) {
    for(const item of row.analysis?.phenomena || [])phenomena.set(item.name,(phenomena.get(item.name)||0)+item.count);
    const category=row.analysis?.state==='confirmed'?row.analysis.category:'unknown';
    const key=JSON.stringify([category,row.unit]);
    const item=causes.get(key)||{category,unit:row.unit,defective:0,records:0};
    item.defective+=row.defectiveQty;item.records+=1;causes.set(key,item);
  }
  return { records:unique, units, unknown, causes:[...causes.values()], suppliers:[...suppliers.values()], occurrences:[...phenomena.values()].reduce((sum,value)=>sum+value,0), top:[...phenomena].sort((a,b)=>b[1]-a[1]).slice(0,10) };
}
export function QualityRecordsPanel({ records, onSaved }: { records: QualityRecord[]; onSaved: () => void }) {
  const [params,setParams] = useSearchParams();
  const [source,setSource]=useState('all'),[status,setStatus]=useState('all'),[cause,setCause]=useState('all'),[query,setQuery]=useState(''),[page,setPage]=useState(1),[selected,setSelected]=useState<string|null>(null);
  const [unit,setUnit]=useState(''),[material,setMaterial]=useState('');
  const base=qualityRecordSummary(records).records.filter(row=>(source==='all'||row.source===source)&&(status==='all'||(status==='closed'?row.status==='closed':row.status!=='closed'))&&[row.issue,row.batchNo,row.materialName,row.supplierName,row.taskCode,row.treeNodeName].some(value=>value?.toLowerCase().includes(query.trim().toLowerCase())));
  const linkedId = params.get('quality');
  const selectedId = linkedId && records.some(row => row.id === linkedId) ? linkedId : selected;
  const close = () => { setSelected(null); if (linkedId) setParams(previous => { const next = new URLSearchParams(previous); next.delete('quality'); return next; }, { replace: true }); };
  const rows=base.filter(row=>cause==='all'||(cause==='unknown'?(row.analysis?.state!=='confirmed'||row.analysis.category==='unknown'):row.analysis?.state==='confirmed'&&row.analysis.category===cause));
  const summary=qualityRecordSummary(rows);
  const chartUnit=summary.units.some(row=>row.unit===unit)?unit:summary.units[0]?.unit;
  const causeRows=summary.causes.filter(row=>row.unit===chartUnit).sort((a,b)=>b.defective-a.defective);
  const causeMax=Math.max(1,...causeRows.map(row=>row.defective));
  const materials=[...new Map(summary.suppliers.map(row=>[JSON.stringify([row.materialId,row.unit]),row])).entries()];
  const materialKey=materials.some(([key])=>key===material)?material:materials[0]?.[0];
  const supplierRows=summary.suppliers.filter(row=>JSON.stringify([row.materialId,row.unit])===materialKey).sort((a,b)=>b.defective-a.defective);
  const pages=Math.max(1,Math.ceil(rows.length/10)),current=Math.min(page,pages),visible=rows.slice((current-1)*10,current*10);
  const filter=(setter:(value:string)=>void,value:string)=>{setter(value);setPage(1);};
  return <section className="production-ui-theme quality-prototype">
    <div className="quality-filters"><Input aria-label="搜索质量异常" placeholder="搜索批次、物料、供应商或现象" value={query} onChange={event=>filter(setQuery,event.target.value)}/><NativeSelect aria-label="质量来源" value={source} onChange={event=>filter(setSource,event.target.value)}><option value="all">全部来源</option>{Object.entries(qualitySourceNames).map(([value,label])=><option key={value} value={value}>{label}</option>)}</NativeSelect><NativeSelect aria-label="质量状态" value={status} onChange={event=>filter(setStatus,event.target.value)}><option value="all">全部状态</option><option value="open">待闭环</option><option value="closed">已关闭</option></NativeSelect><NativeSelect aria-label="质量主因" value={cause} onChange={event=>filter(setCause,event.target.value)}><option value="all">全部主因</option>{Object.entries(qualityCauseNames).map(([value,label])=><option key={value} value={value}>{label}</option>)}</NativeSelect></div>
    <div className="quality-metrics">
      <article className="quality-metric"><p>登记样本检验量</p><div>{summary.units.length?summary.units.map(row=><strong key={row.unit}>{row.inspected.toLocaleString()} <small>{row.unit}</small></strong>):<strong>—</strong>}</div><span>原异常 <b>{summary.records.length}</b> 条 · 按原编号去重</span></article>
      <article className="quality-metric quality-metric-defects"><p>不良数量</p><div>{summary.units.length?summary.units.map(row=><strong key={row.unit}>{row.defective.toLocaleString()} <small>{row.unit}</small></strong>):<strong>—</strong>}</div><span>现象 {summary.occurrences.toLocaleString()} 次，另行记录</span></article>
      <article className="quality-metric"><p>登记异常样本不良率</p><div>{summary.units.length?summary.units.map(row=><strong key={row.unit}><small>{row.unit}样本：</small>{row.inspected>0?`${(row.defective/row.inspected*100).toFixed(1)}%`:'—'}</strong>):<strong>—</strong>}</div><span>不良数量 ÷ 当前登记样本检验量</span></article>
      <article className="quality-metric quality-metric-unknown"><p>主因未知 / 待确认</p><div><strong>{summary.unknown.toLocaleString()} <small>条异常</small></strong></div><span>未授权确认的原因单独统计</span></article>
    </div>
    <p className="quality-scope-note">仅统计当前筛选下已登记的异常样本，不代表全部来料质量率。不同单位分别计算；一件可有多个现象，现象次数不计入不良数量。</p>
    <div className="quality-analytics">
      <section className="quality-card" aria-label="不良主因分布">
        <div className="quality-card-heading"><div><h3>不良主因分布</h3><p>每条原异常只归入一个主因</p></div>{summary.units.length>0&&<NativeSelect aria-label="主因分布单位" value={chartUnit} onChange={event=>setUnit(event.target.value)}>{summary.units.map(row=><option key={row.unit} value={row.unit}>{row.unit}</option>)}</NativeSelect>}</div>
        {causeRows.length>0?<ol className="quality-cause-list">{causeRows.map(row=><li key={row.category} className={row.category==='unknown'?'quality-cause-unknown':undefined}><div><span>{qualityCauseNames[row.category]}</span><strong>{row.defective.toLocaleString()} {row.unit}<small> · {row.records} 条</small></strong></div><progress aria-label={`${qualityCauseNames[row.category]}不良数量（${row.unit}）`} max={causeMax} value={row.defective}/></li>)}</ol>:<p className="quality-empty">当前筛选下没有可统计的异常。</p>}
        {summary.top.length>0&&<div className="quality-phenomena"><p>高频现象 <span>同件可重复</span></p><div>{summary.top.slice(0,5).map(([name,count])=><span key={name}>{name}<b>{count} 次</b></span>)}</div>{summary.top.length>5&&<details><summary>其余 {summary.top.length-5} 项现象</summary>{summary.top.slice(5).map(([name,count])=><p key={name}>{name} · {count} 次</p>)}</details>}</div>}
      </section>
      <section className="quality-card" aria-label="同物料供应商比较">
        <div className="quality-card-heading"><div><h3>同物料供应商比较</h3><p>采购来源 · 同物料、同单位</p></div></div>
        {materials.length>0?<><NativeSelect className="quality-material-select" aria-label="供应商比较物料" value={materialKey} onChange={event=>setMaterial(event.target.value)}>{materials.map(([key,row])=><option key={key} value={key}>{row.material} · {row.materialId} · {row.unit}</option>)}</NativeSelect><Table><TableHeader><TableRow>{['供应商','样本检验量','不良数量','样本不良率'].map(label=><TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>{supplierRows.map(row=><TableRow key={row.supplierId}><TableCell><strong className="font-medium">{row.supplier}</strong><p className="text-xs text-muted-foreground">{row.supplierId}</p></TableCell><TableCell>{row.inspected.toLocaleString()} {row.unit}</TableCell><TableCell>{row.defective.toLocaleString()} {row.unit}</TableCell><TableCell>{row.inspected>0?`${(row.defective/row.inspected*100).toFixed(1)}%`:'—'}</TableCell></TableRow>)}</TableBody></Table></>:<p className="quality-empty">当前筛选下暂无同时登记物料和供应商的采购异常。</p>}
        <p className="quality-card-note">仅比较已登记异常样本，不能据此推断供应商全部交付合格率。缺少物料或供应商信息的记录不参与比较。</p>
      </section>
    </div>
    <section className="quality-card quality-record-list" aria-label="质量异常列表">
    <div className="quality-card-heading"><div><h3>质量异常列表</h3><p>沿原异常查看证据、原因、处置与复验</p></div><span className="quality-count">{rows.length} 条</span></div>
    {!rows.length?<p className="py-10 text-center text-sm text-muted-foreground">当前条件下没有质量异常。</p>:<><div className="space-y-3 lg:hidden">{visible.map(row=><article key={row.id} className="rounded-lg border p-3 text-sm"><div className="flex items-start justify-between gap-3"><p className="font-medium break-words">{row.issue}</p><span className="shrink-0 rounded-full bg-muted px-2 py-1 text-xs">{row.status==='closed'?'已关闭':row.status==='processing'?'处理中':'待处理'}</span></div><p className="mt-2 text-muted-foreground">{row.inspectionDate} · {qualitySourceNames[row.source]}</p><p className="mt-1 break-words text-muted-foreground">{row.batchNo} · {row.treeNodeName}</p><div className="mt-3 flex flex-wrap items-center justify-between gap-2"><div><p className="font-medium tabular-nums">不良 {row.defectiveQty} {row.unit}</p><p className="mt-1 text-xs text-muted-foreground">{row.analysis?.state==='confirmed'?qualityCauseNames[row.analysis.category]:'主因待确认'}</p></div><Button variant="outline" size="sm" onClick={()=>setSelected(row.id)}>查看与处理</Button></div></article>)}</div><div className="hidden lg:block"><Table className="min-w-[780px]"><TableHeader><TableRow>{['日期 / 来源','原异常 / 批次','不良数量','现象次数','主因 / 责任认定','状态','操作'].map(label=><TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>{visible.map(row=><TableRow key={row.id}><TableCell>{row.inspectionDate}<p className="text-xs text-muted-foreground">{qualitySourceNames[row.source]}</p></TableCell><TableCell className="max-w-80"><Button variant="link" className="h-auto justify-start whitespace-normal p-0 text-left font-medium" onClick={()=>setSelected(row.id)}>{row.issue}</Button><p className="text-xs text-muted-foreground">{row.batchNo} · {row.treeNodeName}</p></TableCell><TableCell>{row.defectiveQty} {row.unit}</TableCell><TableCell>{row.analysis?.phenomena.reduce((sum,item)=>sum+item.count,0)??'待补'}</TableCell><TableCell>{row.analysis?.state==='confirmed'?qualityCauseNames[row.analysis.category]:'未知 / 待确认'}<p className="text-xs text-muted-foreground">{row.analysis?.state==='confirmed'?row.analysis.responsibility.name:'责任待认定'}</p></TableCell><TableCell>{row.status==='closed'?'已关闭':row.status==='processing'?'处理中':'待处理'}</TableCell><TableCell><Button variant="outline" size="sm" onClick={()=>setSelected(row.id)}>查看与处理</Button></TableCell></TableRow>)}</TableBody></Table></div></>}
    <div className="flex items-center justify-between text-xs text-muted-foreground"><span>{rows.length} 条 · 第 {current} / {pages} 页</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={current===1} onClick={()=>setPage(current-1)}>上一页</Button><Button size="sm" variant="outline" disabled={current===pages} onClick={()=>setPage(current+1)}>下一页</Button></div></div>
    </section>
    {linkedId && !records.some(row => row.id === linkedId) && <p role="alert" className="text-sm text-muted-foreground">所选质量异常不存在或不在当前授权范围。</p>}
    {selectedId&&<QualityAnalysisDialog id={selectedId} onClose={close} onSaved={onSaved}/>}
  </section>;
}
