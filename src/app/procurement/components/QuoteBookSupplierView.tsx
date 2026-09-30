import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, FileText, Pencil, Plus, RefreshCw, ScanLine, Upload } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "../../auth";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { Input } from "../../components/ui/input";
import { NativeSelect } from "../../components/ui/native-select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { useI18n } from "../../lib/i18n";
import { listSupplierDirectory, saveSupplierProfile, saveSupplierMaterialRole, listProcTasks, syncTplusQuoteBook, waitApplyJob, getTplusSyncJob, type QuoteBookSyncResult, type SupplierProfile, type QuoteBookRow, type SupplierQuote, type ProcurementTask } from "../../lib/procurementApi";
import { listSupplyQualifications, type QualificationDirectory } from "../../lib/supplierQualificationsApi";
import { TaskDetailDrawer } from "./TaskDetailDrawer";
import { buildQuoteBookDirectory, filterSupplierMaterials, directoryQuoteExpired, supplierSourceLabel } from "../quoteBookDirectoryModel";
import { SUPPLY_QUALIFICATION_LABELS } from "../supplierQualificationsModel";
import { ImageLightbox, PROC_STATUS_META, useProcCan } from "./common";
import "./QuoteBookSupplierView.css";

export const DIRECTORY_SUPPLIER_PAGE_SIZE = 12;
export const DIRECTORY_QUOTE_PAGE_SIZE = 10;
interface QuoteBookSupplierViewProps {
  rows: QuoteBookRow[]; today: string; canWrite: boolean;
  onCompare: (row: QuoteBookRow) => void; onEdit: (row: QuoteBookRow, quote?: SupplierQuote, supplierName?: string) => void;
  onShowMaterials?: () => void; onQualifications?: (materialId: string, supplierId: string) => void;
  onEditMany: (materials: QuoteBookRow[], suppliers: Array<{id: string; name: string}>) => void;
  onCreate?: (supplierName?: string, supplierId?: string, suppliers?: Array<{id: string; name: string}>) => void; onImport?: () => void; onReload?: () => void;
}
const blankProfile = { name: '', enabled: true, description: '', tags: '', cooperationStart: '', supplyScope: '', owner: '', grade: '', contact: '', phone: '', email: '', address: '' };
const normalized = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
function Pager({ page, pages, onPage, label }: { page: number; pages: number; onPage: (n: number) => void; label: string }) {
  return <nav aria-label={label} className="qb-pager"><Button size="icon" variant="outline" aria-label={`${label}上一页`} disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft className="size-4" /></Button><span>{page} / {pages}</span><Button size="icon" variant="outline" aria-label={`${label}下一页`} disabled={page >= pages} onClick={() => onPage(page + 1)}><ChevronRight className="size-4" /></Button></nav>;
}
function SupplierEditor({ profile, onClose, onSaved }: { profile: SupplierProfile | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n(); const [form, setForm] = useState({ ...blankProfile, ...profile }); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const erp = profile?.source === 'tplus';
  const save = async () => {
    if (!form.name.trim()) { setError(t('请填写供应商名称')); return; }
    setBusy(true); setError('');
    try {
      const { id: _id, source: _source, tpCode: _code, materialRoles: _roles, ...payload } = form as SupplierProfile;
      await saveSupplierProfile(payload, profile?.id); toast.success(t('供应商信息已保存')); onSaved(); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('保存失败')); } finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>{t(profile ? '编辑供应商信息' : '新增供应商')}</DialogTitle><DialogDescription>{t(erp ? 'ERP 基础档案由同步更新，可补充合作与供货信息。' : '保存前检查已有供应商，重复名称会提示核对。')}</DialogDescription></DialogHeader>
    <form onSubmit={event => { event.preventDefault(); void save(); }}><fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
      {([['name','供应商名称'],['shortName','简称'],['description','供应商简介'],['tags','标签（用顿号分隔）'],['cooperationStart','合作开始月份'],['supplyScope','主要供货范围'],['owner','经办人'],['contact','联系人'],['phone','联系电话'],['email','邮箱'],['address','地址']] as const).map(([key,label]) => <label key={key} className="grid gap-1.5 text-sm">{t(label)}<Input required={key === 'name'} type={key === 'cooperationStart' ? 'month' : 'text'} maxLength={['description','supplyScope','address'].includes(key) ? 500 : 200} disabled={erp && ['name','shortName','contact','phone','email','address'].includes(key)} value={form[key] || ''} onChange={event => setForm(current => ({ ...current, [key]: event.target.value }))} /></label>)}
      <label className="grid gap-1.5 text-sm">{t('供应商等级')}<NativeSelect value={form.grade || ''} onChange={event => setForm(current => ({ ...current, grade: event.target.value }))}><option value="">{t('未评级')}</option>{['A','B','C','D'].map(grade => <option key={grade} value={grade}>{grade} {t('级')}</option>)}</NativeSelect></label>
      <label className="grid gap-1.5 text-sm">{t('档案状态')}<NativeSelect disabled={erp} value={form.enabled ? 'enabled' : 'disabled'} onChange={event => setForm(current => ({ ...current, enabled: event.target.value === 'enabled' }))}><option value="enabled">{t('启用')}</option><option value="disabled">{t('停用')}</option></NativeSelect></label>
    </fieldset>{error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}<DialogFooter className="mt-5"><Button type="button" variant="outline" disabled={busy} onClick={onClose}>{t('取消')}</Button><Button type="submit" disabled={busy}>{t(busy ? '保存中…' : '保存')}</Button></DialogFooter></form>
  </DialogContent></Dialog>;
}
export function QuoteBookSupplierView({ rows, today, canWrite, onCompare, onEdit, onQualifications, onCreate, onImport, onReload, onEditMany }: QuoteBookSupplierViewProps) {
  const { t } = useI18n(); const { user } = useAuth(); const can = useProcCan();
  const scope = JSON.stringify([user?.id, user?.permissions]);
  const [stored, setStored] = useState<{ scope: string; suppliers: SupplierProfile[]; qualifications: QualificationDirectory | null; tasks: ProcurementTask[]; errors: string[] } | null>(null);
  const [loading,setLoading] = useState(true), [revision,setRevision] = useState(0), [syncing,setSyncing] = useState(false);
  const [supplierSearch,setSupplierSearch] = useState(''), [supplierStatus,setSupplierStatus] = useState('all'), [selectedKey,setSelectedKey] = useState('');
  const [materialSearch,setMaterialSearch] = useState(''), [category,setCategory] = useState(''), [status,setStatus] = useState('');
  const [supplierPage,setSupplierPage] = useState(1), [materialPage,setMaterialPage] = useState(1), [relatedPage,setRelatedPage] = useState(1);
  const [relatedSearch,setRelatedSearch] = useState(''), [relatedStatus,setRelatedStatus] = useState('');
  const [selectedMaterial,setSelectedMaterial] = useState(''), [preview,setPreview] = useState<string | null>(null), [editor,setEditor] = useState<SupplierProfile | 'new' | null>(null);
  const [relatedTask,setRelatedTask] = useState<ProcurementTask | null>(null);
  const [syncProgress,setSyncProgress] = useState('');
  const [syncResult,setSyncResult] = useState<(QuoteBookSyncResult & {scope:string}) | null>(null);
  const [roleBusy,setRoleBusy] = useState(false);
  const [quotePicker,setQuotePicker] = useState(false);
  const [quoteSelected,setQuoteSelected] = useState<string[]>([]);
  const [quoteSupplierSelected,setQuoteSupplierSelected] = useState<string[]>([]);
  const [quoteSupplierSearch,setQuoteSupplierSearch] = useState(''), [quoteSupplierSource,setQuoteSupplierSource] = useState(''), [quoteSupplierPage,setQuoteSupplierPage] = useState(1);
  const [quoteSearch,setQuoteSearch] = useState(''), [quoteCategory,setQuoteCategory] = useState(''), [quoteStatus,setQuoteStatus] = useState(''), [quotePage,setQuotePage] = useState(1);
  const openQuotePicker = () => { setQuoteSelected([]); setQuoteSearch(''); setQuoteCategory(''); setQuoteStatus(''); setQuotePage(1); setQuoteSupplierSelected(selected?.supplierId && (selected.profile ?? selected.supplier)?.enabled !== false ? [selected.supplierId] : []); setQuoteSupplierSearch(''); setQuoteSupplierSource(''); setQuoteSupplierPage(1); setQuotePicker(true); };
  const data = stored?.scope === scope ? stored : null;
  const canTasks = can('page:proc-cockpit') || can('page:proc-my-workspace');
  useEffect(() => { setEditor(null); setRelatedTask(null); setQuotePicker(false); setPreview(null); setSyncResult(null); setSyncProgress(''); }, [scope]);
  useEffect(() => {
    const abort = new AbortController(); setLoading(true);
    void Promise.allSettled([listSupplierDirectory(abort.signal), listSupplyQualifications(undefined,undefined,abort.signal), canTasks ? listProcTasks(abort.signal) : Promise.resolve([])]).then(([suppliers, qualifications, tasks]) => {
      if (abort.signal.aborted) return;
      setStored({ scope, suppliers: suppliers.status === 'fulfilled' ? suppliers.value.suppliers : [], qualifications: qualifications.status === 'fulfilled' ? qualifications.value : null, tasks: tasks.status === 'fulfilled' ? tasks.value : [], errors: [suppliers,qualifications,tasks].flatMap((result,index) => result.status === 'rejected' ? [`${['供应商档案','供货资格','关联任务'][index]}：${result.reason instanceof Error ? result.reason.message : '加载失败'}`] : []) }); setLoading(false);
    });
    return () => abort.abort();
  }, [scope, revision, rows, canTasks]);
  const groups = useMemo(() => {
    const grouped = buildQuoteBookDirectory(rows);
    const profiles = new Map((data?.suppliers || []).map(s => [s.id,s]));
    for (const profile of profiles.values()) if (!grouped.some(g => g.supplierId === profile.id)) grouped.push({ key:`supplier:${JSON.stringify(profile.id)}`, supplierId:profile.id, name:profile.name, supplier:profile, relation:profile.enabled?'linked':'disabled', entries:[], materialCount:0, quoteNames:[] });
    return grouped.map(g => ({ ...g, name: profiles.get(g.supplierId || "")?.name || g.name, profile: g.supplierId ? profiles.get(g.supplierId) : undefined })).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
  }, [rows,data]);
  const suppliers = groups.filter(g => [g.name,g.profile?.tpCode,g.profile?.shortName].some(value => normalized(value || '').includes(normalized(supplierSearch))) && (supplierStatus==='all' || (supplierStatus==='enabled' ? g.profile?.enabled !== false : g.profile?.enabled === false)));
  const supplierPages = Math.max(1,Math.ceil(suppliers.length / DIRECTORY_SUPPLIER_PAGE_SIZE)); const sPage = Math.min(supplierPage,supplierPages);
  const selected = suppliers.find(g=>g.key===selectedKey) || suppliers[(sPage-1)*DIRECTORY_SUPPLIER_PAGE_SIZE];
  const profile = selected?.profile;
  const [filterScope,setFilterScope] = useState<string>();
  if(filterScope !== selected?.key){setFilterScope(selected?.key);setMaterialSearch('');setCategory('');setStatus('');setMaterialPage(1);setSelectedMaterial('');setRelatedPage(1);setRelatedSearch('');setRelatedStatus('');}
  const selectSupplier = (key:string) => { setSelectedKey(key); setMaterialSearch(''); setCategory(''); setStatus(''); setMaterialPage(1); setSelectedMaterial(''); setRelatedPage(1); setRelatedSearch(''); setRelatedStatus(''); };
  const entries = selected ? filterSupplierMaterials(selected.entries,materialSearch,category).filter(e=>!status || (e.quote.source!=='tplus-order' && e.quote.tiers.length>0 && (status==='expired' ? directoryQuoteExpired(e.quote,today) : !directoryQuoteExpired(e.quote,today)))) : [];
  const materialPages = Math.max(1,Math.ceil(entries.length / DIRECTORY_QUOTE_PAGE_SIZE)); const mPage = Math.min(materialPage,materialPages);
  const materialOptions = [...new Map(selected?.entries.map(e=>[e.material.id,e.material]) || []).values()];
  const focusMaterial = materialOptions.find(m=>m.id===selectedMaterial) || materialOptions[0];
  const qualifications = (data?.qualifications?.relations || []).filter(r=>r.materialId===focusMaterial?.id);
  const eligibleSuppliers = qualifications.filter(r=>r.effectiveStatus==='approved');
  const related = useMemo(()=> {
    if (!selected) return [];
    const materialIds = new Set(selected.entries.map(e=>e.material.id)); const seen = new Set<string>();
    return (data?.tasks || []).filter(task=>task.materialId && materialIds.has(task.materialId)).flatMap(task=> {
      const demand = { id:`task:${task.id}`, task, code:task.code, type:task.businessLine==='rd'?'研发需求':'采购需求', name:task.rdTaskTitle || task.materialName, quantity:task.quantity, date:task.needDate || '', status:task.status, label:PROC_STATUS_META[task.status].label };
      const orders = task.purchaseOrders.filter(order=>Boolean(order.tpOrderNo) && normalized(order.supplierName)===normalized(selected.name) && groups.filter(g=>normalized(g.name)===normalized(selected.name)).length===1).flatMap(order=> {
        const key=JSON.stringify([order.tpOrderId || order.tpOrderNo,order.tpLineNo || task.materialId]); if(seen.has(key)) return []; seen.add(key);
        return [{ id:`order:${key}`,task, code:order.tpOrderNo,type:'采购订单',name:task.rdTaskTitle || task.materialName,quantity:order.orderedQty,date:order.etaDate || '',status:order.receivedQty>=order.orderedQty?'completed':'in_transit',label:order.receivedQty>=order.orderedQty?'已到货':'已下单' }];
      });
      return [demand,...orders];
    });
  },[selected,data,groups]);
  const filteredRelated=related.filter(r=>(!relatedStatus || r.status===relatedStatus) && normalized([r.code,r.name,r.task.materialName].join(' ')).includes(normalized(relatedSearch)));
  const relatedPages=Math.max(1,Math.ceil(filteredRelated.length/8)); const rPage=Math.min(relatedPage,relatedPages);
  const quoteSuppliers = groups.filter(g => g.supplierId && (g.profile ?? g.supplier)?.enabled !== false && g.relation !== 'conflict');
  const selectedQuoteSuppliers = quoteSuppliers.filter(g => quoteSupplierSelected.includes(g.supplierId!));
  const filteredQuoteSuppliers = quoteSuppliers.filter(g => [g.name,g.profile?.tpCode,g.profile?.shortName,g.profile?.tags].some(value => normalized(value || '').includes(normalized(quoteSupplierSearch))) && (!quoteSupplierSource || (quoteSupplierSource === 'tplus' ? ['tplus','tplus-order'].includes((g.profile ?? g.supplier)?.source || '') : (g.profile ?? g.supplier)?.source === quoteSupplierSource)));
  const quoteSupplierPages = Math.max(1,Math.ceil(filteredQuoteSuppliers.length / 10)), qsPage = Math.min(quoteSupplierPage,quoteSupplierPages);
  const visibleQuoteSuppliers = filteredQuoteSuppliers.slice((qsPage-1)*10,qsPage*10);
  const supplierQuoteCount = (material: QuoteBookRow) => selectedQuoteSuppliers.filter(s => material.quotes.some(q => q.supplierId === s.supplierId)).length;
  const hasSupplierQuote = (material: QuoteBookRow) => selectedQuoteSuppliers.length > 0 && supplierQuoteCount(material) === selectedQuoteSuppliers.length;
  const quoteRows = rows.filter(m => [m.name,m.spec,m.tpInventoryCode,m.erpCode].some(value => normalized(value || '').includes(normalized(quoteSearch))) && (!quoteCategory || m.category === quoteCategory) && (!quoteStatus || (quoteStatus === 'quoted' ? hasSupplierQuote(m) : !hasSupplierQuote(m))));
  const quotePages = Math.max(1,Math.ceil(quoteRows.length / 10));
  const qPage = Math.min(quotePage,quotePages);
  const visibleQuotes = quoteRows.slice((qPage-1)*10,qPage*10);
  const selectedQuoteRows = rows.filter(m => quoteSelected.includes(m.id));
  const toggleQuote = (id: string, checked: boolean) => setQuoteSelected(current => checked ? [...new Set([...current,id])] : current.filter(value => value !== id));
  const reload=()=>{setRevision(n=>n+1);onReload?.();};
  const sync=async()=>{setSyncing(true);setSyncResult(null);setSyncProgress(t('正在开始同步…'));try{
    const {jobId}=await syncTplusQuoteBook();
    const result=await waitApplyJob<QuoteBookSyncResult>(jobId,setSyncProgress,getTplusSyncJob);
    setSyncResult({...result,scope});
    if(result.failed||result.quoteBook.conflicts.length||result.warnings.length) toast.warning(t('同步完成，部分记录需要核对'));
    else toast.success(t('ERP供应商与订单物料同步完成'));
    reload();
  }catch(cause){toast.error(cause instanceof Error?cause.message:t('同步失败'));reload();}finally{setSyncing(false);setSyncProgress('');}};
  const openRelated=(task:ProcurementTask)=>setRelatedTask(task);
  const setRole=async(supplierId:string,materialId:string,role:string)=>{setRoleBusy(true);try{await saveSupplierMaterialRole(supplierId,materialId,role);setRevision(n=>n+1);}catch(cause){toast.error(cause instanceof Error?cause.message:t('更新失败'));}finally{setRoleBusy(false);}};  return <div className="proc-supplier-directory qb-workspace">
    <div className="qb-top-actions"><div>{can('proc:sync-erp')&&<Button variant="outline" disabled={loading||syncing} onClick={()=>void sync()}><RefreshCw className="size-4" />{t(syncing?'同步中…':'同步 ERP 档案与订单')}</Button>}{canWrite&&<Button disabled={loading||syncing} onClick={()=>setEditor('new')}><Plus className="size-4" />{t('新增供应商')}</Button>}<Button variant="outline" disabled={loading||syncing} aria-label={t('刷新供应商目录')} onClick={reload}><RefreshCw className="size-4" />{t('刷新')}</Button></div></div>
    {syncProgress&&<p role="status" className="qb-notice">{syncProgress}</p>}
    {syncResult?.scope===scope&&<div role="status" className="qb-notice"><p>{t('供应商档案 {count} 条；订单 {orders} 张；新增供应商 {suppliers} 个、物料 {materials} 个、报价关系 {quotes} 条',{count:syncResult.upserted,orders:syncResult.orders,suppliers:syncResult.quoteBook.suppliersCreated,materials:syncResult.quoteBook.materialsCreated,quotes:syncResult.quoteBook.quotesCreated})}</p>{!!syncResult.failed&&<p>{t('{count} 张订单读取失败，请重试同步',{count:syncResult.failed})}</p>}{[...syncResult.warnings,...syncResult.quoteBook.conflicts].length>0&&<details><summary>{t('查看需核对记录')}（{syncResult.warnings.length+syncResult.quoteBook.conflicts.length}）</summary><ul className="max-h-48 overflow-auto">{[...syncResult.warnings,...syncResult.quoteBook.conflicts].map((message,index)=><li key={index}>{message}</li>)}</ul></details>}</div>}
    {loading&&<p role="status" className="qb-notice">{t('正在读取供应商、供货资格与关联单据…')}</p>}
    {data?.errors.map(message=><div role="alert" key={message} className="qb-notice text-destructive">{message}<Button size="sm" variant="outline" onClick={reload}>{t('重试')}</Button></div>)}
    <div className="qb-layout">
      <aside className="material-card qb-suppliers" aria-label={t('供应商列表')}><div className="qb-section-head"><h2 className="text-balance">{t('供应商列表')}</h2><span className="qb-count tabular-nums">{suppliers.length}</span></div><div className="qb-filters"><Input aria-label={t('搜索供应商名称')} placeholder={t('搜索名称 / ERP 编码')} value={supplierSearch} onChange={e=>{setSupplierSearch(e.target.value);setSupplierPage(1);selectSupplier('');}}/><NativeSelect aria-label={t('供应商状态')} value={supplierStatus} onChange={e=>{setSupplierStatus(e.target.value);setSupplierPage(1);selectSupplier('');}}><option value="all">{t('全部供应商')}</option><option value="enabled">{t('启用')}</option><option value="disabled">{t('停用')}</option></NativeSelect></div>
        <ul key={`${sPage}:${supplierSearch}:${supplierStatus}`} className="qb-supplier-list">{suppliers.slice((sPage-1)*DIRECTORY_SUPPLIER_PAGE_SIZE,sPage*DIRECTORY_SUPPLIER_PAGE_SIZE).map(g=><li key={g.key}><Button variant="unstyled" type="button" aria-pressed={g.key===selected?.key} onClick={()=>selectSupplier(g.key)} className="qb-supplier-choice"><span className="qb-avatar">{g.name.slice(0,1)}</span><span><strong>{g.name}</strong><span className="qb-supplier-meta"><small>{g.profile?.tpCode || t(supplierSourceLabel(g.profile?.source))}</small><small>{t('{count} 个物料',{count:g.materialCount})}</small></span></span><ChevronRight className="size-4 shrink-0"/></Button></li>)}</ul>
        {!loading&&!suppliers.length&&<p className="qb-empty">{t('暂无匹配供应商，可同步 ERP 或新增供应商。')}</p>}{supplierPages>1&&<Pager page={sPage} pages={supplierPages} onPage={n=>{setSupplierPage(n);selectSupplier('');}} label={t('供应商列表')}/>}
      </aside>
      <div className="qb-main">{selected?<>
        <section className="material-card qb-info" aria-label={t('供应商信息')}><div className="qb-section-head"><h2 className="text-balance">{t('供应商信息')}</h2>{canWrite&&profile&&<Button size="sm" variant="outline" disabled={loading} onClick={()=>setEditor(profile)}><Pencil className="size-4"/>{t('编辑信息')}</Button>}</div><div className="qb-profile"><span className="qb-avatar qb-avatar-large">{selected.name.slice(0,1)}</span><div className="qb-profile-name"><h3 className="text-balance">{selected.name}<span className="qb-badge">{t(profile ? (profile.enabled?'启用':'停用') : '档案待关联')}</span></h3><p>{profile?.description || t('简介未填写')}</p><div className="qb-tags">{profile?.tags?.split(/[、,，]/).filter(Boolean).map(tag=><span key={tag}>{tag}</span>)}</div></div><dl className="qb-profile-facts">{[['合作开始',profile?.cooperationStart],['合作年限',profile?.cooperationStart?`${Math.max(0,Math.floor((Number(today.slice(0,4))*12+Number(today.slice(5,7))-Number(profile.cooperationStart.slice(0,4))*12-Number(profile.cooperationStart.slice(5,7)))/12))} 年`:null],['主要供货范围',profile?.supplyScope],['经办人',profile?.owner],['供应商等级',profile?.grade?`${profile.grade} 级`:null]].map(([label,value])=><div key={label}><dt>{t(label!)}</dt><dd>{value||t('未填写')}</dd></div>)}</dl></div><div className="qb-contact">{[['档案来源',supplierSourceLabel(profile?.source)],['ERP 编码',profile?.tpCode],['联系人',profile?.contact],['电话',profile?.phone],['邮箱',profile?.email],['地址',profile?.address]].map(([label,value])=><span key={label}>{t(label!)}：<strong>{value||'—'}</strong></span>)}</div></section>
        <section className="material-card qb-materials" aria-label={t('物料清单')}><div className="qb-section-head"><h2 className="text-balance">{t('物料清单')}</h2><div className="qb-actions">{onCreate&&<Button size="sm" variant="outline" onClick={()=>onCreate?.(selected?.name,selected?.supplierId)}><Plus className="size-4"/>{t('新增物料')}</Button>}{canWrite&&<Button size="sm" variant="outline" onClick={()=>{openQuotePicker();}}>{t('录入报价')}</Button>}{canWrite&&onImport&&<><Button size="sm" variant="outline" onClick={onImport}><Upload className="size-4"/>{t('导入物料/供应商')}</Button><Button size="sm" variant="outline" onClick={onImport}><ScanLine className="size-4"/>{t('智能识别单据')}</Button></>}</div></div>
          <div className="qb-material-filters"><Input aria-label={t('搜索当前供应商的物料')} placeholder={t('搜索物料编码 / 名称 / 规格')} value={materialSearch} onChange={e=>{setMaterialSearch(e.target.value);setMaterialPage(1);}}/><NativeSelect aria-label={t('物料分类')} value={category} onChange={e=>{setCategory(e.target.value);setMaterialPage(1);}}><option value="">{t('全部分类')}</option>{[...new Set(selected.entries.map(e=>e.material.category).filter(Boolean))].map(c=><option key={c}>{c}</option>)}</NativeSelect><NativeSelect aria-label={t('报价状态')} value={status} onChange={e=>{setStatus(e.target.value);setMaterialPage(1);}}><option value="">{t('全部状态')}</option><option value="valid">{t('报价有效')}</option><option value="expired">{t('报价过期')}</option></NativeSelect></div>
          <div className="qb-table-scroll"><table aria-label={t('供应商物料清单')}><thead><tr>{['物料编码','物料名称','规格 / 版本','采购单位','MOQ','参考交期','报价附件','状态','操作'].map(label=><th key={label}>{t(label)}</th>)}</tr></thead><tbody>{entries.slice((mPage-1)*DIRECTORY_QUOTE_PAGE_SIZE,mPage*DIRECTORY_QUOTE_PAGE_SIZE).map(({key,material,quote})=><tr key={key} aria-selected={focusMaterial?.id===material.id} onClick={()=>setSelectedMaterial(material.id)}><td>{material.tpInventoryCode||material.erpCode||'—'}</td><td><Button variant="unstyled" className="qb-text-button" onClick={()=>{setSelectedMaterial(material.id);onCompare(material);}}>{material.name}</Button></td><td>{material.spec||'—'}</td><td>{material.unit||'—'}</td><td>{quote.tiers.length?Math.min(...quote.tiers.map(tier=>tier.minQty)).toLocaleString():'—'}</td><td>{quote.leadTimeDays?`${quote.leadTimeDays} ${t('天')}`:'—'}</td><td>{quote.imageUrl?<Button size="sm" variant="outline" aria-label={`${material.name} ${t('报价附件')}`} onClick={()=>setPreview(quote.imageUrl!)}><FileText className="size-4"/>1</Button>:'—'}</td><td><span className="qb-badge">{t(!quote.tiers.length?'待补报价':directoryQuoteExpired(quote,today)?'报价过期':quote.source==='tplus-order'?'订单参考价':'报价有效')}</span></td><td><div className="qb-actions"><Button size="sm" variant="ghost" onClick={()=>onCompare(material)}>{t('查看')}</Button>{canWrite&&<Button size="sm" variant="ghost" onClick={()=>onEdit(material,quote)}>{t('编辑')}</Button>}</div></td></tr>)}</tbody></table></div>{!entries.length&&<div className="qb-empty"><p>{t('暂无匹配物料，请调整筛选或录入报价。')}</p>{canWrite&&<Button size="sm" variant="link" onClick={()=>{openQuotePicker();}}>{t('为该供应商录入报价')}</Button>}</div>}<div className="qb-table-footer"><span>{t('共 {count} 条报价',{count:entries.length})}</span>{materialPages>1&&<Pager page={mPage} pages={materialPages} onPage={setMaterialPage} label={t('物料清单')}/>}</div>
        </section>
      <aside className="material-card qb-qualified" aria-label={t('物料对应多个合格供应商')}><div className="qb-section-head"><h2 className="text-balance">{t('物料对应多个合格供应商')}</h2></div><div className="qb-filters"><NativeSelect disabled={!materialOptions.length} aria-label={t('选择关联物料')} value={focusMaterial?.id||''} onChange={e=>setSelectedMaterial(e.target.value)}><option value="" disabled>{t('选择物料')}</option>{materialOptions.map(m=><option key={m.id} value={m.id}>{m.name} · {m.spec||m.tpInventoryCode||m.erpCode||t('规格未填写')}</option>)}</NativeSelect></div><div className="qb-qualified-list">{eligibleSuppliers.map(relation=><div key={relation.id} className="qb-qualified-item"><span className="qb-avatar">{relation.supplierName.slice(0,1)}</span><div><strong>{relation.supplierName}</strong><span className="qb-badge">{t(({primary:"主供",alternative:"候选"} as Record<string,string>)[data?.suppliers.find(s=>s.id===relation.supplierId)?.materialRoles?.[relation.materialId] || ""] || "未指定")}</span><span className="qb-badge">{t('有效')}</span><p>{relation.products.map(p=>p.name).join('、')||t('适用范围见供货资格')}</p><small>{relation.effectiveFrom} — {relation.effectiveUntil||t('长期有效')}</small>{canWrite&&<NativeSelect aria-label={`${relation.supplierName} ${t("供货角色")}`} disabled={roleBusy||loading} value={data?.suppliers.find(s=>s.id===relation.supplierId)?.materialRoles?.[relation.materialId]||""} onChange={e=>void setRole(relation.supplierId,relation.materialId,e.target.value)}><option value="">{t("未指定")}</option><option value="primary">{t("主供")}</option><option value="alternative">{t("候选")}</option></NativeSelect>}{onQualifications&&<Button size="sm" variant="link" onClick={()=>onQualifications(relation.materialId,relation.supplierId)}>{t('查看供货资格')}</Button>}</div></div>)}{!eligibleSuppliers.length&&<p className="qb-empty">{t(loading?'正在读取…':!focusMaterial?'选择供应商并录入物料报价后，可查看对应的合格供应商。':'暂无有效的合格供应商记录')}</p>}{qualifications.filter(r=>r.effectiveStatus!=='approved').map(r=><p className="qb-qualification-note" key={r.id}>{r.supplierName} · {t(SUPPLY_QUALIFICATION_LABELS[r.effectiveStatus]||r.effectiveStatus)}</p>)}</div><p className="qb-qualification-note">{t('物料可关联多个合格供应商，以已审核且在有效期内的供货资格为准。')}</p>{focusMaterial&&selected?.supplierId&&onQualifications&&<Button variant="outline" className="m-4" onClick={()=>onQualifications(focusMaterial.id,selected.supplierId!)}>{t('管理供货关系')}</Button>}</aside>
        <section className="material-card qb-related" aria-label={t('关联需求/订单')}><div className="qb-section-head"><h2 className="text-balance">{t('关联需求/订单')}</h2><span>{t('按关联物料展示权限范围内的需求与订单')}</span></div><div className="qb-material-filters qb-related-filters"><Input aria-label={t('搜索关联需求订单')} placeholder={t('搜索需求单号 / 订单号 / 项目名称')} value={relatedSearch} onChange={e=>{setRelatedSearch(e.target.value);setRelatedPage(1);}}/><NativeSelect aria-label={t('关联单据状态')} value={relatedStatus} onChange={e=>{setRelatedStatus(e.target.value);setRelatedPage(1);}}><option value="">{t('全部状态')}</option>{[...new Map(related.map(r=>[r.status,r.label])).entries()].map(([value,label])=><option key={value} value={value}>{t(label)}</option>)}</NativeSelect></div><div className="qb-table-scroll"><table aria-label={t('关联需求与订单列表')}><thead><tr>{['单号','类型','项目名称','物料','需求数量','需求 / 到货日期','状态','操作'].map(label=><th key={label}>{t(label)}</th>)}</tr></thead><tbody>{filteredRelated.slice((rPage-1)*8,rPage*8).map(r=><tr key={r.id}><td>{r.code||'—'}</td><td>{t(r.type)}</td><td>{r.name}</td><td>{r.task.materialName}</td><td>{r.quantity} {r.task.unit}</td><td>{r.date||'—'}</td><td><span className="qb-badge">{t(r.label)}</span></td><td><Button variant="ghost" size="sm" onClick={()=>openRelated(r.task)}>{t('查看')}</Button></td></tr>)}</tbody></table></div>{!filteredRelated.length&&<p className="qb-empty">{t(canTasks?'暂无匹配的关联需求或订单':'当前账号没有采购任务读取权限')}</p>}<div className="qb-table-footer"><span>{t('共 {count} 条',{count:filteredRelated.length})}</span>{relatedPages>1&&<Pager page={rPage} pages={relatedPages} onPage={setRelatedPage} label={t('关联需求订单')}/>}</div></section>
      </>:<section className="material-card qb-empty">{t('选择供应商查看信息与物料清单。')}</section>}</div>

    </div>
    {editor&&<SupplierEditor key={scope} profile={editor==='new'?null:editor} onClose={()=>setEditor(null)} onSaved={reload}/>}
    {quotePicker&&<Dialog open onOpenChange={setQuotePicker}><DialogContent className="proc-supplier-directory qb-quote-picker max-h-[90dvh] overflow-y-auto sm:max-w-4xl"><DialogHeader><DialogTitle>{t('选择供应商与物料')}</DialogTitle><DialogDescription>{t('供应商和物料均可跨页多选。按供应商 × 物料逐项填写，各自保存价格、交期和条款；已有报价会进入编辑。')}</DialogDescription></DialogHeader>
      <section aria-label={t('报价供应商选择')} className="space-y-3"><h3 className="text-sm font-semibold">{t('1. 选择供应商')}</h3>
        <div className="grid gap-2 sm:grid-cols-2"><Input aria-label={t('筛选报价供应商')} placeholder={t('搜索名称 / ERP 编码 / 简称 / 标签')} value={quoteSupplierSearch} onChange={e=>{setQuoteSupplierSearch(e.target.value);setQuoteSupplierPage(1);}}/><NativeSelect aria-label={t('筛选报价供应商来源')} value={quoteSupplierSource} onChange={e=>{setQuoteSupplierSource(e.target.value);setQuoteSupplierPage(1);}}><option value="">{t('全部来源')}</option><option value="tplus">{t('ERP 供应商')}</option><option value="local">{t('本地供应商')}</option></NativeSelect></div>
        <div className="qb-table-scroll" style={{maxHeight:'24dvh'}}><table aria-label={t('选择报价供应商')}><thead><tr><th><Checkbox aria-label={t('选择本页供应商')} checked={visibleQuoteSuppliers.length>0&&visibleQuoteSuppliers.every(g=>quoteSupplierSelected.includes(g.supplierId!)) ? true : visibleQuoteSuppliers.some(g=>quoteSupplierSelected.includes(g.supplierId!)) ? 'indeterminate' : false} disabled={!visibleQuoteSuppliers.length} onCheckedChange={checked=>setQuoteSupplierSelected(current=>checked===true?[...new Set([...current,...visibleQuoteSuppliers.map(g=>g.supplierId!)])]:current.filter(id=>!visibleQuoteSuppliers.some(g=>g.supplierId===id)))}/></th>{['供应商名称','ERP 编码 / 档案','来源'].map(label=><th key={label}>{t(label)}</th>)}</tr></thead><tbody>{visibleQuoteSuppliers.map(g=><tr key={g.key}><td><Checkbox aria-label={`${t('选择供应商')}${g.name}（${g.supplierId}）`} checked={quoteSupplierSelected.includes(g.supplierId!)} onCheckedChange={checked=>setQuoteSupplierSelected(current=>checked===true?[...new Set([...current,g.supplierId!])]:current.filter(id=>id!==g.supplierId))}/></td><td>{g.name}</td><td>{g.profile?.tpCode||g.supplierId}</td><td>{t(supplierSourceLabel((g.profile??g.supplier)?.source))}</td></tr>)}</tbody></table></div>
        {!filteredQuoteSuppliers.length&&<p className="qb-empty">{t('没有匹配的启用供应商，请调整筛选或维护供应商档案。')}</p>}
        <div className="qb-table-footer"><span role="status">{t('已选 {count} 家供应商',{count:selectedQuoteSuppliers.length})}</span><Button variant="ghost" onClick={()=>setQuoteSupplierSelected([])}>{t('清空已选供应商')}</Button><Pager page={qsPage} pages={quoteSupplierPages} onPage={setQuoteSupplierPage} label={t('报价供应商选择')}/></div>
      </section><h3 className="text-sm font-semibold">{t('2. 选择物料')}</h3>
      <div className="grid gap-2 sm:grid-cols-3"><Input aria-label={t('筛选报价物料')} placeholder={t('搜索编码 / 名称 / 规格')} value={quoteSearch} onChange={e=>{setQuoteSearch(e.target.value);setQuotePage(1);}}/><NativeSelect aria-label={t('筛选报价物料分类')} value={quoteCategory} onChange={e=>{setQuoteCategory(e.target.value);setQuotePage(1);}}><option value="">{t('全部分类')}</option>{[...new Set(rows.map(m=>m.category).filter(Boolean))].map(c=><option key={c}>{c}</option>)}</NativeSelect><NativeSelect aria-label={t('筛选供应商报价状态')} value={quoteStatus} onChange={e=>{setQuoteStatus(e.target.value);setQuotePage(1);}}><option value="">{t('全部报价状态')}</option><option value="quoted">{t('已选供应商全部已报价')}</option><option value="missing">{t('已选供应商尚有未报价')}</option></NativeSelect></div>
      <div className="qb-table-scroll"><table aria-label={t('选择报价物料')}><thead><tr><th><Checkbox aria-label={t('选择本页物料')} checked={visibleQuotes.length>0&&visibleQuotes.every(m=>quoteSelected.includes(m.id)) ? true : visibleQuotes.some(m=>quoteSelected.includes(m.id)) ? 'indeterminate' : false} disabled={!visibleQuotes.length} onCheckedChange={checked=>setQuoteSelected(current=>checked===true?[...new Set([...current,...visibleQuotes.map(m=>m.id)])]:current.filter(id=>!visibleQuotes.some(m=>m.id===id)))}/></th>{['物料编码','物料名称','规格','分类','单位','报价状态'].map(label=><th key={label}>{t(label)}</th>)}</tr></thead><tbody>{visibleQuotes.map(m=><tr key={m.id}><td><Checkbox aria-label={`${t('选择')}${m.name}`} checked={quoteSelected.includes(m.id)} onCheckedChange={checked=>toggleQuote(m.id,checked===true)}/></td><td>{m.tpInventoryCode||m.erpCode||'—'}</td><td>{m.name}</td><td>{m.spec||'—'}</td><td>{m.category||'—'}</td><td>{m.unit||'—'}</td><td>{t('{quoted} / {total} 家已报价',{quoted:supplierQuoteCount(m),total:selectedQuoteSuppliers.length})}</td></tr>)}</tbody></table></div>
      {!quoteRows.length&&<p className="qb-empty">{t('没有匹配物料，请调整筛选或新增物料。')}</p>}
      <div className="qb-table-footer"><span role="status">{t('共 {count} 条，已选 {selected} 条',{count:quoteRows.length,selected:selectedQuoteRows.length})}</span><Button variant="ghost" onClick={()=>setQuoteSelected([])}>{t('清空已选')}</Button><Pager page={qPage} pages={quotePages} onPage={setQuotePage} label={t('报价物料选择')}/></div>
      <DialogFooter>{onCreate&&<Button variant="outline" onClick={()=>{setQuotePicker(false);onCreate(selected?.name,selected?.supplierId,selectedQuoteSuppliers.map(g=>({id:g.supplierId!,name:g.name}))); }}>{t('新增物料')}</Button>}<Button variant="outline" onClick={()=>setQuotePicker(false)}>{t('取消')}</Button><span role="status" className="text-sm text-muted-foreground">{t('共 {count} 项报价',{count:selectedQuoteRows.length*selectedQuoteSuppliers.length})}</span><Button disabled={!selectedQuoteRows.length||!selectedQuoteSuppliers.length} onClick={()=>{setQuotePicker(false);onEditMany(selectedQuoteRows,selectedQuoteSuppliers.map(g=>({id:g.supplierId!,name:g.name})));}}>{t('继续录入')}</Button></DialogFooter>
    </DialogContent></Dialog>}

    {relatedTask&&<TaskDetailDrawer key={relatedTask.id} task={relatedTask} readOnly onClose={()=>setRelatedTask(null)}/>}
    {preview&&<ImageLightbox url={preview} onClose={()=>setPreview(null)}/>}
  </div>;
}
