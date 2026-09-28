import { WarehouseRecordsPanel } from './WarehouseRecordsPanel';
import { useEffect, useId, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ArrowLeft, Loader2, PackageCheck, RefreshCw } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { NativeSelect } from '../components/ui/native-select';
import { Checkbox } from '../components/ui/checkbox';
import { Skeleton } from '../components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../components/ui/alert-dialog';
import { HorizonPageHeader } from '../components/horizon/HorizonPage';
import { useAuth } from '../auth';
import { usePermission } from '../hooks/usePermission';
import { useI18n } from '../lib/i18n';
import { routePath } from '../lib/routePaths';
import { commandWarehouseFlow, getWarehouseFlows, reconcileWarehouseFlow, type WarehouseFlowResponse, type WarehouseIssue } from '../lib/warehouseFlowApi';
import { WAREHOUSE_STATUS as STATUS, WAREHOUSE_CHECK_STATUS as CHECK_STATUS, latestWarehouseCheck as latestCheck, warehouseCheckLabel, warehousePage, warehouseQuery, warehouseSearch } from './warehouse-flow/warehouseViewState';
import { WarehousePagination } from './warehouse-flow/WarehousePagination';
import './warehouse-flow/warehouseFlow.css';
const qty = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 3 });

export function WarehouseFlowPage() {
  const { user } = useAuth();
  return <WarehouseFlowWorkspace key={JSON.stringify([user?.id, [...(user?.permissions ?? [])].sort()])} />;
}
function WarehouseFlowWorkspace() {
  const { t } = useI18n(), { user } = useAuth(), canPlans = usePermission('page:production-execution');
  const [params, setParams] = useSearchParams();
  const taskId = params.get('taskId') || '', selectedId = params.get('issue'), status = params.get('status') === 'all' ? 'all' : 'active';
  const view = params.get('warehouseView') === 'records' || params.get('record') ? 'records' : 'issues';
  const detail = view === 'issues' ? Boolean(selectedId) : Boolean(params.get('record'));
  const [data, setData] = useState<WarehouseFlowResponse | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(''), [reload, setReload] = useState(0);
  const [editor, setEditor] = useState<{ issue: WarehouseIssue; action: 'issue' | 'sign' } | null>(null);
  const [checkEditor, setCheckEditor] = useState<{ issue: WarehouseIssue; event: WarehouseIssue['history'][number]; revoke: boolean } | null>(null);
  const apiStatus = selectedId ? 'all' : status;
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setData(null); setError(''); setEditor(null); setCheckEditor(null);
    getWarehouseFlows(taskId, apiStatus, controller.signal).then(value => { if (!controller.signal.aborted) setData(value); }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : t('领料记录读取失败')); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [taskId, apiStatus, reload, t]);
  const change = (patch: Record<string, string | null>) => setParams(previous => warehouseQuery(previous, patch));
  const href = (patch: Record<string, string | null>) => '?' + warehouseQuery(params, patch);
  const search = params.get('issueQ') || '', issueStatus = params.get('issueStatus') || 'all';
  const issues = data?.items.filter(issue => (issueStatus === 'all' || issue.status === issueStatus) && warehouseSearch(search, [issue.title, issue.productLine, issue.recipientName, ...issue.lines.flatMap(line => [line.code, line.name])])) ?? [];
  const page = warehousePage(issues, params.get('issuePage')), selectedIssue = data?.items.find(issue => issue.id === selectedId);
  return <main className={`horizon-theme warehouse-page${detail ? "" : " warehouse-page--list"}`}>
    {view === 'issues' && selectedId && <Button variant="ghost" className="self-start" onClick={() => change({ issue: null })}><ArrowLeft className="size-4" aria-hidden="true" />{t('返回领料列表')}</Button>}
    <HorizonPageHeader Icon={PackageCheck} eyebrow={t('供应链 / 仓库办理')} title={t(view === 'issues' && selectedId ? '领料详情' : '仓库领退料与盘点')} description={t('实物交接与 ERP 凭证分别核对，按原始单据办理。')} actions={<Button variant="outline" disabled={loading} onClick={() => setReload(value => value + 1)}><RefreshCw className="size-4" aria-hidden="true" />{t('刷新')}</Button>} />
    {!detail && <Tabs value={view} onValueChange={value => change({ warehouseView: value === 'records' ? 'records' : null, issue: null, record: null })}><TabsList aria-label={t('仓库工作视图')}><TabsTrigger value="issues" id="warehouse-issues-tab" aria-controls="warehouse-issues-panel">{t('领料与签收')}</TabsTrigger><TabsTrigger value="records" id="warehouse-records-tab" aria-controls="warehouse-records-panel">{t('入库、退料与盘点')}</TabsTrigger></TabsList></Tabs>}
    {view === 'records' ? <div className={detail ? undefined : "warehouse-page-content"} role={detail ? undefined : 'tabpanel'} id="warehouse-records-panel" aria-labelledby={detail ? undefined : 'warehouse-records-tab'}><>{error && <div role="alert" className="warehouse-surface mb-4 p-4"><p className="text-sm text-destructive">{error}</p><p className="mt-1 text-xs text-muted-foreground">{t('领料来源尚未读取成功，退料入口将在重新读取后恢复。')}</p><Button className="mt-3" variant="outline" onClick={() => setReload(value => value + 1)}>{t('重新读取领料来源')}</Button></div>}<WarehouseRecordsPanel issues={data?.items ?? []} reload={reload} onSaved={() => setReload(value => value + 1)} /></></div> : <div role={detail ? undefined : 'tabpanel'} id="warehouse-issues-panel" aria-labelledby={detail ? undefined : 'warehouse-issues-tab'} className={detail ? "space-y-4" : "warehouse-page-content"}>
      {!selectedId && <section className="warehouse-surface warehouse-list-surface"><div className="warehouse-toolbar"><Input className="min-w-48 flex-1" aria-label={t('搜索领料记录')} placeholder={t('搜索作业、物料或领料人')} value={search} onChange={event => change({ issueQ: event.target.value, issuePage: null })} /><NativeSelect aria-label={t('记录范围')} value={status} onChange={event => change({ status: event.target.value, issuePage: null })}><option value="active">{t('办理中与待核对')}</option><option value="all">{t('全部记录，含已取消')}</option></NativeSelect><NativeSelect aria-label={t('办理状态')} value={issueStatus} onChange={event => change({ issueStatus: event.target.value, issuePage: null, ...(event.target.value === 'cancelled' ? { status: 'all' } : {}) })}><option value="all">{t('全部办理状态')}</option>{Object.entries(STATUS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</NativeSelect>{taskId && <Button variant="outline" onClick={() => change({ taskId: null, issuePage: null })}>{t('查看其他领料')}</Button>}</div>
      {error ? <div role="alert" className="p-5"><p className="text-sm text-destructive">{error}</p><Button variant="outline" className="mt-3" onClick={() => setReload(value => value + 1)}>{t('重新加载')}</Button></div> : loading ? <div role="status" aria-label={t('加载领料记录')} className="p-4"><Skeleton className="h-64 w-full rounded-xl" /></div> : !issues.length ? <div className="p-8 text-center"><h2 className="text-sm font-semibold">{t(search || issueStatus !== 'all' ? '没有匹配的领料记录' : '暂无可见的生产领料需求')}</h2><p className="mt-2 text-sm text-muted-foreground">{t('计划员确认派工后生成领料需求；现场人员只能查看本人的领料记录。')}</p>{(search || issueStatus !== 'all') && <Button variant="outline" className="mt-3" onClick={() => change({ issueQ: null, issueStatus: null, issuePage: null })}>{t('清除筛选')}</Button>}</div> : <div className="warehouse-table-scroll"><Table containerClassName="overflow-visible" className="min-w-[760px]"><TableHeader><TableRow>{['生产作业 / 物料', '领料人', '需求日', '办理状态', 'ERP 核对', '操作'].map(label => <TableHead scope="col" key={label}>{t(label)}</TableHead>)}</TableRow></TableHeader><TableBody>{page.rows.map(issue => <TableRow key={issue.id}><TableCell className="max-w-80 whitespace-normal"><Link to={href({ issue: issue.id })} className="font-medium hover:text-primary hover:underline">{issue.title}</Link><p className="mt-1 text-xs text-muted-foreground">{issue.productLine} · {t('{count} 项物料', { count: issue.lines.length })}</p></TableCell><TableCell>{issue.recipientName}</TableCell><TableCell className="tabular-nums">{issue.neededDate}</TableCell><TableCell className="text-xs">{t(STATUS[issue.status])}</TableCell><TableCell className="text-xs text-muted-foreground">{t(warehouseCheckLabel(issue))}</TableCell><TableCell><Button asChild size="sm" variant="outline"><Link to={href({ issue: issue.id })}>{t('查看办理')}</Link></Button></TableCell></TableRow>)}</TableBody></Table></div>}
      {!loading && !error && <WarehousePagination {...page} onPage={value => change({ issuePage: String(value) })} />}</section>}
      {selectedId && (error ? <section role="alert" className="warehouse-surface p-5"><p className="text-sm text-destructive">{error}</p><Button className="mt-3" variant="outline" onClick={() => setReload(value => value + 1)}>{t('重新加载')}</Button></section> : loading ? <p role="status" className="p-6 text-sm text-muted-foreground">{t('正在读取领料详情…')}</p> : !selectedIssue ? <p role="status" className="warehouse-surface p-6 text-sm text-muted-foreground">{t('该领料记录不在当前可见范围，请返回列表重新选择。')}</p> : <div className="warehouse-issue-detail">{[selectedIssue].map((issue) => <Card variant="subtle" key={issue.id} className="gap-4 p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs text-muted-foreground">{issue.productLine} · {t('需求日')} {issue.neededDate}</p><h2 className="mt-1 font-semibold">{issue.title}</h2><p className="mt-1 text-sm text-muted-foreground">{t('领料人')}：{issue.recipientName} · {t(STATUS[issue.status])}</p></div><div className="flex flex-wrap gap-2">{data?.canIssue && !['cancelled', 'signed'].includes(issue.status) && issue.lines.some((line) => (line.issuedQty ?? 0) < line.quantity) && <Button onClick={() => setEditor({ issue, action: 'issue' })}>{t('登记发料')}</Button>}{issue.recipientId === user?.id && issue.status !== 'cancelled' && issue.lines.some((line) => (line.signedQty ?? 0) < (line.issuedQty ?? 0)) && <Button onClick={() => setEditor({ issue, action: 'sign' })}>{t('确认签收')}</Button>}{canPlans && <Button asChild variant="outline"><Link to={`${routePath('page:production-execution', '/production-execution')}?${new URLSearchParams({ month: issue.planId.slice(0, 7), plan: issue.planId })}`}>{t('查看生产来源')}</Link></Button>}</div></div>
      <details open className="warehouse-issue-materials text-sm"><summary className="cursor-pointer rounded-lg py-2 text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('物料明细')} · {issue.lines.length}</summary><Table><TableHeader><TableRow><TableHead>{t('物料')}</TableHead><TableHead className="text-right">{t('需求')}</TableHead><TableHead className="text-right">{t('已发')}</TableHead><TableHead className="text-right">{t('已签收')}</TableHead></TableRow></TableHeader><TableBody>{issue.lines.map((line) => <TableRow key={line.code}><TableCell><p>{line.name}</p><p className="mt-1 text-xs text-muted-foreground">{line.code} · {line.unit}</p></TableCell><TableCell className="text-right tabular-nums">{qty(line.quantity)}</TableCell><TableCell className="text-right tabular-nums">{qty(line.issuedQty ?? 0)}</TableCell><TableCell className="text-right tabular-nums">{qty(line.signedQty ?? 0)}</TableCell></TableRow>)}</TableBody></Table></details>
      <div className="space-y-2">{issue.history.filter((event) => event.action === 'issue').map((event) => {
        const checked = latestCheck(issue, event.id), result = checked?.reconciliation?.result;
        const awaitingSync = result === 'matched' && event.lines?.some((line) => {
          const balance = data?.balances.find((row) => row.code === line.code && row.warehouse === line.warehouse);
          return !balance?.syncedAt || new Date(balance.syncedAt) <= new Date(checked!.at);
        });
        return <div key={event.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/40 px-4 py-3"><div className="min-w-0"><p className="text-sm font-medium">{t(result ? CHECK_STATUS[result] : 'T+ 待核对')}</p><p className="mt-1 text-xs text-muted-foreground">{t('发料')} {new Date(event.at).toLocaleString()}{checked?.reconciliation?.voucherNumber && ` · ${checked.reconciliation.voucherNumber}`}</p>{awaitingSync && <p className="mt-1 text-xs text-muted-foreground">{t('等待核对后的 T+ 库存同步，占用暂保留')}</p>}</div>{data?.canReconcile && <Button size="sm" variant="outline" onClick={() => setCheckEditor({ issue, event, revoke: result === 'matched' })}>{t(result === 'matched' ? '撤回核对' : result === 'difference' ? '处理差异' : '核对凭证')}</Button>}</div>;
      })}</div>
      <details className="text-sm"><summary className="cursor-pointer text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('办理记录')} · {issue.history.length}</summary><div className="mt-3 divide-y divide-border">{[...issue.history].reverse().map((event) => <div key={event.id} className="py-3"><p className="text-xs text-muted-foreground">{event.actorName} · {new Date(event.at).toLocaleString()} · {t(event.reconciliation ? CHECK_STATUS[event.reconciliation.result] : event.action === 'issue' ? '发料登记' : event.action === 'sign' ? '现场签收' : '生产派工')}</p><p className="mt-1 text-pretty">{event.reason}</p>{event.reconciliation && <div className="mt-2 space-y-1 text-xs text-muted-foreground"><p>{t('人工核对')} · {event.reconciliation.voucherNumber ?? t('撤回核对')} {event.reconciliation.posted === false && ` · ${t('凭证未生效')}`} {event.reconciliation.detailsMatch === false && ` · ${t('物料、仓库或单位不一致')}`}</p>{event.reconciliation.lines.map((line) => <p key={line.code} className="tabular-nums">{line.code} · {t('凭证行')} {line.voucherLine} · {t('本次对应')} {qty(line.quantity)} / {t('凭证行总量')} {qty(line.voucherQuantity)}</p>)}</div>}{event.lines?.map((line) => <p key={line.code} className="mt-1 text-xs tabular-nums text-muted-foreground">{line.code} · {qty(line.quantity)} {issue.lines.find((row) => row.code === line.code)?.unit}{line.warehouse && ` · ${line.warehouse}`}</p>)}</div>)}</div></details>
    </Card>)}</div>)}
      <p className="text-pretty text-xs leading-5 text-muted-foreground">{t('这里记录实物交接。T+ 是库存主账，发料及签收不会直接改写 T+ 库存；尚未核对的发料继续保留，不能重复当作可发库存。')}</p>
    </div>}
    {editor && data && <WarehouseIssueEditor key={editor.issue.id + ':' + editor.action} {...editor} balances={data.balances} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); setReload(value => value + 1); }} />}
    {checkEditor && <WarehouseReconcileEditor key={checkEditor.issue.id + ':' + checkEditor.event.id + ':' + checkEditor.revoke} {...checkEditor} onClose={() => setCheckEditor(null)} onSaved={() => { setCheckEditor(null); setReload(value => value + 1); }} />}
  </main>;
}

export function WarehouseReconcileEditor({ issue, event, revoke, onClose, onSaved }: { issue: WarehouseIssue; event: WarehouseIssue['history'][number]; revoke: boolean; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n(), id = useId();
  const previous = latestCheck(issue, event.id)?.reconciliation;
  const [voucherNumber, setVoucherNumber] = useState(previous?.voucherNumber ?? ''), [reason, setReason] = useState('');
  const [posted, setPosted] = useState(false), [detailsMatch, setDetailsMatch] = useState(false);
  const [values, setValues] = useState<Record<string, { voucherLine: string; quantity: string; voucherQuantity: string }>>(() => Object.fromEntries((previous?.lines ?? []).map((line) => [line.code, { voucherLine: line.voucherLine, quantity: String(line.quantity), voucherQuantity: String(line.voucherQuantity) }])));
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [discard, setDiscard] = useState(false), [confirmRevoke, setConfirmRevoke] = useState(false), [dirty, setDirty] = useState(false);
  const locked = useRef(false), mounted = useRef(true), request = useRef<{ signature: string; id: string } | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const close = () => { if (!locked.current) dirty ? setDiscard(true) : onClose(); };
  const change = (code: string, field: 'voucherLine' | 'quantity' | 'voucherQuantity', value: string) => { setDirty(true); setValues((current) => ({ ...current, [code]: { voucherLine: '', quantity: '', voucherQuantity: '', ...current[code], [field]: value } })); };
  const matches = posted && detailsMatch && event.lines?.every((line) => values[line.code]?.quantity.trim() && Number(values[line.code].quantity) === line.quantity);
  async function save() {
    if (locked.current) return;
    try {
      if (!reason.trim()) throw new Error(t('请填写凭证依据与核对说明'));
      const lines = revoke ? undefined : (event.lines ?? []).map((line) => {
        const value = values[line.code];
        if (!value?.voucherLine.trim() || !value.quantity.trim() || !value.voucherQuantity.trim()) throw new Error(t('请逐项填写凭证行号、总数量及本次对应数量'));
        const quantity = Number(value.quantity), voucherQuantity = Number(value.voucherQuantity);
        if (!Number.isFinite(quantity) || !Number.isFinite(voucherQuantity) || quantity < 0 || voucherQuantity < 0 || quantity > voucherQuantity) throw new Error(t('对应数量须为非负数，且不能超过凭证行总数量'));
        return { code: line.code, voucherLine: value.voucherLine.trim(), quantity, voucherQuantity };
      });
      if (!revoke && !voucherNumber.trim()) throw new Error(t('请填写 T+ 出库单号'));
      const payload = { version: issue.version, eventId: event.id, reason: reason.trim(), ...(revoke ? { revoke: true } : { voucherNumber: voucherNumber.trim(), posted, detailsMatch, lines }) }, signature = JSON.stringify(payload);
      if (request.current?.signature !== signature) request.current = { signature, id: crypto.randomUUID() };
      locked.current = true; setBusy(true); setError('');
      await reconcileWarehouseFlow(issue.id, { ...payload, requestId: request.current.id });
      if (mounted.current) onSaved();
    } catch (cause) { if (mounted.current) { setError(cause instanceof Error ? cause.message : t('核对保存失败')); requestAnimationFrame(() => document.getElementById(`${id}-error`)?.focus()); } }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  }
  return <><Dialog open onOpenChange={(open) => { if (!open) close(); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl" onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => { if (busy) e.preventDefault(); }}>
    <DialogHeader><DialogTitle>{t(revoke ? '撤回人工核对' : '核对 T+ 出库凭证')}</DialogTitle><DialogDescription>{issue.title} · {new Date(event.at).toLocaleString()}</DialogDescription></DialogHeader>
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); if (revoke) setConfirmRevoke(true); else void save(); }}><fieldset disabled={busy} className="space-y-4">
      <p className="text-pretty text-sm leading-6 text-muted-foreground">{t(revoke ? '撤回后恢复待核对并保留原记录。请先在 T+ 核实或纠正凭证，再重新核对。' : '请打开实际 T+ 凭证逐项检查。这里保存人工核对结果，不代表系统已读取或自动验证凭证。')}</p>
      {!revoke && <><div className="space-y-2"><Label htmlFor={`${id}-voucher`}>{t('T+ 出库单号')}</Label><Input id={`${id}-voucher`} required maxLength={128} value={voucherNumber} onChange={(e) => { setDirty(true); setVoucherNumber(e.target.value); }} /></div>
        {(event.lines ?? []).map((line, index) => <div key={line.code} className="space-y-3 rounded-xl border border-border p-4"><div><p className="text-sm font-medium">{issue.lines.find((row) => row.code === line.code)?.name} · {line.code}</p><p className="mt-1 text-xs tabular-nums text-muted-foreground">{line.warehouse} · {t('本次实发')} {qty(line.quantity)} {issue.lines.find((row) => row.code === line.code)?.unit}</p></div><div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-2"><Label htmlFor={`${id}-line-${index}`}>{t('凭证行号')}</Label><Input id={`${id}-line-${index}`} required maxLength={128} value={values[line.code]?.voucherLine ?? ''} onChange={(e) => change(line.code, 'voucherLine', e.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor={`${id}-total-${index}`}>{t('凭证行总数量')}</Label><Input id={`${id}-total-${index}`} required type="number" min="0" step="0.001" value={values[line.code]?.voucherQuantity ?? ''} onChange={(e) => change(line.code, 'voucherQuantity', e.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor={`${id}-quantity-${index}`}>{t('对应本次发料数量')}</Label><Input id={`${id}-quantity-${index}`} required type="number" min="0" step="0.001" value={values[line.code]?.quantity ?? ''} onChange={(e) => change(line.code, 'quantity', e.target.value)} /></div>
        </div></div>)}
        <p className="text-pretty text-xs leading-5 text-muted-foreground">{t('同一凭证行可对应多次分批发料，累计对应数量不能超过凭证行总数量。数量不符时按实际填写并记录差异。')}</p>
        <div className="space-y-3"><div className="flex items-start gap-2"><Checkbox id={`${id}-posted`} checked={posted} onCheckedChange={(value) => { setDirty(true); setPosted(value === true); }} /><Label htmlFor={`${id}-posted`} className="text-sm leading-5">{t('已查看凭证，确认已生效且未作废、未冲销')}</Label></div><div className="flex items-start gap-2"><Checkbox id={`${id}-details`} checked={detailsMatch} onCheckedChange={(value) => { setDirty(true); setDetailsMatch(value === true); }} /><Label htmlFor={`${id}-details`} className="text-sm leading-5">{t('凭证方向为出库，物料编码、仓库及单位与上方发料明细一致')}</Label></div></div>
      </>}
      <div className="space-y-2"><Label htmlFor={`${id}-reason`}>{t(revoke ? '撤回原因' : '凭证依据与核对说明')}</Label><Textarea id={`${id}-reason`} required maxLength={2000} value={reason} placeholder={t(revoke ? '说明凭证变更或原核对错误' : '填写凭证查阅位置、附件依据；存在差异时说明原因及处理事项')} onChange={(e) => { setDirty(true); setReason(e.target.value); }} /></div>
      {!revoke && <p className="text-pretty text-xs leading-5 text-muted-foreground">{t(matches ? '将保存为人工核对一致。新的 T+ 库存查询完成后才解除这笔发料的占用。' : '数量或明细尚未核对一致，将保存为差异待处理，并继续保留发料占用。')}</p>}
    </fieldset>{error && <p id={`${id}-error`} tabIndex={-1} role="alert" className="rounded-lg bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}<DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={close}>{t('取消')}</Button><Button type="submit" disabled={busy}>{busy && <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}{t(revoke ? '撤回核对' : matches ? '确认人工核对一致' : '保存差异')}</Button></DialogFooter></form>
  </DialogContent></Dialog>
  <AlertDialog open={discard} onOpenChange={setDiscard}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t('放弃尚未保存的核对？')}</AlertDialogTitle><AlertDialogDescription>{t('已保存的核对及发料记录会保留。')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t('继续填写')}</AlertDialogCancel><AlertDialogAction onClick={onClose}>{t('放弃填写')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  <AlertDialog open={confirmRevoke} onOpenChange={setConfirmRevoke}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t('确认撤回这次核对？')}</AlertDialogTitle><AlertDialogDescription>{t('该笔发料将恢复待核对，并重新计入库存占用。原核对及撤回原因均会保留。')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t('继续检查')}</AlertDialogCancel><AlertDialogAction onClick={() => void save()}>{t('确认撤回')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </>;
}

export function WarehouseIssueEditor({ issue, action, balances, onClose, onSaved }: { issue: WarehouseIssue; action: 'issue' | 'sign'; balances: WarehouseFlowResponse['balances']; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n(), id = useId();
  const [values, setValues] = useState<Record<string, { quantity: string; warehouse: string; batchNo?: string }>>({}), [reason, setReason] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [discard, setDiscard] = useState(false);
  const locked = useRef(false), mounted = useRef(true), request = useRef<{ signature: string; id: string } | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const dirty = !!reason || Object.values(values).some((value) => value.quantity || value.warehouse);
  const close = () => { if (!locked.current) dirty ? setDiscard(true) : onClose(); };
  const remaining = (line: WarehouseIssue['lines'][number]) => action === 'issue' ? line.quantity - (line.issuedQty ?? 0) : (line.issuedQty ?? 0) - (line.signedQty ?? 0);
  const change = (code: string, field: 'quantity' | 'warehouse' | 'batchNo', value: string) => setValues((previous) => ({ ...previous, [code]: { quantity: '', warehouse: '', ...previous[code], [field]: value } }));
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (locked.current) return;
    try {
      const lines = Object.entries(values).filter(([, value]) => value.quantity.trim() !== '').map(([code, value]) => {
        const quantity = Number(value.quantity), source = issue.lines.find((line) => line.code === code);
        if (!source || !Number.isFinite(quantity) || quantity <= 0 || quantity > remaining(source)) throw new Error(t('请填写大于0且不超过待办理数量的本次数量'));
        if (action === 'issue' && !value.warehouse) throw new Error(t('请选择本次发料仓库'));
        return { code, quantity, ...(value.batchNo?.trim() ? { batches: [{ batchNo: value.batchNo.trim(), quantity }], batchPendingQty: 0 } : { batches: [], batchPendingQty: quantity }), ...(action === 'issue' ? { warehouse: value.warehouse } : {}) };
      });
      if (!lines.length || !reason.trim()) throw new Error(t('请填写至少一种物料的本次数量和办理依据'));
      const payload = { version: issue.version, action, reason: reason.trim(), lines }, signature = JSON.stringify(payload);
      if (request.current?.signature !== signature) request.current = { signature, id: crypto.randomUUID() };
      locked.current = true; setBusy(true); setError('');
      await commandWarehouseFlow(issue.id, { ...payload, requestId: request.current.id });
      if (mounted.current) onSaved();
    } catch (cause) { if (mounted.current) { setError(cause instanceof Error ? cause.message : t('提交失败')); requestAnimationFrame(() => document.getElementById(`${id}-error`)?.focus()); } }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  }
  return <><Dialog open onOpenChange={(open) => { if (!open) close(); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl" onInteractOutside={(event) => event.preventDefault()} onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }}><DialogHeader><DialogTitle>{t(action === 'issue' ? '登记本次发料' : '确认现场签收')}</DialogTitle><DialogDescription>{issue.title} · {issue.recipientName}</DialogDescription></DialogHeader><form onSubmit={submit} className="space-y-5"><fieldset disabled={busy} className="space-y-4">{issue.lines.filter((line) => remaining(line) > 0).map((line, index) => <div key={line.code} className="space-y-3 rounded-xl border border-border p-4"><div><p className="text-sm font-medium">{line.name}</p><p className="mt-1 text-xs text-muted-foreground">{line.code} · {t('待办理')} {qty(remaining(line))} {line.unit}</p></div><div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor={`${id}-qty-${index}`}>{t('本次数量')}（{line.unit}）</Label><Input id={`${id}-qty-${index}`} type="number" min="0.001" step="0.001" max={remaining(line)} value={values[line.code]?.quantity ?? ''} placeholder={t('本次不办理可留空')} onChange={(event) => change(line.code, 'quantity', event.target.value)} /></div>{action === 'issue' && <div className="space-y-2"><Label htmlFor={`${id}-warehouse-${index}`}>{t('发料仓库')}</Label><NativeSelect id={`${id}-warehouse-${index}`} value={values[line.code]?.warehouse ?? ''} onChange={(event) => change(line.code, 'warehouse', event.target.value)}><option value="">{t('请选择已同步仓库')}</option>{balances.filter((row) => row.code === line.code && row.unit === line.unit && row.syncedAt).map((row) => <option key={row.warehouse} value={row.warehouse}>{row.warehouse} · {t('ERP 可用')} {qty(row.available)}</option>)}</NativeSelect></div>}</div><div className="space-y-2"><Label htmlFor={`${id}-batch-${index}`}>{t('实际库存批号')}</Label>{action === 'issue' ? <Input id={`${id}-batch-${index}`} value={values[line.code]?.batchNo ?? ''} maxLength={120} placeholder={t('按实物标签填写，未知留空待补')} onChange={event => change(line.code, 'batchNo', event.target.value)} /> : <NativeSelect id={`${id}-batch-${index}`} value={values[line.code]?.batchNo ?? ''} onChange={event => change(line.code, 'batchNo', event.target.value)}><option value="">{t('批号待补')}</option>{(line.issuedBatches ?? []).filter(row => row.quantity > (line.signedBatches?.find(signed => signed.batchNo === row.batchNo)?.quantity ?? 0)).map(row => <option key={row.batchNo} value={row.batchNo}>{row.batchNo} · {qty(row.quantity - (line.signedBatches?.find(signed => signed.batchNo === row.batchNo)?.quantity ?? 0))} {line.unit}</option>)}</NativeSelect>}<p className="text-xs text-muted-foreground">{t('每次可办理一个实际库存批号；不同批号分次登记，不能用生产或采购单号代替。')}</p></div></div>)} <p className="text-pretty text-xs leading-5 text-muted-foreground">{t(action === 'issue' ? '按实物交接数量登记，系统会扣除尚待 T+ 核对的已登记发料后检查可发量。此操作不代表 T+ 已出库。' : '请清点后填写实际收到的数量，仅当前领料人可确认。签收不会修改 T+ 库存。')}</p><div className="space-y-2"><Label htmlFor={`${id}-reason`}>{t('办理依据与说明')}</Label><Textarea id={`${id}-reason`} required maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} /></div></fieldset>{error && <p id={`${id}-error`} tabIndex={-1} role="alert" className="rounded-lg bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}<DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={close}>{t('取消')}</Button><Button type="submit" disabled={busy}>{busy && <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}{t(action === 'issue' ? '确认本次发料' : '确认本次签收')}</Button></DialogFooter></form></DialogContent></Dialog><AlertDialog open={discard} onOpenChange={setDiscard}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t('放弃尚未保存的填写？')}</AlertDialogTitle><AlertDialogDescription>{t('已保存的发料和签收记录会保留。')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t('继续填写')}</AlertDialogCancel><AlertDialogAction onClick={onClose}>{t('放弃填写')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></>;
}
