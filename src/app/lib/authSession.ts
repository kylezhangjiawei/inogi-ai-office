export type AuthUser = {
  id: string;
  name: string;
  email: string;
  roleId: string | null;
  roleName: string | null;
  permissions: string[];
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

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") ?? "";
const USER_KEY = "inogi-auth-user";
const ACCESS_TOKEN_KEY = "inogi-access-token";
const REFRESH_TOKEN_KEY = "inogi-refresh-token";
const AUTH_CLEARED_EVENT = "inogi-auth-cleared";

let refreshPromise: Promise<AuthSession | null> | null = null;
let loginPublicKeyPromise: Promise<CryptoKey> | null = null;

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

async function getLoginPublicKey() {
  if (!loginPublicKeyPromise) {
    loginPublicKeyPromise = (async () => {
      ensureBrowserEncryptionAvailable();
      const response = await apiFetch("/api/auth/security/public-key");
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to fetch the login public key."));
      }

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
  return fetch(getApiUrl(path), {
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

  let response = await fetch(getApiUrl(path), {
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
  response = await fetch(getApiUrl(path), {
    ...init,
    headers,
  });

  if (response.status === 401) {
    clearAuthSession();
  }

  return response;
}
