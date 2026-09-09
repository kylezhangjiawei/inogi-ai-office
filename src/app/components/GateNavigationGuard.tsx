import React from "react";
import { UNSAFE_DataRouterContext, useBlocker } from "react-router";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "./ui/alert-dialog";
import { Button } from "./ui/button";

function RouterGateNavigationGuard({ when }: { when: boolean }) {
  const blocker = useBlocker(when);

  React.useEffect(() => {
    // A save already in progress may finish while the leave prompt is open.
    if (!when && blocker.state === "blocked") blocker.proceed();
  }, [when, blocker]);

  return <AlertDialog open={blocker.state === "blocked"} onOpenChange={open => {
    if (!open && blocker.state === "blocked") blocker.reset();
  }}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>离开电子闸门配置？</AlertDialogTitle>
        <AlertDialogDescription>还有未保存的修改。离开后，这些修改将被舍弃；已保存的草稿和已发布配置会保留。</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>继续编辑</AlertDialogCancel>
        <Button variant="destructive" onClick={() => {
          if (blocker.state === "blocked") blocker.proceed();
        }}>舍弃并离开</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}

export function GateNavigationGuard({ when }: { when: boolean }) {
  const dataRouter = React.useContext(UNSAFE_DataRouterContext);
  return dataRouter ? <RouterGateNavigationGuard when={when} /> : null;
}
