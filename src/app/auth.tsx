import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

type UserRole = "admin" | "manager" | "specialist";

type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  department: string;
};

type LoginPayload = {
  email: string;
  password: string;
};

type AuthContextValue = {
  user: AuthUser | null;
  hydrated: boolean;
  login: (payload: LoginPayload) => Promise<{ ok: boolean; message?: string }>;
  logout: () => void;
};

const STORAGE_KEY = "inogi-auth-user";

const demoUsers: Array<AuthUser & { password: string }> = [
  { id: "U-001", name: "林云舟", email: "admin@inogi.local", password: "123456", role: "admin", department: "信息管理中心" },
  { id: "U-002", name: "周知行", email: "manager@inogi.local", password: "123456", role: "manager", department: "运营管理部" },
  { id: "U-003", name: "陈思远", email: "specialist@inogi.local", password: "123456", role: "specialist", department: "业务协同组" },
];

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        setUser(JSON.parse(raw));
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }
    setHydrated(true);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      hydrated,
      async login(payload) {
        const matched = demoUsers.find(
          (item) => item.email === payload.email.trim() && item.password === payload.password.trim(),
        );
        if (!matched) return { ok: false, message: "账号或密码错误，请使用演示账号登录。" };

        const nextUser: AuthUser = {
          id: matched.id,
          name: matched.name,
          email: matched.email,
          role: matched.role,
          department: matched.department,
        };
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextUser));
        setUser(nextUser);
        return { ok: true };
      },
      logout() {
        window.localStorage.removeItem(STORAGE_KEY);
        setUser(null);
      },
    }),
    [hydrated, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}

export function getRoleLabel(role: UserRole) {
  if (role === "admin") return "系统管理员";
  if (role === "manager") return "部门主管";
  return "业务专员";
}
