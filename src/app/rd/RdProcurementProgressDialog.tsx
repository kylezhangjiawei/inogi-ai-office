import { RdOriginalRecordLinks } from './RdOriginalRecordLinks';
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router";
import { Loader2, RefreshCw, ShoppingCart } from "lucide-react";
import { useAuth } from "../auth";
import { AutoTranslatedText } from "../components/TranslatableText";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { useI18n } from "../lib/i18n";
import { getProcTaskByRdTask, type ProcurementTask } from "../lib/procurementApi";
import { StatusPill } from "../procurement/components/common";
import { ProcurementActivitySection } from "../procurement/components/rdInsertion";

export interface RdProcurementProgressDialogProps {
  rdTaskId: string | null;
  rdTaskTitle: string;
  onClose: () => void;
}

type ProgressSnapshot = {
  scope: string;
  loading: boolean;
  task: ProcurementTask | null;
  error: string | null;
};

/** Revalidate the R&D-visible association on every opening; no procurement-wide reads. */
export function RdProcurementProgressDialog({ rdTaskId, rdTaskTitle, onClose }: RdProcurementProgressDialogProps) {
  const { t } = useI18n();
  const { user } = useAuth();
  const location = useLocation();
  const id = rdTaskId?.trim() || null;
  const scope = JSON.stringify([id, user?.id, user?.roleId, user?.departmentCode, [...(user?.permissions ?? [])].sort()]);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const controllerRef = useRef<AbortController | null>(null);
  const requestRef = useRef(0);
  const locationRef = useRef(location.key);
  const [revision, setRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<ProgressSnapshot | null>(null);

  useEffect(() => {
    if (!id || !user?.id) {
      setSnapshot(null);
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    const request = ++requestRef.current;
    const isCurrent = () => !controller.signal.aborted && requestRef.current === request && scopeRef.current === scope;
    setSnapshot({ scope, loading: true, task: null, error: null });
    void getProcTaskByRdTask(id, controller.signal).then((task) => {
      if (isCurrent()) setSnapshot({ scope, loading: false, task, error: null });
    }).catch((cause: unknown) => {
      if (isCurrent()) setSnapshot({ scope, loading: false, task: null, error: cause instanceof Error ? cause.message : "" });
    });
    return () => {
      controller.abort();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [id, user?.id, scope, revision]);

  // Existing sample actions navigate within the R&D workspace. Let that surface take focus.
  useEffect(() => {
    const changed = locationRef.current !== location.key;
    locationRef.current = location.key;
    if (id && changed) {
      controllerRef.current?.abort();
      requestRef.current += 1;
      onClose();
    }
  }, [id, location.key, onClose]);

  const current = snapshot?.scope === scope ? snapshot : null;
  const loading = Boolean(id && user?.id && (!current || current.loading));
  const failed = !user?.id || current?.error !== null && current?.error !== undefined;
  const task = !loading && !failed ? current?.task : null;
  const refresh = () => { if (scopeRef.current === scope) setRevision((value) => value + 1); };
  const close = () => {
    controllerRef.current?.abort();
    requestRef.current += 1;
    onClose();
  };
  const quantity = task && Number.isFinite(task.quantity) && task.quantity >= 0 ? task.quantity.toLocaleString() : t("待核对");

  return <Dialog open={Boolean(id)} onOpenChange={(open) => { if (!open) close(); }}>
    <DialogContent className="rd-procurement-progress-dialog horizon-theme flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[760px]">
      <DialogHeader className="border-b border-border px-5 py-4 text-left sm:px-6">
        <DialogTitle className="flex items-center gap-2"><ShoppingCart className="size-5 shrink-0 text-primary" aria-hidden="true" />{t("采购进度")}</DialogTitle>
        <DialogDescription className="break-words">{t("研发任务：{name}", { name: rdTaskTitle })}</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6" aria-busy={loading}>
        {loading ? <div role="status" className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />{t("正在读取采购进度…")}</div>
          : failed ? <div role="alert" className="space-y-3 rounded-xl border border-border bg-muted/40 p-4">
            <p className="text-sm font-medium text-foreground">{t("采购进度读取失败")}</p>
            <p className="break-words text-sm leading-6 text-muted-foreground">{!user?.id ? t("当前账号不可用，请重新登录后重试。") : current?.error || t("请稍后重试。")}</p>
            {user?.id && <Button type="button" variant="outline" onClick={refresh}><RefreshCw className="size-4" aria-hidden="true" />{t("重新读取")}</Button>}
          </div>
            : task ? <div className="space-y-5">
              <section aria-label={t("采购任务摘要")} className="min-w-0 rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1">
                  <p className="break-all text-xs tabular-nums text-muted-foreground">{t("采购任务编号")} · {task.code}</p>
                  <h3 className="mt-2 break-words text-base font-semibold leading-6 text-foreground"><AutoTranslatedText text={task.materialName} /></h3>
                  <p className="mt-1 break-words text-sm leading-6 text-muted-foreground"><AutoTranslatedText text={task.spec || t("规格未填写")} /></p>
                </div><StatusPill status={task.status} /></div>
                <dl className="mt-4 grid grid-cols-2 gap-x-5 gap-y-4 border-t border-border pt-4 text-sm">
                  <ProgressFact label={t("需求数量")}><span className="tabular-nums">{quantity} {t(task.unit)}</span></ProgressFact>
                  <ProgressFact label={t("采购负责人")}>{task.buyer?.trim() || t("未指派")}</ProgressFact>
                  <ProgressFact label={t("需求日期")}>{task.needDate ? <time dateTime={task.needDate} className="tabular-nums">{task.needDate}</time> : t("待确认")}</ProgressFact>
                  <ProgressFact label={t("预计到货日期")}>{task.expectedArrivalDate ? <time dateTime={task.expectedArrivalDate} className="tabular-nums">{task.expectedArrivalDate}</time> : t("待确认")}</ProgressFact>
                </dl>
              </section>
              <div className="min-w-0 break-words [&_.rd-procurement-activity>div:first-child]:flex-wrap [&_.rd-procurement-activity_li>div]:min-w-0">
                <ProcurementActivitySection task={task} />
                <RdOriginalRecordLinks rdTaskId={id!} />
              </div>
            </div>
              : <div role="status" className="flex min-h-40 flex-col items-center justify-center gap-3 text-center"><ShoppingCart className="size-8 text-muted-foreground" aria-hidden="true" /><p className="text-sm leading-6 text-muted-foreground">{t("该研发任务暂未关联采购任务。")}</p></div>}
      </div>
      <DialogFooter className="border-t border-border bg-card px-5 py-3 sm:px-6">
        {task && <Button type="button" variant="outline" onClick={refresh}><RefreshCw className="size-4" aria-hidden="true" />{t("刷新采购进度")}</Button>}
        <Button type="button" variant="outline" onClick={close}>{t("关闭")}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

function ProgressFact({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1.5 break-words font-medium leading-6 text-foreground">{children}</dd></div>;
}
