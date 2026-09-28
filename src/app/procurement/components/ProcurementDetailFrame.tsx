import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Sheet, SheetContent } from '../../components/ui/sheet';
import { useI18n } from '../../lib/i18n';
import '../procurementDetail.css';

export function ProcurementDetailFrame({ page, embedded = false, onClose, onCloseAutoFocus, children }: {
  page: boolean; embedded?: boolean; onClose: () => void; onCloseAutoFocus: (event: Event) => void; children: ReactNode;
}) {
  const { t } = useI18n();
  if (embedded) return <>{children}</>;
  if (page) return <main className="proc-detail-page horizon-theme">
    <div className="proc-detail-breadcrumb"><Button variant="ghost" onClick={onClose}><ArrowLeft className="size-4" aria-hidden="true" />{t('返回任务列表')}</Button><span>{t('采购任务详情')}</span></div>
    <div className="proc-detail-surface">{children}</div>
  </main>;
  return <Sheet open onOpenChange={open => { if (!open) onClose(); }}>
    <SheetContent side="right" className="horizon-theme horizon-portal proc-horizon-drawer w-full max-w-full gap-0 p-0 pb-[env(safe-area-inset-bottom)] sm:max-w-[720px]" aria-describedby={undefined} onCloseAutoFocus={onCloseAutoFocus}>
      {children}
    </SheetContent>
  </Sheet>;
}
