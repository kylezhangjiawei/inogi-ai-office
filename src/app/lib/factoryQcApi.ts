import { authFetch, readErrorMessage } from "./authSession";
import type { FactoryCommand } from "../../../apps/api/src/modules/electronic-gate/factory-qc.contract";
import type { FactoryQcHistoryVersion, FactoryQcKind, FactoryQcManagementState } from "../../../apps/api/src/modules/electronic-gate/factory-qc.management";

export type { FactoryCommand, FactoryField, FactorySample, FactoryProfile, FactoryProtocolCatalog, FactorySerialConfig } from "../../../apps/api/src/modules/electronic-gate/factory-qc.contract";
export type { FactoryQcHistoryEntry, FactoryQcHistoryVersion, FactoryQcKind, FactoryQcManagementState, FactoryQcCommandState, FactoryQcSerialStatus } from "../../../apps/api/src/modules/electronic-gate/factory-qc.management";

export interface FactoryQcApi {
  getState(): Promise<FactoryQcManagementState>;
  saveCatalogDraft(expectedRevision: number, json: string): Promise<FactoryQcManagementState>;
  publishCatalog(expectedRevision: number): Promise<FactoryQcManagementState>;
  saveCommandDraft(profileId: string, commandId: string, expectedRevision: number, command: FactoryCommand): Promise<FactoryQcManagementState>;
  publishCommand(profileId: string, commandId: string, expectedRevision: number): Promise<FactoryQcManagementState>;
  getHistory(kind: FactoryQcKind, version: string): Promise<FactoryQcHistoryVersion>;
  rollback(kind: FactoryQcKind, version: string, expectedRevision: number): Promise<FactoryQcManagementState>;
}

export class FactoryQcApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
const BASE = "/api/electronic-gate/factory-qc";
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authFetch(`${BASE}${path}`, init);
  if (!response.ok) throw new FactoryQcApiError(await readErrorMessage(response, "协议配置请求失败，请稍后重试。"), response.status);
  return response.json();
}
const body = (method: string, data: unknown): RequestInit => ({ method, body: JSON.stringify(data) });
const commandPath = (profileId: string, commandId: string) => `/commands/${encodeURIComponent(profileId)}/${encodeURIComponent(commandId)}`;
export const factoryQcApi: FactoryQcApi = {
  getState: () => request(""),
  saveCatalogDraft: (expectedRevision, json) => request("/protocol/draft", body("PUT", { expectedRevision, json })),
  publishCatalog: expectedRevision => request("/protocol/publish", body("POST", { expectedRevision })),
  saveCommandDraft: (profileId, commandId, expectedRevision, command) => request(`${commandPath(profileId, commandId)}/draft`, body("PUT", { expectedRevision, command })),
  publishCommand: (profileId, commandId, expectedRevision) => request(`${commandPath(profileId, commandId)}/publish`, body("POST", { expectedRevision })),
  getHistory: (kind, version) => request(`/history/${encodeURIComponent(version)}?kind=${kind}`),
  rollback: (kind, version, expectedRevision) => request("/rollback", body("POST", { kind, version, expectedRevision })),
};
