import { authFetch, readErrorMessage } from "./authSession";

export type ResourceBusinessType =
  | "assets"
  | "content-slots-static"
  | "employee-archive/badge-avatar"
  | "issue/attachments"
  | "library/images"
  | "library/videos"
  | "uploads-temp";

export type ResourceUploadResult = {
  fileId: string;
  objectKey: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  signedUrl: string | null;
  expiresIn: number;
};

type PresignUploadResult = {
  objectKey: string;
  putUrl: string;
  contentType: string;
  cacheControl: string;
};

export type ResourceUploadOptions = {
  businessId?: string;
  signal?: AbortSignal;
  /** Keep compatibility while an older backend version is still rolling out. */
  allowLegacyFallback?: boolean;
};

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * 服务端中转兜底的大小上限：中转要把整个文件读进 API 进程内存，几百 MB 的片源不能这么走。
 * 超过这个大小的直传失败会如实报错，提示去修 Bucket CORS。
 */
const LEGACY_FALLBACK_MAX_BYTES = 25 * 1024 * 1024;

/**
 * 直传被拦在网络层时抛出：fetch 直接 reject（没有 HTTP 响应），
 * 最常见的原因是 Bucket 的 CORS 没放行当前域名，其次是断网 / DNS 失败。
 * 与「拿到了 HTTP 错误码」区分开，调用方据此决定是否退回服务端中转。
 */
class DirectPutNetworkError extends Error {
  constructor(reason: string) {
    super(`直传 OSS 失败（可能是 Bucket 未放行当前域名的 CORS 规则）：${reason}`);
    this.name = "DirectPutNetworkError";
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        reject(new DOMException("Upload aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

async function putToOss(
  file: File,
  presign: PresignUploadResult,
  signal?: AbortSignal,
): Promise<void> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(presign.putUrl, {
        method: "PUT",
        body: file,
        headers: {
          "Content-Type": presign.contentType,
          "Cache-Control": presign.cacheControl,
        },
        signal,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      // fetch 直接 reject：连 HTTP 响应都没拿到，单独标记出来供上层判断是否中转
      lastError = new DirectPutNetworkError(error instanceof Error ? error.message : "网络错误");
      if (attempt < 2) await delay(500 * 2 ** attempt, signal);
      continue;
    }

    if (response.ok) return;
    if (!RETRYABLE_STATUS.has(response.status)) {
      throw new Error(`OSS 上传失败（HTTP ${response.status}）`);
    }
    lastError = new Error(`OSS 上传暂时不可用（HTTP ${response.status}）`);
    if (attempt < 2) await delay(500 * 2 ** attempt, signal);
  }
  throw lastError ?? new Error("OSS 上传失败");
}

async function legacyUpload(
  file: File,
  businessType: ResourceBusinessType,
  businessId?: string,
): Promise<ResourceUploadResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("businessType", businessType);
  if (businessId) form.append("businessId", businessId);
  const response = await authFetch("/api/files/upload", { method: "POST", body: form });
  if (!response.ok) throw new Error(await readErrorMessage(response, "上传失败"));
  return (await response.json()) as ResourceUploadResult;
}

async function abortUnregisteredUpload(objectKey: string, businessType: ResourceBusinessType) {
  await authFetch("/api/files/abort-upload", {
    method: "POST",
    body: JSON.stringify({ objectKey, businessType }),
  }).catch(() => undefined);
}

/**
 * Shared immutable-resource upload path:
 * browser -> OSS, then a lightweight metadata registration request to the API.
 * Processing uploads (OCR, parsing, AI inputs) intentionally do not use this helper.
 */
export async function uploadResourceFile(
  file: File,
  businessType: ResourceBusinessType,
  options: ResourceUploadOptions = {},
): Promise<ResourceUploadResult> {
  const descriptor = {
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    fileSize: file.size,
    businessType,
    ...(options.businessId ? { businessId: options.businessId } : {}),
  };
  const presignResponse = await authFetch("/api/files/presign-upload", {
    method: "POST",
    body: JSON.stringify(descriptor),
    signal: options.signal,
  });

  if (!presignResponse.ok) {
    if (
      options.allowLegacyFallback !== false
      && [404, 405, 501].includes(presignResponse.status)
    ) {
      return legacyUpload(file, businessType, options.businessId);
    }
    throw new Error(await readErrorMessage(presignResponse, "获取上传地址失败"));
  }

  const presign = (await presignResponse.json()) as PresignUploadResult;
  try {
    await putToOss(file, presign, options.signal);
  } catch (error) {
    await abortUnregisteredUpload(presign.objectKey, businessType);
    // 直传被拦在网络层时退回服务端中转：本地开发、或新域名上线当天 Bucket CORS 还没放行，
    // 功能不至于整个不可用。中转要吃 API 进程内存，所以只对小文件兜底。
    if (
      options.allowLegacyFallback !== false
      && error instanceof DirectPutNetworkError
      && file.size <= LEGACY_FALLBACK_MAX_BYTES
    ) {
      console.warn(
        `[upload] 直传 OSS 失败，改走服务端中转上传；请检查 Bucket CORS 是否放行 ${window.location.origin}`,
        error,
      );
      return legacyUpload(file, businessType, options.businessId);
    }
    throw error;
  }

  const registerResponse = await authFetch("/api/files/register-upload", {
    method: "POST",
    body: JSON.stringify({ ...descriptor, objectKey: presign.objectKey }),
  });
  if (!registerResponse.ok) {
    throw new Error(await readErrorMessage(registerResponse, "登记上传文件失败"));
  }
  return (await registerResponse.json()) as ResourceUploadResult;
}
