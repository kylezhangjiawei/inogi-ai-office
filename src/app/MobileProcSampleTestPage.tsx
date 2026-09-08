import { useEffect, useState } from "react";
import { Button } from "./components/ui/button";
import { initI18n, useI18n } from "./lib/i18n";
import { ProcSampleTestDialog } from "./procurement/components/ProcSampleTestDialog";

/** 手机测试深链的轻量页面：保留当前 URL，关闭弹窗后仍能重新查看同一任务。 */
export function MobileProcSampleTestPage({ taskId }: { taskId: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(true);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    void initI18n();
    const root = document.documentElement;
    root.classList.add("mobile-route");
    return () => root.classList.remove("mobile-route");
  }, []);

  return <main className="horizon-theme min-h-[100dvh] min-w-0 bg-slate-50 px-4 py-8">
    <section className="mx-auto max-w-xl space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      <p className="text-xs font-semibold text-slate-500">INOGI AI</p>
      <h1 className="text-xl font-semibold text-slate-900">{t("研发样品测试")}</h1>
      <p className="text-sm leading-6 text-slate-600" role="status">{t(confirmed
        ? "测试结论已确认，已通知采购负责人。"
        : "请查看样品测试任务，由指定研发人员填写并确认测试结论。")}</p>
      <Button type="button" className="w-full" onClick={() => setOpen(true)}>{t("查看测试详情")}</Button>
      <p className="text-xs leading-5 text-slate-500">{t("关闭测试窗口不会离开此页，你可以随时重新查看。")}</p>
    </section>
    {open && <ProcSampleTestDialog taskId={taskId} onClose={() => setOpen(false)} onConfirmed={() => setConfirmed(true)} />}
  </main>;
}
