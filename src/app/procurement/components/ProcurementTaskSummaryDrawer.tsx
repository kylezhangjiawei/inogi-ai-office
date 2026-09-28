import { useAuth } from '../../auth';
import { Sheet, SheetContent } from '../../components/ui/sheet';
import type { Material, ProcurementTask } from '../../lib/procurementApi';
import { TaskDetailDrawer } from './TaskDetailDrawer';

interface SummaryProps {
  task: ProcurementTask; materials: Material[]; onClose: () => void; readOnly?: boolean;
}

/** A non-modal reader leaves the task table available for selecting the next task. */
export function ProcurementTaskSummaryDrawer(props: SummaryProps) {
  const { user } = useAuth();
  const session = JSON.stringify([props.task.id, props.readOnly, user?.id, [...(user?.permissions ?? [])].sort()]);
  return <Sheet open modal={false} onOpenChange={open => { if (!open) props.onClose(); }}>
    <SheetContent side="right" aria-describedby={undefined}
      className="horizon-theme horizon-portal proc-task-reader w-[calc(100vw-2rem)] max-w-full gap-0 p-0 pb-[env(safe-area-inset-bottom)] sm:w-full sm:max-w-[760px] data-[state=open]:animate-none data-[state=closed]:animate-none"
      onInteractOutside={event => event.preventDefault()}
      onCloseAutoFocus={event => {
        event.preventDefault();
        const row = Array.from(document.querySelectorAll<HTMLElement>('[data-task-id]')).find(element => element.dataset.taskId === props.task.id);
        (row?.querySelector<HTMLElement>('button') ?? document.querySelector<HTMLElement>('[aria-label="采购任务列表"]'))?.focus();
      }}>
      <TaskDetailDrawer key={session} presentation="embedded" {...props} />
    </SheetContent>
  </Sheet>;
}

