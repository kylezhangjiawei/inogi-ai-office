import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ProcActor } from './procurement.types';
export const QUALITY_ANALYSIS_PREFIX = 'procurement:quality-analysis:v1:';
export const QUALITY_CAUSES = ['unknown', 'process', 'packaging', 'standard', 'revision', 'material', 'other'] as const;
export const QUALITY_SOURCES = ['procurement', 'production', 'warehouse', 'after_sales'] as const;
export type QualityFile = { fileId: string; name: string; mime: string; size: number };
export type QualityAnalysis = {
  materialBatches?: { code: string; batchNo: string | null }[];
  version: number; state: 'pending' | 'confirmed'; category: typeof QUALITY_CAUSES[number];
  detail: string; evidence: string; responsibility: { kind: 'unknown' | 'internal' | 'supplier' | 'other'; id?: string; name: string };
  phenomena: { name: string; count: number }[]; files: QualityFile[];
  references: { source: typeof QUALITY_SOURCES[number]; reference: string; note: string }[];
  confirmedBy?: string; confirmedByName?: string; confirmedAt?: string;
  history: { actorId: string; actorName: string; at: string; action: string; reason: string; snapshot: Omit<QualityAnalysis, 'history'> }[];
};
export const emptyQualityAnalysis = (): QualityAnalysis => ({ version: 0, state: 'pending', category: 'unknown', detail: '', evidence: '', responsibility: { kind: 'unknown', name: '' }, phenomena: [], files: [], references: [], history: [] });
export function qualityText(value: unknown, label: string, max = 4000, optional = false) {
  if (optional && (value === undefined || value === null || value === '')) return '';
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new BadRequestException(`请填写有效的${label}`);
  return value.trim();
}
export function qualityPhenomena(value: unknown) {
  if (!Array.isArray(value) || value.length > 30) throw new BadRequestException('现象明细最多 30 项');
  const seen = new Set<string>();
  return value.map((row: any) => {
    const name = qualityText(row?.name, '现象名称', 100);
    if (seen.has(name.toLowerCase()) || !Number.isSafeInteger(row.count) || row.count < 1 || row.count > 1000000000) throw new BadRequestException('现象名称不能重复，发生次数须为正整数');
    seen.add(name.toLowerCase()); return { name, count: row.count };
  });
}
export async function qualityFiles(db: Prisma.TransactionClient, value: unknown, actor: ProcActor, previous: QualityFile[] = []): Promise<QualityFile[]> {
  if (!Array.isArray(value) || value.length > 20 || value.some(id => typeof id !== 'string') || new Set(value).size !== value.length) throw new BadRequestException('附件最多 20 个，且不能重复');
  if (!value.length) return [];
  const rows = await db.fileAsset.findMany({ where: { id: { in: value }, status: 'active' } });
  return value.map(id => {
    const file = rows.find(row => row.id === id);
    if (!file || (!previous.some(row => row.fileId === id) && (file.uploadedBy !== actor.id || file.businessType !== 'assets'))) throw new ForbiddenException('附件不存在、已删除或不属于本次上传');
    return { fileId: file.id, name: file.fileName, mime: file.mimeType, size: file.fileSize };
  });
}
export async function assertQualityRead(db: Prisma.TransactionClient, id: string, actor: ProcActor) {
  const record = await db.procQualityRecord.findUnique({ where: { id }, include: { treeNode: { select: { name: true } }, supplier: { select: { name: true } }, material: { select: { name: true } }, task: { select: { code: true } }, stockPlan: { select: { code: true } } } });
  if (!record) throw new NotFoundException('质量异常不存在或无权查看');
  const broad = ['*', 'proc-quality:manage', 'proc-quality:verify', 'page:proc-cockpit', 'page:rd-director-dashboard', 'production:plan', 'production:inspect', 'production:view-all'].some(permission => actor.permissions.includes(permission));
  if (!actor.id) throw new ForbiddenException('没有查看质量记录的权限');
  if (!broad) {
    const [source, collaboration] = await Promise.all([
      db.runtimeState.findUnique({ where: { key: `procurement:execution:v1:quality:${id}` } }),
      db.runtimeState.findUnique({ where: { key: `procurement:execution:v1:collaboration:${id}` } }),
    ]);
    const linked = source ? JSON.parse(source.value) : null;
    const stored = linked ? await db.runtimeState.findUnique({ where: { key: `procurement:execution:v1:plan:${linked.planId}` } }) : null;
    const task = stored ? JSON.parse(stored.value).tasks.find((row: any) => row.id === linked.taskId) : null;
    const assigned = collaboration ? JSON.parse(collaboration.value) : null;
    if (!actor.permissions.includes('page:production-execution') || (!task || (task.ownerId !== actor.id && assigned?.ownerId !== actor.id && assigned?.originatorId !== actor.id))) throw new NotFoundException('质量异常不存在或无权查看');
  }
  return record;
}
