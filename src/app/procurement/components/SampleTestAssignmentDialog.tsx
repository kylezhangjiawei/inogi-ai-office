import { useEffect, useRef, useState, type FormEvent } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { useI18n } from "../../lib/i18n";
import { assignProcSampleTest, listProcSampleTesters, type ProcurementTask, type ProcSampleTester } from "../../lib/procurementApi";

export function SampleTestAssignmentDialog({ task, onClose, onAssigned }: {
  task: ProcurementTask;
  onClose: () => void;
  onAssigned: (task: ProcurementTask) => void;
}) {
  const { t } = useI18n();
  const [testers, setTesters] = useState<ProcSampleTester[]>([]);
  const [testerId, setTesterId] = useState(task.sampleTest?.testerUserId || task.rdContactUserId || "");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const activeRef = useRef(true);
  useEffect(() => { activeRef.current = true; return () => { activeRef.current = false; }; }, []);
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
  }, [retry, t]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busyRef.current) return;
    if (!testers.some((tester) => tester.id === testerId)) { setError(t("请选择研发测试人员")); return; }
    if (task.status !== "pending_sample" && task.status !== "testing") { setError(t("任务状态已变化，请刷新后重试")); return; }
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const updated = await assignProcSampleTest(task.id, { testerUserId: testerId, fromStatus: task.status, baseUpdatedAt: task.updatedAt });
      if (activeRef.current) onAssigned(updated);
    } catch (cause) {
      if (activeRef.current) setError(cause instanceof Error ? cause.message : t("测试任务分派失败"));
    } finally {
      busyRef.current = false;
      if (activeRef.current) setBusy(false);
    }
  };

  return <Dialog open onOpenChange={(open) => { if (!open && !busyRef.current) onClose(); }}>
    <DialogContent className="horizon-theme horizon-portal proc-horizon-overlay flex max-h-[90dvh] flex-col overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{t(task.status === "pending_sample" ? "确认到样并安排研发测试" : "安排研发测试")}</DialogTitle>
        <DialogDescription>{task.code} · {task.materialName}</DialogDescription>
      </DialogHeader>
      <form onSubmit={(event) => { void submit(event); }} className="space-y-4">
        <p className="text-sm leading-6 text-slate-600">{t("指定人员会在研发个人工作台收到测试待办；由本人填写并确认测试结论后，系统通知该任务的采购负责人。")}</p>
        {task.sampleTest && !task.sampleTest.result && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">{t("重新安排会更新本轮测试待办，原待办将失效。")}</p>}
        <div>
          <label htmlFor="sample-test-assignee" className="mb-1.5 block text-sm font-medium text-slate-700">{t("研发测试人员")}</label>
          <select id="sample-test-assignee" value={testerId} onChange={(event) => setTesterId(event.target.value)} disabled={loading || Boolean(loadError) || busy} className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 disabled:opacity-60">
            <option value="">{t(loading ? "正在加载研发人员…" : "请选择研发测试人员")}</option>
            {testers.map((tester) => <option key={tester.id} value={tester.id}>{tester.name}{tester.department ? ` · ${tester.department}` : ""}</option>)}
          </select>
          {!loading && !loadError && testers.length === 0 && <p className="mt-2 text-xs text-amber-700">{t("暂无可接收测试待办的研发人员，请检查账号是否启用且可使用研发个人工作台。")}</p>}
        </div>
        {loadError && <div role="alert" className="text-sm text-rose-700">{loadError}<Button type="button" variant="link" onClick={() => setRetry((value) => value + 1)}>{t("重试")}</Button></div>}
        {error && <p role="alert" className="flex items-start gap-2 text-sm text-rose-700"><AlertCircle className="mt-0.5 size-4 shrink-0" />{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>{t("取消")}</Button>
          <Button type="submit" disabled={busy || loading || Boolean(loadError) || !testerId}>{busy && <Loader2 className="size-4 animate-spin" />}{t(busy ? "正在通知…" : task.status === "pending_sample" ? "确认到样并通知研发" : "通知研发测试")}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
