import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { type UploadReceipt, type RecordSummary, type RecordPage, type UploadEnvelope, type RecordQuery, type ItemSummary, type InspectionResult, type JsonObject, itemSummaries, optionalText, parseDate, uploadHash, validateUpload, verifiedUid } from './device-inspection-records.contract';

const SUMMARY_SELECT = {
  id: true, clientId: true, testId: true, collectionAt: true, saveAt: true, receivedAt: true,
  uid: true, uidVerified: true, serialNumber: true, model: true, market: true, station: true, operator: true,
  firmwareVersion: true, recordAppVersion: true, uploaderAppVersion: true,
  inspectionResult: true, productionPass: true, itemCount: true, abnormalCount: true, pendingCount: true,
  abnormalItems: true, ruleVersion: true, protocolVersion: true,
} satisfies Prisma.DeviceInspectionRecordSelect;
type SummaryRow = Prisma.DeviceInspectionRecordGetPayload<{ select: typeof SUMMARY_SELECT }>;
const iso = (date: Date | null) => date?.toISOString() ?? null;
export function summarize(row: SummaryRow): RecordSummary {
  const selected = Object.fromEntries(Object.keys(SUMMARY_SELECT).map(key => [key, row[key as keyof SummaryRow]])) as SummaryRow;
  return { ...selected, collectionAt: row.collectionAt.toISOString(), saveAt: iso(row.saveAt), receivedAt: row.receivedAt.toISOString(),
    uidShort: row.uid?.slice(-8) ?? null, inspectionResult: row.inspectionResult as InspectionResult,
    abnormalItems: row.abnormalItems as unknown as ItemSummary[] };
}
function firmware(snapshot: JsonObject): string | null {
  const row = Array.isArray(snapshot.protocolReadings) ? snapshot.protocolReadings.find((r: any) => r?.id === 'firmware' && r.status === 'received') : null;
  const fields = Array.isArray(row?.fields) ? row.fields : [];
  const main = fields.find((f: any) => f?.id === 'main')?.value, sub = fields.find((f: any) => f?.id === 'sub')?.value;
  if (typeof main === 'string') return `${main}${typeof sub === 'string' ? ` / ${sub}` : ''}`.slice(0, 512);
  const value = snapshot.items.find((item: any) => item.id === 'QC-003')?.measuredValue;
  return typeof value === 'string' ? value.slice(0, 512) : null;
}
function receipt(row: { id: string; testId: string; payloadHash: string; receivedAt: Date }, duplicate: boolean): UploadReceipt {
  return { recordId: row.id, testId: row.testId, payloadHash: row.payloadHash, receivedAt: row.receivedAt.toISOString(), duplicate };
}

@Injectable()
export class DeviceInspectionRecordsService {
  constructor(private readonly prisma: PrismaService) {}

  async upload(input: unknown): Promise<UploadReceipt> {
    const envelope = validateUpload(input), hash = uploadHash(envelope);
    const unique = { clientId_testId: { clientId: envelope.source.clientId, testId: envelope.snapshot.testId } };
    const existing = await this.prisma.deviceInspectionRecord.findUnique({ where: unique });
    if (existing) return this.existingReceipt(existing, hash);
    const snapshot = envelope.snapshot, items = itemSummaries(envelope);
    const collectionAt = parseDate(snapshot.protocolReadAt || snapshot.endedAt || snapshot.startedAt, '采集时间');
    const sourceText = (key: string) => optionalText(snapshot.identity[key], `identity.${key}`) ?? '';
    try {
      const row = await this.prisma.deviceInspectionRecord.create({ data: {
        contractVersion: 1, snapshotSchema: envelope.snapshotSchema,
        clientId: envelope.source.clientId, testId: snapshot.testId,
        uploaderAppVersion: envelope.source.uploaderAppVersion, recordAppVersion: envelope.source.recordAppVersion,
        payloadHash: hash, snapshot: snapshot as Prisma.InputJsonValue,
        resultProjection: envelope.resultProjection as unknown as Prisma.InputJsonValue,
        collectionAt, saveAt: snapshot.savedAt ? parseDate(snapshot.savedAt, '保存时间') : null,
        ...verifiedUid(snapshot), serialNumber: sourceText('serialNumber'), model: sourceText('model'), market: sourceText('market'),
        station: sourceText('station'), operator: sourceText('operator'), firmwareVersion: firmware(snapshot),
        ruleVersion: optionalText(snapshot.qcRulesSnapshot?.version ?? snapshot.ruleVersion, 'ruleVersion'),
        protocolVersion: optionalText(snapshot.protocolVersion, 'protocolVersion'),
        inspectionResult: envelope.resultProjection.inspectionResult, productionPass: snapshot.productionPass,
        itemCount: items.all.length, abnormalCount: items.abnormal.length, pendingCount: items.pendingCount,
        abnormalItems: items.abnormal as unknown as Prisma.InputJsonValue,
        itemIds: items.all.map(item => item.id), readStatuses: [...new Set(items.all.map(item => item.readStatus))],
        itemStatusKeys: items.all.map(item => JSON.stringify([item.id, item.readStatus])),
        abnormalItemIds: items.abnormal.map(item => item.id), abnormalReadStatuses: [...new Set(items.abnormal.map(item => item.readStatus))],
      } });
      return receipt(row, false);
    } catch (error) {
      // The database unique key resolves concurrent requests across server instances.
      if ((error as { code?: string }).code !== 'P2002') throw error;
      const winner = await this.prisma.deviceInspectionRecord.findUnique({ where: unique });
      if (!winner) throw error;
      return this.existingReceipt(winner, hash);
    }
  }
  private existingReceipt(row: { id: string; testId: string; payloadHash: string; receivedAt: Date }, hash: string) {
    if (row.payloadHash !== hash) throw new ConflictException('同一客户端检测编号已有不同内容，原记录未修改；复检请使用新的检测编号');
    return receipt(row, true);
  }
  async list(query: RecordQuery): Promise<RecordPage> {
    const where = this.where(query);
    return this.page(where, query);
  }
  private where(query: RecordQuery): Prisma.DeviceInspectionRecordWhereInput {
    const where: Prisma.DeviceInspectionRecordWhereInput = {};
    if (query.from || query.to) where.collectionAt = { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) };
    if (query.result) where.inspectionResult = query.result;
    if (query.abnormalOnly) where.abnormalCount = { gt: 0 };
    if (query.search) where.OR = ['testId', 'uid', 'serialNumber', 'model', 'station', 'operator'].map(key => ({ [key]: { contains: query.search, mode: 'insensitive' } }));
    if (query.itemId) where.itemIds = { has: query.itemId };
    if (query.readStatus) where.readStatuses = { has: query.readStatus };
    // Paired filters must apply to the same item, not two unrelated rows in a snapshot.
    if (query.itemId && query.readStatus) where.itemStatusKeys = { has: JSON.stringify([query.itemId, query.readStatus]) };
    if (query.abnormalOnly && query.itemId) where.abnormalItemIds = { has: query.itemId };
    if (query.abnormalOnly && query.readStatus) where.abnormalReadStatuses = { has: query.readStatus };
    return where;
  }
  private async page(where: Prisma.DeviceInspectionRecordWhereInput, query: Pick<RecordQuery, 'page' | 'pageSize'>): Promise<RecordPage> {
    // Count and rows share one database snapshot; no full snapshot JSON in list queries.
    return this.prisma.$transaction(async tx => {
      const total = await tx.deviceInspectionRecord.count({ where });
      const items = await tx.deviceInspectionRecord.findMany({ where, select: SUMMARY_SELECT,
        orderBy: [{ collectionAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize });
      return { items: items.map(summarize), total, page: query.page, pageSize: query.pageSize };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
  async detail(id: string) {
    const row = await this.prisma.deviceInspectionRecord.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('检测记录不存在');
    const summary = summarize(row);
    // Explicit response shape keeps database-only search indexes out of the API.
    return { ...summary, contractVersion: row.contractVersion, snapshotSchema: row.snapshotSchema,
      snapshot: row.snapshot, resultProjection: row.resultProjection, payloadHash: row.payloadHash };
  }
  async history(id: string, query: Pick<RecordQuery, 'page' | 'pageSize'>) {
    const record = await this.prisma.deviceInspectionRecord.findUnique({ where: { id }, select: { uid: true, uidVerified: true } });
    if (!record) throw new NotFoundException('检测记录不存在');
    if (!record.uidVerified || !record.uid) return { items: [], total: 0, ...query, deviceUid: null, available: false, reason: '本次记录缺少通过CRC校验的完整UID，不能可靠关联同一设备' };
    return { ...await this.page({ uid: record.uid, uidVerified: true }, query), deviceUid: record.uid, available: true, reason: null };
  }
}
