import { authFetch, readErrorMessage } from "./authSession";
import { recordQueryString, type DeviceInspectionRecordsApi } from "./deviceInspectionRecords";
const BASE = "/api/device-inspection-records";
async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await authFetch(`${BASE}${path}`, { signal });
  if (!response.ok) throw new Error(await readErrorMessage(response,
    response.status === 403 ? "暂无设备检测记录的查看权限。" : "记录读取失败，请稍后重试。"));
  return response.json();
}
export const deviceInspectionRecordsApi: DeviceInspectionRecordsApi = {
  list: (query, signal) => request(`?${recordQueryString(query)}`, signal),
  detail: (id, signal) => request(`/${encodeURIComponent(id)}`, signal),
  history: (id, page = 1, pageSize = 25, signal) => request(`/${encodeURIComponent(id)}/history?page=${page}&pageSize=${pageSize}`, signal),
};
