import { useCallback, useEffect, useRef, useState } from 'react';
import { useBlocker, useSearchParams } from 'react-router';
import { AlertCircle, ArrowRight, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, ClipboardCheck, FileClock, FolderOpen, PackageCheck, Plus, RotateCcw, Search, Truck } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../../components/ui/alert-dialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../../components/ui/sheet';
import { cn } from '../../components/ui/utils';
import { i18nLocale, useI18n } from '../../lib/i18n';
import { OrderEmptyState, OrderPageHeader } from '../../order-processing/components/HorizonPage';
import { ShipmentActionForm } from './ShipmentActionForm';
import { applyShipmentAction, availableToShip, createShipmentState, shipmentMonthSummary } from './shipmentPreviewModel';
import { shipmentActionLabels, shipmentStatusLabels, type ShipmentAction, type ShipmentActionKind, type ShipmentBatch, type ShipmentRecord } from './shipmentTypes';
import '../../order-processing/horizon.css';
import './shipment-preview.css';
import { Checkbox } from "../../components/ui/checkbox";

type Scenario = 'normal' | 'readonly' | 'empty' | 'error';
const initialMonth = '2026-09';
const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
export function ShipmentPreviewPage() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const [state, setState] = useState(createShipmentState);
  const stateRef = useRef(state);
  const [scenario, setScenario] = useState<Scenario>('normal');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [pageNumber, setPageNumber] = useState(1);
  const [kind, setKind] = useState<ShipmentActionKind | null>(null);
  const [generation, setGeneration] = useState(0);
  const [archiveId, setArchiveId] = useState<string | null>(null);
  const [flash, setFlash] = useState('');
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const busyRef = useRef(false);
  const internalNavigation = useRef(false);
  const [busy, setBusy] = useState(false);
  const [failNext, setFailNext] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const pendingAction = useRef<(() => void) | null>(null);
  const markDirty = useCallback((value: boolean) => { dirtyRef.current = value; setDirty(value); }, []);
  const blocker = useBlocker(() => !internalNavigation.current && (dirtyRef.current || busyRef.current));
  const month = monthPattern.test(params.get('month') ?? '') ? params.get('month')! : initialMonth;
  const empty = scenario === 'empty';
  const summary = shipmentMonthSummary(empty ? { ...state, records: [] } : state, month);
  const number = (value: number | null) => value === null ? '—' : value.toLocaleString(i18nLocale());
  const qty = (value: number | null) => value === null ? '—' : t('{count} 台', { count: number(value) });
  const dateTime = (value: string) => new Date(value).toLocaleString(i18nLocale(), { timeZone: 'Asia/Shanghai', hour12: false });
  const monthRows = empty ? [] : state.records.filter((row) => row.actualDate.startsWith(month));
  const needle = query.trim().toLocaleLowerCase();
  const rows = monthRows.filter((row) => {
    const batch = state.batches.find((item) => item.id === row.batchId);
    return (status === 'all' || row.status === status) && [row.documentNo, row.customer, row.orderNo, row.handler, batch?.batchNo, batch?.productName, ...row.serialNumbers].join(' ').toLocaleLowerCase().includes(needle);
  }).sort((a, b) => b.actualDate.localeCompare(a.actualDate) || b.createdAt.localeCompare(a.createdAt));
  const pages = Math.max(1, Math.ceil(rows.length / 8));
  const selectedIndex = rows.findIndex((row) => row.id === params.get('selected'));
  const page = selectedIndex >= 0 ? Math.floor(selectedIndex / 8) + 1 : Math.min(pageNumber, pages);
  const pageRows = rows.slice((page - 1) * 8, page * 8);
  const selectedId = params.get('selected') ?? (pageRows.find((row) => row.status === 'confirmed' && row.quantity === 80)?.id ?? pageRows[0]?.id);
  const record = rows.find((row) => row.id === selectedId);
  const batch = state.batches.find((item) => item.id === record?.batchId);
  const context = kind && scenario === 'normal' && (kind === 'create' || record) ? { state, kind, recordId: kind === 'create' ? undefined : record?.id } : null;
  const archive = state.batches.find((item) => item.id === archiveId);
  const history = state.history.filter((item) => item.recordId === record?.id).slice().reverse();

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { if (dirtyRef.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  function resetForm() { markDirty(false); setKind(null); setGeneration((value) => value + 1); }
  function requestChange(action: () => void) {
    if (busyRef.current) return;
    if (dirtyRef.current) { pendingAction.current = action; setDiscardOpen(true); } else action();
  }
  function location(nextMonth: string, id?: string) {
    const next = new URLSearchParams(params); next.set('month', nextMonth);
    if (id) next.set('selected', id); else next.delete('selected');
    internalNavigation.current = true;
    try { setParams(next); } finally { internalNavigation.current = false; }
  }
  function selectRecord(id: string) {
    requestChange(() => { resetForm(); setFlash(''); location(month, id); jumpToDetail(); });
  }
  function jumpToDetail() {
    if (window.matchMedia?.('(max-width: 899px)').matches) window.requestAnimationFrame(() => document.getElementById('shp-detail')?.scrollIntoView({ block: 'start' }));
  }
  function openAction(next: ShipmentActionKind) { requestChange(() => { resetForm(); setFlash(''); setKind(next); jumpToDetail(); }); }
  function changeMonth(next: string) {
    if (!monthPattern.test(next)) return;
    requestChange(() => { resetForm(); setFlash(''); setPageNumber(1); location(next); });
  }
  function offsetMonth(amount: number) {
    const [year, value] = month.split('-').map(Number);
    const date = new Date(Date.UTC(year, value - 1 + amount, 1));
    changeMonth(date.toISOString().slice(0, 7));
  }
  function clearFilters() { requestChange(() => { resetForm(); setQuery(''); setStatus('all'); setPageNumber(1); location(month); }); }
  function resetPreview() {
    const next = createShipmentState(); stateRef.current = next; setState(next); resetForm(); setScenario('normal'); setQuery(''); setStatus('all'); setPageNumber(1); setFailNext(false); setFlash(''); setArchiveId(null); location(initialMonth); setResetOpen(false);
  }
  async function save(action: ShipmentAction) {
    if (busyRef.current) throw new Error(t('正在保存，请稍候。'));
    if (scenario !== 'normal' || !context || action.kind !== context.kind || ('recordId' in action && action.recordId !== context.recordId)) throw new Error(t('当前记录已变化，请重新打开操作。'));
    busyRef.current = true; setBusy(true);
    try {
      if (failNext) { setFailNext(false); throw new Error(t('演示保存失败，填写内容已保留，请重试。')); }
      const previous = stateRef.current;
      const next = applyShipmentAction(previous, context.state.version, action);
      const created = next.records.find((item) => !previous.records.some((old) => old.id === item.id));
      const updated = created ?? next.records.find((item) => item.id === ('recordId' in action ? action.recordId : ''));
      stateRef.current = next; setState(next); resetForm(); setStatus('all'); setQuery(''); setPageNumber(1);
      location(updated?.actualDate.slice(0, 7) ?? month, updated?.id);
      setFlash(action.kind === 'reverse' && action.createReplacement ? t('原记录已冲销，更正草稿已生成。核对并确认出库后才重新计入出货。') : t('已保存{action}演示记录。', { action: t(shipmentActionLabels[action.kind]) }));
    } finally { busyRef.current = false; setBusy(false); }
  }
  const fact = (label: string, value: string) => <div key={label}><dt>{t(label)}</dt><dd>{value}</dd></div>;
  const metric = (label: string, value: string, note: string) => <div><dt>{t(label)}</dt><dd>{value}</dd><p>{note}</p></div>;
  const badge = (row: ShipmentRecord) => <span className="shp-status" data-state={row.status}>{t(shipmentStatusLabels[row.status])}</span>;
  function snapshot(row: ShipmentRecord) {
    const sourceBatch = state.batches.find((item) => item.id === row.batchId);
    return `${row.documentNo} · ${row.actualDate} · ${qty(row.quantity)} · ${t(shipmentStatusLabels[row.status])}\n${row.customer} / ${row.orderNo}\n${t('批次')}：${sourceBatch?.batchNo ?? row.batchId}\n${t('经手人')}：${row.handler}\n${t('备注')}：${row.note || '—'}\nSN (${row.serialNumbers.length}): ${row.serialNumbers.join(', ') || t('待补齐')}`;
  }
  function batchFacts(item: ShipmentBatch) {
    return <dl className="shp-facts">{fact('生产批次', item.batchNo)}{fact('生产计划', item.planNo)}{fact('整机完工', qty(item.completedQty))}{fact('终检合格', qty(item.inspectionPassedQty))}{fact('已授权放行', qty(item.releasedQty))}{fact('可继续出货', qty(availableToShip(state, item.id)))}</dl>;
  }
  function detail() {
    if (context) return <ShipmentActionForm key={`${generation}:${context.kind}:${context.recordId ?? 'new'}`} context={context} onSubmit={save} onDirtyChange={markDirty} onCancel={() => requestChange(resetForm)} />;
    if (!record || !batch) return <OrderEmptyState Icon={FileClock} title={t(params.has('selected') ? '未找到这条演示记录' : '选择记录查看详情')} description={t(params.has('selected') ? '新增记录仅在本次预览保留，刷新后恢复初始数据。' : '从左侧选择出库单，或登记一次分批出货。')} action={params.has('selected') ? <Button variant="outline" onClick={() => requestChange(() => { resetForm(); location(month); })}>{t('返回现有记录')}</Button> : scenario === 'normal' ? <Button onClick={() => openAction('create')}>{t('登记出货')}</Button> : undefined} />;
    return <>
      <div className="shp-heading"><div><p className="shp-muted">{t('出货记录详情')}</p><h2>{record.documentNo}</h2></div>{badge(record)}</div>
      <p className="shp-product">{batch.productName} <span>{batch.productCode}</span></p>
      {scenario === 'normal' ? <div className="shp-actions">
        {record.status === 'draft' ? <><Button onClick={() => openAction('confirm')}><CheckCircle2 className="size-4" aria-hidden="true" />{t('确认实际出库')}</Button><Button variant="outline" onClick={() => openAction('edit')}>{t('修改登记')}</Button></> : record.status === 'confirmed' ? <><Button variant="outline" onClick={() => openAction('sn')}>{t('补充 SN')}</Button><Button variant="outline" onClick={() => openAction('reverse')}>{t('冲销 / 更正')}</Button></> : <p className="shp-muted">{t('原记录保留备查，不再计入有效出货。')}</p>}
      </div> : <p className="shp-note">{t('当前为只读查看。')}</p>}
      <dl className="shp-facts">{fact('实际出货日期', record.actualDate)}{fact('出货数量', qty(record.quantity))}{fact('客户', record.customer)}{fact('客户订单', record.orderNo)}{fact('经手人', record.handler)}{fact('登记时间', dateTime(record.createdAt))}</dl>
      <div className="shp-batch-link"><div><span>{t('生产批次')}</span><strong>{batch.batchNo}</strong></div><Button variant="outline" size="sm" onClick={() => setArchiveId(batch.id)}><FolderOpen className="size-4" aria-hidden="true" />{t('查看批次档案')}</Button></div>
      <div className="shp-quality"><div><ClipboardCheck className="size-4" aria-hidden="true" /><span>{t('终检合格')}</span><strong>{qty(batch.inspectionPassedQty)}</strong></div><div><PackageCheck className="size-4" aria-hidden="true" /><span>{t('质量授权放行')}</span><strong>{batch.releasedQty > 0 && batch.releaseEvidence ? qty(batch.releasedQty) : t('待放行')}</strong></div><p>{t('终检合格、质量放行与实际出货分别记录。')}</p></div>
      <details className="shp-disclosure"><summary>{t('SN 关联')} · {t('已录入 {count} / {total} 台', { count: record.serialNumbers.length, total: record.quantity })}<span>{record.serialNumbers.length < record.quantity ? t('待补齐 {count} 台', { count: record.quantity - record.serialNumbers.length }) : t('已录入全部号码')}</span></summary><p className="shp-note">{t('仅关联现有号码；号码齐全不代表已贯通逐台追溯。')}</p>{record.serialNumbers.length ? <ul className="shp-serials">{record.serialNumbers.map((sn) => <li key={sn}>{sn}</li>)}</ul> : <p className="shp-muted">{t('暂未关联 SN，可在右侧操作中补充。')}</p>}</details>
      {record.note ? <p className="shp-note">{t('备注')}：{record.note}</p> : null}
      {record.replacementFor ? <p className="shp-note">{t('更正来源')}：{state.records.find((row) => row.id === record.replacementFor)?.documentNo ?? record.replacementFor}</p> : null}
      <details className="shp-disclosure"><summary>{t('操作与更正记录')}<span>{t('{count} 条', { count: history.length })}</span></summary><ol className="shp-history">{history.map((item) => <li key={item.id}><strong>{t(shipmentActionLabels[item.kind])}</strong><p>{item.reason}</p><p className="shp-muted">{item.actor} · {dateTime(item.at)}</p>{item.before ? <details><summary>{t('查看变更前后')}</summary><dl className="shp-facts">{fact('变更前', snapshot(item.before))}{fact('变更后', snapshot(item.after))}</dl></details> : null}</li>)}</ol></details>
    </>;
  }
  return <main className="order-horizon shipment-preview">
    <OrderPageHeader Icon={Truck} eyebrow={t('供应链 / 仓库 / S13')} title={t('实际出货记录')} description={t('按实际出库日期记录分批出货，关联质量放行与生产批次。')} actions={<><Button variant="outline" onClick={() => requestChange(() => setResetOpen(true))} disabled={busy}><RotateCcw className="size-4" aria-hidden="true" />{t('重置演示')}</Button><Button disabled={scenario !== 'normal' || busy} onClick={() => openAction('create')}><Plus className="size-4" aria-hidden="true" />{t('登记出货')}</Button></>} />
    <div className="shp-preview-note"><strong>{t('前端演示')}</strong><span>{t('记录仅在本次预览保留；刷新后恢复。实际库存、月度目标和正式批次档案尚未联动。')}</span></div>
    <details className="shp-scenarios"><summary>{t('预览状态')}</summary><div>{(['normal', 'readonly', 'empty', 'error'] as const).map((value) => <Button key={value} size="sm" variant={scenario === value ? 'secondary' : 'outline'} aria-pressed={scenario === value} onClick={() => requestChange(() => { resetForm(); setScenario(value); setFlash(''); location(month); })}>{t({ normal: '正常', readonly: '只读', empty: '空数据', error: '读取失败' }[value])}</Button>)}<label><Checkbox checked={failNext} disabled={scenario !== 'normal' || busy} onCheckedChange={(checkedValue) => setFailNext((checkedValue === true))} />{t('下次保存失败')}</label></div></details>
    {flash ? <div className="shp-flash" role="status"><CheckCircle2 className="size-4" aria-hidden="true" />{flash}</div> : null}
    {scenario === 'error' ? <section className="shp-card"><OrderEmptyState Icon={AlertCircle} title={t('出货记录读取失败')} description={t('请重新读取，已保存的演示记录仍然保留。')} action={<Button onClick={() => setScenario('normal')}>{t('重新读取')}</Button>} /></section> : <>
      <section className="shp-month-bar" aria-label={t('月度出货统计')}><div className="shp-month-picker"><CalendarDays className="size-5" aria-hidden="true" /><Label htmlFor="shp-month">{t('统计月份')}</Label><Input id="shp-month" type="month" value={month} onChange={(event) => changeMonth(event.target.value)} /><Button size="icon" variant="ghost" aria-label={t('上个月')} onClick={() => offsetMonth(-1)}><ChevronLeft className="size-4" aria-hidden="true" /></Button><Button size="icon" variant="ghost" aria-label={t('下个月')} onClick={() => offsetMonth(1)}><ChevronRight className="size-4" aria-hidden="true" /></Button></div><p>{t('按实际出货日期统计，待确认及已冲销记录不计入。')}</p></section>
      <dl className="shp-metrics">{metric('本月实际出货', qty(summary.shipped), t('{count} 笔有效出库', { count: summary.count }))}{metric('月度出货目标', qty(summary.target), `${t('达成率')} ${summary.achievement === null ? '—' : `${(summary.achievement * 100).toFixed(1)}%`}`)}{metric('距目标待出货', qty(summary.remaining), t(summary.target === null ? '本月目标待维护' : summary.target === 0 ? '本月未设有效目标' : '由有效出货量计算'))}{metric('本月整机完工', qty(summary.completed), t('与出货分别统计'))}</dl>
      <div className="shp-mobile-jump"><span>{t('先选出库单，再查看详情或操作')}</span><a href="#shp-detail">{t('前往当前操作')}</a></div>
      <div className="shp-workspace"><section className="shp-card shp-list" id="shp-list" aria-label={t('出货记录列表')}><div className="shp-heading"><h2>{t('出货记录列表')}</h2><span className="shp-muted">{t('{count} 条', { count: rows.length })}</span></div><div className="shp-filters"><div className="shp-search"><Label htmlFor="shp-query">{t('查找记录')}</Label><div><Search className="size-4" aria-hidden="true" /><Input id="shp-query" value={query} placeholder={t('出库单、客户订单、批次或 SN')} onChange={(event) => { const value = event.target.value; requestChange(() => { resetForm(); setQuery(value); setPageNumber(1); location(month); }); }} /></div></div><div><Label htmlFor="shp-status">{t('出库状态')}</Label><Select value={status} onValueChange={(value) => requestChange(() => { resetForm(); setStatus(value); setPageNumber(1); location(month); })}><SelectTrigger id="shp-status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{t('全部状态')}</SelectItem>{Object.entries(shipmentStatusLabels).map(([key, label]) => <SelectItem key={key} value={key}>{t(label)}</SelectItem>)}</SelectContent></Select></div>{query || status !== 'all' ? <Button size="sm" variant="ghost" onClick={clearFilters}>{t('清除筛选')}</Button> : null}</div>
        {pageRows.length ? <div className="shp-table-wrap"><table className="shp-table"><thead><tr>{['出库单 / 实际日期', '客户 / 订单', '产品 / 生产批次', '数量', '状态', '操作'].map((label) => <th key={label} scope="col">{t(label)}</th>)}</tr></thead><tbody>{pageRows.map((row) => { const rowBatch = state.batches.find((item) => item.id === row.batchId); return <tr key={row.id} className={cn(selectedId === row.id && 'is-selected')}><td><strong>{row.documentNo}</strong><p>{row.actualDate}</p></td><td data-label={t('客户 / 订单')}><span>{row.customer}</span><p>{row.orderNo}</p></td><td data-label={t('产品 / 批次')}><span>{rowBatch?.productName}</span><p>{rowBatch?.batchNo}</p></td><td data-label={t('数量')} className="tabular-nums">{qty(row.quantity)}</td><td>{badge(row)}</td><td><Button size="sm" variant={selectedId === row.id ? 'secondary' : 'ghost'} aria-label={t('查看出库单 {document}', { document: row.documentNo })} aria-pressed={selectedId === row.id} onClick={() => selectRecord(row.id)}>{t('查看')}<ArrowRight className="size-3.5" aria-hidden="true" /></Button></td></tr>; })}</tbody></table></div> : <OrderEmptyState Icon={Search} title={t(monthRows.length ? '没有匹配的出货记录' : '本月暂无出货记录')} description={t(monthRows.length ? '清除筛选后重新查找。' : '切换月份查看历史记录，或登记本月的分批出货。')} action={monthRows.length ? <Button variant="outline" onClick={clearFilters}>{t('清除筛选')}</Button> : scenario === 'normal' ? <Button onClick={() => openAction('create')}>{t('登记出货')}</Button> : <Button variant="outline" onClick={() => { setScenario('normal'); changeMonth(initialMonth); }}>{t('返回演示记录')}</Button>} />}
        {rows.length ? <div className="shp-pagination"><span>{t('第 {page} / {pages} 页', { page, pages })}</span><Button size="sm" variant="outline" disabled={page === 1} onClick={() => requestChange(() => { resetForm(); setPageNumber(page - 1); location(month); })}>{t('上一页')}</Button><Button size="sm" variant="outline" disabled={page === pages} onClick={() => requestChange(() => { resetForm(); setPageNumber(page + 1); location(month); })}>{t('下一页')}</Button></div> : null}
        <div className="shp-ledger-note"><FileClock className="size-4" aria-hidden="true" /><p>{t('已确认记录保留原单。数量或日期有误时，通过“冲销 / 更正”生成新草稿，重新确认后计入出货。')}</p></div>
      </section><section id="shp-detail" className="shp-card shp-detail" aria-label={t('当前出货详情与操作')}><a className="shp-back" href="#shp-list">{t('返回出货列表')}</a>{detail()}</section></div>
    </>}
    <Sheet open={Boolean(archive)} onOpenChange={(open) => { if (!open) setArchiveId(null); }}><SheetContent className="shp-archive"><SheetHeader><SheetTitle>{t('批次关联档案')}</SheetTitle><SheetDescription>{t('本次演示内的批次与出货证据，完整生产档案后续接入。')}</SheetDescription></SheetHeader>{archive ? <div className="shp-archive-body"><p className="shp-code">{archive.batchNo}</p><h2>{archive.productName}</h2>{batchFacts(archive)}<section><h3>{t('检验与质量放行依据')}</h3><dl className="shp-facts">{fact('终检依据', archive.inspectionEvidence || t('待补齐'))}{fact('授权放行依据', archive.releaseEvidence || t('待放行'))}{fact('放行日期', archive.releasedOn || t('待确认'))}{fact('数据来源', archive.source)}</dl></section><section><h3>{t('本批实际版本')}</h3><dl className="shp-facts">{fact('软件版本', archive.softwareVersion || t('待确认'))}{fact('硬件版本', archive.hardwareVersion || t('待确认'))}{fact('BOM 版本', archive.bomVersion || t('待确认'))}{fact('已确认适用数量', qty(archive.versionQuantity))}{fact('版本适用范围待确认', qty(Math.max(0, archive.completedQty - archive.versionQuantity)))}</dl><p className="shp-note">{t('保留本批已知版本；缺失项不以最新版本替代。')}</p></section><section><h3>{t('关联出货与冲销')}</h3><ul className="shp-archive-records">{state.records.filter((row) => row.batchId === archive.id).map((row) => <li key={row.id}><div><strong>{row.documentNo}</strong>{badge(row)}</div><p>{row.actualDate} · {row.customer} / {row.orderNo} · {qty(row.quantity)}</p><p className="shp-muted">{t('SN 已关联 {count} / {total} 台', { count: row.serialNumbers.length, total: row.quantity })}{row.serialNumbers.length < row.quantity ? ` · ${t('待补齐')}` : ''}</p>{row.serialNumbers.length ? <details><summary>{t('查看已关联 SN')}</summary><ul className="shp-serials">{row.serialNumbers.map((sn) => <li key={sn}>{sn}</li>)}</ul></details> : null}<Button size="sm" variant="outline" onClick={() => requestChange(() => { resetForm(); setArchiveId(null); setQuery(''); setStatus('all'); setPageNumber(1); location(row.actualDate.slice(0, 7), row.id); })}>{t('查看出库单')}</Button></li>)}</ul></section></div> : null}</SheetContent></Sheet>
    <AlertDialog open={discardOpen || blocker.state === 'blocked'} onOpenChange={(open) => { if (!open) { setDiscardOpen(false); pendingAction.current = null; if (blocker.state === 'blocked') blocker.reset(); } }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t('放弃尚未保存的填写？')}</AlertDialogTitle><AlertDialogDescription>{t('本次填写将被清空，已保存的演示记录仍然保留。')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t('继续填写')}</AlertDialogCancel><AlertDialogAction onClick={() => { const action = pendingAction.current; pendingAction.current = null; resetForm(); setDiscardOpen(false); if (blocker.state === 'blocked') blocker.proceed(); else action?.(); }}>{t('放弃并继续')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <AlertDialog open={resetOpen} onOpenChange={setResetOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t('恢复初始演示记录？')}</AlertDialogTitle><AlertDialogDescription>{t('本次新增的出货、冲销和 SN 关联将清空。')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t('取消')}</AlertDialogCancel><AlertDialogAction onClick={resetPreview}>{t('重置演示数据')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </main>;
}
