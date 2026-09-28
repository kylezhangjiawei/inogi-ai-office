import { authFetch, readErrorMessage } from './authSession';
export type SupplyQualificationStatus = 'pending' | 'approved' | 'suspended' | 'withdrawn';
export interface QualificationEvidence { fileId: string; name: string; objectKey: string; size: number; mime: string }
export interface SupplyQualificationRevision {
  version: number; status: SupplyQualificationStatus; effectiveFrom: string; effectiveUntil: string | null;
  products: Array<{ id: string; name: string }>; reason: string; evidence: QualificationEvidence[];
  actorId: string; actorName: string; at: string;
}
export interface SupplyQualification extends SupplyQualificationRevision {
  id: string; materialId: string; materialName: string; materialCode: string; supplierId: string; supplierName: string;
  history: SupplyQualificationRevision[]; effectiveStatus: string;
}
export interface QualificationDirectory {
  relations: SupplyQualification[];
  materials: Array<{ id: string; name: string; spec: string; tpInventoryCode: string | null; erpCode: string; reviewStatus: string }>;
  suppliers: Array<{ id: string; name: string; tpCode: string | null; enabled: boolean }>;
  products: Array<{ id: string; name: string }>; canRegister: boolean; canReview: boolean;
}
export interface QualificationCommand {
  requestId: string; version: number; materialId: string; supplierId: string; status: SupplyQualificationStatus;
  productIds: string[]; effectiveFrom: string; effectiveUntil?: string; reason: string; evidenceFileIds: string[];
}
const base = '/api/procurement/supplier-qualifications';
async function read<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authFetch(`${base}${path}`, init);
  if (!response.ok) throw new Error(await readErrorMessage(response, '供货关系读取失败'));
  return response.json();
}
export function listSupplyQualifications(materialId?: string, supplierId?: string, signal?: AbortSignal) {
  const query = new URLSearchParams(); if (materialId) query.set('materialId', materialId); if (supplierId) query.set('supplierId', supplierId);
  return read<QualificationDirectory>(`?${query}`, { signal });
}
export function saveSupplyQualification(input: QualificationCommand) { return read<{ id: string }>('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }); }
export function getQualificationEvidence(id: string, fileId: string) { return read<{ id: string; name: string; mime: string; size: number; url: string }>(`/${encodeURIComponent(id)}/files/${encodeURIComponent(fileId)}`); }
