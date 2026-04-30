import React from "react";
import { useAnyPermission, usePermission } from "../hooks/usePermission";

interface PermissionGuardProps {
  /** Single permission code that must be present. */
  permission?: string;
  /** List of permission codes — user needs at least one (OR logic). */
  anyOf?: string[];
  children: React.ReactNode;
  /** Rendered when the user lacks permission. Defaults to null (hidden). */
  fallback?: React.ReactNode;
}

/**
 * Renders children only when the current user has the required permission(s).
 * Use this for button-level and section-level access control.
 *
 * @example
 * <PermissionGuard permission="user:delete">
 *   <button onClick={handleDelete}>删除</button>
 * </PermissionGuard>
 *
 * @example
 * <PermissionGuard anyOf={["user:create", "user:edit"]}>
 *   <button onClick={handleSave}>保存</button>
 * </PermissionGuard>
 */
export function PermissionGuard({ permission, anyOf, children, fallback = null }: PermissionGuardProps) {
  const hasSingle = usePermission(permission ?? "");
  const hasAny = useAnyPermission(...(anyOf ?? []));

  const allowed = permission ? hasSingle : anyOf ? hasAny : true;

  if (!allowed) return <>{fallback}</>;
  return <>{children}</>;
}
