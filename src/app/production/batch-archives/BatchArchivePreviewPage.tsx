import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useBlocker, useSearchParams } from 'react-router';
import { AlertCircle, ArrowRight, CheckCircle2, Circle, Download, FileClock, FileText, FolderArchive, History, Plus, RotateCcw, Search } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../../components/ui/alert-dialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../../components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { i18nLocale, useI18n } from '../../lib/i18n';
import { OrderEmptyState, OrderPageHeader } from '../../order-processing/components/HorizonPage';
import { BatchArchiveSections } from './BatchArchiveSections';
import { VersionEvidenceForm } from './VersionEvidenceForm';
import { applyVersionAmendment, buildBatchArchiveCsv, createBatchArchiveState, getArchiveGaps, getArchiveSummary } from './batchArchiveModel';
import { archiveDocumentLabels, archiveTabLabels, archiveVersionLabels, type ArchiveDocument, type ArchiveTab, type ArchiveVersionScope, type VersionAmendment } from './batchArchiveTypes';
import '../../order-processing/horizon.css';
import './batch-archive-preview.css';
import { Checkbox } from "../../components/ui/checkbox";

type Scenario = 'normal' | 'readonly' | 'empty' | 'error';
type Drawer = { kind: 'document'; id: string } | { kind: 'revisions' } | null;
const tabs = Object.keys(archiveTabLabels) as ArchiveTab[];
export function BatchArchivePreviewPage() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const [state, setState] = useState(createBatchArchiveState);
  const stateRef = useRef(state);
  const [scenario, setScenario] = useState<Scenario>('normal');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<{ scopeId?: string } | null>(null);
  const [generation, setGeneration] = useState(0);
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [flash, setFlash] = useState('');
  const [error, setError] = useState('');
  const [failNext, setFailNext] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const internalNavigation = useRef(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const pendingAction = useRef<(() => void) | null>(null);
  const markDirty = useCallback((value: boolean) => { dirtyRef.current = value; setDirty(value); }, []);
  const blocker = useBlocker(() => !internalNavigation.current && (dirtyRef.current || busyRef.current));
  const requestedTab = params.get('tab');
  const tab: ArchiveTab = tabs.includes(requestedTab as ArchiveTab) ? requestedTab as ArchiveTab : 'versions';
  const needle = query.trim().toLocaleLowerCase();
  const matches = scenario === 'empty' ? [] : state.batches.filter((item) => [item.batchNo, item.planNo, item.productName, item.productCode, ...item.serials.map((sn) => sn.sn), ...item.materials.flatMap((material) => [material.code, material.name, material.materialBatch, ...material.serialNumbers])].join(' ').toLocaleLowerCase().includes(needle));
  const batchId = params.get('batch') ?? (matches.find((item) => item.id === 'batch-02')?.id ?? matches[0]?.id);
  const batch = matches.find((item) => item.id === batchId);
  const summary = batch ? getArchiveSummary(batch) : null;
  const gaps = batch ? getArchiveGaps(batch) : [];
  const revisions = state.revisions.filter((item) => item.batchId === batch?.id).slice().reverse();
  const document = batch && drawer?.kind === 'document' ? batch.documents.find((item) => item.id === drawer.id) : null;
  const qty = (value: number) => t('{count} 台', { count: value.toLocaleString(i18nLocale()) });
  const time = (value: string) => new Date(value).toLocaleString(i18nLocale(), { timeZone: 'Asia/Shanghai', hour12: false });

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { if (dirtyRef.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  function scrollToRegion(id: 'bap-content' | 'bap-actions') { window.document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'instant' }); }
  function resetForm() { markDirty(false); setEditing(null); setGeneration((value) => value + 1); }
  function requestChange(action: () => void) {
    if (busyRef.current) return;
    if (dirtyRef.current) { pendingAction.current = action; setDiscardOpen(true); } else action();
  }
  function location(nextTab: ArchiveTab, id?: string) {
    const next = new URLSearchParams(params); next.set('tab', nextTab);
    if (id) next.set('batch', id); else next.delete('batch');
    internalNavigation.current = true;
    try { setParams(next); } finally { internalNavigation.current = false; }
  }
  function selectBatch(id?: string) { requestChange(() => { resetForm(); setDrawer(null); setFlash(''); setError(''); location(tab, id); }); }
  function selectTab(next: ArchiveTab) { requestChange(() => { resetForm(); setFlash(''); location(next, batch?.id); }); }
  function openForm(scopeId?: string) {
    requestChange(() => {
      resetForm(); setFlash(''); setError(''); setEditing({ scopeId });
      if (window.matchMedia?.('(max-width: 999px)').matches) window.requestAnimationFrame(() => window.document.getElementById('bap-actions')?.scrollIntoView({ block: 'start' }));
    });
  }
  function resetPreview() {
    const next = createBatchArchiveState(); stateRef.current = next; setState(next); resetForm(); setScenario('normal'); setQuery(''); setDrawer(null); setFlash(''); setError(''); setFailNext(false); location('versions'); setResetOpen(false);
  }
  async function save(input: VersionAmendment) {
    if (busyRef.current) throw new Error(t('正在保存，请稍候。'));
    if (!batch || !editing || scenario !== 'normal' || input.scopeId !== editing.scopeId) throw new Error(t('当前批次或版本范围已变化，请重新打开。'));
    busyRef.current = true; setBusy(true);
    try {
      if (failNext) { setFailNext(false); throw new Error(t('演示保存失败，填写内容已保留，请重试。')); }
      const next = applyVersionAmendment(stateRef.current, batch.id, state.version, input);
      stateRef.current = next; setState(next); resetForm(); location('versions', batch.id);
      setFlash(t('版本依据已保存，修订前后内容已留档；生产、检验、放行及出货数量保持原记录。'));
    } finally { busyRef.current = false; setBusy(false); }
  }
  function exportArchive() {
    if (!batch) return;
    try {
      const csv = buildBatchArchiveCsv(state, batch.id);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement('a'); link.href = url; link.download = `${batch.batchNo}-批次档案-演示.csv`;
      window.document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setError(''); setFlash(t('已发起批次档案下载，包含当前已保存资料、待补齐项及修订历史。'));
    } catch { setError(t('档案导出失败，请重试。未保存的填写不会导出。')); }
  }
  const fact = (label: string, value: string) => <div key={label}><dt>{t(label)}</dt><dd>{value}</dd></div>;
  const status = (item: ArchiveDocument) => <span className="bap-tag" data-tone={item.tone}>{t(item.status)}</span>;
  function scopeSnapshot(scopes: ArchiveVersionScope[]) {
    return <ul className="bap-snapshots">{scopes.map((scope) => <li key={scope.id}><strong>{scope.name} · {qty(scope.quantity)}</strong><dl className="bap-facts">{Object.entries(archiveVersionLabels).map(([key, label]) => fact(label, scope.versions[key as keyof typeof scope.versions] || t('待确认')))}</dl><p>{t('已有 SN')}：{scope.serialNumbers.join('、') || t('待补齐')}</p><p>{t('依据')}：{scope.evidenceIds.map((id) => batch?.documents.find((item) => item.id === id)?.code ?? t('原单据待补齐')).join('、')}</p></li>)}</ul>;
  }
  function sidebar() {
    if (!batch || !summary) return null;
    if (editing) return <section className="bap-card bap-action-card"><p className="bap-code">{batch.batchNo} · {batch.productName}</p><VersionEvidenceForm key={`${generation}:${batch.id}:${editing.scopeId ?? 'new'}`} state={state} batchId={batch.id} scopeId={editing.scopeId} onSubmit={save} onDirtyChange={markDirty} onCancel={() => requestChange(resetForm)} /></section>;
    const stages: { label: string; kinds: ArchiveDocument['kind'][] }[] = [{ label: '派工', kinds: ['dispatch'] }, { label: '工序报工', kinds: ['production'] }, { label: '终检 / 复验', kinds: ['inspection', 'reinspection'] }, { label: '质量授权放行', kinds: ['release'] }, { label: '实际出货', kinds: ['shipment'] }];
    return <>
      <section className="bap-card bap-review-card"><div className="bap-heading"><h2>{t('档案核对')}</h2><span className="bap-muted">{t('{count} 项待核对', { count: gaps.length })}</span></div><dl className="bap-review-metrics">{fact('版本待确认', qty(summary.versionPending))}{fact('SN 待补齐', qty(summary.snMissing))}</dl>
        {scenario === 'normal' ? <Button className="bap-add-scope" onClick={() => openForm()}><Plus className="size-4" aria-hidden="true" />{t('补充版本范围')}</Button> : <p className="bap-note">{t('当前为只读查看。')}</p>}
        {gaps.length ? <ul className="bap-gap-list">{gaps.map((gap) => <li key={gap.id}><Button variant="unstyled" onClick={() => selectTab(gap.tab)}><span><strong>{t(gap.label)}</strong><small>{t(gap.detail)}</small></span><ArrowRight className="size-4" aria-hidden="true" /></Button></li>)}</ul> : <p className="bap-note">{t('已归集资料暂无待补项。仍需按原单据核对适用范围。')}</p>}
        <p className="bap-note">{t('修订只补充归档依据，不修改生产及出库记录。')}</p>
      </section>
      <section className="bap-card"><div className="bap-heading"><h2>{t('生产流程与证据')}</h2><FileClock className="size-4" aria-hidden="true" /></div><ol className="bap-timeline">{stages.map((stage) => { const docs = batch.documents.filter((item) => stage.kinds.includes(item.kind) && (item.kind !== 'shipment' || item.status === '已出库')).sort((a, b) => b.date.localeCompare(a.date)); const item = docs[0]; return <li key={stage.label}>{item?.tone === 'success' ? <CheckCircle2 className="size-4 bap-timeline-check" aria-hidden="true" /> : <Circle className="size-4" aria-hidden="true" />}<div><strong>{t(stage.label)}</strong>{item ? <><p>{item.date} · {t(item.status)}</p><Button size="sm" variant="link" onClick={() => setDrawer({ kind: 'document', id: item.id })}>{item.code}</Button></> : <p>{t('原单据待补齐')}</p>}</div></li>; })}</ol></section>
      {batch.documents.some((item) => item.kind === 'ecn') ? <section className="bap-card"><h2>{t('相关 ECN')}</h2><div className="bap-related">{batch.documents.filter((item) => item.kind === 'ecn').map((item) => <Button key={item.id} size="sm" variant="outline" onClick={() => setDrawer({ kind: 'document', id: item.id })}>{item.code}<ArrowRight className="size-3.5" aria-hidden="true" /></Button>)}</div><p className="bap-note">{t('先查看变更摘要与生效范围，再打开执行确认；历史实装版本继续保留。')}</p></section> : null}
      <section className="bap-card bap-sources"><h2>{t('资料来源')}</h2><p>{batch.sourceLabel}</p><p className="bap-muted">{t('归集时间')}：{time(batch.sourceAt)}</p><p className="bap-note">{t('此页为独立档案演示，其他预览页的本次修改不会自动同步。')}</p></section>
    </>;
  }
  return <main className="order-horizon batch-archive-preview">
    <OrderPageHeader Icon={FolderArchive} eyebrow={t('生产管理 / 转产与档案 / P09')} title={t('生产批次档案')} description={t('查看本批版本范围、物料、工序、检验及实际出货依据。')} actions={<><Button variant="outline" disabled={busy} onClick={() => requestChange(() => setResetOpen(true))}><RotateCcw className="size-4" aria-hidden="true" />{t('重置演示')}</Button><Button variant="outline" disabled={!batch || scenario === 'error'} onClick={() => setDrawer({ kind: 'revisions' })}><History className="size-4" aria-hidden="true" />{t('修订记录')}</Button><Button disabled={!batch || scenario === 'error' || busy} onClick={exportArchive}><Download className="size-4" aria-hidden="true" />{t('导出批次档案')}</Button></>} />
    <div className="bap-preview-note"><strong>{t('前端演示')}</strong><span>{t('仅归集演示单据，修订在本次预览保留；刷新后恢复。完整业务来源与逐台追溯后续接入。')}</span></div>
    <details className="bap-scenarios"><summary>{t('预览状态')}</summary><div>{(['normal', 'readonly', 'empty', 'error'] as const).map((value) => <Button key={value} size="sm" variant={scenario === value ? 'secondary' : 'outline'} aria-pressed={scenario === value} onClick={() => requestChange(() => { resetForm(); setScenario(value); setDrawer(null); setFlash(''); setError(''); location(tab); })}>{t({ normal: '正常', readonly: '只读', empty: '空数据', error: '读取失败' }[value])}</Button>)}<label><Checkbox checked={failNext} disabled={scenario !== 'normal' || busy} onCheckedChange={(checkedValue) => setFailNext((checkedValue === true))} />{t('下次保存失败')}</label></div></details>
    {flash ? <div className="bap-feedback" role="status"><CheckCircle2 className="size-4" aria-hidden="true" />{flash}</div> : null}{error ? <p className="bap-error" role="alert">{error}</p> : null}
    {scenario === 'error' ? <section className="bap-card"><OrderEmptyState Icon={AlertCircle} title={t('批次档案读取失败')} description={t('重新读取可恢复当前已保存的演示资料。')} action={<Button onClick={() => setScenario('normal')}>{t('重新读取')}</Button>} /></section> : <>
      <section className="bap-filter-bar" aria-label={t('选择生产批次')}><div><Label htmlFor="bap-query">{t('查找批次或已有 SN')}</Label><div className="bap-search"><Search className="size-4" aria-hidden="true" /><Input id="bap-query" value={query} placeholder={t('批次、SN、物料批次或计划号')} onChange={(event) => { const value = event.target.value; requestChange(() => { resetForm(); setQuery(value); setDrawer(null); setFlash(''); location(tab); }); }} /></div></div><div><Label htmlFor="bap-batch">{t('当前生产批次')}</Label><Select value={batch?.id ?? ''} onValueChange={selectBatch} disabled={!matches.length}><SelectTrigger id="bap-batch"><SelectValue placeholder={t('请选择批次')} /></SelectTrigger><SelectContent>{matches.map((item) => <SelectItem key={item.id} value={item.id}>{item.batchNo} · {item.productName}</SelectItem>)}</SelectContent></Select></div><div className="bap-filter-meta"><span>{t('{count} 个匹配批次', { count: matches.length })}</span>{query ? <Button size="sm" variant="ghost" onClick={() => requestChange(() => { resetForm(); setQuery(''); location(tab); })}>{t('清除筛选')}</Button> : null}</div></section>
      {batch && summary ? <>
        <div className="bap-batch-context"><strong>{batch.batchNo}</strong><span>{batch.productName} · {batch.productCode}</span><span>{t('关联计划')} {batch.planNo}</span><span>{batch.line}</span></div>
        <dl className="bap-metrics">{[['本批整机完工', summary.completed, '来自生产完工记录'], ['终检合格', summary.inspected, '复验不与初检重复相加'], ['已授权放行', summary.released, '需独立质量授权依据'], ['已实际出货', summary.shipped, '仅统计有效已出库单']].map(([label, value, note]) => <div key={String(label)}><dt>{t(String(label))}</dt><dd>{qty(Number(value))}</dd><p>{t(String(note))}</p></div>)}</dl>
        <Tabs value={tab} onValueChange={(value) => selectTab(value as ArchiveTab)}><TabsList className="bap-tabs" aria-label={t('批次资料分类')}>{tabs.map((value) => <TabsTrigger key={value} value={value}>{t(archiveTabLabels[value])}</TabsTrigger>)}</TabsList><div className="bap-mobile-jump"><Button variant="unstyled" type="button" onClick={() => scrollToRegion('bap-content')}>{t('查看当前资料')}</Button><Button variant="unstyled" type="button" onClick={() => scrollToRegion('bap-actions')}>{t('前往核对与修订')}</Button></div><div className="bap-workspace"><TabsContent value={tab} className="bap-card bap-content"><div id="bap-content"><BatchArchiveSections batch={batch} tab={tab} onViewDocument={(id) => setDrawer({ kind: 'document', id })} onEditScope={openForm} readOnly={scenario !== 'normal'} /></div></TabsContent><aside id="bap-actions" aria-label={t('档案核对与修订')} className="bap-sidebar"><Button variant="unstyled" type="button" className="bap-back" onClick={() => scrollToRegion('bap-content')}>{t('返回当前资料')}</Button>{sidebar()}</aside></div></Tabs>
      </> : <section className="bap-card"><OrderEmptyState Icon={Search} title={t(scenario === 'empty' ? '暂无生产批次档案' : params.has('batch') ? '未找到这个批次' : '没有匹配的批次或 SN')} description={t('仅查询已归集的批次与现有 SN；未采集的号码不会生成追溯结果。')} action={<Button variant="outline" onClick={() => { setQuery(''); setScenario('normal'); selectBatch(); }}>{t('返回演示批次')}</Button>} /></section>}
    </>}
    <Sheet open={Boolean(drawer)} onOpenChange={(open) => { if (!open) setDrawer(null); }}><SheetContent className="bap-sheet"><SheetHeader><SheetTitle>{t(drawer?.kind === 'revisions' ? '档案修订记录' : '原单据摘要')}</SheetTitle><SheetDescription>{t(drawer?.kind === 'revisions' ? '查看本批版本范围的修订前后内容；历史实际版本保留。' : '演示单据的归集内容。正式文件与来源授权尚未接入。')}</SheetDescription></SheetHeader>{drawer?.kind === 'document' ? document ? <div className="bap-sheet-body"><div className="bap-heading"><h2>{document.code}</h2>{status(document)}</div><p className="bap-note">{document.title}</p>{document.kind === 'ecn' && document.code === 'ECN-202609-003' ? <Link className="bap-ecn-link" to="/__preview/ecn?ecn=ecn-01">{t('打开 ECN 变更与执行确认')}<ArrowRight className="size-4" aria-hidden="true" /></Link> : null}<dl className="bap-facts">{fact('单据类型', t(archiveDocumentLabels[document.kind]))}{fact('业务日期', document.date)}{fact('经办 / 责任人', document.actor || t('待确认'))}{fact('记录数量', document.quantity === null ? t('待确认') : `${document.quantity.toLocaleString(i18nLocale())} ${document.unit}`)}{document.facts.map((item) => fact(item.label, item.value))}</dl><p className="bap-note">{document.summary}</p><h3>{t('单据已关联 SN')}</h3>{document.serialNumbers.length ? <ul className="bap-serials">{document.serialNumbers.map((sn) => <li key={sn}>{sn}</li>)}</ul> : <p className="bap-note">{t('暂无关联 SN，不能据此推断逐台记录。')}</p>}<h3>{t('关联原单据')}</h3><div className="bap-related">{document.relatedIds.length ? document.relatedIds.map((id) => { const linked = batch?.documents.find((item) => item.id === id); return linked ? <Button key={id} size="sm" variant="outline" onClick={() => setDrawer({ kind: 'document', id })}>{linked.code}<ArrowRight className="size-3.5" aria-hidden="true" /></Button> : <span key={id} className="bap-note">{t('原单据待补齐')} · {id}</span>; }) : <p className="bap-note">{t('暂无已归集的关联单据。')}</p>}</div></div> : <OrderEmptyState Icon={FileText} title={t('原单据尚未归集')} description={t('保留来源引用，后续补齐真实单据。')} action={<Button variant="outline" onClick={() => setDrawer(null)}>{t('返回档案')}</Button>} /> : <div className="bap-sheet-body">{revisions.length ? <ol className="bap-revisions">{revisions.map((item) => <li key={item.id}><h3>{item.id}</h3><p>{item.reason}</p><p className="bap-muted">{item.actor} · {time(item.at)}</p><details><summary>{t('查看修订前')}</summary>{item.before.length ? scopeSnapshot(item.before) : <p className="bap-note">{t('此前没有归集的版本范围。')}</p>}</details><details><summary>{t('查看修订后')}</summary>{scopeSnapshot(item.after)}</details></li>)}</ol> : <OrderEmptyState Icon={History} title={t('暂无档案修订')} description={t('补充或修订版本依据后，将在此保留原因和前后内容。')} action={<Button variant="outline" onClick={() => setDrawer(null)}>{t('返回档案')}</Button>} />}</div>}</SheetContent></Sheet>
    <AlertDialog open={discardOpen || blocker.state === 'blocked'} onOpenChange={(open) => { if (!open) { setDiscardOpen(false); pendingAction.current = null; if (blocker.state === 'blocked') blocker.reset(); } }}><AlertDialogContent className="bap-dialog"><AlertDialogHeader><AlertDialogTitle>{t('放弃尚未保存的填写？')}</AlertDialogTitle><AlertDialogDescription>{t('本次版本依据填写将清空，已保存的修订记录仍然保留。')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t('继续填写')}</AlertDialogCancel><AlertDialogAction onClick={() => { const action = pendingAction.current; pendingAction.current = null; resetForm(); setDiscardOpen(false); if (blocker.state === 'blocked') blocker.proceed(); else action?.(); }}>{t('放弃并继续')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <AlertDialog open={resetOpen} onOpenChange={setResetOpen}><AlertDialogContent className="bap-dialog"><AlertDialogHeader><AlertDialogTitle>{t('恢复初始演示档案？')}</AlertDialogTitle><AlertDialogDescription>{t('本次补充的版本范围和修订记录将被清空。')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t('取消')}</AlertDialogCancel><AlertDialogAction onClick={resetPreview}>{t('重置演示数据')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </main>;
}
