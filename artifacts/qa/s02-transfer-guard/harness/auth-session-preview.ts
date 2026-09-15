import { previewUser } from './auth-preview';
// Never load real session code, storage tokens, or external API hosts.
export async function authFetch(path: string, init: RequestInit = {}) {
  if (!path.startsWith('/api/') || path.startsWith('//')) throw new Error('隔离验证禁止访问其他接口来源');
  const headers = new Headers(init.headers);
  headers.delete('Authorization');
  headers.set('X-Inogi-Fixture', 'S02-memory-only');
  if (typeof init.body === 'string') headers.set('Content-Type', 'application/json');
  return fetch(path, { ...init, headers, credentials: 'omit' });
}
export const apiFetch = authFetch;
export async function readErrorMessage(response: Response, fallback: string) {
  const data = await response.json().catch(() => null);
  return typeof data?.message === 'string' ? data.message : fallback;
}
export function getStoredUser() { return previewUser(); }
export function addAuthClearedListener() { return () => {}; }
export function getAccessToken() { return ''; }
export function getRefreshToken() { return ''; }
export function clearAuthSession() {}
