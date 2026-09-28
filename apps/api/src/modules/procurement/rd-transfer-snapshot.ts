import type { Prisma } from '@prisma/client';
import type { TransferFromRdDto } from './dto/procurement.dto';
import type { ProcActor } from './procurement.types';

export interface RdTransferSnapshotAttachment {
  fileName: string;
  fileUrl: string;
  fileKey: string | null;
  fileSize: number;
  mimeType: string | null;
  kind: string;
  technicalDocumentVersionId: string | null;
  documentId: string | null;
  version: string | null;
  category: string | null;
  title: string | null;
  attachmentId: string | null;
  sourceNoteId: string | null;
  versionCreatedAt: string | null;
}

export interface RdTransferSnapshot {
  id: string;
  submittedAt: string;
  submittedBy: string;
  submittedByName: string;
  rdTaskId: string;
  rdTaskTitle: string;
  requirement: {
    productId: string; materialName: string; spec: string; unit: string; quantity: number;
    needDateNotApplicableReason?: string | null; specNotApplicableReason?: string | null;
    purchaseLink: string | null; needDate: string | null; deadline: string | null; note: string | null;
  };
  attachments: RdTransferSnapshotAttachment[];
}

export function appendRdTransferSnapshot(
  metadata: Prisma.JsonValue | undefined,
  dto: TransferFromRdDto,
  actor: ProcActor,
  taskTitle: string,
  attachments: RdTransferSnapshotAttachment[],
  identity: { id: string; submittedAt: string },
): Prisma.InputJsonObject {
  const previous = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
  const history = Array.isArray(previous.rdTransferSnapshots) ? previous.rdTransferSnapshots : [];
  const snapshot: RdTransferSnapshot = {
    ...identity, submittedBy: actor.id, submittedByName: actor.name,
    rdTaskId: dto.rdTaskId.trim(), rdTaskTitle: taskTitle,
    requirement: {
      productId: dto.productId || 'prod-portable-o2', materialName: dto.materialName,
      needDateNotApplicableReason: dto.needDateNotApplicableReason?.trim() || null, specNotApplicableReason: dto.specNotApplicableReason?.trim() || null,
      spec: dto.spec ?? '', unit: dto.unit ?? '', quantity: dto.quantity,
      purchaseLink: dto.purchaseLink ?? null, needDate: dto.needDate ?? null,
      deadline: dto.deadline ?? null, note: dto.consumableNote ?? null,
    },
    attachments,
  };
  // A resubmission appends a new requirement; unrelated state (including sampleTest) is retained.
  return { ...previous, rdTransferSnapshots: [...history, snapshot] } as unknown as Prisma.InputJsonObject;
}

export function rdTransferSnapshotsOf(metadata: Prisma.JsonValue | undefined): RdTransferSnapshot[] {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return [];
  if (!Array.isArray(metadata.rdTransferSnapshots)) return [];
  return metadata.rdTransferSnapshots.filter((value) => value && typeof value === 'object'
    && !Array.isArray(value) && typeof value.id === 'string' && Array.isArray(value.attachments)) as unknown as RdTransferSnapshot[];
}
