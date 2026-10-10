import { LifecycleControlledDocuments } from './LifecycleControlledDocuments';
import { LifecycleVersionRanges } from './LifecycleVersionRanges';
import { LifecycleShipmentSerials } from './LifecycleShipmentSerials';
import { ShipmentSerialDialog } from './ShipmentSerialDialog';
import type { LifecycleFeedback, LifecycleVersionRange } from '../../lib/productionLifecycleApi';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Button } from '../../components/ui/button';
import { NativeSelect } from '../../components/ui/native-select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { useAuth } from '../../auth';
import { usePermission } from '../../hooks/usePermission';
import { commandProductionLifecycle, getLifecycle, type Lifecycle } from '../../lib/productionLifecycleApi';
import type { ExecutionPlan } from '../../lib/productionExecutionApi';
import { OperationalDialog, type OperationEditor, type OperationField } from './OperationalDialog';
import { ProductionEmpty, ProductionMetrics, ProductionStatus } from './ProductionView';
import { LifecycleDetailHeader, LifecycleFields, LifecycleLink, LifecycleTable, lifecycleDate, lifecycleRecordParams, type LifecycleRecordType } from './LifecycleViews';
import './lifecycle-pages.css';

const reason: OperationField = { key: 'reason', label: '结论、文件位置与凭证依据', type: 'textarea' };
const statusLabels = { draft: '草稿', validated: '已独立验证', published: '已发布' };
const statusOptions = Object.entries(statusLabels).map(([value, label]) => ({ value, label }));
const eventLabels: Record<string, string> = { transfer: '建立资料版本', 'validate-transfer': '独立验证资料', 'publish-transfer': '发布资料', ecn: '建立 ECN', 'publish-ecn': '发布 ECN', acknowledge: '确认阅读', release: '质量放行', ship: '实际发货', 'bind-shipment-sns': '补录本次实发 SN', 'reverse-shipment': '发货冲销', 'ecn-feedback': '反馈无法执行', 'handle-ecn-feedback': '处理执行反馈', 'version-range': '登记批次版本范围' };
const planEventLabels: Record<string, string> = { create: '建立生产计划', targets: '调整计划目标', batch: '建立生产批次', task: '编制作业', dispatch: '确认派工', adjust: '调整作业安排', cancel: '取消作业', report: '登记报工', inspect: '登记检验', 'field-issue': '登记现场不良', disposition: '登记异常处置', 'assign-quality': '分派质量协同', 'reply-quality': '回复质量协同', 'review-basis': '核对历史 BOM 依据' };
type HistoryEvent = Lifecycle['events'][number] & { source?: '计划与作业' | '转产与批次' };
type Transfer = Lifecycle['transfers'][number];
type Change = Lifecycle['changes'][number];
type Batch = Lifecycle['batches'][number];
type Shipment = Lifecycle['shipments'][number];
const rowKey = (row: { id: string }) => row.id;
const quantity = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 3 });

type LifecyclePanelProps = { plan: ExecutionPlan; view: 'transfer' | 'shipments' | 'archive'; section?: 'transfer' | 'ecn'; shipmentFirst?: boolean };

export function LifecyclePanel({ plan, view, section, shipmentFirst = false }: LifecyclePanelProps) {
  const { user } = useAuth();
  // Remount on access changes to cancel old reads and discard the old account's command draft.
  return <LifecycleWorkspace key={JSON.stringify([plan.id, view, section, user?.id, user?.roleId, user?.permissions])} plan={plan} view={view} section={section} shipmentFirst={shipmentFirst} />;
}

function LifecycleWorkspace({ plan, view, section, shipmentFirst = false }: LifecyclePanelProps) {
  const { user } = useAuth();
  const canTransfer = usePermission('production:transfer'), canRelease = usePermission('production:release'), canShip = usePermission('production:ship');
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<Lifecycle | null>(null), [error, setError] = useState(''), [reload, setReload] = useState(0), [editor, setEditor] = useState<OperationEditor | null>(null);
  const [serialShipment, setSerialShipment] = useState<Shipment | null>(null);
  const [showList, setShowList] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setError(''); setData(null);
    getLifecycle(plan.id, controller.signal).then(value => { if (!controller.signal.aborted) setData(value); }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '生产业务读取失败'); });
    return () => controller.abort();
  }, [plan.id, plan.version, reload]);

  function openRecord(type: LifecycleRecordType, id: string) { setShowList(false); setParams(previous => lifecycleRecordParams(previous, { type, id })); }
  function backToList() { setShowList(true); setParams(previous => lifecycleRecordParams(previous)); }
  function openTask(id: string) {
    setParams(previous => {
      const next = lifecycleRecordParams(previous);
      next.set('plan', plan.id); next.set('view', 'tasks'); next.set('task', id);
      next.delete('inspection'); next.delete('taskSection');
      return next;
    });
  }
  function edit(action: string, title: string, fields: OperationField[], fixed: Record<string, unknown> = {}) {
    if (!data) return;
    setEditor({ title, description: action === 'ship' ? '按独立凭证登记实际发货。只填写本批次已登记、且确实随本单发出的 SN；暂未采集的数量保留待补，之后可在本发货详情选择补录。' : '操作沿原计划和批次留痕。资料发布、质量放行、实际发货分别确认。', fields: [...fields, reason], submit: (values, requestId) => commandProductionLifecycle(plan.id, 'lifecycle', { action, requestId, version: data.version, data: { ...values, ...fixed, ...(action === 'ship' ? { serialNumbers: String(values.serialNumbers || '').split(/\r?\n/).map(number => number.trim()).filter(Boolean) } : {}) } }) });
  }
  function createTransfer() {
    if (!data) return;
    const documents = [...new Map(data.sampleTasks.flatMap(sample => (sample.documents ?? []).map(document => [document.versionId, { value: document.versionId, label: sample.code + ' · ' + document.name + ' · ' + document.version }] as const))).values()];
    setEditor({ title: '建立资料包版本', description: '从样品已交付的受控资料选择固定版本。转量产必须关联三项文件，并由另一名授权人员独立验证；探索记录可说明不适用。', fields: [
      { key: 'code', label: '资料包版本编号' },
      { key: 'type', label: '样品性质', options: [{ value: 'exploration', label: '研发探索' }, { value: 'validation', label: '转量产验证' }] },
      { key: 'sample', label: '样品任务与轮次', options: data.sampleTasks.map(row => ({ value: JSON.stringify([row.id, row.roundId]), label: row.code + ' · ' + row.title + ' · ' + (row.result ?? '测试中') })) },
      { key: 'sopVersion', label: 'SOP 受控版本', options: documents, optional: true, optionalHint: '转量产必填' },
      { key: 'sipVersion', label: 'SIP 受控版本', options: documents, optional: true, optionalHint: '转量产必填' },
      { key: 'drawingVersion', label: '图纸 / BOM 受控版本', options: documents, optional: true, optionalHint: '转量产必填' }, reason,
    ], submit: (values, requestId) => {
      const [sampleTaskId, roundId] = JSON.parse(String(values.sample));
      const selected = ['sop', 'sip', 'drawing'].map(kind => ({ kind, versionId: values[kind + 'Version'] })).filter(row => row.versionId);
      if (values.type === 'validation' && selected.length !== 3) return Promise.reject(new Error('转量产须选择 SOP、SIP、图纸 / BOM 的固定版本；请先在原研发任务确认并交付资料。'));
      if (selected.length && selected.length !== 3) return Promise.reject(new Error('选择受控文件时，请完整关联 SOP、SIP、图纸 / BOM 三项。'));
      return commandProductionLifecycle(plan.id, 'lifecycle', { action: 'transfer', requestId, version: data.version, data: { ...values, sampleTaskId, roundId, documents: selected.length ? selected : undefined, sop: '探索阶段未指定，详见编制依据', sip: '探索阶段未指定，详见编制依据', drawing: '探索阶段未指定，详见编制依据' } });
    } });
  }
  const packageOptions = data?.transfers.filter(row => row.status === 'published').map(row => ({ value: row.id, label: row.code })) ?? [];
  function createChange() {
    if (!data) return;
    setEditor({ title: '建立批次 ECN', description: '先选择经过验证并发布的替代资料包，再明确生效批次、日期及旧料处置。阅读确认不能代替验证。', fields: [
      { key: 'code', label: 'ECN 编号' }, { key: 'packageId', label: '已验证发布的替代资料包', options: packageOptions },
      { key: 'batchId', label: '适用批次', options: plan.batches.map(row => ({ value: row.id, label: row.code })) },
      { key: 'effectiveDate', label: '生效日期', type: 'date' }, { key: 'handling', label: '旧料、库存、在制品及已完成批次的处置', type: 'textarea' }, reason,
    ], submit: (values, requestId) => commandProductionLifecycle(plan.id, 'lifecycle', { action: 'ecn', requestId, version: data.version, data: { ...values, batchIds: [values.batchId] } }) });
  }
  function exportArchive() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), plan, lifecycle: data }, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `生产批次档案-${plan.month}-${plan.productLine.replace(/[^\w\u4e00-\u9fff-]/g, '_')}.json`; anchor.click(); URL.revokeObjectURL(url);
  }
  const batchCode = (id: string) => plan.batches.find(batch => batch.id === id)?.code ?? id;
  function transferActions(row: Transfer) {
    return <>{row.type === 'validation' && row.status === 'draft' && canRelease && row.authorId !== user?.id && <Button onClick={() => edit('validate-transfer', '独立验证转量产资料', [{ key: 'documentsChecked', label: '已核对 SOP、SIP、图纸 / BOM 文件及版本一致', type: 'checkbox' }, { key: 'productionValidated', label: '已完成实际转量产验证并确认通过', type: 'checkbox' }], { id: row.id })}>登记独立验证</Button>}{row.status === 'validated' && canTransfer && <Button onClick={() => edit('publish-transfer', '发布量产依据', [], { id: row.id })}>发布资料</Button>}</>;
  }
  function changeActions(row: Change) {
    return <>{row.status === 'draft' && canTransfer && <Button onClick={() => edit('publish-ecn', '发布 ECN', [], { id: row.id })}>发布 ECN</Button>}{row.status === 'published' && plan.tasks.some(task => row.batchIds.includes(task.batchId) && task.ownerId === user?.id) && !row.acknowledgments.some(item => item.actorId === user?.id) && <Button onClick={() => edit('acknowledge', '确认阅读适用变更', [], { id: row.id })}>本人确认阅读</Button>}</>;
  }
  function feedback(row: Change, current?: LifecycleFeedback) {
    const handlers = (data?.handlers ?? []).map(person => ({ value: person.id, label: person.name }));
    edit(current ? 'handle-ecn-feedback' : 'ecn-feedback', current ? '处理执行反馈' : '反馈无法执行', [
      { key: 'ownerId', label: '当前经办人', value: current?.ownerId, options: handlers }, { key: 'dueDate', label: '处理期限', type: 'date', value: current?.dueDate },
      ...(current ? [{ key: 'status', label: '处理结果', value: current.status, options: [{ value: 'open', label: '待处理 / 重新打开' }, { value: 'processing', label: '处理中' }, { value: 'resolved', label: '已处理，可执行' }] }] : []),
    ], { id: row.id, ...(current ? { feedbackId: current.id } : {}) });
  }
  function editVersionRange(batch: Batch, row?: LifecycleVersionRange) {
    if (!data) return;
    setEditor({ title: row ? '补充 / 更正版本范围' : '登记批次版本范围', description: '按实际适用数量分段。未知版本留空待补；只填写已经存在的 SN，一行一个，不会生成新 SN。更正会保存原记录。', fields: [
      { key: 'quantity', label: '本段适用数量（台）', type: 'number', min: 1, value: row ? String(row.quantity) : '' },
      { key: 'range', label: '适用范围说明', value: row?.range },
      { key: 'softwareVersion', label: '软件版本，未知留空', optional: true, value: row?.softwareVersion },
      { key: 'hardwareVersion', label: '硬件版本，未知留空', optional: true, value: row?.hardwareVersion },
      { key: 'serialNumbers', label: '已有 SN，一行一个，未采集留空', type: 'textarea', optional: true, value: row?.serialNumbers.join('\n') }, reason,
    ], submit: (values, requestId) => commandProductionLifecycle(plan.id, 'lifecycle', { action: 'version-range', requestId, version: data.version, data: { ...values, batchId: batch.id, supersedesId: row?.id, serialNumbers: String(values.serialNumbers || '').split(/\r?\n/).map(value => value.trim()).filter(Boolean) } }) });
  }
  function batchActions(batch: Batch) {
    return <>{canRelease && <Button variant="outline" onClick={() => edit('release', '登记批次质量放行', [{ key: 'quantity', label: '累计放行数量（台）', type: 'number', min: 1 }, { key: 'evidenceChecked', label: '已核对批次档案、质量结论及放行依据', type: 'checkbox' }], { batchId: batch.id })}>质量放行</Button>}{canShip && <Button disabled={batch.releasedQty <= batch.shippedQty} onClick={() => edit('ship', '登记实际发货', [{ key: 'quantity', label: '本次实际发货数量（台）', type: 'number', min: 1 }, { key: 'date', label: '实际发货日期', type: 'date' }, { key: 'order', label: '销售 / 客户订单号' }, { key: 'recipient', label: '收货客户' }, { key: 'voucher', label: '本批次独立发货凭证号' }, { key: 'serialNumbers', label: '本次实发已有 SN，一行一个；未采集留空', type: 'textarea', optional: true }], { batchId: batch.id })}>实际发货</Button>}</>;
  }
  function shipmentActions(row: Shipment) {
    return !row.reversed && canShip ? <>{(row.serials?.length ?? 0) < row.quantity && <Button onClick={() => setSerialShipment(row)}>补录实发 SN</Button>}<Button variant="outline" onClick={() => edit('reverse-shipment', '凭证冲销原发货', [{ key: 'evidenceChecked', label: '已核对发货取消或实物退回凭证', type: 'checkbox' }], { id: row.id })}>凭证冲销</Button></> : null;
  }
  function eventsTable(events: HistoryEvent[], scope = 'lifecycleHistory') {
    const label = (row: HistoryEvent) => eventLabels[row.action] ?? planEventLabels[row.action] ?? row.action;
    return <LifecycleTable title="操作历史" scope={scope} rows={[...events].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))} rowKey={row => `${row.source ?? '生命周期'}/${row.id}`} searchText={row => `${label(row)} ${row.source ?? ''} ${row.actorName} ${row.reason} ${row.subjectId}`} searchPlaceholder="搜索操作、经办人或依据" emptyTitle="暂无操作历史" columns={[
      { label: '操作 / 时间', cell: row => <>{label(row)}<p className="production-meta">{lifecycleDate(row.at)}{row.source ? ` · ${row.source}` : ''}{row.subjectId === plan.id ? ' · 全计划' : ''}</p></> },
      { label: '经办人', cell: row => row.actorName }, { label: '结论与依据', className: 'production-cell-note', cell: row => row.reason },
    ]} />;
  }
  function shipmentTable(rows: Shipment[], scope = 'shipments') {
    return <LifecycleTable title="发货记录" description="以独立发货凭证记录实发数量，冲销保留原始记录。" scope={scope} rows={rows} rowKey={rowKey} searchText={row => `${row.voucher} ${batchCode(row.batchId)} ${row.order} ${row.recipient} ${row.actorName} ${(row.serials ?? []).map(serial => serial.number).join(' ')}`} searchPlaceholder="搜索凭证、批次、SN、订单或客户" status={{ value: row => row.reversed ? 'reversed' : 'shipped', options: [{ value: 'shipped', label: '已发货' }, { value: 'reversed', label: '已冲销' }] }} emptyTitle="暂无实际发货记录" columns={[
      { label: '凭证 / 批次', className: 'production-cell-main', cell: row => <><LifecycleLink onClick={() => openRecord('shipment', row.id)}>{row.voucher}</LifecycleLink><p className="production-meta">{batchCode(row.batchId)}</p></> },
      { label: '发货日期', cell: row => row.date }, { label: '发货数量', cell: row => `${quantity(row.quantity)} 台` },
      { label: '本单 SN', cell: row => <><p>已关联 {row.serials?.length ?? 0} 个</p><p className="production-meta">待补 {Math.max(0, row.quantity - (row.serials?.length ?? 0))} 台</p></> },
      { label: '客户 / 订单', className: 'production-cell-note', cell: row => <>{row.recipient}<p className="production-meta">{row.order}</p></> },
      { label: '状态', cell: row => <ProductionStatus tone={row.reversed ? 'neutral' : 'success'}>{row.reversed ? '已冲销' : '已发货'}</ProductionStatus> },
      { label: '登记人', cell: row => row.actorName }, { label: '操作', cell: row => <Button size="sm" variant="outline" onClick={() => openRecord('shipment', row.id)}>查看凭证</Button> },
    ]} />;
  }
  function batchTable(rows: Batch[], archive = false) {
    return <LifecycleTable title={archive ? '批次追溯档案' : '批次放行'} description={archive ? '从批次查看作业、领退料、检验、放行和发货记录。' : '检验合格、有效放行和实际发货分别记录。'} scope={archive ? 'archives' : 'releaseBatches'} rows={rows} rowKey={rowKey} searchText={row => `${row.code} ${row.dueDate} ${row.tasks.map(task => `${task.name} ${task.ownerName}`).join(' ')} ${(data?.versionRanges ?? []).filter(range => range.batchId === row.id).flatMap(range => [range.softwareVersion, range.hardwareVersion, ...range.serialNumbers]).join(' ')}`} searchPlaceholder="搜索批次、已有 SN、版本或负责人" status={{ value: row => row.openQuality || row.uninspected ? 'pending' : 'checked', options: [{ value: 'pending', label: '待质量核对' }, { value: 'checked', label: '当前无待核对项' }] }} actions={archive && <Button variant="outline" onClick={exportArchive}>导出完整档案</Button>} emptyTitle="尚未建立生产批次" columns={[
      { label: '批次 / 交期', className: 'production-cell-main', cell: row => <><LifecycleLink onClick={() => openRecord('batch', row.id)}>{row.code}</LifecycleLink><p className="production-meta">交期 {row.dueDate} · 目标 {quantity(row.quantity)} 台</p></> },
      { label: '检验合格', cell: row => `${quantity(row.completedQty)} 台` }, { label: '有效放行', cell: row => `${quantity(row.releasedQty)} 台` }, { label: '已发货', cell: row => `${quantity(row.shippedQty)} 台` },
      { label: '质量核对', className: 'production-cell-note', cell: row => <><ProductionStatus tone={row.openQuality || row.uninspected ? 'warning' : 'neutral'}>{row.openQuality ? `${row.openQuality} 项未闭环异常` : '无未闭环异常'}</ProductionStatus><p className="production-meta">{row.uninspected ? '有报工待初检' : '已报工部分初检齐全'}</p></> },
      { label: '操作', cell: row => <Button size="sm" variant="outline" onClick={() => openRecord('batch', row.id)}>{archive ? '查看档案' : '查看与办理'}</Button> },
    ]} />;
  }
  function warehouseTable(rows: Lifecycle['warehouse'], scope: string) {
    return <LifecycleTable title="领退料记录" scope={scope} rows={rows} rowKey={rowKey} searchText={row => `${row.title ?? row.name ?? ''} ${batchCode(row.batchId)} ${row.id}`} emptyTitle="暂无领退料记录" columns={[
      { label: '记录 / 批次', className: 'production-cell-main', cell: row => <>{row.title || row.name || row.id}<p className="production-meta">{batchCode(row.batchId)}</p></> },
      { label: '类型', cell: row => row.kind === 'return' ? '退料' : '领料' },
      { label: '数量', cell: row => row.quantity == null ? '详见原领料明细' : `${quantity(row.quantity)} ${row.unit ?? ''}` },
      { label: '状态', cell: row => <ProductionStatus tone={row.status === 'signed' || row.status === 'confirmed' ? 'success' : 'neutral'}>{row.status === 'signed' || row.status === 'confirmed' ? '已确认' : '办理中'}</ProductionStatus> },
    ]} />;
  }
  function qualityTable(rows: Lifecycle['qualityRecords'], scope: string) {
    return <LifecycleTable title="质量异常与复验" scope={scope} rows={rows} rowKey={rowKey} searchText={row => `${row.id} ${row.batchNo} ${row.issue} ${row.resolution ?? ''}`} searchPlaceholder="搜索原异常编号、批次或现象" status={{ value: row => row.status === 'closed' ? 'closed' : 'open', options: [{ value: 'open', label: '未闭环' }, { value: 'closed', label: '已关闭' }] }} emptyTitle="暂无质量异常" columns={[
      { label: '异常 / 批次', className: 'production-cell-main', cell: row => <>{row.issue}<p className="production-meta">{row.batchNo} · {row.id}</p></> },
      { label: '状态', cell: row => <ProductionStatus tone={row.status === 'closed' ? 'success' : 'warning'}>{row.status === 'closed' ? '已关闭' : '未闭环'}</ProductionStatus> },
      { label: '处置与复验', className: 'production-cell-note', cell: row => <><p>{row.resolution || '尚未登记处置结论'}</p><details className="mt-2"><summary className="cursor-pointer text-primary">查看复验历史</summary><div className="mt-2 space-y-3">{data?.verificationHistory.filter(entry => entry.recordId === row.id).length ? data.verificationHistory.filter(entry => entry.recordId === row.id).map((entry, index) => <div key={`${entry.recordedAt}-${index}`}><p className="text-xs text-muted-foreground">{entry.actorName} · {lifecycleDate(entry.recordedAt)}</p><p>{entry.evidence}</p></div>) : <p className="text-muted-foreground">暂无复验记录</p>}</div></details></> },
    ]} />;
  }

  function batchLinks(rows: Batch[], title = '关联批次档案') {
    return <section className="production-surface lifecycle-related"><div className="production-section-heading"><h3>{title}</h3></div>
      {rows.length ? <ul>{rows.map(row => <li key={row.id}><LifecycleLink onClick={() => openRecord('batch', row.id)}>{row.code}</LifecycleLink><p>{quantity(row.quantity)} 台 · 交期 {row.dueDate}</p><dl><div><dt>检验合格</dt><dd>{quantity(row.completedQty)} 台</dd></div><div><dt>有效放行</dt><dd>{quantity(row.releasedQty)} 台</dd></div><div><dt>净发货</dt><dd>{quantity(row.shippedQty)} 台</dd></div></dl>{(row.openQuality > 0 || row.uninspected) && <p className="lifecycle-attention">{row.openQuality > 0 ? `${row.openQuality} 项质量异常未闭环` : '报工待初检'}{row.openQuality > 0 && row.uninspected ? ' · 报工待初检' : ''}</p>}</li>)}</ul> : <p className="lifecycle-muted">尚无关联的生产批次档案。</p>}
    </section>;
  }
  function transferChecks(row: Transfer) {
    const source = data?.sampleTasks.find(item => item.id === row.sampleTaskId && item.roundId === row.roundId);
    const result = source?.result ? ({ passed: '测试通过', failed: '测试未通过' }[source.result] ?? source.result) : '未取得本轮测试结论';
    return <section className="production-surface lifecycle-checks"><div className="production-section-heading"><div><h3>转产发布条件检查</h3><p>固定资料版本、样品结论与独立验证分别核对。</p></div><ProductionStatus tone={row.status === 'published' ? 'success' : 'warning'}>{statusLabels[row.status]}</ProductionStatus></div>
      <dl>{(['sop', 'sip', 'drawing'] as const).map(kind => { const document = row.documents?.find(item => item.kind === kind); return <div key={kind}><dt>{{ sop: 'SOP 作业指导', sip: 'SIP 检验规范', drawing: '图纸 / BOM' }[kind]}</dt><dd><strong>{document ? `${document.name} · ${document.version}` : '受控文件未关联'}</strong><span>{document ? '已关联固定版本' : '历史文字依据保留，正式发布须补齐'}</span></dd></div>; })}
        <div><dt>样品测试结果</dt><dd><strong>{result}</strong><span>关联轮次 {row.roundId} · 独立验证时仍须核对样品确认状态</span></dd></div>
        <div><dt>独立验证</dt><dd><strong>{row.validation ? '已登记独立验证结论' : '尚未登记独立验证结论'}</strong><span>{row.validatorId ? `验证人编号 ${row.validatorId}` : '由编制人以外的授权质量人员办理'}</span></dd></div>
        <div><dt>资料包发布</dt><dd><strong>{row.publishedAt ? lifecycleDate(row.publishedAt) : row.status === 'published' ? '已发布，历史日期未记录' : '尚未发布'}</strong><span>此日期为资料包发布记录；文件版本登记日期在下方单独显示。</span></dd></div>
      </dl>{row.type === 'exploration' && <p className="lifecycle-attention lifecycle-inset">探索记录不能作为量产依据。</p>}
    </section>;
  }

  if (error) return <section className="production-surface p-5" role="alert"><p className="mb-3 text-sm text-destructive">{error}</p><Button variant="outline" onClick={() => setReload(value => value + 1)}>重新加载</Button></section>;
  if (!data) return <p role="status" className="py-8 text-sm text-muted-foreground">正在读取生产业务…</p>;

  const recordId = params.get('record'), recordType = params.get('recordType');
  const transfer = recordId ? recordType === 'transfer' ? data.transfers.find(row => row.id === recordId) : undefined : !showList && view === 'transfer' && section !== 'ecn' ? data.transfers.at(-1) : undefined;
  const change = recordId ? recordType === 'ecn' ? data.changes.find(row => row.id === recordId) : undefined : !showList && view === 'transfer' && section === 'ecn' ? data.changes.at(-1) : undefined;
  const batch = recordType === 'batch' ? data.batches.find(row => row.id === recordId) : undefined;
  const shipment = recordType === 'shipment' ? data.shipments.find(row => row.id === recordId) : undefined;
  const selected = transfer || change || batch || shipment;
  const sample = transfer && data.sampleTasks.find(row => row.id === transfer.sampleTaskId && row.roundId === transfer.roundId);
  const batchQualityIds = new Set(batch?.tasks.flatMap(task => [...(task.inspections ?? []), ...(task.fieldIssues ?? [])].flatMap(row => row.qualityId ? [row.qualityId] : [])) ?? []);
  const batchReleases = batch ? data.releases.filter(row => row.batchId === batch.id) : [];
  const relatedSubjectIds = new Set(batch ? [plan.id, batch.id, ...batch.tasks.flatMap(row => [row.id, ...row.reports.map(report => report.id), ...(row.inspections ?? []).map(inspection => inspection.id), ...(row.fieldIssues ?? []).map(issue => issue.id)]), ...batchQualityIds, ...batchReleases.map(row => row.id), ...(data.versionRanges ?? []).filter(row => row.batchId === batch.id).map(row => row.id), ...data.shipments.filter(row => row.batchId === batch.id).map(row => row.id), ...data.changes.filter(row => row.batchIds.includes(batch.id)).map(row => row.id)] : []);
  const history: HistoryEvent[] = [...(plan.events ?? []).map(row => ({ ...row, source: '计划与作业' as const })), ...data.events.map(row => ({ ...row, source: '转产与批次' as const }))];
  const release = shipment && data.releases.find(row => row.id === shipment.releaseId);
  const transferBatches = transfer ? data.batches.filter(row => row.tasks.some(task => task.basis?.packageId === transfer.id) || data.changes.some(item => item.packageId === transfer.id && item.batchIds.includes(row.id))) : [];
  const myAcknowledgment = change?.acknowledgments.find(row => row.actorId === user?.id);
  const isAffectedOwner = Boolean(change && plan.tasks.some(task => change.batchIds.includes(task.batchId) && task.ownerId === user?.id));
  const affectedOwners = new Map(change ? plan.tasks.filter(task => change.batchIds.includes(task.batchId)).map(task => [task.ownerId, { actorId: task.ownerId, actorName: task.ownerName, at: '' }]) : []);
  for (const acknowledgment of change?.acknowledgments ?? []) affectedOwners.set(acknowledgment.actorId, acknowledgment);
  const recordPicker = <div className="lifecycle-record-picker"><label htmlFor={`lifecycle-record-${plan.id}`}>{section === 'ecn' ? '选择工程变更' : '选择转产资料版本'}</label><NativeSelect id={`lifecycle-record-${plan.id}`} value={change?.id ?? transfer?.id ?? ''} onChange={event => openRecord(section === 'ecn' ? 'ecn' : 'transfer', event.target.value)}><option value="" disabled>{section === 'ecn' ? data.changes.length ? '请选择工程变更' : '暂无工程变更' : data.transfers.length ? '请选择资料版本' : '暂无转产资料'}</option>{(section === 'ecn' ? data.changes : data.transfers).map(row => <option key={row.id} value={row.id}>{row.code} · {statusLabels[row.status]}</option>)}</NativeSelect><span>{section === 'ecn' ? data.changes.length : data.transfers.length} 个版本</span></div>;

  return <section className={`lifecycle-page lifecycle-page--${change || section === 'ecn' ? 'ecn' : view}`}>
    {!recordId && view === 'transfer' && !selected && recordPicker}
    {recordId || selected ? !selected ? <ProductionEmpty title="记录不存在或当前无权查看" description="返回列表后选择当前计划中的记录。"><Button variant="outline" onClick={backToList}>返回列表</Button></ProductionEmpty> : <>
      {transfer && <>
        <div className="lifecycle-record-bar"><LifecycleDetailHeader title={transfer.code} description={`${transfer.type === 'exploration' ? '研发探索' : '转量产验证'} · ${plan.productName} · ${plan.productLine}`} status={<ProductionStatus tone={transfer.status === 'published' ? 'success' : 'neutral'}>{statusLabels[transfer.status]}</ProductionStatus>} onBack={recordId ? backToList : undefined} />{!recordId && view === 'transfer' && recordPicker}</div>
        <nav className="lifecycle-mobile-shortcuts" aria-label="转产内容快捷定位"><a href="#lifecycle-transfer-documents">查看固定资料</a><a href="#lifecycle-transfer-actions">转产办理</a></nav>
        <div className="lifecycle-columns"><div className="lifecycle-main">
          {transferChecks(transfer)}
          <div id="lifecycle-transfer-documents" tabIndex={-1}><LifecycleControlledDocuments planId={plan.id} documents={transfer.documents} title="本次转产固定资料" compact /></div>
          <details className="lifecycle-secondary"><summary>查看编制依据、文字版本与操作历史</summary><div className="lifecycle-stack"><LifecycleFields title="资料与版本依据" items={[{ label: 'SOP 编号、版本及文件位置', value: transfer.sop, full: true }, { label: 'SIP 编号、版本及文件位置', value: transfer.sip, full: true }, { label: '图纸 / BOM 版本及文件位置', value: transfer.drawing, full: true }, { label: '编制依据', value: transfer.evidence, full: true }, { label: '独立验证结论', value: transfer.validation, full: true }]} />{eventsTable(data.events.filter(row => row.subjectId === transfer.id), 'transferHistory')}</div></details>
        </div><aside className="lifecycle-aside" aria-label="转产关联档案">
          <LifecycleFields title="关联样品" items={[{ label: '原样品任务', value: sample ? `${sample.code} · ${sample.title}` : transfer.sampleTaskId, full: true }, { label: '样品轮次', value: transfer.roundId }, { label: '编制人编号', value: transfer.authorId }]} />
          {batchLinks(transferBatches)}
          <p className="lifecycle-muted">关联档案来自已派工作业的固定版本或 ECN 适用范围。质量异常与复验记录在原批次中查看。</p>
        </aside></div>
        <footer className="lifecycle-action-bar" id="lifecycle-transfer-actions" tabIndex={-1}><p>{transfer.status === 'published' ? '资料已发布。已派工作业保留当时的固定版本。' : transfer.status === 'validated' ? '已登记独立验证，由有转产权限的人员发布资料。' : '发布前需核对样品确认、固定资料和独立验证；阅读确认不代替验证。'}</p><div>{canTransfer && <Button variant="outline" disabled={!data.sampleTasks.length} onClick={createTransfer}>新增资料版本</Button>}{transferActions(transfer)}</div></footer>
      </>}
      {change && <>
        <div className="lifecycle-record-bar"><LifecycleDetailHeader title={change.code} description={`工程变更 · ${plan.productName} · 生效日期 ${change.effectiveDate}`} status={<ProductionStatus tone={change.status === 'published' ? 'success' : 'neutral'}>{statusLabels[change.status]}</ProductionStatus>} onBack={recordId ? backToList : undefined} />{!recordId && view === 'transfer' && recordPicker}</div>
        <nav className="lifecycle-mobile-shortcuts" aria-label="ECN 内容快捷定位"><a href="#lifecycle-change-documents">查看变更资料</a><a href="#lifecycle-my-confirmation">本人确认</a></nav>
        <div className="lifecycle-columns"><div className="lifecycle-main">
          <div className="lifecycle-document-comparison" id="lifecycle-change-documents" tabIndex={-1}><div className="lifecycle-stack">{change.previousPackageIds?.length ? change.previousPackageIds.map(id => <LifecycleControlledDocuments key={id} planId={plan.id} documents={data.transfers.find(row => row.id === id)?.documents} title={'变更前 · ' + (data.transfers.find(row => row.id === id)?.code ?? id)} />) : <section className="production-surface"><div className="production-section-heading"><h3>变更前固定资料</h3></div><p className="lifecycle-muted">原适用文件未记录，保留未知；不根据当前最新版本推定。</p></section>}</div><LifecycleControlledDocuments planId={plan.id} documents={data.transfers.find(row => row.id === change.packageId)?.documents} title={'变更后 · ' + (data.transfers.find(row => row.id === change.packageId)?.code ?? change.packageId)} /></div>
          <LifecycleFields title="变更依据与旧版本处置" items={[{ label: '替代资料包', value: data.transfers.some(row => row.id === change.packageId) ? <LifecycleLink onClick={() => openRecord('transfer', change.packageId)}>{data.transfers.find(row => row.id === change.packageId)?.code}</LifecycleLink> : change.packageId }, { label: '生效日期', value: change.effectiveDate }, { label: '旧料、库存、在制品及已完成批次处置', value: change.handling, full: true }, { label: '验证与发布依据', value: change.validation, full: true }]} />
        </div><aside className="lifecycle-aside" aria-label="本人确认与变更影响">
          <section className="production-surface lifecycle-my-confirmation" id="lifecycle-my-confirmation" tabIndex={-1}><div className="production-section-heading"><h3>我的阅读确认</h3><ProductionStatus tone={myAcknowledgment ? 'success' : change.status === 'published' && isAffectedOwner ? 'warning' : 'neutral'}>{myAcknowledgment ? '已确认阅读' : change.status !== 'published' ? '待发布' : isAffectedOwner ? '待本人确认' : '不在本人负责范围'}</ProductionStatus></div><div className="lifecycle-inset"><p>{myAcknowledgment ? `本人已于 ${lifecycleDate(myAcknowledgment.at)} 确认阅读。` : change.status !== 'published' ? '草稿尚不能作为现场执行依据。' : isAffectedOwner ? '请查看变更前后资料及适用批次，再记录本人阅读确认。' : '仅适用批次的现场负责人可记录本人阅读确认。'}</p><div className="lifecycle-personal-actions">{changeActions(change)}{change.status === 'published' && (canTransfer || isAffectedOwner) && <Button variant="outline" onClick={() => feedback(change)}>反馈无法执行</Button>}</div><p className="lifecycle-attention">阅读确认仅表示已阅，不代表执行验证通过、质量放行或 ECN 已关闭。</p></div></section>
          <LifecycleFields title="影响信息" items={[{ label: '适用批次', value: <div className="lifecycle-inline-links">{change.batchIds.map(id => data.batches.some(row => row.id === id) ? <LifecycleLink key={id} onClick={() => openRecord('batch', id)}>{batchCode(id)}</LifecycleLink> : <span key={id}>{batchCode(id)}</span>)}</div>, full: true }, { label: '待处理执行反馈', value: `${change.feedback?.filter(row => row.status !== 'resolved').length ?? 0} 项` }, { label: '已确认阅读', value: `${change.acknowledgments.length} 人` }]} />
          <p className="lifecycle-muted">已派工作业保留原资料快照。供应商通知与执行验证结果需沿原业务核对，本页不据已阅人数推定完成。</p>
        </aside></div>
        <LifecycleTable title="岗位阅读确认" description="按适用批次的现场负责人列示；历史确认记录保留。" scope="ecnAcknowledgments" rows={[...affectedOwners.values()]} rowKey={row => row.actorId} searchText={row => row.actorName} searchPlaceholder="搜索确认人" emptyTitle="暂无适用现场负责人或历史确认" columns={[{ label: '现场负责人', cell: row => row.actorName }, { label: '确认状态', cell: row => <ProductionStatus tone={row.at ? 'success' : 'warning'}>{row.at ? '已确认阅读' : change.status === 'published' ? '待确认阅读' : '待发布后确认'}</ProductionStatus> }, { label: '确认时间', cell: row => row.at ? lifecycleDate(row.at) : '—' }]} />
        <LifecycleTable title="执行问题反馈" scope="ecnFeedback" rows={change.feedback ?? []} rowKey={rowKey} searchText={row => row.problem + ' ' + row.ownerName} emptyTitle="暂无执行问题反馈" columns={[
          { label: '问题 / 原编号', className: 'production-cell-note', cell: row => <><p>{row.problem}</p><p className="production-meta">{change.code} · {row.reporterName} · {lifecycleDate(row.at)}</p></> },
          { label: '当前经办 / 期限', cell: row => <>{row.ownerName}<p className="production-meta">{row.dueDate}</p></> },
          { label: '状态与处理', className: 'production-cell-note', cell: row => <><ProductionStatus tone={row.status === 'resolved' ? 'success' : 'warning'}>{{ open: '待处理', processing: '处理中', resolved: '已处理' }[row.status]}</ProductionStatus><details className="mt-2"><summary className="cursor-pointer text-primary">处理历史</summary>{row.history.map((entry, index) => <div key={index} className="mt-3 border-l border-border pl-3"><p className="text-xs text-muted-foreground">{entry.actorName} · {lifecycleDate(entry.at)} · 经办 {entry.ownerName} · 期限 {entry.dueDate}</p><p className="mt-1 text-sm">{entry.reason}</p></div>)}</details></> },
          { label: '操作', cell: row => (canTransfer || row.ownerId === user?.id) ? <Button variant="outline" size="sm" onClick={() => feedback(change, row)}>处理反馈</Button> : '—' },
        ]} />
        <details className="lifecycle-secondary"><summary>查看 ECN 完整操作历史</summary><div className="lifecycle-stack">{eventsTable(data.events.filter(row => row.subjectId === change.id), 'ecnHistory')}</div></details>
        {canTransfer && <footer className="lifecycle-action-bar"><p>新变更需选择已发布资料并明确生效批次，历史版本继续保留。</p><Button variant="outline" disabled={!packageOptions.length || !plan.batches.length} onClick={createChange}>新增 ECN</Button></footer>}
      </>}
      {shipment && <>
        <LifecycleDetailHeader title={shipment.voucher} description={`实际发货凭证 · ${shipment.date}`} status={<ProductionStatus tone={shipment.reversed ? 'neutral' : 'success'}>{shipment.reversed ? '已冲销' : '已发货'}</ProductionStatus>} actions={shipmentActions(shipment)} onBack={backToList} />
        <p className="production-meta">发货日期 {shipment.date} · 登记人 {shipment.actorName}</p>
        <LifecycleShipmentSerials shipment={shipment} />
        <LifecycleFields title="发货与放行依据" items={[{ label: '生产批次', value: <LifecycleLink onClick={() => openRecord('batch', shipment.batchId)}>{batchCode(shipment.batchId)}</LifecycleLink> }, { label: '收货客户', value: shipment.recipient }, { label: '销售 / 客户订单号', value: shipment.order }, { label: '关联放行记录', value: release ? `${release.actorName} · ${lifecycleDate(release.at)} · ${quantity(release.quantity)} 台` : shipment.releaseId }, { label: '发货依据', value: shipment.evidence, full: true }, ...(release ? [{ label: '关联放行依据', value: release.evidence, full: true }] : []), ...(shipment.reversed ? [{ label: '冲销记录', value: `${shipment.reversed.actorName} · ${lifecycleDate(shipment.reversed.at)}\n${shipment.reversed.reason}`, full: true }] : [])]} />
        {eventsTable(data.events.filter(row => row.subjectId === shipment.id), 'shipmentHistory')}
      </>}
      {batch && <>
        <LifecycleDetailHeader title={batch.code} description={`${plan.productName} · ${plan.productLine} · 交期 ${batch.dueDate} · 目标 ${quantity(batch.quantity)} 台`} onBack={backToList} />
        <ProductionMetrics items={[{ label: '已登记整机检验合格', value: `${quantity(batch.completedQty)} 台` }, { label: '当前有效放行', value: `${quantity(batch.releasedQty)} 台` }, { label: '实际净发货', value: `${quantity(batch.shippedQty)} 台` }]} />
        <p className="lifecycle-attention">检验合格量来自已登记的终检及历史检验；性能测试与最终闸门完成状态尚未接入此统计，不能据此确认整机完工。</p>
        <p className="production-note"><ProductionStatus tone={batch.openQuality || batch.uninspected ? 'warning' : 'neutral'}>{batch.openQuality} 项未闭环异常</ProductionStatus><span className="ml-2">{batch.uninspected ? '有报工待初检。' : '已报工部分初检齐全。'}新增初检、复验或重开异常后，原放行须重新核对。</span></p>
        <div className="lifecycle-columns"><div className="lifecycle-main"><Tabs key={batch.id} defaultValue={view === 'shipments' ? 'release' : 'versions'} className="gap-4">
          <div className="production-tabs"><TabsList aria-label="批次档案内容"><TabsTrigger value="versions">版本与 SN</TabsTrigger><TabsTrigger value="tasks">作业与检验</TabsTrigger><TabsTrigger value="warehouse">领退料</TabsTrigger><TabsTrigger value="quality">质量与复验</TabsTrigger><TabsTrigger value="release">放行与发货</TabsTrigger><TabsTrigger value="changes">适用变更</TabsTrigger><TabsTrigger value="history">操作历史</TabsTrigger></TabsList></div>
          <TabsContent value="versions"><LifecycleVersionRanges rows={(data.versionRanges ?? []).filter(row => row.batchId === batch.id)} batchQuantity={batch.quantity} canEdit={canTransfer} onEdit={row => editVersionRange(batch, row)} /></TabsContent>
          <TabsContent value="tasks"><LifecycleTable title="批次作业" scope="archiveTasks" rows={batch.tasks} rowKey={rowKey} searchText={row => `${row.name} ${row.ownerName} ${row.line} ${row.id}`} emptyTitle="本批次尚未编制作业" columns={[
            { label: '作业 / 负责人', className: 'production-cell-main', cell: row => <><LifecycleLink onClick={() => openTask(row.id)}>{row.name}</LifecycleLink><p className="production-meta">{row.ownerName} · {row.line}</p></> },
            { label: '派工数量', cell: row => `${quantity(row.quantity)} ${row.unit}` }, { label: '状态', cell: row => <ProductionStatus>{row.status === 'cancelled' ? '已取消' : row.status === 'draft' ? '待派工' : '已派工'}</ProductionStatus> },
            { label: '报工与检验', cell: row => <>{row.reports.length} 条报工 · {(row.inspections ?? []).length} 条初检</> },
            { label: '操作', cell: row => <Button size="sm" variant="outline" onClick={() => openTask(row.id)}>查看作业</Button> },
          ]} /></TabsContent>
          <TabsContent value="warehouse">{warehouseTable(data.warehouse.filter(row => row.batchId === batch.id), 'batchWarehouse')}</TabsContent>
          <TabsContent value="quality">{qualityTable(data.qualityRecords.filter(row => batchQualityIds.has(row.id)), 'batchQuality')}</TabsContent>
          <TabsContent value="release" className="space-y-4"><LifecycleTable title="质量放行记录" scope="batchReleases" rows={[...batchReleases].reverse()} rowKey={rowKey} searchText={row => `${row.actorName} ${row.evidence} ${row.id}`} emptyTitle="尚未登记质量放行" columns={[
            { label: '放行人 / 时间', cell: row => <>{row.actorName}<p className="production-meta">{lifecycleDate(row.at)}</p></> }, { label: '累计放行数量', cell: row => `${quantity(row.quantity)} 台` },
            { label: '当前效力', cell: row => <ProductionStatus tone={row.id === batch.releaseId ? 'success' : 'neutral'}>{row.id === batch.releaseId ? '当前有效' : '历史记录'}</ProductionStatus> }, { label: '放行依据', className: 'production-cell-note', cell: row => row.evidence },
          ]} />{shipmentTable(data.shipments.filter(row => row.batchId === batch.id), 'batchShipments')}</TabsContent>
          <TabsContent value="changes"><LifecycleTable title="适用 ECN" scope="batchChanges" rows={data.changes.filter(row => row.batchIds.includes(batch.id))} rowKey={rowKey} searchText={row => `${row.code} ${row.handling}`} emptyTitle="暂无适用 ECN" columns={[
            { label: 'ECN 编号', cell: row => <LifecycleLink onClick={() => openRecord('ecn', row.id)}>{row.code}</LifecycleLink> }, { label: '生效日期', cell: row => row.effectiveDate }, { label: '状态', cell: row => <ProductionStatus tone={row.status === 'published' ? 'success' : 'neutral'}>{statusLabels[row.status]}</ProductionStatus> }, { label: '处置', className: 'production-cell-note', cell: row => row.handling },
          ]} /></TabsContent>
          <TabsContent value="history">{eventsTable(history.filter(row => relatedSubjectIds.has(row.subjectId)), 'batchHistory')}</TabsContent>
        </Tabs></div><aside className="lifecycle-aside" aria-label="批次关联依据">
          <LifecycleFields title="批次档案" items={[{ label: '产品 / 型号', value: `${plan.productName} · ${plan.productLine}`, full: true }, { label: '生产批次', value: batch.code }, { label: '目标数量', value: `${quantity(batch.quantity)} 台` }, { label: '交期', value: batch.dueDate }, { label: '派工作业', value: `${batch.tasks.length} 项` }]} />
          <section className="production-surface"><div className="production-section-heading"><h3>派工固定版本</h3></div>{batch.tasks.some(task => task.basis) ? <div className="lifecycle-snapshots">{batch.tasks.filter(task => task.basis).map(task => <details key={task.id}><summary>{task.name} · {task.basis!.code}</summary><p className="production-meta">固化时间 {lifecycleDate(task.basis!.at)}</p><LifecycleControlledDocuments planId={plan.id} documents={task.basis!.documents} title="作业当时固定资料" /><LifecycleLink onClick={() => openTask(task.id)}>查看原作业与检验</LifecycleLink></details>)}</div> : <p className="lifecycle-muted">尚无已固化的派工资料。不会使用当前最新资料代替历史版本。</p>}</section>
          <p className="lifecycle-muted">领退料、质量复验、版本范围和发货凭证沿原批次追溯；更正与冲销均保留历史。</p>
        </aside></div>
        <footer className="lifecycle-action-bar"><p>生产检验合格、质量放行和实际发货分别记录。复验后请重新核对放行依据。</p><div>{batchActions(batch)}{view === 'archive' && <Button variant="outline" onClick={exportArchive}>导出完整档案</Button>}</div></footer>
      </>}
    </> : <>
      {view === 'shipments' && <>
        <ProductionMetrics items={[{ label: '计划发货目标', value: `${quantity(plan.shipmentTargetQty)} 台` }, { label: '本计划累计净发货', value: `${quantity(data.shipments.filter(row => !row.reversed).reduce((sum, row) => sum + row.quantity, 0))} 台` }, { label: `${plan.month} 实际净发货`, value: `${quantity(data.shipments.filter(row => !row.reversed && row.date.startsWith(plan.month)).reduce((sum, row) => sum + row.quantity, 0))} 台` }]} />
        <p className="production-note">生产完成、质量放行和实际发货分别记录。新增初检、复验或重开异常后，原放行须重新核对。</p>
        {shipmentFirst && shipmentTable(data.shipments)}{batchTable(data.batches)}{!shipmentFirst && shipmentTable(data.shipments)}
      </>}
      {view === 'archive' && <>
        <div className="lifecycle-columns"><div className="lifecycle-main">{batchTable(data.batches, true)}</div><aside className="lifecycle-aside" aria-label="档案关联信息"><LifecycleFields title="当前计划档案" items={[{ label: '产品 / 型号', value: `${plan.productName} · ${plan.productLine}`, full: true }, { label: '计划月份', value: plan.month }, { label: '生产批次', value: `${data.batches.length} 个` }, { label: '转产资料版本', value: `${data.transfers.length} 个` }, { label: '工程变更', value: `${data.changes.length} 项` }]} /><section className="production-surface"><div className="production-section-heading"><h3>相关资料</h3></div><div className="lifecycle-related-links">{data.transfers.map(row => <LifecycleLink key={row.id} onClick={() => openRecord('transfer', row.id)}>{row.code} · {statusLabels[row.status]}</LifecycleLink>)}{!data.transfers.length && <p>暂无转产资料版本。</p>}</div></section></aside></div>
        <details className="lifecycle-secondary"><summary>查看本计划领退料、质量与完整历史</summary><Tabs defaultValue="warehouse" className="gap-4"><div className="production-tabs"><TabsList aria-label="计划追溯记录"><TabsTrigger value="warehouse">领退料记录</TabsTrigger><TabsTrigger value="quality">质量与复验</TabsTrigger><TabsTrigger value="history">完整操作历史</TabsTrigger></TabsList></div>
          <TabsContent value="warehouse">{warehouseTable(data.warehouse, 'archiveWarehouse')}</TabsContent><TabsContent value="quality">{qualityTable(data.qualityRecords, 'archiveQuality')}</TabsContent><TabsContent value="history">{eventsTable(history)}</TabsContent>
        </Tabs></details>
      </>}
    </>}
    {!recordId && view === 'transfer' && <details className="lifecycle-secondary lifecycle-directory" open={!selected}><summary>查看与筛选全部{section === 'ecn' ? '工程变更' : '资料版本'}{!section ? '及 ECN' : ''}</summary><div className="lifecycle-stack">
      {section !== 'ecn' && <LifecycleTable title="转量产资料" description="样品沿原采购任务和轮次关联，已发布资料与已派工版本保持不变。" scope="transfers" rows={data.transfers} rowKey={rowKey} searchText={row => { const task = data.sampleTasks.find(item => item.id === row.sampleTaskId); return `${row.code} ${task?.code ?? ''} ${task?.title ?? ''} ${row.sampleTaskId} ${row.sop} ${row.sip} ${row.drawing}`; }} searchPlaceholder="搜索资料版本、样品或文件编号" status={{ value: row => row.status, options: statusOptions }} actions={canTransfer && <Button disabled={!data.sampleTasks.length} onClick={createTransfer}>新增资料版本</Button>} emptyTitle="暂无转量产资料" emptyDescription="请先在正式采购样品任务中指定测试并登记结果，然后关联资料包。" columns={[
          { label: '资料包版本', className: 'production-cell-main', cell: row => <LifecycleLink onClick={() => openRecord('transfer', row.id)}>{row.code}</LifecycleLink> },
          { label: '样品性质', cell: row => row.type === 'exploration' ? '研发探索' : '转量产验证' },
          { label: '样品来源', className: 'production-cell-note', cell: row => { const task = data.sampleTasks.find(item => item.id === row.sampleTaskId && item.roundId === row.roundId); return <>{task ? `${task.code} · ${task.title}` : row.sampleTaskId}<p className="production-meta">轮次 {row.roundId}</p></>; } },
          { label: '状态', cell: row => <ProductionStatus tone={row.status === 'published' ? 'success' : 'neutral'}>{statusLabels[row.status]}</ProductionStatus> },
          { label: '操作', cell: row => <Button size="sm" variant="outline" onClick={() => openRecord('transfer', row.id)}>查看与办理</Button> },
        ]} />}
      {section !== 'transfer' && <LifecycleTable title="工程变更 ECN" description="以已发布资料为依据，明确适用批次及阅读确认。" scope="changes" rows={data.changes} rowKey={rowKey} searchText={row => `${row.code} ${row.batchIds.map(batchCode).join(' ')} ${row.handling}`} searchPlaceholder="搜索 ECN、适用批次或处置" status={{ value: row => row.status, options: statusOptions.filter(row => row.value !== 'validated') }} actions={canTransfer && <Button variant="outline" disabled={!packageOptions.length || !plan.batches.length} onClick={createChange}>新增 ECN</Button>} emptyTitle="暂无工程变更" columns={[
          { label: 'ECN 编号', className: 'production-cell-main', cell: row => <LifecycleLink onClick={() => openRecord('ecn', row.id)}>{row.code}</LifecycleLink> }, { label: '生效日期', cell: row => row.effectiveDate },
          { label: '适用批次', className: 'production-cell-note', cell: row => row.batchIds.map(batchCode).join('、') }, { label: '已确认阅读', cell: row => `${row.acknowledgments.length} 人` }, { label: '执行反馈', cell: row => { const pending = row.feedback?.filter(item => item.status !== 'resolved').length ?? 0; return <ProductionStatus tone={pending ? 'warning' : 'neutral'}>{pending ? pending + ' 项待处理' : '暂无待处理'}</ProductionStatus>; } },
          { label: '状态', cell: row => <ProductionStatus tone={row.status === 'published' ? 'success' : 'neutral'}>{statusLabels[row.status]}</ProductionStatus> }, { label: '操作', cell: row => <Button size="sm" variant="outline" onClick={() => openRecord('ecn', row.id)}>查看与办理</Button> },
        ]} />}
    </div></details>}
    {editor && <OperationalDialog className="production-ui-theme" editor={editor} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); setReload(value => value + 1); }} />}
    {serialShipment && <ShipmentSerialDialog shipment={serialShipment} ranges={data.versionRanges ?? []} shipments={data.shipments} onClose={() => setSerialShipment(null)} onSaved={() => { setSerialShipment(null); setReload(value => value + 1); }} submit={(serialNumbers, reason, requestId) => commandProductionLifecycle(plan.id, 'lifecycle', { action: 'bind-shipment-sns', requestId, version: data.version, data: { id: serialShipment.id, serialNumbers, reason } })} />}
  </section>;
}
