import { addAuthClearedListener, authFetch, getStoredUser } from "./authSession";

const pendingReads = new Map<string, Promise<unknown>>();
const recentReports = new Map<string, number>();
let sessionGeneration = 0;
addAuthClearedListener(() => { sessionGeneration += 1; pendingReads.clear(); recentReports.clear(); });

/** Only concurrent reads are shared. Signed URLs never become permanent client metadata. */
export function requestResourceRefresh<T>(resourceKey: string, loader: () => Promise<T>): Promise<T> {
  const userId = getStoredUser()?.id;
  if (!userId) return Promise.reject(new Error("请重新登录后查看附件"));
  const generation = sessionGeneration;
  const key = `${userId}:${generation}:${resourceKey}`;
  const pending = pendingReads.get(key);
  if (pending) return pending as Promise<T>;
  const request = Promise.resolve().then(loader).then((result) => {
    if (generation !== sessionGeneration || getStoredUser()?.id !== userId) {
      throw new Error("登录状态已变更，请重新打开附件");
    }
    return result;
  }).finally(() => {
    if (pendingReads.get(key) === request) pendingReads.delete(key);
  });
  pendingReads.set(key, request);
  return request;
}

/** Fixed fields only: never log a URL, object key, server error body or credential. */
export function reportResourceFailure(stage: "load" | "renew" | "download", status?: number): void {
  if (!["load", "renew", "download"].includes(stage)) return;
  const detail = { stage, ...(Number.isInteger(status) && status! >= 100 && status! <= 599 ? { status } : {}) };
  console.warn("[resource-access]", detail);
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("resource-access-failure", { detail }));
  const userId = getStoredUser()?.id;
  if (!userId) return;
  const now = Date.now();
  const key = `${userId}:${stage}`;
  if (now - (recentReports.get(key) ?? -Infinity) < 60_000) return;
  for (const [entry, at] of recentReports) if (now - at >= 60_000) recentReports.delete(entry);
  if (recentReports.size >= 256) recentReports.clear();
  recentReports.set(key, now);
  // Telemetry is best effort and never retries recursively or delays image recovery.
  void authFetch("/api/files/access-failures", { method: "POST", body: JSON.stringify(detail) }).catch(() => undefined);
}

/** For the uploader's own draft files; shared business attachments use their business read API. */
export function refreshFileReadUrl(fileId: string): Promise<string> {
  return requestResourceRefresh(`file:${fileId}`, async () => {
    const response = await authFetch(`/api/files/${encodeURIComponent(fileId)}/signed-url`, { cache: "no-store" });
    if (!response.ok) {
      reportResourceFailure("renew", response.status);
      throw new Error("无法获取附件地址，请确认查看权限后重试");
    }
    const data = await response.json() as { signedUrl?: string };
    if (!data.signedUrl) throw new Error("附件地址不可用");
    return data.signedUrl;
  });
}

/** Refresh at the user action, then download original bytes. Never send app credentials to storage. */
export async function downloadResource(url: string, name: string, refresh?: () => Promise<string>): Promise<void> {
  const userId = getStoredUser()?.id;
  const generation = sessionGeneration;
  try {
    let source = refresh ? await refresh() : url;
    let response = await fetch(source);
    if ((response.status === 401 || response.status === 403) && refresh) {
      await response.body?.cancel();
      source = await refresh();
      response = await fetch(source);
    }
    if (!response.ok) {
      reportResourceFailure("download", response.status);
      throw new Error("附件下载失败，请稍后重试");
    }
    // Large videos/archives should use the browser download manager, not a full in-memory Blob.
    const contentLength = Number(response.headers.get("content-length"));
    const contentType = response.headers.get("content-type") ?? "";
    if (contentLength > 32 * 1024 * 1024 || (!contentLength && /^(video|audio)\//.test(contentType))) {
      await response.body?.cancel();
      if (getStoredUser()?.id !== userId || generation !== sessionGeneration) throw new Error("登录状态已变更");
      const link = document.createElement("a");
      link.href = response.url || source;
      link.download = name;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      document.body.appendChild(link);
      link.click();
      link.remove();
      return;
    }
    const blob = await response.blob();
    if (getStoredUser()?.id !== userId || generation !== sessionGeneration) throw new Error("登录状态已变更");
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  } catch {
    reportResourceFailure("download");
    throw new Error("附件下载失败，请稍后重试");
  }
}
