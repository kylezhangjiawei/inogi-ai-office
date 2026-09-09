import { authFetch, readErrorMessage } from "./authSession";

export type GateCategory = "critical" | "routine" | "manual" | "connection" | "command";
export interface GateConfig {
  enabled: boolean;
  model: string;
  market: string;
  displayName: string;
  helpText: string;
  values: Record<string, string>;
  failureAction: "block" | "warn";
}
export interface GateField {
  key: string;
  label: string;
  type: "text" | "number" | "select" | "textarea";
  unit?: string;
  options?: { value: string; label: string }[];
  required?: boolean;
  help?: string;
  min?: number;
  max?: number;
  integer?: boolean;
  precision?: number;
  allowNegative?: boolean;
}
export interface GateItem {
  id: string;
  number: string;
  title: string;
  category: GateCategory;
  description: string;
  fields: GateField[];
  defaults: GateConfig;
  draft: GateConfig | null;
  active: GateConfig | null;
  revision: number;
  updatedAt: string | null;
  updatedBy: string | null;
  publishedAt: string | null;
}
export interface ElectronicGateApi {
  list(): Promise<{ items: GateItem[] }>;
  saveDraft(id: string, expectedRevision: number, draft: GateConfig): Promise<GateItem>;
  publish(id: string, expectedRevision: number): Promise<GateItem>;
}
export class GateApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authFetch(`/api/electronic-gate${path}`, init);
  if (!response.ok) throw new GateApiError(await readErrorMessage(response, "电子闸门配置请求失败，请稍后重试。"), response.status);
  return response.json();
}
export const electronicGateApi: ElectronicGateApi = {
  list: () => request(""),
  saveDraft: (id, expectedRevision, draft) => request(`/${encodeURIComponent(id)}/draft`, {
    method: "PUT", body: JSON.stringify({ expectedRevision, draft }),
  }),
  publish: (id, expectedRevision) => request(`/${encodeURIComponent(id)}/publish`, {
    method: "POST", body: JSON.stringify({ expectedRevision }),
  }),
};
