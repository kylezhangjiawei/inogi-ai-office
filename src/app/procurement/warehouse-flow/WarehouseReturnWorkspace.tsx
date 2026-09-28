import { Link, useSearchParams } from 'react-router';
import { ArrowRight, CheckCircle2, RotateCcw } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { NativeSelect } from '../../components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { useI18n } from '../../lib/i18n';
import { routePath } from '../../lib/routePaths';
import type { WarehouseRecord } from '../../lib/warehouseRecordsApi';
import type { WarehouseIssue } from '../../lib/warehouseFlowApi';
import { WarehousePagination } from './WarehousePagination';
import { warehousePage, warehouseQuery, warehouseSearch } from './warehouseViewState';

export const returnState = (row: WarehouseRecord) => row.status === 'confirmed' ? '已接收' : row.status === 'cancelled' ? '已撤销' : row.review?.open ? '待核对' : '待接收';
export const returnQuality = (row: WarehouseRecord) => [row.qualifiedQty > 0 && '良品', row.defectiveQty > 0 && '不良', row.pendingQty > 0 && '待判'].filter(Boolean).join(' / ') || '待确认';

export function WarehouseReturnWorkspace({ records, issues, taskId, actions }: {
  records: WarehouseRecord[]; issues: WarehouseIssue[]; taskId?: string; actions: (row: WarehouseRecord) => React.ReactNode;
}) {
  const { t } = useI18n();
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
    warehouseSearch(search, [row.id, row.name, row.code, row.batch, row.stockBatchNo, row.sourceId, issues.find(issue => issue.taskId === row.taskId)?.title]),
  );
  const page = warehousePage(rows, params.get('recordPage'));
  const selectedId = params.get('record');
  const selected = selectedId ? scoped.find(row => row.id === selectedId) : page.rows[0];
  const source = issues.find(issue => issue.taskId === selected?.taskId);
  const index = selected ? rows.findIndex(row => row.id === selected.id) : -1;
  const number = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 3 });
  return <div className="warehouse-return-workspace">
    <section className="warehouse-surface warehouse-return-list" aria-label={t('退料单列表')}>
      <header className="warehouse-return-heading"><div><h3>{t('待接收退料')}</h3><p>{t('先核对原单与实物，再确认接收。')}</p></div><span className="warehouse-return-count">{scoped.filter(row => row.status === 'pending').length}<small>{t('待处理')}</small></span></header>
      {taskId && <div className="warehouse-return-context"><span>{t('当前派工')}：{issues.find(issue => issue.taskId === taskId)?.title || taskId}</span><Button size="sm" variant="ghost" onClick={() => filter({ returnTask: null, workbenchTab: 'returns' })}>{t('查看全部退料')}</Button></div>}
      <div className="warehouse-return-filters">
        <Input aria-label={t('搜索退料单')} placeholder={t('搜索单号、物料、批号或派工单')} value={search} onChange={event => filter({ recordQ: event.target.value })} />
        <NativeSelect aria-label={t('退料日期')} value={date} onChange={event => filter({ returnDate: event.target.value })}><option value="all">{t('全部日期')}</option><option value="today">{t('今日')}</option><option value="month">{t('本月')}</option></NativeSelect>
        <NativeSelect aria-label={t('退料状态')} value={status} onChange={event => filter({ returnStatus: event.target.value })}><option value="pending">{t('待处理（含待核对）')}</option><option value="review">{t('待核对')}</option><option value="confirmed">{t('已接收')}</option><option value="cancelled">{t('已撤销')}</option><option value="all">{t('全部状态')}</option></NativeSelect>
        <NativeSelect aria-label={t('退料类型')} value={type} onChange={event => filter({ returnType: event.target.value })}><option value="all">{t('全部类型')}</option><option value="qualified">{t('良品')}</option><option value="defective">{t('不良')}</option><option value="pending">{t('待判')}</option></NativeSelect>
      </div>
      {!rows.length ? <div className="warehouse-return-empty"><CheckCircle2 className="size-7 text-muted-foreground" aria-hidden="true" /><h3>{t('暂无匹配退料单')}</h3><p>{t('可调整筛选，或在领料签收后发起退料。')}</p><Button variant="outline" onClick={() => filter({ recordQ: null, returnDate: null, returnType: null, returnStatus: 'all' })}>{t('查看全部状态')}</Button></div> : <div className="warehouse-table-scroll"><Table className="min-w-[640px]" aria-label={t('退料单')}><TableHeader><TableRow>{['退料单 / 物料', '生产批次', '退回数量', '类型 / 状态', '填报日期'].map(label => <TableHead key={label} scope="col">{t(label)}</TableHead>)}</TableRow></TableHeader><TableBody>{page.rows.map(row => <TableRow key={row.id} data-state={selected?.id === row.id ? 'selected' : undefined}><TableCell><Button variant="unstyled" type="button" className="warehouse-return-select" aria-pressed={selected?.id === row.id} onClick={() => change({ record: row.id })}><strong>{row.name}</strong><span>{row.code}</span><span title={row.id}>{row.id}</span></Button></TableCell><TableCell className="text-xs">{row.batch || t('未填写')}</TableCell><TableCell className="font-semibold tabular-nums">{number(row.quantity)} <small>{row.unit}</small></TableCell><TableCell><p className="text-xs">{t(returnQuality(row))}</p><span className={`warehouse-return-status is-${row.status}`}>{t(returnState(row))}</span></TableCell><TableCell className="text-xs tabular-nums">{row.date}</TableCell></TableRow>)}</TableBody></Table></div>}
      <WarehousePagination {...page} onPage={value => change({ recordPage: String(value), record: null })} />
    </section>
    <aside className="warehouse-surface warehouse-return-detail" aria-label={t('退料单详情')}>
      {!selected ? <div className="warehouse-return-empty"><RotateCcw className="size-7 text-muted-foreground" aria-hidden="true" /><h3>{t(selectedId ? '退料单不在当前范围' : '请选择退料单')}</h3><p>{t('选中后可查看来源、核对数量并办理接收。')}</p>{selectedId && <Button variant="outline" onClick={() => change({ record: null })}>{t('返回当前列表')}</Button>}</div> : <>
        <header className="warehouse-return-heading"><div><h3>{t('退料单详情')}</h3><span className={`warehouse-return-status is-${selected.status}`}>{t(returnState(selected))}</span></div><div className="flex gap-1"><Button size="sm" variant="ghost" disabled={index <= 0} onClick={() => change({ record: rows[index - 1].id, recordPage: String(Math.floor((index - 1) / 12) + 1) })}>{t('上一单')}</Button><Button size="sm" variant="ghost" disabled={index < 0 || index >= rows.length - 1} onClick={() => change({ record: rows[index + 1].id, recordPage: String(Math.floor((index + 1) / 12) + 1) })}>{t('下一单')}</Button></div></header>
        <div className="warehouse-return-material"><h2>{selected.name}</h2><p>{selected.code}</p><span className="warehouse-return-id">{t('退料单号')}：{selected.id}</span><div className="warehouse-return-quantity"><strong>{number(selected.quantity)}</strong><span>{selected.unit} · {t('申请退回')}</span></div></div>
        <section className="warehouse-detail-section"><h3 className="mb-3 text-sm font-semibold">{t('原单信息')}</h3><dl className="warehouse-return-facts">{[['关联派工', source?.title || selected.taskId || '未关联'], ['原领料单', selected.sourceId], ['生产批次', selected.batch || '未填写'], ['实际库存批号', selected.stockBatchNo || '待补'], ['接收仓库', selected.warehouse], ['处理库位', selected.receivingLocation || '待接收时填写'], ['退料来源', selected.origin === 'defect' ? '已报工不良耗用物料' : '未耗用线边物料'], ['关联质量记录', selected.qualityId || '未关联']].map(([label, value]) => <div key={label}><dt>{t(label)}</dt><dd>{value}</dd></div>)}</dl>{source && <Button asChild variant="link" className="mt-2 px-0"><Link to={`${routePath('page:warehouse-flow', '/warehouse-flow')}?issue=${encodeURIComponent(source.id)}`}>{t('查看原领料单')}<ArrowRight className="size-3" aria-hidden="true" /></Link></Button>}</section>
        <section className="warehouse-detail-section"><h3 className="mb-3 text-sm font-semibold">{t('退料质量状态')}</h3><dl className="warehouse-facts">{[['良品', selected.qualifiedQty], ['不良隔离', selected.defectiveQty], ['待判', selected.pendingQty]].map(([label, value]) => <div key={label}><dt>{t(String(label))}</dt><dd>{number(Number(value))} {selected.unit}</dd></div>)}</dl><p className="mt-3 text-xs leading-5 text-muted-foreground">{t('按原单保留质量状态，接收时不能将不良或待判改为良品。')}</p></section>
        {selected.review?.open && <section className="warehouse-return-review" role="status"><h3>{t('已退回原填报人核对')}</h3><p>{t('仓库清点')}：{number(selected.review.actualQty)} {selected.unit}</p><p>{selected.review.reason}</p><small>{selected.review.actorName} · {new Date(selected.review.at).toLocaleString()}</small></section>}
        <details className="warehouse-detail-section"><summary className="cursor-pointer text-sm font-semibold">{t('处理记录')}（{selected.events.length}）</summary><ol className="mt-3 space-y-3">{[...selected.events].reverse().map((event, i) => <li key={i}><p className="text-xs text-muted-foreground">{event.actorName} · {new Date(event.at).toLocaleString()}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm">{event.reason}</p></li>)}</ol></details>
        <footer className="warehouse-return-footer">{actions(selected)}</footer>
      </>}
    </aside>
  </div>;
}
