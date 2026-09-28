import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ArrowLeft, ClipboardList, Plus, RefreshCw } from 'lucide-react';
import { useAuth } from '../../auth';
import { hasPermission } from '../../lib/permissions';
import { useI18n } from '../../lib/i18n';
import { routePath } from '../../lib/routePaths';
import { commandWarehouseRecord, getWarehouseRecords, type WarehouseRecord } from '../../lib/warehouseRecordsApi';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { NativeSelect } from '../../components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { OperationalDialog, type OperationEditor } from '../../production/execution/OperationalDialog';
import { WarehousePagination } from '../../procurement/warehouse-flow/WarehousePagination';
import { warehousePage, warehouseQuery, warehouseSearch } from '../../procurement/warehouse-flow/warehouseViewState';
import { OrderEmptyState, OrderPageHeader } from '../components/HorizonPage';
import { useWarehouseResource } from './warehouseCockpitState';
import '../horizon.css';
import '../../procurement/warehouse-flow/warehouseFlow.css';

const loadCounts = (signal: AbortSignal) => getWarehouseRecords(signal);
const countStatus = (row: WarehouseRecord) => row.status === 'cancelled' ? '已撤销' : row.status === 'confirmed' ? '已复核' : row.countStage === 'counting' ? '待实盘' : '待复核';
const reasonField = { key: 'reason', label: '依据与说明', type: 'textarea' as const };

export function InventoryCountPage() {
  const { user } = useAuth();
  return <InventoryCountContent key={JSON.stringify([user?.id, user?.permissions])} />;
}

function InventoryCountContent() {
  const { user } = useAuth(), { t } = useI18n();
  const can = (code: string) => hasPermission(user?.permissions ?? [], code);
  const access = can('page:warehouse-flow') || can('page:warehouse-count');
  const canStart = access && can('warehouse:count-initiate');
  const [params, setParams] = useSearchParams();
  const [version, setVersion] = useState(0);
  const [editor, setEditor] = useState<OperationEditor | null>(null);
  const [starting, setStarting] = useState(params.get('new') === '1' && canStart);
  const resource = useWarehouseResource(access ? `counts:${version}` : null, loadCounts);
  const records = resource.data?.records.filter(row => row.kind === 'count') ?? [];
  const search = params.get('q') ?? '', status = params.get('status') ?? 'all';
  const rows = records.filter(row => (status === 'all' || countStatus(row) === status) && warehouseSearch(search, [row.id, row.code, row.name, row.warehouse, row.batch, row.actorName]));
  const page = warehousePage<WarehouseRecord>(rows, params.get('page'));
  const selected = records.find(row => row.id === params.get('record'));
  const change = (patch: Record<string, string | null>) => setParams(previous => warehouseQuery(previous, patch));
  const quantity = (value?: number) => value == null ? '—' : value.toLocaleString('zh-CN', { maximumFractionDigits: 3 });
  const refresh = () => setVersion(value => value + 1);
  const balances = resource.data?.balances.filter(row => row.syncedAt && row.unit?.trim() && row.warehouse?.trim() && Number.isFinite(Number(row.stockQty)) && Number(row.stockQty) >= 0) ?? [];
  const startEditor: OperationEditor = {
    title: t('发起库存盘点'), description: t('按物料与仓库的合格库存汇总建立盘点单。发起只保存账面快照，不填写实盘、不调整库存。'),
    fields: [
      { key: 'balance', label: t('盘点物料与仓库'), options: balances.map((row, index) => ({ value: String(index), label: `${row.material?.name || row.tpInventoryCode} · ${row.tpInventoryCode} · ${row.warehouse} · ${row.stockQty} ${row.unit}` })) },
      { key: 'batch', label: t('盘点批次 / 范围说明') }, reasonField,
    ],
    submit: async (values, requestId) => {
      const balance = balances[Number(values.balance)];
      if (!balance) throw new Error(t('请选择盘点物料与仓库'));
      const result = await commandWarehouseRecord({ action: 'start-count', requestId, data: { code: balance.tpInventoryCode, warehouse: balance.warehouse, batch: values.batch, reason: values.reason } });
      change({ record: result.id, new: null });
    },
  };
  const openAction = (row: WarehouseRecord, action: string, title: string, fields: OperationEditor['fields'], description: string) => setEditor({
    title: t(title), description: t(description), fields: [...fields, reasonField],
    submit: (data, requestId) => commandWarehouseRecord({ action, requestId, id: row.id, version: row.version, data }),
  });
  const close = () => { setStarting(false); setEditor(null); change({ new: null }); };
  const actionButtons = (row: WarehouseRecord) => <>
    {row.status === 'pending' && row.countStage === 'counting' && can('warehouse:count') && <Button onClick={() => openAction(row, 'submit-count', '填写实盘', [{ key: 'countedQty', label: t('实盘合格数量'), type: 'number' }], '填写该物料在当前仓库的全部合格库存实盘数量，不是单个批号的数量。提交后等待独立复核，不直接调整库存。')}>{t('填写实盘')}</Button>}
    {row.status === 'pending' && row.countStage !== 'counting' && row.countedQty != null && (row.countedBy ?? row.actorId) !== user?.id && can('warehouse:adjust') && <Button onClick={() => openAction(row, 'approve-count', '复核调整', [{ key: 'confirmed', label: t('已核对实盘结果、差异及受影响库存'), type: 'checkbox' }], '复核后登记库存调整记录，保留原账；不会直接回写 ERP。盘盈待 ERP 核对同步后再计入可用库存。')}>{t('复核调整')}</Button>}
    {row.status === 'confirmed' && !row.reconciliation && can('warehouse:reconcile') && <Button variant="outline" onClick={() => openAction(row, 'reconcile', '核对 ERP 库存凭证', [{ key: 'voucher', label: t('生效凭证号') }, { key: 'line', label: t('凭证行号') }, { key: 'quantity', label: t('本次盘点差额'), type: 'number', min: -1000000000 }, { key: 'posted', label: t('已核对凭证生效'), type: 'checkbox' }, { key: 'detailsMatch', label: t('物料、仓库、单位、良品 / 隔离状态均一致'), type: 'checkbox' }], '人工核对不代表 ERP 已同步。')}>{t('核对 ERP 凭证')}</Button>}
    {row.status === 'pending' && row.actorId === user?.id && <Button variant="outline" onClick={() => openAction(row, 'cancel', '撤销盘点', [{ key: 'confirmed', label: t('确认撤销此盘点单并保留记录'), type: 'checkbox' }], '撤销后保留原单与操作记录，不产生库存调整。')}>{t('撤销盘点')}</Button>}
  </>;

  return <main className="horizon-theme order-horizon mx-auto flex w-full min-w-0 flex-col gap-4 pb-5">
    <OrderPageHeader Icon={ClipboardList} eyebrow={t('订单与库存')} title={t('库存盘点')} actions={<>
      {can('page:warehouse-flow') && <Button asChild variant="outline"><Link to={routePath('page:warehouse-flow', '/warehouse-flow')}><ArrowLeft className="size-4" aria-hidden="true" />{t('仓库工作台')}</Link></Button>}
      <Button variant="outline" onClick={refresh} disabled={resource.loading}><RefreshCw className="size-4" aria-hidden="true" />{t('刷新')}</Button>
      {canStart && <Button onClick={() => { setStarting(true); change({ new: '1' }); }} disabled={!balances.length || resource.loading}><Plus className="size-4" aria-hidden="true" />{t('发起盘点')}</Button>}
    </>} />
    {!access ? <OrderEmptyState Icon={ClipboardList} title={t('暂无此项数据的查看权限')} /> : resource.error ? <div role="alert" className="warehouse-surface p-5"><p>{resource.error}</p><Button variant="outline" onClick={refresh}>{t('重新加载')}</Button></div> : !resource.data ? <p role="status" className="p-5">{t('正在加载')}</p> : <>
      {canStart && !balances.length && <p role="status" className="text-sm text-muted-foreground">{t('暂无具备同步来源和单位的库存，请先核对库存数据后发起盘点。')}</p>}
      {params.has('record') ? !selected ? <OrderEmptyState Icon={ClipboardList} title={t('未找到盘点单')} action={<Button onClick={() => change({ record: null })}>{t('返回盘点列表')}</Button>} /> : <>
        <Button variant="ghost" className="self-start" onClick={() => change({ record: null })}><ArrowLeft className="size-4" aria-hidden="true" />{t('返回盘点列表')}</Button>
        <section className="warehouse-surface p-5" aria-label={t('盘点单信息')}><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs text-muted-foreground">{selected.id}</p><h2 className="mt-2 text-xl font-semibold text-balance">{selected.batch}</h2><p className="mt-2 text-sm">{selected.warehouse} · {selected.date} · {t(countStatus(selected))}</p></div><div className="flex flex-wrap gap-2">{actionButtons(selected)}</div></div></section>
        <section className="warehouse-surface overflow-hidden" aria-label={t('盘点明细')}><h2 className="p-5 text-base font-semibold text-balance">{t('盘点明细')}</h2><Table className="min-w-[640px]"><TableHeader><TableRow>{['物料 / 编码', '库存口径', '账面数量', '实盘数量', '差异'].map(label => <TableHead key={label}>{t(label)}</TableHead>)}</TableRow></TableHeader><TableBody><TableRow><TableCell><p>{selected.name}</p><p className="text-xs text-muted-foreground">{selected.code}</p></TableCell><TableCell>{t('仓库合格库存汇总')}</TableCell><TableCell className="tabular-nums">{quantity(selected.bookQty)} {selected.unit}</TableCell><TableCell className="tabular-nums">{quantity(selected.countedQty)} {selected.unit}</TableCell><TableCell className="font-semibold tabular-nums">{selected.countedQty == null ? '—' : quantity(selected.quantity)} {selected.unit}</TableCell></TableRow></TableBody></Table><p className="p-5 text-xs text-pretty text-muted-foreground">{t('盘点范围说明不是库存批号；未复核结果不作为生效库存。')}</p></section>
        <div className="grid gap-4 lg:grid-cols-2"><section className="warehouse-surface p-5"><h2 className="mb-4 font-semibold text-balance">{t('责任与依据')}</h2><dl className="space-y-3 text-sm"><div><dt className="text-xs text-muted-foreground">{t('发起人')}</dt><dd>{selected.actorName}</dd></div><div><dt className="text-xs text-muted-foreground">{t('实盘填报人')}</dt><dd>{selected.countedByName || (selected.countStage ? '—' : selected.actorName)}</dd></div><div><dt className="text-xs text-muted-foreground">{t('发起说明')}</dt><dd className="whitespace-pre-wrap break-words">{selected.reason}</dd></div></dl></section><section className="warehouse-surface p-5"><h2 className="mb-4 font-semibold text-balance">{t('ERP 凭证核对')}</h2>{selected.reconciliation ? <><p>{selected.reconciliation.voucher} / {selected.reconciliation.line}</p><p className="mt-2 whitespace-pre-wrap break-words text-sm">{selected.reconciliation.evidence}</p><p className="mt-2 text-xs text-muted-foreground">{selected.reconciliation.actorName} · {selected.reconciliation.at}</p></> : <p className="text-sm text-muted-foreground">{t('ERP 尚未核对')}</p>}<p className="mt-3 text-xs text-pretty text-muted-foreground">{t('人工核对不代表 ERP 已同步。')}</p></section></div>
        <section className="warehouse-surface p-5"><h2 className="mb-4 font-semibold text-balance">{t('操作记录')}</h2><ol className="divide-y divide-border">{[...selected.events].reverse().map((event, index) => <li key={index} className="py-3"><p className="text-xs text-muted-foreground">{event.actorName} · {new Date(event.at).toLocaleString()}</p><p className="mt-1 text-sm whitespace-pre-wrap break-words">{event.reason}</p></li>)}</ol></section>
      </> : <section className="warehouse-surface overflow-hidden"><div className="warehouse-toolbar"><Input aria-label={t('搜索盘点单')} placeholder={t('搜索单号、物料、仓库或盘点范围')} value={search} onChange={event => change({ q: event.target.value, page: null })} /><NativeSelect aria-label={t('盘点状态')} value={status} onChange={event => change({ status: event.target.value, page: null })}><option value="all">{t('全部状态')}</option>{['待实盘', '待复核', '已复核', '已撤销'].map(value => <option key={value} value={value}>{t(value)}</option>)}</NativeSelect></div>
        {!rows.length ? <OrderEmptyState Icon={ClipboardList} title={t('暂无匹配的盘点单')} description={t('由具备发起权限的人员建立盘点单，仓库再填写实盘结果。')} action={search || status !== 'all' ? <Button variant="outline" onClick={() => change({ q: null, status: null, page: null })}>{t('清除筛选')}</Button> : canStart && balances.length ? <Button onClick={() => setStarting(true)}>{t('发起盘点')}</Button> : undefined} /> : <Table className="min-w-[800px]"><TableHeader><TableRow>{['盘点范围 / 单号', '物料 / 编码', '仓库', '账面 / 实盘', '差异', '状态', '发起人 / 日期', '操作'].map(label => <TableHead key={label}>{t(label)}</TableHead>)}</TableRow></TableHeader><TableBody>{page.rows.map(row => <TableRow key={row.id}><TableCell><p>{row.batch}</p><p className="mt-1 max-w-48 truncate text-xs text-muted-foreground" title={row.id}>{row.id}</p></TableCell><TableCell><p>{row.name}</p><p className="text-xs text-muted-foreground">{row.code}</p></TableCell><TableCell>{row.warehouse}</TableCell><TableCell className="tabular-nums">{quantity(row.bookQty)} / {quantity(row.countedQty)} {row.unit}</TableCell><TableCell className="tabular-nums">{row.countedQty == null ? '—' : quantity(row.quantity)}</TableCell><TableCell>{t(countStatus(row))}</TableCell><TableCell><p>{row.actorName}</p><p className="text-xs text-muted-foreground">{row.date}</p></TableCell><TableCell><Button variant="outline" size="sm" onClick={() => change({ record: row.id })}>{t('查看办理')}</Button></TableCell></TableRow>)}</TableBody></Table>}
        <WarehousePagination {...page} onPage={value => change({ page: String(value) })} />
      </section>}
    </>}
    {(editor || (starting && canStart && balances.length > 0 && !resource.loading)) && <OperationalDialog editor={editor ?? startEditor} onClose={close} onSaved={() => { close(); refresh(); }} />}
  </main>;
}
