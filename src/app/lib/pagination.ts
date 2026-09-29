type PageToken = number | 'ellipsis-start' | 'ellipsis-end';

export function pageTokens(page: number, totalPages: number): PageToken[] {
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
