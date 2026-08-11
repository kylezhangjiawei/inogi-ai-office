export const USAGE_RANKING_PAGE_SIZE = 5;

export type UsageRankingPage = {
  safePage: number;
  totalPages: number;
  startIndex: number;
  endIndex: number;
  firstItem: number;
  lastItem: number;
  visiblePages: number[];
  hasPrevious: boolean;
  hasNext: boolean;
};

export function getUsageRankingPage(
  totalItems: number,
  requestedPage: number,
  pageSize = USAGE_RANKING_PAGE_SIZE,
): UsageRankingPage {
  const safeTotalItems = Math.max(0, Math.floor(Number.isFinite(totalItems) ? totalItems : 0));
  const safePageSize = Math.max(1, Math.floor(Number.isFinite(pageSize) ? pageSize : USAGE_RANKING_PAGE_SIZE));
  const totalPages = Math.max(1, Math.ceil(safeTotalItems / safePageSize));
  const normalizedPage = Math.floor(Number.isFinite(requestedPage) ? requestedPage : 1);
  const safePage = Math.min(Math.max(1, normalizedPage), totalPages);
  const startIndex = (safePage - 1) * safePageSize;
  const endIndex = Math.min(safeTotalItems, startIndex + safePageSize);
  const firstVisiblePage = Math.max(1, Math.min(safePage - 1, totalPages - 2));
  const visiblePages = Array.from(
    { length: Math.min(3, totalPages) },
    (_, index) => firstVisiblePage + index,
  );

  return {
    safePage,
    totalPages,
    startIndex,
    endIndex,
    firstItem: safeTotalItems === 0 ? 0 : startIndex + 1,
    lastItem: endIndex,
    visiblePages,
    hasPrevious: safePage > 1,
    hasNext: safePage < totalPages,
  };
}
