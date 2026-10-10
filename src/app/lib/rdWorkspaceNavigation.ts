import { routePath } from "./routePaths";

/** Accept only an internal return to the configured research workbench. */
export function rdWorkspaceReturnPath(state: unknown): string | null {
  if (!state || typeof state !== "object" || Array.isArray(state)) return null;
  const target = (state as Record<string, unknown>).rdWorkspaceReturn;
  if (typeof target !== "string" || !target.startsWith("/") || target.startsWith("//")) return null;
  if (/[\\\u0000-\u001f\u007f]/.test(target)) return null;
  const pathname = target.split(/[?#]/, 1)[0];
  return pathname === routePath("page:rd-my-workspace", "/rd-my-workspace") ? target : null;
}
