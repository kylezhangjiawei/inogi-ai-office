import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ArrowLeft, ArrowRight, ListChecks, X } from 'lucide-react';
import { OrderPageHeader } from '../../order-processing/components/HorizonPage';
import { aggregateProductionTasks, isOverdue, lineLabels, productionToday, selectProductionTasks, shiftMonth, taskDateLabels, taskKindLabels, validMonth, type ProductionTaskRow } from './overviewModel';
import { readOverviewSources } from './overviewSources';
import '../../order-processing/horizon.css';
import './overview.css';

export function ProductionTasksPreviewPage() {
  const [params, setParams] = useSearchParams();
  const month=validMonth(params.get('month')??'')?params.get('month')!:'2026-09';
  const scope=['line-a','line-b'].includes(params.get('scope')??'')?params.get('scope')!:'all';
  const [source,setSource]=useState(readOverviewSources);
  const [line,setLine]=useState('all'), [owner,setOwner]=useState('all'), [kind,setKind]=useState('all'), [status,setStatus]=useState('open'), [query,setQuery]=useState('');
  const [selectedKey,setSelectedKey]=useState<string|null>(null), [showCarry,setShowCarry]=useState(false), [notice,setNotice]=useState('');
  const rows=aggregateProductionTasks(source), today=productionToday();
  const result=selectProductionTasks(rows,{month,scope,line,owner,kind,status,query},today);
  const detail=result.scoped.find((row)=>row.key===selectedKey);
  useEffect(()=>{if(selectedKey&&window.matchMedia('(max-width: 1199px)').matches)document.getElementById('po-task-detail')?.scrollIntoView({block:'start',behavior:'instant'});},[selectedKey]);
  const update=(patch:Record<string,string>)=>{const next=new URLSearchParams(params);Object.entries(patch).forEach(([key,value])=>next.set(key,value));setParams(next);setSelectedKey(null);};
  const clear=()=>{setLine('all');setOwner('all');setKind('all');setStatus('all');setQuery('');setSelectedKey(null);};
  function taskRow(row:ProductionTaskRow) { return <tr key={row.key} data-selected={row.key===selectedKey}><td><button className="po-record-button" onClick={()=>setSelectedKey(row.key)} aria-label={`查看任务 ${row.code}`}>{row.code}</button><small>{taskKindLabels[row.kind]}</small></td><td><strong>{row.subject}</strong><small>{row.batch} · {lineLabels[row.lineId??'unassigned']}</small></td><td>{row.node}<small>{row.owner}</small></td><td><span className={isOverdue(row,today)?'po-overdue':''}>{row.dueDate??'待确认'}</span><small>{isOverdue(row,today)?'已逾期':row.status==='done'?'已完成':row.risk||'待处理'}</small></td><td><Link aria-label={`打开原业务 ${row.code}`} to={row.href}>原业务<ArrowRight size={14}/></Link></td></tr>; }
  return <main className="order-horizon production-overview production-tasks">
    <OrderPageHeader Icon={ListChecks} eyebrow="生产管理 / P06" title="生产全部任务" description="按原业务集中跟进，经办人与期限回到原单处理。" actions={<Link className="po-button" to={`/__preview/production-overview?month=${month}&scope=${scope}`}><ArrowLeft size={16}/>生产总览</Link>}/>
    <p className="po-demo"><strong>前端演示</strong> 只聚合原记录；接收、更新与转交在对应原业务页面完成。独立页面的演示状态可能不同，尚未接通正式任务接口。</p>
    <div className="po-toolbar"><label>任务归属月份<input type="month" value={month} onChange={(event)=>{if(validMonth(event.target.value))update({month:event.target.value});}}/></label><button onClick={()=>update({month:shiftMonth(month,-1)})}>上月</button><button onClick={()=>update({month:shiftMonth(month,1)})}>下月</button><label>演示授权范围<select value={scope} onChange={(event)=>{update({scope:event.target.value});setLine('all');setOwner('all');}}><option value="all">全部生产范围</option><option value="line-a">仅装配 A 线</option><option value="line-b">仅装配 B 线</option></select></label><button onClick={()=>{setSource(readOverviewSources());setNotice('已重新读取可用来源；未创建或改写原业务。');}}>更新汇总</button></div>
    {notice?<p className="po-feedback" role="status">{notice}</p>:null}
    <section className="po-carry" aria-label="跨月未完任务"><div><strong>跨月未完 {result.carry.length} 项</strong><p>此前月份未完及当前月份之外的逾期原单。保留当前授权范围，不受下方类别、人员、状态或搜索筛选影响。</p></div><button onClick={()=>setShowCarry(!showCarry)} aria-expanded={showCarry}>{showCarry?'收起跨月任务':'查看跨月任务'}</button></section>
    {showCarry?<section className="po-panel"><h2>跨月未完原单</h2>{result.carry.length?<div className="po-table-wrap"><table className="po-table"><thead><tr><th>原业务编号 / 类型</th><th>内容 / 产线</th><th>节点 / 经办人</th><th>期限 / 风险</th><th>操作</th></tr></thead><tbody>{result.carry.map(taskRow)}</tbody></table></div>:<p className="po-empty">当前授权范围暂无跨月未完任务。</p>}</section>:null}
    <section className="po-panel"><div className="po-section-title"><h2>{month} 原业务任务</h2><span>{result.selected.length} 项</span></div><div className="po-task-filters"><label>业务类型<select value={kind} onChange={(event)=>{setKind(event.target.value);setSelectedKey(null);}}><option value="all">全部类型</option>{Object.entries(taskKindLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label>产线<select value={line} onChange={(event)=>{setLine(event.target.value);setSelectedKey(null);}}><option value="all">全部产线</option>{Object.entries(lineLabels).filter(([id])=>scope==='all'||id===scope).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label><label>经办人<select value={owner} onChange={(event)=>{setOwner(event.target.value);setSelectedKey(null);}}><option value="all">全部经办人</option>{[...new Set(result.scoped.map((row)=>row.owner))].sort().map((name)=><option key={name}>{name}</option>)}</select></label><label>任务状态<select value={status} onChange={(event)=>{setStatus(event.target.value);setSelectedKey(null);}}><option value="all">全部状态</option><option value="open">未完成</option><option value="done">已完成</option><option value="overdue">已逾期</option></select></label><label className="po-search">搜索原单<input value={query} onChange={(event)=>{setQuery(event.target.value);setSelectedKey(null);}} placeholder="编号、批次、组件或人员"/></label><button onClick={clear}>清除筛选</button></div>
      <div className={detail?'po-task-layout has-detail':'po-task-layout'}><div>{result.selected.length?<div className="po-table-wrap"><table className="po-table"><thead><tr><th>原业务编号 / 类型</th><th>内容 / 产线</th><th>节点 / 经办人</th><th>期限 / 风险</th><th>操作</th></tr></thead><tbody>{result.selected.map(taskRow)}</tbody></table></div>:<div className="po-empty"><h3>当前筛选没有任务</h3><p>可清除筛选或查看上方跨月未完原单。</p><button onClick={clear}>显示本月全部任务</button></div>}
      <p className="po-muted">不良转研发仍是同一条原异常；检验未分线或未配置期限时保留待确认。</p></div>
      {detail?<aside id="po-task-detail" className="po-task-detail" aria-label="任务详情"><div className="po-section-title"><h2>{detail.code}</h2><button aria-label="关闭任务详情" onClick={()=>setSelectedKey(null)}><X size={16}/></button></div><p>{detail.subject}</p><dl><dt>原业务类型</dt><dd>{taskKindLabels[detail.kind]}</dd><dt>批次</dt><dd>{detail.batch}</dd><dt>{taskDateLabels[detail.kind]}</dt><dd>{detail.date}</dd><dt>当前节点 / 经办人</dt><dd>{detail.node} / {detail.owner}</dd><dt>处理期限</dt><dd>{detail.dueDate??'原记录未配置'}</dd><dt>依据</dt><dd>{detail.summary}</dd></dl><Link className="po-primary" to={detail.href}>前往原业务处理<ArrowRight size={16}/></Link><p className="po-muted">在原业务核对权限后接收、更新或转交。</p></aside>:null}</div>
    </section>
  </main>;
}
