import { useEffect, useRef, useState } from 'react';
import { Link, useBlocker, useSearchParams } from 'react-router';
import { AlertCircle, ArrowRight, CalendarDays, CheckCircle2, FileClock, Layers3, RefreshCw, Save } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../../components/ui/sheet';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../../components/ui/alert-dialog';
import { OrderEmptyState, OrderPageHeader } from '../../order-processing/components/HorizonPage';
import { useI18n } from '../../lib/i18n';
import { calculateMonthlyReadiness, changeReadinessSource, createMonthlyReadinessState, defaultReadinessInput, monthEnd, saveMonthlyReadinessSnapshot, type MaterialReadiness, type MonthlyProduct, type ReadinessInput, type ReadinessSnapshot } from './monthlyReadinessModel';
import '../../order-processing/horizon.css';
import './monthly-readiness.css';
import { Checkbox } from "../../components/ui/checkbox";
import { NativeSelect } from "../../components/ui/native-select";

const productSupported = (value: string) => value === 'Q7' || value === 'Q5';
function inputFromParams(params: URLSearchParams): ReadinessInput {
  const month = monthEnd(params.get('month') ?? '') ? params.get('month')! : '2026-09';
  const input = defaultReadinessInput(productSupported(params.get('product') ?? '') ? params.get('product') as MonthlyProduct : 'Q7', month);
  return { ...input, mode: params.get('mode') === 'date' ? 'date' : 'month', deadline: params.get('deadline') ?? input.deadline };
}
const inputKey = (input: ReadinessInput) => JSON.stringify(input);
export function MonthlyReadinessPreviewPage() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const [state, setState] = useState(createMonthlyReadinessState);
  const [draft, setDraft] = useState(() => inputFromParams(params));
  const [result, setResult] = useState(() => calculateMonthlyReadiness(state, draft));
  const [calculatedInput, setCalculatedInput] = useState(() => inputKey(draft));
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [scenario, setScenario] = useState<'normal' | 'readonly' | 'error'>('normal');
  const [flash, setFlash] = useState('');
  const [error, setError] = useState('');
  const [failNext, setFailNext] = useState(false);
  const [history, setHistory] = useState<ReadinessSnapshot | null>(null);
  const [material, setMaterial] = useState<MaterialReadiness | null>(null);
  const [sourceSnapshotId, setSourceSnapshotId] = useState<string | undefined>();
  const [discardOpen, setDiscardOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const pendingAction = useRef<(() => void) | null>(null);
  const dirtyRef = useRef(false); dirtyRef.current = dirty;
  const internalNavigation = useRef(false);
  const syncedLocation = useRef(params.toString());
  const snapshotSequence = useRef(1);
  const blocker = useBlocker(() => dirtyRef.current && !internalNavigation.current);
  const incomingProduct = params.get('product');
  const unsupported = incomingProduct !== null && !productSupported(incomingProduct);
  const readonly = scenario === 'readonly';
  const changed = calculatedInput !== inputKey(draft);
  const stale = result.sourceVersion !== state.version;
  const cannotSave = readonly || unsupported || changed || stale || result.dataIssues.length > 0 || saved;
  const showQty = (value: number | null) => value === null ? '—' : value.toLocaleString('zh-CN');
  const statusLabel = result.status === 'incomplete' ? '数据待补齐' : result.status === 'draft' ? '草稿情景' : result.status === 'ready' ? '物料预计可覆盖' : '按期仍有缺口';
  const relevantHistory = state.snapshots.filter((row) => row.input.product === draft.product);

  useEffect(() => {
    const nextKey = params.toString();
    if (nextKey === syncedLocation.current) return;
    syncedLocation.current = nextKey;
    const next = inputFromParams(params);
    setDraft(next); setResult(calculateMonthlyReadiness(state, next)); setCalculatedInput(inputKey(next));
    setDirty(false); setSaved(false); setSourceSnapshotId(undefined); setHistory(null); setMaterial(null); setFlash(''); setError('');
  }, [params.toString()]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { if (dirtyRef.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  function change(patch: Partial<ReadinessInput>) { setDraft((old) => ({ ...old, ...patch })); setDirty(true); setSaved(false); setFlash(''); setError(''); }
  function requestChange(action: () => void) { if (dirtyRef.current) { pendingAction.current = action; setDiscardOpen(true); } else action(); }
  function writeLocation(input: ReadinessInput) {
    const next = new URLSearchParams(params); next.set('product', input.product); next.set('month', input.month); next.set('mode', input.mode); next.set('deadline', input.mode === 'month' ? monthEnd(input.month) : input.deadline);
    syncedLocation.current = next.toString();
    internalNavigation.current = true;
    try { setParams(next, { replace: true }); } finally { internalNavigation.current = false; }
  }
  function chooseProduct(value: string) {
    const product = value as MonthlyProduct;
    const next = { ...draft, product, bomVersion: product === 'Q7' ? 'V1.0' : 'V2.1', targetOverride: undefined };
    change(next); writeLocation(next);
  }
  function calculate(input = draft, snapshotId = sourceSnapshotId) {
    const next = calculateMonthlyReadiness(state, input);
    setResult(next); setCalculatedInput(inputKey(input)); setDirty(true); setSaved(false); setSourceSnapshotId(snapshotId); setError(''); setFlash(t('已按当前来源重新计算，可检查明细后另存结果。')); writeLocation(input);
  }
  function save() {
    if (cannotSave) return;
    if (failNext) { setFailNext(false); setError(t('本次预测未保存。输入与计算结果已保留，请重试保存。')); return; }
    try {
      const next = saveMonthlyReadinessSnapshot(state, result, result.sourceVersion, `MR-DEMO-${snapshotSequence.current++}`, new Date().toISOString(), sourceSnapshotId);
      setState(next); setSaved(true); setDirty(false); setError(''); setFlash(t('已另存预测快照，历史结果保持不变。本次预览刷新后恢复初始数据。'));
    } catch (caught) { setError(caught instanceof Error ? t(caught.message) : t('保存失败，请重试。')); }
  }
  function mutateSource(kind: 'verify-line' | 'late-order' | 'missing-bom') { setState((old) => changeReadinessSource(old, kind)); setSaved(false); setFlash(t('来源已更新，屏幕上的旧结果仍保留；请重新计算。')); }
  function reset() { const next = createMonthlyReadinessState(), input = defaultReadinessInput(); setState(next); setDraft(input); setResult(calculateMonthlyReadiness(next, input)); setCalculatedInput(inputKey(input)); setDirty(false); setSaved(false); setSourceSnapshotId(undefined); setScenario('normal'); setFlash(''); setError(''); setHistory(null); setMaterial(null); setFailNext(false); setResetOpen(false); writeLocation(input); }
  const metric = (label: string, value: number | null, note: string) => <div><dt>{t(label)}</dt><dd>{showQty(value)}<small>{t('台')}</small></dd><p>{t(note)}</p></div>;
  return <main className="order-horizon monthly-readiness-preview">
    <OrderPageHeader Icon={CalendarDays} eyebrow={t('供应链 / 整机齐套 / S15')} title={t('月度齐套与历史预测')} description={t('从整月剩余需求出发，核对当期供给，保留每一次预测依据。')} actions={<><Button asChild variant="outline"><Link to="/__preview">{t('预览目录')}</Link></Button><Button variant="outline" onClick={() => setResetOpen(true)}>{t('重置演示')}</Button><Button onClick={save} disabled={cannotSave || scenario === 'error'}><Save className="size-4" aria-hidden="true" />{t(saved ? '预测已保存' : '保存本次预测')}</Button></>} />
    <div className="mr-preview-note"><strong>{t('前端演示')}</strong><span>{t('快照仅在本次预览保留；库存、订单、完工和权限尚未接通正式业务。')}</span></div>
    <details className="mr-scenarios"><summary>{t('预览状态与来源样例')}</summary><div>{(['normal', 'readonly', 'error'] as const).map((value) => <Button key={value} size="sm" variant={scenario === value ? 'secondary' : 'outline'} aria-pressed={scenario === value} onClick={() => setScenario(value)}>{t({ normal: '正常', readonly: '只读', error: '读取失败' }[value])}</Button>)}<Button size="sm" variant="outline" disabled={readonly} onClick={() => mutateSource('verify-line')}>{t('补齐线边样例')}</Button><Button size="sm" variant="outline" disabled={readonly} onClick={() => mutateSource('late-order')}>{t('模拟交期延后')}</Button><Button size="sm" variant="outline" disabled={readonly} onClick={() => mutateSource('missing-bom')}>{t('模拟 BOM 缺失')}</Button><label><Checkbox checked={failNext} disabled={readonly} onCheckedChange={(checkedValue) => setFailNext((checkedValue === true))} />{t('下次保存失败')}</label></div></details>
    {params.get('scope') ? <p className="mr-note">{t('管理入口范围')}：{params.get('scope')}。{t('本页按产品专属分配试算，入口范围不改变可用供给；批次范围尚未接通。')}</p> : null}
    {readonly ? <div className="mr-notice">{t('只读预览：可查看结果与历史，不能修改计算条件或保存。')}</div> : null}
    {flash ? <div className="mr-flash" role="status"><CheckCircle2 className="size-4" aria-hidden="true" />{flash}</div> : null}
    {error ? <div className="mr-alert" role="alert">{error}<Button variant="outline" size="sm" onClick={save} disabled={cannotSave}>{t('重试保存')}</Button></div> : null}
    {scenario === 'error' ? <section className="mr-card"><OrderEmptyState Icon={AlertCircle} title={t('月度来源读取失败')} description={t('本次填写和已有快照仍保留。重新读取后继续检查。')} action={<Button onClick={() => setScenario('normal')}>{t('重新读取')}</Button>} /></section> : <>
      <section className="mr-card mr-plan"><div className="mr-heading"><h2>{t('计划与计算范围')}</h2><span>{t('来源快照')} V{state.version} · {state.asOf.slice(0, 16).replace('T', ' ')}</span></div>
        {unsupported ? <div className="mr-alert" role="status">{t('入口产品')}“{incomingProduct}”{t('尚未对应到单产品齐套范围，请明确选择 Q7 或 Q5 后计算。多个型号的试算结果不能直接相加。')}</div> : null}
        <div className="mr-filters"><div><Label htmlFor="mr-month">{t('计划月份')}</Label><Input id="mr-month" type="month" disabled={readonly} value={draft.month} onChange={(event) => { const month = event.target.value; if (monthEnd(month)) change({ month, deadline: monthEnd(month), targetOverride: undefined }); }} /></div><div><Label htmlFor="mr-product">{t('产品')}</Label><NativeSelect id="mr-product" disabled={readonly} value={unsupported ? '' : draft.product} onChange={(event) => chooseProduct(event.target.value)}>{unsupported ? <option value="" disabled>{t('请选择单个产品')}</option> : null}<option value="Q7">Q7</option><option value="Q5">Q5</option></NativeSelect></div><div><Label htmlFor="mr-bom">{t('BOM 版本')}</Label><NativeSelect id="mr-bom" disabled={readonly || unsupported} value={draft.bomVersion} onChange={(event) => change({ bomVersion: event.target.value })}>{state.boms.filter((bom) => bom.product === draft.product).map((bom) => <option key={bom.version} value={bom.version}>{bom.version}</option>)}<option value="unconfirmed">{t('待确认版本')}</option></NativeSelect></div><div><Label htmlFor="mr-mode">{t('供给截止范围')}</Label><NativeSelect id="mr-mode" disabled={readonly || unsupported} value={draft.mode} onChange={(event) => change({ mode: event.target.value as 'month' | 'date', deadline: monthEnd(draft.month) })}><option value="month">{t('按整月')}</option><option value="date">{t('按需求日期')}</option></NativeSelect></div><div><Label htmlFor="mr-deadline">{t('需求日期')}</Label><Input id="mr-deadline" type="date" disabled={readonly || unsupported || draft.mode === 'month'} min={`${draft.month}-01`} max={monthEnd(draft.month)} value={draft.mode === 'month' ? monthEnd(draft.month) : draft.deadline} onChange={(event) => change({ deadline: event.target.value })} /></div></div>
        {!state.plans.some((plan) => plan.product === draft.product && plan.month === draft.month) ? <div className="mr-future"><div><Label htmlFor="mr-target">{t('草稿整机目标（台）')}</Label><Input id="mr-target" type="number" min="0" step="1" disabled={readonly || unsupported} value={draft.targetOverride ?? ''} placeholder={t('填写下月目标')} onChange={(event) => change({ targetOverride: event.target.value === '' ? undefined : Number(event.target.value) })} /></div><p>{t('本月尚无正式目标。按当前产品余量假设，尚未扣除本月后续消耗或滚动分配；结果为草稿情景，不构成生产或交付承诺。')}</p></div> : null}
        <div className="mr-calculation-actions"><p>{t('整月剩余 = 有效整机目标 − 归属本月的已确认整机完工；组件报工、出货和单批次套数不扣减。')}</p><Button disabled={readonly || unsupported} onClick={() => calculate()}><RefreshCw className="size-4" aria-hidden="true" />{t('按当前数据计算')}</Button></div>
      </section>
      {unsupported ? <section className="mr-card"><OrderEmptyState Icon={Layers3} title={t('等待选择产品')} description={t('保留入口上下文，选择已配置 BOM 的单个产品后开始试算。')} /></section> : <>
        {changed || stale ? <div className="mr-alert" role="status"><AlertCircle className="size-4" aria-hidden="true" /><span>{t(stale ? '来源数据已变化，以下为上一次计算结果，请重新计算后保存。' : '计算条件尚未应用，以下仍显示上一次结果。')}</span></div> : null}
        <dl className="mr-metrics" aria-label={t('月度需求口径')}>{metric('整机生产目标', result.target, `${result.input.month} / ${result.input.product} / ${result.input.bomVersion}`)}{metric('有效整机完工', result.completed, '仅计本月已确认整机完工事件')}{metric('整月剩余需求', result.remaining, '不以组件数量或出货量抵扣')}</dl>
        <section className="mr-card mr-assessment"><div className="mr-heading"><div><h2>{t('齐套评估')}</h2><p>{result.input.product} · {result.input.month} · {t('截止')} {result.input.deadline}</p></div><span className="mr-status" data-status={result.status}>{t(statusLabel)}</span></div>
          <div className="mr-readiness"><div><span>{t('当前可配')}</span><strong>{result.currentKits === null ? t('待核对') : `${showQty(result.currentKits)} ${t('套')}`}</strong><p>{t('合格仓库 + 确认未耗用线边')}</p></div><ArrowRight aria-hidden="true" /><div><span>{t('已下单按期预计')}</span><strong>{result.predictedKits === null ? '—' : `${showQty(result.predictedKits)} ${t('套')}`}</strong><p>{t('以预计检验可用日计入')}</p></div><ArrowRight aria-hidden="true" /><div><span>{t('剩余物料缺口')}</span><strong>{result.predictedKits === null || result.remaining === null ? '—' : `${showQty(result.remaining - result.predictedKits)} ${t('套')}`}</strong><p>{result.readyDate ? `${t('物料预计满足日')} ${result.readyDate}` : t('尚不能确定物料满足日')}</p></div></div>
          {result.dataIssues.length ? <div className="mr-quality"><h3><AlertCircle className="size-4" aria-hidden="true" />{t('数据待补齐')} · {result.dataIssues.length} {t('项')}</h3><ul>{result.dataIssues.map((issue) => <li key={issue}>{t(issue)}</li>)}</ul><p>{t('已知仓库量可查看，缺失线边或 BOM 时不输出确定齐套套数。')}</p></div> : <div className="mr-timeline" aria-label={t('已下单预测时间线')}>{result.timeline.map((point, index) => <div key={`${point.date}-${index}`}><span>{index === 0 ? t('当前') : point.date.slice(5)}</span><strong>{showQty(point.kits)}<small>{t('套')}</small></strong><div><i style={{ width: `${result.remaining ? point.kits / result.remaining * 100 : 100}%` }} /></div></div>)}</div>}
          {result.input.deadline < result.asOf.slice(0, 10) ? <p className="mr-note">{t('按当前数据模拟旧需求：当前库存不能倒推为历史当日可用量，原日期齐套结论请查看历史快照。')}</p> : null}
          {result.isDraft ? <p className="mr-note">{t('未来草稿按当前产品余量试算，尚未扣除本月后续消耗与跨月滚动分配；正式下月供给仍须重新确认。')}</p> : null}
          <p className="mr-note">{t('全部必需 BOM 物料参与计算，非重点物料也可能限制齐套。物料满足不代表产能、质量放行或出货已满足。')}</p>
        </section>
        <div className="mr-workspace"><section className="mr-card mr-materials"><div className="mr-heading"><h2>{t('按物料核对覆盖')}</h2><span>{result.materialRows.length} {t('项 BOM 物料')}</span></div><div className="mr-table-wrap"><table><thead><tr>{['物料 / 单机用量', '剩余需求', '仓库 / 线边', '按期订单', '按期净缺口', '依据'].map((label) => <th key={label} scope="col">{t(label)}</th>)}</tr></thead><tbody>{result.materialRows.map((row) => <tr key={row.id}><td><strong>{t(row.name)}</strong><p>{row.per} {t(row.unit)} / {t('台')} · {t(row.critical ? '重点物料' : '全部 BOM')}</p></td><td>{showQty(row.required)}</td><td>{showQty(row.warehouse)} / {showQty(row.line)}</td><td>{showQty(row.orderedByDate)}</td><td className={row.orderGap ? 'mr-gap' : ''}>{result.dataIssues.length ? t('待核对') : showQty(row.orderGap)}</td><td><Button variant="ghost" size="sm" aria-label={`${t('查看物料')} ${t(row.name)}`} onClick={() => setMaterial(row)}>{t('查看')}</Button></td></tr>)}</tbody></table></div><p className="mr-note">{t('按期净缺口已扣除订单未验收义务；不把同一份计划、在途、待检供应重复相加。')}</p></section>
        <section className="mr-card mr-assumptions"><div className="mr-heading"><h2>{t('预测范围与假设')}</h2></div><label className="mr-radio"><Checkbox disabled={readonly} checked={draft.includeUnplaced} onCheckedChange={(checkedValue) => change({ includeUnplaced: (checkedValue === true) })} /><span><strong>{t('同时比较未下单情景')}</strong><small>{t('仅纳入截止日前假定检验可用的采购计划')}</small></span></label>{result.input.includeUnplaced ? <div className="mr-scenario-result"><span>{t('含未下单情景')}</span><strong>{result.scenarioKits === null ? t('待核对') : `${showQty(result.scenarioKits)} ${t('套')}`}</strong><p>{t('假定采购计划按时转单并验收；不计入“已下单按期预计”。')}</p></div> : <p className="mr-note">{t('当前结果只纳入已确认订单。未下单计划不作为确定供给。')}</p>}<ul className="mr-rules"><li>{t('库存扣除冻结及其他计划占用。')}</li><li>{t('线边仅使用确认未耗用量，不叠加在制品折算覆盖。')}</li><li>{t('订单按“订购 − 取消 − 合格验收 − 他用分配”计剩余。')}</li><li>{t('共用物料已人工分配到本产品，各产品试算不可直接相加。')}</li></ul><Button asChild variant="outline"><Link to={`/__preview/key-materials?product=${result.input.product}&month=${result.input.month}${params.get('scope') ? `&scope=${encodeURIComponent(params.get('scope')!)}` : ''}`}>{t('查看关键物料看板')}<ArrowRight className="size-4" aria-hidden="true" /></Link></Button><p className="mr-note">{t('物料看板使用独立演示样例，尚未共享实时库存。')}</p></section></div>
        <section className="mr-card mr-history"><div className="mr-heading"><div><h2><FileClock className="size-4" aria-hidden="true" />{t('历史快照')}</h2><p>{t('查看当时输入和结果；新交期不会改写旧快照。')}</p></div><span>{relevantHistory.length} {t('份保留结果')}</span></div>{relevantHistory.length ? <div className="mr-table-wrap"><table><thead><tr>{['快照 / 保存时间', '月份 / BOM', '目标 / 完工 / 剩余', '当前 / 按期预计', '操作'].map((label) => <th scope="col" key={label}>{t(label)}</th>)}</tr></thead><tbody>{relevantHistory.slice().reverse().map((row) => <tr key={row.id}><td><strong>{t(row.label)}</strong><p>{row.id} · {row.savedAt.slice(0, 16).replace('T', ' ')}</p></td><td>{row.input.month}<p>{row.input.product} / {row.input.bomVersion}</p></td><td>{showQty(row.result.target)} / {showQty(row.result.completed)} / {showQty(row.result.remaining)}</td><td>{showQty(row.result.currentKits)} / {showQty(row.result.predictedKits)}</td><td><Button size="sm" variant="outline" aria-label={`${t('查看快照')} ${row.id}`} onClick={() => setHistory(row)}>{t('查看与比较')}</Button></td></tr>)}</tbody></table></div> : <OrderEmptyState Icon={FileClock} title={t('本产品暂无历史快照')} description={t('核对计算条件后保存首份预测，后续可查看变化。')} />}</section>
      </>}
    </>}
    <Sheet open={Boolean(material)} onOpenChange={(open) => { if (!open) setMaterial(null); }}><SheetContent className="mr-drawer"><SheetHeader><SheetTitle>{t('物料覆盖依据')} · {t(material?.name ?? '')}</SheetTitle><SheetDescription>{t('当前量与预计量分别记录，全部数量以本产品分配为范围。')}</SheetDescription></SheetHeader>{material ? <div className="mr-drawer-body"><dl className="mr-facts"><div><dt>{t('本月物料需求')}</dt><dd>{showQty(material.required)} {t(material.unit)}</dd></div><div><dt>{t('仓库合格可用')}</dt><dd>{showQty(material.warehouse)}</dd></div><div><dt>{t('确认线边未耗用')}</dt><dd>{material.line === null ? t('待核对，不纳入确定齐套') : showQty(material.line)}</dd></div><div><dt>{t('晚到 / 日期未确认义务')}</dt><dd>{showQty(material.lateOrUncertain)}</dd></div></dl><h3>{t('库存来源')}</h3>{material.evidence.map((item) => <p className="mr-note" key={item}>{item}</p>)}<h3>{t('已下单剩余义务')}</h3>{material.orders.length ? material.orders.map((order) => <article className="mr-order-evidence" key={order.allocationId}><strong>{order.orderLineId}</strong><p>{t('订购 / 取消 / 已验收 / 其他占用')}：{order.ordered} / {order.cancelled} / {order.accepted} / {order.allocatedOther}</p><p>{t('到货日期')}：{order.arrivalDate || t('未确认')}</p><p><strong>{t('预计检验可用')}：{order.availableDate || t('未确认')}</strong></p><p>{order.source}</p><small>{t('唯一分配')}：{order.allocationId}</small></article>) : <p className="mr-note">{t('暂无已确认订单分配。')}</p>}<h3>{t('未下单假设')}</h3><p className="mr-note">{showQty(material.unplacedByDate)} {t(material.unit)} · {t('仅参与独立情景，不减少已下单预测中的缺口。')}</p></div> : null}</SheetContent></Sheet>
    <Sheet open={Boolean(history)} onOpenChange={(open) => { if (!open) setHistory(null); }}><SheetContent className="mr-drawer"><SheetHeader><SheetTitle>{t('历史快照与当前数据比较')}</SheetTitle><SheetDescription>{t('左侧为保存时的原始结果，右侧为相同条件按当前来源重算的预览。')}</SheetDescription></SheetHeader>{history ? (() => { const comparison = calculateMonthlyReadiness(state, history.input); return <div className="mr-drawer-body"><p className="mr-note">{history.id} · {history.savedAt}</p><p className="mr-note">{history.input.product} / {history.input.month} / {history.input.bomVersion} · {t('截止')} {history.result.input.deadline}</p><table className="mr-compare"><thead><tr><th>{t('指标')}</th><th>{t('当时快照')}</th><th>{t('当前数据重算')}</th></tr></thead><tbody>{([['整机目标', history.result.target, comparison.target], ['有效整机完工', history.result.completed, comparison.completed], ['整月剩余需求', history.result.remaining, comparison.remaining], ['当前可配', history.result.currentKits, comparison.currentKits], ['已下单按期预计', history.result.predictedKits, comparison.predictedKits]] as [string, number | null, number | null][]).map(([label, before, after]) => <tr key={label}><th>{t(label)}</th><td>{showQty(before)}</td><td>{showQty(after)}{before !== null && after !== null && after !== before ? <small>{after > before ? '+' : ''}{after - before}</small> : null}</td></tr>)}</tbody></table><h3>{t('快照依据')}</h3><p className="mr-note">{history.source} · {t('来源版本')} V{history.result.sourceVersion}</p><p className="mr-note">{t('当前来源版本')} V{state.version} · {state.asOf}</p>{comparison.dataIssues.length ? <div className="mr-quality"><h3>{t('当前数据待补齐')}</h3><ul>{comparison.dataIssues.map((issue) => <li key={issue}>{t(issue)}</li>)}</ul></div> : null}<Button disabled={readonly} onClick={() => requestChange(() => { setDraft({ ...history.input }); calculate(history.input, history.id); setHistory(null); })}>{t('按当前数据重算并准备另存')}</Button><p className="mr-note">{t('此操作只生成新的待保存结果，原快照保持不变。')}</p>{history.sourceSnapshotId ? <p className="mr-note">{t('重算来源快照')}：{history.sourceSnapshotId}</p> : null}</div>; })() : null}</SheetContent></Sheet>
    <AlertDialog open={discardOpen || blocker.state === 'blocked'} onOpenChange={(open) => { if (!open) { setDiscardOpen(false); pendingAction.current = null; if (blocker.state === 'blocked') blocker.reset(); } }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t('放弃未保存的预测？')}</AlertDialogTitle><AlertDialogDescription>{t('本次填写与未保存结果将离开当前操作，已保存快照仍保留。')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t('继续检查')}</AlertDialogCancel><AlertDialogAction onClick={() => { const action = pendingAction.current; pendingAction.current = null; setDirty(false); setDiscardOpen(false); if (blocker.state === 'blocked') blocker.proceed(); else action?.(); }}>{t('放弃并继续')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <AlertDialog open={resetOpen} onOpenChange={setResetOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t('恢复初始演示数据？')}</AlertDialogTitle><AlertDialogDescription>{t('本次未保存填写和新增快照将清空。')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t('取消')}</AlertDialogCancel><AlertDialogAction onClick={reset}>{t('重置演示数据')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </main>;
}
