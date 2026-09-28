import { BadRequestException } from '@nestjs/common';
import type { TransferFromRdDto } from './dto/procurement.dto';
import type { RdTransferSnapshotAttachment } from './rd-transfer-snapshot';

/** Formal submission only. Local drafts stay permissive and prior delivery snapshots remain immutable. */
export function assertRdTransferRequirements(dto: TransferFromRdDto, attachments: RdTransferSnapshotAttachment[]) {
  const date = dto.needDate?.trim();
  const validDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (date && !validDay(date)) throw new BadRequestException('需求日期必须为有效的日历日期');
  if (!date && !dto.needDateNotApplicableReason?.trim()) throw new BadRequestException('正式转采购必须填写需求日期，或说明不适用原因');
  if (!dto.unit?.trim() || !Number.isFinite(dto.quantity) || dto.quantity <= 0) throw new BadRequestException('正式转采购必须填写有效的数量和单位');
  const controlledSpecification = attachments.some((file) => file.technicalDocumentVersionId && file.version && ['drawing', 'specification'].includes(file.category || ''));
  if (!dto.spec?.trim() && !controlledSpecification && !dto.specNotApplicableReason?.trim()) throw new BadRequestException('正式转采购必须填写规格、选择受控图纸 / 规格版本，或说明不适用原因');
  for (const value of [dto.needDateNotApplicableReason, dto.specNotApplicableReason]) if (value != null && (typeof value !== 'string' || value.trim().length > 500)) throw new BadRequestException('不适用原因不能超过 500 字');
}
