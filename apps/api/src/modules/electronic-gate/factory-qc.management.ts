import type { FactoryCommand, FactoryProtocolCatalog, FactorySerialConfig } from './factory-qc.contract';

export type FactoryQcKind = 'serial' | 'protocol';
export type FactoryQcActor = { id?: string; name?: string };
export type FactoryQcHistoryEntry = {
  version: string;
  revision: number;
  publishedAt: string;
  publishedBy: string | null;
  reason: string;
};
export type FactoryQcHistoryVersion = FactoryQcHistoryEntry & {
  kind: FactoryQcKind;
  content: FactorySerialConfig | FactoryProtocolCatalog;
};
export type FactoryQcCommandState = {
  profileId: string;
  commandId: string;
  revision: number;
  active: FactoryCommand | null;
  draft: FactoryCommand | null;
};
export type FactoryQcProtocolStatus = {
  revision: number;
  active: FactoryProtocolCatalog | null;
  draft: FactoryProtocolCatalog | null;
  draftBaseVersion: string | null;
  commands: FactoryQcCommandState[];
  history: FactoryQcHistoryEntry[];
};
export type FactoryQcSerialStatus = {
  revision: number;
  active: FactorySerialConfig | null;
  readyCount: number;
  totalCount: number;
  history: FactoryQcHistoryEntry[];
};
export type FactoryQcManagementState = {
  protocol: FactoryQcProtocolStatus;
  serial: FactoryQcSerialStatus;
};
