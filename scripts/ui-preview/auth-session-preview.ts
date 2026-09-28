import type { AuthUser } from "../../src/app/lib/authSession";
import { previewUser } from "./fixtures";

// Only the isolated preview aliases this module. The resolver lets this re-export
// reach the real helpers without aliasing back here. No tokens or storage writes.
export * from "../../src/app/lib/authSession";

export function getStoredUser(): AuthUser {
  return previewUser;
}
