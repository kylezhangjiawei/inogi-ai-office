import { useCallback, useEffect, type MutableRefObject } from "react";
import { useBlocker, type BlockerFunction } from "react-router";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../../components/ui/alert-dialog";
import { useI18n } from "../../lib/i18n";

/** Mounted only in the sample workspace; the rest of procurement keeps its existing navigation. */
export function ProcSampleNavigationGuard({ dirty, busy, approvedSampleNavigationRef }: {
  dirty: boolean;
  busy: boolean;
  approvedSampleNavigationRef: MutableRefObject<string | null>;
}) {
  const { t } = useI18n();
  const shouldBlock = useCallback<BlockerFunction>(({ currentLocation, nextLocation }) => {
    // The list has already confirmed its own selection. Consume that permission once,
    // so history navigation to a different sample still protects the current draft.
    const approvedSampleId = approvedSampleNavigationRef.current;
    approvedSampleNavigationRef.current = null;
    const currentParams = new URLSearchParams(currentLocation.search);
    const nextParams = new URLSearchParams(nextLocation.search);
    const staysInSamples = currentLocation.pathname === nextLocation.pathname && nextParams.get("tab") === "samples";
    const changesSample = currentParams.get("sample") !== nextParams.get("sample");
    if (staysInSamples && !changesSample) return false;
    if (busy) return true;
    if (staysInSamples && approvedSampleId !== null && nextParams.get("sample") === approvedSampleId) return false;
    return dirty;
  }, [dirty, busy, approvedSampleNavigationRef]);
  const blocker = useBlocker(shouldBlock);

  useEffect(() => {
    if (!dirty && !busy) return;
    const preventUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventUnload);
    return () => window.removeEventListener("beforeunload", preventUnload);
  }, [dirty, busy]);

  useEffect(() => {
    // Completing a submission releases the lock without replaying an earlier navigation attempt.
    if (blocker.state === "blocked" && !dirty && !busy) blocker.reset();
  }, [blocker, dirty, busy]);

  return <AlertDialog open={blocker.state === "blocked" && (dirty || busy)} onOpenChange={(open) => {
    if (!open && blocker.state === "blocked") blocker.reset();
  }}>
    <AlertDialogContent className="horizon-theme horizon-portal proc-horizon-overlay">
      <AlertDialogHeader>
        <AlertDialogTitle>{t(busy ? "正在提交，请稍候" : "离开前放弃未提交的结论？")}</AlertDialogTitle>
        <AlertDialogDescription>{t(busy ? "样品结论正在提交，请等待处理完成后再离开。" : "当前样品的测试结果和结论尚未提交，离开后需要重新填写。")}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>{t(busy ? "留在当前样品" : "继续填写")}</AlertDialogCancel>
        {!busy && <AlertDialogAction onClick={(event) => {
          // Keep Radix from firing a close/reset after proceed has already started navigation.
          event.preventDefault();
          if (blocker.state === "blocked") blocker.proceed();
        }}>{t("放弃并离开")}</AlertDialogAction>}
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
