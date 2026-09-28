import { createHash } from 'node:crypto';
export type MaterialIdentity = { id: string; code: string; unit: string; active: boolean };
export type SourceOrderLine = { id: string; orderId: string; sku: string; name: string; spec: string; unit: string; orderQty: number };
export type MappingEvidence = { fingerprint: string; code: string; unit: string; actorId: string; actorName: string; at: string; reason: string };
const sourceFields = (line: SourceOrderLine) => [line.orderId, line.id, line.sku, line.name, line.spec, line.unit];
export const sourceOrderFingerprint = (line: SourceOrderLine) => createHash('sha256').update(JSON.stringify(sourceFields(line))).digest('hex');
export const mappingFingerprint = (line: SourceOrderLine, material: MaterialIdentity) => createHash('sha256').update(JSON.stringify([...sourceFields(line), material.id, material.code, material.unit, material.active])).digest('hex');
export function exactMaterial(line: SourceOrderLine, candidates: MaterialIdentity[]): MaterialIdentity | null {
  if (!line.sku?.trim() || !line.unit?.trim()) return null;
  const matching = candidates.filter(row => row.code.trim() === line.sku.trim());
  return matching.length === 1 && matching[0].active && matching[0].unit.trim() === line.unit.trim() ? matching[0] : null;
}
