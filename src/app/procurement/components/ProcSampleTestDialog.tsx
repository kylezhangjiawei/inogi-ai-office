import { useEffect, useRef, useState, type FormEvent } from "react";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { useAuth } from "../../auth";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { getProcSampleFacts } from "../../lib/procSampleFacts";
import { SampleTechnicalFiles } from "./SampleTechnicalFiles";
import { RdDeliverySnapshotPanel } from "./RdDeliverySnapshotPanel";
import { SampleValidationPanel } from "../samples/SampleValidationPanel";
import { sampleValidationIssues } from "../samples/sampleValidationModel";
import type { ProcSampleValidation } from "../../lib/procurementApi";
import { SampleTimingSummary } from "../samples/SampleTimingSummary";
import { SampleRecordsPanel } from "../samples/SampleRecordsPanel";
import { SampleRoundHistory } from "../samples/SampleRoundHistory";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../../components/ui/alert-dialog";
import { sampleOperationTime } from "../samples/sampleTimingModel";
import "../sampleWorkspace.css";
import { Textarea } from "../../components/ui/textarea";
import { i18nLocale, useI18n } from "../../lib/i18n";
import { addProcSampleEvidence, uploadProcurementAttachment, confirmProcSampleTest, getProcSampleTest, type ProcSampleTestDetail, type ProcSampleTestResult } from "../../lib/procurementApi";
import { NativeSelect } from "../../components/ui/native-select";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs";

export const SAMPLE_TEST_RESULT_LABELS: Record<ProcSampleTestResult, string> = {
  passed: "测试通过",
  failed_resample: "不通过，改图重新出样",
  failed_requote: "不通过，换供应商询价",
};

export function ProcSampleTestDialog({ taskId, onClose, onConfirmed, onRecordsSaved, inline = false, revision, onInteractionStateChange }: {
  taskId: string;
  onClose: () => void;
  onConfirmed?: () => void;
  onRecordsSaved?: () => void;
  inline?: boolean;
  revision?: string;
  onInteractionStateChange?: (state: { dirty: boolean; busy: boolean }) => void;
}) {
  const { t } = useI18n();
  const { user } = useAuth();
  const identity = JSON.stringify([user?.id, [...(user?.permissions ?? [])].sort()]);
  const scope = JSON.stringify([taskId, identity]);
  const activeScopeRef = useRef(scope);
  activeScopeRef.current = scope;
  const [storedDetail, setStoredDetail] = useState<ProcSampleTestDetail | null>(null);
  const [detailIdentity, setDetailIdentity] = useState(identity);
  const detail = detailIdentity === identity ? storedDetail : null;
  const setDetail = (next: ProcSampleTestDetail | null) => { setStoredDetail(next); setDetailIdentity(identity); };
  const [recordsInteraction, setRecordsInteraction] = useState({ dirty: false, busy: false });
  const [reviewView, setReviewView] = useState("review");
  const [discardOpen, setDiscardOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<ProcSampleTestResult | "">("");
  const [note, setNote] = useState("");
  const [validation, setValidation] = useState<ProcSampleValidation | null>(null);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const requestRef = useRef(0);
  const readRequestRef = useRef(0);
  const detailRef = useRef<ProcSampleTestDetail | null>(null);
  detailRef.current = detail;
  const activeTaskRef = useRef<string | null>(taskId);
  useEffect(() => {
    activeTaskRef.current = taskId;
    busyRef.current = false;
    setBusy(false);
    setReviewView("review");
    return () => { activeTaskRef.current = null; requestRef.current += 1; };
  }, [taskId, identity]);
  useEffect(() => {
    const controller = new AbortController();
    const readId = ++readRequestRef.current;
    const previous = detailRef.current;
    if (previous?.task.id !== taskId) {
      setDetail(null);
      setResult("");
      setNote("");
      setValidation(null);
    }
    setLoading(true);
    setLoadError("");
    setError("");
    void getProcSampleTest(taskId, controller.signal).then((next) => {
      if (controller.signal.aborted || readRequestRef.current !== readId || activeScopeRef.current !== scope) return;
      // A background refresh of this same assignment must not erase a typed conclusion.
      const sameRound = previous?.task.id === next.task.id
        && previous?.sampleTest?.roundId === next.sampleTest?.roundId
        && previous?.canConfirm && next.canConfirm;
      if (!sameRound) { setResult(""); setNote(""); setValidation(next.sampleTest?.validation ?? null); }
      setDetail(next);
    }).catch((cause) => {
      if (!controller.signal.aborted && readRequestRef.current === readId) setLoadError(cause instanceof Error ? cause.message : t("测试任务加载失败"));
    }).finally(() => { if (!controller.signal.aborted && readRequestRef.current === readId) setLoading(false); });
    return () => controller.abort();
  }, [taskId, retry, revision, t, identity]);
  useEffect(() => {
    onInteractionStateChange?.({ dirty: Boolean(detail?.canConfirm && (result || note || validation)) || recordsInteraction.dirty, busy: busy || recordsInteraction.busy });
    return () => onInteractionStateChange?.({ dirty: false, busy: false });
  }, [detail?.canConfirm, result, note, validation, busy, recordsInteraction, onInteractionStateChange]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busyRef.current || recordsInteraction.busy || recordsInteraction.dirty || loading || loadError || !detail?.canConfirm || !detail.sampleTest) return;
    if (detail.sampleTest.recordsVersion === 1 && !detail.sampleTest.finishedAt) { setError(t("请先保存实际到样、开测和结束时间")); return; }
    if (!result || !note.trim()) { setError(t("请选择测试结果并填写测试结论")); return; }
    const issues = sampleValidationIssues(validation, detail.validationReferences ?? []);
    if (!validation || (result === "passed" && issues.length)) { setError(t(issues[0] || "请填写验证类型与依据")); setReviewView("validation"); return; }
    busyRef.current = true;
    const requestId = ++requestRef.current;
    setBusy(true);
    setError("");
    try {
      const updated = await confirmProcSampleTest(taskId, { roundId: detail.sampleTest.roundId, result, note: note.trim(), validation });
      if (activeTaskRef.current === taskId && activeScopeRef.current === scope && requestRef.current === requestId) {
        // A read started before this confirmation cannot restore the unconfirmed form.
        readRequestRef.current += 1;
        setLoading(false);
        setLoadError("");
        setResult("");
        setNote("");
        setDetail(updated);
        setValidation(updated.sampleTest?.validation ?? null);
        onConfirmed?.();
      }
    } catch (cause) {
      if (activeTaskRef.current === taskId && activeScopeRef.current === scope && requestRef.current === requestId) setError(cause instanceof Error ? cause.message : t("测试结论确认失败"));
    } finally {
      if (activeTaskRef.current === taskId && activeScopeRef.current === scope && requestRef.current === requestId) { busyRef.current = false; setBusy(false); }
    }
  };
  const uploadEvidence = async (files: FileList | null) => {
    if (!files?.length || busyRef.current || recordsInteraction.busy || recordsInteraction.dirty || loading || loadError || !detail?.canConfirm || !detail.sampleTest) return;
    if (files.length > 10) { setError(t("每次请选择 1–10 份证据")); return; }
    busyRef.current = true; setBusy(true); setError("");
    const requestId = ++requestRef.current;
    try {
      const items = await Promise.all(Array.from(files).map(async (file) => {
        const uploaded = await uploadProcurementAttachment(file);
        if (!uploaded.signedUrl) throw new Error(t("附件上传成功，但无法生成访问地址"));
        return { fileId: uploaded.fileId };
      }));
      if (activeScopeRef.current !== scope || requestRef.current !== requestId) return;
      const updated = await addProcSampleEvidence(taskId, { roundId: detail.sampleTest.roundId, baseUpdatedAt: detail.task.updatedAt!, items });
      if (activeScopeRef.current !== scope || requestRef.current !== requestId) return;
      readRequestRef.current += 1; setDetail(updated); onRecordsSaved?.();
    } catch (cause) {
      if (activeScopeRef.current === scope && requestRef.current === requestId) setError(cause instanceof Error ? cause.message : t("证据上传失败"));
    } finally {
      if (activeScopeRef.current === scope && requestRef.current === requestId) { busyRef.current = false; setBusy(false); }
    }
  };
  const assignment = detail?.sampleTest;
  const facts = detail ? getProcSampleFacts({ ...detail.task, sampleTest: assignment }) : null;
  const inputsDisabled = busy || recordsInteraction.busy || loading || Boolean(loadError);
  const requestClose = () => {
    if (busyRef.current || recordsInteraction.busy) return;
    if (recordsInteraction.dirty || (detail?.canConfirm && (result || note || validation))) setDiscardOpen(true);
    else onClose();
  };
  const body = <>
    {loading && !detail && <div role="status" aria-label={t("正在加载测试任务…")} className="space-y-3 p-4">
      <div className="h-6 w-48 rounded bg-slate-100" />
      <div className="grid gap-4 sm:grid-cols-2"><div className="h-64 rounded-xl bg-slate-100" /><div className="h-64 rounded-xl bg-slate-100" /></div>
    </div>}
    {loadError && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"><p className="text-pretty">{loadError}</p><Button type="button" variant="outline" onClick={() => setRetry((value) => value + 1)}>{t("重新加载")}</Button></div>}
    {detail && <Tabs value={reviewView} onValueChange={setReviewView} className="proc-sample-detail-tabs">
      <TabsList aria-label={t("样品详情视图")} className="proc-sample-detail-tab-list">
        <TabsTrigger value="review" id={`sample-${taskId}-review-tab`} aria-controls={`sample-${taskId}-review-panel`}>{t("资料与验证")}</TabsTrigger>
        <TabsTrigger value="validation" id={`sample-${taskId}-validation-tab`} aria-controls={`sample-${taskId}-validation-panel`}>{t("验证依据")}</TabsTrigger>
        <TabsTrigger value="records" id={`sample-${taskId}-records-tab`} aria-controls={`sample-${taskId}-records-panel`}>{t("时间与采购登记")}{recordsInteraction.dirty && <span className="ml-1 size-1.5 rounded-full bg-amber-500" aria-label={t("有未保存修改")} />}</TabsTrigger>
        <TabsTrigger value="history" id={`sample-${taskId}-history-tab`} aria-controls={`sample-${taskId}-history-panel`}>{t("轮次与交付历史")}</TabsTrigger>
      </TabsList>
      <div role="tabpanel" id={`sample-${taskId}-review-panel`} aria-labelledby={`sample-${taskId}-review-tab`} hidden={reviewView !== "review"} className="proc-sample-detail-tab-panel">
      <div className="proc-sample-review-layout">
      <div className="min-w-0 space-y-3">
        <SampleTechnicalFiles task={detail.task} />
      </div>
      <form onSubmit={(event) => { void submit(event); }} className="proc-sample-conclusion space-y-4 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-balance text-sm font-semibold">{t("验证与结论")}</h3>
          {loading && <span className="text-xs text-muted-foreground" role="status">{t("正在刷新…")}</span>}
        </div>
        <p className={inline ? "sr-only" : "break-words text-pretty text-xs tabular-nums text-muted-foreground"}>{detail.task.code} · {detail.task.materialName}</p>
        <dl className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 text-sm">
          <div className="min-w-0"><dt className="text-xs text-slate-500">{t("研发测试人员")}</dt><dd className="mt-1 break-words">{assignment?.testerName || t("尚未指定")}</dd></div>
          <div className="min-w-0"><dt className="text-xs text-slate-500">{t("采购负责人")}</dt><dd className="mt-1 break-words">{detail.task.buyer || t("尚未指定")}</dd></div>
          {!inline && <><div className="col-span-2 min-w-0"><dt className="text-xs text-slate-500">{t("规格")}</dt><dd className="mt-1 break-words text-pretty">{detail.task.spec || t("规格待补齐")}</dd></div>
          <div className="col-span-2"><dt className="text-xs text-slate-500">{t("任务需求数量")}</dt><dd className="mt-1 tabular-nums">{detail.task.quantity} {detail.task.unit}</dd></div></>}
        </dl>
        <div className="space-y-1 border-b border-border pb-3">
          <p className="text-sm font-medium">{t(facts?.label || "到样状态待确认")}</p>
          <p className="text-pretty text-xs leading-5 text-muted-foreground">{t(facts?.description || "")}</p>
        </div>
        <div className="space-y-2 rounded-lg bg-muted/50 p-3"><p className="text-xs font-medium">{t(validation?.kind === "transfer" ? "转产验证" : validation?.kind === "exploration" ? "研发探索" : "尚未分类")}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => setReviewView("validation")}>{t(assignment?.result ? "查看验证依据" : "核对验证类型与依据")}</Button>
        </div>
        {detail.task.rdTaskTitle && <p className="break-words text-pretty text-xs text-slate-600">{t("来源研发任务")}：{detail.task.rdTaskTitle}</p>}
        {assignment?.result ? <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-medium text-muted-foreground">{t(facts?.state === "confirmed" ? "已确认测试结论" : "上次已确认结果")}</p>
          <p className="flex items-start gap-2 text-sm font-semibold">{assignment.result === "passed" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-600" />}{t(SAMPLE_TEST_RESULT_LABELS[assignment.result])}</p>
          <p className="whitespace-pre-wrap break-words text-pretty text-sm text-slate-700">{assignment.note}</p>
          <p className="text-xs tabular-nums text-slate-500">{assignment.confirmedByName}{assignment.confirmedAt && ` · ${sampleOperationTime(assignment.confirmedAt).value ? new Date(assignment.confirmedAt).toLocaleString(i18nLocale()) : t("时间待核对")}`}</p>
          <p className="text-pretty text-xs text-slate-600">{t("测试结论已确认，已通知采购负责人。")}</p>
        </div> : detail.canConfirm ? <>
          <div><label htmlFor="sample-test-result" className="mb-1.5 block text-sm font-medium">{t("测试结果")}</label>
            <NativeSelect id="sample-test-result" value={result} onChange={(event) => setResult(event.target.value as ProcSampleTestResult | "")} disabled={inputsDisabled} className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-base">
              <option value="">{t("请选择测试结果")}</option>
              {Object.entries(SAMPLE_TEST_RESULT_LABELS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
            </NativeSelect>
          </div>
          <div><label htmlFor="sample-test-conclusion" className="mb-1.5 block text-sm font-medium">{t("测试结论（必填）")}</label><Textarea id="sample-test-conclusion" value={note} onChange={(event) => setNote(event.target.value)} disabled={inputsDisabled} maxLength={500} rows={4} className="text-base" placeholder={t("请填写测试内容、结果及需要跟进的问题")} /></div>
          <p className="text-pretty text-xs leading-5 text-slate-500">{t("请确认测试已完成。提交后将保存本人确认记录、通知采购负责人，并按测试结果推进流程。")}</p>
          {assignment?.recordsVersion === 1 && !assignment.finishedAt && <div className="space-y-2"><p className="text-pretty text-xs leading-5 text-amber-700">{t("请先在本轮样品登记中保存实际到样、开测和结束时间，再提交结论。")}</p><Button type="button" variant="outline" size="sm" onClick={() => setReviewView("records")}>{t("登记测试时间")}</Button></div>}
          {recordsInteraction.dirty && <div className="space-y-2"><p className="text-pretty text-xs leading-5 text-amber-700">{t("请先保存或撤销未保存的登记修改，再提交结论。")}</p><Button type="button" variant="outline" size="sm" onClick={() => setReviewView("records")}>{t("继续登记")}</Button></div>}
        </> : <p className="rounded-lg bg-slate-50 p-3 text-pretty text-xs leading-5 text-slate-600">{t(detail.task.status === "testing" ? "等待指定研发人员本人确认测试结论。" : "当前阶段无需填写测试结论，请按采购流程继续处理。")}</p>}
        {error && <p role="alert" className="flex items-start gap-2 text-pretty text-sm text-rose-700"><AlertCircle className="mt-0.5 size-4 shrink-0" />{error}</p>}
        <DialogFooter className="flex-wrap gap-2">
          {!inline && <Button type="button" variant="outline" disabled={busy || recordsInteraction.busy} onClick={requestClose}>{t("关闭")}</Button>}
          {detail.canConfirm && <Button type="submit" disabled={inputsDisabled || recordsInteraction.dirty || (assignment?.recordsVersion === 1 && !assignment.finishedAt) || !result || !note.trim()} className="min-h-11 h-auto whitespace-normal text-sm">{busy && <Loader2 className="size-4 animate-spin" />}{t(busy ? "正在确认…" : "确认测试结论并通知供应链")}</Button>}
        </DialogFooter>
      </form>
    </div></div>
      <div role="tabpanel" id={`sample-${taskId}-validation-panel`} aria-labelledby={`sample-${taskId}-validation-tab`} hidden={reviewView !== "validation"} className="proc-sample-detail-tab-panel space-y-4">
        {detail.canConfirm && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
          <div><h3 className="text-sm font-semibold">{t("本轮试验记录与照片")}</h3><p className="mt-1 text-xs text-muted-foreground">{t("上传后在下方选择作为试装 / 小批验证依据。文件只作为证据，不自动成为受控版本。")}</p></div>
          <label className="relative inline-flex min-h-10 items-center rounded-lg border border-border px-3 text-sm focus-within:ring-2 focus-within:ring-ring">{t(busy ? "正在上传…" : "上传验证证据")}<Input type="file" multiple disabled={inputsDisabled || recordsInteraction.dirty} aria-label={t("上传验证证据")} className="absolute inset-0 w-full cursor-pointer opacity-0 disabled:cursor-not-allowed" onChange={(event) => { void uploadEvidence(event.target.files); event.target.value = ""; }} /></label>
        </div>}
        {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
        <SampleValidationPanel value={validation} references={detail.validationReferences ?? []} onChange={setValidation} disabled={inputsDisabled} readOnly={!detail.canConfirm} />
        <Button type="button" variant="outline" onClick={() => setReviewView("review")}>{t("返回填写结论")}</Button>
      </div>
      <div role="tabpanel" id={`sample-${taskId}-records-panel`} aria-labelledby={`sample-${taskId}-records-tab`} hidden={reviewView !== "records"} className="proc-sample-detail-tab-panel space-y-4">
        <SampleTimingSummary detail={detail} loading={loading} error={Boolean(loadError)} />
        <SampleRecordsPanel detail={detail} identity={identity} disabled={busy || loading || Boolean(loadError)} unavailable={loading || Boolean(loadError)} onInteractionStateChange={setRecordsInteraction} onReload={() => setRetry((value) => value + 1)}
          onSaved={(updated) => { readRequestRef.current += 1; setLoading(false); setLoadError(""); setDetail(updated); onRecordsSaved?.(); }} />
        <Button type="button" variant="outline" onClick={() => setReviewView("review")}>{t("返回资料与验证")}</Button>
      </div>
      <div role="tabpanel" id={`sample-${taskId}-history-panel`} aria-labelledby={`sample-${taskId}-history-tab`} hidden={reviewView !== "history"} className="proc-sample-detail-tab-panel space-y-4">
        <SampleRoundHistory detail={detail} unavailable={loading || Boolean(loadError)} />
        <section className="rounded-xl border border-border bg-card p-4"><h3 className="mb-3 text-sm font-semibold">{t("交付需求与历史版本")}</h3><RdDeliverySnapshotPanel task={detail.task} compact /></section>
      </div>
    </Tabs>}
  </>;
  if (inline) return <section className="proc-sample-review min-w-0" aria-label={t("样品资料与验证结论")}>{body}</section>;
  return <><Dialog open onOpenChange={(open) => { if (!open) requestClose(); }}>
    <DialogContent aria-modal="true" onEscapeKeyDown={(event) => { event.preventDefault(); if (!discardOpen) requestClose(); }} onPointerDownOutside={(event) => { event.preventDefault(); event.detail.originalEvent.preventDefault(); if (!discardOpen) requestClose(); }} className="horizon-theme horizon-portal proc-horizon-overlay proc-sample-dialog flex max-h-[90dvh] flex-col overflow-y-auto sm:max-w-6xl">
      <DialogHeader>
        <DialogTitle>{t("样品测试确认")}</DialogTitle>
        <DialogDescription>{detail ? `${detail.task.code} · ${detail.task.materialName}` : t("查看分派给你的样品测试任务")}</DialogDescription>
      </DialogHeader>
      <div className="proc-sample-review min-w-0">{body}</div>
    </DialogContent>
  </Dialog><AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}><AlertDialogContent aria-modal="true"><AlertDialogHeader><AlertDialogTitle>{t("放弃未保存的样品修改？")}</AlertDialogTitle><AlertDialogDescription>{t("已保存的登记和历史保留；本次未保存的时间、采购条件及结论将丢弃。")}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t("继续填写")}</AlertDialogCancel><AlertDialogAction onClick={() => { if (!busyRef.current && !recordsInteraction.busy) onClose(); }}>{t("放弃并关闭")}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></>;
}
