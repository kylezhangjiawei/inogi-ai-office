import { routePath } from "./routePaths";

/** Accept only an internal return to the configured procurement workbench. */
export function procurementWorkspaceReturnPath(state: unknown): string | null {
  if (!state || typeof state !== "object" || Array.isArray(state)) return null;
  const target = (state as Record<string, unknown>).procurementWorkspaceReturn;
  if (typeof target !== "string" || !target.startsWith("/") || target.startsWith("//")) return null;
  if (/[\\\u0000-\u001f\u007f]/.test(target)) return null;
  const pathname = target.split(/[?#]/, 1)[0];
  return pathname === routePath("page:proc-my-workspace", "/proc-my-workspace") ? target : null;
}
