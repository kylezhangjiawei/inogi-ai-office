import type { ExecutionInspection } from '../../lib/productionExecutionApi';

export const inspectionKind = (row: Pick<ExecutionInspection, 'kind'>) => row.kind === 'process' || row.kind === 'final' ? row.kind : 'legacy';
export const inspectionKindLabel = (row: Pick<ExecutionInspection, 'kind'>) => ({ process: '过程检', final: '终检', legacy: '历史未分类初检' })[inspectionKind(row)];

/** Only explicitly typed first final inspections enter this denominator. Reinspection never rewrites it. */
export function firstFinalInspection(rows: ExecutionInspection[], date?: string) {
  const selected = rows.filter(row => row.kind === 'final' && (!date || row.date === date));
  const quantity = selected.reduce((sum, row) => sum + Math.round(row.quantity * 1000), 0) / 1000;
  const goodQty = selected.reduce((sum, row) => sum + Math.round(row.goodQty * 1000), 0) / 1000;
  return { quantity, goodQty, rate: quantity ? goodQty / quantity * 100 : null };
}
