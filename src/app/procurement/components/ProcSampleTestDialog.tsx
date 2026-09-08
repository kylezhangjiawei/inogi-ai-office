import { useEffect, useRef, useState, type FormEvent } from "react";
import { AlertCircle, CheckCircle2, Loader2, Paperclip } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Textarea } from "../../components/ui/textarea";
import { i18nLocale, useI18n } from "../../lib/i18n";
import { confirmProcSampleTest, getProcSampleTest, type ProcSampleTestDetail, type ProcSampleTestResult } from "../../lib/procurementApi";

export const SAMPLE_TEST_RESULT_LABELS: Record<ProcSampleTestResult, string> = {
  passed: "测试通过",
  failed_resample: "不通过，改图重新出样",
  failed_requote: "不通过，换供应商询价",
};

export function ProcSampleTestDialog({ taskId, onClose, onConfirmed }: {
  taskId: string;
  onClose: () => void;
  onConfirmed?: () => void;
}) {
  const { t } = useI18n();
  const [detail, setDetail] = useState<ProcSampleTestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<ProcSampleTestResult | "">("");
  const [note, setNote] = useState("");
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const requestRef = useRef(0);
  const activeTaskRef = useRef<string | null>(taskId);
  useEffect(() => {
    activeTaskRef.current = taskId;
    busyRef.current = false;
    setBusy(false);
    return () => { activeTaskRef.current = null; requestRef.current += 1; };
  }, [taskId]);
  useEffect(() => {
    const controller = new AbortController();
    setDetail(null);
    setLoading(true);
    setLoadError("");
    setError("");
    setResult("");
    setNote("");
    void getProcSampleTest(taskId, controller.signal).then((next) => {
      if (!controller.signal.aborted) setDetail(next);
    }).catch((cause) => {
      if (!controller.signal.aborted) setLoadError(cause instanceof Error ? cause.message : t("测试任务加载失败"));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [taskId, retry, t]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busyRef.current || !detail?.canConfirm || !detail.sampleTest) return;
    if (!result || !note.trim()) { setError(t("请选择测试结果并填写测试结论")); return; }
    busyRef.current = true;
    const requestId = ++requestRef.current;
    setBusy(true);
    setError("");
    try {
      const updated = await confirmProcSampleTest(taskId, { roundId: detail.sampleTest.roundId, result, note: note.trim() });
      if (activeTaskRef.current === taskId && requestRef.current === requestId) { setDetail(updated); onConfirmed?.(); }
    } catch (cause) {
      if (activeTaskRef.current === taskId && requestRef.current === requestId) setError(cause instanceof Error ? cause.message : t("测试结论确认失败"));
    } finally {
      if (activeTaskRef.current === taskId && requestRef.current === requestId) { busyRef.current = false; setBusy(false); }
    }
  };
  const assignment = detail?.sampleTest;
  return <Dialog open onOpenChange={(open) => { if (!open && !busyRef.current) onClose(); }}>
    <DialogContent className="horizon-theme horizon-portal proc-horizon-overlay flex max-h-[90dvh] flex-col overflow-y-auto sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>{t("样品测试确认")}</DialogTitle>
        <DialogDescription>{detail ? `${detail.task.code} · ${detail.task.materialName}` : t("查看分派给你的样品测试任务")}</DialogDescription>
      </DialogHeader>
      {loading && <p className="flex items-center gap-2 py-6 text-sm text-slate-500"><Loader2 className="size-4 animate-spin" />{t("正在加载测试任务…")}</p>}
      {loadError && <div role="alert" className="space-y-3 py-4 text-sm text-rose-700"><p>{loadError}</p><Button type="button" variant="outline" onClick={() => setRetry((value) => value + 1)}>{t("重新加载")}</Button></div>}
      {detail && <form onSubmit={(event) => { void submit(event); }} className="space-y-4">
        <dl className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 text-sm">
          <div><dt className="text-xs text-slate-500">{t("研发测试人员")}</dt><dd className="mt-1">{assignment?.testerName || t("尚未指定")}</dd></div>
          <div><dt className="text-xs text-slate-500">{t("采购负责人")}</dt><dd className="mt-1">{detail.task.buyer || t("尚未指定")}</dd></div>
          <div><dt className="text-xs text-slate-500">{t("规格")}</dt><dd className="mt-1 break-words">{detail.task.spec || "—"}</dd></div>
          <div><dt className="text-xs text-slate-500">{t("任务需求数量")}</dt><dd className="mt-1">{detail.task.quantity} {detail.task.unit}</dd></div>
        </dl>
        {detail.task.rdTaskTitle && <p className="text-sm text-slate-600">{t("来源研发任务")}：{detail.task.rdTaskTitle}</p>}
        {detail.task.attachmentList.length > 0 && <div className="space-y-1">
          <p className="text-xs font-medium text-slate-500">{t("任务附件")}</p>
          {detail.task.attachmentList.map((attachment) => <a key={attachment.id} href={attachment.fileUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 break-all text-sm text-[#002fa7]"><Paperclip className="size-3.5 shrink-0" />{attachment.fileName}</a>)}
        </div>}
        {assignment?.result ? <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold"><CheckCircle2 className="size-4 text-emerald-600" />{t(SAMPLE_TEST_RESULT_LABELS[assignment.result])}</p>
          <p className="whitespace-pre-wrap break-words text-sm text-slate-700">{assignment.note}</p>
          <p className="text-xs text-slate-500">{assignment.confirmedByName}{assignment.confirmedAt && ` · ${new Date(assignment.confirmedAt).toLocaleString(i18nLocale())}`}</p>
          <p className="text-xs text-slate-600">{t("测试结论已确认，已通知采购负责人。")}</p>
        </div> : detail.canConfirm ? <>
          <div><label htmlFor="sample-test-result" className="mb-1.5 block text-sm font-medium">{t("测试结果")}</label>
            <select id="sample-test-result" value={result} onChange={(event) => setResult(event.target.value as ProcSampleTestResult | "")} disabled={busy} className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm">
              <option value="">{t("请选择测试结果")}</option>
              {Object.entries(SAMPLE_TEST_RESULT_LABELS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
            </select>
          </div>
          <div><label htmlFor="sample-test-conclusion" className="mb-1.5 block text-sm font-medium">{t("测试结论（必填）")}</label><Textarea id="sample-test-conclusion" value={note} onChange={(event) => setNote(event.target.value)} disabled={busy} maxLength={500} rows={4} placeholder={t("请填写测试内容、结果及需要跟进的问题")} /></div>
          <p className="text-xs leading-5 text-slate-500">{t("请确认测试已完成。提交后将保存本人确认记录、通知采购负责人，并按测试结果推进流程。")}</p>
        </> : <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{t("当前任务无法确认测试：请检查测试人员、任务状态及本轮分派信息。")}</p>}
        {error && <p role="alert" className="flex items-start gap-2 text-sm text-rose-700"><AlertCircle className="mt-0.5 size-4 shrink-0" />{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>{t("关闭")}</Button>
          {detail.canConfirm && <Button type="submit" disabled={busy || !result || !note.trim()}>{busy && <Loader2 className="size-4 animate-spin" />}{t(busy ? "正在确认…" : "确认测试结论并通知供应链")}</Button>}
        </DialogFooter>
      </form>}
    </DialogContent>
  </Dialog>;
}
