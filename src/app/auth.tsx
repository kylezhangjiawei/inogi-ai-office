import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  addAuthClearedListener,
  apiFetch,
  authFetch,
  clearAuthSession,
  encryptLoginPassword,
  getAccessToken as getStoredAccessToken,
  getRefreshToken,
  getStoredUser,
  readErrorMessage,
  refreshAuthSession,
  resetLoginPublicKeyCache,
  saveAuthSession,
  type AuthUser,
} from "./lib/authSession";

type LoginPayload = {
  account: string;
  password: string;
};

type AuthContextValue = {
  user: AuthUser | null;
  hydrated: boolean;
  login: (payload: LoginPayload) => Promise<{ ok: boolean; message?: string }>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchCurrentUser() {
  const response = await authFetch("/api/auth/me");
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to fetch the current user."));
  }

  return (await response.json()) as { user: AuthUser };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function hydrateAuth() {
      const cachedUser = getStoredUser();
      const hasAccessToken = Boolean(getStoredAccessToken());
      const hasRefreshToken = Boolean(getRefreshToken());

      if (!hasAccessToken && !hasRefreshToken) {
        clearAuthSession();
        if (!cancelled) {
          setUser(null);
          setHydrated(true);
        }
        return;
      }

      try {
        const payload = await fetchCurrentUser();
        if (!cancelled) {
          saveAuthSession({
            accessToken: getStoredAccessToken() ?? "",
            refreshToken: getRefreshToken() ?? "",
            user: payload.user,
          });
          setUser(payload.user);
        }
      } catch {
        if (!cancelled) {
          setUser(cachedUser);
        }
      } finally {
        if (!cancelled) {
          setHydrated(true);
        }
      }
    }

    void hydrateAuth();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return addAuthClearedListener(() => {
      setUser(null);
    });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      hydrated,

      async login(payload) {
        try {
          const submitLogin = async (refreshKey = false) => {
            if (refreshKey) {
              resetLoginPublicKeyCache();
            }

            const encryptedPassword = await encryptLoginPassword(payload.password);
            return apiFetch("/api/auth/login", {
              method: "POST",
              body: JSON.stringify({ account: payload.account, encryptedPassword }),
            });
          };

          let response = await submitLogin();

          if (!response.ok) {
            const message = await readErrorMessage(response, "Incorrect account or password.");
            if (response.status === 400 && message.toLowerCase().includes("encrypt")) {
              response = await submitLogin(true);
            } else {
              return { ok: false, message };
            }
          }

          if (!response.ok) {
            return {
              ok: false,
              message: await readErrorMessage(response, "Incorrect account or password."),
            };
          }

          const data = (await response.json()) as {
            accessToken: string;
            refreshToken: string;
            user?: AuthUser;
          };

          saveAuthSession(data);

          const currentUserPayload = data.user ? { user: data.user } : await fetchCurrentUser();
          saveAuthSession({
            accessToken: data.accessToken,
            refreshToken: data.refreshToken,
            user: currentUserPayload.user,
          });
          setUser(currentUserPayload.user);

          return { ok: true };
        } catch (error) {
          clearAuthSession();
          return {
            ok: false,
            message: error instanceof Error ? error.message : "Network error. Please verify that the backend service is reachable.",
          };
        }
      },

      async logout() {
        try {
          let accessToken = getStoredAccessToken();
          let refreshToken = getRefreshToken();

          if (refreshToken && !accessToken) {
            const refreshed = await refreshAuthSession();
            accessToken = refreshed?.accessToken ?? null;
            refreshToken = refreshed?.refreshToken ?? null;
          }

          if (refreshToken && accessToken) {
            let response = await apiFetch("/api/auth/logout", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${accessToken}`,
              },
              body: JSON.stringify({ refreshToken }),
            });

            if (response.status === 401) {
              const refreshed = await refreshAuthSession();
              accessToken = refreshed?.accessToken ?? null;
              refreshToken = refreshed?.refreshToken ?? null;

              if (refreshToken && accessToken) {
                response = await apiFetch("/api/auth/logout", {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${accessToken}`,
                  },
                  body: JSON.stringify({ refreshToken }),
                });
              }
            }
          }
        } catch {
          // Ignore logout network failures and always clear local session.
        } finally {
          clearAuthSession();
          setUser(null);
        }
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

export function getAccessToken() {
  return getStoredAccessToken();
}

export function getRoleLabel(roleName: string | null | undefined) {
  if (!roleName) return "Regular User";
  if (roleName === "超级管理员") return "超级管理员";
  return roleName;
}
