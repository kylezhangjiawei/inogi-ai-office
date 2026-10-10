import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, BarChart3, ClipboardCheck, Factory, Loader2, Pencil, Plus, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../../components/ui/alert-dialog';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { Tabs, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { usePermission } from '../../hooks/usePermission';
import { useI18n } from '../../lib/i18n';
import { getProcurementOperations, getProcurementOperationsOptions, saveProductionReport, saveQualityRecord, type OperationsOptions, type OperationsResponse, type OperationsScope, type ProductionReport, type QualityDisposition, type QualityRecord, type QualitySource, type QualityStatus } from '../../lib/procurementOperationsApi';
import { NativeSelect } from "../../components/ui/native-select";
import type { ProductionFollowUp } from '../../lib/procurementOperationsApi';

import { QualityVerificationDialog } from "./QualityVerificationDialog";
import { QualityRecordsPanel } from "../quality/QualityRecordsPanel";

const sourceLabels: Record<QualitySource, string> = { procurement: '采购不良', production: '生产不良', warehouse: '仓库不良', after_sales: '售后不良' };
const statusLabels: Record<QualityStatus, string> = { open: '待处理', processing: '处理中', closed: '已关闭' };
const dispositionLabels: Record<QualityDisposition, string> = { pending: '待判定', return: '退货', rework: '返工', scrap: '报废', concession: '让步接收', replacement: '换货' };
const quantity = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 3 });
const percent = (value: number | null) => value === null ? '—' : `${value}%`;
const today = () => new Date().toLocaleDateString('sv-SE');
const selectClass = 'h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50';

function Field({ label, children, required = false }: { label: string; children: ReactNode; required?: boolean }) {
  return <label className="grid min-w-0 gap-1.5 text-sm font-medium text-slate-700"><span>{label}{required && <span aria-hidden="true" className="ml-1 text-rose-600">*</span>}</span>{children}</label>;
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return <div className="min-w-0 rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 break-words text-sm font-semibold tabular-nums text-[#1b2559]">{value}</p></div>;
}

type EditorState = { kind: 'production'; record?: ProductionReport } | { kind: 'quality'; record?: QualityRecord; sourceReport?: ProductionFollowUp };

/** 产品概览只读汇总；选择具体子系统后按独立权限提供报工和质量闭环。 */
export function SubsystemOperationsPanel({ productId, treeNodeId, stockPlanId }: { productId: string; treeNodeId?: string; stockPlanId?: string }) {
  const { t } = useI18n();
  const canProduction = usePermission('proc-production:report');
  const canQuality = usePermission('proc-quality:manage');
  const [tab, setTab] = useState<'production' | 'quality'>('production');
  const [month, setMonth] = useState(() => today().slice(0, 7));
  const canVerify = usePermission('proc-quality:verify');
  const [verification, setVerification] = useState<QualityRecord | null>(null);
  const [loaded, setData] = useState<{ key: string; value: OperationsResponse } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [qualityView, setQualityView] = useState<'pending' | 'month'>('pending');
  const scopeKey = `${productId}:${treeNodeId ?? ''}:${stockPlanId ?? ''}`;
  const dataKey = `${scopeKey}:${month}:${qualityView}`;
  const data = loaded?.key === dataKey ? loaded.value : null;
  useEffect(() => { setEditor(null); setVerification(null); }, [scopeKey]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    void getProcurementOperations({ productId, treeNodeId, stockPlanId, month, qualityView }, controller.signal).then((next) => {
      if (!controller.signal.aborted) setData({ key: dataKey, value: next });
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : t('生产与质量数据加载失败'));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [productId, treeNodeId, stockPlanId, month, qualityView, dataKey, version, t]);
  const refresh = () => setVersion((value) => value + 1);
  const canCreate = Boolean(treeNodeId && (tab === 'production' ? canProduction : canQuality));
  return <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-label={t('子系统生产与质量')}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="hidden sm:block"><h3 className="flex items-center gap-2 text-sm font-semibold text-[#1b2559]"><Factory aria-hidden="true" className="size-4 text-primary" />{t('生产与质量')}</h3><p className="mt-1 text-xs text-slate-500">{t(treeNodeId ? '按日期核对生产数量、产能及不良处理进度。' : '当前产品各子系统汇总；进入具体模块后可登记报工和不良。')}</p></div>
      <div className="flex flex-wrap items-center gap-2">
        {(tab === 'production' || qualityView === 'month') && <label className="flex items-center gap-2 text-sm text-slate-600">{t('月份')}<Input type="month" aria-label={t('生产与质量统计月份')} className="h-8 w-40" value={month} onChange={(event) => event.target.value && setMonth(event.target.value)} /></label>}
        <Button type="button" variant="outline" size="sm" onClick={refresh} disabled={loading} aria-label={t('刷新生产与质量数据')}><RefreshCw aria-hidden="true" className={`size-3.5 ${loading ? 'animate-spin' : ''}`} /></Button>
        {canCreate && <Button type="button" size="sm" className="bg-primary hover:bg-primary-hover" onClick={() => setEditor(tab === 'production' ? { kind: 'production' } : { kind: 'quality' })}><Plus aria-hidden="true" className="size-3.5" />{t(tab === 'production' ? '登记报工' : '登记不良')}</Button>}
      </div>
    </div>
    <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)} className="mt-4"><TabsList aria-label={t('生产与质量分类')}><TabsTrigger value="production"><BarChart3 aria-hidden="true" className="mr-1 size-3.5" />{t('生产报工与产能')}</TabsTrigger><TabsTrigger value="quality"><ClipboardCheck aria-hidden="true" className="mr-1 size-3.5" />{t('质量异常')}</TabsTrigger></TabsList></Tabs>
    {tab === 'quality' && <div className="mt-4 flex flex-wrap gap-2" aria-label={t('质量记录范围')}><Button size="sm" variant={qualityView === 'pending' ? 'default' : 'outline'} aria-pressed={qualityView === 'pending'} onClick={() => setQualityView('pending')}>{t('待闭环（跨月）')}</Button><Button size="sm" variant={qualityView === 'month' ? 'default' : 'outline'} aria-pressed={qualityView === 'month'} onClick={() => setQualityView('month')}>{t('按月历史')}</Button></div>}
    {error && <div role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-4"><p className="text-sm text-rose-700">{error}</p><Button type="button" className="mt-2" size="sm" variant="outline" onClick={refresh}>{t('重新加载')}</Button></div>}
    {(data?.productionFollowUps?.length ?? 0) > 0 && <details className="mt-4 rounded-lg border border-amber-200 bg-amber-50/50 p-3"><summary className="cursor-pointer text-sm font-medium text-amber-900">{t('报工不良待登记（跨月）')} · {data!.productionFollowUps!.length} {t('条')}</summary><p className="mt-2 text-sm text-slate-600">{t('仅显示尚未关联不良记录的差额；登记后继续跟踪处置和复验，不重复累计已登记数量。')}</p><ul className="mt-3 divide-y divide-amber-200/60">{data!.productionFollowUps!.map(record => <li key={record.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"><div><p>{record.reportDate} · {record.shift} · {record.treeNodeName} / {record.lineName}</p><p className="mt-1 font-medium tabular-nums text-amber-900">{t('待登记不良')} {quantity(record.unregisteredDefectiveQty)} {record.unit}</p></div>{record.unregisteredInspectedQty < record.unregisteredDefectiveQty ? <div className="text-sm"><p className="text-amber-900">{t('剩余可登记检验数量不足以登记剩余不良，请核对原报工与不良数量。')}</p>{treeNodeId && canProduction && <Button className="mt-2" variant="outline" size="sm" onClick={() => setEditor({ kind: 'production', record })}>{t('核对原报工')}</Button>}</div> : treeNodeId && canQuality && <Button variant="outline" size="sm" onClick={() => setEditor({ kind: 'quality', sourceReport: record })}>{t('登记这笔不良')}</Button>}</li>)}</ul></details>}
    {loading && !data ? <div role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500"><Loader2 className="size-4 animate-spin" aria-hidden="true" />{t('正在加载生产与质量数据')}</div> : data && (tab === 'production' ? <>
      {data.productionSummary.map((summary) => <div key={summary.unit} className="mt-4 hidden sm:block rounded-xl border border-slate-200 p-3"><p className="mb-2 text-xs font-semibold text-slate-600">{t('数量单位')}：{summary.unit} · {summary.reports} {t('条报工')}</p><div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6"><Stat label={t('计划 / 工序报工量')} value={`${quantity(summary.plannedQty)} / ${quantity(summary.actualQty)}`} /><Stat label={t('良品 / 不良')} value={`${quantity(summary.goodQty)} / ${quantity(summary.defectiveQty)}`} /><Stat label={t('计划达成率')} value={percent(summary.attainmentRate)} /><Stat label={t('良品率')} value={percent(summary.yieldRate)} /><Stat label={t('记录产能')} value={summary.capacityQty === null ? t('未完整记录（{count}/{total}）', { count: summary.capacityRecorded, total: summary.reports }) : quantity(summary.capacityQty)} /><Stat label={t('产能利用率')} value={percent(summary.capacityUtilization)} /></div></div>)}
      {data.productionSummary.map(summary => <div key={summary.unit} className="mt-4 sm:hidden"><div className="grid grid-cols-2 gap-2"><Stat label={t('工序报工量')} value={quantity(summary.actualQty) + ' ' + summary.unit} /><Stat label={t('报工不良')} value={quantity(summary.defectiveQty) + ' ' + summary.unit} /></div><details className="mt-2 rounded-lg border p-3"><summary className="cursor-pointer text-sm text-slate-600">{t('产能与统计口径')} · {summary.reports} {t('条报工')}</summary><div className="mt-3 grid grid-cols-2 gap-2"><Stat label={t('计划 / 实际')} value={quantity(summary.plannedQty) + ' / ' + quantity(summary.actualQty)} /><Stat label={t('良品率')} value={percent(summary.yieldRate)} /><Stat label={t('计划达成率')} value={percent(summary.attainmentRate)} /><Stat label={t('产能利用率')} value={percent(summary.capacityUtilization)} /></div><p className="mt-3 text-xs leading-5 text-slate-500">{t('按工序和单位汇总，不代表成品产量。产能未完整记录时不计算利用率。')}</p></details></div>)}
      <p className="mt-3 hidden text-sm leading-5 text-slate-500 sm:block">{t('以上为工序报工量，同一产品经过不同工序可分别报工，不代表成品产量。不良数量 = 实际产量 − 良品数量；产能未完整记录时不计算利用率，不同单位分别统计。')}</p>
      {data.productionReports.length > 0 && <div className="mt-3 space-y-3 lg:hidden">{data.productionReports.map(record => <article key={record.id} className="rounded-lg border p-3 text-sm"><div className="flex items-start justify-between gap-2"><div><p className="font-medium">{record.lineName}</p><p className="mt-1 text-muted-foreground">{record.reportDate} · {record.shift}</p></div>{treeNodeId && canProduction && <Button type="button" size="sm" variant="outline" aria-label={t('编辑 {date} {shift} 报工', { date: record.reportDate, shift: record.shift })} onClick={() => setEditor({ kind: 'production', record })}>{t('编辑')}</Button>}</div><dl className="mt-3 grid grid-cols-2 gap-3 tabular-nums"><div><dt className="text-muted-foreground">{t('工序报工量')}</dt><dd className="mt-1 font-medium">{quantity(record.actualQty)} {record.unit}</dd></div><div><dt className="text-muted-foreground">{t('良品 / 不良')}</dt><dd className="mt-1">{quantity(record.goodQty)} / {quantity(record.defectiveQty)} {record.unit}</dd></div><div><dt className="text-muted-foreground">{t('本班产能')}</dt><dd className="mt-1">{record.capacityQty === null ? t('未记录') : quantity(record.capacityQty) + ' ' + record.unit}</dd></div><div><dt className="text-muted-foreground">{t('投入工时')}</dt><dd className="mt-1">{quantity(record.workHours)} {t('人时')}</dd></div></dl><p className="mt-3 text-xs text-muted-foreground">{record.treeNodeName} · {record.stockPlanCode || t('未关联备货计划')} · {record.createdByName || '—'}</p>{record.note && <p className="mt-2 whitespace-pre-wrap break-words text-muted-foreground">{record.note}</p>}</article>)}</div>}
      {data.productionReports.length === 0 ? <Empty text={t('本月暂无生产报工记录')} /> : <div className="mt-3 hidden overflow-x-auto lg:block"><table className="w-full min-w-[860px] text-left text-sm"><caption className="sr-only">{t('生产报工记录')}</caption><thead className="bg-slate-50 text-slate-500"><tr>{['日期 / 班次', '子系统 / 工序', '备货计划', '计划', '实际', '良品 / 不良', '产能 / 工时', '记录人', '操作'].map((label) => <th key={label} scope="col" className="px-3 py-2 font-medium">{t(label)}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{data.productionReports.map((record) => <tr key={record.id}><td className="px-3 py-3 tabular-nums">{record.reportDate}<p className="mt-1 text-slate-500">{record.shift}</p></td><td className="px-3 py-3">{record.treeNodeName}<p className="mt-1 text-slate-500">{record.lineName}</p>{record.note && <p className="mt-1 max-w-56 whitespace-pre-wrap text-slate-500">{record.note}</p>}</td><td className="px-3 py-3">{record.stockPlanCode || '—'}</td><td className="px-3 py-3 tabular-nums">{quantity(record.plannedQty)} {record.unit}</td><td className="px-3 py-3 tabular-nums">{quantity(record.actualQty)} {record.unit}</td><td className="px-3 py-3 tabular-nums">{quantity(record.goodQty)} / <span className={record.defectiveQty > 0 ? 'font-semibold text-rose-600' : ''}>{quantity(record.defectiveQty)}</span></td><td className="px-3 py-3 tabular-nums">{record.capacityQty === null ? t('未记录') : `${quantity(record.capacityQty)} ${record.unit}`}<p className="mt-1 text-slate-500">{quantity(record.workHours)} {t('人时')}</p></td><td className="px-3 py-3">{record.createdByName || '—'}{record.updatedByName && <p className="mt-1 text-slate-500">{t('更新')}：{record.updatedByName}</p>}</td><td className="px-3 py-3">{treeNodeId && canProduction && <Button type="button" size="sm" variant="ghost" aria-label={t('编辑 {date} {shift} 报工', { date: record.reportDate, shift: record.shift })} onClick={() => setEditor({ kind: 'production', record })}><Pencil aria-hidden="true" className="size-3.5" /><span>{t('编辑')}</span></Button>}</td></tr>)}</tbody></table></div>}
    </> : <div className="mt-4"><QualityRecordsPanel key={`${scopeKey}:${qualityView}:${qualityView === 'month' ? month : ''}`} records={data.qualityRecords} onSaved={refresh} /></div>)}
    {verification && <QualityVerificationDialog key={verification.id} record={verification} canVerify={canVerify} onClose={() => setVerification(null)} onSaved={() => { setVerification(null); refresh(); }} />}
    {editor && treeNodeId && <OperationsEditor key={`${scopeKey}:${editor.kind}:${editor.record?.id || (editor.kind === 'quality' && editor.sourceReport?.id) || 'new'}`} scope={{ productId, treeNodeId, stockPlanId }} editor={editor} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); refresh(); }} />}
  </section>;
}

function Empty({ text }: { text: string }) { return <div className="py-10 text-center text-sm text-slate-500"><ClipboardCheck aria-hidden="true" className="mx-auto mb-2 size-7 text-muted-foreground" />{text}</div>; }

function OperationsEditor({ scope, editor, onClose, onSaved }: { scope: OperationsScope & { treeNodeId: string }; editor: EditorState; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const production = editor.kind === 'production';
  const report = editor.kind === 'production' ? editor.record : undefined;
  const quality = editor.kind === 'quality' ? editor.record : undefined;
  const sourceReport = editor.kind === 'quality' ? editor.sourceReport : undefined;
  const [form, setForm] = useState(() => ({
    stockPlanId: editor.record?.stockPlanId ?? sourceReport?.stockPlanId ?? scope.stockPlanId ?? '', unit: editor.record?.unit ?? sourceReport?.unit ?? '套',
    reportDate: report?.reportDate ?? today(), shift: report?.shift ?? '', lineName: report?.lineName ?? '',
    plannedQty: report ? String(report.plannedQty) : '', actualQty: report ? String(report.actualQty) : '', goodQty: report ? String(report.goodQty) : '', workHours: report ? String(report.workHours) : '', capacityQty: report?.capacityQty == null ? '' : String(report.capacityQty), note: report?.note ?? '',
    source: quality?.source ?? (sourceReport ? 'production' : 'procurement') as QualitySource, batchNo: quality?.batchNo ?? '', inspectionDate: quality?.inspectionDate ?? today(), inspectedQty: quality ? String(quality.inspectedQty) : sourceReport ? String(sourceReport.unregisteredInspectedQty) : '', defectiveQty: quality ? String(quality.defectiveQty) : sourceReport ? String(sourceReport.unregisteredDefectiveQty) : '', issue: quality?.issue ?? '', disposition: quality?.disposition ?? 'pending' as QualityDisposition, status: quality?.status ?? 'open' as QualityStatus, resolution: quality?.resolution ?? '',
    taskId: quality?.taskId ?? '', materialId: quality?.materialId ?? '', supplierId: quality?.supplierId ?? '', productionReportId: quality?.productionReportId ?? sourceReport?.id ?? '',
  }));
  const baseline = useRef(JSON.stringify(form));
  const requestId = useRef<string | null>(null);
  const [discard, setDiscard] = useState(false);
  const set = <K extends keyof typeof form>(key: K, value: typeof form[K]) => setForm((current) => ({ ...current, [key]: value }));
  const [options, setOptions] = useState<OperationsOptions | null>(null);
  const [optionsError, setOptionsError] = useState('');
  const [optionsVersion, setOptionsVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const requestClose = () => { if (busy.current) return; if (JSON.stringify(form) !== baseline.current) setDiscard(true); else onClose(); };
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    setOptions(null); setOptionsError('');
    void getProcurementOperationsOptions(scope, controller.signal).then((next) => {
      if (controller.signal.aborted) return;
      setOptions(next);
      if (!editor.record) {
        const selected = next.plans.find((plan) => plan.id === (sourceReport?.stockPlanId ?? scope.stockPlanId));
        const material = next.materials.length === 1 ? next.materials[0] : null;
        const previous = baseline.current;
        const initial = JSON.parse(previous) as typeof form;
        const initialized = { ...initial, unit: sourceReport?.unit || selected?.unit || material?.unit || initial.unit, materialId: selected?.materialId || material?.id || '' };
        baseline.current = JSON.stringify(initialized);
        setForm(current => JSON.stringify(current) === previous ? initialized : current);
      }
    }).catch((cause: unknown) => { if (!controller.signal.aborted) setOptionsError(cause instanceof Error ? cause.message : t('关联信息加载失败')); });
    return () => controller.abort();
  }, [scope.productId, scope.treeNodeId, scope.stockPlanId, optionsVersion, editor.record, sourceReport, t]);
  const changePlan = (id: string) => {
    const plan = options?.plans.find((row) => row.id === id);
    setForm((current) => ({ ...current, stockPlanId: id, unit: plan?.unit || current.unit, materialId: plan?.materialId || '', taskId: '', productionReportId: '' }));
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy.current || !options) return;
    busy.current = true; setSaving(true); setError('');
    try {
      const common = { productId: scope.productId, treeNodeId: scope.treeNodeId, stockPlanId: form.stockPlanId || null, unit: form.unit.trim(), ...(editor.record ? { baseUpdatedAt: editor.record.updatedAt } : {}) };
      if (production) {
        if (Number(form.goodQty) > Number(form.actualQty)) throw new Error(t('良品数量不能超过实际产量'));
        if (!report && !requestId.current) requestId.current = crypto.randomUUID();
        await saveProductionReport(report?.id ?? null, { ...common, ...(!report ? { requestId: requestId.current! } : {}), reportDate: form.reportDate, shift: form.shift.trim(), lineName: form.lineName.trim(), plannedQty: Number(form.plannedQty), actualQty: Number(form.actualQty), goodQty: Number(form.goodQty), workHours: Number(form.workHours), capacityQty: form.capacityQty === '' ? null : Number(form.capacityQty), note: form.note.trim() || null });
      } else {
        if (Number(form.defectiveQty) > Number(form.inspectedQty)) throw new Error(t('不良数量不能超过检验数量'));
        if (form.status === 'closed') throw new Error(t('关闭前必须通过独立复验，请使用验证入口'));
        await saveQualityRecord(quality?.id ?? null, { ...common, source: form.source, batchNo: form.batchNo.trim(), inspectionDate: form.inspectionDate, inspectedQty: Number(form.inspectedQty), defectiveQty: Number(form.defectiveQty), issue: form.issue.trim(), disposition: form.disposition, status: form.status, resolution: form.resolution.trim() || null, taskId: form.taskId || null, materialId: form.materialId || null, supplierId: form.supplierId || null, productionReportId: form.productionReportId || null });
      }
      if (alive.current) { toast.success(t(production ? '生产报工已保存' : '不良记录已保存')); onSaved(); }
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : t('保存失败，请重试')); }
    finally { busy.current = false; if (alive.current) setSaving(false); }
  };
  const numberField = (key: 'plannedQty' | 'actualQty' | 'goodQty' | 'workHours' | 'capacityQty' | 'inspectedQty' | 'defectiveQty', label: string, optional = false) => <Field label={t(label)} required={!optional}><Input type="number" min={key === 'inspectedQty' || key === 'defectiveQty' ? '0.001' : '0'} step={key === 'workHours' ? '0.01' : '0.001'} max={key === 'workHours' ? '99999999.99' : '99999999999.999'} required={!optional} value={form[key]} onChange={(event) => set(key, event.target.value)} placeholder={optional ? t('留空表示未记录') : undefined} /></Field>;
  return <><Dialog open onOpenChange={(open) => { if (!open) requestClose(); }}><DialogContent closeDisabled={saving} className="horizon-portal flex! max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl" onEscapeKeyDown={(event) => { if (busy.current) event.preventDefault(); }} onInteractOutside={(event) => { if (busy.current) event.preventDefault(); }}>
    <DialogHeader className="border-b px-4 py-4 pr-12 text-left sm:px-6 sm:pr-12"><DialogTitle>{t(production ? report ? '编辑生产报工' : '登记生产报工' : quality ? '处理不良记录' : '登记不良')}</DialogTitle><DialogDescription>{t(production ? '记录当前子系统的实际产量和本班产能，数量口径保持一致。' : '记录采购或生产不良，关联业务批次并跟踪处置结果。')}</DialogDescription></DialogHeader>
    {!options ? optionsError ? <div role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{optionsError}<Button type="button" variant="outline" className="mt-2 block" size="sm" onClick={() => setOptionsVersion((value) => value + 1)}>{t('重试加载关联信息')}</Button></div> : <div role="status" className="py-5 text-center text-sm text-slate-500">{t('正在加载关联信息')}</div> : <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6"><fieldset disabled={saving} className="space-y-4">
        {sourceReport && <p className="rounded-lg bg-muted/50 p-3 text-sm">{sourceReport.reportDate} · {sourceReport.shift} · {sourceReport.lineName}。{t("已带入尚未登记的数量，请核对实际检验数量，并补充批次与不良现象。")}</p>}
        <div className="grid gap-3 sm:grid-cols-2"><Field label={t('关联备货计划')}><NativeSelect className={selectClass} value={form.stockPlanId} disabled={Boolean(scope.stockPlanId || sourceReport)} onChange={(event) => changePlan(event.target.value)}><option value="">{t('不关联')}</option>{options.plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.code}</option>)}</NativeSelect></Field><Field label={t('数量单位')} required><Input required disabled={Boolean(sourceReport)} maxLength={24} value={form.unit} onChange={(event) => set('unit', event.target.value)} /></Field></div>
        {production ? <>
          <div className="grid gap-3 sm:grid-cols-3"><Field label={t('报工日期')} required><Input type="date" required value={form.reportDate} onChange={(event) => set('reportDate', event.target.value)} /></Field><Field label={t('班次')} required><Input required maxLength={80} value={form.shift} onChange={(event) => set('shift', event.target.value)} placeholder={t('例如：白班')} /></Field><Field label={t('产线或工序')} required><Input required maxLength={120} value={form.lineName} onChange={(event) => set('lineName', event.target.value)} /></Field></div>
          <div className="grid gap-3 sm:grid-cols-3">{numberField('plannedQty', '计划产量')}{numberField('actualQty', '实际产量')}{numberField('goodQty', '良品数量')}{numberField('workHours', '投入工时（人时）')}{numberField('capacityQty', '本班产能（选填）', true)}<Stat label={t('报工不良数量')} value={form.actualQty && form.goodQty && Number(form.actualQty) >= Number(form.goodQty) ? quantity(Number(form.actualQty) - Number(form.goodQty)) : '—'} /></div>
          <p className="text-xs leading-5 text-slate-500">{t('产能指本条报工对应班次和工序的可生产数量，不由任务数或库存推算。')}</p><Field label={t('备注')}><Textarea rows={3} maxLength={4000} value={form.note} onChange={(event) => set('note', event.target.value)} /></Field>
        </> : <>
          <div className="grid gap-3 sm:grid-cols-3"><Field label={t('不良来源')} required><NativeSelect className={selectClass} value={form.source} disabled={Boolean(sourceReport)} onChange={(event) => setForm((current) => ({ ...current, source: event.target.value as QualitySource, productionReportId: '' }))}>{Object.entries(sourceLabels).map(([key, label]) => <option key={key} value={key}>{t(label)}</option>)}</NativeSelect></Field><Field label={t('批次编号')} required><Input required maxLength={120} value={form.batchNo} onChange={(event) => set('batchNo', event.target.value)} /></Field><Field label={t('检验日期')} required><Input type="date" required value={form.inspectionDate} onChange={(event) => set('inspectionDate', event.target.value)} /></Field></div>
          {form.source === 'production' && <Field label={t('关联生产报工')}><NativeSelect className={selectClass} value={form.productionReportId} disabled={Boolean(sourceReport)} onChange={(event) => { const item = options.productionReports.find((row) => row.id === event.target.value); setForm((current) => ({ ...current, productionReportId: event.target.value, ...(item ? { stockPlanId: item.stockPlanId || '', unit: item.unit } : {}) })); }}><option value="">{t('不关联')}</option>{options.productionReports.filter((row) => !form.stockPlanId || row.stockPlanId === form.stockPlanId).map((row) => <option key={row.id} value={row.id}>{row.reportDate} · {row.shift} · {row.lineName} · {t('报工不良')} {quantity(row.defectiveQty)} {row.unit}</option>)}</NativeSelect></Field>}
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t('关联采购任务')}><NativeSelect className={selectClass} value={form.taskId} disabled={Boolean(sourceReport)} onChange={(event) => {
              const task = options.tasks.find((row) => row.id === event.target.value);
              setForm((current) => ({ ...current, taskId: event.target.value, ...(task ? { unit: task.unit, materialId: task.materialId || '', stockPlanId: task.stockPlanId || current.stockPlanId, productionReportId: task.stockPlanId && task.stockPlanId !== current.stockPlanId ? '' : current.productionReportId } : {}) }));
            }}><option value="">{t('不关联')}</option>{options.tasks.filter((task) => !form.stockPlanId || !task.stockPlanId || task.stockPlanId === form.stockPlanId).map((task) => <option key={task.id} value={task.id}>{task.code}</option>)}</NativeSelect></Field>
            <Field label={t('关联物料')}><NativeSelect className={selectClass} value={form.materialId} onChange={(event) => { const material = options.materials.find((row) => row.id === event.target.value); setForm((current) => ({ ...current, materialId: event.target.value, ...(material?.unit && !sourceReport ? { unit: material.unit } : {}) })); }}><option value="">{t('不关联')}</option>{options.materials.map((material) => <option key={material.id} value={material.id}>{material.name}</option>)}</NativeSelect></Field>
            <Field label={t('供应商')}><NativeSelect className={selectClass} value={form.supplierId} onChange={(event) => set('supplierId', event.target.value)}><option value="">{t('不关联')}</option>{options.suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</NativeSelect></Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">{numberField('inspectedQty', '检验数量')}{numberField('defectiveQty', '不良数量')}</div>
          <Field label={t('不良现象')} required><Textarea required rows={3} maxLength={4000} value={form.issue} onChange={(event) => set('issue', event.target.value)} /></Field>
          <div className="grid gap-3 sm:grid-cols-2"><Field label={t('处置方式')} required><NativeSelect className={selectClass} value={form.disposition} onChange={(event) => set('disposition', event.target.value as QualityDisposition)}>{Object.entries(dispositionLabels).map(([key, label]) => <option key={key} value={key}>{t(label)}</option>)}</NativeSelect></Field><Field label={t('处理状态')} required><NativeSelect className={selectClass} value={form.status} onChange={(event) => set('status', event.target.value as QualityStatus)}>{Object.entries(statusLabels).filter(([key]) => key !== 'closed').map(([key, label]) => <option key={key} value={key}>{t(label)}</option>)}</NativeSelect></Field></div>
          <Field label={t('处理结果')} required={form.status === 'closed'}><Textarea required={form.status === 'closed'} rows={3} maxLength={4000} value={form.resolution} onChange={(event) => set('resolution', event.target.value)} placeholder={t('记录处置完成情况，保存后交由验证人复验')} /></Field>
        </>}
        {error && <p role="alert" className="flex gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"><AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />{error}</p>}
      </fieldset></div><DialogFooter className="border-t px-4 py-3 sm:px-6"><Button type="button" variant="outline" disabled={saving} onClick={requestClose}>{t('取消')}</Button><Button type="submit" disabled={saving} className="bg-primary hover:bg-primary-hover">{saving && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}{t(saving ? '保存中…' : '保存')}</Button></DialogFooter>
    </form>}
  </DialogContent></Dialog><AlertDialog open={discard} onOpenChange={setDiscard}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t('放弃未保存的内容？')}</AlertDialogTitle><AlertDialogDescription>{t('填写内容尚未保存，关闭后将丢失。')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t('继续填写')}</AlertDialogCancel><AlertDialogAction onClick={onClose}>{t('放弃并关闭')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></>;
}
