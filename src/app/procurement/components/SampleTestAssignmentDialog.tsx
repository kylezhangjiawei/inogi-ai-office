import { useEffect, useRef, useState, type FormEvent } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { useAuth } from "../../auth";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { useI18n } from "../../lib/i18n";
import { assignProcSampleTest, listProcSampleTesters, type ProcurementTask, type ProcSampleTester } from "../../lib/procurementApi";
import { sampleInputTimestamp, sampleLocalTime } from "../samples/sampleRecordsModel";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../../components/ui/alert-dialog";
import { Input } from "../../components/ui/input";
import { NativeSelect } from "../../components/ui/native-select";

export function SampleTestAssignmentDialog({ task, onClose, onAssigned }: {
  task: ProcurementTask;
  onClose: () => void;
  onAssigned: (task: ProcurementTask) => void;
}) {
  const { t } = useI18n();
  const { user } = useAuth();
  const scope = JSON.stringify([task.id, user?.id, [...(user?.permissions ?? [])].sort()]);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const latestTaskRef = useRef(task);
  latestTaskRef.current = task;
  const requestRef = useRef(0);
  const initialTester = task.sampleTest?.testerUserId || task.rdContactUserId || "";
  const initialArrival = task.status === "testing" ? sampleLocalTime(task.sampleTest?.arrivedAt) : "";
  const [testers, setTesters] = useState<ProcSampleTester[]>([]);
  const [testerId, setTesterId] = useState(task.sampleTest?.testerUserId || task.rdContactUserId || "");
  const [arrivedAt, setArrivedAt] = useState(task.status === "testing" ? sampleLocalTime(task.sampleTest?.arrivedAt) : "");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [baseVersion, setBaseVersion] = useState(task.updatedAt);
  const [baseStatus, setBaseStatus] = useState(task.status);
  const stale = baseVersion !== task.updatedAt || baseStatus !== task.status;
  const busyRef = useRef(false);
  const activeRef = useRef(true);
  useEffect(() => {
    activeRef.current = true; requestRef.current += 1; busyRef.current = false;
    setBusy(false); setTesterId(initialTester); setArrivedAt(initialArrival); setTouched(false); setError(""); setDiscardOpen(false); setBaseVersion(task.updatedAt); setBaseStatus(task.status);
    return () => { activeRef.current = false; requestRef.current += 1; };
  }, [scope]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError("");
    void listProcSampleTesters(controller.signal).then((rows) => {
      if (controller.signal.aborted) return;
      setTesters(rows);
      setTesterId((current) => rows.some((row) => row.id === current) ? current : "");
    }).catch((cause) => {
      if (!controller.signal.aborted) setLoadError(cause instanceof Error ? cause.message : t("研发人员加载失败"));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [retry, t, scope]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busyRef.current || scopeRef.current !== scope || loading || loadError || stale) return;
    if (!testers.some((tester) => tester.id === testerId)) { setError(t("请选择研发测试人员")); return; }
    if (task.status !== "pending_sample" && task.status !== "testing") { setError(t("任务状态已变化，请刷新后重试")); return; }
    const actualArrival = arrivedAt ? sampleInputTimestamp(arrivedAt) : undefined;
    if ((task.status === "pending_sample" && !actualArrival) || (arrivedAt && !actualArrival) || (actualArrival && Date.parse(actualArrival) > Date.now())) { setError(t("请填写有效且不晚于当前时间的实际到样时间")); return; }
    busyRef.current = true;
    const requestId = ++requestRef.current;
    setBusy(true);
    setError("");
    try {
      const updated = await assignProcSampleTest(task.id, { testerUserId: testerId, fromStatus: task.status, baseUpdatedAt: task.updatedAt, ...(actualArrival ? { arrivedAt: actualArrival } : {}) });
      if (activeRef.current && scopeRef.current === scope && requestRef.current === requestId) {
        if (updated.id !== task.id || Date.parse(latestTaskRef.current.updatedAt) > Date.parse(updated.updatedAt)) setError(t("任务已有更新，请载入最新任务核对分派结果"));
        else onAssigned(updated);
      }
    } catch (cause) {
      if (activeRef.current && scopeRef.current === scope && requestRef.current === requestId) setError(cause instanceof Error ? cause.message : t("测试任务分派失败"));
    } finally {
      if (activeRef.current && scopeRef.current === scope && requestRef.current === requestId) { busyRef.current = false; setBusy(false); }
    }
  };

  const requestClose = () => {
    if (busyRef.current) return;
    if (touched && (testerId !== initialTester || arrivedAt !== initialArrival)) setDiscardOpen(true);
    else onClose();
  };
  return <><Dialog open onOpenChange={(open) => { if (!open) requestClose(); }}>
    <DialogContent aria-modal="true" onEscapeKeyDown={(event) => { event.preventDefault(); if (!discardOpen) requestClose(); }} onPointerDownOutside={(event) => { event.preventDefault(); event.detail.originalEvent.preventDefault(); if (!discardOpen) requestClose(); }} className="horizon-theme horizon-portal proc-horizon-overlay flex max-h-[90dvh] flex-col overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{t(task.status === "pending_sample" ? "确认到样并安排研发测试" : "安排研发测试")}</DialogTitle>
        <DialogDescription>{task.code} · {task.materialName}</DialogDescription>
      </DialogHeader>
      <form onSubmit={(event) => { void submit(event); }} className="space-y-4">
        <p className="text-sm leading-6 text-slate-600">{t("指定人员会在研发个人工作台收到测试待办；由本人填写并确认测试结论后，系统通知该任务的采购负责人。")}</p>
        {task.sampleTest && !task.sampleTest.result && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">{t("重新安排会保留原轮次记录并新建分派，原待办将失效，新测试人需独立登记开测与结束。")}</p>}
        <label className="block text-sm font-medium text-slate-700">{t("实际到样时间")}
          <Input id="sample-test-arrival" aria-label={t("实际到样时间")} type="datetime-local" step="1" required={task.status === "pending_sample"} value={arrivedAt} disabled={busy} onChange={(event) => { if (!busyRef.current && scopeRef.current === scope) { setArrivedAt(event.target.value); setTouched(true); } }} className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-base" />
        </label>
        <div>
          <label htmlFor="sample-test-assignee" className="mb-1.5 block text-sm font-medium text-slate-700">{t("研发测试人员")}</label>
          <NativeSelect id="sample-test-assignee" value={testerId} onChange={(event) => { if (!busyRef.current && scopeRef.current === scope) { setTesterId(event.target.value); setTouched(true); } }} disabled={loading || Boolean(loadError) || busy} className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 disabled:opacity-60">
            <option value="">{t(loading ? "正在加载研发人员…" : "请选择研发测试人员")}</option>
            {testers.map((tester) => <option key={tester.id} value={tester.id}>{tester.name}{tester.department ? ` · ${tester.department}` : ""}</option>)}
          </NativeSelect>
          {!loading && !loadError && testers.length === 0 && <p className="mt-2 text-xs text-amber-700">{t("暂无可接收测试待办的研发人员，请检查账号是否启用且可使用研发个人工作台。")}</p>}
        </div>
        {loadError && <div role="alert" className="text-sm text-rose-700">{loadError}<Button type="button" variant="link" onClick={() => setRetry((value) => value + 1)}>{t("重试")}</Button></div>}
        {stale && <div role="alert" className="text-sm text-amber-700">{t("任务已更新，本次选择已保留。请载入最新任务后重新核对。")}<Button type="button" variant="link" disabled={busy} onClick={() => { if (busyRef.current) return; setBaseVersion(task.updatedAt); setBaseStatus(task.status); setTesterId(initialTester); setArrivedAt(initialArrival); setTouched(false); setError(""); }}>{t("放弃修改并载入最新任务")}</Button></div>}
        {error && <p role="alert" className="flex items-start gap-2 text-sm text-rose-700"><AlertCircle className="mt-0.5 size-4 shrink-0" />{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={requestClose}>{t("取消")}</Button>
          <Button type="submit" disabled={busy || loading || Boolean(loadError) || stale || !testerId}>{busy && <Loader2 className="size-4 animate-spin" />}{t(busy ? "正在通知…" : task.status === "pending_sample" ? "确认到样并通知研发" : "通知研发测试")}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog><AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}><AlertDialogContent aria-modal="true"><AlertDialogHeader><AlertDialogTitle>{t("放弃本次样品分派修改？")}</AlertDialogTitle><AlertDialogDescription>{t("未提交的到样时间和测试人员选择将丢弃。")}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t("继续填写")}</AlertDialogCancel><AlertDialogAction onClick={() => { if (!busyRef.current) onClose(); }}>{t("放弃并关闭")}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></>;
}
