import type { ReactNode } from "react";
import { previewUser } from "./fixtures";

// This module is substituted ONLY by scripts/ui-preview/vite.config.ts.
// It never loads, stores, refreshes, or fabricates a production session/token.
export function AuthProvider({ children }: { children: ReactNode }) { return children; }
export function useAuth() {
  return {
    user: previewUser, hydrated: true,
    login: async () => ({ ok: false, message: "Preview has no login service" }),
    logout: async () => {}, refreshUser: async () => previewUser,
  };
}
export function getAccessToken() { return ""; }
export function getRoleLabel() { return "UI Preview"; }
