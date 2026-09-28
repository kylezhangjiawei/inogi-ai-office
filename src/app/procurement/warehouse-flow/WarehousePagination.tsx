import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { useI18n } from '../../lib/i18n';
export function WarehousePagination({ page, pageCount, total, onPage }: { page: number; pageCount: number; total: number; onPage: (page: number) => void }) {
  const { t } = useI18n();
  return <nav className="warehouse-page-footer" aria-label={t('仓库记录分页')}><span className="text-xs tabular-nums text-muted-foreground">{t('{count} 条记录', { count: total })}</span><div className="flex items-center gap-2"><Button variant="outline" size="sm" disabled={page <= 1} aria-label={t('上一页')} onClick={() => onPage(page - 1)}><ChevronLeft className="size-4" aria-hidden="true" /></Button><span className="min-w-16 text-center text-xs tabular-nums">{page} / {pageCount}</span><Button variant="outline" size="sm" disabled={page >= pageCount} aria-label={t('下一页')} onClick={() => onPage(page + 1)}><ChevronRight className="size-4" aria-hidden="true" /></Button></div></nav>;
}
