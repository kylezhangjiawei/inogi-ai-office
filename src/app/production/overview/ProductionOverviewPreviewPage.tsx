import { useEffect, useState } from 'react';
import { Link, useBlocker, useSearchParams } from 'react-router';
import { Activity, ArrowRight, ListChecks } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../../components/ui/alert-dialog';
import { OrderPageHeader } from '../../order-processing/components/HorizonPage';
import { aggregateProductionTasks, inScope, isOverdue, latestStaffing, lineLabels, monthlyOverview, productionToday, saveStaffing, shiftMonth, validMonth, type StaffingRecord } from './overviewModel';
import { readOverviewSources } from './overviewSources';
import '../../order-processing/horizon.css';
import './overview.css';
import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";
import { NativeSelect } from "../../components/ui/native-select";

export function ProductionOverviewPreviewPage() {
  const [params, setParams] = useSearchParams();
  const month = validMonth(params.get('month') ?? '') ? params.get('month')! : '2026-09';
  const scope = ['line-a', 'line-b'].includes(params.get('scope') ?? '') ? params.get('scope')! : 'all';
  const [source, setSource] = useState(readOverviewSources);
  const [role, setRole] = useState('manager');
  const [day, setDay] = useState(productionToday);
  const [staff, setStaff] = useState<StaffingRecord[]>([]);
  const [staffForm, setStaffForm] = useState(false);
  const [staffLine, setStaffLine] = useState('line-a');
  const [workers, setWorkers] = useState('');
  const [qc, setQc] = useState('');
  const [basis, setBasis] = useState('');
  const [staffContext, setStaffContext] = useState({date:day,role});
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const staffDirty = Boolean(workers || qc || basis);
  const contextChanged = staffContext.date !== day || staffContext.role !== role;
  const blocker = useBlocker(({currentLocation,nextLocation}) => staffDirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(()=>{
    if(!staffDirty) return;
    const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
    window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);
  },[staffDirty]);
  const totals = monthlyOverview(source, month);
  const rows = aggregateProductionTasks(source).filter((row) => inScope(row, scope));
  const attention = rows.filter((row) => row.status === 'open' && (row.risk || isOverdue(row, productionToday()))).sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
  const staffing = latestStaffing(staff, day, scope);
  const expectedLines = scope === 'all' ? 2 : 1;
  const lineTasks = source.planning.tasks.filter((task) => task.date === day && (scope === 'all' || task.lineId === scope) && task.status !== 'cancelled');
  const update = (patch: Record<string, string>) => { const next = new URLSearchParams(params); Object.entries(patch).forEach(([key, value]) => next.set(key, value)); setParams(next); };
  const tasksHref = `/__preview/production-tasks?month=${month}&scope=${scope}`;
  function confirmStaff(event: React.FormEvent) {
    event.preventDefault();
    try {
      if(contextChanged) throw new Error('日期或岗位已变化，旧填写已保留；请恢复原日期和岗位，或按当前日期重新填写。');
      if (!workers.trim() || !qc.trim()) throw new Error('请分别填写产线和 QC 在岗人数；无人时填写 0');
      setStaff(saveStaffing(staff, { date: day, lineId: staffLine, workers: Number(workers), qc: Number(qc), basis }, role, productionToday()));
      setStaffForm(false); setWorkers(''); setQc(''); setBasis(''); setError(''); setFeedback('已保存本次在岗确认，历史确认依据保留在本页。');
    } catch (err) { setError(err instanceof Error ? err.message : '未保存，请重试'); }
  }
  return <main className="order-horizon production-overview">
    <OrderPageHeader Icon={Activity} eyebrow="生产管理 / P00" title="生产管理总览" description="按原始完工、质量与任务依据，安排本期生产重点。" actions={<><Link className="po-button" to="/__preview">预览目录</Link><Link className="po-primary" to={tasksHref}><ListChecks size={16}/>生产全部任务</Link></>}/>
    <p className="po-demo"><strong>前端演示</strong> 汇总原页面样例；刷新恢复。整机完工、QC 合格、QA 放行和实际出货各自保留依据。</p>
    <div className="po-toolbar"><label>查看月份<Input type="month" aria-label="查看月份" value={month} onChange={(event) => { if (validMonth(event.target.value)) update({ month: event.target.value }); }}/></label><Button variant="unstyled" onClick={() => update({month:shiftMonth(month,-1)})}>上月</Button><Button variant="unstyled" onClick={() => update({month:shiftMonth(month,1)})}>下月</Button><label>产线范围<NativeSelect value={scope} onChange={(event)=>update({scope:event.target.value})}><option value="all">全部产线</option><option value="line-a">装配 A 线</option><option value="line-b">装配 B 线</option></NativeSelect></label><label>演示岗位<NativeSelect value={role} onChange={(event)=>setRole(event.target.value)}><option value="manager">管理层</option><option value="factory">厂长</option><option value="viewer">仅查看</option></NativeSelect></label><Button variant="unstyled" onClick={()=>{setSource(readOverviewSources());setFeedback('已重新读取可用演示来源。在岗确认保留。');}}>更新汇总</Button></div>
    {feedback?<p className="po-feedback" role="status">{feedback}</p>:null}
    <section className="po-metrics" aria-label="月度整机指标">
      <div><span>整机计划 · {month}</span><strong>{scope==='all'?totals.target:'—'}<small>台</small></strong><p>{scope==='all'?'来自产品月度目标':'原目标未分线，不分摊推算'}</p></div>
      <div><span>已确认整机完工</span><strong>{scope==='all'?totals.completed:'—'}<small>台</small></strong><p>{scope==='all'?'仅取整机完工原单':'完工凭据尚无产线归属'}</p></div>
      <div><span>剩余整机计划</span><strong>{scope==='all'?totals.remaining:'—'}<small>台</small></strong><p>组件与工序数量另行查看</p></div>
      <div><span>需关注的未完事项</span><strong>{attention.length}<small>项</small></strong><p>包含本范围跨月逾期</p></div>
    </section>
    <div className="po-grid"><section className="po-panel"><div className="po-section-title"><h2>整机完工依据</h2><span>{month}</span></div>{scope!=='all'?<p className="po-empty">当前来源未提供分线整机完工；切换全部产线可核对原批次。</p>:<><div className="po-progress"><span style={{width:`${totals.target?Math.min(100,totals.completed/totals.target*100):0}%`}}/></div><p className="po-muted">{totals.target?`${(totals.completed/totals.target*100).toFixed(1)}% 已完成`:'本月尚无目标'} · 完工不代表已放行或已出货</p><div className="po-fact-list">{totals.completions.length?totals.completions.map((batch)=><article key={batch.id}><div><strong>{batch.code}</strong><span>{batch.completedDate}</span><p>{batch.completionSource}</p></div><b>{batch.completed} 台</b><Link to={`/__preview/production-planning?month=${month}&batch=${batch.id}&task=${source.planning.tasks.find((task)=>task.batchId===batch.id&&task.operationId==='final')?.id??''}`}>核对原单<ArrowRight size={14}/></Link></article>):<p className="po-empty">本月尚无整机完工凭据。</p>}</div></>}
    </section><section className="po-panel"><div className="po-section-title"><h2>终检首次合格率</h2><Link to="/__preview/production-inspections">查看检验<ArrowRight size={14}/></Link></div><p className="po-rate">{scope==='all'&&totals.firstPassRate!==null?`${totals.firstPassRate.toFixed(1)}%`:'—'}</p><p>{scope==='all'?`${totals.good} / ${totals.inspected} 台 · ${month} 初检记录`:'原检验任务未分线，暂不计算分线指标'}</p><p className="po-muted">仅统计终检「台」的首次结果。复验合格不回填；过程检验按工序和单位单独阅读。</p><Link className="po-text-link" to="/__preview/production-defects">处理不良与复验交接<ArrowRight size={14}/></Link></section></div>
    <section className="po-panel"><div className="po-section-title"><div><h2>分线安排与在岗</h2><p className="po-muted">按工作日期核对组件任务；人数由主管确认。</p></div><label>工作日期<Input type="date" value={day} onChange={(event)=>{setDay(event.target.value);setFeedback('');}}/></label></div><div className="po-staff-strip"><span>{day} · {staffing.length===expectedLines?`已确认 ${staffing.reduce((sum,item)=>sum+item.workers+item.qc,0)} 人`:`${expectedLines-staffing.length} 条线待确认，人数暂缺`}</span>{role!=='viewer'?<Button variant="unstyled" onClick={()=>{if(!staffDirty)setStaffContext({date:day,role});setStaffForm(!staffForm);setError('');}}>确认在岗人数</Button>:<span>查看岗位</span>}</div>
      {staffForm?<form className="po-staff-form" onSubmit={confirmStaff}><p className="po-wide">填写日期：<strong>{staffContext.date}</strong> · {staffContext.role==='manager'?'管理层':'厂长'}</p><label>确认产线<NativeSelect value={staffLine} onChange={(event)=>setStaffLine(event.target.value)}><option value="line-a">装配 A 线</option><option value="line-b">装配 B 线</option></NativeSelect></label><label>产线人数<Input inputMode="numeric" value={workers} onChange={(event)=>setWorkers(event.target.value)}/></label><label>QC 人数<Input inputMode="numeric" value={qc} onChange={(event)=>setQc(event.target.value)}/></label><label className="po-wide">确认依据<Input value={basis} maxLength={300} onChange={(event)=>setBasis(event.target.value)} placeholder="如班前点名记录与确认时间"/></label>{contextChanged?<div className="po-wide po-error" role="alert"><p>日期或岗位已变化，旧填写已保留。恢复原日期和岗位可继续保存。</p><Button variant="unstyled" type="button" onClick={()=>{setWorkers('');setQc('');setBasis('');setStaffContext({date:day,role});setError('');}}>放弃旧填写，按当前日期重新填写</Button></div>:null}{error?<p className="po-error" role="alert">{error}</p>:null}<p className="po-muted po-wide">保存后保留原确认记录。刷新页面恢复样例。</p><Button variant="unstyled" className="po-primary" type="submit" disabled={role==='viewer'||contextChanged}>保存在岗确认</Button><Button variant="unstyled" type="button" onClick={()=>setStaffForm(false)}>收起填写</Button></form>:null}
      {staffing.length?<div className="po-staff-results">{staffing.map((item)=><p key={item.id}><strong>{lineLabels[item.lineId]}</strong> 产线 {item.workers} 人 / QC {item.qc} 人 · {item.confirmedBy} · {item.basis}</p>)}</div>:null}
      {lineTasks.length?<div className="po-line-grid">{lineTasks.map((task)=>{const batch=source.planning.batches.find((item)=>item.id===task.batchId)!; const operation=batch.operations.find((item)=>item.id===task.operationId)!;return <article className="po-line-task" key={task.id}><div className="po-section-title"><h3>{lineLabels[task.lineId]} · {operation.component}</h3><span>{operation.process}</span></div><p>{batch.code} · {source.planning.actors.find((item)=>item.id===task.ownerId)?.name}</p><dl><div><dt>计划</dt><dd>{task.quantity} {operation.unit}</dd></div><div><dt>已报工</dt><dd>{task.reported} {operation.unit}</dd></div><div><dt>合格完成</dt><dd>{task.qualified} {operation.unit}</dd></div><div><dt>返工待验</dt><dd>{task.rework} {operation.unit}</dd></div></dl><Link to={`/__preview/production-planning?month=${task.date.slice(0,7)}&batch=${batch.id}&task=${task.id}`}>查看组件任务<ArrowRight size={14}/></Link></article>;})}</div>:<p className="po-empty">当前日期和范围没有组件安排。可选择 2026-09-11 核对已有报工样例。</p>}
      {staff.length?<details className="po-history"><summary>在岗确认历史（{staff.length} 条）</summary>{staff.map((item)=><p key={item.id}>{item.date} · {lineLabels[item.lineId]} · 产线 {item.workers} / QC {item.qc} · {item.basis}</p>)}</details>:null}
    </section>
    <section className="po-panel"><div className="po-section-title"><h2>质量与交付风险</h2><Link to={tasksHref}>查看全部待办<ArrowRight size={14}/></Link></div><p className="po-muted">覆盖当前产线范围的全部未完事项；逾期依原单期限判定，未确认停线的事项不标为停线。</p><div className="po-risk-list">{attention.length?attention.map((row)=><Link key={row.key} to={row.href}><span className="po-risk-dot"/><div><strong>{row.subject}</strong><p>{row.code} · {row.batch} · {row.owner}</p></div><span>{isOverdue(row,productionToday())?'已逾期':row.risk}<small>{row.dueDate??'期限待确认'}</small></span><ArrowRight size={16}/></Link>):<p className="po-empty">当前范围暂无需要关注的风险事项。</p>}</div></section>
    <section className="po-panel"><div className="po-section-title"><h2>适用 ECN</h2><span>按发布月份核对</span></div>{source.ecn.records.filter((item)=>item.status==='published'&&item.publishedAt?.slice(0,7)===month).map((record)=><div className="po-ecn" key={record.id}><div><strong>{record.code} · {record.title}</strong><p>{record.effectiveRule}</p></div><Link to={`/__preview/ecn?ecn=${record.id}&tab=scope`}>核对适用范围<ArrowRight size={14}/></Link></div>)}{!source.ecn.records.some((item)=>item.status==='published'&&item.publishedAt?.slice(0,7)===month)?<p className="po-empty">本月无已发布 ECN 样例。</p>:null}</section>
    <AlertDialog open={blocker.state==='blocked'}><AlertDialogContent className="order-horizon-overlay"><AlertDialogHeader><AlertDialogTitle>离开在岗确认？</AlertDialogTitle><AlertDialogDescription>尚未保存的人数和确认依据将丢失。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel onClick={()=>blocker.reset?.()}>继续填写</AlertDialogCancel><AlertDialogAction onClick={()=>{setWorkers('');setQc('');setBasis('');blocker.proceed?.();}}>放弃填写并离开</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </main>;
}
