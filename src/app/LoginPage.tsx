import React, { useMemo, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { LockKeyhole, User } from "lucide-react";
import { useAuth } from "./auth";

export function LoginPage() {
  const { user, hydrated, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const redirectTo = useMemo(() => {
    const from = (location.state as { from?: string } | null)?.from;
    return from && from !== "/login" ? from : "/";
  }, [location.state]);

  if (!hydrated) return null;
  if (user) return <Navigate to={redirectTo} replace />;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    const result = await login({ account: account.trim(), password });
    setLoading(false);
    if (!result.ok) {
      setError(result.message ?? "登录失败");
      return;
    }
    navigate(redirectTo, { replace: true });
  }

  return (
    <div
      className="flex min-h-screen items-center justify-center bg-center bg-cover bg-no-repeat px-4"
      style={{ backgroundImage: "url(https://matechat.gitcode.com/png/home/bgHome.png)" }}
    >
      <div className="grid w-full max-w-5xl overflow-hidden rounded-[32px] border border-white/70 bg-white/80 shadow-[0_30px_60px_rgba(15,23,42,0.12)] lg:grid-cols-[1.1fr_0.9fr]">
        <div className="hidden bg-[linear-gradient(145deg,#1565c0_0%,#42a5f5_55%,#80cbc4_100%)] p-10 text-white lg:flex lg:flex-col lg:justify-between">
          <div>
            <div className="inline-flex rounded-full bg-white/16 px-4 py-2 text-sm font-semibold">INOGI AI Office System</div>
            <h1 className="mt-8 text-4xl font-bold leading-tight">内部管理系统一体化工作台</h1>
            <p className="mt-4 max-w-md text-sm leading-7 text-white/85">
              覆盖售后、研发、注册、质量、人事、法务与系统管理。
            </p>
          </div>
          <div className="space-y-2 text-sm text-white/90">
            <div>账号由系统管理员统一分配，请联系管理员获取登录凭证。</div>
            <div>支持超级管理员、部门主管、业务专员等多种角色。</div>
          </div>
        </div>

        <div className="p-8 md:p-10">
          <div className="mx-auto max-w-md space-y-6">
            <div>
              <div className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-400">Welcome Back</div>
              <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">登录 INOGI 系统</h2>
              <p className="mt-2 text-sm text-slate-500">请使用管理员分配的账号登录。</p>
            </div>

            <form className="space-y-4" onSubmit={handleSubmit}>
              <label className="block space-y-2">
                <span className="text-sm font-medium text-slate-600">账号</span>
                <div className="relative">
                  <User className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    value={account}
                    onChange={(e) => setAccount(e.target.value)}
                    placeholder="请输入账号"
                    autoComplete="username"
                    className="material-input pl-11"
                  />
                </div>
              </label>

              <label className="block space-y-2">
                <span className="text-sm font-medium text-slate-600">密码</span>
                <div className="relative">
                  <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="请输入密码"
                    autoComplete="current-password"
                    className="material-input pl-11"
                  />
                </div>
              </label>

              {error ? (
                <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
              ) : null}

              <button type="submit" disabled={loading} className="material-button-primary w-full disabled:opacity-60">
                {loading ? "登录中..." : "登录系统"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
