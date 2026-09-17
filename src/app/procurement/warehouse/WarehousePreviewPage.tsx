import { useCallback, useEffect, useRef, useState } from 'react';
import { useBlocker, useSearchParams } from 'react-router';
import { AlertCircle, ArrowRight, CheckCircle2, ClipboardCheck, History, Package, Plus, RotateCcw, Search, Warehouse } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../../components/ui/alert-dialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { cn } from '../../components/ui/utils';
import { i18nLocale, useI18n } from '../../lib/i18n';
import { OrderEmptyState, OrderPageHeader } from '../../order-processing/components/HorizonPage';
import { WarehouseActionForm } from './WarehouseActionForm';
import { applyWarehouseAction, createWarehouseState, freeStock, lineBalance, returnableQty } from './warehousePreviewModel';
import { stockBucketLabels, warehouseActionLabels, warehouseTabLabels, type WarehouseAction, type WarehouseActionContext, type WarehouseActionKind, type WarehouseTab } from './warehouseTypes';
import '../../order-processing/horizon.css';
import './warehouse-preview.css';
import { Checkbox } from "../../components/ui/checkbox";

type Scenario = 'normal' | 'readonly' | 'empty' | 'error';
type Filter = { query: string; status: string; warehouse: string };
type Row = { id: string; title: string; subtitle: string; facts: string; quantity: string; status: string; statusKey: string; warehouse: string };
const blankFilter = (): Filter => ({ query: '', status: 'all', warehouse: 'all' });
const statuses: Record<WarehouseTab, [string, string][]> = {
  inventory: [['qualified', '有合格库存'], ['inspection', '有待检库存'], ['defective', '有不良隔离'], ['frozen', '有冻结库存']],
  issues: [['dispatch', '派工用料'], ['pending_signature', '待签收'], ['discrepancy', '数量待核对'], ['signed', '已签收']],
  returns: [['pending', '待接收'], ['discrepancy', '差异待核对'], ['received', '已接收']],
  counts: [['draft', '草稿'], ['pending_review', '待复核'], ['rejected', '退回修改'], ['approved', '已调整']],
};
const issueStatus = { pending_signature: '待签收', discrepancy: '数量待核对', signed: '已签收' };
const returnStatus = { pending: '待接收', discrepancy: '差异待核对', received: '已接收' };
const countStatus = { draft: '草稿', pending_review: '待复核', rejected: '退回修改', approved: '已调整' };
const movementLabels = { opening: '期初', issue: '发料', sign: '签收', return: '退料', adjustment: '盘点调整' };
const PAGE_SIZE = 8;

/** Development-only warehouse interaction review. No business API or persistent store. */
export function WarehousePreviewPage() {
  const { t } = useI18n();
  const [state, setState] = useState(createWarehouseState);
  const stateRef = useRef(state);
  const [params, setParams] = useSearchParams();
  const tab: WarehouseTab = Object.hasOwn(warehouseTabLabels, params.get('tab') ?? '') ? params.get('tab') as WarehouseTab : 'inventory';
  const selectedParam = params.get('selected');
  const [filters, setFilters] = useState<Record<WarehouseTab, Filter>>({ inventory: blankFilter(), issues: blankFilter(), returns: blankFilter(), counts: blankFilter() });
  const filter = filters[tab];
  const [pages, setPages] = useState<Record<WarehouseTab, number>>({ inventory: 1, issues: 1, returns: 1, counts: 1 });
  const [scenario, setScenario] = useState<Scenario>('normal');
  const [actionKind, setActionKind] = useState<WarehouseActionKind | null>(null);
  const [generation, setGeneration] = useState(0);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const markDirty = useCallback((value: boolean) => { dirtyRef.current = value; setDirty(value); }, []);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [failNext, setFailNext] = useState(false);
  const [flash, setFlash] = useState('');
  const [discardOpen, setDiscardOpen] = useState(false);
  const pendingAction = useRef<(() => void) | null>(null);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirtyRef.current && (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search));
  const number = (value: number) => value.toLocaleString(i18nLocale(), { maximumFractionDigits: 3 });
  const qty = (value: number, unit: string) => `${number(value)} ${unit}`;
  const lotById = (id: string) => state.lots.find((item) => item.id === id);
  const dispatchById = (id: string) => state.dispatches.find((item) => item.id === id);
  const issueById = (id: string) => state.issues.find((item) => item.id === id);

  const allRows: Row[] = tab === 'inventory' ? state.lots.map((lot) => ({ id: lot.id, title: lot.materialName, subtitle: `${lot.materialCode} · ${lot.batchNo}`, facts: `${lot.warehouse} / ${lot.location} · ${lot.supplierName}`, quantity: `${t('可用')} ${qty(freeStock(lot), lot.unit)} / ${t('合格现存')} ${qty(lot.qualified, lot.unit)}`, status: lot.defective > 0 ? t('含不良隔离') : lot.inspection > 0 ? t('含待检') : t('合格库存'), statusKey: lot.defective > 0 ? 'discrepancy' : 'normal', warehouse: lot.warehouse }))
    : tab === 'issues' ? [
      ...state.dispatches.map((item) => ({ id: item.id, title: `${item.dispatchNo} · ${item.materialName}`, subtitle: `${item.componentName} · ${item.bomVersion || t('BOM 待补齐')}`, facts: `${item.line} · ${item.productionBatch}`, quantity: `${t('原料需求')} ${item.requiredQty === null ? t('待核对') : qty(item.requiredQty, item.unit)} · ${t('已发')} ${qty(item.issuedQty, item.unit)}`, status: item.requiredQty === null ? t('BOM 待核对') : item.issuedQty >= item.requiredQty ? t('已发齐') : t('待发料'), statusKey: 'dispatch', warehouse: '' })),
      ...state.issues.map((item) => { const lot = lotById(item.lotId), dispatch = dispatchById(item.dispatchId); return { id: item.id, title: `${item.code} · ${lot?.materialName ?? ''}`, subtitle: `${lot?.batchNo ?? ''} · ${dispatch?.dispatchNo ?? ''}`, facts: `${dispatch?.line ?? ''} · ${dispatch?.productionBatch ?? ''}`, quantity: `${t('发料')} ${qty(item.quantity, lot?.unit ?? '')} · ${t('未耗用线边')} ${qty(lineBalance(item), lot?.unit ?? '')}`, status: t(issueStatus[item.status]), statusKey: item.status, warehouse: lot?.warehouse ?? '' }; }),
    ] : tab === 'returns' ? state.returns.map((item) => { const issue = issueById(item.issueId), lot = issue && lotById(issue.lotId), dispatch = issue && dispatchById(issue.dispatchId); return { id: item.id, title: `${item.code} · ${lot?.materialName ?? ''}`, subtitle: `${issue?.code ?? ''} · ${lot?.batchNo ?? ''}`, facts: `${dispatch?.line ?? ''} · ${dispatch?.productionBatch ?? ''}`, quantity: `${t('申请退回')} ${qty(item.quantity, lot?.unit ?? '')} · ${t(stockBucketLabels[item.result])}`, status: t(returnStatus[item.status]), statusKey: item.status, warehouse: lot?.warehouse ?? '' }; })
      : state.counts.map((item) => { const lot = lotById(item.lotId); return { id: item.id, title: `${item.code} · ${lot?.materialName ?? ''}`, subtitle: `${lot?.batchNo ?? ''} · ${t(stockBucketLabels[item.bucket])}`, facts: `${lot?.warehouse ?? ''} / ${lot?.location ?? ''}`, quantity: `${t('账面')} ${qty(item.bookQty, lot?.unit ?? '')} → ${t('实盘')} ${qty(item.actualQty, lot?.unit ?? '')}`, status: t(countStatus[item.status]), statusKey: item.status, warehouse: lot?.warehouse ?? '' }; });
  const rows = allRows.filter((row) => {
    const queryMatches = `${row.title} ${row.subtitle} ${row.facts}`.toLowerCase().includes(filter.query.trim().toLowerCase());
    const lot = tab === 'inventory' ? lotById(row.id) : undefined;
    const statusMatches = filter.status === 'all' || (lot ? lot[filter.status as keyof typeof stockBucketLabels] > 0 : row.statusKey === filter.status);
    return queryMatches && statusMatches && (filter.warehouse === 'all' || row.warehouse === filter.warehouse);
  });
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(pages[tab], totalPages);
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const selected = selectedParam ?? pageRows[0]?.id ?? '';
  const newReturn = tab === 'returns' && selected.startsWith('new-return--');
  const newCount = tab === 'counts' && selected.startsWith('new-count--');
  const returnItem = tab === 'returns' && !newReturn ? state.returns.find((item) => item.id === selected) : undefined;
  const count = tab === 'counts' && !newCount ? state.counts.find((item) => item.id === selected) : undefined;
  const issue = tab === 'issues' ? issueById(selected) : returnItem ? issueById(returnItem.issueId) : newReturn ? issueById(selected.slice('new-return--'.length)) : undefined;
  const dispatch = tab === 'issues' ? dispatchById(selected) ?? (issue ? dispatchById(issue.dispatchId) : undefined) : issue ? dispatchById(issue.dispatchId) : undefined;
  const lot = tab === 'inventory' ? lotById(selected) : count ? lotById(count.lotId) : newCount ? lotById(selected.slice('new-count--'.length)) : issue ? lotById(issue.lotId) : undefined;
  const contextValid = tab === 'inventory' ? Boolean(lot) : tab === 'issues' ? Boolean(dispatch) : tab === 'returns' ? Boolean(issue && (returnItem || newReturn)) : Boolean(lot && (count || newCount));
  const allowed: WarehouseActionKind[] = tab === 'inventory' ? [] : tab === 'issues' ? issue ? issue.status === 'signed' ? [] : ['sign'] : ['issue']
    : tab === 'returns' ? newReturn ? ['return_create'] : returnItem?.status === 'pending' ? ['return_receive', 'return_discrepancy'] : returnItem?.status === 'discrepancy' ? ['return_resubmit'] : []
      : newCount ? ['count_create'] : count?.status === 'pending_review' ? ['count_approve', 'count_reject'] : count?.status === 'draft' || count?.status === 'rejected' ? ['count_edit', 'count_submit'] : [];
  const kind = actionKind && allowed.includes(actionKind) ? actionKind : allowed[0];
  const context: WarehouseActionContext | null = kind && contextValid ? { state, kind, lotId: lot?.id, dispatchId: dispatch?.id, issueId: issue?.id, returnId: returnItem?.id, countId: count?.id } : null;
  const returnOptions = state.issues.filter((item) => item.status === 'signed' && returnableQty(state, item.id) > 0);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { if (dirtyRef.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function resetForm() { markDirty(false); setGeneration((value) => value + 1); }
  function requestChange(action: () => void) {
    if (busyRef.current) return;
    if (dirtyRef.current) { pendingAction.current = action; setDiscardOpen(true); } else action();
  }
  function changeLocation(nextTab: WarehouseTab, id?: string, preferred?: WarehouseActionKind) {
    resetForm(); setActionKind(preferred ?? null); setFlash('');
    const next = new URLSearchParams(params); next.set('tab', nextTab);
    if (id) next.set('selected', id); else next.delete('selected');
    setParams(next);
  }
  function navigate(nextTab: WarehouseTab, id?: string, preferred?: WarehouseActionKind) { requestChange(() => changeLocation(nextTab, id, preferred)); }
  function viewRecord(id: string) {
    requestChange(() => {
      changeLocation(tab, id);
      if (window.matchMedia?.('(max-width: 767px)').matches) {
        window.requestAnimationFrame(() => document.getElementById('whp-record-detail')?.scrollIntoView({ block: 'start' }));
      }
    });
  }
  function changeFilter(key: keyof Filter, value: string) {
    requestChange(() => { setFilters((current) => ({ ...current, [tab]: { ...current[tab], [key]: value } })); setPages((current) => ({ ...current, [tab]: 1 })); changeLocation(tab); });
  }
  function resetFilters() { requestChange(() => { setFilters((current) => ({ ...current, [tab]: blankFilter() })); setPages((current) => ({ ...current, [tab]: 1 })); changeLocation(tab); }); }
  function resetPreview() {
    requestChange(() => { const next = createWarehouseState(); stateRef.current = next; setState(next); setScenario('normal'); setFailNext(false); setFilters({ inventory: blankFilter(), issues: blankFilter(), returns: blankFilter(), counts: blankFilter() }); setPages({ inventory: 1, issues: 1, returns: 1, counts: 1 }); changeLocation('inventory'); });
  }
  async function save(action: WarehouseAction) {
    if (busyRef.current) throw new Error(t('正在保存，请稍候。'));
    if (scenario !== 'normal' || !context || action.kind !== context.kind) throw new Error(t('当前操作已变化，请重新打开后核对。'));
    busyRef.current = true; setBusy(true);
    try {
      if (failNext) { setFailNext(false); throw new Error(t('演示保存失败，填写内容已保留，请重试。')); }
      const previous = stateRef.current;
      const next = applyWarehouseAction(previous, context.state.version, action);
      stateRef.current = next; setState(next); resetForm();
      let nextId = selected, preferred: WarehouseActionKind | undefined;
      if (action.kind === 'issue') nextId = next.issues.find((item) => !previous.issues.some((old) => old.id === item.id))?.id ?? selected;
      if (action.kind === 'return_create') nextId = next.returns.find((item) => !previous.returns.some((old) => old.id === item.id))?.id ?? selected;
      if (action.kind === 'count_create') nextId = next.counts.find((item) => !previous.counts.some((old) => old.id === item.id))?.id ?? selected;
      if (action.kind === 'count_create' || action.kind === 'count_edit') preferred = 'count_submit';
      changeLocation(tab, nextId, preferred);
      setFlash(t('已保存{action}演示记录。', { action: t(warehouseActionLabels[action.kind]) }));
    } finally { busyRef.current = false; setBusy(false); }
  }

  const fact = (label: string, value: string) => <div key={label}><dt>{t(label)}</dt><dd>{value}</dd></div>;
  function stockDetail() {
    if (!lot) return null;
    const lotIssues = state.issues.filter((item) => item.lotId === lot.id);
    const movements = state.movements.filter((item) => item.lotId === lot.id).slice().reverse();
    return <>
      <div className="whp-section-heading"><div><p className="whp-code">{lot.materialCode}</p><h2>{lot.materialName}</h2></div>{scenario === 'normal' ? <Button size="sm" variant="outline" onClick={() => navigate('counts', `new-count--${lot.id}`)}><Plus className="size-4" aria-hidden="true" />{t('发起盘点')}</Button> : null}</div>
      <dl className="whp-facts">{fact('物料批次', lot.batchNo)}{fact('仓库 / 库位', `${lot.warehouse} / ${lot.location}`)}{fact('规格 / 版本', `${lot.spec} · ${lot.revision}`)}{fact('供应商', lot.supplierName)}</dl>
      <dl className="whp-stock-grid">{fact('合格现存', qty(lot.qualified, lot.unit))}{fact('已占用', qty(lot.reserved, lot.unit))}{fact('未占用可用', qty(freeStock(lot), lot.unit))}{fact('待检', qty(lot.inspection, lot.unit))}{fact('不良隔离', qty(lot.defective, lot.unit))}{fact('冻结', qty(lot.frozen, lot.unit))}</dl>
      <p className="whp-note">{t('可用 = 合格现存 − 已占用。待检、不良隔离、冻结分别记账；此处为仓库未占用量，计划专属可用量后续接入。')}</p>
      <details className="whp-details"><summary>{t('查看线边与待签收')}</summary>{lotIssues.length ? <ul className="whp-line-list">{lotIssues.map((item) => <li key={item.id}><strong>{item.code}</strong><p>{t(issueStatus[item.status])} · {t('未耗用线边')} {qty(lineBalance(item), lot.unit)}</p><p className="whp-muted">{t('可申请退料')} {qty(returnableQty(state, item.id), lot.unit)}</p><Button variant="outline" size="sm" onClick={() => navigate('issues', item.id)}>{t('查看领料记录')}<ArrowRight className="size-3.5" aria-hidden="true" /></Button></li>)}</ul> : <p className="whp-muted">{t('此批次暂无领料记录。')}</p>}</details>
      <div className="whp-section-heading whp-divider"><h3>{t('库存事务记录')}</h3><span className="whp-muted">{t('{count} 条', { count: movements.length })}</span></div>
      <p className="whp-muted">{t('数量表示仓库变化；生产签收只确认线边接收，不再次扣仓库。')}</p>
      {movements.length ? <ol className="whp-movements">{movements.map((item) => <li key={item.id}><div><strong>{t(movementLabels[item.kind])} · {item.documentNo}</strong><span className={cn('tabular-nums', item.quantity < 0 && 'text-destructive')}>{item.quantity > 0 ? '+' : ''}{qty(item.quantity, item.unit)}</span></div><p>{item.source} → {item.destination}</p><p className="whp-muted">{item.note}</p><p className="whp-muted">{item.actor} · {new Date(item.createdAt).toLocaleString(i18nLocale(), { timeZone: 'Asia/Shanghai', hour12: false })}</p></li>)}</ol> : <p className="whp-note">{t('暂无库存事务记录。')}</p>}
      <p className="whp-source">{t('来源')}：{lot.source} · {t('更新时间')} {new Date(lot.updatedAt).toLocaleString(i18nLocale(), { timeZone: 'Asia/Shanghai', hour12: false })}</p>
    </>;
  }
  function operationDetail() {
    const title = count?.code ?? returnItem?.code ?? (newCount ? t('新建盘点') : newReturn ? t('登记生产退料') : issue?.code ?? dispatch?.dispatchNo ?? '');
    const records = state.records.filter((item) => item.entityId === (count?.id ?? returnItem?.id ?? issue?.id ?? dispatch?.id));
    return <>
      <div className="whp-section-heading"><div><p className="whp-code">{title}</p><h2>{lot?.materialName ?? dispatch?.materialName}</h2></div>{count ? <span className="whp-status">{t(countStatus[count.status])}</span> : returnItem ? <span className="whp-status">{t(returnStatus[returnItem.status])}</span> : issue ? <span className="whp-status">{t(issueStatus[issue.status])}</span> : null}</div>
      <p className="whp-operation-context">{lot ? `${lot.batchNo} · ${lot.warehouse} / ${lot.location}` : dispatch ? `${dispatch.line} · ${dispatch.productionBatch}` : ''}</p><details className="whp-source-details"><summary>{t('查看单据来源与数量')}</summary><dl className="whp-facts">{lot ? <>{fact('物料批次', lot.batchNo)}{fact('仓库 / 库位', `${lot.warehouse} / ${lot.location}`)}</> : null}{dispatch ? <>{fact('派工 / 生产批次', `${dispatch.dispatchNo} / ${dispatch.productionBatch}`)}{fact('产线 / 组件', `${dispatch.line} / ${dispatch.componentName}`)}</> : null}{issue ? <>{fact('原发料数量', qty(issue.quantity, lot?.unit ?? ''))}{fact('未耗用线边', qty(lineBalance(issue), lot?.unit ?? ''))}</> : null}{returnItem ? <>{fact('申请退回', qty(returnItem.quantity, lot?.unit ?? ''))}{fact('实收 / 核对数量', returnItem.actualQty === null ? t('待核对') : qty(returnItem.actualQty, lot?.unit ?? ''))}{fact('退料说明', returnItem.reason)}{fact('接收去向', t(stockBucketLabels[returnItem.result]))}</> : null}{count ? <>{fact('盘点状态', t(stockBucketLabels[count.bucket]))}{fact('账面 / 实盘', `${qty(count.bookQty, lot?.unit ?? '')} / ${qty(count.actualQty, lot?.unit ?? '')}`)}{fact('差异', qty(Number((count.actualQty - count.bookQty).toFixed(3)), lot?.unit ?? ''))}{fact('填报 / 复核', `${count.reporter} / ${count.reviewer || t('待复核')}`)}</> : null}</dl></details>
      {newReturn ? <div className="whp-source-picker"><Label htmlFor="whp-new-return-source">{t('关联原领料单')}</Label><Select value={issue?.id} onValueChange={(id) => navigate('returns', `new-return--${id}`)}><SelectTrigger id="whp-new-return-source"><SelectValue /></SelectTrigger><SelectContent>{returnOptions.map((item) => <SelectItem key={item.id} value={item.id}>{item.code} · {lotById(item.lotId)?.materialName} · {t('可退')} {number(returnableQty(state, item.id))}</SelectItem>)}</SelectContent></Select></div> : null}
      {newCount ? <div className="whp-source-picker"><Label htmlFor="whp-new-count-source">{t('盘点物料批次')}</Label><Select value={lot?.id} onValueChange={(id) => navigate('counts', `new-count--${id}`)}><SelectTrigger id="whp-new-count-source"><SelectValue /></SelectTrigger><SelectContent>{state.lots.map((item) => <SelectItem key={item.id} value={item.id}>{item.materialName} · {item.batchNo} · {item.location}</SelectItem>)}</SelectContent></Select></div> : null}
      {scenario === 'readonly' ? <p className="whp-note">{t('当前仅可查看记录，不能办理库存操作。')}</p> : context ? <>
        {allowed.length > 1 ? <div className="whp-source-picker"><Label htmlFor="whp-action">{t('本次操作')}</Label><Select value={kind} disabled={busy} onValueChange={(value) => requestChange(() => { resetForm(); setActionKind(value as WarehouseActionKind); setFlash(''); })}><SelectTrigger id="whp-action"><SelectValue /></SelectTrigger><SelectContent>{allowed.map((value) => <SelectItem key={value} value={value}>{t(warehouseActionLabels[value])}</SelectItem>)}</SelectContent></Select></div> : null}
        <WarehouseActionForm key={`${selected}:${kind}:${generation}`} context={context} onSubmit={save} onDirtyChange={markDirty} onCancel={() => requestChange(resetForm)} />
      </> : <div className="whp-complete"><CheckCircle2 className="size-5" aria-hidden="true" /><strong>{t(returnItem?.status === 'received' ? '退料已接收' : count?.status === 'approved' ? '盘点已复核调整' : '领料已签收')}</strong><p>{t('演示记录已保留，可查看本批库存及处理历史。')}</p></div>}
      <div className="whp-detail-actions">{lot ? <Button size="sm" variant="outline" onClick={() => navigate('inventory', lot.id)}>{t('查看本批库存')}</Button> : null}{issue?.status === 'signed' && scenario === 'normal' && returnableQty(state, issue.id) > 0 ? <Button size="sm" variant="outline" onClick={() => navigate('returns', `new-return--${issue.id}`)}>{t('从此领料登记退料')}</Button> : null}</div>
      {records.length ? <details className="whp-details" open><summary>{t('处理历史')} · {records.length}</summary><ol className="whp-movements">{records.slice().reverse().map((item) => <li key={item.id}><strong>{item.title}</strong><p className="whp-prose">{item.note}</p><p className="whp-muted">{item.actor} · {new Date(item.createdAt).toLocaleString(i18nLocale(), { timeZone: 'Asia/Shanghai', hour12: false })}</p></li>)}</ol></details> : null}
    </>;
  }

  return <main className="order-horizon warehouse-preview">
    <OrderPageHeader Icon={Warehouse} eyebrow={t('供应链 / 仓管工作台')} title={t('库存与领退料')} description={t('按物料批次核对库存，跟进发料、退料和盘点。')} actions={<><Button variant="outline" onClick={resetPreview} disabled={busy}><RotateCcw className="size-4" aria-hidden="true" />{t('重置演示')}</Button>{scenario === 'normal' && tab === 'returns' ? <Button disabled={!returnOptions.length || busy} onClick={() => navigate('returns', `new-return--${returnOptions[0].id}`)}><Plus className="size-4" aria-hidden="true" />{t('登记退料')}</Button> : null}{scenario === 'normal' && tab === 'counts' ? <Button disabled={!state.lots.length || busy} onClick={() => navigate('counts', `new-count--${state.lots[0].id}`)}><Plus className="size-4" aria-hidden="true" />{t('新建盘点')}</Button> : null}</>} />
    <div className="whp-preview-note"><strong>{t('交互预览')}</strong><p>{t('使用独立演示库存，刷新后恢复。各页数量会在本预览内联动，不影响正式库存、齐套或 ERP。')}</p></div>
    <details className="whp-scenarios"><summary>{t('演示场景')}</summary><div>{([['normal', '正常操作'], ['readonly', '仅可查看'], ['empty', '暂无数据'], ['error', '读取失败']] as const).map(([value, label]) => <Button key={value} size="sm" variant={scenario === value ? 'secondary' : 'outline'} aria-pressed={scenario === value} disabled={busy} onClick={() => requestChange(() => { resetForm(); setScenario(value); })}>{t(label)}</Button>)}<label><Checkbox checked={failNext} disabled={busy || scenario !== 'normal'} onCheckedChange={(checkedValue) => setFailNext((checkedValue === true))} />{t('下次保存失败')}</label></div></details>
    <nav className="whp-tabs" aria-label={t('仓库业务')} >{(Object.keys(warehouseTabLabels) as WarehouseTab[]).map((value) => <Button key={value} variant="ghost" aria-current={tab === value ? 'page' : undefined} onClick={() => navigate(value)}>{t(warehouseTabLabels[value])}</Button>)}</nav>
    {flash ? <p className="whp-flash" role="status">{flash}</p> : null}
    {scenario === 'error' ? <section className="whp-card"><OrderEmptyState Icon={AlertCircle} title={t('仓库记录读取失败')} description={t('已保存的演示记录仍保留。')} action={<Button onClick={() => setScenario('normal')}>{t('重新加载')}</Button>} /></section> : scenario === 'empty' ? <section className="whp-card"><OrderEmptyState Icon={Package} title={t('暂无仓库记录')} description={t('当前为空列表演示，可返回继续查看各类记录。')} action={<Button onClick={() => setScenario('normal')}>{t('返回演示数据')}</Button>} /></section> : <>
      <section className="whp-workload" aria-label={t('仓库待办概况')}>{[[t('库存批次'), state.lots.length, 'inventory'], [t('待签收领料'), state.issues.filter((item) => item.status !== 'signed').length, 'issues'], [t('待接收退料'), state.returns.filter((item) => item.status !== 'received').length, 'returns'], [t('待复核盘点'), state.counts.filter((item) => item.status === 'pending_review').length, 'counts']].map(([label, value, target]) => <Button variant="unstyled" type="button" key={String(target)} onClick={() => navigate(target as WarehouseTab)}><span>{label}</span><strong className="tabular-nums">{value}</strong><ArrowRight className="size-4" aria-hidden="true" /></Button>)}</section>
      <nav className="whp-mobile-jump" aria-label={t('页面内导航')}><a href="#whp-record-list">{t('记录列表')}</a><a href="#whp-record-detail">{t('当前详情与操作')}</a></nav>
      <div className="whp-workspace">
        <section id="whp-record-list" className="whp-card whp-list" aria-label={t('仓库记录列表')}><div className="whp-section-heading"><div><h2>{t(warehouseTabLabels[tab])}</h2><p className="whp-muted">{t('{count} 条记录；数量按原单位展示。', { count: rows.length })}</p></div><History className="size-5" aria-hidden="true" /></div>
          <div className="whp-filters"><div className="whp-search"><Label htmlFor="whp-search">{t('搜索记录')}</Label><div><Search className="size-4" aria-hidden="true" /><Input id="whp-search" value={filter.query} onChange={(event) => changeFilter('query', event.target.value)} placeholder={t('物料、批次、单号或产线')} /></div></div><div><Label htmlFor="whp-status">{t('筛选状态')}</Label><Select value={filter.status} onValueChange={(value) => changeFilter('status', value)}><SelectTrigger id="whp-status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{t('全部状态')}</SelectItem>{statuses[tab].map(([value, label]) => <SelectItem key={value} value={value}>{t(label)}</SelectItem>)}</SelectContent></Select></div>{tab === 'inventory' ? <div><Label htmlFor="whp-warehouse">{t('仓库')}</Label><Select value={filter.warehouse} onValueChange={(value) => changeFilter('warehouse', value)}><SelectTrigger id="whp-warehouse"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{t('全部仓库')}</SelectItem>{[...new Set(state.lots.map((item) => item.warehouse))].map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div> : null}<Button variant="ghost" size="sm" onClick={resetFilters}>{t('清除筛选')}</Button></div>
          {tab === 'inventory' && pageRows.length ? <div className="whp-stock-table-wrap"><table className="whp-stock-table"><caption className="sr-only">{t('按批次查看库存状态数量')}</caption><thead><tr><th>{t('物料 / 批次')}</th>{['合格', '占用', '可用', '待检', '不良', '冻结'].map((label) => <th key={label}>{t(label)}</th>)}<th>{t('操作')}</th></tr></thead><tbody>{pageRows.map((row) => { const item = lotById(row.id)!; return <tr key={row.id} className={cn('whp-stock-row', selected === row.id && 'is-selected')}><td className="whp-stock-identity"><p className="whp-row-title">{row.title}<span className="whp-muted"> · {item.unit}</span></p><p className="whp-code">{row.subtitle}</p><p className="whp-muted">{item.warehouse} / {item.location}</p></td>{([['合格', item.qualified], ['占用', item.reserved], ['可用', freeStock(item)], ['待检', item.inspection], ['不良', item.defective], ['冻结', item.frozen]] as [string, number][]).map(([label, value]) => <td key={label} data-label={t(label)} className={cn('tabular-nums', label === '可用' && 'whp-stock-available')}>{number(value)}</td>)}<td className="whp-stock-action"><Button size="sm" variant={selected === row.id ? 'secondary' : 'outline'} aria-label={t('查看记录 {name}', { name: `${row.title} · ${item.batchNo}` })} aria-pressed={selected === row.id} onClick={() => viewRecord(row.id)}>{t('查看')}</Button></td></tr>; })}</tbody></table></div> : pageRows.length ? <ul className="whp-rows">{pageRows.map((row) => <li key={row.id} className={cn('whp-row', selected === row.id && 'is-selected')}><div><p className="whp-row-title">{row.title}</p><p className="whp-code">{row.subtitle}</p><p className="whp-muted">{row.facts}</p><p className="whp-row-quantity tabular-nums">{row.quantity}</p></div><div className="whp-row-actions"><span className="whp-status" data-state={row.statusKey}>{row.status}</span><Button size="sm" variant={selected === row.id ? 'secondary' : 'outline'} aria-label={t('查看记录 {name}', { name: row.title })} aria-pressed={selected === row.id} onClick={() => viewRecord(row.id)}>{t('查看')}<ArrowRight className="size-3.5" aria-hidden="true" /></Button></div></li>)}</ul> : <OrderEmptyState Icon={Search} title={t('没有匹配的记录')} description={t('清除筛选可重新查看当前业务记录。')} action={<Button variant="outline" onClick={resetFilters}>{t('清除当前筛选')}</Button>} />}
          {rows.length ? <div className="whp-pagination"><span>{t('第 {page} / {pages} 页', { page, pages: totalPages })}</span><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => requestChange(() => { setPages((current) => ({ ...current, [tab]: page - 1 })); changeLocation(tab); })}>{t('上一页')}</Button><Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => requestChange(() => { setPages((current) => ({ ...current, [tab]: page + 1 })); changeLocation(tab); })}>{t('下一页')}</Button></div> : null}
        </section>
        <section id="whp-record-detail" className="whp-card whp-detail" aria-label={t('当前记录详情')}><a className="whp-back-to-list" href="#whp-record-list">{t('返回记录列表')}</a>{contextValid ? tab === 'inventory' ? stockDetail() : operationDetail() : <OrderEmptyState Icon={ClipboardCheck} title={t(selectedParam ? '未找到这条演示记录' : '选择记录查看详情')} description={t(selectedParam ? '新增记录仅在本次预览中保留，刷新后会恢复。' : '左侧可按物料、批次或单号查找。')} action={selectedParam ? <Button variant="outline" onClick={() => navigate(tab)}>{t('返回现有记录')}</Button> : undefined} />}</section>
      </div>
    </>}
    <AlertDialog open={discardOpen || blocker.state === 'blocked'} onOpenChange={(open) => { if (!open) { setDiscardOpen(false); pendingAction.current = null; if (blocker.state === 'blocked') blocker.reset(); } }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t('放弃尚未保存的填写？')}</AlertDialogTitle><AlertDialogDescription>{t('本次填写将被清空，已保存的演示记录仍保留；重置演示会恢复初始数据。')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t('继续填写')}</AlertDialogCancel><AlertDialogAction onClick={() => { const action = pendingAction.current; pendingAction.current = null; resetForm(); setDiscardOpen(false); if (blocker.state === 'blocked') blocker.proceed(); else action?.(); }}>{t('放弃并继续')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </main>;
}
