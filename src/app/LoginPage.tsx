import React, { useEffect, useMemo, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { Eye, EyeOff, LockKeyhole, User } from "lucide-react";
import { useAuth } from "./auth";
import { authFetch } from "./lib/authSession";
import { SiteRecordFooter } from "./components/SiteRecordFooter";
import logo from "../assets/logo.png";

const DEFAULT_LOGIN_BG = "https://matechat.gitcode.com/png/home/bgHome.png";

/**
 * 登录页（移动端优先 + 桌面双栏）。
 *
 * 移动端要点：
 *  - 挂载期给 <html> 打 `.login-route`，解除 theme.css 对桌面强加的 min-width:1024
 *    与 #root 固定 100vh（否则手机上被撑到 1024 宽产生横向滚动，且软键盘弹出无处可滚）。
 *    与 MobileShell 的 `.mobile-route` 同一机制，离开即还原，桌面端零影响。
 *  - 高度用 100dvh 而非 100vh：避开 iOS 地址栏吃掉视口高度。
 *  - 输入框在移动端强制 16px 字号：小于 16px 时 iOS Safari 聚焦会自动放大整页。
 *  - 触控目标 ≥48px（material-input/material-button-primary 的默认 py 在手机上偏矮）。
 *  - 左右与底部留 safe-area inset，刘海屏/全面屏手势条不遮挡按钮。
 */
export function LoginPage() {
  const { user, hydrated, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [bgUrl, setBgUrl] = useState(DEFAULT_LOGIN_BG);

  const redirectTo = useMemo(() => {
    const from = (location.state as { from?: string } | null)?.from;
    return from && from !== "/login" ? from : "/";
  }, [location.state]);

  // 解除桌面外壳的 min-width / 固定高度约束（见组件顶部注释）
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("login-route");
    return () => root.classList.remove("login-route");
  }, []);

  // 登录页背景由「运营素材管理」控制（公开端点，免鉴权）；失败回退默认背景
  useEffect(() => {
    let cancelled = false;
    void authFetch("/api/content-slots/public/login-background")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { url?: string } | null) => {
        if (!cancelled && d?.url) setBgUrl(d.url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

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
      className="flex min-h-[100dvh] flex-col items-center bg-center bg-cover bg-no-repeat px-4 py-6"
      style={{
        backgroundImage: `url(${bgUrl})`,
        paddingLeft: "max(1rem, env(safe-area-inset-left))",
        paddingRight: "max(1rem, env(safe-area-inset-right))",
        paddingTop: "max(1.5rem, env(safe-area-inset-top))",
        paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))",
      }}
    >
      <div className="my-auto grid w-full max-w-sm overflow-hidden rounded-3xl border border-white/70 bg-white/80 shadow-[0_30px_60px_rgba(15,23,42,0.12)] backdrop-blur-md lg:max-w-5xl lg:grid-cols-[1.1fr_0.9fr]">
        {/* 品牌区：桌面为左栏大图文，手机不渲染（改用卡片内的紧凑品牌头，见下） */}
        <div className="hidden bg-[linear-gradient(145deg,#4338ca_0%,#6366f1_55%,#a5b4fc_100%)] p-10 text-white lg:flex lg:flex-col lg:justify-between">
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

        <div className="p-6 sm:p-8 lg:p-10">
          <div className="mx-auto max-w-md space-y-6">
            {/* 紧凑品牌头：仅手机/平板显示，桌面由左栏承担品牌表达 */}
            <div className="flex items-center gap-3 lg:hidden">
              <img src={logo} alt="INOGI AI" className="h-11 w-11 shrink-0 rounded-[6px] shadow-sm" />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-800">INOGI AI Office System</div>
                <div className="truncate text-xs text-slate-500">内部管理系统一体化工作台</div>
              </div>
            </div>

            <div>
              <div className="hidden text-sm font-semibold uppercase tracking-[0.24em] text-slate-400 lg:block">Welcome Back</div>
              <h2 className="text-2xl font-bold tracking-tight text-slate-900 lg:mt-2 lg:text-3xl">登录 INOGI 系统</h2>
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
                    // 手机软键盘：账号不首字母大写、不自动纠错，避免输入被"帮倒忙"改掉
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    enterKeyHint="next"
                    className="material-input min-h-[48px] pl-11 text-base lg:min-h-0 lg:text-sm"
                  />
                </div>
              </label>

              <label className="block space-y-2">
                <span className="text-sm font-medium text-slate-600">密码</span>
                <div className="relative">
                  <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="请输入密码"
                    autoComplete="current-password"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    enterKeyHint="go"
                    className="material-input min-h-[48px] pl-11 pr-12 text-base lg:min-h-0 lg:text-sm"
                  />
                  {/* 明文切换：手机软键盘易输错，无切换时只能清空重输 */}
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "隐藏密码" : "显示密码"}
                    aria-pressed={showPassword}
                    // 44px 触控目标（低于此值手机上易点空）；桌面收回 40px 以贴合输入框高度
                    className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 lg:h-10 lg:w-10"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </label>

              {error ? (
                <div role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
              ) : null}

              <button
                type="submit"
                disabled={loading}
                className="material-button-primary min-h-[48px] w-full text-base disabled:opacity-60 lg:min-h-0 lg:text-sm"
              >
                {loading ? "登录中..." : "登录系统"}
              </button>
            </form>

            {/* 桌面的这两句在左栏，手机没有左栏 → 补在表单下方 */}
            <p className="text-center text-xs leading-6 text-slate-500 lg:hidden">
              账号由系统管理员统一分配，请联系管理员获取登录凭证。
            </p>
          </div>
        </div>
      </div>
      <SiteRecordFooter className="mt-4 w-full max-w-5xl" />
    </div>
  );
}
