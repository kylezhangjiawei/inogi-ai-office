import { executionFinalInspectionSummary, executionSum, executionToday, type ExecutionTask } from './production-execution.model';

/** Event-date totals are independent of the unfinished-task queue and never mean gate completion. */
export function executionDashboard(tasks: ExecutionTask[], month: string) {
  const whole = tasks.filter(task => task.status !== 'cancelled' && task.output === 'whole' && task.unit === '台');
  const [year, monthNumber] = month.split('-').map(Number);
  const daily = Array.from({ length: new Date(Date.UTC(year, monthNumber, 0)).getUTCDate() }, (_, index) => {
    const date = `${month}-${String(index + 1).padStart(2, '0')}`;
    const final = executionFinalInspectionSummary(whole, date);
    return {
      date,
      reportedQty: executionSum(whole.flatMap(task => task.reports.filter(row => row.date === date).map(row => row.quantity))),
      finalQuantity: final.quantity,
      finalGoodQty: final.goodQty,
    };
  });
  const date = executionToday(), defects = new Map<string, number>();
  for (const task of whole) for (const row of task.inspections ?? []) {
    if (row.kind !== 'final' || row.date !== date || row.quantity <= row.goodQty) continue;
    const process = row.process?.trim() || task.name;
    defects.set(process, executionSum([defects.get(process) ?? 0, row.quantity, -row.goodQty]));
  }
  return {
    daily,
    today: {
      date,
      firstFinal: executionFinalInspectionSummary(whole, date),
      defects: [...defects].map(([process, quantity]) => ({ process, quantity, unit: '台' as const }))
        .sort((a, b) => b.quantity - a.quantity || a.process.localeCompare(b.process, 'zh-CN')),
    },
  };
}
