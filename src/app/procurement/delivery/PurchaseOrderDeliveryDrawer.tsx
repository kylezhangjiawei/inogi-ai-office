import { useCallback, useRef, useState } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../../components/ui/sheet';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../../components/ui/alert-dialog';
import { Button } from '../../components/ui/button';
import { useI18n } from '../../lib/i18n';
import { PurchaseOrderDeliveryPanel, type PurchaseOrderDeliveryPanelProps } from './PurchaseOrderDeliveryPanel';

export function PurchaseOrderDeliveryDrawer({ onClose, onCloseAutoFocus, ...props }: Omit<PurchaseOrderDeliveryPanelProps, 'onStateChange'> & {
  onClose: () => void; onCloseAutoFocus?: (event: Event) => void;
}) {
  const { t } = useI18n();
  const status = useRef({ dirty: false, busy: false });
  const [discard, setDiscard] = useState(false), [busy, setBusy] = useState(false);
  const stateChanged = useCallback((value: { dirty: boolean; busy: boolean }) => { status.current = value; setBusy(value.busy); }, []);
  const close = () => { if (status.current.busy) return; if (status.current.dirty) setDiscard(true); else onClose(); };
  return <><Sheet open onOpenChange={(open) => { if (!open) close(); }}><SheetContent side="right" className="purchase-delivery-drawer" closeDisabled={busy} onCloseAutoFocus={onCloseAutoFocus}
    onEscapeKeyDown={(event) => { event.preventDefault(); close(); }} onInteractOutside={(event) => { event.preventDefault(); close(); }}>
    <SheetHeader><SheetTitle>{t('供应商承诺与 ERP 交期')}</SheetTitle><SheetDescription>{props.orderNo}</SheetDescription></SheetHeader>
    <div className="delivery-drawer-scroll"><PurchaseOrderDeliveryPanel {...props} onStateChange={stateChanged} /></div>
    <div className="delivery-drawer-footer"><Button variant="outline" disabled={busy} onClick={close}>{t('关闭')}</Button></div>
  </SheetContent></Sheet>
  <AlertDialog open={discard} onOpenChange={setDiscard}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t('放弃未保存的承诺记录？')}</AlertDialogTitle><AlertDialogDescription>{t('关闭后本次草稿会丢失，已保存的交期历史仍保留。')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t('继续填写')}</AlertDialogCancel><AlertDialogAction onClick={() => { setDiscard(false); onClose(); }}>{t('放弃并关闭')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></>;
}
