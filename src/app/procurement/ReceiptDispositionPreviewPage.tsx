import { useRef, useState } from 'react';
import { AlertCircle, ChevronDown, ClipboardList, PackageCheck, RotateCcw, Search, ShieldAlert } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../components/ui/alert-dialog';
import { Button } from '../components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/ui/collapsible';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { useI18n, i18nLocale } from '../lib/i18n';
import { OrderEmptyState, OrderPageHeader } from '../order-processing/components/HorizonPage';
import { ReceiptDispositionForm } from './components/ReceiptDispositionForm';
import { applyDisposition, createDispositionPreviewState, dispositionLimits } from './receiptDispositionPreviewModel';
import { dispositionLabels, type DispositionInput, type DispositionKind, type DispositionRecord } from './receiptDispositionTypes';
import '../order-processing/horizon.css';
import './receipt-disposition-preview.css';

type Scenario = 'normal' | 'empty' | 'error' | 'readonly';
const kinds: DispositionKind[] = ['correction', 'inbound', 'isolation', 'return'];

/** A development-only review surface. All mutations remain in React memory. */
export function ReceiptDispositionPreviewPage() {
  const { t } = useI18n();
  const [state, setState] = useState(createDispositionPreviewState);
  const stateRef = useRef(state);
  const [selectedId, setSelectedId] = useState(state.receipts[0].id);
  const [kind, setKind] = useState<DispositionKind>('inbound');
  const [query, setQuery] = useState('');
  const [batchOpen, setBatchOpen] = useState(false);
  const [scenario, setScenario] = useState<Scenario>('normal');
  const [failNextSave, setFailNextSave] = useState(false);
  const [formGeneration, setFormGeneration] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const pendingAction = useRef<(() => void) | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const receipt = state.receipts.find((item) => item.id === selectedId) ?? state.receipts[0];
  const limits = dispositionLimits(receipt);
  const history = state.records.filter((item) => item.receiptId === receipt.id);
  const filtered = state.receipts.filter((item) => [item.orderNo, item.deliveryNo, item.materialCode, item.materialName, item.supplierName].some((value) => value.toLowerCase().includes(query.trim().toLowerCase())));
  const number = (value: number) => value.toLocaleString(i18nLocale(), { maximumFractionDigits: 3 });
  const qty = (value: number) => `${number(value)} ${receipt.unit}`;
  const round = (value: number) => Math.round(value * 1000) / 1000;
  const uninspected = round(receipt.receivedQty - receipt.qualifiedQty - receipt.defectiveQty - receipt.pendingJudgmentQty);

  function requestChange(action: () => void) {
    if (busyRef.current) return;
    if (dirty) { pendingAction.current = action; setDiscardOpen(true); }
    else action();
  }

  function resetForm() {
    setDirty(false);
    setFormGeneration((value) => value + 1);
  }

  function resetPreview() {
    const next = createDispositionPreviewState();
    stateRef.current = next;
    setState(next);
    setSelectedId(next.receipts[0].id);
    setKind('inbound');
    setQuery('');
    setScenario('normal');
    setFailNextSave(false);
    setBatchOpen(false);
    resetForm();
  }

  async function save(input: DispositionInput) {
    if (busyRef.current) throw new Error(t('正在保存，请稍候。'));
    busyRef.current = true;
    setBusy(true);
    try {
      if (scenario !== 'normal') throw new Error(t('当前演示场景不允许保存。'));
      if (failNextSave) {
        setFailNextSave(false);
        throw new Error(t('演示保存失败，填写内容已保留。请再次保存。'));
      }
      const next = applyDisposition(stateRef.current, receipt.id, receipt.version, input);
      stateRef.current = next;
      setState(next);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const batchList = (surface: string) => <div className="rdp-batch-list">
    <Label htmlFor={`rdp-batch-search-${surface}`} className="sr-only">{t('搜索演示收货批次')}</Label>
    <div className="rdp-search"><Search className="size-4" aria-hidden="true" /><Input id={`rdp-batch-search-${surface}`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('物料、订单或送货单')} disabled={busy} /></div>
    <p className="rdp-small rdp-list-count">{t('{count} 个演示批次', { count: filtered.length })}</p>
    {filtered.map((item) => <button key={item.id} type="button" className="rdp-batch" aria-pressed={item.id === receipt.id} disabled={busy} onClick={() => {
      if (item.id === receipt.id) { setBatchOpen(false); return; }
      requestChange(() => { setSelectedId(item.id); setBatchOpen(false); resetForm(); });
    }}>
      <span className="rdp-batch-name">{item.materialName}<span>{number(item.receivedQty)} {item.unit}</span></span>
      <span>{item.orderNo} · {t('第 {line} 行', { line: item.lineNo })}</span>
      <span>{item.deliveryNo}</span>
      <span className="rdp-batch-status">{t(item.defectiveQty ? '含不良品' : '待检验')}</span>
    </button>)}
    {!filtered.length ? <p role="status" className="rdp-small p-3">{t('未找到匹配批次。')}<Button variant="link" onClick={() => setQuery('')}>{t('清除搜索')}</Button></p> : null}
  </div>;

  function recordDetails(record: DispositionRecord) {
    const valueLabel = record.kind === 'correction' ? t('实收') : record.kind === 'inbound' ? t('累计入库') : record.kind === 'isolation' ? t('累计隔离') : t('累计安排');
    return <li key={record.id} className="rdp-record">
      <div className="rdp-record-heading"><strong>{t(dispositionLabels[record.kind])}</strong><span className="tabular-nums">{record.date}</span></div>
      <p className="rdp-record-change">{valueLabel}<span className="tabular-nums">{number(record.beforeQty)} → {qty(record.afterQty)}</span></p>
      {record.kind === 'return' ? <p className="rdp-record-pending">{t(record.returnMethod === 'replacement' ? '换货 / 补货安排 · 待办理' : '退货安排 · 待办理')}</p> : null}
      <p className="rdp-record-reason">{record.reason}</p>
      <details><summary>{t('查看记录详情')}</summary><dl className="rdp-record-detail">
        <div><dt>{t('登记人')}</dt><dd>{record.createdByName}</dd></div>
        {record.kind !== 'correction' ? <div><dt>{t('本次数量')}</dt><dd>{qty(record.quantity)}</dd></div> : null}
        {record.warehouse ? <div><dt>{t('仓库 / 库位')}</dt><dd>{record.warehouse} / {record.location}</dd></div> : null}
        {record.documentNo ? <div><dt>{t('关联单据')}</dt><dd>{record.documentNo}</dd></div> : null}
        {record.owner ? <div><dt>{t('负责人')}</dt><dd>{record.owner}</dd></div> : null}
        {record.expectedDate ? <div><dt>{t('预计补货')}</dt><dd>{record.expectedDate}</dd></div> : null}
        {record.note ? <div><dt>{t('补充说明')}</dt><dd>{record.note}</dd></div> : null}
      </dl></details>
    </li>;
  }

  return <main className="order-horizon receipt-disposition-preview">
    <OrderPageHeader Icon={PackageCheck} eyebrow={t('供应链 / 收货处理')} title={t('收货处置')} description={t('按收货批次处理纠错、合格入库、不良隔离与退换安排。')} actions={<Button variant="outline" disabled={busy} onClick={() => requestChange(resetPreview)}><RotateCcw className="size-4" aria-hidden="true" />{t('重置演示')}</Button>} />
    <div className="rdp-preview-note"><span>{t('交互预览')}</span><p>{t('演示数据，刷新后恢复。此处操作不会生成正式单据或修改库存。')}</p></div>
    <details className="rdp-scenarios"><summary>{t('演示场景')}</summary><div className="rdp-scenario-options">
      {([['normal', '正常操作'], ['empty', '暂无收货'], ['error', '读取失败'], ['readonly', '仅可查看']] as const).map(([value, label]) => <Button key={value} variant={scenario === value ? 'secondary' : 'outline'} size="sm" aria-pressed={scenario === value} disabled={busy} onClick={() => requestChange(() => { setScenario(value); resetForm(); })}>{t(label)}</Button>)}
      <label className="rdp-failure-toggle"><input type="checkbox" checked={failNextSave} disabled={busy || scenario !== 'normal'} onChange={(event) => setFailNextSave(event.target.checked)} />{t('下次保存失败')}</label>
    </div></details>
    {scenario === 'error' ? <section className="rdp-card"><OrderEmptyState Icon={AlertCircle} title={t('收货批次读取失败')} description={t('这是读取失败的演示状态，已有演示记录保持不变。')} action={<Button onClick={() => setScenario('normal')}>{t('重新加载')}</Button>} /></section>
      : scenario === 'empty' ? <section className="rdp-card"><OrderEmptyState Icon={ClipboardList} title={t('暂无收货批次')} description={t('登记收货后，可按批次进行检验和后续处置。')} action={<Button variant="outline" onClick={() => setScenario('normal')}>{t('返回演示批次')}</Button>} /></section>
        : <div className="rdp-layout">
          <aside className="rdp-desktop-batches rdp-card"><h2>{t('收货批次')}</h2>{batchList('desktop')}</aside>
          <Collapsible className="rdp-mobile-batches rdp-card" open={batchOpen} onOpenChange={setBatchOpen}><CollapsibleTrigger asChild><Button variant="ghost" className="w-full justify-between" disabled={busy}>{t('切换收货批次')} · {receipt.materialName}<ChevronDown className="size-4" aria-hidden="true" /></Button></CollapsibleTrigger><CollapsibleContent>{batchList('mobile')}</CollapsibleContent></Collapsible>
          <div className="rdp-main">
            <section className="rdp-card rdp-source" aria-labelledby="rdp-material-title">
              <div className="rdp-source-title"><div><p className="rdp-small">{receipt.materialCode} · {receipt.spec}</p><h2 id="rdp-material-title">{receipt.materialName}</h2></div><span className="rdp-batch-tag">{t('收货批次')}</span></div>
              <dl className="rdp-source-meta"><div><dt>{t('采购订单')}</dt><dd>{receipt.orderNo} / {t('第 {line} 行', { line: receipt.lineNo })}</dd></div><div><dt>{t('送货单号')}</dt><dd>{receipt.deliveryNo}</dd></div><div><dt>{t('供应商')}</dt><dd>{receipt.supplierName}</dd></div><div><dt>{t('收货日期')}</dt><dd>{receipt.receivedDate}</dd></div></dl>
              <dl className="rdp-facts">{[[t('原始实收'), receipt.originalReceivedQty], [t('当前实收'), receipt.receivedQty], [t('合格'), receipt.qualifiedQty], [t('不良'), receipt.defectiveQty], [t('待判定'), receipt.pendingJudgmentQty], [t('未检验'), uninspected]].map(([label, value]) => <div key={String(label)}><dt>{label}</dt><dd>{number(Number(value))}<span>{receipt.unit}</span></dd></div>)}</dl>
            </section>
            <Tabs value={kind} onValueChange={(value) => requestChange(() => { setKind(value as DispositionKind); resetForm(); })} className="rdp-operation-tabs">
              <TabsList aria-label={t('处置方式')} className="rdp-tab-list">{kinds.map((value) => <TabsTrigger key={value} value={value} disabled={busy}>{t(dispositionLabels[value])}</TabsTrigger>)}</TabsList>
              <TabsContent value={kind}><div className="rdp-workspace">
                <div className="rdp-context">
                  <section className="rdp-card rdp-remaining"><h3>{t('本批待处理')}</h3><dl>
                    <div><dt><PackageCheck className="size-4" aria-hidden="true" />{t('合格待入库')}</dt><dd>{qty(limits.inbound)}</dd></div>
                    <div><dt><ShieldAlert className="size-4" aria-hidden="true" />{t('不良待隔离')}</dt><dd>{qty(limits.isolation)}</dd></div>
                    <div><dt><ClipboardList className="size-4" aria-hidden="true" />{t('可安排退换补货')}</dt><dd>{qty(limits.return)}</dd></div>
                  </dl><p className="rdp-small">{t('已隔离 {isolated}，已安排退换 {planned}。', { isolated: qty(receipt.isolatedQty), planned: qty(receipt.returnPlannedQty) })}</p><p className="rdp-small">{t('已入库 {inbound}（含演示期初）。', { inbound: qty(receipt.inboundQty) })}</p></section>
                  <section className="rdp-card rdp-history"><div className="rdp-section-heading"><h3>{t('处置记录')}</h3><span className="rdp-small tabular-nums">{t('{count} 条', { count: history.length })}</span></div>
                    {history.length ? <ol>{history.map(recordDetails)}</ol> : <div className="rdp-history-empty"><ClipboardList className="size-5" aria-hidden="true" /><p>{t('暂无处置记录')}</p><span>{t('保存后可在此查看数量变化和处理依据。')}</span></div>}
                  </section>
                </div>
                <div className="rdp-form-panel" role="region" aria-label={t('本次处置')}>
                  {scenario === 'readonly' ? <section className="rdp-card"><OrderEmptyState Icon={ShieldAlert} title={t('当前仅可查看')} description={t('仅可查看的演示角色可以核对收货事实与处置记录，不能登记新的处置。')} action={<Button variant="outline" onClick={() => setScenario('normal')}>{t('返回正常操作')}</Button>} /></section> : <ReceiptDispositionForm key={`${receipt.id}:${kind}:${formGeneration}`} receipt={receipt} kind={kind} limits={limits} onSubmit={save} onDirtyChange={setDirty} onCancel={() => requestChange(resetForm)} />}
                </div>
              </div></TabsContent>
            </Tabs>
          </div>
        </div>}
    <AlertDialog open={discardOpen} onOpenChange={(open) => { setDiscardOpen(open); if (!open) pendingAction.current = null; }}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t('放弃尚未保存的填写？')}</AlertDialogTitle><AlertDialogDescription>{t('当前处置尚未保存。继续后将清空本次填写，已保存的演示记录仍会保留；重置演示时会恢复初始数据。')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t('继续填写')}</AlertDialogCancel><AlertDialogAction onClick={() => { const action = pendingAction.current; pendingAction.current = null; setDirty(false); action?.(); }}>{t('放弃并继续')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
    </AlertDialog>
  </main>;
}
