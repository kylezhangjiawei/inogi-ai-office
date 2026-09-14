export type ArchiveTab = 'overview' | 'versions' | 'production' | 'inspections' | 'exceptions' | 'materials' | 'shipments';
export type ArchiveDocumentKind = 'dispatch' | 'production' | 'inspection' | 'reinspection' | 'release' | 'exception' | 'issue' | 'return' | 'shipment' | 'ecn' | 'technical';
export interface ArchiveDocument {
  id: string; code: string; kind: ArchiveDocumentKind; date: string; title: string;
  status: string; tone: 'neutral' | 'success' | 'warning'; quantity: number | null; unit: string;
  actor: string; summary: string; facts: { label: string; value: string }[];
  serialNumbers: string[]; relatedIds: string[];
}
export interface ArchiveVersions { software: string; hardware: string; bom: string; drawing: string; sop: string; sip: string }
export interface ArchiveVersionScope {
  id: string; name: string; quantity: number; versions: ArchiveVersions; serialNumbers: string[]; evidenceIds: string[];
}
export interface ArchiveMaterial {
  id: string; code: string; name: string; spec: string; supplier: string; materialBatch: string;
  unit: string; perUnitQty: number | null; issuedQty: number; returnedQty: number;
  serialNumbers: string[]; sourceDocumentIds: string[];
}
export interface BatchArchive {
  id: string; batchNo: string; planNo: string; productCode: string; productName: string;
  line: string; owner: string; startDate: string; plannedQty: number; completedQty: number;
  inspectionPassedQty: number; releasedQty: number; sourceLabel: string; sourceAt: string;
  versionScopes: ArchiveVersionScope[]; serials: { sn: string; sourceDocumentId: string }[];
  documents: ArchiveDocument[]; materials: ArchiveMaterial[];
}
export interface ArchiveRevision {
  id: string; batchId: string; scopeId: string; actor: string; at: string; reason: string;
  before: ArchiveVersionScope[]; after: ArchiveVersionScope[];
}
export interface BatchArchiveState { version: number; batches: BatchArchive[]; revisions: ArchiveRevision[] }
export interface VersionAmendment {
  scopeId?: string; name: string; quantity: number; versions: ArchiveVersions;
  serialNumbers: string[]; evidenceIds: string[]; actor: string; reason: string;
}
export const archiveTabLabels: Record<ArchiveTab, string> = {
  overview: '基本资料', versions: '版本与物料', production: '工序与报工', inspections: '检验复验', exceptions: '不良处置', materials: '领退料', shipments: '出货记录',
};
export const archiveDocumentLabels: Record<ArchiveDocumentKind, string> = {
  dispatch: '派工', production: '报工', inspection: '检验', reinspection: '复验', release: '质量放行', exception: '不良处置', issue: '领料', return: '退料', shipment: '实际出货', ecn: 'ECN 变更', technical: '技术资料',
};
export const archiveVersionLabels: Record<keyof ArchiveVersions, string> = { software: '软件版本', hardware: '硬件版本', bom: 'BOM 版本', drawing: '图纸版本', sop: 'SOP 版本', sip: 'SIP 版本' };
