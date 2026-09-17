import React, { useMemo } from 'react';

import { Button } from '../../components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { cn } from '../../components/ui/utils';
import { useI18n } from '../../lib/i18n';

type PageToken = number | 'ellipsis-start' | 'ellipsis-end';

function pageTokens(page: number, totalPages: number): PageToken[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  const tokens: PageToken[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(totalPages - 1, page + 1);
  if (start > 2) tokens.push('ellipsis-start');
  for (let current = start; current <= end; current += 1) tokens.push(current);
  if (end < totalPages - 1) tokens.push('ellipsis-end');
  tokens.push(totalPages);
  return tokens;
}

export function DataPagination({
  page,
  pageSize,
  total,
  totalPages,
  loading,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  loading?: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  const { t } = useI18n();
  const tokens = useMemo(() => pageTokens(page, totalPages), [page, totalPages]);
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <div className="order-horizon-pagination flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
      <span className="tabular-nums">
        {t('显示')} {start}–{end} / {t('共')} {total} {t('条')}
      </span>

      <nav aria-label={t('列表分页')} className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading || page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="h-8 rounded-full border-slate-200 px-3 text-xs">
          {t('上一页')}
        </Button>
        {tokens.map((token) =>
          typeof token === 'number' ? (
            <Button
              key={token}
              type="button"
              variant={token === page ? 'default' : 'ghost'}
              size="icon"
              disabled={loading}
              aria-label={t('第 {page} 页', { page: token })}
              aria-current={token === page ? 'page' : undefined}
              onClick={() => onPageChange(token)}
              className={cn(
                'size-8 rounded-full text-xs tabular-nums',
                token === page ? 'bg-primary text-white hover:bg-primary-hover' : 'text-slate-600',
              )}>
              {token}
            </Button>
          ) : (
            <span key={token} className="flex size-8 items-center justify-center text-muted-foreground" aria-hidden>
              …
            </span>
          ),
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading || page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="h-8 rounded-full border-slate-200 px-3 text-xs">
          {t('下一页')}
        </Button>
      </nav>

      <div className="flex items-center gap-2">
        <span>{t('每页')}</span>
        <Select value={String(pageSize)} onValueChange={(value) => onPageSizeChange(Number(value))}>
          <SelectTrigger aria-label={t('每页条数')} className="h-8 w-[76px] rounded-full border-slate-200 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[20, 50, 100].map((size) => (
              <SelectItem key={size} value={String(size)}>{size}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
