import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ArrowRight, CheckCircle2, RotateCcw } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { NativeSelect } from '../../components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { useI18n } from '../../lib/i18n';
import { routePath } from '../../lib/routePaths';
import { useAnyPermission } from '../../hooks/usePermission';
import { QualityAnalysisDialog } from '../quality/QualityAnalysisDialog';
import type { WarehouseRecord } from '../../lib/warehouseRecordsApi';
import type { WarehouseIssue } from '../../lib/warehouseFlowApi';
import { WarehousePagination } from './WarehousePagination';
import { warehousePage, warehouseQuery, warehouseSearch } from './warehouseViewState';
import '../../production/execution/production-theme.css';
import './warehouse-return-workspace.css';

export const returnState = (row: WarehouseRecord) => row.status === 'confirmed' ? '已接收' : row.status === 'cancelled' ? '已撤销' : row.review?.open ? '待核对' : '待接收';
export const returnQuality = (row: WarehouseRecord) => [row.qualifiedQty > 0 && '良品', row.defectiveQty > 0 && '不良', row.pendingQty > 0 && '待判'].filter(Boolean).join(' / ') || '待确认';

export function WarehouseReturnWorkspace({ records, issues, taskId, actions }: {
  records: WarehouseRecord[]; issues: WarehouseIssue[]; taskId?: string; actions: (row: WarehouseRecord) => React.ReactNode;
}) {
  const { t } = useI18n();
  const canReadQuality = useAnyPermission('proc-quality:manage', 'proc-quality:verify', 'page:proc-cockpit', 'page:rd-director-dashboard', 'production:plan', 'production:inspect', 'production:view-all');
  const [qualityId, setQualityId] = useState<string | null>(null);
  const detailRef = useRef<HTMLElement | null>(null);
  const [focusRequest, setFocusRequest] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const search = params.get('recordQ') || '', status = params.get('returnStatus') || 'pending';
  const date = params.get('returnDate') || 'all', type = params.get('returnType') || 'all';
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const change = (patch: Record<string, string | null>) => setParams(previous => warehouseQuery(previous, patch));
  const filter = (patch: Record<string, string | null>) => change({ ...patch, record: null, recordPage: null });
  const scoped = records.filter(row => row.kind === 'return' && (!taskId || row.taskId === taskId));
  const rows = scoped.filter(row =>
    (status === 'all' || (status === 'review' ? row.status === 'pending' && row.review?.open : row.status === status)) &&
    (date === 'all' || (date === 'today' ? row.date === today : row.date.startsWith(today.slice(0, 7)))) &&
    (type === 'all' || (type === 'qualified' ? row.qualifiedQty > 0 : type === 'defective' ? row.defectiveQty > 0 : row.pendingQty > 0)) &&
    warehouseSearch(search, [row.id, row.name, row.code, row.batch, row.stockBatchNo, row.sourceId, row.taskId, issues.find(issue => issue.id === row.sourceId)?.title]),
  );
  const page = warehousePage(rows, params.get('recordPage'));
  const selectedId = params.get('record');
  const selected = selectedId ? scoped.find(row => row.id === selectedId) : page.rows[0];
  useEffect(() => {
    if (!focusRequest || selected?.id !== focusRequest) return;
    detailRef.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
    detailRef.current?.focus({ preventScroll: true });
    setFocusRequest(null);
  }, [focusRequest, selected?.id]);
  const source = issues.find(issue => issue.id === selected?.sourceId);
  const index = selected ? rows.findIndex(row => row.id === selected.id) : -1;
  const number = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 3 });
  const eventNames: Record<string, string> = { return: '生产提报', 'review-return': '退回核对', 'resubmit-return': '核对后重新提交', 'receive-return': '确认实收', reconcile: '核对 ERP 凭证', cancel: '撤销退料' };
  return <><div className="production-ui-theme warehouse-return-workspace">
    <div className="warehouse-return-list-column">
    <section className="warehouse-surface warehouse-return-list" aria-label={t('退料单列表')}>
      <header className="warehouse-return-heading"><div><h3>{t('待接收退料')}</h3><p>{t('先核对原单与实物，再确认接收。')}</p></div><span className="warehouse-return-count">{scoped.filter(row => row.status === 'pending').length}<small>{t('待处理')}</small></span></header>
      {taskId && <div className="warehouse-return-context"><span>{t('当前生产作业')}：{issues.find(issue => issue.taskId === taskId)?.title || taskId}</span><Button size="sm" variant="ghost" onClick={() => filter({ returnTask: null, workbenchTab: 'returns' })}>{t('查看全部退料')}</Button></div>}
      <div className="warehouse-return-filters">
        <Input aria-label={t('搜索退料单')} placeholder={t('搜索退料单、物料、批号或生产单号')} value={search} onChange={event => filter({ recordQ: event.target.value })} />
        <NativeSelect aria-label={t('退料日期')} value={date} onChange={event => filter({ returnDate: event.target.value })}><option value="all">{t('全部日期')}</option><option value="today">{t('今日')}</option><option value="month">{t('本月')}</option></NativeSelect>
        <NativeSelect aria-label={t('退料状态')} value={status} onChange={event => filter({ returnStatus: event.target.value })}><option value="pending">{t('待处理（含待核对）')}</option><option value="review">{t('待核对')}</option><option value="confirmed">{t('已接收')}</option><option value="cancelled">{t('已撤销')}</option><option value="all">{t('全部状态')}</option></NativeSelect>
        <NativeSelect aria-label={t('退料类型')} value={type} onChange={event => filter({ returnType: event.target.value })}><option value="all">{t('全部类型')}</option><option value="qualified">{t('良品')}</option><option value="defective">{t('不良')}</option><option value="pending">{t('待判')}</option></NativeSelect>
      </div>
      {!rows.length ? <div className="warehouse-return-empty"><CheckCircle2 className="size-7 text-muted-foreground" aria-hidden="true" /><h3>{t('暂无匹配退料单')}</h3><p>{t('可调整筛选，或在领料签收后发起退料。')}</p><Button variant="outline" onClick={() => filter({ recordQ: null, returnDate: null, returnType: null, returnStatus: 'all' })}>{t('查看全部状态')}</Button></div> : <div className="warehouse-table-scroll"><Table className="min-w-[640px]" aria-label={t('退料单')}><TableHeader><TableRow>{['退料单 / 物料', '生产单号', '退回数量', '类型 / 状态', '填报日期'].map(label => <TableHead key={label} scope="col">{t(label)}</TableHead>)}</TableRow></TableHeader><TableBody>{page.rows.map(row => <TableRow key={row.id} data-state={selected?.id === row.id ? 'selected' : undefined}><TableCell><Button variant="unstyled" type="button" className="warehouse-return-select" aria-pressed={selected?.id === row.id} onClick={() => change({ record: row.id })}><strong>{row.name}</strong><span>{row.code}</span><span title={row.id}>{row.id}</span></Button></TableCell><TableCell className="text-xs">{row.batch || t('未填写')}</TableCell><TableCell className="font-semibold tabular-nums">{number(row.quantity)} <small>{row.unit}</small></TableCell><TableCell><p className="text-xs">{t(returnQuality(row))}</p><span className={`warehouse-return-status is-${row.status}`}>{t(returnState(row))}</span></TableCell><TableCell className="text-xs tabular-nums">{row.date}</TableCell></TableRow>)}</TableBody></Table></div>}
      {rows.length > 0 && <ul className="warehouse-return-mobile-list" aria-label={t('退料单卡片')}>{page.rows.map(row => <li key={row.id} data-selected={selected?.id === row.id || undefined}>
        <header><div><h4>{row.name}</h4><p>{row.code}</p></div><span className={`warehouse-return-status is-${row.status}`}>{t(returnState(row))}</span></header>
        <dl><div><dt>{t('生产单号')}</dt><dd>{row.batch || t('未填写')}</dd></div><div><dt>{t('退回数量')}</dt><dd className="tabular-nums">{number(row.quantity)} {row.unit}</dd></div><div><dt>{t('退料类型')}</dt><dd>{t(returnQuality(row))}</dd></div></dl>
        <footer><span>{row.date}</span><Button size="sm" variant="outline" aria-label={t('查看退料详情：{id}', { id: row.id })} onClick={() => { change({ record: row.id }); setFocusRequest(row.id); }}>{t('查看详情')}<ArrowRight className="size-3" aria-hidden="true" /></Button></footer>
      </li>)}</ul>}
      <WarehousePagination {...page} onPage={value => change({ recordPage: String(value), record: null })} />
    </section>
    {selected && <section className="warehouse-surface warehouse-return-impact" aria-label={t('本次接收库存影响')}>
      <header><h3>{t('本次接收库存影响')}</h3><span className={`warehouse-return-status is-${selected.status}`}>{t(selected.status === 'confirmed' ? '已确认接收' : selected.status === 'cancelled' ? '已撤销 · 不产生接收' : '未接收 · 申请量预览')}</span></header>
      <p className="warehouse-return-impact-source">{selected.id} · {selected.name} · {selected.warehouse}</p>
      <div className="warehouse-return-impact-buckets">{[['良品接收', selected.qualifiedQty, '核对 ERP 生效凭证并同步后，按主账确认可用量。'], ['不良隔离', selected.defectiveQty, '不增加合格可用库存，继续沿原质量记录处置。'], ['待判隔离', selected.pendingQty, '保持待判状态，不增加合格可用库存。']].map(([label, qty, note]) => <article key={String(label)}><h4>{t(String(label))}</h4><strong className="tabular-nums">{number(selected.status === 'cancelled' ? 0 : Number(qty))}<small>{selected.unit}</small></strong><span>{t(selected.status === 'confirmed' ? '本单已接收' : selected.status === 'cancelled' ? '本单未接收' : '本单拟接收')}</span><p>{t(String(note))}</p></article>)}</div>
      <div className="warehouse-return-impact-note"><p>{t(selected.origin === 'defect' ? '来源为已报工不良耗用物料，按不良退回登记，不重复扣减未耗用线边量。' : selected.origin === 'unused' ? '未耗用线边物料在仓库确认实收后，按本单数量从对应线边余料中扣减。' : '退料来源尚未明确，线边数量须按原领料单核对。')}</p>{selected.status === 'pending' && <p>{t(selected.review?.open ? '本单仍待核对；以上按申请量预览，清点差异尚未替代申请量，重新提交并确认前不计接收。' : '以上为本单申请量预览，确认实收前不计入已接收数量。')}</p>}<p>{t('ERP 主账库存以已生效凭证和同步结果为准，本区不把退料接收数直接相加为可用库存。')}</p></div>
      {selected.status === 'confirmed' && <div className="warehouse-return-reconciliation"><strong>{t(selected.reconciliation ? 'ERP 凭证已人工核对' : 'ERP 凭证待核对')}</strong>{selected.reconciliation ? <><p>{selected.reconciliation.voucher} · {t('行号')} {selected.reconciliation.line}</p><p>{selected.reconciliation.actorName} · {new Date(selected.reconciliation.at).toLocaleString()}</p><p>{selected.reconciliation.evidence}</p></> : <p>{t('本单已确认实物接收，ERP 凭证核对仍需在原单办理。')}</p>}</div>}
    </section>}
    </div>
    <aside ref={detailRef} tabIndex={-1} className="warehouse-surface warehouse-return-detail" aria-label={t('退料单详情')}>
      {!selected ? <div className="warehouse-return-empty"><RotateCcw className="size-7 text-muted-foreground" aria-hidden="true" /><h3>{t(selectedId ? '退料单不在当前范围' : '请选择退料单')}</h3><p>{t('选中后可查看来源、核对数量并办理接收。')}</p>{selectedId && <Button variant="outline" onClick={() => change({ record: null })}>{t('返回当前列表')}</Button>}</div> : <>
        <header className="warehouse-return-heading"><div><h3>{t('退料单详情')}</h3><span className={`warehouse-return-status is-${selected.status}`}>{t(returnState(selected))}</span></div><div className="flex gap-1"><Button size="sm" variant="ghost" disabled={index <= 0} onClick={() => change({ record: rows[index - 1].id, recordPage: String(Math.floor((index - 1) / 12) + 1) })}>{t('上一单')}</Button><Button size="sm" variant="ghost" disabled={index < 0 || index >= rows.length - 1} onClick={() => change({ record: rows[index + 1].id, recordPage: String(Math.floor((index + 1) / 12) + 1) })}>{t('下一单')}</Button></div></header>
        <div className="warehouse-return-material"><h2>{selected.name}</h2><p>{selected.code}</p><span className="warehouse-return-id">{t('退料单号')}：{selected.id}</span><div className="warehouse-return-quantity"><strong>{number(selected.quantity)}</strong><span>{selected.unit} · {t('申请退回')}</span></div></div>
        <section className="warehouse-detail-section"><h3 className="mb-3 text-sm font-semibold">{t('原单信息')}</h3><dl className="warehouse-return-facts">{[['生产单号', selected.batch || '未填写'], ['生产作业', source?.title || selected.taskId || '未关联'], ['产品型号', source?.productLine || '原领料单未提供'], ['来源产线', '原领料单未提供'], ['原领料单', selected.sourceId], ['实际库存批号', selected.stockBatchNo || '待补'], ['接收仓库', selected.warehouse], ['处理库位', selected.receivingLocation || '待接收时填写'], ['退料来源', selected.origin === 'defect' ? '已报工不良耗用物料' : selected.origin === 'unused' ? '未耗用线边物料' : '待核对'], ['关联质量记录', selected.qualityId || '未关联']].map(([label, value]) => <div key={label}><dt>{t(label)}</dt><dd>{value}</dd></div>)}</dl><div className="flex flex-wrap gap-x-4">{source && <Button asChild variant="link" className="mt-2 px-0"><Link to={`${routePath('page:warehouse-flow', '/warehouse-flow')}?workbenchTab=issues&issue=${encodeURIComponent(source.id)}`}>{t('查看原领料单')}<ArrowRight className="size-3" aria-hidden="true" /></Link></Button>}{selected.qualityId && canReadQuality && <Button variant="link" className="mt-2 px-0" onClick={() => setQualityId(selected.qualityId!)}>{t('查看原质量记录')}<ArrowRight className="size-3" aria-hidden="true" /></Button>}</div></section>
        <section className="warehouse-detail-section"><h3 className="mb-3 text-sm font-semibold">{t('退料质量状态')}</h3><dl className="warehouse-facts">{[['良品', selected.qualifiedQty], ['不良隔离', selected.defectiveQty], ['待判', selected.pendingQty]].map(([label, value]) => <div key={label}><dt>{t(String(label))}</dt><dd>{number(Number(value))} {selected.unit}</dd></div>)}</dl><p className="mt-3 text-xs leading-5 text-muted-foreground">{t('按原单保留质量状态，接收时不能将不良或待判改为良品。')}</p></section>
        {selected.review?.open && <section className="warehouse-return-review" role="status"><h3>{t('已退回原填报人核对')}</h3><p>{t('仓库清点')}：{number(selected.review.actualQty)} {selected.unit}</p><p>{selected.review.reason}</p><small>{selected.review.actorName} · {new Date(selected.review.at).toLocaleString()}</small></section>}
        <section className="warehouse-detail-section warehouse-return-history"><h3 className="text-sm font-semibold">{t('处理记录')}（{selected.events.length}）</h3>{selected.events.length ? <ol className="mt-3 space-y-3">{[...selected.events].reverse().map((event, i) => <li key={i}><p className="text-xs"><strong>{t(eventNames[event.action] || '单据处理')}</strong> · {event.actorName}</p><p className="mt-1 text-xs text-muted-foreground">{new Date(event.at).toLocaleString()}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm">{event.reason}</p></li>)}</ol> : <p className="mt-3 text-xs text-muted-foreground">{t('暂无处理记录')}</p>}</section>
        <footer className="warehouse-return-footer">{actions(selected)}</footer>
      </>}
    </aside>
  </div>{qualityId && canReadQuality && selected?.qualityId === qualityId && <QualityAnalysisDialog id={qualityId} onClose={() => setQualityId(null)} onSaved={() => setQualityId(null)} />}</>;
}
