import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { rdTransferSnapshotsOf } from './rd-transfer-snapshot';

export const SAMPLE_VALIDATION_KEYS = ['drawing', 'sip', 'sop', 'fixture', 'trial'] as const;
export type SampleValidationKey = typeof SAMPLE_VALIDATION_KEYS[number];
export const SAMPLE_VALIDATION_LABELS = { drawing: '图纸 / 规格', sip: 'SIP 检验规范', sop: 'SOP 作业指导', fixture: '治具依据', trial: '试装 / 小批验证' };
export interface SampleValidationReference {
  id: string; fileName: string; fileKey: string | null; technicalDocumentVersionId: string | null;
  version: string | null; category: string | null; deliveryId: string | null;
}
export interface SampleValidationInput {
  kind: 'exploration' | 'transfer';
  checks: Array<{ key: SampleValidationKey; applicability: 'required' | 'not_applicable'; reason?: string; referenceId?: string; outcome?: 'passed' | 'failed' }>;
}
export interface SampleValidationRecord extends SampleValidationInput {
  checkedAt: string; checkedById: string; checkedByName: string;
  checks: Array<SampleValidationInput['checks'][number] & { reference: SampleValidationReference | null }>;
}

/** Options come from the frozen latest delivery and real task attachments, never a client URL or typed version. */
export function sampleValidationReferences(task: { metadata: Prisma.JsonValue; attachments?: Array<{ id: string; fileName: string; fileKey?: string | null; fileUrl: string; kind?: string }> }): SampleValidationReference[] {
  const delivery = rdTransferSnapshotsOf(task.metadata).at(-1);
  const versions = delivery ? delivery.attachments.flatMap((file, index) => file.fileUrl && file.kind !== 'quote' ? [{
    id: `delivery:${delivery.id}:${index}`, fileName: file.fileName, fileKey: file.fileKey,
    technicalDocumentVersionId: file.technicalDocumentVersionId, version: file.version,
    category: file.category, deliveryId: delivery.id,
  }] : []) : [];
  return [...versions, ...(task.attachments ?? []).filter((file) => file.id && file.fileUrl && file.kind !== 'quote').map((file) => ({
    id: `attachment:${file.id}`, fileName: file.fileName, fileKey: file.fileKey ?? null,
    technicalDocumentVersionId: null, version: null, category: null, deliveryId: null,
  }))];
}

export function confirmSampleValidation(input: SampleValidationInput | undefined, result: string, references: SampleValidationReference[], actor: { id: string; name: string }, checkedAt: string): SampleValidationRecord {
  if (!input || !['exploration', 'transfer'].includes(input.kind)) throw new BadRequestException('请选择研发探索或转产验证；历史未分类记录不能直接确认通过');
  if (!Array.isArray(input.checks) || input.checks.length !== SAMPLE_VALIDATION_KEYS.length
    || new Set(input.checks.map((check) => check.key)).size !== SAMPLE_VALIDATION_KEYS.length
    || input.checks.some((check) => !SAMPLE_VALIDATION_KEYS.includes(check.key))) throw new BadRequestException('请逐项核对图纸、SIP、SOP、治具及试装 / 小批验证');
  const byId = new Map(references.map((reference) => [reference.id, reference]));
  const checks = SAMPLE_VALIDATION_KEYS.map((key) => {
    const check = input.checks.find((row) => row.key === key)!;
    const label = SAMPLE_VALIDATION_LABELS[key];
    if (!['required', 'not_applicable'].includes(check.applicability)) throw new BadRequestException(`${label}适用性无效`);
    const reason = typeof check.reason === 'string' ? check.reason.trim() : '';
    if (reason.length > 500) throw new BadRequestException(`${label}说明不能超过 500 字`);
    const reference = check.referenceId ? byId.get(check.referenceId) : undefined;
    if (check.referenceId && !reference) throw new BadRequestException(`${label}依据已变更或不属于本次交付，请刷新重新核对`);
    if (check.outcome && !['passed', 'failed'].includes(check.outcome)) throw new BadRequestException(`${label}验证结果无效`);
    if (result === 'passed') {
      if (check.applicability === 'not_applicable') {
        if (!reason) throw new BadRequestException(`${label}不适用时必须说明原因`);
        if (input.kind === 'transfer' && key !== 'fixture') throw new BadRequestException(`转产验证必须确认${label}`);
      } else {
        if (!reference) throw new BadRequestException(`请为${label}选择本次依据`);
        if (input.kind === 'transfer' && key !== 'trial' && (!reference.technicalDocumentVersionId || !reference.version)) throw new BadRequestException(`${label}必须选择已登记的固定版本，普通附件不能作为转产受控依据`);
        if (key === 'trial' && (check.outcome !== 'passed' || !reason)) throw new BadRequestException('请填写试装 / 小批验证结果说明并确认通过，保留对应证据');
      }
    }
    return { key, applicability: check.applicability, reason, referenceId: reference?.id,
      ...(check.outcome ? { outcome: check.outcome } : {}), reference: reference ?? null };
  });
  return { kind: input.kind, checks, checkedAt, checkedById: actor.id, checkedByName: actor.name };
}
