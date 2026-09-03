export type AuthUser = {
  id: string;
  name: string;
  englishName: string;
  username: string | null;
  email: string;
  roleId: string | null;
  roleName: string | null;
  permissions: string[];
  /** 所属部门名称（费用等模块按部门隔离时展示用，可能为空）。 */
  department?: string | null;
  /** 部门稳定标识（数据隔离依据；解析不到为空）。 */
  departmentCode?: string | null;
  /** OSS 签名 URL（30 天 TTL）。无自定义头像时为按 user_id 派发的默认预置头像，仅 OSS 未配置时才为 null */
  avatarUrl: string | null;
  /** 是否设过自定义头像。false 表示当前是自动派发的默认头像（个人中心据此决定是否显示「恢复默认头像」） */
  hasCustomAvatar?: boolean;
};

type AuthSession = {
  accessToken: string;
  refreshToken: string;
  user?: AuthUser;
};

type PublicKeyResponse = {
  algorithm: "RSA-OAEP";
  public_key: string;
};

const API_BASE =
  ((import.meta.env.VITE_API_BASE as string | undefined) ??
    (import.meta.env.VITE_RECRUITMENT_API_BASE as string | undefined))
    ?.replace(/\/$/, "") ?? "";
const USER_KEY = "inogi-auth-user";
const ACCESS_TOKEN_KEY = "inogi-access-token";
const REFRESH_TOKEN_KEY = "inogi-refresh-token";
const AUTH_CLEARED_EVENT = "inogi-auth-cleared";

let refreshPromise: Promise<AuthSession | null> | null = null;
let loginPublicKeyPromise: Promise<CryptoKey> | null = null;

const TRANSIENT_API_RETRY_DELAYS_MS = [300, 700, 1500, 3000];

function getStorage() {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

function getApiUrl(path: string) {
  return `${API_BASE}${path}`;
}

function createHeaders(headersInit?: HeadersInit, body?: BodyInit | null) {
  const headers = new Headers(headersInit);
  if (typeof body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return headers;
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function shouldRetryTransientApiFailure(response: Response) {
  return [500, 502, 503, 504].includes(response.status);
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

/**
 * 该请求方法是否可安全地自动重试。
 *
 * 只有幂等方法（GET/HEAD/OPTIONS）能透明重试——重试对服务端没有副作用。POST/PUT/PATCH/DELETE
 * 是非幂等的：例如 MateChat 发消息是「先把用户消息落库、再开流式回答」，服务端 5xx 或网络中断时
 * 用户消息其实已经写库，此时自动重发会产生重复消息（甚至重复计费、重复确认卡）。这类请求交给
 * 调用方按业务语义决定是否重试，网络层不代劳。
 */
function isIdempotentMethod(init: RequestInit) {
  const method = (init.method ?? "GET").toUpperCase();
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
}

async function fetchWithTransientRetry(url: string, init: RequestInit) {
  // 非幂等请求：只发一次，任何失败都直接抛给调用方，绝不自动重发。
  if (!isIdempotentMethod(init)) {
    return fetch(url, init);
  }

  let lastError: unknown = null;

  for (let attempt = 0; attempt <= TRANSIENT_API_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (!shouldRetryTransientApiFailure(response) || attempt === TRANSIENT_API_RETRY_DELAYS_MS.length) {
        return response;
      }
    } catch (error) {
      if (isAbortError(error) || attempt === TRANSIENT_API_RETRY_DELAYS_MS.length) {
        throw error;
      }
      lastError = error;
    }

    await delay(TRANSIENT_API_RETRY_DELAYS_MS[attempt]);
  }

  throw lastError instanceof Error ? lastError : new Error("API request failed");
}

function pemToArrayBuffer(pem: string) {
  const base64 = pem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, "");
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes.buffer;
}

export function getBrowserEncryptionUnavailableMessage() {
  if (typeof window === "undefined") {
    return "当前环境不支持浏览器端加密，无法直接提交密码或 API Key。";
  }

  if (window.isSecureContext && window.crypto?.subtle) {
    return null;
  }

  const currentUrl = `${window.location.protocol}//${window.location.host}`;
  return `当前地址 ${currentUrl} 不是安全上下文，浏览器无法执行本地加密，所以不会发起保存请求。请改用 HTTPS，或仅在本机使用 http://localhost 打开系统。`;
}

export function ensureBrowserEncryptionAvailable() {
  const message = getBrowserEncryptionUnavailableMessage();
  if (message) {
    throw new Error(message);
  }
}

/** 浏览器端加密是否可用（HTTPS 或 localhost 的安全上下文才有 crypto.subtle）。 */
export function canUseBrowserEncryption() {
  return getBrowserEncryptionUnavailableMessage() === null;
}

async function getLoginPublicKey() {
  if (!loginPublicKeyPromise) {
    loginPublicKeyPromise = (async () => {
      ensureBrowserEncryptionAvailable();
      const response = await fetchFirstOk([
        "/api/auth/security/public-key",
        "/api/recruitment/security/public-key",
      ]);

      const payload = (await response.json()) as PublicKeyResponse;
      return window.crypto.subtle.importKey(
        "spki",
        pemToArrayBuffer(payload.public_key),
        {
          name: payload.algorithm,
          hash: "SHA-256",
        },
        true,
        ["encrypt"],
      );
    })().catch((error) => {
      loginPublicKeyPromise = null;
      throw error;
    });
  }

  return loginPublicKeyPromise;
}

async function fetchFirstOk(paths: string[]) {
  const errors: string[] = [];

  for (const path of paths) {
    try {
      const response = await apiFetch(path);
      if (response.ok) {
        return response;
      }
      const message = await readErrorMessage(response, `${response.status} ${response.statusText}`.trim());
      errors.push(`${path}: ${message}`);
    } catch (error) {
      errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`Failed to fetch the login public key. ${errors.join(" | ")}`);
}

export async function encryptLoginPassword(password: string) {
  ensureBrowserEncryptionAvailable();
  const publicKey = await getLoginPublicKey();
  const encoded = new TextEncoder().encode(password);
  const encrypted = await window.crypto.subtle.encrypt({ name: "RSA-OAEP" }, publicKey, encoded);
  return window.btoa(String.fromCharCode(...new Uint8Array(encrypted)));
}

export function resetLoginPublicKeyCache() {
  loginPublicKeyPromise = null;
}

export function getStoredUser() {
  const storage = getStorage();
  const raw = storage?.getItem(USER_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    clearAuthSession();
    return null;
  }
}

export function getAccessToken() {
  return getStorage()?.getItem(ACCESS_TOKEN_KEY) ?? null;
}

export function getRefreshToken() {
  return getStorage()?.getItem(REFRESH_TOKEN_KEY) ?? null;
}

export function saveAuthTokens(tokens: { accessToken: string; refreshToken: string }) {
  const storage = getStorage();
  if (!storage) return;

  storage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
  storage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
}

export function saveAuthSession(session: AuthSession) {
  const storage = getStorage();
  if (!storage) return;

  saveAuthTokens(session);
  if (session.user) {
    storage.setItem(USER_KEY, JSON.stringify(session.user));
  }
}

export function clearAuthSession() {
  const storage = getStorage();
  if (!storage) return;

  storage.removeItem(USER_KEY);
  storage.removeItem(ACCESS_TOKEN_KEY);
  storage.removeItem(REFRESH_TOKEN_KEY);
  window.dispatchEvent(new Event(AUTH_CLEARED_EVENT));
}

export function addAuthClearedListener(listener: () => void) {
  if (typeof window === "undefined") return () => {};

  window.addEventListener(AUTH_CLEARED_EVENT, listener);
  return () => window.removeEventListener(AUTH_CLEARED_EVENT, listener);
}

export async function readErrorMessage(response: Response, fallback: string) {
  try {
    const payload = (await response.clone().json()) as {
      detail?: string;
      error?: string;
      message?: string | string[];
    };

    const value = payload.message ?? payload.detail ?? payload.error;
    if (Array.isArray(value)) {
      const message = value.join(", ").trim();
      if (message) return message;
    }

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  } catch {
    // ignore parse failures and use fallback instead
  }

  return fallback;
}

export async function apiFetch(path: string, init: RequestInit = {}) {
  return fetchWithTransientRetry(getApiUrl(path), {
    ...init,
    headers: createHeaders(init.headers, init.body),
  });
}

export async function refreshAuthSession(): Promise<AuthSession | null> {
  const currentRefreshToken = getRefreshToken();
  if (!currentRefreshToken) {
    clearAuthSession();
    return null;
  }

  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const response = await apiFetch("/api/auth/refresh", {
          method: "POST",
          body: JSON.stringify({ refreshToken: currentRefreshToken }),
        });

        if (!response.ok) {
          clearAuthSession();
          return null;
        }

        const session = (await response.json()) as AuthSession;
        saveAuthSession(session);
        return session;
      } catch {
        clearAuthSession();
        return null;
      }
    })().finally(() => {
      refreshPromise = null;
    });
  }

  return refreshPromise;
}

export async function authFetch(path: string, init: RequestInit = {}, retry = true) {
  const headers = createHeaders(init.headers, init.body);
  const accessToken = getAccessToken();
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  let response = await fetchWithTransientRetry(getApiUrl(path), {
    ...init,
    headers,
  });

  if (response.status !== 401 || !retry) {
    if (response.status === 401) {
      clearAuthSession();
    }
    return response;
  }

  const refreshedSession = await refreshAuthSession();
  if (!refreshedSession) {
    return response;
  }

  headers.set("Authorization", `Bearer ${refreshedSession.accessToken}`);
  response = await fetchWithTransientRetry(getApiUrl(path), {
    ...init,
    headers,
  });

  if (response.status === 401) {
    clearAuthSession();
  }

  return response;
}
