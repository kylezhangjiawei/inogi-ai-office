import { useEffect, useRef, useState } from 'react';
import { Plus, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { NativeSelect } from '../../components/ui/native-select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { useI18n } from '../../lib/i18n';
import { erpPurchaseOrderApi as api, type ErpOrderInput, type ErpOrderLine, type ErpOrderOptions, type ErpOrderResult, type ErpOrderView } from '../../lib/erpPurchaseOrderApi';

const emptyLine=():ErpOrderLine=>({inventoryCode:'',unitName:'',quantity:1,unitPrice:0,taxRate:0,etaDate:''});
const newForm=():ErpOrderInput=>({requestId:crypto.randomUUID(),action:'create',orderNo:'',expectedId:'',expectedTs:'',orderDate:new Date().toLocaleDateString('sv-SE'),supplierCode:'',contractNo:'',memo:'',lines:[emptyLine()]});
export function ErpPurchaseOrderDialog({mode,orderNo,onClose,onSaved,initial}:{mode:'create'|'update'|'delete'|'read';orderNo?:string;onClose:()=>void;onSaved:(result:ErpOrderResult)=>void;initial?:Pick<ErpOrderInput,'lines'|'memo'>}) {
 const initialRef=useRef(initial);
 const {t}=useI18n();const [form,setForm]=useState<ErpOrderInput>(()=>({...newForm(),action:mode==='create'?'create':mode==='delete'?'delete':'update'})),[view,setView]=useState<ErpOrderView|null>(null),[options,setOptions]=useState<ErpOrderOptions>({suppliers:[],materials:[]});
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[recovery,setRecovery]=useState(false),[confirmed,setConfirmed]=useState(''),[revision,setRevision]=useState(0);
 const busyRef=useRef(false),active=useRef(true);
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 useEffect(()=>{let alive=true;setLoading(true);setError('');void (async()=>{
  try {
   const [available,pending]=await Promise.all([mode==='read'?Promise.resolve({suppliers:[],materials:[]}):api.options(),mode==='read'?Promise.resolve(null):api.pending(orderNo)]);
   const current=orderNo&&!pending?await api.read(orderNo):null;
   if(!alive)return;setOptions(available);setView(current);
   if(pending){setForm(pending.input);setRecovery(true);setError(pending.error||t('发现上次未确认的操作，请先核对结果'));}
   else {setRecovery(false);setForm(current?{...newForm(),action:mode==='delete'?'delete':'update',orderNo:current.orderNo,expectedId:current.id,expectedTs:current.ts,orderDate:current.orderDate,supplierCode:current.supplierCode,contractNo:current.contractNo,memo:current.memo,lines:current.lines}:{...newForm(),...(mode==='create'?initialRef.current:{})});}
  }catch(cause){if(alive)setError(cause instanceof Error?cause.message:t('读取ERP失败'));}finally{if(alive)setLoading(false);}
 })();return()=>{alive=false;};},[mode,orderNo,revision,t]);
 const patch=(change:Partial<ErpOrderInput>)=>{setError('');setForm(previous=>({...previous,...change,requestId:crypto.randomUUID()}));};
 const linePatch=(index:number,change:Partial<ErpOrderLine>)=>patch({lines:form.lines.map((line,i)=>i===index?{...line,...change}:line)});
 const creating=form.action==='create',deleting=form.action==='delete',readonly=mode==='read',disabled=busy||loading||recovery||readonly||(!creating&&!view?.editable);
 const finish=(result:ErpOrderResult)=>{toast.success(t(result.deleted?'ERP采购订单已删除并核对':'ERP采购订单已保存并核对'));if(result.warnings.length)toast.warning(result.warnings.join('；'));onSaved(result);};
 const submit=async()=>{
  if(busyRef.current)return;
  if(!recovery&&!deleting&&(!form.orderDate||!form.supplierCode||!form.lines.length||form.lines.some(line=>!line.inventoryCode||!Number.isFinite(line.quantity)||line.quantity<=0||creating&&!line.unitName))){setError(t('请填写单据日期、ERP供应商及每行的物料、单位和有效数量'));return;}
  if(deleting&&confirmed!==form.orderNo){setError(t('请输入完整订单号确认删除'));return;}
  busyRef.current=true;setBusy(true);setError('');
  try {const result=await api.write(form);if(active.current)finish(result);}
  catch(cause){if(!active.current)return;setError(cause instanceof Error?cause.message:t('ERP操作失败'));setRecovery(true);
   try {const state=await api.status(form.requestId);if(!active.current)return;if(state?.state==='verified'&&state.result){finish(state.result);return;}setRecovery(!!state&&state.state!=='rejected');}
   catch { /* Keep the request frozen until its durable status can be reconciled. */ }
  }finally{busyRef.current=false;if(active.current)setBusy(false);}
 };
 return <Dialog open onOpenChange={open=>{if(!open&&!busy)onClose();}}><DialogContent className="flex max-h-[92dvh] w-[calc(100vw-2rem)] max-w-6xl flex-col overflow-hidden sm:max-w-6xl" onEscapeKeyDown={event=>{if(busy)event.preventDefault();}} onInteractOutside={event=>event.preventDefault()}>
  <DialogHeader><DialogTitle>{t(readonly?'ERP实时采购订单':deleting?'删除ERP采购订单':creating?'新增ERP采购订单':'修改ERP采购订单')}</DialogTitle><DialogDescription>{t('保存和删除将直接操作ERP，完成后回读核对并刷新本系统。')}</DialogDescription></DialogHeader>
  <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
   {loading?<p role="status">{t('正在读取ERP订单和档案…')}</p>:null}
   {error&&<div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}{!recovery&&<Button size="sm" variant="outline" disabled={busy} onClick={()=>setRevision(v=>v+1)} className="ml-2"><RefreshCw className="size-4"/>{t('重新读取')}</Button>}</div>}
   {view&&<p className="text-sm text-muted-foreground">{view.orderNo} · {view.approvalStatus} · {view.supplierName}</p>}
   {!!view?.warnings.length&&<ul role="status" className="text-sm text-amber-700">{view.warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul>}
   {view&&!view.editable&&<p className="text-sm text-amber-700">{view.restriction}</p>}
   {recovery&&<p role="status" className="text-sm text-amber-700">{t('上次操作结果尚待核对。保留原请求，仅回查ERP，不会重复发送写入。关闭后可从本入口继续核对。')}</p>}
   {deleting?<div className="space-y-3"><p className="text-sm">{t('删除后ERP订单将不存在。本系统会保留操作记录；有关联任务、收货或备料记录时禁止删除。')}</p><label className="grid gap-1 text-sm">{t('输入订单号确认删除')}<Input disabled={busy||loading} value={confirmed} onChange={e=>setConfirmed(e.target.value)}/></label></div>:<>
    {!creating&&!readonly&&<p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">{t('官方接口支持修改日期、备注、物料和数量。供应商、合同号、单价、税率、单位及预计到货日期只读；新增明细的价格和单位由ERP确定，保存后请核对。')}</p>}
    <fieldset disabled={disabled} className="grid min-w-0 gap-3 border-0 p-0 sm:grid-cols-2 lg:grid-cols-4">
     <label className="grid gap-1 text-sm">{t('单据日期')}<Input type="date" value={form.orderDate} onChange={e=>patch({orderDate:e.target.value})}/></label>
     <label className="grid gap-1 text-sm">{t('供应商')}<NativeSelect aria-label={t('供应商')} disabled={disabled||!creating} value={form.supplierCode} onChange={e=>patch({supplierCode:e.target.value})}><option value="">{t('选择ERP供应商')}</option>{view&&!options.suppliers.some(s=>s.tpCode===view.supplierCode)&&<option value={view.supplierCode}>{view.supplierName} · {view.supplierCode}</option>}{options.suppliers.map(s=><option key={s.id} value={s.tpCode}>{s.name} · {s.tpCode}</option>)}</NativeSelect></label>
     <label className="grid gap-1 text-sm">{t('合同号')}<Input readOnly={!creating} value={form.contractNo} onChange={e=>patch({contractNo:e.target.value})}/></label>
     <label className="grid gap-1 text-sm">{t('整单预计到货日期')}<Input type="date" disabled={!creating} onChange={e=>patch({lines:form.lines.map(line=>({...line,etaDate:e.target.value}))})}/><span className="text-xs text-muted-foreground">{t('新增时批量填入各明细行，可逐行调整')}</span></label>
     <label className="grid gap-1 text-sm sm:col-span-2 lg:col-span-4">{t('备注')}<Input value={form.memo} maxLength={1000} onChange={e=>patch({memo:e.target.value})}/></label>
    </fieldset>
    <div className="flex items-center justify-between"><h3 className="text-sm font-medium">{t('采购物料')}（{form.lines.length}）</h3>{!readonly&&<Button variant="outline" size="sm" disabled={disabled||form.lines.length>=200} onClick={()=>patch({lines:[...form.lines,emptyLine()]})}><Plus className="size-4"/>{t('添加物料')}</Button>}</div>
    <div className="overflow-x-auto rounded-md border"><table className="w-full min-w-[930px] text-sm" aria-label={t('采购订单编辑明细')}><thead className="bg-muted text-left"><tr>{['物料 / ERP编码','单位','数量','未税单价','税率 %','预计到货日期','操作'].map(label=><th key={label} className="p-2 font-medium">{t(label)}</th>)}</tr></thead><tbody>{form.lines.map((line,index)=><tr key={line.id||index} className="border-t">
     <td className="min-w-64 p-2"><NativeSelect aria-label={t('第 {n} 行物料',{n:index+1})} disabled={disabled} value={line.inventoryCode} onChange={e=>{const material=options.materials.find(m=>m.tpInventoryCode===e.target.value);linePatch(index,{inventoryCode:e.target.value,...(creating?{unitName:material?.unit||'',unitCode:''}:{})});}}><option value="">{t('选择ERP物料')}</option>{line.inventoryCode&&!options.materials.some(m=>m.tpInventoryCode===line.inventoryCode)&&<option value={line.inventoryCode}>{line.name||line.inventoryCode} · {line.inventoryCode}</option>}{options.materials.map(m=><option key={m.id} value={m.tpInventoryCode}>{m.tpInventoryCode} · {m.name} {m.spec}</option>)}</NativeSelect></td>
     <td className="p-2"><Input className="w-20" aria-label={t('第 {n} 行单位',{n:index+1})} disabled={disabled||!creating} value={line.unitName} onChange={e=>linePatch(index,{unitName:e.target.value,unitCode:''})}/></td>
     <td className="p-2"><Input className="w-28" type="number" min="0.001" step="0.001" aria-label={t('第 {n} 行数量',{n:index+1})} disabled={disabled} value={line.quantity} onChange={e=>linePatch(index,{quantity:e.target.valueAsNumber})}/></td>
     <td className="p-2"><Input className="w-28" type="number" min="0" step="0.0001" aria-label={t('第 {n} 行单价',{n:index+1})} disabled={disabled||!creating} value={line.unitPrice} onChange={e=>linePatch(index,{unitPrice:e.target.valueAsNumber})}/></td>
     <td className="p-2"><Input className="w-20" type="number" min="0" max="100" aria-label={t('第 {n} 行税率',{n:index+1})} disabled={disabled||!creating} value={line.taxRate} onChange={e=>linePatch(index,{taxRate:e.target.valueAsNumber})}/></td>
     <td className="p-2"><Input type="date" aria-label={t('第 {n} 行预计到货日期',{n:index+1})} disabled={disabled||!creating} value={line.etaDate} onChange={e=>linePatch(index,{etaDate:e.target.value})}/></td>
     <td className="p-2">{!readonly&&<Button variant="ghost" size="icon" disabled={disabled||form.lines.length<=1} aria-label={t('删除第 {n} 行',{n:index+1})} onClick={()=>patch({lines:form.lines.filter((_,i)=>i!==index)})}><Trash2 className="size-4"/></Button>}</td>
    </tr>)}</tbody></table></div>
    {creating&&<p className="text-xs text-muted-foreground">{t('仅可选择已有ERP编码的供应商和物料。单价为ERP原币未税单价，税率填百分数；单号和金额由ERP生成，保存后核对。')}</p>}
   </>}
  </div>
  <DialogFooter className="shrink-0"><Button variant="outline" disabled={busy} onClick={onClose}>{t(readonly?'关闭':'取消')}</Button>{!readonly&&<Button variant={deleting?'destructive':'default'} disabled={busy||loading||(!recovery&&!creating&&!view?.editable)||(deleting&&confirmed!==form.orderNo)} onClick={()=>void submit()}>{t(busy?'正在核对…':recovery?'核对上次操作':deleting?'确认删除ERP订单':'保存到ERP并核对')}</Button>}</DialogFooter>
 </DialogContent></Dialog>;
}
