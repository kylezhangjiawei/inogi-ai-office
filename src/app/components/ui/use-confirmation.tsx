import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from './alert-dialog';
import { buttonVariants } from './button';
import { useI18n } from '../../lib/i18n';

type Confirmation = { title: string; description: string; actionLabel?: string; destructive?: boolean };

/** A local AlertDialog replaces browser confirm without a global provider. */
export function useConfirmation() {
  const { lang } = useI18n();
  const [request, setRequest] = useState<Confirmation | null>(null);
  const [open, setOpen] = useState(false);
  const resolveRef = useRef<((confirmed: boolean) => void) | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  useEffect(() => () => { resolveRef.current?.(false); resolveRef.current = null; }, []);
  const confirm = useCallback((next: Confirmation) => {
    if (resolveRef.current) return Promise.resolve(false);
    triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setRequest(next);
    setOpen(true);
    return new Promise<boolean>((resolve) => { resolveRef.current = resolve; });
  }, []);
  const finish = (confirmed: boolean) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    // Retain the copy during Radix's closing transition to avoid a blank dialog flash.
    setOpen(false);
    resolve?.(confirmed);
  };
  const confirmationDialog = <AlertDialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) finish(false); }}>
    <AlertDialogContent className="horizon-portal" onCloseAutoFocus={(event) => {
      if (triggerRef.current?.isConnected) { event.preventDefault(); triggerRef.current.focus(); }
    }}>
      <AlertDialogHeader><AlertDialogTitle>{request?.title}</AlertDialogTitle>
        <AlertDialogDescription className="whitespace-pre-line">{request?.description}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter><AlertDialogCancel onClick={() => finish(false)}>{lang === 'zh' ? '取消' : 'Cancel'}</AlertDialogCancel>
        <AlertDialogAction className={buttonVariants({ variant: request?.destructive ? 'destructive' : 'default' })} onClick={() => finish(true)}>
          {request?.actionLabel ?? (lang === 'zh' ? '继续' : 'Continue')}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
  return { confirm, confirmationDialog };
}
