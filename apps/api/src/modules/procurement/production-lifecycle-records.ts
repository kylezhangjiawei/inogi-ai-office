import { BadRequestException, ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { executionQty, executionText } from './production-execution.model';
import { rdTransferSnapshotsOf } from './rd-transfer-snapshot';

export type ControlledDocument = { kind: 'sop' | 'sip' | 'drawing'; documentId: string; versionId: string; attachmentId: string; fileId?: string; name: string; version: string };
export type DocumentOption = Omit<ControlledDocument, 'kind'>;
export type EcnFeedback = { id: string; problem: string; reporterId: string; reporterName: string; at: string; ownerId: string; ownerName: string; dueDate: string; status: 'open' | 'processing' | 'resolved'; history: { actorId: string; actorName: string; at: string; status: EcnFeedback['status']; ownerId: string; ownerName: string; dueDate: string; reason: string }[] };
export type BatchVersionRange = { id: string; batchId: string; quantity: number; range: string; softwareVersion: string; hardwareVersion: string; serialNumbers: string[]; actorId: string; actorName: string; at: string; evidence: string; supersedesId?: string };
export const activeVersionRanges = (rows: BatchVersionRange[]) => rows.filter(row => !rows.some(other => other.supersedesId === row.id));

export async function documentOptions(db: Prisma.TransactionClient, metadata: Prisma.JsonValue | undefined): Promise<DocumentOption[]> {
  const allowed = rdTransferSnapshotsOf(metadata).flatMap(snapshot => snapshot.attachments.flatMap(file => file.technicalDocumentVersionId && file.documentId ? [{ id: file.technicalDocumentVersionId, documentId: file.documentId, taskId: snapshot.rdTaskId }] : []));
  if (!allowed.length) return [];
  const versions = await db.rdTechnicalDocumentVersion.findMany({ where: { id: { in: [...new Set(allowed.map(row => row.id))] } }, include: { document: true } });
  return versions.filter(version => allowed.some(ref => ref.id === version.id && ref.documentId === version.documentId && ref.taskId === version.document.taskId) && version.attachmentId && version.version && (version.fileKey || version.fileUrl)).map(version => ({ documentId: version.documentId, versionId: version.id, attachmentId: version.attachmentId, name: version.fileName, version: version.version }));
}

export async function resolveControlledDocuments(db: Prisma.TransactionClient, metadata: Prisma.JsonValue | undefined, value: unknown, required: boolean): Promise<ControlledDocument[]> {
  if (value == null && !required) return [];
  if (!Array.isArray(value) || value.length !== 3) throw new BadRequestException('请选择 SOP、SIP、图纸 / BOM 三项受控文件版本');
  const options = await documentOptions(db, metadata), kinds = new Set<string>();
  return value.map(input => {
    const row = input as Partial<ControlledDocument>;
    if (!row || !['sop', 'sip', 'drawing'].includes(String(row.kind)) || kinds.has(row.kind!)) throw new BadRequestException('受控文件类型缺失或重复');
    kinds.add(row.kind!);
    const document = options.find(option => option.versionId === row.versionId);
    if (!document) throw new BadRequestException('所选版本不属于该样品已交付的受控资料，请重新核对');
    return { ...document, kind: row.kind! };
  });
}

export async function verifyControlledFiles(db: Prisma.TransactionClient, documents: ControlledDocument[] | undefined) {
  if (!documents || documents.length !== 3 || new Set(documents.map(row => row.kind)).size !== 3) throw new ConflictException('缺少 SOP / SIP / 图纸受控文件版本；请建立新资料包后独立验证');
  const versions = await db.rdTechnicalDocumentVersion.findMany({ where: { id: { in: [...new Set(documents.map(row => row.versionId))] } } });
  for (const doc of documents) {
    const version = versions.find(row => row.id === doc.versionId);
    if (!version || version.documentId !== doc.documentId || version.attachmentId !== doc.attachmentId || version.version !== doc.version || !(version.fileKey || version.fileUrl)) throw new ConflictException('受控文件版本不可用，请重新核对');
    if (version.fileKey) {
      const asset = await db.fileAsset.findUnique({ where: { objectKey: version.fileKey } });
      if (asset && (asset.deletedAt || asset.status !== 'active')) throw new ConflictException('受控文件已停用，请重新核对');
      if (asset) doc.fileId = asset.id;
    }
  }
}

export function versionRangeValues(value: Record<string, unknown>, batch: { id: string; quantity: number }, records: BatchVersionRange[]) {
  const quantity = executionQty(value.quantity, '适用数量', true, true), range = executionText(value.range, '适用范围说明', 500);
  const optionalVersion = (entry: unknown, label: string) => entry == null || entry === '' ? '' : executionText(entry, label, 120);
  const softwareVersion = optionalVersion(value.softwareVersion, '软件版本'), hardwareVersion = optionalVersion(value.hardwareVersion, '硬件版本');
  if (!Array.isArray(value.serialNumbers) || value.serialNumbers.length > 10000) throw new BadRequestException('已有 SN 清单格式无效');
  const serialNumbers = value.serialNumbers.map(item => executionText(item, '已有 SN', 120));
  const canonical = (serial: string) => serial.normalize('NFKC').toUpperCase();
  if (new Set(serialNumbers.map(canonical)).size !== serialNumbers.length || serialNumbers.length > quantity) throw new BadRequestException('已有 SN 不能重复或超过本段适用数量');
  const active = activeVersionRanges(records), previous = value.supersedesId ? active.find(row => row.id === value.supersedesId && row.batchId === batch.id) : undefined;
  if (value.supersedesId && !previous) throw new ConflictException('原版本范围已被更正或不属于该批次');
  const other = active.filter(row => row.id !== previous?.id);
  if (quantity + other.filter(row => row.batchId === batch.id).reduce((sum, row) => sum + row.quantity, 0) > batch.quantity) throw new ConflictException('版本适用数量合计不能超过批次数量');
  const used = new Set(other.flatMap(row => row.serialNumbers.map(canonical)));
  if (serialNumbers.some(serial => used.has(canonical(serial)))) throw new ConflictException('该已有 SN 已属于其他有效版本范围');
  return { batchId: batch.id, quantity, range, softwareVersion, hardwareVersion, serialNumbers, ...(previous ? { supersedesId: previous.id } : {}) };
}
