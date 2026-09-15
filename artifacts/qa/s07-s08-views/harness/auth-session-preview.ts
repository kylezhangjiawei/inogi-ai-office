import { previewUser } from './auth-preview';
// Tokenless fixture transport. No real session module, storage, auth header, or external requests.
export async function authFetch(path: string, init: RequestInit = {}) {
  if (!path.startsWith('/api/') || path.startsWith('//')) throw new Error('隔离验证禁止访问其他接口来源');
  const headers = new Headers(init.headers);
  headers.delete('Authorization');
  headers.set('X-Preview-Access',new URLSearchParams(location.search).get('access')||'manager');
  if (typeof init.body === 'string') headers.set('Content-Type', 'application/json');
  if (new URLSearchParams(location.search).get('readonly') === '1') headers.set('X-Preview-Readonly', '1');
  return fetch(path, { ...init, headers, credentials: 'omit' });
}
export const apiFetch = authFetch;
export async function readErrorMessage(response: Response, fallback: string) {
  const data = await response.json().catch(() => null);
  return typeof data?.message === 'string' ? data.message : fallback;
}
export function getStoredUser() { return previewUser(new URLSearchParams(location.search).get('readonly') === '1'); }
export function addAuthClearedListener() { return () => {}; }
export function getAccessToken() { return ''; }
export function getRefreshToken() { return ''; }
export function clearAuthSession() {}
