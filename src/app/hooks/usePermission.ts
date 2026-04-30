import { useAuth } from "../auth";
import { hasAnyPermission, hasPermission } from "../lib/permissions";

/** Returns true if the current user has the specified permission. */
export function usePermission(permission: string): boolean {
  const { user } = useAuth();
  if (!user) return false;
  return hasPermission(user.permissions, permission);
}

/** Returns true if the current user has ANY of the specified permissions. */
export function useAnyPermission(...permissions: string[]): boolean {
  const { user } = useAuth();
  if (!user) return false;
  return hasAnyPermission(user.permissions, permissions);
}
