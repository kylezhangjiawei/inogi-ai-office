import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { useI18n } from '../../lib/i18n';
export function KeyMaterialPagination({ page, totalPages, total, onPage }: { page: number; totalPages: number; total: number; onPage: (page: number) => void }) {
  const { t } = useI18n();
  return <nav aria-label={t('关键物料分页')} className="km-workspace-pagination">
    <span className="text-xs tabular-nums text-muted-foreground">{t('共 {count} 项', { count: total })} · {page} / {totalPages}</span>
    <div className="flex items-center gap-2"><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label={t('上一页')}><ChevronLeft className="size-4" aria-hidden="true" /></Button><Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => onPage(page + 1)} aria-label={t('下一页')}><ChevronRight className="size-4" aria-hidden="true" /></Button></div>
  </nav>;
}
