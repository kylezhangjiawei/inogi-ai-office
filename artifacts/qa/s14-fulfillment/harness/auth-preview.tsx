import { type ReactNode } from 'react';
import { user } from './fixtures.mjs';
export function AuthProvider({ children }: { children: ReactNode }) { return children; }
export function previewUser() { return user; }
export function useAuth() {
  return { user, hydrated: true, login: async () => ({ ok: false }), logout: async () => {}, refreshUser: async () => user };
}
export function getAccessToken() { return ''; }
export function getRoleLabel() { return '订单只读验证员'; }
