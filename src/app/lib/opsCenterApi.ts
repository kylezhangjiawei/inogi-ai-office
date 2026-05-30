import { authFetch, readErrorMessage } from "./authSession";

export type OpsSectionKey = "overview" | "api-errors" | "database" | "services-tasks" | "alerts-audit";

export type OpsCenterSectionData = Record<string, unknown>;

async function request<T>(path: string): Promise<T> {
  const response = await authFetch(path, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, `Request failed: ${response.status}`));
  }

  return response.json() as Promise<T>;
}

const endpointMap: Record<OpsSectionKey, string> = {
  overview: "/api/ops-center/overview",
  "api-errors": "/api/ops-center/api-errors",
  database: "/api/ops-center/database",
  "services-tasks": "/api/ops-center/services-tasks",
  "alerts-audit": "/api/ops-center/alerts-audit",
};

export const opsCenterApi = {
  getSection(section: OpsSectionKey) {
    return request<OpsCenterSectionData>(endpointMap[section]);
  },
};
