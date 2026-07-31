import { authFetch, readErrorMessage } from "./authSession";

export type ResourceBusinessType =
  | "assets"
  | "content-slots-static"
  | "employee-archive/badge-avatar"
  | "issue/attachments"
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
    try {
      const response = await fetch(presign.putUrl, {
        method: "PUT",
        body: file,
        headers: {
          "Content-Type": presign.contentType,
          "Cache-Control": presign.cacheControl,
        },
        signal,
      });
      if (response.ok) return;
      if (!RETRYABLE_STATUS.has(response.status)) {
        throw new Error(`OSS 上传失败（HTTP ${response.status}）`);
      }
      lastError = new Error(`OSS 上传暂时不可用（HTTP ${response.status}）`);
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error instanceof Error ? error : new Error("OSS 上传失败");
    }
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
