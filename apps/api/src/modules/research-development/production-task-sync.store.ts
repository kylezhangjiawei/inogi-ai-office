import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../../prisma/prisma.service';

export type ProductionTaskSyncRecord = {
  task_id: string;
  active: boolean;
  first_synced_at: string;
  synced_at: string;
  synced_by_id: string | null;
  synced_by_name: string;
  revoked_at: string | null;
  revoked_by_id: string | null;
  revoked_by_name: string | null;
};

const REGISTRY_KEY = 'rd.productionTaskSyncs';
const AUDIT_KEY = 'rd.productionTaskSyncAudit';
const text = (value: unknown) => String(value ?? '').trim();
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

function normalizeRegistry(value: unknown): Record<string, ProductionTaskSyncRecord> {
  if (!isRecord(value)) return {};
  const result: Record<string, ProductionTaskSyncRecord> = {};
  for (const [taskId, raw] of Object.entries(value)) {
    if (!isRecord(raw) || !text(taskId)) continue;
    const firstSyncedAt = text(raw.first_synced_at) || text(raw.synced_at);
    const syncedAt = text(raw.synced_at) || firstSyncedAt;
    if (!firstSyncedAt || !syncedAt) continue;
    result[taskId] = {
      task_id: taskId,
      active: raw.active === true,
      first_synced_at: firstSyncedAt,
      synced_at: syncedAt,
      synced_by_id: text(raw.synced_by_id) || null,
      synced_by_name: text(raw.synced_by_name) || '研发成员',
      revoked_at: text(raw.revoked_at) || null,
      revoked_by_id: text(raw.revoked_by_id) || null,
      revoked_by_name: text(raw.revoked_by_name) || null,
    };
  }
  return result;
}

/** This registry belongs to the R&D source, including when read to build production mirrors. */
export async function readProductionSyncRegistry(db: Pick<Prisma.TransactionClient, 'systemSetting'>) {
  const setting = await db.systemSetting.findUnique({ where: { key: REGISTRY_KEY }, select: { value: true } });
  return normalizeRegistry(setting?.value);
}

/** Keep registry and audit writes atomic across API instances; never read the process-local cache here. */
export function updateProductionTaskSync(
  prisma: PrismaService,
  taskId: string,
  active: boolean,
  actor?: { userId?: string; userName?: string },
) {
  return prisma.$transaction(async (tx) => {
    // The registry is one JSON row, so all task updates must share the same lock.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${REGISTRY_KEY}))::text`;
    const registry = await readProductionSyncRegistry(tx);
    const previous = registry[taskId];
    if (!active && !previous) throw new NotFoundException('该任务尚未同步到生产驾驶舱');
    if (!active && !previous.active) return { record: previous, action: null };

    const now = new Date().toISOString();
    const actorId = text(actor?.userId) || null;
    const actorName = text(actor?.userName) || '研发成员';
    const record: ProductionTaskSyncRecord = active ? {
      task_id: taskId,
      active: true,
      first_synced_at: previous?.first_synced_at ?? now,
      synced_at: now,
      synced_by_id: actorId,
      synced_by_name: actorName,
      revoked_at: null,
      revoked_by_id: null,
      revoked_by_name: null,
    } : { ...previous, active: false, revoked_at: now, revoked_by_id: actorId, revoked_by_name: actorName };
    const action = !active ? 'task.production_sync_revoked'
      : previous?.active ? 'task.production_sync_refreshed' : 'task.production_sync_enabled';
    const audit = await tx.systemSetting.findUnique({ where: { key: AUDIT_KEY }, select: { value: true } });
    const history = Array.isArray(audit?.value) ? audit.value : [];
    const values = {
      [REGISTRY_KEY]: { ...registry, [taskId]: record },
      [AUDIT_KEY]: [{ id: `rd-production-sync-${randomUUID()}`, timestamp: now, action, task_id: taskId,
        actor: { id: actorId, name: actorName } }, ...history].slice(0, 5000),
    };
    for (const [key, value] of Object.entries(values)) {
      await tx.systemSetting.upsert({
        where: { key },
        create: { category: 'research-development', key, value: value as Prisma.InputJsonValue,
          description: `R&D module data store: ${key}` },
        update: { category: 'research-development', value: value as Prisma.InputJsonValue },
      });
    }
    return { record, action };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
