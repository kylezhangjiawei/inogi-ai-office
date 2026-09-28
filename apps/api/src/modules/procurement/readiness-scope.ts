import { NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { ExecutionPlan } from './production-execution.model';

export const batchScopeId = (planId: string, batchId: string) => `${planId}:batch:${batchId}`;
export const belongsToPlan = (scopeId: string, planId: string) => scopeId === planId || scopeId.startsWith(`${planId}:batch:`);
export function readinessScope(plan: ExecutionPlan, batchId?: string) {
  const batch = batchId ? plan.batches.find(row => row.id === batchId) : null;
  if (batchId && !batch) throw new NotFoundException('批次不属于当前生产计划');
  return { id: batch ? batchScopeId(plan.id, batch.id) : plan.id,
    batchId: batch?.id ?? null, batchCode: batch?.code ?? null,
    targetQty: batch?.quantity ?? plan.targetQty,
    tasks: batch ? plan.tasks.filter(task => task.batchId === batch.id) : plan.tasks };
}
export function readinessPlanSources(plans: ExecutionPlan[]) {
  const entries: Array<[string, string]> = [];
  for (const plan of plans) {
    const basis = [plan.productId, plan.targetQty, plan.bomFingerprint, plan.bom];
    const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
    entries.push([plan.id, hash(basis)]);
    for (const batch of plan.batches ?? []) entries.push([batchScopeId(plan.id, batch.id), hash([...basis, batch])]);
  }
  return new Map(entries);
}
