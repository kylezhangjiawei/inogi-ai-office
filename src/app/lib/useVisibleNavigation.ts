import { useMemo } from "react";
import { useAuth } from "../auth";
import { navGroups } from "../routesConfig";
import { hasPermission } from "./permissions";
import { useNavHiddenCodes } from "./permissionCatalogApi";

const EMPTY_PERMISSIONS: string[] = [];

/** Keep page search and both navigation surfaces on the same permission rules. */
export function useVisibleNavigation() {
  const { user } = useAuth();
  const permissions = user?.permissions ?? EMPTY_PERMISSIONS;
  const hiddenCodes = useNavHiddenCodes(user?.id);

  return useMemo(() => navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (item.requiredPermissionAny?.length) {
          return item.requiredPermissionAny.some(
            (code) => hasPermission(permissions, code) && !hiddenCodes.has(code),
          );
        }
        return !item.requiredPermission || (
          hasPermission(permissions, item.requiredPermission) && !hiddenCodes.has(item.requiredPermission)
        );
      }),
    }))
    .filter((group) => group.items.length > 0), [permissions, hiddenCodes]);
}
